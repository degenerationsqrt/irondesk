import assert from "node:assert/strict";
import test from "node:test";
import { buildCrewInviteToken, parseCrewInviteToken } from "../src/crewInvites.js";

test("crew invite tokens carry the private group path and code", () => {
  const token = buildCrewInviteToken("Abc123GroupId", "a1b2c3");
  assert.equal(token, "Abc123GroupId.A1B2C3");
  assert.deepEqual(parseCrewInviteToken(token), {
    groupId: "Abc123GroupId",
    code: "A1B2C3",
    token: "Abc123GroupId.A1B2C3",
  });
});

test("existing full tokens remain stable and old bare codes request a fresh copy", () => {
  assert.equal(
    buildCrewInviteToken("Abc123GroupId", "Abc123GroupId.Z9Y8X7"),
    "Abc123GroupId.Z9Y8X7",
  );
  assert.equal(buildCrewInviteToken("Abc123GroupId", "broken.token"), "");
  assert.throws(() => parseCrewInviteToken("Z9Y8X7"), /full crew invite code/);
  assert.throws(() => parseCrewInviteToken("bad/id.Z9Y8X7"), /not valid/);
});
