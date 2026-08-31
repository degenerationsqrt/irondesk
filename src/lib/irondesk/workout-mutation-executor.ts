import * as repo from "./repo";
import type { WorkoutMutation } from "./workout-mutation-outbox";

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
): Promise<void> {
  await repo.assertAuthenticatedUser(expectedUserId);
  switch (mutation.kind) {
    case "set.add":
      await repo.addSet(mutation.sessionExerciseId, mutation.input, {
        id: mutation.recordId,
        setNumber: mutation.setNumber,
      });
      return;
    case "set.update":
      await repo.updateSet(mutation.setId, mutation.patch);
      return;
    case "set.delete":
      await repo.deleteSet(mutation.setId);
      return;
    case "exercise.add":
      await repo.addSessionExercise(mutation.sessionId, mutation.input, {
        id: mutation.recordId,
        position: mutation.position,
      });
      return;
    case "exercise.delete":
      await repo.removeSessionExercise(mutation.sessionExerciseId);
      return;
    case "exercise.substitute":
      await repo.substituteSessionExercise(mutation.sessionExerciseId, mutation.replacement);
      return;
    case "exercise.method":
      await repo.setSessionExerciseMethod({
        sessionExerciseId: mutation.sessionExerciseId,
        methodId: mutation.methodId,
        ...(mutation.config === undefined ? {} : { config: mutation.config }),
      });
      return;
    case "session.meta":
      await repo.updateSessionMeta(mutation.sessionId, mutation.patch);
      return;
    case "session.finish":
      await repo.markWorkoutFinished(mutation.sessionId, mutation.completedAt);
      return;
    case "session.cancel":
      await repo.cancelWorkout(mutation.sessionId, mutation.completedAt);
      return;
  }
}
