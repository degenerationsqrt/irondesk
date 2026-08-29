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
import { summarizeExerciseEvidence } from "@/lib/irondesk/exercise-evidence";
import { exerciseQuery } from "@/lib/irondesk/queries";
import { formatWeightText, fromKg, weightUnit } from "@/lib/irondesk/units";
import { useModeData } from "@/lib/irondesk/use-data";
import { useUnits } from "@/lib/irondesk/use-units";

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
  const units = useUnits();

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

  const evidence = summarizeExerciseEvidence(exercise);
  const latest = evidence.e1rmTrend[evidence.e1rmTrend.length - 1];
  const displayDelta = evidence.e1rmDeltaKg == null ? null : fromKg(evidence.e1rmDeltaKg, units);
  const unit = weightUnit(units);
  const e1rmTrend = evidence.e1rmTrend.map((point) => ({
    ...point,
    e1rm: fromKg(point.e1rm, units),
  }));
  const volumeHistory = evidence.volumeHistory.map((history) => ({
    date: history.date,
    tonnage: fromKg(history.tonnageKg, units),
  }));
  const bestSet =
    evidence.bestSet?.kind === "weighted"
      ? `${fromKg(evidence.bestSet.weightKg, units)} ${unit} × ${evidence.bestSet.reps}`
      : evidence.bestSet?.kind === "reps"
        ? `${evidence.bestSet.reps} reps`
        : "—";

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
        action={
          exercise.favorite ? <Star className="size-5 fill-warning text-warning" /> : undefined
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Best set" value={bestSet} tone="warning" />
        <MetricTile
          label="Est. 1RM"
          value={latest ? fromKg(latest.e1rm, units) : "—"}
          unit={latest ? unit : ""}
          tone="primary"
        />
        <MetricTile
          label="1RM change"
          value={
            displayDelta == null ? "—" : `${displayDelta >= 0 ? "+" : ""}${displayDelta.toFixed(1)}`
          }
          unit={displayDelta == null ? "" : unit}
          tone={
            evidence.e1rmDeltaKg == null
              ? "default"
              : evidence.e1rmDeltaKg < 0
                ? "danger"
                : "success"
          }
        />
        <MetricTile label="Sessions" value={exercise.history.length} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard title="Estimated 1RM Trend" eyebrow="Rolling sessions" height={240}>
          {e1rmTrend.length ? (
            <MultiLineChart
              data={e1rmTrend}
              xKey="date"
              unit={unit}
              series={[{ key: "e1rm", label: "Est. 1RM", color: "var(--chart-1)" }]}
            />
          ) : (
            <EmptyState
              title="No estimated 1RM yet"
              description="Complete a weighted working set before IronDesk draws this trend."
            />
          )}
        </ChartCard>
        <ChartCard title="Volume per Session" eyebrow="Tonnage" height={240}>
          {volumeHistory.length ? (
            <SimpleBarChart
              data={volumeHistory}
              xKey="date"
              yKey="tonnage"
              unit={unit}
              color="var(--chart-3)"
            />
          ) : (
            <EmptyState
              title="No measured tonnage yet"
              description="Weighted set volume will appear here after it is logged."
            />
          )}
        </ChartCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="Performance History" eyebrow="Top sets logged">
          {evidence.hasPerformanceHistory ? (
            exercise.history.map((h) => (
              <DataRow
                key={`${h.date}-${h.detail}`}
                label={`${h.date} — ${formatWeightText(h.detail, units)}`}
                value={
                  h.tonnageKg > 0
                    ? `${fromKg(h.tonnageKg, units).toLocaleString()} ${unit}`
                    : "Load unavailable"
                }
              />
            ))
          ) : (
            <EmptyState
              title="No sessions logged"
              description="This movement has no recorded performance history yet."
            />
          )}
        </SectionCard>
        <SectionCard title="Notes & Cues" eyebrow="Technique">
          {evidence.hasCues ? (
            <ul className="space-y-2">
              {exercise.cues.map((c) => (
                <li key={c} className="flex gap-2 text-sm text-muted-foreground">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  {c}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No technique notes yet"
              description="Add a custom movement to save instructions and coaching cues."
            />
          )}
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
