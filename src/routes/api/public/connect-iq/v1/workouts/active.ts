/** Active-workout snapshot for a paired Garmin watch. */
import { createFileRoute } from "@tanstack/react-router";

import { ConnectIqApiError, getActiveWorkoutSnapshot } from "@/lib/connect-iq/server";
import { DeviceResolutionError, resolveDevice } from "@/lib/imports/device-sync.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/connect-iq/v1/workouts/active")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        let device;
        try {
          device = await resolveDevice(
            supabaseAdmin,
            request.headers.get("authorization"),
            "connect_iq",
          );
        } catch (error) {
          if (error instanceof DeviceResolutionError) {
            return json({ error: error.message }, 503);
          }
          throw error;
        }
        if (!device) {
          return new Response(
            JSON.stringify({ error: "Unknown or revoked Garmin device token." }),
            {
              status: 401,
              headers: {
                "content-type": "application/json",
                "cache-control": "no-store",
                "www-authenticate": 'Bearer realm="irondesk-connect-iq"',
              },
            },
          );
        }

        try {
          return json(await getActiveWorkoutSnapshot(supabaseAdmin, device.userId));
        } catch (error) {
          if (error instanceof ConnectIqApiError && error.status === 422) {
            return json(
              {
                schema_version: 1,
                code: "workout_not_watch_compatible",
                error: error.message,
              },
              error.status,
            );
          }
          console.error("[connect-iq] active workout read failed", {
            deviceId: device.deviceId,
            message: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "The active workout could not be loaded." }, 500);
        }
      },
    },
  },
});
