/**
 * Garmin FIT decoding via the official Garmin FIT JavaScript SDK
 * (`@garmin/fitsdk`). No hand-rolled binary parsing, and no renaming of other
 * formats to `.fit`.
 */
import { Decoder, Stream } from "@garmin/fitsdk";

import type { NormalizedActivity, NormalizedMetric, ParseIssue } from "./types";

export class FitError extends Error {}

interface FitSession {
  sport?: string;
  sub_sport?: string;
  start_time?: Date | string;
  total_elapsed_time?: number;
  total_timer_time?: number;
  total_distance?: number;
  total_calories?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  total_ascent?: number;
  total_steps?: number;
  timestamp?: Date | string;
}

const iso = (value: unknown): string | null => {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
};

const round = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;

export interface FitParseOutput {
  records: (NormalizedActivity | NormalizedMetric)[];
  issues: ParseIssue[];
  skippedFields: string[];
  notes: string[];
}

export function parseFit(bytes: Uint8Array): FitParseOutput {
  const stream = Stream.fromByteArray(Array.from(bytes));
  if (!Decoder.isFIT(stream)) throw new FitError("This file is not a FIT file (header check failed).");

  const decoder = new Decoder(stream);
  if (!decoder.checkIntegrity()) {
    throw new FitError("FIT integrity check failed — the file is truncated or corrupt.");
  }

  const { messages, errors } = decoder.read({
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
  }) as unknown as {
    messages: Record<string, unknown[]>;
    errors: Error[];
  };

  const issues: ParseIssue[] = errors.map((error) => ({
    severity: "warning" as const,
    message: `FIT decoder: ${error.message}`,
  }));

  const sessions = (messages["sessionMesgs"] ?? []) as FitSession[];
  const records: (NormalizedActivity | NormalizedMetric)[] = [];

  for (const [index, session] of sessions.entries()) {
    const startedAt = iso(session.start_time) ?? iso(session.timestamp);
    if (!startedAt) {
      issues.push({ severity: "error", message: `FIT session ${index + 1} skipped: no usable start time.` });
      continue;
    }
    records.push({
      kind: "activity",
      externalId: `fit:${startedAt}`,
      activityType: String(session.sport ?? "other").toLowerCase(),
      name: session.sub_sport ? String(session.sub_sport) : null,
      startedAt,
      sourceTimezone: null,
      durationSec: round(session.total_timer_time ?? session.total_elapsed_time),
      distanceM: round(session.total_distance),
      calories: round(session.total_calories),
      avgHr: round(session.avg_heart_rate),
      maxHr: round(session.max_heart_rate),
      elevationGainM: round(session.total_ascent),
      steps: round(session.total_steps),
      notes: null,
      raw: { format: "fit", sport: session.sport ?? null, subSport: session.sub_sport ?? null },
    });
  }

  const weights = (messages["weightScaleMesgs"] ?? []) as { timestamp?: Date; weight?: number }[];
  for (const entry of weights) {
    const recordedAt = iso(entry.timestamp);
    if (!recordedAt || typeof entry.weight !== "number") continue;
    records.push({
      kind: "metric",
      externalId: `fit:weight:${recordedAt}`,
      metricType: "bodyweight_kg",
      recordedAt,
      sourceTimezone: null,
      value: Math.round(entry.weight * 100) / 100,
      unit: "kg",
      notes: null,
      raw: { format: "fit" },
    });
  }

  if (!records.length) {
    throw new FitError("The FIT file decoded but contained no session or weight messages IronDesk can store.");
  }

  return {
    records,
    issues,
    skippedFields: [
      "record messages (per-second GPS/HR/cadence samples)",
      "lap and length messages",
      "device, event and developer-field messages",
    ],
    notes: ["Decoded with the official Garmin FIT SDK; IronDesk stores session-level summaries."],
  };
}
