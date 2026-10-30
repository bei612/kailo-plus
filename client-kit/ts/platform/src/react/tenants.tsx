// DD-96：Platform Catalog 的业务 Tenant 暂停与恢复。只有 Catalog 会话且持有 Catalog
// manage 的人能读到这个视图（其余 403：说明需要的角色，不留空白）；动作键是 BFF 按当前
// 事实给出的只读提示，提交仍由 Core 完整重新准入。Web 与 Desktop 共用；Mobile 不提供此写入口。
// DD-170 (.design/20 §16): one organization table with total and paging; suspension and
// restoration confirm in a dialog that names the organization; UNKNOWN keeps the command.

import {
  ActionDispatchState,
  ActionGateState,
  TenantLifecycleActionKey,
  TenantState,
  type ActionCommand,
  type PlatformTenantPage,
  type PlatformTenantView,
} from "@client-kit/contracts";
import { useRef, useState } from "react";
import type { BffClient } from "../client";
import { newIdempotencyKey } from "../governance";
import { enumLabel, tenantStateMessages } from "../i18n";
import { TransportError, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, type Tone } from "./ui";
import { useLoad } from "./use-load";
import { CellStack, DataTable, type DataColumn } from "./data-table";
import { EmptyState, ErrorState, PermissionState, readRefusal, TableSkeleton } from "./state-views";
import { ConfirmDialog } from "./confirm-dialog";
import { PageSection, RefreshButton } from "./page-layout";
import { OutcomeNotice, RowActionsMenu, UnknownInDialog } from "./roles";

type Intent = { command: ActionCommand; name: string; slug: string };
type Outcome =
  | { kind: "recorded"; operation: string }
  | { kind: "aborted"; operation: string; reason: string }
  | { kind: "unknown"; operation?: string }
  | { kind: "rejected"; reason: string };
type Directory = { tenants: PlatformTenantView[]; complete: boolean };

const tenantTone = (state: TenantState): Tone => state === TenantState.Active ? "positive"
  : state === TenantState.Error ? "negative"
  : state === TenantState.Suspended || state === TenantState.Deleted ? "neutral" : "info";

function validPage(data: PlatformTenantPage, offset: number): boolean {
  return !!data && Array.isArray(data.tenants)
    && data.tenants.every((row) => row && typeof row.id === "string" && typeof row.name === "string"
      && typeof row.slug === "string" && Object.values(TenantState).includes(row.state)
      && (row.lifecycleActionKey === undefined
        || Object.values(TenantLifecycleActionKey).includes(row.lifecycleActionKey)))
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset));
}

