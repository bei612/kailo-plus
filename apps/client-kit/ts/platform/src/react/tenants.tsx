// DD-96：Platform Catalog 的业务 Tenant 暂停与恢复。只有 Catalog 会话且持有 Catalog
// manage 的人能读到这个视图（其余 403，整节不渲染）；动作键是 BFF 按当前事实给出的
// 只读提示，提交仍由 Core 完整重新准入。Web 与 Desktop 共用；Mobile 不提供此写入口。

import {
  ActionDispatchState,
  ActionGateState,
  TenantLifecycleActionKey,
  TenantState,
  type ActionCommand,
  type PlatformTenantView,
} from "@client-kit/contracts";
import { useRef, useState } from "react";
import { newIdempotencyKey } from "../governance";
import { enumLabel, tenantStateMessages } from "../i18n";
import { BffError, TransportError, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

type Intent = { command: ActionCommand; name: string; slug: string };
type Outcome =
  | { kind: "recorded"; operation: string }
  | { kind: "aborted"; operation: string; reason: string }
  | { kind: "unknown"; operation?: string }
  | { kind: "rejected"; reason: string };

export function PlatformTenantManagement() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const offset = offsets[pageIndex] ?? 0;
  const [state, reload] = useLoad(`platform-tenants:${offset}`, () => client.platformTenants(offset));
  const inFlight = useRef(false);
  // 意图不随列表刷新或分页丢失：结果不明时只能以同一幂等键重查
  const [intent, setIntent] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // 非 Catalog 会话、无 Catalog manage 或能力未发布：整节不出现
  if (state.status === "error" && state.error instanceof BffError
    && (state.error.status === 403 || state.error.status === 404))
    return null;
  if (state.status === "pending") return null;

  const data = state.status === "ok" ? state.data : null;
  const page = data && Array.isArray(data.tenants)
    && data.tenants.every((row) => row && typeof row.id === "string" && typeof row.name === "string"
      && typeof row.slug === "string" && Object.values(TenantState).includes(row.state)
      && (row.lifecycleActionKey === undefined
        || Object.values(TenantLifecycleActionKey).includes(row.lifecycleActionKey)))
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset))
    ? data : null;

  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setOutcome(null);
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
        setIntent(null);
        reload();
      } else if (result.dispatchState === ActionDispatchState.Aborted) {
        setOutcome({
          kind: "aborted",
          operation: result.operationId,
          reason: result.reason ? reasonText(result.reason) : result.dispatchState,
        });
        setIntent(null);
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
        setIntent(null);
        reload();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const unknown = outcome?.kind === "unknown";
  const choose = (row: PlatformTenantView, key: TenantLifecycleActionKey) => {
    setOutcome(null);
    setIntent({
      // EXPLICIT：确认位随命令冻结，Core 以它判定用户已在目标详情上确认
      command: { actionKey: key, idempotencyKey: newIdempotencyKey(), tenantId: row.id, explicitConfirmation: true },
      name: row.name,
      slug: row.slug,
    });
  };

  return (
    <section className="flex flex-col gap-3" data-testid="platform-tenants">
      <h2 className="text-sm font-medium">{t("tenants.title")}</h2>
      <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
      {intent ? (
        <div className="flex flex-col gap-2 rounded-md border p-3" role="group">
          <p>{t(intent.command.actionKey === TenantLifecycleActionKey.TenantSuspend
            ? "tenants.confirmSuspend" : "tenants.confirmRestore", { name: intent.name, slug: intent.slug })}</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void submit()}>
              {busy ? t("platform.loading") : unknown ? t("workspace.lifecycle.retry") : t("platform.confirm")}
            </Button>
            {unknown ? null : (
              <Button disabled={busy} onClick={() => setIntent(null)}>{t("platform.cancel")}</Button>
            )}
          </div>
        </div>
      ) : null}
      {outcome?.kind === "recorded" ? (
        <p role="status" className="break-words text-sm">
          {t("workspace.lifecycle.recorded", { operation: outcome.operation })}
        </p>
      ) : outcome ? (
        <p role="alert" className="break-words text-sm">
          {outcome.kind === "unknown"
            ? t("workspace.lifecycle.unknown", { operation: outcome.operation ?? "—" })
            : outcome.kind === "aborted"
              ? t("workspace.lifecycle.aborted", { reason: outcome.reason, operation: outcome.operation })
              : t("workspace.lifecycle.rejected", { reason: outcome.reason })}
        </p>
      ) : null}
      {state.status === "error" || !page ? (
        <Notice role="alert">
          {t("platform.loadFailed")}
          <Button onClick={reload}>{t("platform.retry")}</Button>
        </Notice>
      ) : (
        <>
          {page.tenants.length === 0 ? <Notice>{t("tenants.none")}</Notice> : (
            <Table head={[t("tenants.name"), t("tenants.slug"), t("platform.state"), t("platform.action")]}>
              {page.tenants.map((row) => (
                <tr key={row.id}>
                  <Cell>{row.name}</Cell>
                  <Cell mono>{row.slug}</Cell>
                  <Cell>
                    <Badge tone={row.state === TenantState.Active ? "positive" : "neutral"}>
                      {enumLabel(locale, tenantStateMessages, row.state)}
                    </Badge>
                  </Cell>
                  <Cell>
                    {row.lifecycleActionKey ? (
                      <Button
                        disabled={busy || intent !== null}
                        onClick={() => choose(row, row.lifecycleActionKey as TenantLifecycleActionKey)}
                      >
                        {row.lifecycleActionKey === TenantLifecycleActionKey.TenantSuspend
                          ? t("tenants.suspend") : t("tenants.restore")}
                      </Button>
                    ) : "—"}
                  </Cell>
                </tr>
              ))}
            </Table>
          )}
          <div className="flex gap-2">
            {pageIndex > 0 ? (
              <Button onClick={() => setPageIndex(pageIndex - 1)}>{t("roles.previous")}</Button>
            ) : null}
            {page.nextOffset !== undefined ? (
              <Button onClick={() => {
                const next = page.nextOffset as number;
                setOffsets((old) => [...old.slice(0, pageIndex + 1), next]);
                setPageIndex(pageIndex + 1);
              }}>{t("roles.next")}</Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
