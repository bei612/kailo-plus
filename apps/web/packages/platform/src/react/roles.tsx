// DD-82：角色关系只从 BFF fresh 视图读取，授予/撤销仍经同一条 Governed Action。
// Web 与 Desktop 共用；Mobile 只读成员视图，不装载本管理面。

import { ActionDispatchState, ActionGateState, BindingKind, CreateActionKey, WorkspaceLifecycleActionKey, WorkspaceState, type ActionCommand, type ActionSubmission, type LegacySecretRefBinding, type RoleMemberView, type RoleWorkspaceView } from "@kailo/contracts";
import { useRef, useState } from "react";
import { newIdempotencyKey, taskPhase } from "../governance";
import { enumLabel, workspaceStateMessages } from "../i18n";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

type Change = { key: string; principal: RoleMemberView; idempotencyKey: string };
type Outcome =
  | { kind: "submitted"; action: string; execution: string }
  | { kind: "failed"; failure: WriteFailure };

/** Workspace 的 manage 权限不依赖频道 membership；选择列表单独从 BFF 取。 */
export function RoleManagement() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const offset = offsets[pageIndex] ?? 0;
  const [state, reload] = useLoad(`role-workspaces:${offset}`, () => client.roleWorkspaces(offset));
  const [chosen, setChosen] = useState<string | null>(null);

  const data = state.status === "ok" ? state.data : null;
  const page = data && Array.isArray(data.workspaces)
    && data.workspaces.every((w) => w && typeof w.id === "string" && typeof w.name === "string"
      && Object.values(WorkspaceState).includes(w.state)
      && (w.lifecycleActionKey === undefined
        || Object.values(WorkspaceLifecycleActionKey).includes(w.lifecycleActionKey)))
    && (data.createActionKey === undefined || data.createActionKey === CreateActionKey.WorkspaceCreate)
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset))
    ? data : null;
  const selected = page?.workspaces.find((w) => w.id === chosen) ?? page?.workspaces[0];
  const active = selected?.id;
  // 暂停中、已暂停与恢复中的 Workspace 只在此处显示状态与恢复入口；它的 Workspace
  // scope 不可进入，角色视图退回 Tenant 级。
  const roleScope = selected?.state === WorkspaceState.Active ? active : undefined;
  const nextOffset = page?.nextOffset;
  return (
    <div className="flex flex-col gap-3" data-testid="role-management">
      {/* 创建意图不属于列表页；刷新、分页或读取失败不能卸载它、丢掉幂等键。 */}
      <CreateWorkspace actionKey={page?.createActionKey} />
      {/* 暂停/恢复意图同理，只在确定拒绝或已登记后才放下。 */}
      <WorkspaceLifecycle target={selected} onRecorded={reload} />
      <Button className="w-fit" disabled={state.status === "pending"} onClick={reload}>
        {t("platform.refresh")}
      </Button>
      {state.status === "pending" ? <p role="status">{t("platform.loading")}</p> : !page ? (
        <Notice role="alert">{t("platform.loadFailed")}</Notice>
      ) : <>
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
      {selected ? (
        <p className="flex items-center gap-2 text-sm" data-testid="workspace-state">
          <span>{t("platform.state")}</span>
          <Badge tone={selected.state === WorkspaceState.Active ? "positive" : "neutral"}>
            {enumLabel(locale, workspaceStateMessages, selected.state)}
          </Badge>
        </p>
      ) : null}
      {selected && !roleScope ? (
        <p role="status" className="text-sm text-muted-foreground" data-testid="role-scope-tenant">
          {t("roles.scopeTenantOnly", { name: selected.name })}
        </p>
      ) : null}
      <RoleMembers key={roleScope ?? "tenant"} workspaceId={roleScope} />
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
      </>}
    </div>
  );
}

