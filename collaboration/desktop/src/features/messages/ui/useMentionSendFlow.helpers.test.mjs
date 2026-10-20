import assert from "node:assert/strict";
import test from "node:test";
import {JSDOM} from "jsdom";

import {
  formatMessageSendError,
  getErrorMessage,
  uniqueNormalizedPubkeys,
} from "./useMentionSendFlow.helpers.ts";

test("formatMessageSendError preserves the publication failure", () => {
  assert.equal(
    formatMessageSendError(new Error("relay rejected voice note")),
    "Message failed to send: relay rejected voice note",
  );
});

test("Native real send flow verifies addressed Agent recipients before publishing and restores rejected drafts", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {url:"http://localhost"});
  Object.assign(globalThis, {window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,
    Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true});
  const {act, cleanup, renderHook} = await import("@testing-library/react");
  const {useMentionSendFlow} = await import("./useMentionSendFlow.ts");
  for (const admitted of [true,false]) {
    const human = "a".repeat(64), agent = "b".repeat(64);
    const sent = [], order = [], persisted = [];
    const contentRef = {current:"@Human original"};
    const options = {channelId:"relay-channel",effectiveDraftKey:"thread-root",getComposerRevision:()=>0,
      runComposerUpdate:update=>update(),channelLinks:{clearChannels(){}},contentRef,
      drafts:{loadDraft:()=>undefined,markDraftSent(){},persistDraft:(...args)=>persisted.push(args)},
      emojiAutocomplete:{clearEmojis(){}},mentions:{clearMentions(){},restoreDraftMentionRefs(){},
        settlePendingMentionBindings:async()=>{},extractMentionPubkeys:()=>[human],getDraftMentionRefs:()=>[{displayName:"Human",pubkey:human}]},
      onSendRef:{current:async(...args)=>{order.push("publish");sent.push(args);}},
      richText:{clearContent(){},setContent(){}},setContent:value=>{contentRef.current=value;},
      setPendingImeta(){},hasUnsavedMedia:()=>false,clearQueuedAttachments(){},restoreQueuedAttachments(){}};
    const view = renderHook(()=>useMentionSendFlow(options));
    await act(async()=>view.result.current.sendMessageWithMentionFlow({trimmed:"@Human original",pendingImeta:[],
      capturedChannelId:"relay-channel",capturedThreadContext:{parentEventId:"root",threadHeadId:"root"},
      sentDraftKey:"thread-root",recoveryDraftKey:"thread-root",addressedAgentPubkeys:[agent,agent.toUpperCase()],
      verifyMentionRecipients:async recipients=>{
        order.push("verify");assert.deepEqual(recipients,[human,agent]);
        if (!admitted) throw new Error("Agent admission revoked");
      }}));
    assert.deepEqual(order,admitted?["verify","publish"]:["verify"]);
    assert.equal(sent.length,admitted?1:0);
    if (admitted) {assert.deepEqual(sent[0][1],[human,agent]);assert.equal(sent[0][3],"relay-channel");}
    else {assert.equal(contentRef.current,"@Human original");assert.equal(persisted.length,1);}
    view.unmount();
  }
  cleanup();dom.window.close();
});

test("getErrorMessage preserves Tauri string errors", () => {
  assert.equal(
    getErrorMessage(
      "relay returned 415 Unsupported Media Type",
      "Unknown error",
    ),
    "relay returned 415 Unsupported Media Type",
  );
  assert.equal(
    getErrorMessage({ message: "upload rejected" }, "Unknown error"),
    "upload rejected",
  );
  assert.equal(getErrorMessage({}, "Unknown error"), "Unknown error");
});

test("uniqueNormalizedPubkeys lowercases and deduplicates recipients", () => {
  assert.deepEqual(
    uniqueNormalizedPubkeys(["A".repeat(64), "a".repeat(64), "b".repeat(64)]),
    ["a".repeat(64), "b".repeat(64)],
  );
});

test("relay publish failures read the shared text, never the relay's own words", async () => {
  const { translate } = await import("@client-kit/platform/i18n");
  const { relayPublishFailureText } = await import(
    "./useMentionSendFlow.helpers.ts"
  );
  const { RelayPublishRejectedError, RelayPublishUnknownError } = await import(
    "../../../shared/api/relayPublishOutcome.ts"
  );
  const cases = [
    // WebSocket 路径
    [
      new RelayPublishRejectedError("e", "restricted: not a channel member"),
      translate("en", "native.send.rejected"),
    ],
    [
      new RelayPublishRejectedError("e", "rate-limited: slow; retry in 8s"),
      translate("en", "native.send.rateLimited", { seconds: 8 }),
    ],
    [
      new RelayPublishUnknownError("e", "Timed out while sending the message."),
      translate("en", "native.send.outcomeUnknown"),
    ],
    // REST 路径（src-tauri 的固定前缀）
    [
      "relay returned 400 Bad Request: restricted: not a channel member",
      translate("en", "native.send.rejected"),
    ],
    [
      "relay rejected event: restricted: not a channel member",
      translate("en", "native.send.rejected"),
    ],
    [
      "relay rate-limited: retry in 12s",
      translate("en", "native.send.rateLimited", { seconds: 12 }),
    ],
    [
      "relay rate-limited: quota exceeded",
      translate("en", "native.send.rateLimitedNoHint"),
    ],
    [
      "relay unreachable: could not connect to relay",
      translate("en", "native.send.notConnected"),
    ],
    [
      "relay unreachable: request timed out",
      translate("en", "native.send.outcomeUnknown"),
    ],
    [
      "relay returned 502 Bad Gateway",
      translate("en", "native.send.outcomeUnknown"),
    ],
    [
      "relay returned malformed response: not valid JSON",
      translate("en", "native.send.outcomeUnknown"),
    ],
    [
      "relay returned malformed response: event ID mismatch",
      translate("en", "native.send.outcomeUnknown"),
    ],
    [
      "relay publish outcome unknown",
      translate("en", "native.send.outcomeUnknown"),
    ],
  ];
  for (const [error, expected] of cases) {
    const text = relayPublishFailureText(error, "en");
    assert.equal(text, expected, String(error));
    assert.doesNotMatch(text, /restricted:|rate-limited:|relay /);
  }
  assert.equal(
    relayPublishFailureText(new Error("community switch"), "en"),
    null,
  );
});

