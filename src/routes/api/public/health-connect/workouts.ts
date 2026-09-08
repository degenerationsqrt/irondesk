import { createFileRoute } from "@tanstack/react-router";

import { handleWorkoutExport } from "@/lib/imports/workout-export.server";

export const Route = createFileRoute("/api/public/health-connect/workouts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        return handleWorkoutExport(request, supabaseAdmin);
      },
    },
  },
});
