/**
 * IronDesk Training Method Registry.
 *
 * Methods are reusable *modifiers* applied to an exercise — not workouts. Each
 * carries eligibility, fatigue cost, evidence grade, safety gates and its own
 * progression notes so the engine can decide what an athlete may run today.
 *
 * Everything here is pure and deterministic: no React, no network, no storage.
 * Loads are canonical kilograms; presentation converts.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type EvidenceGrade = "strong" | "good" | "emerging" | "situational";

export type ExperienceLevel = "beginner" | "intermediate" | "advanced" | "expert";

export type SourceTag = "book-derived" | "modernized" | "research-supported" | "irondesk-original";

/** Coarse movement classes used for method eligibility and safety gating. */
export type ExerciseType =
  | "barbell-compound-axial" // squats, deadlifts, loaded-spine work
  | "barbell-compound" // bench, row, press
  | "dumbbell-compound"
  | "machine-compound"
  | "cable-isolation"
  | "machine-isolation"
  | "dumbbell-isolation"
  | "bodyweight";

export interface Range {
  low: number;
  high: number;
}

export interface TrainingMethod {
  id: string;
  displayName: string;
  /** 1-14. Higher = more advanced, not "better". */
  level: number;
  tier: string;
  description: string;
  /** One-line "what it does" for the selector card. */
  whatItDoes: string;
  /** One-line "when to use it". */
  whenToUse: string;
  evidenceGrade: EvidenceGrade;
  /** 1 (trivial) – 5 (systemically expensive). */
  fatigueCost: 1 | 2 | 3 | 4 | 5;
  /** 1 (very forgiving) – 5 (high technical/injury risk if misapplied). */
  technicalRisk: 1 | 2 | 3 | 4 | 5;
  minimumExperience: ExperienceLevel;
  allowedExerciseTypes: readonly ExerciseType[];
  disallowedExerciseTypes: readonly ExerciseType[];
  recommendedRIR: Range;
  recommendedRepRange: Range;
  typicalRestSeconds: Range;
  canUseFailure: boolean;
  failureGuidance: string;
  /** Hard cap of exposures per week for one muscle group. */
  maxFrequencyPerWeek: number;
  maxFrequencyNote: string;
  safetyNotes: readonly string[];
  progressionNotes: string;
  sourceTags: readonly SourceTag[];
}

const ALL_TYPES: readonly ExerciseType[] = [
  "barbell-compound-axial",
  "barbell-compound",
  "dumbbell-compound",
  "machine-compound",
  "cable-isolation",
  "machine-isolation",
  "dumbbell-isolation",
  "bodyweight",
];

/** Stable, guided movements — safe hosts for high-intensity techniques. */
const STABLE_TYPES: readonly ExerciseType[] = [
  "machine-compound",
  "cable-isolation",
  "machine-isolation",
  "dumbbell-isolation",
];

/* -------------------------------------------------------------------------- */
/* Registry                                                                   */
/* -------------------------------------------------------------------------- */

