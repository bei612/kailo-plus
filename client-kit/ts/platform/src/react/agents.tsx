// DD-24/25/45、17 §6–8：定义管理不等于安装或运行；两端只消费同一 BFF 和治理动作。
import {
  ActionDispatchState,
  ActionGateState,
  AgentVersionState,
  AgentInstallationState,
  AgentInstallationToolSource,
  AgentRuntimeProjectionState,
  AgentToolBindingStatus,
  AgentTrigger,
  AgentMemoryCoreWrite,
  AgentMemoryColdWrite,
  RuntimeProfileKind,
  AutomationVersionContentActionKind,
  AutomationStepAction,
  AutomationState,
  DelegationEffectiveState,
  AutomationScheduleSpecKind,
  AutomationResultTarget as ResultTarget,
  AutomationTriggerKind as TriggerKind,
  ReasonCode,
  ResourceState,
  DelegationScopeParametersResultExposureMode,
  TaskStatus,
  WorkflowKind,
  type ActionCommand,
  type ActionSubmission,
  type AgentDefinitionView,
  type AgentVersionView,
  type AgentVersionConfigurationPage,
  type AgentInstallationCandidate,
  type AgentInstallationCandidatePage,
  type AgentDelegationView,
  type DelegationScopeParameters,
  type AgentInstallationView,
  type AgentInstallationToolPage,
  type AutomationView,
  type AutomationDetailView,
  type AutomationVersionView,
  type AutomationVersionContent,
  type TaskView,
  type WorkspaceView,
  type PlatformToolPage,
  type PlatformToolView,
} from "@client-kit/contracts";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { consumePendingOpenCreateAgent, subscribeOpenCreateAgent } from "./open-create-agent-event";
import { parseDocument, stringify } from "yaml";
import { ArrowRight, BookUser, CalendarClock, Check, Code, GitPullRequest, MessageSquare, Pencil, Play, Plus, RefreshCw, SmilePlus, Upload, Webhook, X, Zap } from "lucide-react";
import { newIdempotencyKey, taskPhase } from "../governance";
import { relativeTime } from "../format";
import type { PlatformMessageKey } from "../i18n";
import { TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useCurrentPrincipalId, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, Cell, Notice, Table, ReadFailure as AgentReadFailure } from "./ui";
import { useLoad } from "./use-load";
import { InstallationMemory } from "./memory";
import { AgentInstallationUse } from "./agent-installation-use";
import { installationLabels, validInstallation } from "./agent-installation-view";
import { InstallationSessions } from "./agent-activity/InstallationSessions";
import { AgentLifecycleSection } from "./agent-activity/AgentLifecycleControls";
import { ConnectorGroupHeading, ToolManagement, groupTools, selectableTool, validPlatformToolPage } from "./tools";
import { InstallationSkills, SkillsSection, validSkillVersion } from "./skills";
import { WorkflowYamlEditor } from "./workflow-yaml-editor";
import { WorkflowsListSkeleton } from "./workflow-list-skeleton";
import { WorkflowFormCanvas, type WorkflowFormCanvasHandle } from "./workflow-form-canvas";
import { WorkflowTriggerConditions } from "./workflow-trigger-conditions";
import { reactionConditionValue } from "./workflow-reaction-condition";
import { getWorkflowActivationWarning } from "./workflow-activation-warning";
import { WorkflowActivationDialog } from "./workflow-activation-dialog";
import { WorkflowUnavailableDialog } from "./workflow-unavailable-dialog";
import { supportsMessageTextCondition } from "./workflow-message-text-condition";
import { useWorkflowTriggerPresentation } from "./workflow-trigger-presentation";
import { useWorkflowMessageScope } from "./workflow-message-host";
import { useWorkflowTriggerMessage } from "./workflow-message-picker";
import { normalizeMessageEventId } from "./workflow-message-candidates";
import { parseConditionExpressions, type ParsedConditionExpression } from "./workflow-condition-expression";
import { useWorkflowAuthorDirectory, type WorkflowAuthorDirectory } from "./workflow-author-directory";
import { WorkflowActionsMenu } from "./workflow-actions-menu";
import { WorkflowDiscardDialog, type WorkflowNavigation } from "./workflow-discard-dialog";
import { WorkflowDeleteDialog } from "./workflow-delete-dialog";
import { WorkflowWebhookSecretDialog, type WorkflowWebhookSecret } from "./workflow-webhook-secret-dialog";
import { Skeleton } from "./sidebar/skeleton";
import { ChannelCombobox } from "./workflow-channel-combobox";
import { ActionEmoji, WorkflowActionTileStack, WorkflowStatusToggle } from "./workflow-card-actions";
import { generateWorkflowName } from "./workflow-name";
import { workflowCardLabel, workflowTriggerSummary } from "./workflow-card-label";
import { Button as WorkflowButton } from "./profile/buzz/shared/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./composer/shared/ui/dialog";
import { AgentIdentityCard } from "./agent-library/AgentIdentityCard";
import { AgentsPageFrame } from "./agent-library/AgentsPageFrame";
import { AgentTeamsLibrary } from "./agent-library/AgentTeamsLibrary";
import { AgentCatalogDialog } from "./agent-library/AgentCatalogDialog";
import { CreateIdentityCard } from "./agent-library/CreateIdentityCard";
import { AgentManagementDialog } from "./agent-library/AgentManagementDialog";
import { AgentSnapshotImportDialog, agentSnapshotSource, type AgentSnapshotSource } from "./agent-library/AgentSnapshotImportDialog";
import { AgentSnapshotExportDialog, type SnapshotExportHost, type SnapshotExportTarget } from "./agent-library/AgentSnapshotExportDialog";
import { PersonaDropdownField } from "./agent-library/PersonaDropdownField";
import { PERSONA_FIELD_CONTROL_CLASS, PERSONA_FIELD_SHELL_CLASS } from "./agent-library/agentConfigOptions";
import { Textarea as AgentTextarea } from "./profile/buzz/shared/ui/textarea";
import { AgentCreationPreview } from "./agent-library/AgentCreationPreview";
import { AgentIdentityFields } from "./agent-library/AgentDescriptionField";
import { effectiveAgentDescription } from "./agent-library/agentDescription";
import { IdentityCardSkeleton } from "./agent-library/identity-card-skeleton";
import { AgentDefinitionAdvanced, AgentParallelismField } from "./agent-library/AgentDefinitionAdvanced";
import { AvatarHostProvider, type AvatarHost } from "./profile/avatar-host";
import { WorkflowScheduleFields } from "./workflow-schedule-fields";
import { defaultScheduleTrigger } from "./workflow-schedule";
import { formatDurationSeconds, parseDurationSeconds } from "./workflow-duration";
import { cronExpressionError, cronYamlError } from "./cron-expression";
import { supportedSteps, validApprovalPolicy, workflowApprovalPolicy, workflowAction, nextStepId, workflowStepsContent, validStepTimeout, type WorkflowStepDraft, type WorkflowActionKind } from "./workflow-steps";

// Original UnifiedAgentsSection grid at Buzz 779af8886caae1317b4de962082429867ab61503.
const IDENTITY_CARD_GRID_CLASS = "w-full grid-cols-1 [@container(min-width:21rem)]:grid-cols-2 [@container(min-width:32rem)]:grid-cols-3 [@container(min-width:43rem)]:grid-cols-4 [@container(min-width:54rem)]:grid-cols-5 grid gap-3";

function validDefinition(value: AgentDefinitionView): boolean {
  return !!value && typeof value.resourceId === "string" && !!value.resourceId
    && typeof value.displayName === "string" && typeof value.stableSlug === "string"
    && typeof value.ownerPrincipalId === "string" && !!value.ownerPrincipalId
    && Number.isSafeInteger(value.resourceVersion) && value.resourceVersion > 0
    && value.resourceState === ResourceState.Active && value.status === ResourceState.Active
    && (value.currentPublishedVersionAssetId === undefined
      || (typeof value.currentPublishedVersionAssetId === "string" && !!value.currentPublishedVersionAssetId));
}

// Core admits at most one EVALUATING/WAITING action per target, whatever its key
// (admission.action_execution_one_pending_per_target). A pending approval on the
// installation therefore blocks every other request on it until it settles.
function holdsTarget(task: TaskView, targetId: string | undefined): boolean {
  return targetId !== undefined && task.targetId === targetId
    && (task.gateState === ActionGateState.Evaluating || task.gateState === ActionGateState.Waiting);
}

function validDefinitionTask(task: TaskView): boolean {
  return !!task && typeof task.actionKey === "string"
    && typeof task.actionExecutionId === "string" && !!task.actionExecutionId
    && typeof task.operationId === "string" && !!task.operationId
    && typeof task.targetId === "string" && !!task.targetId
    && Object.values(ActionGateState).includes(task.gateState)
    && Object.values(ActionDispatchState).includes(task.dispatchState)
    && (task.taskStatus === undefined || Object.values(TaskStatus).includes(task.taskStatus))
    && (task.workflowId === undefined || (typeof task.workflowId === "string" && !!task.workflowId));
}

export type WorkspaceNavigation = {
  workspaceId?: string;
  onWorkspaceChange?: (workspaceId: string) => void;
};

/**
 * Buzz 779af8886caae1317b4de962082429867ab61503 app/routes/workflows.$workflowId.tsx:
 * the URL-addressable workflow target (detail, ?view=edit, ?view=duplicate).
 * The workspace is a navigation reference only; the authorized read decides it.
 */
export type WorkflowRoute = { workflowId: string; view?: "edit" | "duplicate"; workspaceId?: string };
export type WorkflowRouteNavigation = {
  workflowRoute?: WorkflowRoute | null;
  onWorkflowRouteChange?: (route: WorkflowRoute | null, workspaceId?: string) => void;
  /** Original /workflows?view=create: the governed create editor is the URL target. */
  workflowCreateRoute?: boolean;
  onWorkflowCreateRouteChange?: (open: boolean, workspaceId?: string) => void;
};

type AgentAvatarHost = (version?: AgentVersionView) => AvatarHost;

export function AgentDefinitionsPage(navigation: WorkspaceNavigation & {
  avatarHost?: AgentAvatarHost;
  /** DD-131(2)：READY 导出包的保存方式；缺省为同源受授权下载。 */
  snapshotExportHost?: SnapshotExportHost;
} = {}) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState<number[]>([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const offset = offsets[pageIndex] ?? 0;
  const [state, reload] = useLoad(`agent-definitions:${offset}`, () => client.agentDefinitions(offset));
  const [selected, setSelected] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [edit, setEdit] = useState<{ target: AgentDefinitionView; owner: boolean } | null>(null);
  const [locked, setLocked] = useState(false);
  const [versionEdit, setVersionEdit] = useState<VersionEdit | null>(null);
  const [versionLocked, setVersionLocked] = useState(false);
  const [versionRevision, setVersionRevision] = useState(0);
  const [installationLocked, setInstallationLocked] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  // DD-131(2): original "Import agent snapshot" from a local .agent.json/.agent.png file.
  const importInput = useRef<HTMLInputElement>(null);
  const [importSource, setImportSource] = useState<AgentSnapshotSource | null>(null);
  const [exportTarget, setExportTarget] = useState<SnapshotExportTarget | null>(null);
  const [importError, setImportError] = useState<"agents.snapshot.unsupportedFile" | "agents.snapshot.fileTooLarge" | null>(null);
  // DD-131(6): original CommunityCatalogDialog ("Choose from catalog"), opened on Agents or Teams.
  const [catalog, setCatalog] = useState<"agents" | "teams" | null>(null);
  const blocked = locked || versionLocked;
  // Original requestOpenCreateAgent (search Actions "Create a new agent"): open the same governed
  // create dialog the New agent card opens, only while that card would be enabled.
  const createAvailable = useRef(false);
  createAvailable.current = !blocked && edit === null && versionEdit === null;
  useEffect(() => {
    const open = () => { if (createAvailable.current) setCreateOpen(true); };
    if (consumePendingOpenCreateAgent()) open();
    return subscribeOpenCreateAgent(open);
  }, []);
  const data = state.status === "ok" ? state.data : null;
  const page = data && Array.isArray(data.definitions) && data.definitions.every(validDefinition)
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset))
    ? data : null;
  const nextOffset = page?.nextOffset;

  return (
    <AgentsPageFrame title={t("platform.tab.agents")} description={t("agents.description")} action={<div className="flex shrink-0 items-center gap-1">
        <WorkflowButton className="shrink-0" size="icon" variant="ghost" aria-label={t("agentCatalog.open")}
          title={t("agentCatalog.open")} data-testid="agents-catalog-open" disabled={blocked} onClick={() => setCatalog("agents")}>
          <BookUser aria-hidden className="h-4 w-4" />
        </WorkflowButton>
        <WorkflowButton className="shrink-0" size="icon" variant="ghost" aria-label={t("agents.snapshot.importTitle")}
          title={t("agents.snapshot.importTitle")} data-testid="agents-import-snapshot"
          disabled={blocked || importSource !== null} onClick={() => { setImportError(null); importInput.current?.click(); }}>
          <Upload aria-hidden className="h-4 w-4" />
        </WorkflowButton>
        <input ref={importInput} type="file" hidden accept=".json,.png,application/json,image/png" data-testid="agents-import-snapshot-file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void file.arrayBuffer().then((buffer) => {
              const next = agentSnapshotSource(file.name, new Uint8Array(buffer));
              if (next === "unsupported") setImportError("agents.snapshot.unsupportedFile");
              else if (next === "tooLarge") setImportError("agents.snapshot.fileTooLarge");
              else setImportSource(next);
            }, () => setImportError("agents.snapshot.unsupportedFile"));
          }} />
        <WorkflowButton className="shrink-0" size="icon" variant="ghost" aria-label={t("platform.refresh")}
          disabled={blocked || installationLocked || state.status === "pending"}
          onClick={() => { reload(); setRefreshRevision((value) => value + 1); }}>
          <RefreshCw aria-hidden className={`h-4 w-4 ${state.status === "pending" ? "animate-spin" : ""}`} />
        </WorkflowButton>
    </div>}>
      {importError ? <Notice role="alert">{t(importError)}</Notice> : null}
      <AgentSnapshotImportDialog source={importSource} onClose={() => setImportSource(null)}
        onImported={() => { reload(); setRefreshRevision((value) => value + 1); }} />
      <AgentSnapshotExportDialog target={exportTarget} host={navigation.snapshotExportHost} onClose={() => setExportTarget(null)} />
      {/* 写意图不随列表/详情刷新或翻页卸载；未知结果保留冻结版本与原幂等键。 */}
      <VersionAction edit={versionEdit} avatarHost={navigation.avatarHost} onReset={() => setVersionEdit(null)} onLocked={setVersionLocked}
        onRecorded={() => { setVersionRevision((value) => value + 1); reload(); }} />
      <section className="flex flex-col gap-3">
        {state.status === "pending" ? <div className={IDENTITY_CARD_GRID_CLASS} role="status" aria-label={t("platform.loading")}>
          <IdentityCardSkeleton footerSubtitleWidthClass="w-14" footerTitleWidthClass="w-24" />
          <IdentityCardSkeleton footerSubtitleWidthClass="w-20" footerTitleWidthClass="w-32" />
          <IdentityCardSkeleton footerSubtitleWidthClass="w-16" footerTitleWidthClass="w-28" />
        </div>
          : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
          : <>
              <div className={IDENTITY_CARD_GRID_CLASS} data-testid="agents-library-personas">
                <CreateIdentityCard ariaLabel={t("agents.create")} label={t("agents.create")}
                  dataTestId="new-agent-card" disabled={blocked || edit !== null || versionEdit !== null}
                  onClick={() => setCreateOpen(true)} />
                {page.definitions.map((row) => (
                  <DefinitionIdentityCard key={`${row.resourceId}:${row.resourceVersion}:${refreshRevision}:${versionRevision}`} row={row} avatarHost={navigation.avatarHost}
                    disabled={blocked || versionEdit !== null} onClick={() => setSelected(row.resourceId)} />
                ))}
              </div>
            <div className="flex gap-2">
              {pageIndex > 0 ? <Button disabled={blocked || versionEdit !== null} onClick={() => { setSelected(null); setPageIndex(pageIndex - 1); }}>{t("roles.previous")}</Button> : null}
              {nextOffset !== undefined ? <Button disabled={blocked || versionEdit !== null} onClick={() => {
                setSelected(null);
                setOffsets((old) => [...old.slice(0, pageIndex + 1), nextOffset]);
                setPageIndex(pageIndex + 1);
              }}>{t("roles.next")}</Button> : null}
            </div>
          </>}
      </section>
      {/* The action hook stays mounted when its presentation closes. UNKNOWN cannot close it. */}
      <DefinitionAction edit={edit} open={createOpen || edit !== null} onClose={() => { setCreateOpen(false); setEdit(null); }}
        externalBlocked={versionEdit !== null || versionLocked} onReset={() => setEdit(null)} onLocked={setLocked}
        onRecorded={() => { setSelected(null); reload(); }} />
      <AgentManagementDialog open={selected !== null}
        title={t("agents.open")} locked={blocked} onClose={() => setSelected(null)}>
        {selected ? <DefinitionDetail key={`${selected}:${versionRevision}`} resourceId={selected} locked={blocked || versionEdit !== null}
          onEdit={(target, owner) => { setSelected(null); setEdit({ target, owner }); }}
          onVersionEdit={(next) => { setSelected(null); setVersionEdit(next); }}
          onExport={(next) => { setSelected(null); setExportTarget(next); }} /> : null}
      </AgentManagementDialog>
      {/* DD-131(1)(6)：原版 Agents 页的团队区（新建、编辑、删除、部署到频道、分享到目录）。 */}
      <AgentTeamsLibrary refreshRevision={refreshRevision + versionRevision} locked={blocked || versionEdit !== null}
        snapshotExportHost={navigation.snapshotExportHost}
        onDiscover={() => setCatalog("teams")} />
      <AgentCatalogDialog open={catalog !== null} preferSection={catalog ?? "agents"} onOpenChange={(next) => { if (!next) setCatalog(null); }}
        onCreateAgent={() => { if (createAvailable.current) setCreateOpen(true); }}
        onImport={() => { setImportError(null); importInput.current?.click(); }}
        onRecorded={() => { reload(); setRefreshRevision((value) => value + 1); }} avatarHost={navigation.avatarHost} />
      {/* DD-135、17 §8：Skills 是 Agents 页内与定义并列的管理区。 */}
      <SkillsSection locked={blocked || versionEdit !== null} refreshRevision={refreshRevision} />
      <Button className="w-fit" disabled={blocked} onClick={() => setToolsOpen(true)}>{t("agents.tools.title")}</Button>
      <AgentManagementDialog open={toolsOpen} title={t("agents.tools.title")} onClose={() => setToolsOpen(false)}>
        <ToolManagement />
      </AgentManagementDialog>
      <InstallationManagement {...navigation} versionRevision={versionRevision} refreshRevision={refreshRevision} onLockedChange={setInstallationLocked} />
    </AgentsPageFrame>
  );
}

/** Original AgentPersonaCard identity face, backed by the authorized exact published Asset. */
function DefinitionIdentityCard({ row, disabled, onClick, avatarHost }: {
  row: AgentDefinitionView; disabled: boolean; onClick: () => void; avatarHost?: AgentAvatarHost;
}) {
  const client = useBffClient();
  const t = useT();
  const assetId = row.currentPublishedVersionAssetId;
  const [state, reload] = useLoad(`definition-card:${row.resourceId}:${row.resourceVersion}:${assetId ?? ""}`,
    () => assetId ? client.agentVersion(assetId) : Promise.resolve(null));
  const value = state.status === "ok" ? state.data : null;
  const version = value && validVersion(value, row.resourceId) && value.assetId === assetId
    && value.state === AgentVersionState.Published ? value : null;
  const card = <AgentIdentityCard dataTestId={`agent-definition-${row.resourceId}`}
    label={version?.content.personaIdentity.displayName ?? row.displayName}
    subtitle={version ? effectiveAgentDescription(version.content.personaIdentity) : null}
    avatarUrl={avatarHost ? version?.content.personaIdentity.avatarUrl : undefined}
    ariaLabel={t("agents.open")} disabled={disabled} onClick={onClick} />;
  return <div className="flex min-w-0 flex-col gap-2">
    {assetId && state.status === "pending" ? <IdentityCardSkeleton />
      : avatarHost && version ? <AvatarHostProvider value={avatarHost(version)}>{card}</AvatarHostProvider> : card}
    {assetId && state.status !== "pending" && !version ? <AgentReadFailure error={state.status === "error" ? state.error : undefined}
      onRetry={reload} /> : null}
  </div>;
}

const automationLabels = {
  [AutomationState.Draft]: "agents.automation.state.draft",
  [AutomationState.Enabled]: "agents.automation.state.enabled",
  [AutomationState.Paused]: "agents.automation.state.paused",
  [AutomationState.Disabled]: "agents.automation.state.disabled",
  [AutomationState.Deleted]: "agents.automation.state.deleted",
} as const satisfies Record<AutomationState, PlatformMessageKey>;
const automationVersionLabels = {
  [AgentVersionState.Draft]: "agents.automation.state.draft",
  [AgentVersionState.Published]: "agents.version.published",
  [AgentVersionState.Retired]: "agents.automation.version.retired",
} as const satisfies Record<AgentVersionState, PlatformMessageKey>;

export function validAutomation(row: AutomationView): boolean {
  return !!row && [row.resourceId, row.workspaceId, row.ownerPrincipalId, row.executorInstallationResourceId]
    .every((id) => typeof id === "string" && !!id)
    && Number.isSafeInteger(row.resourceVersion) && row.resourceVersion > 0
    && row.resourceState === ResourceState.Active && Object.values(AutomationState).includes(row.state)
    && [row.pinnedVersionAssetId, row.delegationId].every((id) => id === undefined || (typeof id === "string" && !!id))
    && [row.createdAt, row.updatedAt].every((time) => time === undefined
      || (typeof time === "string" && Number.isFinite(Date.parse(time))))
    && (row.state !== AutomationState.Enabled || (!!row.pinnedVersionAssetId && !!row.delegationId))
    // DD-116: only the public URL and four-character hint of an ACTIVE key.
    && (row.webhookUrl === undefined || (typeof row.webhookUrl === "string" && /^https?:\/\//.test(row.webhookUrl)))
    && (row.webhookSecretHint === undefined || (typeof row.webhookSecretHint === "string" && row.webhookSecretHint.length === 4));
}

function validSchedule(spec: unknown): spec is NonNullable<AutomationVersionContent["trigger"]["scheduleSpec"]> {
  if (!objectFields(spec, ["everySeconds", "offsetSeconds", "catchupWindowSeconds", "cron", "kind"])
    || typeof spec.catchupWindowSeconds !== "number" || !Number.isSafeInteger(spec.catchupWindowSeconds) || spec.catchupWindowSeconds < 10) return false;
  if (spec.kind === "CRON") return Object.keys(spec).length === 3
    && typeof spec.cron === "string" && !cronYamlError(spec.cron);
  return (spec.kind === undefined || spec.kind === "INTERVAL")
    && Object.keys(spec).length === (spec.kind === undefined ? 3 : 4) && typeof spec.everySeconds === "number"
    && typeof spec.offsetSeconds === "number" && Number.isSafeInteger(spec.everySeconds) && spec.everySeconds > 0
    && Number.isSafeInteger(spec.offsetSeconds) && spec.offsetSeconds >= 0 && spec.offsetSeconds < spec.everySeconds;
}

function validAutomationVersion(row: AutomationVersionView, parent: AutomationView): boolean {
  const content = row?.content;
  return !!row && row.automationResourceId === parent.resourceId
    && [row.assetId, row.ownerPrincipalId].every((id) => typeof id === "string" && !!id)
    && Number.isSafeInteger(row.assetVersion) && row.assetVersion > 0
    && Number.isSafeInteger(row.ordinal) && row.ordinal > 0
    && Object.values(AgentVersionState).includes(row.state)
    && typeof row.configHash === "string" && /^[0-9a-f]{64}$/.test(row.configHash)
    && validAutomationContent(content);
}

function objectFields(value: unknown, keys: string[]): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => keys.includes(key));
}

function validAutomationContent(value: unknown): value is AutomationVersionContent {
  if (!objectFields(value, ["name", "description", "trigger", "action", "resultTarget", "approvalPolicy", "formatVersion", "steps"])
    || !objectFields(value.trigger, ["kind", "textPrefix", "filter", "mentionPrincipalId", "scheduleSpec", "emoji"])) return false;
  if (value.formatVersion === 2 || value.formatVersion === 3 ? value.action !== undefined || !supportedSteps(value.steps, value.formatVersion)
    : value.formatVersion !== undefined || value.steps !== undefined || !objectFields(value.action, ["kind", "template"])
      || (value.action.kind !== AutomationVersionContentActionKind.AgentTurn && value.action.kind !== AutomationVersionContentActionKind.PostMessage)
      || typeof value.action.template !== "string" || !value.action.template.trim()) return false;
  if (Array.isArray(value.steps) && value.steps.some((step) => step.action === "request_approval") && value.approvalPolicy !== undefined) return false;
  if (Array.isArray(value.steps) && value.steps.some((step) => step.action === "add_reaction") && value.trigger.kind === TriggerKind.Schedule) return false;
  // The generated contract remains the data model; this is the existing form's
  // accepted subset, also used for authorized read and YAML input.
  const content = value;
  const trigger = value.trigger;
  return (value.name === undefined || (typeof value.name === "string" && !!value.name.trim()))
    && (value.description === undefined || typeof value.description === "string")
    && (trigger.textPrefix === undefined || (typeof trigger.textPrefix === "string" && !!trigger.textPrefix))
    && (trigger.filter === undefined || (typeof trigger.filter === "string" && !!trigger.filter.trim()
      && new TextEncoder().encode(trigger.filter).length <= 4096))
    && (trigger.kind === TriggerKind.Mention
      ? typeof trigger.mentionPrincipalId === "string" && !!trigger.mentionPrincipalId
      : trigger.mentionPrincipalId === undefined)
    && (content.approvalPolicy === undefined || (objectFields(content.approvalPolicy, ["id", "version"])
      && typeof content.approvalPolicy.id === "string" && typeof content.approvalPolicy.version === "number"
      && validApprovalPolicy({ id: content.approvalPolicy.id, version: content.approvalPolicy.version })))
    && (trigger.kind === TriggerKind.Schedule
      ? content.resultTarget === ResultTarget.Channel && trigger.textPrefix === undefined && trigger.filter === undefined
        && validSchedule(trigger.scheduleSpec)
      // DD-116, fixed Buzz TriggerDef::Webhook: no message filter; replies in the Channel.
      : trigger.kind === TriggerKind.Webhook
        ? content.resultTarget === ResultTarget.Channel && trigger.textPrefix === undefined && trigger.filter === undefined
          && trigger.scheduleSpec === undefined && content.action === undefined
          && !(Array.isArray(content.steps) && content.steps.some((step: { action?: unknown }) => step.action === "add_reaction"))
      : (trigger.kind === TriggerKind.ChannelMessage || trigger.kind === TriggerKind.Mention
        || ((trigger.kind === TriggerKind.DiffPosted || trigger.kind === TriggerKind.ReactionAdded) && trigger.textPrefix === undefined))
        && content.resultTarget === ResultTarget.TriggerThread && trigger.scheduleSpec === undefined)
    && (trigger.emoji === undefined || (trigger.kind === TriggerKind.ReactionAdded
      && typeof trigger.emoji === "string" && !!trigger.emoji.trim()));
}

function automationFromYaml(text: string): AutomationVersionContent | null {
  try {
    const document = parseDocument(text);
    if (document.errors.length || document.warnings.length) return null;
    const content: unknown = document.toJS();
    return validAutomationContent(content) ? content : null;
  } catch { return null; }
}

export function validAutomationDetail(value: AutomationDetailView, resource: string, workspace: string): boolean {
  const parent = value?.automation;
  return !!value && !!parent && validAutomation(parent) && parent.resourceId === resource && parent.workspaceId === workspace
    && typeof value.canManage === "boolean"
    && (value.canRun === undefined || typeof value.canRun === "boolean")
    && (value.canRun !== true || parent.state === AutomationState.Enabled)
    && (parent.state !== AutomationState.Deleted || !value.canManage)
    && Array.isArray(value.versions)
    && value.versions.every((row) => validAutomationVersion(row, parent))
    && new Set(value.versions.map((row) => row.assetId)).size === value.versions.length
    && Array.isArray(value.delegations) && value.delegations.every((row) => row
      && typeof row.delegationId === "string" && !!row.delegationId
      && Number.isSafeInteger(row.delegationVersion) && row.delegationVersion > 0
      && row.ownerPrincipalId === parent.ownerPrincipalId
      && row.executorInstallationResourceId === parent.executorInstallationResourceId
      && Number.isFinite(new Date(row.expiresAt).getTime()))
    && new Set(value.delegations.map((row) => row.delegationId)).size === value.delegations.length;
}

