import * as React from "react";

import { useSelfProfileCache } from "@/features/profile/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { ProfilePopover } from "@/features/profile/ui/ProfilePopover";
import type { Community } from "@/features/kailo/activeCommunity";
import type { Profile } from "@/shared/api/types";

type SidebarProfileCardProps = {
  activeCommunity: Community;
  onOpenSettings: () => void;
  onSignOut: () => void;
  profile?: Profile;
  resolvedDisplayName: string;
};

export function SidebarProfileCard({
  activeCommunity,
  onOpenSettings,
  onSignOut,
  profile,
  resolvedDisplayName,
}: SidebarProfileCardProps) {
  const selfProfileCache = useSelfProfileCache();
  const [profilePopoverOpen, setProfilePopoverOpen] = React.useState(false);
  const profileCardRef = React.useRef<HTMLDivElement | null>(null);
  const toggleProfilePopover = React.useCallback(
    () => setProfilePopoverOpen((prev) => !prev),
    [],
  );
  const handleCardClick = React.useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !(target instanceof Node) ||
        !profileCardRef.current?.contains(target)
      ) {
        return;
      }
      toggleProfilePopover();
    },
    [toggleProfilePopover],
  );
  const communityLabel = activeCommunity.name;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: child buttons provide keyboard access; wrapper fills pointer gaps between them.
    <div
      className="group/profile-card cursor-pointer rounded-xl px-2 py-2 transition-colors hover:bg-sidebar-border/35"
      data-testid="sidebar-profile-card"
      onClick={handleCardClick}
      ref={profileCardRef}
    >
      <div className="flex min-w-0 items-center gap-3">
        <button
          aria-label={`Open profile menu for ${resolvedDisplayName}`}
          className="relative shrink-0 rounded-xl outline-hidden focus:outline-none focus-visible:outline-none"
          data-testid="sidebar-profile-avatar-button"
          onClick={(event) => {
            event.stopPropagation();
            toggleProfilePopover();
          }}
          type="button"
        >
          <ProfileAvatar
            avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
            avatarUrl={profile?.avatarUrl ?? null}
            className="h-8 w-8 text-xs"
            iconClassName="h-4 w-4"
            label={resolvedDisplayName}
            testId="sidebar-profile-avatar"
          />
        </button>

        <div className="min-w-0 flex-1">
          <ProfilePopover
            open={profilePopoverOpen}
            onOpenChange={setProfilePopoverOpen}
            avatarDataUrl={selfProfileCache?.avatarDataUrl ?? null}
            avatarUrl={profile?.avatarUrl ?? null}
            displayName={resolvedDisplayName}
            onOpenSettings={onOpenSettings}
            triggerContainerRef={profileCardRef}
            onSignOut={onSignOut}
          >
            <button
              onClick={(event) => {
                event.stopPropagation();
                toggleProfilePopover();
              }}
              className="block w-full min-w-0 rounded-sm text-left text-sidebar-foreground outline-hidden focus:outline-none focus-visible:outline-none"
              data-testid="open-settings"
              type="button"
            >
              <p
                className="truncate text-sm font-semibold leading-tight text-current"
                data-testid="sidebar-profile-name"
              >
                {resolvedDisplayName}
              </p>
            </button>
          </ProfilePopover>

          <div className="relative mt-0.5">
            <span
              className="flex min-w-0 cursor-pointer items-center gap-1 text-xs leading-snug text-sidebar-foreground/70"
              data-buzz-sidebar-secondary
            >
              <span
                aria-hidden="true"
                className="flex w-3.5 shrink-0 items-center justify-center text-2xs"
              >
                <span className="-translate-y-px leading-normal">🐝</span>
              </span>
              <span className="truncate">{communityLabel}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
