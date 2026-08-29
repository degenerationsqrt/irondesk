import { describe, expect, it } from "vitest";

import {
  isExactSampleMeal,
  isExactSampleNutritionDay,
  isExactSampleRecovery,
  partitionSampleMeals,
  sumNutritionMeals,
  type SampleMealCandidate,
  type SampleNutritionDayCandidate,
  type SampleRecoveryCandidate,
} from "../src/lib/irondesk/sample-data";

const breakfast = (overrides: Partial<SampleMealCandidate> = {}): SampleMealCandidate => ({
  name: "Breakfast",
  eaten_at: null,
  eaten_at_label: "07:10",
  calories: 620,
  protein_g: 46,
  carbs_g: 62,
  fat_g: 18,
  items: ["Skyr + berries", "Oats", "Whey"],
  ...overrides,
});

const recovery = (overrides: Partial<SampleRecoveryCandidate> = {}): SampleRecoveryCandidate => ({
  is_sample: true,
  readiness: 72,
  sleep_hours: 7.4,
  sleep_efficiency_percent: 89,
  resting_hr: 52,
  hrv_ms: null,
  fatigue: 4,
  stress: 3,
  soreness: [
    { level: 3, area: "Quads" },
    { level: 2, area: "Lats" },
  ],
  note: "Sample check-in.",
  source: "manual",
  ...overrides,
});

const nutritionDay = (
  overrides: Partial<SampleNutritionDayCandidate> = {},
): SampleNutritionDayCandidate => ({
  is_sample: true,
  calorie_target: 2_900,
  protein_target_g: 185,
  carb_target_g: 320,
  fat_target_g: 85,
  calories: 2_410,
  protein_g: 162,
  carbs_g: 258,
  fat_g: 74,
  hydration_target_ml: 3_000,
  hydration_ml: 2_200,
  weight_goal_direction: "cut",
  weight_goal_rate_kg_per_week: 0.3,
  ...overrides,
});

describe("sample meal cleanup classification", () => {
  it("matches only the complete immutable seed fingerprint", () => {
    expect(isExactSampleMeal(breakfast())).toBe(true);
    expect(isExactSampleMeal(breakfast({ calories: 621 }))).toBe(false);
    expect(isExactSampleMeal(breakfast({ eaten_at: "2026-08-28T07:10:00.000Z" }))).toBe(false);
    expect(isExactSampleMeal(breakfast({ items: ["Skyr + berries", "Oats"] }))).toBe(false);
  });

  it("partitions edited or user-created meals for preservation and totals only those rows", () => {
    const editedSeed = breakfast({ protein_g: 50 });
    const realMeal = breakfast({
      name: "Dinner",
      eaten_at_label: "20:00",
      calories: 700,
      protein_g: 40,
      carbs_g: 70,
      fat_g: 20,
      items: ["Salmon", "Rice"],
    });
    const { exactSeedMeals, preservedMeals } = partitionSampleMeals([
      breakfast(),
      editedSeed,
      realMeal,
    ]);

    expect(exactSeedMeals).toHaveLength(1);
    expect(preservedMeals).toEqual([editedSeed, realMeal]);
    expect(sumNutritionMeals(preservedMeals)).toEqual({
      calories: 1_320,
      protein_g: 90,
      carbs_g: 132,
      fat_g: 38,
    });
  });

  it("removes at most one row for each known signature", () => {
    const duplicate = breakfast();
    const { exactSeedMeals, preservedMeals } = partitionSampleMeals([breakfast(), duplicate]);
    expect(exactSeedMeals).toHaveLength(1);
    expect(preservedMeals).toEqual([duplicate]);
  });
});

describe("sample recovery cleanup classification", () => {
  it("matches the seed despite JSON object key order", () => {
    expect(isExactSampleRecovery(recovery())).toBe(true);
  });

  it("preserves any edited, imported, or already-real recovery row", () => {
    expect(isExactSampleRecovery(recovery({ sleep_hours: 7.5 }))).toBe(false);
    expect(isExactSampleRecovery(recovery({ source: "wearable" }))).toBe(false);
    expect(isExactSampleRecovery(recovery({ hrv_ms: 54 }))).toBe(false);
    expect(isExactSampleRecovery(recovery({ is_sample: false }))).toBe(false);
  });
});

describe("sample nutrition parent cleanup classification", () => {
  it("matches only the complete seeded parent values", () => {
    expect(isExactSampleNutritionDay(nutritionDay())).toBe(true);
    expect(isExactSampleNutritionDay(nutritionDay({ hydration_ml: 2_201 }))).toBe(false);
    expect(isExactSampleNutritionDay(nutritionDay({ calorie_target: 3_000 }))).toBe(false);
    expect(isExactSampleNutritionDay(nutritionDay({ weight_goal_direction: "maintain" }))).toBe(
      false,
    );
    expect(isExactSampleNutritionDay(nutritionDay({ is_sample: false }))).toBe(false);
  });

  it("treats a changed derived macro total as a parent edit", () => {
    expect(isExactSampleNutritionDay(nutritionDay({ protein_g: 163 }))).toBe(false);
  });
});
