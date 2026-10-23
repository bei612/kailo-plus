import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { translate } from "../../i18n";
import { useUiLocale } from "../context";
import { Button } from "../profile/buzz/shared/ui/button";
import type {
  DesktopNotificationPermissionState,
  NotificationSettings,
} from "./settings";
import {
  COMING_SOON_SLOTS,
  DEFAULT_SLOT_SOUNDS,
  RECOMMENDED_SOUND_BY_COMING_SOON_SLOT,
  RECOMMENDED_SOUND_BY_SLOT,
  SOUND_SLOTS,
  type SoundName,
  type SoundSlot,
} from "./sound";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Switch } from "../switch";
import {
  SettingsOptionGroup,
  SettingsOptionGroupList,
  SettingsOptionRow,
} from "../settings-option-group";
import { SettingsSectionHeader } from "../settings-surface";
import { SoundPicker } from "./SoundPicker";
import type { ComponentNotificationCategory } from "@client-kit/contracts";
import { ComponentAlertsGroup } from "./ComponentAlertsGroup";

const comingSoonLabelKeys = {
  job_accepted: "platform.notifications.jobAccepted",
  job_progress: "platform.notifications.jobProgress",
  job_result: "platform.notifications.jobResult",
  job_error: "platform.notifications.jobError",
} as const;
const comingSoonDescriptionKeys = {
  job_accepted: "platform.notifications.jobAcceptedDescription",
  job_progress: "platform.notifications.jobProgressDescription",
  job_result: "platform.notifications.jobResultDescription",
  job_error: "platform.notifications.jobErrorDescription",
} as const;

