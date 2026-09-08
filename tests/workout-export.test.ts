import { describe, expect, it, vi } from "vitest";

import {
  exportSession,
  handleWorkoutExport,
  workoutExportNotes,
  WORKOUT_EXPORT_NOTES_LIMIT,
  WORKOUT_EXPORT_SELECT,
  type ExportExercise,
  type ExportSession,
} from "@/lib/imports/workout-export.server";
import { sha256Hex } from "@/lib/imports/device-sync.server";

const token = "test-only-android-device-token-123456789";
const now = Date.parse("2026-09-08T12:00:00Z");
const url =
  "https://irondeskpro.com/api/public/health-connect/workouts?from=2026-08-09T12:00:00Z&to=2026-09-08T12:00:00Z";
const row: ExportSession = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  title: "Upper body",
  kind: "strength",
  status: "completed",
  is_sample: false,
  started_at: "2026-09-07T17:00:00Z",
  completed_at: "2026-09-07T18:00:00Z",
  updated_at: "2026-09-07T18:01:00Z",
  notes: "Solid session",
};

async function db(
  options: {
    rows?: ExportSession[];
    lookupError?: boolean;
    queryError?: boolean;
    preferencesError?: boolean;
    units?: string;
    platform?: string;
    revoked?: boolean;
  } = {},
) {
  const device = options.revoked
    ? null
    : {
        id: "device-id",
        user_id: "owner-from-token",
        label: "Phone",
        platform: options.platform ?? "android",
        data_source_id: "source-id",
        token_hash: await sha256Hex(token),
      };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    then: (resolve: (result: unknown) => unknown) =>
      Promise.resolve({
        data: options.rows ?? [row],
        error: options.queryError ? { message: "private database failure" } : null,
      }).then(resolve),
  };
  const lookup = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: device,
      error: options.lookupError ? { message: "unavailable" } : null,
    })),
  };
  const preferences = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({
      data: { units: options.units ?? "imperial" },
      error: options.preferencesError ? { message: "private preference failure" } : null,
    })),
  };
  const from = vi.fn((table: string) =>
    table === "device_links" ? lookup : table === "user_preferences" ? preferences : query,
  );
  return {
    admin: { from } as unknown as Parameters<typeof handleWorkoutExport>[1],
    query,
    from,
    preferences,
  };
}

