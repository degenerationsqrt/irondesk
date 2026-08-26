/** Unit helpers. Canonical storage is ALWAYS kilograms; display converts. */

export type Units = "metric" | "imperial";

const LB_PER_KG = 2.2046226218;

export const weightUnit = (units: Units) => (units === "imperial" ? "lb" : "kg");
export const lengthUnit = (units: Units) => (units === "imperial" ? "in" : "cm");

/** kg -> display value in the user's preferred unit. */
export function fromKg(kg: number, units: Units): number {
  const value = units === "imperial" ? kg * LB_PER_KG : kg;
  return Math.round(value * 10) / 10;
}

/** display value -> canonical kg for persistence. */
export function toKg(value: number, units: Units): number {
  const kg = units === "imperial" ? value / LB_PER_KG : value;
  return Math.round(kg * 100) / 100;
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
    sourceUnit === "lb" ? Math.round(Number(n) / LB_PER_KG) : Math.round(Number(n) * LB_PER_KG),
  );
  let i = 0;
  const text = guidance.replace(/\d+(?:\.\d+)?/g, () => String(converted[i++]));
  return { text: `${text} ${suffix}`, source: `${guidance} ${sourceUnit}` };
}

const units2unit = (units: Units): "kg" | "lb" => (units === "imperial" ? "lb" : "kg");
