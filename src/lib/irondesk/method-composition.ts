/**
 * Composition layer for the IronDesk training-method engine.
 *
 * Everything here is pure and deterministic. It turns real athlete history and
 * the real movement list into: weekly direct-set volume, genuine exercise
 * pairings/groups (never placeholder station names), executable set structures
 * per method, and the IronDesk Black specialization-window lifecycle.
 *
 * Loads are canonical kilograms.
 */
import {
  heavyBackoffPlan,
  roundToPoundIncrementKg,
  volumeProgression,
  type VolumeProgressionResult,
} from "./progression";
import { estimate1rm } from "./units";
import {
  classifyExerciseType,
  getMethod,
  isHighRiskLift,
  type AthleteMethodProfile,
  type ExerciseType,
} from "./training-methods";

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/* -------------------------------------------------------------------------- */
/* 1. Weekly direct working-set volume                                        */
/* -------------------------------------------------------------------------- */

/** One completed, non-warmup working set attributed to its PRIMARY muscle. */
export interface DirectSetRecord {
  /** ISO date of the session the set belongs to. */
  date: string;
  /** Primary muscle of the movement. Secondary muscles are never counted. */
  muscle: string;
  weightKg: number;
  reps: number;
}

export interface MuscleVolume {
  muscle: string;
  /** Direct working sets inside the current window. */
  currentSets: number;
  /** Direct working sets in the window immediately before it. */
  previousSets: number;
  trend: "up" | "flat" | "down";
  /** Consecutive stable windows (0 or 1 with a two-window comparison). */
  stableWeeks: number;
  /** Best estimated 1RM in the current window, kg — null without load data. */
  bestE1rmKg: number | null;
}

export type MuscleVolumeMap = Record<string, MuscleVolume>;

export function normalizeMuscle(muscle: string): string {
  return muscle.trim().toLowerCase();
}

/**
 * Counts productive DIRECT working sets per primary muscle over a window and
 * the window immediately before it, and derives a performance trend from the
 * best estimated 1RM in each window.
 *
 * Callers must pass only completed, non-warmup working sets.
 */
export function weeklyDirectSets(
  records: readonly DirectSetRecord[],
  options: { now?: Date; windowDays?: number } = {},
): MuscleVolumeMap {
  const now = options.now ?? new Date();
  const windowDays = Math.max(1, options.windowDays ?? 7);
  const windowMs = windowDays * DAY_MS;
  const nowMs = now.getTime();

  const acc = new Map<
    string,
    { current: number; previous: number; currentBest: number; previousBest: number }
  >();

  for (const record of records) {
    const time = Date.parse(record.date);
    if (!Number.isFinite(time)) continue;
    const age = nowMs - time;
    if (age < 0 || age > windowMs * 2) continue;
    const muscle = normalizeMuscle(record.muscle);
    if (!muscle) continue;
    const bucket = acc.get(muscle) ?? { current: 0, previous: 0, currentBest: 0, previousBest: 0 };
    const e1rm =
      record.weightKg > 0 && record.reps > 0 ? estimate1rm(record.weightKg, record.reps) : 0;
    if (age <= windowMs) {
      bucket.current += 1;
      bucket.currentBest = Math.max(bucket.currentBest, e1rm);
    } else {
      bucket.previous += 1;
      bucket.previousBest = Math.max(bucket.previousBest, e1rm);
    }
    acc.set(muscle, bucket);
  }

  const out: MuscleVolumeMap = {};
  for (const [muscle, bucket] of acc) {
    let trend: MuscleVolume["trend"] = "flat";
    if (bucket.currentBest > 0 && bucket.previousBest > 0) {
      const delta = (bucket.currentBest - bucket.previousBest) / bucket.previousBest;
      trend = delta > 0.02 ? "up" : delta < -0.02 ? "down" : "flat";
    }
    out[muscle] = {
      muscle,
      currentSets: bucket.current,
      previousSets: bucket.previous,
      trend,
      stableWeeks: trend === "down" ? 0 : bucket.previous > 0 ? 1 : 0,
      bestE1rmKg: bucket.currentBest > 0 ? round2(bucket.currentBest) : null,
    };
  }
  return out;
}

export interface MuscleVolumeRecommendation extends VolumeProgressionResult {
  muscle: string;
  currentWeeklySets: number;
  previousWeeklySets: number;
  trend: "up" | "flat" | "down";
}

