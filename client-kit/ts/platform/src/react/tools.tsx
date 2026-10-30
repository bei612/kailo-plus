// DD-24/49/105：两端共享的只读 Catalog 消费者。引用不产生调用授权。
// DD-149：目录同时列出本人可发现的连接器工具（按连接器分组、标注“外部”、风险与调用策略）；
// 顶部“添加连接器”打开设置「连接器」的同一面板。
import {
  McpConnectionState,
  McpConnectionVisibility,
  McpToolCallPolicy,
  McpToolRisk,
  type PlatformToolPage,
  type PlatformToolView,
} from "@client-kit/contracts";
import { useState } from "react";
import { Plus, Wrench } from "lucide-react";
import { AddConnectorDialog, CallPolicyBadge, ExternalBadge, RiskBadge } from "./connectors";
import { useBffClient, useT } from "./context";
import { Badge, CellStack, DataTable, EmptyState, ErrorState, IdText, PageSection, RefreshButton, TableSkeleton, type DataColumn } from "./ui";
import { useOffsetCollection } from "./use-offset-collection";
import { TransportError } from "../transport";
import { Button as WorkflowButton } from "./profile/buzz/shared/ui/button";

// DD-140 (1): the closed platform native tool name → action key map.
const NATIVE_TOOL_ACTIONS: Readonly<Record<string, string>> = {
  "agent.memory.entry.list": "agent.memory.entry.list",
  "agent.memory.entry.read": "agent.memory.entry.read",
  project_channel_request: "workspace.create",
};
// DD-149 (7)(8): a connector tool's action key is the sub-action of its frozen call policy.
const CONNECTOR_TOOL_ACTIONS: Readonly<Record<string, string>> = {
  [McpToolCallPolicy.Auto]: "mcp_connection.tool.invoke",
  [McpToolCallPolicy.Confirm]: "mcp_connection.tool.invoke_confirmed",
  [McpToolCallPolicy.Approval]: "mcp_connection.tool.invoke_approved",
};
function validToolName(name: unknown): boolean {
  return typeof name === "string" && Object.hasOwn(NATIVE_TOOL_ACTIONS, name);
}
const nonEmpty = (value: unknown) => typeof value === "string" && !!value;
const optionalString = (value: unknown) => value === undefined || typeof value === "string";
const inEnum = (values: object, value: unknown) => (Object.values(values) as unknown[]).includes(value);

/** Native tools keep the closed map; connector tools carry their connector and a policy-matched sub-action. */
function validToolIdentity(tool: PlatformToolView): boolean {
  if (tool.source === "PLATFORM_NATIVE")
    return tool.connector === undefined && validToolName(tool.name) && tool.actionKey === NATIVE_TOOL_ACTIONS[tool.name];
  if (tool.source !== "USER_REGISTERED_EXTERNAL") return false;
  const connector = tool.connector;
  return !!connector && [connector.connectionId, connector.connectionName, connector.upstreamName].every(nonEmpty)
    && optionalString(connector.title) && optionalString(connector.description)
    && inEnum(McpToolRisk, connector.risk) && inEnum(McpToolCallPolicy, connector.callPolicy)
    && inEnum(McpConnectionState, connector.connectionState) && inEnum(McpConnectionVisibility, connector.visibility)
    && (connector.callPolicy !== McpToolCallPolicy.Auto || connector.risk === McpToolRisk.ReadOnly)
    && tool.actionKey === CONNECTOR_TOOL_ACTIONS[connector.callPolicy]
    && typeof tool.name === "string" && tool.name.length > connector.upstreamName.length + 2
    && tool.name.endsWith(`__${connector.upstreamName}`)
    && (!tool.canConsume || connector.connectionState === McpConnectionState.Active);
}

export function validPlatformToolPage(page: PlatformToolPage, offset: number): boolean {
  return !!page
    && (page.nextOffset == null || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > offset))
    && Array.isArray(page.tools) && new Set(page.tools.map((tool) => tool?.resourceId)).size === page.tools.length
    && page.tools.every((tool) => !!tool
      && [tool.resourceId, tool.ownerPrincipalId].every((value) => typeof value === "string" && !!value)
      && Number.isSafeInteger(tool.resourceVersion) && tool.resourceVersion > 0
      && validToolIdentity(tool)
      && (tool.status === "PROVISIONING" || tool.status === "ACTIVE")
      && (tool.resourceState === "PROVISIONING" || tool.resourceState === "ACTIVE")
      && [tool.inputSchemaHash, tool.outputSchemaHash].every((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))
      && typeof tool.canConsume === "boolean"
      && (!tool.canConsume || (tool.status === "ACTIVE" && tool.resourceState === "ACTIVE")));
}

/** A disabled connector's tools are not selectable (DD-149 (10)). */
export function selectableTool(tool: PlatformToolView): boolean {
  return tool.status === "ACTIVE" && tool.resourceState === "ACTIVE" && tool.canConsume
    && (tool.source !== "USER_REGISTERED_EXTERNAL" || tool.connector?.connectionState === McpConnectionState.Active);
}

export type ConnectorToolGroup = { connectionId: string; connectionName: string; connectionState: McpConnectionState; tools: PlatformToolView[] };

