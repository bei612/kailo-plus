import assert from "node:assert/strict";
import test from "node:test";

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
