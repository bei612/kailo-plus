import assert from "node:assert/strict";
import test from "node:test";

// Import the REAL implementations (the runner strips TS types via
// test-loader.mjs). Earlier this file inlined stale copies of these functions,
// which silently drifted from source — the inlined formatImetaMediaLine had no
// generic-file branch at all, so it could never catch a regression there.
// Importing the real module closes that blind spot.
import {
  buildImetaTags,
  buildOutgoingMessage,
  formatImetaMediaLine,
  mergeOutgoingTags,
  splitOutgoingTags,
} from "./imetaMediaMarkdown.ts";

// ── formatImetaMediaLine (send-path body markdown) ────────────────────

test("formatImetaMediaLine: image mime → ![image] line", () => {
  assert.equal(
    formatImetaMediaLine({ url: "https://b/a.png", type: "image/png" }),
    "\n![image](https://b/a.png)",
  );
});

test("formatImetaMediaLine: spoilered image mime → wrapped ![image] line", () => {
  assert.equal(
    formatImetaMediaLine(
      { url: "https://b/a.png", type: "image/png" },
      { spoiler: true },
    ),
    "\n||![image](https://b/a.png)||",
  );
});

test("formatImetaMediaLine: agent snapshot PNG → filename link", () => {
  assert.equal(
    formatImetaMediaLine({
      url: "https://b/analyst.png",
      type: "image/png",
      filename: "analyst.agent.png",
    }),
    "\n[analyst.agent.png](https://b/analyst.png)",
  );
});

test("formatImetaMediaLine: team snapshot PNG → filename link", () => {
  assert.equal(
    formatImetaMediaLine({
      url: "https://b/engineering.png",
      type: "image/png",
      filename: "engineering.team.png",
    }),
    "\n[engineering.team.png](https://b/engineering.png)",
  );
});

test("formatImetaMediaLine: agent snapshot can use a display label", () => {
  assert.equal(
    formatImetaMediaLine(
      {
        url: "https://b/animation-auditor.png",
        type: "image/png",
        filename: "animation-auditor.agent.png",
      },
      { label: "Animation Auditor" },
    ),
    "\n[Animation Auditor](https://b/animation-auditor.png)",
  );
});

test("buildImetaTags keeps media filenames in imeta", () => {
  // Filenames are included for every MIME type — the video review dialog
  // and file cards use them as display titles.
  assert.deepEqual(
    buildImetaTags([
      {
        url: "https://b/a.png",
        type: "image/png",
        sha256: "abc",
        size: 10,
        uploaded: 1,
        filename: "Party Parrot.png",
      },
    ]),
    [
      [
        "imeta",
        "url https://b/a.png",
        "m image/png",
        "x abc",
        "size 10",
        "filename Party Parrot.png",
      ],
    ],
  );
});

test("formatImetaMediaLine: video mime → ![video] line (regardless of URL suffix)", () => {
  assert.equal(
    formatImetaMediaLine({ url: "https://cdn/blob/xyz", type: "video/mp4" }),
    "\n![video](https://cdn/blob/xyz)",
  );
});

test("formatImetaMediaLine: packaged voice note MP4 stays on the audio-card link path", () => {
  assert.equal(
    formatImetaMediaLine({
      url: "https://relay.example/media/hash.mp4",
      type: "video/mp4",
      filename: "voice-note-123.mp4",
    }),
    "\n[voice-note-123.mp4](https://relay.example/media/hash.mp4)",
  );
});

test("formatImetaMediaLine: generic mime → [filename](url) link", () => {
  assert.equal(
    formatImetaMediaLine({
      url: "https://b/blob",
      type: "application/pdf",
      filename: "report.pdf",
    }),
    "\n[report.pdf](https://b/blob)",
  );
});

test("formatImetaMediaLine: spoiler option does not wrap generic files", () => {
  assert.equal(
    formatImetaMediaLine(
      {
        url: "https://b/blob",
        type: "application/pdf",
        filename: "report.pdf",
      },
      { spoiler: true },
    ),
    "\n[report.pdf](https://b/blob)",
  );
});

test("formatImetaMediaLine: escapes markdown brackets/backslash in filename", () => {
  // `a].pdf` would otherwise close the link label early and break the FileCard.
  assert.equal(
    formatImetaMediaLine({
      url: "https://b/blob",
      type: "application/zip",
      filename: "a]b[c\\d.zip",
    }),
    "\n[a\\]b\\[c\\\\d.zip](https://b/blob)",
  );
});

