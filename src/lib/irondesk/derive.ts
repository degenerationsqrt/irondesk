/**
 * Pure derivation layer: database rows -> IronDesk domain models.
 *
 * Every formula here is deterministic and documented. When a user has too few
 * rows for a metric we report it honestly through `dataQuality` / null returns
 * instead of inventing numbers.
 */
import type {
  ActivityKind,
  ActivitySession,
  CoachData,
  DashboardDay,
  Exercise,
  Grade,
  GradeLine,
  HistorySession,
  NutritionDay,
  ProgressData,
  RecoveryData,
  StrengthMetrics,
  Suggestion,
  ZoneKey,
  ZoneSplit,
} from "./types";
import { estimate1rm } from "./units";
import type {
  BodyMetricRow,
  CardioRow,
  ExerciseRow,
  FullSessionRow,
  MealRow,
  NutritionDayRow,
  PreferencesRow,
  RecoveryRow,
  SessionExerciseRow,
} from "./rows";
import type { ImportedDashboardActivity } from "./imported-data-adapter";
import { dayKeyForInstant, formatDayKey } from "./dates";

const ZONES: ZoneKey[] = ["light", "moderate", "vigorous", "peak"];

export function gradeFromScore(score: number): Grade {
  if (score >= 97) return "A+";
  if (score >= 92) return "A";
  if (score >= 88) return "A-";
  if (score >= 84) return "B+";
  if (score >= 79) return "B";
  if (score >= 74) return "B-";
  if (score >= 69) return "C+";
  if (score >= 60) return "C";
  if (score >= 50) return "D";
  return "F";
}

const clamp = (n: number, min = 0, max = 100) => Math.max(min, Math.min(max, n));
const round = (n: number, d = 0) => {
  const f = 10 ** d;
  return Math.round(n * f) / f;
};

export interface SessionTotals {
  sets: number;
  reps: number;
  tonnageKg: number;
  avgRpe: number;
  durationMin: number;
  topSet: { exercise: string; weightKg: number; reps: number } | null;
  bestE1rm: number;
  bodyParts: string[];
}

/** Aggregates completed working sets of one session. */
export function sessionTotals(row: FullSessionRow): SessionTotals {
  let sets = 0;
  let reps = 0;
  let tonnage = 0;
  let rpeSum = 0;
  let rpeCount = 0;
  let topSet: SessionTotals["topSet"] = null;
  let bestE1rm = 0;
  const parts = new Set<string>();

  for (const se of row.session_exercises ?? []) {
    if (se.primary_muscle) parts.add(se.primary_muscle);
    for (const s of se.workout_sets ?? []) {
      if (!s.completed || s.is_warmup) continue;
      sets += 1;
      reps += s.reps ?? 0;
      tonnage += (s.weight_kg ?? 0) * (s.reps ?? 0);
      if (s.rpe != null) {
        rpeSum += Number(s.rpe);
        rpeCount += 1;
      }
      const e1rm = estimate1rm(Number(s.weight_kg ?? 0), s.reps ?? 0);
      if (e1rm > bestE1rm) {
        bestE1rm = e1rm;
        topSet = {
          exercise: se.exercise_name,
          weightKg: Number(s.weight_kg ?? 0),
          reps: s.reps ?? 0,
        };
      }
    }
  }

  const end = row.completed_at ? new Date(row.completed_at).getTime() : Date.now();
  const durationMin = Math.max(0, Math.round((end - new Date(row.started_at).getTime()) / 60000));

  return {
    sets,
    reps,
    tonnageKg: round(tonnage),
    avgRpe: rpeCount ? round(rpeSum / rpeCount, 1) : 0,
    durationMin,
    topSet,
    bestE1rm,
    bodyParts: [...parts],
  };
}

function intensityFrom(avgRpe: number): HistorySession["intensity"] {
  if (avgRpe >= 9) return "peak";
  if (avgRpe >= 8) return "hard";
  if (avgRpe >= 6.5) return "moderate";
  return "light";
}

