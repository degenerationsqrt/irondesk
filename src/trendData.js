import { epley } from "./trainingMath.js";

const METERS_PER_MILE = 1609.344;

function finite(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function text(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeCardioType(value) {
  const activity = text(value);
  if (/run|jog|treadmill/.test(activity)) return "run";
  if (/bike|bik|cycl|ride|spin/.test(activity)) return "ride";
  if (/walk|hik|elliptical|row|swim|stair|cardio|aerobic/.test(activity)) return "other";
  if (activity === "steps" || activity === "step") return "steps";
  return activity || "other";
}

export function isGarminCardioSession(session) {
  if (session?.source !== "garmin") return false;
  const hasStrengthSets = (Array.isArray(session?.entries) ? session.entries : [])
    .some(entry => Array.isArray(entry?.sets) && entry.sets.length > 0);
  if (hasStrengthSets || Number(session?.volume) > 0) return false;
  const activity = text(`${session?.garmin?.activityType || ""} ${session?.dayId || ""}`);
  if (/strength|weight\s*training|resistance|bodybuilding|lifting/.test(activity)) return false;
  return Boolean(
    Number(session?.durationMin) > 0
    || Number(session?.garmin?.durationSeconds) > 0
    || Number(session?.garmin?.distanceMeters) > 0
  );
}

export function weekStartKey(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), 12);
  if (Number.isNaN(date.getTime())) return "";
  date.setDate(date.getDate() - date.getDay());
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function garminSessionsToCardioRecords(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter(isGarminCardioSession)
    .map((session) => {
      const activityType = session?.garmin?.activityType || session?.dayId || "Garmin activity";
      const distanceMeters = finite(session?.garmin?.distanceMeters);
      return {
        id: `garmin-trend:${session?.sourceKey || session?.id}`,
        date: String(session?.date || ""),
        type: normalizeCardioType(activityType),
        label: activityType,
        minutes: Math.max(0, finite(session?.durationMin) || 0),
        miles: distanceMeters == null ? 0 : Math.round((distanceMeters / METERS_PER_MILE) * 100) / 100,
        calories: finite(session?.garmin?.calories),
        avgHeartRate: finite(session?.garmin?.avgHeartRate),
        maxHeartRate: finite(session?.garmin?.maxHeartRate),
        vo2Max: finite(session?.garmin?.vo2Max),
        source: "garmin",
        sourceSessionId: session?.id || null,
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date));
}

export function mergeCardioTrendRecords(manualRecords, sessions) {
  const records = [];
  for (const record of Array.isArray(manualRecords) ? manualRecords : []) {
    records.push({
      ...record,
      type: normalizeCardioType(record?.type),
      source: record?.source || "manual",
    });
  }
  records.push(...garminSessionsToCardioRecords(sessions));
  return records.sort((left, right) =>
    String(right?.date || "").localeCompare(String(left?.date || "")));
}

export const HEALTH_TREND_METRICS = Object.freeze([
  { key: "steps", label: "Steps", suffix: "", color: "#f5b942" },
  { key: "restingHeartRate", label: "Resting HR", suffix: " bpm", color: "#ef4444" },
  { key: "averageHeartRate", label: "Average HR", suffix: " bpm", color: "#fb7185" },
  { key: "sleepMinutes", label: "Sleep", suffix: " min", color: "#60a5fa" },
  { key: "exerciseMinutes", label: "Exercise", suffix: " min", color: "#4ade80" },
  { key: "calories", label: "Calories", suffix: " kcal", color: "#f97316" },
  { key: "vo2Max", label: "VO₂ Max", suffix: " ml/kg/min", color: "#a78bfa" },
]);

export function healthTrendSeries(healthLog, metricKey) {
  return (Array.isArray(healthLog) ? healthLog : [])
    .map((record) => ({
      date: String(record?.date || ""),
      value: finite(record?.[metricKey]),
      source: record?.source || "health-connect",
    }))
    .filter((record) => record.date && record.value != null)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function latestHealthValue(healthLog, metricKey) {
  const series = healthTrendSeries(healthLog, metricKey);
  return series.length ? series[series.length - 1] : null;
}

export function strengthE1rmTrend(sessions, liftKey, liftName) {
  const points = [];
  const history = Array.isArray(sessions) ? sessions : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const session = history[index];
    for (const entry of Array.isArray(session?.entries) ? session.entries : []) {
      if (entry?.lift !== liftKey && entry?.ex !== liftName) continue;
      const estimates = (Array.isArray(entry?.sets) ? entry.sets : [])
        .map(set => epley(set.w, set.r))
        .filter(Number.isFinite);
      if (!estimates.length) continue;
      points.push({
        date: session.date,
        e1rm: Math.round(Math.max(...estimates)),
      });
    }
  }
  return points;
}
