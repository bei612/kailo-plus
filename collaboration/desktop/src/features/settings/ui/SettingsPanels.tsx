import { ThemeSettingsControls } from "@client-kit/platform/react/theme-settings-controls";
import { useDeviceLocale } from "@client-kit/platform/react/context";
import {
  translate,
} from "@client-kit/platform/i18n";
import {
  LanguageSettings,
  type SettingsSection,
} from "@client-kit/platform/react/settings";
import type {
  DesktopNotificationPermissionState,
  NotificationSettings,
} from "@/features/notifications/hooks";
import type { SoundName, SoundSlot } from "@/features/notifications/lib/sound";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { isBuzzTheme, useTheme } from "@/shared/theme/ThemeProvider";
import {
  GlassBackgroundSetting,
  LinkPreviewStyleSetting,
  ThreadLayoutSetting,
} from "./AppearanceSettingsControls";
import { ProminentActiveTabSetting } from "@client-kit/platform/react/prominent-active-tab-setting";
import { KeyboardShortcutsCard } from "./KeyboardShortcutsCard";
import { ConversationDisplaySettings } from "@client-kit/platform/react/conversation-display-settings";
import { NotificationSettingsCard } from "./NotificationSettingsCard";
import {
  SettingsOptionGroup,
  SettingsOptionGroupList,
} from "./SettingsOptionGroup";
import { SettingsSectionHeader } from "./SettingsSectionHeader";
import { ProfileSettingsCard } from "./ProfileSettingsCard";

export type { SettingsSection } from "@client-kit/platform/react/settings";

export const DEFAULT_SETTINGS_SECTION: SettingsSection = "profile";

const SETTINGS_SECTION_VALUES: readonly SettingsSection[] = [
  "profile",
  "appearance",
  "notifications",
  "shortcuts",
  "community-members",
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
  const { displayName } = useNativeSession();
  const name = displayName ?? translate(locale, "platform.title");
  const appearance = useTheme();
  return <section className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="settings-theme">
    <SettingsSectionHeader title={translate(locale, "platform.settings.appearance")} description={translate(locale, "platform.theme.appearanceDescription", { name })} />
    <SettingsOptionGroupList>
      <LanguageSettings />
      <ThemeSettingsControls locale={locale} name={name} appearance={appearance}>
        <GlassBackgroundSetting />
        {isBuzzTheme(appearance.themeName) ? <ProminentActiveTabSetting locale={locale} prominentActiveTab={appearance.prominentActiveTab} setProminentActiveTab={appearance.setProminentActiveTab} /> : null}
      </ThemeSettingsControls>
      <SettingsOptionGroup data-testid="appearance-preferences-card" title={translate(locale, "platform.settings.preferences")}>
        <ConversationDisplaySettings locale={locale} />
        <LinkPreviewStyleSetting />
        <ThreadLayoutSetting />
      </SettingsOptionGroup>
    </SettingsOptionGroupList>
  </section>;
}

export function renderSettingsSection(
  section: SettingsSection,
  props: SettingsPanelProps,
): React.ReactNode {
  switch (section) {
    case "community-members":
      return null; // The shared invitation controller stays mounted in SettingsView.
    case "profile":
      return <ProfileSettingsCard />;
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
    default: {
      const exhaustiveCheck: never = section;
      return exhaustiveCheck;
    }
  }
}
