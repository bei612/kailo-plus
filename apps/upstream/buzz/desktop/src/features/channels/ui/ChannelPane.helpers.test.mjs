import assert from "node:assert/strict";
import test from "node:test";

import {
  getChannelIntroDescription,
  getChannelIntroKind,
} from "./ChannelPane.helpers.ts";

function channel(overrides = {}) {
  return {
    ttlDeadline: null,
    ttlSeconds: null,
    visibility: "open",
    ...overrides,
  };
}

test("channel intro shares description-over-purpose derivation with the header", () => {
  assert.equal(
    getChannelIntroDescription(
      channel({
        description: "Description paragraphs.\n\nKeep this structure.",
        purpose: "Legacy purpose",
        topic: "",
      }),
    ),
    "Description paragraphs.\n\nKeep this structure.",
  );
});

test("getChannelIntroKind labels regular, private and ephemeral streams", () => {
  assert.equal(getChannelIntroKind(channel()), "regular channel");
  assert.equal(
    getChannelIntroKind(channel({ visibility: "private" })),
    "private channel",
  );
  assert.equal(
    getChannelIntroKind(channel({ ttlSeconds: 3600 })),
    "ephemeral channel",
  );
});
