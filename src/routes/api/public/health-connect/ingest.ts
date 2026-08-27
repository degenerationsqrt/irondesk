/**
 * Device sync ingest.
 *
 * Authenticated by the device token issued at pairing — never by a Supabase
 * session, and never by anything the client can choose. The user id comes from
 * the token lookup, so a device can only ever write into its own account.
 */
import { createFileRoute } from "@tanstack/react-router";

import { SYNC_LIMITS, ingestForDevice, resolveDevice, syncPayloadSchema } from "@/lib/imports/device-sync.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const Route = createFileRoute("/api/public/health-connect/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const device = await resolveDevice(supabaseAdmin, request.headers.get("authorization"));
        if (!device) {
          return new Response(JSON.stringify({ error: "Unknown or revoked device token." }), {
            status: 401,
            headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="irondesk-device"' },
          });
        }

        const raw = await request.text();
        if (raw.length > SYNC_LIMITS.maxBodyBytes) return json({ error: "Batch too large. Sync in smaller ranges." }, 413);

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return json({ error: "Malformed JSON." }, 400);
        }

        const payload = syncPayloadSchema.safeParse(parsed);
        if (!payload.success) {
          return json({ error: "The sync payload did not match the expected format.", issues: payload.error.issues.slice(0, 10) }, 400);
        }
        if (payload.data.records.length + payload.data.activities.length === 0) {
          return json({ error: "Nothing to sync." }, 400);
        }

        try {
          const result = await ingestForDevice(supabaseAdmin, device, payload.data);
          return json(result);
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : "The sync failed." }, 500);
        }
      },
    },
  },
});
