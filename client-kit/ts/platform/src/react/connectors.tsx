// DD-149 连接器（用户自助接入第三方 MCP 服务器）：设置「连接器」分类与 Agents 页工具目录
// 共用同一面板。列表、详情、探测、刷新与 OAuth 状态是 BFF 只读查询；登记、更新、轮换、
// 停用、恢复、删除与 Tenant 连接器策略只提交既有 mcp_connection.* 动作（05 §2.15），
// 每次意图一个新幂等键并显式确认。凭据只作为一次性输入随探测与命令发出，界面从不回显；
// 上游提供的名称、描述与 schema 一律按不可信外部内容以纯文本显示。

import {
  ActionGateState,
  McpConnectionAuthMode,
  McpConnectionHealth,
  McpConnectionState,
  McpConnectionTransport,
  McpConnectionVisibility,
  McpMemberRegistration,
  McpOauthAttemptState,
  McpToolCallPolicy,
  McpToolRisk,
  ReasonCode,
  type ActionCommand,
  type ActionSubmission,
  type McpConnectionPage,
  type McpConnectionProbeRequest,
  type McpConnectionProbeResult,
  type McpConnectionRefreshResult,
  type McpConnectionToolView,
  type McpConnectionView,
  type McpOauthAttemptView,
  type McpOauthStartRequest,
  type McpProbedTool,
  type McpToolSelection,
  type WorkspaceView,
} from "@client-kit/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PlatformMessageKey } from "../i18n";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { AgentManagementDialog } from "./agent-library/AgentManagementDialog";
import { useBffClient, useOpenExternalUrl, useReasonText, useT } from "./context";
import { type GatewayAction, useGatewayAction } from "./gateway-action";
import { useTimestamp } from "./gateway-shared";
import { SettingsSectionHeader } from "./settings-surface";
import { Badge, Button, Cell, Notice, ReadFailure, Table, type Tone } from "./ui";
import { useLoad } from "./use-load";

const inputClass = "h-8 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs";
const fieldClass = "flex flex-col gap-1 text-sm";
const textareaClass = "min-h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs";

// ---------------------------------------------------------------------------------------------
// 文案表：契约枚举到用户语言；契约外的值如实显示原值。

export const riskLabel: Record<McpToolRisk, PlatformMessageKey> = {
  [McpToolRisk.ReadOnly]: "connectors.risk.readOnly",
  [McpToolRisk.Write]: "connectors.risk.write",
  [McpToolRisk.Destructive]: "connectors.risk.destructive",
};

export const callPolicyLabel: Record<McpToolCallPolicy, PlatformMessageKey> = {
  [McpToolCallPolicy.Auto]: "connectors.policy.auto",
  [McpToolCallPolicy.Confirm]: "connectors.policy.confirm",
  [McpToolCallPolicy.Approval]: "connectors.policy.approval",
};

export const visibilityLabel: Record<McpConnectionVisibility, PlatformMessageKey> = {
  [McpConnectionVisibility.Personal]: "connectors.visibility.personal",
  [McpConnectionVisibility.Workspace]: "connectors.visibility.workspace",
  [McpConnectionVisibility.Tenant]: "connectors.visibility.tenant",
};

const healthLabel: Record<McpConnectionHealth, PlatformMessageKey> = {
  [McpConnectionHealth.Ok]: "connectors.health.ok",
  [McpConnectionHealth.Unreachable]: "connectors.health.unreachable",
  [McpConnectionHealth.AuthFailed]: "connectors.health.authFailed",
  [McpConnectionHealth.ReauthorizationRequired]: "connectors.health.reauthorizationRequired",
  [McpConnectionHealth.ProtocolError]: "connectors.health.protocolError",
  [McpConnectionHealth.EgressDenied]: "connectors.health.egressDenied",
  [McpConnectionHealth.Unchecked]: "connectors.health.unchecked",
};

const authLabel: Record<McpConnectionAuthMode, PlatformMessageKey> = {
  [McpConnectionAuthMode.None]: "connectors.auth.none",
  [McpConnectionAuthMode.ApiKey]: "connectors.auth.apiKey",
  [McpConnectionAuthMode.Bearer]: "connectors.auth.bearer",
  [McpConnectionAuthMode.Oauth]: "connectors.auth.oauth",
};

const transportLabel: Record<McpConnectionTransport, PlatformMessageKey> = {
  [McpConnectionTransport.StreamableHttp]: "connectors.transport.streamableHttp",
  [McpConnectionTransport.Sse]: "connectors.transport.sse",
};

function Label<V extends string>({ table, value }: { table: Record<V, PlatformMessageKey>; value: V }) {
  const t = useT();
  return <>{Object.hasOwn(table, value) ? t(table[value]) : value}</>;
}

const riskOrder: Record<McpToolRisk, number> = {
  [McpToolRisk.ReadOnly]: 0, [McpToolRisk.Write]: 1, [McpToolRisk.Destructive]: 2,
};

/** DD-149(7)：默认只读→直接可用、可写→每次确认、破坏性→需要审批。 */
export function defaultCallPolicy(risk: McpToolRisk): McpToolCallPolicy {
  return risk === McpToolRisk.ReadOnly ? McpToolCallPolicy.Auto
    : risk === McpToolRisk.Write ? McpToolCallPolicy.Confirm : McpToolCallPolicy.Approval;
}

/** “直接可用”只允许只读工具。 */
export function policyAllowed(risk: McpToolRisk, policy: McpToolCallPolicy): boolean {
  return policy !== McpToolCallPolicy.Auto || risk === McpToolRisk.ReadOnly;
}

const riskTone = (risk: McpToolRisk): Tone => risk === McpToolRisk.Destructive ? "negative" : "neutral";

export function RiskBadge({ risk }: { risk: McpToolRisk }) {
  return <Badge tone={riskTone(risk)}><Label table={riskLabel} value={risk} /></Badge>;
}

export function CallPolicyBadge({ policy }: { policy: McpToolCallPolicy }) {
  return <Badge tone="neutral"><Label table={callPolicyLabel} value={policy} /></Badge>;
}

/** “外部”标注：未经平台认证的第三方服务。 */
export function ExternalBadge() {
  const t = useT();
  return <Badge tone="neutral">{t("connectors.external")}</Badge>;
}

// ---------------------------------------------------------------------------------------------
// 回应校验：不合契约的回应不当作空或成功。

const text = (value: unknown) => typeof value === "string" && !!value;
const optionalText = (value: unknown) => value === undefined || typeof value === "string";
const member = (values: object, value: unknown) => (Object.values(values) as unknown[]).includes(value);

function validConnectionTool(tool: McpConnectionToolView): boolean {
  return !!tool && text(tool.name) && text(tool.upstreamName) && text(tool.toolResourceId)
    && member(McpToolRisk, tool.risk) && member(McpToolCallPolicy, tool.callPolicy)
    && typeof tool.inputSchemaJson === "string" && optionalText(tool.title) && optionalText(tool.description);
}

export function validConnection(connection: McpConnectionView): boolean {
  return !!connection && text(connection.id) && text(connection.displayName) && typeof connection.endpointHost === "string"
    && typeof connection.endpointUrl === "string" && text(connection.ownerPrincipalId)
    && Number.isSafeInteger(connection.version) && connection.version > 0
    && member(McpConnectionState, connection.state) && member(McpConnectionHealth, connection.health)
    && member(McpConnectionAuthMode, connection.authMode) && member(McpConnectionTransport, connection.transport)
    && member(McpConnectionVisibility, connection.visibility) && typeof connection.canManage === "boolean"
    && typeof connection.credentialSet === "boolean" && typeof connection.drift === "boolean"
    && Array.isArray(connection.tools) && connection.tools.every(validConnectionTool);
}

