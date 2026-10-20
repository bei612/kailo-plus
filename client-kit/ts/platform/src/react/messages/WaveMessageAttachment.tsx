// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/messages/ui/WaveMessageAttachment.tsx::WaveMessageAttachment
// desktop/src/features/messages/ui/MessageRow.tsx (a wave body renders this card instead)
// DD-125(3): the original wave card. "Start huddle" is the governed huddle.start for the
// conversation on screen (the host's HuddleParent and its original channel name); a private
// conversation has no Agents to pre-select. Without a Huddle host the card keeps its title
// only, never a disabled placeholder action.
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useUiT } from "../context";
import { HighlightedSearchText } from "../search/HighlightedSearchText";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "../composer/shared/ui/attachment";
import { huddleActionErrorKey } from "../../huddle";
import { useOptionalHuddle } from "../huddle/HuddleContext";
import { useHasHuddleHost, useHuddleParent, useHuddleParentChannelName, useHuddleUnavailableReason } from "../huddle/host";
import { huddleParentQueryKey } from "../huddle/queries";
import { waveFallbackName } from "./waveMessage";

type WaveMessageAttachmentProps = {
  fallbackText: string;
  searchQuery?: string;
};

export function WaveMessageAttachment({
  fallbackText,
  searchQuery,
}: WaveMessageAttachmentProps) {
  const t = useUiT();
  const queryClient = useQueryClient();
  const hosted = useHasHuddleHost();
  const huddle = useOptionalHuddle();
  const parent = useHuddleParent();
  const channelName = useHuddleParentChannelName();
  const unavailableReason = useHuddleUnavailableReason();
  const canStart = hosted && huddle !== null && parent !== null;
  // Same availability as the channel header HuddleIndicator: say why instead of failing on click.
  const unavailableLabel = unavailableReason === "insecure-context" ? t("huddle.unavailable.insecure")
    : unavailableReason === "codec-unsupported" ? t("huddle.unavailable.codec") : null;
  const startHuddleDisabled = unavailableLabel !== null
    || !huddle || !parent || !channelName || huddle.isStarting || Boolean(huddle.activeEphemeralChannelId);
  const senderName = waveFallbackName(fallbackText);
  const title = fallbackText === "Someone waved at you." ? t("messages.wave.someone")
    : senderName ? t("messages.wave.title", { name: senderName }) : fallbackText;

  const handleStartHuddle = React.useCallback(
    async (event: React.MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (startHuddleDisabled || !huddle || !parent || !channelName) {
        return;
      }

      try {
        await huddle.startHuddle(parent, [], channelName);
        await queryClient.invalidateQueries({ queryKey: huddleParentQueryKey(parent) });
      } catch (error) {
        // Original formatHuddleActionError(error, "start").
        const formatted = huddleActionErrorKey(error, "start");
        toast.error("key" in formatted ? t(formatted.key) : formatted.message);
      }
    },
    [channelName, huddle, parent, queryClient, startHuddleDisabled, t],
  );

  return (
    <Attachment
      className="buzz-wave-hover-trigger mt-1 max-w-md"
      data-testid="message-wave-attachment"
      size="default"
    >
      <AttachmentMedia aria-hidden="true" className="text-lg">
        <span className="buzz-wave-hand">👋</span>
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>
          <HighlightedSearchText
            query={searchQuery ?? ""}
            text={title}
          />
        </AttachmentTitle>
        {canStart ? (
          <AttachmentDescription>
            {unavailableLabel ?? t("messages.wave.description")}
          </AttachmentDescription>
        ) : null}
      </AttachmentContent>
      {canStart ? (
        <AttachmentActions>
          <AttachmentAction
            disabled={startHuddleDisabled}
            onClick={handleStartHuddle}
            size="xs"
            type="button"
          >
            {t("huddle.start")}
          </AttachmentAction>
        </AttachmentActions>
      ) : null}
    </Attachment>
  );
}
