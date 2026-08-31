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
  ACTIVITY_TARGETS,
  DEFAULT_MAPPING,
  METRIC_TARGETS,
  METRIC_TYPES,
  type FileFormat,
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
  startedAt: [
    "start_time",
    "starttime",
    "started_at",
    "date",
    "datetime",
    "timestamp",
    "start",
    "start_date",
  ],
  recordedAt: ["recorded_at", "time", "timestamp", "date", "datetime", "day"],
  timezone: ["timezone", "time_zone", "tz", "zone", "offset"],
  activityType: ["type", "activity_type", "exercise_type", "sport", "activity"],
  name: ["name", "title", "activity_name", "label"],
  duration: [
    "duration",
    "duration_sec",
    "duration_seconds",
    "elapsed_time",
    "moving_time",
    "duration_min",
    "minutes",
  ],
  distance: ["distance", "distance_m", "distance_km", "distance_meters", "total_distance"],
  calories: ["calories", "kcal", "energy", "active_calories", "total_calories"],
  avgHr: ["avg_hr", "average_heart_rate", "avg_heart_rate", "heart_rate_avg", "average_hr"],
  maxHr: ["max_hr", "max_heart_rate", "maximum_heart_rate", "heart_rate_max"],
  steps: ["steps", "step_count", "total_steps"],
  notes: ["notes", "note", "description", "comment"],
  metricType: ["metric", "metric_type", "type", "record_type"],
  value: [
    "value",
    "amount",
    "quantity",
    "count",
    "weight",
    "weight_kg",
    "weight_lb",
    "bodyweight",
    "bodyweight_kg",
    "bodyweight_lb",
  ],
};

const norm = (header: string) =>
  header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

