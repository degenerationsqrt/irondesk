/**
 * Field mapping for unrecognized CSV / JSON files.
 *
 * `guessMapping` handles the common cases automatically (Health Connect and
 * Strava-style column names); anything it cannot resolve opens the wizard so
 * the user assigns columns explicitly. Nothing is guessed silently: the preview
 * always shows which target fields resolved and which source columns were left
 * behind.
 */
import {
  DEFAULT_MAPPING,
  METRIC_TYPES,
  type ImportMapping,
  type MetricType,
  type NormalizedActivity,
  type NormalizedMetric,
  type NormalizedRecord,
  type ParseIssue,
  type TabularPreview,
} from "./types";

const ALIASES: Record<string, string[]> = {
  externalId: ["id", "external_id", "externalid", "activity_id", "uuid", "record_id", "session_id"],
  startedAt: ["start_time", "starttime", "started_at", "date", "datetime", "timestamp", "start", "start_date"],
  recordedAt: ["recorded_at", "time", "timestamp", "date", "datetime", "day"],
  timezone: ["timezone", "time_zone", "tz", "zone", "offset"],
  activityType: ["type", "activity_type", "exercise_type", "sport", "activity"],
  name: ["name", "title", "activity_name", "label"],
  duration: ["duration", "duration_sec", "duration_seconds", "elapsed_time", "moving_time", "duration_min", "minutes"],
  distance: ["distance", "distance_m", "distance_km", "distance_meters", "total_distance"],
  calories: ["calories", "kcal", "energy", "active_calories", "total_calories"],
  avgHr: ["avg_hr", "average_heart_rate", "avg_heart_rate", "heart_rate_avg", "average_hr"],
  maxHr: ["max_hr", "max_heart_rate", "maximum_heart_rate", "heart_rate_max"],
  steps: ["steps", "step_count", "total_steps"],
  notes: ["notes", "note", "description", "comment"],
  metricType: ["metric", "metric_type", "type", "record_type"],
  value: ["value", "amount", "quantity", "count", "weight", "weight_kg"],
};

const norm = (header: string) => header.trim().toLowerCase().replace(/[\s-]+/g, "_");

export function guessMapping(headers: string[], preferred?: ImportMapping): ImportMapping {
  const base: ImportMapping = preferred ? { ...preferred, fields: { ...preferred.fields } } : { ...DEFAULT_MAPPING, fields: {} };
  const normalized = headers.map((h) => ({ header: h, key: norm(h) }));



  const pick = (target: string) => {
    if (base.fields[target]) return;
    const options = ALIASES[target] ?? [];
    const exact = normalized.find((h) => options.includes(h.key));
    if (exact) base.fields[target] = exact.header;
  };

  for (const target of Object.keys(ALIASES)) pick(target);

  // Decide the record kind from what resolved.
  const looksLikeMetric = Boolean(base.fields["value"]) && !base.fields["duration"] && !base.fields["distance"];
  base.recordKind = looksLikeMetric ? "metric" : "activity";
  if (base.recordKind === "metric") {
    delete base.fields["startedAt"];
  } else {
    delete base.fields["recordedAt"];
    delete base.fields["metricType"];
    delete base.fields["value"];
  }

  // Unit hints from column names.
  const durationHeader = norm(base.fields["duration"] ?? "");
  if (/min/.test(durationHeader)) base.durationUnit = "minutes";
  const distanceHeader = norm(base.fields["distance"] ?? "");
  if (/_km|\(km\)|kilomet/.test(distanceHeader)) base.distanceUnit = "km";
  else if (/_mi|mile/.test(distanceHeader)) base.distanceUnit = "mi";
  const valueHeader = norm(base.fields["value"] ?? "");
  if (/_lb|pound/.test(valueHeader)) base.weightUnit = "lb";

  
  return base;
}

/** A mapping is complete enough to import when the essentials resolved. */
export function mappingIsUsable(mapping: ImportMapping): boolean {
  return mapping.recordKind === "activity"
    ? Boolean(mapping.fields["startedAt"])
    : Boolean(mapping.fields["recordedAt"] && mapping.fields["value"]);
}

const DURATION_FACTOR = { seconds: 1, minutes: 60, hours: 3600 } as const;
const DISTANCE_FACTOR = { m: 1, km: 1000, mi: 1609.344 } as const;

const numberOf = (raw: string | undefined): number | null => {
  if (raw == null) return null;
  const cleaned = raw.replace(/[^0-9.,+-]/g, "").replace(/,(?=\d{3}\b)/g, "");
  const value = Number(cleaned.replace(",", "."));
  return cleaned !== "" && Number.isFinite(value) ? value : null;
};

const intOf = (raw: string | undefined): number | null => {
  const value = numberOf(raw);
  return value == null ? null : Math.round(value);
};

/**
 * Parses a timestamp. A naive value (no zone marker) is interpreted with the
 * mapped timezone offset if one is supplied, otherwise treated as UTC and
 * flagged, so an import can never silently shift a day boundary unnoticed.
 */
