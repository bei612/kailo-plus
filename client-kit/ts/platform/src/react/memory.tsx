// DD-66/68, 19 §5/7: both TS hosts use this same governed Memory surface.
// Decrypted bodies stay in the mounted view, never local storage or telemetry.
// DD-170 (.design/20 §16): memory is read only on the explicit "Read memory" action; the cold list
// states its size and pages locally, each body shows its state in words and its head only as a
// technical identifier; removing an entry is confirmed in a dialog.
import {
  ActionDispatchState, ActionGateState, AgentInstallationState, ErrorClass, AgentMemoryWriteInputExpectedHeadState,
  PlatformSessionAccessMode, ReasonCode, ResourceState, TaskStatus,
  type ActionCommand, type ActionSubmission, type AgentInstallationView,
  type AgentMemoryReadView, type AgentMemoryEntryPage,
  type AgentMemoryWriteInput, type TaskView,
} from "@client-kit/contracts";
import { AlertTriangle, Brain } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { newIdempotencyKey, taskPhase } from "../governance";
import { platformPluralForm } from "../i18n";
import { BffError, TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, ConfirmDialog, DetailSkeleton, EmptyState, ErrorState, Pagination, usePaged } from "./ui";
import { RefreshButton } from "./page-layout";
import { SectionCard, TechnicalDetails } from "./agents/detail-kit";
import { useLoad } from "./use-load";
import { orderMemoryEntries, type MemoryListEntry } from "./memory-order";

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

// Original `validate_slug`: a `[[slug]]` ref names `core` or a cold `mem/...` slug.
const refSlug = (value: unknown): value is string => typeof value === "string" && (value === "core" || coldSlug(value));
const refList = (value: unknown, unique = true): value is string[] => Array.isArray(value) && value.every(refSlug)
  && (!unique || new Set(value).size === value.length);

// DD-125(10): refs exist only for a COMPLETE listing; core's refs only when core exists.
function validMemoryReferences(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const { coreExists, coreRefs, dangling } = value as Partial<NonNullable<AgentMemoryEntryPage["references"]>>;
  return typeof coreExists === "boolean" && refList(coreRefs) && (coreExists || coreRefs.length === 0)
    && Array.isArray(dangling) && new Set(dangling.map((ref) => ref?.slug)).size === dangling.length
    && dangling.every((ref) => !!ref && refSlug(ref.slug) && refList(ref.referencedBy) && ref.referencedBy.length > 0);
}

