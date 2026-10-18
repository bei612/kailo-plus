// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/sidebar/ui/CustomChannelSection.tsx::CustomChannelSection and
// desktop/src/features/sidebar/ui/ChannelSectionDialogs.tsx::{CreateSectionDialog,
// RenameSectionDialog,DeleteSectionAlertDialog}. Presentation and interactions are the
// original's; the host persists sections, assignments and sort in Core
// CollaborationUserState (DD-125(5)) and passes `disabled` while that state is unread,
// pending or unknown so every write control stays inert.
import * as React from "react";
import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { useT } from "../context";
import { cn } from "../profile/buzz/shared/lib/cn";
import { Button } from "../profile/buzz/shared/ui/button";
import { EmojiPicker } from "../custom-emoji/EmojiPicker";
import { usePresenceHost } from "../presence/context";
import { StatusEmoji } from "../user-status/ui/StatusEmoji";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../composer/shared/ui/dialog";
import { Input } from "../composer/shared/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../conversations/popover";
import { SectionActionsMenu, type ChannelSortMode, type SidebarChannel } from "./channel-group";
import { ChannelActionAlertDialog } from "./channel-section-dialogs";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./context-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
} from "./primitives";
import { deferMenuAction } from "./sidebarMenuHelpers";
import { SECTION_ACTION_VISIBILITY_CLASS, SECTION_ICON_BUTTON_CLASS } from "./sidebarSectionStyles";
import { DroppableSectionBody, SortableSectionShell } from "./sidebar-dnd";

export {
  DraggableChannelRow,
  DroppableSectionBody,
  DroppableUngroupedBody,
  SidebarDndContext,
  SortableSectionShell,
  arrayMove,
  resolveSidebarDrop,
  type SidebarDragItem,
} from "./sidebar-dnd";

export type CustomSidebarSection = { id: string; name: string; icon?: string };

const SECTION_LABEL_BUTTON_CLASS =
  "group/section-label flex w-fit max-w-[calc(100%-3rem)] cursor-pointer appearance-none items-center gap-1 text-left transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground";
const SECTION_LABEL_CHEVRON_CLASS =
  "relative size-2.5 shrink-0 text-current opacity-0 transition-[color,opacity] group-hover/sidebar-section:opacity-100 group-hover/section-label:opacity-100 group-focus-within/sidebar-section:opacity-100 group-focus-visible/section-label:opacity-100 group-data-[section-actions-open=true]/sidebar-section:opacity-100";
const SECTION_LABEL_CHEVRON_ICON_CLASS =
  "absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2";

