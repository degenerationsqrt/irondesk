/**
 * Assigned-program surfaces shared by /program, the dashboard and /workout.
 *
 * Every state change goes through a database function via the programs repo —
 * this layer only renders state and collects the explicit acknowledgment that
 * gated (Legacy Beta) programs require before assignment.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Pause,
  Play,
  Play as PlayIcon,
  SkipForward,
} from "lucide-react";
import { useState } from "react";

import { EmptyState, Pill, ProgressBar, SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  currentSlot,
  programProgress,
  RELEASE_GATE_LABEL,
  requiresAcknowledgment,
  SLOT_STATE_LABEL,
  slotState,
} from "@/lib/irondesk/program-logic";
import * as programs from "@/lib/irondesk/programs";
import { enrollmentQuery, programCatalogQuery } from "@/lib/irondesk/queries";
import type { Program, ProgramEnrollment } from "@/lib/irondesk/types";
import { useIronDeskInvalidate, useServiceMode } from "@/lib/irondesk/use-data";
import { cn } from "@/lib/utils";

function useLive() {
  return useServiceMode() === "live";
}

export function useEnrollment() {
  const live = useLive();
  return useQuery({ ...enrollmentQuery, enabled: live });
}

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

/* ------------------------------------------------------------------ catalog */

export function ProgramCatalog({ enrollment }: { enrollment: ProgramEnrollment | null }) {
  const live = useLive();
  const invalidate = useIronDeskInvalidate();
  const { data: catalog, isLoading } = useQuery({ ...programCatalogQuery, enabled: live });
  const [pending, setPending] = useState<Program | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assign = async (program: Program, acknowledged: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await programs.enrollInProgram(program.id, acknowledged);
      invalidate();
      setPending(null);
      setAck(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not assign that program.");
    } finally {
      setBusy(false);
    }
  };

  const onAssign = (program: Program) => {
    setError(null);
    if (requiresAcknowledgment(program)) {
      setAck(false);
      setPending(program);
      return;
    }
    void assign(program, false);
  };

  return (
    <SectionCard title="Program Catalog" eyebrow="Assignable">
      <div className="space-y-3">
        <ErrorLine message={error} />
        {!live && (
          <p className="text-xs text-muted-foreground">
            Demo mode is read-only — sign in to assign a program to your account.
          </p>
        )}
        {isLoading && live && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading catalog…
          </p>
        )}
        {catalog && catalog.length === 0 && (
          <EmptyState
            title="No assignable programs"
            description="No active system programs are published yet."
          />
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          {(catalog ?? []).map((program) => {
            const isCurrent = enrollment?.program.id === program.id;
            const gated = requiresAcknowledgment(program);
            return (
              <div key={program.id} className="panel flex flex-col gap-3 p-4">
                <div>
                  <p className="label-eyebrow">
                    {program.environment ? program.environment.toUpperCase() : "PROGRAM"}
                    {program.level ? ` · ${program.level}` : ""}
                  </p>
                  <h3 className="mt-1 text-base leading-tight font-bold tracking-tight">
                    {program.name}
                  </h3>
                  {program.description && (
                    <p className="mt-1 text-xs text-muted-foreground">{program.description}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill>{program.slots.length} workouts</Pill>
                  {program.daysPerWeek && <Pill>{program.daysPerWeek}×/week</Pill>}
                  <Pill tone={gated ? "warning" : "success"}>
                    {RELEASE_GATE_LABEL[program.releaseGate]}
                  </Pill>
                  {isCurrent && <Pill tone="primary">Assigned</Pill>}
                </div>
                {program.warnings.length > 0 && (
                  <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                    <p className="flex items-center gap-1.5 font-semibold">
                      <AlertTriangle className="size-3.5" /> {program.warnings.length} source
                      warning
                      {program.warnings.length === 1 ? "" : "s"}
                    </p>
                    {program.warnings.slice(0, 2).map((w, i) => (
                      <p key={i} className="mt-1 text-muted-foreground">
                        {w.message}
                      </p>
                    ))}
                  </div>
                )}
                <div className="mt-auto">
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!live || busy || isCurrent}
                    onClick={() => onAssign(program)}
                  >
                    {isCurrent ? "Currently assigned" : gated ? "Review & assign" : "Assign to me"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {pending && (
            <>
              <DialogHeader>
                <DialogTitle className="tracking-tight">Acknowledge before assignment</DialogTitle>
                <DialogDescription>
                  {pending.name} is released as{" "}
                  {RELEASE_GATE_LABEL[pending.releaseGate].toLowerCase()}. Read the source notes
                  below, then confirm you accept them.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-xs">
                {pending.warnings.length === 0 ? (
                  <p className="text-muted-foreground">
                    No specific warnings were recorded for this program, but it is not publicly
                    released.
                  </p>
                ) : (
                  pending.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2"
                    >
                      <p className="font-semibold">
                        {w.severity ? w.severity.toUpperCase() : "NOTE"}
                      </p>
                      <p className="mt-0.5">{w.message}</p>
                      {w.sourceText && (
                        <p className="mt-1 text-muted-foreground">Source: {w.sourceText}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-1 size-4 accent-[var(--color-primary)]"
                />
                <span>
                  I have read these warnings and accept this program as-is. Assigning it will
                  replace my current assignment.
                </span>
              </label>
              <ErrorLine message={error} />
              <Button
                className="w-full"
                disabled={!ack || busy}
                onClick={() => void assign(pending, true)}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <ClipboardList className="size-4" />
                )}{" "}
                Assign program
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

/* --------------------------------------------------------- active schedule */

export function ActiveProgramPanel({ enrollment }: { enrollment: ProgramEnrollment }) {
  const invalidate = useIronDeskInvalidate();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipOpen, setSkipOpen] = useState(false);
  const [reason, setReason] = useState("");

  const progress = programProgress(enrollment);
  const slotCount = enrollment.program.slots.length;
  const current = currentSlot(enrollment);

  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      invalidate();
      after?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title={enrollment.program.name}
      eyebrow={enrollment.status === "paused" ? "Paused assignment" : "Active assignment"}
      action={
        enrollment.status === "paused" ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => programs.resumeEnrollment(enrollment.id))}
          >
            <Play className="size-4" /> Resume
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => programs.pauseEnrollment(enrollment.id))}
          >
            <Pause className="size-4" /> Pause
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <ErrorLine message={error} />

        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={enrollment.status === "active" ? "success" : "warning"}>
            {enrollment.status}
          </Pill>
          <Pill>Cycle {enrollment.currentCycle}</Pill>
          <Pill>
            Workout {enrollment.currentPosition} of {slotCount}
          </Pill>
          <Pill tone={enrollment.program.releaseGate === "public" ? "success" : "warning"}>
            {RELEASE_GATE_LABEL[enrollment.program.releaseGate]}
          </Pill>
          {enrollment.acknowledgedAt && <Pill tone="primary">Acknowledged</Pill>}
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-xs text-muted-foreground">
            <span>Cycle progress</span>
            <span className="numeric">
              {progress.completed} done · {progress.skipped} skipped
            </span>
          </div>
          <ProgressBar value={progress.percent} />
        </div>

        {current && (
          <div className="panel space-y-3 p-4">
            <p className="label-eyebrow">Next assigned workout</p>
            <h3 className="text-lg leading-tight font-bold tracking-tight">
              {current.label ?? current.templateName}
            </h3>
            <p className="text-xs text-muted-foreground">
              {current.templateFocus ?? current.templateName} · {current.movementCount} movements
              {current.estimatedMinutes ? ` · ~${current.estimatedMinutes}m` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || enrollment.status !== "active"}
                onClick={() =>
                  void run(
                    () => programs.startAssignedWorkout(enrollment.id),
                    () => void navigate({ to: "/workout" }),
                  )
                }
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4" />
                )}{" "}
                Start assigned workout
              </Button>
              <Button
                variant="secondary"
                disabled={busy || enrollment.status !== "active"}
                onClick={() => {
                  setReason("");
                  setSkipOpen(true);
                }}
              >
                <SkipForward className="size-4" /> Skip
              </Button>
            </div>
            {enrollment.status !== "active" && (
              <p className="text-xs text-muted-foreground">Resume this assignment to train it.</p>
            )}
          </div>
        )}

        <div className="space-y-1.5">
          <p className="label-eyebrow">Schedule</p>
          {enrollment.program.slots.map((slot) => {
            const state = slotState(slot.position, enrollment, slotCount);
            return (
              <div
                key={slot.id}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5",
                  state === "current" || state === "in_progress"
                    ? "border-primary/50 bg-primary/10"
                    : "border-border bg-surface-2/40",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    <span className="numeric mr-2 text-muted-foreground">{slot.position}</span>
                    {slot.label ?? slot.templateName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {slot.templateFocus ?? slot.templateName} · {slot.movementCount} movements
                  </p>
                </div>
                <span className="shrink-0">
                  {state === "completed" ? (
                    <Pill tone="success">
                      <CheckCircle2 className="mr-1 inline size-3" />
                      {SLOT_STATE_LABEL[state]}
                    </Pill>
                  ) : (
                    <Pill
                      tone={state === "current" || state === "in_progress" ? "primary" : undefined}
                    >
                      {SLOT_STATE_LABEL[state]}
                    </Pill>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog open={skipOpen} onOpenChange={setSkipOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-tight">Skip this workout</DialogTitle>
            <DialogDescription>
              Only the current workout is skipped — the rest of the program stays in order.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional): travel, injury, low readiness…"
            rows={3}
          />
          <Button
            className="w-full"
            disabled={busy}
            onClick={() =>
              void run(
                () => programs.skipCurrentWorkout(enrollment.id, reason),
                () => setSkipOpen(false),
              )
            }
          >
            <SkipForward className="size-4" /> Skip workout
          </Button>
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

/* ------------------------------------------------- compact Today/Next card */

/** Dashboard + /workout entry point into the assigned program. */
export function AssignedWorkoutCard() {
  const live = useLive();
  const invalidate = useIronDeskInvalidate();
  const navigate = useNavigate();
  const { data: enrollment, isLoading } = useEnrollment();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!live || isLoading) return null;

  if (!enrollment) {
    return (
      <SectionCard title="My Program" eyebrow="Assigned">
        <EmptyState
          title="No program assigned"
          description="Assign an IronDesk Original rotation or a Legacy Beta program to get an ordered plan with a clear next workout."
          action={
            <Button asChild>
              <Link to="/program">
                <ClipboardList className="size-4" /> Browse programs
              </Link>
            </Button>
          }
        />
      </SectionCard>
    );
  }

  const current = currentSlot(enrollment);
  const progress = programProgress(enrollment);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await programs.startAssignedWorkout(enrollment.id);
      invalidate();
      void navigate({ to: "/workout" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the assigned workout.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Next Assigned Workout"
      eyebrow={enrollment.program.name}
      action={
        <Button size="sm" variant="ghost" asChild>
          <Link to="/program">Open program</Link>
        </Button>
      }
    >
      <div className="space-y-3">
        <ErrorLine message={error} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill tone={enrollment.status === "active" ? "success" : "warning"}>
            {enrollment.status}
          </Pill>
          <Pill>
            Workout {enrollment.currentPosition} of {progress.slotCount}
          </Pill>
          <Pill>Cycle {enrollment.currentCycle}</Pill>
        </div>
        <div>
          <h3 className="text-lg leading-tight font-bold tracking-tight">
            {current ? (current.label ?? current.templateName) : "Program complete"}
          </h3>
          {current && (
            <p className="mt-1 text-xs text-muted-foreground">
              {current.templateFocus ?? current.templateName} · {current.movementCount} movements
              {current.estimatedMinutes ? ` · ~${current.estimatedMinutes}m` : ""}
            </p>
          )}
        </div>
        <ProgressBar value={progress.percent} />
        {current && (
          <Button
            className="w-full sm:w-auto"
            disabled={busy || enrollment.status !== "active"}
            onClick={() => void start()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}{" "}
            Start assigned workout
          </Button>
        )}
        {enrollment.status !== "active" && (
          <p className="text-xs text-muted-foreground">
            This assignment is paused — resume it in My Program.
          </p>
        )}
      </div>
    </SectionCard>
  );
}
