import {
  Bell,
  BellOff,
  CheckCircle2,
  CircleDot,
  Copy,
  Star,
  StarOff,
} from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import {
  ContextMenuIconSlot,
  deferMenuAction,
} from "@/features/sidebar/ui/sidebarMenuHelpers";
import type { Channel } from "@/shared/api/types";
import { copyTextToClipboard } from "@/shared/lib/clipboard";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/shared/ui/context-menu";

/**
 * The channel context menu's Copy actions, grouped under a single
 * "Copy" submenu (channel name / channel ID).
 */
function CopyChannelSubmenu({ channel }: { channel: Channel }) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <ContextMenuIconSlot>
          <Copy className="h-4 w-4" />
        </ContextMenuIconSlot>
        <span>Copy</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem
          onSelect={() =>
            copyTextToClipboard(
              channel.name,
              "Channel name copied to clipboard",
            )
          }
        >
          <span>Copy channel name</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            copyTextToClipboard(channel.id, "Channel ID copied to clipboard")
          }
        >
          <span>Copy channel ID</span>
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export function ChannelContextMenuItems({
  channel,
  hasUnread,
  isMuted,
  isStarred,
  onMarkChannelRead,
  onMarkChannelUnread,
  onMuteChannel,
  onUnmuteChannel,
  onStarChannel,
  onUnstarChannel,
}: {
  channel: Channel;
  hasUnread: boolean;
  isMuted?: boolean;
  isStarred?: boolean;
  onMarkChannelRead?: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread?: (channelId: string) => void;
  onMuteChannel?: (channelId: string) => void;
  onUnmuteChannel?: (channelId: string) => void;
  onStarChannel?: (channelId: string) => void;
  onUnstarChannel?: (channelId: string) => void;
}) {
  const {
    feedItemState,
    hasSidebarUnreadProjections,
    locallyUnreadFeedItems,
    unreadThreadChannelIds,
  } = useAppShell();
  const channelUnreadOverrideIds = locallyUnreadFeedItems.flatMap((item) =>
    item.channelId === channel.id && feedItemState.unreadSet.has(item.id)
      ? [item.id]
      : [],
  );
  const hasProjectedUnread =
    hasUnread ||
    (hasSidebarUnreadProjections && unreadThreadChannelIds.has(channel.id));
  const showStar = Boolean(onStarChannel && onUnstarChannel);
  const showReadToggle = hasProjectedUnread
    ? Boolean(onMarkChannelRead)
    : Boolean(onMarkChannelUnread);
  const showMuteToggle = Boolean(onMuteChannel && onUnmuteChannel);

  return (
    <>
      <CopyChannelSubmenu channel={channel} />
      {showReadToggle ? <ContextMenuSeparator /> : null}
      {hasProjectedUnread && onMarkChannelRead ? (
        <ContextMenuItem
          onSelect={() =>
            deferMenuAction(() => {
              for (const itemId of channelUnreadOverrideIds) {
                feedItemState.undoUnread(itemId);
              }
              onMarkChannelRead(channel.id, channel.lastMessageAt);
            })
          }
        >
          <ContextMenuIconSlot>
            <CheckCircle2 className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>Mark as read</span>
        </ContextMenuItem>
      ) : !hasProjectedUnread && onMarkChannelUnread ? (
        <ContextMenuItem
          onSelect={() =>
            deferMenuAction(() => onMarkChannelUnread(channel.id))
          }
        >
          <ContextMenuIconSlot>
            <CircleDot className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>Mark unread</span>
        </ContextMenuItem>
      ) : null}
      {showMuteToggle || showStar ? <ContextMenuSeparator /> : null}
      {showMuteToggle ? (
        isMuted ? (
          <ContextMenuItem
            onSelect={() =>
              deferMenuAction(() => onUnmuteChannel?.(channel.id))
            }
          >
            <ContextMenuIconSlot>
              <Bell className="h-4 w-4" />
            </ContextMenuIconSlot>
            <span>Unmute channel</span>
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onSelect={() => deferMenuAction(() => onMuteChannel?.(channel.id))}
          >
            <ContextMenuIconSlot>
              <BellOff className="h-4 w-4" />
            </ContextMenuIconSlot>
            <span>Mute channel</span>
          </ContextMenuItem>
        )
      ) : null}
      {showStar ? (
        isStarred ? (
          <ContextMenuItem
            onSelect={() =>
              deferMenuAction(() => onUnstarChannel?.(channel.id))
            }
          >
            <ContextMenuIconSlot>
              <StarOff className="h-4 w-4" />
            </ContextMenuIconSlot>
            <span>Unstar channel</span>
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onSelect={() => deferMenuAction(() => onStarChannel?.(channel.id))}
          >
            <ContextMenuIconSlot>
              <Star className="h-4 w-4" />
            </ContextMenuIconSlot>
            <span>Star channel</span>
          </ContextMenuItem>
        )
      ) : null}
    </>
  );
}
