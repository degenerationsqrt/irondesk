/**
 * Device pairing exchange.
 *
 * The athlete generates a one-time code in IronDesk (Connections & Imports).
 * The companion app posts that code once and receives a long-lived device
 * token. The code is single-use, expires, and is only ever compared as a hash.
 * No Supabase credential ever reaches the device.
 */
import { createFileRoute } from "@tanstack/react-router";

import { newDeviceToken, pairingRequestSchema, sha256Hex } from "@/lib/imports/device-sync.server";

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

        const code = input.data.code.trim().toUpperCase().replace(/[\s-]/g, "");
        const codeHash = await sha256Hex(code);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: pairing } = await supabaseAdmin
          .from("device_pairings")
          .select("id, user_id, expires_at, consumed_at")
          .eq("code_hash", codeHash)
          .maybeSingle();

        if (!pairing || pairing.consumed_at || Date.parse(pairing.expires_at) < Date.now()) {
          // Deliberately indistinguishable: unknown, used and expired all look alike.
          return json({ error: "That pairing code is not valid any more. Generate a new one in IronDesk." }, 401);
        }

        const label = input.data.device_label.trim() || "Android phone";

        const { data: source } = await supabaseAdmin
          .from("data_sources")
          .upsert(
            {
              user_id: pairing.user_id,
              source_type: "health_connect",
              label,
              status: "connected",
              retain_original_files: false,
              metadata: { platform: input.data.platform, paired_at: new Date().toISOString() } as unknown as never,
            },
            { onConflict: "user_id,source_type,label" },
          )
          .select("id")
          .single();

        const token = newDeviceToken();
        const { data: link, error: linkError } = await supabaseAdmin
          .from("device_links")
          .insert({
            user_id: pairing.user_id,
            data_source_id: source?.id ?? null,
            label,
            platform: input.data.platform,
            token_hash: await sha256Hex(token),
          })
          .select("id")
          .single();
        if (linkError || !link) return json({ error: "The device could not be linked." }, 500);

        await supabaseAdmin
          .from("device_pairings")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", pairing.id);

        return json({ device_token: token, device_id: link.id, label });
      },
    },
  },
});
