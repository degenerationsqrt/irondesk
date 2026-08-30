/** Replay-safe offline workout-event ingestion for a paired Garmin watch. */
import { createFileRoute } from "@tanstack/react-router";

import {
  ConnectIqApiError,
  applyConnectIqEvent,
  connectIqEventsRequestSchema,
  hasCompleteConnectIqAckCoverage,
  type ConnectIqRejectedAck,
} from "@/lib/connect-iq/server";
import { DeviceResolutionError, resolveDevice } from "@/lib/imports/device-sync.server";

const MAX_BODY_BYTES = 128 * 1024;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const Route = createFileRoute("/api/public/connect-iq/v1/workout-events")({
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

        const raw = await request.text();
        if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
          return json({ error: "Event batch too large." }, 413);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return json({ error: "Malformed JSON." }, 400);
        }
        const batch = connectIqEventsRequestSchema.safeParse(parsed);
        if (!batch.success) {
          return json(
            {
              error: "The event batch did not match schema version 1.",
              issues: batch.error.issues.slice(0, 10),
            },
            400,
          );
        }

        const results = [];
        const rejected: ConnectIqRejectedAck[] = [];
        for (const event of batch.data.events) {
          try {
            results.push(await applyConnectIqEvent(supabaseAdmin, device, event));
          } catch (error) {
            if (error instanceof ConnectIqApiError) {
              if (error.status >= 400 && error.status < 500) {
                rejected.push({
                  event_id: error.eventId ?? event.event_id,
                  status: error.status,
                  error: error.message,
                });
                continue;
              }
              return json(
                {
                  schema_version: 1,
                  error: error.message,
                  failed_event_id: error.eventId,
                  processed: results,
                  rejected,
                },
                error.status,
              );
            }
            console.error("[connect-iq] event batch failed", {
              deviceId: device.deviceId,
              eventId: event.event_id,
              message: error instanceof Error ? error.message : String(error),
            });
            return json(
              {
                schema_version: 1,
                error: "The watch event could not be applied.",
                failed_event_id: event.event_id,
                processed: results,
                rejected,
              },
              500,
            );
          }
        }

        if (!hasCompleteConnectIqAckCoverage(batch.data.events, results, rejected)) {
          console.error("[connect-iq] event batch acknowledgement coverage failed", {
            deviceId: device.deviceId,
            requested: batch.data.events.map((event) => event.event_id),
            processed: results.map((event) => event.event_id),
            rejected: rejected.map((event) => event.event_id),
          });
          return json(
            {
              schema_version: 1,
              error: "The event batch acknowledgement was incomplete.",
            },
            500,
          );
        }

        return json({ schema_version: 1, processed: results, rejected });
      },
    },
  },
});
