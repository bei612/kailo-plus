// DD-66/68, 19 §5/7: both TS hosts use this same governed Memory surface.
// Decrypted bodies stay in the mounted view, never local storage or telemetry.
import {
  ActionDispatchState, ActionGateState, AgentInstallationState, ErrorClass, ExpectedHeadState,
  PlatformSessionAccessMode, ReasonCode, ResourceState, TaskStatus,
  type ActionCommand, type ActionSubmission, type AgentInstallationView,
  type AgentMemoryReadView, type AgentMemoryEntryPage, type AgentMemoryEntryView,
  type AgentMemoryWriteInput, type TaskView,
} from "@client-kit/contracts";
import { useRef, useState } from "react";
import { newIdempotencyKey, taskPhase } from "../governance";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, Notice } from "./ui";
import { useLoad } from "./use-load";

const eventId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
const nonnegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const timestamp = (value: unknown): value is number => nonnegativeInteger(value)
  && Number.isFinite(new Date(value * 1000).getTime());
const coldSlug = (value: string): boolean => value.length <= 255
  && /^mem\/[a-z0-9][a-z0-9_-]{0,63}(\/[a-z0-9][a-z0-9_-]{0,63})*$/.test(value);

export function validMemoryRead(value: AgentMemoryReadView, installation: string, workspace: string, slug: string): boolean {
  if (!value || value.installationResourceId !== installation || value.workspaceId !== workspace
    || typeof value.operationId !== "string" || !value.operationId || value.slug !== slug
    || (slug !== "core" && !coldSlug(slug))) return false;
  const head = eventId(value.eventId) && timestamp(value.createdAt);
  const noHead = value.eventId === undefined && value.createdAt === undefined;
  const noBody = value.content === undefined && value.contentBytes === undefined && value.valueHash === undefined;
  switch (value.state) {
    case "FOUND": return head && typeof value.content === "string"
      && nonnegativeInteger(value.contentBytes) && new TextEncoder().encode(value.content).length === value.contentBytes
      && (value.valueHash === undefined || eventId(value.valueHash));
    case "ABSENT": return noBody && (noHead || (slug !== "core" && head));
    case "UNREADABLE": return noBody && noHead;
    default: return false;
  }
}

export function validMemoryEntries(value: AgentMemoryEntryPage, installation: string, workspace: string): boolean {
  if (!value || value.installationResourceId !== installation || value.workspaceId !== workspace
    || typeof value.operationId !== "string" || !value.operationId || !Array.isArray(value.entries)) return false;
  if (value.state === "UNKNOWN" || value.state === "BOUND_EXCEEDED") return value.entries.length === 0;
  if (value.state !== "COMPLETE") return false;
  const slugs = new Set<string>();
  return value.entries.every((entry) => {
    if (!entry || typeof entry.slug !== "string" || !coldSlug(entry.slug) || slugs.has(entry.slug)
      || !eventId(entry.eventId) || !timestamp(entry.createdAt) || typeof entry.tombstone !== "boolean") return false;
    slugs.add(entry.slug);
    return true;
  });
}

