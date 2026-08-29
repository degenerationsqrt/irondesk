/**
 * Supabase repository for authenticated ("live") mode.
 *
 * Rules enforced here:
 *  - ownership is ALWAYS derived from the authenticated session, never from
 *    client-supplied ids;
 *  - weights are persisted as canonical kilograms;
 *  - every read is scoped by RLS, so queries do not filter by user_id except
 *    where an index benefits from it.
 */
import { supabase } from "@/integrations/supabase/client";

import type { Database } from "@/integrations/supabase/types";

import {
  buildCoach,
  buildDashboard,
  buildExercise,
  buildNutrition,
  buildProgress,
  buildRecovery,
  sessionTotals,
  toCardioHistorySession,
  toHistorySession,
  toImportedHistorySession,
} from "./derive";
import { dayKeyForInstant, safeTimeZone } from "./dates";
import { IronDeskError, asIronDeskError } from "./errors";
import {
  excludeLikelyMirroredActivities,
  importedActivitiesForLocalDay,
  importedActivitiesToDashboard,
  summarizeHealthMetricsByDay,
  type HealthMetricRow,
  type ImportedActivityRow,
  type ImportedDashboardActivity,
  type LoggedActivityIdentity,
} from "./imported-data-adapter";
import {
  FULL_SESSION_SELECT,
  FULL_TEMPLATE_SELECT,
  type BodyMetricRow,
  type CardioRow,
  type EquipmentRow,
  type ExerciseRow,
  type FullSessionRow,
  type MealRow,
  type NutritionDayRow,
  type PreferencesRow,
  type ProfileRow,
  type RecoveryRow,
  type TemplateRow,
} from "./rows";
import {
  isExactSampleNutritionDay,
  isExactSampleRecovery,
  partitionSampleMeals,
  sumNutritionMeals,
} from "./sample-data";
import { isFreeStartable } from "./program-logic";
import { performanceKey, type PerformanceMap, type PerformancePoint } from "./progression";
import type { ProgressionContext } from "./progression-source";
import { toWarnings } from "./programs";
import type {
  ActiveWorkout,
  CoachData,
  DashboardDay,
  Exercise,
  HistorySession,
  NutritionDay,
  ProgressData,
  RecoveryData,
  ReleaseGate,
  SetEntry,
  TemplateExercise,
  WorkoutExercise,
  WorkoutTemplate,
} from "./types";

export interface AccountContext {
  profile: ProfileRow | null;
  preferences: PreferencesRow | null;
  equipmentIds: string[];
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user)
    throw new IronDeskError("Your session expired. Sign in again.", "unauthenticated");
  return data.user.id;
}

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  if (res.data == null) throw new IronDeskError("No data returned.", "not_found");
  return res.data;
}

// ------------------------------------------------------------------- account
export async function getAccount(retry = true): Promise<AccountContext> {
  const userId = await requireUserId();
  const [profileRes, prefsRes, equipRes] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
    supabase.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("user_equipment").select("equipment_id"),
  ]);
  if (profileRes.error) throw asIronDeskError(new Error(profileRes.error.message));
  // Idempotent bootstrap: a fresh auth user has no profile/preferences rows yet.
  if (!profileRes.data && retry) {
    const { data: user } = await supabase.auth.getUser();
    const displayName =
      (user.user?.user_metadata?.["display_name"] as string | undefined) ??
      user.user?.email?.split("@")[0] ??
      "Athlete";
    await supabase.rpc("bootstrap_current_user", { _display_name: displayName });
    return getAccount(false);
  }
  return {
    profile: profileRes.data ?? null,
    preferences: prefsRes.data ?? null,
    equipmentIds: (equipRes.data ?? []).map((r) => r.equipment_id),
  };
}

export async function updateProfile(patch: Partial<ProfileRow>): Promise<void> {
  const userId = await requireUserId();
  const { id: _ignored, ...safe } = patch;
  const { error } = await supabase.from("profiles").update(safe).eq("id", userId);
  if (error) throw asIronDeskError(new Error(error.message));
}

export async function updatePreferences(patch: Partial<PreferencesRow>): Promise<void> {
  const userId = await requireUserId();
  const { user_id: _ignored, ...safe } = patch;
  const { error } = await supabase
    .from("user_preferences")
    .upsert({ user_id: userId, ...safe }, { onConflict: "user_id" });
  if (error) throw asIronDeskError(new Error(error.message));
}

export async function listEquipmentCatalog(): Promise<EquipmentRow[]> {
  const res = await supabase.from("equipment_catalog").select("*").order("sort_order");
  return unwrap(res);
}

export async function setUserEquipment(equipmentIds: string[]): Promise<void> {
  const userId = await requireUserId();
  const del = await supabase.from("user_equipment").delete().eq("user_id", userId);
  if (del.error) throw asIronDeskError(new Error(del.error.message));
  if (!equipmentIds.length) return;
  const ins = await supabase
    .from("user_equipment")
    .insert(equipmentIds.map((equipment_id) => ({ user_id: userId, equipment_id })));
  if (ins.error) throw asIronDeskError(new Error(ins.error.message));
}

// ------------------------------------------------------------------ sessions
async function fetchSessions(options: { since?: Date; statuses?: string[]; limit?: number } = {}) {
  let query = supabase
    .from("workout_sessions")
    .select(FULL_SESSION_SELECT)
    .eq("is_sample", false)
    .order("started_at", { ascending: false });
  if (options.since) query = query.gte("started_at", options.since.toISOString());
  if (options.statuses) query = query.in("status", options.statuses);
  if (options.limit) query = query.limit(options.limit);
  const res = await query.returns<FullSessionRow[]>();
  return unwrap(res);
}

async function fetchImportedActivities(
  options: { since?: Date; limit?: number } = {},
): Promise<ImportedActivityRow[]> {
  let query = supabase
    .from("imported_activities")
    .select("*")
    .order("started_at", { ascending: false });
  if (options.since) query = query.gte("started_at", options.since.toISOString());
  if (options.limit) query = query.limit(options.limit);
  const res = await query.returns<ImportedActivityRow[]>();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  return res.data ?? [];
}

function loggedActivityIdentities(
  sessions: FullSessionRow[],
  cardio: CardioRow[] = [],
): LoggedActivityIdentity[] {
  return [
    ...sessions.map((session) => ({
      name: session.title,
      startedAt: session.started_at,
      durationMinutes: sessionTotals(session).durationMin,
    })),
    ...cardio.map((session) => ({
      name: session.name,
      startedAt: session.started_at,
      durationMinutes: session.duration_min,
    })),
  ];
}

function withoutNativeMirrors(
  imported: ImportedDashboardActivity[],
  sessions: FullSessionRow[],
  cardio: CardioRow[] = [],
): ImportedDashboardActivity[] {
  return excludeLikelyMirroredActivities(imported, loggedActivityIdentities(sessions, cardio));
}

