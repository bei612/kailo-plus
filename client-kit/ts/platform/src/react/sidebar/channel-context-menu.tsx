// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/ChannelContextMenu.tsx.
// Menu UI is shared. Host adapters own clipboard and read-state writes. Leave and Archive open
// the host's DD-119 governed confirmations (workspace.leave / workspace.suspend); Archive is
// shown only when the BFF lifecycle hint read on menu open answers suspend. Delete has no
// governed path (DD-119(7), DD-46) and is not rendered.
import {
  Archive,
  Bell,
  BellOff,
  CheckCircle2,
  CircleDot,
  Copy,
  LoaderCircle,
  LogOut,
  Star,
  StarOff,
  TriangleAlert,
} from "lucide-react";
import { WorkspaceLifecycleActionKey } from "@client-kit/contracts";


import {
  ContextMenuIconSlot,
  deferMenuAction,
} from "./sidebarMenuHelpers";
import type { SidebarChannel as Channel } from "./channel-group";
import { useT } from "../context";
import { useChannelManagementHints } from "../channel-management-actions";

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
function CopyChannelSubmenu({ channel, channelId, onCopy }: { channel: Channel; channelId: string | null; onCopy: (text: string, message: string) => void }) {
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
          disabled={channelId === null}
          onSelect={() =>
            channelId !== null && onCopy(channelId, t("sidebar.copiedId"))
          }
        >
          <span>{t("sidebar.copyId")}</span>
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/** DD-119 owner actions for one Workspace channel, read only while the menu is open. */
export type ChannelContextMenuOwnerActions = {
  workspaceId: string;
  /** Native channel reference for the hint read. */
  channelId: string;
  onArchiveChannel: (channel: Channel) => void;
};

function ChannelOwnerActionItems({ channel, ownerActions, separated }: {
  channel: Channel;
  ownerActions: ChannelContextMenuOwnerActions;
  /** The Leave entry above already opened the channel-actions group. */
  separated: boolean;
}) {
  const t = useT();
  const hints = useChannelManagementHints(ownerActions.workspaceId, ownerActions.channelId, true);
  const loading = hints.isPending;
  const failed = hints.isError;
  const canArchive = hints.isSuccess && !hints.data.canReopen
    && hints.data.lifecycleActionKey === WorkspaceLifecycleActionKey.WorkspaceSuspend;
  if (!loading && !failed && !canArchive) return null;
  return (
    <>
      {separated ? null : <ContextMenuSeparator />}
      {loading ? (
        <ContextMenuItem disabled>
          <ContextMenuIconSlot>
            <LoaderCircle className="h-4 w-4 animate-spin" />
          </ContextMenuIconSlot>
          <span>{t("sidebar.channelActionsLoading")}</span>
        </ContextMenuItem>
      ) : failed ? (
        <ContextMenuItem disabled>
          <ContextMenuIconSlot>
            <TriangleAlert className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>{t("sidebar.channelActionsUnavailable")}</span>
        </ContextMenuItem>
      ) : null}
      {canArchive ? (
        <ContextMenuItem
          data-testid={`archive-channel-${channel.name}`}
          onSelect={() => deferMenuAction(() => ownerActions.onArchiveChannel(channel))}
        >
          <ContextMenuIconSlot>
            <Archive className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>{t("channelManagement.archive")}</span>
        </ContextMenuItem>
      ) : null}
    </>
  );
}

export function ChannelContextMenuItems({
  channel,
  copyChannelId = channel.id,
  hasUnread,
  isMuted,
  isStarred,
  onMarkChannelRead,
  onMarkChannelUnread,
  onMuteChannel,
  onUnmuteChannel,
  onStarChannel,
  onUnstarChannel,
  onLeaveChannel,
  ownerActions,
  onCopy,
}: {
  onCopy: (text: string, message: string) => void;
  channel: Channel;
  /** Native hosts already use Relay IDs; Web resolves it without replacing its management ID. */
  copyChannelId?: string | null;
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
  /** Original Leave channel entry; the host confirms and submits workspace.leave. */
  onLeaveChannel?: (channel: Channel) => void;
  /** DD-119 Archive entry; omitted keeps the menu free of authority reads. */
  ownerActions?: ChannelContextMenuOwnerActions;
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
      <CopyChannelSubmenu channel={channel} channelId={copyChannelId} onCopy={onCopy} />
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
      {onLeaveChannel ? <ContextMenuSeparator /> : null}
      {onLeaveChannel ? (
        <ContextMenuItem
          className="text-destructive focus:text-destructive"
          data-testid={`leave-channel-${channel.name}`}
          onSelect={() => deferMenuAction(() => onLeaveChannel(channel))}
        >
          <ContextMenuIconSlot>
            <LogOut className="h-4 w-4" />
          </ContextMenuIconSlot>
          <span>{t("channelManagement.leave")}</span>
        </ContextMenuItem>
      ) : null}
      {ownerActions ? (
        <ChannelOwnerActionItems channel={channel} ownerActions={ownerActions} separated={Boolean(onLeaveChannel)} />
      ) : null}
    </>
  );
}
