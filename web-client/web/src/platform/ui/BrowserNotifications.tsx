import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNotificationSettings, NotificationSettingsCard, playNotificationSound, truncateNotificationBody, type NotificationHost, type SoundSlot } from "@client-kit/platform/react/notifications";
import { bff } from "../bff-client";

// Browser permission is an OS capability, never a replacement for BFF scope
// authorization. No notification request runs until a user clicks the control.
const browserHost: NotificationHost = {
  kind: "browser",
  getPermission: async () => typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  requestPermission: async () => typeof Notification === "undefined" ? "unsupported" : Notification.requestPermission(),
};
/** Original home-feed seen-set bound (features/notifications/use-feed-desktop-notifications.ts). */
const DELIVERED_EVENT_LIMIT = 500;
type BrowserNotificationsState = ReturnType<typeof useNotificationSettings> & {
  pubkey: string | undefined;
  sendReminder: (message: { title: string; body: string }) => Promise<boolean>;
  notify: (message: { eventId: string; title: string; body: string; slot: SoundSlot; onOpen: () => void }) => void;
  /**
   * DD-125(9) first-join alert. Original sendDesktopNotification for a community join: gated by
   * the desktop switch and browser permission only — it is no message slot, carries no slot
   * sound, and is not a viewed conversation (reads run only while the page is in front).
   */
  notifyMemberJoin: (message: { eventId: string; title: string; body: string }) => void;
};
const BrowserNotifications = createContext<BrowserNotificationsState | null>(null);
export function useBrowserNotifications() { return useContext(BrowserNotifications); }

export function BrowserNotificationsProvider({ principalId, children }: { principalId: string; children: ReactNode }) {
  const profile = useQuery({ queryKey: ["platform", "notification-profile", principalId], queryFn: () => bff.profile() });
  const controller = useNotificationSettings(profile.isSuccess ? profile.data.pubkey : undefined, browserHost);
  const active = useRef(true);
  const displayed = useRef(new Map<string | Notification, Notification>());
  // Original trackSeenEvent: an event alerts once even when two paths see it (the open
  // channel's live stream and the shell's Home feed), bounded like the original seen set.
  const delivered = useRef(new Set<string>());
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; for (const notification of displayed.current.values()) notification.close(); displayed.current.clear(); delivered.current.clear(); };
  }, [principalId]);
  const value = useMemo<BrowserNotificationsState>(() => ({
    ...controller,
    pubkey: profile.isSuccess ? profile.data.pubkey : undefined,
    async sendReminder(message) {
      if (!active.current || !profile.isSuccess || !controller.settings.desktopEnabled ||
        !controller.settings.slotAlertsEnabled.needs_action || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
      try {
        // Original reminders are time-triggered, not suppressed by the message
        // viewing preference. The shared detector owns sound after success.
        const notification = new Notification(message.title, { body: message.body, silent: true });
        displayed.current.set(notification, notification);
        notification.onclose = () => displayed.current.delete(notification);
        return true;
      } catch { return false; }
    },
    notify(message) {
      if (!active.current || !profile.isSuccess || !controller.settings.desktopEnabled ||
        !controller.settings.slotAlertsEnabled[message.slot] || typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (document.visibilityState === "visible" && !controller.settings.notifyWhileViewing) return;
      if (displayed.current.has(message.eventId) || delivered.current.has(message.eventId)) return;
      try {
        // Same browser branch as original Buzz sendDesktopNotification: native
        // notification is silent; the selected original slot supplies sound.
        const notification = new Notification(message.title, { body: truncateNotificationBody(message.body, ""), silent: true, tag: message.eventId });
        displayed.current.set(message.eventId, notification);
        notification.onclick = () => { if (active.current) { window.focus(); message.onOpen(); } notification.close(); };
        notification.onclose = () => displayed.current.delete(message.eventId);
        delivered.current.add(message.eventId);
        if (delivered.current.size > DELIVERED_EVENT_LIMIT) delivered.current.delete(delivered.current.values().next().value!);
        playNotificationSound(controller.settings.sounds[message.slot]);
      } catch { /* Original delivery miss: no success receipt and no sound. */ }
    },
    notifyMemberJoin(message) {
      if (!active.current || !profile.isSuccess || !controller.settings.desktopEnabled ||
        typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (displayed.current.has(message.eventId) || delivered.current.has(message.eventId)) return;
      try {
        const notification = new Notification(message.title, { body: message.body, silent: true, tag: message.eventId });
        displayed.current.set(message.eventId, notification);
        notification.onclick = () => { if (active.current) window.focus(); notification.close(); };
        notification.onclose = () => displayed.current.delete(message.eventId);
        delivered.current.add(message.eventId);
        if (delivered.current.size > DELIVERED_EVENT_LIMIT) delivered.current.delete(delivered.current.values().next().value!);
      } catch { /* Original delivery miss. */ }
    },
  }), [controller, profile.isSuccess, profile.data?.pubkey]);
  return <BrowserNotifications.Provider value={value}>{children}</BrowserNotifications.Provider>;
}

export function BrowserNotificationSettings() {
  const state = useBrowserNotifications();
  if (!state) return null;
  return <NotificationSettingsCard notificationEnvironment="browser" isUpdatingDesktopNotifications={state.isUpdatingDesktopEnabled}
    notificationErrorMessage={state.errorMessage} notificationPermission={state.permission} notificationSettings={state.settings}
    onSetDesktopNotificationsEnabled={state.setDesktopEnabled} onSetAllSlotAlertsEnabled={state.setAllSlotAlertsEnabled}
    onSetHomeBadgeEnabled={state.setHomeBadgeEnabled} onSetSlotAlertsEnabled={state.setSlotAlertsEnabled}
    onSetNotifyWhileViewing={state.setNotifyWhileViewing} onSetSoundForSlot={state.setSoundForSlot} />;
}
