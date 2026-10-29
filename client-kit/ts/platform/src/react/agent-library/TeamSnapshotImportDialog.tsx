// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/agents/ui/TeamSnapshotImportDialog.tsx::TeamSnapshotImportDialog / PreviewBody.
// DD-131(3)：团队快照导入。同一份预览既服务 Agents 页团队区的文件导入，也服务消息里团队快照卡的
// “添加”。包字节只经 BFF 为本会话暂存并由 Core 解码；本地不信任包内任何字段。确认后提交
// agent.team.import：Core 在一次 RESOURCE_IMPORT 中为每个成员建新 Definition 与 DRAFT，再建引用它们
// 的新团队；任一成员失败整包不提交，不发布、不安装。原版的“保留名单”与记忆不导入（DD-131(2)(4)），
// 团队 instructions 不进入包（DD-131(1)）；成员 DRAFT 不带运行配置，发布前在版本编辑器补齐。
// 视觉只用 DD-141 Kailo 令牌与 client-kit 基础组件。
// The original phase helpers desktop/src/features/agents/ui/teamSnapshotImport.lib.ts are the
// preview/confirm/result states below; the native desktop/src-tauri/src/commands/team_snapshot.rs and
// desktop/src-tauri/src/managed_agents/team_snapshot.rs codec is Core's team_snapshot (DD-131(3)).
import {
  ActionGateState,
  AgentSnapshotMediaType,
  AgentSnapshotOmission,
  type AgentTeamSnapshotImportPreview,
} from "@client-kit/contracts";
import { Users } from "lucide-react";
import { TransportError } from "../../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "../context";
import { Badge, Button, Notice, ReadFailure } from "../ui";
import { useLoad } from "../use-load";
import { AgentManagementDialog } from "./AgentManagementDialog";
import { IdentityInitialsAvatar } from "./IdentityInitialsAvatar";
import { omissionLabels, toBase64, useImportAction } from "./AgentSnapshotImportDialog";

/** Original upper bounds for `.team.json` / `.team.png`. */
export const MAX_TEAM_SNAPSHOT_JSON_BYTES = 25 * 1024 * 1024;
export const MAX_TEAM_SNAPSHOT_PNG_BYTES = 50 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PANEL_CLASS = "rounded-xl border border-border bg-card p-3";
const MEDIA_URL = /^https?:\/\/[^/]+\/media\/[0-9a-f]{64}(\.[A-Za-z0-9]+)?$/;
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,/;

export type TeamSnapshotSource = { bytes: Uint8Array; mediaType: AgentSnapshotMediaType; filename: string };

/**
 * Original `.team.json` / `.team.png` classification: the PNG signature decides PNG, `.persona.*`
 * and zip are never team packages, and size follows the original team caps.
 */
export function teamSnapshotSource(filename: string, bytes: Uint8Array): TeamSnapshotSource | "unsupported" | "tooLarge" {
  const lower = filename.toLowerCase();
  const png = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  const type = lower.endsWith(".png") && png ? AgentSnapshotMediaType.ImagePng
    : lower.endsWith(".json") && !png ? AgentSnapshotMediaType.ApplicationJson : null;
  if (!type || lower.includes(".persona.") || bytes.length === 0) return "unsupported";
  if (bytes.length > (png ? MAX_TEAM_SNAPSHOT_PNG_BYTES : MAX_TEAM_SNAPSHOT_JSON_BYTES)) return "tooLarge";
  return { bytes, mediaType: type, filename };
}

