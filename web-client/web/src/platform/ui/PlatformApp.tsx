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
import { ConversationList, ConversationVisibilityProvider, useConversations } from "@client-kit/platform/react/new-message";
import { conversationVisibility } from "../bff-client";
import { useSettingsShortcuts } from "@client-kit/platform/react/use-settings-shortcuts";
import { useTextScaleShortcuts } from "@client-kit/platform/react/use-text-scale-shortcuts";
import { ProtocolDocumentBridge } from "@client-kit/platform/react/protocol-document-bridge";
import {
  ApprovalsPage,
  LifecycleRestrictedView,
  TasksPage,
} from "@client-kit/platform/react/governance";
import { WorkflowsPage } from "@client-kit/platform/react/workflows";
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
import { AppSidebarFrame } from "@client-kit/platform/react/sidebar/app-sidebar-frame";
import { NativeApplicationEntries } from "@client-kit/platform/react/pages";
import { NativeApplicationPage } from "@client-kit/platform/react/native-application-page";
import { AppSidebarPrimaryMenu } from "@client-kit/platform/react/sidebar/app-sidebar-primary-menu";
import { WebSidebarProfileCard } from "./SidebarProfileCard";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { translate } from "@client-kit/platform/i18n";
import { platformQueries } from "@/platform/ui/queries";
import { getLocale, t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { ChatHeader } from "@client-kit/platform/react/messages/chat-header";
import { FileText, Hash } from "lucide-react";
import { toast } from "sonner";
import { BrowserNotificationsProvider, useBrowserNotifications } from "./BrowserNotifications";

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
    <PlatformProvider client={bff} locale={locale} documentTheme={isDark ? "DARK" : "LIGHT"}>
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
  const conversations = useConversations();
  const navigation = usePlatformNavigation();
  const { tab, messageTarget } = navigation;
  const chosen = navigation.workspaceId;
  const chosenConversation = !conversations.error && !conversations.loading
    ? conversations.items.find((conversation) => conversation.id === navigation.conversationId) : undefined;
  const [messageLinkProblem, setMessageLinkProblem] = useState<string | null>(null);
  const settingsVisited=useRef(false);
  if(tab==="settings")settingsVisited.current=true;
  const [initialRecipientPubkey, setInitialRecipientPubkey] = useState<string>();
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [channelActivity, setChannelActivity] = useState<ReadonlyMap<string, string | null>>(() => new Map());
  const rows = workspaces.isError ? [] : workspaces.data ?? [];
  // Only use fresh admitted directory rows; a revoked previous selection cannot remain active.
  // An explicit URL target is not permission and must never fall back to another channel.
  const activeRow = chosen ? rows.find((workspace) => workspace.id === chosen)
    : rows.find((workspace) => workspace.id === session.currentWorkspaceId && workspace.isMember === true)
    ?? rows.find((workspace) => workspace.isMember === true)
    ?? rows[0];
  const active = activeRow?.id ?? null;
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
  useChannelNavigationShortcuts({
    disabled: tab === "settings",
    onBrowseChannels: () => setCreateChannelOpen(true),
    onCreateChannel: () => setNewChannelOpen(true),
    onNewMessage: () => { setInitialRecipientPubkey(undefined); setTab("new-message"); },
  });
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
    if (!rows.some((workspace) => workspace.id === link.channelId && workspace.isMember === true)) {
      setMessageLinkProblem(t("platform.linkChannelUnavailable"));
      return;
    }
    setMessageLinkProblem(null);
    void navigation.openChannel(link.channelId, link);
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
      onStartDm={(pubkey)=>{setInitialRecipientPubkey(pubkey);setTab("new-message");}}
      channelId={channel.data.channelId} archived={channel.data.archived} metadataPending={channel.isFetching || channel.isError} myPrincipalId={session.tenantPrincipalId} onOpenMessageLink={openMessageLink} target={messageTarget ?? undefined} /> :
    channel.data.channelType === "stream" ? <><p role="status">{messageLinkProblem}</p><ChannelPane key={active} workspaceId={active} channelId={channel.data.channelId} channelName={channel.data.name} archived={channel.data.archived} metadataPending={channel.isFetching || channel.isError} myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh}
      onStartDm={(pubkey)=>{setInitialRecipientPubkey(pubkey);setTab("new-message");}}
      onOpenMessageLink={openMessageLink} targetMessageId={messageTarget?.channelId === active ? messageTarget.messageId : undefined} /></> : <Notice text={t("platform.loadFailed")} />
  ) : (
    <MembersPane key={active} workspaceId={active} currentPrincipalId={session.tenantPrincipalId}
      onStartDm={(pubkey)=>{setInitialRecipientPubkey(pubkey);setTab("new-message");}} />
  );
  const body =
    tab === "application" && navigation.applicationBindingId ? (
      <NativeApplicationPage key={`${session.tenantPrincipalId}:${navigation.applicationBindingId}`} bindingId={navigation.applicationBindingId} onBack={() => setTab("inbox")} />
    ) : tab === "new-message" ? (
      <NewMessagePage currentPrincipalId={session.tenantPrincipalId} initialRecipientPubkey={initialRecipientPubkey} onConversationOpened={async (conversation) => {
        await conversations.reload();
        await navigation.openConversation(conversation.id);
      }} />
    ) : tab === "conversation" ? (
      chosenConversation ? <ChannelPane key={chosenConversation.id} workspaceId={chosenConversation.id} conversation={chosenConversation}
        targetMessageId={messageTarget?.channelId === chosenConversation.id ? messageTarget.messageId : undefined}
        onStartDm={(pubkey)=>{setInitialRecipientPubkey(pubkey);setTab("new-message");}}
        onOpenMessageLink={openMessageLink}
        myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh} /> : <Notice text={t(conversations.loading ? "platform.loadingWorkspaces" : "platform.loadFailed")} />
    ) : tab === "settings" ? (
      null
    ) : tab === "inbox" ? (
      <InboxPane
        principalId={session.tenantPrincipalId}
        onStartDm={(pubkey)=>{setInitialRecipientPubkey(pubkey);setTab("new-message");}}
        onUnreadCount={setInboxUnreadCount}
        onOpen={async (channelId, target) => {
          if (target?.conversation) {
            await navigation.openConversation(target.conversation.id, target);
          } else await navigation.openChannel(channelId, target ? {channelId,messageId:target.messageId,threadRootId:target.threadRootId ?? null} : undefined);
        }}
      />
    ) : tab === "pulse" ? (
      <PulsePane scopeKey={`${session.tenantId}:${session.tenantPrincipalId}`} onStartDm={(pubkey)=>{
        setInitialRecipientPubkey(pubkey);setTab("new-message");
      }}/>
    ) : tab === "projects" ? (
      <ProjectsPane scopeKey={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`}
        selectedProjectId={navigation.projectId} onSelectedProjectChange={id=>{void navigation.openProject(id);}}/>
    ) : tab === "agents" ? (
      <AgentDefinitionsPane key={`${session.tenantId}:${session.tenantPrincipalId}`} workspaceId={chosen ?? active ?? undefined}
        onWorkspaceChange={(workspaceId) => { void navigation.openTab("agents", workspaceId); }} />
    ) : tab === "workflows" ? (
      <WorkflowsPage workspaceId={chosen ?? active ?? undefined}
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
              footer={<SidebarMenu><SidebarMenuItem><WebSidebarProfileCard session={session} settingsOpen={tab === "settings"}
                onOpenSettings={() => setTab("settings")} onSignOut={onSignOut} /></SidebarMenuItem></SidebarMenu>}
              dialogs={<><CreateChannelDialog key={`create:${session.tenantPrincipalId}`} open={newChannelOpen} onOpenChange={setNewChannelOpen} />
                <ChannelBrowser key={session.tenantPrincipalId} open={createChannelOpen} onOpenChange={setCreateChannelOpen}
                lastMessageAtByChannelId={channelActivity}
                onSelect={async (workspace) => { await workspaces.refetch(); await navigation.openChannel(workspace.id); }} /></>}>
              <AppSidebarPrimaryMenu onNewMessage={() => {setInitialRecipientPubkey(undefined);setTab("new-message");}} onSelectHome={() => setTab("inbox")}
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
            <ConversationList currentPrincipalId={session.tenantPrincipalId} items={conversations.items} loading={conversations.loading}
              error={conversations.error} selectedId={tab === "conversation" ? chosenConversation?.id ?? null : null}
              onNewMessage={() => {setInitialRecipientPubkey(undefined);setTab("new-message");}} onReload={() => { void conversations.reload().catch(() => undefined); }}
              onCloseSelected={() => setTab("inbox")}
              onSelect={(conversation) => { void navigation.openConversation(conversation.id); }} />
            <ChannelSidebar principalId={session.tenantPrincipalId} workspaces={rows} selectedId={active} active={tab === "channel"}
              onActivity={setChannelActivity}
              reads={userState} preferencePending={preference.isPending || preferenceUnknown}
              onSelect={(id) => { void navigation.openChannel(id); }}
              onCreate={() => setCreateChannelOpen(true)}
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
              leadingContent={channel.data.channelType === "forum" ? <FileText className="h-4 w-4 text-muted-foreground" /> : <Hash className="h-4 w-4 translate-y-px text-muted-foreground" />}
              onCopyTitle={async (title) => {
                try { await navigator.clipboard.writeText(title); toast.success(translate(getLocale(), "platform.profile.copied")); }
                catch { toast.error(translate(getLocale(), "platform.profile.copyFailed")); }
              }} /> : <header className="flex h-12 shrink-0 items-center border-b px-4 font-semibold">
            {tabLabel(tab)}
          </header>}
          <main className={tab === "application" ? "flex min-h-0 flex-1 flex-col overflow-hidden p-4" : "min-h-0 flex-1 overflow-auto p-4"}>
            {body}
          </main>
        </ContentSurface>
            </div>
            {settingsVisited.current ? <div className="flex min-h-0 min-w-0 flex-1" hidden={tab !== "settings"} style={tab === "settings" ? undefined : { display: "none" }}>
              <SettingsPane key={`${session.tenantId}:${session.tenantPrincipalId}:${session.platformSessionId}`} active={tab === "settings"} onClose={() => settingsReturn.current()} />
            </div> : null}
          </div>
        </SidebarProvider>
      </div>
    </div>
  );
}