export function NotificationSettingsCard({
  isUpdatingDesktopNotifications,
  notificationErrorMessage,
  notificationPermission,
  notificationSettings,
  onSetDesktopNotificationsEnabled,
  onSetAllSlotAlertsEnabled,
  onSetHomeBadgeEnabled,
  onSetSlotAlertsEnabled,
  onSetNotifyWhileViewing,
  onSetSoundForSlot,
  notificationEnvironment = "native",
  onSetComponentAlertEnabled,
}: {
  /** DD-138(4), 07 §4.8.3: hosts with the Kailo Inbox render the per-category component switches. */
  onSetComponentAlertEnabled?: (category: ComponentNotificationCategory, enabled: boolean) => void;
  notificationEnvironment?: "browser" | "native";
  isUpdatingDesktopNotifications: boolean;
  notificationErrorMessage: string | null;
  notificationPermission: DesktopNotificationPermissionState;
  notificationSettings: NotificationSettings;
  onSetDesktopNotificationsEnabled: (enabled: boolean) => Promise<boolean>;
  onSetAllSlotAlertsEnabled: (enabled: boolean) => void;
  onSetHomeBadgeEnabled: (enabled: boolean) => void;
  onSetSlotAlertsEnabled: (slot: SoundSlot, enabled: boolean) => void;
  onSetNotifyWhileViewing: (enabled: boolean) => void;
  onSetSoundForSlot: (slot: SoundSlot, name: SoundName) => void;
}) {
  const locale = useUiLocale();
  const permissionBlocked =
    notificationPermission === "denied" ||
    notificationPermission === "unsupported";
  // The parent Sound switch derives from its children: on when any live
  // event row is on, and toggling it bulk-sets every live row.
  const anyAlertsOn = SOUND_SLOTS.some(
    (slot) => notificationSettings.slotAlertsEnabled[slot],
  );
  const [showComingSoon, setShowComingSoon] = useState(false);

  return (
    <section className="min-w-0" data-testid="settings-notifications">
      <SettingsSectionHeader
        title={translate(locale, "platform.settings.notifications")}
        description={translate(locale, "platform.notifications.description")}
      />

      <span className="sr-only" data-testid="notifications-desktop-state">
        {notificationPermission === "unsupported"
          ? translate(locale, "platform.notifications.unavailable")
          : notificationPermission === "denied"
            ? translate(locale, "platform.notifications.blocked")
            : notificationSettings.desktopEnabled
              ? translate(locale, "platform.notifications.on")
              : translate(locale, "platform.notifications.off")}
      </span>

      <SettingsOptionGroupList>
        <SettingsOptionGroup title={translate(locale, "platform.notifications.desktop")}>
          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="desktop-alerts-switch"
              >
                {isUpdatingDesktopNotifications
                  ? translate(locale, "platform.notifications.requesting")
                  : translate(locale, "platform.notifications.alerts")}
              </label>
              <p
                className="text-sm font-normal text-muted-foreground/70"
                data-settings-subcopy
              >
                {notificationSettings.desktopEnabled
                  ? translate(locale, "platform.notifications.enabledDescription")
                  : translate(locale, "platform.notifications.requestDescription")}
              </p>
            </div>
            <Switch
              checked={notificationSettings.desktopEnabled}
              data-testid="notifications-desktop-toggle"
              disabled={isUpdatingDesktopNotifications}
              id="desktop-alerts-switch"
              onCheckedChange={(checked) => {
                void onSetDesktopNotificationsEnabled(checked);
              }}
            />
          </SettingsOptionRow>

          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="notify-while-viewing-switch"
              >
                {translate(locale, "platform.notifications.whileViewing")}
              </label>
              <p
                className="text-sm font-normal text-muted-foreground/70"
                data-settings-subcopy
              >
                {translate(locale, "platform.notifications.whileViewingDescription")}
              </p>
            </div>
            <Switch
              checked={
                notificationSettings.desktopEnabled &&
                notificationSettings.notifyWhileViewing
              }
              data-testid="notifications-notify-while-viewing-toggle"
              disabled={!notificationSettings.desktopEnabled}
              id="notify-while-viewing-switch"
              onCheckedChange={(checked) => {
                onSetNotifyWhileViewing(checked);
              }}
            />
          </SettingsOptionRow>
        </SettingsOptionGroup>

        {notificationSettings.desktopEnabled ? (
          <>
            <SettingsOptionGroup title={translate(locale, "platform.notifications.sound")}>
              <SettingsOptionRow>
                <div className="min-w-0">
                  <label
                    className="text-sm font-medium"
                    htmlFor="notification-sound-switch"
                  >
                    {translate(locale, "platform.notifications.sound")}
                  </label>
                  <p
                    className="text-sm font-normal text-muted-foreground/70"
                    data-settings-subcopy
                  >
                    {translate(locale, "platform.notifications.soundDescription")}
                  </p>
                </div>
                <Switch
                  checked={anyAlertsOn}
                  data-testid="notifications-sound-toggle"
                  id="notification-sound-switch"
                  onCheckedChange={(checked) => {
                    onSetAllSlotAlertsEnabled(checked);
                  }}
                />
              </SettingsOptionRow>
            </SettingsOptionGroup>

            {anyAlertsOn ? (
              <div className="space-y-4">
              <SettingsOptionGroup title={translate(locale, "platform.notifications.alertSounds")}>
                {SOUND_SLOTS.map((slot) => {
                  const alertsOn = notificationSettings.slotAlertsEnabled[slot];
                  return (
                    <SettingsOptionRow key={slot}>
                      <div className="min-w-0">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {translate(locale, slot === "dm" ? "platform.notifications.dm" : slot === "mention" ? "platform.notifications.mention" : slot === "needs_action" ? "platform.notifications.needsAction" : "platform.notifications.threadReply")}
                        </span>
                        <p
                          className="text-sm font-normal text-muted-foreground/70"
                          data-settings-subcopy
                        >
                          {translate(locale, slot === "dm" ? "platform.notifications.dmDescription" : slot === "mention" ? "platform.notifications.mentionDescription" : slot === "needs_action" ? "platform.notifications.needsActionDescription" : "platform.notifications.threadReplyDescription")}
                        </p>
                      </div>
                      <span className="flex items-center gap-3">
                        <span
                          className={cn(
                            "transition-opacity duration-200",
                            !alertsOn && "pointer-events-none opacity-40",
                          )}
                        >
                          <SoundPicker
                            disabled={!alertsOn}
                            onChange={(next) => onSetSoundForSlot(slot, next)}
                            recommended={RECOMMENDED_SOUND_BY_SLOT[slot]}
                            value={notificationSettings.sounds[slot]}
                          />
                        </span>
                        <Switch
                          checked={alertsOn}
                          data-testid={`notifications-alerts-enabled-${slot}`}
                          id={`alerts-enabled-${slot}-switch`}
                          onCheckedChange={(checked) => {
                            onSetSlotAlertsEnabled(slot, checked);
                          }}
                        />
                      </span>
                    </SettingsOptionRow>
                  );
                })}
                {showComingSoon ? COMING_SOON_SLOTS.map((slot) => (
                  <SettingsOptionRow aria-disabled className="cursor-not-allowed opacity-40" key={slot}>
                    <div className="min-w-0">
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {translate(locale, comingSoonLabelKeys[slot])}
                        <span className="rounded-full bg-muted/70 px-2 py-0.5 text-2xs font-normal uppercase tracking-wide text-muted-foreground">
                          {translate(locale, "platform.notifications.comingSoon")}
                        </span>
                      </span>
                      <p className="text-sm font-normal text-muted-foreground/70" data-settings-subcopy>
                        {translate(locale, comingSoonDescriptionKeys[slot])}
                      </p>
                    </div>
                    <span className="flex items-center gap-3">
                      <span className="pointer-events-none opacity-40 transition-opacity duration-200">
                        <SoundPicker disabled onChange={() => {}} recommended={RECOMMENDED_SOUND_BY_COMING_SOON_SLOT[slot]}
                          value={DEFAULT_SLOT_SOUNDS.dm} />
                      </span>
                      <Switch checked={false} data-testid={`notifications-alerts-enabled-${slot}`} disabled
                        id={`alerts-enabled-${slot}-switch`} />
                    </span>
                  </SettingsOptionRow>
                )) : null}
              </SettingsOptionGroup>
              <div className="flex justify-center">
                <Button data-testid="notifications-toggle-coming-soon" onClick={() => setShowComingSoon((current) => !current)}
                  size="sm" type="button" variant="secondary">
                  {showComingSoon
                    ? <><ChevronUp className="h-4 w-4" />{translate(locale, "platform.notifications.showLess")}</>
                    : <><ChevronDown className="h-4 w-4" />{translate(locale, "platform.notifications.viewAll")}</>}
                </Button>
              </div>
              </div>
            ) : null}
          </>
        ) : null}

        {onSetComponentAlertEnabled ? (
          <ComponentAlertsGroup enabled={notificationSettings.componentAlertsEnabled} onChange={onSetComponentAlertEnabled} />
        ) : null}

        <SettingsOptionGroup title={translate(locale, "platform.notifications.badges")}>
          <SettingsOptionRow>
            <div className="min-w-0">
              <label
                className="text-sm font-medium"
                htmlFor="home-badge-switch"
              >
                {translate(locale, "platform.notifications.homeBadge")}
              </label>
              <p
                className="text-sm font-normal text-muted-foreground/70"
                data-settings-subcopy
              >
                {translate(locale, "platform.notifications.homeBadgeDescription")}
              </p>
            </div>
            <Switch
              checked={notificationSettings.homeBadgeEnabled}
              data-testid="notifications-home-badge-toggle"
              id="home-badge-switch"
              onCheckedChange={(checked) => {
                onSetHomeBadgeEnabled(checked);
              }}
            />
          </SettingsOptionRow>
        </SettingsOptionGroup>
      </SettingsOptionGroupList>

      {permissionBlocked && (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notificationPermission === "unsupported"
            ? translate(locale, "platform.notifications.unsupported")
            : translate(locale, notificationEnvironment === "browser" ? "platform.notifications.browserDenied" : "platform.notifications.denied")}
        </p>
      )}

      {notificationErrorMessage ? (
        <p className="mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {notificationErrorMessage}
        </p>
      ) : null}
    </section>
  );
}
