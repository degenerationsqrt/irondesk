import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "log_body_metric",
  title: "Log body metric",
  description:
    "Record a body measurement (weight in kg, body-fat percent, waist in cm) for the signed-in athlete.",
  inputSchema: {
    weight_kg: z.number().optional().describe("Body weight in kilograms."),
    body_fat_percent: z.number().optional().describe("Body fat percentage."),
    waist_cm: z.number().optional().describe("Waist measurement in centimeters."),
    recorded_at: z.string().optional().describe("ISO timestamp. Defaults to now."),
    note: z.string().optional().describe("Short note."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const userId = ctx.getUserId();
    if (!userId) return unauthenticated();
    if (input.weight_kg === undefined && input.body_fat_percent === undefined && input.waist_cm === undefined) {
      return {
        content: [{ type: "text", text: "Provide at least one of weight_kg, body_fat_percent or waist_cm." }],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("body_metrics")
      .insert({
        user_id: userId,
        weight_kg: input.weight_kg,
        body_fat_percent: input.body_fat_percent,
        waist_cm: input.waist_cm,
        recorded_at: input.recorded_at ?? new Date().toISOString(),
        note: input.note?.trim().slice(0, 500) || null,
      })
      .select("id, recorded_at, weight_kg, body_fat_percent, waist_cm, note")
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { metric: data },
    };
  },
});
