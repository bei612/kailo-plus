import assert from "node:assert/strict";
import test from "node:test";

import { buildThreadReferenceTags } from "./threading.ts";

// Buzz 779af8886caae1317b4de962082429867ab61503 threading.ts::buildThreadReferenceTags — the
// kind:20002 typing indicator's channel and thread references (Desktop typing broadcast).
test("typing references: channel only, direct reply, nested reply", () => {
  assert.deepEqual(buildThreadReferenceTags("c", null, null), [["h", "c"]]);
  assert.deepEqual(buildThreadReferenceTags("c", "p", null), [["h", "c"], ["e", "p", "", "reply"]]);
  assert.deepEqual(buildThreadReferenceTags("c", "p", "p"), [["h", "c"], ["e", "p", "", "reply"]]);
  assert.deepEqual(buildThreadReferenceTags("c", "p", "r"),
    [["h", "c"], ["e", "r", "", "root"], ["e", "p", "", "reply"]]);
});
