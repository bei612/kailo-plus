import {
  ActionDispatchState, ActionGateState, AgentInstallationState, AgentPrincipalState, ApplicationReadResourceDirection,
  ReasonCode, ResourceGrantPermission, ResourceState,
  type ActionCommand, type ActionSubmission, type AgentInstallationView, type ApplicationBindingView,
  type ApplicationReadResource, type ApplicationReadResourcePage,
} from "@client-kit/contracts";
import { useEffect, useRef, useState } from "react";
import type { BffClient } from "../client";
import { newIdempotencyKey } from "../governance";
import type { PlatformMessageKey } from "../i18n";
import { loadWorkspaceAgents } from "./agent-installation-view";
import { TransportError, writeFailure, type WriteFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { TaskDetail } from "./governance";
import { Button, Notice, ReadFailure } from "./ui";
import { useLoad } from "./use-load";

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
type Selection = { owner: BffClient; resource: ApplicationReadResource; page: ApplicationReadResourcePage };
type AgentSelection = { owner: BffClient; installation: AgentInstallationView };
type ReceiverKind = "service" | "agent";

/**
 * DD-122 (6), V-SCN-112: an AGENT receiver of resource.grant_read/revoke_read takes the permission
 * its tool contract needs; HUMAN and SERVICE receivers stay read-only (the command omits it).
 */
const grantPermissionLabels = {
  [ResourceGrantPermission.Read]: "bindings.read.permission.read",
  [ResourceGrantPermission.Discover]: "bindings.read.permission.discover",
  [ResourceGrantPermission.Consume]: "bindings.read.permission.consume",
  [ResourceGrantPermission.Execute]: "bindings.read.permission.execute",
} as const satisfies Record<ResourceGrantPermission, PlatformMessageKey>;
const grantPermissions = [ResourceGrantPermission.Read, ResourceGrantPermission.Discover,
  ResourceGrantPermission.Consume, ResourceGrantPermission.Execute] as const;
const agentName = (row: AgentInstallationView) => row.agentDisplayName?.trim() || row.resourceId;

export function validReadResourcePage(page: ApplicationReadResourcePage, binding: ApplicationBindingView,
  direction: ApplicationReadResourceDirection, offset: number): boolean {
  return !!page && page.bindingId === binding.bindingId && page.bindingVersion === binding.version
    && page.tenantId === binding.tenantId && page.workspaceId === binding.workspaceId
    && page.direction === direction && text(page.servicePrincipalId) && Array.isArray(page.resources)
    && (page.nextOffset === undefined || positive(page.nextOffset) && page.nextOffset > offset)
    && new Set(page.resources.map(row => row?.resourceId)).size === page.resources.length
    && page.resources.every(row => row && [row.resourceId,row.bindingId,row.typeKey,row.nativeRef].every(text)
      && positive(row.version) && (direction !== ApplicationReadResourceDirection.Receiver || row.bindingId === binding.bindingId)
      && (direction !== ApplicationReadResourceDirection.Source || binding.workspaceId === undefined
        || row.workspaceId === undefined || row.workspaceId === binding.workspaceId));
}

function ResourcePicker({ binding, direction, locked, revision, onSelected }: {
  binding: ApplicationBindingView; direction: ApplicationReadResourceDirection; locked: boolean;
  revision: number; onSelected: (value: Selection | null) => void;
}) {
  const client = useBffClient(); const t = useT();
  const [offsets, setOffsets] = useState([0]); const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`service-resources:${binding.bindingId}:${binding.version}:${direction}:${offset}:${revision}`,
    async () => ({ owner: client, page: await client.applicationReadResources(binding.bindingId, direction, offset) }));
  useEffect(() => { reload(); }, [client,reload]);
  const page = state.status === "ok" && state.data.owner === client
    && validReadResourcePage(state.data.page,binding,direction,offset) ? state.data.page : null;
  useEffect(() => { setSelected(""); onSelected(null); }, [client,binding.bindingId,binding.version,direction,offset,revision,onSelected]);
  const label = direction === ApplicationReadResourceDirection.Source ? "bindings.read.source" : "bindings.read.receiver";
  return <div className="flex min-w-0 flex-col gap-2">
    <label className="text-sm">{t(label)}
      <select className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1" value={selected}
        disabled={locked || !page} onChange={event => {
          const row = page?.resources.find(row => row.resourceId === event.target.value);
          setSelected(row?.resourceId ?? ""); onSelected(row && page ? {owner:client,resource:row,page} : null);
        }}>
        <option value="">{t("bindings.read.choose")}</option>
        {page?.resources.map(row => <option key={row.resourceId} value={row.resourceId}>{row.nativeRef} · {row.typeKey}</option>)}
      </select>
    </label>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={() => { setSelected(""); onSelected(null); reload(); }} />
      : page.resources.length === 0 ? <Notice>{t("bindings.read.none")}</Notice> : null}
    <div className="flex gap-2">
      {index > 0 ? <Button disabled={locked} onClick={() => setIndex(index-1)}>{t("roles.previous")}</Button> : null}
      {page?.nextOffset !== undefined ? <Button disabled={locked} onClick={() => {
        setOffsets(old => [...old.slice(0,index+1),page.nextOffset!]); setIndex(index+1);
      }}>{t("roles.next")}</Button> : null}
    </div>
  </div>;
}

