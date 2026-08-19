import assert from "node:assert/strict";
import test from "node:test";
import { createInviteCode, createRecordId } from "../src/secureIds.js";

test("record IDs prefer randomUUID and retain an offline uniqueness fallback", () => {
  assert.equal(createRecordId({ randomUUID: () => "secure-id" }), "secure-id");
  const first = createRecordId({}, () => 123456);
  const second = createRecordId({}, () => 123456);
  assert.match(first, /^local-/);
  assert.notEqual(first, second);
});

test("record and crew IDs use secure random bytes when UUID is unavailable", () => {
  let next = 0;
  const cryptoSource = {
    getRandomValues(bytes) {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = next % 256;
        next += 1;
      }
      return bytes;
    },
  };

  assert.match(createRecordId(cryptoSource), /^[a-z0-9]{20}$/);
  assert.match(createInviteCode(cryptoSource), /^[A-HJ-NP-Z2-9]{10}$/);
});

test("crew invite creation fails closed without Web Crypto", () => {
  assert.throws(() => createInviteCode({}), /current browser|installed IronDesk app/);
});
