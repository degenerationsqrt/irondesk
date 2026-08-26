/**
 * Dedupe keys.
 *
 * Preference order:
 *  1. the provider's own id  → `ext:<source>:<externalId>`
 *  2. a stable content fingerprint over the normalized fields that identify a
 *     record (type, instant, duration, distance / value)
 *
 * The database enforces `unique (user_id, dedupe_hash)`, so a re-uploaded file
 * can never double count, and two genuinely different records can never
 * collide on rounding alone (the instant is kept to the second).
 */
import type { NormalizedRecord, SourceType } from "./types";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fingerprint(record: NormalizedRecord): string {
  if (record.kind === "activity") {
    return [
      "activity",
      record.activityType,
      record.startedAt,
      record.durationSec ?? "",
      record.distanceM ?? "",
      record.calories ?? "",
    ].join("|");
  }
  return ["metric", record.metricType, record.recordedAt, record.value, record.unit].join("|");
}

export async function dedupeHash(record: NormalizedRecord, source: SourceType): Promise<string> {
  if (record.externalId) return `ext:${source}:${record.externalId}`;
  return `sha:${await sha256Hex(`${source}|${fingerprint(record)}`)}`;
}

export async function withHashes(
  records: NormalizedRecord[],
  source: SourceType,
): Promise<{ record: NormalizedRecord; hash: string }[]> {
  const hashed = await Promise.all(records.map(async (record) => ({ record, hash: await dedupeHash(record, source) })));
  // Collapse duplicates inside a single file so counts stay honest.
  const seen = new Set<string>();
  return hashed.filter(({ hash }) => (seen.has(hash) ? false : (seen.add(hash), true)));
}
