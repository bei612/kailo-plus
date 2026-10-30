// DD-135、05 §2.14、17 §8：Agents 页内的 Skills 区（Web/Desktop 共用）。
// 原版 Buzz 779af8886caae1317b4de962082429867ab61503 没有 Skills 管理界面（persona `skills`
// 只解析不执行，SF-BUZ-12）；本区沿用原 Agents 页的分区标题、身份卡片网格、虚线新建卡与
// 管理对话框（UnifiedAgentsSection / TeamsSection / CreateIdentityCard / AgentDefinitionDialogShell）。
// DD-170（.design/20 §16）：分区标题带计数与主操作、卡片网格分页、详情为页头 + 键值 + 版本表 + 技术信息，
// 停用、取消分享与退役走确认对话框；所有者显示为成员名，不平铺 UUID 或摘要。
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
import { Badge, Button, Cell, ConfirmDialog, DetailSkeleton, DetailHeader, EmptyState, ErrorState, IdText, KeyValueList, PageSection, Pagination,
  CardGridSkeleton, RefreshButton, Table, TableSkeleton, TagList, usePaged, CARD_PAGE_SIZES } from "./ui";
import { ListSearch } from "./data-table";
import { NoMatchState } from "./state-views";
import { useOffsetCollection } from "./use-offset-collection";
import { MoreMenu, PrincipalName, TechnicalDetails } from "./agents/detail-kit";
import { AgentCard, CARD_GRID_CLASS } from "./agents/agent-card";
import { Button as WorkflowButton } from "./profile/buzz/shared/ui/button";
import { useLoad } from "./use-load";
import { Plus, Sparkles, Upload } from "lucide-react";
import { AgentManagementDialog } from "./agent-library/AgentManagementDialog";

/** DD-141 §7: a Skill's identity tile is a single-colour Lucide glyph on the
 * same brand-soft squircle the Agent identity cards use, never a text sigil. */
