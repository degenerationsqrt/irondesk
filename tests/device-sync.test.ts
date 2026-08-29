import { describe, expect, it, vi } from "vitest";

import {
  DEVICE_SYNC_INITIAL_JOB_STATUS,
  aggregateByDay,
  applyDerivedRows,
} from "@/lib/imports/device-sync.server";
import {
  HEALTH_CONNECT_MAX_RECORDS,
  normalizePayload,
  syncPayloadSchema,
} from "@/lib/imports/health-connect-payload";
import type { NormalizedMetric } from "@/lib/imports/types";
import { rateLimited } from "@/routes/api/public/health-connect/unpair";

const envelope = {
  source: "irondesk-health-connect" as const,
  version: 1,
  device: { label: "Pixel 8", timezone: "Pacific/Auckland" },
};

const METRIC_UNIT_CASES: Array<{
  metric: NormalizedMetric["metricType"];
  sourceValue: number;
  sourceUnit: string;
  expectedValue: number;
  canonicalUnit: string;
}> = [
  {
    metric: "steps",
    sourceValue: 1234,
    sourceUnit: "steps",
    expectedValue: 1234,
    canonicalUnit: "count",
  },
  {
    metric: "sleep_minutes",
    sourceValue: 7.5,
    sourceUnit: "hours",
    expectedValue: 450,
    canonicalUnit: "min",
  },
  {
    metric: "sleep_efficiency_percent",
    sourceValue: 0.92,
    sourceUnit: "ratio",
    expectedValue: 92,
    canonicalUnit: "%",
  },
  {
    metric: "resting_hr",
    sourceValue: 48,
    sourceUnit: "beats per minute",
    expectedValue: 48,
    canonicalUnit: "bpm",
  },
  {
    metric: "hrv_ms",
    sourceValue: 0.045,
    sourceUnit: "seconds",
    expectedValue: 45,
    canonicalUnit: "ms",
  },
  {
    metric: "bodyweight_kg",
    sourceValue: 180,
    sourceUnit: "lb",
    expectedValue: 81.6466266,
    canonicalUnit: "kg",
  },
  {
    metric: "active_calories",
    sourceValue: 418.4,
    sourceUnit: "kJ",
    expectedValue: 100,
    canonicalUnit: "kcal",
  },
  {
    metric: "distance_m",
    sourceValue: 1,
    sourceUnit: "mi",
    expectedValue: 1609.344,
    canonicalUnit: "m",
  },
  {
    metric: "heart_rate_bpm",
    sourceValue: 120,
    sourceUnit: "beats/min",
    expectedValue: 120,
    canonicalUnit: "bpm",
  },
];

function metricRecord(
  metricType: NormalizedMetric["metricType"],
  value: number,
  recordedAt: string,
  sourceTimezone: string,
  unit: string,
): NormalizedMetric {
  return {
    kind: "metric",
    externalId: null,
    metricType,
    recordedAt,
    sourceTimezone,
    value,
    unit,
    notes: null,
    raw: {},
  };
}

function derivedAdmin(options?: {
  existingRecovery?: Array<{ id: string; day: string; source: string }>;
  existingWeights?: Array<{ id: string; recorded_at: string }>;
}) {
  const recoveryUpdate = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }));
  const recoveryInsert = vi.fn(async () => ({ error: null }));
  const bodyInsertSelect = vi.fn(async () => ({ data: [{ id: "inserted" }], error: null }));
  const bodyInsert = vi.fn(() => ({ select: bodyInsertSelect }));
  const bodyGte = vi.fn(() => ({
    lte: vi.fn(() => ({
      order: vi.fn(async () => ({ data: options?.existingWeights ?? [], error: null })),
    })),
  }));
  const from = vi.fn((table: string) => {
    if (table === "recovery_entries") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            gte: vi.fn(() => ({
              lte: vi.fn(async () => ({ data: options?.existingRecovery ?? [], error: null })),
            })),
          })),
        })),
        insert: recoveryInsert,
        update: recoveryUpdate,
      };
    }
    if (table === "body_metrics") {
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => ({ gte: bodyGte })) })),
        insert: bodyInsert,
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });
  return {
    admin: { from },
    bodyGte,
    bodyInsert,
    recoveryUpdate,
  };
}