export function validConnectionPage(page: McpConnectionPage): boolean {
  return !!page && Array.isArray(page.connections) && page.connections.every(validConnection)
    && new Set(page.connections.map((connection) => connection.id)).size === page.connections.length
    && typeof page.canRegisterTenant === "boolean" && typeof page.canRegisterPersonal === "boolean"
    && Array.isArray(page.registrableWorkspaceIds) && page.registrableWorkspaceIds.every(text)
    && !!page.policy && typeof page.policy.canManage === "boolean" && member(McpMemberRegistration, page.policy.memberRegistration)
    && Array.isArray(page.policy.egressHostSuffixes) && Array.isArray(page.policy.platformHostSuffixes)
    && typeof page.policy.platformAnyPublicHost === "boolean" && Number.isSafeInteger(page.policy.version);
}

export function validProbe(probe: McpConnectionProbeResult): boolean {
  return !!probe && text(probe.toolsDigest) && typeof probe.protocolVersion === "string" && Array.isArray(probe.tools)
    && probe.tools.every((tool) => !!tool && text(tool.upstreamName) && typeof tool.inputSchemaJson === "string"
      && member(McpToolRisk, tool.suggestedRisk) && member(McpToolCallPolicy, tool.suggestedCallPolicy))
    && new Set(probe.tools.map((tool) => tool.upstreamName)).size === probe.tools.length;
}

function validAttempt(view: McpOauthAttemptView, attemptId?: string): boolean {
  return !!view && text(view.attemptId) && (attemptId === undefined || view.attemptId === attemptId)
    && member(McpOauthAttemptState, view.state) && typeof view.expiresAt === "string";
}

/**
 * DD-149(12)：连接器流程里既有原因码的用户语言。正文只显示本地化说明；原因码不进入可见文本，
 * 只放在 data-reason-code 上供排障（apps/06 §4）。
 */
const connectorReasons: Partial<Record<ReasonCode, PlatformMessageKey>> = {
  [ReasonCode.PermissionDenied]: "connectors.error.permission",
  [ReasonCode.InvalidParameters]: "connectors.error.invalid",
  [ReasonCode.BindingNotActive]: "connectors.error.authentication",
  [ReasonCode.DependencyUnavailable]: "connectors.error.unreachable",
  [ReasonCode.StepTimeout]: "connectors.error.timeout",
  [ReasonCode.PayloadTooLarge]: "connectors.error.tooLarge",
};

function useConnectorReasonText() {
  const t = useT();
  const reasonText = useReasonText();
  return useCallback((reason: ReasonCode) => {
    const key = connectorReasons[reason];
    return key ? t(key) : reasonText(reason);
  }, [reasonText, t]);
}

/** 只读查询（探测、刷新、OAuth）的失败：服务不可达即使结果类为 UNKNOWN 也如实说明。 */
function useConnectorErrorText() {
  const t = useT();
  const reasonText = useConnectorReasonText();
  return useCallback((error: unknown) => {
    if (error instanceof BffError && error.reason && member(ReasonCode, error.reason)) return reasonText(error.reason);
    const failed = writeFailure(error);
    return failed.kind === "rejected" ? failed.detail : t("connectors.probe.unknown");
  }, [reasonText, t]);
}

const canAdd = (page: McpConnectionPage) => page.canRegisterTenant || page.canRegisterPersonal || page.registrableWorkspaceIds.length > 0;

// ---------------------------------------------------------------------------------------------
// 写入：沿用网关管理区的冻结意图与严格回执（useGatewayAction），呈现不展示命令正文——
// 命令里有一次性凭据，且动作键是内部术语。

function useConnectorAction(onSettled?: (command: ActionCommand, submission: ActionSubmission) => void) {
  return useGatewayAction(onSettled);
}

/** 冻结或结果不明的写入期间，所在对话框不可关闭。 */
function useLockReport(action: GatewayAction, onLocked?: (locked: boolean) => void) {
  const report = useRef(onLocked);
  report.current = onLocked;
  const locked = action.frozen || action.unknown;
  useEffect(() => { report.current?.(locked); }, [locked]);
  useEffect(() => () => report.current?.(false), []);
}

/** 本次意图被拒绝为“清单已变化”（回执拒绝或 409）。 */
function conflicted(action: GatewayAction): boolean {
  return (action.submission?.gateState === ActionGateState.Denied && action.submission.reason === ReasonCode.TargetStateConflict)
    || (action.failure?.kind === "rejected" && action.failure.reason === ReasonCode.TargetStateConflict);
}

export function ConnectorActionPanel({ action, testId, conflictText }: {
  action: GatewayAction; testId?: string; conflictText?: PlatformMessageKey;
}) {
  const t = useT();
  const reasonText = useConnectorReasonText();
  const failureText = (failed: WriteFailure & { kind: "rejected" }) => failed.reason ? reasonText(failed.reason) : failed.detail;
  const { intent, submission, failure, busy, unknown, warning } = action;
  if (!intent && !submission && !failure) return null;
  const conflict = conflicted(action);
  return <div className="flex flex-col gap-2 rounded-xl border bg-card p-3.5 text-sm" data-testid={testId}>
    {intent ? <div role="group" className="flex flex-col gap-2">
      {warning ? <p>{t(warning)}</p> : null}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void action.submit()}>{t(busy ? "platform.loading" : unknown ? "agents.retry" : "connectors.action.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={action.cancel}>{t("platform.cancel")}</Button> : null}
      </div>
    </div> : null}
    {submission ? <p role="status" className="break-words" data-reason-code={submission.reason}>{unknown ? t("agents.unknown", { operation: submission.operationId })
      : conflict && conflictText ? t(conflictText)
      : submission.gateState === ActionGateState.Denied
        ? t("connectors.action.denied", { reason: submission.reason ? reasonText(submission.reason) : t("platform.reasonUnknown") })
        : t("connectors.action.done")}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}
      data-reason-code={failure.kind === "rejected" ? failure.reason : undefined}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? submission?.operationId ?? "—" })
      : conflict && conflictText ? t(conflictText) : failureText(failure)}</p> : null}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// OAuth 2.1：发起一次授权尝试，交给宿主打开授权页（Web 弹窗、Desktop 系统浏览器），轮询其状态。

const OAUTH_POLL_MS = 2_000;

function useOauthAuthorization() {
  const client = useBffClient();
  const openExternal = useOpenExternalUrl();
  const t = useT();
  const errorText = useConnectorErrorText();
  const reasonText = useConnectorReasonText();
  const [attempt, setAttempt] = useState<McpOauthAttemptView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = useRef(0);
  useEffect(() => () => { run.current += 1; }, []);
  const start = useCallback(async (request: McpOauthStartRequest) => {
    run.current += 1;
    const id = run.current;
    setBusy(true); setError(null); setAttempt(null);
    try {
      const view = await client.mcpOauthStart(request);
      if (id !== run.current) return;
      if (!validAttempt(view) || !view.authorizationUrl) throw new TransportError(t("platform.loadFailed"));
      setAttempt(view);
      openExternal(view.authorizationUrl);
      let current = view;
      let first = true;
      while (current.state === McpOauthAttemptState.Pending && Date.now() < Date.parse(current.expiresAt)) {
        if (!first) await new Promise((resolve) => setTimeout(resolve, OAUTH_POLL_MS));
        first = false;
        if (id !== run.current) return;
        const next = await client.mcpOauthAttempt(view.attemptId);
        if (id !== run.current) return;
        if (!validAttempt(next, view.attemptId)) throw new TransportError(t("platform.loadFailed"));
        current = next;
        setAttempt(next);
      }
      if (current.state === McpOauthAttemptState.Pending) setAttempt({ ...current, state: McpOauthAttemptState.Expired });
    } catch (failure) {
      if (id !== run.current) return;
      setError(failure instanceof BffError ? errorText(failure) : t("connectors.oauth.unknown"));
    } finally {
      if (id === run.current) setBusy(false);
    }
  }, [client, errorText, openExternal, t]);
  const reset = useCallback(() => { run.current += 1; setAttempt(null); setError(null); setBusy(false); }, []);
  const failure = attempt && (attempt.state === McpOauthAttemptState.Failed || attempt.state === McpOauthAttemptState.Expired
    || attempt.state === McpOauthAttemptState.Consumed)
    ? attempt.failure && member(ReasonCode, attempt.failure) ? reasonText(attempt.failure as ReasonCode)
      : t(attempt.state === McpOauthAttemptState.Expired ? "connectors.oauth.expired" : "connectors.oauth.failed")
    : null;
  return {
    attempt, busy, start, reset, error: error ?? failure,
    completedId: attempt?.state === McpOauthAttemptState.Completed ? attempt.attemptId : undefined,
  };
}

