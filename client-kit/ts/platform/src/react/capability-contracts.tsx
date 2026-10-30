// DD-102 / 05 §2.8: Catalog metadata, not a component host or a binding authority.
// DD-170 (.design/20 §16): a contract table with total and paging, technical digests behind
// the row's detail, registration in a form card, and every governed transition confirmed in a
// dialog; an UNKNOWN outcome keeps the exact command until it is re-checked.
import {
  ActionDispatchState, ActionGateState, CapabilityContractStatus, ReasonCode,
  type ActionCommand, type ActionSubmission, type CapabilityContractPage,
  type CapabilityContractRegistration, type CapabilityContractView,
} from "@client-kit/contracts";
import { useRef, useState } from "react";
import { newIdempotencyKey } from "../governance";
import type { BffClient } from "../client";
import { TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { Badge, Button, type Tone } from "./ui";
import { useLoad } from "./use-load";
import { CellStack, DataTable, type DataColumn } from "./data-table";
import { EmptyState, ErrorState, PermissionState, readRefusal, TableSkeleton } from "./state-views";
import { IdText, KeyValueList, RawData, Tag } from "./key-value";
import { ConfirmDialog } from "./confirm-dialog";
import { PageSection, RefreshButton } from "./page-layout";
import { OutcomeNotice, PRIMARY_ACTION_CLASS, RowActionsMenu, UnknownInDialog } from "./roles";

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
      && ((typeof row.registeredByActionExecutionId === "string" && !!row.registeredByActionExecutionId && row.bootstrapActionExecutionId === undefined)
        || (typeof row.bootstrapActionExecutionId === "string" && !!row.bootstrapActionExecutionId && row.registeredByActionExecutionId === undefined && row.status !== CapabilityContractStatus.Draft))
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

type Directory = { contracts: CapabilityContractView[]; canRegister: boolean; complete: boolean };
const contractKey = (row: { categoryKey: string; contractVersion: number }) => `${row.categoryKey}@${row.contractVersion}`;

/** DD-170 §16.2(3): the offset-paged Catalog is read to its end, bounded per round. */
async function loadContracts(client: BffClient, pages: number): Promise<Directory> {
  const contracts: CapabilityContractView[] = [];
  const seen = new Set<string>();
  let canRegister = false;
  let offset = 0;
  for (let index = 0; index < pages; index++) {
    const page = await client.capabilityContracts(offset);
    if (!validPage(page, offset)) throw new TransportError("Invalid capability contract page");
    if (index === 0) canRegister = page.canRegister;
    for (const row of page.contracts) {
      if (seen.has(contractKey(row))) throw new TransportError("Repeated capability contract");
      seen.add(contractKey(row)); contracts.push(row);
    }
    if (page.nextOffset === undefined) return { contracts, canRegister, complete: true };
    offset = page.nextOffset;
  }
  return { contracts, canRegister, complete: false };
}

const statusTone: Record<CapabilityContractStatus, Tone> = {
  [CapabilityContractStatus.Draft]: "info",
  [CapabilityContractStatus.Active]: "positive",
  [CapabilityContractStatus.Deprecated]: "warning",
  [CapabilityContractStatus.Retired]: "neutral",
};

export function CapabilityContractsPanel() {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const [budget, setBudget] = useState(10);
  const [state, reload] = useLoad(`capability-contracts:${budget}`, () => loadContracts(client, budget), { keepWhileRevalidating: true });
  const page = state.status === "ok" ? state.data : null;
  const [document, setDocument] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [dialog, setDialog] = useState(false);
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
    setDialog(true);
  };
  const prepareTransition = (row: CapabilityContractView, approve: boolean) => {
    if (frozen || !page?.contracts.includes(row) || !(approve ? row.canApprove : row.canDeprecate)) return;
    setSubmission(null); setFailure(null); setInvalid(false);
    setIntent({ actionKey: approve ? "capability_contract.approve" : "capability_contract.deprecate",
      idempotencyKey: newIdempotencyKey(), capabilityContractRef: { categoryKey: row.categoryKey, contractVersion: row.contractVersion },
      ...(approve ? {} : { explicitConfirmation: true }) });
    setDialog(true);
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
        setIntent(null); setDialog(false);
        if (intent.actionKey === "capability_contract.register" && result.dispatchState === ActionDispatchState.Dispatched) setDocument("");
      }
    } catch (error) {
      // A refusal of a later query cannot decide the first unknown side effect.
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); setDialog(false); }
      }
    } finally { sending.current = false; setBusy(false); reload(); }
  };
  // An unavailable Catalog cannot produce a management entry: it states why. Preserve existing
  // receipts and UNKNOWN intents when later reads lose permission or fail.
  if (!intent && !submission && !failure && state.status === "error") {
    const refusal = readRefusal(state.error);
    if (refusal === "denied") return <PermissionState description={t("adminArea.capabilities.deniedBody")} />;
    if (refusal === "missing") return <EmptyState title={t("adminArea.unavailableTitle")} description={t("adminArea.unavailableBody")} />;
  }
  const target = intent?.capabilityContractRegistration ?? intent?.capabilityContractRef;
  const kind = intent?.actionKey === "capability_contract.register" ? "register"
    : intent?.actionKey === "capability_contract.approve" ? "approve" : "deprecate";
  const names = { category: target?.categoryKey ?? "", version: target ? t("adminArea.capabilities.versionValue", { version: String(target.contractVersion) }) : "" };
  const version = (row: CapabilityContractView) => t("adminArea.capabilities.versionValue", { version: String(row.contractVersion) });
  const columns: DataColumn<CapabilityContractView>[] = [
    { key: "category", header: t("adminArea.capabilities.category"), truncate: true, title: (row) => row.categoryKey,
      sortValue: (row) => row.categoryKey, cell: (row) => <CellStack primary={row.categoryKey} /> },
    { key: "version", header: t("adminArea.capabilities.version"), width: "6rem", align: "end", sortValue: (row) => row.contractVersion,
      cell: (row) => version(row) },
    { key: "status", header: t("platform.state"), width: "9rem", sortValue: (row) => t(statusLabels[row.status]),
      cell: (row) => <Badge tone={statusTone[row.status]}>{t(statusLabels[row.status])}</Badge> },
    { key: "source", header: t("adminArea.capabilities.source"), width: "7rem", secondary: true,
      cell: (row) => <Tag>{t(row.bootstrapActionExecutionId ? "adminArea.capabilities.source.seed" : "adminArea.capabilities.source.registered")}</Tag> },
  ];
  const open = openKey ? page?.contracts.find((row) => contractKey(row) === openKey) : undefined;
  const receiptText = submission ? unknown ? t("agents.unknown", { operation: submission.operationId })
    : submission.gateState === ActionGateState.Waiting ? t("adminArea.capabilities.waiting") : t("adminArea.capabilities.recorded") : null;

  return <PageSection id="admin-capabilities" title={t("capabilities.title")} description={t("adminArea.capabilities.description")} testId="capability-contracts"
    actions={page?.canRegister || intent?.capabilityContractRegistration ? <Button className={registering ? undefined : PRIMARY_ACTION_CLASS}
      disabled={frozen} aria-expanded={registering} onClick={() => setRegistering(!registering)}>
      {registering ? t("platform.cancel") : t("adminArea.capabilities.registerOpen")}</Button> : undefined}>
    {submission ? <OutcomeNotice tone={unknown ? "alert" : "status"}
      action={unknown && intent ? <Button disabled={busy} onClick={() => void submit()}>{t("agents.retry")}</Button> : undefined}>
      <span>{receiptText}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</span>
      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">{t("adminArea.operation")}<IdText value={submission.operationId} label={t("adminArea.operation")} /></span>
        {submission.approvalWorkflowId ? <span className="inline-flex items-center gap-1">{t("adminArea.capabilities.approval")}<IdText value={submission.approvalWorkflowId} label={t("adminArea.capabilities.approval")} /></span> : null}
      </span>
    </OutcomeNotice> : null}
    {failure ? <OutcomeNotice tone="alert" action={failure.kind === "unknown" && intent ? <Button disabled={busy} onClick={() => void submit()}>{t("agents.retry")}</Button> : undefined}>
      {failure.kind === "unknown" ? t("agents.unknown", { operation: failure.operationId ?? submission?.operationId ?? "—" }) : failureText(failure)}
    </OutcomeNotice> : null}
    {(registering || intent?.capabilityContractRegistration) && page?.canRegister ? <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4" data-testid="capability-registration">
      <h3 className="text-sm font-semibold text-foreground">{t("adminArea.capabilities.registerFormTitle")}</h3>
      <label className="flex flex-col gap-1.5 text-sm">{t("capabilities.document")}
        <textarea className="min-h-40 w-full rounded-lg border border-input bg-background p-2.5 font-mono text-xs shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          value={document} disabled={frozen} onChange={(event) => { setDocument(event.target.value); setInvalid(false); }} />
      </label>
      <p className="text-xs text-muted-foreground">{t("capabilities.documentHelp")}</p>
      {invalid ? <p role="alert" className="text-sm text-danger-text">{t("capabilities.invalid")}</p> : null}
      <Button className="w-fit" disabled={frozen || !document.trim()} onClick={prepareRegistration}>{t("capabilities.register")}</Button>
    </div> : null}
    {state.status === "pending" ? <TableSkeleton rows={3} columns={4} />
      : !page ? <ErrorState error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <DataTable label={t("adminArea.capabilities.listLabel")} rows={page.contracts} columns={columns} rowKey={contractKey}
        onRowClick={(row) => setOpenKey(openKey === contractKey(row) ? null : contractKey(row))} selectedKey={openKey}
        search={{ placeholder: t("adminArea.capabilities.search"), text: (row) => `${row.categoryKey} ${t(statusLabels[row.status])}` }}
        toolbar={<RefreshButton onClick={reload} />}
        rowActions={(row) => <RowActionsMenu name={`${row.categoryKey} ${version(row)}`} disabled={frozen} actions={[
          ...(row.canApprove ? [{ key: "approve", label: t("capabilities.approve"), onSelect: () => prepareTransition(row, true) }] : []),
          ...(row.canDeprecate ? [{ key: "deprecate", danger: true, label: t("adminArea.capabilities.deprecateConfirm"), onSelect: () => prepareTransition(row, false) }] : []),
        ]} />} rowActionsWidth="3.5rem"
        partial={page.complete ? undefined : <button type="button" className="text-brand-text hover:underline" onClick={() => setBudget((n) => n + 10)}>
          {t("list.partial", { count: String(page.contracts.length) })} · {t("list.loadMore")}</button>}
        empty={<EmptyState title={t("adminArea.capabilities.emptyTitle")} description={t("adminArea.capabilities.emptyBody")} />} />}
    {open ? <div className="flex flex-col gap-2" data-testid="capability-contract-detail">
      <h3 className="text-sm font-semibold text-foreground">{open.categoryKey} {version(open)}</h3>
      <KeyValueList items={[
        { id: "status", label: t("platform.state"), value: t(statusLabels[open.status]) },
        { id: "schema", label: t("adminArea.capabilities.schemaDigest"), value: <IdText value={open.schemaSetDigest} label={t("adminArea.capabilities.schemaDigest")} /> },
        { id: "suite", label: t("adminArea.capabilities.suiteDigest"), value: <IdText value={open.conformanceSuiteDigest} label={t("adminArea.capabilities.suiteDigest")} /> },
        open.registeredByActionExecutionId ? { id: "registered", label: t("adminArea.capabilities.registeredBy"), value: <IdText value={open.registeredByActionExecutionId} /> } : null,
        open.bootstrapActionExecutionId ? { id: "bootstrap", label: t("adminArea.capabilities.bootstrap"), value: <IdText value={open.bootstrapActionExecutionId} /> } : null,
      ]} />
    </div> : null}
    <ConfirmDialog open={dialog && intent !== null} testId="capability-contract-dialog" pending={busy} tone={kind === "deprecate" ? "danger" : "default"}
      onOpenChange={(next) => { if (next) return; setDialog(false); if (!unknown) setIntent(null); }}
      title={t(kind === "register" ? "adminArea.capabilities.registerTitle" : kind === "approve" ? "adminArea.capabilities.approveTitle" : "adminArea.capabilities.deprecateTitle", names)}
      description={t(kind === "register" ? "adminArea.capabilities.registerBody" : kind === "approve" ? "adminArea.capabilities.approveBody" : "adminArea.capabilities.deprecateBody")}
      confirmLabel={unknown ? t("agents.retry") : t(kind === "register" ? "adminArea.capabilities.registerConfirm" : kind === "approve" ? "adminArea.capabilities.approveConfirm" : "adminArea.capabilities.deprecateConfirm")}
      onConfirm={() => void submit()}>
      {intent?.capabilityContractRegistration ? <RawData value={intent.capabilityContractRegistration} /> : null}
      {unknown ? <UnknownInDialog operation={failure?.kind === "unknown" ? failure.operationId ?? submission?.operationId : submission?.operationId} /> : null}
    </ConfirmDialog>
  </PageSection>;
}
