import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("../src/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: mocks.getUser },
    from: mocks.from,
  },
}));

import {
  createPersonalWorkoutTemplate,
  deletePersonalWorkoutTemplate,
  isTemplateVisibleInLibrary,
  logCardioSession,
} from "../src/lib/irondesk/repo";

beforeEach(() => {
  mocks.from.mockReset();
  mocks.getUser.mockReset();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
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
});
