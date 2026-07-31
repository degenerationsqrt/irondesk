import { localDateKey, setVolume, workoutVolume } from "./trainingMath.js";

export const DEFAULT_REST_TIMER_PREFS = Object.freeze({
  enabled: true,
  accessorySeconds: 60,
  heavySeconds: 180,
});

const REST_DURATION_OPTIONS = new Set([30, 45, 60, 90, 120, 180, 240, 300]);

function safeDuration(value, fallback) {
  const duration = Number(value);
  return REST_DURATION_OPTIONS.has(duration) ? duration : fallback;
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function normalizeRestTimerPrefs(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : DEFAULT_REST_TIMER_PREFS.enabled,
    accessorySeconds: safeDuration(
      source.accessorySeconds,
      DEFAULT_REST_TIMER_PREFS.accessorySeconds,
    ),
    heavySeconds: safeDuration(source.heavySeconds, DEFAULT_REST_TIMER_PREFS.heavySeconds),
  };
}

export function restDurationForEntry(preferences, entry) {
  const prefs = normalizeRestTimerPrefs(preferences);
  if (!prefs.enabled || entry?.role === "cardio" || entry?.role === "ab") return 0;
  return entry?.heavy ? prefs.heavySeconds : prefs.accessorySeconds;
}

export function removeLastWorkoutSet(activeWorkout, entryIndex) {
  if (!activeWorkout || !Array.isArray(activeWorkout.entries)) return activeWorkout;
  const entry = activeWorkout.entries[entryIndex];
  const plannedSetCount = Math.max(1, Number(entry?.plannedSetCount) || 1);
  if (
    !entry
    || !Array.isArray(entry.sets)
    || entry.sets.length <= plannedSetCount
  ) return activeWorkout;
  const removedSet = entry.sets[entry.sets.length - 1];

  return {
    ...activeWorkout,
    ...(removedSet?.done ? {
      restTimerEndAt: null,
      restTimerDuration: 0,
    } : {}),
    entries: activeWorkout.entries.map((item, index) => index !== entryIndex ? item : {
      ...item,
      sets: item.sets.slice(0, -1),
    }),
  };
}

export function safeSessionVolume(session) {
  const recorded = Number(session?.volume);
  if (Number.isFinite(recorded) && recorded >= 0) return recorded;
  return workoutVolume(Array.isArray(session?.entries) ? session.entries : []);
}

function normalizeEntries(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && typeof entry === "object")
    .map(entry => ({
      ...entry,
      sets: (Array.isArray(entry.sets) ? entry.sets : [])
        .filter(set => set && typeof set === "object"),
    }));
}

export function normalizeSessionHistory(value) {
  return (Array.isArray(value) ? value : [])
    .filter(session => session && typeof session === "object")
    .map(session => ({
      ...session,
      entries: normalizeEntries(session.entries),
      prs: Array.isArray(session.prs) ? session.prs.filter(Boolean) : [],
    }));
}

export function normalizeActiveWorkout(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    entries: normalizeEntries(value.entries),
  };
}

export function filterAndSortSessions(
  sessions,
  { query = "", mode = "all", range = "all", sort = "newest", now = new Date() } = {},
) {
  const normalizedQuery = normalizeSearchText(query).trim();
  const days = range === "30d" ? 30 : range === "90d" ? 90 : range === "year" ? 365 : null;
  const cutoff = days == null
    ? null
    : localDateKey(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));

  const filtered = (Array.isArray(sessions) ? sessions : []).filter((session) => {
    if (
      mode !== "all"
      && (mode === "training" ? !session?.sessionType : session?.mode !== mode)
    ) return false;
    if (cutoff && String(session?.date || "") < cutoff) return false;
    if (!normalizedQuery) return true;

    const haystack = normalizeSearchText([
      session?.dayId,
      session?.date,
      session?.mode,
      session?.sessionType,
      session?.source,
      session?.sourceDevice,
      session?.garmin?.activityType,
      ...(Array.isArray(session?.entries) ? session.entries.map((entry) => entry?.ex) : []),
    ]
      .filter(Boolean)
      .join(" "));

    return haystack.includes(normalizedQuery);
  });

  return filtered
    .map((session, index) => ({ session, index }))
    .sort((a, b) => {
      if (sort === "oldest") {
        return String(a.session?.date || "").localeCompare(String(b.session?.date || ""))
          || a.index - b.index;
      }
      if (sort === "volume") {
        return safeSessionVolume(b.session) - safeSessionVolume(a.session) || a.index - b.index;
      }
      if (sort === "duration") {
        return Number(b.session?.durationMin || 0) - Number(a.session?.durationMin || 0)
          || a.index - b.index;
      }
      return String(b.session?.date || "").localeCompare(String(a.session?.date || ""))
        || a.index - b.index;
    })
    .map(({ session }) => session);
}

