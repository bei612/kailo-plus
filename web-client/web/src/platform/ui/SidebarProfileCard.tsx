import type { PlatformSessionView } from "@client-kit/contracts";
import { SidebarProfileCard } from "@client-kit/platform/react/sidebar/sidebar-profile-card";
import { ProfileAvatarPreview } from "@client-kit/platform/react/profile-settings";
import { usePresenceHost, useSelfPresence } from "@client-kit/platform/react/presence";
import { useSetUserStatusMutation, useUserStatusQuery, visibleUserStatus, type UserStatusInput } from "@client-kit/platform/react/user-status";
import { translate } from "@client-kit/platform/i18n";
import { isOutcomeUnknown } from "@client-kit/platform/transport";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
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
  const displayName = actual?.displayName?.trim() || session.displayName;
  const rewriteMediaUrl = (url: string) => actual?.avatarMediaPaths[url]
    ?? actual?.avatarMediaPaths[url.split("?")[0]!] ?? url;
  const avatar = (testId?: string) => <ProfileAvatarPreview avatarUrl={actual?.avatarUrl ?? null}
    label={displayName} locale={getLocale()} rewriteMediaUrl={rewriteMediaUrl}
    upload={(bytes) => {
      if (!actual) return Promise.reject(new Error("Profile identity is not available"));
      return uploadProfileAvatar(bytes, actual.pubkey);
    }}
    className="h-8 w-8 text-xs" iconClassName="h-4 w-4" testId={testId} />;
  // DD-120: the original AppShell presence session and own 30315, through the presence host.
  const presenceHost = usePresenceHost();
  const presence = useSelfPresence();
  const selfPubkey = presenceHost ? actual?.pubkey.toLowerCase() : undefined;
  const selfStatus = useUserStatusQuery(selfPubkey ? [selfPubkey] : []);
  const setUserStatus = useSetUserStatusMutation(selfPubkey);
  const statusFailed = (error: unknown) => toast.error(translate(getLocale(),
    isOutcomeUnknown(error) ? "userStatus.saveUnknown" : "userStatus.saveFailed"));
  const publishStatus = (input: UserStatusInput) => setUserStatus.mutate(input, { onError: statusFailed });
  return <SidebarProfileCard communityLabel={session.tenantId} resolvedDisplayName={displayName}
    onOpenSettings={onOpenSettings} onSignOut={onSignOut}
    avatar={avatar("sidebar-profile-avatar")} popoverAvatar={avatar()}
    selfPresenceStatus={presence?.currentStatus} isPresencePending={presence?.isPending}
    onSetPresenceStatus={presence ? (status) => {
      void presence.setStatus(status).catch(() => toast.error(translate(getLocale(), "presence.updateFailed")));
    } : undefined}
    selfUserStatus={selfPubkey ? visibleUserStatus(selfStatus.data?.[selfPubkey]) ?? undefined : undefined}
    onSetUserStatus={selfPubkey ? publishStatus : undefined}
    onClearUserStatus={selfPubkey ? () => publishStatus({ text: "", emoji: "" }) : undefined} />;
}
