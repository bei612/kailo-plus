// 平台页（SS-WEB-01）：成员、本人审计、本人设备。Web 与 Desktop 渲染的是同
// 一份组件，数据全部经 BFF（传输由宿主经 PlatformProvider 给出）。这里没有 Relay
// 地址、没有 signer、没有 Nostr filter。
//
// 未启用的能力不在这里出现：不渲染一个点进去说「未启用」的入口。

import {
  type AuditEventPage,
  type AuditEvidenceSlot,
  BuzzIdentityState,
  type ClientKeyView,
  EvidenceSensitivity,
  type EvidenceView,
  WorkspaceMembershipState,
  type WorkspaceView,
} from "@client-kit/contracts";
import { type ReactNode, useState } from "react";
import { truncatePubkey, relativeTime } from "../format";
import {
  auditEventTypeMessages,
  buzzIdentityStateMessages,
  enumLabel,
  evidenceAuthorityMessages,
  evidenceKindMessages,
  evidenceUnavailableReasonMessages,
  workspaceMembershipStateMessages,
} from "../i18n";
import { BffError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useT } from "./context";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { type Loaded, useLoad } from "./use-load";
import { LegacySecretRefManagement, RoleManagement } from "./roles";
import { PlatformTenantManagement } from "./tenants";

/** 按读取状态渲染：载入中、结果不明（可重试）、或数据。 */
export function Resource<T>({
  state,
  reload,
  children,
}: {
  state: Loaded<T>;
  reload: () => void;
  children: (data: T) => ReactNode;
}) {
  const t = useT();
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (state.status === "error")
    return (
      <Notice role="alert">
        <span>{t("platform.loadFailed")}</span>
        <Button onClick={reload}>{t("platform.retry")}</Button>
      </Notice>
    );
  return <>{children(state.data)}</>;
}

/** 一个 Workspace 的成员，按人聚合；每人列出全部 ACTIVE 的协议公钥（DD-77）。 */
export function MembersPane({ workspaceId }: { workspaceId: string }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad(`members:${workspaceId}`, () => client.members(workspaceId));
  return (
    <Resource state={state} reload={reload}>
      {(rows) =>
        rows.length === 0 ? (
          <Notice>{t("platform.members.none")}</Notice>
        ) : (
          <Table head={[t("platform.member"), t("platform.state"), t("platform.protocolIdentity")]}>
            {rows.map((m) => (
              <tr key={m.principalId}>
                <Cell>{m.displayName}</Cell>
                <Cell>
                  <Badge
                    tone={m.state === WorkspaceMembershipState.Active ? "positive" : "neutral"}
                  >
                    {enumLabel(locale, workspaceMembershipStateMessages, m.state)}
                  </Badge>
                </Cell>
                <Cell mono>
                  {m.pubkeys.length > 0 ? m.pubkeys.map(truncatePubkey).join(" · ") : "—"}
                </Cell>
              </tr>
            ))}
          </Table>
        )
      }
    </Resource>
  );
}

/**
 * 成员页的独立形态：自己取可进入的 Workspace 并提供选择。宿主已有 Workspace 选择
 * （Web 的平台页头部）时直接用 MembersPane。
 */
export function WorkspaceMembersPage() {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("workspaces", client.workspaces);
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-6">
      <Resource state={state} reload={reload}>
      {(rows) => {
        if (rows.length === 0) return <Notice>{t("platform.noWorkspace")}</Notice>;
        // 只认列表里的：列表已经排除了进不去的
        const active = rows.find((w) => w.id === chosen)?.id ?? rows[0]?.id;
        return (
          <div className="flex flex-col gap-3">
            {rows.length > 1 ? (
              <select
                aria-label={t("platform.workspace")}
                className="h-8 w-fit rounded-md border border-input bg-transparent px-2 text-sm"
                value={active}
                onChange={(e) => setChosen(e.target.value)}
              >
                {rows.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            ) : (
              <h2 className="text-sm font-medium">{rows[0]?.name}</h2>
            )}
            {active ? <MembersPane key={active} workspaceId={active} /> : null}
          </div>
        );
      }}
      </Resource>
      <RoleManagement />
      <LegacySecretRefManagement />
      <PlatformTenantManagement />
    </div>
  );
}

