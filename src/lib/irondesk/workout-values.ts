/**
 * Canonical workout-set value limits shared by editors, repositories, queues,
 * and device payload adapters. Values are persisted in kilograms.
 */
export const WORKOUT_SET_LIMITS = {
  rpe: { min: 1, max: 10, step: 0.5 },
  reps: { min: 0, max: 500, step: 1 },
  restSeconds: { min: 0, max: 3_600, step: 1 },
  weightKg: { min: 0, max: 1_000 },
} as const;

export type WorkoutValueField = "rpe" | "reps" | "restSeconds" | "weightKg";

export interface WorkoutValueIssue {
  field: WorkoutValueField;
  value: unknown;
  message: string;
}

export type WorkoutValueResult<T> = { ok: true; value: T } | ({ ok: false } & WorkoutValueIssue);

export interface WorkoutSetValueInput {
  weightKg?: unknown;
  reps?: unknown;
  rpe?: unknown;
  restSeconds?: unknown;
}

const messages: Record<WorkoutValueField, string> = {
  rpe: "RPE must be blank or a number from 1 to 10 in 0.5 increments.",
  reps: "Reps must be a whole number from 0 to 500.",
  restSeconds: "Rest must be blank or a whole number from 0 to 3,600 seconds.",
  weightKg: "Weight must be a finite, nonnegative value no greater than 1,000 kg after conversion.",
};

export function workoutValueMessage(field: WorkoutValueField): string {
  return messages[field];
}

const valid = <T>(value: T): WorkoutValueResult<T> => ({ ok: true, value });
const issue = (field: WorkoutValueField, value: unknown): WorkoutValueIssue => ({
  field,
  value,
  message: workoutValueMessage(field),
});
const invalid = <T>(field: WorkoutValueField, value: unknown): WorkoutValueResult<T> => ({
  ok: false,
  ...issue(field, value),
});

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isStep(value: number, step: number): boolean {
  const units = value / step;
  return Math.abs(units - Math.round(units)) <= Number.EPSILON * Math.max(1, Math.abs(units)) * 4;
}

/** A recorded RPE is optional; any entered value must use the 1-10 half-step scale. */
export function isValidRpe(value: unknown): value is number | null {
  if (value === null) return true;
  const { min, max, step } = WORKOUT_SET_LIMITS.rpe;
  return isFiniteNumber(value) && value >= min && value <= max && isStep(value, step);
}

/** Narrows to a real entered RPE, excluding the valid null/blank state. */
export function isValidEnteredRpe(value: unknown): value is number {
  return value !== null && isValidRpe(value);
}

export function isValidReps(value: unknown): value is number {
  const { min, max } = WORKOUT_SET_LIMITS.reps;
  return isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max;
}

export function isValidRestSeconds(value: unknown): value is number | null {
  if (value === null) return true;
  const { min, max } = WORKOUT_SET_LIMITS.restSeconds;
  return isFiniteNumber(value) && Number.isInteger(value) && value >= min && value <= max;
}

export function isValidWeightKg(value: unknown): value is number {
  const { min, max } = WORKOUT_SET_LIMITS.weightKg;
  return isFiniteNumber(value) && value >= min && value <= max;
}

/**
 * Parses only ordinary decimal input. This deliberately rejects JavaScript
 * conveniences such as `Infinity`, hexadecimal, and a numeric prefix followed
 * by junk, all of which `Number(...)` can otherwise accept or partially hide.
 */
function parseDecimalDraft(draft: string): number | null {
  const text = draft.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function parseRpeDraft(draft: string): WorkoutValueResult<number | null> {
  if (draft.trim() === "") return valid(null);
  const value = parseDecimalDraft(draft);
  return value !== null && isValidEnteredRpe(value) ? valid(value) : invalid("rpe", draft);
}

export function parseRepsDraft(draft: string): WorkoutValueResult<number> {
  const value = parseDecimalDraft(draft);
  return value !== null && isValidReps(value) ? valid(value) : invalid("reps", draft);
}

export function parseRestSecondsDraft(draft: string): WorkoutValueResult<number | null> {
  if (draft.trim() === "") return valid(null);
  const value = parseDecimalDraft(draft);
  return value !== null && isValidRestSeconds(value) ? valid(value) : invalid("restSeconds", draft);
}

/**
 * Parses a displayed weight and validates the converted canonical kilogram
 * value, so a pounds entry cannot overflow the database after conversion.
 */
export function parseWeightDraft(
  draft: string,
  toKilograms: (value: number) => number = (value) => value,
): WorkoutValueResult<number> {
  const displayValue = parseDecimalDraft(draft);
  if (displayValue === null || displayValue < 0) return invalid("weightKg", draft);
  const weightKg = toKilograms(displayValue);
  return isValidWeightKg(weightKg) ? valid(weightKg) : invalid("weightKg", weightKg);
}

/** Finds the first invalid field in a mutation or hydrated set value. */
export function firstWorkoutSetValueIssue(values: WorkoutSetValueInput): WorkoutValueIssue | null {
  if (
    values.weightKg !== undefined &&
    values.weightKg !== null &&
    !isValidWeightKg(values.weightKg)
  ) {
    return issue("weightKg", values.weightKg);
  }
  if (values.reps !== undefined && values.reps !== null && !isValidReps(values.reps)) {
    return issue("reps", values.reps);
  }
  if (values.rpe !== undefined && !isValidRpe(values.rpe)) {
    return issue("rpe", values.rpe);
  }
  if (values.restSeconds !== undefined && !isValidRestSeconds(values.restSeconds)) {
    return issue("restSeconds", values.restSeconds);
  }
  return null;
}

/** Returns null when no valid, non-null RPE is available. */
export function averageValidRpe(values: Iterable<unknown>): number | null {
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (!isValidEnteredRpe(value)) continue;
    sum += value;
    count += 1;
  }
  return count === 0 ? null : sum / count;
}

/** Calculates effort from completed sets only, ignoring blank or invalid RPEs. */
export function averageCompletedRpe(
  sets: Iterable<{ done: boolean; rpe: number | null }>,
): number | null {
  return averageValidRpe(Array.from(sets, (set) => (set.done ? set.rpe : null)));
}
