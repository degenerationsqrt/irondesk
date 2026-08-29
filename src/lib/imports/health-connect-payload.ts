/**
 * Shared IronDesk Health Connect companion payload contract.
 *
 * This module is intentionally client-safe and has no Supabase dependency. The
 * Android push endpoint and the file importer both use it so an exported JSON
 * file cannot lose activities, timestamps, or per-record provenance.
 */
import { z } from "zod";

import type { MetricType, NormalizedRecord, ParseIssue } from "./types";
import { METRIC_TYPES } from "./types";

export const HEALTH_CONNECT_PAYLOAD_SOURCE = "irondesk-health-connect" as const;
export const HEALTH_CONNECT_MAX_RECORDS = 10_000;

/** Optional provenance supplied by Health Connect for an individual record. */
const sourceMetaSchema = z.object({
  source_package: z.string().max(160).optional(),
  device_manufacturer: z.string().max(80).optional(),
  device_model: z.string().max(80).optional(),
  device_type: z.string().max(40).optional(),
  recording_method: z.string().max(40).optional(),
});

type SourceMeta = z.infer<typeof sourceMetaSchema>;

const SOURCE_META_KEYS = Object.keys(sourceMetaSchema.shape) as (keyof SourceMeta)[];

/** Keeps only evidence the companion actually supplied. */
function metaOf(record: Partial<SourceMeta>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SOURCE_META_KEYS) {
    const value = record[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

const metricSchema = sourceMetaSchema.extend({
  external_id: z.string().min(1).max(200).optional(),
  metric: z.string().min(1).max(60),
  timestamp: z.string().min(4).max(40),
  timezone: z.string().max(60).optional(),
  value: z.number().finite(),
  unit: z.string().max(20).optional(),
});

const activitySchema = sourceMetaSchema.extend({
  external_id: z.string().min(1).max(200).optional(),
  activity_type: z.string().min(1).max(60),
  name: z.string().max(160).optional(),
  start_time: z.string().min(4).max(40),
  timezone: z.string().max(60).optional(),
  duration_sec: z
    .number()
    .int()
    .nonnegative()
    .max(86_400 * 7)
    .optional(),
  distance_m: z.number().nonnegative().max(1_000_000).optional(),
  calories: z.number().int().nonnegative().max(50_000).optional(),
  average_heart_rate: z.number().int().min(20).max(260).optional(),
  max_heart_rate: z.number().int().min(20).max(260).optional(),
  steps: z.number().int().nonnegative().max(500_000).optional(),
  notes: z.string().max(2_000).optional(),
});

export const syncPayloadSchema = z
  .object({
    source: z.literal(HEALTH_CONNECT_PAYLOAD_SOURCE),
    version: z.number().int().min(1).max(1),
    exportedAt: z.string().max(40).optional(),
    device: z
      .object({ label: z.string().max(80).optional(), timezone: z.string().max(60).optional() })
      .optional(),
    records: z.array(metricSchema).max(HEALTH_CONNECT_MAX_RECORDS).default([]),
    activities: z.array(activitySchema).max(HEALTH_CONNECT_MAX_RECORDS).default([]),
  })
  .superRefine((payload, context) => {
    const combined = payload.records.length + payload.activities.length;
    if (combined <= HEALTH_CONNECT_MAX_RECORDS) return;
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["records"],
      message: `Combined records and activities cannot exceed ${HEALTH_CONNECT_MAX_RECORDS}.`,
    });
  });

export type SyncPayload = z.infer<typeof syncPayloadSchema>;

const METRIC_ALIASES: Record<string, MetricType> = {
  step: "steps",
  step_count: "steps",
  sleep: "sleep_minutes",
  sleep_duration: "sleep_minutes",
  sleep_efficiency: "sleep_efficiency_percent",
  rhr: "resting_hr",
  resting_heart_rate: "resting_hr",
  hrv: "hrv_ms",
  hrv_rmssd: "hrv_ms",
  weight: "bodyweight_kg",
  bodyweight: "bodyweight_kg",
  body_weight: "bodyweight_kg",
  active_energy: "active_calories",
  heart_rate: "heart_rate_bpm",
  distance: "distance_m",
};

