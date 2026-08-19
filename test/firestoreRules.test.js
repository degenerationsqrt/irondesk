import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rules = fs.readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");

test("crew group documents cannot be listed by arbitrary signed-in users", () => {
  assert.match(rules, /allow list:\s*if false;/);
  assert.doesNotMatch(rules, /match \/groups\/\{groupId\}[\s\S]*?allow read:\s*if signedIn\(\);/);
});

test("new crew memberships require ownership or the stored invitation code", () => {
  assert.match(rules, /request\.resource\.data\.inviteCode is string/);
  assert.match(rules, /request\.resource\.data\.inviteCode[\s\S]*?\.data\.code/);
});
