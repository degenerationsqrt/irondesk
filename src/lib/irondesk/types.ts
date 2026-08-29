/**
 * IronDesk domain types.
 * These describe the shape of everything the UI consumes. The mock service in
 * `data.ts` / `service.ts` implements the same contract a real Lovable Cloud
 * (Supabase) backend would, so swapping the source requires no UI rewrite.
 */

export type ZoneKey = "light" | "moderate" | "vigorous" | "peak";

export type Grade = "A+" | "A" | "A-" | "B+" | "B" | "B-" | "C+" | "C" | "D" | "F";

export interface ZoneSplit {
  zone: ZoneKey;
  minutes: number;
  percent: number;
}

export type ActivityKind = "cardio" | "strength" | "mobility" | "conditioning" | "other";

export interface ActivitySession {
  id: string;
  name: string;
  kind: ActivityKind;
  startedAt: string;
  durationMin: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  cardioLoad: number | null;
  activeZoneMinutes: number | null;
  zones: ZoneSplit[];
  /** Provenance for imported/device activity. Omitted for the bundled demo snapshot. */
  source?: string;
  sourceLabel?: string;
  notes?: string;
}

export interface HrSample {
  t: string;
  hr: number;
}

export interface StrengthMetrics {
  totalSets: number;
  totalReps: number;
  tonnageKg: number;
  /** Null until at least one completed weighted set can support the claim. */
  topLift: { exercise: string; weightKg: number; reps: number } | null;
  e1rmDeltaKg: number;
  prs: { exercise: string; detail: string }[];
}

export interface MacroTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export interface Meal {
  id: string;
  name: string;
  time: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  items: string[];
}

export interface NutritionDay {
  targets: MacroTotals;
  consumed: MacroTotals;
  meals: Meal[];
  hydrationMl: number;
  hydrationTargetMl: number;
  weightGoal: { direction: "cut" | "maintain" | "gain"; rateKgPerWeek: number };
}

export interface EnergyBalance {
  intake: number;
  /** Null until a defensible resting-energy estimate is available. */
  bmr: number | null;
  exerciseBurn: number;
  net: number | null;
  status: "deficit" | "maintenance" | "surplus" | "unavailable";
}

export interface GradeLine {
  label: string;
  grade: Grade;
  score: number;
  note: string;
  /** False means source evidence is absent, so the line renders N/A rather than F. */
  available?: boolean;
}

export interface Suggestion {
  id: string;
  title: string;
  detail: string;
  severity: "info" | "good" | "warn" | "risk";
}

export interface DashboardDay {
  date: string;
  timeZone?: string;
  statusLine: string;
  ironScore: number;
  grade: Grade;
  strain: { total: number; cardioPercent: number; muscularPercent: number; interpretation: string };
  sessions: ActivitySession[];
  hrSeries: HrSample[];
  avgHr: number | null;
  zoneTotals: ZoneSplit[];
  strength: StrengthMetrics;
  nutrition: NutritionDay;
  energy: EnergyBalance;
  grades: GradeLine[];
  suggestions: Suggestion[];
  keyTakeaway: string;
  weeklyLoad: { day: string; load: number }[];
  /** Honest reporting of how much real data backs this day (live mode). */
  dataQuality?: { level: "rich" | "partial" | "sparse"; notes: string[] };
  dataAvailability?: {
    /** A strength activity exists, even if its provider omitted set/load details. */
    strength: boolean;
    /** Completed IronDesk sets exist, so set/repetition output can be rendered. */
    strengthMetrics: boolean;
    cardio: boolean;
    nutrition: boolean;
    recovery: boolean;
    heartRateZones: boolean;
    /** At least one measured load component supports the strain score. */
    measuredStrain: boolean;
  };
  recentProgress: { label: string; value: string; delta: string; positive: boolean }[];
}

export interface SetEntry {
  id: string;
  weightKg: number;
  reps: number;
  rpe: number;
  done: boolean;
  setNumber?: number;
  isWarmup?: boolean;
  restSeconds?: number | null;
  notes?: string | null;
}

