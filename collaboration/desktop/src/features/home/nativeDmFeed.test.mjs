import assert from "node:assert/strict";
import { after, test } from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { loadNativeDmFeed } from "./nativeDmFeed.ts";

const oldWindow = globalThis.window;
after(() => { globalThis.window = oldWindow; });
const ownKey = new Uint8Array(32).fill(1);
const peerKey = new Uint8Array(32).fill(2);
const own = getPublicKey(ownKey);
const peer = getPublicKey(peerKey);
const conversation = { id: "conversation", channelId: "direct", participantPrincipalIds: ["me", "peer"], state: "ACTIVE" };
const message = (key, content, channel = "direct") => finalizeEvent({ kind: 9, created_at: 100, content, tags: [["h", channel]] }, key);
const bounds = () => finalizeEvent({ kind: 39006, created_at: 100, content: JSON.stringify({ has_more: false, next_cursor: null }), tags: [["h", "direct"], ["d", "direct:head"]] }, peerKey);
function session(directory = async () => ({ items: [conversation] })) {
  return { devicePubkey: own, facts: { relayUrl: "wss://relay.test", relayQueryLimit: 20 }, client: {
    session: async () => ({ tenantPrincipalId: "me" }), conversations: directory,
    conversationParticipants: async () => ({ items: [{ principalId: "me", pubkeys: [own] }, { principalId: "peer", pubkeys: [peer] }] }),
  } };
}
function native(read) { globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
  assert.equal(command, "get_channel_window");
  assert.deepEqual(args, { channelId: "direct", limitRows: 20, forumPosts: false, expectedRelayUrl: "wss://relay.test", expectedSignerPubkey: own, cursor: null });
  return read();
} } }; }

test("cold native feed loads plain DM without mention/thread, excludes own messages and keeps the full admitted window", async () => {
  const incoming = message(peerKey, "ordinary DM"); const outgoing = message(ownKey, "my reply");
  native(() => [incoming, outgoing, bounds()]);
  const result = await loadNativeDmFeed(session(), new AbortController().signal);
  assert.deepEqual(result.activity.map(item => [item.id, item.channelType, item.category]), [[incoming.id, "dm", "activity"]]);
  assert.equal(result.windows.get("direct").length, 3);
});

test("revocation after Relay read rejects all results before the caller can cache", async () => {
  let calls = 0;
  native(() => [message(peerKey, "secret"), bounds()]);
  await assert.rejects(loadNativeDmFeed(session(async () => ({ items: ++calls === 1 ? [conversation] : [] })), new AbortController().signal), /admission changed/);
});

test("aborted native read and cross-channel signed results are rejected", async () => {
  const controller = new AbortController();
  native(() => { controller.abort(); return [message(peerKey, "late"), bounds()]; });
  await assert.rejects(loadNativeDmFeed(session(), controller.signal), { name: "AbortError" });
  native(() => [message(peerKey, "wrong channel", "other"), bounds()]);
  await assert.rejects(loadNativeDmFeed(session(), new AbortController().signal), /Unverifiable/);
});

test("empty admitted directory never reads native Relay", async () => {
  native(() => { throw new Error("must not read"); });
  const result = await loadNativeDmFeed(session(async () => ({ items: [] })), new AbortController().signal);
  assert.equal(result.activity.length, 0); assert.equal(result.windows.size, 0);
});
