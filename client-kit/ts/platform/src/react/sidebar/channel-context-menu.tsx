// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/ChannelContextMenu.tsx.
// Menu UI is shared. Host adapters own clipboard and read-state writes.
import {
  Bell,
  BellOff,
  CheckCircle2,
  CircleDot,
  Copy,
  Star,
  StarOff,
} from "lucide-react";


import {
  ContextMenuIconSlot,
  deferMenuAction,
} from "./sidebarMenuHelpers";
import type { SidebarChannel as Channel } from "./channel-group";
import { useT } from "../context";

import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "./context-menu";

/**
 * The channel context menu's Copy actions, grouped under a single
 * "Copy" submenu (channel name / channel ID).
 */
function CopyChannelSubmenu({ channel, onCopy }: { channel: Channel; onCopy: (text: string, message: string) => void }) {
  const t = useT();
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <ContextMenuIconSlot>
          <Copy className="h-4 w-4" />
        </ContextMenuIconSlot>
        <span>{t("sidebar.copy")}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <ContextMenuItem
          onSelect={() =>
            onCopy(
              channel.name,
              t("sidebar.copiedName"),
            )
          }
        >
          <span>{t("sidebar.copyName")}</span>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() =>
            onCopy(channel.id, t("sidebar.copiedId"))
          }
        >
          <span>{t("sidebar.copyId")}</span>
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
  onCopy,
}: {
  onCopy: (text: string, message: string) => void;
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
  const t = useT();
  const hasProjectedUnread = hasUnread;
  const showStar = Boolean(onStarChannel && onUnstarChannel);
  const showReadToggle = hasProjectedUnread
    ? Boolean(onMarkChannelRead)
    : Boolean(onMarkChannelUnread);
  const showMuteToggle = Boolean(onMuteChannel && onUnmuteChannel);

  return (
    <>
      <CopyChannelSubmenu channel={channel} onCopy={onCopy} />
      {showReadToggle ? <ContextMenuSeparator /> : null}
      {hasProjectedUnread && onMarkChannelRead ? (
        <ContextMenuItem
          onSelect={() =>
            deferMenuAction(() => {
              onMarkChannelRead(channel.id, channel.lastMessageAt);
            })
          }
        >
          <ContextMenuIconSlot>
            <CheckCircle2 className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>{t("inbox.markRead")}</span>
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
          <span>{t("inbox.markUnread")}</span>
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
            <span>{t("sidebar.unmute")}</span>
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onSelect={() => deferMenuAction(() => onMuteChannel?.(channel.id))}
          >
            <ContextMenuIconSlot>
              <BellOff className="h-4 w-4" />
            </ContextMenuIconSlot>
            <span>{t("sidebar.mute")}</span>
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
            <span>{t("sidebar.unstar")}</span>
          </ContextMenuItem>
        ) : (
          <ContextMenuItem
            onSelect={() => deferMenuAction(() => onStarChannel?.(channel.id))}
          >
            <ContextMenuIconSlot>
              <Star className="h-4 w-4" />
            </ContextMenuIconSlot>
            <span>{t("sidebar.star")}</span>
          </ContextMenuItem>
        )
      ) : null}
    </>
  );
}