/** Native tools first; connector tools grouped by connector in first-seen order. */
export function groupTools(tools: PlatformToolView[]): { native: PlatformToolView[]; connectors: ConnectorToolGroup[] } {
  const native: PlatformToolView[] = [];
  const groups = new Map<string, ConnectorToolGroup>();
  for (const tool of tools) {
    const connector = tool.source === "USER_REGISTERED_EXTERNAL" ? tool.connector : undefined;
    if (!connector) { native.push(tool); continue; }
    const group = groups.get(connector.connectionId)
      ?? { connectionId: connector.connectionId, connectionName: connector.connectionName, connectionState: connector.connectionState, tools: [] };
    group.tools.push(tool);
    groups.set(connector.connectionId, group);
  }
  return { native, connectors: [...groups.values()] };
}

/** One connector's heading: its name, the “External” mark and a disabled state. */
export function ConnectorGroupHeading({ group }: { group: ConnectorToolGroup }) {
  const t = useT();
  return <p className="flex flex-wrap items-center gap-2 font-medium">
    <span className="break-words">{group.connectionName}</span><ExternalBadge />
    {group.connectionState !== McpConnectionState.Active ? <Badge tone="neutral">{t("connectors.state.disabled")}</Badge> : null}
  </p>;
}

// DD-170 (.design/20 §16.2): the catalog is one table — tool, source, description, risk, how it is
// called and its state — read to its end (bounded) and paged locally. Identifiers are secondary.
export function ToolManagement() {
  const client = useBffClient();
  const t = useT();
  const [adding, setAdding] = useState(false);
  const { state, reload, loadMore } = useOffsetCollection<PlatformToolView>("platform-tools", async (offset) => {
    const page = await client.platformTools(offset);
    if (!validPlatformToolPage(page, offset)) throw new TransportError(t("platform.loadFailed"));
    return { items: page.tools, nextOffset: page.nextOffset ?? undefined };
  });
  const collection = state.status === "ok" ? state.data : null;
  const tools = collection && new Set(collection.items.map((tool) => tool.resourceId)).size === collection.items.length ? collection.items : null;
  const status = (tool: PlatformToolView) => {
    const pending = tool.status !== "ACTIVE" || tool.resourceState !== "ACTIVE";
    return <Badge tone={pending ? "info" : tool.canConsume ? "positive" : "neutral"}>{t(pending ? "tools.ui.status.pending"
      : tool.canConsume ? "tools.ui.status.available" : "tools.ui.status.unavailable")}</Badge>;
  };
  const columns: DataColumn<PlatformToolView>[] = [
    { key: "name", header: t("tools.ui.col.tool"), width: "26%", sortValue: (tool) => tool.connector?.title ?? tool.name, cell: (tool) =>
      <CellStack primary={tool.connector ? tool.connector.title ?? tool.connector.upstreamName : tool.name}
        secondary={<IdText value={tool.connector ? tool.name : tool.resourceId} label={t("tools.ui.col.tool")} />} /> },
    { key: "source", header: t("tools.ui.col.source"), width: "16%", sortValue: (tool) => tool.connector?.connectionName ?? "", cell: (tool) => tool.connector
      ? <span className="flex min-w-0 flex-wrap items-center gap-1"><span className="truncate">{tool.connector.connectionName}</span><ExternalBadge /></span>
      : t("tools.ui.source.platform") },
    { key: "description", header: t("connectors.tools.description"), secondary: true, cell: (tool) => tool.connector?.description
      ? <span className="line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted-foreground" title={tool.connector.description}>
          <span className="font-medium">{t("connectors.providedByService")}</span> {tool.connector.description}</span>
      : <span className="text-muted-foreground">{t("tools.ui.noDescription")}</span> },
    { key: "risk", header: t("connectors.tools.risk"), width: "8rem", cell: (tool) => tool.connector ? <RiskBadge risk={tool.connector.risk} />
      : <span className="text-muted-foreground">{t("tools.ui.platformManaged")}</span> },
    { key: "policy", header: t("connectors.tools.policy"), width: "10rem", cell: (tool) => tool.connector ? <CallPolicyBadge policy={tool.connector.callPolicy} />
      : <span className="text-muted-foreground">{t("tools.ui.perCall")}</span> },
    { key: "state", header: t("platform.state"), width: "8.5rem", cell: status },
  ];
  return <section className="flex min-w-0 flex-col gap-4" data-testid="platform-tools">
    <PageSection title={t("tools.ui.title")} description={t("tools.ui.description")}
      actions={<><RefreshButton onClick={reload} pending={state.status === "pending"} />
        <WorkflowButton type="button" onClick={() => setAdding(true)} data-testid="platform-tools-add-connector"><Plus aria-hidden />{t("connectors.add")}</WorkflowButton></>}>
      {state.status === "pending" ? <TableSkeleton rows={4} columns={5} />
        : !tools ? <ErrorState error={state.status === "error" ? state.error : undefined} onRetry={reload} />
        : <DataTable rows={tools} rowKey={(tool) => tool.resourceId} label={t("tools.ui.title")} columns={columns}
            search={{ placeholder: t("tools.ui.search"), text: (tool) => [tool.name, tool.connector?.title, tool.connector?.connectionName, tool.connector?.description].join(" ") }}
            partial={collection && !collection.complete ? <>{t("list.partial", { count: String(tools.length) })}{" "}
              <button type="button" className="text-brand-text hover:underline" onClick={loadMore}>{t("list.loadMore")}</button></> : undefined}
            empty={<EmptyState icon={Wrench} title={t("tools.ui.emptyTitle")} description={t("tools.ui.emptyBody")} />} />}
    </PageSection>
    <AddConnectorDialog open={adding} onClose={() => setAdding(false)} onCreated={reload} />
  </section>;
}