function OauthStatus({ oauth }: { oauth: ReturnType<typeof useOauthAuthorization> }) {
  const t = useT();
  return <>
    {oauth.busy ? <p role="status" className="text-sm">{t("connectors.oauth.waiting")}</p> : null}
    {oauth.completedId ? <p role="status" className="text-sm" data-testid="connector-oauth-completed">{t("connectors.oauth.completed")}</p> : null}
    {oauth.error ? <p role="alert" className="text-sm">{oauth.error}</p> : null}
  </>;
}

// ---------------------------------------------------------------------------------------------
// 工具选择（登记与重新确认共用）。

export type ToolChoice = { enabled: boolean; risk: McpToolRisk; callPolicy: McpToolCallPolicy; riskDeclared: boolean };

function suggestedChoice(tool: McpProbedTool, enabled = true): ToolChoice {
  const risk = tool.suggestedRisk;
  return { enabled, risk, callPolicy: policyAllowed(risk, tool.suggestedCallPolicy) ? tool.suggestedCallPolicy : defaultCallPolicy(risk), riskDeclared: false };
}

export function initialChoices(probe: McpConnectionProbeResult, previous?: { tools: McpConnectionToolView[]; added: string[] }): Record<string, ToolChoice> {
  const choices: Record<string, ToolChoice> = {};
  for (const tool of probe.tools) {
    const kept = previous?.tools.find((item) => item.upstreamName === tool.upstreamName);
    choices[tool.upstreamName] = kept
      ? { enabled: true, risk: kept.risk, callPolicy: kept.callPolicy, riskDeclared: kept.riskDeclared }
      : suggestedChoice(tool, !previous || previous.added.includes(tool.upstreamName));
  }
  return choices;
}

/** 风险等级低于服务声明（annotations 建议）时须逐项声明。 */
export function needsDeclaration(tool: McpProbedTool, choice: ToolChoice): boolean {
  return riskOrder[choice.risk] < riskOrder[tool.suggestedRisk];
}

export function choicesValid(probe: McpConnectionProbeResult, choices: Record<string, ToolChoice>): boolean {
  const enabled = probe.tools.filter((tool) => choices[tool.upstreamName]?.enabled);
  return enabled.length > 0 && enabled.every((tool) => {
    const choice = choices[tool.upstreamName]!;
    return policyAllowed(choice.risk, choice.callPolicy) && (!needsDeclaration(tool, choice) || choice.riskDeclared);
  });
}

export function selections(probe: McpConnectionProbeResult, choices: Record<string, ToolChoice>): McpToolSelection[] {
  return probe.tools.map((tool) => {
    const choice = choices[tool.upstreamName] ?? suggestedChoice(tool, false);
    return { upstreamName: tool.upstreamName, enabled: choice.enabled, risk: choice.risk, callPolicy: choice.callPolicy,
      ...(choice.enabled && needsDeclaration(tool, choice) && choice.riskDeclared ? { riskDeclared: true } : {}) };
  });
}

function prettySchema(json: string): string {
  try { return JSON.stringify(JSON.parse(json), null, 2); } catch { return json; }
}

function AnnotationChips({ tool }: { tool: McpProbedTool }) {
  const t = useT();
  const chips: PlatformMessageKey[] = [];
  if (tool.readOnlyHint === true) chips.push("connectors.hint.readOnly");
  if (tool.destructiveHint === true) chips.push("connectors.hint.destructive");
  if (tool.destructiveHint === false) chips.push("connectors.hint.notDestructive");
  if (tool.idempotentHint === true) chips.push("connectors.hint.idempotent");
  if (tool.openWorldHint === true) chips.push("connectors.hint.openWorld");
  if (!chips.length) chips.push("connectors.hint.none");
  return <span className="flex flex-wrap gap-1">{chips.map((key) => <Badge key={key} tone="neutral">{t(key)}</Badge>)}</span>;
}

/** 外部服务提供的文字：纯文本并标注来源。 */
function ExternalText({ value }: { value?: string }) {
  const t = useT();
  if (!value) return null;
  return <p className="whitespace-pre-wrap break-words text-xs text-muted-foreground">
    <span className="font-medium">{t("connectors.providedByService")}</span> {value}
  </p>;
}

