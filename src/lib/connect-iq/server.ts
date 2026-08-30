/**
 * Server-only contract for the Garmin Connect IQ workout companion.
 *
 * The watch never receives Supabase credentials. Public routes resolve a
 * hashed device token to one user, and every read/write is then scoped to that
 * identity. All stored and transmitted loads are canonical kilograms.
 */
import { z } from "zod";

import type { DeviceIdentity } from "@/lib/imports/device-sync.server";

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

const uuid = z.string().uuid();
const eventId = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

/** Accept the watch-friendly Unix-second form and ISO strings from test/tools. */
export const occurredAtSchema = z
  .union([
    z.number().int().min(946_684_800).max(4_102_444_800),
    z.string().datetime({ offset: true }),
  ])
  .transform((value) =>
    typeof value === "number"
      ? new Date(value * 1_000).toISOString()
      : new Date(value).toISOString(),
  );

const setUpdatePayloadSchema = z
  .object({
    weight_kg: z.number().finite().min(0).max(1_000).nullable().optional(),
    reps: z.number().int().min(0).max(500).nullable().optional(),
    rpe: z.number().finite().min(1).max(10).nullable().optional(),
    completed: z.boolean().optional(),
    rest_seconds: z.number().int().min(0).max(3_600).nullable().optional(),
  })
  .strict()
  .refine((payload) => Object.keys(payload).length > 0, "Provide at least one set field.");

const workoutFinishedPayloadSchema = z
  .object({
    avg_hr: z.number().int().min(30).max(240).nullable().optional(),
    max_hr: z.number().int().min(30).max(260).nullable().optional(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.avg_hr != null && payload.max_hr != null && payload.max_hr < payload.avg_hr) {
      ctx.addIssue({
        code: "custom",
        path: ["max_hr"],
        message: "max_hr cannot be lower than avg_hr.",
      });
    }
  });

export const connectIqEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      event_id: eventId,
      session_id: uuid,
      set_id: uuid,
      type: z.literal("set.updated"),
      occurred_at: occurredAtSchema,
      payload: setUpdatePayloadSchema,
    })
    .strict(),
  z
    .object({
      event_id: eventId,
      session_id: uuid,
      type: z.literal("workout.finished"),
      occurred_at: occurredAtSchema,
      payload: workoutFinishedPayloadSchema.default({}),
    })
    .strict(),
]);

export const connectIqEventsRequestSchema = z
  .object({ events: z.array(connectIqEventSchema).min(1).max(100) })
  .strict()
  .superRefine(({ events }, ctx) => {
    const ids = new Set<string>();
    events.forEach((event, index) => {
      if (ids.has(event.event_id)) {
        ctx.addIssue({
          code: "custom",
          path: ["events", index, "event_id"],
          message: "event_id must be unique within a batch.",
        });
      }
      ids.add(event.event_id);
    });
  });

export type ConnectIqEvent = z.infer<typeof connectIqEventSchema>;

export const CONNECT_IQ_SNAPSHOT_LIMITS = {
  maxUtf8Bytes: 24 * 1024,
  maxExercises: 24,
  maxSetsPerExercise: 16,
  maxTotalSets: 60,
  maxTitleChars: 80,
  maxFocusChars: 160,
  maxExerciseNameChars: 80,
  maxTargetRepsChars: 40,
  maxLoadGuidanceChars: 240,
} as const;

interface ConnectIqSetRow {
  id: string;
  set_number: number;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  completed: boolean;
  is_warmup: boolean;
  rest_seconds: number | null;
}

interface ConnectIqExerciseRow {
  id: string;
  exercise_name: string;
  position: number;
  target_reps: string | null;
  rest_seconds: number | null;
  load_guidance: string | null;
  workout_sets: ConnectIqSetRow[];
}

export interface ConnectIqSessionRow {
  id: string;
  user_id: string;
  title: string;
  focus: string | null;
  status: string;
  started_at: string;
  is_sample: boolean;
  session_exercises: ConnectIqExerciseRow[];
}

