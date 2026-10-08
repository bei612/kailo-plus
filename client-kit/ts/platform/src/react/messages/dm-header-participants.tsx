// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/ChannelScreenHeader.tsx::DmHeaderParticipantStack
// and its single-participant ProfileAvatarWithStatus (without unproven presence).
import { Fragment, type ReactNode } from "react";
import { getDmParticipantPreview } from "../conversations/dm-participant-display";
import { ProfileAvatar } from "../profile/buzz/features/profile/ui/ProfileAvatar";
import { UserAvatar } from "./UserAvatar";
import { MaskedAvatarBadgeFrame, STATUS_DOT_MASK_CURVE } from "./thread/MaskedAvatarBadgeFrame";

export type DmHeaderParticipant = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  isAgent?: boolean;
  profilePubkey?: string;
};

const DM_HEADER_AVATAR_SIZE = 32;

export function DmHeaderParticipants({ participants, title, renderIdentity }: {
  participants: readonly DmHeaderParticipant[];
  title: string;
  renderIdentity?: (participant: DmHeaderParticipant, avatar: ReactNode) => ReactNode;
}) {
  if (participants.length === 0) return null;
  if (participants.length === 1) {
    const participant = participants[0]!;
    const avatar = <MaskedAvatarBadgeFrame className="inline-flex mr-1.5 h-8 w-8"
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
