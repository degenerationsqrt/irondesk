import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn() }));

vi.mock("../src/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser }, from: mocks.from },
}));

import { addMeal, ensureNutritionDay, getNutrition } from "../src/lib/irondesk/repo";

type Result = { data: unknown; error: { message: string } | null };
const success = (data: unknown = null): Result => ({ data, error: null });
const failure = (message: string): Result => ({ data: null, error: { message } });

function readQuery(result: Result) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return query;
}

function nutritionStore(
  options: {
    dayRead?: Result;
    mealRead?: Result;
    mealInsert?: Result;
    totalsWrite?: Result;
  } = {},
) {
  const mealInsert = vi.fn(() => Promise.resolve(options.mealInsert ?? success()));
  const dayInsert = vi.fn();
  const totalsWrite = vi.fn(() => readQuery(options.totalsWrite ?? success()));
  const mealRead = vi.fn(() => readQuery(options.mealRead ?? success([])));
  mocks.from.mockImplementation((table: string) => {
    if (table === "profiles") return readQuery(success({ id: "athlete-a", timezone: "UTC" }));
    if (table === "user_preferences") return readQuery(success(null));
    if (table === "user_equipment") return readQuery(success([]));
    if (table === "nutrition_days")
      return {
        ...readQuery(options.dayRead ?? success({ id: "nutrition-day", is_sample: false })),
        insert: dayInsert,
        update: totalsWrite,
      };
    if (table === "meals") return { insert: mealInsert, select: mealRead };
    throw new Error(`Unexpected table: ${table}`);
  });
  return { mealInsert, dayInsert, totalsWrite, mealRead };
}

const meal = { name: "Lunch", calories: 500, proteinG: 30, carbsG: 45, fatG: 18 };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "athlete-a" } }, error: null });
});

describe("nutrition persistence failures", () => {
  it("never overwrites daily totals with zero when the aggregate meal read fails", async () => {
    const store = nutritionStore({ mealRead: failure("Meal read unavailable") });
    await expect(addMeal(meal)).rejects.toThrow(
      "The meal was saved, but daily totals could not be refreshed.",
    );
    expect(store.mealInsert).toHaveBeenCalledOnce();
    expect(store.totalsWrite).not.toHaveBeenCalled();
  });

  it("surfaces an aggregate write failure and states that the meal was already saved", async () => {
    const store = nutritionStore({
      mealRead: success([{ calories: 500, protein_g: 30, carbs_g: 45, fat_g: 18 }]),
      totalsWrite: failure("Totals update unavailable"),
    });
    await expect(addMeal(meal)).rejects.toThrow(
      "The meal was saved, but daily totals could not be refreshed. Review your meals before adding it again. Totals update unavailable",
    );
    expect(store.totalsWrite).toHaveBeenCalledWith({
      calories: 500,
      protein_g: 30,
      carbs_g: 45,
      fat_g: 18,
    });
  });

  it("propagates meal-list failures rather than presenting an empty nutrition day", async () => {
    nutritionStore({ mealRead: failure("Meals unavailable") });
    await expect(getNutrition("2026-09-11")).rejects.toThrow("Meals unavailable");
  });

  it("does not create a replacement day when the existing-day lookup fails", async () => {
    const store = nutritionStore({ dayRead: failure("Nutrition day unavailable") });
    await expect(ensureNutritionDay("2026-09-11")).rejects.toThrow("Nutrition day unavailable");
    expect(store.dayInsert).not.toHaveBeenCalled();
    expect(store.mealInsert).not.toHaveBeenCalled();
  });

  it("does not recalculate or claim a saved meal when the insert fails", async () => {
    const store = nutritionStore({ mealInsert: failure("Meal insert failed") });
    await expect(addMeal(meal)).rejects.toThrow("Meal insert failed");
    expect(store.mealRead).not.toHaveBeenCalled();
    expect(store.totalsWrite).not.toHaveBeenCalled();
  });

  it("continues to persist the actual meal sums on success", async () => {
    const store = nutritionStore({
      mealRead: success([
        { calories: 500, protein_g: 30, carbs_g: 45, fat_g: 18 },
        { calories: 250, protein_g: 15, carbs_g: 20, fat_g: 12 },
      ]),
    });
    await expect(addMeal(meal)).resolves.toBeUndefined();
    expect(store.totalsWrite).toHaveBeenCalledWith({
      calories: 750,
      protein_g: 45,
      carbs_g: 65,
      fat_g: 30,
    });
  });
});
