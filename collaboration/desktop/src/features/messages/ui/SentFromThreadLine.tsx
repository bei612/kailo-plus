import * as React from "react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { SentFromThreadLine as SharedSentFromThreadLine } from "@client-kit/platform/react/messages";
import { useChannelNavigation } from "@/shared/context/ChannelNavigationContext";
import type { ParsedMessageLink } from "@/features/messages/lib/messageLink";
import { MessageLinkPill } from "@/shared/ui/markdown/MessageLinkPill";

export function SentFromThreadLine({
  channelId,
  tags,
}: {
  channelId?: string | null;
  tags?: string[][];
}) {
  const { channels } = useChannelNavigation();
  const { goChannel } = useAppNavigation();
  const onOpenMessageLink = React.useCallback(
    (target: ParsedMessageLink) => {
      void goChannel(target.channelId, {
        messageId: target.messageId,
        threadRootId: target.threadRootId,
      });
    },
    [goChannel],
  );

  return (
    <SharedSentFromThreadLine
      channelId={channelId}
      tags={tags}
      renderLink={(link, threadExcerpt) => (
        <MessageLinkPill
          channels={channels}
          interactive
          link={link}
          onOpenChannel={(targetChannelId) => {
            void goChannel(targetChannelId);
          }}
          onOpenMessageLink={onOpenMessageLink}
          resolveChannelReference
          threadExcerpt={threadExcerpt}
          variant="sent-from-thread"
        />
      )}
    />
  );
}
