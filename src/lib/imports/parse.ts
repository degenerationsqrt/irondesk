/**
 * Upload dispatcher.
 *
 * Validation order is deliberate: extension → declared MIME → size → magic
 * bytes → format parser. Uploaded content is only ever read as data; nothing is
 * evaluated, and no network request is made with it.
 */
import { CsvError, parseCsv } from "./csv";
import { FitError, parseFit } from "./fit";
import { HealthConnectPayloadError, parseHealthConnectEnvelope } from "./health-connect-payload";
import { JsonError, parseJsonTable } from "./json";
import {
  ambiguousEssentialMappingFields,
  applyMapping,
  guessMapping,
  mappingIsUsable,
} from "./mapping";
import {
  LIMITS,
  SUPPORTED_EXTENSIONS,
  type FileFormat,
  type ImportMapping,
  type ParseIssue,
  type ParseResult,
} from "./types";
import { XmlError, parseGpx, parseTcx } from "./xml";
import { ZipError, readZip } from "./zip";

export class UploadError extends Error {}

const ALLOWED_MIME = new Set([
  "",
  "application/octet-stream",
  "application/vnd.ant.fit",
  "application/fit",
  "application/xml",
  "text/xml",
  "application/gpx+xml",
  "application/vnd.garmin.tcx+xml",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/json",
  "text/json",
  "application/zip",
  "application/x-zip-compressed",
  "multipart/x-zip",
]);

export function formatOf(fileName: string): FileFormat {
  const lower = fileName.toLowerCase();
  for (const [format, extensions] of Object.entries(SUPPORTED_EXTENSIONS)) {
    if (extensions.some((extension) => lower.endsWith(extension))) return format as FileFormat;
  }
  throw new UploadError(
    `"${fileName}" is not a supported file. IronDesk accepts .fit, .tcx, .gpx, .csv, .json and .zip.`,
  );
}

export function validateUpload(file: { name: string; size: number; type?: string }): FileFormat {
  const format = formatOf(file.name);
  if (file.type && !ALLOWED_MIME.has(file.type.toLowerCase())) {
    throw new UploadError(`"${file.name}" reports an unexpected content type (${file.type}).`);
  }
  if (file.size <= 0) throw new UploadError(`"${file.name}" is empty.`);
  if (file.size > LIMITS.maxFileBytes) {
    throw new UploadError(
      `"${file.name}" is larger than ${Math.round(LIMITS.maxFileBytes / 1024 / 1024)} MB.`,
    );
  }
  return format;
}

/** Prevents a selected import source from silently accepting another source's format. */
export function assertAllowedFormat(
  format: FileFormat,
  allowedFormats: readonly FileFormat[],
  sourceLabel = "This import source",
): void {
  if (allowedFormats.includes(format)) return;
  const accepted = allowedFormats.map((candidate) => `.${candidate}`).join(", ");
  throw new UploadError(
    `${sourceLabel} accepts ${accepted}. Choose the matching source before importing this file.`,
  );
}

const decodeText = (bytes: Uint8Array): string =>
  new TextDecoder("utf-8", { fatal: false }).decode(bytes);

/** Cheap magic-byte sanity check so a mislabelled file fails early and clearly. */
function checkMagic(format: FileFormat, bytes: Uint8Array): void {
  const startsWith = (...codes: number[]) => codes.every((code, i) => bytes[i] === code);
  if (format === "zip" && !startsWith(0x50, 0x4b))
    throw new UploadError("This file is not a real ZIP archive.");
  if (format === "fit") {
    // FIT header: byte 8..11 spell ".FIT".
    const tag = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
    if (tag !== ".FIT")
      throw new UploadError("This file is not a real FIT file (missing .FIT header tag).");
  }
  if ((format === "tcx" || format === "gpx") && !decodeText(bytes.subarray(0, 512)).includes("<")) {
    throw new UploadError("This file does not contain XML.");
  }
}

function tabular(
  format: "csv" | "json",
  bytes: Uint8Array,
  mapping: ImportMapping | undefined,
): ParseResult {
  const text = decodeText(bytes);
  if (format === "json") {
    const companion = parseHealthConnectEnvelope(text);
    if (companion) {
      return {
        format,
        detectedSourceType: "health_connect",
        recognized: true,
        records: companion.records.slice(0, LIMITS.maxRecords),
        issues: companion.issues,
        skippedFields: [],
        notes: [
          "Companion archive recognized. This file stores activity and health evidence only; it does not populate Recovery or Body Metrics. Use live companion sync for those derived views.",
        ],
      };
    }
  }

  const table = format === "csv" ? parseCsv(text) : parseJsonTable(text);
  const resolved = guessMapping(table.headers, mapping);
  const usable = mappingIsUsable(resolved);
  const ambiguousFields = mapping ? [] : ambiguousEssentialMappingFields(table.headers, resolved);
  const ambiguousLabels = ambiguousFields.map((field) =>
    field === "startedAt" ? "start time" : field === "recordedAt" ? "timestamp" : "value",
  );
  if (!usable || ambiguousFields.length > 0) {
    return {
      format,
      recognized: false,
      records: [],
      issues: [
        {
          severity: "warning",
          message: ambiguousFields.length
            ? `More than one column could supply ${ambiguousLabels.join(" and ")} — choose the intended mapping below before importing.`
            : "The columns in this file were not recognized — map them below before importing.",
        },
      ],
      skippedFields: table.headers,
      table,
      notes: [],
    };
  }
  const mapped = applyMapping(table, resolved);
  return {
    format,
    recognized: true,
    records: mapped.records.slice(0, LIMITS.maxRecords),
    issues: mapped.issues,
    skippedFields: mapped.skippedFields,
    table,
    notes:
      mapped.records.length > LIMITS.maxRecords
        ? [`Only the first ${LIMITS.maxRecords} records are imported.`]
        : [],
  };
}

