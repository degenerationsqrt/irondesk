import { describe, expect, it } from "vitest";

import { DEVICE_SYNC_INITIAL_JOB_STATUS, aggregateByDay, normalizePayload, syncPayloadSchema } from "@/lib/imports/device-sync.server";
import { rateLimited } from "@/routes/api/public/health-connect/unpair";

const envelope = {
  source: "irondesk-health-connect" as const,
  version: 1,
  device: { label: "Pixel 8", timezone: "Pacific/Auckland" },
};

describe("device sync payload", () => {
  it("retains Health Connect provenance instead of stripping it", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [
        {
          external_id: "hc:rhr:1",
          metric: "resting_heart_rate",
          timestamp: "2026-05-01T05:00:00Z",
          value: 48,
          unit: "bpm",
          source_package: "com.samsung.health",
          device_manufacturer: "samsung",
          device_model: "SM-S911B",
          recording_method: "automatically_recorded",
        },
      ],
      activities: [],
    });

    const { records, issues } = normalizePayload(parsed);
    expect(issues).toHaveLength(0);
    expect(records[0]!.raw).toEqual({
      source_package: "com.samsung.health",
      device_manufacturer: "samsung",
      device_model: "SM-S911B",
      recording_method: "automatically_recorded",
    });
  });

  it("leaves raw metadata empty when the device sends no provenance", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [{ metric: "steps", timestamp: "2026-05-01T05:00:00Z", value: 8000 }],
      activities: [],
    });
    expect(normalizePayload(parsed).records[0]!.raw).toEqual({});
  });

  it("groups derived days in the record timezone, not UTC", () => {
    // 19:00 UTC on Apr 30 is already May 1 in Auckland.
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      records: [
        { metric: "weight", timestamp: "2026-04-30T19:00:00Z", value: 82.4, timezone: "Pacific/Auckland" },
      ],
      activities: [],
    });
    const days = aggregateByDay(normalizePayload(parsed).records);
    expect([...days.keys()]).toEqual(["2026-05-01"]);
  });

  it("falls back to UTC for an unusable timezone rather than dropping the day", () => {
    const parsed = syncPayloadSchema.parse({
      ...envelope,
      device: { label: "Pixel 8", timezone: "Not/AZone" },
      records: [{ metric: "weight", timestamp: "2026-04-30T19:00:00Z", value: 82.4 }],
      activities: [],
    });
    const days = aggregateByDay(normalizePayload(parsed).records);
    expect([...days.keys()]).toEqual(["2026-04-30"]);
  });
});

describe("unpair throttle", () => {
  it("allows the first five attempts per token and blocks the sixth", () => {
    const key = `token-${Math.random()}`;
    for (let i = 0; i < 5; i += 1) expect(rateLimited(key)).toBe(false);
    expect(rateLimited(key)).toBe(true);
  });

  it("tracks tokens independently", () => {
    const a = `token-a-${Math.random()}`;
    const b = `token-b-${Math.random()}`;
    for (let i = 0; i < 6; i += 1) rateLimited(a);
    expect(rateLimited(b)).toBe(false);
  });
});

describe("device sync import job status", () => {
  const VALID_IMPORT_JOB_STATUSES = ["pending", "committing", "completed", "partial", "failed", "rolled_back"];

  it("starts the job in a status the database constraint permits", () => {
    expect(VALID_IMPORT_JOB_STATUSES).toContain(DEVICE_SYNC_INITIAL_JOB_STATUS);
    expect(DEVICE_SYNC_INITIAL_JOB_STATUS).toBe("committing");
  });
});
