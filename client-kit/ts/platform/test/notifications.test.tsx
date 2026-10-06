import { act, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { useNotificationSettings, NotificationSettingsCard, type NotificationHost } from "../src/react/notifications";
import { render, click } from "./render";

describe("shared original notification settings", () => {
  it("requests permission only from the control and restores granular sound slots", async () => {
    localStorage.clear();
    const permission: NotificationHost = { getPermission: vi.fn(async () => "default" as const), requestPermission: vi.fn(async () => "granted" as const) };
    let actual!: ReturnType<typeof useNotificationSettings>;
    function Harness() {
      actual = useNotificationSettings("actor", permission);
      return <NotificationSettingsCard notificationSettings={actual.settings} notificationPermission={actual.permission}
        notificationErrorMessage={actual.errorMessage} isUpdatingDesktopNotifications={actual.isUpdatingDesktopEnabled}
        onSetDesktopNotificationsEnabled={actual.setDesktopEnabled} onSetAllSlotAlertsEnabled={actual.setAllSlotAlertsEnabled}
        onSetHomeBadgeEnabled={actual.setHomeBadgeEnabled} onSetSlotAlertsEnabled={actual.setSlotAlertsEnabled}
        onSetNotifyWhileViewing={actual.setNotifyWhileViewing} onSetSoundForSlot={actual.setSoundForSlot} />;
    }
    const view = await render(<Harness />);
    expect(permission.requestPermission).not.toHaveBeenCalled();
    await act(async () => { await actual.setDesktopEnabled(false); });
    await click(view.querySelector<HTMLButtonElement>('[data-testid="notifications-desktop-toggle"]')!);
    expect(permission.requestPermission).toHaveBeenCalledTimes(1);
    expect(actual.settings.desktopEnabled).toBe(true);
    await act(async () => { actual.setSlotAlertsEnabled("thread_reply", false); });
    await act(async () => { actual.setAllSlotAlertsEnabled(false); });
    await act(async () => { actual.setAllSlotAlertsEnabled(true); });
    expect(actual.settings.slotAlertsEnabled).toEqual({ mention: true, thread_reply: false });
    expect(JSON.parse(localStorage.getItem("buzz-notification-settings.v2:actor")!).slotAlertsEnabled.thread_reply).toBe(false);
  });
  it("does not persist an old identity's settings or delayed permission into the next identity", async () => {
    localStorage.clear();
    let resolve!: (value: NotificationPermission) => void;
    const permission: NotificationHost = { getPermission: async () => "default", requestPermission: () => new Promise((done) => { resolve = done; }) };
    let actual!: ReturnType<typeof useNotificationSettings>;
    let switchOwner!: (value: string) => void;
    function Harness() { const [owner, setOwner] = useState("first"); switchOwner = setOwner; actual = useNotificationSettings(owner, permission); return null; }
    await render(<Harness />);
    await act(async () => { actual.setHomeBadgeEnabled(false); });
    let pending!: Promise<boolean>;
    await act(async () => { pending = actual.setDesktopEnabled(true); await Promise.resolve(); });
    await act(async () => { switchOwner("second"); });
    await act(async () => { resolve("denied"); await pending; });
    expect(actual.settings.homeBadgeEnabled).toBe(true);
    expect(actual.permission).not.toBe("denied");
    expect(actual.errorMessage).toBeNull();
    expect(JSON.parse(localStorage.getItem("buzz-notification-settings.v2:second")!).homeBadgeEnabled).toBe(true);
    expect(JSON.parse(localStorage.getItem("buzz-notification-settings.v2:first")!).homeBadgeEnabled).toBe(false);
  });
});
