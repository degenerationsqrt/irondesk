import type { SetEntry, WorkoutExercise } from "./types";
import type { QueuedWorkoutMutation, WorkoutMutation } from "./workout-mutation-outbox";
import { parseRepsDraft, parseRpeDraft, parseWeightDraft } from "./workout-values";

export type SetDraftField = "weight" | "reps" | "rpe";
export type SetDraftValues = Partial<Record<SetDraftField, string>>;
export type SetDrafts = Record<string, SetDraftValues>;

/** Capture validated values before async saves remove their raw input drafts. */
export function captureWorkoutDraftValues(
  exercises: readonly WorkoutExercise[],
  drafts: Readonly<SetDrafts>,
  toKilograms: (weight: number) => number,
): WorkoutExercise[] {
  return exercises.map((exercise) => ({
    ...exercise,
    sets: exercise.sets.map((set) => {
      const values = drafts[set.id];
      if (!values) return set;
      const result = { ...set };
      if (values.weight !== undefined) {
        const parsed = parseWeightDraft(values.weight, toKilograms);
        if (parsed.ok) result.weightKg = parsed.value;
      }
      if (values.reps !== undefined) {
        const parsed = parseRepsDraft(values.reps);
        if (parsed.ok) result.reps = parsed.value;
      }
      if (values.rpe !== undefined) {
        const parsed = parseRpeDraft(values.rpe);
        if (parsed.ok) result.rpe = parsed.value;
      }
      return result;
    }),
  }));
}

/** A field revision, rather than text equality, protects edits such as 13 → 14 → 13. */
export function clearSavedSetDraft(
  drafts: SetDrafts,
  setId: string,
  field: SetDraftField,
  savedRevision: number,
  currentRevision: number,
): SetDrafts {
  if (savedRevision !== currentRevision || drafts[setId]?.[field] === undefined) return drafts;
  const fields = { ...drafts[setId] };
  delete fields[field];
  const next = { ...drafts };
  if (Object.keys(fields).length) next[setId] = fields;
  else delete next[setId];
  return next;
}

export interface WorkoutReadVersion {
  generation: string;
  writes: number;
  queue: string;
}

export function workoutQueueVersion(
  items: readonly QueuedWorkoutMutation[],
  lastAppliedAt: string | null,
): string {
  return JSON.stringify([
    lastAppliedAt,
    items.map((item) => [item.id, item.revision, item.state, item.attempts]),
  ]);
}

export function canApplyWorkoutRead(
  started: WorkoutReadVersion,
  current: WorkoutReadVersion,
  terminal: boolean,
): boolean {
  return (
    !terminal &&
    started.generation === current.generation &&
    started.writes === current.writes &&
    started.queue === current.queue
  );
}

function overlayFields<T extends object>(
  remote: T,
  local: T,
  fields: ReadonlySet<keyof T> | undefined,
): T {
  if (!fields?.size) return remote;
  const result = { ...remote };
  for (const key of fields) result[key] = local[key];
  return result;
}

/**
 * Server values win for untouched fields. Pending writes and raw input own only
 * their explicit fields/rows, so a watch completion can coexist with a local
 * weight draft. The caller rejects reads crossed by a write or account change.
 */