/** Same-Tenant Workspace Agents (their Installation's AgentPrincipal) as grant receivers. */
function AgentReceiverPicker({ binding, locked, revision, onSelected }: {
  binding: ApplicationBindingView; locked: boolean; revision: number; onSelected: (value: AgentSelection | null) => void;
}) {
  const client = useBffClient(); const t = useT();
  const fixed = binding.workspaceId;
  const [chosen, setChosen] = useState("");
  const [selected, setSelected] = useState("");
  const [directory, reloadDirectory] = useLoad(`agent-receiver-workspaces:${binding.bindingId}:${fixed ?? ""}:${revision}`,
    async () => ({ owner: client, rows: fixed ? null : await client.workspaces() }));
  const rows = directory.status === "ok" && directory.data.owner === client ? directory.data.rows : null;
  const workspaces = rows && Array.isArray(rows) && rows.every(row => row && text(row.id) && typeof row.name === "string")
    && new Set(rows.map(row => row.id)).size === rows.length ? rows : null;
  const workspaceId = fixed ?? (workspaces?.some(row => row.id === chosen) ? chosen : "");
  const [state, reload] = useLoad(`agent-receivers:${binding.bindingId}:${workspaceId}:${revision}`,
    async () => ({ owner: client, rows: workspaceId ? await loadWorkspaceAgents(client, workspaceId) : null }));
  useEffect(() => { reload(); reloadDirectory(); }, [client,reload,reloadDirectory]);
  const agents = state.status === "ok" && state.data.owner === client && state.data.rows
    ? state.data.rows.filter(row => row.state === AgentInstallationState.Active && row.resourceState === ResourceState.Active
      && row.agentPrincipalState === AgentPrincipalState.Active) : null;
  useEffect(() => { setSelected(""); onSelected(null); }, [client,binding.bindingId,workspaceId,revision,onSelected]);
  return <div className="flex min-w-0 flex-col gap-2">
    {fixed ? null : <>
      <label className="text-sm">{t("platform.workspace")}
        <select className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1" value={workspaceId}
          disabled={locked || !workspaces} onChange={event => setChosen(event.target.value)}>
          <option value="">{t("bindings.read.chooseWorkspace")}</option>
          {workspaces?.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      </label>
      {workspaces ? null : directory.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : <ReadFailure error={directory.status === "error" ? directory.error : undefined} onRetry={reloadDirectory} />}
    </>}
    <label className="text-sm">{t("bindings.read.agent")}
      <select className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1" value={selected}
        disabled={locked || !agents} onChange={event => {
          const row = agents?.find(item => item.resourceId === event.target.value);
          setSelected(row?.resourceId ?? ""); onSelected(row ? {owner:client,installation:row} : null);
        }}>
        <option value="">{t("bindings.read.chooseAgent")}</option>
        {agents?.map(row => <option key={row.resourceId} value={row.resourceId}>{agentName(row)}</option>)}
      </select>
    </label>
    {!workspaceId ? null : state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !agents ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={() => { setSelected(""); onSelected(null); reload(); }} />
      : agents.length === 0 ? <Notice>{t("bindings.read.noAgents")}</Notice> : null}
  </div>;
}

/** Actual caller is the existing shared bindings management panel, not a second permission page. */
export function ServiceReadPermissions({binding,onLocked,onBack}: {
  binding: ApplicationBindingView; onLocked:(value:boolean)=>void; onBack:()=>void;
}) {
  const client = useBffClient(); const t = useT(); const reasonText = useReasonText(); const failureText = useFailureText();
  const [source,setSource] = useState<Selection|null>(null); const [receiver,setReceiver] = useState<Selection|null>(null);
  const [receiverKind,setReceiverKind] = useState<ReceiverKind>("service"); const [agent,setAgent] = useState<AgentSelection|null>(null);
  const [permission,setPermission] = useState<ResourceGrantPermission>(ResourceGrantPermission.Read);
  const [intent,setIntent] = useState<ActionCommand|null>(null); const [receipt,setReceipt] = useState<ActionSubmission|null>(null);
  const [failure,setFailure] = useState<WriteFailure|null>(null); const [busy,setBusy] = useState(false);
  const [revision,setRevision] = useState(0); const [task,setTask] = useState<string|null>(null);
  const sending = useRef(false); const epoch = useRef(0);
  const currentClient = useRef(client); currentClient.current = client;
  const intentClient = useRef<BffClient|null>(null);
  useEffect(() => {
    epoch.current++; intentClient.current=null; sending.current=false; setSource(null); setReceiver(null); setIntent(null); setReceipt(null); setFailure(null); setBusy(false); setTask(null); onLocked(false);
    setReceiverKind("service"); setAgent(null); setPermission(ResourceGrantPermission.Read);
    return () => { epoch.current++; };
  }, [client,binding.bindingId,onLocked]);
  const unknown = failure?.kind === "unknown" || receipt?.dispatchState === ActionDispatchState.Unknown
    || receipt?.gateState === ActionGateState.Evaluating
    || receipt?.gateState === ActionGateState.Allowed && receipt.dispatchState === ActionDispatchState.NotDispatched;
  const locked = !!intent || busy;
  const toAgent = receiverKind === "agent";
  const compatible = !!source && source.owner === client && (toAgent ? !!agent && agent.owner === client
    : !!receiver && receiver.owner === client
      && source.page.servicePrincipalId === receiver.page.servicePrincipalId
      && source.page.bindingVersion === receiver.page.bindingVersion);
  const prepare = (grant: boolean) => {
    if (locked || sending.current || !source || !compatible) return;
    const target = {actionKey:grant?"resource.grant_read":"resource.revoke_read",idempotencyKey:newIdempotencyKey(),
      resourceId:source.resource.resourceId,resourceVersion:source.resource.version};
    // An AGENT receiver is its Installation's AgentPrincipal; Core rechecks the same-Tenant Agent and permission.
    const command: ActionCommand|null = toAgent
      ? agent ? {...target,principalId:agent.installation.agentPrincipalId,grantPermission:permission} : null
      : receiver ? {...target,principalId:receiver.page.servicePrincipalId,
        receiverResource:{id:receiver.resource.resourceId,version:receiver.resource.version}} : null;
    if (!command) return;
    intentClient.current=client;
    setReceipt(null); setFailure(null); onLocked(true);
    setIntent({...command,...(grant?{}:{explicitConfirmation:true})});
  };
  const submit = async () => {
    if (!intent || sending.current || intentClient.current !== client) return;
    const captured = epoch.current; sending.current=true; setBusy(true);
    try {
      const next = await client.submitAction(intent);
      if (epoch.current !== captured || currentClient.current !== client) return;
      const operation = receipt?.operationId ?? (failure?.kind === "unknown" ? failure.operationId : undefined);
      if (!next || next.actionKey !== intent.actionKey || !text(next.actionExecutionId) || !text(next.operationId)
        || !Object.values(ActionGateState).includes(next.gateState) || !Object.values(ActionDispatchState).includes(next.dispatchState)
        || next.reason !== undefined && !Object.values(ReasonCode).includes(next.reason)
        || next.gateState === ActionGateState.Denied && !next.reason
        || next.gateState === ActionGateState.Waiting && (!text(next.approvalWorkflowId) || next.dispatchState !== ActionDispatchState.NotDispatched)
        || next.dispatchState === ActionDispatchState.Dispatched && next.gateState !== ActionGateState.Allowed
        || operation !== undefined && next.operationId !== operation
        || receipt && next.actionExecutionId !== receipt.actionExecutionId) throw new TransportError(t("platform.loadFailed"));
      setReceipt(next); setFailure(null);
      if (next.dispatchState !== ActionDispatchState.Unknown && next.gateState !== ActionGateState.Evaluating
        && !(next.gateState === ActionGateState.Allowed && next.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); setRevision(value=>value+1);
      }
    } catch(error) {
      if (epoch.current === captured && currentClient.current === client && !unknown) {
        const next = writeFailure(error); setFailure(next);
        if (next.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally { if (epoch.current === captured) { sending.current=false; setBusy(false); } }
  };
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="service-read-permissions">
    {task ? <TaskDetail actionExecutionId={task} onBack={()=>setTask(null)} onOpen={setTask}/> : null}
    <div hidden={!!task}>
      <h3 className="text-sm font-medium">{t("bindings.read.title")}</h3>
      <p className="mb-3 text-sm text-muted-foreground">{t(toAgent?"bindings.read.agentBoundary":"bindings.read.boundary")}</p>
      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3">
        <label className="text-sm">{t("bindings.read.receiverKind")}
          <select className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1" value={receiverKind} disabled={locked}
            onChange={event => { setReceiverKind(event.target.value === "agent" ? "agent" : "service"); setReceiver(null); setAgent(null); }}>
            <option value="service">{t("bindings.read.receiverKind.service")}</option>
            <option value="agent">{t("bindings.read.receiverKind.agent")}</option>
          </select>
        </label>
        {toAgent ? <AgentReceiverPicker binding={binding} locked={locked} revision={revision} onSelected={setAgent}/>
          : <ResourcePicker binding={binding} direction={ApplicationReadResourceDirection.Receiver} locked={locked} revision={revision} onSelected={setReceiver}/>}
        {toAgent ? <label className="text-sm">{t("bindings.read.permission")}
          <select className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1" value={permission} disabled={locked}
            onChange={event => setPermission(grantPermissions.find(value => value === event.target.value) ?? ResourceGrantPermission.Read)}>
            {grantPermissions.map(value => <option key={value} value={value}>{t(grantPermissionLabels[value])}</option>)}
          </select>
        </label> : null}
        <ResourcePicker binding={binding} direction={ApplicationReadResourceDirection.Source} locked={locked} revision={revision} onSelected={setSource}/>
      </fieldset>
      {intent ? <div role="group" aria-label={t("bindings.review")} className="my-3 flex flex-col gap-2">
        <p className="text-sm">{t(intent.actionKey==="resource.grant_read"?"bindings.read.approval"
          :intent.grantPermission?"bindings.read.agentRevokeWarning":"bindings.read.revokeWarning")}</p>
        <p className="break-all text-sm">{source?.resource.nativeRef} → {intent.grantPermission
          ? `${agent ? agentName(agent.installation) : intent.principalId} · ${t(grantPermissionLabels[intent.grantPermission])}`
          : receiver?.resource.nativeRef}</p>
        <div className="flex gap-2"><Button disabled={busy} onClick={()=>void submit()}>{t(busy?"platform.loading":unknown?"agents.retry":"platform.confirm")}</Button>
          {!unknown ? <Button disabled={busy} onClick={()=>{setIntent(null);onLocked(false);}}>{t("platform.cancel")}</Button> : null}</div>
      </div> : <div className="my-3 flex gap-2">
        <Button disabled={busy||!compatible} onClick={()=>prepare(true)}>{t(toAgent?"bindings.read.agentGrant":"bindings.read.grant")}</Button>
        <Button disabled={busy||!compatible} onClick={()=>prepare(false)}>{t(toAgent?"bindings.read.agentRevoke":"bindings.read.revoke")}</Button>
      </div>}
      {!locked && !toAgent && source && receiver && !compatible ? <ReadFailure error={undefined} onRetry={()=>setRevision(value=>value+1)}/> : null}
      {receipt ? <div role="status" className="break-all text-sm">
        <p>{unknown?t("agents.unknown",{operation:receipt.operationId}):t("bindings.recorded",{operation:receipt.operationId})}
          {receipt.reason?` · ${reasonText(receipt.reason)}`:""}</p>
        <Button onClick={()=>setTask(receipt.actionExecutionId)}>{t("bindings.task")}</Button>
      </div> : null}
      {failure ? <p role={failure.kind==="unknown"?"status":"alert"}>{failure.kind==="unknown"
        ? t("agents.unknown",{operation:failure.operationId??receipt?.operationId??"—"}):failureText(failure)}</p> : null}
      <div className="mt-3 flex gap-2"><Button disabled={locked} onClick={()=>setRevision(value=>value+1)}>{t("platform.refresh")}</Button>
        <Button disabled={locked} onClick={onBack}>{t("platform.back")}</Button></div>
    </div>
  </section>;
}
