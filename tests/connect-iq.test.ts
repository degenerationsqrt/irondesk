import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CONNECT_IQ_SNAPSHOT_LIMITS,
  ConnectIqApiError,
  assertConnectIqSnapshotExecutable,
  connectIqEventHash,
  connectIqEventsRequestSchema,
  hasCompleteConnectIqAckCoverage,
  isOwnedActiveSession,
  toConnectIqSnapshot,
  type ConnectIqSessionRow,
} from "@/lib/connect-iq/server";
import {
  DeviceResolutionError,
  connectIqPairingRequestSchema,
  normalizePairingCode,
  pairingRequestSchema,
  resolveDevice,
  sha256Hex,
} from "@/lib/imports/device-sync.server";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const SET_ID = "22222222-2222-4222-8222-222222222222";
const EXERCISE_ID = "33333333-3333-4333-8333-333333333333";

const setEvent = {
  event_id: "watch.event-0001",
  session_id: SESSION_ID,
  set_id: SET_ID,
  type: "set.updated" as const,
  occurred_at: 1_788_000_000,
  payload: { weight_kg: 102.5, reps: 5, rpe: 8, completed: true, rest_seconds: 123 },
};

function session(overrides: Partial<ConnectIqSessionRow> = {}): ConnectIqSessionRow {
  return {
    id: SESSION_ID,
    user_id: "user-1",
    title: "Lower strength",
    focus: "Squat",
    status: "active",
    started_at: "2026-08-29T19:00:00.000Z",
    is_sample: false,
    session_exercises: [
      {
        id: EXERCISE_ID,
        exercise_name: "Back Squat",
        position: 2,
        target_reps: "5",
        rest_seconds: 180,
        load_guidance: "Controlled working sets",
        workout_sets: [
          {
            id: SET_ID,
            set_number: 2,
            weight_kg: 102.5,
            reps: 5,
            rpe: 8,
            completed: false,
            is_warmup: false,
            rest_seconds: 180,
          },
          {
            id: "44444444-4444-4444-8444-444444444444",
            set_number: 1,
            weight_kg: null,
            reps: 5,
            rpe: null,
            completed: false,
            is_warmup: true,
            rest_seconds: 120,
          },
        ],
      },
      {
        id: "55555555-5555-4555-8555-555555555555",
        exercise_name: "Leg Curl",
        position: 1,
        target_reps: "10-12",
        rest_seconds: 60,
        load_guidance: null,
        workout_sets: [],
      },
    ],
    ...overrides,
  };
}

describe("Connect IQ pairing schemas", () => {
  it("normalizes the display code and purpose-binds both client schemas", () => {
    expect(normalizePairingCode(" abcd-23 45 ")).toBe("ABCD2345");
    expect(connectIqPairingRequestSchema.parse({ code: "ABCD2345" })).toEqual({
      code: "ABCD2345",
      device_label: "Garmin watch",
    });
    expect(pairingRequestSchema.parse({ code: "ABCD2345" }).platform).toBe("android");
    expect(
      pairingRequestSchema.safeParse({ code: "ABCD2345", platform: "connect_iq" }).success,
    ).toBe(false);
  });

  it("keeps the public v1 paths and pairing token field aligned with the watch", () => {
    const routeRoot = join(process.cwd(), "src/routes/api/public/connect-iq/v1");
    const activeRoute = readFileSync(join(routeRoot, "workouts/active.ts"), "utf8");
    const eventsRoute = readFileSync(join(routeRoot, "workout-events.ts"), "utf8");
    const pairRoute = readFileSync(join(routeRoot, "pair.ts"), "utf8");
    const unpairRoute = readFileSync(join(routeRoot, "unpair.ts"), "utf8");

    expect(activeRoute).toContain("/api/public/connect-iq/v1/workouts/active");
    expect(eventsRoute).toContain("/api/public/connect-iq/v1/workout-events");
    expect(eventsRoute).toContain("rejected.push");
    expect(eventsRoute).toContain("processed: results, rejected");
    expect(eventsRoute).toContain("hasCompleteConnectIqAckCoverage");
    expect(eventsRoute).toContain("new TextEncoder().encode(raw).byteLength");
    expect(activeRoute).toContain("workout_not_watch_compatible");
    expect(pairRoute).toContain("new TextEncoder().encode(raw).byteLength");
    expect(pairRoute).toContain("device_token: result.token");
    for (const authenticatedRoute of [activeRoute, eventsRoute, unpairRoute]) {
      expect(authenticatedRoute).toContain("instanceof DeviceResolutionError");
      expect(authenticatedRoute).toContain("503");
    }
  });

  it("does not misclassify a device-auth service failure as an invalid token", async () => {
    const token = "release-device-token-1234567890";
    const failingAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: "08006", message: "connection unavailable" },
            }),
          }),
        }),
      }),
    } as never;

    await expect(
      resolveDevice(failingAdmin, `Bearer ${token}`, "connect_iq"),
    ).rejects.toBeInstanceOf(DeviceResolutionError);

    const missingAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    } as never;
    await expect(resolveDevice(missingAdmin, `Bearer ${token}`, "connect_iq")).resolves.toBeNull();

    const androidOnlyAdmin = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                id: "device-1",
                user_id: "user-1",
                label: "Android phone",
                platform: "android",
                data_source_id: null,
                token_hash: await sha256Hex(token),
              },
              error: null,
            }),
          }),
        }),
      }),
    } as never;
    await expect(
      resolveDevice(androidOnlyAdmin, `Bearer ${token}`, "connect_iq"),
    ).resolves.toBeNull();
  });
});