/** The preview must answer exactly these bytes; every member and omission must be a known shape. */
export function validTeamPreview(view: AgentTeamSnapshotImportPreview, source: TeamSnapshotSource): boolean {
  const omissions: string[] = Object.values(AgentSnapshotOmission);
  return !!view && typeof view.uploadId === "string" && !!view.uploadId
    && /^[a-f0-9]{64}$/.test(view.packageDigest) && view.packageByteSize === source.bytes.length
    && view.mediaType === source.mediaType && view.formatKey === "buzz-team-snapshot@1"
    && typeof view.name === "string" && !!view.name.trim() && typeof view.teamInstructionsOmitted === "boolean"
    && Array.isArray(view.members) && view.members.length > 0 && view.members.length <= 64
    && view.members.every((member) => !!member && typeof member.displayName === "string" && !!member.displayName.trim()
      && typeof member.instructions === "string" && Array.isArray(member.omitted)
      && member.omitted.every((code) => omissions.includes(code))
      // As for one Agent: a staged avatar comes with the package's own bytes for the preview, and only then.
      && (member.avatarUrl === undefined ? member.avatarDataUrl === undefined
        : MEDIA_URL.test(member.avatarUrl) && typeof member.avatarDataUrl === "string" && AVATAR_DATA_URL.test(member.avatarDataUrl)));
}

export function TeamSnapshotImportDialog({ source, onClose, onImported }: {
  source: TeamSnapshotSource | null; onClose: () => void; onImported?: () => void;
}) {
  const t = useT();
  const action = useImportAction(() => onImported?.());
  const locked = action.busy || action.unknown;
  return <AgentManagementDialog open={source !== null} title={t(action.submission && !action.unknown
    ? "teamSnapshot.importedTitle" : "teamSnapshot.importTitle")} locked={locked} onClose={onClose}
    dataTestId="team-snapshot-import-dialog">
    {source ? <ImportBody key={`${source.filename}:${source.bytes.length}`} source={source} action={action} onClose={onClose} /> : null}
  </AgentManagementDialog>;
}

