import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supabaseForUser: vi.fn() }));
vi.mock("../src/lib/mcp/supabase", () => ({
  supabaseForUser: mocks.supabaseForUser,
  unauthenticated: () => ({
    content: [{ type: "text", text: "Not authenticated." }],
    isError: true,
  }),
}));

import getProgramStatusTool from "../src/lib/mcp/tools/get-program-status";
import logBodyMetricTool from "../src/lib/mcp/tools/log-body-metric";
import logRecoveryTool from "../src/lib/mcp/tools/log-recovery";

const context = {
  isAuthenticated: () => true,
  getUserId: () => "user-1",
  getToken: () => "token-1",
};

function query(result: unknown) {
  const chain = {
    select: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    in: vi.fn(),
    insert: vi.fn(),
    upsert: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue(result),
    rpc: vi.fn().mockResolvedValue(result),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  };
  for (const method of [
    chain.select,
    chain.order,
    chain.limit,
    chain.in,
    chain.insert,
    chain.upsert,
  ]) {
    method.mockReturnValue(chain);
  }
  return chain;
}

beforeEach(() => mocks.supabaseForUser.mockReset());

describe("MCP recovery input and patch semantics", () => {
  it.each([
    { day: "2026-02-30", sleep_hours: 7 },
    { day: "2026-09-11T12:00:00Z", sleep_hours: 7 },
    { sleep_hours: -1 },
    { sleep_hours: 25 },
    { sleep_hours: Number.POSITIVE_INFINITY },
    { resting_hr: 20 },
    { resting_hr: 141 },
    { hrv_ms: 4 },
    { hrv_ms: 301 },
    { readiness: 101 },
    { readiness: -1 },
    { fatigue: 0 },
    { stress: 11 },
    { note: "a".repeat(501) },
    {},
    { day: "2026-09-11" },
  ])(
    "rejects invalid or empty input without querying or changing measurements: %j",
    async (input) => {
      const result = await logRecoveryTool.handler(input as never, context as never);
      expect(result).toMatchObject({ isError: true });
      expect(mocks.supabaseForUser).not.toHaveBeenCalled();
    },
  );

  it("keeps unmentioned measurements and notes out of the update payload", async () => {
    const recovery = query({ data: { readiness: 72 }, error: null });
    mocks.supabaseForUser.mockReturnValue(recovery);
    await logRecoveryTool.handler({ day: "2026-09-11", readiness: 72 } as never, context as never);
    expect(recovery.rpc).toHaveBeenCalledWith("patch_recovery_entry", {
      _day: "2026-09-11",
      _patch: { readiness: 72 },
    });
  });

  it("clears an existing note only when the athlete explicitly supplies an empty note", async () => {
    const recovery = query({ data: { note: null }, error: null });
    mocks.supabaseForUser.mockReturnValue(recovery);
    await logRecoveryTool.handler({ day: "2026-09-11", note: "  " } as never, context as never);
    expect(recovery.rpc).toHaveBeenCalledWith("patch_recovery_entry", {
      _day: "2026-09-11",
      _patch: { note: null },
    });
  });

  it("accepts database boundary values without changing the recorded values", async () => {
    const recovery = query({ data: {}, error: null });
    mocks.supabaseForUser.mockReturnValue(recovery);
    const values = {
      day: "2028-02-29",
      sleep_hours: 0,
      resting_hr: 25,
      hrv_ms: 300,
      readiness: 0,
      fatigue: 10,
      stress: 1,
    };
    const result = await logRecoveryTool.handler(values as never, context as never);
    expect(result).not.toHaveProperty("isError", true);
    const { day, ...measurements } = values;
    expect(recovery.rpc).toHaveBeenCalledWith("patch_recovery_entry", {
      _day: day,
      _patch: measurements,
    });
  });
});

describe("MCP body measurement validation", () => {
  it.each([
    { weight_kg: 19 },
    { weight_kg: 401 },
    { body_fat_percent: 1 },
    { body_fat_percent: 71 },
    { waist_cm: 0 },
    { waist_cm: -12 },
    { waist_cm: Number.NaN },
    { weight_kg: 80, recorded_at: "2026-09-11" },
    { weight_kg: 80, recorded_at: "2026-09-11T12:00:00" },
  ])("rejects invalid input before insertion: %j", async (input) => {
    const result = await logBodyMetricTool.handler(input as never, context as never);
    expect(result).toMatchObject({ isError: true });
    expect(mocks.supabaseForUser).not.toHaveBeenCalled();
  });

  it("records explicit units and an ISO timestamp with an offset", async () => {
    const metric = query({ data: { id: "metric-1" }, error: null });
    mocks.supabaseForUser.mockReturnValue({ from: vi.fn(() => metric) });
    const result = await logBodyMetricTool.handler(
      {
        weight_kg: 80.5,
        recorded_at: "2026-09-11T12:00:00-07:00",
        note: " Check-in ",
      } as never,
      context as never,
    );
    expect(result).not.toHaveProperty("isError", true);
    expect(metric.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        weight_kg: 80.5,
        recorded_at: "2026-09-11T12:00:00-07:00",
        note: "Check-in",
      }),
    );
  });
});

describe("MCP program read integrity", () => {
  it("reports a failed schedule query instead of claiming there are no upcoming workouts", async () => {
    const enrollments = query({ data: [{ id: "enrollment-1" }], error: null });
    const upcoming = query({ data: null, error: { message: "database timeout" } });
    mocks.supabaseForUser.mockReturnValue({
      from: vi.fn((table) => (table === "program_enrollments" ? enrollments : upcoming)),
    });
    const result = await getProgramStatusTool.handler({}, context as never);
    expect(result).toMatchObject({ isError: true });
    expect(result).not.toHaveProperty("structuredContent");
    expect(result.content[0]?.text).toContain("Could not load upcoming sessions");
  });

  it("only reports an empty schedule after a successful query", async () => {
    mocks.supabaseForUser.mockReturnValue({ from: vi.fn(() => query({ data: [], error: null })) });
    const result = await getProgramStatusTool.handler({}, context as never);
    expect(result).toMatchObject({ structuredContent: { enrollments: [], upcoming: [] } });
  });

  it("does not create a database client for an unauthenticated tool call", async () => {
    const result = await getProgramStatusTool.handler({}, {
      isAuthenticated: () => false,
    } as never);
    expect(result).toMatchObject({ isError: true });
    expect(mocks.supabaseForUser).not.toHaveBeenCalled();
  });
});