export function toHistorySession(row: FullSessionRow): HistorySession {
  const t = sessionTotals(row);
  return {
    id: row.id,
    date: row.started_at,
    title: row.title,
    kind: (row.kind as ActivityKind) ?? "strength",
    bodyParts: t.bodyParts,
    durationMin: t.durationMin,
    tonnageKg: t.tonnageKg,
    sets: t.sets,
    reps: t.reps,
    avgRpe: t.avgRpe,
    intensity: intensityFrom(t.avgRpe),
    intensityAvailable: t.avgRpe > 0,
    calories: row.calories,
    prCount: 0,
    source: "irondesk",
    sourceLabel: "IronDesk",
    blocks: (row.session_exercises ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((se) => ({
        exercise: se.exercise_name,
        ...describeBlock(se),
      })),
  };
}

function importedKind(kind: ImportedDashboardActivity["kind"]): ActivityKind {
  return kind === "unknown" ? "other" : kind;
}

export function importedSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    health_connect: "Health Connect",
    garmin_file: "Garmin import",
    fit_file: "FIT import",
    tcx_file: "TCX import",
    gpx_file: "GPX import",
    csv_file: "CSV import",
    json_file: "JSON import",
  };
  return (
    labels[source] ?? source.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function toImportedHistorySession(activity: ImportedDashboardActivity): HistorySession {
  return {
    id: activity.id,
    date: activity.startedAt,
    title: activity.name ?? activity.activityType.replaceAll("_", " "),
    kind: importedKind(activity.kind),
    bodyParts: [],
    durationMin: activity.durationMinutes == null ? null : Math.round(activity.durationMinutes),
    tonnageKg: 0,
    sets: 0,
    reps: 0,
    avgRpe: 0,
    intensity: "light",
    intensityAvailable: false,
    calories: activity.calories,
    prCount: 0,
    blocks: [],
    source: activity.sourceType,
    sourceLabel: importedSourceLabel(activity.sourceType),
  };
}

/** True only when a native session contains actual training evidence. */
export function hasNativeTrainingEvidence(row: FullSessionRow): boolean {
  const totals = sessionTotals(row);
  return (
    totals.sets > 0 ||
    (row.cardio_load ?? 0) > 0 ||
    (row.active_zone_minutes ?? 0) > 0 ||
    (row.avg_hr ?? 0) > 0
  );
}

export function toCardioHistorySession(row: CardioRow): HistorySession {
  return {
    id: row.id,
    date: row.started_at,
    title: row.name,
    kind: "cardio",
    bodyParts: [],
    durationMin: row.duration_min,
    tonnageKg: 0,
    sets: 0,
    reps: 0,
    avgRpe: 0,
    intensity: "light",
    intensityAvailable: false,
    calories: row.calories,
    prCount: 0,
    blocks: [],
    source: "irondesk",
    sourceLabel: "IronDesk",
  };
}

function describeBlock(se: SessionExerciseRow): Omit<HistorySession["blocks"][number], "exercise"> {
  const working = (se.workout_sets ?? []).filter((s) => !s.is_warmup && s.completed);
  if (!working.length) return { detail: "No completed sets" };
  const best = working.reduce((a, b) => ((b.weight_kg ?? 0) > (a.weight_kg ?? 0) ? b : a));
  const weightKg = round(Number(best.weight_kg ?? 0), 1);
  const reps = best.reps ?? 0;
  return {
    detail: `${working.length} × ${reps} @ ${weightKg} kg`,
    weightKg,
    sets: working.length,
    reps,
  };
}

export function zonesFromJson(value: unknown): ZoneSplit[] {
  if (!Array.isArray(value)) return [];
  const rows = value.filter(
    (z): z is { zone: ZoneKey; minutes: number; percent?: number } =>
      !!z && typeof z === "object" && ZONES.includes((z as { zone: ZoneKey }).zone),
  );
  const total = rows.reduce((sum, z) => sum + (z.minutes ?? 0), 0) || 1;
  return rows.map((z) => ({
    zone: z.zone,
    minutes: z.minutes ?? 0,
    percent: z.percent ?? Math.round(((z.minutes ?? 0) / total) * 100),
  }));
}

function cardioToActivity(row: CardioRow): ActivitySession {
  return {
    id: row.id,
    name: row.name,
    kind: "cardio",
    startedAt: row.started_at,
    durationMin: row.duration_min,
    calories: row.calories,
    avgHr: row.avg_hr,
    maxHr: row.max_hr,
    cardioLoad: row.cardio_load,
    activeZoneMinutes: row.active_zone_minutes,
    zones: zonesFromJson(row.zones),
    source: "irondesk",
    sourceLabel: "IronDesk",
    ...(row.notes ? { notes: row.notes } : {}),
  };
}

function strengthToActivity(row: FullSessionRow): ActivitySession {
  const t = sessionTotals(row);
  return {
    id: row.id,
    name: row.title,
    kind: (row.kind as ActivityKind) ?? "strength",
    startedAt: row.started_at,
    durationMin: t.durationMin,
    calories: row.calories,
    avgHr: row.avg_hr,
    maxHr: row.max_hr,
    cardioLoad: row.cardio_load,
    activeZoneMinutes: row.active_zone_minutes,
    zones: [],
    source: "irondesk",
    sourceLabel: "IronDesk",
  };
}

function importedToActivity(activity: ImportedDashboardActivity): ActivitySession {
  return {
    id: activity.id,
    name: activity.name ?? activity.activityType.replaceAll("_", " "),
    kind: importedKind(activity.kind),
    startedAt: activity.startedAt,
    durationMin: activity.durationMinutes == null ? null : Math.round(activity.durationMinutes),
    calories: activity.calories,
    avgHr: activity.avgHr,
    maxHr: activity.maxHr,
    cardioLoad: null,
    activeZoneMinutes: null,
    zones: [],
    source: activity.sourceType,
    sourceLabel: importedSourceLabel(activity.sourceType),
    ...(activity.notes ? { notes: activity.notes } : {}),
  };
}

export function strengthMetrics(sessions: FullSessionRow[]): StrengthMetrics {
  let sets = 0;
  let reps = 0;
  let tonnage = 0;
  let top: StrengthMetrics["topLift"] = null;
  let bestE1rm = 0;

  for (const s of sessions) {
    const t = sessionTotals(s);
    sets += t.sets;
    reps += t.reps;
    tonnage += t.tonnageKg;
    if (t.bestE1rm > bestE1rm && t.topSet) {
      bestE1rm = t.bestE1rm;
      top = t.topSet;
    }
  }

  return {
    totalSets: sets,
    totalReps: reps,
    tonnageKg: round(tonnage),
    topLift: top,
    e1rmDeltaKg: 0,
    prs: [],
  };
}

export interface DashboardInput {
  todaySessions: FullSessionRow[];
  weekSessions: FullSessionRow[];
  todayCardio: CardioRow[];
  weekCardio: CardioRow[];
  todayImported: ImportedDashboardActivity[];
  weekImported: ImportedDashboardActivity[];
  nutrition: NutritionDay | null;
  recovery: RecoveryData | null;
  preferences: PreferencesRow | null;
  displayName: string;
  dayKey: string;
  timeZone: string;
}

/**
 * IronScore (0-100) = strength load + cardio load + consistency + recovery.
 *   strength  : tonnage/1000 * 9, capped at 40
 *   cardio    : cardio_load / 8, capped at 30
 *   consistency: sessions this week / weekly target * 15
 *   recovery  : readiness/100 * 15 (neutral 10 when unknown)
 * Missing inputs simply contribute 0 and are reported in `dataQuality`.
 */
export function buildDashboard(input: DashboardInput): DashboardDay {
  const {
    todaySessions,
    weekSessions,
    todayCardio,
    weekCardio,
    todayImported,
    weekImported,
    nutrition,
    recovery,
    preferences,
  } = input;
  const totals = strengthMetrics(todaySessions);
  const cardioLoad =
    todayCardio.reduce((s, c) => s + (c.cardio_load ?? 0), 0) +
    todaySessions.reduce((s, c) => s + (c.cardio_load ?? 0), 0);
  const azm =
    todayCardio.reduce((s, c) => s + (c.active_zone_minutes ?? 0), 0) +
    todaySessions.reduce((s, c) => s + (c.active_zone_minutes ?? 0), 0);

  const target = preferences?.training_days_per_week ?? 4;
  const countableImported = weekImported.filter(
    (activity) =>
      activity.kind === "strength" ||
      activity.kind === "cardio" ||
      activity.kind === "conditioning",
  );
  const trainingDays = new Set([
    ...weekSessions
      .filter(hasNativeTrainingEvidence)
      .map((session) => dayKeyForInstant(session.started_at, input.timeZone)),
    ...weekCardio
      .filter(
        (session) =>
          session.duration_min > 0 ||
          (session.cardio_load ?? 0) > 0 ||
          (session.active_zone_minutes ?? 0) > 0 ||
          (session.avg_hr ?? 0) > 0,
      )
      .map((session) => dayKeyForInstant(session.started_at, input.timeZone)),
    ...countableImported.map((activity) => activity.localDay),
  ]);
  const weekCount = trainingDays.size;
  const strengthPart = clamp((totals.tonnageKg / 1000) * 9, 0, 40);
  const cardioPart = clamp(cardioLoad / 8, 0, 30);
  const consistencyPart = clamp((weekCount / Math.max(1, target)) * 15, 0, 15);
  const recoveryPart =
    recovery?.readiness != null ? clamp((recovery.readiness / 100) * 15, 0, 15) : 0;
  const ironScore = Math.round(strengthPart + cardioPart + consistencyPart + recoveryPart);

  const totalStrain = Math.round(((strengthPart + cardioPart) / 70) * 21);
  const strainSum = strengthPart + cardioPart || 1;
  const cardioPercent = Math.round((cardioPart / strainSum) * 100);
  const hasStrengthMetrics = totals.totalSets > 0;
  const hasMeasuredStrain = totalStrain > 0;

  const zoneTotals = mergeZones(todayCardio.map((c) => zonesFromJson(c.zones)));
  const avgHrValues = [
    ...todayCardio.map((c) => c.avg_hr),
    ...todaySessions.map((s) => s.avg_hr),
    ...todayImported.map((activity) => activity.avgHr),
  ].filter((v): v is number => v != null && v > 0);
  const avgHr = avgHrValues.length
    ? Math.round(avgHrValues.reduce((a, b) => a + b, 0) / avgHrValues.length)
    : null;

  const dataNotes: string[] = [];
  if (!todaySessions.length && !todayCardio.length && !todayImported.length)
    dataNotes.push("No training logged today.");
  if (!zoneTotals.length)
    dataNotes.push("Heart-rate zones need a wearable or a logged cardio session.");
  if (!nutrition) dataNotes.push("No nutrition logged today.");
  if (!recovery) dataNotes.push("No recovery check-in today.");

  const grades = buildGrades({
    cardioLoad,
    tonnage: totals.tonnageKg,
    nutrition,
    recovery,
    weekCount,
    target,
    hasCardioEvidence:
      todayCardio.length > 0 ||
      todayImported.some(
        (activity) => activity.kind === "cardio" || activity.kind === "conditioning",
      ),
    hasStrengthEvidence:
      todaySessions.length > 0 || todayImported.some((activity) => activity.kind === "strength"),
  });
  const sessions: ActivitySession[] = [
    ...todaySessions.map(strengthToActivity),
    ...todayCardio.map(cardioToActivity),
    ...todayImported.map(importedToActivity),
  ].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  const energyIntake = nutrition?.consumed.calories ?? 0;
  const exerciseBurn = sessions.reduce((sum, activity) => sum + (activity.calories ?? 0), 0);
  const bmr = null;
  const net = null;

  return {
    date: formatDayKey(input.dayKey),
    timeZone: input.timeZone,
    statusLine: statusLine(ironScore, dataNotes.length),
    ironScore,
    grade: gradeFromScore(ironScore),
    strain: {
      total: totalStrain,
      cardioPercent: strainSum > 1 ? cardioPercent : 0,
      muscularPercent: strainSum > 1 ? 100 - cardioPercent : 0,
      interpretation: strainInterpretation(totalStrain, cardioPercent),
    },
    sessions,
    hrSeries: [],
    avgHr,
    zoneTotals,
    strength: totals,
    nutrition: nutrition ?? {
      targets: {
        calories: preferences?.calorie_target ?? 0,
        proteinG: preferences?.protein_target_g ?? 0,
        carbsG: 0,
        fatG: 0,
      },
      consumed: { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      meals: [],
      hydrationMl: 0,
      hydrationTargetMl: 3000,
      weightGoal: { direction: "maintain", rateKgPerWeek: 0 },
    },
    energy: {
      intake: energyIntake,
      bmr,
      exerciseBurn,
      net,
      status: "unavailable",
    },
    grades,
    suggestions: buildSuggestions({
      dataNotes,
      totals,
      cardioLoad,
      weekCount,
      target,
      recovery,
      hasCardioEvidence:
        todayCardio.length > 0 ||
        todayImported.some(
          (activity) => activity.kind === "cardio" || activity.kind === "conditioning",
        ),
      hasStrengthEvidence:
        todaySessions.some(hasNativeTrainingEvidence) ||
        todayImported.some((activity) => activity.kind === "strength"),
    }),
    keyTakeaway: keyTakeaway({ ironScore, dataNotes, weekCount, target }),
    weeklyLoad: weeklyLoad(weekSessions),
    recentProgress: [
      {
        label: "Training days (7d)",
        value: `${weekCount}`,
        delta: `target ${target}`,
        positive: weekCount >= target,
      },
      {
        label: "Working sets today",
        value: hasStrengthMetrics ? `${totals.totalSets}` : "—",
        delta: hasStrengthMetrics ? `${totals.totalReps} reps` : "set data unavailable",
        positive: hasStrengthMetrics,
      },
      {
        label: "Active zone min",
        value: `${azm}`,
        delta: azm > 0 ? "logged" : "none yet",
        positive: azm > 0,
      },
    ],
    dataQuality: {
      level: dataNotes.length === 0 ? "rich" : dataNotes.length < 3 ? "partial" : "sparse",
      notes: dataNotes,
    },
    dataAvailability: {
      strength:
        todaySessions.length > 0 || todayImported.some((activity) => activity.kind === "strength"),
      strengthMetrics: hasStrengthMetrics,
      cardio:
        todayCardio.length > 0 ||
        todayImported.some(
          (activity) => activity.kind === "cardio" || activity.kind === "conditioning",
        ),
      nutrition: Boolean(nutrition),
      recovery: Boolean(recovery),
      heartRateZones: zoneTotals.length > 0,
      measuredStrain: hasMeasuredStrain,
    },
  };
}

function statusLine(score: number, gaps: number): string {
  if (gaps >= 3) return "Not enough data logged today";
  if (score >= 75) return "On target";
  if (score >= 50) return "Building — keep the volume honest";
  return "Under-loaded for your goal";
}

function strainInterpretation(total: number, cardioPercent: number): string {
  if (total === 0) return "No measured training strain yet.";
  if (total <= 6) return "Light measured load. Useful for recovery or a low-dose training day.";
  if (total <= 14)
    return cardioPercent > 55
      ? "Productive measured load, cardio-dominant."
      : "Productive measured load, muscular-dominant.";
  if (total <= 18) return "High measured load. Check recovery before repeating it tomorrow.";
  return "Very high measured load. Prioritize recovery before another hard session.";
}

function mergeZones(lists: ZoneSplit[][]): ZoneSplit[] {
  const minutes = new Map<ZoneKey, number>();
  for (const list of lists)
    for (const z of list) minutes.set(z.zone, (minutes.get(z.zone) ?? 0) + z.minutes);
  const total = [...minutes.values()].reduce((a, b) => a + b, 0);
  if (!total) return [];
  return ZONES.filter((z) => minutes.has(z)).map((zone) => ({
    zone,
    minutes: minutes.get(zone) ?? 0,
    percent: Math.round(((minutes.get(zone) ?? 0) / total) * 100),
  }));
}

function buildGrades(args: {
  cardioLoad: number;
  tonnage: number;
  nutrition: NutritionDay | null;
  recovery: RecoveryData | null;
  weekCount: number;
  target: number;
  hasCardioEvidence: boolean;
  hasStrengthEvidence: boolean;
}): GradeLine[] {
  const cardioScore = clamp((args.cardioLoad / 120) * 100);
  const strengthScore = clamp((args.tonnage / 8000) * 100);
  const hasNutritionTarget = (args.nutrition?.targets.calories ?? 0) > 0;
  const nutritionScore =
    hasNutritionTarget && args.nutrition
      ? clamp(
          100 -
            (Math.abs(
              (args.nutrition.consumed.calories || 0) - (args.nutrition.targets.calories || 1),
            ) /
              Math.max(1, args.nutrition.targets.calories || 1)) *
              100,
        )
      : 0;
  const recoveryScore = args.recovery?.readiness ?? 0;
  const consistencyScore = clamp((args.weekCount / Math.max(1, args.target)) * 100);
  const lines: GradeLine[] = [
    {
      label: "Cardio",
      score: Math.round(cardioScore),
      note: args.cardioLoad
        ? `${args.cardioLoad} measured cardio load`
        : args.hasCardioEvidence
          ? "Activity logged; load unavailable"
          : "Not logged",
      available: args.cardioLoad > 0,
    },
    {
      label: "Strength",
      score: Math.round(strengthScore),
      note: args.tonnage
        ? `${Math.round(args.tonnage)} kg tonnage`
        : args.hasStrengthEvidence
          ? "Strength activity logged; sets unavailable"
          : "Not logged",
      available: args.tonnage > 0,
    },
    {
      label: "Nutrition",
      score: Math.round(nutritionScore),
      note: !args.nutrition
        ? "Not logged"
        : hasNutritionTarget
          ? "Vs. calorie target"
          : "Calorie target not set",
      available: hasNutritionTarget,
    },
    {
      label: "Recovery",
      score: Math.round(recoveryScore),
      note: args.recovery?.readiness != null ? "From recorded readiness" : "Readiness not recorded",
      available: args.recovery?.readiness != null,
    },
    {
      label: "Consistency",
      score: Math.round(consistencyScore),
      note: `${args.weekCount}/${args.target} training days (7d)`,
      available: true,
    },
  ].map((l) => ({ ...l, grade: gradeFromScore(l.score) }));
  return lines;
}

function buildSuggestions(args: {
  dataNotes: string[];
  totals: StrengthMetrics;
  cardioLoad: number;
  weekCount: number;
  target: number;
  recovery: RecoveryData | null;
  hasCardioEvidence: boolean;
  hasStrengthEvidence: boolean;
}): Suggestion[] {
  const out: Suggestion[] = [];
  if (args.weekCount < args.target)
    out.push({
      id: "consistency",
      title: `Log ${args.target - args.weekCount} more training day${args.target - args.weekCount > 1 ? "s" : ""} in this 7-day window`,
      detail:
        "Distinct training days drive the consistency score; multiple sessions on one day count once.",
      severity: "warn",
    });
  if (!args.hasStrengthEvidence)
    out.push({
      id: "strength",
      title: "Get a lifting session on the board",
      detail: "Start a workout and log at least 12 working sets to register a strength stimulus.",
      severity: "info",
    });
  if (!args.hasCardioEvidence)
    out.push({
      id: "cardio",
      title: "Add 25-35 min of zone 2",
      detail: "Low-intensity aerobic work raises work capacity without adding recovery cost.",
      severity: "info",
    });
  if (args.recovery?.readiness != null && args.recovery.readiness < 55)
    out.push({
      id: "recovery",
      title: "Readiness is low — cut volume 20%",
      detail: "Keep intensity, drop total sets. Protect the next 48 hours.",
      severity: "risk",
    });
  for (const note of args.dataNotes.slice(0, 2))
    out.push({
      id: `gap-${note.slice(0, 8)}`,
      title: "Close a data gap",
      detail: note,
      severity: "info",
    });
  return out.slice(0, 5);
}

function keyTakeaway(args: {
  ironScore: number;
  dataNotes: string[];
  weekCount: number;
  target: number;
}): string {
  if (args.dataNotes.length >= 3)
    return "Not enough logged data to grade today. Log a session, a meal, or a recovery check-in and IronScore becomes meaningful.";
  if (args.weekCount >= args.target)
    return `Weekly target met with an IronScore of ${args.ironScore}. Hold this dose and let intensity creep up next block.`;
  return `IronScore ${args.ironScore}. The limiter right now is frequency, not effort — protect your training slots.`;
}

function weeklyLoad(sessions: FullSessionRow[]): { day: string; load: number }[] {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const buckets = new Map<string, number>(labels.map((l) => [l, 0]));
  for (const s of sessions) {
    const d = new Date(s.started_at);
    const label = labels[(d.getDay() + 6) % 7]!;
    const t = sessionTotals(s);
    buckets.set(
      label,
      (buckets.get(label) ?? 0) + Math.round(t.tonnageKg / 100) + (s.cardio_load ?? 0),
    );
  }
  return labels.map((day) => ({ day, load: buckets.get(day) ?? 0 }));
}

// ------------------------------------------------------------------ nutrition
export function buildNutrition(
  day: NutritionDayRow | null,
  meals: MealRow[],
  preferences: PreferencesRow | null,
): NutritionDay | null {
  if (!day) return null;
  return {
    targets: {
      calories: day.calorie_target ?? preferences?.calorie_target ?? 0,
      proteinG: day.protein_target_g ?? preferences?.protein_target_g ?? 0,
      carbsG: day.carb_target_g ?? 0,
      fatG: day.fat_target_g ?? 0,
    },
    consumed: {
      calories: day.calories,
      proteinG: day.protein_g,
      carbsG: day.carbs_g,
      fatG: day.fat_g,
    },
    meals: meals.map((m) => ({
      id: m.id,
      name: m.name,
      time: m.eaten_at_label ?? "",
      calories: m.calories,
      proteinG: m.protein_g,
      carbsG: m.carbs_g,
      fatG: m.fat_g,
      items: Array.isArray(m.items) ? (m.items as string[]) : [],
    })),
    hydrationMl: day.hydration_ml,
    hydrationTargetMl: day.hydration_target_ml,
    weightGoal: {
      direction: day.weight_goal_direction as "cut" | "maintain" | "gain",
      rateKgPerWeek: Number(day.weight_goal_rate_kg_per_week),
    },
  };
}

// ------------------------------------------------------------------- recovery
export function buildRecovery(row: RecoveryRow | null, trend: RecoveryRow[]): RecoveryData | null {
  if (!row) return null;
  const readiness = row.readiness;
  const placeholders: string[] = [];
  const wearableSource =
    row.source === "wearable" ||
    row.source === "health_connect" ||
    row.source === "android_companion";
  if (readiness == null)
    placeholders.push("No readiness score was recorded, so training guidance is unavailable.");
  if (row.sleep_hours == null)
    placeholders.push("Sleep duration was not available in this recovery record.");
  if (row.hrv_ms == null) placeholders.push("HRV was not available in this recovery record.");
  if (!wearableSource && (row.sleep_hours != null || row.resting_hr != null))
    placeholders.push("Sleep and resting HR are self-reported for this entry.");
  const sourceLabel = row.is_sample
    ? "Demo sample"
    : row.source === "health_connect" || row.source === "android_companion"
      ? "Health Connect"
      : row.source === "wearable"
        ? "Connected wearable"
        : "Manual check-in";
  return {
    readiness,
    status:
      readiness == null
        ? "Readiness unavailable"
        : readiness >= 75
          ? "Primed"
          : readiness >= 55
            ? "Moderate"
            : "Compromised",
    recommendation:
      readiness == null
        ? "No training recommendation is generated without a recorded readiness score. Review the available recovery inputs and choose your session load manually."
        : readiness >= 75
          ? "Green light. Push the top set and keep accessory volume as planned."
          : readiness >= 55
            ? "Train as planned but cap the top set at RPE 8 and trim the last accessory."
            : "Deload today: 60% of planned volume, no sets above RPE 7.",
    sleep: {
      hours: row.sleep_hours == null ? null : Number(row.sleep_hours),
      efficiencyPercent: row.sleep_efficiency_percent,
      note:
        row.sleep_hours == null
          ? "Not logged"
          : Number(row.sleep_hours) >= 7.5
            ? "Adequate duration"
            : "Below your target duration",
    },
    restingHr: row.resting_hr,
    hrvMs: row.hrv_ms,
    soreness: Array.isArray(row.soreness)
      ? (row.soreness as { area: string; level: number }[])
      : [],
    fatigue: row.fatigue,
    stress: row.stress,
    trend: trend
      .slice()
      .reverse()
      .filter((r) => r.readiness != null)
      .map((r) => ({ date: r.day, readiness: r.readiness! })),
    placeholders,
    day: row.day,
    source: row.source,
    sourceLabel,
    dataOrigin: row.is_sample ? "sample" : wearableSource ? "wearable" : "manual",
  };
}

// ------------------------------------------------------------------- progress
export function buildProgress(
  bodyMetrics: BodyMetricRow[],
  sessions: FullSessionRow[],
  now = new Date(),
): ProgressData {
  const bodyweight = bodyMetrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.recorded_at, kg: Number(m.weight_kg) }))
    .sort((left, right) => Date.parse(left.date) - Date.parse(right.date));

  const e1rmByDate = new Map<string, { squat: number; bench: number; deadlift: number }>();
  const volumeByWeek = new Map<string, number>();
  const prs: ProgressData["prs"] = [];
  const bestByExercise = new Map<string, number>();

  const evidencedSessions = sessions
    .filter(hasNativeTrainingEvidence)
    .slice()
    .sort((left, right) => Date.parse(left.started_at) - Date.parse(right.started_at));
  for (const s of evidencedSessions) {
    const day = s.started_at.slice(0, 10);
    const week = isoWeekLabel(new Date(s.started_at));
    const t = sessionTotals(s);
    volumeByWeek.set(week, (volumeByWeek.get(week) ?? 0) + t.tonnageKg);

    for (const se of s.session_exercises ?? []) {
      for (const set of se.workout_sets ?? []) {
        if (!set.completed || set.is_warmup) continue;
        const e1rm = estimate1rm(Number(set.weight_kg ?? 0), set.reps ?? 0);
        if (!e1rm) continue;
        const name = se.exercise_name.toLowerCase();
        const entry = e1rmByDate.get(day) ?? { squat: 0, bench: 0, deadlift: 0 };
        if (name.includes("squat")) entry.squat = Math.max(entry.squat, e1rm);
        if (name.includes("bench")) entry.bench = Math.max(entry.bench, e1rm);
        if (name.includes("deadlift")) entry.deadlift = Math.max(entry.deadlift, e1rm);
        e1rmByDate.set(day, entry);

        const prev = bestByExercise.get(se.exercise_name) ?? 0;
        if (e1rm > prev) {
          bestByExercise.set(se.exercise_name, e1rm);
          if (prev > 0)
            prs.push({
              date: s.started_at,
              exercise: se.exercise_name,
              detail: `${round(Number(set.weight_kg ?? 0), 1)} kg × ${set.reps} (e1RM ${e1rm} kg)`,
              weightKg: round(Number(set.weight_kg ?? 0), 1),
              reps: set.reps ?? 0,
              e1rmKg: e1rm,
            });
        }
      }
    }
  }

  const volume = [...volumeByWeek.entries()].map(([week, tonnage]) => ({
    week,
    tonnage: Math.round(tonnage),
  }));
  const load = volume.map((v, i) => {
    const window = volume.slice(Math.max(0, i - 3), i + 1);
    return {
      week: v.week,
      acute: Math.round(v.tonnage / 100),
      chronic: Math.round(window.reduce((s, w) => s + w.tonnage, 0) / window.length / 100),
    };
  });

  const completed = evidencedSessions.filter((s) => s.status === "completed");
  const streaks = trainingWeekStreaks(completed, now);
  return {
    bodyweight,
    e1rm: [...e1rmByDate.entries()].map(([date, v]) => ({ date, ...v })),
    volume,
    load,
    cardioFitness: [],
    streak: {
      currentWeeks: streaks.current,
      bestWeeks: streaks.best,
      weeksTracked: volume.length,
    },
    prs: prs.slice(-12).reverse(),
  };
}