function timestamp(
  raw: string | undefined,
  tz: string | undefined,
  row: number,
  issues: ParseIssue[],
): { iso: string; zone: string | null } | null {
  if (!raw?.trim()) {
    issues.push({ severity: "error", row, message: "Row skipped: no timestamp." });
    return null;
  }
  const value = raw.trim();
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  const offset = tz?.trim() && /^[+-]\d{2}:?\d{2}$/.test(tz.trim()) ? tz.trim() : null;
  const candidate = zoned ? value : offset ? `${value.replace(" ", "T")}${offset}` : `${value.replace(" ", "T")}Z`;
  const ms = Date.parse(candidate);
  if (!Number.isFinite(ms)) {
    issues.push({ severity: "error", row, message: `Row skipped: unreadable timestamp "${raw}".` });
    return null;
  }
  if (!zoned && !offset) {
    issues.push({ severity: "warning", row, message: `"${raw}" has no timezone — read as UTC.` });
  }
  return { iso: new Date(ms).toISOString(), zone: zoned ? null : (offset ?? tz?.trim() ?? null) };
}

function metricTypeOf(raw: string | undefined, fallback: MetricType): MetricType | null {
  if (!raw?.trim()) return fallback;
  const key = norm(raw);
  const direct = METRIC_TYPES.find((m) => m === key);
  if (direct) return direct;
  const aliases: Record<string, MetricType> = {
    step: "steps",
    step_count: "steps",
    sleep: "sleep_minutes",
    sleep_duration: "sleep_minutes",
    sleep_efficiency: "sleep_efficiency_percent",
    rhr: "resting_hr",
    resting_heart_rate: "resting_hr",
    hrv: "hrv_ms",
    weight: "bodyweight_kg",
    bodyweight: "bodyweight_kg",
    body_weight: "bodyweight_kg",
    active_energy: "active_calories",
    heart_rate: "heart_rate_bpm",
    distance: "distance_m",
  };
  return aliases[key] ?? null;
}

export interface MappedResult {
  records: NormalizedRecord[];
  issues: ParseIssue[];
  skippedFields: string[];
}

export function applyMapping(table: TabularPreview, mapping: ImportMapping): MappedResult {
  const issues: ParseIssue[] = [];
  const index = new Map(table.headers.map((header, i) => [header, i]));
  const used = new Set(Object.values(mapping.fields).filter(Boolean));
  const skippedFields = table.headers.filter((header) => !used.has(header));

  const get = (row: string[], target: string): string | undefined => {
    const header = mapping.fields[target];
    if (!header) return undefined;
    const at = index.get(header);
    return at == null ? undefined : row[at];
  };

  const records: NormalizedRecord[] = [];

  table.rows.forEach((row, i) => {
    const rowNumber = i + 2; // header is row 1
    if (row.every((cell) => cell.trim() === "")) return;

    if (mapping.recordKind === "activity") {
      const when = timestamp(get(row, "startedAt"), get(row, "timezone"), rowNumber, issues);
      if (!when) return;
      const rawDuration = numberOf(get(row, "duration"));
      const rawDistance = numberOf(get(row, "distance"));
      const activity: NormalizedActivity = {
        kind: "activity",
        externalId: get(row, "externalId")?.trim() || null,
        activityType: (get(row, "activityType")?.trim() || "other").toLowerCase(),
        name: get(row, "name")?.trim() || null,
        startedAt: when.iso,
        sourceTimezone: when.zone,
        durationSec: rawDuration == null ? null : Math.round(rawDuration * DURATION_FACTOR[mapping.durationUnit]),
        distanceM: rawDistance == null ? null : Math.round(rawDistance * DISTANCE_FACTOR[mapping.distanceUnit]),
        calories: intOf(get(row, "calories")),
        avgHr: intOf(get(row, "avgHr")),
        maxHr: intOf(get(row, "maxHr")),
        elevationGainM: null,
        steps: intOf(get(row, "steps")),
        notes: get(row, "notes")?.trim() || null,
        raw: { mapped: true, row: rowNumber },
      };
      records.push(activity);
      return;
    }

    const when = timestamp(get(row, "recordedAt"), get(row, "timezone"), rowNumber, issues);
    if (!when) return;
    const metricType = metricTypeOf(get(row, "metricType"), mapping.fixedMetricType);
    if (!metricType) {
      issues.push({
        severity: "error",
        row: rowNumber,
        message: `Row skipped: "${get(row, "metricType")}" is not a metric IronDesk stores.`,
      });
      return;
    }
    const value = numberOf(get(row, "value"));
    if (value == null) {
      issues.push({ severity: "error", row: rowNumber, message: "Row skipped: value is not a number." });
      return;
    }
    const isWeight = metricType === "bodyweight_kg";
    const converted = isWeight && mapping.weightUnit === "lb" ? value / 2.2046226218 : value;
    const metric: NormalizedMetric = {
      kind: "metric",
      externalId: get(row, "externalId")?.trim() || null,
      metricType,
      recordedAt: when.iso,
      sourceTimezone: when.zone,
      value: Math.round(converted * 100) / 100,
      unit: UNIT_OF[metricType],
      notes: get(row, "notes")?.trim() || null,
      raw: { mapped: true, row: rowNumber },
    };
    records.push(metric);
  });

  return { records, issues, skippedFields };
}

export const UNIT_OF: Record<MetricType, string> = {
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
