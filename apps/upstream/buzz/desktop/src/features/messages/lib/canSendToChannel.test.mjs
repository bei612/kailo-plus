import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCanSendMessageToChannel,
  canSendMessageToChannel,
} from "./canSendToChannel.ts";

const CURRENT = "a".repeat(64);
const OTHER_PERSON = "c".repeat(64);

const message = (pubkey) => ({ kind: 9, pubkey });

test("send-to-channel permits self-authored messages", () => {
  assert.equal(canSendMessageToChannel(message(CURRENT), CURRENT), true);
});

test("send-to-channel rejects specialized message kinds", () => {
  const systemMessage = { ...message(CURRENT), kind: 40099 };

  assert.equal(canSendMessageToChannel(systemMessage, CURRENT), false);
  assert.throws(
    () => assertCanSendMessageToChannel(systemMessage, CURRENT),
    /Only ordinary channel messages/,
  );
});

test("send-to-channel rejects pending messages", () => {
  const pendingMessage = { ...message(CURRENT), pending: true };

  assert.equal(canSendMessageToChannel(pendingMessage, CURRENT), false);
  assert.throws(
    () => assertCanSendMessageToChannel(pendingMessage, CURRENT),
    /finish sending first/,
  );
});

test("send-to-channel rejects other people's messages", () => {
  assert.equal(canSendMessageToChannel(message(OTHER_PERSON), CURRENT), false);
  assert.throws(
    () => assertCanSendMessageToChannel(message(OTHER_PERSON), CURRENT),
    /only send your own messages/,
  );
});
