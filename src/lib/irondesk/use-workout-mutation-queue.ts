import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth/auth-provider";

import { IronDeskError } from "./errors";
import { getWorkoutMutationOutbox } from "./workout-mutation-queue";
import {
  type WorkoutMutation,
  type WorkoutMutationCommitResult,
  type WorkoutMutationEnqueueOptions,
  type WorkoutMutationQueueSnapshot,
  type WorkoutTerminalReceipt,
} from "./workout-mutation-outbox";

const EMPTY_SNAPSHOT: WorkoutMutationQueueSnapshot = {
  durable: false,
  flushing: false,
  pendingCount: 0,
  blockedCount: 0,
  lastAppliedAt: null,
  lastError: null,
  nextAttemptAt: null,
  items: [],
  issues: [],
  terminalReceipts: [],
};

export interface WorkoutMutationQueueApi extends WorkoutMutationQueueSnapshot {
  commit: (
    mutation: WorkoutMutation,
    options?: WorkoutMutationEnqueueOptions,
  ) => Promise<WorkoutMutationCommitResult>;
  retryBlocked: () => Promise<void>;
  correctBlocked: (
    itemId: string,
    replacement: WorkoutMutation,
    options: { expectedRevision: number; requireAcknowledgment?: boolean },
  ) => Promise<WorkoutMutationCommitResult>;
  discardLane: (laneId: string) => void;
  flush: (force?: boolean) => Promise<void>;
  terminalReceipt: (itemId: string) => WorkoutTerminalReceipt | null;
  retryTerminalReceipt: (itemId: string) => Promise<void>;
  dismissTerminalReceipt: (itemId: string) => boolean;
}

const WorkoutMutationQueueContext = createContext<WorkoutMutationQueueApi | null>(null);

/**
 * Owns the single authenticated outbox subscription and retry runner.
 * Mount once beneath AuthProvider so replay continues outside the workout route.
 */
export function WorkoutMutationQueueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const queue = useMemo(() => getWorkoutMutationOutbox(), []);
  const [snapshot, setSnapshot] = useState<WorkoutMutationQueueSnapshot>(() =>
    userId ? queue.snapshot(userId) : EMPTY_SNAPSHOT,
  );

  useEffect(() => {
    const update = () => setSnapshot(userId ? queue.snapshot(userId) : EMPTY_SNAPSHOT);
    update();
    return queue.subscribe(update);
  }, [queue, userId]);

  useEffect(() => {
    if (!userId) return;
    const flush = () => void queue.flush(userId);
    const onVisibility = () => {
      if (document.visibilityState === "visible") flush();
    };
    window.addEventListener("online", flush);
    window.addEventListener("focus", flush);
    document.addEventListener("visibilitychange", onVisibility);
    flush();
    return () => {
      window.removeEventListener("online", flush);
      window.removeEventListener("focus", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [queue, userId]);

  // Wake at the actual head retry time. A 15-second heartbeat remains only as
  // a browser-event fallback when pending work has no scheduled backoff.
  useEffect(() => {
    if (!userId || snapshot.pendingCount === 0 || snapshot.flushing) return;
    const due = snapshot.nextAttemptAt
      ? new Date(snapshot.nextAttemptAt).getTime() - Date.now()
      : 15_000;
    const timer = window.setTimeout(() => void queue.flush(userId), Math.max(0, due));
    return () => window.clearTimeout(timer);
  }, [queue, snapshot.flushing, snapshot.nextAttemptAt, snapshot.pendingCount, userId]);

  // A drain can finish after the user leaves the workout route. Coalesce the
  // resulting cache refreshes so a large recovered journal triggers one global
  // IronDesk refetch batch instead of one refetch per applied mutation.
  useEffect(() => {
    if (!snapshot.lastAppliedAt) return;
    const timer = window.setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: ["irondesk"] }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [queryClient, snapshot.lastAppliedAt]);

  const commit = useCallback(
    async (mutation: WorkoutMutation, options?: WorkoutMutationEnqueueOptions) => {
      if (!userId)
        throw new IronDeskError("Your session expired. Sign in again.", "unauthenticated");
      return queue.enqueue(userId, mutation, options);
    },
    [queue, userId],
  );

  const retryBlocked = useCallback(async () => {
    if (!userId) return;
    await queue.retryBlocked(userId);
  }, [queue, userId]);

  const correctBlocked = useCallback(
    async (
      itemId: string,
      replacement: WorkoutMutation,
      options: { expectedRevision: number; requireAcknowledgment?: boolean },
    ) => {
      if (!userId)
        throw new IronDeskError("Your session expired. Sign in again.", "unauthenticated");
      return queue.correctBlocked(userId, itemId, replacement, options);
    },
    [queue, userId],
  );

  const discardLane = useCallback(
    (laneId: string) => {
      if (userId) queue.discardLane(userId, laneId);
    },
    [queue, userId],
  );

  const flush = useCallback(
    async (force = false) => {
      if (userId) await queue.flush(userId, force);
    },
    [queue, userId],
  );

  const terminalReceipt = useCallback((itemId: string) => queue.terminalReceipt(itemId), [queue]);
  const retryTerminalReceipt = useCallback(
    async (itemId: string) => {
      if (userId) await queue.retryTerminalReceipt(userId, itemId);
    },
    [queue, userId],
  );
  const dismissTerminalReceipt = useCallback(
    (itemId: string) => queue.dismissTerminalReceipt(itemId),
    [queue],
  );

  const value = useMemo<WorkoutMutationQueueApi>(
    () => ({
      ...snapshot,
      commit,
      retryBlocked,
      correctBlocked,
      discardLane,
      flush,
      terminalReceipt,
      retryTerminalReceipt,
      dismissTerminalReceipt,
    }),
    [
      commit,
      correctBlocked,
      discardLane,
      flush,
      retryBlocked,
      snapshot,
      terminalReceipt,
      retryTerminalReceipt,
      dismissTerminalReceipt,
    ],
  );

  return createElement(WorkoutMutationQueueContext.Provider, { value }, children);
}

export function useWorkoutMutationQueue(): WorkoutMutationQueueApi {
  const context = useContext(WorkoutMutationQueueContext);
  if (!context)
    throw new Error("useWorkoutMutationQueue must be used inside WorkoutMutationQueueProvider.");
  return context;
}
