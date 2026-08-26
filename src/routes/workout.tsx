import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  CloudOff,
  Loader2,
  Minus,
  Pause,
  Play,
  Plus,
  Repeat2,
  RotateCcw,
  Timer,
  Trophy,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageHeader } from "@/components/irondesk/app-shell";
import { EmptyState, MetricTile, Pill, ProgressBar, SectionCard } from "@/components/irondesk/primitives";
import { AssignedWorkoutCard } from "@/components/irondesk/program-panels";
import { TemplateLibrary } from "@/components/irondesk/template-library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth/auth-provider";
import { exercisesQuery, historyQuery, workoutQuery } from "@/lib/irondesk/queries";
import * as repo from "@/lib/irondesk/repo";
import type { ActiveWorkout, SetEntry, WorkoutExercise, WorkoutTemplate } from "@/lib/irondesk/types";
import { formatLoadGuidance, fromKg, toKg, weightUnit } from "@/lib/irondesk/units";
import { useIronDeskInvalidate, useModeData, useServiceMode } from "@/lib/irondesk/use-data";
import { useUnits } from "@/lib/irondesk/use-units";

export const Route = createFileRoute("/workout")({
  head: () => ({
    meta: [
      { title: "Active Workout — IronDesk" },
      {
        name: "description",
        content:
          "Log sets, reps, RPE and rest in a one-handed workout console built for training under the bar.",
      },
      { property: "og:title", content: "Active Workout — IronDesk" },
      { property: "og:description", content: "One-handed set logging with live volume and effort." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkoutPage,
});

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function mmss(sec: number) {
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

function uid() {
  return `local-${Math.random().toString(36).slice(2, 9)}`;
}

type SaveState = "saved" | "saving" | "error";

function WorkoutPage() {
  const mode = useServiceMode();
  const active = useModeData(workoutQuery);
  const library = useModeData(exercisesQuery);

  if (!active) return <WorkoutStart library={library} live={mode === "live"} />;
  return (
    <div className="space-y-4">
      <WorkoutConsole key={active.id} initial={active} library={library} live={mode === "live"} />
      {/* Browsable while training; starting is blocked until this session ends. */}
      <TemplateLibrary
        onStart={() => undefined}
        busy={false}
        canStart={false}
        note="Finish or cancel the session above to start one of these workouts."
      />
    </div>
  );
}

/** Launcher: IronDesk Original templates, a blank session, or a recent repeat. */
function WorkoutStart({
  library,
  live,
}: {
  library: { id: string; name: string; muscle: string; equipment: string }[];
  live: boolean;
}) {
  const invalidate = useIronDeskInvalidate();
  const { data: history } = useQuery({ ...historyQuery("live"), enabled: live });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startTemplate = async (template: WorkoutTemplate) => {
    setBusy(true);
    setError(null);
    try {
      await repo.startWorkoutFromTemplate(template.id);
      invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start that template.");
    } finally {
      setBusy(false);
    }
  };

  const begin = async (input: Parameters<typeof repo.startWorkout>[0]) => {
    setBusy(true);
    setError(null);
    try {
      await repo.startWorkout(input);
      invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the session.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Start Training"
        subtitle="Train your assigned program, pick an IronDesk Original, open a blank session, or repeat recent work."
      />

      {/* Assigned work first: the program decides the order, free training does not. */}
      <AssignedWorkoutCard />

      {error && (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <TemplateLibrary
        onStart={(t) => void startTemplate(t)}
        busy={busy}
        canStart={live}
        note="Demo mode is read-only — sign in to start a template and save your sets."
      />

      <SectionCard title="New Session" eyebrow="Blank">
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void begin({ title: "Strength Session", focus: "Full body", kind: "strength" })}>
            <Plus className="size-4" /> Strength session
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void begin({ title: "Conditioning", focus: "Conditioning", kind: "conditioning" })}
          >
            <Plus className="size-4" /> Conditioning
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Sessions save as you log. You can leave and resume from any device.
        </p>
      </SectionCard>

      <SectionCard title="Repeat Recent" eyebrow="Template">
        {history && history.length > 0 ? (
          <div className="space-y-2">
            {history.slice(0, 5).map((session) => (
              <button
                key={session.id}
                disabled={busy}
                onClick={() =>
                  void begin({
                    title: session.title,
                    focus: session.bodyParts.join(", "),
                    cloneFromSessionId: session.id,
                  })
                }
                className="flex w-full items-center justify-between rounded-lg border border-border bg-surface-2/40 px-3 py-2.5 text-left transition hover:border-primary/50"
              >
                <span>
                  <span className="block text-sm font-semibold">{session.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {session.date} · {session.bodyParts.join(", ") || session.kind}
                  </span>
                </span>
                <RotateCcw className="size-4 text-primary" />
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No previous sessions"
            description="Once you complete a session it becomes a one-tap template."
          />
        )}
      </SectionCard>

      <SectionCard title="Library" eyebrow="Reference">
        <div className="flex flex-wrap gap-2">
          {library.slice(0, 10).map((l) => (
            <span key={l.id} className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-semibold">
              {l.name}
            </span>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function WorkoutConsole({
  initial,
  library,
  live,
}: {
  initial: ActiveWorkout;
  library: { id: string; name: string; muscle: string; equipment: string }[];
  live: boolean;
}) {
  const invalidate = useIronDeskInvalidate();
  const units = useUnits();
  const unit = weightUnit(units);

  const [exercises, setExercises] = useState<WorkoutExercise[]>(initial.exercises);
  const [notes, setNotes] = useState(initial.notes);
  const [elapsed, setElapsed] = useState(initial.elapsedSec);
  const [running, setRunning] = useState(true);
  const [rest, setRest] = useState<number | null>(null);
  const [restStarted, setRestStarted] = useState<number | null>(null);
  const [subFor, setSubFor] = useState<string | null>(null);
  const [summary, setSummary] = useState<repo.WorkoutSummary | null>(null);
  const [confirming, setConfirming] = useState<"finish" | "cancel" | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef(0);
  const busySets = useRef<Set<string>>(new Set());

  /** Runs a write in live mode and tracks saving/saved/error for the UI. */
  const persist = useCallback(
    async (task: () => Promise<void>) => {
      if (!live) return;
      pending.current += 1;
      setSaveState("saving");
      try {
        await task();
        setSaveError(null);
        if (pending.current === 1) setSaveState("saved");
      } catch (caught) {
        setSaveError(caught instanceof Error ? caught.message : "Change not saved.");
        setSaveState("error");
      } finally {
        pending.current -= 1;
      }
    },
    [live],
  );

  useEffect(() => {
    if (!running || summary) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [running, summary]);

  useEffect(() => {
    if (rest === null) return;
    if (rest <= 0) {
      setRest(null);
      return;
    }
    const t = setTimeout(() => setRest((r) => (r === null ? null : r - 1)), 1000);
    return () => clearTimeout(t);
  }, [rest]);

  // Debounced session-notes autosave.
  useEffect(() => {
    if (!live || notes === initial.notes) return;
    const t = setTimeout(() => {
      void persist(() => repo.updateSessionMeta(initial.id, { notes }));
    }, 700);
    return () => clearTimeout(t);
  }, [notes, live, initial.id, initial.notes, persist]);

  const totals = useMemo(() => {
    const done = exercises.flatMap((e) => e.sets.filter((s) => s.done));
    return {
      sets: done.length,
      plannedSets: exercises.reduce((a, e) => a + e.sets.length, 0),
      reps: done.reduce((a, s) => a + s.reps, 0),
      volume: done.reduce((a, s) => a + s.reps * s.weightKg, 0),
      rpe: done.length ? done.reduce((a, s) => a + s.rpe, 0) / done.length : 0,
    };
  }, [exercises]);

  const patchLocal = (exId: string, setId: string, patch: Partial<SetEntry>) =>
    setExercises((prev) =>
      prev.map((e) =>
        e.id === exId ? { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) } : e,
      ),
    );

  const editSet = (exId: string, setId: string, patch: Partial<SetEntry>) => {
    patchLocal(exId, setId, patch);
    if (setId.startsWith("local-")) return;
    void persist(() =>
      repo.updateSet(setId, {
        ...(patch.weightKg !== undefined ? { weightKg: patch.weightKg } : {}),
        ...(patch.reps !== undefined ? { reps: patch.reps } : {}),
        ...(patch.rpe !== undefined ? { rpe: patch.rpe } : {}),
      }),
    );
  };

  const toggleSet = (exId: string, setId: string) => {
    const set = exercises.find((e) => e.id === exId)?.sets.find((s) => s.id === setId);
    if (!set) return;
    const next = !set.done;
    patchLocal(exId, setId, { done: next });
    if (next) {
      // Prefer the template's prescribed rest when the session came from one.
      setRest(exercises.find((e) => e.id === exId)?.restSeconds ?? 120);
      setRestStarted(Date.now());
    }
    if (setId.startsWith("local-")) return;
    const restSeconds = next && restStarted ? Math.round((Date.now() - restStarted) / 1000) : undefined;
    void persist(() =>
      repo.updateSet(setId, {
        completed: next,
        weightKg: set.weightKg,
        reps: set.reps,
        rpe: set.rpe,
        ...(restSeconds ? { restSeconds } : {}),
      }),
    );
  };

  const addSet = async (exId: string) => {
    if (busySets.current.has(exId)) return; // guards duplicate rows from rapid taps
    busySets.current.add(exId);
    const ex = exercises.find((e) => e.id === exId);
    const last = ex?.sets[ex.sets.length - 1];
    const draft: SetEntry = {
      id: uid(),
      weightKg: last?.weightKg ?? 20,
      reps: last?.reps ?? 8,
      rpe: last?.rpe ?? 7,
      done: false,
    };
    setExercises((prev) => prev.map((e) => (e.id === exId ? { ...e, sets: [...e.sets, draft] } : e)));
    if (live && !exId.startsWith("local-")) {
      await persist(async () => {
        const id = await repo.addSet(exId, { weightKg: draft.weightKg, reps: draft.reps, rpe: draft.rpe });
        setExercises((prev) =>
          prev.map((e) =>
            e.id === exId ? { ...e, sets: e.sets.map((s) => (s.id === draft.id ? { ...s, id } : s)) } : e,
          ),
        );
      });
    }
    busySets.current.delete(exId);
  };

  const removeSet = (exId: string, setId: string) => {
    setExercises((prev) =>
      prev.map((e) => (e.id === exId ? { ...e, sets: e.sets.filter((s) => s.id !== setId) } : e)),
    );
    if (!setId.startsWith("local-")) void persist(() => repo.deleteSet(setId));
  };

  const addExercise = async (item: { id: string; name: string; muscle: string; equipment: string }) => {
    const localId = uid();
    setExercises((prev) => [
      ...prev,
      {
        id: localId,
        name: item.name,
        muscle: item.muscle,
        equipment: item.equipment,
        targetSets: 3,
        targetReps: "8-10",
        previous: "No prior data",
        sets: [],
      },
    ]);
    if (!live) return;
    await persist(async () => {
      const id = await repo.addSessionExercise(initial.id, {
        exerciseId: item.id,
        name: item.name,
        muscle: item.muscle,
        equipment: item.equipment,
      });
      setExercises((prev) => prev.map((e) => (e.id === localId ? { ...e, id } : e)));
    });
  };

  const removeExercise = (exId: string) => {
    setExercises((prev) => prev.filter((e) => e.id !== exId));
    if (!exId.startsWith("local-")) void persist(() => repo.removeSessionExercise(exId));
  };

  const substitute = (exId: string, item: { id: string; name: string; muscle: string; equipment: string }) => {
    setExercises((prev) =>
      prev.map((e) =>
        e.id === exId
          ? { ...e, name: item.name, muscle: item.muscle, equipment: item.equipment, previous: "Substituted — no prior data" }
          : e,
      ),
    );
    setSubFor(null);
    if (!exId.startsWith("local-")) {
      void persist(() =>
        repo.substituteSessionExercise(exId, {
          exerciseId: item.id,
          name: item.name,
          muscle: item.muscle,
          equipment: item.equipment,
        }),
      );
    }
  };

  const finish = async () => {
    setConfirming(null);
    setRunning(false);
    if (!live) {
      setSummary({
        sessionId: initial.id,
        title: initial.title,
        durationMin: Math.round(elapsed / 60),
        sets: totals.sets,
        reps: totals.reps,
        tonnageKg: Math.round(totals.volume),
        avgRpe: Number(totals.rpe.toFixed(1)),
      });
      return;
    }
    try {
      const result = await repo.finishWorkout(initial.id);
      setSummary(result);
      invalidate();
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not finish the session.");
      setSaveState("error");
    }
  };

  const cancel = async () => {
    setConfirming(null);
    if (live) {
      await persist(() => repo.cancelWorkout(initial.id));
      invalidate();
    }
  };

  if (summary) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Workout complete" subtitle={summary.title} />
        <SectionCard title="Session summary" eyebrow={live ? "Saved to your account" : "Demo — not saved"}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricTile label="Duration" value={`${summary.durationMin}m`} />
            <MetricTile label="Sets" value={summary.sets} tone="primary" />
            <MetricTile label="Reps" value={summary.reps} />
            <MetricTile
              label="Volume"
              value={fromKg(summary.tonnageKg, units).toLocaleString()}
              unit={unit}
              tone="warning"
            />
          </div>
          <div className="mt-4 space-y-2">
            {exercises.map((e) => (
              <div key={e.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0">
                <p className="text-sm font-semibold">{e.name}</p>
                <p className="numeric text-right text-xs text-muted-foreground">
                  {e.sets
                    .filter((s) => s.done)
                    .map((s) => `${fromKg(s.weightKg, units)}×${s.reps}`)
                    .join("  ·  ") || "—"}
                </p>
              </div>
            ))}
          </div>
          {notes && (
            <p className="mt-4 rounded-lg border border-border bg-surface-2/60 p-3 text-xs text-muted-foreground">
              {notes}
            </p>
          )}
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-4">
      <PageHeader
        title={initial.title}
        subtitle={`${initial.focus} · live session`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setConfirming("cancel")}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => setConfirming("finish")} className="font-semibold">
              Finish
            </Button>
          </div>
        }
      />

      <div className="panel sticky top-14 z-10 grid gap-3 p-3.5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center sm:p-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="label-eyebrow">Elapsed</p>
            <p className="numeric text-3xl leading-none font-bold">{fmt(elapsed)}</p>
          </div>
          <Button size="icon" variant="secondary" onClick={() => setRunning((r) => !r)}>
            {running ? <Pause className="size-4" /> : <Play className="size-4" />}
          </Button>
          <div className="ml-1">
            {rest === null ? (
              <Button size="sm" variant="secondary" onClick={() => setRest(120)}>
                <Timer className="size-4" /> Rest 2:00
              </Button>
            ) : (
              <div className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/12 px-2.5 py-1.5">
                <span className="numeric text-lg font-bold text-primary">{mmss(rest)}</span>
                <button onClick={() => setRest((r) => (r ?? 0) + 30)} className="text-xs font-semibold text-primary">
                  +30s
                </button>
                <button onClick={() => setRest(null)} className="text-muted-foreground" aria-label="Clear rest timer">
                  <X className="size-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <MetricTile label="Sets" value={`${totals.sets}/${totals.plannedSets}`} tone="primary" />
          <MetricTile label="Reps" value={totals.reps} />
          <MetricTile label="Volume" value={fromKg(totals.volume, units).toLocaleString()} unit={unit} tone="warning" />
          <MetricTile label="Avg RPE" value={totals.rpe.toFixed(1)} tone="success" />
        </div>
      </div>

      {live && (
        <div className="flex items-center gap-2 text-xs">
          {saveState === "saving" && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Saving…
            </span>
          )}
          {saveState === "saved" && (
            <span className="flex items-center gap-1.5 text-success">
              <Check className="size-3.5" /> All changes saved
            </span>
          )}
          {saveState === "error" && (
            <span className="flex items-center gap-1.5 text-danger">
              <CloudOff className="size-3.5" /> {saveError ?? "Unsaved changes"} — edits kept locally, retry any change.
            </span>
          )}
        </div>
      )}

      {confirming && (
        <div className="panel border-danger/40 bg-danger/10 p-4">
          <p className="text-sm font-semibold">
            {confirming === "finish" ? "Finish this workout?" : "Cancel this workout?"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {confirming === "finish"
              ? `${Math.max(0, totals.plannedSets - totals.sets)} logged sets are still unchecked.`
              : "The session is kept as cancelled — logged sets are not deleted."}
          </p>
          <div className="mt-3 flex gap-2">
            {confirming === "finish" ? (
              <Button onClick={() => void finish()}>
                <Trophy className="size-4" /> Finish workout
              </Button>
            ) : (
              <Button variant="destructive" onClick={() => void cancel()}>
                Cancel workout
              </Button>
            )}
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Keep training
            </Button>
          </div>
        </div>
      )}

      {exercises.length === 0 ? (
        <EmptyState
          title="No exercises yet"
          description="Add the first movement to start logging sets."
          action={library[0] ? <Button onClick={() => void addExercise(library[0]!)}>Add {library[0]!.name}</Button> : undefined}
        />
      ) : (
        exercises.map((ex) => {
          const doneSets = ex.sets.filter((s) => s.done).length;
          const alternatives = library.filter((l) => l.muscle === ex.muscle && l.name !== ex.name).slice(0, 4);
          return (
            <SectionCard
              key={ex.id}
              title={ex.name}
              eyebrow={`${ex.muscle} · ${ex.equipment}`}
              action={
                <div className="flex items-center gap-2">
                  <Pill tone={doneSets >= ex.targetSets ? "success" : "default"}>
                    {doneSets}/{ex.targetSets} sets
                  </Pill>
                  <Button size="sm" variant="ghost" onClick={() => setSubFor(ex.id === subFor ? null : ex.id)} aria-label="Substitute">
                    <Repeat2 className="size-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => removeExercise(ex.id)} aria-label="Remove exercise">
                    <X className="size-4" />
                  </Button>
                </div>
              }
            >
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Target:{" "}
                  <span className="numeric font-semibold text-foreground">
                    {ex.targetSets} × {ex.targetReps}
                  </span>
                </span>
                {(() => {
                  const load = formatLoadGuidance(ex.loadGuidance, ex.sourceLoadUnit, units);
                  return load ? (
                    <span title={load.source ? `Source: ${load.source}` : undefined}>
                      Load: <span className="numeric font-semibold text-foreground">{load.text}</span>
                    </span>
                  ) : null;
                })()}
                {ex.restSeconds != null && (
                  <span>
                    Rest: <span className="numeric font-semibold text-foreground">{mmss(ex.restSeconds)}</span>
                  </span>
                )}
                <span>
                  Last time: <span className="numeric font-semibold text-foreground">{ex.previous}</span>
                </span>
                {ex.isHeavy && <Pill tone="warning">Heavy</Pill>}
                {ex.isDropSet && <Pill tone="primary">Drop set</Pill>}
              </div>

              {subFor === ex.id && (
                <div className="mb-3 rounded-lg border border-primary/30 bg-primary/8 p-3">
                  <p className="label-eyebrow text-primary">Substitute movement</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {alternatives.map((l) => (
                      <button
                        key={l.id}
                        onClick={() => substitute(ex.id, l)}
                        className="rounded-md border border-border-strong bg-surface-2 px-2.5 py-1.5 text-xs font-semibold hover:border-primary/50"
                      >
                        {l.name}
                      </button>
                    ))}
                    {alternatives.length === 0 && (
                      <p className="text-xs text-muted-foreground">No equipment-matched alternatives.</p>
                    )}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="grid grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem_1.5rem] items-center gap-2 px-1">
                  <span className="label-eyebrow text-[0.5625rem]">Set</span>
                  <span className="label-eyebrow text-[0.5625rem]">{unit}</span>
                  <span className="label-eyebrow text-[0.5625rem]">Reps</span>
                  <span className="label-eyebrow text-[0.5625rem]">RPE</span>
                  <span />
                  <span />
                </div>
                {ex.sets.map((s, i) => (
                  <div
                    key={s.id}
                    className={`grid grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem_1.5rem] items-center gap-2 rounded-lg border p-1.5 ${
                      s.done ? "border-success/35 bg-success/8" : "border-border bg-surface-2/40"
                    }`}
                  >
                    <span className="numeric text-center text-sm font-bold text-muted-foreground">{i + 1}</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={fromKg(s.weightKg, units)}
                      onChange={(e) => editSet(ex.id, s.id, { weightKg: toKg(Number(e.target.value), units) })}
                      className="numeric h-10 px-1 text-center text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={s.reps}
                      onChange={(e) => editSet(ex.id, s.id, { reps: Number(e.target.value) })}
                      className="numeric h-10 px-1 text-center text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      value={s.rpe}
                      onChange={(e) => editSet(ex.id, s.id, { rpe: Number(e.target.value) })}
                      className="numeric h-10 px-1 text-center text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <Button
                      size="icon"
                      variant={s.done ? "default" : "secondary"}
                      className="size-10"
                      onClick={() => toggleSet(ex.id, s.id)}
                      aria-label="Toggle set complete"
                    >
                      <Check className="size-4" />
                    </Button>
                    <button
                      onClick={() => removeSet(ex.id, s.id)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:text-danger"
                      aria-label="Remove set"
                    >
                      <Minus className="size-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3">
                <Button variant="secondary" className="h-11 w-full" onClick={() => void addSet(ex.id)}>
                  <Plus className="size-4" /> Quick add set
                </Button>
              </div>
              <div className="mt-3">
                <ProgressBar
                  value={doneSets}
                  max={Math.max(1, ex.targetSets)}
                  tone="success"
                  size="sm"
                  label="Completion"
                  right={`${Math.round((doneSets / Math.max(1, ex.targetSets)) * 100)}%`}
                />
              </div>
            </SectionCard>
          );
        })
      )}

      <SectionCard title="Add Exercise" eyebrow="From library">
        <div className="flex flex-wrap gap-2">
          {library.slice(0, 10).map((l) => (
            <button
              key={l.id}
              onClick={() => void addExercise(l)}
              className="flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-2 px-3 py-2 text-xs font-semibold hover:border-primary/50"
            >
              <Plus className="size-3.5" /> {l.name}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Session Notes" eyebrow="Context for the log">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Bar speed, cues, pain flags, environment…"
        />
      </SectionCard>
    </div>
  );
}
