/** RFC 4180 CSV reader: quoted fields, escaped quotes, CRLF, BOM, blank rows. */
import { LIMITS, type TabularPreview } from "./types";

export class CsvError extends Error {}

export function parseCsv(text: string): TabularPreview {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  let touched = false;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip lines that are entirely empty (trailing newline, stray CRLF).
    if (!(row.length === 1 && row[0]!.trim() === "")) rows.push(row);
    row = [];
    if (rows.length > LIMITS.maxTableRows) throw new CsvError(`File exceeds ${LIMITS.maxTableRows} rows.`);
  };

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (field.length && field.trim() !== "") throw new CsvError("Quote found in the middle of an unquoted field.");
      quoted = true;
      touched = true;
      continue;
    }
    if (ch === ",") {
      endField();
      touched = true;
      continue;
    }
    if (ch === "\n") {
      endRow();
      touched = true;
      continue;
    }
    if (ch === "\r") continue;
    field += ch;
    touched = true;
  }
  if (quoted) throw new CsvError("Unterminated quoted field — the file is malformed.");
  if (field.length || row.length) endRow();

  if (!touched || rows.length === 0) throw new CsvError("The file contains no rows.");
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  if (headers.every((h) => h === "")) throw new CsvError("The first row contains no column names.");

  const width = headers.length;
  const normalized = rows.map((r) => {
    const copy = r.slice(0, width);
    while (copy.length < width) copy.push("");
    return copy;
  });

  return { headers, rows: normalized };
}
