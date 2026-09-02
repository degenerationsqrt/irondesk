import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("../src/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: vi.fn(), getUser: vi.fn() },
    from: mocks.from,
    rpc: mocks.rpc,
  },
}));

import {
  addSessionExercise,
  addSet,
  applyBlackWorkoutPlan,
  deleteSet,
  getWorkoutSessionState,
  isWorkoutTerminalConflictError,
  markWorkoutFinished,
  removeSessionExercise,
  setSessionExerciseMethod,
  substituteSessionExercise,
  updateSessionMeta,
  updateSet,
  WorkoutTerminalConflictError,
  type BlackWorkoutApplicationInput,
} from "../src/lib/irondesk/repo";

function abortableResponse<T>(value: T) {
  const request = Promise.resolve(value) as Promise<T> & {
    abortSignal: ReturnType<typeof vi.fn>;
  };
  request.abortSignal = vi.fn(() => request);
  return request;
}

function abortableBuilder<T>(value: T) {
  const request = abortableResponse(value) as ReturnType<typeof abortableResponse<T>> &
    Record<string, ReturnType<typeof vi.fn>>;
  for (const method of ["delete", "eq", "insert", "maybeSingle", "select", "single", "update"]) {
    request[method] = vi.fn(() => request);
  }
  return request;
}

const SESSION_ID = "00000000-0000-4000-a000-000000000001";
const WINDOW_ID = "00000000-0000-4000-a000-000000000002";
const APPLICATION_ID = "00000000-0000-4000-a000-000000000003";
const SESSION_EXERCISE_ID = "00000000-0000-4000-a000-000000000004";
const EXERCISE_ID = "00000000-0000-4000-a000-000000000005";
const SET_ID = "00000000-0000-4000-a000-000000000006";
const COMPLETED_AT = "2026-09-01T18:45:00.000Z";

function blackApplication(overrides: Partial<BlackWorkoutApplicationInput> = {}) {
  return {
    applicationId: APPLICATION_ID,
    sessionId: SESSION_ID,
    windowId: WINDOW_ID,
    targetRegion: "Shoulders",
    weekStart: "2026-08-31",
    prescriptions: [
      {
        exerciseId: EXERCISE_ID,
        exerciseName: "DB Press",
        modifierId: "drop-sets",
        modifierName: "Drop Sets",
        loadPercent: 85,
        loadKg: 38.5,
        sets: 3,
        reps: 10,
        structure: { drops: 1, dropPercent: 20 },
        intraSetRestSeconds: 0,
        interSetRestSeconds: 120,
        expectedRir: 1,
        stopRule: "Stop when execution quality drops.",
      },
    ],
    targets: [
      {
        sessionExerciseId: SESSION_EXERCISE_ID,
        methodConfig: { blackWindowId: WINDOW_ID },
        sets: [
          {
            id: SET_ID,
            setNumber: 1,
            weightKg: 38.5,
            reps: 10,
            rpe: 8.5,
            restSeconds: 120,
            methodSegment: "black-working",
            methodSegmentConfig: {
              methodId: "irondesk-black",
              blackWindowId: WINDOW_ID,
              restSeconds: 120,
            },
          },
        ],
      },
    ],
    ...overrides,
  } satisfies BlackWorkoutApplicationInput;
}

beforeEach(() => {
  mocks.from.mockReset();
  mocks.rpc.mockReset();
});