export const TRAINING_METHODS: readonly TrainingMethod[] = [
  {
    id: "straight-sets",
    displayName: "Straight Sets",
    level: 1,
    tier: "Foundation",
    description:
      "Fixed sets and reps at one load, repeated with full rest until the prescription is complete.",
    whatItDoes: "Builds the base: consistent load exposure with clean technique.",
    whenToUse: "Always available. The default for new movements and new athletes.",
    evidenceGrade: "strong",
    fatigueCost: 1,
    technicalRisk: 1,
    minimumExperience: "beginner",
    allowedExerciseTypes: ALL_TYPES,
    disallowedExerciseTypes: [],
    recommendedRIR: { low: 1, high: 3 },
    recommendedRepRange: { low: 5, high: 15 },
    typicalRestSeconds: { low: 120, high: 210 },
    canUseFailure: false,
    failureGuidance: "Leave 1-3 reps in reserve. Training to failure is not required here.",
    maxFrequencyPerWeek: 6,
    maxFrequencyNote: "No practical cap — this is baseline work.",
    safetyNotes: ["Stop the set when bar speed or position degrades."],
    progressionNotes: "Add load or a rep once every set is completed at the prescribed RIR.",
    sourceTags: ["research-supported"],
  },
  {
    id: "double-progression",
    displayName: "Double Progression",
    level: 2,
    tier: "Build",
    description:
      "Hold a load across a rep range until every working set reaches the top of the range, then add load and return to the low end.",
    whatItDoes: "Turns rep gains into load gains without guessing when to jump.",
    whenToUse: "Default progression for accessories and most hypertrophy work.",
    evidenceGrade: "strong",
    fatigueCost: 1,
    technicalRisk: 1,
    minimumExperience: "beginner",
    allowedExerciseTypes: ALL_TYPES,
    disallowedExerciseTypes: [],
    recommendedRIR: { low: 1, high: 2 },
    recommendedRepRange: { low: 6, high: 15 },
    typicalRestSeconds: { low: 90, high: 180 },
    canUseFailure: false,
    failureGuidance: "Reps only count at the prescribed RIR and with clean form.",
    maxFrequencyPerWeek: 6,
    maxFrequencyNote: "No practical cap.",
    safetyNotes: ["Do not chase the top of the range with degraded technique."],
    progressionNotes:
      "All working sets at the top rep with the required RIR → add one exercise-appropriate increment and drop back to the low rep.",
    sourceTags: ["book-derived", "modernized", "research-supported"],
  },
  {
    id: "volume-progression",
    displayName: "Volume Progression",
    level: 3,
    tier: "Growth",
    description:
      "Increase productive weekly hard sets per muscle in small steps while performance and recovery stay stable.",
    whatItDoes: "Grows weekly stimulus in controlled steps rather than one large jump.",
    whenToUse: "When loads are stable but the muscle needs more weekly work.",
    evidenceGrade: "strong",
    fatigueCost: 2,
    technicalRisk: 1,
    minimumExperience: "beginner",
    allowedExerciseTypes: ALL_TYPES,
    disallowedExerciseTypes: [],
    recommendedRIR: { low: 1, high: 3 },
    recommendedRepRange: { low: 6, high: 20 },
    typicalRestSeconds: { low: 90, high: 180 },
    canUseFailure: false,
    failureGuidance: "Added sets must hold the same RIR target as existing sets.",
    maxFrequencyPerWeek: 6,
    maxFrequencyNote: "Add sets weekly at most; hold when readiness or reps drop.",
    safetyNotes: ["Volume increases stop the moment performance or sleep degrades."],
    progressionNotes:
      "Add 1-2 direct sets per muscle per week, only after a stable week, up to a per-muscle ceiling.",
    sourceTags: ["research-supported"],
  },
  {
    id: "heavy-backoff",
    displayName: "Heavy + Backoff Sets",
    level: 4,
    tier: "Strength Growth",
    description:
      "One heavy top set at 4-7 reps, then backoff sets at a bounded percentage reduction in a higher rep range.",
    whatItDoes: "Trains a heavy exposure and then accumulates quality volume beneath it.",
    whenToUse: "Main lifts when you want strength and size from the same slot.",
    evidenceGrade: "strong",
    fatigueCost: 3,
    technicalRisk: 2,
    minimumExperience: "intermediate",
    allowedExerciseTypes: ALL_TYPES,
    disallowedExerciseTypes: [],
    recommendedRIR: { low: 1, high: 2 },
    recommendedRepRange: { low: 4, high: 15 },
    typicalRestSeconds: { low: 180, high: 300 },
    canUseFailure: false,
    failureGuidance: "The top set stops at RIR 1-2. Never grind the top set to failure.",
    maxFrequencyPerWeek: 2,
    maxFrequencyNote: "At most twice per week per main lift.",
    safetyNotes: ["Heavy top sets require a full warm-up ramp and, when loaded, safety pins."],
    progressionNotes:
      "Progress the top set first; backoff load follows automatically as a percentage of it.",
    sourceTags: ["book-derived", "modernized", "research-supported"],
  },
  {
    id: "antagonist-supersets",
    displayName: "Antagonist Supersets",
    level: 5,
    tier: "Density",
    description:
      "Pair opposing muscle groups back to back with a short transition, keeping full-quality sets.",
    whatItDoes: "Raises session density without cutting the rest each muscle actually gets.",
    whenToUse: "Time-constrained sessions where set quality must be preserved.",
    evidenceGrade: "good",
    fatigueCost: 2,
    technicalRisk: 2,
    minimumExperience: "intermediate",
    allowedExerciseTypes: [
      "barbell-compound",
      "dumbbell-compound",
      "machine-compound",
      "cable-isolation",
      "machine-isolation",
      "dumbbell-isolation",
      "bodyweight",
    ],
    disallowedExerciseTypes: ["barbell-compound-axial"],
    recommendedRIR: { low: 1, high: 2 },
    recommendedRepRange: { low: 6, high: 15 },
    typicalRestSeconds: { low: 60, high: 120 },
    canUseFailure: false,
    failureGuidance: "If reps drop on the second pairing, lengthen the transition rest.",
    maxFrequencyPerWeek: 4,
    maxFrequencyNote: "Fine most sessions when pairings are genuinely opposing.",
    safetyNotes: [
      "Pair opposing patterns only (push/pull, quad/hamstring); never two axial-loaded lifts.",
    ],
    progressionNotes:
      "Progress each exercise on its own double progression; density is a scheduling gain, not a load gain.",
    sourceTags: ["book-derived", "modernized"],
  },
  {
    id: "drop-sets",
    displayName: "Drop Sets",
    level: 6,
    tier: "Intensification",
    description:
      "After the final working set, immediately reduce load and continue for one to three drops.",
    whatItDoes: "Extends the last set past normal set termination with minimal added time.",
    whenToUse: "Final set of a stable isolation movement, sparingly.",
    evidenceGrade: "good",
    fatigueCost: 3,
    technicalRisk: 2,
    minimumExperience: "intermediate",
    allowedExerciseTypes: STABLE_TYPES,
    disallowedExerciseTypes: ["barbell-compound-axial", "barbell-compound", "bodyweight"],
    recommendedRIR: { low: 0, high: 1 },
    recommendedRepRange: { low: 8, high: 20 },
    typicalRestSeconds: { low: 0, high: 20 },
    canUseFailure: true,
    failureGuidance: "Failure is permitted on the drops only, and only on stable equipment.",
    maxFrequencyPerWeek: 2,
    maxFrequencyNote: "One or two drop-set exposures per muscle per week.",
    safetyNotes: [
      "Last set only.",
      "Machines, cables and dumbbells only — no barbell drop sets.",
      "Load reductions stay between 15% and 30% per drop.",
    ],
    progressionNotes:
      "Progress the base working set normally. Do not add drops to compensate for a stalled load.",
    sourceTags: ["book-derived", "modernized"],
  },
  {
    id: "pre-exhaust",
    displayName: "Pre-Exhaust / Staggered Sets",
    level: 7,
    tier: "Specialization",
    description:
      "Fatigue a target muscle with an isolation movement first, then perform the compound; or stagger a small muscle between main-lift rest periods.",
    whatItDoes: "Biases work toward a lagging muscle inside a normal session.",
    whenToUse: "A specific muscle is under-stimulated by your compound work.",
    evidenceGrade: "situational",
    fatigueCost: 3,
    technicalRisk: 2,
    minimumExperience: "intermediate",
    allowedExerciseTypes: [
      "barbell-compound",
      "dumbbell-compound",
      "machine-compound",
      "cable-isolation",
      "machine-isolation",
      "dumbbell-isolation",
      "bodyweight",
    ],
    disallowedExerciseTypes: ["barbell-compound-axial"],
    recommendedRIR: { low: 1, high: 2 },
    recommendedRepRange: { low: 8, high: 15 },
    typicalRestSeconds: { low: 60, high: 150 },
    canUseFailure: false,
    failureGuidance: "Keep the isolation set at RIR 1-2 so the compound stays technically sound.",
    maxFrequencyPerWeek: 2,
    maxFrequencyNote: "Use as a short specialization tool, not a permanent layout.",
    safetyNotes: ["Expect reduced load on the following compound — that is expected, not a stall."],
    progressionNotes:
      "Track the compound load separately while pre-exhaust is active so the drop is not read as a regression.",
    sourceTags: ["book-derived", "modernized"],
  },
  {
    id: "rest-pause",
    displayName: "Rest-Pause",
    level: 8,
    tier: "Advanced",
    description:
      "A normal working load taken to a hard activation set, then short 15-25 second mini-rests with mini-sets to extend effective reps.",
    whatItDoes: "Adds high-effort reps at a working load in very little extra time.",
    whenToUse: "Late-session hypertrophy work on stable equipment.",
    evidenceGrade: "good",
    fatigueCost: 4,
    technicalRisk: 3,
    minimumExperience: "advanced",
    allowedExerciseTypes: [...STABLE_TYPES, "dumbbell-compound"],
    disallowedExerciseTypes: ["barbell-compound-axial", "barbell-compound"],
    recommendedRIR: { low: 0, high: 1 },
    recommendedRepRange: { low: 6, high: 15 },
    typicalRestSeconds: { low: 15, high: 25 },
    canUseFailure: true,
    failureGuidance:
      "The activation set may reach RIR 0. Stop the technique the moment a mini-set falls below 2 reps.",
    maxFrequencyPerWeek: 2,
    maxFrequencyNote: "One or two exposures per muscle per week.",
    safetyNotes: [
      "Modernized dosing: normal working load, not repeated near-maximal singles.",
      "Not for heavy barbell squats or deadlifts.",
    ],
    progressionNotes:
      "Progress load only when the total rest-pause rep count rises across two sessions.",
    sourceTags: ["book-derived", "modernized", "research-supported"],
  },
  {
    id: "lengthened-partials",
    displayName: "Lengthened Partials",
    level: 9,
    tier: "Advanced Plus",
    description:
      "After full-range reps end, continue with partial reps in the stretched portion of the range.",
    whatItDoes: "Adds stimulus in the lengthened position where it appears most productive.",
    whenToUse: "Isolation and machine work where the stretched position is well supported.",
    evidenceGrade: "emerging",
    fatigueCost: 3,
    technicalRisk: 3,
    minimumExperience: "advanced",
    allowedExerciseTypes: STABLE_TYPES,
    disallowedExerciseTypes: ["barbell-compound-axial", "barbell-compound", "bodyweight"],
    recommendedRIR: { low: 0, high: 1 },
    recommendedRepRange: { low: 8, high: 15 },
    typicalRestSeconds: { low: 90, high: 180 },
    canUseFailure: true,
    failureGuidance: "Partials begin only after full-ROM reps are complete.",
    maxFrequencyPerWeek: 2,
    maxFrequencyNote: "Limited exposures — the stretched position is the most fatiguing.",
    safetyNotes: [
      "Full range first, always.",
      "Only on exercises that support the stretched position safely.",
    ],
    progressionNotes: "Progress full-ROM reps first; partials are an add-on, never the target.",
    sourceTags: ["modernized", "research-supported"],
  },
  {
    id: "eccentric-emphasis",
    displayName: "Eccentric Emphasis",
    level: 10,
    tier: "Expert",
    description: "A controlled eccentric of 3-4 seconds on each rep at a normal working load.",
    whatItDoes: "Increases time under tension in the lowering phase with no load increase.",
    whenToUse: "Technique-limited lifts or when joints tolerate load poorly.",
    evidenceGrade: "good",
    fatigueCost: 4,
    technicalRisk: 3,
    minimumExperience: "advanced",
    allowedExerciseTypes: [...STABLE_TYPES, "dumbbell-compound", "bodyweight"],
    disallowedExerciseTypes: ["barbell-compound-axial"],
    recommendedRIR: { low: 1, high: 2 },
    recommendedRepRange: { low: 5, high: 12 },
    typicalRestSeconds: { low: 150, high: 240 },
    canUseFailure: false,
    failureGuidance: "Stop when the eccentric can no longer be controlled for the full count.",
    maxFrequencyPerWeek: 2,
    maxFrequencyNote: "Eccentric soreness accumulates — cap exposures.",
    safetyNotes: [
      "Supramaximal eccentrics are expert and supervised only and are never auto-prescribed.",
      "Reduce load 5-10% versus your normal working set when adopting the tempo.",
    ],
    progressionNotes:
      "Hold the tempo constant and progress load; do not lengthen the eccentric indefinitely.",
    sourceTags: ["book-derived", "modernized", "research-supported"],
  },
  {
    id: "trisets",
    displayName: "Trisets",
    level: 11,
    tier: "Savage",
    description: "Three exercises performed back to back with minimal rest between them.",
    whatItDoes: "Compresses a large block of work into a short window.",
    whenToUse: "Short sessions, stable movements, accessory blocks.",
    evidenceGrade: "situational",
    fatigueCost: 4,
    technicalRisk: 3,
    minimumExperience: "advanced",
    allowedExerciseTypes: [...STABLE_TYPES, "dumbbell-compound", "bodyweight"],
    disallowedExerciseTypes: ["barbell-compound-axial", "barbell-compound"],
    recommendedRIR: { low: 1, high: 2 },
    recommendedRepRange: { low: 8, high: 15 },
    typicalRestSeconds: { low: 90, high: 150 },
    canUseFailure: false,
    failureGuidance: "Rounds end when reps fall more than 20% below the first round.",
    maxFrequencyPerWeek: 2,
    maxFrequencyNote: "Two triset blocks per week at most.",
    safetyNotes: ["Stable movements only — fatigue arrives faster than technique can adapt."],
    progressionNotes: "Add a round or reps before adding load; cap the block at 4 rounds.",
    sourceTags: ["book-derived", "modernized"],
  },
  {
    id: "giant-sets",
    displayName: "Giant Sets",
    level: 12,
    tier: "Extreme",
    description: "Four or more exercises for one region performed back to back.",
    whatItDoes: "Maximum local work density in one block.",
    whenToUse: "Short specialization blocks only, on machines and cables.",
    evidenceGrade: "situational",
    fatigueCost: 5,
    technicalRisk: 4,
    minimumExperience: "advanced",
    allowedExerciseTypes: STABLE_TYPES,
    disallowedExerciseTypes: ["barbell-compound-axial", "barbell-compound", "dumbbell-compound"],
    recommendedRIR: { low: 1, high: 2 },
    recommendedRepRange: { low: 8, high: 15 },
    typicalRestSeconds: { low: 120, high: 180 },
    canUseFailure: false,
    failureGuidance: "Never taken to true failure on any station.",
    maxFrequencyPerWeek: 1,
    maxFrequencyNote: "One giant-set block per week per region.",
    safetyNotes: ["Never on heavy barbell squats or deadlifts.", "Cap the block at 3 rounds."],
    progressionNotes: "Progress by round quality, then load. Retire the block after 3-4 weeks.",
    sourceTags: ["book-derived", "modernized"],
  },
  {
    id: "cluster-sets",
    displayName: "Cluster / Rest-Pause Sets",
    level: 13,
    tier: "Extreme Plus",
    description:
      "A heavy set broken into small rep clusters with 15-30 second intra-set rests and long rest between clusters.",
    whatItDoes: "Keeps bar speed and technique high at loads that would otherwise degrade.",
    whenToUse: "Strength blocks where quality reps at heavy load matter more than continuity.",
    evidenceGrade: "good",
    fatigueCost: 4,
    technicalRisk: 4,
    minimumExperience: "expert",
    allowedExerciseTypes: [
      "barbell-compound",
      "dumbbell-compound",
      "machine-compound",
      "cable-isolation",
      "machine-isolation",
      "dumbbell-isolation",
    ],
    disallowedExerciseTypes: ["barbell-compound-axial", "bodyweight"],
    recommendedRIR: { low: 2, high: 3 },
    recommendedRepRange: { low: 2, high: 5 },
    typicalRestSeconds: { low: 180, high: 300 },
    canUseFailure: false,
    failureGuidance: "Clusters exist to avoid failure. End the set when speed drops.",
    maxFrequencyPerWeek: 2,
    maxFrequencyNote: "Two cluster exposures per lift per week at most.",
    safetyNotes: [
      "Rack or re-set the load between clusters; never hold a heavy load through the rest.",
      "Not applied to heavy axial barbell work in IronDesk.",
    ],
    progressionNotes: "Add a cluster before adding load; keep reps per cluster constant.",
    sourceTags: ["book-derived", "modernized", "research-supported"],
  },
  {
    id: "irondesk-black",
    displayName: "IronDesk Black",
    level: 14,
    tier: "IronDesk Black",
    description:
      "A short specialization shock block that combines two advanced techniques inside a strict fatigue budget and a defined window.",
    whatItDoes: "Concentrated overload on one lagging area for a defined number of weeks.",
    whenToUse: "Only with consistent training, good recovery, and a planned exit date.",
    evidenceGrade: "situational",
    fatigueCost: 5,
    technicalRisk: 4,
    minimumExperience: "expert",
    allowedExerciseTypes: [...STABLE_TYPES, "dumbbell-compound"],
    disallowedExerciseTypes: ["barbell-compound-axial", "barbell-compound", "bodyweight"],
    recommendedRIR: { low: 0, high: 1 },
    recommendedRepRange: { low: 6, high: 15 },
    typicalRestSeconds: { low: 90, high: 180 },
    canUseFailure: true,
    failureGuidance: "Failure only on stable isolation stations, never on a loaded compound.",
    maxFrequencyPerWeek: 1,
    maxFrequencyNote: "One block per training phase, 2-3 weeks maximum.",
    safetyNotes: [
      "Not a permanent training style — the block has an end date.",
      "Block is suspended when readiness drops or sessions are missed.",
    ],
    progressionNotes:
      "Hold loads and progress effort density inside the window, then return to Level 2-4 work.",
    sourceTags: ["irondesk-original", "modernized"],
  },
] as const;

