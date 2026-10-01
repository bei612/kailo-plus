import {
  ArrowUpDown,
  CheckCheck,
  ChevronDown,
  EllipsisVertical,
} from "lucide-react";
import { useRef, useState } from "react";

import type { ChannelSortMode } from "@/features/sidebar/lib/channelSortPreference";
import { ChannelContextMenuItems } from "@/features/sidebar/ui/ChannelContextMenu";
import { ChannelMenuButton } from "@/features/sidebar/ui/ChannelMenuButton";
import { deferMenuAction } from "@/features/sidebar/ui/sidebarMenuHelpers";
import {
  SECTION_ACTION_VISIBILITY_CLASS,
  SECTION_ICON_BUTTON_CLASS,
} from "@/features/sidebar/ui/sidebarSectionStyles";
import type { Channel } from "@/shared/api/types";
import { cn } from "@/shared/lib/cn";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/shared/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";

const SECTION_LABEL_BUTTON_CLASS =
  "group/section-label flex w-fit max-w-[calc(100%-3rem)] cursor-pointer appearance-none items-center gap-1 text-left transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground";
const SECTION_LABEL_CHEVRON_CLASS =
  "relative size-2.5 shrink-0 text-current opacity-0 transition-[color,opacity] group-hover/sidebar-section:opacity-100 group-hover/section-label:opacity-100 group-focus-within/sidebar-section:opacity-100 group-focus-visible/section-label:opacity-100 group-data-[section-actions-open=true]/sidebar-section:opacity-100";
const SECTION_LABEL_CHEVRON_ICON_CLASS =
  "absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2";

const SORT_OPTIONS: { value: ChannelSortMode; label: string }[] = [
  { value: "recent", label: "Recent" },
  { value: "alpha", label: "A–Z" },
];

/**
 * The "more actions" menu shown at the right edge of every sidebar channel
 * group header: mark-all-read when the group has unread activity, plus the
 * group's sort preference.
 */
function SectionActionsMenu({
  sectionLabel,
  testId,
  onOpenChange,
  hasUnread,
  onMarkAllRead,
  sortMode,
  onSortModeChange,
}: {
  sectionLabel: string;
  testId?: string;
  onOpenChange: (open: boolean) => void;
  hasUnread?: boolean;
  onMarkAllRead?: () => void;
  sortMode: ChannelSortMode;
  onSortModeChange: (mode: ChannelSortMode) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`More actions for ${sectionLabel}`}
          className={cn(
            SECTION_ICON_BUTTON_CLASS,
            SECTION_ACTION_VISIBILITY_CLASS,
          )}
          data-testid={testId}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          ref={triggerRef}
          type="button"
        >
          <EllipsisVertical className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          triggerRef.current?.blur();
        }}
      >
        {hasUnread && onMarkAllRead ? (
          <>
            <DropdownMenuItem onSelect={() => deferMenuAction(onMarkAllRead)}>
              <CheckCheck className="h-4 w-4" />
              <span>Mark all as read</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowUpDown className="h-4 w-4" />
            <span>Sort</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuRadioGroup
              onValueChange={(value) =>
                onSortModeChange(value as ChannelSortMode)
              }
              value={sortMode}
            >
              {SORT_OPTIONS.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  unreadChannelIds: ReadonlySet<string>;
  mutedChannelIds?: ReadonlySet<string>;
  onMuteChannel?: (channelId: string) => void;
  onUnmuteChannel?: (channelId: string) => void;
  starredChannelIds?: ReadonlySet<string>;
  onStarChannel?: (channelId: string) => void;
  onUnstarChannel?: (channelId: string) => void;
}) {
  const contentId = `sidebar-${listTestId}`;
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);

  return (
    <SidebarGroup
      className="group/sidebar-section select-none"
      data-section-actions-open={actionsMenuOpen || undefined}
    >
      <div className="relative">
        <SidebarGroupLabel asChild>
          <button
            aria-controls={contentId}
            aria-expanded={!isCollapsed}
            className={SECTION_LABEL_BUTTON_CLASS}
            data-testid={`${listTestId}-section-label`}
            onClick={onToggleCollapsed}
            type="button"
          >
            <span data-sidebar-section-title>{title}</span>
            <span aria-hidden="true" className={SECTION_LABEL_CHEVRON_CLASS}>
              <ChevronDown
                className={cn(
                  SECTION_LABEL_CHEVRON_ICON_CLASS,
                  isCollapsed ? "-rotate-90" : "rotate-0",
                )}
              />
            </span>
          </button>
        </SidebarGroupLabel>
        <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5">
          <SectionActionsMenu
            sectionLabel={title}
            testId={actionsTestId}
            onOpenChange={setActionsMenuOpen}
            hasUnread={hasUnread}
            onMarkAllRead={onMarkAllRead}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
          />
        </div>
      </div>
      {!isCollapsed && items.length > 0 ? (
        <SidebarGroupContent id={contentId}>
          <SidebarMenu data-testid={listTestId}>
            {items.map((channel) => (
              <ContextMenu key={channel.id}>
                <ContextMenuTrigger asChild>
                  <SidebarMenuItem className="content-visibility-auto-row">
                    <ChannelMenuButton
                      channel={channel}
                      hasUnread={unreadChannelIds.has(channel.id)}
                      isMuted={mutedChannelIds?.has(channel.id)}
                      isActive={
                        isActiveChannel && selectedChannelId === channel.id
                      }
                      onSelectChannel={onSelectChannel}
                    />
                  </SidebarMenuItem>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ChannelContextMenuItems
                    channel={channel}
                    hasUnread={unreadChannelIds.has(channel.id)}
                    isMuted={mutedChannelIds?.has(channel.id)}
                    isStarred={starredChannelIds?.has(channel.id)}
                    onMarkChannelRead={onMarkChannelRead}
                    onMarkChannelUnread={onMarkChannelUnread}
                    onMuteChannel={onMuteChannel}
                    onUnmuteChannel={onUnmuteChannel}
                    onStarChannel={onStarChannel}
                    onUnstarChannel={onUnstarChannel}
                  />
                </ContextMenuContent>
              </ContextMenu>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}
