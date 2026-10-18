// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/sidebar/ui/SidebarSection.tsx::{SidebarDmParticipant,DmChannelIcon} and the
// AppSidebar dmPresenceByChannelId batch. DD-120 (5): presence is aggregated over each person's
// admitted keys from one lookup for the whole list; without a presence host or a presence fact
// the avatar stays unbadged (the original's offline default is not inherited).
import type { ReactNode } from "react";
import { CircleDot } from "lucide-react";
import { usePresenceQuery } from "../presence/hooks";
import { aggregatePresence, type PresenceLookup, type PresenceStatus } from "../presence/lib/presence";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "../presence/ui/ProfileAvatarWithStatus";

export type SidebarDmParticipant = {
  avatarUrl: string | null;
  label: string;
  isAgent?: boolean;
  /** Every admitted key of the person. */
  pubkeys: readonly string[];
};

const DM_AVATAR_SIZE = 24;
const DM_AVATAR_STATUS_GEOMETRY = scaleProfileAvatarStatusGeometry(
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  DM_AVATAR_SIZE,
);

export function DmChannelIcon({
  channelName,
  isPair,
  participants,
  presenceStatus,
}: {
  channelName: string;
  isPair: boolean;
  participants?: readonly SidebarDmParticipant[];
  presenceStatus?: PresenceStatus;
}) {
  const primaryParticipant = participants?.[0];

  if (!primaryParticipant) {
    return <CircleDot className="h-4 w-4" />;
  }

  if (!isPair && participants && participants.length > 1) {
    return (
      <span
        aria-hidden="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sidebar-accent/80 text-2xs font-semibold leading-none text-sidebar-foreground shadow-none"
        data-testid={`channel-dm-count-${channelName}`}
      >
        <span className="translate-x-px leading-none">
          {participants.length}
        </span>
      </span>
    );
  }

  return (
    <span className="relative flex h-6 w-6 shrink-0 items-center justify-center">
      <ProfileAvatarWithStatus
        avatarClassName="bg-sidebar-accent/80 text-2xs text-sidebar-foreground shadow-none"
        avatarUrl={primaryParticipant.avatarUrl}
        className="h-6 w-6"
        geometry={DM_AVATAR_STATUS_GEOMETRY}
        iconClassName="h-3.5 w-3.5"
        label={primaryParticipant.label}
        shape={primaryParticipant.isAgent ? "squircle" : "circle"}
        size={DM_AVATAR_SIZE}
        status={presenceStatus}
        statusTestId={`channel-presence-${channelName}`}
        testId={`channel-avatar-${channelName}`}
      />
    </span>
  );
}

/** One presence lookup for every 1:1 DM participant; mount only under a presence host. */
export function DmPresenceLookup({ pubkeys, children }: {
  pubkeys: readonly string[];
  children: (lookup: PresenceLookup | undefined) => ReactNode;
}) {
  const presence = usePresenceQuery(pubkeys);
  return <>{children(presence.isSuccess ? presence.data : undefined)}</>;
}

/** The pair participant's presence, aggregated over all of their admitted keys. */
export function dmPresenceStatus(
  lookup: PresenceLookup | undefined,
  isPair: boolean,
  participants: readonly SidebarDmParticipant[],
): PresenceStatus | undefined {
  const participant = participants[0];
  if (!participant || participant.isAgent || !(isPair || participants.length === 1)) return undefined;
  return aggregatePresence(lookup, participant.pubkeys);
}
