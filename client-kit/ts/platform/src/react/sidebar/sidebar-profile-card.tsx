import { useUiT } from "../context";
// Extracted from Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src; host authority remains outside this presentation module.
// desktop/src/features/sidebar/ui/SidebarProfileCard.tsx: the self presence badge on the avatar and
// the status line that swaps with the community label on hover are restored for DD-120 when the
// host supplies the person's presence session and status.
import { Building2 } from "lucide-react";
import * as React from "react";

import { MaskedAvatarBadgeFrame, STATUS_DOT_MASK_CURVE } from "../messages/thread/MaskedAvatarBadgeFrame";
import { getPresenceLabelKey, type PresenceStatus } from "../presence/lib/presence";
import { PresenceDot } from "../presence/ui/PresenceBadge";
import { cn } from "../profile/buzz/shared/lib/cn";
import type { UserStatus, UserStatusInput } from "../user-status/types";
import { StatusEmoji } from "../user-status/ui/StatusEmoji";
import { ProfilePopover } from "./profile-popover";

type SidebarProfileCardProps = {
  communityLabel: string;
  avatar: React.ReactNode;
  popoverAvatar: React.ReactNode;
  onOpenSettings: () => void;
  onSignOut: () => void;
  resolvedDisplayName: string;
  /** DD-120 presence session of the signed-in person; omitted when the host has none. */
  selfPresenceStatus?: PresenceStatus;
  isPresencePending?: boolean;
  onSetPresenceStatus?: (status: PresenceStatus) => void;
  /** The person's own visible status (already filtered by visibleUserStatus). */
  selfUserStatus?: UserStatus;
  onSetUserStatus?: (status: UserStatusInput) => void;
  onClearUserStatus?: () => void;
};

export function SidebarProfileCard({
  communityLabel,
  avatar,
  popoverAvatar,
  onOpenSettings,
  onSignOut,
  resolvedDisplayName: requestedDisplayName,
  selfPresenceStatus,
  isPresencePending,
  onSetPresenceStatus,
  selfUserStatus,
  onSetUserStatus,
  onClearUserStatus,
}: SidebarProfileCardProps) {
  const translateUi = useUiT();
  const resolvedDisplayName = requestedDisplayName.trim() || translateUi("buzz.currentIdentity");
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
  const hasStatus = Boolean(selfUserStatus?.text || selfUserStatus?.emoji);
  const readonlyCommunityLabel = (
    <span
      className="flex min-w-0 cursor-pointer items-center gap-1 text-xs leading-snug text-sidebar-foreground/70"
      data-buzz-sidebar-secondary
    >
      <span
        aria-hidden="true"
        className="flex w-3.5 shrink-0 items-center justify-center"
      >
        <Building2 className="h-3 w-3" strokeWidth={2} />
      </span>
      <span className="truncate">{communityLabel}</span>
    </span>
  );

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
          aria-label={translateUi("buzz.openProfileMenu", { name: resolvedDisplayName })}
          className="relative shrink-0 rounded-xl outline-hidden focus:outline-none focus-visible:outline-none"
          data-testid="sidebar-profile-avatar-button"
          onClick={(event) => {
            event.stopPropagation();
            toggleProfilePopover();
          }}
          type="button"
        >
          {selfPresenceStatus ? (
            <MaskedAvatarBadgeFrame
              badge={
                <span
                  aria-label={translateUi(getPresenceLabelKey(selfPresenceStatus))}
                  className="flex h-3.5 w-3.5 items-center justify-center rounded-full"
                  data-presence-status={selfPresenceStatus}
                  data-testid="self-presence-badge"
                  role="img"
                >
                  <PresenceDot className="h-2 w-2" status={selfPresenceStatus} />
                </span>
              }
              badgeBox={{ bottom: -2, height: 14, right: -2, width: 14 }}
              className="h-8 w-8"
              curve={STATUS_DOT_MASK_CURVE}
              cutout={{ cx: 28, cy: 28, r: 7.5 }}
              size={32}
            >
              {avatar}
            </MaskedAvatarBadgeFrame>
          ) : avatar}
        </button>

        <div className="min-w-0 flex-1">
          <ProfilePopover
            open={profilePopoverOpen}
            onOpenChange={setProfilePopoverOpen}
            avatar={popoverAvatar}
            displayName={resolvedDisplayName}
            onOpenSettings={onOpenSettings}
            triggerContainerRef={profileCardRef}
            onSignOut={onSignOut}
            currentStatus={selfPresenceStatus}
            isStatusPending={isPresencePending}
            onSetStatus={onSetPresenceStatus}
            userStatusText={selfUserStatus?.text}
            userStatusEmoji={selfUserStatus?.emoji}
            userStatusExpiresAt={selfUserStatus?.expiresAt}
            userStatusUpdatedAt={selfUserStatus?.updatedAt}
            onSetUserStatus={onSetUserStatus}
            onClearUserStatus={onClearUserStatus}
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

          {hasStatus ? (
            <div className="relative mt-0.5">
              <button
                aria-label={translateUi("buzz.openProfileMenu", { name: resolvedDisplayName })}
                className={cn(
                  "flex w-full min-w-0 items-center truncate rounded-sm text-left text-xs leading-snug text-sidebar-foreground/70 outline-hidden transition-opacity duration-150 focus:outline-none focus-visible:outline-none group-hover/profile-card:opacity-0",
                  profilePopoverOpen && "opacity-100",
                )}
                data-buzz-sidebar-secondary
                data-testid="sidebar-profile-user-status"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleProfilePopover();
                }}
                type="button"
              >
                {selfUserStatus?.emoji ? (
                  <StatusEmoji
                    className="mr-1 w-4 shrink-0 text-xs"
                    value={selfUserStatus.emoji}
                  />
                ) : null}
                <span className="truncate">{selfUserStatus?.text}</span>
              </button>
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 flex min-w-0 items-center text-xs leading-snug text-sidebar-foreground/70 opacity-0 transition-opacity duration-150 group-hover/profile-card:opacity-100",
                  profilePopoverOpen && "opacity-0",
                )}
                data-buzz-sidebar-secondary
              >
                {readonlyCommunityLabel}
              </div>
            </div>
          ) : (
            <div className="relative mt-0.5">{readonlyCommunityLabel}</div>
          )}
        </div>
      </div>
    </div>
  );
}
