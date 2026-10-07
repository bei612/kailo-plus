// Original Buzz 779af8886caae1317b4de962082429867ab61503 assertions, run through the shared Vitest entry.
import assert from "node:assert/strict";
import { test } from "vitest";

import { selectSettleGatedMessages } from "../src/react/messages/timeline/useSettleGatedPrependMessages";

const rows = (...ids: string[]) => ids.map((id) => ({ id }));

test("holds a pure older-history prepend", () => {
  const decision = selectSettleGatedMessages({
    admitted: rows("a", "b", "c"),
    next: rows("older-1", "older-2", "a", "b", "c"),
  });
  assert.ok(decision.kind === "hold");
  assert.deepEqual(
    decision.held.map(({ id }) => id),
    ["a", "b", "c"],
  );
});

test("held snapshot uses refreshed row objects for the admitted ids", () => {
  const editedA = { id: "a", edited: true };
  const decision = selectSettleGatedMessages({
    admitted: rows("a", "b"),
    next: [{ id: "older-1" }, editedA, { id: "b" }],
  });
  assert.ok(decision.kind === "hold");
  assert.equal(decision.held[0], editedA);
});

test("passes appends through immediately", () => {
  assert.equal(
    selectSettleGatedMessages({
      admitted: rows("a", "b"),
      next: rows("a", "b", "c"),
    }).kind,
    "pass",
  );
});

test("passes a simultaneous prepend+append (own send) through", () => {
  assert.equal(
    selectSettleGatedMessages({
      admitted: rows("a", "b"),
      next: rows("older-1", "a", "b", "sent"),
    }).kind,
    "pass",
  );
});

test("passes deletions inside the admitted window through", () => {
  assert.equal(
    selectSettleGatedMessages({
      admitted: rows("a", "b", "c"),
      next: rows("older-1", "a", "c"),
    }).kind,
    "pass",
  );
});

test("passes authoritative replacements through", () => {
  assert.equal(
    selectSettleGatedMessages({
      admitted: rows("a", "b"),
      next: rows("x", "y"),
    }).kind,
    "pass",
  );
});

test("passes identical snapshots through", () => {
  assert.equal(
    selectSettleGatedMessages({
      admitted: rows("a", "b"),
      next: rows("a", "b"),
    }).kind,
    "pass",
  );
});

test("passes when the previous snapshot was empty (initial load)", () => {
  assert.equal(
    selectSettleGatedMessages({
      admitted: [],
      next: rows("a", "b"),
    }).kind,
    "pass",
  );
});