const WEEK_MS = 7 * 86_400_000;

function weekStartUtc(value: Date): number {
  if (Number.isNaN(value.getTime())) return Number.NaN;
  const date = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return date.getTime();
}

/** Consecutive ISO training weeks; a completed prior week remains current until this week ends. */
export function trainingWeekStreaks(
  sessions: FullSessionRow[],
  now = new Date(),
): { current: number; best: number } {
  const currentWeek = weekStartUtc(now);
  const starts = [
    ...new Set(
      sessions
        .map((session) => weekStartUtc(new Date(session.started_at)))
        .filter((start) => Number.isFinite(start) && start <= currentWeek),
    ),
  ].sort((left, right) => left - right);
  if (!starts.length) return { current: 0, best: 0 };

  let best = 1;
  let run = 1;
  for (let index = 1; index < starts.length; index += 1) {
    run = starts[index]! - starts[index - 1]! === WEEK_MS ? run + 1 : 1;
    best = Math.max(best, run);
  }

  const latest = starts[starts.length - 1]!;
  if (currentWeek - latest > WEEK_MS) return { current: 0, best };
  let current = 1;
  for (let index = starts.length - 1; index > 0; index -= 1) {
    if (starts[index]! - starts[index - 1]! !== WEEK_MS) break;
    current += 1;
  }
  return { current, best };
}