export function summarizeSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).reduce(
    (summary, session) => ({
      sessions: summary.sessions + 1,
      minutes: summary.minutes + (Number(session?.durationMin) || 0),
      volume: summary.volume + safeSessionVolume(session),
      prs: summary.prs + (Array.isArray(session?.prs) ? session.prs.length : 0),
    }),
    { sessions: 0, minutes: 0, volume: 0, prs: 0 },
  );
}

const CSV_COLUMNS = [
  "workout_id",
  "date",
  "workout",
  "location",
  "duration_min",
  "session_volume_lb",
  "exercise",
  "exercise_type",
  "is_dumbbell",
  "set_number",
  "weight_lb",
  "reps",
  "set_volume_lb",
  "is_pr",
  "source",
  "source_device",
  "garmin_activity_id",
  "activity_type",
  "distance",
  "calories",
  "avg_hr",
  "max_hr",
];

const GARMIN_CSV_COLUMNS = [
  "Activity ID",
  "Activity Type",
  "Date",
  "Title",
  "Distance",
  "Calories",
  "Time",
  "Avg HR",
  "Max HR",
];

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function durationClock(secondsValue) {
  const totalSeconds = Math.max(0, Math.round(Number(secondsValue) || 0));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

function garminActivityId(session, index) {
  const recorded = String(session?.garmin?.activityId || "").trim();
  if (recorded) return recorded;
  const sourceActivity = String(session?.sourceKey || "").match(/^garmin:activity:(.+)$/)?.[1];
  if (sourceActivity) return sourceActivity;
  const id = String(session?.id || "").trim()
    || `${session?.date || "undated"}-${index + 1}`;
  return `irondesk-${id}`;
}

export function sessionsToGarminCsv(sessions) {
  const rows = [GARMIN_CSV_COLUMNS];
  (Array.isArray(sessions) ? sessions : []).forEach((session, index) => {
    const garmin = session?.garmin || {};
    const durationSeconds = Number(garmin.durationSeconds)
      || (Number(session?.durationMin) || 0) * 60;
    rows.push([
      garminActivityId(session, index),
      garmin.activityType || "Strength Training",
      session?.startedAt || session?.date || "",
      session?.dayId || session?.title || "IronDesk Workout",
      garmin.distanceDisplay || "",
      garmin.calories ?? "",
      durationClock(durationSeconds),
      garmin.avgHeartRate ?? "",
      garmin.maxHeartRate ?? "",
    ]);
  });
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function sessionsToCsv(sessions) {
  const rows = [CSV_COLUMNS];

  for (const session of Array.isArray(sessions) ? sessions : []) {
    const entries = Array.isArray(session?.entries) ? session.entries : [];
    const prs = new Set(
      (Array.isArray(session?.prs) ? session.prs : []).map((personalRecord) => personalRecord?.ex),
    );
    const sourceFields = [
      session?.source || "irondesk",
      session?.sourceDevice || "",
      session?.garmin?.activityId || "",
      session?.garmin?.activityType || "",
      session?.garmin?.distanceDisplay || "",
      session?.garmin?.calories ?? "",
      session?.garmin?.avgHeartRate ?? "",
      session?.garmin?.maxHeartRate ?? "",
    ];

    for (const entry of entries) {
      const sets = Array.isArray(entry?.sets) ? entry.sets : [];
      sets.forEach((set, setIndex) => {
        rows.push([
          session?.id,
          session?.date,
          session?.dayId,
          session?.mode,
          Number(session?.durationMin) || 0,
          safeSessionVolume(session),
          entry?.ex,
          entry?.role || "",
          entry?.db ? "yes" : "no",
          setIndex + 1,
          Number(set?.w) || 0,
          Number(set?.r) || 0,
          setVolume(set, Boolean(entry?.db)),
          prs.has(entry?.ex) ? "yes" : "no",
          ...sourceFields,
        ]);
      });
    }

    if (!entries.some((entry) => Array.isArray(entry?.sets) && entry.sets.length)) {
      rows.push([
        session?.id,
        session?.date,
        session?.dayId,
        session?.mode,
        Number(session?.durationMin) || 0,
        safeSessionVolume(session),
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        ...sourceFields,
      ]);
    }
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}