function SkillGlyph() {
  return <span aria-hidden="true" data-testid="skill-identity-glyph"
    className="flex h-full w-full items-center justify-center rounded-[0.875rem] bg-brand-soft text-brand-soft-foreground">
    <Sparkles className="h-5 w-5" strokeWidth={1.75} />
  </span>;
}

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
  /** Freezes a new intent with a new idempotency key; returns it, or null while another is held. */
  prepare: (command: Omit<ActionCommand, "idempotencyKey">) => ActionCommand | null;
  cancel: () => void;
  /** Clears a settled or refused outcome; never an in-flight or UNKNOWN intent. */
  reset: () => void;
  /** Submits `frozen` (default: the held intent) — the same command and key on every re-check. */
  submit: (frozen?: ActionCommand | null) => Promise<void>;
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
      if (busy || intent) return null;
      const frozen = { ...command, idempotencyKey: newIdempotencyKey() } as ActionCommand;
      setIntent(frozen);
      setSubmission(null); setFailure(null);
      return frozen;
    },
    cancel: () => { if (!busy && !unknown) { setIntent(null); setFailure(null); } },
    reset: () => { if (!busy && !unknown) { setIntent(null); setSubmission(null); setFailure(null); } },
    submit: async (frozen: ActionCommand | null = intent) => {
      if (!frozen || inFlight.current) return;
      inFlight.current = true; setBusy(true);
      try {
        const result = await client.submitAction(frozen);
        if (!result || result.actionKey !== frozen.actionKey || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
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

/** Original AgentsView keeps one page-level Refresh; the page passes its revision so Skills reload with it. */
export function SkillsSection({ locked = false, refreshRevision = 0 }: { locked?: boolean; refreshRevision?: number }) {
  const client = useBffClient();
  const t = useT();
  const [revision, setRevision] = useState(0);
  // DD-170 §16.2(3): the offset-paged Skill directory is read to its end (bounded) and paged locally.
  const { state, reload, loadMore } = useOffsetCollection<SkillDefinitionView>(`skill-definitions:${revision}:${refreshRevision}`, async (offset) => {
    const data: SkillDefinitionPage = await client.skillDefinitions(offset);
    if (!data || !Array.isArray(data.definitions) || !data.definitions.every(validSkillDefinition)) throw new TransportError(t("platform.loadFailed"));
    return { items: data.definitions, nextOffset: data.nextOffset ?? undefined };
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const collection = state.status === "ok" ? state.data : null;
  const rows = collection?.items ?? [];
  const q = query.trim().toLocaleLowerCase();
  const filtered = q ? rows.filter((row) => `${row.displayName} ${row.stableSlug}`.toLocaleLowerCase().includes(q)) : rows;
  const paged = usePaged(filtered, { pageSize: CARD_PAGE_SIZES[0], resetKey: q });
  const blocked = locked || busy;
  const createButton = <WorkflowButton type="button" data-testid="new-skill-card" disabled={blocked} onClick={() => setCreateOpen(true)}>
    <Plus aria-hidden />{t("skills.create")}</WorkflowButton>;
  return <PageSection id="skills-section" testId="skills-section" title={t("skills.title")}
    description={collection ? t("skills.ui.count", { count: String(rows.length) }) : t("skills.ui.description")}
    actions={collection ? <>{rows.length > 0 ? <ListSearch value={query} onChange={setQuery} placeholder={t("skills.ui.search")} /> : null}{createButton}</> : undefined}>
    {state.status === "pending" ? <CardGridSkeleton cards={2} />
      : state.status === "error" ? <ErrorState error={state.error} onRetry={reload} />
      : rows.length === 0 ? <div className="rounded-xl border border-dashed border-border" data-testid="skills-library">
          <EmptyState icon={Sparkles} title={t("skills.none")} description={t("skills.ui.emptyBody")} action={createButton} />
        </div>
      : filtered.length === 0 ? <NoMatchState onClear={() => setQuery("")} />
      : <>
        <div className={CARD_GRID_CLASS} data-testid="skills-library">
          {paged.pageRows.map((row) => <AgentCard key={`${row.resourceId}:${row.resourceVersion}`}
            testId={`skill-definition-${row.resourceId}`} label={row.displayName} description={`$${row.stableSlug}`}
            ariaLabel={t("skills.open")} disabled={blocked} onClick={() => setSelected(row.resourceId)}
            avatar={<SkillGlyph />}
            status={row.status === SkillDefinitionStatus.Disabled ? <Badge tone="negative">{t("skills.status.disabled")}</Badge>
              : row.catalogShared ? <Badge tone="positive">{t("skills.shared")}</Badge> : <Badge tone="neutral">{t("skills.ui.private")}</Badge>} />)}
        </div>
        <Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} pageSizes={CARD_PAGE_SIZES}
          onPageChange={(page) => { setSelected(null); paged.setPage(page); }} onPageSizeChange={paged.setPageSize}
          partial={collection && !collection.complete ? <>{t("list.partial", { count: String(rows.length) })}{" "}
            <button type="button" className="text-brand-text hover:underline" onClick={loadMore}>{t("list.loadMore")}</button></> : undefined} />
      </>}
    <SkillCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onLocked={setBusy}
      onRecorded={() => { setCreateOpen(false); setRevision((value) => value + 1); }} />
    <AgentManagementDialog open={selected !== null} title={t("skills.open")} locked={busy} onClose={() => setSelected(null)}
      dataTestId="skill-detail-dialog">
      {selected ? <SkillDetail resourceId={selected} onLocked={setBusy}
        onChanged={() => setRevision((value) => value + 1)} /> : null}
    </AgentManagementDialog>
  </PageSection>;
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

type SkillDanger = { command: Omit<ActionCommand, "idempotencyKey">; title: string; body: string; label: string };

function SkillDetail({ resourceId, onLocked, onChanged }: {
  resourceId: string; onLocked: (locked: boolean) => void; onChanged: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [revision, setRevision] = useState(0);
  const [definitionState, reloadDefinition] = useLoad(`skill-definition:${resourceId}:${revision}`, () => client.skillDefinition(resourceId));
  const { state: versionsState, reload: reloadVersions, loadMore } = useOffsetCollection<SkillVersionView>(`skill-versions:${resourceId}:${revision}`, async (offset) => {
    const data: SkillVersionPage = await client.skillVersions(resourceId, offset);
    if (!data || data.skillResourceId !== resourceId || !Array.isArray(data.versions)
      || !data.versions.every((row) => validSkillVersion(row, resourceId))) throw new TransportError(t("platform.loadFailed"));
    return { items: data.versions, nextOffset: data.nextOffset ?? undefined };
  });
  const [uploading, setUploading] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const [danger, setDanger] = useState<SkillDanger | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const recorded = () => { setRevision((value) => value + 1); setUploading(false); setUploadPending(false); onChanged(); };
  const action = useSkillAction(recorded);
  const pending = action.intent !== null || action.busy || uploadPending;
  useEffect(() => { onLocked(pending); }, [pending, onLocked]);
  // A settled destructive request closes its confirmation; the re-read shows the outcome.
  const settled = danger !== null && action.intent === null && action.submission !== null && !action.unknown
    && action.submission.gateState === ActionGateState.Allowed;
  useEffect(() => { if (settled) setDanger(null); }, [settled]);
  const collection = versionsState.status === "ok" ? versionsState.data : null;
  const versions = collection && new Set(collection.items.map((row) => row.assetId)).size === collection.items.length
    ? [...collection.items].sort((a, b) => b.ordinal - a.ordinal) : null;
  const paged = usePaged(versions ?? []);
  const definition = definitionState.status === "ok" && validSkillDefinition(definitionState.data)
    && definitionState.data.resourceId === resourceId ? definitionState.data : null;
  if (definitionState.status === "pending") return <DetailSkeleton />;
  if (!definition) return <ErrorState error={definitionState.status === "error" ? definitionState.error : undefined} onRetry={reloadDefinition} />;
  const active = definition.status === SkillDefinitionStatus.Active;
  const target = { resourceId: definition.resourceId, resourceVersion: definition.resourceVersion, explicitConfirmation: true };
  // 确认文案按成员看到的版本序号（v{ordinal}）称呼版本；assetVersion 只是并发控制值。
  const reviewedAsset = action.intent?.assetId;
  const reviewedOrdinal = reviewedAsset ? versions?.find((row) => row.assetId === reviewedAsset)?.ordinal : undefined;
  const reviewedVersion = reviewedOrdinal !== undefined ? `v${reviewedOrdinal}` : "";
  const review: Record<string, PlatformMessageKey> = {
    "skill.definition.share": "skills.reviewShare", "skill.version.publish": "skills.reviewPublish",
  };
  const current = versions?.find((row) => row.current);
  const ask = (next: SkillDanger) => { if (!pending) { action.reset(); setDanger(next); } };
  const confirmDanger = () => {
    if (!danger || action.busy) return;
    if (action.intent) { void action.submit(); return; }
    if (action.failure || action.submission) { action.reset(); setDanger(null); return; }
    const frozen = action.prepare(danger.command);
    if (frozen) void action.submit(frozen);
  };
  const decided = danger !== null && action.intent === null && (action.failure !== null || action.submission !== null);
  return <section className="flex flex-col gap-6" data-testid="skill-detail">
    <DetailHeader title={definition.displayName}
      status={<span className="inline-flex items-center gap-1.5"><Badge tone={active ? "positive" : "negative"}>{t(active ? "skills.status.active" : "skills.status.disabled")}</Badge>
        {definition.catalogShared ? <Badge tone="brand">{t("skills.shared")}</Badge> : null}</span>}
      subtitle={<><PrincipalName principalId={definition.ownerPrincipalId} />{" · "}<code className="font-mono">${definition.stableSlug}</code></>}
      actions={<>
        {active && definition.canUpload === true ? <WorkflowButton type="button" disabled={pending || uploading} onClick={() => setUploading(true)}>
          <Upload aria-hidden />{t("skills.upload")}</WorkflowButton> : null}
        <MoreMenu disabled={pending} testId="skill-more" items={[
          definition.canShare === true && active && !definition.catalogShared && { key: "share", label: t("skills.share"),
            onSelect: () => { setDanger(null); action.prepare({ actionKey: "skill.definition.share", ...target }); } },
          definition.canShare === true && definition.catalogShared && { key: "unshare", label: t("skills.unshare"), danger: true,
            onSelect: () => ask({ command: { actionKey: "skill.definition.unshare", ...target }, label: t("skills.unshare"),
              title: t("skills.ui.unshareTitle", { name: definition.displayName }), body: t("skills.reviewUnshare", { name: definition.displayName }) }) },
          active && definition.canDisable === true && { key: "disable", label: t("skills.disable"), danger: true,
            onSelect: () => ask({ command: { actionKey: "skill.definition.disable", ...target }, label: t("skills.ui.disable"),
              title: t("skills.ui.disableTitle", { name: definition.displayName }), body: t("skills.reviewDisable", { name: definition.displayName }) }) },
          { key: "refresh", label: t("platform.refresh"), onSelect: () => { reloadDefinition(); reloadVersions(); } },
        ]} />
      </>} />
    {!danger ? <ActionReview action={action} summary={<p className="break-words">{t(review[action.intent?.actionKey ?? ""] ?? "skills.reviewShare",
      { name: definition.displayName, version: reviewedVersion })}</p>} /> : null}
    {!danger ? <ActionStatus action={action} /> : null}
    {uploading ? <SkillUpload definition={definition} onClose={() => { setUploading(false); setUploadPending(false); }}
      onLocked={setUploadPending} onRecorded={recorded} /> : null}
    <KeyValueList items={[
      { id: "slug", label: t("skills.ui.kv.slug"), value: <code className="font-mono text-[0.8125rem]">${definition.stableSlug}</code> },
      { id: "owner", label: t("agents.owner"), value: <PrincipalName principalId={definition.ownerPrincipalId} /> },
      { id: "visibility", label: t("skills.ui.kv.visibility"), value: t(definition.catalogShared ? "skills.ui.visibility.shared" : "skills.ui.visibility.private") },
      { id: "current", label: t("agents.ui.kv.currentVersion"), value: current ? `v${current.ordinal}` : t("skills.ui.noCurrent") },
    ]} />
    <PageSection title={t("agents.version.history")} description={t("skills.ui.versionsBoundary")}>
      {versionsState.status === "pending" ? <TableSkeleton rows={2} columns={4} />
        : !versions ? <ErrorState compact error={versionsState.status === "error" ? versionsState.error : undefined} onRetry={reloadVersions} />
        : versions.length === 0 ? <EmptyState compact icon={Sparkles} title={t("skills.noVersions")} description={t("skills.ui.noVersionsBody")} />
        : <div className="overflow-hidden rounded-xl border border-border bg-card" data-testid="skill-versions">
          <Table label={t("agents.version.history")} head={[t("agents.ui.col.version"), t("agents.ui.col.state"), t("skills.ui.col.description"),
            t("skills.ui.col.size"), t("skills.ui.col.requirements"), <span key="actions" className="sr-only">{t("list.actions")}</span>]}>
            {paged.pageRows.map((version) => <tr key={version.assetId} data-testid="skill-version" data-state={version.state}>
              <Cell nowrap><span className="font-medium">v{version.ordinal}</span></Cell>
              <Cell nowrap><span className="inline-flex items-center gap-1"><Badge tone={version.state === AgentVersionState.Published ? "positive"
                : version.state === AgentVersionState.Draft ? "info" : "neutral"}>{t(versionLabels[version.state])}</Badge>
                {version.current ? <Badge tone="brand">{t("skills.current")}</Badge> : null}</span></Cell>
              <Cell><span className="line-clamp-2 break-words" title={version.description}>{version.shortDescription ?? version.description}</span></Cell>
              <Cell nowrap><span className="tabular-nums text-muted-foreground">{formatBytes(version.artifactByteSize)}</span></Cell>
              <Cell>{version.capabilityRequirements.length ? <TagList items={version.capabilityRequirements} max={3} />
                : <span className="text-muted-foreground">{t("kv.none")}</span>}</Cell>
              <Cell nowrap><span className="flex items-center justify-end gap-1">
                <Button className="h-7 px-2.5 text-xs" aria-expanded={viewing === version.assetId}
                  onClick={() => setViewing(viewing === version.assetId ? null : version.assetId)}>{t(viewing === version.assetId ? "skills.hideContent" : "skills.viewContent")}</Button>
                {version.state === AgentVersionState.Draft && version.canPublish === true ? <Button className="h-7 px-2.5 text-xs" disabled={pending}
                  onClick={() => { setDanger(null); action.prepare({ actionKey: "skill.version.publish", ...target, assetId: version.assetId, assetVersion: version.assetVersion }); }}>
                  {t("agents.ui.version.publish")}</Button> : null}
                {version.state === AgentVersionState.Published && version.canRetire === true ? <MoreMenu disabled={pending}
                  label={t("agents.ui.version.actions", { ordinal: String(version.ordinal) })} items={[{ key: "retire", danger: true, label: t("agents.ui.version.retire"),
                    onSelect: () => ask({ command: { actionKey: "skill.version.retire", ...target, assetId: version.assetId, assetVersion: version.assetVersion },
                      label: t("agents.ui.version.retire"), title: t("skills.ui.retireTitle", { name: definition.displayName, version: `v${version.ordinal}` }),
                      body: t("skills.reviewRetire", { name: definition.displayName, version: `v${version.ordinal}` }) }) }]} /> : null}
              </span></Cell>
            </tr>)}
          </Table>
          <div className="border-t border-border px-3 py-2">
            <Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} onPageChange={paged.setPage} onPageSizeChange={paged.setPageSize}
              partial={collection && !collection.complete ? <>{t("list.partial", { count: String(versions.length) })}{" "}
                <button type="button" className="text-brand-text hover:underline" onClick={loadMore}>{t("list.loadMore")}</button></> : undefined} />
          </div>
        </div>}
      {viewing && versions?.some((row) => row.assetId === viewing)
        ? <SkillVersionContent key={viewing} version={versions.find((row) => row.assetId === viewing)!} /> : null}
    </PageSection>
    <TechnicalDetails items={[
      { id: "skill", label: t("skills.ui.tech.skill"), value: definition.resourceId },
      { id: "owner", label: t("agents.ui.tech.owner"), value: definition.ownerPrincipalId },
      ...(versions ?? []).flatMap((version) => [
        { id: `asset-${version.assetId}`, label: t("skills.ui.tech.version", { version: `v${version.ordinal}` }), value: version.assetId },
        { id: `digest-${version.assetId}`, label: t("skills.ui.tech.digest", { version: `v${version.ordinal}` }), value: version.artifactDigest },
      ]),
    ]} />
    <ConfirmDialog open={danger !== null} testId="skill-danger-confirm" pending={action.busy}
      onOpenChange={(open) => { if (!open && !action.busy && !action.unknown) { action.reset(); setDanger(null); } }}
      title={danger?.title ?? ""} description={danger?.body ?? ""}
      confirmLabel={action.unknown ? t("agents.retry") : decided ? t("agents.ui.close") : danger?.label ?? ""} onConfirm={confirmDanger}>
      {action.unknown ? <p role="status" className="break-words text-sm text-warning-text">{t("agents.unknown",
        { operation: action.submission?.operationId ?? (action.failure?.kind === "unknown" ? action.failure.operationId : undefined) ?? "—" })}</p>
        : action.failure?.kind === "rejected" ? <p role="alert" className="text-sm text-danger-text">{t("agents.rejected", { reason: failureText(action.failure) })}</p>
        : action.submission?.reason ? <p role="alert" className="text-sm text-danger-text">{reasonText(action.submission.reason)}</p> : null}
    </ConfirmDialog>
  </section>;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function SkillVersionContent({ version }: { version: SkillVersionView }) {
  const client = useBffClient();
  const t = useT();
  const [content, reload] = useLoad(`skill-content:${version.assetId}`, () => client.skillVersionContent(version.assetId));
  const text = content.status === "ok" && content.data && content.data.assetId === version.assetId
    && content.data.artifactDigest === version.artifactDigest && typeof content.data.content === "string" ? content.data.content : null;
  return <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4" data-testid="skill-version-content">
    <p className="text-sm font-medium">{t("skills.ui.contentOf", { version: `v${version.ordinal}` })}</p>
    {content.status === "pending" ? <DetailSkeleton lines={3} />
      : text === null ? <ErrorState compact error={content.status === "error" ? content.error : undefined} onRetry={reload} />
      : <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted/50 p-3 text-xs" data-testid="skill-content">{text}</pre>}
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

const installationSkillTones = {
  [AgentInstallationSkillStatus.Effective]: "positive",
  [AgentInstallationSkillStatus.Disabled]: "neutral",
  [AgentInstallationSkillStatus.NoPermission]: "warning",
  [AgentInstallationSkillStatus.ProjectionFailed]: "negative",
  [AgentInstallationSkillStatus.RuntimeNotReady]: "info",
} as const satisfies Record<AgentInstallationSkillStatus, "positive" | "neutral" | "warning" | "negative" | "info">;

export function InstallationSkills({ installationId, locked }: { installationId: string; locked: boolean }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`agent-installation-skills:${installationId}`, () => client.agentInstallationSkills(installationId));
  const page = state.status === "ok" && validInstallationSkillPage(state.data, installationId) ? state.data : null;
  return <div className="flex min-w-0 flex-col gap-3 rounded-xl border border-border bg-card p-4" data-testid="agent-installation-skills">
    <div className="flex items-center justify-end"><RefreshButton onClick={reload} pending={locked || state.status === "pending"} /></div>
    {state.status === "pending" ? <TableSkeleton rows={2} columns={3} />
      : !page ? <ErrorState compact error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : page.skills.length === 0 ? <EmptyState compact icon={Sparkles} title={t("skills.installation.none")} />
      : <Table label={t("skills.installation.title")} head={[t("skills.ui.col.skill"), t("agents.ui.col.version"), t("agents.ui.col.state"), t("skills.ui.col.digest")]}>
        {page.skills.map((skill) => <tr key={skill.skillVersionAssetId} data-testid="agent-installation-skill" data-status={skill.status}>
          <Cell nowrap><code className="font-mono text-[0.8125rem]">${skill.stableSlug}</code></Cell>
          <Cell nowrap>v{skill.ordinal}</Cell>
          <Cell nowrap><Badge tone={installationSkillTones[skill.status]}>{t(installationSkillLabels[skill.status])}</Badge></Cell>
          <Cell><IdText value={skill.artifactDigest} label={t("skills.ui.col.digest")} /></Cell>
        </tr>)}
      </Table>}
  </div>;
}
