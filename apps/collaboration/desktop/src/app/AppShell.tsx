import * as React from "react";
import { Outlet, useLocation } from "@tanstack/react-router";
import { deriveShellRoute, markAllReadSources } from "@/app/AppShell.helpers";
import * as BuzzTheme from "@/app/BuzzThemeSurfaces";
import { AppShellProvider } from "@/app/AppShellContext";
import { AppShellChannelSurface } from "@/app/AppShellChannelSurface";
import { AppTopChrome } from "@/app/AppTopChrome";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useBackForwardControls } from "@/app/navigation/useBackForwardControls";
import { useMarkAsReadShortcuts } from "@/app/useMarkAsReadShortcuts";
import { useSettingsShortcuts } from "@/app/useSettingsShortcuts";
import { useAppShellKeyboardShortcuts } from "@/app/useAppShellKeyboardShortcuts";
import { useAppShellDesktopNotifications } from "@/app/useAppShellDesktopNotifications";
import { useAppShellLifecycleEffects } from "@/app/useAppShellLifecycleEffects";
import { useChannelActivityProjection } from "@/app/useChannelActivityProjection";
import { useTauriWindowDrag } from "@/app/useTauriWindowDrag";
import { useWebviewZoomShortcuts } from "@/app/useWebviewZoomShortcuts";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useUnreadChannels } from "@/features/channels/useUnreadChannels";
import { useMembershipNotifications } from "@/features/channels/useMembershipNotifications";
import { useFeedItemState } from "@/features/home/useFeedItemState";
import { useThreadFollows } from "@/features/messages/lib/useThreadFollows";
import {
  useHomeFeedNotifications,
  useHomeFeedNotificationState,
} from "@/features/notifications/hooks";
import { useProfileQuery } from "@/features/profile/hooks";
import {
  DEFAULT_SETTINGS_SECTION,
  type SettingsSection,
  isSettingsSection,
} from "@/features/settings/ui/SettingsPanels";
import { AppSidebar } from "@/features/sidebar/ui/AppSidebar";
import {
  useActiveCommunity,
  useNativeSession,
} from "@/features/platform/activeCommunity";
import { requestFocusedThreadClose } from "@/features/channels/focusedThreadCloseRequest";
import { useChannelMutes } from "@/features/sidebar/lib/useChannelMutes";
import { useChannelStars } from "@/features/sidebar/lib/useChannelStars";
import { useIdentityQuery } from "@/shared/api/hooks";
import { useRelayAutoHeal } from "@/shared/api/useRelayAutoHeal";
import { useWebviewScrollBoundaryLock } from "@/shared/hooks/useWebviewScrollBoundaryLock";
import type { SearchHit } from "@/shared/api/types";
import { ChannelNavigationProvider } from "@/shared/context/ChannelNavigationContext";
import { useAppDeepLinks } from "@/shared/useAppDeepLinks";
import { SidebarProvider } from "@/shared/ui/sidebar";
import { RelayConnectionOverlay } from "@/app/RelayConnectionOverlay";
import { useSidebarRelayConnectionCard } from "@/features/sidebar/ui/useSidebarRelayConnectionCard";
import { AppProfilePanelProvider } from "@/app/AppProfilePanelProvider";
import { LazySettingsScreen } from "@/app/LazySettingsScreen";

