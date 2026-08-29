/**
 * Pure adapters for imported activity and health rows.
 *
 * This module intentionally has no Supabase client dependency. It only accepts
 * generated row shapes and returns values suitable for dashboard derivation.
 * Missing source values remain null, and unknown activity labels remain
 * unclassified instead of being guessed into a training category.
 */
import type { Database } from "@/integrations/supabase/types";

type Tables = Database["public"]["Tables"];

export type ImportedActivityRow = Tables["imported_activities"]["Row"];
export type HealthMetricRow = Tables["health_metrics"]["Row"];

export type ImportedActivityKind = "cardio" | "strength" | "mobility" | "conditioning" | "unknown";

export const DASHBOARD_HEALTH_METRIC_TYPES = [
  "sleep_minutes",
  "resting_hr",
  "hrv_ms",
  "bodyweight_kg",
  "steps",
  "active_calories",
] as const;

export type DashboardHealthMetricType = (typeof DASHBOARD_HEALTH_METRIC_TYPES)[number];

const DASHBOARD_HEALTH_METRIC_TYPE_SET = new Set<string>(DASHBOARD_HEALTH_METRIC_TYPES);

export function isDashboardHealthMetricType(value: string): value is DashboardHealthMetricType {
  return DASHBOARD_HEALTH_METRIC_TYPE_SET.has(value);
}

/* -------------------------------------------------------------------------- */
/* Calendar-day helpers                                                       */
/* -------------------------------------------------------------------------- */

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIXED_OFFSET = /^(?:(?:UTC|GMT)\s*)?([+-])(\d{2}):?(\d{2})$/i;

/** True only for a real Gregorian calendar day in YYYY-MM-DD form. */
export function isIsoDayKey(value: string): boolean {
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function fixedOffsetMinutes(value: string): number | null {
  const zone = value.trim();
  if (/^(?:Z|UTC|GMT)$/i.test(zone)) return 0;
  const match = FIXED_OFFSET.exec(zone);
  if (!match) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3]);
  if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return null;
  const amount = hours * 60 + minutes;
  return match[1] === "-" ? -amount : amount;
}

function ianaDay(date: Date, timeZone: string): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: "year" | "month" | "day") =>
      parts.find((entry) => entry.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    return year && month && day ? `${year}-${month}-${day}` : null;
  } catch {
    return null;
  }
}

/**
 * Calendar day for an instant, preferring the record's source zone.
 *
 * IANA zones (for example `America/Los_Angeles`) and fixed offsets (for example
 * `-07:00`) are supported. If the source zone is absent or unusable, the
 * caller-provided fallback is tried, then UTC. An unreadable instant returns
 * null rather than being coerced into a day.
 */
export function localDayKey(
  instant: string,
  sourceTimezone?: string | null,
  fallbackTimezone?: string | null,
): string | null {
  const millis = Date.parse(instant);
  if (!Number.isFinite(millis)) return null;
  const date = new Date(millis);

  for (const candidate of [sourceTimezone, fallbackTimezone]) {
    const zone = candidate?.trim();
    if (!zone) continue;
    const offset = fixedOffsetMinutes(zone);
    if (offset !== null) return new Date(millis + offset * 60_000).toISOString().slice(0, 10);
    const day = ianaDay(date, zone);
    if (day) return day;
  }

  return date.toISOString().slice(0, 10);
}

/** Whether an instant belongs to `day` under the same source/fallback rules. */
export function isInLocalDay(
  instant: string,
  day: string,
  sourceTimezone?: string | null,
  fallbackTimezone?: string | null,
): boolean {
  return isIsoDayKey(day) && localDayKey(instant, sourceTimezone, fallbackTimezone) === day;
}

/* -------------------------------------------------------------------------- */
/* Imported activities                                                        */
/* -------------------------------------------------------------------------- */

const STRENGTH_TERMS = [
  "strength",
  "strength training",
  "weightlifting",
  "weight lifting",
  "weight training",
  "resistance training",
  "powerlifting",
  "bodybuilding",
  "calisthenics",
];

const CONDITIONING_TERMS = [
  "conditioning",
  "hiit",
  "high intensity interval training",
  "interval training",
  "circuit training",
  "crossfit",
  "cross fit",
  "bootcamp",
  "boot camp",
  "functional training",
  "plyometrics",
];

const MOBILITY_TERMS = ["yoga", "pilates", "mobility", "stretching", "flexibility"];

const CARDIO_TERMS = [
  "cardio",
  "aerobic",
  "run",
  "running",
  "treadmill",
  "walk",
  "walking",
  "hike",
  "hiking",
  "bike",
  "biking",
  "bicycle",
  "cycling",
  "spin",
  "row",
  "rowing",
  "swim",
  "swimming",
  "elliptical",
  "stair climbing",
  "soccer",
  "football",
  "basketball",
  "tennis",
  "skiing",
  "skating",
  "dance",
  "kayaking",
  "paddling",
  "surfing",
];