/**
 * 审计页：本人在当前 Tenant 内的动作（.design/03 §14 的最小集合），以及调用方持有
 * audit permission 时的范围审计。
 */
export function AuditPage() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad("audit", client.ownAudit);
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("platform.audit.myTitle")}</h2>
        <Resource state={state} reload={reload}>
          {(rows) =>
            rows.length === 0 ? (
              <Notice>{t("platform.audit.none")}</Notice>
            ) : (
              <Table
                head={[t("platform.time"), t("platform.type"), t("platform.action"), t("platform.result")]}
              >
                {rows.map((a, i) => (
                  // 审计行没有对外 id；它们只追加、按时间排序返回，位置即身份
                  // biome-ignore lint/suspicious/noArrayIndexKey: 见上
                  <tr key={i}>
                    <Cell title={a.occurredAt}>{relativeTime(locale, a.occurredAt)}</Cell>
                    <Cell>{enumLabel(locale, auditEventTypeMessages, a.eventType)}</Cell>
                    <Cell>{a.actionKey}</Cell>
                    <Cell>
                      <Badge tone={a.decision === "ALLOW" ? "positive" : "negative"}>{a.decision}</Badge>{" "}
                      {a.resultCode}
                    </Cell>
                  </tr>
                ))}
              </Table>
            )
          }
        </Resource>
      </section>
      <ScopedAudit />
    </div>
  );
}

const isForbidden = (error: unknown) => error instanceof BffError && error.status === 403;
const isNotFound = (error: unknown) => error instanceof BffError && error.status === 404;

/** 200 回应也要合契约才用；缺字段的页当作读取失败，不当作「没有事件」。 */
function isAuditEventPage(page: unknown): page is AuditEventPage {
  if (!page || typeof page !== "object") return false;
  const { events, nextCursor } = page as Partial<AuditEventPage>;
  return Array.isArray(events)
    && (nextCursor === undefined || typeof nextCursor === "string")
    && events.every((e) => e && typeof e.id === "string" && typeof e.occurredAt === "string"
      && typeof e.eventType === "string" && typeof e.actionKey === "string"
      && typeof e.decision === "string" && typeof e.resultCode === "string"
      && Array.isArray(e.evidence)
      && e.evidence.every((slot) => slot && Number.isInteger(slot.index) && slot.index >= 0));
}

type TenantAccess = "unknown" | "allowed" | "denied";

/** 已追加的后续页只属于取得它们时的首页；首页重读或范围切换后即作废。 */
type MorePages = {
  base: AuditEventPage;
  pages: AuditEventPage[];
  status: "idle" | "loading" | "error";
};

/**
 * 范围审计（.design/03 §14）：整个 Tenant 或其中一个 Workspace。是否有权由服务端每次
 * fresh Check 决定——Tenant 范围回 403 时，有可进入的 Workspace 就让人改选 Workspace
 * （「整个组织」不可选），没有则整节不渲染；判定不明（503、网络）显示可重试的错误，
 * 不渲染成「没有事件」。
 */
