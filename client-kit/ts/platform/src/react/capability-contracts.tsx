// DD-102 / 05 §2.8: Catalog metadata, not a component host or a binding authority.
import {
  ActionDispatchState, ActionGateState, CapabilityContractStatus, ReasonCode,
  type ActionCommand, type ActionSubmission, type CapabilityContractPage,
  type CapabilityContractRegistration, type CapabilityContractView,
} from "@client-kit/contracts";
import { useRef, useState } from "react";
import { newIdempotencyKey } from "../governance";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { Badge, Button, Cell, Notice, ReadFailure, Table } from "./ui";
import { useLoad } from "./use-load";

const statusLabels = {
  [CapabilityContractStatus.Draft]: "capabilities.draft",
  [CapabilityContractStatus.Active]: "capabilities.active",
  [CapabilityContractStatus.Deprecated]: "capabilities.deprecated",
  [CapabilityContractStatus.Retired]: "capabilities.retired",
} as const;

function validPage(page: CapabilityContractPage, offset: number): boolean {
  return !!page && typeof page.canRegister === "boolean" && Array.isArray(page.contracts)
    && (page.nextOffset === undefined || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > offset))
    && new Set(page.contracts.map((row) => `${row?.categoryKey}@${row?.contractVersion}`)).size === page.contracts.length
    && page.contracts.every((row) => !!row && typeof row.categoryKey === "string" && !!row.categoryKey
      && Number.isSafeInteger(row.contractVersion) && row.contractVersion > 0
      && Object.values(CapabilityContractStatus).includes(row.status)
      && typeof row.registeredByActionExecutionId === "string" && !!row.registeredByActionExecutionId
      && [row.schemaSetDigest, row.conformanceSuiteDigest].every((digest) => typeof digest === "string" && /^[a-f0-9]{64}$/.test(digest))
      && typeof row.canApprove === "boolean" && typeof row.canDeprecate === "boolean"
      && (!row.canApprove || row.status === CapabilityContractStatus.Draft)
      && (!row.canDeprecate || row.status === CapabilityContractStatus.Active));
}

function registration(raw: string): CapabilityContractRegistration | null {
  try {
    // This is input feedback, not the schema/permission authority. The complete
    // frozen document still goes through Core's contract validation and Admission.
    const value: CapabilityContractRegistration = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)
      || typeof value.categoryKey !== "string" || !value.categoryKey.trim()
      || !Number.isSafeInteger(value.contractVersion) || value.contractVersion <= 0
      || !Array.isArray(value.resourceTypeFamily) || !value.resourceTypeFamily.length
      || !Array.isArray(value.operationContracts) || !value.operationContracts.length
      || !value.contentReferenceSemantics || typeof value.contentReferenceSemantics !== "object"
      || !Array.isArray(value.requiredDeclarations) || !Array.isArray(value.protocolSessionKinds)
      || !Array.isArray(value.schemaDocuments) || !value.schemaDocuments.length
      || !value.schemaDocuments.every((document) => typeof document === "string" && !!document.trim())
      || typeof value.testVectorsJson !== "string" || !value.testVectorsJson.trim()) return null;
    for (const document of [...value.schemaDocuments, value.testVectorsJson]) JSON.parse(document);
    return value;
  } catch { return null; }
}

