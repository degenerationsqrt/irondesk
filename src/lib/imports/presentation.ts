import { formatWeight, type Units } from "@/lib/irondesk/units";

import type { NormalizedRecord } from "./types";

const METERS_PER_MILE = 1609.344;

export function importRecordTypeLabel(record: NormalizedRecord): string {
  if (record.kind === "activity") return record.activityType;
  if (record.metricType === "bodyweight_kg") return "Bodyweight";
  return record.metricType.replace(/_/g, " ");
}

/** Formats canonical import values in the athlete's chosen display units. */
export function importRecordValueLabel(record: NormalizedRecord, units: Units): string {
  if (record.kind === "metric") {
    return record.metricType === "bodyweight_kg"
      ? formatWeight(record.value, units)
      : `${record.value} ${record.unit}`;
  }

  const details = [
    record.durationSec ? `${Math.round(record.durationSec / 60)} min` : null,
    record.distanceM
      ? units === "imperial"
        ? `${(record.distanceM / METERS_PER_MILE).toFixed(2)} mi`
        : `${(record.distanceM / 1000).toFixed(2)} km`
      : null,
    record.calories ? `${record.calories} kcal` : null,
  ].filter((detail): detail is string => Boolean(detail));

  return details.join(" · ") || "—";
}
