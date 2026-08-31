/**
 * Android Health Connect and Garmin watch pairing management.
 *
 * Live mode only. The pairing code is shown exactly once — the database keeps
 * only its hash — and unlinking a device revokes its sync token immediately.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ExternalLink, Smartphone, Watch } from "lucide-react";
import { useState } from "react";

import { SectionCard } from "@/components/irondesk/primitives";
import { Button } from "@/components/ui/button";
import { importKeys, linkedDevicesQuery } from "@/lib/imports/queries";
import * as importRepo from "@/lib/imports/repo";

const configuredBetaDownloadUrl = import.meta.env["VITE_HEALTH_CONNECT_DOWNLOAD_URL"]?.trim();
const betaDownloadUrl = configuredBetaDownloadUrl?.startsWith("https://")
  ? configuredBetaDownloadUrl
  : undefined;

const fmt = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function syncCounts(summary: importRepo.LinkedDevice["lastSyncSummary"]): string | null {
  if (!summary) return null;
  return [
    summary.total == null ? null : `${summary.total} read`,
    `${summary.imported ?? 0} new`,
    `${summary.duplicates ?? 0} duplicates`,
    summary.warnings ? `${summary.warnings} warnings` : null,
    summary.failed ? `${summary.failed} skipped` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function derivedCounts(summary: importRepo.LinkedDevice["lastSyncSummary"]): string | null {
  if (!summary) return null;
  const parts = [
    summary.recoveryDays
      ? `${summary.recoveryDays} Recovery day${summary.recoveryDays === 1 ? "" : "s"}`
      : null,
    summary.bodyweightDays
      ? `${summary.bodyweightDays} Body Metrics day${summary.bodyweightDays === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);
  return parts.length ? `Updated ${parts.join(" · ")}` : null;
}

function PairingCodePanel({
  code,
  instruction,
}: {
  code: importRepo.PairingCode | null;
  instruction: string;
}) {
  if (!code) return null;
  return (
    <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{instruction}</p>
      <p className="numeric mt-1 text-2xl font-bold tracking-[0.3em]">{code.code}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Single use · expires {fmt(code.expiresAt)}. It is shown once and cannot be recovered.
      </p>
    </div>
  );
}

function LinkedDeviceList({
  devices,
  empty,
  healthDetails,
  unlinking,
  onUnlink,
}: {
  devices: importRepo.LinkedDevice[];
  empty: string;
  healthDetails?: boolean;
  unlinking: boolean;
  onUnlink: (id: string) => void;
}) {
  if (!devices.length) return <p className="mt-1 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="mt-2 space-y-2">
      {devices.map((device) => {
        const counts = healthDetails ? syncCounts(device.lastSyncSummary) : null;
        const derived = healthDetails ? derivedCounts(device.lastSyncSummary) : null;
        return (
          <li
            key={device.id}
            className="flex items-start justify-between gap-2 rounded-lg border border-border/70 p-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold">{device.label}</p>
                <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-success">
                  Paired
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {device.platform === "connect_iq"
                  ? "Garmin Connect IQ"
                  : device.platform.replace(/^./, (letter) => letter.toUpperCase())}{" "}
                · paired {fmt(device.createdAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                {device.lastSyncAt
                  ? "Last successful sync " + fmt(device.lastSyncAt)
                  : "No successful sync yet"}
              </p>
              {counts && <p className="text-xs text-muted-foreground">{counts}</p>}
              {derived && <p className="text-xs text-muted-foreground">{derived}</p>}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={unlinking}
              onClick={() => onUnlink(device.id)}
            >
              Unlink
            </Button>
          </li>
        );
      })}
    </ul>
  );
}

export function DeviceSyncCard() {
  const queryClient = useQueryClient();
  const devices = useQuery(linkedDevicesQuery);
  const [androidCode, setAndroidCode] = useState<importRepo.PairingCode | null>(null);
  const [garminCode, setGarminCode] = useState<importRepo.PairingCode | null>(null);
  const [androidError, setAndroidError] = useState<string | null>(null);
  const [garminError, setGarminError] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: importKeys.devices });

  const pairAndroid = useMutation({
    mutationFn: () => importRepo.createPairingCode(),
    onSuccess: (result) => {
      setAndroidError(null);
      setAndroidCode(result);
    },
    onError: (cause: unknown) =>
      setAndroidError(
        cause instanceof Error ? cause.message : "The Android pairing code could not be created.",
      ),
  });

  const pairGarmin = useMutation({
    mutationFn: () => importRepo.createPairingCode("Garmin watch", "connect_iq"),
    onSuccess: (result) => {
      setGarminError(null);
      setGarminCode(result);
    },
    onError: (cause: unknown) =>
      setGarminError(
        cause instanceof Error ? cause.message : "The Garmin pairing code could not be created.",
      ),
  });

  const unlink = useMutation({
    mutationFn: (id: string) => importRepo.unlinkDevice(id),
    onSuccess: () => {
      setUnlinkError(null);
      invalidate();
    },
    onError: (cause: unknown) =>
      setUnlinkError(cause instanceof Error ? cause.message : "The device could not be unlinked."),
  });

  const garminDevices = (devices.data ?? []).filter((device) => device.platform === "connect_iq");
  const androidDevices = (devices.data ?? []).filter((device) => device.platform !== "connect_iq");

  return (
    <div className="space-y-4">
      <SectionCard title="Garmin watch companion" eyebrow="Connect IQ · Workout control">
        <p className="text-sm text-muted-foreground">
          Pair an IronDesk Connect IQ app to load the workout already active in your account, log
          sets in the weight unit selected on your watch, run rest timers and sync the finished
          session. The watch cannot enroll in a program, start gated content or bypass a workout
          acknowledgment.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => pairGarmin.mutate()} disabled={pairGarmin.isPending}>
            {pairGarmin.isPending ? "Generating…" : "Generate Garmin code"}
          </Button>
          <Button size="sm" variant="ghost" onClick={invalidate}>
            Refresh
          </Button>
        </div>
        <PairingCodePanel code={garminCode} instruction="Enter this on your Garmin watch" />
        {garminError && <p className="mt-2 text-xs text-destructive">{garminError}</p>}
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Linked Garmin watches
          </p>
          <LinkedDeviceList
            devices={garminDevices}
            empty="No Garmin watch paired yet."
            unlinking={unlink.isPending}
            onUnlink={(id) => unlink.mutate(id)}
          />
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Watch className="size-3.5" /> Pairing tokens are stored only as hashes and can be revoked
          here at any time.
        </p>
      </SectionCard>

      <SectionCard title="Health Connect companion" eyebrow="Private beta · Android">
        <p className="text-sm text-muted-foreground">
          Health Connect has no web API, so the IronDesk companion app reads the records you approve
          on your phone and pushes them here. Pair the phone once, then use{" "}
          <span className="text-foreground">Sync Now</span> in the app. Sleep, resting heart rate
          and HRV fill your Recovery days; bodyweight fills Body Metrics. Live device sync is the
          only Health Connect path on this page that populates those derived views; file uploads
          below are evidence archives only. Anything you logged by hand is never overwritten.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/health-connect">Setup and use</Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link to="/privacy">Privacy and data use</Link>
          </Button>
          {betaDownloadUrl && (
            <Button asChild size="sm">
              <a href={betaDownloadUrl} rel="noreferrer">
                Download private beta <ExternalLink className="size-4" />
              </a>
            </Button>
          )}
        </div>

        {!betaDownloadUrl && (
          <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
            No vetted installer is published yet. Approved testers receive a versioned build only
            after its signing identity and checksum are verified.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => pairAndroid.mutate()} disabled={pairAndroid.isPending}>
            {pairAndroid.isPending ? "Generating…" : "Generate Android code"}
          </Button>
          <Button size="sm" variant="ghost" onClick={invalidate}>
            Refresh
          </Button>
        </div>

        <PairingCodePanel
          code={androidCode}
          instruction="Enter this in the Android companion app"
        />

        {androidError && <p className="mt-2 text-xs text-destructive">{androidError}</p>}

        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Linked Android devices
          </p>
          <LinkedDeviceList
            devices={androidDevices}
            empty="No Android companion paired yet."
            healthDetails
            unlinking={unlink.isPending}
            onUnlink={(id) => unlink.mutate(id)}
          />
        </div>

        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Smartphone className="size-3.5" /> Android only. Apple Health requires a separate iOS
          HealthKit companion or a supported file export.
        </p>
      </SectionCard>

      {unlinkError && <p className="text-xs text-destructive">{unlinkError}</p>}
    </div>
  );
}
