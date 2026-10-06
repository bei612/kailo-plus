import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NotificationSettingsCard } from "./NotificationSettingsCard";
import { DEFAULT_SLOT_SOUNDS, DEFAULT_SLOT_ALERTS_ENABLED } from "@/features/notifications/lib/sound";

test("original notification controls render Chinese by default without losing controls", () => {
  const markup = renderToStaticMarkup(createElement(NotificationSettingsCard, {
    isUpdatingDesktopNotifications: false,
    notificationErrorMessage: null,
    notificationPermission: "granted",
    notificationSettings: {
      desktopEnabled: true, homeBadgeEnabled: true, notifyWhileViewing: false,
      sounds: DEFAULT_SLOT_SOUNDS, slotAlertsEnabled: DEFAULT_SLOT_ALERTS_ENABLED,
      slotAlertsSnapshot: null,
    },
    onSetDesktopNotificationsEnabled: async () => true,
    onSetAllSlotAlertsEnabled() {}, onSetHomeBadgeEnabled() {},
    onSetSlotAlertsEnabled() {}, onSetNotifyWhileViewing() {}, onSetSoundForSlot() {},
  }));
  for (const text of ["通知", "桌面提醒", "正在查看时也提醒", "提示音", "@提及", "线程回复", "首页角标"]) {
    assert.ok(markup.includes(text), text);
  }
  for (const id of ["desktop-toggle", "notify-while-viewing-toggle", "sound-toggle", "alerts-enabled-mention", "alerts-enabled-thread_reply", "home-badge-toggle"]) {
    assert.ok(markup.includes(`notifications-${id}`), id);
  }
  assert.ok(!markup.includes("Desktop alerts"));
});
