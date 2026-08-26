/**
 * Typed JSON reader.
 *
 * Any JSON shape is flattened to a header/row table so the same mapping wizard,
 * preview and dedupe path serves JSON and CSV. Nested objects are flattened
 * with dotted keys; arrays of scalars are joined; deeper arrays of objects are
 * reported as skipped rather than guessed at.
 */
import { LIMITS, type TabularPreview } from "./types";

export class JsonError extends Error {}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const CONTAINER_KEYS = ["records", "data", "items", "activities", "sessions", "exercise_sessions", "metrics", "results"];

/** Finds the array of record objects inside an arbitrary JSON document. */
export function extractRows(input: Json): { rows: Record<string, Json>[]; container: string | null } {
  if (Array.isArray(input)) return { rows: objectsOnly(input), container: null };
  if (input && typeof input === "object") {
    for (const key of CONTAINER_KEYS) {
      const value = (input as Record<string, Json>)[key];
      if (Array.isArray(value)) return { rows: objectsOnly(value), container: key };
    }
    // Single record document.
    return { rows: objectsOnly([input]), container: null };
  }
  throw new JsonError("The JSON file does not contain any records.");
}

function objectsOnly(items: Json[]): Record<string, Json>[] {
  const rows = items.filter((item): item is Record<string, Json> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!rows.length) throw new JsonError("The JSON file contains no objects to import.");
  if (rows.length > LIMITS.maxTableRows) throw new JsonError(`File exceeds ${LIMITS.maxTableRows} records.`);
  return rows;
}

function flatten(value: Json, prefix: string, out: Record<string, string>, depth = 0): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== "object")) {
      out[prefix] = value.join(", ");
    }
    return;
  }
  if (typeof value === "object") {
    if (depth >= 4) return;
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out, depth + 1);
    }
    return;
  }
  out[prefix] = String(value);
}

export function parseJsonTable(text: string): TabularPreview & { container: string | null } {
  let parsed: Json;
  try {
    parsed = JSON.parse(text) as Json;
  } catch (error) {
    throw new JsonError(`Malformed JSON: ${error instanceof Error ? error.message : "could not be parsed"}.`);
  }

  const { rows, container } = extractRows(parsed);
  const flat = rows.map((row) => {
    const target: Record<string, string> = {};
    flatten(row, "", target);
    return target;
  });

  const headers: string[] = [];
  for (const row of flat) for (const key of Object.keys(row)) if (!headers.includes(key)) headers.push(key);
  if (!headers.length) throw new JsonError("The JSON records contain no readable fields.");

  return {
    headers,
    rows: flat.map((row) => headers.map((header) => row[header] ?? "")),
    container,
  };
}
