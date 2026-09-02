import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  BrowserWorkoutMutationStore,
  WorkoutMutationOutbox,
  type WorkoutMutationExecutor,
} from "../src/lib/irondesk/workout-mutation-outbox";
import { parseRpeDraft } from "../src/lib/irondesk/workout-values";

class ReloadableStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const source = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function between(value: string, start: string, end: string): string {
  const startIndex = value.indexOf(start);
  const endIndex = value.indexOf(end, startIndex + start.length);
  expect(startIndex, `missing source boundary: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing source boundary: ${end}`).toBeGreaterThan(startIndex);
  return value.slice(startIndex, endIndex);
}

describe("workout completion UI contract", () => {
  it("restores an offline Finish receipt and its immutable local summary after reload", async () => {
    const storage = new ReloadableStorage();
    const firstStore = new BrowserWorkoutMutationStore(storage);
    const execute = vi.fn<WorkoutMutationExecutor>().mockResolvedValue(undefined);
    const firstQueue = new WorkoutMutationOutbox(firstStore, execute, {
      createId: () => "finish-offline-1",
      isOnline: () => false,
      now: () => new Date("2026-09-01T16:48:55.000Z"),
    });
    const summary = {
      title: "Split Rev 2 · Shoulders + Traps",
      durationMin: 49,
      sets: 36,
      reps: 415,
      tonnageKg: 13_596,
      avgRpe: null,
    };

    await expect(
      firstQueue.enqueue(
        "athlete-1",
        "session-1",
        {
          kind: "session.finish",
          sessionId: "session-1",
          completedAt: "2026-09-01T16:48:55.000Z",
        },
        { terminalSummary: summary },
      ),
    ).resolves.toMatchObject({
      itemId: "finish-offline-1",
      status: "queued",
      outcome: "accepted_locally",
      durable: true,
      sessionId: "session-1",
    });
    expect(execute).not.toHaveBeenCalled();

    const reloadedQueue = new WorkoutMutationOutbox(
      new BrowserWorkoutMutationStore(storage),
      execute,
      { isOnline: () => false },
    );
    expect(reloadedQueue.snapshot("athlete-1")).toMatchObject({
      durable: true,
      pendingCount: 1,
      terminalReceipts: [
        {
          itemId: "finish-offline-1",
          sessionId: "session-1",
          kind: "session.finish",
          status: "queued",
          completionState: "completed_locally_sync_pending",
          requestedAt: "2026-09-01T16:48:55.000Z",
          summary,
        },
      ],
    });
  });

  it("locks into the pending summary as soon as durable Finish is accepted", () => {
    const workout = source("src/routes/workout.tsx");
    const finishFlow = between(workout, "const finish = async () =>", "const cancel = async () =>");
    const pendingSummary = between(
      workout,
      "function PendingWorkoutCompletion",
      "/** Launcher: IronDesk Original templates",
    );

    expect(finishFlow.indexOf("await commitAllSetDrafts()")).toBeLessThan(
      finishFlow.indexOf("terminalStageStarted.current = true"),
    );
    expect(finishFlow).toContain("terminalStageStarted.current = true");
    expect(finishFlow).toContain('kind: "session.finish"');
    expect(finishFlow).toContain("terminalSummary");
    expect(finishFlow).toMatch(
      /committed\.status === "queued"[\s\S]*committed\.durable === true[\s\S]*setSummary\(localSummary\)/,
    );
    const pendingBranch = workout.indexOf("if (pendingSessionTerminal && !summary)");
    const summaryBranch = workout.indexOf("if (summary) {");
    const editorBranch = workout.indexOf('<div className="space-y-4 pb-4">', summaryBranch);
    expect(pendingBranch).toBeGreaterThanOrEqual(0);
    expect(summaryBranch).toBeGreaterThan(pendingBranch);
    expect(editorBranch).toBeGreaterThan(summaryBranch);
    expect(pendingSummary).toContain("Completed");
    expect(pendingSummary).toContain("sync pending");
    expect(pendingSummary).toContain('MetricTile label="Sets"');
    expect(pendingSummary).toContain('MetricTile label="Reps"');
    expect(pendingSummary).toContain('MetricTile label="Avg RPE"');
    expect(pendingSummary).toContain(
      "Starting another workout is disabled until this terminal change is acknowledged or its",
    );
  });

  it("does not claim local completion when durable storage is unavailable", () => {
    const workout = source("src/routes/workout.tsx");
    const finishFlow = between(workout, "const finish = async () =>", "const cancel = async () =>");
    const storageFailure = between(
      workout,
      "if (finishStorageError && !summary)",
      "if (pendingSessionTerminal && !summary)",
    );

    expect(finishFlow).toMatch(
      /!queueIsDurable[\s\S]*navigator\.onLine === false[\s\S]*not yet safely completed/,
    );
    expect(finishFlow).toMatch(
      /committed\.durable === true[\s\S]*setSummary\(localSummary\)[\s\S]*could not persist completion in durable browser storage/,
    );
    expect(storageFailure).toContain("Workout completion needs retry");
    expect(storageFailure).toContain("Not yet safely completed");
    expect(storageFailure).toContain("Keep this page open until IronDesk confirms the save.");
    expect(storageFailure).toContain("Retry completion");
  });

  it("reports current-workout changes separately from older or legacy lanes", () => {
    const workout = source("src/routes/workout.tsx");

    expect(workout).toMatch(
      /const currentQueueItems = mutationQueue\.items\.filter\([\s\S]*item\.sessionId === initial\.id[\s\S]*item\.laneId === finishReceipt\.laneId/,
    );
    expect(workout).toContain("const currentQueueCount = currentQueueItems.length");
    expect(workout).toContain(
      "const otherQueueCount = Math.max(0, mutationQueue.items.length - currentQueueCount)",
    );
    expect(workout).toContain("for this workout");
    expect(workout).toContain("from other or legacy workouts");
    expect(workout).toContain("including after a reload");
  });

  it("can restore a pending terminal screen even when no active workout is returned", () => {
    const workout = source("src/routes/workout.tsx");
    const routeSelection = between(
      workout,
      "function WorkoutPage()",
      "function PendingWorkoutCompletion",
    );

    expect(routeSelection).toContain(
      "const pendingTerminal = newestPendingTerminalReceipt(mutationQueue.terminalReceipts)",
    );
    expect(routeSelection).toContain(
      "if (pendingTerminal && (!active || pendingTerminal.sessionId !== active.id))",
    );
    expect(routeSelection.indexOf("if (pendingTerminal")).toBeLessThan(
      routeSelection.indexOf("if (!active) return <WorkoutStart"),
    );
    expect(routeSelection).toContain("<PendingWorkoutCompletion");
  });
});

describe("workout recovery component contract", () => {
  it("requires every queued correction to be valid and accepts blank RPE but not 11.5", () => {
    const recovery = source("src/components/irondesk/workout-sync-recovery.tsx");

    expect(parseRpeDraft("")).toEqual({ ok: true, value: null });
    expect(parseRpeDraft("10")).toEqual({ ok: true, value: 10 });
    expect(parseRpeDraft("11.5")).toMatchObject({ ok: false, field: "rpe" });
    expect(recovery).toMatch(
      /const correctionsValid =[\s\S]*correctableIssues\.every\([\s\S]*parseCorrection\([\s\S]*\.ok/,
    );
    expect(recovery).toContain("disabled={busy || !correctionsValid}");
    expect(recovery).toContain("Save corrections and continue");
    expect(recovery).toContain("RPE may be blank or 1–10 in 0.5 increments.");
    expect(recovery).toContain("No other queued value will be discarded.");
  });

  it("keeps recovery non-destructive and demands confirmation for cancelled-session recovery", () => {
    const recovery = source("src/components/irondesk/workout-sync-recovery.tsx");
    const recoverAction = between(
      recovery,
      "const recoverCancelled = async () =>",
      "const keepCompleted = async () =>",
    );
    const keepCancelledAction = between(
      recovery,
      "const keepCancelled = () =>",
      "if (!issue) return null",
    );

    expect(recoverAction.indexOf("window.confirm")).toBeLessThan(
      recoverAction.indexOf("recoverCancelled: true"),
    );
    expect(recoverAction).toContain("original time saved on this device");
    expect(recovery).toContain("Recover and finish this workout");

    expect(keepCancelledAction.indexOf("downloadLaneBackup(issue, queue)")).toBeLessThan(
      keepCancelledAction.indexOf("window.confirm"),
    );
    expect(keepCancelledAction.indexOf("window.confirm")).toBeLessThan(
      keepCancelledAction.indexOf("queue.discardLane(issue.laneId)"),
    );
    expect(recovery).toContain("Export backup and keep cancelled");
    expect(recovery).toContain("Keep pending");
    expect(recovery).toContain("Review pending workout");
    expect(recovery).toContain("Keep completed and sync saved changes");
  });

  it("mounts recovery at the authenticated application shell instead of the workout route", () => {
    const rootRoute = source("src/routes/__root.tsx");
    const appShell = source("src/components/irondesk/app-shell.tsx");
    const recovery = source("src/components/irondesk/workout-sync-recovery.tsx");

    expect(rootRoute).toContain("WorkoutMutationQueueProvider");
    expect(appShell).toContain("<WorkoutSyncRecovery />");
    expect(recovery).toMatch(/repo\s*\.getWorkout\(sessionId\)/);
    expect(recovery).not.toContain("getActiveWorkout");
  });
});
