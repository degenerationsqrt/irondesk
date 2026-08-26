import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, Rows3, X } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/irondesk/app-shell";
import {
  DataRow,
  EmptyState,
  MetricTile,
  Pill,
  SectionCard,
  type Tone,
} from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import { assignedSessionContextsQuery, historyQuery } from "@/lib/irondesk/queries";
import { useModeData, useServiceMode } from "@/lib/irondesk/use-data";
import type { HistorySession } from "@/lib/irondesk/types";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Training History — IronDesk" },
      {
        name: "description",
        content:
          "Filter every logged session by date, type, body part and intensity, then drill into set-by-set detail.",
      },
      { property: "og:title", content: "Training History — IronDesk" },
      { property: "og:description", content: "Every session, filterable and drillable." },
    ],
  }),
  component: HistoryPage,
});

const intensityTone: Record<HistorySession["intensity"], Tone> = {
  light: "default",
  moderate: "success",
  hard: "warning",
  peak: "danger",
};

function Chips<T extends string>({
  values,
  active,
  onSelect,
  allLabel = "All",
}: {
  values: T[];
  active: T | "all";
  onSelect: (v: T | "all") => void;
  allLabel?: string;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(["all", ...values] as (T | "all")[]).map((v) => (
        <button
          key={v}
          onClick={() => onSelect(v)}
          className={`rounded-md border px-2.5 py-1 text-xs font-semibold capitalize transition-colors ${
            active === v
              ? "border-primary/45 bg-primary/12 text-primary"
              : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
          }`}
        >
          {v === "all" ? allLabel : v}
        </button>
      ))}
    </div>
  );
}

