import { describe, expect, it } from "vitest";
import {
  canApplyWorkoutRead,
  captureWorkoutDraftValues,
  clearSavedSetDraft,
  reconcileWorkoutExercises,
  workoutQueueVersion,
  type SetDrafts,
} from "../src/lib/irondesk/workout-reconciliation";
import type { SetEntry, WorkoutExercise } from "../src/lib/irondesk/types";
import type {
  QueuedWorkoutMutation,
  WorkoutMutation,
} from "../src/lib/irondesk/workout-mutation-outbox";

const set = (id = "set-1", patch: Partial<SetEntry> = {}): SetEntry => ({
  id,
  setNumber: 1,
  weightKg: 60,
  reps: 20,
  rpe: 8,
  done: false,
  ...patch,
});
const exercise = (id = "exercise-1", patch: Partial<WorkoutExercise> = {}): WorkoutExercise => ({
  id,
  exerciseId: "canonical-1",
  name: "Back Squat",
  muscle: "Quads",
  equipment: "Barbell",
  targetSets: 4,
  targetReps: "4",
  previous: "—",
  position: 0,
  sets: [set()],
  ...patch,
});
const queued = (patch: Partial<QueuedWorkoutMutation> = {}): QueuedWorkoutMutation => ({
  id: "mutation-1",
  revision: 1,
  userId: "owner",
  laneId: "session-1",
  sessionId: "session-1",
  createdAt: "2026-09-12T12:00:00Z",
  updatedAt: "2026-09-12T12:00:00Z",
  attempts: 0,
  nextAttemptAt: null,
  state: "pending",
  lastError: null,
  mutation: { kind: "set.update", setId: "set-1", patch: { weightKg: 65 } },
  ...patch,
});

describe("workout updates from another device", () => {
  it("reconciles untouched set values, including values on an incomplete set", () => {
    const current = [exercise()];
    const incoming = [
      exercise("exercise-1", { sets: [set("set-1", { weightKg: 70, reps: 8, rpe: 9 })] }),
    ];
    expect(reconcileWorkoutExercises(current, incoming, [], {})).toEqual(incoming);
    expect(current[0]!.sets[0]!.weightKg).toBe(60);
  });

  it("protects only the field being typed while accepting watch reps and completion", () => {
    const drafts = { "set-1": { weight: "135." } };
    const result = reconcileWorkoutExercises(
      [exercise()],
      [
        exercise("exercise-1", {
          sets: [set("set-1", { weightKg: 90, reps: 12, done: true })],
        }),
      ],
      [],
      drafts,
    );
    expect(result[0]!.sets[0]).toMatchObject({ weightKg: 60, reps: 12, done: true });
    expect(drafts["set-1"].weight).toBe("135.");
  });

  it("overlays the queued value even when the local base was loaded before that write", () => {
    const pending: WorkoutMutation[] = [
      { kind: "set.update", setId: "set-1", patch: { weightKg: 65, completed: false } },
    ];
    const result = reconcileWorkoutExercises(
      [exercise()],
      [
        exercise("exercise-1", {
          sets: [set("set-1", { weightKg: 90, reps: 12, rpe: 7, done: true })],
        }),
      ],
      pending,
      {},
    );
    expect(result[0]!.sets[0]).toMatchObject({ weightKg: 65, reps: 12, rpe: 7, done: false });
  });

  it("protects every supported queued set field, including null RPE and method context", () => {
    const patch = {
      weightKg: null,
      reps: null,
      rpe: null,
      completed: true,
      isWarmup: true,
      restSeconds: 90,
      notes: "local note",
      methodSegment: "drop-1",
      methodSegmentConfig: { methodId: "drop-sets" },
    };
    const result = reconcileWorkoutExercises(
      [exercise()],
      [exercise()],
      [{ kind: "set.update", setId: "set-1", patch }],
      {},
    );
    expect(result[0]!.sets[0]).toMatchObject({
      weightKg: 0,
      reps: 0,
      rpe: null,
      done: true,
      isWarmup: true,
      restSeconds: 90,
      notes: "local note",
      methodSegment: "drop-1",
      methodSegmentConfig: { methodId: "drop-sets" },
    });
  });

  it("applies pending patches in queue order without mutating either snapshot", () => {
    const current = [exercise()];
    const incoming = [exercise()];
    const before = structuredClone({ current, incoming });
    const result = reconcileWorkoutExercises(
      current,
      incoming,
      [
        { kind: "set.update", setId: "set-1", patch: { reps: 10 } },
        { kind: "set.update", setId: "set-1", patch: { reps: 12 } },
      ],
      {},
    );
    expect(result[0]!.sets[0]!.reps).toBe(12);
    expect({ current, incoming }).toEqual(before);
  });

  it("retains local added sets until their queued insertion is acknowledged", () => {
    const current = [
      exercise("exercise-1", { sets: [set(), set("set-2", { setNumber: 2, weightKg: 75 })] }),
    ];
    const result = reconcileWorkoutExercises(
      current,
      [exercise()],
      [
        {
          kind: "set.add",
          recordId: "set-2",
          sessionExerciseId: "exercise-1",
          setNumber: 2,
          input: { weightKg: 75, reps: 20, rpe: 8 },
        },
      ],
      {},
    );
    expect(result[0]!.sets.map((row) => row.id)).toEqual(["set-1", "set-2"]);
  });

  it("does not resurrect a set or exercise that has a pending local deletion", () => {
    const result = reconcileWorkoutExercises(
      [exercise("exercise-1", { sets: [] })],
      [exercise(), exercise("exercise-2")],
      [
        { kind: "set.delete", setId: "set-1" },
        { kind: "exercise.delete", sessionExerciseId: "exercise-2" },
      ],
      {},
    );
    expect(result.map((row) => row.id)).toEqual(["exercise-1"]);
    expect(result[0]!.sets).toEqual([]);
  });

  it("accepts remote row additions and deletions when there is no local intent", () => {
    const incoming = [exercise("exercise-2", { sets: [set("remote-set")] })];
    expect(reconcileWorkoutExercises([exercise()], incoming, [], {})).toEqual(incoming);
  });

  it("preserves an edited set and its exercise if the remote snapshot removed them", () => {
    const current = [exercise()];
    expect(reconcileWorkoutExercises(current, [], [], { "set-1": { reps: "25" } })).toEqual(
      current,
    );
  });

  it("preserves a pending exercise insertion missing from the server snapshot", () => {
    const current = [exercise("new-exercise", { sets: [] })];
    expect(
      reconcileWorkoutExercises(
        current,
        [],
        [
          {
            kind: "exercise.add",
            recordId: "new-exercise",
            sessionId: "session-1",
            position: 0,
            input: { name: "Back Squat" },
          },
        ],
        {},
      ),
    ).toEqual(current);
  });

  it("preserves local substitution and method fields while refreshing other fields", () => {
    const result = reconcileWorkoutExercises(
      [exercise()],
      [exercise("exercise-1", { targetReps: "6", sets: [set("set-1", { done: true })] })],
      [
        {
          kind: "exercise.substitute",
          sessionExerciseId: "exercise-1",
          replacement: {
            exerciseId: "canonical-2",
            name: "Leg Press",
            muscle: "Quads",
            equipment: "Machine",
          },
        },
        {
          kind: "exercise.method",
          sessionExerciseId: "exercise-1",
          methodId: "drop-sets",
          config: { drops: 2, dropPercent: 20 },
        },
      ],
      {},
    );
    expect(result[0]).toMatchObject({
      name: "Leg Press",
      equipment: "Machine",
      targetReps: "6",
      trainingMethodId: "drop-sets",
      trainingMethodConfig: { drops: 2, dropPercent: 20 },
    });
    expect(result[0]!.sets[0]!.done).toBe(true);
  });

  it.each(["session.finish", "session.cancel"] as const)(
    "keeps local terminal intent unchanged (%s)",
    (kind) => {
      const current = [exercise()];
      expect(
        reconcileWorkoutExercises(
          current,
          [],
          [{ kind, sessionId: "session-1", completedAt: "2026-09-12T12:00:00Z" }],
          {},
        ),
      ).toEqual(current);
    },
  );
});

