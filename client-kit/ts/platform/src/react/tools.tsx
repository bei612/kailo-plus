// DD-24/49/105：两端共享的只读 Catalog 消费者。引用不产生调用授权。
import type { PlatformToolPage, PlatformToolView } from "@client-kit/contracts";
import { useState } from "react";
import { useBffClient, useT } from "./context";
import { Badge, Button, Cell, Notice, Table, ReadFailure } from "./ui";
import { useLoad } from "./use-load";

function validToolName(name: unknown): boolean {
  return name === "agent.memory.entry.list" || name === "agent.memory.entry.read";
}

export function validPlatformToolPage(page: PlatformToolPage, offset: number): boolean {
  return !!page
    && (page.nextOffset == null || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > offset))
    && Array.isArray(page.tools) && new Set(page.tools.map((tool) => tool?.resourceId)).size === page.tools.length
    && page.tools.every((tool) => !!tool
      && [tool.resourceId, tool.ownerPrincipalId].every((value) => typeof value === "string" && !!value)
      && Number.isSafeInteger(tool.resourceVersion) && tool.resourceVersion > 0
      && validToolName(tool.name) && tool.actionKey === tool.name && tool.source === "PLATFORM_NATIVE"
      && (tool.status === "PROVISIONING" || tool.status === "ACTIVE")
      && (tool.resourceState === "PROVISIONING" || tool.resourceState === "ACTIVE")
      && [tool.inputSchemaHash, tool.outputSchemaHash].every((value) => typeof value === "string" && /^[0-9a-f]{64}$/.test(value))
      && typeof tool.canConsume === "boolean"
      && (!tool.canConsume || (tool.status === "ACTIVE" && tool.resourceState === "ACTIVE")));
}

export function selectableTool(tool: PlatformToolView): boolean {
  return tool.status === "ACTIVE" && tool.resourceState === "ACTIVE" && tool.canConsume;
}

export function ToolManagement() {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`platform-tools:${offset}`, () => client.platformTools(offset));
  const page = state.status === "ok" && validPlatformToolPage(state.data, offset) ? state.data : null;
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="platform-tools">
    <h2 className="font-medium">{t("agents.tools.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("agents.tools.boundary")}</p>
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {page.tools.length === 0 ? <Notice>{t("agents.tools.none")}</Notice>
          : <div className="overflow-x-auto"><Table head={[t("agents.name"), t("agents.owner"), t("agents.resourceVersion"), t("platform.state")]}>
            {page.tools.map((tool) => <tr key={tool.resourceId}>
              <Cell><p>{tool.name}</p><p className="break-all font-mono text-xs">{tool.resourceId}</p></Cell>
              <Cell mono>{tool.ownerPrincipalId}</Cell><Cell>{tool.resourceVersion}</Cell>
              <Cell><Badge tone="neutral">{t(tool.status !== "ACTIVE" || tool.resourceState !== "ACTIVE" ? "agents.tools.provisioning"
                : tool.canConsume ? "agents.tools.available" : "agents.tools.unavailable")}</Badge></Cell>
            </tr>)}
          </Table></div>}
        <div className="flex flex-wrap gap-2">
          {index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
          {page.nextOffset != null ? <Button onClick={() => {
            setOffsets((old) => [...old.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
      </>}
  </section>;
}
