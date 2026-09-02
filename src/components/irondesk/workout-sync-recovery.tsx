import { AlertTriangle, CloudOff, Download, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as repo from "@/lib/irondesk/repo";
import { useWorkoutMutationQueue } from "@/lib/irondesk/use-workout-mutation-queue";
import { useUnits } from "@/lib/irondesk/use-units";
import { fromKg, toKg, weightUnit, type Units } from "@/lib/irondesk/units";
import {
  parseRepsDraft,
  parseRestSecondsDraft,
  parseRpeDraft,
  parseWeightDraft,
  type WorkoutValueResult,
} from "@/lib/irondesk/workout-values";
import type {
  QueuedWorkoutMutation,
  WorkoutMutation,
  WorkoutMutationIssue,
} from "@/lib/irondesk/workout-mutation-outbox";
import type { ActiveWorkout } from "@/lib/irondesk/types";

function issueSessionId(
  issue: WorkoutMutationIssue,
  receipts: ReturnType<typeof useWorkoutMutationQueue>["terminalReceipts"],
): string | null {
  if (issue.sessionId) return issue.sessionId;
  return (
    receipts.find((receipt) => receipt.laneId === issue.laneId && receipt.sessionId)?.sessionId ??
    null
  );
}

function issueLabel(
  issue: WorkoutMutationIssue,
  workout: ActiveWorkout | null,
  items: readonly QueuedWorkoutMutation[],
): string {
  if (!issue.targetId) return "this queued workout change";
  for (const exercise of workout?.exercises ?? []) {
    const set = exercise.sets.find((candidate) => candidate.id === issue.targetId);
    if (set) return `${exercise.name}, set ${set.setNumber ?? exercise.sets.indexOf(set) + 1}`;
    if (exercise.id === issue.targetId) return exercise.name;
  }
  const queued = items.find((item) => item.id === issue.itemId);
  const queuedSet =
    queued?.mutation.kind === "set.add"
      ? queued.mutation
      : items.find(
          (item) =>
            item.laneId === issue.laneId &&
            item.mutation.kind === "set.add" &&
            item.mutation.recordId === issue.targetId,
        )?.mutation;
  if (queuedSet?.kind === "set.add") {
    const serverExercise = workout?.exercises.find(
      (exercise) => exercise.id === queuedSet.sessionExerciseId,
    );
    const queuedExercise = items.find(
      (item) =>
        item.laneId === issue.laneId &&
        item.mutation.kind === "exercise.add" &&
        item.mutation.recordId === queuedSet.sessionExerciseId,
    );
    const exerciseName =
      serverExercise?.name ??
      (queuedExercise?.mutation.kind === "exercise.add"
        ? queuedExercise.mutation.input.name
        : "Queued exercise");
    return `${exerciseName}, set ${queuedSet.setNumber}`;
  }
  if (queued?.mutation.kind === "exercise.add") return queued.mutation.input.name;
  return `record …${issue.targetId.slice(-8)}`;
}

function parseCorrection(
  issue: WorkoutMutationIssue,
  draft: string,
  units: Units,
): WorkoutValueResult<number | null> {
  switch (issue.field) {
    case "rpe":
    case "perceivedEffort":
      return parseRpeDraft(draft);
    case "reps": {
      const result = parseRepsDraft(draft);
      return result.ok ? { ok: true, value: result.value } : result;
    }
    case "restSeconds":
      return parseRestSecondsDraft(draft);
    case "weightKg": {
      const result = parseWeightDraft(draft, (value) => toKg(value, units));
      return result.ok ? { ok: true, value: result.value } : result;
    }
    default:
      return {
        ok: false,
        field: "rpe",
        value: draft,
        message: "This queued change cannot be corrected from the recovery form.",
      };
  }
}

function withCorrectedValue(
  item: QueuedWorkoutMutation,
  issue: WorkoutMutationIssue,
  value: number | null,
): WorkoutMutation | null {
  const field = issue.field;
  if (item.mutation.kind === "set.update" && field) {
    return { ...item.mutation, patch: { ...item.mutation.patch, [field]: value } };
  }
  if (item.mutation.kind === "set.add" && field) {
    return { ...item.mutation, input: { ...item.mutation.input, [field]: value } };
  }
  if (item.mutation.kind === "session.meta" && field === "perceivedEffort") {
    return {
      ...item.mutation,
      patch: { ...item.mutation.patch, perceivedEffort: value },
    };
  }
  return null;
}

function downloadLaneBackup(
  issue: WorkoutMutationIssue,
  queue: ReturnType<typeof useWorkoutMutationQueue>,
) {
  const payload = {
    format: "irondesk-workout-recovery-v1",
    exportedAt: new Date().toISOString(),
    laneId: issue.laneId,
    items: queue.items.filter((item) => item.laneId === issue.laneId),
    terminalReceipts: queue.terminalReceipts.filter((receipt) => receipt.laneId === issue.laneId),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `irondesk-recovery-${issue.laneId.replace(/[^a-z0-9-]/gi, "-")}.json`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Global, non-destructive recovery UI for durable workout mutations. It lives
 * in the authenticated shell so a cancelled/completed server session can be
 * repaired even when there is no active-workout route payload.
 */
export function WorkoutSyncRecovery() {
  const queue = useWorkoutMutationQueue();
  const units = useUnits();
  const issue = queue.issues[0] ?? null;
  const item = issue
    ? (queue.items.find((candidate) => candidate.id === issue.itemId) ?? null)
    : null;
  const sessionId = issue ? issueSessionId(issue, queue.terminalReceipts) : null;
  const [workout, setWorkout] = useState<ActiveWorkout | null>(null);
  const [dismissedItemId, setDismissedItemId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const laneIssues = useMemo(
    () => (issue ? queue.issues.filter((candidate) => candidate.laneId === issue.laneId) : []),
    [issue, queue.issues],
  );
  const correctableIssues = useMemo(
    () =>
      laneIssues.filter((candidate) =>
        ["rpe", "perceivedEffort", "reps", "restSeconds", "weightKg"].includes(
          candidate.field ?? "",
        ),
      ),
    [laneIssues],
  );

  useEffect(() => {
    if (!issue) return;
    setDrafts(
      Object.fromEntries(
        correctableIssues.map((candidate) => [
          candidate.itemId,
          candidate.invalidValue == null
            ? ""
            : candidate.field === "weightKg" && typeof candidate.invalidValue === "number"
              ? String(fromKg(candidate.invalidValue, units))
              : String(candidate.invalidValue),
        ]),
      ),
    );
    setError(null);
  }, [correctableIssues, issue, units]);

  useEffect(() => {
    let active = true;
    setWorkout(null);
    if (!sessionId) return () => undefined;
    void repo
      .getWorkout(sessionId)
      .then((value) => {
        if (active) setWorkout(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [sessionId]);

  const cancelledRecoveryRequired =
    item?.mutation.kind === "session.finish" &&
    item.state === "blocked" &&
    issue?.code === "cancelled_session_requires_recovery";
  const completedCancelConflict =
    item?.mutation.kind === "session.cancel" &&
    item.state === "blocked" &&
    issue?.code === "terminal_conflict";
  const correctable = correctableIssues.length > 0;
  const correctionsValid =
    correctable &&
    correctableIssues.every(
      (candidate) => parseCorrection(candidate, drafts[candidate.itemId] ?? "", units).ok,
    );
  const open = Boolean(issue && dismissedItemId !== issue.itemId);
  const label = useMemo(
    () => (issue ? issueLabel(issue, workout, queue.items) : "queued change"),
    [issue, queue.items, workout],
  );

  const saveCorrections = async () => {
    if (!issue || !correctableIssues.length) return;
    const replacements = correctableIssues.map((candidate) => {
      const queued = queue.items.find((entry) => entry.id === candidate.itemId) ?? null;
      const parsed = parseCorrection(candidate, drafts[candidate.itemId] ?? "", units);
      return {
        issue: candidate,
        revision: queued?.revision ?? null,
        parsed,
        replacement:
          queued && parsed.ok ? withCorrectedValue(queued, candidate, parsed.value) : null,
      };
    });
    const invalid = replacements.find(
      (candidate) => !candidate.parsed.ok || !candidate.replacement,
    );
    if (invalid) {
      setError(
        invalid.parsed.ok
          ? "IronDesk could not identify one queued value to replace."
          : invalid.parsed.message,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const correction of replacements) {
        if (correction.revision === null) {
          throw new Error("One queued correction changed before it could be saved.");
        }
        await queue.correctBlocked(correction.issue.itemId, correction.replacement!, {
          expectedRevision: correction.revision,
        });
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The corrections could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const recoverCancelled = async () => {
    if (!issue || item?.mutation.kind !== "session.finish") return;
    if (
      !window.confirm(
        "Recover this server-cancelled workout? IronDesk will replay every preserved change in order and finish it using the original time saved on this device.",
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await queue.correctBlocked(
        issue.itemId,
        {
          ...item.mutation,
          recoverCancelled: true,
        },
        {
          expectedRevision: item.revision,
        },
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That workout could not be recovered.");
    } finally {
      setBusy(false);
    }
  };

  const keepCompleted = async () => {
    if (!issue || item?.mutation.kind !== "session.cancel") return;
    setBusy(true);
    setError(null);
    try {
      await queue.correctBlocked(
        issue.itemId,
        {
          kind: "session.finish",
          sessionId: item.mutation.sessionId,
          completedAt: item.mutation.completedAt,
        },
        {
          expectedRevision: item.revision,
        },
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "That workout conflict could not be resolved.",
      );
    } finally {
      setBusy(false);
    }
  };

  const keepCancelled = () => {
    if (!issue) return;
    downloadLaneBackup(issue, queue);
    if (
      !window.confirm(
        "The recovery backup was downloaded. Keep the server workout cancelled and remove only this saved recovery queue from this device?",
      )
    )
      return;
    queue.discardLane(issue.laneId);
  };

  if (!issue) return null;

  return (
    <>
      {!open ? (
        <Button
          type="button"
          variant="secondary"
          className="fixed right-4 bottom-20 z-50 shadow-lg md:bottom-4"
          onClick={() => setDismissedItemId(null)}
        >
          <AlertTriangle className="size-4 text-warning" /> Review pending workout
        </Button>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDismissedItemId(issue.itemId);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="size-5 text-warning" /> Workout sync needs attention
            </DialogTitle>
            <DialogDescription>
              Your workout remains stored on this device. IronDesk will not delete or alter later
              queued changes while this item is corrected.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-semibold text-foreground">{workout?.title ?? "Saved workout"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{label}</p>
            <p className="mt-2 text-warning">{issue.message}</p>
          </div>

          {cancelledRecoveryRequired && !correctable ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                The server copy is cancelled. Recovering will first preserve the queued set changes,
                then complete the workout using its original saved finish time.
              </p>
              <Button disabled={busy} onClick={() => void recoverCancelled()} className="w-full">
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Recover and finish this workout
              </Button>
              <Button
                disabled={busy}
                variant="secondary"
                onClick={keepCancelled}
                className="w-full"
              >
                <Download className="size-4" /> Export backup and keep cancelled
              </Button>
            </div>
          ) : completedCancelConflict && !correctable ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                The server copy is already completed. Keeping it completed will replay the preserved
                changes in this lane and acknowledge the server's original completion time.
              </p>
              <Button disabled={busy} onClick={() => void keepCompleted()} className="w-full">
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Keep completed and sync saved changes
              </Button>
            </div>
          ) : correctable ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-semibold">Correct every invalid queued value</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {correctableIssues.length} correction{correctableIssues.length === 1 ? "" : "s"}{" "}
                  in this workout must be valid before synchronization can continue.
                </p>
              </div>
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {correctableIssues.map((candidate, index) => {
                  const candidateLabel = issueLabel(candidate, workout, queue.items);
                  const parsed = parseCorrection(candidate, drafts[candidate.itemId] ?? "", units);
                  const inputId = `workout-sync-correction-${candidate.itemId}`;
                  return (
                    <div key={candidate.itemId} className="rounded-lg border border-border p-3">
                      <label htmlFor={inputId} className="text-xs font-semibold">
                        {candidateLabel} ·{" "}
                        {candidate.field === "weightKg"
                          ? `weight in ${weightUnit(units)}`
                          : candidate.field}
                      </label>
                      <p className="mt-1 text-[0.6875rem] text-muted-foreground">
                        Stored invalid value: {String(candidate.invalidValue)}
                      </p>
                      <Input
                        id={inputId}
                        className="mt-2"
                        value={drafts[candidate.itemId] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setDrafts((current) => ({ ...current, [candidate.itemId]: value }));
                          setError(null);
                        }}
                        inputMode="decimal"
                        placeholder={candidate.field === "rpe" ? "Blank or 1–10" : undefined}
                        aria-invalid={!parsed.ok}
                        autoFocus={index === 0}
                      />
                      {!parsed.ok ? (
                        <p className="mt-1 text-xs text-danger" role="alert">
                          {parsed.message}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {error ? (
                <p className="text-xs text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                RPE may be blank or 1–10 in 0.5 increments. No other queued value will be discarded.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface-2/60 p-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <CloudOff className="size-4" /> The saved change can be retried without clearing the
                queue.
              </p>
              {error ? (
                <p className="mt-2 text-xs text-danger" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            {correctable ? (
              <Button disabled={busy || !correctionsValid} onClick={() => void saveCorrections()}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                Save corrections and continue
              </Button>
            ) : !cancelledRecoveryRequired && !completedCancelConflict ? (
              <Button disabled={busy} onClick={() => void queue.retryBlocked()}>
                Retry sync
              </Button>
            ) : null}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDismissedItemId(issue.itemId)}
            >
              Keep pending
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
