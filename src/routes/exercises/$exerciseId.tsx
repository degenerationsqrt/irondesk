import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Star } from "lucide-react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { MultiLineChart, SimpleBarChart } from "@/components/irondesk/charts";
import {
  ChartCard,
  DataRow,
  EmptyState,
  MetricTile,
  Pill,
  SectionCard,
} from "@/components/irondesk/primitives";
import { exerciseQuery } from "@/lib/irondesk/queries";
import { useModeData } from "@/lib/irondesk/use-data";

export const Route = createFileRoute("/exercises/$exerciseId")({
  head: () => ({
    meta: [
      { title: "Exercise Detail — IronDesk" },
      {
        name: "description",
        content:
          "Per-movement performance history: top sets, estimated 1RM trend, volume trend and technique cues.",
      },
      { property: "og:title", content: "Exercise Detail — IronDesk" },
      { property: "og:description", content: "Top sets, 1RM trend, volume trend and cues." },
    ],
  }),
  component: ExerciseDetailPage,
});

function ExerciseDetailPage() {
  const { exerciseId } = Route.useParams();
  const exercise = useModeData((mode) => exerciseQuery(mode, exerciseId));

  if (!exercise) {
    return (
      <EmptyState
        title="Exercise not found"
        description="This movement is not in your library."
        action={
          <Link to="/exercises" className="text-sm font-semibold text-primary hover:underline">
            Back to library
          </Link>
        }
      />
    );
  }

  const latest = exercise.e1rmTrend[exercise.e1rmTrend.length - 1];
  const first = exercise.e1rmTrend[0];
  const delta = latest && first ? latest.e1rm - first.e1rm : 0;

  return (
    <div className="space-y-4">
      <Link
        to="/exercises"
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> Exercise library
      </Link>

      <PageHeader
        title={exercise.name}
        subtitle={`${exercise.muscle} · ${exercise.equipment} · ${exercise.pattern}`}
        action={exercise.favorite ? <Star className="size-5 fill-warning text-warning" /> : undefined}
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile
          label="Best set"
          value={`${exercise.best.weightKg}×${exercise.best.reps}`}
          tone="warning"
        />
        <MetricTile label="Est. 1RM" value={latest?.e1rm ?? "—"} unit="kg" tone="primary" />
        <MetricTile
          label="1RM change"
          value={`${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
          unit="kg"
          tone={delta >= 0 ? "success" : "danger"}
        />
        <MetricTile label="Sessions" value={exercise.history.length} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Estimated 1RM Trend" eyebrow="Rolling sessions" height={240}>
          <MultiLineChart
            data={exercise.e1rmTrend}
            xKey="date"
            unit="kg"
            series={[{ key: "e1rm", label: "Est. 1RM", color: "var(--chart-1)" }]}
          />
        </ChartCard>
        <ChartCard title="Volume per Session" eyebrow="Tonnage" height={240}>
          <SimpleBarChart
            data={exercise.history.map((h) => ({ date: h.date, tonnage: h.tonnageKg }))}
            xKey="date"
            yKey="tonnage"
            unit="kg"
            color="var(--chart-3)"
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Performance History" eyebrow="Top sets logged">
          {exercise.history.map((h) => (
            <DataRow key={h.date} label={`${h.date} — ${h.detail}`} value={`${h.tonnageKg} kg`} />
          ))}
        </SectionCard>
        <SectionCard title="Notes & Cues" eyebrow="Technique">
          <ul className="space-y-2">
            {exercise.cues.map((c) => (
              <li key={c} className="flex gap-2 text-sm text-muted-foreground">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3">
            <Pill tone="primary">{exercise.muscle}</Pill>
            {exercise.secondary.map((s) => (
              <Pill key={s}>{s}</Pill>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
