import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_DOCUMENT_MAX_BYTES,
  buildPersonalState,
  createCloudEnvelope,
  getOrCreateCloudDeviceId,
  mergePersonalStates,
  newerTrainingMode,
  recordTombstoneKey,
  personalStateHash,
} from "../src/cloudSync.js";

test("cloud state keeps only supported IronDesk fields", () => {
  const state = buildPersonalState({
    sessions: [{ id: "one" }],
    maxes: { bench: 225 },
    secret: "not-synced",
  });
  assert.deepEqual(state.sessions, [{ id: "one", entries: [], prs: [] }]);
  assert.deepEqual(state.maxes, { bench: 225 });
  assert.equal("secret" in state, false);
  assert.deepEqual(state.cardioLog, []);
  assert.deepEqual(state.healthLog, []);
});

test("cloud state migrates legacy profile settings before another device uses them", () => {
  const state = buildPersonalState({
    gender: "male",
    goal: "muscle",
    progress: { block: 2, week: 12, dayIndex: -1 },
  });
  assert.equal(state.gender, "men");
  assert.equal(state.goal, "vtaper");
  assert.deepEqual(state.progress, {
    block: 2,
    blockNum: 2,
    week: 6,
    dayIndex: 0,
    updatedAt: 0,
  });
});

test("first cloud connection merges histories without losing either device", () => {
  const merged = mergePersonalStates(
    {
      mode: "home",
      sessions: [
        { id: "local", date: "2026-07-24" },
        { id: "shared", date: "2026-07-23", title: "local copy" },
      ],
      bwLog: [{ date: "2026-07-24", weight: 220 }],
      cardioLog: [{ date: "2026-07-24", type: "run", miles: 3 }],
      healthLog: [{ id: "health-connect:2026-07-24", date: "2026-07-24", steps: 8000 }],
    },
    {
      mode: "gym",
      sessions: [
        { id: "cloud", date: "2026-07-25" },
        { id: "shared", date: "2026-07-23", title: "cloud copy" },
      ],
      bwLog: [{ date: "2026-07-22", weight: 222 }],
      cardioLog: [{ date: "2026-07-24", type: "ride", miles: 10 }],
      healthLog: [
        { id: "health-connect:2026-07-25", date: "2026-07-25", steps: 9000 },
        { id: "health-connect:2026-07-24", date: "2026-07-24", steps: 7000 },
      ],
    },
  );

  assert.equal(merged.mode, "gym");
  assert.deepEqual(merged.sessions.map((session) => session.id), ["cloud", "local", "shared"]);
  assert.equal(merged.sessions.find((session) => session.id === "shared").title, "local copy");
  assert.deepEqual(merged.bwLog.map((entry) => entry.date), ["2026-07-24", "2026-07-22"]);
  assert.equal(merged.cardioLog.length, 2);
  assert.deepEqual(merged.healthLog.map((entry) => entry.date), ["2026-07-25", "2026-07-24"]);
  assert.equal(merged.healthLog.find((entry) => entry.date === "2026-07-24").steps, 8000);
});

test("cloud hashes are stable and change with personal data", () => {
  const first = personalStateHash({ sessions: [{ id: "one" }] });
  const repeated = personalStateHash({ sessions: [{ id: "one" }] });
  const changed = personalStateHash({ sessions: [{ id: "two" }] });
  assert.equal(first, repeated);
  assert.notEqual(first, changed);
});

test("the newest Home or Gym selection wins cloud merges", () => {
  assert.deepEqual(
    newerTrainingMode(
      { mode: "gym", modeUpdatedAt: 300 },
      { mode: "home", modeUpdatedAt: 200 },
    ),
    { mode: "gym", modeUpdatedAt: 300 },
  );
  assert.deepEqual(
    newerTrainingMode(
      { mode: "home", modeUpdatedAt: 200 },
      { mode: "gym", modeUpdatedAt: 400 },
    ),
    { mode: "gym", modeUpdatedAt: 400 },
  );
});

test("legacy cloud mode keeps its existing merge behavior", () => {
  assert.deepEqual(
    newerTrainingMode({ mode: "home" }, { mode: "gym" }),
    { mode: "gym", modeUpdatedAt: 0 },
  );
});

test("cloud merge keeps the most recently changed workout day", () => {
  const merged = mergePersonalStates(
    {
      progress: {
        blockNum: 1,
        week: 2,
        dayIndex: 3,
        updatedAt: 200,
      },
    },
    {
      progress: {
        blockNum: 1,
        week: 2,
        dayIndex: 0,
        updatedAt: 100,
      },
    },
  );

  assert.equal(merged.progress.dayIndex, 3);
  assert.equal(merged.progress.updatedAt, 200);
});

