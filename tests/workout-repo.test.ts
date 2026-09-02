import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getSession: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../src/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: mocks.getSession, getUser: mocks.getUser },
    from: mocks.from,
  },
}));

import {
  addSet,
  assertAuthenticatedUser,
  createPersonalWorkoutTemplate,
  deletePersonalWorkoutTemplate,
  isTemplateVisibleInLibrary,
  logCardioSession,
  startWorkoutFromTemplate,
} from "../src/lib/irondesk/repo";

describe("idempotent workout row inserts", () => {
  it("confirms a response-lost set insert by the same client-generated primary key", async () => {
    const insertSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const insertSelect = vi.fn(() => ({ single: insertSingle }));
    const insert = vi.fn(() => ({ select: insertSelect }));
    const confirmMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "00000000-0000-4000-a000-000000000010" },
      error: null,
    });
    const confirmEq = vi.fn(() => ({ maybeSingle: confirmMaybeSingle }));
    const confirmSelect = vi.fn(() => ({ eq: confirmEq }));
    let calls = 0;
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe("workout_sets");
      calls += 1;
      return calls === 1 ? { insert } : { select: confirmSelect };
    });

    await expect(
      addSet(
        "session-exercise-1",
        { weightKg: 100, reps: 5, rpe: 8 },
        { id: "00000000-0000-4000-a000-000000000010", setNumber: 2 },
      ),
    ).resolves.toBe("00000000-0000-4000-a000-000000000010");
    expect(insert).toHaveBeenCalledWith({
      id: "00000000-0000-4000-a000-000000000010",
      session_exercise_id: "session-exercise-1",
      set_number: 2,
      weight_kg: 100,
      reps: 5,
      rpe: 8,
      is_warmup: false,
      method_segment: null,
      method_segment_config: {},
    });
    expect(confirmEq).toHaveBeenCalledWith("id", "00000000-0000-4000-a000-000000000010");
  });
});

describe("workout set write validation", () => {
  it("persists a blank RPE as null", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "set-null-rpe" }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mocks.from.mockReturnValue({ insert });

    await expect(
      addSet(
        "session-exercise-1",
        { weightKg: 100, reps: 5, rpe: null },
        { id: "set-null-rpe", setNumber: 1 },
      ),
    ).resolves.toBe("set-null-rpe");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ rpe: null }));
  });

  it.each([0, 8.25, 10.5, 11.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "blocks invalid RPE %s before any Supabase request",
    async (rpe) => {
      await expect(
        addSet(
          "session-exercise-1",
          { weightKg: 100, reps: 5, rpe },
          { id: "00000000-0000-4000-a000-000000000010", setNumber: 2 },
        ),
      ).rejects.toMatchObject({
        code: "validation",
        message: "RPE must be blank or a number from 1 to 10 in 0.5 increments.",
      });
      expect(mocks.from).not.toHaveBeenCalled();
    },
  );
});

beforeEach(() => {
  mocks.from.mockReset();
  mocks.getSession.mockReset();
  mocks.getUser.mockReset();
  mocks.getSession.mockResolvedValue({
    data: { session: { user: { id: "user-1" } } },
    error: null,
  });
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
});

describe("queued mutation account guard", () => {
  it("checks the locally persisted session without a server getUser request", async () => {
    await expect(assertAuthenticatedUser("user-1")).resolves.toBeUndefined();
    expect(mocks.getSession).toHaveBeenCalledOnce();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("blocks a replay after the browser switches to another account", async () => {
    mocks.getSession.mockResolvedValue({
      data: { session: { user: { id: "user-2" } } },
      error: null,
    });
    await expect(assertAuthenticatedUser("user-1")).rejects.toMatchObject({
      code: "unauthenticated",
      message: "This queued change belongs to a different signed-in account.",
    });
  });
});

describe("manual cardio repository write", () => {
  it("inserts exactly one completed cardio row and no workout session", async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: "cardio-1" }, error: null });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mocks.from.mockImplementation((table: string) => {
      if (table !== "cardio_sessions") throw new Error(`Unexpected table: ${table}`);
      return { insert };
    });

    await expect(
      logCardioSession({
        name: "Run",
        startedAt: "2026-08-29T01:30:00.000Z",
        durationMin: 42,
        distanceKm: null,
        calories: null,
        avgHr: null,
        maxHr: null,
        activeZoneMinutes: null,
        cardioLoad: null,
        notes: null,
      }),
    ).resolves.toBe("cardio-1");

    expect(mocks.from).toHaveBeenCalledTimes(1);
    expect(mocks.from).toHaveBeenCalledWith("cardio_sessions");
    expect(insert).toHaveBeenCalledWith({
      user_id: "user-1",
      session_id: null,
      name: "Run",
      started_at: "2026-08-29T01:30:00.000Z",
      duration_min: 42,
      distance_km: null,
      calories: null,
      avg_hr: null,
      max_hr: null,
      cardio_load: null,
      active_zone_minutes: null,
      zones: [],
      notes: null,
      is_sample: false,
    });
  });
});

