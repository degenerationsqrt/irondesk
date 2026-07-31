import { newerWorkoutProgress } from "./workoutSchedule.js";
import { normalizeActiveWorkout, normalizeSessionHistory } from "./workoutUtilities.js";
import { normalizeGender, normalizeGoal, normalizeWorkoutProgress } from "./profileState.js";

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
  "modeUpdatedAt",
  "sessions",
  "deletedRecords",
  "bwLog",
  "cardioLog",
  "healthLog",
  "healthLogClearedAt",
  "active",
  "activeClearedAt",
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

const TOMBSTONE_FIELDS = Object.freeze(["sessions", "bwLog", "cardioLog"]);
const TOMBSTONE_KEY_FIELDS = Object.freeze({
  sessions: ["sourceKey", "id"],
  bwLog: ["id", "date"],
  cardioLog: ["id"],
});
const MAX_TOMBSTONES_PER_FIELD = 500;

function normalizeTombstoneBucket(value) {
  const entries = Object.entries(value && typeof value === "object" ? value : {})
    .map(([key, deletedAt]) => [String(key), Math.max(0, Number(deletedAt) || 0)])
    .filter(([key, deletedAt]) => key && deletedAt > 0)
    .sort((left, right) => left[1] - right[1])
    .slice(-MAX_TOMBSTONES_PER_FIELD);
  return Object.fromEntries(entries);
}

export function normalizeDeletedRecords(value) {
  return Object.fromEntries(
    TOMBSTONE_FIELDS.map(field => [field, normalizeTombstoneBucket(value?.[field])]),
  );
}

export function recordTombstoneKey(field, record) {
  const keyFields = TOMBSTONE_KEY_FIELDS[field];
  if (!keyFields) throw new Error(`Unsupported cloud record field: ${field}`);
  return recordKey(record, keyFields);
}

function mergeDeletedRecords(localValue, cloudValue) {
  const local = normalizeDeletedRecords(localValue);
  const cloud = normalizeDeletedRecords(cloudValue);
  return Object.fromEntries(TOMBSTONE_FIELDS.map(field => {
    const keys = new Set([...Object.keys(cloud[field]), ...Object.keys(local[field])]);
    const bucket = {};
    for (const key of keys) {
      bucket[key] = Math.max(Number(cloud[field][key]) || 0, Number(local[field][key]) || 0);
    }
    return [field, normalizeTombstoneBucket(bucket)];
  }));
}

function withoutDeletedRecords(records, field, deletedRecords) {
  const tombstones = deletedRecords[field] || {};
  return records.filter(record => !tombstones[recordTombstoneKey(field, record)]);
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
  state.sessions = normalizeSessionHistory(state.sessions);
  state.deletedRecords = normalizeDeletedRecords(state.deletedRecords);
  state.bwLog = Array.isArray(state.bwLog) ? state.bwLog : [];
  state.cardioLog = Array.isArray(state.cardioLog) ? state.cardioLog : [];
  state.healthLog = Array.isArray(state.healthLog) ? state.healthLog : [];
  state.customDays = Array.isArray(state.customDays) ? state.customDays : [];
  state.gender = normalizeGender(state.gender);
  state.goal = normalizeGoal(state.goal, state.gender);
  state.progress = normalizeWorkoutProgress(state.progress);
  if (Object.prototype.hasOwnProperty.call(state, "active")) {
    state.active = normalizeActiveWorkout(state.active);
  }
  return cleanJson(state, {
    sessions: [],
    deletedRecords: normalizeDeletedRecords(),
    bwLog: [],
    cardioLog: [],
    healthLog: [],
    customDays: [],
  });
}

export function newerTrainingMode(localSource, cloudSource) {
  const localMode = localSource?.mode === "gym" ? "gym" : localSource?.mode === "home" ? "home" : null;
  const cloudMode = cloudSource?.mode === "gym" ? "gym" : cloudSource?.mode === "home" ? "home" : null;
  const localUpdatedAt = Math.max(0, Number(localSource?.modeUpdatedAt) || 0);
  const cloudUpdatedAt = Math.max(0, Number(cloudSource?.modeUpdatedAt) || 0);

  if (localMode && localUpdatedAt > cloudUpdatedAt) {
    return { mode: localMode, modeUpdatedAt: localUpdatedAt };
  }
  if (cloudMode && cloudUpdatedAt > localUpdatedAt) {
    return { mode: cloudMode, modeUpdatedAt: cloudUpdatedAt };
  }
  if (cloudMode) return { mode: cloudMode, modeUpdatedAt: cloudUpdatedAt };
  if (localMode) return { mode: localMode, modeUpdatedAt: localUpdatedAt };
  return { mode: "home", modeUpdatedAt: 0 };
}

export function mergePersonalStates(localSource, cloudSource) {
  const local = buildPersonalState(localSource);
  const cloud = buildPersonalState(cloudSource);
  const trainingMode = newerTrainingMode(local, cloud);
  const deletedRecords = mergeDeletedRecords(local.deletedRecords, cloud.deletedRecords);
  const activeClearedAt = Math.max(
    Number(local.activeClearedAt) || 0,
    Number(cloud.activeClearedAt) || 0,
  );
  const activeAfterClear = active => {
    if (!active || activeClearedAt <= 0) return active || null;
    const startedAt = Number(active.start) || Date.parse(active.startedAt || "") || 0;
    return startedAt > activeClearedAt ? active : null;
  };
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
    mode: trainingMode.mode,
    modeUpdatedAt: trainingMode.modeUpdatedAt,
    deletedRecords,
    sessions: withoutDeletedRecords(mergeRecords(
      cloud.sessions,
      local.sessions,
      ["sourceKey", "id"],
    ), "sessions", deletedRecords).sort(sessionSort),
    bwLog: withoutDeletedRecords(mergeRecords(
      cloud.bwLog,
      local.bwLog,
      ["date", "id"],
    ), "bwLog", deletedRecords).filter(afterHealthClear).sort(logSort),
    cardioLog: withoutDeletedRecords(mergeRecords(
      cloud.cardioLog,
      local.cardioLog,
      ["id"],
    ), "cardioLog", deletedRecords).sort(logSort),
    healthLog: mergeRecords(
      cloud.healthLog,
      local.healthLog,
      ["id", "date"],
    ).filter(afterHealthClear).sort(logSort),
    healthLogClearedAt,
    active: activeAfterClear(local.active) || activeAfterClear(cloud.active),
    activeClearedAt,
    progress: newerWorkoutProgress(local.progress, cloud.progress),
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
