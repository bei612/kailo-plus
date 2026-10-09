// Shared from Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/shared/ui/markdown/MessageLinkPill.tsx. Only directory, metadata,
// clipboard and navigation are supplied by the admitted host.
import * as React from "react";
import { translateCurrent as t } from "../../../i18n";
import { SentFromThreadLink } from "../SentFromThreadLink";
import { buildMessageLink, type ParsedMessageLink } from "../../composer/features/messages/lib/messageLink";
import { cn } from "../../profile/buzz/shared/lib/cn";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../sidebar/tooltip";
import { truncateInlineChipLabel } from "../../composer/shared/ui/mentionChip";
import { BuzzLinkChip } from "./BuzzLinkChip";
import { useInlineTooltipPosition } from "./useInlineTooltipPosition";

export type MessageLinkMetadataState =
  | { kind: "idle" | "loading" | "deleted" | "unavailable" }
  | { kind: "ready"; author: string; createdAt: number; snippet: string };
export type MessageLinkPillPresentationProps = {
  channel?: { channelType?: string };
  channelLabel?: string;
  copyLink: (href: string) => void;
  metadata: { state: MessageLinkMetadataState };
  href?: string;
  interactive: boolean;
  link: ParsedMessageLink;
  onOpenChannel: (channelId: string) => void;
  onOpenMessageLink: (link: ParsedMessageLink) => void;
  openable?: boolean;
  threadExcerpt?: string | null;
  variant?: "default" | "sent-from-thread";
};

function formatMessageAge(createdAt: number): string {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - createdAt * 1_000) / 60_000),
  );
  if (elapsedMinutes < 1) return t("messageLink.justNow");
  if (elapsedMinutes < 60) return t("messageLink.minutesAgo", { count: elapsedMinutes });
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return t("messageLink.hoursAgo", { count: elapsedHours });
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return t("messageLink.daysAgo", { count: elapsedDays });
  return t("messageLink.weeksAgo", { count: Math.floor(elapsedDays / 7) });
}

function MessageLinkMetadataTooltip({
  children,
  footer,
  metadata,
}: {
  children: React.ReactElement;
  footer: string;
  metadata: { state: MessageLinkMetadataState };
}) {
  const { contentRef, onPointerMove } = useInlineTooltipPosition();
  if (
    metadata.state.kind === "deleted" ||
    metadata.state.kind === "unavailable"
  ) {
    const message =
      metadata.state.kind === "deleted"
        ? t("messageLink.deleted")
        : t("messageLink.unavailable");
    return (
      <TooltipProvider delayDuration={500} skipDelayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild onPointerMove={onPointerMove}>
            {children}
          </TooltipTrigger>
          <TooltipContent ref={contentRef} side="top">
            {message}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  if (metadata.state.kind !== "ready" || !metadata.state.snippet.trim()) {
    return children;
  }
  const content = metadata.state.snippet;
  const sender = metadata.state.author;
  const age = formatMessageAge(metadata.state.createdAt);
  return (
    <TooltipProvider delayDuration={500} skipDelayDuration={0}>
      <Tooltip>
        <TooltipTrigger asChild onPointerMove={onPointerMove}>
          {children}
        </TooltipTrigger>
        <TooltipContent
          ref={contentRef}
          className="w-72 max-w-[min(18rem,calc(100vw-2rem))] px-3 py-2 text-left"
          side="top"
        >
          <span
            className="line-clamp-3 [overflow-wrap:anywhere] whitespace-normal"
            data-buzz-tooltip-metadata-content=""
          >
            {content}
          </span>
          <span
            className="mt-1 block max-w-full truncate whitespace-nowrap text-2xs text-secondary-foreground/80"
            data-buzz-tooltip-metadata-type=""
          >
            {footer}
            {sender ? ` · ${sender}` : null}
            {` · ${age}`}
          </span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function MessageLinkPillPresentation({
  channel,
  copyLink,
  metadata,
  href,
  interactive,
  link,
  onOpenChannel,
  onOpenMessageLink,
  threadExcerpt,
  variant = "default",
  channelLabel: resolvedChannelLabel,
  openable = true,
}: MessageLinkPillPresentationProps) {
  const channelLabel = resolvedChannelLabel ?? link.channelId.slice(0, 8);
  const isSentFromThread = variant === "sent-from-thread";
  const permalink = href ?? buildMessageLink(link);
  const destination =
    channel?.channelType === "dm" ? channelLabel : `#${channelLabel}`;
  const tooltipFooter = link.threadRootId
    ? t("messageLink.threadIn", { destination })
    : channel?.channelType === "dm"
      ? t("messageLink.directMessageWith", { destination })
      : channel?.channelType === "forum"
        ? t("messageLink.forumPostIn", { destination })
        : destination;

  if (!isSentFromThread) {
    // Keep fetched metadata and identity out of the visible label so resolution
    // never changes the chip width.
    const chipLabel = truncateInlineChipLabel(channelLabel);
    const isDeleted = metadata.state.kind === "deleted";
    const chip = (
      <BuzzLinkChip
        copyLink={copyLink}
        data-message-link=""
        data-message-link-state={isDeleted ? "deleted" : undefined}
        href={permalink}
        icon="message"
        aria-label={
          !openable
            ? t("messageLink.inChannel", { channel: channelLabel })
            : isDeleted
              ? link.threadRootId
                ? t("messageLink.openDeletedThread", { channel: channelLabel })
                : t("messageLink.openDeletedChannel", { channel: channelLabel })
              : t("messageLink.openMessage", { channel: channelLabel })
        }
        className={cn(
          metadata.state.kind === "unavailable" && "buzz-link-unavailable",
          isDeleted && "buzz-link-deleted",
        )}
        interactive={openable && interactive}
        onOpenLink={() => {
          if (!openable) return;
          if (!isDeleted) {
            onOpenMessageLink(link);
            return;
          }
          if (link.threadRootId) {
            onOpenMessageLink({
              ...link,
              messageId: link.threadRootId,
              threadRootId: link.threadRootId,
            });
            return;
          }
          onOpenChannel(link.channelId);
        }}
        wrapping
      >
        {chipLabel}
      </BuzzLinkChip>
    );
    return interactive ? (
      <MessageLinkMetadataTooltip footer={tooltipFooter} metadata={metadata}>
        {chip}
      </MessageLinkMetadataTooltip>
    ) : (
      chip
    );
  }

  return (
    <SentFromThreadLink
      channelLabel={channelLabel}
      interactive={interactive && openable}
      link={link}
      onOpenMessageLink={onOpenMessageLink}
      threadExcerpt={threadExcerpt}
    />
  );
}
