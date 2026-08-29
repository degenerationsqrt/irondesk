import { createFileRoute, Link } from "@tanstack/react-router";
import { Pencil, Plus, Search, Star } from "lucide-react";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { EmptyState, MetricTile, Pill, SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExerciseDialog } from "@/components/irondesk/exercise-dialog";
import { useAuth } from "@/lib/auth/auth-provider";
import { exercisesQuery } from "@/lib/irondesk/queries";
import * as repo from "@/lib/irondesk/repo";
import type { Exercise } from "@/lib/irondesk/types";
import { formatWeightedSet, fromKg, weightUnit } from "@/lib/irondesk/units";
import { useIronDeskInvalidate, useModeData } from "@/lib/irondesk/use-data";
import { useUnits } from "@/lib/irondesk/use-units";

export const Route = createFileRoute("/exercises/")({
  head: () => ({
    meta: [
      { title: "Exercise Library — IronDesk" },
      {
        name: "description",
        content:
          "Search the IronDesk movement library by muscle group, equipment and favorites, with per-exercise performance history.",
      },
      { property: "og:title", content: "Exercise Library — IronDesk" },
      { property: "og:description", content: "Movements, equipment filters and lift history." },
    ],
  }),
  component: ExercisesPage,
});

function ExercisesPage() {
  const exercises = useModeData(exercisesQuery);
  const [q, setQ] = useState("");
  const [muscle, setMuscle] = useState<string | "all">("all");
  const [equipment, setEquipment] = useState<string | "all">("all");
  const [mode, setMode] = useState<"all" | "favorites" | "recent" | "custom">("all");
  const [dialog, setDialog] = useState<{ open: boolean; exercise?: Exercise }>({ open: false });
  const { mode: dataMode } = useAuth();
  const live = dataMode === "live";
  const units = useUnits();
  const invalidate = useIronDeskInvalidate();

  const toggleFavorite = async (exercise: Exercise) => {
    if (!live) return;
    await repo.toggleFavorite(exercise.id, !exercise.favorite);
    invalidate();
  };

  const muscles = useMemo(
    () => Array.from(new Set(exercises.map((e) => e.muscle))).sort(),
    [exercises],
  );
  const equipments = useMemo(
    () => Array.from(new Set(exercises.map((e) => e.equipment))).sort(),
    [exercises],
  );

  const filtered = useMemo(
    () =>
      exercises
        .filter((e) =>
          q.trim()
            ? `${e.name} ${e.muscle} ${e.equipment}`.toLowerCase().includes(q.trim().toLowerCase())
            : true,
        )
        .filter((e) => (muscle === "all" ? true : e.muscle === muscle))
        .filter((e) => (equipment === "all" ? true : e.equipment === equipment))
        .filter((e) =>
          mode === "favorites"
            ? e.favorite
            : mode === "recent"
              ? Boolean(e.lastPerformed)
              : mode === "custom"
                ? Boolean(e.isCustom)
                : true,
        ),
    [exercises, q, muscle, equipment, mode],
  );

  const chip = (active: boolean) =>
    `rounded-md border px-2.5 py-1 text-xs font-semibold transition-colors ${
      active
        ? "border-primary/45 bg-primary/12 text-primary"
        : "border-border bg-surface-2 text-muted-foreground hover:text-foreground"
    }`;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Exercise Library"
        subtitle={`${exercises.length} movements with tracked history and estimated 1RM trends.`}
        action={
          live ? (
            <Button onClick={() => setDialog({ open: true })}>
              <Plus className="size-4" /> New movement
            </Button>
          ) : undefined
        }
      />

      <SectionCard bodyClassName="space-y-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search movements, muscles or equipment"
            className="h-11 pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(["all", "favorites", "recent", "custom"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={chip(mode === m)}>
              {m === "all"
                ? "All"
                : m === "favorites"
                  ? "Favorites"
                  : m === "recent"
                    ? "Recent"
                    : "Custom"}
            </button>
          ))}
        </div>
        <div>
          <p className="label-eyebrow mb-1.5">Muscle group</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setMuscle("all")} className={chip(muscle === "all")}>
              All
            </button>
            {muscles.map((m) => (
              <button key={m} onClick={() => setMuscle(m)} className={chip(muscle === m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label-eyebrow mb-1.5">Equipment</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setEquipment("all")} className={chip(equipment === "all")}>
              All
            </button>
            {equipments.map((m) => (
              <button key={m} onClick={() => setEquipment(m)} className={chip(equipment === m)}>
                {m}
              </button>
            ))}
          </div>
        </div>
      </SectionCard>

      {filtered.length === 0 ? (
        <EmptyState
          title="No movements found"
          description="Try a different search term or clear the muscle and equipment filters."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setQ("");
                setMuscle("all");
                setEquipment("all");
                setMode("all");
              }}
            >
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((e) => (
            <Link
              key={e.id}
              to="/exercises/$exerciseId"
              params={{ exerciseId: e.id }}
              className="panel p-4 transition-colors hover:border-primary/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="label-eyebrow">{e.pattern}</p>
                  <p className="truncate text-base font-semibold">{e.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {e.muscle} · {e.equipment}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  {live && e.isCustom && (
                    <button
                      onClick={(event) => {
                        event.preventDefault();
                        setDialog({ open: true, exercise: e });
                      }}
                      aria-label={`Edit ${e.name}`}
                      className="text-muted-foreground transition-colors hover:text-primary"
                    >
                      <Pencil className="size-4" />
                    </button>
                  )}
                  {live ? (
                    <button
                      onClick={(event) => {
                        event.preventDefault();
                        void toggleFavorite(e);
                      }}
                      aria-label={`Toggle favorite for ${e.name}`}
                    >
                      <Star
                        className={`size-4 ${e.favorite ? "fill-warning text-warning" : "text-muted-foreground"}`}
                      />
                    </button>
                  ) : (
                    e.favorite && <Star className="size-4 fill-warning text-warning" />
                  )}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MetricTile
                  label="Best set"
                  value={
                    e.best.weightKg > 0
                      ? formatWeightedSet(e.best.weightKg, e.best.reps, units)
                      : "—"
                  }
                  tone="warning"
                />
                <MetricTile
                  label="Est. 1RM"
                  value={
                    e.e1rmTrend.length
                      ? fromKg(e.e1rmTrend[e.e1rmTrend.length - 1]!.e1rm, units)
                      : "—"
                  }
                  unit={weightUnit(units)}
                  tone="primary"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {e.lastPerformed ? <Pill>Last {e.lastPerformed}</Pill> : <Pill>Not logged</Pill>}
                {e.secondary.slice(0, 2).map((s) => (
                  <Pill key={s}>{s}</Pill>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
      {dialog.open && (
        <ExerciseDialog
          open={dialog.open}
          onOpenChange={(open) => setDialog(open ? dialog : { open: false })}
          {...(dialog.exercise ? { exercise: dialog.exercise } : {})}
        />
      )}
    </div>
  );
}