describe("personal workout template repository writes", () => {
  const draft = {
    name: " Pull day ",
    focus: " Back and arms ",
    exercises: [
      { exerciseId: "exercise-1", name: "Stale client name", targetSets: 3, targetReps: "8-10" },
      { exerciseId: "exercise-2", name: "Another stale name", targetSets: 4, targetReps: "6" },
    ],
  };

  it("re-reads canonical exercises and saves ordered owner-scoped children", async () => {
    const libraryEq = vi.fn().mockResolvedValue({
      data: [
        { id: "exercise-1", name: "Lat Pulldown" },
        { id: "exercise-2", name: "Cable Row" },
      ],
      error: null,
    });
    const libraryIn = vi.fn(() => ({ eq: libraryEq }));
    const librarySelect = vi.fn(() => ({ in: libraryIn }));
    const parentSingle = vi.fn().mockResolvedValue({ data: { id: "template-1" }, error: null });
    const parentSelect = vi.fn(() => ({ single: parentSingle }));
    const parentInsert = vi.fn(() => ({ select: parentSelect }));
    const childInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const finalizeMaybeSingle = vi
      .fn()
      .mockResolvedValue({ data: { id: "template-1" }, error: null });
    const finalizeQuery = {
      eq: vi.fn(),
      select: vi.fn(() => ({ maybeSingle: finalizeMaybeSingle })),
    };
    finalizeQuery.eq.mockReturnValue(finalizeQuery);
    const finalizeUpdate = vi.fn(() => finalizeQuery);
    let workoutTemplateCalls = 0;

    mocks.from.mockImplementation((table: string) => {
      if (table === "exercises") return { select: librarySelect };
      if (table === "template_exercises") return { insert: childInsert };
      if (table === "workout_templates") {
        workoutTemplateCalls += 1;
        return workoutTemplateCalls === 1 ? { insert: parentInsert } : { update: finalizeUpdate };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(createPersonalWorkoutTemplate(draft)).resolves.toBe("template-1");
    expect(parentInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        name: "Pull day",
        focus: "Back and arms",
        is_system: false,
        category: "strength",
        release_gate: "coach_review",
        requires_acknowledgment: true,
        library_startable: false,
      }),
    );
    expect(childInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        template_id: "template-1",
        exercise_id: "exercise-1",
        exercise_name: "Lat Pulldown",
        position: 0,
        target_sets: 3,
        target_reps: "8-10",
      }),
      expect.objectContaining({
        template_id: "template-1",
        exercise_id: "exercise-2",
        exercise_name: "Cable Row",
        position: 1,
        target_sets: 4,
        target_reps: "6",
      }),
    ]);
    expect(finalizeUpdate).toHaveBeenCalledWith({
      release_gate: "public",
      requires_acknowledgment: false,
      library_startable: true,
    });
    expect(finalizeQuery.eq).toHaveBeenCalledWith("id", "template-1");
    expect(finalizeQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(finalizeQuery.eq).toHaveBeenCalledWith("is_system", false);
    expect(finalizeQuery.eq).toHaveBeenCalledWith("release_gate", "coach_review");
    expect(finalizeQuery.eq).toHaveBeenCalledWith("library_startable", false);
    expect(finalizeQuery.select).toHaveBeenCalledWith("id");
  });

  it("refuses an ineligible or unsafe method before creating a personal template", async () => {
    const libraryEq = vi.fn().mockResolvedValue({
      data: [{ id: "exercise-1", name: "Back Squat", equipment: "Barbell" }],
      error: null,
    });
    const libraryIn = vi.fn(() => ({ eq: libraryEq }));
    const librarySelect = vi.fn(() => ({ in: libraryIn }));
    mocks.from.mockImplementation((table: string) => {
      if (table === "exercises") return { select: librarySelect };
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(
      createPersonalWorkoutTemplate(
        {
          name: "Unsafe method",
          exercises: [
            {
              exerciseId: "exercise-1",
              name: "Back Squat",
              targetSets: 3,
              targetReps: "8",
              trainingMethodId: "drop-sets",
            },
          ],
        },
        {
          experience: "expert",
          monthsTraining: 36,
          sessionsLast28Days: 14,
          averageReadiness: 80,
          specializationWindowOpen: false,
        },
      ),
    ).rejects.toThrow(/Back Squat:.*not permitted/i);
    expect(mocks.from).toHaveBeenCalledTimes(1);
  });

  it("deletes the new personal parent when child creation fails", async () => {
    const library = {
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: "exercise-1", name: "Lat Pulldown" },
              { id: "exercise-2", name: "Cable Row" },
            ],
            error: null,
          }),
        })),
      })),
    };
    const parentInsert = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: "template-partial" }, error: null }),
        })),
      })),
    };
    const childInsert = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "child insert failed" },
    });
    const cleanupResult = { data: null, error: null };
    const cleanupQuery = {
      eq: vi.fn(),
      then: (resolve: (value: typeof cleanupResult) => unknown) =>
        Promise.resolve(cleanupResult).then(resolve),
    };
    cleanupQuery.eq.mockReturnValue(cleanupQuery);
    const cleanupDelete = vi.fn(() => cleanupQuery);
    let workoutTemplateCalls = 0;

    mocks.from.mockImplementation((table: string) => {
      if (table === "exercises") return library;
      if (table === "template_exercises") return { insert: childInsert };
      if (table === "workout_templates") {
        workoutTemplateCalls += 1;
        return workoutTemplateCalls === 1 ? parentInsert : { delete: cleanupDelete };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(createPersonalWorkoutTemplate(draft)).rejects.toThrow("child insert failed");
    expect(cleanupDelete).toHaveBeenCalledOnce();
    expect(cleanupQuery.eq).toHaveBeenCalledWith("id", "template-partial");
    expect(cleanupQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(cleanupQuery.eq).toHaveBeenCalledWith("is_system", false);
    expect(cleanupQuery.eq).toHaveBeenCalledWith("release_gate", "coach_review");
    expect(cleanupQuery.eq).toHaveBeenCalledWith("library_startable", false);
  });

  it("removes the staged parent when finalization fails after children were saved", async () => {
    const library = {
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({
            data: [
              { id: "exercise-1", name: "Lat Pulldown" },
              { id: "exercise-2", name: "Cable Row" },
            ],
            error: null,
          }),
        })),
      })),
    };
    const parentInsert = {
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: "template-staged" }, error: null }),
        })),
      })),
    };
    const childInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    const finalizeMaybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "finalize update failed" },
    });
    const finalizeQuery = {
      eq: vi.fn(),
      select: vi.fn(() => ({ maybeSingle: finalizeMaybeSingle })),
    };
    finalizeQuery.eq.mockReturnValue(finalizeQuery);
    const finalizeUpdate = vi.fn(() => finalizeQuery);
    const cleanupResult = { data: null, error: null };
    const cleanupQuery = {
      eq: vi.fn(),
      then: (resolve: (value: typeof cleanupResult) => unknown) =>
        Promise.resolve(cleanupResult).then(resolve),
    };
    cleanupQuery.eq.mockReturnValue(cleanupQuery);
    const cleanupDelete = vi.fn(() => cleanupQuery);
    let workoutTemplateCalls = 0;

    mocks.from.mockImplementation((table: string) => {
      if (table === "exercises") return library;
      if (table === "template_exercises") return { insert: childInsert };
      if (table === "workout_templates") {
        workoutTemplateCalls += 1;
        if (workoutTemplateCalls === 1) return parentInsert;
        if (workoutTemplateCalls === 2) return { update: finalizeUpdate };
        return { delete: cleanupDelete };
      }
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(createPersonalWorkoutTemplate(draft)).rejects.toThrow("finalize update failed");
    expect(childInsert).toHaveBeenCalledOnce();
    expect(finalizeUpdate).toHaveBeenCalledWith({
      release_gate: "public",
      requires_acknowledgment: false,
      library_startable: true,
    });
    expect(cleanupDelete).toHaveBeenCalledOnce();
    expect(cleanupQuery.eq).toHaveBeenCalledWith("id", "template-staged");
    expect(cleanupQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(cleanupQuery.eq).toHaveBeenCalledWith("is_system", false);
    expect(cleanupQuery.eq).toHaveBeenCalledWith("release_gate", "coach_review");
    expect(cleanupQuery.eq).toHaveBeenCalledWith("library_startable", false);
  });

  it("hides staged personal rows while retaining assignment-only system rows", () => {
    expect(
      isTemplateVisibleInLibrary({
        is_system: false,
        release_gate: "coach_review",
        requires_acknowledgment: true,
        library_startable: false,
      }),
    ).toBe(false);
    expect(
      isTemplateVisibleInLibrary({
        is_system: false,
        release_gate: "public",
        requires_acknowledgment: false,
        library_startable: true,
      }),
    ).toBe(true);
    expect(
      isTemplateVisibleInLibrary({
        is_system: true,
        release_gate: "coach_review",
        requires_acknowledgment: true,
        library_startable: false,
      }),
    ).toBe(true);
  });

  it("refuses to delete an IronDesk Original before issuing a delete", async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: { id: "system-1", user_id: null, is_system: true },
      error: null,
    });
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const remove = vi.fn();
    mocks.from.mockReturnValue({ ...query, delete: remove });

    await expect(deletePersonalWorkoutTemplate("system-1")).rejects.toThrow(
      "IronDesk Originals cannot be deleted",
    );
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes an explicitly verified owner-scoped personal template", async () => {
    const existingMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "personal-1", user_id: "user-1", is_system: false },
      error: null,
    });
    const existingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: existingMaybeSingle,
    };
    existingQuery.select.mockReturnValue(existingQuery);
    existingQuery.eq.mockReturnValue(existingQuery);

    const removedSelect = vi.fn().mockResolvedValue({
      data: [{ id: "personal-1" }],
      error: null,
    });
    const removedQuery = { eq: vi.fn(), select: removedSelect };
    removedQuery.eq.mockReturnValue(removedQuery);
    const remove = vi.fn(() => removedQuery);
    let calls = 0;
    mocks.from.mockImplementation((table: string) => {
      expect(table).toBe("workout_templates");
      calls += 1;
      return calls === 1 ? existingQuery : { delete: remove };
    });

    await expect(deletePersonalWorkoutTemplate("personal-1")).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledOnce();
    expect(removedQuery.eq).toHaveBeenCalledWith("id", "personal-1");
    expect(removedQuery.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(removedQuery.eq).toHaveBeenCalledWith("is_system", false);
    expect(removedSelect).toHaveBeenCalledWith("id");
  });

  it("preserves structured PostgREST diagnostics when an owner delete fails", async () => {
    const existingMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "personal-2", user_id: "user-1", is_system: false },
      error: null,
    });
    const existingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: existingMaybeSingle,
    };
    existingQuery.select.mockReturnValue(existingQuery);
    existingQuery.eq.mockReturnValue(existingQuery);

    const removedSelect = vi.fn().mockResolvedValue({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table workout_templates",
        details: "RLS rejected the delete",
        hint: "Check the active session and project",
      },
    });
    const removedQuery = { eq: vi.fn(), select: removedSelect };
    removedQuery.eq.mockReturnValue(removedQuery);
    let calls = 0;
    mocks.from.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? existingQuery : { delete: vi.fn(() => removedQuery) };
    });

    await expect(deletePersonalWorkoutTemplate("personal-2")).rejects.toMatchObject({
      code: "database",
      message:
        "IronDesk could not delete that personal workout. Reference: workout-template-delete/42501.",
      diagnostic: {
        operation: "workout-template-delete",
        code: "42501",
        details: "RLS rejected the delete",
        hint: "Check the active session and project",
      },
    });
  });

  it("reports a conflict when a verified owner delete affects zero rows", async () => {
    const existingMaybeSingle = vi.fn().mockResolvedValue({
      data: { id: "personal-3", user_id: "user-1", is_system: false },
      error: null,
    });
    const existingQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: existingMaybeSingle,
    };
    existingQuery.select.mockReturnValue(existingQuery);
    existingQuery.eq.mockReturnValue(existingQuery);

    const removedSelect = vi.fn().mockResolvedValue({ data: [], error: null });
    const removedQuery = { eq: vi.fn(), select: removedSelect };
    removedQuery.eq.mockReturnValue(removedQuery);
    let calls = 0;
    mocks.from.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? existingQuery : { delete: vi.fn(() => removedQuery) };
    });

    await expect(deletePersonalWorkoutTemplate("personal-3")).rejects.toMatchObject({
      code: "conflict",
      message: "That personal workout was not deleted. Refresh and try again.",
    });
  });
});

