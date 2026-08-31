/**
 * Pure progression rules.
 *
 * Given an athlete's own completed sets for one movement, this module answers
 * a single question: what load should be on the bar for the next working set?
 *
 * Everything here is deterministic — no React, no Supabase, no AI calls — so
 * the rules can be unit-tested and reused by any client. Canonical unit is
 * ALWAYS kilograms; presentation converts.
 */

import { estimate1rm, kgToLb, lbToKg } from "./units";

/* -------------------------------------------------------------------------- */
/* Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/** One completed working session for a movement (the top working set of it). */
export interface PerformancePoint {
  /** ISO timestamp of the session. */
  date: string;
  weightKg: number;
  reps: number;
  rpe: number | null;
  /** Working sets completed that session. */
  sets: number;
}

export type LiftClass = "main" | "accessory" | "bodyweight";

export type ProgressionRule =
  | "no-history"
  | "linear"
  | "double-progression-reps"
  | "double-progression-load"
  | "hold-high-effort"
  | "deload-stall"
  | "bodyweight";

export interface SuggestionInput {
  name: string;
  pattern?: string | null;
  equipment?: string | null;
  targetReps?: string | null;
  targetRpe?: number | null;
  /** Ordered oldest → newest. Only completed working sets belong here. */
  points: PerformancePoint[];
  /** Today's readiness score (0-100) when the athlete checked in. */
  readiness?: number | null;
  /** Reference date for staleness maths; defaults to now. */
  now?: Date;
}

export interface WorkingWeightSuggestion {
  /** Suggested load for the next working set, canonical kg. */
  weightKg: number;
  /** Reps to chase at that load. */
  reps: number;
  rule: ProgressionRule;
  /** Short human sentence: why this number. */
  reason: string;
  /** Extra badges, e.g. "-5% · low readiness". */
  notes: string[];
  /** e1RM the suggestion was derived from, canonical kg. */
  basisE1rmKg: number;
  /** Percent applied from the readiness coupling (negative = pulled back). */
  readinessPercent: number;
  stalled: boolean;
  deload: boolean;
  confidence: "high" | "medium" | "low";
  /** Days since the last logged session for this movement. */
  staleDays: number | null;
}

/* -------------------------------------------------------------------------- */
/* Classification and increments                                              */
/* -------------------------------------------------------------------------- */

const MAIN_PATTERNS = ["squat", "hinge", "horizontal press", "vertical press", "deadlift", "press"];
const MAIN_NAME_HINTS = [
  "squat",
  "deadlift",
  "bench press",
  "overhead press",
  "front squat",
  "romanian deadlift",
  "power clean",
  "clean",
  "snatch",
  "push press",
];

const BODYWEIGHT_EQUIPMENT = ["bodyweight", "none", "band"];
const LOWER_MAIN_HINTS = ["squat", "deadlift", "hinge"];

/**
 * Main lifts progress linearly; accessories use double progression. The check
 * is name-first (a "Barbell Back Squat" is a main lift whatever the pattern
 * string says) then pattern, then equipment.
 */
export function classifyLift(
  input: Pick<SuggestionInput, "name" | "pattern" | "equipment">,
): LiftClass {
  const name = (input.name ?? "").toLowerCase();
  const equipment = (input.equipment ?? "").toLowerCase();
  if (BODYWEIGHT_EQUIPMENT.some((e) => equipment.includes(e))) return "bodyweight";
  if (MAIN_NAME_HINTS.some((hint) => name.includes(hint))) return "main";
  const pattern = (input.pattern ?? "").toLowerCase();
  if (equipment.includes("barbell") && MAIN_PATTERNS.some((p) => pattern.includes(p)))
    return "main";
  return "accessory";
}

function isLowerMainLift(movement?: Partial<Pick<SuggestionInput, "name" | "pattern">>): boolean {
  const description = `${movement?.name ?? ""} ${movement?.pattern ?? ""}`.toLowerCase();
  return LOWER_MAIN_HINTS.some((hint) => description.includes(hint));
}

