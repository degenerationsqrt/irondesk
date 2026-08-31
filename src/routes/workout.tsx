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
import { CardioLogForm } from "@/components/irondesk/cardio-log-form";
import { ExercisePicker } from "@/components/irondesk/exercise-picker";
import {
  EmptyState,
  MetricTile,
  Pill,
  ProgressBar,
  SectionCard,
} from "@/components/irondesk/primitives";
import { MethodExecutionCard, TrainingMethodSelector } from "@/components/irondesk/method-selector";
import { AssignedWorkoutCard } from "@/components/irondesk/program-panels";

import { TemplateLibrary } from "@/components/irondesk/template-library";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ManualCardioInput } from "@/lib/irondesk/cardio-log";
import { safeTimeZone } from "@/lib/irondesk/dates";
import {
  accountQuery,
  exercisesQuery,
  historyQuery,
  progressionQuery,
  specializationWindowsQuery,
  workoutQuery,
} from "@/lib/irondesk/queries";
import { startLibraryWorkout } from "@/lib/irondesk/programs";
import {
  doubleProgressionState,
  loadIncrementKg,
  loadIncrementLb,
  lookupPoints,
  parseTargetReps,
  suggestWorkingWeight,
  type WorkingWeightSuggestion,
} from "@/lib/irondesk/progression";
import {
  buildMethodPrescription,
  deriveMethodProfile,
  getMethod,
  methodSelectionDecision,
} from "@/lib/irondesk/training-methods";
import {
  antagonistPartnerCandidates,
  blackSetPlan,
  blackWindowState,
  canOpenBlackWindow,
  canRecordBlackExposure,
  circuitSlots,
  commitBlackApplication,
  currentBlackWindow,
  methodSetPlan,
  replaceCircuitStation,
  restSecondsForCompletedSet,
  parseMethodConfig,
  parseMethodSegmentConfig,
  planBlackBlockResult,
  preExhaustCandidates,
  selectAntagonistPartner,
  selectCircuitGroup,
  selectPreExhaustPlan,
  serializeMethodSegmentConfig,
  staggerCandidates,
  stationCandidates,
  volumeRecommendationForMuscle,
  type BlackExercisePrescription,
  type MethodConfig,
  type MethodSegmentConfig,
  type MethodSetPlan,
  type MovementCandidate,
} from "@/lib/irondesk/method-composition";

import * as repo from "@/lib/irondesk/repo";
import type {
  ActiveWorkout,
  Exercise,
  PersonalTemplateDraft,
  SetEntry,
  WorkoutExercise,
  WorkoutTemplate,
} from "@/lib/irondesk/types";
import {
  createClientWorkoutRecordId,
  type WorkoutMutation,
  type WorkoutMutationCommitResult,
} from "@/lib/irondesk/workout-mutation-outbox";
import { useWorkoutMutationQueue } from "@/lib/irondesk/use-workout-mutation-queue";
import {
  defaultSetWeightKg,
  formatLoadGuidance,
  formatWeightedSet,
  formatWeightText,
  fromKg,
  toKg,
  weightUnit,
} from "@/lib/irondesk/units";
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
      {
        property: "og:description",
        content: "One-handed set logging with live volume and effort.",
      },
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

type SaveState = "saved" | "saving" | "queued" | "error";

class DeferredWorkoutMutationError extends Error {
  constructor() {
    super("That change is safely queued. Reconnect before applying the rest of this method block.");
    this.name = "DeferredWorkoutMutationError";
  }
}
const previewCardioSave = async () => undefined;

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
        exercises={library}
        builderReadOnlyNote={
          mode === "live"
            ? "You can preview and arrange a custom workout now. Finish or cancel the active session before saving and starting it."
            : "Read-only preview. Sign in to save this workout to My Templates or start it."
        }
      />
      {mode === "demo" ? (
        <CardioLogForm live={false} timeZone="UTC" onSave={previewCardioSave} />
      ) : null}
    </div>
  );
}