function ToolSelectionStep({ probe, choices, onChange, disabled, changed }: {
  probe: McpConnectionProbeResult; choices: Record<string, ToolChoice>; onChange: (choices: Record<string, ToolChoice>) => void;
  disabled: boolean; changed?: { added: string[]; changed: string[] };
}) {
  const t = useT();
  const update = (name: string, patch: Partial<ToolChoice>) => {
    const current = choices[name]!;
    const next = { ...current, ...patch };
    if (patch.risk !== undefined && patch.risk !== current.risk) { next.callPolicy = defaultCallPolicy(patch.risk); next.riskDeclared = false; }
    onChange({ ...choices, [name]: next });
  };
  if (!probe.tools.length) return <Notice>{t("connectors.tools.noneFound")}</Notice>;
  return <div className="flex flex-col gap-3" data-testid="connector-tool-selection">
    <p className="text-xs text-muted-foreground">{t("connectors.tools.explain")}</p>
    {probe.tools.map((tool) => {
      const choice = choices[tool.upstreamName] ?? suggestedChoice(tool, false);
      const declare = choice.enabled && needsDeclaration(tool, choice);
      return <div key={tool.upstreamName} className="flex flex-col gap-2 rounded-xl border bg-card p-3.5" data-testid="connector-probed-tool" data-tool={tool.upstreamName}>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={choice.enabled} disabled={disabled}
            aria-label={t("connectors.tools.enable", { tool: tool.upstreamName })}
            onChange={(event) => update(tool.upstreamName, { enabled: event.target.checked })} />
          <span className="font-mono text-xs">{tool.upstreamName}</span>
          {tool.title ? <span className="break-words">{tool.title}</span> : null}
          {changed?.added.includes(tool.upstreamName) ? <Badge tone="neutral">{t("connectors.refresh.addedBadge")}</Badge> : null}
          {changed?.changed.includes(tool.upstreamName) ? <Badge tone="neutral">{t("connectors.refresh.changedBadge")}</Badge> : null}
        </label>
        <ExternalText value={tool.description} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">{t("connectors.tools.hints")}</span><AnnotationChips tool={tool} />
          <span className="text-muted-foreground">{t("connectors.tools.suggested")}</span><RiskBadge risk={tool.suggestedRisk} />
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">{t("connectors.tools.risk")}
            <select className={inputClass} value={choice.risk} disabled={disabled || !choice.enabled}
              aria-label={t("connectors.tools.riskFor", { tool: tool.upstreamName })}
              onChange={(event) => update(tool.upstreamName, { risk: event.target.value as McpToolRisk })}>
              {Object.values(McpToolRisk).map((risk) => <option key={risk} value={risk}>{t(riskLabel[risk])}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">{t("connectors.tools.policy")}
            <select className={inputClass} value={choice.callPolicy} disabled={disabled || !choice.enabled}
              aria-label={t("connectors.tools.policyFor", { tool: tool.upstreamName })}
              onChange={(event) => update(tool.upstreamName, { callPolicy: event.target.value as McpToolCallPolicy })}>
              {[McpToolCallPolicy.Auto, McpToolCallPolicy.Confirm, McpToolCallPolicy.Approval].map((policy) =>
                <option key={policy} value={policy} disabled={!policyAllowed(choice.risk, policy)}>{t(callPolicyLabel[policy])}</option>)}
            </select>
          </label>
        </div>
        {declare ? <label className="flex items-center gap-2 text-sm" data-testid="connector-risk-declaration">
          <input type="checkbox" checked={choice.riskDeclared} disabled={disabled}
            aria-label={t("connectors.tools.declareFor", { tool: tool.upstreamName })}
            onChange={(event) => update(tool.upstreamName, { riskDeclared: event.target.checked })} />
          <span>{t("connectors.tools.declare")}</span>
        </label> : null}
        <details className="text-sm">
          <summary>{t("connectors.tools.schema")}</summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border p-2 font-mono text-xs"><code>{prettySchema(tool.inputSchemaJson)}</code></pre>
        </details>
      </div>;
    })}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// 可见范围（登记与重新确认共用）。

type Scope = { visibility: McpConnectionVisibility | ""; workspaceId: string; consent: boolean };

/** 更新时只能在“仅自己”与“全组织”之间切换；“本空间”连接器保持原空间。 */
function allowedVisibilities(page: McpConnectionPage, current?: McpConnectionVisibility): McpConnectionVisibility[] {
  if (current === McpConnectionVisibility.Workspace) return [McpConnectionVisibility.Workspace];
  if (current) return [McpConnectionVisibility.Personal, McpConnectionVisibility.Tenant].filter((value) => value === current
    || (value === McpConnectionVisibility.Personal ? page.canRegisterPersonal : page.canRegisterTenant));
  return [McpConnectionVisibility.Personal, McpConnectionVisibility.Workspace, McpConnectionVisibility.Tenant].filter((value) =>
    value === current
    || (value === McpConnectionVisibility.Personal ? page.canRegisterPersonal
      : value === McpConnectionVisibility.Workspace ? page.registrableWorkspaceIds.length > 0 : page.canRegisterTenant));
}

function defaultScope(page: McpConnectionPage): Scope {
  return { visibility: allowedVisibilities(page)[0] ?? "", workspaceId: page.registrableWorkspaceIds[0] ?? "", consent: false };
}

function scopeValid(scope: Scope, page: McpConnectionPage, oauth: boolean, current?: { visibility: McpConnectionVisibility; workspaceId?: string }): boolean {
  if (!scope.visibility || !allowedVisibilities(page, current?.visibility).includes(scope.visibility)) return false;
  if (scope.visibility === McpConnectionVisibility.Workspace && (current
    ? current.visibility !== McpConnectionVisibility.Workspace || current.workspaceId !== scope.workspaceId
    : !page.registrableWorkspaceIds.includes(scope.workspaceId))) return false;
  return !oauth || scope.visibility === McpConnectionVisibility.Personal || scope.consent;
}

function useWorkspaceNames(needed: boolean) {
  const client = useBffClient();
  const [state] = useLoad(`connector-workspaces:${needed}`, () => needed ? client.workspaces() : Promise.resolve([] as WorkspaceView[]));
  const names = new Map<string, string>();
  if (state.status === "ok" && Array.isArray(state.data))
    for (const workspace of state.data) if (workspace && text(workspace.id) && text(workspace.name)) names.set(workspace.id, workspace.name);
  return (id: string | undefined) => (id ? names.get(id) ?? id : "—");
}

function ScopeStep({ page, scope, onChange, oauth, disabled, current }: {
  page: McpConnectionPage; scope: Scope; onChange: (scope: Scope) => void; oauth: boolean; disabled: boolean;
  current?: { visibility: McpConnectionVisibility; workspaceId?: string };
}) {
  const t = useT();
  const workspaceIds = current ? (current.workspaceId ? [current.workspaceId] : []) : page.registrableWorkspaceIds;
  const workspaceName = useWorkspaceNames(workspaceIds.length > 0);
  const options = allowedVisibilities(page, current?.visibility);
  return <div className="flex flex-col gap-3" data-testid="connector-scope">
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="font-medium">{t("connectors.scope.title")}</legend>
      {options.map((value) => <label key={value} className="flex items-center gap-2">
        <input type="radio" name="connector-visibility" value={value} checked={scope.visibility === value} disabled={disabled}
          onChange={() => onChange({ ...scope, visibility: value })} />
        <span>{t(visibilityLabel[value])}</span>
      </label>)}
    </fieldset>
    {scope.visibility === McpConnectionVisibility.Workspace ? <label className={fieldClass}>{t("connectors.scope.workspace")}
      <select className={inputClass} value={scope.workspaceId} disabled={disabled || !!current} aria-label={t("connectors.scope.workspace")}
        onChange={(event) => onChange({ ...scope, workspaceId: event.target.value })}>
        {workspaceIds.map((id) => <option key={id} value={id}>{workspaceName(id)}</option>)}
      </select>
    </label> : null}
    <p className="text-xs text-muted-foreground">{t(scope.visibility === McpConnectionVisibility.Tenant ? "connectors.scope.tenantExplain"
      : scope.visibility === McpConnectionVisibility.Workspace ? "connectors.scope.workspaceExplain" : "connectors.scope.personalExplain")}</p>
    {oauth && scope.visibility && scope.visibility !== McpConnectionVisibility.Personal ? <label className="flex items-center gap-2 text-sm" data-testid="connector-consent">
      <input type="checkbox" checked={scope.consent} disabled={disabled} aria-label={t("connectors.scope.consent")}
        onChange={(event) => onChange({ ...scope, consent: event.target.checked })} />
      <span>{t("connectors.scope.consent")}</span>
    </label> : null}
  </div>;
}

// ---------------------------------------------------------------------------------------------
// 添加连接器：①填写 → ②连接测试 → ③选择工具 → ④范围与确认。

const stepKeys: PlatformMessageKey[] = ["connectors.step.details", "connectors.step.test", "connectors.step.tools", "connectors.step.scope"];

function Steps({ current }: { current: number }) {
  const t = useT();
  return <ol className="flex flex-wrap gap-3 text-sm" data-testid="connector-steps">
    {stepKeys.map((key, index) => <li key={key} aria-current={index + 1 === current ? "step" : undefined}
      className={index + 1 === current ? "font-medium" : "text-muted-foreground"}>{`${index + 1}. ${t(key)}`}</li>)}
  </ol>;
}

function ProbeSummary({ probe }: { probe: McpConnectionProbeResult }) {
  const t = useT();
  return <div className="flex flex-col gap-1 text-sm" data-testid="connector-probe-result">
    <p>{t("connectors.probe.server", { name: probe.serverName ?? "—", version: probe.serverVersion ?? "—", protocol: probe.protocolVersion || "—" })}</p>
    <p>{t("connectors.probe.toolCount", { count: probe.tools.length })}</p>
    {probe.instructions ? <ExternalText value={probe.instructions} /> : null}
  </div>;
}

function useProbeError() {
  return useConnectorErrorText();
}

export function AddConnectorFlow({ page, onDone, onCancel, onLocked }: {
  page: McpConnectionPage; onDone: () => void; onCancel?: () => void; onLocked?: (locked: boolean) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const probeError = useProbeError();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [transport, setTransport] = useState<McpConnectionTransport>(McpConnectionTransport.StreamableHttp);
  const [authMode, setAuthMode] = useState<McpConnectionAuthMode>(McpConnectionAuthMode.None);
  const [header, setHeader] = useState("x-api-key");
  const [credential, setCredential] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [probe, setProbe] = useState<McpConnectionProbeResult | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeFailure, setProbeFailure] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [choices, setChoices] = useState<Record<string, ToolChoice>>({});
  const [scope, setScope] = useState<Scope>(() => defaultScope(page));
  const oauth = useOauthAuthorization();
  const done = useRef(onDone);
  done.current = onDone;
  const action = useConnectorAction((_command, submission) => {
    if (submission.gateState === ActionGateState.Denied) {
      if (submission.reason === ReasonCode.TargetStateConflict) { setConflict(true); setProbe(null); setStep(2); }
      return;
    }
    setCredential(""); setClientSecret("");
    done.current();
  });
  useLockReport(action, onLocked);
  const failedConflict = action.failure?.kind === "rejected" && action.failure.reason === ReasonCode.TargetStateConflict;
  useEffect(() => {
    if (failedConflict) { setConflict(true); setProbe(null); setStep(2); }
  }, [failedConflict]);
  const frozen = action.frozen;
  const isOauth = authMode === McpConnectionAuthMode.Oauth;
  const needsCredential = authMode === McpConnectionAuthMode.ApiKey || authMode === McpConnectionAuthMode.Bearer;
  const detailsValid = !!name.trim() && name.trim().length <= 80 && !!url.trim()
    && (!needsCredential || !!credential) && (authMode !== McpConnectionAuthMode.ApiKey || !!header.trim())
    && (!isOauth || !!oauth.completedId);
  const endpoint = url.trim();

  const runProbe = async () => {
    if (!detailsValid || probing) return;
    setProbing(true); setProbeFailure(null); setProbe(null); setStep(2);
    const request: McpConnectionProbeRequest = {
      endpointUrl: endpoint, transport, authMode,
      ...(authMode === McpConnectionAuthMode.ApiKey ? { apiKeyHeader: header.trim() } : {}),
      ...(needsCredential ? { credential: { value: credential } } : {}),
      ...(isOauth && oauth.completedId ? { oauthAttemptId: oauth.completedId } : {}),
    };
    try {
      const result = await client.mcpConnectionProbe(request);
      if (!validProbe(result)) throw new TransportError(t("platform.loadFailed"));
      setProbe(result); setChoices(initialChoices(result));
    } catch (error) {
      setProbeFailure(probeError(error));
    } finally { setProbing(false); }
  };

  const authorize = () => {
    if (!endpoint) return;
    void oauth.start({ endpointUrl: endpoint, transport,
      ...(clientId.trim() ? { clientId: clientId.trim() } : {}), ...(clientSecret ? { clientSecret } : {}) });
  };

  const submit = () => {
    if (!probe || !choicesValid(probe, choices) || !scopeValid(scope, page, isOauth) || !scope.visibility) return;
    setConflict(false);
    action.prepare({
      actionKey: "mcp_connection.create", explicitConfirmation: true,
      mcpConnectionCreate: {
        displayName: name.trim(), endpointUrl: endpoint, transport, authMode,
        ...(authMode === McpConnectionAuthMode.ApiKey ? { apiKeyHeader: header.trim() } : {}),
        visibility: scope.visibility,
        ...(scope.visibility === McpConnectionVisibility.Workspace ? { workspaceId: scope.workspaceId } : {}),
        ...(isOauth && oauth.completedId ? { oauthAttemptId: oauth.completedId } : {}),
        ...(isOauth && scope.visibility !== McpConnectionVisibility.Personal ? { sharedAuthorizationConsent: scope.consent } : {}),
        toolsDigest: probe.toolsDigest, tools: selections(probe, choices),
      },
      ...(needsCredential ? { mcpConnectionCredential: { value: credential } } : {}),
    }, "connectors.confirm.create");
  };

  const enabledCount = probe ? probe.tools.filter((tool) => choices[tool.upstreamName]?.enabled).length : 0;
  const back = (to: number) => <Button disabled={frozen || probing} onClick={() => setStep(to)}>{t("connectors.back")}</Button>;

  return <div className="flex flex-col gap-4" data-testid="connector-add">
    <Steps current={step} />
    {step === 1 ? <div className="flex flex-col gap-3" data-testid="connector-details">
      <label className={fieldClass}>{t("connectors.field.name")}
        <input className={inputClass} value={name} maxLength={80} aria-label={t("connectors.field.name")} onChange={(event) => setName(event.target.value)} />
      </label>
      <label className={fieldClass}>{t("connectors.field.url")}
        <input className={inputClass} value={url} placeholder="https://" aria-label={t("connectors.field.url")} inputMode="url"
          onChange={(event) => { setUrl(event.target.value); oauth.reset(); }} />
        <span className="text-xs text-muted-foreground">{t("connectors.field.urlHint")}</span>
      </label>
      <label className={fieldClass}>{t("connectors.field.transport")}
        <select className={inputClass} value={transport} aria-label={t("connectors.field.transport")}
          onChange={(event) => { setTransport(event.target.value as McpConnectionTransport); oauth.reset(); }}>
          {[McpConnectionTransport.StreamableHttp, McpConnectionTransport.Sse].map((value) => <option key={value} value={value}>{t(transportLabel[value])}</option>)}
        </select>
      </label>
      <label className={fieldClass}>{t("connectors.field.auth")}
        <select className={inputClass} value={authMode} aria-label={t("connectors.field.auth")}
          onChange={(event) => { setAuthMode(event.target.value as McpConnectionAuthMode); setCredential(""); oauth.reset(); }}>
          {[McpConnectionAuthMode.None, McpConnectionAuthMode.ApiKey, McpConnectionAuthMode.Bearer, McpConnectionAuthMode.Oauth]
            .map((value) => <option key={value} value={value}>{t(authLabel[value])}</option>)}
        </select>
      </label>
      {authMode === McpConnectionAuthMode.ApiKey ? <label className={fieldClass}>{t("connectors.field.header")}
        <input className={inputClass} value={header} aria-label={t("connectors.field.header")} onChange={(event) => setHeader(event.target.value)} />
      </label> : null}
      {needsCredential ? <label className={fieldClass}>{t(authMode === McpConnectionAuthMode.ApiKey ? "connectors.field.apiKey" : "connectors.field.bearer")}
        <input className={inputClass} type="password" autoComplete="off" value={credential} data-testid="connector-credential"
          aria-label={t(authMode === McpConnectionAuthMode.ApiKey ? "connectors.field.apiKey" : "connectors.field.bearer")}
          onChange={(event) => setCredential(event.target.value)} />
        <span className="text-xs text-muted-foreground">{t("connectors.field.credentialHint")}</span>
      </label> : null}
      {isOauth ? <div className="flex flex-col gap-2 rounded-xl border bg-card p-3.5" data-testid="connector-oauth">
        <p className="text-xs text-muted-foreground">{t("connectors.oauth.explain")}</p>
        <Button className="w-fit" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>{t("connectors.oauth.advanced")}</Button>
        {advanced ? <>
          <label className={fieldClass}>{t("connectors.oauth.clientId")}
            <input className={inputClass} value={clientId} autoComplete="off" aria-label={t("connectors.oauth.clientId")} onChange={(event) => setClientId(event.target.value)} />
          </label>
          <label className={fieldClass}>{t("connectors.oauth.clientSecret")}
            <input className={inputClass} type="password" autoComplete="off" value={clientSecret} aria-label={t("connectors.oauth.clientSecret")}
              onChange={(event) => setClientSecret(event.target.value)} />
          </label>
        </> : null}
        <Button className="w-fit" disabled={!endpoint || oauth.busy} onClick={authorize}>{t(oauth.completedId ? "connectors.oauth.again" : "connectors.oauth.authorize")}</Button>
        <OauthStatus oauth={oauth} />
      </div> : null}
      <div className="flex gap-2">
        <Button disabled={!detailsValid || probing} onClick={() => void runProbe()}>{t("connectors.next.test")}</Button>
        {onCancel ? <Button onClick={onCancel}>{t("platform.cancel")}</Button> : null}
      </div>
    </div> : null}
    {step === 2 ? <div className="flex flex-col gap-3" data-testid="connector-test">
      {conflict ? <p role="alert" className="text-sm" data-testid="connector-conflict">{t("connectors.conflict")}</p> : null}
      {probing ? <p role="status" className="text-sm">{t("connectors.probe.running")}</p> : null}
      {probeFailure ? <p role="alert" className="text-sm" data-testid="connector-probe-failure">{probeFailure}</p> : null}
      {probe ? <ProbeSummary probe={probe} /> : null}
      <div className="flex gap-2">
        {back(1)}
        <Button disabled={probing || !detailsValid} onClick={() => void runProbe()}>{t("connectors.probe.retry")}</Button>
        {probe ? <Button onClick={() => setStep(3)}>{t("connectors.next.tools")}</Button> : null}
      </div>
    </div> : null}
    {step === 3 && probe ? <div className="flex flex-col gap-3">
      <ToolSelectionStep probe={probe} choices={choices} onChange={setChoices} disabled={frozen} />
      <div className="flex gap-2">
        {back(2)}
        <Button disabled={!choicesValid(probe, choices)} onClick={() => setStep(4)}>{t("connectors.next.scope")}</Button>
      </div>
    </div> : null}
    {step === 4 && probe ? <div className="flex flex-col gap-3">
      <ScopeStep page={page} scope={scope} onChange={setScope} oauth={isOauth} disabled={frozen} />
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 rounded-xl border bg-card p-3.5 text-sm md:grid-cols-2" data-testid="connector-summary">
        <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.field.name")}</dt><dd className="break-all">{name.trim()}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.host")}</dt><dd className="break-all">{probe.endpointHost || endpoint}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.field.auth")}</dt><dd>{t(authLabel[authMode])}</dd></div>
        <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.tools.title")}</dt><dd>{t("connectors.summary.tools", { enabled: enabledCount, total: probe.tools.length })}</dd></div>
      </dl>
      <div className="flex gap-2">
        {back(3)}
        <Button disabled={frozen || !choicesValid(probe, choices) || !scopeValid(scope, page, isOauth)} onClick={submit}>{t("connectors.save")}</Button>
      </div>
      <ConnectorActionPanel action={action} testId="connector-create-action" conflictText="connectors.conflict" />
    </div> : null}
  </div>;
}

/** 两处入口（设置「连接器」与 Agents 页工具目录）打开的同一面板。 */
export function AddConnectorDialog({ open, onClose, onCreated, page }: {
  open: boolean; onClose: () => void; onCreated?: () => void; page?: McpConnectionPage;
}) {
  const t = useT();
  const [locked, setLocked] = useState(false);
  return <AgentManagementDialog open={open} title={t("connectors.add")} onClose={onClose} locked={locked} dataTestId="connector-add-dialog">
    {open ? <AddConnectorBody page={page} onDone={() => { onCreated?.(); onClose(); }} onCancel={onClose} onLocked={setLocked} /> : null}
  </AgentManagementDialog>;
}

function AddConnectorBody({ page, onDone, onCancel, onLocked }: {
  page?: McpConnectionPage; onDone: () => void; onCancel: () => void; onLocked: (locked: boolean) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`connector-registration:${page ? "given" : "read"}`, () => page ? Promise.resolve(page) : client.mcpConnections());
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (state.status === "error" || !validConnectionPage(state.data))
    return <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />;
  if (!canAdd(state.data)) return <Notice>{t("connectors.cannotAdd")}</Notice>;
  return <AddConnectorFlow page={state.data} onDone={onDone} onCancel={onCancel} onLocked={onLocked} />;
}

// ---------------------------------------------------------------------------------------------
// 连接器列表与详情。

function useHealthTone() {
  return (health: McpConnectionHealth): Tone => health === McpConnectionHealth.Ok ? "positive"
    : health === McpConnectionHealth.Unchecked ? "neutral" : "negative";
}

function VisibilityText({ connection, workspaceName }: { connection: McpConnectionView; workspaceName: (id?: string) => string }) {
  const t = useT();
  return <>{t(visibilityLabel[connection.visibility] ?? "connectors.visibility.personal")}
    {connection.visibility === McpConnectionVisibility.Workspace && connection.workspaceId ? ` · ${workspaceName(connection.workspaceId)}` : ""}</>;
}

function ToolsTable({ tools }: { tools: McpConnectionToolView[] }) {
  const t = useT();
  if (!tools.length) return <Notice>{t("connectors.tools.noneEnabled")}</Notice>;
  return <div className="overflow-x-auto"><Table head={[t("connectors.tools.name"), t("connectors.tools.description"), t("connectors.tools.risk"), t("connectors.tools.policy")]}>
    {tools.map((tool) => <tr key={tool.toolResourceId} data-testid="connector-tool-row">
      <Cell><p className="break-words">{tool.title ?? tool.upstreamName}</p><p className="break-all font-mono text-xs">{tool.name}</p></Cell>
      <Cell>{tool.description ? <ExternalText value={tool.description} /> : "—"}</Cell>
      <Cell><span className="flex flex-wrap gap-1"><RiskBadge risk={tool.risk} />
        {tool.riskDeclared ? <Badge tone="neutral">{t("connectors.tools.declared")}</Badge> : null}</span></Cell>
      <Cell><CallPolicyBadge policy={tool.callPolicy} /></Cell>
    </tr>)}
  </Table></div>;
}

function RefreshOutcome({ result }: { result: McpConnectionRefreshResult }) {
  const t = useT();
  const timestamp = useTimestamp();
  const list = (key: PlatformMessageKey, names: string[]) => names.length
    ? <p className="break-words">{t(key, { tools: names.join(", ") })}</p> : null;
  return <div className="flex flex-col gap-1 rounded-xl border bg-card p-3.5 text-sm" role="status" data-testid="connector-refresh-result">
    <p>{t("connectors.refresh.checked", { at: timestamp(result.checkedAt), health: t(healthLabel[result.health] ?? "connectors.health.unchecked") })}</p>
    {result.drift ? <>
      <p className="font-medium">{t("connectors.drift")}</p>
      {list("connectors.refresh.added", result.addedTools)}
      {list("connectors.refresh.removed", result.removedTools)}
      {list("connectors.refresh.changed", result.changedTools)}
    </> : <p>{t("connectors.refresh.unchanged")}</p>}
  </div>;
}

function ReconfirmFlow({ connection, probe, refresh, page, onDone, onCancel }: {
  connection: McpConnectionView; probe: McpConnectionProbeResult; refresh: McpConnectionRefreshResult; page: McpConnectionPage;
  onDone: () => void; onCancel: () => void;
}) {
  const t = useT();
  const [choices, setChoices] = useState(() => initialChoices(probe, { tools: connection.tools, added: refresh.addedTools }));
  const current = { visibility: connection.visibility, workspaceId: connection.workspaceId };
  const [scope, setScope] = useState<Scope>({ visibility: connection.visibility, workspaceId: connection.workspaceId ?? page.registrableWorkspaceIds[0] ?? "", consent: false });
  const [conflict, setConflict] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const action = useConnectorAction((_command, submission) => {
    if (submission.gateState === ActionGateState.Denied) {
      if (submission.reason === ReasonCode.TargetStateConflict) setConflict(true);
      return;
    }
    done.current();
  });
  const oauth = connection.authMode === McpConnectionAuthMode.Oauth;
  const valid = choicesValid(probe, choices) && scopeValid(scope, page, oauth, current) && !!scope.visibility;
  const submit = () => {
    if (!valid || !scope.visibility) return;
    action.prepare({
      actionKey: "mcp_connection.update", explicitConfirmation: true, resourceId: connection.id, resourceVersion: connection.version,
      mcpConnectionUpdate: {
        visibility: scope.visibility,
        ...(scope.visibility === McpConnectionVisibility.Workspace ? { workspaceId: scope.workspaceId } : {}),
        ...(oauth && scope.visibility !== McpConnectionVisibility.Personal ? { sharedAuthorizationConsent: scope.consent } : {}),
        toolsDigest: probe.toolsDigest, tools: selections(probe, choices),
      },
    }, "connectors.confirm.update");
  };
  return <div className="flex flex-col gap-3 rounded-xl border bg-card p-3.5" data-testid="connector-reconfirm">
    <h4 className="text-sm font-medium">{t("connectors.reconfirm.title")}</h4>
    <ProbeSummary probe={probe} />
    <ToolSelectionStep probe={probe} choices={choices} onChange={setChoices} disabled={action.frozen}
      changed={{ added: refresh.addedTools, changed: refresh.changedTools }} />
    <ScopeStep page={page} scope={scope} onChange={setScope} oauth={oauth} disabled={action.frozen} current={current} />
    {conflict ? <p role="alert" className="text-sm">{t("connectors.reconfirm.conflict")}</p> : null}
    <div className="flex gap-2">
      <Button disabled={!valid || action.frozen} onClick={submit}>{t("connectors.reconfirm.submit")}</Button>
      {!action.frozen ? <Button onClick={onCancel}>{t("platform.cancel")}</Button> : null}
    </div>
    <ConnectorActionPanel action={action} testId="connector-update-action" conflictText="connectors.reconfirm.conflict" />
  </div>;
}

function RotateCredential({ connection, action }: { connection: McpConnectionView; action: GatewayAction }) {
  const t = useT();
  const [value, setValue] = useState("");
  const oauth = useOauthAuthorization();
  const base = { actionKey: "mcp_connection.rotate_credential", explicitConfirmation: true, resourceId: connection.id, resourceVersion: connection.version };
  const completed = oauth.completedId;
  const settledFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!completed || settledFor.current === completed) return;
    settledFor.current = completed;
    action.prepare({ ...base, mcpOauthAttemptId: completed }, "connectors.confirm.rotate");
  }, [completed]);
  useEffect(() => { if (!action.intent) setValue(""); }, [action.intent]);
  if (connection.authMode === McpConnectionAuthMode.None) return null;
  if (connection.authMode === McpConnectionAuthMode.Oauth) return <div className="flex flex-col gap-2" data-testid="connector-reauthorize">
    <Button className="w-fit" disabled={action.frozen || oauth.busy} onClick={() => void oauth.start({
      endpointUrl: connection.endpointUrl, transport: connection.transport, forConnectionId: connection.id })}>{t("connectors.rotate.reauthorize")}</Button>
    <OauthStatus oauth={oauth} />
  </div>;
  return <div className="flex flex-wrap items-end gap-2" data-testid="connector-rotate">
    <label className={fieldClass}>{t(connection.authMode === McpConnectionAuthMode.ApiKey ? "connectors.rotate.newApiKey" : "connectors.rotate.newBearer")}
      <input className={inputClass} type="password" autoComplete="off" value={value} disabled={action.frozen}
        aria-label={t(connection.authMode === McpConnectionAuthMode.ApiKey ? "connectors.rotate.newApiKey" : "connectors.rotate.newBearer")}
        onChange={(event) => setValue(event.target.value)} />
    </label>
    <Button disabled={!value || action.frozen} onClick={() => action.prepare({ ...base, mcpConnectionCredential: { value } }, "connectors.confirm.rotate")}>
      {t("connectors.rotate.submit")}</Button>
  </div>;
}