export function AppShell() {
  useWebviewZoomShortcuts();
  useTauriWindowDrag();
  useWebviewScrollBoundaryLock();
  const activeCommunity = useActiveCommunity();
  const nativeSession = useNativeSession();
  const [searchFocusRequest, setSearchFocusRequest] = React.useState(0);
  const [scopeSearchFocusRequest, setScopeSearchFocusRequest] =
    React.useState(0);
  const mainInsetRef = React.useRef<HTMLElement>(null);
  const location = useLocation();
  const {
    goChannel,
    goHome,
    goPlatform,
    goSettings,
    closeSettings,
    openSearchHit,
  } = useAppNavigation();
  const { canGoBack, canGoForward, goBack, goForward } =
    useBackForwardControls();
  const { selectedChannelId, selectedPlatformSection, selectedView } =
    React.useMemo(
      () => deriveShellRoute(location.pathname),
      [location.pathname],
    );
  // Settings lives in history so back returns to the previous app entry.
  const settingsOpen = location.pathname === "/settings";
  const locationSearchSection = (location.search as { section?: unknown })
    .section;
  const settingsSection: SettingsSection = isSettingsSection(
    locationSearchSection,
  )
    ? locationSearchSection
    : DEFAULT_SETTINGS_SECTION;
  const identityQuery = useIdentityQuery();
  const { mutedChannelIds, muteChannel, unmuteChannel } = useChannelMutes(
    identityQuery.data?.pubkey,
  );
  const { starredChannelIds, starChannel, unstarChannel } = useChannelStars(
    identityQuery.data?.pubkey,
  );
  const profileQuery = useProfileQuery();
  useRelayAutoHeal();
  useMembershipNotifications(identityQuery.data?.pubkey);
  const { feedProfilesQuery, homeFeedQuery, notificationSettings } =
    useHomeFeedNotifications(identityQuery.data?.pubkey);
  const feedItemState = useFeedItemState(identityQuery.data?.pubkey);
  const channelsQuery = useChannelsQuery();
  const channels = channelsQuery.data ?? [];
  const refetchHomeFeedFromLiveSignal = React.useEffectEvent(() => {
    void homeFeedQuery.refetch();
  });
  const { refetch: refetchChannels } = channelsQuery;
  const channelsErrorMessage =
    channelsQuery.error instanceof Error
      ? channelsQuery.error.message
      : undefined;
  const relayConnectionCard = useSidebarRelayConnectionCard(
    channelsErrorMessage,
    activeCommunity.relayUrl,
    activeCommunity.id,
  );
  const sidebarChannels = React.useMemo(
    () =>
      channels.filter(
        (channel) => channel.isMember && channel.archivedAt === null,
      ),
    [channels],
  );
  const activeChannel = React.useMemo(
    () =>
      selectedChannelId
        ? (channels.find((channel) => channel.id === selectedChannelId) ?? null)
        : null,
    [channels, selectedChannelId],
  );
  const { handleChannelNotification, handleThreadReplyDesktopNotification } =
    useAppShellDesktopNotifications({
      channels,
      goChannel,
      goHome,
      notificationSettings: notificationSettings.settings,
      openSearchHit,
      pubkey: identityQuery.data?.pubkey,
    });
  const {
    followedRootIds,
    isFollowing: isFollowingThread,
    followThread,
    unfollowThread,
  } = useThreadFollows(identityQuery.data?.pubkey);
  const {
    markAllChannelsRead: markAllChannelReadMarkers,
    markChannelRead,
    markChannelUnread,
    clearChannelUnreadSource,
    unreadChannelIds,
    topLevelUnreadChannelIds,
    highPriorityUnreadChannelIds,
    unreadChannelNotificationCount,
    getEffectiveTimestamp: getChannelReadAt,
    getOwnTimestamp: getOwnReadAt,
    readStateVersion,
    setContextParentResolver,
    participatedRootIds,
    authoredRootIds,
    mentionedRootIds,
    recordThreadInteraction,
    threadActivityItems,
    mutedRootIds,
    muteThread,
    unmuteThread,
  } = useUnreadChannels(sidebarChannels, activeChannel, {
    pubkey: identityQuery.data?.pubkey,
    relayUrl: activeCommunity.relayUrl,
    currentPubkey: identityQuery.data?.pubkey,
    mutedChannelIds,
    notifyForActiveChannel: notificationSettings.settings.notifyWhileViewing,
    onChannelMessage: handleChannelNotification,
    onLiveMention: refetchHomeFeedFromLiveSignal,
    onThreadReplyDesktopNotification: handleThreadReplyDesktopNotification,
    followedRootIds,
  });

  const {
    getThreadReadAt,
    markThreadRead,
    getMessageReadAt,
    getChannelActivityItemReadAt,
    markMessageRead,
    threadActivityFeedItems,
    locallyUnreadFeedItems,
    unreadThreadFeedItems,
    unreadThreadChannelIds,
  } = useChannelActivityProjection({
    channels,
    feed: homeFeedQuery.data?.feed,
    unreadFeedItemIds: feedItemState.unreadSet,
    getChannelReadAt,
    getOwnReadAt,
    markChannelRead,
    readStateVersion,
    threadActivityItems,
    mutedRootIds,
  });
  const markAllChannelsRead = React.useCallback(() => {
    markAllReadSources({
      activeChannelId: activeChannel?.id ?? null,
      channelActivityItems: unreadThreadFeedItems,
      markAllChannelReadMarkers,
      markActiveChannelRead: (channelId, createdAt) =>
        markChannelRead(channelId, new Date(createdAt * 1_000).toISOString()),
      undoUnreadFeedItem: feedItemState.undoUnread,
      unreadFeedItemIds: feedItemState.unreadSet,
    });
  }, [
    activeChannel?.id,
    feedItemState.undoUnread,
    feedItemState.unreadSet,
    markAllChannelReadMarkers,
    markChannelRead,
    unreadThreadFeedItems,
  ]);

  const { homeBadgeCount, homeBadgeCountExcludingHighPriority } =
    useHomeFeedNotificationState(
      homeFeedQuery.data,
      identityQuery.data?.pubkey,
      notificationSettings.settings,
      notificationSettings.setDesktopEnabled,
      true,
      selectedView === "home" && !settingsOpen,
      getChannelReadAt,
      readStateVersion,
      highPriorityUnreadChannelIds,
      feedProfilesQuery.data?.profiles,
      mutedChannelIds,
      feedItemState.unreadSet,
      threadActivityFeedItems,
      getThreadReadAt,
      getMessageReadAt,
      channels,
    );
  const isNotifiedForThread = React.useCallback(
    (rootId: string) =>
      !mutedRootIds.has(rootId) &&
      (followedRootIds.has(rootId) ||
        participatedRootIds.has(rootId) ||
        authoredRootIds.has(rootId) ||
        mentionedRootIds.has(rootId)),
    [
      followedRootIds,
      mutedRootIds,
      participatedRootIds,
      authoredRootIds,
      mentionedRootIds,
    ],
  );

  const handleFollowThread = React.useCallback(
    (rootId: string) => {
      followThread(rootId);
      unmuteThread(rootId);
    },
    [followThread, unmuteThread],
  );

  const handleUnfollowThread = React.useCallback(
    (rootId: string) => {
      unfollowThread(rootId);
      muteThread(rootId);
    },
    [unfollowThread, muteThread],
  );

  const handleOpenSearch = React.useCallback(() => {
    setSearchFocusRequest((request) => request + 1);
    void refetchChannels();
  }, [refetchChannels]);
  const handleOpenChannelSearch = React.useCallback(() => {
    setScopeSearchFocusRequest((request) => request + 1);
    void refetchChannels();
  }, [refetchChannels]);

  const handleOpenSettings = React.useCallback(
    (section: SettingsSection = DEFAULT_SETTINGS_SECTION) => {
      void goSettings(section);
    },
    [goSettings],
  );
  const handleCloseSettings = React.useCallback(
    () => closeSettings(),
    [closeSettings],
  );
  // Section switches rewrite the settings entry rather than stacking one
  // history entry per section, so back always exits settings in one step.
  const handleSettingsSectionChange = React.useCallback(
    (section: SettingsSection) => {
      void goSettings(section, { replace: true });
    },
    [goSettings],
  );

  const handleOpenSearchResult = React.useCallback(
    (hit: SearchHit, query: string) => {
      void openSearchHit(hit, { query });
    },
    [openSearchHit],
  );
  useAppShellLifecycleEffects({
    homeBadgeCountExcludingHighPriority,
    topLevelUnreadChannelIds,
    unreadChannelNotificationCount,
  });
  useAppDeepLinks();
  useAppShellKeyboardShortcuts({
    canSearchCurrentChannel:
      selectedView === "channel" && Boolean(activeChannel),
    disabled: settingsOpen,
    onGoHome: goHome,
    onSearchCurrentChannel: handleOpenChannelSearch,
    onSearchEverything: handleOpenSearch,
  });
  useSettingsShortcuts({
    onClose: handleCloseSettings,
    onOpenSettings: handleOpenSettings,
    open: settingsOpen,
  });
  useMarkAsReadShortcuts({
    activeChannelId: activeChannel?.id ?? null,
    activeChannelLastMessageAt: activeChannel?.lastMessageAt,
    markAllChannelsRead,
    markChannelRead,
    selectedView,
  });
  return (
    <ChannelNavigationProvider channels={channels}>
      <AppShellProvider
        value={{
          markAllChannelsRead,
          markChannelRead,
          markChannelUnread,
          clearChannelUnreadSource,
          getChannelReadAt,
          getThreadReadAt,
          markThreadRead,
          getMessageReadAt,
          getChannelActivityItemReadAt,
          markMessageRead,
          readStateVersion,
          setContextParentResolver,
          followThread: handleFollowThread,
          unfollowThread: handleUnfollowThread,
          isFollowingThread,
          isNotifiedForThread,
          recordThreadInteraction,
          isThreadMuted: (rootId) => mutedRootIds.has(rootId),
          threadActivityItems,
          threadActivityFeedItems,
          locallyUnreadFeedItems,
          unreadThreadFeedItems,
          unreadThreadChannelIds,
          topLevelUnreadChannelIds,
          hasSidebarUnreadProjections: true,
          feedItemState,
          onOpenSettings: handleOpenSettings,
        }}
      >
        <div className="relative h-dvh overflow-hidden overscroll-none">
          <div className="absolute inset-0 z-10 flex min-h-0 flex-row overflow-hidden bg-background">
            <BuzzTheme.GradientLayer />
            <SidebarProvider
              className="relative z-10 min-h-0 min-w-0 flex-1 flex-col overflow-visible"
              data-testid="app-sidebar-layer"
            >
              <AppProfilePanelProvider>
                {!settingsOpen ? (
                  <AppTopChrome
                    canGoBack={canGoBack}
                    canGoForward={canGoForward}
                    onGoBack={goBack}
                    onGoForward={goForward}
                  />
                ) : null}
                {settingsOpen ? (
                  <div className="flex min-h-0 flex-1 overflow-hidden">
                    <React.Suspense fallback={null}>
                      <LazySettingsScreen
                        isUpdatingDesktopNotifications={
                          notificationSettings.isUpdatingDesktopEnabled
                        }
                        notificationErrorMessage={
                          notificationSettings.errorMessage
                        }
                        notificationPermission={notificationSettings.permission}
                        notificationSettings={notificationSettings.settings}
                        onClose={handleCloseSettings}
                        onSectionChange={handleSettingsSectionChange}
                        onSetDesktopNotificationsEnabled={
                          notificationSettings.setDesktopEnabled
                        }
                        onSetHomeBadgeEnabled={
                          notificationSettings.setHomeBadgeEnabled
                        }
                        onSetSlotAlertsEnabled={
                          notificationSettings.setSlotAlertsEnabled
                        }
                        onSetNotifyWhileViewing={
                          notificationSettings.setNotifyWhileViewing
                        }
                        onSetAllSlotAlertsEnabled={
                          notificationSettings.setAllSlotAlertsEnabled
                        }
                        onSetSoundForSlot={notificationSettings.setSoundForSlot}
                        section={settingsSection}
                      />
                    </React.Suspense>
                  </div>
                ) : (
                  <div className="relative flex min-h-0 flex-1 overflow-visible">
                    <AppSidebar
                      activeCommunity={activeCommunity}
                      channels={sidebarChannels}
                      currentPubkey={identityQuery.data?.pubkey}
                      errorMessage={channelsErrorMessage}
                      fallbackDisplayName={identityQuery.data?.displayName}
                      homeBadgeCount={homeBadgeCount}
                      relayConnectionCard={relayConnectionCard}
                      isLoading={channelsQuery.isLoading}
                      onBackgroundClick={requestFocusedThreadClose}
                      onMarkAllChannelsRead={markAllChannelsRead}
                      onMarkChannelRead={markChannelRead}
                      onMarkChannelUnread={markChannelUnread}
                      onSelectChannel={(channelId) => void goChannel(channelId)}
                      onOpenSearchResult={handleOpenSearchResult}
                      searchChannels={channels}
                      searchFocusRequests={[
                        searchFocusRequest,
                        scopeSearchFocusRequest,
                      ]}
                      onSelectHome={() => void goHome()}
                      onSelectPlatformSection={(section) =>
                        void goPlatform(section)
                      }
                      onSignOut={() => {
                        // 回到首页再退出：下次登录不停留在上一个会话的页面上
                        void goHome({ replace: true }).then(() =>
                          nativeSession.signOut(),
                        );
                      }}
                      onSelectSettings={handleOpenSettings}
                      profile={profileQuery.data}
                      selectedChannelId={selectedChannelId}
                      selectedView={selectedView}
                      selectedPlatformSection={selectedPlatformSection}
                      unreadChannelIds={unreadChannelIds}
                      highPriorityUnreadChannelIds={
                        highPriorityUnreadChannelIds
                      }
                      previewActivityChannelIds={unreadThreadChannelIds}
                      mutedChannelIds={mutedChannelIds}
                      onMuteChannel={muteChannel}
                      onUnmuteChannel={unmuteChannel}
                      starredChannelIds={starredChannelIds}
                      onStarChannel={starChannel}
                      onUnstarChannel={unstarChannel}
                    />
                    <AppShellChannelSurface mainInsetRef={mainInsetRef}>
                      <Outlet />
                    </AppShellChannelSurface>
                    <RelayConnectionOverlay
                      card={relayConnectionCard}
                      errorMessage={channelsErrorMessage}
                    />
                  </div>
                )}
              </AppProfilePanelProvider>
            </SidebarProvider>
          </div>
        </div>
      </AppShellProvider>
    </ChannelNavigationProvider>
  );
}
