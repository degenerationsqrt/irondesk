/**
 * Device sync (server only).
 *
 * The Android companion never holds Supabase credentials. It exchanges a
 * short-lived pairing code the athlete generates in IronDesk for a long-lived
 * device token, then pushes normalized Health Connect records to the ingest
 * endpoint with that token as a bearer credential.
 *
 * Trust rules enforced here and nowhere else:
 *  - the caller never supplies a user id; it is resolved from the token hash
 *  - only a hash of the token is ever stored
 *  - dedupe uses the same `dedupe_hash` scheme as file imports, so device sync
 *    and a manual file upload of the same range converge on the same rows
 *  - derived recovery/bodyweight rows never overwrite anything the athlete
 *    entered by hand
 */
import { z } from "zod";

import { withHashes } from "./dedupe";
import type { MetricType, NormalizedRecord, ParseIssue } from "./types";
import { METRIC_TYPES } from "./types";

const NORMALIZED_VERSION = 1;

/** Hard caps applied before any database work. */
export const SYNC_LIMITS = {
  maxBodyBytes: 4 * 1024 * 1024,
  maxRecords: 10_000,
  chunkSize: 500,
  pairingTtlMinutes: 15,
} as const;

/* ------------------------------- hashing ---------------------------------- */

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** 32 bytes of CSPRNG entropy, url-safe. Only the hash is persisted. */
export function newDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time-ish compare for equal-length hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* -------------------------------- payload --------------------------------- */

/** Optional Health Connect provenance. Retained verbatim in `raw_metadata`. */
const sourceMetaSchema = z.object({
  source_package: z.string().max(160).optional(),
  device_manufacturer: z.string().max(80).optional(),
  device_model: z.string().max(80).optional(),
  device_type: z.string().max(40).optional(),
  recording_method: z.string().max(40).optional(),
});

type SourceMeta = z.infer<typeof sourceMetaSchema>;

const SOURCE_META_KEYS = Object.keys(sourceMetaSchema.shape) as (keyof SourceMeta)[];

/** Picks only the provenance keys, so an absent provenance stays an empty object. */
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
  duration_sec: z.number().int().nonnegative().max(86_400 * 7).optional(),
  distance_m: z.number().nonnegative().max(1_000_000).optional(),
  calories: z.number().int().nonnegative().max(50_000).optional(),
  average_heart_rate: z.number().int().min(20).max(260).optional(),
  max_heart_rate: z.number().int().min(20).max(260).optional(),
  steps: z.number().int().nonnegative().max(500_000).optional(),
  notes: z.string().max(2_000).optional(),
});

export const syncPayloadSchema = z.object({
  source: z.literal("irondesk-health-connect"),
  version: z.number().int().min(1).max(1),
  exportedAt: z.string().max(40).optional(),
  device: z.object({ label: z.string().max(80).optional(), timezone: z.string().max(60).optional() }).optional(),
  records: z.array(metricSchema).max(SYNC_LIMITS.maxRecords).default([]),
  activities: z.array(activitySchema).max(SYNC_LIMITS.maxRecords).default([]),
});

export type SyncPayload = z.infer<typeof syncPayloadSchema>;

export const pairingRequestSchema = z.object({
  code: z.string().min(4).max(40),
  device_label: z.string().min(1).max(80).default("Android phone"),
  platform: z.string().max(20).default("android"),
});

/* ------------------------------ normalizing -------------------------------- */

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

