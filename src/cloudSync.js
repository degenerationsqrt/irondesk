export const CLOUD_SYNC_SCHEMA = 1;
export const CLOUD_SYNC_PREF_KEY = "irondesk:cloud-sync:v1";
export const CLOUD_DEVICE_KEY = "irondesk:cloud-device:v1";
export const CLOUD_DOCUMENT_MAX_BYTES = 850000;

const STATE_FIELDS = [
  "maxes",
  "homePlates",
  "gymPlates",
  "bar",
  "mode",
  "sessions",
  "bwLog",
  "cardioLog",
  "healthLog",
  "healthLogClearedAt",
  "active",
  "progress",
  "gender",
  "goal",
  "styleOverride",
  "customDays",
  "onboarded",
  "macros",
  "restTimerPrefs",
];

function cleanJson(value, fallback) {
  try {
    const serialized = JSON.stringify(value);
    return serialized == null ? fallback : JSON.parse(serialized);
  } catch {
    return fallback;
  }
}

function recordKey(record, fields) {
  for (const field of fields) {
    const value = record?.[field];
    if (value != null && String(value).trim()) return `${field}:${String(value).trim()}`;
  }
  return `signature:${JSON.stringify(record || {})}`;
}

function mergeRecords(cloudRecords, localRecords, keyFields) {
  const merged = new Map();
  for (const record of Array.isArray(cloudRecords) ? cloudRecords : []) {
    merged.set(recordKey(record, keyFields), record);
  }
  for (const record of Array.isArray(localRecords) ? localRecords : []) {
    merged.set(recordKey(record, keyFields), record);
  }
  return [...merged.values()];
}

function sessionSort(left, right) {
  const leftTime = Date.parse(left?.startedAt || `${left?.date || ""}T00:00:00`);
  const rightTime = Date.parse(right?.startedAt || `${right?.date || ""}T00:00:00`);
  const safeLeft = Number.isNaN(leftTime) ? 0 : leftTime;
  const safeRight = Number.isNaN(rightTime) ? 0 : rightTime;
  return safeRight - safeLeft;
}

function logSort(left, right) {
  return String(right?.date || "").localeCompare(String(left?.date || ""));
}

export function buildPersonalState(source = {}) {
  const state = {};
  for (const field of STATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) state[field] = source[field];
  }
  state.sessions = Array.isArray(state.sessions) ? state.sessions : [];
  state.bwLog = Array.isArray(state.bwLog) ? state.bwLog : [];
  state.cardioLog = Array.isArray(state.cardioLog) ? state.cardioLog : [];
  state.healthLog = Array.isArray(state.healthLog) ? state.healthLog : [];
  state.customDays = Array.isArray(state.customDays) ? state.customDays : [];
  return cleanJson(state, {
    sessions: [],
    bwLog: [],
    cardioLog: [],
    healthLog: [],
    customDays: [],
  });
}

export function mergePersonalStates(localSource, cloudSource) {
  const local = buildPersonalState(localSource);
  const cloud = buildPersonalState(cloudSource);
  const healthLogClearedAt = Math.max(
    Number(local.healthLogClearedAt) || 0,
    Number(cloud.healthLogClearedAt) || 0,
  );
  const afterHealthClear = record => {
    if (healthLogClearedAt <= 0) return true;
    if (record?.source !== "health-connect" && !String(record?.id || "").startsWith("health-connect:")) {
      return true;
    }
    const importedAt = Date.parse(record?.importedAt || "");
    return Number.isFinite(importedAt) && importedAt > healthLogClearedAt;
  };
  const merged = buildPersonalState({
    ...local,
    ...cloud,
    sessions: mergeRecords(
      cloud.sessions,
      local.sessions,
      ["sourceKey", "id"],
    ).sort(sessionSort),
    bwLog: mergeRecords(
      cloud.bwLog,
      local.bwLog,
      ["id", "date"],
    ).filter(afterHealthClear).sort(logSort),
    cardioLog: mergeRecords(
      cloud.cardioLog,
      local.cardioLog,
      ["id"],
    ).sort(logSort),
    healthLog: mergeRecords(
      cloud.healthLog,
      local.healthLog,
      ["id", "date"],
    ).filter(afterHealthClear).sort(logSort),
    healthLogClearedAt,
    active: local.active || cloud.active || null,
  });
  return merged;
}

export function personalStateHash(source) {
  const text = JSON.stringify(buildPersonalState(source));
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function personalStateBytes(source) {
  return new TextEncoder().encode(JSON.stringify(buildPersonalState(source))).byteLength;
}

export function createCloudEnvelope(state, {
  deviceId,
  updatedAt = Date.now(),
} = {}) {
  const cleanState = buildPersonalState(state);
  const bytes = personalStateBytes(cleanState);
  if (bytes > CLOUD_DOCUMENT_MAX_BYTES) {
    throw new Error("Cloud copy is too large. Export a JSON backup before adding more history.");
  }
  return {
    schemaVersion: CLOUD_SYNC_SCHEMA,
    updatedAt,
    deviceId: String(deviceId || "unknown-device"),
    state: cleanState,
  };
}

export function getOrCreateCloudDeviceId(storage, cryptoSource = globalThis.crypto) {
  const current = storage?.getItem?.(CLOUD_DEVICE_KEY);
  if (current) return current;
  const generated = cryptoSource?.randomUUID?.()
    || `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  storage?.setItem?.(CLOUD_DEVICE_KEY, generated);
  return generated;
}
