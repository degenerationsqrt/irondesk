import {
  activeWorkout,
  coachData,
  dashboardDay,
  exercises,
  historySessions,
  progressData,
  recoveryData,
} from "./data";
import { LEGACY_TEMPLATES } from "./legacy-templates";
import * as repo from "./repo";
import type {
  ActiveWorkout,
  CoachData,
  DashboardDay,
  Exercise,
  HistorySession,
  NutritionDay,
  ProgressData,
  RecoveryData,
  WorkoutTemplate,
} from "./types";

export type ServiceMode = "demo" | "live";

/**
 * Single mode-aware read boundary.
 *
 * `demo` resolves the deterministic mock dataset (read-only exploration);
 * `live` resolves the signed-in user's own Supabase rows. Nothing in the UI
 * imports the mock dataset directly, so a future mobile/API client can reuse
 * the same domain contract.
 */
export interface IronDeskService {
  mode: ServiceMode;
  getDashboard(): Promise<DashboardDay | null>;
  getActiveWorkout(): Promise<ActiveWorkout | null>;
  getHistory(): Promise<HistorySession[]>;
  getSession(id: string): Promise<HistorySession | null>;
  getExercises(): Promise<Exercise[]>;
  getExercise(id: string): Promise<Exercise | null>;
  getProgress(): Promise<ProgressData | null>;
  getRecovery(): Promise<RecoveryData | null>;
  getNutrition(): Promise<NutritionDay | null>;
  getCoach(): Promise<CoachData>;
  /** Read-only IronDesk Originals plus (live only) the athlete's own templates. */
  getWorkoutTemplates(): Promise<WorkoutTemplate[]>;
  getWorkoutTemplate(id: string): Promise<WorkoutTemplate | null>;
}

const ok = <T>(value: T): Promise<T> => Promise.resolve(value);

export const demoService: IronDeskService = {
  mode: "demo",
  getDashboard: () => ok(dashboardDay),
  getActiveWorkout: () => ok(activeWorkout),
  getHistory: () => ok(historySessions),
  getSession: (id) => ok(historySessions.find((s) => s.id === id) ?? null),
  getExercises: () => ok(exercises),
  getExercise: (id) => ok(exercises.find((e) => e.id === id) ?? null),
  getProgress: () => ok(progressData),
  getRecovery: () => ok(recoveryData),
  getNutrition: () => ok(dashboardDay.nutrition),
  getCoach: () => ok(coachData),
  getWorkoutTemplates: () => ok(LEGACY_TEMPLATES),
  getWorkoutTemplate: (id) => ok(LEGACY_TEMPLATES.find((t) => t.id === id) ?? null),
};

export const liveService: IronDeskService = {
  mode: "live",
  getDashboard: () => repo.getDashboard(),
  getActiveWorkout: () => repo.getActiveWorkout(),
  getHistory: () => repo.getHistory(),
  getSession: (id) => repo.getSession(id),
  getExercises: () => repo.getExercises(),
  getExercise: (id) => repo.getExercise(id),
  getProgress: () => repo.getProgress(),
  getRecovery: () => repo.getRecovery(),
  getNutrition: () => repo.getNutrition(),
  getCoach: () => repo.getCoach(),
  getWorkoutTemplates: () => repo.getWorkoutTemplates(),
  getWorkoutTemplate: (id) => repo.getWorkoutTemplate(id),
};

export function serviceFor(mode: ServiceMode): IronDeskService {
  return mode === "live" ? liveService : demoService;
}

export const queryKeys = {
  account: ["irondesk", "account"] as const,
  equipmentCatalog: ["irondesk", "equipment-catalog"] as const,
  dashboard: (mode: string) => ["irondesk", mode, "dashboard"] as const,
  workout: (mode: string) => ["irondesk", mode, "workout"] as const,
  history: (mode: string) => ["irondesk", mode, "history"] as const,
  session: (mode: string, id: string) => ["irondesk", mode, "session", id] as const,
  exercises: (mode: string) => ["irondesk", mode, "exercises"] as const,
  exercise: (mode: string, id: string) => ["irondesk", mode, "exercise", id] as const,
  progress: (mode: string) => ["irondesk", mode, "progress"] as const,
  recovery: (mode: string) => ["irondesk", mode, "recovery"] as const,
  nutrition: (mode: string) => ["irondesk", mode, "nutrition"] as const,
  coach: (mode: string) => ["irondesk", mode, "coach"] as const,
  templates: (mode: string) => ["irondesk", mode, "templates"] as const,
  template: (mode: string, id: string) => ["irondesk", mode, "template", id] as const,
};
