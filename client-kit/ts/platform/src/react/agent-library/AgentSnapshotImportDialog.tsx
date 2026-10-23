// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/agents/ui/AgentSnapshotImportDialog.tsx::AgentSnapshotImportDialog / PreviewBody.
// DD-131(2)、DD-143：同一份预览既服务 Agents 页的文件导入，也服务消息快照卡的“添加”。
// 包字节只经 BFF 为本会话暂存并由 Core 解码；本地不信任包内任何字段。确认后提交
// agent.definition.import：Core 建新 Definition 与一个 DRAFT 版本，不发布、不安装。
// 原版的“保留名单”选项不提供（名单公钥属来源身份，DD-131(2)），记忆不导入（DD-131(4)）；
// 运行时与模型路由由导入人按本 Tenant 目录重选（DD-26），导入时不强制选择：草稿可缺省，发布前在
// 版本编辑器补齐；没有提示词的包得到空指令草稿；内联头像由 Core 存为本 Tenant 媒体对象，草稿引用之
// （DD-131(2) 2026-10-23 裁定）。视觉只用 client-kit 主题 token。
// The native decoder desktop/src-tauri/src/commands/personas/snapshot/import.rs is Core's
// agent_snapshot decoder behind the staged upload.
import {
  ActionDispatchState,
  ActionGateState,
  AgentSnapshotMediaType,
  AgentSnapshotOmission,
  ReasonCode,
  type ActionCommand,
  type ActionSubmission,
  type AgentImportConfigurationPage,
  type AgentSnapshotImportPreview,
} from "@client-kit/contracts";
import { useEffect, useId, useRef, useState } from "react";
import { newIdempotencyKey } from "../../governance";
import type { PlatformMessageKey } from "../../i18n";
import { TransportError, type WriteFailure, writeFailure } from "../../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "../context";
import { Badge, Button, Notice, ReadFailure } from "../ui";
import { useLoad } from "../use-load";
import { AgentManagementDialog } from "./AgentManagementDialog";

/** Original upper bounds (`MAX_SNAPSHOT_JSON_BYTES` / `MAX_SNAPSHOT_PNG_BYTES`). */
export const MAX_AGENT_SNAPSHOT_JSON_BYTES = 5 * 1024 * 1024;
export const MAX_AGENT_SNAPSHOT_PNG_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// DD-141 §9 input: 34px, radius md, line-strong border, brand focus with a soft halo.
const INPUT_CLASS = "h-[34px] rounded-md border border-input bg-background px-2.5 text-sm shadow-xs transition-colors duration-100 hover:border-ring/40 focus-visible:border-ring focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50";
const PANEL_CLASS = "rounded-xl border border-border bg-card p-3";

export type AgentSnapshotSource = { bytes: Uint8Array; mediaType: AgentSnapshotMediaType; filename: string };

export const omissionLabels: Record<string, PlatformMessageKey> = {
  RUNTIME: "agents.snapshot.omitted.runtime",
  MODEL: "agents.snapshot.omitted.model",
  PROVIDER: "agents.snapshot.omitted.provider",
  NAME_POOL: "agents.snapshot.omitted.namePool",
  RESPOND_TO_ALLOWLIST: "agents.snapshot.omitted.allowlist",
  RESPOND_TO_ANYONE: "agents.snapshot.omitted.anyone",
  SESSION_POLICY: "agents.snapshot.omitted.sessionPolicy",
  MEMORY: "agents.snapshot.omitted.memory",
  AVATAR: "agents.snapshot.omitted.avatar",
  SKILLS: "agents.snapshot.omitted.skills",
};

function mediaType(value: string): AgentSnapshotMediaType | null {
  return Object.values(AgentSnapshotMediaType).find((member) => member === value) ?? null;
}

/**
 * Original `.agent.json` / `.agent.png` classification. Old `.persona.*`, zip and other files are not
 * snapshot packages; a PNG is only accepted with the PNG signature. Size follows the original caps.
 */
