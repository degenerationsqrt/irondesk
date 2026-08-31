import { describe, expect, it, vi } from "vitest";

import {
  antagonistPartnerCandidates,
  blackModifierAllowsExercise,
  blackSetPlan,
  blackWeekStart,
  blackWindowState,
  canOpenBlackWindow,
  canRecordBlackExposure,
  circuitSlots,
  commitBlackApplication,
  currentBlackWindow,
  defaultMethodConfigFor,
  methodConfigNeedsResolution,
  parseBlackPrescriptions,
  parseMethodSegmentConfig,
  planBlackBlock,
  planBlackBlockResult,
  replaceCircuitStation,
  restSecondsForCompletedSet,
  selectCircuitGroup,
  stationCandidates,
  serializeMethodSegmentConfig,
  weeklyDirectSets,
  type MovementCandidate,
} from "@/lib/irondesk/method-composition";

const chest: MovementCandidate[] = [
  { id: "e1", name: "Cable Fly", muscle: "Chest", equipment: "Cable" },
  { id: "e2", name: "Incline Dumbbell Press", muscle: "Chest", equipment: "Dumbbell" },
  { id: "e3", name: "Machine Chest Press", muscle: "Chest", equipment: "Machine" },
  { id: "e4", name: "Barbell Row", muscle: "Back", equipment: "Barbell" },
  { id: "e5", name: "Lateral Raise", muscle: "Shoulders", equipment: "Dumbbell" },
];

