import { AppearanceSettings } from "@client-kit/platform/react/appearance-settings";
import { getPlatformKeys, getShortcutsByCategory } from "@client-kit/platform/keyboard-shortcuts";
import { useEffect, useId, useRef, useState } from "react";
import { translate } from "@client-kit/platform/i18n";
import {
  SettingsPage,
  ExperimentalFeaturesCard,
  ShortcutSettings,
  shortcutText,
  type SettingsShortcut,
  type SettingsSection,
  CommunityInvitationSettings,
  useInvitationSettingsState,
} from "@client-kit/platform/react/settings";
import { uploadProfileAvatar } from "@/platform/bff-client";
import { getLocale } from "@/shared/i18n";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { ProfileSettingsCard, ProfileAvatarControls, ProfileAvatarPreview } from "@client-kit/platform/react/profile-settings";
import { useBffClient } from "@client-kit/platform/react/context";
import { useLoad } from "@client-kit/platform/react/use-load";
import { ReadFailure } from "@client-kit/platform/react/ui";
import { TransportError } from "@client-kit/platform/transport";
import { useUiLocale } from "@client-kit/platform/react/context";
import { BrowserNotificationSettings } from "./BrowserNotifications";
import { CustomEmojiSettingsCard, pickEmojiImage } from "@client-kit/platform/react/custom-emoji";

function webShortcuts(locale: ReturnType<typeof getLocale>): SettingsShortcut[] {
  return [...getShortcutsByCategory().values()].flat().flatMap((shortcut) => {
    const text = shortcutText(locale, shortcut.id);
    return text ? [{ id: shortcut.id, keys: getPlatformKeys(shortcut), category: shortcut.category, ...text }] : [];
  });
}
// The table describes the real shared Tiptap handlers, not new key bindings.

export function SettingsPane({ active = true, onClose }: { active?: boolean; onClose?: () => void }) {
  const locale = useUiLocale();
  const appearance = useTheme();
  const [section, setSection] = useState<SettingsSection>("profile");
  const [emojiVisited, setEmojiVisited] = useState(false);
  useEffect(() => { if (section === "custom-emoji") setEmojiVisited(true); }, [section]);
  const invitations=useInvitationSettingsState();
  return (
    <SettingsPage active={active} locale={locale} section={section} onSelect={setSection} onClose={onClose} invitationAccess={invitations.access} onRetryInvitations={invitations.reload}>
      <CommunityInvitationSettings active={section==="community-members"} onAccessChange={invitations.onAccessChange}/>
      <div hidden={section !== "profile"}><WebProfileSettings /></div>
      {(emojiVisited || section === "custom-emoji") && <div hidden={section !== "custom-emoji"}><WebCustomEmojiSettings /></div>}
      {section === "appearance" ? (
        <AppearanceSettings name={translate(locale, "platform.title")} appearance={appearance} />
      ) : section === "notifications" ? (
        <BrowserNotificationSettings />
      ) : section==="shortcuts" ? (
        <ShortcutSettings
          locale={locale}
          shortcuts={webShortcuts(locale)}
        />
      ) : section === "experimental" ? <ExperimentalFeaturesCard /> : null}
    </SettingsPage>
  );
}

function WebCustomEmojiSettings() {
  const client = useBffClient();
  // The authenticated SettingsPane is keyed by tenant/principal/session; do not
  // reuse a previous session's React Query entry merely because its pubkey matches.
  const instance = useId();
  const current = useRef(true);
  useEffect(() => { current.current = true; return () => { current.current = false; }; }, []);
  const [profile, reload] = useLoad("custom-emoji-identity", () => client.profile());
  const paths = useRef<Record<string, string>>({});
  const t = useUiLocale();
  if (profile.status === "pending") return <p role="status">{translate(t, "platform.loading")}</p>;
  if (profile.status === "error") return <ReadFailure error={profile.error} onRetry={reload} />;
  const pubkey = profile.data.pubkey;
  return <CustomEmojiSettingsCard key={pubkey} host={{ scope: `custom-emoji-settings:${instance}:${pubkey}`,
    read: async () => {
      if (!current.current) throw new TransportError("Emoji view no longer active");
      const view = await client.customEmoji();
      if (!current.current || view.pubkey !== pubkey) throw new TransportError("Emoji identity changed");
      paths.current = { ...paths.current, ...view.mediaPaths };
      return view;
    },
    publish: (request) => {
      if (!current.current) throw new TransportError("Emoji view no longer active");
      return client.updateCustomEmoji(request);
    },
    pickAndUploadMedia: () => pickEmojiImage(async (bytes) => {
      if (!current.current) throw new TransportError("Emoji view no longer active");
      const descriptor = await uploadProfileAvatar(bytes, pubkey);
      if (!current.current) throw new TransportError("Emoji view no longer active");
      paths.current[descriptor.url] = `/api/v1/profile/media/${descriptor.sha256}`;
      return { url: descriptor.url, type: descriptor.type };
    }),
    rewriteRelayUrl: (url) => paths.current[url] ?? url,
  }} />;
}