export interface ConnectIqWorkoutSnapshot {
  schema_version: 1;
  workout: null | {
    id: string;
    title: string;
    focus: string | null;
    started_at: string;
    exercises: Array<{
      id: string;
      name: string;
      target_reps: string | null;
      rest_seconds: number | null;
      load_guidance: string | null;
      sets: ConnectIqSetRow[];
    }>;
  };
}

const watchLimitError = (message: string): never => {
  throw new ConnectIqApiError(message, 422);
};

/** Rejects snapshots that cannot be stored and executed safely on the watch. */
export function assertConnectIqSnapshotExecutable(
  snapshot: ConnectIqWorkoutSnapshot,
): ConnectIqWorkoutSnapshot {
  const workout = snapshot.workout;
  if (!workout) return snapshot;
  const limits = CONNECT_IQ_SNAPSHOT_LIMITS;

  if (workout.title.length > limits.maxTitleChars) {
    return watchLimitError(
      `Shorten the active workout title to ${limits.maxTitleChars} characters or fewer.`,
    );
  }
  if (workout.focus != null && workout.focus.length > limits.maxFocusChars) {
    return watchLimitError(
      `Shorten the active workout focus to ${limits.maxFocusChars} characters or fewer.`,
    );
  }
  if (workout.exercises.length > limits.maxExercises) {
    return watchLimitError(
      `Garmin supports at most ${limits.maxExercises} exercises in one active workout.`,
    );
  }

  let totalSets = 0;
  for (const exercise of workout.exercises) {
    if (exercise.name.length > limits.maxExerciseNameChars) {
      return watchLimitError(
        `Shorten Garmin exercise names to ${limits.maxExerciseNameChars} characters or fewer.`,
      );
    }
    if (exercise.target_reps != null && exercise.target_reps.length > limits.maxTargetRepsChars) {
      return watchLimitError(
        `Shorten Garmin target-rep guidance to ${limits.maxTargetRepsChars} characters or fewer.`,
      );
    }
    if (
      exercise.load_guidance != null &&
      exercise.load_guidance.length > limits.maxLoadGuidanceChars
    ) {
      return watchLimitError(
        `Shorten Garmin load guidance to ${limits.maxLoadGuidanceChars} characters or fewer.`,
      );
    }
    if (exercise.sets.length > limits.maxSetsPerExercise) {
      return watchLimitError(
        `Garmin supports at most ${limits.maxSetsPerExercise} sets per exercise.`,
      );
    }
    totalSets += exercise.sets.length;
  }
  if (totalSets > limits.maxTotalSets) {
    return watchLimitError(
      `Garmin supports at most ${limits.maxTotalSets} total sets in one active workout.`,
    );
  }

  const utf8Bytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
  if (utf8Bytes > limits.maxUtf8Bytes) {
    return watchLimitError(
      `The active workout exceeds Garmin's ${limits.maxUtf8Bytes / 1024} KB storage budget. Shorten its text or reduce exercises and sets.`,
    );
  }
  return snapshot;
}

const ACTIVE_WORKOUT_SELECT = `
  id, user_id, title, focus, status, started_at, is_sample,
  session_exercises (
    id, exercise_name, position, target_reps, rest_seconds, load_guidance,
    workout_sets (
      id, set_number, weight_kg, reps, rpe, completed, is_warmup, rest_seconds
    )
  )
`;

export function isOwnedActiveSession(row: ConnectIqSessionRow, userId: string): boolean {
  return row.user_id === userId && !row.is_sample && row.status === "active";
}

export function toConnectIqSnapshot(
  row: ConnectIqSessionRow | null,
  userId: string,
): ConnectIqWorkoutSnapshot {
  if (!row || !isOwnedActiveSession(row, userId)) return { schema_version: 1, workout: null };
  return {
    schema_version: 1,
    workout: {
      id: row.id,
      title: row.title,
      focus: row.focus,
      started_at: row.started_at,
      exercises: row.session_exercises
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((exercise) => ({
          id: exercise.id,
          name: exercise.exercise_name,
          target_reps: exercise.target_reps,
          rest_seconds: exercise.rest_seconds,
          load_guidance: exercise.load_guidance,
          sets: exercise.workout_sets
            .slice()
            .sort((a, b) => a.set_number - b.set_number)
            .map((set) => ({
              id: set.id,
              set_number: set.set_number,
              weight_kg: set.weight_kg,
              reps: set.reps,
              rpe: set.rpe,
              completed: set.completed,
              is_warmup: set.is_warmup,
              rest_seconds: set.rest_seconds,
            })),
        })),
    },
  };
}

