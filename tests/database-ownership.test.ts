import type { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase } from "./helpers/database";

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const sources = [randomUUID(), randomUUID()];
const jobs = [randomUUID(), randomUUID()];
const sessions = [randomUUID(), randomUUID()];
let db: PGlite;

beforeAll(async () => {
  // The repository currently lacks the initial program-schema migration, so a
  // complete historical replay is not yet possible. Execute the exact affected
  // schema and policies rather than inventing substitutes for the missing DDL.
  db = await createTestDatabase([
    "20260826041747_7f9c42e7-96c3-44c3-aeee-31151e70e83a.sql",
    "20260826041825_ebe5928f-ccbb-4aef-b4e9-730013da70fc.sql",
    "20260826041837_87ac3d94-026a-4ee4-84e8-81fe7fa6253a.sql",
    "20260826053452_2f931631-0fe1-45df-a531-bc3aba79d2d5.sql",
    "20260826053533_81d42ffc-0881-415e-a58f-bcd2d223253c.sql",
    "20260826060045_bfeea721-ad8f-4570-904b-4e758a27c64e.sql",
    "20260912061347_enforce_user_owned_parent_links.sql",
    "20260912061758_patch_recovery_entry_atomically.sql",
  ]);
  await db.query("INSERT INTO auth.users(id) VALUES ($1), ($2)", [owner, other]);
  for (const [index, user] of [owner, other].entries()) {
    await db.query(
      "INSERT INTO public.data_sources(id, user_id, source_type, label) VALUES ($1, $2, 'generic_file', 'Test import')",
      [sources[index], user],
    );
    await db.query(
      "INSERT INTO public.import_jobs(id, user_id, data_source_id, source_type, file_format) VALUES ($1, $2, $3, 'generic_file', 'json')",
      [jobs[index], user, sources[index]],
    );
    await db.query(
      "INSERT INTO public.workout_sessions(id, user_id, status, title) VALUES ($1, $2, 'completed', 'Test session')",
      [sessions[index], user],
    );
  }
}, 30_000);

beforeEach(async () => {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
  await db.exec("SET ROLE authenticated");
});
afterAll(async () => {
  await db?.close();
});

const cases = [
  {
    table: "import_jobs",
    parent: "data_source_id",
    ids: sources,
    extraColumns: "source_type, file_format",
    extraValues: "'generic_file', 'json'",
  },
  {
    table: "imported_activities",
    parent: "import_job_id",
    ids: jobs,
    extraColumns: "source_type, dedupe_hash, activity_type, started_at",
    extraValues: "'generic_file', gen_random_uuid()::text, 'running', now()",
  },
  {
    table: "health_metrics",
    parent: "import_job_id",
    ids: jobs,
    extraColumns: "source_type, dedupe_hash, metric_type, recorded_at, value, unit",
    extraValues: "'health_connect', gen_random_uuid()::text, 'steps', now(), 100, 'count'",
  },
  {
    table: "cardio_sessions",
    parent: "session_id",
    ids: sessions,
    extraColumns: "name",
    extraValues: "'Test cardio'",
  },
] as const;

for (const testCase of cases) {
  const { table, parent, ids, extraColumns, extraValues } = testCase;
  async function insert(parentId: string | null, userId = owner) {
    const id = randomUUID();
    await db.query(
      `INSERT INTO public.${table}(id, user_id, ${parent}, ${extraColumns}) VALUES ($1, $2, $3, ${extraValues})`,
      [id, userId, parentId],
    );
    return id;
  }

  describe(`${table} parent ownership`, () => {
    it("allows links to an owned parent and unlinked records", async () => {
      const ownedId = await insert(ids[0]!);
      const unlinkedId = await insert(null);
      const result = await db.query(`SELECT id FROM public.${table} WHERE id IN ($1, $2)`, [
        ownedId,
        unlinkedId,
      ]);
      expect(result.rows).toHaveLength(2);
    });

    it("rejects another athlete's parent on insert", async () => {
      await expect(insert(ids[1]!)).rejects.toMatchObject({ code: "42501" });
    });

    it("rejects reassignment to another athlete's parent while preserving the original link", async () => {
      const id = await insert(ids[0]!);
      await expect(
        db.query(`UPDATE public.${table} SET ${parent} = $1 WHERE id = $2`, [ids[1], id]),
      ).rejects.toMatchObject({ code: "42501" });
      const result = await db.query(`SELECT ${parent} FROM public.${table} WHERE id = $1`, [id]);
      expect(result.rows[0]).toEqual({ [parent]: ids[0] });
    });

    it("allows attaching and clearing an owned parent", async () => {
      const id = await insert(null);
      await db.query(`UPDATE public.${table} SET ${parent} = $1 WHERE id = $2`, [ids[0], id]);
      await db.query(`UPDATE public.${table} SET ${parent} = NULL WHERE id = $1`, [id]);
      const result = await db.query(`SELECT ${parent} FROM public.${table} WHERE id = $1`, [id]);
      expect(result.rows[0]).toEqual({ [parent]: null });
    });

    it("retains the existing row owner check", async () => {
      await expect(insert(ids[0]!, other)).rejects.toMatchObject({ code: "42501" });
    });

    it("retains service-role ingestion and hides the other athlete's rows", async () => {
      await db.exec("RESET ROLE; SET ROLE service_role");
      const id = await insert(ids[1]!, other);
      await db.exec("RESET ROLE; SET ROLE authenticated");
      const result = await db.query(`SELECT id FROM public.${table} WHERE id = $1`, [id]);
      expect(result.rows).toEqual([]);
      const updated = await db.query(
        `UPDATE public.${table} SET ${parent} = NULL WHERE id = $1 RETURNING id`,
        [id],
      );
      expect(updated.rows).toEqual([]);
    });
  });
}

