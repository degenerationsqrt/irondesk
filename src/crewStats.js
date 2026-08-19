import { estimatedMaxForSet, localDateKey } from "./trainingMath.js";
import { safeSessionVolume } from "./workoutUtilities.js";

const TRACKED_LIFTS = ["bench", "squat", "ohp", "deadlift"];

export function computeCrewStats(sessions, maxes = {}, now = Date.now()) {
  const best = {
    bench: 0,
    squat: 0,
    ohp: 0,
    deadlift: 0,
  };
  const cutoff = localDateKey(new Date(Number(now) - 7 * 864e5));
  let weekVolume = 0;
  let weekSessions = 0;

  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (session?.source === "garmin") continue;
    for (const entry of Array.isArray(session?.entries) ? session.entries : []) {
      if (!entry?.lift || !Object.prototype.hasOwnProperty.call(best, entry.lift)) continue;
      for (const set of Array.isArray(entry?.sets) ? entry.sets : []) {
        const estimate = estimatedMaxForSet(set.w, set.r);
        if (estimate == null) continue;
        best[entry.lift] = Math.max(best[entry.lift], Math.round(estimate));
      }
    }
    if (String(session?.date || "") >= cutoff) {
      weekSessions += 1;
      weekVolume += safeSessionVolume(session);
    }
  }

  TRACKED_LIFTS.forEach((lift) => {
    if (!best[lift]) best[lift] = Number(maxes?.[lift]) || 0;
  });
  return {
    ...best,
    weekVolume,
    weekSessions,
  };
}