/** Plate-friendly progression step in the pounds-first training model. */
export function loadIncrementLb(
  equipment?: string | null,
  liftClass: LiftClass = "accessory",
  movement?: Partial<Pick<SuggestionInput, "name" | "pattern">>,
): number {
  const e = (equipment ?? "").toLowerCase();
  if (BODYWEIGHT_EQUIPMENT.some((x) => e.includes(x))) return 0;
  return liftClass === "main" && isLowerMainLift(movement) ? 10 : 5;
}

/** Same progression step expressed in canonical kg for calculations/storage. */
export function loadIncrementKg(
  equipment?: string | null,
  liftClass: LiftClass = "accessory",
  movement?: Partial<Pick<SuggestionInput, "name" | "pattern">>,
): number {
  return lbToKg(loadIncrementLb(equipment, liftClass, movement));
}

export function roundToIncrement(kg: number, increment: number): number {
  if (increment <= 0) return Math.round(kg * 10) / 10;
  return Math.round(kg / increment) * increment;
}

/** Quantizes a canonical load on a pound plate boundary, then returns canonical kg. */
export function roundToPoundIncrementKg(kg: number, incrementLb: number): number {
  if (incrementLb <= 0) return Math.round(kg * 100) / 100;
  const roundedLb = Math.round(kgToLb(kg) / incrementLb) * incrementLb;
  return Math.round(lbToKg(roundedLb) * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Rep targets                                                                */
/* -------------------------------------------------------------------------- */

export interface RepTarget {
  low: number;
  high: number;
}

/** Parses "8-10", "8–10", "12", "AMRAP", "8 each side" into a bounded range. */
export function parseTargetReps(target?: string | null): RepTarget {
  const numbers = (target ?? "").match(/\d+/g)?.map(Number) ?? [];
  if (numbers.length === 0) return { low: 8, high: 10 };
  if (numbers.length === 1) return { low: numbers[0]!, high: numbers[0]! };
  const sorted = [...numbers].sort((a, b) => a - b);
  return { low: sorted[0]!, high: sorted[sorted.length - 1]! };
}

/* -------------------------------------------------------------------------- */
/* Readiness coupling                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Bounded readiness nudge. Never silent: the caller always renders the label
 * next to the number so the athlete can see exactly why it moved.
 */
export function readinessAdjustment(readiness?: number | null): {
  percent: number;
  label: string | null;
} {
  if (readiness == null || !Number.isFinite(readiness)) return { percent: 0, label: null };
  if (readiness >= 85) return { percent: 2, label: "+2% · high readiness" };
  if (readiness >= 75) return { percent: 0, label: null };
  if (readiness >= 60) return { percent: -2, label: "-2% · moderate readiness" };
  if (readiness >= 45) return { percent: -5, label: "-5% · low readiness" };
  return { percent: -7, label: "-7% · very low readiness" };
}

/* -------------------------------------------------------------------------- */
/* Stall detection                                                            */
/* -------------------------------------------------------------------------- */

export interface StallState {
  stalled: boolean;
  /** Consecutive most-recent sessions at the same load without rep progress. */
  sessions: number;
}

const STALL_SESSIONS = 3;

/** Same load, no rep improvement, across the last three sessions = stalled. */
export function detectStall(points: PerformancePoint[]): StallState {
  if (points.length < STALL_SESSIONS) return { stalled: false, sessions: points.length ? 1 : 0 };
  const recent = points.slice(-STALL_SESSIONS);
  const load = recent[recent.length - 1]!.weightKg;
  const sameLoad = recent.every((p) => Math.abs(p.weightKg - load) < 0.51);
  if (!sameLoad) return { stalled: false, sessions: 1 };
  const bestReps = Math.max(...recent.map((p) => p.reps));
  const progressed =
    recent[recent.length - 1]!.reps >= bestReps &&
    recent[recent.length - 1]!.reps > recent[0]!.reps;
  return { stalled: !progressed, sessions: STALL_SESSIONS };
}

/* -------------------------------------------------------------------------- */
/* The suggestion                                                             */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

function daysBetween(from: string, now: Date): number | null {
  const t = Date.parse(from);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((now.getTime() - t) / DAY_MS));
}

/** Inverse Epley: load that should yield `reps` given an estimated 1RM. */
export function loadForReps(e1rmKg: number, reps: number): number {
  if (e1rmKg <= 0 || reps <= 0) return 0;
  return e1rmKg / (1 + reps / 30);
}

/**
 * Resolves the next working load.
 *
 * Returns `null` only when there is no usable history at all — the UI then
 * keeps showing the template's own load guidance rather than inventing a
 * number.
 */
export function suggestWorkingWeight(input: SuggestionInput): WorkingWeightSuggestion | null {
  const points = input.points.filter((p) => p.weightKg > 0 && p.reps > 0);
  const liftClass = classifyLift(input);
  const target = parseTargetReps(input.targetReps);
  const readiness = readinessAdjustment(input.readiness);

  if (points.length === 0) {
    if (liftClass !== "bodyweight") return null;
    return {
      weightKg: 0,
      reps: target.low,
      rule: "bodyweight",
      reason: "Bodyweight movement — chase reps, not load.",
      notes: [],
      basisE1rmKg: 0,
      readinessPercent: 0,
      stalled: false,
      deload: false,
      confidence: "low",
      staleDays: null,
    };
  }

  const last = points[points.length - 1]!;
  const incrementLb = loadIncrementLb(input.equipment, liftClass, input);
  const increment = lbToKg(incrementLb);
  const recent = points.slice(-3);
  const basisE1rm = Math.max(...recent.map((p) => estimate1rm(p.weightKg, p.reps)));
  const stall = detectStall(points);
  const staleDays = daysBetween(last.date, input.now ?? new Date());
  const hitTop = last.reps >= target.high;
  const heavyEffort = last.rpe != null && last.rpe >= 9.5;
  const cappedRpe = input.targetRpe != null && last.rpe != null && last.rpe > input.targetRpe + 1;

  let rule: ProgressionRule;
  let weight = last.weightKg;
  let reps = Math.max(target.low, Math.min(last.reps, target.high));
  let reason: string;
  const notes: string[] = [];
  let deload = false;

  if (stall.stalled) {
    rule = "deload-stall";
    deload = true;
    weight = last.weightKg * 0.9;
    reps = target.low;
    reason = `Held the same load for ${stall.sessions} sessions without rep progress — hold or deload 10%.`;
  } else if (heavyEffort || cappedRpe) {
    rule = "hold-high-effort";
    weight = last.weightKg;
    reps = Math.max(target.low, last.reps);
    reason = `Last set went at RPE ${last.rpe} — repeat the same load before adding weight.`;
  } else if (liftClass === "bodyweight" || increment === 0) {
    rule = "bodyweight";
    weight = last.weightKg;
    reps = Math.min(target.high, last.reps + 1);
    reason = `Add reps: ${last.reps} → ${reps} at the same load.`;
  } else if (liftClass === "main") {
    rule = "linear";
    weight = last.weightKg + increment;
    reps = target.low;
    reason = `Main lift progressing linearly by one plate-friendly step for ${target.low} reps.`;
  } else if (hitTop) {
    rule = "double-progression-load";
    weight = last.weightKg + increment;
    reps = target.low;
    reason = `Hit the top of ${target.low}-${target.high} reps — add one plate-friendly step and reset to ${target.low}.`;
  } else {
    rule = "double-progression-reps";
    weight = last.weightKg;
    reps = Math.min(target.high, last.reps + 1);
    reason = `Same load, chase ${reps} reps before adding weight.`;
  }

  if (readiness.percent !== 0 && rule !== "deload-stall") {
    weight = weight * (1 + readiness.percent / 100);
    if (readiness.label) notes.push(readiness.label);
  }

  if (staleDays != null && staleDays > 45) {
    weight = Math.min(weight, last.weightKg);
    notes.push(`${staleDays}d since last session — ease back in`);
  }

  const confidence: WorkingWeightSuggestion["confidence"] =
    staleDays != null && staleDays > 45 ? "low" : points.length >= 3 ? "high" : "medium";

  const loadChanged = Math.abs(weight - last.weightKg) >= 0.005;
  const weightKg =
    loadChanged && incrementLb > 0
      ? roundToPoundIncrementKg(weight, incrementLb)
      : Math.round(weight * 100) / 100;

  return {
    weightKg: Math.max(0, weightKg),
    reps,
    rule,
    reason,
    notes,
    basisE1rmKg: basisE1rm,
    readinessPercent: rule === "deload-stall" ? 0 : readiness.percent,
    stalled: stall.stalled,
    deload,
    confidence,
    staleDays,
  };
}

/* -------------------------------------------------------------------------- */
/* Lookup keys                                                                */
/* -------------------------------------------------------------------------- */

/**
 * History is keyed by canonical exercise id when one exists, and additionally
 * by normalized name so sessions logged against ad-hoc movements (no library
 * link) still resolve.
 */
export function performanceKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export type PerformanceMap = Record<string, PerformancePoint[]>;

export function lookupPoints(
  map: PerformanceMap | undefined,
  ids: { exerciseId?: string | null; name?: string | null },
): PerformancePoint[] {
  if (!map) return [];
  if (ids.exerciseId && map[ids.exerciseId]?.length) return map[ids.exerciseId]!;
  if (ids.name) {
    const byName = map[performanceKey(ids.name)];
    if (byName?.length) return byName;
  }
  return [];
}

/* -------------------------------------------------------------------------- */
/* A. Double progression state                                                */
/* -------------------------------------------------------------------------- */

export interface DoubleProgressionState {
  action: "increase" | "hold";
  /** Load to run next session, canonical kg. */
  nextWeightKg: number;
  /** Reps to chase next session. */
  nextReps: number;
  /** Sets that reached the top of the range at the required quality. */
  setsAtTop: number;
  totalSets: number;
  explanation: string;
}

export interface LoggedSet {
  reps: number;
  /** RIR when logged; null when unknown. */
  rir?: number | null;
  /** Set was performed with acceptable technique. Defaults to true. */
  cleanForm?: boolean;
}

/**
 * Double progression: hold the load until EVERY working set reaches the top of
 * the range at the required RIR with clean form, then add one increment and
 * return to the low end.
 */
export function doubleProgressionState(input: {
  weightKg: number;
  sets: readonly LoggedSet[];
  target: RepTarget;
  incrementKg: number;
  /** Highest RIR that still counts as a qualifying set. Default 2. */
  requiredRir?: number;
  /** Prescribed set count, used for guidance before any set is logged. */
  plannedSets?: number;
}): DoubleProgressionState {
  const requiredRir = input.requiredRir ?? 2;
  const qualifying = input.sets.filter(
    (s) =>
      s.reps >= input.target.high &&
      (s.cleanForm ?? true) &&
      (s.rir == null || s.rir <= requiredRir),
  );
  const totalSets = input.sets.length;
  const setsAtTop = qualifying.length;
  const allTop = totalSets > 0 && setsAtTop === totalSets;

  if (allTop) {
    const nextWeightKg = Math.round((input.weightKg + input.incrementKg) * 100) / 100;
    return {
      action: "increase",
      nextWeightKg,
      nextReps: input.target.low,
      setsAtTop,
      totalSets,
      explanation: `All ${totalSets} sets hit ${input.target.high} reps — add one increment and reset to ${input.target.low} reps.`,
    };
  }

  return {
    action: "hold",
    nextWeightKg: Math.round(input.weightKg * 100) / 100,
    nextReps: Math.min(input.target.high, Math.max(input.target.low, maxReps(input.sets) + 1)),
    setsAtTop,
    totalSets,
    explanation: `Hold this load until all ${totalSets || input.plannedSets || 1} sets reach ${input.target.high} reps; then increase.`,
  };
}

function maxReps(sets: readonly LoggedSet[]): number {
  return sets.length ? Math.max(...sets.map((s) => s.reps)) : 0;
}

/* -------------------------------------------------------------------------- */
/* B. Heavy + backoff                                                         */
/* -------------------------------------------------------------------------- */

export interface HeavyBackoffPlan {
  topSet: { weightKg: number; reps: number; targetRir: number };
  backoffSets: { weightKg: number; reps: number }[];
  /** Percentage reduction applied to the top-set load. */
  reductionPercent: number;
  explanation: string;
}

const BACKOFF_MIN_PERCENT = 10;
const BACKOFF_MAX_PERCENT = 25;

/**
 * Heavy top set at 4-7 reps and RIR 1-2, then backoff sets in a higher rep
 * range at a bounded percentage reduction from the top-set load.
 */
export function heavyBackoffPlan(input: {
  topSetWeightKg: number;
  topSetReps?: number;
  backoffSets?: number;
  backoffReps?: number;
  reductionPercent?: number;
  incrementLb?: number;
}): HeavyBackoffPlan {
  const topReps = Math.min(7, Math.max(4, input.topSetReps ?? 5));
  const backoffReps = Math.min(15, Math.max(8, input.backoffReps ?? 10));
  const count = Math.min(4, Math.max(1, input.backoffSets ?? 2));
  const reduction = Math.min(
    BACKOFF_MAX_PERCENT,
    Math.max(BACKOFF_MIN_PERCENT, input.reductionPercent ?? 15),
  );
  const raw = input.topSetWeightKg * (1 - reduction / 100);
  const weightKg =
    input.incrementLb && input.incrementLb > 0
      ? roundToPoundIncrementKg(raw, input.incrementLb)
      : Math.round(raw * 100) / 100;

  return {
    topSet: { weightKg: Math.round(input.topSetWeightKg * 100) / 100, reps: topReps, targetRir: 1 },
    backoffSets: Array.from({ length: count }, () => ({ weightKg, reps: backoffReps })),
    reductionPercent: reduction,
    explanation: `Top set ${topReps} reps at RIR 1-2, then ${count} backoff set${count > 1 ? "s" : ""} of ${backoffReps} at −${reduction}%.`,
  };
}

/* -------------------------------------------------------------------------- */
/* C. Volume progression                                                      */
/* -------------------------------------------------------------------------- */

export interface VolumeProgressionResult {
  action: "add" | "hold" | "reduce";
  recommendedWeeklySets: number;
  explanation: string;
}

/** Per-muscle weekly hard-set ceiling before returns clearly diminish. */
export const WEEKLY_SET_CEILING = 22;

/**
 * Volume only rises after a stable week, and stops at a ceiling. Declining
 * performance or poor readiness pulls sets back instead of adding them.
 */
export function volumeProgression(input: {
  currentWeeklySets: number;
  /** Consecutive weeks where performance held or improved. */
  stableWeeks: number;
  /** Reps/load trend across the last two weeks. */
  performanceTrend: "up" | "flat" | "down";
  averageReadiness?: number | null;
  ceiling?: number;
}): VolumeProgressionResult {
  const ceiling = input.ceiling ?? WEEKLY_SET_CEILING;
  const readiness = input.averageReadiness;

  if (input.performanceTrend === "down" || (readiness != null && readiness < 50)) {
    const reduced = Math.max(4, Math.round(input.currentWeeklySets * 0.75));
    return {
      action: "reduce",
      recommendedWeeklySets: reduced,
      explanation:
        "Performance or recovery is trending down — cut weekly sets by about a quarter before adding again.",
    };
  }
  if (input.currentWeeklySets >= ceiling) {
    return {
      action: "hold",
      recommendedWeeklySets: ceiling,
      explanation: `Already at the ${ceiling}-set weekly ceiling for this muscle — hold and progress load instead.`,
    };
  }
  if (input.stableWeeks < 1 || input.performanceTrend === "flat") {
    return {
      action: "hold",
      recommendedWeeklySets: input.currentWeeklySets,
      explanation: "Hold this volume for one more stable week before adding sets.",
    };
  }
  const next = Math.min(ceiling, input.currentWeeklySets + (input.currentWeeklySets < 12 ? 2 : 1));
  return {
    action: "add",
    recommendedWeeklySets: next,
    explanation: `Stable week logged — add ${next - input.currentWeeklySets} set${next - input.currentWeeklySets > 1 ? "s" : ""} for this muscle.`,
  };
}
