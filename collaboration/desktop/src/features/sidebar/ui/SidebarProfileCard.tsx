import { SidebarProfileCard as SharedSidebarProfileCard } from "@client-kit/platform/react/sidebar/sidebar-profile-card";
import { usePresenceHost, useSelfPresence } from "@client-kit/platform/react/presence";
import {
  useSetUserStatusMutation,
  useUserStatusQuery,
  visibleUserStatus,
  type UserStatusInput,
} from "@client-kit/platform/react/user-status";
import { translateCurrent } from "@client-kit/platform/i18n";
import { isOutcomeUnknown } from "@client-kit/platform/transport";
import { toast } from "sonner";
import { useSelfProfileCache } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { useNativeSession, type Community } from "@/features/platform/activeCommunity";
import type { Profile } from "@/shared/api/types";

export function SidebarProfileCard({ activeCommunity, onOpenSettings, onSignOut, profile, resolvedDisplayName }: {
  activeCommunity: Community; onOpenSettings: () => void; onSignOut: () => void;
  profile?: Profile; resolvedDisplayName: string;
}) {
  const cache = useSelfProfileCache();
  const avatar = (testId?: string) => <ProfileAvatar avatarDataUrl={cache?.avatarDataUrl ?? null}
    avatarUrl={profile?.avatarUrl ?? null} className="h-8 w-8 text-xs" iconClassName="h-4 w-4"
    label={resolvedDisplayName} testId={testId} />;
  // DD-120: the original AppShell presence session and own 30315 through the native presence
  // host (this device's key, direct Relay). Without a host the original controls stay hidden.
  const session = useNativeSession();
  const presenceHost = usePresenceHost();
  const presence = useSelfPresence();
  const selfPubkey = presenceHost ? session.devicePubkey.toLowerCase() : undefined;
  const selfStatus = useUserStatusQuery(selfPubkey ? [selfPubkey] : []);
  const setUserStatus = useSetUserStatusMutation(selfPubkey);
  const statusFailed = (error: unknown) => toast.error(translateCurrent(
    isOutcomeUnknown(error) ? "userStatus.saveUnknown" : "userStatus.saveFailed"));
  const publishStatus = (input: UserStatusInput) => setUserStatus.mutate(input, { onError: statusFailed });
  return <SharedSidebarProfileCard communityLabel={activeCommunity.name}
    onOpenSettings={onOpenSettings} onSignOut={onSignOut} resolvedDisplayName={resolvedDisplayName}
    avatar={avatar("sidebar-profile-avatar")} popoverAvatar={avatar()}
    selfPresenceStatus={presence?.currentStatus} isPresencePending={presence?.isPending}
    onSetPresenceStatus={presence ? (status) => {
      void presence.setStatus(status).catch(() => toast.error(translateCurrent("presence.updateFailed")));
    } : undefined}
    selfUserStatus={selfPubkey ? visibleUserStatus(selfStatus.data?.[selfPubkey]) ?? undefined : undefined}
    onSetUserStatus={selfPubkey ? publishStatus : undefined}
    onClearUserStatus={selfPubkey ? () => publishStatus({ text: "", emoji: "" }) : undefined} />;
}
