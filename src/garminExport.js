import { Encoder, Profile, Utils } from "@garmin/fitsdk";
import { strToU8, zipSync } from "fflate";

const LB_PER_KG = 2.2046226218;
const DEFAULT_ACTIVITY_SECONDS = 45 * 60;
const DEFAULT_SET_SECONDS = 30;
const MAX_WORKOUT_STEPS = 50;

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function safeDate(value, fallbackDate) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallbackDate : parsed;
}

function sessionStartDate(session) {
  const dateFallback = safeDate(`${session?.date || "2000-01-01"}T12:00:00`, new Date());
  return safeDate(session?.startedAt || session?.start, dateFallback);
}

function sessionDurationSeconds(session) {
  return boundedInteger(
    session?.garmin?.durationSeconds || Number(session?.durationMin) * 60,
    DEFAULT_ACTIVITY_SECONDS,
    60,
    24 * 60 * 60,
  );
}

function hash32(value) {
  const text = String(value || "irondesk");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) || 1;
}

function fitFileName(session, suffix = "") {
  const date = String(session?.date || "undated").replaceAll(/[^0-9-]/g, "") || "undated";
  const title = String(session?.dayId || session?.title || "workout")
    .normalize("NFKD")
    .replaceAll(/[^\w\s-]/g, "")
    .trim()
    .replaceAll(/\s+/g, "-")
    .slice(0, 42)
    .toLowerCase() || "workout";
  return `${date}-${title}${suffix}.fit`;
}

function sessionEntries(session) {
  return (Array.isArray(session?.entries) ? session.entries : [])
    .filter((entry) => entry?.role !== "cardio");
}

function completedSets(session) {
  return sessionEntries(session).flatMap((entry) =>
    (Array.isArray(entry?.sets) ? entry.sets : [])
      .filter((set) => Number(set?.r) > 0)
      .map((set) => ({ entry, set })));
}

function exerciseProfile(exerciseName) {
  const text = String(exerciseName || "").toLowerCase();
  if (/bench|chest press/.test(text)) {
    if (/incline.*dumbbell|incline db/.test(text)) return { category: "benchPress", subtype: 9 };
    if (/incline/.test(text)) return { category: "benchPress", subtype: 8 };
    if (/decline.*dumbbell|decline db/.test(text)) return { category: "benchPress", subtype: 5 };
    if (/dumbbell|db /.test(text)) return { category: "benchPress", subtype: 6 };
    if (/close.?grip/.test(text)) return { category: "benchPress", subtype: 4 };
    return { category: "benchPress", subtype: 1 };
  }
  if (/deadlift|romanian|\brdl\b/.test(text)) {
    if (/romanian|\brdl\b/.test(text)) return { category: "deadlift", subtype: 23 };
    if (/sumo/.test(text)) return { category: "deadlift", subtype: 15 };
    if (/dumbbell|db /.test(text)) return { category: "deadlift", subtype: 2 };
    return { category: "deadlift", subtype: 0 };
  }
  if (/squat|leg press/.test(text)) {
    if (/leg press/.test(text)) return { category: "squat", subtype: 0 };
    if (/front/.test(text)) return { category: "squat", subtype: 8 };
    if (/goblet/.test(text)) return { category: "squat", subtype: 37 };
    if (/dumbbell|db /.test(text)) return { category: "squat", subtype: 29 };
    return { category: "squat", subtype: 6 };
  }
  if (/row|face pull/.test(text)) {
    if (/face pull/.test(text)) return { category: "row", subtype: 5 };
    if (/cable/.test(text)) return { category: "row", subtype: 18 };
    if (/one.?arm/.test(text)) return { category: "row", subtype: 13 };
    if (/dumbbell|db /.test(text)) return { category: "row", subtype: 2 };
    return { category: "row", subtype: 45 };
  }
  if (/overhead press|shoulder press|military press|arnold press|\bohp\b/.test(text)) {
    if (/arnold/.test(text)) return { category: "shoulderPress", subtype: 1 };
    if (/military/.test(text)) return { category: "shoulderPress", subtype: 25 };
    if (/dumbbell|db /.test(text)) return { category: "shoulderPress", subtype: 24 };
    return { category: "shoulderPress", subtype: 14 };
  }
  if (/curl/.test(text)) {
    if (/hammer/.test(text)) return { category: "curl", subtype: 16 };
    if (/cable/.test(text)) return { category: "curl", subtype: 8 };
    if (/ez/.test(text)) return { category: "curl", subtype: 38 };
    return { category: "curl", subtype: 46 };
  }
  if (/pull.?up|chin.?up|pulldown/.test(text)) return { category: "pullUp", subtype: 0 };
  if (/push.?up/.test(text)) return { category: "pushUp", subtype: 0 };
  if (/lunge|split squat|step.?up/.test(text)) return { category: "lunge", subtype: 0 };
  if (/lateral raise|front raise/.test(text)) return { category: "lateralRaise", subtype: 0 };
  if (/tricep|skullcrusher/.test(text)) return { category: "tricepsExtension", subtype: 0 };
  if (/calf/.test(text)) return { category: "calfRaise", subtype: 0 };
  if (/plank/.test(text)) return { category: "plank", subtype: 0 };
  if (/sit.?up|crunch/.test(text)) return { category: "sitUp", subtype: 0 };
  return { category: "totalBody", subtype: 0 };
}

