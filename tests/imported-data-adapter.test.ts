import { describe, expect, it } from "vitest";

import {
  classifyImportedActivity,
  dedupeImportedRows,
  excludeLikelyMirroredActivities,
  healthMetricSummaryForLocalDay,
  importedActivitiesForLocalDay,
  importedActivityToDashboard,
  isInLocalDay,
  isIsoDayKey,
  localDayKey,
  summarizeHealthMetricsByDay,
  type HealthMetricRow,
  type ImportedActivityRow,
} from "../src/lib/irondesk/imported-data-adapter";

const activityRow = (overrides: Partial<ImportedActivityRow> = {}): ImportedActivityRow => ({
  id: "activity-row-1",
  external_id: "provider-activity-1",
  activity_type: "running",
  name: "Evening run",
  started_at: "2026-08-29T01:30:00.000Z",
  source_timezone: "America/Los_Angeles",
  duration_sec: 3_605,
  distance_m: 8_200,
  elevation_gain_m: 125,
  calories: 431,
  avg_hr: 148,
  max_hr: 172,
  steps: 8_940,
  notes: "Progression run",
  source_type: "health_connect",
  source_file_name: "device:Pixel",
  import_job_id: "job-1",
  dedupe_hash: "ext:health_connect:provider-activity-1",
  normalized_version: 1,
  raw_metadata: {},
  user_id: "user-1",
  imported_at: "2026-08-29T02:00:00.000Z",
  created_at: "2026-08-29T02:00:00.000Z",
  updated_at: "2026-08-29T02:00:00.000Z",
  ...overrides,
});

const metricRow = (overrides: Partial<HealthMetricRow> = {}): HealthMetricRow => ({
  id: "metric-row-1",
  external_id: "provider-metric-1",
  metric_type: "steps",
  recorded_at: "2026-08-29T01:30:00.000Z",
  source_timezone: "America/Los_Angeles",
  value: 5_000,
  unit: "count",
  source_type: "health_connect",
  source_file_name: "device:Pixel",
  notes: null,
  import_job_id: "job-1",
  dedupe_hash: "ext:health_connect:provider-metric-1",
  normalized_version: 1,
  raw_metadata: {},
  user_id: "user-1",
  imported_at: "2026-08-29T02:00:00.000Z",
  created_at: "2026-08-29T02:00:00.000Z",
  updated_at: "2026-08-29T02:00:00.000Z",
  ...overrides,
});

describe("imported activity classification", () => {
  it("separates explicit cardio, strength, mobility, and conditioning labels", () => {
    expect(classifyImportedActivity("running")).toBe("cardio");
    expect(classifyImportedActivity("strength_training")).toBe("strength");
    expect(classifyImportedActivity("yoga")).toBe("mobility");
    expect(classifyImportedActivity("other", "Mobility flow")).toBe("mobility");
    expect(classifyImportedActivity("high_intensity_interval_training")).toBe("conditioning");
  });

  it("uses a descriptive name for a generic provider type but does not guess unknown labels", () => {
    expect(classifyImportedActivity("other", "Upper body weightlifting")).toBe("strength");
    expect(classifyImportedActivity("other", "Meditation")).toBe("unknown");
  });
});

describe("local day helpers", () => {
  it("supports IANA zones and fixed offsets across a UTC day boundary", () => {
    const instant = "2026-08-29T01:30:00.000Z";
    expect(localDayKey(instant, "America/Los_Angeles")).toBe("2026-08-28");
    expect(localDayKey(instant, "-07:00")).toBe("2026-08-28");
    expect(isInLocalDay(instant, "2026-08-28", "America/Los_Angeles")).toBe(true);
    expect(isInLocalDay(instant, "2026-08-29", "America/Los_Angeles")).toBe(false);
  });

  it("tries an explicit fallback zone, then UTC, and rejects unreadable dates", () => {
    const instant = "2026-08-29T01:30:00.000Z";
    expect(localDayKey(instant, "Not/AZone", "America/Los_Angeles")).toBe("2026-08-28");
    expect(localDayKey(instant, "Not/AZone", "Also/Invalid")).toBe("2026-08-29");
    expect(localDayKey("not-a-date", "UTC")).toBeNull();
    expect(isIsoDayKey("2026-02-29")).toBe(false);
    expect(isIsoDayKey("2028-02-29")).toBe(true);
  });
});

