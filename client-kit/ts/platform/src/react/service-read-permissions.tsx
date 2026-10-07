import {
  ActionDispatchState, ActionGateState, ApplicationReadResourceDirection, ReasonCode,
  type ActionCommand, type ActionSubmission, type ApplicationBindingView,
  type ApplicationReadResource, type ApplicationReadResourcePage,
} from "@client-kit/contracts";
import { useEffect, useRef, useState } from "react";
import type { BffClient } from "../client";
import { newIdempotencyKey } from "../governance";
import { TransportError, writeFailure, type WriteFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { TaskDetail } from "./governance";
import { Button, Notice, ReadFailure } from "./ui";
import { useLoad } from "./use-load";

const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
type Selection = { owner: BffClient; resource: ApplicationReadResource; page: ApplicationReadResourcePage };

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

/** Actual caller is the existing shared bindings management panel, not a second permission page. */
export function ServiceReadPermissions({binding,onLocked,onBack}: {
  binding: ApplicationBindingView; onLocked:(value:boolean)=>void; onBack:()=>void;
}) {
  const client = useBffClient(); const t = useT(); const reasonText = useReasonText(); const failureText = useFailureText();
  const [source,setSource] = useState<Selection|null>(null); const [receiver,setReceiver] = useState<Selection|null>(null);
  const [intent,setIntent] = useState<ActionCommand|null>(null); const [receipt,setReceipt] = useState<ActionSubmission|null>(null);
  const [failure,setFailure] = useState<WriteFailure|null>(null); const [busy,setBusy] = useState(false);
  const [revision,setRevision] = useState(0); const [task,setTask] = useState<string|null>(null);
  const sending = useRef(false); const epoch = useRef(0);
  const currentClient = useRef(client); currentClient.current = client;
  const intentClient = useRef<BffClient|null>(null);
  useEffect(() => {
    epoch.current++; intentClient.current=null; sending.current=false; setSource(null); setReceiver(null); setIntent(null); setReceipt(null); setFailure(null); setBusy(false); setTask(null); onLocked(false);
    return () => { epoch.current++; };
  }, [client,binding.bindingId,onLocked]);
  const unknown = failure?.kind === "unknown" || receipt?.dispatchState === ActionDispatchState.Unknown
    || receipt?.gateState === ActionGateState.Evaluating
    || receipt?.gateState === ActionGateState.Allowed && receipt.dispatchState === ActionDispatchState.NotDispatched;
  const locked = !!intent || busy;
  const compatible = !!source && !!receiver && source.owner === client && receiver.owner === client
    && source.page.servicePrincipalId === receiver.page.servicePrincipalId
    && source.page.bindingVersion === receiver.page.bindingVersion;
  const prepare = (grant: boolean) => {
    if (locked || sending.current || !source || !receiver || !compatible) return;
    intentClient.current=client;
    setReceipt(null); setFailure(null); onLocked(true);
    setIntent({actionKey:grant?"resource.grant_read":"resource.revoke_read",idempotencyKey:newIdempotencyKey(),
      resourceId:source.resource.resourceId,resourceVersion:source.resource.version,
      principalId:receiver.page.servicePrincipalId,
      receiverResource:{id:receiver.resource.resourceId,version:receiver.resource.version},
      ...(grant?{}:{explicitConfirmation:true})});
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
      <p className="mb-3 text-sm text-muted-foreground">{t("bindings.read.boundary")}</p>
      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-3">
        <ResourcePicker binding={binding} direction={ApplicationReadResourceDirection.Receiver} locked={locked} revision={revision} onSelected={setReceiver}/>
        <ResourcePicker binding={binding} direction={ApplicationReadResourceDirection.Source} locked={locked} revision={revision} onSelected={setSource}/>
      </fieldset>
      {intent ? <div role="group" aria-label={t("bindings.review")} className="my-3 flex flex-col gap-2">
        <p className="text-sm">{t(intent.actionKey==="resource.grant_read"?"bindings.read.approval":"bindings.read.revokeWarning")}</p>
        <p className="break-all text-sm">{source?.resource.nativeRef} → {receiver?.resource.nativeRef}</p>
        <div className="flex gap-2"><Button disabled={busy} onClick={()=>void submit()}>{t(busy?"platform.loading":unknown?"agents.retry":"platform.confirm")}</Button>
          {!unknown ? <Button disabled={busy} onClick={()=>{setIntent(null);onLocked(false);}}>{t("platform.cancel")}</Button> : null}</div>
      </div> : <div className="my-3 flex gap-2">
        <Button disabled={busy||!compatible} onClick={()=>prepare(true)}>{t("bindings.read.grant")}</Button>
        <Button disabled={busy||!compatible} onClick={()=>prepare(false)}>{t("bindings.read.revoke")}</Button>
      </div>}
      {!locked && source && receiver && !compatible ? <ReadFailure error={undefined} onRetry={()=>setRevision(value=>value+1)}/> : null}
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
