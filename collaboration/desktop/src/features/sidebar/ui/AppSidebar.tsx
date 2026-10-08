import * as React from "react";
import {useSearch} from "@tanstack/react-router";
import {SidebarProjects} from "./SidebarProjects";
import { AppSidebarFrame } from "@client-kit/platform/react/sidebar/app-sidebar-frame";
import { NativeApplicationEntries } from "@client-kit/platform/react/pages";
import { ChannelBrowser } from "@client-kit/platform/react/channel-browser";
import { CreateChannelDialog } from "@client-kit/platform/react/create-channel-dialog";
import { useChannelNavigationShortcuts } from "@client-kit/platform/react/use-channel-navigation-shortcuts";
import { useQueryClient } from "@tanstack/react-query";
import { channelsQueryKey, workspaceVisibilityQueryKey } from "@/features/channels/hooks";
import { ConversationList, useConversations } from "@client-kit/platform/react/new-message";
import { translate, resolveLocale } from "@client-kit/platform/i18n";
import { useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { useHomeFeedQuery } from "@/features/home/hooks";
import type { Channel } from "@/shared/api/types";

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
import { MoreUnreadButton } from "@/features/sidebar/ui/MoreUnreadButton";
import { ChannelGroupSection } from "@/features/sidebar/ui/ChannelGroupSection";
import { SidebarProfileCard } from "@/features/sidebar/ui/SidebarProfileCard";
import type {
  AppSidebarProps,
  CollapsibleSidebarGroup,
} from "@/features/sidebar/ui/AppSidebar.types";
import { SidebarRelayConnectionCard } from "@/features/sidebar/ui/SidebarRelayConnectionCard";
import {
  SidebarLoadingContent,
  useSidebarLoadingShape,
} from "@/features/sidebar/ui/sidebarLoadingSkeleton";
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
  useChannelNavigationShortcuts({
    disabled: !currentPrincipalId,
    onBrowseChannels: () => setCreateChannelOpen(true),
    onCreateChannel: () => setNewChannelOpen(true),
    onNewMessage,
  });
  const queryClient = useQueryClient();
  const { open: sidebarOpen, openMobile } = useSidebar();
  const isMobile = useIsMobile();
  const scrollRef = React.useRef<HTMLDivElement>(null);
  useSidebarScrollLock(scrollRef);
  const {
    hasHighPriorityAbove,
    hasHighPriorityBelow,
    scrollToNextAbove,
    scrollToNextBelow,
    unreadAboveCount,
    unreadBelowCount,
  } = useSidebarUnreadOverflow({
    highPriorityUnreadChannelIds,
    previewActivityChannelIds,
    scrollRef,
    unreadChannelIds,
  });

  const [collapsedGroups, setCollapsedGroups] = React.useState<
    Record<CollapsibleSidebarGroup, boolean>
  >({
    starred: false,
    channels: false,
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

  const unstarredChannels = React.useMemo(
    () =>
      sortChannelsForSidebar(
        streamChannels.filter((channel) => !starredChannelIds?.has(channel.id)),
        sortModeFor("channels"),
      ),
    [streamChannels, starredChannelIds, sortModeFor],
  );

  const starredChannels = React.useMemo(() => {
    if (!starredChannelIds || starredChannelIds.size === 0) return [];
    return sortChannelsForSidebar(
      streamChannels.filter((channel) => starredChannelIds.has(channel.id)),
      sortModeFor("starred"),
    );
  }, [streamChannels, starredChannelIds, sortModeFor]);

  const sidebarLoadingShape = useSidebarLoadingShape({
    activeCommunityId: activeCommunity.id,
    currentPubkey,
    isLoading,
    streamChannels,
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
          currentChannelId={
            selectedView === "channel" ? selectedChannelId : null
          }
          onOpenSearchResult={onOpenSearchResult}
          onSelectChannel={onSelectChannel}
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
              emphasis={hasHighPriorityBelow ? "primary" : "default"}
              label={sidebarOverflowUnreadLabel(unreadBelowCount)}
              onClick={scrollToNextBelow}
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
        <ChannelBrowser key={currentPrincipalId} open={isCreateChannelOpen} onOpenChange={setCreateChannelOpen}
        lastMessageAtByChannelId={new Map(channels.map((channel) => [channel.id, channel.lastMessageAt]))}
        onSelect={async (workspace) => { await Promise.all([queryClient.invalidateQueries({ queryKey: channelsQueryKey }), queryClient.invalidateQueries({ queryKey: workspaceVisibilityQueryKey })]); onSelectChannel(workspace.channel.channelId); }} /></>}>
              <AppSidebarPrimaryMenu
                onNewMessage={onNewMessage}
                homeBadgeCount={homeBadgeCount}
                onSelectHome={onSelectHome}
                onSelectPlatformSection={onSelectPlatformSection}
                selectedPlatformSection={selectedPlatformSection}
                projectsOverviewActive={!projectSearch.projectId}
                projectsSection={<SidebarProjects channels={channels} selectedChannelId={selectedView==="channel"?selectedChannelId:null} onSelectChannel={onSelectChannel}/>}
                selectedView={selectedView}
              />

              {currentPrincipalId ? <NativeApplicationEntries scopeKey={`${activeCommunity.id}:${currentPrincipalId}`}
                selectedId={selectedApplicationBindingId} onSelect={onSelectApplication}
                workspace={channels.find((channel) => channel.channelType !== "dm" && channel.id === (selectedApplicationBindingId ? applicationWorkspaceId : selectedView === "channel" ? selectedChannelId : undefined))} /> : null}
              {currentPrincipalId ? <DesktopConversations currentPrincipalId={currentPrincipalId} channels={channels}
                selectedChannelId={selectedView === "channel" ? selectedChannelId : null}
                onSelectChannel={onSelectChannel} onNewMessage={onNewMessage} onCloseSelected={onSelectHome} /> : null}
              {isLoading ? (
                <SidebarLoadingContent shape={sidebarLoadingShape} />
              ) : (
                <>
                  {starredChannels.length > 0 ? (
                    <ChannelGroupSection
                      hasUnread={starredChannels.some((c) =>
                        unreadChannelIds.has(c.id),
                      )}
                      isCollapsed={collapsedGroups.starred}
                      isActiveChannel={selectedView === "channel"}
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
                      onMarkChannelRead={onMarkChannelRead}
                      onMarkChannelUnread={onMarkChannelUnread}
                      onSelectChannel={onSelectChannel}
                      onToggleCollapsed={() => toggleCollapsedGroup("starred")}
                      selectedChannelId={selectedChannelId}
                      title="Starred"
                      unreadChannelIds={unreadChannelIds}
                      mutedChannelIds={mutedChannelIds}
                      onMuteChannel={onMuteChannel}
                      onUnmuteChannel={onUnmuteChannel}
                      starredChannelIds={starredChannelIds}
                      onStarChannel={onStarChannel}
                      onUnstarChannel={onUnstarChannel}
                    />
                  ) : null}
                  <ChannelGroupSection
                    hasUnread={unreadChannelIds.size > 0}
                    isCollapsed={collapsedGroups.channels}
                    isActiveChannel={selectedView === "channel"}
                    items={unstarredChannels}
                    sortMode={sortModeFor("channels")}
                    onSortModeChange={(mode) =>
                      setSortModeFor("channels", mode)
                    }
                    actionsTestId="section-actions-channels"
                    listTestId="stream-list"
                    onMarkAllRead={onMarkAllChannelsRead}
                    onMarkChannelRead={onMarkChannelRead}
                    onMarkChannelUnread={onMarkChannelUnread}
                    onSelectChannel={onSelectChannel}
                    onToggleCollapsed={() => toggleCollapsedGroup("channels")}
                    selectedChannelId={selectedChannelId}
                    title="Channels"
                    onCreateChannel={() => setCreateChannelOpen(true)}
                    createChannelLabel={translate(resolveLocale(), "channel.browser.title")}
                    unreadChannelIds={unreadChannelIds}
                    mutedChannelIds={mutedChannelIds}
                    onMuteChannel={onMuteChannel}
                    onUnmuteChannel={onUnmuteChannel}
                    starredChannelIds={starredChannelIds}
                    onStarChannel={onStarChannel}
                    onUnstarChannel={onUnstarChannel}
                  />
                </>
              )}

              {errorMessage && !relayConnectionCard.hasRelayUnreachableError ? (
                <div className="px-3 py-2 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}
    </AppSidebarFrame>
  );
}

function DesktopConversations({ currentPrincipalId, selectedChannelId, onSelectChannel, onNewMessage, onCloseSelected, channels }: {
  currentPrincipalId: string; selectedChannelId: string | null;
  channels: readonly Channel[];
  onSelectChannel: (id: string) => void; onNewMessage: () => void;
  onCloseSelected: () => void;
}) {
  const conversations = useConversations();
  const session = useNativeSession();
  const reads = useInboxState(session.client);
  const feed = useHomeFeedQuery();
  const activity = React.useMemo(() => feed.isSuccess ? feed.data.feed.activity.filter(item => item.channelType === "dm") : undefined, [feed.isSuccess, feed.data]);
  const lastMessageAt = React.useMemo(() => new Map(channels.filter(channel => channel.channelType === "dm").map(channel => [channel.id, channel.lastMessageAt ?? null])), [channels]);
  return <ConversationList currentPrincipalId={currentPrincipalId} items={conversations.items}
    loading={conversations.loading} error={conversations.error ?? feed.error}
    events={activity} lastMessageAtByChannelId={lastMessageAt} reads={reads}
    selectedId={conversations.items.find((conversation) => conversation.channelId === selectedChannelId)?.id ?? null}
    onSelect={(conversation) => onSelectChannel(conversation.channelId)} onNewMessage={onNewMessage}
    onCloseSelected={onCloseSelected}
    onReload={() => { void conversations.reload().catch(() => undefined); void feed.refetch(); }} />;
}
