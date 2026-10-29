import { useNeedsActionSource } from "@client-kit/platform/react/inbox/needs-action";
import { InboxView, useInboxViewState, type InboxViewStatus } from "@client-kit/platform/react/inbox-view";
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InboxDetailChannelMembers } from "@client-kit/platform/react/inbox/InboxDetailChannelMembers";
import { channelsQueryKey, nativeApplicationWorkspace, useWorkspaceChannelDirectory, workspaceVisibilityQueryKey } from "@/features/channels/hooks";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { useNavigate } from "@tanstack/react-router";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { Markdown } from "@/shared/ui/markdown";
import type { Channel } from "@/shared/api/types";

import { inboxReadContext } from "@client-kit/platform/inbox";
import { useCurrentPrincipalId, useLocale, useT } from "@client-kit/platform/react/context";
import { useConversations, useHiddenDmInboxNavigation } from "@client-kit/platform/react/new-message";
import { toast } from "sonner";
import { useChannelsQuery } from "@/features/channels/hooks";
import { RightAuxiliaryPane } from "@/features/channels/ui/RightAuxiliaryPane";
import {
  type InboxItem,
  type InboxReply,
  buildInboxItems,
  findInboxItemByEventId,
  formatInboxFullTimestamp,
  getInboxItemConversationId,
} from "@/features/home/lib/inbox";
import { useInboxSelectionAnchor } from "@/features/home/useInboxSelectionAnchor";
import { matchesInboxFilter } from "@/features/home/lib/inboxViewHelpers";
import { useHomeDrafts } from "@/features/home/useHomeDrafts";
import { useOwnedAgentActivity } from "@/features/home/useOwnedAgentActivity";
import {
  inboxReadContexts,
} from "@client-kit/platform/react/use-inbox-state";
import { useNativeSession } from "@/features/platform/activeCommunity";
import { useAppShell } from "@/app/AppShellContext";
import { useHomeInboxContextMessages } from "@/features/home/useHomeInboxContextMessages";
import { useInboxThreadContext } from "@/features/home/useInboxThreadContext";
import { channelMessagesKey } from "@/features/messages/lib/messageQueryKeys";
import type { RelayEvent } from "@/shared/api/types";
import type { TimelineMessage } from "@/features/messages/types";
import { editMessage, deleteMessage } from "@/shared/api/tauriMessages";
import { TransportError } from "@client-kit/platform/transport";
import { UserProfilePanel } from "@/features/profile/ui/UserProfilePanel";
import { getHomeMessageCapabilities } from "@/features/home/lib/homeMessageCapabilities";
import { InboxDetailPane } from "@/features/home/ui/InboxDetailPane";
import { nativeInboxListPresentation } from "@/features/home/ui/InboxListPane";
import { useChannelMessagesQuery, useToggleReactionMutation } from "@/features/messages/hooks";
import { collectMessageMentionPubkeys } from "@/features/messages/lib/formatTimelineMessages";
import { formatTime } from "@/features/messages/lib/dateFormatters";
import { splitOutgoingTags } from "@/features/messages/lib/imetaMediaMarkdown";
import { getThreadReference } from "@/features/messages/lib/threading";
import { DraftDetailPane } from "@/features/messages/ui/DraftDetailPane";
import { DraftsPanel } from "@/features/messages/ui/DraftsPanel";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveUserLabel } from "@/features/profile/lib/identity";
import { useRelaySelfQuery } from "@/shared/api/relaySelf";
import { sendChannelMessage } from "@/shared/api/tauri";
import type { InboxFeed } from "@/shared/api/types";
import { useThreadPanelWidth } from "@/shared/hooks/useThreadPanelWidth";
import { useHistorySearchState } from "@/shared/hooks/useHistorySearchState";
import { ProfilePanelProvider } from "@/shared/context/ProfilePanelContext";
import {loadProjectWorkItems,projectInboxMentions,resolveProjectInboxWorkItem,projectWorkItemTarget,ProjectInboxDetail} from "@client-kit/platform/react/projects";
import {useAppNavigation} from "@/app/navigation/useAppNavigation";
import {useProjectsHost} from "@/features/platform/ProjectsScreen";
import {PulseScreen} from "@/features/platform/PulseScreen";

const INBOX_SEARCH_KEYS = ["item", "profile"] as const;

type HomeViewProps = {
  feed?: InboxFeed;
  isLoading?: boolean;
  errorMessage?: string;
  currentPubkey?: string;
  availableChannelIds: ReadonlySet<string>;
  onOpenContext: (
    channelId: string,
    messageId: string,
    threadRootId?: string | null,
  ) => void;
  onRefresh: () => void;
};

