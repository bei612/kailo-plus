// Buzz 779af8886caae1317b4de962082429867ab61503 desktop/src/features/sidebar/ui/CustomChannelSection.tsx::ChannelGroupSection.
// Shared grouping, sorting and context-menu host. Adapters retain their data/transport authority.
import {
  ArrowUpDown,
  CheckCheck,
  ChevronDown,
  EllipsisVertical,
  Plus,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useT } from "../context";
import type { WorkspaceView } from "@client-kit/contracts";

export type ChannelSortMode = "alpha" | "recent";
export type SidebarChannel = Pick<WorkspaceView, "id" | "name"> & { lastMessageAt?: string | null };
import { deferMenuAction } from "./sidebarMenuHelpers";
import {
  SECTION_ACTION_VISIBILITY_CLASS,
  SECTION_ICON_BUTTON_CLASS,
} from "./sidebarSectionStyles";
import { twMerge as cn } from "tailwind-merge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "./context-menu";
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
} from "./dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "./primitives";

const SECTION_LABEL_BUTTON_CLASS =
  "group/section-label flex w-fit max-w-[calc(100%-3rem)] cursor-pointer appearance-none items-center gap-1 text-left transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground";
const SECTION_LABEL_CHEVRON_CLASS =
  "relative size-2.5 shrink-0 text-current opacity-0 transition-[color,opacity] group-hover/sidebar-section:opacity-100 group-hover/section-label:opacity-100 group-focus-within/sidebar-section:opacity-100 group-focus-visible/section-label:opacity-100 group-data-[section-actions-open=true]/sidebar-section:opacity-100";
const SECTION_LABEL_CHEVRON_ICON_CLASS =
  "absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2";

const SORT_OPTIONS: { value: ChannelSortMode }[] = [{ value: "recent" }, { value: "alpha" }];

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
  const t = useT();
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("sidebar.moreActions", { section: sectionLabel })}
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
              <span>{t("sidebar.markAllRead")}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ArrowUpDown className="h-4 w-4" />
            <span>{t("sidebar.sort")}</span>
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
                  {t(option.value === "recent" ? "sidebar.recent" : "sidebar.alpha")}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ChannelGroupSection<T extends SidebarChannel>({
  hasUnread, isCollapsed, items, listTestId, onMarkAllRead, onToggleCollapsed,
  sortMode, onSortModeChange, actionsTestId, title, onCreateChannel,
  createChannelLabel, createTestId = "create-channel", renderRow, renderContextMenu,
}: {
  hasUnread: boolean;
  isCollapsed: boolean;
  items: T[];
  listTestId: string;
  onMarkAllRead?: () => void;
  onToggleCollapsed: () => void;
  sortMode?: ChannelSortMode;
  onSortModeChange?: (mode: ChannelSortMode) => void;
  actionsTestId: string;
  title: string;
  onCreateChannel?: () => void;
  createChannelLabel?: string;
  createTestId?: string;
  renderRow: (channel: T) => ReactNode;
  renderContextMenu?: (channel: T) => ReactNode;
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
          {onCreateChannel ? (
            <button
              aria-label={createChannelLabel}
              className={cn(SECTION_ICON_BUTTON_CLASS, SECTION_ACTION_VISIBILITY_CLASS)}
              data-testid={createTestId}
              onClick={onCreateChannel}
              type="button"
            ><Plus className="h-4 w-4" aria-hidden="true" /></button>
          ) : null}
          {sortMode && onSortModeChange ? <SectionActionsMenu
            sectionLabel={title}
            testId={actionsTestId}
            onOpenChange={setActionsMenuOpen}
            hasUnread={hasUnread}
            onMarkAllRead={onMarkAllRead}
            sortMode={sortMode}
            onSortModeChange={onSortModeChange}
          /> : null}
        </div>
      </div>
      {!isCollapsed && items.length > 0 ? (
        <SidebarGroupContent id={contentId}>
          <SidebarMenu data-testid={listTestId}>
            {items.map((channel) => renderContextMenu ? (
              <ContextMenu key={channel.id}>
                <ContextMenuTrigger asChild>
                  <SidebarMenuItem className="content-visibility-auto-row">
                    {renderRow(channel)}
                  </SidebarMenuItem>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  {renderContextMenu(channel)}
                </ContextMenuContent>
              </ContextMenu>
            ) : <SidebarMenuItem key={channel.id} className="content-visibility-auto-row">{renderRow(channel)}</SidebarMenuItem>)}
          </SidebarMenu>
        </SidebarGroupContent>
      ) : null}
    </SidebarGroup>
  );
}
