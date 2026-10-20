// Desktop host of the original custom channel sections (Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/sidebar/ui/AppSidebar.tsx sectionBuckets, CustomChannelSection.tsx,
// SidebarDnd.tsx and ChannelSectionDialogs.tsx), now the shared client-kit bodies the Web host uses.
// DD-125(5): sections, assignments and their sort live in Core CollaborationUserState; this host
// reads and writes them through the shared preference provider over the BFF (05 collab.user_state:
// Desktop via BFF). Assignments key on the native Relay channel ID, this host's channel identity,
// so the Web and Desktop render the same entries. Every control is inert while that state is
// unread, pending or unknown, and an entry for a channel no longer listed is kept but not shown.
import * as React from "react";
import { toast } from "sonner";
import { useT } from "@client-kit/platform/react/context";
import { useCollaborationPreferences } from "@client-kit/platform/react/collaboration-preferences";
import { sectionSortGroupKey } from "@client-kit/platform/collaboration-preferences";
import {
  CreateSectionDialog,
  CustomChannelSection,
  DeleteSectionAlertDialog,
  DroppableUngroupedBody,
  RenameSectionDialog,
  SidebarDndContext,
  type CustomSidebarSection,
  type SectionDialogValue,
} from "@client-kit/platform/react/sidebar/custom-channel-section";
import { sortChannelsForSidebar, type ChannelSortMode } from "@/features/sidebar/lib/channelSortPreference";
import { bucketChannelsBySection, sectionActionsFor } from "@/features/sidebar/lib/desktopChannelSections";
import type { Channel } from "@/shared/api/types";
import {
  ChannelGroupSection,
  desktopChannelRowRenderers,
  type DesktopChannelRowOptions,
} from "./ChannelGroupSection";

