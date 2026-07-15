import assert from "node:assert/strict";
import test from "node:test";
import {
  estimatedMaxForSet,
  isValidE1RMSet,
  localDateKey,
  setVolume,
  workoutVolume,
} from "../src/trainingMath.js";

test("localDateKey uses the user's calendar date", () => {
  assert.equal(localDateKey(new Date(2026, 6, 15, 23, 45)), "2026-07-15");
});

test("estimated maxes only accept strength sets from one through eight reps", () => {
  assert.equal(isValidE1RMSet(315, 5), true);
  assert.equal(Math.round(estimatedMaxForSet(315, 5)), 368);
  assert.equal(estimatedMaxForSet(225, 12), null);
  assert.equal(estimatedMaxForSet(0, 5), null);
});

test("dumbbell volume counts both dumbbells", () => {
  assert.equal(setVolume({ w: 50, r: 10 }, true), 1000);
  assert.equal(setVolume({ w: 50, r: 10 }, false), 500);
});

test("workout volume respects each entry's dumbbell flag", () => {
  assert.equal(
    workoutVolume([
      { db: true, sets: [{ w: 50, r: 10 }] },
      { db: false, sets: [{ w: 100, r: 5 }] },
    ]),
    1500,
  );
});
