// 治理组的「用量与账单」与「业务操作」页（REQ-06、.design/14 §7、.design/11 §6–7）。
// Web 与 Desktop 渲染同一份组件，数据全部经 BFF。范围视图与用量账单由服务端按
// audit permission fresh 授权；页面只呈现服务端给出的确定状态，缺失事实不显示成零、
// 成功、失败或已结算，读取失败也不渲染成「没有」。
//
// DD-123：「组织额度」一节只对 Tenant admin 与 auditor 出现（其余 403 整节不渲染）；
// 设置走受治理动作 tenant.quota.set（显式确认、无审批），与其他治理写入共用同一
// 提交、结果不明同键重查的路径。

import {
  type ActionCommand,
  type BusinessOperationPage,
  type BusinessOperationSummary,
  type BusinessOperationView,
  TenantQuotaFeature,
  type TenantQuotaPage,
  type TenantQuotaView,
  type UsageBillingView,
  UsageSectionState,
  type WorkspaceView,
} from "@client-kit/contracts";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
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
import { type ChannelActionOutcome, useGovernedChannelAction } from "./channel-management-actions";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { Input } from "./composer/shared/ui/input";
import { useBffClient, useCurrentPrincipalId, useLocale, useT } from "./context";
import { isForbidden, ScopeSelect } from "./pages";
import { Badge, Button, Cell, Notice, Table, type Tone } from "./ui";
import { type Loaded, useLoad } from "./use-load";
// DD-168 operations list, detail and states.
import { BusinessOperationPhase, OperationUsageState, ReasonCode } from "@client-kit/contracts";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import { approvalStatusMessages, platformMessages } from "../i18n";
import { useReasonText } from "./context";
import { type DataColumn, DataTable } from "./data-table";
import { humanizeKey, IdText, type KeyValueItem, KeyValueList, Tag, Timeline, type TimelineItem } from "./key-value";
import { DetailHeader, FilterChips, PageSection, RefreshButton } from "./page-layout";
import { EmptyState, ErrorState, NoMatchState, PermissionState, readRefusal, TableSkeleton } from "./state-views";

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
      <TenantQuotaSection />
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

const QUOTA_ACTION_KEY = "tenant.quota.set";
/** contracts/domain/tenant_quota_setting.schema.json 的上限。 */
const QUOTA_LIMIT_MAX = 1_000_000_000_000;

/** 呈现顺序与 DD-123 (1) 一致；Record 保证新增额度项时编译期补齐。 */
const quotaOrder: Record<TenantQuotaFeature, number> = {
  [TenantQuotaFeature.AgentTokens]: 0,
  [TenantQuotaFeature.AutomationRuns]: 1,
  [TenantQuotaFeature.AgentMemoryWrites]: 2,
};

const quotaFeatureLabel: Record<TenantQuotaFeature, PlatformMessageKey> = {
  [TenantQuotaFeature.AgentTokens]: "quota.feature.agentTokens",
  [TenantQuotaFeature.AutomationRuns]: "quota.feature.automationRuns",
  [TenantQuotaFeature.AgentMemoryWrites]: "quota.feature.agentMemoryWrites",
};

const quotaExhaustedLabel: Record<TenantQuotaFeature, PlatformMessageKey> = {
  [TenantQuotaFeature.AgentTokens]: "quota.exhausted.agentTokens",
  [TenantQuotaFeature.AutomationRuns]: "quota.exhausted.automationRuns",
  [TenantQuotaFeature.AgentMemoryWrites]: "quota.exhausted.agentMemoryWrites",
};

/** 只接受契约内的页：额度项不重复、数值非负、时间可解析；否则按读取失败处理，不猜。 */
function validQuotas(page: TenantQuotaPage | null | undefined): TenantQuotaView[] | null {
  if (!page || !Array.isArray(page.quotas)) return null;
  const seen = new Set<string>();
  for (const q of page.quotas) {
    if (!q || typeof q.feature !== "string" || !Object.hasOwn(quotaOrder, q.feature) || seen.has(q.feature)
      || typeof q.hasAccess !== "boolean" || typeof q.hardLimit !== "boolean"
      || (q.limitPerPeriod !== undefined && !(Number.isSafeInteger(q.limitPerPeriod) && q.limitPerPeriod >= 0))
      || (q.usage !== undefined && !(typeof q.usage === "number" && Number.isFinite(q.usage) && q.usage >= 0))
      || (q.periodResetAt !== undefined && Number.isNaN(new Date(q.periodResetAt).getTime())))
      return null;
    seen.add(q.feature);
  }
  return [...page.quotas].sort((a, b) => quotaOrder[a.feature] - quotaOrder[b.feature]);
}

/** 输入框里的每月上限；只接受 0..QUOTA_LIMIT_MAX 的十进制整数。 */
function parseQuotaLimit(value: string): number | null {
  const text = value.trim();
  if (!/^\d{1,13}$/.test(text)) return null;
  const limit = Number(text);
  return Number.isSafeInteger(limit) && limit <= QUOTA_LIMIT_MAX ? limit : null;
}

