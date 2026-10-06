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
  type ConversationView,
  ReasonCode,
} from "@client-kit/contracts";
import { PlatformProvider } from "@client-kit/platform/react/context";
import type { ParsedMessageLink } from "@client-kit/platform/react/composer/features/messages/lib/messageLink";
import { CreateChannelDialog } from "@client-kit/platform/react/create-channel-dialog";
import { ConversationList, useConversations } from "@client-kit/platform/react/new-message";
import { useSettingsShortcuts } from "@client-kit/platform/react/use-settings-shortcuts";
import { ProtocolDocumentBridge } from "@client-kit/platform/react/protocol-document-bridge";
import {
  ApprovalsPage,
  LifecycleRestrictedView,
  TasksPage,
} from "@client-kit/platform/react/governance";
import { WorkflowsPage } from "@client-kit/platform/react/workflows";
import { RedemptionProgress, TenantInvitations } from "@client-kit/platform/react/invitations";
import {
  PlatformNavigation,
  type PlatformNavigationSection,
} from "@client-kit/platform/react/navigation";
import {
  AgentDefinitionsPage,
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
import {
  Bot,
  ClipboardCheck,
  Hash,
  Inbox,
  History,
  ListChecks,
  MonitorSmartphone,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BffError, bff, setWorkspacePreference, signOut } from "@/platform/bff-client";
import { ChannelPane } from "@/platform/ui/ChannelPane";
import { InboxPane } from "@/platform/ui/InboxPane";
import { SettingsPane } from "@/platform/ui/SettingsPane";
import { NewMessagePage } from "./NewMessagePage";
import { translate } from "@client-kit/platform/i18n";
import { platformQueries } from "@/platform/ui/queries";
import { getLocale, t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";
import { useTheme } from "@/shared/theme/ThemeProvider";

type Tab = "channel" | "inbox" | "settings" | "new-message" | "conversation" | PlatformNavigationSection;

/** 会话解析失败即什么都不渲染：没有身份就没有任何页面可看（fail closed）。 */
export function PlatformApp() {
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
      <PlatformProvider client={bff} locale={getLocale()}>
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
    <PlatformProvider client={bff} locale={getLocale()} documentTheme={isDark ? "DARK" : "LIGHT"}>
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
        <SignedIn session={session} />
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
  const workspaces = useQuery(platformQueries.workspaces);
  const userState = useInboxState(bff);
  const conversations = useConversations();
  const [chosenConversation, setChosenConversation] = useState<ConversationView | null>(null);
  const [messageTarget, setMessageTarget] = useState<ParsedMessageLink | null>(null);
  const [messageLinkProblem, setMessageLinkProblem] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(
    // 未选定 Workspace 时 Core 省略该字段（contracts 的可选字段一律缺省而非 null）
    session.currentWorkspaceId ?? null,
  );
  const [tab, setTab] = useState<Tab>("channel");
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const settingsReturnTab = useRef<Tab>("channel");
  useEffect(() => {
    if (tab !== "settings") settingsReturnTab.current = tab;
  }, [tab]);
  useSettingsShortcuts({
    open: tab === "settings",
    onOpenSettings: useCallback(() => setTab("settings"), []),
    onClose: useCallback(() => setTab(settingsReturnTab.current), []),
  });

  const rows = workspaces.isError ? [] : workspaces.data ?? [];
  // Only use fresh admitted directory rows; a revoked previous selection cannot remain active.
  const active = rows.find((workspace) => workspace.id === chosen)?.id ?? rows[0]?.id ?? null;
  const openMessageLink = (link: ParsedMessageLink) => {
    if (!rows.some((workspace) => workspace.id === link.channelId)) {
      setMessageLinkProblem(t("platform.linkChannelUnavailable"));
      return;
    }
    setMessageLinkProblem(null);
    setMessageTarget(link);
    setChosen(link.channelId);
    setTab("channel");
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

  const tabLabel = (name: Tab) =>
    ({
      channel: t("platform.tab.channel"),
      "new-message": translate(getLocale(), "sidebar.newMessage"),
      conversation: translate(getLocale(), "sidebar.messages"),
      inbox: translate(getLocale(), "inbox.title"),
      members: t("platform.tab.members"),
      agents: t("platform.tab.agents"),
      workflows: translate(getLocale(), "platform.tab.workflows"),
      tasks: t("platform.tab.tasks"),
      approvals: t("platform.tab.approvals"),
      devices: t("platform.tab.devices"),
      audit: t("platform.tab.audit"),
      settings: translate(getLocale(), "platform.settings.title"),
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
    <><p role="status">{messageLinkProblem}</p><ChannelPane key={active} workspaceId={active} myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh}
      onOpenMessageLink={openMessageLink} targetMessageId={messageTarget?.channelId === active ? messageTarget.messageId : undefined} /></>
  ) : (
    <MembersPane key={active} workspaceId={active} />
  );
  const body =
    tab === "new-message" ? (
      <NewMessagePage currentPrincipalId={session.tenantPrincipalId} onConversationOpened={(conversation) => {
        setChosenConversation(conversation);
        setTab("conversation");
        void conversations.reload().catch(() => undefined);
      }} />
    ) : tab === "conversation" ? (
      chosenConversation ? <ChannelPane key={chosenConversation.id} workspaceId={chosenConversation.id} conversation={chosenConversation}
        onOpenMessageLink={openMessageLink}
        myPrincipalId={session.tenantPrincipalId} onReadStateChanged={userState.refresh} /> : <Notice text={t("platform.loadFailed")} />
    ) : tab === "settings" ? (
      <SettingsPane />
    ) : tab === "inbox" ? (
      <InboxPane
        principalId={session.tenantPrincipalId}
        onOpen={(workspaceId) => {
          setChosen(workspaceId);
          setTab("channel");
        }}
      />
    ) : tab === "agents" ? (
      <AgentDefinitionsPage />
    ) : tab === "workflows" ? (
      <WorkflowsPage />
    ) : tab === "tasks" ? (
      <TasksPage />
    ) : tab === "approvals" ? (
      <ApprovalsPage />
    ) : tab === "audit" ? (
      <AuditPage />
    ) : tab === "devices" ? (
      <DevicesPage />
    ) : tab === "members" ? (
      // 邀请属于 Tenant：只对 admin 出现（由邀请列表的 403 决定），不依赖 Workspace
      <div className="flex flex-col gap-6">
        {workspaceBody}
        <WorkspaceManagementPanels />
        <TenantInvitations />
      </div>
    ) : (
      workspaceBody
    );

  return (
    <div className="relative isolate flex h-dvh flex-col overflow-hidden bg-sidebar text-sm">
      <GradientLayer />
      <div className="relative z-10 flex h-9 shrink-0 items-center px-4 font-semibold">
        {t("platform.title")}
      </div>
      <div className="flex min-h-0 flex-1">
        <aside
          aria-label={t("platform.title")}
          className="relative z-10 flex w-[300px] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
          data-testid="app-sidebar"
        >
          <nav
            aria-label={t("platform.title")}
            className="shrink-0 px-2"
            data-testid="sidebar-primary-menu"
          >
            <PlatformNavigation
              locale={getLocale()}
              selectedSection={
                tab === "channel" || tab === "inbox" || tab === "settings" || tab === "new-message" || tab === "conversation" ? null : tab
              }
              onSelectSection={setTab}
              icons={{
                members: <Users className="h-4 w-4" />,
                agents: <Bot className="h-4 w-4" />,
                workflows: <Workflow className="h-4 w-4" />,
                tasks: <ListChecks className="h-4 w-4" />,
                approvals: <ClipboardCheck className="h-4 w-4" />,
                audit: <History className="h-4 w-4" />,
                devices: <MonitorSmartphone className="h-4 w-4" />,
              }}
              firstRow={
                <>
                  <li className="group/menu-item relative" data-sidebar="menu-item">
                    <Button
                      aria-pressed={tab === "inbox"}
                      className="h-8 w-full justify-start gap-2 text-left font-normal"
                      data-testid="sidebar-inbox"
                      data-sidebar="menu-button"
                      data-active={tab === "inbox"}
                      size="sm"
                      type="button"
                      variant={tab === "inbox" ? "secondary" : "ghost"}
                      onClick={() => setTab("inbox")}
                    >
                      <Inbox className="h-4 w-4" />
                      {translate(getLocale(), "inbox.title")}
                    </Button>
                  </li>
                  <li className="group/menu-item relative" data-sidebar="menu-item">
                    <Button
                      aria-pressed={tab === "channel"}
                      className="h-8 w-full justify-start gap-2 text-left font-normal"
                      data-testid="sidebar-channel"
                      data-sidebar="menu-button"
                      data-active={tab === "channel"}
                      size="sm"
                      type="button"
                      variant={tab === "channel" ? "secondary" : "ghost"}
                      onClick={() => setTab("channel")}
                    >
                      <Hash className="h-4 w-4" />
                      {t("platform.tab.channel")}
                    </Button>
                  </li>
                </>
              }
            />
          </nav>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 py-2">
            <ConversationList currentPrincipalId={session.tenantPrincipalId} items={conversations.items} loading={conversations.loading}
              error={conversations.error} selectedId={tab === "conversation" ? chosenConversation?.id ?? null : null}
              onNewMessage={() => setTab("new-message")} onReload={() => { void conversations.reload().catch(() => undefined); }}
              onSelect={(conversation) => { setChosenConversation(conversation); setTab("conversation"); }} />
            <ChannelSidebar principalId={session.tenantPrincipalId} workspaces={rows} selectedId={active} active={tab === "channel"}
              reads={userState} preferencePending={preference.isPending || preferenceUnknown}
              onSelect={(id) => { setChosen(id); setTab("channel"); }}
              onCreate={() => setCreateChannelOpen(true)}
              onSetPreference={(id, value) => {
                if (userState.state) preference.mutate({ id, ...value, version: userState.state.version });
              }} />
            {preference.isError ? <p role="alert" className="px-4 text-sm">
              {preferenceUnknown ? translate(getLocale(), "sidebar.preferenceUnknown") : t("platform.loadFailed")}
              <Button size="sm" onClick={() => void userState.refresh()}>{t("platform.retry")}</Button>
            </p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 p-3">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {session.displayName}
            </span>
            <Button
              size="icon"
              type="button"
              variant="ghost"
              aria-label={translate(getLocale(), "platform.settings.title")}
              aria-pressed={tab === "settings"}
              data-testid="sidebar-settings"
              onClick={() => setTab("settings")}
            >
              <Settings className="h-4 w-4" />
            </Button>
            <Button size="sm" type="button" variant="outline" onClick={onSignOut}>
              {t("platform.signOut")}
            </Button>
          </div>
        </aside>
        <ContentSurface>
          <header className="flex h-12 shrink-0 items-center border-b px-4 font-semibold">
            {tabLabel(tab)}
          </header>
          <main className="min-h-0 flex-1 overflow-auto p-4">{body}</main>
        </ContentSurface>
      </div>
      <CreateChannelDialog open={createChannelOpen} onOpenChange={setCreateChannelOpen} />
    </div>
  );
}
