import type { Exercise } from "./types";
import { formatWeight, formatWeightedSet, type Units } from "./units";

export interface ExerciseEvidenceSummary {
  bestSet:
    { kind: "weighted"; weightKg: number; reps: number } | { kind: "reps"; reps: number } | null;
  e1rmTrend: Exercise["e1rmTrend"];
  e1rmDeltaKg: number | null;
  volumeHistory: Exercise["history"];
  hasPerformanceHistory: boolean;
  hasCues: boolean;
}

export interface ExerciseCardEvidence {
  bestSet: string;
  estimatedOneRepMax: string;
}

/**
 * Separates recorded evidence from zero-valued placeholders in demo/domain
 * exercise rows. Zero load can still accompany real rep/cardio history, but it
 * must never be presented as a measured 0 kg best set, 1RM or tonnage value.
 */
export function summarizeExerciseEvidence(
  exercise: Pick<Exercise, "best" | "e1rmTrend" | "history" | "cues">,
): ExerciseEvidenceSummary {
  const bestSet =
    exercise.best.reps <= 0
      ? null
      : exercise.best.weightKg > 0
        ? {
            kind: "weighted" as const,
            weightKg: exercise.best.weightKg,
            reps: exercise.best.reps,
          }
        : { kind: "reps" as const, reps: exercise.best.reps };
  const e1rmTrend = exercise.e1rmTrend.filter(
    (point) => Number.isFinite(point.e1rm) && point.e1rm > 0,
  );
  const first = e1rmTrend[0];
  const latest = e1rmTrend[e1rmTrend.length - 1];

  return {
    bestSet,
    e1rmTrend,
    e1rmDeltaKg: first && latest && e1rmTrend.length >= 2 ? latest.e1rm - first.e1rm : null,
    volumeHistory: exercise.history.filter(
      (entry) => Number.isFinite(entry.tonnageKg) && entry.tonnageKg > 0,
    ),
    hasPerformanceHistory: exercise.history.length > 0,
    hasCues: exercise.cues.length > 0,
  };
}

/**
 * Formats the evidence tiles used by the exercise library. Unavailable
 * performance remains an em dash with no dangling unit, while reps-only
 * movements retain their recorded rep evidence.
 */
export function formatExerciseCardEvidence(
  exercise: Pick<Exercise, "best" | "e1rmTrend" | "history" | "cues">,
  units: Units,
): ExerciseCardEvidence {
  const evidence = summarizeExerciseEvidence(exercise);
  const latestE1rmKg = evidence.e1rmTrend.at(-1)?.e1rm;

  return {
    bestSet:
      evidence.bestSet?.kind === "weighted"
        ? formatWeightedSet(evidence.bestSet.weightKg, evidence.bestSet.reps, units)
        : evidence.bestSet?.kind === "reps"
          ? `${evidence.bestSet.reps} reps`
          : "—",
    estimatedOneRepMax: latestE1rmKg ? formatWeight(latestE1rmKg, units) : "—",
  };
}
