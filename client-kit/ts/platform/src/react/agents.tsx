// DD-24/25/45、17 §6–8：定义管理不等于安装或运行；两端只消费同一 BFF 和治理动作。
import {
  ActionDispatchState,
  ActionGateState,
  AgentVersionState,
  ErrorClass,
  ReasonCode,
  ResourceState,
  TaskStatus,
  type ActionCommand,
  type ActionSubmission,
  type AgentDefinitionView,
  type TaskView,
} from "@client-kit/contracts";
import { useEffect, useRef, useState } from "react";
import { newIdempotencyKey, taskPhase } from "../governance";
import type { PlatformMessageKey } from "../i18n";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";

function validDefinition(value: AgentDefinitionView): boolean {
  return !!value && typeof value.resourceId === "string" && !!value.resourceId
    && typeof value.displayName === "string" && typeof value.stableSlug === "string"
    && typeof value.ownerPrincipalId === "string" && !!value.ownerPrincipalId
    && Number.isSafeInteger(value.resourceVersion) && value.resourceVersion > 0
    && value.resourceState === ResourceState.Active && value.status === ResourceState.Active
    && (value.currentPublishedVersionAssetId === undefined
      || (typeof value.currentPublishedVersionAssetId === "string" && !!value.currentPublishedVersionAssetId));
}

function validDefinitionTask(task: TaskView): boolean {
  return !!task && typeof task.actionKey === "string"
    && typeof task.actionExecutionId === "string" && !!task.actionExecutionId
    && typeof task.operationId === "string" && !!task.operationId
    && typeof task.targetId === "string" && !!task.targetId
    && Object.values(ActionGateState).includes(task.gateState)
    && Object.values(ActionDispatchState).includes(task.dispatchState)
    && (task.taskStatus === undefined || Object.values(TaskStatus).includes(task.taskStatus))
    && (task.workflowId === undefined || (typeof task.workflowId === "string" && !!task.workflowId));
}

function AgentReadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const reasonText = useReasonText();
  const response = error instanceof BffError ? error : null;
  const knownClass = response?.errorClass !== undefined
    && Object.values(ErrorClass).includes(response.errorClass);
  // 这三个 GET 的裸 403/404 是确定的读取拒绝；不据状态码制造错误分类或 reason。
  // 显式 UNKNOWN、未知分类和无可用响应优先保留未知，不能退回成确定失败。
  const refusal = response && (response.errorClass === undefined || knownClass)
    && response.errorClass !== ErrorClass.Unknown
    && (knownClass || response.status === 403 || response.status === 404) ? response : null;
  const reason = refusal?.reason;
  const text = !refusal ? t("platform.loadFailed")
    : reason !== undefined && Object.values(ReasonCode).includes(reason) ? reasonText(reason)
    : refusal.status === 403 ? t("tasks.status.denied")
    : refusal.status === 404 ? t("native.unavailable.title")
    : t("workspace.lifecycle.rejected", { reason: String(refusal.status) });
  return <Notice role={refusal ? "alert" : "status"}>
    {text}<Button onClick={onRetry}>{t("platform.retry")}</Button>
  </Notice>;
}

export function AgentDefinitionsPage() {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const offset = offsets[pageIndex] ?? 0;
  const [state, reload] = useLoad(`agent-definitions:${offset}`, () => client.agentDefinitions(offset));
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ target: AgentDefinitionView; owner: boolean } | null>(null);
  const [locked, setLocked] = useState(false);
  const data = state.status === "ok" ? state.data : null;
  const page = data && Array.isArray(data.definitions) && data.definitions.every(validDefinition)
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset))
    ? data : null;
  const nextOffset = page?.nextOffset;

  return (
    <div className="flex flex-col gap-6" data-testid="agent-definitions">
      <p className="text-sm text-muted-foreground">{t("agents.definitionOnly")}</p>
      {/* 写意图不随列表/详情刷新或翻页卸载；未知结果保留冻结版本与原幂等键。 */}
      <DefinitionAction edit={edit} onReset={() => setEdit(null)} onLocked={setLocked} onRecorded={() => { setSelected(null); reload(); }} />
      <section className="flex flex-col gap-3">
        <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
        {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
          : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
          : <>
            {page.definitions.length === 0 ? <Notice>{t("agents.none")}</Notice> : (
              <Table head={[t("agents.name"), t("agents.slug"), t("agents.owner"), t("agents.publishedVersion"), t("platform.state"), ""]}>
                {page.definitions.map((row) => (
                  <tr key={row.resourceId}>
                    <Cell>{row.displayName}</Cell><Cell mono>{row.stableSlug}</Cell>
                    <Cell mono>{row.ownerPrincipalId}</Cell>
                    <Cell mono>{row.currentPublishedVersionAssetId ?? "—"}</Cell>
                    <Cell><Badge tone="neutral">{t("agents.definitionReady")}</Badge></Cell>
                    <Cell><Button disabled={locked} onClick={() => setSelected(row.resourceId)}>{t("agents.open")}</Button></Cell>
                  </tr>
                ))}
              </Table>
            )}
            <div className="flex gap-2">
              {pageIndex > 0 ? <Button disabled={locked} onClick={() => { setSelected(null); setPageIndex(pageIndex - 1); }}>{t("roles.previous")}</Button> : null}
              {nextOffset !== undefined ? <Button disabled={locked} onClick={() => {
                setSelected(null);
                setOffsets((old) => [...old.slice(0, pageIndex + 1), nextOffset]);
                setPageIndex(pageIndex + 1);
              }}>{t("roles.next")}</Button> : null}
            </div>
          </>}
      </section>
      {selected ? <DefinitionDetail key={selected} resourceId={selected} locked={locked} onEdit={(target, owner) => setEdit({ target, owner })} /> : null}
    </div>
  );
}