function activityProfile(session) {
  switch (session?.sessionType) {
    case "hiit":
    case "vo2":
      return { sport: "hiit", subSport: "hiit" };
    case "mma":
      return { sport: "mixedMartialArts", subSport: "generic" };
    case "pilates":
      return { sport: "fitnessEquipment", subSport: "pilates" };
    case "yoga":
      return { sport: "training", subSport: "yoga" };
    case "core":
      return { sport: "training", subSport: "cardioTraining" };
    default:
      return { sport: "training", subSport: "strengthTraining" };
  }
}

function fitWeightKg(set) {
  const pounds = positiveNumber(set?.w) || 0;
  return Math.round((pounds / LB_PER_KG) * 1000) / 1000;
}

function writeCommonFileId(encoder, session, type) {
  const start = sessionStartDate(session);
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type,
    manufacturer: "development",
    product: 1,
    productName: "IronDesk",
    serialNumber: hash32(`${session?.id || session?.date}:${type}`),
    timeCreated: start,
  });
  return start;
}

export function isGarminActivityExportableSession(session) {
  if (!session || session.source === "garmin" || session.source === "health-connect") return false;
  const hasIdentity = Boolean(
    String(session.id || session.sourceKey || session.date || session.startedAt || "").trim(),
  );
  const hasCompletedContent = completedSets(session).length > 0
    || Boolean(session.sessionType)
    || Number(session.durationMin) > 0
    || Number(session.completedAt) > 0;
  return hasIdentity && hasCompletedContent;
}

export function isGarminWorkoutExportableSession(session) {
  return session?.source !== "garmin"
    && session?.source !== "health-connect"
    && completedSets(session).length > 0;
}

export function isGarminExportableSession(session) {
  return isGarminActivityExportableSession(session);
}

function garminSessionTime(session) {
  for (const value of [session?.completedAt, session?.startedAt]) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function sortGarminSessionsNewestFirst(sessions) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((session, index) => ({ session, index }))
    .sort((a, b) =>
      String(b.session?.date || "").localeCompare(String(a.session?.date || ""))
      || garminSessionTime(b.session) - garminSessionTime(a.session)
      || a.index - b.index)
    .map(({ session }) => session);
}

export function createGarminActivityFit(session) {
  if (!isGarminActivityExportableSession(session)) {
    throw new Error("Choose a completed IronDesk activity from Progress History.");
  }
  const encoder = new Encoder();
  const start = writeCommonFileId(encoder, session, "activity");
  const durationSeconds = sessionDurationSeconds(session);
  const end = new Date(start.getTime() + durationSeconds * 1000);
  const localTimestampOffset = end.getTimezoneOffset() * -60;
  const sets = completedSets(session);
  const totalReps = sets.reduce((total, item) => total + (positiveNumber(item.set.r) || 0), 0);
  const calories = boundedInteger(session?.garmin?.calories, 0, 0, 65534);
  const avgHeartRate = boundedInteger(session?.garmin?.avgHeartRate, 0, 0, 254);
  const maxHeartRate = boundedInteger(session?.garmin?.maxHeartRate, 0, 0, 254);
  const profile = activityProfile(session);

  encoder.onMesg(Profile.MesgNum.DEVICE_INFO, {
    deviceIndex: "creator",
    manufacturer: "development",
    product: 1,
    productName: "IronDesk",
    serialNumber: hash32(session?.id || session?.date),
    softwareVersion: 1,
    timestamp: start,
  });
  encoder.onMesg(Profile.MesgNum.EVENT, {
    timestamp: start,
    event: "timer",
    eventType: "start",
  });
  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp: start,
    ...(avgHeartRate ? { heartRate: avgHeartRate } : {}),
  });

  sets.forEach(({ entry, set }, index) => {
    const profile = exerciseProfile(entry.ex);
    const setStartOffset = Math.round(((index + 1) / (sets.length + 1)) * durationSeconds);
    const setStart = new Date(start.getTime() + setStartOffset * 1000);
    encoder.onMesg(Profile.MesgNum.SET, {
      messageIndex: index,
      timestamp: new Date(setStart.getTime() + DEFAULT_SET_SECONDS * 1000),
      startTime: setStart,
      duration: DEFAULT_SET_SECONDS,
      repetitions: boundedInteger(set.r, 1, 1, 65534),
      weight: fitWeightKg(set),
      weightDisplayUnit: "pound",
      setType: "active",
      category: [profile.category],
      categorySubtype: [profile.subtype],
    });
  });

  encoder.onMesg(Profile.MesgNum.RECORD, {
    timestamp: end,
    ...(avgHeartRate ? { heartRate: avgHeartRate } : {}),
  });
  encoder.onMesg(Profile.MesgNum.EVENT, {
    timestamp: end,
    event: "timer",
    eventType: "stopAll",
  });

  const summary = {
    timestamp: end,
    startTime: start,
    totalElapsedTime: durationSeconds,
    totalTimerTime: durationSeconds,
    sport: profile.sport,
    subSport: profile.subSport,
    ...(calories ? { totalCalories: calories } : {}),
    ...(avgHeartRate ? { avgHeartRate } : {}),
    ...(maxHeartRate ? { maxHeartRate } : {}),
  };
  encoder.onMesg(Profile.MesgNum.LAP, {
    ...summary,
    messageIndex: 0,
    event: "lap",
    eventType: "stop",
  });
  encoder.onMesg(Profile.MesgNum.SESSION, {
    ...summary,
    messageIndex: 0,
    event: "session",
    eventType: "stop",
    firstLapIndex: 0,
    numLaps: 1,
    ...(totalReps ? { totalCycles: Math.round(totalReps) } : {}),
  });
  encoder.onMesg(Profile.MesgNum.ACTIVITY, {
    timestamp: end,
    numSessions: 1,
    type: "manual",
    event: "activity",
    eventType: "stop",
    localTimestamp: Utils.convertDateToDateTime(end) + localTimestampOffset,
    totalTimerTime: durationSeconds,
  });
  return encoder.close();
}