// Native host adapter for the shared original Inbox page body
// (@client-kit/platform/react/inbox-view). This file keeps only the Desktop
// transport facts: the Relay feed admitted by Core read state, native
// signing/publication, Tauri channel windows, drafts storage and profiles.
export function HomeView({
  feed,
  isLoading = false,
  errorMessage,
  currentPubkey,
  availableChannelIds,
  onOpenContext,
  onRefresh,
}: HomeViewProps) {
  const t = useT();
  const {goProject}=useAppNavigation();
  const locale = useLocale();
  const relaySelfPubkey = useRelaySelfQuery().data;
  // Explicit selections are mirrored to the URL (`?item=`), so back/forward
  // restores the detail pane each history entry was showing and reloads
  // restore it from the URL. Default/automatic selection stays local-only —
  // background data loads must never trigger navigations.
  const { applyPatch: applyInboxSearchPatch, values: inboxSearchValues } =
    useHistorySearchState(INBOX_SEARCH_KEYS);
  const view = useInboxViewState({
    itemId: inboxSearchValues.item,
    setItemId: React.useCallback((item: string | null) => applyInboxSearchPatch({ item }), [applyInboxSearchPatch]),
  });
  const {
    activeCount: activeDraftCount,
    deleteDraft: handleDeleteDraft,
    items: draftItems,
    selectedItem: selectedDraftItem,
    selectedKey: selectedDraftKey,
    selectDraft: setSelectedDraftKey,
  } = useHomeDrafts({
    autoSelect: view.isDrafts,
    isNarrowHomeViewport: view.isNarrow,
    selectionEnabled: view.isDrafts,
    viewportWidthPx: view.widthPx,
    selectedKey: view.selectedDraftKey,
    setSelectedKey: view.setSelectedDraftKey,
  });
  const selectedEventId = view.selectedEventId;
  const profilePanelPubkey = inboxSearchValues.profile;
  const handleOpenProfilePanel = React.useCallback(
    (pubkey: string) => {
      applyInboxSearchPatch({ profile: pubkey });
    },
    [applyInboxSearchPatch],
  );
  const handleCloseProfilePanel = React.useCallback(() => {
    applyInboxSearchPatch({ profile: null });
  }, [applyInboxSearchPatch]);
  // Optimistic local replies outlive a narrow-layout detail unmount.
  const [localRepliesByItemId, setLocalRepliesByItemId] = React.useState<
    Record<string, InboxReply[]>
  >({});
  const {
    canReset: canResetThreadPanelWidth,
    onResetWidth: handleThreadPanelWidthReset,
    onResizeStart: handleThreadPanelResizeStart,
    widthPx: threadPanelWidthPx,
  } = useThreadPanelWidth();
  const nativeSession = useNativeSession();
  // DD-125(5): management facts come from this authenticated BFF session,
  // not the device pubkey or the closed Buzz workflow event stream.
  const principalId = useCurrentPrincipalId();
  const needsAction = useNeedsActionSource({ client: nativeSession.client, scopeKey: principalId ?? "", enabled: Boolean(principalId) });
  const projectsHost=useProjectsHost();
  const projectQuery=useQuery({queryKey:["projects",projectsHost?.scopeKey,"inbox-work-items"],enabled:Boolean(projectsHost),
    queryFn:({signal})=>{if(!projectsHost)throw new Error("Project scope unavailable");return loadProjectWorkItems(projectsHost,signal);},retry:false});
  const { coreReads, componentNotifications } = useAppShell();
  if (!coreReads) throw new Error("Missing Core read-state context");
  const hiddenDm = useHiddenDmInboxNavigation({ scopeKey: `${nativeSession.facts.relayUrl}:${nativeSession.devicePubkey}`,
    conversations: coreReads.conversations,
    onOpenContext: ({ channelId, messageId, threadRootId }) => onOpenContext(channelId, messageId, threadRootId), onError: message => toast.error(message) });
  const admittedChannelIds = React.useMemo(
    () =>
      new Set(
        [...coreReads.visibleChannels].filter((id) => availableChannelIds.has(id) || coreReads.conversations.some(item => item.channelId === id)),
      ),
    [availableChannelIds, coreReads.visibleChannels, coreReads.conversations],
  );
  const ownedAgents = useOwnedAgentActivity(coreReads.workspaceChannels, Boolean(coreReads.state) && !coreReads.failed && !coreReads.unknown);
  const channelsQuery = useChannelsQuery();
  const channels = channelsQuery.data;
  const admittedFeed = React.useMemo(
    () =>
      feed && coreReads.state
        ? {
            mentions: [...feed.mentions.filter(
              (item) =>
                item.channelId && coreReads.visibleChannels.has(item.channelId),
            ).map(item => ({...item, channelType: coreReads.conversations.some(conversation => conversation.channelId === item.channelId) ? "dm" : channels?.find(channel=>channel.id===item.channelId)?.channelType ?? item.channelType})),...(projectQuery.isSuccess?projectInboxMentions(projectQuery.data):[])],
            activity: [...feed.activity, ...(ownedAgents.data?.activity ?? [])].filter(
              (item) =>
                item.channelId && coreReads.visibleChannels.has(item.channelId),
            ).map(item => ({...item, channelType: coreReads.conversations.some(conversation => conversation.channelId === item.channelId) ? "dm" : channels?.find(channel=>channel.id===item.channelId)?.channelType ?? item.channelType})),
          }
        : undefined,
    [feed, coreReads.state, coreReads.visibleChannels, coreReads.conversations, ownedAgents.data,projectQuery.data,projectQuery.isSuccess,channels],
  );
  const getMessageReadAt = React.useCallback(
    (id: string) => coreReads.readAt(`msg:${id}`),
    [coreReads.readAt],
  );
  const getThreadReadAt = React.useCallback(
    (id: string) => coreReads.readAt(`thread:${id}`),
    [coreReads.readAt],
  );
  const readStateVersion = coreReads.state?.version ?? -1;
  const {
    feedItems,
    activeLatchedItem: latchedItem,
    coldResolutionPending,
  } = useInboxSelectionAnchor({
    feed: admittedFeed,
    selectedEventId,
    availableChannelIds: admittedChannelIds,
    scopeKey: nativeSession,
    ready: Boolean(admittedFeed) && !coreReads.failed && !coreReads.unknown,
  });
  // Native's same-anchor latch is useful for paging, but it is not an access
  // grant. Revalidate it synchronously before deriving context/detail queries.
  const activeLatchedItem =
    admittedFeed && !coreReads.failed && !coreReads.unknown &&
    latchedItem?.channelId && admittedChannelIds.has(latchedItem.channelId)
      ? latchedItem
      : null;

  const threadContextFeedItem = activeLatchedItem;
  // Derive the default composer parent from the active anchor's own tags so
  // that InboxDetailPane can recover the original reply target even when the
  // anchor event has been displaced from the current groupItems. This is null
  // until the active item is resolved (anchor not yet found in feedItems and
  // no matching committed latch).
  const latchedDefaultParentId =
    activeLatchedItem !== null
      ? (getThreadReference(activeLatchedItem.tags).parentId ??
        activeLatchedItem.id)
      : null;
  const selectedChannelIdCandidate = threadContextFeedItem?.channelId ?? null;
  const selectedChannel = React.useMemo(() => {
    if (!selectedChannelIdCandidate || !channels) return null;
    return (
      channels.find((channel) => channel.id === selectedChannelIdCandidate) ??
      null
    );
  }, [channels, selectedChannelIdCandidate]);
  const mutationOwner=React.useMemo(()=>({active:true}),[nativeSession.facts.relayUrl,nativeSession.devicePubkey,selectedChannelIdCandidate]);
  const mutationOwnerRef=React.useRef(mutationOwner);mutationOwnerRef.current=mutationOwner;
  React.useEffect(()=>{mutationOwner.active=true;return()=>{mutationOwner.active=false;};},[mutationOwner]);

  const channelMessagesQuery = useChannelMessagesQuery(selectedChannel);
  const toggleReaction = useToggleReactionMutation(selectedChannel, currentPubkey);
  const directChannel = coreReads.conversations.find(item => item.channelId === selectedChannelIdCandidate);
  // Hidden DMs may be absent from the sidebar. The feed has already hydrated
  // the same admitted channel cache; no fabricated Channel or second fetch.
  const dmWindow = useQuery<RelayEvent[]>({ queryKey: channelMessagesKey(directChannel?.channelId ?? "none"), enabled: false });
  const channelMessages = directChannel ? dmWindow.data : channelMessagesQuery.data;
  const threadContext = useInboxThreadContext(
    threadContextFeedItem,
    channelMessages,
    {
      fullChannel: Boolean(directChannel),
      hasChannelLoadError: directChannel ? dmWindow.isError : channelMessagesQuery.isError,
      isChannelLoading: directChannel ? dmWindow.isPending : channelMessagesQuery.isPending,
    },
  );
  const onToggleReaction = React.useCallback(async (message: { id: string }, emoji: string, remove: boolean) => {
    await toggleReaction.mutateAsync({ eventId: message.id, emoji, remove });
    await threadContext.refreshReactions();
  }, [toggleReaction.mutateAsync, threadContext.refreshReactions]);

  const feedProfilePubkeys = React.useMemo(
    () => [
      ...new Set([
        ...feedItems.map((item) => item.pubkey),
        ...collectMessageMentionPubkeys(feedItems),
        ...threadContext.events.map((event) => event.pubkey),
        ...collectMessageMentionPubkeys(threadContext.events),
        ...(currentPubkey ? [currentPubkey] : []),
      ]),
    ],
    [currentPubkey, feedItems, threadContext.events],
  );
  const feedProfilesQuery = useUsersBatchQuery(feedProfilePubkeys, {
    enabled: feedProfilePubkeys.length > 0,
  });
  const feedProfiles = feedProfilesQuery.data?.profiles;
  // biome-ignore lint/correctness/useExhaustiveDependencies: readStateVersion invalidates the stable read-marker callbacks
  const inboxItems = React.useMemo(
    () =>
      buildInboxItems({
        channels,
        currentPubkey,
        feed: admittedFeed,
        getMessageReadAt,
        getThreadReadAt,
        getChannelReadAt: coreReads.readAt,
        locale,
        profiles: feedProfiles,
      }),
    [
      channels,
      currentPubkey,
      admittedFeed,
      feedProfiles,
      getMessageReadAt,
      getThreadReadAt,
      coreReads.readAt,
      readStateVersion,
      coreReads.state,
      coreReads.visibleChannels,
      locale,
    ],
  );
  const effectiveDoneSet = React.useMemo(
    () =>
      new Set(
        inboxItems
          .filter((row) =>
            row.groupItems.every(
              (event) =>
                event.createdAt <=
                (coreReads.readAt(
                  inboxReadContext(event) ?? "",
                ) ?? 0),
            ),
          )
          .map((row) => row.id),
      ),
    [inboxItems, coreReads.readAt],
  );
  const markInbox = (id: string, read: boolean) => {
    const row = inboxItems.find((item) => item.id === id);
    if (row) coreReads.write(inboxReadContexts(row.groupItems, read));
  };
  // Resolve selection before filtering so unread-only can retain its active row.
  const selectedItemFromAll = React.useMemo(
    () =>
      selectedEventId
        ? findInboxItemByEventId(inboxItems, selectedEventId)
        : null,
    [inboxItems, selectedEventId],
  );
  // selectedConversationId: prefer the InboxItem-derived conversationId (stable
  // group key). Fall back to deriving it from the latched FeedItem when the
  // anchored event is no longer present in any group's items — this keeps the
  // correct row selected (by conversationId) even after the anchor event has
  // been displaced from groupItems by a newer representative.
  const latchedConversationId = activeLatchedItem
    ? getInboxItemConversationId(activeLatchedItem)
    : null;
  const selectedConversationId =
    selectedItemFromAll?.conversationId ?? latchedConversationId;
  const handleOpenItem = React.useCallback(
    (item: {
      item: { channelId: string | null; id: string; tags: string[][] };
    }) => {
      const channelId = item.item.channelId;
      if (!channelId) return;
      const thread = getThreadReference(item.item.tags);
      void hiddenDm.openContext({ channelId, messageId: item.item.id, threadRootId: thread.rootId });
    },
    [hiddenDm.openContext],
  );
  const isRead = React.useCallback((item: InboxItem) => effectiveDoneSet.has(item.id), [effectiveDoneSet]);
  const matchesFilter = React.useCallback((item: InboxItem, nextFilter: Parameters<typeof matchesInboxFilter>[1]) =>
    matchesInboxFilter(item, nextFilter, ownedAgents.data?.pubkeys), [ownedAgents.data]);

  const status: InboxViewStatus =
    (isLoading && !feed) || (!coreReads.state && !coreReads.failed) || (coreReads.state && !coreReads.failed && !coreReads.unknown && (ownedAgents.isPending||(projectsHost&&projectQuery.isPending)))
      ? { kind: "loading" }
      : !feed || !coreReads.state || coreReads.unknown || coreReads.failed || ownedAgents.isError || projectQuery.isError || !projectsHost
        ? { kind: "unavailable",
            message: coreReads.failed || coreReads.unknown || ownedAgents.isError
              ? t(coreReads.unknown ? "inbox.readUnknown" : "inbox.readUnavailable")
              : (errorMessage ?? t("inbox.feedMissing")),
            onRetry: () => {
              onRefresh();
              void coreReads.refresh();
              void ownedAgents.refetch();
              void projectQuery.refetch();
              componentNotifications?.source?.refresh();
              needsAction.refresh();
            } }
        : { kind: "ready" };

  const mutateMessage=async(selectedItem:InboxItem|null,message:TimelineMessage,canManageMessages:boolean,edit?:{content:string;mentions:string[];media:string[][]})=>{
    const channelId=selectedItem?.item.channelId;
    const source=threadContext.events.find(event=>event.id===message.id);
    if(!canManageMessages||!channelId||!currentPubkey||!source||![9,45001,45003].includes(source.kind)||source.pubkey!==currentPubkey||message.pending)throw new Error(t("inbox.replyUnavailable"));
    const receipt=await(edit ? editMessage(channelId,source.id,edit.content,edit.media.filter(tag=>tag[0]==="imeta"),edit.mentions,nativeSession.facts.relayUrl,currentPubkey)
      : deleteMessage(channelId,source.id,nativeSession.facts.relayUrl,currentPubkey));
    if(!receipt.id||receipt.kind!==(edit?40003:5)||receipt.pubkey!==currentPubkey||!receipt.tags.some(tag=>tag[0]==="e"&&tag[1]===source.id))throw new TransportError(t("platform.sendUnknown",{operation:""}));
    if(!mutationOwner.active||mutationOwnerRef.current!==mutationOwner)return;
    // The signed mutation is confirmed; a projection refresh is not a second
    // publication and must never turn it into a fresh retry after a read error.
    void threadContext.refreshReactions().catch(()=>{});
    onRefresh();
  };

  return (
    <ProfilePanelProvider onOpenProfilePanel={handleOpenProfilePanel}>
      <InboxView
        state={view}
        needsAction={principalId ? needsAction : null}
        status={status}
        items={inboxItems}
        matchesFilter={matchesFilter}
        isRead={isRead}
        selectedConversationId={selectedConversationId}
        coldResolutionPending={coldResolutionPending}
        // DD-138(4), 07 §4.8.3: component notifications in 全部/提及/需要处理; opening marks read
        // and navigates to the native page at the item's path (same source as the Web host).
        componentNotifications={componentNotifications?.source
          ? { source: componentNotifications.source, onOpen: componentNotifications.open } : null}
        list={{
          activeDraftCount,
          draftList: <DraftsPanel items={draftItems} onDeleteDraft={handleDeleteDraft}
            onSelectDraft={(draftKey) => {
              view.setSelectedReminderId(null);
              view.setUnreadBoundary(null);
              view.selectItem(null);
              setSelectedDraftKey(draftKey);
            }} selectedDraftKey={selectedDraftKey} />,
          readPending: coreReads.pending,
          onMarkRead: (item) => markInbox(item.id, true),
          onMarkUnread: (item) => markInbox(item.id, false),
          onOpen: handleOpenItem,
          sourceChannelId: (item) => item.item.channelId,
          reopenState: (item) => ({ pending: Boolean(item.item.channelId && hiddenDm.isReopenPending(item.item.channelId)),
            error: Boolean(item.item.channelId && hiddenDm.isReopenErrored(item.item.channelId)),
            unknown: Boolean(item.item.channelId && hiddenDm.isReopenUnknown(item.item.channelId)) }),
          presentation: (item) => nativeInboxListPresentation(item, locale, ownedAgents.data?.pubkeys),
        }}
        drafts={{
          hasSelection: selectedDraftItem !== null,
          renderDetail: ({ onBack }) => (
            <DraftDetailPane
              item={selectedDraftItem}
              key={selectedDraftItem?.entry.key ?? "empty"}
              onBack={onBack}
              onDelete={handleDeleteDraft}
            />
          ),
        }}
        renderMessageDetail={({ filteredItems, visible, isSinglePanel, onBack }) => visible ? (
          <NativeInboxMessageDetail
            filteredItems={filteredItems}
            selectedEventId={selectedEventId}
            selectedConversationId={selectedConversationId}
            unreadBoundary={view.unreadBoundary}
            effectiveDoneSet={effectiveDoneSet}
            isSinglePanel={isSinglePanel}
            onBack={onBack}
            currentPubkey={currentPubkey}
            relaySelfPubkey={relaySelfPubkey}
            feedProfiles={feedProfiles}
            threadContext={threadContext}
            latchedDefaultParentId={latchedDefaultParentId}
            selectedChannel={selectedChannel}
            directChannel={directChannel}
            channelsQuery={channelsQuery}
            availableChannelIds={availableChannelIds}
            admittedChannelIds={admittedChannelIds}
            visibleChannels={coreReads.visibleChannels}
            devicePubkey={nativeSession.devicePubkey}
            editScopeKey={(channelId) => JSON.stringify([nativeSession.facts.relayUrl,nativeSession.devicePubkey,channelId])}
            hiddenDm={hiddenDm}
            onToggleReaction={onToggleReaction}
            mutateMessage={mutateMessage}
            onRefresh={onRefresh}
            localRepliesByItemId={localRepliesByItemId}
            setLocalRepliesByItemId={setLocalRepliesByItemId}
            project={projectQuery.isSuccess && projectsHost ? { host: projectsHost, items: projectQuery.data.items,
              open: (item) => { void goProject(item.project.id, projectWorkItemTarget(item)); } } : undefined}
          />
        ) : null}
        auxiliary={profilePanelPubkey ? {
          preferredWidthPx: threadPanelWidthPx,
          render: ({ widthPx, isSinglePanel }) => (
            <RightAuxiliaryPane
              canResetWidth={canResetThreadPanelWidth}
              constrainToAvailableSpace={false}
              onResetWidth={handleThreadPanelWidthReset}
              onResizeStart={handleThreadPanelResizeStart}
              testId="home-user-profile-panel"
              widthPx={widthPx}
            >
              <UserProfilePanel
                isSinglePanelView={isSinglePanel}
                layout="split"
                onClose={handleCloseProfilePanel}
                pubkey={profilePanelPubkey}
                splitPaneClamp
                transparentChrome
                widthPx={widthPx}
              />
            </RightAuxiliaryPane>
          ),
        } : null}
      />
    </ProfilePanelProvider>
  );
}

