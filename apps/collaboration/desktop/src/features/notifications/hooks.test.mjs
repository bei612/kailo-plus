import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHomeBadgeFeedItems,
  isHomeBadgeFeedItemUnread,
  resolveHomeBadgeFeedItemReadAt,
  shouldCountTowardHomeBadgeSubtotal,
} from "./lib/homeBadge.ts";

const ROOT_TAGS = [
  ["h", "stream-channel"],
  ["e", "root-event", "", "root"],
  ["e", "parent-event", "", "reply"],
];

const feedItem = (id, category = "activity") => ({
  id,
  kind: 9,
  pubkey: "author",
  content: id,
  createdAt: 1,
  channelId: null,
  channelName: "",
  tags: [],
  category,
});

const homeFeed = (feed) => ({
  feed: { mentions: [], ...feed },
  meta: { since: 0, total: 0, generatedAt: 0 },
});

test("home badge excludes thread activity already shown in a channel preview", () => {
  const items = buildHomeBadgeFeedItems(
    homeFeed({
      mentions: [feedItem("mention", "mention")],
    }),
    [
      {
        ...feedItem("thread-activity"),
        tags: ROOT_TAGS,
      },
    ],
  );

  assert.deepEqual(
    items.map((item) => item.id),
    ["mention"],
  );
});

test("home badge subtotal excludes channel-counted high-priority items", () => {
  const highPriorityChannelIds = new Set(["stream-channel"]);

  assert.equal(
    shouldCountTowardHomeBadgeSubtotal(
      { channelId: "stream-channel", tags: [] },
      highPriorityChannelIds,
    ),
    false,
  );
});

test("home badge subtotal still counts thread-only rows", () => {
  const highPriorityChannelIds = new Set(["stream-channel"]);

  assert.equal(
    shouldCountTowardHomeBadgeSubtotal(
      { channelId: "stream-channel", tags: ROOT_TAGS },
      highPriorityChannelIds,
    ),
    true,
  );
  assert.equal(
    shouldCountTowardHomeBadgeSubtotal(
      { channelId: "main-channel", tags: [] },
      highPriorityChannelIds,
    ),
    true,
  );
  assert.equal(
    shouldCountTowardHomeBadgeSubtotal(
      { channelId: null, tags: [] },
      highPriorityChannelIds,
    ),
    true,
  );
});

test("home badge thread reply read state includes per-message markers", () => {
  const item = {
    ...feedItem("reply-1"),
    channelId: "stream-channel",
    createdAt: 500,
    tags: ROOT_TAGS,
  };

  const readAt = resolveHomeBadgeFeedItemReadAt(item, {
    getChannelReadAt: () => 300,
    getThreadReadAt: () => null,
    getMessageReadAt: (messageId) => (messageId === "reply-1" ? 500 : null),
  });

  assert.equal(readAt, 500);
  assert.equal(
    isHomeBadgeFeedItemUnread(item, {
      getChannelReadAt: () => 300,
      getThreadReadAt: () => null,
      getMessageReadAt: () => 500,
      seenFeedIdSet: new Set(),
    }),
    false,
  );
});

test("home badge thread reply read state uses newest channel thread or message marker", () => {
  const item = {
    ...feedItem("reply-1"),
    channelId: "stream-channel",
    createdAt: 500,
    tags: ROOT_TAGS,
  };

  assert.equal(
    resolveHomeBadgeFeedItemReadAt(item, {
      getChannelReadAt: () => 300,
      getThreadReadAt: () => 550,
      getMessageReadAt: () => 400,
    }),
    550,
  );
});

test("home badge subtotal counts locally unread rows before channel exclusion", () => {
  const highPriorityChannelIds = new Set(["stream-channel"]);

  assert.equal(
    shouldCountTowardHomeBadgeSubtotal(
      { channelId: "stream-channel", tags: [] },
      highPriorityChannelIds,
      true,
    ),
    true,
  );
});
