import assert from "node:assert/strict";
import test from "node:test";

import {
  depthGuideActionsEqual,
  numberArrayEqual,
  tagsEqual,
  reactionsEqual,
} from "./messageRowEquality.ts";

test("reaction memo observes count, own state, image and user identity changes", () => {
  const reactions = [{ emoji: ":wave:", emojiUrl: "media", count: 1, reactedByCurrentUser: true,
    users: [{ pubkey: "actor", displayName: "Alice", avatarUrl: "avatar" }] }];
  assert.equal(reactionsEqual(reactions, structuredClone(reactions)), true);
  for (const [field, value] of [["count", 2], ["reactedByCurrentUser", false], ["emojiUrl", "other"]]) {
    const changed = structuredClone(reactions);
    changed[0][field] = value;
    assert.equal(reactionsEqual(reactions, changed), false);
  }
  const changed = structuredClone(reactions);
  changed[0].users[0].pubkey = "other";
  assert.equal(reactionsEqual(reactions, changed), false);
});

// These helpers exist so MessageRow's memo holds when arrays are rebuilt
// with fresh identities but unchanged values (every ingest/refetch does
// this). Equal-by-value must return true; any real change must return false.

test("tagsEqual: fresh identity, same values → equal", () => {
  assert.equal(
    tagsEqual(
      [
        ["e", "abc"],
        ["h", "chan"],
      ],
      [
        ["e", "abc"],
        ["h", "chan"],
      ],
    ),
    true,
  );
});

test("tagsEqual: changed tag value → not equal", () => {
  assert.equal(tagsEqual([["e", "abc"]], [["e", "abd"]]), false);
  assert.equal(
    tagsEqual(
      [["e", "abc"]],
      [
        ["e", "abc"],
        ["p", "x"],
      ],
    ),
    false,
  );
  assert.equal(tagsEqual(undefined, [["e", "abc"]]), false);
  assert.equal(tagsEqual(undefined, undefined), true);
});

test("numberArrayEqual", () => {
  assert.equal(numberArrayEqual([1, 2], [1, 2]), true);
  assert.equal(numberArrayEqual([1, 2], [2, 1]), false);
  assert.equal(numberArrayEqual(undefined, undefined), true);
  assert.equal(numberArrayEqual([1], undefined), false);
});

test("depthGuideActionsEqual: same values (message by id) → equal", () => {
  const message = { id: "m1" };
  const other = { id: "m1" };
  assert.equal(
    depthGuideActionsEqual(
      [{ active: false, depth: 1, label: "Collapse replies", message }],
      [{ active: false, depth: 1, label: "Collapse replies", message: other }],
    ),
    true,
  );
  assert.equal(
    depthGuideActionsEqual(
      [{ active: false, depth: 1, label: "Collapse replies", message }],
      [{ active: true, depth: 1, label: "Collapse replies", message }],
    ),
    false,
  );
});
