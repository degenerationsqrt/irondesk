import { auth, defineMcp } from "@lovable.dev/mcp-js";

import getProgramStatusTool from "./tools/get-program-status";
import getWorkoutDetailTool from "./tools/get-workout-detail";
import listRecentWorkoutsTool from "./tools/list-recent-workouts";
import logBodyMetricTool from "./tools/log-body-metric";
import logRecoveryTool from "./tools/log-recovery";

// The OAuth issuer must be the direct Supabase host; the project ref is the only
// value that survives publish unchanged, and Vite inlines it at build time.
const projectRef = import.meta.env["VITE_SUPABASE_PROJECT_ID"] ?? "project-ref-unset";

export default defineMcp({
  name: "irondesk-command",
  title: "IronDesk Command",
  version: "0.1.0",
  instructions:
    "Training intelligence tools for IronDesk. Read the athlete's recent workouts and session detail, check assigned program status, and log recovery or body metrics. All data is scoped to the signed-in athlete.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  // Cast keeps `exactOptionalPropertyTypes` from rejecting tools without an outputSchema.
  tools: [
    listRecentWorkoutsTool,
    getWorkoutDetailTool,
    getProgramStatusTool,
    logRecoveryTool,
    logBodyMetricTool,
  ] as unknown as Parameters<typeof defineMcp>[0]["tools"],
});
