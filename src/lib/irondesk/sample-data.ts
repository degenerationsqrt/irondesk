/**
 * Exact fingerprints for the legacy sample nutrition and recovery records.
 *
 * Cleanup deliberately ignores ids, ownership, dates, and timestamps because
 * those values were generated at seed time. Every user-editable value created
 * by the seed must still match before a row is considered disposable.
 */

export interface SampleMealCandidate {
  name: string;
  eaten_at: string | null;
  eaten_at_label: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  items: unknown;
}

export interface SampleRecoveryCandidate {
  is_sample: boolean;
  readiness: number | null;
  sleep_hours: number | null;
  sleep_efficiency_percent: number | null;
  resting_hr: number | null;
  hrv_ms: number | null;
  fatigue: number | null;
  stress: number | null;
  soreness: unknown;
  note: string | null;
  source: string;
}

export interface SampleNutritionDayCandidate {
  is_sample: boolean;
  calorie_target: number | null;
  protein_target_g: number | null;
  carb_target_g: number | null;
  fat_target_g: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  hydration_target_ml: number;
  hydration_ml: number;
  weight_goal_direction: string;
  weight_goal_rate_kg_per_week: number;
}

export interface NutritionTotals {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

const SAMPLE_MEAL_SIGNATURES: readonly SampleMealCandidate[] = [
  {
    name: "Breakfast",
    eaten_at: null,
    eaten_at_label: "07:10",
    calories: 620,
    protein_g: 46,
    carbs_g: 62,
    fat_g: 18,
    items: ["Skyr + berries", "Oats", "Whey"],
  },
  {
    name: "Lunch",
    eaten_at: null,
    eaten_at_label: "12:40",
    calories: 780,
    protein_g: 55,
    carbs_g: 88,
    fat_g: 22,
    items: ["Chicken, rice, greens"],
  },
  {
    name: "Post-Training",
    eaten_at: null,
    eaten_at_label: "19:15",
    calories: 1_010,
    protein_g: 61,
    carbs_g: 108,
    fat_g: 34,
    items: ["Beef mince pasta", "Greek yoghurt"],
  },
];

const SAMPLE_RECOVERY_SIGNATURE: Omit<SampleRecoveryCandidate, "is_sample"> = {
  readiness: 72,
  sleep_hours: 7.4,
  sleep_efficiency_percent: 89,
  resting_hr: 52,
  hrv_ms: null,
  fatigue: 4,
  stress: 3,
  soreness: [
    { area: "Quads", level: 3 },
    { area: "Lats", level: 2 },
  ],
  note: "Sample check-in.",
  source: "manual",
};

const SAMPLE_NUTRITION_DAY_SIGNATURE: Omit<SampleNutritionDayCandidate, "is_sample"> = {
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
};

function jsonEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonEquals(value, right[index]));
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object")
    return false;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some((key, index) => key !== rightKeys[index])
  )
    return false;
  return leftKeys.every((key) => jsonEquals(leftRecord[key], rightRecord[key]));
}

function sampleMealSignatureIndex(meal: SampleMealCandidate): number {
  return SAMPLE_MEAL_SIGNATURES.findIndex(
    (signature) =>
      meal.name === signature.name &&
      meal.eaten_at === signature.eaten_at &&
      meal.eaten_at_label === signature.eaten_at_label &&
      meal.calories === signature.calories &&
      meal.protein_g === signature.protein_g &&
      meal.carbs_g === signature.carbs_g &&
      meal.fat_g === signature.fat_g &&
      jsonEquals(meal.items, signature.items),
  );
}

export function isExactSampleMeal(meal: SampleMealCandidate): boolean {
  return sampleMealSignatureIndex(meal) >= 0;
}

export function partitionSampleMeals<T extends SampleMealCandidate>(
  meals: readonly T[],
): {
  exactSeedMeals: T[];
  preservedMeals: T[];
} {
  const exactSeedMeals: T[] = [];
  const preservedMeals: T[] = [];
  const claimedSignatures = new Set<number>();
  for (const meal of meals) {
    const signatureIndex = sampleMealSignatureIndex(meal);
    // The seed created one row per signature. If an identical duplicate exists,
    // there is no evidence that it was seeded, so the conservative choice is
    // to preserve it.
    if (signatureIndex >= 0 && !claimedSignatures.has(signatureIndex)) {
      claimedSignatures.add(signatureIndex);
      exactSeedMeals.push(meal);
    } else {
      preservedMeals.push(meal);
    }
  }
  return { exactSeedMeals, preservedMeals };
}

export function sumNutritionMeals(meals: readonly SampleMealCandidate[]): NutritionTotals {
  return meals.reduce<NutritionTotals>(
    (totals, meal) => ({
      calories: totals.calories + meal.calories,
      protein_g: totals.protein_g + meal.protein_g,
      carbs_g: totals.carbs_g + meal.carbs_g,
      fat_g: totals.fat_g + meal.fat_g,
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 },
  );
}

export function isExactSampleNutritionDay(day: SampleNutritionDayCandidate): boolean {
  return (
    day.is_sample === true &&
    day.calorie_target === SAMPLE_NUTRITION_DAY_SIGNATURE.calorie_target &&
    day.protein_target_g === SAMPLE_NUTRITION_DAY_SIGNATURE.protein_target_g &&
    day.carb_target_g === SAMPLE_NUTRITION_DAY_SIGNATURE.carb_target_g &&
    day.fat_target_g === SAMPLE_NUTRITION_DAY_SIGNATURE.fat_target_g &&
    day.calories === SAMPLE_NUTRITION_DAY_SIGNATURE.calories &&
    day.protein_g === SAMPLE_NUTRITION_DAY_SIGNATURE.protein_g &&
    day.carbs_g === SAMPLE_NUTRITION_DAY_SIGNATURE.carbs_g &&
    day.fat_g === SAMPLE_NUTRITION_DAY_SIGNATURE.fat_g &&
    day.hydration_target_ml === SAMPLE_NUTRITION_DAY_SIGNATURE.hydration_target_ml &&
    day.hydration_ml === SAMPLE_NUTRITION_DAY_SIGNATURE.hydration_ml &&
    day.weight_goal_direction === SAMPLE_NUTRITION_DAY_SIGNATURE.weight_goal_direction &&
    day.weight_goal_rate_kg_per_week === SAMPLE_NUTRITION_DAY_SIGNATURE.weight_goal_rate_kg_per_week
  );
}

export function isExactSampleRecovery(entry: SampleRecoveryCandidate): boolean {
  return (
    entry.is_sample === true &&
    entry.readiness === SAMPLE_RECOVERY_SIGNATURE.readiness &&
    entry.sleep_hours === SAMPLE_RECOVERY_SIGNATURE.sleep_hours &&
    entry.sleep_efficiency_percent === SAMPLE_RECOVERY_SIGNATURE.sleep_efficiency_percent &&
    entry.resting_hr === SAMPLE_RECOVERY_SIGNATURE.resting_hr &&
    entry.hrv_ms === SAMPLE_RECOVERY_SIGNATURE.hrv_ms &&
    entry.fatigue === SAMPLE_RECOVERY_SIGNATURE.fatigue &&
    entry.stress === SAMPLE_RECOVERY_SIGNATURE.stress &&
    jsonEquals(entry.soreness, SAMPLE_RECOVERY_SIGNATURE.soreness) &&
    entry.note === SAMPLE_RECOVERY_SIGNATURE.note &&
    entry.source === SAMPLE_RECOVERY_SIGNATURE.source
  );
}
