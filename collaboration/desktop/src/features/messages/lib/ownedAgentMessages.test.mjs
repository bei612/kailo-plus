// DD-142: owned-Agent edit/delete go through the BFF publish routes with one DD-81 idempotency
// key per intent: reused while the outcome is unknown, released once refused or confirmed.
import assert from "node:assert/strict";
import test from "node:test";
import { BffError, TransportError } from "@client-kit/platform/transport";

import {
  createPublishIntents,
  deleteOwnedAgentMessage,
  editOwnedAgentMessage,
  isOwnedAgentMessage,
  ownedAgentEditRequest,
  ownedAgentScope,
} from "./ownedAgentMessages.ts";

const ME = "a".repeat(64);
const AGENT = "b".repeat(64);
const TARGET = "e".repeat(64);
const HASH = "f".repeat(64);
const SCOPE = JSON.stringify(["wss://relay.example", ME]);

function keys() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function fakeClient(answers) {
  const calls = [];
  const answer = async (route, workspaceId, body, key) => {
    calls.push({ route, workspaceId, body, key });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return {
    calls,
    publishWorkspaceMessage: (workspaceId, body, key) => answer("edit", workspaceId, body, key),
    deleteWorkspaceMessage: (workspaceId, body, key) => answer("delete", workspaceId, body, key),
  };
}

const receipt = { eventId: "1".repeat(64), operationId: "op" };
const unknown = () => new BffError(502, "unknown", { class: "UNKNOWN" });
const refused = () => new BffError(403, "denied", { class: "DENIED", reason: "PERMISSION_DENIED" });

test("an unknown deletion is retried with the same key; a confirmed one releases it", async () => {
  const intents = createPublishIntents(keys());
  const client = fakeClient([new TransportError("no answer"), unknown(), receipt, receipt]);
  const message = { id: TARGET };
  await assert.rejects(deleteOwnedAgentMessage(client, "ws", SCOPE, message, intents), TransportError);
  await assert.rejects(deleteOwnedAgentMessage(client, "ws", SCOPE, message, intents), BffError);
  assert.deepEqual(await deleteOwnedAgentMessage(client, "ws", SCOPE, message, intents), receipt);
  await deleteOwnedAgentMessage(client, "ws", SCOPE, message, intents);
  assert.deepEqual(client.calls.map((call) => call.key), [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ]);
  assert.deepEqual(client.calls[0].body, {
    content: "", attachments: [], mentionInstallationIds: [], messageType: "STREAM", deleteEventId: TARGET,
  });
  assert.equal(client.calls[0].route, "delete");
  assert.equal(client.calls[0].workspaceId, "ws");
});

test("a refused edit releases its key; the next attempt is a new intent", async () => {
  const intents = createPublishIntents(keys());
  const client = fakeClient([refused(), receipt]);
  const request = ownedAgentEditRequest({ id: TARGET }, "fixed", [], [], new Map());
  await assert.rejects(editOwnedAgentMessage(client, "ws", SCOPE, request, intents), (error) => error.status === 403);
  await editOwnedAgentMessage(client, "ws", SCOPE, request, intents);
  assert.notEqual(client.calls[0].key, client.calls[1].key);
});

test("a receipt without event and operation is unknown and keeps the key", async () => {
  const intents = createPublishIntents(keys());
  const client = fakeClient([{}, receipt]);
  const request = ownedAgentEditRequest({ id: TARGET }, "fixed", [], [], new Map());
  await assert.rejects(editOwnedAgentMessage(client, "ws", SCOPE, request, intents), TransportError);
  await editOwnedAgentMessage(client, "ws", SCOPE, request, intents);
  assert.equal(client.calls[0].key, client.calls[1].key);
});

test("a changed edit while another is unknown is its own intent", async () => {
  const intents = createPublishIntents(keys());
  const client = fakeClient([new TransportError("no answer"), receipt]);
  const first = ownedAgentEditRequest({ id: TARGET }, "one", [], [], new Map());
  const second = ownedAgentEditRequest({ id: TARGET }, "two", [], [], new Map());
  await assert.rejects(editOwnedAgentMessage(client, "ws", SCOPE, first, intents));
  await editOwnedAgentMessage(client, "ws", SCOPE, second, intents);
  assert.notEqual(client.calls[0].key, client.calls[1].key);
});

test("the edit request matches the Web body: media as attachments, Agent mentions as Installations", () => {
  const url = `https://relay.example/media/${HASH}.png`;
  const request = ownedAgentEditRequest({ id: TARGET }, `Updated\n\n![image](${url})`, [ME, AGENT.toUpperCase()],
    [["imeta", `url ${url}`, "m image/png", `x ${HASH}`, "size 42", "dim 10x10"], ["emoji", "x", "y"]],
    new Map([[AGENT, "installation-1"]]));
  assert.deepEqual(request, {
    content: "Updated",
    attachments: [{ url, type: "image/png", sha256: HASH, size: 42, dim: "10x10" }],
    mentionInstallationIds: ["installation-1"],
    editEventId: TARGET,
    mentionPubkeys: [ME],
  });
});

test("only an owned Agent's message in a Workspace channel routes through the BFF", () => {
  const owned = ownedAgentScope("stream", new Set([AGENT]));
  assert.equal(isOwnedAgentMessage({ id: TARGET, kind: 9, signerPubkey: AGENT }, ME, owned), true);
  assert.equal(isOwnedAgentMessage({ id: TARGET, kind: 9, signerPubkey: ME }, ME, owned), false);
  assert.equal(isOwnedAgentMessage({ id: TARGET, kind: 9, signerPubkey: AGENT }, ME, ownedAgentScope("dm", new Set([AGENT]))), false);
});
