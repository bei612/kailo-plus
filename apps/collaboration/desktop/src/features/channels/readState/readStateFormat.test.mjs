import assert from "node:assert/strict";
import test from "node:test";

import { maxReadAt, msgContextKey } from "./readStateFormat.ts";

const EVENT_ID = "a".repeat(64);

test("maxReadAt_usesNewestNonNullMarker", () => {
  assert.equal(maxReadAt(null, 10, 5, null, 30), 30);
});

test("maxReadAt_allNull_returnsNull", () => {
  assert.equal(maxReadAt(null, null), null);
});

test("msgContextKey_prefixesId_returnsMsgKey", () => {
  assert.equal(msgContextKey(EVENT_ID), `msg:${EVENT_ID}`);
});
