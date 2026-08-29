/** Pure presentation helpers for imported-record provenance and job state. */

function objectOf(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Exact package id supplied by Health Connect, or null when none was supplied. */
export function healthSourcePackage(rawMetadata: unknown): string | null {
  return textOf(objectOf(rawMetadata)?.["source_package"]);
}

/** Friendly provider name only when the package id is sufficient evidence. */
export function healthProviderLabel(rawMetadata: unknown): string | null {
  const packageName = healthSourcePackage(rawMetadata)?.toLowerCase();
  if (!packageName) return null;
  if (packageName.includes("shealth") || packageName.includes("samsung")) return "Samsung Health";
  if (packageName.includes("garmin")) return "Garmin Connect";
  if (packageName.includes("fitbit")) return "Fitbit";
  if (packageName.includes("google") && packageName.includes("fitness")) return "Google Fit";
  return null;
}

function titleCaseSource(sourceType: string): string {
  return sourceType.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function importedSourceLabel(sourceType: string, rawMetadata: unknown): string {
  const provider = healthProviderLabel(rawMetadata);
  if (sourceType === "health_connect")
    return provider ? `${provider} via Health Connect` : "Health Connect";
  if (sourceType === "garmin_file") return "Garmin file";
  if (sourceType === "generic_file") return "File import";
  return titleCaseSource(sourceType);
}

export function importStatusLabel(status?: string | null): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "committing":
      return "Importing";
    case "partial":
      return "Partially imported";
    case "failed":
      return "Import failed";
    case "rolled_back":
      return "Rolled back";
    case "completed":
    case null:
    case undefined:
      return "Imported";
    default:
      return titleCaseSource(status);
  }
}

export function isHealthConnectDeviceSyncJob(job: {
  sourceType: string;
  dataSourceId?: string | null;
}): boolean {
  return job.sourceType === "health_connect" && Boolean(job.dataSourceId?.trim());
}

function sourceFileDetail(sourceFileName?: string | null): string | null {
  const value = sourceFileName?.trim();
  if (!value) return null;
  return value.startsWith("device:") ? value.slice("device:".length).trim() || null : value;
}

export interface ImportPresentationInput {
  sourceType: string;
  sourceFileName?: string | null;
  rawMetadata?: unknown;
  importedAt?: string | null;
  jobStatus?: string | null;
  jobFinishedAt?: string | null;
  errorMessage?: string | null;
}

export interface ImportPresentation {
  sourceLabel: string;
  /** Device/file detail and exact unknown package evidence, when available. */
  detailLabel: string | null;
  statusLabel: string;
  statusAt: string | null;
  errorMessage: string | null;
}

export function presentImportedRecord(input: ImportPresentationInput): ImportPresentation {
  const packageName = healthSourcePackage(input.rawMetadata);
  const provider = healthProviderLabel(input.rawMetadata);
  const detail = [!provider ? packageName : null, sourceFileDetail(input.sourceFileName)]
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(" · ");

  return {
    sourceLabel: importedSourceLabel(input.sourceType, input.rawMetadata),
    detailLabel: detail || null,
    statusLabel: importStatusLabel(input.jobStatus),
    statusAt: input.jobFinishedAt ?? input.importedAt ?? null,
    errorMessage: input.errorMessage?.trim() || null,
  };
}
