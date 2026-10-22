// DD-134(6) 工具列表与测试调用（Tenant 范围）。停用只作用于所属连接（既有
// application_binding.disable，影响该连接的全部工具）；PLATFORM_NATIVE 工具随平台固定，无启停入口。
// 测试调用以当前 HUMAN 提交该工具登记的 ActionDefinition（既有 componentAction 语义命令），
// 准入、审批、额度与审计全部在服务端；结果只按该动作冻结的暴露策略回给发起人本人。

import {
  AgentInstallationToolSource,
  ApplicationBindingState,
  type GatewayToolPage,
  type GatewayToolTestCall,
  type GatewayToolTestCallResult,
  type GatewayToolView,
} from "@client-kit/contracts";
import { useState } from "react";
import { canonicalJson } from "../gateway-drafts";
import { TransportError } from "../transport";
import { useBffClient, useT } from "./context";
import { GatewayActionPanel, useGatewayAction } from "./gateway-action";
import { GatewayLoad, GatewaySection, useDuration, useNumber } from "./gateway-shared";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

/** 由契约输入 schema 生成可编辑的 JSON 骨架（只取顶层 properties 的类型默认值）。 */
export function inputSkeleton(schemaJson: string): string {
  try {
    const schema = JSON.parse(schemaJson);
    const properties = schema && typeof schema === "object" && schema.properties && typeof schema.properties === "object"
      ? schema.properties as Record<string, { type?: unknown; default?: unknown }> : {};
    const value: Record<string, unknown> = {};
    for (const [name, property] of Object.entries(properties)) {
      value[name] = property?.default !== undefined ? property.default
        : property?.type === "integer" || property?.type === "number" ? 0
        : property?.type === "boolean" ? false
        : property?.type === "array" ? []
        : property?.type === "object" ? {} : "";
    }
    return JSON.stringify(value, null, 2);
  } catch { return "{}"; }
}

function TestCall({ tool, testCall, onClose }: { tool: GatewayToolView; testCall: GatewayToolTestCall; onClose: () => void }) {
  const t = useT();
  const client = useBffClient();
  const [outcome, setOutcome] = useState<GatewayToolTestCallResult | null>(null);
  const action = useGatewayAction(undefined, async (command) => {
    const reply = await client.gatewayToolTestCall(command);
    if (!reply || !reply.submission) throw new TransportError(t("platform.loadFailed"));
    setOutcome(reply);
    return reply.submission;
  });
  const [target, setTarget] = useState(testCall.targets[0]?.resourceId ?? "");
  const [input, setInput] = useState(() => inputSkeleton(testCall.inputSchemaJson));
  const [invalid, setInvalid] = useState(false);
  const chosen = testCall.targets.find((item) => item.resourceId === target);
  const prepare = () => {
    let parsed: unknown;
    try { parsed = JSON.parse(input); } catch { parsed = undefined; }
    const valid = !!chosen && !!parsed && typeof parsed === "object" && !Array.isArray(parsed);
    setInvalid(!valid);
    if (!valid || !chosen) return;
    action.prepare({
      actionKey: testCall.actionKey,
      resourceId: chosen.resourceId,
      resourceVersion: chosen.resourceVersion,
      ...(chosen.workspaceId ? { workspaceId: chosen.workspaceId } : {}),
      componentAction: {
        actionVersion: testCall.actionVersion,
        inputJson: canonicalJson(parsed),
        resultExposurePolicyId: testCall.resultExposurePolicyId,
        resultExposurePolicyVersion: testCall.resultExposurePolicyVersion,
      },
    }, "gateway.tools.testWarning");
  };
  return <div className="flex flex-col gap-2 rounded-md border p-3" data-testid="gateway-tool-test">
    <h3 className="text-sm font-medium">{t("gateway.tools.testTitle", { tool: tool.name })}</h3>
    <p className="text-xs text-muted-foreground">{t("gateway.tools.testExplain")}</p>
    {!testCall.targets.length ? <Notice>{t("gateway.tools.noTargets")}</Notice> : <>
      <label className="text-sm">{t("gateway.tools.target")}
        <select aria-label={t("gateway.tools.target")} className="ml-2 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={target} disabled={action.frozen} onChange={(event) => setTarget(event.target.value)}>
          {testCall.targets.map((item) => <option key={item.resourceId} value={item.resourceId}>{item.displayName}</option>)}
        </select>
      </label>
      <label className="text-sm">{t("gateway.tools.input")}
        <textarea className="min-h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" value={input}
          disabled={action.frozen} onChange={(event) => { setInput(event.target.value); setInvalid(false); }} />
      </label>
      {invalid ? <p role="alert">{t("gateway.tools.invalidInput")}</p> : null}
      <div className="flex gap-2">
        <Button disabled={action.frozen} onClick={prepare}>{t("gateway.tools.testPrepare")}</Button>
        {!action.frozen ? <Button onClick={onClose}>{t("platform.cancel")}</Button> : null}
      </div>
    </>}
    <TestCallResult action={action} outcome={outcome} />
  </div>;
}

