// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/shared/ui/markdown/MessageLinkPill.tsx::MessageLinkPillContents,
// original sent-from-thread branch and segmentLinkLabel.
import * as React from "react";

import type { ParsedMessageLink } from "../composer/features/messages/lib/messageLink";
import { getMessageLinkLabel } from "../composer/features/messages/lib/messageLinkLabel";
import { useUiT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";

const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;
const emojiGraphemePattern = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\uFE0F\u20E3])/u;

function segmentLinkLabel(label: string): Array<{
  isEmoji: boolean;
  start: number;
  text: string;
}> {
  const segments: Array<{ isEmoji: boolean; start: number; text: string }> = [];
  const graphemes = graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(label), ({ index, segment }) => ({
        start: index,
        text: segment,
      }))
    : Array.from(label, (text, start) => ({ start, text }));
  for (const { start, text } of graphemes) {
    const isEmoji = emojiGraphemePattern.test(text);
    const previous = segments.at(-1);
    if (previous?.isEmoji === isEmoji) {
      previous.text += text;
    } else {
      segments.push({ isEmoji, start, text });
    }
  }
  return segments;
}

export function SentFromThreadLink({
  channelLabel,
  interactive,
  link,
  onOpenMessageLink,
  threadExcerpt,
}: {
  channelLabel: string;
  interactive: boolean;
  link: ParsedMessageLink;
  onOpenMessageLink?: (link: ParsedMessageLink) => void;
  threadExcerpt?: string | null;
}) {
  const t = useUiT();
  const [isHovered, setIsHovered] = React.useState(false);
  const label = getMessageLinkLabel({
    channelName: channelLabel,
    threadExcerpt,
    variant: "sent-from-thread",
    threadPrefix: t("message.threadIn"),
  });

  if (!interactive || !onOpenMessageLink) {
    return (
      <span className="inline-block max-w-80 truncate" data-message-link="">
        {label}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-message-link=""
      data-hovered={isHovered ? "" : undefined}
      aria-label={t("message.openThreadIn", { channel: channelLabel })}
      title={label}
      className={cn(
        "max-w-80 cursor-pointer truncate",
        "inline-block min-w-0 text-left font-medium text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring",
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => onOpenMessageLink(link)}
    >
      {segmentLinkLabel(label).map((segment) =>
        segment.isEmoji ? (
          <span key={segment.start} data-message-link-emoji="">
            {segment.text}
          </span>
        ) : (
          <span
            key={segment.start}
            className="transition-shadow"
            data-message-link-text=""
            style={{
              boxShadow: isHovered ? "inset 0 -1px 0 currentColor" : "none",
            }}
          >
            {segment.text}
          </span>
        ),
      )}
    </button>
  );
}
