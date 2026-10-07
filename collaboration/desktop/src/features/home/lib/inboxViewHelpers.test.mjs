import assert from "node:assert/strict";
import test from "node:test";

import {
  getContextMessageDepth,
  hasInboxThreadContext,
  isInboxThreadContextEvent,
  matchesInboxAllView,
  matchesInboxFilter,
  toInboxContextMessage,
  toTimelineMessage,
} from "./inboxViewHelpers.ts";

test("Inbox preserves original reaction projection and pending send admission through both conversions", () => {
  const message = {
    id: "event", pubkey: "actor", author: "Alice", body: "Hello", createdAt: 1,
    depth: 0, time: "00:00", pending: true,
    reactions: [{ emoji: "😀", count: 1, reactedByCurrentUser: true,
      users: [{ pubkey: "actor", displayName: "Alice" }] }],
  };
  const context = toInboxContextMessage(message, {
    eventById: new Map(), fallbackAuthorPubkey: "actor", profiles: undefined, selectedItemId: "event",
  });
  assert.deepEqual(context.reactions, message.reactions);
  assert.equal(context.pending, true);
  const restored = toTimelineMessage(context);
  assert.deepEqual(restored.reactions, message.reactions);
  assert.equal(restored.pending, true);
});

test("hasInboxThreadContext finds replies in the grouped row or loaded context", () => {
  const root = { tags: [["h", "channel"]] };
  const reply = {
    tags: [
      ["h", "channel"],
      ["e", "root", "", "reply"],
    ],
  };

  assert.equal(
    hasInboxThreadContext({ item: root, groupItems: [root, reply] }),
    true,
  );
  assert.equal(
    hasInboxThreadContext({ item: root, groupItems: [root] }, [reply]),
    true,
  );
});

test("hasInboxThreadContext keeps standalone and broadcast activity unthreaded", () => {
  const root = { tags: [["h", "channel"]] };
  const broadcastReply = {
    tags: [
      ["h", "channel"],
      ["e", "root", "", "reply"],
      ["broadcast", "1"],
    ],
  };

  assert.equal(
    hasInboxThreadContext({ item: root, groupItems: [root] }),
    false,
  );
  assert.equal(
    hasInboxThreadContext({
      item: broadcastReply,
      groupItems: [broadcastReply],
    }),
    false,
  );
});

// --- matchesInboxFilter ---

test("Inbox All shows mentions and thread replies, not generic channel traffic", () => {
  assert.equal(
    matchesInboxAllView({
      categories: ["activity"],
      item: { pubkey: "human", tags: [["h", "channel"]] },
    }),
    false,
  );
  assert.equal(
    matchesInboxAllView({
      categories: ["mention"],
      item: { pubkey: "human", tags: [] },
    }),
    true,
  );
  assert.equal(
    matchesInboxAllView({
      categories: ["activity"],
      item: { pubkey: "human", tags: [["e", "root", "", "reply"]] },
    }),
    true,
  );
  assert.equal(matchesInboxFilter({ categories: [] }, "all"), false);
});

test("matchesInboxFilter matches when the category is present", () => {
  assert.equal(
    matchesInboxFilter({ categories: ["mentions", "activity"] }, "mentions"),
    true,
  );
});

test("matchesInboxFilter is false when the category is absent", () => {
  assert.equal(
    matchesInboxFilter({ categories: ["activity"] }, "mentions"),
    false,
  );
  assert.equal(matchesInboxFilter({ categories: [] }, "mentions"), false);
});

test("matchesInboxFilter matches thread rows by thread tags", () => {
  const replyItem = {
    id: "reply",
    kind: 9,
    pubkey: "author",
    content: "reply",
    createdAt: 2,
    channelId: "channel",
    channelName: "bugs",
    tags: [
      ["h", "channel"],
      ["e", "root", "", "root"],
      ["e", "parent", "", "reply"],
    ],
    category: "activity",
  };
  const rootItem = {
    id: "root",
    kind: 9,
    pubkey: "author",
    content: "root",
    createdAt: 1,
    channelId: "channel",
    channelName: "bugs",
    tags: [["h", "channel"]],
    category: "activity",
  };

  assert.equal(
    matchesInboxFilter(
      {
        categories: ["activity"],
        item: replyItem,
      },
      "thread",
    ),
    true,
  );

  assert.equal(
    matchesInboxFilter(
      {
        categories: ["mention", "activity"],
        item: { ...replyItem, category: "mention" },
      },
      "thread",
    ),
    true,
  );

  assert.equal(
    matchesInboxFilter(
      {
        categories: ["mention", "activity"],
        groupItems: [rootItem, replyItem],
        item: { ...rootItem, category: "mention" },
      },
      "thread",
    ),
    true,
  );

  assert.equal(
    matchesInboxFilter(
      {
        categories: ["activity"],
        item: rootItem,
      },
      "thread",
    ),
    false,
  );
});

