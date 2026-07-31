import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_REST_TIMER_PREFS,
  filterAndSortSessions,
  normalizeActiveWorkout,
  normalizeRestTimerPrefs,
  normalizeSessionHistory,
  removeLastWorkoutSet,
  restDurationForEntry,
  sessionsToCsv,
  sessionsToGarminCsv,
  summarizeSessions,
} from "../src/workoutUtilities.js";
import { mergeGarminSessions, parseGarminCsv } from "../src/garminImport.js";

const sessions = [
  {
    id: "older",
    date: "2026-05-01",
    dayId: "Push, Pull",
    mode: "home",
    durationMin: 30,
    entries: [{ ex: 'DB "Press"', db: true, role: "acc", sets: [{ w: 50, r: 10 }] }],
    prs: [{ ex: 'DB "Press"' }],
  },
  {
    id: "newer",
    date: "2026-07-20",
    dayId: "Legs",
    mode: "gym",
    durationMin: 55,
    volume: 2400,
    entries: [{ ex: "Squat", role: "main", sets: [{ w: 240, r: 10 }] }],
    prs: [],
  },
];

test("old saved data receives safe rest timer defaults without mutation", () => {
  assert.deepEqual(normalizeRestTimerPrefs(undefined), DEFAULT_REST_TIMER_PREFS);
  assert.deepEqual(normalizeRestTimerPrefs({ enabled: false, accessorySeconds: 45 }), {
    enabled: false,
    accessorySeconds: 45,
    heavySeconds: 180,
  });
});

test("rest duration is optional and skips cardio/core entries", () => {
  assert.equal(restDurationForEntry(DEFAULT_REST_TIMER_PREFS, { heavy: true }), 180);
  assert.equal(restDurationForEntry(DEFAULT_REST_TIMER_PREFS, { heavy: false }), 60);
  assert.equal(restDurationForEntry(DEFAULT_REST_TIMER_PREFS, { role: "cardio" }), 0);
  assert.equal(restDurationForEntry({ enabled: false }, { heavy: true }), 0);
});

test("history can filter by exercise and mode, then sort by volume", () => {
  assert.deepEqual(
    filterAndSortSessions(sessions, { query: "press", mode: "home" }).map((item) => item.id),
    ["older"],
  );
  assert.deepEqual(
    filterAndSortSessions(sessions, { sort: "volume" }).map((item) => item.id),
    ["newer", "older"],
  );
});

test("history can isolate and search Garmin imports", () => {
  const garminSession = {
    id: "garmin-run",
    date: "2026-07-21",
    dayId: "Morning Run",
    mode: "garmin",
    source: "garmin",
    sourceDevice: "Garmin fēnix 6X",
    garmin: { activityType: "Running" },
    entries: [],
  };
  assert.deepEqual(
    filterAndSortSessions([...sessions, garminSession], { mode: "garmin", query: "fenix" })
      .map((item) => item.id),
    ["garmin-run"],
  );
});

test("legacy and malformed workout history is normalized without crashing", () => {
  assert.deepEqual(normalizeSessionHistory([
    null,
    { id: "legacy" },
    { id: "broken", entries: [{ ex: "Bench", sets: null }, null], prs: null },
  ]), [
    { id: "legacy", entries: [], prs: [] },
    { id: "broken", entries: [{ ex: "Bench", sets: [] }], prs: [] },
  ]);
  assert.deepEqual(normalizeActiveWorkout({ id: "active", entries: null }), {
    id: "active",
    entries: [],
  });
  assert.equal(normalizeActiveWorkout("bad"), null);
});

test("an accidentally added workout set can be removed without mutation", () => {
  const active = {
    id: "active",
    restTimerEndAt: 999,
    restTimerDuration: 60,
    entries: [{
      ex: "Bench Press",
      plannedSetCount: 1,
      sets: [
        { w: 185, r: 5, done: false },
        { w: 185, r: 5, done: true },
      ],
    }],
  };
  const next = removeLastWorkoutSet(active, 0);

  assert.equal(active.entries[0].sets.length, 2);
  assert.equal(next.entries[0].sets.length, 1);
  assert.equal(next.restTimerEndAt, null);
  assert.equal(next.restTimerDuration, 0);
  assert.strictEqual(removeLastWorkoutSet(next, 0), next);
});

test("history can isolate guided Train sessions", () => {
  const guided = {
    id: "vo2-session",
    date: "2026-07-21",
    dayId: "Norwegian 4 × 4",
    mode: "gym",
    sessionType: "vo2",
    entries: [],
  };
  assert.deepEqual(
    filterAndSortSessions([...sessions, guided], { mode: "training" }).map(item => item.id),
    ["vo2-session"],
  );
});

test("history summaries tolerate legacy sessions without a recorded volume", () => {
  assert.deepEqual(summarizeSessions(sessions), {
    sessions: 2,
    minutes: 85,
    volume: 3400,
    prs: 1,
  });
});

test("CSV export includes headers, escapes text, and counts both dumbbells", () => {
  const csv = sessionsToCsv(sessions);
  assert.match(csv, /^workout_id,date,workout,/);
  assert.match(csv, /"Push, Pull"/);
  assert.match(csv, /"DB ""Press"""/);
  assert.match(csv, /,1000,yes,irondesk,/);
});

test("empty CSV exports remain useful and contain the header row", () => {
  assert.equal(sessionsToCsv([]).split("\r\n").length, 1);
});

test("CSV export keeps Garmin summary activities even when no sets were recorded", () => {
  const csv = sessionsToCsv([{
    id: "garmin-run",
    date: "2026-07-21",
    dayId: "Morning Run",
    mode: "garmin",
    durationMin: 29,
    volume: 0,
    entries: [],
    source: "garmin",
    sourceDevice: "Garmin fēnix 6X",
    garmin: {
      activityId: "67890",
      activityType: "Running",
      distanceDisplay: "3.10 mi",
      calories: 505,
      avgHeartRate: 148,
      maxHeartRate: 177,
    },
  }]);
  assert.equal(csv.split("\r\n").length, 2);
  assert.match(csv, /garmin,Garmin fēnix 6X,67890,Running,3.10 mi,505,148,177$/);
});

test("Garmin-compatible CSV uses import headers and round-trips without duplicates", () => {
  const csv = sessionsToGarminCsv(sessions);
  assert.match(csv, /^Activity ID,Activity Type,Date,Title,Distance,Calories,Time,Avg HR,Max HR/);
  assert.match(csv, /irondesk-newer,Strength Training,2026-07-20,Legs,,,00:55:00,,/);

  const parsed = parseGarminCsv(csv);
  const merged = mergeGarminSessions(sessions, parsed.sessions);
  assert.equal(parsed.sessions.length, sessions.length);
  assert.equal(merged.added, 0);
  assert.equal(merged.duplicates, sessions.length);
});
