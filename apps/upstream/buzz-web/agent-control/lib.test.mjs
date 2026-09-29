import assert from "node:assert/strict";
import { test } from "node:test";
import { finalizeEvent, generateSecretKey, getPublicKey } from "nostr-tools/pure";
import {
  HttpError,
  parseAgentUnits,
  sha256Hex,
  verifyNip98Request,
} from "./lib.mjs";

function authorization({ secretKey, url, body, createdAt = 1_800_000_000 }) {
  const event = finalizeEvent(
    {
      kind: 27235,
      created_at: createdAt,
      content: "",
      tags: [
        ["u", url],
        ["method", "POST"],
        ["payload", sha256Hex(body)],
        ["nonce", "request-1"],
      ],
    },
    secretKey,
  );
  return { event, header: `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}` };
}

test("accepts a fresh owner-signed request exactly once", () => {
  const secretKey = generateSecretKey();
  const pubkey = getPublicKey(secretKey);
  const body = JSON.stringify({ pubkey: "a".repeat(64) });
  const url = "https://buzz.example.com/app/api/agent-control/start";
  const { event, header } = authorization({ secretKey, url, body });
  const seenEventIds = new Map();

  assert.equal(
    verifyNip98Request({
      authorization: header,
      method: "POST",
      url,
      body,
      allowedPubkeys: new Set([pubkey]),
      seenEventIds,
      nowSeconds: 1_800_000_000,
    }),
    pubkey,
  );
  assert.equal(seenEventIds.has(event.id), true);
  assert.throws(
    () =>
      verifyNip98Request({
        authorization: header,
        method: "POST",
        url,
        body,
        allowedPubkeys: new Set([pubkey]),
        seenEventIds,
        nowSeconds: 1_800_000_000,
      }),
    (error) => error instanceof HttpError && error.status === 409,
  );
});

test("rejects a valid signature from a non-owner and payload changes", () => {
  const secretKey = generateSecretKey();
  const body = JSON.stringify({ pubkey: "a".repeat(64) });
  const url = "https://buzz.example.com/app/api/agent-control/start";
  const { header } = authorization({ secretKey, url, body });

  assert.throws(
    () =>
      verifyNip98Request({
        authorization: header,
        method: "POST",
        url,
        body,
        allowedPubkeys: new Set(["b".repeat(64)]),
        seenEventIds: new Map(),
        nowSeconds: 1_800_000_000,
      }),
    (error) => error instanceof HttpError && error.status === 403,
  );
  assert.throws(
    () =>
      verifyNip98Request({
        authorization: header,
        method: "POST",
        url,
        body: `${body} `,
        allowedPubkeys: new Set([getPublicKey(secretKey)]),
        seenEventIds: new Map(),
        nowSeconds: 1_800_000_000,
      }),
    (error) => error instanceof HttpError && error.status === 401,
  );
});

test("validates configured agent pubkeys and systemd units", () => {
  const units = parseAgentUnits(JSON.stringify({ ["a".repeat(64)]: "buzz-codex.service" }));
  assert.equal(units.get("a".repeat(64)), "buzz-codex.service");
  assert.throws(() => parseAgentUnits(JSON.stringify({ nope: "buzz-codex.service" })));
  assert.throws(() => parseAgentUnits(JSON.stringify({ ["a".repeat(64)]: "../bad" })));
});