export async function getHistory(): Promise<HistorySession[]> {
  const account = await getAccount();
  const timeZone = safeTimeZone(account.profile?.timezone);
  const [rows, cardioRes, importedRows] = await Promise.all([
    fetchSessions({ statuses: ["completed"], limit: 100 }),
    supabase
      .from("cardio_sessions")
      .select("*")
      .eq("is_sample", false)
      .order("started_at", { ascending: false })
      .limit(100)
      .returns<CardioRow[]>(),
    fetchImportedActivities({ limit: 200 }),
  ]);
  if (cardioRes.error) throw asIronDeskError(new Error(cardioRes.error.message));
  const cardio = cardioRes.data ?? [];
  const imported = withoutNativeMirrors(
    importedActivitiesToDashboard(importedRows, timeZone),
    rows,
    cardio,
  );
  return [
    ...rows.map(toHistorySession),
    ...cardio.map(toCardioHistorySession),
    ...imported.map(toImportedHistorySession),
  ].sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
}

export async function getSession(id: string): Promise<HistorySession | null> {
  const res = await supabase
    .from("workout_sessions")
    .select(FULL_SESSION_SELECT)
    .eq("id", id)
    .eq("is_sample", false)
    .maybeSingle()
    .returns<FullSessionRow | null>();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  return res.data ? toHistorySession(res.data) : null;
}

// ----------------------------------------------------------------- dashboard
export async function getDashboard(): Promise<DashboardDay | null> {
  const account = await getAccount();
  const timeZone = safeTimeZone(account.profile?.timezone);
  const now = new Date();
  const dayKey = dayKeyForInstant(now, timeZone);
  const recentSince = new Date(now.getTime() - 7 * 86_400_000);
  const [sessionRows, cardioRes, importedRows, nutrition, latestRecovery] = await Promise.all([
    fetchSessions({ since: recentSince, statuses: ["completed", "active"] }),
    supabase
      .from("cardio_sessions")
      .select("*")
      .eq("is_sample", false)
      .gte("started_at", recentSince.toISOString())
      .returns<CardioRow[]>(),
    fetchImportedActivities({ since: recentSince, limit: 500 }),
    getNutrition(dayKey),
    getRecovery(),
  ]);
  if (cardioRes.error) throw asIronDeskError(new Error(cardioRes.error.message));

  const today = sessionRows.filter(
    (session) => dayKeyForInstant(session.started_at, timeZone) === dayKey,
  );
  const week = sessionRows.filter((session) => session.status === "completed");
  const cardioRows = cardioRes.data ?? [];
  const todayCardio = cardioRows.filter(
    (session) => dayKeyForInstant(session.started_at, timeZone) === dayKey,
  );
  const importedWeek = withoutNativeMirrors(
    importedActivitiesToDashboard(importedRows, timeZone),
    week,
    cardioRows,
  );
  const todayImported = withoutNativeMirrors(
    importedActivitiesForLocalDay(importedRows, dayKey, timeZone),
    today,
    todayCardio,
  );
  const recovery = latestRecovery?.day === dayKey ? latestRecovery : null;

  const hasAnything =
    today.length ||
    week.length ||
    todayCardio.length ||
    todayImported.length ||
    importedWeek.length ||
    nutrition ||
    recovery;
  if (!hasAnything) return null;

  return buildDashboard({
    todaySessions: today,
    weekSessions: week,
    todayCardio,
    weekCardio: cardioRows,
    todayImported,
    weekImported: importedWeek,
    nutrition,
    recovery,
    preferences: account.preferences,
    displayName: account.profile?.display_name ?? "Athlete",
    dayKey,
    timeZone,
  });
}

// ----------------------------------------------------------------- nutrition
export async function getNutrition(day?: string): Promise<NutritionDay | null> {
  const account = await getAccount();
  const effectiveDay = day ?? dayKeyForInstant(new Date(), account.profile?.timezone);
  const dayRes = await supabase
    .from("nutrition_days")
    .select("*")
    .eq("day", effectiveDay)
    .eq("is_sample", false)
    .maybeSingle();
  if (dayRes.error) throw asIronDeskError(new Error(dayRes.error.message));
  const row = (dayRes.data ?? null) as NutritionDayRow | null;
  if (!row) return null;
  const mealsRes = await supabase
    .from("meals")
    .select("*")
    .eq("nutrition_day_id", row.id)
    .order("created_at");
  return buildNutrition(row, (mealsRes.data ?? []) as MealRow[], account.preferences);
}

/** Creates today's nutrition day from the user's targets if it does not exist. */
export async function ensureNutritionDay(day?: string): Promise<string> {
  const userId = await requireUserId();
  const account = await getAccount();
  const effectiveDay = day ?? dayKeyForInstant(new Date(), account.profile?.timezone);
  const existing = await supabase
    .from("nutrition_days")
    .select("id, is_sample")
    .eq("day", effectiveDay)
    .maybeSingle();
  if (existing.data?.id && existing.data.is_sample) {
    throw new IronDeskError(
      "Sample nutrition occupies today. Remove sample data in Settings before logging real meals.",
      "conflict",
    );
  }
  if (existing.data?.id) return existing.data.id;
  const res = await supabase
    .from("nutrition_days")
    .insert({
      user_id: userId,
      day: effectiveDay,
      calorie_target: account.preferences?.calorie_target ?? null,
      protein_target_g: account.preferences?.protein_target_g ?? null,
    })
    .select("id")
    .single();
  return unwrap(res).id;
}

export async function addMeal(input: {
  name: string;
  timeLabel?: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  items?: string[];
}): Promise<void> {
  const dayId = await ensureNutritionDay();
  const ins = await supabase.from("meals").insert({
    nutrition_day_id: dayId,
    name: input.name,
    eaten_at_label: input.timeLabel ?? null,
    calories: input.calories,
    protein_g: input.proteinG,
    carbs_g: input.carbsG,
    fat_g: input.fatG,
    items: input.items ?? [],
  });
  if (ins.error) throw asIronDeskError(new Error(ins.error.message));
  await recalcNutritionTotals(dayId);
}

export async function setHydration(ml: number): Promise<void> {
  const dayId = await ensureNutritionDay();
  const { error } = await supabase
    .from("nutrition_days")
    .update({ hydration_ml: Math.max(0, ml) })
    .eq("id", dayId);
  if (error) throw asIronDeskError(new Error(error.message));
}

async function recalcNutritionTotals(dayId: string): Promise<void> {
  const meals = await supabase
    .from("meals")
    .select("calories, protein_g, carbs_g, fat_g")
    .eq("nutrition_day_id", dayId);
  const rows = meals.data ?? [];
  const sum = (key: "calories" | "protein_g" | "carbs_g" | "fat_g") =>
    rows.reduce((s, m) => s + (m[key] ?? 0), 0);
  await supabase
    .from("nutrition_days")
    .update({
      calories: sum("calories"),
      protein_g: sum("protein_g"),
      carbs_g: sum("carbs_g"),
      fat_g: sum("fat_g"),
    })
    .eq("id", dayId);
}

// ------------------------------------------------------------------ recovery
export async function getRecovery(): Promise<RecoveryData | null> {
  const res = await supabase
    .from("recovery_entries")
    .select("*")
    .eq("is_sample", false)
    .order("day", { ascending: false })
    .limit(14);
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  const rows = (res.data ?? []) as RecoveryRow[];
  return buildRecovery(rows[0] ?? null, rows);
}

