import { queryOptions } from "@tanstack/react-query";

import * as programs from "./programs";
import * as repo from "./repo";
import { queryKeys, serviceFor, type ServiceMode } from "./service";

/**
 * Mode-aware query definitions. The mode is part of every key so demo data can
 * never bleed into a signed-in account's cache (and vice versa).
 */
export const dashboardQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.dashboard(mode), queryFn: () => serviceFor(mode).getDashboard() });

export const workoutQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.workout(mode), queryFn: () => serviceFor(mode).getActiveWorkout() });

export const historyQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.history(mode), queryFn: () => serviceFor(mode).getHistory() });

export const sessionQuery = (mode: ServiceMode, id: string) =>
  queryOptions({ queryKey: queryKeys.session(mode, id), queryFn: () => serviceFor(mode).getSession(id) });

export const exercisesQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.exercises(mode), queryFn: () => serviceFor(mode).getExercises() });

export const exerciseQuery = (mode: ServiceMode, id: string) =>
  queryOptions({ queryKey: queryKeys.exercise(mode, id), queryFn: () => serviceFor(mode).getExercise(id) });

export const progressQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.progress(mode), queryFn: () => serviceFor(mode).getProgress() });

export const recoveryQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.recovery(mode), queryFn: () => serviceFor(mode).getRecovery() });

export const nutritionQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.nutrition(mode), queryFn: () => serviceFor(mode).getNutrition() });

export const coachQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.coach(mode), queryFn: () => serviceFor(mode).getCoach() });

export const templatesQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.templates(mode), queryFn: () => serviceFor(mode).getWorkoutTemplates() });

export const templateQuery = (mode: ServiceMode, id: string) =>
  queryOptions({ queryKey: queryKeys.template(mode, id), queryFn: () => serviceFor(mode).getWorkoutTemplate(id) });

export const progressionQuery = (mode: ServiceMode) =>
  queryOptions({ queryKey: queryKeys.progression(mode), queryFn: () => serviceFor(mode).getProgression() });

/** IronDesk Black specialization windows for the signed-in athlete. */
export const specializationWindowsQuery = (mode: ServiceMode) =>
  queryOptions({
    queryKey: queryKeys.specializationWindows(mode),
    queryFn: () => serviceFor(mode).getSpecializationWindows(),
  });

/** Signed-in account context (profile + preferences + equipment). */
export const accountQuery = queryOptions({
  queryKey: queryKeys.account,
  queryFn: () => repo.getAccount(),
});

export const equipmentCatalogQuery = queryOptions({
  queryKey: queryKeys.equipmentCatalog,
  queryFn: () => repo.listEquipmentCatalog(),
});

/* -------------------------------------------------------------------------- */
/* Assigned programs (live only — demo mode never enrolls)                    */
/* -------------------------------------------------------------------------- */

export const programCatalogQuery = queryOptions({
  queryKey: ["irondesk", "live", "programs"] as const,
  queryFn: () => programs.listPrograms(),
});

export const enrollmentQuery = queryOptions({
  queryKey: ["irondesk", "live", "enrollment"] as const,
  queryFn: () => programs.getCurrentEnrollment(),
});

export const assignedSessionContextsQuery = queryOptions({
  queryKey: ["irondesk", "live", "assigned-session-contexts"] as const,
  queryFn: () => programs.getAssignedSessionContexts(),
});
