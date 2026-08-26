/**
 * Import-pipeline tests.
 *
 * Every fixture here is synthetic and written inline — no third-party export
 * file is used, and nothing in these tests touches the network or the database.
 */
import { describe, expect, it } from "vitest";

import { parseCsv } from "../src/lib/imports/csv";
import { dedupeHash, withHashes } from "../src/lib/imports/dedupe";
import { sessionsToTcx } from "../src/lib/imports/export";
import { parseJsonTable } from "../src/lib/imports/json";
import { applyMapping, guessMapping, mappingIsUsable } from "../src/lib/imports/mapping";
import { UploadError, formatOf, parseUpload, validateUpload } from "../src/lib/imports/parse";
import { parseGpx, parseTcx } from "../src/lib/imports/xml";
import type { NormalizedActivity, NormalizedMetric } from "../src/lib/imports/types";
import { readZip } from "../src/lib/imports/zip";

const enc = (text: string) => new TextEncoder().encode(text);

/* ----------------------------- fixtures ----------------------------------- */

const CSV_ACTIVITIES = [
  "id,start_time,activity_type,duration_min,distance_km,calories,average_heart_rate",
  "a1,2026-05-01T06:30:00Z,run,42,8.2,540,151",
  'a2,2026-05-02T06:30:00Z,"strength, upper",55,,410,118',
  "a3,not-a-date,run,30,5,300,140",
  "",
].join("\n");

const CSV_UNKNOWN = ["session_ref,when_local,kind,mins,km", "x1,2026-05-01 06:30:00,ride,90,34.5"].join("\n");

const JSON_METRICS = JSON.stringify({
  records: [
    { external_id: "s1", metric: "steps", timestamp: "2026-05-01T00:00:00Z", value: 11423 },
    { external_id: "s2", metric: "resting_heart_rate", timestamp: "2026-05-01T05:00:00Z", value: 48 },
  ],
});

const TCX = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-05-01T06:30:00Z</Id>
      <Lap StartTime="2026-05-01T06:30:00Z">
        <TotalTimeSeconds>2520</TotalTimeSeconds>
        <DistanceMeters>8200</DistanceMeters>
        <Calories>540</Calories>
        <AverageHeartRateBpm><Value>151</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>172</Value></MaximumHeartRateBpm>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="synthetic" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Morning ride</name><trkseg>
    <trkpt lat="47.6062" lon="-122.3321"><ele>10</ele><time>2026-05-01T06:30:00Z</time></trkpt>
    <trkpt lat="47.6162" lon="-122.3321"><ele>30</ele><time>2026-05-01T06:40:00Z</time></trkpt>
    <trkpt lat="47.6262" lon="-122.3321"><ele>25</ele><time>2026-05-01T06:50:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

