import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260902073743_534f7588-3593-4eca-b7e8-5f19e8074d61.sql",
  ),
  "utf8",
);

function functionBody(name: string): string {
  const start = migration.indexOf(`FUNCTION public.${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = migration.indexOf("$function$;", start);
  expect(end, name).toBeGreaterThan(start);
  return migration.slice(start, end);
}

describe("workout terminal transition migration", () => {
  const body = functionBody("transition_workout_session_terminal");

  it("runs as the authenticated invoker under the existing RLS policies", () => {
    expect(body).toContain("SECURITY INVOKER");
    expect(body).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(body).toContain("_uid uuid := auth.uid()");
    expect(body).toContain("s.user_id = _uid");
    expect(body).not.toContain("SECURITY DEFINER");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.transition_workout_session_terminal\([\s\S]*?\) FROM PUBLIC, anon;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.transition_workout_session_terminal\([\s\S]*?\) TO authenticated;/,
    );
  });

  it("locks the row and acknowledges same-terminal retries without rewriting time", () => {
    expect(body).toContain("FOR UPDATE");
    const replay = body.indexOf("IF _session.status = _terminal_status THEN");
    const update = body.indexOf("UPDATE public.workout_sessions");
    expect(replay).toBeGreaterThan(-1);
    expect(replay).toBeLessThan(update);
    expect(body.slice(replay, update)).toContain("'completed_at', _session.completed_at");
    expect(body.slice(replay, update)).toContain("'replayed', true");
    expect(body.slice(replay, update)).toContain(
      "'requires_timestamp_repair', _session.completed_at IS NULL",
    );
    expect(body.indexOf("IF _completed_at IS NULL")).toBeGreaterThan(replay);
  });

  it("requires an explicit flag for cancelled-to-completed recovery", () => {
    expect(body).toContain("_allow_cancelled_recovery boolean DEFAULT false");
    expect(body).toMatch(
      /_session\.status = 'cancelled'[\s\S]*?_terminal_status = 'completed'[\s\S]*?_allow_cancelled_recovery/,
    );
    expect(body).toContain("RAISE EXCEPTION 'workout_terminal_conflict'");
    expect(body).toContain("'requested', _terminal_status");
    expect(body).toContain("'actual', _session.status");
  });
});

describe("atomic IronDesk Black application migration", () => {
  const body = functionBody("apply_irondesk_black_plan");

  it("is an authenticated SECURITY INVOKER function with a locked search path", () => {
    expect(body).toContain("SECURITY INVOKER");
    expect(body).toContain("SET search_path TO 'public', 'pg_temp'");
    expect(body).toContain("_uid uuid := auth.uid()");
    expect(body).not.toMatch(/_user_id\s+uuid/);
    expect(body).not.toContain("SECURITY DEFINER");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.apply_irondesk_black_plan\([\s\S]*?\) FROM PUBLIC, anon;/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.apply_irondesk_black_plan\([\s\S]*?\) TO authenticated;/,
    );
  });

  it("checks ownership, active state, window dates, and the saved prescription", () => {
    expect(body).toMatch(/workout_sessions[\s\S]*?s\.user_id = _uid[\s\S]*?FOR UPDATE/);
    expect(body).toContain("IF _session.status <> 'active'");
    expect(body).toMatch(
      /training_specialization_windows[\s\S]*?w\.user_id = _uid[\s\S]*?w\.method_id = 'irondesk-black'/,
    );
    expect(body).toContain("IF _window.status <> 'active'");
    expect(body).toContain("NOT BETWEEN _window.started_on AND _window.ends_on");
    expect(body).toContain("_window.config -> 'prescriptions'");
    expect(body).toContain("<> _prescriptions");
  });

  it("serializes exact retries before checking mutable workout/window state", () => {
    const applicationLock = body.indexOf(
      "pg_advisory_xact_lock(hashtextextended(_application_id::text",
    );
    const replayLookup = body.indexOf("WHERE e.id = _application_id");
    const workoutLookup = body.indexOf("FROM public.workout_sessions AS s");
    expect(applicationLock).toBeGreaterThan(-1);
    expect(replayLookup).toBeGreaterThan(applicationLock);
    expect(workoutLookup).toBeGreaterThan(replayLookup);
    expect(body).toContain("_existing_application.prescription -> 'application' = _request");
    expect(body).toContain("'replayed', true");
    expect(body).toContain("RAISE EXCEPTION 'black_application_id_conflict'");
    expect(body).toMatch(/black_application_id_conflict'[\s\S]*?ERRCODE = 'P0001'/);
  });

  it("uses advisory locks without requiring forbidden exposure UPDATE privileges", () => {
    const applicationRead = body.slice(
      body.indexOf("SELECT e.* INTO _existing_application"),
      body.indexOf("IF FOUND THEN", body.indexOf("SELECT e.* INTO _existing_application")),
    );
    const weeklyRead = body.slice(
      body.indexOf("FROM public.black_exposures AS e", body.indexOf("73192")),
      body.indexOf("IF FOUND THEN", body.indexOf("73192")),
    );
    expect(applicationRead).not.toContain("FOR UPDATE");
    expect(weeklyRead).not.toContain("FOR UPDATE");
    expect(body.match(/pg_advisory_xact_lock/g)).toHaveLength(2);
  });

  it("enforces stable ids and one atomic exposure per normalized region/week", () => {
    expect(body).toContain("_application_id, _uid, _window_id, _session_id");
    expect(body).toContain("(_target ->> 'sessionExerciseId')::uuid");
    expect(body).toContain("_set_id := (_set ->> 'id')::uuid");
    expect(body).toContain("_set_id = ANY(_seen_set_ids)");
    expect(body).toContain("_set_number = ANY(_seen_set_numbers)");
    expect(body).toContain("hashtextextended(_uid::text || ':' || _canonical_region");
    expect(body).toContain("INSERT INTO public.black_exposures");
    expect(body).toContain("jsonb_build_object('application', _request)");
  });

  it("normalizes repeated and trailing whitespace before region uniqueness checks", () => {
    expect(body.split("'[[:space:]]+'").length - 1).toBe(4);
    expect(body).not.toContain("'\\s+'");
    expect(body).toContain(
      "lower(regexp_replace(trim(e.target_region), '[[:space:]]+', ' ', 'g')) = _canonical_region",
    );
  });

  it("validates every set value at the server boundary", () => {
    expect(body).toContain("_weight_kg < 0 OR _weight_kg > 1000");
    expect(body).toContain("trunc(_reps) <> _reps OR _reps < 0 OR _reps > 500");
    expect(body).toContain("_rpe < 1 OR _rpe > 10 OR mod(_rpe * 2, 1) <> 0");
    expect(body).toContain(
      "trunc(_rest_seconds) <> _rest_seconds OR _rest_seconds < 0 OR _rest_seconds > 3600",
    );
    expect(body).toContain("_segment_config ->> 'methodId' <> 'irondesk-black'");
    expect(body).toContain("_segment_config ->> 'blackWindowId' <> _window_id::text");
  });

  it("matches each target to exactly one saved prescription", () => {
    expect(body).toContain("_prescription_ordinal = ANY(_matched_prescriptions)");
    expect(body).toContain("array_append(_matched_prescriptions, _prescription_ordinal)");
    expect(body).toContain(
      "cardinality(_matched_prescriptions) <> jsonb_array_length(_prescriptions)",
    );
  });
});
