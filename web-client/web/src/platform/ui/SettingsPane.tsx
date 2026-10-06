import { ThemeSettingsControls } from "@client-kit/platform/react/theme-settings-controls";
import { isBuzzTheme } from "@client-kit/platform/theme/use-appearance";
import { isMacPlatform } from "@client-kit/platform/keyboard-platform";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { translate } from "@client-kit/platform/i18n";
import { ConversationDisplaySettings } from "@client-kit/platform/react/conversation-display-settings";
import { ProminentActiveTabSetting } from "@client-kit/platform/react/prominent-active-tab-setting";
import {
  SettingsPage,
  ShortcutSettings,
  SettingsSectionHeader,
  LanguageSettings,
  shortcutText,
  type SettingsShortcut,
  type SettingsSection,
} from "@client-kit/platform/react/settings";
import { setWorkspacePreference, uploadProfileAvatar } from "@/platform/bff-client";
import { getLocale } from "@/shared/i18n";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { Button } from "@/shared/ui/button";
import { platformQueries } from "./queries";
import { ProfileSettingsCard, ProfileAvatarControls, ProfileAvatarPreview } from "@client-kit/platform/react/profile-settings";
import { useBffClient } from "@client-kit/platform/react/context";
import { useLoad } from "@client-kit/platform/react/use-load";
import { ReadFailure } from "@client-kit/platform/react/ui";
import { TransportError } from "@client-kit/platform/transport";
import { SettingsOptionGroup, SettingsOptionGroupList, SettingsOptionRow } from "@client-kit/platform/react/settings-option-group";
import { Switch } from "@client-kit/platform/react/switch";
import { useUiLocale } from "@client-kit/platform/react/context";
import { LinkPreviewStyleSetting } from "@client-kit/platform/react/link-preview";
import { BrowserNotificationSettings } from "./BrowserNotifications";

function webShortcuts(locale: ReturnType<typeof getLocale>): SettingsShortcut[] {
  const mod = isMacPlatform() ? "⌘" : "Ctrl+";
  const entries: Array<[string, string, SettingsShortcut["category"]]> = [
    ["open-settings", `${mod},`, "Navigation"],
    ["send-message", "Enter", "Messages"], ["new-line", "Shift+Enter", "Messages"],
    ["format-bold", `${mod}B`, "Formatting"], ["format-italic", `${mod}I`, "Formatting"],
    ["format-strikethrough", `${mod}${isMacPlatform() ? "⇧" : "Shift+"}X`, "Formatting"],
    ["format-code", `${mod}E`, "Formatting"],
    ["format-link", `${mod}K`, "Formatting"],
  ];
  return entries.flatMap(([id, keys, category]) => {
    const text = shortcutText(locale, id);
    return text ? [{ id, keys, category, ...text }] : [];
  });
}
// The table describes the real shared Tiptap handlers, not new key bindings.

export function SettingsPane() {
  const locale = useUiLocale();
  const appearance = useTheme();
  const [section, setSection] = useState<SettingsSection>("profile");
  return (
    <SettingsPage locale={locale} section={section} onSelect={setSection}>
      {section === "profile" ? <WebProfileSettings /> : section === "appearance" ? (
        <section className="flex min-h-0 flex-1 flex-col" data-testid="settings-theme">
          <SettingsSectionHeader title={translate(locale, "platform.settings.appearance")} description={translate(locale, "platform.theme.appearanceDescription", { name: translate(locale, "platform.title") })} />
          <SettingsOptionGroupList>
          <LanguageSettings />
          <ThemeSettingsControls locale={locale} name={translate(locale, "platform.title")} appearance={appearance}>
            {isBuzzTheme(appearance.themeName) ? <ProminentActiveTabSetting locale={locale} prominentActiveTab={appearance.prominentActiveTab} setProminentActiveTab={appearance.setProminentActiveTab} /> : null}
          </ThemeSettingsControls>
          <SettingsOptionGroup data-testid="appearance-preferences-card" title={translate(locale, "platform.settings.preferences")}>
            <ConversationDisplaySettings locale={locale} />
            <LinkPreviewStyleSetting isDark={appearance.isDark} />
          </SettingsOptionGroup>
          </SettingsOptionGroupList>
        </section>
      ) : section === "notifications" ? (
        <><BrowserNotificationSettings /><WorkspaceNotifications /></>
      ) : (
        <ShortcutSettings
          locale={locale}
          shortcuts={webShortcuts(locale)}
        />
      )}
    </SettingsPage>
  );
}

