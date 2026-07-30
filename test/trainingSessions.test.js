import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTrackedSession,
  sessionTypeLabel,
  trackedSessionSummary,
} from "../src/trainingSessions.js";

test("guided Train modes create complete history sessions", () => {
  const session = buildTrackedSession({
    id: "core-1",
    date: "2026-07-27",
    title: "Core Circuit",
    sessionType: "core",
    startedAt: 1_000,
    completedAt: 601_000,
    entries: [{ name: "Plank", summary: "3 × 45 sec" }],
  });

  assert.equal(session.durationMin, 10);
  assert.equal(session.completedAt, 601_000);
  assert.equal(session.entries[0].ex, "Plank");
  assert.equal(session.entries[0].summary, "3 × 45 sec");
  assert.equal(sessionTypeLabel(session), "CORE");
  assert.equal(trackedSessionSummary(session), "10 min · 1 tracked item");
});
