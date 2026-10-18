// @vitest-environment jsdom
import { expect, it } from "vitest";
import { applyThreadPreferences } from "./inbox-snapshot";

const root = (n: number) => n.toString(16).padStart(64, "0");

it("adds followed roots and drops muted ones from the original Inbox interest set", () => {
  const roots = applyThreadPreferences(new Set([root(1), root(2)]), {
    [`thread:${root(2)}`]: { state: "MUTED", updatedAt: "2026-10-18T00:00:00Z" },
    [`thread:${root(3)}`]: { state: "FOLLOWED", updatedAt: "2026-10-18T00:00:00Z" },
  });
  expect([...roots].sort()).toEqual([root(1), root(3)]);
  expect([...applyThreadPreferences(new Set([root(1)]), undefined)]).toEqual([root(1)]);
});
