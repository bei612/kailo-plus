// 平台页（SS-WEB-01）：成员、本人审计、本人设备。Web 与 Desktop 渲染的是同
// 一份组件，数据全部经 BFF（传输由宿主经 PlatformProvider 给出）。这里没有 Relay
// 地址、没有 signer、没有 Nostr filter。
//
// 未启用的能力不在这里出现：不渲染一个点进去说「未启用」的入口。管理区导航同理，只列
// 当前会话能读取的分区（DD-170 §16.4）；入口的隐藏只是呈现，授权仍由 BFF 每次重做。

import {
  ActionGateState,
  ActionDispatchState,
  type AuditEventView,
  type AuditEventPage,
  type AuditEvidenceSlot,
  AuditEventType,
  BuzzIdentityState,
  type ClientKeyView,
  EvidenceSensitivity,
  ReasonCode,
  type EvidenceView,
  type OwnAuditEntry,
  type WorkspaceView,
} from "@client-kit/contracts";
import { type ReactNode, useState } from "react";
import {
  Building2, FileCode2, FileText, History, LockKeyhole, Mail, type LucideIcon, MessageSquareText, Plug,
  ShieldCheck, Smartphone, Users,
} from "lucide-react";
import { relativeTime } from "../format";
import { absoluteTime } from "../governance";
import {
  auditEventTypeMessages,
  buzzIdentityStateMessages,
  enumLabel,
  evidenceAuthorityMessages,
  evidenceKindMessages,
  evidenceUnavailableReasonMessages,
  reasonMessages,
  type PlatformMessageKey,
} from "../i18n";
import { BffError, type WriteFailure, writeFailure } from "../transport";
import type { BffClient } from "../client";
import { useBffClient, useFailureText, useLocale, useT } from "./context";
import { Badge, Button, useActionLabel } from "./ui";
import { EmptyState, ErrorState, NoMatchState, PermissionState, readRefusal, TableSkeleton } from "./state-views";
import { type Loaded, useLoad } from "./use-load";
import { CellStack, type DataColumn, DataTable } from "./data-table";
import { IdText, KeyValueList, Tag } from "./key-value";
import { ConfirmDialog } from "./confirm-dialog";
import { DetailHeader, FilterChips, PageSection, RefreshButton } from "./page-layout";
import { TechnicalDetails } from "./governance";
import { LegacySecretRefManagement, RoleManagement } from "./roles";
import { PlatformFeedback } from "./feedback/PlatformFeedback";
import { PlatformTenantManagement } from "./tenants";
import { CapabilityContractsPanel } from "./capability-contracts";
import { ComponentReleasesPanel } from "./component-releases";
import { ApplicationBindingsPanel } from "./application-bindings";
import { TenantInvitations } from "./invitations";
import { MembersPane, type MemberIdentityRenderer } from "./members";
import { SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "./sidebar/primitives";
import { AdminSurfaceContent, AdminSurfaceNavigation, useAdminSurfaces } from "./admin-surfaces";
import { adminSurfaceId } from "../admin-surfaces";
export { MembersPane, type MemberIdentityRenderer } from "./members";

export { AgentDefinitionsPage, WorkspaceAgentDialogs } from "./agents";
export { NativeApplicationEntries } from "./native-application-entries";

/**
 * 按读取状态渲染（DD-170 §16.4）：载入中是与页面同形的骨架，不是一行“载入中”；
 * 拒绝读取说明没有权限，结果不明给出重试；成功才渲染数据。
 */
export function Resource<T>({
  state,
  reload,
  children,
  skeleton,
}: {
  state: Loaded<T>;
  reload: () => void;
  children: (data: T) => ReactNode;
  /** Page-shaped loading placeholder; a table skeleton by default. */
  skeleton?: ReactNode;
}) {
  if (state.status === "pending") return <>{skeleton ?? <TableSkeleton rows={4} columns={3} />}</>;
  if (state.status === "error") return <ErrorState error={state.error} onRetry={reload} />;
  return <>{children(state.data)}</>;
}

const selectClass = "h-8 w-fit max-w-full rounded-lg border border-input bg-background px-2 text-sm shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring";

/**
 * 成员页的独立形态：自己取可进入的 Workspace 并提供选择。宿主已有 Workspace 选择
 * （Web 的平台页头部）时直接用 MembersPane。
 */
export function WorkspaceMembersPage({renderIdentity}:{renderIdentity?:MemberIdentityRenderer} = {}) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("workspaces", client.workspaces);
  const [chosen, setChosen] = useState<string | null>(null);
  const none = <EmptyState icon={Users} title={t("platform.noWorkspace")} />;
  return (
    <WorkspaceManagementPanels>
      <Resource state={state} reload={reload}>
      {(rows) => {
        if (rows.length === 0) return none;
        // Management-visible does not imply collaboration membership.
        const readable = rows.filter((w) => w.isMember === true);
        const active = readable.find((w) => w.id === chosen)?.id ?? readable[0]?.id;
        if (!active) return none;
        return (
          <div className="flex flex-col gap-3">
            {readable.length > 1 ? (
              <select
                aria-label={t("platform.workspace")}
                className={selectClass}
                value={active}
                onChange={(e) => setChosen(e.target.value)}
              >
                {readable.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            ) : (
              <h2 className="text-sm font-medium">{readable[0]?.name}</h2>
            )}
            {active ? <MembersPane key={active} workspaceId={active} renderIdentity={renderIdentity} /> : null}
          </div>
        );
      }}
      </Resource>
    </WorkspaceManagementPanels>
  );
}

// ---------------------------------------------------------------------------
// 管理区
// ---------------------------------------------------------------------------

type Section = "members" | "invitations" | "roles" | "tenants" | "feedback" | "secrets" | "capabilities" | "components" | "bindings";
/** What a read-only probe of a section's own first read says about this session. */
type SectionAccess = "allowed" | "denied" | "unknown";
type SectionProbes = Record<Exclude<Section, "members">, SectionAccess>;

const sectionMeta: Record<Section, { label: PlatformMessageKey; icon: LucideIcon }> = {
  members: { label: "platform.tab.members", icon: Users },
  invitations: { label: "invitations.title", icon: Mail },
  roles: { label: "roles.title", icon: ShieldCheck },
  tenants: { label: "tenants.title", icon: Building2 },
  feedback: { label: "platform.feedback.operatorTitle", icon: MessageSquareText },
  secrets: { label: "secretRehome.title", icon: LockKeyhole },
  capabilities: { label: "capabilities.title", icon: FileText },
  components: { label: "components.title", icon: FileCode2 },
  bindings: { label: "bindings.title", icon: Plug },
};

const sectionGroups: readonly { label: PlatformMessageKey; sections: readonly Section[] }[] = [
  { label: "platform.manage.groupOrganization", sections: ["members", "invitations", "roles"] },
  { label: "platform.manage.groupPlatform", sections: ["tenants", "feedback", "secrets", "capabilities", "components", "bindings"] },
];

/** A definitive refusal (403, or 404 for a capability that is not published) hides the entry. */
const probe = (read: () => Promise<unknown>): Promise<SectionAccess> =>
  read().then(() => "allowed" as const, (error: unknown) => (readRefusal(error) !== null ? "denied" : "unknown"));

/** Workspace-scoped probes are bounded; beyond this the entry stays visible (unknown). */
const PROBE_WORKSPACES = 12;

async function probeRoles(client: BffClient): Promise<SectionAccess> {
  // Organization-wide roles, or any Workspace this member manages, or the create entry.
  const [tenant, page] = await Promise.all([
    probe(() => client.roleMembers()),
    client.roleWorkspaces(0).then((value) => value, () => null),
  ]);
  if (tenant !== "denied") return tenant;
  if (!page || !Array.isArray(page.workspaces)) return "unknown";
  return page.workspaces.length === 0 && page.nextOffset === undefined && page.createActionKey === undefined ? "denied" : "allowed";
}

async function probeBindings(client: BffClient): Promise<SectionAccess> {
  const tenant = await probe(() => client.applicationBindings(undefined, 0));
  if (tenant !== "denied") return tenant;
  const workspaces = await client.workspaces().then((value) => value, () => null);
  if (!Array.isArray(workspaces) || workspaces.length > PROBE_WORKSPACES) return "unknown";
  const scoped = await Promise.all(workspaces.map((w) => probe(() => client.applicationBindings(w.id, 0))));
  return scoped.every((access) => access === "denied") ? "denied" : scoped.includes("allowed") ? "allowed" : "unknown";
}

/** The same read-only GETs each section issues first, in parallel. Nothing is written. */
async function probeSections(client: BffClient): Promise<SectionProbes> {
  const [invitations, roles, tenants, feedback, secrets, capabilities, components, bindings] = await Promise.all([
    probe(() => client.invitations()),
    probeRoles(client),
    probe(() => client.platformTenants(0)),
    probe(() => client.platformFeedback(0)),
    probe(() => client.legacySecretRefs()),
    probe(() => client.capabilityContracts(0)),
    probe(() => client.componentReleases(0)),
    probeBindings(client),
  ]);
  return { invitations, roles, tenants, feedback, secrets, capabilities, components, bindings };
}

function NavSkeleton({ rows }: { rows: number }) {
  return <>{Array.from({ length: rows }, (_, i) => <li key={i} aria-hidden className="flex h-8 items-center gap-2 px-2">
    <span className="size-4 animate-pulse rounded-sm bg-muted motion-reduce:animate-none" />
    <span className={`h-3 animate-pulse rounded-md bg-muted motion-reduce:animate-none ${i % 2 ? "w-20" : "w-28"}`} />
  </li>)}</>;
}

/** Both hosts consume the same management panels without a second Workspace selector. */
export function WorkspaceManagementPanels({children}:{children?:ReactNode}) {
  const t=useT();
  const client=useBffClient();
  const content: Record<Section, ReactNode> = {
    members: children,
    invitations: <TenantInvitations/>,
    roles: <RoleManagement/>,
    tenants: <PlatformTenantManagement/>,
    feedback: <PlatformFeedback/>,
    secrets: <LegacySecretRefManagement/>,
    capabilities: <CapabilityContractsPanel/>,
    components: <ComponentReleasesPanel/>,
    bindings: <ApplicationBindingsPanel/>,
  };
  const [access]=useLoad("management-section-access",()=>probeSections(client));
  const checking=access.status==="pending";
  const accessOf=(section:Section):SectionAccess=>section==="members"?"allowed":access.status==="ok"?access.data[section]:"unknown";
  // A section whose read was definitively refused is not offered; unknown outcomes stay visible
  // and the section shows its own error.
  const visible=(section:Section)=>section==="members"||(!checking&&accessOf(section)!=="denied");
  const [selected,setSelected]=useState<Section|`surface:${string}`>("members");
  const [visited,setVisited]=useState<Section[]>(["members"]);
  // DD-138(6), 07 §4.8.5: component admin surfaces join the admin area by Kailo admin category.
  const [surfaces]=useAdminSurfaces();
  const surfaceEntries=surfaces.status==="ok"?surfaces.data.entries:[];
  const [openedSurfaces,setOpenedSurfaces]=useState<string[]>([]);
  const selectedSurface=selected.startsWith("surface:")?selected.slice("surface:".length):null;
  const open=(section:Section)=>{setSelected(section);setVisited(old=>old.includes(section)?old:[...old,section]);};
  // DD-141 §10 / DD-170 §16.3: the open section sits on one clean content plane — a hairline on
  // its leading and top edges, flush to the right and bottom, no floating card.
  return <div className="flex min-h-0 w-full flex-1 flex-col bg-sidebar sm:h-full sm:flex-row" data-testid="member-management-context">
    <nav aria-label={t("platform.manage.nav")} aria-busy={checking||undefined} className="shrink-0 text-sidebar-foreground sm:min-h-0 sm:w-(--sidebar-width) sm:overflow-y-auto">
      {checking?<span className="sr-only" role="status">{t("platform.manage.checking")}</span>:null}
      {sectionGroups.map(group=>{
        const shown=group.sections.filter(visible);
        const pending=checking?group.sections.length-shown.length:0;
        if(shown.length===0&&pending===0)return null;
        return <SidebarGroup key={group.label} data-testid={`management-group-${group.label}`}>
          <SidebarGroupLabel>{t(group.label)}</SidebarGroupLabel>
          <SidebarGroupContent><SidebarMenu>
            {shown.map(section=>{const Icon=sectionMeta[section].icon;return <SidebarMenuItem key={section}><SidebarMenuButton type="button"
              aria-pressed={section===selected} isActive={section===selected} data-management-entry={section} onClick={()=>open(section)}>
              <Icon aria-hidden className="size-4 shrink-0" strokeWidth={1.75}/>
              <span className="min-w-0 flex-1 truncate">{t(sectionMeta[section].label)}</span>
            </SidebarMenuButton></SidebarMenuItem>;})}
            {pending>0?<NavSkeleton rows={pending}/>:null}
          </SidebarMenu></SidebarGroupContent>
        </SidebarGroup>;
      })}
      <AdminSurfaceNavigation state={surfaces} selected={selectedSurface} onSelect={(entry)=>{
        const id=adminSurfaceId(entry);
        setSelected(`surface:${id}`);setOpenedSurfaces(old=>old.includes(id)?old:[...old,id]);}}/>
    </nav>
    <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-border bg-background max-sm:border-t sm:rounded-tl-xl sm:border-l sm:border-t">
      {/* Once opened, management intents stay mounted across navigation. UNKNOWN is not discarded. */}
      {visited.map(section=><section key={section} hidden={section!==selected} className="min-h-0 flex-1 overflow-y-auto px-5 pb-12 pt-6 sm:px-6" data-management-section={section}>
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-4">
          {accessOf(section)==="denied"?<PermissionState/>:content[section]}
        </div>
      </section>)}
      {/* An opened admin surface stays mounted (unsaved native work survives switching); a surface no longer listed is removed. */}
      {openedSurfaces.map(id=>{
        const entry=surfaceEntries.find(item=>adminSurfaceId(item)===id);
        return entry?<section key={id} hidden={id!==selectedSurface} className="flex min-h-0 flex-1 flex-col" data-management-section="admin-surface">
          <AdminSurfaceContent entry={entry}/></section>:null;
      })}
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------

/** Fields every audit row carries, own or scoped. */
type AuditRow = Pick<OwnAuditEntry, "occurredAt" | "eventType" | "actionKey" | "decision" | "resultCode" | "workspaceId">;

// Audit strings are open-ended wire values, not a second outcome state machine.
// Only recognized decisions carry positive/negative tone; NONE and future values stay neutral.
const resultKeys: Readonly<Record<string, PlatformMessageKey>> = {
  NONE: "platform.audit.noResult", ACCEPTED: "platform.audit.accepted",
  DISPATCHED: "platform.audit.dispatched", DELIVERED: "platform.audit.delivered",
  NOT_DELIVERED: "platform.audit.notDelivered", REJECTED: "platform.audit.rejected",
  UNKNOWN: "platform.audit.unknownResult",
  COMPLETED: "platform.audit.completed", FAILED: "platform.audit.failed",
  CANCELED: "platform.audit.canceled", CANCELLED: "platform.audit.canceled", COMMITTED: "platform.audit.committed",
  SUCCEEDED: "platform.audit.succeeded", APPROVED: "platform.audit.approved",
  REGISTERED: "platform.audit.registered", ROTATED: "platform.audit.rotated",
  ROLE_REMOVED: "platform.audit.roleRemoved", PUSH_REVOKED: "platform.audit.pushRevoked",
  SESSION_ABANDONED: "platform.audit.sessionAbandoned", MODERATION_READ: "platform.audit.moderationRead",
  AGENT_TRANSCRIPT_READ: "platform.audit.agentTranscriptRead",
  PENDING_PUBLISH: "platform.audit.pendingPublish",
  NATIVE_TURN_BOUND: "platform.audit.nativeTurnBound",
  DISPATCH_INTENT: "platform.audit.dispatchIntent",
  DELEGATION_GRANTED: "platform.audit.delegationGranted",
  DELEGATION_REVOKED: "platform.audit.delegationRevoked",
  INVITATION_REDEEMED: "platform.audit.invitationRedeemed",
  CANCELED_BEFORE_MODEL_DISPATCH: "platform.audit.canceledBeforeModelDispatch",
  CANCELED_BEFORE_MESSAGE_DISPATCH: "platform.audit.canceledBeforeMessageDispatch",
  CANCEL_REQUEST_PENDING: "platform.audit.cancelRequestPending",
  AUTOMATION_ENABLED: "platform.audit.automationEnabled",
  AUTOMATION_DISABLED: "platform.audit.automationDisabled",
  AUTOMATION_PAUSED: "platform.audit.automationPaused",
  AUTOMATION_DELETED: "platform.audit.automationDeleted",
  ACTIVE: "platform.audit.active",
  [ActionGateState.Allowed]: "tasks.status.allowed",
  [ActionGateState.Evaluating]: "tasks.status.evaluating",
  [ActionGateState.Waiting]: "tasks.status.waitingApproval",
  [ActionGateState.Denied]: "tasks.status.denied",
  [ActionGateState.Revoked]: "tasks.status.revoked",
  [ActionGateState.Expired]: "tasks.status.expired",
  [ActionDispatchState.NotDispatched]: "tasks.status.notStarted",
  [ActionDispatchState.Aborted]: "tasks.status.aborted",
  CANCEL_REQUEST_ACCEPTED: "tasks.status.cancelRequestAccepted",
  RERUN_ACCEPTED: "tasks.status.rerunAccepted",
};

/** Plain-language decision and result; an unrecognized code reads as a generic outcome. */
function useAuditText() {
  const t = useT();
  const locale = useLocale();
  return {
    decision: (decision: string) => t(decision === "ALLOW" ? "platform.audit.allow"
      : decision === "DENY" ? "platform.audit.deny"
        : decision === "NONE" ? "platform.audit.noDecision" : "platform.audit.unknownDecision", { code: decision }),
    result: (code: string) => {
      const key = Object.hasOwn(resultKeys, code) ? resultKeys[code] : undefined;
      return key ? t(key)
        : Object.hasOwn(reasonMessages, code) ? enumLabel(locale, reasonMessages, code as ReasonCode)
          : t("platform.audit.otherResult");
    },
    type: (type: string) => Object.hasOwn(auditEventTypeMessages, type)
      ? enumLabel(locale, auditEventTypeMessages, type as AuditEventType) : t("platform.audit.otherResult"),
  };
}

function AuditDecision({ decision }: { decision: string }) {
  const text = useAuditText();
  return <span className="inline-flex" title={decision} data-testid="audit-decision">
    <Badge tone={decision === "ALLOW" ? "positive" : decision === "DENY" ? "negative" : "neutral"}>{text.decision(decision)}</Badge>
  </span>;
}

function AuditResult({ decision, resultCode }: Pick<AuditRow, "decision" | "resultCode">) {
  const text = useAuditText();
  return <span className="flex min-w-0 items-center gap-2">
    <AuditDecision decision={decision} />
    <span className="truncate" title={resultCode}>{text.result(resultCode)}</span>
  </span>;
}

function When({ at }: { at: string }) {
  const locale = useLocale();
  return <span className="whitespace-nowrap tabular-nums" title={absoluteTime(locale, at)}>{relativeTime(locale, at)}</span>;
}

type DecisionFilter = "all" | "allowed" | "denied" | "other";
const decisionGroup = (decision: string): Exclude<DecisionFilter, "all"> =>
  decision === "ALLOW" ? "allowed" : decision === "DENY" ? "denied" : "other";

/**
 * The audit table shared by "my activity" and the scoped audit: time, type, action and
 * result, with type and admission filters and a text filter over what each row says.
 */
function AuditTable<T extends AuditRow>({ rows, rowKey, label, extraColumns = [], onOpen, toolbarEnd, empty, partial, testId }: {
  rows: readonly T[];
  rowKey: (row: T, index: number) => string;
  label: string;
  extraColumns?: DataColumn<T>[];
  onOpen?: (row: T) => void;
  toolbarEnd?: ReactNode;
  empty: ReactNode;
  partial?: ReactNode;
  testId?: string;
}) {
  const t = useT();
  const actionLabel = useActionLabel();
  const text = useAuditText();
  const [type, setType] = useState<string>("");
  const [decision, setDecision] = useState<DecisionFilter>("all");
  const types = [...new Set(rows.map((row) => row.eventType))];
  const shown = rows.filter((row) => (type === "" || row.eventType === type) && (decision === "all" || decisionGroup(row.decision) === decision));
  // Rows have no identity of their own on the own-audit read; keys come from position in the full set.
  const keyed = new Map(rows.map((row, index) => [row, rowKey(row, index)]));
  const columns: DataColumn<T>[] = [
    { key: "time", header: t("platform.time"), width: "8rem", cell: (row) => <When at={row.occurredAt} />,
      sortValue: (row) => Date.parse(row.occurredAt) },
    { key: "type", header: t("platform.type"), width: "6.5rem", secondary: true, cell: (row) => text.type(row.eventType) },
    { key: "action", header: t("platform.action"), truncate: true,
      cell: (row) => <span className="font-medium text-foreground"><ActionText actionKey={row.actionKey} /></span>,
      sortValue: (row) => actionLabel(row.actionKey) },
    { key: "result", header: t("platform.result"), width: "40%", cell: (row) => <AuditResult decision={row.decision} resultCode={row.resultCode} /> },
    ...extraColumns,
  ];
  const filtered = type !== "" || decision !== "all";
  return (
    <DataTable
      key={`${type}|${decision}`}
      testId={testId}
      label={label}
      rows={shown}
      columns={columns}
      density="compact"
      rowKey={(row) => keyed.get(row) ?? ""}
      onRowClick={onOpen}
      search={{ placeholder: t("platform.audit.search"),
        text: (row) => `${actionLabel(row.actionKey)} ${text.type(row.eventType)} ${text.decision(row.decision)} ${text.result(row.resultCode)}` }}
      partial={partial}
      toolbar={<>
        {rows.length > 0 ? <>
          {types.length > 1 ? <select aria-label={t("platform.audit.filter.type")} className={selectClass} value={type}
            onChange={(event) => setType(event.target.value)}>
            <option value="">{t("platform.audit.filter.allTypes")}</option>
            {types.map((value) => <option key={value} value={value}>{text.type(value)}</option>)}
          </select> : null}
          <FilterChips label={t("platform.audit.filter.decision")} value={decision} onChange={setDecision} options={[
            { value: "all", label: t("platform.audit.filter.all") },
            { value: "allowed", label: t("platform.audit.filter.allowed") },
            { value: "denied", label: t("platform.audit.filter.denied") },
            { value: "other", label: t("platform.audit.filter.other") },
          ]} />
        </> : null}
        {toolbarEnd}
      </>}
      empty={rows.length === 0 || !filtered ? empty : <NoMatchState onClear={() => { setType(""); setDecision("all"); }} />}
    />
  );
}

/** The action's catalog label; its wire key stays on hover and in technical details. */
function ActionText({ actionKey }: { actionKey: string }) {
  const label = useActionLabel();
  return <span title={actionKey}>{label(actionKey)}</span>;
}

/**
 * 审计页：本人在当前 Tenant 内的动作（.design/03 §14 的最小集合），以及调用方持有
 * audit permission 时的范围审计。
 */
export function AuditPage() {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("audit", client.ownAudit);
  return (
    <div className="flex flex-col gap-10">
      <PageSection title={t("platform.audit.myTitle")} testId="own-audit"
        description={state.status === "ok" && Array.isArray(state.data) && state.data.length > 0
          ? t("platform.audit.myExplain", { count: state.data.length }) : undefined}>
        <Resource state={state} reload={reload}>
          {(rows) => (
            <AuditTable
              rows={rows}
              // 审计行没有对外 id；它们只追加、按时间排序返回，位置即身份
              rowKey={(row, index) => `${index}:${row.occurredAt}`}
              label={t("platform.audit.table")}
              toolbarEnd={<RefreshButton onClick={reload} />}
              empty={<EmptyState icon={History} title={t("platform.audit.empty.title")} description={t("platform.audit.empty.body")} />}
            />
          )}
        </Resource>
      </PageSection>
      <ScopedAudit />
    </div>
  );
}

export const isForbidden = (error: unknown) => error instanceof BffError && error.status === 403;
const isNotFound = (error: unknown) => error instanceof BffError && error.status === 404;

/** 200 回应也要合契约才用；缺字段的页当作读取失败，不当作「没有事件」。 */
function isAuditEventPage(page: unknown): page is AuditEventPage {
  if (!page || typeof page !== "object") return false;
  const { events, nextCursor } = page as Partial<AuditEventPage>;
  return Array.isArray(events)
    && (nextCursor === undefined || typeof nextCursor === "string")
    && events.every((e) => e && typeof e.id === "string" && typeof e.occurredAt === "string"
      && typeof e.eventType === "string" && typeof e.actionKey === "string"
      && typeof e.decision === "string" && typeof e.resultCode === "string"
      && Array.isArray(e.evidence)
      && e.evidence.every((slot) => slot && Number.isInteger(slot.index) && slot.index >= 0));
}

type TenantAccess = "unknown" | "allowed" | "denied";

/** 已追加的后续页只属于取得它们时的首页；首页重读或范围切换后即作废。 */
type MorePages = {
  base: AuditEventPage;
  pages: AuditEventPage[];
  status: "idle" | "loading" | "error";
};

/**
 * 范围审计（.design/03 §14）：整个 Tenant 或其中一个 Workspace。是否有权由服务端每次
 * fresh Check 决定——Tenant 范围回 403 时，有可进入的 Workspace 就让人改选 Workspace
 * （「整个组织」不可选），没有则整节不渲染；判定不明（503、网络）显示可重试的错误，
 * 不渲染成「没有事件」。读取按 cursor 续页：已载入的部分如实标注，并提供“加载更多”。
 */
function ScopedAudit() {
  const client = useBffClient();
  const t = useT();
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [first, reload] = useLoad(`audit-events:${scope ?? "tenant"}`, () => client.auditEvents(scope));
  const [more, setMore] = useState<MorePages | null>(null);
  const [workspaceState, reloadWorkspaces] = useLoad("workspaces", client.workspaces);
  const [openEvent, setOpenEvent] = useState<string | null>(null);
  // 离开 Tenant 范围时记下它的判定：切回时的重读不让区块闪没，无权时保持「整个组织」不可选
  const [recordedTenant, setRecordedTenant] = useState<TenantAccess>("unknown");
  // 区块已经给出（换过范围或点过重试）后，重读期间不收起
  const [engaged, setEngaged] = useState(false);
  const tenantAccess: TenantAccess = scope !== undefined
    ? recordedTenant
    : first.status === "ok"
      ? "allowed"
      : first.status === "error" && isForbidden(first.error)
        ? "denied"
        : recordedTenant;

  const workspaces: WorkspaceView[] | null =
    workspaceState.status === "ok" && Array.isArray(workspaceState.data) ? workspaceState.data : null;
  const workspacesFailed = workspaceState.status !== "pending" && workspaces === null;

  // Tenant 无权时，只有确有可进入的 Workspace 才给出区块（Workspace auditor 从这里进入）；
  // 列表读不到属于结果不明，仍给出区块并如实说明，不当作「没有 Workspace」。
  if (tenantAccess === "denied" && (workspaceState.status === "pending" || workspaces?.length === 0))
    return null;
  if (scope === undefined && first.status === "pending" && tenantAccess !== "allowed" && !engaged)
    return null;

  const firstPage = first.status === "ok" && isAuditEventPage(first.data) ? first.data : null;
  const extra = firstPage && more?.base === firstPage ? more : null;
  const pages = firstPage ? [firstPage, ...(extra?.pages ?? [])] : [];
  const events = pages.flatMap((p) => p.events);
  const nextCursor = pages[pages.length - 1]?.nextCursor;
  const selected = openEvent ? events.find((e) => e.id === openEvent) : undefined;

  const loadMore = async () => {
    if (!firstPage || !nextCursor || extra?.status === "loading") return;
    const base = firstPage;
    const loaded = extra?.pages ?? [];
    setMore({ base, pages: loaded, status: "loading" });
    try {
      const page = await client.auditEvents(scope, nextCursor);
      if (!isAuditEventPage(page)) throw new Error("audit event page does not match the contract");
      setMore((old) => (old?.base === base ? { base, pages: [...loaded, page], status: "idle" } : old));
    } catch {
      setMore((old) => (old?.base === base ? { base, pages: loaded, status: "error" } : old));
    }
  };
  const retry = () => { setEngaged(true); setMore(null); reload(); };
  const workspaceName = (id: string | undefined) => id === undefined ? t("platform.audit.scope.tenantLevel")
    : workspaces?.find((w) => w.id === id)?.name ?? t("platform.audit.unknownWorkspace");

  const partial = nextCursor ? (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{t("list.partial", { count: String(events.length) })}</span>
      {extra?.status === "error" ? <span role="alert" className="text-danger-text">{t("platform.loadFailed")}</span> : null}
      <button type="button" disabled={extra?.status === "loading"} onClick={() => void loadMore()}
        className="rounded-sm font-medium text-brand-text hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
        {extra?.status === "loading" ? t("platform.loading") : extra?.status === "error" ? t("platform.retry") : t("platform.audit.scope.loadMore")}
      </button>
    </span>
  ) : undefined;

  const body = scope === undefined && tenantAccess === "denied" ? (
    <PermissionState compact description={t("platform.audit.scope.tenantDenied")} />
  ) : first.status === "pending" ? (
    <TableSkeleton rows={5} columns={5} />
  ) : first.status === "error" && isForbidden(first.error) ? (
    <PermissionState compact description={t("platform.audit.scope.denied")} />
  ) : !firstPage ? (
    <ErrorState compact error={first.status === "error" ? first.error : undefined} onRetry={retry} />
  ) : (
    <>
      <div hidden={selected !== undefined}>
        <AuditTable
          testId="scoped-audit-table"
          rows={events}
          rowKey={(e) => e.id}
          label={t("platform.audit.scope.table")}
          onOpen={(e) => setOpenEvent(e.id)}
          partial={partial}
          toolbarEnd={<RefreshButton onClick={retry} />}
          extraColumns={[
            { key: "workspace", header: t("platform.workspace"), width: "9rem", secondary: true, truncate: true,
              cell: (e) => workspaceName(e.workspaceId) },
            { key: "evidence", header: t("platform.audit.scope.evidence"), width: "5.5rem", secondary: true, align: "end",
              cell: (e) => e.evidence.length > 0 ? t("platform.audit.evidenceCount", { count: e.evidence.length }) : null },
          ]}
          empty={<EmptyState compact icon={History} title={t("platform.audit.scope.emptyTitle")} description={t("platform.audit.scope.none")} />}
        />
      </div>
      {selected ? <AuditEventDetail event={selected} workspace={workspaceName(selected.workspaceId)} onBack={() => setOpenEvent(null)} /> : null}
    </>
  );

  return (
    <PageSection title={t("platform.audit.scope.title")} description={t("platform.audit.scope.explain")} testId="scoped-audit"
      actions={<ScopeSelect
        scope={scope}
        workspaces={workspaces ?? []}
        workspacesFailed={workspacesFailed}
        tenantDenied={tenantAccess === "denied"}
        reloadWorkspaces={reloadWorkspaces}
        onChange={(next) => {
          setRecordedTenant(tenantAccess);
          setEngaged(true);
          setMore(null);
          setOpenEvent(null);
          setScope(next);
        }}
      />}>
      {body}
    </PageSection>
  );
}

/** One audit event: what happened, its evidence (resolved on request) and the technical record. */
function AuditEventDetail({ event, workspace, onBack }: { event: AuditEventView; workspace: string; onBack: () => void }) {
  const t = useT();
  const locale = useLocale();
  const actionLabel = useActionLabel();
  const text = useAuditText();
  return (
    <div className="flex flex-col gap-6" data-testid="audit-event-detail">
      <DetailHeader onBack={onBack} title={actionLabel(event.actionKey)} status={<AuditDecision decision={event.decision} />}
        subtitle={<span title={absoluteTime(locale, event.occurredAt)}>{relativeTime(locale, event.occurredAt)}</span>} />
      <KeyValueList items={[
        { id: "time", label: t("platform.time"), value: absoluteTime(locale, event.occurredAt) },
        { id: "type", label: t("platform.type"), value: text.type(event.eventType) },
        { id: "result", label: t("platform.result"), value: <span title={event.resultCode}>{text.result(event.resultCode)}</span> },
        { id: "workspace", label: t("platform.workspace"), value: workspace },
      ]} />
      <PageSection title={t("platform.audit.detail.evidence")}>
        {event.evidence.length === 0
          ? <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{t("platform.audit.detail.noEvidence")}</p>
          : <EvidenceSlots eventId={event.id} slots={event.evidence} />}
      </PageSection>
      <TechnicalDetails items={[
        { id: "event", label: t("platform.audit.detail.eventId"), value: <IdText value={event.id} full /> },
        { id: "actionKey", label: t("tasks.detail.actionKey"), value: <IdText value={event.actionKey} full /> },
        { id: "resultCode", label: t("platform.audit.detail.resultCode"), value: <code className="font-mono text-xs">{event.resultCode}</code> },
        { id: "decision", label: t("platform.audit.detail.decisionCode"), value: <code className="font-mono text-xs">{event.decision}</code> },
        event.workspaceId ? { id: "workspace", label: t("platform.audit.detail.workspaceId"), value: <IdText value={event.workspaceId} full /> } : undefined,
      ]} />
    </div>
  );
}

/**
 * 范围选择：整个 Tenant，或页面已有来源（可进入的 Workspace 列表）中的一个。列表读不到
 * 时仍可选整个 Tenant，并如实说明工作区列表未载入。
 */
export function ScopeSelect({
  scope,
  workspaces,
  workspacesFailed,
  tenantDenied,
  reloadWorkspaces,
  onChange,
}: {
  scope: string | undefined;
  workspaces: WorkspaceView[];
  workspacesFailed: boolean;
  tenantDenied: boolean;
  reloadWorkspaces: () => void;
  onChange: (scope: string | undefined) => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label={t("platform.audit.scope.select")}
        className={selectClass}
        value={scope ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="" disabled={tenantDenied}>
          {tenantDenied ? t("platform.audit.scope.chooseWorkspace") : t("platform.audit.scope.tenant")}
        </option>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      {workspacesFailed ? (
        <span role="alert" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          {t("platform.audit.scope.workspacesFailed")}
          <Button onClick={reloadWorkspaces}>{t("platform.retry")}</Button>
        </span>
      ) : null}
    </div>
  );
}

/** 证据先只列种类；点开才解引用。RESTRICTED 在列表上就标注「受限」。 */
function EvidenceSlots({ eventId, slots }: { eventId: string; slots: AuditEvidenceSlot[] }) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = useState<number[]>([]);
  const toggle = (index: number) =>
    setOpen((old) => (old.includes(index) ? old.filter((i) => i !== index) : [...old, index]));
  return (
    <ul className="flex flex-col rounded-xl border border-border bg-card" data-testid="evidence-slots">
      {slots.map((slot) => {
        const kind = slot.kind && slot.kind in evidenceKindMessages
          ? enumLabel(locale, evidenceKindMessages, slot.kind)
          : t("platform.audit.scope.unrecognizedKind");
        const expanded = open.includes(slot.index);
        return (
          <li key={slot.index} className="flex flex-col gap-2 border-b border-border px-4 py-2.5 last:border-b-0">
            <span className="flex flex-wrap items-center gap-2">
              <Button aria-expanded={expanded} onClick={() => toggle(slot.index)}>{kind}</Button>
              {slot.sensitivity === EvidenceSensitivity.Restricted ? (
                <Tag tone="warning">{t("platform.audit.scope.restricted")}</Tag>
              ) : null}
            </span>
            {expanded ? <EvidenceDetail eventId={eventId} index={slot.index} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 一条证据的解引用。只有 available 为 true 且带 stableId 才显示 ID；其余一律只显示
 * 本地化的不可用原因，绝不回退显示任何 ref 内容。
 */
function EvidenceDetail({ eventId, index }: { eventId: string; index: number }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad(`audit-evidence:${eventId}:${index}`, () =>
    client.auditEvidence(eventId, index),
  );
  if (state.status === "pending")
    return <span role="status" className="text-xs text-muted-foreground">{t("platform.loading")}</span>;
  if (state.status === "error") {
    if (isForbidden(state.error))
      return <span role="alert" className="text-sm text-muted-foreground">{t("platform.audit.scope.denied")}</span>;
    // 404 是确定结论：原证据（或事件、位置）已不存在，重试不会改变它，只显示不可用。
    // 503 与网络错误是结果不明，才给重试。
    if (isNotFound(state.error))
      return (
        <span className="text-sm text-muted-foreground" data-testid="evidence-unavailable">
          {t("platform.audit.scope.notFound")}
        </span>
      );
    return (
      <span role="alert" className="inline-flex flex-wrap items-center gap-2 text-sm">
        {t("platform.loadFailed")} <Button onClick={reload}>{t("platform.retry")}</Button>
      </span>
    );
  }
  const view: Partial<EvidenceView> = state.data && typeof state.data === "object" ? state.data : {};
  if (view.available === true && typeof view.stableId === "string") {
    return (
      <div data-testid="evidence-available">
        <KeyValueList bordered={false} items={[
          view.authority && view.authority in evidenceAuthorityMessages
            ? { id: "authority", label: t("platform.audit.detail.authority"), value: enumLabel(locale, evidenceAuthorityMessages, view.authority) }
            : undefined,
          { id: "reference", label: t("platform.audit.detail.reference"), value: <IdText value={view.stableId} full /> },
          Number.isInteger(view.version)
            ? { id: "version", label: t("platform.audit.detail.version"), value: t("platform.audit.scope.version", { version: view.version as number }) }
            : undefined,
        ]} />
      </div>
    );
  }
  const reason = view.unavailableReason;
  return (
    <span className="text-sm text-muted-foreground" data-testid="evidence-unavailable">
      {reason && reason in evidenceUnavailableReasonMessages
        ? t("platform.audit.scope.unavailable", {
            reason: enumLabel(locale, evidenceUnavailableReasonMessages, reason),
          })
        : t("platform.audit.scope.unavailableUnknown")}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 设备
// ---------------------------------------------------------------------------

/**
 * 本人的原生设备（DD-77/79）。
 *
 * 登记只能在设备上完成——私钥在那里生成、从不离开。这里只能查看与撤销：设备丢了，
 * 应当能在任一端把它撤掉。撤销只移出这一把公钥，Relay 随即拒绝它；其他设备与
 * Web 身份不受影响。`currentDevicePubkey` 由原生宿主给出，用于标出本机。
 * 撤销不可恢复，必须经确认对话框（DD-170 §16.6）；提交中对话框不关闭，结果不明只提示核对。
 */
export function DevicesPage({ currentDevicePubkey }: { currentDevicePubkey?: string }) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [state, reload] = useLoad("client-keys", client.clientKeys);
  const [confirming, setConfirming] = useState<ClientKeyView | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const failureText = useFailureText();
  const [outcome, setOutcome] = useState<WriteFailure | null>(null);

  const revoke = async (key: ClientKeyView) => {
    if (revoking !== null) return;
    setRevoking(key.pubkey);
    setOutcome(null);
    try {
      await client.revokeClientKey(key.pubkey);
    } catch (e) {
      // 结果不明不说成失败：撤销可能已经生效，只能提示去确认
      setOutcome(writeFailure(e));
    } finally {
      setRevoking(null);
      setConfirming(null);
      reload();
    }
  };

  const deviceName = (key: ClientKeyView) => {
    const time = Date.parse(key.createdAt);
    return Number.isFinite(time)
      ? t("platform.devices.deviceName", { date: new Date(time).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en", { dateStyle: "medium" }) })
      : t("platform.devices.device");
  };

  const columns: DataColumn<ClientKeyView>[] = [
    {
      key: "device", header: t("platform.devices.device"),
      cell: (k) => <CellStack
        primary={<span className="inline-flex min-w-0 items-center gap-2">
          <span className="truncate">{deviceName(k)}</span>
          {k.pubkey === currentDevicePubkey ? <Tag tone="brand">{t("platform.devices.thisDevice")}</Tag> : null}
        </span>}
        secondary={<IdText value={k.pubkey} label={t("platform.devices.publicKey")} />} />,
    },
    {
      key: "state", header: t("platform.state"), width: "8rem",
      cell: (k) => <Badge tone={k.state === BuzzIdentityState.Active ? "positive" : "neutral"}>
        {enumLabel(locale, buzzIdentityStateMessages, k.state)}
      </Badge>,
    },
    { key: "added", header: t("platform.devices.registeredColumn"), width: "8rem", secondary: true,
      cell: (k) => <When at={k.createdAt} />, sortValue: (k) => Date.parse(k.createdAt) },
  ];

  return (
    <PageSection description={t("platform.devices.explain")} testId="devices"
      actions={<RefreshButton onClick={reload} pending={state.status === "pending"} />}>
      {outcome ? (
        <div className={`rounded-xl px-4 py-3 text-sm ${outcome.kind === "unknown" ? "bg-warning-soft text-warning-text" : "bg-danger-soft text-danger-text"}`} role="alert">
          {outcome.kind === "unknown"
            ? t("platform.devices.revokeUnknown", { operation: outcome.operationId ?? "—" })
            : t("platform.devices.revokeRejected", { reason: failureText(outcome) })}
        </div>
      ) : null}
      <Resource state={state} reload={reload}>
        {(keys) => (
          <DataTable
            testId="device-table"
            label={t("platform.devices.table")}
            rows={keys}
            columns={columns}
            rowKey={(k) => k.pubkey}
            rowActionsWidth="6rem"
            rowActions={(k) => k.state === BuzzIdentityState.Revoking || k.state === BuzzIdentityState.Revoked ? null : (
              <Button className="h-7 px-2.5 text-danger-text" disabled={revoking !== null} onClick={() => setConfirming(k)}>
                {t("platform.devices.revoke")}
              </Button>
            )}
            empty={<EmptyState icon={Smartphone} title={t("platform.devices.emptyTitle")} description={t("platform.devices.none")} />}
          />
        )}
      </Resource>
      <ConfirmDialog
        testId="device-revoke-dialog"
        open={confirming !== null}
        onOpenChange={(next) => { if (!next) setConfirming(null); }}
        title={t("platform.devices.confirmTitle")}
        description={confirming?.pubkey === currentDevicePubkey ? t("platform.devices.confirmThisBody") : t("platform.devices.confirmBody")}
        confirmLabel={t("platform.devices.revoke")}
        pending={revoking !== null}
        onConfirm={() => { if (confirming) void revoke(confirming); }}
      >
        {confirming ? <span className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-foreground">{deviceName(confirming)}</span>
          <IdText value={confirming.pubkey} label={t("platform.devices.publicKey")} />
        </span> : null}
      </ConfirmDialog>
    </PageSection>
  );
}