export function DesktopStreamChannelGroups({
  channels,
  rowOptions,
  hasUnreadIn,
  channelsHasUnread,
  channelsTitle,
  channelsCollapsed,
  onToggleChannelsCollapsed,
  channelsSortMode,
  onChannelsSortModeChange,
  onMarkAllRead,
  onMarkChannelsRead,
  onCreateChannel,
  createChannelLabel,
  onBrowseChannelsForSection,
}: {
  /** Joined, non-starred stream channels (unsorted); custom sections never hold starred rows. */
  channels: readonly Channel[];
  rowOptions: DesktopChannelRowOptions;
  hasUnreadIn: (items: readonly Channel[]) => boolean;
  /** Original Channels group unread state (any unread channel). */
  channelsHasUnread: boolean;
  channelsTitle: string;
  channelsCollapsed: boolean;
  onToggleChannelsCollapsed: () => void;
  channelsSortMode: ChannelSortMode;
  onChannelsSortModeChange: (mode: ChannelSortMode) => void;
  onMarkAllRead: () => void;
  onMarkChannelsRead: (items: readonly Channel[]) => void;
  onCreateChannel: () => void;
  createChannelLabel: string;
  /** Original section quick action: browse channels, then assign the chosen native channel. */
  onBrowseChannelsForSection: (assign: (channelId: string) => void) => void;
}) {
  const t = useT();
  const preferences = useCollaborationPreferences();
  const sections = preferences?.sections ?? [];
  const writable = preferences?.writable === true;
  const [collapsedSections, setCollapsedSections] = React.useState<Record<string, boolean>>({});
  const [createSection, setCreateSection] = React.useState<{ pendingChannelId: string | null } | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<CustomSidebarSection | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<CustomSidebarSection | null>(null);
  const [busy, setBusy] = React.useState(false);
  const failed = React.useCallback(() => toast.error(t("sidebar.section.updateFailed")), [t]);
  const run = React.useCallback((write: Promise<boolean>) => {
    void write.then((ok) => { if (!ok) failed(); }, failed);
  }, [failed]);
  const { bySection, unassigned } = bucketChannelsBySection(channels, sections, preferences?.assignments ?? {});
  const sectionRowOptions: DesktopChannelRowOptions = {
    ...rowOptions,
    draggableRows: preferences !== null,
    menuExtrasFor: (channel) => ({
      ...rowOptions.menuExtrasFor?.(channel),
      sectionActions: sectionActionsFor(preferences, channel.id, run,
        (channelId) => setCreateSection({ pendingChannelId: channelId })),
    }),
  };
  const { renderRow, renderContextMenu } = desktopChannelRowRenderers(sectionRowOptions);

  const confirmCreate = async (value: SectionDialogValue) => {
    if (!preferences || !createSection) return;
    setBusy(true);
    const created = await preferences.createSection(value.name, value.icon);
    const assigned = created && createSection.pendingChannelId
      ? await preferences.assignChannel(createSection.pendingChannelId, created.id) : true;
    setBusy(false);
    if (!created || !assigned) { failed(); if (!created) return; }
    setCreateSection(null);
  };
  const confirmRename = async (value: SectionDialogValue) => {
    if (!preferences || !renameTarget) return;
    setBusy(true);
    const renamed = await preferences.renameSection(renameTarget.id, value.name, value.icon);
    setBusy(false);
    if (!renamed) { failed(); return; }
    setRenameTarget(null);
  };
  const confirmDelete = async () => {
    if (!preferences || !deleteTarget) return;
    const target = deleteTarget;
    setBusy(true);
    const deleted = await preferences.deleteSection(target.id);
    setBusy(false);
    if (!deleted) { failed(); return; }
    setCollapsedSections((old) => { const next = { ...old }; delete next[target.id]; return next; });
    setDeleteTarget(null);
  };

  return <>
    <SidebarDndContext enabled={writable} sectionIds={sections.map((section) => section.id)}
      onAssignChannel={(channelId, sectionId) => { if (preferences) run(preferences.assignChannel(channelId, sectionId)); }}
      onUnassignChannel={(channelId) => { if (preferences) run(preferences.assignChannel(channelId, null)); }}
      onReorderSections={(sectionIds) => { if (preferences) run(preferences.reorderSections(sectionIds)); }}>
      {preferences ? sections.map((section, index) => {
        const items = bySection.get(section.id) ?? [];
        const sortGroup = sectionSortGroupKey(section.id);
        return <CustomChannelSection key={section.id} section={section}
          items={sortChannelsForSidebar(items, preferences.sortModeFor(sortGroup))}
          hasUnread={hasUnreadIn(items)}
          isCollapsed={collapsedSections[section.id] ?? false}
          isFirst={index === 0} isLast={index === sections.length - 1} disabled={!writable}
          sortMode={preferences.sortModeFor(sortGroup)}
          onSortModeChange={(mode) => { if (writable) run(preferences.setSortModeFor(sortGroup, mode)); }}
          onToggleCollapsed={() => setCollapsedSections((old) => ({ ...old, [section.id]: !(old[section.id] ?? false) }))}
          onMarkSectionRead={() => onMarkChannelsRead(items)}
          onAddChannel={() => onBrowseChannelsForSection((channelId) => run(preferences.assignChannel(channelId, section.id)))}
          onRenameSection={() => setRenameTarget(section)}
          onDeleteSection={() => setDeleteTarget(section)}
          onMoveSectionUp={() => run(preferences.moveSection(section.id, "up"))}
          onMoveSectionDown={() => run(preferences.moveSection(section.id, "down"))}
          renderRow={renderRow}
          renderContextMenu={renderContextMenu} />;
      }) : null}
      <DroppableUngroupedBody>
        <ChannelGroupSection
          {...sectionRowOptions}
          hasUnread={channelsHasUnread}
          isCollapsed={channelsCollapsed}
          items={sortChannelsForSidebar(unassigned, channelsSortMode)}
          sortMode={channelsSortMode}
          onSortModeChange={onChannelsSortModeChange}
          actionsDisabled={preferences !== null && !writable}
          actionsTestId="section-actions-channels"
          listTestId="stream-list"
          onMarkAllRead={onMarkAllRead}
          onToggleCollapsed={onToggleChannelsCollapsed}
          title={channelsTitle}
          onCreateChannel={onCreateChannel}
          createChannelLabel={createChannelLabel}
        />
      </DroppableUngroupedBody>
    </SidebarDndContext>
    {createSection ? <CreateSectionDialog open onOpenChange={(open) => { if (!open) setCreateSection(null); }}
      pending={busy} onConfirm={(value) => void confirmCreate(value)} /> : null}
    {renameTarget ? <RenameSectionDialog open onOpenChange={(open) => { if (!open) setRenameTarget(null); }}
      sectionName={renameTarget.name} sectionIcon={renameTarget.icon}
      pending={busy} onConfirm={(value) => void confirmRename(value)} /> : null}
    {deleteTarget ? <DeleteSectionAlertDialog open onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
      sectionName={deleteTarget.name} channelCount={bySection.get(deleteTarget.id)?.length ?? 0}
      pending={busy} onConfirm={() => void confirmDelete()} /> : null}
  </>;
}