describe("imported activity dashboard adapter", () => {
  it("preserves imported duration, calories, and heart rate without fabricating absent dashboard fields", () => {
    const adapted = importedActivityToDashboard(activityRow());
    expect(adapted).toMatchObject({
      id: "activity-row-1",
      externalId: "provider-activity-1",
      kind: "cardio",
      localDay: "2026-08-28",
      durationSec: 3_605,
      calories: 431,
      avgHr: 148,
      maxHr: 172,
    });
    expect(adapted.durationMinutes).toBeCloseTo(60.0833, 4);
    expect(adapted).not.toHaveProperty("cardioLoad");
    expect(adapted).not.toHaveProperty("zones");
  });

  it("keeps missing imported measurements null instead of turning them into zero", () => {
    const adapted = importedActivityToDashboard(
      activityRow({
        duration_sec: null,
        calories: null,
        avg_hr: null,
        max_hr: null,
        distance_m: null,
      }),
    );
    expect(adapted.durationMinutes).toBeNull();
    expect(adapted.durationSec).toBeNull();
    expect(adapted.calories).toBeNull();
    expect(adapted.avgHr).toBeNull();
    expect(adapted.maxHr).toBeNull();
    expect(adapted.distanceM).toBeNull();
  });

  it("dedupes by row id or source-scoped external id and filters on the source-local day", () => {
    const original = activityRow();
    const duplicateRowId = activityRow({ external_id: "different-provider-id" });
    const duplicateExternalId = activityRow({ id: "activity-row-2" });
    const sameProviderIdFromAnotherSource = activityRow({
      id: "activity-row-3",
      source_type: "garmin_file",
      dedupe_hash: "ext:garmin_file:provider-activity-1",
    });
    const nextDay = activityRow({
      id: "activity-row-4",
      external_id: "provider-activity-4",
      started_at: "2026-08-29T08:30:00.000Z",
    });

    const deduped = dedupeImportedRows([
      original,
      duplicateRowId,
      duplicateExternalId,
      sameProviderIdFromAnotherSource,
    ]);
    expect(deduped.map((row) => row.id)).toEqual(["activity-row-1", "activity-row-3"]);

    const today = importedActivitiesForLocalDay(
      [original, duplicateRowId, duplicateExternalId, sameProviderIdFromAnotherSource, nextDay],
      "2026-08-28",
    );
    expect(today.map((row) => row.id)).toEqual(["activity-row-1", "activity-row-3"]);
  });

  it("removes only conservative native-session mirrors", () => {
    const imported = importedActivityToDashboard(activityRow());
    expect(
      excludeLikelyMirroredActivities(
        [imported],
        [{ name: "Evening run", startedAt: "2026-08-29T01:31:00.000Z", durationMinutes: 61 }],
      ),
    ).toEqual([]);
    expect(
      excludeLikelyMirroredActivities(
        [imported],
        [{ name: "Evening run", startedAt: "2026-08-29T01:31:00.000Z", durationMinutes: null }],
      ),
    ).toEqual([imported]);
  });
});

