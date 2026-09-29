import assert from "node:assert/strict";
import test from "node:test";

import { buildIndependentThreadPanel } from "./independentThreadPanel.ts";

const ROOT_ID = "6".repeat(64);
const REPLY_ID = "a".repeat(64);
const DELETION_ID = "d".repeat(64);
const AUTHOR = "f".repeat(64);
const CHANNEL = "chan-uuid";

function contentEvent(id, content, extraTags = []) {
  return {
    id,
    pubkey: AUTHOR,
    kind: 9,
    created_at: 1000,
    content,
    tags: [["h", CHANNEL], ...extraTags],
    sig: "s",
  };
}

function deletionEvent(id, targetId) {
  return {
    id,
    pubkey: AUTHOR,
    kind: 5,
    created_at: 3000,
    content: "",
    tags: [
      ["h", CHANNEL],
      ["e", targetId],
    ],
    sig: "s",
  };
}

function panel(channelEvents, replyEvents) {
  return buildIndependentThreadPanel(
    channelEvents,
    replyEvents,
    ROOT_ID,
    ROOT_ID,
    new Set(),
    AUTHOR,
    null,
  );
}

test("renders the head found in the channel window", () => {
  const result = panel([contentEvent(ROOT_ID, "two PRs")], []).threadHead;
  assert.equal(result?.body, "two PRs");
});

// A reply content event also `#e`-references the head as its parent. It must
// not be pulled in from the channel window — replies flow through
// `replyEvents` only.
test("does not treat a channel-window reply as part of the head", () => {
  const root = contentEvent(ROOT_ID, "two PRs");
  const reply = contentEvent(REPLY_ID, "a reply", [
    ["e", ROOT_ID, "", "reply"],
  ]);
  const result = panel([root, reply], []);
  assert.equal(result.threadHead?.body, "two PRs");
  assert.deepEqual(result.visibleReplies, []);
});

// A channel-window deletion of the head must hide it, matching the main timeline.
test("applies a head deletion carried in the channel window", () => {
  const root = contentEvent(ROOT_ID, "two PRs");
  const deletion = deletionEvent(DELETION_ID, ROOT_ID);
  assert.equal(panel([root, deletion], []).threadHead, null);
});
