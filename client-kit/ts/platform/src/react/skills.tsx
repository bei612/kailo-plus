// DD-135、05 §2.14、17 §8：Agents 页内的 Skills 区（Web/Desktop 共用）。
// 原版 Buzz 779af8886caae1317b4de962082429867ab61503 没有 Skills 管理界面（persona `skills`
// 只解析不执行，SF-BUZ-12）；本区沿用原 Agents 页的分区标题、身份卡片网格、虚线新建卡与
// 管理对话框（UnifiedAgentsSection / TeamsSection / CreateIdentityCard / AgentDefinitionDialogShell）。
// 所有写入都是 Governed Action：本地只冻结意图与幂等键，结果不明保留原键重试，权限由 Core 重做。
import {
  ActionDispatchState,
  ActionGateState,
  AgentInstallationSkillStatus,
  AgentVersionState,
  ReasonCode,
  SkillArtifactViolationCode,
  SkillDefinitionStatus,
  type ActionCommand,
  type ActionSubmission,
  type AgentInstallationSkillPage,
  type SkillArtifactUploadView,
  type SkillDefinitionPage,
  type SkillDefinitionView,
  type SkillVersionPage,
  type SkillVersionView,
} from "@client-kit/contracts";
import { type ChangeEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { newIdempotencyKey } from "../governance";
import type { PlatformMessageKey } from "../i18n";
import { TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useReasonText, useT } from "./context";
import { Badge, Button, Notice, ReadFailure } from "./ui";
import { useLoad } from "./use-load";
import { AgentIdentityCard } from "./agent-library/AgentIdentityCard";
import { CreateIdentityCard } from "./agent-library/CreateIdentityCard";
import { AgentManagementDialog } from "./agent-library/AgentManagementDialog";
import { IdentityCardSkeleton } from "./agent-library/identity-card-skeleton";

// Original UnifiedAgentsSection grid at Buzz 779af8886caae1317b4de962082429867ab61503.
const GRID_CLASS = "w-full grid-cols-1 [@container(min-width:21rem)]:grid-cols-2 [@container(min-width:32rem)]:grid-cols-3 [@container(min-width:43rem)]:grid-cols-4 [@container(min-width:54rem)]:grid-cols-5 grid gap-3";
const INPUT_CLASS = "h-8 rounded-md border border-input bg-transparent px-2 text-sm";

/** DD-135(1)：slug 即 Codex skill 名——小写字母、数字与连字符，首尾为字母或数字，至多 64 字符。 */
export function validSkillSlug(slug: string): boolean {
  return /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/.test(slug);
}

/** DD-135(2)：上传字节上界（与 Core 同值）。 */
export const MAX_SKILL_UPLOAD_BYTES = 1024 * 1024;

/** contract_key@version，与 Core 的规范化同一规则。 */
export function validRequirement(key: string): boolean {
  const at = key.indexOf("@");
  return at > 0 && at < key.length - 1 && key.indexOf("@", at + 1) === -1 && !/\s/.test(key);
}

export function parseRequirements(text: string): string[] | null {
  const keys = text.split(/[,\n]/).map((key) => key.trim()).filter(Boolean);
  return keys.every(validRequirement) && new Set(keys).size === keys.length ? keys : null;
}

// ---------------------------------------------------------------------------
// 浏览器内把所选文件夹打包为 ustar（DD-135(2) 允许客户端打包文件夹后上传）。
// ---------------------------------------------------------------------------

export type PackEntry = { path: string; bytes: Uint8Array };

function writeField(header: Uint8Array, offset: number, length: number, value: string) {
  const bytes = new TextEncoder().encode(value);
  header.set(bytes.subarray(0, length), offset);
}

function octal(value: number, length: number): string {
  return value.toString(8).padStart(length - 1, "0");
}

/** 只写常规文件（0644）；路径按 ustar 的 prefix/name 拆分，过长即拒绝。 */
export function packTar(entries: readonly PackEntry[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const path = entry.path.replace(/^\/+/, "");
    let name = path;
    let prefix = "";
    if (new TextEncoder().encode(path).length > 100) {
      const cut = path.lastIndexOf("/", 155);
      prefix = cut > 0 ? path.slice(0, cut) : "";
      name = cut > 0 ? path.slice(cut + 1) : path;
      if (!prefix || new TextEncoder().encode(name).length > 100 || new TextEncoder().encode(prefix).length > 155) {
        throw new RangeError(path);
      }
    }
    const header = new Uint8Array(512);
    writeField(header, 0, 100, name);
    writeField(header, 100, 8, `${octal(0o644, 8)}\0`);
    writeField(header, 108, 8, `${octal(0, 8)}\0`);
    writeField(header, 116, 8, `${octal(0, 8)}\0`);
    writeField(header, 124, 12, `${octal(entry.bytes.length, 12)}\0`);
    writeField(header, 136, 12, `${octal(0, 12)}\0`);
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    writeField(header, 257, 6, "ustar\0");
    writeField(header, 263, 2, "00");
    writeField(header, 345, 155, prefix);
    const sum = header.reduce((total, byte) => total + byte, 0);
    writeField(header, 148, 8, `${octal(sum, 7)}\0`);
    blocks.push(header, entry.bytes);
    const pad = (512 - (entry.bytes.length % 512)) % 512;
    if (pad) blocks.push(new Uint8Array(pad));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0));
  let offset = 0;
  for (const block of blocks) { out.set(block, offset); offset += block.length; }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(text);
}

