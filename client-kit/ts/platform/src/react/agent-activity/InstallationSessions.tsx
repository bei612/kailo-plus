// DD-47/65, design 17 §8 and 19 §4: existing Installation governance detail.
// Header markup follows Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/agents/ui/ManagedAgentSessionPanel.tsx::SessionHeader.
// These are Core records, not fabricated ACP events or a replacement Transcript.
import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { ReasonCode, type AgentInstallationView, type AgentSessionPage, type AgentSessionView,
  type AgentInvocationPage, type AgentInvocationView } from "@client-kit/contracts";
import type { PlatformMessageKey } from "../../i18n";
import { useBffClient, useLocale, useReasonText, useT } from "../context";
import { useLoad } from "../use-load";
import { Badge, Button, Cell, Notice, ReadFailure, Table } from "../ui";
import { TaskDetail } from "../governance";

const sessionLabels = {
  PENDING: "agents.sessions.state.pending", STARTING: "agents.sessions.state.starting",
  ACTIVE: "agents.sessions.state.active", UNKNOWN: "agents.sessions.state.unknown",
  CLOSED: "agents.sessions.state.closed",
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

export function InstallationSessions({ installation }: { installation: AgentInstallationView }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const cursor = cursors[index];
  const [state, reload] = useLoad(`agent-sessions:${installation.workspaceId}:${installation.resourceId}:${cursor ?? ""}`,
    () => client.agentSessions(installation.resourceId, undefined, cursor));
  useForegroundRead(reload);
  const page = state.status === "ok" && validSessionPage(state.data, installation, cursors.slice(0, index + 1)) ? state.data : null;
  const selectedSession = page?.sessions.find(row => JSON.stringify([row.rootEventId, row.projectionGeneration]) === selected);
  return <section className="mt-4 space-y-3" data-testid="agent-installation-sessions">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><h3 className="text-sm font-semibold tracking-tight">{t("agents.sessions.title")}</h3></div>
        <p className="mt-1 text-sm text-muted-foreground">{t("agents.sessions.boundary")}</p>
      </div>
      <Button onClick={reload}>{t("platform.refresh")}</Button>
    </div>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice> : !page ?
      <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} /> : <>
        {page.sessions.length === 0 ? <Notice>{t("agents.sessions.empty")}</Notice> :
          <Table head={[t("agents.sessions.root"), t("agents.installation.generation"), t("agents.sessions.recordedState"), t("agents.sessions.created")]}>
            {page.sessions.map(row => {
              const identity = JSON.stringify([row.rootEventId, row.projectionGeneration]);
              return <tr key={identity}>
                <Cell mono><Button aria-expanded={selected === identity}
                  aria-label={t("agents.sessions.open", { root: row.rootEventId, generation: row.projectionGeneration })}
                  onClick={() => setSelected(selected === identity ? null : identity)}>{row.rootEventId}</Button></Cell>
                <Cell>{row.projectionGeneration}</Cell>
                <Cell><Badge tone="neutral">{t(sessionLabels[row.status])}</Badge></Cell>
                <Cell><time dateTime={String(row.createdAt)}>{new Date(String(row.createdAt)).toLocaleString(locale)}</time></Cell>
              </tr>;
            })}
          </Table>}
        <div className="flex gap-2">
          {index > 0 ? <Button onClick={() => { setSelected(null); setIndex(index - 1); }}>{t("roles.previous")}</Button> : null}
          {page.nextCursor !== undefined ? <Button onClick={() => {
            setSelected(null); setCursors(old => [...old.slice(0, index + 1), page.nextCursor]); setIndex(index + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
        {selectedSession ? <SessionInvocations key={JSON.stringify([selectedSession.rootEventId, selectedSession.projectionGeneration])} session={selectedSession} /> : null}
      </>}
  </section>;
}

function SessionInvocations({ session }: { session: AgentSessionView }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const reasonText = useReasonText();
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState<{ root: string; current: string } | null>(null);
  const cursor = cursors[index];
  const [state, reload] = useLoad(`agent-invocations:${session.workspaceId}:${session.installationResourceId}:${session.rootEventId}:${session.projectionGeneration}:${cursor ?? ""}`,
    () => client.agentInvocations(session.installationResourceId, session.rootEventId, session.projectionGeneration, cursor));
  useForegroundRead(reload);
  const page = state.status === "ok" && validInvocationPage(state.data, cursors.slice(0, index + 1)) ? state.data : null;
  return <div className="space-y-3" data-testid="agent-session-invocations">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold tracking-tight">{t("agents.invocations.title")}</h3>
          <Badge tone="neutral"><Clock3 aria-hidden className="mr-1 inline h-4 w-4" />{t(sessionLabels[session.status])}</Badge>
        </div>
        <p className="mt-1 break-all text-sm text-muted-foreground">{t("agents.sessions.thread")}: {session.runtimeThreadId ?? t("agents.sessions.unrecorded")}</p>
      </div>
      <Button onClick={() => { setOpen(null); reload(); }}>{t("platform.refresh")}</Button>
    </div>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice> : !page ?
      <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} /> : <>
        {open && page.invocations.some(row => row.actionExecutionId === open.root && row.canReadTask === true) ?
          <TaskDetail key={open.current} actionExecutionId={open.current} onBack={() => setOpen(null)}
            onOpen={current => setOpen({ root: open.root, current })} /> : <>
            {page.invocations.length === 0 ? <Notice>{t("agents.invocations.empty")}</Notice> :
              <Table head={[t("agents.invocations.id"), t("agents.sessions.recordedState"), t("agents.invocations.turn"), t("agents.sessions.updated"), t("tasks.execution")]}>
                {page.invocations.map(row => <tr key={row.invocationId}>
                  <Cell mono>{row.invocationId}</Cell>
                  <Cell><Badge tone="neutral">{row.observation !== undefined ? reasonText(row.observation) :
                    row.status === "UNKNOWN" ? t("agents.invocations.state.unknown") :
                      row.cancelPending ? t("agents.invocations.cancelPending") : t(invocationLabels[row.status])}</Badge></Cell>
                  <Cell mono>{row.runtimeTurnId ?? t("agents.sessions.unrecorded")}</Cell>
                  <Cell><time dateTime={String(row.updatedAt)}>{new Date(String(row.updatedAt)).toLocaleString(locale)}</time></Cell>
                  <Cell>{row.canReadTask === true ? <Button onClick={() => setOpen({ root: row.actionExecutionId, current: row.actionExecutionId })}>{t("tasks.execution")}</Button> :
                    <span className="break-all font-mono text-xs">{row.actionExecutionId}</span>}</Cell>
                </tr>)}
              </Table>}
            <div className="flex gap-2">
              {index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
              {page.nextCursor !== undefined ? <Button onClick={() => {
                setCursors(old => [...old.slice(0, index + 1), page.nextCursor]); setIndex(index + 1);
              }}>{t("roles.next")}</Button> : null}
            </div>
          </>}
      </>}
  </div>;
}