/** Feeds real weekly direct sets into the guarded volume-progression rules. */
export function volumeRecommendationForMuscle(input: {
  muscle: string;
  volume: MuscleVolumeMap;
  averageReadiness?: number | null;
}): MuscleVolumeRecommendation {
  const muscle = normalizeMuscle(input.muscle);
  const row =
    input.volume[muscle] ??
    ({
      muscle,
      currentSets: 0,
      previousSets: 0,
      trend: "flat",
      stableWeeks: 0,
      bestE1rmKg: null,
    } satisfies MuscleVolume);
  const result = volumeProgression({
    currentWeeklySets: row.currentSets,
    stableWeeks: row.stableWeeks,
    performanceTrend: row.trend,
    ...(input.averageReadiness == null ? {} : { averageReadiness: input.averageReadiness }),
  });
  return {
    ...result,
    muscle,
    currentWeeklySets: row.currentSets,
    previousWeeklySets: row.previousSets,
    trend: row.trend,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Real exercise pairing and grouping                                      */
/* -------------------------------------------------------------------------- */

export interface MovementCandidate {
  id: string;
  name: string;
  muscle: string;
  equipment?: string | null;
  /**
   * Where the movement came from. Movements already in the live session always
   * outrank library movements of equal anatomical/method rank.
   */
  source?: "session" | "library";
}

/** Opposing-muscle map used for antagonist pairing, in preference order. */
const ANTAGONISTS: Record<string, readonly string[]> = {
  chest: ["back", "lats", "upper back", "rear delts"],
  back: ["chest", "shoulders"],
  lats: ["chest", "shoulders"],
  "upper back": ["chest"],
  biceps: ["triceps"],
  triceps: ["biceps"],
  quads: ["hamstrings", "glutes"],
  hamstrings: ["quads"],
  glutes: ["quads"],
  shoulders: ["lats", "back"],
  "rear delts": ["chest"],
  calves: ["hamstrings"],
  abs: ["back"],
  forearms: ["biceps"],
};

const ISOLATION_TYPES: readonly ExerciseType[] = [
  "cable-isolation",
  "machine-isolation",
  "dumbbell-isolation",
];

/** Small areas that may be staggered between main-lift rest periods. */
const STAGGER_MUSCLES = ["calves", "abs", "forearms", "rear delts"];
/** Areas that never interfere with a main lift's grip or pressing capacity. */
const NON_INTERFERING_STAGGER = ["calves", "abs"];

const PULL_MUSCLES = new Set([
  "back",
  "lats",
  "upper back",
  "traps",
  "rear delts",
  "biceps",
  "forearms",
]);
const PUSH_MUSCLES = new Set(["chest", "shoulders", "triceps"]);

function typeOf(candidate: MovementCandidate): ExerciseType {
  return classifyExerciseType({ name: candidate.name, equipment: candidate.equipment ?? null });
}

/** Session movements rank ahead of library movements; name is the tie breaker. */
function sourceRank(candidate: MovementCandidate): number {
  return candidate.source === "library" ? 1 : 0;
}

/**
 * Deterministic ordering used by every candidate helper: source priority first
 * (in-session before library), alphabetical only inside equal priority.
 */
function byName(a: MovementCandidate, b: MovementCandidate) {
  return sourceRank(a) - sourceRank(b) || a.name.localeCompare(b.name);
}

/** True when a method's allow/disallow type gates accept this movement. */
export function methodAllowsCandidate(methodId: string, candidate: MovementCandidate): boolean {
  const method = getMethod(methodId);
  if (!method) return false;
  const type = typeOf(candidate);
  return (
    method.allowedExerciseTypes.includes(type) && !method.disallowedExerciseTypes.includes(type)
  );
}

/**
 * Compatible antagonist partners, best first. High-risk axial barbell lifts are
 * excluded on BOTH sides: a loaded-spine lift is never a superset partner and
 * never hosts one, even when the other half of the pair looks harmless.
 */
export function antagonistPartnerCandidates(
  primary: MovementCandidate,
  candidates: readonly MovementCandidate[],
): MovementCandidate[] {
  if (isHighRiskLift(typeOf(primary))) return [];
  if (!methodAllowsCandidate("antagonist-supersets", primary)) return [];
  const wanted = ANTAGONISTS[normalizeMuscle(primary.muscle)] ?? [];
  const rank = new Map(wanted.map((muscle, index) => [muscle, index]));
  return candidates
    .filter((c) => c.id !== primary.id)
    .filter((c) => !isHighRiskLift(typeOf(c)))
    .filter((c) => methodAllowsCandidate("antagonist-supersets", c))
    .filter((c) => rank.has(normalizeMuscle(c.muscle)))
    .sort(
      (a, b) =>
        (rank.get(normalizeMuscle(a.muscle)) ?? 99) - (rank.get(normalizeMuscle(b.muscle)) ?? 99) ||
        byName(a, b),
    );
}

/** Picks a genuine opposing-pattern partner, or null when none is safe. */
export function selectAntagonistPartner(
  primary: MovementCandidate,
  candidates: readonly MovementCandidate[],
): MovementCandidate | null {
  return antagonistPartnerCandidates(primary, candidates)[0] ?? null;
}

/**
 * Returns the interference reason blocking a staggered pairing, or null when the
 * pairing is genuinely non-interfering.
 */
export function staggerInterference(primaryMuscle: string, staggerMuscle: string): string | null {
  const primary = normalizeMuscle(primaryMuscle);
  const stagger = normalizeMuscle(staggerMuscle);
  if (!stagger) return "Unknown muscle.";
  if (primary === stagger) return "Same muscle — that is direct volume, not a staggered set.";
  if (stagger === "forearms" && PULL_MUSCLES.has(primary))
    return "Grip and forearm work compromises rows, pull-ups and grip-limited pulls.";
  if (stagger === "biceps" && PULL_MUSCLES.has(primary))
    return "Biceps work interferes with pulling.";
  if (stagger === "triceps" && PUSH_MUSCLES.has(primary))
    return "Triceps work interferes with pressing.";
  if (stagger === "shoulders" && PUSH_MUSCLES.has(primary))
    return "Shoulder work interferes with pressing.";
  if (stagger === "rear delts" && PULL_MUSCLES.has(primary))
    return "Rear-delt work is compromised by pulling fatigue.";
  if (!STAGGER_MUSCLES.includes(stagger))
    return "Only small non-interfering areas can be staggered into main-lift rests.";
  return null;
}

/** Same-primary-muscle isolation movements that may pre-exhaust a compound. */
export function preExhaustCandidates(
  primary: MovementCandidate,
  candidates: readonly MovementCandidate[],
): MovementCandidate[] {
  if (!methodAllowsCandidate("pre-exhaust", primary)) return [];
  // A pre-exhaust needs a compound to follow it; isolation primaries are staggered instead.
  if (ISOLATION_TYPES.includes(typeOf(primary))) return [];
  const muscle = normalizeMuscle(primary.muscle);
  return candidates
    .filter((c) => c.id !== primary.id)
    .filter((c) => normalizeMuscle(c.muscle) === muscle && ISOLATION_TYPES.includes(typeOf(c)))
    .sort(byName);
}

/** Small, non-interfering isolation work that may be staggered into the rests. */
export function staggerCandidates(
  primary: MovementCandidate,
  candidates: readonly MovementCandidate[],
): MovementCandidate[] {
  return candidates
    .filter((c) => c.id !== primary.id)
    .filter((c) => ISOLATION_TYPES.includes(typeOf(c)))
    .filter((c) => staggerInterference(primary.muscle, c.muscle) === null)
    .sort((a, b) => {
      const aSafe = NON_INTERFERING_STAGGER.includes(normalizeMuscle(a.muscle)) ? 0 : 1;
      const bSafe = NON_INTERFERING_STAGGER.includes(normalizeMuscle(b.muscle)) ? 0 : 1;
      return aSafe - bSafe || byName(a, b);
    });
}

export interface PreExhaustPlan {
  kind: "pre-exhaust" | "staggered";
  first: MovementCandidate;
  second: MovementCandidate;
  instructions: string[];
}

/** Builds pre-exhaust instruction lines for a resolved pairing. */
export function preExhaustInstructions(input: {
  kind: "pre-exhaust" | "staggered";
  primaryName: string;
  partnerName: string;
}): string[] {
  return input.kind === "pre-exhaust"
    ? [
        `Pre-exhaust: ${input.partnerName} for 10-12 reps at RIR 1-2`,
        `Then ${input.primaryName} — expect a lower load, that is the point`,
      ]
    : [
        `Main work: ${input.primaryName} as prescribed`,
        `Stagger ${input.partnerName} into each rest period — non-interfering area only`,
      ];
}

/**
 * Pre-exhaust = same-muscle isolation immediately before the compound.
 * Staggered = a non-interfering small area filled into the main-lift rests.
 */
export function selectPreExhaustPlan(
  primary: MovementCandidate,
  candidates: readonly MovementCandidate[],
): PreExhaustPlan | null {
  const isolation = preExhaustCandidates(primary, candidates)[0];
  if (isolation) {
    return {
      kind: "pre-exhaust",
      first: isolation,
      second: primary,
      instructions: preExhaustInstructions({
        kind: "pre-exhaust",
        primaryName: primary.name,
        partnerName: isolation.name,
      }),
    };
  }
  const stagger = staggerCandidates(primary, candidates)[0];
  if (stagger) {
    return {
      kind: "staggered",
      first: primary,
      second: stagger,
      instructions: preExhaustInstructions({
        kind: "staggered",
        primaryName: primary.name,
        partnerName: stagger.name,
      }),
    };
  }
  return null;
}

export interface CircuitGroup {
  methodId: "trisets" | "giant-sets";
  stations: MovementCandidate[];
  rounds: number;
}

export const CIRCUIT_STATION_TARGET = { trisets: 3, "giant-sets": 4 } as const;
export const CIRCUIT_STATION_MAX = { trisets: 3, "giant-sets": 5 } as const;

/** Compatible extra stations for a triset/giant set, in deterministic order. */
export function stationCandidates(input: {
  methodId: "trisets" | "giant-sets";
  primary: MovementCandidate;
  candidates: readonly MovementCandidate[];
}): MovementCandidate[] {
  if (!methodAllowsCandidate(input.methodId, input.primary)) return [];
  const region = new Set<string>([
    normalizeMuscle(input.primary.muscle),
    ...(ANTAGONISTS[normalizeMuscle(input.primary.muscle)] ?? []),
  ]);
  return input.candidates
    .filter((c) => c.id !== input.primary.id)
    .filter((c) => methodAllowsCandidate(input.methodId, c))
    .filter((c) => region.has(normalizeMuscle(c.muscle)))
    .sort(byName);
}

/**
 * Builds a real triset (exactly 3 movements) or giant set (4-5 movements, 4 by
 * default) from movements the athlete actually has. Returns null when there are
 * not enough compatible safe stations — a station is never invented.
 */
export function selectCircuitGroup(input: {
  methodId: "trisets" | "giant-sets";
  primary: MovementCandidate;
  candidates: readonly MovementCandidate[];
  /** 4 or 5 for giant sets; ignored for trisets. */
  desiredStations?: number;
}): CircuitGroup | null {
  const target = CIRCUIT_STATION_TARGET[input.methodId];
  const max = CIRCUIT_STATION_MAX[input.methodId];
  const wanted =
    input.methodId === "giant-sets"
      ? Math.min(max, Math.max(target, Math.round(input.desiredStations ?? target)))
      : target;
  const pool = stationCandidates(input);
  if (!methodAllowsCandidate(input.methodId, input.primary)) return null;
  const stations = [input.primary, ...pool.slice(0, wanted - 1)];
  if (stations.length < target) return null;

  return {
    methodId: input.methodId,
    stations: stations.slice(0, wanted),
    rounds: input.methodId === "giant-sets" ? 3 : 4,
  };
}

/** Total stations a circuit method runs, primary included. */
export function circuitStationCount(
  methodId: "trisets" | "giant-sets",
  desiredStations?: number,
): number {
  const target = CIRCUIT_STATION_TARGET[methodId];
  if (methodId === "trisets") return target;
  const max = CIRCUIT_STATION_MAX[methodId];
  return Math.min(max, Math.max(target, Math.round(desiredStations ?? target)));
}

export interface CircuitSlots {
  methodId: "trisets" | "giant-sets";
  /** Total slots including the fixed primary at index 0. */
  total: number;
  /** Station ids, index 0 is always the primary; null marks an empty slot. */
  stationIds: (string | null)[];
  stationNames: (string | null)[];
  /** True only when every slot holds a distinct real movement. */
  complete: boolean;
}

/**
 * Explicit station slots for the manual editor. The primary is pinned to slot 1
 * and can never be toggled out, so a triset can never shrink below three.
 */
export function circuitSlots(input: {
  methodId: "trisets" | "giant-sets";
  primary: MovementCandidate;
  stationIds?: readonly string[];
  stationNames?: readonly string[];
  desiredStations?: number;
}): CircuitSlots {
  const total = circuitStationCount(input.methodId, input.desiredStations);
  const ids: (string | null)[] = [input.primary.id];
  const names: (string | null)[] = [input.primary.name];
  const takenIds = new Set([input.primary.id]);
  const storedIds = (input.stationIds ?? []).filter((id) => id !== input.primary.id);
  const storedNames = (input.stationNames ?? []).filter((name) => name !== input.primary.name);
  for (let slot = 1; slot < total; slot += 1) {
    const id = storedIds[slot - 1] ?? null;
    if (id && !takenIds.has(id)) {
      takenIds.add(id);
      ids.push(id);
      names.push(storedNames[slot - 1] ?? null);
    } else {
      ids.push(null);
      names.push(null);
    }
  }
  return {
    methodId: input.methodId,
    total,
    stationIds: ids,
    stationNames: names,
    complete: ids.every((id) => Boolean(id)) && names.every((n) => Boolean(n)),
  };
}

/**
 * Replaces exactly one station slot. Slot 0 (the primary) is immutable, the
 * group size never changes, and a movement is never duplicated across stations.
 */
export function replaceCircuitStation(input: {
  methodId: "trisets" | "giant-sets";
  primary: MovementCandidate;
  stationIds?: readonly string[];
  stationNames?: readonly string[];
  desiredStations?: number;
  slotIndex: number;
  choice: MovementCandidate;
}): { stationIds: string[]; stationNames: string[]; complete: boolean; reason: string | null } {
  const slots = circuitSlots(input);
  const asResult = (reason: string | null) => ({
    stationIds: slots.stationIds.filter((id): id is string => Boolean(id)),
    stationNames: slots.stationNames.filter((n): n is string => Boolean(n)),
    complete: slots.complete,
    reason,
  });
  if (input.slotIndex <= 0 || input.slotIndex >= slots.total) {
    return asResult("Station 1 is the primary movement and cannot be replaced here.");
  }
  if (input.choice.id === input.primary.id) {
    return asResult("The primary movement already occupies station 1.");
  }
  if (!methodAllowsCandidate(input.methodId, input.choice)) {
    return asResult(`${input.choice.name} is not a safe station for this method.`);
  }
  const already = slots.stationIds.findIndex((id) => id === input.choice.id);
  if (already >= 0 && already !== input.slotIndex) {
    return asResult(`${input.choice.name} already holds station ${already + 1}.`);
  }
  const ids = [...slots.stationIds];
  const names = [...slots.stationNames];
  ids[input.slotIndex] = input.choice.id;
  names[input.slotIndex] = input.choice.name;
  const filledIds = ids.filter((id): id is string => Boolean(id));
  const filledNames = names.filter((n): n is string => Boolean(n));
  const complete = filledIds.length === slots.total && filledNames.length === slots.total;
  return {
    stationIds: filledIds,
    stationNames: filledNames,
    complete,
    reason: complete
      ? null
      : `${slots.total - filledIds.length} station(s) still need a compatible movement.`,
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Method configuration (persisted, validated)                             */
/* -------------------------------------------------------------------------- */

/** Additive, fully optional per-exercise method configuration. */
export interface MethodConfig {
  /** Antagonist superset / pre-exhaust partner. */
  partnerExerciseId?: string;
  partnerName?: string;
  /** Pre-exhaust vs staggered. */
  pairKind?: "pre-exhaust" | "staggered";
  /** Stable grouping key shared by all members of a pair/triset/giant set. */
  groupKey?: string;
  /** Real station names for trisets/giant sets, in execution order. */
  stationNames?: string[];
  /** Real library/session exercise ids for those stations, same order. */
  stationIds?: string[];
  /** True when the athlete chose the partner/stations by hand. */
  userSelected?: boolean;
  /* Heavy + backoff. */
  topSetWeightKg?: number;
  topSetReps?: number;
  backoffSets?: number;
  backoffReps?: number;
  reductionPercent?: number;
  /* Intensification dosing. */
  drops?: number;
  dropPercent?: number;
  miniSets?: number;
  partials?: number;
  eccentricSeconds?: number;
  repsPerCluster?: number;
  /** IronDesk Black window this exercise belongs to. */
  blackWindowId?: string;
}

const numberIn = (value: unknown, low: number, high: number): number | undefined => {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(high, Math.max(low, n));
};

const stringOf = (value: unknown, max = 120): string | undefined => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().slice(0, max);
  return trimmed.length ? trimmed : undefined;
};

/** Validates and bounds a stored config blob. Unknown keys are dropped. */
export function parseMethodConfig(raw: unknown): MethodConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const config: MethodConfig = {};

  const partnerExerciseId = stringOf(r["partnerExerciseId"]);
  if (partnerExerciseId) config.partnerExerciseId = partnerExerciseId;
  const partnerName = stringOf(r["partnerName"]);
  if (partnerName) config.partnerName = partnerName;
  if (r["pairKind"] === "pre-exhaust" || r["pairKind"] === "staggered")
    config.pairKind = r["pairKind"];
  const groupKey = stringOf(r["groupKey"], 64);
  if (groupKey) config.groupKey = groupKey;
  if (Array.isArray(r["stationNames"])) {
    const names = r["stationNames"]
      .map((n) => stringOf(n))
      .filter((n): n is string => Boolean(n))
      .slice(0, 5);
    if (names.length) config.stationNames = names;
  }
  if (Array.isArray(r["stationIds"])) {
    const ids = r["stationIds"]
      .map((n) => stringOf(n, 64))
      .filter((n): n is string => Boolean(n))
      .slice(0, 5);
    if (ids.length) config.stationIds = ids;
  }
  if (r["userSelected"] === true) config.userSelected = true;

  const topSetWeightKg = numberIn(r["topSetWeightKg"], 0, 1000);
  if (topSetWeightKg != null) config.topSetWeightKg = round2(topSetWeightKg);
  const topSetReps = numberIn(r["topSetReps"], 4, 7);
  if (topSetReps != null) config.topSetReps = Math.round(topSetReps);
  const backoffSets = numberIn(r["backoffSets"], 1, 4);
  if (backoffSets != null) config.backoffSets = Math.round(backoffSets);
  const backoffReps = numberIn(r["backoffReps"], 8, 15);
  if (backoffReps != null) config.backoffReps = Math.round(backoffReps);
  const reductionPercent = numberIn(r["reductionPercent"], 10, 25);
  if (reductionPercent != null) config.reductionPercent = Math.round(reductionPercent);

  const drops = numberIn(r["drops"], 1, 3);
  if (drops != null) config.drops = Math.round(drops);
  const dropPercent = numberIn(r["dropPercent"], 15, 30);
  if (dropPercent != null) config.dropPercent = Math.round(dropPercent);
  const miniSets = numberIn(r["miniSets"], 1, 3);
  if (miniSets != null) config.miniSets = Math.round(miniSets);
  const partials = numberIn(r["partials"], 3, 8);
  if (partials != null) config.partials = Math.round(partials);
  const eccentricSeconds = numberIn(r["eccentricSeconds"], 3, 5);
  if (eccentricSeconds != null) config.eccentricSeconds = Math.round(eccentricSeconds);
  const repsPerCluster = numberIn(r["repsPerCluster"], 2, 5);
  if (repsPerCluster != null) config.repsPerCluster = Math.round(repsPerCluster);

  const blackWindowId = stringOf(r["blackWindowId"], 64);
  if (blackWindowId) config.blackWindowId = blackWindowId;
  return config;
}

/** Serializes a config for storage, dropping undefined keys. */
export function serializeMethodConfig(config: MethodConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(parseMethodConfig(config))) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* 4. Executable set structures                                               */
/* -------------------------------------------------------------------------- */

/** Persisted segment identity written to `workout_sets.method_segment_config`. */
export interface MethodSegmentConfig {
  /** Method the segment belongs to. */
  methodId?: string;
  /** Prescribed rest before/after this segment, seconds. */
  restSeconds?: number;
  /** Prescribed lowering tempo, seconds, when the method controls the eccentric. */
  eccentricSeconds?: number;
  /** Percentage reduction versus the reference load, when one applies. */
  reductionPercent?: number;
  /** Target reps in reserve for this segment. */
  targetRir?: number;
  /** Stop rule shown on the row. */
  stopRule?: string;
  /** IronDesk Black window this segment belongs to. */
  blackWindowId?: string;
}

export interface MethodSetRow {
  weightKg: number | null;
  reps: number | null;
  /** Short execution label shown on the row, e.g. "Top set · RIR 1". */
  label: string;
  restSeconds?: number;
  /** Stable persisted segment identity, e.g. "top-set", "drop-2". */
  segment?: string;
  /** Persisted per-segment guidance. */
  segmentConfig?: MethodSegmentConfig;
}

/** Validates and bounds a stored segment config blob. Unknown keys are dropped. */
export function parseMethodSegmentConfig(raw: unknown): MethodSegmentConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: MethodSegmentConfig = {};
  const methodId = stringOf(r["methodId"], 64);
  if (methodId) out.methodId = methodId;
  const restSeconds = numberIn(r["restSeconds"], 0, 3600);
  if (restSeconds != null) out.restSeconds = Math.round(restSeconds);
  const eccentricSeconds = numberIn(r["eccentricSeconds"], 1, 10);
  if (eccentricSeconds != null) out.eccentricSeconds = Math.round(eccentricSeconds);
  const reductionPercent = numberIn(r["reductionPercent"], 0, 60);
  if (reductionPercent != null) out.reductionPercent = Math.round(reductionPercent);
  const targetRir = numberIn(r["targetRir"], 0, 5);
  if (targetRir != null) out.targetRir = Math.round(targetRir);
  const stopRule = stringOf(r["stopRule"], 160);
  if (stopRule) out.stopRule = stopRule;
  const blackWindowId = stringOf(r["blackWindowId"], 64);
  if (blackWindowId) out.blackWindowId = blackWindowId;
  return out;
}

/** Serializes a segment config for storage, dropping undefined keys. */
export function serializeMethodSegmentConfig(config: MethodSegmentConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(parseMethodSegmentConfig(config))) as Record<string, unknown>;
}

