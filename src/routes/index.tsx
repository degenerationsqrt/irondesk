import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ClipboardList,
  Dumbbell,
  Flame,
  HeartPulse,
  Play,
  Timer,
  TrendingUp,
} from "lucide-react";

import { ChartLegend, HrChart, MacroDonut } from "@/components/irondesk/charts";
import { AssignedWorkoutCard } from "@/components/irondesk/program-panels";
import {
  ChartCard,
  DataRow,
  GradeBadge,
  InsightCard,
  MetricTile,
  Pill,
  ProgressBar,
  ScoreBadge,
  SectionCard,
  StatCard,
  ZoneBar,
  ZoneLegend,
  gradeTone,
  zoneMeta,
} from "@/components/irondesk/primitives";
import { dashboardQuery } from "@/lib/irondesk/queries";
import { DashboardEmptyState } from "@/components/irondesk/empty-states";
import { Button } from "@/components/ui/button";
import { formatInstantTime } from "@/lib/irondesk/dates";
import { formatWeight, fromKg, weightUnit } from "@/lib/irondesk/units";
import { useModeData } from "@/lib/irondesk/use-data";
import { useUnits } from "@/lib/irondesk/use-units";
import type { ActivitySession } from "@/lib/irondesk/types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Today's Summary — IronDesk Training Intelligence" },
      {
        name: "description",
        content:
          "IronDesk dashboard: daily strain, heart-rate zones, strength tonnage, nutrition and recovery grades in one performance command center.",
      },
      { property: "og:title", content: "Today's Summary — IronDesk" },
      {
        property: "og:description",
        content: "Daily training strain, HR zones, tonnage, nutrition and recovery grades.",
      },
    ],
  }),
  component: DashboardPage,
});

