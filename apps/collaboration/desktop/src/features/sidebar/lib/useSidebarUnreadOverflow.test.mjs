import assert from "node:assert/strict";
import test from "node:test";

import {
  hasHighPriorityOverflow,
  sidebarOverflowUnreadLabel,
} from "./useSidebarUnreadOverflow.ts";

test("labels the destination total as unread", () => {
  assert.equal(sidebarOverflowUnreadLabel(3), "3 unread");
});

test("promotes offscreen actionable unread", () => {
  const actionable = new Set(["mention"]);

  assert.equal(hasHighPriorityOverflow(["channel"], actionable), false);
  assert.equal(hasHighPriorityOverflow(["mention"], actionable), true);
  assert.equal(
    hasHighPriorityOverflow(["channel", "mention"], actionable),
    true,
  );
});