export function guessMapping(headers: string[], preferred?: ImportMapping): ImportMapping {
  const base: ImportMapping = preferred
    ? { ...preferred, fields: { ...preferred.fields } }
    : { ...DEFAULT_MAPPING, fields: {} };
  const normalized = headers.map((h) => ({ header: h, key: norm(h) }));

  const pick = (target: string) => {
    if (base.fields[target]) return;
    const options = ALIASES[target] ?? [];
    const exact = normalized.find((h) => options.includes(h.key));
    if (exact) base.fields[target] = exact.header;
  };

  for (const target of Object.keys(ALIASES)) pick(target);

  // Decide the record kind from what resolved.
  const looksLikeMetric =
    Boolean(base.fields["value"]) && !base.fields["duration"] && !base.fields["distance"];
  base.recordKind = looksLikeMetric ? "metric" : "activity";
  if (base.recordKind === "metric") {
    delete base.fields["startedAt"];
  } else {
    // Activity exports commonly call elapsed time simply `Time` while metric
    // exports use that same header as the recorded timestamp. Resolve the
    // ambiguous alias only after record-kind detection so metric `Time`
    // semantics remain intact.
    if (
      !base.fields["duration"] &&
      ["activityType", "distance", "calories", "avgHr", "maxHr", "steps"].some((target) =>
        Boolean(base.fields[target]),
      )
    ) {
      const time = normalized.find((header) => header.key === "time");
      if (time) base.fields["duration"] = time.header;
    }
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
  if (/(?:^|_)kg(?:$|_)|kilogram/.test(valueHeader)) base.weightUnit = "kg";
  else if (/(?:^|_)lb(?:$|_)|pound/.test(valueHeader)) base.weightUnit = "lb";

  // A plain `weight` column is enough to identify the metric, but not its
  // unit. In that case the pounds-first default above remains visible in the
  // mapping preview and the user can explicitly switch it before committing.
  if (!preferred && !base.fields["metricType"] && /(?:body)?weight/.test(valueHeader)) {
    base.fixedMetricType = "bodyweight_kg";
  }

  return base;
}

/** A mapping is complete enough to import when the essentials resolved. */
export function mappingIsUsable(mapping: ImportMapping): boolean {
  return mapping.recordKind === "activity"
    ? Boolean(mapping.fields["startedAt"])
    : Boolean(mapping.fields["recordedAt"] && mapping.fields["value"]);
}

/** Essential targets that match more than one source header require a human choice. */
export function ambiguousEssentialMappingFields(
  headers: readonly string[],
  mapping: ImportMapping,
): string[] {
  const essentialTargets =
    mapping.recordKind === "activity"
      ? (["startedAt"] as const)
      : (["recordedAt", "value"] as const);
  const normalized = headers.map((header) => ({ header, key: norm(header) }));

  return essentialTargets.filter((target) => {
    const aliases = ALIASES[target] ?? [];
    const matches = normalized.filter(({ key }) => aliases.includes(key));
    return matches.length > 1;
  });
}

export interface SavedImportMappingLike {
  fileFormat: string;
  recordKind: string;
  mapping: unknown;
}

const DURATION_UNITS = new Set<ImportMapping["durationUnit"]>(["seconds", "minutes", "hours"]);
const DISTANCE_UNITS = new Set<ImportMapping["distanceUnit"]>(["m", "km", "mi"]);
const WEIGHT_UNITS = new Set<ImportMapping["weightUnit"]>(["kg", "lb"]);
const METRIC_TYPE_SET = new Set<MetricType>(METRIC_TYPES);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/**
 * Converts persisted JSON into the narrow mapping contract used by the parser.
 *
 * Saved rows are untrusted account data: only known fields and enum values are
 * copied. Unknown future/legacy properties are ignored, and a malformed known
 * field rejects the whole mapping instead of partially applying it.
 */
export function parseSavedImportMapping(saved: SavedImportMappingLike): ImportMapping | null {
  if (!isRecord(saved.mapping)) return null;
  const value = saved.mapping;
  const recordKind = value["recordKind"];
  if (
    (recordKind !== "activity" && recordKind !== "metric") ||
    recordKind !== saved.recordKind ||
    !isRecord(value["fields"]) ||
    !DURATION_UNITS.has(value["durationUnit"] as ImportMapping["durationUnit"]) ||
    !DISTANCE_UNITS.has(value["distanceUnit"] as ImportMapping["distanceUnit"]) ||
    !WEIGHT_UNITS.has(value["weightUnit"] as ImportMapping["weightUnit"]) ||
    !METRIC_TYPE_SET.has(value["fixedMetricType"] as MetricType)
  ) {
    return null;
  }

  const sourceFields = value["fields"];
  const targets = recordKind === "activity" ? ACTIVITY_TARGETS : METRIC_TARGETS;
  const fields: Record<string, string> = {};
  for (const target of targets) {
    const raw = sourceFields[target];
    if (raw === undefined || raw === "") continue;
    if (typeof raw !== "string") return null;
    const header = raw.trim();
    if (!header || header.length > 256) return null;
    fields[target] = header;
  }

  const mapping: ImportMapping = {
    recordKind,
    fields,
    durationUnit: value["durationUnit"] as ImportMapping["durationUnit"],
    distanceUnit: value["distanceUnit"] as ImportMapping["distanceUnit"],
    weightUnit: value["weightUnit"] as ImportMapping["weightUnit"],
    fixedMetricType: value["fixedMetricType"] as MetricType,
  };
  return mappingIsUsable(mapping) ? mapping : null;
}

/**
 * Returns a saved mapping only when it is safe for this exact parsed table.
 * Header matching is deliberately exact: renamed/removed exporter columns must
 * send the athlete back through review rather than silently shifting fields.
 */
export function compatibleSavedImportMapping(
  saved: SavedImportMappingLike,
  headers: readonly string[],
  fileFormat: FileFormat,
): ImportMapping | null {
  if (saved.fileFormat !== fileFormat || (fileFormat !== "csv" && fileFormat !== "json")) {
    return null;
  }
  const mapping = parseSavedImportMapping(saved);
  if (!mapping) return null;
  const available = new Set(headers);
  return Object.values(mapping.fields).every((header) => available.has(header)) ? mapping : null;
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

function durationSeconds(
  raw: string | undefined,
  fallbackUnit: ImportMapping["durationUnit"],
  row: number,
  issues: ParseIssue[],
): number | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  if (!value.includes(":")) {
    const numeric = numberOf(value);
    return numeric == null ? null : Math.round(numeric * DURATION_FACTOR[fallbackUnit]);
  }

  const parts = value.split(":");
  const validShape =
    (parts.length === 2 || parts.length === 3) &&
    parts.every((part) => /^\d+(?:\.\d+)?$/.test(part.trim()));
  const numeric = parts.map((part) => Number(part.trim()));
  const seconds = numeric.at(-1);
  const minutes = numeric.at(-2);
  if (
    !validShape ||
    seconds == null ||
    minutes == null ||
    !Number.isFinite(seconds) ||
    !Number.isFinite(minutes) ||
    seconds >= 60 ||
    minutes < 0 ||
    (parts.length === 3 && minutes >= 60)
  ) {
    issues.push({
      severity: "warning",
      row,
      field: "duration",
      message: `Duration "${raw}" is not valid HH:MM:SS or MM:SS — duration was not imported.`,
    });
    return null;
  }

  const hours = parts.length === 3 ? numeric[0] : 0;
  const total = (hours ?? 0) * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? Math.round(total) : null;
}

const DISTANCE_UNIT_ALIASES: Record<string, keyof typeof DISTANCE_FACTOR> = {
  m: "m",
  meter: "m",
  meters: "m",
  metre: "m",
  metres: "m",
  km: "km",
  kms: "km",
  kilometer: "km",
  kilometers: "km",
  kilometre: "km",
  kilometres: "km",
  mi: "mi",
  mile: "mi",
  miles: "mi",
};

function distanceMeters(
  raw: string | undefined,
  fallbackUnit: ImportMapping["distanceUnit"],
  row: number,
  issues: ParseIssue[],
): number | null {
  if (!raw?.trim()) return null;
  const value = raw.trim();
  const suffix = value.match(/([a-zA-Z]+)\.?\s*$/);
  let unit = fallbackUnit;
  let numericText = value;
  if (suffix) {
    const supplied = suffix[1]!.toLowerCase();
    const resolved = DISTANCE_UNIT_ALIASES[supplied];
    if (!resolved) {
      issues.push({
        severity: "warning",
        row,
        field: "distance",
        message: `Distance "${raw}" uses the unknown unit "${suffix[1]}" — distance was not imported.`,
      });
      return null;
    }
    unit = resolved;
    numericText = value.slice(0, suffix.index).trim();
  }

  const numeric = numberOf(numericText);
  if (numeric == null) {
    issues.push({
      severity: "warning",
      row,
      field: "distance",
      message: `Distance "${raw}" is not a number — distance was not imported.`,
    });
    return null;
  }
  return Math.round(numeric * DISTANCE_FACTOR[unit]);
}

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
  const candidate = zoned
    ? value
    : offset
      ? `${value.replace(" ", "T")}${offset}`
      : `${value.replace(" ", "T")}Z`;
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
      const activity: NormalizedActivity = {
        kind: "activity",
        externalId: get(row, "externalId")?.trim() || null,
        activityType: (get(row, "activityType")?.trim() || "other").toLowerCase(),
        name: get(row, "name")?.trim() || null,
        startedAt: when.iso,
        sourceTimezone: when.zone,
        durationSec: durationSeconds(get(row, "duration"), mapping.durationUnit, rowNumber, issues),
        distanceM: distanceMeters(get(row, "distance"), mapping.distanceUnit, rowNumber, issues),
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
      issues.push({
        severity: "error",
        row: rowNumber,
        message: "Row skipped: value is not a number.",
      });
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