function SessionCard({
  session,
  timeZone,
}: {
  session: ActivitySession;
  timeZone: string | undefined;
}) {
  const isCardio = session.kind === "cardio";
  return (
    <div className="rounded-xl border border-border bg-surface-2/50 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isCardio ? (
              <HeartPulse className="size-4 text-primary" />
            ) : (
              <Dumbbell className="size-4 text-warning" />
            )}
            <p className="truncate text-sm font-semibold">{session.name}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatInstantTime(session.startedAt, timeZone)} ·{" "}
            {session.kind === "other" ? "Activity" : session.kind}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {session.sourceLabel && session.source !== "irondesk" && (
            <Pill>{session.sourceLabel}</Pill>
          )}
          <Pill tone={isCardio ? "primary" : "warning"}>
            {session.durationMin == null ? "Duration —" : `${session.durationMin}m`}
          </Pill>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Kcal" value={session.calories ?? "—"} />
        <MetricTile label="Avg HR" value={session.avgHr ?? "—"} />
        <MetricTile label="Load" value={session.cardioLoad ?? "—"} tone="primary" />
        <MetricTile label="AZM" value={session.activeZoneMinutes ?? "—"} tone="success" />
      </div>

      {session.zones.length > 0 && (
        <div className="mt-3">
          <ZoneBar zones={session.zones} />
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
            {session.zones.map((z) => (
              <div
                key={z.zone}
                className="flex items-center justify-between gap-2 text-[0.6875rem]"
              >
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: zoneMeta[z.zone].color }}
                  />
                  {zoneMeta[z.zone].name}
                </span>
                <span className="numeric font-semibold">
                  {z.minutes}m · {z.percent}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {session.notes && (
        <p className="mt-3 border-t border-border pt-2.5 text-xs text-muted-foreground">
          {session.notes}
        </p>
      )}
    </div>
  );
}

function TodayStartSurface() {
  return (
    <div className="panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div>
        <p className="label-eyebrow">Train today</p>
        <h1 className="mt-1 text-xl font-bold tracking-tight">
          Your plan and workout console come first.
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Start the assigned session above, or open the workout console for an IronDesk Original or
          your own template.
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Button asChild>
          <Link to="/workout">
            <Play className="size-4" /> Open workout console
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/program">
            <ClipboardList className="size-4" /> View program
          </Link>
        </Button>
      </div>
    </div>
  );
}

function DashboardPage() {
  const day = useModeData(dashboardQuery);
  const units = useUnits();
  const planFirst = (
    <>
      <AssignedWorkoutCard />
      <TodayStartSurface />
    </>
  );
  if (!day) {
    return (
      <div className="space-y-4">
        {planFirst}
        <DashboardEmptyState />
      </div>
    );
  }
  const n = day.nutrition;
  const macroData = [
    { name: "Protein", value: n.consumed.proteinG, color: "var(--chart-1)" },
    { name: "Carbs", value: n.consumed.carbsG, color: "var(--chart-2)" },
    { name: "Fat", value: n.consumed.fatG, color: "var(--chart-3)" },
  ];
  const maxLoad = Math.max(1, ...day.weeklyLoad.map((d) => d.load));
  const availability = day.dataAvailability ?? {
    strength: true,
    strengthMetrics: true,
    cardio: true,
    nutrition: true,
    recovery: true,
    heartRateZones: true,
    measuredStrain: true,
  };
  const totalMinutes = Math.round(
    day.sessions.reduce((sum, session) => sum + (session.durationMin ?? 0), 0),
  );
  const peakHrValues = day.sessions
    .map((session) => session.maxHr)
    .filter((value): value is number => value != null && value > 0);
  const strainBand =
    day.strain.total <= 6
      ? "Light load"
      : day.strain.total <= 14
        ? "Productive band"
        : day.strain.total <= 18
          ? "High load"
          : "Very high load";

  return (
    <div className="space-y-4">
      {planFirst}

      {/* Header row */}
      <div className="panel grid gap-4 p-4 sm:p-5 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center">
        <div className="flex items-center gap-4">
          <ScoreBadge
            score={day.ironScore}
            label="IronScore"
            tone={gradeTone(day.grade)}
            size={120}
          />
          <div className="min-w-0">
            <p className="label-eyebrow">Today's summary</p>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{day.date}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Pill tone="success">{day.statusLine}</Pill>
              <GradeBadge grade={day.grade} />
              <Pill>
                <Timer className="mr-1 size-3" /> {totalMinutes} min trained
              </Pill>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="Activity strain"
            value={availability.measuredStrain ? day.strain.total : "—"}
            hint={availability.measuredStrain ? "of 21 scale" : "load unavailable"}
            tone="primary"
            icon={<Activity className="size-4" />}
          />
          <StatCard
            label="Exercise calories"
            value={day.energy.exerciseBurn || "—"}
            unit="kcal"
            icon={<Flame className="size-4" />}
          />
          <StatCard
            label="Avg HR"
            value={day.avgHr ?? "—"}
            unit="bpm"
            icon={<HeartPulse className="size-4" />}
          />
          <StatCard
            label="Tonnage"
            value={
              availability.strengthMetrics
                ? fromKg(day.strength.tonnageKg, units).toLocaleString()
                : "—"
            }
            unit={availability.strengthMetrics ? weightUnit(units) : ""}
            tone="warning"
            icon={<Dumbbell className="size-4" />}
          />
        </div>
      </div>

      {/* Strain + workouts */}
      {day.sessions.length > 0 && (
        <div
          className={`grid gap-4 ${availability.measuredStrain ? "xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]" : ""}`}
        >
          {availability.measuredStrain && (
            <SectionCard title="Activity Strain" eyebrow="Measured load distribution">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <span className="numeric text-5xl leading-none font-bold text-primary">
                    {day.strain.total}
                  </span>
                  <span className="ml-1 text-sm text-muted-foreground">/ 21</span>
                </div>
                <Pill tone="primary">{strainBand}</Pill>
              </div>
              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between text-xs">
                  <span className="text-primary font-semibold">
                    Cardio {day.strain.cardioPercent}%
                  </span>
                  <span className="text-warning font-semibold">
                    Muscular {day.strain.muscularPercent}%
                  </span>
                </div>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-3">
                  <div className="bg-primary" style={{ width: `${day.strain.cardioPercent}%` }} />
                  <div className="bg-warning" style={{ width: `${day.strain.muscularPercent}%` }} />
                </div>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                {day.strain.interpretation}
              </p>
            </SectionCard>
          )}

          <SectionCard
            title="Workouts"
            eyebrow={`${day.sessions.length} sessions logged`}
            action={
              <Link to="/history" className="text-xs font-semibold text-primary hover:underline">
                View history
              </Link>
            }
            bodyClassName="grid gap-3 md:grid-cols-2"
          >
            {day.sessions.map((s) => (
              <SessionCard
                key={`${s.source ?? "session"}-${s.id}`}
                session={s}
                timeZone={day.timeZone}
              />
            ))}
          </SectionCard>
        </div>
      )}

      {/* HR chart + zones */}
      {availability.heartRateZones && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          <ChartCard
            title="Heart Rate"
            eyebrow="Full day trace"
            height={260}
            footer={<ZoneLegend />}
          >
            <HrChart data={day.hrSeries} />
          </ChartCard>

          <SectionCard title="Time in Zones" eyebrow="Active zone minutes">
            <div className="space-y-3">
              {day.zoneTotals.map((z) => (
                <ProgressBar
                  key={z.zone}
                  value={z.percent}
                  tone={
                    z.zone === "peak"
                      ? "danger"
                      : z.zone === "vigorous"
                        ? "warning"
                        : z.zone === "moderate"
                          ? "success"
                          : "default"
                  }
                  label={zoneMeta[z.zone].name}
                  right={`${z.minutes}m · ${z.percent}%`}
                />
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <DataRow
                label="Total active zone minutes"
                value={day.sessions.reduce(
                  (sum, session) => sum + (session.activeZoneMinutes ?? 0),
                  0,
                )}
              />
              <DataRow
                label="Peak HR"
                value={peakHrValues.length ? `${Math.max(...peakHrValues)} bpm` : "—"}
              />
            </div>
          </SectionCard>
        </div>
      )}

      {/* Strength + nutrition + energy */}
      <div className="grid gap-4 xl:grid-cols-3">
        {availability.strengthMetrics && (
          <SectionCard title="Strength" eyebrow="Completed set output">
            <div className="grid grid-cols-2 gap-2">
              <MetricTile label="Sets" value={day.strength.totalSets} />
              <MetricTile label="Reps" value={day.strength.totalReps} />
              <MetricTile
                label="Tonnage"
                value={fromKg(day.strength.tonnageKg, units).toLocaleString()}
                unit={weightUnit(units)}
              />
              <MetricTile
                label="Est. 1RM change"
                value={
                  day.strength.e1rmDeltaKg > 0 ? `+${fromKg(day.strength.e1rmDeltaKg, units)}` : "—"
                }
                unit={weightUnit(units)}
                tone="success"
              />
            </div>
            {day.strength.topLift && (
              <div className="mt-3 rounded-lg border border-border bg-surface-2/60 px-3 py-2.5">
                <p className="label-eyebrow">Best lift</p>
                <p className="mt-1 text-sm font-semibold">
                  {day.strength.topLift.exercise}{" "}
                  <span className="numeric text-warning">
                    {formatWeight(day.strength.topLift.weightKg, units)} ×{" "}
                    {day.strength.topLift.reps}
                  </span>
                </p>
              </div>
            )}
            <div className="mt-3 space-y-2">
              {day.strength.prs.map((pr) => (
                <div
                  key={pr.exercise}
                  className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2"
                >
                  <TrendingUp className="mt-0.5 size-4 shrink-0 text-success" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-success">{pr.exercise}</p>
                    <p className="text-xs text-muted-foreground">{pr.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {availability.nutrition && (
          <SectionCard
            title="Nutrition"
            eyebrow="Macro adherence"
            action={
              <Link to="/nutrition" className="text-xs font-semibold text-primary hover:underline">
                Details
              </Link>
            }
          >
            <div className="flex items-center gap-4">
              <div className="h-28 w-28 shrink-0">
                <MacroDonut data={macroData} />
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <ProgressBar
                  value={n.consumed.calories}
                  max={n.targets.calories}
                  label="Calories"
                  right={`${n.consumed.calories} / ${n.targets.calories}`}
                  size="sm"
                />
                <ProgressBar
                  value={n.consumed.proteinG}
                  max={n.targets.proteinG}
                  tone="primary"
                  label="Protein"
                  right={`${n.consumed.proteinG} / ${n.targets.proteinG} g`}
                  size="sm"
                />
                <ProgressBar
                  value={n.consumed.carbsG}
                  max={n.targets.carbsG}
                  tone="success"
                  label="Carbs"
                  right={`${n.consumed.carbsG} / ${n.targets.carbsG} g`}
                  size="sm"
                />
                <ProgressBar
                  value={n.consumed.fatG}
                  max={n.targets.fatG}
                  tone="warning"
                  label="Fat"
                  right={`${n.consumed.fatG} / ${n.targets.fatG} g`}
                  size="sm"
                />
              </div>
            </div>
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              {n.meals.slice(0, 3).map((m) => (
                <div key={m.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{m.items.join(" · ")}</p>
                  </div>
                  <span className="numeric shrink-0 text-sm font-semibold">{m.calories}</span>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

        {(availability.nutrition || day.energy.exerciseBurn > 0) && (
          <SectionCard title="Logged Energy" eyebrow="Evidence-backed totals">
            <div className="grid grid-cols-2 gap-2">
              <MetricTile
                label="Intake"
                value={availability.nutrition ? day.energy.intake : "—"}
                unit="kcal"
              />
              <MetricTile
                label="Exercise"
                value={day.energy.exerciseBurn || "—"}
                unit="kcal"
                tone="warning"
              />
              <MetricTile label="Resting expenditure" value="—" />
              <MetricTile label="Net balance" value="—" />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              IronDesk no longer invents a resting-calorie estimate. Add enough profile evidence
              before using a net energy balance.
            </p>
          </SectionCard>
        )}
      </div>

      {/* Grades + suggestions */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <SectionCard title="Daily Grades" eyebrow="Breakdown">
          <div className="space-y-2.5">
            {day.grades.map((g) => (
              <div key={g.label} className="flex items-center gap-3">
                {g.available === false ? (
                  <Pill className="w-9 shrink-0 justify-center">N/A</Pill>
                ) : (
                  <GradeBadge grade={g.grade} size="sm" className="w-9 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <ProgressBar
                    value={g.available === false ? 0 : g.score}
                    tone={g.available === false ? "default" : gradeTone(g.grade)}
                    label={g.label}
                    right={g.available === false ? "N/A" : g.score}
                    size="sm"
                  />
                  <p className="mt-1 truncate text-[0.6875rem] text-muted-foreground">{g.note}</p>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard
          title="Suggestions to Improve"
          eyebrow="Coaching notes"
          action={
            <Link to="/coach" className="text-xs font-semibold text-primary hover:underline">
              Open AI Coach
            </Link>
          }
          bodyClassName="space-y-2.5"
        >
          {day.suggestions.map((s, i) => (
            <InsightCard
              key={s.id}
              index={i + 1}
              title={s.title}
              detail={s.detail}
              severity={s.severity}
            />
          ))}
        </SectionCard>
      </div>

      {/* Key takeaway */}
      <div className="panel border-primary/30 bg-primary/8 p-4 sm:p-5">
        <p className="label-eyebrow text-primary">Key takeaway</p>
        <p className="mt-1.5 text-base leading-relaxed font-medium sm:text-lg">{day.keyTakeaway}</p>
      </div>

      {/* Weekly load + recent progress */}
      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard title="Weekly Load" eyebrow="Last 7 days">
          <div className="flex h-32 items-end gap-2">
            {day.weeklyLoad.map((d) => (
              <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span className="numeric text-[0.625rem] text-muted-foreground">{d.load}</span>
                <div
                  className="w-full rounded-t-md bg-primary/70 transition-all"
                  style={{ height: `${Math.max(4, (d.load / maxLoad) * 100)}%` }}
                />
                <span className="text-[0.625rem] tracking-wide text-muted-foreground uppercase">
                  {d.day}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-border pt-3">
            <ChartLegend items={[{ label: "Daily training load", color: "var(--primary)" }]} />
          </div>
        </SectionCard>

        <SectionCard
          title="Recent Progress"
          eyebrow="Rolling 4 weeks"
          action={
            <Link to="/progress" className="text-xs font-semibold text-primary hover:underline">
              All trends
            </Link>
          }
        >
          <div className="grid gap-2 sm:grid-cols-2">
            {day.recentProgress.map((p) => (
              <StatCard
                key={p.label}
                label={p.label}
                value={p.value}
                delta={p.delta}
                deltaPositive={p.positive}
                tone={p.positive ? "success" : "danger"}
              />
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