const METHOD_BY_ID = new Map(TRAINING_METHODS.map((m) => [m.id, m]));

export function getMethod(id: string): TrainingMethod | undefined {
  return METHOD_BY_ID.get(id);
}

/* -------------------------------------------------------------------------- */
/* Exercise classification                                                    */
/* -------------------------------------------------------------------------- */

const AXIAL_HINTS = ["squat", "deadlift", "good morning", "clean", "snatch", "jerk"];
const COMPOUND_HINTS = [
  "press",
  "row",
  "pull-up",
  "pullup",
  "chin",
  "dip",
  "lunge",
  "split squat",
  "push-up",
  "pushup",
  "thrust",
  "pulldown",
];

/** Maps a movement's name/equipment onto the coarse type used for gating. */
export function classifyExerciseType(input: {
  name: string;
  equipment?: string | null;
}): ExerciseType {
  const name = input.name.toLowerCase();
  const equipment = (input.equipment ?? "").toLowerCase();
  const compound = COMPOUND_HINTS.some((h) => name.includes(h));
  const axial = AXIAL_HINTS.some((h) => name.includes(h));

  if (equipment.includes("barbell") || equipment.includes("trap bar")) {
    return axial ? "barbell-compound-axial" : "barbell-compound";
  }
  if (equipment.includes("bodyweight") || equipment.includes("none") || equipment.includes("band"))
    return "bodyweight";
  if (equipment.includes("machine") || equipment.includes("smith"))
    return compound ? "machine-compound" : "machine-isolation";
  if (equipment.includes("cable")) return "cable-isolation";
  if (equipment.includes("dumbbell") || equipment.includes("kettlebell"))
    return compound || axial ? "dumbbell-compound" : "dumbbell-isolation";
  return compound ? "machine-compound" : "machine-isolation";
}