describe("method-aware template start", () => {
  it("preflights the canonical movement and hydrates the selected method into the session", async () => {
    const activeReturns = vi.fn().mockResolvedValue({ data: [], error: null });
    const activeLimit = vi.fn(() => ({ returns: activeReturns }));
    const activeOrder = vi.fn(() => ({ limit: activeLimit }));
    const activeIn = vi.fn(() => ({ order: activeOrder }));
    const activeSelect = vi.fn(() => ({ in: activeIn }));

    const templateRow = {
      id: "template-method",
      user_id: "user-1",
      name: "Cable intensity",
      focus: "Chest",
      notes: null,
      is_system: false,
      source_key: null,
      source_name: null,
      source_version: 1,
      environment: "gym",
      workout_type: "pump",
      category: "strength",
      level: null,
      estimated_minutes: 30,
      tags: ["custom"],
      sort_order: 1,
      legacy_day_id: null,
      release_gate: "public",
      requires_acknowledgment: false,
      library_startable: true,
      warnings: [],
      template_exercises: [
        {
          id: "te-1",
          exercise_id: "exercise-1",
          exercise_name: "Cable Fly",
          position: 0,
          target_sets: 3,
          target_reps: "10",
          target_rpe: null,
          rest_seconds: 60,
          load_guidance: null,
          source_load_unit: null,
          is_drop_set: false,
          is_heavy: false,
          notes: null,
          training_method_id: "drop-sets",
          training_method_config: { drops: 2, dropPercent: 20 },
        },
      ],
    };
    const templateReturns = vi.fn().mockResolvedValue({ data: templateRow, error: null });
    const templateMaybeSingle = vi.fn(() => ({ returns: templateReturns }));
    const templateEq = vi.fn(() => ({ maybeSingle: templateMaybeSingle }));
    const templateSelect = vi.fn(() => ({ eq: templateEq }));

    const exerciseIn = vi.fn().mockResolvedValue({
      data: [
        {
          id: "exercise-1",
          name: "Cable Fly",
          primary_muscle: "Chest",
          equipment: "Cable",
        },
      ],
      error: null,
    });
    const exerciseSelect = vi.fn(() => ({ in: exerciseIn }));

    const sessionSingle = vi.fn().mockResolvedValue({ data: { id: "session-1" }, error: null });
    const sessionInsertSelect = vi.fn(() => ({ single: sessionSingle }));
    const sessionInsert = vi.fn(() => ({ select: sessionInsertSelect }));
    const exerciseRowsSelect = vi
      .fn()
      .mockResolvedValue({ data: [{ id: "session-exercise-1", position: 0 }], error: null });
    const sessionExerciseInsert = vi.fn(() => ({ select: exerciseRowsSelect }));
    const setInsert = vi.fn().mockResolvedValue({ data: null, error: null });
    let workoutSessionCalls = 0;

    mocks.from.mockImplementation((table: string) => {
      if (table === "workout_sessions") {
        workoutSessionCalls += 1;
        return workoutSessionCalls === 1 ? { select: activeSelect } : { insert: sessionInsert };
      }
      if (table === "workout_templates") return { select: templateSelect };
      if (table === "exercises") return { select: exerciseSelect };
      if (table === "session_exercises") return { insert: sessionExerciseInsert };
      if (table === "workout_sets") return { insert: setInsert };
      throw new Error(`Unexpected table: ${table}`);
    });

    await expect(
      startWorkoutFromTemplate("template-method", {
        experience: "advanced",
        monthsTraining: 36,
        sessionsLast28Days: 14,
        averageReadiness: 80,
        specializationWindowOpen: false,
      }),
    ).resolves.toBe("session-1");

    expect(sessionExerciseInsert).toHaveBeenCalledWith([
      expect.objectContaining({
        exercise_name: "Cable Fly",
        training_method_id: "drop-sets",
        training_method_config: { drops: 2, dropPercent: 20 },
      }),
    ]);
    expect(setInsert).toHaveBeenCalledTimes(1);
  });
});
