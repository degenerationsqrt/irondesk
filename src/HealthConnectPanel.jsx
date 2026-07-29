import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  HealthConnect,
  isNativeHealthConnect,
} from "./healthConnect.js";
import { latestHealthValue } from "./trendData.js";

const PERMISSION_LABELS = {
  steps: "steps",
  heartRate: "heart rate",
  restingHeartRate: "resting heart rate",
  sleep: "sleep",
  weight: "weight",
  bodyFat: "body fat",
  calories: "calories",
  exercise: "exercise",
  vo2Max: "VO₂ max",
};

function metric(value, suffix = "") {
  return value == null || !Number.isFinite(Number(value))
    ? "—"
    : `${Number(value).toLocaleString()}${suffix}`;
}

function formatSleep(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return "—";
  const hours = Math.floor(value / 60);
  const remaining = Math.round(value % 60);
  return `${hours}h ${remaining}m`;
}

export function HealthConnectPanel({
  healthLog,
  autoSync,
  setAutoSync,
  syncStatus,
  onSync,
  onClear,
}) {
  const [deviceStatus, setDeviceStatus] = useState(null);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const nativeAndroid = isNativeHealthConnect();

  const refreshStatus = useCallback(async () => {
    try {
      const next = await HealthConnect.getStatus();
      setDeviceStatus(next);
      return next;
    } catch (error) {
      setDeviceStatus({
        available: false,
        reason: "status-failed",
      });
      setPermissionMessage(error?.message || "Health Connect status could not be checked.");
      return null;
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  const latest = useMemo(() => ({
    steps: latestHealthValue(healthLog, "steps")?.value,
    restingHeartRate: latestHealthValue(healthLog, "restingHeartRate")?.value,
    sleepMinutes: latestHealthValue(healthLog, "sleepMinutes")?.value,
    weightLb: latestHealthValue(healthLog, "weightLb")?.value,
    vo2Max: latestHealthValue(healthLog, "vo2Max")?.value,
  }), [healthLog]);

  const missingLabels = (deviceStatus?.missingPermissions || [])
    .map(permission => PERMISSION_LABELS[permission] || permission);
  const connectionState = !nativeAndroid
    ? "web"
    : !deviceStatus?.available
      ? "unavailable"
      : Number(deviceStatus?.grantedCount) > 0
        ? "connected"
        : "permission";

  const connect = async () => {
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      await HealthConnect.requestPermissions();
      const next = await refreshStatus();
      setPermissionMessage(Number(next?.grantedCount) > 0
        ? "Connected. IronDesk can now read your selected daily health summaries."
        : "No health categories were allowed. You can grant them in Health Connect settings.");
    } catch (error) {
      setPermissionMessage(error?.message || "Health Connect access was not granted.");
    } finally {
      setPermissionBusy(false);
    }
  };

  const openSettings = async () => {
    setPermissionMessage("");
    try {
      await HealthConnect.openSettings();
    } catch (error) {
      setPermissionMessage(error?.message || "Health Connect settings could not be opened.");
    }
  };

  const sync = async () => {
    setPermissionMessage("");
    try {
      await onSync();
      await refreshStatus();
    } catch {
      // The parent status supplies the reader-facing error.
    }
  };

  return (
    <section className="health-connect-panel" aria-labelledby="health-connect-title">
      <div className="health-connect-hero">
        <div className="health-connect-mark" aria-hidden="true">
          <span>♥</span>
        </div>
        <div className="health-connect-title">
          <span className="health-connect-kicker">ANDROID HEALTH</span>
          <h3 id="health-connect-title">Health Connect</h3>
          <p>Garmin → Health Connect → IronDesk, with read-only daily summaries.</p>
        </div>
        <span className={`health-connect-state is-${connectionState}`}>
          {connectionState === "connected"
            ? "Connected"
            : connectionState === "permission"
              ? "Needs access"
              : connectionState === "unavailable"
                ? "Unavailable"
                : "Android app"}
        </span>
      </div>

      {connectionState === "web" ? (
        <div className="health-connect-callout">
          <strong>The website can display synced health data.</strong>
          <span>
            The first connection must be made from the IronDesk Android app on Android 14 or newer.
            Sign into Personal Cloud Sync there and on this website to keep the summaries aligned.
          </span>
        </div>
      ) : connectionState === "unavailable" ? (
        <div className="health-connect-callout is-warning" role="status">
          <strong>Android 14 or newer is required.</strong>
          <span>Your Garmin fēnix 6X still works; the phone version controls Health Connect access.</span>
        </div>
      ) : (
        <>
          <div className="health-connect-flow" aria-label="Health data flow">
            <span><b>G</b> Garmin Connect</span>
            <i aria-hidden="true">→</i>
            <span><b>♥</b> Health Connect</span>
            <i aria-hidden="true">→</i>
            <span><b>ID</b> IronDesk</span>
          </div>

          {!deviceStatus?.allGranted ? (
            <div className="health-connect-permissions">
              <div>
                <strong>Choose what IronDesk can read</strong>
                <span>
                  {missingLabels.length
                    ? `Waiting for ${missingLabels.join(", ")}.`
                    : "Steps, heart rate, sleep, weight, body fat, calories, exercise, and VO₂ max."}
                </span>
              </div>
              <button
                type="button"
                className="health-connect-primary"
                onClick={connect}
                disabled={permissionBusy}
              >
                {permissionBusy ? "Opening Health Connect…" : "Connect Health Connect"}
              </button>
            </div>
          ) : (
            <>
              <div className="health-connect-metrics">
                <div><span>Steps</span><strong>{metric(latest?.steps)}</strong></div>
                <div><span>Resting HR</span><strong>{metric(latest?.restingHeartRate, " bpm")}</strong></div>
                <div><span>Sleep</span><strong>{formatSleep(latest?.sleepMinutes)}</strong></div>
                <div><span>Weight</span><strong>{metric(latest?.weightLb, " lb")}</strong></div>
                <div><span>VO₂ Max</span><strong>{metric(latest?.vo2Max, " ml/kg/min")}</strong></div>
              </div>
              {missingLabels.length > 0 && (
                <div className="health-connect-callout">
                  <strong>Partial access is okay.</strong>
                  <span>Not currently shared: {missingLabels.join(", ")}. IronDesk will still sync the categories you approved.</span>
                </div>
              )}
              <div className="health-connect-actions">
                <button
                  type="button"
                  className="health-connect-primary"
                  onClick={sync}
                  disabled={syncStatus?.state === "syncing"}
                >
                  {syncStatus?.state === "syncing" ? "Syncing 7 days…" : "Sync Last 7 Days"}
                </button>
                <button type="button" className="health-connect-secondary" onClick={openSettings}>
                  Manage Access
                </button>
              </div>
              <label className="health-connect-toggle">
                <input
                  type="checkbox"
                  checked={autoSync}
                  onChange={event => setAutoSync(event.target.checked)}
                />
                <span>
                  <strong>Sync when the Android app opens</strong>
                  <small>Foreground only; no background-health permission is requested.</small>
                </span>
              </label>
            </>
          )}
        </>
      )}

      {(permissionMessage || syncStatus?.message) && (
        <div
          className={`health-connect-message is-${syncStatus?.state || "info"}`}
          role={syncStatus?.state === "error" ? "alert" : "status"}
        >
          <strong>{permissionMessage || syncStatus?.message}</strong>
          {!permissionMessage && syncStatus?.syncedAt && (
            <span>Last synced {new Date(syncStatus.syncedAt).toLocaleString()}</span>
          )}
        </div>
      )}

      <div className="health-connect-privacy">
        <span aria-hidden="true">⌁</span>
        <p>
          Read-only and user-controlled. IronDesk stores daily summaries, not raw sensor samples,
          routes, or medical records. Detailed Garmin activities continue through FIT/CSV import.
        </p>
        {healthLog?.length > 0 && (
          <button type="button" onClick={onClear}>Remove imported summaries</button>
        )}
      </div>
    </section>
  );
}