/**
 * 测试调用的结果：回执经共用面板呈现（可打开任务）；结果正文只在本次回应中、按该动作冻结的
 * 暴露策略过滤后给发起人本人，Core 不保存；原生工具报错只显示“工具返回错误”，不含正文。
 */
export function TestCallResult({ action, outcome }: { action: ReturnType<typeof useGatewayAction>; outcome: GatewayToolTestCallResult | null }) {
  const t = useT();
  const current = outcome && action.submission && outcome.submission.actionExecutionId === action.submission.actionExecutionId ? outcome : null;
  return <div className="flex flex-col gap-2">
    <GatewayActionPanel action={action} testId="gateway-tool-test-result" />
    {current?.toolError ? <p role="alert" className="text-sm">{t("gateway.tools.toolError")}</p> : null}
    {current?.resultJson !== undefined ? <div className="flex flex-col gap-1" data-testid="gateway-tool-test-output">
      <p className="text-xs text-muted-foreground">{t("gateway.tools.resultExplain")}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border p-2 font-mono text-xs">{pretty(current.resultJson)}</pre>
    </div> : null}
  </div>;
}

function pretty(json: string): string {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

export function ToolsSection({ from, to }: { from: string; to: string }) {
  const client = useBffClient();
  const t = useT();
  const number = useNumber();
  const duration = useDuration();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`gateway-tools:${from}:${to}:${offset}`, () => client.gatewayTools(from, to, offset));
  const disable = useGatewayAction(() => reload());
  const [testing, setTesting] = useState<string | null>(null);
  return <GatewaySection title={t("gateway.tools.title")} testId="gateway-tools" description={t("gateway.tools.explain")}>
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    <GatewayActionPanel action={disable} testId="gateway-tools-action" />
    <GatewayLoad state={state} reload={reload}>{(page: GatewayToolPage) => <>
      {!page.tools.length ? <Notice>{t("gateway.tools.none")}</Notice> : <div className="overflow-x-auto">
        <Table head={[t("gateway.tools.name"), t("gateway.tools.source"), t("platform.state"), t("gateway.tools.binding"),
          t("gateway.tools.contract"), t("gateway.stats.requests"), t("gateway.tools.failedDenied"), t("gateway.tools.p95"), t("platform.action")]}>
          {page.tools.map((tool) => <tr key={tool.resourceId} data-testid="gateway-tool-row">
            <Cell title={tool.resourceId}>{tool.name}</Cell>
            <Cell>{t(tool.source === AgentInstallationToolSource.PlatformNative ? "gateway.tools.native" : "gateway.tools.application")}</Cell>
            <Cell><span className="flex flex-wrap gap-1">
              <Badge tone="neutral">{tool.resourceState}</Badge>
              {tool.bindingState ? <Badge tone={tool.bindingState === ApplicationBindingState.Active ? "positive" : "neutral"}>{tool.bindingState}</Badge> : null}
            </span></Cell>
            <Cell title={tool.applicationBindingId}>{tool.componentTypeKey
              ? `${tool.componentTypeKey}${tool.releaseVersion ? ` · ${tool.releaseVersion}` : ""}` : "—"}</Cell>
            <Cell mono>{tool.capabilityContractKey ?? tool.actionKey}</Cell>
            <Cell mono>{number(tool.requests)}</Cell>
            <Cell mono>{`${number(tool.failed)} / ${number(tool.denied)}`}</Cell>
            <Cell mono>{duration(tool.toolP95Ms)}</Cell>
            <Cell><div className="flex flex-wrap gap-2">
              {tool.canTestCall && tool.testCall ? <Button disabled={testing !== null} onClick={() => setTesting(tool.resourceId)}>{t("gateway.tools.test")}</Button> : null}
              {tool.source === AgentInstallationToolSource.Application && tool.canDisableBinding
                && tool.applicationBindingId && tool.applicationBindingVersion !== undefined ? <Button disabled={disable.frozen} onClick={() =>
                  disable.prepare({ actionKey: "application_binding.disable", explicitConfirmation: true,
                    ...(tool.bindingWorkspaceId ? { workspaceId: tool.bindingWorkspaceId } : {}),
                    applicationBindingId: tool.applicationBindingId!, applicationBindingVersion: tool.applicationBindingVersion! },
                  "gateway.tools.disableWarning")}>{t("gateway.tools.disableBinding")}</Button> : null}
            </div></Cell>
          </tr>)}
        </Table>
      </div>}
      {(() => {
        const tool = page.tools.find((item) => item.resourceId === testing);
        return tool?.testCall ? <TestCall key={tool.resourceId} tool={tool} testCall={tool.testCall} onClose={() => setTesting(null)} /> : null;
      })()}
      <div className="flex gap-2">
        {index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
        {page.nextOffset !== undefined ? <Button onClick={() => { setOffsets((old) => [...old.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1); }}>{t("roles.next")}</Button> : null}
      </div>
    </>}</GatewayLoad>
  </GatewaySection>;
}
