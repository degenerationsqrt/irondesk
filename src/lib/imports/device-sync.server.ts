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
import {
  HEALTH_CONNECT_MAX_RECORDS,
  normalizePayload,
  syncPayloadSchema,
  type SyncPayload,
} from "./health-connect-payload";
import type { NormalizedRecord } from "./types";

export { normalizePayload, syncPayloadSchema } from "./health-connect-payload";
export type { SyncPayload } from "./health-connect-payload";

const NORMALIZED_VERSION = 1;

/**
 * Initial `import_jobs.status` for a device sync. Must be one of the statuses
 * the `import_jobs` check constraint permits; a device sync writes records
 * immediately, so it starts as `committing`.
 */
export const DEVICE_SYNC_INITIAL_JOB_STATUS = "committing" as const;

/** Hard caps applied before any database work. */
export const SYNC_LIMITS = {
  maxBodyBytes: 4 * 1024 * 1024,
  maxRecords: HEALTH_CONNECT_MAX_RECORDS,
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
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Constant-time-ish compare for equal-length hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const pairingRequestSchema = z.object({
  code: z.string().min(4).max(40),
  device_label: z.string().min(1).max(80).default("Android phone"),
  platform: z.string().max(20).default("android"),
});

/* --------------------------------- ingest ---------------------------------- */

export interface DeviceIdentity {
  deviceId: string;
  userId: string;
  label: string;
  dataSourceId: string | null;
}

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

/** Resolves a bearer device token to its owner. Returns null for anything unknown. */
export async function resolveDevice(
  admin: AdminClient,
  bearer: string | null,
): Promise<DeviceIdentity | null> {
  const token = bearer?.replace(/^Bearer\s+/i, "").trim();
  if (!token || token.length < 20 || token.length > 200) return null;
  const hash = await sha256Hex(token);
  const { data } = await admin
    .from("device_links")
    .select("id, user_id, label, data_source_id, token_hash")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!data || !hashesEqual(data.token_hash, hash)) return null;
  return {
    deviceId: data.id,
    userId: data.user_id,
    label: data.label,
    dataSourceId: data.data_source_id,
  };
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
export async function ingestForDevice(
  admin: AdminClient,
  device: DeviceIdentity,
  payload: SyncPayload,
): Promise<IngestResult> {
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
      status: DEVICE_SYNC_INITIAL_JOB_STATUS,
      total_records: hashed.length,
      warning_count: warnings.length,
      failed_count: errors.length,
      warnings: [...warnings, ...errors].slice(0, 200) as unknown as never,
      normalized_version: NORMALIZED_VERSION,
    })
    .select("id")
    .single();
  if (jobError || !jobRow) {
    console.error("[health-connect] import job insert failed", {
      userId: device.userId,
      code: jobError?.code,
      message: jobError?.message,
      details: jobError?.details,
    });
    throw new Error("The sync could not be started.");
  }

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
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_summary: summary as unknown as never,
      })
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
  weightTimezone?: string | null;
}

interface RecoveryPatch {
  sleep_hours?: number;
  sleep_efficiency_percent?: number;
  resting_hr?: number;
  hrv_ms?: number;
}

export function aggregateByDay(records: NormalizedRecord[]): Map<string, DayAggregate> {
  const days = new Map<string, DayAggregate>();
  for (const record of records) {
    if (record.kind !== "metric") continue;
    const day = dayOf(record.recordedAt, record.sourceTimezone);
    const entry = days.get(day) ?? {};
    switch (record.metricType) {
      case "sleep_minutes":
        if (record.unit !== "min") break;
        entry.sleepMinutes = Math.max(entry.sleepMinutes ?? 0, record.value);
        break;
      case "sleep_efficiency_percent":
        if (record.unit !== "%") break;
        entry.sleepEfficiency = record.value;
        break;
      case "resting_hr":
        if (record.unit !== "bpm") break;
        entry.restingHr = Math.round(record.value);
        break;
      case "hrv_ms":
        if (record.unit !== "ms") break;
        entry.hrvMs = Math.round(record.value);
        break;
      case "bodyweight_kg":
        // Defense in depth: only the shared payload normalizer's canonical kg
        // output is allowed to reach body_metrics.weight_kg.
        if (record.unit !== "kg") break;
        if (!entry.weightAt || record.recordedAt > entry.weightAt) {
          entry.weightKg = record.value;
          entry.weightAt = record.recordedAt;
          entry.weightTimezone = record.sourceTimezone;
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

/** Only fields evidenced by this batch belong in an existing-row update. */
function recoveryPatchOf(aggregate: DayAggregate): RecoveryPatch {
  const patch: RecoveryPatch = {};
  const sleepHours =
    aggregate.sleepMinutes == null ? null : Math.round((aggregate.sleepMinutes / 60) * 10) / 10;
  const sleep = inRange(sleepHours ?? undefined, 0, 24);
  const efficiency = inRange(aggregate.sleepEfficiency, 0, 100);
  const restingHr = inRange(aggregate.restingHr, 25, 140);
  const hrvMs = inRange(aggregate.hrvMs, 5, 300);
  if (sleep !== null) patch.sleep_hours = sleep;
  if (efficiency !== null) patch.sleep_efficiency_percent = efficiency;
  if (restingHr !== null) patch.resting_hr = restingHr;
  if (hrvMs !== null) patch.hrv_ms = hrvMs;
  return patch;
}

const shiftUtcDay = (day: string, amount: number): string => {
  const value = new Date(`${day}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
};

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
    const patch = recoveryPatchOf(aggregate);
    if (!Object.keys(patch).length) continue;

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

  const weightDays = [...days.entries()].filter(
    ([, aggregate]) => inRange(aggregate.weightKg, 20, 400) !== null,
  );
  let bodyweightDays = 0;
  if (weightDays.length) {
    // IANA offsets range across both sides of UTC and can move a local day into
    // the preceding or following UTC date. Pad the lookup, then compare using
    // the same local-day bucketing as the incoming records.
    const searchFrom = `${shiftUtcDay(from, -1)}T00:00:00.000Z`;
    const searchTo = `${shiftUtcDay(to, 1)}T23:59:59.999Z`;
    const { data: existingWeights } = await admin
      .from("body_metrics")
      .select("id, recorded_at")
      .eq("user_id", userId)
      .gte("recorded_at", searchFrom)
      .lte("recorded_at", searchTo)
      .order("recorded_at", { ascending: true });
    // A travel sync can contain readings from more than one timezone. Evaluate
    // each stored instant against every requested local day+zone pair instead
    // of applying one batch-wide zone to all days.
    const takenDays = new Set(
      weightDays
        .filter(([day, aggregate]) =>
          (existingWeights ?? []).some(
            (row) => dayOf(row.recorded_at, aggregate.weightTimezone ?? null) === day,
          ),
        )
        .map(([day]) => day),
    );
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