test("buildImetaTags: omits absent optional fields", () => {
  const tags = buildImetaTags([
    {
      url: "https://b/a.png",
      type: "image/png",
      sha256: "x",
      size: 1,
      uploaded: 0,
    },
  ]);
  assert.deepEqual(tags, [
    ["imeta", "url https://b/a.png", "m image/png", "x x", "size 1"],
  ]);
});

// ── buildOutgoingMessage (shared body+tags builder for send + edit) ───

test("buildOutgoingMessage: empty pendingImeta returns body untouched and undefined mediaTags", () => {
  const out = buildOutgoingMessage("hello", []);
  assert.equal(out.content, "hello");
  assert.equal(out.mediaTags, undefined);
});

test("buildOutgoingMessage: appends media markdown line per attachment, in order", () => {
  const out = buildOutgoingMessage("hi", [
    {
      url: "https://b/a.png",
      type: "image/png",
      sha256: "x",
      size: 1,
      uploaded: 0,
    },
    {
      url: "https://b/v.mp4",
      type: "video/mp4",
      sha256: "y",
      size: 2,
      uploaded: 0,
    },
  ]);
  assert.equal(
    out.content,
    "hi\n![image](https://b/a.png)\n![video](https://b/v.mp4)",
  );
});

test("buildOutgoingMessage: agent snapshot PNG uses the snapshot-card link path", () => {
  const out = buildOutgoingMessage("", [
    {
      url: "https://b/analyst.png",
      type: "image/png",
      sha256: "x",
      size: 1,
      uploaded: 0,
      filename: "analyst.agent.png",
    },
  ]);
  assert.equal(out.content, "\n[analyst.agent.png](https://b/analyst.png)");
});

test("buildOutgoingMessage: team snapshot PNG uses the snapshot-card link path", () => {
  const out = buildOutgoingMessage("", [
    {
      url: "https://b/engineering.png",
      type: "image/png",
      sha256: "x",
      size: 1,
      uploaded: 0,
      filename: "engineering.team.png",
    },
  ]);
  assert.equal(
    out.content,
    "\n[engineering.team.png](https://b/engineering.png)",
  );
});

test("buildOutgoingMessage: copied agent snapshot keeps its display label", () => {
  const out = buildOutgoingMessage("", [
    {
      url: "https://b/analyst.png",
      type: "image/png",
      sha256: "x",
      size: 1,
      uploaded: 0,
      filename: "analyst.agent.png",
      displayLabel: "Animation Auditor",
    },
  ]);
  assert.equal(out.content, "\n[Animation Auditor](https://b/analyst.png)");
});

test("buildOutgoingMessage: wraps spoilered image and video attachments", () => {
  const out = buildOutgoingMessage(
    "hi",
    [
      {
        url: "https://b/a.png",
        type: "image/png",
        sha256: "x",
        size: 1,
        uploaded: 0,
      },
      {
        url: "https://b/v.mp4",
        type: "video/mp4",
        sha256: "y",
        size: 2,
        uploaded: 0,
      },
    ],
    new Set(["https://b/a.png", "https://b/v.mp4"]),
  );
  assert.equal(
    out.content,
    "hi\n||![image](https://b/a.png)||\n||![video](https://b/v.mp4)||",
  );
});

test("buildOutgoingMessage: mediaTags mirror buildImetaTags output for non-empty pending", () => {
  const pending = [
    {
      url: "https://b/a.png",
      type: "image/png",
      sha256: "abc",
      size: 99,
      uploaded: 0,
    },
  ];
  const out = buildOutgoingMessage("", pending);
  assert.deepEqual(out.mediaTags, buildImetaTags(pending));
});

test("buildImetaTags: omits hashless external media entirely", () => {
  const tags = buildImetaTags([
    {
      url: "https://static.klipy.com/a.gif",
      type: "image/gif",
      sha256: "",
      size: 1,
      uploaded: 0,
    },
  ]);
  assert.deepEqual(tags, []);
});

test("buildOutgoingMessage: hashless external media is content-only", () => {
  const out = buildOutgoingMessage("", [
    {
      url: "https://static.klipy.com/a.gif",
      type: "image/gif",
      sha256: "",
      size: 1,
      uploaded: 0,
    },
  ]);
  assert.equal(out.content, "\n![image](https://static.klipy.com/a.gif)");
  assert.equal(out.mediaTags, undefined);
});