export function CapabilityContractsPanel() {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`capability-contracts:${offset}`, () => client.capabilityContracts(offset));
  const page = state.status === "ok" && validPage(state.data, offset) ? state.data : null;
  const [document, setDocument] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  const frozen = !!intent || busy;
  const prepareRegistration = () => {
    if (frozen || !page?.canRegister) return;
    const value = registration(document);
    setInvalid(!value);
    if (!value) return;
    setSubmission(null); setFailure(null);
    setIntent({ actionKey: "capability_contract.register", idempotencyKey: newIdempotencyKey(),
      explicitConfirmation: true, capabilityContractRegistration: value });
  };
  const prepareTransition = (row: CapabilityContractView, approve: boolean) => {
    if (frozen || !page?.contracts.includes(row) || !(approve ? row.canApprove : row.canDeprecate)) return;
    setSubmission(null); setFailure(null); setInvalid(false);
    setIntent({ actionKey: approve ? "capability_contract.approve" : "capability_contract.deprecate",
      idempotencyKey: newIdempotencyKey(), capabilityContractRef: { categoryKey: row.categoryKey, contractVersion: row.contractVersion },
      ...(approve ? {} : { explicitConfirmation: true }) });
  };
  const submit = async () => {
    if (!intent || sending.current) return;
    sending.current = true; setBusy(true);
    try {
      const result = await client.submitAction(intent);
      if (!result || result.actionKey !== intent.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (result.gateState === ActionGateState.Denied && !result.reason)
        || (result.gateState === ActionGateState.Waiting
          && (intent.actionKey !== "capability_contract.approve" || typeof result.approvalWorkflowId !== "string" || !result.approvalWorkflowId))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))) {
        throw new TransportError(t("platform.loadFailed"));
      }
      setSubmission(result); setFailure(null);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null);
        if (intent.actionKey === "capability_contract.register" && result.dispatchState === ActionDispatchState.Dispatched) setDocument("");
      }
    } catch (error) {
      // A refusal of a later query cannot decide the first unknown side effect.
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") setIntent(null);
      }
    } finally { sending.current = false; setBusy(false); reload(); }
  };
  // An unavailable Catalog cannot produce a management entry. Preserve existing
  // receipts and UNKNOWN intents when later reads lose permission or fail.
  if (!intent && !submission && !failure && (state.status === "pending"
    || (state.status === "error" && state.error instanceof BffError && [403, 404].includes(state.error.status)))) return null;
  const target = intent?.capabilityContractRegistration ?? intent?.capabilityContractRef;
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="capability-contracts">
    <h2 className="font-medium">{t("capabilities.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("capabilities.boundary")}</p>
    {intent && target ? <div role="group" className="flex flex-col gap-2 text-sm">
      <p>{target.categoryKey} · {target.contractVersion}</p>
      <p>{t(intent.actionKey === "capability_contract.register" ? "capabilities.registerWarning"
        : intent.actionKey === "capability_contract.approve" ? "capabilities.approveWarning" : "capabilities.deprecateWarning")}</p>
      {intent.capabilityContractRegistration ? <pre className="overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(intent.capabilityContractRegistration, null, 2)}</pre> : null}
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void submit()}>{t(busy ? "platform.loading" : unknown ? "agents.retry" : "agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => setIntent(null)}>{t("platform.cancel")}</Button> : null}
      </div>
    </div> : null}
    {submission ? <p role="status" className="break-all text-sm">{unknown
      ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}
      {submission.approvalWorkflowId ? ` · ${submission.approvalWorkflowId}` : ""}
      {submission.reason ? ` · ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? submission?.operationId ?? "—" }) : failureText(failure)}</p> : null}
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {page.canRegister ? <div className="flex flex-col gap-2">
          <label className="text-sm">{t("capabilities.document")}
            <textarea className="min-h-32 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
              value={document} disabled={frozen} onChange={(event) => { setDocument(event.target.value); setInvalid(false); }} />
          </label>
          <p className="text-sm text-muted-foreground">{t("capabilities.documentHelp")}</p>
          {invalid ? <p role="alert">{t("capabilities.invalid")}</p> : null}
          <Button className="w-fit" disabled={frozen || !document.trim()} onClick={prepareRegistration}>{t("capabilities.register")}</Button>
        </div> : null}
        {!page.contracts.length ? <Notice>{t("capabilities.none")}</Notice> : <div className="overflow-x-auto">
          <Table head={[t("capabilities.key"), t("platform.state"), t("capabilities.schemaDigest"), t("capabilities.suiteDigest"), t("platform.action")]}>
            {page.contracts.map((row) => <tr key={`${row.categoryKey}@${row.contractVersion}`}>
              <Cell>{row.categoryKey} · {row.contractVersion}</Cell>
              <Cell><Badge tone="neutral">{t(statusLabels[row.status])}</Badge></Cell>
              <Cell mono>{row.schemaSetDigest}</Cell><Cell mono>{row.conformanceSuiteDigest}</Cell>
              <Cell>{row.canApprove ? <Button disabled={frozen} onClick={() => prepareTransition(row, true)}>{t("capabilities.approve")}</Button> : null}
                {row.canDeprecate ? <Button disabled={frozen} onClick={() => prepareTransition(row, false)}>{t("capabilities.deprecate")}</Button> : null}</Cell>
            </tr>)}
          </Table>
        </div>}
        <div className="flex gap-2">
          {index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
          {page.nextOffset !== undefined ? <Button onClick={() => { setOffsets((old) => [...old.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1); }}>{t("roles.next")}</Button> : null}
        </div>
      </>}
  </section>;
}
