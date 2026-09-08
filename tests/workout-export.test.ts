import { describe, expect, it, vi } from "vitest";

import {
  exportSession,
  handleWorkoutExport,
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
  const from = vi.fn((table: string) => (table === "device_links" ? lookup : query));
  return { admin: { from } as unknown as Parameters<typeof handleWorkoutExport>[1], query, from };
}

function request(target = url, auth: string | null = token) {
  return new Request(target, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
}

describe("completed workout export", () => {
  it("uses only device ownership, completed non-sample rows, and private no-store responses", async () => {
    const { admin, query } = await db();
    const response = await handleWorkoutExport(request(), admin, now);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(query.eq.mock.calls).toEqual([
      ["user_id", "owner-from-token"],
      ["status", "completed"],
      ["is_sample", false],
    ]);
    expect(query.gte).toHaveBeenCalledWith("completed_at", "2026-08-09T12:00:00Z");
    const payload = await response.json();
    expect(payload.workouts[0]).toMatchObject({
      id: row.id,
      start_time: "2026-09-07T17:00:00.000Z",
      client_record_version: Date.parse(row.updated_at),
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
    for (const options of [{ lookupError: true }, { queryError: true }]) {
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