test("withoutInvitingRecipients moves people outside the channel from p recipients to mention reference tags", async () => {
  const { withoutInvitingRecipients } = await import("./useMentionSendFlow.helpers.ts");
  const member = "a".repeat(64), outsider = "b".repeat(64);
  const draft = {
    mentionPubkeys: [member, outsider],
    nonMemberPubkeys: [outsider.toUpperCase()],
    outgoingTags: [["link-preview", "snapshot"]],
  };
  const sent = withoutInvitingRecipients(draft);
  assert.deepEqual(sent.mentionPubkeys, [member]);
  assert.deepEqual(sent.outgoingTags, [["link-preview", "snapshot"], ["mention", outsider]]);
  assert.ok(!sent.mentionPubkeys.some((pubkey) => sent.outgoingTags.some((tag) => tag[1] === pubkey)));
  // The held draft itself is unchanged: Cancel keeps it as written.
  assert.deepEqual(draft.mentionPubkeys, [member, outsider]);
});

test("DD-125(8): a Workspace channel send to someone outside it waits for the original prompt", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {url:"http://localhost"});
  Object.assign(globalThis, {window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,Element:dom.window.Element,
    Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true});
  const {act, cleanup, renderHook} = await import("@testing-library/react");
  const {useMentionSendFlow} = await import("./useMentionSendFlow.ts");
  const member = "a".repeat(64), outsider = "b".repeat(64);
  for (const choice of ["send-anyway", "invite", "cancel"]) {
    const sent = [], invited = [], refreshed = [];
    const contentRef = {current:"@Member @Olive"};
    const options = {channelId:"relay-channel",effectiveDraftKey:"relay-channel",getComposerRevision:()=>0,
      runComposerUpdate:update=>update(),channelLinks:{clearChannels(){}},contentRef,
      drafts:{loadDraft:()=>undefined,markDraftSent(){},persistDraft(){}},
      emojiAutocomplete:{clearEmojis(){}},mentions:{clearMentions(){},restoreDraftMentionRefs(){},
        settlePendingMentionBindings:async()=>{},extractMentionPubkeys:()=>[member,outsider],
        getDraftMentionRefs:()=>[{displayName:"Member",pubkey:member},{displayName:"Olive",pubkey:outsider}]},
      onSendRef:{current:async(...args)=>{sent.push(args);}},
      richText:{clearContent(){},setContent(){}},setContent:value=>{contentRef.current=value;},
      setPendingImeta(){},hasUnsavedMedia:()=>false,clearQueuedAttachments(){},restoreQueuedAttachments(){},
      nonMemberMentions:{memberPubkeys:new Set([member]),isAgentPubkey:()=>false,getDisplayName:pubkey=>pubkey===outsider?"Olive":undefined,
        prepare:async pubkeys=>{assert.deepEqual(pubkeys,[outsider]);return {principals:[{principalId:"olive",displayName:"Olive"}],canInvite:choice==="invite"};},
        invite:async principals=>{invited.push(principals);return {status:"active"};},
        onInvited:()=>refreshed.push(true)}};
    const view = renderHook(()=>useMentionSendFlow(options));
    await act(async()=>view.result.current.sendMessageWithMentionFlow({trimmed:"@Member @Olive",pendingImeta:[],
      capturedChannelId:"relay-channel",sentDraftKey:"relay-channel",recoveryDraftKey:"relay-channel"}));
    assert.equal(sent.length,0);
    const prompt = view.result.current.nonMemberPromptProps;
    assert.equal(prompt.open,true);
    assert.deepEqual(prompt.names,["Olive"]);
    assert.equal(prompt.canInvite,choice==="invite");
    if (choice === "send-anyway") {
      await act(async()=>{prompt.onDoNothing();await new Promise(resolve=>setTimeout(resolve,0));});
      assert.equal(sent.length,1);
      assert.deepEqual(sent[0][1],[member]);
      assert.deepEqual(sent[0][2],[["mention",outsider]]);
      assert.equal(invited.length,0);
    } else if (choice === "invite") {
      await act(async()=>{prompt.onInvite();await new Promise(resolve=>setTimeout(resolve,0));});
      assert.deepEqual(invited,[[{principalId:"olive",displayName:"Olive"}]]);
      assert.equal(refreshed.length,1);
      assert.equal(sent.length,1);
      assert.deepEqual(sent[0][1],[member,outsider]);
      assert.ok(!(sent[0][2] ?? []).some(tag=>tag[0]==="mention"));
    } else {
      await act(async()=>{prompt.onDismiss();});
      assert.equal(sent.length,0);
      assert.equal(contentRef.current,"@Member @Olive");
    }
    assert.equal(view.result.current.nonMemberPromptProps.open,false);
    view.unmount();
  }
  cleanup();dom.window.close();
});
