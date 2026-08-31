import { describe, expect, it } from "vitest";

import {
  canAddMethod,
  circuitPrescription,
  classifyExerciseType,
  clusterPrescription,
  deriveMethodProfile,
  dropSetPrescription,
  eccentricPrescription,
  FATIGUE_BUDGET,
  firstMethodSelectionRejection,
  getMethod,
  lengthenedPartialsPrescription,
  methodEligibility,
  methodSelectionDecision,
  restPausePrescription,
  sessionFatigue,
  TRAINING_METHODS,
  type AthleteMethodProfile,
} from "@/lib/irondesk/training-methods";
import {
  BLACK_FATIGUE_BUDGET,
  BLACK_MAX_WEEKS,
  BLACK_SAFE_MODIFIERS,
  blackWindowState,
  canOpenBlackWindow,
  methodSetPlan,
  parseMethodConfig,
  planBlackBlock,
  selectAntagonistPartner,
  selectCircuitGroup,
  selectPreExhaustPlan,
  serializeMethodConfig,
  volumeRecommendationForMuscle,
  weeklyDirectSets,
} from "@/lib/irondesk/method-composition";
import {
  doubleProgressionState,
  heavyBackoffPlan,
  volumeProgression,
} from "@/lib/irondesk/progression";
import { kgToLb } from "@/lib/irondesk/units";

const profile = (over: Partial<AthleteMethodProfile> = {}): AthleteMethodProfile => ({
  experience: "advanced",
  monthsTraining: 36,
  sessionsLast28Days: 14,
  averageReadiness: 75,
  specializationWindowOpen: false,
  ...over,
});

describe("registry", () => {
  it("covers levels 1-14 with unique ids", () => {
    expect(TRAINING_METHODS).toHaveLength(14);
    expect(new Set(TRAINING_METHODS.map((m) => m.id)).size).toBe(14);
    expect(TRAINING_METHODS.map((m) => m.level)).toEqual(
      Array.from({ length: 14 }, (_, i) => i + 1),
    );
  });

  it("never allows failure or high-fatigue work on heavy axial barbell lifts", () => {
    for (const method of TRAINING_METHODS) {
      if (method.canUseFailure || method.fatigueCost >= 4) {
        expect(method.allowedExerciseTypes).not.toContain("barbell-compound-axial");
      }
    }
  });
});

describe("exercise classification", () => {
  it("separates axial barbell work from stable machines", () => {
    expect(classifyExerciseType({ name: "Back Squat", equipment: "Barbell" })).toBe(
      "barbell-compound-axial",
    );
    expect(classifyExerciseType({ name: "Bench Press", equipment: "Barbell" })).toBe(
      "barbell-compound",
    );
    expect(classifyExerciseType({ name: "Cable Lateral Raise", equipment: "Cable" })).toBe(
      "cable-isolation",
    );
    expect(classifyExerciseType({ name: "Pull-up", equipment: "Bodyweight" })).toBe("bodyweight");
  });
});

