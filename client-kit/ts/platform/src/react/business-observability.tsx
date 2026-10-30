// 治理组的「用量与账单」与「业务操作」页（REQ-06、.design/14 §7、.design/11 §6–7）。
// Web 与 Desktop 渲染同一份组件，数据全部经 BFF。范围视图与用量账单由服务端按
// audit permission fresh 授权；页面只呈现服务端给出的确定状态，缺失事实不显示成零、
// 成功、失败或已结算，读取失败也不渲染成「没有」。
//
// DD-123：「组织额度」一节只对 Tenant admin 与 auditor 出现（其余 403 整节不渲染）；
// 设置走受治理动作 tenant.quota.set（显式确认、无审批），与其他治理写入共用同一
// 提交、结果不明同键重查的路径。
// DD-163：同一页面另有对每名成员可见的「我的用量」（只读本人），以及只对 Tenant admin 与
// auditor 出现的「按组件用量」；组织额度增加组件额度项与成员上限。

import {
  type ActionCommand,
  type BusinessOperationPage,
  type ComponentUsagePage,
  type MemberUsagePage,
  MemberUsageState,
  NativePageCategory,
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
      <MyUsageSection />
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
      {controls.scope === undefined ? <ComponentUsageSection from={from} to={to} workspaces={controls.workspaces ?? []} /> : null}
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
  [TenantQuotaFeature.ComponentTokens]: 3,
  [TenantQuotaFeature.KnowledgeAnswers]: 4,
  [TenantQuotaFeature.DataQueries]: 5,
  [TenantQuotaFeature.FileStorage]: 6,
};

const quotaFeatureLabel: Record<TenantQuotaFeature, PlatformMessageKey> = {
  [TenantQuotaFeature.AgentTokens]: "quota.feature.agentTokens",
  [TenantQuotaFeature.AutomationRuns]: "quota.feature.automationRuns",
  [TenantQuotaFeature.AgentMemoryWrites]: "quota.feature.agentMemoryWrites",
  [TenantQuotaFeature.ComponentTokens]: "quota.feature.componentTokens",
  [TenantQuotaFeature.KnowledgeAnswers]: "quota.feature.knowledgeAnswers",
  [TenantQuotaFeature.DataQueries]: "quota.feature.dataQueries",
  [TenantQuotaFeature.FileStorage]: "quota.feature.fileStorage",
};

const quotaExhaustedLabel: Record<TenantQuotaFeature, PlatformMessageKey> = {
  [TenantQuotaFeature.AgentTokens]: "quota.exhausted.agentTokens",
  [TenantQuotaFeature.AutomationRuns]: "quota.exhausted.automationRuns",
  [TenantQuotaFeature.AgentMemoryWrites]: "quota.exhausted.agentMemoryWrites",
  [TenantQuotaFeature.ComponentTokens]: "quota.exhausted.componentTokens",
  [TenantQuotaFeature.KnowledgeAnswers]: "quota.exhausted.knowledgeAnswers",
  [TenantQuotaFeature.DataQueries]: "quota.exhausted.dataQueries",
  [TenantQuotaFeature.FileStorage]: "quota.exhausted.fileStorage",
};

/** DD-163(3)：只有带成员维度的额度项可设成员上限。 */
const MEMBER_QUOTA_FEATURES: ReadonlySet<TenantQuotaFeature> = new Set([
  TenantQuotaFeature.KnowledgeAnswers,
  TenantQuotaFeature.DataQueries,
]);

/** 云盘存储以字节计量；管理员按 GiB 输入，页面按二进制单位呈现。 */
const GIB = 1_073_741_824;
const QUOTA_GIB_MAX = Math.floor(QUOTA_LIMIT_MAX / GIB);

