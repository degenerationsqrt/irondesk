/**
 * TCX and GPX parsing through a standards-compliant DOM.
 *
 * `@xmldom/xmldom` is used isomorphically so the same code path runs in the
 * browser, in SSR, and in tests. External entities are not resolved by xmldom,
 * so XXE is not reachable; we additionally refuse documents with a DOCTYPE.
 */
import { DOMParser } from "@xmldom/xmldom";

import type { NormalizedActivity, ParseIssue } from "./types";

export class XmlError extends Error {}

function parseXml(text: string): Document {
  if (/<!DOCTYPE/i.test(text.slice(0, 4096))) {
    throw new XmlError("Documents with a DOCTYPE declaration are refused for safety.");
  }
  const errors: string[] = [];
  const doc = new DOMParser({
    onError: (level, msg) => {
      if (level === "error" || level === "fatalError") errors.push(msg);
    },
  }).parseFromString(text, "text/xml") as unknown as Document;
  if (errors.length) throw new XmlError(`Malformed XML: ${errors[0]}`);
  if (!doc?.documentElement) throw new XmlError("The file is not valid XML.");
  return doc;
}

const localName = (tag: string) => tag.replace(/^.*:/, "");

function children(node: Element, name: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < node.childNodes.length; i += 1) {
    const child = node.childNodes[i];
    if (child && child.nodeType === 1 && localName((child as Element).nodeName) === name) out.push(child as Element);
  }
  return out;
}

function descendants(root: Element | Document, name: string): Element[] {
  const all = root.getElementsByTagName("*");
  const out: Element[] = [];
  for (let i = 0; i < all.length; i += 1) {
    const el = all[i]!;
    if (localName(el.nodeName) === name) out.push(el);
  }
  return out;
}

const text = (el: Element | undefined): string | null => (el?.textContent ?? "").trim() || null;
const num = (el: Element | undefined): number | null => {
  const raw = text(el);
  if (raw == null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/** Offset carried by an ISO timestamp, e.g. "+02:00"; null for Z / naive. */
function offsetOf(iso: string | null): string | null {
  if (!iso) return null;
  const match = /([+-]\d{2}:\d{2})$/.exec(iso.trim());
  return match ? `UTC${match[1]}` : null;
}

function toIso(raw: string | null, issues: ParseIssue[], label: string): string | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) {
    issues.push({ severity: "warning", message: `${label}: unreadable timestamp "${raw}".` });
    return null;
  }
  return new Date(ms).toISOString();
}

/** Garmin TCX `Sport` attribute → IronDesk activity type. */
const SPORT_MAP: Record<string, string> = {
  running: "run",
  biking: "ride",
  cycling: "ride",
  swimming: "swim",
  walking: "walk",
  other: "other",
};

export interface XmlParseOutput {
  records: NormalizedActivity[];
  issues: ParseIssue[];
  skippedFields: string[];
  notes: string[];
}

/* ---------------------------------- TCX ----------------------------------- */

export function parseTcx(source: string): XmlParseOutput {
  const doc = parseXml(source);
  const issues: ParseIssue[] = [];
  const activities = descendants(doc, "Activity");
  if (!activities.length) throw new XmlError("No <Activity> elements found — this does not look like a TCX file.");

  const records: NormalizedActivity[] = [];
  for (const activity of activities) {
    const sport = (activity.getAttribute("Sport") ?? "Other").toLowerCase();
    const idRaw = text(children(activity, "Id")[0]);
    const startedAt = toIso(idRaw, issues, "TCX activity");
    if (!startedAt) {
      issues.push({ severity: "error", message: "Activity skipped: missing or invalid <Id> start time." });
      continue;
    }

    const laps = children(activity, "Lap");
    let durationSec = 0;
    let distanceM = 0;
    let calories = 0;
    let maxHr = 0;
    const hrWeighted: { hr: number; sec: number }[] = [];

    for (const lap of laps) {
      const sec = num(children(lap, "TotalTimeSeconds")[0]) ?? 0;
      durationSec += sec;
      distanceM += num(children(lap, "DistanceMeters")[0]) ?? 0;
      calories += num(children(lap, "Calories")[0]) ?? 0;
      const avg = num(children(children(lap, "AverageHeartRateBpm")[0] ?? lap, "Value")[0]);
      const max = num(children(children(lap, "MaximumHeartRateBpm")[0] ?? lap, "Value")[0]);
      if (avg) hrWeighted.push({ hr: avg, sec: sec || 1 });
      if (max) maxHr = Math.max(maxHr, max);
    }

    const totalSec = hrWeighted.reduce((a, b) => a + b.sec, 0);
    const avgHr = totalSec ? Math.round(hrWeighted.reduce((a, b) => a + b.hr * b.sec, 0) / totalSec) : null;
    const trackpoints = descendants(activity, "Trackpoint").length;

    records.push({
      kind: "activity",
      externalId: idRaw,
      activityType: SPORT_MAP[sport] ?? "other",
      name: null,
      startedAt,
      sourceTimezone: offsetOf(idRaw),
      durationSec: durationSec ? Math.round(durationSec) : null,
      distanceM: distanceM ? Math.round(distanceM) : null,
      calories: calories ? Math.round(calories) : null,
      avgHr,
      maxHr: maxHr || null,
      elevationGainM: null,
      steps: null,
      notes: null,
      raw: { sport, laps: laps.length, trackpoints, format: "tcx" },
    });
  }

  if (!records.length) throw new XmlError("Every activity in this TCX file was unreadable.");
  return {
    records,
    issues,
    skippedFields: ["Trackpoint samples (position, cadence, per-second HR)", "Extensions (TPX/LX vendor data)"],
    notes: ["Per-second track samples are counted but not stored; IronDesk keeps activity-level summaries."],
  };
}

