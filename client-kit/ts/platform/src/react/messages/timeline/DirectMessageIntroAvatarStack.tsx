// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/messages/ui/DirectMessageIntroAvatarStack.tsx.
// Hosts retain authorized avatar/profile reads; the original stack is shared.
import type * as React from "react";
import { getDmParticipantPreview } from "../../conversations/dm-participant-display";

// A human's device keys are not separate people. Hosts supply the admitted
// Principal key; a profile pubkey exists only when its actual read is authorized.
export type DirectMessageIntroPerson = {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  pubkey?: string;
  isAgent?: boolean;
};

export type DirectMessageParticipantRenderer = (
  participant: DirectMessageIntroPerson,
  avatarClassName: string,
) => React.ReactNode;

export function DirectMessageIntroAvatarStack({
  participants,
  renderParticipant,
}: {
  participants: DirectMessageIntroPerson[];
  renderParticipant: DirectMessageParticipantRenderer;
}) {
  const { hiddenCount, visibleParticipants } =
    getDmParticipantPreview(participants);
  const stackItemCount = visibleParticipants.length + (hiddenCount > 0 ? 1 : 0);

  return (
    <div
      className="flex shrink-0 items-center"
      data-testid="message-dm-intro-avatar-stack"
    >
      {visibleParticipants.map((participant, index) => (
        <span
          key={participant.id}
          className={index > 0 ? "-ml-5" : ""}
          data-testid="message-dm-intro-avatar-stack-participant"
          style={{ zIndex: index + 1 }}
        >
          {renderParticipant(
            participant,
            index < stackItemCount - 1
              ? "h-[60px] w-[60px] text-base ring-2 ring-background"
              : "h-[60px] w-[60px] text-base",
          )}
        </span>
      ))}
      {hiddenCount > 0 ? (
        <div
          className={visibleParticipants.length > 0 ? "-ml-5" : ""}
          data-testid="message-dm-intro-avatar-stack-more"
          style={{ zIndex: stackItemCount }}
        >
          <span className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground shadow-xs">
            <span className="text-lg leading-none">+{hiddenCount}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}
