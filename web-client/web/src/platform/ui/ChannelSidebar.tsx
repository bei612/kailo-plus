// Web adapter for the same Buzz channel groups/rows/context menus used by Desktop.
// Business preferences/read positions remain the existing Core user-state CAS authority.
// DD-125(5): original custom sections (CustomChannelSection, SidebarDnd, "Move to section")
// and group sort persist in the same Core CollaborationUserState, keyed by native channel ID.
import { ChannelType, type DiscoverableWorkspace, type WorkspaceView } from "@client-kit/contracts";
import { loadWorkspaceActivity } from "@client-kit/platform/react/workspace-activity";
import { TransportError } from "@client-kit/platform/transport";
import { useT } from "@client-kit/platform/react/context";
import { ChannelGroupSection, type SidebarChannel } from "@client-kit/platform/react/sidebar/channel-group";
import { ChannelContextMenuItems } from "@client-kit/platform/react/sidebar/channel-context-menu";
import { useChannelSidebarActionDialogs } from "@client-kit/platform/react/sidebar/channel-section-dialogs";
import { ChannelRow } from "@client-kit/platform/react/sidebar/channel-row";
// DD-125(6): original ChannelWorkingBadge + ChannelActivityPopover from the shared working signal.
import { ChannelActivityPopover } from "@client-kit/platform/react/sidebar/channel-activity-popover";
import { ChannelWorkingBadge, useWorkingChannels } from "@client-kit/platform/react/agent-activity";
import { sortChannelsForSidebar } from "@client-kit/platform/react/sidebar/channel-sort";
import { useChannelSortPreference } from "@client-kit/platform/react/sidebar/useChannelSortPreference";
import { TooltipProvider } from "@client-kit/platform/react/sidebar/tooltip";
import { inboxReadContexts, type useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChannelGlyph } from "@client-kit/platform/react/channel-glyph";
import { ChannelEphemeralBadge, isEphemeralChannel } from "@client-kit/platform/react/ephemeral-channel";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { bff } from "@/platform/bff-client";
import { platformQueries } from "./queries";
import { Button } from "@/shared/ui/button";
import { inboxWindowEvents } from "./inbox-events";
import { FeatureGate } from "@client-kit/platform/react/features";
import { forcedUnreadMarker, type ForcedUnreadMap } from "@client-kit/platform/react/sidebar/forcedUnreadStore";
import { useCollaborationPreferences } from "@client-kit/platform/react/collaboration-preferences";
import { sectionSortGroupKey } from "@client-kit/platform/collaboration-preferences";
import {
  CreateSectionDialog, CustomChannelSection, DeleteSectionAlertDialog, DraggableChannelRow, DroppableUngroupedBody,
  RenameSectionDialog, SidebarDndContext, type CustomSidebarSection, type SectionDialogValue,
} from "@client-kit/platform/react/sidebar/custom-channel-section";

type Group = "starred" | "channels" | "forums";
const NO_SECTIONS: readonly (CustomSidebarSection & { order: number })[] = [];
const NO_ASSIGNMENTS: Readonly<Record<string, string>> = {};

