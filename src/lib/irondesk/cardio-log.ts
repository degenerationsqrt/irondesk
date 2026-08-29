import { localDateTimeToInstant } from "./dates";
import type { Units } from "./units";

export const CARDIO_ACTIVITY_TYPES = [
  "Run",
  "Ride",
  "Walk / Hike",
  "Rower",
  "Elliptical",
  "Stair",
  "Swim",
  "HIIT",
  "Other",
] as const;

export type CardioActivityType = (typeof CARDIO_ACTIVITY_TYPES)[number];

export interface CardioLogDraft {
  activityType: CardioActivityType;
  customName?: string;
  localStartedAt: string;
  durationMin: number | null;
  distance: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  activeZoneMinutes: number | null;
  cardioLoad: number | null;
  notes?: string;
}

/** Canonical repository payload. Distance is always kilometers. */
export interface ManualCardioInput {
  name: string;
  startedAt: string;
  durationMin: number;
  distanceKm: number | null;
  calories: number | null;
  avgHr: number | null;
  maxHr: number | null;
  activeZoneMinutes: number | null;
  cardioLoad: number | null;
  notes: string | null;
}

const KM_PER_MILE = 1.609344;

export const cardioDistanceUnit = (units: Units): "mi" | "km" =>
  units === "imperial" ? "mi" : "km";

export function cardioDistanceToKm(distance: number, units: Units): number {
  return units === "imperial" ? distance * KM_PER_MILE : distance;
}

export function cardioDistanceFromKm(distanceKm: number, units: Units): number {
  return units === "imperial" ? distanceKm / KM_PER_MILE : distanceKm;
}

export class CardioLogValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CardioLogValidationError";
  }
}

function optionalFinite(value: number | null, label: string): number | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) throw new CardioLogValidationError(`${label} must be a number.`);
  return value;
}

function nonNegative(value: number | null, label: string): number | null {
  const finite = optionalFinite(value, label);
  if (finite != null && finite < 0)
    throw new CardioLogValidationError(`${label} cannot be negative.`);
  return finite;
}

/** Validates UI values and converts them to the canonical cardio row payload. */
export function normalizeCardioLog(
  draft: CardioLogDraft,
  units: Units,
  timeZone?: string | null,
): ManualCardioInput {
  const customName = draft.customName?.trim() ?? "";
  const name = draft.activityType === "Other" ? customName : draft.activityType;
  if (!name) throw new CardioLogValidationError("Enter an activity name.");
  if (name.length > 80)
    throw new CardioLogValidationError("Activity name must be 80 characters or fewer.");

  const startedAt = localDateTimeToInstant(draft.localStartedAt, timeZone);
  if (!startedAt)
    throw new CardioLogValidationError(
      "Choose a valid date and time in your profile timezone. That local time may not exist because of daylight saving time.",
    );

  const durationMin = optionalFinite(draft.durationMin, "Duration");
  if (
    durationMin == null ||
    !Number.isInteger(durationMin) ||
    durationMin < 1 ||
    durationMin > 1_440
  )
    throw new CardioLogValidationError("Duration must be a whole number from 1 to 1,440 minutes.");

  const distance = nonNegative(draft.distance, "Distance");
  const distanceKm =
    distance == null ? null : Math.round(cardioDistanceToKm(distance, units) * 100) / 100;
  if (distanceKm != null && distanceKm > 9_999.99)
    throw new CardioLogValidationError(
      "Distance is too large to save (maximum 9,999.99 canonical kilometers).",
    );

  const calories = nonNegative(draft.calories, "Calories");
  if (calories != null && (!Number.isInteger(calories) || calories > 100_000))
    throw new CardioLogValidationError("Calories must be a whole number from 0 to 100,000.");

  const avgHr = optionalFinite(draft.avgHr, "Average heart rate");
  const maxHr = optionalFinite(draft.maxHr, "Maximum heart rate");
  for (const [label, value] of [
    ["Average heart rate", avgHr],
    ["Maximum heart rate", maxHr],
  ] as const) {
    if (value != null && (!Number.isInteger(value) || value < 30 || value > 250))
      throw new CardioLogValidationError(`${label} must be a whole number from 30 to 250 bpm.`);
  }
  if (avgHr != null && maxHr != null && maxHr < avgHr)
    throw new CardioLogValidationError(
      "Maximum heart rate cannot be lower than average heart rate.",
    );

  const activeZoneMinutes = nonNegative(draft.activeZoneMinutes, "Active-zone minutes");
  if (
    activeZoneMinutes != null &&
    (!Number.isInteger(activeZoneMinutes) || activeZoneMinutes > durationMin)
  )
    throw new CardioLogValidationError(
      "Active-zone minutes must be a whole number no greater than the workout duration.",
    );

  const cardioLoad = nonNegative(draft.cardioLoad, "Measured cardio load");
  if (cardioLoad != null && (!Number.isInteger(cardioLoad) || cardioLoad > 100_000))
    throw new CardioLogValidationError(
      "Measured cardio load must be a whole number from 0 to 100,000.",
    );

  const notes = draft.notes?.trim() || null;
  if (notes && notes.length > 2_000)
    throw new CardioLogValidationError("Notes must be 2,000 characters or fewer.");

  return {
    name,
    startedAt,
    durationMin,
    distanceKm,
    calories,
    avgHr,
    maxHr,
    activeZoneMinutes,
    cardioLoad,
    notes,
  };
}
