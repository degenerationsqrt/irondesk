import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  HealthConnect,
  healthSourceAppNames,
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
  writeEnabled,
  setWriteEnabled,
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

  useEffect(() => {
    if (syncStatus?.state === "synced" || syncStatus?.state === "permission") {
      refreshStatus();
    }
  }, [refreshStatus, syncStatus?.state]);

  const latest = useMemo(() => ({
    steps: latestHealthValue(healthLog, "steps")?.value,
    restingHeartRate: latestHealthValue(healthLog, "restingHeartRate")?.value,
    sleepMinutes: latestHealthValue(healthLog, "sleepMinutes")?.value,
    weightLb: latestHealthValue(healthLog, "weightLb")?.value,
    vo2Max: latestHealthValue(healthLog, "vo2Max")?.value,
  }), [healthLog]);
  const sourceApps = useMemo(() => healthSourceAppNames(healthLog), [healthLog]);

  const missingLabels = (deviceStatus?.missingPermissions || [])
    .filter(permission => permission !== "writeExercise")
    .map(permission => PERMISSION_LABELS[permission] || permission);
  const hasAnyReadPermission = Number(
    deviceStatus?.readGrantedCount ?? deviceStatus?.grantedCount,
  ) > 0;
  const writeGranted = Boolean(
    deviceStatus?.permissions?.writeExercise || deviceStatus?.writeExerciseGranted,
  );
  const connectionState = !nativeAndroid
    ? "web"
    : !deviceStatus?.available
      ? "unavailable"
      : hasAnyReadPermission
        ? "connected"
        : "permission";

  const connect = async () => {
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      await HealthConnect.requestPermissions({ permissions: ["healthRead"] });
      const next = await refreshStatus();
      if (Number(next?.readGrantedCount ?? next?.grantedCount) > 0) {
        setAutoSync(true);
        setPermissionMessage("Connected. Pulling your selected Health Connect records now…");
        await onSync();
        await refreshStatus();
        setPermissionMessage("");
      } else {
        setPermissionMessage(
          "No health categories were allowed. You can grant them in Health Connect settings.",
        );
      }
    } catch (error) {
      setPermissionMessage(error?.message || "Health Connect access was not granted.");
    } finally {
      setPermissionBusy(false);
    }
  };

  const updateWriteEnabled = async checked => {
    if (!checked) {
      setWriteEnabled(false);
      setPermissionMessage("Completed workouts will stay in IronDesk only.");
      return;
    }
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      await HealthConnect.requestPermissions({ permissions: ["healthWrite"] });
      const next = await refreshStatus();
      const allowed = Boolean(
        next?.permissions?.writeExercise || next?.writeExerciseGranted,
      );
      setWriteEnabled(allowed);
      setPermissionMessage(allowed
        ? "Enabled. New completed IronDesk workouts will be sent to Health Connect."
        : "Health Connect write access was not granted.");
    } catch (error) {
      setWriteEnabled(false);
      setPermissionMessage(error?.message || "Health Connect write access was not granted.");
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
          <p>Import Garmin or Samsung Health trends and send completed IronDesk workouts back.</p>
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
            <span><b>⌚</b> Garmin / Samsung</span>
            <i aria-hidden="true">→</i>
            <span><b>♥</b> Health Connect</span>
            <i aria-hidden="true">→</i>
            <span><b>ID</b> IronDesk</span>
          </div>

          {!hasAnyReadPermission ? (
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
              {missingLabels.length > 0 && (
                <div className="health-connect-permissions">
                  <div>
                    <strong>Connected with partial access</strong>
                    <span>
                      IronDesk will pull the categories you approved. Not shared: {missingLabels.join(", ")}.
                    </span>
                  </div>
                  <button
                    type="button"
                    className="health-connect-secondary"
                    onClick={connect}
                    disabled={permissionBusy}
                  >
                    {permissionBusy ? "Opening…" : "Review Access"}
                  </button>
                </div>
              )}
              <div className="health-connect-metrics">
                <div><span>Steps</span><strong>{metric(latest?.steps)}</strong></div>
                <div><span>Resting HR</span><strong>{metric(latest?.restingHeartRate, " bpm")}</strong></div>
                <div><span>Sleep</span><strong>{formatSleep(latest?.sleepMinutes)}</strong></div>
                <div><span>Weight</span><strong>{metric(latest?.weightLb, " lb")}</strong></div>
                <div><span>VO₂ Max</span><strong>{metric(latest?.vo2Max, " ml/kg/min")}</strong></div>
              </div>
              {sourceApps.length > 0 && (
                <div className="health-connect-sources">
                  <strong>Detected source{sourceApps.length === 1 ? "" : "s"}</strong>
                  <span>{sourceApps.join(" · ")}</span>
                </div>
              )}
              <div className="health-connect-actions">
                <button
                  type="button"
                  className="health-connect-primary"
                  onClick={sync}
                  disabled={syncStatus?.state === "syncing"}
                >
                  {syncStatus?.state === "syncing" ? "Refreshing…" : "Refresh Health Data"}
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
              <label className="health-connect-toggle">
                <input
                  type="checkbox"
                  checked={writeEnabled && writeGranted}
                  onChange={event => updateWriteEnabled(event.target.checked)}
                  disabled={permissionBusy}
                />
                <span>
                  <strong>Send completed IronDesk workouts</strong>
                  <small>
                    Writes one exercise session after you finish. Stable session IDs prevent duplicates.
                  </small>
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
          User-controlled. IronDesk reads daily summaries and can write only completed IronDesk
          exercise sessions—never Garmin imports, raw sensor samples, routes, or medical records.
        </p>
        {healthLog?.length > 0 && (
          <button type="button" onClick={onClear}>Remove imported summaries</button>
        )}
      </div>
    </section>
  );
}
