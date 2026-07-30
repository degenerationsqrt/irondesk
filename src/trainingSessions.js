function completedMinutes(startedAt, completedAt) {
  const start = Number(startedAt);
  const end = Number(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 1;
  return Math.max(1, Math.round((end - start) / 60000));
}

export function buildTrackedSession({
  id,
  date,
  title,
  sessionType,
  mode = "home",
  startedAt,
  completedAt = Date.now(),
  entries = [],
  metadata = {},
}) {
  return {
    id,
    date,
    dayId: title,
    sessionType,
    mode,
    startedAt,
    completedAt,
    durationMin: completedMinutes(startedAt, completedAt),
    entries: (Array.isArray(entries) ? entries : []).map((entry) => ({
      ex: entry?.ex || entry?.name || "Activity",
      summary: entry?.summary || "",
      role: entry?.role || sessionType || "training",
      sets: Array.isArray(entry?.sets) ? entry.sets : [],
    })),
    volume: 0,
    prs: [],
    ...metadata,
  };
}

export function sessionTypeLabel(session) {
  if (session?.source === "garmin") return "GARMIN";
  const labels = {
    core: "CORE",
    hiit: "HIIT",
    vo2: "VO₂",
    mma: "MMA",
    pilates: "PILATES",
    yoga: "YOGA",
  };
  return labels[session?.sessionType] || (session?.mode === "gym" ? "GYM" : "HOME");
}

export function trackedSessionSummary(session) {
  const minutes = Math.max(0, Number(session?.durationMin) || 0);
  if (!session?.sessionType) return null;
  const entries = Array.isArray(session?.entries) ? session.entries.length : 0;
  return `${minutes} min · ${entries} tracked item${entries === 1 ? "" : "s"}`;
}
