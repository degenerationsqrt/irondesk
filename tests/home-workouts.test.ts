import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  HOME_WORKOUTS,
  HOME_WORKOUT_WARM_UP,
  homeWorkoutById,
  validateHomeWorkoutLibrary,
} from "../src/lib/irondesk/home-workouts";

const root = process.cwd();

describe("public no-gym workout library", () => {
  it("ships twelve complete, uniquely addressable workout choices", () => {
    expect(validateHomeWorkoutLibrary()).toEqual([]);
    expect(HOME_WORKOUTS).toHaveLength(12);
    expect(new Set(HOME_WORKOUTS.map((workout) => workout.id)).size).toBe(12);
    expect(HOME_WORKOUTS.every((workout) => workout.exercises.length >= 4)).toBe(true);
    expect(HOME_WORKOUTS.every((workout) => workout.exercises.length <= 8)).toBe(true);
  });

  it("covers strength, plyometrics, speed, and conditioning", () => {
    const categoryCounts = HOME_WORKOUTS.reduce<Record<string, number>>((counts, workout) => {
      counts[workout.category] = (counts[workout.category] ?? 0) + 1;
      return counts;
    }, {});

    expect(categoryCounts).toEqual({
      strength: 4,
      power: 3,
      speed: 2,
      conditioning: 3,
    });
  });

  it("provides a starter and build dose plus coaching cue for every movement", () => {
    for (const workout of HOME_WORKOUTS) {
      expect(workout.durationMinutes[0]).toBeGreaterThanOrEqual(10);
      expect(workout.durationMinutes[1]).toBeLessThanOrEqual(30);
      for (const exercise of workout.exercises) {
        expect(exercise.name.trim()).not.toBe("");
        expect(exercise.starter.trim()).not.toBe("");
        expect(exercise.build.trim()).not.toBe("");
        expect(exercise.cue.trim()).not.toBe("");
      }
    }
  });

  it("keeps jump rope optional and includes a no-equipment alternative", () => {
    const rope = homeWorkoutById("jump-rope-engine");
    expect(rope?.equipment).toContain("optional");
    expect(rope?.equipment).toContain("shadow rope");
  });

  it("provides a reusable five-movement warm-up", () => {
    expect(HOME_WORKOUT_WARM_UP).toHaveLength(5);
    expect(HOME_WORKOUT_WARM_UP.map((movement) => movement.name)).toEqual([
      "Easy march or light jog",
      "Ankle rocks",
      "Squat to reach",
      "Reverse lunge and reach",
      "A-march",
    ]);
  });

  it("exposes the library from desktop and mobile navigation plus the Train screen", () => {
    const shell = readFileSync(
      join(root, "src", "components", "irondesk", "app-shell.tsx"),
      "utf8",
    );
    const workoutRoute = readFileSync(join(root, "src", "routes", "workout.tsx"), "utf8");

    expect(shell).toContain('{ to: "/home-workouts", label: "Home Workouts"');
    expect(shell).toContain('const mobilePrimary = ["/", "/workout", "/program", "/home-workouts"');
    expect(shell).toContain('className="grid grid-cols-6"');
    expect(workoutRoute).toContain('<Link to="/home-workouts">');
    expect(workoutRoute).toContain("Browse home workouts");
  });
});
