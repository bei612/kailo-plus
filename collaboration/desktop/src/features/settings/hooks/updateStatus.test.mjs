import assert from "node:assert/strict";
import test from "node:test";

import {
  canRunBackgroundCheck,
  isUpdaterUnavailable,
  toErrorMessage,
} from "./updateStatus.ts";

test("a build without the injected feed reports the original unavailable state, not an error", () => {
  assert.equal(isUpdaterUnavailable("plugin updater not found"), true);
  assert.equal(isUpdaterUnavailable("updater not initialized"), true);
  assert.equal(isUpdaterUnavailable("signature verification failed"), false);
  assert.equal(toErrorMessage(new Error("boom")), "boom");
  assert.equal(toErrorMessage("plain"), "plain");
});

test("background checks never interrupt an update in progress", () => {
  for (const state of ["idle", "up-to-date", "unavailable", "error"]) {
    assert.equal(canRunBackgroundCheck({ state }), true, state);
  }
  for (const state of ["checking", "available", "downloading", "installing", "ready", "manual-required"]) {
    assert.equal(canRunBackgroundCheck({ state }), false, state);
  }
});
