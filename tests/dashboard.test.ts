import { describe, expect, it } from "vitest";

import { buildDashboard } from "../src/lib/irondesk/derive";
import type { ImportedDashboardActivity } from "../src/lib/irondesk/imported-data-adapter";
import type { FullSessionRow } from "../src/lib/irondesk/rows";

const importedRun: ImportedDashboardActivity = {
  id: "run-1",
  externalId: "hc-run-1",
  activityType: "running",
  name: "Evening run",
  kind: "cardio",
  startedAt: "2026-08-29T01:30:00.000Z",
  localDay: "2026-08-28",
  sourceTimezone: "America/Los_Angeles",
  sourceType: "health_connect",
  sourceFileName: "device:phone",
  durationSec: 3_600,
  durationMinutes: 60,
  distanceM: 8_000,
  elevationGainM: null,
  calories: 431,
  avgHr: 148,
  maxHr: 172,
  steps: 8_900,
  notes: null,
};

describe("dashboard evidence handling", () => {
  it("makes an imported-only day visible without fabricating zones, load, or BMR", () => {
    const day = buildDashboard({
      todaySessions: [],
      weekSessions: [],
      todayCardio: [],
      weekCardio: [],
      todayImported: [importedRun],
      weekImported: [importedRun],
      nutrition: null,
      recovery: null,
      preferences: null,
      displayName: "Athlete",
      dayKey: "2026-08-28",
      timeZone: "America/Los_Angeles",
    });

    expect(day.date).toBe("Friday, August 28");
    expect(day.sessions).toHaveLength(1);
    expect(day.sessions[0]).toMatchObject({
      source: "health_connect",
      sourceLabel: "Health Connect",
      durationMin: 60,
      calories: 431,
      avgHr: 148,
      cardioLoad: null,
      activeZoneMinutes: null,
      zones: [],
    });
    expect(day.avgHr).toBe(148);
    expect(day.energy).toMatchObject({
      exerciseBurn: 431,
      bmr: null,
      net: null,
      status: "unavailable",
    });
    expect(day.dataAvailability).toMatchObject({ cardio: true, heartRateZones: false });
    expect(day.dataAvailability).toMatchObject({ strengthMetrics: false, measuredStrain: false });
    expect(day.strain.total).toBe(0);
    expect(day.recentProgress[0]).toMatchObject({ label: "Training days (7d)", value: "1" });
    expect(day.grades.find((line) => line.label === "Cardio")).toMatchObject({
      available: false,
      note: "Activity logged; load unavailable",
    });
  });

  it("normalizes maximum measured strain to 21 and keeps its grade aligned with IronScore", () => {
    const loadedSession: FullSessionRow = {
      id: "session-1",
      title: "Measured session",
      kind: "strength",
      focus: null,
      status: "completed",
      started_at: "2026-08-28T17:00:00.000Z",
      completed_at: "2026-08-28T18:00:00.000Z",
      notes: null,
      perceived_effort: null,
      calories: null,
      avg_hr: null,
      max_hr: null,
      cardio_load: 240,
      active_zone_minutes: null,
      session_exercises: [
        {
          id: "exercise-1",
          exercise_id: null,
          original_exercise_id: null,
          exercise_name: "Heavy sled",
          primary_muscle: "Legs",
          equipment: null,
          position: 0,
          target_sets: 1,
          target_reps: "10",
          notes: null,
          target_rpe: null,
          rest_seconds: null,
          load_guidance: null,
          source_load_unit: null,
          is_drop_set: false,
          is_heavy: true,
          workout_sets: [
            {
              id: "set-1",
              set_number: 1,
              weight_kg: 1_000,
              reps: 10,
              rpe: null,
              completed: true,
              is_warmup: false,
              rest_seconds: null,
              completed_at: "2026-08-28T17:30:00.000Z",
              notes: null,
            },
          ],
        },
      ],
    };
    const day = buildDashboard({
      todaySessions: [loadedSession],
      weekSessions: [loadedSession],
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

    expect(day.strain.total).toBe(21);
    expect(day.strain.interpretation).toContain("Very high");
    expect(day.grade).toBe("B-");
    expect(day.ironScore).toBe(74);
  });
});