/** DD-170 §16.2(3): the offset-paged directory is read to its end, bounded per round. */
async function loadTenants(client: BffClient, pages: number): Promise<Directory> {
  const tenants: PlatformTenantView[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (let index = 0; index < pages; index++) {
    const page = await client.platformTenants(offset);
    if (!validPage(page, offset)) throw new TransportError("Invalid organization page");
    for (const row of page.tenants) {
      if (seen.has(row.id)) throw new TransportError("Repeated organization");
      seen.add(row.id); tenants.push(row);
    }
    if (page.nextOffset === undefined) return { tenants, complete: true };
    offset = page.nextOffset;
  }
  return { tenants, complete: false };
}

export function PlatformTenantManagement() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const [budget, setBudget] = useState(10);
  const [state, reload] = useLoad(`platform-tenants:${budget}`, () => loadTenants(client, budget), { keepWhileRevalidating: true });
  const inFlight = useRef(false);
  // 意图不随列表刷新、翻页或对话框关闭丢失：结果不明时只能以同一幂等键重查
  const [intent, setIntent] = useState<Intent | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const unknown = outcome?.kind === "unknown";

  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await client.submitAction(intent.command);
      if (!result || result.actionKey !== intent.command.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState))
        throw new TransportError(t("platform.loadFailed"));
      if (result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.Dispatched) {
        setOutcome({ kind: "recorded", operation: result.operationId });
        setIntent(null); setDialog(false);
        reload();
      } else if (result.dispatchState === ActionDispatchState.Aborted) {
        setOutcome({ kind: "aborted", operation: result.operationId, reason: result.reason ? reasonText(result.reason) : result.dispatchState });
        setIntent(null); setDialog(false);
        reload();
      } else {
        // 未派发或派发结果不明：保留原命令与幂等键，只允许重查原请求
        setOutcome({ kind: "unknown", operation: result.operationId });
      }
    } catch (error) {
      const failed = writeFailure(error);
      if (failed.kind === "unknown") {
        setOutcome({ kind: "unknown", operation: failed.operationId });
      } else {
        setOutcome({ kind: "rejected", reason: failureText(failed) });
        setIntent(null); setDialog(false);
        reload();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const choose = (row: PlatformTenantView, key: TenantLifecycleActionKey) => {
    if (intent || inFlight.current) return;
    setOutcome(null);
    setIntent({
      // EXPLICIT：确认位随命令冻结，Core 以它判定用户已在目标详情上确认
      command: { actionKey: key, idempotencyKey: newIdempotencyKey(), tenantId: row.id, explicitConfirmation: true },
      name: row.name,
      slug: row.slug,
    });
    setDialog(true);
  };

  // 非 Catalog 会话或无 Catalog manage：说明需要的角色；能力未发布：说明未开放。保留未决意图。
  if (state.status === "error" && !intent && !outcome) {
    const refusal = readRefusal(state.error);
    if (refusal === "denied") return <PermissionState description={t("adminArea.tenants.deniedBody")} />;
    if (refusal === "missing") return <EmptyState title={t("adminArea.unavailableTitle")} description={t("adminArea.unavailableBody")} />;
  }

  const stateLabel = (row: PlatformTenantView) => enumLabel(locale, tenantStateMessages, row.state);
  const columns: DataColumn<PlatformTenantView>[] = [
    { key: "name", header: t("tenants.name"), sortValue: (row) => row.name.toLocaleLowerCase(), truncate: true, title: (row) => `${row.name} (${row.slug})`,
      cell: (row) => <CellStack primary={row.name} secondary={row.slug} mono /> },
    { key: "state", header: t("platform.state"), width: "10rem", sortValue: stateLabel,
      cell: (row) => <Badge tone={tenantTone(row.state)}>{stateLabel(row)}</Badge> },
  ];
  const suspend = intent?.command.actionKey === TenantLifecycleActionKey.TenantSuspend;

  return (
    <PageSection id="admin-tenants" title={t("tenants.title")} description={t("adminArea.tenants.description")} testId="platform-tenants">
      {outcome?.kind === "recorded" ? <OutcomeNotice tone="status">{t("workspace.lifecycle.recorded", { operation: outcome.operation })}</OutcomeNotice>
        : outcome ? <OutcomeNotice tone="alert" action={unknown && intent ? <Button disabled={busy} onClick={() => void submit()}>{t("workspace.lifecycle.retry")}</Button> : undefined}>
          {outcome.kind === "unknown"
            ? t("workspace.lifecycle.unknown", { operation: outcome.operation ?? "—" })
            : outcome.kind === "aborted"
              ? t("workspace.lifecycle.aborted", { reason: outcome.reason, operation: outcome.operation })
              : t("workspace.lifecycle.rejected", { reason: outcome.reason })}
        </OutcomeNotice> : null}
      {state.status === "pending" ? <TableSkeleton rows={4} columns={3} />
        : state.status === "error" ? <ErrorState error={state.error} onRetry={reload} />
        : <DataTable label={t("adminArea.tenants.listLabel")} rows={state.data.tenants} columns={columns} rowKey={(row) => row.id}
          toolbar={<RefreshButton onClick={reload} />}
          search={{ placeholder: t("adminArea.tenants.search"), text: (row) => `${row.name} ${row.slug} ${stateLabel(row)}` }}
          rowActions={(row) => row.lifecycleActionKey ? <RowActionsMenu name={row.name} disabled={busy || intent !== null} actions={[{
            key: "lifecycle",
            label: row.lifecycleActionKey === TenantLifecycleActionKey.TenantSuspend ? t("tenants.suspend") : t("tenants.restore"),
            danger: row.lifecycleActionKey === TenantLifecycleActionKey.TenantSuspend,
            onSelect: () => choose(row, row.lifecycleActionKey as TenantLifecycleActionKey),
          }]} /> : null} rowActionsWidth="3.5rem"
          partial={state.data.complete ? undefined : <button type="button" className="text-brand-text hover:underline" onClick={() => setBudget((n) => n + 10)}>
            {t("list.partial", { count: String(state.data.tenants.length) })} · {t("list.loadMore")}</button>}
          empty={<EmptyState title={t("adminArea.tenants.emptyTitle")} description={t("adminArea.tenants.emptyBody")} />} />}
      <ConfirmDialog open={dialog && intent !== null} testId="tenant-lifecycle-dialog" pending={busy} tone={suspend ? "danger" : "default"}
        onOpenChange={(next) => { if (next) return; setDialog(false); if (!unknown) setIntent(null); }}
        title={intent ? t(suspend ? "adminArea.tenants.suspendTitle" : "adminArea.tenants.restoreTitle", { name: intent.name }) : ""}
        description={t(suspend ? "adminArea.tenants.suspendBody" : "adminArea.tenants.restoreBody")}
        confirmLabel={unknown ? t("workspace.lifecycle.retry") : t(suspend ? "tenants.suspend" : "tenants.restore")}
        onConfirm={() => void submit()}>
        {unknown ? <UnknownInDialog operation={outcome?.kind === "unknown" ? outcome.operation : undefined} /> : null}
      </ConfirmDialog>
    </PageSection>
  );
}
