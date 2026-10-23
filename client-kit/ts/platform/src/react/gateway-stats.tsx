// DD-134(3) 统计与调用：模型调用取 Gateway request log（尽力而为、不作计费依据），工具调用取
// Core 子 ActionExecution 与审计；两者时延分列。超出扫描上限标 truncated，日志不可读时模型
// 计数缺失、不显示为零；单次调用不含 prompt、补全、payload、工具参数或结果正文。

import {
  GatewayAdminScope,
  GatewayCallKind,
  GatewayCallOutcome,
  GatewayStatsDimension,
  type GatewayCallDetail,
  type GatewayCallPage,
  type GatewayCallView,
  type GatewayStats,
  type GatewayStatsBucket,
  type GatewayStatsCounters,
  type WorkspaceView,
} from "@client-kit/contracts";
import { useState } from "react";
import type { GatewayCallQuery } from "../client";
import { auditEventTypeMessages, enumLabel, operationUsageStateMessages } from "../i18n";
import { useBffClient, useLocale, useReasonText, useT } from "./context";
import {
  dimensionLabel, EnumText, GatewayLoad, GatewaySection, kindLabel, OutcomeBadge, outcomeLabel,
  toolSourceLabel, useDuration, useNumber, usePercent, useTimestamp,
} from "./gateway-shared";
import { ScopeSelect } from "./pages";
import { ActionLabel, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

export function dimensionsFor(scope: GatewayAdminScope): GatewayStatsDimension[] {
  return scope === GatewayAdminScope.Platform
    ? [GatewayStatsDimension.ModelRoute, GatewayStatsDimension.Tenant]
    : [GatewayStatsDimension.ModelRoute, GatewayStatsDimension.Tool, GatewayStatsDimension.Agent, GatewayStatsDimension.Binding];
}

function Totals({ totals, modelLogAvailable }: { totals: GatewayStatsCounters; modelLogAvailable: boolean }) {
  const t = useT();
  const number = useNumber();
  const duration = useDuration();
  const percent = usePercent();
  const cards: [string, string, string?][] = [
    [t("gateway.stats.requests"), number(totals.requests)],
    [t("gateway.stats.errorRate"), percent(totals.failed, totals.requests), t("gateway.stats.errorRateHint")],
    [t("gateway.stats.denied"), number(totals.denied)],
    [t("gateway.stats.unknown"), number(totals.unknown + totals.running)],
    [t("gateway.stats.billingUnavailable"), modelLogAvailable ? number(totals.billingUnavailable) : "—", t("gateway.stats.billingUnavailableHint")],
    [t("gateway.stats.tokens"), modelLogAvailable ? number(totals.totalTokens) : "—",
      t("gateway.stats.tokenSplit", { input: number(totals.inputTokens), output: number(totals.outputTokens) })],
    [t("gateway.stats.modelLatency"), modelLogAvailable ? `${duration(totals.modelP50Ms)} / ${duration(totals.modelP95Ms)}` : "—", t("gateway.stats.modelLatencyHint")],
    [t("gateway.stats.toolLatency"), `${duration(totals.toolP50Ms)} / ${duration(totals.toolP95Ms)}`, t("gateway.stats.toolLatencyHint")],
  ];
  return <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="gateway-totals">
    {cards.map(([label, value, hint]) => <div key={label} className="flex flex-col gap-1 rounded-md border p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>)}
  </dl>;
}

/** 时间桶柱状图：SVG 几何属性 + 宿主语义色类名，不带内联样式或颜色字面量。 */
function Buckets({ buckets }: { buckets: GatewayStatsBucket[] }) {
  const t = useT();
  const timestamp = useTimestamp();
  const number = useNumber();
  if (!buckets.length) return <Notice>{t("gateway.stats.noBuckets")}</Notice>;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.requests));
  const width = 600;
  const height = 120;
  const slot = width / buckets.length;
  const bar = Math.max(1, slot * 0.7);
  return <figure className="flex flex-col gap-1" data-testid="gateway-buckets">
    <svg role="img" aria-label={t("gateway.stats.chart")} viewBox={`0 0 ${width} ${height}`} className="h-32 w-full" preserveAspectRatio="none">
      {buckets.map((bucket, index) => {
        const total = (bucket.requests / max) * (height - 4);
        const failed = (Math.min(bucket.failed + bucket.denied, bucket.requests) / max) * (height - 4);
        const x = index * slot + (slot - bar) / 2;
        return <g key={bucket.start}>
          <title>{t("gateway.stats.bucketTitle", { start: timestamp(bucket.start), requests: number(bucket.requests),
            failed: number(bucket.failed), denied: number(bucket.denied) })}</title>
          <rect x={x} y={height - total} width={bar} height={total} className="fill-primary" />
          {failed > 0 ? <rect x={x} y={height - failed} width={bar} height={failed} className="fill-destructive" /> : null}
        </g>;
      })}
    </svg>
    <figcaption className="flex justify-between text-xs text-muted-foreground">
      <span>{timestamp(buckets[0]?.start)}</span>
      <span>{t("gateway.stats.legend")}</span>
      <span>{timestamp(buckets[buckets.length - 1]?.start)}</span>
    </figcaption>
  </figure>;
}

export type StatsFilter = { dimension: GatewayStatsDimension; key: string; label?: string };

export function StatsSection({ scope, from, to, workspaceId, onDrill }: {
  scope: GatewayAdminScope; from: string; to: string; workspaceId?: string; onDrill: (filter: StatsFilter) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const number = useNumber();
  const duration = useDuration();
  const percent = usePercent();
  const options = dimensionsFor(scope);
  const [dimension, setDimension] = useState<GatewayStatsDimension>(options[0]!);
  const [state, reload] = useLoad(`gateway-stats:${dimension}:${from}:${to}:${workspaceId ?? "tenant"}`,
    () => client.gatewayStats(from, to, dimension, workspaceId));
  return <GatewaySection title={t("gateway.stats.title")} testId="gateway-stats" description={t("gateway.stats.explain")}>
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-sm">{t("gateway.stats.dimension")}
        <select aria-label={t("gateway.stats.dimension")} className="ml-2 h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={dimension} onChange={(event) => setDimension(event.target.value as GatewayStatsDimension)}>
          {options.map((option) => <option key={option} value={option}>{t(dimensionLabel[option])}</option>)}
        </select>
      </label>
      <Button onClick={reload}>{t("platform.refresh")}</Button>
    </div>
    <GatewayLoad state={state} reload={reload}>{(stats: GatewayStats) => <>
      {stats.truncated ? <p role="status" className="text-sm text-muted-foreground">{t("gateway.truncated")}</p> : null}
      {!stats.modelLogAvailable ? <p role="status" className="text-sm text-muted-foreground">{t("gateway.modelLogUnavailable")}</p> : null}
      <Totals totals={stats.totals} modelLogAvailable={stats.modelLogAvailable} />
      <Buckets buckets={stats.buckets} />
      {!stats.rows.length ? <Notice>{t("gateway.stats.noRows")}</Notice> : <div className="overflow-x-auto">
        <Table head={[t(dimensionLabel[stats.dimension]), t("gateway.stats.requests"), t("gateway.stats.errorRate"), t("gateway.stats.denied"),
          t("gateway.stats.billingUnavailable"), t("gateway.stats.tokens"), t("gateway.stats.p50p95"), t("platform.action")]}>
          {stats.rows.map((row) => {
            const p50 = row.kind === GatewayCallKind.Tool ? row.counters.toolP50Ms : row.counters.modelP50Ms ?? row.counters.toolP50Ms;
            const p95 = row.kind === GatewayCallKind.Tool ? row.counters.toolP95Ms : row.counters.modelP95Ms ?? row.counters.toolP95Ms;
            return <tr key={row.key} data-testid="gateway-stats-row">
              <Cell title={row.key}>{row.label ?? (row.key === "UNATTRIBUTED" ? t("gateway.unattributed") : row.key)}
                {row.kind ? <span className="ml-1 text-xs text-muted-foreground">· <EnumText table={kindLabel} value={row.kind} /></span> : null}</Cell>
              <Cell mono>{number(row.counters.requests)}</Cell>
              <Cell mono>{percent(row.counters.failed, row.counters.requests)}</Cell>
              <Cell mono>{number(row.counters.denied)}</Cell>
              <Cell mono>{number(row.counters.billingUnavailable)}</Cell>
              <Cell mono>{number(row.counters.totalTokens)}</Cell>
              <Cell mono>{`${duration(p50)} / ${duration(p95)}`}</Cell>
              <Cell><Button onClick={() => onDrill({ dimension: stats.dimension, key: row.key, label: row.label })}>{t("gateway.stats.drill")}</Button></Cell>
            </tr>;
          })}
        </Table>
      </div>}
    </>}</GatewayLoad>
  </GatewaySection>;
}

export function CallsSection({ scope, from, to, workspaceId, filter, onClearFilter }: {
  scope: GatewayAdminScope; from: string; to: string; workspaceId?: string; filter: StatsFilter | null; onClearFilter: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const number = useNumber();
  const duration = useDuration();
  const timestamp = useTimestamp();
  const [kind, setKind] = useState<GatewayCallKind | "">("");
  const [outcome, setOutcome] = useState<GatewayCallOutcome | "">("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const query: GatewayCallQuery = { from, to, workspaceId, kind: kind || undefined, outcome: outcome || undefined,
    dimension: filter?.dimension, key: filter?.key, cursor: cursors[index], limit: 50 };
  const [state, reload] = useLoad(`gateway-calls:${JSON.stringify(query)}`, () => client.gatewayCalls(query));
  if (selected) return <CallDetail scope={scope} callId={selected} onBack={() => setSelected(null)} />;
  const reset = () => { setCursors([undefined]); setIndex(0); };
  return <GatewaySection title={t("gateway.calls.title")} testId="gateway-calls" description={t("gateway.calls.explain")}>
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={t("gateway.calls.kind")} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={kind}
        onChange={(event) => { setKind(event.target.value as GatewayCallKind | ""); reset(); }}>
        <option value="">{t("gateway.calls.allKinds")}</option>
        {Object.values(GatewayCallKind).map((value) => <option key={value} value={value}>{t(kindLabel[value])}</option>)}
      </select>
      <select aria-label={t("gateway.calls.outcome")} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={outcome}
        onChange={(event) => { setOutcome(event.target.value as GatewayCallOutcome | ""); reset(); }}>
        <option value="">{t("gateway.calls.allOutcomes")}</option>
        {Object.values(GatewayCallOutcome).map((value) => <option key={value} value={value}>{t(outcomeLabel[value])}</option>)}
      </select>
      {filter ? <span className="flex items-center gap-2 text-sm" data-testid="gateway-calls-filter">
        {t("gateway.calls.filtered", { dimension: t(dimensionLabel[filter.dimension]), key: filter.label ?? filter.key })}
        <Button onClick={() => { onClearFilter(); reset(); }}>{t("gateway.calls.clearFilter")}</Button>
      </span> : null}
      <Button onClick={reload}>{t("platform.refresh")}</Button>
    </div>
    <GatewayLoad state={state} reload={reload}>{(page: GatewayCallPage) => <>
      {page.truncated ? <p role="status" className="text-sm text-muted-foreground">{t("gateway.truncated")}</p> : null}
      {!page.modelLogAvailable ? <p role="status" className="text-sm text-muted-foreground">{t("gateway.modelLogUnavailable")}</p> : null}
      {!page.calls.length ? <Notice>{t("gateway.calls.none")}</Notice> : <div className="overflow-x-auto">
        <Table head={[t("gateway.calls.started"), t("gateway.calls.kind"), t("gateway.calls.subject"), t("gateway.calls.outcome"),
          t("gateway.calls.duration"), t("gateway.stats.tokens"), t("platform.action")]}>
          {page.calls.map((call: GatewayCallView) => <tr key={call.callId} data-testid="gateway-call-row">
            <Cell>{timestamp(call.startedAt)}</Cell>
            <Cell><EnumText table={kindLabel} value={call.kind} /></Cell>
            <Cell title={call.callId}>{callSubject(call, scope)}</Cell>
            <Cell><OutcomeBadge outcome={call.outcome} /></Cell>
            <Cell mono>{duration(call.durationMs)}</Cell>
            <Cell mono>{number(call.totalTokens)}</Cell>
            <Cell><Button onClick={() => setSelected(call.callId)}>{t("gateway.calls.open")}</Button></Cell>
          </tr>)}
        </Table>
      </div>}
      <div className="flex gap-2">
        {index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
        {page.nextCursor ? <Button onClick={() => { setCursors((old) => [...old.slice(0, index + 1), page.nextCursor]); setIndex(index + 1); }}>{t("roles.next")}</Button> : null}
      </div>
    </>}</GatewayLoad>
  </GatewaySection>;
}

function callSubject(call: GatewayCallView, scope: GatewayAdminScope): string {
  const parts = call.kind === GatewayCallKind.Model
    ? [call.modelRouteKey, call.model, call.agentName]
    : [call.toolName, call.agentName];
  if (scope === GatewayAdminScope.Platform && call.tenantId) parts.push(call.tenantId);
  return parts.filter((part): part is string => !!part).join(" · ") || "—";
}

export function CallDetail({ scope, callId, onBack }: { scope: GatewayAdminScope; callId: string; onBack: () => void }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const reasonText = useReasonText();
  const number = useNumber();
  const duration = useDuration();
  const timestamp = useTimestamp();
  const [state, reload] = useLoad(`gateway-call:${callId}`, () => client.gatewayCall(callId));
  return <GatewaySection title={t("gateway.detail.title")} testId="gateway-call-detail" description={t("gateway.detail.explain")}>
    <Button className="w-fit" onClick={onBack}>{t("gateway.detail.back")}</Button>
    <GatewayLoad state={state} reload={reload}>{(detail: GatewayCallDetail) => {
      const call = detail.call;
      const rows: [string, string | undefined][] = [
        [t("gateway.detail.callId"), call.callId],
        [t("gateway.calls.kind"), t(kindLabel[call.kind] ?? "gateway.kind.model")],
        [t("gateway.calls.started"), timestamp(call.startedAt)],
        [t("gateway.detail.completed"), timestamp(call.completedAt)],
        [t("gateway.calls.duration"), duration(call.durationMs)],
        [t("gateway.detail.httpStatus"), call.httpStatus === undefined ? undefined : String(call.httpStatus)],
        [t("gateway.detail.reason"), call.reasonCode ? reasonText(call.reasonCode) : undefined],
        [t("gateway.dimension.tenant"), call.tenantId],
        [t("gateway.detail.workspace"), call.workspaceId],
        [t("gateway.dimension.modelRoute"), call.modelRouteKey ?? call.modelRouteResourceId],
        [t("gateway.detail.provider"), call.provider],
        [t("gateway.detail.model"), call.model],
        [t("gateway.dimension.tool"), call.toolName ?? call.toolResourceId],
        [t("gateway.tools.source"), call.toolSource ? (Object.hasOwn(toolSourceLabel, call.toolSource) ? t(toolSourceLabel[call.toolSource]) : call.toolSource) : undefined],
        [t("gateway.dimension.agent"), call.agentName ?? call.agentInstallationResourceId],
        [t("gateway.dimension.binding"), call.applicationBindingId],
        [t("gateway.stats.tokens"), call.totalTokens === undefined ? undefined
          : t("gateway.stats.tokenSplit", { input: number(call.inputTokens), output: number(call.outputTokens) })],
        [t("gateway.detail.usage"), call.usageState ? enumLabel(locale, operationUsageStateMessages, call.usageState) : undefined],
        [t("gateway.detail.operation"), call.operationId],
        [t("gateway.detail.execution"), call.actionExecutionId],
        [t("gateway.detail.requestLog"), call.requestLogId],
        [t("gateway.detail.trace"), call.traceId],
      ];
      return <>
        <div className="flex items-center gap-2"><OutcomeBadge outcome={call.outcome} /></div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm md:grid-cols-2">
          {rows.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label} className="flex gap-2">
            <dt className="text-muted-foreground">{label}</dt><dd className="break-all font-mono text-xs">{value}</dd>
          </div>)}
        </dl>
        {detail.execution ? <div className="flex flex-col gap-1 text-sm" data-testid="gateway-call-execution">
          <h3 className="font-medium">{t("gateway.detail.executionTitle")}</h3>
          <ActionLabel actionKey={detail.execution.actionKey} />
          <p className="font-mono text-xs">{t("gateway.detail.executionState", { gate: detail.execution.gateState,
            dispatch: detail.execution.dispatchState, execution: detail.execution.actionExecutionId })}</p>
          {detail.execution.reasonCode ? <p>{reasonText(detail.execution.reasonCode)}</p> : null}
          {detail.execution.parentActionExecutionId ? <p className="font-mono text-xs">{t("gateway.detail.parent",
            { execution: detail.execution.parentActionExecutionId })}</p> : null}
        </div> : scope === GatewayAdminScope.Platform ? <p className="text-xs text-muted-foreground">{t("gateway.detail.platformOnly")}</p> : null}
        <div className="flex flex-col gap-1" data-testid="gateway-call-audit">
          <h3 className="text-sm font-medium">{t("gateway.detail.audit")}</h3>
          {!detail.auditEvents.length ? <Notice>{t("gateway.detail.noAudit")}</Notice>
            : <Table head={[t("gateway.detail.occurred"), t("gateway.detail.eventType"), t("platform.action"), t("gateway.detail.decision"), t("gateway.detail.result")]}>
              {detail.auditEvents.map((event) => <tr key={event.eventId}>
                <Cell>{timestamp(event.occurredAt)}</Cell>
                <Cell>{enumLabel(locale, auditEventTypeMessages, event.eventType)}</Cell>
                <Cell><ActionLabel actionKey={event.actionKey} /></Cell>
                <Cell mono>{event.decision}</Cell>
                <Cell mono>{event.resultCode}</Cell>
              </tr>)}
            </Table>}
        </div>
      </>;
    }}</GatewayLoad>
  </GatewaySection>;
}

/** Tenant 范围的统计与调用可收窄到一个工作区（Workspace audit）。 */
export function WorkspaceScope({ scope, onChange, workspaces, workspacesFailed, reloadWorkspaces }: {
  scope: string | undefined; onChange: (scope: string | undefined) => void;
  workspaces: WorkspaceView[]; workspacesFailed: boolean; reloadWorkspaces: () => void;
}) {
  return <ScopeSelect scope={scope} workspaces={workspaces} workspacesFailed={workspacesFailed} tenantDenied={false}
    reloadWorkspaces={reloadWorkspaces} onChange={onChange} />;
}
