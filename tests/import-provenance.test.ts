import { describe, expect, it } from "vitest";

import {
  healthProviderLabel,
  healthSourcePackage,
  importStatusLabel,
  importedSourceLabel,
  isHealthConnectDeviceSyncJob,
  presentImportedRecord,
} from "@/lib/imports/provenance";

describe("Health Connect provenance labels", () => {
  it.each([
    ["com.sec.android.app.shealth", "Samsung Health"],
    ["com.garmin.android.apps.connectmobile", "Garmin Connect"],
    ["com.fitbit.FitbitMobile", "Fitbit"],
    ["com.google.android.apps.fitness", "Google Fit"],
  ])("maps the evidenced package %s to %s", (sourcePackage, expected) => {
    const raw = { source_package: sourcePackage };
    expect(healthSourcePackage(raw)).toBe(sourcePackage);
    expect(healthProviderLabel(raw)).toBe(expected);
    expect(importedSourceLabel("health_connect", raw)).toBe(`${expected} via Health Connect`);
  });

  it("keeps an unknown package visible without inventing a provider", () => {
    const presentation = presentImportedRecord({
      sourceType: "health_connect",
      sourceFileName: "device:Pixel 8",
      rawMetadata: { source_package: "app.example.health" },
      importedAt: "2026-08-29T15:00:00.000Z",
      jobStatus: "completed",
    });

    expect(healthProviderLabel({ source_package: "app.example.health" })).toBeNull();
    expect(presentation).toMatchObject({
      sourceLabel: "Health Connect",
      detailLabel: "app.example.health · Pixel 8",
      statusLabel: "Imported",
      statusAt: "2026-08-29T15:00:00.000Z",
    });
  });

  it("does not infer a provider when metadata is absent or malformed", () => {
    expect(healthProviderLabel(null)).toBeNull();
    expect(healthProviderLabel("com.samsung.health")).toBeNull();
    expect(importedSourceLabel("health_connect", {})).toBe("Health Connect");
    expect(importedSourceLabel("garmin_file", {})).toBe("Garmin file");
    expect(importedSourceLabel("generic_file", {})).toBe("File import");
  });
});

describe("import job presentation", () => {
  it("distinguishes live Health Connect device-sync audit jobs from rollback-capable files", () => {
    expect(
      isHealthConnectDeviceSyncJob({ sourceType: "health_connect", dataSourceId: "source-1" }),
    ).toBe(true);
    expect(isHealthConnectDeviceSyncJob({ sourceType: "health_connect", dataSourceId: null })).toBe(
      false,
    );
    expect(
      isHealthConnectDeviceSyncJob({ sourceType: "generic_file", dataSourceId: "source-1" }),
    ).toBe(false);
  });

  it.each([
    ["pending", "Pending"],
    ["committing", "Importing"],
    ["completed", "Imported"],
    ["partial", "Partially imported"],
    ["failed", "Import failed"],
    ["rolled_back", "Rolled back"],
  ])("presents %s as %s", (status, expected) => {
    expect(importStatusLabel(status)).toBe(expected);
  });

  it("prefers the job completion time and retains the job error", () => {
    expect(
      presentImportedRecord({
        sourceType: "generic_file",
        sourceFileName: "metrics.csv",
        importedAt: "2026-08-29T15:00:00.000Z",
        jobStatus: "failed",
        jobFinishedAt: "2026-08-29T15:01:00.000Z",
        errorMessage: "A later chunk failed.",
      }),
    ).toMatchObject({
      sourceLabel: "File import",
      detailLabel: "metrics.csv",
      statusLabel: "Import failed",
      statusAt: "2026-08-29T15:01:00.000Z",
      errorMessage: "A later chunk failed.",
    });
  });
});
