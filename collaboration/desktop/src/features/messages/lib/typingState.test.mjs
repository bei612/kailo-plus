import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { emptyTypingState, pruneTypingState, receiveTypingEvent, typingEntries } from "../../../../../../client-kit/ts/platform/src/react/messages/typingState.ts";

const at = 100_000;
const event = (changes = {}) => ({ pubkey: "ALICE", created_at: 100, kind: 20002, tags: [["h", "channel"]], ...changes });
const receive = (state, changes = {}, now = at) => receiveTypingEvent(state, event(changes), "channel", now);

test("original typing expires at eight seconds and rejects another channel or stale indicator", () => {
  const empty = emptyTypingState();
  assert.equal(receive(empty, { tags: [["h", "other"]] }), empty);
  assert.equal(receive(empty, { created_at: 92 }), empty);
  const state = receive(empty);
  assert.deepEqual(typingEntries(state), [{ pubkey: "alice", threadHeadId: null }]);
  assert.equal(typingEntries(pruneTypingState(state, at + 7_999)).length, 1);
  assert.equal(typingEntries(pruneTypingState(state, at + 8_000)).length, 0);
});

test("original first-seen order survives refresh and channel/thread scopes are independent", () => {
  let state = receive(emptyTypingState());
  state = receive(state, { pubkey: "bob" }, at + 1);
  state = receive(state, { created_at: 101 }, at + 1_000);
  state = receive(state, { tags: [["h", "channel"], ["e", "root", "", "reply"]] }, at + 1_001);
  assert.deepEqual(typingEntries(state), [
    { pubkey: "alice", threadHeadId: null }, { pubkey: "bob", threadHeadId: null },
    { pubkey: "alice", threadHeadId: "root" },
  ]);
  state = receive(state, { kind: 9, created_at: 102 }, at + 2_000);
  assert.deepEqual(typingEntries(state), [{ pubkey: "bob", threadHeadId: null }, { pubkey: "alice", threadHeadId: "root" }]);
});

test("native messages and diffs clear typing, suppress late indicators, then accept a new burst", () => {
  for (const kind of [9, 40008, 40002]) {
    let state = receive(emptyTypingState());
    state = receive(state, { kind, created_at: 101 }, at + 1_000);
    assert.deepEqual(typingEntries(state), []);
    state = receive(state, { created_at: 102 }, at + 2_000);
    assert.deepEqual(typingEntries(state), []);
    state = receive(state, { created_at: 100 }, at + 3_001);
    assert.deepEqual(typingEntries(state), []);
    state = receive(state, { created_at: 104 }, at + 4_000);
    assert.equal(typingEntries(state).length, 1);
  }
});

test("completion watermarks and future indicators do not keep state indefinitely", () => {
  let state = receive(emptyTypingState(), { kind: 9 });
  assert.deepEqual(pruneTypingState(state, at + 8_000), emptyTypingState());
  state = receive(emptyTypingState(), { created_at: 100_000 });
  assert.deepEqual(pruneTypingState(state, at + 8_000), emptyTypingState());
  assert.deepEqual(typingEntries(emptyTypingState()), []);
});

test("relay-delegated completion clears the original author and suppresses late typing", () => {
  const secret = new Uint8Array(32).fill(2);
  const author = "33".repeat(32);
  const relay = getPublicKey(secret);
  for (const attribution of [[["actor", author]], [["p", author]]]) {
    const completed = finalizeEvent({ kind: 9, created_at: 101, content: "done",
      tags: [...attribution, ["h", "channel"]] }, secret);
    let state = receive(emptyTypingState(), { pubkey: author });
    state = receiveTypingEvent(state, completed, "channel", at + 1_000, relay);
    assert.deepEqual(typingEntries(state), []);
    state = receive(state, { pubkey: author, created_at: 102 }, at + 2_000);
    assert.deepEqual(typingEntries(state), []);
  }
});

test("untrusted, unsigned, tampered and cross-scope completion cannot clear another author", () => {
  const secret = new Uint8Array(32).fill(2);
  const author = "33".repeat(32);
  const relay = getPublicKey(secret);
  const completed = finalizeEvent({ kind: 9, created_at: 101, content: "done",
    tags: [["actor", author], ["h", "channel"]] }, secret);
  const initial = receive(emptyTypingState(), { pubkey: author });
  for (const identity of [null, "invalid", author]) {
    assert.deepEqual(typingEntries(receiveTypingEvent(initial, completed, "channel", at + 1_000, identity)), typingEntries(initial));
  }
  // JSON round-trip drops the signing library's local verification cache.
  const raw = JSON.parse(JSON.stringify(completed));
  for (const broken of [{ ...raw, content: "tampered" }, { ...raw, sig: undefined },
    { ...raw, tags: [["actor", author], ["h", "other"]] }]) {
    assert.deepEqual(typingEntries(receiveTypingEvent(initial, broken, "channel", at + 1_000, relay)), typingEntries(initial));
  }
  const indicator = finalizeEvent({ kind: 20002, created_at: 100, content: "",
    tags: [["actor", author], ["h", "channel"]] }, secret);
  assert.deepEqual(typingEntries(receiveTypingEvent(emptyTypingState(), indicator, "channel", at, relay)), [{ pubkey: relay, threadHeadId: null }]);
});