describe("method unlock eligibility", () => {
  it("keeps foundation methods open to everyone", () => {
    const beginner = profile({ experience: "beginner", monthsTraining: 1, sessionsLast28Days: 3 });
    expect(methodEligibility(getMethod("straight-sets")!, beginner).unlocked).toBe(true);
    expect(methodEligibility(getMethod("double-progression")!, beginner).unlocked).toBe(true);
  });

  it("requires experience AND demonstrated consistency for advanced methods", () => {
    const timeOnly = profile({ sessionsLast28Days: 4 });
    const locked = methodEligibility(getMethod("rest-pause")!, timeOnly);
    expect(locked.unlocked).toBe(false);
    expect(locked.lockReasons.join(" ")).toMatch(/logged sessions/);
    expect(methodEligibility(getMethod("rest-pause")!, profile()).unlocked).toBe(true);
  });

  it("locks high-fatigue methods when readiness is poor", () => {
    expect(
      methodEligibility(getMethod("rest-pause")!, profile({ averageReadiness: 45 })).unlocked,
    ).toBe(false);
  });

  it("blocks high-risk techniques on heavy barbell squats and deadlifts", () => {
    for (const id of ["drop-sets", "rest-pause", "giant-sets", "cluster-sets", "irondesk-black"]) {
      const result = methodEligibility(getMethod(id)!, profile({ experience: "expert" }), {
        name: "Conventional Deadlift",
        equipment: "Barbell",
      });
      expect(result.unlocked).toBe(false);
    }
  });

  it("gates IronDesk Black behind an open specialization window", () => {
    const expert = profile({ experience: "expert" });
    expect(methodEligibility(getMethod("irondesk-black")!, expert).unlocked).toBe(false);
    expect(
      methodEligibility(getMethod("irondesk-black")!, {
        ...expert,
        specializationWindowOpen: true,
      }).unlocked,
    ).toBe(true);
  });

  it("uses one gate for athlete, exercise and session-stack eligibility", () => {
    const unsafe = methodSelectionDecision({
      methodId: "drop-sets",
      profile: profile({ experience: "expert" }),
      exercise: { name: "Back Squat", equipment: "Barbell" },
      selectedIds: [],
    });
    expect(unsafe.allowed).toBe(false);
    expect(unsafe.reason).toMatch(/not permitted|never applied/i);

    const safe = methodSelectionDecision({
      methodId: "drop-sets",
      profile: profile(),
      exercise: { name: "Cable Fly", equipment: "Cable" },
      selectedIds: ["double-progression"],
    });
    expect(safe.allowed).toBe(true);

    const rejection = firstMethodSelectionRejection(
      [
        { methodId: "drop-sets", exercise: { name: "Cable Fly", equipment: "Cable" } },
        {
          methodId: "heavy-backoff",
          exercise: { name: "Machine Chest Press", equipment: "Machine" },
        },
      ],
      profile({ experience: "intermediate", monthsTraining: 12 }),
    );
    expect(rejection?.decision.reason).toMatch(/one density or intensification modifier/i);
  });

  it("derives experience from logged sessions, not declarations", () => {
    const now = new Date("2026-08-31T00:00:00.000Z");
    const dates: string[] = [];
    for (let i = 0; i < 200; i += 1)
      dates.push(new Date(now.getTime() - i * 4 * 86_400_000).toISOString());
    const derived = deriveMethodProfile({ sessionDates: dates, averageReadiness: 80, now });
    expect(derived.monthsTraining).toBeGreaterThan(24);
    expect(derived.sessionsLast28Days).toBeGreaterThanOrEqual(7);
    expect(deriveMethodProfile({ sessionDates: [], now }).experience).toBe("beginner");
  });
});

describe("fatigue budget", () => {
  it("holds beginners to straight sets and double progression", () => {
    const beginner = profile({ experience: "beginner" });
    expect(canAddMethod([], "drop-sets", beginner).allowed).toBe(false);
    expect(canAddMethod([], "double-progression", beginner).allowed).toBe(true);
  });

  it("allows intermediates one high-fatigue modifier", () => {
    const inter = profile({ experience: "intermediate" });
    expect(canAddMethod(["double-progression"], "drop-sets", inter).allowed).toBe(true);
    expect(canAddMethod(["drop-sets"], "heavy-backoff", inter).allowed).toBe(false);
  });

  it("caps advanced techniques at two per session and enforces the budget", () => {
    const adv = profile();
    expect(
      canAddMethod(["rest-pause", "lengthened-partials"], "eccentric-emphasis", adv).allowed,
    ).toBe(false);
    const stacked = ["rest-pause", "eccentric-emphasis", "trisets"];
    expect(sessionFatigue(stacked)).toBeGreaterThan(FATIGUE_BUDGET.advanced - 3);
    expect(canAddMethod(stacked, "giant-sets", adv).allowed).toBe(false);
  });
});

describe("prescription generation", () => {
  it("builds bounded drop sets on the last set only", () => {
    const p = dropSetPrescription({ weightKg: 40, reps: 12, drops: 9, dropPercent: 90 });
    expect(p.loadsKg).toHaveLength(4); // capped at 3 drops
    expect(p.loadsKg[1]!).toBeCloseTo(40 * 0.7, 2); // reduction capped at 30%
    expect(p.notes.join(" ")).toMatch(/Last working set only/);
  });

  it("builds modernized rest-pause at one working load", () => {
    const p = restPausePrescription({ weightKg: 50, reps: 10 });
    expect(new Set(p.loadsKg)).toEqual(new Set([50]));
    expect(p.summary).toMatch(/rest 20s/);
    expect(p.steps[0]).toMatch(/Activation set/);
  });

  it("builds clusters with short intra-set rest", () => {
    const p = clusterPrescription({ weightKg: 140, totalReps: 9, repsPerCluster: 3 });
    expect(p.loadsKg).toHaveLength(3);
    expect(p.summary).toBe("3 × 3 reps · 20s intra-set rest");
  });

  it("caps circuit rounds and orders partials after full reps", () => {
    expect(
      circuitPrescription({ methodId: "giant-sets", exercises: ["a", "b", "c", "d"], rounds: 8 })
        .summary,
    ).toBe("4 stations × 3 rounds");
    expect(lengthenedPartialsPrescription({ weightKg: 20, reps: 10 }).steps[0]).toMatch(
      /Full range/,
    );
    expect(eccentricPrescription({ weightKg: 100, reps: 8 }).notes.join(" ")).toMatch(
      /Supramaximal/,
    );
  });
});

