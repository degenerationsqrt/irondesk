const GOAL_KEYS = new Set(["vtaper", "glutes", "tone", "strength", "recomp"]);

const LEGACY_GOALS = Object.freeze({
  muscle: "vtaper",
  hypertrophy: "vtaper",
  build: "vtaper",
  lean: "recomp",
  fatloss: "recomp",
  "fat-loss": "recomp",
  weightloss: "recomp",
  "weight-loss": "recomp",
});

function positiveInteger(value, fallback) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function normalizeGender(value) {
  const key = String(value || "").trim().toLowerCase();
  if (key === "women" || key === "woman" || key === "female") return "women";
  return "men";
}

export function normalizeGoal(value, gender = "men") {
  const key = String(value || "").trim().toLowerCase();
  if (GOAL_KEYS.has(key)) return key;
  if (LEGACY_GOALS[key]) return LEGACY_GOALS[key];
  return normalizeGender(gender) === "women" ? "glutes" : "vtaper";
}

export function normalizeWorkoutProgress(value) {
  const source = value && typeof value === "object" ? value : {};
  const rawDayIndex = Math.trunc(Number(source.dayIndex));
  return {
    ...source,
    blockNum: positiveInteger(source.blockNum ?? source.block, 1),
    week: Math.min(6, positiveInteger(source.week, 1)),
    dayIndex: Number.isFinite(rawDayIndex) && rawDayIndex >= 0 ? rawDayIndex : 0,
    updatedAt: Math.max(0, Number(source.updatedAt) || 0),
  };
}
