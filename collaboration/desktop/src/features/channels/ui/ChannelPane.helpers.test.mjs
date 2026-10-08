import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { useChannelRouteTarget } from "./useChannelRouteTarget.ts";
import { useChannelMessageEdit } from "@client-kit/platform/react/thread";

import {
  getChannelIntroDescription,
  getChannelIntroKind,
} from "./ChannelPane.helpers.ts";

function channel(overrides = {}) {
  return {
    ttlDeadline: null,
    ttlSeconds: null,
    visibility: "open",
    ...overrides,
  };
}

test("channel intro shares description-over-purpose derivation with the header", () => {
  assert.equal(
    getChannelIntroDescription(
      channel({
        description: "Description paragraphs.\n\nKeep this structure.",
        purpose: "Legacy purpose",
        topic: "",
      }),
    ),
    "Description paragraphs.\n\nKeep this structure.",
  );
});

test("getChannelIntroKind labels regular, private and ephemeral streams", () => {
  assert.equal(getChannelIntroKind(channel()), "regular channel");
  assert.equal(
    getChannelIntroKind(channel({ visibility: "private" })),
    "private channel",
  );
  assert.equal(
    getChannelIntroKind(channel({ ttlSeconds: 3600 })),
    "ephemeral channel",
  );
});

test("native route keeps a real thread editor until cancellation, then opens the pending original target", async () => {
  await withRouteHost("stream", async (host, effects) => {
    await press(host, "Edit reply");
    await press(host, "Open root");
    assert.equal(host.querySelector("output").textContent, "reply");
    assert.deepEqual(effects, []);
    await press(host, "Cancel edit");
    assert.equal(host.querySelector("output").textContent, "none");
    assert.deepEqual(effects, [
      ["profile", null],
      ["head", "root"],
      ["reply", "root"],
      ["scroll", null],
      ["expanded", []],
    ]);
  });
});

test("native forum links refuse the stream-thread route even when the target is loaded", async () => {
  await withRouteHost("forum", async (host, effects) => {
    await press(host, "Open root");
    assert.deepEqual(effects, []);
  });
});

async function press(host, label) {
  const button = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  );
  assert.ok(button);
  await React.act(async () => button.click());
}

async function withRouteHost(channelType, check) {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const previous = Object.getOwnPropertyDescriptors(globalThis);
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const host = dom.window.document.createElement("div");
  dom.window.document.body.append(host);
  const root = createRoot(host),
    effects = [];
  const messages = [
    {
      id: "root",
      kind: 9,
      createdAt: 1,
      author: "Author",
      body: "Root",
      depth: 0,
      time: "",
      tags: [],
    },
    {
      id: "reply",
      kind: 9,
      createdAt: 2,
      author: "Author",
      body: "Reply",
      depth: 0,
      time: "",
      parentId: "root",
      rootId: "root",
      tags: [["e", "root", "", "reply"]],
    },
  ];
  const setters = {
    setProfilePanelPubkey: (value) => effects.push(["profile", value]),
    setOpenThreadHeadId: (value) => effects.push(["head", value]),
    setThreadReplyTargetId: (value) => effects.push(["reply", value]),
    setThreadScrollTargetId: (value) => effects.push(["scroll", value]),
    setExpandedThreadReplyIds: (value) => effects.push(["expanded", [...value]]),
  };
  const activeChannel = { id: "channel", channelType };
  function Host() {
    const edit = useChannelMessageEdit("principal/relay/channel");
    const [targetMessageId, setTarget] = React.useState(null);
    useChannelRouteTarget({
      activeChannel,
      activeChannelId: activeChannel.id,
      targetMessageId,
      timelineMessages: messages,
      clearEditTarget: edit.handleCancelEdit,
      requireThreadEditResolution: edit.requireThreadEditResolution,
      ...setters,
    });
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("button", { onClick: () => edit.handleEdit(messages[1]) }, "Edit reply"),
      React.createElement("button", { onClick: () => setTarget("root") }, "Open root"),
      React.createElement("button", { onClick: edit.handleCancelEdit }, "Cancel edit"),
      React.createElement("output", null, edit.editTarget?.id ?? "none"),
    );
  }
  try {
    await React.act(async () => root.render(React.createElement(Host)));
    await check(host, effects);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const name of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"]) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]);
      else delete globalThis[name];
    }
  }
}
