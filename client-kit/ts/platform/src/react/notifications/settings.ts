// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/notifications/hooks.ts.
import * as React from "react";
import { getLocale, translate } from "../../i18n";
import { scheduleAfterForegroundReady } from "./foregroundReady";
import { DEFAULT_SLOT_ALERTS_ENABLED, DEFAULT_SLOT_SOUNDS, SOUND_NAMES, SOUND_SLOTS, type SlotSounds, type SoundName, type SoundSlot } from "./sound";
export type DesktopNotificationPermissionState = NotificationPermission | "unsupported";
export type NotificationHost = { getPermission: () => Promise<DesktopNotificationPermissionState>; requestPermission: () => Promise<DesktopNotificationPermissionState> };
// v2: settings model reworked around per-event rows (flutter default sound,
// slotAlertsEnabled, no singleSound/soundEnabled) — v1 values are abandoned.
const NOTIFICATION_SETTINGS_STORAGE_KEY = "buzz-notification-settings.v2";

export type NotificationSettings = {
  desktopEnabled: boolean;
  homeBadgeEnabled: boolean;
  notifyWhileViewing: boolean;
  sounds: SlotSounds;
  slotAlertsEnabled: Record<SoundSlot, boolean>;
  /**
   * Per-row state captured when the master switch bulk-disables, so turning
   * it back on restores the user's granular picks instead of enabling all.
   * Cleared by any individual row toggle.
   */
  slotAlertsSnapshot: Record<SoundSlot, boolean> | null;
};

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  desktopEnabled: true,
  homeBadgeEnabled: true,
  notifyWhileViewing: false,
  sounds: { ...DEFAULT_SLOT_SOUNDS },
  slotAlertsEnabled: { ...DEFAULT_SLOT_ALERTS_ENABLED },
  slotAlertsSnapshot: null,
};

const SOUND_NAME_SET = new Set<SoundName>(SOUND_NAMES);

function sanitizeSoundsMap(value: unknown): SlotSounds {
  const result = { ...DEFAULT_SLOT_SOUNDS };
  if (!value || typeof value !== "object") return result;
  const candidate = value as Partial<Record<SoundSlot, unknown>>;
  for (const slot of SOUND_SLOTS) {
    const picked = candidate[slot];
    if (typeof picked === "string" && SOUND_NAME_SET.has(picked as SoundName)) {
      result[slot] = picked as SoundName;
    }
  }
  return result;
}

function sanitizeSlotAlertsEnabled(value: unknown): Record<SoundSlot, boolean> {
  const result = { ...DEFAULT_SLOT_ALERTS_ENABLED };
  if (!value || typeof value !== "object") return result;
  const candidate = value as Partial<Record<SoundSlot, unknown>>;
  for (const slot of SOUND_SLOTS) {
    const picked = candidate[slot];
    if (typeof picked === "boolean") {
      result[slot] = picked;
    }
  }
  return result;
}

function notificationSettingsStorageKey(pubkey: string) {
  return `${NOTIFICATION_SETTINGS_STORAGE_KEY}:${pubkey}`;
}

function sanitizeNotificationSettings(value: unknown): NotificationSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }

  const candidate = value as Partial<NotificationSettings>;
  return {
    desktopEnabled:
      typeof candidate.desktopEnabled === "boolean"
        ? candidate.desktopEnabled
        : DEFAULT_NOTIFICATION_SETTINGS.desktopEnabled,
    homeBadgeEnabled:
      typeof candidate.homeBadgeEnabled === "boolean"
        ? candidate.homeBadgeEnabled
        : DEFAULT_NOTIFICATION_SETTINGS.homeBadgeEnabled,
    notifyWhileViewing:
      typeof candidate.notifyWhileViewing === "boolean"
        ? candidate.notifyWhileViewing
        : DEFAULT_NOTIFICATION_SETTINGS.notifyWhileViewing,
    sounds: sanitizeSoundsMap(candidate.sounds),
    slotAlertsEnabled: sanitizeSlotAlertsEnabled(candidate.slotAlertsEnabled),
    slotAlertsSnapshot:
      candidate.slotAlertsSnapshot != null &&
      typeof candidate.slotAlertsSnapshot === "object"
        ? sanitizeSlotAlertsEnabled(candidate.slotAlertsSnapshot)
        : null,
  };
}

