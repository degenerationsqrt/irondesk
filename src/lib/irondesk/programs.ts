/**
 * Live (signed-in) program delivery repository.
 *
 * Reads go through RLS: system programs are readable by any authenticated
 * athlete, personal programs are owner-scoped, and enrollments / scheduled
 * workouts are private. Every state change (enroll, pause, resume, skip,
 * start) runs through a database function so ownership, acknowledgment and
 * slot advancement can never be decided by the client.
 */
import { supabase } from "@/integrations/supabase/client";

import { asIronDeskError, IronDeskError } from "./errors";
import type {
  Program,
  ProgramEnrollment,
  ProgramSlot,
  ReleaseGate,
  ScheduledSlot,
  ScheduledStatus,
  SourceWarning,
} from "./types";

const PROGRAM_SELECT = `
  id, source_key, name, description, is_system, environment, level, days_per_week,
  schedule_mode, release_gate, warnings, tags, sort_order, is_active,
  program_workouts (
    id, position, template_id, label, day_of_week,
    workout_templates ( name, focus, estimated_minutes, template_exercises ( id ) )
  )
`;

type ProgramQueryRow = {
  id: string;
  source_key: string | null;
  name: string;
  description: string | null;
  is_system: boolean;
  environment: string | null;
  level: string | null;
  days_per_week: number | null;
  schedule_mode: string;
  release_gate: string;
  warnings: unknown;
  tags: string[] | null;
  sort_order: number | null;
  program_workouts: {
    id: string;
    position: number;
    template_id: string;
    label: string | null;
    day_of_week: number | null;
    workout_templates: {
      name: string;
      focus: string | null;
      estimated_minutes: number | null;
      template_exercises: { id: string }[] | null;
    } | null;
  }[];
};

const gateOf = (value: string): ReleaseGate =>
  value === "coach_review" ||
  value === "blocked_pending_source_review" ||
  value === "blocked_by_pyramid_engine_and_source_review"
    ? value
    : "public";

export function toWarnings(value: unknown): SourceWarning[] {
  if (!Array.isArray(value)) return [];
  const out: SourceWarning[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const w = raw as Record<string, unknown>;
    const str = (key: string) => (typeof w[key] === "string" ? (w[key] as string) : undefined);
    const message = str("message") ?? "";
    if (!message) continue;
    const warning: SourceWarning = { message };
    const code = str("code");
    if (code) warning.code = code;
    const severity = str("severity");
    if (severity) warning.severity = severity;
    const sourceText = str("sourceText");
    if (sourceText) warning.sourceText = sourceText;
    const workoutId = str("workoutId");
    if (workoutId) warning.workoutId = workoutId;
    out.push(warning);
  }
  return out;
}