/**
 * Generic tabular files need an explicit mapping pass only when their essential
 * fields are unknown. Recognized files go straight to the normalized preview,
 * where skipped metadata is disclosed and the mapping remains editable.
 * Standards-based FIT/TCX/GPX imports do not carry a mapping table.
 */
export function needsFieldMappingReview(
  result: Pick<ParseResult, "recognized" | "table">,
): boolean {
  return Boolean(result.table) && !result.recognized;
}

async function parseSingle(
  name: string,
  bytes: Uint8Array,
  mapping?: ImportMapping,
  allowedFormats?: readonly FileFormat[],
): Promise<ParseResult> {
  const format = formatOf(name);
  if (allowedFormats) assertAllowedFormat(format, allowedFormats);
  checkMagic(format, bytes);
  try {
    switch (format) {
      case "tcx": {
        const out = parseTcx(decodeText(bytes));
        return {
          format,
          recognized: true,
          records: out.records,
          issues: out.issues,
          skippedFields: out.skippedFields,
          notes: out.notes,
        };
      }
      case "gpx": {
        const out = parseGpx(decodeText(bytes));
        return {
          format,
          recognized: true,
          records: out.records,
          issues: out.issues,
          skippedFields: out.skippedFields,
          notes: out.notes,
        };
      }
      case "fit": {
        const out = parseFit(bytes);
        return {
          format,
          recognized: true,
          records: out.records,
          issues: out.issues,
          skippedFields: out.skippedFields,
          notes: out.notes,
        };
      }
      case "csv":
      case "json":
        return tabular(format, bytes, mapping);
      case "zip":
        throw new UploadError("Nested archives are not supported.");
    }
  } catch (error) {
    if (
      error instanceof XmlError ||
      error instanceof CsvError ||
      error instanceof JsonError ||
      error instanceof FitError ||
      error instanceof ZipError ||
      error instanceof HealthConnectPayloadError ||
      error instanceof UploadError
    ) {
      throw new UploadError(error.message);
    }
    throw new UploadError(error instanceof Error ? error.message : "The file could not be read.");
  }
}

/** Parses an upload, expanding a ZIP container when needed. */
export async function parseUpload(
  name: string,
  bytes: Uint8Array,
  mapping?: ImportMapping,
  allowedFormats?: readonly FileFormat[],
): Promise<ParseResult> {
  const format = formatOf(name);
  if (allowedFormats) assertAllowedFormat(format, allowedFormats);
  checkMagic(format, bytes);
  if (format !== "zip") return parseSingle(name, bytes, mapping, allowedFormats);

  const entries = await readZip(bytes);
  const supported = entries.filter((entry) => {
    try {
      const entryFormat = formatOf(entry.name);
      return entryFormat !== "zip" && (!allowedFormats || allowedFormats.includes(entryFormat));
    } catch {
      return false;
    }
  });

  const issues: ParseIssue[] = entries
    .filter((entry) => !supported.includes(entry))
    .map((entry) => ({
      severity: "warning" as const,
      message: `Skipped "${entry.name}" — unsupported file type inside the archive.`,
    }));

  if (!supported.length) throw new UploadError("The archive contains no supported files.");

  const result: ParseResult = {
    format: "zip",
    recognized: true,
    records: [],
    issues,
    skippedFields: [],
    archiveEntries: entries.map((entry) => entry.name),
    notes: [],
  };

  for (const entry of supported) {
    try {
      const parsed = await parseSingle(entry.name, entry.bytes, mapping, allowedFormats);
      if (!parsed.recognized) {
        result.issues.push({
          severity: "warning",
          message: `"${entry.name}" needs field mapping and was skipped in this archive import.`,
        });
        continue;
      }
      result.records.push(...parsed.records);
      if (!result.detectedSourceType && parsed.detectedSourceType) {
        result.detectedSourceType = parsed.detectedSourceType;
      }
      result.issues.push(
        ...parsed.issues.map((issue) => ({ ...issue, message: `${entry.name}: ${issue.message}` })),
      );
      for (const field of parsed.skippedFields)
        if (!result.skippedFields.includes(field)) result.skippedFields.push(field);
      for (const note of parsed.notes) if (!result.notes.includes(note)) result.notes.push(note);
    } catch (error) {
      result.issues.push({
        severity: "error",
        message: `"${entry.name}": ${error instanceof Error ? error.message : "unreadable"}`,
      });
    }
  }

  if (!result.records.length)
    throw new UploadError("Nothing in the archive could be imported. See the errors listed above.");
  result.records = result.records.slice(0, LIMITS.maxRecords);
  return result;
}