/* ---------------------------------- GPX ----------------------------------- */

const R = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function parseGpx(source: string): XmlParseOutput {
  const doc = parseXml(source);
  const issues: ParseIssue[] = [];
  if (localName(doc.documentElement.nodeName) !== "gpx") {
    throw new XmlError("Root element is not <gpx>.");
  }
  const tracks = descendants(doc, "trk");
  if (!tracks.length) throw new XmlError("No <trk> elements found — nothing to import.");

  const records: NormalizedActivity[] = [];
  for (const track of tracks) {
    const name = text(children(track, "name")[0]);
    const type = (text(children(track, "type")[0]) ?? "other").toLowerCase();
    const points = descendants(track, "trkpt");

    let distanceM = 0;
    let gain = 0;
    let prev: { lat: number; lon: number } | null = null;
    let prevEle: number | null = null;
    const times: number[] = [];
    const hrs: number[] = [];

    for (const point of points) {
      const lat = Number(point.getAttribute("lat"));
      const lon = Number(point.getAttribute("lon"));
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        if (prev) distanceM += haversine(prev, { lat, lon });
        prev = { lat, lon };
      }
      const ele = num(children(point, "ele")[0]);
      if (ele != null) {
        if (prevEle != null && ele > prevEle) gain += ele - prevEle;
        prevEle = ele;
      }
      const when = text(children(point, "time")[0]);
      if (when) {
        const ms = Date.parse(when);
        if (Number.isFinite(ms)) times.push(ms);
      }
      for (const hr of descendants(point, "hr")) {
        const value = num(hr);
        if (value) hrs.push(value);
      }
    }

    if (!times.length) {
      issues.push({ severity: "error", message: `Track "${name ?? "unnamed"}" skipped: no timestamps.` });
      continue;
    }
    const startMs = Math.min(...times);
    const endMs = Math.max(...times);
    const firstTime = text(children(points[0]!, "time")[0]);

    records.push({
      kind: "activity",
      externalId: null,
      activityType: SPORT_MAP[type] ?? (type === "other" ? "other" : type),
      name,
      startedAt: new Date(startMs).toISOString(),
      sourceTimezone: offsetOf(firstTime),
      durationSec: Math.round((endMs - startMs) / 1000) || null,
      distanceM: distanceM ? Math.round(distanceM) : null,
      calories: null,
      avgHr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
      maxHr: hrs.length ? Math.max(...hrs) : null,
      elevationGainM: gain ? Math.round(gain) : null,
      steps: null,
      notes: null,
      raw: { trackpoints: points.length, format: "gpx", type },
    });
  }

  if (!records.length) throw new XmlError("Every track in this GPX file was unreadable.");
  return {
    records,
    issues,
    skippedFields: ["Individual track points (lat/lon/elevation/time)", "Waypoints and routes"],
    notes: [
      "Distance is computed from track geometry with the haversine formula; duration is first-to-last timestamp.",
      "GPX carries no calorie field, so calories stay empty rather than being estimated.",
    ],
  };
}
