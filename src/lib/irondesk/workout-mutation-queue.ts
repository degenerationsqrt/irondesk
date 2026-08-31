import { executeWorkoutMutation } from "./workout-mutation-executor";
import {
  WorkoutMutationOutbox,
  createBrowserWorkoutMutationStore,
} from "./workout-mutation-outbox";

let browserOutbox: WorkoutMutationOutbox | null = null;

export function getWorkoutMutationOutbox(): WorkoutMutationOutbox {
  if (!browserOutbox) {
    browserOutbox = new WorkoutMutationOutbox(
      createBrowserWorkoutMutationStore(),
      executeWorkoutMutation,
    );
  }
  return browserOutbox;
}

/** Account deletion removes pending local workout data for that identity. */
export function clearQueuedWorkoutMutationsForUser(userId: string): void {
  getWorkoutMutationOutbox().clearUser(userId);
}