function ScopedAudit() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [first, reload] = useLoad(`audit-events:${scope ?? "tenant"}`, () => client.auditEvents(scope));
  const [more, setMore] = useState<MorePages | null>(null);
  const [workspaceState, reloadWorkspaces] = useLoad("workspaces", client.workspaces);
  // 离开 Tenant 范围时记下它的判定：切回时的重读不让区块闪没，无权时保持「整个组织」不可选
  const [recordedTenant, setRecordedTenant] = useState<TenantAccess>("unknown");
  // 区块已经给出（换过范围或点过重试）后，重读期间不收起
  const [engaged, setEngaged] = useState(false);
  const tenantAccess: TenantAccess = scope !== undefined
    ? recordedTenant
    : first.status === "ok"
      ? "allowed"
      : first.status === "error" && isForbidden(first.error)
        ? "denied"
        : recordedTenant;

  const workspaces: WorkspaceView[] | null =
    workspaceState.status === "ok" && Array.isArray(workspaceState.data) ? workspaceState.data : null;
  const workspacesFailed = workspaceState.status !== "pending" && workspaces === null;

  // Tenant 无权时，只有确有可进入的 Workspace 才给出区块（Workspace auditor 从这里进入）；
  // 列表读不到属于结果不明，仍给出区块并如实说明，不当作「没有 Workspace」。
  if (tenantAccess === "denied" && (workspaceState.status === "pending" || workspaces?.length === 0))
    return null;
  if (scope === undefined && first.status === "pending" && tenantAccess !== "allowed" && !engaged)
    return null;

  const firstPage = first.status === "ok" && isAuditEventPage(first.data) ? first.data : null;
  const extra = firstPage && more?.base === firstPage ? more : null;
  const pages = firstPage ? [firstPage, ...(extra?.pages ?? [])] : [];
  const events = pages.flatMap((p) => p.events);
  const nextCursor = pages[pages.length - 1]?.nextCursor;

  const loadMore = async () => {
    if (!firstPage || !nextCursor || extra?.status === "loading") return;
    const base = firstPage;
    const loaded = extra?.pages ?? [];
    setMore({ base, pages: loaded, status: "loading" });
    try {
      const page = await client.auditEvents(scope, nextCursor);
      if (!isAuditEventPage(page)) throw new Error("audit event page does not match the contract");
      setMore((old) => (old?.base === base ? { base, pages: [...loaded, page], status: "idle" } : old));
    } catch {
      setMore((old) => (old?.base === base ? { base, pages: loaded, status: "error" } : old));
    }
  };

  return (
    <section className="flex flex-col gap-3" data-testid="scoped-audit">
      <h2 className="text-sm font-medium">{t("platform.audit.scope.title")}</h2>
      <p className="text-xs text-muted-foreground">{t("platform.audit.scope.explain")}</p>
      <ScopeSelect
        scope={scope}
        workspaces={workspaces ?? []}
        workspacesFailed={workspacesFailed}
        tenantDenied={tenantAccess === "denied"}
        reloadWorkspaces={reloadWorkspaces}
        onChange={(next) => {
          setRecordedTenant(tenantAccess);
          setEngaged(true);
          setMore(null);
          setScope(next);
        }}
      />
      {scope === undefined && tenantAccess === "denied" ? (
        <Notice role="status">{t("platform.audit.scope.tenantDenied")}</Notice>
      ) : first.status === "pending" ? (
        <Notice role="status">{t("platform.loading")}</Notice>
      ) : first.status === "error" && isForbidden(first.error) ? (
        <Notice role="alert">{t("platform.audit.scope.denied")}</Notice>
      ) : !firstPage ? (
        <Notice role="alert">
          <span>{t("platform.loadFailed")}</span>
          <Button onClick={() => { setEngaged(true); setMore(null); reload(); }}>{t("platform.retry")}</Button>
        </Notice>
      ) : events.length === 0 ? (
        <Notice>{t("platform.audit.scope.none")}</Notice>
      ) : (
        <>
          <Table
            head={[
              t("platform.time"),
              t("platform.type"),
              t("platform.action"),
              t("platform.result"),
              t("platform.workspace"),
              t("platform.audit.scope.evidence"),
            ]}
          >
            {events.map((e) => (
              <tr key={e.id}>
                <Cell title={e.occurredAt}>{relativeTime(locale, e.occurredAt)}</Cell>
                <Cell>{enumLabel(locale, auditEventTypeMessages, e.eventType)}</Cell>
                <Cell>{e.actionKey}</Cell>
                <Cell>
                  <Badge tone={e.decision === "ALLOW" ? "positive" : "negative"}>{e.decision}</Badge>{" "}
                  {e.resultCode}
                </Cell>
                <Cell>
                  {e.workspaceId === undefined
                    ? t("platform.audit.scope.tenantLevel")
                    : (workspaces?.find((w) => w.id === e.workspaceId)?.name ?? (
                      <span className="font-mono text-xs">{e.workspaceId}</span>
                    ))}
                </Cell>
                <Cell>
                  <EvidenceSlots eventId={e.id} slots={e.evidence} />
                </Cell>
              </tr>
            ))}
          </Table>
          {extra?.status === "error" ? (
            <p role="alert" className="text-sm">
              {t("platform.loadFailed")}{" "}
              <Button onClick={() => void loadMore()}>{t("platform.retry")}</Button>
            </p>
          ) : nextCursor ? (
            <Button
              className="w-fit"
              disabled={extra?.status === "loading"}
              onClick={() => void loadMore()}
            >
              {extra?.status === "loading" ? t("platform.loading") : t("platform.audit.scope.loadMore")}
            </Button>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * 范围选择：整个 Tenant，或页面已有来源（可进入的 Workspace 列表）中的一个。列表读不到
 * 时仍可选整个 Tenant，并如实说明工作区列表未载入。
 */
function ScopeSelect({
  scope,
  workspaces,
  workspacesFailed,
  tenantDenied,
  reloadWorkspaces,
  onChange,
}: {
  scope: string | undefined;
  workspaces: WorkspaceView[];
  workspacesFailed: boolean;
  tenantDenied: boolean;
  reloadWorkspaces: () => void;
  onChange: (scope: string | undefined) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t("platform.audit.scope.select")}
        className="h-8 w-fit rounded-md border border-input bg-transparent px-2 text-sm"
        value={scope ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="" disabled={tenantDenied}>
          {tenantDenied ? t("platform.audit.scope.chooseWorkspace") : t("platform.audit.scope.tenant")}
        </option>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      {workspacesFailed ? (
        <span role="alert" className="text-xs text-muted-foreground">
          {t("platform.audit.scope.workspacesFailed")}{" "}
          <Button onClick={reloadWorkspaces}>{t("platform.retry")}</Button>
        </span>
      ) : null}
    </div>
  );
}

/** 列表上的证据只有种类；点开才解引用。RESTRICTED 在列表上就标注「受限」。 */
function EvidenceSlots({ eventId, slots }: { eventId: string; slots: AuditEvidenceSlot[] }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState<number[]>([]);
  if (slots.length === 0) return <>—</>;
  const toggle = (index: number) =>
    setOpen((old) => (old.includes(index) ? old.filter((i) => i !== index) : [...old, index]));
  return (
    <div className="flex flex-col gap-1">
      {slots.map((slot) => {
        const kind = slot.kind && slot.kind in evidenceKindMessages
          ? enumLabel(locale, evidenceKindMessages, slot.kind)
          : t("platform.audit.scope.unrecognizedKind");
        return (
          <div key={slot.index} className="flex flex-col gap-1">
            <span className="flex items-center gap-1">
              <Button aria-expanded={open.includes(slot.index)} onClick={() => toggle(slot.index)}>
                {kind}
              </Button>
              {slot.sensitivity === EvidenceSensitivity.Restricted ? (
                <Badge tone="neutral">{t("platform.audit.scope.restricted")}</Badge>
              ) : null}
            </span>
            {open.includes(slot.index) ? <EvidenceDetail eventId={eventId} index={slot.index} /> : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 一条证据的解引用。只有 available 为 true 且带 stableId 才显示 ID；其余一律只显示
 * 本地化的不可用原因，绝不回退显示任何 ref 内容。
 */
function EvidenceDetail({ eventId, index }: { eventId: string; index: number }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad(`audit-evidence:${eventId}:${index}`, () =>
    client.auditEvidence(eventId, index),
  );
  if (state.status === "pending")
    return <span role="status" className="text-xs text-muted-foreground">{t("platform.loading")}</span>;
  if (state.status === "error") {
    if (isForbidden(state.error))
      return <span role="alert" className="text-xs">{t("platform.audit.scope.denied")}</span>;
    // 404 是确定结论：原证据（或事件、位置）已不存在，重试不会改变它，只显示不可用。
    // 503 与网络错误是结果不明，才给重试。
    if (isNotFound(state.error))
      return (
        <span className="text-xs text-muted-foreground" data-testid="evidence-unavailable">
          {t("platform.audit.scope.notFound")}
        </span>
      );
    return (
      <span role="alert" className="text-xs">
        {t("platform.loadFailed")} <Button onClick={reload}>{t("platform.retry")}</Button>
      </span>
    );
  }
  const view: Partial<EvidenceView> = state.data && typeof state.data === "object" ? state.data : {};
  if (view.available === true && typeof view.stableId === "string") {
    return (
      <span className="flex flex-wrap items-center gap-1 text-xs" data-testid="evidence-available">
        {view.authority && view.authority in evidenceAuthorityMessages ? (
          <span className="text-muted-foreground">
            {enumLabel(locale, evidenceAuthorityMessages, view.authority)}
          </span>
        ) : null}
        <span className="font-mono break-all">{view.stableId}</span>
        {Number.isInteger(view.version) ? (
          <span className="text-muted-foreground">
            {t("platform.audit.scope.version", { version: view.version as number })}
          </span>
        ) : null}
      </span>
    );
  }
  const reason = view.unavailableReason;
  return (
    <span className="text-xs text-muted-foreground" data-testid="evidence-unavailable">
      {reason && reason in evidenceUnavailableReasonMessages
        ? t("platform.audit.scope.unavailable", {
            reason: enumLabel(locale, evidenceUnavailableReasonMessages, reason),
          })
        : t("platform.audit.scope.unavailableUnknown")}
    </span>
  );
}

/**
 * 本人的原生设备（DD-77/79）。
 *
 * 登记只能在设备上完成——私钥在那里生成、从不离开。这里只能查看与撤销：设备丢了，
 * 应当能在任一端把它撤掉。撤销只移出这一把公钥，Relay 随即拒绝它；其他设备与
 * Web 身份不受影响。`currentDevicePubkey` 由原生宿主给出，用于标出本机。
 */
export function DevicesPage({ currentDevicePubkey }: { currentDevicePubkey?: string }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad("client-keys", client.clientKeys);
  const [revoking, setRevoking] = useState<string | null>(null);
  const failureText = useFailureText();
  const [outcome, setOutcome] = useState<WriteFailure | null>(null);

  const revoke = async (key: ClientKeyView) => {
    setRevoking(key.pubkey);
    setOutcome(null);
    try {
      await client.revokeClientKey(key.pubkey);
    } catch (e) {
      // 结果不明不说成失败：撤销可能已经生效，只能提示去确认
      setOutcome(writeFailure(e));
    } finally {
      setRevoking(null);
      reload();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{t("platform.devices.explain")}</p>
      {outcome ? (
        <div className={`text-xs ${outcome.kind === "rejected" ? "text-destructive" : ""}`} role="alert">
          {outcome.kind === "unknown"
            ? t("platform.devices.revokeUnknown", { operation: outcome.operationId ?? "—" })
            : t("platform.devices.revokeRejected", { reason: failureText(outcome) })}
        </div>
      ) : null}
      <Resource state={state} reload={reload}>
        {(keys) =>
          keys.length === 0 ? (
            <Notice>{t("platform.devices.none")}</Notice>
          ) : (
            <Table
              head={[t("platform.protocolIdentity"), t("platform.state"), t("platform.devices.added"), ""]}
            >
              {keys.map((k) => (
                <tr key={k.pubkey}>
                  <Cell mono>
                    {truncatePubkey(k.pubkey)}
                    {k.pubkey === currentDevicePubkey ? (
                      <span className="ml-2 font-sans text-muted-foreground">
                        {t("platform.devices.thisDevice")}
                      </span>
                    ) : null}
                  </Cell>
                  <Cell>
                    <Badge tone={k.state === BuzzIdentityState.Active ? "positive" : "neutral"}>
                      {enumLabel(locale, buzzIdentityStateMessages, k.state)}
                    </Badge>
                  </Cell>
                  <Cell title={k.createdAt}>{relativeTime(locale, k.createdAt)}</Cell>
                  <Cell>
                    {k.state === BuzzIdentityState.Revoking ? null : (
                      <Button disabled={revoking !== null} onClick={() => void revoke(k)}>
                        {t("platform.devices.revoke")}
                      </Button>
                    )}
                  </Cell>
                </tr>
              ))}
            </Table>
          )
        }
      </Resource>
    </div>
  );
}