export function validMemoryEntries(value: AgentMemoryEntryPage, installation: string, workspace: string): boolean {
  if (!value || value.installationResourceId !== installation || value.workspaceId !== workspace
    || typeof value.operationId !== "string" || !value.operationId || !Array.isArray(value.entries)) return false;
  if (value.state === "UNKNOWN" || value.state === "BOUND_EXCEEDED") return value.entries.length === 0 && value.references === undefined;
  if (value.state !== "COMPLETE") return false;
  if (value.references !== undefined && !validMemoryReferences(value.references)) return false;
  const slugs = new Set<string>();
  return value.entries.every((entry) => {
    if (!entry || typeof entry.slug !== "string" || !coldSlug(entry.slug) || slugs.has(entry.slug)
      || !eventId(entry.eventId) || !timestamp(entry.createdAt) || typeof entry.tombstone !== "boolean") return false;
    // Tombstones take no part in ref extraction; a live entry's refs are a unique slug list.
    if (entry.outgoingRefs !== undefined && (!refList(entry.outgoingRefs) || (entry.tombstone && entry.outgoingRefs.length > 0))) return false;
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
  return <section className="flex min-w-0 flex-col gap-3" data-testid="agent-memory">
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h4 className="text-[1.0625rem] font-semibold leading-6 tracking-[-0.012em] text-foreground">{t("agents.memory.title")}</h4>
        <p className="text-sm text-muted-foreground">{t(installation ? "agents.ui.memory.governed" : "agents.ui.memory.readOnly")}</p>
      </div>
      <Button disabled={locked} aria-expanded={open} onClick={() => setOpen(!open)}>
        {t(open ? "agents.memory.close" : "agents.memory.open")}
      </Button>
    </header>
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
  // DD-125(10): only a COMPLETE listing carries refs; BOUND_EXCEEDED/UNKNOWN keep their
  // determinate state and slug order, with no inferred missing links or "no core".
  const order = useMemo(() => page?.state === "COMPLETE" && page.references
    ? orderMemoryEntries(page.entries, page.references) : null, [page]);
  const coreMissingLinks = order?.missingLinks.get("core") ?? [];
  const onEdit = canWrite && !edit && !requestBlocked ? (read: AgentMemoryReadView, mode: MemoryEdit["mode"]) => {
    setEdit({ read, mode }); onLocked(true);
  } : undefined;
  const finish = (refresh: boolean) => {
    setEdit(null); onLocked(false);
    if (refresh) { setRound((value) => value + 1); reload(); reloadTasks(); reloadSession(); }
  };
  const listed = order?.entries ?? (page?.state === "COMPLETE" ? page.entries : []);
  const paged = usePaged(listed);
  return <>
    {installation && session.status === "error" ? <ErrorState compact error={session.error} onRetry={reloadSession} /> : null}
    <SectionCard testId="agent-memory-core">
      <div className="flex flex-col gap-0.5">
        <h5 className="text-sm font-semibold">{t("agents.memory.core")}</h5>
        <p className="text-sm text-muted-foreground">{t("agents.ui.memory.newSessions")}</p>
      </div>
      <MemoryBody key={`core:${round}`} resourceId={resourceId} workspaceId={workspaceId} slug="core" onEdit={onEdit} />
      {coreMissingLinks.length ? <MemoryDanglingRefsHint slugs={coreMissingLinks} /> : null}
    </SectionCard>
    <div className="flex flex-col gap-3" data-testid="agent-memory-cold">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-sm font-semibold">{t("agents.memory.cold")}</h5>
        <RefreshButton onClick={reload} pending={state.status === "pending"} />
      </div>
      {state.status === "pending" ? <DetailSkeleton lines={3} />
        : !page ? <ErrorState compact error={state.status === "error" ? state.error : undefined} onRetry={reload} />
        : page.state !== "COMPLETE" ? <p role="status" className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
            {t(page.state === "BOUND_EXCEEDED" ? "agents.ui.memory.boundExceeded" : "agents.ui.memory.unknown")}</p>
        : page.entries.length === 0 ? <EmptyState compact icon={Brain} title={t("agents.ui.memory.emptyTitle")} description={t("agents.ui.memory.emptyBody")} />
        : <>
          {order && !order.coreExists && page.entries.some((entry) => !entry.tombstone) ? <MemoryNoCoreHint /> : null}
          <div className="space-y-2" data-testid="agent-memory-list">
            {paged.pageRows.map((entry) => <MemoryEntryAccordion key={`${round}:${entry.eventId}`} entry={entry}
              missingLinks={order?.missingLinks.get(entry.slug) ?? []}
              resourceId={resourceId} workspaceId={workspaceId} onEdit={onEdit} />)}
          </div>
          <Pagination testId="agent-memory-pagination" total={paged.total} page={paged.page} pageSize={paged.pageSize}
            onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize} />
        </>}
    </div>
    {canWrite ? <>
      <form className="flex flex-col gap-2" onSubmit={(event) => {
        event.preventDefault(); if (!edit && coldSlug(slugInput)) setNewSlug(slugInput);
      }}>
        <label className="flex flex-col gap-1 text-sm">{t("agents.ui.memory.openByName")}
          <input value={slugInput} disabled={!!edit} onChange={(event) => setSlugInput(event.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2" />
        </label>
        <Button type="submit" className="w-fit" disabled={!!edit || !coldSlug(slugInput)}>{t("agents.memory.readEntry")}</Button>
      </form>
      {newSlug ? <MemoryBody key={`${round}:${newSlug}`} resourceId={resourceId} workspaceId={workspaceId} slug={newSlug} onEdit={onEdit} /> : null}
      {!taskRows ? <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{t("agents.inFlightUnavailable")}
          <Button onClick={reloadTasks}>{t("platform.retry")}</Button></div>
        : pending.length ? <div role="status" className="flex flex-col gap-1 rounded-lg bg-muted/50 p-3 text-sm">
          <p>{t("agents.memory.inFlight")}</p>{pending.map((task) => <p className="break-words" key={task.actionExecutionId}>
            {t(task.dispatchState === ActionDispatchState.Unknown ? "tasks.status.unknown" : taskPhase(task).label)} · {task.operationId}
          </p>)}<Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button>
        </div> : null}
    </> : null}
    {edit && installation ? <MemoryEditor key={`${edit.read.operationId}:${edit.mode}`} edit={edit}
      installation={installation} canWrite={canWrite} requestBlocked={requestBlocked} onFinished={finish} /> : null}
  </>;
}

// Buzz MemorySection::MemoryEntryAccordion's existing article/disclosure shape;
// the native local-key/query-cache hook is replaced by an explicit BFF read.
// Collapsing unmounts its decrypted body; no cross-view plaintext cache.
function MemoryEntryAccordion({ entry, missingLinks, resourceId, workspaceId, onEdit }: {
  entry: MemoryListEntry; missingLinks: string[]; resourceId: string; workspaceId: string;
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
        <div className="text-sm font-semibold text-foreground">
          {missingLinks.length ? <AlertTriangle aria-hidden="true" data-testid="agent-memory-dangling-icon"
            className="mr-1 inline-block h-4 w-4 align-[-2px] text-warning" /> : null}
          <MemorySlugTitle slug={entry.slug} />
        </div>
        <div className="mt-1 text-xs leading-5 text-foreground/70">
          {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(entry.createdAt * 1000)}
          {" · "}{t(entry.tombstone ? "agents.ui.memory.deleted" : "agents.ui.memory.saved")}
        </div>
      </div></div>
    </button>
    {open ? <div className="px-4 pb-3">
      {missingLinks.length ? <MemoryDanglingRefsHint slugs={missingLinks} /> : null}
      <MemoryBody resourceId={resourceId} workspaceId={workspaceId} slug={entry.slug} onEdit={onEdit} />
    </div> : null}
  </article>;
}

// Original MemoryGraphView "no core" line: shown only when memories exist without a core.
function MemoryNoCoreHint() {
  const t = useT();
  const [before, after = ""] = t("agents.memory.noCore", { core: "\u0000" }).split("\u0000");
  return <p className="text-xs italic text-muted-foreground" data-testid="agent-memory-no-core">
    {before}<code className="font-mono text-2xs">core</code>{after}
  </p>;
}

// Original MemoryDanglingRefsHint: the refs of this memory that no loaded memory answers.
function MemoryDanglingRefsHint({ slugs }: { slugs: string[] }) {
  const t = useT();
  const locale = useLocale();
  return <div className="mb-2 rounded-xl bg-warning/5 px-2.5 py-2 text-xs leading-5" data-testid="agent-memory-dangling-hint">
    <p className="text-warning">
      {t(`agents.memory.missingLink.${platformPluralForm(locale, slugs.length)}`)}{" "}
      {slugs.map((slug, index) => <Fragment key={slug}>
        {index > 0 ? ", " : null}
        <span className="break-all text-warning" data-testid="agent-memory-dangling-ref">[[{slug}]]</span>
      </Fragment>)}
    </p>
    <p className="mt-0.5 text-foreground/50">{t("agents.memory.missingLinkHint")}</p>
  </div>;
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
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex min-w-0 flex-wrap items-center gap-2 text-sm"><MemorySlugTitle slug={slug} />
        {value ? <Badge tone={value.state === "FOUND" ? "positive" : value.state === "ABSENT" ? "neutral" : "warning"}>
          {t(value.state === "FOUND" ? "agents.ui.memory.found" : value.state === "ABSENT" ? "agents.ui.memory.absent" : "agents.ui.memory.unreadable")}</Badge> : null}</span>
      <RefreshButton onClick={reload} pending={state.status === "pending"} />
    </div>
    {state.status === "pending" ? <DetailSkeleton lines={2} />
      : !value ? <ErrorState compact error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {value.state === "FOUND" ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-3 font-sans text-sm leading-6">{value.content}</pre> : null}
        {onEdit && value.state !== "UNREADABLE" ? <div className="flex flex-wrap gap-2">
          <Button onClick={() => onEdit(value, "value")}>{t(slug === "core" ? "agents.memory.replace" : "agents.memory.set")}</Button>
          {slug !== "core" && value.state === "FOUND" ? <>
            {eventId(value.valueHash) ? <Button onClick={() => onEdit(value, "patch")}>{t("agents.ui.memory.patch")}</Button> : null}
            <Button onClick={() => onEdit(value, "remove")}>{t("agents.ui.memory.deleteEntry")}</Button>
          </> : null}
        </div> : null}
        <TechnicalDetails items={[{ id: "head", label: t("agents.ui.memory.head"), value: value.eventId }]} />
      </>}
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
  const title = edit.read.slug === "core" ? "agents.memory.replace" : edit.mode === "patch" ? "agents.ui.memory.patch"
    : edit.mode === "remove" ? "agents.ui.memory.deleteEntry" : "agents.memory.set";
  const build = (): ActionCommand | null => {
    if (intent || busy || !canWrite || requestBlocked
      || !validMemoryRead(edit.read, installation.resourceId, installation.workspaceId, edit.read.slug)
      || edit.read.state === "UNREADABLE"
      || (edit.mode !== "value" && edit.read.state !== "FOUND")
      || (edit.mode === "patch" && (!patch || !eventId(edit.read.valueHash)))) return null;
    const memoryWrite: AgentMemoryWriteInput = {
      slug: edit.read.slug,
      expectedHeadState: edit.read.state === "FOUND" ? AgentMemoryWriteInputExpectedHeadState.Found : AgentMemoryWriteInputExpectedHeadState.Absent,
      expectedHeadEventId: edit.read.eventId ?? null,
    };
    if (edit.mode === "value") memoryWrite.value = value;
    if (edit.mode === "patch") { memoryWrite.patch = patch; memoryWrite.baseHash = edit.read.valueHash; }
    return { actionKey, idempotencyKey: newIdempotencyKey(), resourceId: installation.resourceId,
      resourceVersion: installation.resourceVersion, workspaceId: installation.workspaceId, memoryWrite };
  };
  const prepare = () => { const command = build(); if (command) setIntent(command); };
  // `frozen` is the exact intent: the review's, or the removal confirmation's just-frozen command.
  const submit = async (frozen: ActionCommand | null = intent) => {
    if (!frozen || inFlight.current || !canWrite) return;
    inFlight.current = true; setBusy(true); setFailure(null); setSubmission(null);
    try {
      const result = await client.submitAction(frozen);
      // These four registered HUMAN actions are SYNC/NONE/noApproval. A
      // different/unknown protocol result cannot unlock a replacement intent.
      if (!result || result.actionKey !== frozen.actionKey
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
  const removed = edit.mode === "remove" && !intent && submission !== null && memoryOutcomeKnown(submission)
    && submission.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.Dispatched && submission.reason === undefined;
  const finished = useRef(onFinished);
  finished.current = onFinished;
  // A settled removal closes its confirmation and re-reads the list.
  useEffect(() => { if (removed) finished.current(true); }, [removed]);
  if (edit.mode === "remove") {
    // DD-170 §16.6: removing writes a tombstone — a ConfirmDialog naming the entry. Submitting keeps it
    // open; an UNKNOWN outcome keeps the same frozen request and only re-checks it, never a new key.
    const confirm = () => {
      if (busy) return;
      if (intent) { void submit(); return; }
      if (decided) { onFinished(true); return; }
      const command = build();
      if (!command) return;
      setIntent(command);
      void submit(command);
    };
    return <ConfirmDialog open testId="agent-memory-remove" pending={busy}
      onOpenChange={(open) => { if (!open && !busy && !unknown) onFinished(decided); }}
      title={t("agents.ui.memory.removeTitle", { slug: edit.read.slug })} description={t("agents.ui.memory.removeBody")}
      confirmLabel={unknown ? t("agents.retry") : decided ? t("agents.ui.close") : t("agents.ui.memory.delete")} onConfirm={confirm}>
      {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
        : submission.reason ? reasonText(submission.reason) : t("agents.memory.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}</p> : null}
      {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="break-words text-sm">{failure.kind === "unknown"
        ? t("agents.unknown", { operation: failure.operationId ?? "" }) : failureText(failure)}</p> : null}
      {requestBlocked && !intent && !decided ? <p role="status" className="text-sm text-muted-foreground">{t("agents.memory.inFlight")}</p> : null}
    </ConfirmDialog>;
  }
  return <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4" data-testid="agent-memory-editor">
    <h5 className="text-sm font-semibold">{t(title)}</h5>
    <p className="break-words text-sm"><MemorySlugTitle slug={edit.read.slug} /></p>
    {!intent && !decided ? <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      <label className="flex flex-col gap-1 text-sm">{t(edit.mode === "patch" ? "agents.ui.memory.patchText" : "agents.memory.value")}
        <textarea value={edit.mode === "patch" ? patch : value}
          onChange={(event) => edit.mode === "patch" ? setPatch(event.target.value) : setValue(event.target.value)}
          className="min-h-40 rounded-md border border-input bg-background p-2 text-sm" />
      </label>
      <TechnicalDetails items={[{ id: "head", label: t("agents.ui.memory.head"), value: edit.read.eventId },
        { id: "base", label: t("agents.memory.baseHash"), value: edit.mode === "patch" ? edit.read.valueHash : undefined }]} />
      <div className="flex gap-2"><Button type="submit" disabled={!canWrite || requestBlocked || (edit.mode === "patch" && !patch)}>{t("agents.review")}</Button>
        <Button onClick={() => onFinished(false)}>{t("agents.cancel")}</Button></div>
    </form> : intent ? <div className="flex flex-col gap-2 text-sm" role="group">
      <p>{t("agents.ui.memory.review")}</p>
      <div className="flex gap-2"><Button disabled={busy || !canWrite} onClick={() => void submit()}>
        {busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}
      </Button>{!busy && !unknown ? <Button onClick={() => onFinished(false)}>{t("agents.cancel")}</Button> : null}</div>
    </div> : <Button className="w-fit" onClick={() => onFinished(true)}>{t("platform.refresh")}</Button>}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.memory.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}
      {submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="break-words text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "" }) : failureText(failure)}</p> : null}
  </section>;
}
