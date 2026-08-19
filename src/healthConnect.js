import {
  Capacitor,
  WebPlugin,
  registerPlugin,
} from "@capacitor/core";

export const HEALTH_CONNECT_AUTO_SYNC_KEY = "irondesk:health-connect-auto-sync:v1";
export const HEALTH_CONNECT_LAST_SYNC_KEY = "irondesk:health-connect-last-sync:v1";
export const HEALTH_CONNECT_WRITE_ENABLED_KEY = "irondesk:health-connect-write-enabled:v1";
export const HEALTH_CONNECT_DAYS = 7;
export const HEALTH_CONNECT_METRIC_KEYS = Object.freeze([
  "steps",
  "averageHeartRate",
  "minimumHeartRate",
  "maximumHeartRate",
  "restingHeartRate",
  "sleepMinutes",
  "exerciseMinutes",
  "calories",
  "weightLb",
  "bodyFat",
  "vo2Max",
]);

class HealthConnectWeb extends WebPlugin {
  async getStatus() {
    return {
      available: false,
      platform: "web",
      minimumAndroidVersion: 14,
      androidSdk: null,
      permissions: {},
      missingPermissions: [],
      grantedCount: 0,
      permissionCount: 10,
      readGrantedCount: 0,
      readPermissionCount: 9,
      writeExerciseGranted: false,
      allGranted: false,
      allReadGranted: false,
      reason: "android-app-required",
    };
  }

  async requestPermissions() {
    throw new Error("Open the IronDesk Android app to connect Health Connect.");
  }

  async readDailySummary() {
    throw new Error("Health Connect data can only be read by the IronDesk Android app.");
  }

  async writeExerciseSession() {
    throw new Error("Completed workouts can only be written by the IronDesk Android app.");
  }

  async openSettings() {
    throw new Error("Health Connect settings are available on Android.");
  }
}

export const HealthConnect = registerPlugin("HealthConnect", {
  web: () => Promise.resolve(new HealthConnectWeb()),
});

export function isNativeHealthConnect() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundedOrNull(value, digits = 0) {
  const number = finiteOrNull(value);
  if (number == null) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

export function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function recentHealthDateRange(days = HEALTH_CONNECT_DAYS, now = new Date()) {
  const safeDays = Math.min(31, Math.max(1, Math.trunc(Number(days)) || HEALTH_CONNECT_DAYS));
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - safeDays + 1);
  return {
    startDate: localDateString(start),
    endDate: localDateString(end),
  };
}

