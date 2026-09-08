import { z } from "zod";

import { formatWeight, resolveUnits, type Units } from "@/lib/irondesk/units";

import { DeviceResolutionError, resolveDevice } from "./device-sync.server";

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const WORKOUT_EXPORT_PAGE_SIZE = 100;
// Existing Android companions accept 2,000 characters of session notes.
export const WORKOUT_EXPORT_NOTES_LIMIT = 2000;
export const WORKOUT_EXPORT_SELECT = `
  id,title,kind,status,is_sample,started_at,completed_at,updated_at,notes,
  session_exercises (
    id,exercise_name,position,
    workout_sets (set_number,reps,weight_kg,rpe,completed,is_warmup)
  )
`;
const querySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    after: z.string().uuid().optional(),
  })
  .strict();

export interface ExportSession {
  id: string;
  title: string;
  kind: string;
  status: string;
  is_sample: boolean;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  notes: string | null;
  session_exercises?: ExportExercise[];
}

export interface ExportExercise {
  id: string;
  exercise_name: string;
  position: number;
  workout_sets: {
    set_number: number;
    reps: number | null;
    weight_kg: number | null;
    rpe: number | null;
    completed: boolean;
    is_warmup: boolean;
  }[];
}

/** Human-readable actual work, never target prescriptions or invented segment timings. */
export function workoutExportNotes(row: ExportSession, units: Units): string | null {
  const exercises = (row.session_exercises ?? [])
    .map((exercise) => ({
      ...exercise,
      workout_sets: exercise.workout_sets
        .filter((set) => set.completed)
        .sort((a, b) => a.set_number - b.set_number),
    }))
    .filter((exercise) => exercise.workout_sets.length > 0)
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const lines: string[] = [];
  if (exercises.length) {
    const count = exercises.reduce((sum, exercise) => sum + exercise.workout_sets.length, 0);
    lines.push(`Performed: ${exercises.length} exercises, ${count} completed sets.`);
    for (const [index, exercise] of exercises.entries()) {
      const name = exercise.exercise_name.replace(/\s+/g, " ").trim() || "Unnamed exercise";
      lines.push(`${index + 1}. ${name}`);
      for (const set of exercise.workout_sets) {
        const reps = set.reps == null ? "reps not logged" : `${set.reps} reps`;
        const load = set.weight_kg == null ? "load not logged" : formatWeight(set.weight_kg, units);
        const rpe = set.rpe == null ? "" : `; RPE ${set.rpe}`;
        lines.push(
          `  Set ${set.set_number}${set.is_warmup ? " (warm-up)" : ""}: ${reps} × ${load}${rpe}`,
        );
      }
    }
  }
  const notes = row.notes?.trim();
  if (notes) lines.push(...(lines.length ? ["", "Session notes:"] : []), ...notes.split(/\r?\n/));
  const full = lines.join("\n");
  if (full.length <= WORKOUT_EXPORT_NOTES_LIMIT) return full || null;
  // Stop at a line boundary, so a truncated load/repetition is never presented as a fact.
  const marker = "… More details in IronDesk.";
  const budget = WORKOUT_EXPORT_NOTES_LIMIT - marker.length - 1;
  const kept: string[] = [];
  let length = 0;
  for (const line of lines) {
    const next = length + (kept.length ? 1 : 0) + line.length;
    if (next > budget) break;
    kept.push(line);
    length = next;
  }
  return [...kept, marker].join("\n");
}

/** Only actual completed native sessions, never imported activities or demo rows. */
export function exportSession(row: ExportSession, units: Units = "imperial", previewedAt = 0) {
  const start = Date.parse(row.started_at);
  const end = Date.parse(row.completed_at ?? "");
  const updated = Date.parse(row.updated_at);
  if (
    row.status !== "completed" ||
    row.is_sample ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    !Number.isFinite(updated)
  )
    return null;
  return {
    id: row.id,
    title: row.title.trim().slice(0, 200) || "IronDesk workout",
    kind: row.kind,
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    // A new preview also refreshes set edits/deletions and units, which need not touch
    // the parent session timestamp. Retrying that preview keeps this exact version.
    client_record_version: Math.max(1, updated, end, previewedAt),
    notes: workoutExportNotes(row, units),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
      ...(status === 401 ? { "www-authenticate": 'Bearer realm="irondesk-device"' } : {}),
    },
  });

/** Ownership comes exclusively from the paired Android credential, never query parameters. */
export async function handleWorkoutExport(request: Request, admin: AdminClient, now = Date.now()) {
  try {
    const device = await resolveDevice(admin, request.headers.get("authorization"), "android");
    if (!device) return json({ error: "Unknown or revoked device token." }, 401);
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return json({ error: "Invalid workout date range or cursor." }, 400);
    const { from, to, after } = parsed.data;
    const start = Date.parse(from);
    const end = Date.parse(to);
    if (end <= start || end - start > 366 * 86400000 || end > now + 60000) {
      return json({ error: "Choose a past workout range of up to one year." }, 400);
    }
    let query = admin
      .from("workout_sessions")
      .select(WORKOUT_EXPORT_SELECT)
      .eq("user_id", device.userId)
      .eq("status", "completed")
      .eq("is_sample", false)
      .gte("completed_at", from)
      .lte("completed_at", to)
      .order("id", { ascending: true })
      .limit(WORKOUT_EXPORT_PAGE_SIZE + 1);
    if (after) query = query.gt("id", after);
    const [{ data, error }, preferences] = await Promise.all([
      query,
      admin.from("user_preferences").select("units").eq("user_id", device.userId).maybeSingle(),
    ]);
    if (error || preferences.error)
      return json({ error: "IronDesk workouts are temporarily unavailable." }, 503);
    const units = resolveUnits(preferences.data?.units);
    const page = (data ?? []).slice(0, WORKOUT_EXPORT_PAGE_SIZE);
    const workouts = page
      .map((row) => exportSession(row, units, now))
      .filter((row) => row !== null);
    return json({
      schema_version: 1,
      workouts,
      skipped: page.length - workouts.length,
      next_cursor: (data?.length ?? 0) > WORKOUT_EXPORT_PAGE_SIZE ? page.at(-1)!.id : null,
    });
  } catch (error) {
    if (error instanceof DeviceResolutionError) return json({ error: error.message }, 503);
    return json({ error: "IronDesk workouts could not be loaded. Please retry." }, 503);
  }
}