export function agentSnapshotSource(filename: string, bytes: Uint8Array): AgentSnapshotSource | "unsupported" | "tooLarge" {
  const lower = filename.toLowerCase();
  const png = PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
  const type = lower.endsWith(".png") && png ? mediaType("image/png")
    : lower.endsWith(".json") && !png ? mediaType("application/json") : null;
  if (!type || lower.includes(".persona.") || bytes.length === 0) return "unsupported";
  if (bytes.length > (png ? MAX_AGENT_SNAPSHOT_PNG_BYTES : MAX_AGENT_SNAPSHOT_JSON_BYTES)) return "tooLarge";
  return { bytes, mediaType: type, filename };
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
}

/** SHA-256 of the exact bytes, lowercase hex (imeta `x`). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A stable-looking default slug from the snapshot name; a suffix keeps repeated imports distinct. */
export function defaultImportSlug(name: string, suffix: string): string {
  const stem = name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
    .replace(/-+$/g, "");
  return `${stem || "agent"}-${suffix}`;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validPreview(view: AgentSnapshotImportPreview, source: AgentSnapshotSource): boolean {
  const omissions: string[] = Object.values(AgentSnapshotOmission);
  return !!view && typeof view.uploadId === "string" && !!view.uploadId
    && /^[a-f0-9]{64}$/.test(view.packageDigest) && view.packageByteSize === source.bytes.length
    && view.mediaType === source.mediaType && typeof view.displayName === "string" && !!view.displayName.trim()
    && typeof view.instructions === "string"
    && Array.isArray(view.omitted) && view.omitted.every((code) => omissions.includes(code))
    && (view.avatarDataUrl === undefined || /^data:image\/(png|jpeg|gif|webp);base64,/.test(view.avatarDataUrl))
    // An inline avatar is always staged as a content-addressed object; nothing else carries one.
    && (view.avatarUrl === undefined ? view.avatarDataUrl === undefined
      : view.avatarDataUrl !== undefined && /^https?:\/\/[^/]+\/media\/[0-9a-f]{64}(\.[A-Za-z0-9]+)?$/.test(view.avatarUrl));
}

function validConfiguration(page: AgentImportConfigurationPage): boolean {
  return !!page && Array.isArray(page.profiles) && Array.isArray(page.routes) && typeof page.canImport === "boolean"
    && page.profiles.every((profile) => !!profile && typeof profile.key === "string" && !!profile.key)
    && page.routes.every((route) => !!route && typeof route.resourceId === "string" && !!route.resourceId)
    && (page.nextOffset === null || page.nextOffset === undefined || (Number.isSafeInteger(page.nextOffset) && page.nextOffset >= 0));
}

export type ImportAction = {
  intent: ActionCommand | null; busy: boolean; submission: ActionSubmission | null; failure: WriteFailure | null; unknown: boolean;
  prepare: (command: Omit<ActionCommand, "idempotencyKey">) => void; cancel: () => void; submit: () => Promise<void>;
};

/** The frozen request keeps its idempotency key through an unknown outcome; only that same request may be re-checked. */
export function useImportAction(onSettled: (submission: ActionSubmission) => void): ImportAction {
  const client = useBffClient();
  const t = useT();
  const inFlight = useRef(false);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  return {
    intent, busy, submission, failure, unknown,
    prepare: (command) => {
      if (busy || intent) return;
      setIntent({ ...command, idempotencyKey: newIdempotencyKey() } as ActionCommand);
      setSubmission(null); setFailure(null);
    },
    cancel: () => { if (!busy && !unknown) { setIntent(null); setFailure(null); } },
    submit: async () => {
      if (!intent || inFlight.current) return;
      inFlight.current = true; setBusy(true);
      try {
        const result = await client.submitAction(intent);
        if (!result || result.actionKey !== intent.actionKey || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
          || typeof result.operationId !== "string" || !result.operationId
          || !Object.values(ActionGateState).includes(result.gateState)
          || !Object.values(ActionDispatchState).includes(result.dispatchState)
          || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
          || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))
          || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
        setFailure(null); setSubmission(result);
        if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
          && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
          setIntent(null); onSettled(result);
        }
      } catch (error) {
        const failed = writeFailure(error);
        setFailure(failed);
        if (failed.kind !== "unknown") setIntent(null);
      } finally { inFlight.current = false; setBusy(false); }
    },
  };
}

