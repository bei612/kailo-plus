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
import { ChannelBrowser } from "@client-kit/platform/react/channel-browser";
import { CreateChannelDialog } from "@client-kit/platform/react/create-channel-dialog";
import { useChannelNavigationShortcuts } from "@client-kit/platform/react/use-channel-navigation-shortcuts";
import { useSearchShortcuts } from "@client-kit/platform/react/use-search-shortcuts";
import { ConversationVisibilityProvider, useConversations, useDirectMessageOpen } from "@client-kit/platform/react/new-message";
import { ConversationSidebar } from "./ConversationSidebar";
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
import { useBlocker } from "@tanstack/react-router";
import { RedemptionProgress } from "@client-kit/platform/react/invitations";
import { usePlatformNavigation, type PlatformTab } from "@/app/platform-navigation";
import {
  AuditPage,
  DevicesPage,
  MembersPane,
  WorkspaceManagementPanels,
} from "@client-kit/platform/react/pages";
import { ContentSurface, GradientLayer } from "@client-kit/platform/react/surfaces";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useInboxState } from "@client-kit/platform/react/use-inbox-state";
import { isOutcomeUnknown, TransportError } from "@client-kit/platform/transport";
import { ChannelSidebar } from "./ChannelSidebar";
import { SidebarProvider, SidebarTrigger, SidebarMenu, SidebarMenuItem } from "@client-kit/platform/react/sidebar/sidebar";
import { AppSidebarFrame, AppSidebarPinnedHeaderFrame } from "@client-kit/platform/react/sidebar/app-sidebar-frame";
import { MoreUnreadButton } from "@client-kit/platform/react/sidebar/MoreUnreadButton";
import { useUnreadOverflow } from "@client-kit/platform/react/sidebar/useUnreadOverflow";
import { NativeApplicationEntries } from "@client-kit/platform/react/pages";
import { NativeApplicationPage } from "@client-kit/platform/react/native-application-page";
import { AppSidebarPrimaryMenu } from "@client-kit/platform/react/sidebar/app-sidebar-primary-menu";
import { WebSidebarProfileCard } from "./SidebarProfileCard";
import { forcedUnreadStore, useForcedUnreadActions, type ForcedUnreadMap } from "@client-kit/platform/react/sidebar/forcedUnreadStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BffError, bff, setWorkspacePreference, signOut } from "@/platform/bff-client";
import { ChannelPane } from "@/platform/ui/ChannelPane";
import { ForumPane } from "@/platform/ui/ForumPane";
import { InboxPane } from "@/platform/ui/InboxPane";
import { SettingsPane } from "@/platform/ui/SettingsPane";
import { AgentDefinitionsPane } from "./AgentDefinitionsPane";
import { NewMessagePage } from "./NewMessagePage";
import { PulsePane } from "./PulsePane";
import { ProjectsPane } from "./ProjectsPane";
import { SidebarProjects } from "./SidebarProjects";
import { ChannelType } from "@client-kit/contracts";
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
import { BffMessageLinkHost } from "@/features/chat/ui/BffMessageLinkHost";
import { TopbarSearch } from "./TopbarSearch";
import { useWebSearchDirectory } from "./search";
import type { SearchHit } from "@client-kit/platform/react/search/types";
import { useWebMarkAsReadShortcuts } from "./useMarkAsReadShortcuts";