export function isoWeekLabel(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ exercises
export function buildExercise(
  row: ExerciseRow,
  favorite: boolean,
  history: { date: string; weightKg: number; reps: number; sets: number; tonnageKg: number }[],
): Exercise {
  const best = history.reduce(
    (acc, h) =>
      estimate1rm(h.weightKg, h.reps) > estimate1rm(acc.weightKg, acc.reps)
        ? { weightKg: h.weightKg, reps: h.reps }
        : acc,
    { weightKg: 0, reps: 0 },
  );
  return {
    id: row.id,
    name: row.name,
    muscle: row.primary_muscle,
    secondary: row.secondary_muscles ?? [],
    equipment: row.equipment,
    pattern: row.movement_pattern,
    favorite,
    ...(history.at(-1) ? { lastPerformed: history.at(-1)!.date } : {}),
    best,
    e1rmTrend: history.map((h) => ({ date: h.date, e1rm: estimate1rm(h.weightKg, h.reps) })),
    history: history
      .slice()
      .reverse()
      .map((h) => ({
        date: h.date,
        detail: `${h.sets} × ${h.reps} @ ${round(h.weightKg, 1)} kg`,
        tonnageKg: Math.round(h.tonnageKg),
      })),
    cues: row.cues ?? [],
    isCustom: row.owner_id != null,
    ...(row.instructions ? { instructions: row.instructions } : {}),
  };
}

// ---------------------------------------------------------------------- coach
export function buildCoach(args: {
  sessions: FullSessionRow[];
  recovery: RecoveryData | null;
  preferences: PreferencesRow | null;
  displayName: string;
}): CoachData {
  const { sessions, recovery, preferences } = args;
  const target = preferences?.training_days_per_week ?? 4;
  const goal = (preferences?.primary_goal ?? "strength").replace("_", " ");
  const week = sessions.filter((s) => Date.now() - new Date(s.started_at).getTime() < 7 * 86400000);
  const tonnage = week.reduce((s, x) => s + sessionTotals(x).tonnageKg, 0);
  const lastMuscles = new Set(week.flatMap((s) => sessionTotals(s).bodyParts));

  const observations: Suggestion[] = [];
  if (!sessions.length)
    observations.push({
      id: "no-data",
      title: "No training history yet",
      detail: "Log two or three sessions and this page starts reflecting your actual patterns.",
      severity: "info",
    });
  if (week.length && week.length < target)
    observations.push({
      id: "freq",
      title: `${week.length} of ${target} planned sessions completed`,
      detail: "Frequency is the highest-leverage variable at your current volume.",
      severity: "warn",
    });
  if (lastMuscles.size && lastMuscles.size < 3)
    observations.push({
      id: "coverage",
      title: "Narrow muscle coverage this week",
      detail: `Only ${[...lastMuscles].join(", ")} received direct work.`,
      severity: "info",
    });
  if (tonnage > 0)
    observations.push({
      id: "tonnage",
      title: `${Math.round(tonnage)} kg total tonnage across ${week.length} session(s)`,
      detail: "Tonnage is a blunt tool but useful for week-to-week comparison.",
      severity: "good",
    });

  const risk: Suggestion[] = [];
  if (recovery?.readiness != null && recovery.readiness < 55)
    risk.push({
      id: "readiness",
      title: "Readiness below 55",
      detail:
        "Two consecutive low-readiness days with high tonnage is the classic overreach pattern.",
      severity: "risk",
    });
  if (week.length >= 6)
    risk.push({
      id: "density",
      title: "Six or more sessions in seven days",
      detail: "Schedule one full rest day to keep joint and CNS load manageable.",
      severity: "warn",
    });
  if (!risk.length)
    risk.push({
      id: "clear",
      title: "No load red flags detected",
      detail: "Acute load sits inside a reasonable range relative to your logged history.",
      severity: "good",
    });

  const adjustments: Suggestion[] = [
    {
      id: "adj-1",
      title:
        goal === "strength"
          ? "Add one heavy top single per main lift"
          : "Add one extra hard set per movement",
      detail: `Matched to your primary goal: ${goal}.`,
      severity: "info",
    },
    {
      id: "adj-2",
      title: "Anchor sessions to fixed weekdays",
      detail: `Your target is ${target} sessions per week; fixed slots beat opportunistic training.`,
      severity: "info",
    },
    {
      id: "adj-3",
      title: "Log RPE on every working set",
      detail: "RPE is what makes autoregulation and load flags possible here.",
      severity: "info",
    },
  ];

  return {
    today: {
      headline: sessions.length
        ? "Train the plan, cap the top set"
        : "Start with a baseline session",
      body: sessions.length
        ? `Based on ${week.length} session(s) in the last 7 days and ${recovery?.readiness != null ? `readiness ${recovery.readiness}` : "no recorded readiness score"}, today should be a normal working day.`
        : "There is no history to autoregulate against yet. Log a full session at RPE 7-8 to establish a baseline.",
      bullets: sessions.length
        ? ["Keep top sets at RPE 8", "Hold rest at 2-3 min on main lifts", "Log every working set"]
        : ["Pick 4-5 movements", "3 working sets each", "Record weight, reps and RPE"],
    },
    tomorrow: {
      headline: "Tomorrow's outline",
      body: "Deterministic outline derived from your logged split and weekly target — not a live AI model.",
      blocks: [
        {
          name: "Primary",
          detail:
            goal === "conditioning" ? "Intervals, 6 × 3 min hard" : "Main lift, 4 × 4 @ RPE 8",
        },
        { name: "Secondary", detail: "Two accessories, 3 × 8-12" },
        { name: "Aerobic", detail: "20-30 min zone 2" },
      ],
    },
    observations,
    riskNotes: risk,
    adjustments,
    starterQuestions: [
      "Am I recovering well enough to add a session?",
      "What is limiting my squat progress?",
      "How should I adjust volume this week?",
      "Is my protein intake enough for my goal?",
    ],
  };
}
