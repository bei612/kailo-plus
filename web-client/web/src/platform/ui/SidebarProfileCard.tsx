import type { PlatformSessionView } from "@client-kit/contracts";
import { SidebarProfileCard } from "@client-kit/platform/react/sidebar/sidebar-profile-card";
import { ProfileAvatarPreview } from "@client-kit/platform/react/profile-settings";
import { useQuery } from "@tanstack/react-query";
import { bff, uploadProfileAvatar } from "../bff-client";
import { getLocale } from "@/shared/i18n";

export function WebSidebarProfileCard({ session, onOpenSettings, onSignOut, settingsOpen }: {
  session: PlatformSessionView; onOpenSettings: () => void; onSignOut: () => void;
  settingsOpen: boolean;
}) {
  const profile = useQuery({
    queryKey: ["platform", "profile", session.platformSessionId, session.tenantPrincipalId],
    queryFn: bff.profile,
    enabled: !settingsOpen,
  });
  const actual = profile.isSuccess ? profile.data : undefined;
  const displayName = actual?.displayName ?? session.displayName;
  const rewriteMediaUrl = (url: string) => actual?.avatarMediaPaths[url]
    ?? actual?.avatarMediaPaths[url.split("?")[0]!] ?? url;
  const avatar = (testId?: string) => <ProfileAvatarPreview avatarUrl={actual?.avatarUrl ?? null}
    label={displayName} locale={getLocale()} rewriteMediaUrl={rewriteMediaUrl}
    upload={(bytes) => {
      if (!actual) return Promise.reject(new Error("Profile identity is not available"));
      return uploadProfileAvatar(bytes, actual.pubkey);
    }}
    className="h-8 w-8 text-xs" iconClassName="h-4 w-4" testId={testId} />;
  return <SidebarProfileCard communityLabel={session.tenantId} resolvedDisplayName={displayName}
    onOpenSettings={onOpenSettings} onSignOut={onSignOut}
    avatar={avatar("sidebar-profile-avatar")} popoverAvatar={avatar()} />;
}
