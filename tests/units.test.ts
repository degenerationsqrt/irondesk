import { describe, expect, it } from "vitest";

import {
  DEFAULT_UNITS,
  defaultSetWeightKg,
  formatLoadGuidance,
  formatWeight,
  formatWeightText,
  formatWeightedSet,
  fromKg,
  kgToLb,
  lbToKg,
  resolveUnits,
  toKg,
} from "@/lib/irondesk/units";

describe("unit preference defaults", () => {
  it("defaults missing and invalid preferences to imperial", () => {
    expect(DEFAULT_UNITS).toBe("imperial");
    expect(resolveUnits(undefined)).toBe("imperial");
    expect(resolveUnits(null)).toBe("imperial");
    expect(resolveUnits("unknown")).toBe("imperial");
  });

  it("preserves either explicit supported preference", () => {
    expect(resolveUnits("metric")).toBe("metric");
    expect(resolveUnits("imperial")).toBe("imperial");
    expect(resolveUnits(undefined, "metric")).toBe("metric");
  });
});

describe("canonical kilogram conversion", () => {
  it("round-trips pound input through canonical kilograms", () => {
    expect(kgToLb(100)).toBeCloseTo(220.46226218, 8);
    expect(lbToKg(220.46226218)).toBeCloseTo(100, 8);
    expect(toKg(225, "imperial")).toBe(102.06);
    expect(fromKg(toKg(225, "imperial"), "imperial")).toBe(225);
  });

  it("keeps metric inputs canonical", () => {
    expect(toKg(150, "metric")).toBe(150);
    expect(fromKg(150, "metric")).toBe(150);
  });

  it("uses plate-friendly empty-set defaults in either display system", () => {
    expect(defaultSetWeightKg("imperial")).toBe(20.41);
    expect(fromKg(defaultSetWeightKg("imperial"), "imperial")).toBe(45);
    expect(defaultSetWeightKg("metric")).toBe(20);
  });

  it("formats canonical bodyweight with an explicit display unit", () => {
    expect(formatWeight(85, "imperial")).toBe("187.4 lb");
    expect(formatWeight(85, "metric")).toBe("85 kg");
    expect(formatWeightedSet(toKg(225, "imperial"), 5, "imperial")).toBe("225 lb × 5");
  });
});

describe("formatWeightText", () => {
  it("returns metric prose byte-for-byte unchanged", () => {
    const text = "Est. 1RM 165 kg (+3.5 kg); range 100–110 kg.";
    expect(formatWeightText(text, "metric")).toBe(text);
  });

  it("converts signed and ordinary embedded kilogram snippets", () => {
    expect(formatWeightText("Repeat +25 kg, then 150 kg.", "imperial")).toBe(
      "Repeat +55.1 lb, then 330.7 lb.",
    );
    expect(formatWeightText("Est. 1RM 165 kg (+3.5 kg)", "imperial")).toBe(
      "Est. 1RM 363.8 lb (+7.7 lb)",
    );
  });

  it("handles thousands separators, ranges, and multiple range separators", () => {
    expect(formatWeightText("Volume 14,820 kg", "imperial")).toBe("Volume 32,672.5 lb");
    expect(formatWeightText("Work at 100–110 kg", "imperial")).toBe("Work at 220.5–242.5 lb");
    expect(formatWeightText("Work at 100 to 110 kg", "imperial")).toBe("Work at 220.5 to 242.5 lb");
  });

  it("leaves non-weight kg notation and unit-free text alone", () => {
    expect(formatWeightText("VO2 max 51.2 ml/kg/min", "imperial")).toBe("VO2 max 51.2 ml/kg/min");
    expect(formatWeightText("Bodyweight movement", "imperial")).toBe("Bodyweight movement");
  });
});

describe("legacy load guidance", () => {
  it("shows pound-native guidance unchanged for imperial users", () => {
    expect(formatLoadGuidance("315–345", "lb", "imperial")).toEqual({ text: "315–345 lb" });
  });

  it("converts legacy pounds for an explicit metric preference", () => {
    expect(formatLoadGuidance("315–345", "lb", "metric")).toEqual({
      text: "143–156 kg",
      source: "315–345 lb",
    });
  });
});
