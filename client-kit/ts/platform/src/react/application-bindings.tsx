// DD-88/94: one integration-management surface shared by Web and Desktop.
// This is not the external application's administration UI or data plane.
import {
  ActionDispatchState, ActionGateState, ApplicationBindingState,
  ApplicationCallIdentityMode, ApplicationIsolationMode, ApplicationModelCallMode, NativePageCategory, ReasonCode,
  type ActionCommand, type ActionSubmission, type ApplicationBindingCreate,
  type ApplicationBindingPage, type ApplicationBindingView,
} from "@client-kit/contracts";
import { useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "../governance";
import { TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { TaskDetail } from "./governance";
import { Badge, Button, Cell, Notice, ReadFailure, Table } from "./ui";
import { useLoad } from "./use-load";
import { NativeApplicationPage } from "./native-application-page";
import { validDeclaration } from "../component-preferences";
import { ServiceReadPermissions } from "./service-read-permissions";
import { DirectoryReceiptStatus } from "./directory-receipt-status";

const states = {
  [ApplicationBindingState.Provisioning]: "bindings.provisioning",
  [ApplicationBindingState.Active]: "bindings.active",
  [ApplicationBindingState.Upgrading]: "bindings.upgrading",
  [ApplicationBindingState.Disabling]: "bindings.disabling",
  [ApplicationBindingState.Disabled]: "bindings.disabled",
  [ApplicationBindingState.Error]: "bindings.error",
} as const;

const nonempty = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

type BindableRelease = NonNullable<ApplicationBindingPage["bindableReleases"]>[number];
type SecretValues = NonNullable<ActionCommand["bindingSecretValues"]>;

/** Only public secretSchema declarations; values are entered separately and never part of the page. */
function validBindableReleases(releases: ApplicationBindingPage["bindableReleases"], canCreate: boolean): boolean {
  if (releases === undefined) return true;
  return canCreate && Array.isArray(releases)
    && new Set(releases.map((release) => release?.componentReleaseId)).size === releases.length
    && releases.every((release) => !!release && [release.componentReleaseId, release.componentTypeKey, release.version].every(nonempty)
      && Array.isArray(release.secretSchema)
      && new Set(release.secretSchema.map((secret) => secret?.secretKey)).size === release.secretSchema.length
      && release.secretSchema.every((secret) => !!secret && [secret.secretKey, secret.valueType, secret.lengthOrFormat].every(nonempty)));
}

export function validBindingPage(page: ApplicationBindingPage, workspaceId: string | undefined, offset: number): boolean {
  return !!page && typeof page.canCreate === "boolean" && Array.isArray(page.bindings)
    && validBindableReleases(page.bindableReleases, page.canCreate)
    && (page.nextOffset === undefined || (positive(page.nextOffset) && page.nextOffset > offset))
    && new Set(page.bindings.map((row) => row?.bindingId)).size === page.bindings.length
    && page.bindings.every((row) => !!row && row.workspaceId === workspaceId
      && [row.bindingId, row.tenantId, row.componentReleaseId, row.componentTypeKey].every(nonempty)
      && Object.values(ApplicationBindingState).includes(row.state) && positive(row.version)
      && typeof row.canDisable === "boolean"
      && (row.hasReadReceiver === undefined || typeof row.hasReadReceiver === "boolean")
      && (row.nativePageCategory === undefined || Object.values(NativePageCategory).includes(row.nativePageCategory))
      && (row.activeProjectionGeneration === undefined || positive(row.activeProjectionGeneration))
      && (row.state !== ApplicationBindingState.Active || positive(row.activeProjectionGeneration))
      // DD-138: contributed Kailo settings items, already validated by Core at registration.
      && (row.preferences === undefined || (Array.isArray(row.preferences) && row.preferences.every(validDeclaration)))
      // DD-127: a native page entry binding enables no capability category.
      && Array.isArray(row.capabilityCategories)
      && row.capabilityCategories.every((capability) => !!capability && nonempty(capability.category) && positive(capability.version)));
}

/** Pair every declared secret with exactly one non-empty value, in declaration order. */
export function bindingSecretValues(release: BindableRelease | undefined, values: Record<string, string>): SecretValues | null {
  if (!release) return null;
  const entries = release.secretSchema.map((secret) => ({ secretKey: secret.secretKey, value: values[secret.secretKey] ?? "" }));
  return entries.every((entry) => entry.value.length > 0) ? entries : null;
}

/** Validate the generated command's shape, not its authority: Core rechecks all references.
 * secretRefs must be empty: Core alone produces SecretRefs from the governed write (03 §9). */
export function bindingDocument(source: string): ApplicationBindingCreate | null {
  try {
    const value = JSON.parse(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const fields = ["bindingId", "componentReleaseId", "servicePrincipalId", "adapterServiceRef", "nativeInstanceRef",
      "nativeScopeRef", "isolationMode", "capabilityCategories", "normalizedConfigJson", "secretRefs",
      "modelCallMode", "callIdentityMode", "retainOnTenantDelete"];
    if (Object.keys(value).some((key) => !fields.includes(key))
      || ![value.bindingId, value.componentReleaseId, value.servicePrincipalId, value.adapterServiceRef, value.nativeInstanceRef].every(nonempty)
      || (value.nativeScopeRef !== undefined && !nonempty(value.nativeScopeRef))
      || !Object.values(ApplicationIsolationMode).includes(value.isolationMode)
      || !Object.values(ApplicationCallIdentityMode).includes(value.callIdentityMode)
      || !Object.values(ApplicationModelCallMode).includes(value.modelCallMode)
      || typeof value.retainOnTenantDelete !== "boolean" || !nonempty(value.normalizedConfigJson)
      // Empty only for a DD-127 native page entry release; Core decides per release.
      || !Array.isArray(value.capabilityCategories)
      || !value.capabilityCategories.every((item: ApplicationBindingCreate["capabilityCategories"][number]) => item
        && Object.keys(item).every((key) => ["category", "version"].includes(key)) && nonempty(item.category) && positive(item.version))
      || !Array.isArray(value.secretRefs) || value.secretRefs.length !== 0) return null;
    const config = JSON.parse(value.normalizedConfigJson);
    if (!config || typeof config !== "object" || Array.isArray(config)) return null;
    return value;
  } catch { return null; }
}

export function ApplicationBindingsPanel() {
  const client = useBffClient();
  const t = useT();
  const [scope, setScope] = useState<string | undefined>();
  const [locked, setLocked] = useState(false);
  const [workspaces, reload] = useLoad("application-binding-workspaces", client.workspaces);
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="application-bindings">
    <h2 className="font-medium">{t("bindings.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("bindings.boundary")}</p>
    {workspaces.status === "ok" && workspaces.data.length > 0 ? <label className="text-sm">{t("bindings.scope")}
      <select className="ml-2 rounded-md border border-input bg-background px-2 py-1" value={scope ?? ""}
        disabled={locked} onChange={(event) => setScope(event.target.value || undefined)}>
        <option value="">{t("bindings.tenant")}</option>
        {workspaces.status === "ok" ? workspaces.data.map((workspace) =>
          <option key={workspace.id} value={workspace.id}>{workspace.name}</option>) : null}
      </select>
    </label> : <p className="text-sm">{t("bindings.tenant")}</p>}
    {workspaces.status === "error" ? <ReadFailure error={workspaces.error} onRetry={reload} /> : null}
    <BindingScope key={scope ?? "tenant"} workspaceId={scope} lockScope={setLocked} />
  </section>;
}

function BindingScope({ workspaceId, lockScope }: { workspaceId?: string; lockScope: (locked: boolean) => void }) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`application-bindings:${workspaceId ?? "tenant"}:${offset}`, () => client.applicationBindings(workspaceId, offset));
  const page = state.status === "ok" && validBindingPage(state.data, workspaceId, offset) ? state.data : null;
  const [document, setDocument] = useState("");
  const [invalid, setInvalid] = useState(false);
  // Held only in this component's memory until the command resolves; never logged or persisted.
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  const [secretsMissing, setSecretsMissing] = useState(false);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const [nativePage, setNativePage] = useState<string | null>(null);
  const [readBinding, setReadBinding] = useState<ApplicationBindingView | null>(null);
  const [readLocked, setReadLocked] = useState(false);
  useEffect(() => { lockScope(!!intent || busy || readLocked); }, [intent, busy, readLocked, lockScope]);
  const sending = useRef(false);
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  const prepare = (command: ActionCommand) => {
    if (intent || sending.current) return;
    setSubmission(null); setFailure(null); setIntent(command); lockScope(true);
  };
  const parsedDocument = bindingDocument(document);
  const release = page?.bindableReleases?.find((item) => item.componentReleaseId === parsedDocument?.componentReleaseId);
  const create = () => {
    if (!page?.canCreate) return;
    const parsed = bindingDocument(document);
    setInvalid(!parsed);
    if (!parsed) return;
    const selected = page.bindableReleases?.find((item) => item.componentReleaseId === parsed.componentReleaseId);
    const secrets = bindingSecretValues(selected, secretValues);
    setSecretsMissing(!secrets);
    if (!secrets) return;
    prepare({ actionKey: "application_binding.create", workspaceId,
      idempotencyKey: newIdempotencyKey(), explicitConfirmation: true, applicationBindingCreate: parsed,
      ...(secrets.length ? { bindingSecretValues: secrets } : {}) });
  };
  const disable = (binding: ApplicationBindingView) => {
    if (!binding.canDisable) return;
    prepare({ actionKey: "application_binding.disable", workspaceId, idempotencyKey: newIdempotencyKey(),
      explicitConfirmation: true, applicationBindingId: binding.bindingId, applicationBindingVersion: binding.version });
  };
  const submit = async () => {
    if (!intent || sending.current) return;
    sending.current = true; setBusy(true);
    try {
      const result = await client.submitAction(intent);
      if (!result || result.actionKey !== intent.actionKey || !nonempty(result.actionExecutionId) || !nonempty(result.operationId)
        || !Object.values(ActionGateState).includes(result.gateState) || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (result.gateState === ActionGateState.Denied && !result.reason)
        || (result.gateState === ActionGateState.Waiting && (!nonempty(result.approvalWorkflowId) || result.dispatchState !== ActionDispatchState.NotDispatched))
        || (result.dispatchState === ActionDispatchState.Dispatched && (result.gateState !== ActionGateState.Allowed || !nonempty(result.workflowId)))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))) {
        throw new TransportError(t("platform.loadFailed"));
      }
      setSubmission(result); setFailure(null);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); lockScope(false);
        if (result.dispatchState === ActionDispatchState.Dispatched && intent.applicationBindingCreate) {
          setDocument(""); setSecretValues({});
        }
      }
    } catch (error) {
      // A later refusal cannot establish the outcome of an earlier uncertain write.
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); lockScope(false); }
      }
    } finally { sending.current = false; setBusy(false); reload(); }
  };
  if (task) return <TaskDetail actionExecutionId={task} onBack={() => { setTask(null); reload(); }} onOpen={setTask} />;
  if (nativePage) return <NativeApplicationPage bindingId={nativePage} onBack={() => { setNativePage(null); reload(); }} />;
  if (readBinding) return <ServiceReadPermissions binding={readBinding} onLocked={setReadLocked}
    onBack={() => { if (!readLocked) { setReadBinding(null); reload(); } }} />;
  return <div className="flex flex-col gap-3">
    {intent ? <div className="flex flex-col gap-2" role="group" aria-label={t("bindings.review")}>
      <p className="text-sm">{t(intent.applicationBindingCreate ? "bindings.createWarning" : "bindings.disableWarning")}</p>
      <p className="break-all font-mono text-xs">{intent.applicationBindingCreate?.bindingId ?? intent.applicationBindingId}</p>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void submit()}>{t(busy ? "platform.loading" : unknown ? "agents.retry" : "agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); lockScope(false); }}>{t("platform.cancel")}</Button> : null}
      </div>
    </div> : null}
    {submission ? <div role="status" className="break-all text-sm">
      <p>{unknown ? t("agents.unknown", { operation: submission.operationId })
        : t("bindings.recorded", { operation: submission.operationId })}
        {submission.reason ? ` · ${reasonText(submission.reason)}` : ""}</p>
      <Button onClick={() => setTask(submission.actionExecutionId)}>{t("bindings.task")}</Button>
    </div> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? submission?.operationId ?? "—" }) : failureText(failure)}</p> : null}
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} /> : <>
        {page.canCreate ? <div className="flex flex-col gap-2">
          <label className="text-sm">{t("bindings.document")}
            <textarea className="min-h-32 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs"
              value={document} disabled={!!intent || busy} onChange={(event) => { setDocument(event.target.value); setInvalid(false); }} />
          </label>
          <p className="text-sm text-muted-foreground">{t("bindings.documentHelp")}</p>
          {page.bindableReleases?.length ? <div className="text-sm">
            <p>{t("bindings.releases")}</p>
            <ul className="font-mono text-xs">{page.bindableReleases.map((item) =>
              <li key={item.componentReleaseId} className="break-all">{`${item.componentTypeKey}@${item.version} · ${item.componentReleaseId}`}</li>)}</ul>
          </div> : null}
          {release?.secretSchema.length ? <fieldset className="flex flex-col gap-2" data-testid="binding-secrets">
            <legend className="text-sm">{t("bindings.secrets")}</legend>
            {release.secretSchema.map((secret) => <label key={secret.secretKey} className="text-sm">
              <span className="font-mono">{secret.secretKey}</span>
              <input type="password" autoComplete="new-password" spellCheck={false}
                className="ml-2 rounded-md border border-input bg-transparent px-2 py-1"
                value={secretValues[secret.secretKey] ?? ""} disabled={!!intent || busy}
                onChange={(event) => { const value = event.target.value;
                  setSecretValues((old) => ({ ...old, [secret.secretKey]: value })); setSecretsMissing(false); }} />
            </label>)}
            <p className="text-sm text-muted-foreground">{t("bindings.secretsHelp")}</p>
          </fieldset> : null}
          {invalid ? <p role="alert">{t("bindings.invalid")}</p> : null}
          {secretsMissing ? <p role="alert">{t("bindings.secretsMissing")}</p> : null}
          <Button className="w-fit" disabled={!!intent || busy || !document.trim()} onClick={create}>{t("bindings.create")}</Button>
        </div> : null}
        {page.bindings.length === 0 ? <Notice>{t("bindings.none")}</Notice> : <div className="overflow-x-auto">
          <Table head={[t("bindings.connection"), t("platform.state"), t("bindings.capabilities"), t("platform.action")]}>
            {page.bindings.map((binding) => <tr key={binding.bindingId}>
              <Cell><span>{binding.componentTypeKey}</span><p className="font-mono text-xs">{binding.bindingId}</p></Cell>
              <Cell><Badge tone={binding.state === ApplicationBindingState.Active ? "positive" : "neutral"}>{t(states[binding.state])}</Badge>
                {binding.canDisable && binding.hasNativePage === true && binding.state === ApplicationBindingState.Active
                  ? <DirectoryReceiptStatus bindingId={binding.bindingId} /> : null}</Cell>
              <Cell>{binding.capabilityCategories.map((item) => `${item.category}@${item.version}`).join(" · ")}</Cell>
              <Cell>{binding.hasNativePage === true && binding.state === ApplicationBindingState.Active
                ? <Button disabled={!!intent || busy} onClick={() => setNativePage(binding.bindingId)}>{t("bindings.openNative")}</Button> : null}
                {binding.hasReadReceiver === true && binding.state === ApplicationBindingState.Active
                  ? <Button disabled={!!intent || busy} onClick={() => setReadBinding(binding)}>{t("bindings.read.title")}</Button> : null}
                {binding.canDisable ? <Button disabled={!!intent || busy} onClick={() => disable(binding)}>{t("bindings.disable")}</Button> : null}</Cell>
            </tr>)}
          </Table>
        </div>}
        <div className="flex gap-2">
          {index > 0 ? <Button disabled={!!intent || busy} onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
          {page.nextOffset !== undefined ? <Button disabled={!!intent || busy} onClick={() => {
            setOffsets((old) => [...old.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
      </>}
  </div>;
}