/**
 * Rest countdown for a completed set. The persisted method segment wins because
 * it is the prescribed rest for that exact segment — 0 means zero rest and is
 * never treated as "missing".
 */
export function restSecondsForCompletedSet(input: {
  /** Raw persisted `workout_sets.method_segment_config`. */
  segmentConfig?: unknown;
  /** Exercise/template prescribed rest, when the session came from one. */
  exerciseRestSeconds?: number | null;
  fallbackSeconds?: number;
}): number {
  const segment = parseMethodSegmentConfig(input.segmentConfig);
  if (segment.restSeconds != null) return segment.restSeconds;
  if (input.exerciseRestSeconds != null && Number.isFinite(input.exerciseRestSeconds))
    return Math.max(0, Math.round(input.exerciseRestSeconds));
  return input.fallbackSeconds ?? 120;
}

/**
 * Validated scalar defaults materialized when a method is attached to a
 * template, so an inherited method never arrives with an empty dosing config.
 * Pairing/grouping methods return {} — their real partner/stations are resolved
 * against genuine movements at session hydration.
 */
export function defaultMethodConfigFor(methodId: string): MethodConfig {
  switch (methodId) {
    case "heavy-backoff":
      return { topSetReps: 5, backoffSets: 2, backoffReps: 10, reductionPercent: 15 };
    case "drop-sets":
      return { drops: 2, dropPercent: 20 };
    case "rest-pause":
      return { miniSets: 2 };
    case "lengthened-partials":
      return { partials: 5 };
    case "eccentric-emphasis":
      return { eccentricSeconds: 3 };
    case "cluster-sets":
      return { repsPerCluster: 3 };
    default:
      return {};
  }
}

