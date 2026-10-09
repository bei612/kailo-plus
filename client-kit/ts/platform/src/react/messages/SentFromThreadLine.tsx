// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/messages/ui/SentFromThreadLine.tsx::SentFromThreadLine.
import type { ReactNode } from "react";

import type { ParsedMessageLink } from "../composer/features/messages/lib/messageLink";
import { MESSAGE_MARKDOWN_CLASS } from "../composer/shared/ui/mentionChip";
import { useUiT } from "../context";
import { getSentFromThreadReference } from "./sentFromThread";

export function SentFromThreadLine({
  channelId,
  tags,
  renderLink,
}: {
  channelId?: string | null;
  tags?: readonly (readonly string[])[];
  renderLink: (link: ParsedMessageLink, threadExcerpt: string | null) => ReactNode;
}) {
  const t = useUiT();
  const reference = getSentFromThreadReference(tags);
  if (!channelId || !reference) return null;

  const link: ParsedMessageLink = {
    channelId,
    messageId: reference.rootEventId,
    threadRootId: reference.rootEventId,
  };

  return (
    <div
      className={`${MESSAGE_MARKDOWN_CLASS} mb-1 flex min-h-[var(--inline-chip-min-height)] min-w-0 items-center gap-1.5 pt-0.5 text-sm font-normal leading-4 text-muted-foreground/70`}
      data-testid="sent-from-thread"
    >
      <span className="shrink-0">{t("message.sentFromThread")}</span>
      {renderLink(link, reference.rootExcerpt)}
    </div>
  );
}
