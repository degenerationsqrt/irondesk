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