function DefinitionDetail({ resourceId, locked, onEdit }: {
  resourceId: string; locked: boolean; onEdit: (target: AgentDefinitionView, owner: boolean) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`agent-definition:${resourceId}`, () => client.agentDefinition(resourceId));
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  const row = state.status === "ok" && validDefinition(state.data) && state.data.resourceId === resourceId ? state.data : null;
  if (!row) return <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />;
  return (
    <section className="flex flex-col gap-3 rounded-md border p-3">
      <h2 className="font-medium">{row.displayName}</h2>
      <p className="break-words text-sm">{t("agents.slug")}: {row.stableSlug}</p>
      <p className="break-words text-sm">{t("agents.owner")}: {row.ownerPrincipalId}</p>
      <p className="text-sm">{t("agents.resourceVersion")}: {row.resourceVersion}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reload}>{t("platform.refresh")}</Button>
        <Button disabled={locked} onClick={() => onEdit(row, false)}>{t("agents.update")}</Button>
        <Button disabled={locked} onClick={() => onEdit(row, true)}>{t("agents.transfer")}</Button>
      </div>
      {row.currentPublishedVersionAssetId ? <PublishedVersion resourceId={resourceId} assetId={row.currentPublishedVersionAssetId} />
        : <p className="text-sm text-muted-foreground">{t("agents.noPublishedVersion")}</p>}
    </section>
  );
}

function PublishedVersion({ resourceId, assetId }: { resourceId: string; assetId: string }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`agent-version:${assetId}`, () => client.agentVersion(assetId));
  const value = state.status === "ok" ? state.data : null;
  const version = value && value.assetId === assetId && value.agentResourceId === resourceId
    && value.state === AgentVersionState.Published
    && Number.isSafeInteger(value.ordinal) && value.ordinal > 0
    && Number.isSafeInteger(value.assetVersion) && value.assetVersion > 0
    && typeof value.configHash === "string" && !!value.configHash
    && typeof value.ownerPrincipalId === "string" && !!value.ownerPrincipalId
    && value.content && typeof value.content.instructions === "string"
    && typeof value.content.runtimeProfileKey === "string" && typeof value.content.modelRouteResourceId === "string"
    ? value : null;
  return <section className="flex flex-col gap-2 border-t pt-3">
    <h3 className="text-sm font-medium">{t("agents.publishedVersion")}</h3>
    {state.status === "pending" ? <p role="status">{t("platform.loading")}</p>
      : !version ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <Badge tone="neutral">{t("agents.version.published")}</Badge>
        <p className="text-sm">{t("agents.version.ordinal")}: {version.ordinal}</p>
        <p className="break-words text-sm">{t("agents.owner")}: {version.ownerPrincipalId}</p>
        <p className="break-words text-sm">{t("agents.version.runtimeProfile")}: {version.content.runtimeProfileKey}</p>
        <p className="break-words text-sm">{t("agents.version.modelRoute")}: {version.content.modelRouteResourceId}</p>
        <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {version.configHash}</p>
        <h4 className="text-sm font-medium">{t("agents.version.instructions")}</h4>
        <pre className="whitespace-pre-wrap break-words text-sm">{version.content.instructions}</pre>
      </>}
  </section>;
}

