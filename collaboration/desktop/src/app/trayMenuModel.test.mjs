import assert from "node:assert/strict";
import test from "node:test";
import { translate } from "@client-kit/platform/i18n";

import {
  MAX_RECENT_TRAY_ACTIVITIES,
  buildTrayActivities,
  nextRecentActivities,
  trayMenuLabels,
} from "./trayMenuModel.ts";

const A = "a".repeat(64);
const B = "B".repeat(64);
const en = (key, variables) => translate("en", key, variables);
const zh = (key, variables) => translate("zh-CN", key, variables);
const elapsed = (ms) => `${Math.floor(ms / 1000)}s`;

test("tray rows come from admitted working Agents; only audited turns show elapsed time", () => {
  const rows = buildTrayActivities(
    [
      { channelId: "c1", anchorAt: 1_000, source: "turn", agentPubkeys: [A, B] },
      { channelId: "c2", anchorAt: 5_000, source: "typing", agentPubkeys: [A] },
    ],
    new Map([["c1", "planning"]]),
    {
      agentName: (channelId, pubkey) => (channelId === "c1" && pubkey === A ? "Scout" : undefined),
      agentAnchor: (channelId, pubkey) => (channelId === "c1" && pubkey === A ? 2_000 : undefined),
    },
    62_000,
    en,
    elapsed,
  );
  assert.deepEqual(rows.map((row) => row.activityId), [`c1:${A}`, `c1:${B.toLowerCase()}`, `c2:${A}`]);
  assert.equal(rows[0].agentName, "Scout");
  assert.equal(rows[0].elapsed, "60s");
  assert.equal(rows[0].channelName, "planning");
  // A folded typing-only Agent and a typing-only channel never guess an elapsed time.
  assert.equal(rows[1].elapsed, "Working");
  assert.match(rows[1].agentName, /^Agent bbbbbbbb…bbbb$/);
  assert.equal(rows[2].elapsed, "Working");
  assert.equal(rows[2].channelName, "Unknown channel");
  const zhRows = buildTrayActivities(
    [{ channelId: "c2", anchorAt: 0, source: "typing", agentPubkeys: [A] }],
    new Map(), { agentName: () => undefined, agentAnchor: () => undefined }, 0, zh, elapsed);
  assert.equal(zhRows[0].elapsed, "工作中");
  assert.equal(zhRows[0].channelName, "未知频道");
});

test("finished rows move to Recent, newest first and capped", () => {
  const row = (id) => ({ activityId: id, agentName: id, channelId: "c", channelName: "c", elapsed: "1s" });
  const previous = new Map(["x", "y"].map((id) => [id, row(id)]));
  const recent = Array.from({ length: MAX_RECENT_TRAY_ACTIVITIES }, (_, index) => row(`old-${index}`));
  const next = nextRecentActivities(previous, [row("y")], recent, 42);
  assert.equal(next.length, MAX_RECENT_TRAY_ACTIVITIES);
  assert.equal(next[0].activityId, "recent:x:42");
  assert.equal(next.at(-1).activityId, `old-${MAX_RECENT_TRAY_ACTIVITIES - 2}`);
  assert.deepEqual(nextRecentActivities(new Map(), [row("y")], recent, 43), recent);
});

test("fixed labels are localized and carry only the deployment's display name", () => {
  assert.deepEqual(trayMenuLabels("en", null, translate), {
    running: "Running",
    noAgents: "No agents are running",
    recent: "Recent",
    newChannel: "New Channel",
    openApp: "Open",
    quitApp: "Quit",
  });
  const named = trayMenuLabels("zh-CN", "  Kailo ", translate);
  assert.equal(named.openApp, "打开Kailo");
  assert.equal(named.quitApp, "退出Kailo");
  assert.equal(named.newChannel, "新建频道");
  assert.equal(trayMenuLabels("en", "   ", translate).openApp, "Open");
});