export function reconcileWorkoutExercises(
  current: readonly WorkoutExercise[],
  incoming: readonly WorkoutExercise[],
  mutations: readonly WorkoutMutation[],
  drafts: Readonly<SetDrafts>,
): WorkoutExercise[] {
  if (
    mutations.some(
      (mutation) => mutation.kind === "session.finish" || mutation.kind === "session.cancel",
    )
  ) {
    return [...current];
  }
  const local = new Map(
    current.map((exercise) => [
      exercise.id,
      { ...exercise, sets: exercise.sets.map((set) => ({ ...set })) },
    ]),
  );
  const setFields = new Map<string, Set<keyof SetEntry>>();
  const exerciseFields = new Map<string, Set<keyof WorkoutExercise>>();
  const keptExercises = new Set<string>();
  const wholeExercises = new Set<string>();
  const keptSets = new Set<string>();
  const removedExercises = new Set<string>();
  const removedSets = new Set<string>();
  const protectSet = (id: string, keys: readonly (keyof SetEntry)[]) => {
    setFields.set(id, new Set([...(setFields.get(id) ?? []), ...keys]));
    keptSets.add(id);
    const owner = current.find((exercise) => exercise.sets.some((set) => set.id === id));
    if (owner) keptExercises.add(owner.id);
  };
  const protectExercise = (id: string, keys: readonly (keyof WorkoutExercise)[]) => {
    exerciseFields.set(id, new Set([...(exerciseFields.get(id) ?? []), ...keys]));
    keptExercises.add(id);
  };

  for (const [id, fields] of Object.entries(drafts)) {
    protectSet(
      id,
      (Object.keys(fields) as SetDraftField[]).map((field) =>
        field === "weight" ? "weightKg" : field,
      ),
    );
  }
  for (const mutation of mutations) {
    switch (mutation.kind) {
      case "set.update": {
        const patch: Partial<SetEntry> = {};
        if (mutation.patch.weightKg !== undefined) patch.weightKg = mutation.patch.weightKg ?? 0;
        if (mutation.patch.reps !== undefined) patch.reps = mutation.patch.reps ?? 0;
        if (mutation.patch.rpe !== undefined) patch.rpe = mutation.patch.rpe;
        if (mutation.patch.completed !== undefined) patch.done = mutation.patch.completed;
        if (mutation.patch.isWarmup !== undefined) patch.isWarmup = mutation.patch.isWarmup;
        if (mutation.patch.restSeconds !== undefined)
          patch.restSeconds = mutation.patch.restSeconds;
        if (mutation.patch.notes !== undefined) patch.notes = mutation.patch.notes;
        if (mutation.patch.methodSegment !== undefined)
          patch.methodSegment = mutation.patch.methodSegment;
        if (mutation.patch.methodSegmentConfig !== undefined)
          patch.methodSegmentConfig = mutation.patch.methodSegmentConfig as Record<
            string,
            unknown
          > | null;
        protectSet(mutation.setId, Object.keys(patch) as (keyof SetEntry)[]);
        for (const exercise of local.values()) {
          exercise.sets = exercise.sets.map((set) =>
            set.id === mutation.setId ? { ...set, ...patch } : set,
          );
        }
        break;
      }
      case "set.add":
        keptSets.add(mutation.recordId);
        keptExercises.add(mutation.sessionExerciseId);
        protectSet(mutation.recordId, [
          "weightKg",
          "reps",
          "rpe",
          "done",
          "setNumber",
          "isWarmup",
          "restSeconds",
          "methodSegment",
          "methodSegmentConfig",
        ]);
        break;
      case "set.delete":
        removedSets.add(mutation.setId);
        break;
      case "exercise.add":
        keptExercises.add(mutation.recordId);
        wholeExercises.add(mutation.recordId);
        break;
      case "exercise.delete":
        removedExercises.add(mutation.sessionExerciseId);
        break;
      case "exercise.substitute": {
        protectExercise(mutation.sessionExerciseId, [
          "exerciseId",
          "name",
          "muscle",
          "equipment",
          "substitutedFrom",
        ]);
        const exercise = local.get(mutation.sessionExerciseId);
        if (exercise)
          Object.assign(exercise, {
            exerciseId: mutation.replacement.exerciseId,
            name: mutation.replacement.name,
            muscle: mutation.replacement.muscle ?? "—",
            equipment: mutation.replacement.equipment ?? "—",
          });
        break;
      }
      case "exercise.method": {
        protectExercise(mutation.sessionExerciseId, ["trainingMethodId", "trainingMethodConfig"]);
        const exercise = local.get(mutation.sessionExerciseId);
        if (exercise) {
          exercise.trainingMethodId = mutation.methodId;
          if (mutation.config !== undefined) exercise.trainingMethodConfig = mutation.config;
        }
        break;
      }
      case "black.apply":
        for (const target of mutation.input.targets) {
          keptExercises.add(target.sessionExerciseId);
          wholeExercises.add(target.sessionExerciseId);
        }
        break;
      case "session.meta":
        break;
    }
  }

  const incomingIds = new Set(incoming.map((exercise) => exercise.id));
  const result = incoming
    .filter((exercise) => !removedExercises.has(exercise.id))
    .map((remote) => {
      const existing = local.get(remote.id);
      if (!existing)
        return { ...remote, sets: remote.sets.filter((set) => !removedSets.has(set.id)) };
      if (wholeExercises.has(remote.id)) return existing;
      const existingSets = new Map(existing.sets.map((set) => [set.id, set]));
      const incomingSetIds = new Set(remote.sets.map((set) => set.id));
      const sets = remote.sets
        .filter((set) => !removedSets.has(set.id))
        .map((set) => {
          const old = existingSets.get(set.id);
          return old ? overlayFields(set, old, setFields.get(set.id)) : set;
        });
      for (const set of existing.sets) {
        if (!incomingSetIds.has(set.id) && keptSets.has(set.id) && !removedSets.has(set.id))
          sets.push(set);
      }
      return {
        ...overlayFields(remote, existing, exerciseFields.get(remote.id)),
        sets: sets.sort((a, b) => (a.setNumber ?? 0) - (b.setNumber ?? 0)),
      };
    });
  for (const exercise of local.values()) {
    if (
      !incomingIds.has(exercise.id) &&
      keptExercises.has(exercise.id) &&
      !removedExercises.has(exercise.id)
    ) {
      result.push({ ...exercise, sets: exercise.sets.filter((set) => !removedSets.has(set.id)) });
    }
  }
  return result.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
