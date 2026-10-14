// 治理组的「用量与账单」与「业务操作」页（REQ-06、.design/14 §7、.design/11 §6–7）。
// Web 与 Desktop 渲染同一份组件，数据全部经 BFF。范围视图与用量账单由服务端按
// audit permission fresh 授权；页面只呈现服务端给出的确定状态，缺失事实不显示成零、
// 成功、失败或已结算，读取失败也不渲染成「没有」。

import {
  type BusinessOperationPage,
  type BusinessOperationSummary,
  type OperationElement,
  type UsageBillingView,
  UsageSectionState,
  type WorkspaceView,
} from "@client-kit/contracts";
import { type ReactNode, useState } from "react";
import { relativeTime } from "../format";
import { businessOperationPhase } from "../governance";
import {
  enumLabel,
  meterUsageStateMessages,
  operationUsageStateMessages,
  type PlatformMessageKey,
  usageCustomerStateMessages,
  usageSettlementStatusMessages,
} from "../i18n";
import { useBffClient, useCurrentPrincipalId, useLocale, useT } from "./context";
import { isForbidden, ScopeSelect } from "./pages";
import { ActionLabel, Badge, Button, Cell, Notice, Table } from "./ui";
import { type Loaded, useLoad } from "./use-load";

type Period = "day" | "week" | "month";

const periodLabel: Record<Period, PlatformMessageKey> = {
  day: "observability.period.day",
  week: "observability.period.week",
  month: "observability.period.month",
};

const periodDays: Record<Period, number> = { day: 1, week: 7, month: 30 };

const isoSeconds = (at: number) => new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");

/** 区间 [from, to)，to 固定在本次读取的时刻；刷新才前移，不在渲染中漂移。 */
function windowFor(period: Period, at: number) {
  const to = Math.floor(at / 1000) * 1000;
  return { from: isoSeconds(to - periodDays[period] * 86_400_000), to: isoSeconds(to) };
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="text-sm font-medium">{children}</h2>;
}

