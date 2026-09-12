import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), getUser: vi.fn(), rpc: vi.fn() }));

vi.mock("../src/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mocks.getUser }, from: mocks.from, rpc: mocks.rpc },
}));

import {
  getAccount,
  getExercise,
  getExercises,
  getProgressionContext,
} from "../src/lib/irondesk/repo";

type QueryResult = { data: unknown; error: { message: string } | null };

function queryResult(result: QueryResult) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    not: vi.fn(() => chain),
    order: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    returns: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "athlete-a" } }, error: null });
});

describe("repository read failures remain distinct from missing athlete data", () => {
  it.each(["user_preferences", "user_equipment"])(
    "rejects failed %s reads instead of returning default units or no equipment",
    async (failedTable) => {
      mocks.from.mockImplementation((table: string) =>
        queryResult({
          data: table === "profiles" ? { id: "athlete-a" } : null,
          error: table === failedTable ? { message: `${table} unavailable` } : null,
        }),
      );
      await expect(getAccount()).rejects.toThrow(`${failedTable} unavailable`);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );

  it.each(["exercises", "exercise_favorites"])(
    "rejects failed %s reads instead of reporting an empty or altered library",
    async (failedTable) => {
      mocks.from.mockImplementation((table: string) =>
        queryResult({
          data: [],
          error: table === failedTable ? { message: `${table} unavailable` } : null,
        }),
      );
      await expect(getExercises()).rejects.toThrow(`${failedTable} unavailable`);
    },
  );

  it("does not mark an exercise unfavorited when the favorite lookup fails", async () => {
    mocks.from.mockImplementation((table: string) =>
      queryResult({
        data: table === "exercises" ? { id: "exercise-a" } : [],
        error: table === "exercise_favorites" ? { message: "Favorites unavailable" } : null,
      }),
    );
    await expect(getExercise("exercise-a")).rejects.toThrow("Favorites unavailable");
  });

  it("does not calculate progression from a failed readiness lookup", async () => {
    mocks.from.mockImplementation((table: string) =>
      queryResult({
        data: [],
        error: table === "recovery_entries" ? { message: "Readiness unavailable" } : null,
      }),
    );
    await expect(getProgressionContext()).rejects.toThrow("Readiness unavailable");
  });

  it("still represents genuinely missing preferences and an empty library without an error", async () => {
    mocks.from.mockImplementation((table: string) =>
      queryResult({
        data: table === "profiles" ? { id: "athlete-a" } : table === "user_preferences" ? null : [],
        error: null,
      }),
    );
    await expect(getAccount()).resolves.toEqual({
      profile: { id: "athlete-a" },
      preferences: null,
      equipmentIds: [],
    });
    await expect(getExercises()).resolves.toEqual([]);
  });
});
