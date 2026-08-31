import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { IronDeskError } from "../src/lib/irondesk/errors";
import {
  BrowserWorkoutMutationStore,
  MemoryWorkoutMutationStore,
  WorkoutMutationOutbox,
  type WorkoutMutation,
  type WorkoutMutationExecutor,
} from "../src/lib/irondesk/workout-mutation-outbox";

const update = (reps: number): WorkoutMutation => ({
  kind: "set.update",
  setId: "set-1",
  patch: { reps },
});

describe("workout mutation outbox", () => {
  it("persists before the first network attempt and recovers in a new queue instance", async () => {
    const store = new MemoryWorkoutMutationStore();
    const firstExecutor = vi.fn<WorkoutMutationExecutor>();
    const first = new WorkoutMutationOutbox(store, firstExecutor, {
      isOnline: () => false,
      createId: () => "operation-1",
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });

    await expect(first.enqueue("user-a", update(8))).resolves.toEqual({
      itemId: "operation-1",
      status: "queued",
    });
    expect(firstExecutor).not.toHaveBeenCalled();
    expect(store.read()).toMatchObject([
      {
        id: "operation-1",
        userId: "user-a",
        mutation: { kind: "set.update", setId: "set-1", patch: { reps: 8 } },
      },
    ]);

    const recoveredExecutor = vi.fn<WorkoutMutationExecutor>().mockResolvedValue(undefined);
    const recovered = new WorkoutMutationOutbox(store, recoveredExecutor, {
      isOnline: () => true,
      now: () => new Date("2026-08-31T12:00:05.000Z"),
    });
    await recovered.flush("user-a");

    expect(recoveredExecutor).toHaveBeenCalledWith(update(8), "user-a");
    expect(store.read()).toEqual([]);
    expect(recovered.snapshot("user-a").lastAppliedAt).toBe("2026-08-31T12:00:05.000Z");
  });

  it("coalesces rapid edits while preserving fields from earlier patches", async () => {
    const store = new MemoryWorkoutMutationStore();
    let operation = 0;
    const queue = new WorkoutMutationOutbox(store, vi.fn(), {
      isOnline: () => false,
      createId: () => `operation-${++operation}`,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });

    await queue.enqueue("user-a", {
      kind: "set.update",
      setId: "set-1",
      patch: { weightKg: 100, reps: 5 },
    });
    await queue.enqueue("user-a", {
      kind: "set.update",
      setId: "set-1",
      patch: { reps: 6, rpe: 8 },
    });

    expect(store.read()).toMatchObject([
      {
        id: "operation-1",
        revision: 2,
        mutation: {
          kind: "set.update",
          setId: "set-1",
          patch: { weightKg: 100, reps: 6, rpe: 8 },
        },
      },
    ]);
  });

  it("does not drop a newer coalesced edit when an older revision finishes in flight", async () => {
    const store = new MemoryWorkoutMutationStore();
    let releaseFirst: (() => void) | undefined;
    const calls: WorkoutMutation[] = [];
    const executor: WorkoutMutationExecutor = vi.fn(async (mutation) => {
      calls.push(mutation);
      if (calls.length === 1) await new Promise<void>((resolve) => (releaseFirst = resolve));
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => true,
      createId: () => "operation-1",
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });

    const first = queue.enqueue("user-a", {
      kind: "set.update",
      setId: "set-1",
      patch: { weightKg: 90, reps: 5 },
    });
    await vi.waitFor(() => expect(executor).toHaveBeenCalledTimes(1));
    const second = queue.enqueue("user-a", {
      kind: "set.update",
      setId: "set-1",
      patch: { reps: 6 },
    });
    await expect(second).resolves.toMatchObject({ status: "queued" });
    releaseFirst?.();
    await expect(first).resolves.toMatchObject({ status: "applied" });

    expect(calls).toEqual([
      { kind: "set.update", setId: "set-1", patch: { weightKg: 90, reps: 5 } },
      { kind: "set.update", setId: "set-1", patch: { weightKg: 90, reps: 6 } },
    ]);
    expect(store.read()).toEqual([]);
  });

  it("retries connectivity failures but blocks validation failures", async () => {
    const transientStore = new MemoryWorkoutMutationStore();
    let now = new Date("2026-08-31T12:00:00.000Z");
    const transientExecutor = vi
      .fn<WorkoutMutationExecutor>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(undefined);
    const transientQueue = new WorkoutMutationOutbox(transientStore, transientExecutor, {
      isOnline: () => true,
      createId: () => "transient-1",
      now: () => now,
    });

    await expect(transientQueue.enqueue("user-a", update(9))).resolves.toMatchObject({
      status: "queued",
    });
    expect(transientStore.read()[0]).toMatchObject({ attempts: 1, state: "pending" });
    now = new Date("2026-08-31T12:00:02.000Z");
    await transientQueue.flush("user-a");
    expect(transientStore.read()).toEqual([]);

    const blockedStore = new MemoryWorkoutMutationStore();
    const blockedQueue = new WorkoutMutationOutbox(
      blockedStore,
      vi.fn().mockRejectedValue(new IronDeskError("Reps are invalid.", "validation")),
      {
        isOnline: () => true,
        createId: () => "blocked-1",
        now: () => now,
      },
    );
    await expect(blockedQueue.enqueue("user-a", update(-1))).resolves.toEqual({
      itemId: "blocked-1",
      status: "blocked",
    });
    expect(blockedStore.read()[0]).toMatchObject({
      attempts: 1,
      state: "blocked",
      lastError: "Reps are invalid.",
    });
  });

  it("replays a response-lost insert with the exact same idempotent record identifier", async () => {
    const store = new MemoryWorkoutMutationStore();
    let now = new Date("2026-08-31T12:00:00.000Z");
    const serverRows = new Set<string>();
    const attempts: WorkoutMutation[] = [];
    const executor: WorkoutMutationExecutor = vi.fn(async (mutation) => {
      attempts.push(structuredClone(mutation));
      if (mutation.kind !== "set.add") throw new Error("Unexpected mutation");
      const alreadyStored = serverRows.has(mutation.recordId);
      serverRows.add(mutation.recordId);
      if (!alreadyStored) throw new TypeError("Failed to fetch after the server committed the row");
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => true,
      createId: () => "operation-response-lost",
      now: () => now,
    });
    const mutation: WorkoutMutation = {
      kind: "set.add",
      recordId: "00000000-0000-4000-a000-000000000010",
      sessionExerciseId: "exercise-1",
      setNumber: 2,
      input: { weightKg: 100, reps: 5, rpe: 8 },
    };

    await expect(queue.enqueue("user-a", mutation)).resolves.toMatchObject({ status: "queued" });
    now = new Date("2026-08-31T12:00:02.000Z");
    await queue.flush("user-a");

    expect(attempts).toEqual([mutation, mutation]);
    expect(serverRows).toEqual(new Set([mutation.recordId]));
    expect(store.read()).toEqual([]);
  });

  it("flushes only the authenticated user's partition and can clear it on sign-out", async () => {
    const store = new MemoryWorkoutMutationStore();
    let operation = 0;
    const offline = new WorkoutMutationOutbox(store, vi.fn(), {
      isOnline: () => false,
      createId: () => `operation-${++operation}`,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });
    await offline.enqueue("user-a", update(7));
    await offline.enqueue("user-b", { kind: "set.delete", setId: "set-b" });

    const executor = vi.fn<WorkoutMutationExecutor>().mockResolvedValue(undefined);
    const online = new WorkoutMutationOutbox(store, executor, { isOnline: () => true });
    await online.flush("user-a");

    expect(executor).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalledWith(update(7), "user-a");
    expect(store.read()).toMatchObject([
      { userId: "user-b", mutation: { kind: "set.delete", setId: "set-b" } },
    ]);

    online.clearUser("user-b");
    expect(store.read()).toEqual([]);
  });

  it("keeps exercise.add before its dependent set.add in the same millisecond", async () => {
    const store = new MemoryWorkoutMutationStore();
    let operation = 0;
    const offline = new WorkoutMutationOutbox(store, vi.fn(), {
      isOnline: () => false,
      createId: () => `operation-${++operation}`,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });
    await offline.enqueue("user-a", {
      kind: "exercise.add",
      recordId: "00000000-0000-4000-a000-000000000001",
      sessionId: "session-1",
      position: 0,
      input: { exerciseId: "library-1", name: "Back Squat" },
    });
    await offline.enqueue("user-a", {
      kind: "set.add",
      recordId: "00000000-0000-4000-a000-000000000002",
      sessionExerciseId: "00000000-0000-4000-a000-000000000001",
      setNumber: 1,
      input: { reps: 5 },
    });

    const kinds: string[] = [];
    const online = new WorkoutMutationOutbox(
      store,
      vi.fn(async (mutation) => {
        kinds.push(mutation.kind);
      }),
      { isOnline: () => true },
    );
    await online.flush("user-a");

    expect(kinds).toEqual(["exercise.add", "set.add"]);
  });

  it("lets a delayed head block its dependent tail until the head succeeds", async () => {
    const store = new MemoryWorkoutMutationStore();
    let now = new Date("2026-08-31T12:00:00.000Z");
    let operation = 0;
    const calls: string[] = [];
    const executor: WorkoutMutationExecutor = vi.fn(async (mutation) => {
      calls.push(mutation.kind);
      if (calls.length === 1) throw new TypeError("Failed to fetch");
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => true,
      createId: () => `operation-${++operation}`,
      now: () => now,
    });

    await queue.enqueue("user-a", {
      kind: "exercise.add",
      recordId: "00000000-0000-4000-a000-000000000021",
      sessionId: "session-1",
      position: 0,
      input: { exerciseId: "library-1", name: "Back Squat" },
    });
    await queue.enqueue("user-a", {
      kind: "set.add",
      recordId: "00000000-0000-4000-a000-000000000022",
      sessionExerciseId: "00000000-0000-4000-a000-000000000021",
      setNumber: 1,
      input: { reps: 5 },
    });

    expect(calls).toEqual(["exercise.add"]);
    expect(store.read().map((item) => item.mutation.kind)).toEqual(["exercise.add", "set.add"]);

    now = new Date("2026-08-31T12:00:02.000Z");
    await queue.flush("user-a");
    expect(calls).toEqual(["exercise.add", "exercise.add", "set.add"]);
    expect(store.read()).toEqual([]);
  });

  it("does not skip a blocked parent and discards its dependent tail as one unit", async () => {
    const store = new MemoryWorkoutMutationStore();
    let online = false;
    let operation = 0;
    const calls: string[] = [];
    const executor: WorkoutMutationExecutor = vi.fn(async (mutation) => {
      calls.push(mutation.kind);
      if (mutation.kind === "exercise.add")
        throw new IronDeskError("That exercise cannot be added.", "validation");
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => online,
      createId: () => `operation-${++operation}`,
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });
    await queue.enqueue("user-a", {
      kind: "exercise.add",
      recordId: "00000000-0000-4000-a000-000000000031",
      sessionId: "session-1",
      position: 0,
      input: { exerciseId: "library-1", name: "Back Squat" },
    });
    await queue.enqueue("user-a", {
      kind: "set.add",
      recordId: "00000000-0000-4000-a000-000000000032",
      sessionExerciseId: "00000000-0000-4000-a000-000000000031",
      setNumber: 1,
      input: { reps: 5 },
    });

    online = true;
    await queue.flush("user-a");
    expect(calls).toEqual(["exercise.add"]);
    expect(store.read().map((item) => item.state)).toEqual(["blocked", "pending"]);

    await queue.flush("user-a", true);
    expect(calls).toEqual(["exercise.add"]);
    queue.discardBlocked("user-a");
    expect(store.read()).toEqual([]);
  });

  it("drops the reload-recovery claim after local storage fails", () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      length: 0,
    } satisfies Storage;
    const store = new BrowserWorkoutMutationStore(storage);
    const queued = {
      id: "operation-1",
      revision: 1,
      userId: "user-a",
      createdAt: "2026-08-31T12:00:00.000Z",
      updatedAt: "2026-08-31T12:00:00.000Z",
      attempts: 0,
      nextAttemptAt: null,
      state: "pending" as const,
      lastError: null,
      mutation: update(5),
    };

    expect(store.durable).toBe(true);
    store.write([queued]);
    expect(store.durable).toBe(false);
    expect(store.read()).toEqual([queued]);
  });

  it("keeps normal sign-out wired to clearing that user's local outbox", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/auth/auth-provider.tsx"), "utf8");
    const signOut = source.slice(
      source.indexOf("const signOut"),
      source.indexOf("const deleteAccount"),
    );
    expect(signOut).toContain("clearQueuedWorkoutMutationsForUser(userId)");
  });

  it("keeps every active-workout write path wired to the durable mutation boundary", () => {
    const source = readFileSync(join(process.cwd(), "src/routes/workout.tsx"), "utf8");
    for (const kind of [
      "set.add",
      "set.update",
      "set.delete",
      "exercise.add",
      "exercise.delete",
      "exercise.substitute",
      "exercise.method",
      "session.meta",
      "session.finish",
      "session.cancel",
    ]) {
      expect(source).toContain(`kind: "${kind}"`);
    }
    for (const directWrite of [
      "repo.addSet(",
      "repo.updateSet(",
      "repo.deleteSet(",
      "repo.addSessionExercise(",
      "repo.removeSessionExercise(",
      "repo.substituteSessionExercise(",
      "repo.updateSessionMeta(",
      "repo.finishWorkout(",
      "repo.cancelWorkout(",
      "repo.setSessionExerciseMethod(",
    ]) {
      expect(source).not.toContain(directWrite);
    }
  });
});
