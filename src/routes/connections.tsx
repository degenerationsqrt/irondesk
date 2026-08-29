import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { DeviceSyncCard } from "@/components/irondesk/device-sync-card";
import { ImportCard, RollbackButton } from "@/components/irondesk/import-panel";
import { DataRow, SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/auth-provider";
import { downloadFile, sessionsToTcx, type ExportableSession } from "@/lib/imports/export";
import {
  importJobsQuery,
  importKeys,
  importTotalsQuery,
  importedActivitiesQuery,
  importedMetricsQuery,
  savedMappingsQuery,
} from "@/lib/imports/queries";
import {
  importStatusLabel,
  importedSourceLabel,
  isHealthConnectDeviceSyncJob,
  presentImportedRecord,
} from "@/lib/imports/provenance";
import * as importRepo from "@/lib/imports/repo";
import type { FileFormat, SourceType } from "@/lib/imports/types";
import * as repo from "@/lib/irondesk/repo";
import { formatWeight } from "@/lib/irondesk/units";
import { useUnits } from "@/lib/irondesk/use-units";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [
      { title: "Connections & Imports — IronDesk" },
      {
        name: "description",
        content:
          "Sync Health Connect into Recovery and Body Metrics, or preview and archive Garmin, Health Connect and generic files with clear provenance.",
      },
      { property: "og:title", content: "Connections & Imports — IronDesk" },
      {
        property: "og:description",
        content:
          "Live Health Connect sync plus standards-based file evidence with field mapping, previews and file-batch rollback.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConnectionsPage,
});

const fmtDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

interface FileImportChoice {
  sourceType: SourceType;
  label: string;
  eyebrow: string;
  title: string;
  blurb: string;
  formats: string;
  acceptedFormats: readonly FileFormat[];
}

const FILE_IMPORT_CHOICES: readonly FileImportChoice[] = [
  {
    sourceType: "health_connect",
    label: "Health archive",
    eyebrow: "Raw evidence only",
    title: "Health Connect evidence archive",
    blurb:
      "Archive the JSON created by the IronDesk Android companion, or map a CSV/JSON health export. File imports retain activity, metric and source-app evidence but do not populate Recovery or Body Metrics; use live companion sync above for that.",
    formats: ".csv, .json, .zip",
    acceptedFormats: ["csv", "json", "zip"],
  },
  {
    sourceType: "garmin_file",
    label: "Garmin",
    eyebrow: "Garmin activity file",
    title: "Garmin file import",
    blurb:
      "Export an activity from Garmin Connect. Duration, distance, calories and heart rate are read; route geometry is not stored.",
    formats: ".fit, .tcx, .gpx, .zip",
    acceptedFormats: ["fit", "tcx", "gpx", "zip"],
  },
  {
    sourceType: "generic_file",
    label: "Other file",
    eyebrow: "Mapped file",
    title: "Generic file import",
    blurb:
      "Import another CSV or JSON export. Unrecognized columns open the mapping wizard so you decide what each field means.",
    formats: ".csv, .json, .zip",
    acceptedFormats: ["csv", "json", "zip"],
  },
];

function ConnectionsPage() {
  const { mode } = useAuth();
  const live = mode === "live";
  const units = useUnits();
  const queryClient = useQueryClient();
  const [exportState, setExportState] = useState<string | null>(null);
  const [fileSource, setFileSource] = useState<SourceType>("health_connect");
  const selectedImport =
    FILE_IMPORT_CHOICES.find((choice) => choice.sourceType === fileSource) ??
    FILE_IMPORT_CHOICES[0]!;

  const jobs = useQuery({ ...importJobsQuery, enabled: live });
  const totals = useQuery({ ...importTotalsQuery, enabled: live });
  const activities = useQuery({ ...importedActivitiesQuery, enabled: live });
  const metrics = useQuery({ ...importedMetricsQuery, enabled: live });
  const mappings = useQuery({ ...savedMappingsQuery, enabled: live });

  const refresh = () => {
    for (const key of Object.values(importKeys))
      void queryClient.invalidateQueries({ queryKey: key });
  };

  const exportTcx = async () => {
    setExportState("Preparing export…");
    try {
      const history = await repo.getHistory();
      const sessions: ExportableSession[] = history.map((session) => {
        const startedAt = new Date(session.date).toISOString();
        const durationSec = session.durationMin ? session.durationMin * 60 : null;
        return {
          id: session.id,
          title: session.title,
          kind: session.kind,
          startedAt,
          completedAt: durationSec
            ? new Date(Date.parse(startedAt) + durationSec * 1000).toISOString()
            : null,
          durationSec,
          calories: session.calories ?? null,
          avgHr: null,
          maxHr: null,
          distanceM: null,
          notes: null,
        };
      });
      if (!sessions.length) {
        setExportState("No completed sessions to export yet.");
        return;
      }
      downloadFile(
        `irondesk-sessions-${new Date().toISOString().slice(0, 10)}.tcx`,
        sessionsToTcx(sessions),
        "application/vnd.garmin.tcx+xml",
      );
      setExportState(
        `Exported ${sessions.length} session${sessions.length === 1 ? "" : "s"} as TCX.`,
      );
    } catch (error) {
      setExportState(error instanceof Error ? error.message : "The export failed.");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Connections & Imports"
        subtitle="Use live companion sync for Recovery and Body Metrics, or review and archive file evidence before it lands."
      />

      {!live && (
        <SectionCard title="Demo mode" eyebrow="Read-only">
          <p className="text-sm text-muted-foreground">
            Demo mode never writes to a real account. Sign in to import files, keep import history
            and roll batches back.
          </p>
        </SectionCard>
      )}

      {live && (
        <>
          <DeviceSyncCard />

          <SectionCard title="Import or archive a file" eyebrow="Does not run device sync">
            <p className="text-sm text-muted-foreground">
              Choose what created the file, then preview one import below. The selected source
              controls the accepted formats and the provenance saved with each record. Health files
              are evidence archives, not a substitute for live companion sync.
            </p>
            <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="File import source">
              {FILE_IMPORT_CHOICES.map((choice) => (
                <Button
                  key={choice.sourceType}
                  size="sm"
                  variant={fileSource === choice.sourceType ? "default" : "outline"}
                  aria-pressed={fileSource === choice.sourceType}
                  onClick={() => setFileSource(choice.sourceType)}
                >
                  {choice.label}
                </Button>
              ))}
            </div>
          </SectionCard>

          <ImportCard
            key={selectedImport.sourceType}
            sourceType={selectedImport.sourceType}
            eyebrow={selectedImport.eyebrow}
            title={selectedImport.title}
            blurb={selectedImport.blurb}
            formats={selectedImport.formats}
            acceptedFormats={selectedImport.acceptedFormats}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard
              title="Import history"
              eyebrow="Batches"
              action={
                <Button size="sm" variant="ghost" onClick={refresh}>
                  Refresh
                </Button>
              }
            >
              {!jobs.data?.length ? (
                <p className="text-sm text-muted-foreground">
                  No imports yet. File batches can be rolled back; live device-sync entries remain
                  audit history because their derived Recovery and Body Metrics are managed
                  separately.
                </p>
              ) : (
                <ul className="space-y-2">
                  {jobs.data.map((job) => {
                    const deviceSyncJob = isHealthConnectDeviceSyncJob(job);
                    return (
                      <li key={job.id} className="rounded-lg border border-border/70 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {job.fileName ?? "Untitled file"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {fmtDate(job.startedAt)} · {job.fileFormat.toUpperCase()} ·{" "}
                              {importedSourceLabel(job.sourceType, null)} ·{" "}
                              {importStatusLabel(job.status)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {job.importedCount} imported · {job.duplicateCount} duplicates ·{" "}
                              {job.warningCount} warnings · {job.failedCount} skipped
                            </p>
                            {deviceSyncJob && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Device-sync audit entry. Recovery and Body Metrics are managed
                                separately, so this is not offered as a file rollback. Unlink the
                                device above to stop future syncs.
                              </p>
                            )}
                            {job.errorMessage && (
                              <p className="text-xs text-destructive">{job.errorMessage}</p>
                            )}
                          </div>
                          {!deviceSyncJob && <RollbackButton jobId={job.id} onDone={refresh} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>

            <div className="space-y-4">
              <SectionCard title="Imported data" eyebrow="Totals">
                <div>
                  <DataRow label="Activities" value={totals.data?.activities ?? 0} />
                  <DataRow label="Health metrics" value={totals.data?.metrics ?? 0} />
                  <DataRow label="Saved field mappings" value={mappings.data?.length ?? 0} />
                </div>
                {activities.data?.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {activities.data.slice(0, 5).map((activity) => {
                      const provenance = presentImportedRecord({
                        sourceType: activity.sourceType,
                        sourceFileName: activity.sourceFileName,
                        rawMetadata: activity.rawMetadata,
                        importedAt: activity.importedAt,
                        jobStatus: activity.job?.status ?? null,
                        jobFinishedAt: activity.job?.finishedAt ?? null,
                        errorMessage: activity.job?.errorMessage ?? null,
                      });
                      return (
                        <li
                          key={activity.id}
                          className="rounded-md border border-border/60 px-2 py-1.5"
                        >
                          <div className="flex justify-between gap-3">
                            <span className="truncate font-medium text-foreground">
                              {activity.name ?? activity.activityType} ·{" "}
                              {fmtDate(activity.startedAt)}
                            </span>
                            <span className="numeric shrink-0">
                              {activity.durationSec
                                ? `${Math.round(activity.durationSec / 60)} min`
                                : "—"}
                            </span>
                          </div>
                          <p className="truncate">
                            {provenance.sourceLabel} · {provenance.statusLabel}
                            {provenance.statusAt ? ` ${fmtDate(provenance.statusAt)}` : ""}
                          </p>
                          {provenance.detailLabel && (
                            <p className="truncate">{provenance.detailLabel}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {metrics.data?.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {metrics.data.slice(0, 5).map((metric) => {
                      const provenance = presentImportedRecord({
                        sourceType: metric.sourceType,
                        sourceFileName: metric.sourceFileName,
                        rawMetadata: metric.rawMetadata,
                        importedAt: metric.importedAt,
                        jobStatus: metric.job?.status ?? null,
                        jobFinishedAt: metric.job?.finishedAt ?? null,
                        errorMessage: metric.job?.errorMessage ?? null,
                      });
                      const metricLabel =
                        metric.metricType === "bodyweight_kg"
                          ? "Bodyweight"
                          : metric.metricType.replace(/_/g, " ");
                      const metricValue =
                        metric.metricType === "bodyweight_kg"
                          ? formatWeight(metric.value, units)
                          : `${metric.value} ${metric.unit}`;
                      return (
                        <li
                          key={metric.id}
                          className="rounded-md border border-border/60 px-2 py-1.5"
                        >
                          <div className="flex justify-between gap-3">
                            <span className="truncate font-medium text-foreground">
                              {metricLabel} · {fmtDate(metric.recordedAt)}
                            </span>
                            <span className="numeric shrink-0">{metricValue}</span>
                          </div>
                          <p className="truncate">
                            {provenance.sourceLabel} · {provenance.statusLabel}
                            {provenance.statusAt ? ` ${fmtDate(provenance.statusAt)}` : ""}
                          </p>
                          {provenance.detailLabel && (
                            <p className="truncate">{provenance.detailLabel}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </SectionCard>

              <SectionCard title="Export to Garmin" eyebrow="Outbound">
                <p className="text-sm text-muted-foreground">
                  Completed sessions export as standards-compliant TCX v2 — the format Garmin
                  Connect accepts under &ldquo;Import Data&rdquo;. Strength sessions export as one
                  lap with duration, calories and heart rate; no GPS track is fabricated.
                </p>
                <Button size="sm" className="mt-3" onClick={() => void exportTcx()}>
                  <Download className="mr-1.5 size-4" /> Download TCX
                </Button>
                {exportState && <p className="mt-2 text-xs text-muted-foreground">{exportState}</p>}
              </SectionCard>

              {mappings.data?.length ? (
                <SectionCard title="Saved field mappings" eyebrow="Reusable">
                  <ul className="space-y-2">
                    {mappings.data.map((mapping) => (
                      <li
                        key={mapping.id}
                        className="flex items-center justify-between gap-2 text-sm"
                      >
                        <span className="min-w-0 truncate">
                          {mapping.sourceLabel}{" "}
                          <span className="text-xs text-muted-foreground">
                            ({mapping.fileFormat} · {mapping.recordKind})
                          </span>
                        </span>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={async () => {
                            await importRepo.deleteMapping(mapping.id);
                            refresh();
                          }}
                        >
                          Remove
                        </Button>
                      </li>
                    ))}
                  </ul>
                </SectionCard>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
