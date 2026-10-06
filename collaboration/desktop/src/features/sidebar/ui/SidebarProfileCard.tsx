import { SidebarProfileCard as SharedSidebarProfileCard } from "@client-kit/platform/react/sidebar/sidebar-profile-card";
import { useSelfProfileCache } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import type { Community } from "@/features/platform/activeCommunity";
import type { Profile } from "@/shared/api/types";
export function SidebarProfileCard({ activeCommunity, onOpenSettings, onSignOut, profile, resolvedDisplayName }: {
  activeCommunity: Community; onOpenSettings: () => void; onSignOut: () => void;
  profile?: Profile; resolvedDisplayName: string;
}) {
  const cache = useSelfProfileCache();
  const avatar = (testId?: string) => <ProfileAvatar avatarDataUrl={cache?.avatarDataUrl ?? null}
    avatarUrl={profile?.avatarUrl ?? null} className="h-8 w-8 text-xs" iconClassName="h-4 w-4"
    label={resolvedDisplayName} testId={testId} />;
  return <SharedSidebarProfileCard communityLabel={activeCommunity.name}
    onOpenSettings={onOpenSettings} onSignOut={onSignOut} resolvedDisplayName={resolvedDisplayName}
    avatar={avatar("sidebar-profile-avatar")} popoverAvatar={avatar()} />;
}