describe("Connect IQ event schema", () => {
  it("accepts Unix seconds and normalizes them to an ISO instant", () => {
    const parsed = connectIqEventsRequestSchema.parse({ events: [setEvent] });
    expect(parsed.events[0]?.occurred_at).toBe(
      new Date(setEvent.occurred_at * 1_000).toISOString(),
    );
  });

  it("also accepts an ISO instant and an empty workout-finished payload", () => {
    const parsed = connectIqEventsRequestSchema.parse({
      events: [
        {
          event_id: "watch.finish-0001",
          session_id: SESSION_ID,
          type: "workout.finished",
          occurred_at: "2026-08-29T20:00:00Z",
        },
      ],
    });
    expect(parsed.events[0]).toMatchObject({
      occurred_at: "2026-08-29T20:00:00.000Z",
      payload: {},
    });
  });

  it("rejects pounds, impossible fields and duplicate ids in one batch", () => {
    expect(
      connectIqEventsRequestSchema.safeParse({
        events: [{ ...setEvent, payload: { weight_lb: 225 } }],
      }).success,
    ).toBe(false);
    expect(
      connectIqEventsRequestSchema.safeParse({
        events: [{ ...setEvent, payload: { weight_kg: 1_001 } }],
      }).success,
    ).toBe(false);
    expect(
      connectIqEventsRequestSchema.safeParse({
        events: [{ ...setEvent, payload: { rpe: 8.25 } }],
      }).success,
    ).toBe(false);
    expect(
      connectIqEventsRequestSchema.safeParse({
        events: [{ ...setEvent, payload: { rpe: null } }],
      }).success,
    ).toBe(true);
    expect(connectIqEventsRequestSchema.safeParse({ events: [setEvent, setEvent] }).success).toBe(
      false,
    );
  });

  it("hashes exact normalized replays identically and changed payloads differently", async () => {
    const first = connectIqEventsRequestSchema.parse({ events: [setEvent] }).events[0]!;
    const reordered = connectIqEventsRequestSchema.parse({
      events: [
        {
          payload: { completed: true, rpe: 8, reps: 5, rest_seconds: 123, weight_kg: 102.5 },
          occurred_at: setEvent.occurred_at,
          type: "set.updated",
          set_id: SET_ID,
          session_id: SESSION_ID,
          event_id: "watch.event-0001",
        },
      ],
    }).events[0]!;
    const changed = connectIqEventsRequestSchema.parse({
      events: [{ ...setEvent, payload: { ...setEvent.payload, reps: 4 } }],
    }).events[0]!;
    expect(await connectIqEventHash(first)).toBe(await connectIqEventHash(reordered));
    expect(await connectIqEventHash(first)).not.toBe(await connectIqEventHash(changed));
  });

  it("requires exact event-id coverage before acknowledging a batch", () => {
    const requested = [{ event_id: "event-0001" }, { event_id: "event-0002" }];
    expect(
      hasCompleteConnectIqAckCoverage(
        requested,
        [{ event_id: "event-0001" }],
        [{ event_id: "event-0002" }],
      ),
    ).toBe(true);
    expect(hasCompleteConnectIqAckCoverage(requested, [{ event_id: "event-0001" }], [])).toBe(
      false,
    );
    expect(
      hasCompleteConnectIqAckCoverage(
        requested,
        [{ event_id: "event-0001" }],
        [{ event_id: "event-0001" }],
      ),
    ).toBe(false);
    expect(
      hasCompleteConnectIqAckCoverage(
        requested,
        [{ event_id: "event-0001" }],
        [{ event_id: "event-other" }],
      ),
    ).toBe(false);
  });
});