function WebProfileSettings() {
  const client = useBffClient();
  const { isDark } = useTheme();
  const locale = useUiLocale();
  const [loaded, reload] = useLoad("own-profile", () => client.profile());
  const uploadedPaths = useRef<Record<string, string>>({});
  // SettingsPane is keyed by the authenticated tenant/principal/session in
  // PlatformApp. A completed old upload must not enter the shared presentation
  // store, nor may an old save start a readback using the next session cookie.
  const owner = useRef(true);
  useEffect(() => {
    owner.current = true;
    return () => { owner.current = false; };
  }, []);
  const requireCurrentOwner = () => {
    if (!owner.current) throw new TransportError("Profile view no longer active");
  };
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
    requireCurrentOwner();
    const descriptor = await uploadProfileAvatar(bytes, profile.pubkey);
    requireCurrentOwner();
    uploadedPaths.current[descriptor.url] = `/api/v1/profile/media/${descriptor.sha256}`;
    return descriptor;
  };
  const externalImage = (url: string) => {
    const poster = url.split("#buzz-anim=")[0]!;
    if (!/^https?:\/\//i.test(poster) || rewriteMediaUrl(poster) !== poster) return false;
    try { return new URL(poster).origin !== window.location.origin; } catch { return true; }
  };
  return <ProfileSettingsCard key={profile.pubkey} locale={locale} profile={profile}
    onCopy={async (value) => {
      if (typeof navigator.clipboard?.writeText === "function") {
        // A denied modern request stays denied; do not retry via another API.
        await navigator.clipboard.writeText(value);
        return;
      }
      // HTTP hosts have no Clipboard API. Keep this browser-native fallback
      // synchronous inside the original click gesture, without changing CSP,
      // permissions or identity. A false return is not a successful copy.
      const previousFocus = document.activeElement;
      const selection = window.getSelection();
      const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [];
      const field = document.createElement("textarea");
      field.value = value;
      field.readOnly = true;
      field.tabIndex = -1;
      field.setAttribute("aria-hidden", "true");
      field.style.cssText = "position:fixed;inset:0;opacity:0;pointer-events:none";
      document.body.append(field);
      try {
        field.focus({ preventScroll: true });
        field.select();
        if (!document.execCommand("copy")) throw new Error("Clipboard copy was refused");
      } finally {
        field.remove();
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
        if (selection) {
          selection.removeAllRanges();
          ranges.forEach(range => selection.addRange(range));
        }
      }
    }}
    avatarPreview={(actual) => <ProfileAvatarPreview locale={locale} avatarUrl={actual.avatarUrl} label={actual.displayName ?? actual.pubkey} upload={upload} rewriteMediaUrl={rewriteMediaUrl} className="h-full w-full rounded-full text-5xl" iconClassName="h-14 w-14" testId="profile-avatar-preview" />}
    avatarEditor={(props) => <>
      <ProfileAvatarControls {...props} label={profile.displayName ?? profile.pubkey} locale={locale} isDark={isDark} upload={upload} rewriteMediaUrl={rewriteMediaUrl} />
      {externalImage(props.avatarUrl) ? <p role="status" className="mt-3 text-sm text-muted-foreground">{translate(locale, "platform.profile.externalImage")}</p> : null}
    </>}
    onSave={async (request) => {
    requireCurrentOwner();
    const receipt = await client.updateProfile(request);
    requireCurrentOwner();
    // A subsequent read failure does not undo the accepted publication.
    const actual = await client.profile().catch(() => { throw new TransportError("Profile publication readback unavailable"); });
    requireCurrentOwner();
    if (actual.pubkey !== profile.pubkey || actual.eventId !== receipt.eventId) {
      throw new TransportError("Profile publication readback is not the original event");
    }
    Object.assign(uploadedPaths.current, actual.avatarMediaPaths);
    return actual;
  }} />;
}