/** Heavy axial barbell work never hosts failure/shock techniques. */
export function isHighRiskLift(type: ExerciseType): boolean {
  return type === "barbell-compound-axial";
}

/* -------------------------------------------------------------------------- */
/* Athlete profile and eligibility                                            */
/* -------------------------------------------------------------------------- */

export interface AthleteMethodProfile {
  experience: ExperienceLevel;
  /** Months of consistent resistance training. */
  monthsTraining: number;
  /** Completed sessions in the last 28 days — demonstrated consistency. */
  sessionsLast28Days: number;
  /** Mean readiness over the recent window, when the athlete checks in. */
  averageReadiness: number | null;
  /** True while an IronDesk Black specialization window is open. */
  specializationWindowOpen?: boolean;
}

const EXPERIENCE_RANK: Record<ExperienceLevel, number> = {
  beginner: 0,
  intermediate: 1,
  advanced: 2,
  expert: 3,
};

export interface MethodEligibility {
  unlocked: boolean;
  /** Reasons the method is locked. Empty when unlocked. */
  lockReasons: string[];
  /** Plain-language line for the selector card. */
  statusReason: string;
  /** Requirements the athlete can still earn (experience, sessions, readiness). */
  unlockRequirements: string[];
  /** Absolute safety restrictions that can never be earned away. */
  safetyRestrictions: string[];
}

