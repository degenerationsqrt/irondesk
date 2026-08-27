/**
 * Device self-revocation.
 *
 * The companion app calls this with its own device token to unlink itself. The
 * token identifies the row; nothing user-supplied selects it, so a device can
 * only ever revoke itself.
 */
import { createFileRoute } from "@tanstack/react-router";

import { resolveDevice, sha256Hex } from "@/lib/imports/device-sync.server";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * Best-effort throttle, per server instance only. This project has no shared or
 * durable rate-limit store, so the counter is in-process memory: it blunts a
 * hammering loop against one instance and must not be relied on as a global
 * guarantee. Security comes from the token check below, not from this map.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const hits = new Map<string, number[]>();

export function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((at) => now - at < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 500) for (const [k, v] of hits) if (v.every((at) => now - at >= WINDOW_MS)) hits.delete(k);
  return recent.length > MAX_PER_WINDOW;
}

export const Route = createFileRoute("/api/public/health-connect/unpair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const bearer = request.headers.get("authorization");
        const raw = bearer?.replace(/^Bearer\s+/i, "").trim() ?? "";
        if (raw.length >= 20 && rateLimited(await sha256Hex(raw))) {
          return json({ error: "Too many unlink attempts. Wait a minute and retry." }, 429);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const device = await resolveDevice(supabaseAdmin, bearer);
        if (!device) {
          return new Response(JSON.stringify({ error: "Unknown or already revoked device token." }), {
            status: 401,
            headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="irondesk-device"' },
          });
        }

        const { error } = await supabaseAdmin.from("device_links").delete().eq("id", device.deviceId);
        if (error) return json({ error: "The device could not be unlinked." }, 500);

        if (device.dataSourceId) {
          await supabaseAdmin.from("data_sources").update({ status: "idle" }).eq("id", device.dataSourceId);
        }

        return json({ unlinked: true, device_id: device.deviceId, label: device.label });
      },
    },
  },
});
