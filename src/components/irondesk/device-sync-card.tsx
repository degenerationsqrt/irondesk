/**
 * Android companion pairing and linked-device management.
 *
 * Live mode only. The pairing code is shown exactly once — the database keeps
 * only its hash — and unlinking a device revokes its sync token immediately.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { useState } from "react";

import { SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import { importKeys, linkedDevicesQuery } from "@/lib/imports/queries";
import * as importRepo from "@/lib/imports/repo";

const fmt = (value: string) =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function DeviceSyncCard() {
  const queryClient = useQueryClient();
  const devices = useQuery(linkedDevicesQuery);
  const [code, setCode] = useState<importRepo.PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: importKeys.devices });

  const pair = useMutation({
    mutationFn: () => importRepo.createPairingCode(),
    onSuccess: (result) => {
      setError(null);
      setCode(result);
    },
    onError: (cause: unknown) => setError(cause instanceof Error ? cause.message : "The pairing code could not be created."),
  });

  const unlink = useMutation({
    mutationFn: (id: string) => importRepo.unlinkDevice(id),
    onSuccess: invalidate,
    onError: (cause: unknown) => setError(cause instanceof Error ? cause.message : "The device could not be unlinked."),
  });

  return (
    <SectionCard title="Android companion" eyebrow="Health Connect">
      <p className="text-sm text-muted-foreground">
        Health Connect has no web API, so the IronDesk companion app reads the records you approve on your phone and pushes
        them here. Pair the phone once, then use <span className="text-foreground">Sync Now</span> in the app. Sleep, resting
        heart rate and HRV fill your Recovery days; bodyweight fills Body Metrics. Anything you logged by hand is never
        overwritten.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => pair.mutate()} disabled={pair.isPending}>
          {pair.isPending ? "Generating…" : "Generate pairing code"}
        </Button>
        <Button size="sm" variant="ghost" onClick={invalidate}>
          Refresh
        </Button>
      </div>

      {code && (
        <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Enter this in the companion app</p>
          <p className="numeric mt-1 text-2xl font-bold tracking-[0.3em]">{code.code}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Single use · expires {fmt(code.expiresAt)}. It is shown once and cannot be recovered.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Linked devices</p>
        {!devices.data?.length ? (
          <p className="mt-1 text-sm text-muted-foreground">No device paired yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {devices.data.map((device) => (
              <li key={device.id} className="flex items-start justify-between gap-2 rounded-lg border border-border/70 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{device.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {device.platform} · paired {fmt(device.createdAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {device.lastSyncAt
                      ? `Last sync ${fmt(device.lastSyncAt)} · ${device.lastSyncSummary?.imported ?? 0} new · ${
                          device.lastSyncSummary?.duplicates ?? 0
                        } duplicates`
                      : "Never synced"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  disabled={unlink.isPending}
                  onClick={() => unlink.mutate(device.id)}
                >
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Smartphone className="size-3.5" /> Companion source lives in <code className="text-foreground">android-health-connect/</code>{" "}
        — build and sideload it yourself; no signed APK is distributed from here.
      </p>
    </SectionCard>
  );
}
