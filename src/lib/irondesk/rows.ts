/**
 * Database row shapes used by the Supabase repositories, plus type aliases
 * pulled from the generated `Database` type. Keeping them here means the
 * mapper/derivation layer never imports Supabase itself.
 */
import type { Database } from "@/integrations/supabase/types";

type T = Database["public"]["Tables"];

export type ProfileRow = T["profiles"]["Row"];
export type PreferencesRow = T["user_preferences"]["Row"];
export type EquipmentRow = T["equipment_catalog"]["Row"];
export type ExerciseRow = T["exercises"]["Row"];
export type BodyMetricRow = T["body_metrics"]["Row"];
export type CardioRow = T["cardio_sessions"]["Row"];
export type NutritionDayRow = T["nutrition_days"]["Row"];
export type MealRow = T["meals"]["Row"];
export type RecoveryRow = T["recovery_entries"]["Row"];
export type SessionRowBase = T["workout_sessions"]["Row"];

export interface SetRow {
  id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  completed: boolean;
  is_warmup: boolean;
  rest_seconds: number | null;
  completed_at: string | null;
  notes: string | null;
}

/** Prescription context copied from a template into the live session. */
export interface PrescriptionColumns {
  target_rpe: number | null;
  rest_seconds: number | null;
  load_guidance: string | null;
  source_load_unit: string | null;
  is_drop_set: boolean;
  is_heavy: boolean;
}

export interface SessionExerciseRow extends PrescriptionColumns {
  id: string;
  exercise_id: string | null;
  original_exercise_id: string | null;
  exercise_name: string;
  primary_muscle: string | null;
  equipment: string | null;
  position: number;
  target_sets: number | null;
  target_reps: string | null;
  notes: string | null;
  workout_sets: SetRow[];
}

export interface FullSessionRow {
  id: string;
  title: string;
  kind: string;
  focus: string | null;
  status: string;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  perceived_effort: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  cardio_load: number | null;
  active_zone_minutes: number | null;
  session_exercises: SessionExerciseRow[];
}

const PRESCRIPTION_COLUMNS = "target_rpe, rest_seconds, load_guidance, source_load_unit, is_drop_set, is_heavy";

export const FULL_SESSION_SELECT = `
  id, title, kind, focus, status, started_at, completed_at, notes, perceived_effort,
  calories, avg_hr, max_hr, cardio_load, active_zone_minutes,
  session_exercises (
    id, exercise_id, original_exercise_id, exercise_name, primary_muscle, equipment,
    position, target_sets, target_reps, notes, ${PRESCRIPTION_COLUMNS},
    workout_sets (
      id, set_number, weight_kg, reps, rpe, completed, is_warmup, rest_seconds, completed_at, notes
    )
  )
`;

/* --------------------------------- templates -------------------------------- */

export interface TemplateExerciseRow extends PrescriptionColumns {
  id: string;
  exercise_id: string | null;
  exercise_name: string;
  position: number;
  target_sets: number | null;
  target_reps: string | null;
  notes: string | null;
}

export interface TemplateRow {
  id: string;
  user_id: string | null;
  name: string;
  focus: string | null;
  notes: string | null;
  is_system: boolean;
  source_key: string | null;
  source_name: string | null;
  source_version: number;
  environment: string | null;
  workout_type: string | null;
  category: string | null;
  level: string | null;
  estimated_minutes: number | null;
  tags: string[] | null;
  sort_order: number;
  legacy_day_id: string | null;
  /** Delivery gate columns (assigned-program migration). */
  release_gate: string | null;
  requires_acknowledgment: boolean | null;
  library_startable: boolean | null;
  warnings: unknown;
  template_exercises: TemplateExerciseRow[];
}

export const FULL_TEMPLATE_SELECT = `
  id, user_id, name, focus, notes, is_system, source_key, source_name, source_version,
  environment, workout_type, category, level, estimated_minutes, tags, sort_order, legacy_day_id,
  release_gate, requires_acknowledgment, library_startable, warnings,
  template_exercises (
    id, exercise_id, exercise_name, position, target_sets, target_reps, notes, ${PRESCRIPTION_COLUMNS}
  )
`;