/** Methods whose execution requires a real partner or real station list. */
export const PAIRING_METHOD_IDS: readonly string[] = [
  "antagonist-supersets",
  "pre-exhaust",
  "trisets",
  "giant-sets",
];

/** True when an inherited pairing/grouping method still has no real movements. */
export function methodConfigNeedsResolution(methodId: string, config: MethodConfig): boolean {
  if (!PAIRING_METHOD_IDS.includes(methodId)) return false;
  if (methodId === "trisets" || methodId === "giant-sets")
    return (config.stationIds?.length ?? 0) < CIRCUIT_STATION_TARGET[methodId];
  return !config.partnerExerciseId;
}

/** Bounded segment identity used for `workout_sets.method_segment`. */
export function normalizeSegmentId(value: unknown): string | null {
  const raw = stringOf(value, 48);
  if (!raw) return null;
  const clean = raw.toLowerCase().replace(/[^a-z0-9:_-]/g, "-");
  return clean.length ? clean : null;
}

export interface MethodSetPlan {
  methodId: string;
  rows: MethodSetRow[];
  explanation: string;
}

/**
 * Turns a selected method + config into the actual set rows an active workout
 * should prefill. Returns null for methods that do not change set structure.
 * Every row remains editable by the athlete.
 */
export function methodSetPlan(input: {
  methodId: string;
  config: MethodConfig;
  /** Best current working weight for this movement, kg. */
  workingWeightKg: number | null;
  /** Planned working sets in the slot. */
  plannedSets: number;
  /** Target reps for a normal working set. */
  targetReps: number;
  /** Plate increment in pounds, when the athlete trains in pounds. */
  incrementLb?: number;
}): MethodSetPlan | null {
  const weight = input.workingWeightKg;
  const reps = Math.max(1, Math.round(input.targetReps || 8));
  const config = input.config;

  switch (input.methodId) {
    case "heavy-backoff": {
      const top = config.topSetWeightKg ?? weight;
      if (top == null || top <= 0) return null;
      const plan = heavyBackoffPlan({
        topSetWeightKg: top,
        ...(config.topSetReps == null ? {} : { topSetReps: config.topSetReps }),
        backoffSets: config.backoffSets ?? Math.max(1, input.plannedSets - 1),
        ...(config.backoffReps == null ? {} : { backoffReps: config.backoffReps }),
        ...(config.reductionPercent == null ? {} : { reductionPercent: config.reductionPercent }),
        ...(input.incrementLb == null ? {} : { incrementLb: input.incrementLb }),
      });
      return {
        methodId: input.methodId,
        rows: [
          {
            weightKg: plan.topSet.weightKg,
            reps: plan.topSet.reps,
            label: `Top set · RIR ${plan.topSet.targetRir}-2 · never to failure`,
            segment: "top-set",
            segmentConfig: {
              methodId: input.methodId,
              targetRir: plan.topSet.targetRir,
              stopRule: "Stop the top set at RIR 1 — never grind to failure.",
            },
          },
          ...plan.backoffSets.map((s, i) => ({
            weightKg: s.weightKg,
            reps: s.reps,
            label: `Backoff ${i + 1} · −${plan.reductionPercent}%`,
            segment: `backoff-${i + 1}`,
            segmentConfig: {
              methodId: input.methodId,
              reductionPercent: plan.reductionPercent,
              targetRir: 2,
            },
          })),
        ],
        explanation: plan.explanation,
      };
    }
    case "drop-sets": {
      if (weight == null || weight <= 0) return null;
      const drops = config.drops ?? 2;
      const percent = config.dropPercent ?? 20;
      const rows: MethodSetRow[] = [];
      for (let i = 0; i < Math.max(1, input.plannedSets); i += 1) {
        rows.push({
          weightKg: round2(weight),
          reps,
          label: `Working set ${i + 1} · RIR 1-2`,
          segment: `working-${i + 1}`,
          segmentConfig: { methodId: input.methodId, targetRir: 1 },
        });
      }
      let load = weight;
      for (let i = 0; i < drops; i += 1) {
        load = load * (1 - percent / 100);
        rows.push({
          weightKg: round2(load),
          reps: null,
          label: `Drop ${i + 1} · −${percent}% · reps to RIR 0`,
          restSeconds: 0,
          segment: `drop-${i + 1}`,
          segmentConfig: {
            methodId: input.methodId,
            restSeconds: 0,
            reductionPercent: percent,
            targetRir: 0,
            stopRule: "No rest between drops — stop when reps fall below 4.",
          },
        });
      }
      return {
        methodId: input.methodId,
        rows,
        explanation: `Drops attach to the last working set only: ${drops} × −${percent}%.`,
      };
    }
    case "rest-pause": {
      if (weight == null || weight <= 0) return null;
      const miniSets = config.miniSets ?? 2;
      const rows: MethodSetRow[] = [
        {
          weightKg: round2(weight),
          reps,
          label: "Activation set · to RIR 0",
          segment: "activation",
          segmentConfig: { methodId: input.methodId, targetRir: 0 },
        },
      ];
      let expected = Math.max(2, Math.round(reps * 0.4));
      for (let i = 0; i < miniSets; i += 1) {
        rows.push({
          weightKg: round2(weight),
          reps: expected,
          label: `Mini-set ${i + 1} · after 20s rest`,
          restSeconds: 20,
          segment: `mini-${i + 1}`,
          segmentConfig: {
            methodId: input.methodId,
            restSeconds: 20,
            targetRir: 0,
            stopRule: "Stop when a mini-set falls below 2 reps.",
          },
        });
        expected = Math.max(2, expected - 1);
      }
      return {
        methodId: input.methodId,
        rows,
        explanation: "Same working load throughout. Stop when a mini-set falls below 2 reps.",
      };
    }
    case "cluster-sets": {
      if (weight == null || weight <= 0) return null;
      const perCluster = config.repsPerCluster ?? 3;
      const clusters = Math.max(2, Math.ceil(reps / perCluster));
      return {
        methodId: input.methodId,
        rows: Array.from({ length: clusters }, (_, i) => ({
          weightKg: round2(weight),
          reps: perCluster,
          label: `Cluster ${i + 1} · 20s intra-set rest`,
          restSeconds: 20,
          segment: `cluster-${i + 1}`,
          segmentConfig: {
            methodId: input.methodId,
            restSeconds: 20,
            stopRule: "End the set when bar speed drops.",
          },
        })),
        explanation: `${clusters} clusters of ${perCluster} reps at one load — end the set when speed drops.`,
      };
    }
    case "lengthened-partials": {
      if (weight == null || weight <= 0) return null;
      const partials = config.partials ?? 5;
      return {
        methodId: input.methodId,
        rows: [
          {
            weightKg: round2(weight),
            reps,
            label: "Full range · RIR 0-1",
            segment: "full-range",
            segmentConfig: { methodId: input.methodId, targetRir: 0 },
          },
          {
            weightKg: round2(weight),
            reps: partials,
            label: "Lengthened partials",
            restSeconds: 0,
            segment: "partials",
            segmentConfig: {
              methodId: input.methodId,
              restSeconds: 0,
              stopRule: "Partials stay in the stretched half of the range.",
            },
          },
        ],
        explanation: "Full-ROM reps first, then partials in the stretched half.",
      };
    }
    case "eccentric-emphasis": {
      if (weight == null || weight <= 0) return null;
      const tempo = config.eccentricSeconds ?? 3;
      const load =
        input.incrementLb && input.incrementLb > 0
          ? roundToPoundIncrementKg(weight * 0.95, input.incrementLb)
          : round2(weight * 0.95);
      return {
        methodId: input.methodId,
        rows: Array.from({ length: Math.max(1, input.plannedSets) }, (_, i) => ({
          weightKg: load,
          reps,
          label: `Set ${i + 1} · ${tempo}s lowering`,
          segment: `eccentric-${i + 1}`,
          segmentConfig: { methodId: input.methodId, eccentricSeconds: tempo },
        })),
        explanation: `Hold a ${tempo}s eccentric at ~95% of your normal working load.`,
      };
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* 5. IronDesk Black specialization windows                                   */
/* -------------------------------------------------------------------------- */

/** Advanced modifiers IronDesk Black may combine — stable stations only. */
export const BLACK_SAFE_MODIFIERS: readonly string[] = [
  "drop-sets",
  "rest-pause",
  "lengthened-partials",
  "eccentric-emphasis",
];

/** Dedicated fatigue budget for a Black block, independent of the session budget. */
export const BLACK_FATIGUE_BUDGET = 8;

export const BLACK_MIN_WEEKS = 2;
export const BLACK_MAX_WEEKS = 3;

/** A fully executable Black prescription for one real exercise. */
export interface BlackExercisePrescription {
  exerciseId: string;
  exerciseName: string;
  /** Assigned safe modifier from the allowlist. */
  modifierId: string;
  modifierName: string;
  /** Working-load basis: percentage of the athlete's normal working load. */
  loadPercent: number;
  /** Resolved load in kg when a working weight is known. */
  loadKg: number | null;
  sets: number;
  reps: number;
  /** Extra structure the modifier adds to the final working set. */
  structure: {
    drops?: number;
    dropPercent?: number;
    miniSets?: number;
    partials?: number;
    eccentricSeconds?: number;
  };
  /** Rest inside the intensified set, seconds. */
  intraSetRestSeconds: number;
  /** Rest between working sets, seconds. */
  interSetRestSeconds: number;
  expectedRir: number;
  stopRule: string;
}

export interface BlackWindow {
  id: string;
  targetRegion: string;
  startedOn: string;
  endsOn: string;
  status: "active" | "suspended" | "completed" | "cancelled" | "expired";
  modifierIds: string[];
  exerciseNames: string[];
  /** Persisted executable prescriptions, one per assigned exercise. */
  prescriptions: BlackExercisePrescription[];
}

export interface BlackEligibility {
  allowed: boolean;
  reasons: string[];
}

/**
 * The current Black window is the one that is still the athlete's live block:
 * active OR suspended. Suspended is a paused current window, not history.
 */
export function isBlackWindowOpen(status: BlackWindow["status"]): boolean {
  return status === "active" || status === "suspended";
}

/** The athlete's current Black window (active or suspended), when any. */
export function currentBlackWindow(windows: readonly BlackWindow[]): BlackWindow | null {
  return windows.find((w) => isBlackWindowOpen(w.status)) ?? null;
}

/** A Black block requires expert experience, consistency and real recovery. */
export function canOpenBlackWindow(
  profile: AthleteMethodProfile,
  openWindows: readonly BlackWindow[] = [],
): BlackEligibility {
  const reasons: string[] = [];
  if (profile.experience !== "expert")
    reasons.push("IronDesk Black requires expert-level training history.");
  if (profile.sessionsLast28Days < 12)
    reasons.push("Requires at least 12 logged sessions in the last 28 days.");
  if (profile.averageReadiness != null && profile.averageReadiness < 65)
    reasons.push("Recent readiness must average 65 or better.");
  const current = currentBlackWindow(openWindows);
  if (current)
    reasons.push(
      current.status === "suspended"
        ? "A suspended specialization window is still current — resume or end it first."
        : "Close the open specialization window before starting another.",
    );
  return { allowed: reasons.length === 0, reasons };
}

export interface BlackBlockPlan {
  targetRegion: string;
  weeks: number;
  startedOn: string;
  endsOn: string;
  modifierIds: string[];
  exercises: MovementCandidate[];
  /** Fatigue cost of the combined modifiers. */
  fatigue: number;
  /** Executable per-exercise prescriptions. */
  prescriptions: BlackExercisePrescription[];
  sequence: string[];
}

/** ISO week start (Monday) used for the one-exposure-per-region-per-week rule. */
export function blackWeekStart(date: Date | string): string {
  const d = typeof date === "string" ? new Date(`${date}T00:00:00.000Z`) : date;
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const isoDay = new Date(utc).getUTCDay() || 7;
  return new Date(utc - (isoDay - 1) * DAY_MS).toISOString().slice(0, 10);
}

export interface BlackExposure {
  targetRegion: string;
  weekStart: string;
}

/**
 * Enforces one Black exposure per target region per week. A second exposure in
 * the same ISO week for the same region is refused with the reason.
 */
export function canRecordBlackExposure(input: {
  targetRegion: string;
  date: Date | string;
  existing: readonly BlackExposure[];
}): { allowed: boolean; reason: string | null; weekStart: string } {
  const region = normalizeMuscle(input.targetRegion);
  const weekStart = blackWeekStart(input.date);
  const clash = input.existing.some(
    (e) => normalizeMuscle(e.targetRegion) === region && e.weekStart === weekStart,
  );
  return {
    allowed: !clash,
    reason: clash
      ? `${region} already had its Black exposure in the week of ${weekStart} — one per region per week.`
      : null,
    weekStart,
  };
}

/**
 * Commits every verified Black method/set write before recording the weekly
 * exposure. This is the fail-safe fallback when no database RPC can atomically
 * apply the whole client-composed block: any rejected write stops the sequence
 * and `recordExposure` is never called.
 */
export async function commitBlackApplication<T>(input: {
  targets: readonly T[];
  writeTarget: (target: T) => Promise<void>;
  recordExposure: () => Promise<void>;
}): Promise<void> {
  for (const target of input.targets) await input.writeTarget(target);
  await input.recordExposure();
}

const BLACK_MODIFIER_STRUCTURE: Record<
  string,
  {
    structure: BlackExercisePrescription["structure"];
    intraSetRestSeconds: number;
    loadPercent: number;
    stopRule: string;
  }
> = {
  "drop-sets": {
    structure: { drops: 2, dropPercent: 20 },
    intraSetRestSeconds: 0,
    loadPercent: 100,
    stopRule: "Stop the block set when a drop yields fewer than 4 reps.",
  },
  "rest-pause": {
    structure: { miniSets: 2 },
    intraSetRestSeconds: 20,
    loadPercent: 100,
    stopRule: "Stop when a mini-set falls below 2 reps.",
  },
  "lengthened-partials": {
    structure: { partials: 5 },
    intraSetRestSeconds: 0,
    loadPercent: 95,
    stopRule: "Partials stay in the stretched half — stop if the range collapses.",
  },
  "eccentric-emphasis": {
    structure: { eccentricSeconds: 4 },
    intraSetRestSeconds: 0,
    loadPercent: 95,
    stopRule: "Stop when you can no longer control the 4s lowering.",
  },
};

/** Loaded compound classes: failure work is never prescribed on these. */
const BLACK_COMPOUND_TYPES: readonly ExerciseType[] = [
  "barbell-compound-axial",
  "barbell-compound",
  "dumbbell-compound",
  "machine-compound",
];

/**
 * The only modifier Black hosts on a loaded compound: a controlled eccentric.
 * Drops, rest-pause and lengthened partials are failure-demanding and stay on
 * stable isolation stations.
 */
const BLACK_COMPOUND_MODIFIERS: readonly string[] = ["eccentric-emphasis"];

/**
 * True when a Black modifier may actually be hosted by this exercise. The
 * modifier's own allowed/disallowed exercise gates are enforced here, so an
 * ordering accident can never place drop sets on a dumbbell compound.
 */
export function blackModifierAllowsExercise(
  modifierId: string,
  candidate: MovementCandidate,
): boolean {
  if (!BLACK_SAFE_MODIFIERS.includes(modifierId)) return false;
  const type = typeOf(candidate);
  if (isHighRiskLift(type)) return false;
  const black = getMethod("irondesk-black");
  if (!black) return false;
  if (!black.allowedExerciseTypes.includes(type) || black.disallowedExerciseTypes.includes(type))
    return false;
  if (!methodAllowsCandidate(modifierId, candidate)) return false;
  if (BLACK_COMPOUND_TYPES.includes(type)) return BLACK_COMPOUND_MODIFIERS.includes(modifierId);
  return true;
}

/** RIR 0 only on safe stable isolation; loaded compounds always keep a rep back. */
export function blackExpectedRir(candidate: MovementCandidate, modifierId: string): number {
  const type = typeOf(candidate);
  if (BLACK_COMPOUND_TYPES.includes(type)) return 1;
  if (!ISOLATION_TYPES.includes(type)) return 1;
  return getMethod(modifierId)?.canUseFailure ? 0 : 1;
}

export interface BlackPlanResult {
  plan: BlackBlockPlan | null;
  /** Why no safe exact-two-modifier block could be built. */
  reason: string | null;
}

/**
 * Builds a real Black block: 2-3 weeks, one target region, stable safe
 * exercises, and exactly two compatible modifiers from the safe allowlist
 * within the dedicated fatigue budget. Compatible exercise/modifier pairings are
 * resolved first; the modifier pair is then chosen from what the real movements
 * can actually host. Returns a reason instead of a plan when none is safe.
 */
export function planBlackBlockResult(input: {
  targetRegion: string;
  candidates: readonly MovementCandidate[];
  weeks?: number;
  startedOn?: string;
  preferredModifiers?: readonly string[];
  /** Known working weights in kg, keyed by exercise id. */
  workingWeightKgByExerciseId?: Record<string, number | null>;
  /** Default working reps for the block. */
  targetReps?: number;
}): BlackPlanResult {
  const region = normalizeMuscle(input.targetRegion);
  const weeks = Math.min(BLACK_MAX_WEEKS, Math.max(BLACK_MIN_WEEKS, input.weeks ?? 2));
  const black = getMethod("irondesk-black");
  if (!black) return { plan: null, reason: "IronDesk Black is unavailable." };

  const safeExercises = input.candidates
    .filter((c) => normalizeMuscle(c.muscle) === region)
    .filter((c) => {
      const type = typeOf(c);
      return (
        black.allowedExerciseTypes.includes(type) && !black.disallowedExerciseTypes.includes(type)
      );
    })
    .sort(byName)
    .slice(0, 3);
  if (safeExercises.length < 2)
    return {
      plan: null,
      reason: `Fewer than two stable ${region} movements are safe for a Black block — add machine or cable work first.`,
    };

  // Modifier pairs are explored in allowlist order, honouring any preference.
  const preferred = (input.preferredModifiers ?? []).filter((id) =>
    BLACK_SAFE_MODIFIERS.includes(id),
  );
  const order = [...preferred, ...BLACK_SAFE_MODIFIERS.filter((id) => !preferred.includes(id))];

  let chosen: {
    modifiers: [string, string];
    assignment: Map<string, string>;
    fatigue: number;
  } | null = null;
  for (let i = 0; i < order.length && !chosen; i += 1) {
    for (let j = i + 1; j < order.length && !chosen; j += 1) {
      const pair: [string, string] = [order[i]!, order[j]!];
      const fatigue =
        (getMethod(pair[0])?.fatigueCost ?? 0) + (getMethod(pair[1])?.fatigueCost ?? 0);
      if (fatigue > BLACK_FATIGUE_BUDGET) continue;
      const usage = new Map<string, number>(pair.map((id) => [id, 0]));
      const assignment = new Map<string, string>();
      for (const exercise of safeExercises) {
        const options = pair.filter((id) => blackModifierAllowsExercise(id, exercise));
        if (!options.length) continue;
        // Spread the two modifiers across the block deterministically.
        const pick = options.reduce((best, id) =>
          (usage.get(id) ?? 0) < (usage.get(best) ?? 0) ? id : best,
        );
        assignment.set(exercise.id, pick);
        usage.set(pick, (usage.get(pick) ?? 0) + 1);
      }
      const bothUsed = pair.every((id) => (usage.get(id) ?? 0) > 0);
      if (assignment.size >= 2 && bothUsed) chosen = { modifiers: pair, assignment, fatigue };
    }
  }
  if (!chosen)
    return {
      plan: null,
      reason: `No safe two-modifier Black combination can be hosted by your ${region} movements — Black needs at least one stable isolation station.`,
    };

  const assignedExercises = safeExercises.filter((e) => chosen!.assignment.has(e.id));
  const start = input.startedOn ?? new Date().toISOString().slice(0, 10);
  const endsOn = new Date(Date.parse(`${start}T00:00:00.000Z`) + weeks * 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const reps = Math.max(4, Math.round(input.targetReps ?? 8));

  const prescriptions: BlackExercisePrescription[] = assignedExercises.map((exercise) => {
    const modifierId = chosen!.assignment.get(exercise.id)!;
    const modifier = getMethod(modifierId)!;
    const shape = BLACK_MODIFIER_STRUCTURE[modifierId]!;
    const working = input.workingWeightKgByExerciseId?.[exercise.id] ?? null;
    const expectedRir = blackExpectedRir(exercise, modifierId);
    return {
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      modifierId,
      modifierName: modifier.displayName,
      loadPercent: shape.loadPercent,
      loadKg: working != null && working > 0 ? round2((working * shape.loadPercent) / 100) : null,
      sets: 3,
      reps,
      structure: shape.structure,
      intraSetRestSeconds: shape.intraSetRestSeconds,
      interSetRestSeconds: 150,
      expectedRir,
      stopRule:
        expectedRir > 0
          ? `${shape.stopRule} Loaded compound — keep ${expectedRir} rep in reserve, never train it to failure.`
          : shape.stopRule,
    };
  });

  const sequence = prescriptions.map(
    (p) =>
      `${p.exerciseName} — ${p.modifierName} on the last working set · ${p.sets}×${p.reps} @ ${p.loadPercent}% · RIR ${p.expectedRir}`,
  );

  return {
    plan: {
      targetRegion: region,
      weeks,
      startedOn: start,
      endsOn,
      modifierIds: [...chosen.modifiers],
      exercises: assignedExercises,
      fatigue: chosen.fatigue,
      prescriptions,
      sequence: [
        ...sequence,
        "One exposure per target region per week — the whole block counts once.",
        `Return to Level 2-4 work (Double Progression or Heavy + Backoff) after ${endsOn}.`,
      ],
    },
    reason: null,
  };
}

/** Convenience wrapper: the plan only, or null when none is safe. */
export function planBlackBlock(
  input: Parameters<typeof planBlackBlockResult>[0],
): BlackBlockPlan | null {
  return planBlackBlockResult(input).plan;
}

/**
 * Turns one persisted Black prescription into real, editable set rows with
 * segment identity, loads, rests and stop rules. Never returns an empty plan.
 */
export function blackSetPlan(input: {
  prescription: BlackExercisePrescription;
  windowId: string;
  /** Fallback working weight when the prescription has no resolved load. */
  workingWeightKg?: number | null;
}): MethodSetPlan {
  const p = input.prescription;
  const base =
    p.loadKg ??
    (input.workingWeightKg != null && input.workingWeightKg > 0
      ? round2((input.workingWeightKg * p.loadPercent) / 100)
      : null);
  const segmentBase: MethodSegmentConfig = {
    methodId: "irondesk-black",
    blackWindowId: input.windowId,
  };
  const rows: MethodSetRow[] = [];

  for (let i = 0; i < p.sets; i += 1) {
    const last = i === p.sets - 1;
    rows.push({
      weightKg: base,
      reps: p.reps,
      label: last
        ? `Black set ${i + 1} · ${p.modifierName} attaches here`
        : `Black set ${i + 1} · ${p.loadPercent}% · RIR ${p.expectedRir}`,
      restSeconds: p.interSetRestSeconds,
      segment: `black-set-${i + 1}`,
      segmentConfig: {
        ...segmentBase,
        restSeconds: p.interSetRestSeconds,
        targetRir: p.expectedRir,
        ...(p.loadPercent === 100 ? {} : { reductionPercent: 100 - p.loadPercent }),
        stopRule: p.stopRule,
      },
    });
  }

  const s = p.structure;
  if (s.drops) {
    let load = base;
    for (let i = 0; i < s.drops; i += 1) {
      load = load == null ? null : round2(load * (1 - (s.dropPercent ?? 20) / 100));
      rows.push({
        weightKg: load,
        reps: null,
        label: `Black drop ${i + 1} · −${s.dropPercent ?? 20}%`,
        restSeconds: p.intraSetRestSeconds,
        segment: `black-drop-${i + 1}`,
        segmentConfig: {
          ...segmentBase,
          restSeconds: p.intraSetRestSeconds,
          reductionPercent: s.dropPercent ?? 20,
          targetRir: 0,
          stopRule: p.stopRule,
        },
      });
    }
  }
  if (s.miniSets) {
    for (let i = 0; i < s.miniSets; i += 1) {
      rows.push({
        weightKg: base,
        reps: Math.max(2, Math.round(p.reps * 0.4) - i),
        label: `Black mini-set ${i + 1} · after ${p.intraSetRestSeconds}s`,
        restSeconds: p.intraSetRestSeconds,
        segment: `black-mini-${i + 1}`,
        segmentConfig: {
          ...segmentBase,
          restSeconds: p.intraSetRestSeconds,
          targetRir: 0,
          stopRule: p.stopRule,
        },
      });
    }
  }
  if (s.partials) {
    rows.push({
      weightKg: base,
      reps: s.partials,
      label: `Black lengthened partials · ${s.partials} reps`,
      restSeconds: p.intraSetRestSeconds,
      segment: "black-partials",
      segmentConfig: { ...segmentBase, restSeconds: p.intraSetRestSeconds, stopRule: p.stopRule },
    });
  }
  if (s.eccentricSeconds) {
    rows.push({
      weightKg: base,
      reps: Math.max(3, Math.round(p.reps * 0.6)),
      label: `Black eccentric finisher · ${s.eccentricSeconds}s lowering`,
      restSeconds: p.interSetRestSeconds,
      segment: "black-eccentric",
      segmentConfig: {
        ...segmentBase,
        eccentricSeconds: s.eccentricSeconds,
        restSeconds: p.interSetRestSeconds,
        stopRule: p.stopRule,
      },
    });
  }

  return {
    methodId: "irondesk-black",
    rows,
    explanation: `${p.exerciseName}: ${p.sets}×${p.reps} at ${p.loadPercent}% with ${p.modifierName} on the final set · ${p.intraSetRestSeconds}s intra-set / ${p.interSetRestSeconds}s between sets · ${p.stopRule}`,
  };
}

/** Validates and bounds a persisted Black prescription list from storage. */
export function parseBlackPrescriptions(raw: unknown): BlackExercisePrescription[] {
  if (!Array.isArray(raw)) return [];
  const out: BlackExercisePrescription[] = [];
  for (const item of raw.slice(0, 5)) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const exerciseId = stringOf(r["exerciseId"], 64);
    const exerciseName = stringOf(r["exerciseName"], 120);
    const modifierId = stringOf(r["modifierId"], 64);
    if (!exerciseId || !exerciseName || !modifierId) continue;
    if (!BLACK_SAFE_MODIFIERS.includes(modifierId)) continue;
    const structureRaw =
      r["structure"] && typeof r["structure"] === "object" && !Array.isArray(r["structure"])
        ? (r["structure"] as Record<string, unknown>)
        : {};
    const structure: BlackExercisePrescription["structure"] = {};
    const drops = numberIn(structureRaw["drops"], 1, 3);
    if (drops != null) structure.drops = Math.round(drops);
    const dropPercent = numberIn(structureRaw["dropPercent"], 10, 30);
    if (dropPercent != null) structure.dropPercent = Math.round(dropPercent);
    const miniSets = numberIn(structureRaw["miniSets"], 1, 3);
    if (miniSets != null) structure.miniSets = Math.round(miniSets);
    const partials = numberIn(structureRaw["partials"], 3, 8);
    if (partials != null) structure.partials = Math.round(partials);
    const eccentricSeconds = numberIn(structureRaw["eccentricSeconds"], 2, 6);
    if (eccentricSeconds != null) structure.eccentricSeconds = Math.round(eccentricSeconds);

    out.push({
      exerciseId,
      exerciseName,
      modifierId,
      modifierName:
        stringOf(r["modifierName"], 120) ?? getMethod(modifierId)?.displayName ?? modifierId,
      loadPercent: Math.round(numberIn(r["loadPercent"], 50, 110) ?? 100),
      loadKg: (() => {
        const load = numberIn(r["loadKg"], 0, 1000);
        return load == null ? null : round2(load);
      })(),
      sets: Math.round(numberIn(r["sets"], 1, 6) ?? 3),
      reps: Math.round(numberIn(r["reps"], 1, 50) ?? 8),
      structure,
      intraSetRestSeconds: Math.round(numberIn(r["intraSetRestSeconds"], 0, 600) ?? 0),
      interSetRestSeconds: Math.round(numberIn(r["interSetRestSeconds"], 0, 900) ?? 150),
      expectedRir: Math.round(numberIn(r["expectedRir"], 0, 4) ?? 0),
      stopRule: stringOf(r["stopRule"], 200) ?? "Stop when execution quality drops.",
    });
  }
  return out;
}

export interface BlackWindowState {
  status: "active" | "suspended" | "expired" | "closed";
  reason: string;
  /** Recommendation shown once the window closes. */
  exitRecommendation: string | null;
  /** False whenever Black sets may not be applied or exposures recorded. */
  canApply: boolean;
  /** What has to come back before a suspended window resumes. */
  resumeRequirement: string | null;
}

/** Suspends the block when readiness or consistency degrades; expires on date. */
export function blackWindowState(input: {
  window: BlackWindow;
  profile: AthleteMethodProfile;
  now?: Date;
}): BlackWindowState {
  const exit =
    "Block complete — return to Double Progression (Level 2) or Heavy + Backoff (Level 4) for at least two weeks.";
  if (input.window.status === "completed" || input.window.status === "cancelled") {
    return {
      status: "closed",
      reason: "Specialization window closed.",
      exitRecommendation: exit,
      canApply: false,
      resumeRequirement: null,
    };
  }
  const now = input.now ?? new Date();
  if (Date.parse(`${input.window.endsOn}T23:59:59.999Z`) < now.getTime()) {
    return {
      status: "expired",
      reason: `Window ended ${input.window.endsOn}.`,
      exitRecommendation: exit,
      canApply: false,
      resumeRequirement: null,
    };
  }
  if (input.profile.averageReadiness != null && input.profile.averageReadiness < 60) {
    return {
      status: "suspended",
      reason: "Readiness dropped below 60 — Black work is paused until recovery returns.",
      exitRecommendation: null,
      canApply: false,
      resumeRequirement: "Bring average readiness back to 60 or better to resume this window.",
    };
  }
  if (input.profile.sessionsLast28Days < 10) {
    return {
      status: "suspended",
      reason: "Sessions have been missed — Black work is paused until consistency returns.",
      exitRecommendation: null,
      canApply: false,
      resumeRequirement: "Log at least 10 sessions in the last 28 days to resume this window.",
    };
  }
  return {
    status: "active",
    reason: `Active until ${input.window.endsOn} · ${input.window.targetRegion} focus.`,
    exitRecommendation: null,
    canApply: true,
    resumeRequirement: null,
  };
}
