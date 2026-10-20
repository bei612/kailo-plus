// DD-120 on the native host: presence and user status through this device's key and the
// Relay (05 collab.presence), in the shapes the shared presence/user-status bodies consume.
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.window.navigator });

const {
  KIND_USER_STATUS,
  createNativePresenceTransport,
  presencePageFromSnapshot,
  presenceQueryAuthors,
  userStatusPageFromEvents,
  userStatusTags,
} = await import("./NativePresenceHost.tsx");
const { RelayPublishRejectedError, RelayPublishUnknownError } = await import("@/shared/api/relayPublishOutcome");
const { isOutcomeUnknown } = await import("@client-kit/platform/transport");
const { QueryClient } = await import("@tanstack/react-query");
const { presenceQueryKey } = await import("@client-kit/platform/react/presence");

const aliceKey = new Uint8Array(32).fill(1);
const bobKey = new Uint8Array(32).fill(2);
const alice = getPublicKey(aliceKey);
const bob = getPublicKey(bobKey);
const status = (key, content, tags = [], created_at = 100) =>
  finalizeEvent({ kind: KIND_USER_STATUS, created_at, content, tags: [["d", "general"], ...tags] }, key);

test("the Relay snapshot keeps requested pubkeys with a known status only", () => {
  const page = presencePageFromSnapshot(
    { [alice.toUpperCase()]: "online", [bob]: "away", ["f".repeat(64)]: "online", ["e".repeat(64)]: "busy" },
    [alice, bob, "e".repeat(64)],
  );
  assert.deepEqual(
    page.presences.map((entry) => [entry.pubkey, entry.status]).sort(),
    [[alice, "online"], [bob, "away"]].sort(),
  );
});

test("user status reads take the latest verified status per author and omit cleared or expired ones", () => {
  const page = userStatusPageFromEvents([
    status(aliceKey, "old", [], 100),
    status(aliceKey, "In a meeting", [["emoji", "📅"], ["expiration", "500"]], 200),
    status(bobKey, "", [], 300),
  ], [alice, bob], 400);
  assert.deepEqual(page.statuses.map(({ pubkey, text, emoji, expiresAt, createdAt }) => ({ pubkey, text, emoji, expiresAt, createdAt })), [
    { pubkey: alice, text: "In a meeting", emoji: "📅", expiresAt: 500, createdAt: 200 },
  ]);
  assert.deepEqual(userStatusPageFromEvents([status(aliceKey, "Lunch", [["expiration", "300"]], 200)], [alice], 400).statuses, []);
  // Emoji-only statuses stay visible, as in the original.
  assert.equal(userStatusPageFromEvents([status(bobKey, "", [["emoji", "🌴"]], 10)], [bob], 20).statuses[0].emoji, "🌴");
});

test("a row that is not an intact status of a requested author fails the whole read", () => {
  // A wire copy: nostr-tools caches verification on the signed object it returned.
  const forged = { ...JSON.parse(JSON.stringify(status(aliceKey, "real"))), content: "forged" };
  assert.throws(() => userStatusPageFromEvents([forged], [alice], 0), (error) => isOutcomeUnknown(error));
  assert.throws(() => userStatusPageFromEvents([status(bobKey, "hi")], [alice], 0), (error) => isOutcomeUnknown(error));
  assert.throws(() => userStatusPageFromEvents([finalizeEvent({ kind: KIND_USER_STATUS, created_at: 1, content: "x", tags: [["d", "music"]] }, aliceKey)], [alice], 0));
});

test("own status keeps the original tag order", () => {
  assert.deepEqual(userStatusTags({ text: "Away", emoji: "🌴", expiresAt: 900 }), [["d", "general"], ["emoji", "🌴"], ["expiration", "900"]]);
  assert.deepEqual(userStatusTags({ text: "" }), [["d", "general"]]);
});

function transport({ publish } = {}) {
  const signed = [];
  const published = [];
  const reads = [];
  let counter = 0;
  const value = createNativePresenceTransport({
    readSnapshot: async (pubkeys) => { reads.push(["snapshot", pubkeys]); return { [alice]: "online" }; },
    fetchEvents: async (filter) => { reads.push(["events", filter]); return [status(aliceKey, "Here", [], 50)]; },
    sign: async (input) => { signed.push(input); counter += 1; return { id: `${counter}`.padStart(64, "0"), created_at: 77, pubkey: alice, sig: "", ...input }; },
    publish: async (event, ...rest) => { published.push(event); if (publish) await publish(event, ...rest); },
    now: () => 1_000_000,
  });
  return { value, signed, published, reads };
}

test("presence heartbeats sign the original ephemeral 20001 with the device key", async () => {
  const t = transport();
  await t.value.updatePresence("away");
  assert.deepEqual(t.signed, [{ kind: 20001, content: "away", tags: [] }]);
  assert.equal(t.published.length, 1);
  const page = await t.value.queryPresence([alice.toUpperCase(), bob]);
  assert.deepEqual(t.reads[0], ["snapshot", [alice, bob].sort()]);
  assert.deepEqual(page.presences, [{ pubkey: alice, status: "online" }]);
});

test("status reads ask the Relay for the requested authors' d=general 30315 only", async () => {
  const t = transport();
  const page = await t.value.queryUserStatus([alice]);
  assert.deepEqual(t.reads[0], ["events", { kinds: [KIND_USER_STATUS], authors: [alice], "#d": ["general"], limit: 1 }]);
  assert.equal(page.statuses[0].text, "Here");
});

test("an UNKNOWN status publication re-sends the same signed event, never a second one", async () => {
  let attempt = 0;
  const t = transport({ publish: async (event) => {
    attempt += 1;
    if (attempt === 1) throw new RelayPublishUnknownError(event.id, "no OK");
  } });
  await assert.rejects(t.value.updateUserStatus({ text: "Away" }, "key-1"), (error) => isOutcomeUnknown(error));
  const receipt = await t.value.updateUserStatus({ text: "Away" }, "key-1");
  assert.equal(t.signed.length, 1);
  assert.deepEqual(t.published.map((event) => event.id), [t.published[0].id, t.published[0].id]);
  assert.deepEqual(receipt, { eventId: t.published[0].id, createdAt: 77 });
});

test("a refused status publication is final and the next attempt signs afresh", async () => {
  let attempt = 0;
  const t = transport({ publish: async (event) => {
    attempt += 1;
    if (attempt === 1) throw new RelayPublishRejectedError(event.id, "blocked: you are banned from this community");
  } });
  await assert.rejects(t.value.updateUserStatus({ text: "Away" }, "key-2"), (error) => !isOutcomeUnknown(error));
  await t.value.updateUserStatus({ text: "Away" }, "key-2");
  assert.equal(t.signed.length, 2);
});

test("live presence frames follow the authors of the cached presence lookups", () => {
  const client = new QueryClient();
  client.setQueryData(presenceQueryKey([bob, alice]), {});
  client.setQueryData(presenceQueryKey([alice]), {});
  client.setQueryData(["user-status", alice], {});
  assert.deepEqual(presenceQueryAuthors(client), [alice, bob].sort());
  client.clear();
});
