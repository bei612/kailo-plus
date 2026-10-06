import type { ComponentProps } from "react";
import { ChannelContextMenuItems as SharedChannelContextMenuItems } from "@client-kit/platform/react/sidebar/channel-context-menu";
import { useAppShell } from "@/app/AppShellContext";
import { copyTextToClipboard } from "@/shared/lib/clipboard";

export function ChannelContextMenuItems(props: Omit<ComponentProps<typeof SharedChannelContextMenuItems>, "onCopy">) {
  const { feedItemState, hasSidebarUnreadProjections, locallyUnreadFeedItems, unreadThreadChannelIds } = useAppShell();
  const hasUnread = props.hasUnread || (hasSidebarUnreadProjections && unreadThreadChannelIds.has(props.channel.id));
  return <SharedChannelContextMenuItems {...props} hasUnread={hasUnread} onCopy={copyTextToClipboard}
    onMarkChannelRead={props.onMarkChannelRead ? (id, at) => {
      for (const item of locallyUnreadFeedItems) {
        if (item.channelId === id && feedItemState.unreadSet.has(item.id)) feedItemState.undoUnread(item.id);
      }
      props.onMarkChannelRead?.(id, at);
    } : undefined} />;
}
