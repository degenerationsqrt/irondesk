/** Unit helpers. Canonical storage is ALWAYS kilograms; display converts. */

export type Units = "metric" | "imperial";

export const DEFAULT_UNITS: Units = "imperial";
export const LB_PER_KG = 2.2046226218;
export const KG_PER_LB = 1 / LB_PER_KG;

/** Resolves persisted/untrusted preference data without losing an explicit metric choice. */
export function resolveUnits(value: unknown, fallback: Units = DEFAULT_UNITS): Units {
  return value === "metric" || value === "imperial" ? value : fallback;
}

export const weightUnit = (units: Units) => (units === "imperial" ? "lb" : "kg");
export const lengthUnit = (units: Units) => (units === "imperial" ? "in" : "cm");

/** Exact conversion helpers. Formatting/persistence callers decide where to round. */
export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb * KG_PER_LB;

/** kg -> display value in the user's preferred unit. */
export function fromKg(kg: number, units: Units): number {
  const value = units === "imperial" ? kgToLb(kg) : kg;
  return Math.round(value * 10) / 10;
}

/** display value -> canonical kg for persistence. */
export function toKg(value: number, units: Units): number {
  const kg = units === "imperial" ? lbToKg(value) : value;
  return Math.round(kg * 100) / 100;
}

/** Plate-friendly empty-set default in the athlete's display system, persisted canonically. */
export function defaultSetWeightKg(units: Units): number {
  return toKg(units === "imperial" ? 45 : 20, units);
}

export function fromCm(cm: number, units: Units): number {
  return units === "imperial" ? Math.round((cm / 2.54) * 10) / 10 : cm;
}

export function toCm(value: number, units: Units): number {
  return units === "imperial" ? Math.round(value * 2.54 * 10) / 10 : value;
}

/** Formats a canonical kg value for display, e.g. "102.5 kg" / "226 lb". */
export function formatWeight(kg: number | null | undefined, units: Units, digits = 1): string {
  if (kg == null) return "—";
  const v = fromKg(kg, units);
  return `${digits === 0 ? Math.round(v) : Number(v.toFixed(digits))} ${weightUnit(units)}`;
}

export function formatWeightedSet(weightKg: number, reps: number, units: Units): string {
  return `${formatWeight(weightKg, units)} × ${reps}`;
}

const CANONICAL_KG_TEXT = new RegExp(
  String.raw`((?:[+-]\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:\s*(–|—|-|to)\s*((?:[+-]\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?))?\s*kg\b`,
  "gi",
);

function formattedPounds(source: string): string {
  const compact = source.replace(/\s/g, "");
  const value = Number(compact.replace(/,/g, ""));
  if (!Number.isFinite(value)) return source;
  const rounded = Math.round(kgToLb(value) * 10) / 10;
  const sign = compact.startsWith("+") && rounded >= 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}`;
}

/**
 * Converts canonical kilogram snippets embedded in existing prose to pounds.
 *
 * Examples: `+25 kg`, `150 kg`, `14,820 kg`, and `100–110 kg`. Metric text is
 * returned byte-for-byte unchanged. Unit-free text and physiological notation
 * such as `ml/kg/min` are also left alone.
 */
export function formatWeightText(text: string, units: Units): string {
  if (units === "metric" || !text) return text;
  return text.replace(
    CANONICAL_KG_TEXT,
    (_match, first: string, separator?: string, second?: string) => {
      const left = formattedPounds(first);
      if (!second) return `${left} lb`;
      const joiner = separator?.toLowerCase() === "to" ? " to " : (separator ?? "–");
      return `${left}${joiner}${formattedPounds(second)} lb`;
    },
  );
}

/** Epley estimated 1RM from a completed set. Canonical kg in, kg out. */
export function estimate1rm(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}

/**
 * Formats legacy template load guidance for display.
 *
 * Legacy numeric guidance is POUNDS ("315–345"). For imperial users the source
 * text is shown verbatim with an `lb` suffix. For metric users any parseable
 * number or range is converted to kilograms, and the original source text is
 * still returned so nothing is lost.
 */
export function formatLoadGuidance(
  guidance: string | null | undefined,
  sourceUnit: "kg" | "lb" | null | undefined,
  units: Units,
): { text: string; source?: string } | null {
  if (!guidance) return null;
  const numbers = guidance.match(/\d+(?:\.\d+)?/g);
  // Descriptive guidance ("heavy", "bodyweight") is unit-free — pass through.
  if (!sourceUnit || !numbers?.length) return { text: guidance };

  const suffix = weightUnit(units);
  if (sourceUnit === units2unit(units)) return { text: `${guidance} ${suffix}` };

  const converted = numbers.map((n) =>
    sourceUnit === "lb" ? Math.round(lbToKg(Number(n))) : Math.round(kgToLb(Number(n))),
  );
  let i = 0;
  const text = guidance.replace(/\d+(?:\.\d+)?/g, () => String(converted[i++]));
  return { text: `${text} ${suffix}`, source: `${guidance} ${sourceUnit}` };
}

const units2unit = (units: Units): "kg" | "lb" => (units === "imperial" ? "lb" : "kg");
