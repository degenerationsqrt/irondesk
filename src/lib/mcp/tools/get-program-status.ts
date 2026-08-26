import { defineTool } from "@lovable.dev/mcp-js";

import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "get_program_status",
  title: "Get assigned program status",
  description:
    "Show the signed-in athlete's assigned training program enrollments (program name, status, cycle, position) and the next planned sessions.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const supabase = supabaseForUser(ctx);

    const { data: enrollments, error } = await supabase
      .from("program_enrollments")
      .select(
        "id, status, current_cycle, current_position, current_week, started_on, training_days, programs(name, level, days_per_week, cycle_length_weeks)",
      )
      .order("created_at", { ascending: false });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const { data: upcoming } = await supabase
      .from("scheduled_workouts")
      .select("id, scheduled_for, status, enrollment_id, position")
      .in("status", ["planned", "in_progress"])
      .order("scheduled_for", { ascending: true })
      .limit(10);

    const payload = { enrollments: enrollments ?? [], upcoming: upcoming ?? [] };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload,
    };
  },
});
