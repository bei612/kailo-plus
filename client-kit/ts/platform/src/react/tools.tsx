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
import { AddConnectorDialog, CallPolicyBadge, ExternalBadge, RiskBadge } from "./connectors";
import { useBffClient, useT } from "./context";
import { Badge, Button, Cell, Notice, Table, ReadFailure } from "./ui";
import { useLoad } from "./use-load";

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

export function ToolManagement() {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const [adding, setAdding] = useState(false);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`platform-tools:${offset}`, () => client.platformTools(offset));
  const page = state.status === "ok" && validPlatformToolPage(state.data, offset) ? state.data : null;
  const groups = page ? groupTools(page.tools) : null;
  const status = (tool: PlatformToolView) => <Badge tone="neutral">{t(tool.status !== "ACTIVE" || tool.resourceState !== "ACTIVE" ? "agents.tools.provisioning"
    : tool.canConsume ? "agents.tools.available" : "agents.tools.unavailable")}</Badge>;
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="platform-tools">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-medium">{t("agents.tools.title")}</h2>
      <Button onClick={() => setAdding(true)} data-testid="platform-tools-add-connector">{t("connectors.add")}</Button>
    </div>
    <p className="text-sm text-muted-foreground">{t("agents.tools.boundary")}</p>
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    <AddConnectorDialog open={adding} onClose={() => setAdding(false)} onCreated={reload} />
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page || !groups ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {page.tools.length === 0 ? <Notice>{t("agents.tools.none")}</Notice> : <>
          {groups.native.length ? <div className="overflow-x-auto"><Table head={[t("agents.name"), t("agents.owner"), t("agents.resourceVersion"), t("platform.state")]}>
            {groups.native.map((tool) => <tr key={tool.resourceId}>
              <Cell><p>{tool.name}</p><p className="break-all font-mono text-xs">{tool.resourceId}</p></Cell>
              <Cell mono>{tool.ownerPrincipalId}</Cell><Cell>{tool.resourceVersion}</Cell>
              <Cell>{status(tool)}</Cell>
            </tr>)}
          </Table></div> : null}
          {groups.connectors.map((group) => <div key={group.connectionId} className="flex flex-col gap-2" data-testid="platform-tools-connector">
            <ConnectorGroupHeading group={group} />
            <div className="overflow-x-auto"><Table head={[t("agents.name"), t("connectors.tools.description"), t("connectors.tools.risk"), t("connectors.tools.policy"), t("platform.state")]}>
              {group.tools.map((tool) => <tr key={tool.resourceId} data-testid="platform-tool-connector-row">
                <Cell><p className="break-words">{tool.connector?.title ?? tool.connector?.upstreamName}</p>
                  <p className="break-all font-mono text-xs">{tool.name}</p></Cell>
                <Cell>{tool.connector?.description ? <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  <span className="font-medium">{t("connectors.providedByService")}</span> {tool.connector.description}</p> : "—"}</Cell>
                <Cell>{tool.connector ? <RiskBadge risk={tool.connector.risk} /> : null}</Cell>
                <Cell>{tool.connector ? <CallPolicyBadge policy={tool.connector.callPolicy} /> : null}</Cell>
                <Cell>{status(tool)}</Cell>
              </tr>)}
            </Table></div>
          </div>)}
        </>}
        <div className="flex flex-wrap gap-2">
          {index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
          {page.nextOffset != null ? <Button onClick={() => {
            setOffsets((old) => [...old.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
      </>}
  </section>;
}
