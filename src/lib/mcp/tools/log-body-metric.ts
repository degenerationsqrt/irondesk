import { defineTool } from "@lovable.dev/mcp-js";

import { supabaseForUser, unauthenticated } from "../supabase";
import { bodyMetricInput, invalidInput } from "../validation";

export default defineTool({
  name: "log_body_metric",
  title: "Log body metric",
  description:
    "Record a body measurement (weight in kg, body-fat percent, waist in cm) for the signed-in athlete.",
  inputSchema: bodyMetricInput.shape,
  // Each call appends a new measurement row, so it is explicitly non-idempotent.
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const userId = ctx.getUserId();
    if (!userId) return unauthenticated();
    const parsed = bodyMetricInput.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const measurement = parsed.data;
    if (
      measurement.weight_kg === undefined &&
      measurement.body_fat_percent === undefined &&
      measurement.waist_cm === undefined
    ) {
      return {
        content: [
          {
            type: "text",
            text: "Provide at least one of weight_kg, body_fat_percent or waist_cm.",
          },
        ],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("body_metrics")
      .insert({
        user_id: userId,
        weight_kg: measurement.weight_kg ?? null,
        body_fat_percent: measurement.body_fat_percent ?? null,
        waist_cm: measurement.waist_cm ?? null,
        recorded_at: measurement.recorded_at ?? new Date().toISOString(),
        note: measurement.note || null,
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
