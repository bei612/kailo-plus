import assert from "node:assert/strict";
import test from "node:test";

import { buildMentionCandidates } from "./buildMentionCandidates.ts";

const MEMBER_PUBKEY = "a".repeat(64);
const OTHER_PUBKEY = "b".repeat(64);

test("roster entries become deduplicated member candidates", () => {
  const candidates = buildMentionCandidates({
    members: [
      {
        pubkey: MEMBER_PUBKEY.toUpperCase(),
        displayName: "Ada",
        role: "admin",
      },
      { pubkey: MEMBER_PUBKEY, displayName: "Ada again", role: "member" },
    ],
    profiles: undefined,
  });

  assert.deepEqual(candidates, [
    {
      pubkey: MEMBER_PUBKEY,
      displayName: "Ada",
      avatarUrl: null,
      isMember: true,
      role: "admin",
      secondaryLabel: null,
    },
  ]);
});

test("profiles supply names, avatars and NIP-05 secondary labels", () => {
  const [candidate] = buildMentionCandidates({
    members: [{ pubkey: OTHER_PUBKEY, displayName: null, role: "member" }],
    profiles: {
      [OTHER_PUBKEY]: {
        displayName: "Grace",
        avatarUrl: "https://example.com/grace.png",
        nip05Handle: "grace@example.com",
      },
    },
  });

  assert.equal(candidate.displayName, "Grace");
  assert.equal(candidate.avatarUrl, "https://example.com/grace.png");
  assert.equal(candidate.secondaryLabel, "grace@example.com");
});
