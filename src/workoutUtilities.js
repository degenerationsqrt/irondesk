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

export function safeSessionVolume(session) {
  const recorded = Number(session?.volume);
  if (Number.isFinite(recorded) && recorded >= 0) return recorded;
  return workoutVolume(Array.isArray(session?.entries) ? session.entries : []);
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
    if (mode !== "all" && session?.mode !== mode) return false;
    if (cutoff && String(session?.date || "") < cutoff) return false;
    if (!normalizedQuery) return true;

    const haystack = normalizeSearchText([
      session?.dayId,
      session?.date,
      session?.mode,
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

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
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
