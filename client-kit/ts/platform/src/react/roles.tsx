// DD-82：角色关系只从 BFF fresh 视图读取，授予/撤销仍经同一条 Governed Action。
// Web 与 Desktop 共用；Mobile 只读成员视图，不装载本管理面。

import { ActionDispatchState, ActionGateState, BindingKind, ChannelType, CreateActionKey, WorkspaceLifecycleActionKey, WorkspaceState, type ActionCommand, type ActionSubmission, type LegacySecretRefBinding, type RoleMemberPage, type RoleMemberView, type RoleWorkspaceView } from "@client-kit/contracts";
import { useRef, useState } from "react";
import { newIdempotencyKey, taskPhase } from "../governance";
import { enumLabel, workspaceStateMessages } from "../i18n";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";
import { Input } from "./composer/shared/ui/input";
import { cn } from "./profile/buzz/shared/lib/cn";
import { ChannelTypeSettings, DEFAULT_EPHEMERAL_TTL_SECONDS } from "./channel-type-settings";
import { WorkspaceVisibility } from "@client-kit/contracts";
import { ChannelPermissionsSettings } from "./channel-permissions-settings";

type Change = { command: ActionCommand; principal: Pick<RoleMemberView,"principalId"|"displayName">; label: string };
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
export function useWorkspaceCreate(actionKey?: CreateActionKey, channelType?: ChannelType) {
  const client = useBffClient();
  const t = useT();
  const inFlight = useRef(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState(WorkspaceVisibility.Private);
  const [temporary, setTemporary] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState(DEFAULT_EPHEMERAL_TTL_SECONDS);
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

  const submit = async () => {
    if (!actionKey || inFlight.current || (!command && (!name.trim() || (channelType === undefined && !slug.trim())))) return;
    const idempotencyKey = command?.idempotencyKey ?? newIdempotencyKey();
    // The original channel form has no infrastructure slug field. Use its existing
    // stable creation intent key; management forms may still choose a readable slug.
    const intent = command ?? { actionKey, idempotencyKey, name: name.trim(), slug: channelType === undefined ? slug.trim() : idempotencyKey,
      workspaceVisibility: visibility,
      workspaceChannel: { channelType: channelType ?? ChannelType.Stream, ...(description.trim() ? { description: description.trim() } : {}), ...(temporary ? { ttlSeconds } : {}) } };
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
      setDescription("");
      setVisibility(WorkspaceVisibility.Private);
      setTemporary(false);
      setTtlSeconds(DEFAULT_EPHEMERAL_TTL_SECONDS);
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

  return { actionKey, name, setName, slug, setSlug, description, setDescription, visibility, setVisibility, temporary, setTemporary, ttlSeconds, setTtlSeconds, channelType, command, busy, failure, submission,
    locked, openTasks, pendingCreates, reloadOpenTasks, submit };
}

/** The existing workspace.create command and UNKNOWN intent are shared by both hosts. */
export type WorkspaceCreateState = ReturnType<typeof useWorkspaceCreate>;

function CreateWorkspace({ actionKey }: { actionKey?: CreateActionKey }) {
  const state = useWorkspaceCreate(actionKey);
  if (!actionKey && !state.command && !state.submission && state.pendingCreates.length === 0 && state.openTasks.status !== "error")
    return null;
  return <WorkspaceCreateForm state={state} />;
}

/** Original creation intent renderer; the channel dialog changes presentation, not admission. */
// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/channelFormStyles.ts.
const CHANNEL_FORM_FIELD_SHELL_CLASS = "rounded-xl border border-input bg-muted/40 transition-colors duration-150 ease-out hover:border-muted-foreground/40 focus-within:border-muted-foreground/50";
const CHANNEL_FORM_FIELD_CONTROL_CLASS = "border-0 bg-transparent text-foreground shadow-none outline-none ring-0 transition-colors duration-150 ease-out placeholder:text-muted-foreground/55 focus:bg-transparent focus:text-foreground focus:outline-hidden focus-visible:ring-0";

export function WorkspaceCreateForm({ state, channel = false }: { state: WorkspaceCreateState; channel?: boolean }) {
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const { actionKey, name, setName, slug, setSlug, description, setDescription, command, busy, failure, submission,
    locked, openTasks, pendingCreates, reloadOpenTasks, submit } = state;
  return (
    <form className={channel ? "space-y-5" : "flex flex-col gap-3 rounded-md border p-3"} data-testid={channel ? "create-channel-form" : undefined} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {!channel ? <h2 className="text-sm font-medium">{t("workspace.create.title")}</h2> : null}
      <label className="flex flex-col gap-1 text-sm">
        {t("workspace.create.name")}
        <div className={channel ? cn("flex min-h-11 items-center px-3", CHANNEL_FORM_FIELD_SHELL_CLASS) : undefined}>
          <Input required autoComplete="off" disabled={locked} data-testid={channel ? "create-channel-name" : undefined} value={name} onChange={(event) => setName(event.target.value)} className={channel ? cn("h-8 px-0 py-0 leading-6", CHANNEL_FORM_FIELD_CONTROL_CLASS) : "h-8 rounded-md border border-input bg-transparent px-2 text-sm"} />
        </div>
      </label>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground" htmlFor="create-channel-description">
          {t("channel.create.about")}<span className="ml-1 text-xs font-normal text-muted-foreground/50">{t("channel.create.optional")}</span>
        </label>
        <div className={CHANNEL_FORM_FIELD_SHELL_CLASS}>
          <textarea autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className={cn("flex min-h-20 w-full rounded-lg border border-input/40 bg-background px-3 py-2 text-base transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm", "min-h-20 resize-none px-3 py-3 leading-5", CHANNEL_FORM_FIELD_CONTROL_CLASS)}
            data-testid="create-channel-description" id="create-channel-description" rows={2}
            disabled={locked} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </div>
      {!channel ? <label className="flex flex-col gap-1 text-sm">
        {t("workspace.create.slug")}
        <input required disabled={locked} value={slug} onChange={(event) => setSlug(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
        <span className="text-xs text-muted-foreground">{t("workspace.create.slugHint")}</span>
      </label> : null}
      {channel ? <ChannelTypeSettings disabled={locked} temporary={state.temporary} ttlSeconds={state.ttlSeconds}
        onTemporaryChange={state.setTemporary} onTtlSecondsChange={state.setTtlSeconds} /> : null}
      <ChannelPermissionsSettings disabled={locked} visibility={state.visibility} onVisibilityChange={state.setVisibility} testIdPrefix="create-channel" variant="segmented" />
      {submission ? (
        <div role="status" className="break-words text-sm">
          <p>{t("workspace.create.recorded", { execution: submission.actionExecutionId, operation: submission.operationId, gate: submission.gateState, dispatch: submission.dispatchState })}</p>
          {submission.reason ? <p>{reasonText(submission.reason)}</p> : null}
        </div>
      ) : null}
        <Button type="submit" className={channel ? "ml-auto flex w-fit" : "w-fit"} data-testid={channel ? "create-channel-submit" : undefined} disabled={!actionKey || busy || (!command && (!name.trim() || (!channel && !slug.trim())))}>
          {busy ? t("platform.loading") : command ? t("workspace.create.retry") : channel ? t("channel.create.submit") : t("workspace.create.title")}
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

/** Original role submission state, shared by the table and native member-row menu. */
export function useMemberAction(onRecorded:()=>void) {
  const client = useBffClient();
  const t = useT();
  const inFlight=useRef(false);
  const receipt=useRef<ActionSubmission|null>(null);
  const [confirming, setConfirming] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [submittedFor, setSubmittedFor] = useState<string | null>(null);
  const submit = async () => {
    if (!confirming || inFlight.current) return;
    const wasUnknown=outcome?.kind==="failed"&&outcome.failure.kind==="unknown";
    const priorOperation=outcome?.kind==="failed"&&outcome.failure.kind==="unknown"?outcome.failure.operationId:undefined;
    const { command, principal } = confirming;
    inFlight.current=true;
    setBusy(true);
    if(!wasUnknown)setOutcome(null);
    try {
      const result = await client.submitAction(command);
      if (!result || result.actionKey!==command.actionKey || !result.actionExecutionId || !result.operationId
        || (priorOperation&&result.operationId!==priorOperation)
        || (receipt.current&&(result.operationId!==receipt.current.operationId||result.actionExecutionId!==receipt.current.actionExecutionId))
        || !Object.values(ActionGateState).includes(result.gateState) || !Object.values(ActionDispatchState).includes(result.dispatchState))
        throw new TransportError(t("platform.loadFailed"));
      receipt.current=result;
      if(result.dispatchState===ActionDispatchState.Unknown||result.gateState===ActionGateState.Evaluating
        ||(result.gateState===ActionGateState.Allowed&&result.dispatchState===ActionDispatchState.NotDispatched)) {
        setOutcome({kind:"failed",failure:{kind:"unknown",operationId:result.operationId}});
        return;
      }
      setSubmittedFor(principal.principalId);
      setOutcome({ kind: "submitted", action: confirming.label, execution: result.actionExecutionId });
      setConfirming(null);
      receipt.current=null;
    } catch (error) {
      // Later admission refusal says nothing about the original uncertain write.
      if(!wasUnknown){
        const failure = writeFailure(error);
        setOutcome({ kind: "failed", failure });
        if (failure.kind !== "unknown") {setConfirming(null);receipt.current=null;}
      }
    } finally {
      inFlight.current=false;
      setBusy(false);
      onRecorded();
    }
  };
  return {confirming,busy,outcome,submittedFor,submit,
    refresh:()=>{setSubmittedFor(null);onRecorded();},
    cancel:()=>{if(!busy&&!(outcome?.kind==="failed"&&outcome.failure.kind==="unknown"))setConfirming(null);},
    choose:(key:string,principal:Change["principal"],label:string,workspaceId?:string)=>{
      if(busy||confirming)return;
      receipt.current=null;
      setOutcome(null);
      setConfirming({principal,label,command:{actionKey:key,principalId:principal.principalId,idempotencyKey:newIdempotencyKey(),
        ...(key.startsWith("workspace.")?{workspaceId}: {})}});
    }};
}

export function MemberActionFeedback({action}:{action:ReturnType<typeof useMemberAction>}) {
  const t=useT();const failureText=useFailureText();const {outcome,confirming,busy}=action;
  return <>
    {outcome?.kind==="submitted"?<Button className="w-fit" onClick={action.refresh}>{t("platform.refresh")}</Button>:null}
    {outcome?<p role="alert">{outcome.kind==="submitted"
      ?t("roles.submitted",{action:outcome.action,execution:outcome.execution})
      :outcome.failure.kind==="unknown"?t("roles.unknown",{operation:outcome.failure.operationId??"—"})
      :t("members.rejected",{reason:failureText(outcome.failure)})}</p>:null}
    {confirming?<div className="flex flex-col gap-2 rounded-md border p-3" role="group">
      <p>{t("roles.confirm",{action:confirming.label,member:confirming.principal.displayName})}</p>
      <code className="text-xs text-muted-foreground">{confirming.command.actionKey}</code>
      <div className="flex gap-2"><Button disabled={busy} onClick={()=>void action.submit()}>{t("platform.confirm")}</Button>
        {outcome?.kind==="failed"&&outcome.failure.kind==="unknown"?null:<Button disabled={busy} onClick={action.cancel}>{t("platform.cancel")}</Button>}
      </div>
    </div>:null}
  </>;
}

export function validRoleMemberPage(page:RoleMemberPage):boolean {
  return !!page&&Array.isArray(page.members)&&page.members.every(m=>m&&typeof m.principalId==="string"
    &&typeof m.displayName==="string"&&typeof m.tenantAdmin==="boolean"&&typeof m.workspaceAdmin==="boolean"
    &&typeof m.lastTenantAdmin==="boolean"&&typeof m.canGrantTenantAdmin==="boolean"&&typeof m.canRevokeTenantAdmin==="boolean"
    &&typeof m.canGrantWorkspaceAdmin==="boolean"&&typeof m.canRevokeWorkspaceAdmin==="boolean"
    &&(m.canRemoveFromWorkspace===undefined||typeof m.canRemoveFromWorkspace==="boolean")
    &&(m.canRemoveFromTenant===undefined||typeof m.canRemoveFromTenant==="boolean"))
    &&(page.nextCursor===undefined||typeof page.nextCursor==="string"&&page.nextCursor.length>0);
}

export function RoleMembers({ workspaceId }: { workspaceId?: string }) {
  const client = useBffClient();const t = useT();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);const cursor = cursors[pageIndex];
  const [state, reload] = useLoad(`role-members:${workspaceId ?? "tenant"}:${cursor ?? "first"}`, () => client.roleMembers(workspaceId, cursor));
  const action=useMemberAction(reload);
  const {busy,confirming,submittedFor}=action;
  if(state.status==="error"&&state.error instanceof BffError&&state.error.status===403)return null;
  if(state.status==="pending")return null;

  const button = (member: RoleMemberView, key: string, label: string) => (
    <Button
      disabled={busy || confirming !== null || submittedFor === member.principalId}
      onClick={() => action.choose(key,member,`${label} ${t(key.startsWith("workspace.")?"roles.workspace":"roles.tenant")}`,workspaceId)}
    >
      {label}
    </Button>
  );
  const page = state.status === "ok" ? state.data : null;
  if (page && !validRoleMemberPage(page))
    return <Notice role="alert">{t("platform.loadFailed")}</Notice>;

  return (
    <section className="flex flex-col gap-3" data-testid="role-members">
      <h2 className="text-sm font-medium">{t("roles.title")}</h2>
      <Button className="w-fit" onClick={action.refresh}>
        {t("platform.refresh")}
      </Button>
      <MemberActionFeedback action={action}/>
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
