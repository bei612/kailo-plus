// DD-159: the local archive card's pure model.
import assert from "node:assert/strict";
import { test } from "node:test";
import { translate } from "@client-kit/platform/i18n";
import {
  ARCHIVE_KIND_GROUPS, groupsForKinds, kindsForGroups, subscribableChannels, summarizeSync, formatArchiveBytes,
} from "./localArchiveModel.ts";

const channel = (id, name, extra = {}) => ({ id, name, isMember: true, archivedAt: null, ...extra });

test("offers only the archivable kinds; no observer, metric or huddle kinds", () => {
  const all = ARCHIVE_KIND_GROUPS.flatMap((group) => group.kinds);
  for (const excluded of [24200, 44200, 48100, 48101, 48102, 48103]) assert.equal(all.includes(excluded), false);
  assert.deepEqual(kindsForGroups(["messages", "aux"]), [5, 7, 9, 9005, 40002, 40003, 45001, 45003]);
  assert.deepEqual(groupsForKinds([9, 7]), ["messages", "aux"]);
  for (const group of ARCHIVE_KIND_GROUPS) {
    assert.notEqual(translate("en", group.label), group.label);
    assert.notEqual(translate("zh-CN", group.label), group.label);
  }
});

test("only current, unarchived memberships not yet subscribed can be added", () => {
  const list = subscribableChannels([
    channel("b", "beta"), channel("a", "alpha"), channel("x", "left", { isMember: false }),
    channel("z", "old", { archivedAt: "2026-01-01" }), channel("s", "sub"),
  ], ["s"]);
  assert.deepEqual(list.map((c) => c.id), ["a", "b"]);
});

test("sync summary never hides access loss or identity refusal", () => {
  assert.equal(summarizeSync([{ channelId: "a", result: "ok", stored: 2 }, { channelId: "b", result: "identity_rejected", stored: 0 }]).key,
    "localArchive.sync.identityRejected");
  const lost = summarizeSync([{ channelId: "a", result: "access_lost", stored: 0 }, { channelId: "b", result: "retry", stored: 0 }]);
  assert.deepEqual([lost.key, lost.variables.count, lost.tone], ["localArchive.sync.accessLost", "1", "negative"]);
  const retry = summarizeSync([{ channelId: "a", result: "retry", stored: 0 }]);
  assert.deepEqual([retry.key, retry.tone], ["localArchive.sync.retry", "neutral"]);
  const done = summarizeSync([{ channelId: "a", result: "ok", stored: 3 }, { channelId: "b", result: "ok", stored: 4 }]);
  assert.deepEqual([done.key, done.variables.count], ["localArchive.sync.done", "7"]);
  for (const s of [lost, retry, done]) assert.match(translate("zh-CN", s.key, s.variables), /\d/);
});

test("formats the on-device size", () => {
  assert.equal(formatArchiveBytes(512), "512 B");
  assert.equal(formatArchiveBytes(2048), "2.0 KB");
  assert.equal(formatArchiveBytes(3 * 1024 * 1024), "3.0 MB");
});
