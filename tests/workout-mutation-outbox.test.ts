import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { IronDeskError } from "../src/lib/irondesk/errors";
import {
  BrowserWorkoutMutationStore,
  MemoryWorkoutMutationStore,
  WorkoutMutationOutbox,
  type QueuedWorkoutMutation,
  type WorkoutMutation,
  type WorkoutMutationExecutor,
} from "../src/lib/irondesk/workout-mutation-outbox";

const update = (reps: number): WorkoutMutation => ({
  kind: "set.update",
  setId: "set-1",
  patch: { reps },
});

function queuedItem(
  id: string,
  sessionId: string,
  mutation: WorkoutMutation,
  options: Partial<QueuedWorkoutMutation> = {},
): QueuedWorkoutMutation {
  return {
    id,
    revision: 1,
    userId: "user-a",
    laneId: `session:${sessionId}`,
    sessionId,
    createdAt: "2026-08-31T12:00:00.000Z",
    updatedAt: "2026-08-31T12:00:00.000Z",
    attempts: 0,
    nextAttemptAt: null,
    state: "pending",
    lastError: null,
    mutation,
    ...options,
  };
}

class TestStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("workout mutation outbox", () => {
  it("persists before the first network attempt and recovers in a new queue instance", async () => {
    const store = new MemoryWorkoutMutationStore();
    const firstExecutor = vi.fn<WorkoutMutationExecutor>();
    const first = new WorkoutMutationOutbox(store, firstExecutor, {
      isOnline: () => false,
      createId: () => "operation-1",
      now: () => new Date("2026-08-31T12:00:00.000Z"),
    });

    await expect(first.enqueue("user-a", update(8))).resolves.toMatchObject({
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

    expect(recoveredExecutor).toHaveBeenCalledWith(update(8), "user-a", expect.any(AbortSignal));
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

    const first = queue.enqueue(
      "user-a",
      {
        kind: "set.update",
        setId: "set-1",
        patch: { weightKg: 90, reps: 5 },
      },
      { requireAcknowledgment: true },
    );
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

  it("retries connectivity failures, rejects invalid client values, and blocks server validation", async () => {
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

    await expect(
      transientQueue.enqueue("user-a", update(9), { requireAcknowledgment: true }),
    ).resolves.toMatchObject({ status: "queued" });
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
    await expect(blockedQueue.enqueue("user-a", update(-1))).rejects.toMatchObject({
      code: "validation",
    });
    expect(blockedStore.read()).toEqual([]);

    await expect(
      blockedQueue.enqueue("user-a", update(1), { requireAcknowledgment: true }),
    ).resolves.toMatchObject({
      itemId: "blocked-1",
      status: "blocked",
      outcome: "blocked",
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
    expect(executor).toHaveBeenCalledWith(update(7), "user-a", expect.any(AbortSignal));
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

    await queue.enqueue(
      "user-a",
      {
        kind: "exercise.add",
        recordId: "00000000-0000-4000-a000-000000000021",
        sessionId: "session-1",
        position: 0,
        input: { exerciseId: "library-1", name: "Back Squat" },
      },
      { requireAcknowledgment: true },
    );
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

  it("does not skip a blocked parent and never silently drops its dependent tail", async () => {
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
    await queue.retryBlocked("user-a");
    expect(calls).toEqual(["exercise.add"]);
    expect(store.read()).toHaveLength(2);
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
      laneId: "session:session-1",
      sessionId: "session-1",
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

  it("migrates a 157-item v1 journal, blocks its entire invalid lane before replay, and retains every id", async () => {
    const storage = new TestStorage();
    const legacySetItems = Array.from({ length: 156 }, (_, index) => ({
      id: `legacy-set-${index + 1}`,
      revision: 1,
      userId: "user-a",
      createdAt: "2026-08-31T12:00:00.000Z",
      updatedAt: "2026-08-31T12:00:00.000Z",
      attempts: 0,
      nextAttemptAt: null,
      state: "pending",
      lastError: null,
      mutation: {
        kind: "set.update",
        setId: `set-${index + 1}`,
        patch: { rpe: index === 155 ? 11.5 : 8 },
      },
    }));
    storage.setItem(
      "irondesk.workout-mutation-outbox.v1",
      JSON.stringify({
        version: 1,
        items: [
          ...legacySetItems,
          {
            id: "legacy-finish",
            revision: 1,
            userId: "user-a",
            createdAt: "2026-08-31T12:01:00.000Z",
            updatedAt: "2026-08-31T12:01:00.000Z",
            attempts: 0,
            nextAttemptAt: null,
            state: "pending",
            lastError: null,
            mutation: {
              kind: "session.finish",
              sessionId: "session-1",
              completedAt: "2026-08-31T12:01:00.000Z",
            },
          },
        ],
      }),
    );

    const store = new BrowserWorkoutMutationStore(storage);
    expect(store.read()).toHaveLength(157);
    expect(new Set(store.read().map((item) => item.laneId))).toEqual(
      new Set(["session:session-1"]),
    );
    expect(store.read()[156]?.sessionId).toBe("session-1");
    expect(store.read().map((item) => item.id)).toEqual([
      ...legacySetItems.map((item) => item.id),
      "legacy-finish",
    ]);
    expect(store.read().find((item) => item.id === "legacy-set-156")).toMatchObject({
      state: "blocked",
      issueField: "rpe",
      issueValue: 11.5,
    });
    expect(store.readTerminalReceipts()).toMatchObject([
      {
        itemId: "legacy-finish",
        sessionId: "session-1",
        status: "blocked",
        completionState: "needs_attention",
        conflictState: "invalid_workout_value",
      },
    ]);
    expect(storage.getItem("irondesk.workout-mutation-outbox.v1")).toBeNull();
    expect(storage.getItem("irondesk.workout-mutation-outbox.v2")).not.toBeNull();

    const executor = vi.fn<WorkoutMutationExecutor>().mockResolvedValue(undefined);
    const queue = new WorkoutMutationOutbox(store, executor, { isOnline: () => true });
    await queue.flush("user-a");
    expect(executor).not.toHaveBeenCalled();
    expect(store.read()).toHaveLength(157);
  });

  it("returns after durable acceptance instead of waiting for the in-flight request", async () => {
    const storage = new TestStorage();
    const store = new BrowserWorkoutMutationStore(storage);
    let release: (() => void) | undefined;
    const executor = vi.fn<WorkoutMutationExecutor>(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => true,
      createId: () => "accepted-1",
    });

    const accepted = await queue.enqueue("user-a", "session-1", update(8));
    expect(accepted).toMatchObject({
      itemId: "accepted-1",
      status: "queued",
      durable: true,
      laneId: "session:session-1",
      sessionId: "session-1",
    });
    expect(executor).toHaveBeenCalledTimes(1);

    release?.();
    await queue.flush("user-a");
    expect(store.read()).toEqual([]);
  });

  it("aborts a hung request at the bounded timeout and releases the flush lock", async () => {
    const store = new MemoryWorkoutMutationStore();
    const signals: AbortSignal[] = [];
    const executor = vi.fn<WorkoutMutationExecutor>(async (_mutation, _userId, signal) => {
      signals.push(signal);
      if (signals.length > 1) return;
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => true,
      createId: () => "timeout-1",
      requestTimeoutMs: 10,
    });

    await expect(
      queue.enqueue("user-a", "session-1", update(8), { requireAcknowledgment: true }),
    ).resolves.toMatchObject({ status: "queued" });
    expect(signals[0]?.aborted).toBe(true);
    expect(queue.snapshot("user-a").flushing).toBe(false);

    await queue.flush("user-a", true);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(store.read()).toEqual([]);
  });

  it("skips a blocked lane fairly without reordering dependent work inside that lane", async () => {
    const store = new MemoryWorkoutMutationStore([
      queuedItem(
        "lane-operation-1",
        "session-a",
        { kind: "set.update", setId: "set-a1", patch: { rpe: 11.5 } },
        {
          state: "blocked",
          lastError: "RPE is invalid.",
          issueCode: "invalid_workout_value",
          issueField: "rpe",
          issueValue: 11.5,
        },
      ),
      queuedItem("lane-operation-2", "session-a", {
        kind: "set.update",
        setId: "set-a2",
        patch: { reps: 8 },
      }),
    ]);
    let online = false;
    const calls: string[] = [];
    const executor = vi.fn<WorkoutMutationExecutor>(async (mutation) => {
      const target = mutation.kind === "set.update" ? mutation.setId : mutation.kind;
      calls.push(target);
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => online,
      createId: () => "lane-operation-3",
    });

    await queue.enqueue("user-a", "session-b", {
      kind: "set.update",
      setId: "set-b1",
      patch: { reps: 9 },
    });

    online = true;
    await queue.flush("user-a");

    expect(calls).toEqual(["set-b1"]);
    expect(store.read().map((item) => item.mutation)).toMatchObject([
      { kind: "set.update", setId: "set-a1" },
      { kind: "set.update", setId: "set-a2" },
    ]);
    expect(queue.snapshot("user-a").issues).toMatchObject([
      {
        itemId: "lane-operation-1",
        sessionId: "session-a",
        field: "rpe",
        invalidValue: 11.5,
      },
    ]);
  });

  it("compacts an unsent set add, edit, and delete without issuing network writes", async () => {
    const store = new MemoryWorkoutMutationStore();
    let operation = 0;
    const executor = vi.fn<WorkoutMutationExecutor>();
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => false,
      createId: () => `compact-${++operation}`,
    });
    const recordId = "00000000-0000-4000-a000-000000000099";

    await queue.enqueue("user-a", "session-1", {
      kind: "set.add",
      recordId,
      sessionExerciseId: "exercise-1",
      setNumber: 1,
      input: { weightKg: 40, reps: 8, rpe: null },
    });
    await queue.enqueue("user-a", "session-1", {
      kind: "set.update",
      setId: recordId,
      patch: { weightKg: 42.5, reps: 9, rpe: 8.5 },
    });
    expect(store.read()).toMatchObject([
      {
        mutation: {
          kind: "set.add",
          input: { weightKg: 42.5, reps: 9, rpe: 8.5 },
        },
      },
    ]);

    await expect(
      queue.enqueue("user-a", "session-1", { kind: "set.delete", setId: recordId }),
    ).resolves.toMatchObject({ status: "applied" });
    expect(store.read()).toEqual([]);
    expect(executor).not.toHaveBeenCalled();
  });

  it("corrects one blocked item in place and preserves its dependent tail", async () => {
    const store = new MemoryWorkoutMutationStore([
      queuedItem(
        "correct-1",
        "session-1",
        { kind: "set.update", setId: "set-1", patch: { rpe: 11.5 } },
        {
          state: "blocked",
          lastError: "RPE is invalid.",
          issueCode: "invalid_workout_value",
          issueField: "rpe",
          issueValue: 11.5,
        },
      ),
      queuedItem("correct-2", "session-1", {
        kind: "set.update",
        setId: "set-2",
        patch: { reps: 10 },
      }),
    ]);
    let online = false;
    const calls: WorkoutMutation[] = [];
    const executor = vi.fn<WorkoutMutationExecutor>(async (mutation) => {
      calls.push(mutation);
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => online,
    });
    const blocked = store.read()[0]!;
    online = true;
    await queue.flush("user-a");
    expect(store.read()).toHaveLength(2);

    await expect(
      queue.correctBlocked(
        "user-a",
        blocked.id,
        { kind: "set.update", setId: "set-1", patch: { rpe: 10 } },
        { expectedRevision: blocked.revision, requireAcknowledgment: true },
      ),
    ).resolves.toMatchObject({ itemId: blocked.id, status: "applied" });
    expect(calls).toMatchObject([
      { kind: "set.update", setId: "set-1", patch: { rpe: 10 } },
      { kind: "set.update", setId: "set-2", patch: { reps: 10 } },
    ]);
    expect(store.read()).toEqual([]);
  });

  it("persists a terminal receipt and local summary through queued and applied states", async () => {
    const store = new MemoryWorkoutMutationStore();
    let online = false;
    const executor = vi.fn<WorkoutMutationExecutor>().mockResolvedValue(undefined);
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => online,
      createId: () => "finish-1",
    });
    const summary = {
      title: "Shoulders + Traps",
      durationMin: 49,
      sets: 36,
      reps: 415,
      tonnageKg: 13_596,
      avgRpe: null,
    };

    await queue.enqueue(
      "user-a",
      "session-1",
      {
        kind: "session.finish",
        sessionId: "session-1",
        completedAt: "2026-08-31T12:49:00.000Z",
      },
      { terminalSummary: summary },
    );
    expect(queue.terminalReceipt("finish-1")).toMatchObject({
      status: "queued",
      sessionId: "session-1",
      summary,
    });

    online = true;
    await queue.flush("user-a");
    expect(queue.terminalReceipt("finish-1")).toMatchObject({ status: "applied", summary });
    expect(store.read()).toEqual([]);
  });

  it("allows only an acknowledged terminal receipt to be dismissed", async () => {
    const store = new MemoryWorkoutMutationStore();
    let online = false;
    const queue = new WorkoutMutationOutbox(store, vi.fn<WorkoutMutationExecutor>(), {
      isOnline: () => online,
      createId: () => "dismiss-finish",
    });
    await queue.enqueue("user-a", "session-1", {
      kind: "session.finish",
      sessionId: "session-1",
      completedAt: "2026-08-31T12:49:00.000Z",
    });
    expect(queue.dismissTerminalReceipt("dismiss-finish")).toBe(false);
    expect(queue.terminalReceipt("dismiss-finish")).not.toBeNull();

    online = true;
    await queue.flush("user-a");
    expect(queue.dismissTerminalReceipt("dismiss-finish")).toBe(true);
    expect(queue.terminalReceipt("dismiss-finish")).toBeNull();
  });

  it("recovers a blocked cancelled-session finish in place without deleting its lane tail", async () => {
    const store = new MemoryWorkoutMutationStore();
    let online = false;
    let operation = 0;
    const calls: WorkoutMutation[] = [];
    const executor = vi.fn<WorkoutMutationExecutor>(async (mutation) => {
      calls.push(mutation);
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => online,
      createId: () => `terminal-correction-${++operation}`,
      preflightLane: async (sessionId) => ({
        id: sessionId,
        status: "cancelled",
        startedAt: "2026-08-31T12:00:00.000Z",
        completedAt: "2026-08-31T12:30:00.000Z",
      }),
    });

    const finish = await queue.enqueue("user-a", "session-1", {
      kind: "session.finish",
      sessionId: "session-1",
      completedAt: "2026-08-31T12:49:00.000Z",
    });
    await queue.enqueue("user-a", "session-1", {
      kind: "session.meta",
      sessionId: "session-1",
      patch: { notes: "kept behind terminal correction" },
    });
    online = true;
    await queue.flush("user-a");
    expect(calls).toEqual([]);
    expect(queue.terminalReceipt(finish.itemId)).toMatchObject({
      status: "blocked",
      conflictState: "cancelled_session_requires_recovery",
      recoveryAuthorized: false,
    });
    expect(store.read()).toHaveLength(2);
    const blockedFinish = store.read().find((item) => item.id === finish.itemId)!;

    await queue.correctBlocked(
      "user-a",
      finish.itemId,
      {
        kind: "session.finish",
        sessionId: "session-1",
        completedAt: "2026-08-31T12:49:00.000Z",
        recoverCancelled: true,
      },
      { expectedRevision: blockedFinish.revision, requireAcknowledgment: true },
    );

    expect(calls).toMatchObject([
      { kind: "session.meta", patch: { notes: "kept behind terminal correction" } },
      { kind: "session.finish", recoverCancelled: true },
    ]);
    expect(queue.terminalReceipt(finish.itemId)).toMatchObject({
      status: "applied",
      recoveryAuthorized: true,
      requestedAt: "2026-08-31T12:49:00.000Z",
    });
    expect(store.read()).toEqual([]);
  });

  it("reports accepted, retrying, applied, blocked, and terminal-conflict outcomes", async () => {
    const durableQueue = new WorkoutMutationOutbox(
      new BrowserWorkoutMutationStore(new TestStorage()),
      vi.fn(),
      { isOnline: () => false, createId: () => "durable-outcome" },
    );
    await expect(durableQueue.enqueue("user-a", "session-1", update(8))).resolves.toMatchObject({
      status: "queued",
      outcome: "accepted_locally",
      durable: true,
    });

    const volatileQueue = new WorkoutMutationOutbox(new MemoryWorkoutMutationStore(), vi.fn(), {
      isOnline: () => false,
      createId: () => "volatile-outcome",
    });
    await expect(volatileQueue.enqueue("user-a", "session-1", update(8))).resolves.toMatchObject({
      status: "queued",
      outcome: "retrying",
      durable: false,
    });

    const appliedQueue = new WorkoutMutationOutbox(
      new MemoryWorkoutMutationStore(),
      vi.fn<WorkoutMutationExecutor>().mockResolvedValue(undefined),
      { isOnline: () => true, createId: () => "applied-outcome" },
    );
    await expect(
      appliedQueue.enqueue("user-a", "session-1", update(8), {
        requireAcknowledgment: true,
      }),
    ).resolves.toMatchObject({ status: "applied", outcome: "applied" });

    const blockedQueue = new WorkoutMutationOutbox(
      new MemoryWorkoutMutationStore(),
      vi
        .fn<WorkoutMutationExecutor>()
        .mockRejectedValue(
          new IronDeskError("The server rejected that valid-looking value.", "validation"),
        ),
      { isOnline: () => true, createId: () => "blocked-outcome" },
    );
    await expect(
      blockedQueue.enqueue("user-a", "session-1", update(8), {
        requireAcknowledgment: true,
      }),
    ).resolves.toMatchObject({ status: "blocked", outcome: "blocked" });

    const conflictQueue = new WorkoutMutationOutbox(
      new MemoryWorkoutMutationStore(),
      vi.fn<WorkoutMutationExecutor>(),
      {
        isOnline: () => true,
        createId: () => "conflict-outcome",
        preflightLane: async (sessionId) => ({
          id: sessionId,
          status: "cancelled",
          startedAt: "2026-08-31T12:00:00.000Z",
          completedAt: "2026-08-31T12:30:00.000Z",
        }),
      },
    );
    await expect(
      conflictQueue.enqueue(
        "user-a",
        "session-1",
        {
          kind: "session.finish",
          sessionId: "session-1",
          completedAt: "2026-08-31T12:49:00.000Z",
        },
        { requireAcknowledgment: true },
      ),
    ).resolves.toMatchObject({ status: "blocked", outcome: "terminal_conflict" });
  });

  it("keeps the first finish id, timestamp, and local summary immutable across repeats and reload", async () => {
    const storage = new TestStorage();
    const store = new BrowserWorkoutMutationStore(storage);
    const queue = new WorkoutMutationOutbox(store, vi.fn(), {
      isOnline: () => false,
      createId: () => "immutable-finish",
      now: () => new Date("2026-08-31T12:49:01.000Z"),
    });
    const firstSummary = {
      title: "Shoulders + Traps",
      durationMin: 49,
      sets: 36,
      reps: 415,
      tonnageKg: 13_596,
      avgRpe: null,
    };
    const first = await queue.enqueue(
      "user-a",
      "session-1",
      {
        kind: "session.finish",
        sessionId: "session-1",
        completedAt: "2026-08-31T12:49:00.000Z",
      },
      { terminalSummary: firstSummary },
    );
    const second = await queue.enqueue(
      "user-a",
      "session-1",
      {
        kind: "session.finish",
        sessionId: "session-1",
        completedAt: "2026-08-31T13:30:00.000Z",
      },
      {
        terminalSummary: {
          ...firstSummary,
          sets: 1,
          reps: 1,
        },
      },
    );

    expect(second.itemId).toBe(first.itemId);
    expect(store.read()).toMatchObject([
      {
        id: "immutable-finish",
        mutation: { completedAt: "2026-08-31T12:49:00.000Z" },
      },
    ]);
    const reloaded = new BrowserWorkoutMutationStore(storage);
    expect(reloaded.readTerminalReceipts()).toMatchObject([
      {
        itemId: "immutable-finish",
        requestedAt: "2026-08-31T12:49:00.000Z",
        recoveryAuthorized: false,
        conflictState: null,
        completionState: "completed_locally_sync_pending",
        summary: firstSummary,
      },
    ]);
  });

  it("times out one never-settling session lane, releases the worker, and drains another lane", async () => {
    const store = new MemoryWorkoutMutationStore();
    let online = false;
    let operation = 0;
    const calls: string[] = [];
    const executor = vi.fn<WorkoutMutationExecutor>(async (mutation, _userId, signal) => {
      if (mutation.kind !== "set.update") return;
      calls.push(mutation.setId);
      if (mutation.setId !== "set-a") return;
      await new Promise<void>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true,
        });
      });
    });
    const queue = new WorkoutMutationOutbox(store, executor, {
      isOnline: () => online,
      createId: () => `timeout-fairness-${++operation}`,
      requestTimeoutMs: 10,
    });
    await queue.enqueue("user-a", "session-a", {
      kind: "set.update",
      setId: "set-a",
      patch: { reps: 8 },
    });
    await queue.enqueue("user-a", "session-b", {
      kind: "set.update",
      setId: "set-b",
      patch: { reps: 9 },
    });

    online = true;
    await queue.flush("user-a");

    expect(calls).toEqual(["set-a", "set-b"]);
    expect(store.read()).toMatchObject([
      {
        sessionId: "session-a",
        attempts: 1,
        state: "pending",
        nextAttemptAt: expect.any(String),
      },
    ]);
    expect(queue.snapshot("user-a").flushing).toBe(false);
  });

  it("releases a lane whose executor ignores abort and drains the next lane after 15 seconds", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-09-02T12:00:00.000Z"));
      const store = new MemoryWorkoutMutationStore();
      let online = false;
      let operation = 0;
      const calls: string[] = [];
      const executor = vi.fn<WorkoutMutationExecutor>((mutation, _userId, _signal) => {
        if (mutation.kind !== "set.update") return Promise.resolve();
        calls.push(mutation.setId);
        // Deliberately do not observe AbortSignal and never settle. The outbox
        // must still release its worker through its own timeout race.
        if (mutation.setId === "set-stalled") return new Promise<void>(() => undefined);
        return Promise.resolve();
      });
      const queue = new WorkoutMutationOutbox(store, executor, {
        isOnline: () => online,
        createId: () => `never-settles-${++operation}`,
        requestTimeoutMs: 15_000,
      });

      await queue.enqueue("user-a", "session-stalled", {
        kind: "set.update",
        setId: "set-stalled",
        patch: { reps: 8 },
      });
      await queue.enqueue("user-a", "session-ready", {
        kind: "set.update",
        setId: "set-ready",
        patch: { reps: 9 },
      });

      online = true;
      const draining = queue.flush("user-a");
      await vi.advanceTimersByTimeAsync(15_000);
      await draining;

      expect(calls).toEqual(["set-stalled", "set-ready"]);
      expect(store.read()).toMatchObject([
        {
          id: "never-settles-1",
          sessionId: "session-stalled",
          attempts: 1,
          state: "pending",
          nextAttemptAt: "2026-09-02T12:00:16.000Z",
        },
      ]);
      expect(queue.snapshot("user-a")).toMatchObject({
        flushing: false,
        pendingCount: 1,
        nextAttemptAt: "2026-09-02T12:00:16.000Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["active", "session.finish", true, "applied"],
    ["completed", "session.finish", true, "applied"],
    ["cancelled", "session.finish", false, "blocked"],
    ["completed", "session.cancel", false, "blocked"],
    ["cancelled", "session.cancel", true, "applied"],
  ] as const)(
    "preflights %s plus %s before replay (executes=%s)",
    async (serverStatus, kind, shouldExecute, expectedStatus) => {
      const executor = vi.fn<WorkoutMutationExecutor>().mockResolvedValue(undefined);
      const queue = new WorkoutMutationOutbox(new MemoryWorkoutMutationStore(), executor, {
        isOnline: () => true,
        createId: () => `preflight-${serverStatus}-${kind}`,
        preflightLane: async (sessionId) => ({
          id: sessionId,
          status: serverStatus,
          startedAt: "2026-08-31T12:00:00.000Z",
          completedAt: serverStatus === "active" ? null : "2026-08-31T12:30:00.000Z",
        }),
      });
      const terminal: WorkoutMutation = {
        kind,
        sessionId: "session-1",
        completedAt: "2026-08-31T12:49:00.000Z",
      };

      const result = await queue.enqueue("user-a", "session-1", terminal, {
        requireAcknowledgment: true,
      });

      expect(result.status).toBe(expectedStatus);
      expect(executor).toHaveBeenCalledTimes(shouldExecute ? 1 : 0);
    },
  );

  it("rechecks server state immediately before the terminal row becomes executable", async () => {
    const store = new MemoryWorkoutMutationStore();
    let online = false;
    let reads = 0;
    const calls: string[] = [];
    const queue = new WorkoutMutationOutbox(
      store,
      vi.fn<WorkoutMutationExecutor>(async (mutation) => calls.push(mutation.kind)),
      {
        isOnline: () => online,
        createId: (() => {
          let id = 0;
          return () => `terminal-recheck-${++id}`;
        })(),
        preflightLane: async (sessionId) => {
          reads += 1;
          return {
            id: sessionId,
            status: reads === 1 ? "active" : "cancelled",
            startedAt: "2026-08-31T12:00:00.000Z",
            completedAt: reads === 1 ? null : "2026-08-31T12:30:00.000Z",
          };
        },
      },
    );
    await queue.enqueue("user-a", "session-1", update(8));
    await queue.enqueue("user-a", "session-1", {
      kind: "session.finish",
      sessionId: "session-1",
      completedAt: "2026-08-31T12:49:00.000Z",
    });

    online = true;
    await queue.flush("user-a");

    expect(reads).toBe(2);
    expect(calls).toEqual(["set.update"]);
    expect(store.read()).toMatchObject([
      {
        mutation: { kind: "session.finish" },
        state: "blocked",
        issueCode: "cancelled_session_requires_recovery",
      },
    ]);
  });

  it("segments multiple v1 terminal sessions and a homogeneous trailing parent-child segment", () => {
    const storage = new TestStorage();
    const legacy = (id: string, mutation: WorkoutMutation) => ({
      id,
      revision: 1,
      userId: "user-a",
      createdAt: "2026-08-31T12:00:00.000Z",
      updatedAt: "2026-08-31T12:00:00.000Z",
      attempts: 0,
      nextAttemptAt: null,
      state: "pending",
      lastError: null,
      mutation,
    });
    storage.setItem(
      "irondesk.workout-mutation-outbox.v1",
      JSON.stringify({
        version: 1,
        items: [
          legacy("s1-row", { kind: "set.update", setId: "s1-set", patch: { reps: 5 } }),
          legacy("s1-finish", {
            kind: "session.finish",
            sessionId: "session-1",
            completedAt: "2026-08-31T12:10:00.000Z",
          }),
          legacy("s2-row", { kind: "set.update", setId: "s2-set", patch: { reps: 6 } }),
          legacy("s2-finish", {
            kind: "session.finish",
            sessionId: "session-2",
            completedAt: "2026-08-31T12:20:00.000Z",
          }),
          legacy("s3-exercise", {
            kind: "exercise.add",
            recordId: "00000000-0000-4000-a000-000000000301",
            sessionId: "session-3",
            position: 0,
            input: { name: "Back Squat" },
          }),
          legacy("s3-set", {
            kind: "set.add",
            recordId: "00000000-0000-4000-a000-000000000302",
            sessionExerciseId: "00000000-0000-4000-a000-000000000301",
            setNumber: 1,
            input: { reps: 5, rpe: null },
          }),
        ],
      }),
    );

    const items = new BrowserWorkoutMutationStore(storage).read();
    expect(items.map((item) => item.id)).toEqual([
      "s1-row",
      "s1-finish",
      "s2-row",
      "s2-finish",
      "s3-exercise",
      "s3-set",
    ]);
    expect(items.map((item) => item.laneId)).toEqual([
      "session:session-1",
      "session:session-1",
      "session:session-2",
      "session:session-2",
      "session:session-3",
      "session:session-3",
    ]);
  });

  it("blocks a v1 segment whose direct workout identity conflicts with its terminal boundary", async () => {
    const storage = new TestStorage();
    storage.setItem(
      "irondesk.workout-mutation-outbox.v1",
      JSON.stringify({
        version: 1,
        items: [
          {
            id: "conflicting-meta",
            revision: 1,
            userId: "user-a",
            createdAt: "2026-08-31T12:00:00.000Z",
            updatedAt: "2026-08-31T12:00:00.000Z",
            attempts: 0,
            nextAttemptAt: null,
            state: "pending",
            lastError: null,
            mutation: { kind: "session.meta", sessionId: "session-2", patch: { notes: "x" } },
          },
          {
            id: "conflicting-finish",
            revision: 1,
            userId: "user-a",
            createdAt: "2026-08-31T12:01:00.000Z",
            updatedAt: "2026-08-31T12:01:00.000Z",
            attempts: 0,
            nextAttemptAt: null,
            state: "pending",
            lastError: null,
            mutation: {
              kind: "session.finish",
              sessionId: "session-1",
              completedAt: "2026-08-31T12:01:00.000Z",
            },
          },
        ],
      }),
    );
    const store = new BrowserWorkoutMutationStore(storage);
    const executor = vi.fn<WorkoutMutationExecutor>().mockResolvedValue(undefined);
    const queue = new WorkoutMutationOutbox(store, executor, { isOnline: () => true });

    expect(queue.snapshot("user-a").issues).toMatchObject([
      { code: "session_identity_conflict", field: "sessionId" },
    ]);
    await queue.retryBlocked("user-a");
    expect(executor).not.toHaveBeenCalled();
    expect(store.read()).toHaveLength(2);
  });

  it("preserves an unreadable raw recovery journal and disables durable writes", () => {
    const storage = new TestStorage();
    const raw = JSON.stringify({ version: 1, items: [{ id: "opaque-queued-data" }] });
    storage.setItem("irondesk.workout-mutation-outbox.v1", raw);
    const store = new BrowserWorkoutMutationStore(storage);

    expect(store.read()).toEqual([]);
    expect(store.durable).toBe(false);
    store.write([]);
    expect(storage.getItem("irondesk.workout-mutation-outbox.v1")).toBe(raw);
    expect(storage.getItem("irondesk.workout-mutation-outbox.v2")).toBeNull();
  });

  it("rejects stale or identity-changing recovery corrections without altering the queue", async () => {
    const original = queuedItem(
      "guarded-correction",
      "session-1",
      { kind: "set.update", setId: "set-1", patch: { reps: 8, rpe: 11.5 } },
      {
        revision: 4,
        state: "blocked",
        lastError: "RPE is invalid.",
        issueCode: "invalid_workout_value",
        issueField: "rpe",
        issueValue: 11.5,
      },
    );
    const store = new MemoryWorkoutMutationStore([original]);
    const queue = new WorkoutMutationOutbox(store, vi.fn(), { isOnline: () => false });

    await expect(
      queue.correctBlocked(
        "user-a",
        original.id,
        { kind: "set.update", setId: "set-1", patch: { reps: 8, rpe: 10 } },
        { expectedRevision: 3 },
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      queue.correctBlocked(
        "user-a",
        original.id,
        { kind: "set.update", setId: "different-set", patch: { reps: 8, rpe: 10 } },
        { expectedRevision: 4 },
      ),
    ).rejects.toMatchObject({ code: "validation" });
    await expect(
      queue.correctBlocked(
        "user-a",
        original.id,
        { kind: "set.update", setId: "set-1", patch: { reps: 9, rpe: 10 } },
        { expectedRevision: 4 },
      ),
    ).rejects.toMatchObject({ code: "validation" });
    expect(store.read()).toEqual([original]);
  });

  it("folds a blank RPE into an unsent set and compacts an unsent exercise tree", async () => {
    const store = new MemoryWorkoutMutationStore();
    let operation = 0;
    const queue = new WorkoutMutationOutbox(store, vi.fn(), {
      isOnline: () => false,
      createId: () => `tree-${++operation}`,
    });
    const exerciseId = "00000000-0000-4000-a000-000000000401";
    const setId = "00000000-0000-4000-a000-000000000402";
    await queue.enqueue("user-a", "session-1", {
      kind: "exercise.add",
      recordId: exerciseId,
      sessionId: "session-1",
      position: 0,
      input: { name: "DB Press" },
    });
    await queue.enqueue("user-a", "session-1", {
      kind: "set.add",
      recordId: setId,
      sessionExerciseId: exerciseId,
      setNumber: 1,
      input: { reps: 10, rpe: 8 },
    });
    await queue.enqueue("user-a", "session-1", {
      kind: "set.update",
      setId,
      patch: { rpe: null },
    });
    expect(store.read().find((item) => item.mutation.kind === "set.add")).toMatchObject({
      mutation: { input: { rpe: null } },
    });

    await expect(
      queue.enqueue("user-a", "session-1", {
        kind: "exercise.delete",
        sessionExerciseId: exerciseId,
      }),
    ).resolves.toMatchObject({ status: "applied" });
    expect(store.read()).toEqual([]);
  });

  it("keeps Finish after valid mutations added while its lane is still pending", async () => {
    const store = new MemoryWorkoutMutationStore();
    let operation = 0;
    const queue = new WorkoutMutationOutbox(store, vi.fn(), {
      isOnline: () => false,
      createId: () => `terminal-order-${++operation}`,
    });
    await queue.enqueue("user-a", "session-1", {
      kind: "session.finish",
      sessionId: "session-1",
      completedAt: "2026-08-31T12:49:00.000Z",
    });
    await queue.enqueue("user-a", "session-1", {
      kind: "session.meta",
      sessionId: "session-1",
      patch: { notes: "committed before Finish" },
    });
    expect(store.read().map((item) => item.mutation.kind)).toEqual([
      "session.meta",
      "session.finish",
    ]);
  });

  it("guarantees a second signed-in user's drain after another user's active flush", async () => {
    const store = new MemoryWorkoutMutationStore();
    let online = false;
    let operation = 0;
    let releaseA: (() => void) | null = null;
    const calls: string[] = [];
    const queue = new WorkoutMutationOutbox(
      store,
      vi.fn<WorkoutMutationExecutor>(async (_mutation, userId) => {
        calls.push(userId);
        if (userId === "user-a") await new Promise<void>((resolve) => (releaseA = resolve));
      }),
      {
        isOnline: () => online,
        createId: () => `user-drain-${++operation}`,
      },
    );
    await queue.enqueue("user-a", "session-a", update(8));
    await queue.enqueue("user-b", "session-b", update(9));
    online = true;
    const first = queue.flush("user-a");
    await vi.waitFor(() => expect(calls).toEqual(["user-a"]));
    const second = queue.flush("user-b");
    releaseA?.();
    await Promise.all([first, second]);

    expect(calls).toEqual(["user-a", "user-b"]);
    expect(store.read()).toEqual([]);
  });

  it("keeps queued recovery data through normal sign-out but clears it on account deletion", () => {
    const source = readFileSync(join(process.cwd(), "src/lib/auth/auth-provider.tsx"), "utf8");
    const signOut = source.slice(
      source.indexOf("const signOut"),
      source.indexOf("const deleteAccount"),
    );
    const deleteAccount = source.slice(source.indexOf("const deleteAccount"));
    expect(signOut).not.toContain("clearQueuedWorkoutMutationsForUser(userId)");
    expect(deleteAccount).toContain("clearQueuedWorkoutMutationsForUser(current.user.id)");
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