describe("device sync payload", () => {
  it("enforces the advertised record cap across metrics and activities combined", () => {
    const halfPlusOne = Math.floor(HEALTH_CONNECT_MAX_RECORDS / 2) + 1;
    const result = syncPayloadSchema.safeParse({
      ...envelope,
      records: Array.from({ length: halfPlusOne }, () => ({
        metric: "steps",
        timestamp: "2026-05-01T05:00:00Z",
        value: 1,
      })),
      activities: Array.from({ length: halfPlusOne }, () => ({
        activity_type: "walking",
        start_time: "2026-05-01T05:00:00Z",
      })),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual([
        expect.objectContaining({
          path: ["records"],
          message: expect.stringContaining(`cannot exceed ${HEALTH_CONNECT_MAX_RECORDS}`),
        }),
      ]);
    }
  });

  it.each(METRIC_UNIT_CASES)(
    "normalizes $metric from $sourceUnit into its canonical unit",
    ({ metric, sourceValue, sourceUnit, expectedValue, canonicalUnit }) => {
      const parsed = syncPayloadSchema.parse({
        ...envelope,
        records: [
          {
            metric,
            timestamp: "2026-05-01T05:00:00Z",
            value: sourceValue,
            unit: sourceUnit,
          },
        ],
        activities: [],
      });

      const { records, issues } = normalizePayload(parsed);
      const record = records[0] as NormalizedMetric;
      expect(issues).toHaveLength(0);
      expect(record.metricType).toBe(metric);
      expect(record.unit).toBe(canonicalUnit);
      expect(record.value).toBeCloseTo(expectedValue, 6);
      expect(record.raw).toMatchObject({ source_value: sourceValue, source_unit: sourceUnit });
    },
  );

  it.each(METRIC_UNIT_CASES.map(({ metric }) => metric))(
    "skips %s when its explicit unit is unsupported",
    (metric) => {
      const parsed = syncPayloadSchema.parse({
        ...envelope,
        records: [{ metric, timestamp: "2026-05-01T05:00:00Z", value: 1, unit: "unsupported" }],
        activities: [],
      });

      const { records, issues } = normalizePayload(parsed);
      expect(records).toHaveLength(0);
      expect(issues).toEqual([
        expect.objectContaining({
          severity: "warning",
          message: expect.stringContaining(`Skipped a ${metric} record with unsupported unit`),
        }),
      ]);
    },
  );

  it("retains Health Connect provenance instead of stripping it", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [
        {
          external_id: "hc:rhr:1",
          metric: "resting_heart_rate",
          timestamp: "2026-05-01T05:00:00Z",
          value: 48,
          unit: "bpm",
          source_package: "com.samsung.health",
          device_manufacturer: "samsung",
          device_model: "SM-S911B",
          recording_method: "automatically_recorded",
        },
      ],
      activities: [],
    });

    const { records, issues } = normalizePayload(parsed);
    expect(issues).toHaveLength(0);
    expect(records[0]!.raw).toEqual({
      source_package: "com.samsung.health",
      device_manufacturer: "samsung",
      device_model: "SM-S911B",
      recording_method: "automatically_recorded",
      source_value: 48,
      source_unit: "bpm",
    });
  });

  it("retains source measurement evidence when provider provenance is absent", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [{ metric: "steps", timestamp: "2026-05-01T05:00:00Z", value: 8000 }],
      activities: [],
    });
    expect(normalizePayload(parsed).records[0]!.raw).toEqual({
      source_value: 8000,
      source_unit: null,
    });
  });

  it("groups derived days in the record timezone, not UTC", () => {
    // 19:00 UTC on Apr 30 is already May 1 in Auckland.
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [
        {
          metric: "weight",
          timestamp: "2026-04-30T19:00:00Z",
          value: 82.4,
          timezone: "Pacific/Auckland",
        },
      ],
      activities: [],
    });
    const days = aggregateByDay(normalizePayload(parsed).records);
    expect([...days.keys()]).toEqual(["2026-05-01"]);
  });

  it("falls back to UTC for an unusable timezone rather than dropping the day", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      device: { label: "Pixel 8", timezone: "Not/AZone" },
      records: [{ metric: "weight", timestamp: "2026-04-30T19:00:00Z", value: 82.4 }],
      activities: [],
    });
    const days = aggregateByDay(normalizePayload(parsed).records);
    expect([...days.keys()]).toEqual(["2026-04-30"]);
  });

  it("converts pound bodyweight to canonical kilograms and retains the source evidence", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [{ metric: "weight", timestamp: "2026-05-01T05:00:00Z", value: 180, unit: "lbs" }],
      activities: [],
    });

    const { records, issues } = normalizePayload(parsed);
    expect(issues).toHaveLength(0);
    expect(records[0]).toMatchObject({
      kind: "metric",
      metricType: "bodyweight_kg",
      unit: "kg",
      raw: { source_value: 180, source_unit: "lbs" },
    });
    expect((records[0] as NormalizedMetric).value).toBeCloseTo(81.65, 2);
  });

  it.each(["kg", "kgs", "kilogram", "kilograms"])(
    "keeps bodyweight in %s unchanged while canonicalizing the stored unit",
    (unit) => {
      const parsed = syncPayloadSchema.parse({
        ...envelope,
        records: [
          { metric: "bodyweight_kg", timestamp: "2026-05-01T05:00:00Z", value: 82.4, unit },
        ],
        activities: [],
      });

      const record = normalizePayload(parsed).records[0] as NormalizedMetric;
      expect(record.value).toBe(82.4);
      expect(record.unit).toBe("kg");
      expect(record.raw).toMatchObject({ source_value: 82.4, source_unit: unit });
    },
  );

  it("uses the companion's documented kg contract when bodyweight has no unit", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [{ metric: "body_weight", timestamp: "2026-05-01T05:00:00Z", value: 82.4 }],
      activities: [],
    });

    const record = normalizePayload(parsed).records[0] as NormalizedMetric;
    expect(record).toMatchObject({
      metricType: "bodyweight_kg",
      value: 82.4,
      unit: "kg",
      raw: { source_value: 82.4, source_unit: null },
    });
  });

  it("skips bodyweight with an unsupported explicit unit", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [
        { metric: "weight", timestamp: "2026-05-01T05:00:00Z", value: 12.8, unit: "stone" },
      ],
      activities: [],
    });

    const { records, issues } = normalizePayload(parsed);
    expect(records).toHaveLength(0);
    expect(issues).toEqual([
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("unsupported unit"),
      }),
    ]);
  });

  it("defensively excludes non-canonical bodyweight from day aggregation", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [{ metric: "weight", timestamp: "2026-05-01T05:00:00Z", value: 82.4, unit: "kg" }],
      activities: [],
    });
    const record = normalizePayload(parsed).records[0] as NormalizedMetric;

    const days = aggregateByDay([{ ...record, unit: "lb" }]);
    expect(days.get("2026-05-01")?.weightKg).toBeUndefined();
  });
});

