import { AppearanceSettings } from "@client-kit/platform/react/appearance-settings";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import {
  translate,
} from "@client-kit/platform/i18n";
import {
  ExperimentalFeaturesCard,
  type SettingsSection,
} from "@client-kit/platform/react/settings";
import type {
  DesktopNotificationPermissionState,
  NotificationSettings,
} from "@/features/notifications/hooks";
import type { SoundName, SoundSlot } from "@/features/notifications/lib/sound";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { isLinuxPlatform } from "@/shared/lib/platform";
import { performDefaultHaptic } from "@/shared/lib/haptics";
import { KeyboardShortcutsCard } from "./KeyboardShortcutsCard";
import { NotificationSettingsCard } from "./NotificationSettingsCard";

export type { SettingsSection } from "@client-kit/platform/react/settings";

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "profile";

const SETTINGS_SECTION_VALUES: readonly SettingsSection[] = [
  "profile",
  "appearance",
  "notifications",
  "shortcuts",
  "community-members",
  "custom-emoji",
  "experimental",
];

export function isSettingsSection(value: unknown): value is SettingsSection {
  return (
    typeof value === "string" &&
    (SETTINGS_SECTION_VALUES as readonly string[]).includes(value)
  );
}

export type SettingsPanelProps = {
  isUpdatingDesktopNotifications: boolean;
  notificationErrorMessage: string | null;
  notificationPermission: DesktopNotificationPermissionState;
  notificationSettings: NotificationSettings;
  onSetDesktopNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  onSetHomeBadgeEnabled: (enabled: boolean) => void;
  onSetSlotAlertsEnabled: (slot: SoundSlot, enabled: boolean) => void;
  onSetNotifyWhileViewing: (enabled: boolean) => void;
  onSetAllSlotAlertsEnabled: (enabled: boolean) => void;
  onSetSoundForSlot: (slot: SoundSlot, name: SoundName) => void;
};

function ThemeSettingsCard() {
  const locale = useDeviceLocale();
  const name = translate(locale, "platform.title");
  const appearance = useTheme();
  return <AppearanceSettings name={name} appearance={appearance} glass={appearance}
    hideGlass={isLinuxPlatform()} performDefaultHaptic={performDefaultHaptic} />;
}

export function renderSettingsSection(
  section: SettingsSection,
  props: SettingsPanelProps,
): React.ReactNode {
  switch (section) {
    case "community-members":
      return null; // The shared invitation controller stays mounted in SettingsView.
    case "profile":
      return null; // SettingsView retains the scoped in-flight/UNKNOWN profile intent.
    case "custom-emoji":
      return null; // SettingsView keeps the scoped UNKNOWN publication intent mounted.
    case "notifications":
      return (
        <NotificationSettingsCard
          isUpdatingDesktopNotifications={props.isUpdatingDesktopNotifications}
          notificationErrorMessage={props.notificationErrorMessage}
          notificationPermission={props.notificationPermission}
          notificationSettings={props.notificationSettings}
          onSetDesktopNotificationsEnabled={
            props.onSetDesktopNotificationsEnabled
          }
          onSetHomeBadgeEnabled={props.onSetHomeBadgeEnabled}
          onSetSlotAlertsEnabled={props.onSetSlotAlertsEnabled}
          onSetNotifyWhileViewing={props.onSetNotifyWhileViewing}
          onSetAllSlotAlertsEnabled={props.onSetAllSlotAlertsEnabled}
          onSetSoundForSlot={props.onSetSoundForSlot}
        />
      );
    case "appearance":
      return <ThemeSettingsCard />;
    case "shortcuts":
      return <KeyboardShortcutsCard />;
    case "experimental":
      return <ExperimentalFeaturesCard />;
    default: {
      const exhaustiveCheck: never = section;
      return exhaustiveCheck;
    }
  }
}
