import { fixedOffsetMinutes, isIsoDayKey, localDayKey } from "./imported-data-adapter";

/** Returns a usable IANA/fixed timezone, falling back to UTC for invalid profile values. */
export function safeTimeZone(timeZone?: string | null): string {
  const candidate = timeZone?.trim();
  if (!candidate) return "UTC";
  if (fixedOffsetMinutes(candidate) != null) return candidate;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date(0));
    return candidate;
  } catch {
    return "UTC";
  }
}

export function dayKeyForInstant(instant: Date | string, timeZone?: string | null): string {
  const value = instant instanceof Date ? instant.toISOString() : instant;
  const localized = localDayKey(value, null, safeTimeZone(timeZone));
  if (localized) return localized;
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? "" : fallback.toISOString().slice(0, 10);
}

export function formatDayKey(day: string): string {
  if (!isIsoDayKey(day)) return day;
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(Date.UTC(year!, month! - 1, date)));
}

export function formatInstantDate(instant: string, timeZone?: string | null): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  const zone = safeTimeZone(timeZone);
  const offset = fixedOffsetMinutes(zone);
  const displayDate = offset == null ? date : new Date(date.getTime() + offset * 60_000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: offset == null ? zone : "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(displayDate);
}

export function formatInstantTime(instant: string, timeZone?: string | null): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  const zone = safeTimeZone(timeZone);
  const offset = fixedOffsetMinutes(zone);
  const displayDate = offset == null ? date : new Date(date.getTime() + offset * 60_000);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: offset == null ? zone : "UTC",
    hour: "numeric",
    minute: "2-digit",
  }).format(displayDate);
}

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function validLocalParts(value: string): LocalDateTimeParts | null {
  const match = LOCAL_DATE_TIME.exec(value.trim());
  if (!match) return null;
  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  if (parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
  const calendar = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
  );
  return calendar.getUTCFullYear() === parts.year &&
    calendar.getUTCMonth() === parts.month - 1 &&
    calendar.getUTCDate() === parts.day
    ? parts
    : null;
}

function partsInZone(date: Date, timeZone: string): LocalDateTimeParts | null {
  try {
    const formatted = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      Number(formatted.find((entry) => entry.type === type)?.value);
    const result = {
      year: part("year"),
      month: part("month"),
      day: part("day"),
      hour: part("hour"),
      minute: part("minute"),
      second: part("second"),
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
}

function sameLocalParts(left: LocalDateTimeParts | null, right: LocalDateTimeParts): boolean {
  return Boolean(
    left &&
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second,
  );
}

/**
 * Converts a `datetime-local` value in the athlete's profile timezone into an
 * absolute ISO instant. Invalid local times during a DST spring-forward gap
 * return null; an ambiguous fall-back time resolves to the earlier instant.
 */
export function localDateTimeToInstant(value: string, timeZone?: string | null): string | null {
  const target = validLocalParts(value);
  if (!target) return null;
  const zone = safeTimeZone(timeZone);
  const localEpoch = Date.UTC(
    target.year,
    target.month - 1,
    target.day,
    target.hour,
    target.minute,
    target.second,
  );
  const fixedOffset = fixedOffsetMinutes(zone);
  if (fixedOffset != null) return new Date(localEpoch - fixedOffset * 60_000).toISOString();

  // Sample the surrounding window to discover every offset that can apply on
  // this calendar day, then verify candidate instants by formatting them back.
  const offsets = new Set<number>();
  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 6) {
    const sampleMillis = localEpoch + deltaHours * 3_600_000;
    const sample = new Date(sampleMillis);
    const local = partsInZone(sample, zone);
    if (!local) continue;
    const localMillis = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
      local.second,
    );
    offsets.add(localMillis - sampleMillis);
  }

  const candidates = [...offsets]
    .map((offset) => new Date(localEpoch - offset))
    .filter((candidate) => sameLocalParts(partsInZone(candidate, zone), target))
    .sort((left, right) => left.getTime() - right.getTime());
  return candidates[0]?.toISOString() ?? null;
}

/** Formats an instant for an `<input type="datetime-local">` in the athlete's zone. */
export function localDateTimeValueForInstant(
  instant: Date | string,
  timeZone?: string | null,
): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "";
  const zone = safeTimeZone(timeZone);
  const fixedOffset = fixedOffsetMinutes(zone);
  const local =
    fixedOffset == null
      ? partsInZone(date, zone)
      : (() => {
          const shifted = new Date(date.getTime() + fixedOffset * 60_000);
          return {
            year: shifted.getUTCFullYear(),
            month: shifted.getUTCMonth() + 1,
            day: shifted.getUTCDate(),
            hour: shifted.getUTCHours(),
            minute: shifted.getUTCMinutes(),
            second: shifted.getUTCSeconds(),
          };
        })();
  if (!local) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${String(local.year).padStart(4, "0")}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}:${pad(local.minute)}`;
}

function dayNumber(day: string): number | null {
  if (!isIsoDayKey(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, date) / 86_400_000);
}

/** Calendar-day range using the athlete's timezone, rather than a session-count slice. */
export function isWithinLastCalendarDays(
  instant: string,
  days: number,
  timeZone?: string | null,
  now: Date = new Date(),
): boolean {
  const event = dayNumber(dayKeyForInstant(instant, timeZone));
  const today = dayNumber(dayKeyForInstant(now, timeZone));
  if (event == null || today == null || days < 1) return false;
  const age = today - event;
  return age >= 0 && age < days;
}
