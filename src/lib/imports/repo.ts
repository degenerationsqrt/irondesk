/**
 * Import persistence (authenticated mode only).
 *
 * Everything here is owner-scoped: the user id always comes from the session,
 * never from client input, and RLS enforces the same rule server side. An
 * File imports are one `import_jobs` row plus normalized child rows, so those
 * batches can be rolled back by deleting the job (children cascade). Live
 * device-sync jobs also create separately managed Recovery/Body Metrics rows
 * and are therefore presented as audit history rather than file rollbacks.
 */
import { supabase } from "@/integrations/supabase/client";

import { IronDeskError, asIronDeskError } from "@/lib/irondesk/errors";

import { withHashes } from "./dedupe";
import type { FileFormat, NormalizedRecord, ParseIssue, SourceType } from "./types";

const NORMALIZED_VERSION = 1;

/** Must stay inside the checked-in `import_jobs.status` constraint. */
export const FILE_IMPORT_INITIAL_JOB_STATUS = "committing" as const;

async function requireUser(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user)
    throw new IronDeskError("You need to be signed in to import data.", "unauthenticated");
  return data.user.id;
}

export interface ImportJob {
  id: string;
  /** Present for live connector/device jobs; absent for ordinary file uploads. */
  dataSourceId: string | null;
  sourceType: string;
  fileName: string | null;
  fileFormat: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  totalRecords: number;
  importedCount: number;
  duplicateCount: number;
  warningCount: number;
  failedCount: number;
  warnings: ParseIssue[];
  errorMessage: string | null;
}

export interface CommitInput {
  sourceType: SourceType;
  fileName: string;
  fileFormat: FileFormat;
  fileSizeBytes: number;
  records: NormalizedRecord[];
  issues: ParseIssue[];
}

export type CommitResult = ImportJob;

/* ------------------------------- helpers ---------------------------------- */

const jobFromRow = (row: Record<string, unknown>): ImportJob => ({
  id: row["id"] as string,
  dataSourceId: (row["data_source_id"] as string | null) ?? null,
  sourceType: row["source_type"] as string,
  fileName: (row["file_name"] as string | null) ?? null,
  fileFormat: row["file_format"] as string,
  status: row["status"] as string,
  startedAt: row["started_at"] as string,
  finishedAt: (row["finished_at"] as string | null) ?? null,
  totalRecords: Number(row["total_records"] ?? 0),
  importedCount: Number(row["imported_count"] ?? 0),
  duplicateCount: Number(row["duplicate_count"] ?? 0),
  warningCount: Number(row["warning_count"] ?? 0),
  failedCount: Number(row["failed_count"] ?? 0),
  warnings: Array.isArray(row["warnings"]) ? (row["warnings"] as ParseIssue[]) : [],
  errorMessage: (row["error_message"] as string | null) ?? null,
});

/* -------------------------------- commit ---------------------------------- */

/**
 * Writes a parsed file into the athlete's account.
 *
 * Duplicates are resolved by the `(user_id, dedupe_hash)` unique index — rows
 * that already exist are ignored, and the job records how many were skipped, so
 * re-uploading the same export never double counts.
 */
