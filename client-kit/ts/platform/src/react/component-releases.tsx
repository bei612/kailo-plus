// Catalog management only: this page never mounts a component or activates a binding.
// Both React hosts consume this same page and the original governed Action client.
import {
  ActionDispatchState, ActionGateState, ComponentReleaseStatus, ReasonCode,
  type ActionCommand, type ActionSubmission, type ComponentReleasePage,
  type ComponentReleaseRegistration,
} from "@client-kit/contracts";
import { useRef, useState } from "react";
import { newIdempotencyKey } from "../governance";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { TaskDetail } from "./governance";
import { Badge, Button, Cell, Notice, ReadFailure, Table } from "./ui";
import { useLoad } from "./use-load";

const statusLabels = {
  [ComponentReleaseStatus.Registered]: "components.registered",
  [ComponentReleaseStatus.Approved]: "components.approved",
  [ComponentReleaseStatus.Rejected]: "components.rejected",
  [ComponentReleaseStatus.Revoked]: "components.revoked",
} as const;

function validPage(page: ComponentReleasePage, offset: number): boolean {
  return !!page && typeof page.canRegister === "boolean" && Array.isArray(page.releases)
    && (page.nextOffset === undefined || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > offset))
    && new Set(page.releases.map((release) => release?.componentReleaseId)).size === page.releases.length
    && page.releases.every((release) => !!release && Object.values(ComponentReleaseStatus).includes(release.status)
      && [release.componentReleaseId, release.componentTypeKey, release.version,
        release.registeredByActionExecutionId, release.operationId, release.workflowId]
        .every((value) => typeof value === "string" && !!value.trim())
      && [release.manifestDigest, release.artifactDigest, release.suiteDigest]
        .every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)));
}

function registration(manifestJson: string, packageJson: string, bindingConfigSchemaJson: string): ComponentReleaseRegistration | null {
  try {
    const manifest = JSON.parse(manifestJson);
    const componentPackage = JSON.parse(packageJson);
    const schema = JSON.parse(bindingConfigSchemaJson);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)
      || !componentPackage || typeof componentPackage !== "object" || Array.isArray(componentPackage)
      || !(typeof schema === "boolean" || (schema && typeof schema === "object" && !Array.isArray(schema)))) return null;
    // Preserve source documents. Core owns validation, canonicalization and digest;
    // parsing in this form must not round large integers before admission.
    return { manifestJson, packageJson, bindingConfigSchemaJson };
  } catch { return null; }
}

export function ComponentReleasesPanel() {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`component-releases:${offset}`, () => client.componentReleases(offset));
  const page = state.status === "ok" && validPage(state.data, offset) ? state.data : null;
  const [manifest, setManifest] = useState("");
  const [componentPackage, setComponentPackage] = useState("");
  const [bindingSchema, setBindingSchema] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [task, setTask] = useState<string | null>(null);
  const sending = useRef(false);
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  const frozen = !!intent || busy;
  const prepare = () => {
    if (frozen || !page?.canRegister) return;
    const value = registration(manifest, componentPackage, bindingSchema);
    setInvalid(!value);
    if (!value) return;
    setSubmission(null); setFailure(null);
    setIntent({ actionKey: "component_release.register", idempotencyKey: newIdempotencyKey(),
      explicitConfirmation: true, componentReleaseRegistration: value });
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
        || result.gateState === ActionGateState.Waiting
        || (result.dispatchState === ActionDispatchState.Dispatched
          && (result.gateState !== ActionGateState.Allowed || typeof result.workflowId !== "string" || !result.workflowId))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))) {
        throw new TransportError(t("platform.loadFailed"));
      }
      setSubmission(result); setFailure(null);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null);
        // A dispatched Workflow is not REGISTERED. The task remains the actual
        // execution authority; only the scoped Catalog read supplies a release.
        if (result.dispatchState === ActionDispatchState.Dispatched) {
          setManifest(""); setComponentPackage(""); setBindingSchema("");
        }
      }
    } catch (error) {
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") setIntent(null);
      }
    } finally { sending.current = false; setBusy(false); reload(); }
  };
  if (task) return <TaskDetail actionExecutionId={task} onBack={() => { setTask(null); reload(); }} onOpen={setTask} />;
  if (!intent && !submission && !failure && (state.status === "pending"
    || (state.status === "error" && state.error instanceof BffError && [403, 404].includes(state.error.status)))) return null;
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="component-releases">
    <h2 className="font-medium">{t("components.title")}</h2>
    <p className="text-sm text-muted-foreground">{t("components.boundary")}</p>
    {intent?.componentReleaseRegistration ? <div role="group" className="flex flex-col gap-2 text-sm">
      <p>{t("components.registerWarning")}</p>
      <pre className="overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(intent.componentReleaseRegistration, null, 2)}</pre>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void submit()}>{t(busy ? "platform.loading" : unknown ? "agents.retry" : "agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => setIntent(null)}>{t("platform.cancel")}</Button> : null}
      </div>
    </div> : null}
    {submission ? <div role="status" className="break-all text-sm">
      <p>{unknown ? t("agents.unknown", { operation: submission.operationId })
        : t("components.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}
        {submission.reason ? ` · ${reasonText(submission.reason)}` : ""}</p>
      {submission.workflowId ? <p>{t("components.workflow", { workflow: submission.workflowId })}</p> : null}
      <Button onClick={() => setTask(submission.actionExecutionId)}>{t("components.viewTask")}</Button>
    </div> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? submission?.operationId ?? "—" }) : failureText(failure)}</p> : null}
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {page.canRegister ? <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t("components.documentHelp")}</p>
          <label className="text-sm">{t("components.manifest")}
            <textarea className="min-h-32 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" value={manifest}
              disabled={frozen} onChange={(event) => { setManifest(event.target.value); setInvalid(false); }} />
          </label>
          <label className="text-sm">{t("components.package")}
            <textarea className="min-h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" value={componentPackage}
              disabled={frozen} onChange={(event) => { setComponentPackage(event.target.value); setInvalid(false); }} />
          </label>
          <label className="text-sm">{t("components.bindingSchema")}
            <textarea className="min-h-24 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs" value={bindingSchema}
              disabled={frozen} onChange={(event) => { setBindingSchema(event.target.value); setInvalid(false); }} />
          </label>
          {invalid ? <p role="alert">{t("components.invalid")}</p> : null}
          <Button className="w-fit" disabled={frozen || !manifest.trim() || !componentPackage.trim() || !bindingSchema.trim()}
            onClick={prepare}>{t("components.register")}</Button>
        </div> : null}
        {!page.releases.length ? <Notice>{t("components.none")}</Notice> : <div className="overflow-x-auto">
          <Table head={[t("components.release"), t("platform.state"), t("components.artifact"), t("capabilities.suiteDigest"), t("platform.action")]}>
            {page.releases.map((release) => <tr key={release.componentReleaseId}>
              <Cell>{release.componentTypeKey} · {release.version}</Cell>
              <Cell><Badge tone="neutral">{t(statusLabels[release.status])}</Badge></Cell>
              <Cell mono>{release.artifactDigest}</Cell><Cell mono>{release.suiteDigest}</Cell>
              <Cell><Button onClick={() => setTask(release.registeredByActionExecutionId)}>{t("components.viewTask")}</Button></Cell>
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
