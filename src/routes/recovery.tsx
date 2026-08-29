import { createFileRoute } from "@tanstack/react-router";
import { Info, Moon } from "lucide-react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { MultiLineChart } from "@/components/irondesk/charts";
import {
  ChartCard,
  DataRow,
  MetricTile,
  Pill,
  ProgressBar,
  ScoreBadge,
  SectionCard,
} from "@/components/irondesk/primitives";
import { recoveryQuery } from "@/lib/irondesk/queries";
import { RecoveryEmptyState } from "@/components/irondesk/empty-states";
import { useModeData, useServiceMode } from "@/lib/irondesk/use-data";

export const Route = createFileRoute("/recovery")({
  head: () => ({
    meta: [
      { title: "Recovery & Readiness — IronDesk" },
      {
        name: "description",
        content:
          "Readiness score, sleep quality, resting heart rate, soreness map, fatigue and stress with a training recommendation.",
      },
      { property: "og:title", content: "Recovery & Readiness — IronDesk" },
      {
        property: "og:description",
        content: "Readiness, sleep, soreness and today's recommendation.",
      },
    ],
  }),
  component: RecoveryPage,
});

function RecoveryPage() {
  const r = useModeData(recoveryQuery);
  const mode = useServiceMode();
  if (!r) return <RecoveryEmptyState />;
  const readiness = r.readiness;
  const hasReadiness = readiness != null;
  const tone =
    readiness == null
      ? "default"
      : readiness >= 75
        ? "success"
        : readiness >= 55
          ? "warning"
          : "danger";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recovery"
        subtitle={`Readiness inputs and training guidance${r.day ? ` for ${r.day}` : ""}.`}
      />

      <div className="panel grid gap-4 p-4 sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <div className="flex items-center gap-4">
          {hasReadiness ? (
            <ScoreBadge score={readiness!} label="Readiness" tone={tone} size={124} />
          ) : (
            <div className="flex size-[124px] shrink-0 flex-col items-center justify-center rounded-full border border-border bg-surface-2">
              <span className="numeric text-4xl font-bold">—</span>
              <span className="label-eyebrow mt-1">Readiness</span>
            </div>
          )}
          <div>
            <p className="label-eyebrow">Status</p>
            <p className="text-2xl font-bold tracking-tight">{r.status}</p>
            <Pill tone={tone} className="mt-2">
              {readiness == null
                ? "No score recorded"
                : readiness >= 75
                  ? "Train as planned"
                  : "Manage load"}
            </Pill>
          </div>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/8 p-4">
          <p className="label-eyebrow text-primary">Recommendation</p>
          <p className="mt-1.5 text-sm leading-relaxed">{r.recommendation}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile
          label="Sleep"
          value={r.sleep.hours ?? "—"}
          unit={r.sleep.hours == null ? "" : "h"}
          tone="primary"
        />
        <MetricTile
          label="Sleep efficiency"
          value={r.sleep.efficiencyPercent ?? "—"}
          unit={r.sleep.efficiencyPercent == null ? "" : "%"}
          tone="success"
        />
        <MetricTile
          label="Resting HR"
          value={r.restingHr ?? "—"}
          unit={r.restingHr == null ? "" : "bpm"}
        />
        <MetricTile
          label="HRV"
          value={r.hrvMs ?? "—"}
          unit={r.hrvMs == null ? "" : "ms"}
          tone="warning"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        {r.trend.length > 0 ? (
          <ChartCard title="Readiness Trend" eyebrow="Recorded scores" height={250}>
            <MultiLineChart
              data={r.trend}
              xKey="date"
              domain={[0, 100]}
              series={[{ key: "readiness", label: "Readiness", color: "var(--chart-1)" }]}
            />
          </ChartCard>
        ) : (
          <SectionCard title="Readiness Trend" eyebrow="Recorded scores">
            <p className="text-sm text-muted-foreground">
              No readiness scores are available for this period.
            </p>
          </SectionCard>
        )}

        <SectionCard title="Sleep" eyebrow="Last night">
          <div className="flex items-center gap-3">
            <Moon className="size-7 text-primary" />
            <div>
              <span className="numeric text-3xl font-bold">{r.sleep.hours ?? "—"}</span>
              {r.sleep.hours != null && (
                <span className="ml-1 text-sm text-muted-foreground">hours</span>
              )}
            </div>
          </div>
          {r.sleep.efficiencyPercent != null && r.sleep.efficiencyPercent > 0 && (
            <div className="mt-4">
              <ProgressBar
                value={r.sleep.efficiencyPercent}
                tone="primary"
                label="Efficiency"
                right={`${r.sleep.efficiencyPercent}%`}
              />
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{r.sleep.note}</p>
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Soreness Map" eyebrow="Self-reported 0–10">
          <div className="space-y-2.5">
            {r.soreness.map((s) => (
              <ProgressBar
                key={s.area}
                value={s.level}
                max={10}
                tone={s.level >= 7 ? "danger" : s.level >= 4 ? "warning" : "success"}
                label={s.area}
                right={s.level}
                size="sm"
              />
            ))}
            {r.soreness.length === 0 && (
              <p className="text-sm text-muted-foreground">No soreness map was recorded.</p>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Fatigue & Stress" eyebrow="Subjective load">
          {r.fatigue != null || r.stress != null ? (
            <div className="space-y-3">
              {r.fatigue != null && (
                <ProgressBar
                  value={r.fatigue}
                  max={10}
                  tone={r.fatigue >= 7 ? "danger" : "warning"}
                  label="Fatigue"
                  right={`${r.fatigue}/10`}
                />
              )}
              {r.stress != null && (
                <ProgressBar
                  value={r.stress}
                  max={10}
                  tone={r.stress >= 7 ? "danger" : "primary"}
                  label="Stress"
                  right={`${r.stress}/10`}
                />
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No subjective fatigue or stress values were recorded.
            </p>
          )}
          <div className="mt-4 border-t border-border pt-3">
            <DataRow
              label="Resting HR"
              value={r.restingHr != null ? `${r.restingHr} bpm` : "Not recorded"}
            />
            <DataRow label="HRV" value={r.hrvMs != null ? `${r.hrvMs} ms` : "Not recorded"} />
          </div>
        </SectionCard>

        <SectionCard title="Data Sources" eyebrow="Evidence">
          <div className="flex gap-2 rounded-lg border border-primary/35 bg-primary/10 p-3">
            <Info className="mt-0.5 size-4 shrink-0 text-primary" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {mode === "demo"
                ? "This is the labeled demo snapshot. Sign in to see only your own recovery evidence."
                : r.dataOrigin === "sample"
                  ? "This entry is labeled sample data and is excluded from live analytics. Remove it in Settings."
                  : `These values come from ${r.sourceLabel ?? "your recovery entry"}. Missing fields stay unavailable rather than being simulated.`}
            </p>
          </div>
          <ul className="mt-3 space-y-2">
            {r.placeholders.map((p) => (
              <li key={p} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{p}</span>
                <Pill tone="warning">Unavailable</Pill>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
