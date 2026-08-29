import type { Exercise } from "./types";

export interface ExerciseEvidenceSummary {
  bestSet:
    { kind: "weighted"; weightKg: number; reps: number } | { kind: "reps"; reps: number } | null;
  e1rmTrend: Exercise["e1rmTrend"];
  e1rmDeltaKg: number | null;
  volumeHistory: Exercise["history"];
  hasPerformanceHistory: boolean;
  hasCues: boolean;
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
