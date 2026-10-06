import { useEffect, useRef, useState } from "react";
import { ActionDispatchState, ActionGateState, ReasonCode, Theme, Locale,
  type ActionCommand, type ActionSubmission, type ProtocolSessionOpenInput } from "@client-kit/contracts";
import { newIdempotencyKey } from "../governance";
import { TransportError, writeFailure, type WriteFailure } from "../transport";
import { useBffClient, useDocumentTheme, useFailureText, useLocale, useReasonText, useT } from "./context";
import { ProtocolDocumentSurface } from "./protocol-document-surface";
import { Button, Notice } from "./ui";

const uuid = (value: unknown): value is string => typeof value === "string"
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

/** Only a typed ContentReference producer supplies this selection, never an editable JSON form. */
export function ProtocolDocumentAction({ bindingId, projectionGeneration, command, selection, onBack }: {
  bindingId: string;
  projectionGeneration: number;
  command: Pick<ActionCommand, "actionKey" | "workspaceId" | "resourceId" | "resourceVersion" | "assetId" | "assetVersion">;
  selection: Pick<ProtocolSessionOpenInput, "reference" | "actionVersion">;
  onBack: () => void;
}) {
  const client = useBffClient();
  const theme = useDocumentTheme();
  const locale = useLocale();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const [intent, setIntent] = useState<ActionCommand>();
  const [receipt, setReceipt] = useState<ActionSubmission>();
  const [failure, setFailure] = useState<WriteFailure>();
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, [client]);
  const unknown = failure?.kind === "unknown" || receipt?.dispatchState === ActionDispatchState.Unknown;
  const submit = async () => {
    if (!theme || sending.current) return;
    const frozen: ActionCommand = intent ?? { ...command, idempotencyKey: newIdempotencyKey(),
      protocolSessionOpen: { ...selection, reference: { ...selection.reference },
        applicationBindingId: bindingId, projectionGeneration,
        theme: theme === "DARK" ? Theme.Dark : Theme.Light, locale: locale === "zh-CN" ? Locale.ZhCN : Locale.En } };
    if (!["file_storage.open_view@v1", "file_storage.open_edit@v1"].includes(frozen.actionKey)) return;
    sending.current = true; setBusy(true); setIntent(frozen);
    const current = generation.current;
    try {
      const result = await client.submitAction(frozen);
      if (current !== generation.current) return;
      const operation = receipt?.operationId ?? (failure?.kind === "unknown" ? failure.operationId : undefined);
      if (!result || result.actionKey !== frozen.actionKey || !uuid(result.operationId)
        || !uuid(result.actionExecutionId)
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (operation !== undefined && operation !== result.operationId)
        || (receipt !== undefined && receipt.actionExecutionId !== result.actionExecutionId)
        || (result.protocolSessionId !== undefined && result.protocolSessionId !== result.actionExecutionId)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (result.gateState === ActionGateState.Denied && result.reason === undefined)
        || (result.gateState === ActionGateState.Waiting && (typeof result.approvalWorkflowId !== "string"
          || !result.approvalWorkflowId || result.dispatchState !== ActionDispatchState.NotDispatched))
        || (result.documentLaunch !== undefined && (result.protocolSessionId === undefined
          || result.gateState !== ActionGateState.Allowed || result.dispatchState !== ActionDispatchState.Dispatched))) {
        throw new TransportError(t("platform.loadFailed"));
      }
      setReceipt(result); setFailure(undefined);
    } catch (error) {
      if (current !== generation.current) return;
      // A later failed lookup cannot turn the earlier unknown operation into a refusal.
      if (!unknown) setFailure(writeFailure(error));
    } finally {
      if (current === generation.current) { sending.current = false; setBusy(false); }
    }
  };
  if (!theme) return <Notice>{t("document.unsupportedHost")}</Notice>;
  if (receipt?.protocolSessionId && intent?.protocolSessionOpen) return <ProtocolDocumentSurface
    bindingId={intent.protocolSessionOpen.applicationBindingId}
    sessionId={receipt.protocolSessionId} actionExecutionId={receipt.actionExecutionId}
    reference={intent.protocolSessionOpen.reference} launch={receipt.documentLaunch} onBack={onBack} />;
  const reference = intent?.protocolSessionOpen?.reference ?? selection.reference;
  return <section className="flex flex-col gap-3">
    <Button className="w-fit" onClick={onBack}>{t("platform.back")}</Button>
    <h2 className="text-base font-medium">{reference.displayName}</h2>
    <p className="text-sm font-medium">{t((intent?.actionKey ?? command.actionKey) === "file_storage.open_edit@v1" ? "document.mode.edit" : "document.mode.view")}</p>
    <p className="text-sm text-muted-foreground">{t("document.fixedRevision", { revision: reference.nativeRevision })}</p>
    <p className="text-sm text-muted-foreground">{t("document.admissionBoundary")}</p>
    <Button className="w-fit" disabled={busy || failure?.kind === "rejected"
      || (receipt !== undefined && new Set<ActionGateState>([ActionGateState.Denied, ActionGateState.Revoked, ActionGateState.Expired]).has(receipt.gateState))}
      onClick={() => void submit()}>{t(busy ? "platform.loading" : intent ? "document.reconcile" : "platform.confirm")}</Button>
    {receipt ? <p role="status" className="break-all text-sm">{t(unknown ? "agents.unknown" : "bindings.recorded", { operation: receipt.operationId })}
      {receipt.reason ? ` · ${reasonText(receipt.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? receipt?.operationId ?? "—" }) : failureText(failure)}</p> : null}
  </section>;
}
