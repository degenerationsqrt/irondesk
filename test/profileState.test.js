import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGender,
  normalizeGoal,
  normalizeWorkoutProgress,
} from "../src/profileState.js";

test("legacy profile values migrate to supported program settings", () => {
  assert.equal(normalizeGender("male"), "men");
  assert.equal(normalizeGender("female"), "women");
  assert.equal(normalizeGoal("muscle", "male"), "vtaper");
  assert.equal(normalizeGoal("fat-loss", "female"), "recomp");
  assert.equal(normalizeGoal("unknown", "female"), "glutes");
});

test("malformed workout progress becomes a safe program position", () => {
  assert.deepEqual(normalizeWorkoutProgress({
    block: "3",
    week: 99,
    dayIndex: -4,
    updatedAt: "bad",
  }), {
    block: "3",
    blockNum: 3,
    week: 6,
    dayIndex: 0,
    updatedAt: 0,
  });
  assert.deepEqual(normalizeWorkoutProgress(null), {
    blockNum: 1,
    week: 1,
    dayIndex: 0,
    updatedAt: 0,
  });
});
