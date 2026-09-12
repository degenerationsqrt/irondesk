import { defineTool } from "@lovable.dev/mcp-js";

import { dayKeyForInstant } from "../../irondesk/dates";
import { supabaseForUser, unauthenticated } from "../supabase";
import { invalidInput, recoveryInput } from "../validation";

export default defineTool({
  name: "log_recovery",
  title: "Log recovery entry",
  description:
    "Create or update the signed-in athlete's recovery entry for a day: sleep, resting HR, HRV, fatigue, stress and readiness. Omitted fields keep existing real values; untouched sample values are discarded. An empty note clears the note.",
  inputSchema: recoveryInput.shape,
  annotations: {
    readOnlyHint: false,
    // Existing measurements and notes can be replaced by this update.
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return unauthenticated();
    const userId = ctx.getUserId();
    if (!userId) return unauthenticated();
    const parsed = recoveryInput.safeParse(input);
    if (!parsed.success) return invalidInput(parsed.error);
    const { day: requestedDay, note, ...measurements } = parsed.data;
    const providedMeasurements = Object.fromEntries(
      Object.entries(measurements).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(providedMeasurements).length === 0 && note === undefined) {
      return {
        content: [{ type: "text", text: "Provide at least one recovery measurement or note." }],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);

    let day = requestedDay;
    if (!day) {
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("timezone")
        .eq("id", userId)
        .maybeSingle();
      if (profileError)
        return { content: [{ type: "text", text: profileError.message }], isError: true };
      day = dayKeyForInstant(new Date(), profile?.timezone);
    }
    const patch = {
      ...providedMeasurements,
      ...(note !== undefined ? { note: note || null } : {}),
    };

    // The database merges under its row lock and resets untouched sample data
    // when a demonstration entry is replaced with the athlete's first check-in.
    const { data, error } = await supabase.rpc("patch_recovery_entry", {
      _day: day,
      _patch: patch,
    });
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { entry: data },
    };
  },
});
