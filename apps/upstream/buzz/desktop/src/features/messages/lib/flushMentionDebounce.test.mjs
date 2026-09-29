import assert from "node:assert/strict";
import test from "node:test";

import { flushMentionDebounce, isPlainSpace } from "./flushMentionDebounce.ts";

function ref(current) {
  return { current };
}

function candidate(overrides = {}) {
  return {
    displayName: "Beta",
    isMember: true,
    pubkey: "b".repeat(64),
    ...overrides,
  };
}

test("isPlainSpace accepts only an unmodified Space outside composition", () => {
  const event = {
    altKey: false,
    ctrlKey: false,
    isComposing: false,
    key: " ",
    metaKey: false,
    shiftKey: false,
  };
  assert.equal(isPlainSpace(event), true);
  assert.equal(isPlainSpace({ ...event, ctrlKey: true }), false);
  assert.equal(isPlainSpace({ ...event, shiftKey: true }), false);
  assert.equal(isPlainSpace({ ...event, isComposing: true }), false);
  assert.equal(isPlainSpace({ ...event, key: "Enter" }), false);
});

test("flushMentionDebounce returns the fresh suggestion with its fresh start index", () => {
  const debounceTimerRef = ref(setTimeout(() => {}, 1000));

  const flushed = flushMentionDebounce({
    debounceTimerRef,
    latestValueRef: ref("@Alpha @be"),
    latestCursorRef: ref("@Alpha @be".length),
    searchableNamesLowerRef: ref(["alpha", "beta"]),
    candidates: [
      candidate({ displayName: "Alpha", pubkey: "a".repeat(64) }),
      candidate({ displayName: "Beta", pubkey: "b".repeat(64) }),
    ],
  });

  assert.equal(debounceTimerRef.current, null);
  assert.equal(flushed?.type, "match");
  assert.equal(flushed?.suggestion.displayName, "Beta");
  assert.equal(flushed?.startIndex, 7);
});

test("flushMentionDebounce returns no-match for a fresh query with no matches", () => {
  const flushed = flushMentionDebounce({
    debounceTimerRef: ref(setTimeout(() => {}, 1000)),
    latestValueRef: ref("@Alpha @zzzq"),
    latestCursorRef: ref("@Alpha @zzzq".length),
    searchableNamesLowerRef: ref(["alpha", "beta"]),
    candidates: [candidate()],
  });

  assert.deepEqual(flushed, { type: "no-match" });
});

test("flushMentionDebounce returns null for an empty fresh query", () => {
  const flushed = flushMentionDebounce({
    debounceTimerRef: ref(setTimeout(() => {}, 1000)),
    latestValueRef: ref("@"),
    latestCursorRef: ref("@".length),
    searchableNamesLowerRef: ref(["alpha", "beta"]),
    candidates: [candidate()],
  });

  assert.equal(flushed, null);
});

test("flushMentionDebounce resolves an exact typed mention for Space", () => {
  const flushed = flushMentionDebounce({
    debounceTimerRef: ref(null),
    latestValueRef: ref("Ask @Beta"),
    latestCursorRef: ref("Ask @Beta".length),
    searchableNamesLowerRef: ref(["beta"]),
    candidates: [candidate()],
    requireExact: true,
  });

  assert.equal(flushed?.type, "match");
  assert.equal(flushed?.suggestion.displayName, "Beta");
  assert.equal(flushed?.startIndex, 4);
});

test("flushMentionDebounce resolves an exact typed mention in any case", () => {
  const flushed = flushMentionDebounce({
    debounceTimerRef: ref(null),
    latestValueRef: ref("Ask @BETA"),
    latestCursorRef: ref("Ask @BETA".length),
    searchableNamesLowerRef: ref(["beta"]),
    candidates: [candidate()],
    requireExact: true,
  });

  // Casing is what tells a committed mention apart from literal text: the
  // commit rewrites the draft to the candidate's canonical display name.
  assert.equal(flushed?.type, "match");
  assert.equal(flushed?.suggestion.displayName, "Beta");
});

test("flushMentionDebounce does not complete a partial name for Space", () => {
  const flushed = flushMentionDebounce({
    debounceTimerRef: ref(null),
    latestValueRef: ref("Ask @Bet"),
    latestCursorRef: ref("Ask @Bet".length),
    searchableNamesLowerRef: ref(["beta"]),
    candidates: [candidate()],
    requireExact: true,
  });

  assert.equal(flushed, null);
});

test("flushMentionDebounce leaves an exact prefix open for a longer name", () => {
  const flushed = flushMentionDebounce({
    debounceTimerRef: ref(null),
    latestValueRef: ref("Ask @Beta"),
    latestCursorRef: ref("Ask @Beta".length),
    searchableNamesLowerRef: ref(["beta", "beta tester"]),
    candidates: [
      candidate(),
      candidate({
        displayName: "Beta Tester",
        pubkey: "c".repeat(64),
      }),
    ],
    requireExact: true,
  });

  assert.equal(flushed, null);
});

test("flushMentionDebounce resolves the complete longer name", () => {
  const flushed = flushMentionDebounce({
    debounceTimerRef: ref(null),
    latestValueRef: ref("Ask @Beta Tester"),
    latestCursorRef: ref("Ask @Beta Tester".length),
    searchableNamesLowerRef: ref(["beta", "beta tester"]),
    candidates: [
      candidate(),
      candidate({
        displayName: "Beta Tester",
        pubkey: "c".repeat(64),
      }),
    ],
    requireExact: true,
  });

  assert.equal(flushed?.type, "match");
  assert.equal(flushed?.suggestion.displayName, "Beta Tester");
});
