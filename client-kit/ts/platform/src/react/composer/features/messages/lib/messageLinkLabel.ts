// Extracted from the pinned Buzz fork; original authority 779af8886caae1317b4de962082429867ab61503, desktop/src/features/messages/lib/messageLinkLabel.ts.
export type MessageLinkLabelVariant = "default" | "sent-from-thread";

export const MESSAGE_LINK_PREFIX = "Thread in";

export function getMessageLinkChannelLabel(channelName: string): string {
  return `#${channelName}`;
}

export function getMessageLinkLabel({
  channelName,
  threadExcerpt,
  variant = "default",
}: {
  channelName: string;
  threadExcerpt?: string | null;
  variant?: MessageLinkLabelVariant;
}): string {
  const normalizedExcerpt = threadExcerpt?.trim();
  const baseLabel = `${MESSAGE_LINK_PREFIX} ${getMessageLinkChannelLabel(channelName)}`;
  if (variant === "sent-from-thread") {
    return normalizedExcerpt ?? baseLabel;
  }
  return normalizedExcerpt ? `${baseLabel} — ${normalizedExcerpt}` : baseLabel;
}