function quotaOutcomeText(t: ReturnType<typeof useT>, outcome: ChannelActionOutcome): string {
  switch (outcome.kind) {
    case "recorded": return t("quota.applied", { operation: outcome.operation });
    case "waiting": return t("workspace.lifecycle.recorded", { operation: outcome.operation });
    case "unknown": return t("workspace.lifecycle.unknown", { operation: outcome.operation ?? "—" });
    case "aborted": return t("workspace.lifecycle.aborted", { reason: outcome.reason, operation: outcome.operation });
    case "rejected": return t("workspace.lifecycle.rejected", { reason: outcome.reason });
  }
}

type QuotaDraft = { quota: TenantQuotaView; value: string; step: "edit" | "review" };

/**
 * DD-123 (5)：组织额度。上限、已用与剩余直接来自 OpenMeter，缺失的事实显示「—」或「未设置」，
 * 不补零。不可用的额度项给出横幅：新的请求正在被拒绝。设置额度先填写、再核对、后提交；
 * 结果不明保留原命令与幂等键，只允许重查原请求。Core 对每次设置重新核对 Tenant manage。
 */
export function TenantQuotaSection() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad("tenant-quotas", client.tenantQuotas);
  const action = useGovernedChannelAction(reload);
  const [draft, setDraft] = useState<QuotaDraft | null>(null);
  // 读到过一次之后，刷新期间保留本节（含结论），不闪成「不存在」
  const shown = useRef(false);
  if (state.status === "ok") shown.current = true;
  // 普通成员（403）整节不出现；首次读取中也不先画一个空壳
  if (state.status === "error" && isForbidden(state.error)) return null;
  if (state.status === "pending" && !shown.current) return null;

  const quotas = state.status === "ok" ? validQuotas(state.data) : null;
  // 后端只对此刻持有 Tenant manage 的调用者给出可执行动作键；审计员只读，不出现设置入口
  const settable = state.status === "ok" && state.data?.setActionKey === QUOTA_ACTION_KEY;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const limitText = (q: TenantQuotaView) => (q.limitPerPeriod === undefined ? t("quota.notSet") : number(q.limitPerPeriod));
  const usedText = (q: TenantQuotaView) => (q.usage === undefined ? "—" : number(q.usage));
  const resetText = (at: TenantQuotaView["periodResetAt"]) => at === undefined ? "—" : t("quota.utc", {
    at: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(at)),
  });
  const locked = action.busy || action.unknown;
  const parsed = draft ? parseQuotaLimit(draft.value) : null;
  const reviewLimit = draft?.step === "review" ? parsed : null;

  const open = (quota: TenantQuotaView) => {
    if (locked) return;
    action.dismiss();
    setDraft({ quota, value: quota.limitPerPeriod === undefined ? "" : String(quota.limitPerPeriod), step: "edit" });
  };
  const review = (event: FormEvent) => {
    event.preventDefault();
    if (draft && parsed !== null) setDraft({ ...draft, step: "review" });
  };
  const confirm = async (quota: TenantQuotaView, limitPerPeriod: number) => {
    // EXPLICIT：确认位随命令冻结；幂等键由共用提交路径在首次发送前生成
    const command: Omit<ActionCommand, "idempotencyKey"> = {
      actionKey: QUOTA_ACTION_KEY,
      tenantQuotaSetting: { feature: quota.feature, limitPerPeriod },
      explicitConfirmation: true,
    };
    const result = await action.submit(command);
    if (result !== null) setDraft(null);
  };

  const outcome = action.outcome;
  return (
    <Section title={t("quota.title")} testId="tenant-quotas">
      <p className="text-xs text-muted-foreground">{t("quota.explain")}</p>
      {outcome ? (
        <div className="flex flex-wrap items-center gap-2" role={outcome.kind === "recorded" || outcome.kind === "waiting"
          ? "status" : "alert"} data-testid="tenant-quota-outcome">
          <p className="break-words text-sm">{quotaOutcomeText(t, outcome)}</p>
          {action.unknown ? (
            <Button disabled={action.busy} onClick={() => void action.submit()}>
              {action.busy ? t("platform.loading") : t("workspace.lifecycle.retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
      {state.status === "pending" ? (
        <p role="status" className="text-sm text-muted-foreground">{t("platform.loading")}</p>
      ) : !quotas ? (
        <Notice role="alert">
          <span>{t("platform.loadFailed")}</span>
          <Button onClick={reload}>{t("platform.retry")}</Button>
        </Notice>
      ) : quotas.length === 0 ? (
        <Notice>{t("quota.none")}</Notice>
      ) : (
        <>
          {quotas.filter((q) => !q.hasAccess).map((q) => (
            <p key={q.feature} role="alert" data-testid="tenant-quota-exhausted" data-feature={q.feature}
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t(quotaExhaustedLabel[q.feature])}
            </p>
          ))}
          <Table
            head={[
              t("usage.feature"),
              t("quota.limit"),
              t("quota.used"),
              t("quota.remaining"),
              t("quota.kind"),
              t("quota.resetAt"),
              t("usage.access"),
              ...(settable ? [t("platform.action")] : []),
            ]}
          >
            {quotas.map((q) => (
              <tr key={q.feature} data-testid="tenant-quota-row" data-feature={q.feature}>
                <Cell title={q.feature}>{t(quotaFeatureLabel[q.feature])}</Cell>
                <Cell mono>{limitText(q)}</Cell>
                <Cell mono>{usedText(q)}</Cell>
                <Cell mono>
                  {q.limitPerPeriod === undefined || q.usage === undefined ? "—" : number(Math.max(q.limitPerPeriod - q.usage, 0))}
                </Cell>
                <Cell>{t(q.hardLimit ? "quota.hard" : "quota.soft")}</Cell>
                <Cell>{resetText(q.periodResetAt)}</Cell>
                <Cell>
                  <Badge tone={q.hasAccess ? "positive" : "negative"}>
                    {t(q.hasAccess ? "usage.hasAccess" : "usage.noAccess")}
                  </Badge>
                </Cell>
                {settable ? (
                  <Cell>
                    <Button disabled={locked || draft !== null} onClick={() => open(q)}>{t("quota.set")}</Button>
                  </Cell>
                ) : null}
              </tr>
            ))}
          </Table>
        </>
      )}
      <Dialog open={draft !== null} onOpenChange={(next) => { if (!next && !action.busy) setDraft(null); }}>
        {draft ? (
          <DialogContent className="max-w-md" data-testid="tenant-quota-dialog">
            <DialogHeader>
              <DialogTitle>{t("quota.dialogTitle", { feature: t(quotaFeatureLabel[draft.quota.feature]) })}</DialogTitle>
              <DialogDescription>
                {t("quota.current", { limit: limitText(draft.quota), used: usedText(draft.quota) })}
              </DialogDescription>
            </DialogHeader>
            {reviewLimit !== null ? (
              <div className="flex flex-col gap-3" role="group" data-testid="tenant-quota-review">
                <p className="text-sm">
                  {t("quota.reviewText", {
                    feature: t(quotaFeatureLabel[draft.quota.feature]),
                    from: limitText(draft.quota),
                    to: number(reviewLimit),
                  })}
                </p>
                {draft.quota.usage !== undefined && reviewLimit <= draft.quota.usage ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t("quota.belowUsage", { used: usedText(draft.quota) })}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button disabled={action.busy} onClick={() => setDraft({ ...draft, step: "edit" })}>{t("platform.back")}</Button>
                  <Button disabled={action.busy} onClick={() => void confirm(draft.quota, reviewLimit)}>
                    {action.busy ? t("platform.loading") : t("quota.confirm")}
                  </Button>
                </div>
              </div>
            ) : (
              <form className="flex flex-col gap-3" onSubmit={review} noValidate>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t("quota.newLimit")}</span>
                  <Input
                    inputMode="numeric"
                    autoComplete="off"
                    data-testid="tenant-quota-input"
                    aria-invalid={draft.value.trim() !== "" && parsed === null}
                    value={draft.value}
                    onChange={(event) => setDraft({ ...draft, value: event.target.value, step: "edit" })}
                  />
                </label>
                {draft.value.trim() !== "" && parsed === null ? (
                  <p role="alert" className="text-sm text-destructive">{t("quota.invalid")}</p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setDraft(null)}>{t("platform.cancel")}</Button>
                  <Button type="submit" disabled={parsed === null}>{t("quota.review")}</Button>
                </div>
              </form>
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </Section>
  );
}

/** "mine"、"tenant" 或一个 Workspace ID。 */
type View = string;

// DD-168 (.design/20 §16): the operations page is a list of records, not a wall of text. A row
// names the action, its stage, the people and the workspace in words; identifiers, wire keys and
// usage lines live in the operation's detail, behind "Technical details" where they are copyable.

type StageGroup = "all" | "active" | "done" | "notDone" | "unknown";

const stageGroup: Record<BusinessOperationPhase, Exclude<StageGroup, "all">> = {
  [BusinessOperationPhase.Evaluating]: "active",
  [BusinessOperationPhase.AwaitingApproval]: "active",
  [BusinessOperationPhase.NotStarted]: "active",
  [BusinessOperationPhase.Running]: "active",
  [BusinessOperationPhase.CancelRequested]: "active",
  [BusinessOperationPhase.Completed]: "done",
  [BusinessOperationPhase.Applied]: "done",
  [BusinessOperationPhase.Denied]: "notDone",
  [BusinessOperationPhase.Revoked]: "notDone",
  [BusinessOperationPhase.Expired]: "notDone",
  [BusinessOperationPhase.Aborted]: "notDone",
  [BusinessOperationPhase.Failed]: "notDone",
  [BusinessOperationPhase.Canceled]: "notDone",
  [BusinessOperationPhase.Terminated]: "notDone",
  [BusinessOperationPhase.TimedOut]: "notDone",
  [BusinessOperationPhase.ProjectionDelayed]: "unknown",
  [BusinessOperationPhase.Unknown]: "unknown",
};

const stageGroupLabel: Record<StageGroup, PlatformMessageKey> = {
  all: "operations.filter.all",
  active: "operations.filter.active",
  done: "operations.filter.done",
  notDone: "operations.filter.notDone",
  unknown: "operations.filter.unknown",
};

/** One short word for a row; the full sentence (operationUsageStateMessages) is in the detail. */
const usageShort: Record<OperationUsageState, PlatformMessageKey> = {
  [OperationUsageState.NotMetered]: "operations.usage-short.not-metered",
  [OperationUsageState.NotDispatched]: "operations.usage-short.not-dispatched",
  [OperationUsageState.BillingUnavailable]: "operations.usage-short.billing-unavailable",
  [OperationUsageState.SettlementPending]: "operations.usage-short.settlement-pending",
  [OperationUsageState.Committed]: "operations.usage-short.committed",
  [OperationUsageState.Unknown]: "operations.usage-short.unknown",
  [OperationUsageState.Failed]: "operations.usage-short.failed",
};

const usageTone: Record<OperationUsageState, Tone> = {
  [OperationUsageState.NotMetered]: "neutral",
  [OperationUsageState.NotDispatched]: "neutral",
  [OperationUsageState.BillingUnavailable]: "warning",
  [OperationUsageState.SettlementPending]: "info",
  [OperationUsageState.Committed]: "positive",
  [OperationUsageState.Unknown]: "warning",
  [OperationUsageState.Failed]: "negative",
};

/** Known meters read as words; an unrecognized meter falls back to its humanized key. */
const meterLabel: Readonly<Record<string, PlatformMessageKey>> = {
  agent_tokens: "operations.meter.agent-tokens",
  automation_runs: "operations.meter.automation-runs",
  agent_memory_writes: "operations.meter.agent-memory-writes",
  component_model_tokens: "operations.meter.component-model-tokens",
  knowledge_answer_count: "operations.meter.knowledge-answers",
  data_query_count: "operations.meter.data-queries",
  file_storage_bytes: "operations.meter.file-storage-bytes",
};

type Translate = ReturnType<typeof useT>;

/** The action's name in words (same catalog as ActionLabel, without the wire key underneath). */
function actionName(t: Translate, actionKey: string): string {
  // The shared Dart catalog permits hyphens, not underscores, in message keys; round-trip so a
  // different wire action never aliases a label.
  const key = `actions.${actionKey.replaceAll("_", "-")}`;
  return key.slice("actions.".length).replaceAll("-", "_") === actionKey && Object.hasOwn(platformMessages, key)
    ? t(key as PlatformMessageKey)
    : actionKey.startsWith("task.cancel.") ? t("tasks.cancelRequest")
    : actionKey.startsWith("task.rerun.") ? t("tasks.rerunRequest") : t("actions.unknown");
}

function phaseLabel(t: Translate, phase: BusinessOperationPhase): { label: string; tone: Tone } {
  const known = businessOperationPhase[phase];
  return known ? { label: t(known.label), tone: known.tone } : { label: t("tasks.status.unknown"), tone: "neutral" };
}

function durationSeconds(op: BusinessOperationView): number | undefined {
  if (!op.terminalAt) return undefined;
  const value = (Date.parse(op.terminalAt) - Date.parse(op.createdAt)) / 1000;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function durationText(t: Translate, value: number): string {
  if (value < 60) return t("operations.seconds", { seconds: Math.round(value * 10) / 10 });
  const minutes = Math.floor(value / 60);
  if (minutes < 60) return t("operations.minutes", { minutes, seconds: Math.round(value - minutes * 60) });
  return t("operations.hours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

function absoluteTime(locale: string, value: string): string {
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium" }).format(at);
}

/** A time cell: relative, with the absolute local time on hover. */
function When({ value }: { value: string }) {
  const locale = useLocale();
  return <time dateTime={value} title={absoluteTime(locale, value)} className="whitespace-nowrap tabular-nums">
    {relativeTime(locale, value)}
  </time>;
}

type People = { names: ReadonlyMap<string, string>; pending: boolean };

/**
 * Display names for initiators and executors: organization members from the participant
 * directory, Agents from the installations of the workspaces the rows mention. Both reads are
 * bounded and authorized by the BFF; an unresolved principal reads "Unknown member" and its ID
 * stays in the detail's technical information.
 */
function usePeople(workspaceIds: readonly string[]): People {
  const client = useBffClient();
  const [humans] = useLoad("operations-people", async () => {
    const names = new Map<string, string>();
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const page = await client.conversationParticipants(cursor);
      for (const person of page?.items ?? [])
        if (person && typeof person.principalId === "string" && typeof person.displayName === "string" && person.displayName)
          names.set(person.principalId, person.displayName);
      cursor = page?.nextCursor;
      if (!cursor || seen.has(cursor)) break;
      seen.add(cursor);
    }
    return names;
  });
  const ids = [...new Set(workspaceIds)].sort().slice(0, 20);
  const [agents] = useLoad(`operations-agents:${ids.join(",")}`, async () => {
    const names = new Map<string, string>();
    await Promise.all(ids.map(async (workspaceId) => {
      try {
        let offset: number | undefined;
        for (let i = 0; i < 5; i++) {
          const page = await client.agentInstallations(workspaceId, offset);
          for (const row of page?.installations ?? [])
            if (row && typeof row.agentPrincipalId === "string" && row.agentDisplayName)
              names.set(row.agentPrincipalId, row.agentDisplayName);
          const next = page?.nextOffset;
          if (next === undefined || !Number.isSafeInteger(next) || next <= (offset ?? 0)) break;
          offset = next;
        }
      } catch {
        // An unreadable workspace leaves its Agents unnamed; it is not a failure of the list.
      }
    }));
    return names;
  });
  const names = new Map<string, string>();
  if (humans.status === "ok") humans.data.forEach((name, id) => names.set(id, name));
  if (agents.status === "ok") agents.data.forEach((name, id) => { if (!names.has(id)) names.set(id, name); });
  return { names, pending: humans.status === "pending" || agents.status === "pending" };
}

function principalName(t: Translate, me: string | null | undefined, people: People, id: string): string {
  if (id === me) return t("operations.me");
  return people.names.get(id) ?? (people.pending ? "…" : t("operations.unknownMember"));
}

function Principal({ id, people }: { id: string; people: People }) {
  const t = useT();
  const me = useCurrentPrincipalId();
  const known = id === me || people.names.has(id);
  return <span className={`block truncate ${known ? "" : "text-muted-foreground"}`}>{principalName(t, me, people, id)}</span>;
}

function workspaceName(t: Translate, workspaces: readonly WorkspaceView[], id: string | undefined): string {
  if (id === undefined) return t("operations.tenantLevel");
  return workspaces.find((w) => w.id === id)?.name ?? t("operations.workspaceUnknown");
}

/** "4 items · reconciling": the usage of a row in one line; the lines are in the detail. */
function usageSummary(t: Translate, op: BusinessOperationView): string {
  const state = t(usageShort[op.usageState] ?? "operations.usage-short.unknown");
  return op.usage.length === 0 ? state : t("operations.usageCount", { count: op.usage.length, state });
}

function PhaseBadge({ phase }: { phase: BusinessOperationPhase }) {
  const t = useT();
  const { label, tone } = phaseLabel(t, phase);
  return <Badge tone={tone}>{label}</Badge>;
}

/** Copyable identifiers and codes, folded away by default (DD-168 §16.3, §16.5). */
function TechnicalDetails({ items }: { items: readonly (KeyValueItem | false | undefined)[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return <section className="flex flex-col gap-2" data-testid="operation-technical">
    <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
      className="inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
      <ChevronRight aria-hidden className={`h-4 w-4 transition-transform duration-[140ms] ${open ? "rotate-90" : ""}`} strokeWidth={1.75} />
      {t("operations.technical")}
    </button>
    {open ? <KeyValueList items={items} /> : null}
  </section>;
}

function OperationDetail({ op, people, workspaces, onBack }: {
  op: BusinessOperationView; people: People; workspaces: readonly WorkspaceView[]; onBack: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const reasonText = useReasonText();
  const me = useCurrentPrincipalId();
  const duration = durationSeconds(op);
  const phase = phaseLabel(t, op.phase);
  const reason = op.reason !== undefined && Object.values(ReasonCode).includes(op.reason) ? reasonText(op.reason) : undefined;
  const history: TimelineItem[] = [
    { id: "created", title: t("operations.event.created"), time: absoluteTime(locale, op.createdAt),
      description: t("operations.event.createdBy", { name: principalName(t, me, people, op.initiatorPrincipalId) }), tone: "brand" },
    ...(op.approvalStatus ? [{ id: "approval", title: t("operations.event.approval"),
      description: enumLabel(locale, approvalStatusMessages, op.approvalStatus), tone: "info" as const }] : []),
    { id: "phase", title: op.terminalAt ? phase.label : t("operations.event.current", { phase: phase.label }),
      time: op.terminalAt ? absoluteTime(locale, op.terminalAt) : undefined, description: reason, tone: phase.tone },
  ];
  return <div className="flex flex-col gap-6" data-testid="operation-detail">
    <DetailHeader onBack={onBack} title={actionName(t, op.actionKey)} status={<PhaseBadge phase={op.phase} />}
      subtitle={t("operations.subtitle", {
        name: principalName(t, me, people, op.initiatorPrincipalId), time: relativeTime(locale, op.createdAt),
      })} />
    <KeyValueList columns={2} items={[
      { id: "phase", label: t("operations.phase"), value: <PhaseBadge phase={op.phase} /> },
      reason ? { id: "reason", label: t("operations.reason"), value: reason } : undefined,
      { id: "initiator", label: t("operations.initiator"), value: principalName(t, me, people, op.initiatorPrincipalId) },
      { id: "actor", label: t("operations.actor"), value: principalName(t, me, people, op.actorPrincipalId) },
      { id: "workspace", label: t("platform.workspace"), value: workspaceName(t, workspaces, op.workspaceId) },
      { id: "started", label: t("operations.startedAt"), value: absoluteTime(locale, op.createdAt) },
      op.terminalAt ? { id: "ended", label: t("operations.endedAt"), value: absoluteTime(locale, op.terminalAt) } : undefined,
      duration !== undefined ? { id: "duration", label: t("operations.duration"), value: durationText(t, duration) } : undefined,
      { id: "usage", label: t("operations.usage"), value: enumLabel(locale, operationUsageStateMessages, op.usageState) },
    ]} />
    <PageSection title={t("operations.history")}>
      <Timeline items={history} testId="operation-history" />
    </PageSection>
    <PageSection title={t("operations.usageLines")} description={t("operations.usageLinesNote")}>
      {op.usage.length === 0
        ? <EmptyState compact title={enumLabel(locale, operationUsageStateMessages, op.usageState)} />
        : <div className="overflow-hidden rounded-xl border border-border bg-card" data-testid="operation-usage-lines">
          <Table label={t("operations.usageLines")} head={[t("usage.meter"), t("usage.quantity"), t("platform.state")]}>
            {op.usage.map((u, i) => (
              // 同一 operation 的用量行按发生时间与 meter 排序返回，位置即身份
              // biome-ignore lint/suspicious/noArrayIndexKey: 见上
              <tr key={i}>
                <Cell title={u.meterKey}>{Object.hasOwn(meterLabel, u.meterKey) ? t(meterLabel[u.meterKey]!) : humanizeKey(u.meterKey)}</Cell>
                <Cell nowrap><span className="tabular-nums">{new Intl.NumberFormat(locale).format(u.quantity)}</span></Cell>
                <Cell nowrap>{enumLabel(locale, usageSettlementStatusMessages, u.status)}</Cell>
              </tr>
            ))}
          </Table>
        </div>}
    </PageSection>
    <TechnicalDetails items={[
      { id: "execution", label: t("operations.id.execution"), value: <IdText value={op.actionExecutionId} /> },
      { id: "operation", label: t("operations.id.operation"), value: <IdText value={op.operationId} /> },
      { id: "action", label: t("operations.id.action"), value: <IdText full value={op.actionKey} /> },
      { id: "version", label: t("operations.id.actionVersion"), value: String(op.actionVersion) },
      { id: "target", label: t("operations.id.target"), value: <IdText value={op.targetId} /> },
      { id: "initiator", label: t("operations.id.initiator"), value: <IdText value={op.initiatorPrincipalId} /> },
      { id: "actor", label: t("operations.id.actor"), value: <IdText value={op.actorPrincipalId} /> },
      op.workspaceId ? { id: "workspace", label: t("operations.id.workspace"), value: <IdText value={op.workspaceId} /> } : undefined,
      op.workflowKind ? { id: "kind", label: t("operations.id.workflowKind"), value: <IdText full value={op.workflowKind} /> } : undefined,
      { id: "phase", label: t("operations.id.phase"), value: <IdText full value={op.phase} /> },
      op.reason ? { id: "reason", label: t("operations.id.reason"), value: <IdText full value={op.reason} /> } : undefined,
    ]} />
  </div>;
}

type MorePages = { base: BusinessOperationPage; pages: BusinessOperationPage[]; status: "idle" | "loading" | "error" };

/** Explains a refused read of a scope in words; other failures offer a retry. */
function ScopeFailure({ error, reload, tenantScope, compact }: { error: unknown; reload: () => void; tenantScope: boolean; compact?: boolean }) {
  const t = useT();
  return readRefusal(error) === "denied"
    ? <PermissionState compact={compact} description={t(tenantScope ? "observability.tenantDenied" : "observability.denied")} />
    : <ErrorState compact={compact} error={error} onRetry={reload} />;
}

function OperationTimeline({ view, workspaces }: { view: View; workspaces: WorkspaceView[] }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const me = useCurrentPrincipalId();
  const scope = view === "mine" ? "mine" : view === "tenant" ? "tenant" : "workspace";
  const workspaceId = scope === "workspace" ? view : undefined;
  const [first, reload] = useLoad(`operations:${view}`, () => client.operations(scope, workspaceId), { keepWhileRevalidating: true });
  const [more, setMore] = useState<MorePages | null>(null);
  const [stage, setStage] = useState<StageGroup>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  // The page shown when Refresh was pressed; the button spins until a newer answer replaces it.
  const [stale, setStale] = useState<BusinessOperationPage | null>(null);
  const firstPage = first.status === "ok" ? first.data : null;
  const extra = firstPage && more?.base === firstPage ? more : null;
  const pages = firstPage ? [firstPage, ...(extra?.pages ?? [])] : [];
  const operations = pages.flatMap((p) => p.operations);
  const nextCursor = pages[pages.length - 1]?.nextCursor;
  const people = usePeople(operations.flatMap((op) => (op.workspaceId ? [op.workspaceId] : [])));
  const refreshing = stale !== null && firstPage === stale;
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
  const refresh = () => { setMore(null); setStale(firstPage); reload(); };
  const rows = stage === "all" ? operations : operations.filter((op) => stageGroup[op.phase] === stage);
  const counts = (group: StageGroup) => group === "all" ? operations.length : operations.filter((op) => stageGroup[op.phase] === group).length;
  const opened = openId ? operations.find((op) => op.actionExecutionId === openId) : undefined;
  const columns: DataColumn<BusinessOperationView>[] = [
    { key: "action", header: t("platform.action"), truncate: true, title: (op) => actionName(t, op.actionKey),
      sortValue: (op) => actionName(t, op.actionKey),
      cell: (op) => <span className="font-medium text-foreground">{actionName(t, op.actionKey)}</span> },
    { key: "phase", header: t("operations.phase"), width: "9.5rem", sortValue: (op) => phaseLabel(t, op.phase).label,
      cell: (op) => <PhaseBadge phase={op.phase} /> },
    { key: "initiator", header: t("operations.initiator"), width: "8rem", truncate: true,
      cell: (op) => <Principal id={op.initiatorPrincipalId} people={people} /> },
    { key: "actor", header: t("operations.actor"), width: "8rem", truncate: true, secondary: true,
      cell: (op) => <Principal id={op.actorPrincipalId} people={people} /> },
    { key: "workspace", header: t("platform.workspace"), width: "10rem", truncate: true, secondary: true,
      title: (op) => workspaceName(t, workspaces, op.workspaceId),
      cell: (op) => <span className={op.workspaceId === undefined ? "text-muted-foreground" : ""}>{workspaceName(t, workspaces, op.workspaceId)}</span> },
    { key: "usage", header: t("operations.usage"), width: "8.5rem", truncate: true, secondary: true,
      title: (op) => enumLabel(locale, operationUsageStateMessages, op.usageState),
      cell: (op) => <Tag tone={usageTone[op.usageState] ?? "neutral"}>{usageSummary(t, op)}</Tag> },
    { key: "duration", header: t("operations.duration"), width: "6rem", align: "end", secondary: true,
      sortValue: (op) => durationSeconds(op),
      cell: (op) => { const value = durationSeconds(op); return value === undefined ? null : <span className="whitespace-nowrap">{durationText(t, value)}</span>; } },
    { key: "time", header: t("platform.time"), width: "7.5rem", sortValue: (op) => Date.parse(op.createdAt),
      cell: (op) => <When value={op.createdAt} /> },
  ];
  const partial = nextCursor ? <span className="inline-flex flex-wrap items-center gap-2">
    {t("list.partial", { count: String(operations.length) })}
    {extra?.status === "error" ? <span role="alert" className="text-danger-text">{t("platform.loadFailed")}</span> : null}
    <button type="button" disabled={extra?.status === "loading"} onClick={() => void loadMore()}
      className="font-medium text-brand-text hover:underline disabled:opacity-60" data-testid="operations-load-more">
      {extra?.status === "loading" ? t("platform.loading") : extra?.status === "error" ? t("platform.retry") : t("list.loadMore")}
    </button>
  </span> : undefined;
  return (
    <PageSection id="operation-timeline" title={t("operations.timeline")} testId="operation-timeline"
      description={firstPage ? t(nextCursor ? "operations.windowPartial" : "operations.window", { count: operations.length }) : undefined}>
      {first.status === "pending" ? <TableSkeleton rows={8} columns={6} />
        : first.status === "error" ? <ScopeFailure error={first.error} reload={reload} tenantScope={scope === "tenant"} />
        : <>
          {opened ? <OperationDetail op={opened} people={people} workspaces={workspaces} onBack={() => setOpenId(null)} /> : null}
          <div hidden={opened !== undefined}>
            <DataTable testId="operation-table" label={t("operations.timeline")} rows={rows} columns={columns}
              rowKey={(op) => op.actionExecutionId} onRowClick={(op) => setOpenId(op.actionExecutionId)}
              search={{ placeholder: t("operations.search"), text: (op) => [
                actionName(t, op.actionKey), phaseLabel(t, op.phase).label,
                principalName(t, me, people, op.initiatorPrincipalId), principalName(t, me, people, op.actorPrincipalId),
                workspaceName(t, workspaces, op.workspaceId), usageSummary(t, op),
              ].join(" ") }}
              toolbar={<>
                <FilterChips label={t("operations.filter.label")} value={stage} onChange={setStage}
                  options={(Object.keys(stageGroupLabel) as StageGroup[]).map((value) => ({ value, label: t(stageGroupLabel[value]), count: counts(value) }))} />
                <RefreshButton onClick={refresh} pending={refreshing} />
              </>}
              empty={operations.length === 0
                ? <EmptyState icon={Activity} title={t("operations.none")} description={t(view === "mine" ? "operations.noneMine" : "operations.noneScope")} />
                : <NoMatchState onClear={() => setStage("all")} />}
              partial={partial} />
          </div>
        </>}
    </PageSection>
  );
}

function PhaseBadges({ phases }: { phases: BusinessOperationSummary["phases"] }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1">
      {phases.map((p) => {
        const { label, tone } = phaseLabel(t, p.phase);
        return (
          <Badge key={p.phase} tone={tone}>
            {label}<span className="ml-1 tabular-nums opacity-80">{p.count}</span>
          </Badge>
        );
      })}
    </div>
  );
}

function Stat({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4">
    <span className="text-xs font-medium text-muted-foreground">{label}</span>
    <div className="min-w-0">{children}</div>
  </div>;
}

type SummaryAction = BusinessOperationSummary["actions"][number];

function Summary({ workspaceId }: { workspaceId?: string }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [period, setPeriod] = useState<Period>("month");
  const [at, setAt] = useState(() => Date.now());
  const { from, to } = windowFor(period, at);
  const [state, reload] = useLoad(`operation-summary:${workspaceId ?? "tenant"}:${from}:${to}`, () =>
    client.operationSummary(from, to, workspaceId));
  const columns: DataColumn<SummaryAction>[] = [
    { key: "action", header: t("platform.action"), truncate: true, sortValue: (a) => actionName(t, a.actionKey),
      title: (a) => actionName(t, a.actionKey), cell: (a) => <span className="font-medium text-foreground">{actionName(t, a.actionKey)}</span> },
    { key: "total", header: t("usage.count"), width: "6rem", align: "end", sortValue: (a) => a.total, cell: (a) => a.total },
    { key: "phases", header: t("operations.byPhase"), width: "38%", cell: (a) => <PhaseBadges phases={a.phases} /> },
    { key: "timed", header: t("operations.timedCount"), width: "8rem", align: "end", secondary: true,
      sortValue: (a) => a.timedTerminalCount, cell: (a) => a.timedTerminalCount },
    { key: "average", header: t("operations.averageDuration"), width: "8rem", align: "end", secondary: true,
      sortValue: (a) => a.averageTerminalSeconds,
      cell: (a) => a.averageTerminalSeconds === undefined
        ? <span className="text-muted-foreground">{t("operations.notTimed")}</span>
        : <span className="whitespace-nowrap">{durationText(t, a.averageTerminalSeconds)}</span> },
  ];
  return (
    <PageSection id="operation-summary" title={t("operations.summary")} testId="operation-summary"
      description={<WindowText from={from} to={to} />}
      actions={<>
        <FilterChips label={t("observability.period")} value={period} onChange={setPeriod}
          options={(Object.keys(periodLabel) as Period[]).map((p) => ({ value: p, label: t(periodLabel[p]) }))} />
        <RefreshButton onClick={() => setAt(Date.now())} pending={state.status === "pending"} />
      </>}>
      {state.status === "pending" ? <TableSkeleton rows={4} columns={4} />
        : state.status === "error" ? <ScopeFailure error={state.error} reload={reload} tenantScope={workspaceId === undefined} />
        : state.data.total === 0 ? <EmptyState compact icon={Activity} title={t("usage.noOperations")} />
        : <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)_minmax(0,1fr)]">
            <Stat label={t("operations.totalLabel")}>
              <span className="text-[1.375rem] font-semibold leading-7 tabular-nums text-foreground">
                {new Intl.NumberFormat(locale).format(state.data.total)}
              </span>
            </Stat>
            <Stat label={t("operations.byPhase")}><PhaseBadges phases={state.data.phases} /></Stat>
            <Stat label={t("usage.operationUsage")}>
              <div className="flex flex-wrap gap-1">
                {state.data.usageStates.map((u) => (
                  <Badge key={u.state} tone={usageTone[u.state] ?? "neutral"}>
                    {enumLabel(locale, operationUsageStateMessages, u.state)}<span className="ml-1 tabular-nums opacity-80">{u.count}</span>
                  </Badge>
                ))}
              </div>
            </Stat>
          </div>
          <DataTable testId="operation-summary-actions" label={t("operations.byAction")} rows={state.data.actions}
            columns={columns} rowKey={(a) => a.actionKey} initialSort={{ key: "total", direction: "desc" }}
            empty={<EmptyState compact title={t("usage.noOperations")} />} />
        </div>}
    </PageSection>
  );
}

/** The scope picker: mine, the whole organization or one workspace (Kailo select). */
function ScopePicker({ view, onChange, workspaces }: { view: View; onChange: (view: View) => void; workspaces: WorkspaceView[] }) {
  const t = useT();
  return <label className="relative inline-flex w-fit max-w-full items-center">
    <span className="sr-only">{t("operations.scope")}</span>
    <select aria-label={t("operations.scope")} value={view} onChange={(e) => onChange(e.target.value)}
      className="h-8 min-w-48 max-w-full appearance-none truncate rounded-lg border border-input bg-background py-0 pl-3 pr-8 text-sm font-medium text-foreground shadow-xs hover:bg-accent focus-visible:border-brand focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/15">
      <option value="mine">{t("operations.mine")}</option>
      <option value="tenant">{t("platform.audit.scope.tenant")}</option>
      {workspaces.length > 0 ? <optgroup label={t("platform.workspace")}>
        {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </optgroup> : null}
    </select>
    <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 h-4 w-4 text-muted-foreground" strokeWidth={1.75} />
  </label>;
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
    <div className="mx-auto flex w-full min-w-0 max-w-6xl flex-col gap-8" data-testid="business-operations">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <p className="max-w-2xl text-sm text-muted-foreground">{t(view === "mine" ? "operations.explain" : "operations.explainScope")}</p>
        <div className="flex flex-wrap items-center gap-2">
          {workspacesFailed ? (
            <span role="alert" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              {t("platform.audit.scope.workspacesFailed")}
              <button type="button" className="font-medium text-brand-text hover:underline" onClick={reloadWorkspaces}>{t("platform.retry")}</button>
            </span>
          ) : null}
          <ScopePicker view={view} onChange={setView} workspaces={workspaces} />
        </div>
      </div>
      {view === "mine" ? null : <Summary key={`summary:${view}`} workspaceId={view === "tenant" ? undefined : view} />}
      <OperationTimeline key={`timeline:${view}`} view={view} workspaces={workspaces} />
    </div>
  );
}