function ConnectorDetail({ id, page, onChanged }: { id: string; page: McpConnectionPage; onChanged: () => void }) {
  const client = useBffClient();
  const t = useT();
  const timestamp = useTimestamp();
  const probeError = useProbeError();
  const [state, reload] = useLoad(`mcp-connection:${id}`, () => client.mcpConnection(id));
  const [refreshing, setRefreshing] = useState(false);
  const [refresh, setRefresh] = useState<McpConnectionRefreshResult | null>(null);
  const [refreshFailure, setRefreshFailure] = useState<string | null>(null);
  const [reconfirming, setReconfirming] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const manage = useConnectorAction(() => { reload(); changed.current(); });
  const deleting = manage.intent?.actionKey === "mcp_connection.delete";
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (state.status === "error" || !validConnection(state.data) || state.data.id !== id)
    return <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />;
  const connection = state.data;
  const runRefresh = async () => {
    setRefreshing(true); setRefreshFailure(null); setRefresh(null); setReconfirming(false);
    try {
      const result = await client.mcpConnectionRefresh(connection.id);
      if (!result || typeof result.drift !== "boolean" || !Array.isArray(result.addedTools) || !Array.isArray(result.removedTools)
        || !Array.isArray(result.changedTools) || (result.probe !== undefined && !validProbe(result.probe))) throw new TransportError(t("platform.loadFailed"));
      setRefresh(result);
      reload(); changed.current();
    } catch (error) { setRefreshFailure(probeError(error)); } finally { setRefreshing(false); }
  };
  const simple = (actionKey: string, warning: PlatformMessageKey) => manage.prepare({ actionKey, explicitConfirmation: true,
    resourceId: connection.id, resourceVersion: connection.version }, warning);
  const active = connection.state === McpConnectionState.Active;
  return <div className="flex flex-col gap-3 border-t pt-3" data-testid="connector-detail">
    <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm md:grid-cols-2">
      <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.field.url")}</dt><dd className="break-all font-mono text-xs">{connection.endpointUrl}</dd></div>
      <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.field.transport")}</dt><dd><Label table={transportLabel} value={connection.transport} /></dd></div>
      <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.field.auth")}</dt><dd><Label table={authLabel} value={connection.authMode} /></dd></div>
      {connection.authMode !== McpConnectionAuthMode.None ? <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.credential")}</dt>
        <dd>{connection.credentialSet ? t("connectors.credential.set", { at: timestamp(connection.credentialUpdatedAt) }) : t("connectors.credential.unset")}</dd></div> : null}
      <div className="flex gap-2"><dt className="text-muted-foreground">{t("connectors.server")}</dt>
        <dd className="break-all">{connection.serverName ? `${connection.serverName}${connection.serverVersion ? ` ${connection.serverVersion}` : ""}` : "—"}</dd></div>
    </dl>
    <h4 className="text-sm font-medium">{t("connectors.tools.title")}</h4>
    <ToolsTable tools={connection.tools} />
    {connection.canManage && connection.state !== McpConnectionState.Deleted ? <div className="flex flex-col gap-3" data-testid="connector-manage">
      <div className="flex flex-wrap gap-2">
        <Button disabled={refreshing || manage.frozen || !active} onClick={() => void runRefresh()}>{t(refreshing ? "connectors.refresh.running" : "connectors.refresh")}</Button>
        {active ? <Button disabled={manage.frozen} onClick={() => simple("mcp_connection.disable", "connectors.confirm.disable")}>{t("connectors.disable")}</Button>
          : <Button disabled={manage.frozen} onClick={() => simple("mcp_connection.enable", "connectors.confirm.enable")}>{t("connectors.enable")}</Button>}
        <Button disabled={manage.frozen} onClick={() => simple("mcp_connection.delete", "connectors.confirm.delete")}>{t("connectors.delete")}</Button>
      </div>
      {refreshFailure ? <p role="alert" className="text-sm">{refreshFailure}</p> : null}
      {refresh ? <RefreshOutcome result={refresh} /> : null}
      {refresh?.probe && !reconfirming ? <Button className="w-fit" disabled={manage.frozen} onClick={() => setReconfirming(true)}>
        {t(refresh.drift ? "connectors.reconfirm" : "connectors.reconfirm.adjust")}</Button> : null}
      {refresh?.probe && reconfirming ? <ReconfirmFlow connection={connection} probe={refresh.probe} refresh={refresh} page={page}
        onDone={() => { setReconfirming(false); setRefresh(null); reload(); changed.current(); }} onCancel={() => setReconfirming(false)} /> : null}
      {active ? <RotateCredential connection={connection} action={manage} /> : null}
      {!deleting ? <ConnectorActionPanel action={manage} testId="connector-manage-action" /> : null}
      <AgentManagementDialog open={deleting} title={t("connectors.delete.title")} locked={manage.busy || manage.unknown}
        onClose={manage.cancel} dataTestId="connector-delete-dialog">
        <div className="flex flex-col gap-3 text-sm">
          <p>{t("connectors.delete.explain", { name: connection.displayName })}</p>
          <ConnectorActionPanel action={manage} testId="connector-delete-action" />
        </div>
      </AgentManagementDialog>
    </div> : null}
  </div>;
}

