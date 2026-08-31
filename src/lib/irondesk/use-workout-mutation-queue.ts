import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth/auth-provider";

import { IronDeskError } from "./errors";
import { getWorkoutMutationOutbox } from "./workout-mutation-queue";
import {
  type WorkoutMutation,
  type WorkoutMutationCommitResult,
  type WorkoutMutationQueueSnapshot,
} from "./workout-mutation-outbox";

const EMPTY_SNAPSHOT: WorkoutMutationQueueSnapshot = {
  durable: false,
  flushing: false,
  pendingCount: 0,
  blockedCount: 0,
  lastAppliedAt: null,
  lastError: null,
  items: [],
};

export interface WorkoutMutationQueueApi extends WorkoutMutationQueueSnapshot {
  commit: (mutation: WorkoutMutation) => Promise<WorkoutMutationCommitResult>;
  retryBlocked: () => Promise<void>;
  discardBlocked: () => void;
}

/** Durable, user-scoped retry queue for mutations made during an active workout. */
export function useWorkoutMutationQueue(): WorkoutMutationQueueApi {
  const { user } = useAuth();
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
    window.addEventListener("online", flush);
    const timer = window.setInterval(flush, 15_000);
    flush();
    return () => {
      window.removeEventListener("online", flush);
      window.clearInterval(timer);
    };
  }, [queue, userId]);

  const commit = useCallback(
    async (mutation: WorkoutMutation) => {
      if (!userId)
        throw new IronDeskError("Your session expired. Sign in again.", "unauthenticated");
      return queue.enqueue(userId, mutation);
    },
    [queue, userId],
  );

  const retryBlocked = useCallback(async () => {
    if (!userId) return;
    await queue.retryBlocked(userId);
  }, [queue, userId]);

  const discardBlocked = useCallback(() => {
    if (userId) queue.discardBlocked(userId);
  }, [queue, userId]);

  return { ...snapshot, commit, retryBlocked, discardBlocked };
}