export async function saveRecoveryCheckIn(input: {
  sleepHours: number;
  sleepEfficiency?: number;
  restingHr?: number;
  fatigue: number;
  stress: number;
  note?: string;
  soreness?: { area: string; level: number }[];
}): Promise<void> {
  const [userId, account] = await Promise.all([requireUserId(), getAccount()]);
  const { error } = await supabase.from("recovery_entries").upsert(
    {
      user_id: userId,
      day: dayKeyForInstant(new Date(), account.profile?.timezone),
      sleep_hours: input.sleepHours,
      sleep_efficiency_percent: input.sleepEfficiency ?? null,
      resting_hr: input.restingHr ?? null,
      fatigue: input.fatigue,
      stress: input.stress,
      note: input.note ?? null,
      soreness: input.soreness ?? [],
      source: "manual",
      is_sample: false,
    },
    { onConflict: "user_id,day" },
  );
  if (error) throw asIronDeskError(new Error(error.message));
}

// ------------------------------------------------------------------ progress
export async function getProgress(): Promise<ProgressData | null> {
  const account = await getAccount();
  const timeZone = safeTimeZone(account.profile?.timezone);
  const [metricsRes, importedMetricsRes, sessions] = await Promise.all([
    supabase
      .from("body_metrics")
      .select("*")
      .eq("is_sample", false)
      .order("recorded_at", { ascending: true })
      .returns<BodyMetricRow[]>(),
    supabase
      .from("health_metrics")
      .select("*")
      .eq("metric_type", "bodyweight_kg")
      .order("recorded_at", { ascending: true })
      .returns<HealthMetricRow[]>(),
    fetchSessions({ statuses: ["completed"], limit: 200 }),
  ]);
  if (metricsRes.error) throw asIronDeskError(new Error(metricsRes.error.message));
  if (importedMetricsRes.error) throw asIronDeskError(new Error(importedMetricsRes.error.message));
  const metrics = metricsRes.data ?? [];
  const importedBodyweight = summarizeHealthMetricsByDay(importedMetricsRes.data ?? [], timeZone)
    .filter((summary) => summary.bodyweightKg != null)
    .map((summary) => ({ date: summary.day, kg: summary.bodyweightKg! }));
  if (!metrics.length && !sessions.length && !importedBodyweight.length) return null;
  const progress = buildProgress(metrics, [...sessions].reverse());
  const merged = new Map(
    progress.bodyweight.map((point) => [dayKeyForInstant(point.date, timeZone), point]),
  );
  for (const point of importedBodyweight)
    if (!merged.has(point.date)) merged.set(point.date, point);
  progress.bodyweight = [...merged.values()].sort((left, right) =>
    left.date.localeCompare(right.date),
  );
  return progress;
}

export async function addBodyMetric(input: {
  weightKg: number;
  bodyFatPercent?: number;
  note?: string;
}): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("body_metrics").insert({
    user_id: userId,
    weight_kg: input.weightKg,
    body_fat_percent: input.bodyFatPercent ?? null,
    note: input.note ?? null,
  });
  if (error) throw asIronDeskError(new Error(error.message));
  await supabase.from("profiles").update({ current_weight_kg: input.weightKg }).eq("id", userId);
}

// ----------------------------------------------------------------- exercises
interface ExerciseHistoryEntry {
  date: string;
  weightKg: number;
  reps: number;
  sets: number;
  tonnageKg: number;
}

