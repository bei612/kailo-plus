import assert from "node:assert/strict";
import test from "node:test";

import {
  replaceWithDraftMentionRefs,
  snapshotDraftMentionRefs,
} from "./draftMentionRefs.ts";
import { extractMentionPubkeys } from "./extractMentionPubkeys.ts";
import { buildMentionPattern } from "../../../shared/lib/mentionPattern.ts";

const ALICE = "a".repeat(64);
const BOB = "b".repeat(64);

test("draft snapshots and explicit extraction agree on longest selected or typed occurrences", () => {
  for (const longer of ["Scout Jones", `Scout (${BOB})`, `Scout (${BOB}) 12`]) {
    const mentions = new Map([
      ["Scout", ALICE],
      [longer, BOB],
    ]);
    for (const text of [
      `@${longer}!`,
      `(@${longer})`,
      `**@${longer}**`,
      `@${longer}, hello`,
    ]) {
      assert.deepEqual(
        snapshotDraftMentionRefs(text, mentions).map((ref) => ref.pubkey),
        [BOB],
      );
      assert.deepEqual(
        extractMentionPubkeys({
          text,
          selectedMentions: mentions,
          memberCandidates: [],
        }),
        [BOB],
      );
    }
  }
  const members = [{ displayName: "Scout Jones", pubkey: BOB, isMember: true }];
  assert.deepEqual(
    snapshotDraftMentionRefs(
      "@Scout Jones",
      new Map([["Scout", ALICE]]),
      members,
    ),
    [],
  );
  assert.deepEqual(
    snapshotDraftMentionRefs("`@Scout`", new Map([["Scout", ALICE]])),
    [],
  );
});

test("an unbound qualified label cannot fall back to a shorter recipient", () => {
  const bindings = new Map([["Scout", ALICE]]);
  const text = `@Scout (${BOB}) hello`;
  assert.deepEqual(snapshotDraftMentionRefs(text, bindings), []);
  assert.deepEqual(
    extractMentionPubkeys({
      text,
      selectedMentions: bindings,
      memberCandidates: [],
    }),
    [],
  );
  assert.equal(buildMentionPattern(["Scout"]).test(text), false);
});

test("fallback keeps missing-profile refs but current same-name selection wins", () => {
  const originalRef = { displayName: "Scout", pubkey: ALICE };
  assert.deepEqual(
    snapshotDraftMentionRefs("@Scout hello", new Map(), [], [originalRef]),
    [originalRef],
  );
  assert.deepEqual(
    snapshotDraftMentionRefs(
      "@Scout hello",
      new Map([["Scout", BOB]]),
      [],
      [originalRef],
    ),
    [{ displayName: "Scout", pubkey: BOB }],
  );
  assert.deepEqual(
    snapshotDraftMentionRefs(
      "@Scout Jones hello",
      new Map(),
      [],
      [originalRef],
      ["Scout Jones"],
    ),
    [],
  );
});

test("restoring draft refs replaces bindings and returns their labels", () => {
  const bindings = new Map([["Old", BOB]]);
  assert.deepEqual(
    replaceWithDraftMentionRefs(
      [{ displayName: " Alice ", pubkey: ALICE.toUpperCase() }],
      bindings,
    ),
    ["Alice"],
  );
  assert.deepEqual([...bindings], [["Alice", ALICE]]);
});
