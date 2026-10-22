// DD-134 网关管理区：Web 与 Desktop 渲染同一份页面。全部读取经 BFF（Core 以 service 凭据读
// Gateway 并打码），不嵌入、链接或代理 AgentGateway 原生 UI 与 admin API；修改只提交既有
// Governed Action。分区由 GET /api/v1/gateway/access 决定是否呈现，授权仍在服务端逐次重做。

import { GatewayAdminScope, type GatewayAccess, type WorkspaceView } from "@client-kit/contracts";
import { useState } from "react";
import type { PlatformMessageKey } from "../i18n";
import { useBffClient, useT } from "./context";
import { ConfigSection } from "./gateway-config";
import { gatewayAccessUsable } from "./gateway-entry";
import { McpBindingSection, McpWizard } from "./gateway-mcp";
import { ModelRoutesSection } from "./gateway-routes";
import { gatewayRange, GatewayLoad, type GatewayWindow, WindowSelect } from "./gateway-shared";
import { CallsSection, StatsSection, type StatsFilter, WorkspaceScope } from "./gateway-stats";
import { ToolsSection } from "./gateway-tools";
import { Button, Notice } from "./ui";
import { useLoad } from "./use-load";

export type GatewayTab = "stats" | "calls" | "tools" | "routes" | "config";

const tabLabel: Record<GatewayTab, PlatformMessageKey> = {
  stats: "gateway.tab.stats",
  calls: "gateway.tab.calls",
  tools: "gateway.tab.tools",
  routes: "gateway.tab.routes",
  config: "gateway.tab.config",
};

/** 本会话可见的分区；平台范围不出现工具与模型路由（它们是业务 Tenant 的事实，REQ-09）。 */
export function gatewayTabs(access: GatewayAccess): GatewayTab[] {
  const platform = access.scope === GatewayAdminScope.Platform;
  const tabs: GatewayTab[] = [];
  if (access.canReadStats) tabs.push("stats", "calls");
  if (platform ? access.canManageMcp : access.canReadTools || access.canBindMcp) tabs.push("tools");
  if (!platform && (access.canReadModelRoutes || access.canCreateModelRoute)) tabs.push("routes");
  if (platform && access.canReadConfig) tabs.push("config");
  return tabs;
}

function GatewayBody({ access }: { access: GatewayAccess }) {
  const client = useBffClient();
  const t = useT();
  const tabs = gatewayTabs(access);
  const [tab, setTab] = useState<GatewayTab>(tabs[0] ?? "stats");
  const [period, setPeriod] = useState<GatewayWindow>("day");
  const [at, setAt] = useState(() => Date.now());
  const [workspaceId, setWorkspaceId] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<StatsFilter | null>(null);
  const tenant = access.scope === GatewayAdminScope.Tenant;
  const [workspaceState, reloadWorkspaces] = useLoad(`gateway-workspaces:${access.scope}`,
    (): Promise<WorkspaceView[]> => tenant ? client.workspaces() : Promise.resolve([]));
  const workspaces = workspaceState.status === "ok" && Array.isArray(workspaceState.data) ? workspaceState.data : [];
  const { from, to } = gatewayRange(period, at);
  if (!tabs.length) return <Notice role="alert">{t("gateway.denied")}</Notice>;
  const current = tabs.includes(tab) ? tab : tabs[0]!;
  return <div className="flex flex-col gap-4">
    <p className="text-xs text-muted-foreground">{t(tenant ? "gateway.scope.tenant" : "gateway.scope.platform")}</p>
    <div role="tablist" aria-label={t("platform.tab.gateway")} className="flex flex-wrap gap-1 border-b pb-2">
      {tabs.map((item) => <button key={item} type="button" role="tab" aria-selected={current === item}
        data-testid={`gateway-tab-${item}`}
        className={`rounded-md px-3 py-1 text-sm ${current === item ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
        onClick={() => setTab(item)}>{t(tabLabel[item])}</button>)}
    </div>
    {current === "stats" || current === "calls" || current === "tools" || current === "routes" ? <div className="flex flex-wrap items-center gap-2">
      {tenant && (current === "stats" || current === "calls") ? <WorkspaceScope scope={workspaceId} onChange={setWorkspaceId}
        workspaces={workspaces} workspacesFailed={workspaceState.status === "error"} reloadWorkspaces={reloadWorkspaces} /> : null}
      <WindowSelect value={period} onChange={setPeriod} />
      <Button onClick={() => setAt(Date.now())}>{t("gateway.window.now")}</Button>
    </div> : null}
    {current === "stats" ? <StatsSection scope={access.scope} from={from} to={to} workspaceId={tenant ? workspaceId : undefined}
      onDrill={(next) => { setFilter(next); setTab("calls"); }} /> : null}
    {current === "calls" ? <CallsSection scope={access.scope} from={from} to={to} workspaceId={tenant ? workspaceId : undefined}
      filter={filter} onClearFilter={() => setFilter(null)} /> : null}
    {current === "tools" ? tenant ? <div className="flex flex-col gap-6">
      {access.canReadTools ? <ToolsSection from={from} to={to} /> : null}
      {access.canBindMcp ? <McpBindingSection tenantId={access.tenantId} workspaces={workspaces} onBound={() => setAt(Date.now())} /> : null}
    </div> : <McpWizard /> : null}
    {current === "routes" ? <ModelRoutesSection from={from} to={to} workspaces={workspaces} /> : null}
    {current === "config" ? <ConfigSection /> : null}
  </div>;
}

/** 「网关」页：先读本会话的分区可用性，再按范围呈现。 */
export function GatewayPage() {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("gateway-access", () => client.gatewayAccess());
  return <div className="flex flex-col gap-4" data-testid="gateway-page">
    <p className="text-xs text-muted-foreground">{t("gateway.explain")}</p>
    <GatewayLoad state={state} reload={reload}>{(access: GatewayAccess) => gatewayAccessUsable(access)
      ? <GatewayBody key={`${access.scope}:${access.tenantId}`} access={access} />
      : <Notice role="alert">{t("gateway.denied")}</Notice>}</GatewayLoad>
  </div>;
}
