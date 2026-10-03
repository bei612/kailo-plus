// DD-24/25/45、17 §6–8：定义管理不等于安装或运行；两端只消费同一 BFF 和治理动作。
import {
  ActionDispatchState,
  ActionGateState,
  AgentVersionState,
  AgentInstallationState,
  AgentRuntimeProjectionState,
  AgentTrigger,
  AgentMemoryCoreWrite,
  AgentMemoryColdWrite,
  RuntimeProfileKind,
  ActionKind,
  AutomationState,
  ResultTarget,
  TriggerKind,
  ErrorClass,
  ReasonCode,
  ResourceState,
  ResultExposureMode,
  TaskStatus,
  type ActionCommand,
  type ActionSubmission,
  type AgentDefinitionView,
  type AgentVersionView,
  type AgentVersionConfigurationPage,
  type AgentInstallationCandidate,
  type AgentDelegationView,
  type DelegationScopeParameters,
  type AgentInstallationView,
  type AutomationView,
  type AutomationDetailView,
  type AutomationVersionView,
  type TaskView,
} from "@client-kit/contracts";
import { useEffect, useRef, useState } from "react";
import { newIdempotencyKey, taskPhase } from "../governance";
import { relativeTime } from "../format";
import type { PlatformMessageKey } from "../i18n";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, Cell, Notice, Table } from "./ui";
import { useLoad } from "./use-load";
import { InstallationMemory } from "./memory";

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
  // 管理 GET 的裸 403/404 是确定的读取拒绝；不据状态码制造错误分类或 reason。
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
  const [versionEdit, setVersionEdit] = useState<VersionEdit | null>(null);
  const [versionLocked, setVersionLocked] = useState(false);
  const [versionRevision, setVersionRevision] = useState(0);
  const blocked = locked || versionLocked;
  const data = state.status === "ok" ? state.data : null;
  const page = data && Array.isArray(data.definitions) && data.definitions.every(validDefinition)
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset))
    ? data : null;
  const nextOffset = page?.nextOffset;

  return (
    <div className="flex flex-col gap-6" data-testid="agent-definitions">
      <p className="text-sm text-muted-foreground">{t("agents.definitionOnly")}</p>
      {/* 写意图不随列表/详情刷新或翻页卸载；未知结果保留冻结版本与原幂等键。 */}
      <DefinitionAction edit={edit} externalBlocked={versionEdit !== null || versionLocked} onReset={() => setEdit(null)} onLocked={setLocked} onRecorded={() => { setSelected(null); reload(); }} />
      <VersionAction edit={versionEdit} onReset={() => setVersionEdit(null)} onLocked={setVersionLocked}
        onRecorded={() => { setVersionRevision((value) => value + 1); reload(); }} />
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
                    <Cell><Button disabled={blocked || versionEdit !== null} onClick={() => setSelected(row.resourceId)}>{t("agents.open")}</Button></Cell>
                  </tr>
                ))}
              </Table>
            )}
            <div className="flex gap-2">
              {pageIndex > 0 ? <Button disabled={blocked || versionEdit !== null} onClick={() => { setSelected(null); setPageIndex(pageIndex - 1); }}>{t("roles.previous")}</Button> : null}
              {nextOffset !== undefined ? <Button disabled={blocked || versionEdit !== null} onClick={() => {
                setSelected(null);
                setOffsets((old) => [...old.slice(0, pageIndex + 1), nextOffset]);
                setPageIndex(pageIndex + 1);
              }}>{t("roles.next")}</Button> : null}
            </div>
          </>}
      </section>
      {selected ? <DefinitionDetail key={`${selected}:${versionRevision}`} resourceId={selected} locked={blocked || versionEdit !== null}
        onEdit={(target, owner) => setEdit({ target, owner })} onVersionEdit={setVersionEdit} /> : null}
      <InstallationManagement />
      <AutomationManagement />
    </div>
  );
}

const automationLabels = {
  [AutomationState.Draft]: "agents.automation.state.draft",
  [AutomationState.Enabled]: "agents.automation.state.enabled",
  [AutomationState.Paused]: "agents.automation.state.paused",
  [AutomationState.Disabled]: "agents.automation.state.disabled",
} as const satisfies Record<AutomationState, PlatformMessageKey>;
const automationVersionLabels = {
  [AgentVersionState.Draft]: "agents.automation.state.draft",
  [AgentVersionState.Published]: "agents.version.published",
  [AgentVersionState.Retired]: "agents.automation.version.retired",
} as const satisfies Record<AgentVersionState, PlatformMessageKey>;

function validAutomation(row: AutomationView): boolean {
  return !!row && [row.resourceId, row.workspaceId, row.ownerPrincipalId, row.executorInstallationResourceId]
    .every((id) => typeof id === "string" && !!id)
    && Number.isSafeInteger(row.resourceVersion) && row.resourceVersion > 0
    && row.resourceState === ResourceState.Active && Object.values(AutomationState).includes(row.state)
    && [row.pinnedVersionAssetId, row.delegationId].every((id) => id === undefined || (typeof id === "string" && !!id))
    && (row.state !== AutomationState.Enabled || (!!row.pinnedVersionAssetId && !!row.delegationId));
}

function validAutomationVersion(row: AutomationVersionView, parent: AutomationView): boolean {
  const content = row?.content;
  return !!row && row.automationResourceId === parent.resourceId
    && [row.assetId, row.ownerPrincipalId].every((id) => typeof id === "string" && !!id)
    && Number.isSafeInteger(row.assetVersion) && row.assetVersion > 0
    && Number.isSafeInteger(row.ordinal) && row.ordinal > 0
    && Object.values(AgentVersionState).includes(row.state)
    && typeof row.configHash === "string" && /^[0-9a-f]{64}$/.test(row.configHash)
    && !!content && !!content.trigger && Object.values(TriggerKind).includes(content.trigger.kind)
    && (content.trigger.textPrefix === undefined || (typeof content.trigger.textPrefix === "string" && !!content.trigger.textPrefix))
    && (content.trigger.kind === TriggerKind.Mention
      ? typeof content.trigger.mentionPrincipalId === "string" && !!content.trigger.mentionPrincipalId
      : content.trigger.mentionPrincipalId === undefined)
    && !!content.action && content.action.kind === ActionKind.AgentTurn
    && typeof content.action.template === "string" && !!content.action.template.trim()
    && content.resultTarget === ResultTarget.TriggerThread;
}

function validAutomationDetail(value: AutomationDetailView, resource: string, workspace: string): boolean {
  const parent = value?.automation;
  return !!value && !!parent && validAutomation(parent) && parent.resourceId === resource && parent.workspaceId === workspace
    && typeof value.canManage === "boolean" && Array.isArray(value.versions)
    && value.versions.every((row) => validAutomationVersion(row, parent))
    && new Set(value.versions.map((row) => row.assetId)).size === value.versions.length
    && Array.isArray(value.delegations) && value.delegations.every((row) => row
      && typeof row.delegationId === "string" && !!row.delegationId
      && Number.isSafeInteger(row.delegationVersion) && row.delegationVersion > 0
      && row.ownerPrincipalId === parent.ownerPrincipalId
      && row.executorInstallationResourceId === parent.executorInstallationResourceId
      && Number.isFinite(new Date(row.expiresAt).getTime()))
    && new Set(value.delegations.map((row) => row.delegationId)).size === value.delegations.length;
}

type AutomationEdit = { detail: AutomationDetailView; action: "publish_version" | "enable" | "pause" | "disable" };

