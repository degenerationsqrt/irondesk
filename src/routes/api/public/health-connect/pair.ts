/**
 * Device pairing exchange.
 *
 * The athlete generates a one-time code in IronDesk (Connections & Imports).
 * The companion app posts that code once and receives a long-lived device
 * token. The code is single-use, expires, and is only ever compared as a hash.
 * No Supabase credential ever reaches the device.
 */
import { createFileRoute } from "@tanstack/react-router";

import { exchangeDevicePairing, pairingRequestSchema } from "@/lib/imports/device-sync.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const Route = createFileRoute("/api/public/health-connect/pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > 4_000) return json({ error: "Request too large." }, 413);

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return json({ error: "Malformed JSON." }, 400);
        }
        const input = pairingRequestSchema.safeParse(parsed);
        if (!input.success) return json({ error: "Invalid pairing request." }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const result = await exchangeDevicePairing(supabaseAdmin, {
          code: input.data.code,
          deviceLabel: input.data.device_label,
          platform: "android",
          dataSourceType: "health_connect",
        });
        if (!result.ok && result.reason === "unavailable") {
          // Deliberately indistinguishable: unknown, wrong-purpose, used and
          // expired codes all look alike.
          return json(
            { error: "That pairing code is not valid any more. Generate a new one in IronDesk." },
            401,
          );
        }
        if (!result.ok) return json({ error: "The device could not be linked." }, 500);

        return json({
          device_token: result.token,
          device_id: result.deviceId,
          label: result.label,
        });
      },
    },
  },
});