export interface WorkoutExercise {
  /** session_exercises.id in live mode. */
  id: string;
  exerciseId?: string | null;
  /** Set when the movement was substituted; keeps the original reference. */
  substitutedFrom?: string | null;
  position?: number;
  notes?: string | null;
  name: string;
  muscle: string;
  equipment: string;
  targetSets: number;
  targetReps: string;
  previous: string;
  sets: SetEntry[];
  /* Prescription carried over from the template, when the session came from one. */
  targetRpe?: number | null;
  restSeconds?: number | null;
  loadGuidance?: string | null;
  sourceLoadUnit?: "kg" | "lb" | null;
  isDropSet?: boolean;
  isHeavy?: boolean;
}

export interface ActiveWorkout {
  id: string;
  status?: "draft" | "active" | "completed" | "cancelled";
  /** True when the session is persisted in the database. */
  persisted?: boolean;
  /** Persisted session kind; optional only for the static demo fixture. */
  kind?: ActivityKind;
  title: string;
  focus: string;
  startedAt: string;
  elapsedSec: number;
  exercises: WorkoutExercise[];
  notes: string;
}

export interface HistorySession {
  id: string;
  date: string;
  title: string;
  kind: ActivityKind;
  bodyParts: string[];
  durationMin: number | null;
  tonnageKg: number;
  sets: number;
  reps: number;
  avgRpe: number;
  intensity: "light" | "moderate" | "hard" | "peak";
  intensityAvailable?: boolean;
  calories: number | null;
  prCount: number;
  blocks: {
    exercise: string;
    detail: string;
    weightKg?: number;
    sets?: number;
    reps?: number;
  }[];
  source?: string;
  sourceLabel?: string;
}

export interface Exercise {
  id: string;
  name: string;
  muscle: string;
  secondary: string[];
  equipment: string;
  pattern: string;
  favorite: boolean;
  lastPerformed?: string;
  best: { weightKg: number; reps: number };
  e1rmTrend: { date: string; e1rm: number }[];
  history: { date: string; detail: string; tonnageKg: number }[];
  cues: string[];
  /** True for user-created movements (editable); system rows are read-only. */
  isCustom?: boolean;
  instructions?: string;
}

export interface ProgressData {
  bodyweight: { date: string; kg: number }[];
  e1rm: { date: string; squat: number; bench: number; deadlift: number }[];
  volume: { week: string; tonnage: number }[];
  load: { week: string; acute: number; chronic: number }[];
  cardioFitness: { date: string; vo2: number }[];
  streak: { currentWeeks: number; bestWeeks: number; weeksTracked: number };
  prs: {
    date: string;
    exercise: string;
    detail: string;
    weightKg?: number;
    reps?: number;
    e1rmKg?: number;
  }[];
}

export interface RecoveryData {
  /** Null when no explicit readiness score was recorded. */
  readiness: number | null;
  status: string;
  recommendation: string;
  sleep: { hours: number | null; efficiencyPercent: number | null; note: string };
  restingHr: number | null;
  hrvMs: number | null;
  soreness: { area: string; level: number }[];
  fatigue: number | null;
  stress: number | null;
  trend: { date: string; readiness: number }[];
  placeholders: string[];
  day?: string;
  source?: string;
  sourceLabel?: string;
  dataOrigin?: "manual" | "wearable" | "sample" | "demo";
}

export interface CoachData {
  today: { headline: string; body: string; bullets: string[] };
  tomorrow: { headline: string; body: string; blocks: { name: string; detail: string }[] };
  observations: Suggestion[];
  riskNotes: Suggestion[];
  adjustments: Suggestion[];
  starterQuestions: string[];
}

/* -------------------------------------------------------------------------- */
/* Workout templates                                                          */
/* -------------------------------------------------------------------------- */