const UNIT_OF: Record<MetricType, string> = {
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

function metricTypeOf(raw: string): MetricType | null {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const direct = METRIC_TYPES.find((candidate) => candidate === key);
  return direct ?? METRIC_ALIASES[key] ?? null;
}

function isoOrNull(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Turns a validated payload into the shared normalized record model. */
export function normalizePayload(payload: SyncPayload): { records: NormalizedRecord[]; issues: ParseIssue[] } {
  const records: NormalizedRecord[] = [];
  const issues: ParseIssue[] = [];

  payload.records.forEach((metric, index) => {
    const metricType = metricTypeOf(metric.metric);
    if (!metricType) {
      issues.push({ severity: "warning", row: index, message: `Skipped "${metric.metric}" — not a metric IronDesk stores.` });
      return;
    }
    const recordedAt = isoOrNull(metric.timestamp);
    if (!recordedAt) {
      issues.push({ severity: "error", row: index, message: `Skipped a ${metricType} record with an unreadable timestamp.` });
      return;
    }
    records.push({
      kind: "metric",
      externalId: metric.external_id ?? null,
      metricType,
      recordedAt,
      sourceTimezone: metric.timezone ?? payload.device?.timezone ?? null,
      value: metric.value,
      unit: metric.unit ?? UNIT_OF[metricType],
      notes: null,
      raw: metaOf(metric),
    });
  });

  payload.activities.forEach((activity, index) => {
    const startedAt = isoOrNull(activity.start_time);
    if (!startedAt) {
      issues.push({ severity: "error", row: index, message: `Skipped "${activity.activity_type}" — unreadable start time.` });
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

/* --------------------------------- ingest ---------------------------------- */

export interface DeviceIdentity {
  deviceId: string;
  userId: string;
  label: string;
  dataSourceId: string | null;
}

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** Resolves a bearer device token to its owner. Returns null for anything unknown. */
export async function resolveDevice(admin: AdminClient, bearer: string | null): Promise<DeviceIdentity | null> {
  const token = bearer?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length < 20 || token.length > 200) return null;
  const hash = await sha256Hex(token);
  const { data } = await admin
    .from("device_links")
    .select("id, user_id, label, data_source_id, token_hash")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || !hashesEqual(data.token_hash, hash)) return null;
  return { deviceId: data.id, userId: data.user_id, label: data.label, dataSourceId: data.data_source_id };
}

export interface IngestResult {
  jobId: string;
  total: number;
  imported: number;
  duplicates: number;
  warnings: number;
  failed: number;
  recoveryDays: number;
  bodyweightDays: number;
}

/**
 * Writes one device push as a single import batch, then derives recovery and
 * bodyweight rows from it. Everything is attributed to `device.userId`.
 */
export async function ingestForDevice(admin: AdminClient, device: DeviceIdentity, payload: SyncPayload): Promise<IngestResult> {
  const { records, issues } = normalizePayload(payload);
  const hashed = await withHashes(records, "health_connect");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const errors = issues.filter((issue) => issue.severity === "error");

  const { data: jobRow, error: jobError } = await admin
    .from("import_jobs")
    .insert({
      user_id: device.userId,
      data_source_id: device.dataSourceId,
      source_type: "health_connect",
      file_name: `Device sync · ${device.label}`,
      file_format: "json",
      status: "running",
      total_records: hashed.length,
      warning_count: warnings.length,
      failed_count: errors.length,
      warnings: [...warnings, ...errors].slice(0, 200) as unknown as never,
      normalized_version: NORMALIZED_VERSION,
    })
    .select("id")
    .single();
  if (jobError || !jobRow) throw new Error("The sync could not be started.");
  const jobId = jobRow.id;

  try {
    let imported = 0;

    const activities = hashed.filter((entry) => entry.record.kind === "activity");
    for (let i = 0; i < activities.length; i += SYNC_LIMITS.chunkSize) {
      const chunk = activities.slice(i, i + SYNC_LIMITS.chunkSize).map(({ record, hash }) => {
        const activity = record as Extract<NormalizedRecord, { kind: "activity" }>;
        return {
          user_id: device.userId,
          import_job_id: jobId,
          source_type: "health_connect",
          source_file_name: `device:${device.label}`,
          external_id: activity.externalId,
          dedupe_hash: hash,
          activity_type: activity.activityType,
          name: activity.name,
          started_at: activity.startedAt,
          source_timezone: activity.sourceTimezone,
          duration_sec: activity.durationSec,
          distance_m: activity.distanceM,
          calories: activity.calories,
          avg_hr: activity.avgHr,
          max_hr: activity.maxHr,
          elevation_gain_m: activity.elevationGainM,
          steps: activity.steps,
          notes: activity.notes,
          raw_metadata: activity.raw as unknown as never,
          normalized_version: NORMALIZED_VERSION,
        };
      });
      const { data, error } = await admin
        .from("imported_activities")
        .upsert(chunk, { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error("Activities could not be written.");
      imported += data?.length ?? 0;
    }

    const metrics = hashed.filter((entry) => entry.record.kind === "metric");
    for (let i = 0; i < metrics.length; i += SYNC_LIMITS.chunkSize) {
      const chunk = metrics.slice(i, i + SYNC_LIMITS.chunkSize).map(({ record, hash }) => {
        const metric = record as Extract<NormalizedRecord, { kind: "metric" }>;
        return {
          user_id: device.userId,
          import_job_id: jobId,
          source_type: "health_connect",
          source_file_name: `device:${device.label}`,
          external_id: metric.externalId,
          dedupe_hash: hash,
          metric_type: metric.metricType,
          recorded_at: metric.recordedAt,
          source_timezone: metric.sourceTimezone,
          value: metric.value,
          unit: metric.unit,
          notes: metric.notes,
          raw_metadata: metric.raw as unknown as never,
          normalized_version: NORMALIZED_VERSION,
        };
      });
      const { data, error } = await admin
        .from("health_metrics")
        .upsert(chunk, { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true })
        .select("id");
      if (error) throw new Error("Health metrics could not be written.");
      imported += data?.length ?? 0;
    }

    const derived = await applyDerivedRows(admin, device.userId, records);

    await admin
      .from("import_jobs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        imported_count: imported,
        duplicate_count: Math.max(0, hashed.length - imported),
      })
      .eq("id", jobId);

    const summary = {
      jobId,
      total: hashed.length,
      imported,
      duplicates: Math.max(0, hashed.length - imported),
      warnings: warnings.length,
      failed: errors.length,
      ...derived,
    };

    await admin
      .from("device_links")
      .update({ last_sync_at: new Date().toISOString(), last_sync_summary: summary as unknown as never })
      .eq("id", device.deviceId);
    if (device.dataSourceId) {
      await admin
        .from("data_sources")
        .update({ status: "connected", last_import_at: new Date().toISOString() })
        .eq("id", device.dataSourceId);
    }

    return summary;
  } catch (error) {
    await admin
      .from("import_jobs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : "The sync failed.",
      })
      .eq("id", jobId);
    throw error;
  }
}

/* -------------------------------- derived ---------------------------------- */

/**
 * Calendar day in the record's own timezone. A UTC instant sliced as a string
 * lands on the wrong day for anyone west of Greenwich, so the source zone wins
 * and UTC is only the fallback for records that never carried one.
 */
const dayOf = (iso: string, timezone?: string | null): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso.slice(0, 10);
  const zone = timezone?.trim();
  if (zone) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(ms));
    } catch {
      // Unknown zone id: fall through to UTC rather than dropping the record.
    }
  }
  return new Date(ms).toISOString().slice(0, 10);
};

