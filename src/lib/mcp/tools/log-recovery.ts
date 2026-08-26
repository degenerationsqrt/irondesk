import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "log_recovery",
  title: "Log recovery entry",
  description:
    "Create or update the signed-in athlete's recovery entry for a day: sleep, resting HR, HRV, soreness, fatigue, stress and readiness.",
  inputSchema: {
    day: z.string().optional().describe("ISO date (YYYY-MM-DD). Defaults to today."),
    sleep_hours: z.number().optional().describe("Hours slept."),
    resting_hr: z.number().int().optional().describe("Resting heart rate in bpm."),
    hrv_ms: z.number().int().optional().describe("HRV in milliseconds."),
    readiness: z.number().int().optional().describe("Readiness score 0-100."),
    fatigue: z.number().int().optional().describe("Fatigue rating 1-10."),
    stress: z.number().int().optional().describe("Stress rating 1-10."),
    note: z.string().optional().describe("Short free-text note."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const userId = ctx.getUserId();
    if (!userId) return unauthenticated();
    const supabase = supabaseForUser(ctx);

    const day = (input.day ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    const clamp = (v: number | undefined, min: number, max: number) =>
      v === undefined ? undefined : Math.min(Math.max(v, min), max);

    const row = {
      user_id: userId,
      day,
      source: "mcp",
      sleep_hours: input.sleep_hours,
      resting_hr: clamp(input.resting_hr, 20, 220),
      hrv_ms: clamp(input.hrv_ms, 1, 400),
      readiness: clamp(input.readiness, 0, 100),
      fatigue: clamp(input.fatigue, 1, 10),
      stress: clamp(input.stress, 1, 10),
      note: input.note?.trim().slice(0, 500) || null,
    };

    const { data, error } = await supabase
      .from("recovery_entries")
      .upsert(row, { onConflict: "user_id,day" })
      .select("id, day, sleep_hours, resting_hr, hrv_ms, readiness, fatigue, stress, note")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { entry: data },
    };
  },
});
