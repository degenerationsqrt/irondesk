import { createFileRoute } from "@tanstack/react-router";
import { Droplets, Target } from "lucide-react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { MacroDonut } from "@/components/irondesk/charts";
import {
  ChartCard,
  DataRow,
  MetricTile,
  Pill,
  ProgressBar,
  SectionCard,
  StatCard,
} from "@/components/irondesk/primitives";
import { dashboardQuery, nutritionQuery } from "@/lib/irondesk/queries";
import { NutritionEmptyState } from "@/components/irondesk/empty-states";
import { useModeData } from "@/lib/irondesk/use-data";

export const Route = createFileRoute("/nutrition")({
  head: () => ({
    meta: [
      { title: "Nutrition & Fueling — IronDesk" },
      {
        name: "description",
        content:
          "Calorie and macro targets, meal breakdown, hydration and weight-goal adherence for training days.",
      },
      { property: "og:title", content: "Nutrition & Fueling — IronDesk" },
      { property: "og:description", content: "Macros, meals, hydration and goal adherence." },
    ],
  }),
  component: NutritionPage,
});

function NutritionPage() {
  const n = useModeData(nutritionQuery);
  const day = useModeData(dashboardQuery);
  if (!n) return <NutritionEmptyState />;
  const pct = (a: number, b: number) => Math.round((a / b) * 100);
  const macroData = [
    { name: "Protein", value: n.consumed.proteinG, color: "var(--chart-1)" },
    { name: "Carbs", value: n.consumed.carbsG, color: "var(--chart-2)" },
    { name: "Fat", value: n.consumed.fatG, color: "var(--chart-3)" },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Nutrition" subtitle="Fueling against training load." />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard
          label="Calories"
          value={n.consumed.calories}
          unit={`/ ${n.targets.calories}`}
          hint={`${pct(n.consumed.calories, n.targets.calories)}% of target`}
          tone="primary"
        />
        <StatCard
          label="Protein"
          value={n.consumed.proteinG}
          unit={`/ ${n.targets.proteinG} g`}
          hint={`${pct(n.consumed.proteinG, n.targets.proteinG)}%`}
          tone="success"
        />
        <StatCard
          label="Carbs"
          value={n.consumed.carbsG}
          unit={`/ ${n.targets.carbsG} g`}
          hint={`${pct(n.consumed.carbsG, n.targets.carbsG)}%`}
        />
        <StatCard
          label="Fat"
          value={n.consumed.fatG}
          unit={`/ ${n.targets.fatG} g`}
          hint={`${pct(n.consumed.fatG, n.targets.fatG)}%`}
          tone="warning"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <ChartCard title="Macro Split" eyebrow="Grams consumed" height={220}>
          <MacroDonut data={macroData} />
        </ChartCard>

        <SectionCard title="Meals" eyebrow={`${n.meals.length} logged`} bodyClassName="space-y-3">
          {n.meals.map((m) => (
            <div key={m.id} className="rounded-xl border border-border bg-surface-2/50 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {m.name} <span className="text-muted-foreground">· {m.time}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {m.items.join(" · ")}
                  </p>
                </div>
                <Pill tone="primary">{m.calories} kcal</Pill>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <MetricTile label="Protein" value={m.proteinG} unit="g" tone="primary" />
                <MetricTile label="Carbs" value={m.carbsG} unit="g" tone="success" />
                <MetricTile label="Fat" value={m.fatG} unit="g" tone="warning" />
              </div>
            </div>
          ))}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <SectionCard title="Hydration" eyebrow="Fluid intake">
          <div className="flex items-center gap-3">
            <Droplets className="size-8 text-primary" />
            <div>
              <span className="numeric text-3xl font-bold">{(n.hydrationMl / 1000).toFixed(1)}</span>
              <span className="ml-1 text-sm text-muted-foreground">
                / {(n.hydrationTargetMl / 1000).toFixed(1)} L
              </span>
            </div>
          </div>
          <div className="mt-4">
            <ProgressBar
              value={n.hydrationMl}
              max={n.hydrationTargetMl}
              tone="primary"
              right={`${pct(n.hydrationMl, n.hydrationTargetMl)}%`}
            />
          </div>
        </SectionCard>

        <SectionCard title="Goal Adherence" eyebrow="Rolling day">
          <div className="space-y-3">
            <ProgressBar
              value={n.consumed.calories}
              max={n.targets.calories}
              label="Calorie target"
              right={`${pct(n.consumed.calories, n.targets.calories)}%`}
              size="sm"
            />
            <ProgressBar
              value={n.consumed.proteinG}
              max={n.targets.proteinG}
              tone="success"
              label="Protein floor"
              right={`${pct(n.consumed.proteinG, n.targets.proteinG)}%`}
              size="sm"
            />
            <ProgressBar
              value={n.hydrationMl}
              max={n.hydrationTargetMl}
              tone="primary"
              label="Hydration"
              right={`${pct(n.hydrationMl, n.hydrationTargetMl)}%`}
              size="sm"
            />
          </div>
        </SectionCard>

        <SectionCard title="Weight Goal" eyebrow="Context">
          <div className="flex items-center gap-2">
            <Target className="size-5 text-warning" />
            <p className="text-sm font-semibold capitalize">{n.weightGoal.direction}</p>
          </div>
          <div className="mt-3">
            <DataRow label="Target rate" value={`${n.weightGoal.rateKgPerWeek} kg / week`} />
            <DataRow label="Net balance today" value={day ? `${day.energy.net} kcal` : "—"} />
            <DataRow label="Status" value={day?.energy.status ?? "No data"} />
            <DataRow
              label="Expenditure"
              value={day ? `${day.energy.bmr + day.energy.exerciseBurn} kcal` : "—"}
            />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
