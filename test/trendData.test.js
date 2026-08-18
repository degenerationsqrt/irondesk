import assert from "node:assert/strict";
import test from "node:test";
import {
  garminSessionsToCardioRecords,
  healthTrendSeries,
  latestHealthValue,
  mergeCardioTrendRecords,
  normalizeCardioType,
  weekStartKey,
} from "../src/trendData.js";

test("Garmin endurance sessions become cardio trend records", () => {
  const records = garminSessionsToCardioRecords([
    {
      id: "run-1",
      source: "garmin",
      sourceKey: "garmin:activity:1",
      date: "2026-07-27",
      dayId: "Morning Run",
      durationMin: 30,
      garmin: {
        activityType: "Running",
        distanceMeters: 5000,
        calories: 420,
        avgHeartRate: 148,
        vo2Max: 42.8,
      },
    },
    {
      id: "lift-1",
      source: "garmin",
      date: "2026-07-26",
      dayId: "Strength Training",
      durationMin: 45,
      garmin: { activityType: "Strength Training" },
    },
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].type, "run");
  assert.equal(records[0].miles, 3.11);
  assert.equal(records[0].vo2Max, 42.8);
});

test("manual and Garmin cardio share a normalized trend without duplication", () => {
  const merged = mergeCardioTrendRecords(
    [{ id: "manual", date: "2026-07-26", type: "Bike", minutes: 20 }],
    [{
      id: "garmin",
      source: "garmin",
      date: "2026-07-27",
      durationMin: 30,
      garmin: { activityType: "Cycling" },
    }],
  );

  assert.deepEqual(merged.map(record => record.type), ["ride", "ride"]);
  assert.equal(normalizeCardioType("Incline Walk"), "other");
});

test("cardio classification does not reject endurance workouts titled training", () => {
  const records = garminSessionsToCardioRecords([{
    id: "marathon",
    source: "garmin",
    date: "2026-07-27",
    dayId: "Marathon Training Run",
    durationMin: 45,
    garmin: { activityType: "Running" },
  }]);
  assert.equal(records.length, 1);
  assert.equal(records[0].type, "run");
});

test("generic Garmin training with recorded sets stays out of cardio trends", () => {
  const records = garminSessionsToCardioRecords([{
    id: "strength",
    source: "garmin",
    date: "2026-07-27",
    dayId: "Garmin Training",
    durationMin: 45,
    entries: [{ ex: "Squat", sets: [{ w: 225, r: 5 }] }],
    garmin: { activityType: "Training" },
  }]);
  assert.equal(records.length, 0);
});

test("weekly grouping uses local calendar dates and retains the year", () => {
  assert.equal(weekStartKey("2026-01-01"), "2025-12-28");
  assert.equal(weekStartKey("bad"), "");
});

test("Health Connect values become chronological metric series", () => {
  const series = healthTrendSeries([
    { date: "2026-07-27", vo2Max: 43.2 },
    { date: "2026-07-25", vo2Max: 42.7 },
    { date: "2026-07-26", vo2Max: null },
  ], "vo2Max");

  assert.deepEqual(series, [
    { date: "2026-07-25", value: 42.7, source: "health-connect" },
    { date: "2026-07-27", value: 43.2, source: "health-connect" },
  ]);
});

test("latestHealthValue returns the most recent chronological value or null", () => {
  const log = [
    { date: "2026-07-27", vo2Max: 43.2 },
    { date: "2026-07-25", vo2Max: 42.7 },
    { date: "2026-07-26", vo2Max: null },
  ];

  assert.deepEqual(latestHealthValue(log, "vo2Max"), {
    date: "2026-07-27",
    value: 43.2,
    source: "health-connect"
  });

  assert.equal(latestHealthValue(log, "missingMetric"), null);
  assert.equal(latestHealthValue([], "vo2Max"), null);
});