export async function commitImport(input: CommitInput): Promise<CommitResult> {
  const userId = await requireUser();
  const hashed = await withHashes(input.records, input.sourceType);

  const warnings = input.issues.filter((issue) => issue.severity === "warning");
  const errors = input.issues.filter((issue) => issue.severity === "error");

  const { data: jobRow, error: jobError } = await supabase
    .from("import_jobs")
    .insert({
      user_id: userId,
      source_type: input.sourceType,
      file_name: input.fileName,
      file_size_bytes: input.fileSizeBytes,
      file_format: input.fileFormat,
      status: FILE_IMPORT_INITIAL_JOB_STATUS,
      total_records: hashed.length,
      warning_count: warnings.length,
      failed_count: errors.length,
      warnings: [...warnings, ...errors].slice(0, 200) as unknown as never,
      normalized_version: NORMALIZED_VERSION,
    })
    .select("*")
    .single();
  if (jobError || !jobRow) throw asIronDeskError(jobError, "The import could not be started.");

  const jobId = jobRow.id;

  try {
    const activities = hashed.filter((entry) => entry.record.kind === "activity");
    const metrics = hashed.filter((entry) => entry.record.kind === "metric");
    let imported = 0;

    for (let i = 0; i < activities.length; i += 500) {
      const chunk = activities.slice(i, i + 500).map(({ record, hash }) => {
        const activity = record as Extract<NormalizedRecord, { kind: "activity" }>;
        return {
          user_id: userId,
          import_job_id: jobId,
          source_type: input.sourceType,
          source_file_name: input.fileName,
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
      const { data, error } = await supabase
        .from("imported_activities")
        .upsert(chunk, { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true })
        .select("id");
      if (error) throw asIronDeskError(error, "Activities could not be written.");
      imported += data?.length ?? 0;
    }

    for (let i = 0; i < metrics.length; i += 500) {
      const chunk = metrics.slice(i, i + 500).map(({ record, hash }) => {
        const metric = record as Extract<NormalizedRecord, { kind: "metric" }>;
        return {
          user_id: userId,
          import_job_id: jobId,
          source_type: input.sourceType,
          source_file_name: input.fileName,
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
      const { data, error } = await supabase
        .from("health_metrics")
        .upsert(chunk, { onConflict: "user_id,dedupe_hash", ignoreDuplicates: true })
        .select("id");
      if (error) throw asIronDeskError(error, "Health metrics could not be written.");
      imported += data?.length ?? 0;
    }

    const { data: finished, error: finishError } = await supabase
      .from("import_jobs")
      .update({
        status: "completed",
        finished_at: new Date().toISOString(),
        imported_count: imported,
        duplicate_count: Math.max(0, hashed.length - imported),
      })
      .eq("id", jobId)
      .select("*")
      .single();
    if (finishError || !finished)
      throw asIronDeskError(finishError, "The import finished but could not be recorded.");
    return jobFromRow(finished as unknown as Record<string, unknown>);
  } catch (error) {
    const failure = asIronDeskError(error, "The import failed.");
    await supabase
      .from("import_jobs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: failure.message,
      })
      .eq("id", jobId);
    throw failure;
  }
}

/* -------------------------------- history --------------------------------- */

export async function listImportJobs(limit = 25): Promise<ImportJob[]> {
  const { data, error } = await supabase
    .from("import_jobs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw asIronDeskError(error, "Import history could not be loaded.");
  return (data ?? []).map((row) => jobFromRow(row as unknown as Record<string, unknown>));
}

export interface ImportTotals {
  activities: number;
  metrics: number;
}

export async function getImportTotals(): Promise<ImportTotals> {
  const [activities, metrics] = await Promise.all([
    supabase.from("imported_activities").select("id", { count: "exact", head: true }),
    supabase.from("health_metrics").select("id", { count: "exact", head: true }),
  ]);
  if (activities.error) throw asIronDeskError(activities.error);
  if (metrics.error) throw asIronDeskError(metrics.error);
  return { activities: activities.count ?? 0, metrics: metrics.count ?? 0 };
}

/** Removes an import batch and every row it created (children cascade). */
export async function rollbackImport(jobId: string): Promise<void> {
  await requireUser();
  const { error } = await supabase.from("import_jobs").delete().eq("id", jobId);
  if (error) throw asIronDeskError(error, "The import could not be rolled back.");
}

/* ---------------------------- saved mappings ------------------------------ */

export interface SavedMapping {
  id: string;
  sourceLabel: string;
  fileFormat: string;
  recordKind: string;
  mapping: unknown;
}

export async function listSavedMappings(): Promise<SavedMapping[]> {
  const { data, error } = await supabase
    .from("saved_import_mappings")
    .select("id, source_label, file_format, record_kind, mapping")
    .order("updated_at", { ascending: false });
  if (error) throw asIronDeskError(error, "Saved field mappings could not be loaded.");
  return (data ?? []).map((row) => ({
    id: row.id,
    sourceLabel: row.source_label,
    fileFormat: row.file_format,
    recordKind: row.record_kind,
    mapping: row.mapping,
  }));
}

export async function saveMapping(input: {
  sourceLabel: string;
  fileFormat: string;
  recordKind: string;
  mapping: unknown;
}): Promise<void> {
  const userId = await requireUser();
  const { error } = await supabase.from("saved_import_mappings").insert({
    user_id: userId,
    source_label: input.sourceLabel,
    file_format: input.fileFormat,
    record_kind: input.recordKind,
    mapping: input.mapping as never,
  });
  if (error) throw asIronDeskError(error, "The field mapping could not be saved.");
}

export async function deleteMapping(id: string): Promise<void> {
  const { error } = await supabase.from("saved_import_mappings").delete().eq("id", id);
  if (error) throw asIronDeskError(error, "The field mapping could not be deleted.");
}

/* ------------------------- recent imported records ------------------------ */

export interface ImportedActivitySummary {
  id: string;
  activityType: string;
  name: string | null;
  startedAt: string;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  avgHr: number | null;
  sourceType: string;
  sourceFileName: string | null;
  rawMetadata: unknown;
  importedAt: string;
  job: ImportedRecordJob | null;
}

export interface ImportedRecordJob {
  status: string;
  finishedAt: string | null;
  errorMessage: string | null;
}

function jobFromRelation(value: unknown): ImportedRecordJob | null {
  const relation = Array.isArray(value) ? value[0] : value;
  if (!relation || typeof relation !== "object") return null;
  const row = relation as Record<string, unknown>;
  if (typeof row["status"] !== "string") return null;
  return {
    status: row["status"],
    finishedAt: typeof row["finished_at"] === "string" ? row["finished_at"] : null,
    errorMessage: typeof row["error_message"] === "string" ? row["error_message"] : null,
  };
}

export async function listImportedActivities(limit = 20): Promise<ImportedActivitySummary[]> {
  const { data, error } = await supabase
    .from("imported_activities")
    .select(
      "id, activity_type, name, started_at, duration_sec, distance_m, calories, avg_hr, source_type, source_file_name, raw_metadata, imported_at, job:import_jobs(status, finished_at, error_message)",
    )
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw asIronDeskError(error, "Imported activities could not be loaded.");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    id: row["id"] as string,
    activityType: row["activity_type"] as string,
    name: (row["name"] as string | null) ?? null,
    startedAt: row["started_at"] as string,
    durationSec: row["duration_sec"] === null ? null : Number(row["duration_sec"]),
    distanceM: row["distance_m"] === null ? null : Number(row["distance_m"]),
    calories: row["calories"] === null ? null : Number(row["calories"]),
    avgHr: row["avg_hr"] === null ? null : Number(row["avg_hr"]),
    sourceType: row["source_type"] as string,
    sourceFileName: (row["source_file_name"] as string | null) ?? null,
    rawMetadata: row["raw_metadata"] ?? null,
    importedAt: row["imported_at"] as string,
    job: jobFromRelation(row["job"]),
  }));
}

export interface ImportedMetricSummary {
  id: string;
  metricType: string;
  recordedAt: string;
  value: number;
  unit: string;
  sourceType: string;
  sourceFileName: string | null;
  rawMetadata: unknown;
  importedAt: string;
  job: ImportedRecordJob | null;
}

export async function listHealthMetrics(limit = 20): Promise<ImportedMetricSummary[]> {
  const { data, error } = await supabase
    .from("health_metrics")
    .select(
      "id, metric_type, recorded_at, value, unit, source_type, source_file_name, raw_metadata, imported_at, job:import_jobs(status, finished_at, error_message)",
    )
    .order("recorded_at", { ascending: false })
    .limit(limit);
  if (error) throw asIronDeskError(error, "Imported health metrics could not be loaded.");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
    id: row["id"] as string,
    metricType: row["metric_type"] as string,
    recordedAt: row["recorded_at"] as string,
    value: Number(row["value"]),
    unit: row["unit"] as string,
    sourceType: row["source_type"] as string,
    sourceFileName: (row["source_file_name"] as string | null) ?? null,
    rawMetadata: row["raw_metadata"] ?? null,
    importedAt: row["imported_at"] as string,
    job: jobFromRelation(row["job"]),
  }));
}