async function fileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// ---------------------------------------------------------------------------
// 一次受治理写入（意图冻结、结果不明保留原键）
// ---------------------------------------------------------------------------

type SkillAction = {
  intent: ActionCommand | null;
  busy: boolean;
  submission: ActionSubmission | null;
  failure: WriteFailure | null;
  unknown: boolean;
  prepare: (command: Omit<ActionCommand, "idempotencyKey">) => void;
  cancel: () => void;
  submit: () => Promise<void>;
};

function useSkillAction(onSettled: () => void): SkillAction {
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
          setIntent(null); onSettled();
        }
      } catch (error) {
        const failed = writeFailure(error);
        setFailure(failed);
        if (failed.kind !== "unknown") setIntent(null);
      } finally { inFlight.current = false; setBusy(false); }
    },
  };
}

function ActionReview({ action, summary }: { action: SkillAction; summary: ReactNode }) {
  const t = useT();
  if (!action.intent) return null;
  return <div className="flex flex-col gap-2 rounded-md border p-3 text-sm" role="group" data-testid="skill-action-review">
    {summary}
    <p className="text-muted-foreground">{t("agents.admission")}</p>
    <div className="flex flex-wrap gap-2">
      <Button disabled={action.busy} onClick={() => void action.submit()}>
        {action.busy ? t("platform.loading") : action.unknown ? t("agents.retry") : t("agents.confirm")}</Button>
      {!action.busy && !action.unknown ? <Button onClick={action.cancel}>{t("agents.cancel")}</Button> : null}
    </div>
  </div>;
}

