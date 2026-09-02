import { describe, expect, it } from "vitest";

import {
  buildDashboard,
  buildProgress,
  buildRecovery,
  sessionTotals,
  toHistorySession,
} from "../src/lib/irondesk/derive";
import { fromKg, toKg } from "../src/lib/irondesk/units";
import type { ImportedDashboardActivity } from "../src/lib/irondesk/imported-data-adapter";
import type { FullSessionRow, RecoveryRow } from "../src/lib/irondesk/rows";

function session(startedAt: string, withSet = true): FullSessionRow {
  const completedAt = new Date(Date.parse(startedAt) + 60 * 60_000).toISOString();
  return {
    id: `session-${startedAt}`,
    title: "Test session",
    kind: "strength",
    focus: null,
    status: "completed",
    started_at: startedAt,
    completed_at: completedAt,
    notes: null,
    perceived_effort: null,
    calories: null,
    avg_hr: null,
    max_hr: null,
    cardio_load: null,
    active_zone_minutes: null,
    session_exercises: withSet
      ? [
          {
            id: `exercise-${startedAt}`,
            exercise_id: null,
            original_exercise_id: null,
            exercise_name: "Squat",
            primary_muscle: "Quads",
            equipment: "Barbell",
            position: 0,
            target_sets: 1,
            target_reps: "5",
            notes: null,
            target_rpe: null,
            rest_seconds: null,
            load_guidance: null,
            source_load_unit: null,
            is_drop_set: false,
            is_heavy: false,
            workout_sets: [
              {
                id: `set-${startedAt}`,
                set_number: 1,
                weight_kg: 50,
                reps: 5,
                rpe: null,
                completed: true,
                is_warmup: false,
                rest_seconds: null,
                completed_at: completedAt,
                notes: null,
              },
            ],
          },
        ]
      : [],
  };
}

function imported(
  id: string,
  localDay: string,
  kind: ImportedDashboardActivity["kind"],
): ImportedDashboardActivity {
  return {
    id,
    externalId: id,
    activityType: kind,
    name: `${kind} activity`,
    kind,
    startedAt: `${localDay}T18:00:00.000Z`,
    localDay,
    sourceTimezone: "UTC",
    sourceType: "health_connect",
    sourceFileName: "device:test",
    durationSec: 1_800,
    durationMinutes: 30,
    distanceM: null,
    elevationGainM: null,
    calories: null,
    avgHr: null,
    maxHr: null,
    steps: null,
    notes: null,
  };
}

describe("analytics truthfulness", () => {
  it("preserves persisted load precision in authoritative imperial tonnage", () => {
    const workout = session("2026-08-28T17:00:00.000Z");
    workout.session_exercises[0]!.workout_sets[0]!.weight_kg = toKg(50, "imperial");

    const totals = sessionTotals(workout);

    expect(totals.tonnageKg).toBe(113.4);
    expect(fromKg(totals.tonnageKg, "imperial")).toBe(250);
  });

  it("averages only valid non-null RPE values from completed working sets", () => {
    const workout = session("2026-08-28T17:00:00.000Z");
    const original = workout.session_exercises[0]!.workout_sets[0]!;
    workout.session_exercises[0]!.workout_sets = [
      { ...original, id: "valid-rpe", rpe: 8 },
      { ...original, id: "blank-rpe", rpe: null },
      { ...original, id: "high-rpe", rpe: 11.5 },
      { ...original, id: "fraction-rpe", rpe: 8.25 },
      { ...original, id: "nan-rpe", rpe: Number.NaN },
      { ...original, id: "warmup-rpe", rpe: 10, is_warmup: true },
      { ...original, id: "incomplete-rpe", rpe: 10, completed: false },
    ];

    expect(sessionTotals(workout).avgRpe).toBe(8);
  });

  it("does not call a session Light when no RPE was recorded or count an empty session", () => {
    const empty = session("2026-08-28T17:00:00.000Z", false);
    expect(toHistorySession(empty).intensityAvailable).toBe(false);

    const day = buildDashboard({
      todaySessions: [empty],
      weekSessions: [empty],
      todayCardio: [],
      weekCardio: [],
      todayImported: [],
      weekImported: [],
      nutrition: null,
      recovery: null,
      preferences: null,
      displayName: "Athlete",
      dayKey: "2026-08-28",
      timeZone: "UTC",
    });
    expect(day.recentProgress[0]).toMatchObject({ label: "Training days (7d)", value: "0" });
    expect(day.dataAvailability?.strengthMetrics).toBe(false);
  });

  it("counts distinct training days and excludes mobility or unknown imports from consistency", () => {
    const run = imported("run", "2026-08-28", "cardio");
    const liftSameDay = imported("lift", "2026-08-28", "strength");
    const circuitNextDay = imported("circuit", "2026-08-27", "conditioning");
    const mobility = imported("mobility", "2026-08-26", "mobility");
    const day = buildDashboard({
      todaySessions: [],
      weekSessions: [],
      todayCardio: [],
      weekCardio: [],
      todayImported: [run, liftSameDay],
      weekImported: [run, liftSameDay, circuitNextDay, mobility],
      nutrition: null,
      recovery: null,
      preferences: null,
      displayName: "Athlete",
      dayKey: "2026-08-28",
      timeZone: "UTC",
    });
    expect(day.recentProgress[0]).toMatchObject({ label: "Training days (7d)", value: "2" });
    expect(day.grades.find((line) => line.label === "Consistency")?.note).toBe(
      "2/4 training days (7d)",
    );
  });

  it("computes real consecutive weekly streaks and ignores empty sessions", () => {
    const sessions = [
      session("2026-06-29T17:00:00.000Z"),
      session("2026-07-06T17:00:00.000Z"),
      session("2026-07-13T17:00:00.000Z"),
      session("2026-07-27T17:00:00.000Z"),
      session("2026-08-03T17:00:00.000Z"),
      session("2026-08-04T17:00:00.000Z", false),
    ];
    const progress = buildProgress([], sessions.reverse(), new Date("2026-08-05T12:00:00.000Z"));
    expect(progress.streak).toEqual({ currentWeeks: 2, bestWeeks: 3, weeksTracked: 5 });
    expect(progress.volume.map((point) => point.week)).toContain("2026-W32");
  });

  it("keeps missing recovery inputs null and never manufactures readiness guidance", () => {
    const row = {
      id: "recovery-1",
      user_id: "user-1",
      day: "2026-08-28",
      readiness: null,
      sleep_hours: null,
      sleep_efficiency_percent: null,
      resting_hr: 52,
      hrv_ms: null,
      fatigue: null,
      stress: null,
      soreness: [],
      note: null,
      source: "wearable",
      is_sample: false,
      created_at: "2026-08-28T12:00:00.000Z",
      updated_at: "2026-08-28T12:00:00.000Z",
    } satisfies RecoveryRow;
    const recovery = buildRecovery(row, [row]);
    expect(recovery).toMatchObject({
      readiness: null,
      status: "Readiness unavailable",
      sleep: { hours: null, efficiencyPercent: null },
      fatigue: null,
      stress: null,
      trend: [],
    });
    expect(recovery?.recommendation).toContain("No training recommendation");
  });
});