/* ---------------------------- device pairing ------------------------------ */

/**
 * Android companion pairing.
 *
 * The browser generates a one-time code, stores only its SHA-256 hash, and
 * shows the plain code once. The companion app exchanges it at
 * `/api/public/health-connect/pair` for a device token; the code itself is
 * never recoverable from the database.
 */
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
const PAIRING_TTL_MINUTES = 15;

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export interface PairingCode {
  /** Shown once, never stored in plain text. */
  code: string;
  expiresAt: string;
}

export async function createPairingCode(label = "Android phone"): Promise<PairingCode> {
  const userId = await requireUser();
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]).join(
    "",
  );
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000).toISOString();

  const { error } = await supabase.from("device_pairings").insert({
    user_id: userId,
    code_hash: await sha256Hex(code),
    label,
    expires_at: expiresAt,
  });
  if (error) throw asIronDeskError(error, "The pairing code could not be created.");
  return { code, expiresAt };
}

export interface LinkedDevice {
  id: string;
  label: string;
  platform: string;
  createdAt: string;
  lastSyncAt: string | null;
  lastSyncSummary: {
    jobId?: string;
    total?: number;
    imported?: number;
    duplicates?: number;
    warnings?: number;
    failed?: number;
    recoveryDays?: number;
    bodyweightDays?: number;
  } | null;
}

export async function listLinkedDevices(): Promise<LinkedDevice[]> {
  const { data, error } = await supabase
    .from("device_links")
    .select("id, label, platform, created_at, last_sync_at, last_sync_summary")
    .order("created_at", { ascending: false });
  if (error) throw asIronDeskError(error, "Linked devices could not be loaded.");
  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    platform: row.platform,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at,
    lastSyncSummary: (row.last_sync_summary as LinkedDevice["lastSyncSummary"]) ?? null,
  }));
}

/** Revokes the device token; the phone can no longer sync until re-paired. */
export async function unlinkDevice(id: string): Promise<void> {
  await requireUser();
  const { error } = await supabase.from("device_links").delete().eq("id", id);
  if (error) throw asIronDeskError(error, "The device could not be unlinked.");
}
