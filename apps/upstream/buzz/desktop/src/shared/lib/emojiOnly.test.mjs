import assert from "node:assert/strict";
import test from "node:test";

import { isEmojiOnlyMessage } from "./emojiOnly.ts";

test("detects unicode emoji-only messages", () => {
  assert.equal(isEmojiOnlyMessage("😀"), true);
  assert.equal(isEmojiOnlyMessage("😀 👍🏽\n❤️"), true);
  assert.equal(isEmojiOnlyMessage("🏳️‍🌈 👨‍👩‍👧‍👦"), true);
});

test("rejects prose, markdown, and shortcodes", () => {
  assert.equal(isEmojiOnlyMessage("hello 😀"), false);
  assert.equal(isEmojiOnlyMessage("😀!"), false);
  assert.equal(isEmojiOnlyMessage("**😀**"), false);
  assert.equal(isEmojiOnlyMessage(":buzz:"), false);
  assert.equal(isEmojiOnlyMessage(""), false);
});