it("enables row-level security on every public table in the tested schema", async () => {
  const result = await db.query(`
    SELECT relname FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE nspname = 'public' AND relkind = 'r' AND NOT relrowsecurity
  `);
  expect(result.rows).toEqual([]);
});

describe("atomic recovery check-ins", () => {
  async function patch(day: string, values: Record<string, unknown>) {
    return db.query("SELECT public.patch_recovery_entry($1, $2::jsonb) AS entry", [
      day,
      JSON.stringify(values),
    ]);
  }

  it("creates a real check-in scoped to auth.uid()", async () => {
    await patch("2026-09-01", { sleep_hours: 7.5, note: "Check-in" });
    const result = await db.query(
      "SELECT user_id, sleep_hours, note, is_sample, source FROM public.recovery_entries WHERE day = '2026-09-01'",
    );
    expect(result.rows[0]).toMatchObject({
      user_id: owner,
      sleep_hours: "7.50",
      note: "Check-in",
      is_sample: false,
      source: "manual",
    });
  });

  it("preserves omitted real fields and explicit zeroes across separate partial calls", async () => {
    await patch("2026-09-02", { sleep_hours: 7, resting_hr: 55, note: "Keep this" });
    await Promise.all([patch("2026-09-02", { readiness: 0 }), patch("2026-09-02", { fatigue: 4 })]);
    const result = await db.query(
      "SELECT sleep_hours, resting_hr, note, readiness, fatigue FROM public.recovery_entries WHERE day = '2026-09-02'",
    );
    expect(result.rows[0]).toMatchObject({
      sleep_hours: "7.00",
      resting_hr: 55,
      note: "Keep this",
      readiness: 0,
      fatigue: 4,
    });
    await patch("2026-09-02", { note: "" });
    const cleared = await db.query(
      "SELECT note, resting_hr FROM public.recovery_entries WHERE day = '2026-09-02'",
    );
    expect(cleared.rows[0]).toEqual({ note: null, resting_hr: 55 });
  });

  it("discards all untouched sample measurements when recording the first real field", async () => {
    await db.query(
      `INSERT INTO public.recovery_entries (
      user_id, day, sleep_hours, resting_hr, hrv_ms, readiness, fatigue, stress,
      sleep_efficiency_percent, soreness, note, is_sample
    ) VALUES ($1, '2026-09-03', 8, 50, 65, 90, 2, 2, 98, '[{"region":"legs"}]', 'Example note', true)`,
      [owner],
    );
    await patch("2026-09-03", { readiness: 72 });
    const result =
      await db.query(`SELECT sleep_hours, resting_hr, hrv_ms, readiness, fatigue, stress,
      sleep_efficiency_percent, soreness, note, is_sample FROM public.recovery_entries WHERE day = '2026-09-03'`);
    expect(result.rows[0]).toEqual({
      sleep_hours: null,
      resting_hr: null,
      hrv_ms: null,
      readiness: 72,
      fatigue: null,
      stress: null,
      sleep_efficiency_percent: null,
      soreness: [],
      note: null,
      is_sample: false,
    });
  });

  it("does not clear real soreness or sleep efficiency during a partial check-in", async () => {
    await db.query(
      `INSERT INTO public.recovery_entries (user_id, day, sleep_efficiency_percent, soreness)
      VALUES ($1, '2026-09-04', 91, '[{"region":"legs"}]')`,
      [owner],
    );
    await patch("2026-09-04", { stress: 3 });
    const result = await db.query(
      "SELECT sleep_efficiency_percent, soreness FROM public.recovery_entries WHERE day = '2026-09-04'",
    );
    expect(result.rows[0]).toEqual({
      sleep_efficiency_percent: 91,
      soreness: [{ region: "legs" }],
    });
  });

  it("keeps another athlete's check-in unchanged for the same day", async () => {
    await db.exec("RESET ROLE");
    await db.query(
      "INSERT INTO public.recovery_entries(user_id, day, readiness) VALUES ($1, '2026-09-05', 88)",
      [other],
    );
    await db.exec("SET ROLE authenticated");
    await patch("2026-09-05", { readiness: 35 });
    await db.exec("RESET ROLE");
    const result = await db.query(
      "SELECT readiness FROM public.recovery_entries WHERE user_id = $1 AND day = '2026-09-05'",
      [other],
    );
    expect(result.rows[0]).toEqual({ readiness: 88 });
  });

  it.each([
    {},
    { user_id: other },
    { is_sample: true },
    { readiness: "80" },
    { note: 12 },
    { note: "x".repeat(501) },
  ])("rejects malformed or identity-changing patches: %j", async (values) => {
    await expect(patch("2026-09-06", values)).rejects.toMatchObject({ code: "22023" });
  });

  it("enforces measurement constraints without corrupting an existing check-in", async () => {
    await patch("2026-09-07", { readiness: 60, resting_hr: 55 });
    await expect(patch("2026-09-07", { resting_hr: 220 })).rejects.toMatchObject({ code: "23514" });
    const result = await db.query(
      "SELECT resting_hr FROM public.recovery_entries WHERE day = '2026-09-07'",
    );
    expect(result.rows[0]).toEqual({ resting_hr: 55 });
  });

  it("denies anonymous execution and unauthenticated role impersonation", async () => {
    await db.exec("RESET ROLE; SET ROLE anon");
    await expect(patch("2026-09-08", { readiness: 60 })).rejects.toMatchObject({ code: "42501" });
    await db.exec("RESET ROLE");
    await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
    await db.exec("SET ROLE authenticated");
    await expect(patch("2026-09-08", { readiness: 60 })).rejects.toMatchObject({ code: "42501" });
  });
});
