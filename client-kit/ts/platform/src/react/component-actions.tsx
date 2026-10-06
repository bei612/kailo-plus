// DD-90: the platform's normal HUMAN session submits an original ActionCommand.
// Native pages keep their own session and database; this form never takes SQL,
// native credentials, a platform token, or a caller-selected workflow kind.
import {
  ActionDispatchState, ActionGateState, ReasonCode,
  type ActionCommand, type ActionSubmission, type ComponentActionInput,
} from "@client-kit/contracts";
import { useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "../governance";
import { TransportError, writeFailure, type WriteFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { Button } from "./ui";

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const text = (value: unknown): value is string => typeof value === "string" && value.trim() === value && value.length > 0;
const only = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value
  && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));

/** Parse only the generated command's reference fields; Core is the authority. */
export function componentActionDocument(source: string): Omit<ActionCommand, "idempotencyKey"> | null {
  try {
    const value: unknown = JSON.parse(source);
    if (!only(value, ["actionKey", "workspaceId", "resourceId", "resourceVersion", "assetId", "assetVersion", "componentAction"])
      || !text(value.actionKey) || (value.workspaceId !== undefined && !uuid(value.workspaceId))) return null;
    const input = value.componentAction;
    if (!only(input, ["actionVersion", "inputReference", "resultExposurePolicyId", "resultExposurePolicyVersion"])
      || !positive(input.actionVersion) || !uuid(input.resultExposurePolicyId) || !positive(input.resultExposurePolicyVersion)) return null;
    const reference = input.inputReference;
    if (!only(reference, ["resourceId", "assetId", "nativeObjectRef", "nativeRevision", "displayName", "mediaType"])
      || !uuid(reference.resourceId) || !text(reference.nativeObjectRef) || !text(reference.nativeRevision)
      || typeof reference.displayName !== "string" || !text(reference.mediaType)
      || (reference.assetId !== undefined && !uuid(reference.assetId))) return null;
    const resource = uuid(value.resourceId) && positive(value.resourceVersion)
      && value.assetId === undefined && value.assetVersion === undefined
      && reference.resourceId === value.resourceId && reference.assetId === undefined;
    const asset = uuid(value.assetId) && positive(value.assetVersion)
      && value.resourceId === undefined && value.resourceVersion === undefined && reference.assetId === value.assetId;
    if (!resource && !asset) return null;
    const componentAction: ComponentActionInput = {
      actionVersion: input.actionVersion, resultExposurePolicyId: input.resultExposurePolicyId,
      resultExposurePolicyVersion: input.resultExposurePolicyVersion,
      inputReference: { resourceId: reference.resourceId, nativeObjectRef: reference.nativeObjectRef,
        nativeRevision: reference.nativeRevision, displayName: reference.displayName, mediaType: reference.mediaType,
        ...(reference.assetId === undefined ? {} : { assetId: reference.assetId as string }) },
    };
    return { actionKey: value.actionKey, componentAction,
      ...(value.workspaceId === undefined ? {} : { workspaceId: value.workspaceId as string }),
      ...(resource ? { resourceId: value.resourceId as string, resourceVersion: value.resourceVersion as number }
        : { assetId: value.assetId as string, assetVersion: value.assetVersion as number }) };
  } catch { return null; }
}

function unknown(result: ActionSubmission) {
  return result.dispatchState === ActionDispatchState.Unknown || result.gateState === ActionGateState.Evaluating
    || (result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched);
}

export function ComponentActionsPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const [source, setSource] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [receipt, setReceipt] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const epoch = useRef(0);
  useEffect(() => {
    epoch.current++;
    sending.current = false;
    setSource(""); setInvalid(false); setIntent(null); setReceipt(null); setFailure(null); setBusy(false);
    return () => { epoch.current++; };
  }, [client]);
  const pending = failure?.kind === "unknown" || (!!receipt && unknown(receipt));
  const prepare = () => {
    if (sending.current || intent) return;
    const command = componentActionDocument(source);
    setInvalid(!command);
    if (command) { setReceipt(null); setFailure(null); setIntent({ ...command, idempotencyKey: newIdempotencyKey() }); }
  };
  const submit = async () => {
    if (!intent || sending.current) return;
    sending.current = true; setBusy(true);
    const current = epoch.current;
    try {
      const next = await client.submitAction(intent);
      if (current !== epoch.current) return;
      const priorOperation = receipt?.operationId ?? (failure?.kind === "unknown" ? failure.operationId : undefined);
      if (!next || next.actionKey !== intent.actionKey || !uuid(next.actionExecutionId) || !uuid(next.operationId)
        || !Object.values(ActionGateState).includes(next.gateState) || !Object.values(ActionDispatchState).includes(next.dispatchState)
        || (next.reason !== undefined && !Object.values(ReasonCode).includes(next.reason))
        || (next.gateState === ActionGateState.Denied && !next.reason)
        || (next.gateState === ActionGateState.Waiting && (!text(next.approvalWorkflowId) || next.dispatchState !== ActionDispatchState.NotDispatched))
        || (next.dispatchState === ActionDispatchState.Dispatched && (next.gateState !== ActionGateState.Allowed || !text(next.workflowId)))
        || (priorOperation !== undefined && next.operationId !== priorOperation)
        || (receipt && next.actionExecutionId !== receipt.actionExecutionId)) throw new TransportError(t("platform.loadFailed"));
      setReceipt(next); setFailure(null);
      if (!unknown(next)) setIntent(null);
    } catch (error) {
      if (current !== epoch.current) return;
      if (!pending) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") setIntent(null);
      }
    } finally { if (current === epoch.current) { sending.current = false; setBusy(false); } }
  };
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="component-actions">
    <h2 className="font-medium">{t("componentActions.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("componentActions.boundary")}</p>
    <label className="text-sm">{t("componentActions.document")}
      <textarea className="min-h-32 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
        disabled={!!intent || busy} value={source} onChange={(event) => { setSource(event.target.value); setInvalid(false); }} />
    </label>
    {invalid ? <p role="alert">{t("componentActions.invalid")}</p> : null}
    {!intent ? <Button className="w-fit" disabled={busy || !source.trim()} onClick={prepare}>{t("componentActions.prepare")}</Button> :
      <div role="group" aria-label={t("componentActions.review")} className="flex flex-col gap-2">
        <p className="text-sm">{t("componentActions.review")}</p>
        <p className="break-all font-mono text-xs">{intent.actionKey} · {intent.resourceId ?? intent.assetId}</p>
        <div className="flex gap-2">
          <Button disabled={busy} onClick={() => void submit()}>{t(busy ? "platform.loading" : pending ? "agents.retry" : "platform.confirm")}</Button>
          {!pending ? <Button disabled={busy} onClick={() => setIntent(null)}>{t("platform.cancel")}</Button> : null}
        </div>
      </div>}
    {receipt ? <div role="status" className="break-all text-sm">
      <p>{pending ? t("agents.unknown", { operation: receipt.operationId }) : t("bindings.recorded", { operation: receipt.operationId })}
        {receipt.reason ? ` · ${reasonText(receipt.reason)}` : ""}</p>
      {!pending ? <Button onClick={() => onOpen(receipt.actionExecutionId)}>{t("bindings.task")}</Button> : null}
    </div> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? receipt?.operationId ?? "—" }) : failureText(failure)}</p> : null}
  </section>;
}