const XXE = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><gpx><trk/></gpx>`;

/* ------------------------------- ZIP builder ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/** Builds a minimal STORED-entry ZIP so archive handling can be tested offline. */
function buildZip(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const chunks: number[] = [];
  const central: number[] = [];
  const push = (target: number[], ...bytes: number[]) => target.push(...bytes);
  const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

  for (const entry of entries) {
    const nameBytes = Array.from(enc(entry.name));
    const crc = crc32(entry.data);
    const offset = chunks.length;
    push(chunks, ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc));
    push(chunks, ...u32(entry.data.length), ...u32(entry.data.length), ...u16(nameBytes.length), ...u16(0));
    push(chunks, ...nameBytes, ...Array.from(entry.data));
    push(central, ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc));
    push(central, ...u32(entry.data.length), ...u32(entry.data.length), ...u16(nameBytes.length));
    push(central, ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...nameBytes);
  }

  const centralOffset = chunks.length;
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(central.length),
    ...u32(centralOffset),
    ...u16(0),
  ];
  return new Uint8Array([...chunks, ...central, ...end]);
}

/* --------------------------------- tests ---------------------------------- */

describe("CSV parsing", () => {
  it("handles quoted commas, blank lines and a BOM", () => {
    const table = parseCsv(`\uFEFF${CSV_ACTIVITIES}`);
    expect(table.headers[0]).toBe("id");
    expect(table.rows).toHaveLength(3);
    expect(table.rows[1]?.[2]).toBe("strength, upper");
  });

  it("rejects unterminated quotes", () => {
    expect(() => parseCsv('a,b\n"unclosed,1')).toThrow();
  });
});

describe("field mapping", () => {
  it("recognizes common activity headers and converts units", () => {
    const table = parseCsv(CSV_ACTIVITIES);
    const mapping = guessMapping(table.headers);
    expect(mapping.recordKind).toBe("activity");
    expect(mappingIsUsable(mapping)).toBe(true);
    expect(mapping.durationUnit).toBe("minutes");
    expect(mapping.distanceUnit).toBe("km");

    const mapped = applyMapping(table, mapping);
    expect(mapped.records).toHaveLength(2); // the bad timestamp row is skipped
    const first = mapped.records[0] as NormalizedActivity;
    expect(first.durationSec).toBe(2520);
    expect(first.distanceM).toBe(8200);
    expect(first.avgHr).toBe(151);
    expect(mapped.issues.some((issue) => issue.severity === "error" && issue.row === 4)).toBe(true);
  });

  it("leaves genuinely unknown columns unmapped so the wizard opens", () => {
    const table = parseCsv(CSV_UNKNOWN);
    const mapping = guessMapping(table.headers);
    expect(mappingIsUsable(mapping)).toBe(false);
  });

  it("imports a hand-assigned mapping and flags naive timestamps", () => {
    const table = parseCsv(CSV_UNKNOWN);
    const mapped = applyMapping(table, {
      recordKind: "activity",
      fields: { externalId: "session_ref", startedAt: "when_local", activityType: "kind", duration: "mins", distance: "km" },
      durationUnit: "minutes",
      distanceUnit: "km",
      weightUnit: "kg",
      fixedMetricType: "steps",
    });
    const record = mapped.records[0] as NormalizedActivity;
    expect(record.durationSec).toBe(5400);
    expect(record.distanceM).toBe(34500);
    expect(mapped.issues.some((issue) => issue.severity === "warning")).toBe(true);
  });

  it("converts pounds to canonical kilograms", () => {
    const table = parseCsv("date,value\n2026-05-01T00:00:00Z,200");
    const mapped = applyMapping(table, {
      recordKind: "metric",
      fields: { recordedAt: "date", value: "value" },
      durationUnit: "seconds",
      distanceUnit: "m",
      weightUnit: "lb",
      fixedMetricType: "bodyweight_kg",
    });
    const metric = mapped.records[0] as NormalizedMetric;
    expect(metric.unit).toBe("kg");
    expect(metric.value).toBeCloseTo(90.72, 1);
  });
});

describe("JSON parsing", () => {
  it("flattens a container object into rows", () => {
    const table = parseJsonTable(JSON_METRICS);
    expect(table.container).toBe("records");
    expect(table.rows).toHaveLength(2);
    const mapping = guessMapping(table.headers);
    const mapped = applyMapping(table, mapping);
    expect(mapped.records).toHaveLength(2);
    expect((mapped.records[0] as NormalizedMetric).metricType).toBe("steps");
    expect((mapped.records[1] as NormalizedMetric).metricType).toBe("resting_hr");
  });

  it("rejects non-object JSON", () => {
    expect(() => parseJsonTable("42")).toThrow();
  });
});

describe("XML parsing", () => {
  it("reads a TCX activity summary", () => {
    const out = parseTcx(TCX);
    const activity = out.records[0] as NormalizedActivity;
    expect(out.records).toHaveLength(1);
    expect(activity.activityType).toContain("run");
    expect(activity.durationSec).toBe(2520);
    expect(activity.distanceM).toBe(8200);
    expect(activity.calories).toBe(540);
    expect(activity.maxHr).toBe(172);
  });

  it("reads a GPX track and derives duration and distance", () => {
    const out = parseGpx(GPX);
    const activity = out.records[0] as NormalizedActivity;
    expect(activity.name).toBe("Morning ride");
    expect(activity.durationSec).toBe(1200);
    expect(activity.distanceM).toBeGreaterThan(2000);
    expect(activity.calories).toBeNull(); // GPX carries no energy field
  });

  it("refuses a DOCTYPE (no external entity expansion)", () => {
    expect(() => parseGpx(XXE)).toThrow();
  });
});

describe("upload validation", () => {
  it("accepts only supported extensions", () => {
    expect(formatOf("run.TCX")).toBe("tcx");
    expect(() => formatOf("payload.exe")).toThrow(UploadError);
  });

  it("rejects oversized and empty files", () => {
    expect(() => validateUpload({ name: "a.csv", size: 0 })).toThrow(UploadError);
    expect(() => validateUpload({ name: "a.csv", size: 26 * 1024 * 1024 })).toThrow(UploadError);
    expect(validateUpload({ name: "a.csv", size: 1024, type: "text/csv" })).toBe("csv");
  });

  it("rejects a file whose bytes do not match its extension", async () => {
    await expect(parseUpload("fake.zip", enc("not a zip"))).rejects.toThrow(UploadError);
    await expect(parseUpload("fake.fit", enc("0123456789ab"))).rejects.toThrow(UploadError);
  });
});

describe("archives", () => {
  it("expands supported members and skips the rest", async () => {
    const zip = buildZip([
      { name: "activities.csv", data: enc(CSV_ACTIVITIES) },
      { name: "readme.txt", data: enc("ignore me") },
    ]);
    const result = await parseUpload("export.zip", zip);
    expect(result.format).toBe("zip");
    expect(result.records).toHaveLength(2);
    expect(result.issues.some((issue) => issue.message.includes("readme.txt"))).toBe(true);
  });

  it("refuses path traversal entries", async () => {
    const zip = buildZip([{ name: "../../etc/passwd", data: enc("x") }]);
    await expect(readZip(zip)).rejects.toThrow();
  });
});

describe("dedupe", () => {
  it("prefers the provider id and is stable", async () => {
    const record: NormalizedActivity = {
      kind: "activity",
      externalId: "abc",
      activityType: "run",
      name: null,
      startedAt: "2026-05-01T06:30:00.000Z",
      sourceTimezone: null,
      durationSec: 100,
      distanceM: 1000,
      calories: null,
      avgHr: null,
      maxHr: null,
      elevationGainM: null,
      steps: null,
      notes: null,
      raw: {},
    };
    expect(await dedupeHash(record, "garmin_file")).toBe("ext:garmin_file:abc");
    const anon = { ...record, externalId: null };
    expect(await dedupeHash(anon, "garmin_file")).toBe(await dedupeHash({ ...anon }, "garmin_file"));
    expect(await dedupeHash(anon, "garmin_file")).not.toBe(await dedupeHash({ ...anon, durationSec: 101 }, "garmin_file"));
  });

  it("collapses duplicates inside a single file", async () => {
    const table = parseCsv(CSV_ACTIVITIES);
    const mapped = applyMapping(table, guessMapping(table.headers));
    const hashed = await withHashes([...mapped.records, ...mapped.records], "generic_file");
    expect(hashed).toHaveLength(mapped.records.length);
  });
});

describe("TCX export", () => {
  it("emits well-formed TCX that round-trips through the TCX parser", () => {
    const xml = sessionsToTcx([
      {
        id: "s1",
        title: "Upper Heavy",
        kind: "strength",
        startedAt: "2026-05-01T06:30:00.000Z",
        completedAt: "2026-05-01T07:25:00.000Z",
        durationSec: 3300,
        calories: 410,
        avgHr: 118,
        maxHr: 148,
        distanceM: null,
        notes: "felt strong & sharp",
      },
    ]);
    expect(xml).toContain('Sport="Other"');
    expect(xml).toContain("&amp;");
    const back = parseTcx(xml);
    const activity = back.records[0] as NormalizedActivity;
    expect(activity.durationSec).toBe(3300);
    expect(activity.calories).toBe(410);
  });
});