export function CustomChannelSection<T extends SidebarChannel>({
  section,
  items,
  hasUnread,
  isCollapsed,
  isFirst,
  isLast,
  disabled,
  sortMode,
  onSortModeChange,
  onToggleCollapsed,
  onMarkSectionRead,
  onAddChannel,
  onRenameSection,
  onDeleteSection,
  onMoveSectionUp,
  onMoveSectionDown,
  renderRow,
  renderContextMenu,
}: {
  section: CustomSidebarSection;
  items: T[];
  hasUnread: boolean;
  isCollapsed: boolean;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  sortMode: ChannelSortMode;
  onSortModeChange: (mode: ChannelSortMode) => void;
  onToggleCollapsed: () => void;
  onMarkSectionRead?: () => void;
  /** Original quick action: browse channels, then assign the chosen one here. */
  onAddChannel?: () => void;
  onRenameSection: () => void;
  onDeleteSection: () => void;
  onMoveSectionUp: () => void;
  onMoveSectionDown: () => void;
  renderRow: (channel: T) => React.ReactNode;
  renderContextMenu?: (channel: T) => React.ReactNode;
}) {
  const t = useT();
  const contentId = `sidebar-section-${section.id}`;
  const [actionsMenuOpen, setActionsMenuOpen] = React.useState(false);

  return (
    <SortableSectionShell sectionId={section.id}>
      {({ dragHandleProps, isDragging }) => (
        <DroppableSectionBody sectionId={section.id}>
          <SidebarGroup
            className={cn(
              "group/sidebar-section select-none transition-[opacity,transform] duration-100 ease-out motion-reduce:transition-none",
              isDragging && "opacity-30",
            )}
            data-section-actions-open={actionsMenuOpen || undefined}
            data-sidebar-drag-state={isDragging ? "dragging" : undefined}
            data-testid={`custom-section-${section.id}`}
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="relative" {...dragHandleProps}>
                  <SidebarGroupLabel asChild className={section.icon ? undefined : "pl-8"}>
                    <button
                      aria-controls={contentId}
                      aria-expanded={!isCollapsed}
                      className={cn(SECTION_LABEL_BUTTON_CLASS, section.icon && "gap-2")}
                      onClick={onToggleCollapsed}
                      type="button"
                    >
                      {section.icon ? (
                        <span
                          aria-hidden="true"
                          className="flex h-4 w-4 shrink-0 items-center justify-center"
                          data-testid={`section-icon-${section.id}`}
                        >
                          <StatusEmoji className="h-4 w-4" value={section.icon} />
                        </span>
                      ) : null}
                      <span className="truncate" data-sidebar-section-title data-testid={`section-title-${section.id}`}>
                        {section.name}
                      </span>
                      <span aria-hidden="true" className={SECTION_LABEL_CHEVRON_CLASS}>
                        <ChevronDown
                          className={cn(SECTION_LABEL_CHEVRON_ICON_CLASS, isCollapsed ? "-rotate-90" : "rotate-0")}
                        />
                      </span>
                    </button>
                  </SidebarGroupLabel>
                  <div className="absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5">
                    {onAddChannel ? (
                      <button
                        aria-label={t("sidebar.section.addChannel", { section: section.name })}
                        className={cn(SECTION_ICON_BUTTON_CLASS, SECTION_ACTION_VISIBILITY_CLASS)}
                        data-testid={`section-actions-${section.id}-quick-create`}
                        disabled={disabled}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddChannel();
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        title={t("sidebar.section.addChannel", { section: section.name })}
                        type="button"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    ) : null}
                    <SectionActionsMenu
                      sectionLabel={section.name}
                      testId={`section-actions-${section.id}`}
                      onOpenChange={setActionsMenuOpen}
                      hasUnread={hasUnread}
                      onMarkAllRead={onMarkSectionRead}
                      onRenameSection={onRenameSection}
                      onMoveSectionUp={onMoveSectionUp}
                      onMoveSectionDown={onMoveSectionDown}
                      onDeleteSection={onDeleteSection}
                      isFirstSection={isFirst}
                      isLastSection={isLast}
                      sortMode={sortMode}
                      onSortModeChange={onSortModeChange}
                      disabled={disabled}
                    />
                  </div>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem disabled={disabled} onSelect={() => deferMenuAction(onRenameSection)}>
                  <Pencil className="h-4 w-4" />
                  {t("sidebar.section.rename")}
                </ContextMenuItem>
                <ContextMenuItem disabled={disabled || isFirst} onSelect={() => deferMenuAction(onMoveSectionUp)}>
                  <ArrowUp className="h-4 w-4" />
                  {t("sidebar.section.moveUp")}
                </ContextMenuItem>
                <ContextMenuItem disabled={disabled || isLast} onSelect={() => deferMenuAction(onMoveSectionDown)}>
                  <ArrowDown className="h-4 w-4" />
                  {t("sidebar.section.moveDown")}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={disabled}
                  onSelect={() => deferMenuAction(onDeleteSection)}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("sidebar.section.delete")}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            {!isCollapsed ? (
              <SidebarGroupContent id={contentId}>
                {items.length > 0 ? (
                  <SidebarMenu data-testid={`section-list-${section.id}`}>
                    {items.map((channel) => renderContextMenu ? (
                      <ContextMenu key={channel.id}>
                        <ContextMenuTrigger asChild>
                          <SidebarMenuItem>{renderRow(channel)}</SidebarMenuItem>
                        </ContextMenuTrigger>
                        <ContextMenuContent>{renderContextMenu(channel)}</ContextMenuContent>
                      </ContextMenu>
                    ) : <SidebarMenuItem key={channel.id}>{renderRow(channel)}</SidebarMenuItem>)}
                  </SidebarMenu>
                ) : null}
              </SidebarGroupContent>
            ) : null}
          </SidebarGroup>
        </DroppableSectionBody>
      )}
    </SortableSectionShell>
  );
}

export type SectionDialogValue = { name: string; icon?: string };

