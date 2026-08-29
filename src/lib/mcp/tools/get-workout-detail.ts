import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_workout_detail",
  title: "Get workout detail",
  description:
    "Return one of the signed-in athlete's workout sessions with its exercises, targets and logged sets (weight, reps, RPE).",
  inputSchema: { session_id: z.string().describe("Workout session id.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ session_id }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);
    const { data: session, error } = await supabase
      .from("workout_sessions")
      .select("id, title, kind, focus, status, started_at, completed_at, perceived_effort, notes")
      .eq("id", session_id)
      .eq("is_sample", false)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!session) return { content: [{ type: "text", text: "Workout not found." }], isError: true };

    const { data: exercises, error: exErr } = await supabase
      .from("session_exercises")
      .select(
        "id, exercise_name, position, equipment, primary_muscle, target_sets, target_reps, target_rpe, load_guidance, notes, workout_sets(set_number, weight_kg, reps, rpe, completed, is_warmup, notes)",
      )
      .eq("session_id", session_id)
      .order("position", { ascending: true });
    if (exErr) return { content: [{ type: "text", text: exErr.message }], isError: true };

    const payload = { session, exercises: exercises ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
