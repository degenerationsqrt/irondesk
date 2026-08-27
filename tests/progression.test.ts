import { describe, expect, it } from "vitest";

import {
  classifyLift,
  detectStall,
  loadIncrementKg,
  lookupPoints,
  parseTargetReps,
  performanceKey,
  readinessAdjustment,
  suggestWorkingWeight,
  type PerformancePoint,
} from "@/lib/irondesk/progression";
import { demoProgressionContext, parseDemoHistoryDetail } from "@/lib/irondesk/progression-source";
import { exercises } from "@/lib/irondesk/data";

const point = (date: string, weightKg: number, reps: number, rpe: number | null = null): PerformancePoint => ({
  date,
  weightKg,
  reps,
  rpe,
  sets: 3,
});

const NOW = new Date("2026-08-28T12:00:00.000Z");

describe("classification", () => {
  it("treats barbell main lifts as main", () => {
    expect(classifyLift({ name: "Back Squat", equipment: "Barbell", pattern: "Squat" })).toBe("main");
    expect(classifyLift({ name: "Conventional Deadlift", equipment: "Barbell", pattern: "Hinge" })).toBe("main");
  });

  it("treats isolation work as accessory and bodyweight as bodyweight", () => {
    expect(classifyLift({ name: "Cable Lateral Raise", equipment: "Cable", pattern: "Isolation" })).toBe("accessory");
    expect(classifyLift({ name: "Pull-up", equipment: "Bodyweight", pattern: "Vertical Pull" })).toBe("bodyweight");
  });

  it("scales the increment to the equipment", () => {
    expect(loadIncrementKg("Barbell", "main")).toBe(2.5);
    expect(loadIncrementKg("Dumbbell")).toBe(2);
    expect(loadIncrementKg("Bodyweight")).toBe(0);
  });
});

describe("rep targets", () => {
  it("parses ranges, single values and prose", () => {
    expect(parseTargetReps("8-10")).toEqual({ low: 8, high: 10 });
    expect(parseTargetReps("12")).toEqual({ low: 12, high: 12 });
    expect(parseTargetReps("8 each side")).toEqual({ low: 8, high: 8 });
    expect(parseTargetReps("AMRAP")).toEqual({ low: 8, high: 10 });
  });
});

describe("readiness coupling", () => {
  it("stays inside +/-7% and is always labelled when non-zero", () => {
    for (const readiness of [0, 20, 44, 50, 65, 80, 90, 100]) {
      const { percent, label } = readinessAdjustment(readiness);
      expect(Math.abs(percent)).toBeLessThanOrEqual(7);
      if (percent !== 0) expect(label).toBeTruthy();
    }
    expect(readinessAdjustment(null).percent).toBe(0);
  });
});

describe("stall detection", () => {
  it("flags three sessions at the same load without rep progress", () => {
    const stalled = detectStall([
      point("2026-08-10", 100, 5),
      point("2026-08-17", 100, 5),
      point("2026-08-24", 100, 5),
    ]);
    expect(stalled).toEqual({ stalled: true, sessions: 3 });
  });

  it("does not flag rising loads or rising reps", () => {
    expect(
      detectStall([point("2026-08-10", 95, 5), point("2026-08-17", 100, 5), point("2026-08-24", 102.5, 5)]).stalled,
    ).toBe(false);
    expect(
      detectStall([point("2026-08-10", 100, 5), point("2026-08-17", 100, 6), point("2026-08-24", 100, 7)]).stalled,
    ).toBe(false);
  });
});

