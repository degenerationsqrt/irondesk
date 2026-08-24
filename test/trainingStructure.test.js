import assert from "node:assert/strict";
import test from "node:test";
import {
  GENERATED_FOCUS_KEYS,
  anchorPlanForFocus,
  anchorPrescription,
  applyWorkoutReadiness,
  evaluateAnchorProgression,
  progressedAnchorTarget,
  pumpFinisherRows,
  readinessSuggestionFromSleep,
} from "../src/trainingStructure.js";

function workoutFixture() {
  return {
    readiness: "normal",
    loadIncrement: 5,
    entries: [
      {
        ex: "Bench Press",
        lift: "bench",
        role: "comp",
        heavy: true,
        baseTarget: 200,
        target: 200,
        targetReps: 5,
        baseSetCount: 3,
        plannedSetCount: 3,
        sets: Array.from({ length: 3 }, () => ({ w: 200, r: 5, done: false })),
      },
      {
        ex: "DB Fly",
        role: "acc",
        targetReps: 12,
        baseSetCount: 3,
        plannedSetCount: 3,
        sets: Array.from({ length: 3 }, () => ({ w: 30, r: 12, done: false })),
      },
      ...pumpFinisherRows("Chest", "home").map(row => ({
        ...row,
        baseSetCount: row.sets,
        plannedSetCount: row.sets,
        targetReps: row.reps,
        sets: Array.from({ length: row.sets }, () => ({ w: 10, r: row.reps, done: false })),
      })),
    ],
  };
}

test("every generated program focus starts with a 4-6 rep strength anchor", () => {
  for (const focusKey of GENERATED_FOCUS_KEYS) {
    const anchor = anchorPlanForFocus(focusKey, 1);
    assert.ok(anchor.lift, `${focusKey} should have a tracked lift`);
    assert.ok(anchor.exercise, `${focusKey} should have an anchor exercise`);
  }
  for (const style of ["strength", "hypertrophy", "tone"]) {
    const prescription = anchorPrescription(style);
    assert.ok(prescription.reps >= 4 && prescription.reps <= 6);
    assert.ok(prescription.sets >= 3);
  }
});

test("pump finishers contain three equipment-aware movements and three short-rest rounds", () => {
  for (const focusKey of GENERATED_FOCUS_KEYS) {
    for (const mode of ["home", "gym"]) {
      const rows = pumpFinisherRows(focusKey, mode);
      assert.equal(rows.length, 3, `${focusKey}/${mode}`);
      assert.equal(new Set(rows.map(row => row.ex)).size, 3, `${focusKey}/${mode}`);
      rows.forEach((row, index) => {
        assert.equal(row.role, "finisher");
        assert.equal(row.sets, 3);
        assert.equal(row.reps, 20);
        assert.equal(row.restSeconds, 45);
        assert.equal(row.circuitOrder, index + 1);
      });
    }
  }
});

test("readiness trims pump volume before strength intensity and can restore the plan", () => {
  const normal = workoutFixture();
  const reduced = applyWorkoutReadiness(normal, "reduced");
  assert.equal(reduced.readiness, "reduced");
  assert.equal(reduced.entries[0].target, 200);
  assert.equal(reduced.entries[0].sets.length, 3);
  assert.deepEqual(reduced.entries.filter(entry => entry.role === "finisher").map(entry => entry.sets.length), [2, 2, 2]);

  const recovery = applyWorkoutReadiness(normal, "recovery");
  assert.equal(recovery.entries[0].target, 180);
  assert.equal(recovery.entries[0].sets.length, 2);
  assert.equal(recovery.entries[1].sets.length, 2);
  assert.ok(recovery.entries.filter(entry => entry.role === "finisher").every(entry => (
    entry.readinessSkipped && entry.sets.length === 0
  )));

  const restored = applyWorkoutReadiness(recovery, "normal");
  assert.equal(restored.entries[0].target, 200);
  assert.equal(restored.entries[0].sets.length, 3);
  assert.ok(restored.entries.filter(entry => entry.role === "finisher").every(entry => entry.sets.length === 3));
});

test("readiness cannot rewrite a workout after a set has been logged", () => {
  const workout = workoutFixture();
  workout.entries[0].sets[0].done = true;
  assert.strictEqual(applyWorkoutReadiness(workout, "recovery"), workout);
});

test("sleep guidance suggests full, reduced, and recovery plans without forcing a choice", () => {
  assert.equal(readinessSuggestionFromSleep(480).level, "normal");
  assert.equal(readinessSuggestionFromSleep(390).level, "reduced");
  assert.equal(readinessSuggestionFromSleep(330).level, "recovery");
  assert.match(readinessSuggestionFromSleep(null).reason, /Choose from soreness/i);
});

test("successful anchors progress while repeated misses trigger a five-percent reset", () => {
  const success = workoutFixture();
  success.entries[0].sets.forEach(set => { set.done = true; });
  assert.deepEqual(evaluateAnchorProgression(success), {
    lift: "bench",
    exercise: "Bench Press",
    status: "increase",
    baseTarget: 200,
    completedSets: 3,
    plannedSets: 3,
    nextLoad: 205,
    message: "All anchor sets complete — add 5 lb next time.",
  });

  const miss = workoutFixture();
  miss.entries[0].sets[0].done = true;
  const firstMiss = evaluateAnchorProgression(miss);
  assert.equal(firstMiss.status, "repeat");
  assert.equal(firstMiss.nextLoad, 200);

  const secondMiss = evaluateAnchorProgression(miss, [{
    completedAt: 10,
    anchorProgression: {
      lift: "bench",
      exercise: "Bench Press",
      status: "repeat",
      nextLoad: 200,
    },
  }]);
  assert.equal(secondMiss.status, "reset");
  assert.equal(secondMiss.nextLoad, 190);
});

test("progressed targets use recent matching guidance but reject stale baselines", () => {
  const history = [{
    completedAt: 100,
    anchorProgression: {
      lift: "bench",
      exercise: "Bench Press",
      baseTarget: 200,
      nextLoad: 205,
    },
  }];
  assert.equal(progressedAnchorTarget(200, "bench", "Bench Press", history, 5), 205);
  assert.equal(progressedAnchorTarget(250, "bench", "Bench Press", history, 5), 250);
  assert.equal(progressedAnchorTarget(200, "bench", "Incline Barbell Press", history, 5), 200);
  assert.equal(progressedAnchorTarget(200, "squat", "Back Squat", history, 5), 200);
});