/** 沿用已登记的 workspace.create；受理回应不代表 Channel/权限投影已完成。 */
function CreateWorkspace({ actionKey }: { actionKey?: CreateActionKey }) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const inFlight = useRef(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [command, setCommand] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const locked = !actionKey || busy || command !== null;
  // 页面刷新或离开后本地幂等键不复存在；服务端按本人列出的 ActionExecution 才是意图的
  // 权威。尚无结论（taskPhase 中性）的 workspace.create 在此列出，避免用户以为请求丢了
  // 而盲目再发一笔；同名标识的重复创建由 Core 的唯一约束以冲突拒绝。
  const [openTasks, reloadOpenTasks] = useLoad("workspace-create-in-flight", () => client.tasks());
  const pendingCreates = openTasks.status === "ok" && Array.isArray(openTasks.data)
    ? openTasks.data.filter((task) => task.actionKey === CreateActionKey.WorkspaceCreate
      && taskPhase(task).tone === "neutral")
    : [];

  if (!actionKey && !command && !submission && pendingCreates.length === 0 && openTasks.status !== "error")
    return null;

  const submit = async () => {
    if (!actionKey || inFlight.current || (!command && (!name.trim() || !slug.trim()))) return;
    const intent = command ?? { actionKey, idempotencyKey: newIdempotencyKey(), name: name.trim(), slug: slug.trim() };
    inFlight.current = true;
    setCommand(intent);
    setBusy(true);
    setFailure(null);
    setSubmission(null);
    try {
      const result = await client.submitAction(intent);
      if (!result || result.actionKey !== intent.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState))
        throw new TransportError(t("platform.loadFailed"));
      setSubmission(result);
      // 已取得服务端操作引用，后续终态由任务页读取。清空输入，不把旧意图再发一笔。
      setCommand(null);
      setName("");
      setSlug("");
    } catch (error) {
      const failed = writeFailure(error);
      setFailure(failed);
      // 结果不明保留原命令与幂等键；明确拒绝才允许修正输入重新提交。
      if (failed.kind !== "unknown") setCommand(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
      reloadOpenTasks();
    }
  };

  return (
    <form className="flex flex-col gap-3 rounded-md border p-3" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <h2 className="text-sm font-medium">{t("workspace.create.title")}</h2>
      <label className="flex flex-col gap-1 text-sm">
        {t("workspace.create.name")}
        <input required disabled={locked} value={name} onChange={(event) => setName(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {t("workspace.create.slug")}
        <input required disabled={locked} value={slug} onChange={(event) => setSlug(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
        <span className="text-xs text-muted-foreground">{t("workspace.create.slugHint")}</span>
      </label>
      {submission ? (
        <div role="status" className="break-words text-sm">
          <p>{t("workspace.create.recorded", { execution: submission.actionExecutionId, operation: submission.operationId, gate: submission.gateState, dispatch: submission.dispatchState })}</p>
          {submission.reason ? <p>{reasonText(submission.reason)}</p> : null}
        </div>
      ) : null}
        <Button type="submit" className="w-fit" disabled={!actionKey || busy || (!command && (!name.trim() || !slug.trim()))}>
          {busy ? t("platform.loading") : command ? t("workspace.create.retry") : t("workspace.create.title")}
        </Button>
      {openTasks.status === "error" ? (
        <Notice role="alert">
          {t("workspace.create.inFlightUnavailable")}
          <Button onClick={reloadOpenTasks}>{t("platform.retry")}</Button>
        </Notice>
      ) : pendingCreates.length > 0 ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p className="font-medium">{t("workspace.create.inFlight")}</p>
          {pendingCreates.map((task) => (
            <p key={task.actionExecutionId} className="break-words">
              {t("workspace.create.inFlightItem", { status: t(taskPhase(task).label), operation: task.operationId })}
            </p>
          ))}
        </div>
      ) : null}
      {failure ? <p role="alert" className="text-sm">
        {failure.kind === "unknown"
          ? t("workspace.create.unknown", { operation: failure.operationId ?? "—" })
          : t("roles.rejected", { reason: failureText(failure) })}
      </p> : null}
    </form>
  );
}

type LifecycleIntent = { command: ActionCommand; name: string };
type LifecycleOutcome =
  | { kind: "recorded"; operation: string }
  | { kind: "aborted"; operation: string; reason: string }
  | { kind: "unknown"; operation?: string }
  | { kind: "rejected"; reason: string };

/**
 * `.design/06` §7.3：暂停与恢复从 Tenant scope 发起。按钮只在 BFF 按当前事实给出动作
 * 键时出现，提交仍由 Core 重新准入；受理回应只说明已登记，终态到任务页查看。
 */
function WorkspaceLifecycle({ target, onRecorded }: { target?: RoleWorkspaceView; onRecorded: () => void }) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const inFlight = useRef(false);
  const [intent, setIntent] = useState<LifecycleIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null);

  const key = target?.lifecycleActionKey;
  if (!key && !intent && !outcome) return null;

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
        // 已派发只说明已登记，终态到任务页查看
        setOutcome({ kind: "recorded", operation: result.operationId });
        setIntent(null);
        onRecorded();
      } else if (result.dispatchState === ActionDispatchState.Aborted) {
        setOutcome({
          kind: "aborted",
          operation: result.operationId,
          reason: result.reason ? reasonText(result.reason) : result.dispatchState,
        });
        setIntent(null);
        onRecorded();
      } else {
        // 未派发或派发结果不明：保留原命令与幂等键，只允许重查原请求
        setOutcome({ kind: "unknown", operation: result.operationId });
      }
    } catch (error) {
      const failed = writeFailure(error);
      if (failed.kind === "unknown") {
        setOutcome({ kind: "unknown", operation: failed.operationId });
      } else {
        // 明确拒绝才放下这次意图
        setOutcome({ kind: "rejected", reason: failureText(failed) });
        setIntent(null);
        onRecorded();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const unknown = outcome?.kind === "unknown";
  return (
    <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="workspace-lifecycle">
      {key && target && !intent ? (
        <Button className="w-fit" disabled={busy} onClick={() => {
          setOutcome(null);
          setIntent({
            command: { actionKey: key, idempotencyKey: newIdempotencyKey(), workspaceId: target.id },
            name: target.name,
          });
        }}>
          {key === WorkspaceLifecycleActionKey.WorkspaceSuspend
            ? t("workspace.lifecycle.suspend") : t("workspace.lifecycle.restore")}
        </Button>
      ) : null}
      {intent ? (
        <div className="flex flex-col gap-2" role="group">
          <p>{t(intent.command.actionKey === WorkspaceLifecycleActionKey.WorkspaceSuspend
            ? "workspace.lifecycle.confirmSuspend" : "workspace.lifecycle.confirmRestore", { name: intent.name })}</p>
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
    </section>
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
    if (!confirming || busy) return;
    const { key, principal, idempotencyKey } = confirming;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await client.submitAction({
        actionKey: key,
        idempotencyKey,
        principalId: principal.principalId,
        ...(key.startsWith("workspace.") ? { workspaceId } : {}),
      });
      setSubmittedFor(principal.principalId);
      setOutcome({ kind: "submitted", action: key, execution: result.actionExecutionId });
      setConfirming(null);
    } catch (error) {
      const failure = writeFailure(error);
      setOutcome({ kind: "failed", failure });
      // 回应丢失时保留原意图与键；只有确定拒绝才能放弃这次意图。
      if (failure.kind !== "unknown") setConfirming(null);
    } finally {
      setBusy(false);
      reload();
    }
  };

  const button = (member: RoleMemberView, key: string, label: string) => (
    <Button
      disabled={busy || confirming !== null || submittedFor === member.principalId}
      onClick={() => setConfirming({ key, principal: member, idempotencyKey: newIdempotencyKey() })}
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
            {outcome?.kind === "failed" && outcome.failure.kind === "unknown" ? null : (
              <Button onClick={() => setConfirming(null)}>{t("platform.cancel")}</Button>
            )}
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
                        <span className="ml-2 text-xs text-muted-foreground">
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

type RehomeIntent = { binding: LegacySecretRefBinding; idempotencyKey: string };

/** DD-85：当前 Tenant 的管理者显式确认后，只提交受治理动作；不触碰私钥。 */
export function LegacySecretRefManagement() {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const cursor = cursors[pageIndex];
  const [state, reload] = useLoad(`legacy-secret-refs:${cursor ?? "first"}`, () =>
    client.legacySecretRefs(cursor),
  );
  const [intent, setIntent] = useState<RehomeIntent | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<
    | { kind: "submitted"; execution: string }
    | { kind: "failed"; failure: WriteFailure }
    | null
  >(null);

  // 无权或未进入发布注册表时都不渲染入口；其余错误保持可见且可重试。
  if (state.status === "error" && state.error instanceof BffError
    && (state.error.status === 403 || state.error.status === 404))
    return null;
  if (state.status === "pending") return null;

  const submit = async () => {
    if (!intent || busy) return;
    setBusy(true);
    setOutcome(null);
    try {
      const result = await client.submitAction({
        actionKey: "identity.secret_ref.rehome",
        idempotencyKey: intent.idempotencyKey,
        principalId: intent.binding.principalId,
        explicitConfirmation: true,
      });
      setOutcome({ kind: "submitted", execution: result.actionExecutionId });
      setIntent(null);
      reload();
    } catch (error) {
      const failure = writeFailure(error);
      setOutcome({ kind: "failed", failure });
      if (failure.kind !== "unknown") setIntent(null);
    } finally {
      setBusy(false);
    }
  };

  const page = state.status === "ok" ? state.data : null;
  if (page && (!Array.isArray(page.bindings)
    || !page.bindings.every((binding) => binding && typeof binding.principalId === "string"
      && typeof binding.pubkey === "string"
      && (binding.kind === BindingKind.Human || binding.kind === BindingKind.Control))
    || (page.nextCursor !== undefined && !/^[0-9a-fA-F]{64}$/.test(page.nextCursor))))
    return <Notice role="alert">{t("platform.loadFailed")}</Notice>;

  return (
    <section className="flex flex-col gap-3" data-testid="legacy-secret-ref-management">
      <h2 className="text-sm font-medium">{t("secretRehome.title")}</h2>
      <p className="text-sm text-muted-foreground">{t("secretRehome.explain")}</p>
      <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
      {outcome ? (
        <p role="alert">
          {outcome.kind === "submitted"
            ? t("secretRehome.submitted", { execution: outcome.execution })
            : outcome.failure.kind === "unknown"
              ? t("secretRehome.unknown", { operation: outcome.failure.operationId ?? "—" })
              : t("secretRehome.rejected", { reason: failureText(outcome.failure) })}
        </p>
      ) : null}
      {intent ? (
        <div className="flex flex-col gap-2 rounded-md border p-3" role="group">
          <p>{t("secretRehome.confirm", { pubkey: intent.binding.pubkey })}</p>
          <div className="flex gap-2">
            <Button disabled={busy} onClick={() => void submit()}>{t("platform.confirm")}</Button>
            <Button disabled={busy} onClick={() => { setIntent(null); setOutcome(null); }}>
              {t("platform.cancel")}
            </Button>
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
          {page.bindings.length === 0 ? <Notice>{t("secretRehome.none")}</Notice> : (
            <Table head={[t("secretRehome.kind"), t("secretRehome.pubkey"), t("platform.action")]}>
              {page.bindings.map((binding) => (
                <tr key={binding.pubkey}>
                  <Cell>{binding.kind}</Cell>
                  <Cell mono>{binding.pubkey}</Cell>
                  <Cell>
                    <Button disabled={busy || intent !== null} onClick={() => {
                      setOutcome(null);
                      setIntent({ binding, idempotencyKey: newIdempotencyKey() });
                    }}>
                      {t("secretRehome.move")}
                    </Button>
                  </Cell>
                </tr>
              ))}
            </Table>
          )}
          <div className="flex gap-2">
            {pageIndex > 0 ? <Button onClick={() => setPageIndex(pageIndex - 1)}>{t("roles.previous")}</Button> : null}
            {page.nextCursor ? <Button onClick={() => {
              setCursors((old) => [...old.slice(0, pageIndex + 1), page.nextCursor]);
              setPageIndex(pageIndex + 1);
            }}>{t("roles.next")}</Button> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
