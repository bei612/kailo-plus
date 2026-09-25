// DD-82：角色关系只从 BFF fresh 视图读取，授予/撤销仍经同一条 Governed Action。
// Web 与 Desktop 共用；Mobile 只读成员视图，不装载本管理面。

import type { RoleMemberView } from "@kailo/contracts";
import { useState } from "react";
import { newIdempotencyKey } from "../governance";
import { BffError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useT } from "./context";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

type Change = { key: string; principal: RoleMemberView };
type Outcome =
  | { kind: "submitted"; action: string; execution: string }
  | { kind: "failed"; failure: WriteFailure };

/** Workspace 的 manage 权限不依赖频道 membership；选择列表单独从 BFF 取。 */
export function RoleManagement() {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const offset = offsets[pageIndex] ?? 0;
  const [state, reload] = useLoad(`role-workspaces:${offset}`, () => client.roleWorkspaces(offset));
  const [chosen, setChosen] = useState<string | null>(null);

  if (state.status === "pending") return null;
  if (state.status === "error")
    return (
      <Notice role="alert">
        {t("platform.loadFailed")}
        <Button onClick={reload}>{t("platform.retry")}</Button>
      </Notice>
    );
  const page = state.data;
  if (!page || !Array.isArray(page.workspaces)
    || !page.workspaces.every((w) => w && typeof w.id === "string" && typeof w.name === "string")
    || (page.nextOffset !== undefined && (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset)))
    return <Notice role="alert">{t("platform.loadFailed")}</Notice>;
  const active = page.workspaces.find((w) => w.id === chosen)?.id ?? page.workspaces[0]?.id;
  const nextOffset = page.nextOffset;
  return (
    <div className="flex flex-col gap-3" data-testid="role-management">
      {page.workspaces.length > 0 ? (
        <select
          aria-label={t("platform.workspace")}
          className="h-8 w-fit rounded-md border border-input bg-transparent px-2 text-sm"
          value={active}
          onChange={(event) => setChosen(event.target.value)}
        >
          {page.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      ) : null}
      <RoleMembers key={active ?? "tenant"} workspaceId={active} />
      <div className="flex gap-2">
        {pageIndex > 0 ? (
          <Button onClick={() => { setChosen(null); setPageIndex(pageIndex - 1); }}>
            {t("roles.previous")}
          </Button>
        ) : null}
        {nextOffset !== undefined ? (
          <Button onClick={() => {
            setChosen(null);
            setOffsets((old) => [...old.slice(0, pageIndex + 1), nextOffset]);
            setPageIndex(pageIndex + 1);
          }}>
            {t("roles.next")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function RoleMembers({ workspaceId }: { workspaceId?: string }) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex];
  const [state, reload] = useLoad(`role-members:${workspaceId ?? "tenant"}:${cursor ?? "first"}`, () =>
    client.roleMembers(workspaceId, cursor),
  );
  const [confirming, setConfirming] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [submittedFor, setSubmittedFor] = useState<string | null>(null);

  // 没有管理权限时服务端回 403，整节不出现；其他读失败必须展示为结果不明。
  if (state.status === "error" && state.error instanceof BffError && state.error.status === 403)
    return null;
  if (state.status === "pending") return null;

  const submit = async () => {
    if (!confirming) return;
    const { key, principal } = confirming;
    setConfirming(null);
    setBusy(true);
    setOutcome(null);
    try {
      const result = await client.submitAction({
        actionKey: key,
        idempotencyKey: newIdempotencyKey(),
        principalId: principal.principalId,
        ...(key.startsWith("workspace.") ? { workspaceId } : {}),
      });
      setSubmittedFor(principal.principalId);
      setOutcome({ kind: "submitted", action: key, execution: result.actionExecutionId });
    } catch (error) {
      setOutcome({ kind: "failed", failure: writeFailure(error) });
    } finally {
      setBusy(false);
      reload();
    }
  };

  const button = (member: RoleMemberView, key: string, label: string) => (
    <Button
      disabled={busy || submittedFor === member.principalId}
      onClick={() => setConfirming({ key, principal: member })}
    >
      {label}
    </Button>
  );
  const page = state.status === "ok" ? state.data : null;
  if (page && (!Array.isArray(page.members)
    || !page.members.every((m) => m && typeof m.principalId === "string"
      && typeof m.displayName === "string" && typeof m.tenantAdmin === "boolean"
      && typeof m.workspaceAdmin === "boolean" && typeof m.lastTenantAdmin === "boolean"
      && typeof m.canGrantTenantAdmin === "boolean" && typeof m.canRevokeTenantAdmin === "boolean"
      && typeof m.canGrantWorkspaceAdmin === "boolean" && typeof m.canRevokeWorkspaceAdmin === "boolean")))
    return <Notice role="alert">{t("platform.loadFailed")}</Notice>;

  return (
    <section className="flex flex-col gap-3" data-testid="role-members">
      <h2 className="text-sm font-medium">{t("roles.title")}</h2>
      <Button className="w-fit" onClick={() => { setSubmittedFor(null); reload(); }}>
        {t("platform.refresh")}
      </Button>
      {outcome ? (
        <p role="alert">
          {outcome.kind === "submitted"
            ? t("roles.submitted", { action: outcome.action, execution: outcome.execution })
            : outcome.failure.kind === "unknown"
              ? t("roles.unknown", { operation: outcome.failure.operationId ?? "—" })
              : t("roles.rejected", { reason: failureText(outcome.failure) })}
        </p>
      ) : null}
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border p-3" role="group">
          <p>{t("roles.confirm", { action: confirming.key, member: confirming.principal.displayName })}</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void submit()}>{t("platform.confirm")}</Button>
            <Button onClick={() => setConfirming(null)}>{t("platform.cancel")}</Button>
          </div>
        </div>
      ) : null}
      {state.status === "error" ? (
        <Notice role="alert">
          {t("platform.loadFailed")}
          <Button onClick={reload}>{t("platform.retry")}</Button>
        </Notice>
      ) : page ? (
          <>
            {page.members.length === 0 ? <Notice>{t("roles.none")}</Notice> : (
              <Table head={[t("platform.member"), t("roles.tenant"), t("roles.workspace")]}> 
                {page.members.map((m) => (
                  <tr key={m.principalId}>
                    <Cell>{m.displayName}</Cell>
                    <Cell>
                      {m.tenantAdmin ? <Badge tone="positive">{t("roles.tenant")}</Badge> : "—"}
                      {m.canGrantTenantAdmin ? button(m, "tenant.admin.grant", t("roles.grant")) : null}
                      {m.canRevokeTenantAdmin ? button(m, "tenant.admin.revoke", t("roles.revoke")) : null}
                      {m.lastTenantAdmin ? (
                        <span className="ml-2 text-xs text-muted-foreground" title="LAST_TENANT_ADMIN">
                          <Button disabled>{t("roles.revoke")}</Button> {t("roles.lastAdmin")}
                        </span>
                      ) : null}
                    </Cell>
                    <Cell>
                      {workspaceId ? (
                        <>
                          {m.workspaceAdmin ? <Badge tone="positive">{t("roles.workspace")}</Badge> : "—"}
                          {m.canGrantWorkspaceAdmin ? button(m, "workspace.admin.grant", t("roles.grant")) : null}
                          {m.canRevokeWorkspaceAdmin ? button(m, "workspace.admin.revoke", t("roles.revoke")) : null}
                        </>
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
              {page.nextCursor ? (
                <Button onClick={() => {
                  setCursors((old) => [...old.slice(0, pageIndex + 1), page.nextCursor]);
                  setPageIndex(pageIndex + 1);
                }}>{t("roles.next")}</Button>
              ) : null}
            </div>
          </>
      ) : null}
    </section>
  );
}
