// DD-47/65, design 17 §8 and 19 §4: existing Installation governance detail.
// Header markup follows Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/ManagedAgentSessionPanel.tsx::SessionHeader.
// These are Core records, not fabricated ACP events or a replacement Transcript.
// DD-170 (.design/20 §16.2): sessions and invocations are tables with a total and local paging over
// a bounded cursor read; a session reads as its time and state, its root event only as an identifier.
import { useEffect, useState } from "react";
import { Clock3, MessagesSquare } from "lucide-react";
import { ReasonCode, type AgentInstallationView, type AgentSessionPage, type AgentSessionView,
  type AgentInvocationPage, type AgentInvocationView } from "@client-kit/contracts";
import type { PlatformMessageKey } from "../../i18n";
import { useBffClient, useLocale, useReasonText, useT } from "../context";
import { TransportError } from "../../transport";
import { type Loaded, useLoad } from "../use-load";
import { Badge, Button, CellStack, DataTable, EmptyState, ErrorState, IdText, TableSkeleton, type DataColumn } from "../ui";
import { RefreshButton } from "../page-layout";
import { TaskDetail } from "../governance";
import { AgentSessionTranscriptView } from "../agent-transcript/AgentSessionPanel";

const sessionLabels = {
  PENDING: "agents.sessions.state.pending", STARTING: "agents.sessions.state.starting",
  ACTIVE: "agents.sessions.state.active", UNKNOWN: "agents.sessions.state.unknown",
  CLOSED: "agents.sessions.state.closed", ABANDONED: "agents.sessions.state.abandoned",
} as const satisfies Record<AgentSessionView["status"], PlatformMessageKey>;
const invocationLabels = {
  CREATED: "agents.invocations.state.created", DISPATCHING: "agents.invocations.state.dispatching",
  RUNNING: "agents.invocations.state.running", UNKNOWN: "agents.invocations.state.unknown",
  COMPLETED: "agents.invocations.state.completed", FAILED: "agents.invocations.state.failed",
  CANCELED: "agents.invocations.state.canceled",
} as const satisfies Record<AgentInvocationView["status"], PlatformMessageKey>;
const recordedTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const nonempty = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function validSessionPage(page: AgentSessionPage, installation: AgentInstallationView,
  cursors: readonly (string | undefined)[]): boolean {
  if (!page || !Array.isArray(page.sessions)) return false;
  const identities = new Set<string>();
  return page.sessions.every(row => {
    if (!row || row.installationResourceId !== installation.resourceId || row.workspaceId !== installation.workspaceId ||
      !nonempty(row.rootEventId) || !Number.isSafeInteger(row.projectionGeneration) || row.projectionGeneration < 1 ||
      !nonempty(row.agentVersionAssetId) || !Object.hasOwn(sessionLabels, row.status) || !recordedTime(row.createdAt) ||
      (row.runtimeThreadId !== undefined && !nonempty(row.runtimeThreadId))) return false;
    const identity = JSON.stringify([row.rootEventId, row.projectionGeneration]);
    if (identities.has(identity)) return false;
    identities.add(identity);
    return true;
  }) && (page.nextCursor === undefined || (nonempty(page.nextCursor) && !cursors.includes(page.nextCursor)));
}

export function validInvocationPage(page: AgentInvocationPage, cursors: readonly (string | undefined)[]): boolean {
  if (!page || !Array.isArray(page.invocations)) return false;
  const ids = new Set<string>();
  return page.invocations.every(row => {
    if (!row || !nonempty(row.invocationId) || ids.has(row.invocationId) || !nonempty(row.actionExecutionId) ||
      !Object.hasOwn(invocationLabels, row.status) || typeof row.cancelPending !== "boolean" || typeof row.canReadTask !== "boolean" ||
      !recordedTime(row.createdAt) || !recordedTime(row.updatedAt) ||
      (row.runtimeTurnId !== undefined && !nonempty(row.runtimeTurnId)) ||
      (row.observation !== undefined && !Object.values(ReasonCode).includes(row.observation))) return false;
    ids.add(row.invocationId);
    return true;
  }) && (page.nextCursor === undefined || (nonempty(page.nextCursor) && !cursors.includes(page.nextCursor)));
}

/** Existing explicit refresh plus real foreground changes; no polling authority. */
function useForegroundRead(reload: () => void) {
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", visible);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    };
  }, [reload]);
}

type CursorCollection<T> = { items: T[]; complete: boolean };

/**
 * DD-170 §16.2(3): an opaque-cursor list read page by page to its end (at most `step` pages per
 * round), so the table can state a total. A repeated or malformed cursor fails the whole read.
 */