function request(target = url, auth: string | null = token) {
  return new Request(target, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
}

describe("completed workout export", () => {
  it("uses only device ownership, completed non-sample rows, and private no-store responses", async () => {
    const { admin, query, preferences } = await db();
    const response = await handleWorkoutExport(request(), admin, now);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(query.eq.mock.calls).toEqual([
      ["user_id", "owner-from-token"],
      ["status", "completed"],
      ["is_sample", false],
    ]);
    expect(query.gte).toHaveBeenCalledWith("completed_at", "2026-08-09T12:00:00Z");
    expect(query.select).toHaveBeenCalledWith(WORKOUT_EXPORT_SELECT);
    expect(preferences.eq).toHaveBeenCalledWith("user_id", "owner-from-token");
    const payload = await response.json();
    expect(payload.workouts[0]).toMatchObject({
      id: row.id,
      start_time: "2026-09-07T17:00:00.000Z",
      client_record_version: now,
    });
    expect(payload.workouts[0]).not.toHaveProperty("user_id");
    expect(payload.workouts[0]).not.toHaveProperty("calories");
  });

  it("rejects missing, revoked and wrong-platform credentials before workout queries", async () => {
    for (const options of [{ revoked: true }, { platform: "connect_iq" }, {}]) {
      const { admin, from } = await db(options);
      const response = await handleWorkoutExport(
        request(url, Object.keys(options).length ? token : null),
        admin,
        now,
      );
      expect(response.status).toBe(401);
      expect(from).not.toHaveBeenCalledWith("workout_sessions");
    }
  });

  it("reports auth/database outages as retryable without exposing database details", async () => {
    for (const options of [
      { lookupError: true },
      { queryError: true },
      { preferencesError: true },
    ]) {
      const { admin } = await db(options);
      const response = await handleWorkoutExport(request(), admin, now);
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private database failure");
    }
  });

  it("rejects caller-selected owners, invalid cursors, reversed and oversized ranges", async () => {
    for (const invalid of [
      url + "&user_id=someone-else",
      url + "&after=not-a-uuid",
      url.replace("2026-08-09", "2026-09-09"),
      url.replace("2026-08-09", "2024-08-09"),
    ]) {
      const { admin, from } = await db();
      expect((await handleWorkoutExport(request(invalid), admin, now)).status).toBe(400);
      expect(from).not.toHaveBeenCalledWith("workout_sessions");
    }
  });

  it("paginates raw rows so invalid sessions cannot strand later valid workouts", async () => {
    const rows = Array.from({ length: 101 }, (_, i) => ({
      ...row,
      id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
      completed_at: i === 99 ? row.started_at : row.completed_at,
    }));
    const { admin } = await db({ rows });
    const payload = await (await handleWorkoutExport(request(), admin, now)).json();
    expect(payload.workouts).toHaveLength(99);
    expect(payload.skipped).toBe(1);
    expect(payload.next_cursor).toBe(rows[99].id);
    const next = await db({ rows: [rows[100]] });
    expect(
      (await handleWorkoutExport(request(url + `&after=${payload.next_cursor}`), next.admin, now))
        .status,
    ).toBe(200);
    expect(next.query.gt).toHaveBeenCalledWith("id", rows[99].id);
  });

  it("skips incomplete, sample, active and invalid-timing sessions", () => {
    for (const change of [
      { completed_at: null },
      { is_sample: true },
      { status: "active" },
      { started_at: "bad" },
      { completed_at: row.started_at },
    ]) {
      expect(exportSession({ ...row, ...change })).toBeNull();
    }
  });

  it("keeps IDs stable and increases version for edited completed workouts", () => {
    const original = exportSession(row)!;
    const edited = exportSession({
      ...row,
      title: "Edited workout",
      updated_at: "2026-09-08T10:00:00Z",
    })!;
    expect(edited.id).toBe(original.id);
    expect(edited.client_record_version).toBeGreaterThan(original.client_record_version);
  });
});

const exercise: ExportExercise = {
  id: "exercise-a",
  exercise_name: "Bench Press",
  position: 0,
  workout_sets: [
    { set_number: 2, reps: 6, weight_kg: 22.68, rpe: 8.5, completed: true, is_warmup: false },
    { set_number: 1, reps: 8, weight_kg: 20, rpe: null, completed: true, is_warmup: true },
    { set_number: 3, reps: 10, weight_kg: 90, rpe: 9, completed: false, is_warmup: false },
  ],
};

describe("performed-exercise breakdown", () => {
  it("exports actual completed sets in exercise/set order, with loads, RPE and warm-up labels", () => {
    const notes = workoutExportNotes(
      {
        ...row,
        session_exercises: [
          { ...exercise, id: "exercise-b", position: 1, exercise_name: "Cable Row" },
          exercise,
          {
            ...exercise,
            id: "not-performed",
            exercise_name: "Planned only",
            workout_sets: [exercise.workout_sets[2]],
          },
        ],
      },
      "imperial",
    );
    expect(notes).toBe(
      [
        "Performed: 2 exercises, 4 completed sets.",
        "1. Bench Press",
        "  Set 1 (warm-up): 8 reps × 44.1 lb",
        "  Set 2: 6 reps × 50 lb; RPE 8.5",
        "2. Cable Row",
        "  Set 1 (warm-up): 8 reps × 44.1 lb",
        "  Set 2: 6 reps × 50 lb; RPE 8.5",
        "",
        "Session notes:",
        "Solid session",
      ].join("\n"),
    );
    expect(notes).not.toContain("Planned only");
    expect(notes).not.toContain("Set 3");
  });

  it("keeps missing measurements distinct from logged zero values", () => {
    const notes = workoutExportNotes(
      {
        ...row,
        notes: null,
        session_exercises: [
          {
            ...exercise,
            workout_sets: [
              {
                ...exercise.workout_sets[0],
                set_number: 1,
                reps: null,
                weight_kg: null,
                rpe: null,
              },
              { ...exercise.workout_sets[0], set_number: 2, reps: 0, weight_kg: 0, rpe: null },
            ],
          },
        ],
      },
      "metric",
    );
    expect(notes).toContain("Set 1: reps not logged × load not logged");
    expect(notes).toContain("Set 2: 0 reps × 0 kg");
    expect(notes).not.toContain("RPE");
  });

  it("retains session-only notes and does not invent exercises for empty sessions", () => {
    expect(workoutExportNotes(row, "metric")).toBe("Solid session");
    expect(workoutExportNotes({ ...row, notes: null, session_exercises: [] }, "metric")).toBeNull();
  });

  it("marks long summaries instead of silently truncating a set measurement", () => {
    const notes = workoutExportNotes(
      {
        ...row,
        session_exercises: Array.from({ length: 50 }, (_, i) => ({
          ...exercise,
          id: `exercise-${i}`,
          position: i,
        })),
      },
      "metric",
    )!;
    expect(notes.length).toBeLessThanOrEqual(WORKOUT_EXPORT_NOTES_LIMIT);
    expect(notes).toContain("Performed: 50 exercises, 100 completed sets.");
    expect(notes).toContain("1. Bench Press");
    expect(notes.endsWith("\n… More details in IronDesk.")).toBe(true);
    const lastSet = notes
      .split("\n")
      .filter((line) => line.startsWith("  Set"))
      .at(-1)!;
    expect(lastSet).toMatch(/kg(?:; RPE 8\.5)?$/);
  });

  it("uses the account's metric choice in the actual authenticated response", async () => {
    const { admin } = await db({
      units: "metric",
      rows: [{ ...row, session_exercises: [exercise] }],
    });
    const body = await (await handleWorkoutExport(request(), admin, now)).json();
    expect(body.schema_version).toBe(1);
    expect(body.workouts[0].notes).toContain("6 reps × 22.7 kg; RPE 8.5");
    expect(body.workouts[0]).not.toHaveProperty("segments");
  });

  it("refreshes an already exported workout after a set edit or deletion without changing its identity", async () => {
    const source = { ...row, session_exercises: [exercise] };
    const firstDb = await db({ rows: [source] });
    const first = (await (await handleWorkoutExport(request(), firstDb.admin, now)).json())
      .workouts[0];
    const changedDb = await db({
      rows: [
        {
          ...source,
          session_exercises: [
            { ...exercise, workout_sets: [{ ...exercise.workout_sets[0], reps: 9 }] },
          ],
        },
      ],
    });
    const changed = (
      await (await handleWorkoutExport(request(), changedDb.admin, now + 1000)).json()
    ).workouts[0];
    expect(changed.id).toBe(first.id);
    expect(changed.client_record_version).toBeGreaterThan(first.client_record_version);
    expect(changed.notes).toContain("9 reps × 50 lb");
    expect(changed.notes).not.toContain("warm-up");
  });
});
