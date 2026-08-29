import { describe, expect, it } from "vitest";

import {
  cardioDistanceFromKm,
  normalizeCardioLog,
  type CardioLogDraft,
} from "../src/lib/irondesk/cardio-log";

const base = (patch: Partial<CardioLogDraft> = {}): CardioLogDraft => ({
  activityType: "Run",
  localStartedAt: "2026-08-28T18:30",
  durationMin: 42,
  distance: null,
  calories: null,
  avgHr: null,
  maxHr: null,
  activeZoneMinutes: null,
  cardioLoad: null,
  notes: "",
  ...patch,
});

describe("manual cardio normalization", () => {
  it("stores canonical kilometers and athlete-local time while preserving missing evidence", () => {
    const result = normalizeCardioLog(base({ distance: 3.1 }), "imperial", "America/Los_Angeles");
    expect(result).toMatchObject({
      name: "Run",
      startedAt: "2026-08-29T01:30:00.000Z",
      durationMin: 42,
      calories: null,
      avgHr: null,
      maxHr: null,
      activeZoneMinutes: null,
      cardioLoad: null,
      notes: null,
    });
    expect(result.distanceKm).toBe(4.99);
    expect(cardioDistanceFromKm(result.distanceKm!, "imperial")).toBeCloseTo(3.10064, 5);
  });

  it("accepts measured evidence without deriving any absent field", () => {
    expect(
      normalizeCardioLog(
        base({ calories: 410, avgHr: 142, maxHr: 174, activeZoneMinutes: 31, cardioLoad: 92 }),
        "metric",
        "UTC",
      ),
    ).toMatchObject({
      calories: 410,
      avgHr: 142,
      maxHr: 174,
      activeZoneMinutes: 31,
      cardioLoad: 92,
      distanceKm: null,
    });
  });

  it("requires a real duration and rejects contradictory heart-rate evidence", () => {
    expect(() => normalizeCardioLog(base({ durationMin: 0 }), "metric", "UTC")).toThrow(
      "Duration must be a whole number",
    );
    expect(() => normalizeCardioLog(base({ avgHr: 170, maxHr: 160 }), "metric", "UTC")).toThrow(
      "Maximum heart rate cannot be lower",
    );
  });

  it("requires a custom name for Other and rejects zone time beyond duration", () => {
    expect(() =>
      normalizeCardioLog(base({ activityType: "Other", customName: "" }), "metric", "UTC"),
    ).toThrow("Enter an activity name");
    expect(() => normalizeCardioLog(base({ activeZoneMinutes: 43 }), "metric", "UTC")).toThrow(
      "no greater than the workout duration",
    );
  });

  it("rounds canonical distance to the schema scale and enforces integer load", () => {
    expect(normalizeCardioLog(base({ distance: 1.234 }), "metric", "UTC").distanceKm).toBe(1.23);
    expect(() => normalizeCardioLog(base({ distance: 6_214 }), "imperial", "UTC")).toThrow(
      "maximum 9,999.99 canonical kilometers",
    );
    expect(() => normalizeCardioLog(base({ cardioLoad: 92.4 }), "metric", "UTC")).toThrow(
      "whole number",
    );
  });
});