function SectionNameDialog({
  open,
  onOpenChange,
  title,
  description,
  initialValue,
  initialIcon = "",
  confirmLabel,
  isConfirmDisabled,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initialValue: string;
  initialIcon?: string;
  confirmLabel: string;
  isConfirmDisabled: (trimmed: string, icon: string) => boolean;
  onConfirm: (value: SectionDialogValue) => void;
  pending?: boolean;
}) {
  const t = useT();
  const [name, setName] = React.useState(initialValue);
  const [icon, setIcon] = React.useState(initialIcon);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const customEmoji = usePresenceHost()?.customEmoji;
  const pickerEmoji = React.useMemo(() => [...(customEmoji ?? [])], [customEmoji]);

  React.useEffect(() => {
    if (!open) {
      setPickerOpen(false);
      return;
    }
    setName(initialValue);
    setIcon(initialIcon);
    // Small delay to let dialog animation start before focusing
    const timerId = globalThis.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => globalThis.clearTimeout(timerId);
  }, [open, initialValue, initialIcon]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    const trimmedIcon = icon.trim();
    if (pending || isConfirmDisabled(trimmed, trimmedIcon)) return;
    onConfirm({ name: trimmed, ...(trimmedIcon ? { icon: trimmedIcon } : {}) });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="flex items-center gap-2">
            <Popover onOpenChange={setPickerOpen} open={pickerOpen}>
              <div className="relative shrink-0">
                <PopoverTrigger asChild>
                  <button
                    aria-label={t("sidebar.section.chooseIcon")}
                    className="flex h-9 w-9 items-center justify-center rounded-md border border-input text-lg transition-colors hover:bg-accent"
                    type="button"
                  >
                    {icon ? (
                      <StatusEmoji className="h-5 w-5" value={icon} />
                    ) : (
                      <span className="text-sm font-medium">#</span>
                    )}
                  </button>
                </PopoverTrigger>
                {icon ? (
                  <button
                    aria-label={t("sidebar.section.clearIcon")}
                    className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border border-background bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(event) => {
                      event.stopPropagation();
                      setIcon("");
                    }}
                    type="button"
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
              <PopoverContent align="start" className="w-auto overflow-hidden rounded-2xl p-0" sideOffset={4}>
                <EmojiPicker
                  customEmoji={pickerEmoji}
                  onSelect={(selected) => {
                    setIcon(selected);
                    setPickerOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
            <Input
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              className="flex-1"
              onChange={(event) => setName(event.target.value)}
              placeholder={t("sidebar.section.namePlaceholder")}
              ref={inputRef}
              spellCheck={false}
              value={name}
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" type="button">
                {t("platform.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || isConfirmDisabled(name.trim(), icon.trim())}>
              {confirmLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CreateSectionDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: SectionDialogValue) => void;
  pending?: boolean;
}) {
  const t = useT();
  return (
    <SectionNameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("sidebar.section.createTitle")}
      description={t("sidebar.section.createDescription")}
      initialValue=""
      confirmLabel={t("sidebar.section.create")}
      isConfirmDisabled={(trimmed) => trimmed.length === 0}
      onConfirm={onConfirm}
      pending={pending}
    />
  );
}

export function RenameSectionDialog({
  open,
  onOpenChange,
  sectionName,
  sectionIcon,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionName: string;
  sectionIcon?: string;
  onConfirm: (value: SectionDialogValue) => void;
  pending?: boolean;
}) {
  const t = useT();
  return (
    <SectionNameDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("sidebar.section.rename")}
      description={t("sidebar.section.renameDescription")}
      initialValue={sectionName}
      initialIcon={sectionIcon}
      confirmLabel={t("sidebar.section.save")}
      isConfirmDisabled={(trimmed, icon) =>
        trimmed.length === 0 || (trimmed === sectionName && icon === (sectionIcon ?? ""))}
      onConfirm={onConfirm}
      pending={pending}
    />
  );
}

export function DeleteSectionAlertDialog({
  open,
  onOpenChange,
  sectionName,
  channelCount,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionName: string;
  channelCount: number;
  onConfirm: () => void;
  pending?: boolean;
}) {
  const t = useT();
  const description = channelCount === 0
    ? t("sidebar.section.deleteEmpty", { name: sectionName })
    : channelCount === 1
      ? t("sidebar.section.deleteOne", { name: sectionName })
      : t("sidebar.section.deleteMany", { name: sectionName, count: channelCount });
  return (
    <ChannelActionAlertDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("sidebar.section.delete")}
      description={description}
      confirmLabel={t("sidebar.section.deleteConfirm")}
      onConfirm={onConfirm}
      pending={pending}
      testId="delete-section-dialog"
    />
  );
}
