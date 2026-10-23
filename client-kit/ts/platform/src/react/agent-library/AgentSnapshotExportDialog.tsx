// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/agents/ui/AgentSnapshotExportDialog.tsx::AgentSnapshotExportDialog.
// DD-131(2)、DD-42、05 §2.12：原版“导出”对话框。原版本地直接写文件；Kailo 的导出是受治理的
// agent.definition.export：Definition owner 批准（可自批）后由 Core 生成源 Tenant 的 ExportPackage 并
// 冻结 digest，READY 后才可下载。原版的记忆选项不提供（DD-131(4)），固定为“仅 Agent”。
// 一次导出只冻结一个幂等键；结果不明只能以同一请求重试。视觉只用 client-kit 主题 token 与基础组件。
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
import { Brain, Copy, Download, FileType2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { newIdempotencyKey } from "../../governance";
import { TransportError, type WriteFailure, writeFailure } from "../../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "../context";
import { Button } from "../ui";
import { writeSnapshotToClipboard } from "../messages/agentSnapshotClipboard";
import { AgentManagementDialog } from "./AgentManagementDialog";
import { sha256Hex } from "./AgentSnapshotImportDialog";
import { SnapshotSendPanel, type SnapshotShareSend } from "./SnapshotSendPanel";

/** DD-141 §6 primary action on the shared Button: brand fill, theme tokens only. */
const PRIMARY = "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground";

type ReadyView = ExportPackageView & { downloadPath: string; fileName: string };

/**
 * How a host handles a READY package: Web downloads the authorized same-origin route, Desktop uses
 * its native save dialog. `readBytes` returns the package through the same authorized route; it
 * backs the original "copy" (DD-131(7)): the copied `.agent.png` is pasted into any DM or channel
 * composer and sent as an ordinary attachment.
 */
export type SnapshotExportHost = {
  save: (view: ReadyView) => Promise<unknown>;
  readBytes?: (view: ReadyView) => Promise<Uint8Array>;
  /**
   * DD-131(7) original "send to people": the READY PNG package as an ordinary attachment in a direct
   * message with the chosen people, through the host's conversation media and publish chain.
   */
  sendToConversation?: SnapshotShareSend;
  /** The host's DM publication carries the intent's Idempotency-Key, so an unknown outcome may be retried. */
  sendDedupesRetry?: boolean;
};

/** Default host: the BFF route is same-origin and session-authorized, so a plain download link is enough. */
export const browserSnapshotExportHost: SnapshotExportHost = {
  save: async (view) => {
    const anchor = document.createElement("a");
    anchor.href = view.downloadPath;
    anchor.download = view.fileName;
    anchor.rel = "noopener";
    anchor.click();
  },
  readBytes: async (view) => {
    const response = await fetch(view.downloadPath, { credentials: "same-origin" });
    if (!response.ok) throw new Error(String(response.status));
    return new Uint8Array(await response.arrayBuffer());
  },
};

export type SnapshotExportTarget = {
  resourceId: string; resourceVersion: number; displayName: string; versionAssetId: string;
};

const POLL_MS = 2500;

/** A view is only trusted for the exact export it answers; bytes and digest exist only once READY. */
export function validExportView(view: ExportPackageView | undefined, actionExecutionId: string, target: SnapshotExportTarget): view is ExportPackageView {
  return !!view && view.actionExecutionId === actionExecutionId && view.sourceResourceId === target.resourceId
    && typeof view.packageAssetId === "string" && !!view.packageAssetId
    && Object.values(ExportPackageState).includes(view.state)
    && (view.sourceAssetId === undefined || view.sourceAssetId === target.versionAssetId)
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

export function AgentSnapshotExportDialog({ target, onClose, host = browserSnapshotExportHost }: {
  target: SnapshotExportTarget | null; onClose: () => void; host?: SnapshotExportHost;
}) {
  const t = useT();
  const [locked, setLocked] = useState(false);
  return <AgentManagementDialog open={target !== null} title={t("agents.export.title", { name: target?.displayName ?? "" })}
    locked={locked} onClose={onClose} dataTestId="agent-snapshot-export-dialog">
    {target ? <ExportBody key={`${target.resourceId}:${target.resourceVersion}:${target.versionAssetId}`} target={target}
      host={host} onClose={onClose} onLockedChange={setLocked} /> : null}
  </AgentManagementDialog>;
}

function ExportBody({ target, host, onClose, onLockedChange }: {
  target: SnapshotExportTarget; host: SnapshotExportHost; onClose: () => void; onLockedChange: (locked: boolean) => void;
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
  const [saveFailed, setSaveFailed] = useState(false);
  const [copy, setCopy] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const [sendBusy, setSendBusy] = useState(false);
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
      actionKey: "agent.definition.export", idempotencyKey: newIdempotencyKey(),
      resourceId: target.resourceId, resourceVersion: target.resourceVersion,
      agentDefinitionExport: { versionAssetId: target.versionAssetId, mediaType: format },
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

  // After admission (or while the owner decides) the package appears under this execution. 404 means
  // "not prewritten yet": keep waiting, never infer success or failure from absence.
  useEffect(() => {
    if (phase.kind !== "submitted" || unknown) return;
    const executionId = phase.submission.actionExecutionId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const view = await client.exportPackageByAction(executionId);
        if (cancelled) return;
        if (!validExportView(view, executionId, target)) throw new TransportError(t("platform.loadFailed"));
        if (view.state === ExportPackageState.Ready && view.downloadPath && view.fileName) {
          setPhase({ kind: "ready", submission: phase.submission, view: { ...view, downloadPath: view.downloadPath, fileName: view.fileName } });
          return;
        }
        if (view.state !== ExportPackageState.Creating) { setPhase({ kind: "failed", submission: phase.submission }); return; }
      } catch {
        // 404 (not prewritten yet) and transient read failures are not export outcomes: keep
        // polling the same execution instead of inferring success or failure.
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

  const copyPackage = async () => {
    if (phase.kind !== "ready" || !host.readBytes || copy === "copying") return;
    setCopy("copying");
    try {
      const bytes = await host.readBytes(phase.view);
      if (bytes.length !== phase.view.byteSize || await sha256Hex(bytes) !== phase.view.contentDigest) throw new Error("digest");
      await writeSnapshotToClipboard(bytes, target.displayName, phase.view.fileName);
      setCopy("copied");
    } catch { setCopy("failed"); }
  };

  return <div className="flex flex-col gap-4 py-1 text-sm" data-testid="agent-snapshot-export-body">
    <dl className="flex flex-col gap-2">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <dt className="flex items-center gap-2 font-medium"><Brain aria-hidden className="h-4 w-4 text-muted-foreground" />{t("agents.export.memories")}</dt>
        <dd className="text-muted-foreground" data-testid="agent-snapshot-export-memory">{t("agents.export.agentOnly")}</dd>
      </div>
      <div className="flex min-h-8 items-center justify-between gap-4">
        <dt className="flex items-center gap-2 font-medium"><FileType2 aria-hidden className="h-4 w-4 text-muted-foreground" />
          <label htmlFor="agent-snapshot-export-format">{t("agents.export.format")}</label></dt>
        <dd><select id="agent-snapshot-export-format" value={format} disabled={phase.kind !== "choose" || busy || intent !== null}
          onChange={(event) => setFormat(event.target.value as AgentSnapshotMediaType)}
          className="h-8 rounded-md border border-input bg-background px-2 text-sm shadow-xs" data-testid="agent-snapshot-export-format">
          <option value={AgentSnapshotMediaType.ImagePng}>PNG</option>
          <option value={AgentSnapshotMediaType.ApplicationJson}>JSON</option>
        </select></dd>
      </div>
    </dl>
    <p className="text-xs text-muted-foreground">{t("agents.export.boundary")}</p>
    {phase.kind === "choose" ? <div className="flex flex-wrap justify-end gap-2" data-testid="agent-snapshot-export-footer">
      {!busy && !unknown ? <Button onClick={onClose}>{t("agents.cancel")}</Button> : null}
      <Button className={PRIMARY} disabled={busy} onClick={() => void submit()} data-testid="agent-snapshot-export-confirm">
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
    {waiting ? <p role="status" className="break-words" data-testid="agent-snapshot-export-waiting">
      {phase.submission.gateState === ActionGateState.Waiting
        ? t("agents.export.awaitingApproval", { operation: phase.submission.operationId })
        : t("agents.export.preparing", { operation: phase.submission.operationId })}</p> : null}
    {phase.kind === "failed" ? <p role="alert" className="text-danger-text" data-testid="agent-snapshot-export-failed">
      {phase.submission.reason ? t("agents.rejected", { reason: reasonText(phase.submission.reason) })
        : t("agents.export.failed", { operation: phase.submission.operationId })}</p> : null}
    {phase.kind === "ready" ? <div className="flex flex-col gap-2" data-testid="agent-snapshot-export-ready">
      <p className="break-words">{t("agents.export.ready", { file: phase.view.fileName })}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">SHA-256 {phase.view.contentDigest}</p>
      {saveFailed ? <p role="alert" className="text-danger-text">{t("agents.export.saveFailed")}</p> : null}
      {copy === "copied" ? <p role="status" className="text-success-text">{t("agents.export.copied")}</p>
        : copy === "failed" ? <p role="alert" className="text-danger-text">{t("agents.export.copyFailed")}</p> : null}
      {host.readBytes && host.sendToConversation && phase.view.mediaType === "image/png"
        ? <SnapshotSendPanel view={phase.view} label={target.displayName} readBytes={() => host.readBytes!(phase.view)}
          send={host.sendToConversation} dedupesRetry={host.sendDedupesRetry === true} onSent={onClose}
          onBusyChange={setSendBusy} testIdPrefix="agent-snapshot-export" /> : null}
      {host.readBytes && phase.view.mediaType === "image/png"
        ? <p className="text-xs text-muted-foreground">{t("agents.export.shareHint")}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onClose}>{t("agents.snapshot.close")}</Button>
        {host.readBytes && phase.view.mediaType === "image/png"
          ? <Button disabled={copy === "copying"} onClick={() => void copyPackage()} data-testid="agent-snapshot-export-copy">
            <Copy aria-hidden className="h-4 w-4" />{copy === "copying" ? t("platform.loading") : t("agents.export.copy")}</Button> : null}
        <Button className={PRIMARY} disabled={saving} onClick={() => void save()} data-testid="agent-snapshot-export-save">
          <Download aria-hidden className="h-4 w-4" />{saving ? t("platform.loading") : t("agents.export.save")}</Button>
      </div>
    </div> : null}
    {phase.kind !== "choose" && phase.kind !== "ready" && !unknown && !busy
      ? <Button className="w-fit" onClick={onClose}>{t("agents.snapshot.close")}</Button> : null}
  </div>;
}