export const CANONICAL_HEALTH_METRIC_UNITS: Record<MetricType, string> = {
  steps: "count",
  sleep_minutes: "min",
  sleep_efficiency_percent: "%",
  resting_hr: "bpm",
  hrv_ms: "ms",
  bodyweight_kg: "kg",
  active_calories: "kcal",
  distance_m: "m",
  heart_rate_bpm: "bpm",
};

const POUNDS_PER_KILOGRAM = 2.2046226218;
const METERS_PER_MILE = 1609.344;
const KILOJOULES_PER_KILOCALORIE = 4.184;

interface MetricUnitPolicy {
  canonicalUnit: string;
  /** Normalized source-unit spelling -> multiplier into the canonical unit. */
  multipliers: Readonly<Record<string, number>>;
}

const HEART_RATE_MULTIPLIERS = {
  bpm: 1,
  "beat/min": 1,
  "beats/min": 1,
  "beat per minute": 1,
  "beats per minute": 1,
} as const;

const METRIC_UNIT_POLICIES: Record<MetricType, MetricUnitPolicy> = {
  steps: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.steps,
    multipliers: { count: 1, step: 1, steps: 1 },
  },
  sleep_minutes: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.sleep_minutes,
    multipliers: {
      min: 1,
      mins: 1,
      minute: 1,
      minutes: 1,
      h: 60,
      hr: 60,
      hrs: 60,
      hour: 60,
      hours: 60,
    },
  },
  sleep_efficiency_percent: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.sleep_efficiency_percent,
    multipliers: { "%": 1, pct: 1, percent: 1, percentage: 1, ratio: 100, fraction: 100 },
  },
  resting_hr: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.resting_hr,
    multipliers: HEART_RATE_MULTIPLIERS,
  },
  hrv_ms: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.hrv_ms,
    multipliers: {
      ms: 1,
      msec: 1,
      millisecond: 1,
      milliseconds: 1,
      s: 1000,
      sec: 1000,
      second: 1000,
      seconds: 1000,
    },
  },
  bodyweight_kg: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.bodyweight_kg,
    multipliers: {
      kg: 1,
      kgs: 1,
      kilogram: 1,
      kilograms: 1,
      lb: 1 / POUNDS_PER_KILOGRAM,
      lbs: 1 / POUNDS_PER_KILOGRAM,
      pound: 1 / POUNDS_PER_KILOGRAM,
      pounds: 1 / POUNDS_PER_KILOGRAM,
    },
  },
  active_calories: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.active_calories,
    multipliers: {
      kcal: 1,
      kilocalorie: 1,
      kilocalories: 1,
      kj: 1 / KILOJOULES_PER_KILOCALORIE,
      kilojoule: 1 / KILOJOULES_PER_KILOCALORIE,
      kilojoules: 1 / KILOJOULES_PER_KILOCALORIE,
    },
  },
  distance_m: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.distance_m,
    multipliers: {
      m: 1,
      meter: 1,
      meters: 1,
      metre: 1,
      metres: 1,
      km: 1000,
      kilometer: 1000,
      kilometers: 1000,
      kilometre: 1000,
      kilometres: 1000,
      mi: METERS_PER_MILE,
      mile: METERS_PER_MILE,
      miles: METERS_PER_MILE,
    },
  },
  heart_rate_bpm: {
    canonicalUnit: CANONICAL_HEALTH_METRIC_UNITS.heart_rate_bpm,
    multipliers: HEART_RATE_MULTIPLIERS,
  },
};

