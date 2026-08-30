/** Self-revocation for a paired Garmin watch. */
import { createFileRoute } from "@tanstack/react-router";

import { DeviceResolutionError, resolveDevice } from "@/lib/imports/device-sync.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/connect-iq/v1/unpair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
        if (!device) return json({ error: "Unknown or already revoked Garmin device token." }, 401);

        const { error } = await supabaseAdmin
          .from("device_links")
          .delete()
          .eq("id", device.deviceId);
        if (error) return json({ error: "The Garmin watch could not be unlinked." }, 500);
        return json({ schema_version: 1, unlinked: true, device_id: device.deviceId });
      },
    },
  },
});
