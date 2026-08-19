import assert from "node:assert/strict";
import test from "node:test";
import { createBufferedStatePersistence } from "../src/statePersistence.js";

test("routine state writes are coalesced and flush the newest state", async () => {
  const writes = [];
  const timers = new Map();
  let nextTimer = 0;
  const persistence = createBufferedStatePersistence({
    write: async state => writes.push(state),
    setTimer: callback => {
      nextTimer += 1;
      timers.set(nextTimer, callback);
      return nextTimer;
    },
    clearTimer: timer => timers.delete(timer),
  });

  persistence.schedule({ version: 1 });
  persistence.schedule({ version: 2 });
  assert.equal(writes.length, 0);
  assert.equal(timers.size, 1);
  assert.equal(persistence.hasPending(), true);

  await persistence.flush();
  assert.deepEqual(writes, [{ version: 2 }]);
  assert.equal(timers.size, 0);
  assert.equal(persistence.hasPending(), false);
});

test("critical saves cancel buffered data and write immediately in order", async () => {
  const writes = [];
  const persistence = createBufferedStatePersistence({
    write: async state => writes.push(state),
    setTimer: () => 1,
    clearTimer: () => undefined,
  });

  persistence.schedule({ active: { id: "old" } });
  await persistence.saveNow({ active: null, activeClearedAt: 500 });
  await persistence.flush();
  assert.deepEqual(writes, [{ active: null, activeClearedAt: 500 }]);
});