export function ChannelSidebar({ principalId, workspaces, directory, selectedId, active, reads, preferencePending,
  onSelect, onCreate, onCreateForum, onSetPreference, onActivity, onUnreadChange,
  forcedUnread = {}, onMarkChannelUnread, onClearChannelManualUnread, onChannelActionRecorded,
  onBrowseChannelsForSection,
}: {
  principalId: string;
  workspaces: WorkspaceView[];
  /** Admitted channel directory: each joined row's native channel ID and type for the batch read. */
  directory?: readonly DiscoverableWorkspace[];
  selectedId: string | null;
  active: boolean;
  reads: ReturnType<typeof useInboxState>;
  preferencePending: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onCreateForum: () => void;
  onSetPreference: (id: string, next: { starred: boolean; muted: boolean }) => void;
  onActivity?: (activity: ReadonlyMap<string, string | null>) => void;
  onUnreadChange?: (unread: ReadonlySet<string>) => void;
  forcedUnread?: ForcedUnreadMap;
  onMarkChannelUnread?: (channelId: string) => void;
  onClearChannelManualUnread?: (channelId: string) => void;
  /** DD-119 readback after a recorded Leave/Archive from the context menu. */
  onChannelActionRecorded?: () => void;
  /** Original section quick action: browse channels, then assign the chosen native channel. */
  onBrowseChannelsForSection?: (assign: (channelId: string) => void) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState<Record<Group, boolean>>({ starred: false, channels: false, forums: false });
  // Tenant principal IDs already scope the Web host; no browser Relay identity is invented.
  const { sortModeFor, setSortModeFor } = useChannelSortPreference(principalId);
  const joined = workspaces.filter((workspace) => workspace.isMember === true);
  // Original channel list (fixed Buzz channels/fetch.rs): every joined channel's latest window
  // in one batched read, native IDs/types from the admitted directory, not two reads per row.
  const joinedRows = directory ? joined.map((workspace) => directory.find((row) => row.id === workspace.id)) : undefined;
  const messages = useQuery({
    queryKey: ["platform", "sidebar-messages", principalId,
      ...joined.map((workspace, index) => `${workspace.id}:${joinedRows?.[index]?.channel.channelId ?? ""}`)],
    enabled: joined.length > 0 && joinedRows !== undefined,
    queryFn: async () => {
      if (!joinedRows || joinedRows.some((row) => row === undefined)) throw new TransportError("Channel directory changed");
      const activity = await loadWorkspaceActivity(bff, joinedRows as DiscoverableWorkspace[]);
      const pages = new Map<string, { channelId: string; channelType: ChannelType; events: ReturnType<typeof inboxWindowEvents> }>();
      for (const [id, { channelId, channelType, events }] of activity)
        pages.set(id, { channelId, channelType, events: inboxWindowEvents(events, channelId, channelType === ChannelType.Forum) });
      return pages;
    },
  });
  const preferences = reads.state?.workspacePreferences ?? {};
  const activity = useMemo(() => new Map([...(!messages.isError ? messages.data ?? [] : [])].map(([id, { events }]) => {
    const latest = events.reduce<number | null>((at, event) => Math.max(at ?? event.createdAt, event.createdAt), null);
    return [id, latest === null ? null : new Date(latest * 1000).toISOString()] as const;
  })), [messages.data, messages.isError]);
  useEffect(() => { onActivity?.(activity); }, [activity, onActivity]);
  const rows = workspaces.map((workspace) => {
    const events = workspace.isMember === true ? messages.data?.get(workspace.id)?.events ?? [] : [];
    const latest = events.reduce<number | null>((at, event) => Math.max(at ?? event.createdAt, event.createdAt), null);
    return { ...workspace,
      channelType: !messages.isError && workspace.isMember === true ? messages.data?.get(workspace.id)?.channelType : undefined,
      lastMessageAt: latest === null ? null : new Date(latest * 1000).toISOString() };
  });
  const knownActivity = messages.isSuccess && !messages.isFetching && reads.state !== null;
  const canWriteRead = knownActivity && !reads.pending && !reads.unknown && !preferencePending;
  const canWritePreference = reads.state !== null && !reads.pending && !reads.unknown && !preferencePending;
  const unread = useMemo(() => new Set(knownActivity ? workspaces.filter((row) => {
    if (row.isMember !== true) return false;
    const channel = messages.data?.get(row.id);
    if (!channel) return false;
    const forced = forcedUnread[channel.channelId];
    const baseline = forced === undefined ? undefined : forcedUnreadMarker(forced);
    const observed = reads.readAt(channel.channelId);
    // Original rail gate: a newer synced marker wins over this local source.
    return (baseline !== undefined && (baseline === null || observed === null || observed <= baseline)) ||
      channel.events.some(event => event.createdAt > (reads.eventReadAt(event) ?? -Infinity));
  }).map((row) => row.id) : []), [knownActivity, workspaces, messages.data, reads.eventReadAt, reads.readAt, forcedUnread]);
  useEffect(() => { onUnreadChange?.(unread); }, [unread, onUnreadChange]);
  const mark = (ids: string[], read: boolean) => {
    if (!canWriteRead) return;
    if (!read) {
      for (const id of ids) {
        const channelId = messages.data?.get(id)?.channelId;
        if (channelId) onMarkChannelUnread?.(channelId);
      }
      return;
    }
    void reads.write(inboxReadContexts(ids.flatMap((id) => messages.data?.get(id)?.events ?? []), read))
      .then(accepted => {
        if (accepted) for (const id of ids) {
          const channelId = messages.data?.get(id)?.channelId;
          if (channelId) onClearChannelManualUnread?.(channelId);
        }
        return queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey });
      });
  };
  const updatePreference = (id: string, change: { starred?: boolean; muted?: boolean }) => {
    if (!canWritePreference) return;
    onSetPreference(id, { starred: preferences[id]?.starred ?? false, muted: preferences[id]?.muted ?? false, ...change });
  };
  const { requestLeaveChannel, requestArchiveChannel, dialog: channelActionDialog } =
    useChannelSidebarActionDialogs(() => onChannelActionRecorded?.());
  const copy = (text: string, success: string) => {
    void Promise.resolve().then(() => navigator.clipboard.writeText(text))
      .then(() => toast.success(success), () => toast.error(t("platform.loadFailed")));
  };
  // DD-125(5) custom sections: only joined stream channels with an observed native ID
  // can be assigned (Core re-admits each key); entries for channels that are no longer
  // visible stay in Core and are simply not rendered.
  const sectionPrefs = useCollaborationPreferences();
  // Keyed by the Workspace ID the Web routes and reports channel activity under.
  const workingChannels = useWorkingChannels();
  const workingById = useMemo(() => new Map(workingChannels.map((summary) => [summary.channelId, summary])), [workingChannels]);
  const sections = sectionPrefs?.sections ?? NO_SECTIONS;
  const assignments = sectionPrefs?.assignments ?? NO_ASSIGNMENTS;
  const sectionsWritable = sectionPrefs?.writable === true;
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [createSection, setCreateSection] = useState<{ pendingChannelId: string | null } | null>(null);
  const [renameSectionTarget, setRenameSectionTarget] = useState<CustomSidebarSection | null>(null);
  const [deleteSectionTarget, setDeleteSectionTarget] = useState<CustomSidebarSection | null>(null);
  const [sectionBusy, setSectionBusy] = useState(false);
  const nativeChannelId = (workspaceId: string) => joined.some((row) => row.id === workspaceId)
    ? directory?.find((row) => row.id === workspaceId)?.channel.channelId : undefined;
  const sectionFailed = () => toast.error(t("sidebar.section.updateFailed"));
  const runSectionWrite = (write: Promise<boolean>) => {
    void write.then((ok) => { if (!ok) sectionFailed(); }, sectionFailed);
  };
  const sectionActionsFor = (workspaceId: string) => {
    const native = nativeChannelId(workspaceId);
    if (!sectionPrefs || !native) return undefined;
    return {
      sections, currentSectionId: assignments[native], disabled: !sectionsWritable,
      onAssign: (sectionId: string) => runSectionWrite(sectionPrefs.assignChannel(native, sectionId)),
      onUnassign: () => runSectionWrite(sectionPrefs.assignChannel(native, null)),
      onCreateSection: () => setCreateSection({ pendingChannelId: native }),
    };
  };
  const renderChannelRow = (channel: SidebarChannel & { channelType?: ChannelType }, draggable: boolean) => {
    const ttl = directory?.find((row) => row.id === channel.id)?.channel;
    const working = workingById.get(channel.id);
    const row = <ChannelActivityPopover activeWorking={working} channel={{ id: channel.id, name: channel.name }}><ChannelRow channel={channel} isActive={active && selectedId === channel.id}
      workingBadge={working ? <ChannelWorkingBadge channelName={channel.name} isActive={active && selectedId === channel.id} summary={working} /> : undefined}
      hasUnread={unread.has(channel.id)} hasThreadUnread={unread.has(channel.id)}
      isMuted={preferences[channel.id]?.muted} onSelectChannel={onSelect}
      // DD-119(3,6): the original TTL badge from the admitted directory's channel metadata.
      ephemeralBadge={ttl && isEphemeralChannel(ttl) ? <ChannelEphemeralBadge channel={{ id: channel.id, ttlSeconds: ttl.ttlSeconds, ttlDeadline: ttl.ttlDeadline }}
        testId={`channel-ephemeral-${channel.name}`} variant="sidebar" /> : undefined}
      glyph={(className) => <ChannelGlyph className={className} channel={{ channelType: channel.channelType, visibility: workspaces.find((workspace) => workspace.id === channel.id)?.visibility }} />} /></ChannelActivityPopover>;
    const native = draggable && sectionPrefs ? nativeChannelId(channel.id) : undefined;
    return native ? <DraggableChannelRow channelId={native}>{row}</DraggableChannelRow> : row;
  };
  const renderChannelMenu = (channel: SidebarChannel, key: Group | "section") => {
    const observedChannelId = joined.some((row) => row.id === channel.id) && messages.isSuccess
      ? messages.data?.get(channel.id)?.channelId : undefined;
    return <ChannelContextMenuItems channel={channel}
      copyChannelId={messages.isSuccess && !messages.isFetching && joined.some((row) => row.id === channel.id)
        ? messages.data?.get(channel.id)?.channelId ?? null : null}
      hasUnread={unread.has(channel.id)} isMuted={preferences[channel.id]?.muted}
      isStarred={preferences[channel.id]?.starred} onCopy={copy}
      // Original "Move to section" lives in the Channels group and custom sections only.
      sectionActions={key === "channels" || key === "section" ? sectionActionsFor(channel.id) : undefined}
      onMarkChannelRead={canWriteRead && joined.some((row) => row.id === channel.id) ? (id) => mark([id], true) : undefined}
      onMarkChannelUnread={canWriteRead && onMarkChannelUnread && joined.some((row) => row.id === channel.id) ? (id) => mark([id], false) : undefined}
      onStarChannel={key !== "forums" && canWritePreference ? (id) => updatePreference(id, { starred: true }) : undefined}
      onUnstarChannel={key !== "forums" && canWritePreference ? (id) => updatePreference(id, { starred: false }) : undefined}
      onMuteChannel={canWritePreference ? (id) => updatePreference(id, { muted: true }) : undefined}
      onUnmuteChannel={canWritePreference ? (id) => updatePreference(id, { muted: false }) : undefined}
      // Original Leave in Starred/Channels (not Forums); shown on the BFF leaveActionKey (DD-119(8)).
      onLeaveChannel={key !== "forums" && directory?.find((row) => row.id === channel.id)?.leaveActionKey !== undefined
        ? (row) => requestLeaveChannel({ workspaceId: row.id, name: row.name }) : undefined}
      // Archive reads the lifecycle hint on menu open (DD-119(5)); it needs the observed native channel ID.
      ownerActions={observedChannelId ? { workspaceId: channel.id, channelId: observedChannelId,
        onArchiveChannel: (row) => requestArchiveChannel({ workspaceId: row.id, name: row.name }) } : undefined} />;
  };
  const group = (key: Group, items: (SidebarChannel & { channelType?: ChannelType })[]) => <ChannelGroupSection
    key={key} title={t(key === "starred" ? "sidebar.starred" : key === "forums" ? "sidebar.forums" : "sidebar.channels")}
    items={sortChannelsForSidebar(items, sortModeFor(key))}
    hasUnread={items.some((row) => unread.has(row.id))}
    isCollapsed={collapsed[key]} onToggleCollapsed={() => setCollapsed((old) => ({ ...old, [key]: !old[key] }))}
    listTestId={key === "starred" ? "starred-channel-list" : key === "forums" ? "forum-list" : "channel-list"}
    actionsTestId={`${key}-section-actions`} sortMode={sortModeFor(key)}
    onSortModeChange={(value) => setSortModeFor(key, value)}
    actionsDisabled={Boolean(sectionPrefs) && !sectionsWritable}
    onMarkAllRead={canWriteRead ? () => mark(items.map((row) => row.id), true) : undefined}
    onCreateChannel={key === "channels" ? onCreate : key === "forums" ? onCreateForum : undefined}
    createChannelLabel={t(key === "forums" ? "sidebar.newForum" : "channel.browser.title")}
    createTestId={key === "forums" ? "create-forum" : "create-channel"}
    renderRow={(channel) => renderChannelRow(channel, key === "channels")}
    renderContextMenu={(channel) => renderChannelMenu(channel, key)}
  />;
  const streamRows = rows.filter((row) => row.channelType === "stream" || (row.isMember !== true && row.channelType === undefined));
  const starred = streamRows.filter((row) => preferences[row.id]?.starred);
  // Original AppSidebar sectionBuckets: non-starred stream channels go to their assigned
  // section when that section still exists, otherwise to the default Channels group.
  const liveSectionIds = new Set(sections.map((section) => section.id));
  const bySection = new Map<string, typeof streamRows>();
  const unassigned: typeof streamRows = [];
  for (const row of streamRows) {
    if (preferences[row.id]?.starred) continue;
    const native = nativeChannelId(row.id);
    const sectionId = native ? assignments[native] : undefined;
    if (sectionId && liveSectionIds.has(sectionId)) bySection.set(sectionId, [...(bySection.get(sectionId) ?? []), row]);
    else unassigned.push(row);
  }
  const confirmCreateSection = async (value: SectionDialogValue) => {
    if (!sectionPrefs || !createSection) return;
    setSectionBusy(true);
    const created = await sectionPrefs.createSection(value.name, value.icon);
    const assigned = created && createSection.pendingChannelId
      ? await sectionPrefs.assignChannel(createSection.pendingChannelId, created.id) : true;
    setSectionBusy(false);
    if (!created || !assigned) { sectionFailed(); if (!created) return; }
    setCreateSection(null);
  };
  const confirmRenameSection = async (value: SectionDialogValue) => {
    if (!sectionPrefs || !renameSectionTarget) return;
    setSectionBusy(true);
    const renamed = await sectionPrefs.renameSection(renameSectionTarget.id, value.name, value.icon);
    setSectionBusy(false);
    if (!renamed) { sectionFailed(); return; }
    setRenameSectionTarget(null);
  };
  const confirmDeleteSection = async () => {
    if (!sectionPrefs || !deleteSectionTarget) return;
    const target = deleteSectionTarget;
    setSectionBusy(true);
    const deleted = await sectionPrefs.deleteSection(target.id);
    setSectionBusy(false);
    if (!deleted) { sectionFailed(); return; }
    setCollapsedSections((old) => { const next = { ...old }; delete next[target.id]; return next; });
    setDeleteSectionTarget(null);
  };
  return <TooltipProvider>
    {messages.isError || reads.failed ? <p role="alert" className="px-4 text-sm">
      {t("platform.loadFailed")} <Button size="sm" onClick={() => { void messages.refetch(); void reads.refresh(); }}>{t("platform.retry")}</Button>
    </p> : joined.length > 0 && (messages.isPending || reads.state === null) ? <p role="status" className="px-4 text-sm">{t("platform.loading")}</p> : null}
    {starred.length > 0 ? group("starred", starred) : null}
    <SidebarDndContext enabled={sectionsWritable} sectionIds={sections.map((section) => section.id)}
      onAssignChannel={(channelId, sectionId) => { if (sectionPrefs) runSectionWrite(sectionPrefs.assignChannel(channelId, sectionId)); }}
      onUnassignChannel={(channelId) => { if (sectionPrefs) runSectionWrite(sectionPrefs.assignChannel(channelId, null)); }}
      onReorderSections={(sectionIds) => { if (sectionPrefs) runSectionWrite(sectionPrefs.reorderSections(sectionIds)); }}>
      {sectionPrefs ? sections.map((section, index) => {
        const items = bySection.get(section.id) ?? [];
        const sortGroup = sectionSortGroupKey(section.id);
        return <CustomChannelSection key={section.id} section={section}
          items={sortChannelsForSidebar(items, sectionPrefs.sortModeFor(sortGroup))}
          hasUnread={items.some((row) => unread.has(row.id))}
          isCollapsed={collapsedSections[section.id] ?? false}
          isFirst={index === 0} isLast={index === sections.length - 1} disabled={!sectionsWritable}
          sortMode={sectionPrefs.sortModeFor(sortGroup)}
          onSortModeChange={(mode) => { if (sectionsWritable) runSectionWrite(sectionPrefs.setSortModeFor(sortGroup, mode)); }}
          onToggleCollapsed={() => setCollapsedSections((old) => ({ ...old, [section.id]: !(old[section.id] ?? false) }))}
          onMarkSectionRead={canWriteRead ? () => mark(items.map((row) => row.id), true) : undefined}
          onAddChannel={onBrowseChannelsForSection ? () => onBrowseChannelsForSection((channelId) =>
            runSectionWrite(sectionPrefs.assignChannel(channelId, section.id))) : undefined}
          onRenameSection={() => setRenameSectionTarget(section)}
          onDeleteSection={() => setDeleteSectionTarget(section)}
          onMoveSectionUp={() => runSectionWrite(sectionPrefs.moveSection(section.id, "up"))}
          onMoveSectionDown={() => runSectionWrite(sectionPrefs.moveSection(section.id, "down"))}
          renderRow={(channel) => renderChannelRow(channel, true)}
          renderContextMenu={(channel) => renderChannelMenu(channel, "section")} />;
      }) : null}
      <DroppableUngroupedBody>{group("channels", unassigned)}</DroppableUngroupedBody>
    </SidebarDndContext>
    <FeatureGate feature="forum">{group("forums", rows.filter((row) => row.channelType === "forum"))}</FeatureGate>
    {channelActionDialog}
    {createSection ? <CreateSectionDialog open onOpenChange={(open) => { if (!open) setCreateSection(null); }}
      pending={sectionBusy} onConfirm={(value) => void confirmCreateSection(value)} /> : null}
    {renameSectionTarget ? <RenameSectionDialog open onOpenChange={(open) => { if (!open) setRenameSectionTarget(null); }}
      sectionName={renameSectionTarget.name} sectionIcon={renameSectionTarget.icon}
      pending={sectionBusy} onConfirm={(value) => void confirmRenameSection(value)} /> : null}
    {deleteSectionTarget ? <DeleteSectionAlertDialog open onOpenChange={(open) => { if (!open) setDeleteSectionTarget(null); }}
      sectionName={deleteSectionTarget.name} channelCount={bySection.get(deleteSectionTarget.id)?.length ?? 0}
      pending={sectionBusy} onConfirm={() => void confirmDeleteSection()} /> : null}
  </TooltipProvider>;
}