test("a Health Connect clear marker prevents cloud summaries from returning", () => {
  const merged = mergePersonalStates(
    {
      healthLog: [],
      bwLog: [],
      healthLogClearedAt: Date.parse("2026-07-27T12:00:00.000Z"),
    },
    {
      healthLog: [{
        id: "health-connect:2026-07-27",
        date: "2026-07-27",
        source: "health-connect",
        importedAt: "2026-07-27T11:00:00.000Z",
      }],
      bwLog: [{
        id: "health-connect-weight:2026-07-27",
        date: "2026-07-27",
        source: "health-connect",
        importedAt: "2026-07-27T11:00:00.000Z",
      }],
    },
  );

  assert.deepEqual(merged.healthLog, []);
  assert.deepEqual(merged.bwLog, []);
  assert.equal(merged.healthLogClearedAt, Date.parse("2026-07-27T12:00:00.000Z"));
});

test("discarding an active workout prevents an older cloud copy from returning", () => {
  const clearedAt = Date.parse("2026-07-28T12:00:00.000Z");
  const merged = mergePersonalStates(
    {
      active: null,
      activeClearedAt: clearedAt,
    },
    {
      active: {
        id: "stale-workout",
        start: clearedAt - 60_000,
      },
    },
  );

  assert.equal(merged.active, null);
  assert.equal(merged.activeClearedAt, clearedAt);
});

test("a cloud discard also clears an older workout on another device", () => {
  const clearedAt = Date.parse("2026-07-28T12:00:00.000Z");
  const merged = mergePersonalStates(
    {
      active: {
        id: "stale-local-workout",
        start: clearedAt - 60_000,
      },
    },
    {
      active: null,
      activeClearedAt: clearedAt,
    },
  );

  assert.equal(merged.active, null);
  assert.equal(merged.activeClearedAt, clearedAt);
});

test("a workout started after the clear marker still syncs", () => {
  const clearedAt = Date.parse("2026-07-28T12:00:00.000Z");
  const active = {
    id: "new-workout",
    start: clearedAt + 60_000,
  };
  const merged = mergePersonalStates(
    {
      active,
      activeClearedAt: clearedAt,
    },
    {
      active: {
        id: "stale-workout",
        start: clearedAt - 60_000,
      },
      activeClearedAt: clearedAt,
    },
  );

  assert.deepEqual(merged.active, { ...active, entries: [] });
  assert.equal(merged.activeClearedAt, clearedAt);
});

test("deleted workout history cannot return from an older cloud copy", () => {
  const deleted = { id: "deleted-session", date: "2026-07-27" };
  const key = recordTombstoneKey("sessions", deleted);
  const merged = mergePersonalStates(
    {
      sessions: [],
      deletedRecords: { sessions: { [key]: 500 } },
    },
    { sessions: [deleted] },
  );

  assert.deepEqual(merged.sessions, []);
  assert.equal(merged.deletedRecords.sessions[key], 500);
});

test("deleted bodyweight and cardio records cannot return from cloud", () => {
  const weight = { id: "weight-old", date: "2026-07-27", weight: 220 };
  const cardio = { id: "cardio-old", date: "2026-07-27", minutes: 30 };
  const merged = mergePersonalStates(
    {
      bwLog: [],
      cardioLog: [],
      deletedRecords: {
        bwLog: { [recordTombstoneKey("bwLog", weight)]: 600 },
        cardioLog: { [recordTombstoneKey("cardioLog", cardio)]: 700 },
      },
    },
    { bwLog: [weight], cardioLog: [cardio] },
  );

  assert.deepEqual(merged.bwLog, []);
  assert.deepEqual(merged.cardioLog, []);
});

test("bodyweight merges keep one entry per date and prefer this device", () => {
  const merged = mergePersonalStates(
    {
      bwLog: [{ id: "local", date: "2026-07-27", weight: 219 }],
    },
    {
      bwLog: [{ id: "cloud", date: "2026-07-27", weight: 221 }],
    },
  );

  assert.equal(merged.bwLog.length, 1);
  assert.equal(merged.bwLog[0].id, "local");
  assert.equal(merged.bwLog[0].weight, 219);
});

test("cloud envelopes include device and reject oversized snapshots", () => {
  const envelope = createCloudEnvelope(
    { sessions: [{ id: "one" }] },
    { deviceId: "phone", updatedAt: 123 },
  );
  assert.equal(envelope.deviceId, "phone");
  assert.equal(envelope.updatedAt, 123);
  assert.equal(envelope.schemaVersion, 1);
  assert.throws(
    () => createCloudEnvelope({
      sessions: [{ id: "huge", title: "x".repeat(CLOUD_DOCUMENT_MAX_BYTES) }],
    }),
    /too large/,
  );
});

test("a stable cloud device id is created once per browser", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const cryptoSource = { randomUUID: () => "device-id" };
  assert.equal(getOrCreateCloudDeviceId(storage, cryptoSource), "device-id");
  assert.equal(getOrCreateCloudDeviceId(storage, { randomUUID: () => "other" }), "device-id");
});