describe("Connect IQ active-workout ownership", () => {
  it("returns only an owned, non-sample active session and sorts exercises and sets", () => {
    const row = session();
    expect(isOwnedActiveSession(row, "user-1")).toBe(true);
    const snapshot = toConnectIqSnapshot(row, "user-1");
    expect(snapshot).toEqual({
      schema_version: 1,
      workout: expect.objectContaining({
        id: SESSION_ID,
        title: "Lower strength",
        exercises: [
          expect.objectContaining({ name: "Leg Curl", sets: [] }),
          expect.objectContaining({
            name: "Back Squat",
            sets: [
              expect.objectContaining({ set_number: 1 }),
              expect.objectContaining({ set_number: 2 }),
            ],
          }),
        ],
      }),
    });
  });

  it("withholds another user's, completed or sample session", () => {
    expect(toConnectIqSnapshot(session(), "user-2").workout).toBeNull();
    expect(toConnectIqSnapshot(session({ status: "draft" }), "user-1").workout).toBeNull();
    expect(toConnectIqSnapshot(session({ status: "completed" }), "user-1").workout).toBeNull();
    expect(toConnectIqSnapshot(session({ is_sample: true }), "user-1").workout).toBeNull();
  });

  it("accepts a normal snapshot and rejects structural watch-limit violations with 422", () => {
    expect(assertConnectIqSnapshotExecutable(toConnectIqSnapshot(session(), "user-1"))).toEqual(
      toConnectIqSnapshot(session(), "user-1"),
    );

    const invalidRpe = toConnectIqSnapshot(session(), "user-1");
    invalidRpe.workout!.exercises.find((exercise) => exercise.sets.length)!.sets[0]!.rpe = 8.25;
    expect(() => assertConnectIqSnapshotExecutable(invalidRpe)).toThrow(
      /RPE must be blank or a number from 1 to 10 in 0.5 increments/,
    );

    const titleBoundary = toConnectIqSnapshot(session(), "user-1");
    titleBoundary.workout!.title = "x".repeat(CONNECT_IQ_SNAPSHOT_LIMITS.maxTitleChars);
    expect(() => assertConnectIqSnapshotExecutable(titleBoundary)).not.toThrow();
    titleBoundary.workout!.title += "x";
    expect(() => assertConnectIqSnapshotExecutable(titleBoundary)).toThrow(
      /80 characters or fewer/,
    );

    const tooManyExercises = toConnectIqSnapshot(session(), "user-1");
    const exercise = tooManyExercises.workout!.exercises.find((item) => item.sets.length)!;
    tooManyExercises.workout!.exercises = Array.from(
      { length: CONNECT_IQ_SNAPSHOT_LIMITS.maxExercises + 1 },
      () => ({ ...exercise, sets: [] }),
    );
    expect(() => assertConnectIqSnapshotExecutable(tooManyExercises)).toThrow(
      /at most 24 exercises/,
    );

    const tooManySets = toConnectIqSnapshot(session(), "user-1");
    const set = exercise.sets[0]!;
    tooManySets.workout!.exercises[0]!.sets = Array.from(
      { length: CONNECT_IQ_SNAPSHOT_LIMITS.maxSetsPerExercise + 1 },
      (_, index) => ({ ...set, set_number: index + 1 }),
    );
    expect(() => assertConnectIqSnapshotExecutable(tooManySets)).toThrow(
      /at most 16 sets per exercise/,
    );

    const tooManyTotalSets = toConnectIqSnapshot(session(), "user-1");
    tooManyTotalSets.workout!.exercises = Array.from({ length: 4 }, (_, exerciseIndex) => ({
      ...exercise,
      id: `exercise-${exerciseIndex}`,
      sets: Array.from(
        { length: CONNECT_IQ_SNAPSHOT_LIMITS.maxSetsPerExercise },
        (_, setIndex) => ({
          ...set,
          id: `set-${exerciseIndex}-${setIndex}`,
          set_number: setIndex + 1,
        }),
      ),
    }));
    expect(() => assertConnectIqSnapshotExecutable(tooManyTotalSets)).toThrow(
      /at most 60 total sets/,
    );

    const longName = toConnectIqSnapshot(session(), "user-1");
    longName.workout!.exercises[0]!.name = "x".repeat(
      CONNECT_IQ_SNAPSHOT_LIMITS.maxExerciseNameChars + 1,
    );
    try {
      assertConnectIqSnapshotExecutable(longName);
      throw new Error("Expected the Garmin snapshot gate to reject a long exercise name.");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectIqApiError);
      expect(error).toMatchObject({ status: 422 });
    }
  });

  it("enforces the 24 KB UTF-8 response budget without truncating text", () => {
    const oversized = toConnectIqSnapshot(session(), "user-1");
    const set = oversized.workout!.exercises.find((exercise) => exercise.sets.length)!.sets[0]!;
    oversized.workout!.title = "漢".repeat(CONNECT_IQ_SNAPSHOT_LIMITS.maxTitleChars);
    oversized.workout!.focus = "漢".repeat(CONNECT_IQ_SNAPSHOT_LIMITS.maxFocusChars);
    oversized.workout!.exercises = Array.from(
      { length: CONNECT_IQ_SNAPSHOT_LIMITS.maxExercises },
      (_, exerciseIndex) => ({
        id: `exercise-${exerciseIndex}`,
        name: "漢".repeat(CONNECT_IQ_SNAPSHOT_LIMITS.maxExerciseNameChars),
        target_reps: "漢".repeat(CONNECT_IQ_SNAPSHOT_LIMITS.maxTargetRepsChars),
        rest_seconds: 60,
        load_guidance: "漢".repeat(CONNECT_IQ_SNAPSHOT_LIMITS.maxLoadGuidanceChars),
        sets: Array.from({ length: 2 }, (_, setIndex) => ({
          ...set,
          id: `set-${exerciseIndex}-${setIndex}`,
          set_number: setIndex + 1,
        })),
      }),
    );

    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(
      CONNECT_IQ_SNAPSHOT_LIMITS.maxUtf8Bytes,
    );
    expect(() => assertConnectIqSnapshotExecutable(oversized)).toThrow(/24 KB storage budget/);
  });
});

