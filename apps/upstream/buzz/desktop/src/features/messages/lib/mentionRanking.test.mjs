import assert from "node:assert/strict";
import test from "node:test";

import { rankMentionCandidates } from "./mentionRanking.ts";

const EXACT = "1".repeat(64);
const OTHER = "2".repeat(64);

function candidate(overrides = {}) {
  return { displayName: "Brain", pubkey: OTHER, ...overrides };
}

function rankedPubkeys(candidates, query = "brain") {
  return rankMentionCandidates(candidates, query).map(
    (item) => item.candidate.pubkey,
  );
}

test("rankMentionCandidates: exact and prefix quality sort candidates", () => {
  const wordPrefix = candidate({
    displayName: "The Brain",
    pubkey: "3".repeat(64),
  });
  const exact = candidate({ displayName: "Brain", pubkey: EXACT });
  const prefix = candidate({ displayName: "Brainiac", pubkey: "4".repeat(64) });

  assert.deepEqual(rankedPubkeys([wordPrefix, exact, prefix]), [
    EXACT,
    "4".repeat(64),
    "3".repeat(64),
  ]);
});

test("rankMentionCandidates: matching secondary labels participate in ranking", () => {
  const byHandle = candidate({
    displayName: "Acme",
    secondaryLabel: "brain@example.com",
    pubkey: EXACT,
  });
  const nonMatching = candidate({ displayName: "Pinky", pubkey: OTHER });

  assert.deepEqual(rankedPubkeys([nonMatching, byHandle]), [EXACT]);
});

test("rankMentionCandidates: pubkey prefixes match after labels", () => {
  const byName = candidate({ displayName: "111 fan", pubkey: OTHER });
  const byKey = candidate({ displayName: "Zed", pubkey: EXACT });

  assert.deepEqual(rankedPubkeys([byKey, byName], "111"), [OTHER, EXACT]);
});