function ConnectorRow({ connection, page, workspaceName, onChanged }: {
  connection: McpConnectionView; page: McpConnectionPage; workspaceName: (id?: string) => string; onChanged: () => void;
}) {
  const t = useT();
  const timestamp = useTimestamp();
  const healthTone = useHealthTone();
  const [open, setOpen] = useState(false);
  const active = connection.state === McpConnectionState.Active;
  return <li className="flex flex-col gap-2 rounded-xl border bg-card p-3.5" data-testid="connector-row" data-connector={connection.id}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="break-words font-medium">{connection.displayName}</p>
        <p className="break-all text-xs text-muted-foreground">{connection.endpointHost}</p>
        <p className="text-xs text-muted-foreground">
          <VisibilityText connection={connection} workspaceName={workspaceName} />
          {` · ${t("connectors.owner", { owner: connection.ownerDisplayName?.trim() || t("connectors.ownerUnknown") })}`}
          {` · ${t("connectors.toolCount", { count: connection.tools.length })}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={active ? "positive" : "neutral"}>{t(active ? "connectors.state.active" : connection.state === McpConnectionState.Disabled
          ? "connectors.state.disabled" : "connectors.state.deleted")}</Badge>
        <Badge tone={healthTone(connection.health)}><Label table={healthLabel} value={connection.health} /></Badge>
        <span className="text-xs text-muted-foreground">{t("connectors.checkedAt", { at: timestamp(connection.healthCheckedAt) })}</span>
      </div>
    </div>
    {connection.drift ? <p role="status" className="text-sm" data-testid="connector-drift">{t("connectors.drift")}</p> : null}
    <Button className="w-fit" aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? "connectors.collapse" : "connectors.details")}</Button>
    {open ? <ConnectorDetail id={connection.id} page={page} onChanged={onChanged} /> : null}
  </li>;
}

function PolicyEditor({ page, onChanged }: { page: McpConnectionPage; onChanged: () => void }) {
  const t = useT();
  const policy = page.policy;
  const [registration, setRegistration] = useState<McpMemberRegistration>(policy.memberRegistration);
  const [suffixes, setSuffixes] = useState(policy.egressHostSuffixes.join("\n"));
  const changed = useRef(onChanged);
  changed.current = onChanged;
  const action = useConnectorAction(() => changed.current());
  const list = [...new Set(suffixes.split("\n").map((line) => line.trim().toLowerCase()).filter(Boolean))];
  return <section className="flex flex-col gap-3 rounded-xl border bg-card p-3.5" data-testid="connector-policy">
    <h3 className="text-sm font-medium">{t("connectors.policy.title")}</h3>
    <label className={fieldClass}>{t("connectors.policy.members")}
      <select className={`${inputClass} w-fit`} value={registration} disabled={action.frozen} aria-label={t("connectors.policy.members")}
        onChange={(event) => setRegistration(event.target.value as McpMemberRegistration)}>
        <option value={McpMemberRegistration.Disabled}>{t("connectors.policy.members.disabled")}</option>
        <option value={McpMemberRegistration.PersonalOnly}>{t("connectors.policy.members.personalOnly")}</option>
      </select>
    </label>
    <label className={fieldClass}>{t("connectors.policy.egress")}
      <textarea className={textareaClass} value={suffixes} disabled={action.frozen} aria-label={t("connectors.policy.egress")}
        placeholder="example.com" onChange={(event) => setSuffixes(event.target.value)} />
      <span className="text-xs text-muted-foreground">{t("connectors.policy.egressHint")}</span>
    </label>
    <p className="break-words text-xs text-muted-foreground" data-testid="connector-policy-cap">{policy.platformAnyPublicHost
      ? t("connectors.policy.capAny") : t("connectors.policy.cap", { suffixes: policy.platformHostSuffixes.join(", ") || "—" })}</p>
    <Button className="w-fit" disabled={action.frozen} onClick={() => action.prepare({ actionKey: "mcp_connection.policy.update", explicitConfirmation: true,
      mcpConnectionPolicyUpdate: { memberRegistration: registration, egressHostSuffixes: list } }, "connectors.confirm.policy")}>{t("connectors.policy.save")}</Button>
    <ConnectorActionPanel action={action} testId="connector-policy-action" />
  </section>;
}

/** 设置「连接器」分类：唯一管理入口（DD-149(1)）。 */
export function ConnectorsSettingsPanel() {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("mcp-connections", () => client.mcpConnections(), { keepWhileRevalidating: true });
  const [adding, setAdding] = useState(false);
  const page = state.status === "ok" && validConnectionPage(state.data) ? state.data : null;
  const workspaceName = useWorkspaceNames(!!page && page.connections.some((connection) => !!connection.workspaceId));
  const header = <SettingsSectionHeader title={t("platform.settings.connectors")} description={t("platform.settings.connectorsDescription")}
    action={page && canAdd(page) ? <Button onClick={() => setAdding(true)}>{t("connectors.add")}</Button> : undefined} />;
  return <section className="flex min-w-0 flex-col gap-4" data-testid="settings-connectors">
    {header}
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <p className="text-xs text-muted-foreground">{t("connectors.boundary")}</p>
        <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
        {page.connections.length === 0 ? <Notice>{t("connectors.none")}</Notice>
          : <ul className="flex flex-col gap-3" data-testid="connector-list">
            {page.connections.map((connection) => <ConnectorRow key={connection.id} connection={connection} page={page}
              workspaceName={workspaceName} onChanged={reload} />)}
          </ul>}
        {page.policy.canManage ? <PolicyEditor key={page.policy.version} page={page} onChanged={reload} /> : null}
        <AddConnectorDialog open={adding} page={page} onClose={() => setAdding(false)} onCreated={reload} />
      </>}
  </section>;
}

