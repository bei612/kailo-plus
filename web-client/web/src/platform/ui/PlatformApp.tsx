// 平台页（SS-WEB-01）。
//
// 一期的内置管理页：登录状态、Tenant/Workspace 选择、频道、成员、任务、审批、基础审计、设备。
// 全部数据经 BFF；这个文件里没有 Relay 地址、没有 signer、没有 Nostr filter。
//
// 成员、审计、设备、任务、审批五页是 Web 与 Desktop 共用的同一份组件（@client-kit/platform，
// ADR-09）。导航与内容展示也消费 Desktop 提取的同一份源；这里仅保留 Web 的
// Workspace 选择、收藏/静音、频道与退出接线。
//
// 未启用的能力不在这里出现。不渲染一个点进去说「未启用」的入口——
// 那是把阻断项做成了可见功能。

import {
  PlatformSessionAccessMode,
  type PlatformSessionView,
  ReasonCode,
} from "@client-kit/contracts";
import { PlatformProvider, useDeviceLocale } from "@client-kit/platform/react/context";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { ChannelBrowser, ChannelJoinButton } from "@client-kit/platform/react/channel-browser";
import { CreateChannelDialog } from "@client-kit/platform/react/create-channel-dialog";
import { useChannelNavigationShortcuts } from "@client-kit/platform/react/use-channel-navigation-shortcuts";
import { useSearchShortcuts } from "@client-kit/platform/react/use-search-shortcuts";
import { ConversationVisibilityProvider, useConversations, useDirectMessageOpen } from "@client-kit/platform/react/new-message";
import { ConversationSidebar } from "./ConversationSidebar";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { conversationVisibility } from "../bff-client";
import { useSettingsShortcuts } from "@client-kit/platform/react/use-settings-shortcuts";
import { useHomeShortcut, useHistoryShortcuts } from "@client-kit/platform/react/use-navigation-shortcuts";
import { useTextScaleShortcuts } from "@client-kit/platform/react/use-text-scale-shortcuts";
import { ProtocolDocumentBridge } from "@client-kit/platform/react/protocol-document-bridge";
import {
  ApprovalsPage,
  LifecycleRestrictedView,
  TasksPage,
} from "@client-kit/platform/react/governance";
import { WorkflowsPage, workflowBlocksNavigation, type WorkflowNavigationState } from "@client-kit/platform/react/workflows";
import { webWorkflowMessageHost } from "./workflowMessageHost";
import { BusinessOperationsPage, UsageBillingPage } from "@client-kit/platform/react/business-observability";
import { GatewayPage } from "@client-kit/platform/react/gateway";
import { useBlocker } from "@tanstack/react-router";
import { RedemptionProgress } from "@client-kit/platform/react/invitations";
import { usePlatformNavigation, type PlatformTab } from "@/app/platform-navigation";
import {
  AuditPage,
  DevicesPage,
  MembersPane,
  WorkspaceManagementPanels,
} from "@client-kit/platform/react/pages";
import { ContentSurface, GradientLayer, KailoMark } from "@client-kit/platform/react/surfaces";
import { ChannelMembersBar, ChannelMembersDialog, type MemberProfileRequest } from "@client-kit/platform/react/channel-members";
import { MemberHover, useOptionalMemberProfile, type MemberTarget } from "@client-kit/platform/react/members";
import { CandidatePictureProvider, sameOriginAvatarPicture } from "@client-kit/platform/react/profile/candidate-picture";
import { UserProfilePopoverSurface } from "@client-kit/platform/react/pulse";
import { ChannelManagementSheet } from "@client-kit/platform/react/channel-management-sheet";
import { ChannelEphemeralBadge } from "@client-kit/platform/react/ephemeral-channel";
import { getChannelDescription } from "@client-kit/platform/react/channel-description";
import { TopChromeHistoryButtons } from "@client-kit/platform/react/top-chrome-history";
import { requestOpenCreateAgent } from "@client-kit/platform/react/open-create-agent-event";
import { ProfileDirectMessageProvider } from "@client-kit/platform/react/pulse/profile-direct-message";
import { ComposerChannelLinksProvider } from "@client-kit/platform/react/composer/features/messages/ui/ComposerChannelLinksContext";
import { SidebarLoadingContent, useSidebarLoadingShape } from "@client-kit/platform/react/sidebar/sidebar-loading-skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { ChannelSidebar } from "./ChannelSidebar";
import { SidebarProvider, SidebarTrigger, SidebarMenu, SidebarMenuItem } from "@client-kit/platform/react/sidebar/sidebar";
import { AppSidebarFrame, AppSidebarPinnedHeaderFrame } from "@client-kit/platform/react/sidebar/app-sidebar-frame";
import { MoreUnreadButton, preferredUnreadTarget } from "@client-kit/platform/react/sidebar/MoreUnreadButton";
import { useConversationUnreadProjection, useSidebarUnreadOverflow } from "@client-kit/platform/react/sidebar/useSidebarUnreadOverflow";
import { NativeApplicationEntries } from "@client-kit/platform/react/pages";
import { NativeApplicationPage } from "@client-kit/platform/react/native-application-page";
import { AppSidebarPrimaryMenu } from "@client-kit/platform/react/sidebar/app-sidebar-primary-menu";
import { RelayConnectionOverlay, SidebarRelayConnectionFooterCard } from "@client-kit/platform/react/sidebar/relay-connection-overlay";
import { useStreamConnectionCard } from "./StreamConnection";
import { useWebHomeFeed } from "./useWebHomeFeed";
import { WebSidebarProfileCard } from "./SidebarProfileCard";
import { WebPresenceHost } from "./PresenceHost";
import { UserNameIndicators } from "@client-kit/platform/react/user-status";
import { MessageAuthorAvatar } from "./MessageAuthorProfile";
import { UserAvatar } from "@client-kit/platform/react/messages";
import { forcedUnreadStore, useForcedUnreadActions, type ForcedUnreadMap } from "@client-kit/platform/react/sidebar/forcedUnreadStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BffError, bff, publishChannelTopic, publishConversationMessage, setWorkspacePreference, signInAgainHere, signOut } from "@/platform/bff-client";
import { ChannelPane } from "@/platform/ui/ChannelPane";
import { MessageContent } from "@/features/chat/ui/MessageContent";
import { WebAgentTranscriptHost } from "./WebAgentTranscriptHost";
import { AgentActivityOpenerHost } from "@client-kit/platform/react/agent-transcript";
import { ForumPane } from "@/platform/ui/ForumPane";
import { InboxPane } from "@/platform/ui/InboxPane";
import { appBadgeState, useAppBadgeTitle } from "./useAppBadgeTitle";
import { BffReminderHost } from "@/platform/ui/ReminderHost";
import { SettingsPane } from "@/platform/ui/SettingsPane";
import { AgentDefinitionsPane } from "./AgentDefinitionsPane";
import { NewMessagePage } from "./NewMessagePage";
import { PulsePane } from "./PulsePane";
import { ProjectsPane, useProjectsHost, useWebProjectAgentChat } from "./ProjectsPane";
import { ProjectChannelRequestDialog } from "@client-kit/platform/react/projects";
import { SidebarProjects } from "./SidebarProjects";
import { WorkspaceChannelCreateChannelType } from "@client-kit/contracts";
import { usePreviewFeatureWarning } from "@client-kit/platform/react/features";
import { translate } from "@client-kit/platform/i18n";
import { platformQueries } from "@/platform/ui/queries";
import { getLocale, t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { ChatHeader } from "@client-kit/platform/react/messages/chat-header";
import { ChannelGlyph } from "@client-kit/platform/react/channel-glyph";
import { DmHeaderParticipants } from "@client-kit/platform/react/messages/dm-header-participants";
import { AvatarHostProvider } from "@client-kit/platform/react/profile/avatar-host";
import { formatDmParticipantDisplayName, resolveConversationHeaderParticipants } from "@client-kit/platform/react/conversations/dm-participant-display";
import { toast } from "sonner";
import { BrowserNotificationsProvider, useBrowserNotifications } from "./BrowserNotifications";
import { useTenantJoinAlerts } from "@client-kit/platform/react/tenant-join-alerts";
import { BffMessageLinkHost } from "@/features/chat/ui/BffMessageLinkHost";
import { TopbarSearch } from "./TopbarSearch";
import { useWebSearchDirectory } from "./search";
import type { SearchHit } from "@client-kit/platform/react/search/types";
import { useWebMarkAsReadShortcuts } from "./useMarkAsReadShortcuts";
import { CollaborationPreferencesProvider, useCollaborationPreferenceActions } from "@client-kit/platform/react/collaboration-preferences";
import { HuddleHostProvider, HuddleParentProvider, HuddleShell } from "@client-kit/platform/react/huddle";
import { buildHuddleChannelName } from "@client-kit/platform/huddle";
import { WebHuddleHost } from "@/platform/huddle/WebHuddleHost";
import { WebOnboardingGate } from "./WebOnboarding";
import { buildWaveMessageContent } from "@client-kit/platform/react/messages";
import { newIdempotencyKey } from "@client-kit/platform/governance";

const reauthenticateTopLevel = () => { void signInAgainHere(); };

/** 会话解析失败即什么都不渲染：没有身份就没有任何页面可看（fail closed）。 */
export function PlatformApp() {
  const locale = useDeviceLocale();
  const { isDark } = useTheme();
  const avatarPicture = useMemo(() => sameOriginAvatarPicture(window.location.origin), []);
  const documentBinding = new URLSearchParams(window.location.search).get("protocolBinding");
  const [session, setSession] = useState<PlatformSessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 已登录 IdP 但还不是成员（兑换了邀请、等待 admin 确认）：会话 403 是如实的「还不能
  // 进」，不是故障。此时只显示本人的兑换进度（DD-83）。
  const [notMember, setNotMember] = useState(false);

  useEffect(() => {
    bff
      .session()
      .then(setSession)
      .catch((e: unknown) => {
        if (
          e instanceof BffError &&
          (e.reason === ReasonCode.TenantMembershipNotActive ||
            e.reason === ReasonCode.IdentityUnknown)
        ) {
          setNotMember(true);
          return;
        }
        setError(
          e instanceof BffError
            ? `${t("platform.sessionUnavailable")}（${e.status}）`
            : t("platform.sessionUnavailable"),
        );
      });
  }, []);

  if (notMember)
    return (
      <PlatformProvider client={bff} locale={locale}>
        <div className="mx-auto flex w-full max-w-xl flex-col gap-4 p-6 text-sm">
          <strong>{t("platform.title")}</strong>
          <RedemptionProgress
            emptyHint={t("platform.notMember")}
            onContinue={() => window.location.reload()}
          />
        </div>
      </PlatformProvider>
    );
  if (error) return <Notice text={error} />;
  if (!session) return <Notice text={t("platform.loadingIdentity")} />;
  return (
    <PlatformProvider client={bff} locale={locale} documentTheme={isDark ? "DARK" : "LIGHT"} currentPrincipalId={session.tenantPrincipalId}
      reauthenticateTopLevel={reauthenticateTopLevel}>
      {/* DD-139: candidate and DM-row avatars load only the Tenant avatar route on this origin. */}
      <CandidatePictureProvider resolve={avatarPicture}>
      {session.accessMode === PlatformSessionAccessMode.LifecycleRestricted ? (
        <LifecycleRestrictedView
          displayName={t("platform.title")}
          onSignOut={() => void signOut()}
        />
      ) : documentBinding !== null ? (
        <ProtocolDocumentBridge
          bindingId={documentBinding}
          onBack={() => {
            window.location.assign("/app/");
          }}
        />
      ) : (
        // DD-125(5) original first-run profile and avatar steps before the app (V-SCN-142).
        <WebOnboardingGate key={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`} session={session}
          blocking={<Notice text={t("platform.loadingIdentity")} />}>
        <BrowserNotificationsProvider key={session.tenantPrincipalId} principalId={session.tenantPrincipalId}><ConversationVisibilityProvider value={conversationVisibility}><WebPresenceHost session={session}><WebAgentTranscriptHost session={session}><SignedIn session={session} /></WebAgentTranscriptHost></WebPresenceHost></ConversationVisibilityProvider></BrowserNotificationsProvider>
        </WebOnboardingGate>
      )}
      </CandidatePictureProvider>
    </PlatformProvider>
  );
}

// DD-141 brand moment: session gates show the Kailo mark over the canvas aura.
function Notice({ text }: { text: string }) {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-4 text-sm text-muted-foreground">
      <GradientLayer />
      <KailoMark className="animate-pulse rounded-[14px] shadow-md" size={44} />
      <span>{text}</span>
    </div>
  );
}

function SignedIn({ session }: { session: PlatformSessionView }) {
  const notificationSettings = useBrowserNotifications();
  // DD-125(9): first-join alerts for Tenant `manage` holders, as browser notifications under the
  // same desktop switch and browser permission. Non-managers are refused once and it stops.
  useTenantJoinAlerts({
    client: bff,
    tenantId: session.tenantId,
    viewerPrincipalId: session.tenantPrincipalId,
    communityName: session.tenantName,
    enabled: !!notificationSettings?.settings.desktopEnabled && notificationSettings.permission === "granted",
    notify: ({ key, title, body }) => notificationSettings?.notifyMemberJoin({ eventId: key, title, body }),
  });
  const [inboxUnreadCount, setInboxUnreadCount] = useState<number | null>(null);
  // Original relay connection card and collapsed-sidebar overlay, over the BFF streams.
  const connectionCard = useStreamConnectionCard();
  const workspaces = useQuery(platformQueries.workspaces);
  const queryClient = useQueryClient();
  const userState = useInboxState(bff);
  // DD-125: thread follows, sidebar sections/sort, templates and Pulse follows share
  // this Core state and CAS queue; panes read them from the provider below.
  const preferences = useCollaborationPreferenceActions(bff, userState);
  // DD-125(3): the Web Huddle backend (governed huddle.* actions, BFF audio bridge, in-page media).
  const huddleHost = useMemo(() => new WebHuddleHost(bff), []);
  // The original per-device manual source is presentation state, not another
  // read-line authority. Browser partitioning uses its trusted platform scope.
  const unreadIdentity = JSON.stringify([session.tenantId, session.tenantPrincipalId]);
  const forcedUnreadIdentity = useRef<string | null>(null);
  const forcedUnreadRef = useRef<ForcedUnreadMap>({});
  if (forcedUnreadIdentity.current !== unreadIdentity) {
    forcedUnreadIdentity.current = unreadIdentity;
    forcedUnreadRef.current = forcedUnreadStore.read(unreadIdentity);
  }
  const [forcedUnreadVersion, setForcedUnreadVersion] = useState(0);
  const notifyForcedUnread = useCallback(() => setForcedUnreadVersion(version => version + 1), []);
  const {markChannelUnread, clearChannelUnreadSource} = useForcedUnreadActions(forcedUnreadRef, userState.readAt, unreadIdentity, notifyForcedUnread);
  const markManualUnread = useCallback((id: string) => {
    if (forcedUnreadIdentity.current === unreadIdentity) markChannelUnread(id);
  }, [unreadIdentity, markChannelUnread]);
  const clearManualUnread = useCallback((id: string) => {
    if (forcedUnreadIdentity.current === unreadIdentity) clearChannelUnreadSource(id, "manual");
  }, [unreadIdentity, clearChannelUnreadSource]);
  const forcedUnread = useMemo(() => ({...forcedUnreadRef.current}), [unreadIdentity, forcedUnreadVersion]);
  const conversations = useConversations();
  const directMessage = useDirectMessageOpen(session.tenantPrincipalId);
  const directMessageOwner = useMemo(() => ({ active: true }),
    [session.tenantId, session.tenantPrincipalId, session.platformSessionId]);
  const currentDirectMessageOwner = useRef(directMessageOwner);
  currentDirectMessageOwner.current = directMessageOwner;
  useEffect(() => {
    directMessageOwner.active = true;
    return () => { directMessageOwner.active = false; };
  }, [directMessageOwner]);
  const searchScopeKey = `${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`;
  // DD-140: the original global owner-review dialog for Agent project channel requests.
  const projectRequestHost = useProjectsHost(searchScopeKey);
  // DD-140 (5): the decision receipt's governed send, resolved only when a request is shown.
  const useProjectRequestAgentChat = useCallback(() => useWebProjectAgentChat(searchScopeKey), [searchScopeKey]);
  const navigation = usePlatformNavigation(searchScopeKey);
  // DD-125(6): a working Agent row outside the channel view opens that channel, then its activity.
  const openAgentActivityChannel = useCallback((workspaceId: string) => { void navigation.openChannel(workspaceId); }, [navigation]);
  const { tab, messageTarget } = navigation;
  usePreviewFeatureWarning(tab);
  const [workflowNavigationState, setWorkflowNavigationState] = useState<WorkflowNavigationState>({ dirty: false, locked: false });
  const workflowBlocker = useBlocker({
    shouldBlockFn: ({ current, next }) => workflowBlocksNavigation(workflowNavigationState, current, next),
    withResolver: true,
    enableBeforeUnload: false, // The shared editor owns the existing document guard.
  });
  const chosen = navigation.workspaceId;
  const chosenConversation = !conversations.error && !conversations.loading
    ? conversations.items.find((conversation) => conversation.id === navigation.conversationId) : undefined;
  const [messageLinkProblem, setMessageLinkProblem] = useState<string | null>(null);
  // DD-138(3): a native page is titled by its product name (云盘/知识库/问数), not "service workspace".
  const [applicationTitle, setApplicationTitle] = useState<string | null>(null);
  const settingsVisited=useRef(false);
  if(tab==="settings")settingsVisited.current=true;
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  // Original custom-section quick action (AppSidebar handleCreateChannelInSection): the
  // channel chosen in this browser opening is assigned to that section, then forgotten.
  const sectionBrowseAssign = useRef<((channelId: string) => void) | null>(null);
  useEffect(() => { if (!createChannelOpen) sectionBrowseAssign.current = null; }, [createChannelOpen]);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newForumOpen, setNewForumOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [scopeSearchFocusRequest, setScopeSearchFocusRequest] = useState(0);
  const searchDirectory = useWebSearchDirectory(searchScopeKey, conversations.items, session.tenantPrincipalId,
    !conversations.loading && !conversations.error && tab !== "settings");
  const dmHeaderPeople = searchDirectory.isSuccess && !searchDirectory.isFetching
    ? resolveConversationHeaderParticipants(chosenConversation, session.tenantPrincipalId, searchDirectory.data.people) : null;
  const dmHeaderTitle = dmHeaderPeople ? formatDmParticipantDisplayName(dmHeaderPeople) : null;
  // Original ChannelScreenHeader 1:1 DM identity: the other person's profile avatar inside
  // UserProfilePopover, read with this conversation as the profile proof.
  const dmHeaderPerson = dmHeaderPeople?.length === 1 ? dmHeaderPeople[0] : undefined;
  const dmHeaderTarget: MemberTarget | undefined = chosenConversation && dmHeaderPerson?.pubkeys[0]
    ? {conversationId: chosenConversation.id, principalId: dmHeaderPerson.principalId, pubkey: dmHeaderPerson.pubkeys[0],
      alternatePubkeys: dmHeaderPerson.pubkeys, displayName: dmHeaderPerson.displayName} : undefined;
  const dmHeaderProfileQuery = useOptionalMemberProfile(dmHeaderTarget);
  const dmHeaderProfile = dmHeaderProfileQuery.isSuccess && !dmHeaderProfileQuery.isFetching ? dmHeaderProfileQuery.data : undefined;
  const dmHeaderParticipants = dmHeaderPeople?.map(person => ({id:person.principalId,displayName:person.displayName,
    avatarUrl:person === dmHeaderPerson ? dmHeaderProfile?.avatarUrl ?? null : null,presencePubkeys:person.pubkeys})) ?? [];
  const [channelActivity, setChannelActivity] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const [sidebarUnread, setSidebarUnread] = useState<ReadonlySet<string>>(() => new Set());
  const dmUnread = useConversationUnreadProjection(directMessageOwner);
  const sidebarOverflow = useSidebarUnreadOverflow({ scrollRef: sidebarScrollRef, unreadChannelIds: sidebarUnread,
    dmChannelIds: dmUnread.dmChannelIds, highPriorityUnreadChannelIds: dmUnread.dmChannelIds,
    previewActivityChannelIds: dmUnread.dmChannelIds });
  const nextUnreadDmBelowId = preferredUnreadTarget(sidebarOverflow.unreadMessageBelowChannelIds, dmUnread.dmChannelIds);
  const unreadDmPreviewsBelow = sidebarOverflow.unreadMessageBelowChannelIds.flatMap(channelId => {
    const preview = dmUnread.entries.find(entry => entry.channelId === channelId)?.preview;
    return preview ? [preview] : [];
  });
  const rows = useMemo(() => workspaces.isError ? [] : workspaces.data ?? [], [workspaces.isError, workspaces.data]);
  // Original sidebar skeleton: shown only until the channel and DM lists first settle.
  const sidebarSettled = useRef(false);
  if (!workspaces.isPending && !conversations.loading) sidebarSettled.current = true;
  const sidebarLoading = !sidebarSettled.current;
  const people = searchDirectory.data?.people;
  const sidebarLoadingChannels = useMemo(() => rows.filter((workspace) => workspace.isMember === true)
    .map((workspace) => ({ id: workspace.id, label: workspace.name })), [rows]);
  const sidebarLoadingDms = useMemo(() => conversations.items.map((conversation) => ({ id: conversation.id,
    label: conversation.participantPrincipalIds.filter((id) => id !== session.tenantPrincipalId)
      .map((id) => people?.find((person) => person.principalId === id)?.displayName ?? id).join(", ") })),
  [conversations.items, people, session.tenantPrincipalId]);
  const sidebarLoadingShape = useSidebarLoadingShape({ scopeKey: `${session.tenantId}:${session.tenantPrincipalId}`,
    channels: sidebarLoadingChannels, directMessages: sidebarLoadingDms, isLoading: sidebarLoading });
  // Only use fresh admitted directory rows; a revoked previous selection cannot remain active.
  // An explicit URL target is not permission and must never fall back to another channel.
  const activeRow = chosen ? rows.find((workspace) => workspace.id === chosen)
    : rows.find((workspace) => workspace.id === session.currentWorkspaceId && workspace.isMember === true)
    ?? rows.find((workspace) => workspace.isMember === true)
    ?? rows[0];
  const active = activeRow?.id ?? null;
  const [membersOpenFor, setMembersOpenFor] = useState<string | null>(null);
  const [manageOpenFor, setManageOpenFor] = useState<string | null>(null);
  const [headerActionsCompact, setHeaderActionsCompact] = useState(false);
  const [memberProfileRequest, setMemberProfileRequest] = useState<MemberProfileRequest | undefined>(undefined);
  // Original showJoinButton: non-member, open, unarchived, with the admitted join action.
  const joinRow = activeRow && activeRow.isMember !== true && !searchDirectory.isError
    ? searchDirectory.data?.workspaces.find((row) => row.id === activeRow.id && !row.isMember
      && row.visibility === "open" && !row.channel.archived && row.joinActionKey === "workspace.join")
    : undefined;
  const { isDark } = useTheme();
  const nativeCurrentChannelId = tab === "conversation" ? chosenConversation?.channelId
    : tab === "channel" && !searchDirectory.isError ? searchDirectory.data?.workspaces.find(row=>row.id===active)?.channel.channelId : undefined;
  const openSearchChannel = async (channelId:string, hit?:Pick<SearchHit, "eventId" | "threadRootId">, query?:string) => {
    if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner)
      throw new TransportError(translate(getLocale(), "dm.viewInactive"));
    const fresh = await searchDirectory.refetch();
    if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner || fresh.isError || !fresh.data)
      throw new TransportError(t("platform.loadFailed"));
    const workspace = fresh.data.workspaces.find(row=>row.channel.channelId===channelId);
    if (workspace) {
      if (hit && !workspace.isMember) throw new TransportError(t("platform.linkChannelUnavailable"));
      await navigation.openChannel(workspace.id, hit ? {channelId:workspace.id,messageId:hit.eventId,threadRootId:hit.threadRootId??null} : undefined, query);
      return;
    }
    const actual = await conversations.reload();
    if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner)
      throw new TransportError(translate(getLocale(), "dm.viewInactive"));
    const conversation = actual.find(row=>row.channelId===channelId&&row.state==="ACTIVE"&&row.participantPrincipalIds.includes(session.tenantPrincipalId));
    if (!conversation) throw new TransportError(t("platform.linkChannelUnavailable"));
    await navigation.openConversation(conversation.id, hit ? {messageId:hit.eventId,threadRootId:hit.threadRootId??null} : undefined, query);
  };
  async function openDirectMessage(pubkey: string) {
    const checkCurrent = () => {
      if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner)
        throw new Error(translate(getLocale(), "dm.viewInactive"));
    };
    checkCurrent();
    const conversation = await directMessage.open(pubkey);
    checkCurrent();
    await conversations.reload();
    checkCurrent();
    await navigation.openConversation(conversation.id);
  }
  // DD-125(3) original handleWave: open (or reuse) the 1:1 DM, navigate there, then publish the
  // marked wave kind:9 through the governed DM publication with its own intent key.
  async function waveDirectMessage(pubkey: string, onNavigated?: () => void) {
    const checkCurrent = () => {
      if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner)
        throw new Error(translate(getLocale(), "dm.viewInactive"));
    };
    checkCurrent();
    const conversation = await directMessage.open(pubkey);
    checkCurrent();
    await conversations.reload();
    checkCurrent();
    await navigation.openConversation(conversation.id);
    onNavigated?.();
    const own = await bff.profile().catch(() => null);
    checkCurrent();
    const senderName = own?.displayName?.trim() || session.displayName.trim();
    try {
      const receipt = await publishConversationMessage(conversation.id, buildWaveMessageContent(senderName), [], newIdempotencyKey());
      if (!receipt?.eventId || !receipt.operationId) throw new TransportError("Wave has no confirmed receipt.");
    } catch (error) {
      // An unknown result is not a failure: the wave may still arrive (DD-81).
      throw new Error(isOutcomeUnknown(error)
        ? t("platform.sendUnknown", { operation: error instanceof BffError ? (error.operationId ?? "") : "" })
        : translate(getLocale(), "platform.profile.waveFailed"));
    }
  }
  // Original AppShell Home feed: the Home badge on every view and background alerts for every
  // admitted channel and DM; the open scope keeps its own live alerts in ChannelPane.
  const homeFeed = useWebHomeFeed({ client: bff, visibility: conversationVisibility, principalId: session.tenantPrincipalId,
    reads: userState, activeWorkspaceId: tab === "channel" ? active : null,
    activeConversationChannelId: tab === "conversation" ? chosenConversation?.channelId ?? null : null,
    onOpen: (channelId, target) => openSearchChannel(channelId, target) });
  // While Inbox is open its own list is what the person sees; elsewhere the shell feed keeps it.
  const homeBadgeCount = tab === "inbox" && inboxUnreadCount !== null ? inboxUnreadCount : homeFeed.unreadCount;
  // Original app badge (count, or a dot for channel-only unreads) in the tab title.
  useAppBadgeTitle(notificationSettings?.settings.homeBadgeEnabled !== false, appBadgeState(homeBadgeCount, sidebarUnread.size));
  const setTab = (next: Exclude<PlatformTab, "conversation" | "application">) => { void navigation.openTab(next, active); };
  const settingsReturn = useRef<() => void>(() => { void navigation.openTab("channel"); });
  useEffect(() => {
    if (tab !== "settings") settingsReturn.current = () => {
      if (tab === "conversation" && navigation.conversationId) void navigation.openConversation(navigation.conversationId);
      else if (tab === "application" && navigation.applicationBindingId) void navigation.openApplication(navigation.applicationBindingId, active ?? undefined);
      else if (tab !== "conversation" && tab !== "application") void navigation.openTab(tab, active);
    };
  }, [tab, active, navigation]);
  useTextScaleShortcuts();
  useHomeShortcut({ disabled: tab === "settings", onGoHome: () => navigation.openTab("inbox", active) });
  useHistoryShortcuts({ goBack: navigation.goBack, goForward: navigation.goForward });
  useChannelNavigationShortcuts({
    disabled: tab === "settings",
    onBrowseChannels: () => setCreateChannelOpen(true),
    onCreateChannel: () => setNewChannelOpen(true),
    onNewMessage: () => setTab("new-message"),
  });
  useSearchShortcuts({disabled:tab==="settings",canSearchCurrentChannel:Boolean(nativeCurrentChannelId),
    onSearchEverything:()=>{setSearchFocusRequest(value=>value+1);void searchDirectory.refetch();},
    onSearchCurrentChannel:()=>{setScopeSearchFocusRequest(value=>value+1);void searchDirectory.refetch();}});
  useSettingsShortcuts({
    open: tab === "settings",
    onOpenSettings: () => setTab("settings"),
    onClose: () => settingsReturn.current(),
  });
  const channel = useQuery({
    queryKey: ["platform", "channel-descriptor", session.tenantPrincipalId, active],
    enabled: Boolean(active) && activeRow?.isMember === true && tab === "channel",
    queryFn: () => bff.workspaceChannel(active!),
  });
  const replaceDefaultChannel = navigation.replaceDefaultChannel;
  useEffect(() => {
    if (active && activeRow?.isMember === true && workspaces.isSuccess && !workspaces.isFetching
      && channel.isSuccess && !channel.isFetching) replaceDefaultChannel(active);
  }, [active, activeRow?.isMember, workspaces.isSuccess, workspaces.isFetching,
    channel.isSuccess, channel.isFetching, replaceDefaultChannel]);
  const openMessageLink = (link: ParsedMessageLink) => {
    setMessageLinkProblem(null);
    void openSearchChannel(link.channelId, {eventId:link.messageId,threadRootId:link.threadRootId})
      .catch(() => setMessageLinkProblem(t("platform.linkChannelUnavailable")));
  };
  const preference = useMutation({
    mutationFn: async (next: { id: string; starred: boolean; muted: boolean; version: number }) => {
      const result = await setWorkspacePreference(next.id, { starred: next.starred, muted: next.muted, version: next.version });
      if (result.version !== next.version + 1) throw new TransportError("Invalid user-state CAS response");
      return result;
    },
    onSettled: () => userState.refresh(),
  });
  // A late request can still win its original CAS version. Only a newer authoritative
  // version proves that intent can no longer mutate; do not start a different write meanwhile.
  const preferenceUnknown = preference.isError && isOutcomeUnknown(preference.error)
    && (!userState.state || userState.state.version <= (preference.variables?.version ?? -1));
  useWebMarkAsReadShortcuts({ client: bff, session, reads: userState,
    workspaceId: tab === "channel" && activeRow?.isMember === true ? active : null,
    conversationId: tab === "conversation" ? chosenConversation?.id ?? null : null,
    disabled: tab === "settings" || preference.isPending || preferenceUnknown,
    onError: () => toast.error(t("platform.loadFailed")),
  });

  const onSignOut = useCallback(() => void signOut(), []);

  const tabLabel = (name: PlatformTab) =>
    ({
      channel: t("platform.tab.channel"),
      "new-message": translate(getLocale(), "sidebar.newMessage"),
      conversation: translate(getLocale(), "sidebar.messages"),
      inbox: translate(getLocale(), "inbox.title"),
      pulse: translate(getLocale(), "platform.tab.pulse"),
      projects: translate(getLocale(), "platform.tab.projects"),
      members: t("platform.tab.members"),
      agents: t("platform.tab.agents"),
      workflows: translate(getLocale(), "platform.tab.workflows"),
      tasks: t("platform.tab.tasks"),
      approvals: t("platform.tab.approvals"),
      devices: t("platform.tab.devices"),
      usage: t("platform.tab.usage"),
      operations: t("platform.tab.operations"),
      gateway: t("platform.tab.gateway"),
      audit: t("platform.tab.audit"),
      settings: translate(getLocale(), "platform.settings.title"),
      application: applicationTitle ?? translate(getLocale(), "bindings.nativeTitle"),
    })[name];

  // 任务、审批、审计与设备都是「我自己的」，属于 Tenant 而不属于某个 Workspace，
  // 因此不随 Workspace 是否存在而隐藏。
  const workspaceBody = workspaces.isError ? (
    <Notice text={t("platform.loadFailed")} />
  ) : workspaces.isPending ? (
    <Notice text={t("platform.loadingWorkspaces")} />
  ) : !active ? (
    <Notice text={t(chosen ? "platform.linkChannelUnavailable" : "platform.noWorkspace")} />
  ) : tab === "channel" ? (
    activeRow?.isMember !== true ? <div className="flex flex-col gap-3 p-4">
      <p role="status">{t("platform.channel.membershipRequired")}</p>
      <div className="flex gap-2">
        <Button onClick={() => setTab("members")}>{t("platform.tab.members")}</Button>
        {activeRow?.visibility === "open" ? <Button onClick={() => setCreateChannelOpen(true)}>{t("channel.browser.title")}</Button> : null}
      </div>
    </div> :
    channel.isError && !channel.data ? <Notice text={t("platform.loadFailed")} /> : !channel.data ? <Notice text={t("platform.loadingWorkspaces")} /> :
    channel.data.channelType === "forum" ? <ForumPane key={`${session.tenantPrincipalId}:${active}`} workspaceId={active}
      restoreDraftKey={navigation.draftTarget?.key} autoSendDraftKey={navigation.draftTarget?.send ? navigation.draftTarget.key : undefined} onAutoSendConsumed={navigation.consumeDraftSend}
      onStartDm={openDirectMessage} memberProfileRequest={memberProfileRequest}
      channelId={channel.data.channelId} archived={channel.data.archived} metadataPending={channel.isFetching || channel.isError} myPrincipalId={session.tenantPrincipalId} onOpenMessageLink={openMessageLink}
      target={messageTarget?.channelId === active ? {...messageTarget,channelId:channel.data.channelId} : undefined}
      searchMessageId={navigation.searchHighlight?.messageId} searchQuery={navigation.searchHighlight?.query} searchActivationId={navigation.searchHighlight?.activationId}
      postRoute={navigation.setForumPost ? { postId: navigation.forumPostId ?? null, replyId: navigation.forumReplyId ?? null,
        open: (postId, replyId, options) => navigation.setForumPost(postId, replyId, options), close: navigation.closeForumPost,
        clear: () => navigation.setForumPost(null, null, { replace: true }) } : undefined} /> :
    channel.data.channelType === "stream" ? <HuddleParentProvider parent={{kind: "workspace", workspaceId: active, channelId: channel.data.channelId}}
      channelName={buildHuddleChannelName({kind: "channel", channelName: channel.data.name})}><p role="status">{messageLinkProblem}</p><ChannelPane key={active} workspaceId={active} channelId={channel.data.channelId} channelName={channel.data.name} archived={channel.data.archived} metadataPending={channel.isFetching || channel.isError} myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh}
      threadHeadId={navigation.threadHeadId} onThreadHeadIdChange={navigation.setThreadHeadId} onClearMessageRouteTarget={navigation.clearMessageRouteTarget}
      onNavigationGuardChange={navigation.registerThreadNavigationGuard}
      restoreDraftKey={navigation.draftTarget?.key} restoreEditEventId={navigation.draftTarget?.editEventId} autoSendDraftKey={navigation.draftTarget?.send ? navigation.draftTarget.key : undefined} onAutoSendConsumed={navigation.consumeDraftSend}
      onMarkChannelUnread={markManualUnread} onClearChannelManualUnread={clearManualUnread}
      onStartDm={openDirectMessage} memberProfileRequest={memberProfileRequest} onHeaderActionsCompactChange={setHeaderActionsCompact}
      onOpenMessageLink={openMessageLink} targetMessageId={messageTarget?.channelId === active ? messageTarget.messageId : undefined}
      targetSearchMessageId={navigation.searchHighlight?.messageId} targetSearchQuery={navigation.searchHighlight?.query}
      targetSearchActivationId={navigation.searchHighlight?.activationId}
      targetThreadRootId={messageTarget?.channelId === active ? messageTarget.threadRootId ?? undefined : undefined} /></HuddleParentProvider> : <Notice text={t("platform.loadFailed")} />
  ) : (
    <MembersPane key={active} workspaceId={active} currentPrincipalId={session.tenantPrincipalId}
      onStartDm={openDirectMessage} />
  );
  const body =
    tab === "application" && navigation.applicationBindingId ? (
      <NativeApplicationPage key={`${session.tenantPrincipalId}:${navigation.applicationBindingId}`} bindingId={navigation.applicationBindingId} title={applicationTitle ?? undefined} />
    ) : tab === "new-message" ? (
      <NewMessagePage currentPrincipalId={session.tenantPrincipalId} onConversationOpened={async (conversation) => {
        await conversations.reload();
        await navigation.openConversation(conversation.id);
      }} />
    ) : tab === "conversation" ? (
      chosenConversation ? <HuddleParentProvider parent={{kind: "conversation", conversationId: chosenConversation.id, channelId: chosenConversation.channelId}}
        channelName={dmHeaderPeople ? buildHuddleChannelName({kind: "dm", selfLabel: session.displayName,
          participantLabels: dmHeaderPeople.map((person) => person.displayName)}) : null}><ChannelPane key={chosenConversation.id} workspaceId={chosenConversation.id} conversation={chosenConversation}
        onHeaderActionsCompactChange={setHeaderActionsCompact} memberProfileRequest={memberProfileRequest}
        threadHeadId={navigation.threadHeadId} onThreadHeadIdChange={navigation.setThreadHeadId} onClearMessageRouteTarget={navigation.clearMessageRouteTarget}
        onNavigationGuardChange={navigation.registerThreadNavigationGuard}
        restoreDraftKey={navigation.draftTarget?.key} restoreEditEventId={navigation.draftTarget?.editEventId} autoSendDraftKey={navigation.draftTarget?.send ? navigation.draftTarget.key : undefined} onAutoSendConsumed={navigation.consumeDraftSend}
        targetMessageId={messageTarget?.channelId === chosenConversation.id ? messageTarget.messageId : undefined}
        targetThreadRootId={messageTarget?.channelId === chosenConversation.id ? messageTarget.threadRootId ?? undefined : undefined}
        targetSearchMessageId={navigation.searchHighlight?.messageId} targetSearchQuery={navigation.searchHighlight?.query}
        targetSearchActivationId={navigation.searchHighlight?.activationId}
        onStartDm={openDirectMessage}
        onOpenMessageLink={openMessageLink}
        myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh} /></HuddleParentProvider> : <Notice text={t(conversations.loading ? "platform.loadingWorkspaces" : "platform.loadFailed")} />
    ) : tab === "settings" ? (
      null
    ) : tab === "inbox" ? (
      <InboxPane
        key={searchScopeKey}
        isDark={isDark}
        // Original management sheet Workflows ingress from the Inbox detail, as on the channel page.
        workflowsFor={(workspaceId) => ({
          onOpenWorkflow: (workflowId) => { void navigation.openWorkflow({ workflowId, workspaceId }, workspaceId); },
          onCreateWorkflow: () => { void navigation.openWorkflowCreate(true, workspaceId); },
        })}
        principalId={session.tenantPrincipalId}
        selectedItemId={navigation.inboxItemId}
        onSelectedItemIdChange={navigation.setInboxItemId}
        onOpenProject={(id,target)=>{void navigation.openProject(id,target);}}
        onStartDm={openDirectMessage}
        onUnreadCount={setInboxUnreadCount}
        onOpen={async (channelId, target, draft) => {
          const conversation = target?.conversation ?? draft?.conversation;
          const draftReference = draft ? {key:draft.key,send:draft.send,editEventId:draft.editEventId} : undefined;
          if (conversation) {
            await navigation.openConversation(conversation.id, target, undefined, draftReference);
          } else await navigation.openChannel(channelId, target ? {channelId,messageId:target.messageId,threadRootId:target.threadRootId ?? null} : undefined, undefined, draftReference);
        }}
      />
    ) : tab === "pulse" ? (
      <PulsePane scopeKey={`${session.tenantId}:${session.tenantPrincipalId}`} onStartDm={openDirectMessage}/>
    ) : tab === "projects" ? (
      <ProjectsPane scopeKey={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`}
        renderChannel={(workspace,auxiliary)=><ChannelPane {...auxiliary} key={`${session.platformSessionId}:${workspace.id}`} workspaceId={workspace.id}
          channelId={workspace.channel.channelId} channelName={workspace.channel.name} archived={workspace.channel.archived}
          myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh}
          threadHeadId={navigation.threadHeadId} onThreadHeadIdChange={navigation.setThreadHeadId}
          onClearMessageRouteTarget={navigation.clearMessageRouteTarget} onNavigationGuardChange={navigation.registerThreadNavigationGuard}
          restoreDraftKey={navigation.draftTarget?.key} restoreEditEventId={navigation.draftTarget?.editEventId}
          autoSendDraftKey={navigation.draftTarget?.send?navigation.draftTarget.key:undefined} onAutoSendConsumed={navigation.consumeDraftSend}
          onMarkChannelUnread={markManualUnread} onClearChannelManualUnread={clearManualUnread}
          onStartDm={openDirectMessage} onOpenMessageLink={openMessageLink}
          targetMessageId={messageTarget?.channelId===workspace.id?messageTarget.messageId:undefined}
          targetThreadRootId={messageTarget?.channelId===workspace.id?messageTarget.threadRootId??undefined:undefined}
          targetSearchMessageId={navigation.searchHighlight?.messageId} targetSearchQuery={navigation.searchHighlight?.query}
          targetSearchActivationId={navigation.searchHighlight?.activationId}/>}
        workItemTarget={navigation.projectWorkItemTarget} onStartDm={openDirectMessage}
        selectedProjectId={navigation.projectId} onSelectedProjectChange={(id,target)=>navigation.openProject(id,target)}
        lastMessageAtByChannelId={channelActivity} onOpenChannel={async workspace=>{void workspaces.refetch();await navigation.openChannel(workspace.id);}}/>
    ) : tab === "agents" ? (
      <AgentDefinitionsPane key={`${session.tenantId}:${session.tenantPrincipalId}`} workspaceId={chosen ?? active ?? undefined}
        onWorkspaceChange={(workspaceId) => { void navigation.openTab("agents", workspaceId); }} />
    ) : tab === "workflows" ? (
      <WorkflowsPage workspaceId={chosen ?? active ?? undefined} messageHost={webWorkflowMessageHost}
        workflowRoute={navigation.workflowRoute}
        onWorkflowRouteChange={(route, workspaceId) => { void navigation.openWorkflow(route, workspaceId); }}
        workflowCreateRoute={navigation.workflowCreateRoute}
        onWorkflowCreateRouteChange={navigation.openWorkflowCreate
          ? (open, workspaceId) => { void navigation.openWorkflowCreate(open, workspaceId); } : undefined}
        workflowNavigation={{ blocker: workflowBlocker, onStateChange: setWorkflowNavigationState }}
        onWorkspaceChange={(workspaceId) => { void navigation.openTab("workflows", workspaceId); }} />
    ) : tab === "tasks" ? (
      <TasksPage />
    ) : tab === "approvals" ? (
      <ApprovalsPage />
    ) : tab === "usage" ? (
      <UsageBillingPage />
    ) : tab === "operations" ? (
      <BusinessOperationsPage />
    ) : tab === "gateway" ? (
      <GatewayPage />
    ) : tab === "audit" ? (
      <AuditPage />
    ) : tab === "devices" ? (
      <DevicesPage />
    ) : tab === "members" ? (
      <WorkspaceManagementPanels>{workspaceBody}</WorkspaceManagementPanels>
    ) : (
      workspaceBody
    );

  // Original hover-card Message: only for keys known not to be the signed-in person's own.
  const ownPubkeys = searchDirectory.isSuccess && !searchDirectory.isFetching
    ? new Set(searchDirectory.data.people.find((person) => person.principalId === session.tenantPrincipalId)?.pubkeys ?? []) : null;
  const profileDirectMessage = { open: openDirectMessage,
    canMessage: (pubkey: string) => ownPubkeys !== null && ownPubkeys.size > 0 && !ownPubkeys.has(pubkey),
    // Original canWave: another admitted person; the people directory holds no Agent keys.
    wave: waveDirectMessage,
    canWave: (pubkey: string) => searchDirectory.isSuccess && !searchDirectory.isFetching
      && searchDirectory.data.people.some((person) => person.principalId !== session.tenantPrincipalId && person.pubkeys.includes(pubkey)) };
  return (
    <CollaborationPreferencesProvider value={preferences}>
    <AgentActivityOpenerHost navigate={openAgentActivityChannel}>
    <ProfileDirectMessageProvider value={profileDirectMessage}>
    <ProjectChannelRequestDialog host={projectRequestHost} useAgentChat={useProjectRequestAgentChat} />
    {/* Original `#channel` composer suggestions: the admitted directory's channel names. */}
    <ComposerChannelLinksProvider channels={searchDirectory.isError ? undefined : searchDirectory.data?.channels}>
    <BffReminderHost scopeKey={searchScopeKey} principalId={session.tenantPrincipalId} onOpen={openSearchChannel}>
    <BffMessageLinkHost scopeKey={searchScopeKey} principalId={session.tenantPrincipalId}
      onOpenProject={(id,target)=>navigation.openProject(id,target)}
      directory={searchDirectory.isError || conversations.error ? undefined : searchDirectory.data}
      conversations={conversations.items}
      onOpenMessageLink={openMessageLink}
      onOpenChannel={id => {void openSearchChannel(id).catch(() => setMessageLinkProblem(t("platform.linkChannelUnavailable")));}}>
    <HuddleHostProvider host={huddleHost}>
    {/* DD-125(3): original AppHuddleShell (lifted app surface over the Huddle drawer). */}
    <HuddleShell activeChannelId={tab === "channel" ? channel.data?.channelId ?? null : tab === "conversation" ? chosenConversation?.channelId ?? null : null}>
        <GradientLayer />
        <SidebarProvider className="relative z-10 min-h-0 min-w-0 flex-1 flex-col overflow-visible" data-testid="app-sidebar-layer">
          <div className={`${tab === "settings" ? "absolute inset-x-0 top-0" : "relative"} z-45 flex h-(--buzz-top-chrome-height,40px) shrink-0 cursor-default select-none items-center bg-sidebar pl-3 pr-3 text-sidebar-foreground`} data-testid="app-top-chrome">
            <div className="flex items-center gap-0.5">
              {/* DD-141: Kailo brand mark leads the top chrome. */}
              <KailoMark />
              <SidebarTrigger className="h-[28px] w-[28px] rounded-[4px] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
              <TopChromeHistoryButtons canGoBack={navigation.canGoBack === true} canGoForward={navigation.canGoForward === true}
                onGoBack={() => navigation.goBack?.()} onGoForward={() => navigation.goForward?.()} />
            </div>
            <div className="flex min-w-0 flex-1 items-center" id="app-top-chrome-content" />
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="contents" hidden={tab === "settings"} style={tab === "settings" ? { display: "none" } : undefined}>
            <AppSidebarFrame active={tab !== "settings"} aria-label={t("platform.title")}
              scrollRef={sidebarScrollRef}
              pinnedHeader={<AppSidebarPinnedHeaderFrame><TopbarSearch scopeKey={searchScopeKey}
                channels={searchDirectory.isError ? [] : (searchDirectory.data?.channels??[]).map(channel=>({...channel,lastMessageAt:channelActivity.get(channel.id)??channel.lastMessageAt}))}
                channelLabels={searchDirectory.isError ? undefined : searchDirectory.data?.labels}
                directoryError={conversations.error??searchDirectory.error}
                currentChannelId={nativeCurrentChannelId} focusRequest={searchFocusRequest} scopeFocusRequest={scopeSearchFocusRequest}
                onOpenChannel={channelId=>{void openSearchChannel(channelId).catch(()=>toast.error(t("platform.loadFailed")));}}
                onOpenResult={(hit,query)=>{if(hit.channelId)void openSearchChannel(hit.channelId,hit,query).catch(()=>toast.error(t("platform.loadFailed")));}}
                onOpenUser={user=>openDirectMessage(user.pubkey)}
                onBrowseChannels={()=>setCreateChannelOpen(true)} onCreateChannel={()=>setNewChannelOpen(true)}
                onCreateAgent={()=>{requestOpenCreateAgent();setTab("agents");}} />
              </AppSidebarPinnedHeaderFrame>}
              above={sidebarOverflow.unreadAboveCount > 0 ? <MoreUnreadButton count={sidebarOverflow.unreadAboveCount}
                emphasis={sidebarOverflow.hasHighPriorityAbove ? "primary" : "default"} onClick={sidebarOverflow.scrollToNextAbove} position="top" testId="sidebar-unread-above" /> : null}
              below={sidebarOverflow.unreadBelowCount > 0 ? <MoreUnreadButton count={sidebarOverflow.unreadBelowCount}
                dmPreviews={unreadDmPreviewsBelow} targetChannelId={nextUnreadDmBelowId}
                renderAvatar={(preview, props) => preview.author ? <MessageAuthorAvatar {...props}
                  key={`${searchScopeKey}:${preview.author.conversationId}:${preview.author.eventId}`}
                  target={{...preview.author, principalId: session.tenantPrincipalId, workspaceId: ""}} /> : <UserAvatar {...props} />}
                bottomClassName="bottom-full" emphasis={sidebarOverflow.hasHighPriorityBelow ? "primary" : "default"}
                onClick={() => nextUnreadDmBelowId ? sidebarOverflow.scrollToChannel(nextUnreadDmBelowId) : sidebarOverflow.scrollToNextBelow()}
                position="bottom" testId="sidebar-unread-below" /> : null}
              footer={<><SidebarRelayConnectionFooterCard card={connectionCard} />
                <SidebarMenu><SidebarMenuItem><WebSidebarProfileCard session={session} settingsOpen={tab === "settings"}
                onOpenSettings={() => setTab("settings")} onSignOut={onSignOut} /></SidebarMenuItem></SidebarMenu></>}
              dialogs={<><CreateChannelDialog key={`create:${session.tenantPrincipalId}`} open={newChannelOpen} onOpenChange={setNewChannelOpen} />
                <CreateChannelDialog key={`forum:${session.tenantPrincipalId}`} open={newForumOpen} onOpenChange={setNewForumOpen} channelKind={WorkspaceChannelCreateChannelType.Forum} />
                <ChannelBrowser key={session.tenantPrincipalId} open={createChannelOpen} onOpenChange={setCreateChannelOpen}
                lastMessageAtByChannelId={channelActivity}
                onSelect={async (workspace) => {
                  const assignToSection = sectionBrowseAssign.current;
                  sectionBrowseAssign.current = null;
                  await workspaces.refetch(); await navigation.openChannel(workspace.id);
                  assignToSection?.(workspace.channel.channelId);
                }} /></>}>
              <AppSidebarPrimaryMenu onSelectHome={() => setTab("inbox")}
                homeBadgeEnabled={notificationSettings?.settings.homeBadgeEnabled === true}
                homeBadgeCount={notificationSettings?.settings.homeBadgeEnabled && homeBadgeCount !== null ? homeBadgeCount : undefined}
                onSelectPlatformSection={setTab}
                projectsOverviewActive={!navigation.projectId}
                projectsSection={<SidebarProjects scopeKey={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`}
                  channels={rows.filter(workspace=>workspace.isMember===true).map(workspace=>({id:workspace.id,name:workspace.name,visibility:workspace.visibility?.toLowerCase()}))}
                  selectedProjectId={navigation.projectId} selectedChannelId={tab==="channel"?active:null}
                  onSelectProject={id=>navigation.openProject(id)} onSelectChannel={id=>{void navigation.openChannel(id);}}/>}
                selectedPlatformSection={tab === "channel" || tab === "inbox" || tab === "settings" || tab === "new-message" || tab === "conversation" || tab === "application" ? null : tab}
                selectedView={tab === "inbox" ? "home" : tab === "new-message" ? "new-message" : tab === "channel" || tab === "conversation" || tab === "settings" ? "channel" : "platform"} />
            <NativeApplicationEntries scopeKey={`${session.tenantId}:${session.tenantPrincipalId}`}
              selectedId={navigation.applicationBindingId} onSelectedTitle={setApplicationTitle}
              onSelect={(binding) => { void navigation.openApplication(binding.bindingId, binding.workspaceId); }}
              workspace={(tab === "channel" || tab === "application") && activeRow?.isMember === true ? activeRow : undefined} />
            {sidebarLoading ? <SidebarLoadingContent shape={sidebarLoadingShape} /> : <>
            <ChannelSidebar principalId={session.tenantPrincipalId} workspaces={rows} selectedId={active} active={tab === "channel"}
              directory={searchDirectory.isError ? undefined : searchDirectory.data?.workspaces}
              forcedUnread={forcedUnread} onMarkChannelUnread={markManualUnread} onClearChannelManualUnread={clearManualUnread}
              onActivity={setChannelActivity}
              onUnreadChange={setSidebarUnread}
              onChannelActionRecorded={() => {
                // Same DD-119 readback as the management sheet: descriptor, admitted and search directories.
                void queryClient.invalidateQueries({ queryKey: ["platform", "channel-descriptor", session.tenantPrincipalId] });
                void workspaces.refetch();
                void searchDirectory.refetch();
              }}
              reads={userState} preferencePending={preference.isPending || preferenceUnknown}
              onSelect={(id) => { void navigation.openChannel(id); }}
              onCreate={() => setCreateChannelOpen(true)}
              onBrowseChannelsForSection={(assign) => { sectionBrowseAssign.current = assign; setCreateChannelOpen(true); }}
              onCreateForum={() => setNewForumOpen(true)}
              onSetPreference={(id, value) => {
                if (userState.state) preference.mutate({ id, ...value, version: userState.state.version });
              }} />
            {preference.isError ? <p role="alert" className="px-4 text-sm">
              {preferenceUnknown ? translate(getLocale(), "sidebar.preferenceUnknown") : t("platform.loadFailed")}
              <Button size="sm" onClick={() => void userState.refresh()}>{t("platform.retry")}</Button>
            </p> : null}
            {/* Original group order: Starred, custom sections, Channels, Forums, then Direct messages. */}
            <ConversationSidebar key={searchScopeKey} currentPrincipalId={session.tenantPrincipalId} items={conversations.items} loading={conversations.loading} reads={userState}
              onUnreadChange={dmUnread.onUnreadChange}
              error={conversations.error} selectedId={tab === "conversation" ? chosenConversation?.id ?? null : null}
              onNewMessage={() => setTab("new-message")} onReload={() => { void conversations.reload().catch(() => undefined); }}
              onCloseSelected={() => setTab("inbox")}
              onSelect={(conversation) => { void navigation.openConversation(conversation.id); }} />
            </>}
            </AppSidebarFrame>
        <ContentSurface>
          {tab === "channel" && active && activeRow?.isMember === true && !workspaces.isError && !channel.isError && channel.data ?
            <ChatHeader title={channel.data.name} description={getChannelDescription(channel.data, getLocale())}
              channelType={channel.data.channelType}
              statusBadge={<ChannelEphemeralBadge channel={{ id: active, ttlSeconds: channel.data.ttlSeconds, ttlDeadline: channel.data.ttlDeadline }}
                testId="chat-ephemeral-badge" variant="header" />}
              leadingContent={<ChannelGlyph channel={activeRow} className="h-4 w-4 translate-y-px text-muted-foreground" />}
              actions={<ChannelMembersBar roster={{kind: "workspace", workspaceId: active}} onToggleMembers={() => setMembersOpenFor(membersOpenFor === active ? null : active)}
                onManageChannel={() => setManageOpenFor(active)} variant={headerActionsCompact ? "compact" : "inline"}
                huddle={{parent: {kind: "workspace", workspaceId: active, channelId: channel.data.channelId},
                  channelName: buildHuddleChannelName({kind: "channel", channelName: channel.data.name}),
                  startDisabled: channel.data.archived === true}} />}
              onCopyTitle={async (title) => {
                try { await writeTextToClipboard(title); toast.success(translate(getLocale(), "platform.profile.copied")); }
                catch { toast.error(translate(getLocale(), "platform.profile.copyFailed")); }
              }} /> : tab === "conversation" && dmHeaderTitle !== null ? <AvatarHostProvider value={{locale:getLocale(),rewriteMediaUrl:url=>dmHeaderProfile?.avatarMediaPaths[url]??url}}>
              <ChatHeader title={dmHeaderTitle} channelType="dm" visibility="private"
                leadingContent={<DmHeaderParticipants participants={dmHeaderParticipants} title={dmHeaderTitle}
                  renderIdentity={(participant, avatar) => dmHeaderTarget && chosenConversation && participant.id === dmHeaderTarget.principalId
                    ? <UserProfilePopoverSurface pubkey={dmHeaderTarget.pubkey} triggerElement="span"
                        triggerAriaLabel={translate(getLocale(), "members.openProfile", {name: participant.displayName})}
                        onOpenProfile={() => setMemberProfileRequest({...dmHeaderTarget, conversationId: chosenConversation.id, nonce: Date.now()})}
                        renderBody={(props) => <MemberHover {...props} target={dmHeaderTarget} presencePubkeys={dmHeaderTarget.alternatePubkeys} />}>{avatar}</UserProfilePopoverSurface>
                    : avatar} />}
                titleAdornment={dmHeaderPeople?.length === 1 ? <UserNameIndicators className="ml-1"
                  pubkey={dmHeaderPeople[0]?.pubkeys[0]} pubkeys={dmHeaderPeople[0]?.pubkeys} size="dm" /> : null}
                actions={chosenConversation ? <ChannelMembersBar roster={{kind: "conversation", conversation: chosenConversation}}
                  onToggleMembers={() => setMembersOpenFor(membersOpenFor === chosenConversation.id ? null : chosenConversation.id)}
                  onManageChannel={() => setManageOpenFor(chosenConversation.id)} variant={headerActionsCompact ? "compact" : "inline"}
                  huddle={{parent: {kind: "conversation", conversationId: chosenConversation.id, channelId: chosenConversation.channelId},
                    channelName: buildHuddleChannelName({kind: "dm", selfLabel: session.displayName,
                      participantLabels: dmHeaderPeople?.map((person) => person.displayName) ?? []}),
                    startDisabled: dmHeaderPeople === null}} /> : undefined}
                onCopyTitle={async title=>{
                  try { await writeTextToClipboard(title); toast.success(translate(getLocale(), "platform.profile.copied")); }
                  catch { toast.error(translate(getLocale(), "platform.profile.copyFailed")); }
                }}/>
            </AvatarHostProvider> : tab === "channel" && joinRow ? <ChatHeader title={joinRow.channel.name}
              description={getChannelDescription(joinRow.channel, getLocale())} channelType={joinRow.channel.channelType}
              leadingContent={<ChannelGlyph channel={{channelType: joinRow.channel.channelType, visibility: joinRow.visibility}} className="h-4 w-4 translate-y-px text-muted-foreground" />}
              actions={<ChannelJoinButton key={joinRow.id} workspace={joinRow}
                onJoined={async (workspace) => { await workspaces.refetch(); await navigation.openChannel(workspace.id); }} />}
              onCopyTitle={async (title) => {
                try { await writeTextToClipboard(title); toast.success(translate(getLocale(), "platform.profile.copied")); }
                catch { toast.error(translate(getLocale(), "platform.profile.copyFailed")); }
              }} /> : tab === "new-message" || tab === "agents" || tab === "projects" || tab === "inbox" ? null : <header className="flex h-[52px] shrink-0 items-center border-b px-5 text-headline font-semibold tracking-[-0.006em]" data-kailo-page-header>
            {tabLabel(tab)}
          </header>}
          {tab === "channel" && active && activeRow?.isMember === true && channel.data ?
            <ChannelMembersDialog key={`${session.tenantPrincipalId}:${active}`} roster={{kind: "workspace", workspaceId: active}} open={membersOpenFor === active}
              onOpenChange={(open) => setMembersOpenFor(open ? active : null)} archived={channel.data.archived}
              currentPrincipalId={session.tenantPrincipalId} workspaceName={channel.data.name}
              onOpenProfile={(target) => { setMembersOpenFor(null); setManageOpenFor(null);
                setMemberProfileRequest({workspaceId: active, ...target, nonce: Date.now()}); }} /> : null}
          {tab === "channel" && active && activeRow?.isMember === true && channel.data ?
            <ChannelManagementSheet key={`manage:${session.tenantPrincipalId}:${active}`} roster={{kind: "workspace", workspaceId: active}} open={manageOpenFor === active}
              onOpenChange={(open) => setManageOpenFor(open ? active : null)} isDark={isDark}
              channel={{channelId: channel.data.channelId, name: channel.data.name, description: channel.data.description ?? "",
                channelType: channel.data.channelType === "forum" ? "forum" : "stream", visibility: activeRow.visibility,
                ttlSeconds: channel.data.ttlSeconds ?? null, topic: channel.data.topic, archived: channel.data.archived}}
              management={{
                // DD-119 readback: the channel descriptor, admitted directory and search directory.
                refresh: () => {
                  void queryClient.invalidateQueries({ queryKey: ["platform", "channel-descriptor", session.tenantPrincipalId, active] });
                  void workspaces.refetch();
                  void searchDirectory.refetch();
                },
                publishTopic: async (workspaceId, request, idempotencyKey) => { await publishChannelTopic(workspaceId, request, idempotencyKey); },
                // DD-125(4) original Canvas: the adopted CONTROL-authored body in the shared Markdown renderer.
                renderCanvas: (content) => <MessageContent content={content} workspaceId={active} />,
              }}
              onOpenMembers={() => { window.requestAnimationFrame(() => setMembersOpenFor(active)); }}
              workflows={{
                onOpenWorkflow: (workflowId) => { setManageOpenFor(null); void navigation.openWorkflow({ workflowId, workspaceId: active }, active); },
                // Original goNewWorkflowForChannel: the create editor for this channel.
                onCreateWorkflow: () => { setManageOpenFor(null); void navigation.openWorkflowCreate(true, active); },
              }}
              onCopy={writeTextToClipboard} /> : null}
          {tab === "conversation" && chosenConversation ? <>
            <ChannelMembersDialog key={`dm:${session.tenantPrincipalId}:${chosenConversation.id}`}
              roster={{kind: "conversation", conversation: chosenConversation}} open={membersOpenFor === chosenConversation.id}
              onOpenChange={(open) => setMembersOpenFor(open ? chosenConversation.id : null)}
              currentPrincipalId={session.tenantPrincipalId}
              onOpenProfile={(target) => { setMembersOpenFor(null); setManageOpenFor(null);
                setMemberProfileRequest({conversationId: chosenConversation.id, ...target, nonce: Date.now()}); }} />
            <ChannelManagementSheet key={`dm-manage:${session.tenantPrincipalId}:${chosenConversation.id}`}
              roster={{kind: "conversation", conversation: chosenConversation}} open={manageOpenFor === chosenConversation.id}
              onOpenChange={(open) => setManageOpenFor(open ? chosenConversation.id : null)} isDark={isDark}
              channel={{channelId: chosenConversation.channelId, name: dmHeaderTitle ?? "", description: "", channelType: "dm", ttlSeconds: null}}
              onOpenMembers={() => { window.requestAnimationFrame(() => setMembersOpenFor(chosenConversation.id)); }}
              onCopy={writeTextToClipboard} />
          </> : null}
          <main className={tab === "inbox" || tab === "new-message" || tab === "agents" || tab === "projects" ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : tab === "application" ? "flex min-h-0 flex-1 flex-col overflow-hidden p-4" : "min-h-0 flex-1 overflow-auto p-4"}>
            {body}
          </main>
        </ContentSurface>
            </div>
            {settingsVisited.current ? <div className="flex min-h-0 min-w-0 flex-1" hidden={tab !== "settings"} style={tab === "settings" ? undefined : { display: "none" }}>
              <SettingsPane key={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`} active={tab === "settings"} fallbackDisplayName={session.displayName} onClose={() => settingsReturn.current()}
                section={navigation.settingsSection} onSectionChange={navigation.setSettingsSection} />
            </div> : null}
          </div>
          <RelayConnectionOverlay card={connectionCard} />
        </SidebarProvider>
    </HuddleShell>
    </HuddleHostProvider>
    </BffMessageLinkHost>
    </BffReminderHost>
    </ComposerChannelLinksProvider>
    </ProfileDirectMessageProvider>
    </AgentActivityOpenerHost>
    </CollaborationPreferencesProvider>
  );
}
