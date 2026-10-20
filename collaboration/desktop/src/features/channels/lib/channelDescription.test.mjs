import assert from "node:assert/strict";
import test from "node:test";

import { translate } from "@client-kit/platform/i18n";
import {
  getChannelDescription as getSharedChannelDescription,
} from "@client-kit/platform/react/channel-description";
import {
  getChannelDescription,
  getChannelDetail,
} from "./channelDescription.ts";

function makeChannel(overrides = {}) {
  return {
    archivedAt: null,
    description: "",
    isMember: true,
    purpose: "",
    topic: "",
    ...overrides,
  };
}

test("getChannelDescription falls back when no detail fields are set", () => {
  assert.equal(
    getChannelDescription(makeChannel(), "en"),
    "Channel details and activity.",
  );
  // The Desktop host now renders the shared localized copy, not a fixed English string.
  assert.equal(
    getChannelDescription(makeChannel(), "zh-CN"),
    translate("zh-CN", "channel.description.fallback"),
  );
});

test("getChannelDetail provides one shared field order for every surface", () => {
  const channel = makeChannel({
    description: "Description paragraphs.\n\nKeep this structure.",
    purpose: "Legacy purpose",
    topic: "",
  });

  assert.equal(
    getChannelDetail(channel),
    "Description paragraphs.\n\nKeep this structure.",
  );
  assert.equal(getChannelDescription(channel, "en"), getChannelDetail(channel));
});

test("getChannelDescription returns single-line detail unchanged", () => {
  assert.equal(
    getChannelDescription(makeChannel({ description: "Team updates." }), "en"),
    "Team updates.",
  );
});

test("getChannelDescription preserves paragraph line breaks (AIDA-1980)", () => {
  const detail = "First paragraph.\n\nSecond paragraph with instructions.";
  assert.equal(
    getChannelDescription(makeChannel({ description: detail }), "en"),
    detail,
  );
});

test("getChannelDescription puts status prefixes on their own line", () => {
  const detail = "Line one.\nLine two.";
  assert.equal(
    getChannelDescription(
      makeChannel({
        archivedAt: "2026-01-01T00:00:00Z",
        description: detail,
      }),
      "en",
    ),
    `Archived.\n${detail}`,
  );
});

test("getChannelDescription shows prefixes alone when no detail exists", () => {
  assert.equal(
    getChannelDescription(
      makeChannel({ archivedAt: "2026-01-01T00:00:00Z" }),
      "en",
    ),
    "Archived.",
  );
});

test("the Desktop adapter is the shared Web/Desktop helper over native archivedAt", () => {
  for (const locale of ["en", "zh-CN"]) {
    for (const archivedAt of [null, "2026-01-01T00:00:00Z"]) {
      const channel = makeChannel({ archivedAt, topic: "Topic", purpose: "Purpose" });
      assert.equal(
        getChannelDescription(channel, locale),
        getSharedChannelDescription(
          { topic: "Topic", description: "", purpose: "Purpose", archived: archivedAt !== null },
          locale,
        ),
      );
    }
  }
});