function useCursorCollection<T>(key: string, fetchPage: (cursor: string | undefined, seen: readonly (string | undefined)[]) => Promise<{ items: T[]; nextCursor?: string }>,
  step = 10): [Loaded<CursorCollection<T>>, () => void, () => void] {
  const [budget, setBudget] = useState(step);
  const [state, reload] = useLoad(`${key}:pages=${budget}`, async () => {
    const items: T[] = [];
    const seen: (string | undefined)[] = [undefined];
    let cursor: string | undefined;
    for (let page = 0; page < budget; page++) {
      const result = await fetchPage(cursor, seen);
      items.push(...result.items);
      if (result.nextCursor === undefined) return { items, complete: true };
      seen.push(result.nextCursor);
      cursor = result.nextCursor;
    }
    return { items, complete: false };
  }, { keepWhileRevalidating: true });
  return [state, reload, () => setBudget((value) => value + step)];
}

const sessionTones = {
  PENDING: "info", STARTING: "info", ACTIVE: "positive", UNKNOWN: "warning", CLOSED: "neutral", ABANDONED: "neutral",
} as const satisfies Record<AgentSessionView["status"], "info" | "positive" | "warning" | "neutral">;
const sessionIdentity = (row: AgentSessionView) => JSON.stringify([row.rootEventId, row.projectionGeneration]);

function LoadMore({ count, onMore }: { count: number; onMore: () => void }) {
  const t = useT();
  return <>{t("list.partial", { count: String(count) })} <button type="button" className="text-brand-text hover:underline" onClick={onMore}>{t("list.loadMore")}</button></>;
}

export function InstallationSessions({ installation }: { installation: AgentInstallationView }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [selected, setSelected] = useState<string | null>(null);
  // DD-125(6), V-SCN-143: the Codex transcript only for Installation `audit` holders.
  const [transcript, setTranscript] = useState<string | null>(null);
  const [state, reload, loadMore] = useCursorCollection<AgentSessionView>(`agent-sessions:${installation.workspaceId}:${installation.resourceId}`,
    async (cursor, seen) => {
      const page = await client.agentSessions(installation.resourceId, undefined, cursor);
      if (!validSessionPage(page, installation, seen)) throw new TransportError(t("platform.loadFailed"));
      return { items: page.sessions, nextCursor: page.nextCursor };
    });
  useForegroundRead(reload);
  const collection = state.status === "ok" ? state.data : null;
  const sessions = collection && new Set(collection.items.map(sessionIdentity)).size === collection.items.length ? collection.items : null;
  const selectedSession = sessions?.find(row => sessionIdentity(row) === selected);
  const transcriptSession = installation.canAudit === true ? sessions?.find(row => sessionIdentity(row) === transcript) : undefined;
  const time = (value: string) => new Date(value).toLocaleString(locale);
  const columns: DataColumn<AgentSessionView>[] = [
    { key: "session", header: t("agents.sessions.title"), sortValue: row => Date.parse(String(row.createdAt)), cell: row =>
      <CellStack primary={<time dateTime={String(row.createdAt)}>{time(String(row.createdAt))}</time>}
        secondary={<IdText value={row.rootEventId} label={t("agents.sessions.root")} />} /> },
    { key: "state", header: t("agents.ui.col.state"), width: "9rem", sortValue: row => row.status,
      cell: row => <Badge tone={sessionTones[row.status]}>{t(sessionLabels[row.status])}</Badge> },
    { key: "round", header: t("agents.ui.sessions.round"), width: "6rem", align: "end", secondary: true,
      sortValue: row => row.projectionGeneration, cell: row => row.projectionGeneration },
  ];
  return <section className="flex min-w-0 flex-col gap-3" data-testid="agent-installation-sessions">
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h3 className="text-[1.0625rem] font-semibold leading-6 tracking-[-0.012em] text-foreground">{t("agents.sessions.title")}</h3>
        <p className="text-sm text-muted-foreground">{t("agents.ui.sessions.boundary")}</p>
      </div>
      <RefreshButton onClick={reload} pending={state.status === "pending"} />
    </header>
    {state.status === "pending" ? <TableSkeleton rows={3} columns={3} />
      : !sessions ? <ErrorState compact error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <DataTable rows={sessions} rowKey={sessionIdentity} label={t("agents.sessions.title")} columns={columns}
          initialSort={{ key: "session", direction: "desc" }} selectedKey={selected}
          onRowClick={row => { const identity = sessionIdentity(row); setSelected(selected === identity ? null : identity); }}
          rowActionsWidth={installation.canAudit === true ? "9rem" : undefined}
          rowActions={installation.canAudit === true ? row => {
            const identity = sessionIdentity(row);
            return <Button className="h-7 px-2.5 text-xs" aria-expanded={transcript === identity}
              aria-label={t("agentTranscript.sessions.openLabel", { root: row.rootEventId, generation: row.projectionGeneration })}
              onClick={() => setTranscript(transcript === identity ? null : identity)}>
              {t(transcript === identity ? "agentTranscript.sessions.hide" : "agentTranscript.sessions.open")}</Button>;
          } : undefined}
          partial={collection && !collection.complete ? <LoadMore count={sessions.length} onMore={loadMore} /> : undefined}
          empty={<EmptyState compact icon={MessagesSquare} title={t("agents.sessions.empty")} />} />
        {transcriptSession ? <AgentSessionTranscriptView key={transcript ?? ""}
          agentAvatarUrl={null} agentName={installation.agentDisplayName ?? t("agentTranscript.agentFallback")}
          agentPubkey={installation.agentPubkey ?? installation.agentPrincipalId}
          emptyDescription={t("agentTranscript.emptyChannel", { name: installation.agentDisplayName ?? t("agentTranscript.agentFallback") })}
          installation={installation} projectionGeneration={transcriptSession.projectionGeneration}
          rootEventId={transcriptSession.rootEventId} /> : null}
        {selectedSession ? <SessionInvocations key={sessionIdentity(selectedSession)} session={selectedSession} /> : null}
      </>}
  </section>;
}

