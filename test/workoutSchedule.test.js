import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWorkoutProgress,
  newerWorkoutProgress,
  resolveWorkoutDayIndex,
  selectWorkoutDay,
} from "../src/workoutSchedule.js";

const dayIds = ["Shoulders", "Back", "Chest", "Legs", "Arms", "Delts & Core"];
const focusKeys = ["Shoulders", "Back", "Chest", "Legs", "Arms", "DeltsCore"];

test("legacy progress advances from the latest completed program day", () => {
  assert.equal(resolveWorkoutDayIndex(
    { blockNum: 1, week: 1 },
    dayIds,
    [{ id: "shoulders", dayId: "Shoulders", date: "2026-07-28" }],
  ), 1);
});

test("an explicitly selected day wins over workout history", () => {
  assert.equal(resolveWorkoutDayIndex(
    { blockNum: 1, week: 1, dayIndex: 3 },
    dayIds,
    [{ id: "shoulders", dayId: "Shoulders", date: "2026-07-28" }],
  ), 3);
});

test("saved program positions disambiguate repeated workout names", () => {
  const repeatedDayIds = ["Push", "Pull", "Legs", "Push", "Pull", "Legs"];
  assert.equal(resolveWorkoutDayIndex(
    { blockNum: 1, week: 1 },
    repeatedDayIds,
    [{ id: "push-two", dayId: "Push", programDayIndex: 3 }],
  ), 4);
});

test("day selection wraps in both directions", () => {
  assert.equal(selectWorkoutDay({ blockNum: 1, week: 1 }, -1, 6, 100).dayIndex, 5);
  assert.equal(selectWorkoutDay({ blockNum: 1, week: 1 }, 6, 6, 100).dayIndex, 0);
});

test("finishing a generated workout advances to the next day", () => {
  const next = advanceWorkoutProgress({
    progress: { blockNum: 2, week: 3, dayIndex: 0 },
    focusKeys,
    completedFocusKey: "Shoulders",
    completedWeek: 3,
    completedBlockNum: 2,
    updatedAt: 100,
  });
  assert.deepEqual(next, {
    blockNum: 2,
    week: 3,
    dayIndex: 1,
    updatedAt: 100,
  });
});

test("the final day advances the week and the final week advances the block", () => {
  assert.deepEqual(advanceWorkoutProgress({
    progress: { blockNum: 2, week: 3, dayIndex: 5 },
    focusKeys,
    completedFocusKey: "DeltsCore",
    completedWeek: 3,
    completedBlockNum: 2,
    updatedAt: 100,
  }), {
    blockNum: 2,
    week: 4,
    dayIndex: 0,
    updatedAt: 100,
  });

  assert.deepEqual(advanceWorkoutProgress({
    progress: { blockNum: 2, week: 6, dayIndex: 5 },
    focusKeys,
    completedFocusKey: "DeltsCore",
    completedWeek: 6,
    completedBlockNum: 2,
    updatedAt: 101,
  }), {
    blockNum: 3,
    week: 1,
    dayIndex: 0,
    updatedAt: 101,
  });
});

test("repeated focus days advance from the recorded program position", () => {
  const repeated = ["Push", "Pull", "Legs", "Push", "Pull", "Legs"];
  const next = advanceWorkoutProgress({
    progress: { blockNum: 1, week: 1, dayIndex: 3 },
    focusKeys: repeated,
    completedFocusKey: "Push",
    completedDayIndex: 3,
    completedWeek: 1,
    completedBlockNum: 1,
    updatedAt: 100,
  });

  assert.equal(next.dayIndex, 4);
  assert.equal(next.week, 1);
});

test("cloud progress uses the newest device update and keeps migrated day indexes", () => {
  assert.deepEqual(
    newerWorkoutProgress(
      { blockNum: 1, week: 1, dayIndex: 2, updatedAt: 200 },
      { blockNum: 1, week: 1, dayIndex: 0, updatedAt: 100 },
    ),
    { blockNum: 1, week: 1, dayIndex: 2, updatedAt: 200 },
  );
  assert.deepEqual(
    newerWorkoutProgress(
      { blockNum: 1, week: 1, dayIndex: 2 },
      { blockNum: 1, week: 1 },
    ),
    { blockNum: 1, week: 1, dayIndex: 2 },
  );
});
