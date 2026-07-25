import assert from "node:assert/strict";
import test from "node:test";
import {
  CLOUD_DOCUMENT_MAX_BYTES,
  buildPersonalState,
  createCloudEnvelope,
  getOrCreateCloudDeviceId,
  mergePersonalStates,
  personalStateHash,
} from "../src/cloudSync.js";

test("cloud state keeps only supported IronDesk fields", () => {
  const state = buildPersonalState({
    sessions: [{ id: "one" }],
    maxes: { bench: 225 },
    secret: "not-synced",
  });
  assert.deepEqual(state.sessions, [{ id: "one" }]);
  assert.deepEqual(state.maxes, { bench: 225 });
  assert.equal("secret" in state, false);
  assert.deepEqual(state.cardioLog, []);
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
    },
    {
      mode: "gym",
      sessions: [
        { id: "cloud", date: "2026-07-25" },
        { id: "shared", date: "2026-07-23", title: "cloud copy" },
      ],
      bwLog: [{ date: "2026-07-22", weight: 222 }],
      cardioLog: [{ date: "2026-07-24", type: "ride", miles: 10 }],
    },
  );

  assert.equal(merged.mode, "gym");
  assert.deepEqual(merged.sessions.map((session) => session.id), ["cloud", "local", "shared"]);
  assert.equal(merged.sessions.find((session) => session.id === "shared").title, "local copy");
  assert.deepEqual(merged.bwLog.map((entry) => entry.date), ["2026-07-24", "2026-07-22"]);
  assert.equal(merged.cardioLog.length, 2);
});

test("cloud hashes are stable and change with personal data", () => {
  const first = personalStateHash({ sessions: [{ id: "one" }] });
  const repeated = personalStateHash({ sessions: [{ id: "one" }] });
  const changed = personalStateHash({ sessions: [{ id: "two" }] });
  assert.equal(first, repeated);
  assert.notEqual(first, changed);
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
