/**
 * Pure program-delivery rules. Kept free of React and Supabase so the gating
 * and progress maths can be unit-tested and reused by any client.
 */
import type { Program, ProgramEnrollment, ReleaseGate, ScheduledStatus, WorkoutTemplate } from "./types";

export const RELEASE_GATE_LABEL: Record<ReleaseGate, string> = {
  public: "Approved",
  coach_review: "Coach review",
  blocked_pending_source_review: "Blocked · source review",
  blocked_by_pyramid_engine_and_source_review: "Blocked · pyramid engine + source review",
};

/** Any gate other than `public` requires an explicit warning acknowledgment. */
export function requiresAcknowledgment(program: Pick<Program, "releaseGate" | "requiresAcknowledgment">): boolean {
  return program.requiresAcknowledgment || program.releaseGate !== "public";
}

/**
 * A template is startable as ordinary free training only when the source
 * released it publicly. Legacy Beta prescriptions stay assignment-only.
 */
export function isFreeStartable(template: Pick<WorkoutTemplate, "libraryStartable" | "releaseGate">): boolean {
  if (template.libraryStartable === false) return false;
  return (template.releaseGate ?? "public") === "public";
}

export type SlotState = "completed" | "current" | "in_progress" | "skipped" | "upcoming";

export const SLOT_STATE_LABEL: Record<SlotState, string> = {
  completed: "Completed",
  current: "Current",
  in_progress: "In progress",
  skipped: "Skipped",
  upcoming: "Upcoming",
};

/**
 * Resolves the display state of one ordered slot for the enrollment's current
 * cycle. Positions before the cursor are done (or skipped), the cursor itself
 * is current unless a session is already running against it.
 */
export function slotState(
  position: number,
  enrollment: Pick<ProgramEnrollment, "currentPosition" | "currentCycle" | "schedule">,
  slotCount: number,
): SlotState {
  const sequenceIndex = (enrollment.currentCycle - 1) * slotCount + position;
  const scheduled = enrollment.schedule.find((s) => s.sequenceIndex === sequenceIndex);
  const status: ScheduledStatus | undefined = scheduled?.status;
  if (status === "completed") return "completed";
  if (status === "skipped") return "skipped";
  if (status === "in_progress") return "in_progress";
  if (position === enrollment.currentPosition) return "current";
  return position < enrollment.currentPosition ? "completed" : "upcoming";
}

export interface ProgramProgress {
  slotCount: number;
  completed: number;
  skipped: number;
  /** Completion of the current cycle, 0-100. */
  percent: number;
}

export function programProgress(enrollment: ProgramEnrollment): ProgramProgress {
  const slotCount = enrollment.program.slots.length;
  const base = (enrollment.currentCycle - 1) * slotCount;
  const cycle = enrollment.schedule.filter(
    (s) => s.sequenceIndex > base && s.sequenceIndex <= base + slotCount,
  );
  const completed = cycle.filter((s) => s.status === "completed").length;
  const skipped = cycle.filter((s) => s.status === "skipped").length;
  const percent = slotCount === 0 ? 0 : Math.round(((completed + skipped) / slotCount) * 100);
  return { slotCount, completed, skipped, percent };
}

/** The slot the athlete is meant to train next in the current cycle. */
export function currentSlot(enrollment: ProgramEnrollment) {
  return enrollment.program.slots.find((s) => s.position === enrollment.currentPosition) ?? null;
}