function unitKey(unit: string): string {
  return unit.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function normalizeMeasurement(
  metricType: MetricType,
  sourceValue: number,
  sourceUnit: string | undefined,
): { value: number; unit: string } | null {
  const policy = METRIC_UNIT_POLICIES[metricType];
  if (sourceUnit === undefined) return { value: sourceValue, unit: policy.canonicalUnit };
  const multiplier = policy.multipliers[unitKey(sourceUnit)];
  if (multiplier === undefined) return null;
  return { value: sourceValue * multiplier, unit: policy.canonicalUnit };
}

function metricTypeOf(raw: string): MetricType | null {
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const direct = METRIC_TYPES.find((candidate) => candidate === key);
  return direct ?? METRIC_ALIASES[key] ?? null;
}

function isoOrNull(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Turns a validated companion payload into the shared normalized model. */
export function normalizePayload(payload: SyncPayload): {
  records: NormalizedRecord[];
  issues: ParseIssue[];
} {
  const records: NormalizedRecord[] = [];
  const issues: ParseIssue[] = [];

  payload.records.forEach((metric, index) => {
    const metricType = metricTypeOf(metric.metric);
    if (!metricType) {
      issues.push({
        severity: "warning",
        row: index + 1,
        message: `Skipped "${metric.metric}" — not a metric IronDesk stores.`,
      });
      return;
    }
    const recordedAt = isoOrNull(metric.timestamp);
    if (!recordedAt) {
      issues.push({
        severity: "error",
        row: index + 1,
        message: `Skipped a ${metricType} record with an unreadable timestamp.`,
      });
      return;
    }

    const raw = metaOf(metric);
    raw["source_value"] = metric.value;
    raw["source_unit"] = metric.unit ?? null;
    const measurement = normalizeMeasurement(metricType, metric.value, metric.unit);
    if (!measurement) {
      issues.push({
        severity: "warning",
        row: index + 1,
        message: `Skipped a ${metricType} record with unsupported unit "${metric.unit}". Expected a unit compatible with ${CANONICAL_HEALTH_METRIC_UNITS[metricType]}.`,
      });
      return;
    }

    records.push({
      kind: "metric",
      externalId: metric.external_id ?? null,
      metricType,
      recordedAt,
      sourceTimezone: metric.timezone ?? payload.device?.timezone ?? null,
      value: measurement.value,
      unit: measurement.unit,
      notes: null,
      raw,
    });
  });

  payload.activities.forEach((activity, index) => {
    const startedAt = isoOrNull(activity.start_time);
    if (!startedAt) {
      issues.push({
        severity: "error",
        row: index + 1,
        message: `Skipped "${activity.activity_type}" — unreadable start time.`,
      });
      return;
    }
    records.push({
      kind: "activity",
      externalId: activity.external_id ?? null,
      activityType: activity.activity_type,
      name: activity.name ?? null,
      startedAt,
      sourceTimezone: activity.timezone ?? payload.device?.timezone ?? null,
      durationSec: activity.duration_sec ?? null,
      distanceM: activity.distance_m ?? null,
      calories: activity.calories ?? null,
      avgHr: activity.average_heart_rate ?? null,
      maxHr: activity.max_heart_rate ?? null,
      elevationGainM: null,
      steps: activity.steps ?? null,
      notes: activity.notes ?? null,
      raw: metaOf(activity),
    });
  });

  return { records, issues };
}

export class HealthConnectPayloadError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Recognizes only the exact IronDesk companion envelope.
 *
 * `null` means the JSON belongs to the generic mapping path. Once the exact
 * source marker is present, a malformed payload is rejected instead of being
 * silently reinterpreted as an arbitrary table.
 */
export function parseHealthConnectEnvelope(
  text: string,
): { records: NormalizedRecord[]; issues: ParseIssue[] } | null {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(candidate) || candidate["source"] !== HEALTH_CONNECT_PAYLOAD_SOURCE) return null;

  const parsed = syncPayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.length ? ` at ${first.path.join(".")}` : "";
    throw new HealthConnectPayloadError(
      `This IronDesk Health Connect export is invalid${field}: ${first?.message ?? "the payload could not be read"}.`,
    );
  }
  return normalizePayload(parsed.data);
}