export function InstallationMemory({ resourceId, workspaceId, installation, onLocked }: {
  resourceId: string; workspaceId: string; installation?: AgentInstallationView; onLocked?: (locked: boolean) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="agent-memory">
    <h4 className="text-sm font-medium">{t("agents.memory.title")}</h4>
    <p className="text-sm text-muted-foreground">{t(installation ? "agents.memory.governed" : "agents.memory.readOnly")}</p>
    <Button className="w-fit" disabled={locked} aria-expanded={open} onClick={() => setOpen(!open)}>
      {t(open ? "agents.memory.close" : "agents.memory.open")}
    </Button>
    {open ? <MemoryContents key={`${workspaceId}:${resourceId}`} resourceId={resourceId} workspaceId={workspaceId}
      installation={installation} onLocked={(next) => { setLocked(next); onLocked?.(next); }} /> : null}
  </section>;
}

type MemoryEdit = { read: AgentMemoryReadView; mode: "value" | "patch" | "remove" };

function validMemoryTask(task: TaskView): boolean {
  return !!task && typeof task.actionKey === "string" && typeof task.targetId === "string" && !!task.targetId
    && typeof task.actionExecutionId === "string" && !!task.actionExecutionId
    && typeof task.operationId === "string" && !!task.operationId
    && Object.values(ActionGateState).includes(task.gateState)
    && Object.values(ActionDispatchState).includes(task.dispatchState)
    && (task.reason === undefined || Object.values(ReasonCode).includes(task.reason))
    && (task.taskStatus === undefined || Object.values(TaskStatus).includes(task.taskStatus))
    && (task.observation === undefined || Object.values(ReasonCode).includes(task.observation))
    && (task.workflowId === undefined || (typeof task.workflowId === "string" && !!task.workflowId));
}

function memoryOutcomeKnown(result: Pick<ActionSubmission, "gateState" | "dispatchState" | "reason">): boolean {
  if (result.dispatchState === ActionDispatchState.Unknown || result.gateState === ActionGateState.Evaluating) return false;
  if (result.gateState === ActionGateState.Allowed) return result.dispatchState === ActionDispatchState.Aborted
    || (result.dispatchState === ActionDispatchState.Dispatched
      && (result.reason === undefined || result.reason === ReasonCode.TargetStateConflict));
  return [ActionGateState.Denied, ActionGateState.Revoked, ActionGateState.Expired].includes(result.gateState)
    && [ActionDispatchState.NotDispatched, ActionDispatchState.Aborted].includes(result.dispatchState);
}

function MemoryContents({ resourceId, workspaceId, installation, onLocked }: {
  resourceId: string; workspaceId: string; installation?: AgentInstallationView; onLocked: (locked: boolean) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [edit, setEdit] = useState<MemoryEdit | null>(null);
  const [round, setRound] = useState(0);
  const [slugInput, setSlugInput] = useState("");
  const [newSlug, setNewSlug] = useState<string | null>(null);
  const [session, reloadSession] = useLoad(`memory-owner:${workspaceId}:${resourceId}:${installation?.ownerPrincipalId}`,
    () => installation ? client.session() : Promise.resolve(null));
  const canWrite = !!installation && installation.resourceId === resourceId && installation.workspaceId === workspaceId
    && Number.isSafeInteger(installation.resourceVersion) && installation.resourceVersion > 0
    && installation.state === AgentInstallationState.Active && installation.resourceState === ResourceState.Active
    && installation.agentPrincipalState === "ACTIVE"
    && session.status === "ok" && session.data?.accessMode === PlatformSessionAccessMode.Full
    && typeof session.data.tenantPrincipalId === "string" && !!session.data.tenantPrincipalId
    && session.data.tenantPrincipalId === installation.ownerPrincipalId;
  const [tasks, reloadTasks] = useLoad(`memory-tasks:${workspaceId}:${resourceId}:${canWrite}`,
    () => canWrite ? client.tasks() : Promise.resolve(null));
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validMemoryTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => task.targetId === resourceId
    && task.actionKey.startsWith("agent.memory.") && (task.observation !== undefined
      || task.workflowId !== undefined || task.approvalWorkflowId !== undefined || !memoryOutcomeKnown(task))) ?? [];
  const requestBlocked = !taskRows || pending.length > 0;
  const [state, reload] = useLoad(`memory-entries:${workspaceId}:${resourceId}`, () => client.agentMemoryEntries(resourceId));
  const page = state.status === "ok" && validMemoryEntries(state.data, resourceId, workspaceId) ? state.data : null;
  const onEdit = canWrite && !edit && !requestBlocked ? (read: AgentMemoryReadView, mode: MemoryEdit["mode"]) => {
    setEdit({ read, mode }); onLocked(true);
  } : undefined;
  const finish = (refresh: boolean) => {
    setEdit(null); onLocked(false);
    if (refresh) { setRound((value) => value + 1); reload(); reloadTasks(); reloadSession(); }
  };
  return <>
    {installation && session.status === "error" ? <Notice role="status">{t("platform.loadFailed")}
      <Button onClick={reloadSession}>{t("platform.retry")}</Button></Notice> : null}
    <h5 className="text-sm font-medium">{t("agents.memory.core")}</h5>
    <p className="text-sm text-muted-foreground">{t("agents.memory.newSessions")}</p>
    <MemoryBody key={`core:${round}`} resourceId={resourceId} workspaceId={workspaceId} slug="core" onEdit={onEdit} />
    <h5 className="text-sm font-medium">{t("agents.memory.cold")}</h5>
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <Notice role="status">{t("platform.loadFailed")}<Button onClick={reload}>{t("platform.retry")}</Button></Notice>
      : page.state !== "COMPLETE" ? <Notice role="status">{t(page.state === "BOUND_EXCEEDED" ? "agents.memory.boundExceeded" : "agents.memory.unknown")}</Notice>
      : page.entries.length === 0 ? <Notice>{t("agents.memory.none")}</Notice>
      : <div className="space-y-2" data-testid="agent-memory-list">
        {page.entries.map((entry) => <MemoryEntryAccordion key={`${round}:${entry.eventId}`} entry={entry}
          resourceId={resourceId} workspaceId={workspaceId} onEdit={onEdit} />)}
      </div>}
    {canWrite ? <>
      <form className="flex flex-col gap-2" onSubmit={(event) => {
        event.preventDefault(); if (!edit && coldSlug(slugInput)) setNewSlug(slugInput);
      }}>
        <label className="flex flex-col gap-1 text-sm">{t("agents.memory.newEntry")}
          <input value={slugInput} disabled={!!edit} onChange={(event) => setSlugInput(event.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2" />
        </label>
        <Button type="submit" className="w-fit" disabled={!!edit || !coldSlug(slugInput)}>{t("agents.memory.readEntry")}</Button>
      </form>
      {newSlug ? <MemoryBody key={`${round}:${newSlug}`} resourceId={resourceId} workspaceId={workspaceId} slug={newSlug} onEdit={onEdit} /> : null}
      {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
        : pending.length ? <div role="status" className="space-y-1 text-sm">
          <p>{t("agents.memory.inFlight")}</p>{pending.map((task) => <p className="break-words" key={task.actionExecutionId}>
            {t(task.dispatchState === ActionDispatchState.Unknown ? "tasks.status.unknown" : taskPhase(task).label)} · {task.operationId}
          </p>)}<Button onClick={reloadTasks}>{t("platform.refresh")}</Button>
        </div> : null}
    </> : null}
    {edit && installation ? <MemoryEditor key={`${edit.read.operationId}:${edit.mode}`} edit={edit}
      installation={installation} canWrite={canWrite} requestBlocked={requestBlocked} onFinished={finish} /> : null}
  </>;
}

// Buzz MemorySection::MemoryEntryAccordion's existing article/disclosure shape;
// the native local-key/query-cache hook is replaced by an explicit BFF read.
// Collapsing unmounts its decrypted body; no cross-view plaintext cache.
function MemoryEntryAccordion({ entry, resourceId, workspaceId, onEdit }: {
  entry: AgentMemoryEntryView; resourceId: string; workspaceId: string;
  onEdit?: (read: AgentMemoryReadView, mode: MemoryEdit["mode"]) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return <article className="overflow-hidden rounded-2xl bg-muted/40">
    <button type="button" aria-expanded={open}
      className="w-full px-4 py-3 text-left transition-colors hover:bg-muted/50"
      onClick={() => setOpen(!open)}>
      <div className="flex items-start gap-3"><div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-foreground"><MemorySlugTitle slug={entry.slug} /></div>
        <div className="mt-1 text-xs leading-5 text-foreground/70">
          {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(entry.createdAt * 1000)}
          {" · "}{t(entry.tombstone ? "agents.memory.tombstone" : "agents.memory.readEntry")}
        </div>
      </div></div>
    </button>
    {open ? <div className="px-4 pb-3"><MemoryBody resourceId={resourceId} workspaceId={workspaceId} slug={entry.slug} onEdit={onEdit} /></div> : null}
  </article>;
}

function MemorySlugTitle({ slug }: { slug: string }) {
  const segments = slug.split("/");
  return <span className="inline-flex flex-wrap items-baseline">
    {segments.map((segment, index) => <span key={segments.slice(0, index + 1).join("/")}>
      {index > 0 ? <span className="px-0.5 text-foreground/40">/</span> : null}
      <span className={segment === "mem" ? "text-foreground/40" : "text-foreground"}>{segment}</span>
    </span>)}
  </span>;
}

function MemoryBody({ resourceId, workspaceId, slug, onEdit }: {
  resourceId: string; workspaceId: string; slug: string;
  onEdit?: (read: AgentMemoryReadView, mode: MemoryEdit["mode"]) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`memory:${workspaceId}:${resourceId}:${slug}`, () => slug === "core"
    ? client.agentMemoryCore(resourceId) : client.agentMemoryEntry(resourceId, slug));
  const value = state.status === "ok" && validMemoryRead(state.data, resourceId, workspaceId, slug) ? state.data : null;
  return <section className="flex flex-col gap-2" data-testid="agent-memory-body">
    <p className="break-words text-sm"><MemorySlugTitle slug={slug} /></p>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !value ? <Notice role="status">{t("platform.loadFailed")}</Notice>
      : <>
        <Badge tone="neutral">{t(value.state === "FOUND" ? "agents.memory.found" : value.state === "ABSENT" ? "agents.memory.absent" : "agents.memory.unreadable")}</Badge>
        {value.eventId ? <p className="break-all font-mono text-xs">{t("agents.memory.head")}: {value.eventId}</p> : null}
        {value.state === "FOUND" ? <pre className="whitespace-pre-wrap break-words text-sm">{value.content}</pre> : null}
        {onEdit && value.state !== "UNREADABLE" ? <div className="flex flex-wrap gap-2">
          <Button onClick={() => onEdit(value, "value")}>{t(slug === "core" ? "agents.memory.replace" : "agents.memory.set")}</Button>
          {slug !== "core" && value.state === "FOUND" ? <>
            {eventId(value.valueHash) ? <Button onClick={() => onEdit(value, "patch")}>{t("agents.memory.patch")}</Button> : null}
            <Button onClick={() => onEdit(value, "remove")}>{t("agents.memory.remove")}</Button>
          </> : null}
        </div> : null}
      </>}
    <Button className="w-fit" onClick={reload}>{t("platform.refresh")}</Button>
  </section>;
}

function MemoryEditor({ edit, installation, canWrite, requestBlocked, onFinished }: {
  edit: MemoryEdit; installation: AgentInstallationView; canWrite: boolean; requestBlocked: boolean;
  onFinished: (refresh: boolean) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [value, setValue] = useState(edit.read.content ?? "");
  const [patch, setPatch] = useState("");
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const inFlight = useRef(false);
  const actionKey = edit.read.slug === "core" ? "agent.memory.core.replace"
    : edit.mode === "patch" ? "agent.memory.entry.patch"
    : edit.mode === "remove" ? "agent.memory.entry.remove" : "agent.memory.entry.set";
  const title = edit.read.slug === "core" ? "agents.memory.replace" : edit.mode === "patch" ? "agents.memory.patch"
    : edit.mode === "remove" ? "agents.memory.remove" : "agents.memory.set";
  const prepare = () => {
    if (intent || busy || !canWrite || requestBlocked
      || !validMemoryRead(edit.read, installation.resourceId, installation.workspaceId, edit.read.slug)
      || edit.read.state === "UNREADABLE"
      || (edit.mode !== "value" && edit.read.state !== "FOUND")
      || (edit.mode === "patch" && (!patch || !eventId(edit.read.valueHash)))) return;
    const memoryWrite: AgentMemoryWriteInput = {
      slug: edit.read.slug,
      expectedHeadState: edit.read.state === "FOUND" ? ExpectedHeadState.Found : ExpectedHeadState.Absent,
      expectedHeadEventId: edit.read.eventId ?? null,
    };
    if (edit.mode === "value") memoryWrite.value = value;
    if (edit.mode === "patch") { memoryWrite.patch = patch; memoryWrite.baseHash = edit.read.valueHash; }
    setIntent({ actionKey, idempotencyKey: newIdempotencyKey(), resourceId: installation.resourceId,
      resourceVersion: installation.resourceVersion, workspaceId: installation.workspaceId, memoryWrite });
  };
  const submit = async () => {
    if (!intent || inFlight.current || !canWrite) return;
    inFlight.current = true; setBusy(true); setFailure(null); setSubmission(null);
    try {
      const result = await client.submitAction(intent);
      // These four registered HUMAN actions are SYNC/NONE/noApproval. A
      // different/unknown protocol result cannot unlock a replacement intent.
      if (!result || result.actionKey !== intent.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || result.gateState === ActionGateState.Waiting || result.workflowId !== undefined || result.approvalWorkflowId !== undefined
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setSubmission(result);
      if (memoryOutcomeKnown(result)) {
        setIntent(null); setValue(""); setPatch("");
      }
    } catch (error) {
      // A missing/future error classification cannot prove that the same
      // write did not happen. Keep its frozen request, not a replacement key.
      const failed: WriteFailure = error instanceof BffError && error.errorClass !== undefined
        && Object.values(ErrorClass).includes(error.errorClass) && error.errorClass !== ErrorClass.Unknown
        && (error.reason === undefined || Object.values(ReasonCode).includes(error.reason))
        ? writeFailure(error) : { kind: "unknown", operationId: error instanceof BffError ? error.operationId : undefined };
      setFailure(failed);
      if (failed.kind !== "unknown") { setIntent(null); setValue(""); setPatch(""); }
    } finally { inFlight.current = false; setBusy(false); }
  };
  const unknown = failure?.kind === "unknown" || (submission !== null && !memoryOutcomeKnown(submission));
  const decided = !intent && (failure !== null || submission !== null);
  return <section className="flex flex-col gap-3 rounded-md border p-3" data-testid="agent-memory-editor">
    <h5 className="text-sm font-medium">{t(title)}</h5>
    <p className="break-words text-sm"><MemorySlugTitle slug={edit.read.slug} /> · {t("agents.resourceVersion")}: {installation.resourceVersion}</p>
    <p className="break-all font-mono text-xs">{t("agents.memory.head")}: {edit.read.eventId ?? t("agents.memory.absent")}</p>
    {!intent && !decided ? <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      {edit.mode !== "remove" ? <label className="flex flex-col gap-1 text-sm">{t(edit.mode === "patch" ? "agents.memory.patchText" : "agents.memory.value")}
        <textarea value={edit.mode === "patch" ? patch : value}
          onChange={(event) => edit.mode === "patch" ? setPatch(event.target.value) : setValue(event.target.value)}
          className="min-h-40 rounded-md border border-input bg-background p-2 text-sm" />
      </label> : <p className="text-sm">{t("agents.memory.tombstoneWarning")}</p>}
      {edit.mode === "patch" ? <p className="break-all font-mono text-xs">{t("agents.memory.baseHash")}: {edit.read.valueHash}</p> : null}
      <div className="flex gap-2"><Button type="submit" disabled={!canWrite || requestBlocked || (edit.mode === "patch" && !patch)}>{t("agents.review")}</Button>
        <Button onClick={() => onFinished(false)}>{t("agents.cancel")}</Button></div>
    </form> : intent ? <div className="flex flex-col gap-2 text-sm" role="group">
      <p>{t("agents.memory.review")}</p><p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex gap-2"><Button disabled={busy || !canWrite} onClick={() => void submit()}>
        {busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}
      </Button>{!busy && !unknown ? <Button onClick={() => onFinished(false)}>{t("agents.cancel")}</Button> : null}</div>
    </div> : <Button className="w-fit" onClick={() => onFinished(true)}>{t("platform.refresh")}</Button>}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.memory.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}
      {submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <Notice role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "" }) : failureText(failure)}</Notice> : null}
  </section>;
}
