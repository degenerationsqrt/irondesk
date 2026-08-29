/**
 * Adapters that turn each mode's stored history into the pure progression
 * module's `PerformancePoint` shape.
 *
 * Demo mode reads the deterministic mock exercise history (parsed from its own
 * detail strings) so previews produce real suggestions without touching an
 * account. Live mode is fed by the Supabase repository.
 */
import type { Exercise } from "./types";
import { performanceKey, type PerformanceMap, type PerformancePoint } from "./progression";
import { toKg } from "./units";

export interface ProgressionContext {
  performance: PerformanceMap;
  /** Today's readiness score, when the athlete checked in. */
  readiness: number | null;
}

/**
 * Parses a demo history line such as `5×3 @ 150 kg · RPE 8` — or
 * `3×9 @ 32 kg`, `3×7 @ +25 kg` — into a performance point. Returns null when
 * the line carries no load (e.g. bodyweight-only detail).
 */
export function parseDemoHistoryDetail(date: string, detail: string): PerformancePoint | null {
  const shape = detail.match(/(\d+)\s*[x×]\s*(\d+)/i);
  const load = detail.match(
    /@\s*\+?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(kg|lb|lbs|pounds?)\b/i,
  );
  if (!shape || !load) return null;
  const rpe = detail.match(/RPE\s*(\d+(?:\.\d+)?)/i);
  const loadValue = Number(load[1]!.replace(/,/g, ""));
  const loadUnit = load[2]!.toLowerCase();
  const weightKg = loadUnit === "kg" ? loadValue : toKg(loadValue, "imperial");
  return {
    date,
    sets: Number(shape[1]),
    reps: Number(shape[2]),
    weightKg,
    rpe: rpe ? Number(rpe[1]) : null,
  };
}

/** Builds the demo performance map, keyed by exercise id and normalized name. */
export function demoProgressionContext(
  exercises: Exercise[],
  readiness: number | null,
): ProgressionContext {
  const performance: PerformanceMap = {};
  for (const exercise of exercises) {
    const points = exercise.history
      .map((entry) => parseDemoHistoryDetail(entry.date, entry.detail))
      .filter((p): p is PerformancePoint => p !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!points.length) continue;
    performance[exercise.id] = points;
    performance[performanceKey(exercise.name)] = points;
  }
  return { performance, readiness };
}
