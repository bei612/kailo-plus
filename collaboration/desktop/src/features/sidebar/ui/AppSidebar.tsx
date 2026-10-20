import * as React from "react";
import {useSearch} from "@tanstack/react-router";
import {SidebarProjects} from "./SidebarProjects";
import { AppSidebarFrame } from "@client-kit/platform/react/sidebar/app-sidebar-frame";
import { NativeApplicationEntries } from "@client-kit/platform/react/pages";
import { ChannelBrowser } from "@client-kit/platform/react/channel-browser";
import { CreateChannelDialog } from "@client-kit/platform/react/create-channel-dialog";
import { FeatureGate } from "@client-kit/platform/react/features";
import { WorkspaceChannelCreateChannelType, WorkspaceMembershipState, type DiscoverableWorkspace } from "@client-kit/contracts";
import { useWorkingChannels } from "@client-kit/platform/react/agent-activity";
import { useChannelSidebarActionDialogs } from "@client-kit/platform/react/sidebar/channel-section-dialogs";
import {
  SidebarLoadingContent,
  useSidebarLoadingShape,
  type SidebarLoadingSourceRow,
} from "@client-kit/platform/react/sidebar/sidebar-loading-skeleton";
import { useChannelNavigationShortcuts } from "@client-kit/platform/react/use-channel-navigation-shortcuts";
import { useQueryClient } from "@tanstack/react-query";
import { channelsQueryKey, nativeApplicationWorkspace, useWorkspaceChannelDirectory, workspaceVisibilityQueryKey } from "@/features/channels/hooks";
import { ConversationList, useConversations, useDirectMessageOpen } from "@client-kit/platform/react/new-message";
import { translateCurrent as translateUi } from "@client-kit/platform/i18n";
import { isOutcomeUnknown } from "@client-kit/platform/transport";
import { toast } from "sonner";
import { useAppShell } from "@/app/AppShellContext";
import { useHomeFeedQuery } from "@/features/home/hooks";
import type { Channel } from "@/shared/api/types";
import { UserAvatar, type UserAvatarProps } from "@client-kit/platform/react/messages";
import { useUserProfileQuery } from "@/features/profile/hooks";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { rewriteRelayUrl } from "@/shared/lib/mediaUrl";

