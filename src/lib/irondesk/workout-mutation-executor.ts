import * as repo from "./repo";
import type { WorkoutMutation, WorkoutMutationLaneState } from "./workout-mutation-outbox";

/** Authenticated, abortable session-state inspection used before replaying a terminal lane. */
export async function preflightWorkoutMutationLane(
  sessionId: string,
  expectedUserId: string,
  signal: AbortSignal,
): Promise<WorkoutMutationLaneState | null> {
  signal.throwIfAborted();
  await repo.assertAuthenticatedUser(expectedUserId);
  signal.throwIfAborted();
  return repo.getWorkoutSessionState(sessionId, { signal });
}

/**
 * Executes only retry-safe workout mutations.
 *
 * New rows carry client-generated UUIDs, so a response-lost replay can prove
 * the original insert by primary key. Updates/deletes target an immutable row
 * id and carry their timestamps in the durable operation rather than creating
 * a new timestamp on every retry.
 */
export async function executeWorkoutMutation(
  mutation: WorkoutMutation,
  expectedUserId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  await repo.assertAuthenticatedUser(expectedUserId);
  signal.throwIfAborted();
  switch (mutation.kind) {
    case "set.add":
      await repo.addSet(
        mutation.sessionExerciseId,
        mutation.input,
        {
          id: mutation.recordId,
          setNumber: mutation.setNumber,
        },
        { signal },
      );
      return;
    case "set.update":
      await repo.updateSet(mutation.setId, mutation.patch, { signal });
      return;
    case "set.delete":
      await repo.deleteSet(mutation.setId, { signal });
      return;
    case "exercise.add":
      await repo.addSessionExercise(
        mutation.sessionId,
        mutation.input,
        {
          id: mutation.recordId,
          position: mutation.position,
        },
        { signal },
      );
      return;
    case "exercise.delete":
      await repo.removeSessionExercise(mutation.sessionExerciseId, { signal });
      return;
    case "exercise.substitute":
      await repo.substituteSessionExercise(mutation.sessionExerciseId, mutation.replacement, {
        signal,
      });
      return;
    case "exercise.method":
      await repo.setSessionExerciseMethod(
        {
          sessionExerciseId: mutation.sessionExerciseId,
          methodId: mutation.methodId,
          ...(mutation.config === undefined ? {} : { config: mutation.config }),
        },
        { signal },
      );
      return;
    case "session.meta":
      await repo.updateSessionMeta(mutation.sessionId, mutation.patch, { signal });
      return;
    case "session.finish":
      await repo.markWorkoutFinished(mutation.sessionId, mutation.completedAt, {
        signal,
        ...(mutation.recoverCancelled ? { recoverCancelled: true } : {}),
      });
      return;
    case "session.cancel":
      await repo.cancelWorkout(mutation.sessionId, mutation.completedAt, { signal });
      return;
    case "black.apply":
      await repo.applyBlackWorkoutPlan(mutation.input, { signal });
      return;
  }
}
