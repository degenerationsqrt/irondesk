import assert from "node:assert/strict";
import test from "node:test";
import { computeCrewStats } from "../src/crewStats.js";

test("crew stats count recent sessions even when imported history is unsorted", () => {
  const now = new Date(2026, 7, 18, 12).getTime();
  const stats = computeCrewStats([
    { id: "old-first", date: "2026-08-01", volume: 1000, entries: [] },
    {
      id: "recent-second",
      date: "2026-08-17",
      volume: 2500,
      entries: [{ lift: "bench", sets: [{ w: 100, r: 5 }] }],
    },
    { id: "garmin", source: "garmin", date: "2026-08-18", volume: 9000 },
  ], { squat: 315 }, now);

  assert.equal(stats.weekSessions, 1);
  assert.equal(stats.weekVolume, 2500);
  assert.equal(stats.bench, 117);
  assert.equal(stats.squat, 315);
});