function ActionStatus({ action }: { action: SkillAction }) {
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  return <>
    {action.submission ? <p role="status" className="break-words text-sm">{action.unknown
      ? t("agents.unknown", { operation: action.submission.operationId })
      : t("agents.recorded", { execution: action.submission.actionExecutionId, operation: action.submission.operationId })}
      {action.submission.reason ? ` ${reasonText(action.submission.reason)}` : ""}</p> : null}
    {action.failure ? <p role={action.failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{action.failure.kind === "unknown"
      ? t("agents.unknown", { operation: action.failure.operationId ?? "—" })
      : t("agents.rejected", { reason: failureText(action.failure) })}</p> : null}
  </>;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function validSkillDefinition(row: SkillDefinitionView): boolean {
  return !!row && typeof row.resourceId === "string" && !!row.resourceId
    && typeof row.ownerPrincipalId === "string" && !!row.ownerPrincipalId
    && typeof row.stableSlug === "string" && validSkillSlug(row.stableSlug)
    && typeof row.displayName === "string" && !!row.displayName.trim()
    && (row.status === SkillDefinitionStatus.Active || row.status === SkillDefinitionStatus.Disabled)
    && Number.isSafeInteger(row.resourceVersion) && row.resourceVersion > 0
    && typeof row.catalogShared === "boolean"
    && (row.currentPublishedVersionAssetId === undefined
      || (typeof row.currentPublishedVersionAssetId === "string" && !!row.currentPublishedVersionAssetId));
}

export function validSkillVersion(row: SkillVersionView, resourceId?: string): boolean {
  return !!row && typeof row.assetId === "string" && !!row.assetId
    && typeof row.skillResourceId === "string" && (resourceId === undefined || row.skillResourceId === resourceId)
    && typeof row.stableSlug === "string" && validSkillSlug(row.stableSlug) && row.skillName === row.stableSlug
    && Number.isSafeInteger(row.ordinal) && row.ordinal > 0
    && Number.isSafeInteger(row.assetVersion) && row.assetVersion > 0
    && typeof row.description === "string" && !!row.description.trim()
    && typeof row.artifactDigest === "string" && /^[a-f0-9]{64}$/.test(row.artifactDigest)
    && Number.isSafeInteger(row.artifactByteSize) && row.artifactByteSize > 0
    && Array.isArray(row.capabilityRequirements) && row.capabilityRequirements.every(validRequirement)
    && Object.values(AgentVersionState).includes(row.state)
    && (row.state === AgentVersionState.Draft || row.canPublish !== true)
    && (row.state === AgentVersionState.Published || row.canRetire !== true);
}

const versionLabels = {
  [AgentVersionState.Draft]: "agents.version.draft",
  [AgentVersionState.Published]: "agents.version.published",
  [AgentVersionState.Retired]: "agents.version.retired",
} as const satisfies Record<AgentVersionState, PlatformMessageKey>;

export const violationLabels = {
  [SkillArtifactViolationCode.UnsupportedEncoding]: "skills.violation.unsupportedEncoding",
  [SkillArtifactViolationCode.UploadTooLarge]: "skills.violation.uploadTooLarge",
  [SkillArtifactViolationCode.ExpandedTooLarge]: "skills.violation.expandedTooLarge",
  [SkillArtifactViolationCode.ArchiveInvalid]: "skills.violation.archiveInvalid",
  [SkillArtifactViolationCode.EntryLimitExceeded]: "skills.violation.entryLimitExceeded",
  [SkillArtifactViolationCode.UnsafePath]: "skills.violation.unsafePath",
  [SkillArtifactViolationCode.LinkEntry]: "skills.violation.linkEntry",
  [SkillArtifactViolationCode.SpecialEntry]: "skills.violation.specialEntry",
  [SkillArtifactViolationCode.ExecutableEntry]: "skills.violation.executableEntry",
  [SkillArtifactViolationCode.ExtraEntry]: "skills.violation.extraEntry",
  [SkillArtifactViolationCode.MissingSkillMd]: "skills.violation.missingSkillMd",
  [SkillArtifactViolationCode.DuplicateSkillMd]: "skills.violation.duplicateSkillMd",
  [SkillArtifactViolationCode.SkillMdTooLarge]: "skills.violation.skillMdTooLarge",
  [SkillArtifactViolationCode.NotUtf8]: "skills.violation.notUtf8",
  [SkillArtifactViolationCode.ControlCharacter]: "skills.violation.controlCharacter",
  [SkillArtifactViolationCode.MissingFrontmatter]: "skills.violation.missingFrontmatter",
  [SkillArtifactViolationCode.InvalidFrontmatter]: "skills.violation.invalidFrontmatter",
  [SkillArtifactViolationCode.UnsupportedFrontmatterKey]: "skills.violation.unsupportedFrontmatterKey",
  [SkillArtifactViolationCode.NameMismatch]: "skills.violation.nameMismatch",
  [SkillArtifactViolationCode.MissingDescription]: "skills.violation.missingDescription",
  [SkillArtifactViolationCode.DescriptionTooLong]: "skills.violation.descriptionTooLong",
} as const satisfies Record<SkillArtifactViolationCode, PlatformMessageKey>;

export const installationSkillLabels = {
  [AgentInstallationSkillStatus.Effective]: "skills.installation.effective",
  [AgentInstallationSkillStatus.Disabled]: "skills.installation.disabled",
  [AgentInstallationSkillStatus.NoPermission]: "skills.installation.noPermission",
  [AgentInstallationSkillStatus.ProjectionFailed]: "skills.installation.projectionFailed",
  [AgentInstallationSkillStatus.RuntimeNotReady]: "skills.installation.runtimeNotReady",
} as const satisfies Record<AgentInstallationSkillStatus, PlatformMessageKey>;

// ---------------------------------------------------------------------------
// Skills 区（Agents 页内）
// ---------------------------------------------------------------------------

export function SkillsSection({ locked = false }: { locked?: boolean }) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const [revision, setRevision] = useState(0);
  const offset = offsets[pageIndex] ?? 0;
  const [state, reload] = useLoad(`skill-definitions:${offset}:${revision}`, () => client.skillDefinitions(offset));
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const data: SkillDefinitionPage | null = state.status === "ok" ? state.data : null;
  const page = data && Array.isArray(data.definitions) && data.definitions.every(validSkillDefinition)
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset)) ? data : null;
  const blocked = locked || busy;
  return <section className="flex flex-col gap-3" data-testid="skills-section" aria-labelledby="skills-section-title">
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <h2 id="skills-section-title" className="text-lg font-semibold">{t("skills.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("skills.description")}</p>
      </div>
      <Button disabled={blocked || state.status === "pending"} onClick={reload}>{t("platform.refresh")}</Button>
    </div>
    {state.status === "pending" ? <div className={GRID_CLASS} role="status" aria-label={t("platform.loading")}>
      <IdentityCardSkeleton footerSubtitleWidthClass="w-14" footerTitleWidthClass="w-24" />
      <IdentityCardSkeleton footerSubtitleWidthClass="w-20" footerTitleWidthClass="w-32" />
    </div>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <div className={GRID_CLASS} data-testid="skills-library">
          <CreateIdentityCard ariaLabel={t("skills.create")} label={t("skills.create")} dataTestId="new-skill-card"
            disabled={blocked} onClick={() => setCreateOpen(true)} />
          {page.definitions.map((row) => <AgentIdentityCard key={`${row.resourceId}:${row.resourceVersion}`}
            dataTestId={`skill-definition-${row.resourceId}`} label={row.displayName} subtitle={`$${row.stableSlug}`}
            ariaLabel={t("skills.open")} disabled={blocked} onClick={() => setSelected(row.resourceId)}
            avatar={<span aria-hidden className="text-2xl font-semibold text-muted-foreground">$</span>}
            statusBadge={row.status === SkillDefinitionStatus.Disabled ? <Badge tone="negative">{t("skills.status.disabled")}</Badge>
              : row.catalogShared ? <Badge tone="positive">{t("skills.shared")}</Badge> : null} />)}
        </div>
        {page.definitions.length === 0 ? <p className="text-sm text-muted-foreground">{t("skills.none")}</p> : null}
        <div className="flex gap-2">
          {pageIndex > 0 ? <Button disabled={blocked} onClick={() => { setSelected(null); setPageIndex(pageIndex - 1); }}>{t("roles.previous")}</Button> : null}
          {page.nextOffset !== undefined ? <Button disabled={blocked} onClick={() => {
            const next = page.nextOffset!;
            setSelected(null); setOffsets((old) => [...old.slice(0, pageIndex + 1), next]); setPageIndex(pageIndex + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
      </>}
    <SkillCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onLocked={setBusy}
      onRecorded={() => { setCreateOpen(false); setRevision((value) => value + 1); }} />
    <AgentManagementDialog open={selected !== null} title={t("skills.open")} locked={busy} onClose={() => setSelected(null)}
      dataTestId="skill-detail-dialog">
      {selected ? <SkillDetail resourceId={selected} onLocked={setBusy}
        onChanged={() => setRevision((value) => value + 1)} /> : null}
    </AgentManagementDialog>
  </section>;
}

function SkillCreateDialog({ open, onClose, onLocked, onRecorded }: {
  open: boolean; onClose: () => void; onLocked: (locked: boolean) => void; onRecorded: () => void;
}) {
  const t = useT();
  const id = useId();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const action = useSkillAction(() => { setName(""); setSlug(""); onRecorded(); });
  const pending = action.intent !== null || action.busy;
  useEffect(() => { onLocked(pending); }, [pending, onLocked]);
  const valid = !!name.trim() && name.trim().length <= 200 && validSkillSlug(slug);
  return <AgentManagementDialog open={open || pending || action.failure !== null} title={t("skills.create")} locked={pending}
    onClose={() => { action.cancel(); onClose(); }} dataTestId="skill-create-dialog">
    <section className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("skills.createBoundary")}</p>
      {!action.intent ? <form className="flex flex-col gap-3" onSubmit={(event) => {
        event.preventDefault();
        if (valid) action.prepare({ actionKey: "skill.definition.create", name: name.trim(), slug, explicitConfirmation: true });
      }}>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-name`}>{t("skills.name")}
          <input id={`${id}-name`} required value={name} maxLength={200} onChange={(event) => setName(event.target.value)} className={INPUT_CLASS} /></label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-slug`}>{t("skills.slug")}
          <input id={`${id}-slug`} required value={slug} maxLength={64} onChange={(event) => setSlug(event.target.value.toLowerCase())} className={`${INPUT_CLASS} font-mono`} />
          <span className="text-xs text-muted-foreground">{t("skills.slugHint")}</span></label>
        {slug && !validSkillSlug(slug) ? <p role="alert" className="text-sm">{t("skills.slugInvalid")}</p> : null}
        <Button type="submit" className="w-fit" disabled={!valid}>{t("agents.review")}</Button>
      </form> : null}
      <ActionReview action={action} summary={<p className="break-words">{t("skills.previewCreate", { name: action.intent?.name ?? "", slug: action.intent?.slug ?? "" })}</p>} />
      <ActionStatus action={action} />
    </section>
  </AgentManagementDialog>;
}

function SkillDetail({ resourceId, onLocked, onChanged }: {
  resourceId: string; onLocked: (locked: boolean) => void; onChanged: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [revision, setRevision] = useState(0);
  const [definitionState, reloadDefinition] = useLoad(`skill-definition:${resourceId}:${revision}`, () => client.skillDefinition(resourceId));
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const offset = offsets[pageIndex] ?? 0;
  const [versionsState, reloadVersions] = useLoad(`skill-versions:${resourceId}:${offset}:${revision}`, () => client.skillVersions(resourceId, offset));
  const [uploading, setUploading] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const recorded = () => { setRevision((value) => value + 1); setUploading(false); setUploadPending(false); onChanged(); };
  const action = useSkillAction(recorded);
  const pending = action.intent !== null || action.busy || uploadPending;
  useEffect(() => { onLocked(pending); }, [pending, onLocked]);
  const definition = definitionState.status === "ok" && validSkillDefinition(definitionState.data)
    && definitionState.data.resourceId === resourceId ? definitionState.data : null;
  const versionsData: SkillVersionPage | null = versionsState.status === "ok" ? versionsState.data : null;
  const versions = versionsData && versionsData.skillResourceId === resourceId && Array.isArray(versionsData.versions)
    && versionsData.versions.every((row) => validSkillVersion(row, resourceId))
    && (versionsData.nextOffset === undefined || (Number.isSafeInteger(versionsData.nextOffset) && versionsData.nextOffset > offset))
    ? versionsData : null;
  if (definitionState.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (!definition) return <ReadFailure error={definitionState.status === "error" ? definitionState.error : undefined} onRetry={reloadDefinition} />;
  const active = definition.status === SkillDefinitionStatus.Active;
  const target = { resourceId: definition.resourceId, resourceVersion: definition.resourceVersion, explicitConfirmation: true };
  const review: Record<string, PlatformMessageKey> = {
    "skill.definition.share": "skills.reviewShare", "skill.definition.unshare": "skills.reviewUnshare",
    "skill.definition.disable": "skills.reviewDisable", "skill.version.publish": "skills.reviewPublish",
    "skill.version.retire": "skills.reviewRetire",
  };
  return <section className="flex flex-col gap-3" data-testid="skill-detail">
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-base font-semibold">{definition.displayName}</h3>
      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">${definition.stableSlug}</code>
      <Badge tone={active ? "positive" : "negative"}>{t(active ? "skills.status.active" : "skills.status.disabled")}</Badge>
      {definition.catalogShared ? <Badge tone="neutral">{t("skills.shared")}</Badge> : null}
    </div>
    <p className="break-words text-sm">{t("agents.owner")}: {definition.ownerPrincipalId} · {t("agents.resourceVersion")}: {definition.resourceVersion}</p>
    <p className="text-sm text-muted-foreground">{t("skills.boundary")}</p>
    <div className="flex flex-wrap gap-2">
      {active && definition.canUpload === true ? <Button disabled={pending || uploading} onClick={() => setUploading(true)}>{t("skills.upload")}</Button> : null}
      {definition.canShare === true && active && !definition.catalogShared ? <Button disabled={pending}
        onClick={() => action.prepare({ actionKey: "skill.definition.share", ...target })}>{t("skills.share")}</Button> : null}
      {definition.canShare === true && definition.catalogShared ? <Button disabled={pending}
        onClick={() => action.prepare({ actionKey: "skill.definition.unshare", ...target })}>{t("skills.unshare")}</Button> : null}
      {active && definition.canDisable === true ? <Button disabled={pending}
        onClick={() => action.prepare({ actionKey: "skill.definition.disable", ...target })}>{t("skills.disable")}</Button> : null}
      <Button disabled={pending} onClick={() => { reloadDefinition(); reloadVersions(); }}>{t("platform.refresh")}</Button>
    </div>
    <ActionReview action={action} summary={<p className="break-words">{t(review[action.intent?.actionKey ?? ""] ?? "skills.reviewShare",
      { name: definition.displayName, version: String(action.intent?.assetVersion ?? definition.resourceVersion) })}</p>} />
    <ActionStatus action={action} />
    {uploading ? <SkillUpload definition={definition} onClose={() => { setUploading(false); setUploadPending(false); }}
      onLocked={setUploadPending} onRecorded={recorded} /> : null}
    <h4 className="text-sm font-medium">{t("agents.version.history")}</h4>
    {versionsState.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !versions ? <ReadFailure error={versionsState.status === "error" ? versionsState.error : undefined} onRetry={reloadVersions} />
      : versions.versions.length === 0 ? <p className="text-sm text-muted-foreground">{t("skills.noVersions")}</p>
      : <div className="flex flex-col divide-y divide-border/55 rounded-md border" data-testid="skill-versions">
        {versions.versions.map((version) => <SkillVersionRow key={version.assetId} version={version} locked={pending}
          onPublish={() => action.prepare({ actionKey: "skill.version.publish", ...target, assetId: version.assetId, assetVersion: version.assetVersion })}
          onRetire={() => action.prepare({ actionKey: "skill.version.retire", ...target, assetId: version.assetId, assetVersion: version.assetVersion })} />)}
      </div>}
    {versions ? <div className="flex gap-2">
      {pageIndex > 0 ? <Button disabled={pending} onClick={() => setPageIndex(pageIndex - 1)}>{t("roles.previous")}</Button> : null}
      {versions.nextOffset !== undefined ? <Button disabled={pending} onClick={() => {
        const next = versions.nextOffset!;
        setOffsets((old) => [...old.slice(0, pageIndex + 1), next]); setPageIndex(pageIndex + 1);
      }}>{t("roles.next")}</Button> : null}
    </div> : null}
  </section>;
}

function SkillVersionRow({ version, locked, onPublish, onRetire }: {
  version: SkillVersionView; locked: boolean; onPublish: () => void; onRetire: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [content, reload] = useLoad(`skill-content:${version.assetId}:${open}`,
    () => open ? client.skillVersionContent(version.assetId) : Promise.resolve(null));
  const text = content.status === "ok" && content.data && content.data.assetId === version.assetId
    && content.data.artifactDigest === version.artifactDigest && typeof content.data.content === "string" ? content.data.content : null;
  return <div className="flex flex-col gap-1.5 px-4 py-3" data-testid="skill-version" data-state={version.state}>
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium">v{version.ordinal}</span>
      <Badge tone={version.state === AgentVersionState.Published ? "positive" : "neutral"}>{t(versionLabels[version.state])}</Badge>
      {version.current ? <Badge tone="neutral">{t("skills.current")}</Badge> : null}
    </div>
    <p className="break-words text-sm">{version.shortDescription ?? version.description}</p>
    <p className="break-all font-mono text-xs text-muted-foreground">{t("skills.digest")}: {version.artifactDigest} · {t("skills.size", { bytes: String(version.artifactByteSize) })}</p>
    <p className="break-words text-xs text-muted-foreground">{t("agents.version.capabilities")}: {version.capabilityRequirements.join(", ") || "—"}</p>
    <div className="flex flex-wrap gap-2">
      <Button aria-expanded={open} onClick={() => setOpen(!open)}>{t(open ? "skills.hideContent" : "skills.viewContent")}</Button>
      {version.state === AgentVersionState.Draft && version.canPublish === true ? <Button disabled={locked} onClick={onPublish}>{t("agents.version.publish")}</Button> : null}
      {version.state === AgentVersionState.Published && version.canRetire === true ? <Button disabled={locked} onClick={onRetire}>{t("agents.version.retire")}</Button> : null}
    </div>
    {open ? content.status === "pending" ? <p role="status" className="text-sm">{t("platform.loading")}</p>
      : text === null ? <ReadFailure error={content.status === "error" ? content.error : undefined} onRetry={reload} />
      : <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs" data-testid="skill-content">{text}</pre> : null}
  </div>;
}

function SkillUpload({ definition, onClose, onLocked, onRecorded }: {
  definition: SkillDefinitionView; onClose: () => void; onLocked: (locked: boolean) => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const id = useId();
  const [reading, setReading] = useState(false);
  const [localError, setLocalError] = useState<PlatformMessageKey | null>(null);
  const [preview, setPreview] = useState<SkillArtifactUploadView | null>(null);
  const [uploadFailure, setUploadFailure] = useState<WriteFailure | null>(null);
  const [requirements, setRequirements] = useState("");
  const action = useSkillAction(() => { setPreview(null); onRecorded(); });
  const pending = action.intent !== null || action.busy || reading;
  useEffect(() => { onLocked(pending); }, [pending, onLocked]);
  const send = async (bytes: Uint8Array) => {
    setPreview(null); setUploadFailure(null); setLocalError(null);
    if (bytes.length === 0) { setLocalError("skills.violation.missingSkillMd"); return; }
    if (bytes.length > MAX_SKILL_UPLOAD_BYTES) { setLocalError("skills.violation.uploadTooLarge"); return; }
    setReading(true);
    try {
      const view = await client.uploadSkillArtifact(definition.resourceId, toBase64(bytes));
      if (!view || view.skillResourceId !== definition.resourceId || typeof view.accepted !== "boolean" || !Array.isArray(view.violations)
        || (view.accepted && (!view.uploadId || !view.artifactDigest || !/^[a-f0-9]{64}$/.test(view.artifactDigest) || view.skillName !== definition.stableSlug)))
        throw new TransportError(t("platform.loadFailed"));
      setPreview(view);
    } catch (error) {
      setUploadFailure(writeFailure(error));
    } finally { setReading(false); }
  };
  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await send(await fileBytes(file));
  };
  const onFolder = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length === 0) return;
    try {
      const entries = await Promise.all(files.map(async (file) => ({
        path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
        bytes: await fileBytes(file),
      })));
      await send(packTar(entries));
    } catch {
      setLocalError("skills.violation.unsafePath");
    }
  };
  const parsed = parseRequirements(requirements);
  const accepted = preview?.accepted === true ? preview : null;
  return <section className="flex flex-col gap-3 rounded-md border p-3" data-testid="skill-upload">
    <h4 className="text-sm font-medium">{t("skills.upload")}</h4>
    <p className="text-sm text-muted-foreground">{t("skills.uploadBoundary", { slug: definition.stableSlug })}</p>
    {!action.intent ? <div className="flex flex-wrap gap-3 text-sm">
      <label className="flex flex-col gap-1" htmlFor={`${id}-file`}>{t("skills.chooseFile")}
        <input id={`${id}-file`} type="file" disabled={pending} accept=".md,.tar,.tgz,.gz,text/markdown,application/x-tar,application/gzip"
          onChange={(event) => void onFile(event)} data-testid="skill-upload-file" /></label>
      <label className="flex flex-col gap-1" htmlFor={`${id}-folder`}>{t("skills.chooseFolder")}
        <input id={`${id}-folder`} type="file" multiple disabled={pending}
          {...{ webkitdirectory: "", directory: "" }}
          onChange={(event) => void onFolder(event)} data-testid="skill-upload-folder" /></label>
    </div> : null}
    {reading ? <p role="status" className="text-sm">{t("platform.loading")}</p> : null}
    {localError ? <p role="alert" className="text-sm">{t(localError)}</p> : null}
    {uploadFailure ? <p role="alert" className="text-sm">{t("skills.uploadFailed")}</p> : null}
    {preview && !preview.accepted ? <div role="alert" className="flex flex-col gap-1 text-sm" data-testid="skill-upload-violations">
      <p>{t("skills.rejected")}</p>
      <ul className="list-disc pl-5">{preview.violations.map((violation, index) =>
        <li key={`${violation.code}:${violation.path ?? ""}:${index}`}>{t(violationLabels[violation.code])}
          {violation.path ? <code className="ml-1 break-all text-xs">{violation.path}</code> : null}</li>)}</ul>
    </div> : null}
    {accepted && !action.intent ? <div className="flex flex-col gap-2 text-sm" data-testid="skill-upload-preview">
      <p className="break-words"><code>${accepted.skillName}</code> · {accepted.description}</p>
      {accepted.shortDescription ? <p className="break-words text-muted-foreground">{accepted.shortDescription}</p> : null}
      <p className="break-all font-mono text-xs">{t("skills.digest")}: {accepted.artifactDigest} · {t("skills.size", { bytes: String(accepted.artifactByteSize ?? 0) })}</p>
      <label className="flex flex-col gap-1" htmlFor={`${id}-requirements`}>{t("skills.requirements")}
        <input id={`${id}-requirements`} value={requirements} onChange={(event) => setRequirements(event.target.value)}
          placeholder="knowledge.search@v1" className={`${INPUT_CLASS} font-mono`} />
        <span className="text-xs text-muted-foreground">{t("skills.requirementsHint")}</span></label>
      {parsed === null ? <p role="alert">{t("skills.requirementsInvalid")}</p> : null}
      <div className="flex gap-2">
        <Button disabled={parsed === null} onClick={() => accepted.uploadId && accepted.artifactDigest && parsed && action.prepare({
          actionKey: "skill.version.create", resourceId: definition.resourceId, resourceVersion: definition.resourceVersion,
          explicitConfirmation: true,
          skillVersionUpload: { uploadId: accepted.uploadId, artifactDigest: accepted.artifactDigest, capabilityRequirements: parsed },
        })}>{t("agents.review")}</Button>
        <Button onClick={onClose}>{t("agents.cancel")}</Button>
      </div>
    </div> : !action.intent ? <Button className="w-fit" disabled={pending} onClick={onClose}>{t("agents.cancel")}</Button> : null}
    <ActionReview action={action} summary={<p className="break-words">{t("skills.previewUpload", {
      slug: definition.stableSlug, digest: action.intent?.skillVersionUpload?.artifactDigest ?? "" })}</p>} />
    <ActionStatus action={action} />
  </section>;
}

// ---------------------------------------------------------------------------
// Installation 详情的 Skill 投影状态（DD-135(7)）
// ---------------------------------------------------------------------------

function validInstallationSkillPage(page: AgentInstallationSkillPage, installation: string): boolean {
  return !!page && page.installationResourceId === installation && Array.isArray(page.skills)
    && (page.generation === undefined || (Number.isSafeInteger(page.generation) && page.generation > 0))
    && page.skills.every((skill) => !!skill && typeof skill.skillVersionAssetId === "string" && validSkillSlug(skill.stableSlug)
      && Number.isSafeInteger(skill.ordinal) && skill.ordinal > 0 && /^[a-f0-9]{64}$/.test(skill.artifactDigest)
      && typeof skill.projected === "boolean" && Object.values(AgentInstallationSkillStatus).includes(skill.status));
}

export function InstallationSkills({ installationId, locked }: { installationId: string; locked: boolean }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`agent-installation-skills:${installationId}`, () => client.agentInstallationSkills(installationId));
  const page = state.status === "ok" && validInstallationSkillPage(state.data, installationId) ? state.data : null;
  return <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="agent-installation-skills">
    <h4 className="text-sm font-medium">{t("skills.installation.title")}</h4>
    <p className="text-sm text-muted-foreground">{t("skills.installation.boundary")}</p>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <ReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : page.skills.length === 0 ? <p className="text-sm text-muted-foreground">{t("skills.installation.none")}</p>
      : <ul className="flex flex-col divide-y divide-border/55">
        {page.skills.map((skill) => <li key={skill.skillVersionAssetId} className="flex flex-wrap items-center gap-2 py-2 text-sm"
          data-testid="agent-installation-skill" data-status={skill.status}>
          <code>${skill.stableSlug}</code><span>v{skill.ordinal}</span>
          <Badge tone={skill.status === AgentInstallationSkillStatus.Effective ? "positive"
            : skill.status === AgentInstallationSkillStatus.RuntimeNotReady ? "neutral" : "negative"}>{t(installationSkillLabels[skill.status])}</Badge>
          <span className="break-all font-mono text-xs text-muted-foreground">{skill.artifactDigest.slice(0, 12)}</span>
        </li>)}
      </ul>}
    <Button className="w-fit" disabled={locked} onClick={reload}>{t("platform.refresh")}</Button>
  </section>;
}