describe("health metric day summaries", () => {
  it("converts all supported metric types with explicit total/latest semantics and evidence", () => {
    const rows: HealthMetricRow[] = [
      metricRow({
        id: "sleep-1",
        external_id: "sleep-1",
        metric_type: "sleep_minutes",
        value: 420,
        unit: "min",
      }),
      metricRow({
        id: "sleep-2",
        external_id: "sleep-2",
        metric_type: "sleep_minutes",
        recorded_at: "2026-08-29T03:00:00.000Z",
        value: 30,
        unit: "min",
      }),
      metricRow({
        id: "rhr-1",
        external_id: "rhr-1",
        metric_type: "resting_hr",
        value: 51,
        unit: "bpm",
      }),
      metricRow({
        id: "rhr-2",
        external_id: "rhr-2",
        metric_type: "resting_hr",
        recorded_at: "2026-08-29T04:00:00.000Z",
        value: 49,
        unit: "bpm",
      }),
      metricRow({
        id: "hrv-1",
        external_id: "hrv-1",
        metric_type: "hrv_ms",
        value: 56.4,
        unit: "ms",
      }),
      metricRow({
        id: "weight-1",
        external_id: "weight-1",
        metric_type: "bodyweight_kg",
        value: 84.2,
        unit: "kg",
      }),
      metricRow({
        id: "weight-2",
        external_id: "weight-2",
        metric_type: "bodyweight_kg",
        recorded_at: "2026-08-29T05:00:00.000Z",
        value: 84,
        unit: "kg",
      }),
      metricRow({ id: "steps-1", external_id: "steps-1", metric_type: "steps", value: 5_000 }),
      metricRow({
        id: "steps-2",
        external_id: "steps-2",
        metric_type: "steps",
        recorded_at: "2026-08-29T05:30:00.000Z",
        value: 3_000,
      }),
      metricRow({
        id: "kcal-1",
        external_id: "kcal-1",
        metric_type: "active_calories",
        value: 300,
        unit: "kcal",
      }),
      metricRow({
        id: "kcal-2",
        external_id: "kcal-2",
        metric_type: "active_calories",
        recorded_at: "2026-08-29T06:00:00.000Z",
        value: 120,
        unit: "kcal",
      }),
      metricRow({
        id: "unsupported",
        external_id: "unsupported",
        metric_type: "heart_rate_bpm",
        value: 145,
        unit: "bpm",
      }),
    ];

    const summaries = summarizeHealthMetricsByDay(rows);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      day: "2026-08-28",
      sleepMinutes: 450,
      restingHr: 49,
      hrvMs: 56.4,
      bodyweightKg: 84,
      steps: 8_000,
      activeCalories: 420,
    });
    expect(summaries[0]!.evidence.sleep_minutes.map((point) => point.rowId)).toEqual([
      "sleep-1",
      "sleep-2",
    ]);
    expect(summaries[0]!.evidence.resting_hr[1]).toMatchObject({
      value: 49,
      unit: "bpm",
      sourceType: "health_connect",
    });
  });

  it("dedupes metric rows, keeps missing fields null, and returns one requested local day", () => {
    const original = metricRow();
    const duplicateExternalId = metricRow({ id: "metric-row-2", value: 99_999 });
    const nextDay = metricRow({
      id: "metric-row-3",
      external_id: "provider-metric-3",
      recorded_at: "2026-08-29T08:30:00.000Z",
      value: 700,
    });

    const summary = healthMetricSummaryForLocalDay(
      [original, duplicateExternalId, nextDay],
      "2026-08-28",
    );
    expect(summary).toMatchObject({
      day: "2026-08-28",
      sleepMinutes: null,
      restingHr: null,
      hrvMs: null,
      bodyweightKg: null,
      steps: 5_000,
      activeCalories: null,
    });
    expect(summary!.evidence.steps).toHaveLength(1);
    expect(healthMetricSummaryForLocalDay([original], "not-a-day")).toBeNull();
  });

  it("accepts only plausible canonical kg evidence for bodyweight", () => {
    const rows = [
      metricRow({
        id: "kg-valid",
        external_id: "kg-valid",
        metric_type: "bodyweight_kg",
        value: 84,
        unit: "kg",
      }),
      metricRow({
        id: "lb-invalid",
        external_id: "lb-invalid",
        metric_type: "bodyweight_kg",
        recorded_at: "2026-08-29T02:00:00.000Z",
        value: 185,
        unit: "lb",
      }),
      metricRow({
        id: "kg-implausible",
        external_id: "kg-implausible",
        metric_type: "bodyweight_kg",
        recorded_at: "2026-08-29T03:00:00.000Z",
        value: 900,
        unit: "kg",
      }),
    ];

    const summary = healthMetricSummaryForLocalDay(rows, "2026-08-28");
    expect(summary?.bodyweightKg).toBe(84);
    expect(summary?.evidence.bodyweight_kg).toHaveLength(3);
  });
});