describe("suggestWorkingWeight", () => {
  it("returns null without usable history for a loaded movement", () => {
    expect(
      suggestWorkingWeight({ name: "Back Squat", equipment: "Barbell", targetReps: "5", points: [], now: NOW }),
    ).toBeNull();
  });

  it("progresses a main lift linearly by one increment", () => {
    const s = suggestWorkingWeight({
      name: "Back Squat",
      equipment: "Barbell",
      pattern: "Squat",
      targetReps: "5",
      points: [point("2026-08-14", 120, 5, 7), point("2026-08-21", 122.5, 5, 7.5)],
      now: NOW,
    })!;
    expect(s.rule).toBe("linear");
    expect(s.weightKg).toBe(125);
    expect(s.reps).toBe(5);
  });

  it("uses double progression for accessories", () => {
    const reps = suggestWorkingWeight({
      name: "Dumbbell Row",
      equipment: "Dumbbell",
      targetReps: "8-12",
      points: [point("2026-08-21", 32, 9, 7)],
      now: NOW,
    })!;
    expect(reps.rule).toBe("double-progression-reps");
    expect(reps.weightKg).toBe(32);
    expect(reps.reps).toBe(10);

    const load = suggestWorkingWeight({
      name: "Dumbbell Row",
      equipment: "Dumbbell",
      targetReps: "8-12",
      points: [point("2026-08-21", 32, 12, 7)],
      now: NOW,
    })!;
    expect(load.rule).toBe("double-progression-load");
    expect(load.weightKg).toBe(34);
    expect(load.reps).toBe(8);
  });

  it("holds load after a maximal effort", () => {
    const s = suggestWorkingWeight({
      name: "Bench Press",
      equipment: "Barbell",
      targetReps: "5",
      points: [point("2026-08-21", 100, 5, 10)],
      now: NOW,
    })!;
    expect(s.rule).toBe("hold-high-effort");
    expect(s.weightKg).toBe(100);
  });

  it("deloads 10% on a stall and ignores readiness while deloading", () => {
    const s = suggestWorkingWeight({
      name: "Back Squat",
      equipment: "Barbell",
      targetReps: "5",
      points: [point("2026-08-07", 100, 5, 9), point("2026-08-14", 100, 5, 9), point("2026-08-21", 100, 5, 9)],
      readiness: 30,
      now: NOW,
    })!;
    expect(s.rule).toBe("deload-stall");
    expect(s.deload).toBe(true);
    expect(s.weightKg).toBe(90);
    expect(s.readinessPercent).toBe(0);
  });

  it("pulls load back on low readiness within bounds", () => {
    const s = suggestWorkingWeight({
      name: "Back Squat",
      equipment: "Barbell",
      targetReps: "5",
      points: [point("2026-08-14", 120, 5, 7), point("2026-08-21", 120, 6, 7)],
      readiness: 40,
      now: NOW,
    })!;
    expect(s.readinessPercent).toBe(-7);
    expect(s.notes.join(" ")).toContain("readiness");
    expect(s.weightKg).toBeLessThan(122.5);
    expect(s.weightKg).toBeGreaterThan(112);
  });

  it("never exceeds the last load after a long layoff and reports low confidence", () => {
    const s = suggestWorkingWeight({
      name: "Back Squat",
      equipment: "Barbell",
      targetReps: "5",
      points: [point("2026-01-10", 120, 5, 7)],
      now: NOW,
    })!;
    expect(s.weightKg).toBeLessThanOrEqual(120);
    expect(s.confidence).toBe("low");
    expect(s.staleDays).toBeGreaterThan(45);
  });
});

describe("demo adapter", () => {
  it("parses stored demo history lines", () => {
    expect(parseDemoHistoryDetail("2026-08-26", "5×3 @ 150 kg · RPE 8")).toEqual({
      date: "2026-08-26",
      sets: 5,
      reps: 3,
      weightKg: 150,
      rpe: 8,
      });
    expect(parseDemoHistoryDetail("2026-08-26", "3×10 bodyweight")).toBeNull();
  });

  it("builds a demo context keyed by id and name", () => {
    const context = demoProgressionContext(exercises, 74);
    expect(context.readiness).toBe(74);
    expect(lookupPoints(context.performance, { exerciseId: "back-squat" }).length).toBeGreaterThan(0);
    expect(lookupPoints(context.performance, { name: "Back Squat" }).length).toBeGreaterThan(0);
    expect(performanceKey("  Back   Squat ")).toBe("back squat");
  });

  it("produces a suggestion for a demo movement", () => {
    const context = demoProgressionContext(exercises, 74);
    const s = suggestWorkingWeight({
      name: "Back Squat",
      equipment: "Barbell",
      pattern: "Squat",
      targetReps: "3-5",
      points: lookupPoints(context.performance, { name: "Back Squat" }),
      readiness: context.readiness,
      now: new Date("2026-08-27T12:00:00.000Z"),
    });
    expect(s).not.toBeNull();
    expect(s!.weightKg).toBeGreaterThan(100);
  });
});