describe("double progression behaviour", () => {
  const target = { low: 8, high: 12 };

  it("holds the load until every set reaches the top of the range", () => {
    const state = doubleProgressionState({
      weightKg: 84,
      sets: [{ reps: 12 }, { reps: 12 }, { reps: 11 }],
      target,
      incrementKg: 2.27,
    });
    expect(state.action).toBe("hold");
    expect(state.nextWeightKg).toBe(84);
    expect(state.setsAtTop).toBe(2);
  });

  it("increases and resets to the low rep once all sets qualify", () => {
    const state = doubleProgressionState({
      weightKg: 84,
      sets: [
        { reps: 12, rir: 1 },
        { reps: 12, rir: 2 },
        { reps: 13, rir: 2 },
      ],
      target,
      incrementKg: 2.27,
    });
    expect(state.action).toBe("increase");
    expect(state.nextWeightKg).toBeCloseTo(86.27, 2);
    expect(state.nextReps).toBe(8);
  });

  it("does not count sets with poor form or effort above the RIR cap", () => {
    const state = doubleProgressionState({
      weightKg: 84,
      sets: [
        { reps: 12, cleanForm: false },
        { reps: 12, rir: 4 },
      ],
      target,
      incrementKg: 2.27,
      requiredRir: 2,
    });
    expect(state.action).toBe("hold");
    expect(state.setsAtTop).toBe(0);
  });
});

describe("heavy + backoff", () => {
  it("clamps the top set to 4-7 reps and the reduction to 10-25%", () => {
    const plan = heavyBackoffPlan({ topSetWeightKg: 100, topSetReps: 12, reductionPercent: 60 });
    expect(plan.topSet.reps).toBe(7);
    expect(plan.reductionPercent).toBe(25);
    expect(plan.backoffSets[0]!.weightKg).toBeCloseTo(75, 2);
    expect(plan.backoffSets[0]!.reps).toBeGreaterThanOrEqual(8);
  });

  it("quantizes backoff load on pound plates when an increment is given", () => {
    const plan = heavyBackoffPlan({ topSetWeightKg: 90.72, incrementLb: 5 });
    const lb = kgToLb(plan.backoffSets[0]!.weightKg);
    expect(Math.abs(lb - Math.round(lb / 5) * 5)).toBeLessThan(0.01);
  });
});

describe("volume progression", () => {
  it("adds sets only after a stable week", () => {
    expect(
      volumeProgression({ currentWeeklySets: 10, stableWeeks: 0, performanceTrend: "up" }).action,
    ).toBe("hold");
    const added = volumeProgression({
      currentWeeklySets: 10,
      stableWeeks: 1,
      performanceTrend: "up",
      averageReadiness: 75,
    });
    expect(added.action).toBe("add");
    expect(added.recommendedWeeklySets).toBe(12);
  });

  it("holds at the ceiling and reduces on decline", () => {
    expect(
      volumeProgression({ currentWeeklySets: 24, stableWeeks: 3, performanceTrend: "up" }).action,
    ).toBe("hold");
    const cut = volumeProgression({
      currentWeeklySets: 20,
      stableWeeks: 3,
      performanceTrend: "down",
    });
    expect(cut.action).toBe("reduce");
    expect(cut.recommendedWeeklySets).toBe(15);
  });
});

