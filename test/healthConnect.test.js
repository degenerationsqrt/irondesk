import assert from "node:assert/strict";
import test from "node:test";
import {
  healthConnectExerciseType,
  healthConnectWorkoutPayload,
  localDateString,
  healthSourceAppNames,
  healthSyncSummary,
  isHealthConnectWritableSession,
  mergeHealthBodyweight,
  mergeHealthSummaries,
  normalizeHealthSummary,
  recentHealthDateRange,
} from "../src/healthConnect.js";

test("completed IronDesk workouts map to stable Health Connect exercise payloads", () => {
  const session = {
    id: "workout-123",
    dayId: "Shoulders & Arms",
    startedAt: Date.parse("2026-07-29T18:00:00.000Z"),
    completedAt: Date.parse("2026-07-29T18:45:00.000Z"),
    durationMin: 45,
    entries: [
      { ex: "Overhead Press", sets: [{ w: 95, r: 8 }, { w: 95, r: 8 }] },
      { ex: "Lateral Raise", sets: [{ w: 20, r: 12 }] },
    ],
    volume: 2480,
  };

  assert.deepEqual(healthConnectWorkoutPayload(session), {
    clientRecordId: "irondesk:workout-123",
    clientRecordVersion: Date.parse("2026-07-29T18:45:00.000Z"),
    title: "Shoulders & Arms",
    notes: "Logged in IronDesk · 2 exercises · 3 logged sets · 2,480 lb volume",
    exerciseType: "strengthTraining",
    startTime: "2026-07-29T18:00:00.000Z",
    endTime: "2026-07-29T18:45:00.000Z",
  });
});

test("Health Connect writeback preserves ISO timestamps from restored history", () => {
  const payload = healthConnectWorkoutPayload({
    id: "restored-workout",
    dayId: "Restored Workout",
    startedAt: "2026-07-29T18:00:00.000Z",
    completedAt: "2026-07-29T18:45:00.000Z",
    durationMin: 45,
    entries: [],
  });

  assert.equal(payload.startTime, "2026-07-29T18:00:00.000Z");
  assert.equal(payload.endTime, "2026-07-29T18:45:00.000Z");
  assert.equal(payload.clientRecordVersion, Date.parse("2026-07-29T18:45:00.000Z"));
});

test("guided session types use matching Health Connect exercise categories", () => {
  assert.equal(healthConnectExerciseType({ sessionType: "hiit" }), "hiit");
  assert.equal(healthConnectExerciseType({ sessionType: "vo2" }), "hiit");
  assert.equal(healthConnectExerciseType({ sessionType: "mma" }), "martialArts");
  assert.equal(healthConnectExerciseType({ sessionType: "pilates" }), "pilates");
  assert.equal(healthConnectExerciseType({ sessionType: "yoga" }), "yoga");
  assert.equal(healthConnectExerciseType({ sessionType: "core" }), "calisthenics");
});

test("imported Garmin sessions are never written back to Health Connect", () => {
  assert.equal(isHealthConnectWritableSession({ id: "local" }), true);
  assert.equal(isHealthConnectWritableSession({ id: "garmin", source: "garmin" }), false);
  assert.equal(healthConnectWorkoutPayload({ id: "garmin", source: "garmin" }), null);
});

test("Health Connect summaries normalize into stable daily records", () => {
  const normalized = normalizeHealthSummary({
    date: "2026-07-27",
    steps: 1234.4,
    weightLb: 220.46,
    vo2Max: 42.84,
    sourcePackages: ["com.garmin.android.apps.connectmobile", "com.garmin.android.apps.connectmobile"],
  }, "2026-07-27T12:00:00.000Z");

  assert.equal(normalized.id, "health-connect:2026-07-27");
  assert.equal(normalized.steps, 1234);
  assert.equal(normalized.weightLb, 220.5);
  assert.equal(normalized.vo2Max, 42.8);
  assert.deepEqual(normalized.sourcePackages, ["com.garmin.android.apps.connectmobile"]);
  assert.equal(normalizeHealthSummary({ date: "bad" }), null);
});

test("new Health Connect reads replace the same day without duplicating it", () => {
  const merged = mergeHealthSummaries(
    [
      { date: "2026-07-26", steps: 5000, importedAt: "old" },
      { date: "2026-07-25", steps: 4000, importedAt: "old" },
    ],
    [
      { date: "2026-07-26", steps: 7000 },
      { date: "2026-07-27", steps: 8000 },
    ],
    "new",
  );

  assert.deepEqual(merged.map(record => record.date), [
    "2026-07-27",
    "2026-07-26",
    "2026-07-25",
  ]);
  assert.equal(merged.find(record => record.date === "2026-07-26").steps, 7000);
});

test("partial Health Connect sync keeps previously imported categories", () => {
  const [merged] = mergeHealthSummaries(
    [{
      date: "2026-07-27",
      steps: 7000,
      weightLb: 219.5,
      vo2Max: 42.8,
      sourcePackages: ["com.garmin.connect"],
      importedAt: "old",
    }],
    [{
      date: "2026-07-27",
      steps: 8000,
      sourcePackages: ["com.google.android.apps.healthdata"],
    }],
    "new",
  );

  assert.equal(merged.steps, 8000);
  assert.equal(merged.weightLb, 219.5);
  assert.equal(merged.vo2Max, 42.8);
  assert.deepEqual(merged.sourcePackages, [
    "com.garmin.connect",
    "com.google.android.apps.healthdata",
  ]);
});

test("Health Connect bodyweight does not overwrite a manual entry", () => {
  const merged = mergeHealthBodyweight(
    [
      { id: "manual", date: "2026-07-27", weight: 219 },
      {
        id: "health-connect-weight:2026-07-26",
        date: "2026-07-26",
        weight: 220,
        source: "health-connect",
      },
    ],
    [
      { date: "2026-07-27", weightLb: 221, bodyFat: 18 },
      { date: "2026-07-26", weightLb: 219.4, bodyFat: 17.5 },
    ],
  );

  assert.equal(merged.find(entry => entry.date === "2026-07-27").weight, 219);
  assert.equal(merged.find(entry => entry.date === "2026-07-26").weight, 219.4);
  assert.equal(merged.find(entry => entry.date === "2026-07-26").bf, 17.5);
  assert.deepEqual(merged.map(entry => entry.date), ["2026-07-27", "2026-07-26"]);
});

test("recent Health Connect range is local and inclusive", () => {
  const now = new Date(2026, 6, 27, 12, 0, 0);
  assert.equal(localDateString(now), "2026-07-27");
  assert.deepEqual(recentHealthDateRange(7, now), {
    startDate: "2026-07-21",
    endDate: "2026-07-27",
  });
});

test("Health Connect sync reports actual records instead of empty calendar days", () => {
  assert.deepEqual(healthSyncSummary([
    {
      date: "2026-07-27",
      steps: 8000,
      restingHeartRate: 54,
      sourcePackages: ["com.garmin.connect"],
    },
    {
      date: "2026-07-28",
      sourcePackages: [],
    },
  ]), {
    daysRead: 2,
    populatedDays: 1,
    metricCount: 2,
    sourcePackages: ["com.garmin.connect"],
  });
});

test("Health Connect source packages identify Samsung and Garmin routes", () => {
  assert.deepEqual(healthSourceAppNames([
    {
      sourcePackages: [
        "com.sec.android.app.shealth",
        "com.garmin.android.apps.connectmobile",
      ],
    },
    { sourcePackages: ["com.sec.android.app.shealth"] },
  ]), ["Samsung Health", "Garmin Connect"]);
});