/**
 * Unlocks are earned by experience AND demonstrated consistency/recovery, never
 * by calendar time alone. Exercise-level safety gates are absolute.
 */
export function methodEligibility(
  method: TrainingMethod,
  profile: AthleteMethodProfile,
  exercise?: { name: string; equipment?: string | null },
): MethodEligibility {
  const lockReasons: string[] = [];
  const safetyRestrictions: string[] = [];

  if (EXPERIENCE_RANK[profile.experience] < EXPERIENCE_RANK[method.minimumExperience]) {
    lockReasons.push(`Requires ${method.minimumExperience} training experience.`);
  }

  if (method.fatigueCost >= 3 && profile.sessionsLast28Days < 8) {
    lockReasons.push("Requires at least 8 logged sessions in the last 28 days.");
  }
  if (method.fatigueCost >= 4 && profile.sessionsLast28Days < 12) {
    lockReasons.push("Requires at least 12 logged sessions in the last 28 days.");
  }
  if (
    method.fatigueCost >= 4 &&
    profile.averageReadiness != null &&
    profile.averageReadiness < 60
  ) {
    lockReasons.push("Recent readiness is too low for a high-fatigue technique.");
  }
  if (method.level >= 8 && profile.monthsTraining < 24) {
    lockReasons.push("Advanced techniques unlock after 24 months of consistent training.");
  }
  if (method.id === "irondesk-black" && !profile.specializationWindowOpen) {
    lockReasons.push("Opens only inside a planned specialization window.");
  }

  if (exercise) {
    const type = classifyExerciseType(exercise);
    if (method.disallowedExerciseTypes.includes(type)) {
      safetyRestrictions.push(`Not permitted on ${exerciseTypeLabel(type)} movements.`);
    } else if (!method.allowedExerciseTypes.includes(type)) {
      safetyRestrictions.push(`Not applicable to ${exerciseTypeLabel(type)} movements.`);
    }
    if (isHighRiskLift(type) && (method.canUseFailure || method.fatigueCost >= 4)) {
      safetyRestrictions.push(
        "Failure and shock techniques are never applied to heavy axial barbell work.",
      );
    }
  }

  const all = [...safetyRestrictions, ...lockReasons];
  return {
    unlocked: all.length === 0,
    lockReasons: all,
    statusReason: all.length === 0 ? unlockedReason(method) : all[0]!,
    unlockRequirements: lockReasons,
    safetyRestrictions,
  };
}

