import { describe, expect, it } from "vitest";

import { toKg } from "../src/lib/irondesk/units";
import {
  averageCompletedRpe,
  averageValidRpe,
  firstWorkoutSetValueIssue,
  isValidReps,
  isValidRestSeconds,
  isValidRpe,
  isValidWeightKg,
  parseRepsDraft,
  parseRestSecondsDraft,
  parseRpeDraft,
  parseWeightDraft,
} from "../src/lib/irondesk/workout-values";

describe("workout value validation", () => {
  it.each([
    ["", null],
    ["   ", null],
    ["1", 1],
    ["7.5", 7.5],
    ["10", 10],
  ])("parses valid optional RPE draft %j", (draft, expected) => {
    expect(parseRpeDraft(draft)).toEqual({ ok: true, value: expected });
  });

  it.each(["0", "8.25", "10.5", "11.5", "NaN", "Infinity", "1e1", "8 reps"])(
    "rejects invalid RPE draft %j",
    (draft) => {
      expect(parseRpeDraft(draft)).toMatchObject({
        ok: false,
        message: "RPE must be blank or a number from 1 to 10 in 0.5 increments.",
      });
    },
  );

  it("rejects non-finite and malformed runtime RPE values", () => {
    expect(isValidRpe(null)).toBe(true);
    expect(isValidRpe(Number.NaN)).toBe(false);
    expect(isValidRpe(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidRpe("8")).toBe(false);
  });

  it("returns the exact first invalid mutation field and value for correction", () => {
    expect(firstWorkoutSetValueIssue({ weightKg: 100, reps: 5, rpe: 11.5 })).toEqual({
      field: "rpe",
      value: 11.5,
      message: "RPE must be blank or a number from 1 to 10 in 0.5 increments.",
    });
    expect(firstWorkoutSetValueIssue({ weightKg: 100, reps: 5, rpe: null })).toBeNull();
  });

  it("enforces reps and rest integer ranges without turning a cleared reps field into zero", () => {
    expect(parseRepsDraft("0")).toEqual({ ok: true, value: 0 });
    expect(parseRepsDraft("500")).toEqual({ ok: true, value: 500 });
    expect(parseRepsDraft("").ok).toBe(false);
    expect(parseRepsDraft("1.5").ok).toBe(false);
    expect(parseRepsDraft("501").ok).toBe(false);
    expect(isValidReps(Number.NaN)).toBe(false);

    expect(parseRestSecondsDraft("")).toEqual({ ok: true, value: null });
    expect(parseRestSecondsDraft("0")).toEqual({ ok: true, value: 0 });
    expect(parseRestSecondsDraft("3600")).toEqual({ ok: true, value: 3_600 });
    expect(parseRestSecondsDraft("3601").ok).toBe(false);
    expect(parseRestSecondsDraft("2.5").ok).toBe(false);
    expect(isValidRestSeconds(null)).toBe(true);
  });

  it("validates weight after converting the displayed value to kilograms", () => {
    expect(parseWeightDraft("1000")).toEqual({ ok: true, value: 1_000 });
    expect(parseWeightDraft("-0.5").ok).toBe(false);
    expect(parseWeightDraft("").ok).toBe(false);
    expect(parseWeightDraft("Infinity").ok).toBe(false);
    expect(parseWeightDraft("2204.62", (value) => toKg(value, "imperial"))).toEqual({
      ok: true,
      value: 1_000,
    });
    expect(parseWeightDraft("2204.7", (value) => toKg(value, "imperial")).ok).toBe(false);
    expect(parseWeightDraft("1", () => Number.NaN).ok).toBe(false);
    expect(isValidWeightKg(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("RPE averages", () => {
  it("ignores blank and invalid values and never lets them distort the scale", () => {
    expect(averageValidRpe([null, 8, 9.5, 0, 10.5, 11.5, 8.25, Number.NaN, Infinity])).toBe(8.75);
    expect(averageValidRpe([null, 0, 11.5, Number.NaN])).toBeNull();
  });

  it("uses valid RPE only from completed sets", () => {
    const sets = [
      { done: true, rpe: null },
      { done: true, rpe: 8 },
      { done: false, rpe: 10 },
      { done: true, rpe: 9 },
      { done: true, rpe: 11.5 as number | null },
    ];
    expect(averageCompletedRpe(sets)).toBe(8.5);
    expect(averageCompletedRpe([{ done: true, rpe: null }])).toBeNull();
  });
});