function formatBytes(locale: string, bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unit === 0 ? 0 : 1 }).format(value)} ${units[unit]}`;
}

/** 只接受契约内的页：额度项不重复、数值非负、时间可解析；否则按读取失败处理，不猜。 */
function validQuotas(page: TenantQuotaPage | null | undefined): TenantQuotaView[] | null {
  if (!page || !Array.isArray(page.quotas)) return null;
  const seen = new Set<string>();
  for (const q of page.quotas) {
    if (!q || typeof q.feature !== "string" || !Object.hasOwn(quotaOrder, q.feature) || seen.has(q.feature)
      || typeof q.hasAccess !== "boolean" || typeof q.hardLimit !== "boolean"
      || (q.limitPerPeriod !== undefined && !(Number.isSafeInteger(q.limitPerPeriod) && q.limitPerPeriod >= 0))
      || (q.memberLimitPerPeriod !== undefined
        && !(MEMBER_QUOTA_FEATURES.has(q.feature) && Number.isSafeInteger(q.memberLimitPerPeriod) && q.memberLimitPerPeriod >= 0))
      || (q.usage !== undefined && !(typeof q.usage === "number" && Number.isFinite(q.usage) && q.usage >= 0))
      || (q.periodResetAt !== undefined && Number.isNaN(new Date(q.periodResetAt).getTime())))
      return null;
    seen.add(q.feature);
  }
  return [...page.quotas].sort((a, b) => quotaOrder[a.feature] - quotaOrder[b.feature]);
}

/** 输入框里的每月上限；只接受 0..QUOTA_LIMIT_MAX 的十进制整数（云盘存储为 0..QUOTA_GIB_MAX 的 GiB）。 */
function parseQuotaLimit(value: string, feature?: TenantQuotaFeature): number | null {
  const text = value.trim();
  if (!/^\d{1,13}$/.test(text)) return null;
  const limit = Number(text);
  if (feature === TenantQuotaFeature.FileStorage)
    return Number.isSafeInteger(limit) && limit <= QUOTA_GIB_MAX ? limit * GIB : null;
  return Number.isSafeInteger(limit) && limit <= QUOTA_LIMIT_MAX ? limit : null;
}

/** 成员上限输入：留空表示不设；否则同上限规则，且不高于组织上限。 */
function parseMemberLimit(value: string, limit: number | null): number | null | "invalid" {
  if (value.trim() === "") return null;
  const member = parseQuotaLimit(value);
  if (member === null || (limit !== null && member > limit)) return "invalid";
  return member;
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

type QuotaDraft = { quota: TenantQuotaView; value: string; member: string; step: "edit" | "review" };

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
  const plain = (value: number) => new Intl.NumberFormat(locale).format(value);
  const amount = (feature: TenantQuotaFeature, value: number) =>
    feature === TenantQuotaFeature.FileStorage ? formatBytes(locale, value) : plain(value);
  const limitText = (q: TenantQuotaView) => (q.limitPerPeriod === undefined ? t("quota.notSet") : amount(q.feature, q.limitPerPeriod));
  const usedText = (q: TenantQuotaView) => (q.usage === undefined ? "—" : amount(q.feature, q.usage));
  const memberText = (q: TenantQuotaView) => !MEMBER_QUOTA_FEATURES.has(q.feature) ? "—"
    : q.memberLimitPerPeriod === undefined ? t("quota.notSet") : plain(q.memberLimitPerPeriod);
  const resetText = (at: TenantQuotaView["periodResetAt"]) => at === undefined ? "—" : t("quota.utc", {
    at: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(at)),
  });
  const locked = action.busy || action.unknown;
  const parsed = draft ? parseQuotaLimit(draft.value, draft.quota.feature) : null;
  const memberCapable = draft !== null && MEMBER_QUOTA_FEATURES.has(draft.quota.feature);
  const parsedMember = draft && memberCapable ? parseMemberLimit(draft.member, parsed) : null;
  const draftValid = parsed !== null && parsedMember !== "invalid";
  const reviewLimit = draft?.step === "review" && draftValid ? parsed : null;
  const reviewMember = parsedMember === "invalid" ? null : parsedMember;
  const storageDraft = draft?.quota.feature === TenantQuotaFeature.FileStorage;

  const open = (quota: TenantQuotaView) => {
    if (locked) return;
    action.dismiss();
    const current = quota.limitPerPeriod === undefined ? ""
      : quota.feature === TenantQuotaFeature.FileStorage ? String(Math.floor(quota.limitPerPeriod / GIB))
        : String(quota.limitPerPeriod);
    // 每次设置是完整设置：成员上限预填现值，避免调整组织上限时被无意清除
    const member = quota.memberLimitPerPeriod === undefined ? "" : String(quota.memberLimitPerPeriod);
    setDraft({ quota, value: current, member, step: "edit" });
  };
  const review = (event: FormEvent) => {
    event.preventDefault();
    if (draft && draftValid) setDraft({ ...draft, step: "review" });
  };
  const confirm = async (quota: TenantQuotaView, limitPerPeriod: number, memberLimitPerPeriod: number | null) => {
    // EXPLICIT：确认位随命令冻结；幂等键由共用提交路径在首次发送前生成
    const command: Omit<ActionCommand, "idempotencyKey"> = {
      actionKey: QUOTA_ACTION_KEY,
      tenantQuotaSetting: memberLimitPerPeriod === null
        ? { feature: quota.feature, limitPerPeriod }
        : { feature: quota.feature, limitPerPeriod, memberLimitPerPeriod },
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
              t("quota.memberLimit"),
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
                <Cell mono>{memberText(q)}</Cell>
                <Cell mono>{usedText(q)}</Cell>
                <Cell mono>
                  {q.limitPerPeriod === undefined || q.usage === undefined ? "—" : amount(q.feature, Math.max(q.limitPerPeriod - q.usage, 0))}
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
                    to: amount(draft.quota.feature, reviewLimit),
                  })}
                </p>
                {memberCapable ? (
                  <p className="text-sm" data-testid="tenant-quota-member-review">
                    {reviewMember === null ? t("quota.memberNone") : t("quota.memberReview", { limit: plain(reviewMember) })}
                  </p>
                ) : null}
                {draft.quota.usage !== undefined && reviewLimit <= draft.quota.usage ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t("quota.belowUsage", { used: usedText(draft.quota) })}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button disabled={action.busy} onClick={() => setDraft({ ...draft, step: "edit" })}>{t("platform.back")}</Button>
                  <Button disabled={action.busy} onClick={() => void confirm(draft.quota, reviewLimit, reviewMember)}>
                    {action.busy ? t("platform.loading") : t("quota.confirm")}
                  </Button>
                </div>
              </div>
            ) : (
              <form className="flex flex-col gap-3" onSubmit={review} noValidate>
                <label className="flex flex-col gap-1 text-sm">
                  <span>{t(storageDraft ? "quota.newLimitGib" : "quota.newLimit")}</span>
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
                  <p role="alert" className="text-sm text-destructive">{t(storageDraft ? "quota.invalidGib" : "quota.invalid")}</p>
                ) : null}
                {memberCapable ? (
                  <label className="flex flex-col gap-1 text-sm">
                    <span>{t("quota.memberLimitInput")}</span>
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      data-testid="tenant-quota-member-input"
                      aria-invalid={parsedMember === "invalid"}
                      value={draft.member}
                      onChange={(event) => setDraft({ ...draft, member: event.target.value, step: "edit" })}
                    />
                  </label>
                ) : null}
                {parsedMember === "invalid" ? (
                  <p role="alert" className="text-sm text-destructive">
                    {t(parseQuotaLimit(draft.member) === null ? "quota.invalid" : "quota.memberAboveLimit")}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button onClick={() => setDraft(null)}>{t("platform.cancel")}</Button>
                  <Button type="submit" disabled={!draftValid}>{t("quota.review")}</Button>
                </div>
              </form>
            )}
          </DialogContent>
        ) : null}
      </Dialog>
    </Section>
  );
}

const memberStateKey: Record<MemberUsageState, PlatformMessageKey> = {
  [MemberUsageState.Available]: "usage.mine.state.available",
  [MemberUsageState.MemberLimitReached]: "usage.mine.state.memberLimitReached",
  [MemberUsageState.TenantExhausted]: "usage.mine.state.tenantExhausted",
  [MemberUsageState.Unavailable]: "usage.mine.state.unavailable",
};

const memberStateTone: Record<MemberUsageState, "positive" | "negative" | "neutral"> = {
  [MemberUsageState.Available]: "positive",
  [MemberUsageState.MemberLimitReached]: "negative",
  [MemberUsageState.TenantExhausted]: "negative",
  [MemberUsageState.Unavailable]: "neutral",
};

/** 只接受契约内的页：额度项与状态在封闭集合内、数值非负；否则按读取失败处理。 */
function validMyUsage(page: MemberUsagePage | null | undefined): MemberUsagePage["items"] | null {
  if (!page || !Array.isArray(page.items)) return null;
  for (const item of page.items) {
    if (!item || !Object.hasOwn(quotaOrder, item.feature) || !Object.hasOwn(memberStateKey, item.state)
      || (item.used !== undefined && !(typeof item.used === "number" && Number.isFinite(item.used) && item.used >= 0))
      || (item.memberLimitPerPeriod !== undefined && !(Number.isSafeInteger(item.memberLimitPerPeriod) && item.memberLimitPerPeriod >= 0)))
      return null;
  }
  return [...page.items].sort((a, b) => quotaOrder[a.feature] - quotaOrder[b.feature]);
}

/**
 * DD-163(4)「我的用量」：每名成员都看到本人本期已用、本人上限与是否可用；不显示组织上限与
 * 组织已用。组织额度用完只以状态提示，请成员联系管理员。
 */
export function MyUsageSection() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad("usage-me", client.myUsage);
  const items = state.status === "ok" ? validMyUsage(state.data) : null;
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return (
    <Section title={t("usage.mine.title")} testId="my-usage">
      <p className="text-xs text-muted-foreground">{t("usage.mine.explain")}</p>
      {state.status === "pending" ? (
        <p role="status" className="text-sm text-muted-foreground">{t("platform.loading")}</p>
      ) : !items ? (
        <Notice role="alert">
          <span>{t("platform.loadFailed")}</span>
          <Button onClick={reload}>{t("platform.retry")}</Button>
        </Notice>
      ) : (
        <Table head={[t("usage.feature"), t("usage.mine.used"), t("usage.mine.limit"), t("platform.state"), t("quota.resetAt")]}>
          {items.map((item) => (
            <tr key={item.feature} data-testid="my-usage-row" data-feature={item.feature} data-state={item.state}>
              <Cell title={item.feature}>{t(quotaFeatureLabel[item.feature])}</Cell>
              <Cell mono>{item.used === undefined ? "—" : number(item.used)}</Cell>
              <Cell mono>{item.memberLimitPerPeriod === undefined ? t("usage.mine.noLimit") : number(item.memberLimitPerPeriod)}</Cell>
              <Cell>
                <span role={item.state === MemberUsageState.Available ? undefined : "status"}>
                  <Badge tone={memberStateTone[item.state]}>{t(memberStateKey[item.state])}</Badge>
                </span>
              </Cell>
              <Cell>
                {item.periodResetAt === undefined ? "—" : t("quota.utc", {
                  at: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })
                    .format(new Date(item.periodResetAt)),
                })}
              </Cell>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

const componentMeterLabel: Readonly<Record<string, PlatformMessageKey>> = {
  component_model_tokens: "usage.components.meter.componentModelTokens",
  knowledge_answer_count: "usage.components.meter.knowledgeAnswers",
  data_query_count: "usage.components.meter.dataQueries",
  file_storage_bytes: "usage.components.meter.fileStorageBytes",
};

const componentCategoryLabel: Record<NativePageCategory, PlatformMessageKey> = {
  [NativePageCategory.FileStorage]: "bindings.native.files",
  [NativePageCategory.Knowledge]: "bindings.native.knowledge",
  [NativePageCategory.DataQuery]: "bindings.native.data",
};

/**
 * DD-163(4) 按组件用量：Tenant admin 与 auditor 看到所选区间内各组件 meter 按组件拆分的已入账
 * 用量，组件以呈现类别名（云盘、知识库、问数）标注；成员（403）整节不出现。
 */
export function ComponentUsageSection({ from, to, workspaces }: { from: string; to: string; workspaces: WorkspaceView[] }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad(`usage-components:${from}:${to}`, () => client.componentUsage(from, to));
  if (state.status === "error" && isForbidden(state.error)) return null;
  const page: ComponentUsagePage | null = state.status === "ok" && state.data && Array.isArray(state.data.meters)
    ? state.data : null;
  const scopeName = (workspaceId?: string) => workspaceId === undefined ? t("usage.components.wholeOrganization")
    : workspaces.find((w) => w.id === workspaceId)?.name ?? workspaceId;
  const quantity = (meter: string, value: string) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return value;
    return meter === "file_storage_bytes" ? formatBytes(locale, parsed) : new Intl.NumberFormat(locale).format(parsed);
  };
  return (
    <Section title={t("usage.components.title")} testId="component-usage">
      <p className="text-xs text-muted-foreground">{t("usage.components.explain")}</p>
      {state.status === "pending" ? (
        <p role="status" className="text-sm text-muted-foreground">{t("platform.loading")}</p>
      ) : !page ? (
        <Notice role="alert">
          <span>{t("platform.loadFailed")}</span>
          <Button onClick={reload}>{t("platform.retry")}</Button>
        </Notice>
      ) : (
        <Table head={[t("usage.meter"), t("usage.components.component"), t("usage.components.scope"), t("platform.state"), t("usage.quantity")]}>
          {page.meters.flatMap((meter) => {
            const label = Object.hasOwn(componentMeterLabel, meter.meterKey) ? t(componentMeterLabel[meter.meterKey]) : meter.meterKey;
            if (meter.bindings.length === 0) {
              return [(
                <tr key={meter.meterKey} data-testid="component-usage-row" data-meter={meter.meterKey}>
                  <Cell title={meter.meterKey}>{label}</Cell>
                  <Cell>—</Cell>
                  <Cell>—</Cell>
                  <Cell><span title={meter.state}>{enumLabel(locale, meterUsageStateMessages, meter.state)}</span></Cell>
                  <Cell mono>—</Cell>
                </tr>
              )];
            }
            return meter.bindings.map((binding) => (
              <tr key={`${meter.meterKey}:${binding.bindingId}`} data-testid="component-usage-row" data-meter={meter.meterKey}
                data-binding={binding.bindingId}>
                <Cell title={meter.meterKey}>{label}</Cell>
                <Cell>{binding.nativePageCategory ? t(componentCategoryLabel[binding.nativePageCategory]) : "—"}</Cell>
                <Cell>{scopeName(binding.workspaceId)}</Cell>
                <Cell><span title={meter.state}>{enumLabel(locale, meterUsageStateMessages, meter.state)}</span></Cell>
                <Cell mono>{quantity(meter.meterKey, binding.quantity)}</Cell>
              </tr>
            ));
          })}
        </Table>
      )}
    </Section>
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

function OperationRow({ op, workspaces }: { op: BusinessOperationView; workspaces: WorkspaceView[] }) {
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