function WebProfileSettings() {
  const client = useBffClient();
  const { isDark } = useTheme();
  const locale = useUiLocale();
  const [loaded, reload] = useLoad("own-profile", () => client.profile());
  const uploadedPaths = useRef<Record<string, string>>({});
  if (loaded.status === "pending") return <p role="status">{translate(locale, "platform.loading")}</p>;
  if (loaded.status === "error") return <ReadFailure error={loaded.error} onRetry={reload} />;
  const profile = loaded.data;
  const rewriteMediaUrl = (url: string) => {
    const clean = url.split("?")[0]!;
    const path = uploadedPaths.current[url] ?? profile.avatarMediaPaths[url] ?? uploadedPaths.current[clean] ?? profile.avatarMediaPaths[clean];
    if (path) return path;
    // Preserve local previews and original inline emoji. Never turn an
    // arbitrary remote URL into a credentialed BFF fetch or relax Web CSP.
    return url;
  };
  const upload = async (bytes: number[]) => {
    const descriptor = await uploadProfileAvatar(bytes, profile.pubkey);
    uploadedPaths.current[descriptor.url] = `/api/v1/profile/media/${descriptor.sha256}`;
    return descriptor;
  };
  const externalImage = (url: string) => {
    const poster = url.split("#buzz-anim=")[0]!;
    if (!/^https?:\/\//i.test(poster) || rewriteMediaUrl(poster) !== poster) return false;
    try { return new URL(poster).origin !== window.location.origin; } catch { return true; }
  };
  return <ProfileSettingsCard key={profile.pubkey} locale={locale} profile={profile}
    onCopy={(value) => navigator.clipboard.writeText(value)}
    avatarPreview={(actual) => <ProfileAvatarPreview locale={locale} avatarUrl={actual.avatarUrl} label={actual.displayName ?? actual.pubkey} upload={upload} rewriteMediaUrl={rewriteMediaUrl} />}
    avatarEditor={(props) => <>
      <ProfileAvatarControls {...props} label={profile.displayName ?? profile.pubkey} locale={locale} isDark={isDark} upload={upload} rewriteMediaUrl={rewriteMediaUrl} />
      {externalImage(props.avatarUrl) ? <p role="status" className="mt-3 text-sm text-muted-foreground">{translate(locale, "platform.profile.externalImage")}</p> : null}
    </>}
    onSave={async (request) => {
    const receipt = await client.updateProfile(request);
    // A subsequent read failure does not undo the accepted publication.
    const actual = await client.profile().catch(() => { throw new TransportError("Profile publication readback unavailable"); });
    if (actual.pubkey !== profile.pubkey || actual.eventId !== receipt.eventId) {
      throw new TransportError("Profile publication readback is not the original event");
    }
    Object.assign(uploadedPaths.current, actual.avatarMediaPaths);
    return actual;
  }} />;
}

export function WorkspaceNotifications() {
  const locale = useUiLocale();
  const queryClient = useQueryClient();
  const workspaces = useQuery(platformQueries.workspaces);
  const userState = useQuery(platformQueries.userState);
  const writing = useRef(false);
  const mutation = useMutation({
    mutationFn: async ({ id, muted }: { id: string; muted: boolean }) => {
      if (
        writing.current ||
        !workspaces.isSuccess ||
        !userState.isSuccess ||
        workspaces.isFetching ||
        userState.isFetching ||
        !workspaces.data.some((workspace) => workspace.id === id)
      )
        return;
      writing.current = true;
      try {
        await setWorkspacePreference(id, {
          starred: userState.data.workspacePreferences[id]?.starred ?? false,
          muted,
          version: userState.data.version,
        });
      } finally {
        // Read the original CAS authority after either success or a lost response.
        // Do not optimistically invert, replay the write, or assume default state.
        await queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey });
        writing.current = false;
      }
    },
  });
  const ready =
    workspaces.isSuccess && userState.isSuccess && !workspaces.isFetching && !userState.isFetching;
  const failed = workspaces.isError || userState.isError || mutation.isError;
  async function refresh() {
    const [ws, prefs] = await Promise.all([workspaces.refetch(), userState.refetch()]);
    if (ws.isSuccess && prefs.isSuccess) mutation.reset();
  }
  return (
    <section className="min-w-0" data-testid="workspace-notifications">
      <SettingsSectionHeader title={translate(locale, "platform.settings.notifications")}
        description={translate(locale, "platform.settings.workspaceNotificationsDescription")} />
      {failed ? (
        <div role="status">
          <p>{translate(locale, "platform.loadFailed")}</p>
          <Button
            type="button"
            disabled={mutation.isPending || workspaces.isFetching || userState.isFetching}
            onClick={() => void refresh()}
          >
            {translate(locale, "platform.retry")}
          </Button>
        </div>
      ) : !ready ? (
        <p role="status">{translate(locale, "platform.loadingWorkspaces")}</p>
      ) : null}
      {ready && workspaces.data.length === 0 ? (
        <p>{translate(locale, "platform.noWorkspace")}</p>
      ) : null}
      {ready ? (
        <SettingsOptionGroupList><SettingsOptionGroup title={translate(locale, "platform.settings.workspaceNotifications")}>
          {workspaces.data.map((workspace) => (
            <SettingsOptionRow
              key={workspace.id}
            >
              <div className="min-w-0 flex-1"><label htmlFor={`workspace-mute-${workspace.id}`} className="text-sm font-medium break-words">{workspace.name}</label>
                <p className="text-sm font-normal text-muted-foreground/70" data-settings-subcopy>{translate(locale, "platform.settings.muted")}</p></div>
                <Switch
                  id={`workspace-mute-${workspace.id}`}
                  checked={userState.data.workspacePreferences[workspace.id]?.muted ?? false}
                  disabled={failed || mutation.isPending}
                  onCheckedChange={(muted) =>
                    mutation.mutate({ id: workspace.id, muted })
                  }
                />
            </SettingsOptionRow>
          ))}
        </SettingsOptionGroup></SettingsOptionGroupList>
      ) : null}
    </section>
  );
}
