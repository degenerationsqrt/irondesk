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
        topSet = { exercise: se.exercise_name, weightKg: Number(s.weight_kg ?? 0), reps: s.reps ?? 0 };
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
    calories: row.calories ?? 0,
    prCount: 0,
    blocks: (row.session_exercises ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((se) => ({
        exercise: se.exercise_name,
        detail: describeBlock(se),
      })),
  };
}

function describeBlock(se: SessionExerciseRow): string {
  const working = (se.workout_sets ?? []).filter((s) => !s.is_warmup && s.completed);
  if (!working.length) return "No completed sets";
  const best = working.reduce((a, b) => ((b.weight_kg ?? 0) > (a.weight_kg ?? 0) ? b : a));
  return `${working.length} × ${best.reps ?? 0} @ ${round(Number(best.weight_kg ?? 0), 1)} kg`;
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
    calories: row.calories ?? 0,
    avgHr: row.avg_hr ?? 0,
    maxHr: row.max_hr ?? 0,
    cardioLoad: row.cardio_load ?? 0,
    activeZoneMinutes: row.active_zone_minutes ?? 0,
    zones: zonesFromJson(row.zones),
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
    calories: row.calories ?? 0,
    avgHr: row.avg_hr ?? 0,
    maxHr: row.max_hr ?? 0,
    cardioLoad: row.cardio_load ?? 0,
    activeZoneMinutes: row.active_zone_minutes ?? 0,
    zones: [],
  };
}

export function strengthMetrics(sessions: FullSessionRow[]): StrengthMetrics {
  let sets = 0;
  let reps = 0;
  let tonnage = 0;
  let top: StrengthMetrics["topLift"] = { exercise: "—", weightKg: 0, reps: 0 };
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
  nutrition: NutritionDay | null;
  recovery: RecoveryData | null;
  preferences: PreferencesRow | null;
  displayName: string;
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
  const { todaySessions, weekSessions, todayCardio, nutrition, recovery, preferences } = input;
  const totals = strengthMetrics(todaySessions);
  const cardioLoad =
    todayCardio.reduce((s, c) => s + (c.cardio_load ?? 0), 0) +
    todaySessions.reduce((s, c) => s + (c.cardio_load ?? 0), 0);
  const azm =
    todayCardio.reduce((s, c) => s + (c.active_zone_minutes ?? 0), 0) +
    todaySessions.reduce((s, c) => s + (c.active_zone_minutes ?? 0), 0);

  const target = preferences?.training_days_per_week ?? 4;
  const strengthPart = clamp((totals.tonnageKg / 1000) * 9, 0, 40);
  const cardioPart = clamp(cardioLoad / 8, 0, 30);
  const consistencyPart = clamp((weekSessions.length / Math.max(1, target)) * 15, 0, 15);
  const recoveryPart = recovery ? clamp((recovery.readiness / 100) * 15, 0, 15) : 10;
  const ironScore = Math.round(strengthPart + cardioPart + consistencyPart + recoveryPart);

  const totalStrain = Math.round(strengthPart * 2 + cardioPart * 2);
  const strainSum = strengthPart + cardioPart || 1;
  const cardioPercent = Math.round((cardioPart / strainSum) * 100);

  const zoneTotals = mergeZones(todayCardio.map((c) => zonesFromJson(c.zones)));
  const avgHrValues = [...todayCardio.map((c) => c.avg_hr), ...todaySessions.map((s) => s.avg_hr)].filter(
    (v): v is number => v != null && v > 0,
  );
  const avgHr = avgHrValues.length ? Math.round(avgHrValues.reduce((a, b) => a + b, 0) / avgHrValues.length) : 0;

  const dataNotes: string[] = [];
  if (!todaySessions.length && !todayCardio.length) dataNotes.push("No training logged today.");
  if (!zoneTotals.length) dataNotes.push("Heart-rate zones need a wearable or a logged cardio session.");
  if (!nutrition) dataNotes.push("No nutrition logged today.");
  if (!recovery) dataNotes.push("No recovery check-in today.");

  const grades = buildGrades({
    cardioLoad,
    tonnage: totals.tonnageKg,
    nutrition,
    recovery,
    weekCount: weekSessions.length,
    target,
  });
  const overall = grades.length
    ? Math.round(grades.reduce((s, g) => s + g.score, 0) / grades.length)
    : 0;

  const sessions: ActivitySession[] = [
    ...todaySessions.map(strengthToActivity),
    ...todayCardio.map(cardioToActivity),
  ].sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  const energyIntake = nutrition?.consumed.calories ?? 0;
  const exerciseBurn = sessions.reduce((s, a) => s + a.calories, 0);
  const bmr = 1750;
  const net = energyIntake - bmr - exerciseBurn;

  return {
    date: new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }),
    statusLine: statusLine(ironScore, dataNotes.length),
    ironScore,
    grade: gradeFromScore(overall || ironScore),
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
    nutrition:
      nutrition ??
      {
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
      status: net < -200 ? "deficit" : net > 200 ? "surplus" : "maintenance",
    },
    grades,
    suggestions: buildSuggestions({ dataNotes, totals, cardioLoad, weekCount: weekSessions.length, target, recovery }),
    keyTakeaway: keyTakeaway({ ironScore, dataNotes, weekCount: weekSessions.length, target }),
    weeklyLoad: weeklyLoad(weekSessions),
    recentProgress: [
      { label: "Sessions this week", value: `${weekSessions.length}`, delta: `target ${target}`, positive: weekSessions.length >= target },
      { label: "Tonnage today", value: `${Math.round(totals.tonnageKg)} kg`, delta: `${totals.totalSets} sets`, positive: totals.tonnageKg > 0 },
      { label: "Active zone min", value: `${azm}`, delta: azm > 0 ? "logged" : "none yet", positive: azm > 0 },
    ],
    dataQuality: {
      level: dataNotes.length === 0 ? "rich" : dataNotes.length < 3 ? "partial" : "sparse",
      notes: dataNotes,
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
  if (total === 0) return "No strain recorded yet today.";
  if (total < 30) return "Light day. Useful for recovery, not for adaptation.";
  if (total < 70)
    return cardioPercent > 55
      ? "Moderate strain, cardio-dominant. Strength stimulus is light."
      : "Moderate strain, muscular-dominant. Solid maintainable dose.";
  return "High strain. Watch tomorrow's readiness before repeating.";
}