describe("remote read ordering", () => {
  const version = { generation: "owner:session-1", writes: 4, queue: "queue-1" };
  it("accepts a current read only before terminal processing", () => {
    expect(canApplyWorkoutRead(version, { ...version }, false)).toBe(true);
    expect(canApplyWorkoutRead(version, version, true)).toBe(false);
  });
  it.each([
    { generation: "different-owner:session-1" },
    { generation: "owner:session-2" },
    { writes: 5 },
    { queue: "queue-2" },
  ])("rejects a stale response after a changed boundary: %j", (change) => {
    expect(canApplyWorkoutRead(version, { ...version, ...change }, false)).toBe(false);
  });
  it("detects outbox correction, replay attempts, blocked writes and completed drains", () => {
    const first = workoutQueueVersion([queued()], null);
    for (const change of [{ revision: 2 }, { attempts: 1 }, { state: "blocked" as const }]) {
      expect(workoutQueueVersion([queued(change)], null)).not.toBe(first);
    }
    expect(workoutQueueVersion([], "2026-09-12T12:00:01Z")).not.toBe(first);
  });
});

describe("set draft saves", () => {
  it("clears only the saved field and leaves another unsaved field intact", () => {
    const drafts = { "set-1": { weight: "135", reps: "20" } };
    expect(clearSavedSetDraft(drafts, "set-1", "weight", 1, 1)).toEqual({
      "set-1": { reps: "20" },
    });
    expect(drafts["set-1"].weight).toBe("135");
  });
  it("does not remove a newer draft when the earlier blur save resolves", async () => {
    let drafts: SetDrafts = { "set-1": { weight: "13" } };
    let revision = 1;
    let resolveSave!: () => void;
    const saved = new Promise<void>((resolve) => {
      resolveSave = resolve;
    }).then(() => {
      drafts = clearSavedSetDraft(drafts, "set-1", "weight", 1, revision);
    });
    drafts = { "set-1": { weight: "14" } };
    revision = 2;
    resolveSave();
    await saved;
    expect(drafts["set-1"]!.weight).toBe("14");
  });
  it("also protects the ABA case where newer input has the same text as the old save", () => {
    const drafts = { "set-1": { weight: "13" } };
    expect(clearSavedSetDraft(drafts, "set-1", "weight", 1, 3)).toBe(drafts);
  });
  it("captures the actual values for a finish summary before awaited saves clear the drafts", () => {
    const current = [
      exercise("exercise-1", { sets: [set("set-1", { done: true, weightKg: 10, reps: 4 })] }),
    ];
    let drafts: SetDrafts = { "set-1": { weight: "135", reps: "20", rpe: "" } };
    const captured = captureWorkoutDraftValues(current, drafts, (pounds) => pounds / 2.2046226218);
    for (const field of ["weight", "reps", "rpe"] as const)
      drafts = clearSavedSetDraft(drafts, "set-1", field, 1, 1);
    expect(drafts).toEqual({});
    expect(captured[0]!.sets[0]).toMatchObject({ reps: 20, rpe: null, done: true });
    expect(captured[0]!.sets[0]!.weightKg).toBeCloseTo(61.235, 2);
    expect(current[0]!.sets[0]!.reps).toBe(4);
  });
});