export function normalizeHealthSummary(summary, syncedAt = new Date().toISOString()) {
  const date = String(summary?.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const sourcePackages = Array.isArray(summary?.sourcePackages)
    ? [...new Set(summary.sourcePackages.map(String).filter(Boolean))].sort()
    : [];
  return {
    id: `health-connect:${date}`,
    date,
    source: "health-connect",
    sourcePackages,
    steps: roundedOrNull(summary.steps),
    averageHeartRate: roundedOrNull(summary.averageHeartRate),
    minimumHeartRate: roundedOrNull(summary.minimumHeartRate),
    maximumHeartRate: roundedOrNull(summary.maximumHeartRate),
    restingHeartRate: roundedOrNull(summary.restingHeartRate),
    sleepMinutes: roundedOrNull(summary.sleepMinutes),
    exerciseMinutes: roundedOrNull(summary.exerciseMinutes),
    calories: roundedOrNull(summary.calories),
    weightLb: roundedOrNull(summary.weightLb, 1),
    bodyFat: roundedOrNull(summary.bodyFat, 1),
    vo2Max: roundedOrNull(summary.vo2Max, 1),
    importedAt: syncedAt,
  };
}

function timestampMilliseconds(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function mergeHealthSummaries(current, incoming, syncedAt) {
  const merged = new Map();
  for (const record of Array.isArray(current) ? current : []) {
    const normalized = normalizeHealthSummary(record, record?.importedAt || syncedAt);
    if (normalized) merged.set(normalized.id, normalized);
  }
  for (const record of Array.isArray(incoming) ? incoming : []) {
    const normalized = normalizeHealthSummary(record, syncedAt);
    if (!normalized) continue;
    const previous = merged.get(normalized.id);
    if (!previous) {
      merged.set(normalized.id, normalized);
      continue;
    }
    const next = {
      ...previous,
      ...normalized,
      sourcePackages: [...new Set([
        ...(previous.sourcePackages || []),
        ...(normalized.sourcePackages || []),
      ])].sort(),
    };
    for (const [key, value] of Object.entries(previous)) {
      if (normalized[key] == null && value != null) next[key] = value;
    }
    merged.set(normalized.id, next);
  }
  return [...merged.values()].sort((left, right) => right.date.localeCompare(left.date));
}

export function mergeHealthBodyweight(current, healthDays) {
  const byDate = new Map();
  for (const entry of Array.isArray(current) ? current : []) {
    const date = String(entry?.date || "");
    if (date) byDate.set(date, { ...entry, date });
  }

  for (const day of Array.isArray(healthDays) ? healthDays : []) {
    const rawDate = day?.date;
    const date = typeof rawDate === "string" ? rawDate : String(rawDate || "");
    const weight = finiteOrNull(day?.weightLb);
    if (!date || weight == null || weight <= 0) continue;
    const existing = byDate.get(date);
    if (existing && existing.source !== "health-connect") continue;
    const entry = {
      id: `health-connect-weight:${date}`,
      date,
      weight: Math.round(weight * 10) / 10,
      source: "health-connect",
      importedAt: day?.importedAt || new Date().toISOString(),
    };
    const bodyFat = finiteOrNull(day?.bodyFat);
    if (bodyFat != null && bodyFat > 0) entry.bf = Math.round(bodyFat * 10) / 10;
    byDate.set(date, entry);
  }

  return [...byDate.values()].sort((left, right) =>
    (right.date < left.date ? -1 : right.date > left.date ? 1 : 0));
}

export function healthSyncSummary(days) {
  const records = Array.isArray(days) ? days : [];
  let metricCount = 0;
  let populatedDays = 0;
  const sourcePackages = new Set();

  for (const day of records) {
    const dayMetricCount = HEALTH_CONNECT_METRIC_KEYS.reduce(
      (count, key) => count + (finiteOrNull(day?.[key]) == null ? 0 : 1),
      0,
    );
    if (dayMetricCount > 0) populatedDays += 1;
    metricCount += dayMetricCount;
    for (const packageName of Array.isArray(day?.sourcePackages) ? day.sourcePackages : []) {
      if (packageName) sourcePackages.add(String(packageName));
    }
  }

  return {
    daysRead: records.length,
    populatedDays,
    metricCount,
    sourcePackages: [...sourcePackages].sort(),
  };
}

export function healthSourceAppNames(days) {
  const names = new Set();
  for (const day of Array.isArray(days) ? days : []) {
    for (const value of Array.isArray(day?.sourcePackages) ? day.sourcePackages : []) {
      const packageName = String(value || "").toLowerCase();
      if (!packageName) continue;
      if (packageName.includes("shealth") || packageName.includes("samsung")) {
        names.add("Samsung Health");
      } else if (packageName.includes("garmin")) {
        names.add("Garmin Connect");
      } else if (packageName.includes("fitbit")) {
        names.add("Fitbit");
      } else if (packageName.includes("google") && packageName.includes("fitness")) {
        names.add("Google Fit");
      } else {
        names.add("Another Health Connect app");
      }
    }
  }
  return [...names];
}

export function isHealthConnectWritableSession(session) {
  return Boolean(
    session
    && String(session.id || "").trim()
    && session.source !== "garmin"
    && session.source !== "health-connect",
  );
}

export function healthConnectExerciseType(session) {
  switch (session?.sessionType) {
    case "hiit":
    case "vo2":
      return "hiit";
    case "mma":
      return "martialArts";
    case "pilates":
      return "pilates";
    case "yoga":
      return "yoga";
    case "core":
      return "calisthenics";
    default:
      return "strengthTraining";
  }
}

export function healthConnectWorkoutPayload(session, completedAt = Date.now()) {
  if (!isHealthConnectWritableSession(session)) return null;

  const fallbackEnd = timestampMilliseconds(completedAt) ?? Date.now();
  const endMs = timestampMilliseconds(session.completedAt) ?? fallbackEnd;
  const durationMs = Math.max(60_000, (Number(session.durationMin) || 1) * 60_000);
  const startMs = timestampMilliseconds(session.startedAt) ?? endMs - durationMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  const entries = Array.isArray(session.entries) ? session.entries : [];
  const setCount = entries.reduce(
    (total, entry) => total + (Array.isArray(entry?.sets) ? entry.sets.length : 0),
    0,
  );
  const notes = [
    `${entries.length} exercise${entries.length === 1 ? "" : "s"}`,
    setCount ? `${setCount} logged set${setCount === 1 ? "" : "s"}` : null,
    Number(session.volume) > 0 ? `${Math.round(Number(session.volume)).toLocaleString("en-US")} lb volume` : null,
  ].filter(Boolean).join(" · ");

  return {
    clientRecordId: `irondesk:${String(session.id).trim()}`,
    clientRecordVersion: Math.max(1, Math.trunc(endMs)),
    title: String(session.dayId || session.title || "IronDesk Workout").slice(0, 120),
    notes: `Logged in IronDesk${notes ? ` · ${notes}` : ""}`.slice(0, 500),
    exerciseType: healthConnectExerciseType(session),
    startTime: new Date(startMs).toISOString(),
    endTime: new Date(endMs).toISOString(),
  };
}

export async function writeWorkoutToHealthConnect(session) {
  const payload = healthConnectWorkoutPayload(session);
  if (!payload) {
    const error = new Error("Only completed IronDesk workouts can be sent to Health Connect.");
    error.code = "health-connect-invalid-workout";
    throw error;
  }
  const status = await HealthConnect.getStatus();
  if (!status?.available) {
    const error = new Error("Open the IronDesk Android app to send workouts to Health Connect.");
    error.code = status?.reason || "health-connect-unavailable";
    throw error;
  }
  if (!status?.permissions?.writeExercise && !status?.writeExerciseGranted) {
    const error = new Error("Allow IronDesk to write exercise in Health Connect first.");
    error.code = "health-connect-write-permission-required";
    throw error;
  }
  return HealthConnect.writeExerciseSession(payload);
}

export async function performHealthConnectSync(days = HEALTH_CONNECT_DAYS) {
  const status = await HealthConnect.getStatus();
  if (!status?.available) {
    const message = status?.reason === "android-14-required"
      ? "Health Connect requires Android 14 or newer."
      : "Install and open the IronDesk Android app to connect Health Connect.";
    const error = new Error(message);
    error.code = status?.reason || "health-connect-unavailable";
    throw error;
  }
  if (!Number(status?.readGrantedCount ?? status?.grantedCount)) {
    const error = new Error("Allow at least one Health Connect read category first.");
    error.code = "health-connect-permission-required";
    error.status = status;
    throw error;
  }
  const range = recentHealthDateRange(days);
  const result = await HealthConnect.readDailySummary(range);
  const syncedAt = result?.syncedAt || new Date().toISOString();
  const summaries = (Array.isArray(result?.days) ? result.days : [])
    .map(day => normalizeHealthSummary(day, syncedAt))
    .filter(Boolean);
  return {
    ...result,
    days: summaries,
    syncedAt,
  };
}
