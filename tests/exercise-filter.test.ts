import { describe, expect, it } from "vitest";

import { filterExercises } from "../src/lib/irondesk/exercise-filter";
import type { Exercise } from "../src/lib/irondesk/types";

function exercise(index: number, patch: Partial<Exercise> = {}): Exercise {
  return {
    id: `exercise-${index}`,
    name: `Movement ${index}`,
    muscle: index % 2 ? "Back" : "Chest",
    secondary: index % 2 ? ["Biceps"] : ["Triceps"],
    equipment: index % 3 ? "Dumbbell" : "Cable",
    pattern: index % 2 ? "Pull" : "Push",
    favorite: index === 2,
    best: { weightKg: 0, reps: 0 },
    e1rmTrend: [],
    history: [],
    cues: [],
    ...patch,
  };
}

describe("whole exercise library filtering", () => {
  const library = Array.from({ length: 18 }, (_, index) => exercise(index));

  it("returns the complete library instead of a first-ten slice", () => {
    expect(filterExercises(library, {})).toHaveLength(18);
  });

  it("requires every search term across name, muscles, equipment and pattern", () => {
    const match = exercise(99, {
      name: "Incline Hammer Curl",
      muscle: "Biceps",
      secondary: ["Forearms"],
      equipment: "Dumbbell",
      pattern: "Elbow flexion",
    });
    expect(filterExercises([...library, match], { query: "hammer forearm dumbbell" })).toEqual([
      match,
    ]);
    expect(filterExercises([...library, match], { query: "hammer cable" })).toEqual([]);
  });

  it("composes view, muscle and equipment filters", () => {
    const customRecent = exercise(50, {
      muscle: "Back",
      equipment: "Cable",
      isCustom: true,
      lastPerformed: "2026-08-28T12:00:00.000Z",
    });
    expect(
      filterExercises([...library, customRecent], {
        mode: "custom",
        muscle: "Back",
        equipment: "Cable",
      }),
    ).toEqual([customRecent]);
    expect(filterExercises([...library, customRecent], { mode: "recent" })).toEqual([customRecent]);
  });
});
