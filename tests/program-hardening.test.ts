import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static assertions over the shipped migrations and repository code. These
 * guard the security invariants of the assigned-program lifecycle: clients may
 * only read enrollments/schedules, and every mutation goes through a
 * SECURITY DEFINER RPC with a locked search_path.
 */
const migrationsDir = join(process.cwd(), "supabase/migrations");
const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"));
const sql = migrations.join("\n");
// Pinned by content, not position: later migrations are appended over time.
const hardening = migrations.find((m) =>
  m.includes("DROP POLICY IF EXISTS program_enrollments_insert_own"),
)!;

const LIFECYCLE = [
  "enroll_in_program",
  "pause_program_enrollment",
  "resume_program_enrollment",
  "skip_current_program_workout",
  "start_assigned_workout",
];

describe("assigned-program lifecycle hardening migration", () => {
  it("drops every client mutation policy on enrollments and schedules", () => {
    for (const policy of [
      "program_enrollments_insert_own",
      "program_enrollments_update_own",
      "program_enrollments_delete_own",
      "scheduled_workouts_insert_own",
      "scheduled_workouts_update_own",
      "scheduled_workouts_delete_own",
    ]) {
      expect(hardening).toContain(`DROP POLICY IF EXISTS ${policy}`);
    }
  });

  it("revokes direct writes and anon access on both private tables", () => {
    expect(hardening).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON public\.program_enrollments FROM authenticated, anon;/,
    );
    expect(hardening).toMatch(
      /REVOKE INSERT, UPDATE, DELETE ON public\.scheduled_workouts FROM authenticated, anon;/,
    );
    expect(hardening).toContain("REVOKE ALL ON public.program_enrollments FROM anon;");
    expect(hardening).toContain("REVOKE ALL ON public.scheduled_workouts FROM anon;");
  });

  it("declares all five lifecycle RPCs as SECURITY DEFINER with a locked search_path", () => {
    for (const fn of LIFECYCLE) {
      const idx = hardening.indexOf(`FUNCTION public.${fn}(`);
      expect(idx, fn).toBeGreaterThan(-1);
      const body = hardening.slice(idx, idx + 400);
      expect(body, fn).toContain("SECURITY DEFINER");
      expect(body, fn).toContain("SET search_path TO 'public', 'pg_temp'");
    }
  });

  it("derives identity only from auth.uid() in every lifecycle RPC", () => {
    for (const fn of LIFECYCLE) {
      const idx = hardening.indexOf(`FUNCTION public.${fn}(`);
      const end = hardening.indexOf("$function$;", idx);
      const body = hardening.slice(idx, end);
      expect(body, fn).toContain("_uid uuid := auth.uid()");
      expect(body, fn).toContain("Authentication required");
      expect(body, fn).not.toMatch(/_user_id\s+uuid/);
    }
  });

  it("restricts execute to authenticated and revokes PUBLIC/anon", () => {
    for (const fn of LIFECYCLE) {
      expect(hardening).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
      expect(hardening).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated;`));
    }
    expect(hardening).toContain(
      "REVOKE ALL ON FUNCTION public.enforce_session_start_policy() FROM PUBLIC, anon, authenticated;",
    );
    expect(hardening).toContain(
      "REVOKE ALL ON FUNCTION irondesk_internal.handle_assigned_session_status() FROM PUBLIC, anon, authenticated;",
    );
  });

  it("removes the tautological schedule template checks", () => {
    expect(hardening).not.toContain("pw.template_id = pw.template_id");
  });

  it("writes the skip reason server-side, trimmed and bounded", () => {
    expect(hardening).toContain("_reason text DEFAULT NULL::text");
    expect(hardening).toContain("left(btrim(coalesce(_reason,'')), 500)");
    expect(hardening).toContain("'skippedBy', 'athlete'");
  });

  it("makes assigned session linkage RPC-only and immutable", () => {
    expect(hardening).toContain("irondesk.assigned_schedule_id");
    expect(hardening).toContain("Assigned workouts can only be started through start_assigned_workout()");
    expect(hardening).toContain("Assigned workout linkage cannot be changed");
    expect(hardening).toContain("workout_sessions_link_immutable");
  });

  it("keeps assignment-only templates out of free training", () => {
    expect(hardening).toContain(
      "This template can only be started through an acknowledged program assignment",
    );
  });

  it("refuses to pause while a workout is live", () => {
    const idx = hardening.indexOf("FUNCTION public.pause_program_enrollment(");
    const body = hardening.slice(idx, hardening.indexOf("$function$;", idx));
    expect(body).toContain("status in ('active','draft')");
    expect(body).toContain("before pausing this program");
  });

  it("drops the duplicate session-completion handler", () => {
    expect(hardening).toContain("DROP TRIGGER IF EXISTS workout_sessions_sync_schedule");
    expect(hardening).toContain("DROP FUNCTION IF EXISTS public.sync_assigned_session_status()");
  });

  it("does not touch program or template source content", () => {
    expect(hardening).not.toMatch(/INSERT INTO public\.(template_exercises|program_workouts|programs)/i);
    expect(hardening).not.toMatch(/DELETE FROM public\.(template_exercises|program_workouts|programs)/i);
  });

  it("never drops the program or enrollment tables", () => {
    expect(sql).not.toMatch(/DROP TABLE[^\n]*(program_enrollments|scheduled_workouts|programs|workout_templates)/i);
  });
});

describe("program repository", () => {
  const repo = readFileSync(join(process.cwd(), "src/lib/irondesk/programs.ts"), "utf8");

  it("never writes to enrollments or schedules directly", () => {
    expect(repo).not.toMatch(/from\("scheduled_workouts"\)\s*\.\s*(update|insert|delete)/);
    expect(repo).not.toMatch(/from\("program_enrollments"\)\s*\.\s*(update|insert|delete)/);
  });

  it("passes the skip reason to the RPC", () => {
    expect(repo).toContain("_reason: clean");
  });
});
