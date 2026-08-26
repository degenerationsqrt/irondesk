/**
 * Normalized import model.
 *
 * Every supported file format is reduced to the two record shapes below before
 * anything is written to the database. Parsers never touch Supabase and never
 * evaluate file content — they only read bytes and produce these structures.
 */

export type FileFormat = "fit" | "tcx" | "gpx" | "csv" | "json" | "zip";

export type SourceType = "health_connect" | "garmin_file" | "generic_file";

export const METRIC_TYPES = [
  "steps",
  "sleep_minutes",
  "sleep_efficiency_percent",
  "resting_hr",
  "hrv_ms",
  "bodyweight_kg",
  "active_calories",
  "distance_m",
  "heart_rate_bpm",
] as const;

export type MetricType = (typeof METRIC_TYPES)[number];

export interface NormalizedActivity {
  kind: "activity";
  /** Provider-stable id when the file supplies one; drives dedupe when present. */
  externalId: string | null;
  activityType: string;
  name: string | null;
  /** ISO-8601 UTC instant. */
  startedAt: string;
  /** IANA zone or fixed offset recorded in the source, when it carries one. */
  sourceTimezone: string | null;
  durationSec: number | null;
  distanceM: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGainM: number | null;
  steps: number | null;
  notes: string | null;
  raw: Record<string, unknown>;
}

export interface NormalizedMetric {
  kind: "metric";
  externalId: string | null;
  metricType: MetricType;
  recordedAt: string;
  sourceTimezone: string | null;
  value: number;
  unit: string;
  notes: string | null;
  raw: Record<string, unknown>;
}

export type NormalizedRecord = NormalizedActivity | NormalizedMetric;

export interface ParseIssue {
  severity: "warning" | "error";
  message: string;
  row?: number;
  field?: string;
}

export interface TabularPreview {
  headers: string[];
  rows: string[][];
}

export interface ParseResult {
  format: FileFormat;
  /** False when the file parsed but the fields are unknown → mapping wizard. */
  recognized: boolean;
  records: NormalizedRecord[];
  issues: ParseIssue[];
  /** Source columns/keys that were understood but intentionally not stored. */
  skippedFields: string[];
  /** Present for CSV/JSON so the mapping wizard has something to work with. */
  table?: TabularPreview;
  /** Entry names when the upload was an archive. */
  archiveEntries?: string[];
  notes: string[];
}

/* ------------------------------- mapping ---------------------------------- */

export const ACTIVITY_TARGETS = [
  "externalId",
  "startedAt",
  "timezone",
  "activityType",
  "name",
  "duration",
  "distance",
  "calories",
  "avgHr",
  "maxHr",
  "steps",
  "notes",
] as const;

export const METRIC_TARGETS = ["externalId", "recordedAt", "timezone", "metricType", "value", "notes"] as const;

export type ActivityTarget = (typeof ACTIVITY_TARGETS)[number];
export type MetricTarget = (typeof METRIC_TARGETS)[number];

export interface ImportMapping {
  recordKind: "activity" | "metric";
  /** target field -> source column / JSON key. Empty string = unmapped. */
  fields: Record<string, string>;
  durationUnit: "seconds" | "minutes" | "hours";
  distanceUnit: "m" | "km" | "mi";
  weightUnit: "kg" | "lb";
  /** Used when a metric file has no per-row type column. */
  fixedMetricType: MetricType;
}

export const DEFAULT_MAPPING: ImportMapping = {
  recordKind: "activity",
  fields: {},
  durationUnit: "seconds",
  distanceUnit: "m",
  weightUnit: "kg",
  fixedMetricType: "steps",
};

/* -------------------------------- limits ---------------------------------- */

/** Hard input limits. Enforced before any parsing work happens. */
export const LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxArchiveEntries: 200,
  maxArchiveUncompressedBytes: 100 * 1024 * 1024,
  /** Refuse an entry whose declared expansion ratio looks like a zip bomb. */
  maxCompressionRatio: 200,
  maxRecords: 20_000,
  maxTableRows: 50_000,
  previewRows: 25,
} as const;

export const SUPPORTED_EXTENSIONS: Record<FileFormat, string[]> = {
  fit: [".fit"],
  tcx: [".tcx"],
  gpx: [".gpx"],
  csv: [".csv"],
  json: [".json"],
  zip: [".zip"],
};
