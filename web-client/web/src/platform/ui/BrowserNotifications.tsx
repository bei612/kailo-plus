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
type BrowserNotificationsState = ReturnType<typeof useNotificationSettings> & {
  notify: (message: { eventId: string; title: string; body: string; slot: SoundSlot; onOpen: () => void }) => void;
};
const BrowserNotifications = createContext<BrowserNotificationsState | null>(null);
export function useBrowserNotifications() { return useContext(BrowserNotifications); }

export function BrowserNotificationsProvider({ principalId, children }: { principalId: string; children: ReactNode }) {
  const profile = useQuery({ queryKey: ["platform", "notification-profile", principalId], queryFn: () => bff.profile() });
  const controller = useNotificationSettings(profile.isSuccess ? profile.data.pubkey : undefined, browserHost);
  const active = useRef(true);
  const displayed = useRef(new Map<string, Notification>());
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; for (const notification of displayed.current.values()) notification.close(); displayed.current.clear(); };
  }, [principalId]);
  const value = useMemo<BrowserNotificationsState>(() => ({
    ...controller,
    notify(message) {
      if (!active.current || !profile.isSuccess || !controller.settings.desktopEnabled ||
        !controller.settings.slotAlertsEnabled[message.slot] || typeof Notification === "undefined" || Notification.permission !== "granted") return;
      if (document.visibilityState === "visible" && !controller.settings.notifyWhileViewing) return;
      if (displayed.current.has(message.eventId)) return;
      try {
        // Same browser branch as original Buzz sendDesktopNotification: native
        // notification is silent; the selected original slot supplies sound.
        const notification = new Notification(message.title, { body: truncateNotificationBody(message.body, ""), silent: true, tag: message.eventId });
        displayed.current.set(message.eventId, notification);
        notification.onclick = () => { if (active.current) { window.focus(); message.onOpen(); } notification.close(); };
        notification.onclose = () => displayed.current.delete(message.eventId);
        playNotificationSound(controller.settings.sounds[message.slot]);
      } catch { /* Original delivery miss: no success receipt and no sound. */ }
    },
  }), [controller, profile.isSuccess]);
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
