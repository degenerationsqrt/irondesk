import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

import { supabaseForUser, unauthenticated } from "../supabase";

export default defineTool({
  name: "list_recent_workouts",
  title: "List recent workouts",
  description:
    "List the signed-in athlete's most recent IronDesk workout sessions with status, focus, effort and completion time.",
  inputSchema: {
    limit: z.number().int().optional().describe("How many sessions to return (default 10, max 50)."),
    status: z
      .enum(["draft", "active", "completed", "cancelled"])
      .optional()
      .describe("Optional status filter."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit, status }, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const take = Math.min(Math.max(limit ?? 10, 1), 50);
    const supabase = supabaseForUser(ctx);
    let query = supabase
      .from("workout_sessions")
      .select("id, title, kind, focus, status, started_at, completed_at, perceived_effort, notes")
      .order("started_at", { ascending: false })
      .limit(take);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { sessions: data ?? [] },
    };
  },
});