export type TemplateEnvironment = "home" | "gym";
export type TemplateWorkoutType = "heavy" | "pump";
/** Unit the legacy source expressed load guidance in. Numeric legacy loads are pounds. */
export type SourceLoadUnit = "kg" | "lb";

export interface TemplateExercise {
  /** `template_exercises.id` in live mode; a stable synthetic key in demo mode. */
  id: string;
  position: number;
  /** Exact prescribed name from the source program. Never rewritten. */
  name: string;
  /** Canonical library exercise, when one could be resolved. */
  exerciseId: string | null;
  canonicalName: string | null;
  targetSets: number;
  targetReps: string;
  targetRpe: number | null;
  restSeconds: number | null;
  /** Free-form load text, e.g. "315–345", "heavy", "bodyweight". */
  loadGuidance: string | null;
  sourceLoadUnit: SourceLoadUnit | null;
  isDropSet: boolean;
  isHeavy: boolean;
  notes: string | null;
}

export interface WorkoutTemplate {
  id: string;
  /** True for read-only IronDesk Originals; false for the athlete's own templates. */
  isSystem: boolean;
  sourceKey: string | null;
  sourceName: string | null;
  sourceVersion: number;
  name: string;
  focus: string | null;
  notes: string | null;
  kind: ActivityKind;
  environment: TemplateEnvironment | null;
  workoutType: TemplateWorkoutType | null;
  category: string | null;
  level: string | null;
  estimatedMinutes: number | null;
  tags: string[];
  sortOrder: number;
  legacyDayId: string | null;
  exercises: TemplateExercise[];
  /**
   * Delivery gate carried over from the normalized source. `public` templates
   * (the 12 IronDesk Originals) can be started freely; anything else is only
   * startable through an acknowledged program assignment.
   */
  releaseGate?: ReleaseGate;
  requiresAcknowledgment?: boolean;
  libraryStartable?: boolean;
  warnings?: SourceWarning[];
}

export interface PersonalTemplateDraftExercise {
  exerciseId: string;
  /** UI hint only; the repository re-reads and persists the canonical name. */
  name: string;
  targetSets: number;
  targetReps: string;
}

export interface PersonalTemplateDraft {
  name: string;
  focus?: string | null;
  exercises: PersonalTemplateDraftExercise[];
}

/* -------------------------------------------------------------------------- */
/* Programs (assigned delivery)                                               */
/* -------------------------------------------------------------------------- */

export type ReleaseGate =
  | "public"
  | "coach_review"
  | "blocked_pending_source_review"
  | "blocked_by_pyramid_engine_and_source_review";

export interface SourceWarning {
  code?: string;
  severity?: string;
  message: string;
  sourceText?: string;
  workoutId?: string;
}

export interface ProgramSlot {
  id: string;
  position: number;
  templateId: string;
  label: string | null;
  dayOfWeek: number | null;
  templateName: string;
  templateFocus: string | null;
  movementCount: number;
  estimatedMinutes: number | null;
}

export interface Program {
  id: string;
  sourceKey: string | null;
  name: string;
  description: string | null;
  isSystem: boolean;
  environment: string | null;
  level: string | null;
  daysPerWeek: number | null;
  scheduleMode: string;
  releaseGate: ReleaseGate;
  requiresAcknowledgment: boolean;
  tags: string[];
  sortOrder: number;
  warnings: SourceWarning[];
  slots: ProgramSlot[];
}

export type ScheduledStatus =
  "planned" | "in_progress" | "completed" | "skipped" | "expired" | "cancelled";

export interface ScheduledSlot {
  id: string;
  sequenceIndex: number;
  position: number;
  status: ScheduledStatus;
  scheduledFor: string | null;
  sessionId: string | null;
}

export interface ProgramEnrollment {
  id: string;
  status: "active" | "paused" | "completed" | "cancelled";
  startedOn: string;
  currentPosition: number;
  currentWeek: number;
  currentCycle: number;
  acknowledgedAt: string | null;
  acknowledgedGate: string | null;
  program: Program;
  schedule: ScheduledSlot[];
}
