import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supabaseForUser: vi.fn(),
}));

vi.mock("../src/lib/mcp/supabase", () => ({
  supabaseForUser: mocks.supabaseForUser,
  unauthenticated: () => ({
    content: [{ type: "text", text: "Not authenticated." }],
    isError: true,
  }),
}));

import getWorkoutDetailTool from "../src/lib/mcp/tools/get-workout-detail";
import listRecentWorkoutsTool from "../src/lib/mcp/tools/list-recent-workouts";
import logRecoveryTool from "../src/lib/mcp/tools/log-recovery";

const authenticatedContext = {
  isAuthenticated: () => true,
  getUserId: () => "user-1",
  getToken: () => "token-1",
};

function thenableQuery(result: unknown) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

beforeEach(() => {
  mocks.supabaseForUser.mockReset();
  vi.useRealTimers();
});

describe("MCP sample-data isolation", () => {
  it("excludes sample sessions from the recent-workouts read", async () => {
    const sessionsQuery = thenableQuery({ data: [], error: null });
    mocks.supabaseForUser.mockReturnValue({ from: vi.fn(() => sessionsQuery) });

    await listRecentWorkoutsTool.handler(
      { limit: undefined, status: undefined },
      authenticatedContext as never,
    );

    expect(sessionsQuery.eq).toHaveBeenCalledWith("is_sample", false);
  });

  it("cannot fetch a sample session through workout detail", async () => {
    const sessionQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    sessionQuery.select.mockReturnValue(sessionQuery);
    sessionQuery.eq.mockReturnValue(sessionQuery);
    mocks.supabaseForUser.mockReturnValue({ from: vi.fn(() => sessionQuery) });

    const result = await getWorkoutDetailTool.handler(
      { session_id: "sample-session" },
      authenticatedContext as never,
    );

    expect(sessionQuery.eq).toHaveBeenCalledWith("id", "sample-session");
    expect(sessionQuery.eq).toHaveBeenCalledWith("is_sample", false);
    expect(result).toMatchObject({ isError: true });
  });

  it("writes real recovery data and defaults its day in the signed-in profile timezone", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T01:30:00.000Z"));

    const profileQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { timezone: "America/Los_Angeles" },
        error: null,
      }),
    };
    profileQuery.select.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);

    const recoveryQuery = {
      upsert: vi.fn(),
      select: vi.fn(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { id: "recovery-1", day: "2026-08-28" },
        error: null,
      }),
    };
    recoveryQuery.upsert.mockReturnValue(recoveryQuery);
    recoveryQuery.select.mockReturnValue(recoveryQuery);

    const from = vi.fn((table: string) => (table === "profiles" ? profileQuery : recoveryQuery));
    mocks.supabaseForUser.mockReturnValue({ from });

    await logRecoveryTool.handler(
      {
        day: undefined,
        sleep_hours: 7.5,
        resting_hr: undefined,
        hrv_ms: undefined,
        readiness: undefined,
        fatigue: undefined,
        stress: undefined,
        note: undefined,
      },
      authenticatedContext as never,
    );

    expect(profileQuery.eq).toHaveBeenCalledWith("id", "user-1");
    expect(recoveryQuery.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        day: "2026-08-28",
        source: "manual",
        is_sample: false,
        sleep_hours: 7.5,
      }),
      { onConflict: "user_id,day" },
    );
  });
});