interface DayAggregate {
  sleepMinutes?: number;
  sleepEfficiency?: number;
  restingHr?: number;
  hrvMs?: number;
  weightKg?: number;
  weightAt?: string;
}

export function aggregateByDay(records: NormalizedRecord[]): Map<string, DayAggregate> {
  const days = new Map<string, DayAggregate>();
  for (const record of records) {
    if (record.kind !== "metric") continue;
    const day = dayOf(record.recordedAt, record.sourceTimezone);
    const entry = days.get(day) ?? {};
    switch (record.metricType) {
      case "sleep_minutes":
        entry.sleepMinutes = Math.max(entry.sleepMinutes ?? 0, record.value);
        break;
      case "sleep_efficiency_percent":
        entry.sleepEfficiency = record.value;
        break;
      case "resting_hr":
        entry.restingHr = Math.round(record.value);
        break;
      case "hrv_ms":
        entry.hrvMs = Math.round(record.value);
        break;
      case "bodyweight_kg":
        if (!entry.weightAt || record.recordedAt > entry.weightAt) {
          entry.weightKg = record.value;
          entry.weightAt = record.recordedAt;
        }
        break;
      default:
        break;
    }
    days.set(day, entry);
  }
  return days;
}

const inRange = (value: number | undefined, min: number, max: number): number | null =>
  value == null || !Number.isFinite(value) || value < min || value > max ? null : value;