function AutomationManagement() {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("automation-workspaces", client.workspaces);
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<AutomationEdit | null>(null);
  const [locked, setLocked] = useState(false);
  const [revision, setRevision] = useState(0);
  const data = state.status === "ok" ? state.data : null;
  const workspaces = data && Array.isArray(data) && data.every((w) => w && typeof w.id === "string" && !!w.id
    && typeof w.name === "string" && typeof w.slug === "string") && new Set(data.map((w) => w.id)).size === data.length ? data : null;
  const workspace = workspaces?.find((w) => w.id === selected) ?? workspaces?.[0];
  return <section className="flex flex-col gap-3 border-t pt-4" data-testid="agent-automations">
    <h2 className="font-medium">{t("agents.automation.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("agents.automation.scope")}</p>
    <Button className="w-fit" disabled={locked} onClick={reload}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !workspaces ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : !workspace ? <Notice>{t("platform.noWorkspace")}</Notice>
      : <label className="flex flex-col gap-1 text-sm">{t("platform.workspace")}
        <select className="h-8 rounded-md border border-input bg-background px-2" disabled={locked} value={workspace.id}
          onChange={(event) => { setSelected(event.target.value); setEdit(null); }}>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>}
    {/* 未知写意图不随 Workspace、列表或详情重载卸载。 */}
    <AutomationAction workspaceId={workspace?.id} edit={edit} onReset={() => setEdit(null)} onLocked={setLocked}
      onRecorded={() => { setEdit(null); setRevision((old) => old + 1); }} />
    {workspace ? <AutomationList key={`${workspace.id}:${revision}`} workspaceId={workspace.id} locked={locked} onEdit={setEdit} /> : null}
  </section>;
}

function AutomationList({ workspaceId, locked, onEdit }: {
  workspaceId: string; locked: boolean; onEdit: (edit: AutomationEdit) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`automations:${workspaceId}:${offset}`, () => client.automations(workspaceId, offset));
  const data = state.status === "ok" ? state.data : null;
  const page = data && Array.isArray(data.automations) && data.automations.every((row) => validAutomation(row) && row.workspaceId === workspaceId)
    && typeof data.canCreate === "boolean" && new Set(data.automations.map((row) => row.resourceId)).size === data.automations.length
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset)) ? data : null;
  const next = page?.nextOffset;
  return <div className="flex flex-col gap-3">
    <Button className="w-fit" disabled={locked} onClick={() => { setSelected(null); reload(); }}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {page.automations.length === 0 ? <Notice>{t("agents.automation.none")}</Notice>
          : <Table head={[t("agents.installation.id"), t("agents.automation.executor"), t("agents.owner"), t("platform.state"), ""]}>
            {page.automations.map((row) => <tr key={row.resourceId}>
              <Cell mono>{row.resourceId}</Cell><Cell mono>{row.executorInstallationResourceId}</Cell><Cell mono>{row.ownerPrincipalId}</Cell>
              <Cell><Badge tone="neutral">{t(automationLabels[row.state])}</Badge></Cell>
              <Cell><Button disabled={locked} onClick={() => setSelected(row.resourceId)}>{t("agents.open")}</Button></Cell>
            </tr>)}
          </Table>}
        <div className="flex gap-2">
          {index > 0 ? <Button disabled={locked} onClick={() => { setSelected(null); setIndex(index - 1); }}>{t("roles.previous")}</Button> : null}
          {next !== undefined ? <Button disabled={locked} onClick={() => {
            setSelected(null); setOffsets((old) => [...old.slice(0, index + 1), next]); setIndex(index + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
      </>}
    {selected ? <AutomationDetail key={selected} resourceId={selected} workspaceId={workspaceId} locked={locked} onEdit={onEdit} /> : null}
  </div>;
}

function AutomationDetail({ resourceId, workspaceId, locked, onEdit }: {
  resourceId: string; workspaceId: string; locked: boolean; onEdit: (edit: AutomationEdit) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [versionOffsets, setVersionOffsets] = useState([0]);
  const [grantOffsets, setGrantOffsets] = useState([0]);
  const [versionIndex, setVersionIndex] = useState(0);
  const [grantIndex, setGrantIndex] = useState(0);
  const versionOffset = versionOffsets[versionIndex] ?? 0;
  const grantOffset = grantOffsets[grantIndex] ?? 0;
  const [state, reload] = useLoad(`automation:${resourceId}:${versionOffset}:${grantOffset}`,
    () => client.automation(resourceId, versionOffset, grantOffset));
  const value = state.status === "ok" ? state.data : null;
  const detail = value && validAutomationDetail(value, resourceId, workspaceId)
    && (value.nextVersionOffset === undefined || (Number.isSafeInteger(value.nextVersionOffset) && value.nextVersionOffset > versionOffset))
    && (value.nextDelegationOffset === undefined || (Number.isSafeInteger(value.nextDelegationOffset) && value.nextDelegationOffset > grantOffset)) ? value : null;
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (!detail) return <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />;
  const row = detail.automation;
  const published = detail.versions.filter((v) => v.state === AgentVersionState.Published);
  const grants = detail.delegations.filter((g) => new Date(g.expiresAt).getTime() > Date.now());
  return <section className="flex flex-col gap-3 border-t pt-3">
    <p className="break-words text-sm">{row.resourceId} · {t("agents.resourceVersion")}: {row.resourceVersion}</p>
    <p className="break-words text-sm">{t("agents.automation.pinned")}: {row.pinnedVersionAssetId ?? "—"} · {t("agents.automation.grant")}: {row.delegationId ?? "—"}</p>
    {detail.canManage ? <div className="flex flex-wrap gap-2">
      <Button disabled={locked} onClick={() => onEdit({ detail, action: "publish_version" })}>{t("agents.automation.publish")}</Button>
      {row.state !== AutomationState.Enabled && published.length > 0 && grants.length > 0
        ? <Button disabled={locked} onClick={() => onEdit({ detail, action: "enable" })}>{t("agents.automation.enable")}</Button> : null}
      {row.state === AutomationState.Enabled ? <Button disabled={locked} onClick={() => onEdit({ detail, action: "pause" })}>{t("agents.automation.pause")}</Button> : null}
      {row.state !== AutomationState.Disabled ? <Button disabled={locked} onClick={() => onEdit({ detail, action: "disable" })}>{t("agents.automation.disable")}</Button> : null}
    </div> : null}
    {detail.versions.length === 0 ? <Notice>{t("agents.automation.noVersion")}</Notice>
      : <Table head={[t("agents.publishedVersion"), t("agents.resourceVersion"), t("platform.state"), t("agents.automation.template")]}>
        {detail.versions.map((version) => <tr key={version.assetId}>
          <Cell mono>{version.assetId}</Cell><Cell>{version.assetVersion}</Cell>
          <Cell><Badge tone="neutral">{t(automationVersionLabels[version.state])}</Badge></Cell><Cell><span className="whitespace-pre-wrap">{version.content.action.template}</span></Cell>
        </tr>)}
      </Table>}
    <div className="flex gap-2">
      {versionIndex > 0 ? <Button disabled={locked} onClick={() => setVersionIndex(versionIndex - 1)}>{t("roles.previous")}</Button> : null}
      {detail.nextVersionOffset !== undefined ? <Button disabled={locked} onClick={() => {
        setVersionOffsets((old) => [...old.slice(0, versionIndex + 1), detail.nextVersionOffset!]); setVersionIndex(versionIndex + 1);
      }}>{t("roles.next")}</Button> : null}
    </div>
    {detail.canManage ? <>
      {grants.length === 0 ? <Notice>{t("agents.automation.noGrant")}</Notice>
        : <Table head={[t("agents.automation.grant"), t("agents.resourceVersion"), t("platform.time")]}>
          {grants.map((grant) => <tr key={grant.delegationId}><Cell mono>{grant.delegationId}</Cell><Cell>{grant.delegationVersion}</Cell><Cell title={grant.expiresAt}>{relativeTime(locale, grant.expiresAt)}</Cell></tr>)}
        </Table>}
      <div className="flex gap-2">
        {grantIndex > 0 ? <Button disabled={locked} onClick={() => setGrantIndex(grantIndex - 1)}>{t("roles.previous")}</Button> : null}
        {detail.nextDelegationOffset !== undefined ? <Button disabled={locked} onClick={() => {
          setGrantOffsets((old) => [...old.slice(0, grantIndex + 1), detail.nextDelegationOffset!]); setGrantIndex(grantIndex + 1);
        }}>{t("roles.next")}</Button> : null}
      </div>
    </> : null}
  </section>;
}

function AutomationAction({ workspaceId, edit, onReset, onLocked, onRecorded }: {
  workspaceId?: string; edit: AutomationEdit | null; onReset: () => void;
  onLocked: (locked: boolean) => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [executorId, setExecutorId] = useState("");
  const [trigger, setTrigger] = useState(TriggerKind.ChannelMessage);
  const [prefix, setPrefix] = useState("");
  const [template, setTemplate] = useState("");
  const [versionId, setVersionId] = useState("");
  const [grantId, setGrantId] = useState("");
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const inFlight = useRef(false);
  const [executorOffsets, setExecutorOffsets] = useState([0]);
  const [executorIndex, setExecutorIndex] = useState(0);
  const executorOffset = executorOffsets[executorIndex] ?? 0;
  const [installations, reloadInstallations] = useLoad(`automation-executors:${workspaceId}:${executorOffset}`,
    () => workspaceId ? client.agentInstallations(workspaceId, executorOffset) : Promise.resolve(null));
  const executorResource = edit?.detail.automation.executorInstallationResourceId;
  const [selectedInstallation, reloadSelectedInstallation] = useLoad(`automation-executor:${executorResource}`,
    () => executorResource ? client.agentInstallation(executorResource) : Promise.resolve(null));
  const [admission, reloadAdmission] = useLoad(`automation-create:${workspaceId}`,
    () => workspaceId ? client.automations(workspaceId, 0) : Promise.resolve(null));
  const [tasks, reloadTasks] = useLoad("automation-actions-in-flight", client.tasks);
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => task.actionKey.startsWith("automation.") && taskPhase(task).tone === "neutral") ?? [];
  const requestBlocked = !taskRows || pending.some((task) => edit ? task.targetId === edit.detail.automation.resourceId : task.actionKey === "automation.create");
  const executorPage = installations.status === "ok" && installations.data && Array.isArray(installations.data.installations)
    && installations.data.installations.every((row) => validInstallation(row) && row.workspaceId === workspaceId)
    && new Set(installations.data.installations.map((row) => row.resourceId)).size === installations.data.installations.length
    && (installations.data.nextOffset === undefined || (Number.isSafeInteger(installations.data.nextOffset) && installations.data.nextOffset > executorOffset))
    ? installations.data : null;
  const executors = executorPage?.installations.filter((row) => row.state === AgentInstallationState.Active && row.agentPrincipalState === "ACTIVE") ?? [];
  const executor = edit ? selectedInstallation.status === "ok" && selectedInstallation.data
    && validInstallation(selectedInstallation.data) && selectedInstallation.data.resourceId === executorResource
    && selectedInstallation.data.workspaceId === workspaceId && selectedInstallation.data.state === AgentInstallationState.Active
    && selectedInstallation.data.agentPrincipalState === "ACTIVE" ? selectedInstallation.data : undefined
    : executors.find((row) => row.resourceId === executorId);
  const canCreate = admission.status === "ok" && admission.data && Array.isArray(admission.data.automations)
    && admission.data.automations.every((row) => validAutomation(row) && row.workspaceId === workspaceId)
    && typeof admission.data.canCreate === "boolean" && admission.data.canCreate;
  const versions = edit?.detail.versions.filter((row) => row.state === AgentVersionState.Published) ?? [];
  const grants = edit?.detail.delegations.filter((row) => new Date(row.expiresAt).getTime() > Date.now()) ?? [];
  const version = versions.find((row) => row.assetId === versionId);
  const grant = grants.find((row) => row.delegationId === grantId);
  const contentAction = !edit || edit.action === "publish_version";
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  useEffect(() => {
    const content = edit?.detail.versions[0]?.content;
    setTrigger(content?.trigger.kind ?? TriggerKind.ChannelMessage); setPrefix(content?.trigger.textPrefix ?? "");
    setTemplate(content?.action.template ?? "");
    setVersionId(""); setGrantId(""); setExecutorId("");
  }, [edit, workspaceId]);
  useEffect(() => { setExecutorIndex(0); setExecutorOffsets([0]); }, [workspaceId]);
  const prepare = () => {
    if (intent || busy || requestBlocked || !workspaceId || (!edit && (!canCreate || !executor))
      || (edit && !edit.detail.canManage) || (contentAction && !template.trim())
      || (contentAction && trigger === TriggerKind.Mention && !executor)
      || (edit?.action === "enable" && (!version || !grant))) return;
    const command: ActionCommand = { actionKey: edit ? `automation.${edit.action}` : "automation.create",
      idempotencyKey: newIdempotencyKey(), explicitConfirmation: true };
    if (edit) { command.resourceId = edit.detail.automation.resourceId; command.resourceVersion = edit.detail.automation.resourceVersion; }
    else { command.workspaceId = workspaceId; command.executorInstallationResourceId = executor!.resourceId; }
    if (contentAction) command.automationVersionContent = {
      trigger: { kind: trigger, ...(prefix ? { textPrefix: prefix } : {}),
        ...(trigger === TriggerKind.Mention ? { mentionPrincipalId: executor!.agentPrincipalId } : {}) },
      action: { kind: ActionKind.AgentTurn, template }, resultTarget: ResultTarget.TriggerThread,
    };
    if (edit?.action === "enable" && version && grant) {
      command.assetId = version.assetId; command.assetVersion = version.assetVersion;
      command.delegationId = grant.delegationId; command.delegationVersion = grant.delegationVersion;
    }
    setIntent(command); setFailure(null); setSubmission(null); onLocked(true);
  };
  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true; setBusy(true); setFailure(null); setSubmission(null);
    try {
      const result = await client.submitAction(intent);
      if (!result || result.actionKey !== intent.actionKey || !result.actionExecutionId || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState) || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setSubmission(result);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); onReset(); onRecorded(); reloadAdmission(); reloadInstallations();
      }
    } catch (error) {
      const failed = writeFailure(error); setFailure(failed);
      if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };
  const title = !edit ? "agents.automation.create" : edit.action === "publish_version" ? "agents.automation.publish"
    : edit.action === "enable" ? "agents.automation.enable" : edit.action === "pause" ? "agents.automation.pause" : "agents.automation.disable";
  // Scope 尚未读成真实 Workspace 时不制造空执行器/未知创建表单；已冻结的写意图仍保留。
  if (!workspaceId && !intent) return null;
  return <section className="flex flex-col gap-3 rounded-md border p-3">
    <h3 className="text-sm font-medium">{t(title)}</h3>
    {!intent ? <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      {edit ? <p className="break-words text-sm">{edit.detail.automation.resourceId} · {t("agents.resourceVersion")}: {edit.detail.automation.resourceVersion}</p> : null}
      {!edit ? <>
        {installations.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
          : !executorPage ? <AgentReadFailure error={installations.status === "error" ? installations.error : undefined} onRetry={reloadInstallations} />
          : executors.length === 0 ? <Notice>{t("agents.automation.noExecutor")}</Notice>
          : <label className="flex flex-col gap-1 text-sm">{t("agents.automation.executor")}
            <select required value={executorId} onChange={(event) => setExecutorId(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
              <option value="">{t("agents.automation.select")}</option>{executors.map((row) => <option key={row.resourceId} value={row.resourceId}>{row.resourceId}</option>)}
            </select>
          </label>}
        <div className="flex gap-2">
          {executorIndex > 0 ? <Button onClick={() => { setExecutorId(""); setExecutorIndex(executorIndex - 1); }}>{t("roles.previous")}</Button> : null}
          {executorPage?.nextOffset !== undefined ? <Button onClick={() => {
            setExecutorId(""); setExecutorOffsets((old) => [...old.slice(0, executorIndex + 1), executorPage.nextOffset!]); setExecutorIndex(executorIndex + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
      </> : null}
      {contentAction ? <>
        {edit && selectedInstallation.status === "error" ? <AgentReadFailure error={selectedInstallation.error} onRetry={reloadSelectedInstallation} /> : null}
        <label className="flex flex-col gap-1 text-sm">{t("agents.automation.trigger")}
          <select value={trigger} onChange={(event) => { const value = Object.values(TriggerKind).find((v) => v === event.target.value); if (value) setTrigger(value); }} className="h-8 rounded-md border border-input bg-background px-2">
            <option value={TriggerKind.ChannelMessage}>{t("agents.automation.channelMessage")}</option><option value={TriggerKind.Mention}>{t("agents.installation.trigger.mention")}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">{t("agents.automation.prefix")}
          <input value={prefix} onChange={(event) => setPrefix(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" />
        </label>
        <label className="flex flex-col gap-1 text-sm">{t("agents.automation.template")}
          <textarea required value={template} onChange={(event) => setTemplate(event.target.value)} className="min-h-24 rounded-md border border-input bg-transparent p-2" />
        </label>
        <p className="text-sm">{t("agents.automation.resultTarget")}: {t("agents.automation.thread")}</p>
      </> : null}
      {edit?.action === "enable" ? <>
        <label className="flex flex-col gap-1 text-sm">{t("agents.publishedVersion")}
          <select required value={versionId} onChange={(event) => setVersionId(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t("agents.automation.select")}</option>{versions.map((row) => <option key={row.assetId} value={row.assetId}>{row.assetId} · {row.assetVersion}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">{t("agents.automation.grant")}
          <select required value={grantId} onChange={(event) => setGrantId(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t("agents.automation.select")}</option>{grants.map((row) => <option key={row.delegationId} value={row.delegationId}>{row.delegationId} · {row.delegationVersion}</option>)}
          </select>
        </label>
      </> : null}
      <div className="flex gap-2">
        {edit || (canCreate && executor) ? <Button type="submit" disabled={requestBlocked || (edit?.action === "enable" && (!version || !grant))
          || (contentAction && trigger === TriggerKind.Mention && !executor)}>{t("agents.review")}</Button> : null}
        {edit ? <Button onClick={onReset}>{t("agents.cancel")}</Button> : null}
      </div>
      {!edit && admission.status === "error" ? <AgentReadFailure error={admission.error} onRetry={reloadAdmission} /> : null}
    </form> : <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-words">{intent.actionKey} · {intent.resourceId ?? intent.workspaceId} · {intent.resourceVersion ?? "—"}</p>
      {intent.automationVersionContent ? <>
        <p className="break-words">{t("agents.automation.executor")}: {intent.executorInstallationResourceId ?? edit?.detail.automation.executorInstallationResourceId}</p>
        <p>{t("agents.automation.trigger")}: {intent.automationVersionContent.trigger.kind === TriggerKind.Mention
          ? t("agents.installation.trigger.mention") : t("agents.automation.channelMessage")}</p>
        {intent.automationVersionContent.trigger.textPrefix ? <p className="break-words">{t("agents.automation.prefix")}: {intent.automationVersionContent.trigger.textPrefix}</p> : null}
        <p className="whitespace-pre-wrap">{intent.automationVersionContent.action.template}</p>
        <p>{t("agents.automation.resultTarget")}: {t("agents.automation.thread")}</p>
      </> : null}
      {intent.assetId ? <p className="break-words">{intent.assetId} · {intent.assetVersion} · {intent.delegationId} · {intent.delegationVersion}</p> : null}
      <p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}</div>
    </div>}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : t("roles.rejected", { reason: failureText(failure) })}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length ? <div role="status" className="flex flex-col gap-1 text-sm">{pending.map((task) => <p className="break-words" key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}
        <Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
  </section>;
}

const installationLabels = {
  [AgentInstallationState.Provisioning]: "agents.installation.state.provisioning",
  [AgentInstallationState.Active]: "agents.installation.state.active",
  [AgentInstallationState.Draining]: "agents.installation.state.draining",
  [AgentInstallationState.Disabled]: "agents.installation.state.disabled",
  [AgentInstallationState.Error]: "agents.installation.state.error",
} as const satisfies Record<AgentInstallationState, PlatformMessageKey>;
const projectionLabels = {
  [AgentRuntimeProjectionState.Pending]: "agents.installation.projection.pending",
  [AgentRuntimeProjectionState.Active]: "agents.installation.projection.active",
  [AgentRuntimeProjectionState.Error]: "agents.installation.projection.error",
  [AgentRuntimeProjectionState.Revoked]: "agents.installation.projection.revoked",
} as const satisfies Record<AgentRuntimeProjectionState, PlatformMessageKey>;
const resourceLabels = {
  [ResourceState.Provisioning]: "agents.installation.resource.provisioning",
  [ResourceState.Active]: "agents.installation.resource.active",
  [ResourceState.Unknown]: "agents.installation.resource.unknown",
  [ResourceState.Failed]: "agents.installation.resource.failed",
  [ResourceState.RetainedReadOnly]: "agents.installation.resource.retained",
  [ResourceState.Deleting]: "agents.installation.resource.deleting",
  [ResourceState.Deleted]: "agents.installation.resource.deleted",
} as const satisfies Record<ResourceState, PlatformMessageKey>;
const principalLabels = { ACTIVE: "agents.installation.principal.active", DISABLED: "agents.installation.principal.disabled" } as const;
const channelLabels = { ACTIVE: "agents.installation.channel.active", DISABLED: "agents.installation.channel.disabled", ERROR: "agents.installation.channel.error" } as const;
const triggerLabels = {
  [AgentTrigger.Mention]: "agents.installation.trigger.mention",
  [AgentTrigger.ManualAssignment]: "agents.installation.trigger.manual",
} as const satisfies Record<AgentTrigger, PlatformMessageKey>;

function validInstallation(row: AgentInstallationView): boolean {
  if (!row || ![row.resourceId, row.workspaceId, row.agentResourceId, row.pinnedVersionAssetId,
    row.agentPrincipalId, row.ownerPrincipalId].every((id) => typeof id === "string" && !!id)
    || !Number.isSafeInteger(row.resourceVersion) || row.resourceVersion <= 0
    || !Object.values(ResourceState).includes(row.resourceState)
    || !Object.values(AgentInstallationState).includes(row.state)
    || (row.agentPrincipalState !== "ACTIVE" && row.agentPrincipalState !== "DISABLED")) return false;
  const channel = row.channelBinding;
  if (channel !== undefined && (!channel || !["ACTIVE", "DISABLED", "ERROR"].includes(channel.status)
    || !Array.isArray(channel.triggers) || channel.triggers.length === 0
    || !channel.triggers.every((trigger) => Object.values(AgentTrigger).includes(trigger))
    || (channel.channelId !== undefined && (typeof channel.channelId !== "string" || !channel.channelId)))) return false;
  const projection = row.projection;
  if (projection !== undefined && (!projection || !Number.isSafeInteger(projection.generation) || projection.generation <= 0
    || projection.agentVersionAssetId !== row.pinnedVersionAssetId
    || typeof projection.runtimeProfileKey !== "string" || !projection.runtimeProfileKey
    || typeof projection.configHash !== "string" || !/^[0-9a-f]{64}$/.test(projection.configHash)
    || !Object.values(AgentRuntimeProjectionState).includes(projection.state))) return false;
  if (row.activeProjectionGeneration !== undefined && (!Number.isSafeInteger(row.activeProjectionGeneration)
    || row.activeProjectionGeneration <= 0 || projection?.generation !== row.activeProjectionGeneration)) return false;
  return row.state !== AgentInstallationState.Active || (row.resourceState === ResourceState.Active
    && row.activeProjectionGeneration !== undefined && projection?.state === AgentRuntimeProjectionState.Active);
}

function InstallationManagement() {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("agent-installation-workspaces", client.workspaces);
  const [selected, setSelected] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [revision, setRevision] = useState(0);
  const [delegationTarget, setDelegationTarget] = useState<AgentInstallationView | null>(null);
  const value = state.status === "ok" ? state.data : null;
  const workspaces = value && Array.isArray(value) && value.every((w) => w && typeof w.id === "string" && !!w.id
    && typeof w.name === "string" && typeof w.slug === "string") && new Set(value.map((w) => w.id)).size === value.length ? value : null;
  const workspace = workspaces?.find((w) => w.id === selected) ?? workspaces?.[0];
  return <section className="flex flex-col gap-3" data-testid="agent-installations">
    <h2 className="font-medium">{t("agents.installation.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("agents.installation.management")}</p>
    <Button className="w-fit" disabled={locked} onClick={reload}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !workspaces ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : !workspace ? <Notice>{t("agents.installation.noWorkspace")}</Notice>
      : <>
        <label className="flex flex-col gap-1 text-sm">{t("platform.workspace")}
          <select disabled={locked} className="h-8 rounded-md border border-input bg-background px-2" value={workspace.id}
            onChange={(event) => { setSelected(event.target.value); setDelegationTarget(null); }}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
      </>}
    {/* 原意图留在 Workspace/列表之外，结果不明时不生成替代键。 */}
    <InstallationCreate workspaceId={workspace?.id} workspaceName={workspace?.name} locked={locked} onLocked={setLocked}
      onRecorded={() => setRevision((old) => old + 1)} />
    <InstallationDelegation installation={delegationTarget} locked={locked} onLocked={setLocked} onReset={() => setDelegationTarget(null)}
      onRecorded={() => setRevision((old) => old + 1)} />
    {workspace ? <InstallationList key={`${workspace.id}:${revision}`} workspaceId={workspace.id} locked={locked} onManage={setDelegationTarget} /> : null}
  </section>;
}

function validInstallationCandidate(row: AgentInstallationCandidate): boolean {
  return !!row && typeof row.agentResourceId === "string" && !!row.agentResourceId
    && typeof row.agentVersionAssetId === "string" && !!row.agentVersionAssetId
    && typeof row.displayName === "string" && !!row.displayName
    && Number.isSafeInteger(row.resourceVersion) && row.resourceVersion > 0
    && Number.isSafeInteger(row.assetVersion) && row.assetVersion > 0
    && Number.isSafeInteger(row.ordinal) && row.ordinal > 0;
}

function InstallationCreate({ workspaceId, workspaceName, locked, onLocked, onRecorded }: {
  workspaceId?: string; workspaceName?: string; locked: boolean; onLocked: (locked: boolean) => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [intent, setIntent] = useState<{ command: ActionCommand; name: string; workspace: string; ordinal: number } | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const offset = offsets[index] ?? 0;
  const [sources, reloadSources] = useLoad(`installation-candidates:${workspaceId}:${offset}`,
    () => workspaceId ? client.agentInstallationCandidates(workspaceId, offset) : Promise.resolve(null));
  const page = sources.status === "ok" && sources.data && sources.data.workspaceId === workspaceId
    && typeof sources.data.canCreate === "boolean" && Array.isArray(sources.data.candidates)
    && sources.data.candidates.every(validInstallationCandidate)
    && new Set(sources.data.candidates.map((row) => row.agentVersionAssetId)).size === sources.data.candidates.length
    && (sources.data.canCreate || sources.data.candidates.length === 0)
    && (sources.data.nextOffset === undefined || (Number.isSafeInteger(sources.data.nextOffset) && sources.data.nextOffset > offset))
    ? sources.data : null;
  const candidate = page?.canCreate ? page.candidates.find((row) => row.agentVersionAssetId === selected) : undefined;
  const [tasks, reloadTasks] = useLoad("installation-actions-in-flight", client.tasks);
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => task.actionKey === "agent.installation.create"
    && (task.workspaceId === undefined || task.workspaceId === workspaceId) && taskPhase(task).tone === "neutral") ?? [];
  const requestBlocked = !taskRows || pending.length > 0;
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  useEffect(() => { setSelected(""); setOffsets([0]); setIndex(0); }, [workspaceId]);
  const prepare = () => {
    if (intent || locked || busy || requestBlocked || !workspaceId || !workspaceName || !candidate) return;
    setIntent({ command: { actionKey: "agent.installation.create", idempotencyKey: newIdempotencyKey(),
      workspaceId, resourceId: candidate.agentResourceId, resourceVersion: candidate.resourceVersion,
      assetId: candidate.agentVersionAssetId, assetVersion: candidate.assetVersion }, name: candidate.displayName,
      workspace: workspaceName, ordinal: candidate.ordinal });
    setFailure(null); setSubmission(null); onLocked(true);
  };
  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    if (!unknown) setFailure(null);
    try {
      const result = await client.submitAction(intent.command);
      if (!result || result.actionKey !== intent.command.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setFailure(null); setSubmission(result);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); setSelected(""); onLocked(false); onRecorded(); reloadSources();
      }
    } catch (error) {
      // A refused recheck cannot establish the original request's outcome.
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };
  if (!workspaceId && !intent) return null;
  return <section className="flex flex-col gap-3 rounded-md border p-3" data-testid="agent-installation-create">
    <h3 className="text-sm font-medium">{t("agents.installation.create")}</h3>
    {!intent ? <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      {sources.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !page ? <AgentReadFailure error={sources.status === "error" ? sources.error : undefined} onRetry={reloadSources} />
        : !page.canCreate ? <Notice>{t("agents.installation.createUnavailable")}</Notice>
        : page.candidates.length === 0 ? <Notice>{t("agents.installation.noPublished")}</Notice>
        : <label className="flex flex-col gap-1 text-sm">{t("agents.installation.definition")}
          <select disabled={locked} required value={selected} onChange={(event) => setSelected(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t("agents.automation.select")}</option>
            {page.candidates.map((row) => <option key={row.agentVersionAssetId} value={row.agentVersionAssetId}>{row.displayName} · {row.ordinal} · {row.agentVersionAssetId}</option>)}
          </select>
        </label>}
      <div className="flex gap-2">
        {index > 0 ? <Button disabled={locked} onClick={() => { setSelected(""); setIndex(index - 1); }}>{t("roles.previous")}</Button> : null}
        {page?.nextOffset !== undefined ? <Button disabled={locked} onClick={() => {
          setSelected(""); setOffsets((old) => [...old.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1);
        }}>{t("roles.next")}</Button> : null}
      </div>
      {page?.canCreate ? <Button className="w-fit" type="submit" disabled={locked || requestBlocked || !candidate}>{t("agents.review")}</Button> : null}
    </form> : <div className="flex flex-col gap-2 text-sm" role="group">
      <p>{intent.name}</p>
      <p className="break-words">{t("platform.workspace")}: {intent.workspace} · {intent.command.workspaceId}</p>
      <p className="break-words">{t("agents.installation.definition")}: {intent.command.resourceId} · {intent.command.resourceVersion}</p>
      <p className="break-words">{t("agents.publishedVersion")}: {intent.command.assetId} · {intent.command.assetVersion}</p>
      <p>{t("agents.version.ordinal")}: {intent.ordinal}</p>
      <p className="text-muted-foreground">{t("agents.installation.notReady")}</p>
      <p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}</div>
    </div>}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : t("roles.rejected", { reason: failureText(failure) })}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length ? <div role="status" className="flex flex-col gap-1 text-sm">{pending.map((task) => <p key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}
        <Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
  </section>;
}

function scopeKey(scope: DelegationScopeParameters): string {
  return JSON.stringify([scope.actionKey, scope.actionVersion, scope.targetType, scope.targetId,
    scope.createWorkspaceId, scope.toolResourceId, scope.resultExposureMode, scope.outputSchemaHash, scope.redactionPolicy]);
}

function validDelegationScope(scope: DelegationScopeParameters): boolean {
  return !!scope && typeof scope.actionKey === "string" && !!scope.actionKey
    && Number.isSafeInteger(scope.actionVersion) && scope.actionVersion > 0
    && typeof scope.targetType === "string" && !!scope.targetType
    && ((typeof scope.targetId === "string" && !!scope.targetId && scope.createWorkspaceId === undefined)
      || (typeof scope.createWorkspaceId === "string" && !!scope.createWorkspaceId && scope.targetId === undefined))
    && (scope.toolResourceId === undefined || (typeof scope.toolResourceId === "string" && !!scope.toolResourceId))
    && Object.values(ResultExposureMode).includes(scope.resultExposureMode)
    && typeof scope.outputSchemaHash === "string" && /^[0-9a-f]{64}$/.test(scope.outputSchemaHash)
    && typeof scope.redactionPolicy === "string" && !!scope.redactionPolicy;
}

function validDelegation(row: AgentDelegationView): boolean {
  return !!row && typeof row.delegationId === "string" && !!row.delegationId
    && Number.isSafeInteger(row.delegationVersion) && row.delegationVersion > 0
    && typeof row.grantorPrincipalId === "string" && !!row.grantorPrincipalId
    && ["ACTIVE", "REVOKING", "REVOKED", "EXPIRED"].includes(row.state)
    && Number.isSafeInteger(row.uses) && row.uses >= 0
    && !!row.parameters && typeof row.parameters.validFrom === "string" && Number.isFinite(Date.parse(row.parameters.validFrom))
    && typeof row.parameters.expiresAt === "string" && Number.isFinite(Date.parse(row.parameters.expiresAt))
    && Date.parse(row.parameters.expiresAt) > Date.parse(row.parameters.validFrom)
    && (row.parameters.maxUses === undefined || (Number.isSafeInteger(row.parameters.maxUses) && row.parameters.maxUses > 0))
    && Array.isArray(row.parameters.scopes) && row.parameters.scopes.length > 0
    && row.parameters.scopes.every(validDelegationScope)
    && new Set(row.parameters.scopes.map(scopeKey)).size === row.parameters.scopes.length;
}

function InstallationDelegation({ installation, locked, onLocked, onReset, onRecorded }: {
  installation: AgentInstallationView | null; locked: boolean; onLocked: (locked: boolean) => void;
  onReset: () => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [grantOffsets, setGrantOffsets] = useState([0]);
  const [targetOffsets, setTargetOffsets] = useState([0]);
  const [grantIndex, setGrantIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [intent, setIntent] = useState<{ command: ActionCommand; installation: AgentInstallationView; revokedGrant?: AgentDelegationView } | null>(null);
  const command = intent?.command;
  const reviewGrant = command?.delegationGrant ?? intent?.revokedGrant?.parameters;
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const resourceId = installation?.resourceId;
  const grantOffset = grantOffsets[grantIndex] ?? 0;
  const targetOffset = targetOffsets[targetIndex] ?? 0;
  const [grants, reloadGrants] = useLoad(`agent-delegations:${resourceId}:${grantOffset}`,
    () => resourceId ? client.agentDelegations(resourceId, grantOffset) : Promise.resolve(null));
  const page = grants.status === "ok" && grants.data && installation
    && grants.data.installationResourceId === installation.resourceId && grants.data.workspaceId === installation.workspaceId
    && grants.data.resourceVersion === installation.resourceVersion
    && typeof grants.data.canGrant === "boolean" && typeof grants.data.canRevoke === "boolean"
    && Array.isArray(grants.data.grants) && grants.data.grants.every(validDelegation)
    && new Set(grants.data.grants.map((row) => row.delegationId)).size === grants.data.grants.length
    && (grants.data.nextOffset === undefined || (Number.isSafeInteger(grants.data.nextOffset) && grants.data.nextOffset > grantOffset))
    ? grants.data : null;
  const [targets, reloadTargets] = useLoad(`agent-delegation-targets:${resourceId}:${targetOffset}`,
    () => resourceId ? client.agentDelegationTargets(resourceId, targetOffset) : Promise.resolve(null));
  const targetPage = targets.status === "ok" && targets.data && installation
    && targets.data.installationResourceId === installation.resourceId && targets.data.workspaceId === installation.workspaceId
    && targets.data.resourceVersion === installation.resourceVersion && Array.isArray(targets.data.scopes)
    && targets.data.scopes.every((scope) => validDelegationScope(scope) && scope.actionKey === "automation.run"
      && scope.targetType === "RESOURCE" && scope.targetId !== undefined && scope.createWorkspaceId === undefined && scope.toolResourceId === undefined)
    && new Set(targets.data.scopes.map(scopeKey)).size === targets.data.scopes.length
    && (targets.data.nextOffset === undefined || (Number.isSafeInteger(targets.data.nextOffset) && targets.data.nextOffset > targetOffset))
    ? targets.data : null;
  const scope = targetPage?.scopes.find((row) => scopeKey(row) === selected);
  const from = new Date(validFrom);
  const until = new Date(expiresAt);
  const uses = maxUses.trim() === "" ? undefined : Number(maxUses);
  const periodValid = Number.isFinite(from.getTime()) && Number.isFinite(until.getTime()) && until > from;
  const usesValid = uses === undefined || (Number.isSafeInteger(uses) && uses > 0);
  const [tasks, reloadTasks] = useLoad("delegation-actions-in-flight", client.tasks);
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => ["agent.delegation.grant", "agent.delegation.revoke"].includes(task.actionKey)
    && task.targetId === resourceId && taskPhase(task).tone === "neutral") ?? [];
  const requestBlocked = !taskRows || pending.length > 0;
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  useEffect(() => {
    setGrantOffsets([0]); setTargetOffsets([0]); setGrantIndex(0); setTargetIndex(0);
    setSelected(""); setValidFrom(""); setExpiresAt(""); setMaxUses("");
    if (installation) { setSubmission(null); setFailure(null); }
  }, [installation]);
  const prepare = (revoke?: AgentDelegationView) => {
    if (intent || locked || busy || requestBlocked || !installation || !page) return;
    const command: ActionCommand = { actionKey: revoke ? "agent.delegation.revoke" : "agent.delegation.grant",
      resourceId: installation.resourceId, resourceVersion: installation.resourceVersion,
      idempotencyKey: newIdempotencyKey(), explicitConfirmation: true };
    if (revoke) {
      if (!page.canRevoke || !page.grants.includes(revoke) || !["ACTIVE", "REVOKING"].includes(revoke.state)) return;
      command.delegationId = revoke.delegationId; command.delegationVersion = revoke.delegationVersion;
    } else {
      if (!page.canGrant || !scope || !periodValid || !usesValid) return;
      command.delegationId = newIdempotencyKey();
      command.delegationGrant = { validFrom: from, expiresAt: until,
        ...(uses === undefined ? {} : { maxUses: uses }), scopes: [{ ...scope }] };
    }
    setIntent({ command, installation, ...(revoke ? { revokedGrant: revoke } : {}) }); setFailure(null); setSubmission(null); onLocked(true);
  };
  const submit = async () => {
    if (!command || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    if (!unknown) setFailure(null);
    try {
      const result = await client.submitAction(command);
      if (!result || result.actionKey !== command.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setFailure(null); setSubmission(result);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); onReset(); onRecorded(); reloadGrants(); reloadTargets();
      }
    } catch (error) {
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };
  if (!installation && !intent && !submission && !failure) return null;
  return <section className="flex flex-col gap-3 rounded-md border p-3" data-testid="agent-delegation-management">
    <h3 className="text-sm font-medium">{t("agents.delegation.title")}</h3>
    {intent && command ? <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-words">{command.actionKey} · {command.resourceId} · {command.resourceVersion}</p>
      <p className="break-words">{t("platform.workspace")}: {intent.installation.workspaceId}</p>
      <p className="break-words">{t("agents.installation.principal")}: {intent.installation.agentPrincipalId}</p>
      <p className="break-words">{t("agents.installation.version")}: {intent.installation.pinnedVersionAssetId}</p>
      <p>{t("agents.installation.activeGeneration")}: {intent.installation.activeProjectionGeneration ?? t("agents.installation.notRecorded")}</p>
      <p className="break-words">{t("agents.automation.grant")}: {command.delegationId} · {command.delegationVersion ?? "—"}</p>
      {reviewGrant ? <>
        <p>{t("agents.delegation.validFrom")}: {String(reviewGrant.validFrom)}</p>
        <p>{t("agents.delegation.expiresAt")}: {String(reviewGrant.expiresAt)}</p>
        <p>{t("agents.delegation.maxUses")}: {reviewGrant.maxUses ?? t("agents.delegation.noUseLimit")}</p>
        {reviewGrant.scopes.map((row) => <DelegationScope key={scopeKey(row)} scope={row} />)}
      </> : null}
      <p className="text-muted-foreground">{t("agents.delegation.admission")}</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}</div>
    </div> : installation ? <>
      <p className="break-words text-sm">{t("agents.installation.id")}: {installation.resourceId} · {t("platform.workspace")}: {installation.workspaceId}</p>
      {grants.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !page ? <AgentReadFailure error={grants.status === "error" ? grants.error : undefined} onRetry={reloadGrants} />
        : <>
          {page.grants.length === 0 ? <Notice>{t("agents.delegation.none")}</Notice>
            : page.grants.map((row) => <section className="flex flex-col gap-2 border-t pt-2 text-sm" key={row.delegationId}>
              <p className="break-words">{row.delegationId} · {row.delegationVersion} · <Badge tone="neutral">{t(delegationLabels[row.state])}</Badge></p>
              <p className="break-words">{t("agents.delegation.grantor")}: {row.grantorPrincipalId}</p>
              <p>{t("agents.delegation.validFrom")}: {String(row.parameters.validFrom)} · {t("agents.delegation.expiresAt")}: {String(row.parameters.expiresAt)}</p>
              <p>{t("agents.delegation.uses")}: {row.uses} · {t("agents.delegation.maxUses")}: {row.parameters.maxUses ?? t("agents.delegation.noUseLimit")}</p>
              {row.parameters.scopes.map((item) => <DelegationScope key={scopeKey(item)} scope={item} />)}
              {page.canRevoke && ["ACTIVE", "REVOKING"].includes(row.state) ? <Button className="w-fit" disabled={locked || requestBlocked} onClick={() => prepare(row)}>{t("agents.delegation.revoke")}</Button> : null}
            </section>)}
          <div className="flex gap-2">
            {grantIndex > 0 ? <Button disabled={locked} onClick={() => setGrantIndex(grantIndex - 1)}>{t("roles.previous")}</Button> : null}
            {page.nextOffset !== undefined ? <Button disabled={locked} onClick={() => { setGrantOffsets((old) => [...old.slice(0, grantIndex + 1), page.nextOffset!]); setGrantIndex(grantIndex + 1); }}>{t("roles.next")}</Button> : null}
          </div>
        </>}
      {page?.canGrant ? targets.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !targetPage ? <AgentReadFailure error={targets.status === "error" ? targets.error : undefined} onRetry={reloadTargets} />
        : <>
          {targetPage.scopes.length === 0 ? <Notice>{t("agents.delegation.noTarget")}</Notice> : <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
            <label className="flex flex-col gap-1 text-sm">{t("agents.delegation.target")}
              <select disabled={locked} required value={selected} onChange={(event) => setSelected(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
                <option value="">{t("agents.automation.select")}</option>{targetPage.scopes.map((row) => <option key={scopeKey(row)} value={scopeKey(row)}>{row.actionKey} · {row.targetId} · {row.actionVersion}</option>)}
              </select>
            </label>
            <p className="text-xs text-muted-foreground">{t("agents.delegation.localTime")}</p>
            <label className="flex flex-col gap-1 text-sm">{t("agents.delegation.validFrom")}<input disabled={locked} required type="datetime-local" step="1" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.delegation.expiresAt")}<input disabled={locked} required type="datetime-local" step="1" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.delegation.maxUses")}<input disabled={locked} type="number" min="1" step="1" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" /><span className="text-xs text-muted-foreground">{t("agents.delegation.noUseLimit")}</span></label>
            {validFrom && expiresAt && !periodValid ? <Notice role="alert">{t("agents.delegation.invalidPeriod")}</Notice> : null}
            <Button className="w-fit" disabled={locked || requestBlocked || !scope || !periodValid || !usesValid} type="submit">{t("agents.review")}</Button>
          </form>}
          <div className="flex gap-2">
            {targetIndex > 0 ? <Button disabled={locked} onClick={() => { setSelected(""); setTargetIndex(targetIndex - 1); }}>{t("roles.previous")}</Button> : null}
            {targetPage.nextOffset !== undefined ? <Button disabled={locked} onClick={() => { setSelected(""); setTargetOffsets((old) => [...old.slice(0, targetIndex + 1), targetPage.nextOffset!]); setTargetIndex(targetIndex + 1); }}>{t("roles.next")}</Button> : null}
          </div>
        </> : null}
      <div className="flex gap-2"><Button disabled={locked} onClick={() => { reloadGrants(); reloadTargets(); }}>{t("platform.refresh")}</Button><Button disabled={locked} onClick={onReset}>{t("platform.back")}</Button></div>
    </> : null}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : t("roles.rejected", { reason: failureText(failure) })}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length ? <div role="status" className="flex flex-col gap-1 text-sm">{pending.map((task) => <p key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}<Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
  </section>;
}

const delegationLabels: Record<AgentDelegationView["state"], PlatformMessageKey> = {
  ACTIVE: "agents.delegation.state.active", REVOKING: "agents.delegation.state.revoking",
  REVOKED: "agents.delegation.state.revoked", EXPIRED: "agents.delegation.state.expired",
};

function DelegationScope({ scope }: { scope: DelegationScopeParameters }) {
  return <div className="flex flex-col gap-1 break-words text-sm">
    <p>{scope.actionKey} · {scope.actionVersion} · {scope.targetType} · {scope.targetId ?? scope.createWorkspaceId}</p>
    <p>{scope.resultExposureMode} · {scope.redactionPolicy}</p>
    <p className="break-all font-mono text-xs">{scope.outputSchemaHash}</p>
  </div>;
}

function InstallationList({ workspaceId, locked, onManage }: {
  workspaceId: string; locked: boolean; onManage: (row: AgentInstallationView) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const offset = offsets[pageIndex] ?? 0;
  const [state, reload] = useLoad(`agent-installations:${workspaceId}:${offset}`, () => client.agentInstallations(workspaceId, offset));
  const value = state.status === "ok" ? state.data : null;
  const page = value && Array.isArray(value.installations) && value.installations.every((row) => validInstallation(row) && row.workspaceId === workspaceId)
    && new Set(value.installations.map((row) => row.resourceId)).size === value.installations.length
    && (value.nextOffset === undefined || (Number.isSafeInteger(value.nextOffset) && value.nextOffset > offset)) ? value : null;
  const next = page?.nextOffset;
  const changePage = (index: number) => { setSelected(null); setPageIndex(index); };
  return <div className="flex flex-col gap-3">
    <Button className="w-fit" disabled={locked} onClick={() => { setSelected(null); reload(); }}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={() => { setSelected(null); reload(); }} />
      : <>
        {page.installations.length === 0 ? <Notice>{t("agents.installation.none")}</Notice>
          : <Table head={[t("agents.installation.id"), t("agents.installation.version"), t("agents.installation.principal"), t("platform.state"), ""]}>
            {page.installations.map((row) => <tr key={row.resourceId}>
              <Cell mono>{row.resourceId}</Cell><Cell mono>{row.pinnedVersionAssetId}</Cell><Cell mono>{row.agentPrincipalId}</Cell>
              <Cell><Badge tone="neutral">{t(installationLabels[row.state])}</Badge></Cell>
              <Cell><Button disabled={locked} onClick={() => setSelected(row.resourceId)}>{t("agents.installation.open")}</Button></Cell>
            </tr>)}
          </Table>}
        <div className="flex gap-2">
          {pageIndex > 0 ? <Button disabled={locked} onClick={() => changePage(pageIndex - 1)}>{t("roles.previous")}</Button> : null}
          {next !== undefined ? <Button disabled={locked} onClick={() => { setOffsets((old) => [...old.slice(0, pageIndex + 1), next]); changePage(pageIndex + 1); }}>{t("roles.next")}</Button> : null}
        </div>
        {selected ? <InstallationDetail key={selected} resourceId={selected} workspaceId={workspaceId} locked={locked} onManage={onManage} /> : null}
      </>}
  </div>;
}

function InstallationDetail({ resourceId, workspaceId, locked, onManage }: {
  resourceId: string; workspaceId: string; locked: boolean; onManage: (row: AgentInstallationView) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`agent-installation:${workspaceId}:${resourceId}`, () => client.agentInstallation(resourceId));
  const row = state.status === "ok" && validInstallation(state.data) && state.data.resourceId === resourceId
    && state.data.workspaceId === workspaceId ? state.data : null;
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (!row) return <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />;
  return <section className="flex flex-col gap-2 border-t pt-3" data-testid="agent-installation-detail">
    <h3 className="text-sm font-medium">{t("agents.installation.id")}: <span className="break-all font-mono">{row.resourceId}</span></h3>
    <Badge tone="neutral">{t(installationLabels[row.state])}</Badge>
    <p className="text-sm">{t(resourceLabels[row.resourceState])} · {t("agents.resourceVersion")}: {row.resourceVersion}</p>
    <p className="break-all text-sm">{t("agents.owner")}: {row.ownerPrincipalId}</p>
    <p className="break-all text-sm">{t("platform.workspace")}: {row.workspaceId}</p>
    <p className="break-all text-sm">{t("agents.installation.definition")}: {row.agentResourceId}</p>
    <p className="break-all text-sm">{t("agents.installation.version")}: {row.pinnedVersionAssetId}</p>
    <p className="break-all text-sm">{t("agents.installation.principal")}: {row.agentPrincipalId} · {t(principalLabels[row.agentPrincipalState])}</p>
    <h4 className="text-sm font-medium">{t("agents.installation.channel")}</h4>
    {row.channelBinding ? <>
      <p className="text-sm">{t(channelLabels[row.channelBinding.status])}</p>
      <p className="break-all text-sm">{row.channelBinding.channelId ?? t("agents.installation.notRecorded")}</p>
      <p className="text-sm">{t("agents.installation.triggers")}: {row.channelBinding.triggers.map((trigger) => t(triggerLabels[trigger])).join(" · ")}</p>
    </> : <p role="status" className="text-sm">{t("agents.installation.notRecorded")}</p>}
    <h4 className="text-sm font-medium">{t("agents.installation.projection")}</h4>
    <p className="text-sm">{t("agents.installation.activeGeneration")}: {row.activeProjectionGeneration ?? t("agents.installation.notRecorded")}</p>
    {row.projection ? <>
      <p className="text-sm">{t(projectionLabels[row.projection.state])} · {t("agents.installation.generation")}: {row.projection.generation}</p>
      <p className="break-words text-sm">{t("agents.version.runtimeProfile")}: {row.projection.runtimeProfileKey}</p>
      <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {row.projection.configHash}</p>
    </> : <p role="status" className="text-sm">{t("agents.installation.notRecorded")}</p>}
    {row.state === AgentInstallationState.Active && row.resourceState === ResourceState.Active
      ? <Button className="w-fit" disabled={locked} onClick={() => onManage(row)}>{t("agents.delegation.open")}</Button> : null}
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    {row.state === AgentInstallationState.Active ? <InstallationMemory resourceId={resourceId} workspaceId={workspaceId} installation={row} /> : null}
  </section>;
}

function DefinitionDetail({ resourceId, locked, onEdit, onVersionEdit }: {
  resourceId: string; locked: boolean; onEdit: (target: AgentDefinitionView, owner: boolean) => void;
  onVersionEdit: (edit: VersionEdit) => void;
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
      <VersionDirectory definition={row} locked={locked} onEdit={onVersionEdit} />
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

const versionLabels = {
  [AgentVersionState.Draft]: "agents.version.draft",
  [AgentVersionState.Published]: "agents.version.published",
  [AgentVersionState.Retired]: "agents.version.retired",
} as const satisfies Record<AgentVersionState, PlatformMessageKey>;

function validVersion(row: AgentVersionView, resourceId: string): boolean {
  const content = row?.content;
  return !!row && row.agentResourceId === resourceId
    && [row.assetId, row.ownerPrincipalId].every((id) => typeof id === "string" && !!id)
    && Number.isSafeInteger(row.assetVersion) && row.assetVersion > 0
    && Number.isSafeInteger(row.ordinal) && row.ordinal > 0
    && Object.values(AgentVersionState).includes(row.state)
    && typeof row.configHash === "string" && /^[a-f0-9]{64}$/.test(row.configHash)
    && (row.canUpdate === undefined || typeof row.canUpdate === "boolean")
    && (row.canPublish === undefined || typeof row.canPublish === "boolean")
    && (row.state === AgentVersionState.Draft || (!row.canUpdate && !row.canPublish))
    && !!content && typeof content.instructions === "string" && !!content.instructions.trim()
    && !!content.personaIdentity && typeof content.personaIdentity.displayName === "string" && !!content.personaIdentity.displayName.trim()
    && [content.personaIdentity.description, content.personaIdentity.avatarUrl].every((value) => value === undefined || typeof value === "string")
    && [content.runtimeProfileKey, content.modelRouteResourceId, content.replyPolicy].every((value) => typeof value === "string" && !!value.trim())
    && [content.skillVersionAssetIds, content.declaredToolResourceIds, content.capabilityRequirements].every((values) => Array.isArray(values)
      && values.every((value) => typeof value === "string" && !!value.trim()) && new Set(values).size === values.length)
    && content.capabilityRequirements.every((key) => /^[^@]+@[^@\s]+$/.test(key))
    && Array.isArray(content.triggerDefaults) && content.triggerDefaults.every((trigger) => Object.values(AgentTrigger).includes(trigger))
    && new Set(content.triggerDefaults).size === content.triggerDefaults.length
    && Number.isSafeInteger(content.parallelism) && content.parallelism > 0
    && !!content.turnLimits && Number.isSafeInteger(content.turnLimits.idleTimeoutSeconds) && content.turnLimits.idleTimeoutSeconds > 0
    && Number.isSafeInteger(content.turnLimits.maxTurnDurationSeconds) && content.turnLimits.maxTurnDurationSeconds >= content.turnLimits.idleTimeoutSeconds
    && !!content.memoryPolicy && Object.values(AgentMemoryCoreWrite).includes(content.memoryPolicy.coreWrite)
    && Object.values(AgentMemoryColdWrite).includes(content.memoryPolicy.coldWrite);
}

function validVersionConfiguration(page: AgentVersionConfigurationPage, definition: AgentDefinitionView, offset: number): boolean {
  return !!page && page.agentResourceId === definition.resourceId && page.resourceVersion === definition.resourceVersion
    && typeof page.canCreate === "boolean" && Array.isArray(page.profiles) && Array.isArray(page.routes)
    && page.profiles.every((profile) => profile && typeof profile.key === "string" && !!profile.key.trim()
      && profile.kind === RuntimeProfileKind.ServerCodex && profile.status === "ACTIVE" && profile.webAvailability === "ENABLED"
      && !!profile.capabilityContract && Number.isSafeInteger(profile.capabilityContract.maxParallelism) && profile.capabilityContract.maxParallelism > 0
      && Number.isSafeInteger(profile.capabilityContract.maxIdleTimeoutSeconds) && profile.capabilityContract.maxIdleTimeoutSeconds > 0
      && Number.isSafeInteger(profile.capabilityContract.maxTurnDurationSeconds)
      && profile.capabilityContract.maxTurnDurationSeconds >= profile.capabilityContract.maxIdleTimeoutSeconds
      && Array.isArray(profile.capabilityContract.replyPolicies) && profile.capabilityContract.replyPolicies.length > 0
      && profile.capabilityContract.replyPolicies.every((key) => typeof key === "string" && !!key.trim())
      && new Set(profile.capabilityContract.replyPolicies).size === profile.capabilityContract.replyPolicies.length
      && Array.isArray(profile.capabilityContract.capabilityRequirements)
      && profile.capabilityContract.capabilityRequirements.every((key) => typeof key === "string" && /^[^@]+@[^@\s]+$/.test(key))
      && new Set(profile.capabilityContract.capabilityRequirements).size === profile.capabilityContract.capabilityRequirements.length)
    && page.routes.every((route) => route && [route.resourceId, route.ownerPrincipalId].every((id) => typeof id === "string" && !!id)
      && Number.isSafeInteger(route.resourceVersion) && route.resourceVersion > 0
      && (route.homeWorkspaceId === undefined || (typeof route.homeWorkspaceId === "string" && !!route.homeWorkspaceId))
      && route.nativeConfigResourceId === route.resourceId && Number.isSafeInteger(route.nativeRevision) && route.nativeRevision > 0
      && typeof route.nativeConfigHash === "string" && /^[a-f0-9]{64}$/.test(route.nativeConfigHash))
    && new Set(page.profiles.map((profile) => profile.key)).size === page.profiles.length
    && new Set(page.routes.map((route) => route.resourceId)).size === page.routes.length
    && ((page.profiles.length === 0) === (page.routes.length === 0))
    && (!page.canCreate || page.routes.length > 0)
    && (page.nextOffset == null || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > offset));
}

type VersionEdit = { definition: AgentDefinitionView; version?: AgentVersionView; publish: boolean; configurationOffsets: number[] };

function VersionDirectory({ definition, locked, onEdit }: {
  definition: AgentDefinitionView; locked: boolean; onEdit: (edit: VersionEdit) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`agent-versions:${definition.resourceId}:${offset}`, () => client.agentVersions(definition.resourceId, offset));
  const [sourceOffsets, setSourceOffsets] = useState([0]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const sourceOffset = sourceOffsets[sourceIndex] ?? 0;
  const [configuration, reloadConfiguration] = useLoad(`version-sources:${definition.resourceId}:${sourceOffset}`, () => client.agentVersionConfiguration(definition.resourceId, sourceOffset));
  const data = state.status === "ok" ? state.data : null;
  const page = data && data.agentResourceId === definition.resourceId && data.resourceVersion === definition.resourceVersion
    && Array.isArray(data.versions) && data.versions.every((version) => validVersion(version, definition.resourceId))
    && new Set(data.versions.map((version) => version.assetId)).size === data.versions.length
    && new Set(data.versions.map((version) => version.ordinal)).size === data.versions.length
    && (data.nextOffset == null || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset)) ? data : null;
  const source = configuration.status === "ok" && validVersionConfiguration(configuration.data, definition, sourceOffset) ? configuration.data : null;
  const configurationOffsets = sourceOffsets.slice(0, sourceIndex + 1);
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="agent-version-directory">
    <h3 className="font-medium">{t("agents.version.history")}</h3>
    <p className="text-sm text-muted-foreground">{t("agents.version.boundary")}</p>
    <div className="flex flex-wrap gap-2"><Button disabled={locked} onClick={() => { reload(); reloadConfiguration(); }}>{t("platform.refresh")}</Button>
      {page && source?.canCreate ? <Button disabled={locked} onClick={() => onEdit({ definition, publish: false, configurationOffsets })}>{t("agents.version.create")}</Button> : null}</div>
    {configuration.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !source ? <AgentReadFailure error={configuration.status === "error" ? configuration.error : undefined} onRetry={reloadConfiguration} />
      : !source.canCreate ? <p className="text-sm text-muted-foreground">{t("agents.version.createUnavailable")}</p> : null}
    {source ? <div className="flex flex-wrap gap-2 text-sm"><span>{t("agents.version.configurationPages")}</span>
      {sourceIndex > 0 ? <Button disabled={locked} onClick={() => setSourceIndex(sourceIndex - 1)}>{t("roles.previous")}</Button> : null}
      {source.nextOffset != null ? <Button disabled={locked} onClick={() => { setSourceOffsets((values) => [...values.slice(0, sourceIndex + 1), source.nextOffset!]); setSourceIndex(sourceIndex + 1); }}>{t("roles.next")}</Button> : null}</div> : null}
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {page.versions.length === 0 ? <Notice>{t("agents.version.none")}</Notice>
          : page.versions.map((version) => <section key={version.assetId} className="flex flex-col gap-2 border-t pt-3">
            <h4 className="text-sm font-medium">{version.content.personaIdentity.displayName} · {version.ordinal} · <Badge tone="neutral">{t(versionLabels[version.state])}</Badge></h4>
            <p className="break-words text-sm">{version.assetId} · {t("agents.version.assetVersion")}: {version.assetVersion}</p>
            <p className="break-words text-sm">{t("agents.owner")}: {version.ownerPrincipalId}</p>
            <p className="break-words text-sm">{t("agents.version.runtimeProfile")}: {version.content.runtimeProfileKey} · {t("agents.version.modelRoute")}: {version.content.modelRouteResourceId}</p>
            <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {version.configHash}</p>
            <details><summary className="cursor-pointer text-sm">{t("agents.version.instructions")}</summary>
              <pre className="whitespace-pre-wrap break-words text-sm">{version.content.instructions}</pre></details>
            {version.state === AgentVersionState.Draft && source && source.routes.length > 0 ? <div className="flex flex-wrap gap-2">
              {version.canUpdate === true ? <Button disabled={locked} onClick={() => onEdit({ definition, version, publish: false, configurationOffsets })}>{t("agents.version.edit")}</Button> : null}
              {version.canPublish === true ? <Button disabled={locked} onClick={() => onEdit({ definition, version, publish: true, configurationOffsets })}>{t("agents.version.publish")}</Button> : null}
            </div> : null}
          </section>)}
        <div className="flex gap-2">{index > 0 ? <Button disabled={locked} onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
          {page.nextOffset != null ? <Button disabled={locked} onClick={() => { setOffsets((values) => [...values.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1); }}>{t("roles.next")}</Button> : null}</div>
      </>}
  </section>;
}

function VersionAction({ edit, onReset, onLocked, onRecorded }: {
  edit: VersionEdit | null; onReset: () => void; onLocked: (locked: boolean) => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const inFlight = useRef(false);
  const [profileKey, setProfileKey] = useState("");
  const [routeId, setRouteId] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [reply, setReply] = useState("");
  const [parallelism, setParallelism] = useState("");
  const [idle, setIdle] = useState("");
  const [duration, setDuration] = useState("");
  const [coreWrite, setCoreWrite] = useState("");
  const [coldWrite, setColdWrite] = useState("");
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  useEffect(() => {
    const content = edit?.version?.content;
    setName(content?.personaIdentity.displayName ?? ""); setAvatar(content?.personaIdentity.avatarUrl ?? "");
    setDescription(content?.personaIdentity.description ?? ""); setInstructions(content?.instructions ?? "");
    setProfileKey(content?.runtimeProfileKey ?? ""); setRouteId(content?.modelRouteResourceId ?? ""); setReply(content?.replyPolicy ?? "");
    setParallelism(content ? String(content.parallelism) : ""); setIdle(content ? String(content.turnLimits.idleTimeoutSeconds) : "");
    setDuration(content ? String(content.turnLimits.maxTurnDurationSeconds) : "");
    setCoreWrite(content?.memoryPolicy.coreWrite ?? ""); setColdWrite(content?.memoryPolicy.coldWrite ?? "");
    setTriggers(content?.triggerDefaults ?? []); setCapabilities(content?.capabilityRequirements ?? []);
    setOffsets(edit?.configurationOffsets ?? [0]); setIndex((edit?.configurationOffsets.length ?? 1) - 1);
  }, [edit]);
  const offset = offsets[index] ?? 0;
  const [configuration, reloadConfiguration] = useLoad(`version-action-sources:${edit?.definition.resourceId ?? "none"}:${offset}`,
    () => edit ? client.agentVersionConfiguration(edit.definition.resourceId, offset) : Promise.resolve(null));
  const [tasks, reloadTasks] = useLoad("agent-version-actions-in-flight", client.tasks);
  const source = edit && configuration.status === "ok" && configuration.data
    && validVersionConfiguration(configuration.data, edit.definition, offset) ? configuration.data : null;
  const profile = source?.profiles.find((value) => value.key === profileKey);
  const route = source?.routes.find((value) => value.resourceId === routeId);
  const contract = profile?.capabilityContract;
  const corePolicy = Object.values(AgentMemoryCoreWrite).find((value) => value === coreWrite);
  const coldPolicy = Object.values(AgentMemoryColdWrite).find((value) => value === coldWrite);
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => ["agent.version.create", "agent.version.update", "agent.version.publish"].includes(task.actionKey)
    && taskPhase(task).tone === "neutral") ?? [];
  // 未知创建目标是 Definition，编辑/发布目标是 Asset；任何未查证版本请求阻止新意图。
  const requestBlocked = !taskRows || pending.length > 0;
  const actionKey = edit?.publish ? "agent.version.publish" : edit?.version ? "agent.version.update" : "agent.version.create";
  const title: PlatformMessageKey = edit?.publish ? "agents.version.publish" : edit?.version ? "agents.version.edit" : "agents.version.create";
  const permitted = !!edit && !!source && source.routes.length > 0
    && (edit.version ? edit.version.state === AgentVersionState.Draft && (edit.publish ? edit.version.canPublish === true : edit.version.canUpdate === true) : source.canCreate);
  const sourceContent = edit?.version?.content;
  const supported = !sourceContent || (sourceContent.skillVersionAssetIds.length === 0 && sourceContent.declaredToolResourceIds.length === 0);
  const integer = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const valid = permitted && supported && !!profile && !!route && !!contract && !!name.trim() && !!instructions.trim()
    && contract.replyPolicies.includes(reply) && capabilities.every((key) => contract.capabilityRequirements.includes(key))
    && integer(parallelism) && Number(parallelism) <= contract.maxParallelism
    && integer(idle) && Number(idle) <= contract.maxIdleTimeoutSeconds
    && integer(duration) && Number(duration) <= contract.maxTurnDurationSeconds && Number(idle) <= Number(duration)
    && corePolicy !== undefined && coldPolicy !== undefined;
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  const prepare = () => {
    if (!edit || intent || busy || requestBlocked || !valid || corePolicy === undefined || coldPolicy === undefined) return;
    const command: ActionCommand = { actionKey, idempotencyKey: newIdempotencyKey(),
      resourceId: edit.definition.resourceId, resourceVersion: edit.definition.resourceVersion };
    if (edit.version) { command.assetId = edit.version.assetId; command.assetVersion = edit.version.assetVersion; }
    if (edit.publish) command.explicitConfirmation = true;
    else command.agentVersionContent = {
      personaIdentity: { displayName: name, ...(avatar ? { avatarUrl: avatar } : {}), ...(description ? { description } : {}) },
      instructions, runtimeProfileKey: profileKey, modelRouteResourceId: routeId, replyPolicy: reply,
      parallelism: Number(parallelism), turnLimits: { idleTimeoutSeconds: Number(idle), maxTurnDurationSeconds: Number(duration) },
      memoryPolicy: { coreWrite: corePolicy, coldWrite: coldPolicy },
      capabilityRequirements: [...capabilities], triggerDefaults: [...triggers], skillVersionAssetIds: [], declaredToolResourceIds: [],
    };
    setIntent(command); setSubmission(null); setFailure(null); onLocked(true);
  };
  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    if (!unknown) setFailure(null);
    try {
      const result = await client.submitAction(intent);
      if (!result || result.actionKey !== intent.actionKey || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setFailure(null); setSubmission(result);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); onReset(); onRecorded();
      }
    } catch (error) {
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };
  if (!edit && !intent && !submission && !failure) return null;
  return <section className="flex flex-col gap-3 rounded-md border p-3" data-testid="agent-version-action">
    <h2 className="font-medium">{t(edit || intent ? title : "agents.version.history")}</h2>
    {edit ? <p className="break-words text-sm">{edit.definition.displayName} · {edit.definition.resourceId} · {t("agents.resourceVersion")}: {edit.definition.resourceVersion}</p> : null}
    <p className="text-sm text-muted-foreground">{t("agents.version.boundary")}</p>
    {intent ? <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-words">{intent.actionKey} · {intent.assetId ?? intent.resourceId} · {intent.assetVersion ?? intent.resourceVersion}</p>
      <p>{t("agents.owner")}: {edit?.version?.ownerPrincipalId ?? t("agents.version.currentHumanOwner")}</p>
      <p className="break-words">{t("agents.name")}: {name}</p>
      {avatar ? <p className="break-words">{t("agents.version.avatar")}: {avatar}</p> : null}
      {description ? <p className="whitespace-pre-wrap break-words">{t("agents.version.description")}: {description}</p> : null}
      <p className="break-words">{t("agents.version.runtimeProfile")}: {profileKey} · {t("agents.version.modelRoute")}: {routeId}</p>
      {edit?.version ? <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {edit.version.configHash}</p> : null}
      <p>{t("agents.version.replyPolicy")}: {reply} · {t("agents.version.parallelism")}: {parallelism}</p>
      <p>{t("agents.version.idleTimeout")}: {idle} · {t("agents.version.maxDuration")}: {duration}</p>
      <p>{t("agents.version.coreWrite")}: {coreWrite === AgentMemoryCoreWrite.HumanOnly ? t("agents.version.coreHumanOnly") : t("agents.version.coreApproval")}</p>
      <p>{t("agents.version.coldWrite")}: {coldWrite === AgentMemoryColdWrite.Disabled ? t("agents.version.coldDisabled") : t("agents.version.coldInvocation")}</p>
      <p className="break-words">{t("agents.version.capabilities")}: {capabilities.join(", ") || "—"}</p>
      <p>{t("agents.version.triggers")}: {triggers.map((trigger) => t(trigger === AgentTrigger.Mention ? "agents.installation.trigger.mention" : "agents.version.manualAssignment")).join(", ") || "—"}</p>
      <pre className="whitespace-pre-wrap break-words">{instructions}</pre>
      <p>{t(edit?.publish ? "agents.version.publishReview" : "agents.version.saveReview")}</p><p>{t("agents.admission")}</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}</div>
    </div> : edit ? <>
      {configuration.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !source ? <AgentReadFailure error={configuration.status === "error" ? configuration.error : undefined} onRetry={reloadConfiguration} />
        : <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
          {!permitted || !supported ? <Notice>{t("agents.version.createUnavailable")}</Notice> : null}
          <fieldset disabled={!!edit?.publish || !permitted || !supported} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">{t("agents.name")}<input required value={name} onChange={(event) => setName(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.avatar")}<input value={avatar} onChange={(event) => setAvatar(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.description")}<textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-16 rounded-md border border-input bg-background p-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.instructions")}<textarea required value={instructions} onChange={(event) => setInstructions(event.target.value)} className="min-h-32 rounded-md border border-input bg-background p-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.runtimeProfile")}<select required value={profileKey} onChange={(event) => { setProfileKey(event.target.value); setReply(""); setCapabilities([]); }} className="h-8 rounded-md border border-input bg-background px-2">
              <option value="">{t("agents.automation.select")}</option>{source.profiles.map((value) => <option key={value.key} value={value.key}>{value.key}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.modelRoute")}<select required value={routeId} onChange={(event) => setRouteId(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
              <option value="">{t("agents.automation.select")}</option>{source.routes.map((value) => <option key={value.resourceId} value={value.resourceId}>{value.resourceId} · {value.resourceVersion} · {value.nativeRevision}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.replyPolicy")}<select required value={reply} onChange={(event) => setReply(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
              <option value="">{t("agents.automation.select")}</option>{contract?.replyPolicies.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.parallelism")}<input required type="number" min={1} step={1} max={contract?.maxParallelism} value={parallelism} onChange={(event) => setParallelism(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.idleTimeout")}<input required type="number" min={1} step={1} max={contract?.maxIdleTimeoutSeconds} value={idle} onChange={(event) => setIdle(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.maxDuration")}<input required type="number" min={1} step={1} max={contract?.maxTurnDurationSeconds} value={duration} onChange={(event) => setDuration(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.coreWrite")}<select required value={coreWrite} onChange={(event) => setCoreWrite(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
              <option value="">{t("agents.automation.select")}</option><option value={AgentMemoryCoreWrite.HumanOnly}>{t("agents.version.coreHumanOnly")}</option><option value={AgentMemoryCoreWrite.AgentWithApproval}>{t("agents.version.coreApproval")}</option></select></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.coldWrite")}<select required value={coldWrite} onChange={(event) => setColdWrite(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
              <option value="">{t("agents.automation.select")}</option><option value={AgentMemoryColdWrite.Disabled}>{t("agents.version.coldDisabled")}</option><option value={AgentMemoryColdWrite.InvocationScoped}>{t("agents.version.coldInvocation")}</option></select></label>
            <fieldset className="flex flex-col gap-1 text-sm"><legend>{t("agents.version.triggers")}</legend>{Object.values(AgentTrigger).map((trigger) => <label className="flex gap-2" key={trigger}><input type="checkbox" checked={triggers.includes(trigger)} onChange={(event) => setTriggers((values) => event.target.checked ? [...values, trigger] : values.filter((value) => value !== trigger))} />{t(trigger === AgentTrigger.Mention ? "agents.installation.trigger.mention" : "agents.version.manualAssignment")}</label>)}</fieldset>
            <fieldset className="flex flex-col gap-1 text-sm"><legend>{t("agents.version.capabilities")}</legend>{contract?.capabilityRequirements.map((key) => <label className="flex gap-2" key={key}><input type="checkbox" checked={capabilities.includes(key)} onChange={(event) => setCapabilities((values) => event.target.checked ? [...values, key] : values.filter((value) => value !== key))} />{key}</label>)}</fieldset>
            <p className="text-sm text-muted-foreground">{t("agents.version.toolsUnavailable")}</p>
          </fieldset>
          <div className="flex gap-2">{index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
            {source.nextOffset != null ? <Button onClick={() => { setOffsets((values) => [...values.slice(0, index + 1), source.nextOffset!]); setIndex(index + 1); }}>{t("roles.next")}</Button> : null}</div>
          <div className="flex gap-2"><Button type="submit" disabled={requestBlocked || !valid}>{t("agents.review")}</Button><Button onClick={onReset}>{t("agents.cancel")}</Button></div>
        </form>}
    </> : null}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId }) : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown" ? t("agents.unknown", { operation: failure.operationId ?? submission?.operationId ?? "—" }) : t("roles.rejected", { reason: failureText(failure) })}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.refresh")}</Button></Notice>
      : pending.length > 0 ? <div role="status" className="flex flex-col gap-1 text-sm"><p>{t("agents.version.inFlight")}</p>{pending.map((task) => <p key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}<Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
  </section>;
}

function DefinitionAction({ edit, externalBlocked = false, onReset, onLocked, onRecorded }: {
  edit: { target: AgentDefinitionView; owner: boolean } | null;
  externalBlocked?: boolean;
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
  const requestBlocked = externalBlocked || !taskRows || pending.some((task) => edit
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
