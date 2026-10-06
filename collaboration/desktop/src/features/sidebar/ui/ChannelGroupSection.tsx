import { ChannelGroupSection as SharedChannelGroupSection } from "@client-kit/platform/react/sidebar/channel-group";
import type { ChannelSortMode } from "@/features/sidebar/lib/channelSortPreference";
import type { Channel } from "@/shared/api/types";
import { ChannelContextMenuItems } from "./ChannelContextMenu";
import { ChannelMenuButton } from "./ChannelMenuButton";

export function ChannelGroupSection({
  hasUnread,
  isCollapsed,
  isActiveChannel,
  items,
  listTestId,
  onMarkAllRead,
  onMarkChannelRead,
  onMarkChannelUnread,
  onSelectChannel,
  onToggleCollapsed,
  selectedChannelId,
  sortMode,
  onSortModeChange,
  actionsTestId,
  title,
  onCreateChannel,
  createChannelLabel,
  unreadChannelIds,
  mutedChannelIds,
  onMuteChannel,
  onUnmuteChannel,
  starredChannelIds,
  onStarChannel,
  onUnstarChannel,
}: {
  hasUnread: boolean;
  isCollapsed: boolean;
  isActiveChannel: boolean;
  items: Channel[];
  listTestId: string;
  onMarkAllRead: () => void;
  onMarkChannelRead: (
    channelId: string,
    lastMessageAt: string | null | undefined,
  ) => void;
  onMarkChannelUnread: (channelId: string) => void;
  onSelectChannel: (channelId: string) => void;
  onToggleCollapsed: () => void;
  selectedChannelId: string | null;
  sortMode: ChannelSortMode;
  onSortModeChange: (mode: ChannelSortMode) => void;
  actionsTestId: string;
  title: string;
  onCreateChannel?: () => void;
  createChannelLabel?: string;
  unreadChannelIds: ReadonlySet<string>;
  mutedChannelIds?: ReadonlySet<string>;
  onMuteChannel?: (channelId: string) => void;
  onUnmuteChannel?: (channelId: string) => void;
  starredChannelIds?: ReadonlySet<string>;
  onStarChannel?: (channelId: string) => void;
  onUnstarChannel?: (channelId: string) => void;
}) {
  return <SharedChannelGroupSection
    hasUnread={hasUnread} isCollapsed={isCollapsed} items={items} listTestId={listTestId}
    onMarkAllRead={onMarkAllRead} onToggleCollapsed={onToggleCollapsed}
    sortMode={sortMode} onSortModeChange={onSortModeChange} actionsTestId={actionsTestId}
    title={title} onCreateChannel={onCreateChannel} createChannelLabel={createChannelLabel}
    renderRow={(channel) => <ChannelMenuButton channel={channel}
      hasUnread={unreadChannelIds.has(channel.id)} isMuted={mutedChannelIds?.has(channel.id)}
      isActive={isActiveChannel && selectedChannelId === channel.id} onSelectChannel={onSelectChannel} />}
    renderContextMenu={(channel) => <ChannelContextMenuItems channel={channel}
      hasUnread={unreadChannelIds.has(channel.id)} isMuted={mutedChannelIds?.has(channel.id)}
      isStarred={starredChannelIds?.has(channel.id)} onMarkChannelRead={onMarkChannelRead}
      onMarkChannelUnread={onMarkChannelUnread} onMuteChannel={onMuteChannel}
      onUnmuteChannel={onUnmuteChannel} onStarChannel={onStarChannel} onUnstarChannel={onUnstarChannel} />}
  />;
}