// --- getReactionTargetId ---

// --- getContextMessageDepth ---

function event(id, parentId) {
  // A "reply" e-tag is how getThreadReference resolves a parent.
  const tags = parentId ? [["e", parentId, "", "reply"]] : [];
  return {
    id,
    pubkey: "x",
    created_at: 0,
    kind: 9,
    tags,
    content: "",
    sig: "",
  };
}

test("getContextMessageDepth is 0 for a root message", () => {
  const root = event("root", null);
  const map = new Map([[root.id, root]]);
  assert.equal(getContextMessageDepth(root, map), 0);
});

test("getContextMessageDepth counts ancestors present in the map", () => {
  const root = event("root", null);
  const mid = event("mid", "root");
  const leaf = event("leaf", "mid");
  const map = new Map([
    [root.id, root],
    [mid.id, mid],
    [leaf.id, leaf],
  ]);
  assert.equal(getContextMessageDepth(leaf, map), 2);
  assert.equal(getContextMessageDepth(mid, map), 1);
});

test("getContextMessageDepth stops when a parent is missing from the map", () => {
  // leaf -> mid (present) -> absent root. Depth counts only the present hop.
  const mid = event("mid", "absent-root");
  const leaf = event("leaf", "mid");
  const map = new Map([
    [mid.id, mid],
    [leaf.id, leaf],
  ]);
  assert.equal(getContextMessageDepth(leaf, map), 1);
});

test("getContextMessageDepth does not loop forever on a cycle", () => {
  // a -> b -> a. The `seen` set must terminate the walk.
  const a = event("a", "b");
  const b = event("b", "a");
  const map = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  // From a: hop to b (depth 1); b's parent is a, already seen -> stop.
  assert.equal(getContextMessageDepth(a, map), 1);
});

// --- isInboxThreadContextEvent ---

function channelEvent(id, tags = []) {
  return {
    id,
    pubkey: "x",
    created_at: 0,
    kind: 9,
    tags: [["h", "channel-a"], ...tags],
    content: "",
    sig: "",
  };
}

test("isInboxThreadContextEvent rejects stale events from a different thread", () => {
  const selection = {
    selectedChannelId: "channel-a",
    selectedEventId: "selected-reply",
    selectedParentId: "selected-parent",
    selectedThreadRootId: "selected-root",
  };

  assert.equal(
    isInboxThreadContextEvent(
      channelEvent("old-root", [["e", "old-root", "", "root"]]),
      selection,
    ),
    false,
  );
  assert.equal(
    isInboxThreadContextEvent(
      channelEvent("old-reply", [
        ["e", "old-root", "", "root"],
        ["e", "old-parent", "", "reply"],
      ]),
      selection,
    ),
    false,
  );
});

test("isInboxThreadContextEvent keeps selected thread root, parent, selected event, and descendants", () => {
  const selection = {
    selectedChannelId: "channel-a",
    selectedEventId: "selected-reply",
    selectedParentId: "selected-parent",
    selectedThreadRootId: "selected-root",
  };

  assert.equal(
    isInboxThreadContextEvent(channelEvent("selected-root"), selection),
    true,
  );
  assert.equal(
    isInboxThreadContextEvent(channelEvent("selected-parent"), selection),
    true,
  );
  assert.equal(
    isInboxThreadContextEvent(channelEvent("selected-reply"), selection),
    true,
  );
  assert.equal(
    isInboxThreadContextEvent(
      channelEvent("descendant", [
        ["e", "selected-root", "", "root"],
        ["e", "selected-reply", "", "reply"],
      ]),
      selection,
    ),
    true,
  );
});