export function AgentSnapshotImportDialog({ source, onClose, onImported }: {
  source: AgentSnapshotSource | null; onClose: () => void; onImported?: () => void;
}) {
  const t = useT();
  const action = useImportAction(() => onImported?.());
  const locked = action.busy || action.unknown;
  return <AgentManagementDialog open={source !== null} title={t(action.submission && !action.unknown
    ? "agents.snapshot.importedTitle" : "agents.snapshot.importTitle")} locked={locked} onClose={onClose}
    dataTestId="agent-snapshot-import-dialog">
    {source ? <ImportBody key={`${source.filename}:${source.bytes.length}`} source={source} action={action} onClose={onClose} /> : null}
  </AgentManagementDialog>;
}

function ImportBody({ source, action, onClose }: { source: AgentSnapshotSource; action: ImportAction; onClose: () => void }) {
  const client = useBffClient();
  const t = useT();
  const id = useId();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [suffix] = useState(() => newIdempotencyKey().replaceAll("-", "").slice(0, 6));
  const [uploaded, reupload] = useLoad(`agent-snapshot-upload:${source.filename}:${source.bytes.length}`,
    () => client.uploadAgentSnapshot({ mediaType: source.mediaType, contentBase64: toBase64(source.bytes) }));
  const preview = uploaded.status === "ok" && validPreview(uploaded.data, source) ? uploaded.data : null;
  const [offsets, setOffsets] = useState([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const offset = offsets[pageIndex] ?? 0;
  const [configured, reconfigure] = useLoad(`agent-snapshot-configuration:${offset}`, () => client.agentImportConfiguration(offset));
  const configuration = configured.status === "ok" && validConfiguration(configured.data) ? configured.data : null;
  const [profileKey, setProfileKey] = useState("");
  const [routeId, setRouteId] = useState("");
  const [slug, setSlug] = useState("");
  useEffect(() => { if (preview && !slug) setSlug(defaultImportSlug(preview.displayName, suffix)); }, [preview, slug, suffix]);
  // DD-131(2): no forced choice. A selection that is no longer on the current page is cleared, never replaced.
  useEffect(() => {
    if (!configuration) return;
    if (profileKey && !configuration.profiles.some((profile) => profile.key === profileKey)) setProfileKey("");
    if (routeId && !configuration.routes.some((route) => route.resourceId === routeId)) setRouteId("");
  }, [configuration, profileKey, routeId]);
  const done = action.submission !== null && !action.unknown;
  const slugValid = SLUG.test(slug) && !slug.endsWith("-");
  const ready = !!preview && !!configuration && configuration.canImport && slugValid;
  const review = () => {
    if (!preview || !ready) return;
    action.prepare({
      actionKey: "agent.definition.import", slug, explicitConfirmation: true,
      agentDefinitionImport: { uploadId: preview.uploadId, packageDigest: preview.packageDigest,
        ...(profileKey ? { runtimeProfileKey: profileKey } : {}), ...(routeId ? { modelRouteResourceId: routeId } : {}) },
    });
  };

  if (uploaded.status === "pending") return <Notice role="status">{t("agents.snapshot.reading")}</Notice>;
  if (!preview) {
    const reason = uploaded.status === "error" ? uploaded.error : undefined;
    return <div className="flex flex-col gap-3" data-testid="agent-snapshot-import-rejected">
      <ReadFailure error={reason ?? new TransportError(t("platform.loadFailed"))} onRetry={reupload} />
      <p className="text-sm text-muted-foreground">{t("agents.snapshot.rejectedHint")}</p>
      <Button className="w-fit" onClick={onClose}>{t("agents.cancel")}</Button>
    </div>;
  }
  return <div className="flex flex-col gap-4 py-1 text-sm" data-testid="agent-snapshot-import-preview">
    <div className="flex items-center gap-3">
      {preview.avatarDataUrl ? <img alt="" src={preview.avatarDataUrl} className="h-12 w-12 shrink-0 rounded-squircle object-cover"
        data-testid="agent-snapshot-import-avatar" /> : null}
      <div className="min-w-0">
        <p className="break-words text-headline font-semibold">{preview.displayName}</p>
        {preview.description ? <p className="break-words text-muted-foreground">{preview.description}</p> : null}
        {preview.avatarUrl ? <p className="text-xs text-muted-foreground" data-testid="agent-snapshot-import-avatar-imported">{t("agents.snapshot.avatarImported")}</p> : null}
      </div>
    </div>
    <section className={`flex flex-col gap-2 ${PANEL_CLASS}`} data-testid="agent-snapshot-import-behavior">
      <div>
        <p className="font-medium">{t("agents.snapshot.instructions")}</p>
        <p className="text-xs text-muted-foreground">{t("agents.snapshot.instructionsHint")}</p>
      </div>
      {preview.instructions.trim() ? <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-3 font-mono text-xs"
        data-testid="agent-snapshot-import-instructions">{preview.instructions}</pre>
        : <p role="status" className="rounded-lg bg-warning-soft p-3 text-xs text-warning-text" data-testid="agent-snapshot-import-no-instructions">{t("agents.snapshot.noInstructions")}</p>}
      <p className="text-xs text-muted-foreground">
        {[preview.parallelism !== undefined ? t("agents.snapshot.parallelism", { count: String(preview.parallelism) }) : null,
          preview.idleTimeoutSeconds !== undefined ? t("agents.snapshot.idle", { seconds: String(preview.idleTimeoutSeconds) }) : null,
          preview.maxTurnDurationSeconds !== undefined ? t("agents.snapshot.maxTurn", { seconds: String(preview.maxTurnDurationSeconds) }) : null,
        ].filter(Boolean).join(" · ") || t("agents.snapshot.profileLimits")}
      </p>
    </section>
    {preview.omitted.length > 0 ? <section className="flex flex-col gap-1.5" data-testid="agent-snapshot-import-omitted">
      <p className="font-medium">{t("agents.snapshot.omittedTitle")}</p>
      <div className="flex flex-wrap gap-1.5">{preview.omitted.map((code) =>
        <Badge key={code} tone="neutral">{t(omissionLabels[code] ?? "agents.snapshot.omitted.other")}</Badge>)}</div>
      <p className="text-xs text-muted-foreground">{t("agents.snapshot.omittedHint")}</p>
    </section> : null}
    <p className="text-muted-foreground">{t("agents.snapshot.boundary")}</p>
    {!action.intent && !done ? <section className={`flex flex-col gap-3 ${PANEL_CLASS}`}>
      {configured.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !configuration ? <ReadFailure error={configured.status === "error" ? configured.error : undefined} onRetry={reconfigure} />
        : !configuration.canImport
          ? <Notice role="alert">{t("agents.snapshot.unavailable")}</Notice>
          : <>
            <p className="text-xs text-muted-foreground">{t("agents.snapshot.runtimeOptional")}</p>
            <label className="flex flex-col gap-1 text-control font-medium" htmlFor={`${id}-profile`}>{t("agents.version.runtimeProfile")}
              <select id={`${id}-profile`} value={profileKey} onChange={(event) => setProfileKey(event.target.value)} className={INPUT_CLASS}>
                <option value="">{t("agents.snapshot.runtimeLater")}</option>
                {configuration.profiles.map((profile) => <option key={profile.key} value={profile.key}>{profile.key}</option>)}
              </select></label>
            <label className="flex flex-col gap-1 text-control font-medium" htmlFor={`${id}-route`}>{t("agents.version.modelRoute")}
              <select id={`${id}-route`} value={routeId} onChange={(event) => setRouteId(event.target.value)} className={`${INPUT_CLASS} font-mono`}>
                <option value="">{t("agents.snapshot.runtimeLater")}</option>
                {configuration.routes.map((route) => <option key={route.resourceId} value={route.resourceId}>{route.resourceId}</option>)}
              </select></label>
            {pageIndex > 0 || configuration.nextOffset != null ? <div className="flex gap-2">
              {pageIndex > 0 ? <Button onClick={() => setPageIndex(pageIndex - 1)}>{t("roles.previous")}</Button> : null}
              {configuration.nextOffset != null ? <Button onClick={() => {
                const next = configuration.nextOffset!;
                setOffsets((old) => [...old.slice(0, pageIndex + 1), next]); setPageIndex(pageIndex + 1);
              }}>{t("roles.next")}</Button> : null}
            </div> : null}
            <label className="flex flex-col gap-1 text-control font-medium" htmlFor={`${id}-slug`}>{t("agents.snapshot.slug")}
              <input id={`${id}-slug`} value={slug} maxLength={64} onChange={(event) => setSlug(event.target.value.trim())}
                className={`${INPUT_CLASS} font-mono`} data-testid="agent-snapshot-import-slug" />
              <span className="text-xs font-normal text-muted-foreground">{t("agents.snapshot.slugHint")}</span></label>
            {!slugValid ? <p role="alert">{t("agents.snapshot.slugInvalid")}</p> : null}
          </>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!ready} onClick={review} data-testid="agent-snapshot-import-review">{t("agents.review")}</Button>
        <Button onClick={onClose}>{t("agents.cancel")}</Button>
      </div>
    </section> : null}
    {action.intent ? <div className={`flex flex-col gap-2 ${PANEL_CLASS}`} role="group" data-testid="agent-snapshot-import-confirm">
      <p className="break-words">{t("agents.snapshot.confirmSummary", { name: preview.displayName, slug: action.intent.slug ?? "" })}</p>
      <p className="break-all font-mono text-xs text-muted-foreground">SHA-256 {preview.packageDigest}</p>
      <p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={action.busy} onClick={() => void action.submit()} data-testid="agent-snapshot-import-submit">
          {action.busy ? t("platform.loading") : action.unknown ? t("agents.retry") : t("agents.snapshot.import")}</Button>
        {!action.busy && !action.unknown ? <Button onClick={action.cancel}>{t("agents.cancel")}</Button> : null}
      </div>
    </div> : null}
    {action.submission ? <p role="status" className={`break-words rounded-lg px-3 py-2 ${action.unknown ? "bg-warning-soft text-warning-text" : action.submission.gateState === ActionGateState.Denied ? "bg-danger-soft text-danger-text" : "bg-success-soft text-success-text"}`}>{action.unknown
      ? t("agents.unknown", { operation: action.submission.operationId })
      : action.submission.gateState === ActionGateState.Denied
        ? t("agents.rejected", { reason: action.submission.reason ? reasonText(action.submission.reason) : "—" })
        : t("agents.snapshot.recorded", { operation: action.submission.operationId })}</p> : null}
    {action.failure ? <p role={action.failure.kind === "unknown" ? "status" : "alert"} className={`break-words rounded-lg px-3 py-2 ${action.failure.kind === "unknown" ? "bg-warning-soft text-warning-text" : "bg-danger-soft text-danger-text"}`}>{action.failure.kind === "unknown"
      ? t("agents.unknown", { operation: action.failure.operationId ?? "—" })
      : t("agents.rejected", { reason: failureText(action.failure) })}</p> : null}
    {done ? <Button className="w-fit" onClick={onClose}>{t("agents.snapshot.close")}</Button> : null}
  </div>;
}
