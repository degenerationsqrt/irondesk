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
import { useModeData } from "@/lib/irondesk/use-data";

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
      { property: "og:description", content: "Readiness, sleep, soreness and today's recommendation." },
    ],
  }),
  component: RecoveryPage,
});

function RecoveryPage() {
  const r = useModeData(recoveryQuery);
  if (!r) return <RecoveryEmptyState />;
  const tone = r.readiness >= 75 ? "success" : r.readiness >= 55 ? "warning" : "danger";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Recovery"
        subtitle="Readiness inputs and the resulting training recommendation."
      />

      <div className="panel grid gap-4 p-4 sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <div className="flex items-center gap-4">
          <ScoreBadge score={r.readiness} label="Readiness" tone={tone} size={124} />
          <div>
            <p className="label-eyebrow">Status</p>
            <p className="text-2xl font-bold tracking-tight">{r.status}</p>
            <Pill tone={tone} className="mt-2">
              {r.readiness >= 75 ? "Train as planned" : "Manage load"}
            </Pill>
          </div>
        </div>
        <div className="rounded-xl border border-primary/30 bg-primary/8 p-4">
          <p className="label-eyebrow text-primary">Recommendation</p>
          <p className="mt-1.5 text-sm leading-relaxed">{r.recommendation}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Sleep" value={r.sleep.hours} unit="h" tone="primary" />
        <MetricTile label="Sleep efficiency" value={r.sleep.efficiencyPercent} unit="%" tone="success" />
        <MetricTile label="Resting HR" value={r.restingHr} unit="bpm" />
        <MetricTile label="HRV" value={r.hrvMs ?? "—"} unit={r.hrvMs ? "ms" : "no device"} tone="warning" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <ChartCard title="Readiness Trend" eyebrow="Rolling window" height={250}>
          <MultiLineChart
            data={r.trend}
            xKey="date"
            domain={[0, 100]}
            series={[{ key: "readiness", label: "Readiness", color: "var(--chart-1)" }]}
          />
        </ChartCard>

        <SectionCard title="Sleep" eyebrow="Last night">
          <div className="flex items-center gap-3">
            <Moon className="size-7 text-primary" />
            <div>
              <span className="numeric text-3xl font-bold">{r.sleep.hours}</span>
              <span className="ml-1 text-sm text-muted-foreground">hours</span>
            </div>
          </div>
          <div className="mt-4">
            <ProgressBar
              value={r.sleep.efficiencyPercent}
              tone="primary"
              label="Efficiency"
              right={`${r.sleep.efficiencyPercent}%`}
            />
          </div>
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
          </div>
        </SectionCard>

        <SectionCard title="Fatigue & Stress" eyebrow="Subjective load">
          <div className="space-y-3">
            <ProgressBar
              value={r.fatigue}
              max={10}
              tone={r.fatigue >= 7 ? "danger" : "warning"}
              label="Fatigue"
              right={`${r.fatigue}/10`}
            />
            <ProgressBar
              value={r.stress}
              max={10}
              tone={r.stress >= 7 ? "danger" : "primary"}
              label="Stress"
              right={`${r.stress}/10`}
            />
          </div>
          <div className="mt-4 border-t border-border pt-3">
            <DataRow label="Resting HR" value={`${r.restingHr} bpm`} />
            <DataRow label="HRV" value={r.hrvMs ? `${r.hrvMs} ms` : "Awaiting wearable"} />
          </div>
        </SectionCard>

        <SectionCard title="Data Sources" eyebrow="Mock & placeholders">
          <div className="flex gap-2 rounded-lg border border-warning/35 bg-warning/10 p-3">
            <Info className="mt-0.5 size-4 shrink-0 text-warning" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              All recovery values on this screen are mock data. Fields below require a connected
              wearable and are placeholders until an integration is added.
            </p>
          </div>
          <ul className="mt-3 space-y-2">
            {r.placeholders.map((p) => (
              <li key={p} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{p}</span>
                <Pill tone="warning">Placeholder</Pill>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