describe("real method composition", () => {
  const candidates = [
    { id: "bp", name: "Bench Press", muscle: "Chest", equipment: "Barbell" },
    { id: "row", name: "Cable Row", muscle: "Back", equipment: "Cable" },
    { id: "fly", name: "Cable Fly", muscle: "Chest", equipment: "Cable" },
    { id: "curl", name: "Dumbbell Curl", muscle: "Biceps", equipment: "Dumbbell" },
    { id: "push", name: "Cable Pushdown", muscle: "Triceps", equipment: "Cable" },
    { id: "pec", name: "Pec Deck", muscle: "Chest", equipment: "Machine" },
    { id: "press", name: "Machine Chest Press", muscle: "Chest", equipment: "Machine" },
    { id: "dl", name: "Conventional Deadlift", muscle: "Back", equipment: "Barbell" },
  ];
  const primary = candidates[0]!;

  it("pairs a real antagonist and never an axial barbell lift", () => {
    const partner = selectAntagonistPartner(primary, candidates);
    expect(partner?.name).toBe("Cable Row");
    expect(selectAntagonistPartner(primary, [primary, candidates[5]!])).toBeNull();
  });

  it("selects a real pre-exhaust isolation before the compound", () => {
    const plan = selectPreExhaustPlan(primary, candidates);
    expect(plan?.kind).toBe("pre-exhaust");
    expect(plan?.first.name).toBe("Cable Fly");
    expect(plan?.instructions[1]).toContain("Bench Press");
  });

  it("builds real triset/giant groups and refuses to invent stations", () => {
    const cablePrimary = candidates.find((c) => c.id === "fly")!;
    const triset = selectCircuitGroup({
      methodId: "trisets",
      primary: cablePrimary,
      candidates,
    });
    expect(triset!.stations).toHaveLength(3);
    expect(
      selectCircuitGroup({
        methodId: "giant-sets",
        primary: cablePrimary,
        candidates: [cablePrimary],
      }),
    ).toBeNull();
  });

  it("aggregates real weekly direct sets and gates volume increases", () => {
    const records = [
      ...Array.from({ length: 10 }, () => ({
        date: "2026-08-30",
        muscle: "Chest",
        weightKg: 100,
        reps: 8,
      })),
      ...Array.from({ length: 9 }, () => ({
        date: "2026-08-20",
        muscle: "Chest",
        weightKg: 95,
        reps: 8,
      })),
    ];
    const volume = weeklyDirectSets(records, { now: new Date("2026-08-31T00:00:00.000Z") });
    const rec = volumeRecommendationForMuscle({ muscle: "chest", volume, averageReadiness: 75 });
    expect(rec.currentWeeklySets).toBe(10);
    expect(rec.previousWeeklySets).toBe(9);
    expect(rec.trend).toBe("up");
    expect(["hold", "add"]).toContain(rec.action);
  });

  it("round-trips a bounded method config and drops junk", () => {
    const config = parseMethodConfig({
      partnerName: "Cable Row",
      drops: 99,
      stationNames: ["A", "B"],
      bogus: true,
    });
    expect(config.drops).toBeLessThanOrEqual(3);
    expect(serializeMethodConfig(config)).not.toHaveProperty("bogus");
  });

  it("produces executable set rows per method", () => {
    const heavy = methodSetPlan({
      methodId: "heavy-backoff",
      config: { topSetWeightKg: 100 },
      workingWeightKg: 100,
      plannedSets: 4,
      targetReps: 8,
    });
    expect(heavy!.rows.length).toBeGreaterThan(1);
    expect(heavy!.rows[1]!.weightKg!).toBeLessThan(heavy!.rows[0]!.weightKg!);
    expect(
      methodSetPlan({
        methodId: "straight-sets",
        config: {},
        workingWeightKg: 50,
        plannedSets: 3,
        targetReps: 8,
      }),
    ).toBeNull();
  });

  it("gates, plans, and expires an IronDesk Black window", () => {
    const expert = profile({ experience: "expert", sessionsLast28Days: 14, averageReadiness: 80 });
    expect(canOpenBlackWindow(expert).allowed).toBe(true);
    expect(canOpenBlackWindow(profile()).allowed).toBe(false);
    const plan = planBlackBlock({
      targetRegion: "Chest",
      candidates,
      startedOn: "2026-08-01",
      weeks: 9,
    });
    expect(plan!.weeks).toBeLessThanOrEqual(BLACK_MAX_WEEKS);
    expect(plan!.fatigue).toBeLessThanOrEqual(BLACK_FATIGUE_BUDGET);
    for (const id of plan!.modifierIds) expect(BLACK_SAFE_MODIFIERS).toContain(id);
    const state = blackWindowState({
      window: {
        id: "w",
        targetRegion: "chest",
        startedOn: plan!.startedOn,
        endsOn: plan!.endsOn,
        status: "active",
        modifierIds: plan!.modifierIds,
        exerciseNames: [],
      },
      profile: expert,
      now: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(state.status).toBe("expired");
    expect(state.exitRecommendation).toContain("Double Progression");
  });
});