function unlockedReason(method: TrainingMethod): string {
  return method.level <= 2
    ? "Available to every athlete."
    : `Unlocked: experience and recent consistency meet the level ${method.level} requirement.`;
}

export function exerciseTypeLabel(type: ExerciseType): string {
  switch (type) {
    case "barbell-compound-axial":
      return "heavy axial barbell";
    case "barbell-compound":
      return "barbell compound";
    case "dumbbell-compound":
      return "dumbbell compound";
    case "machine-compound":
      return "machine compound";
    case "cable-isolation":
      return "cable isolation";
    case "machine-isolation":
      return "machine isolation";
    case "dumbbell-isolation":
      return "dumbbell isolation";
    case "bodyweight":
      return "bodyweight";
  }
}

/* -------------------------------------------------------------------------- */
/* Session fatigue budget                                                     */
/* -------------------------------------------------------------------------- */

export const FATIGUE_BUDGET: Record<ExperienceLevel, number> = {
  beginner: 2,
  intermediate: 5,
  advanced: 9,
  expert: 11,
};

/** Methods a beginner may run — everything else is out of budget by design. */
const BEGINNER_METHODS = new Set(["straight-sets", "double-progression", "volume-progression"]);

export function sessionFatigue(methodIds: readonly string[]): number {
  return methodIds.reduce((total, id) => total + (getMethod(id)?.fatigueCost ?? 0), 0);
}

export interface StackDecision {
  allowed: boolean;
  reason: string;
  /** Fatigue total if the candidate were added. */
  projected: number;
  budget: number;
}

/**
 * Guards the workout builder against reckless stacking: budget by experience,
 * plus hard caps on how many advanced/high-fatigue modifiers can coexist.
 */
export function canAddMethod(
  selectedIds: readonly string[],
  candidateId: string,
  profile: AthleteMethodProfile,
): StackDecision {
  const budget = FATIGUE_BUDGET[profile.experience];
  const candidate = getMethod(candidateId);
  const projected = sessionFatigue([...selectedIds, candidateId]);

  if (!candidate) return { allowed: false, reason: "Unknown method.", projected, budget };

  if (profile.experience === "beginner" && !BEGINNER_METHODS.has(candidateId)) {
    return {
      allowed: false,
      reason: "Beginner sessions run straight sets and double progression only.",
      projected,
      budget,
    };
  }

  const selected = selectedIds.map(getMethod).filter((m): m is TrainingMethod => Boolean(m));
  const highFatigue = selected.filter((m) => m.fatigueCost >= 3).length;
  const advanced = selected.filter((m) => m.level >= 8).length;

  if (profile.experience === "intermediate" && candidate.fatigueCost >= 3 && highFatigue >= 1) {
    return {
      allowed: false,
      reason: "Intermediate sessions allow one density or intensification modifier.",
      projected,
      budget,
    };
  }
  if (candidate.level >= 8 && advanced >= 2) {
    return {
      allowed: false,
      reason: "At most two advanced techniques per session.",
      projected,
      budget,
    };
  }
  if (candidateId === "irondesk-black" && !profile.specializationWindowOpen) {
    return {
      allowed: false,
      reason: "IronDesk Black runs only inside an open specialization window.",
      projected,
      budget,
    };
  }
  if (projected > budget) {
    return {
      allowed: false,
      reason: `Session fatigue budget exceeded (${projected}/${budget}).`,
      projected,
      budget,
    };
  }

  return { allowed: true, reason: `Fatigue ${projected}/${budget}.`, projected, budget };
}

export interface MethodSelectionDecision {
  allowed: boolean;
  reason: string;
  method: TrainingMethod | null;
  eligibility: MethodEligibility | null;
  stack: StackDecision | null;
}

/**
 * The single authorization gate for attaching or executing a method. Callers
 * must supply the real movement and every other method already selected in the
 * workout; this keeps experience, recovery, exercise safety and fatigue-stack
 * decisions identical in the builder, template start and active workout.
 */
export function methodSelectionDecision(input: {
  methodId: string;
  profile: AthleteMethodProfile;
  exercise: { name: string; equipment?: string | null };
  selectedIds: readonly string[];
}): MethodSelectionDecision {
  const method = getMethod(input.methodId);
  if (!method) {
    return {
      allowed: false,
      reason: "That training method is not recognised.",
      method: null,
      eligibility: null,
      stack: null,
    };
  }

  const eligibility = methodEligibility(method, input.profile, input.exercise);
  if (!eligibility.unlocked) {
    return {
      allowed: false,
      reason: eligibility.statusReason,
      method,
      eligibility,
      stack: null,
    };
  }

  const stack = canAddMethod(input.selectedIds, input.methodId, input.profile);
  return {
    allowed: stack.allowed,
    reason: stack.reason,
    method,
    eligibility,
    stack,
  };
}

export interface PlannedMethodSelection {
  methodId: string | null | undefined;
  exercise: { name: string; equipment?: string | null };
}

