import { createFileRoute } from "@tanstack/react-router";
import { Flame, Trophy } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { ChartLegend, MultiLineChart, SimpleBarChart } from "@/components/irondesk/charts";
import {
  ChartCard,
  DataRow,
  MetricTile,
  Pill,
  SectionCard,
  StatCard,
} from "@/components/irondesk/primitives";
import { progressQuery } from "@/lib/irondesk/queries";
import { ProgressEmptyState } from "@/components/irondesk/empty-states";
import { formatWeight, fromKg, weightUnit } from "@/lib/irondesk/units";
import { useModeData } from "@/lib/irondesk/use-data";
import { useUnits } from "@/lib/irondesk/use-units";

export const Route = createFileRoute("/progress")({
  head: () => ({
    meta: [
      { title: "Progress & Trends — IronDesk" },
      {
        name: "description",
        content:
          "Bodyweight, estimated 1RM, weekly volume, acute vs chronic training load, cardio fitness and PR history.",
      },
      { property: "og:title", content: "Progress & Trends — IronDesk" },
      {
        property: "og:description",
        content: "Strength, volume, load and cardio trends over time.",
      },
    ],
  }),
  component: ProgressPage,
});

const ranges = [
  { key: "6w", label: "6W", take: 6 },
  { key: "12w", label: "12W", take: 12 },
  { key: "all", label: "All", take: 999 },
] as const;

function ProgressPage() {
  const p = useModeData(progressQuery);
  const [range, setRange] = useState<(typeof ranges)[number]["key"]>("12w");
  const units = useUnits();
  if (!p) return <ProgressEmptyState />;
  const take = ranges.find((r) => r.key === range)?.take ?? 12;
  const tail = <T,>(arr: T[]) => arr.slice(Math.max(0, arr.length - take));

  const load = tail(p.load);
  const e1rm = tail(p.e1rm).map((point) => ({
    ...point,
    squat: fromKg(point.squat, units),
    bench: fromKg(point.bench, units),
    deadlift: fromKg(point.deadlift, units),
  }));
  const volume = tail(p.volume).map((point) => ({
    ...point,
    tonnage: fromKg(point.tonnage, units),
  }));
  const bodyweight = tail(p.bodyweight).map((point) => ({
    date: point.date,
    weight: fromKg(point.kg, units),
  }));
  const latestLoad = load[load.length - 1];
  const ratio = latestLoad && latestLoad.chronic > 0 ? latestLoad.acute / latestLoad.chronic : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Progress"
        subtitle="Long-run strength, volume, load and conditioning trends."
        action={
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
            {ranges.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
                  range === r.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="Current streak"
          value={p.streak.currentWeeks}
          unit={p.streak.currentWeeks === 1 ? "week" : "weeks"}
          tone="success"
          icon={<Flame className="size-4" />}
        />
        <StatCard
          label="Best streak"
          value={p.streak.bestWeeks}
          unit={p.streak.bestWeeks === 1 ? "week" : "weeks"}
        />
        <StatCard label="Weeks tracked" value={p.streak.weeksTracked} tone="primary" />
        <StatCard
          label="Acute:chronic"
          value={ratio == null ? "—" : ratio.toFixed(2)}
          tone={
            ratio == null ? "default" : ratio > 1.3 ? "danger" : ratio < 0.8 ? "warning" : "success"
          }
          hint={
            ratio == null ? "load unavailable" : ratio > 1.3 ? "Spike risk" : "Inside safe band"
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Estimated 1RM"
          eyebrow="Main lifts"
          height={260}
          footer={
            <ChartLegend
              items={[
                { label: "Squat", color: "var(--chart-1)" },
                { label: "Bench", color: "var(--chart-2)" },
                { label: "Deadlift", color: "var(--chart-3)" },
              ]}
            />
          }
        >
          <MultiLineChart
            data={e1rm}
            xKey="date"
            unit={weightUnit(units)}
            series={[
              { key: "squat", label: "Squat", color: "var(--chart-1)" },
              { key: "bench", label: "Bench", color: "var(--chart-2)" },
              { key: "deadlift", label: "Deadlift", color: "var(--chart-3)" },
            ]}
          />
        </ChartCard>

        <ChartCard title="Weekly Volume" eyebrow="Tonnage per week" height={260}>
          <SimpleBarChart data={volume} xKey="week" yKey="tonnage" unit={weightUnit(units)} />
        </ChartCard>

        <ChartCard
          title="Training Load"
          eyebrow="Acute vs chronic"
          height={260}
          footer={
            <ChartLegend
              items={[
                { label: "Acute (7d)", color: "var(--chart-4)" },
                { label: "Chronic (28d)", color: "var(--chart-1)" },
              ]}
            />
          }
        >
          <MultiLineChart
            data={load}
            xKey="week"
            series={[
              { key: "acute", label: "Acute", color: "var(--chart-4)" },
              { key: "chronic", label: "Chronic", color: "var(--chart-1)" },
            ]}
          />
        </ChartCard>

        <ChartCard title="Bodyweight" eyebrow="Trend" height={260}>
          <MultiLineChart
            data={bodyweight}
            xKey="date"
            unit={weightUnit(units)}
            series={[{ key: "weight", label: "Bodyweight", color: "var(--chart-5)" }]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <ChartCard title="Cardio Fitness" eyebrow="Estimated VO2 max" height={240}>
          <MultiLineChart
            data={tail(p.cardioFitness)}
            xKey="date"
            series={[{ key: "vo2", label: "VO2 max", color: "var(--chart-2)" }]}
          />
        </ChartCard>

        <SectionCard title="PR History" eyebrow="Verified records">
          {p.prs.map((pr) => (
            <DataRow
              key={`${pr.date}-${pr.exercise}`}
              label={
                <span className="flex items-center gap-2">
                  <Trophy className="size-3.5 text-success" />
                  {pr.exercise}
                  <Pill>{pr.date}</Pill>
                </span>
              }
              value={
                pr.weightKg != null && pr.reps != null
                  ? `${formatWeight(pr.weightKg, units)} × ${pr.reps}${pr.e1rmKg != null ? ` (e1RM ${formatWeight(pr.e1rmKg, units)})` : ""}`
                  : pr.detail
              }
            />
          ))}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <MetricTile label="PRs logged" value={p.prs.length} tone="success" />
            <MetricTile label="Weeks tracked" value={p.volume.length} />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