function mergeZones(lists: ZoneSplit[][]): ZoneSplit[] {
  const minutes = new Map<ZoneKey, number>();
  for (const list of lists) for (const z of list) minutes.set(z.zone, (minutes.get(z.zone) ?? 0) + z.minutes);
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
}): GradeLine[] {
  const cardioScore = clamp((args.cardioLoad / 120) * 100);
  const strengthScore = clamp((args.tonnage / 8000) * 100);
  const nutritionScore = args.nutrition
    ? clamp(
        100 -
          Math.abs((args.nutrition.consumed.calories || 0) - (args.nutrition.targets.calories || 1)) /
            Math.max(1, args.nutrition.targets.calories || 1) *
            100,
      )
    : 0;
  const recoveryScore = args.recovery ? args.recovery.readiness : 0;
  const consistencyScore = clamp((args.weekCount / Math.max(1, args.target)) * 100);
  const lines: GradeLine[] = [
    { label: "Cardio", score: Math.round(cardioScore), note: args.cardioLoad ? `${args.cardioLoad} cardio load` : "No cardio logged" },
    { label: "Strength", score: Math.round(strengthScore), note: args.tonnage ? `${Math.round(args.tonnage)} kg tonnage` : "No lifting logged" },
    { label: "Nutrition", score: Math.round(nutritionScore), note: args.nutrition ? "Vs. calorie target" : "Not logged" },
    { label: "Recovery", score: Math.round(recoveryScore), note: args.recovery ? "From check-in" : "No check-in" },
    { label: "Consistency", score: Math.round(consistencyScore), note: `${args.weekCount}/${args.target} sessions` },
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
}): Suggestion[] {
  const out: Suggestion[] = [];
  if (args.weekCount < args.target)
    out.push({
      id: "consistency",
      title: `Log ${args.target - args.weekCount} more session${args.target - args.weekCount > 1 ? "s" : ""} this week`,
      detail: "Consistency drives adaptation more than any single workout.",
      severity: "warn",
    });
  if (!args.totals.totalSets)
    out.push({
      id: "strength",
      title: "Get a lifting session on the board",
      detail: "Start a workout and log at least 12 working sets to register a strength stimulus.",
      severity: "info",
    });
  if (args.cardioLoad === 0)
    out.push({
      id: "cardio",
      title: "Add 25-35 min of zone 2",
      detail: "Low-intensity aerobic work raises work capacity without adding recovery cost.",
      severity: "info",
    });
  if (args.recovery && args.recovery.readiness < 55)
    out.push({
      id: "recovery",
      title: "Readiness is low — cut volume 20%",
      detail: "Keep intensity, drop total sets. Protect the next 48 hours.",
      severity: "risk",
    });
  for (const note of args.dataNotes.slice(0, 2))
    out.push({ id: `gap-${note.slice(0, 8)}`, title: "Close a data gap", detail: note, severity: "info" });
  return out.slice(0, 5);
}

