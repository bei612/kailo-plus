import type { ComponentProps, ReactNode } from "react";
import { ChannelGroupSection as SharedChannelGroupSection } from "@client-kit/platform/react/sidebar/channel-group";
import type { ChannelContextMenuItems as SharedChannelContextMenuItems } from "@client-kit/platform/react/sidebar/channel-context-menu";
import { DraggableChannelRow } from "@client-kit/platform/react/sidebar/custom-channel-section";
import type { ChannelSortMode } from "@/features/sidebar/lib/channelSortPreference";
import type { Channel } from "@/shared/api/types";
import { ChannelContextMenuItems } from "./ChannelContextMenu";
import { ChannelMenuButton, type DesktopWorkingChannel } from "./ChannelMenuButton";

/**
 * Per-channel extras of the original sidebar context menu (Buzz 779af8886caae1317b4de962082429867ab61503
 * desktop/src/features/sidebar/ui/ChannelContextMenu.tsx): "Move to section" (DD-125(5)) and the
 * DD-119 Leave/Archive entries, resolved by the host for each row.
 */
export type DesktopChannelMenuExtras = Pick<
  ComponentProps<typeof SharedChannelContextMenuItems>,
  "sectionActions" | "onLeaveChannel" | "ownerActions"
>;

export type DesktopChannelRowOptions = {
  isActiveChannel: boolean;
  selectedChannelId: string | null;
  unreadChannelIds: ReadonlySet<string>;
  mutedChannelIds?: ReadonlySet<string>;
  starredChannelIds?: ReadonlySet<string>;
  onSelectChannel: (channelId: string) => void;
  onMarkChannelRead: (channelId: string, lastMessageAt: string | null | undefined) => void;
  onMarkChannelUnread: (channelId: string) => void;
  onMuteChannel?: (channelId: string) => void;
  onUnmuteChannel?: (channelId: string) => void;
  onStarChannel?: (channelId: string) => void;
  onUnstarChannel?: (channelId: string) => void;
  /** Rows the original makes draggable into custom sections (Channels group and sections). */
  draggableRows?: boolean;
  menuExtrasFor?: (channel: Channel) => DesktopChannelMenuExtras | undefined;
  /** DD-125(6): the shared working signal for this native channel, if an Agent works there. */
  workingFor?: (channel: Channel) => DesktopWorkingChannel | undefined;
};

/** The same row and context menu for the fixed groups and the custom sections. */
export function desktopChannelRowRenderers(options: DesktopChannelRowOptions): {
  renderRow: (channel: Channel) => ReactNode;
  renderContextMenu: (channel: Channel) => ReactNode;
} {
  const {
    isActiveChannel, selectedChannelId, unreadChannelIds, mutedChannelIds, starredChannelIds,
    onSelectChannel, onMarkChannelRead, onMarkChannelUnread, onMuteChannel, onUnmuteChannel,
    onStarChannel, onUnstarChannel, draggableRows = false, menuExtrasFor, workingFor,
  } = options;
  return {
    renderRow: (channel) => {
      const row = <ChannelMenuButton channel={channel}
        hasUnread={unreadChannelIds.has(channel.id)} isMuted={mutedChannelIds?.has(channel.id)}
        isActive={isActiveChannel && selectedChannelId === channel.id} onSelectChannel={onSelectChannel}
        working={workingFor?.(channel)} />;
      // Assignments key on the native channel ID, this host's channel identity.
      return draggableRows ? <DraggableChannelRow channelId={channel.id}>{row}</DraggableChannelRow> : row;
    },
    renderContextMenu: (channel) => <ChannelContextMenuItems channel={channel}
      hasUnread={unreadChannelIds.has(channel.id)} isMuted={mutedChannelIds?.has(channel.id)}
      isStarred={starredChannelIds?.has(channel.id)} onMarkChannelRead={onMarkChannelRead}
      onMarkChannelUnread={onMarkChannelUnread} onMuteChannel={onMuteChannel}
      onUnmuteChannel={onUnmuteChannel} onStarChannel={onStarChannel} onUnstarChannel={onUnstarChannel}
      {...(menuExtrasFor?.(channel) ?? {})} />,
  };
}

export function ChannelGroupSection({
  hasUnread,
  isCollapsed,
  items,
  listTestId,
  onMarkAllRead,
  onToggleCollapsed,
  sortMode,
  onSortModeChange,
  actionsTestId,
  actionsDisabled,
  title,
  onCreateChannel,
  createChannelLabel,
  ...rowOptions
}: DesktopChannelRowOptions & {
  hasUnread: boolean;
  isCollapsed: boolean;
  items: Channel[];
  listTestId: string;
  onMarkAllRead: () => void;
  onToggleCollapsed: () => void;
  sortMode: ChannelSortMode;
  onSortModeChange: (mode: ChannelSortMode) => void;
  actionsTestId: string;
  /** Sort writes stay inert while the Core preference is unread, pending or unknown. */
  actionsDisabled?: boolean;
  title: string;
  onCreateChannel?: () => void;
  createChannelLabel?: string;
}) {
  const { renderRow, renderContextMenu } = desktopChannelRowRenderers(rowOptions);
  return <SharedChannelGroupSection
    hasUnread={hasUnread} isCollapsed={isCollapsed} items={items} listTestId={listTestId}
    onMarkAllRead={onMarkAllRead} onToggleCollapsed={onToggleCollapsed}
    sortMode={sortMode} onSortModeChange={onSortModeChange} actionsTestId={actionsTestId}
    actionsDisabled={actionsDisabled}
    title={title} onCreateChannel={onCreateChannel} createChannelLabel={createChannelLabel}
    renderRow={renderRow} renderContextMenu={renderContextMenu}
  />;
}