/** Launcher: IronDesk Original templates, a blank session, or a recent repeat. */
function WorkoutStart({ library, live }: { library: Exercise[]; live: boolean }) {
  const invalidate = useIronDeskInvalidate();
  const { data: history } = useQuery({ ...historyQuery("live"), enabled: live });
  const { data: account } = useQuery({ ...accountQuery, enabled: live });
  const { data: progression } = useQuery({ ...progressionQuery("live"), enabled: live });
  const { data: specializationWindows } = useQuery({
    ...specializationWindowsQuery("live"),
    enabled: live,
  });
  const methodProfile = useMemo(
    () =>
      deriveMethodProfile({
        sessionDates: history?.map((session) => session.date) ?? [],
        averageReadiness: progression?.readiness ?? null,
        specializationWindowOpen: Boolean(currentBlackWindow(specializationWindows ?? [])),
      }),
    [history, progression?.readiness, specializationWindows],
  );
  const browserTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    [],
  );
  const timeZone = safeTimeZone(account?.profile?.timezone ?? browserTimeZone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startTemplate = async (template: WorkoutTemplate) => {
    setBusy(true);
    setError(null);
    try {
      await repo.startWorkoutFromTemplate(template.id, methodProfile);
      invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start that template.");
    } finally {
      setBusy(false);
    }
  };

  /** Assignment-only content, started as free training after acknowledgment. */
  const unlockTemplate = async (template: WorkoutTemplate) => {
    setBusy(true);
    setError(null);
    try {
      await startLibraryWorkout(template.id, true);
      invalidate();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock that workout.");
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

  const saveCardio = async (input: ManualCardioInput) => {
    await repo.logCardioSession(input);
    invalidate();
  };

  const createPersonal = async (draft: PersonalTemplateDraft) => {
    const templateId = await repo.createPersonalWorkoutTemplate(draft, methodProfile);
    invalidate();
    return templateId;
  };

  const startCreated = async (templateId: string) => {
    await repo.startWorkoutFromTemplate(templateId, methodProfile);
    invalidate();
  };

  const deletePersonal = async (templateId: string) => {
    await repo.deletePersonalWorkoutTemplate(templateId);
    invalidate();
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
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <TemplateLibrary
        onStart={(t) => void startTemplate(t)}
        {...(live ? { onUnlockStart: (t: WorkoutTemplate) => void unlockTemplate(t) } : {})}
        busy={busy}
        canStart={live}
        note="Demo mode is read-only — sign in to start a template and save your sets."
        exercises={library}
        methodProfile={methodProfile}
        {...(live
          ? {
              onCreatePersonal: createPersonal,
              onStartCreated: startCreated,
              onDeletePersonal: deletePersonal,
            }
          : {})}
      />

      <SectionCard title="New Session" eyebrow="Blank">
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={() =>
              void begin({ title: "Strength Session", focus: "Full body", kind: "strength" })
            }
          >
            <Plus className="size-4" /> Strength session
          </Button>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void begin({ title: "Conditioning", focus: "Conditioning", kind: "conditioning" })
            }
          >
            <Plus className="size-4" /> Strength / conditioning circuit
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Sessions save as you log. You can leave and resume from any device.
        </p>
      </SectionCard>

      <CardioLogForm key={timeZone} live={live} timeZone={timeZone} onSave={saveCardio} />

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
    </div>
  );
}

function WorkoutConsole({
  initial,
  library,
  live,
}: {
  initial: ActiveWorkout;
  library: Exercise[];
  live: boolean;
}) {
  const invalidate = useIronDeskInvalidate();
  const units = useUnits();
  const unit = weightUnit(units);
  const mode = useServiceMode();
  const progression = useQuery(progressionQuery(mode)).data;
  const sessionHistory = useQuery(historyQuery(mode)).data;
  const specializationWindows = useQuery(specializationWindowsQuery(mode)).data ?? [];
  const mutationQueue = useWorkoutMutationQueue();
  const commitWorkoutMutation = mutationQueue.commit;
  const queueIsDurable = mutationQueue.durable;

  /** The current IronDesk Black window — active or suspended, both are current. */
  const openBlackWindow = currentBlackWindow(specializationWindows);

  /**
   * Method eligibility is earned: experience and consistency are derived from
   * logged sessions, never self-declared.
   */
  const methodProfile = useMemo(
    () =>
      deriveMethodProfile({
        sessionDates: sessionHistory?.map((session) => session.date) ?? [],
        averageReadiness: progression?.readiness ?? null,
        specializationWindowOpen: Boolean(openBlackWindow),
      }),
    [sessionHistory, progression?.readiness, openBlackWindow],
  );

  /** Persisted per-exercise method selection, hydrated from the session rows. */
  const [methodByExercise, setMethodByExercise] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const ex of initial.exercises) if (ex.trainingMethodId) map[ex.id] = ex.trainingMethodId;
    return map;
  });
  const [methodConfigByExercise, setMethodConfigByExercise] = useState<
    Record<string, MethodConfig>
  >(() => {
    const map: Record<string, MethodConfig> = {};
    for (const ex of initial.exercises)
      map[ex.id] = parseMethodConfig(ex.trainingMethodConfig ?? {});
    return map;
  });
  const [methodPickerFor, setMethodPickerFor] = useState<string | null>(null);
  const [methodNotice, setMethodNotice] = useState<string | null>(null);
  const methodFor = (exId: string) => methodByExercise[exId] ?? "double-progression";
  const configFor = (exId: string) => methodConfigByExercise[exId] ?? {};
  const stackedMethodIds = useMemo(() => Object.values(methodByExercise), [methodByExercise]);

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
  const selectedExerciseIds = useMemo(
    () =>
      new Set(
        exercises.map((exercise) => exercise.exerciseId).filter((id): id is string => Boolean(id)),
      ),
    [exercises],
  );
  const pending = useRef(0);
  const busySets = useRef<Set<string>>(new Set());
  const lastAppliedAt = useRef<string | null>(mutationQueue.lastAppliedAt);
  const terminalMutationQueued = mutationQueue.items.some(
    (item) =>
      (item.mutation.kind === "session.finish" || item.mutation.kind === "session.cancel") &&
      item.mutation.sessionId === initial.id,
  );

  /** Runs a write in live mode and tracks saving/saved/error for the UI. */
  const persist = useCallback(
    async (task: () => Promise<void>, options?: { rethrow?: boolean }) => {
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
        if (options?.rethrow) throw caught;
      } finally {
        pending.current -= 1;
      }
    },
    [live],
  );

  /**
   * Persists the operation before attempting the network write. Connectivity
   * failures stay in the user-scoped outbox; validation/RLS conflicts pause
   * and require an explicit retry or discard.
   */
  const persistMutation = useCallback(
    async (
      mutation: WorkoutMutation,
      options?: { requireAcknowledgment?: boolean },
    ): Promise<WorkoutMutationCommitResult> => {
      if (!live) return { itemId: "demo", status: "applied" };
      setSaveState("saving");
      const result = await commitWorkoutMutation(mutation);
      if (result.status === "applied") {
        setSaveError(null);
        if (pending.current === 0) setSaveState("saved");
        return result;
      }
      if (result.status === "queued") {
        setSaveError(
          queueIsDurable
            ? "Connection interrupted. Your change is safely queued on this device."
            : "Connection interrupted. This change is kept only while this page stays open.",
        );
        setSaveState("queued");
        if (options?.requireAcknowledgment) throw new DeferredWorkoutMutationError();
        return result;
      }
      setSaveError("A queued change needs your attention.");
      setSaveState("error");
      if (options?.requireAcknowledgment)
        throw new Error("That change could not be saved. Review the queued-change warning.");
      return result;
    },
    [commitWorkoutMutation, live, queueIsDurable],
  );

  useEffect(() => {
    if (!live) return;
    if (mutationQueue.blockedCount > 0) {
      setSaveError(mutationQueue.lastError ?? "A queued change needs your attention.");
      setSaveState("error");
    } else if (mutationQueue.pendingCount > 0) {
      setSaveError(
        mutationQueue.durable
          ? "Connection interrupted. Your changes are safely queued on this device."
          : "Connection interrupted. Changes are kept only while this page stays open.",
      );
      setSaveState("queued");
    } else if (pending.current === 0) {
      setSaveError(null);
      setSaveState("saved");
    }
  }, [
    live,
    mutationQueue.blockedCount,
    mutationQueue.durable,
    mutationQueue.lastError,
    mutationQueue.pendingCount,
  ]);

  useEffect(() => {
    if (mutationQueue.lastAppliedAt && mutationQueue.lastAppliedAt !== lastAppliedAt.current) {
      lastAppliedAt.current = mutationQueue.lastAppliedAt;
      invalidate();
    }
  }, [invalidate, mutationQueue.lastAppliedAt]);

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
      void persistMutation({ kind: "session.meta", sessionId: initial.id, patch: { notes } });
    }, 700);
    return () => clearTimeout(t);
  }, [notes, live, initial.id, initial.notes, persistMutation]);

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

  /**
   * Deterministic working-weight suggestions from the athlete's own completed
   * sets. Suggestions are advisory only — every field stays editable and
   * nothing is written until the athlete accepts or logs a set.
   */
  const suggestions = useMemo(() => {
    const map: Record<string, WorkingWeightSuggestion> = {};
    for (const ex of exercises) {
      const points = lookupPoints(progression?.performance, {
        exerciseId: ex.exerciseId ?? null,
        name: ex.name,
      });
      const suggestion = suggestWorkingWeight({
        name: ex.name,
        equipment: ex.equipment,
        targetReps: ex.targetReps,
        targetRpe: ex.targetRpe ?? null,
        points,
        readiness: progression?.readiness ?? null,
      });
      if (suggestion) map[ex.id] = suggestion;
    }
    return map;
  }, [exercises, progression]);

  /** Applies a suggestion to every set the athlete has not completed yet. */
  const applySuggestion = (exId: string) => {
    const suggestion = suggestions[exId];
    if (!suggestion) return;
    const ex = exercises.find((e) => e.id === exId);
    if (!ex) return;
    for (const set of ex.sets) {
      if (set.done) continue;
      editSet(exId, set.id, { weightKg: suggestion.weightKg, reps: suggestion.reps });
    }
  };

  /* ---------------------------------------------- training-method selection */

  /** Logged RPE is the athlete's effort signal; RIR is its inverse. */
  const rirFromRpe = (rpe: number): number | null => (rpe > 0 ? Math.max(0, 10 - rpe) : null);

  /** Real movements available for pairing: this session first, then the library. */
  const methodCandidates = useMemo<MovementCandidate[]>(() => {
    const fromSession = exercises.map((e) => ({
      id: e.id,
      name: e.name,
      muscle: e.muscle,
      equipment: e.equipment,
      source: "session" as const,
    }));
    const seen = new Set(fromSession.map((c) => c.name.toLowerCase()));
    const fromLibrary = library
      .filter((e) => !seen.has(e.name.toLowerCase()))
      .map((e) => ({
        id: e.id,
        name: e.name,
        muscle: e.muscle,
        equipment: e.equipment,
        source: "library" as const,
      }));
    return [...fromSession, ...fromLibrary];
  }, [exercises, library]);

  /**
   * Resolves the real configuration a method needs: genuine partner movements,
   * genuine station lists, and the actual top-set basis for heavy + backoff.
   * Nothing here invents a placeholder movement.
   */
  const buildConfigFor = (ex: WorkoutExercise, methodId: string): MethodConfig => {
    const primary: MovementCandidate = {
      id: ex.id,
      name: ex.name,
      muscle: ex.muscle,
      equipment: ex.equipment,
    };
    const groupKey = `${ex.id}:${methodId}`;
    switch (methodId) {
      case "antagonist-supersets": {
        const partner = selectAntagonistPartner(primary, methodCandidates);
        return partner
          ? { groupKey, partnerExerciseId: partner.id, partnerName: partner.name }
          : { groupKey };
      }
      case "pre-exhaust": {
        const plan = selectPreExhaustPlan(primary, methodCandidates);
        if (!plan) return { groupKey };
        const partner = plan.kind === "pre-exhaust" ? plan.first : plan.second;
        return {
          groupKey,
          pairKind: plan.kind,
          partnerExerciseId: partner.id,
          partnerName: partner.name,
        };
      }
      case "trisets":
      case "giant-sets": {
        const group = selectCircuitGroup({ methodId, primary, candidates: methodCandidates });
        return group
          ? {
              groupKey,
              stationNames: group.stations.map((s) => s.name),
              stationIds: group.stations.map((s) => s.id),
            }
          : { groupKey };
      }
      case "heavy-backoff": {
        const basis =
          suggestions[ex.id]?.weightKg ??
          [...ex.sets].reverse().find((s) => s.weightKg > 0)?.weightKg ??
          null;
        return basis ? { topSetWeightKg: basis } : {};
      }
      case "irondesk-black":
        return openBlackWindow ? { blackWindowId: openBlackWindow.id } : {};
      default:
        return {};
    }
  };

  /** Selection is gated by eligibility AND the session fatigue budget. */
  const chooseMethod = (exId: string, methodId: string) => {
    const exercise = exercises.find((e) => e.id === exId);
    if (!exercise) return;
    const others = Object.entries(methodByExercise)
      .filter(([id]) => id !== exId)
      .map(([, value]) => value);
    const decision = methodSelectionDecision({
      methodId,
      profile: methodProfile,
      exercise,
      selectedIds: others,
    });
    if (!decision.allowed) {
      setMethodNotice(decision.reason);
      return;
    }
    const config = buildConfigFor(exercise, methodId);
    setMethodNotice(null);
    setMethodByExercise((prev) => ({ ...prev, [exId]: methodId }));
    setMethodConfigByExercise((prev) => ({ ...prev, [exId]: config }));
    setMethodPickerFor(null);
    if (live && !exId.startsWith("local-")) {
      void persistMutation({
        kind: "exercise.method",
        sessionExerciseId: exId,
        methodId,
        config,
      });
    }
  };

  /** Real replacement candidates for a pairing/station method, never placeholders. */
  const replacementCandidatesFor = (ex: WorkoutExercise, methodId: string): MovementCandidate[] => {
    const primary: MovementCandidate = {
      id: ex.id,
      name: ex.name,
      muscle: ex.muscle,
      equipment: ex.equipment,
    };
    switch (methodId) {
      case "antagonist-supersets":
        return antagonistPartnerCandidates(primary, methodCandidates);
      case "pre-exhaust": {
        const pre = preExhaustCandidates(primary, methodCandidates);
        return pre.length ? pre : staggerCandidates(primary, methodCandidates);
      }
      case "trisets":
      case "giant-sets":
        return stationCandidates({ methodId, primary, candidates: methodCandidates });
      default:
        return [];
    }
  };

  /**
   * Athlete-chosen partner or station overrides the engine's default. Circuit
   * edits are slot based: the primary is pinned, the group never shrinks below
   * its required station count, and a movement is never duplicated.
   */
  const replaceMethodPartner = (
    exId: string,
    methodId: string,
    choice: MovementCandidate,
    slotIndex?: number,
  ) => {
    const current = configFor(exId);
    const ex = exercises.find((e) => e.id === exId);
    let next: MethodConfig;
    if ((methodId === "trisets" || methodId === "giant-sets") && ex) {
      const primary: MovementCandidate = {
        id: ex.id,
        name: ex.name,
        muscle: ex.muscle,
        equipment: ex.equipment,
        source: "session",
      };
      const slots = circuitSlots({
        methodId,
        primary,
        ...(current.stationIds ? { stationIds: current.stationIds } : {}),
        ...(current.stationNames ? { stationNames: current.stationNames } : {}),
      });
      const firstEmpty = slots.stationIds.findIndex((id) => !id);
      const target = slotIndex ?? (firstEmpty > 0 ? firstEmpty : Math.max(1, slots.total - 1));
      const result = replaceCircuitStation({
        methodId,
        primary,
        ...(current.stationIds ? { stationIds: current.stationIds } : {}),
        ...(current.stationNames ? { stationNames: current.stationNames } : {}),
        slotIndex: target,
        choice,
      });
      if (result.reason) setMethodNotice(result.reason);
      next = {
        ...current,
        stationIds: result.stationIds,
        stationNames: result.stationNames,
        userSelected: true,
      };
    } else {
      next = {
        ...current,
        partnerExerciseId: choice.id,
        partnerName: choice.name,
        userSelected: true,
      };
    }

    setMethodConfigByExercise((prev) => ({ ...prev, [exId]: next }));
    if (live && !exId.startsWith("local-")) {
      void persistMutation({
        kind: "exercise.method",
        sessionExerciseId: exId,
        methodId,
        config: next,
      });
    }
  };

  /** The persisted Black prescription assigned to this movement, when any. */
  const blackPrescriptionFor = (exId: string): BlackExercisePrescription | null => {
    const ex = exercises.find((e) => e.id === exId);
    if (!ex || !openBlackWindow) return null;
    const name = ex.name.toLowerCase();
    return (
      openBlackWindow.prescriptions.find((p) => p.exerciseId === ex.id) ??
      openBlackWindow.prescriptions.find((p) => p.exerciseName.toLowerCase() === name) ??
      null
    );
  };

  /**
   * The executable plan for a movement's selected method. IronDesk Black reads
   * its persisted per-exercise prescription instead of a generic structure.
   */
  const planForExercise = (exId: string): MethodSetPlan | null => {
    const ex = exercises.find((e) => e.id === exId);
    if (!ex) return null;
    const workingWeightKg =
      suggestions[exId]?.weightKg ??
      [...ex.sets].reverse().find((s) => s.weightKg > 0)?.weightKg ??
      null;
    const methodId = methodFor(exId);
    if (methodId === "irondesk-black") {
      const prescription = blackPrescriptionFor(exId);
      if (!prescription || !openBlackWindow) return null;
      return blackSetPlan({ prescription, windowId: openBlackWindow.id, workingWeightKg });
    }
    return methodSetPlan({
      methodId,
      config: configFor(exId),
      workingWeightKg,
      plannedSets: ex.sets.length || ex.targetSets || 3,
      targetReps: suggestions[exId]?.reps ?? parseTargetReps(ex.targetReps).high,
      ...(units === "imperial" ? { incrementLb: loadIncrementLb(ex.equipment) } : {}),
    });
  };

  /**
   * Writes one method's real set structure into a single movement. Completed
   * sets are never rewritten and every prefilled row stays editable.
   */
  const writePlanToSets = async (exId: string, plan: MethodSetPlan) => {
    const ex = exercises.find((e) => e.id === exId);
    if (!ex) return;
    const open = ex.sets.filter((s) => !s.done);
    for (let i = 0; i < plan.rows.length; i += 1) {
      const row = plan.rows[i]!;
      const segmentConfig: MethodSegmentConfig = {
        methodId: plan.methodId,
        ...(row.segmentConfig ?? {}),
        ...(row.restSeconds == null ? {} : { restSeconds: row.restSeconds }),
      };
      const target = open[i];
      if (target) {
        const patch: Partial<SetEntry> = {
          ...(row.weightKg == null ? {} : { weightKg: row.weightKg }),
          ...(row.reps == null ? {} : { reps: row.reps }),
          methodSegment: row.segment ?? null,
          methodSegmentConfig: serializeMethodSegmentConfig(segmentConfig),
        };
        patchLocal(exId, target.id, patch);
        if (live && !target.id.startsWith("local-")) {
          try {
            await persistMutation(
              {
                kind: "set.update",
                setId: target.id,
                patch: {
                  ...(patch.weightKg !== undefined ? { weightKg: patch.weightKg } : {}),
                  ...(patch.reps !== undefined ? { reps: patch.reps } : {}),
                  methodSegment: patch.methodSegment ?? null,
                  methodSegmentConfig: parseMethodSegmentConfig(patch.methodSegmentConfig),
                },
              },
              { requireAcknowledgment: true },
            );
          } catch (caught) {
            if (!(caught instanceof DeferredWorkoutMutationError)) {
              patchLocal(exId, target.id, target);
            }
            throw caught;
          }
        }
      } else {
        await addSetWithValues(
          exId,
          row.weightKg,
          row.reps,
          {
            id: row.segment ?? null,
            config: segmentConfig,
          },
          { strict: true },
        );
      }
    }
  };

  /**
   * Applies the whole Black block at once. The database has no atomic RPC for
   * this client-composed write, so the weekly exposure is recorded only after
   * every method row and set row has returned a verified success.
   */
  const applyBlackBlock = async () => {
    if (!openBlackWindow) return;
    if (blackState && !blackState.canApply) {
      setMethodNotice(blackState.resumeRequirement ?? blackState.reason);
      return;
    }
    const targets = openBlackWindow.prescriptions
      .map((p) => {
        const match =
          exercises.find((e) => e.id === p.exerciseId) ??
          exercises.find((e) => e.name.toLowerCase() === p.exerciseName.toLowerCase());
        return match ? { exerciseId: match.id, prescription: p } : null;
      })
      .filter(
        (t): t is { exerciseId: string; prescription: BlackExercisePrescription } => t !== null,
      );
    if (!targets.length) {
      setMethodNotice("None of this Black block's movements are in the current workout yet.");
      return;
    }

    if (live && targets.some((target) => target.exerciseId.startsWith("local-"))) {
      setMethodNotice(
        "Wait for every Black movement to finish saving, then apply the block again.",
      );
      return;
    }

    // Preflight the whole block using the same eligibility/exercise/stack gate
    // as the builder and single-method picker. Nothing is written on refusal.
    const plannedMethods = { ...methodByExercise };
    for (const target of targets) {
      const exercise = exercises.find((item) => item.id === target.exerciseId);
      if (!exercise) return;
      const decision = methodSelectionDecision({
        methodId: "irondesk-black",
        profile: methodProfile,
        exercise,
        selectedIds: Object.entries(plannedMethods)
          .filter(([id]) => id !== target.exerciseId)
          .map(([, methodId]) => methodId),
      });
      if (!decision.allowed) {
        setMethodNotice(`${exercise.name}: ${decision.reason}`);
        return;
      }
      plannedMethods[target.exerciseId] = "irondesk-black";
    }

    let exposureWeekStart: string | null = null;
    if (live) {
      try {
        const existing = await repo.listBlackExposures();
        const gate = canRecordBlackExposure({
          targetRegion: openBlackWindow.targetRegion,
          date: new Date(),
          existing,
        });
        if (!gate.allowed) {
          setMethodNotice(gate.reason ?? "That Black exposure was already recorded this week.");
          return;
        }
        exposureWeekStart = gate.weekStart;
      } catch (caught) {
        setMethodNotice(
          caught instanceof Error ? caught.message : "That Black exposure was already recorded.",
        );
        return;
      }
    }

    try {
      await commitBlackApplication({
        targets,
        writeTarget: async (target) => {
          const exercise = exercises.find((item) => item.id === target.exerciseId);
          if (!exercise) throw new Error("A Black movement is no longer in this workout.");
          const config = buildConfigFor(exercise, "irondesk-black");
          if (live) {
            await persistMutation(
              {
                kind: "exercise.method",
                sessionExerciseId: target.exerciseId,
                methodId: "irondesk-black",
                config,
              },
              { requireAcknowledgment: true },
            );
          }
          setMethodByExercise((previous) => ({
            ...previous,
            [target.exerciseId]: "irondesk-black",
          }));
          setMethodConfigByExercise((previous) => ({
            ...previous,
            [target.exerciseId]: config,
          }));

          const workingWeightKg =
            suggestions[target.exerciseId]?.weightKg ??
            [...exercise.sets].reverse().find((set) => set.weightKg > 0)?.weightKg ??
            null;
          await writePlanToSets(
            target.exerciseId,
            blackSetPlan({
              prescription: target.prescription,
              windowId: openBlackWindow.id,
              workingWeightKg,
            }),
          );
        },
        recordExposure: async () => {
          if (!live) return;
          if (!exposureWeekStart)
            throw new Error("IronDesk could not verify the Black exposure week.");
          await repo.recordBlackExposure({
            windowId: openBlackWindow.id,
            sessionId: initial.id,
            targetRegion: openBlackWindow.targetRegion,
            weekStart: exposureWeekStart,
            prescriptions: targets.map((target) => target.prescription),
          });
        },
      });
    } catch (caught) {
      if (live) invalidate();
      setMethodNotice(
        caught instanceof Error
          ? `Black block was not recorded: ${caught.message}`
          : "Black block was not recorded because a workout write failed.",
      );
      return;
    }
    if (live) invalidate();
    setMethodNotice(
      `Black block applied to ${targets.length} movement(s) · one ${openBlackWindow.targetRegion} exposure this week.`,
    );
  };

  /**
   * Writes the selected method's real set structure into the active workout.
   * IronDesk Black always applies as a block, never per exercise.
   */
  const applyMethodToSets = async (exId: string) => {
    const methodId = methodFor(exId);
    if (methodId === "irondesk-black") {
      await applyBlackBlock();
      return;
    }
    const exercise = exercises.find((item) => item.id === exId);
    if (!exercise) return;
    const decision = methodSelectionDecision({
      methodId,
      profile: methodProfile,
      exercise,
      selectedIds: Object.entries(methodByExercise)
        .filter(([id]) => id !== exId)
        .map(([, selectedMethodId]) => selectedMethodId),
    });
    if (!decision.allowed) {
      setMethodNotice(decision.reason);
      return;
    }
    const plan = planForExercise(exId);
    if (!plan) return;
    try {
      await writePlanToSets(exId, plan);
      setMethodNotice(plan.explanation);
    } catch (caught) {
      setMethodNotice(
        caught instanceof Error ? caught.message : "That method could not be applied.",
      );
    }
  };

  /* -------------------------------------------------- IronDesk Black window */

  const blackEligibility = canOpenBlackWindow(methodProfile, specializationWindows);
  const blackState = openBlackWindow
    ? blackWindowState({ window: openBlackWindow, profile: methodProfile })
    : null;

  /** Suspension and expiry are persisted as soon as the engine detects them. */
  useEffect(() => {
    void reconcileBlackWindow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBlackWindow?.id, blackState?.status, live]);

  /** Opens a real 2-3 week specialization block on a muscle trained today. */
  const startBlackWindow = async (region: string) => {
    const workingWeightKgByExerciseId = Object.fromEntries(
      exercises.map((e) => [
        e.id,
        suggestions[e.id]?.weightKg ??
          [...e.sets].reverse().find((s) => s.weightKg > 0)?.weightKg ??
          null,
      ]),
    );
    const { plan, reason } = planBlackBlockResult({
      targetRegion: region,
      candidates: methodCandidates,
      workingWeightKgByExerciseId,
    });
    if (!plan) {
      setMethodNotice(reason ?? "No safe specialization movements available for that region yet.");
      return;
    }

    if (!live) {
      setMethodNotice(
        "Specialization windows are stored on your account — switch out of demo mode.",
      );
      return;
    }
    await persist(async () => {
      await repo.openSpecializationWindow({
        targetRegion: plan.targetRegion,
        startedOn: plan.startedOn,
        endsOn: plan.endsOn,
        modifierIds: plan.modifierIds,
        exerciseNames: plan.exercises.map((e) => e.name),
        prescriptions: plan.prescriptions,
      });
      invalidate();
    });
    setMethodNotice(`Black block opened: ${plan.sequence.join(" → ")}`);
  };

  /**
   * Persists a suspension, a resume, or an expiry the engine detected, so the
   * window's lifecycle is fully audited rather than inferred at render time.
   */
  const reconcileBlackWindow = async () => {
    if (!openBlackWindow || !live || !blackState) return;
    const next =
      blackState.status === "expired"
        ? "expired"
        : blackState.status === "suspended"
          ? "suspended"
          : blackState.status === "active" && openBlackWindow.status === "suspended"
            ? "active"
            : null;
    if (!next || openBlackWindow.status === next) return;

    await persist(async () => {
      await repo.closeSpecializationWindow(openBlackWindow.id, next);
      invalidate();
    });
    setMethodNotice(
      blackState.status === "expired"
        ? (blackState.exitRecommendation ?? blackState.reason)
        : blackState.reason,
    );
  };

  const endBlackWindow = async () => {
    if (!openBlackWindow || !live) return;
    await persist(async () => {
      await repo.closeSpecializationWindow(openBlackWindow.id, "completed");
      invalidate();
    });
    setMethodNotice(blackState?.exitRecommendation ?? "Specialization window closed.");
  };

  const patchLocal = (exId: string, setId: string, patch: Partial<SetEntry>) =>
    setExercises((prev) =>
      prev.map((e) =>
        e.id === exId
          ? { ...e, sets: e.sets.map((s) => (s.id === setId ? { ...s, ...patch } : s)) }
          : e,
      ),
    );

  const editSet = (exId: string, setId: string, patch: Partial<SetEntry>) => {
    patchLocal(exId, setId, patch);
    if (setId.startsWith("local-")) return;
    void persistMutation({
      kind: "set.update",
      setId,
      patch: {
        ...(patch.weightKg !== undefined ? { weightKg: patch.weightKg } : {}),
        ...(patch.reps !== undefined ? { reps: patch.reps } : {}),
        ...(patch.rpe !== undefined ? { rpe: patch.rpe } : {}),
        ...(patch.methodSegment !== undefined ? { methodSegment: patch.methodSegment } : {}),
        ...(patch.methodSegmentConfig !== undefined
          ? { methodSegmentConfig: parseMethodSegmentConfig(patch.methodSegmentConfig) }
          : {}),
      },
    });
  };

  const toggleSet = (exId: string, setId: string) => {
    const set = exercises.find((e) => e.id === exId)?.sets.find((s) => s.id === setId);
    if (!set) return;
    const next = !set.done;
    patchLocal(exId, setId, { done: next });
    if (next) {
      // The set's own method segment prescribes its rest; template rest is next.
      setRest(
        restSecondsForCompletedSet({
          segmentConfig: set.methodSegmentConfig,
          exerciseRestSeconds: exercises.find((e) => e.id === exId)?.restSeconds ?? null,
        }),
      );
      setRestStarted(Date.now());
    }

    if (setId.startsWith("local-")) return;
    const restSeconds =
      next && restStarted ? Math.round((Date.now() - restStarted) / 1000) : undefined;
    void persistMutation({
      kind: "set.update",
      setId,
      patch: {
        completed: next,
        completedAt: next ? new Date().toISOString() : null,
        weightKg: set.weightKg,
        reps: set.reps,
        rpe: set.rpe,
        ...(restSeconds ? { restSeconds } : {}),
      },
    });
  };

  const addSetWithValues = async (
    exId: string,
    weightKg?: number | null,
    reps?: number | null,
    segment?: { id: string | null; config: MethodSegmentConfig } | null,
    options?: { strict?: boolean },
  ) => {
    if (busySets.current.has(exId)) {
      if (options?.strict)
        throw new Error("Another set write is still in progress. Wait a moment and try again.");
      return; // guards duplicate rows from rapid taps
    }
    busySets.current.add(exId);
    const ex = exercises.find((e) => e.id === exId);
    const last = ex?.sets[ex.sets.length - 1];
    const suggestion = suggestions[exId];
    const draft: SetEntry = {
      id: live ? createClientWorkoutRecordId() : uid(),
      setNumber: Math.max(0, ...(ex?.sets.map((set) => set.setNumber ?? 0) ?? [])) + 1,
      weightKg: weightKg ?? last?.weightKg ?? suggestion?.weightKg ?? defaultSetWeightKg(units),
      reps: reps ?? last?.reps ?? suggestion?.reps ?? 8,
      rpe: last?.rpe ?? 7,
      done: false,
      methodSegment: segment?.id ?? null,
      methodSegmentConfig: segment ? serializeMethodSegmentConfig(segment.config) : null,
    };
    setExercises((prev) =>
      prev.map((e) => (e.id === exId ? { ...e, sets: [...e.sets, draft] } : e)),
    );
    try {
      if (live && !exId.startsWith("local-")) {
        await persistMutation(
          {
            kind: "set.add",
            recordId: draft.id,
            sessionExerciseId: exId,
            setNumber: draft.setNumber ?? 1,
            input: {
              weightKg: draft.weightKg,
              reps: draft.reps,
              rpe: draft.rpe,
              ...(segment
                ? { methodSegment: segment.id, methodSegmentConfig: segment.config }
                : {}),
            },
          },
          options?.strict ? { requireAcknowledgment: true } : undefined,
        );
      }
    } finally {
      busySets.current.delete(exId);
    }
  };

  const addSet = (exId: string) => addSetWithValues(exId);

  const removeSet = (exId: string, setId: string) => {
    setExercises((prev) =>
      prev.map((e) => (e.id === exId ? { ...e, sets: e.sets.filter((s) => s.id !== setId) } : e)),
    );
    if (!setId.startsWith("local-")) void persistMutation({ kind: "set.delete", setId });
  };

  const addExercise = async (item: {
    id: string;
    name: string;
    muscle: string;
    equipment: string;
  }) => {
    const localId = live ? createClientWorkoutRecordId() : uid();
    const position = Math.max(-1, ...exercises.map((exercise) => exercise.position ?? -1)) + 1;
    setExercises((prev) => [
      ...prev,
      {
        id: localId,
        name: item.name,
        muscle: item.muscle,
        equipment: item.equipment,
        targetSets: 3,
        targetReps: "8-10",
        position,
        previous: "No prior data",
        sets: [],
      },
    ]);
    if (!live) return;
    await persistMutation({
      kind: "exercise.add",
      recordId: localId,
      sessionId: initial.id,
      position,
      input: {
        exerciseId: item.id,
        name: item.name,
        muscle: item.muscle,
        equipment: item.equipment,
      },
    });
  };

  const removeExercise = (exId: string) => {
    setExercises((prev) => prev.filter((e) => e.id !== exId));
    if (!exId.startsWith("local-"))
      void persistMutation({ kind: "exercise.delete", sessionExerciseId: exId });
  };

  const substitute = (
    exId: string,
    item: { id: string; name: string; muscle: string; equipment: string },
  ) => {
    setExercises((prev) =>
      prev.map((e) =>
        e.id === exId
          ? {
              ...e,
              name: item.name,
              muscle: item.muscle,
              equipment: item.equipment,
              previous: "Substituted — no prior data",
            }
          : e,
      ),
    );
    setSubFor(null);
    if (!exId.startsWith("local-")) {
      void persistMutation({
        kind: "exercise.substitute",
        sessionExerciseId: exId,
        replacement: {
          exerciseId: item.id,
          name: item.name,
          muscle: item.muscle,
          equipment: item.equipment,
        },
      });
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
      const committed = await persistMutation({
        kind: "session.finish",
        sessionId: initial.id,
        completedAt: new Date().toISOString(),
      });
      if (committed.status === "applied") {
        const result = await repo.getWorkoutSummary(initial.id);
        setSummary(result);
        invalidate();
      }
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Could not finish the session.");
      setSaveState("error");
    }
  };

  const cancel = async () => {
    setConfirming(null);
    if (live) {
      await persistMutation({
        kind: "session.cancel",
        sessionId: initial.id,
        completedAt: new Date().toISOString(),
      });
      invalidate();
    }
  };

  if (summary) {
    return (
      <div className="mx-auto max-w-2xl">
        <PageHeader title="Workout complete" subtitle={summary.title} />
        <SectionCard
          title="Session summary"
          eyebrow={live ? "Saved to your account" : "Demo — not saved"}
        >
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
              <div
                key={e.id}
                className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0"
              >
                <p className="text-sm font-semibold">{e.name}</p>
                <p className="numeric text-right text-xs text-muted-foreground">
                  {e.sets
                    .filter((s) => s.done)
                    .map((s) => formatWeightedSet(s.weightKg, s.reps, units))
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
            <Button
              variant="ghost"
              disabled={terminalMutationQueued}
              onClick={() => setConfirming("cancel")}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={terminalMutationQueued}
              onClick={() => setConfirming("finish")}
              className="font-semibold"
            >
              {terminalMutationQueued ? "Finalizing…" : "Finish"}
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
                <button
                  onClick={() => setRest((r) => (r ?? 0) + 30)}
                  className="text-xs font-semibold text-primary"
                >
                  +30s
                </button>
                <button
                  onClick={() => setRest(null)}
                  className="text-muted-foreground"
                  aria-label="Clear rest timer"
                >
                  <X className="size-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <MetricTile label="Sets" value={`${totals.sets}/${totals.plannedSets}`} tone="primary" />
          <MetricTile label="Reps" value={totals.reps} />
          <MetricTile
            label="Volume"
            value={fromKg(totals.volume, units).toLocaleString()}
            unit={unit}
            tone="warning"
          />
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
          {saveState === "queued" && (
            <span className="flex items-center gap-1.5 text-warning">
              <CloudOff className="size-3.5" /> {mutationQueue.pendingCount} change
              {mutationQueue.pendingCount === 1 ? "" : "s"}{" "}
              {mutationQueue.durable
                ? "safely queued on this device — IronDesk will retry after reconnecting, including after a reload."
                : "kept only in this open page because local storage is unavailable — do not close or reload before reconnecting."}
            </span>
          )}
          {saveState === "error" && (
            <div className="flex flex-wrap items-center gap-2 text-danger">
              <span className="flex items-center gap-1.5">
                <CloudOff className="size-3.5" /> {saveError ?? "A queued change needs attention."}
              </span>
              {mutationQueue.blockedCount > 0 && (
                <>
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => void mutationQueue.retryBlocked()}
                  >
                    Retry
                  </button>
                  <button
                    type="button"
                    className="font-semibold underline underline-offset-2"
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Discard the blocked change and every later queued workout change? The workout will reload from the last server-saved state.",
                        )
                      )
                        return;
                      mutationQueue.discardBlocked();
                      invalidate();
                      window.location.reload();
                    }}
                  >
                    Discard blocked and later changes
                  </button>
                </>
              )}
            </div>
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

      <SectionCard
        title="IronDesk Black"
        eyebrow="Specialization window"
        action={
          openBlackWindow ? (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!blackState?.canApply}
                onClick={() => void applyBlackBlock()}
              >
                Apply Black block
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void endBlackWindow()}>
                End block
              </Button>
            </div>
          ) : undefined
        }
      >
        {openBlackWindow ? (
          <div
            className={`space-y-1.5 rounded-lg border p-3 text-xs text-muted-foreground ${
              blackState?.status === "suspended"
                ? "border-warning/50 bg-warning/5"
                : "border-primary/40 bg-primary/5"
            }`}
          >
            <p className="numeric text-sm font-bold text-foreground">
              {openBlackWindow.targetRegion} · {openBlackWindow.startedOn} →{" "}
              {openBlackWindow.endsOn}
            </p>
            <p className={blackState?.status === "suspended" ? "text-warning" : undefined}>
              {blackState?.reason}
            </p>
            {blackState?.resumeRequirement ? (
              <p className="text-warning">{blackState.resumeRequirement}</p>
            ) : null}

            {openBlackWindow.prescriptions.length ? (
              <ul className="space-y-2">
                {openBlackWindow.prescriptions.map((prescription) => {
                  const inSession = exercises.find(
                    (e) =>
                      e.id === prescription.exerciseId ||
                      e.name.toLowerCase() === prescription.exerciseName.toLowerCase(),
                  );
                  const libraryMatch = library.find(
                    (e) => e.name.toLowerCase() === prescription.exerciseName.toLowerCase(),
                  );
                  return (
                    <li
                      key={`${prescription.exerciseId}-${prescription.modifierId}`}
                      className="rounded-md border border-border bg-surface-2/50 p-2.5"
                    >
                      <p className="numeric text-xs font-bold text-foreground">
                        {prescription.exerciseName} · {prescription.modifierName}
                      </p>
                      <p className="numeric">
                        {prescription.sets}×{prescription.reps} @ {prescription.loadPercent}%
                        {prescription.loadKg
                          ? ` (${fromKg(prescription.loadKg, units)} ${unit})`
                          : ""}{" "}
                        · RIR {prescription.expectedRir}
                      </p>
                      <p className="numeric">
                        Intra-set rest {prescription.intraSetRestSeconds}s · between sets{" "}
                        {prescription.interSetRestSeconds}s
                      </p>
                      <p>Stop rule: {prescription.stopRule}</p>
                      {!inSession && libraryMatch ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="mt-2"
                          onClick={() =>
                            void addExercise({
                              id: libraryMatch.id,
                              name: libraryMatch.name,
                              muscle: libraryMatch.muscle,
                              equipment: libraryMatch.equipment,
                            })
                          }
                        >
                          Add {libraryMatch.name}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : openBlackWindow.exerciseNames.length ? (
              <p>Movements: {openBlackWindow.exerciseNames.join(", ")}</p>
            ) : null}
            {blackState?.exitRecommendation ? <p>{blackState.exitRecommendation}</p> : null}
          </div>
        ) : blackEligibility.allowed ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Open a 2-3 week block on one region. Only recovery-safe modifiers are used.
            </p>
            <div className="flex flex-wrap gap-2">
              {[...new Set(exercises.map((e) => e.muscle))].map((muscle) => (
                <Button
                  key={muscle}
                  size="sm"
                  variant="secondary"
                  onClick={() => void startBlackWindow(muscle)}
                >
                  Specialize {muscle}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-1 text-xs text-warning">
            {blackEligibility.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </SectionCard>

      {exercises.length === 0 ? (
        <EmptyState
          title="No exercises yet"
          description="Add the first movement to start logging sets."
          action={
            library[0] ? (
              <Button onClick={() => void addExercise(library[0]!)}>Add {library[0]!.name}</Button>
            ) : undefined
          }
        />
      ) : (
        exercises.map((ex) => {
          const doneSets = ex.sets.filter((s) => s.done).length;
          const alternatives = library
            .filter((l) => l.muscle === ex.muscle && l.name !== ex.name)
            .slice(0, 4);
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSubFor(ex.id === subFor ? null : ex.id)}
                    aria-label="Substitute"
                  >
                    <Repeat2 className="size-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeExercise(ex.id)}
                    aria-label="Remove exercise"
                  >
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
                      Load:{" "}
                      <span className="numeric font-semibold text-foreground">{load.text}</span>
                    </span>
                  ) : null;
                })()}
                {ex.restSeconds != null && (
                  <span>
                    Rest:{" "}
                    <span className="numeric font-semibold text-foreground">
                      {mmss(ex.restSeconds)}
                    </span>
                  </span>
                )}
                <span>
                  Last time:{" "}
                  <span className="numeric font-semibold text-foreground">
                    {formatWeightText(ex.previous, units)}
                  </span>
                </span>
                {ex.isHeavy && <Pill tone="warning">Heavy</Pill>}
                {ex.isDropSet && <Pill tone="primary">Drop set</Pill>}
              </div>

              {suggestions[ex.id] && (
                <div className="mb-3 rounded-lg border border-primary/30 bg-primary/8 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="label-eyebrow text-primary">Suggested working set</p>
                      <p className="numeric mt-0.5 text-lg font-bold text-foreground">
                        {fromKg(suggestions[ex.id]!.weightKg, units)} {unit} ×{" "}
                        {suggestions[ex.id]!.reps}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {suggestions[ex.id]!.deload && <Pill tone="warning">Deload</Pill>}
                      {suggestions[ex.id]!.notes.map((note) => (
                        <Pill key={note} tone="default">
                          {formatWeightText(note, units)}
                        </Pill>
                      ))}
                      <Button size="sm" variant="secondary" onClick={() => applySuggestion(ex.id)}>
                        Use
                      </Button>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {formatWeightText(suggestions[ex.id]!.reason, units)}
                  </p>
                </div>
              )}

              {(() => {
                const method = getMethod(methodFor(ex.id));
                if (!method) return null;
                const config = configFor(ex.id);
                const suggestion = suggestions[ex.id];
                const setWeightKg =
                  suggestion?.weightKg ?? ex.sets[ex.sets.length - 1]?.weightKg ?? 0;
                const setReps = suggestion?.reps ?? parseTargetReps(ex.targetReps).high;
                const pairInstructions =
                  method.id === "pre-exhaust" && config.partnerName
                    ? config.pairKind === "staggered"
                      ? [
                          `Main work: ${ex.name} as prescribed`,
                          `Stagger ${config.partnerName} into each rest period — non-interfering muscle only`,
                        ]
                      : [
                          `Pre-exhaust: ${config.partnerName} for 10-12 reps at RIR 1-2`,
                          `Then ${ex.name} — expect a lower load, that is the point`,
                        ]
                    : null;
                const prescription = buildMethodPrescription(method.id, {
                  weightKg: setWeightKg,
                  reps: setReps,
                  exerciseName: ex.name,
                  partnerName: config.partnerName ?? null,
                  stationNames: config.stationNames ?? null,
                  pairInstructions,
                });
                const target = parseTargetReps(ex.targetReps);
                const doubleState =
                  method.id === "double-progression"
                    ? doubleProgressionState({
                        weightKg: setWeightKg,
                        sets: ex.sets
                          .filter((s) => s.done)
                          .map((s) => ({ reps: s.reps, rir: rirFromRpe(s.rpe) })),
                        target,
                        incrementKg: loadIncrementKg(ex.equipment),
                        plannedSets: ex.sets.length,
                      })
                    : null;
                const loggedReps = ex.sets
                  .filter((s) => s.done)
                  .map((s) => s.reps)
                  .join("/");
                const doubleLine = doubleState
                  ? `${fromKg(setWeightKg, units)} ${unit} • target ${
                      target.low === target.high ? target.low : `${target.low}-${target.high}`
                    }${loggedReps ? ` • last: ${loggedReps}` : ""} — ${doubleState.explanation}`
                  : null;
                const readinessNote =
                  suggestion && suggestion.readinessPercent !== 0
                    ? `${suggestion.readinessPercent > 0 ? "+" : ""}${suggestion.readinessPercent}% · readiness`
                    : null;
                const volume =
                  method.id === "volume-progression" && progression
                    ? volumeRecommendationForMuscle({
                        muscle: ex.muscle,
                        volume: progression.muscleVolume,
                        averageReadiness: progression.readiness,
                      })
                    : null;
                const plan = planForExercise(ex.id);
                const blackPrescription =
                  method.id === "irondesk-black" ? blackPrescriptionFor(ex.id) : null;
                // Black shows its real assignment: modifier, load, sets/reps,
                // rest intervals and stop rule — never a metadata summary.
                const blackDisplay =
                  blackPrescription && plan
                    ? {
                        methodId: "irondesk-black",
                        loadsKg: plan.rows
                          .map((row) => row.weightKg)
                          .filter((w): w is number => w != null),
                        notes: [],
                        summary: `${blackPrescription.modifierName} on ${blackPrescription.exerciseName} · ${blackPrescription.sets}×${blackPrescription.reps} @ ${blackPrescription.loadPercent}%${
                          blackPrescription.loadKg
                            ? ` (${fromKg(blackPrescription.loadKg, units)} ${unit})`
                            : ""
                        } · RIR ${blackPrescription.expectedRir}`,
                        steps: [
                          ...plan.rows.map((row) => row.label ?? "Working set"),
                          `Intra-set rest ${blackPrescription.intraSetRestSeconds}s · between sets ${blackPrescription.interSetRestSeconds}s`,
                          `Stop rule: ${blackPrescription.stopRule}`,
                        ],
                      }
                    : null;
                return (
                  <>
                    <MethodExecutionCard
                      method={method}
                      prescription={blackDisplay ?? prescription}
                      doubleProgressionLine={doubleLine}
                      readinessNote={readinessNote}
                      volumeLine={
                        volume
                          ? `${volume.muscle}: ${volume.currentWeeklySets} direct sets this week (prev ${volume.previousWeeklySets}, trend ${volume.trend}) — ${volume.explanation}`
                          : null
                      }
                      missingPairing={
                        (method.id === "antagonist-supersets" ||
                          method.id === "pre-exhaust" ||
                          method.id === "trisets" ||
                          method.id === "giant-sets") &&
                        !prescription
                          ? "No safe real movement in your library matches this pairing yet — add one or pick another method."
                          : null
                      }
                      onApply={plan ? () => void applyMethodToSets(ex.id) : undefined}
                      onChange={() => setMethodPickerFor(methodPickerFor === ex.id ? null : ex.id)}
                    />
                    {(() => {
                      const candidates = replacementCandidatesFor(ex, method.id);
                      if (!candidates.length) return null;
                      const chosen = new Set(
                        config.stationIds ??
                          (config.partnerExerciseId ? [config.partnerExerciseId] : []),
                      );
                      return (
                        <div className="mb-3 rounded-lg border border-border bg-surface-2/40 p-3">
                          <p className="label-eyebrow text-primary">
                            {method.id === "trisets" || method.id === "giant-sets"
                              ? "Stations"
                              : "Partner movement"}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {candidates.slice(0, 10).map((candidate) => (
                              <button
                                key={candidate.id}
                                type="button"
                                onClick={() => replaceMethodPartner(ex.id, method.id, candidate)}
                                className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold ${
                                  chosen.has(candidate.id)
                                    ? "border-primary/60 bg-primary/10 text-foreground"
                                    : "border-border-strong bg-surface-2 hover:border-primary/50"
                                }`}
                              >
                                {candidate.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    {methodPickerFor === ex.id ? (
                      <div className="mb-3">
                        <TrainingMethodSelector
                          profile={methodProfile}
                          exercise={{ name: ex.name, equipment: ex.equipment }}
                          selectedIds={stackedMethodIds}
                          activeId={method.id}
                          notice={methodNotice}
                          onSelect={(methodId) => chooseMethod(ex.id, methodId)}
                          onClose={() => setMethodPickerFor(null)}
                        />
                      </div>
                    ) : null}
                  </>
                );
              })()}

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
                      <p className="text-xs text-muted-foreground">
                        No equipment-matched alternatives.
                      </p>
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
                {ex.sets.map((s, i) => {
                  const segment = parseMethodSegmentConfig(s.methodSegmentConfig);
                  const segmentLine = s.methodSegment
                    ? [
                        s.methodSegment.replace(/-/g, " "),
                        segment.restSeconds != null ? `rest ${segment.restSeconds}s` : null,
                        segment.eccentricSeconds != null
                          ? `${segment.eccentricSeconds}s eccentric`
                          : null,
                        segment.targetRir != null ? `RIR ${segment.targetRir}` : null,
                        segment.reductionPercent != null ? `-${segment.reductionPercent}%` : null,
                        segment.stopRule ?? null,
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : null;
                  return (
                    <div key={s.id} className="space-y-1">
                      {segmentLine ? (
                        <p
                          className={`numeric px-1 text-[0.625rem] font-semibold uppercase tracking-wide ${
                            segment.methodId === "irondesk-black" ? "text-danger" : "text-primary"
                          }`}
                        >
                          {segmentLine}
                        </p>
                      ) : null}
                      <div
                        className={`grid grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_2.5rem_1.5rem] items-center gap-2 rounded-lg border p-1.5 ${
                          s.done
                            ? "border-success/35 bg-success/8"
                            : "border-border bg-surface-2/40"
                        }`}
                      >
                        <span className="numeric text-center text-sm font-bold text-muted-foreground">
                          {i + 1}
                        </span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          value={fromKg(s.weightKg, units)}
                          onChange={(e) =>
                            editSet(ex.id, s.id, { weightKg: toKg(Number(e.target.value), units) })
                          }
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
                    </div>
                  );
                })}
              </div>

              <div className="mt-3">
                <Button
                  variant="secondary"
                  className="h-11 w-full"
                  onClick={() => void addSet(ex.id)}
                >
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
        <ExercisePicker
          exercises={library}
          selectedIds={selectedExerciseIds}
          onSelect={(exercise) => void addExercise(exercise)}
        />
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