function mapProgram(row: ProgramQueryRow): Program {
  const gate = gateOf(row.release_gate);
  const slots: ProgramSlot[] = (row.program_workouts ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((slot) => ({
      id: slot.id,
      position: slot.position,
      templateId: slot.template_id,
      label: slot.label,
      dayOfWeek: slot.day_of_week,
      templateName: slot.workout_templates?.name ?? slot.label ?? "Workout",
      templateFocus: slot.workout_templates?.focus ?? null,
      movementCount: slot.workout_templates?.template_exercises?.length ?? 0,
      estimatedMinutes: slot.workout_templates?.estimated_minutes ?? null,
    }));

  return {
    id: row.id,
    sourceKey: row.source_key,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    environment: row.environment,
    level: row.level,
    daysPerWeek: row.days_per_week,
    scheduleMode: row.schedule_mode,
    releaseGate: gate,
    requiresAcknowledgment: gate !== "public",
    tags: row.tags ?? [],
    sortOrder: row.sort_order ?? 1000,
    warnings: toWarnings(row.warnings),
    slots,
  };
}

/** Assignable catalog: system programs plus the athlete's own programs. */
export async function listPrograms(): Promise<Program[]> {
  const res = await supabase
    .from("programs")
    .select(PROGRAM_SELECT)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .returns<ProgramQueryRow[]>();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  return (res.data ?? []).map(mapProgram).filter((p) => p.slots.length > 0);
}

const statusOf = (value: string): ScheduledStatus =>
  value === "in_progress" ||
  value === "completed" ||
  value === "skipped" ||
  value === "expired" ||
  value === "cancelled"
    ? value
    : "planned";

/** The athlete's single current (active or paused) enrollment, if any. */
export async function getCurrentEnrollment(): Promise<ProgramEnrollment | null> {
  const res = await supabase
    .from("program_enrollments")
    .select(
      `id, status, started_on, current_position, current_week, current_cycle,
       acknowledged_at, acknowledged_gate, program_id`,
    )
    .in("status", ["active", "paused"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) throw asIronDeskError(new Error(res.error.message));
  const row = res.data;
  if (!row) return null;

  const [programRes, scheduleRes] = await Promise.all([
    supabase.from("programs").select(PROGRAM_SELECT).eq("id", row.program_id).single<ProgramQueryRow>(),
    supabase
      .from("scheduled_workouts")
      .select("id, sequence_index, status, scheduled_for, session_id, program_workouts ( position )")
      .eq("enrollment_id", row.id)
      .order("sequence_index", { ascending: true }),
  ]);
  if (programRes.error) throw asIronDeskError(new Error(programRes.error.message));
  if (scheduleRes.error) throw asIronDeskError(new Error(scheduleRes.error.message));

  const schedule: ScheduledSlot[] = (scheduleRes.data ?? []).map((s) => ({
    id: s.id,
    sequenceIndex: s.sequence_index,
    position: (s.program_workouts as { position: number } | null)?.position ?? 0,
    status: statusOf(s.status),
    scheduledFor: s.scheduled_for,
    sessionId: s.session_id,
  }));

  return {
    id: row.id,
    status: row.status as ProgramEnrollment["status"],
    startedOn: row.started_on,
    currentPosition: row.current_position,
    currentWeek: row.current_week,
    currentCycle: row.current_cycle,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedGate: row.acknowledged_gate,
    program: mapProgram(programRes.data),
    schedule,
  };
}

function rpcError(message: string): IronDeskError {
  if (/acknowledg/i.test(message)) return new IronDeskError(message, "validation");
  if (/in progress|active workout/i.test(message)) return new IronDeskError(message, "conflict");
  return asIronDeskError(new Error(message));
}

export async function enrollInProgram(programId: string, acknowledged = false): Promise<string> {
  const res = await supabase.rpc("enroll_in_program", {
    _program_id: programId,
    _acknowledged: acknowledged,
  });
  if (res.error) throw rpcError(res.error.message);
  return res.data as string;
}

export async function pauseEnrollment(enrollmentId: string): Promise<void> {
  const res = await supabase.rpc("pause_program_enrollment", { _enrollment_id: enrollmentId });
  if (res.error) throw rpcError(res.error.message);
}

export async function resumeEnrollment(enrollmentId: string): Promise<void> {
  const res = await supabase.rpc("resume_program_enrollment", { _enrollment_id: enrollmentId });
  if (res.error) throw rpcError(res.error.message);
}

/**
 * Skips only the current slot. The reason is trimmed, bounded and written by
 * the database function itself: clients have no write access to schedules.
 */
export async function skipCurrentWorkout(enrollmentId: string, reason?: string): Promise<void> {
  const clean = reason?.trim();
  const res = await supabase.rpc("skip_current_program_workout", {
    _enrollment_id: enrollmentId,
    ...(clean ? { _reason: clean } : {}),
  });
  if (res.error) throw rpcError(res.error.message);
}

/**
 * Starts the current assigned slot. The database function verifies the
 * enrollment, acknowledgment and slot match, then snapshots the template's
 * prescriptions into session exercises and planned sets.
 */
export async function startAssignedWorkout(enrollmentId: string): Promise<string> {
  const res = await supabase.rpc("start_assigned_workout", { _enrollment_id: enrollmentId });
  if (res.error) throw rpcError(res.error.message);
  return res.data as string;
}

/**
 * Starts any active template as free training. Assignment-only Legacy Beta
 * content requires an explicit acknowledgment, which the database function
 * verifies; prescriptions are snapshotted exactly as assigned delivery does.
 */
export async function startLibraryWorkout(templateId: string, acknowledged = false): Promise<string> {
  const res = await supabase.rpc("start_library_workout", {
    _template_id: templateId,
    _acknowledged: acknowledged,
  });
  if (res.error) throw rpcError(res.error.message);
  return res.data as string;
}

export interface AssignedSessionContext {
  sessionId: string;
  programName: string;
  slotLabel: string;
  position: number;
  cycle: number;
}

/** Program context for completed sessions, keyed by session id (History). */
export async function getAssignedSessionContexts(): Promise<Record<string, AssignedSessionContext>> {
  const res = await supabase
    .from("scheduled_workouts")
    .select(
      `session_id, sequence_index,
       program_workouts ( position, label, workout_templates ( name ) ),
       program_enrollments ( programs ( name ) )`,
    )
    .not("session_id", "is", null);
  if (res.error) throw asIronDeskError(new Error(res.error.message));

  const out: Record<string, AssignedSessionContext> = {};
  for (const row of res.data ?? []) {
    const sessionId = row.session_id as string | null;
    if (!sessionId) continue;
    const slot = row.program_workouts as {
      position: number;
      label: string | null;
      workout_templates: { name: string } | null;
    } | null;
    const program = (row.program_enrollments as { programs: { name: string } | null } | null)?.programs ?? null;
    out[sessionId] = {
      sessionId,
      programName: program?.name ?? "Assigned program",
      slotLabel: slot?.label ?? slot?.workout_templates?.name ?? "Assigned workout",
      position: slot?.position ?? 0,
      cycle: 1,
    };
  }
  return out;
}