type AutomationEdit = { detail: AutomationDetailView; action: "enable" | "pause" | "disable" | "delete" | "run" | "rotate_webhook_secret" }
  | { detail: AutomationDetailView; action: "publish_version"; content?: AutomationVersionView["content"] }
  | { detail: AutomationDetailView; action: "copy"; content: AutomationVersionView["content"] };

export function AutomationManagement({ renderRunHistory, workspaceId, onWorkspaceChange, workflowNavigation, workflowRoute, onWorkflowRouteChange,
  workflowCreateRoute = false, onWorkflowCreateRouteChange }:
  WorkspaceNavigation & WorkflowRouteNavigation & {
  renderRunHistory?: (resourceId: string, workspaceId: string, receipt?: ActionSubmission) => ReactNode;
  workflowNavigation?: WorkflowNavigation;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("automation-workspaces", client.workspaces);
  const [selected, setSelected] = useState<string | null>(null);
  const [edit, setEdit] = useState<AutomationEdit | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [revision, setRevision] = useState(0);
  const [selectedAutomation, setSelectedAutomation] = useState<string | null>(null);
  // DD-116: the one response that carries a new webhook key; it is never reloaded.
  const [webhookSecret, setWebhookSecret] = useState<WorkflowWebhookSecret | null>(null);
  const [runReceipt, setRunReceipt] = useState<{ resourceId: string; workspaceId: string; submission: ActionSubmission } | null>(null);
  const data = state.status === "ok" ? state.data : null;
  const workspaces = data && Array.isArray(data) && data.every((w) => w && typeof w.id === "string" && !!w.id
    && typeof w.name === "string" && typeof w.slug === "string") && new Set(data.map((w) => w.id)).size === data.length ? data : null;
  const routed = !!onWorkflowRouteChange;
  const selection = routed && workflowRoute?.workspaceId ? workflowRoute.workspaceId
    : onWorkspaceChange ? workspaceId : selected ?? workspaceId;
  const workspace = selection ? workspaces?.find((w) => w.id === selection) : workspaces?.[0];
  // A routed target's detail is shown only after its own authorized read placed
  // it in this workspace; an editor view opens the existing governed editor.
  const [resolvedRoute, setResolvedRoute] = useState<string | null>(null);
  const routeKey = workflowRoute ? `${workflowRoute.workflowId}:${workflowRoute.view ?? ""}:${workflowRoute.workspaceId ?? ""}` : null;
  const shownAutomation = routed ? (workflowRoute && !workflowRoute.view && resolvedRoute === routeKey ? workflowRoute.workflowId : null)
    : selectedAutomation;
  const selectAutomation = (resourceId: string | null) => {
    if (!routed) { setSelectedAutomation(resourceId); return; }
    onWorkflowRouteChange?.(resourceId && workspace ? { workflowId: resourceId, workspaceId: workspace.id } : null, workspace?.id);
  };
  useEffect(() => {
    // Host search changes only after its router resolver accepts navigation.
    // Do not erase the current draft when a requested scope change is blocked.
    if (!locked) { setEdit(null); setEditorOpen(false); setSelectedAutomation(null); setRunReceipt(null); }
  }, [selection]);
  // Original /workflows?view=create opens the same governed create editor as the list's New workflow.
  const createRouted = !!onWorkflowCreateRouteChange;
  useEffect(() => {
    if (createRouted && workflowCreateRoute && workspace && !locked) { setEdit(null); setEditorOpen(true); }
  }, [createRouted, workflowCreateRoute, workspace?.id]);
  return <section className="mx-auto w-full max-w-6xl space-y-8 [container-type:inline-size]" data-testid="agent-automations">
    {/* Buzz WorkflowsView has one trailing refresh. The host supplies the page title. */}
    <div className="flex min-w-0 items-start justify-between gap-4">
      <div className="min-w-0 space-y-3">
        <p className="text-base font-normal text-muted-foreground">{t("agents.automation.scope")}</p>
        {workspace ? <label className="flex flex-wrap items-center gap-2 text-sm">{t("platform.workspace")}
          <select className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2" disabled={locked} value={workspace.id}
            onChange={(event) => { if (onWorkspaceChange) onWorkspaceChange(event.target.value); else setSelected(event.target.value); }}>
            {workspaces?.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label> : null}
      </div>
      <WorkflowButton className="shrink-0" size="icon" variant="ghost" aria-label={t("platform.refresh")}
        disabled={locked || state.status === "pending"} onClick={() => { reload(); setRevision((old) => old + 1); }}>
        <RefreshCw aria-hidden className={`h-4 w-4 ${state.status === "pending" ? "animate-spin" : ""}`} />
      </WorkflowButton>
    </div>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !workspaces ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : !workspace ? <Notice>{t("platform.noWorkspace")}</Notice> : null}
    {/* 未知写意图不随 Workspace、列表或详情重载卸载。 */}
    {routed && workflowRoute && workspaces && resolvedRoute !== routeKey ? <WorkflowRouteTarget key={routeKey} route={workflowRoute}
      workspaces={workspaces} onClose={() => onWorkflowRouteChange?.(null, workspace?.id)}
      onResolved={(detail) => {
        if (detail.automation.workspaceId !== workflowRoute.workspaceId) {
          onWorkflowRouteChange?.({ ...workflowRoute, workspaceId: detail.automation.workspaceId }, detail.automation.workspaceId);
          return;
        }
        setResolvedRoute(routeKey);
        if (workflowRoute.view) {
          const version = detail.automation.pinnedVersionAssetId
            ? detail.versions.find((candidate) => candidate.assetId === detail.automation.pinnedVersionAssetId) : detail.versions[0];
          if (!version || (workflowRoute.view === "edit" && !detail.canManage)) {
            onWorkflowRouteChange?.({ workflowId: workflowRoute.workflowId, workspaceId: detail.automation.workspaceId }, detail.automation.workspaceId);
            return;
          }
          setEdit({ detail, action: workflowRoute.view === "edit" ? "publish_version" : "copy", content: version.content });
          setEditorOpen(true);
        }
      }} /> : null}
    <AutomationAction workspaceId={workspace?.id} workspaces={workspaces} edit={edit} open={editorOpen} workflowNavigation={workflowNavigation}
      onClose={() => {
        setEditorOpen(false);
        if (routed && workflowRoute?.view) onWorkflowRouteChange?.(null, workspace?.id);
        if (createRouted && workflowCreateRoute) onWorkflowCreateRouteChange?.(false, workspace?.id);
      }}
      onReset={() => { setEdit(null); setEditorOpen(false); }} onLocked={setLocked}
      onSwitch={(value) => { setEdit(value); setEditorOpen(true); }}
      onRecorded={(command, submission) => {
        const issued = submission.webhookSecret;
        if ((command.actionKey === "automation.enable" || command.actionKey === "automation.rotate_webhook_secret")
          && issued && issued.automationResourceId === command.resourceId
          && /^whsec_[A-Za-z0-9+/]{43}=$/.test(issued.secret)) {
          setWebhookSecret({ automationResourceId: issued.automationResourceId, secret: issued.secret, url: issued.url });
        }
        if (command.actionKey === "automation.run" && command.resourceId && command.workspaceId
          && submission.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.Dispatched) {
          selectAutomation(command.resourceId);
          setRunReceipt({ resourceId: command.resourceId, workspaceId: command.workspaceId, submission });
        } else { selectAutomation(null); setRunReceipt(null); }
        setEdit(null); setEditorOpen(false); setRevision((old) => old + 1);
        // A recorded edit/copy leaves its ?view= target, as the original editor closes back.
        if (routed && workflowRoute?.view && command.actionKey !== "automation.run") onWorkflowRouteChange?.(null, workspace?.id);
        // A routed list selection above already leaves ?view=create; otherwise close it here.
        if (createRouted && workflowCreateRoute && !routed) onWorkflowCreateRouteChange?.(false, workspace?.id);
        if (command.actionKey === "automation.create" && command.workspaceId
          && submission.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.Dispatched
          && workspaces?.some((candidate) => candidate.id === command.workspaceId)) {
          if (onWorkspaceChange) onWorkspaceChange(command.workspaceId);
          else setSelected(command.workspaceId);
        }
      }} />
    {webhookSecret ? <WorkflowWebhookSecretDialog secret={webhookSecret} onContinue={() => setWebhookSecret(null)} /> : null}
    {workspace ? <AutomationList key={`${workspace.id}:${revision}`} workspaceId={workspace.id} workspaceName={workspace.name} locked={locked}
      selected={shownAutomation} onSelect={selectAutomation}
      onCreate={() => {
        if (createRouted) onWorkflowCreateRouteChange?.(true, workspace.id);
        else { setEdit(null); setEditorOpen(true); }
      }}
      onEdit={(value) => { setEdit(value); setEditorOpen(true); }}
      renderRunHistory={renderRunHistory ? (resourceId, workspaceId) => renderRunHistory(resourceId, workspaceId,
        runReceipt?.resourceId === resourceId && runReceipt.workspaceId === workspaceId ? runReceipt.submission : undefined) : undefined} /> : null}
  </section>;
}

/**
 * Original WorkflowEditorHost for a URL target: its authorized read shows the
 * original loading/unavailable dialog and never substitutes another workflow.
 */
function WorkflowRouteTarget({ route, workspaces, onResolved, onClose }: {
  route: WorkflowRoute; workspaces: WorkspaceView[];
  onResolved: (detail: AutomationDetailView) => void; onClose: () => void;
}) {
  const client = useBffClient();
  const [state, reload] = useLoad(`workflow-route:${route.workflowId}`, () => client.automation(route.workflowId, 0, 0));
  const value = state.status === "ok" ? state.data : null;
  const detail = value && value.automation && workspaces.some((candidate) => candidate.id === value.automation.workspaceId)
    && validAutomationDetail(value, route.workflowId, value.automation.workspaceId) ? value : null;
  const resolved = useRef(false);
  useEffect(() => {
    if (detail && !resolved.current) { resolved.current = true; onResolved(detail); }
  }, [detail]);
  if (detail) return null;
  return <WorkflowUnavailableDialog loading={state.status === "pending"} open
    onOpenChange={(open) => { if (!open) onClose(); }} onRetry={reload} />;
}

function AutomationList({ workspaceId, workspaceName, locked, onCreate, onEdit, renderRunHistory, selected, onSelect }: {
  workspaceId: string; workspaceName: string; locked: boolean; onCreate: () => void; onEdit: (edit: AutomationEdit) => void;
  selected: string | null; onSelect: (resourceId: string | null) => void;
  renderRunHistory?: (resourceId: string, workspaceId: string) => ReactNode;
}) {
  const client = useBffClient();
  const t = useT();
  const authors = useWorkflowAuthorDirectory(workspaceId);
  const [unavailable, setUnavailable] = useState(false);
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`automations:${workspaceId}:${offset}`, () => client.automations(workspaceId, offset));
  const data = state.status === "ok" ? state.data : null;
  const page = data && Array.isArray(data.automations) && data.automations.every((row) => validAutomation(row) && row.workspaceId === workspaceId)
    && typeof data.canCreate === "boolean" && new Set(data.automations.map((row) => row.resourceId)).size === data.automations.length
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset)) ? data : null;
  const next = page?.nextOffset;
  return <div className="flex flex-col gap-3">
    {state.status === "pending" ? <WorkflowsListSkeleton />
      : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {/* Original Buzz WorkflowsView grid/CreateWorkflowCard and WorkflowCard surface.
            Metadata comes only from AutomationView; absent names/triggers are not invented. */}
        <div className="grid grid-cols-1 gap-3 [@container(min-width:42rem)]:grid-cols-2 [@container(min-width:63rem)]:grid-cols-3">
          {page.canCreate ? <button type="button" disabled={locked} aria-label={t("agents.automation.create")}
            className="group relative flex min-h-60 w-full min-w-0 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-border/80 bg-transparent text-muted-foreground shadow-xs transition-colors hover:border-border hover:bg-muted/70 hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="new-workflow-card" onClick={onCreate}><Plus aria-hidden className="h-7 w-7 transition-colors" /></button> : null}
          {page.automations.map((row) => <AutomationCard key={row.resourceId} row={row} workspaceName={workspaceName}
            authors={authors} locked={locked} onView={() => onSelect(row.resourceId)} onEdit={onEdit} />)}
        </div>
        {page.automations.length === 0 && !page.canCreate ? <Notice>{t("agents.automation.none")}</Notice> : null}
        <div className="flex gap-2">
          {index > 0 ? <Button disabled={locked} onClick={() => { onSelect(null); setIndex(index - 1); }}>{t("roles.previous")}</Button> : null}
          {next !== undefined ? <Button disabled={locked} onClick={() => {
            onSelect(null); setOffsets((old) => [...old.slice(0, index + 1), next]); setIndex(index + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
      </>}
    {/* Original WorkflowEditorHost: an unreadable target shows WorkflowUnavailableDialog. */}
    <WorkflowUnavailableDialog loading={false} open={selected !== null && unavailable}
      onOpenChange={(open) => { if (!open) { setUnavailable(false); onSelect(null); } }}
      onRetry={() => setUnavailable(false)} />
    <Dialog open={selected !== null && !unavailable} onOpenChange={(open) => { if (!open && !locked) onSelect(null); }}>
      <DialogContent className="flex h-[88vh] max-h-[88vh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0"
        showCloseButton={false} onEscapeKeyDown={(event) => { if (locked) event.preventDefault(); }}
        onInteractOutside={(event) => { if (locked) event.preventDefault(); }} aria-describedby={undefined}>
        <DialogTitle className="sr-only">{t("workflows.definition")}</DialogTitle>
        {selected && !unavailable ? <AutomationDetail key={selected} resourceId={selected} workspaceId={workspaceId} locked={locked}
          onUnavailable={() => setUnavailable(true)}
          onEdit={(edit) => { onSelect(null); onEdit(edit); }} onClose={() => onSelect(null)} renderRunHistory={renderRunHistory} /> : null}
      </DialogContent>
    </Dialog>
  </div>;
}

/** Original WorkflowCard semantic content, read through the existing Asset-authorized reader. */
function AutomationCard({ row, workspaceName, authors, locked, onView, onEdit }: {
  row: AutomationView; workspaceName: string; locked: boolean; onView: () => void;
  authors: WorkflowAuthorDirectory;
  onEdit: (edit: AutomationEdit) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad(`automation-card:${row.resourceId}:${row.resourceVersion}`,
    () => client.automation(row.resourceId, 0, 0));
  const [triggerAnimationSequence, setTriggerAnimationSequence] = useState(0);
  const [activationOpen, setActivationOpen] = useState(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<unknown>();
  const openRequest = useRef(0);
  useEffect(() => {
    openRequest.current += 1;
    setOpening(false); setOpenError(undefined);
    return () => { openRequest.current += 1; };
  }, [client, row.resourceId, row.resourceVersion, row.workspaceId, locked]);
  const value = state.status === "ok" ? state.data : null;
  const detail = value && validAutomationDetail(value, row.resourceId, row.workspaceId)
    && value.automation.resourceVersion === row.resourceVersion ? value : null;
  // An unpinned draft uses its latest readable immutable version. Never replace
  // an unreadable executing pin with another draft's label or action content.
  const version = row.pinnedVersionAssetId
    ? detail?.versions.find((version) => version.assetId === row.pinnedVersionAssetId)
    : detail?.versions[0];
  const content = version?.content;
  // Original WorkflowCard author/message presentations for the condition sentence.
  const conditions = content?.trigger.filter ? parseConditionExpressions(content.trigger.filter,
    content.trigger.kind === TriggerKind.DiffPosted ? "diff_posted"
      : content.trigger.kind === TriggerKind.ReactionAdded ? "reaction_added" : "message_posted") : undefined;
  const authorCondition = conditions?.find(condition => condition.field === "trigger_author");
  // Original workflowDefinition.ts::getWorkflowTriggerEmoji: legacy emoji, else the equals condition.
  const triggerEmoji = content?.trigger.kind !== TriggerKind.ReactionAdded ? null
    : content.trigger.emoji?.trim() || conditions?.find(condition => condition.field === "trigger_emoji"
      && condition.operator === "equals")?.value.trim() || null;
  const messageCondition = conditions?.find(condition => condition.field === "trigger_message_id");
  const messageScope = useWorkflowMessageScope(messageCondition ? row.workspaceId : undefined);
  const message = useWorkflowTriggerMessage(messageCondition ? normalizeMessageEventId(messageCondition.value) : null, messageScope.scope);
  // Reuse the existing scoped directory. An unresolved authorized definition
  // reference falls back to the original compact npub, never an unscoped read.
  const authorLabel = authorCondition ? authors.rows.find(author => author.pubkey === authorCondition.value)?.displayName?.trim() : undefined;
  const openAction = async (action: AutomationEdit["action"]) => {
    if (locked || opening || !detail) return;
    const request = ++openRequest.current;
    setOpening(true); setOpenError(undefined);
    try {
      const fresh = await client.automation(row.resourceId, 0, 0);
      if (request !== openRequest.current) return;
      if (!validAutomationDetail(fresh, row.resourceId, row.workspaceId)
        || fresh.automation.resourceVersion !== row.resourceVersion
        || (action === "run" ? fresh.canRun !== true || fresh.automation.state !== AutomationState.Enabled
          : action !== "copy" && !fresh.canManage)) throw new TransportError(t("platform.loadFailed"));
      if (action === "copy" || action === "publish_version") {
        const selected = fresh.versions.find((candidate) => candidate.assetId === version?.assetId);
        if (!selected) throw new TransportError(t("platform.loadFailed"));
        onEdit({ detail: fresh, action, content: selected.content });
      } else {
        onEdit({ detail: fresh, action });
      }
    } catch (error) { if (request === openRequest.current) setOpenError(error); }
    finally { if (request === openRequest.current) setOpening(false); }
  };
  const canEnable = !!detail?.versions.some((candidate) => candidate.state === AgentVersionState.Published)
    && !!detail?.delegations.some((grant) => new Date(grant.expiresAt).getTime() > Date.now());
  const activationWarning = content ? getWorkflowActivationWarning(content, t) : null;
  return <div data-testid={`workflow-card-${row.resourceId}`}
    className="group relative flex min-h-60 w-full flex-col overflow-hidden rounded-2xl bg-muted/50 p-5 text-left text-foreground shadow-xs transition-colors hover:bg-muted/65">
    <button type="button" disabled={locked}
      className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={onView}><span className="sr-only">{t("agents.open")}</span></button>
    <div className="pointer-events-none relative z-10 flex min-h-48 flex-1 flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2" aria-hidden>
          <span className={`flex h-9 w-9 items-center justify-center rounded-xl border shadow-xs ${content?.trigger.kind === TriggerKind.Schedule
            ? "border-emerald-400/30 bg-emerald-600 text-white" : content?.trigger.kind === TriggerKind.DiffPosted
            ? "border-violet-400/30 bg-violet-600 text-white" : content?.trigger.kind === TriggerKind.ReactionAdded
            ? "border-pink-400/30 bg-pink-600 text-white" : content?.trigger.kind === TriggerKind.Webhook
            ? "border-orange-300/30 bg-orange-500 text-white" : "border-blue-400/30 bg-blue-600 text-white"}`}>
            {triggerEmoji ? <ActionEmoji value={triggerEmoji} />
              : !content ? <Zap className="h-5 w-5" /> : content.trigger.kind === TriggerKind.Schedule ? <CalendarClock className="h-5 w-5" />
              : content.trigger.kind === TriggerKind.DiffPosted ? <GitPullRequest className="h-5 w-5" />
              : content.trigger.kind === TriggerKind.ReactionAdded ? <SmilePlus className="h-5 w-5" />
              : content.trigger.kind === TriggerKind.Webhook ? <Webhook className="h-5 w-5" /> : <MessageSquare className="h-5 w-5" />}
          </span>
          {content ? <><ArrowRight className="h-4 w-4 text-muted-foreground/60" />
            <WorkflowActionTileStack content={content} animationSequence={triggerAnimationSequence} /></> : null}
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <WorkflowStatusToggle enabled={row.state === AutomationState.Enabled}
            disabled={locked || opening || !detail?.canManage || (row.state !== AutomationState.Enabled && !canEnable)}
            onToggle={() => {
              if (row.state !== AutomationState.Enabled && activationWarning) { setActivationOpen(true); return; }
              void openAction(row.state === AutomationState.Enabled ? "disable" : "enable");
            }} />
          {detail ? <WorkflowActionsMenu isEnabled={row.state === AutomationState.Enabled} disabled={locked || opening}
            showEnabledToggle={false}
            onEdit={detail.canManage && content ? () => { void openAction("publish_version"); } : undefined}
            onDuplicate={content ? () => { void openAction("copy"); } : undefined}
            onDelete={detail.canManage ? () => { void openAction("delete"); } : undefined}
            onTrigger={detail.canRun === true && row.state === AutomationState.Enabled ? () => {
              setTriggerAnimationSequence((sequence) => sequence + 1); void openAction("run");
            } : undefined} /> : null}
        </div>
      </div>
      {opening ? <p role="status" className="mt-2 text-sm text-muted-foreground">{t("platform.loading")}</p> : null}
      {openError ? <div className="pointer-events-auto mt-2"><AgentReadFailure error={openError}
        onRetry={() => { setOpenError(undefined); reload(); }} /></div> : null}
      {state.status === "pending" ? <p role="status" className="mt-4 text-sm text-muted-foreground">{t("platform.loading")}</p>
        : !detail ? <div className="pointer-events-auto mt-4"><AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} /></div>
        : content ? <>
          <h3 className="mt-4 line-clamp-4 text-xl font-bold leading-tight tracking-tight" data-testid="workflow-card-semantic-label">{workflowCardLabel(content, t, {
            authorLabel: authorLabel || undefined, authorLoading: !!authorCondition && !authorLabel && authors.isLoading,
            messageLabel: message.messageLabel ?? undefined, messageLoading: message.messageLoading,
          })}</h3>
        </> : <p className="mt-4 text-sm text-muted-foreground">{t("agents.automation.noVersion")}</p>}
      <div className="mt-auto flex min-w-0 items-end justify-between gap-3 pt-5 text-muted-foreground">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground" data-testid="workflow-card-channel">#{workspaceName}</p>
          <p className="mt-0.5 truncate text-2xs text-muted-foreground" data-testid="workflow-card-name">{content?.name ?? t("workflows.unnamed")}</p>
        </div>
        {row.updatedAt ? <time className="shrink-0 text-2xs" dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleDateString(locale)}</time> : null}
      </div>
    </div>
    <WorkflowActivationDialog warning={activationWarning} open={activationOpen} disabled={locked || opening}
      onOpenChange={(open) => { if (!open) setActivationOpen(false); }}
      onConfirm={() => { setActivationOpen(false); void openAction("enable"); }} />
  </div>;
}

function AutomationDetail({ resourceId, workspaceId, locked, onEdit, onClose, onUnavailable, renderRunHistory }: {
  resourceId: string; workspaceId: string; locked: boolean; onEdit: (edit: AutomationEdit) => void;
  onClose: () => void; onUnavailable?: () => void;
  renderRunHistory?: (resourceId: string, workspaceId: string) => ReactNode;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [versionOffsets, setVersionOffsets] = useState([0]);
  const [grantOffsets, setGrantOffsets] = useState([0]);
  const [versionIndex, setVersionIndex] = useState(0);
  const [grantIndex, setGrantIndex] = useState(0);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<unknown>();
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
  const copyRequest = useRef(0);
  const versionOffset = versionOffsets[versionIndex] ?? 0;
  const grantOffset = grantOffsets[grantIndex] ?? 0;
  useEffect(() => {
    copyRequest.current += 1;
    setCopying(false); setCopyError(undefined);
    return () => { copyRequest.current += 1; };
  }, [client, resourceId, workspaceId, versionOffset, grantOffset, locked, selectedVersion]);
  const [state, reload] = useLoad(`automation:${resourceId}:${versionOffset}:${grantOffset}`,
    () => client.automation(resourceId, versionOffset, grantOffset));
  const value = state.status === "ok" ? state.data : null;
  const detail = value && validAutomationDetail(value, resourceId, workspaceId)
    && (value.nextVersionOffset === undefined || (Number.isSafeInteger(value.nextVersionOffset) && value.nextVersionOffset > versionOffset))
    && (value.nextDelegationOffset === undefined || (Number.isSafeInteger(value.nextDelegationOffset) && value.nextDelegationOffset > grantOffset)) ? value : null;
  const unreadable = state.status !== "pending" && !detail;
  useEffect(() => { if (unreadable) onUnavailable?.(); }, [unreadable]);
  // Keep the original WorkflowDetailPanel shell throughout its authorized read.
  // The outer Dialog intentionally has no separate close control. Do not replace
  // this shell with a notice, or expose stale definition/actions while reloading.
  if (!detail) return <section className="flex h-full min-h-0 flex-col border-l bg-background pt-4" data-testid="workflow-detail-panel">
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><Skeleton className="h-4 w-36" /></div>
        {state.status === "pending" ? <><Skeleton className="mt-1 h-3 w-full max-w-64" /><Skeleton className="mt-1 h-3 w-40" /></> : null}
      </div>
      <div className="flex items-center gap-1">
        <WorkflowButton size="icon" variant="ghost" disabled={locked} aria-label={t("buzz.close")} onClick={onClose}><X aria-hidden className="h-4 w-4" /></WorkflowButton>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto" data-scroll-restoration-id={`workflow-detail:${resourceId}`}>
      {state.status === "pending" ? <div className="space-y-4 p-4" role="status" aria-label={t("platform.loading")}>
        <div><Skeleton className="mb-2 h-4 w-28" /><Skeleton className="h-40 w-full rounded-xl" /></div>
        <div><Skeleton className="mb-2 h-4 w-24" /><div className="space-y-2"><Skeleton className="h-16 w-full rounded-xl" /><Skeleton className="h-16 w-full rounded-xl" /></div></div>
      </div> : <div className="flex h-32 flex-col items-center justify-center gap-2">
        <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      </div>}
    </div>
  </section>;
  const row = detail.automation;
  // A pinned definition is not interchangeable with the newest readable draft.
  // If its Asset is absent from this authorized page, do not substitute a version.
  const definition = selectedVersion || row.pinnedVersionAssetId
    ? detail.versions.find((version) => version.assetId === (selectedVersion ?? row.pinnedVersionAssetId))
    : detail.versions[0];
  const published = detail.versions.filter((v) => v.state === AgentVersionState.Published);
  const grants = detail.delegations.filter((g) => new Date(g.expiresAt).getTime() > Date.now());
  const openVersion = async (assetId: string, action: "copy" | "publish_version") => {
    if (locked || copying) return;
    const request = ++copyRequest.current;
    setCopying(true); setCopyError(undefined);
    try {
      // Re-read the selected page through the existing authorized reader; a stale
      // local definition is not permission to copy/edit after access was revoked.
      const fresh = await client.automation(resourceId, versionOffset, grantOffset);
      if (request !== copyRequest.current) return;
      const version = validAutomationDetail(fresh, resourceId, workspaceId)
        ? fresh.versions.find((candidate) => candidate.assetId === assetId) : undefined;
      if (!version || (action === "publish_version" && (!fresh.canManage
        || fresh.automation.resourceVersion !== row.resourceVersion))) throw new TransportError(t("platform.loadFailed"));
      onEdit({ detail: fresh, action, content: version.content });
    } catch (error) { if (request === copyRequest.current) setCopyError(error); }
    finally { if (request === copyRequest.current) setCopying(false); }
  };
  return <section className="flex h-full min-h-0 flex-col border-l bg-background pt-4" data-testid="workflow-detail-panel">
    <div className="flex items-center justify-between border-b px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2"><h3 className="truncate text-sm font-semibold">{definition ? definition.content.name ?? t("workflows.unnamed") : t("native.unavailable.title")}</h3>
          <Badge tone={row.state === AutomationState.Enabled ? "positive" : "neutral"}>{t(automationLabels[row.state])}</Badge></div>
        {definition?.content.description?.trim() ? <p className="mt-1 truncate text-xs text-muted-foreground">{definition.content.description.trim()}</p> : null}
        {definition ? <p className="mt-1 truncate text-xs text-muted-foreground" data-testid="workflow-trigger-summary">{workflowTriggerSummary(definition.content, t)}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        {detail.canManage ? <WorkflowButton size="sm" variant="outline" disabled={locked || copying || !definition}
          onClick={() => { if (definition) void openVersion(definition.assetId, "publish_version"); }}><Pencil aria-hidden className="mr-1 h-4 w-4" />{t("workflows.edit")}</WorkflowButton> : null}
        {detail.canRun === true && row.state === AutomationState.Enabled ? <WorkflowButton size="sm" variant="outline" disabled={locked}
          onClick={() => onEdit({ detail, action: "run" })}><Play aria-hidden className="mr-1 h-4 w-4" />{t("agents.automation.run")}</WorkflowButton> : null}
        <WorkflowButton size="icon" variant="ghost" disabled={locked} aria-label={t("buzz.close")} onClick={onClose}><X aria-hidden className="h-4 w-4" /></WorkflowButton>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto" data-scroll-restoration-id={`workflow-detail:${resourceId}`}><div className="space-y-4 p-4">
    {detail.versions.length > 1 ? <label className="flex items-center gap-2 text-sm">{t("agents.version.assetVersion")}
      <select className="h-8 min-w-0 rounded-md border border-input bg-background px-2" disabled={locked || copying}
        value={definition?.assetId ?? ""} onChange={(event) => setSelectedVersion(event.target.value)}>
        {!definition ? <option value="" disabled>{t("native.unavailable.title")}</option> : null}
        {detail.versions.map((version) => <option key={version.assetId} value={version.assetId}>{version.content.name ?? t("workflows.unnamed")} · {version.assetVersion} · {t(automationVersionLabels[version.state])}</option>)}
      </select></label> : null}
    {/* Kailo's authorized version/delegation metadata is retained in the detail,
        outside the original semantic card label and channel/name/date footer. */}
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <dt>{t("agents.automation.executor")}</dt><dd className="break-all">{row.executorInstallationResourceId}</dd>
      <dt>{t("agents.owner")}</dt><dd className="break-all">{row.ownerPrincipalId}</dd>
      <dt>{t("agents.automation.pinned")}</dt><dd className="break-all">{row.pinnedVersionAssetId ?? "—"}</dd>
      <dt>{t("agents.automation.grant")}</dt><dd className="break-all">{row.delegationId ?? "—"}</dd>
      <dt>{t("agents.resourceVersion")}</dt><dd>{row.resourceVersion}</dd>
      {row.webhookUrl ? <><dt>{t("workflows.webhook.url")}</dt><dd className="break-all font-mono">{row.webhookUrl}</dd></> : null}
      {row.webhookSecretHint ? <><dt>{t("workflows.webhook.secret")}</dt>
        <dd className="font-mono">{t("workflows.webhook.hint", { hint: row.webhookSecretHint })}</dd></> : null}
    </dl>
    {detail.canManage ? <div className="flex flex-wrap gap-2">
      {row.state !== AutomationState.Enabled && published.length > 0 && grants.length > 0
        ? <Button disabled={locked} onClick={() => onEdit({ detail, action: "enable" })}>{t("agents.automation.enable")}</Button> : null}
      {row.state === AutomationState.Enabled ? <Button disabled={locked} onClick={() => onEdit({ detail, action: "pause" })}>{t("agents.automation.pause")}</Button> : null}
      {row.state !== AutomationState.Disabled ? <Button disabled={locked} onClick={() => onEdit({ detail, action: "disable" })}>{t("agents.automation.disable")}</Button> : null}
      {row.webhookSecretHint && row.state !== AutomationState.Disabled
        ? <Button disabled={locked} onClick={() => onEdit({ detail, action: "rotate_webhook_secret" })}>{t("workflows.webhook.rotate")}</Button> : null}
      <Button disabled={locked} onClick={() => onEdit({ detail, action: "delete" })}>{t("agents.automation.delete")}</Button>
    </div> : null}
    {/* Buzz 779af8886caae1317b4de962082429867ab61503:
        desktop/src/features/workflows/ui/WorkflowDetailPanel.tsx::WorkflowDetailPanel.
        Render the authorized immutable version in the original complete JSON view. */}
    {definition ? <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("workflows.definition")}</h4>
      <pre className="max-h-64 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed" data-testid="workflow-definition">
        {JSON.stringify(definition.content, null, 2)}
      </pre>
    </div> : null}
    {detail.versions.length === 0 ? <Notice>{t("agents.automation.noVersion")}</Notice>
      : <Table head={[t("agents.version.assetVersion"), t("workflows.name"), t("agents.resourceVersion"), t("platform.state"), t("agents.automation.trigger"), t("agents.automation.template"), ""]}>
        {detail.versions.map((version) => <tr key={version.assetId}>
          <Cell mono>{version.assetId}</Cell><Cell>{version.content.name ?? t("workflows.unnamed")}</Cell><Cell>{version.assetVersion}</Cell>
          <Cell><Badge tone="neutral">{t(automationVersionLabels[version.state])}</Badge></Cell>
          <Cell>
            <p>{t(version.content.trigger.kind === TriggerKind.Schedule ? "agents.automation.schedule"
              : version.content.trigger.kind === TriggerKind.Mention ? "agents.installation.trigger.mention"
              : version.content.trigger.kind === TriggerKind.DiffPosted ? "agents.automation.diffPosted"
              : version.content.trigger.kind === TriggerKind.ReactionAdded ? "agents.automation.reactionAdded"
              : version.content.trigger.kind === TriggerKind.Webhook ? "agents.automation.webhook" : "agents.automation.channelMessage")}</p>
            {version.content.trigger.emoji ? <p>{t("workflows.steps.emoji")}: {version.content.trigger.emoji}</p> : null}
            {version.content.trigger.scheduleSpec ? <>
              <p>{t("agents.automation.everySeconds")}: {version.content.trigger.scheduleSpec.everySeconds}</p>
              <p>{t("agents.automation.offsetSeconds")}: {version.content.trigger.scheduleSpec.offsetSeconds}</p>
              <p>{t("agents.automation.catchupWindowSeconds")}: {version.content.trigger.scheduleSpec.catchupWindowSeconds}</p>
            </> : null}
            <p>{t("agents.automation.resultTarget")}: {t(workflowAction(version.content)?.kind === AutomationStepAction.SetChannelTopic || version.content.resultTarget === ResultTarget.Channel ? "agents.automation.channel" : "agents.automation.thread")}</p>
            <p>{t("agents.automation.approvalPolicy")}: {workflowApprovalPolicy(version.content)
              ? `${workflowApprovalPolicy(version.content)?.id} · ${workflowApprovalPolicy(version.content)?.version}`
              : t("agents.automation.noApproval")}</p>
          </Cell>
          <Cell><span className="whitespace-pre-wrap">{workflowAction(version.content)?.template}</span>
            {version.content.steps ? <ol className="mt-2 space-y-1 text-xs text-muted-foreground">{version.content.steps.map((step) =>
              <li key={step.id}>{step.name ?? step.id} · {step.action === "delay" ? `${t("workflows.steps.duration")}: ${step.duration}` : step.action === "request_approval" ? t("agents.automation.approvalPolicy") : step.action === "set_channel_topic" ? `${t("workflows.steps.setTopic")}: ${step.topic}` : step.action === "add_reaction" ? `${t("workflows.steps.addReaction")}: ${step.emoji}` : step.action === "call_webhook" ? `${t("workflows.steps.callWebhook")}: ${step.method ?? "POST"} ${step.url}` : t("workflows.steps.message")}</li>)}</ol> : null}
          </Cell>
          <Cell><Button disabled={locked || copying} onClick={() => { void openVersion(version.assetId, "copy"); }}>{t("agents.automation.copy")}</Button></Cell>
        </tr>)}
      </Table>}
    {copyError ? <AgentReadFailure error={copyError} onRetry={() => setCopyError(undefined)} /> : null}
    <div className="flex gap-2">
      {versionIndex > 0 ? <Button disabled={locked} onClick={() => { setSelectedVersion(null); setVersionIndex(versionIndex - 1); }}>{t("roles.previous")}</Button> : null}
      {detail.nextVersionOffset !== undefined ? <Button disabled={locked} onClick={() => {
        setSelectedVersion(null);
        setVersionOffsets((old) => [...old.slice(0, versionIndex + 1), detail.nextVersionOffset!]); setVersionIndex(versionIndex + 1);
      }}>{t("roles.next")}</Button> : null}
    </div>
    {detail.canManage ? <>
      {grants.length === 0 ? <Notice>{t("agents.automation.noGrant")}</Notice>
        : <Table head={[t("agents.automation.grant"), t("agents.resourceVersion"), t("platform.time")]}>
          {grants.map((grant) => <tr key={grant.delegationId}><Cell mono>{grant.delegationId}</Cell><Cell>{grant.delegationVersion}</Cell><Cell title={grant.expiresAt}>{relativeTime(locale, grant.expiresAt)}</Cell></tr>)}
        </Table>}
      <div className="flex gap-2">
        {grantIndex > 0 ? <Button disabled={locked} onClick={() => setGrantIndex(grantIndex - 1)}>{t("roles.previous")}</Button> : null}
        {detail.nextDelegationOffset !== undefined ? <Button disabled={locked} onClick={() => {
          setGrantOffsets((old) => [...old.slice(0, grantIndex + 1), detail.nextDelegationOffset!]); setGrantIndex(grantIndex + 1);
        }}>{t("roles.next")}</Button> : null}
      </div>
    </> : null}
    {renderRunHistory?.(resourceId, workspaceId)}
    </div></div>
  </section>;
}

// Buzz 779af8886caae1317b4de962082429867ab61503
// desktop/src/features/workflows/ui/WorkflowDialog.tsx::WorkflowNameEditor.
function WorkflowNameEditor({ disabled, name, onCommit }: {
  disabled: boolean; name: string; onCommit: (name: string) => boolean;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!editing) setDraft(name); }, [editing, name]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const commit = () => {
    const nextName = inputRef.current?.value.trim() ?? draft.trim();
    if (!nextName || !onCommit(nextName)) return;
    setEditing(false);
  };
  if (editing) return <div className="flex h-6 items-center gap-1.5">
    <input aria-label={t("workflows.name")} autoCapitalize="off" autoCorrect="off"
      className="h-6 w-72 rounded-md border border-input bg-background px-2 font-mono text-sm"
      disabled={disabled} onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(name); setEditing(false); }
      }} ref={inputRef} defaultValue={name} />
    <Button aria-label={t("workflows.saveName")} className="h-6 w-6 text-muted-foreground" disabled={disabled || !draft.trim()}
      onClick={commit} onPointerDown={(event) => { event.preventDefault(); commit(); }}><Check aria-hidden className="h-3 w-3" /></Button>
  </div>;
  return <div className="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 font-mono text-sm text-muted-foreground">
    <span className="min-w-0 truncate">{name || t("workflows.unnamed")}</span>
    <Button aria-label={t("workflows.editName")} className="h-6 w-6 text-muted-foreground" disabled={disabled}
      onClick={() => setEditing(true)}><Pencil aria-hidden className="h-3 w-3" /></Button>
  </div>;
}

function AutomationAction({ workspaceId: hostWorkspaceId, workspaces, edit, open, onClose, onReset, onLocked, onRecorded, onSwitch, workflowNavigation }: {
  workspaceId?: string; workspaces: WorkspaceView[] | null; edit: AutomationEdit | null; onReset: () => void;
  /** Original WorkflowDialog header WorkflowActionsMenu: reopen this editor on another governed action. */
  onSwitch?: (edit: AutomationEdit) => void;
  open: boolean; onClose: () => void;
  onLocked: (locked: boolean) => void; onRecorded: (command: ActionCommand, submission: ActionSubmission) => void;
  workflowNavigation?: WorkflowNavigation;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const creating = !edit || edit.action === "copy";
  const formId = useId();
  const [draftScope, setDraftScope] = useState<{hostWorkspaceId?: string; edit: AutomationEdit | null; id: string} | null>(null);
  const selectedScopeId = creating && draftScope && draftScope.hostWorkspaceId === hostWorkspaceId && draftScope.edit === edit
    ? draftScope.id : hostWorkspaceId;
  // Discovery is not create permission. Losing a discovered scope invalidates
  // this read key immediately; the fresh automation/executor readers still gate writes.
  const workspaceId = workspaces?.some((candidate) => candidate.id === selectedScopeId) ? selectedScopeId : undefined;
  const [name, setName] = useState("");
  const [description, setDescription] = useState<string | undefined>();
  const [executorId, setExecutorId] = useState("");
  const [trigger, setTrigger] = useState(TriggerKind.ChannelMessage);
  const [prefix, setPrefix] = useState("");
  const [filter, setFilter] = useState("");
  const [triggerEmoji, setTriggerEmoji] = useState("");
  const [conditionDrafts, setConditionDrafts] = useState<ParsedConditionExpression[] | null>(null);
  const [interval, setInterval] = useState("");
  const [offsetSeconds, setOffsetSeconds] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"interval" | "cron">("interval");
  const [intervalTagged, setIntervalTagged] = useState(false);
  const [cron, setCron] = useState("");
  const [catchupWindowSeconds, setCatchupWindowSeconds] = useState("");
  const [template, setTemplate] = useState("");
  const [steps, setSteps] = useState<WorkflowStepDraft[]>([]);
  const [stepsFormat, setStepsFormat] = useState<2 | 3>(2);
  const [actionKind, setActionKind] = useState<WorkflowActionKind>(AutomationVersionContentActionKind.AgentTurn);
  const [policyKey, setPolicyKey] = useState("");
  const [editorMode, setEditorMode] = useState<"form" | "yaml">("form");
  const [yamlText, setYamlText] = useState("");
  const formDraftYaml = useRef("");
  const formBuilderRef = useRef<WorkflowFormCanvasHandle>(null);
  const [draftEpoch, setDraftEpoch] = useState(0);
  const [initialDraft, setInitialDraft] = useState<{ form: string; yaml: string } | null>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [editorError, setEditorError] = useState(false);
  const frozenResponse = useRef<{ operationId: string; actionExecutionId: string } | null>(null);
  const [versionId, setVersionId] = useState("");
  const [grantId, setGrantId] = useState("");
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const inFlight = useRef(false);
  const [executorOffsets, setExecutorOffsets] = useState([0]);
  const [executorIndex, setExecutorIndex] = useState(0);
  const executorOffset = executorOffsets[executorIndex] ?? 0;
  const [installations, reloadInstallations] = useLoad(`automation-executors:${workspaceId}:${executorOffset}`,
    () => workspaceId ? client.agentInstallations(workspaceId, executorOffset) : Promise.resolve(null));
  const executorResource = creating ? undefined : edit.detail.automation.executorInstallationResourceId;
  const [selectedInstallation, reloadSelectedInstallation] = useLoad(`automation-executor:${executorResource}`,
    () => executorResource ? client.agentInstallation(executorResource) : Promise.resolve(null));
  const [admission, reloadAdmission] = useLoad(`automation-create:${workspaceId}`,
    () => workspaceId ? client.automations(workspaceId, 0) : Promise.resolve(null));
  const [tasks, reloadTasks] = useLoad("automation-actions-in-flight", client.tasks);
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => task.actionKey.startsWith("automation.") && task.actionKey !== "automation.run"
    && taskPhase(task).tone === "neutral") ?? [];
  const requestBlocked = !taskRows || pending.some((task) => !creating ? task.targetId === edit.detail.automation.resourceId : task.actionKey === "automation.create");
  const executorPage = installations.status === "ok" && installations.data && Array.isArray(installations.data.installations)
    && installations.data.installations.every((row) => validInstallation(row) && row.workspaceId === workspaceId)
    && new Set(installations.data.installations.map((row) => row.resourceId)).size === installations.data.installations.length
    && (installations.data.nextOffset === undefined || (Number.isSafeInteger(installations.data.nextOffset) && installations.data.nextOffset > executorOffset))
    ? installations.data : null;
  const executors = executorPage?.installations.filter((row) => row.state === AgentInstallationState.Active && row.agentPrincipalState === "ACTIVE") ?? [];
  const executor = !creating ? selectedInstallation.status === "ok" && selectedInstallation.data
    && validInstallation(selectedInstallation.data) && selectedInstallation.data.resourceId === executorResource
    && selectedInstallation.data.workspaceId === workspaceId && selectedInstallation.data.state === AgentInstallationState.Active
    && selectedInstallation.data.agentPrincipalState === "ACTIVE" ? selectedInstallation.data : undefined
    : executors.find((row) => row.resourceId === executorId);
  const targets = executor?.automationResultTargets;
  const scheduleSupported = Array.isArray(targets) && targets.every((target) => Object.values(ResultTarget).includes(target))
    && new Set(targets).size === targets.length && targets.includes(ResultTarget.Channel);
  const canCreate = admission.status === "ok" && admission.data && Array.isArray(admission.data.automations)
    && admission.data.automations.every((row) => validAutomation(row) && row.workspaceId === workspaceId)
    && typeof admission.data.canCreate === "boolean" && admission.data.canCreate;
  const versions = edit?.detail.versions.filter((row) => row.state === AgentVersionState.Published) ?? [];
  const rawPolicies = admission.status === "ok" ? admission.data?.availableApprovalPolicies : undefined;
  const policies = Array.isArray(rawPolicies) && rawPolicies.every(validApprovalPolicy)
    && new Set(rawPolicies.map((row) => `${row.id}:${row.version}`)).size === rawPolicies.length ? rawPolicies : null;
  const selectedPolicy = policies?.find((row) => `${row.id}:${row.version}` === policyKey);
  // A stale or unavailable selected policy never silently becomes no approval.
  const policyAvailable = policyKey === "" || selectedPolicy !== undefined;
  const grants = edit?.detail.delegations.filter((row) => new Date(row.expiresAt).getTime() > Date.now()) ?? [];
  const version = versions.find((row) => row.assetId === versionId);
  const grant = grants.find((row) => row.delegationId === grantId);
  const contentAction = creating || edit.action === "publish_version";
  const addingFirstStep = creating && editorMode === "form"
    && actionKind !== AutomationVersionContentActionKind.AgentTurn && steps.length === 0 && !template;
  const scheduleSpec = { ...(scheduleMode === "cron" ? { cron, kind: AutomationScheduleSpecKind.Cron } : {
    ...(intervalTagged ? { kind: AutomationScheduleSpecKind.Interval } : {}),
    everySeconds: parseDurationSeconds(interval) ?? 0, offsetSeconds: Number(offsetSeconds) }), catchupWindowSeconds: Number(catchupWindowSeconds) };
  const scheduleValid = (scheduleMode === "cron" ? [catchupWindowSeconds] : [offsetSeconds, catchupWindowSeconds]).every((value) => /^\d+$/.test(value))
    && validSchedule(scheduleSpec) && (scheduleMode !== "cron" || !cronExpressionError(cron));
  const formContent: AutomationVersionContent = {
    ...(name !== "" ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    trigger: { kind: trigger, ...(trigger === TriggerKind.Schedule ? { scheduleSpec } : trigger === TriggerKind.Webhook ? {} : {
      ...(prefix && trigger !== TriggerKind.DiffPosted && trigger !== TriggerKind.ReactionAdded ? { textPrefix: prefix } : {}),
      ...(trigger === TriggerKind.ReactionAdded && triggerEmoji.trim() ? { emoji: triggerEmoji.trim() } : {}),
      ...(filter ? { filter } : {}) }),
      ...(trigger === TriggerKind.Mention && executor ? { mentionPrincipalId: executor.agentPrincipalId } : {}) },
    ...(steps.length ? {formatVersion: stepsFormat, steps: workflowStepsContent(steps)} : actionKind === AutomationStepAction.AddReaction || actionKind === AutomationStepAction.SetChannelTopic
      || actionKind === AutomationStepAction.CallWebhook ? {formatVersion: 2, steps: []} : {action: { kind: actionKind, template }}),
    ...(selectedPolicy ? { approvalPolicy: { id: selectedPolicy.id, version: selectedPolicy.version } } : {}),
    resultTarget: trigger === TriggerKind.Schedule || trigger === TriggerKind.Webhook ? ResultTarget.Channel : ResultTarget.TriggerThread,
  };
  const triggerPresentation = useWorkflowTriggerPresentation(formContent, workspaceId);
  const yamlContent = editorMode === "yaml" ? automationFromYaml(yamlText) : null;
  const nameDocument = editorMode === "yaml" ? parseDocument(yamlText) : null;
  const yamlName = nameDocument?.get("name");
  const visibleName = editorMode === "form" ? name : typeof yamlName === "string" ? yamlName : "";
  const content = editorMode === "yaml" ? yamlContent : formContent;
  const contentUsable = (value: AutomationVersionContent | null): value is AutomationVersionContent => !!value
    && validAutomationContent(value)
    && (value.trigger.kind !== TriggerKind.Mention || value.trigger.mentionPrincipalId === executor?.agentPrincipalId)
    && (value.trigger.kind !== TriggerKind.Schedule || scheduleSupported)
    && (workflowApprovalPolicy(value) === undefined || policies?.some((policy) => policy.id === workflowApprovalPolicy(value)?.id
      && policy.version === workflowApprovalPolicy(value)?.version) === true);
  const contentAvailable = contentUsable(content) && (editorMode === "yaml"
    || (policyAvailable && (trigger !== TriggerKind.Schedule || scheduleValid)));
  const enableAvailable = !!version && !!grant
    && (version.content.trigger.kind !== TriggerKind.Schedule || scheduleSupported);
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  useEffect(() => {
    // A settled receipt belongs to the scope in which it was submitted. An
    // uncertain frozen intention still owns its receipt and must survive.
    if (!intent) { setSubmission(null); setFailure(null); }
  }, [workspaceId]);
  useEffect(() => {
    if (!open || intent) return;
    const content = edit && (edit.action === "copy" || edit.action === "publish_version")
      ? edit.content ?? edit.detail.versions[0]?.content : edit?.detail.versions[0]?.content;
    // Original WorkflowDialog names a fresh create draft (not a duplicate) with three words;
    // the generated name is part of the initial snapshot, so it is not a dirty change.
    setName(content?.name ?? (!edit ? generateWorkflowName() ?? "" : ""));
    setDescription(content?.description);
    setTrigger(content?.trigger.kind ?? TriggerKind.ChannelMessage); setPrefix(content?.trigger.textPrefix ?? "");
    setFilter(content?.trigger.filter ?? ""); setTriggerEmoji(content?.trigger.emoji ?? "");
    setConditionDrafts(null);
    setScheduleMode(content?.trigger.scheduleSpec?.cron === undefined ? "interval" : "cron");
    setIntervalTagged(content?.trigger.scheduleSpec?.kind === AutomationScheduleSpecKind.Interval);
    setCron(content?.trigger.scheduleSpec?.cron ?? "");
    setInterval(content?.trigger.scheduleSpec?.everySeconds === undefined ? "" : formatDurationSeconds(content.trigger.scheduleSpec.everySeconds));
    setOffsetSeconds(content?.trigger.scheduleSpec?.offsetSeconds?.toString() ?? "");
    setCatchupWindowSeconds(content?.trigger.scheduleSpec?.catchupWindowSeconds.toString() ?? "");
    setSteps(content?.steps ?? []);
    setStepsFormat(content?.formatVersion === 3 ? 3 : 2);
    setTemplate(content ? workflowAction(content)?.template ?? "" : "");
    // Original WorkflowDialog starts with an empty sequence and its primary
    // "Add step"; the governed Agent turn is chosen from the canvas menu.
    setActionKind(content ? workflowAction(content)?.kind ?? AutomationVersionContentActionKind.PostMessage : AutomationVersionContentActionKind.PostMessage);
    setPolicyKey(content?.approvalPolicy ? `${content.approvalPolicy.id}:${content.approvalPolicy.version}` : "");
    setVersionId(""); setGrantId(""); setExecutorId(""); setDraftScope(null);
    const cronNeedsYaml = content?.trigger.scheduleSpec?.cron !== undefined
      && content.trigger.scheduleSpec.cron.trim().split(/\s+/).length !== 5;
    // Original yamlToFormState cannot represent empty/untrimmed descriptions.
    // Keep the exact authorized version in YAML rather than dropping its text.
    // Original yamlToFormState: "Step conditions are only available in the YAML editor".
    const needsYaml = cronNeedsYaml || (content?.description !== undefined
      && (!content.description || content.description.trim() !== content.description))
      || !!content?.steps?.some((step) => step.if !== undefined);
    setEditorMode(needsYaml ? "yaml" : "form"); setYamlText(needsYaml ? stringify(content) : ""); setEditorError(false);
    formDraftYaml.current = "";
    setInitialDraft(null); setDraftEpoch((epoch) => epoch + 1); setDiscardOpen(false);
  }, [edit, hostWorkspaceId, open]);
  // Original WorkflowDialog dirty comparison, applied to the existing typed form
  // and raw YAML. Capture after its initialization batch, not async admission data.
  const formSnapshot = JSON.stringify({ scope: selectedScopeId, name, description, executorId, trigger, prefix, filter, conditionDrafts,
    interval, offsetSeconds, scheduleMode, intervalTagged, cron, catchupWindowSeconds,
    template, steps, stepsFormat, actionKind, policyKey });
  useEffect(() => {
    setInitialDraft({ form: formSnapshot, yaml: yamlText });
  }, [draftEpoch]);
  const dirty = open && contentAction && initialDraft !== null && (formSnapshot !== initialDraft.form
    || (editorMode === "yaml" && yamlText !== (formDraftYaml.current || initialDraft.yaml)));
  const navigationBlocked = workflowNavigation?.blocker.status === "blocked";
  const navigationStateChange = workflowNavigation?.onStateChange;
  const proceedingNavigation = useRef(false);
  useEffect(() => { navigationStateChange?.({ dirty, locked: !!intent || busy }); }, [dirty, !!intent, busy, navigationStateChange]);
  useEffect(() => () => { navigationStateChange?.({ dirty: false, locked: false }); }, [navigationStateChange]);
  useEffect(() => {
    if (!navigationBlocked) proceedingNavigation.current = false;
    else if (intent || busy || !dirty) workflowNavigation?.blocker.reset?.();
  }, [navigationBlocked, !!intent, busy, dirty, workflowNavigation?.blocker.reset]);
  useEffect(() => {
    if (!dirty && !intent && !busy) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [dirty, intent, busy]);
  const requestClose = () => {
    if (intent || busy) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  };
  // Original WorkflowDialog::requestEditorTransition: a dirty draft asks before it is replaced.
  const pendingTransition = useRef<(() => void) | null>(null);
  const requestTransition = (next: AutomationEdit) => {
    if (intent || busy || !onSwitch) return;
    if (dirty) { pendingTransition.current = () => onSwitch(next); setDiscardOpen(true); }
    else onSwitch(next);
  };
  const editedDetail = edit?.action === "publish_version" ? edit.detail : null;
  const editedContent = edit?.action === "publish_version" ? edit.content ?? edit.detail.versions[0]?.content : undefined;
  const editedEnabled = editedDetail?.automation.state === AutomationState.Enabled;
  useEffect(() => { setExecutorIndex(0); setExecutorOffsets([0]); }, [workspaceId]);
  const changeEditor = (mode: "form" | "yaml") => {
    if (mode === editorMode) return;
    if (mode === "yaml") {
      // Never serialize an unavailable policy as NONE or turn an invalid numeric
      // form draft into a different valid configuration.
      if (!policyAvailable || formContent.steps?.some(step => !validStepTimeout(step.timeout_secs))
        || (trigger === TriggerKind.Schedule && !scheduleValid)
        || (trigger === TriggerKind.Mention && !executor)) { setEditorError(true); return; }
      formDraftYaml.current = stringify(formContent);
      setYamlText(formDraftYaml.current); setEditorMode(mode); setEditorError(false);
      return;
    }
    // Viewing an unchanged, incomplete draft must not trap the user in YAML.
    // No conversion or admission occurs: retain the original form fields.
    if (yamlText === formDraftYaml.current) {
      setEditorMode(mode); setEditorError(false); return;
    }
    if (!contentUsable(yamlContent)
      || !!yamlContent.steps?.some((step) => step.if !== undefined)
      || (yamlContent.description !== undefined && (!yamlContent.description || yamlContent.description.trim() !== yamlContent.description))
      || (yamlContent.trigger.scheduleSpec?.cron !== undefined
      && cronExpressionError(yamlContent.trigger.scheduleSpec.cron))) { setEditorError(true); return; }
    setName(yamlContent.name ?? "");
    setDescription(yamlContent.description);
    setTrigger(yamlContent.trigger.kind); setPrefix(yamlContent.trigger.textPrefix ?? "");
    setFilter(yamlContent.trigger.filter ?? "");
    setConditionDrafts(null);
    setScheduleMode(yamlContent.trigger.scheduleSpec?.cron === undefined ? "interval" : "cron");
    setIntervalTagged(yamlContent.trigger.scheduleSpec?.kind === AutomationScheduleSpecKind.Interval);
    setCron(yamlContent.trigger.scheduleSpec?.cron ?? "");
    setInterval(yamlContent.trigger.scheduleSpec?.everySeconds === undefined ? "" : formatDurationSeconds(yamlContent.trigger.scheduleSpec.everySeconds));
    setOffsetSeconds(yamlContent.trigger.scheduleSpec?.offsetSeconds?.toString() ?? "");
    setCatchupWindowSeconds(yamlContent.trigger.scheduleSpec?.catchupWindowSeconds.toString() ?? "");
    setSteps(yamlContent.steps ?? []);
    setStepsFormat(yamlContent.formatVersion === 3 ? 3 : 2);
    setTemplate(workflowAction(yamlContent)?.template ?? ""); setActionKind(workflowAction(yamlContent)?.kind ?? AutomationVersionContentActionKind.AgentTurn);
    setPolicyKey(yamlContent.approvalPolicy ? `${yamlContent.approvalPolicy.id}:${yamlContent.approvalPolicy.version}` : "");
    setEditorMode(mode); setEditorError(false);
  };
  const prepare = () => {
    if (intent || busy || requestBlocked || !workspaceId || (creating && (!canCreate || !executor))
      || (!creating && (edit.action === "run" ? edit.detail.canRun !== true
        || edit.detail.automation.state !== AutomationState.Enabled : !edit.detail.canManage))
      || (contentAction && !contentAvailable)
      || (edit?.action === "enable" && !enableAvailable)) return;
    const command: ActionCommand = { actionKey: !creating ? `automation.${edit.action}` : "automation.create",
      idempotencyKey: newIdempotencyKey(), explicitConfirmation: true };
    if (!creating) { command.resourceId = edit.detail.automation.resourceId; command.resourceVersion = edit.detail.automation.resourceVersion; }
    else { command.workspaceId = workspaceId; command.executorInstallationResourceId = executor!.resourceId; }
    if (edit?.action === "run") command.workspaceId = workspaceId;
    if (contentAction && content) command.automationVersionContent = content;
    if (edit?.action === "enable" && version && grant) {
      command.assetId = version.assetId; command.assetVersion = version.assetVersion;
      command.delegationId = grant.delegationId; command.delegationVersion = grant.delegationVersion;
    }
    setIntent(command); setFailure(null); setSubmission(null); onLocked(true);
    return command;
  };
  const submit = async (command = intent) => {
    if (!command || inFlight.current) return;
    const wasUnknown = unknown;
    const priorOperation = submission?.operationId ?? (failure?.kind === "unknown" ? failure.operationId : undefined);
    inFlight.current = true; setBusy(true); setFailure(null); setSubmission(null);
    try {
      const result = await client.submitAction(command);
      if (!result || result.actionKey !== command.actionKey || !result.actionExecutionId || !result.operationId
        || (priorOperation !== undefined && result.operationId !== priorOperation)
        || (frozenResponse.current !== null && (result.operationId !== frozenResponse.current.operationId
          || result.actionExecutionId !== frozenResponse.current.actionExecutionId))
        || !Object.values(ActionGateState).includes(result.gateState) || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setSubmission(result);
      frozenResponse.current = { operationId: result.operationId, actionExecutionId: result.actionExecutionId };
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); onReset(); onRecorded(command, result); reloadAdmission(); reloadInstallations();
        frozenResponse.current = null;
      }
    } catch (error) {
      const failed = writeFailure(error);
      setFailure(wasUnknown ? { kind: "unknown", operationId: priorOperation } : failed);
      // A later HTTP refusal cannot prove that the original uncertain write never happened.
      if (failed.kind !== "unknown" && !wasUnknown) { setIntent(null); onLocked(false); }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };
  const scopeField = <ChannelCombobox channels={workspaces ?? []} id="wf-channel-select"
    disabled={busy || !!intent || unknown || workspaces === null} readOnly={!creating} required={creating}
    variant={editorMode === "yaml" ? "field" : "header"} value={selectedScopeId ?? ""}
    onChange={(id) => {
      if (!creating || busy || intent || id === selectedScopeId || !workspaces?.some((candidate) => candidate.id === id)) return;
      setDraftScope({hostWorkspaceId, edit, id});
      setExecutorId(""); setExecutorIndex(0); setExecutorOffsets([0]);
      setFailure(null); setSubmission(null);
    }} />;
  const triggerFields = <>
        <label className="flex flex-col gap-1 text-sm">{t("agents.automation.trigger")}
          <select value={trigger} onChange={(event) => {
            const value = [TriggerKind.ChannelMessage, TriggerKind.Mention, TriggerKind.ReactionAdded, TriggerKind.DiffPosted, TriggerKind.Webhook, ...(scheduleSupported ? [TriggerKind.Schedule] : [])]
              .find((candidate) => candidate === event.target.value);
            if (value) {
              setTrigger(value);
              // Original WorkflowFormBuilder: an unsupported trigger clears step conditions.
              if (!supportsMessageTextCondition(value)) setSteps((current) => current.map((step) => {
                const next = { ...step }; delete next.if; return next;
              }));
              if (value === TriggerKind.Schedule && !interval && !cron) {
                setScheduleMode("cron"); setCron(defaultScheduleTrigger().cron ?? "");
              }
            }
          }} className="h-8 rounded-md border border-input bg-background px-2">
            <option value={TriggerKind.ChannelMessage}>{t("agents.automation.channelMessage")}</option><option value={TriggerKind.Mention}>{t("agents.installation.trigger.mention")}</option>
            <option value={TriggerKind.ReactionAdded}>{t("agents.automation.reactionAdded")}</option>
            <option value={TriggerKind.DiffPosted}>{t("agents.automation.diffPosted")}</option>
            <option value={TriggerKind.Webhook}>{t("agents.automation.webhook")}</option>
            {scheduleSupported || trigger === TriggerKind.Schedule ? <option value={TriggerKind.Schedule} disabled={!scheduleSupported}>{t("agents.automation.schedule")}</option> : null}
          </select>
        </label>
        {trigger === TriggerKind.Schedule ? <>
          <WorkflowScheduleFields disabled={busy || !!intent || unknown}
            trigger={{ on: "schedule", ...(scheduleMode === "cron" ? { cron } : { interval }) }}
            onUpdate={(next) => {
              setScheduleMode(next.cron === undefined ? "interval" : "cron");
              setCron(next.cron ?? ""); setInterval(next.interval ?? "");
              if (offsetSeconds === "") setOffsetSeconds("0");
            }} />
          {scheduleMode === "interval" ? <>
          <label className="flex flex-col gap-1 text-sm">{t("agents.automation.offsetSeconds")}
            <input required inputMode="numeric" value={offsetSeconds} onChange={(event) => setOffsetSeconds(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" />
          </label>
          </> : null}
          <label className="flex flex-col gap-1 text-sm">{t("agents.automation.catchupWindowSeconds")}
            <input required inputMode="numeric" value={catchupWindowSeconds} onChange={(event) => setCatchupWindowSeconds(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" />
          </label>
          <p className="text-sm text-muted-foreground">{t(scheduleMode === "cron" ? "workflows.cron.rules" : "agents.automation.scheduleRules")}</p>
        </> : trigger === TriggerKind.Webhook ? <p className="text-sm text-muted-foreground">{t("workflows.webhook.triggerHint")}</p> : <>
        {prefix && trigger !== TriggerKind.DiffPosted && trigger !== TriggerKind.ReactionAdded && <label className="flex flex-col gap-1 text-sm">{t("agents.automation.prefix")}
          <input value={prefix} onChange={(event) => setPrefix(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" />
        </label>}
        {/* Original WorkflowFormBuilder TriggerFields: a legacy reaction emoji is
            edited as the trigger_emoji condition and is not a separate field. */}
        <WorkflowTriggerConditions key={`${workspaceId}:${trigger}`}
          value={trigger === TriggerKind.ReactionAdded ? reactionConditionValue(filter, triggerEmoji) : filter}
          onChange={(next) => { setFilter(next); if (trigger === TriggerKind.ReactionAdded) setTriggerEmoji(""); }}
          triggerType={trigger === TriggerKind.DiffPosted ? "diff_posted" : trigger === TriggerKind.ReactionAdded ? "reaction_added" : "message_posted"}
          conditionDrafts={conditionDrafts} onConditionDraftsChange={setConditionDrafts}
          workflowChannelId={workspaceId} disabled={busy || !!intent || unknown} />
        </>}
  </>;
  // Original WorkflowDialog TITLES for create/duplicate/edit; the remaining
  // titles name Kailo's governed lifecycle reviews.
  const title = creating ? edit?.action === "copy" ? "workflows.dialog.duplicate" : "workflows.dialog.create"
    : edit.action === "publish_version" ? "workflows.dialog.edit"
    : edit.action === "enable" ? "agents.automation.enable" : edit.action === "pause" ? "agents.automation.pause"
    : edit.action === "run" ? "agents.automation.run" : edit.action === "delete" ? "agents.automation.delete"
    : edit.action === "rotate_webhook_secret" ? "workflows.webhook.rotate" : "agents.automation.disable";
  // Original WorkflowDialog SUBMIT_LABELS; lifecycle reviews keep the governed review label.
  const submitLabel = creating ? edit?.action === "copy" ? "workflows.dialog.createCopy" : "workflows.dialog.create"
    : edit.action === "publish_version" ? "workflows.dialog.save" : "agents.review";
  // Scope 尚未读成真实 Workspace 时不制造空执行器/未知创建表单；已冻结的写意图仍保留。
  if (!workspaceId && !intent) return null;
  if (edit?.action === "delete") return <WorkflowDeleteDialog open={open || !!intent}
    name={(edit.detail.automation.pinnedVersionAssetId
      ? edit.detail.versions.find(version => version.assetId === edit.detail.automation.pinnedVersionAssetId)
      : edit.detail.versions[0])?.content.name || t("workflows.unnamed")} isPending={busy} locked={!!intent}
    disabled={!intent && (requestBlocked || edit.detail.canManage !== true)} unknown={unknown}
    error={failure && failure.kind !== "unknown" ? failureText(failure) : null}
    onOpenChange={(next) => { if (!next) requestClose(); }} onConfirm={async () => {
      const command = intent ?? prepare();
      if (command) await submit(command);
    }}>
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure?.kind === "unknown" ? <p role="status" className="break-words text-sm">{t("agents.unknown", {operation: failure.operationId ?? "—"})}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length ? <div role="status" className="flex flex-col gap-1 text-sm">{pending.map((task) => <p className="break-words" key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}
        <Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
  </WorkflowDeleteDialog>;
  return <>
    <Dialog open={open || !!intent} onOpenChange={(next) => { if (!next) requestClose(); }}>
    <DialogContent className="flex h-[88vh] max-h-[88vh] w-[calc(100vw-2rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0"
      showCloseButton={false} data-testid="workflow-editor-dialog"
      onEscapeKeyDown={(event) => {
        if (intent || busy) { event.preventDefault(); return; }
        if (event.target instanceof HTMLElement
          && event.target.closest("[data-workflow-filter-picker-search]")) {
          event.preventDefault(); return;
        }
        if (formBuilderRef.current?.closeInspector()) {
          event.preventDefault(); event.stopPropagation();
        }
      }}
      onInteractOutside={(event) => event.preventDefault()}>
    <DialogHeader className="flex flex-shrink-0 flex-row items-center justify-between gap-6 space-y-0 px-6 pt-3 pb-2 text-left">
      <div className="min-w-0 space-y-0"><DialogTitle className="text-lg leading-tight">{t(title)}</DialogTitle>
        <DialogDescription className="sr-only">{t("agents.automation.yamlHelp")}</DialogDescription>
        {contentAction ? <WorkflowNameEditor disabled={!!intent || busy || !!nameDocument?.errors.length}
          name={visibleName} onCommit={(next) => {
            if (editorMode === "form") { setName(next); return true; }
            if (!nameDocument || nameDocument.errors.length) return false;
            try { nameDocument.set("name", next); setYamlText(nameDocument.toString()); setEditorError(false); return true; }
            catch { return false; }
          }} /> : null}</div>
      <div className="flex items-center gap-2">
        {editedDetail && onSwitch ? <WorkflowActionsMenu isEnabled={editedEnabled} disabled={!!intent || busy}
          showEnabledToggle={editedDetail.canManage}
          onTrigger={editedDetail.canRun === true && editedEnabled ? () => requestTransition({ detail: editedDetail, action: "run" }) : undefined}
          onEdit={editedContent ? () => requestTransition({ detail: editedDetail, action: "publish_version", content: editedContent }) : undefined}
          onDuplicate={editedContent ? () => requestTransition({ detail: editedDetail, action: "copy", content: editedContent }) : undefined}
          onToggleEnabled={() => requestTransition({ detail: editedDetail, action: editedEnabled ? "disable" : "enable" })}
          onDelete={() => requestTransition({ detail: editedDetail, action: "delete" })} /> : null}
        <Button disabled={!!intent || busy} aria-label={t("buzz.close")} className="h-8 w-8 text-muted-foreground" onClick={requestClose}><X aria-hidden className="h-4 w-4" /></Button>
      </div>
    </DialogHeader>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 pb-4 pt-2">
    {!intent ? <form className="flex min-h-full flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      {!creating ? <p className="break-words text-sm">{edit.detail.automation.resourceId} · {t("agents.resourceVersion")}: {edit.detail.automation.resourceVersion}</p> : null}
      {edit?.action === "run" ? <Notice>{t("agents.automation.runConfirm")}</Notice> : null}
      {creating ? <>
        {installations.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
          : !executorPage ? <AgentReadFailure error={installations.status === "error" ? installations.error : undefined} onRetry={reloadInstallations} />
          : executors.length === 0 ? <Notice>{t("agents.automation.noExecutor")}</Notice>
          : <label className="flex flex-col gap-1 text-sm">{t("agents.automation.executor")}
            <select required value={executorId} onChange={(event) => setExecutorId(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
              <option value="">{t("agents.automation.select")}</option>{executors.map((row) => <option key={row.resourceId} value={row.resourceId}>{row.resourceId}</option>)}
            </select>
          </label>}
        <div className="flex gap-2">
          {executorIndex > 0 ? <Button onClick={() => { setExecutorId(""); setExecutorIndex(executorIndex - 1); }}>{t("roles.previous")}</Button> : null}
          {executorPage?.nextOffset !== undefined ? <Button onClick={() => {
            setExecutorId(""); setExecutorOffsets((old) => [...old.slice(0, executorIndex + 1), executorPage.nextOffset!]); setExecutorIndex(executorIndex + 1);
          }}>{t("roles.next")}</Button> : null}
        </div>
      </> : null}
      {contentAction ? <>
        {!creating && selectedInstallation.status === "error" ? <AgentReadFailure error={selectedInstallation.error} onRetry={reloadSelectedInstallation} /> : null}
        {editorError ? <Notice role="alert">{t("agents.automation.yamlInvalid")}</Notice> : null}
        {editorMode === "yaml" ? <><div className="max-w-md flex-shrink-0">{scopeField}</div><WorkflowYamlEditor value={yamlText} disabled={busy || !!intent || unknown}
          onChange={(value) => { setYamlText(value); setEditorError(false); }} /></> : <>
        <WorkflowFormCanvas key={draftEpoch} ref={formBuilderRef} trigger={trigger} triggerFields={triggerFields} scopeField={scopeField}
          triggerPresentation={triggerPresentation}
          onAgentTurn={trigger === TriggerKind.Webhook ? undefined : () => { setActionKind(AutomationVersionContentActionKind.AgentTurn); setTemplate(""); }}
          onRemoveAction={() => { setActionKind(AutomationVersionContentActionKind.PostMessage); setTemplate(""); }}
          action={actionKind === AutomationVersionContentActionKind.AgentTurn ? {kind: AutomationVersionContentActionKind.AgentTurn, template} : undefined}
          actionFields={actionKind === AutomationVersionContentActionKind.AgentTurn ? <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground" htmlFor={`${formId}-agent-template`}>{t("agents.automation.template")}</label>
            <AgentTextarea id={`${formId}-agent-template`} required value={template} disabled={busy || !!intent || unknown}
              onChange={(event) => setTemplate(event.target.value)} className="min-h-[60px] resize-y text-xs" />
          </div> : undefined}
          disabled={busy || !!intent || unknown} policies={policies}
          steps={steps.length ? steps : template && actionKind === AutomationVersionContentActionKind.PostMessage
            ? [{id: nextStepId([]), action: AutomationStepAction.SendMessage, text: template}] : []}
          onStepsChange={(next) => {
            setSteps(next);
            const terminal = next.at(-1);
            setTemplate(terminal?.text ?? terminal?.emoji ?? terminal?.topic ?? terminal?.url ?? "");
            if (terminal) {
              setActionKind(terminal.action === AutomationStepAction.AddReaction ? AutomationStepAction.AddReaction
                : terminal.action === AutomationStepAction.SetChannelTopic ? AutomationStepAction.SetChannelTopic
                : terminal.action === AutomationStepAction.CallWebhook ? AutomationStepAction.CallWebhook : AutomationVersionContentActionKind.PostMessage);
              setStepsFormat(terminal.action === AutomationStepAction.SendMessage ? 3 : 2);
            }
            if (next.some(step => step.action === AutomationStepAction.RequestApproval)) setPolicyKey("");
          }} />
        {!steps.some((step) => step.action === AutomationStepAction.RequestApproval) && (policies?.length || policyKey) ? <label className="flex flex-col gap-1 text-sm">{t("agents.automation.approvalPolicy")}
          <select value={policyKey} disabled={!policies} onChange={(event) => {
            if (event.target.value === "" || policies?.some((row) => `${row.id}:${row.version}` === event.target.value))
              setPolicyKey(event.target.value);
          }} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t("agents.automation.noApproval")}</option>
            {policyKey && !selectedPolicy ? <option value={policyKey} disabled>{policyKey}</option> : null}
            {policies?.map((row) => <option key={`${row.id}:${row.version}`} value={`${row.id}:${row.version}`}>{row.id} · {row.version}</option>)}
          </select>
        </label> : null}
        {!policyAvailable ? <Notice role="status">{t("agents.automation.approvalUnavailable")}
          <Button onClick={reloadAdmission}>{t("platform.retry")}</Button></Notice> : null}
        <p className="text-sm">{t("agents.automation.resultTarget")}: {t(actionKind === AutomationStepAction.SetChannelTopic || trigger === TriggerKind.Schedule || trigger === TriggerKind.Webhook ? "agents.automation.channel" : "agents.automation.thread")}</p>
        </>}
      </> : null}
      {edit?.action === "enable" ? <>
        <label className="flex flex-col gap-1 text-sm">{t("agents.publishedVersion")}
          <select required value={versionId} onChange={(event) => setVersionId(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t("agents.automation.select")}</option>{versions.map((row) => <option key={row.assetId} value={row.assetId}>{row.assetId} · {row.assetVersion}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">{t("agents.automation.grant")}
          <select required value={grantId} onChange={(event) => setGrantId(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t("agents.automation.select")}</option>{grants.map((row) => <option key={row.delegationId} value={row.delegationId}>{row.delegationId} · {row.delegationVersion}</option>)}
          </select>
        </label>
      </> : null}
      {((contentAction && trigger === TriggerKind.Schedule) || (edit?.action === "enable" && version?.content.trigger.kind === TriggerKind.Schedule))
        && !scheduleSupported ? <Notice role="status">{t("agents.automation.scheduleUnavailable")}</Notice> : null}
      {edit?.action === "rotate_webhook_secret" ? <Notice role="status">{t("workflows.webhook.rotateNotice")}</Notice> : null}
      <div className="sticky bottom-0 mt-auto flex flex-shrink-0 flex-wrap items-center justify-between gap-4 bg-background pt-2 pb-1">
        {contentAction ? <div className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-muted-foreground" role="group" aria-label={t("agents.automation.yaml")}>
          <Button className={editorMode === "form" ? "h-7 bg-background px-3 text-xs shadow-xs" : "h-7 border-transparent px-3 text-xs"} aria-pressed={editorMode === "form"} onClick={() => changeEditor("form")}>{t("agents.automation.form")}</Button>
          <Button className={editorMode === "yaml" ? "h-7 gap-1.5 bg-background px-3 text-xs shadow-xs" : "h-7 gap-1.5 border-transparent px-3 text-xs"} aria-pressed={editorMode === "yaml"} onClick={() => changeEditor("yaml")}><Code aria-hidden className="h-3.5 w-3.5" />{t("agents.automation.yaml")}</Button>
        </div> : null}
        <div className="flex items-center gap-2">
        {addingFirstStep ? <WorkflowButton aria-label={t("workflows.addFirstStep")} data-testid="workflow-dialog-primary-action"
          disabled={!canCreate || !executor || requestBlocked || busy} onClick={() => formBuilderRef.current?.addFirstStep()} type="button">
          {t("workflows.addStep")}</WorkflowButton>
          : !creating || (canCreate && executor) ? <Button type="submit" disabled={requestBlocked || (edit?.action === "enable" && !enableAvailable)
            || (contentAction && !contentAvailable)}>{t(submitLabel)}</Button> : null}
        <Button onClick={requestClose}>{t("buzz.close")}</Button>
        </div>
      </div>
      {creating && admission.status === "error" ? <AgentReadFailure error={admission.error} onRetry={reloadAdmission} /> : null}
    </form> : <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-words">{intent.actionKey} · {intent.resourceId ?? intent.workspaceId} · {intent.resourceVersion ?? "—"}</p>
      {intent.automationVersionContent ? <>
        <p className="break-words">{t("workflows.name")}: {intent.automationVersionContent.name ?? t("workflows.unnamed")}</p>
        <p className="break-words">{t("agents.automation.executor")}: {intent.executorInstallationResourceId ?? edit?.detail.automation.executorInstallationResourceId}</p>
        <p>{t("agents.automation.trigger")}: {intent.automationVersionContent.trigger.kind === TriggerKind.Mention
          ? t("agents.installation.trigger.mention") : t(intent.automationVersionContent.trigger.kind === TriggerKind.Schedule ? "agents.automation.schedule"
            : intent.automationVersionContent.trigger.kind === TriggerKind.Webhook ? "agents.automation.webhook" : "agents.automation.channelMessage")}</p>
        {intent.automationVersionContent.trigger.scheduleSpec ? <>
          <p>{t("agents.automation.everySeconds")}: {intent.automationVersionContent.trigger.scheduleSpec.everySeconds}</p>
          <p>{t("agents.automation.offsetSeconds")}: {intent.automationVersionContent.trigger.scheduleSpec.offsetSeconds}</p>
          <p>{t("agents.automation.catchupWindowSeconds")}: {intent.automationVersionContent.trigger.scheduleSpec.catchupWindowSeconds}</p>
        </> : null}
        {intent.automationVersionContent.trigger.textPrefix ? <p className="break-words">{t("agents.automation.prefix")}: {intent.automationVersionContent.trigger.textPrefix}</p> : null}
        {intent.automationVersionContent.trigger.filter ? <p className="break-words">{t("workflows.condition.expression")}: {intent.automationVersionContent.trigger.filter}</p> : null}
        <p className="whitespace-pre-wrap">{workflowAction(intent.automationVersionContent)?.template}</p>
        <p>{t("agents.automation.approvalPolicy")}: {workflowApprovalPolicy(intent.automationVersionContent)
          ? `${workflowApprovalPolicy(intent.automationVersionContent)?.id} · ${workflowApprovalPolicy(intent.automationVersionContent)?.version}`
          : t("agents.automation.noApproval")}</p>
        <p>{t("agents.automation.resultTarget")}: {t(workflowAction(intent.automationVersionContent)?.kind === AutomationStepAction.SetChannelTopic || intent.automationVersionContent.resultTarget === ResultTarget.Channel ? "agents.automation.channel" : "agents.automation.thread")}</p>
      </> : null}
      {intent.assetId ? <p className="break-words">{intent.assetId} · {intent.assetVersion} · {intent.delegationId} · {intent.delegationVersion}</p> : null}
      <p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}</div>
    </div>}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : t("agents.rejected", { reason: failureText(failure) })}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length ? <div role="status" className="flex flex-col gap-1 text-sm">{pending.map((task) => <p className="break-words" key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}
        <Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
    </div>
    </DialogContent>
    </Dialog>
    <WorkflowDiscardDialog open={(discardOpen || navigationBlocked) && open && !intent && !busy}
      onOpenChange={(next) => {
        setDiscardOpen(next);
        if (!next) pendingTransition.current = null;
        if (!next && navigationBlocked && !proceedingNavigation.current) workflowNavigation?.blocker.reset?.();
      }}
      onDiscard={() => {
        if (intent || busy) return;
        setDiscardOpen(false);
        const transition = pendingTransition.current;
        pendingTransition.current = null;
        if (transition && !navigationBlocked) { transition(); return; }
        if (navigationBlocked) { proceedingNavigation.current = true; workflowNavigation?.blocker.proceed?.(); }
        onClose();
      }} />
    {!open && !intent && submission ? <p role="status" className="break-words text-sm">{t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
  </>;
}

const projectionLabels = {
  [AgentRuntimeProjectionState.Pending]: "agents.installation.projection.pending",
  [AgentRuntimeProjectionState.Active]: "agents.installation.projection.active",
  [AgentRuntimeProjectionState.Error]: "agents.installation.projection.error",
  [AgentRuntimeProjectionState.Revoked]: "agents.installation.projection.revoked",
} as const satisfies Record<AgentRuntimeProjectionState, PlatformMessageKey>;
const resourceLabels = {
  [ResourceState.Provisioning]: "agents.installation.resource.provisioning",
  [ResourceState.Active]: "agents.installation.resource.active",
  [ResourceState.Unknown]: "agents.installation.resource.unknown",
  [ResourceState.Failed]: "agents.installation.resource.failed",
  [ResourceState.RetainedReadOnly]: "agents.installation.resource.retained",
  [ResourceState.Deleting]: "agents.installation.resource.deleting",
  [ResourceState.Deleted]: "agents.installation.resource.deleted",
} as const satisfies Record<ResourceState, PlatformMessageKey>;
const principalLabels = { ACTIVE: "agents.installation.principal.active", DISABLED: "agents.installation.principal.disabled" } as const;
const channelLabels = { ACTIVE: "agents.installation.channel.active", DISABLED: "agents.installation.channel.disabled", ERROR: "agents.installation.channel.error" } as const;
const triggerLabels = {
  [AgentTrigger.Mention]: "agents.installation.trigger.mention",
  [AgentTrigger.ManualAssignment]: "agents.installation.trigger.manual",
} as const satisfies Record<AgentTrigger, PlatformMessageKey>;

function InstallationManagement({ versionRevision, refreshRevision, onLockedChange, workspaceId, onWorkspaceChange, avatarHost }: WorkspaceNavigation & {
  versionRevision: number; refreshRevision: number; onLockedChange: (locked: boolean) => void;
  avatarHost?: AgentAvatarHost;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`agent-installation-workspaces:${refreshRevision}`, client.workspaces);
  const [selected, setSelected] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [revision, setRevision] = useState(0);
  const [delegationTarget, setDelegationTarget] = useState<AgentInstallationView | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<AgentInstallationView | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<AgentInstallationView | null>(null);
  const [regrantTarget, setRegrantTarget] = useState<AgentInstallationView | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => { onLockedChange(locked); }, [locked, onLockedChange]);
  const value = state.status === "ok" ? state.data : null;
  const workspaces = value && Array.isArray(value) && value.every((w) => w && typeof w.id === "string" && !!w.id
    && typeof w.name === "string" && typeof w.slug === "string") && new Set(value.map((w) => w.id)).size === value.length ? value : null;
  const selection = onWorkspaceChange ? workspaceId : selected ?? workspaceId;
  const workspace = selection ? workspaces?.find((w) => w.id === selection) : workspaces?.[0];
  return <section className="flex flex-col gap-3" data-testid="agent-installations">
    <h2 className="font-medium">{t("agents.installation.title")}</h2>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !workspaces ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : !workspace ? <Notice>{t("agents.installation.noWorkspace")}</Notice>
      : <>
        <label className="flex flex-wrap items-center gap-2 text-sm">{t("platform.workspace")}
          <select disabled={locked} className="h-8 min-w-0 max-w-full rounded-md border border-input bg-background px-2" value={workspace.id}
            onChange={(event) => { if (onWorkspaceChange) onWorkspaceChange(event.target.value); else setSelected(event.target.value); setDelegationTarget(null); setPermissionTarget(null); setUpgradeTarget(null); setRegrantTarget(null); }}>
            {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        </label>
      </>}
    {/* 原意图留在 Workspace/列表之外，结果不明时不生成替代键。 */}
    <Button className="w-fit" disabled={locked || !workspace} onClick={() => setCreateOpen(true)}>{t("agents.installation.create")}</Button>
    <InstallationCreate open={createOpen} onClose={() => setCreateOpen(false)} workspaceId={workspace?.id} workspaceName={workspace?.name} sourceRevision={`${versionRevision}:${revision}:${refreshRevision}`} locked={locked} onLocked={setLocked}
      onRecorded={() => setRevision((old) => old + 1)} />
    {upgradeTarget ? <InstallationCreate key={`upgrade:${upgradeTarget.resourceId}`} upgrade={upgradeTarget} open onClose={() => setUpgradeTarget(null)}
      workspaceId={upgradeTarget.workspaceId} workspaceName={workspace?.name} sourceRevision={`${versionRevision}:${revision}:${refreshRevision}`}
      locked={locked} onLocked={setLocked} onRecorded={() => setRevision((old) => old + 1)} /> : null}
    {regrantTarget ? <InstallationCreate key={`regrant:${regrantTarget.resourceId}`} upgrade={regrantTarget} regrant open onClose={() => setRegrantTarget(null)}
      workspaceId={regrantTarget.workspaceId} workspaceName={workspace?.name} sourceRevision={`${versionRevision}:${revision}:${refreshRevision}`}
      locked={locked} onLocked={setLocked} onRecorded={() => setRevision((old) => old + 1)} /> : null}
    <AgentManagementDialog open={delegationTarget !== null} title={t("agents.delegation.title")} locked={locked} onClose={() => setDelegationTarget(null)}>
      <InstallationDelegation installation={delegationTarget} locked={locked} onLocked={setLocked} onReset={() => setDelegationTarget(null)}
        onRecorded={() => setRevision((old) => old + 1)} />
    </AgentManagementDialog>
    <AgentManagementDialog open={permissionTarget !== null} title={t("agents.execute.open")} locked={locked} onClose={() => setPermissionTarget(null)}>
    {permissionTarget ? <>
      <InstallationPermission key={`execute:${permissionTarget.resourceId}:${permissionTarget.workspaceId}`} kind="execute" installation={permissionTarget} locked={locked} onLocked={setLocked}
        onRecorded={() => setRevision((old) => old + 1)} />
      {permissionTarget.readPermission ? <InstallationPermission key={`read:${permissionTarget.resourceId}:${permissionTarget.workspaceId}`} kind="read" installation={permissionTarget} locked={locked} onLocked={setLocked}
        onRecorded={() => setRevision((old) => old + 1)} /> : null}
    </> : null}
    </AgentManagementDialog>
    {workspace ? <InstallationList key={`${workspace.id}:${revision}`} workspaceId={workspace.id} locked={locked} onLocked={setLocked} avatarHost={avatarHost}
      onPermission={setPermissionTarget} onManage={setDelegationTarget} onUpgrade={setUpgradeTarget} onRegrant={setRegrantTarget} /> : null}
  </section>;
}

/**
 * Buzz 779af8886caae1317b4de962082429867ab61503 MembersSidebar/AddChannelBotDialog consumers for one
 * channel's Workspace: the same governed install (agent.installation.create), installation
 * detail with its use authorization, execution/read permission, delegation and upgrade dialogs
 * as the Agents page. The host only chooses which one is open.
 */
export function WorkspaceAgentDialogs({ workspaceId, workspaceName, createOpen, onCreateOpenChange, selectedId, onSelectedChange, onRecorded, manageDelegation = false }: {
  workspaceId: string; workspaceName: string;
  createOpen: boolean; onCreateOpenChange: (open: boolean) => void;
  selectedId: string | null; onSelectedChange: (resourceId: string | null) => void;
  onRecorded?: () => void;
  /**
   * DD-121 renewal entry: once the selected Installation is freshly read and manageable, open its
   * delegation management directly (the same "View delegation grants" step); otherwise the
   * installation detail stays as the fallback.
   */
  manageDelegation?: boolean;
}) {
  const t = useT();
  const [locked, setLocked] = useState(false);
  const [revision, setRevision] = useState(0);
  const [delegationTarget, setDelegationTarget] = useState<AgentInstallationView | null>(null);
  const [permissionTarget, setPermissionTarget] = useState<AgentInstallationView | null>(null);
  const [upgradeTarget, setUpgradeTarget] = useState<AgentInstallationView | null>(null);
  const [regrantTarget, setRegrantTarget] = useState<AgentInstallationView | null>(null);
  const recorded = () => { setRevision((old) => old + 1); onRecorded?.(); };
  return <>
    <InstallationCreate open={createOpen} onClose={() => onCreateOpenChange(false)} workspaceId={workspaceId} workspaceName={workspaceName}
      sourceRevision={`channel:${revision}`} locked={locked} onLocked={setLocked} onRecorded={recorded} />
    {upgradeTarget ? <InstallationCreate key={`upgrade:${upgradeTarget.resourceId}`} upgrade={upgradeTarget} open onClose={() => setUpgradeTarget(null)}
      workspaceId={upgradeTarget.workspaceId} workspaceName={workspaceName} sourceRevision={`channel:${revision}`}
      locked={locked} onLocked={setLocked} onRecorded={recorded} /> : null}
    {regrantTarget ? <InstallationCreate key={`regrant:${regrantTarget.resourceId}`} upgrade={regrantTarget} regrant open onClose={() => setRegrantTarget(null)}
      workspaceId={regrantTarget.workspaceId} workspaceName={workspaceName} sourceRevision={`channel:${revision}`}
      locked={locked} onLocked={setLocked} onRecorded={recorded} /> : null}
    <AgentManagementDialog open={selectedId !== null} title={t("agents.installation.open")} locked={locked} onClose={() => onSelectedChange(null)}>
      {selectedId ? <InstallationDetail key={`${selectedId}:${revision}`} resourceId={selectedId} workspaceId={workspaceId} locked={locked} onLocked={setLocked}
        autoManage={manageDelegation}
        onPermission={(row) => { onSelectedChange(null); setPermissionTarget(row); }}
        onManage={(row) => { onSelectedChange(null); setDelegationTarget(row); }}
        onUpgrade={(row) => { onSelectedChange(null); setUpgradeTarget(row); }}
        onRegrant={(row) => { onSelectedChange(null); setRegrantTarget(row); }} /> : null}
    </AgentManagementDialog>
    <AgentManagementDialog open={delegationTarget !== null} title={t("agents.delegation.title")} locked={locked} onClose={() => setDelegationTarget(null)}>
      <InstallationDelegation installation={delegationTarget} locked={locked} onLocked={setLocked} onReset={() => setDelegationTarget(null)}
        onRecorded={recorded} />
    </AgentManagementDialog>
    <AgentManagementDialog open={permissionTarget !== null} title={t("agents.execute.open")} locked={locked} onClose={() => setPermissionTarget(null)}>
    {permissionTarget ? <>
      <InstallationPermission key={`execute:${permissionTarget.resourceId}:${permissionTarget.workspaceId}`} kind="execute" installation={permissionTarget} locked={locked} onLocked={setLocked}
        onRecorded={recorded} />
      {permissionTarget.readPermission ? <InstallationPermission key={`read:${permissionTarget.resourceId}:${permissionTarget.workspaceId}`} kind="read" installation={permissionTarget} locked={locked} onLocked={setLocked}
        onRecorded={recorded} /> : null}
    </> : null}
    </AgentManagementDialog>
  </>;
}

function validInstallationCandidate(row: AgentInstallationCandidate): boolean {
  return !!row && typeof row.agentResourceId === "string" && !!row.agentResourceId
    && typeof row.agentVersionAssetId === "string" && !!row.agentVersionAssetId
    && typeof row.displayName === "string" && !!row.displayName
    && Number.isSafeInteger(row.resourceVersion) && row.resourceVersion > 0
    && Number.isSafeInteger(row.assetVersion) && row.assetVersion > 0
    && Number.isSafeInteger(row.ordinal) && row.ordinal > 0;
}

function matchingInstallationTask(task: TaskView, receipt: ActionSubmission, workspaceId: string): boolean {
  return validDefinitionTask(task) && ["agent.installation.create", "agent.installation.upgrade"].includes(task.actionKey)
    && task.actionKey === receipt.actionKey && task.actionExecutionId === receipt.actionExecutionId
    && task.operationId === receipt.operationId && task.workspaceId === workspaceId
    && Number.isSafeInteger(task.actionVersion) && task.actionVersion > 0
    && typeof task.createdAt === "string" && Number.isFinite(Date.parse(task.createdAt))
    && (task.reason === undefined || Object.values(ReasonCode).includes(task.reason))
    && (task.observation === undefined || Object.values(ReasonCode).includes(task.observation))
    && (task.waitingReason === undefined || typeof task.waitingReason === "string")
    && (task.workflowId === undefined ? task.workflowKind === undefined && task.taskStatus === undefined
      : task.workflowKind === WorkflowKind.AgentInstallation)
    && (receipt.workflowId === undefined || task.workflowId === receipt.workflowId)
    // Installation is Temporal-backed; a dispatched receipt without its Workflow
    // cannot inherit the synchronous "applied" presentation from generic Tasks.
    && (task.gateState !== ActionGateState.Allowed || task.dispatchState !== ActionDispatchState.Dispatched
      || task.workflowId !== undefined || task.observation !== undefined);
}

function InstallationTaskReceipt({ receipt, workspaceId }: { receipt: ActionSubmission; workspaceId: string }) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const [state, reload] = useLoad(`installation-task:${workspaceId}:${receipt.actionExecutionId}:${receipt.operationId}:${receipt.workflowId ?? ""}`,
    () => client.task(receipt.actionExecutionId));
  const task = state.status === "ok" && matchingInstallationTask(state.data, receipt, workspaceId) ? state.data : null;
  const phase = task ? taskPhase(task) : null;
  return <section className="flex flex-col gap-2 rounded-md border p-3 text-sm" data-testid="agent-installation-task">
    <div className="flex items-center gap-2"><h4 className="font-medium">{t("tasks.title")}</h4>
      <Button onClick={reload}>{t("platform.refresh")}</Button></div>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !task || !phase ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <p role="status"><Badge tone={phase.tone}>{t(phase.label)}</Badge></p>
        {task.observation ? <p>{reasonText(task.observation)}</p> : null}
        {task.reason ? <p>{reasonText(task.reason)}</p> : null}
        {task.waitingReason ? <p>{t("tasks.waitingReason")}: {task.waitingReason}</p> : null}
        <p className="break-words">{t("tasks.execution")}: {task.actionExecutionId}</p>
        <p className="break-words">{t("tasks.operation")}: {task.operationId}</p>
        <p className="break-words">{t("tasks.target")}: {task.targetId}</p>
        {task.workflowId ? <p className="break-words">{t("tasks.workflow")}: {task.workflowId}</p> : null}
      </>}
  </section>;
}

function InstallationCreate({ workspaceId, workspaceName, sourceRevision, locked, onLocked, onRecorded, upgrade, regrant = false, open, onClose }: {
  workspaceId?: string; workspaceName?: string; sourceRevision: string; locked: boolean; onLocked: (locked: boolean) => void; onRecorded: () => void; upgrade?: AgentInstallationView;
  /**
   * DD-122 (4), V-SCN-109: re-grant tools by the same governed agent.installation.upgrade to the
   * Installation's own freshly read pinned Version; the new generation grants what the initiator can share.
   */
  regrant?: boolean;
  open: boolean; onClose: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [intent, setIntent] = useState<{ command: ActionCommand; name: string; workspace: string; ordinal: number } | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [submissionScope, setSubmissionScope] = useState<{ workspaceId: string; client: typeof client } | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const actionKey = upgrade ? "agent.installation.upgrade" : "agent.installation.create";
  const offset = offsets[index] ?? 0;
  const [sources, reloadSources] = useLoad(`installation-candidates:${workspaceId}:${offset}:${sourceRevision}`,
    async (): Promise<AgentInstallationCandidatePage | null> => {
      if (!workspaceId) return null;
      if (!upgrade) return client.agentInstallationCandidates(workspaceId, offset);
      const current = await client.agentInstallation(upgrade.resourceId);
      if (!validInstallation(current) || current.resourceId !== upgrade.resourceId
        || current.workspaceId !== workspaceId || current.agentResourceId !== upgrade.agentResourceId) throw new TransportError(t("platform.loadFailed"));
      if (regrant) {
        if (current.canUpgrade !== true) return { workspaceId, canCreate: false, nextOffset: undefined, candidates: [] };
        const pinned = await client.agentVersion(current.pinnedVersionAssetId);
        if (!validVersion(pinned, upgrade.agentResourceId) || pinned.assetId !== current.pinnedVersionAssetId) throw new TransportError(t("platform.loadFailed"));
        return { workspaceId, canCreate: true, nextOffset: undefined,
          candidates: pinned.state === AgentVersionState.Published ? [{ agentResourceId: upgrade.agentResourceId, agentVersionAssetId: pinned.assetId,
            displayName: pinned.content.personaIdentity.displayName, resourceVersion: current.resourceVersion,
            assetVersion: pinned.assetVersion, ordinal: pinned.ordinal }] : [] };
      }
      const page = await client.agentVersions(upgrade.agentResourceId, offset);
      if (page.agentResourceId !== upgrade.agentResourceId || !Array.isArray(page.versions)
        || !page.versions.every((version) => validVersion(version, upgrade.agentResourceId))) throw new TransportError(t("platform.loadFailed"));
      return { workspaceId, canCreate: current.canUpgrade === true, nextOffset: page.nextOffset ?? undefined,
        candidates: current.canUpgrade === true ? page.versions.filter((version) => version.state === AgentVersionState.Published && version.assetId !== current.pinnedVersionAssetId)
          .map((version) => ({agentResourceId: upgrade.agentResourceId, agentVersionAssetId: version.assetId,
            displayName: version.content.personaIdentity.displayName, resourceVersion: current.resourceVersion,
            assetVersion: version.assetVersion, ordinal: version.ordinal})) : [] };
    });
  const page = sources.status === "ok" && sources.data && sources.data.workspaceId === workspaceId
    && typeof sources.data.canCreate === "boolean" && Array.isArray(sources.data.candidates)
    && sources.data.candidates.every(validInstallationCandidate)
    && new Set(sources.data.candidates.map((row) => row.agentVersionAssetId)).size === sources.data.candidates.length
    && (sources.data.canCreate || sources.data.candidates.length === 0)
    && (sources.data.nextOffset === undefined || (Number.isSafeInteger(sources.data.nextOffset) && sources.data.nextOffset > offset))
    ? sources.data : null;
  const candidate = !page?.canCreate ? undefined
    : regrant ? (page.candidates.length === 1 ? page.candidates[0] : undefined)
    : page.candidates.find((row) => row.agentVersionAssetId === selected);
  const [tasks, reloadTasks] = useLoad("installation-actions-in-flight", client.tasks);
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => task.actionKey === actionKey
    && (task.workspaceId === undefined || task.workspaceId === workspaceId) && taskPhase(task).tone === "neutral") ?? [];
  const requestBlocked = !taskRows || pending.length > 0;
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  useEffect(() => { setSelected(""); setOffsets([0]); setIndex(0); }, [workspaceId]);
  const prepare = () => {
    if (intent || locked || busy || requestBlocked || !workspaceId || !workspaceName || !candidate) return;
    setIntent({ command: { actionKey, idempotencyKey: newIdempotencyKey(),
      workspaceId, resourceId: upgrade?.resourceId ?? candidate.agentResourceId, resourceVersion: candidate.resourceVersion,
      assetId: candidate.agentVersionAssetId, assetVersion: candidate.assetVersion }, name: candidate.displayName,
      workspace: workspaceName, ordinal: candidate.ordinal });
    setFailure(null); setSubmission(null); setSubmissionScope(null); onLocked(true);
  };
  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    if (!unknown) setFailure(null);
    try {
      const result = await client.submitAction(intent.command);
      if (!result || result.actionKey !== intent.command.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setFailure(null); setSubmission(result);
      setSubmissionScope({ workspaceId: intent.command.workspaceId!, client });
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); setSelected(""); onLocked(false); onRecorded(); reloadSources();
      }
    } catch (error) {
      // A refused recheck cannot establish the original request's outcome.
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };
  if (!workspaceId && !intent) return null;
  const title = regrant && upgrade ? "agents.installation.tools.regrant" : upgrade ? "agents.upgradeVersion" : "agents.installation.create";
  return <AgentManagementDialog open={open || intent !== null} title={t(title)}
    locked={busy || intent !== null} onClose={onClose}>
  <section className="flex flex-col gap-3" data-testid={regrant && upgrade ? "agent-installation-regrant" : upgrade ? "agent-installation-upgrade" : "agent-installation-create"}>
    <h3 className="text-sm font-medium">{t(title)}</h3>
    <p className="text-sm text-muted-foreground">{t("agents.installation.management")}</p>
    {regrant && upgrade ? <p className="text-sm text-muted-foreground">{t("agents.installation.tools.regrantHint")}</p> : null}
    {upgrade ? <Notice>{t("agents.upgradeDrain")}</Notice> : null}
    {!intent ? <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      {sources.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !page ? <AgentReadFailure error={sources.status === "error" ? sources.error : undefined} onRetry={reloadSources} />
        : !page.canCreate ? <Notice>{t("agents.installation.createUnavailable")}</Notice>
        : page.candidates.length === 0 ? <Notice>{t("agents.installation.noPublished")}</Notice>
        : regrant && candidate ? <p className="break-words text-sm">{t("agents.installation.tools.regrantVersion")}: {candidate.displayName} · {candidate.ordinal} · {candidate.agentVersionAssetId}</p>
        : <label className="flex flex-col gap-1 text-sm">{t(upgrade ? "agents.upgradeTarget" : "agents.installation.definition")}
          <select disabled={locked} required value={selected} onChange={(event) => setSelected(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
            <option value="">{t("agents.automation.select")}</option>
            {page.candidates.map((row) => <option key={row.agentVersionAssetId} value={row.agentVersionAssetId}>{row.displayName} · {row.ordinal} · {row.agentVersionAssetId}</option>)}
          </select>
        </label>}
      <div className="flex gap-2">
        {index > 0 ? <Button disabled={locked} onClick={() => { setSelected(""); setIndex(index - 1); }}>{t("roles.previous")}</Button> : null}
        {page?.nextOffset !== undefined ? <Button disabled={locked} onClick={() => {
          setSelected(""); setOffsets((old) => [...old.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1);
        }}>{t("roles.next")}</Button> : null}
      </div>
      {page?.canCreate ? <Button className="w-fit" type="submit" disabled={locked || requestBlocked || !candidate}>{t("agents.review")}</Button> : null}
    </form> : <div className="flex flex-col gap-2 text-sm" role="group">
      <p>{intent.name}</p>
      <p className="break-words">{t("platform.workspace")}: {intent.workspace} · {intent.command.workspaceId}</p>
      <p className="break-words">{t("agents.installation.definition")}: {intent.command.resourceId} · {intent.command.resourceVersion}</p>
      <p className="break-words">{t("agents.publishedVersion")}: {intent.command.assetId} · {intent.command.assetVersion}</p>
      <p>{t("agents.version.ordinal")}: {intent.ordinal}</p>
      <p className="text-muted-foreground">{t("agents.installation.notReady")}</p>
      <p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry")
        : t(regrant && upgrade ? "agents.installation.tools.regrantSubmit" : upgrade ? "agents.upgradeSubmit" : "agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}</div>
    </div>}
    {submission && submissionScope && submissionScope.workspaceId === workspaceId && submissionScope.client === client ? <>
      <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
        : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p>
      <InstallationTaskReceipt key={`${workspaceId}:${submission.actionExecutionId}:${submission.operationId}`}
        receipt={submission} workspaceId={submissionScope.workspaceId} />
    </> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : t("agents.rejected", { reason: failureText(failure) })}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length ? <div role="status" className="flex flex-col gap-1 text-sm">{pending.map((task) => <p key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}
        <Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
  </section></AgentManagementDialog>;
}

function scopeKey(scope: DelegationScopeParameters): string {
  return JSON.stringify([scope.actionKey, scope.actionVersion, scope.targetType, scope.targetId,
    scope.createWorkspaceId, scope.toolResourceId, scope.resultExposureMode, scope.outputSchemaHash, scope.redactionPolicy]);
}

function validDelegationScope(scope: DelegationScopeParameters): boolean {
  return !!scope && typeof scope.actionKey === "string" && !!scope.actionKey
    && Number.isSafeInteger(scope.actionVersion) && scope.actionVersion > 0
    && typeof scope.targetType === "string" && !!scope.targetType
    && ((typeof scope.targetId === "string" && !!scope.targetId && scope.createWorkspaceId === undefined)
      || (typeof scope.createWorkspaceId === "string" && !!scope.createWorkspaceId && scope.targetId === undefined))
    && (scope.toolResourceId === undefined || (typeof scope.toolResourceId === "string" && !!scope.toolResourceId))
    && Object.values(DelegationScopeParametersResultExposureMode).includes(scope.resultExposureMode)
    && typeof scope.outputSchemaHash === "string" && /^[0-9a-f]{64}$/.test(scope.outputSchemaHash)
    && typeof scope.redactionPolicy === "string" && !!scope.redactionPolicy;
}

const memoryToolActions = ["agent.memory.entry.list", "agent.memory.entry.read"];

/**
 * One offered delegation target. Invocation scopes stay automation.run / agent.invoke; DD-122 (5)
 * tool scopes fix action, target and Tool as Core lists them, and Core revalidates each on grant.
 */
function validDelegationTarget(scope: DelegationScopeParameters, installation: AgentInstallationView): boolean {
  if (!validDelegationScope(scope) || scope.targetId === undefined || scope.createWorkspaceId !== undefined) return false;
  if (scope.toolResourceId === undefined) return scope.targetType === "RESOURCE"
    && (scope.actionKey === "automation.run" || (scope.actionKey === "agent.invoke" && scope.targetId === installation.resourceId));
  return (scope.targetType === "RESOURCE" || scope.targetType === "ASSET")
    && (!memoryToolActions.includes(scope.actionKey) || scope.targetId === installation.resourceId);
}

function validDelegation(row: AgentDelegationView): boolean {
  return !!row && typeof row.delegationId === "string" && !!row.delegationId
    && Number.isSafeInteger(row.delegationVersion) && row.delegationVersion > 0
    && typeof row.grantorPrincipalId === "string" && !!row.grantorPrincipalId
    && ["ACTIVE", "REVOKING", "REVOKED", "EXPIRED", "SUPERSEDED"].includes(row.state)
    && Object.hasOwn(delegationLabels, row.effectiveState)
    && (row.supersededByDelegationId === undefined ? String(row.state) !== "SUPERSEDED"
      : String(row.state) === "SUPERSEDED" && typeof row.supersededByDelegationId === "string" && !!row.supersededByDelegationId)
    && Number.isSafeInteger(row.uses) && row.uses >= 0
    && !!row.parameters && typeof row.parameters.validFrom === "string" && Number.isFinite(Date.parse(row.parameters.validFrom))
    && typeof row.parameters.expiresAt === "string" && Number.isFinite(Date.parse(row.parameters.expiresAt))
    && Date.parse(row.parameters.expiresAt) > Date.parse(row.parameters.validFrom)
    && (row.parameters.maxUses === undefined || (Number.isSafeInteger(row.parameters.maxUses) && row.parameters.maxUses > 0))
    && Array.isArray(row.parameters.scopes) && row.parameters.scopes.length > 0
    && row.parameters.scopes.every(validDelegationScope)
    && new Set(row.parameters.scopes.map(scopeKey)).size === row.parameters.scopes.length;
}

/** DD-126 (5): a renewal re-grants the same scope keys at the versions Core offers now. */
function renewalKey(scope: DelegationScopeParameters): string {
  return [scope.actionKey, scope.targetType, scope.targetId ?? "", scope.createWorkspaceId ?? "", scope.toolResourceId ?? ""].join("|");
}

/** Old scopes still offered (re-expressed as Core lists them now) and those no longer offered. */
function renewalScopes(row: AgentDelegationView, offered: readonly DelegationScopeParameters[]) {
  const current = new Map(offered.map((scope) => [renewalKey(scope), scope]));
  const scopes: DelegationScopeParameters[] = [];
  const dropped: DelegationScopeParameters[] = [];
  for (const scope of row.parameters.scopes) {
    const next = current.get(renewalKey(scope));
    if (next) scopes.push({ ...next });
    else dropped.push(scope);
  }
  return { scopes, dropped };
}

/** Only the grantor renews; a revoked or already replaced grant is granted anew instead. */
function renewable(row: AgentDelegationView, principal: string | undefined): boolean {
  return !!principal && row.grantorPrincipalId === principal
    && ["ACTIVE", "EXPIRED"].includes(row.state) && row.supersededByDelegationId === undefined;
}

function InstallationDelegation({ installation, locked, onLocked, onReset, onRecorded }: {
  installation: AgentInstallationView | null; locked: boolean; onLocked: (locked: boolean) => void;
  onReset: () => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const currentPrincipalId = useCurrentPrincipalId();
  const [renewing, setRenewing] = useState<AgentDelegationView | null>(null);
  const [grantOffsets, setGrantOffsets] = useState([0]);
  const [targetOffsets, setTargetOffsets] = useState([0]);
  const [grantIndex, setGrantIndex] = useState(0);
  const [targetIndex, setTargetIndex] = useState(0);
  const [selected, setSelected] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [intent, setIntent] = useState<{ command: ActionCommand; installation: AgentInstallationView; revokedGrant?: AgentDelegationView } | null>(null);
  const command = intent?.command;
  const reviewGrant = command?.delegationGrant ?? intent?.revokedGrant?.parameters;
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const resourceId = installation?.resourceId;
  const grantOffset = grantOffsets[grantIndex] ?? 0;
  const targetOffset = targetOffsets[targetIndex] ?? 0;
  const [grants, reloadGrants] = useLoad(`agent-delegations:${resourceId}:${grantOffset}`,
    () => resourceId ? client.agentDelegations(resourceId, grantOffset) : Promise.resolve(null));
  const page = grants.status === "ok" && grants.data && installation
    && grants.data.installationResourceId === installation.resourceId && grants.data.workspaceId === installation.workspaceId
    && grants.data.resourceVersion === installation.resourceVersion
    && typeof grants.data.canGrant === "boolean" && typeof grants.data.canRevoke === "boolean"
    && Array.isArray(grants.data.grants) && grants.data.grants.every(validDelegation)
    && new Set(grants.data.grants.map((row) => row.delegationId)).size === grants.data.grants.length
    && (grants.data.nextOffset === undefined || (Number.isSafeInteger(grants.data.nextOffset) && grants.data.nextOffset > grantOffset))
    ? grants.data : null;
  const [targets, reloadTargets] = useLoad(`agent-delegation-targets:${resourceId}:${targetOffset}`,
    () => resourceId ? client.agentDelegationTargets(resourceId, targetOffset) : Promise.resolve(null));
  const targetPage = targets.status === "ok" && targets.data && installation
    && targets.data.installationResourceId === installation.resourceId && targets.data.workspaceId === installation.workspaceId
    && targets.data.resourceVersion === installation.resourceVersion && Array.isArray(targets.data.scopes)
    && targets.data.scopes.every((scope) => validDelegationTarget(scope, installation))
    && new Set(targets.data.scopes.map(scopeKey)).size === targets.data.scopes.length
    && (targets.data.nextOffset === undefined || (Number.isSafeInteger(targets.data.nextOffset) && targets.data.nextOffset > targetOffset))
    ? targets.data : null;
  const scope = targetPage?.scopes.find((row) => scopeKey(row) === selected);
  // DD-126 (5): one in-period ACTIVE grant per grantor and scope key; Core rejects a parallel one.
  const overlapping = !!scope && !!page && page.grants.some((row) => row.grantorPrincipalId === currentPrincipalId
    && String(row.state) === "ACTIVE" && Date.parse(String(row.parameters.expiresAt)) > Date.now()
    && row.parameters.scopes.some((item) => renewalKey(item) === renewalKey(scope)));
  const renewal = renewing && targetPage ? renewalScopes(renewing, targetPage.scopes) : null;
  // Tool names only label scopes; the scope itself (and Core's recheck) stays the authority.
  const toolScoped = !!page?.grants.some((row) => row.parameters.scopes.some((item) => item.toolResourceId !== undefined))
    || !!targetPage?.scopes.some((row) => row.toolResourceId !== undefined);
  const [toolRead] = useLoad(`agent-delegation-tools:${resourceId}:${toolScoped}`,
    () => resourceId && toolScoped ? client.agentInstallationTools(resourceId) : Promise.resolve(null));
  const toolPage = toolRead.status === "ok" && toolRead.data && resourceId
    && validInstallationToolPage(toolRead.data, resourceId) ? toolRead.data : null;
  const toolNames = new Map<string, string>();
  for (const tool of toolPage?.tools ?? []) if (tool.toolResourceId && tool.name) toolNames.set(tool.toolResourceId, tool.name);
  const from = new Date(validFrom);
  const until = new Date(expiresAt);
  const uses = maxUses.trim() === "" ? undefined : Number(maxUses);
  const periodValid = Number.isFinite(from.getTime()) && Number.isFinite(until.getTime()) && until > from;
  const usesValid = uses === undefined || (Number.isSafeInteger(uses) && uses > 0);
  const [tasks, reloadTasks] = useLoad("delegation-actions-in-flight", client.tasks);
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => holdsTarget(task, resourceId)
    || (["agent.delegation.grant", "agent.delegation.revoke"].includes(task.actionKey)
      && task.targetId === resourceId && taskPhase(task).tone === "neutral")) ?? [];
  const requestBlocked = !taskRows || pending.length > 0;
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  useEffect(() => {
    setGrantOffsets([0]); setTargetOffsets([0]); setGrantIndex(0); setTargetIndex(0);
    setSelected(""); setValidFrom(""); setExpiresAt(""); setMaxUses(""); setRenewing(null);
    if (installation) { setSubmission(null); setFailure(null); }
  }, [installation]);
  const prepare = (revoke?: AgentDelegationView, renew?: AgentDelegationView) => {
    if (intent || locked || busy || requestBlocked || !installation || !page) return;
    const command: ActionCommand = { actionKey: revoke ? "agent.delegation.revoke" : "agent.delegation.grant",
      resourceId: installation.resourceId, resourceVersion: installation.resourceVersion,
      idempotencyKey: newIdempotencyKey(), explicitConfirmation: true };
    if (revoke) {
      if (!page.canRevoke || !page.grants.includes(revoke) || !["ACTIVE", "REVOKING"].includes(revoke.state)) return;
      command.delegationId = revoke.delegationId; command.delegationVersion = revoke.delegationVersion;
    } else if (renew) {
      const mapped = targetPage ? renewalScopes(renew, targetPage.scopes) : null;
      if (!page.canGrant || !page.grants.includes(renew) || !renewable(renew, currentPrincipalId)
        || !mapped?.scopes.length || !periodValid || !usesValid) return;
      command.delegationId = newIdempotencyKey();
      command.delegationGrant = { validFrom: from.toISOString(), expiresAt: until.toISOString(),
        ...(uses === undefined ? {} : { maxUses: uses }), scopes: mapped.scopes,
        renewsDelegationId: renew.delegationId, renewsDelegationVersion: renew.delegationVersion };
    } else {
      if (!page.canGrant || !scope || overlapping || !periodValid || !usesValid) return;
      command.delegationId = newIdempotencyKey();
      command.delegationGrant = { validFrom: from.toISOString(), expiresAt: until.toISOString(),
        ...(uses === undefined ? {} : { maxUses: uses }), scopes: [{ ...scope }] };
    }
    setIntent({ command, installation, ...(revoke ? { revokedGrant: revoke } : {}) }); setFailure(null); setSubmission(null); onLocked(true);
  };
  const submit = async () => {
    if (!command || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    if (!unknown) setFailure(null);
    try {
      const result = await client.submitAction(command);
      if (!result || result.actionKey !== command.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setFailure(null); setSubmission(result);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); setRenewing(null); onLocked(false); onReset(); onRecorded(); reloadGrants(); reloadTargets();
      }
    } catch (error) {
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };
  if (!installation && !intent && !submission && !failure) return null;
  const periodFields = <>
    <p className="text-xs text-muted-foreground">{t("agents.delegation.localTime")}</p>
    <label className="flex flex-col gap-1 text-sm">{t("agents.delegation.validFrom")}<input disabled={locked} required type="datetime-local" step="1" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" /></label>
    <label className="flex flex-col gap-1 text-sm">{t("agents.delegation.expiresAt")}<input disabled={locked} required type="datetime-local" step="1" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" /></label>
    <label className="flex flex-col gap-1 text-sm">{t("agents.delegation.maxUses")}<input disabled={locked} type="number" min="1" step="1" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2" /><span className="text-xs text-muted-foreground">{t("agents.delegation.noUseLimit")}</span></label>
    {validFrom && expiresAt && !periodValid ? <Notice role="alert">{t("agents.delegation.invalidPeriod")}</Notice> : null}
  </>;
  return <section className="flex flex-col gap-3 rounded-md border p-3" data-testid="agent-delegation-management">
    <h3 className="text-sm font-medium">{t("agents.delegation.title")}</h3>
    {intent && command ? <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-words">{command.actionKey} · {command.resourceId} · {command.resourceVersion}</p>
      <p className="break-words">{t("platform.workspace")}: {intent.installation.workspaceId}</p>
      <p className="break-words">{t("agents.installation.principal")}: {intent.installation.agentPrincipalId}</p>
      <p className="break-words">{t("agents.installation.version")}: {intent.installation.pinnedVersionAssetId}</p>
      <p>{t("agents.installation.activeGeneration")}: {intent.installation.activeProjectionGeneration ?? t("agents.installation.notRecorded")}</p>
      <p className="break-words">{t("agents.automation.grant")}: {command.delegationId} · {command.delegationVersion ?? "—"}</p>
      {reviewGrant ? <>
        <p>{t("agents.delegation.validFrom")}: {String(reviewGrant.validFrom)}</p>
        <p>{t("agents.delegation.expiresAt")}: {String(reviewGrant.expiresAt)}</p>
        <p>{t("agents.delegation.maxUses")}: {reviewGrant.maxUses ?? t("agents.delegation.noUseLimit")}</p>
        {reviewGrant.scopes.map((row) => <DelegationScope key={scopeKey(row)} scope={row} toolNames={toolNames} />)}
        {command.delegationGrant?.renewsDelegationId ? <p className="break-words">{t("agents.delegation.renewReplaces",
          { delegation: command.delegationGrant.renewsDelegationId, version: command.delegationGrant.renewsDelegationVersion ?? "—" })}</p> : null}
      </> : null}
      <p className="text-muted-foreground">{t("agents.delegation.admission")}</p>
      <div className="flex gap-2"><Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}</div>
    </div> : installation ? <>
      <p className="break-words text-sm">{t("agents.installation.id")}: {installation.resourceId} · {t("platform.workspace")}: {installation.workspaceId}</p>
      {grants.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !page ? <AgentReadFailure error={grants.status === "error" ? grants.error : undefined} onRetry={reloadGrants} />
        : <>
          {page.grants.length === 0 ? <Notice>{t("agents.delegation.none")}</Notice>
            : page.grants.map((row) => <section className="flex flex-col gap-2 border-t pt-2 text-sm" key={row.delegationId}>
              <p className="break-words">{row.delegationId} · {row.delegationVersion} · <Badge
                tone={row.effectiveState === DelegationEffectiveState.Active ? "positive"
                  : row.effectiveState === DelegationEffectiveState.NeedsRenewal ? "negative" : "neutral"}>
                {t(delegationLabels[row.effectiveState])}</Badge></p>
              {row.effectiveState === DelegationEffectiveState.NeedsRenewal ? <Notice>{t("agents.delegation.needsRenewal")}</Notice> : null}
              {row.supersededByDelegationId !== undefined
                ? <p className="break-words">{t("agents.delegation.supersededBy", { delegation: row.supersededByDelegationId })}</p> : null}
              <p className="break-words">{t("agents.delegation.grantor")}: {row.grantorPrincipalId}</p>
              <p>{t("agents.delegation.validFrom")}: {String(row.parameters.validFrom)} · {t("agents.delegation.expiresAt")}: {String(row.parameters.expiresAt)}</p>
              <p>{t("agents.delegation.uses")}: {row.uses} · {t("agents.delegation.maxUses")}: {row.parameters.maxUses ?? t("agents.delegation.noUseLimit")}</p>
              {row.parameters.scopes.map((item) => <DelegationScope key={scopeKey(item)} scope={item} toolNames={toolNames} />)}
              <div className="flex gap-2">
                {page.canGrant && renewable(row, currentPrincipalId) ? <Button className="w-fit" disabled={locked || requestBlocked}
                  onClick={() => { setRenewing(row); setSelected(""); }}>{t("agents.delegation.renew")}</Button> : null}
                {page.canRevoke && ["ACTIVE", "REVOKING"].includes(row.state) ? <Button className="w-fit" disabled={locked || requestBlocked} onClick={() => prepare(row)}>{t("agents.delegation.revoke")}</Button> : null}
              </div>
            </section>)}
          <div className="flex gap-2">
            {grantIndex > 0 ? <Button disabled={locked} onClick={() => setGrantIndex(grantIndex - 1)}>{t("roles.previous")}</Button> : null}
            {page.nextOffset !== undefined ? <Button disabled={locked} onClick={() => { setGrantOffsets((old) => [...old.slice(0, grantIndex + 1), page.nextOffset!]); setGrantIndex(grantIndex + 1); }}>{t("roles.next")}</Button> : null}
          </div>
        </>}
      {page?.canGrant ? targets.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !targetPage ? <AgentReadFailure error={targets.status === "error" ? targets.error : undefined} onRetry={reloadTargets} />
        : <>
          {renewing && renewal ? <form className="flex flex-col gap-3" data-testid="agent-delegation-renewal"
            onSubmit={(event) => { event.preventDefault(); prepare(undefined, renewing); }}>
            <p className="text-sm font-medium">{t("agents.delegation.renewTitle")}</p>
            <p className="break-words text-sm">{t("agents.delegation.renewReplaces", { delegation: renewing.delegationId, version: renewing.delegationVersion })}</p>
            {renewal.scopes.map((row) => <DelegationScope key={scopeKey(row)} scope={row} toolNames={toolNames} />)}
            {renewal.dropped.length ? <div className="flex flex-col gap-1 text-sm text-muted-foreground" data-testid="agent-delegation-renewal-dropped">
              <p>{t("agents.delegation.renewDropped")}</p>
              {renewal.dropped.map((row) => <DelegationScope key={scopeKey(row)} scope={row} toolNames={toolNames} />)}
            </div> : null}
            {renewal.scopes.length === 0 ? <Notice role="alert">{t("agents.delegation.renewUnavailable")}</Notice> : null}
            {periodFields}
            <div className="flex gap-2">
              <Button className="w-fit" disabled={locked || requestBlocked || !renewal.scopes.length || !periodValid || !usesValid} type="submit">{t("agents.review")}</Button>
              <Button className="w-fit" disabled={locked} onClick={() => setRenewing(null)}>{t("agents.cancel")}</Button>
            </div>
          </form> : targetPage.scopes.length === 0 ? <Notice>{t("agents.delegation.noTarget")}</Notice> : <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
            <label className="flex flex-col gap-1 text-sm">{t("agents.delegation.target")}
              <select disabled={locked} required value={selected} onChange={(event) => setSelected(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
                <option value="">{t("agents.automation.select")}</option>{targetPage.scopes.map((row) => <option key={scopeKey(row)} value={scopeKey(row)}>
                  {row.toolResourceId !== undefined ? `${toolNames.get(row.toolResourceId) ?? row.toolResourceId} · ` : ""}{row.actionKey} · {row.targetId} · {row.actionVersion}</option>)}
              </select>
            </label>
            {overlapping ? <Notice role="alert">{t("agents.delegation.overlap")}</Notice> : null}
            {periodFields}
            <Button className="w-fit" disabled={locked || requestBlocked || !scope || overlapping || !periodValid || !usesValid} type="submit">{t("agents.review")}</Button>
          </form>}
          <div className="flex gap-2">
            {targetIndex > 0 ? <Button disabled={locked} onClick={() => { setSelected(""); setTargetIndex(targetIndex - 1); }}>{t("roles.previous")}</Button> : null}
            {targetPage.nextOffset !== undefined ? <Button disabled={locked} onClick={() => { setSelected(""); setTargetOffsets((old) => [...old.slice(0, targetIndex + 1), targetPage.nextOffset!]); setTargetIndex(targetIndex + 1); }}>{t("roles.next")}</Button> : null}
          </div>
        </> : null}
      <div className="flex gap-2"><Button disabled={locked} onClick={() => { reloadGrants(); reloadTargets(); }}>{t("platform.refresh")}</Button><Button disabled={locked} onClick={onReset}>{t("platform.back")}</Button></div>
    </> : null}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : t("agents.rejected", { reason: failureText(failure) })}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length ? <div role="status" className="flex flex-col gap-1 text-sm" data-testid="agent-delegation-pending">{pending.map((task) => <p className="break-words" key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.actionKey} · {task.operationId}</p>)}<Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
  </section>;
}

/** DD-126 (4): shown from Core's effective projection; only ACTIVE is a usable grant. */
const delegationLabels: Record<AgentDelegationView["effectiveState"], PlatformMessageKey> = {
  ACTIVE: "agents.delegation.state.active", NEEDS_RENEWAL: "agents.delegation.state.needsRenewal",
  NOT_YET_VALID: "agents.delegation.state.notYetValid", EXPIRED: "agents.delegation.state.expired",
  USES_EXHAUSTED: "agents.delegation.state.usesExhausted", REVOKING: "agents.delegation.state.revoking",
  REVOKED: "agents.delegation.state.revoked", SUPERSEDED: "agents.delegation.state.superseded",
};

function DelegationScope({ scope, toolNames }: { scope: DelegationScopeParameters; toolNames: ReadonlyMap<string, string> }) {
  const t = useT();
  return <div className="flex flex-col gap-1 break-words text-sm" data-testid="agent-delegation-scope">
    <p>{scope.actionKey} · {scope.actionVersion} · {scope.targetType} · {scope.targetId ?? scope.createWorkspaceId}</p>
    {scope.toolResourceId !== undefined ? <p>{t("agents.delegation.tool")}: {toolNames.get(scope.toolResourceId) ?? scope.toolResourceId}
      {toolNames.has(scope.toolResourceId) ? <span className="break-all font-mono text-xs"> · {scope.toolResourceId}</span> : null}</p> : null}
    <p>{scope.resultExposureMode} · {scope.redactionPolicy}</p>
    <p className="break-all font-mono text-xs">{scope.outputSchemaHash}</p>
  </div>;
}

function InstallationList({ workspaceId, locked, onPermission, onManage, onUpgrade, onRegrant, onLocked, avatarHost }: {
  workspaceId: string; locked: boolean; onPermission: (row: AgentInstallationView) => void; onManage: (row: AgentInstallationView) => void; onUpgrade: (row: AgentInstallationView) => void;
  onRegrant: (row: AgentInstallationView) => void;
  onLocked: (locked: boolean) => void;
  avatarHost?: AgentAvatarHost;
}) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const offset = offsets[pageIndex] ?? 0;
  const [state, reload] = useLoad(`agent-installations:${workspaceId}:${offset}`, () => client.agentInstallations(workspaceId, offset));
  const value = state.status === "ok" ? state.data : null;
  const page = value && Array.isArray(value.installations) && value.installations.every((row) => validInstallation(row) && row.workspaceId === workspaceId)
    && new Set(value.installations.map((row) => row.resourceId)).size === value.installations.length
    && (value.nextOffset === undefined || (Number.isSafeInteger(value.nextOffset) && value.nextOffset > offset)) ? value : null;
  const next = page?.nextOffset;
  const changePage = (index: number) => { setSelected(null); setPageIndex(index); };
  return <div className="flex flex-col gap-3">
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={() => { setSelected(null); reload(); }} />
      : <>
        {page.installations.length === 0 ? <Notice>{t("agents.installation.none")}</Notice>
          : <div className={IDENTITY_CARD_GRID_CLASS}>
            {page.installations.map((row) => <InstallationIdentityCard key={row.resourceId} row={row} avatarHost={avatarHost}
              locked={locked} onOpen={() => setSelected(row.resourceId)} />)}
          </div>}
        <div className="flex gap-2">
          {pageIndex > 0 ? <Button disabled={locked} onClick={() => changePage(pageIndex - 1)}>{t("roles.previous")}</Button> : null}
          {next !== undefined ? <Button disabled={locked} onClick={() => { setOffsets((old) => [...old.slice(0, pageIndex + 1), next]); changePage(pageIndex + 1); }}>{t("roles.next")}</Button> : null}
        </div>
        <AgentManagementDialog open={selected !== null} title={t("agents.installation.open")}
          locked={locked} onClose={() => setSelected(null)}>
          {selected ? <InstallationDetail key={selected} resourceId={selected} workspaceId={workspaceId} locked={locked} onLocked={onLocked}
            onPermission={(row) => { setSelected(null); onPermission(row); }}
            onManage={(row) => { setSelected(null); onManage(row); }}
            onUpgrade={(row) => { setSelected(null); onUpgrade(row); }}
            onRegrant={(row) => { setSelected(null); onRegrant(row); }} /> : null}
        </AgentManagementDialog>
      </>}
  </div>;
}

function InstallationIdentityCard({ row, locked, onOpen, avatarHost }: {
  row: AgentInstallationView; locked: boolean; onOpen: () => void;
  avatarHost?: AgentAvatarHost;
}) {
  const client = useBffClient();
  const t = useT();
  // A visible installation does not confer Version-read permission. Read the
  // exact pinned version; never borrow the latest definition or another scope.
  const [state, reload] = useLoad(`installation-card:${row.resourceId}:${row.pinnedVersionAssetId}`,
    () => client.agentVersion(row.pinnedVersionAssetId));
  const candidate = state.status === "ok" ? state.data : null;
  const version = candidate && validVersion(candidate, row.agentResourceId)
    && candidate.assetId === row.pinnedVersionAssetId ? candidate : null;
  const host = avatarHost && version ? avatarHost(version) : null;
  const card = <AgentIdentityCard dataTestId={`agent-installation-${row.resourceId}`}
      // 成员可读安装却未必可读 Version：用安装视图随附的固定版本显示名，不借最新定义。
      label={version?.content.personaIdentity.displayName ?? (row.agentDisplayName?.trim() || t("agents.installation.id"))}
      subtitle={version ? effectiveAgentDescription(version.content.personaIdentity) : null}
      avatarUrl={host ? version?.content.personaIdentity.avatarUrl : undefined}
      ariaLabel={t("agents.installation.open")} disabled={locked} onClick={onOpen}
      statusBadge={<Badge tone="neutral">{t(installationLabels[row.state])}</Badge>} />;
  return <div className="flex min-w-0 flex-col gap-2">
    {state.status === "pending" ? <IdentityCardSkeleton /> : host ? <AvatarHostProvider value={host}>{card}</AvatarHostProvider> : card}
    {state.status !== "pending" && !version ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} /> : null}
  </div>;
}

function InstallationDetail({ resourceId, workspaceId, locked, onPermission, onManage, onUpgrade, onRegrant, onLocked, autoManage = false }: {
  resourceId: string; workspaceId: string; locked: boolean; onPermission: (row: AgentInstallationView) => void; onManage: (row: AgentInstallationView) => void; onUpgrade: (row: AgentInstallationView) => void;
  /** DD-122 (4): same-version upgrade from the Tools section. */
  onRegrant: (row: AgentInstallationView) => void;
  onLocked: (locked: boolean) => void;
  autoManage?: boolean;
}) {
  const client = useBffClient();
  const t = useT();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [state, reload] = useLoad(`agent-installation:${workspaceId}:${resourceId}`, () => client.agentInstallation(resourceId));
  const row = state.status === "ok" && validInstallation(state.data) && state.data.resourceId === resourceId
    && state.data.workspaceId === workspaceId ? state.data : null;
  const manageable = row !== null && row.state === AgentInstallationState.Active && row.resourceState === ResourceState.Active;
  const autoManaged = useRef(false);
  useEffect(() => {
    // Same condition as the "View delegation grants" button below; at most once per mount.
    if (!autoManage || autoManaged.current || locked || !manageable || !row) return;
    autoManaged.current = true;
    onManage(row);
  }, [autoManage, locked, manageable, row, onManage]);
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  if (!row) return <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />;
  return <section className="flex flex-col gap-2 border-t pt-3" data-testid="agent-installation-detail">
    <p className="text-sm text-muted-foreground">{t("agents.installation.management")}</p>
    <h3 className="text-sm font-medium">{t("agents.installation.id")}: <span className="break-all font-mono">{row.resourceId}</span></h3>
    <Badge tone="neutral">{t(installationLabels[row.state])}</Badge>
    <p className="text-sm">{t(resourceLabels[row.resourceState])} · {t("agents.resourceVersion")}: {row.resourceVersion}</p>
    <p className="break-all text-sm">{t("agents.owner")}: {row.ownerPrincipalId}</p>
    <p className="break-all text-sm">{t("platform.workspace")}: {row.workspaceId}</p>
    <p className="break-all text-sm">{t("agents.installation.definition")}: {row.agentResourceId}</p>
    <p className="break-all text-sm">{t("agents.installation.version")}: {row.pinnedVersionAssetId}</p>
    <p className="break-all text-sm">{t("agents.installation.principal")}: {row.agentPrincipalId} · {t(principalLabels[row.agentPrincipalState])}</p>
    <h4 className="text-sm font-medium">{t("agents.installation.channel")}</h4>
    {row.channelBinding ? <>
      <p className="text-sm">{t(channelLabels[row.channelBinding.status])}</p>
      <p className="break-all text-sm">{row.channelBinding.channelId ?? t("agents.installation.notRecorded")}</p>
      <p className="text-sm">{t("agents.installation.triggers")}: {row.channelBinding.triggers.map((trigger) => t(triggerLabels[trigger])).join(" · ")}</p>
    </> : <p role="status" className="text-sm">{t("agents.installation.notRecorded")}</p>}
    <h4 className="text-sm font-medium">{t("agents.installation.projection")}</h4>
    <p className="text-sm">{t("agents.installation.activeGeneration")}: {row.activeProjectionGeneration ?? t("agents.installation.notRecorded")}</p>
    {row.projection ? <>
      <p className="text-sm">{t(projectionLabels[row.projection.state])} · {t("agents.installation.generation")}: {row.projection.generation}</p>
      <p className="break-words text-sm">{t("agents.version.runtimeProfile")}: {row.projection.runtimeProfileKey}</p>
      <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {row.projection.configHash}</p>
    </> : <p role="status" className="text-sm">{t("agents.installation.notRecorded")}</p>}
    {/* DD-125(6): original Stop / Start agent / Restart agent and "Manage agent access...". */}
    <AgentLifecycleSection installation={row} name={row.agentDisplayName?.trim() ?? ""} locked={locked} onRecorded={reload} />
    {toolsOpen ? <InstallationTools installation={row} locked={locked} onRegrant={onRegrant} />
      : <Button className="w-fit" disabled={locked} aria-expanded={false} onClick={() => setToolsOpen(true)}>{t("agents.installation.tools.open")}</Button>}
    {skillsOpen ? <InstallationSkills installationId={row.resourceId} locked={locked} />
      : <Button className="w-fit" disabled={locked} aria-expanded={false} onClick={() => setSkillsOpen(true)}>{t("skills.installation.open")}</Button>}
    {row.state === AgentInstallationState.Active && row.resourceState === ResourceState.Active
      ? <Button className="w-fit" disabled={locked} onClick={() => onManage(row)}>{t("agents.delegation.open")}</Button> : null}
    <Button className="w-fit" disabled={locked} onClick={reload}>{t("platform.refresh")}</Button>
    {row.canUpgrade === true && row.state === AgentInstallationState.Active ? <Button className="w-fit" disabled={locked} onClick={() => onUpgrade(row)}>{t("agents.upgradeVersion")}</Button> : null}
    {row.state === AgentInstallationState.Active || row.state === AgentInstallationState.Draining ? <Button className="w-fit" disabled={locked} onClick={() => onPermission(row)}>{t("agents.execute.open")}</Button> : null}
    {row.state === AgentInstallationState.Active && row.resourceState === ResourceState.Active
      ? <AgentInstallationUse installationId={resourceId} locked={locked} /> : null}
    {row.state === AgentInstallationState.Active ? <InstallationMemory resourceId={resourceId} workspaceId={workspaceId} installation={row} onLocked={onLocked} /> : null}
    <InstallationSessions key={`${workspaceId}:${resourceId}`} installation={row} />
  </section>;
}

const toolStatusLabels = {
  [AgentToolBindingStatus.Active]: "agents.installation.tools.status.active",
  [AgentToolBindingStatus.NoPermission]: "agents.installation.tools.status.noPermission",
  [AgentToolBindingStatus.Pending]: "agents.installation.tools.status.pending",
  [AgentToolBindingStatus.Revoked]: "agents.installation.tools.status.revoked",
} as const satisfies Record<AgentToolBindingStatus, PlatformMessageKey>;
const toolSourceLabels = {
  [AgentInstallationToolSource.PlatformNative]: "agents.installation.tools.source.platform",
  [AgentInstallationToolSource.Application]: "agents.installation.tools.source.application",
  [AgentInstallationToolSource.UserRegisteredExternal]: "agents.installation.tools.source.connector",
} as const satisfies Record<AgentInstallationToolSource, PlatformMessageKey>;

type InstallationTool = AgentInstallationToolPage["tools"][number];

function toolKey(tool: InstallationTool): string {
  return JSON.stringify([tool.source, tool.toolResourceId, tool.capabilityRequirement, tool.applicationBindingId, tool.name]);
}

/** DD-122: the read-only tool view of exactly this Installation's current generation. */
export function validInstallationToolPage(page: AgentInstallationToolPage, installationResourceId: string): boolean {
  const text = (value: unknown) => value === undefined || (typeof value === "string" && !!value);
  return !!page && page.installationResourceId === installationResourceId
    && Number.isSafeInteger(page.generation) && page.generation > 0
    && Array.isArray(page.tools) && page.tools.every((tool) => !!tool
      && Object.values(AgentInstallationToolSource).includes(tool.source)
      && Object.values(AgentToolBindingStatus).includes(tool.bindingStatus)
      && (tool.reasonCode === undefined || Object.values(ReasonCode).includes(tool.reasonCode))
      && [tool.toolResourceId, tool.name, tool.capabilityRequirement, tool.applicationBindingId].every(text)
      // Native tools have no capability requirement or provider binding.
      && (tool.source === AgentInstallationToolSource.Application
        || (tool.capabilityRequirement === undefined && tool.applicationBindingId === undefined)))
    && new Set(page.tools.map(toolKey)).size === page.tools.length;
}

/** A tool the Agent does not hold yet; a same-version upgrade may grant it (DD-122 (3)(4)). */
function toolNeedsGrant(tool: InstallationTool): boolean {
  return tool.bindingStatus === AgentToolBindingStatus.NoPermission || tool.bindingStatus === AgentToolBindingStatus.Pending;
}

function InstallationTools({ installation, locked, onRegrant }: {
  installation: AgentInstallationView; locked: boolean; onRegrant: (row: AgentInstallationView) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const [state, reload] = useLoad(`agent-installation-tools:${installation.workspaceId}:${installation.resourceId}`,
    () => client.agentInstallationTools(installation.resourceId));
  const page = state.status === "ok" && validInstallationToolPage(state.data, installation.resourceId) ? state.data : null;
  const needsGrant = page?.tools.some(toolNeedsGrant) ?? false;
  const canRegrant = needsGrant && installation.canUpgrade === true
    && installation.state === AgentInstallationState.Active && installation.resourceState === ResourceState.Active;
  const detail = (tool: InstallationTool): string | null => {
    if (tool.bindingStatus === AgentToolBindingStatus.NoPermission)
      return tool.reasonCode === undefined || tool.reasonCode === ReasonCode.PermissionDenied
        ? t("agents.installation.tools.noPermissionHint") : reasonText(tool.reasonCode);
    if (tool.bindingStatus === AgentToolBindingStatus.Pending)
      return tool.reasonCode === undefined ? t("agents.installation.tools.pendingHint") : reasonText(tool.reasonCode);
    return tool.reasonCode === undefined ? null : reasonText(tool.reasonCode);
  };
  return <section className="flex flex-col gap-2 rounded-md border p-3" data-testid="agent-installation-tools">
    <h4 className="text-sm font-medium">{t("agents.installation.tools.title")}</h4>
    <p className="text-sm text-muted-foreground">{t("agents.installation.tools.boundary")}</p>
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <p className="text-sm">{t("agents.installation.generation")}: {page.generation}</p>
        {page.tools.length === 0 ? <Notice>{t("agents.installation.tools.none")}</Notice> : <div className="overflow-x-auto">
          <Table head={[t("agents.installation.tools.name"), t("agents.installation.tools.source"), t("agents.installation.tools.requirement"),
            t("agents.installation.tools.provider"), t("agents.installation.tools.status")]}>
            {page.tools.map((tool) => {
              const note = detail(tool);
              return <tr key={toolKey(tool)} data-testid="agent-installation-tool" data-status={tool.bindingStatus}>
                <Cell><span className="break-words">{tool.name ?? tool.capabilityRequirement ?? tool.toolResourceId ?? "—"}</span>
                  {tool.toolResourceId ? <p className="break-all font-mono text-xs">{tool.toolResourceId}</p> : null}</Cell>
                <Cell>{t(toolSourceLabels[tool.source])}</Cell>
                <Cell>{tool.capabilityRequirement ?? "—"}</Cell>
                <Cell>{tool.source === AgentInstallationToolSource.PlatformNative ? t("agents.installation.tools.platformProvider")
                  : tool.source === AgentInstallationToolSource.UserRegisteredExternal ? t("agents.installation.tools.connectorProvider")
                  : tool.applicationBindingId ? <span className="break-all font-mono text-xs">{tool.applicationBindingId}</span>
                  : t("agents.installation.tools.noProvider")}</Cell>
                <Cell><Badge tone={tool.bindingStatus === AgentToolBindingStatus.Active ? "positive" : "neutral"}>{t(toolStatusLabels[tool.bindingStatus])}</Badge>
                  {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}</Cell>
              </tr>;
            })}
          </Table>
        </div>}
        {canRegrant ? <>
          <p className="text-sm text-muted-foreground">{t("agents.installation.tools.regrantHint")}</p>
          <Button className="w-fit" disabled={locked} onClick={() => onRegrant(installation)}>{t("agents.installation.tools.regrant")}</Button>
        </> : needsGrant ? <p className="text-sm text-muted-foreground">{t("agents.installation.tools.regrantUnavailable")}</p> : null}
      </>}
    <Button className="w-fit" disabled={locked} onClick={reload}>{t("platform.refresh")}</Button>
  </section>;
}

function InstallationPermission({ kind, installation, locked, onLocked, onRecorded }: {
  kind: "execute" | "read"; installation: AgentInstallationView; locked: boolean; onLocked: (value: boolean) => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const labels = kind === "read" ? "agents.read" : "agents.execute";
  const actions = kind === "read"
    ? { grant: "resource.grant_read", revoke: "resource.revoke_read" }
    : { grant: "agent.installation.execute.grant", revoke: "agent.installation.execute.revoke" };
  const [read, reloadPermission] = useLoad(`installation-${kind}-read:${installation.resourceId}:${installation.workspaceId}`,
    () => client.agentInstallation(installation.resourceId));
  const row = read.status === "ok" && validInstallation(read.data) && read.data.resourceId === installation.resourceId
    && read.data.workspaceId === installation.workspaceId ? read.data : null;
  const permission = kind === "read" ? row?.readPermission : row?.executionPermission;
  const [intent, setIntent] = useState<{ command: ActionCommand; client: typeof client; agent: string; workspace: string } | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [receiptClient, setReceiptClient] = useState<typeof client | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const current = useRef({ client, id: installation.resourceId, workspace: installation.workspaceId });
  current.current = { client, id: installation.resourceId, workspace: installation.workspaceId };
  const sameScope = intent?.client === client && intent.command.resourceId === installation.resourceId
    && intent.workspace === installation.workspaceId;
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  const [tasks, reloadTasks] = useLoad(`installation-${kind}:${installation.resourceId}`, client.tasks);
  const rows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = rows?.some((row) => holdsTarget(row, installation.resourceId)
    || (row.targetId === installation.resourceId && [actions.grant, actions.revoke].includes(row.actionKey)
      && taskPhase(row).tone === "neutral")) ?? true;
  const prepare = (grant: boolean) => {
    if (locked || intent || busy || !permission || !rows || !row
      || !(grant ? permission.canGrant && !pending : permission.canRevoke)) return;
    const command: ActionCommand = { actionKey: grant ? actions.grant : actions.revoke,
      resourceId: row.resourceId, resourceVersion: row.resourceVersion, idempotencyKey: newIdempotencyKey(),
      ...(kind === "read" ? { principalId: row.agentPrincipalId } : {}),
      ...(grant ? {} : { explicitConfirmation: true }) };
    setIntent({ command, client, agent: row.agentPrincipalId, workspace: row.workspaceId });
    setSubmission(null); setFailure(null); onLocked(true);
  };
  const submit = async () => {
    if (!intent || !sameScope || inFlight.current) return;
    const captured = intent;
    const active = () => current.current.client === captured.client && current.current.id === captured.command.resourceId
      && current.current.workspace === captured.workspace;
    inFlight.current = true; setBusy(true);
    try {
      const result = await captured.client.submitAction(captured.command);
      if (!active()) return;
      if (!result || result.actionKey !== captured.command.actionKey || !result.actionExecutionId || !result.operationId
        || typeof result.actionExecutionId !== "string" || typeof result.operationId !== "string"
        || !Object.values(ActionGateState).includes(result.gateState) || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (submission && (submission.operationId !== result.operationId || submission.actionExecutionId !== result.actionExecutionId))) {
        throw new TransportError(t("platform.loadFailed"));
      }
      setSubmission(result); setReceiptClient(client); setFailure(null);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); onRecorded(); reloadPermission();
      }
    } catch (error) {
      if (active() && !unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally {
      inFlight.current = false;
      if (active()) { setBusy(false); reloadTasks(); }
    }
  };
  return <section className="flex flex-col gap-2 rounded-md border p-3" data-testid={`agent-installation-${kind}`}>
    <h4 className="text-sm font-medium">{t(`${labels}.title`)}</h4>
    <p className="text-sm text-muted-foreground">{t(`${labels}.boundary`)}</p>
    {permission ? <p role="status" className="text-sm">{permission.effective ? t(`${labels}.effective`) : t(`${labels}.notEffective`)}
      {permission.pendingActionExecutionId ? ` · ${permission.pendingActionExecutionId}` : ""}</p> : <Notice>{t(`${labels}.unverified`)}</Notice>}
    {intent ? <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-all">{intent.command.actionKey} · {intent.command.resourceId} · {intent.command.resourceVersion}</p>
      <p className="break-all">{t("agents.installation.principal")}: {intent.agent}</p>
      <p className="break-all">{t("platform.workspace")}: {intent.workspace}</p>
      <p>{intent.command.actionKey === actions.grant ? t(`${labels}.approval`) : t(`${labels}.revokeWarning`)}</p>
      <div className="flex gap-2"><Button disabled={busy || !sameScope} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}</div>
    </div> : <div className="flex gap-2">
      {permission?.canGrant ? <Button disabled={locked || !rows || pending} onClick={() => prepare(true)}>{t(`${labels}.grant`)}</Button> : null}
      {permission?.canRevoke ? <Button disabled={locked || !rows} onClick={() => prepare(false)}>{t(`${labels}.revoke`)}</Button> : null}
    </div>}
    {submission && receiptClient === client ? <p role="status" className="break-all text-sm">{t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}
      {submission.reason ? ` · ${reasonText(submission.reason)}` : ""} {submission.approvalWorkflowId ?? ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : failureText(failure)}</p> : null}
    <Button className="w-fit" onClick={() => { reloadTasks(); reloadPermission(); onRecorded(); }}>{t("platform.refresh")}</Button>
  </section>;
}

function DefinitionDetail({ resourceId, locked, onEdit, onVersionEdit, onExport }: {
  resourceId: string; locked: boolean; onEdit: (target: AgentDefinitionView, owner: boolean) => void;
  onVersionEdit: (edit: VersionEdit) => void;
  /** DD-131(2)：导出当前已发布版本（agent.definition.export，owner 批准）。 */
  onExport?: (target: SnapshotExportTarget) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`agent-definition:${resourceId}`, () => client.agentDefinition(resourceId));
  if (state.status === "pending") return <Notice role="status">{t("platform.loading")}</Notice>;
  const row = state.status === "ok" && validDefinition(state.data) && state.data.resourceId === resourceId ? state.data : null;
  if (!row) return <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />;
  return (
    <section className="flex flex-col gap-3" data-testid="agent-definition-detail">
      <h2 className="font-medium">{row.displayName}</h2>
      <p className="break-words text-sm">{t("agents.slug")}: {row.stableSlug}</p>
      <p className="break-words text-sm">{t("agents.owner")}: {row.ownerPrincipalId}</p>
      <p className="text-sm">{t("agents.resourceVersion")}: {row.resourceVersion}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={reload}>{t("platform.refresh")}</Button>
        <Button disabled={locked} onClick={() => onEdit(row, false)}>{t("agents.update")}</Button>
        <Button disabled={locked} onClick={() => onEdit(row, true)}>{t("agents.transfer")}</Button>
        {onExport ? <Button disabled={locked || !row.currentPublishedVersionAssetId} data-testid="agent-definition-export"
          title={row.currentPublishedVersionAssetId ? undefined : t("agents.export.needsPublished")}
          onClick={() => row.currentPublishedVersionAssetId && onExport({ resourceId: row.resourceId, resourceVersion: row.resourceVersion,
            displayName: row.displayName, versionAssetId: row.currentPublishedVersionAssetId })}>{t("agents.export.export")}</Button> : null}
      </div>
      {row.currentPublishedVersionAssetId ? <PublishedVersion resourceId={resourceId} assetId={row.currentPublishedVersionAssetId} />
        : <p className="text-sm text-muted-foreground">{t("agents.noPublishedVersion")}</p>}
      <VersionDirectory definition={row} locked={locked} onEdit={onVersionEdit} />
    </section>
  );
}

function PublishedVersion({ resourceId, assetId }: { resourceId: string; assetId: string }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad(`agent-version:${assetId}`, () => client.agentVersion(assetId));
  const value = state.status === "ok" ? state.data : null;
  const version = value && value.assetId === assetId && value.agentResourceId === resourceId
    && value.state === AgentVersionState.Published
    && Number.isSafeInteger(value.ordinal) && value.ordinal > 0
    && Number.isSafeInteger(value.assetVersion) && value.assetVersion > 0
    && typeof value.configHash === "string" && !!value.configHash
    && typeof value.ownerPrincipalId === "string" && !!value.ownerPrincipalId
    && value.content && typeof value.content.instructions === "string"
    && typeof value.content.runtimeProfileKey === "string" && typeof value.content.modelRouteResourceId === "string"
    ? value : null;
  return <section className="flex flex-col gap-2 border-t pt-3">
    <h3 className="text-sm font-medium">{t("agents.publishedVersion")}</h3>
    {state.status === "pending" ? <p role="status">{t("platform.loading")}</p>
      : !version ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        <Badge tone="neutral">{t("agents.version.published")}</Badge>
        <p className="text-sm">{t("agents.version.ordinal")}: {version.ordinal}</p>
        <p className="break-words text-sm">{t("agents.owner")}: {version.ownerPrincipalId}</p>
        <p className="break-words text-sm">{t("agents.version.runtimeProfile")}: {version.content.runtimeProfileKey}</p>
        <p className="break-words text-sm">{t("agents.version.modelRoute")}: {version.content.modelRouteResourceId}</p>
        <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {version.configHash}</p>
        <h4 className="text-sm font-medium">{t("agents.version.instructions")}</h4>
        <pre className="whitespace-pre-wrap break-words text-sm">{version.content.instructions}</pre>
      </>}
  </section>;
}

const versionLabels = {
  [AgentVersionState.Draft]: "agents.version.draft",
  [AgentVersionState.Published]: "agents.version.published",
  [AgentVersionState.Retired]: "agents.version.retired",
} as const satisfies Record<AgentVersionState, PlatformMessageKey>;

function validVersion(row: AgentVersionView, resourceId: string): boolean {
  const content = row?.content;
  return !!row && row.agentResourceId === resourceId
    && [row.assetId, row.ownerPrincipalId].every((id) => typeof id === "string" && !!id)
    && Number.isSafeInteger(row.assetVersion) && row.assetVersion > 0
    && Number.isSafeInteger(row.ordinal) && row.ordinal > 0
    && Object.values(AgentVersionState).includes(row.state)
    && typeof row.configHash === "string" && /^[a-f0-9]{64}$/.test(row.configHash)
    && (row.canUpdate === undefined || typeof row.canUpdate === "boolean")
    && (row.canPublish === undefined || typeof row.canPublish === "boolean")
    && (row.canRetire === undefined || typeof row.canRetire === "boolean")
    && (row.state === AgentVersionState.Draft || (!row.canUpdate && !row.canPublish))
    && (row.state === AgentVersionState.Published || !row.canRetire)
    && !!content && typeof content.instructions === "string"
    && !!content.personaIdentity && typeof content.personaIdentity.displayName === "string" && !!content.personaIdentity.displayName.trim()
    && [content.personaIdentity.description, content.personaIdentity.avatarUrl].every((value) => value === undefined || typeof value === "string")
    // DD-131(2): only a DRAFT may lack runtime, route, reply policy or instructions; published content is complete.
    && [content.runtimeProfileKey, content.modelRouteResourceId, content.replyPolicy].every((value) => value === undefined || (typeof value === "string" && !!value.trim()))
    && (row.state === AgentVersionState.Draft || versionMissing(content).length === 0)
    && [content.skillVersionAssetIds, content.declaredToolResourceIds, content.capabilityRequirements].every((values) => Array.isArray(values)
      && values.every((value) => typeof value === "string" && !!value.trim()) && new Set(values).size === values.length)
    && content.capabilityRequirements.every((key) => /^[^@]+@[^@\s]+$/.test(key))
    && Array.isArray(content.triggerDefaults) && content.triggerDefaults.every((trigger) => Object.values(AgentTrigger).includes(trigger))
    && new Set(content.triggerDefaults).size === content.triggerDefaults.length
    && Number.isSafeInteger(content.parallelism) && content.parallelism > 0
    && !!content.turnLimits && Number.isSafeInteger(content.turnLimits.idleTimeoutSeconds) && content.turnLimits.idleTimeoutSeconds > 0
    && Number.isSafeInteger(content.turnLimits.maxTurnDurationSeconds) && content.turnLimits.maxTurnDurationSeconds >= content.turnLimits.idleTimeoutSeconds
    && !!content.memoryPolicy && Object.values(AgentMemoryCoreWrite).includes(content.memoryPolicy.coreWrite)
    && Object.values(AgentMemoryColdWrite).includes(content.memoryPolicy.coldWrite);
}

/** What a DRAFT still needs before `agent.version.publish` admits it (DD-131(2)); empty when complete. */
export function versionMissing(content: AgentVersionView["content"]): ("instructions" | "runtime")[] {
  const missing: ("instructions" | "runtime")[] = [];
  if (!content.instructions.trim()) missing.push("instructions");
  if (![content.runtimeProfileKey, content.modelRouteResourceId, content.replyPolicy].every((value) => typeof value === "string" && !!value.trim())) missing.push("runtime");
  return missing;
}

const missingLabels = {
  instructions: "agents.version.instructionsRequired",
  runtime: "agents.version.runtimeRequired",
} as const satisfies Record<ReturnType<typeof versionMissing>[number], PlatformMessageKey>;

function validVersionConfiguration(page: AgentVersionConfigurationPage, definition: AgentDefinitionView, offset: number): boolean {
  return !!page && page.agentResourceId === definition.resourceId && page.resourceVersion === definition.resourceVersion
    && typeof page.canCreate === "boolean" && Array.isArray(page.profiles) && Array.isArray(page.routes)
    && page.profiles.every((profile) => profile && typeof profile.key === "string" && !!profile.key.trim()
      && profile.kind === RuntimeProfileKind.ServerCodex && profile.status === "ACTIVE" && profile.webAvailability === "ENABLED"
      && !!profile.capabilityContract && Number.isSafeInteger(profile.capabilityContract.maxParallelism) && profile.capabilityContract.maxParallelism > 0
      && Number.isSafeInteger(profile.capabilityContract.maxIdleTimeoutSeconds) && profile.capabilityContract.maxIdleTimeoutSeconds > 0
      && Number.isSafeInteger(profile.capabilityContract.maxTurnDurationSeconds)
      && profile.capabilityContract.maxTurnDurationSeconds >= profile.capabilityContract.maxIdleTimeoutSeconds
      && Array.isArray(profile.capabilityContract.replyPolicies) && profile.capabilityContract.replyPolicies.length > 0
      && profile.capabilityContract.replyPolicies.every((key) => typeof key === "string" && !!key.trim())
      && new Set(profile.capabilityContract.replyPolicies).size === profile.capabilityContract.replyPolicies.length
      && Array.isArray(profile.capabilityContract.capabilityRequirements)
      && profile.capabilityContract.capabilityRequirements.every((key) => typeof key === "string" && /^[^@]+@[^@\s]+$/.test(key))
      && new Set(profile.capabilityContract.capabilityRequirements).size === profile.capabilityContract.capabilityRequirements.length)
    && page.routes.every((route) => route && [route.resourceId, route.ownerPrincipalId].every((id) => typeof id === "string" && !!id)
      && Number.isSafeInteger(route.resourceVersion) && route.resourceVersion > 0
      && (route.homeWorkspaceId === undefined || (typeof route.homeWorkspaceId === "string" && !!route.homeWorkspaceId))
      && route.nativeConfigResourceId === route.resourceId && Number.isSafeInteger(route.nativeRevision) && route.nativeRevision > 0
      && typeof route.nativeConfigHash === "string" && /^[a-f0-9]{64}$/.test(route.nativeConfigHash))
    && new Set(page.profiles.map((profile) => profile.key)).size === page.profiles.length
    && new Set(page.routes.map((route) => route.resourceId)).size === page.routes.length
    && ((page.profiles.length === 0) === (page.routes.length === 0))
    && (!page.canCreate || page.routes.length > 0)
    && (page.nextOffset == null || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > offset));
}

type VersionEdit = { definition: AgentDefinitionView; version?: AgentVersionView; mode: "edit" | "publish" | "retire"; configurationOffsets: number[] };

function VersionDirectory({ definition, locked, onEdit }: {
  definition: AgentDefinitionView; locked: boolean; onEdit: (edit: VersionEdit) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const offset = offsets[index] ?? 0;
  const [state, reload] = useLoad(`agent-versions:${definition.resourceId}:${offset}`, () => client.agentVersions(definition.resourceId, offset));
  const [sourceOffsets, setSourceOffsets] = useState([0]);
  const [sourceIndex, setSourceIndex] = useState(0);
  const sourceOffset = sourceOffsets[sourceIndex] ?? 0;
  const [configuration, reloadConfiguration] = useLoad(`version-sources:${definition.resourceId}:${sourceOffset}`, () => client.agentVersionConfiguration(definition.resourceId, sourceOffset));
  const data = state.status === "ok" ? state.data : null;
  const page = data && data.agentResourceId === definition.resourceId && data.resourceVersion === definition.resourceVersion
    && Array.isArray(data.versions) && data.versions.every((version) => validVersion(version, definition.resourceId))
    && new Set(data.versions.map((version) => version.assetId)).size === data.versions.length
    && new Set(data.versions.map((version) => version.ordinal)).size === data.versions.length
    && (data.nextOffset == null || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset)) ? data : null;
  const source = configuration.status === "ok" && validVersionConfiguration(configuration.data, definition, sourceOffset) ? configuration.data : null;
  const configurationOffsets = sourceOffsets.slice(0, sourceIndex + 1);
  return <section className="flex flex-col gap-3 border-t pt-3" data-testid="agent-version-directory">
    <h3 className="font-medium">{t("agents.version.history")}</h3>
    <p className="text-sm text-muted-foreground">{t("agents.version.boundary")}</p>
    <div className="flex flex-wrap gap-2"><Button disabled={locked} onClick={() => { reload(); reloadConfiguration(); }}>{t("platform.refresh")}</Button>
      {page && source?.canCreate ? <Button disabled={locked} onClick={() => onEdit({ definition, mode: "edit", configurationOffsets })}>{t("agents.version.create")}</Button> : null}</div>
    {configuration.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !source ? <AgentReadFailure error={configuration.status === "error" ? configuration.error : undefined} onRetry={reloadConfiguration} />
      : !source.canCreate ? <p className="text-sm text-muted-foreground">{t("agents.version.createUnavailable")}</p> : null}
    {source ? <div className="flex flex-wrap gap-2 text-sm"><span>{t("agents.version.configurationPages")}</span>
      {sourceIndex > 0 ? <Button disabled={locked} onClick={() => setSourceIndex(sourceIndex - 1)}>{t("roles.previous")}</Button> : null}
      {source.nextOffset != null ? <Button disabled={locked} onClick={() => { setSourceOffsets((values) => [...values.slice(0, sourceIndex + 1), source.nextOffset!]); setSourceIndex(sourceIndex + 1); }}>{t("roles.next")}</Button> : null}</div> : null}
    {state.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !page ? <AgentReadFailure error={state.status === "error" ? state.error : undefined} onRetry={reload} />
      : <>
        {page.versions.length === 0 ? <Notice>{t("agents.version.none")}</Notice>
          : page.versions.map((version) => <section key={version.assetId} className="flex flex-col gap-2 border-t pt-3">
            <h4 className="text-sm font-medium">{version.content.personaIdentity.displayName} · {version.ordinal} · <Badge tone="neutral">{t(versionLabels[version.state])}</Badge></h4>
            <p className="break-words text-sm">{version.assetId} · {t("agents.version.assetVersion")}: {version.assetVersion}</p>
            <p className="break-words text-sm">{t("agents.owner")}: {version.ownerPrincipalId}</p>
            <p className="break-words text-sm">{t("agents.version.runtimeProfile")}: {version.content.runtimeProfileKey ?? "—"} · {t("agents.version.modelRoute")}: {version.content.modelRouteResourceId ?? "—"}</p>
            <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {version.configHash}</p>
            <p className="break-words text-sm">{t("agents.version.skillReferences")}: {version.content.skillVersionAssetIds.join(", ") || "—"}</p>
            <p className="break-words text-sm">{t("agents.tools.selected")}: {version.content.declaredToolResourceIds.join(", ") || "—"}</p>
            <p className="break-words text-sm">{t("agents.version.capabilities")}: {version.content.capabilityRequirements.join(", ") || "—"}</p>
            <details><summary className="cursor-pointer text-sm">{t("agents.version.instructions")}</summary>
              <pre className="whitespace-pre-wrap break-words text-sm">{version.content.instructions}</pre></details>
            {version.state === AgentVersionState.Draft ? versionMissing(version.content).map((item) =>
              <p key={item} className="w-fit rounded-md bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning-text" data-testid={`agent-version-missing-${item}`}>{t(missingLabels[item])}</p>) : null}
            {version.state === AgentVersionState.Draft && source && source.routes.length > 0 ? <div className="flex flex-wrap gap-2">
              {version.canUpdate === true ? <Button disabled={locked} onClick={() => onEdit({ definition, version, mode: "edit", configurationOffsets })}>{t("agents.version.edit")}</Button> : null}
              {version.canPublish === true ? <Button disabled={locked || versionMissing(version.content).length > 0}
                onClick={() => onEdit({ definition, version, mode: "publish", configurationOffsets })}>{t("agents.version.publish")}</Button> : null}
            </div> : null}
            {version.state === AgentVersionState.Published && version.canRetire === true ? <Button className="w-fit" disabled={locked}
              onClick={() => onEdit({ definition, version, mode: "retire", configurationOffsets })}>{t("agents.version.retire")}</Button> : null}
          </section>)}
        <div className="flex gap-2">{index > 0 ? <Button disabled={locked} onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
          {page.nextOffset != null ? <Button disabled={locked} onClick={() => { setOffsets((values) => [...values.slice(0, index + 1), page.nextOffset!]); setIndex(index + 1); }}>{t("roles.next")}</Button> : null}</div>
      </>}
  </section>;
}

function VersionAction({ edit, avatarHost, onReset, onLocked, onRecorded }: {
  edit: VersionEdit | null; onReset: () => void; onLocked: (locked: boolean) => void; onRecorded: () => void;
  avatarHost?: AgentAvatarHost;
}) {
  const formId = useId();
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const inFlight = useRef(false);
  const [profileKey, setProfileKey] = useState("");
  const [routeId, setRouteId] = useState("");
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [reply, setReply] = useState("");
  const [parallelism, setParallelism] = useState("");
  const [idle, setIdle] = useState("");
  const [duration, setDuration] = useState("");
  const [coreWrite, setCoreWrite] = useState("");
  const [coldWrite, setColdWrite] = useState("");
  const [triggers, setTriggers] = useState<AgentTrigger[]>([]);
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [toolIds, setToolIds] = useState<string[]>([]);
  const [toolOffsets, setToolOffsets] = useState([0]);
  const [toolIndex, setToolIndex] = useState(0);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [skillOffsets, setSkillOffsets] = useState([0]);
  const [skillIndex, setSkillIndex] = useState(0);
  const [offsets, setOffsets] = useState([0]);
  const [index, setIndex] = useState(0);
  const [intent, setIntent] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  useEffect(() => {
    const content = edit?.version?.content;
    setName(content?.personaIdentity.displayName ?? ""); setAvatar(content?.personaIdentity.avatarUrl ?? "");
    setDescription(content?.personaIdentity.description ?? ""); setInstructions(content?.instructions ?? "");
    setProfileKey(content?.runtimeProfileKey ?? ""); setRouteId(content?.modelRouteResourceId ?? ""); setReply(content?.replyPolicy ?? "");
    setParallelism(content ? String(content.parallelism) : ""); setIdle(content ? String(content.turnLimits.idleTimeoutSeconds) : "");
    setDuration(content ? String(content.turnLimits.maxTurnDurationSeconds) : "");
    setCoreWrite(content?.memoryPolicy.coreWrite ?? ""); setColdWrite(content?.memoryPolicy.coldWrite ?? "");
    setTriggers(content?.triggerDefaults ?? []); setCapabilities(content?.capabilityRequirements ?? []);
    setToolIds(content?.declaredToolResourceIds ?? []); setToolOffsets([0]); setToolIndex(0);
    setSkillIds(content?.skillVersionAssetIds ?? []); setSkillOffsets([0]); setSkillIndex(0);
    setOffsets(edit?.configurationOffsets ?? [0]); setIndex((edit?.configurationOffsets.length ?? 1) - 1);
  }, [edit]);
  const offset = offsets[index] ?? 0;
  const [configuration, reloadConfiguration] = useLoad(`version-action-sources:${edit?.definition.resourceId ?? "none"}:${edit?.mode ?? "none"}:${offset}`,
    () => edit && edit.mode !== "retire" ? client.agentVersionConfiguration(edit.definition.resourceId, offset) : Promise.resolve(null));
  const [tasks, reloadTasks] = useLoad("agent-version-actions-in-flight", client.tasks);
  // Re-read visited directory pages as one snapshot. An unavailable page never
  // becomes an empty set, and pagination never discards a selected reference.
  const [tools, reloadTools] = useLoad(`version-tools:${edit?.definition.resourceId ?? "none"}:${edit?.version?.assetId ?? "new"}:${edit?.mode ?? "none"}:${toolOffsets.join(",")}`,
    () => edit && edit.mode !== "retire" ? Promise.all(toolOffsets.map((value) => client.platformTools(value))) : Promise.resolve([]));
  const toolPages: PlatformToolPage[] | null = tools.status === "ok" && tools.data.length === toolOffsets.length
    && tools.data.every((page, pageIndex) => validPlatformToolPage(page, toolOffsets[pageIndex]!)
      && (pageIndex === 0 || tools.data[pageIndex - 1]?.nextOffset === toolOffsets[pageIndex]))
    && new Set(tools.data.flatMap((page) => page.tools.map((tool) => tool.resourceId))).size
      === tools.data.reduce((total, page) => total + page.tools.length, 0) ? tools.data : null;
  const toolPage = toolPages?.[toolIndex];
  // DD-135(4)：同一快照内的可读已发布 Skill 版本；不可用不当作空集，翻页不丢已选引用。
  const [skillsLoaded, reloadSkills] = useLoad(`version-skills:${edit?.definition.resourceId ?? "none"}:${edit?.version?.assetId ?? "new"}:${edit?.mode ?? "none"}:${skillOffsets.join(",")}`,
    () => edit && edit.mode !== "retire" ? Promise.all(skillOffsets.map((value) => client.skillReferences(value))) : Promise.resolve([]));
  const skillPages = skillsLoaded.status === "ok" && skillsLoaded.data.length === skillOffsets.length
    && skillsLoaded.data.every((page, pageIndex) => !!page && Array.isArray(page.versions)
      && page.versions.every((version) => validSkillVersion(version) && version.state === AgentVersionState.Published)
      && (page.nextOffset === undefined || (Number.isSafeInteger(page.nextOffset) && page.nextOffset > (skillOffsets[pageIndex] ?? 0)))
      && (pageIndex === 0 || skillsLoaded.data[pageIndex - 1]?.nextOffset === skillOffsets[pageIndex])) ? skillsLoaded.data : null;
  const skillPage = skillPages?.[skillIndex];
  const availableSkills = skillPages?.flatMap((page) => page.versions) ?? [];
  const selectedSkills = skillIds.map((id) => availableSkills.find((version) => version.assetId === id));
  const missingSkillCapabilities = [...new Set(selectedSkills.flatMap((version) => version?.capabilityRequirements ?? []))]
    .filter((key) => !capabilities.includes(key));
  const skillsValid = skillIds.length <= 16 && new Set(skillIds).size === skillIds.length
    && (skillIds.length === 0 || (!!skillPages && selectedSkills.every((version) => version !== undefined)))
    && new Set(selectedSkills.map((version) => version?.skillResourceId)).size === skillIds.length
    && missingSkillCapabilities.length === 0;
  const availableTools = toolPages?.flatMap((page) => page.tools).filter(selectableTool) ?? [];
  const source = edit && configuration.status === "ok" && configuration.data
    && validVersionConfiguration(configuration.data, edit.definition, offset) ? configuration.data : null;
  const profile = source?.profiles.find((value) => value.key === profileKey);
  const route = source?.routes.find((value) => value.resourceId === routeId);
  const contract = profile?.capabilityContract;
  const corePolicy = Object.values(AgentMemoryCoreWrite).find((value) => value === coreWrite);
  const coldPolicy = Object.values(AgentMemoryColdWrite).find((value) => value === coldWrite);
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask) ? tasks.data : null;
  const pending = taskRows?.filter((task) => ["agent.version.create", "agent.version.update", "agent.version.publish", "agent.version.retire"].includes(task.actionKey)
    && taskPhase(task).tone === "neutral") ?? [];
  // 未知创建目标是 Definition，编辑/发布目标是 Asset；任何未查证版本请求阻止新意图。
  const requestBlocked = !taskRows || pending.length > 0;
  const retiring = edit?.mode === "retire";
  const publishing = edit?.mode === "publish";
  const actionKey = retiring ? "agent.version.retire" : publishing ? "agent.version.publish" : edit?.version ? "agent.version.update" : "agent.version.create";
  const title: PlatformMessageKey = retiring ? "agents.version.retire" : publishing ? "agents.version.publish" : edit?.version ? "agents.version.edit" : "agents.version.create";
  const permitted = retiring ? edit?.version?.state === AgentVersionState.Published && edit.version.canRetire === true
    : !!edit && !!source && source.routes.length > 0
      && (edit.version ? edit.version.state === AgentVersionState.Draft && (publishing ? edit.version.canPublish === true : edit.version.canUpdate === true) : source.canCreate);
  const supported = skillsValid
    && (toolIds.length === 0 || (!!toolPages && toolIds.every((id) => availableTools.some((tool) => tool.resourceId === id))));
  const integer = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  const advancedValid = supported && !!contract
    && contract.replyPolicies.includes(reply) && capabilities.every((key) => contract.capabilityRequirements.includes(key))
    && integer(parallelism) && Number(parallelism) <= contract.maxParallelism
    && integer(idle) && Number(idle) <= contract.maxIdleTimeoutSeconds
    && integer(duration) && Number(duration) <= contract.maxTurnDurationSeconds && Number(idle) <= Number(duration)
    && corePolicy !== undefined && coldPolicy !== undefined;
  const valid = retiring ? permitted : !avatarUploading && permitted && !!profile && !!route && !!name.trim() && !!instructions.trim() && advancedValid;
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);
  const prepare = () => {
    if (!edit || intent || busy || requestBlocked || !valid || corePolicy === undefined || coldPolicy === undefined) return;
    const command: ActionCommand = { actionKey, idempotencyKey: newIdempotencyKey(),
      resourceId: edit.definition.resourceId, resourceVersion: edit.definition.resourceVersion };
    if (edit.version) { command.assetId = edit.version.assetId; command.assetVersion = edit.version.assetVersion; }
    if (edit.mode !== "edit") command.explicitConfirmation = true;
    else command.agentVersionContent = {
      personaIdentity: { displayName: name, ...(avatar ? { avatarUrl: avatar } : {}), ...(description ? { description } : {}) },
      instructions, runtimeProfileKey: profileKey, modelRouteResourceId: routeId, replyPolicy: reply,
      parallelism: Number(parallelism), turnLimits: { idleTimeoutSeconds: Number(idle), maxTurnDurationSeconds: Number(duration) },
      memoryPolicy: { coreWrite: corePolicy, coldWrite: coldPolicy },
      capabilityRequirements: [...capabilities], triggerDefaults: [...triggers], skillVersionAssetIds: [...skillIds], declaredToolResourceIds: [...toolIds],
    };
    setIntent(command); setSubmission(null); setFailure(null); onLocked(true);
  };
  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    if (!unknown) setFailure(null);
    try {
      const result = await client.submitAction(intent);
      if (!result || result.actionKey !== intent.actionKey || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason)) throw new TransportError(t("platform.loadFailed"));
      setFailure(null); setSubmission(result);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); onReset(); onRecorded();
      }
    } catch (error) {
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };
  useEffect(() => {
    if (avatarUploading) onLocked(true);
    else if (!intent && !busy) onLocked(false);
  }, [avatarUploading, intent, busy, onLocked]);
  if (!edit && !intent && !submission && !failure) return null;
  return <AgentManagementDialog open title={t(edit || intent ? title : "agents.version.history")}
    dataTestId="agent-version-action" locked={busy || intent !== null || avatarUploading}
    onClose={() => { setSubmission(null); setFailure(null); onReset(); }}
    footer={intent ? <div className="flex w-full flex-wrap justify-end gap-2">
      {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}
      <Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
    </div> : edit && (retiring || source) ? <div className="flex w-full flex-wrap justify-end gap-2">
      <Button disabled={avatarUploading} onClick={onReset}>{t("agents.cancel")}</Button>
      {retiring ? <Button disabled={requestBlocked || !valid} onClick={prepare}>{t("agents.review")}</Button>
        : <Button type="submit" form={formId} disabled={requestBlocked || !valid}>{t("agents.review")}</Button>}
    </div> : undefined}>
  <section className="flex flex-col gap-3">
    {edit ? <p className="break-words text-sm">{edit.definition.displayName} · {edit.definition.resourceId} · {t("agents.resourceVersion")}: {edit.definition.resourceVersion}</p> : null}
    <p className="text-sm text-muted-foreground">{t("agents.version.boundary")}</p>
    {intent ? <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-words">{intent.actionKey} · {intent.assetId ?? intent.resourceId} · {intent.assetVersion ?? intent.resourceVersion}</p>
      <p>{t("agents.owner")}: {edit?.version?.ownerPrincipalId ?? t("agents.version.currentHumanOwner")}</p>
      <p className="break-words">{t("agents.name")}: {name}</p>
      {avatar ? <p className="break-words">{t("agents.version.avatar")}: {avatar}</p> : null}
      {description ? <p className="whitespace-pre-wrap break-words">{t("agents.version.description")}: {description}</p> : null}
      <p className="break-words">{t("agents.version.runtimeProfile")}: {profileKey} · {t("agents.version.modelRoute")}: {routeId}</p>
      {edit?.version ? <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {edit.version.configHash}</p> : null}
      <p>{t("agents.version.replyPolicy")}: {reply} · {t("agents.version.parallelism")}: {parallelism}</p>
      <p>{t("agents.version.idleTimeout")}: {idle} · {t("agents.version.maxDuration")}: {duration}</p>
      <p>{t("agents.version.coreWrite")}: {coreWrite === AgentMemoryCoreWrite.HumanOnly ? t("agents.version.coreHumanOnly") : t("agents.version.coreApproval")}</p>
      <p>{t("agents.version.coldWrite")}: {coldWrite === AgentMemoryColdWrite.Disabled ? t("agents.version.coldDisabled") : t("agents.version.coldInvocation")}</p>
      <p className="break-words">{t("agents.version.capabilities")}: {capabilities.join(", ") || "—"}</p>
      <p className="break-words">{t("agents.tools.selected")}: {toolIds.join(", ") || "—"}</p>
      <p className="break-words">{t("agents.version.skillReferences")}: {skillIds.map((id) => {
        const version = availableSkills.find((value) => value.assetId === id);
        return version ? `$${version.stableSlug} v${version.ordinal}` : id;
      }).join(", ") || "—"}</p>
      <p>{t("agents.version.triggers")}: {triggers.map((trigger) => t(trigger === AgentTrigger.Mention ? "agents.installation.trigger.mention" : "agents.version.manualAssignment")).join(", ") || "—"}</p>
      <pre className="whitespace-pre-wrap break-words">{instructions}</pre>
      <p>{t(retiring ? "agents.version.retireReview" : publishing ? "agents.version.publishReview" : "agents.version.saveReview")}</p><p>{t("agents.admission")}</p>
    </div> : retiring ? <>
      <p className="break-words text-sm">{edit?.version?.assetId} · {t("agents.version.assetVersion")}: {edit?.version?.assetVersion}</p>
      <p className="break-words text-sm">{t("agents.owner")}: {edit?.version?.ownerPrincipalId}</p>
      <p className="break-all font-mono text-xs">{t("agents.version.hash")}: {edit?.version?.configHash}</p>
      <p className="text-sm">{t("agents.version.retireReview")}</p>
    </> : edit ? <>
      {configuration.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
        : !source ? <AgentReadFailure error={configuration.status === "error" ? configuration.error : undefined} onRetry={reloadConfiguration} />
        : <form id={formId} className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
          {avatarHost ? <AvatarHostProvider value={avatarHost(edit.version)}><AgentCreationPreview avatarUrl={avatar || null} label={name.trim() || t("agents.identity.name")}
            assetLabel={t("platform.profile.avatar")} disabled={publishing || !permitted || avatarUploading}
            onSelectAvatar={setAvatar} onClearAvatar={() => setAvatar("")} onUploadPendingChange={setAvatarUploading} />
          </AvatarHostProvider> : null}
          <div className="space-y-5">
          {!permitted || !supported ? <Notice>{t("agents.version.createUnavailable")}</Notice> : null}
          <fieldset disabled={publishing || !permitted} className="flex flex-col gap-3">
            <AgentIdentityFields displayName={name} onDisplayNameChange={setName} description={description}
              onDescriptionChange={setDescription} disabled={publishing || !permitted} />
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor={`${formId}-instructions`}>{t("agents.identity.instructions")}</label>
              <div className={PERSONA_FIELD_SHELL_CLASS}>
                <AgentTextarea required id={`${formId}-instructions`} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder={t("agents.identity.instructionsPlaceholder")} className={`min-h-40 resize-y px-3 py-3 leading-5 ${PERSONA_FIELD_CONTROL_CLASS}`} />
              </div>
              {!instructions.trim() ? <p className="text-xs text-warning-text" role="status">{t("agents.version.instructionsRequired")}</p> : null}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor={`${formId}-runtime`}>{t("agents.version.runtimeProfile")}</label>
              <PersonaDropdownField id={`${formId}-runtime`} value={profileKey} onValueChange={(value) => { setProfileKey(value); setReply(""); setCapabilities([]); }} placeholder={t("agents.automation.select")}
                options={source.profiles.map((value) => ({ value: value.key, label: value.key }))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor={`${formId}-route`}>{t("agents.version.modelRoute")}</label>
              <PersonaDropdownField id={`${formId}-route`} value={routeId} onValueChange={setRouteId} placeholder={t("agents.automation.select")}
                options={source.routes.map((value) => ({ value: value.resourceId, label: `${value.resourceId} · ${value.resourceVersion} · ${value.nativeRevision}` }))} />
            </div>
          </fieldset>
            <AgentDefinitionAdvanced key={`${edit.definition.resourceId}:${edit.version?.assetId ?? "new"}:${edit.mode}`}
              required={!advancedValid}>
            <fieldset disabled={publishing || !permitted} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor={`${formId}-reply`}>{t("agents.version.replyPolicy")}</label>
              <PersonaDropdownField id={`${formId}-reply`} value={reply} onValueChange={setReply} placeholder={t("agents.automation.select")}
                options={(contract?.replyPolicies ?? []).map((value) => ({ value, label: value }))} />
            </div>
            <AgentParallelismField id={`${formId}-parallelism`} value={parallelism} max={contract?.maxParallelism} onChange={setParallelism} />
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.idleTimeout")}<input required type="number" min={1} step={1} max={contract?.maxIdleTimeoutSeconds} value={idle} onChange={(event) => setIdle(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2" /></label>
            <label className="flex flex-col gap-1 text-sm">{t("agents.version.maxDuration")}<input required type="number" min={1} step={1} max={contract?.maxTurnDurationSeconds} value={duration} onChange={(event) => setDuration(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2" /></label>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor={`${formId}-core-memory`}>{t("agents.version.coreWrite")}</label>
              <PersonaDropdownField id={`${formId}-core-memory`} value={coreWrite} onValueChange={setCoreWrite} placeholder={t("agents.automation.select")}
                options={[{ value: AgentMemoryCoreWrite.HumanOnly, label: t("agents.version.coreHumanOnly") }, { value: AgentMemoryCoreWrite.AgentWithApproval, label: t("agents.version.coreApproval") }]} />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor={`${formId}-cold-memory`}>{t("agents.version.coldWrite")}</label>
              <PersonaDropdownField id={`${formId}-cold-memory`} value={coldWrite} onValueChange={setColdWrite} placeholder={t("agents.automation.select")}
                options={[{ value: AgentMemoryColdWrite.Disabled, label: t("agents.version.coldDisabled") }, { value: AgentMemoryColdWrite.InvocationScoped, label: t("agents.version.coldInvocation") }]} />
            </div>
            <fieldset className="flex flex-col gap-1 text-sm"><legend>{t("agents.version.triggers")}</legend>{Object.values(AgentTrigger).map((trigger) => <label className="flex gap-2" key={trigger}><input type="checkbox" checked={triggers.includes(trigger)} onChange={(event) => setTriggers((values) => event.target.checked ? [...values, trigger] : values.filter((value) => value !== trigger))} />{t(trigger === AgentTrigger.Mention ? "agents.installation.trigger.mention" : "agents.version.manualAssignment")}</label>)}</fieldset>
            <fieldset className="flex flex-col gap-1 text-sm"><legend>{t("agents.version.capabilities")}</legend>{contract?.capabilityRequirements.map((key) => <label className="flex gap-2" key={key}><input type="checkbox" checked={capabilities.includes(key)} onChange={(event) => setCapabilities((values) => event.target.checked ? [...values, key] : values.filter((value) => value !== key))} />{key}</label>)}</fieldset>
            <p className="text-sm text-muted-foreground">{t("agents.version.toolsUnavailable")}</p>
            <fieldset className="flex flex-col gap-2 text-sm" data-testid="agent-version-skills"><legend>{t("skills.version.select")}</legend>
              <p className="text-xs text-muted-foreground">{t("skills.version.selectHint")}</p>
              {skillIds.map((id) => {
                const version = availableSkills.find((value) => value.assetId === id);
                return <div key={id} className="flex flex-wrap items-center gap-2">
                  <span className="break-all">{version ? `$${version.stableSlug} · v${version.ordinal}` : <span className="font-mono text-xs">{id}</span>}</span>
                  {!version && skillPages ? <span>{t("skills.version.unavailable")}</span> : null}
                  <Button onClick={() => setSkillIds((values) => values.filter((value) => value !== id))}>{t("skills.version.remove")}</Button>
                </div>;
              })}
              {skillIds.length > 16 || new Set(selectedSkills.map((version) => version?.skillResourceId)).size !== skillIds.length
                ? <p role="alert">{t("skills.version.limit")}</p> : null}
              {missingSkillCapabilities.length > 0 ? <p role="alert" className="break-words">{t("skills.version.capabilityMissing")} {missingSkillCapabilities.join(", ")}</p> : null}
              <Button className="w-fit" onClick={reloadSkills}>{t("platform.refresh")}</Button>
              {skillsLoaded.status === "pending" ? <p role="status">{t("platform.loading")}</p>
                : !skillPage ? <p role="status">{t("platform.loadFailed")}</p>
                : <>
                  {skillPage.versions.length === 0 ? <p>{t("skills.version.none")}</p> : skillPage.versions.map((version) =>
                    <label className="flex gap-2" key={version.assetId}><input type="checkbox" checked={skillIds.includes(version.assetId)}
                      onChange={(event) => setSkillIds((values) => event.target.checked
                        ? [...values.filter((id) => availableSkills.find((value) => value.assetId === id)?.skillResourceId !== version.skillResourceId), version.assetId]
                        : values.filter((id) => id !== version.assetId))} />
                      <span className="break-words"><code>${version.stableSlug}</code> · v{version.ordinal} · {version.shortDescription ?? version.description}</span></label>)}
                  <div className="flex flex-wrap gap-2">
                    {skillIndex > 0 ? <Button onClick={() => setSkillIndex(skillIndex - 1)}>{t("roles.previous")}</Button> : null}
                    {skillPage.nextOffset != null ? <Button onClick={() => {
                      const next = skillPage.nextOffset!;
                      setSkillOffsets((values) => [...values.slice(0, skillIndex + 1), next]); setSkillIndex(skillIndex + 1);
                    }}>{t("roles.next")}</Button> : null}
                  </div>
                </>}
            </fieldset>
            <fieldset className="flex flex-col gap-2 text-sm"><legend>{t("agents.tools.selected")}</legend>
              {toolIds.map((id) => <div key={id} className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-xs">{id}</span>
                {!availableTools.some((tool) => tool.resourceId === id) ? <span>{t("agents.tools.unavailable")}</span> : null}
                <Button onClick={() => setToolIds((values) => values.filter((value) => value !== id))}>{t("agents.tools.remove")}</Button>
              </div>)}
              <Button className="w-fit" onClick={reloadTools}>{t("platform.refresh")}</Button>
              {tools.status === "pending" ? <p role="status">{t("platform.loading")}</p>
                : !toolPage ? <p role="status">{t("platform.loadFailed")}</p>
                : <>
                  {toolPage.tools.length === 0 ? <p>{t("agents.tools.none")}</p> : (() => {
                    // DD-149 (1)③: connector tools are grouped under their connector and marked external.
                    const toolOption = (tool: PlatformToolView) =>
                      <label className="flex gap-2" key={tool.resourceId}><input type="checkbox" disabled={!selectableTool(tool)}
                        checked={toolIds.includes(tool.resourceId)} onChange={(event) => setToolIds((values) => event.target.checked
                          ? [...new Set([...values, tool.resourceId])] : values.filter((id) => id !== tool.resourceId))} />
                        <span className="break-all">{tool.connector ? `${tool.connector.title ?? tool.connector.upstreamName} · ${tool.name}` : tool.name} · {tool.resourceId}</span></label>;
                    const grouped = groupTools(toolPage.tools);
                    return <>
                      {grouped.native.map(toolOption)}
                      {grouped.connectors.map((group) => <div key={group.connectionId} className="flex flex-col gap-1" data-testid="version-tools-connector">
                        <ConnectorGroupHeading group={group} />
                        {group.tools.map(toolOption)}
                      </div>)}
                    </>;
                  })()}
                  <div className="flex flex-wrap gap-2">
                    {toolIndex > 0 ? <Button onClick={() => setToolIndex(toolIndex - 1)}>{t("roles.previous")}</Button> : null}
                    {toolPage.nextOffset != null ? <Button onClick={() => {
                      const next = toolPage.nextOffset!;
                      setToolOffsets((values) => [...values.slice(0, toolIndex + 1), next]); setToolIndex(toolIndex + 1);
                    }}>{t("roles.next")}</Button> : null}
                  </div>
                </>}
            </fieldset>
            </fieldset>
            </AgentDefinitionAdvanced>
          <div className="flex gap-2">{index > 0 ? <Button onClick={() => setIndex(index - 1)}>{t("roles.previous")}</Button> : null}
            {source.nextOffset != null ? <Button onClick={() => { setOffsets((values) => [...values.slice(0, index + 1), source.nextOffset!]); setIndex(index + 1); }}>{t("roles.next")}</Button> : null}</div>
          </div>
        </form>}
    </> : null}
    {submission ? <p role="status" className="break-words text-sm">{unknown ? t("agents.unknown", { operation: submission.operationId }) : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}{submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown" ? t("agents.unknown", { operation: failure.operationId ?? submission?.operationId ?? "—" }) : t("agents.rejected", { reason: failureText(failure) })}</p> : null}
    {!taskRows ? <Notice role="status">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.refresh")}</Button></Notice>
      : pending.length > 0 ? <div role="status" className="flex flex-col gap-1 text-sm"><p>{t("agents.version.inFlight")}</p>{pending.map((task) => <p key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}<Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button></div> : null}
  </section></AgentManagementDialog>;
}

function DefinitionAction({ edit, externalBlocked = false, onReset, onLocked, onRecorded, open, onClose }: {
  edit: { target: AgentDefinitionView; owner: boolean } | null;
  externalBlocked?: boolean;
  open: boolean; onClose: () => void;
  onReset: () => void; onLocked: (locked: boolean) => void; onRecorded: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const inFlight = useRef(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [owner, setOwner] = useState("");
  const [intent, setIntent] = useState<{ command: ActionCommand; previousOwner?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  // 选择新的已读取目标时初始化表单；已提交的未知意图不会被列表刷新替换。
  useEffect(() => {
    setName(edit?.target.displayName ?? "");
    setOwner("");
    setSlug("");
  }, [edit]);
  const [tasks, reloadTasks] = useLoad("definition-actions-in-flight", client.tasks);
  const actionKey = !edit ? "agent.definition.create" : edit.owner ? "resource.transfer_owner" : "agent.definition.update";
  const title: PlatformMessageKey = !edit ? "agents.create" : edit.owner ? "agents.transfer" : "agents.update";
  const taskRows = tasks.status === "ok" && Array.isArray(tasks.data) && tasks.data.every(validDefinitionTask)
    ? tasks.data : null;
  const pending = taskRows ? taskRows.filter((task) =>
    ["agent.definition.create", "agent.definition.update", "resource.transfer_owner"].includes(task.actionKey)
      && taskPhase(task).tone === "neutral") : [];
  // 读取失败/未知状态不是「没有在途请求」；同资源的修改、转移必须先查证原请求。
  const requestBlocked = externalBlocked || !taskRows || pending.some((task) => edit
    ? task.targetId === edit.target.resourceId : task.actionKey === "agent.definition.create");
  const unknown = failure?.kind === "unknown" || submission?.dispatchState === ActionDispatchState.Unknown
    || submission?.gateState === ActionGateState.Evaluating
    || (submission?.gateState === ActionGateState.Allowed && submission.dispatchState === ActionDispatchState.NotDispatched);

  const prepare = () => {
    if (intent || busy || requestBlocked || (edit?.owner
      ? !owner.trim() || owner.trim() === edit.target.ownerPrincipalId
      : !name.trim() || (!edit && !slug.trim()))) return;
    const command: ActionCommand = { actionKey, idempotencyKey: newIdempotencyKey() };
    if (edit) { command.resourceId = edit.target.resourceId; command.resourceVersion = edit.target.resourceVersion; }
    if (edit?.owner) command.principalId = owner.trim();
    else { command.name = name.trim(); if (!edit) command.slug = slug.trim(); }
    setIntent({ command, previousOwner: edit?.target.ownerPrincipalId });
    setFailure(null); setSubmission(null); onLocked(true);
  };
  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    if (!unknown) { setFailure(null); setSubmission(null); }
    try {
      const result = await client.submitAction(intent.command);
      if (!result || result.actionKey !== intent.command.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState)
        || (result.reason !== undefined && !Object.values(ReasonCode).includes(result.reason))
        || (submission && (result.actionExecutionId !== submission.actionExecutionId || result.operationId !== submission.operationId))
        || (result.gateState === ActionGateState.Waiting && !result.approvalWorkflowId)
        || (result.gateState === ActionGateState.Denied && !result.reason))
        throw new TransportError(t("platform.loadFailed"));
      setFailure(null); setSubmission(result);
      if (result.dispatchState !== ActionDispatchState.Unknown && result.gateState !== ActionGateState.Evaluating
        && !(result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.NotDispatched)) {
        setIntent(null); onLocked(false); onReset(); setName(""); setSlug(""); setOwner(""); onRecorded();
      }
    } catch (error) {
      if (!unknown) {
        const failed = writeFailure(error); setFailure(failed);
        if (failed.kind !== "unknown") { setIntent(null); onLocked(false); }
      }
    } finally { inFlight.current = false; setBusy(false); reloadTasks(); }
  };

  return <AgentManagementDialog open={open || intent !== null || submission !== null || failure !== null} title={t(title)}
    locked={busy || intent !== null} onClose={() => { setSubmission(null); setFailure(null); onClose(); }}>
  <section className="flex flex-col gap-3" data-testid="agent-definition-editor">
    <h2 className="text-sm font-medium">{t(title)}</h2>
    <p className="text-sm text-muted-foreground">{t("agents.definitionOnly")}</p>
    {!intent ? <form className="flex flex-col gap-3" onSubmit={(event) => { event.preventDefault(); prepare(); }}>
      {edit ? <p className="break-words text-sm">{edit.target.displayName} · {t("agents.resourceVersion")}: {edit.target.resourceVersion}</p> : null}
      {edit?.owner ? <label className="flex flex-col gap-1 text-sm">{t("agents.newOwner")}
        <input required value={owner} onChange={(event) => setOwner(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
        <span className="text-xs text-muted-foreground">{t("agents.ownerHint")}</span>
      </label> : <>
        <label className="flex flex-col gap-1 text-sm">{t("agents.name")}
          <input required value={name} onChange={(event) => setName(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
        </label>
        {!edit ? <label className="flex flex-col gap-1 text-sm">{t("agents.slug")}
          <input required value={slug} onChange={(event) => setSlug(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
          <span className="text-xs text-muted-foreground">{t("workspace.create.slugHint")}</span>
        </label> : null}
      </>}
      <div className="flex gap-2"><Button type="submit" disabled={requestBlocked}>{t("agents.review")}</Button>{edit ? <Button onClick={onReset}>{t("agents.cancel")}</Button> : null}</div>
    </form> : <div className="flex flex-col gap-2 text-sm" role="group">
      <p className="break-words">{intent.command.actionKey === "agent.definition.create"
        ? t("agents.previewCreate", { name: intent.command.name ?? "", slug: intent.command.slug ?? "" })
        : intent.command.actionKey === "agent.definition.update"
          ? t("agents.previewUpdate", { resource: intent.command.resourceId ?? "", version: intent.command.resourceVersion ?? "", name: intent.command.name ?? "" })
          : t("agents.previewTransfer", { resource: intent.command.resourceId ?? "", version: intent.command.resourceVersion ?? "", owner: intent.previousOwner ?? "", next: intent.command.principalId ?? "" })}</p>
      <p className="text-muted-foreground">{t("agents.admission")}</p>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={() => void submit()}>{busy ? t("platform.loading") : unknown ? t("agents.retry") : t("agents.confirm")}</Button>
        {!busy && !unknown ? <Button onClick={() => { setIntent(null); onLocked(false); }}>{t("agents.cancel")}</Button> : null}
      </div>
    </div>}
    {submission ? <p role="status" className="break-words text-sm">{unknown
      ? t("agents.unknown", { operation: submission.operationId })
      : t("agents.recorded", { execution: submission.actionExecutionId, operation: submission.operationId })}
      {submission.reason ? ` ${reasonText(submission.reason)}` : ""}</p> : null}
    {failure ? <p role={failure.kind === "unknown" ? "status" : "alert"} className="text-sm">{failure.kind === "unknown"
      ? t("agents.unknown", { operation: failure.operationId ?? "—" }) : t("agents.rejected", { reason: failureText(failure) })}</p> : null}
    {tasks.status === "pending" ? <Notice role="status">{t("platform.loading")}</Notice>
      : !taskRows ? <Notice role="alert">{t("agents.inFlightUnavailable")}<Button onClick={reloadTasks}>{t("platform.retry")}</Button></Notice>
      : pending.length > 0 ? <div role="status" className="flex flex-col gap-1 text-sm"><p>{t("agents.inFlight")}</p>
        {pending.map((task) => <p className="break-words" key={task.actionExecutionId}>{t(taskPhase(task).label)} · {task.operationId}</p>)}
        <Button className="w-fit" onClick={reloadTasks}>{t("platform.refresh")}</Button>
      </div> : null}
  </section></AgentManagementDialog>;
}
