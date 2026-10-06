import assert from "node:assert/strict";
import test from "node:test";

import {
  eligibleFeedNotificationItems,
  enrichFeedItemChannel,
  formatFeedNotification,
} from "./feed.ts";

const feedItem = (overrides = {}) => ({
  id: "event-id",
  kind: 9,
  pubkey: "author",
  content: "Please review",
  createdAt: 1,
  channelId: "channel-id",
  channelName: "",
  channelType: undefined,
  tags: [["h", "channel-id"]],
  category: "mention",
  ...overrides,
});

const channels = [{ id: "channel-id", name: "ship-room" }];

test("enriches a feed notification with its loaded channel name", () => {
  const item = enrichFeedItemChannel(feedItem(), channels);

  assert.equal(item.channelName, "ship-room");
  assert.equal(
    formatFeedNotification(item, "Taylor").title,
    "Taylor提及了你 · #ship-room",
  );
});

test("preserves feed-provided channel metadata", () => {
  const original = feedItem({ channelName: "backend-name" });
  const item = enrichFeedItemChannel(original, channels);

  assert.equal(item, original);
  assert.equal(formatFeedNotification(item).title, "@提及 · #backend-name");
});

test("falls back safely when the channel list has not loaded the channel", () => {
  const original = feedItem();
  const item = enrichFeedItemChannel(original, []);

  assert.equal(item, original);
  assert.equal(formatFeedNotification(item).title, "@提及");
});

test("eligible items are the feed's mentions in chronological order", () => {
  const later = feedItem({ id: "later", createdAt: 5 });
  const earlier = feedItem({ id: "earlier", createdAt: 2 });
  const items = eligibleFeedNotificationItems(
    { feed: { mentions: [later, earlier] } },
    channels,
  );

  assert.deepEqual(
    items.map((item) => item.id),
    ["earlier", "later"],
  );
  assert.equal(items[0].channelName, "ship-room");
});
