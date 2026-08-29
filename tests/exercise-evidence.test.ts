import { describe, expect, it } from "vitest";

import { exercises } from "@/lib/irondesk/data";
import {
  formatExerciseCardEvidence,
  summarizeExerciseEvidence,
} from "@/lib/irondesk/exercise-evidence";

function exerciseNamed(name: string) {
  const exercise = exercises.find((candidate) => candidate.name === name);
  if (!exercise) throw new Error(`Missing demo exercise: ${name}`);
  return exercise;
}

describe("exercise detail evidence", () => {
  it("treats expanded demo-library placeholders as unavailable rather than zero performance", () => {
    const evidence = summarizeExerciseEvidence(exerciseNamed("Goblet Squat"));

    expect(evidence.bestSet).toBeNull();
    expect(evidence.e1rmTrend).toEqual([]);
    expect(evidence.e1rmDeltaKg).toBeNull();
    expect(evidence.volumeHistory).toEqual([]);
    expect(evidence.hasPerformanceHistory).toBe(false);
    expect(evidence.hasCues).toBe(false);
  });

  it("preserves genuine weighted evidence", () => {
    const evidence = summarizeExerciseEvidence(exerciseNamed("Back Squat"));

    expect(evidence.bestSet).toEqual({ kind: "weighted", weightKg: 150, reps: 3 });
    expect(evidence.e1rmTrend.length).toBeGreaterThan(1);
    expect(evidence.e1rmDeltaKg).toBe(15);
    expect(evidence.volumeHistory).toHaveLength(3);
    expect(evidence.hasPerformanceHistory).toBe(true);
    expect(evidence.hasCues).toBe(true);
  });

  it("keeps reps-only and conditioning history without inventing load or tonnage", () => {
    const repsOnly = summarizeExerciseEvidence(exerciseNamed("Hanging Leg Raise"));
    const conditioning = summarizeExerciseEvidence(exerciseNamed("Rowing Machine Intervals"));

    expect(repsOnly.bestSet).toEqual({ kind: "reps", reps: 14 });
    expect(repsOnly.e1rmDeltaKg).toBeNull();
    expect(repsOnly.volumeHistory).toEqual([]);
    expect(repsOnly.hasPerformanceHistory).toBe(true);

    expect(conditioning.bestSet).toBeNull();
    expect(conditioning.e1rmTrend).toEqual([]);
    expect(conditioning.volumeHistory).toEqual([]);
    expect(conditioning.hasPerformanceHistory).toBe(true);
    expect(conditioning.hasCues).toBe(true);
  });

  it("renders unavailable card evidence without false zeroes or dangling units", () => {
    expect(formatExerciseCardEvidence(exerciseNamed("Goblet Squat"), "imperial")).toEqual({
      bestSet: "—",
      estimatedOneRepMax: "—",
    });
    expect(
      formatExerciseCardEvidence(exerciseNamed("Rowing Machine Intervals"), "imperial"),
    ).toEqual({
      bestSet: "—",
      estimatedOneRepMax: "—",
    });
    expect(formatExerciseCardEvidence(exerciseNamed("Hanging Leg Raise"), "imperial")).toEqual({
      bestSet: "14 reps",
      estimatedOneRepMax: "—",
    });
    expect(formatExerciseCardEvidence(exerciseNamed("Back Squat"), "imperial")).toEqual({
      bestSet: "330.7 lb × 3",
      estimatedOneRepMax: "363.8 lb",
    });
  });
});
