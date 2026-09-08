import { z } from "zod";

import { DeviceResolutionError, resolveDevice } from "./device-sync.server";

type AdminClient = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export const WORKOUT_EXPORT_PAGE_SIZE = 100;
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
}

/** Only actual completed native sessions, never imported activities or demo rows. */
export function exportSession(row: ExportSession) {
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
    client_record_version: Math.max(1, updated, end),
    notes: row.notes?.trim().slice(0, 2000) || null,
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
      .select("id,title,kind,status,is_sample,started_at,completed_at,updated_at,notes")
      .eq("user_id", device.userId)
      .eq("status", "completed")
      .eq("is_sample", false)
      .gte("completed_at", from)
      .lte("completed_at", to)
      .order("id", { ascending: true })
      .limit(WORKOUT_EXPORT_PAGE_SIZE + 1);
    if (after) query = query.gt("id", after);
    const { data, error } = await query;
    if (error) return json({ error: "IronDesk workouts are temporarily unavailable." }, 503);
    const page = (data ?? []).slice(0, WORKOUT_EXPORT_PAGE_SIZE);
    const workouts = page.map(exportSession).filter((row) => row !== null);
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
