import type { Exercise } from "./types";

export type ExerciseFilterMode = "all" | "favorites" | "recent" | "custom";

export interface ExerciseFilters {
  query?: string;
  mode?: ExerciseFilterMode;
  muscle?: string | "all";
  equipment?: string | "all";
}

function searchText(exercise: Exercise): string {
  return [
    exercise.name,
    exercise.muscle,
    ...exercise.secondary,
    exercise.equipment,
    exercise.pattern,
  ]
    .join(" ")
    .normalize("NFKD")
    .toLowerCase();
}

/** Shared whole-library filtering used by the workout picker and builder. */
export function filterExercises(
  exercises: readonly Exercise[],
  filters: ExerciseFilters,
): Exercise[] {
  const terms = (filters.query ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const mode = filters.mode ?? "all";
  const muscle = filters.muscle ?? "all";
  const equipment = filters.equipment ?? "all";

  return exercises.filter((exercise) => {
    if (muscle !== "all" && exercise.muscle !== muscle) return false;
    if (equipment !== "all" && exercise.equipment !== equipment) return false;
    if (mode === "favorites" && !exercise.favorite) return false;
    if (mode === "recent" && !exercise.lastPerformed) return false;
    if (mode === "custom" && !exercise.isCustom) return false;
    if (!terms.length) return true;
    const text = searchText(exercise);
    return terms.every((term) => text.includes(term));
  });
}

export function exerciseFilterFacets(exercises: readonly Exercise[]): {
  muscles: string[];
  equipment: string[];
} {
  return {
    muscles: [...new Set(exercises.map((exercise) => exercise.muscle).filter(Boolean))].sort(),
    equipment: [...new Set(exercises.map((exercise) => exercise.equipment).filter(Boolean))].sort(),
  };
}