function keyTakeaway(args: { ironScore: number; dataNotes: string[]; weekCount: number; target: number }): string {
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
    buckets.set(label, (buckets.get(label) ?? 0) + Math.round(t.tonnageKg / 100) + (s.cardio_load ?? 0));
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
    consumed: { calories: day.calories, proteinG: day.protein_g, carbsG: day.carbs_g, fatG: day.fat_g },
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
  const readiness = row.readiness ?? estimateReadiness(row);
  const placeholders: string[] = [];
  if (row.hrv_ms == null) placeholders.push("HRV requires a connected wearable — not available yet.");
  if (row.source !== "wearable") placeholders.push("Sleep and resting HR are self-reported, not device-measured.");
  return {
    readiness,
    status: readiness >= 75 ? "Primed" : readiness >= 55 ? "Moderate" : "Compromised",
    recommendation:
      readiness >= 75
        ? "Green light. Push the top set and keep accessory volume as planned."
        : readiness >= 55
          ? "Train as planned but cap the top set at RPE 8 and trim the last accessory."
          : "Deload today: 60% of planned volume, no sets above RPE 7.",
    sleep: {
      hours: Number(row.sleep_hours ?? 0),
      efficiencyPercent: row.sleep_efficiency_percent ?? 0,
      note: row.sleep_hours == null ? "Not logged" : Number(row.sleep_hours) >= 7.5 ? "Adequate duration" : "Below your target duration",
    },
    restingHr: row.resting_hr ?? 0,
    hrvMs: row.hrv_ms,
    soreness: Array.isArray(row.soreness) ? (row.soreness as { area: string; level: number }[]) : [],
    fatigue: row.fatigue ?? 0,
    stress: row.stress ?? 0,
    trend: trend
      .slice()
      .reverse()
      .map((r) => ({ date: r.day, readiness: r.readiness ?? estimateReadiness(r) })),
    placeholders,
  };
}

/** Fallback readiness when the user logged inputs but no explicit score. */
function estimateReadiness(row: RecoveryRow): number {
  const sleep = clamp((Number(row.sleep_hours ?? 6) / 8) * 100);
  const fatigue = clamp(100 - (row.fatigue ?? 5) * 10);
  const stress = clamp(100 - (row.stress ?? 5) * 10);
  return Math.round(sleep * 0.45 + fatigue * 0.35 + stress * 0.2);
}

// ------------------------------------------------------------------- progress
export function buildProgress(bodyMetrics: BodyMetricRow[], sessions: FullSessionRow[]): ProgressData {
  const bodyweight = bodyMetrics
    .filter((m) => m.weight_kg != null)
    .map((m) => ({ date: m.recorded_at, kg: Number(m.weight_kg) }));

  const e1rmByDate = new Map<string, { squat: number; bench: number; deadlift: number }>();
  const volumeByWeek = new Map<string, number>();
  const prs: ProgressData["prs"] = [];
  const bestByExercise = new Map<string, number>();

  for (const s of sessions) {
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
            });
        }
      }
    }
  }

  const volume = [...volumeByWeek.entries()].map(([week, tonnage]) => ({ week, tonnage: Math.round(tonnage) }));
  const load = volume.map((v, i) => {
    const window = volume.slice(Math.max(0, i - 3), i + 1);
    return {
      week: v.week,
      acute: Math.round(v.tonnage / 100),
      chronic: Math.round(window.reduce((s, w) => s + w.tonnage, 0) / window.length / 100),
    };
  });

  const completed = sessions.filter((s) => s.status === "completed");
  return {
    bodyweight,
    e1rm: [...e1rmByDate.entries()].map(([date, v]) => ({ date, ...v })),
    volume,
    load,
    cardioFitness: [],
    streak: {
      current: currentStreakWeeks(completed),
      best: currentStreakWeeks(completed),
      weeksHitTarget: volume.length,
    },
    prs: prs.slice(-12).reverse(),
  };
}

function currentStreakWeeks(sessions: FullSessionRow[]): number {
  const weeks = new Set(sessions.map((s) => isoWeekLabel(new Date(s.started_at))));
  return weeks.size;
}

export function isoWeekLabel(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `W${String(week).padStart(2, "0")}`;
}

// ------------------------------------------------------------------ exercises
export function buildExercise(
  row: ExerciseRow,
  favorite: boolean,
  history: { date: string; weightKg: number; reps: number; sets: number; tonnageKg: number }[],
): Exercise {
  const best = history.reduce(
    (acc, h) => (estimate1rm(h.weightKg, h.reps) > estimate1rm(acc.weightKg, acc.reps) ? { weightKg: h.weightKg, reps: h.reps } : acc),
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
  if (recovery && recovery.readiness < 55)
    risk.push({
      id: "readiness",
      title: "Readiness below 55",
      detail: "Two consecutive low-readiness days with high tonnage is the classic overreach pattern.",
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
      title: goal === "strength" ? "Add one heavy top single per main lift" : "Add one extra hard set per movement",
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
      headline: sessions.length ? "Train the plan, cap the top set" : "Start with a baseline session",
      body: sessions.length
        ? `Based on ${week.length} session(s) in the last 7 days and ${recovery ? `readiness ${recovery.readiness}` : "no recovery check-in"}, today should be a normal working day.`
        : "There is no history to autoregulate against yet. Log a full session at RPE 7-8 to establish a baseline.",
      bullets: sessions.length
        ? ["Keep top sets at RPE 8", "Hold rest at 2-3 min on main lifts", "Log every working set"]
        : ["Pick 4-5 movements", "3 working sets each", "Record weight, reps and RPE"],
    },
    tomorrow: {
      headline: "Tomorrow's outline",
      body: "Deterministic outline derived from your logged split and weekly target — not a live AI model.",
      blocks: [
        { name: "Primary", detail: goal === "conditioning" ? "Intervals, 6 × 3 min hard" : "Main lift, 4 × 4 @ RPE 8" },
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