const invocationTones = {
  CREATED: "info", DISPATCHING: "info", RUNNING: "info", UNKNOWN: "warning", COMPLETED: "positive", FAILED: "negative", CANCELED: "neutral",
} as const satisfies Record<AgentInvocationView["status"], "info" | "positive" | "warning" | "negative" | "neutral">;

function SessionInvocations({ session }: { session: AgentSessionView }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const reasonText = useReasonText();
  const [open, setOpen] = useState<{ root: string; current: string } | null>(null);
  const [state, reload, loadMore] = useCursorCollection<AgentInvocationView>(
    `agent-invocations:${session.workspaceId}:${session.installationResourceId}:${session.rootEventId}:${session.projectionGeneration}`,
    async (cursor, seen) => {
      const page = await client.agentInvocations(session.installationResourceId, session.rootEventId, session.projectionGeneration, cursor);
      if (!validInvocationPage(page, seen)) throw new TransportError(t("platform.loadFailed"));
      return { items: page.invocations, nextCursor: page.nextCursor };
    });
  useForegroundRead(reload);
  const collection = state.status === "ok" ? state.data : null;
  const invocations = collection && new Set(collection.items.map(row => row.invocationId)).size === collection.items.length ? collection.items : null;
  const status = (row: AgentInvocationView) => row.observation !== undefined ? reasonText(row.observation)
    : row.status === "UNKNOWN" ? t("agents.invocations.state.unknown")
    : row.cancelPending ? t("agents.invocations.cancelPending") : t(invocationLabels[row.status]);
  const columns: DataColumn<AgentInvocationView>[] = [
    { key: "updated", header: t("agents.invocations.id"), sortValue: row => Date.parse(String(row.updatedAt)), cell: row =>
      <CellStack primary={<time dateTime={String(row.updatedAt)}>{new Date(String(row.updatedAt)).toLocaleString(locale)}</time>}
        secondary={<IdText value={row.invocationId} label={t("agents.invocations.id")} />} /> },
    { key: "state", header: t("agents.ui.col.state"), width: "12rem", cell: row =>
      <Badge tone={row.observation !== undefined || row.status === "UNKNOWN" || row.cancelPending ? "warning" : invocationTones[row.status]}>{status(row)}</Badge> },
    { key: "turn", header: t("agents.invocations.turn"), width: "10rem", secondary: true, cell: row => row.runtimeTurnId
      ? <IdText value={row.runtimeTurnId} label={t("agents.invocations.turn")} /> : <span className="text-muted-foreground">{t("agents.sessions.unrecorded")}</span> },
  ];
  return <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4" data-testid="agent-session-invocations">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold tracking-tight">{t("agents.invocations.title")}</h4>
          <Badge tone="neutral"><Clock3 aria-hidden className="mr-1 inline h-3.5 w-3.5" />{t(sessionLabels[session.status])}</Badge>
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-muted-foreground">{t("agents.sessions.thread")}:{" "}
          {session.runtimeThreadId ? <IdText value={session.runtimeThreadId} label={t("agents.sessions.thread")} /> : t("agents.sessions.unrecorded")}</p>
      </div>
      <RefreshButton onClick={() => { setOpen(null); reload(); }} pending={state.status === "pending"} />
    </div>
    {state.status === "pending" ? <TableSkeleton rows={2} columns={3} />
      : !invocations ? <ErrorState compact error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : open && invocations.some(row => row.actionExecutionId === open.root && row.canReadTask === true) ?
        <TaskDetail key={open.current} actionExecutionId={open.current} onBack={() => setOpen(null)}
          onOpen={current => setOpen({ root: open.root, current })} />
      : <DataTable rows={invocations} rowKey={row => row.invocationId} label={t("agents.invocations.title")} columns={columns}
          initialSort={{ key: "updated", direction: "desc" }} rowActionsWidth="10rem"
          rowActions={row => row.canReadTask === true
            ? <Button className="h-7 px-2.5 text-xs" onClick={() => setOpen({ root: row.actionExecutionId, current: row.actionExecutionId })}>{t("tasks.execution")}</Button>
            : <IdText value={row.actionExecutionId} label={t("tasks.execution")} />}
          partial={collection && !collection.complete ? <LoadMore count={invocations.length} onMore={loadMore} /> : undefined}
          empty={<EmptyState compact icon={Clock3} title={t("agents.ui.invocations.empty")} />} />}
  </div>;
}