function HistoryPage() {
  const sessions = useModeData(historyQuery);
  // Program context for sessions that were started from an assignment.
  const live = useServiceMode() === "live";
  const { data: programContext } = useQuery({ ...assignedSessionContextsQuery, enabled: live });
  const programOf = (id: string) => programContext?.[id] ?? null;
  const [view, setView] = useState<"cards" | "table">("cards");
  const [kind, setKind] = useState<HistorySession["kind"] | "all">("all");
  const [intensity, setIntensity] = useState<HistorySession["intensity"] | "all">("all");
  const [bodyPart, setBodyPart] = useState<string | "all">("all");
  const [range, setRange] = useState<"7" | "30" | "all">("30");
  const [openId, setOpenId] = useState<string | null>(null);

  const bodyParts = useMemo(
    () => Array.from(new Set(sessions.flatMap((s) => s.bodyParts))).sort(),
    [sessions],
  );

  const filtered = useMemo(() => {
    const limit = range === "all" ? sessions.length : range === "7" ? 7 : 30;
    return sessions
      .filter((s) => (kind === "all" ? true : s.kind === kind))
      .filter((s) => (intensity === "all" ? true : s.intensity === intensity))
      .filter((s) => (bodyPart === "all" ? true : s.bodyParts.includes(bodyPart)))
      .slice(0, limit);
  }, [sessions, kind, intensity, bodyPart, range]);

  const open = sessions.find((s) => s.id === openId);
  const totals = filtered.reduce(
    (a, s) => ({
      sessions: a.sessions + 1,
      minutes: a.minutes + s.durationMin,
      tonnage: a.tonnage + s.tonnageKg,
      prs: a.prs + s.prCount,
    }),
    { sessions: 0, minutes: 0, tonnage: 0, prs: 0 },
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Training History"
        subtitle="Every logged session, filterable by type, body part and intensity."
        action={
          <div className="flex gap-1 rounded-lg border border-border bg-surface-2 p-1">
            <Button
              size="sm"
              variant={view === "cards" ? "default" : "ghost"}
              onClick={() => setView("cards")}
            >
              <LayoutGrid className="size-4" />
            </Button>
            <Button
              size="sm"
              variant={view === "table" ? "default" : "ghost"}
              onClick={() => setView("table")}
            >
              <Rows3 className="size-4" />
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="Sessions" value={totals.sessions} tone="primary" />
        <MetricTile label="Minutes" value={totals.minutes} />
        <MetricTile label="Tonnage" value={(totals.tonnage / 1000).toFixed(1)} unit="t" tone="warning" />
        <MetricTile label="PRs" value={totals.prs} tone="success" />
      </div>

      <SectionCard title="Filters" eyebrow="Refine the log" bodyClassName="space-y-3">
        <div>
          <p className="label-eyebrow mb-1.5">Date range</p>
          <Chips
            values={["7", "30"] as const}
            active={range}
            onSelect={(v) => setRange(v as "7" | "30" | "all")}
            allLabel="All time"
          />
        </div>
        <div>
          <p className="label-eyebrow mb-1.5">Type</p>
          <Chips
            values={["strength", "cardio", "conditioning", "mobility"] as HistorySession["kind"][]}
            active={kind}
            onSelect={setKind}
          />
        </div>
        <div>
          <p className="label-eyebrow mb-1.5">Body part</p>
          <Chips values={bodyParts} active={bodyPart} onSelect={setBodyPart} />
        </div>
        <div>
          <p className="label-eyebrow mb-1.5">Intensity</p>
          <Chips
            values={["light", "moderate", "hard", "peak"] as HistorySession["intensity"][]}
            active={intensity}
            onSelect={setIntensity}
          />
        </div>
      </SectionCard>

      {filtered.length === 0 ? (
        <EmptyState
          title="No sessions match these filters"
          description="Widen the date range or clear a filter to see more of your log."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setKind("all");
                setIntensity("all");
                setBodyPart("all");
                setRange("all");
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : view === "cards" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => setOpenId(s.id)}
              className="panel p-4 text-left transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="label-eyebrow">{s.date}</p>
                  <p className="truncate text-base font-semibold">{s.title}</p>
                </div>
                <Pill tone={intensityTone[s.intensity]}>{s.intensity}</Pill>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MetricTile label="Duration" value={s.durationMin} unit="min" />
                <MetricTile label="Tonnage" value={s.tonnageKg.toLocaleString()} unit="kg" />
                <MetricTile label="Sets · Reps" value={`${s.sets}·${s.reps}`} />
                <MetricTile label="Avg RPE" value={s.avgRpe} tone="warning" />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {s.bodyParts.map((b) => (
                  <Pill key={b}>{b}</Pill>
                ))}
                {s.prCount > 0 && <Pill tone="success">{s.prCount} PR</Pill>}
                {programOf(s.id) && <Pill tone="primary">{programOf(s.id)!.programName}</Pill>}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="panel overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border">
                {["Date", "Session", "Type", "Duration", "Tonnage", "Sets", "RPE", "PRs"].map((h) => (
                  <th key={h} className="label-eyebrow px-4 py-2.5 text-left">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => setOpenId(s.id)}
                  className="cursor-pointer border-b border-border last:border-0 hover:bg-surface-2/60"
                >
                  <td className="numeric px-4 py-2.5">{s.date}</td>
                  <td className="px-4 py-2.5 font-medium">
                    {s.title}
                    {programOf(s.id) && (
                      <span className="ml-2 text-xs font-normal text-primary">
                        {programOf(s.id)!.programName}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 capitalize text-muted-foreground">{s.kind}</td>
                  <td className="numeric px-4 py-2.5">{s.durationMin}m</td>
                  <td className="numeric px-4 py-2.5">{s.tonnageKg.toLocaleString()}</td>
                  <td className="numeric px-4 py-2.5">{s.sets}</td>
                  <td className="numeric px-4 py-2.5">{s.avgRpe}</td>
                  <td className="px-4 py-2.5">
                    {s.prCount > 0 ? <Pill tone="success">{s.prCount}</Pill> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail drawer */}
      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-background/70 backdrop-blur-sm">
          <div className="h-full w-full max-w-lg overflow-y-auto border-l border-border bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="label-eyebrow">{open.date}</p>
                <h2 className="text-xl font-bold tracking-tight">{open.title}</h2>
                {programOf(open.id) && (
                  <p className="mt-1 text-xs text-primary">
                    {programOf(open.id)!.programName} · workout {programOf(open.id)!.position}
                  </p>
                )}
              </div>
              <button onClick={() => setOpenId(null)} className="text-muted-foreground">
                <X className="size-5" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MetricTile label="Duration" value={open.durationMin} unit="min" />
              <MetricTile label="Calories" value={open.calories} unit="kcal" />
              <MetricTile label="Tonnage" value={open.tonnageKg.toLocaleString()} unit="kg" tone="warning" />
              <MetricTile label="Avg RPE" value={open.avgRpe} tone="primary" />
            </div>
            <div className="mt-5">
              <p className="label-eyebrow mb-2">Blocks</p>
              {open.blocks.map((b) => (
                <DataRow key={b.exercise} label={b.exercise} value={b.detail} />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {open.bodyParts.map((b) => (
                <Pill key={b}>{b}</Pill>
              ))}
              <Pill tone={intensityTone[open.intensity]}>{open.intensity}</Pill>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