describe("workout terminal repository contract", () => {
  it("passes a durable completion timestamp and AbortSignal to the idempotent RPC", async () => {
    const request = abortableResponse({
      data: {
        session_id: SESSION_ID,
        status: "completed",
        completed_at: COMPLETED_AT,
        applied: true,
        replayed: true,
        recovered: false,
        requires_timestamp_repair: false,
      },
      error: null,
    });
    mocks.rpc.mockReturnValue(request);
    const controller = new AbortController();

    await expect(
      markWorkoutFinished(SESSION_ID, COMPLETED_AT, { signal: controller.signal }),
    ).resolves.toEqual({
      sessionId: SESSION_ID,
      status: "completed",
      completedAt: COMPLETED_AT,
      applied: true,
      replayed: true,
      recovered: false,
      requiresTimestampRepair: false,
    });

    expect(mocks.rpc).toHaveBeenCalledWith("transition_workout_session_terminal", {
      _session_id: SESSION_ID,
      _terminal_status: "completed",
      _completed_at: COMPLETED_AT,
      _allow_cancelled_recovery: false,
    });
    expect(request.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it("passes explicit cancelled-session recovery without changing the supplied timestamp", async () => {
    mocks.rpc.mockReturnValue(
      abortableResponse({
        data: {
          session_id: SESSION_ID,
          status: "completed",
          completed_at: COMPLETED_AT,
          applied: true,
          replayed: false,
          recovered: true,
          requires_timestamp_repair: false,
        },
        error: null,
      }),
    );

    const result = await markWorkoutFinished(SESSION_ID, COMPLETED_AT, {
      recoverCancelled: true,
    });

    expect(result).toMatchObject({ completedAt: COMPLETED_AT, recovered: true });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "transition_workout_session_terminal",
      expect.objectContaining({
        _completed_at: COMPLETED_AT,
        _allow_cancelled_recovery: true,
      }),
    );
  });

  it("classifies an opposite terminal state as a typed non-transient conflict", async () => {
    mocks.rpc.mockReturnValue(
      abortableResponse({
        data: null,
        error: {
          code: "P0001",
          message: "workout_terminal_conflict",
          details: JSON.stringify({ requested: "completed", actual: "cancelled" }),
          hint: null,
        },
      }),
    );

    let caught: unknown;
    try {
      await markWorkoutFinished(SESSION_ID, COMPLETED_AT);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkoutTerminalConflictError);
    expect(isWorkoutTerminalConflictError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: "conflict",
      terminalConflict: true,
      requestedStatus: "completed",
      actualStatus: "cancelled",
    });
  });

  it("surfaces a legacy same-terminal row whose timestamp needs repair", async () => {
    mocks.rpc.mockReturnValue(
      abortableResponse({
        data: {
          session_id: SESSION_ID,
          status: "completed",
          completed_at: null,
          applied: true,
          replayed: true,
          recovered: false,
          requires_timestamp_repair: true,
        },
        error: null,
      }),
    );

    await expect(markWorkoutFinished(SESSION_ID, COMPLETED_AT)).resolves.toMatchObject({
      completedAt: null,
      replayed: true,
      requiresTimestampRepair: true,
    });
  });

  it("fetches one session state directly and abortably for recovery", async () => {
    const response = abortableResponse({
      data: {
        id: SESSION_ID,
        status: "cancelled",
        started_at: "2026-09-01T17:45:00.000Z",
        completed_at: COMPLETED_AT,
      },
      error: null,
    });
    const returns = vi.fn(() => response);
    const maybeSingle = vi.fn(() => ({ returns }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    mocks.from.mockReturnValue({ select });
    const controller = new AbortController();

    await expect(
      getWorkoutSessionState(SESSION_ID, { signal: controller.signal }),
    ).resolves.toEqual({
      id: SESSION_ID,
      status: "cancelled",
      startedAt: "2026-09-01T17:45:00.000Z",
      completedAt: COMPLETED_AT,
    });
    expect(mocks.from).toHaveBeenCalledWith("workout_sessions");
    expect(eq).toHaveBeenCalledWith("id", SESSION_ID);
    expect(response.abortSignal).toHaveBeenCalledWith(controller.signal);
  });
});

describe("queued workout mutation cancellation", () => {
  it("passes one AbortSignal through every non-terminal repository write", async () => {
    const request = abortableBuilder({
      data: {
        id: SET_ID,
        exercise_id: EXERCISE_ID,
        original_exercise_id: null,
      },
      error: null,
    });
    mocks.from.mockReturnValue(request);
    const signal = new AbortController().signal;

    await addSet(
      SESSION_EXERCISE_ID,
      { weightKg: 38.5, reps: 10, rpe: 8.5 },
      { id: SET_ID, setNumber: 1 },
      { signal },
    );
    await updateSet(SET_ID, { reps: 9 }, { signal });
    await deleteSet(SET_ID, { signal });
    await addSessionExercise(
      SESSION_ID,
      { exerciseId: EXERCISE_ID, name: "DB Press" },
      { id: SESSION_EXERCISE_ID, position: 0 },
      { signal },
    );
    await removeSessionExercise(SESSION_EXERCISE_ID, { signal });
    await substituteSessionExercise(
      SESSION_EXERCISE_ID,
      { exerciseId: EXERCISE_ID, name: "DB Press" },
      { signal },
    );
    await setSessionExerciseMethod(
      { sessionExerciseId: SESSION_EXERCISE_ID, methodId: "double-progression" },
      { signal },
    );
    await updateSessionMeta(SESSION_ID, { title: "Shoulders" }, { signal });

    // Substitute performs a read and a write; each other mutation performs one request.
    expect(request.abortSignal).toHaveBeenCalledTimes(9);
    for (const [received] of request.abortSignal.mock.calls) expect(received).toBe(signal);
  });
});

describe("atomic IronDesk Black repository contract", () => {
  it("sends stable ids and bounded canonical values through one abortable RPC", async () => {
    const request = abortableResponse({
      data: {
        application_id: APPLICATION_ID,
        exposure_id: APPLICATION_ID,
        session_id: SESSION_ID,
        window_id: WINDOW_ID,
        applied: true,
        replayed: false,
        exercise_count: 1,
        set_count: 1,
      },
      error: null,
    });
    mocks.rpc.mockReturnValue(request);
    const controller = new AbortController();

    await expect(
      applyBlackWorkoutPlan(blackApplication(), { signal: controller.signal }),
    ).resolves.toEqual({
      applicationId: APPLICATION_ID,
      exposureId: APPLICATION_ID,
      sessionId: SESSION_ID,
      windowId: WINDOW_ID,
      applied: true,
      replayed: false,
      exerciseCount: 1,
      setCount: 1,
    });

    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const [, payload] = mocks.rpc.mock.calls[0]!;
    expect(payload).toMatchObject({
      _application_id: APPLICATION_ID,
      _session_id: SESSION_ID,
      _window_id: WINDOW_ID,
      _target_region: "Shoulders",
      _week_start: "2026-08-31",
    });
    expect(payload._targets[0]).toMatchObject({
      sessionExerciseId: SESSION_EXERCISE_ID,
      methodConfig: { blackWindowId: WINDOW_ID },
      sets: [
        expect.objectContaining({
          id: SET_ID,
          setNumber: 1,
          weightKg: 38.5,
          reps: 10,
          rpe: 8.5,
          restSeconds: 120,
          methodSegment: "black-working",
          isWarmup: false,
        }),
      ],
    });
    expect(request.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it.each([
    ["rpe", 8.25, "RPE must be blank or a number from 1 to 10 in 0.5 increments."],
    ["reps", 501, "Reps must be a whole number from 0 to 500."],
    ["weightKg", 1000.01, "Weight must be a finite"],
    ["restSeconds", 3601, "Rest must be blank or a whole number"],
  ] as const)("rejects an invalid %s before the RPC", async (field, value, message) => {
    const input = blackApplication();
    const set = input.targets[0]!.sets[0]!;
    const invalid = blackApplication({
      targets: [
        {
          ...input.targets[0]!,
          sets: [{ ...set, [field]: value }],
        },
      ],
    });

    await expect(applyBlackWorkoutPlan(invalid)).rejects.toMatchObject({
      code: "validation",
      message: expect.stringContaining(message),
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("distinguishes application-id reuse from the weekly exposure conflict", async () => {
    mocks.rpc.mockReturnValue(
      abortableResponse({
        data: null,
        error: {
          code: "P0001",
          message: "black_application_id_conflict",
          details: null,
          hint: null,
        },
      }),
    );

    await expect(applyBlackWorkoutPlan(blackApplication())).rejects.toMatchObject({
      code: "conflict",
      message: "That IronDesk Black application id is already attached to a different request.",
    });
  });
});