function workoutStepMessages(session, restSeconds) {
  const activeSets = completedSets(session);
  const messages = [];
  activeSets.forEach(({ entry, set }, index) => {
    const profile = exerciseProfile(entry.ex);
    const weightKg = fitWeightKg(set);
    messages.push({
      wktStepName: String(entry.ex || "Strength Set").slice(0, 32),
      notes: `${Number(set.w) || 0} lb × ${Number(set.r) || 0}`,
      durationType: "reps",
      durationValue: boundedInteger(set.r, 1, 1, 65534),
      targetType: "open",
      targetValue: 0,
      intensity: "active",
      exerciseCategory: profile.category,
      exerciseName: profile.subtype,
      exerciseWeight: weightKg,
      weightDisplayUnit: "pound",
    });
    if (index < activeSets.length - 1) {
      messages.push({
        wktStepName: "Rest",
        notes: `${restSeconds} seconds`,
        durationType: "time",
        durationValue: restSeconds * 1000,
        targetType: "open",
        targetValue: 0,
        intensity: "rest",
      });
    }
  });
  return messages.slice(0, MAX_WORKOUT_STEPS);
}

export function createGarminWorkoutFit(session, { restSeconds = 90, workoutName } = {}) {
  if (!isGarminWorkoutExportableSession(session)) {
    throw new Error("Choose an IronDesk workout with at least one completed set.");
  }
  const safeRestSeconds = boundedInteger(restSeconds, 90, 15, 600);
  const steps = workoutStepMessages(session, safeRestSeconds);
  if (!steps.length) throw new Error("This workout does not contain Garmin-compatible steps.");

  const encoder = new Encoder();
  writeCommonFileId(encoder, session, "workout");
  const defaultName = `ID ${session?.date || ""} ${session?.dayId || "Workout"}`;
  encoder.onMesg(Profile.MesgNum.WORKOUT, {
    sport: "training",
    subSport: "strengthTraining",
    numValidSteps: steps.length,
    wktName: String(workoutName || defaultName).trim().slice(0, 31),
    wktDescription: "Created locally by IronDesk for Garmin fēnix 6X",
  });
  steps.forEach((step, index) => {
    encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, {
      messageIndex: index,
      ...step,
    });
  });
  return encoder.close();
}

export function createGarminActivityPack(sessions) {
  const exportable = (Array.isArray(sessions) ? sessions : []).filter(isGarminActivityExportableSession);
  if (!exportable.length) throw new Error("Select at least one completed IronDesk activity.");
  const files = {};
  exportable.forEach((session) => {
    let name = fitFileName(session);
    let duplicate = 2;
    while (files[name]) {
      name = fitFileName(session, `-${duplicate}`);
      duplicate += 1;
    }
    files[name] = createGarminActivityFit(session);
  });
  files["IRONDESK-GARMIN-IMPORT.txt"] = strToU8([
    "IRONDESK GARMIN CONNECT ACTIVITY PACK",
    "",
    "1. Unzip this file.",
    "2. Open https://connect.garmin.com/modern/import-data on a computer.",
    "3. Select the .fit activity files and choose Import Data.",
    "",
    "These are completed activity records, not future workout instructions.",
    "Files were generated locally in your browser by IronDesk.",
  ].join("\r\n"));
  return zipSync(files, { level: 6 });
}

export function garminActivityPackName(date = new Date()) {
  const key = date.toISOString().slice(0, 10);
  return `irondesk-garmin-activities-${key}.zip`;
}

export function garminWorkoutFileName(session) {
  return fitFileName(session, "-watch-workout");
}

export function garminExportSummary(session) {
  const sets = completedSets(session);
  return {
    sets: sets.length,
    reps: sets.reduce((total, item) => total + (positiveNumber(item.set.r) || 0), 0),
    durationMinutes: Math.round(sessionDurationSeconds(session) / 60),
  };
}
