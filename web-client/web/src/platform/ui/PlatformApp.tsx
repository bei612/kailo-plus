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

import { type PlatformSessionView, ReasonCode } from "@client-kit/contracts";
import { PlatformProvider } from "@client-kit/platform/react/context";
import { ApprovalsPage, TasksPage } from "@client-kit/platform/react/governance";
import { RedemptionProgress, TenantInvitations } from "@client-kit/platform/react/invitations";
import {
  PlatformNavigation,
  type PlatformNavigationSection,
} from "@client-kit/platform/react/navigation";
import { AuditPage, DevicesPage, MembersPane } from "@client-kit/platform/react/pages";
import { LegacySecretRefManagement, RoleManagement } from "@client-kit/platform/react/roles";
import { ContentSurface, GradientLayer } from "@client-kit/platform/react/surfaces";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BellOff,
  ClipboardCheck,
  Hash,
  History,
  ListChecks,
  MonitorSmartphone,
  Star,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BffError, bff, setWorkspacePreference, signOut } from "@/platform/bff-client";
import { ChannelPane } from "@/platform/ui/ChannelPane";
import { platformQueries } from "@/platform/ui/queries";
import { getLocale, t } from "@/shared/i18n";
import { Button } from "@/shared/ui/button";

type Tab = "channel" | PlatformNavigationSection;

/** 会话解析失败即什么都不渲染：没有身份就没有任何页面可看（fail closed）。 */
export function PlatformApp() {
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
    <PlatformProvider client={bff} locale={getLocale()}>
      <SignedIn session={session} />
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
  const queryClient = useQueryClient();
  const workspaces = useQuery(platformQueries.workspaces);
  const userState = useQuery(platformQueries.userState);
  const [chosen, setChosen] = useState<string | null>(
    // 未选定 Workspace 时 Core 省略该字段（contracts 的可选字段一律缺省而非 null）
    session.currentWorkspaceId ?? null,
  );
  const [tab, setTab] = useState<Tab>("channel");

  // 收藏的排在前面；其余保持服务端顺序
  const prefs = userState.data?.workspacePreferences ?? {};
  const rows = [...(workspaces.data ?? [])].sort(
    (a, b) => Number(prefs[b.id]?.starred ?? false) - Number(prefs[a.id]?.starred ?? false),
  );
  // 只认列表里的：列表已经排除了进不去的。会话里记着的 Workspace 若已不在
  // 列表中（例如已被撤权），不能继续对着它发请求。
  const active = rows.find((w) => w.id === chosen)?.id ?? rows[0]?.id ?? null;
  const pref = active ? prefs[active] : undefined;

  const preference = useMutation({
    mutationFn: (next: { starred: boolean; muted: boolean }) =>
      // 版本不符即冲突（别的端先改了）；重新取状态后由用户再决定，不自动覆盖
      setWorkspacePreference(active as string, { ...next, version: userState.data?.version ?? 0 }),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: platformQueries.userState.queryKey }),
  });

  const onSignOut = useCallback(() => void signOut(), []);

  const tabLabel = (name: Tab) =>
    ({
      channel: t("platform.tab.channel"),
      members: t("platform.tab.members"),
      tasks: t("platform.tab.tasks"),
      approvals: t("platform.tab.approvals"),
      devices: t("platform.tab.devices"),
      audit: t("platform.tab.audit"),
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
    <ChannelPane key={active} workspaceId={active} myPrincipalId={session.tenantPrincipalId} />
  ) : (
    <MembersPane key={active} workspaceId={active} />
  );
  const body =
    tab === "tasks" ? (
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
        <RoleManagement />
        <LegacySecretRefManagement />
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
              selectedSection={tab === "channel" ? null : tab}
              onSelectSection={setTab}
              icons={{
                members: <Users className="h-4 w-4" />,
                tasks: <ListChecks className="h-4 w-4" />,
                approvals: <ClipboardCheck className="h-4 w-4" />,
                audit: <History className="h-4 w-4" />,
                devices: <MonitorSmartphone className="h-4 w-4" />,
              }}
              firstRow={
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
              }
            />
          </nav>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-3 py-2">
            {/* 没有可进入的 Workspace 就不画选择器：一个空下拉框什么也选不了 */}
            {rows.length > 0 ? (
              <select
                aria-label={t("platform.workspace")}
                className="h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2"
                value={active ?? ""}
                onChange={(e) => setChosen(e.target.value || null)}
              >
                {rows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {prefs[w.id]?.starred ? `★ ${w.name}` : w.name}
                  </option>
                ))}
              </select>
            ) : null}
            {active && userState.isSuccess ? (
              <div className="flex items-center gap-1">
                <Button
                  aria-label={t("platform.star")}
                  aria-pressed={pref?.starred ?? false}
                  disabled={preference.isPending}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    preference.mutate({
                      starred: !(pref?.starred ?? false),
                      muted: pref?.muted ?? false,
                    })
                  }
                >
                  <Star className={pref?.starred ? "fill-current" : undefined} />
                </Button>
                <Button
                  aria-label={t("platform.mute")}
                  aria-pressed={pref?.muted ?? false}
                  disabled={preference.isPending}
                  size="icon"
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    preference.mutate({
                      starred: pref?.starred ?? false,
                      muted: !(pref?.muted ?? false),
                    })
                  }
                >
                  <BellOff className={pref?.muted ? undefined : "opacity-40"} />
                </Button>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2 p-3">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {session.displayName}
            </span>
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
    </div>
  );
}
