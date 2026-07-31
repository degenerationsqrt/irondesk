import React, { useMemo, useState } from "react";
import {
  createGarminActivityPack,
  createGarminWorkoutFit,
  garminActivityPackName,
  garminExportSummary,
  garminWorkoutFileName,
  isGarminActivityExportableSession,
  isGarminWorkoutExportableSession,
} from "./garminExport.js";

const GARMIN_CONNECT_IMPORT_URL = "https://connect.garmin.com/modern/import-data";
const GARMIN_MANUAL_UPLOAD_HELP = "https://support.garmin.com/en-US/?faq=Ht3ZP52Kju075uKvqTqu99";
const GARMIN_TRAINING_API_URL = "https://developer.garmin.com/gc-developer-program/overview/";

function sessionKey(session) {
  return String(session?.id || session?.sourceKey || `${session?.date}-${session?.dayId}`);
}

function sessionLabel(session) {
  return session?.dayId || session?.title || "IronDesk Workout";
}

function displayDate(value) {
  const date = new Date(`${value || ""}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "No date";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function downloadBytes(bytes, filename, type) {
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function GarminWordmark() {
  return (
    <div className="garmin-bridge-wordmark" aria-label="Garmin Bridge">
      <span className="garmin-bridge-caret" aria-hidden="true">▲</span>
      <span>GARMIN</span>
      <b>BRIDGE</b>
    </div>
  );
}

function TransferStepper({ steps }) {
  return (
    <ol className="garmin-transfer-stepper">
      {steps.map((step, index) => (
        <li key={step.title}>
          <span>{index + 1}</span>
          <div>
            <strong>{step.title}</strong>
            <small>{step.detail}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function GarminBridge({ sessions, note, onOpenImport }) {
  const [mode, setMode] = useState("connect");
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [watchSessionId, setWatchSessionId] = useState("");
  const [restSeconds, setRestSeconds] = useState(90);
  const [workoutName, setWorkoutName] = useState("");
  const [status, setStatus] = useState(null);

  const activitySessions = useMemo(
    () => (Array.isArray(sessions) ? sessions : []).filter(isGarminActivityExportableSession),
    [sessions],
  );
  const strengthSessions = useMemo(
    () => (Array.isArray(sessions) ? sessions : []).filter(isGarminWorkoutExportableSession),
    [sessions],
  );
  const importedCount = useMemo(
    () => (Array.isArray(sessions) ? sessions : []).filter((session) => session?.source === "garmin").length,
    [sessions],
  );
  const visibleSessions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return activitySessions.slice(0, 30);
    return activitySessions
      .filter((session) =>
        `${sessionLabel(session)} ${session?.date || ""}`.toLowerCase().includes(needle))
      .slice(0, 30);
  }, [activitySessions, query]);
  const selectedSessions = useMemo(
    () => activitySessions.filter((session) => selectedIds.has(sessionKey(session))),
    [activitySessions, selectedIds],
  );
  const watchSession = useMemo(
    () => strengthSessions.find((session) => sessionKey(session) === watchSessionId) || strengthSessions[0] || null,
    [strengthSessions, watchSessionId],
  );
  const totalSets = useMemo(
    () => activitySessions.reduce((total, session) => total + garminExportSummary(session).sets, 0),
    [activitySessions],
  );
  const watchSummary = watchSession ? garminExportSummary(watchSession) : null;

  const toggleSession = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setStatus(null);
  };

  const toggleVisible = () => {
    const visibleIds = visibleSessions.map(sessionKey);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((current) => {
      const next = new Set(current);
      visibleIds.forEach((id) => {
        if (allSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
    setStatus(null);
  };

  const downloadActivityPack = () => {
    try {
      const archive = createGarminActivityPack(selectedSessions);
      downloadBytes(archive, garminActivityPackName(), "application/zip");
      const message = `${selectedSessions.length} Garmin activity FIT file${selectedSessions.length === 1 ? "" : "s"} ready`;
      setStatus({ kind: "success", message });
      note?.(message);
    } catch (error) {
      setStatus({ kind: "error", message: error?.message || "FIT export failed." });
    }
  };

  const downloadWatchWorkout = () => {
    try {
      if (!watchSession) throw new Error("Log a completed IronDesk workout first.");
      const bytes = createGarminWorkoutFit(watchSession, {
        restSeconds,
        workoutName: workoutName.trim() || undefined,
      });
      downloadBytes(bytes, garminWorkoutFileName(watchSession), "application/vnd.ant.fit");
      const message = "fēnix 6X workout FIT ready";
      setStatus({ kind: "success", message });
      note?.(message);
    } catch (error) {
      setStatus({ kind: "error", message: error?.message || "Workout FIT export failed." });
    }
  };

  return (
    <div className="garmin-bridge-page">
      <section className="garmin-bridge-hero">
        <div className="garmin-bridge-orbit" aria-hidden="true">
          <span>6X</span>
        </div>
        <div className="garmin-bridge-hero-copy">
          <div className="garmin-bridge-eyebrow">IRONDESK DATA ROUTER</div>
          <GarminWordmark />
          <h2>Your training. Garmin-ready.</h2>
          <p>
            Turn completed IronDesk sessions into valid Garmin activity files, or convert a proven
            session into a guided strength workout for your fēnix 6X.
          </p>
          <div className="garmin-bridge-badges">
            <span><i /> FIT SDK VERIFIED</span>
            <span><i /> GENERATED LOCALLY</span>
            <span><i /> FĒNIX 6X PROFILE</span>
          </div>
        </div>
      </section>

      <section className="garmin-bridge-metrics" aria-label="Garmin export readiness">
        <div>
          <span>READY</span>
          <strong>{activitySessions.length}</strong>
          <small>Progress activities</small>
        </div>
        <div>
          <span>SETS</span>
          <strong>{totalSets}</strong>
          <small>encoded with reps &amp; weight</small>
        </div>
        <div>
          <span>RETURNING</span>
          <strong>{importedCount}</strong>
          <small>Garmin imports protected</small>
        </div>
      </section>

      <div className="garmin-bridge-mode-tabs" role="tablist" aria-label="Garmin transfer type">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "connect"}
          className={mode === "connect" ? "is-active" : ""}
          onClick={() => {
            setMode("connect");
            setStatus(null);
          }}
        >
          <span>01</span>
          <strong>Garmin Connect</strong>
          <small>Upload completed activities</small>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "watch"}
          className={mode === "watch" ? "is-active" : ""}
          onClick={() => {
            setMode("watch");
            setStatus(null);
          }}
        >
          <span>02</span>
          <strong>fēnix 6X</strong>
          <small>Install a guided workout</small>
        </button>
      </div>

      {mode === "connect" ? (
        <section className="garmin-bridge-workspace" role="tabpanel" aria-label="Garmin Connect activity export">
          <div className="garmin-bridge-section-heading">
            <div>
              <span>COMPLETED ACTIVITY EXPORT</span>
              <h3>Build a Garmin Connect FIT pack</h3>
              <p>Imported Garmin sessions are automatically excluded so you do not send them back twice.</p>
            </div>
            <div className="garmin-bridge-selection-count">
              <strong>{selectedSessions.length}</strong>
              <span>selected</span>
            </div>
          </div>

          <div className="garmin-session-toolbar">
            <label>
              <span className="sr-only">Search IronDesk sessions</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search workout or date"
              />
            </label>
            <button type="button" onClick={toggleVisible} disabled={!visibleSessions.length}>
              {visibleSessions.length > 0
              && visibleSessions.every((session) => selectedIds.has(sessionKey(session)))
                ? "Clear visible"
                : "Select visible"}
            </button>
          </div>

          <div className="garmin-session-list" aria-label="Exportable IronDesk sessions">
            {visibleSessions.length ? visibleSessions.map((session) => {
              const id = sessionKey(session);
              const summary = garminExportSummary(session);
              const checked = selectedIds.has(id);
              return (
                <label key={id} className={`garmin-session-row ${checked ? "is-selected" : ""}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleSession(id)}
                  />
                  <span className="garmin-session-check" aria-hidden="true">{checked ? "✓" : ""}</span>
                  <span className="garmin-session-date">
                    <b>{String(session.date || "").slice(8, 10) || "--"}</b>
                    <small>{displayDate(session.date).split(" ")[0]}</small>
                  </span>
                  <span className="garmin-session-main">
                    <strong>{sessionLabel(session)}</strong>
                    <small>{session.mode === "gym" ? "Gym" : "Home"} · {summary.durationMinutes} min</small>
                  </span>
                  {summary.sets > 0 ? (
                    <>
                      <span className="garmin-session-stats">
                        <b>{summary.sets}</b>
                        <small>sets</small>
                      </span>
                      <span className="garmin-session-stats">
                        <b>{summary.reps}</b>
                        <small>reps</small>
                      </span>
                    </>
                  ) : (
                    <span className="garmin-session-stats is-duration">
                      <b>{summary.durationMinutes}</b>
                      <small>minutes</small>
                    </span>
                  )}
                </label>
              );
            }) : (
              <div className="garmin-bridge-empty">
                <strong>{activitySessions.length ? "No sessions match your search" : "No completed IronDesk activities yet"}</strong>
                <span>Finished strength, VO₂, HIIT, core, yoga, Pilates, and MMA sessions appear here automatically.</span>
              </div>
            )}
          </div>

          <div className="garmin-bridge-action-panel">
            <div>
              <span>OUTPUT</span>
              <strong>{selectedSessions.length || 0} × Activity FIT + transfer guide</strong>
              <small>A ZIP keeps multiple Garmin-ready files together. Unzip before importing.</small>
            </div>
            <button
              type="button"
              className="garmin-bridge-primary-action"
              disabled={!selectedSessions.length}
              onClick={downloadActivityPack}
            >
              <span>DOWNLOAD FIT PACK</span>
              <b>→</b>
            </button>
          </div>

          <TransferStepper steps={[
            { title: "Download", detail: "IronDesk creates the FIT pack on this device." },
            { title: "Unzip", detail: "Open the ZIP and keep the individual .fit files." },
            { title: "Import", detail: "Garmin Connect web → cloud icon → Import Data." },
          ]} />

          <div className="garmin-bridge-links">
            <a href={GARMIN_CONNECT_IMPORT_URL} target="_blank" rel="noreferrer">
              Open Garmin Connect Import Data ↗
            </a>
            <a href={GARMIN_MANUAL_UPLOAD_HELP} target="_blank" rel="noreferrer">
              Garmin upload instructions ↗
            </a>
          </div>
        </section>
      ) : (
        <section className="garmin-bridge-workspace" role="tabpanel" aria-label="fēnix 6X workout export">
          <div className="garmin-bridge-section-heading">
            <div>
              <span>WATCH WORKOUT EXPORT</span>
              <h3>Turn a completed session into a guided workout</h3>
              <p>Reps, weights, exercise categories, and rest periods are encoded into a FIT workout.</p>
            </div>
            <div className="garmin-bridge-device-chip">FĒNIX 6X</div>
          </div>

          {watchSession ? (
            <>
              <div className="garmin-watch-builder">
                <label>
                  <span>WORKOUT TEMPLATE</span>
                  <select
                    value={sessionKey(watchSession)}
                    onChange={(event) => {
                      setWatchSessionId(event.target.value);
                      setWorkoutName("");
                      setStatus(null);
                    }}
                  >
                    {strengthSessions.slice(0, 30).map((session) => (
                      <option key={sessionKey(session)} value={sessionKey(session)}>
                        {session.date} · {sessionLabel(session)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>WATCH NAME</span>
                  <input
                    type="text"
                    maxLength={31}
                    value={workoutName}
                    onChange={(event) => setWorkoutName(event.target.value)}
                    placeholder={`ID ${watchSession.date} ${sessionLabel(watchSession)}`.slice(0, 31)}
                  />
                </label>
                <label>
                  <span>REST BETWEEN SETS</span>
                  <select value={restSeconds} onChange={(event) => setRestSeconds(Number(event.target.value))}>
                    {[45, 60, 75, 90, 120, 180].map((seconds) => (
                      <option key={seconds} value={seconds}>{seconds} seconds</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="garmin-watch-preview">
                <div className="garmin-watch-face" aria-hidden="true">
                  <div>
                    <span>STRENGTH</span>
                    <strong>{sessionLabel(watchSession).slice(0, 15)}</strong>
                    <small>{watchSummary.sets} SETS · {watchSummary.reps} REPS</small>
                  </div>
                </div>
                <div className="garmin-watch-summary">
                  <span>FIT WORKOUT MANIFEST</span>
                  <h4>{sessionLabel(watchSession)}</h4>
                  <ul>
                    <li><b>{watchSummary.sets}</b> active strength steps</li>
                    <li><b>{restSeconds}s</b> timed rest steps</li>
                    <li><b>lb</b> display weights with FIT kilogram storage</li>
                    <li><b>≤50</b> total watch steps for compatibility</li>
                  </ul>
                  <button type="button" className="garmin-bridge-primary-action" onClick={downloadWatchWorkout}>
                    <span>DOWNLOAD WATCH WORKOUT</span>
                    <b>→</b>
                  </button>
                </div>
              </div>

              <TransferStepper steps={[
                { title: "Connect", detail: "Plug the fēnix 6X into a Windows computer with its data cable." },
                { title: "Copy", detail: "Place the .fit file in Garmin/NewFiles on the watch." },
                { title: "Start", detail: "Safely eject, then open Strength → Training → Workouts." },
              ]} />
            </>
          ) : (
            <div className="garmin-bridge-empty">
              <strong>No workout template is ready yet</strong>
              <span>Finish an IronDesk strength session, then return here to build the watch workout.</span>
            </div>
          )}
        </section>
      )}

      {status && (
        <div className={`garmin-bridge-status is-${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
          <span aria-hidden="true">{status.kind === "success" ? "✓" : "!"}</span>
          <strong>{status.message}</strong>
        </div>
      )}

      <section className="garmin-bridge-reverse">
        <div>
          <span className="garmin-bridge-reverse-icon" aria-hidden="true">⇄</span>
          <div>
            <strong>Need Garmin → IronDesk?</strong>
            <small>Use the existing FIT / Activities CSV importer in Settings.</small>
          </div>
        </div>
        <button type="button" onClick={onOpenImport}>Open Importer →</button>
      </section>

      <section className="garmin-api-note">
        <div>
          <span>DIRECT CLOUD SYNC</span>
          <strong>Designed for the next phase</strong>
          <p>
            IronDesk never asks for your Garmin password. Automatic account-to-account delivery
            requires Garmin&apos;s approved Training API; the FIT workflows above work now without
            sharing credentials.
          </p>
        </div>
        <a href={GARMIN_TRAINING_API_URL} target="_blank" rel="noreferrer">
          Garmin developer requirements ↗
        </a>
      </section>
    </div>
  );
}
