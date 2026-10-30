// DD-82：角色关系只从 BFF fresh 视图读取，授予/撤销仍经同一条 Governed Action。
// Web 与 Desktop 共用；Mobile 只读成员视图，不装载本管理面。
// DD-170 (.design/20 §16): the admin role page is two sections — administrator roles (a
// workspace scope, a member table and per-row actions) and workspaces (state, creation and
// lifecycle). Revocation, suspension and other risky changes confirm in a dialog; an UNKNOWN
// outcome keeps the original command and idempotency key until it is re-checked.

import { ActionDispatchState, ActionGateState, LegacySecretRefBindingKind, WorkspaceChannelCreateChannelType, RoleWorkspacePageCreateActionKey, WorkspaceLifecycleActionKey, WorkspaceState, type ActionCommand, type ActionSubmission, type LegacySecretRefBinding, type LegacySecretRefPage, type RoleMemberPage, type RoleMemberView, type RoleWorkspacePage, type RoleWorkspaceView } from "@client-kit/contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { newIdempotencyKey, taskPhase } from "../governance";
import { enumLabel, workspaceStateMessages } from "../i18n";
import { TransportError, type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { Badge, Button, Notice, type Tone } from "./ui";
import { useLoad } from "./use-load";
import type { BffClient } from "../client";
import { Input } from "./composer/shared/ui/input";
import { Button as ChannelButton } from "./profile/buzz/shared/ui/button";
import { cn } from "./profile/buzz/shared/lib/cn";
import { ChannelTypeSettings, DEFAULT_EPHEMERAL_TTL_SECONDS } from "./channel-type-settings";
import { WorkspaceVisibility } from "@client-kit/contracts";
import { ChannelPermissionsSettings } from "./channel-permissions-settings";
import { CellStack, DataTable, type DataColumn } from "./data-table";
import { EmptyState, ErrorState, PermissionState, readRefusal, TableSkeleton } from "./state-views";
import { IdText, KeyValueList, shortId, Tag } from "./key-value";
import { ConfirmDialog } from "./confirm-dialog";
import { PageSection, RefreshButton } from "./page-layout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./sidebar/dropdown-menu";

// immediate: the original control submits on click; a confirmation card only returns
// for an UNKNOWN outcome, where the same command and idempotency key must be retried.
type Change = { command: ActionCommand; principal: Pick<RoleMemberView,"principalId"|"displayName">; label: string; immediate?: boolean };
type Outcome =
  | { kind: "submitted"; action: string; execution: string }
  | { kind: "failed"; failure: WriteFailure };

/** The brand-filled primary action of a section (at most one per section, DD-170 §16.2(4)). */
export const PRIMARY_ACTION_CLASS = "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground";

export type RowAction = { key: string; label: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string };

/**
 * DD-170 §16.2(6): the trailing "more" menu of an admin table row. Risky actions are listed
 * last, after a separator and in the danger colour; each opens its own confirmation.
 */
export function RowActionsMenu({ name, actions, disabled }: { name: string; actions: readonly RowAction[]; disabled?: boolean }) {
  const t = useT();
  if (actions.length === 0) return null;
  const safe = actions.filter((item) => !item.danger);
  const risky = actions.filter((item) => item.danger);
  const item = (action: RowAction) => <DropdownMenuItem key={action.key} disabled={action.disabled} title={action.hint}
    className={action.danger ? "text-danger-text focus:text-danger-text" : undefined} onSelect={action.onSelect}>{action.label}</DropdownMenuItem>;
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={t("adminArea.rowActions", { name })} title={t("adminArea.rowActions", { name })} disabled={disabled}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40">
        <MoreHorizontal aria-hidden className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {safe.map(item)}
      {safe.length > 0 && risky.length > 0 ? <DropdownMenuSeparator /> : null}
      {risky.map(item)}
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** A page-level outcome line: recorded (status) or refused/unknown (alert), with an optional re-check. */
export function OutcomeNotice({ tone, children, action, testId }: { tone: "status" | "alert"; children: ReactNode; action?: ReactNode; testId?: string }) {
  return <div role={tone} data-testid={testId}
    className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border px-4 py-3 text-sm ${tone === "alert" ? "border-warning/40 bg-warning-soft/40 text-foreground" : "border-border bg-muted/40 text-foreground"}`}>
    <div className="min-w-0 break-words">{children}</div>
    {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
  </div>;
}

/** The note an UNKNOWN outcome adds to its confirmation dialog. */
export function UnknownInDialog({ operation }: { operation?: string }) {
  const t = useT();
  return <div role="alert" className="mt-1 flex flex-col gap-1.5 rounded-lg border border-warning/40 bg-warning-soft/40 px-3 py-2 text-sm text-foreground">
    <span>{t("adminArea.unknownInDialog")}</span>
    {operation ? <span className="flex items-center gap-2 text-xs text-muted-foreground">{t("adminArea.operation")}<IdText value={operation} label={t("adminArea.operation")} /></span> : null}
  </div>;
}

const workspaceTone = (state: WorkspaceState): Tone => state === WorkspaceState.Active ? "positive"
  : state === WorkspaceState.Error ? "negative"
  : state === WorkspaceState.Suspended ? "neutral" : "info";

type WorkspaceDirectory = { workspaces: RoleWorkspaceView[]; createActionKey?: RoleWorkspacePageCreateActionKey; complete: boolean };

function validRoleWorkspacePage(data: RoleWorkspacePage, offset: number): boolean {
  return !!data && Array.isArray(data.workspaces)
    && data.workspaces.every((w) => w && typeof w.id === "string" && typeof w.name === "string"
      && Object.values(WorkspaceState).includes(w.state)
      && (w.lifecycleActionKey === undefined
        || Object.values(WorkspaceLifecycleActionKey).includes(w.lifecycleActionKey)))
    && (data.createActionKey === undefined || data.createActionKey === RoleWorkspacePageCreateActionKey.WorkspaceCreate)
    && (data.nextOffset === undefined || (Number.isSafeInteger(data.nextOffset) && data.nextOffset > offset));
}

/** DD-170 §16.2(3): the offset-paged workspace directory is read to its end (bounded per round). */
async function loadWorkspaceDirectory(client: BffClient, pages: number): Promise<WorkspaceDirectory> {
  const workspaces: RoleWorkspaceView[] = [];
  const seen = new Set<string>();
  let createActionKey: RoleWorkspacePageCreateActionKey | undefined;
  let offset = 0;
  for (let index = 0; index < pages; index++) {
    const page = await client.roleWorkspaces(offset);
    if (!validRoleWorkspacePage(page, offset)) throw new TransportError("Invalid workspace page");
    if (index === 0) createActionKey = page.createActionKey;
    for (const workspace of page.workspaces) {
      if (seen.has(workspace.id)) throw new TransportError("Repeated workspace");
      seen.add(workspace.id); workspaces.push(workspace);
    }
    if (page.nextOffset === undefined) return { workspaces, createActionKey, complete: true };
    offset = page.nextOffset;
  }
  return { workspaces, createActionKey, complete: false };
}

/** Workspace 的 manage 权限不依赖频道 membership；选择列表单独从 BFF 取。 */
export function RoleManagement() {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const [budget, setBudget] = useState(10);
  const [state, reload] = useLoad(`role-workspaces:${budget}`, () => loadWorkspaceDirectory(client, budget), { keepWhileRevalidating: true });
  const [chosen, setChosen] = useState<string | null>(null);
  const [rolesRound, setRolesRound] = useState(0);
  const directory = state.status === "ok" ? state.data : null;
  const selected = directory?.workspaces.find((w) => w.id === chosen) ?? directory?.workspaces[0];
  // 暂停中、已暂停与恢复中的 Workspace 只在此处显示状态与恢复入口；它的 Workspace
  // scope 不可进入，角色视图退回 Tenant 级。
  const roleScope = selected?.state === WorkspaceState.Active ? selected.id : undefined;
  // 创建与暂停/恢复意图不属于列表：刷新、分页或读取失败不能卸载它、丢掉幂等键。
  const create = useWorkspaceCreate(directory?.createActionKey);
  const lifecycle = useWorkspaceLifecycle(reload);
  const [creating, setCreating] = useState(false);
  const createHeld = create.command !== null || create.busy;
  const showForm = creating || createHeld;
  const canCreate = !!directory?.createActionKey;
  const refreshAll = () => { reload(); setRolesRound((n) => n + 1); };

  const columns: DataColumn<RoleWorkspaceView>[] = [
    { key: "name", header: t("adminArea.workspaces.name"), sortValue: (w) => w.name.toLocaleLowerCase(), truncate: true, title: (w) => w.name,
      cell: (w) => <span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium">{w.name}</span>
        {w.id === selected?.id ? <Tag tone="brand">{t("adminArea.workspaces.selected")}</Tag> : null}</span> },
    { key: "state", header: t("platform.state"), width: "10rem", sortValue: (w) => enumLabel(locale, workspaceStateMessages, w.state),
      cell: (w) => <span data-testid="workspace-state"><Badge tone={workspaceTone(w.state)}>{enumLabel(locale, workspaceStateMessages, w.state)}</Badge></span> },
  ];
  const workspaceActions = (w: RoleWorkspaceView): RowAction[] => [
    ...(w.state === WorkspaceState.Active && w.id !== selected?.id
      ? [{ key: "roles", label: t("adminArea.workspaces.manageRoles"), onSelect: () => setChosen(w.id) }] : []),
    ...(w.lifecycleActionKey ? [{
      key: "lifecycle",
      label: w.lifecycleActionKey === WorkspaceLifecycleActionKey.WorkspaceSuspend ? t("workspace.lifecycle.suspend") : t("workspace.lifecycle.restore"),
      danger: w.lifecycleActionKey === WorkspaceLifecycleActionKey.WorkspaceSuspend,
      onSelect: () => lifecycle.choose(w),
    }] : []),
  ];

  const loadState = state.status === "pending" ? <TableSkeleton rows={4} columns={3} />
    : state.status === "error" ? readRefusal(state.error) === "denied"
      ? <PermissionState description={t("adminArea.roles.deniedBody")} />
      : <ErrorState error={state.error} onRetry={reload} />
    : null;

  return (
    <div className="flex flex-col gap-10" data-testid="role-management">
      <PageSection id="admin-roles" title={t("roles.title")} description={t("adminArea.roles.description")}>
        {loadState ?? <>
          {selected && !roleScope ? (
            <p role="status" className="text-sm text-muted-foreground" data-testid="role-scope-tenant">
              {t("roles.scopeTenantOnly", { name: selected.name })}
            </p>
          ) : null}
          <RoleMembers key={roleScope ?? "tenant"} revision={rolesRound} workspaceId={roleScope} workspaceName={roleScope ? selected?.name : undefined}
            toolbar={<>
              {directory && directory.workspaces.length > 0 ? <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span className="whitespace-nowrap">{t("adminArea.roles.scope")}</span>
                <select aria-label={t("platform.workspace")} value={selected?.id ?? ""} onChange={(event) => setChosen(event.target.value)}
                  className="h-8 max-w-[14rem] truncate rounded-lg border border-input bg-background px-2.5 text-sm text-foreground shadow-xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                  {directory.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </label> : null}
              <RefreshButton onClick={refreshAll} />
            </>} />
        </>}
      </PageSection>

      <PageSection id="admin-workspaces" title={t("adminArea.workspaces.title")} description={t("adminArea.workspaces.description")}
        actions={canCreate || createHeld ? <Button className={showForm ? undefined : PRIMARY_ACTION_CLASS} disabled={createHeld}
          aria-expanded={showForm} onClick={() => setCreating(!creating)}>
          {showForm ? t("platform.cancel") : t("workspace.create.title")}
        </Button> : undefined}>
        {showForm ? <div className="rounded-xl border border-border bg-card p-4" data-testid="workspace-create">
          <WorkspaceCreateForm state={create} />
        </div> : create.pendingCreates.length > 0 ? <p role="status" className="text-sm text-muted-foreground">
          {t("adminArea.workspaces.creating", { count: String(create.pendingCreates.length) })}
        </p> : null}
        <WorkspaceLifecycleOutcome lifecycle={lifecycle} />
        {loadState ?? (directory ? <DataTable label={t("adminArea.workspaces.listLabel")} rows={directory.workspaces} columns={columns}
          rowKey={(w) => w.id} selectedKey={selected?.id ?? null}
          onRowClick={(w) => { if (w.state === WorkspaceState.Active) setChosen(w.id); }}
          rowActions={(w) => <RowActionsMenu name={w.name} actions={workspaceActions(w)} disabled={lifecycle.locked} />} rowActionsWidth="3.5rem"
          search={{ placeholder: t("adminArea.workspaces.search"), text: (w) => `${w.name} ${enumLabel(locale, workspaceStateMessages, w.state)}` }}
          partial={directory.complete ? undefined : <button type="button" className="text-brand-text hover:underline" onClick={() => setBudget((n) => n + 10)}>
            {t("list.partial", { count: String(directory.workspaces.length) })} · {t("list.loadMore")}</button>}
          empty={<EmptyState title={t("adminArea.workspaces.emptyTitle")} description={t("adminArea.workspaces.emptyBody")} />} /> : null)}
      </PageSection>
      <WorkspaceLifecycleDialog lifecycle={lifecycle} />
    </div>
  );
}

/** 沿用已登记的 workspace.create；受理回应不代表 Channel/权限投影已完成。 */
export function useWorkspaceCreate(actionKey?: RoleWorkspacePageCreateActionKey, channelType?: WorkspaceChannelCreateChannelType, form?: {active: boolean; initialName?: string}) {
  const client = useBffClient();
  const t = useT();
  const inFlight = useRef(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState(WorkspaceVisibility.Private);
  const [temporary, setTemporary] = useState(false);
  const [ttlSeconds, setTtlSeconds] = useState(DEFAULT_EPHEMERAL_TTL_SECONDS);
  const [command, setCommand] = useState<ActionCommand | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WriteFailure | null>(null);
  const [submission, setSubmission] = useState<ActionSubmission | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const wasActive = useRef(false);
  const active = form?.active ?? false;
  const initialName = form?.initialName ?? "";
  // Original useCreateChannelForm resets a fresh opening, never an unresolved
  // governed intent. Browser and standalone dialog consume the same form.
  useEffect(() => {
    const opening = active && !wasActive.current;
    wasActive.current = active;
    if (!opening || busy || command) return;
    setName(initialName); setDescription(""); setVisibility(WorkspaceVisibility.Open);
    setTemporary(false); setTtlSeconds(DEFAULT_EPHEMERAL_TTL_SECONDS);
    setFailure(null); setSubmission(null);
  }, [active, initialName, busy, command]);
  useEffect(() => {
    if (!active || !actionKey || command) return;
    const frame = window.requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement && document.activeElement.closest("#create-channel-form")) return;
      const input = nameInputRef.current;
      if (!input) return;
      input.focus(); input.setSelectionRange(input.value.length, input.value.length);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, actionKey, command]);
  const locked = !actionKey || busy || command !== null;
  // 页面刷新或离开后本地幂等键不复存在；服务端按本人列出的 ActionExecution 才是意图的
  // 权威。尚无结论（taskPhase 中性）的 workspace.create 在此列出，避免用户以为请求丢了
  // 而盲目再发一笔；同名标识的重复创建由 Core 的唯一约束以冲突拒绝。
  const [openTasks, reloadOpenTasks] = useLoad("workspace-create-in-flight", () => client.tasks());
  const pendingCreates = openTasks.status === "ok" && Array.isArray(openTasks.data)
    ? openTasks.data.filter((task) => task.actionKey === RoleWorkspacePageCreateActionKey.WorkspaceCreate
      && taskPhase(task).tone === "neutral")
    : [];

  const submit = async () => {
    if (!actionKey || inFlight.current || (!command && (!name.trim() || (channelType === undefined && !slug.trim())))) return;
    const idempotencyKey = command?.idempotencyKey ?? newIdempotencyKey();
    // The original channel form has no infrastructure slug field. Use its existing
    // stable creation intent key; management forms may still choose a readable slug.
    const intent = command ?? { actionKey, idempotencyKey, name: name.trim(), slug: channelType === undefined ? slug.trim() : idempotencyKey,
      workspaceVisibility: visibility,
      workspaceChannel: { channelType: channelType ?? WorkspaceChannelCreateChannelType.Stream, ...(description.trim() ? { description: description.trim() } : {}), ...(temporary ? { ttlSeconds } : {}) } };
    inFlight.current = true;
    setCommand(intent);
    setBusy(true);
    setFailure(null);
    setSubmission(null);
    try {
      const result = await client.submitAction(intent);
      if (!result || result.actionKey !== intent.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState))
        throw new TransportError(t("platform.loadFailed"));
      setSubmission(result);
      // 已取得服务端操作引用，后续终态由任务页读取。清空输入，不把旧意图再发一笔。
      setCommand(null);
      setName("");
      setSlug("");
      setDescription("");
      setVisibility(channelType === undefined ? WorkspaceVisibility.Private : WorkspaceVisibility.Open);
      setTemporary(false);
      setTtlSeconds(DEFAULT_EPHEMERAL_TTL_SECONDS);
    } catch (error) {
      const failed = writeFailure(error);
      setFailure(failed);
      // 结果不明保留原命令与幂等键；明确拒绝才允许修正输入重新提交。
      if (failed.kind !== "unknown") setCommand(null);
    } finally {
      inFlight.current = false;
      setBusy(false);
      reloadOpenTasks();
    }
  };

  return { actionKey, name, setName, slug, setSlug, description, setDescription, visibility, setVisibility, temporary, setTemporary, ttlSeconds, setTtlSeconds, channelType, command, busy, failure, submission,
    locked, openTasks, pendingCreates, reloadOpenTasks, submit, nameInputRef };
}

/** The existing workspace.create command and UNKNOWN intent are shared by both hosts. */
export type WorkspaceCreateState = ReturnType<typeof useWorkspaceCreate>;

/** Original creation intent renderer; the channel dialog changes presentation, not admission. */
// Buzz 779af8886caae1317b4de962082429867ab61503:
// desktop/src/features/channels/ui/channelFormStyles.ts.
export const CHANNEL_FORM_FIELD_SHELL_CLASS = "rounded-xl border border-input bg-muted/40 transition-colors duration-150 ease-out hover:border-muted-foreground/40 focus-within:border-muted-foreground/50";
export const CHANNEL_FORM_FIELD_CONTROL_CLASS = "border-0 bg-transparent text-foreground shadow-none outline-none ring-0 transition-colors duration-150 ease-out placeholder:text-muted-foreground/55 focus:bg-transparent focus:text-foreground focus:outline-hidden focus-visible:ring-0";
const CREATE_CHANNEL_FORM_ID = "create-channel-form";

// Original CreateChannelFormFooter lives outside the scrolling form body.
export function WorkspaceCreateFormFooter({state}: {state: WorkspaceCreateState}) {
  const t = useT();
  const entity = t(state.channelType === WorkspaceChannelCreateChannelType.Forum ? "channel.browser.forum" : "channel.browser.channel");
  return <div className="flex w-full items-center justify-end gap-3">
    <ChannelButton data-testid="create-channel-submit" form={CREATE_CHANNEL_FORM_ID} type="submit"
      disabled={!state.actionKey || state.busy || (!state.command && !state.name.trim())}>
      {state.busy ? t("channel.create.creating") : state.command ? t("workspace.create.retry") : t("channel.browser.create", {entity})}
    </ChannelButton>
  </div>;
}

export function WorkspaceCreateForm({ state, channel = false }: { state: WorkspaceCreateState; channel?: boolean }) {
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const { actionKey, name, setName, slug, setSlug, description, setDescription, command, busy, failure, submission,
    locked, openTasks, pendingCreates, reloadOpenTasks, submit } = state;
  const entity = t(state.channelType === WorkspaceChannelCreateChannelType.Forum ? "channel.browser.forum" : "channel.browser.channel");
  return (
    <form className={channel ? "space-y-5" : "flex flex-col gap-4"} id={channel ? CREATE_CHANNEL_FORM_ID : undefined} data-testid={channel ? "create-channel-form" : undefined} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {!channel ? <h3 className="text-sm font-semibold text-foreground">{t("workspace.create.title")}</h3> : null}
      <div className={channel ? "space-y-1.5" : "flex flex-col gap-1 text-sm"}>
        <label className={channel ? "text-sm font-medium text-foreground" : undefined} htmlFor={channel ? "create-channel-name" : "create-workspace-name"}>{t(channel ? "channel.create.name" : "workspace.create.name")}</label>
        <div className={channel ? cn("flex min-h-11 items-center px-3", CHANNEL_FORM_FIELD_SHELL_CLASS) : undefined}>
          <Input required autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
            id={channel ? "create-channel-name" : "create-workspace-name"} ref={channel ? state.nameInputRef : undefined}
            placeholder={channel ? t(state.channelType === WorkspaceChannelCreateChannelType.Forum ? "channel.create.forumNamePlaceholder" : "channel.create.namePlaceholder") : undefined}
            disabled={locked} data-testid={channel ? "create-channel-name" : undefined} value={name} onChange={(event) => setName(event.target.value)} className={channel ? cn("h-8 px-0 py-0 leading-6", CHANNEL_FORM_FIELD_CONTROL_CLASS) : "h-8 rounded-md border border-input bg-transparent px-2 text-sm"} />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-foreground" htmlFor="create-channel-description">
          {t("channel.create.about")}<span className="ml-1 text-xs font-normal text-muted-foreground/50">{t("channel.create.optional")}</span>
        </label>
        <div className={CHANNEL_FORM_FIELD_SHELL_CLASS}>
          <textarea autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className={cn("flex min-h-20 w-full rounded-lg border border-input/40 bg-background px-3 py-2 text-base transition-colors placeholder:text-muted-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm", "min-h-20 resize-none px-3 py-3 leading-5", CHANNEL_FORM_FIELD_CONTROL_CLASS)}
            data-testid="create-channel-description" id="create-channel-description" rows={2} placeholder={channel ? t("channel.create.aboutPlaceholder", {entity}) : undefined}
            disabled={locked} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
      </div>
      {!channel ? <label className="flex flex-col gap-1 text-sm">
        {t("workspace.create.slug")}
        <input required disabled={locked} value={slug} onChange={(event) => setSlug(event.target.value)} className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" />
        <span className="text-xs text-muted-foreground">{t("workspace.create.slugHint")}</span>
      </label> : null}
      {channel ? <ChannelTypeSettings disabled={locked} temporary={state.temporary} ttlSeconds={state.ttlSeconds}
        onTemporaryChange={state.setTemporary} onTtlSecondsChange={state.setTtlSeconds} /> : null}
      <ChannelPermissionsSettings disabled={locked} visibility={state.visibility} onVisibilityChange={state.setVisibility} testIdPrefix="create-channel" variant="segmented" />
      {submission ? (
        <div role="status" className="break-words text-sm">
          <p>{t("workspace.create.recorded", { execution: submission.actionExecutionId, operation: submission.operationId, gate: submission.gateState, dispatch: submission.dispatchState })}</p>
          {submission.reason ? <p>{reasonText(submission.reason)}</p> : null}
        </div>
      ) : null}
      {!channel ? <Button type="submit" className={`w-fit ${PRIMARY_ACTION_CLASS}`} disabled={!actionKey || busy || (!command && (!name.trim() || !slug.trim()))}>
        {busy ? t("platform.loading") : command ? t("workspace.create.retry") : t("workspace.create.title")}
      </Button> : null}
      {openTasks.status === "error" ? (
        <Notice role="alert">
          {t("workspace.create.inFlightUnavailable")}
          <Button onClick={reloadOpenTasks}>{t("platform.retry")}</Button>
        </Notice>
      ) : pendingCreates.length > 0 ? (
        <div role="status" className="flex flex-col gap-1 text-sm">
          <p className="font-medium">{t("workspace.create.inFlight")}</p>
          {pendingCreates.map((task) => (
            <p key={task.actionExecutionId} className="break-words">
              {t("workspace.create.inFlightItem", { status: t(taskPhase(task).label), operation: task.operationId })}
            </p>
          ))}
        </div>
      ) : null}
      {failure ? <p role="alert" className="text-sm">
        {failure.kind === "unknown"
          ? t("workspace.create.unknown", { operation: failure.operationId ?? "—" })
          : t("roles.rejected", { reason: failureText(failure) })}
      </p> : null}
    </form>
  );
}

type LifecycleIntent = { command: ActionCommand; name: string };
type LifecycleOutcome =
  | { kind: "recorded"; operation: string }
  | { kind: "aborted"; operation: string; reason: string }
  | { kind: "unknown"; operation?: string }
  | { kind: "rejected"; reason: string };

/**
 * `.design/06` §7.3：暂停与恢复从 Tenant scope 发起。入口只在 BFF 按当前事实给出动作
 * 键时出现，提交仍由 Core 重新准入；受理回应只说明已登记，终态到任务页查看。意图属于页面，
 * 不属于对话框：结果不明时关闭对话框也不放下原命令与幂等键。
 */
function useWorkspaceLifecycle(onRecorded: () => void) {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const reasonText = useReasonText();
  const inFlight = useRef(false);
  const [intent, setIntent] = useState<LifecycleIntent | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<LifecycleOutcome | null>(null);
  const unknown = outcome?.kind === "unknown";

  const submit = async () => {
    if (!intent || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await client.submitAction(intent.command);
      if (!result || result.actionKey !== intent.command.actionKey
        || typeof result.actionExecutionId !== "string" || !result.actionExecutionId
        || typeof result.operationId !== "string" || !result.operationId
        || !Object.values(ActionGateState).includes(result.gateState)
        || !Object.values(ActionDispatchState).includes(result.dispatchState))
        throw new TransportError(t("platform.loadFailed"));
      if (result.gateState === ActionGateState.Allowed && result.dispatchState === ActionDispatchState.Dispatched) {
        // 已派发只说明已登记，终态到任务页查看
        setOutcome({ kind: "recorded", operation: result.operationId });
        setIntent(null); setOpen(false);
        onRecorded();
      } else if (result.dispatchState === ActionDispatchState.Aborted) {
        setOutcome({ kind: "aborted", operation: result.operationId, reason: result.reason ? reasonText(result.reason) : result.dispatchState });
        setIntent(null); setOpen(false);
        onRecorded();
      } else {
        // 未派发或派发结果不明：保留原命令与幂等键，只允许重查原请求
        setOutcome({ kind: "unknown", operation: result.operationId });
      }
    } catch (error) {
      const failed = writeFailure(error);
      if (failed.kind === "unknown") {
        setOutcome({ kind: "unknown", operation: failed.operationId });
      } else {
        // 明确拒绝才放下这次意图
        setOutcome({ kind: "rejected", reason: failureText(failed) });
        setIntent(null); setOpen(false);
        onRecorded();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return {
    intent, open, busy, outcome, unknown, submit,
    locked: intent !== null || busy,
    choose: (target: RoleWorkspaceView) => {
      const key = target.lifecycleActionKey;
      if (!key || intent || inFlight.current) return;
      setOutcome(null);
      setIntent({ command: { actionKey: key, idempotencyKey: newIdempotencyKey(), workspaceId: target.id }, name: target.name });
      setOpen(true);
    },
    reopen: () => { if (intent) setOpen(true); },
    close: () => {
      if (busy) return;
      setOpen(false);
      // Only a request that has not been sent, or was definitively refused, may be dropped.
      if (!unknown) setIntent(null);
    },
  };
}

function WorkspaceLifecycleDialog({ lifecycle }: { lifecycle: ReturnType<typeof useWorkspaceLifecycle> }) {
  const t = useT();
  const { intent, unknown, busy, outcome } = lifecycle;
  const suspend = intent?.command.actionKey === WorkspaceLifecycleActionKey.WorkspaceSuspend;
  return <ConfirmDialog open={lifecycle.open && intent !== null} onOpenChange={(next) => { if (!next) lifecycle.close(); }}
    testId="workspace-lifecycle-dialog" tone={suspend ? "danger" : "default"} pending={busy}
    title={intent ? t(suspend ? "adminArea.workspaces.suspendTitle" : "adminArea.workspaces.restoreTitle", { name: intent.name }) : ""}
    description={t(suspend ? "adminArea.workspaces.suspendBody" : "adminArea.workspaces.restoreBody")}
    confirmLabel={unknown ? t("workspace.lifecycle.retry") : t(suspend ? "workspace.lifecycle.suspend" : "workspace.lifecycle.restore")}
    onConfirm={() => void lifecycle.submit()}>
    {unknown ? <UnknownInDialog operation={outcome?.kind === "unknown" ? outcome.operation : undefined} /> : null}
  </ConfirmDialog>;
}

function WorkspaceLifecycleOutcome({ lifecycle }: { lifecycle: ReturnType<typeof useWorkspaceLifecycle> }) {
  const t = useT();
  const { outcome, busy } = lifecycle;
  if (!outcome) return null;
  return <div data-testid="workspace-lifecycle">
    {outcome.kind === "recorded" ? <OutcomeNotice tone="status">{t("workspace.lifecycle.recorded", { operation: outcome.operation })}</OutcomeNotice>
      : <OutcomeNotice tone="alert" action={outcome.kind === "unknown" ? <Button disabled={busy} onClick={() => void lifecycle.submit()}>{t("workspace.lifecycle.retry")}</Button> : undefined}>
        {outcome.kind === "unknown"
          ? t("workspace.lifecycle.unknown", { operation: outcome.operation ?? "—" })
          : outcome.kind === "aborted"
            ? t("workspace.lifecycle.aborted", { reason: outcome.reason, operation: outcome.operation })
            : t("workspace.lifecycle.rejected", { reason: outcome.reason })}
      </OutcomeNotice>}
  </div>;
}

/** Original role submission state, shared by the table and native member-row menu. */
export function useMemberAction(onRecorded:()=>void) {
  const client = useBffClient();
  const t = useT();
  const inFlight=useRef(false);
  const receipt=useRef<ActionSubmission|null>(null);
  const [confirming, setConfirming] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [submittedFor, setSubmittedFor] = useState<string | null>(null);
  const execute = async (change: Change) => {
    if (inFlight.current) return;
    const wasUnknown=outcome?.kind==="failed"&&outcome.failure.kind==="unknown";
    const priorOperation=outcome?.kind==="failed"&&outcome.failure.kind==="unknown"?outcome.failure.operationId:undefined;
    const { command, principal } = change;
    inFlight.current=true;
    setBusy(true);
    if(!wasUnknown)setOutcome(null);
    try {
      const result = await client.submitAction(command);
      if (!result || result.actionKey!==command.actionKey || !result.actionExecutionId || !result.operationId
        || (priorOperation&&result.operationId!==priorOperation)
        || (receipt.current&&(result.operationId!==receipt.current.operationId||result.actionExecutionId!==receipt.current.actionExecutionId))
        || !Object.values(ActionGateState).includes(result.gateState) || !Object.values(ActionDispatchState).includes(result.dispatchState))
        throw new TransportError(t("platform.loadFailed"));
      receipt.current=result;
      if(result.dispatchState===ActionDispatchState.Unknown||result.gateState===ActionGateState.Evaluating
        ||(result.gateState===ActionGateState.Allowed&&result.dispatchState===ActionDispatchState.NotDispatched)) {
        setOutcome({kind:"failed",failure:{kind:"unknown",operationId:result.operationId}});
        return;
      }
      setSubmittedFor(principal.principalId);
      setOutcome({ kind: "submitted", action: change.label, execution: result.actionExecutionId });
      setConfirming(null);
      receipt.current=null;
    } catch (error) {
      // Later admission refusal says nothing about the original uncertain write.
      if(!wasUnknown){
        const failure = writeFailure(error);
        setOutcome({ kind: "failed", failure });
        if (failure.kind !== "unknown") {setConfirming(null);receipt.current=null;}
      }
    } finally {
      inFlight.current=false;
      setBusy(false);
      onRecorded();
    }
  };
  const intend=(key:string,principal:Change["principal"],label:string,workspaceId:string|undefined,immediate:boolean):Change|null=>{
    if(busy||confirming||inFlight.current)return null;
    receipt.current=null;
    setOutcome(null);
    const change:Change={principal,label,immediate,command:{actionKey:key,principalId:principal.principalId,idempotencyKey:newIdempotencyKey(),
      ...(key.startsWith("workspace.")?{workspaceId}: {})}};
    setConfirming(change);
    return change;
  };
  return {confirming,busy,outcome,submittedFor,
    submit:async()=>{if(confirming)await execute(confirming);},
    refresh:()=>{setSubmittedFor(null);onRecorded();},
    cancel:()=>{if(!busy&&!(outcome?.kind==="failed"&&outcome.failure.kind==="unknown"))setConfirming(null);},
    choose:(key:string,principal:Change["principal"],label:string,workspaceId?:string)=>{intend(key,principal,label,workspaceId,false);},
    perform:(key:string,principal:Change["principal"],label:string,workspaceId?:string)=>{
      const change=intend(key,principal,label,workspaceId,true);
      if(change)void execute(change);
    }};
}

export function MemberActionFeedback({action}:{action:ReturnType<typeof useMemberAction>}) {
  const t=useT();const failureText=useFailureText();const {outcome,confirming,busy}=action;
  return <>
    {outcome?.kind==="submitted"?<Button className="w-fit" onClick={action.refresh}>{t("platform.refresh")}</Button>:null}
    {outcome?<p role="alert">{outcome.kind==="submitted"
      ?t("roles.submitted",{action:outcome.action,execution:outcome.execution})
      :outcome.failure.kind==="unknown"?t("roles.unknown",{operation:outcome.failure.operationId??"—"})
      :t("members.rejected",{reason:failureText(outcome.failure)})}</p>:null}
    {confirming&&(!confirming.immediate||(outcome?.kind==="failed"&&outcome.failure.kind==="unknown"))?<div className="flex flex-col gap-2 rounded-md border p-3" role="group">
      <p>{t("roles.confirm",{action:confirming.label,member:confirming.principal.displayName})}</p>
      <code className="text-xs text-muted-foreground">{confirming.command.actionKey}</code>
      <div className="flex gap-2"><Button disabled={busy} onClick={()=>void action.submit()}>{t("platform.confirm")}</Button>
        {outcome?.kind==="failed"&&outcome.failure.kind==="unknown"?null:<Button disabled={busy} onClick={action.cancel}>{t("platform.cancel")}</Button>}
      </div>
    </div>:null}
  </>;
}

export function validRoleMemberPage(page:RoleMemberPage):boolean {
  return !!page&&Array.isArray(page.members)&&page.members.every(m=>m&&typeof m.principalId==="string"
    &&typeof m.displayName==="string"&&typeof m.tenantAdmin==="boolean"&&typeof m.workspaceAdmin==="boolean"
    &&typeof m.lastTenantAdmin==="boolean"&&typeof m.canGrantTenantAdmin==="boolean"&&typeof m.canRevokeTenantAdmin==="boolean"
    &&typeof m.canGrantWorkspaceAdmin==="boolean"&&typeof m.canRevokeWorkspaceAdmin==="boolean"
    &&(m.canRemoveFromWorkspace===undefined||typeof m.canRemoveFromWorkspace==="boolean")
    &&(m.canRemoveFromTenant===undefined||typeof m.canRemoveFromTenant==="boolean")
    &&(m.createdAt===undefined||typeof m.createdAt==="string"&&Number.isFinite(Date.parse(m.createdAt)))
    &&(m.pubkeys===undefined||Array.isArray(m.pubkeys)&&m.pubkeys.every(key=>typeof key==="string"&&/^[0-9a-f]{64}$/.test(key))))
    &&(page.nextCursor===undefined||typeof page.nextCursor==="string"&&page.nextCursor.length>0);
}

/** The existing complete role projection, shared by Workspace rows and the
 * original Tenant card. No partial page is exposed after a failed read. */
export async function loadRoleMemberDirectory(client:BffClient,workspaceId?:string):Promise<Map<string,RoleMemberView>> {
  const members=new Map<string,RoleMemberView>();const cursors=new Set<string>();let cursor:string|undefined;
  do {
    const page=await client.roleMembers(workspaceId,cursor);
    if(!validRoleMemberPage(page))throw new TransportError("Invalid member action projection");
    for(const member of page.members){
      if(members.has(member.principalId))throw new TransportError("Repeated member action identity");
      members.set(member.principalId,member);
    }
    cursor=page.nextCursor;
    if(cursor){if(cursors.has(cursor))throw new TransportError("Repeated member action cursor");cursors.add(cursor);}
  }while(cursor);
  return members;
}

const ROLE_KEYS = {
  grantOrg: "tenant.admin.grant", revokeOrg: "tenant.admin.revoke",
  grantWorkspace: "workspace.admin.grant", revokeWorkspace: "workspace.admin.revoke",
} as const;

function RoleCell({ granted, children }: { granted: boolean; children?: ReactNode }) {
  const t = useT();
  return <span className="flex min-w-0 items-center gap-1.5">
    {granted ? <Badge tone="positive">{t("adminArea.roles.granted")}</Badge>
      : <span className="whitespace-nowrap text-muted-foreground">{t("adminArea.roles.notGranted")}</span>}
    {children}
  </span>;
}

/**
 * The administrator-role table of one scope: the organization, plus one active workspace when
 * given. Every row action is the existing governed role command; the dialog names the member
 * and the role, and an UNKNOWN outcome can only be re-checked with the same command.
 */
export function RoleMembers({ workspaceId, workspaceName, toolbar, revision = 0 }: {
  workspaceId?: string;
  workspaceName?: string;
  /** Scope picker and refresh, drawn at the end of the table toolbar. */
  toolbar?: ReactNode;
  /** Bumped by the page's refresh; re-reads without unmounting a pending role change. */
  revision?: number;
}) {
  const client = useBffClient(); const t = useT(); const failureText = useFailureText();
  const [state, reload] = useLoad(`role-members:${workspaceId ?? "tenant"}`,
    async () => [...(await loadRoleMemberDirectory(client, workspaceId)).values()], { keepWhileRevalidating: true });
  const action = useMemberAction(reload);
  const [dialog, setDialog] = useState(false);
  const first = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the page's refresh counter re-reads
  useEffect(() => { if (first.current) { first.current = false; return; } action.refresh(); }, [revision]);
  const { busy, confirming, outcome, submittedFor } = action;
  const unknown = outcome?.kind === "failed" && outcome.failure.kind === "unknown";
  const ownToolbar = <>{toolbar ?? <RefreshButton onClick={action.refresh} />}</>;

  if (state.status === "pending") return <TableSkeleton rows={4} columns={workspaceId ? 4 : 3} />;
  if (state.status === "error") return readRefusal(state.error) === "denied"
    ? <PermissionState description={t("adminArea.roles.deniedBody")} />
    : <ErrorState error={state.error} onRetry={reload} />;

  const choose = (member: RoleMemberView, key: string, label: string) => {
    if (busy || confirming) return;
    action.choose(key, member, label, workspaceId);
    setDialog(true);
  };
  const actionsFor = (m: RoleMemberView): RowAction[] => {
    const out: RowAction[] = [];
    if (m.canGrantTenantAdmin) out.push({ key: "grantOrg", label: t("adminArea.roles.grantOrg"), onSelect: () => choose(m, ROLE_KEYS.grantOrg, t("adminArea.roles.grantOrg")) });
    if (workspaceId && m.canGrantWorkspaceAdmin) out.push({ key: "grantWorkspace", label: t("adminArea.roles.grantWorkspace"), onSelect: () => choose(m, ROLE_KEYS.grantWorkspace, t("adminArea.roles.grantWorkspace")) });
    if (m.canRevokeTenantAdmin) out.push({ key: "revokeOrg", danger: true, label: t("adminArea.roles.revokeOrg"), onSelect: () => choose(m, ROLE_KEYS.revokeOrg, t("adminArea.roles.revokeOrg")) });
    else if (m.lastTenantAdmin) out.push({ key: "revokeOrg", danger: true, disabled: true, hint: t("adminArea.roles.lastAdminHint"), label: t("adminArea.roles.revokeOrg"), onSelect: () => {} });
    if (workspaceId && m.canRevokeWorkspaceAdmin) out.push({ key: "revokeWorkspace", danger: true, label: t("adminArea.roles.revokeWorkspace"), onSelect: () => choose(m, ROLE_KEYS.revokeWorkspace, t("adminArea.roles.revokeWorkspace")) });
    return out;
  };
  const columns: DataColumn<RoleMemberView>[] = [
    { key: "member", header: t("platform.member"), sortValue: (m) => m.displayName.toLocaleLowerCase(), truncate: true, title: (m) => m.displayName,
      cell: (m) => <CellStack primary={m.displayName} /> },
    { key: "org", header: t("adminArea.roles.orgAdmin"), width: "13rem", sortValue: (m) => (m.tenantAdmin ? 0 : 1),
      cell: (m) => <RoleCell granted={m.tenantAdmin}>{m.lastTenantAdmin ? <Tag tone="warning" title={t("adminArea.roles.lastAdminHint")}>{t("adminArea.roles.lastAdminTag")}</Tag> : null}</RoleCell> },
    ...(workspaceId ? [{ key: "workspace", header: t("adminArea.roles.workspaceAdmin"), width: "11rem", sortValue: (m: RoleMemberView) => (m.workspaceAdmin ? 0 : 1),
      cell: (m: RoleMemberView) => <RoleCell granted={m.workspaceAdmin} /> }] : []),
  ];
  const key = confirming?.command.actionKey;
  const revoke = key === ROLE_KEYS.revokeOrg || key === ROLE_KEYS.revokeWorkspace;
  const member = confirming?.principal.displayName ?? "";
  const workspace = workspaceName ?? "";
  const title = key === ROLE_KEYS.grantOrg ? t("adminArea.roles.grantOrgTitle", { member })
    : key === ROLE_KEYS.revokeOrg ? t("adminArea.roles.revokeOrgTitle", { member })
    : key === ROLE_KEYS.grantWorkspace ? t("adminArea.roles.grantWorkspaceTitle", { member, workspace })
    : t("adminArea.roles.revokeWorkspaceTitle", { member, workspace });

  return (
    <div className="flex flex-col gap-3" data-testid="role-members">
      {outcome ? outcome.kind === "submitted"
        ? <OutcomeNotice tone="status">{t("adminArea.roles.submitted", { action: outcome.action })}</OutcomeNotice>
        : <OutcomeNotice tone="alert" action={unknown && confirming ? <Button disabled={busy} onClick={() => setDialog(true)}>{t("adminArea.reopen")}</Button> : undefined}>
          {outcome.failure.kind === "unknown" ? t("roles.unknown", { operation: outcome.failure.operationId ?? "—" })
            : t("roles.rejected", { reason: failureText(outcome.failure) })}
        </OutcomeNotice> : null}
      <DataTable label={t("adminArea.roles.listLabel")} rows={state.data} columns={columns} rowKey={(m) => m.principalId}
        search={{ placeholder: t("adminArea.roles.search"), text: (m) => m.displayName }} toolbar={ownToolbar}
        rowActions={(m) => <RowActionsMenu name={m.displayName} actions={actionsFor(m)} disabled={busy || confirming !== null || submittedFor === m.principalId} />}
        rowActionsWidth="3.5rem"
        empty={<EmptyState title={t("adminArea.roles.emptyTitle")} description={t("adminArea.roles.emptyBody")} />} />
      <ConfirmDialog open={dialog && confirming !== null} testId="role-change-dialog" pending={busy} tone={revoke ? "danger" : "default"}
        onOpenChange={(next) => { if (next) return; setDialog(false); if (!unknown) action.cancel(); }}
        title={title}
        description={t(revoke ? "adminArea.roles.revokeBody" : "adminArea.roles.grantBody", { member })}
        confirmLabel={unknown ? t("workspace.lifecycle.retry") : t(revoke ? "roles.revoke" : "roles.grant")}
        onConfirm={() => void action.submit()}>
        {unknown ? <UnknownInDialog operation={outcome?.kind === "failed" && outcome.failure.kind === "unknown" ? outcome.failure.operationId : undefined} /> : null}
      </ConfirmDialog>
    </div>
  );
}

type RehomeIntent = { binding: LegacySecretRefBinding; idempotencyKey: string };
type SecretDirectory = { bindings: LegacySecretRefBinding[]; complete: boolean };

function validLegacyPage(page: LegacySecretRefPage): boolean {
  return !!page && Array.isArray(page.bindings)
    && page.bindings.every((binding) => binding && typeof binding.principalId === "string"
      && typeof binding.pubkey === "string"
      && (binding.kind === LegacySecretRefBindingKind.Human || binding.kind === LegacySecretRefBindingKind.Control))
    && (page.nextCursor === undefined || /^[0-9a-fA-F]{64}$/.test(page.nextCursor));
}

/** DD-170 §16.2(3): the cursor-paged directory is read to its end, bounded per round. */
async function loadLegacyDirectory(client: BffClient, pages: number): Promise<SecretDirectory> {
  const bindings: LegacySecretRefBinding[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let index = 0; index < pages; index++) {
    const page = await client.legacySecretRefs(cursor);
    if (!validLegacyPage(page)) throw new TransportError("Invalid legacy identity page");
    bindings.push(...page.bindings);
    cursor = page.nextCursor;
    if (!cursor) return { bindings, complete: true };
    if (cursors.has(cursor)) throw new TransportError("Repeated legacy identity cursor");
    cursors.add(cursor);
  }
  return { bindings, complete: false };
}

/** DD-85：当前 Tenant 的管理者显式确认后，只提交受治理动作；不触碰私钥。 */
export function LegacySecretRefManagement() {
  const client = useBffClient();
  const t = useT();
  const failureText = useFailureText();
  const [budget, setBudget] = useState(10);
  const [state, reload] = useLoad(`legacy-secret-refs:${budget}`, () => loadLegacyDirectory(client, budget), { keepWhileRevalidating: true });
  const [intent, setIntent] = useState<RehomeIntent | null>(null);
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<
    | { kind: "submitted"; execution: string }
    | { kind: "failed"; failure: WriteFailure }
    | null
  >(null);
  const unknown = outcome?.kind === "failed" && outcome.failure.kind === "unknown";

  const submit = async () => {
    if (!intent || busy) return;
    setBusy(true);
    try {
      const result = await client.submitAction({
        actionKey: "identity.secret_ref.rehome",
        idempotencyKey: intent.idempotencyKey,
        principalId: intent.binding.principalId,
        explicitConfirmation: true,
      });
      setOutcome({ kind: "submitted", execution: result.actionExecutionId });
      setIntent(null); setDialog(false);
      reload();
    } catch (error) {
      const failure = writeFailure(error);
      setOutcome({ kind: "failed", failure });
      if (failure.kind !== "unknown") { setIntent(null); setDialog(false); }
    } finally {
      setBusy(false);
    }
  };

  const header = (body: ReactNode) => <PageSection id="admin-secrets" title={t("secretRehome.title")} description={t("adminArea.secrets.explain")}
    testId="legacy-secret-ref-management">{body}</PageSection>;
  // 无权或未进入发布注册表时说明原因，不留空白；其余错误保持可见且可重试。
  if (state.status === "error" && !intent && !outcome) {
    const refusal = readRefusal(state.error);
    if (refusal === "denied") return <PermissionState description={t("adminArea.secrets.deniedBody")} />;
    if (refusal === "missing") return <EmptyState title={t("adminArea.unavailableTitle")} description={t("adminArea.unavailableBody")} />;
  }
  const kindLabel = (binding: LegacySecretRefBinding) => t(binding.kind === LegacySecretRefBindingKind.Human ? "adminArea.secrets.kind.human" : "adminArea.secrets.kind.control");
  const columns: DataColumn<LegacySecretRefBinding>[] = [
    { key: "pubkey", header: t("secretRehome.pubkey"), cell: (binding) => <IdText value={binding.pubkey} label={t("secretRehome.pubkey")} />,
      sortValue: (binding) => binding.pubkey },
    { key: "kind", header: t("secretRehome.kind"), width: "10rem", sortValue: kindLabel, cell: (binding) => <Tag>{kindLabel(binding)}</Tag> },
  ];

  return header(<>
    {outcome ? outcome.kind === "submitted"
      ? <OutcomeNotice tone="status">{t("adminArea.secrets.submitted")}</OutcomeNotice>
      : <OutcomeNotice tone="alert" action={unknown && intent ? <Button disabled={busy} onClick={() => void submit()}>{t("workspace.lifecycle.retry")}</Button> : undefined}>
        {outcome.failure.kind === "unknown" ? t("adminArea.secrets.unknown") : t("secretRehome.rejected", { reason: failureText(outcome.failure) })}
      </OutcomeNotice> : null}
    {state.status === "pending" ? <TableSkeleton rows={3} columns={3} />
      : state.status === "error" ? <ErrorState error={state.error} onRetry={reload} />
      : <DataTable label={t("adminArea.secrets.listLabel")} rows={state.data.bindings} columns={columns} rowKey={(binding) => binding.pubkey}
        toolbar={<RefreshButton onClick={reload} />}
        rowActions={(binding) => <Button className="h-7 px-2.5 text-xs" disabled={busy || intent !== null} onClick={() => {
          setOutcome(null); setIntent({ binding, idempotencyKey: newIdempotencyKey() }); setDialog(true);
        }}>{t("secretRehome.move")}</Button>} rowActionsWidth="7.5rem"
        partial={state.data.complete ? undefined : <button type="button" className="text-brand-text hover:underline" onClick={() => setBudget((n) => n + 10)}>
          {t("list.partial", { count: String(state.data.bindings.length) })} · {t("list.loadMore")}</button>}
        empty={<EmptyState title={t("adminArea.secrets.emptyTitle")} description={t("adminArea.secrets.emptyBody")} />} />}
    <ConfirmDialog open={dialog && intent !== null} testId="secret-rehome-dialog" tone="default" pending={busy}
      onOpenChange={(next) => { if (next) return; setDialog(false); if (!unknown) setIntent(null); }}
      title={t("adminArea.secrets.moveTitle")}
      description={t("adminArea.secrets.moveBody", { pubkey: intent ? shortId(intent.binding.pubkey) : "" })}
      confirmLabel={unknown ? t("workspace.lifecycle.retry") : t("secretRehome.move")}
      onConfirm={() => void submit()}>
      {intent ? <KeyValueList items={[
        { id: "pubkey", label: t("secretRehome.pubkey"), value: <IdText value={intent.binding.pubkey} full label={t("secretRehome.pubkey")} /> },
        { id: "kind", label: t("secretRehome.kind"), value: kindLabel(intent.binding) },
      ]} /> : null}
      {unknown ? <UnknownInDialog operation={outcome?.kind === "failed" && outcome.failure.kind === "unknown" ? outcome.failure.operationId : undefined} /> : null}
    </ConfirmDialog>
  </>);
}
