import assert from "node:assert/strict";
import test from "node:test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

import {
  collectMessageAuthorPubkeys,
  formatTimelineMessages,
  isTimelineContentEvent,
} from "./formatTimelineMessages.ts";
import { CHANNEL_AUX_EVENT_KINDS, CHANNEL_EVENT_KINDS, CHANNEL_MESSAGE_EVENT_KINDS, CHANNEL_TIMELINE_CONTENT_KINDS } from "@/shared/constants/kinds";

const HEX64_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PUBKEY_A =
  "1111111111111111111111111111111111111111111111111111111111111111";
const PUBKEY_B =
  "2222222222222222222222222222222222222222222222222222222222222222";
const RELAY_SECRET = new Uint8Array(32).fill(3);
const RELAY_PUBKEY = getPublicKey(RELAY_SECRET);
const CHANNEL_ID = "36411e44-0e2d-4cfe-bd6e-567eb169db9f";

test("original reactions reach Native message rows without trusting actor impersonation", () => {
  const message = streamMessage();
  const reaction = streamMessage({id:"b".repeat(64),pubkey:PUBKEY_B,kind:7,content:"👍",
    tags:[["e",message.id],["actor",PUBKEY_A]]});
  const rows = formatTimelineMessages([message,reaction],PUBKEY_A,null);
  assert.equal(rows.length,1);
  assert.equal(rows[0].reactions[0].count,1);
  assert.equal(rows[0].reactions[0].reactedByCurrentUser,false);
  assert.equal(rows[0].reactions[0].users[0].pubkey,PUBKEY_B);
});

function streamMessage(overrides = {}) {
  return {
    id: HEX64_A,
    pubkey: PUBKEY_A,
    kind: 9,
    created_at: 1_700_000_000,
    content: "hello world",
    tags: [["h", CHANNEL_ID]],
    sig: "sig",
    ...overrides,
  };
}

test("user-signed actor tag does not affect timeline identity or profile loading", () => {
  const events = [
    streamMessage({
      tags: [
        ["h", CHANNEL_ID],
        ["actor", PUBKEY_B],
      ],
    }),
  ];

  const profiles = {
    [PUBKEY_A]: {
      displayName: "Real signer",
      avatarUrl: "https://example.test/signer.png",
      nip05Handle: null,
      ownerPubkey: null,
    },
    [PUBKEY_B]: {
      displayName: "Spoofed admin",
      avatarUrl: "https://example.test/admin.png",
      nip05Handle: null,
      ownerPubkey: null,
    },
  };
  const members = [
    {
      pubkey: PUBKEY_A,
      role: "member",
      isAgent: false,
      joinedAt: "2026-01-01T00:00:00Z",
      displayName: "Real signer",
    },
    {
      pubkey: PUBKEY_B,
      role: "owner",
      isAgent: false,
      joinedAt: "2026-01-01T00:00:00Z",
      displayName: "Spoofed admin",
    },
  ];

  assert.deepEqual(collectMessageAuthorPubkeys(events, RELAY_PUBKEY), [
    PUBKEY_A,
  ]);

  const [message] = formatTimelineMessages(
    events,
    undefined,
    null,
    profiles,
    members,
    RELAY_PUBKEY,
  );

  assert.equal(message.pubkey, PUBKEY_A);
  assert.equal(message.signerPubkey, PUBKEY_A);
  assert.equal(message.author, "Real signer");
  assert.equal(message.avatarUrl, "https://example.test/signer.png");
  assert.equal(message.role, "member");
});

test("relay-signed actor tag resolves the delegated timeline author", () => {
  const event = finalizeEvent(
    {
      kind: 9,
      created_at: 1_700_000_000,
      content: "hello world",
      tags: [
        ["h", CHANNEL_ID],
        ["actor", PUBKEY_B],
      ],
    },
    RELAY_SECRET,
  );
  const profiles = {
    [PUBKEY_B]: {
      displayName: "Delegated user",
      avatarUrl: "https://example.test/delegated.png",
      nip05Handle: null,
      ownerPubkey: null,
    },
  };

  const [message] = formatTimelineMessages(
    [event],
    undefined,
    null,
    profiles,
    undefined,
    RELAY_PUBKEY,
  );

  assert.equal(message.pubkey, PUBKEY_B);
  assert.equal(message.signerPubkey, RELAY_PUBKEY);
  assert.equal(message.author, "Delegated user");
});

test("original message link-preview none marker suppresses all generated previews", () => {
  const [message] = formatTimelineMessages(
    [
      streamMessage({
        content: "https://one.example https://two.example",
        tags: [
          ["h", CHANNEL_ID],
          ["link-preview", "none"],
        ],
      }),
    ],
    undefined,
    null,
  );
  assert.deepEqual(
    message.tags.find((tag) => tag[0] === "link-preview"),
    ["link-preview", "none"],
  );
});

test("stream messages, original diffs and system rows render as timeline rows", () => {
  assert.equal(isTimelineContentEvent({ kind: 9 }), true);
  assert.equal(isTimelineContentEvent({ kind: 40002 }), true);
  assert.equal(isTimelineContentEvent({ kind: 40008 }), true);
  assert.equal(isTimelineContentEvent({ kind: 40099 }), true);
  assert.equal(isTimelineContentEvent({ kind: 7 }), false);
  assert.equal(isTimelineContentEvent({ kind: 40003 }), false);
});

test("original diff is independent visible content, not an edit or a recency trigger", () => {
  assert.equal(CHANNEL_TIMELINE_CONTENT_KINDS.includes(40008), true);
  assert.equal(CHANNEL_EVENT_KINDS.includes(40008), true);
  assert.equal(CHANNEL_AUX_EVENT_KINDS.includes(40008), false);
  assert.equal(CHANNEL_MESSAGE_EVENT_KINDS.includes(40008), false);
  const original = streamMessage();
  const diff = streamMessage({ id: "c".repeat(64), kind: 40008, content: "diff --git a/a b/a", tags: [["h", CHANNEL_ID], ["e", original.id], ["file", "a"]] });
  const rows = formatTimelineMessages([original, diff], PUBKEY_A, null);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.id === original.id).body, "hello world");
  assert.equal(rows.find(row => row.id === diff.id).kind, 40008);
  assert.equal(rows.find(row => row.id === diff.id).body, diff.content);
  assert.deepEqual(collectMessageAuthorPubkeys([diff], RELAY_PUBKEY), [PUBKEY_A]);
});

test("relay deletion markers hide their target message", () => {
  const target = "a".repeat(64);
  for (const kind of [5, 9005]) {
    const messages = formatTimelineMessages(
      [
        streamMessage({ id: target }),
        {
          id: "b".repeat(64),
          pubkey: PUBKEY_A,
          kind,
          created_at: 1_700_000_001,
          content: "",
          tags: [
            ["h", CHANNEL_ID],
            ["e", target],
          ],
          sig: "sig",
        },
      ],
      undefined,
      null,
    );
    assert.deepEqual(messages, []);
  }
});
