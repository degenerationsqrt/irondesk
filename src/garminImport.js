import { localDateKey } from "./trainingMath.js";

const GARMIN_SOURCE = "garmin";
const DEFAULT_DEVICE = "Garmin fēnix 6X";
const KG_TO_LB = 2.2046226218;

const HEADER_ALIASES = {
  activityId: ["activityid", "activitynumber", "id"],
  activityType: ["activitytype", "activitysport", "sport", "type"],
  title: ["title", "activityname", "name"],
  date: [
    "date",
    "starttime",
    "starttimelocal",
    "startdate",
    "activitydate",
    "begintimestamp",
  ],
  duration: [
    "time",
    "duration",
    "elapsedtime",
    "movingtime",
    "totaltime",
    "totalduration",
    "durationseconds",
  ],
  distance: ["distance", "totaldistance", "distancemeters", "distancekm", "distancemiles"],
  calories: ["calories", "totalcalories", "activecalories"],
  avgHeartRate: ["avghr", "averageheartrate", "avgheartrate"],
  maxHeartRate: ["maxhr", "maximumheartrate", "maxheartrate"],
  totalReps: ["totalreps", "repetitions", "reps"],
};

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function numberFrom(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? "")
    .trim()
    .replaceAll(",", "")
    .replace(/[^\d.+-]/g, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value) {
  const parsed = numberFrom(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

function humanize(value) {
  const text = String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  return text
    .split(" ")
    .map((word) => {
      if (/^(hr|gps|hiit|bmx)$/i.test(word)) return word.toUpperCase();
      if (/^\d/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function safeFileName(value) {
  return String(value || "Garmin activity").replace(/[^\w.\- ()]/g, "").slice(0, 160);
}

function hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function dateKeyFromValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDateKey(value);

  const text = String(value || "").trim();
  if (!text) return "";

  const iso = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const slashed = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (slashed) {
    const [, first, second, year] = slashed;
    const firstNumber = Number(first);
    const secondNumber = Number(second);
    const month = firstNumber > 12 ? secondNumber : firstNumber;
    const day = firstNumber > 12 ? firstNumber : secondNumber;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : localDateKey(parsed);
}

function dateIsoFromValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const text = String(value || "").trim();
  if (!text) return "";
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function durationSecondsFrom(value, header = "") {
  const text = String(value ?? "").trim();
  if (!text) return 0;

  if (text.includes(":")) {
    const parts = text.split(":").map((part) => numberFrom(part));
    if (parts.some((part) => part == null)) return 0;
    if (parts.length === 3) return Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]);
    if (parts.length === 2) return Math.round(parts[0] * 60 + parts[1]);
  }

  const hours = Number(text.match(/([\d.]+)\s*h/i)?.[1] || 0);
  const minutes = Number(text.match(/([\d.]+)\s*m(?!s)/i)?.[1] || 0);
  const seconds = Number(text.match(/([\d.]+)\s*s/i)?.[1] || 0);
  if (hours || minutes || seconds) return Math.round(hours * 3600 + minutes * 60 + seconds);

  const numeric = positiveNumber(text) || 0;
  const normalizedHeader = normalizeHeader(header);
  if (normalizedHeader.includes("seconds") || normalizedHeader === "totalduration") {
    return Math.round(numeric);
  }
  return Math.round(numeric * 60);
}

function distanceFrom(value, header = "") {
  const raw = String(value ?? "").trim();
  const amount = positiveNumber(raw);
  if (amount == null) return { distanceMeters: null, distanceDisplay: "" };

  const normalized = normalizeHeader(header);
  const lower = raw.toLowerCase();
  let distanceMeters = null;
  let unit = "";

  if (normalized.includes("meter") || /\bmeters?\b|\bm\b/.test(lower)) {
    distanceMeters = amount;
    unit = "m";
  } else if (normalized.includes("km") || /\bkm\b|kilomet/.test(lower)) {
    distanceMeters = amount * 1000;
    unit = "km";
  } else if (normalized.includes("mile") || /\bmi\b|miles?/.test(lower)) {
    distanceMeters = amount * 1609.344;
    unit = "mi";
  }

  const distanceDisplay = /[a-z]/i.test(raw)
    ? raw
    : unit
      ? `${amount.toLocaleString()} ${unit}`
      : amount.toLocaleString();
  return { distanceMeters, distanceDisplay };
}

function sourceSignature({
  activityId,
  startedAt,
  date,
  activityType,
  title,
  durationSeconds,
  distanceDisplay,
  serialNumber,
  sessionIndex = 0,
}) {
  if (activityId) return `garmin:activity:${String(activityId).trim()}`;
  const signature = [
    startedAt || date,
    activityType,
    title,
    Math.round(Number(durationSeconds) || 0),
    distanceDisplay,
    serialNumber,
    sessionIndex,
  ]
    .map((part) => String(part || "").trim().toLowerCase())
    .join("|");
  return `garmin:signature:${hashText(signature)}`;
}

function makeGarminSession({
  activityId = "",
  activityType = "",
  title = "",
  date = "",
  startedAt = "",
  durationSeconds = 0,
  calories = null,
  avgHeartRate = null,
  maxHeartRate = null,
  distanceMeters = null,
  distanceDisplay = "",
  totalReps = null,
  device = DEFAULT_DEVICE,
  sourceFile = "",
  serialNumber = "",
  entries = [],
  sessionIndex = 0,
}) {
  const readableType = humanize(activityType) || "Activity";
  const readableTitle = String(title || "").trim() || `Garmin ${readableType}`;
  const sourceKey = sourceSignature({
    activityId,
    startedAt,
    date,
    activityType,
    title: readableTitle,
    durationSeconds,
    distanceDisplay,
    serialNumber,
    sessionIndex,
  });
  const volume = entries.reduce(
    (sum, entry) => sum + (entry.sets || []).reduce(
      (entrySum, set) => entrySum + (Number(set.w) || 0) * (Number(set.r) || 0),
      0,
    ),
    0,
  );

  return {
    id: `garmin-${hashText(sourceKey)}`,
    date,
    startedAt,
    dayId: readableTitle,
    title: readableTitle,
    mode: "garmin",
    durationMin: Math.round((Number(durationSeconds) || 0) / 60),
    entries,
    volume: Math.round(volume),
    prs: [],
    source: GARMIN_SOURCE,
    sourceKey,
    sourceDevice: device || DEFAULT_DEVICE,
    garmin: {
      activityId: activityId || "",
      activityType: readableType,
      calories,
      avgHeartRate,
      maxHeartRate,
      distanceMeters,
      distanceDisplay,
      durationSeconds: Math.round(Number(durationSeconds) || 0),
      totalReps,
      sourceFile: safeFileName(sourceFile),
    },
  };
}

export function parseCsvRows(input) {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  row.push(cell.replace(/\r$/, ""));
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

function columnLookup(headers) {
  const normalized = headers.map(normalizeHeader);
  const result = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalized.findIndex((header) => aliases.includes(header));
    if (index >= 0) result[field] = index;
  }
  return result;
}

export function parseGarminCsv(
  text,
  { sourceFile = "garmin-activities.csv", device = DEFAULT_DEVICE } = {},
) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("This CSV does not contain any Garmin activity rows.");

  const headers = rows[0].map((header) => String(header || "").trim());
  const normalizedHeaders = new Set(headers.map(normalizeHeader));
  if (
    normalizedHeaders.has("workoutid")
    && normalizedHeaders.has("exercise")
    && normalizedHeaders.has("weightlb")
  ) {
    throw new Error("Choose a Garmin activity CSV, not an IronDesk history export.");
  }

  const columns = columnLookup(headers);
  if (columns.date == null || (columns.activityType == null && columns.title == null)) {
    throw new Error("The CSV needs Garmin Date and Activity Type or Title columns.");
  }

  const sessions = [];
  let skippedRows = 0;
  for (const row of rows.slice(1)) {
    const value = (field) => (columns[field] == null ? "" : row[columns[field]] ?? "");
    const date = dateKeyFromValue(value("date"));
    if (!date) {
      skippedRows += 1;
      continue;
    }

    const durationHeader = columns.duration == null ? "" : headers[columns.duration];
    const distanceHeader = columns.distance == null ? "" : headers[columns.distance];
    const durationSeconds = durationSecondsFrom(value("duration"), durationHeader);
    const distance = distanceFrom(value("distance"), distanceHeader);
    const startedAt = dateIsoFromValue(value("date"));

    sessions.push(makeGarminSession({
      activityId: value("activityId"),
      activityType: value("activityType"),
      title: value("title"),
      date,
      startedAt,
      durationSeconds,
      calories: positiveNumber(value("calories")),
      avgHeartRate: positiveNumber(value("avgHeartRate")),
      maxHeartRate: positiveNumber(value("maxHeartRate")),
      distanceMeters: distance.distanceMeters,
      distanceDisplay: distance.distanceDisplay,
      totalReps: positiveNumber(value("totalReps")),
      device,
      sourceFile,
    }));
  }

  if (!sessions.length) throw new Error("No dated Garmin activities were found in this CSV.");
  return {
    sessions,
    skippedRows,
    warnings: skippedRows ? [`${skippedRows} row${skippedRows === 1 ? "" : "s"} had no usable date.`] : [],
  };
}

function profileValue(profile, typeName, value) {
  if (typeof value === "string") return value;
  return profile?.types?.[typeName]?.[value] ?? value;
}

function exerciseNameForSet(set, profile) {
  const rawCategory = Array.isArray(set?.category) ? set.category[0] : set?.category;
  const category = profileValue(profile, "exerciseCategory", rawCategory);
  const rawSubtype = Array.isArray(set?.categorySubtype)
    ? set.categorySubtype[0]
    : set?.categorySubtype;
  const subtype = category
    ? profileValue(profile, `${category}ExerciseName`, rawSubtype)
    : rawSubtype;
  return humanize(subtype) || humanize(category) || "Strength Set";
}

function entriesFromSetMessages(setMessages, profile) {
  const byExercise = new Map();
  for (const set of Array.isArray(setMessages) ? setMessages : []) {
    if (String(set?.setType || "").toLowerCase() === "rest") continue;
    const repetitions = positiveNumber(set?.repetitions);
    if (repetitions == null) continue;
    const exercise = exerciseNameForSet(set, profile);
    const weightKg = positiveNumber(set?.weight) || 0;
    const recordedSet = {
      w: Math.round(weightKg * KG_TO_LB * 10) / 10,
      r: Math.round(repetitions),
      done: true,
      sourceWeightKg: weightKg,
    };
    if (!byExercise.has(exercise)) {
      byExercise.set(exercise, {
        ex: exercise,
        role: "acc",
        db: false,
        source: GARMIN_SOURCE,
        sets: [],
      });
    }
    byExercise.get(exercise).sets.push(recordedSet);
  }
  return [...byExercise.values()];
}

function fitDeviceName(fileId, fallback) {
  const productName = String(fileId?.productName || "").trim();
  if (productName) return productName;
  const product = humanize(fileId?.garminProduct);
  return product ? `Garmin ${product}` : fallback || DEFAULT_DEVICE;
}

function sessionSetMessages(session, sessionIndex, allSessions, allSets) {
  if (allSessions.length === 1) return allSets;
  const start = session?.startTime instanceof Date ? session.startTime.getTime() : null;
  const end = session?.timestamp instanceof Date ? session.timestamp.getTime() : null;
  if (start == null || end == null) return sessionIndex === 0 ? allSets : [];
  return allSets.filter((set) => {
    const timestamp = set?.startTime instanceof Date
      ? set.startTime.getTime()
      : set?.timestamp instanceof Date
        ? set.timestamp.getTime()
        : null;
    return timestamp != null && timestamp >= start - 60000 && timestamp <= end + 60000;
  });
}

export function garminMessagesToSessions(
  messages,
  { sourceFile = "activity.fit", device = DEFAULT_DEVICE, profile = null } = {},
) {
  const fileId = messages?.fileIdMesgs?.[0] || {};
  const sessionMessages = Array.isArray(messages?.sessionMesgs) ? messages.sessionMesgs : [];
  const activity = messages?.activityMesgs?.[0] || {};
  const allSets = Array.isArray(messages?.setMesgs) ? messages.setMesgs : [];
  const actualSessions = sessionMessages.length
    ? sessionMessages
    : [{
      startTime: fileId.timeCreated,
      timestamp: activity.timestamp,
      totalTimerTime: activity.totalTimerTime,
      sport: "activity",
    }];
  const resolvedDevice = fitDeviceName(fileId, device);

  return actualSessions.map((session, sessionIndex) => {
    const start = session?.startTime || fileId.timeCreated || activity.timestamp;
    const date = dateKeyFromValue(start);
    const startedAt = dateIsoFromValue(start);
    const sport = profileValue(profile, "sport", session?.sport);
    const subSport = profileValue(profile, "subSport", session?.subSport);
    const activityType = (
      subSport && !["generic", "all"].includes(String(subSport))
        ? subSport
        : sport
    ) || "activity";
    const title = session?.sportProfileName || `Garmin ${humanize(activityType) || "Activity"}`;
    const durationSeconds = positiveNumber(
      session?.totalTimerTime ?? session?.totalElapsedTime ?? activity?.totalTimerTime,
    ) || 0;
    const distanceMeters = positiveNumber(session?.totalDistance);
    const distanceDisplay = distanceMeters == null
      ? ""
      : distanceMeters >= 1000
        ? `${(distanceMeters / 1000).toFixed(2)} km`
        : `${Math.round(distanceMeters)} m`;
    const relevantSets = sessionSetMessages(
      session,
      sessionIndex,
      actualSessions,
      allSets,
    );
    const entries = entriesFromSetMessages(relevantSets, profile);
    const totalReps = entries.reduce(
      (sum, entry) => sum + entry.sets.reduce((setSum, set) => setSum + set.r, 0),
      0,
    );

    return makeGarminSession({
      activityType,
      title,
      date,
      startedAt,
      durationSeconds,
      calories: positiveNumber(session?.totalCalories),
      avgHeartRate: positiveNumber(session?.avgHeartRate),
      maxHeartRate: positiveNumber(session?.maxHeartRate),
      distanceMeters,
      distanceDisplay,
      totalReps: totalReps || null,
      device: resolvedDevice,
      sourceFile,
      serialNumber: fileId?.serialNumber,
      entries,
      sessionIndex,
    });
  }).filter((session) => session.date);
}

export async function parseGarminFit(
  input,
  { sourceFile = "activity.fit", device = DEFAULT_DEVICE } = {},
) {
  const { Decoder, Stream, Profile } = await import("@garmin/fitsdk");
  let buffer;
  if (input instanceof ArrayBuffer) {
    buffer = input;
  } else if (ArrayBuffer.isView(input)) {
    buffer = input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  } else {
    throw new Error("The selected FIT file could not be read.");
  }

  const stream = Stream.fromArrayBuffer(buffer);
  const decoder = new Decoder(stream);
  if (!decoder.isFIT()) throw new Error("This file is not a valid Garmin FIT file.");

  const result = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    mergeHeartRates: true,
  });
  const sessions = garminMessagesToSessions(result.messages, {
    sourceFile,
    device,
    profile: Profile,
  });
  if (!sessions.length) throw new Error("No Garmin activity session was found in this FIT file.");
  return {
    sessions,
    skippedRows: 0,
    warnings: Array.isArray(result.errors) ? result.errors.map(String) : [],
  };
}

export function mergeGarminSessions(existingSessions, importedSessions) {
  const existing = Array.isArray(existingSessions) ? existingSessions : [];
  const knownKeys = new Set(
    existing
      .map((session) => session?.sourceKey)
      .filter(Boolean),
  );
  const knownActivityIds = new Set(
    existing.flatMap((session) => [
      session?.garmin?.activityId,
      session?.id ? `irondesk-${session.id}` : "",
    ]).filter(Boolean).map(String),
  );
  const addedSessions = [];
  let duplicates = 0;

  for (const session of Array.isArray(importedSessions) ? importedSessions : []) {
    const activityId = String(session?.garmin?.activityId || "");
    if (
      !session?.sourceKey
      || knownKeys.has(session.sourceKey)
      || (activityId && knownActivityIds.has(activityId))
    ) {
      duplicates += 1;
      continue;
    }
    knownKeys.add(session.sourceKey);
    if (activityId) knownActivityIds.add(activityId);
    addedSessions.push(session);
  }

  const sessions = [...addedSessions, ...existing]
    .map((session, index) => ({ session, index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.session?.startedAt || `${left.session?.date || ""}T00:00:00`);
      const rightTime = Date.parse(right.session?.startedAt || `${right.session?.date || ""}T00:00:00`);
      const safeLeft = Number.isNaN(leftTime) ? 0 : leftTime;
      const safeRight = Number.isNaN(rightTime) ? 0 : rightTime;
      return safeRight - safeLeft || left.index - right.index;
    })
    .map(({ session }) => session);

  return {
    sessions,
    added: addedSessions.length,
    duplicates,
  };
}

export function garminMetricItems(session) {
  const garmin = session?.garmin || {};
  const metrics = [];
  if (garmin.distanceDisplay) metrics.push(["Distance", garmin.distanceDisplay]);
  if (garmin.calories != null) metrics.push(["Calories", Math.round(garmin.calories).toLocaleString()]);
  if (garmin.avgHeartRate != null) metrics.push(["Avg HR", `${Math.round(garmin.avgHeartRate)} bpm`]);
  if (garmin.maxHeartRate != null) metrics.push(["Max HR", `${Math.round(garmin.maxHeartRate)} bpm`]);
  if (garmin.totalReps != null) metrics.push(["Reps", Math.round(garmin.totalReps).toLocaleString()]);
  return metrics;
}
