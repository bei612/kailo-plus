// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/agents/ui/TeamSnapshotExportDialog.tsx::TeamSnapshotExportDialog.
// DD-131(3)、DD-42、05 §2.12：原版团队“导出”对话框。原版本地直接写文件；Kailo 的导出是受治理的
// agent.team.export：Team owner 与各成员 Definition owner 都批准（各自可自批）后，由 Core 按各成员
// 当前已发布版本生成源 Tenant 的 ExportPackage 并冻结 digest，READY 后才可下载。原版的记忆选项不提供
// （DD-131(4)），固定为“仅团队”；团队 instructions 不进入包。一次导出只冻结一个幂等键，结果不明只能以
// 同一请求重试。视觉只用 DD-141 Kailo 令牌与 client-kit 基础组件。
import {
  ActionDispatchState,
  ActionGateState,
  AgentSnapshotMediaType,
  ExportPackageState,
  ReasonCode,
  type ActionCommand,
  type ActionSubmission,
  type ExportPackageView,
} from "@client-kit/contracts";
import { Brain, Download, FileType2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "../../governance";
import { TransportError, type WriteFailure, writeFailure } from "../../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "../context";
import { Button } from "../ui";
import { AgentManagementDialog } from "./AgentManagementDialog";
import { browserSnapshotExportHost, type SnapshotExportHost } from "./AgentSnapshotExportDialog";
import { SnapshotSendPanel } from "./SnapshotSendPanel";

/** DD-141 primary action on the shared Button: brand fill, theme tokens only. */
const PRIMARY = "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground";
const POLL_MS = 2500;

export type TeamSnapshotExportTarget = { resourceId: string; resourceVersion: number; name: string };

type ReadyView = ExportPackageView & { downloadPath: string; fileName: string };

/** A team package view is only trusted for this exact export; it has no single source version. */
export function validTeamExportView(view: ExportPackageView | undefined, actionExecutionId: string,
  target: TeamSnapshotExportTarget): view is ExportPackageView {
  return !!view && view.actionExecutionId === actionExecutionId && view.sourceResourceId === target.resourceId
    && typeof view.packageAssetId === "string" && !!view.packageAssetId
    && view.formatKey === "buzz-team-snapshot@1" && view.sourceAssetId === undefined
    && Object.values(ExportPackageState).includes(view.state)
    && (view.state !== ExportPackageState.Ready || (/^[0-9a-f]{64}$/.test(view.contentDigest ?? "")
      && typeof view.fileName === "string" && !!view.fileName
      && view.downloadPath === `/api/v1/export-packages/${view.packageAssetId}/content`));
}

function validSubmission(result: ActionSubmission | undefined, intent: ActionCommand, previous: ActionSubmission | null): result is ActionSubmission {
  return !!result && result.actionKey === intent.actionKey && typeof result.actionExecutionId === "string" && !!result.actionExecutionId
    && typeof result.operationId === "string" && !!result.operationId
    && Object.values(ActionGateState).includes(result.gateState)
    && Object.values(ActionDispatchState).includes(result.dispatchState)
    && (result.reason === undefined || Object.values(ReasonCode).includes(result.reason))
    && (!previous || (result.actionExecutionId === previous.actionExecutionId && result.operationId === previous.operationId))
    && !(result.gateState === ActionGateState.Denied && !result.reason);
}

type Phase =
  | { kind: "choose" }
  | { kind: "submitted"; submission: ActionSubmission }
  | { kind: "ready"; submission: ActionSubmission; view: ReadyView }
  | { kind: "failed"; submission: ActionSubmission };

export function TeamSnapshotExportDialog({ target, onClose, host = browserSnapshotExportHost }: {
  target: TeamSnapshotExportTarget | null; onClose: () => void; host?: SnapshotExportHost;
}) {
  const t = useT();
  const [locked, setLocked] = useState(false);
  return <AgentManagementDialog open={target !== null} title={t("agents.export.title", { name: target?.name ?? "" })}
    locked={locked} onClose={onClose} dataTestId="team-snapshot-export-dialog">
    {target ? <ExportBody key={`${target.resourceId}:${target.resourceVersion}`} target={target}
      host={host} onClose={onClose} onLockedChange={setLocked} /> : null}
  </AgentManagementDialog>;
}

function ExportBody({ target, host, onClose, onLockedChange }: {
  target: TeamSnapshotExportTarget; host: SnapshotExportHost; onClose: () => void; onLockedChange: (locked: boolean) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [format, setFormat] = useState<AgentSnapshotMediaType>(AgentSnapshotMediaType.ImagePng);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "choose" });
  const [saving, setSaving] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const inFlight = useRef(false);
  const submission = phase.kind === "choose" ? null : phase.submission;
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating;
  const waiting = phase.kind === "submitted" && !unknown && (submission?.gateState === ActionGateState.Waiting
    || submission?.gateState === ActionGateState.Allowed);
  useEffect(() => { onLockedChange(busy || unknown || sendBusy); }, [busy, unknown, sendBusy, onLockedChange]);

  const submit = async () => {
    if (inFlight.current) return;
    const command: ActionCommand = intent ?? {
      actionKey: "agent.team.export", idempotencyKey: newIdempotencyKey(),
      resourceId: target.resourceId, resourceVersion: target.resourceVersion,
      agentTeamExport: { mediaType: format },
    } as ActionCommand;
    setIntent(command);
    inFlight.current = true; setBusy(true);
    try {
      const result = await client.submitAction(command);
      if (!validSubmission(result, command, submission)) throw new TransportError(t("platform.loadFailed"));
      setFailure(null);
      setPhase(result.gateState === ActionGateState.Denied || result.gateState === ActionGateState.Expired
        || result.gateState === ActionGateState.Revoked ? { kind: "failed", submission: result } : { kind: "submitted", submission: result });
    } catch (error) {
      const failed = writeFailure(error);
      setFailure(failed);
      if (failed.kind !== "unknown") setIntent(null);
    } finally { inFlight.current = false; setBusy(false); }
  };

  // While every affected owner decides (and after admission) the package appears under this execution.
  // 404 means "not prewritten yet": keep waiting, never infer success or failure from absence.
  useEffect(() => {
    if (phase.kind !== "submitted" || unknown) return;
    const executionId = phase.submission.actionExecutionId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const view = await client.exportPackageByAction(executionId);
        if (cancelled) return;
        if (!validTeamExportView(view, executionId, target)) throw new TransportError(t("platform.loadFailed"));
        if (view.state === ExportPackageState.Ready && view.downloadPath && view.fileName) {
          setPhase({ kind: "ready", submission: phase.submission, view: { ...view, downloadPath: view.downloadPath, fileName: view.fileName } });
          return;
        }
        if (view.state !== ExportPackageState.Creating) { setPhase({ kind: "failed", submission: phase.submission }); return; }
      } catch {
        if (cancelled) return;
      }
      if (!cancelled) timer = setTimeout(() => void poll(), POLL_MS);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [client, phase, target, unknown, t]);

  const save = async () => {
    if (phase.kind !== "ready" || saving) return;
    setSaving(true); setSaveFailed(false);
    try { await host.save(phase.view); } catch { setSaveFailed(true); } finally { setSaving(false); }
  };

  return <div className="flex flex-col gap-4 py-1 text-sm" data-testid="team-snapshot-export-body">
    <dl className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <dt className="flex items-center gap-2 font-medium"><Brain aria-hidden className="h-4 w-4 text-muted-foreground" />{t("agents.export.memories")}</dt>
        <dd className="text-muted-foreground" data-testid="team-snapshot-export-memory">{t("teamSnapshot.teamOnly")}</dd>
      </div>
      <div className="flex min-h-8 items-center justify-between gap-4">
        <dt className="flex items-center gap-2 font-medium"><FileType2 aria-hidden className="h-4 w-4 text-muted-foreground" />
          <label htmlFor="team-snapshot-export-format">{t("agents.export.format")}</label></dt>
        <dd><select id="team-snapshot-export-format" value={format} disabled={phase.kind !== "choose" || busy || intent !== null}
          onChange={(event) => setFormat(event.target.value as AgentSnapshotMediaType)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs" data-testid="team-snapshot-export-format">
          <option value={AgentSnapshotMediaType.ImagePng}>PNG</option>
          <option value={AgentSnapshotMediaType.ApplicationJson}>JSON</option>
        </select></dd>
      </div>
    </dl>
    <p className="text-xs text-muted-foreground">{t("teamSnapshot.exportBoundary")}</p>
    {phase.kind === "choose" ? <div className="flex flex-wrap justify-end gap-2" data-testid="team-snapshot-export-footer">
      {!busy && !unknown ? <Button onClick={onClose}>{t("agents.cancel")}</Button> : null}
      <Button className={PRIMARY} disabled={busy} onClick={() => void submit()} data-testid="team-snapshot-export-confirm">
        <Download aria-hidden className="h-4 w-4" />
        {busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.export.export")}</Button>
    </div> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"}>{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" })
      : t("agents.rejected", { reason: failureText(failure) })}</p> : null}
    {phase.kind === "submitted" && unknown ? <div className="flex flex-col gap-2">
      <p role="status">{t("agents.unknown", { operation: phase.submission.operationId })}</p>
      <Button className="w-fit" disabled={busy} onClick={() => void submit()}>{t("agents.retry")}</Button>
    </div> : null}
    {waiting ? <p role="status" className="break-words" data-testid="team-snapshot-export-waiting">
      {phase.submission.gateState === ActionGateState.Waiting
        ? t("teamSnapshot.awaitingApproval", { operation: phase.submission.operationId })
        : t("agents.export.preparing", { operation: phase.submission.operationId })}</p> : null}
    {phase.kind === "failed" ? <p role="alert" className="text-danger-text" data-testid="team-snapshot-export-failed">
      {phase.submission.reason ? t("agents.rejected", { reason: reasonText(phase.submission.reason) })
        : t("agents.export.failed", { operation: phase.submission.operationId })}</p> : null}
    {phase.kind === "ready" ? <div className="flex flex-col gap-2" data-testid="team-snapshot-export-ready">
      <p className="break-words">{t("agents.export.ready", { file: phase.view.fileName })}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">SHA-256 {phase.view.contentDigest}</p>
      {saveFailed ? <p role="alert" className="text-danger-text">{t("agents.export.saveFailed")}</p> : null}
      {host.readBytes && host.sendToConversation && phase.view.mediaType === "image/png"
        ? <SnapshotSendPanel view={phase.view} label={target.name} readBytes={() => host.readBytes!(phase.view)}
          send={host.sendToConversation} dedupesRetry={host.sendDedupesRetry === true} onSent={onClose}
          onBusyChange={setSendBusy} testIdPrefix="team-snapshot-export" /> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>{t("agents.snapshot.close")}</Button>
        <Button className={PRIMARY} disabled={saving} onClick={() => void save()} data-testid="team-snapshot-export-save">
          <Download aria-hidden className="h-4 w-4" />{saving ? t("platform.loading") : t("agents.export.save")}</Button>
      </div>
    </div> : null}
    {phase.kind !== "choose" && phase.kind !== "ready" && !unknown && !busy
      ? <Button className="w-fit" onClick={onClose}>{t("agents.snapshot.close")}</Button> : null}
  </div>;
}
