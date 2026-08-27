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
import * as importRepo from "@/lib/imports/repo";
import * as repo from "@/lib/irondesk/repo";

export const Route = createFileRoute("/connections")({
  head: () => ({
    meta: [
      { title: "Connections & Imports — IronDesk" },
      {
        name: "description",
        content:
          "Import Garmin TCX, GPX and FIT files, Health Connect exports and generic CSV/JSON data into IronDesk, review every record before it lands, and roll back any batch.",
      },
      { property: "og:title", content: "Connections & Imports — IronDesk" },
      {
        property: "og:description",
        content: "Standards-based activity and health imports with field mapping, previews and batch rollback.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConnectionsPage,
});

const fmtDate = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function ConnectionsPage() {
  const { mode } = useAuth();
  const live = mode === "live";
  const queryClient = useQueryClient();
  const [exportState, setExportState] = useState<string | null>(null);

  const jobs = useQuery({ ...importJobsQuery, enabled: live });
  const totals = useQuery({ ...importTotalsQuery, enabled: live });
  const activities = useQuery({ ...importedActivitiesQuery, enabled: live });
  const metrics = useQuery({ ...importedMetricsQuery, enabled: live });
  const mappings = useQuery({ ...savedMappingsQuery, enabled: live });

  const refresh = () => {
    for (const key of Object.values(importKeys)) void queryClient.invalidateQueries({ queryKey: key });
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
          completedAt: durationSec ? new Date(Date.parse(startedAt) + durationSec * 1000).toISOString() : null,
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
      downloadFile(`irondesk-sessions-${new Date().toISOString().slice(0, 10)}.tcx`, sessionsToTcx(sessions), "application/vnd.garmin.tcx+xml");
      setExportState(`Exported ${sessions.length} session${sessions.length === 1 ? "" : "s"} as TCX.`);
    } catch (error) {
      setExportState(error instanceof Error ? error.message : "The export failed.");
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Connections & Imports"
        subtitle="Bring activity and health data in from files, review it before it lands, and export sessions Garmin can read."
      />

      {!live && (
        <SectionCard title="Demo mode" eyebrow="Read-only">
          <p className="text-sm text-muted-foreground">
            Demo mode never writes to a real account. Sign in to import files, keep import history and roll batches back.
          </p>
        </SectionCard>
      )}

      {live && (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <ImportCard
              sourceType="garmin_file"
              eyebrow="Garmin"
              title="Garmin file import"
              blurb="Export an activity from Garmin Connect (TCX, GPX or the original FIT file) and drop it here. Activity summaries, duration, distance, calories and heart rate are read; route geometry is not stored."
              formats=".fit, .tcx, .gpx, .zip"
            />
            <ImportCard
              sourceType="health_connect"
              eyebrow="Android"
              title="Health Connect import"
              blurb="Steps, sleep, resting heart rate, HRV, bodyweight and active calories exported as CSV or JSON from an Android Health Connect export or the IronDesk companion app."
              formats=".csv, .json, .zip"
            />
            <ImportCard
              sourceType="generic_file"
              eyebrow="Anything else"
              title="Generic file import"
              blurb="Any CSV or JSON export. Unrecognized columns open the field-mapping wizard so you decide exactly what each column means before anything is saved."
              formats=".csv, .json, .zip"
            />
          </div>

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
                <p className="text-sm text-muted-foreground">No imports yet. Every import you run is listed here and can be rolled back.</p>
              ) : (
                <ul className="space-y-2">
                  {jobs.data.map((job) => (
                    <li key={job.id} className="rounded-lg border border-border/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{job.fileName ?? "Untitled file"}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDate(job.startedAt)} · {job.fileFormat.toUpperCase()} · {job.sourceType.replace(/_/g, " ")} · {job.status}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {job.importedCount} imported · {job.duplicateCount} duplicates · {job.warningCount} warnings ·{" "}
                            {job.failedCount} skipped
                          </p>
                          {job.errorMessage && <p className="text-xs text-destructive">{job.errorMessage}</p>}
                        </div>
                        <RollbackButton jobId={job.id} onDone={refresh} />
                      </div>
                    </li>
                  ))}
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
                    {activities.data.slice(0, 5).map((activity) => (
                      <li key={activity.id} className="flex justify-between gap-3">
                        <span className="truncate">
                          {activity.name ?? activity.activityType} · {fmtDate(activity.startedAt)}
                        </span>
                        <span className="numeric shrink-0">
                          {activity.durationSec ? `${Math.round(activity.durationSec / 60)} min` : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {metrics.data?.length ? (
                  <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                    {metrics.data.slice(0, 5).map((metric) => (
                      <li key={metric.id} className="flex justify-between gap-3">
                        <span className="truncate">
                          {metric.metricType.replace(/_/g, " ")} · {fmtDate(metric.recordedAt)}
                        </span>
                        <span className="numeric shrink-0">
                          {metric.value} {metric.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </SectionCard>

              <SectionCard title="Export to Garmin" eyebrow="Outbound">
                <p className="text-sm text-muted-foreground">
                  Completed sessions export as standards-compliant TCX v2 — the format Garmin Connect accepts under
                  &ldquo;Import Data&rdquo;. Strength sessions export as one lap with duration, calories and heart rate; no GPS
                  track is fabricated.
                </p>
                <Button size="sm" className="mt-3" onClick={() => void exportTcx()}>
                  <Download className="mr-1.5 size-4" /> Download TCX
                </Button>
                {exportState && <p className="mt-2 text-xs text-muted-foreground">{exportState}</p>}
              </SectionCard>

              <DeviceSyncCard />

              {mappings.data?.length ? (
                <SectionCard title="Saved field mappings" eyebrow="Reusable">
                  <ul className="space-y-2">
                    {mappings.data.map((mapping) => (
                      <li key={mapping.id} className="flex items-center justify-between gap-2 text-sm">
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