/** Returns the first invalid selection while preserving duplicate method uses. */
export function firstMethodSelectionRejection(
  selections: readonly PlannedMethodSelection[],
  profile: AthleteMethodProfile,
): { index: number; decision: MethodSelectionDecision } | null {
  for (let index = 0; index < selections.length; index += 1) {
    const selection = selections[index]!;
    if (!selection.methodId) continue;
    const selectedIds = selections
      .filter((other, otherIndex) => otherIndex !== index && Boolean(other.methodId))
      .map((other) => other.methodId!);
    const decision = methodSelectionDecision({
      methodId: selection.methodId,
      profile,
      exercise: selection.exercise,
      selectedIds,
    });
    if (!decision.allowed) return { index, decision };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Method prescriptions                                                       */
/* -------------------------------------------------------------------------- */

export interface MethodPrescription {
  methodId: string;
  /** Short execution headline, e.g. "10 reps · rest 20s · 4 reps · rest 20s · 3 reps". */
  summary: string;
  /** Ordered execution steps for the active-workout card. */
  steps: string[];
  /** Loads used, canonical kg, in execution order. */
  loadsKg: number[];
  notes: string[];
}

const round = (kg: number) => Math.round(kg * 100) / 100;

/** 1-3 drops, each a bounded 15-30% reduction, last set only. */
export function dropSetPrescription(input: {
  weightKg: number;
  reps: number;
  drops?: number;
  dropPercent?: number;
}): MethodPrescription {
  const drops = Math.min(3, Math.max(1, input.drops ?? 2));
  const percent = Math.min(30, Math.max(15, input.dropPercent ?? 20));
  const loads: number[] = [round(input.weightKg)];
  const steps = [`Final set: ${input.reps} reps at working load`];
  let load = input.weightKg;
  for (let i = 0; i < drops; i += 1) {
    load = load * (1 - percent / 100);
    loads.push(round(load));
    steps.push(`Drop ${i + 1}: −${percent}% · reps to RIR 0`);
  }
  return {
    methodId: "drop-sets",
    summary: `Last set + ${drops} drop${drops > 1 ? "s" : ""} at −${percent}% each`,
    steps,
    loadsKg: loads,
    notes: ["Last working set only.", "Stable machine, cable or dumbbell movements."],
  };
}

/** Modernized rest-pause: one working load, activation set, then mini-sets. */
export function restPausePrescription(input: {
  weightKg: number;
  reps: number;
  miniSets?: number;
  restSeconds?: number;
}): MethodPrescription {
  const miniSets = Math.min(3, Math.max(1, input.miniSets ?? 2));
  const rest = Math.min(25, Math.max(15, input.restSeconds ?? 20));
  const steps = [`Activation set: ${input.reps} reps at working load`];
  const loads = [round(input.weightKg)];
  let expected = Math.max(2, Math.round(input.reps * 0.4));
  const parts = [`${input.reps} reps`];
  for (let i = 0; i < miniSets; i += 1) {
    steps.push(`Rest ${rest}s → mini-set ${i + 1}: ~${expected} reps`);
    parts.push(`rest ${rest}s`, `${expected} reps`);
    loads.push(round(input.weightKg));
    expected = Math.max(2, expected - 1);
  }
  return {
    methodId: "rest-pause",
    summary: parts.join(" · "),
    steps,
    loadsKg: loads,
    notes: [
      "Same working load throughout — no near-maximal singles.",
      "Stop when a mini-set falls below 2 reps.",
    ],
  };
}

/** Heavy set split into small clusters with short intra-set rest. */
export function clusterPrescription(input: {
  weightKg: number;
  totalReps: number;
  repsPerCluster?: number;
  intraRestSeconds?: number;
  interRestSeconds?: number;
}): MethodPrescription {
  const perCluster = Math.min(5, Math.max(2, input.repsPerCluster ?? 3));
  const intra = Math.min(30, Math.max(15, input.intraRestSeconds ?? 20));
  const inter = Math.max(120, input.interRestSeconds ?? 180);
  const clusters = Math.max(2, Math.ceil(input.totalReps / perCluster));
  const steps: string[] = [];
  const loads: number[] = [];
  for (let i = 0; i < clusters; i += 1) {
    steps.push(
      i === 0
        ? `Cluster 1: ${perCluster} reps`
        : `Rest ${intra}s → cluster ${i + 1}: ${perCluster} reps`,
    );
    loads.push(round(input.weightKg));
  }
  steps.push(`Rest ${Math.round(inter / 60)} min before the next set`);
  return {
    methodId: "cluster-sets",
    summary: `${clusters} × ${perCluster} reps · ${intra}s intra-set rest`,
    steps,
    loadsKg: loads,
    notes: ["Re-rack between clusters.", "End the set when bar speed drops."],
  };
}

/** Opposing-muscle pairing that preserves set quality. */
export function supersetPrescription(input: {
  primary: string;
  partner: string;
  transitionSeconds?: number;
}): MethodPrescription {
  const transition = Math.min(60, Math.max(20, input.transitionSeconds ?? 45));
  return {
    methodId: "antagonist-supersets",
    summary: `${input.primary} → ${transition}s → ${input.partner}`,
    steps: [
      `Set A: ${input.primary} at RIR 1-2`,
      `Transition ${transition}s`,
      `Set B: ${input.partner} at RIR 1-2`,
      "Full rest, then repeat the pair",
    ],
    loadsKg: [],
    notes: ["Opposing patterns only.", "Lengthen the transition if reps drop."],
  };
}

/** Circuit-style blocks: rounds are capped by fatigue cost. */
export function circuitPrescription(input: {
  methodId: "trisets" | "giant-sets";
  exercises: readonly string[];
  rounds?: number;
}): MethodPrescription {
  const cap = input.methodId === "giant-sets" ? 3 : 4;
  const rounds = Math.min(cap, Math.max(2, input.rounds ?? 3));
  return {
    methodId: input.methodId,
    summary: `${input.exercises.length} stations × ${rounds} rounds`,
    steps: [
      ...input.exercises.map((name, i) => `Station ${i + 1}: ${name} at RIR 1-2`),
      `Rest 2-3 min, repeat for ${rounds} rounds`,
    ],
    loadsKg: [],
    notes: [`Capped at ${cap} rounds.`, "Stable movements only."],
  };
}

/** Full-ROM reps first, then partials in the stretched position. */
export function lengthenedPartialsPrescription(input: {
  weightKg: number;
  reps: number;
  partials?: number;
}): MethodPrescription {
  const partials = Math.min(8, Math.max(3, input.partials ?? 5));
  return {
    methodId: "lengthened-partials",
    summary: `${input.reps} full reps + ${partials} lengthened partials`,
    steps: [
      `Full range: ${input.reps} reps at working load`,
      `Then ${partials} partials in the stretched half of the range`,
    ],
    loadsKg: [round(input.weightKg)],
    notes: ["Partials only after full-ROM reps.", "Stop if the stretched position cannot be held."],
  };
}

/** Controlled eccentric tempo — supramaximal work is never auto-prescribed. */
export function eccentricPrescription(input: {
  weightKg: number;
  reps: number;
  eccentricSeconds?: number;
}): MethodPrescription {
  const tempo = Math.min(5, Math.max(3, input.eccentricSeconds ?? 3));
  const load = round(input.weightKg * 0.95);
  return {
    methodId: "eccentric-emphasis",
    summary: `${input.reps} reps · ${tempo}s lowering`,
    steps: [
      `Lower under control for ${tempo}s on every rep`,
      `Target ${input.reps} reps at ~95% of your normal working load`,
    ],
    loadsKg: [load],
    notes: [
      "Supramaximal eccentrics are supervised-only and not prescribed here.",
      "End the set when the eccentric can no longer be controlled.",
    ],
  };
}

export function heavyBackoffPrescriptionSummary(topReps: number, backoffReps: number): string {
  return `Top set ${topReps} reps @ RIR 1-2 · backoff ${backoffReps} reps`;
}

/**
 * Builds the execution prescription for whichever method is attached to an
 * exercise. Returns null for methods with no per-set execution change, and for
 * grouping methods that have no real partner/stations resolved yet — a
 * placeholder station is never invented.
 */
export function buildMethodPrescription(
  methodId: string,
  context: {
    weightKg: number;
    reps: number;
    exerciseName: string;
    /** Resolved antagonist / pre-exhaust partner name. */
    partnerName?: string | null;
    /** Resolved real station names, in execution order, including the primary. */
    stationNames?: readonly string[] | null;
    /** Ordered execution lines for a pre-exhaust or staggered pairing. */
    pairInstructions?: readonly string[] | null;
  },
): MethodPrescription | null {
  switch (methodId) {
    case "drop-sets":
      return dropSetPrescription({ weightKg: context.weightKg, reps: context.reps });
    case "rest-pause":
      return restPausePrescription({ weightKg: context.weightKg, reps: context.reps });
    case "cluster-sets":
      return clusterPrescription({ weightKg: context.weightKg, totalReps: context.reps });
    case "lengthened-partials":
      return lengthenedPartialsPrescription({ weightKg: context.weightKg, reps: context.reps });
    case "eccentric-emphasis":
      return eccentricPrescription({ weightKg: context.weightKg, reps: context.reps });
    case "antagonist-supersets":
      return context.partnerName
        ? supersetPrescription({ primary: context.exerciseName, partner: context.partnerName })
        : null;
    case "pre-exhaust":
      return context.pairInstructions?.length
        ? {
            methodId,
            summary: `${context.pairInstructions.length}-step pairing`,
            steps: [...context.pairInstructions],
            loadsKg: [],
            notes: ["Expect a reduced load on the compound — that is expected, not a stall."],
          }
        : null;
    case "trisets":
    case "giant-sets": {
      const stations = context.stationNames ?? [];
      const required = methodId === "trisets" ? 3 : 4;
      if (stations.length < required) return null;
      return circuitPrescription({ methodId, exercises: stations });
    }
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Profile derivation                                                         */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

/**
 * Derives the method profile from logged session dates — consistency is
 * measured, never self-declared. `monthsTraining` uses the span of logged
 * history, so experience is earned by training that actually happened.
 */
export function deriveMethodProfile(input: {
  sessionDates: readonly string[];
  averageReadiness?: number | null;
  now?: Date;
  specializationWindowOpen?: boolean;
}): AthleteMethodProfile {
  const now = input.now ?? new Date();
  const times = input.sessionDates
    .map((d) => Date.parse(d))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const sessionsLast28Days = times.filter((t) => now.getTime() - t <= 28 * DAY_MS).length;
  const spanDays = times.length ? (now.getTime() - times[0]!) / DAY_MS : 0;
  const monthsTraining = Math.floor(spanDays / 30);

  let experience: ExperienceLevel = "beginner";
  if (monthsTraining >= 24 && sessionsLast28Days >= 12) experience = "expert";
  else if (monthsTraining >= 12 && sessionsLast28Days >= 10) experience = "advanced";
  else if (monthsTraining >= 4 && sessionsLast28Days >= 6) experience = "intermediate";

  return {
    experience,
    monthsTraining,
    sessionsLast28Days,
    averageReadiness: input.averageReadiness ?? null,
    specializationWindowOpen: input.specializationWindowOpen ?? false,
  };
}