import { useIsMobile } from "@/shared/hooks/use-mobile";
import { sortChannelsForSidebar } from "@/features/sidebar/lib/channelSortPreference";
import { useChannelSortPreference } from "@/features/sidebar/lib/useChannelSortPreference";
import { useSidebarScrollLock } from "@/features/sidebar/lib/useSidebarScrollLock";
import { isSidebarBackgroundTarget } from "@/features/sidebar/lib/sidebarBackgroundTarget";
import {
  sidebarOverflowUnreadLabel,
  useSidebarUnreadOverflow,
} from "@/features/sidebar/lib/useSidebarUnreadOverflow";
import {
  AppSidebarPinnedHeader,
  AppSidebarPrimaryMenu,
} from "@/features/sidebar/ui/AppSidebarPinnedHeader";
import { MoreUnreadButton, preferredUnreadTarget } from "@/features/sidebar/ui/MoreUnreadButton";
import { useConversationUnreadProjection, type ConversationUnreadEntry } from "@client-kit/platform/react/sidebar/useSidebarUnreadOverflow";
import {
  ChannelGroupSection,
  type DesktopChannelMenuExtras,
  type DesktopChannelRowOptions,
} from "@/features/sidebar/ui/ChannelGroupSection";
import type { DesktopWorkingChannel } from "@/features/sidebar/ui/ChannelMenuButton";
import { DesktopStreamChannelGroups } from "@/features/sidebar/ui/DesktopChannelSections";
import { SidebarProfileCard } from "@/features/sidebar/ui/SidebarProfileCard";
import type {
  AppSidebarProps,
  CollapsibleSidebarGroup,
} from "@/features/sidebar/ui/AppSidebar.types";
import { SidebarRelayConnectionCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import {
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/shared/ui/sidebar";

export function AppSidebar({
  activeCommunity,
  channels,
  currentPubkey,
  currentPrincipalId,
  fallbackDisplayName,
  homeBadgeCount,
  homeBadgeEnabled,
  onBackgroundClick,
  isLoading,
  profile,
  relayConnectionCard,
  errorMessage,
  selectedChannelId,
  selectedView,
  selectedPlatformSection,
  unreadChannelIds,
  highPriorityUnreadChannelIds,
  previewActivityChannelIds,
  onMarkChannelUnread,
  onMarkChannelRead,
  onMarkAllChannelsRead,
  onSelectHome,
  onNewMessage,
  onSelectChannel,
  onOpenSearchResult,
  searchChannels,
  searchFocusRequests,
  onSelectSettings,
  onSelectPlatformSection,
  onSelectApplication,
  selectedApplicationBindingId,
  applicationWorkspaceId,
  onSignOut,
  mutedChannelIds,
  onMuteChannel,
  onUnmuteChannel,
  starredChannelIds,
  onStarChannel,
  onUnstarChannel,
}: AppSidebarProps) {
  const projectSearch=useSearch({strict:false});
  const [isCreateChannelOpen, setCreateChannelOpen] = React.useState(false);
  const [isNewChannelOpen, setNewChannelOpen] = React.useState(false);
  const [isNewForumOpen, setNewForumOpen] = React.useState(false);
  useChannelNavigationShortcuts({
    disabled: !currentPrincipalId,
    onBrowseChannels: () => setCreateChannelOpen(true),
    onCreateChannel: () => setNewChannelOpen(true),
    onNewMessage,
  });
  const queryClient = useQueryClient();
  const directMessage = useDirectMessageOpen(currentPrincipalId ?? "");
  const directMessageOwner = React.useMemo(() => ({ active: true }),
    [activeCommunity.id, activeCommunity.relayUrl, currentPrincipalId, currentPubkey]);
  const currentDirectMessageOwner = React.useRef(directMessageOwner);
  currentDirectMessageOwner.current = directMessageOwner;
  React.useEffect(() => {
    directMessageOwner.active = true;
    return () => { directMessageOwner.active = false; };
  }, [directMessageOwner]);
  async function openDirectMessage({ pubkeys }: { pubkeys: string[] }) {
    if (directMessage.busy || !directMessageOwner.active ||
        currentDirectMessageOwner.current !== directMessageOwner) return;
    try {
      const conversation = await directMessage.open(pubkeys[0] ?? "");
      if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner) return;
      await queryClient.invalidateQueries({ queryKey: channelsQueryKey });
      if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner) return;
      onSelectChannel(conversation.channelId);
    } catch (error) {
      if (directMessageOwner.active && currentDirectMessageOwner.current === directMessageOwner)
        toast.error(isOutcomeUnknown(error) ? translateUi("dm.unknown") :
          error instanceof Error ? error.message : translateUi("dm.unavailable"));
    }
  }
  const workspaceDirectory = useWorkspaceChannelDirectory();
  const applicationWorkspace = nativeApplicationWorkspace(workspaceDirectory.data,
    selectedApplicationBindingId ? { workspaceId: applicationWorkspaceId } :
      { channelId: selectedView === "channel" ? selectedChannelId : null });
  const { open: sidebarOpen, openMobile } = useSidebar();
  const isMobile = useIsMobile();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  useSidebarScrollLock(scrollRef);
  const dmUnread = useConversationUnreadProjection(directMessageOwner);
  const nativeDmChannelIds = React.useMemo(() => new Set(channels.filter(channel => channel.channelType === "dm").map(channel => channel.id)), [channels]);
  const messageUnread = React.useMemo(() => new Set([
    ...[...unreadChannelIds].filter(id => !nativeDmChannelIds.has(id)), ...dmUnread.dmChannelIds,
  ]), [unreadChannelIds, nativeDmChannelIds, dmUnread.dmChannelIds]);
  const channelPreviewActivity = React.useMemo(() => new Set([...previewActivityChannelIds].filter(id => !nativeDmChannelIds.has(id))),
    [previewActivityChannelIds, nativeDmChannelIds]);
  const {
    hasHighPriorityAbove,
    hasHighPriorityBelow,
    scrollToNextAbove,
    scrollToNextBelow,
    scrollToChannel,
    unreadMessageBelowChannelIds,
    unreadAboveCount,
    unreadBelowCount,
  } = useSidebarUnreadOverflow({
    dmChannelIds: dmUnread.dmChannelIds,
    highPriorityUnreadChannelIds,
    previewActivityChannelIds: channelPreviewActivity,
    scrollRef,
    unreadChannelIds: messageUnread,
  });
  const nextUnreadDmBelowId = preferredUnreadTarget(unreadMessageBelowChannelIds, dmUnread.dmChannelIds);
  const unreadDmPreviewsBelow = unreadMessageBelowChannelIds.flatMap(channelId => {
    const preview = dmUnread.entries.find(entry => entry.channelId === channelId)?.preview;
    return preview ? [preview] : [];
  });

  const [collapsedGroups, setCollapsedGroups] = React.useState<
    Record<CollapsibleSidebarGroup, boolean>
  >({
    starred: false,
    channels: false,
    forums: false,
  });

  const toggleCollapsedGroup = React.useCallback(
    (group: CollapsibleSidebarGroup) => {
      setCollapsedGroups((current) => ({
        ...current,
        [group]: !current[group],
      }));
    },
    [],
  );

  const { sortModeFor, setSortModeFor } = useChannelSortPreference(
    currentPubkey,
    activeCommunity.relayUrl,
  );

  const streamChannels = React.useMemo(
    () => channels.filter((channel) => channel.channelType === "stream"),
    [channels],
  );

  const forumChannels = React.useMemo(
    () => sortChannelsForSidebar(channels.filter((channel) => channel.channelType === "forum"), sortModeFor("forums")),
    [channels, sortModeFor],
  );

  // Custom sections bucket and sort these themselves (DesktopStreamChannelGroups).
  const unstarredChannels = React.useMemo(
    () => streamChannels.filter((channel) => !starredChannelIds?.has(channel.id)),
    [streamChannels, starredChannelIds],
  );

  const starredChannels = React.useMemo(() => {
    if (!starredChannelIds || starredChannelIds.size === 0) return [];
    return sortChannelsForSidebar(
      streamChannels.filter((channel) => starredChannelIds.has(channel.id)),
      sortModeFor("starred"),
    );
  }, [streamChannels, starredChannelIds, sortModeFor]);

  // Original sidebarLoadingSkeleton (shared with the Web host): channel and DM row shapes.
  const loadingChannelRows = React.useMemo<SidebarLoadingSourceRow[]>(
    () => streamChannels.map((channel) => ({ id: channel.id, label: channel.name })),
    [streamChannels],
  );
  const loadingDirectMessageRows = React.useMemo<SidebarLoadingSourceRow[]>(
    () => channels.filter((channel) => channel.channelType === "dm")
      .map((channel) => ({ id: channel.id, label: channel.name })),
    [channels],
  );
  const sidebarLoadingShape = useSidebarLoadingShape({
    scopeKey: `${activeCommunity.id}:${currentPubkey ?? "anonymous"}`,
    channels: loadingChannelRows,
    directMessages: loadingDirectMessageRows,
    isLoading,
  });

  // The admitted Workspace of each joined native channel: the management identity for the
  // DD-119 Leave/Archive entries and the key of the shared Agent working signal (DD-125(6)).
  const admittedWorkspaceByChannelId = React.useMemo(
    () => new Map<string, DiscoverableWorkspace>((workspaceDirectory.data ?? [])
      .filter((row) => row.isMember && row.membershipState === WorkspaceMembershipState.Active)
      .map((row) => [row.channel.channelId, row])),
    [workspaceDirectory.data],
  );
  const workingChannels = useWorkingChannels();
  const workingByChannelId = React.useMemo(() => {
    const byScope = new Map(workingChannels.map((summary) => [summary.channelId, summary]));
    const working = new Map<string, DesktopWorkingChannel>();
    for (const [channelId, workspace] of admittedWorkspaceByChannelId) {
      const summary = byScope.get(workspace.id);
      if (summary) working.set(channelId, { scopeId: workspace.id, summary });
    }
    return working;
  }, [workingChannels, admittedWorkspaceByChannelId]);
  const { requestLeaveChannel, requestArchiveChannel, dialog: channelActionDialog } =
    useChannelSidebarActionDialogs(() => {
      // Same readback as the channel management sheet: native channels and the admitted directory.
      void queryClient.invalidateQueries({ queryKey: channelsQueryKey });
      void queryClient.invalidateQueries({ queryKey: workspaceVisibilityQueryKey });
    });
  const managementMenuFor = (group: CollapsibleSidebarGroup | "section") =>
    (channel: Channel): DesktopChannelMenuExtras | undefined => {
      const workspace = admittedWorkspaceByChannelId.get(channel.id);
      if (!workspace) return undefined;
      return {
        // Original Leave in Starred/Channels/sections, shown on the BFF leaveActionKey (DD-119(8)).
        onLeaveChannel: group !== "forums" && workspace.leaveActionKey !== undefined
          ? (row) => requestLeaveChannel({ workspaceId: workspace.id, name: row.name }) : undefined,
        // Archive reads the lifecycle hint while the menu is open (DD-119(5)).
        ownerActions: { workspaceId: workspace.id, channelId: channel.id,
          onArchiveChannel: (row) => requestArchiveChannel({ workspaceId: workspace.id, name: row.name }) },
      };
    };
  // Original section quick action: browse channels, then assign the chosen one.
  const sectionBrowseAssign = React.useRef<((channelId: string) => void) | null>(null);
  React.useEffect(() => {
    if (!isCreateChannelOpen) sectionBrowseAssign.current = null;
  }, [isCreateChannelOpen]);
  const rowOptions = (group: CollapsibleSidebarGroup): DesktopChannelRowOptions => ({
    isActiveChannel: selectedView === "channel",
    selectedChannelId,
    unreadChannelIds,
    mutedChannelIds,
    onSelectChannel,
    onMarkChannelRead,
    onMarkChannelUnread,
    onMuteChannel,
    onUnmuteChannel,
    ...(group === "forums" ? {} : { starredChannelIds, onStarChannel, onUnstarChannel }),
    menuExtrasFor: managementMenuFor(group),
    workingFor: (channel) => workingByChannelId.get(channel.id),
  });
  const resolvedDisplayName =
    profile?.displayName?.trim() ||
    fallbackDisplayName?.trim() ||
    ""; // The shared profile card supplies the original, localized empty-name fallback.

  return (
    <AppSidebarFrame onClick={(event) => {
      if (isSidebarBackgroundTarget(event.target)) onBackgroundClick?.();
    }} scrollRef={scrollRef}
      pinnedHeader={<AppSidebarPinnedHeader
          currentPubkey={currentPubkey}
          onOpenDm={openDirectMessage}
          currentChannelId={
            selectedView === "channel" ? selectedChannelId : null
          }
          onOpenSearchResult={onOpenSearchResult}
          onSelectChannel={onSelectChannel}
          onBrowseChannels={() => setCreateChannelOpen(true)}
          onCreateChannel={() => setNewChannelOpen(true)}
          searchChannels={searchChannels}
          searchFocusRequest={searchFocusRequests[0]}
          scopeSearchFocusRequest={searchFocusRequests[1]}
          suggestionChannels={channels}
        />}
      above={unreadAboveCount > 0 ? (
            <MoreUnreadButton
              count={unreadAboveCount}
              emphasis={hasHighPriorityAbove ? "primary" : "default"}
              label={sidebarOverflowUnreadLabel(unreadAboveCount)}
              onClick={scrollToNextAbove}
              position="top"
              testId="sidebar-more-unread-above"
            />
          ) : null}
      below={unreadBelowCount > 0 ? (
            <MoreUnreadButton
              bottomClassName="bottom-full"
              count={unreadBelowCount}
              dmPreviews={unreadDmPreviewsBelow}
              renderAvatar={(preview, props) => preview.author ? <UnreadDmAvatar {...props}
                key={`${preview.author.conversationId}:${preview.author.eventId}`} pubkey={preview.author.pubkey} /> : <UserAvatar {...props} />}
              targetChannelId={nextUnreadDmBelowId}
              emphasis={hasHighPriorityBelow ? "primary" : "default"}
              label={sidebarOverflowUnreadLabel(unreadBelowCount)}
              onClick={() => nextUnreadDmBelowId ? scrollToChannel(nextUnreadDmBelowId) : scrollToNextBelow()}
              position="bottom"
              testId="sidebar-more-unread-below"
            />
          ) : null}
      footer={<>            {relayConnectionCard.showSidebarRelayConnectionCard &&
            (isMobile ? openMobile : sidebarOpen) ? (
              <SidebarRelayConnectionCard
                className="mb-2"
                isConnected={relayConnectionCard.isRelayConnectionSuccess}
                isReconnectPending={relayConnectionCard.isRelayReconnectPending}
                isWaitingOnReconnectHook={
                  relayConnectionCard.isWaitingOnReconnectHook
                }
                onDismiss={relayConnectionCard.onDismissRelayConnectionCard}
                onReconnect={relayConnectionCard.onReconnectRelay}
              />
            ) : null}
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarProfileCard
                  activeCommunity={activeCommunity}
                  onOpenSettings={onSelectSettings}
                  onSignOut={onSignOut}
                  profile={profile}
                  resolvedDisplayName={resolvedDisplayName}
                />
              </SidebarMenuItem>
            </SidebarMenu></>}
      dialogs={<><CreateChannelDialog key={`create:${currentPrincipalId}`} open={isNewChannelOpen} onOpenChange={setNewChannelOpen} />
        <CreateChannelDialog key={`forum:${currentPrincipalId}`} open={isNewForumOpen} onOpenChange={setNewForumOpen} channelKind={WorkspaceChannelCreateChannelType.Forum} />
        <ChannelBrowser key={currentPrincipalId} open={isCreateChannelOpen} onOpenChange={setCreateChannelOpen}
        lastMessageAtByChannelId={new Map(channels.map((channel) => [channel.id, channel.lastMessageAt]))}
        onSelect={async (workspace) => {
          const assignToSection = sectionBrowseAssign.current;
          sectionBrowseAssign.current = null;
          await Promise.all([queryClient.invalidateQueries({ queryKey: channelsQueryKey }), queryClient.invalidateQueries({ queryKey: workspaceVisibilityQueryKey })]);
          onSelectChannel(workspace.channel.channelId);
          assignToSection?.(workspace.channel.channelId);
        }} /></>}>
              <AppSidebarPrimaryMenu
                homeBadgeCount={homeBadgeCount}
                homeBadgeEnabled={homeBadgeEnabled}
                onSelectHome={onSelectHome}
                onSelectPlatformSection={onSelectPlatformSection}
                selectedPlatformSection={selectedPlatformSection}
                projectsOverviewActive={!projectSearch.projectId}
                projectsSection={<SidebarProjects channels={channels} selectedChannelId={selectedView==="channel"?selectedChannelId:null} onSelectChannel={onSelectChannel}/>}
                selectedView={selectedView}
              />

              {currentPrincipalId ? <NativeApplicationEntries scopeKey={`${activeCommunity.id}:${currentPrincipalId}`}
                selectedId={selectedApplicationBindingId} onSelect={onSelectApplication}
                workspace={applicationWorkspace} /> : null}
              {currentPrincipalId ? <DesktopConversations currentPrincipalId={currentPrincipalId} channels={channels}
                key={JSON.stringify([activeCommunity.id, activeCommunity.relayUrl, currentPrincipalId, currentPubkey])}
                onUnreadChange={dmUnread.onUnreadChange}
                selectedChannelId={selectedView === "channel" ? selectedChannelId : null}
                onSelectChannel={onSelectChannel} onNewMessage={onNewMessage} onCloseSelected={onSelectHome} /> : null}
              {isLoading ? (
                <SidebarLoadingContent shape={sidebarLoadingShape} />
              ) : (
                <>
                  {starredChannels.length > 0 ? (
                    <ChannelGroupSection
                      {...rowOptions("starred")}
                      hasUnread={starredChannels.some((c) =>
                        unreadChannelIds.has(c.id),
                      )}
                      isCollapsed={collapsedGroups.starred}
                      items={starredChannels}
                      sortMode={sortModeFor("starred")}
                      onSortModeChange={(mode) =>
                        setSortModeFor("starred", mode)
                      }
                      actionsTestId="section-actions-starred"
                      listTestId="starred-list"
                      onMarkAllRead={() => {
                        for (const channel of starredChannels) {
                          onMarkChannelRead(channel.id, channel.lastMessageAt);
                        }
                      }}
                      onToggleCollapsed={() => toggleCollapsedGroup("starred")}
                      title="Starred"
                    />
                  ) : null}
                  {/* DD-125(5): original custom sections, drag and drop, then the Channels group. */}
                  <DesktopStreamChannelGroups
                    channels={unstarredChannels}
                    rowOptions={rowOptions("channels")}
                    hasUnreadIn={(items) => items.some((channel) => unreadChannelIds.has(channel.id))}
                    channelsHasUnread={unreadChannelIds.size > 0}
                    channelsTitle="Channels"
                    channelsCollapsed={collapsedGroups.channels}
                    onToggleChannelsCollapsed={() => toggleCollapsedGroup("channels")}
                    channelsSortMode={sortModeFor("channels")}
                    onChannelsSortModeChange={(mode) => setSortModeFor("channels", mode)}
                    onMarkAllRead={onMarkAllChannelsRead}
                    onMarkChannelsRead={(items) => {
                      for (const channel of items) onMarkChannelRead(channel.id, channel.lastMessageAt);
                    }}
                    onCreateChannel={() => setCreateChannelOpen(true)}
                    createChannelLabel={translateUi("channel.browser.title")}
                    onBrowseChannelsForSection={(assign) => {
                      sectionBrowseAssign.current = assign;
                      setCreateChannelOpen(true);
                    }}
                  />
                  <FeatureGate feature="forum">
                    <ChannelGroupSection
                      {...rowOptions("forums")}
                      hasUnread={forumChannels.some((channel) => unreadChannelIds.has(channel.id))}
                      isCollapsed={collapsedGroups.forums}
                      items={forumChannels}
                      sortMode={sortModeFor("forums")}
                      onSortModeChange={(mode) => setSortModeFor("forums", mode)}
                      actionsTestId="section-actions-forums"
                      listTestId="forum-list"
                      onMarkAllRead={() => {
                        for (const channel of forumChannels) onMarkChannelRead(channel.id, channel.lastMessageAt);
                      }}
                      onToggleCollapsed={() => toggleCollapsedGroup("forums")}
                      title={translateUi("sidebar.forums")}
                      onCreateChannel={() => setNewForumOpen(true)}
                      createChannelLabel={translateUi("sidebar.newForum")}
                    />
                  </FeatureGate>
                </>
              )}
              {channelActionDialog}

              {errorMessage && !relayConnectionCard.hasRelayUnreachableError ? (
                <div className="px-3 py-2 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}
    </AppSidebarFrame>
  );
}

function UnreadDmAvatar({pubkey, ...props}: UserAvatarProps & {pubkey: string}) {
  const session = useNativeSession();
  const query = useUserProfileQuery(pubkey, `${session.facts.communityHost}:${session.devicePubkey}`);
  const profile = query.isSuccess && !query.isFetching && query.data.pubkey === pubkey ? query.data : undefined;
  return <UserAvatar {...props} avatarUrl={profile?.avatarUrl ?? null} resolveMediaUrl={rewriteRelayUrl} />;
}

function DesktopConversations({ currentPrincipalId, selectedChannelId, onSelectChannel, onNewMessage, onCloseSelected, channels, onUnreadChange }: {
  currentPrincipalId: string; selectedChannelId: string | null;
  channels: readonly Channel[];
  onSelectChannel: (id: string) => void; onNewMessage: () => void;
  onCloseSelected: () => void;
  onUnreadChange: (entries: readonly ConversationUnreadEntry[]) => void;
}) {
  const conversations = useConversations();
  const { coreReads: reads } = useAppShell();
  const feed = useHomeFeedQuery();
  const activity = React.useMemo(() => feed.isSuccess && !feed.isFetching ? feed.data.feed.activity.filter(item => item.channelType === "dm") : undefined, [feed.isSuccess, feed.isFetching, feed.data]);
  const lastMessageAt = React.useMemo(() => new Map(channels.filter(channel => channel.channelType === "dm").map(channel => [channel.id, channel.lastMessageAt ?? null])), [channels]);
  return <ConversationList currentPrincipalId={currentPrincipalId} items={conversations.items}
    onUnreadChange={onUnreadChange}
    loading={conversations.loading} error={conversations.error ?? feed.error}
    events={activity} lastMessageAtByChannelId={lastMessageAt} reads={reads}
    selectedId={conversations.items.find((conversation) => conversation.channelId === selectedChannelId)?.id ?? null}
    onSelect={(conversation) => onSelectChannel(conversation.channelId)} onNewMessage={onNewMessage}
    onCloseSelected={onCloseSelected}
    onReload={() => { void conversations.reload().catch(() => undefined); void feed.refetch(); }} />;
}