type NativeThreadContext = ReturnType<typeof useInboxThreadContext>;
type NativeProjectInbox = {
  host: NonNullable<ReturnType<typeof useProjectsHost>>;
  items: Awaited<ReturnType<typeof loadProjectWorkItems>>["items"];
  open: (item: NonNullable<ReturnType<typeof resolveProjectInboxWorkItem>>) => void;
};

/** Native message detail: the original InboxDetailPane over native transport. */
function NativeInboxMessageDetail({
  filteredItems, selectedEventId, selectedConversationId, unreadBoundary, effectiveDoneSet,
  isSinglePanel, onBack, currentPubkey, relaySelfPubkey, feedProfiles, threadContext, latchedDefaultParentId,
  selectedChannel, directChannel, channelsQuery, availableChannelIds, admittedChannelIds, visibleChannels,
  devicePubkey, editScopeKey, hiddenDm, onToggleReaction, mutateMessage, onRefresh, project,
  localRepliesByItemId, setLocalRepliesByItemId,
}: {
  filteredItems: readonly InboxItem[];
  selectedEventId: string | null;
  selectedConversationId: string | null;
  unreadBoundary: { conversationId: string; eventId: string } | null;
  effectiveDoneSet: ReadonlySet<string>;
  isSinglePanel: boolean;
  onBack?: () => void;
  currentPubkey?: string;
  relaySelfPubkey?: string | null;
  feedProfiles: Parameters<typeof useHomeInboxContextMessages>[0]["profiles"];
  threadContext: NativeThreadContext;
  latchedDefaultParentId: string | null;
  selectedChannel: Channel | null;
  directChannel?: { state: string };
  channelsQuery: { isFetching: boolean; isError: boolean };
  availableChannelIds: ReadonlySet<string>;
  admittedChannelIds: ReadonlySet<string>;
  visibleChannels: ReadonlySet<string>;
  devicePubkey: string;
  editScopeKey: (channelId: string | null | undefined) => string;
  hiddenDm: ReturnType<typeof useHiddenDmInboxNavigation>;
  onToggleReaction: (message: { id: string }, emoji: string, remove: boolean) => Promise<void>;
  mutateMessage: (selectedItem: InboxItem | null, message: TimelineMessage, canManageMessages: boolean, edit?: { content: string; mentions: string[]; media: string[][] }) => Promise<void>;
  onRefresh: () => void;
  project?: NativeProjectInbox;
  localRepliesByItemId: Record<string, InboxReply[]>;
  setLocalRepliesByItemId: React.Dispatch<React.SetStateAction<Record<string, InboxReply[]>>>;
}) {
  const t = useT();
  const locale = useLocale();
  const [isSendingReply, setIsSendingReply] = React.useState(false);
  // Original InboxDetailPane ChannelMembersBar: the context channel's governed roster and
  // management sheet, resolved exactly as the channel header does (ChannelScreenHeader).
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const membersDirectory = useWorkspaceChannelDirectory({ enabled: Boolean(selectedChannel) && selectedChannel?.channelType !== "dm" });
  const membersWorkspace = selectedChannel && selectedChannel.channelType !== "dm"
    ? nativeApplicationWorkspace(membersDirectory.data, { channelId: selectedChannel.id }) : undefined;
  const membersConversations = useConversations();
  const membersConversation = selectedChannel?.channelType === "dm"
    ? membersConversations.items.find((item) => item.channelId === selectedChannel.id && item.state === "ACTIVE") : undefined;
  const headerActions = !selectedChannel ? undefined
    : membersWorkspace ? <InboxDetailChannelMembers key={`workspace:${membersWorkspace.id}`} roster={{ kind: "workspace", workspaceId: membersWorkspace.id }}
        isDark={isDark} currentPubkey={currentPubkey} fallbackMemberCount={selectedChannel.memberCount}
        channel={{ channelId: selectedChannel.id, name: selectedChannel.name, description: selectedChannel.description,
          channelType: selectedChannel.channelType, visibility: selectedChannel.visibility, ttlSeconds: selectedChannel.ttlSeconds,
          topic: selectedChannel.topic ?? undefined, archived: Boolean(selectedChannel.archivedAt) }}
        management={{ refresh: () => {
          void queryClient.invalidateQueries({ queryKey: channelsQueryKey });
          void queryClient.invalidateQueries({ queryKey: workspaceVisibilityQueryKey });
        }, renderCanvas: (content) => <Markdown content={content} /> }}
        // Original management sheet Workflows ingress, routed as the channel header does.
        workflows={{
          onOpenWorkflow: (workflowId) => { void navigate({ to: "/platform/workflows/$workflowId", params: { workflowId }, search: { workspaceId: membersWorkspace.id } }); },
          onCreateWorkflow: () => { void navigate({ to: "/platform/$section", params: { section: "workflows" }, search: { workspaceId: membersWorkspace.id } }); },
        }}
        onCopy={writeTextToClipboard} />
    : membersConversation ? <InboxDetailChannelMembers key={`conversation:${membersConversation.id}`} roster={{ kind: "conversation", conversation: membersConversation }}
        isDark={isDark} currentPubkey={currentPubkey}
        channel={{ channelId: selectedChannel.id, name: selectedChannel.name, description: "", channelType: "dm", ttlSeconds: null }}
        onCopy={writeTextToClipboard} /> : undefined;
  // A filter change may only retain detail for a conversation that remains
  // visible. The filter handler selects the next valid row in the same update,
  // so the detail pane never renders a stale conversation between states.
  const selectedItem = React.useMemo(() => {
    if (!selectedEventId) return null;
    const fromFiltered = findInboxItemByEventId([...filteredItems], selectedEventId);
    if (fromFiltered) return fromFiltered;
    if (selectedConversationId) {
      return (
        filteredItems.find(
          (item) => item.conversationId === selectedConversationId,
        ) ?? null
      );
    }
    return null;
  }, [filteredItems, selectedConversationId, selectedEventId]);
  const selectedProject=selectedItem&&project?resolveProjectInboxWorkItem(project.items,selectedItem.item):undefined;
  const unreadBoundaryEventId = React.useMemo(() => {
    if (!selectedItem) return null;
    if (unreadBoundary?.conversationId === selectedItem.conversationId) {
      return unreadBoundary.eventId;
    }
    return effectiveDoneSet.has(selectedItem.id) ? null : selectedItem.id;
  }, [effectiveDoneSet, selectedItem, unreadBoundary]);
  const contextMessages = useHomeInboxContextMessages({
    currentPubkey,
    events: threadContext.events,
    profiles: feedProfiles,
    relaySelfPubkey,
    selectedEventId,
    selectedItem,
  });
  const selectedItemReplies = React.useMemo<InboxReply[]>(() => {
    if (!selectedItem) return [];
    const localReplies =
      localRepliesByItemId[selectedItem.conversationId] ?? [];
    const contextIds = new Set(contextMessages.map((message) => message.id));
    return localReplies.filter((reply) => !contextIds.has(reply.id));
  }, [contextMessages, localRepliesByItemId, selectedItem]);
  React.useEffect(() => {
    void selectedConversationId;
    setIsSendingReply(false);
  }, [selectedConversationId]);

  if (selectedProject && project) {
    return <PulseScreen><ProjectInboxDetail host={project.host} key={selectedItem?.conversationId} workItem={selectedProject}
      onBack={isSinglePanel ? onBack : undefined} onOpenProject={() => project.open(selectedProject)}/></PulseScreen>;
  }

  const { canReply, disabledReplyReason } = getHomeMessageCapabilities(
    selectedItem,
    new Set([...availableChannelIds].filter(id => visibleChannels.has(id))),
    locale,
  );
  const canManageMessages=Boolean(selectedItem?.item.channelId&&availableChannelIds.has(selectedItem.item.channelId)&&visibleChannels.has(selectedItem.item.channelId)&&
    !channelsQuery.isFetching&&!channelsQuery.isError&&!threadContext.hasLoadError&&!threadContext.isLoading&&
    currentPubkey&&currentPubkey===devicePubkey&&
    (selectedChannel ? selectedChannel.isMember&&selectedChannel.archivedAt===null : directChannel?.state==="ACTIVE"));

  return (
    <InboxDetailPane
      canReply={canReply}
      editScopeKey={editScopeKey(selectedItem?.item.channelId)}
      canManageMessages={canManageMessages}
      onEditSave={(message,content,mentions,media)=>mutateMessage(selectedItem,message,canManageMessages,{content,mentions,media})}
      onDeleteMessage={message=>mutateMessage(selectedItem,message,canManageMessages)}
      canOpenContext={!selectedItem?.item.channelId || !hiddenDm.isReopenPending(selectedItem.item.channelId)}
      headerActions={headerActions}
      reopenStatus={selectedItem?.item.channelId ? { pending: hiddenDm.isReopenPending(selectedItem.item.channelId),
        error: hiddenDm.isReopenErrored(selectedItem.item.channelId), unknown: hiddenDm.isReopenUnknown(selectedItem.item.channelId) } : undefined}
      currentPubkey={currentPubkey}
      onToggleReaction={selectedItem?.item.channelId && admittedChannelIds.has(selectedItem.item.channelId) && !channelsQuery.isFetching && !channelsQuery.isError && !threadContext.hasLoadError && !threadContext.isLoading && selectedChannel?.isMember && selectedChannel.archivedAt === null ? onToggleReaction : undefined}
      contextChannelName={selectedChannel?.name ?? null}
      disabledReplyReason={disabledReplyReason}
      isSendingReply={isSendingReply}
      isSinglePanelView={isSinglePanel}
      hasThreadContextLoadError={threadContext.hasLoadError}
      isThreadContextLoading={threadContext.isLoading}
      item={selectedItem}
      latchedDefaultParentId={latchedDefaultParentId}
      messages={contextMessages}
      profiles={feedProfiles}
      selectedEventId={selectedEventId}
      unreadBoundaryEventId={unreadBoundaryEventId}
      onBack={onBack}
      onOpenContext={(channelId, messageId, threadRootId) => { void hiddenDm.openContext({ channelId, messageId, threadRootId }); }}
      onSendReply={async ({
        content,
        mediaTags,
        mentionPubkeys,
        parentEventId,
      }) => {
        const channelId = selectedItem?.item.channelId;
        if (!selectedItem || !channelId || !canReply) {
          throw new Error(t("inbox.replyUnavailable"));
        }

        const itemToReply = selectedItem;
        setIsSendingReply(true);
        try {
          const {
            mediaTags: imetaTags,
            emojiTags,
            mentionTags,
          } = splitOutgoingTags(mediaTags);
          const result = await sendChannelMessage(
            channelId,
            content,
            parentEventId,
            imetaTags,
            mentionPubkeys,
            emojiTags,
            mentionTags,
          );
          const authorPubkey = currentPubkey ?? itemToReply.item.pubkey;
          const reply: InboxReply = {
            authorLabel: currentPubkey
              ? resolveUserLabel({
                  currentPubkey,
                  profiles: feedProfiles,
                  pubkey: authorPubkey,
                })
              : t("messages.system.you"),
            authorPubkey,
            avatarUrl:
              currentPubkey && feedProfiles
                ? (feedProfiles[currentPubkey.trim().toLowerCase()]
                    ?.avatarUrl ?? null)
                : null,
            content,
            createdAt: result.createdAt,
            depth: result.depth,
            fullTimestampLabel: formatInboxFullTimestamp(
              result.createdAt,
            ),
            id: result.eventId,
            parentId: result.parentEventId,
            rootId: result.rootEventId,
            tags: [...imetaTags, ...emojiTags, ...mentionTags],
            timeLabel: formatTime(result.createdAt),
          };
          setLocalRepliesByItemId((current) => ({
            ...current,
            [itemToReply.conversationId]: [
              ...(current[itemToReply.conversationId] ?? []),
              reply,
            ],
          }));
          onRefresh();
        } finally {
          setIsSendingReply(false);
        }
      }}
      replies={selectedItemReplies}
    />
  );
}