function ImportBody({ source, action, onClose }: {
  source: TeamSnapshotSource; action: ReturnType<typeof useImportAction>; onClose: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [uploaded, reupload] = useLoad(`team-snapshot-upload:${source.filename}:${source.bytes.length}`,
    () => client.uploadTeamSnapshot({ mediaType: source.mediaType, contentBase64: toBase64(source.bytes) }));
  const preview = uploaded.status === "ok" && validTeamPreview(uploaded.data, source) ? uploaded.data : null;
  const done = action.submission !== null && !action.unknown;

  if (uploaded.status === "pending") return <Notice role="status">{t("teamSnapshot.reading")}</Notice>;
  if (!preview) {
    const reason = uploaded.status === "error" ? uploaded.error : undefined;
    return <div className="flex flex-col gap-3" data-testid="team-snapshot-import-rejected">
      <ReadFailure error={reason ?? new TransportError(t("platform.loadFailed"))} onRetry={reupload} />
      <p className="text-sm text-muted-foreground">{t("teamSnapshot.rejectedHint")}</p>
      <Button className="w-fit" onClick={onClose}>{t("agents.cancel")}</Button>
    </div>;
  }
  return <div className="flex flex-col gap-4 py-1 text-sm" data-testid="team-snapshot-import-preview">
    <div className="flex items-center gap-3">
      <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-squircle bg-brand-soft text-brand-soft-foreground">
        <Users className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="break-words text-headline font-semibold" data-testid="team-snapshot-import-name">{preview.name}</p>
        {preview.description ? <p className="break-words text-muted-foreground">{preview.description}</p> : null}
      </div>
    </div>
    <p className="text-muted-foreground">{t("teamSnapshot.boundary")}</p>
    {preview.teamInstructionsOmitted ? <p className="text-xs text-muted-foreground" data-testid="team-snapshot-import-instructions-omitted">
      {t("teamSnapshot.instructionsOmitted")}</p> : null}
    <section className="flex flex-col gap-2" data-testid="team-snapshot-import-members">
      <p className="font-medium">{t("teamSnapshot.members", { count: String(preview.members.length) })}</p>
      <ul className={`flex max-h-64 flex-col gap-2 overflow-y-auto ${PANEL_CLASS}`}>
        {preview.members.map((member, index) => (
          // Member names may repeat; the package order is the identity here.
          <li key={index} className="flex gap-3 border-b border-border pb-2 last:border-b-0 last:pb-0"
            data-testid={`team-snapshot-import-member-${index}`}>
            {member.avatarDataUrl ? <img alt="" src={member.avatarDataUrl} className="h-9 w-9 shrink-0 rounded-squircle object-cover"
              data-testid={`team-snapshot-import-member-${index}-avatar`} />
              : <span className="h-9 w-9 shrink-0"><IdentityInitialsAvatar className="border-0 text-xs shadow-none" colorIndex={index}
                label={member.displayName} size={36} /></span>}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="break-words font-medium">{member.displayName}</p>
            {member.description ? <p className="break-words text-xs text-muted-foreground">{member.description}</p> : null}
            {member.instructions.trim()
              ? <p className="line-clamp-2 break-words text-xs text-muted-foreground">{member.instructions}</p>
              : <p role="status" className="text-xs text-warning-text" data-testid={`team-snapshot-import-member-${index}-no-instructions`}>
                {t("teamSnapshot.memberNoInstructions")}</p>}
            {member.avatarUrl ? <p className="text-xs text-muted-foreground">{t("teamSnapshot.memberAvatarImported")}</p> : null}
            {member.omitted.length > 0 ? <div className="flex flex-wrap gap-1">{member.omitted.map((code) =>
              <Badge key={code} tone="neutral">{t(omissionLabels[code] ?? "agents.snapshot.omitted.other")}</Badge>)}</div> : null}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t("teamSnapshot.runtimeLater")}</p>
    </section>
    {!action.intent && !done ? <div className="flex flex-wrap gap-2">
      <Button onClick={() => action.prepare({
        actionKey: "agent.team.import", explicitConfirmation: true,
        agentTeamImport: { uploadId: preview.uploadId, packageDigest: preview.packageDigest },
      })} data-testid="team-snapshot-import-review">{t("agents.review")}</Button>
      <Button onClick={onClose}>{t("agents.cancel")}</Button>
    </div> : null}
    {action.intent ? <div className={`flex flex-col gap-2 ${PANEL_CLASS}`} role="group" data-testid="team-snapshot-import-confirm">
      <p className="break-words">{t("teamSnapshot.confirmSummary", { name: preview.name, count: String(preview.members.length) })}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">SHA-256 {preview.packageDigest}</p>
      <p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={action.busy} onClick={() => void action.submit()} data-testid="team-snapshot-import-submit">
          {action.busy ? t("platform.loading") : action.unknown ? t("agents.retry") : t("agents.snapshot.import")}</Button>
        {!action.busy && !action.unknown ? <Button onClick={action.cancel}>{t("agents.cancel")}</Button> : null}
      </div>
    </div> : null}
    {action.submission ? <p role="status" data-testid="team-snapshot-import-outcome"
      className={`break-words rounded-lg px-3 py-2 ${action.unknown ? "bg-warning-soft text-warning-text" : action.submission.gateState === ActionGateState.Denied ? "bg-danger-soft text-danger-text" : "bg-success-soft text-success-text"}`}>{action.unknown
      ? t("agents.unknown", { operation: action.submission.operationId })
      : action.submission.gateState === ActionGateState.Denied
        ? t("agents.rejected", { reason: action.submission.reason ? reasonText(action.submission.reason) : "—" })
        : t("teamSnapshot.recorded", { operation: action.submission.operationId })}</p> : null}
    {action.failure ? <p role={action.failure.kind === "unknown" ? "status" : "alert"} className={`break-words rounded-lg px-3 py-2 ${action.failure.kind === "unknown" ? "bg-warning-soft text-warning-text" : "bg-danger-soft text-danger-text"}`}>{action.failure.kind === "unknown"
      ? t("agents.unknown", { operation: action.failure.operationId ?? "—" })
      : t("agents.rejected", { reason: failureText(action.failure) })}</p> : null}
    {done ? <Button className="w-fit" onClick={onClose}>{t("agents.snapshot.close")}</Button> : null}
  </div>;
}