test("buildImetaTags: omits size line when size is 0", () => {
  const tags = buildImetaTags([
    {
      url: "https://b/a.png",
      type: "image/png",
      sha256: "deadbeef",
      size: 0,
      uploaded: 0,
    },
  ]);
  assert.equal(tags.length, 1);
  assert.ok(
    !tags[0].some((part) => /^size[\s\t]/.test(part)),
    `expected no size line, got ${JSON.stringify(tags[0])}`,
  );
});

const IMETA = ["imeta", "url https://blossom/abc.png", "m image/png"];
const EMOJI_A = ["emoji", "shipit", "https://relay/s.png"];
const EMOJI_B = ["emoji", "party", "https://relay/p.gif"];
const LINK_PREVIEW = ["link-preview", "snapshot", "1", "https://example.com/"];
const MENTION_REF = [
  "mention",
  "1111111111111111111111111111111111111111111111111111111111111111",
];

test("splitOutgoingTags: undefined input yields three empty arrays", () => {
  assert.deepEqual(splitOutgoingTags(undefined), {
    mediaTags: [],
    emojiTags: [],
    mentionTags: [],
    linkPreviewTags: [],
  });
});

test("splitOutgoingTags: separates emoji tags from imeta tags", () => {
  const { mediaTags, emojiTags, mentionTags, linkPreviewTags } =
    splitOutgoingTags([IMETA, EMOJI_A, EMOJI_B]);
  assert.deepEqual(mediaTags, [IMETA]);
  assert.deepEqual(emojiTags, [EMOJI_A, EMOJI_B]);
  assert.deepEqual(mentionTags, []);
  assert.deepEqual(linkPreviewTags, []);
});

test("splitOutgoingTags: emoji-only set leaves mediaTags empty", () => {
  const { mediaTags, emojiTags, mentionTags, linkPreviewTags } =
    splitOutgoingTags([EMOJI_A]);
  assert.deepEqual(mediaTags, []);
  assert.deepEqual(emojiTags, [EMOJI_A]);
  assert.deepEqual(mentionTags, []);
  assert.deepEqual(linkPreviewTags, []);
});

test("splitOutgoingTags: separates reference-only mention tags", () => {
  const { mediaTags, emojiTags, mentionTags, linkPreviewTags } =
    splitOutgoingTags([IMETA, MENTION_REF, EMOJI_A]);
  assert.deepEqual(mediaTags, [IMETA]);
  assert.deepEqual(emojiTags, [EMOJI_A]);
  assert.deepEqual(mentionTags, [MENTION_REF]);
  assert.deepEqual(linkPreviewTags, []);
});

test("splitOutgoingTags: separates authored link-preview snapshots", () => {
  const { mediaTags, emojiTags, mentionTags, linkPreviewTags } =
    splitOutgoingTags([IMETA, LINK_PREVIEW]);
  assert.deepEqual(mediaTags, [IMETA]);
  assert.deepEqual(emojiTags, []);
  assert.deepEqual(mentionTags, []);
  assert.deepEqual(linkPreviewTags, [LINK_PREVIEW]);
});

test("splitOutgoingTags: unknown prefixes stay with mediaTags (injection defense)", () => {
  // A forged ["p", ...] must NOT be misrouted to the emoji channel; it stays on
  // mediaTags where the server-side imeta guard rejects it.
  const forged = ["p", "deadbeef"];
  const { mediaTags, emojiTags, mentionTags, linkPreviewTags } =
    splitOutgoingTags([forged, EMOJI_A]);
  assert.deepEqual(mediaTags, [forged]);
  assert.deepEqual(emojiTags, [EMOJI_A]);
  assert.deepEqual(mentionTags, []);
  assert.deepEqual(linkPreviewTags, []);
});

test("splitOutgoingTags is the inverse of mergeOutgoingTags", () => {
  const merged = mergeOutgoingTags([IMETA], [EMOJI_A, EMOJI_B]);
  const { mediaTags, emojiTags, mentionTags, linkPreviewTags } =
    splitOutgoingTags(merged);
  assert.deepEqual(mediaTags, [IMETA]);
  assert.deepEqual(emojiTags, [EMOJI_A, EMOJI_B]);
  assert.deepEqual(mentionTags, []);
  assert.deepEqual(linkPreviewTags, []);
});
