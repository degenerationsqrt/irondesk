import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/imports/csv";
import { applyMapping, guessMapping } from "@/lib/imports/mapping";
import { importRecordTypeLabel, importRecordValueLabel } from "@/lib/imports/presentation";
import type { NormalizedActivity, NormalizedMetric } from "@/lib/imports/types";

const bodyweight: NormalizedMetric = {
  kind: "metric",
  externalId: "weight-1",
  metricType: "bodyweight_kg",
  recordedAt: "2026-08-29T14:00:00Z",
  sourceTimezone: "America/Los_Angeles",
  value: 85,
  unit: "kg",
  notes: null,
  raw: {},
};

const run: NormalizedActivity = {
  kind: "activity",
  externalId: "run-1",
  activityType: "run",
  name: "Morning run",
  startedAt: "2026-08-29T14:00:00Z",
  sourceTimezone: "America/Los_Angeles",
  durationSec: 1_800,
  distanceM: 5_000,
  calories: 350,
  avgHr: 145,
  maxHr: 168,
  elevationGainM: null,
  steps: null,
  notes: null,
  raw: {},
};

describe("import preview presentation", () => {
  it("shows canonical Health Connect bodyweight in the athlete's preferred unit", () => {
    expect(importRecordTypeLabel(bodyweight)).toBe("Bodyweight");
    expect(importRecordValueLabel(bodyweight, "imperial")).toBe("187.4 lb");
    expect(importRecordValueLabel(bodyweight, "metric")).toBe("85 kg");
  });

  it("shows imported distance in miles for imperial and kilometers for metric", () => {
    expect(importRecordValueLabel(run, "imperial")).toBe("30 min · 3.11 mi · 350 kcal");
    expect(importRecordValueLabel(run, "metric")).toBe("30 min · 5.00 km · 350 kcal");
  });

  it("presents a clock-duration activity with a per-cell mile distance correctly", () => {
    const table = parseCsv(
      [
        "Activity ID,Activity Type,Date,Title,Distance,Calories,Time,Avg HR,Max HR",
        "900002,Running,2026-07-21 07:30:00,Morning Run,3.10 mi,505,00:28:45,148,177",
      ].join("\n"),
    );
    const activity = applyMapping(table, guessMapping(table.headers))
      .records[0] as NormalizedActivity;

    expect(importRecordTypeLabel(activity)).toBe("running");
    expect(importRecordValueLabel(activity, "imperial")).toBe("29 min · 3.10 mi · 505 kcal");
    expect(importRecordValueLabel(activity, "metric")).toBe("29 min · 4.99 km · 505 kcal");
  });
});
