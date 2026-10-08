// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/channels/lib/dmParticipantDisplay.ts: original display rule.
import { translateCurrent } from "../../i18n";
import type { Translate } from "../context";

export const DM_PARTICIPANT_PREVIEW_LIMIT = 3;

export type DmParticipantDisplay = {
  displayName: string;
};

export function getDmParticipantPreview<T>(participants: readonly T[]) {
  const visibleParticipants = participants.slice(0, DM_PARTICIPANT_PREVIEW_LIMIT);
  return {
    hiddenCount: Math.max(0, participants.length - DM_PARTICIPANT_PREVIEW_LIMIT),
    visibleParticipants,
  };
}

export function formatDmParticipantDisplayName(
  participants: readonly DmParticipantDisplay[],
  t: Translate = translateCurrent,
) {
  const { hiddenCount, visibleParticipants } = getDmParticipantPreview(participants);
  const names = visibleParticipants.map((participant) => participant.displayName);
  return hiddenCount > 0
    ? [...names, t("dm.moreParticipants", { count: hiddenCount })].join(", ")
    : names.join(", ");
}