function DefinitionAction({ edit, onReset, onLocked, onRecorded }: {
  edit: { target: AgentDefinitionView; owner: boolean } | null;
  onReset: () => void; onLocked: (locked: boolean) => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const inFlight = useRef(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [owner, setOwner] = useState("");
  const [intent, setIntent] = useState<{ command: ActionCommand; previousOwner?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  // 选择新的已读取目标时初始化表单；已提交的未知意图不会被列表刷新替换。
  useEffect(() => {
    setName(edit?.target.displayName ?? "");
    setOwner("");
    setSlug("");
  }, [edit]);
  const [tasks, reloadTasks] = useLoad("definition-actions-in-flight", client.tasks);
  const actionKey = !edit ? "agent.definition.create" : edit.owner ? "resource.transfer_owner" : "agent.definition.update";
  const title: PlatformMessageKey = !edit ? "agents.create" : edit.owner ? "agents.transfer" : "agents.update";
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask)
    ? tasks.data : null;
  const pending = taskRows ? taskRows.filter((task) =>
    ["agent.definition.create", "agent.definition.update", "resource.transfer_owner"].includes(task.actionKey)
      && taskPhase(task).tone === "neutral") : [];
  // 读取失败/未知状态不是「没有在途请求」；同资源的修改、转移必须先查证原请求。
  const requestBlocked = !taskRows || pending.some((task) => edit
    ? task.targetId === edit.target.resourceId : task.actionKey === "agent.definition.create");
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);

  const prepare = () => {
    if (intent || busy || requestBlocked || (edit?.owner
      ? !owner.trim() || owner.trim() === edit.target.ownerPrincipalId
      : !name.trim() || (!edit && !slug.trim()))) return;
    const command: ActionCommand = { actionKey, idempotencyKey: newIdempotencyKey() };
    if (edit) { command.resourceId = edit.target.resourceId; command.resourceVersion = edit.target.resourceVersion; }
    if (edit?.owner) command.principalId = owner.trim();
    else { command.name = name.trim(); if (!edit) command.slug = slug.trim(); }
    setIntent({ command, previousOwner: edit?.target.ownerPrincipalId });
    setFailure(null); setSubmission(null); onLocked(true);
  };
  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(null); setSubmission(null);
    try {
      const result = await client.submitAction(intent.command);
      if (!result || result.actionKey !== intent.command.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason))
        throw new TransportError(t("platform.loadFailed"));
      setSubmission(result);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); onReset(); setName(""); setSlug(""); setOwner(""); onRecorded();
      }
    } catch (error) {
      const failed = writeFailure(error); setFailure(failed);
      if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };

  return <section className="flex flex-col gap-3 rounded-md border p-3">
    <h2 className="text-sm font-medium">{t(title)}</h2>
    {!intent ? <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      {edit ? <p className="break-words text-sm">{edit.target.displayName} · {t("agents.resourceVersion")}: {edit.target.resourceVersion}</p> : null}
      {edit?.owner ? <label className="flex flex-col gap-1 text-sm">{t("agents.newOwner")}
        <input required value={owner} onChange={(event) => setOwner(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
        <span className="text-xs text-muted-foreground">{t("agents.ownerHint")}</span>
      </label> : <>
        <label className="flex flex-col gap-1 text-sm">{t("agents.name")}
          <input required value={name} onChange={(event) => setName(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
        </label>
        {!edit ? <label className="flex flex-col gap-1 text-sm">{t("agents.slug")}
          <input required value={slug} onChange={(event) => setSlug(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
          <span className="text-xs text-muted-foreground">{t("workspace.create.slugHint")}</span>
        </label> : null}
      </>}
      <div className="flex gap-2"><Button type="submit" disabled={requestBlocked}>{t("agents.review")}</Button>{edit ? <Button onClick={onReset}>{t("agents.cancel")}</Button> : null}</div>
    </form> : <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-words">{intent.command.actionKey === "agent.definition.create"
        ? t("agents.previewCreate", { name: intent.command.name ?? "", slug: intent.command.slug ?? "" })
        : intent.command.actionKey === "agent.definition.update"
          ? t("agents.previewUpdate", { resource: intent.command.resourceId ?? "", version: intent.command.resourceVersion ?? "", name: intent.command.name ?? "" })
          : t("agents.previewTransfer", { resource: intent.command.resourceId ?? "", version: intent.command.resourceVersion ?? "", owner: intent.previousOwner ?? "", next: intent.command.principalId ?? "" })}</p>
      <p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}
      </div>
    </div>}
    {submission ? <p role="status" className="break-words text-sm">{unknown
      ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}
      {submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : t("roles.rejected", { reason: failureText(failure) })}</p> : null}
    {tasks.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !taskRows ? <Notice role="alert">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length > 0 ? <div role="status" className="flex flex-col gap-1 text-sm"><p>{t("agents.inFlight")}</p>
        {pending.map((task) => <p className="break-words" key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}
        <Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button>
      </div> : null}
  </section>;
}