describe("IronDesk Black", () => {
  const plan = planBlackBlock({
    targetRegion: "Chest",
    candidates: chest,
    startedOn: "2026-03-02",
    workingWeightKgByExerciseId: { e1: 30, e2: 40, e3: 60 },
  });

  it("composes exactly two safe modifiers inside the fatigue budget", () => {
    expect(plan).not.toBeNull();
    expect(plan!.modifierIds).toHaveLength(2);
    expect(new Set(plan!.modifierIds).size).toBe(2);
    expect(plan!.fatigue).toBeLessThanOrEqual(8);
  });

  it("assigns complete prescriptions to real stable exercise ids", () => {
    for (const prescription of plan!.prescriptions) {
      expect(chest.some((c) => c.id === prescription.exerciseId)).toBe(true);
      expect(prescription.sets).toBeGreaterThan(0);
      expect(prescription.reps).toBeGreaterThan(0);
      expect(prescription.loadPercent).toBeGreaterThan(0);
      expect(prescription.loadKg).toBeGreaterThan(0);
      expect(prescription.stopRule.length).toBeGreaterThan(10);
      expect(prescription.interSetRestSeconds).toBeGreaterThan(0);
    }
  });

  it("is deterministic across identical inputs", () => {
    const again = planBlackBlock({
      targetRegion: "Chest",
      candidates: chest,
      startedOn: "2026-03-02",
      workingWeightKgByExerciseId: { e1: 30, e2: 40, e3: 60 },
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(plan));
  });

  it("builds executable set rows with segments, loads and rests", () => {
    const prescription = plan!.prescriptions[0]!;
    const setPlan = blackSetPlan({ prescription, windowId: "w1", workingWeightKg: 40 });
    expect(setPlan.methodId).toBe("irondesk-black");
    expect(setPlan.rows.length).toBeGreaterThanOrEqual(prescription.sets);
    for (const row of setPlan.rows) {
      expect(row.segment).toBeTruthy();
      expect(row.segmentConfig?.blackWindowId).toBe("w1");
    }
  });

  it("persists prescriptions through bounded parsing", () => {
    const parsed = parseBlackPrescriptions(JSON.parse(JSON.stringify(plan!.prescriptions)));
    expect(parsed).toEqual(plan!.prescriptions);
    expect(parseBlackPrescriptions("nope")).toEqual([]);
  });

  it("allows only one exposure per region per ISO week", () => {
    const weekStart = blackWeekStart("2026-03-04");
    expect(weekStart).toBe("2026-03-02");
    const first = canRecordBlackExposure({
      targetRegion: "Chest",
      date: "2026-03-04",
      existing: [],
    });
    expect(first.allowed).toBe(true);
    const second = canRecordBlackExposure({
      targetRegion: "chest",
      date: "2026-03-06",
      existing: [{ targetRegion: "Chest", weekStart }],
    });
    expect(second.allowed).toBe(false);
    expect(second.reason).toContain("one per region per week");
  });

  it("never records an exposure when any verified workout write fails", async () => {
    const recordExposure = vi.fn(async () => undefined);
    const written: string[] = [];
    await expect(
      commitBlackApplication({
        targets: ["first", "second", "third"],
        writeTarget: async (target) => {
          written.push(target);
          if (target === "second") throw new Error("set update refused");
        },
        recordExposure,
      }),
    ).rejects.toThrow("set update refused");
    expect(written).toEqual(["first", "second"]);
    expect(recordExposure).not.toHaveBeenCalled();
  });

  it("records the exposure only after every workout write succeeds", async () => {
    const order: string[] = [];
    await commitBlackApplication({
      targets: ["first", "second"],
      writeTarget: async (target) => {
        order.push(`write:${target}`);
      },
      recordExposure: async () => {
        order.push("exposure");
      },
    });
    expect(order).toEqual(["write:first", "write:second", "exposure"]);
  });

  it("suspends on low readiness and expires past the end date", () => {
    const window = {
      id: "w1",
      targetRegion: "chest",
      startedOn: "2026-03-02",
      endsOn: "2026-03-16",
      status: "active" as const,
      modifierIds: plan!.modifierIds,
      exerciseNames: plan!.exercises.map((e) => e.name),
      prescriptions: plan!.prescriptions,
    };
    const profile = {
      experience: "expert" as const,
      sessionsLast28Days: 16,
      averageReadiness: 50,
    };
    expect(
      blackWindowState({ window, profile, now: new Date("2026-03-05T12:00:00Z") }).status,
    ).toBe("suspended");
    expect(
      blackWindowState({
        window,
        profile: { ...profile, averageReadiness: 80 },
        now: new Date("2026-03-20T12:00:00Z"),
      }),
    ).toMatchObject({ status: "expired" });
    expect(
      blackWindowState({
        window,
        profile: { ...profile, averageReadiness: 80 },
        now: new Date("2026-03-20T12:00:00Z"),
      }).exitRecommendation,
    ).toContain("Level 2");
  });
});

describe("segment persistence", () => {
  it("round-trips deterministically and rejects junk", () => {
    const config = {
      methodId: "rest-pause",
      restSeconds: 20,
      targetRir: 0,
      stopRule: "Stop below 2 reps.",
    };
    const serialized = serializeMethodSegmentConfig(config);
    expect(parseMethodSegmentConfig(serialized)).toEqual(config);
    expect(parseMethodSegmentConfig("oops")).toEqual({});
  });
});

describe("pairing safety", () => {
  it("never pairs a high-risk axial lift", () => {
    const squat: MovementCandidate = {
      id: "sq",
      name: "Back Squat",
      muscle: "Quads",
      equipment: "Barbell",
    };
    expect(antagonistPartnerCandidates(squat, [...chest, squat])).toEqual([]);
  });

  it("returns exactly three real station ids for a triset", () => {
    const group = selectCircuitGroup({
      methodId: "trisets",
      primary: chest[0]!,
      candidates: chest,
    });
    expect(group?.stations).toHaveLength(3);
    for (const station of group!.stations) {
      expect(chest.some((c) => c.id === station.id)).toBe(true);
    }
  });
});

describe("direct weekly volume", () => {
  it("counts bodyweight sets that carry no external load", () => {
    const now = new Date("2026-03-05T12:00:00Z");
    const volume = weeklyDirectSets(
      [
        { date: "2026-03-03", muscle: "Back", weightKg: 0, reps: 10 },
        { date: "2026-03-04", muscle: "Back", weightKg: 0, reps: 8 },
      ],
      { now },
    );
    expect(volume["back"]?.currentSets).toBe(2);
  });
});

describe("release-blocker remediation", () => {
  it("treats a suspended window as the current window", () => {
    const profile = { experience: "expert" as const, sessionsLast28Days: 16, averageReadiness: 80 };
    const suspended = {
      id: "w9",
      targetRegion: "chest",
      startedOn: "2026-03-02",
      endsOn: "2026-03-16",
      status: "suspended" as const,
      modifierIds: ["drop-sets", "rest-pause"],
      exerciseNames: ["Cable Fly"],
      prescriptions: [],
    };
    expect(currentBlackWindow([suspended])?.id).toBe("w9");
    expect(canOpenBlackWindow(profile, [suspended]).allowed).toBe(false);
  });

  it("never prescribes failure work or a failure modifier on a loaded compound", () => {
    const compoundOnly: MovementCandidate[] = [
      { id: "c1", name: "Incline Dumbbell Press", muscle: "Chest", equipment: "Dumbbell" },
      { id: "c2", name: "Machine Chest Press", muscle: "Chest", equipment: "Machine" },
      { id: "c3", name: "Cable Fly", muscle: "Chest", equipment: "Cable" },
    ];
    const result = planBlackBlockResult({
      targetRegion: "Chest",
      candidates: compoundOnly,
      startedOn: "2026-03-02",
    });
    expect(result.plan).not.toBeNull();
    for (const p of result.plan!.prescriptions) {
      const candidate = compoundOnly.find((c) => c.id === p.exerciseId)!;
      expect(blackModifierAllowsExercise(p.modifierId, candidate)).toBe(true);
      if (candidate.equipment !== "Cable") {
        expect(p.modifierId).toBe("eccentric-emphasis");
        expect(p.expectedRir).toBeGreaterThanOrEqual(1);
      }
    }
    expect(new Set(result.plan!.modifierIds).size).toBe(2);
  });

  it("explains why a Black block cannot be built", () => {
    const result = planBlackBlockResult({
      targetRegion: "Quads",
      candidates: [{ id: "sq", name: "Back Squat", muscle: "Quads", equipment: "Barbell" }],
      startedOn: "2026-03-02",
    });
    expect(result.plan).toBeNull();
    expect(result.reason).toBeTruthy();
  });

  it("blocks Black application while a window is suspended and resumes with recovery", () => {
    const window = {
      id: "w1",
      targetRegion: "chest",
      startedOn: "2026-03-02",
      endsOn: "2026-03-16",
      status: "suspended" as const,
      modifierIds: ["drop-sets", "rest-pause"],
      exerciseNames: ["Cable Fly"],
      prescriptions: [],
    };
    const low = blackWindowState({
      window,
      profile: { experience: "expert", sessionsLast28Days: 16, averageReadiness: 50 },
      now: new Date("2026-03-05T12:00:00Z"),
    });
    expect(low.canApply).toBe(false);
    expect(low.resumeRequirement).toBeTruthy();
    const back = blackWindowState({
      window,
      profile: { experience: "expert", sessionsLast28Days: 16, averageReadiness: 80 },
      now: new Date("2026-03-05T12:00:00Z"),
    });
    expect(back.status).toBe("active");
    expect(back.canApply).toBe(true);
  });

  it("prefers the segment's own rest, including an explicit zero", () => {
    expect(
      restSecondsForCompletedSet({
        segmentConfig: { restSeconds: 0 },
        exerciseRestSeconds: 180,
      }),
    ).toBe(0);
    expect(restSecondsForCompletedSet({ exerciseRestSeconds: 180 })).toBe(180);
    expect(restSecondsForCompletedSet({})).toBe(120);
  });

  it("ranks in-session movements ahead of library movements", () => {
    const primary: MovementCandidate = {
      id: "p",
      name: "Zzz Cable Fly",
      muscle: "Chest",
      equipment: "Cable",
      source: "session",
    };
    const pool = stationCandidates({
      methodId: "trisets",
      primary,
      candidates: [
        {
          id: "l1",
          name: "Aaa Machine Press",
          muscle: "Chest",
          equipment: "Machine",
          source: "library",
        },
        {
          id: "s1",
          name: "Bbb Machine Fly",
          muscle: "Chest",
          equipment: "Machine",
          source: "session",
        },
      ],
    });
    expect(pool.map((c) => c.id)).toEqual(["s1", "l1"]);
  });

  it("keeps the primary pinned and never shrinks a triset", () => {
    const primary = chest[0]!;
    const slots = circuitSlots({ methodId: "trisets", primary });
    expect(slots.total).toBe(3);
    expect(slots.stationIds[0]).toBe(primary.id);
    expect(slots.complete).toBe(false);

    const pinned = replaceCircuitStation({
      methodId: "trisets",
      primary,
      slotIndex: 0,
      choice: chest[1]!,
    });
    expect(pinned.reason).toContain("primary");

    const one = replaceCircuitStation({
      methodId: "trisets",
      primary,
      slotIndex: 1,
      choice: chest[2]!,
    });
    expect(one.stationIds).toEqual([primary.id, chest[2]!.id]);
    const two = replaceCircuitStation({
      methodId: "trisets",
      primary,
      stationIds: one.stationIds,
      stationNames: one.stationNames,
      slotIndex: 2,
      choice: chest[1]!,
    });
    expect(two.complete).toBe(true);
    expect(two.stationIds).toHaveLength(3);
    const dup = replaceCircuitStation({
      methodId: "trisets",
      primary,
      stationIds: two.stationIds,
      stationNames: two.stationNames,
      slotIndex: 1,
      choice: chest[1]!,
    });
    expect(dup.reason).toContain("already holds station");
    expect(dup.stationIds).toHaveLength(3);
  });

  it("materializes validated defaults for dosing methods and flags pairing methods", () => {
    expect(defaultMethodConfigFor("drop-sets")).toEqual({ drops: 2, dropPercent: 20 });
    expect(defaultMethodConfigFor("double-progression")).toEqual({});
    expect(methodConfigNeedsResolution("trisets", defaultMethodConfigFor("trisets"))).toBe(true);
    expect(methodConfigNeedsResolution("drop-sets", defaultMethodConfigFor("drop-sets"))).toBe(
      false,
    );
  });
});