/** 会话解析失败即什么都不渲染：没有身份就没有任何页面可看（fail closed）。 */
export function PlatformApp() {
  const locale = useDeviceLocale();
  const { isDark } = useTheme();
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
    <PlatformProvider client={bff} locale={locale} documentTheme={isDark ? "DARK" : "LIGHT"} currentPrincipalId={session.tenantPrincipalId}>
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
        <BrowserNotificationsProvider key={session.tenantPrincipalId} principalId={session.tenantPrincipalId}><ConversationVisibilityProvider value={conversationVisibility}><SignedIn session={session} /></ConversationVisibilityProvider></BrowserNotificationsProvider>
      )}
    </PlatformProvider>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function SignedIn({ session }: { session: PlatformSessionView }) {
  const notificationSettings = useBrowserNotifications();
  const [inboxUnreadCount, setInboxUnreadCount] = useState<number | null>(null);
  const workspaces = useQuery(platformQueries.workspaces);
  const userState = useInboxState(bff);
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
  const navigation = usePlatformNavigation();
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
  const settingsVisited=useRef(false);
  if(tab==="settings")settingsVisited.current=true;
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newForumOpen, setNewForumOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [scopeSearchFocusRequest, setScopeSearchFocusRequest] = useState(0);
  const searchScopeKey = `${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`;
  const searchDirectory = useWebSearchDirectory(searchScopeKey, conversations.items, session.tenantPrincipalId,
    !conversations.loading && !conversations.error && tab !== "settings");
  const dmHeaderPeople = searchDirectory.isSuccess && !searchDirectory.isFetching
    ? resolveConversationHeaderParticipants(chosenConversation, session.tenantPrincipalId, searchDirectory.data.people) : null;
  const dmHeaderTitle = dmHeaderPeople ? formatDmParticipantDisplayName(dmHeaderPeople) : null;
  const dmHeaderParticipants = dmHeaderPeople?.map(person => ({id:person.principalId,displayName:person.displayName,avatarUrl:null})) ?? [];
  const [channelActivity, setChannelActivity] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const [sidebarUnread, setSidebarUnread] = useState<ReadonlySet<string>>(() => new Set());
  const sidebarOverflow = useUnreadOverflow({ scrollRef: sidebarScrollRef, unreadChannelIds: sidebarUnread });
  const rows = useMemo(() => workspaces.isError ? [] : workspaces.data ?? [], [workspaces.isError, workspaces.data]);
  // Only use fresh admitted directory rows; a revoked previous selection cannot remain active.
  // An explicit URL target is not permission and must never fall back to another channel.
  const activeRow = chosen ? rows.find((workspace) => workspace.id === chosen)
    : rows.find((workspace) => workspace.id === session.currentWorkspaceId && workspace.isMember === true)
    ?? rows.find((workspace) => workspace.isMember === true)
    ?? rows[0];
  const active = activeRow?.id ?? null;
  const nativeCurrentChannelId = tab === "conversation" ? chosenConversation?.channelId
    : tab === "channel" && !searchDirectory.isError ? searchDirectory.data?.workspaces.find(row=>row.id===active)?.channel.channelId : undefined;
  const openSearchChannel = async (channelId:string, hit?:Pick<SearchHit, "eventId" | "threadRootId">) => {
    if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner)
      throw new TransportError(translate(getLocale(), "dm.viewInactive"));
    const fresh = await searchDirectory.refetch();
    if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner || fresh.isError || !fresh.data)
      throw new TransportError(t("platform.loadFailed"));
    const workspace = fresh.data.workspaces.find(row=>row.channel.channelId===channelId);
    if (workspace) {
      if (hit && !workspace.isMember) throw new TransportError(t("platform.linkChannelUnavailable"));
      await navigation.openChannel(workspace.id, hit ? {channelId:workspace.id,messageId:hit.eventId,threadRootId:hit.threadRootId??null} : undefined);
      return;
    }
    const actual = await conversations.reload();
    if (!directMessageOwner.active || currentDirectMessageOwner.current !== directMessageOwner)
      throw new TransportError(translate(getLocale(), "dm.viewInactive"));
    const conversation = actual.find(row=>row.channelId===channelId&&row.state==="ACTIVE"&&row.participantPrincipalIds.includes(session.tenantPrincipalId));
    if (!conversation) throw new TransportError(t("platform.linkChannelUnavailable"));
    await navigation.openConversation(conversation.id, hit ? {messageId:hit.eventId,threadRootId:hit.threadRootId??null} : undefined);
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
      audit: t("platform.tab.audit"),
      settings: translate(getLocale(), "platform.settings.title"),
      application: translate(getLocale(), "bindings.nativeTitle"),
    })[name];

  // 任务、审批、审计与设备都是「我自己的」，属于 Tenant 而不属于某个 Workspace，
  // 因此不随 Workspace 是否存在而隐藏。
  const workspaceBody = workspaces.isError ? (
    <Notice text={t("platform.loadFailed")} />
  ) : workspaces.isPending ? (
    <Notice text={t("platform.loadingWorkspaces")} />
  ) : !active ? (
    <Notice text={t("platform.noWorkspace")} />
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
      onStartDm={openDirectMessage}
      channelId={channel.data.channelId} archived={channel.data.archived} metadataPending={channel.isFetching || channel.isError} myPrincipalId={session.tenantPrincipalId} onOpenMessageLink={openMessageLink} target={messageTarget ?? undefined} /> :
    channel.data.channelType === "stream" ? <><p role="status">{messageLinkProblem}</p><ChannelPane key={active} workspaceId={active} channelId={channel.data.channelId} channelName={channel.data.name} archived={channel.data.archived} metadataPending={channel.isFetching || channel.isError} myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh}
      onMarkChannelUnread={markManualUnread} onClearChannelManualUnread={clearManualUnread}
      onStartDm={openDirectMessage}
      onOpenMessageLink={openMessageLink} targetMessageId={messageTarget?.channelId === active ? messageTarget.messageId : undefined}
      targetThreadRootId={messageTarget?.channelId === active ? messageTarget.threadRootId ?? undefined : undefined} /></> : <Notice text={t("platform.loadFailed")} />
  ) : (
    <MembersPane key={active} workspaceId={active} currentPrincipalId={session.tenantPrincipalId}
      onStartDm={openDirectMessage} />
  );
  const body =
    tab === "application" && navigation.applicationBindingId ? (
      <NativeApplicationPage key={`${session.tenantPrincipalId}:${navigation.applicationBindingId}`} bindingId={navigation.applicationBindingId} onBack={() => setTab("inbox")} />
    ) : tab === "new-message" ? (
      <NewMessagePage currentPrincipalId={session.tenantPrincipalId} onConversationOpened={async (conversation) => {
        await conversations.reload();
        await navigation.openConversation(conversation.id);
      }} />
    ) : tab === "conversation" ? (
      chosenConversation ? <ChannelPane key={chosenConversation.id} workspaceId={chosenConversation.id} conversation={chosenConversation}
        targetMessageId={messageTarget?.channelId === chosenConversation.id ? messageTarget.messageId : undefined}
        targetThreadRootId={messageTarget?.channelId === chosenConversation.id ? messageTarget.threadRootId ?? undefined : undefined}
        onStartDm={openDirectMessage}
        onOpenMessageLink={openMessageLink}
        myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh} /> : <Notice text={t(conversations.loading ? "platform.loadingWorkspaces" : "platform.loadFailed")} />
    ) : tab === "settings" ? (
      null
    ) : tab === "inbox" ? (
      <InboxPane
        principalId={session.tenantPrincipalId}
        onStartDm={openDirectMessage}
        onUnreadCount={setInboxUnreadCount}
        onOpen={async (channelId, target) => {
          if (target?.conversation) {
            await navigation.openConversation(target.conversation.id, target);
          } else await navigation.openChannel(channelId, target ? {channelId,messageId:target.messageId,threadRootId:target.threadRootId ?? null} : undefined);
        }}
      />
    ) : tab === "pulse" ? (
      <PulsePane scopeKey={`${session.tenantId}:${session.tenantPrincipalId}`} onStartDm={openDirectMessage}/>
    ) : tab === "projects" ? (
      <ProjectsPane scopeKey={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`}
        selectedProjectId={navigation.projectId} onSelectedProjectChange={id=>{void navigation.openProject(id);}}
        lastMessageAtByChannelId={channelActivity} onOpenChannel={async workspace=>{await workspaces.refetch();await navigation.openChannel(workspace.id);}}/>
    ) : tab === "agents" ? (
      <AgentDefinitionsPane key={`${session.tenantId}:${session.tenantPrincipalId}`} workspaceId={chosen ?? active ?? undefined}
        onWorkspaceChange={(workspaceId) => { void navigation.openTab("agents", workspaceId); }} />
    ) : tab === "workflows" ? (
      <WorkflowsPage workspaceId={chosen ?? active ?? undefined}
        workflowNavigation={{ blocker: workflowBlocker, onStateChange: setWorkflowNavigationState }}
        onWorkspaceChange={(workspaceId) => { void navigation.openTab("workflows", workspaceId); }} />
    ) : tab === "tasks" ? (
      <TasksPage />
    ) : tab === "approvals" ? (
      <ApprovalsPage />
    ) : tab === "audit" ? (
      <AuditPage />
    ) : tab === "devices" ? (
      <DevicesPage />
    ) : tab === "members" ? (
      <WorkspaceManagementPanels>{workspaceBody}</WorkspaceManagementPanels>
    ) : (
      workspaceBody
    );

  return (
    <BffMessageLinkHost scopeKey={searchScopeKey} principalId={session.tenantPrincipalId}
      directory={searchDirectory.isError || conversations.error ? undefined : searchDirectory.data}
      conversations={conversations.items}
      onOpenMessageLink={openMessageLink}
      onOpenChannel={id => {void openSearchChannel(id).catch(() => setMessageLinkProblem(t("platform.linkChannelUnavailable")));}}>
    <div className="relative h-dvh overflow-hidden overscroll-none">
      <div className="absolute inset-0 z-10 flex min-h-0 flex-row overflow-hidden bg-background">
        <GradientLayer />
        <SidebarProvider className="relative z-10 min-h-0 min-w-0 flex-1 flex-col overflow-visible" data-testid="app-sidebar-layer">
          <div className={`${tab === "settings" ? "absolute inset-x-0 top-0" : "relative"} z-45 flex h-(--buzz-top-chrome-height,40px) shrink-0 cursor-default select-none items-center bg-sidebar pl-3 pr-3 text-sidebar-foreground`} data-testid="app-top-chrome">
            <SidebarTrigger className="h-[28px] w-[28px] rounded-[4px] text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
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
                onOpenResult={hit=>{if(hit.channelId)void openSearchChannel(hit.channelId,hit).catch(()=>toast.error(t("platform.loadFailed")));}}
                onOpenUser={user=>openDirectMessage(user.pubkey)}
                onBrowseChannels={()=>setCreateChannelOpen(true)} onCreateChannel={()=>setNewChannelOpen(true)} />
              </AppSidebarPinnedHeaderFrame>}
              above={sidebarOverflow.unreadAboveCount > 0 ? <MoreUnreadButton count={sidebarOverflow.unreadAboveCount}
                emphasis="default" onClick={sidebarOverflow.scrollToNextAbove} position="top" testId="sidebar-unread-above" /> : null}
              below={sidebarOverflow.unreadBelowCount > 0 ? <MoreUnreadButton count={sidebarOverflow.unreadBelowCount}
                bottomClassName="bottom-full" emphasis="default" onClick={sidebarOverflow.scrollToNextBelow} position="bottom" testId="sidebar-unread-below" /> : null}
              footer={<SidebarMenu><SidebarMenuItem><WebSidebarProfileCard session={session} settingsOpen={tab === "settings"}
                onOpenSettings={() => setTab("settings")} onSignOut={onSignOut} /></SidebarMenuItem></SidebarMenu>}
              dialogs={<><CreateChannelDialog key={`create:${session.tenantPrincipalId}`} open={newChannelOpen} onOpenChange={setNewChannelOpen} />
                <CreateChannelDialog key={`forum:${session.tenantPrincipalId}`} open={newForumOpen} onOpenChange={setNewForumOpen} channelKind={ChannelType.Forum} />
                <ChannelBrowser key={session.tenantPrincipalId} open={createChannelOpen} onOpenChange={setCreateChannelOpen}
                lastMessageAtByChannelId={channelActivity}
                onSelect={async (workspace) => { await workspaces.refetch(); await navigation.openChannel(workspace.id); }} /></>}>
              <AppSidebarPrimaryMenu onSelectHome={() => setTab("inbox")}
                homeBadgeCount={notificationSettings?.settings.homeBadgeEnabled && inboxUnreadCount !== null ? inboxUnreadCount : undefined}
                onSelectPlatformSection={setTab}
                projectsOverviewActive={!navigation.projectId}
                projectsSection={<SidebarProjects scopeKey={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`}
                  channels={rows.filter(workspace=>workspace.isMember===true).map(workspace=>({id:workspace.id,name:workspace.name,visibility:workspace.visibility?.toLowerCase()}))}
                  selectedProjectId={navigation.projectId} selectedChannelId={tab==="channel"?active:null}
                  onSelectProject={id=>navigation.openProject(id)} onSelectChannel={id=>{void navigation.openChannel(id);}}/>}
                selectedPlatformSection={tab === "channel" || tab === "inbox" || tab === "settings" || tab === "new-message" || tab === "conversation" || tab === "application" ? null : tab}
                selectedView={tab === "inbox" ? "home" : tab === "new-message" ? "new-message" : tab === "channel" || tab === "conversation" || tab === "settings" ? "channel" : "platform"} />
            <NativeApplicationEntries scopeKey={`${session.tenantId}:${session.tenantPrincipalId}`}
              selectedId={navigation.applicationBindingId}
              onSelect={(binding) => { void navigation.openApplication(binding.bindingId, binding.workspaceId); }}
              workspace={(tab === "channel" || tab === "application") && activeRow?.isMember === true ? activeRow : undefined} />
            <ConversationSidebar currentPrincipalId={session.tenantPrincipalId} items={conversations.items} loading={conversations.loading} reads={userState}
              error={conversations.error} selectedId={tab === "conversation" ? chosenConversation?.id ?? null : null}
              onNewMessage={() => setTab("new-message")} onReload={() => { void conversations.reload().catch(() => undefined); }}
              onCloseSelected={() => setTab("inbox")}
              onSelect={(conversation) => { void navigation.openConversation(conversation.id); }} />
            <ChannelSidebar principalId={session.tenantPrincipalId} workspaces={rows} selectedId={active} active={tab === "channel"}
              forcedUnread={forcedUnread} onMarkChannelUnread={markManualUnread} onClearChannelManualUnread={clearManualUnread}
              onActivity={setChannelActivity}
              onUnreadChange={setSidebarUnread}
              reads={userState} preferencePending={preference.isPending || preferenceUnknown}
              onSelect={(id) => { void navigation.openChannel(id); }}
              onCreate={() => setCreateChannelOpen(true)}
              onCreateForum={() => setNewForumOpen(true)}
              onSetPreference={(id, value) => {
                if (userState.state) preference.mutate({ id, ...value, version: userState.state.version });
              }} />
            {preference.isError ? <p role="alert" className="px-4 text-sm">
              {preferenceUnknown ? translate(getLocale(), "sidebar.preferenceUnknown") : t("platform.loadFailed")}
              <Button size="sm" onClick={() => void userState.refresh()}>{t("platform.retry")}</Button>
            </p> : null}
            </AppSidebarFrame>
        <ContentSurface>
          {tab === "channel" && active && activeRow?.isMember === true && !workspaces.isError && !channel.isError && channel.data ?
            <ChatHeader title={channel.data.name} description={channel.data.description ?? undefined}
              channelType={channel.data.channelType}
              leadingContent={<ChannelGlyph channel={activeRow} className="h-4 w-4 translate-y-px text-muted-foreground" />}
              onCopyTitle={async (title) => {
                try { await navigator.clipboard.writeText(title); toast.success(translate(getLocale(), "platform.profile.copied")); }
                catch { toast.error(translate(getLocale(), "platform.profile.copyFailed")); }
              }} /> : tab === "conversation" && dmHeaderTitle !== null ? <AvatarHostProvider value={{locale:getLocale(),rewriteMediaUrl:url=>url}}>
              <ChatHeader title={dmHeaderTitle} channelType="dm" visibility="private"
                leadingContent={<DmHeaderParticipants participants={dmHeaderParticipants} title={dmHeaderTitle} />}
                onCopyTitle={async title=>{
                  try { await navigator.clipboard.writeText(title); toast.success(translate(getLocale(), "platform.profile.copied")); }
                  catch { toast.error(translate(getLocale(), "platform.profile.copyFailed")); }
                }}/>
            </AvatarHostProvider> : <header className="flex h-12 shrink-0 items-center border-b px-4 font-semibold">
            {tabLabel(tab)}
          </header>}
          <main className={tab === "inbox" ? "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden" : tab === "application" ? "flex min-h-0 flex-1 flex-col overflow-hidden p-4" : "min-h-0 flex-1 overflow-auto p-4"}>
            {body}
          </main>
        </ContentSurface>
            </div>
            {settingsVisited.current ? <div className="flex min-h-0 min-w-0 flex-1" hidden={tab !== "settings"} style={tab === "settings" ? undefined : { display: "none" }}>
              <SettingsPane key={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`} active={tab === "settings"} fallbackDisplayName={session.displayName} onClose={() => settingsReturn.current()} />
            </div> : null}
          </div>
        </SidebarProvider>
      </div>
    </div>
    </BffMessageLinkHost>
  );
}