describe("device-derived rows", () => {
  it("updates an existing wearable recovery row with only fields present in the new sync", async () => {
    const { admin, recoveryUpdate } = derivedAdmin({
      existingRecovery: [{ id: "recovery-1", day: "2026-05-01", source: "wearable" }],
    });
    const record = metricRecord(
      "resting_hr",
      52,
      "2026-05-01T15:00:00Z",
      "America/Los_Angeles",
      "bpm",
    );

    await applyDerivedRows(admin as never, "user-1", [record]);

    expect(recoveryUpdate).toHaveBeenCalledWith({ resting_hr: 52 });
    expect(recoveryUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ sleep_hours: expect.anything() }),
    );
  });

  it.each([
    {
      zone: "Pacific/Auckland",
      incomingAt: "2026-04-30T19:00:00Z",
      existingAt: "2026-04-30T20:00:00Z",
      expectedFrom: "2026-04-30T00:00:00.000Z",
      expectedTo: "2026-05-02T23:59:59.999Z",
    },
    {
      zone: "America/Los_Angeles",
      incomingAt: "2026-05-02T02:00:00Z",
      existingAt: "2026-05-02T05:00:00Z",
      expectedFrom: "2026-04-30T00:00:00.000Z",
      expectedTo: "2026-05-02T23:59:59.999Z",
    },
  ])(
    "dedupes an existing bodyweight on the same local day across the $zone UTC boundary",
    async (fixture) => {
      const { admin, bodyGte, bodyInsert } = derivedAdmin({
        existingWeights: [{ id: "weight-1", recorded_at: fixture.existingAt }],
      });
      const record = metricRecord("bodyweight_kg", 82.4, fixture.incomingAt, fixture.zone, "kg");

      const result = await applyDerivedRows(admin as never, "user-1", [record]);

      expect(bodyGte).toHaveBeenCalledWith("recorded_at", fixture.expectedFrom);
      const lte = bodyGte.mock.results[0]!.value.lte;
      expect(lte).toHaveBeenCalledWith("recorded_at", fixture.expectedTo);
      expect(bodyInsert).not.toHaveBeenCalled();
      expect(result.bodyweightDays).toBe(0);
    },
  );

  it("dedupes travel-day bodyweights against each requested day and its own timezone", async () => {
    const { admin, bodyInsert } = derivedAdmin({
      existingWeights: [
        { id: "weight-auckland", recorded_at: "2026-04-30T20:00:00Z" },
        { id: "weight-los-angeles", recorded_at: "2026-05-03T05:00:00Z" },
      ],
    });
    const records = [
      metricRecord("bodyweight_kg", 82.4, "2026-04-30T19:00:00Z", "Pacific/Auckland", "kg"),
      metricRecord("bodyweight_kg", 82.1, "2026-05-03T02:00:00Z", "America/Los_Angeles", "kg"),
    ];

    const result = await applyDerivedRows(admin as never, "user-1", records);

    expect(bodyInsert).not.toHaveBeenCalled();
    expect(result.bodyweightDays).toBe(0);
  });
});

describe("unpair throttle", () => {
  it("allows the first five attempts per token and blocks the sixth", () => {
    const key = `token-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) expect(rateLimited(key)).toBe(false);
    expect(rateLimited(key)).toBe(true);
  });

  it("tracks tokens independently", () => {
    const a = `token-a-${Math.random()}`;
    const b = `token-b-${Math.random()}`;
    for (let i = 0; i < 6; i += 1) rateLimited(a);
    expect(rateLimited(b)).toBe(false);
  });
});

describe("device sync import job status", () => {
  const VALID_IMPORT_JOB_STATUSES = [
    "pending",
    "committing",
    "completed",
    "partial",
    "failed",
    "rolled_back",
  ];

  it("starts the job in a status the database constraint permits", () => {
    expect(VALID_IMPORT_JOB_STATUSES).toContain(DEVICE_SYNC_INITIAL_JOB_STATUS);
    expect(DEVICE_SYNC_INITIAL_JOB_STATUS).toBe("committing");
  });
});