/**
 * Fills Recovery and Body Metrics from synced data.
 *
 * A day the athlete logged by hand (`recovery_entries.source = 'manual'`, or an
 * existing bodyweight reading for that day) is left untouched — device data
 * only ever fills gaps or refreshes rows it created itself.
 */
export async function applyDerivedRows(
  admin: AdminClient,
  userId: string,
  records: NormalizedRecord[],
): Promise<{ recoveryDays: number; bodyweightDays: number }> {
  const days = aggregateByDay(records);
  if (!days.size) return { recoveryDays: 0, bodyweightDays: 0 };

  // Existing rows carry no timezone, so they are bucketed with the zone this
  // batch reported; that keeps "already has a reading for that day" honest.
  const batchZone =
    records.find((record) => record.kind === "metric" && record.sourceTimezone)?.sourceTimezone ?? null;

  const dayKeys = [...days.keys()].sort();
  const from = dayKeys[0]!;
  const to = dayKeys[dayKeys.length - 1]!;

  const { data: existingRecovery } = await admin
    .from("recovery_entries")
    .select("id, day, source")
    .eq("user_id", userId)
    .gte("day", from)
    .lte("day", to);
  const recoveryByDay = new Map((existingRecovery ?? []).map((row) => [row.day, row]));

  let recoveryDays = 0;
  for (const [day, aggregate] of days) {
    const sleepHours = aggregate.sleepMinutes == null ? null : Math.round((aggregate.sleepMinutes / 60) * 10) / 10;
    const patch = {
      sleep_hours: inRange(sleepHours ?? undefined, 0, 24),
      sleep_efficiency_percent: inRange(aggregate.sleepEfficiency, 0, 100),
      resting_hr: inRange(aggregate.restingHr, 25, 140),
      hrv_ms: inRange(aggregate.hrvMs, 5, 300),
    };
    if (Object.values(patch).every((value) => value === null)) continue;

    const existing = recoveryByDay.get(day);
    if (!existing) {
      const { error } = await admin
        .from("recovery_entries")
        .insert({ user_id: userId, day, source: "wearable", ...patch });
      if (!error) recoveryDays += 1;
      continue;
    }
    if (existing.source === "manual") continue; // never overwrite a hand-logged day
    const { error } = await admin.from("recovery_entries").update(patch).eq("id", existing.id);
    if (!error) recoveryDays += 1;
  }

  const weightDays = [...days.entries()].filter(([, aggregate]) => inRange(aggregate.weightKg, 20, 400) !== null);
  let bodyweightDays = 0;
  if (weightDays.length) {
    const { data: existingWeights } = await admin
      .from("body_metrics")
      .select("id, recorded_at")
      .eq("user_id", userId)
      .gte("recorded_at", `${from}T00:00:00Z`)
      .lte("recorded_at", `${to}T23:59:59Z`)
      .order("recorded_at", { ascending: true });
    const takenDays = new Set((existingWeights ?? []).map((row) => dayOf(row.recorded_at, batchZone)));
    const inserts = weightDays
      .filter(([day]) => !takenDays.has(day))
      .map(([, aggregate]) => ({
        user_id: userId,
        recorded_at: aggregate.weightAt!,
        weight_kg: aggregate.weightKg!,
        note: "Synced from Health Connect",
      }));
    if (inserts.length) {
      const { data, error } = await admin.from("body_metrics").insert(inserts).select("id");
      if (!error) bodyweightDays = data?.length ?? 0;
    }
  }

  return { recoveryDays, bodyweightDays };
}
