import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { JSDOM } from "jsdom";
import { getLocale, setLocale } from "@client-kit/platform/i18n";

import { channelTooltipFooter } from "./ChannelDeepLink.tsx";

let dom;
let originals;
beforeEach(() => {
  originals = {
    window: globalThis.window,
    document: globalThis.document,
    Event: globalThis.Event,
  };
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://example.test",
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Event = dom.window.Event;
});
afterEach(() => {
  dom.window.close();
  Object.assign(globalThis, originals);
});

const channel = {
  id: "channel-id",
  name: "history",
  channelType: "forum",
  visibility: "private",
  description: "",
  topic: null,
  purpose: null,
  memberCount: 0,
  memberPubkeys: [],
  lastMessageAt: null,
  archivedAt: "2026-08-17T00:00:00Z",
  participants: [],
  participantPubkeys: [],
  isMember: true,
  ttlSeconds: null,
  ttlDeadline: null,
};

test("channelTooltipFooter adds archived status without changing existing metadata", () => {
  const previous = getLocale();
  setLocale("en");
  try {
    assert.equal(
      channelTooltipFooter(channel),
      "Private channel · Forum · Archived",
    );
    assert.equal(
      channelTooltipFooter({ ...channel, archivedAt: null }),
      "Private channel · Forum",
    );
  } finally {
    setLocale(previous);
  }
});

test("channelTooltipFooter uses just now for activity within a minute", () => {
  const previous = getLocale();
  setLocale("en");
  try {
    assert.equal(
      channelTooltipFooter({
        ...channel,
        archivedAt: null,
        lastMessageAt: new Date().toISOString(),
      }),
      "Private channel · Forum · Active just now",
    );
  } finally {
    setLocale(previous);
  }
});

test("channelTooltipFooter follows the shared Chinese locale and original activity metadata", () => {
  const previous = getLocale();
  setLocale("zh-CN");
  try {
    assert.equal(channelTooltipFooter(channel), "私有频道 · 论坛 · 已归档");
    assert.equal(
      channelTooltipFooter({
        ...channel,
        lastMessageAt: new Date().toISOString(),
      }),
      "私有频道 · 论坛 · 已归档 · 刚刚活跃",
    );
  } finally {
    setLocale(previous);
  }
});