function searchableActivityText(activityType: string, name?: string | null): string {
  return `${activityType} ${name ?? ""}`
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsTerm(text: string, terms: readonly string[]): boolean {
  const padded = ` ${text} `;
  return terms.some((term) => padded.includes(` ${term} `));
}

/**
 * Classifies only labels with explicit evidence. The activity name is used as
 * a secondary signal when a provider sends a generic type such as `other`.
 */
export function classifyImportedActivity(
  activityType: string,
  name?: string | null,
): ImportedActivityKind {
  const text = searchableActivityText(activityType, name);
  if (containsTerm(text, STRENGTH_TERMS)) return "strength";
  if (containsTerm(text, MOBILITY_TERMS)) return "mobility";
  if (containsTerm(text, CONDITIONING_TERMS)) return "conditioning";
  if (containsTerm(text, CARDIO_TERMS)) return "cardio";
  return "unknown";
}

interface ImportedIdentityRow {
  id: string;
  external_id: string | null;
  source_type: string;
}

/**
 * Stable, first-row-wins dedupe for already-imported rows.
 *
 * Row ids are globally unique. Provider ids are scoped by source type, matching
 * the import pipeline's `ext:<source>:<externalId>` identity semantics.
 */
export function dedupeImportedRows<T extends ImportedIdentityRow>(rows: readonly T[]): T[] {
  const rowIds = new Set<string>();
  const externalIds = new Set<string>();
  const result: T[] = [];

  for (const row of rows) {
    const rowId = row.id.trim();
    const externalId = row.external_id?.trim();
    const externalKey = externalId ? `${row.source_type.trim()}\u0000${externalId}` : null;
    if ((rowId && rowIds.has(rowId)) || (externalKey && externalIds.has(externalKey))) continue;
    if (rowId) rowIds.add(rowId);
    if (externalKey) externalIds.add(externalKey);
    result.push(row);
  }

  return result;
}

export interface ImportedDashboardActivity {
  id: string;
  externalId: string | null;
  activityType: string;
  name: string | null;
  kind: ImportedActivityKind;
  startedAt: string;
  localDay: string | null;
  sourceTimezone: string | null;
  sourceType: string;
  sourceFileName: string | null;
  durationSec: number | null;
  /** Exact seconds-to-minutes conversion; null when duration was not imported. */
  durationMinutes: number | null;
  distanceM: number | null;
  elevationGainM: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  steps: number | null;
  notes: string | null;
}

export function importedActivityToDashboard(
  row: ImportedActivityRow,
  fallbackTimezone?: string | null,
): ImportedDashboardActivity {
  return {
    id: row.id,
    externalId: row.external_id,
    activityType: row.activity_type,
    name: row.name,
    kind: classifyImportedActivity(row.activity_type, row.name),
    startedAt: row.started_at,
    localDay: localDayKey(row.started_at, row.source_timezone, fallbackTimezone),
    sourceTimezone: row.source_timezone,
    sourceType: row.source_type,
    sourceFileName: row.source_file_name,
    durationSec: row.duration_sec,
    durationMinutes: row.duration_sec === null ? null : row.duration_sec / 60,
    distanceM: row.distance_m,
    elevationGainM: row.elevation_gain_m,
    calories: row.calories,
    avgHr: row.avg_hr,
    maxHr: row.max_hr,
    steps: row.steps,
    notes: row.notes,
  };
}

export function importedActivitiesToDashboard(
  rows: readonly ImportedActivityRow[],
  fallbackTimezone?: string | null,
): ImportedDashboardActivity[] {
  return dedupeImportedRows(rows).map((row) => importedActivityToDashboard(row, fallbackTimezone));
}

export function importedActivitiesForLocalDay(
  rows: readonly ImportedActivityRow[],
  day: string,
  fallbackTimezone?: string | null,
): ImportedDashboardActivity[] {
  if (!isIsoDayKey(day)) return [];
  return importedActivitiesToDashboard(rows, fallbackTimezone).filter(
    (activity) => activity.localDay === day,
  );
}

export interface LoggedActivityIdentity {
  name: string;
  startedAt: string;
  durationMinutes: number | null;
}

function normalizedName(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Removes conservative cross-source mirrors (for example an IronDesk workout
 * exported to Health Connect and read back). A row is removed only when its
 * start, duration, and normalized name all closely match a native session.
 */
export function excludeLikelyMirroredActivities(
  imported: readonly ImportedDashboardActivity[],
  logged: readonly LoggedActivityIdentity[],
): ImportedDashboardActivity[] {
  return imported.filter((activity) => {
    const importedStart = Date.parse(activity.startedAt);
    const importedName = normalizedName(activity.name ?? activity.activityType);
    if (!Number.isFinite(importedStart) || !importedName) return true;
    return !logged.some((session) => {
      const loggedStart = Date.parse(session.startedAt);
      if (!Number.isFinite(loggedStart) || Math.abs(importedStart - loggedStart) > 2 * 60_000)
        return false;
      if (activity.durationMinutes == null || session.durationMinutes == null) return false;
      if (Math.abs(activity.durationMinutes - session.durationMinutes) > 3) return false;
      const loggedName = normalizedName(session.name);
      return (
        Boolean(loggedName) &&
        (importedName === loggedName ||
          importedName.includes(loggedName) ||
          loggedName.includes(importedName))
      );
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Health metric day summaries                                                */
/* -------------------------------------------------------------------------- */

export interface HealthMetricEvidence {
  rowId: string;
  externalId: string | null;
  metricType: DashboardHealthMetricType;
  recordedAt: string;
  sourceTimezone: string | null;
  sourceType: string;
  value: number;
  unit: string;
  notes: string | null;
}

export type HealthMetricEvidenceByType = {
  [Metric in DashboardHealthMetricType]: HealthMetricEvidence[];
};

export interface HealthMetricDaySummary {
  day: string;
  /** Sum of distinct sleep records assigned to the day. */
  sleepMinutes: number | null;
  /** Latest recorded daily value; all samples remain available in evidence. */
  restingHr: number | null;
  /** Latest recorded daily value; all samples remain available in evidence. */
  hrvMs: number | null;
  /** Latest recorded daily value; all samples remain available in evidence. */
  bodyweightKg: number | null;
  /** Sum of distinct step records assigned to the day. */
  steps: number | null;
  /** Sum of distinct active-energy records assigned to the day. */
  activeCalories: number | null;
  evidence: HealthMetricEvidenceByType;
}

function emptyEvidence(): HealthMetricEvidenceByType {
  return {
    sleep_minutes: [],
    resting_hr: [],
    hrv_ms: [],
    bodyweight_kg: [],
    steps: [],
    active_calories: [],
  };
}

function byRecordedAt(a: HealthMetricEvidence, b: HealthMetricEvidence): number {
  const time = Date.parse(a.recordedAt) - Date.parse(b.recordedAt);
  return time || a.rowId.localeCompare(b.rowId);
}

function total(points: readonly HealthMetricEvidence[]): number | null {
  return points.length ? points.reduce((sum, point) => sum + point.value, 0) : null;
}

function latest(points: readonly HealthMetricEvidence[]): number | null {
  return points.length ? points[points.length - 1]!.value : null;
}

function latestCanonicalBodyweightKg(points: readonly HealthMetricEvidence[]): number | null {
  const valid = points.filter(
    (point) => point.unit.trim().toLowerCase() === "kg" && point.value >= 20 && point.value <= 400,
  );
  return latest(valid);
}

/**
 * Dedupe and aggregate the six dashboard-supported health metrics by the
 * record's local calendar day. Unsupported metric types remain untouched by
 * this read model and are not relabeled into a supported field.
 */
export function summarizeHealthMetricsByDay(
  rows: readonly HealthMetricRow[],
  fallbackTimezone?: string | null,
): HealthMetricDaySummary[] {
  const grouped = new Map<string, HealthMetricEvidenceByType>();

  for (const row of dedupeImportedRows(rows)) {
    if (!isDashboardHealthMetricType(row.metric_type)) continue;
    const day = localDayKey(row.recorded_at, row.source_timezone, fallbackTimezone);
    if (!day) continue;
    const evidence = grouped.get(day) ?? emptyEvidence();
    evidence[row.metric_type].push({
      rowId: row.id,
      externalId: row.external_id,
      metricType: row.metric_type,
      recordedAt: row.recorded_at,
      sourceTimezone: row.source_timezone,
      sourceType: row.source_type,
      value: row.value,
      unit: row.unit,
      notes: row.notes,
    });
    grouped.set(day, evidence);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, evidence]) => {
      for (const metricType of DASHBOARD_HEALTH_METRIC_TYPES)
        evidence[metricType].sort(byRecordedAt);
      return {
        day,
        sleepMinutes: total(evidence.sleep_minutes),
        restingHr: latest(evidence.resting_hr),
        hrvMs: latest(evidence.hrv_ms),
        bodyweightKg: latestCanonicalBodyweightKg(evidence.bodyweight_kg),
        steps: total(evidence.steps),
        activeCalories: total(evidence.active_calories),
        evidence,
      };
    });
}

export function healthMetricSummaryForLocalDay(
  rows: readonly HealthMetricRow[],
  day: string,
  fallbackTimezone?: string | null,
): HealthMetricDaySummary | null {
  if (!isIsoDayKey(day)) return null;
  return (
    summarizeHealthMetricsByDay(rows, fallbackTimezone).find((summary) => summary.day === day) ??
    null
  );
}