describe("Connect IQ database hardening", () => {
  const migration = readdirSync(join(process.cwd(), "supabase/migrations"))
    .filter((name) => name.endsWith("_connect_iq_workout_events.sql"))
    .map((name) => readFileSync(join(process.cwd(), "supabase/migrations", name), "utf8"))
    .join("\n");

  it("keeps receipts service-role-only behind RLS", () => {
    expect(migration).toContain(
      "alter table public.connect_iq_event_receipts enable row level security",
    );
    expect(migration).toContain(
      "revoke all on table public.connect_iq_event_receipts from PUBLIC, anon, authenticated",
    );
    expect(migration).toContain(
      "grant all on table public.connect_iq_event_receipts to service_role",
    );
  });

  it("purpose-binds pairing and revokes both RPCs from public clients", () => {
    expect(migration).toContain("_pair.platform <> _platform");
    expect(migration).toContain("_platform = 'android' and _data_source_type = 'health_connect'");
    expect(migration).toContain("device_links_platform_check");
    expect(migration).toMatch(/exchange_device_pairing[\s\S]*security invoker/i);
    expect(migration).toMatch(/apply_connect_iq_event[\s\S]*security invoker/i);
    expect(migration).toContain("from PUBLIC, anon, authenticated");
  });

  it("checks device, user, session and set ownership inside the transactional event RPC", () => {
    expect(migration).toContain("d.id = _device_id");
    expect(migration).toContain("d.user_id = _user_id");
    expect(migration).toContain("d.platform = 'connect_iq'");
    expect(migration).toContain("s.id = _session_id and s.user_id = _user_id and not s.is_sample");
    expect(migration).toContain("ws.id = _set_id");
    expect(migration).toContain("se.session_id = _session_id");
  });

  it("persists exact replay receipts and cannot start or enroll a program", () => {
    expect(migration).toContain("unique (device_id, event_id)");
    expect(migration).toContain("_receipt.request_hash <> _request_hash");
    expect(migration).toContain("jsonb_set(_receipt.response, '{replayed}', 'true'::jsonb, true)");
    expect(migration.indexOf("return jsonb_set(_receipt.response")).toBeLessThan(
      migration.indexOf("Event time is outside the accepted window"),
    );
    expect(migration).toContain("where r.user_id = _user_id");
    expect(migration).toContain("(user_id, set_id, event_type, occurred_at desc)");
    expect(migration).toContain("r.response @> '{\"applied\": true}'::jsonb");
    expect(migration).toContain("_set.updated_at > coalesce(_latest_set_receipt_created");
    expect(migration).toContain("'newer_web_edit'");
    expect(migration.match(/if _session\.status <> 'active'/g)).toHaveLength(2);
    expect(migration).toContain("if _occurred_at < _session.started_at");
    expect(migration).not.toMatch(/start_(assigned|library)_workout|enroll_in_program/i);
  });
});