function readStoredNotificationSettings(pubkey: string): NotificationSettings {
  if (typeof window === "undefined" || pubkey.length === 0) {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }

  const rawValue = window.localStorage.getItem(
    notificationSettingsStorageKey(pubkey),
  );
  if (!rawValue) {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }

  try {
    return sanitizeNotificationSettings(JSON.parse(rawValue));
  } catch {
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

function writeStoredNotificationSettings(
  pubkey: string,
  settings: NotificationSettings,
) {
  if (typeof window === "undefined" || pubkey.length === 0) {
    return;
  }

  window.localStorage.setItem(
    notificationSettingsStorageKey(pubkey),
    JSON.stringify(settings),
  );
}

export function useNotificationSettings(pubkey: string | undefined, host: NotificationHost) {
  const normalizedPubkey = pubkey?.trim().toLowerCase() ?? "";
  const owner = React.useRef(normalizedPubkey);
  owner.current = normalizedPubkey;
  const [stored, updateStored] = React.useState(() => ({
    owner: normalizedPubkey, settings: readStoredNotificationSettings(normalizedPubkey),
  }));
  const settings = stored.owner === normalizedPubkey ? stored.settings : readStoredNotificationSettings(normalizedPubkey);
  const setSettings = React.useCallback((value: NotificationSettings | ((current: NotificationSettings) => NotificationSettings)) => {
    if (!normalizedPubkey || owner.current !== normalizedPubkey) return;
    updateStored((current) => ({
      owner: normalizedPubkey,
      settings: typeof value === "function" ? value(current.owner === normalizedPubkey ? current.settings : readStoredNotificationSettings(normalizedPubkey)) : value,
    }));
  }, [normalizedPubkey]);
  const [permission, setPermission] =
    React.useState<DesktopNotificationPermissionState>("default");
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [isUpdatingDesktopEnabled, setIsUpdatingDesktopEnabled] =
    React.useState(false);

  React.useEffect(() => {
    setSettings(readStoredNotificationSettings(normalizedPubkey));
    setErrorMessage(null);
    setIsUpdatingDesktopEnabled(false);
  }, [normalizedPubkey]);

  React.useEffect(() => {
    if (stored.owner === normalizedPubkey) writeStoredNotificationSettings(normalizedPubkey, stored.settings);
  }, [normalizedPubkey, stored]);

  const refreshPermission = React.useEffectEvent(async () => {
    const requestedOwner = normalizedPubkey;
    const nextPermission = await host.getPermission();
    if (owner.current === requestedOwner) setPermission(nextPermission);
    return nextPermission;
  });

  React.useEffect(() => {
    void normalizedPubkey;
    void refreshPermission();
  }, [normalizedPubkey]);

  React.useEffect(() => {
    let cancelPendingRefresh: (() => void) | null = null;
    const refreshWhenVisible = () => {
      if (document.visibilityState !== "visible") {
        cancelPendingRefresh?.();
        cancelPendingRefresh = null;
        return;
      }
      if (cancelPendingRefresh) return;
      cancelPendingRefresh = scheduleAfterForegroundReady(() => {
        cancelPendingRefresh = null;
        if (document.visibilityState === "visible") void refreshPermission();
      });
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      cancelPendingRefresh?.();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [setSettings]);

  React.useEffect(() => {
    if (
      settings.desktopEnabled &&
      (permission === "denied" || permission === "unsupported")
    ) {
      setSettings((current) => ({ ...current, desktopEnabled: false }));
    }
  }, [permission, settings.desktopEnabled]);

  const setDesktopEnabled = React.useCallback(async (enabled: boolean) => {
    if (!normalizedPubkey) return false;
    const requestedOwner = normalizedPubkey;
    if (!enabled) {
      setErrorMessage(null);
      setSettings((current) => ({
        ...current,
        desktopEnabled: false,
      }));
      void refreshPermission();
      return true;
    }

    setIsUpdatingDesktopEnabled(true);
    setErrorMessage(null);

    try {
      let nextPermission = await refreshPermission();
      if (nextPermission === "default") {
        nextPermission = await host.requestPermission();
        if (owner.current === requestedOwner) setPermission(nextPermission);
      }
      if (owner.current !== requestedOwner) return false;

      if (nextPermission !== "granted") {
        setSettings((current) => ({
          ...current,
          desktopEnabled: false,
        }));
        setErrorMessage(
          nextPermission === "denied"
            ? translate(getLocale(), "platform.notifications.denied")
            : translate(getLocale(), "platform.notifications.unsupported"),
        );
        return false;
      }

      setSettings((current) => ({
        ...current,
        desktopEnabled: true,
      }));
      return true;
    } catch (error) {
      if (owner.current !== requestedOwner) return false;
      setSettings((current) => ({
        ...current,
        desktopEnabled: false,
      }));
      setErrorMessage(
        error instanceof Error
          ? error.message
          : translate(getLocale(), "platform.notifications.unavailable"),
      );
      return false;
    } finally {
      if (owner.current === requestedOwner) setIsUpdatingDesktopEnabled(false);
    }
  }, [normalizedPubkey, host, setSettings]);

  const setHomeBadgeEnabled = React.useCallback((enabled: boolean) => {
    setSettings((current) => ({
      ...current,
      homeBadgeEnabled: enabled,
    }));
  }, [setSettings]);

  const setNotifyWhileViewing = React.useCallback((enabled: boolean) => {
    setSettings((current) => ({
      ...current,
      notifyWhileViewing: enabled,
    }));
  }, [setSettings]);

  const setAllSlotAlertsEnabled = React.useCallback((enabled: boolean) => {
    setSettings((current) => {
      const next = { ...current.slotAlertsEnabled };
      if (!enabled) {
        // Super-switch off: remember the granular picks, zero the live rows.
        for (const slot of SOUND_SLOTS) {
          next[slot] = false;
        }
        return {
          ...current,
          slotAlertsEnabled: next,
          slotAlertsSnapshot: { ...current.slotAlertsEnabled },
        };
      }
      // Super-switch on: restore the snapshot when it has anything on,
      // otherwise enable every live row.
      const snapshot = current.slotAlertsSnapshot;
      const snapshotHasAlerts =
        snapshot != null && SOUND_SLOTS.some((slot) => snapshot[slot]);
      for (const slot of SOUND_SLOTS) {
        next[slot] = snapshotHasAlerts ? (snapshot?.[slot] ?? true) : true;
      }
      return { ...current, slotAlertsEnabled: next, slotAlertsSnapshot: null };
    });
  }, [setSettings]);

  const setSlotAlertsEnabled = React.useCallback(
    (slot: SoundSlot, enabled: boolean) => {
      setSettings((current) => ({
        ...current,
        slotAlertsEnabled: { ...current.slotAlertsEnabled, [slot]: enabled },
        // A manual row toggle supersedes any pending super-switch snapshot.
        slotAlertsSnapshot: null,
      }));
    },
    [setSettings],
  );

  const setSoundForSlot = React.useCallback(
    (slot: SoundSlot, name: SoundName) => {
      setSettings((current) => ({
        ...current,
        sounds: { ...current.sounds, [slot]: name },
      }));
    },
    [setSettings],
  );

  return {
    errorMessage,
    isUpdatingDesktopEnabled,
    permission,
    setDesktopEnabled,
    setHomeBadgeEnabled,
    setAllSlotAlertsEnabled,
    setNotifyWhileViewing,
    setSlotAlertsEnabled,
    setSoundForSlot,
    settings,
  };
}
