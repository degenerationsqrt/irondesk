/**
 * Offline tests for assigned-program delivery: the committed legacy-beta
 * content contract, and the pure gating / progress rules the UI relies on.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  currentSlot,
  isFreeStartable,
  programProgress,
  requiresAcknowledgment,
  slotState,
} from "../src/lib/irondesk/program-logic";
import type { ProgramEnrollment } from "../src/lib/irondesk/types";

const read = (name: string) =>
  JSON.parse(readFileSync(`content/workouts/legacy-beta/${name}`, "utf8")) as Record<string, unknown>;

const templates = read("workout-templates.json").templates as {
  sourceKey: string;
  exercises: unknown[];
}[];
const programIndex = read("program-index.json").programs as {
  programId: string;
  releaseGate: string;
  slots: { position: number; templateSourceKey: string }[];
}[];
const aliases = read("exercise-aliases.json");

describe("legacy-beta content contract", () => {
  it("holds 22 templates with unique source keys", () => {
    expect(templates).toHaveLength(22);
    expect(new Set(templates.map((t) => t.sourceKey)).size).toBe(22);
  });

  it("holds 151 movement entries in total", () => {
    expect(templates.reduce((sum, t) => sum + t.exercises.length, 0)).toBe(151);
  });

  it("holds 4 programs and 22 ordered slots", () => {
    expect(programIndex).toHaveLength(4);
    expect(programIndex.reduce((sum, p) => sum + p.slots.length, 0)).toBe(22);
    for (const program of programIndex) {
      const positions = program.slots.map((s) => s.position);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it("resolves every slot to a template", () => {
    const keys = new Set(templates.map((t) => t.sourceKey));
    const unresolved = programIndex
      .flatMap((p) => p.slots)
      .filter((s) => !keys.has(s.templateSourceKey));
    expect(unresolved).toEqual([]);
  });

  it("ships an alias map", () => {
    expect(aliases).toBeTruthy();
  });
});

describe("release gating", () => {
  it("keeps non-public programs behind an acknowledgment", () => {
    expect(requiresAcknowledgment({ releaseGate: "public", requiresAcknowledgment: false })).toBe(false);
    expect(requiresAcknowledgment({ releaseGate: "coach_review", requiresAcknowledgment: false })).toBe(true);
    expect(
      requiresAcknowledgment({ releaseGate: "blocked_pending_source_review", requiresAcknowledgment: false }),
    ).toBe(true);
  });

  it("blocks free starts for assignment-only templates", () => {
    expect(isFreeStartable({ libraryStartable: true, releaseGate: "public" })).toBe(true);
    expect(isFreeStartable({ libraryStartable: false, releaseGate: "public" })).toBe(false);
    expect(isFreeStartable({ libraryStartable: true, releaseGate: "coach_review" })).toBe(false);
    // Templates predating the gate columns default to startable.
    expect(isFreeStartable({})).toBe(true);
  });

  it("marks every legacy-beta program as gated", () => {
    for (const program of programIndex) {
      expect(program.releaseGate).not.toBe("public");
    }
  });
});

function enrollment(overrides: Partial<ProgramEnrollment> = {}): ProgramEnrollment {
  const slots = [1, 2, 3].map((position) => ({
    id: `slot-${position}`,
    position,
    templateId: `tpl-${position}`,
    label: `Day ${position}`,
    dayOfWeek: null,
    templateName: `Day ${position}`,
    templateFocus: null,
    movementCount: 5,
    estimatedMinutes: 45,
  }));
  return {
    id: "enrollment-1",
    status: "active",
    startedOn: "2026-01-01",
    currentPosition: 2,
    currentWeek: 1,
    currentCycle: 1,
    acknowledgedAt: "2026-01-01T00:00:00Z",
    acknowledgedGate: "coach_review",
    program: {
      id: "program-1",
      sourceKey: "legacy-foundation",
      name: "Legacy Foundation",
      description: null,
      isSystem: true,
      environment: "gym",
      level: "intermediate",
      daysPerWeek: 3,
      scheduleMode: "sequential",
      releaseGate: "coach_review",
      requiresAcknowledgment: true,
      tags: [],
      sortOrder: 1,
      warnings: [],
      slots,
    },
    schedule: [
      { id: "s1", sequenceIndex: 1, position: 1, status: "completed", scheduledFor: null, sessionId: "sess-1" },
      { id: "s2", sequenceIndex: 2, position: 2, status: "planned", scheduledFor: null, sessionId: null },
      { id: "s3", sequenceIndex: 3, position: 3, status: "planned", scheduledFor: null, sessionId: null },
    ],
    ...overrides,
  };
}

describe("schedule state", () => {
  it("labels completed, current and upcoming slots", () => {
    const e = enrollment();
    expect(slotState(1, e, 3)).toBe("completed");
    expect(slotState(2, e, 3)).toBe("current");
    expect(slotState(3, e, 3)).toBe("upcoming");
  });

  it("respects a skipped slot instead of calling it completed", () => {
    const e = enrollment();
    e.schedule[0]!.status = "skipped";
    expect(slotState(1, e, 3)).toBe("skipped");
  });

  it("shows an in-progress session on the current slot", () => {
    const e = enrollment();
    e.schedule[1]!.status = "in_progress";
    expect(slotState(2, e, 3)).toBe("in_progress");
  });

  it("computes cycle progress from completed plus skipped work", () => {
    const e = enrollment();
    expect(programProgress(e)).toEqual({ slotCount: 3, completed: 1, skipped: 0, percent: 33 });
    e.schedule[1]!.status = "skipped";
    expect(programProgress(e).percent).toBe(67);
  });

  it("scopes progress and state to the active cycle", () => {
    const e = enrollment({
      currentCycle: 2,
      currentPosition: 1,
      schedule: [
        { id: "s1", sequenceIndex: 1, position: 1, status: "completed", scheduledFor: null, sessionId: "a" },
        { id: "s2", sequenceIndex: 2, position: 2, status: "completed", scheduledFor: null, sessionId: "b" },
        { id: "s3", sequenceIndex: 3, position: 3, status: "completed", scheduledFor: null, sessionId: "c" },
        { id: "s4", sequenceIndex: 4, position: 1, status: "planned", scheduledFor: null, sessionId: null },
      ],
    });
    expect(programProgress(e)).toEqual({ slotCount: 3, completed: 0, skipped: 0, percent: 0 });
    expect(slotState(1, e, 3)).toBe("current");
  });

  it("resolves the current slot", () => {
    expect(currentSlot(enrollment())?.position).toBe(2);
    expect(currentSlot(enrollment({ currentPosition: 9 }))).toBeNull();
  });
});
