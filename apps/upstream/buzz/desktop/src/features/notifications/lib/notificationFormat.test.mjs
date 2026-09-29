import assert from "node:assert/strict";
import test from "node:test";

import { formatMessageNotification } from "./notificationFormat.ts";
import { senderNameFromSummary } from "./senderName.ts";

test("thread reply leads with the sender when resolved", () => {
  assert.equal(
    formatMessageNotification({
      source: "thread_reply",
      senderName: "Taylor",
      channelName: "ship-room",
      content: "done!",
    }).title,
    "Taylor replied in #ship-room",
  );
});

test("thread reply preserves legacy copy when the sender is unknown", () => {
  assert.equal(
    formatMessageNotification({
      source: "thread_reply",
      senderName: null,
      channelName: "ship-room",
      content: "done!",
    }).title,
    "Reply in #ship-room",
  );
  assert.deepEqual(
    formatMessageNotification({
      source: "thread_reply",
      senderName: null,
      channelName: null,
      content: "",
    }),
    { title: "Reply", body: "New reply" },
  );
});

test("mention titles match the home-feed conventions", () => {
  assert.equal(
    formatMessageNotification({
      source: "mention",
      senderName: "Taylor",
      channelName: "ship-room",
      content: "@wes look",
    }).title,
    "Taylor mentioned you in #ship-room",
  );
  assert.equal(
    formatMessageNotification({
      source: "mention",
      senderName: null,
      channelName: "ship-room",
      content: "@wes look",
    }).title,
    "@Mention in #ship-room",
  );
});

test("senderNameFromSummary prefers displayName, then NIP-05, never a pubkey", () => {
  assert.equal(
    senderNameFromSummary({
      displayName: "Taylor",
      avatarUrl: null,
      nip05Handle: "taylor@buzz.example",
      ownerPubkey: null,
    }),
    "Taylor",
  );
  assert.equal(
    senderNameFromSummary({
      displayName: "  ",
      avatarUrl: null,
      nip05Handle: "taylor@buzz.example",
      ownerPubkey: null,
    }),
    "taylor@buzz.example",
  );
  assert.equal(
    senderNameFromSummary({
      displayName: null,
      avatarUrl: null,
      nip05Handle: null,
      ownerPubkey: null,
    }),
    null,
  );
  assert.equal(senderNameFromSummary(null), null);
  assert.equal(senderNameFromSummary(undefined), null);
});
