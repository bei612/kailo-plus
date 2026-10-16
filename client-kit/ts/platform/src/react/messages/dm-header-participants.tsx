// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelScreenHeader.tsx::DmHeaderParticipantStack
// and its single-participant ProfileAvatarWithStatus. DD-120 (5): the badge shows the
// person's presence aggregated over all their bound keys; without a presence host or a
// presence fact the avatar stays unbadged (the original's `?? "offline"` is not inherited).
// Agents keep their installation-active presence and get no Relay badge here.
import { Fragment, type ReactNode } from "react";
import { getDmParticipantPreview } from "../conversations/dm-participant-display";
import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { usePresenceHost } from "../presence/context";
import { usePresenceQuery } from "../presence/hooks";
import { aggregatePresence } from "../presence/lib/presence";
import {
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  ProfileAvatarWithStatus,
  scaleProfileAvatarStatusGeometry,
} from "../presence/ui/ProfileAvatarWithStatus";
import { UserAvatar } from "./UserAvatar";
import { MaskedAvatarBadgeFrame, STATUS_DOT_MASK_CURVE } from "./thread/MaskedAvatarBadgeFrame";

export type DmHeaderParticipant = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent?: boolean;
  profilePubkey?: string;
  /** Every admitted key of this person; any online key makes the person online. */
  presencePubkeys?: readonly string[];
};

const DM_HEADER_AVATAR_SIZE = 32;
const DM_HEADER_AVATAR_STATUS_GEOMETRY = scaleProfileAvatarStatusGeometry(
  DEFAULT_HOVER_PROFILE_STATUS_GEOMETRY,
  DM_HEADER_AVATAR_SIZE,
);

function participantPresenceKeys(participant: DmHeaderParticipant): readonly string[] {
  if (participant.presencePubkeys && participant.presencePubkeys.length > 0) return participant.presencePubkeys;
  return participant.profilePubkey ? [participant.profilePubkey] : [];
}

function DmPresenceAvatar({ participant, pubkeys, title }: {
  participant: DmHeaderParticipant; pubkeys: readonly string[]; title: string;
}) {
  const presence = usePresenceQuery(pubkeys);
  return <ProfileAvatarWithStatus avatarClassName="text-xs" avatarUrl={participant.avatarUrl}
    className="mr-1.5 h-8 w-8" geometry={DM_HEADER_AVATAR_STATUS_GEOMETRY} iconClassName="h-4 w-4"
    label={title} shape="circle" size={DM_HEADER_AVATAR_SIZE}
    status={aggregatePresence(presence.isSuccess ? presence.data : undefined, pubkeys)}
    statusTestId="chat-presence-badge" testId="chat-header-dm-avatar" />;
}

export function DmHeaderParticipants({ participants, title, renderIdentity }: {
  participants: readonly DmHeaderParticipant[];
  title: string;
  renderIdentity?: (participant: DmHeaderParticipant, avatar: ReactNode) => ReactNode;
}) {
  const presenceHost = usePresenceHost();
  if (participants.length === 0) return null;
  if (participants.length === 1) {
    const participant = participants[0]!;
    const presenceKeys = participantPresenceKeys(participant);
    const avatar = presenceHost && !participant.isAgent && presenceKeys.length > 0
      ? <DmPresenceAvatar participant={participant} pubkeys={presenceKeys} title={title} />
      : <MaskedAvatarBadgeFrame className="inline-flex mr-1.5 h-8 w-8"
        curve={STATUS_DOT_MASK_CURVE} shape={participant.isAgent ? "squircle" : "circle"} size={DM_HEADER_AVATAR_SIZE}
        clipTestId="chat-header-dm-avatar-mask">
        <ProfileAvatar avatarUrl={participant.avatarUrl} className="h-full w-full text-xs" iconClassName="h-4 w-4"
          label={title} shape={participant.isAgent ? "squircle" : "circle"} testId="chat-header-dm-avatar" />
      </MaskedAvatarBadgeFrame>;
    return renderIdentity ? renderIdentity(participant, avatar) : avatar;
  }
  const { hiddenCount, visibleParticipants } = getDmParticipantPreview(participants);
  const stackItemCount = visibleParticipants.length + (hiddenCount > 0 ? 1 : 0);
  return <div className="mr-1.5 flex shrink-0 items-center" data-testid="chat-header-dm-avatar-stack">
    {visibleParticipants.map((participant, index) => {
      const avatar = <span className={index > 0 ? "-ml-2" : ""} data-testid="chat-header-dm-avatar-stack-participant"
        style={{ zIndex: index + 1 }}>
        <UserAvatar accent={participant.isAgent === true} avatarUrl={participant.avatarUrl}
          className={index < stackItemCount - 1 ? "h-8 w-8 text-xs ring-2 ring-background" : "h-8 w-8 text-xs"}
          displayName={participant.displayName} shape={participant.isAgent ? "squircle" : "circle"} size="sm" />
      </span>;
      return <Fragment key={participant.id}>{renderIdentity ? renderIdentity(participant, avatar) : avatar}</Fragment>;
    })}
    {hiddenCount > 0 ? <div className={visibleParticipants.length > 0 ? "-ml-2" : ""}
      data-testid="chat-header-dm-avatar-stack-more" style={{ zIndex: stackItemCount }}>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground shadow-xs">
        <span className="text-2xs leading-none">+{hiddenCount}</span>
      </span>
    </div> : null}
  </div>;
}
