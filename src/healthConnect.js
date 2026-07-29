import {
  Capacitor,
  WebPlugin,
  registerPlugin,
} from "@capacitor/core";

export const HEALTH_CONNECT_AUTO_SYNC_KEY = "irondesk:health-connect-auto-sync:v1";
export const HEALTH_CONNECT_LAST_SYNC_KEY = "irondesk:health-connect-last-sync:v1";
export const HEALTH_CONNECT_DAYS = 7;

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
      permissionCount: 9,
      allGranted: false,
      reason: "android-app-required",
    };
  }

  async requestPermissions() {
    throw new Error("Open the IronDesk Android app to connect Health Connect.");
  }

  async readDailySummary() {
    throw new Error("Health Connect data can only be read by the IronDesk Android app.");
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
    if (entry?.date) byDate.set(String(entry.date), entry);
  }

  for (const day of Array.isArray(healthDays) ? healthDays : []) {
    const date = String(day?.date || "");
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
    String(right?.date || "").localeCompare(String(left?.date || "")));
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
  if (!Number(status?.grantedCount)) {
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
