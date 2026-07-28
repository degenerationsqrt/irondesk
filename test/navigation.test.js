import assert from "node:assert/strict";
import test from "node:test";
import {
  PRIMARY_NAVIGATION,
  defaultTabForGroup,
  navigationGroupForTab,
  normalizeTab,
} from "../src/navigation.js";

test("customer navigation has exactly five primary destinations", () => {
  assert.deepEqual(PRIMARY_NAVIGATION.map(group => group.label), [
    "Today",
    "Train",
    "Progress",
    "Connect",
    "More",
  ]);
});

test("existing workout screens map into the Train destination", () => {
  for (const tab of ["program", "core", "hiit", "mma", "pilates", "yoga"]) {
    assert.equal(navigationGroupForTab(tab).key, "train");
  }
});

test("connection screens map into the Connect destination", () => {
  assert.equal(navigationGroupForTab("connections").key, "connect");
  assert.equal(navigationGroupForTab("garmin").key, "connect");
  assert.equal(defaultTabForGroup("connect"), "connections");
});

test("retired roadmap links fall back to Settings", () => {
  assert.equal(normalizeTab("ideas"), "settings");
  assert.equal(navigationGroupForTab("ideas").key, "more");
});
