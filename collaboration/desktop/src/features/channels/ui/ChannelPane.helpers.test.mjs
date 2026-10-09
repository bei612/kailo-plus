import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { useChannelRouteTarget } from "./useChannelRouteTarget.ts";
import { useChannelMessageEdit } from "@client-kit/platform/react/thread";
import { formatDmParticipantDisplayName } from "@client-kit/platform/react/conversations/dm-participant-display";
import { translate } from "@client-kit/platform/i18n";

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

test("Native's actual timeline prop consumes admitted people once and only opens a proven profile key", () => {
  const file=ts.createSourceFile("ChannelPane.tsx",readFileSync(new URL("./ChannelPane.tsx",import.meta.url),"utf8"),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let initializer, headerRead, consumers=0;
  function visit(node) {
    if(ts.isVariableDeclaration(node)&&node.name.getText(file)==="directMessageIntro")initializer=node.initializer;
    if(ts.isVariableDeclaration(node)&&node.initializer?.getText(file)==="useActiveChannelHeader(activeChannel, currentPubkey)")headerRead=node;
    if(ts.isJsxAttribute(node)&&node.name.text==="directMessageIntro"&&node.initializer?.getText(file)==="{directMessageIntro}")consumers++;
    ts.forEachChild(node,visit);
  }
  visit(file);
  assert.ok(initializer);
  assert.ok(headerRead,"the real Core Conversation/Principal header partition is consumed");
  assert.equal(consumers,1,"the original MessageTimeline receives the actual result");
  const js=ts.transpile(`const result=${initializer.getText(file)};`,{target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React});
  const peer="22".repeat(32);
  const Profile=()=>null,Avatar=()=>null;
  const project=new Function("React","activeChannel","activeDmHeaderParticipants","formatDmParticipantDisplayName","UserProfilePopover","UserAvatar","t",`${js};return result;`);
  const people=[{id:"peer-principal",displayName:"Alice",avatarUrl:"authorized-avatar",profilePubkey:peer}];
  const intro=project({...React,useMemo:fn=>fn()},{id:"dm",channelType:"dm"},people,formatDmParticipantDisplayName,Profile,Avatar,(key,variables)=>translate("en",key,variables));
  assert.equal(intro.displayName,"Alice");
  assert.equal(intro.participants.length,1);
  const rendered=intro.renderParticipant(intro.participants[0],"original-avatar-size");
  assert.equal(rendered.type,Profile);
  assert.equal(rendered.props.pubkey,peer);
  assert.equal(rendered.props.triggerAriaLabel,"Open profile for Alice");
  assert.equal(rendered.props.children.type,Avatar);
  assert.equal(rendered.props.children.props.avatarUrl,"authorized-avatar");
  assert.equal(rendered.props.children.props.className,"original-avatar-size");
  const noProfile=project({...React,useMemo:fn=>fn()},{id:"dm",channelType:"dm"},[{id:"peer-principal",displayName:"Alice",avatarUrl:null}],formatDmParticipantDisplayName,Profile,Avatar,()=>"");
  assert.equal(noProfile.renderParticipant(noProfile.participants[0],"original-avatar-size").type,Avatar);
  assert.equal(project({...React,useMemo:fn=>fn()},{id:"stream",channelType:"stream"},people,formatDmParticipantDisplayName,Profile,Avatar,()=>""),null);
  assert.equal(project({...React,useMemo:fn=>fn()},{id:"dm",channelType:"dm"},[],formatDmParticipantDisplayName,Profile,Avatar,()=>""),null);
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
