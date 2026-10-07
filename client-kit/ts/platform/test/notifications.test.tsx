import { act, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../src/i18n";
import { useNotificationSettings, NotificationSettingsCard, SoundPicker, type SoundName, type NotificationHost } from "../src/react/notifications";
import { render, click } from "./render";
import { formatMessageNotification } from "../src/react/notifications/notificationFormat";

afterEach(() => vi.unstubAllGlobals());

describe("shared original notification settings", () => {
  it("restores the original DM sender and neutral fallback copy without channel formatting", () => {
    setLocale("en");
    expect(formatMessageNotification({ source: "dm", senderName: " Alice ", channelName: "private", content: " hi " }))
      .toEqual({ title: "Alice", body: "hi" });
    expect(formatMessageNotification({ source: "dm", channelName: "private", content: "" }))
      .toEqual({ title: "private", body: "New message" });
    setLocale("zh-CN");
    expect(formatMessageNotification({ source: "dm", content: "" })).toEqual({ title: "私信", body: "新消息" });
  });
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
    expect(view.querySelector('[data-testid="notifications-alerts-enabled-dm"]')).not.toBeNull();
    await click(view.querySelector<HTMLButtonElement>('[data-testid="notifications-alerts-enabled-dm"]')!);
    await act(async () => { actual.setSlotAlertsEnabled("thread_reply", false); });
    await act(async () => { actual.setAllSlotAlertsEnabled(false); });
    await act(async () => { actual.setAllSlotAlertsEnabled(true); });
    expect(actual.settings.slotAlertsEnabled).toEqual({ dm: false, mention: true, thread_reply: false });
    expect(JSON.parse(localStorage.getItem("buzz-notification-settings.v2:actor")!).slotAlertsEnabled.dm).toBe(false);
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

  it("uses real preview outcomes and switches failed preview copy with the interface language", async () => {
    localStorage.clear();
    setLocale("zh-CN");
    class RefusedAudio extends EventTarget {
      pause = vi.fn();
      play = vi.fn(() => Promise.reject(new Error("browser playback refused")));
    }
    vi.stubGlobal("Audio", RefusedAudio);
    const view = await render(<SoundPicker recommended="ping" value="flutter" onChange={vi.fn()} />);
    expect(view.textContent).toContain("轻颤");
    await click(view.querySelector<HTMLButtonElement>('[aria-label="试听轻颤"]')!);
    expect(view.querySelector('[aria-label^="暂停"]')).toBeNull();
    expect(view.querySelector('[role="status"]')?.textContent).toContain("未能播放");
    await act(async () => setLocale("en"));
    expect(view.querySelector('[role="status"]')?.textContent).toContain("could not play");
    expect(view.querySelector('[aria-label="Preview flutter"]')).not.toBeNull();
  });

  it("stops only its preview on value, disabled and unmount changes and ignores late play completion", async () => {
    localStorage.clear();
    setLocale("en");
    const audio: PendingAudio[] = [];
    class PendingAudio extends EventTarget {
      complete!: () => void;
      pause = vi.fn();
      play = vi.fn(() => new Promise<void>((resolve) => { this.complete = resolve; }));
      constructor() { super(); audio.push(this); }
    }
    vi.stubGlobal("Audio", PendingAudio);
    let setSound!: (value: SoundName) => void;
    let setDisabled!: (value: boolean) => void;
    let show!: (value: boolean) => void;
    function Harness() {
      const [value, change] = useState<SoundName>("flutter");
      const [disabled, disable] = useState(false);
      const [visible, toggle] = useState(true);
      setSound = change; setDisabled = disable; show = toggle;
      return visible ? <SoundPicker recommended="ping" value={value} disabled={disabled} onChange={change} /> : null;
    }
    const view = await render(<Harness />);
    await click(view.querySelector<HTMLButtonElement>('[aria-label="Preview flutter"]')!);
    expect(view.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => setSound("ping"));
    expect(audio[0]!.pause).toHaveBeenCalledTimes(1);
    await act(async () => audio[0]!.complete());
    expect(view.querySelector('[aria-label="Pause ping"]')).toBeNull();
    await click(view.querySelector<HTMLButtonElement>('[aria-label="Preview ping"]')!);
    await act(async () => audio[1]!.complete());
    expect(view.querySelector('[aria-label="Pause ping"]')).not.toBeNull();
    await act(async () => setDisabled(true));
    expect(audio[1]!.pause).toHaveBeenCalledTimes(1);
    await act(async () => setDisabled(false));
    await click(view.querySelector<HTMLButtonElement>('[aria-label="Preview ping"]')!);
    await act(async () => show(false));
    expect(audio[2]!.pause).toHaveBeenCalledTimes(1);
    await act(async () => audio[2]!.complete());
    expect(view.textContent).toBe("");
  });

  it("keeps browser permission outcomes bilingual without treating a dismissed request as unsupported", async () => {
    localStorage.clear();
    setLocale("zh-CN");
    let permission: NotificationPermission = "denied";
    const host: NotificationHost = { kind: "browser", getPermission: async () => permission, requestPermission: async () => permission };
    let actual!: ReturnType<typeof useNotificationSettings>;
    function Harness() { actual = useNotificationSettings("actor", host); return <p role="status">{actual.errorMessage}</p>; }
    const view = await render(<Harness />);
    await act(async () => { expect(await actual.setDesktopEnabled(true)).toBe(false); });
    expect(view.textContent).toContain("网站权限");
    await act(async () => setLocale("en"));
    expect(view.textContent).toContain("site's browser permissions");
    permission = "default";
    await act(async () => { expect(await actual.setDesktopEnabled(true)).toBe(false); });
    expect(view.textContent).toContain("not enabled");
    expect(view.textContent).not.toContain("not supported");
    expect(actual.settings.desktopEnabled).toBe(false);
  });
});
