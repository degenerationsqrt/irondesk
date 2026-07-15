export const MIN_E1RM_REPS = 1;
export const MAX_E1RM_REPS = 8;

export function epley(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  return r <= 1 ? w : w * (1 + r / 30);
}

export function weightForReps(estimatedMax, reps) {
  return Number(estimatedMax) / (1 + Number(reps) / 30);
}

export function isValidE1RMSet(weight, reps) {
  const w = Number(weight);
  const r = Number(reps);
  return Number.isFinite(w) && w > 0 && Number.isInteger(r) && r >= MIN_E1RM_REPS && r <= MAX_E1RM_REPS;
}

export function estimatedMaxForSet(weight, reps) {
  return isValidE1RMSet(weight, reps) ? epley(weight, reps) : null;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function setVolume(set, isDumbbell = false) {
  const weight = Number(set?.w);
  const reps = Number(set?.r);
  if (!Number.isFinite(weight) || !Number.isFinite(reps) || weight < 0 || reps <= 0) return 0;
  return weight * reps * (isDumbbell ? 2 : 1);
}

export function workoutVolume(entries) {
  return entries.reduce(
    (total, entry) => total + entry.sets.reduce((entryTotal, set) => entryTotal + setVolume(set, entry.db), 0),
    0,
  );
}
