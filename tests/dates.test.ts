import { describe, expect, it } from "vitest";

import {
  dayKeyForInstant,
  formatDayKey,
  formatInstantTime,
  isWithinLastCalendarDays,
  safeTimeZone,
} from "../src/lib/irondesk/dates";

describe("athlete-local dates", () => {
  it("keeps a Los Angeles evening on the athlete's day when UTC is already tomorrow", () => {
    expect(dayKeyForInstant("2026-08-29T01:30:00.000Z", "America/Los_Angeles")).toBe("2026-08-28");
    expect(formatDayKey("2026-08-28")).toBe("Friday, August 28");
  });

  it("formats both sides of the daylight-saving jump in the requested timezone", () => {
    expect(formatInstantTime("2026-03-08T09:30:00.000Z", "America/Los_Angeles")).toBe("1:30 AM");
    expect(formatInstantTime("2026-03-08T10:30:00.000Z", "America/Los_Angeles")).toBe("3:30 AM");
  });

  it("honors fixed-offset profile timezones for bucketing and display", () => {
    const instant = "2026-08-29T01:30:00.000Z";
    expect(safeTimeZone("UTC-07:00")).toBe("UTC-07:00");
    expect(dayKeyForInstant(instant, "UTC-07:00")).toBe("2026-08-28");
    expect(formatInstantTime(instant, "-07:00")).toBe("6:30 PM");
  });

  it("filters by calendar days instead of slicing a number of sessions", () => {
    const now = new Date("2026-08-29T06:00:00.000Z");
    expect(
      isWithinLastCalendarDays("2026-08-22T20:00:00.000Z", 7, "America/Los_Angeles", now),
    ).toBe(true);
    expect(
      isWithinLastCalendarDays("2026-08-21T20:00:00.000Z", 7, "America/Los_Angeles", now),
    ).toBe(false);
  });

  it("falls back to UTC for an invalid profile timezone", () => {
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
    expect(dayKeyForInstant("2026-08-29T01:30:00.000Z", "Not/AZone")).toBe("2026-08-29");
  });
});
