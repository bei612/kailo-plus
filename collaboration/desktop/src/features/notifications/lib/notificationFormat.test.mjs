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
    "Taylor已回复 · #ship-room",
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
    "回复 · #ship-room",
  );
  assert.deepEqual(
    formatMessageNotification({
      source: "thread_reply",
      senderName: null,
      channelName: null,
      content: "",
    }),
    { title: "回复", body: "新回复" },
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
    "Taylor提及了你 · #ship-room",
  );
  assert.equal(
    formatMessageNotification({
      source: "mention",
      senderName: null,
      channelName: "ship-room",
      content: "@wes look",
    }).title,
    "@提及 · #ship-room",
  );
});

test("notifications read the current device locale on every call and preserve English copy", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let locale = "en";
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: () => locale } } });
  try {
    assert.deepEqual(formatMessageNotification({ source: "mention", senderName: "Taylor", channelName: "ship-room", content: " " }), {
      title: "Taylor mentioned you in #ship-room", body: "Something in Buzz needs your attention.",
    });
    assert.deepEqual(formatMessageNotification({ source: "thread_reply", senderName: "Taylor", channelName: "ship-room", content: "done!" }), {
      title: "Taylor replied in #ship-room", body: "done!",
    });
    assert.deepEqual(formatMessageNotification({ source: "thread_reply", content: "" }), { title: "Reply", body: "New reply" });
    assert.equal(formatMessageNotification({ source: "mention", content: "" }).title, "@Mention");
    locale = "zh-CN";
    assert.deepEqual(formatMessageNotification({ source: "mention", senderName: "小明", channelName: "项目", content: " " }), {
      title: "小明提及了你 · #项目", body: "Buzz 中有事项需要你关注。",
    });
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else delete globalThis.window;
  }
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
