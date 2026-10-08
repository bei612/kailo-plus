import assert from "node:assert/strict";
import test, {afterEach} from "node:test";
import { act } from "react";
import { createBffClient } from "@client-kit/platform/client";
import { TransportError } from "@client-kit/platform/transport";
import { installDOMShim, installFreshStorage, mountUnreadChannels } from "./observedUnreadTestHarness.mjs";

installDOMShim();
const pubkey = "a".repeat(64);
const channel = { id: "private", channelType: "dm", name: "Peer" };
const incoming = { id: "message", channelId: channel.id, channelType: "dm", createdAt: 20, category: "activity", tags: [] };
const iso = seconds => new Date(seconds * 1000).toISOString();
const mounted = new Set();
afterEach(async () => {
  for (const harness of mounted) await harness.unmount();
  mounted.clear();
});
async function mount({lost = false, held = false, ...options} = {}) {
  installFreshStorage();
  let version = 0, active = true, release;
  const writes = [];
  const contexts = {};
  const client = createBffClient({send: async request => {
    if (request.method === "PUT") {
      writes.push(request.body);
      if (lost) throw new TransportError("lost ACK");
      if (held) await new Promise(resolve => { release = resolve; });
      assert.equal(request.body.version, version);
      contexts[request.body.contextKey] = request.body.lastReadAt;
      return {status: 200, body: {version: ++version}};
    }
    return {status: 200, body: request.path === "/api/v1/workspaces" ? [] : request.path === "/api/v1/conversations" ? {
      items: active ? [{id: "conversation", channelId: channel.id, participantPrincipalIds: ["self", "peer"], state: "ACTIVE"}] : [],
    } : {version, readContexts: {...contexts}, workspacePreferences: {}}};
  }});
  const harness = await mountUnreadChannels({pubkey, channels: [channel], activeChannel: channel, coreClient: client, dmEvents: [incoming], ...options});
  mounted.add(harness);
  assert.ok(harness.coreReads.state);
  return {harness, writes, contexts, release: () => release(), revoke: async () => {
    active = false;
    await act(async () => { await harness.coreReads.refresh(); });
  }};
}

test("opening the Native DM waits for Core hydration and does not clear legacy Inbox overrides", async () => {
  let localUndo = 0;
  const {harness, writes} = await mount({openReadAt: iso(10), undoUnread: () => { localUndo++; }});
  assert.deepEqual(writes, [{contextKey: channel.id, lastReadAt: iso(10), version: 0}]);
  assert.equal(localUndo, 0);
  assert.equal(harness.result.getOwnTimestamp(channel.id), 10);
  await harness.unmount();
});

test("Native DM open, thread, explicit unread and mark-all use the same Core CAS without local markers", async () => {
  const {harness, writes, contexts} = await mount();
  const localKey = `buzz.channel-read-state.v2:${pubkey}`;
  const before = localStorage.getItem(localKey);
  await act(async () => assert.equal(await harness.markChannelRead(channel.id, iso(10), {topLevelOnly: true}), true));
  assert.deepEqual(writes[0], {contextKey: channel.id, lastReadAt: iso(10), version: 0});
  await act(async () => assert.equal(await harness.markChannelRead("msg:reply", iso(30)), true));
  assert.equal(harness.result.getEffectiveTimestamp("msg:reply"), 30);
  await act(async () => assert.equal(await harness.result.markMessagesUnread([{id: "reply", createdAt: 30, tags: [["e", "root", "", "reply"]]}]), true));
  assert.equal(contexts["msg:reply"], iso(29));
  assert.equal(contexts["thread:root"], iso(29));
  assert.equal(contexts.private, iso(10));
  await act(async () => assert.equal(await harness.result.markChannelUnread(channel.id), true));
  assert.equal(contexts.private, iso(19));
  await act(async () => { harness.markAllChannelsRead(); });
  assert.equal(contexts.private, iso(20));
  assert.deepEqual(writes.map(write => write.version), writes.map((_, index) => index));
  assert.equal(localStorage.getItem(localKey), before);
  await harness.unmount();
});

test("Native DM marker remains unchanged until the actual Core ACK", async () => {
  const {harness, writes, release} = await mount({held: true});
  let result;
  await act(async () => { result = harness.markChannelRead(channel.id, iso(20)); });
  assert.equal(writes.length, 1);
  assert.equal(harness.coreReads.pending, true);
  assert.equal(harness.result.getOwnTimestamp(channel.id), null);
  await act(async () => { release(); assert.equal(await result, true); });
  assert.equal(harness.result.getOwnTimestamp(channel.id), 20);
  await harness.unmount();
});

test("lost Native DM ACK is UNKNOWN, not a local read or automatic retry", async () => {
  const {harness, writes} = await mount({lost: true});
  await act(async () => assert.equal(await harness.markChannelRead(channel.id, iso(20)), false));
  assert.equal(harness.coreReads.unknown, true);
  assert.equal(harness.result.getOwnTimestamp(channel.id), null);
  await act(async () => {
    assert.equal(await harness.result.markChannelUnread(channel.id), false);
    harness.markAllChannelsRead();
    await harness.coreReads.refresh();
  });
  assert.equal(harness.coreReads.unknown, true);
  assert.equal(writes.length, 1);
  await harness.unmount();
});

test("revoked DM admission refuses both already-read and unread operations", async () => {
  const {harness, writes, revoke} = await mount();
  await act(async () => { await harness.markChannelRead(channel.id, iso(20)); });
  await revoke();
  await act(async () => {
    assert.equal(await harness.markChannelRead(channel.id, iso(20)), false);
    assert.equal(await harness.result.markChannelUnread(channel.id), false);
  });
  assert.equal(writes.length, 1);
  await harness.unmount();
});

test("stale thread and principal callbacks cannot write the new DM scope", async () => {
  const {harness, writes} = await mount();
  const previous = harness.markChannelRead;
  await harness.render(pubkey, {id: "other", channelType: "dm"});
  await act(async () => assert.equal(await previous("msg:reply", iso(30)), false));
  await harness.render("b".repeat(64), channel);
  await act(async () => assert.equal(await previous(channel.id, iso(30)), false));
  assert.equal(writes.length, 0);
  await harness.unmount();
});
