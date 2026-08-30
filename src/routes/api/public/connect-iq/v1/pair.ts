/** One-time pairing exchange for the Garmin Connect IQ companion. */
import { createFileRoute } from "@tanstack/react-router";

import {
  connectIqPairingRequestSchema,
  exchangeDevicePairing,
} from "@/lib/imports/device-sync.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/connect-iq/v1/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > 4_000) {
          return json({ error: "Request too large." }, 413);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return json({ error: "Malformed JSON." }, 400);
        }
        const input = connectIqPairingRequestSchema.safeParse(parsed);
        if (!input.success) return json({ error: "Invalid pairing request." }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await exchangeDevicePairing(supabaseAdmin, {
          code: input.data.code,
          deviceLabel: input.data.device_label,
          platform: "connect_iq",
          dataSourceType: null,
        });
        if (!result.ok && result.reason === "unavailable") {
          return json(
            {
              error:
                "That Garmin pairing code is not valid any more. Generate a new one in IronDesk.",
            },
            401,
          );
        }
        if (!result.ok) return json({ error: "The Garmin watch could not be linked." }, 500);

        return json({
          schema_version: 1,
          device_token: result.token,
          device_id: result.deviceId,
          label: result.label,
        });
      },
    },
  },
});