function Section({ title, children, testId }: { title: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-3" data-testid={testId}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}

/** 范围（整个组织或一个工作区）与区间的共同控制；工作区列表读不到时如实说明。 */
function useScopeControls() {
  const client = useBffClient();
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [period, setPeriod] = useState<Period>("month");
  const [at, setAt] = useState(() => Date.now());
  const [workspaceState, reloadWorkspaces] = useLoad("workspaces", client.workspaces);
  const workspaces: WorkspaceView[] | null =
    workspaceState.status === "ok" && Array.isArray(workspaceState.data) ? workspaceState.data : null;
  return {
    scope,
    setScope,
    period,
    setPeriod,
    window: windowFor(period, at),
    refresh: () => setAt(Date.now()),
    workspaces,
    workspacesFailed: workspaceState.status !== "pending" && workspaces === null,
    reloadWorkspaces,
  };
}

function PeriodSelect({ period, onChange }: { period: Period; onChange: (period: Period) => void }) {
  const t = useT();
  return (
    <select
      aria-label={t("observability.period")}
      className="h-8 w-fit rounded-md border border-input bg-transparent px-2 text-sm"
      value={period}
      onChange={(e) => onChange(e.target.value as Period)}
    >
      {(Object.keys(periodLabel) as Period[]).map((p) => (
        <option key={p} value={p}>
          {t(periodLabel[p])}
        </option>
      ))}
    </select>
  );
}

function WindowText({ from, to }: { from: string; to: string }) {
  const t = useT();
  const locale = useLocale();
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(value));
  return <p className="text-xs text-muted-foreground">{t("observability.window", { from: format(from), to: format(to) })}</p>;
}

/** 403 是确定的「无权」，其余失败是结果不明，给重试，不渲染成空。 */
function LoadState<T>({
  state,
  reload,
  tenantScope,
  children,
}: {
  state: Loaded<T>;
  reload: () => void;
  tenantScope: boolean;
  children: (data: T) => ReactNode;
}) {
  const t = useT();
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (state.status === "error") {
    if (isForbidden(state.error))
      return <Notice role="alert">{t(tenantScope ? "observability.tenantDenied" : "observability.denied")}</Notice>;
    return (
      <Notice role="alert">
        <span>{t("platform.loadFailed")}</span>
        <Button onClick={reload}>{t("platform.retry")}</Button>
      </Notice>
    );
  }
  return <>{children(state.data)}</>;
}

function SectionState({ state }: { state: UsageSectionState }) {
  const t = useT();
  const key: Record<Exclude<UsageSectionState, UsageSectionState.Available>, PlatformMessageKey> = {
    [UsageSectionState.Unavailable]: "usage.sectionUnavailable",
    [UsageSectionState.TenantScopeOnly]: "usage.tenantScopeOnly",
    [UsageSectionState.NotProvisioned]: "usage.notProvisioned",
  };
  return state === UsageSectionState.Available ? null : (
    <p role="status" className="text-sm text-muted-foreground">{t(key[state])}</p>
  );
}

const invoiceStatusKey: Readonly<Record<string, PlatformMessageKey>> = {
  draft: "usage.invoice.draft",
  issuing: "usage.invoice.issuing",
  issued: "usage.invoice.issued",
  payment_processing: "usage.invoice.paymentProcessing",
  overdue: "usage.invoice.overdue",
  paid: "usage.invoice.paid",
  uncollectible: "usage.invoice.uncollectible",
  voided: "usage.invoice.voided",
};

function InvoiceStatus({ status }: { status: string }) {
  const t = useT();
  const key = Object.hasOwn(invoiceStatusKey, status) ? invoiceStatusKey[status] : undefined;
  return <span title={status}>{key ? t(key) : t("usage.invoice.unknown", { status })}</span>;
}

/** 用量与账单：需该范围 audit；Workspace 视图不展示 Customer 级额度与账单。 */
export function UsageBillingPage() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const controls = useScopeControls();
  const { from, to } = controls.window;
  const [state, reload] = useLoad(`usage-billing:${controls.scope ?? "tenant"}:${from}:${to}`, () =>
    client.usageBilling(from, to, controls.scope));
  return (
    <div className="flex flex-col gap-6" data-testid="usage-billing">
      <p className="text-xs text-muted-foreground">{t("usage.explain")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <ScopeSelect
          scope={controls.scope}
          workspaces={controls.workspaces ?? []}
          workspacesFailed={controls.workspacesFailed}
          tenantDenied={false}
          reloadWorkspaces={controls.reloadWorkspaces}
          onChange={controls.setScope}
        />
        <PeriodSelect period={controls.period} onChange={controls.setPeriod} />
        <Button onClick={controls.refresh}>{t("platform.refresh")}</Button>
      </div>
      <WindowText from={from} to={to} />
      <LoadState state={state} reload={reload} tenantScope={controls.scope === undefined}>
        {(view: UsageBillingView) => (
          <>
            <Section title={t("usage.customer")} testId="usage-customer">
              <span title={view.customerState}>
                <Badge tone="neutral">{enumLabel(locale, usageCustomerStateMessages, view.customerState)}</Badge>
              </span>
            </Section>
            <Section title={t("usage.committed")} testId="usage-committed">
              <p className="text-xs text-muted-foreground">{t("usage.committedNote")}</p>
              {view.meters.length === 0 ? (
                <Notice>{t("usage.noMeters")}</Notice>
              ) : (
                <Table head={[t("usage.meter"), t("usage.aggregation"), t("platform.state"), t("usage.quantity")]}>
                  {view.meters.map((m) => (
                    <tr key={m.meterKey}>
                      <Cell mono>{m.meterKey}</Cell>
                      <Cell>{m.aggregation ?? "—"}</Cell>
                      <Cell>
                        <span title={m.state}>{enumLabel(locale, meterUsageStateMessages, m.state)}</span>
                      </Cell>
                      <Cell mono>{m.quantity ?? "—"}</Cell>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
            <Section title={t("usage.entitlements")} testId="usage-entitlements">
              <SectionState state={view.entitlementState} />
              {view.entitlementState !== UsageSectionState.Available ? null : view.entitlements.length === 0 ? (
                <Notice>{t("usage.noEntitlements")}</Notice>
              ) : (
                <Table
                  head={[
                    t("usage.feature"),
                    t("usage.entitlementType"),
                    t("usage.access"),
                    t("usage.balance"),
                    t("usage.periodUsage"),
                    t("usage.overage"),
                  ]}
                >
                  {view.entitlements.map((e) => (
                    <tr key={e.featureKey}>
                      <Cell mono>{e.featureKey}</Cell>
                      <Cell>{e.entitlementType}</Cell>
                      <Cell>
                        <Badge tone={e.hasAccess ? "positive" : "negative"}>
                          {t(e.hasAccess ? "usage.hasAccess" : "usage.noAccess")}
                        </Badge>
                      </Cell>
                      <Cell mono>{e.balance ?? "—"}</Cell>
                      <Cell mono>{e.usage ?? "—"}</Cell>
                      <Cell mono>{e.overage ?? "—"}</Cell>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
            <Section title={t("usage.delivery")} testId="usage-delivery">
              {view.delivery.length === 0 ? (
                <Notice>{t("usage.noDelivery")}</Notice>
              ) : (
                <Table head={[t("platform.state"), t("usage.count")]}>
                  {view.delivery.map((d) => (
                    <tr key={d.status}>
                      <Cell>
                        <span title={d.status}>{enumLabel(locale, usageSettlementStatusMessages, d.status)}</span>
                      </Cell>
                      <Cell mono>{d.count}</Cell>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
            <Section title={t("usage.operationUsage")} testId="usage-operations">
              {view.operationUsage.length === 0 ? (
                <Notice>{t("usage.noOperations")}</Notice>
              ) : (
                <Table head={[t("platform.state"), t("usage.count")]}>
                  {view.operationUsage.map((o) => (
                    <tr key={o.state}>
                      <Cell>
                        <span title={o.state}>{enumLabel(locale, operationUsageStateMessages, o.state)}</span>
                      </Cell>
                      <Cell mono>{o.count}</Cell>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
            <Section title={t("usage.invoices")} testId="usage-invoices">
              <SectionState state={view.billingState} />
              {view.billingState !== UsageSectionState.Available ? null : view.invoices.length === 0 ? (
                <Notice>{t("usage.noInvoices")}</Notice>
              ) : (
                <Table
                  head={[
                    t("usage.invoiceNumber"),
                    t("platform.state"),
                    t("usage.total"),
                    t("usage.servicePeriod"),
                    t("usage.issuedAt"),
                  ]}
                >
                  {view.invoices.map((i) => (
                    <tr key={i.id}>
                      <Cell mono>{i.number ?? i.id}</Cell>
                      <Cell>
                        <InvoiceStatus status={i.status} />
                      </Cell>
                      <Cell mono>{i.total === undefined ? "—" : `${i.total} ${i.currency ?? ""}`.trim()}</Cell>
                      <Cell>
                        {i.servicePeriodFrom && i.servicePeriodTo ? `${i.servicePeriodFrom} – ${i.servicePeriodTo}` : "—"}
                      </Cell>
                      <Cell title={i.issuedAt}>{i.issuedAt ? relativeTime(locale, i.issuedAt) : "—"}</Cell>
                    </tr>
                  ))}
                </Table>
              )}
            </Section>
          </>
        )}
      </LoadState>
    </div>
  );
}

/** "mine"、"tenant" 或一个 Workspace ID。 */
type View = string;

function Principal({ id }: { id: string }) {
  const t = useT();
  const me = useCurrentPrincipalId();
  return id === me ? <>{t("operations.me")}</> : <span className="font-mono text-xs" title={id}>{id.slice(0, 8)}</span>;
}

function seconds(value: number) {
  return Math.round(value * 10) / 10;
}

function OperationRow({ op, workspaces }: { op: OperationElement; workspaces: WorkspaceView[] }) {
  const t = useT();
  const locale = useLocale();
  const phase = businessOperationPhase[op.phase];
  const duration = op.terminalAt
    ? (new Date(op.terminalAt).getTime() - new Date(op.createdAt).getTime()) / 1000
    : undefined;
  return (
    <tr data-testid="operation-row">
      <Cell title={op.createdAt}>{relativeTime(locale, op.createdAt)}</Cell>
      <Cell><ActionLabel actionKey={op.actionKey} /></Cell>
      <Cell>
        <span title={[op.phase, op.reason].filter(Boolean).join(" · ")}>
          <Badge tone={phase?.tone ?? "neutral"}>{phase ? t(phase.label) : op.phase}</Badge>
        </span>
      </Cell>
      <Cell><Principal id={op.initiatorPrincipalId} /></Cell>
      <Cell><Principal id={op.actorPrincipalId} /></Cell>
      <Cell>
        {op.workspaceId === undefined
          ? t("platform.audit.scope.tenantLevel")
          : (workspaces.find((w) => w.id === op.workspaceId)?.name ?? <span className="font-mono text-xs">{op.workspaceId}</span>)}
      </Cell>
      <Cell>
        <div className="flex flex-col gap-0.5">
          <span title={op.usageState}>{enumLabel(locale, operationUsageStateMessages, op.usageState)}</span>
          {op.usage.map((u, i) => (
            // 同一 operation 的用量行按发生时间与 meter 排序返回，位置即身份
            // biome-ignore lint/suspicious/noArrayIndexKey: 见上
            <span key={i} className="font-mono text-xs text-muted-foreground" title={u.status}>
              {u.meterKey} {u.quantity} · {enumLabel(locale, usageSettlementStatusMessages, u.status)}
            </span>
          ))}
        </div>
      </Cell>
      <Cell>{duration === undefined || duration < 0 ? "—" : t("operations.seconds", { seconds: seconds(duration) })}</Cell>
    </tr>
  );
}

type MorePages = { base: BusinessOperationPage; pages: BusinessOperationPage[]; status: "idle" | "loading" | "error" };

function Timeline({ view, workspaces }: { view: View; workspaces: WorkspaceView[] }) {
  const client = useBffClient();
  const t = useT();
  const scope = view === "mine" ? "mine" : view === "tenant" ? "tenant" : "workspace";
  const workspaceId = scope === "workspace" ? view : undefined;
  const [first, reload] = useLoad(`operations:${view}`, () => client.operations(scope, workspaceId));
  const [more, setMore] = useState<MorePages | null>(null);
  const firstPage = first.status === "ok" ? first.data : null;
  const extra = firstPage && more?.base === firstPage ? more : null;
  const pages = firstPage ? [firstPage, ...(extra?.pages ?? [])] : [];
  const operations = pages.flatMap((p) => p.operations);
  const nextCursor = pages[pages.length - 1]?.nextCursor;
  const loadMore = async () => {
    if (!firstPage || !nextCursor || extra?.status === "loading") return;
    const base = firstPage;
    const loaded = extra?.pages ?? [];
    setMore({ base, pages: loaded, status: "loading" });
    try {
      const page = await client.operations(scope, workspaceId, nextCursor);
      setMore((old) => (old?.base === base ? { base, pages: [...loaded, page], status: "idle" } : old));
    } catch {
      setMore((old) => (old?.base === base ? { base, pages: loaded, status: "error" } : old));
    }
  };
  return (
    <Section title={t("operations.timeline")} testId="operation-timeline">
      <div><Button onClick={() => { setMore(null); reload(); }}>{t("platform.refresh")}</Button></div>
      <LoadState state={first} reload={reload} tenantScope={scope === "tenant"}>
        {() =>
          operations.length === 0 ? (
            <Notice>{t("operations.none")}</Notice>
          ) : (
            <>
              <Table
                head={[
                  t("platform.time"),
                  t("platform.action"),
                  t("operations.phase"),
                  t("operations.initiator"),
                  t("operations.actor"),
                  t("platform.workspace"),
                  t("operations.usage"),
                  t("operations.duration"),
                ]}
              >
                {operations.map((op) => (
                  <OperationRow key={op.actionExecutionId} op={op} workspaces={workspaces} />
                ))}
              </Table>
              {extra?.status === "error" ? (
                <p role="alert" className="text-sm">
                  {t("platform.loadFailed")} <Button onClick={() => void loadMore()}>{t("platform.retry")}</Button>
                </p>
              ) : nextCursor ? (
                <Button className="w-fit" disabled={extra?.status === "loading"} onClick={() => void loadMore()}>
                  {extra?.status === "loading" ? t("platform.loading") : t("platform.audit.scope.loadMore")}
                </Button>
              ) : null}
            </>
          )
        }
      </LoadState>
    </Section>
  );
}

function PhaseBadges({ phases }: { phases: BusinessOperationSummary["phases"] }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1">
      {phases.map((p) => {
        const label = businessOperationPhase[p.phase];
        return (
          <span key={p.phase} title={p.phase}>
            <Badge tone={label?.tone ?? "neutral"}>
              {label ? t(label.label) : p.phase} {p.count}
            </Badge>
          </span>
        );
      })}
    </div>
  );
}

function Summary({ workspaceId }: { workspaceId?: string }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>("month");
  const [at, setAt] = useState(() => Date.now());
  const { from, to } = windowFor(period, at);
  const [state, reload] = useLoad(`operation-summary:${workspaceId ?? "tenant"}:${from}:${to}`, () =>
    client.operationSummary(from, to, workspaceId));
  return (
    <Section title={t("operations.summary")} testId="operation-summary">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodSelect period={period} onChange={setPeriod} />
        <Button onClick={() => setAt(Date.now())}>{t("platform.refresh")}</Button>
      </div>
      <WindowText from={from} to={to} />
      <LoadState state={state} reload={reload} tenantScope={workspaceId === undefined}>
        {(summary: BusinessOperationSummary) =>
          summary.total === 0 ? (
            <Notice>{t("usage.noOperations")}</Notice>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm">{t("operations.total", { count: summary.total })}</p>
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">{t("operations.byPhase")}</h3>
                <PhaseBadges phases={summary.phases} />
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">{t("usage.operationUsage")}</h3>
                <div className="flex flex-wrap gap-1">
                  {summary.usageStates.map((u) => (
                    <span key={u.state} title={u.state}>
                      <Badge tone="neutral">
                        {enumLabel(locale, operationUsageStateMessages, u.state)} {u.count}
                      </Badge>
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">{t("operations.byAction")}</h3>
                <Table
                  head={[
                    t("platform.action"),
                    t("usage.count"),
                    t("operations.byPhase"),
                    t("operations.timedCount"),
                    t("operations.averageDuration"),
                  ]}
                >
                  {summary.actions.map((a) => (
                    <tr key={a.actionKey}>
                      <Cell><ActionLabel actionKey={a.actionKey} /></Cell>
                      <Cell mono>{a.total}</Cell>
                      <Cell><PhaseBadges phases={a.phases} /></Cell>
                      <Cell mono>{a.timedTerminalCount}</Cell>
                      <Cell>
                        {a.averageTerminalSeconds === undefined
                          ? t("operations.notTimed")
                          : t("operations.seconds", { seconds: seconds(a.averageTerminalSeconds) })}
                      </Cell>
                    </tr>
                  ))}
                </Table>
              </div>
            </div>
          )
        }
      </LoadState>
    </Section>
  );
}

/** 业务操作：我的操作时间线；有 audit 时可切到 Tenant/Workspace 的时间线与聚合。 */
export function BusinessOperationsPage() {
  const client = useBffClient();
  const t = useT();
  const [view, setView] = useState<View>("mine");
  const [workspaceState, reloadWorkspaces] = useLoad("workspaces", client.workspaces);
  const workspaces: WorkspaceView[] =
    workspaceState.status === "ok" && Array.isArray(workspaceState.data) ? workspaceState.data : [];
  const workspacesFailed = workspaceState.status === "error";
  return (
    <div className="flex flex-col gap-6" data-testid="business-operations">
      <p className="text-xs text-muted-foreground">{t("operations.explain")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t("operations.scope")}
          className="h-8 w-fit rounded-md border border-input bg-transparent px-2 text-sm"
          value={view}
          onChange={(e) => setView(e.target.value)}
        >
          <option value="mine">{t("operations.mine")}</option>
          <option value="tenant">{t("platform.audit.scope.tenant")}</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        {workspacesFailed ? (
          <span role="alert" className="text-xs text-muted-foreground">
            {t("platform.audit.scope.workspacesFailed")} <Button onClick={reloadWorkspaces}>{t("platform.retry")}</Button>
          </span>
        ) : null}
      </div>
      {view === "mine" ? null : <Summary key={`summary:${view}`} workspaceId={view === "tenant" ? undefined : view} />}
      <Timeline key={`timeline:${view}`} view={view} workspaces={workspaces} />
    </div>
  );
}