export async function getActiveWorkoutSnapshot(
  admin: AdminClient,
  userId: string,
): Promise<ConnectIqWorkoutSnapshot> {
  const { data, error } = await admin
    .from("workout_sessions")
    .select(ACTIVE_WORKOUT_SELECT)
    .eq("user_id", userId)
    .eq("is_sample", false)
    .eq("status", "active")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .returns<ConnectIqSessionRow | null>();
  if (error) throw new ConnectIqApiError("The active workout could not be loaded.", 500);
  return assertConnectIqSnapshotExecutable(toConnectIqSnapshot(data, userId));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(",")}}`;
}

export async function connectIqEventHash(event: ConnectIqEvent): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalJson(event)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export class ConnectIqApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly eventId?: string,
  ) {
    super(message);
  }
}

const connectIqProcessedAckSchema = z.object({ event_id: eventId }).passthrough();
export type ConnectIqProcessedAck = z.infer<typeof connectIqProcessedAckSchema>;
export interface ConnectIqRejectedAck {
  event_id: string;
  status: number;
  error: string;
}

export function hasCompleteConnectIqAckCoverage(
  requested: ReadonlyArray<{ event_id: string }>,
  processed: ReadonlyArray<{ event_id: string }>,
  rejected: ReadonlyArray<{ event_id: string }>,
): boolean {
  const requestedIds = new Set(requested.map(({ event_id }) => event_id));
  const acknowledgedIds = [...processed, ...rejected].map(({ event_id }) => event_id);
  return (
    requestedIds.size === requested.length &&
    acknowledgedIds.length === requested.length &&
    acknowledgedIds.every((id) => requestedIds.has(id)) &&
    new Set(acknowledgedIds).size === acknowledgedIds.length
  );
}

function eventError(
  error: { code?: string; message?: string },
  eventId: string,
): ConnectIqApiError {
  const code = error.code ?? "";
  const message = error.message ?? "The watch event could not be applied.";
  if (code === "P0002") return new ConnectIqApiError(message, 404, eventId);
  if (code === "23505" || code === "23514") return new ConnectIqApiError(message, 409, eventId);
  if (code === "22023") return new ConnectIqApiError(message, 400, eventId);
  console.error("[connect-iq] event RPC failed", { code, message, eventId });
  return new ConnectIqApiError("The watch event could not be applied.", 500, eventId);
}

export async function applyConnectIqEvent(
  admin: AdminClient,
  device: DeviceIdentity,
  event: ConnectIqEvent,
): Promise<ConnectIqProcessedAck> {
  const { data, error } = await admin.rpc("apply_connect_iq_event", {
    _device_id: device.deviceId,
    _user_id: device.userId,
    _event_id: event.event_id,
    _event_type: event.type,
    _request_hash: await connectIqEventHash(event),
    _session_id: event.session_id,
    // Live generated types mark _set_id non-null, but the SQL function accepts NULL.
    _set_id: (event.type === "set.updated" ? event.set_id : null) as string,
    _occurred_at: event.occurred_at,
    _payload: event.payload,
  });
  if (error) throw eventError(error, event.event_id);
  const ack = connectIqProcessedAckSchema.safeParse(data);
  if (!ack.success || ack.data.event_id !== event.event_id) {
    console.error("[connect-iq] event RPC returned an invalid acknowledgement", {
      eventId: event.event_id,
    });
    throw new ConnectIqApiError(
      "The watch event acknowledgement was invalid.",
      500,
      event.event_id,
    );
  }
  return ack.data;
}
