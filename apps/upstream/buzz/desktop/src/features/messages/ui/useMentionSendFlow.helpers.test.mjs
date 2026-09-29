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