async function loadExerciseHistory(): Promise<Map<string, ExerciseHistoryEntry[]>> {
  const res = await supabase
    .from("session_exercises")
    .select(
      "exercise_id, workout_sets(weight_kg, reps, completed, is_warmup), workout_sessions!inner(started_at, status, is_sample)",
    )
    .not("exercise_id", "is", null)
    .returns<
      {
        exercise_id: string;
        workout_sets: {
          weight_kg: number | null;
          reps: number | null;
          completed: boolean;
          is_warmup: boolean;
        }[];
        workout_sessions: { started_at: string; status: string; is_sample: boolean };
      }[]
    >();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  const map = new Map<string, ExerciseHistoryEntry[]>();
  for (const row of res.data ?? []) {
    if (row.workout_sessions?.status !== "completed" || row.workout_sessions.is_sample) continue;
    const working = (row.workout_sets ?? []).filter((s) => s.completed && !s.is_warmup);
    if (!working.length) continue;
    const best = working.reduce((a, b) => ((b.weight_kg ?? 0) > (a.weight_kg ?? 0) ? b : a));
    const entry: ExerciseHistoryEntry = {
      date: row.workout_sessions.started_at,
      weightKg: Number(best.weight_kg ?? 0),
      reps: best.reps ?? 0,
      sets: working.length,
      tonnageKg: working.reduce((s, x) => s + (x.weight_kg ?? 0) * (x.reps ?? 0), 0),
    };
    const list = map.get(row.exercise_id) ?? [];
    list.push(entry);
    map.set(row.exercise_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return map;
}

export async function getExercises(): Promise<Exercise[]> {
  const [libRes, favRes, history] = await Promise.all([
    supabase
      .from("exercises")
      .select("*")
      .eq("is_active", true)
      .order("name")
      .returns<ExerciseRow[]>(),
    supabase.from("exercise_favorites").select("exercise_id"),
    loadExerciseHistory(),
  ]);
  const favorites = new Set((favRes.data ?? []).map((f) => f.exercise_id));
  return (libRes.data ?? []).map((row) =>
    buildExercise(row, favorites.has(row.id), history.get(row.id) ?? []),
  );
}

export async function getExercise(id: string): Promise<Exercise | null> {
  const [rowRes, favRes, history] = await Promise.all([
    supabase.from("exercises").select("*").eq("id", id).maybeSingle(),
    supabase.from("exercise_favorites").select("exercise_id").eq("exercise_id", id).maybeSingle(),
    loadExerciseHistory(),
  ]);
  if (rowRes.error) throw asIronDeskError(new Error(rowRes.error.message));
  if (!rowRes.data) return null;
  return buildExercise(rowRes.data as ExerciseRow, !!favRes.data, history.get(id) ?? []);
}

export async function toggleFavorite(exerciseId: string, favorite: boolean): Promise<void> {
  const userId = await requireUserId();
  if (favorite) {
    const { error } = await supabase
      .from("exercise_favorites")
      .upsert({ user_id: userId, exercise_id: exerciseId });
    if (error) throw asIronDeskError(new Error(error.message));
  } else {
    const { error } = await supabase
      .from("exercise_favorites")
      .delete()
      .eq("user_id", userId)
      .eq("exercise_id", exerciseId);
    if (error) throw asIronDeskError(new Error(error.message));
  }
}

export interface CustomExerciseInput {
  name: string;
  primaryMuscle: string;
  secondaryMuscles: string[];
  equipment: string;
  movementPattern: string;
  instructions?: string;
  cues?: string[];
}

export async function createCustomExercise(input: CustomExerciseInput): Promise<string> {
  const userId = await requireUserId();
  const res = await supabase
    .from("exercises")
    .insert({
      owner_id: userId,
      name: input.name.trim(),
      primary_muscle: input.primaryMuscle,
      secondary_muscles: input.secondaryMuscles,
      equipment: input.equipment,
      movement_pattern: input.movementPattern,
      instructions: input.instructions ?? null,
      cues: input.cues ?? [],
    })
    .select("id")
    .single();
  if (res.error) {
    if (res.error.message.includes("duplicate"))
      throw new IronDeskError("You already have a movement with that name.", "conflict");
    throw asIronDeskError(new Error(res.error.message));
  }
  return res.data.id;
}

export async function updateCustomExercise(id: string, input: CustomExerciseInput): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase
    .from("exercises")
    .update({
      name: input.name.trim(),
      primary_muscle: input.primaryMuscle,
      secondary_muscles: input.secondaryMuscles,
      equipment: input.equipment,
      movement_pattern: input.movementPattern,
      instructions: input.instructions ?? null,
      cues: input.cues ?? [],
    })
    .eq("id", id)
    .eq("owner_id", userId);
  if (error) throw asIronDeskError(new Error(error.message));
}

export async function deleteCustomExercise(id: string): Promise<void> {
  const userId = await requireUserId();
  const { error } = await supabase.from("exercises").delete().eq("id", id).eq("owner_id", userId);
  if (error) throw asIronDeskError(new Error(error.message));
}

// ------------------------------------------------------------ live workout
function mapActiveWorkout(row: FullSessionRow): ActiveWorkout {
  const exercises: WorkoutExercise[] = (row.session_exercises ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((se) => ({
      id: se.id,
      exerciseId: se.exercise_id,
      substitutedFrom: se.original_exercise_id,
      position: se.position,
      notes: se.notes,
      name: se.exercise_name,
      muscle: se.primary_muscle ?? "—",
      equipment: se.equipment ?? "—",
      targetSets: se.target_sets ?? 3,
      targetReps: se.target_reps ?? "8-10",
      targetRpe: se.target_rpe == null ? null : Number(se.target_rpe),
      restSeconds: se.rest_seconds,
      loadGuidance: se.load_guidance,
      sourceLoadUnit:
        se.source_load_unit === "lb" || se.source_load_unit === "kg" ? se.source_load_unit : null,
      isDropSet: se.is_drop_set,
      isHeavy: se.is_heavy,
      previous: "—",
      sets: (se.workout_sets ?? [])
        .slice()
        .sort((a, b) => a.set_number - b.set_number)
        .map<SetEntry>((s) => ({
          id: s.id,
          setNumber: s.set_number,
          weightKg: Number(s.weight_kg ?? 0),
          reps: s.reps ?? 0,
          rpe: Number(s.rpe ?? 0),
          done: s.completed,
          isWarmup: s.is_warmup,
          restSeconds: s.rest_seconds,
          notes: s.notes,
        })),
    }));

  return {
    id: row.id,
    status: (row.status as ActiveWorkout["status"]) ?? "active",
    persisted: true,
    title: row.title,
    focus: row.focus ?? "",
    startedAt: row.started_at,
    elapsedSec: Math.max(0, Math.round((Date.now() - new Date(row.started_at).getTime()) / 1000)),
    exercises,
    notes: row.notes ?? "",
  };
}

/** Returns the in-progress session, if any. */
export async function getActiveWorkout(): Promise<ActiveWorkout | null> {
  const res = await supabase
    .from("workout_sessions")
    .select(FULL_SESSION_SELECT)
    .in("status", ["active", "draft"])
    .order("started_at", { ascending: false })
    .limit(1)
    .returns<FullSessionRow[]>();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  const row = (res.data ?? [])[0];
  return row ? mapActiveWorkout(row) : null;
}

export async function getWorkout(id: string): Promise<ActiveWorkout | null> {
  const res = await supabase
    .from("workout_sessions")
    .select(FULL_SESSION_SELECT)
    .eq("id", id)
    .maybeSingle()
    .returns<FullSessionRow | null>();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  return res.data ? mapActiveWorkout(res.data) : null;
}

export async function startWorkout(input: {
  title?: string;
  focus?: string;
  kind?: "strength" | "cardio" | "conditioning" | "mobility";
  cloneFromSessionId?: string;
}): Promise<string> {
  const userId = await requireUserId();
  const res = await supabase
    .from("workout_sessions")
    .insert({
      user_id: userId,
      title: input.title?.trim() || "Training Session",
      focus: input.focus ?? null,
      kind: input.kind ?? "strength",
      status: "active",
    })
    .select("id")
    .single();
  const sessionId = unwrap(res).id;

  if (input.cloneFromSessionId) {
    const source = await supabase
      .from("workout_sessions")
      .select(FULL_SESSION_SELECT)
      .eq("id", input.cloneFromSessionId)
      .maybeSingle()
      .returns<FullSessionRow | null>();
    for (const se of source.data?.session_exercises ?? []) {
      await addSessionExercise(sessionId, {
        exerciseId: se.exercise_id,
        name: se.exercise_name,
        muscle: se.primary_muscle,
        equipment: se.equipment,
        targetSets: se.target_sets,
        targetReps: se.target_reps,
      });
    }
  }
  return sessionId;
}

export async function addSessionExercise(
  sessionId: string,
  input: {
    exerciseId?: string | null;
    name: string;
    muscle?: string | null;
    equipment?: string | null;
    targetSets?: number | null;
    targetReps?: string | null;
  },
): Promise<string> {
  const existing = await supabase
    .from("session_exercises")
    .select("position")
    .eq("session_id", sessionId);
  const nextPosition = (existing.data ?? []).reduce((max, r) => Math.max(max, r.position), -1) + 1;
  const res = await supabase
    .from("session_exercises")
    .insert({
      session_id: sessionId,
      exercise_id: input.exerciseId ?? null,
      exercise_name: input.name,
      primary_muscle: input.muscle ?? null,
      equipment: input.equipment ?? null,
      position: nextPosition,
      target_sets: input.targetSets ?? 3,
      target_reps: input.targetReps ?? "8-10",
    })
    .select("id")
    .single();
  return unwrap(res).id;
}

export async function removeSessionExercise(sessionExerciseId: string): Promise<void> {
  const { error } = await supabase.from("session_exercises").delete().eq("id", sessionExerciseId);
  if (error) throw asIronDeskError(new Error(error.message));
}

export async function reorderSessionExercises(orderedIds: string[]): Promise<void> {
  await Promise.all(
    orderedIds.map((id, index) =>
      supabase.from("session_exercises").update({ position: index }).eq("id", id),
    ),
  );
}

/** Substitution keeps the original exercise reference for later analysis. */
export async function substituteSessionExercise(
  sessionExerciseId: string,
  replacement: {
    exerciseId: string;
    name: string;
    muscle?: string | null;
    equipment?: string | null;
  },
): Promise<void> {
  const current = await supabase
    .from("session_exercises")
    .select("exercise_id, original_exercise_id")
    .eq("id", sessionExerciseId)
    .maybeSingle();
  const original = current.data?.original_exercise_id ?? current.data?.exercise_id ?? null;
  const { error } = await supabase
    .from("session_exercises")
    .update({
      exercise_id: replacement.exerciseId,
      original_exercise_id: original,
      exercise_name: replacement.name,
      primary_muscle: replacement.muscle ?? null,
      equipment: replacement.equipment ?? null,
    })
    .eq("id", sessionExerciseId);
  if (error) throw asIronDeskError(new Error(error.message));
}

export async function addSet(
  sessionExerciseId: string,
  input: { weightKg?: number; reps?: number; rpe?: number; isWarmup?: boolean },
): Promise<string> {
  const existing = await supabase
    .from("workout_sets")
    .select("set_number")
    .eq("session_exercise_id", sessionExerciseId);
  const nextNumber = (existing.data ?? []).reduce((max, r) => Math.max(max, r.set_number), 0) + 1;
  const res = await supabase
    .from("workout_sets")
    .insert({
      session_exercise_id: sessionExerciseId,
      set_number: nextNumber,
      weight_kg: input.weightKg ?? null,
      reps: input.reps ?? null,
      rpe: input.rpe ?? null,
      is_warmup: input.isWarmup ?? false,
    })
    .select("id")
    .single();
  if (res.error) {
    // Unique (session_exercise_id, set_number) guards against duplicate taps.
    if (res.error.message.includes("duplicate"))
      throw new IronDeskError("That set was already added.", "conflict");
    throw asIronDeskError(new Error(res.error.message));
  }
  return res.data.id;
}

export async function updateSet(
  setId: string,
  patch: {
    weightKg?: number | null;
    reps?: number | null;
    rpe?: number | null;
    completed?: boolean;
    isWarmup?: boolean;
    restSeconds?: number | null;
    notes?: string | null;
  },
): Promise<void> {
  const payload: Database["public"]["Tables"]["workout_sets"]["Update"] = {};
  if (patch.weightKg !== undefined) payload["weight_kg"] = patch.weightKg;
  if (patch.reps !== undefined) payload["reps"] = patch.reps;
  if (patch.rpe !== undefined) payload["rpe"] = patch.rpe;
  if (patch.isWarmup !== undefined) payload["is_warmup"] = patch.isWarmup;
  if (patch.restSeconds !== undefined) payload["rest_seconds"] = patch.restSeconds;
  if (patch.notes !== undefined) payload["notes"] = patch.notes;
  if (patch.completed !== undefined) {
    payload["completed"] = patch.completed;
    payload["completed_at"] = patch.completed ? new Date().toISOString() : null;
  }
  if (!Object.keys(payload).length) return;
  const { error } = await supabase.from("workout_sets").update(payload).eq("id", setId);
  if (error) throw asIronDeskError(new Error(error.message));
}

export async function deleteSet(setId: string): Promise<void> {
  const { error } = await supabase.from("workout_sets").delete().eq("id", setId);
  if (error) throw asIronDeskError(new Error(error.message));
}

export async function updateSessionMeta(
  sessionId: string,
  patch: {
    title?: string;
    focus?: string | null;
    notes?: string | null;
    perceivedEffort?: number | null;
  },
): Promise<void> {
  const payload: Database["public"]["Tables"]["workout_sessions"]["Update"] = {};
  if (patch.title !== undefined) payload["title"] = patch.title;
  if (patch.focus !== undefined) payload["focus"] = patch.focus;
  if (patch.notes !== undefined) payload["notes"] = patch.notes;
  if (patch.perceivedEffort !== undefined) payload["perceived_effort"] = patch.perceivedEffort;
  if (!Object.keys(payload).length) return;
  const { error } = await supabase.from("workout_sessions").update(payload).eq("id", sessionId);
  if (error) throw asIronDeskError(new Error(error.message));
}

export interface WorkoutSummary {
  sessionId: string;
  title: string;
  durationMin: number;
  sets: number;
  reps: number;
  tonnageKg: number;
  avgRpe: number;
}

export async function finishWorkout(sessionId: string): Promise<WorkoutSummary> {
  const { error } = await supabase
    .from("workout_sessions")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw asIronDeskError(new Error(error.message));

  const res = await supabase
    .from("workout_sessions")
    .select(FULL_SESSION_SELECT)
    .eq("id", sessionId)
    .single()
    .returns<FullSessionRow>();
  const row = unwrap(res);
  const totals = sessionTotals(row);
  return {
    sessionId,
    title: row.title,
    durationMin: totals.durationMin,
    sets: totals.sets,
    reps: totals.reps,
    tonnageKg: totals.tonnageKg,
    avgRpe: totals.avgRpe,
  };
}

export async function cancelWorkout(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from("workout_sessions")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw asIronDeskError(new Error(error.message));
}

// --------------------------------------------------------------------- coach
export async function getCoach(): Promise<CoachData> {
  const [account, sessions, recovery] = await Promise.all([
    getAccount(),
    fetchSessions({ statuses: ["completed"], limit: 60 }),
    getRecovery(),
  ]);
  return buildCoach({
    sessions,
    recovery,
    preferences: account.preferences,
    displayName: account.profile?.display_name ?? "Athlete",
  });
}

// --------------------------------------------------------------- sample data
export interface SampleDataSummary {
  workouts: number;
  cardio: number;
  bodyMetrics: number;
  nutritionDays: number;
  recoveryEntries: number;
  total: number;
}

export interface SampleDataRemovalResult extends SampleDataSummary {
  seedMeals: number;
  preservedNutritionDays: number;
  preservedRecoveryEntries: number;
}

export async function getSampleDataSummary(): Promise<SampleDataSummary> {
  const results = await Promise.all([
    supabase
      .from("workout_sessions")
      .select("id", { count: "exact", head: true })
      .eq("is_sample", true),
    supabase
      .from("cardio_sessions")
      .select("id", { count: "exact", head: true })
      .eq("is_sample", true),
    supabase
      .from("body_metrics")
      .select("id", { count: "exact", head: true })
      .eq("is_sample", true),
    supabase
      .from("nutrition_days")
      .select("id", { count: "exact", head: true })
      .eq("is_sample", true),
    supabase
      .from("recovery_entries")
      .select("id", { count: "exact", head: true })
      .eq("is_sample", true),
  ]);
  for (const result of results)
    if (result.error) throw asIronDeskError(new Error(result.error.message));
  const counts = results.map((result) => result.count ?? 0);
  const workouts = counts[0] ?? 0;
  const cardio = counts[1] ?? 0;
  const bodyMetrics = counts[2] ?? 0;
  const nutritionDays = counts[3] ?? 0;
  const recoveryEntries = counts[4] ?? 0;
  return {
    workouts,
    cardio,
    bodyMetrics,
    nutritionDays,
    recoveryEntries,
    total: workouts + cardio + bodyMetrics + nutritionDays + recoveryEntries,
  };
}

/**
 * Removes known sample data without cascading through meals or recovery values
 * that no longer match the seed. Operations are deliberately sequential so a
 * failed cleanup can be safely retried from the remaining `is_sample` rows.
 */
export async function removeSampleData(): Promise<SampleDataRemovalResult> {
  await requireUserId();

  const workoutResult = await supabase
    .from("workout_sessions")
    .delete()
    .eq("is_sample", true)
    .select("id");
  if (workoutResult.error) throw asIronDeskError(new Error(workoutResult.error.message));

  const cardioResult = await supabase
    .from("cardio_sessions")
    .delete()
    .eq("is_sample", true)
    .select("id");
  if (cardioResult.error) throw asIronDeskError(new Error(cardioResult.error.message));

  const bodyMetricResult = await supabase
    .from("body_metrics")
    .delete()
    .eq("is_sample", true)
    .select("id");
  if (bodyMetricResult.error) throw asIronDeskError(new Error(bodyMetricResult.error.message));

  let nutritionDays = 0;
  let seedMeals = 0;
  let preservedNutritionDays = 0;
  const nutritionResult = await supabase
    .from("nutrition_days")
    .select("*")
    .eq("is_sample", true)
    .order("day", { ascending: true })
    .returns<NutritionDayRow[]>();
  if (nutritionResult.error) throw asIronDeskError(new Error(nutritionResult.error.message));

  for (const nutritionDay of nutritionResult.data ?? []) {
    const mealsResult = await supabase
      .from("meals")
      .select("*")
      .eq("nutrition_day_id", nutritionDay.id)
      .order("created_at", { ascending: true })
      .returns<MealRow[]>();
    if (mealsResult.error) throw asIronDeskError(new Error(mealsResult.error.message));

    const { exactSeedMeals } = partitionSampleMeals(mealsResult.data ?? []);
    for (const meal of exactSeedMeals) {
      // Optimistic timestamp guard: an edit that lands after classification is
      // preserved instead of being mistaken for an untouched seed meal.
      const mealDeleteResult = await supabase
        .from("meals")
        .delete()
        .eq("id", meal.id)
        .eq("updated_at", meal.updated_at)
        .select("id");
      if (mealDeleteResult.error) throw asIronDeskError(new Error(mealDeleteResult.error.message));
      seedMeals += mealDeleteResult.data?.length ?? 0;
    }

    // Re-read after guarded deletes so edited rows and meals added during the
    // cleanup are included in the preserved day's derived totals.
    const remainingMealsResult = await supabase
      .from("meals")
      .select("*")
      .eq("nutrition_day_id", nutritionDay.id)
      .order("created_at", { ascending: true })
      .returns<MealRow[]>();
    if (remainingMealsResult.error)
      throw asIronDeskError(new Error(remainingMealsResult.error.message));
    const remainingMeals = remainingMealsResult.data ?? [];

    if (remainingMeals.length || !isExactSampleNutritionDay(nutritionDay)) {
      // Only derived macro totals are recalculated, and only when meals remain.
      // Targets, hydration and goal fields are intentionally absent from this
      // patch so any parent-only user edits survive cleanup.
      const nutritionPatch = remainingMeals.length
        ? { is_sample: false, ...sumNutritionMeals(remainingMeals) }
        : { is_sample: false };
      const preserveResult = await supabase
        .from("nutrition_days")
        .update(nutritionPatch)
        .eq("id", nutritionDay.id)
        .eq("is_sample", true)
        .select("id");
      if (preserveResult.error) throw asIronDeskError(new Error(preserveResult.error.message));
      preservedNutritionDays += preserveResult.data?.length ?? 0;
    } else {
      const deleteResult = await supabase
        .from("nutrition_days")
        .delete()
        .eq("id", nutritionDay.id)
        .eq("is_sample", true)
        .eq("updated_at", nutritionDay.updated_at)
        .select("id");
      if (deleteResult.error) throw asIronDeskError(new Error(deleteResult.error.message));
      if (deleteResult.data?.length) {
        nutritionDays += deleteResult.data.length;
      } else {
        // A parent edit that races the optimistic delete is real evidence.
        const preserveResult = await supabase
          .from("nutrition_days")
          .update({ is_sample: false })
          .eq("id", nutritionDay.id)
          .eq("is_sample", true)
          .select("id");
        if (preserveResult.error) throw asIronDeskError(new Error(preserveResult.error.message));
        preservedNutritionDays += preserveResult.data?.length ?? 0;
      }
    }
  }

  let recoveryEntries = 0;
  let preservedRecoveryEntries = 0;
  const recoveryResult = await supabase
    .from("recovery_entries")
    .select("*")
    .eq("is_sample", true)
    .order("day", { ascending: true })
    .returns<RecoveryRow[]>();
  if (recoveryResult.error) throw asIronDeskError(new Error(recoveryResult.error.message));

  for (const entry of recoveryResult.data ?? []) {
    if (isExactSampleRecovery(entry)) {
      const deleteResult = await supabase
        .from("recovery_entries")
        .delete()
        .eq("id", entry.id)
        .eq("is_sample", true)
        .eq("updated_at", entry.updated_at)
        .select("id");
      if (deleteResult.error) throw asIronDeskError(new Error(deleteResult.error.message));
      if (deleteResult.data?.length) {
        recoveryEntries += deleteResult.data.length;
        continue;
      }
    }

    // A non-match, including a row edited after the guarded delete was
    // classified, is real evidence. Preserve every field and clear only the
    // sample marker.
    const preserveResult = await supabase
      .from("recovery_entries")
      .update({ is_sample: false })
      .eq("id", entry.id)
      .eq("is_sample", true)
      .select("id");
    if (preserveResult.error) throw asIronDeskError(new Error(preserveResult.error.message));
    preservedRecoveryEntries += preserveResult.data?.length ?? 0;
  }

  const workouts = workoutResult.data?.length ?? 0;
  const cardio = cardioResult.data?.length ?? 0;
  const bodyMetrics = bodyMetricResult.data?.length ?? 0;
  return {
    workouts,
    cardio,
    bodyMetrics,
    nutritionDays,
    recoveryEntries,
    seedMeals,
    preservedNutritionDays,
    preservedRecoveryEntries,
    total: workouts + cardio + bodyMetrics + nutritionDays + recoveryEntries,
  };
}

/** Idempotent: does nothing if this account already holds any sample rows. */
export async function addSampleData(): Promise<{ created: boolean }> {
  const userId = await requireUserId();
  const existingSamples = await getSampleDataSummary();
  if (existingSamples.total) return { created: false };

  const account = await getAccount();
  const sampleDay = dayKeyForInstant(new Date(), account.profile?.timezone);
  // Read both unique day slots before creating any samples. Inserts below are
  // conditional and never upsert, so real nutrition/recovery cannot be
  // replaced even if seeding is reintroduced in the UI later.
  const existingNutrition = await supabase
    .from("nutrition_days")
    .select("id, is_sample")
    .eq("day", sampleDay)
    .maybeSingle();
  if (existingNutrition.error) throw asIronDeskError(new Error(existingNutrition.error.message));
  const existingRecovery = await supabase
    .from("recovery_entries")
    .select("id, is_sample")
    .eq("day", sampleDay)
    .maybeSingle();
  if (existingRecovery.error) throw asIronDeskError(new Error(existingRecovery.error.message));

  const library = await supabase
    .from("exercises")
    .select("id, name, primary_muscle, equipment")
    .is("owner_id", null)
    .in("name", [
      "Back Squat",
      "Barbell Bench Press",
      "Conventional Deadlift",
      "Pull-Up",
      "Overhead Press",
      "Barbell Row",
      "Romanian Deadlift",
      "Lateral Raise",
    ]);
  const byName = new Map((library.data ?? []).map((e) => [e.name, e]));

  const plans: {
    dayOffset: number;
    title: string;
    focus: string;
    movements: [string, number, number[]][];
  }[] = [
    {
      dayOffset: 6,
      title: "Lower — Squat Focus",
      focus: "Quads / Posterior",
      movements: [
        ["Back Squat", 100, [5, 5, 5]],
        ["Romanian Deadlift", 90, [8, 8]],
      ],
    },
    {
      dayOffset: 4,
      title: "Upper — Press Focus",
      focus: "Chest / Shoulders",
      movements: [
        ["Barbell Bench Press", 80, [5, 5, 5]],
        ["Overhead Press", 50, [8, 8]],
        ["Lateral Raise", 12, [15, 15]],
      ],
    },
    {
      dayOffset: 2,
      title: "Pull — Back Focus",
      focus: "Lats / Upper Back",
      movements: [
        ["Conventional Deadlift", 140, [3, 3, 3]],
        ["Barbell Row", 75, [8, 8]],
        ["Pull-Up", 0, [8, 7]],
      ],
    },
  ];

  for (const plan of plans) {
    const startedAt = new Date(Date.now() - plan.dayOffset * 86400000);
    startedAt.setHours(18, 0, 0, 0);
    const completedAt = new Date(startedAt.getTime() + 68 * 60000);
    const sessionRes = await supabase
      .from("workout_sessions")
      .insert({
        user_id: userId,
        title: plan.title,
        focus: plan.focus,
        kind: "strength",
        status: "completed",
        started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        perceived_effort: 8,
        calories: 520,
        avg_hr: 121,
        max_hr: 158,
        notes: "Sample session generated by IronDesk.",
        is_sample: true,
      })
      .select("id")
      .single();
    const sessionId = unwrap(sessionRes).id;

    let position = 0;
    for (const [name, weight, reps] of plan.movements) {
      const ref = byName.get(name);
      const seRes = await supabase
        .from("session_exercises")
        .insert({
          session_id: sessionId,
          exercise_id: ref?.id ?? null,
          exercise_name: name,
          primary_muscle: ref?.primary_muscle ?? null,
          equipment: ref?.equipment ?? null,
          position: position++,
          target_sets: reps.length,
          target_reps: `${reps[0]}`,
        })
        .select("id")
        .single();
      const seId = unwrap(seRes).id;
      await supabase.from("workout_sets").insert(
        reps.map((r, i) => ({
          session_exercise_id: seId,
          set_number: i + 1,
          weight_kg: weight,
          reps: r,
          rpe: 8,
          completed: true,
          completed_at: completedAt.toISOString(),
        })),
      );
    }
  }

  await supabase.from("cardio_sessions").insert({
    user_id: userId,
    name: "Zone 2 Treadmill",
    started_at: new Date(Date.now() - 86400000).toISOString(),
    duration_min: 32,
    distance_km: 5.4,
    calories: 340,
    avg_hr: 132,
    max_hr: 151,
    cardio_load: 46,
    active_zone_minutes: 24,
    zones: [
      { zone: "light", minutes: 8, percent: 25 },
      { zone: "moderate", minutes: 18, percent: 56 },
      { zone: "vigorous", minutes: 6, percent: 19 },
    ],
    is_sample: true,
  });

  const metrics = [12, 9, 6, 3, 0].map((offset, i) => ({
    user_id: userId,
    recorded_at: new Date(Date.now() - offset * 86400000).toISOString(),
    weight_kg: 84.5 - i * 0.3,
    is_sample: true,
  }));
  await supabase.from("body_metrics").insert(metrics);

  if (!existingNutrition.data) {
    const dayRes = await supabase
      .from("nutrition_days")
      .insert({
        user_id: userId,
        day: sampleDay,
        calorie_target: 2900,
        protein_target_g: 185,
        carb_target_g: 320,
        fat_target_g: 85,
        calories: 2410,
        protein_g: 162,
        carbs_g: 258,
        fat_g: 74,
        hydration_ml: 2200,
        weight_goal_direction: "cut",
        weight_goal_rate_kg_per_week: 0.3,
        is_sample: true,
      })
      .select("id")
      .single();
    if (dayRes.error) throw asIronDeskError(new Error(dayRes.error.message));
    await supabase.from("meals").insert([
      {
        nutrition_day_id: dayRes.data.id,
        name: "Breakfast",
        eaten_at_label: "07:10",
        calories: 620,
        protein_g: 46,
        carbs_g: 62,
        fat_g: 18,
        items: ["Skyr + berries", "Oats", "Whey"],
      },
      {
        nutrition_day_id: dayRes.data.id,
        name: "Lunch",
        eaten_at_label: "12:40",
        calories: 780,
        protein_g: 55,
        carbs_g: 88,
        fat_g: 22,
        items: ["Chicken, rice, greens"],
      },
      {
        nutrition_day_id: dayRes.data.id,
        name: "Post-Training",
        eaten_at_label: "19:15",
        calories: 1010,
        protein_g: 61,
        carbs_g: 108,
        fat_g: 34,
        items: ["Beef mince pasta", "Greek yoghurt"],
      },
    ]);
  }

  if (!existingRecovery.data) {
    const recoveryInsert = await supabase.from("recovery_entries").insert({
      user_id: userId,
      day: sampleDay,
      readiness: 72,
      sleep_hours: 7.4,
      sleep_efficiency_percent: 89,
      resting_hr: 52,
      fatigue: 4,
      stress: 3,
      soreness: [
        { area: "Quads", level: 3 },
        { area: "Lats", level: 2 },
      ],
      note: "Sample check-in.",
      source: "manual",
      is_sample: true,
    });
    if (recoveryInsert.error) throw asIronDeskError(new Error(recoveryInsert.error.message));
  }

  return { created: true };
}

// ---------------------------------------------------------------- templates
/**
 * Templates readable by the signed-in athlete: the shared read-only IronDesk
 * Originals (`is_system`, `user_id is null`) plus their own personal templates.
 * RLS enforces this; the ordering below just keeps Originals first.
 */
function releaseGateOf(value: string | null): ReleaseGate {
  return value === "coach_review" ||
    value === "blocked_pending_source_review" ||
    value === "blocked_by_pyramid_engine_and_source_review"
    ? value
    : "public";
}

function mapTemplate(row: TemplateRow): WorkoutTemplate {
  return {
    id: row.id,
    isSystem: row.is_system,
    sourceKey: row.source_key,
    sourceName: row.source_name,
    sourceVersion: row.source_version ?? 1,
    name: row.name,
    focus: row.focus,
    notes: row.notes,
    kind: "strength",
    environment: row.environment === "home" || row.environment === "gym" ? row.environment : null,
    workoutType:
      row.workout_type === "heavy" || row.workout_type === "pump" ? row.workout_type : null,
    category: row.category,
    level: row.level,
    estimatedMinutes: row.estimated_minutes,
    tags: row.tags ?? [],
    sortOrder: row.sort_order ?? 100,
    legacyDayId: row.legacy_day_id,
    releaseGate: releaseGateOf(row.release_gate),
    requiresAcknowledgment: row.requires_acknowledgment ?? false,
    libraryStartable: row.library_startable ?? true,
    warnings: toWarnings(row.warnings),
    exercises: (row.template_exercises ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map<TemplateExercise>((te) => ({
        id: te.id,
        position: te.position,
        name: te.exercise_name,
        exerciseId: te.exercise_id,
        canonicalName: null,
        targetSets: te.target_sets ?? 3,
        targetReps: te.target_reps ?? "8",
        targetRpe: te.target_rpe == null ? null : Number(te.target_rpe),
        restSeconds: te.rest_seconds,
        loadGuidance: te.load_guidance,
        sourceLoadUnit:
          te.source_load_unit === "lb" || te.source_load_unit === "kg" ? te.source_load_unit : null,
        isDropSet: te.is_drop_set,
        isHeavy: te.is_heavy,
        notes: te.notes,
      })),
  };
}

export async function getWorkoutTemplates(): Promise<WorkoutTemplate[]> {
  const res = await supabase
    .from("workout_templates")
    .select(FULL_TEMPLATE_SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true })
    .returns<TemplateRow[]>();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  return (res.data ?? []).map(mapTemplate);
}

export async function getWorkoutTemplate(id: string): Promise<WorkoutTemplate | null> {
  const res = await supabase
    .from("workout_templates")
    .select(FULL_TEMPLATE_SELECT)
    .eq("id", id)
    .maybeSingle()
    .returns<TemplateRow | null>();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  return res.data ? mapTemplate(res.data) : null;
}

/**
 * Starts an active session from a template.
 *
 * - the template must be readable by the caller (RLS + explicit re-read);
 * - session exercises are copied in template order with prescription context;
 * - planned sets are pre-created with blank (null) weights so the athlete logs
 *   real load, while integer rep/RPE targets are prefilled;
 * - an already-active session is reported as a conflict instead of silently
 *   creating a second one.
 */
export async function startWorkoutFromTemplate(templateId: string): Promise<string> {
  const userId = await requireUserId();

  const active = await getActiveWorkout();
  if (active) {
    throw new IronDeskError(
      "You already have a session in progress. Finish or cancel it first.",
      "conflict",
    );
  }

  const template = await getWorkoutTemplate(templateId);
  if (!template) throw new IronDeskError("That template is not available.", "not_found");
  // Assignment-only content (Legacy Beta) can never be launched as free training.
  // The database enforces this too; this keeps the client message useful.
  if (!isFreeStartable(template)) {
    throw new IronDeskError(
      "This workout is delivered through an assigned program. Enroll in its program to train it.",
      "validation",
    );
  }

  const created = await supabase
    .from("workout_sessions")
    .insert({
      user_id: userId,
      title: template.name,
      focus: template.focus,
      kind: "strength",
      status: "active",
      template_id: template.id,
    })
    .select("id")
    .single();
  const sessionId = unwrap(created).id;

  // Resolve muscle/equipment context from the canonical library where linked.
  const exerciseIds = template.exercises
    .map((e) => e.exerciseId)
    .filter((id): id is string => Boolean(id));
  const context = new Map<string, { primary_muscle: string; equipment: string }>();
  if (exerciseIds.length) {
    const lib = await supabase
      .from("exercises")
      .select("id, primary_muscle, equipment")
      .in("id", exerciseIds);
    for (const row of lib.data ?? []) context.set(row.id, row);
  }

  const rows = template.exercises.map((e) => {
    const ctx = e.exerciseId ? context.get(e.exerciseId) : undefined;
    return {
      session_id: sessionId,
      exercise_id: e.exerciseId,
      exercise_name: e.name,
      primary_muscle: ctx?.primary_muscle ?? null,
      equipment: ctx?.equipment ?? null,
      position: e.position,
      target_sets: e.targetSets,
      target_reps: e.targetReps,
      target_rpe: e.targetRpe,
      rest_seconds: e.restSeconds,
      notes: e.notes,
      load_guidance: e.loadGuidance,
      source_load_unit: e.sourceLoadUnit,
      is_drop_set: e.isDropSet,
      is_heavy: e.isHeavy,
    };
  });

  const inserted = await supabase.from("session_exercises").insert(rows).select("id, position");
  if (inserted.error) throw asIronDeskError(new Error(inserted.error.message));

  const byPosition = new Map((inserted.data ?? []).map((r) => [r.position, r.id]));
  const plannedSets = template.exercises.flatMap((e) => {
    const sessionExerciseId = byPosition.get(e.position);
    if (!sessionExerciseId) return [];
    const reps = parseInt(e.targetReps, 10);
    return Array.from({ length: Math.max(1, e.targetSets) }, (_, i) => ({
      session_exercise_id: sessionExerciseId,
      set_number: i + 1,
      weight_kg: null, // athlete logs real load; legacy guidance stays as text
      reps: Number.isFinite(reps) ? reps : null,
      rpe: e.targetRpe,
      is_warmup: false,
      rest_seconds: e.restSeconds,
    }));
  });

  if (plannedSets.length) {
    const setsRes = await supabase.from("workout_sets").insert(plannedSets);
    if (setsRes.error) throw asIronDeskError(new Error(setsRes.error.message));
  }

  return sessionId;
}

/* -------------------------------------------------------------------------- */
/* Progression context (working-weight suggestions)                           */
/* -------------------------------------------------------------------------- */

/**
 * Loads the signed-in athlete's completed working sets per movement, plus
 * today's readiness score, for the pure progression engine.
 *
 * Keyed by canonical exercise id AND normalized exercise name so sessions
 * logged against ad-hoc movements (no library link) still resolve.
 */
export async function getProgressionContext(): Promise<ProgressionContext> {
  const [setsRes, recoveryRes] = await Promise.all([
    supabase
      .from("session_exercises")
      .select(
        "exercise_id, exercise_name, workout_sets(weight_kg, reps, rpe, completed, is_warmup), workout_sessions!inner(started_at, status, is_sample)",
      )
      .returns<
        {
          exercise_id: string | null;
          exercise_name: string;
          workout_sets: {
            weight_kg: number | null;
            reps: number | null;
            rpe: number | null;
            completed: boolean;
            is_warmup: boolean;
          }[];
          workout_sessions: { started_at: string; status: string; is_sample: boolean };
        }[]
      >(),
    supabase
      .from("recovery_entries")
      .select("readiness, day")
      .eq("is_sample", false)
      .order("day", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (setsRes.error) throw asIronDeskError(new Error(setsRes.error.message));

  const performance: PerformanceMap = {};
  const push = (key: string, point: PerformancePoint) => {
    const list = performance[key] ?? [];
    list.push(point);
    performance[key] = list;
  };

  for (const row of setsRes.data ?? []) {
    if (row.workout_sessions?.status !== "completed" || row.workout_sessions.is_sample) continue;
    const working = (row.workout_sets ?? []).filter(
      (s) => s.completed && !s.is_warmup && (s.weight_kg ?? 0) > 0 && (s.reps ?? 0) > 0,
    );
    if (!working.length) continue;
    const top = working.reduce((a, b) => ((b.weight_kg ?? 0) > (a.weight_kg ?? 0) ? b : a));
    const point: PerformancePoint = {
      date: row.workout_sessions.started_at,
      weightKg: Number(top.weight_kg ?? 0),
      reps: top.reps ?? 0,
      rpe: top.rpe == null ? null : Number(top.rpe),
      sets: working.length,
    };
    if (row.exercise_id) push(row.exercise_id, point);
    if (row.exercise_name) push(performanceKey(row.exercise_name), point);
  }
  for (const list of Object.values(performance)) list.sort((a, b) => a.date.localeCompare(b.date));

  const readinessRow = recoveryRes.data as { readiness: number | null } | null;
  return { performance, readiness: readinessRow?.readiness ?? null };
}
