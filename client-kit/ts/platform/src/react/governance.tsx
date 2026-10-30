// 任务工作台与审批箱（.design/06 §9、apps/02 §4）：本人任务、待我审批、详情、批准/拒绝
// 与撤回。Web 与 Desktop 渲染的是同一份组件，数据全部经 BFF。
//
// 只渲染服务端已开放的控制：取消与重跑只使用任务详情给出的控制 Action key；
// 撤回与决定各有 BFF 端点。可见范围、资格与冲突都由
// BFF 判定，按下之后仍以 BFF 的重新准入为准。
//
// 结果不明（没有回应、EXTERNAL_RESULT_UNKNOWN、PROJECTION_DELAYED）不渲染成成功或
// 失败：显示「等待对账」并给出 operation 作为查证入口。
//
// DD-170（.design/20 §16）与 .design/06 §8：任务页按“需要处理 / 进行中 / 已结束”分段，
// 每行突出状态、进度、等待原因与下一步；审批列表是带总数与分页的表格；详情是详情头、
// 概要键值、进度时间线与默认折叠的技术信息；取消、拒绝与撤回经确认对话框。

import {
  ActionDispatchState,
  ActionGateState,
  ApprovalDecision,
  type ApprovalDecisionOutcome,
  ApprovalStatus,
  type ApprovalView,
  ReasonCode,
  TaskStatus,
  type TaskView,
} from "@client-kit/contracts";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ChevronRight, ClipboardCheck, ListChecks } from "lucide-react";
import { relativeTime } from "../format";
import { absoluteTime, approvalOpen, newIdempotencyKey, taskPhase, taskProgress, type TaskSegment, taskSegment } from "../governance";
import {
  approvalDecisionMessages,
  approvalSelectorMessages,
  approvalStatusMessages,
  enumLabel,
  reasonMessages,
  type PlatformMessageKey,
} from "../i18n";
import { type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useCurrentPrincipalId, useFailureText, useLocale, useReasonText, useT } from "./context";
import { InvitationForApproval } from "./invitations";
import { Resource } from "./pages";
import { Badge, Button, type Tone, useActionLabel } from "./ui";
import { useLoad } from "./use-load";
import { ComponentActionsPanel } from "./component-actions";
import { type DataColumn, DataTable, ListSearch, Pagination, usePaged } from "./data-table";
import { DetailSkeleton, EmptyState, readRefusal, TableSkeleton } from "./state-views";
import { IdText, KeyValueList, type KeyValueItem, TagList, Timeline, type TimelineItem } from "./key-value";
import { ConfirmDialog } from "./confirm-dialog";
import { DetailHeader, PageSection, RefreshButton } from "./page-layout";

const approvalTone: Record<ApprovalStatus, Tone> = {
  [ApprovalStatus.Requested]: "neutral",
  [ApprovalStatus.Waiting]: "neutral",
  [ApprovalStatus.Approved]: "neutral",
  [ApprovalStatus.Consumed]: "positive",
  [ApprovalStatus.Denied]: "negative",
  [ApprovalStatus.Expired]: "negative",
  [ApprovalStatus.Cancelled]: "negative",
  [ApprovalStatus.Invalidated]: "negative",
};

/** DD-96：受限会话只挂现有生命周期任务与审批，不挂普通协作/管理页。 */
export function LifecycleRestrictedView({
  displayName,
  onSignOut,
}: {
  displayName: string | null;
  onSignOut: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<"tasks" | "approvals">("tasks");
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between gap-4 border-b p-4">
        {displayName ? <strong>{displayName}</strong> : null}
        <Button onClick={onSignOut}>{t("platform.signOut")}</Button>
      </header>
      <nav className="flex gap-2 border-b p-4">
        <Button aria-pressed={tab === "tasks"} onClick={() => setTab("tasks")}>
          {t("platform.tab.tasks")}
        </Button>
        <Button aria-pressed={tab === "approvals"} onClick={() => setTab("approvals")}>
          {t("platform.tab.approvals")}
        </Button>
      </nav>
      <main className="mx-auto w-full max-w-5xl p-4">
        {tab === "tasks" ? <TasksPage allowComponentActions={false} /> : <ApprovalsPage />}
      </main>
    </div>
  );
}

/** 相对时间；悬停显示绝对时间。 */
function When({ at }: { at: string }) {
  const locale = useLocale();
  return <span className="whitespace-nowrap tabular-nums" title={absoluteTime(locale, at)}>{relativeTime(locale, at)}</span>;
}

/**
 * 默认折叠的技术信息（§16.3）：ID、wire key 与 Workflow 引用只在这里出现，均可复制。
 * 用原生 details：折叠时不占版面，内容仍在文档中可被检索与复制。
 */
export function TechnicalDetails({ items, testId }: { items: readonly (KeyValueItem | undefined | null | false)[]; testId?: string }) {
  const t = useT();
  return (
    <details className="group rounded-xl border border-border bg-card" data-testid={testId ?? "technical-details"}>
      <summary className="flex h-10 cursor-pointer list-none items-center gap-1.5 px-4 text-sm font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight aria-hidden className="h-4 w-4 transition-transform duration-[140ms] group-open:rotate-90" strokeWidth={1.75} />
        {t("tasks.detail.technical")}
      </summary>
      <div className="border-t border-border">
        <KeyValueList bordered={false} items={items} />
      </div>
    </details>
  );
}

/** A copyable identifier shown in full inside technical details. */
function FullId({ value, label }: { value: string; label?: string }) {
  return <IdText value={value} label={label} full />;
}

export function WaitingReason({ code }: { code: string }) {
  const t = useT();
  const reasonText = useReasonText();
  const known: Readonly<Record<string, PlatformMessageKey>> = {
    UNKNOWN_EXTERNAL_RESULT: "tasks.status.unknown",
    CONVERGENCE_PENDING: "tasks.waiting.convergence",
    WAITING_TIMER: "workflows.steps.waiting",
    PENDING_EXTERNAL: "tasks.waiting.external",
    PROTOCOL_SESSION_OPEN: "tasks.waiting.protocolSession",
    NONE: "platform.audit.noResult",
  };
  const key = Object.hasOwn(known, code) ? known[code] : undefined;
  return <span title={code}>{key ? t(key) : Object.hasOwn(reasonMessages, code)
    ? reasonText(code as ReasonCode) : t("tasks.waitingCode", { code })}</span>;
}

/** 列表与详情并存：打开详情时列表保持挂载（筛选、页码与检索在返回后原样恢复）。 */
function ListWithDetail({ open, list, detail }: { open: boolean; list: ReactNode; detail: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <div hidden={open}>{list}</div>
      {open ? detail : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 本人任务
// ---------------------------------------------------------------------------

export function TaskStatusBadge({ task }: { task: TaskView }) {
  const t = useT();
  const phase = taskPhase(task);
  return <span className="inline-flex" title={[task.gateState, task.dispatchState, task.taskStatus, task.observation].filter(Boolean).join(" · ")}>
    <Badge tone={phase.tone}>{t(phase.label)}</Badge>
  </span>;
}

/** 本人发起或等待本人处理的执行（.design/06 §8）：按下一步要做的事分三段，点开进入执行详情。 */
export function TasksPage({ allowComponentActions = true, openTaskId, onViewOperation }: {
  allowComponentActions?: boolean;
  /** Opens this execution's detail first (the business operations page links back here). */
  openTaskId?: string;
  /** Host navigation to the same execution's row on the business operations page. */
  onViewOperation?: (task: TaskView) => void;
} = {}) {
  const [open, setOpen] = useState<{ kind: "task"; id: string } | { kind: "approval"; id: string } | null>(
    openTaskId ? { kind: "task", id: openTaskId } : null);
  return (
    <ListWithDetail
      open={open !== null}
      list={<div className="flex flex-col gap-8">
        <TaskList onOpen={(id) => setOpen({ kind: "task", id })} onOpenApproval={(id) => setOpen({ kind: "approval", id })} />
        {allowComponentActions ? <ComponentActionsPanel onOpen={(id) => setOpen({ kind: "task", id })} /> : null}
      </div>}
      detail={open?.kind === "task" ? (
        <TaskDetail key={open.id} actionExecutionId={open.id} onBack={() => setOpen(null)}
          onOpen={(id) => setOpen({ kind: "task", id })} onViewOperation={onViewOperation} />
      ) : open?.kind === "approval" ? (
        <div className="flex flex-col gap-3" data-testid="approval-detail">
          <ApprovalPanel key={open.id} workflowId={open.id} role="approver" onBack={() => setOpen(null)} />
        </div>
      ) : null}
    />
  );
}

const SEGMENT_PAGE_SIZE = 10;

/** Steps reached of admission, dispatch and execution, drawn as a short segmented meter. */
function TaskProgress({ task }: { task: TaskView }) {
  const t = useT();
  const { done, total } = taskProgress(task);
  const phase = taskPhase(task);
  const fill = phase.tone === "negative" ? "bg-danger-text" : phase.tone === "positive" ? "bg-success-text" : "bg-brand-text";
  const text = t("tasks.progress", { done, total });
  return <span className="inline-flex items-center gap-1.5" title={text}>
    <span aria-hidden className="inline-flex gap-0.5">
      {Array.from({ length: total }, (_, i) => <span key={i} className={`h-1.5 w-4 rounded-full ${i < done ? fill : "bg-muted"}`} />)}
    </span>
    <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{text}</span>
  </span>;
}

/** The line under a task's name: what it waits for, or why it ended. */
function TaskNote({ task }: { task: TaskView }) {
  const reasonText = useReasonText();
  if (task.waitingReason) return <WaitingReason code={task.waitingReason} />;
  if (task.observation) return <span title={task.observation}>{reasonText(task.observation)}</span>;
  if (task.reason) return <span title={task.reason}>{reasonText(task.reason)}</span>;
  return null;
}

type TaskItem =
  | { kind: "approval"; key: string; approval: ApprovalView }
  | { kind: "task"; key: string; task: TaskView };

function TaskRow({ item, onOpen, onOpenApproval }: { item: TaskItem; onOpen: (id: string) => void; onOpenApproval: (id: string) => void }) {
  const t = useT();
  const label = useActionLabel();
  const open = () => item.kind === "approval" ? onOpenApproval(item.approval.workflowId) : onOpen(item.task.actionExecutionId);
  let status: ReactNode, note: ReactNode, next: PlatformMessageKey, when: string;
  if (item.kind === "approval") {
    status = <ApprovalStatusBadge approval={item.approval} />;
    note = <span>{t("tasks.row.awaitingYou")}</span>;
    next = "tasks.next.decide";
    when = item.approval.expiresAt;
  } else {
    const task = item.task;
    const segment = taskSegment(task);
    status = <TaskStatusBadge task={task} />;
    note = <><TaskProgress task={task} /><span className="min-w-0 truncate"><TaskNote task={task} /></span></>;
    next = segment === "attention" ? "tasks.next.check"
      : task.gateState === ActionGateState.Waiting ? "tasks.next.viewApproval"
        : segment === "active" ? "tasks.next.progress" : "tasks.next.result";
    when = task.createdAt;
  }
  const name = label(item.kind === "approval" ? item.approval.actionKey : item.task.actionKey);
  return (
    <li className="group/row flex min-w-0 items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 hover:bg-accent/40"
      data-task-row={item.key}>
      <button type="button" onClick={open}
        className="flex min-w-0 flex-1 flex-col gap-1 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 truncate font-medium text-foreground">{name}</span>
          {status}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {note}
        </span>
      </button>
      <span className="hidden shrink-0 sm:inline"><When at={when} /></span>
      <Button className="h-7 shrink-0 px-2.5" onClick={open}>{t(next)}</Button>
    </li>
  );
}

function TaskSegmentList({ title, items, empty, collapsible, onOpen, onOpenApproval, notice, testId }: {
  title: string;
  items: TaskItem[];
  empty?: string;
  collapsible?: boolean;
  onOpen: (id: string) => void;
  onOpenApproval: (id: string) => void;
  notice?: ReactNode;
  testId: string;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(!collapsible);
  const paged = usePaged(items, { pageSize: SEGMENT_PAGE_SIZE });
  return (
    <section className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <header className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {title}<span className="rounded-sm bg-muted px-1.5 text-xs font-medium tabular-nums text-muted-foreground">{items.length}</span>
        </h3>
        {collapsible && items.length > 0 ? (
          <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight aria-hidden className={`h-3.5 w-3.5 transition-transform duration-[140ms] ${expanded ? "rotate-90" : ""}`} strokeWidth={1.75} />
            {t(expanded ? "tasks.section.hide" : "tasks.section.show")}
          </button>
        ) : null}
      </header>
      {notice}
      {items.length === 0 ? (empty ? <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">{empty}</p> : null)
        : expanded ? (
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <ul>{paged.pageRows.map((item) => <TaskRow key={item.key} item={item} onOpen={onOpen} onOpenApproval={onOpenApproval} />)}</ul>
            {items.length > SEGMENT_PAGE_SIZE ? (
              <div className="border-t border-border px-3 py-2">
                <Pagination total={paged.total} page={paged.page} pageSize={paged.pageSize} onPageChange={paged.setPage}
                  onPageSizeChange={paged.setPageSize} pageSizes={[10, 20, 50]} testId={`${testId}-pagination`} />
              </div>
            ) : null}
          </div>
        ) : null}
    </section>
  );
}

function TaskList({ onOpen, onOpenApproval }: { onOpen: (actionExecutionId: string) => void; onOpenApproval: (workflowId: string) => void }) {
  const client = useBffClient();
  const t = useT();
  const label = useActionLabel();
  const [state, reload] = useLoad("tasks", client.tasks);
  const [approvals, reloadApprovals] = useLoad("approvals", client.pendingApprovals);
  const [query, setQuery] = useState("");
  const refresh = () => { reload(); reloadApprovals(); };
  const waiting = approvals.status === "ok" && Array.isArray(approvals.data) ? approvals.data.filter((a) => approvalOpen(a.status)) : [];
  // A refused approvals read (no approver role here) is not a failure of this page.
  const approvalsFailed = approvals.status === "error" && readRefusal(approvals.error) === null;
  const q = query.trim().toLocaleLowerCase();
  const match = (actionKey: string) => !q || label(actionKey).toLocaleLowerCase().includes(q);
  return (
    <PageSection title={t("tasks.myTitle")} testId="task-list"
      description={state.status === "ok" && Array.isArray(state.data) && state.data.length > 0
        ? t("tasks.list.explain", { count: state.data.length }) : undefined}
      actions={<RefreshButton onClick={refresh} pending={state.status === "pending"} />}>
      <Resource state={state} reload={reload} skeleton={<TableSkeleton rows={4} columns={3} />}>
        {(rows) => {
          if (rows.length === 0 && waiting.length === 0 && !approvalsFailed)
            return <EmptyState icon={ListChecks} title={t("tasks.empty.title")} description={t("tasks.empty.body")} />;
          const items = (segment: TaskSegment): TaskItem[] => rows
            .filter((task) => taskSegment(task) === segment && match(task.actionKey))
            .map((task) => ({ kind: "task", key: task.actionExecutionId, task }));
          const attention: TaskItem[] = [
            ...waiting.filter((a) => match(a.actionKey)).map((approval): TaskItem => ({ kind: "approval", key: `approval:${approval.workflowId}`, approval })),
            ...items("attention"),
          ];
          return (
            <div className="flex flex-col gap-6">
              {rows.length + waiting.length > SEGMENT_PAGE_SIZE ? <ListSearch value={query} onChange={setQuery} placeholder={t("tasks.list.search")} /> : null}
              <TaskSegmentList testId="task-segment-attention" title={t("tasks.section.attention")} items={attention}
                empty={t("tasks.section.attentionEmpty")} onOpen={onOpen} onOpenApproval={onOpenApproval}
                notice={approvalsFailed ? <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  {t("tasks.approvalsFailed")}<Button className="h-7 px-2.5" onClick={reloadApprovals}>{t("platform.retry")}</Button></p> : null} />
              <TaskSegmentList testId="task-segment-active" title={t("tasks.section.active")} items={items("active")}
                empty={t("tasks.section.activeEmpty")} onOpen={onOpen} onOpenApproval={onOpenApproval} />
              <TaskSegmentList testId="task-segment-ended" title={t("tasks.section.ended")} items={items("ended")}
                collapsible onOpen={onOpen} onOpenApproval={onOpenApproval} />
            </div>
          );
        }}
      </Resource>
    </PageSection>
  );
}

type TaskControl = "cancel" | "rerun";
type Step = { label: PlatformMessageKey; tone: NonNullable<TimelineItem["tone"]> };

const gateStep: Record<ActionGateState, Step> = {
  [ActionGateState.Evaluating]: { label: "tasks.status.evaluating", tone: "neutral" },
  [ActionGateState.Waiting]: { label: "tasks.status.waitingApproval", tone: "warning" },
  [ActionGateState.Allowed]: { label: "tasks.timeline.allowed", tone: "positive" },
  [ActionGateState.Denied]: { label: "tasks.status.denied", tone: "negative" },
  [ActionGateState.Revoked]: { label: "tasks.status.revoked", tone: "negative" },
  [ActionGateState.Expired]: { label: "tasks.status.expired", tone: "negative" },
};

const dispatchStep: Record<ActionDispatchState, Step> = {
  [ActionDispatchState.NotDispatched]: { label: "tasks.timeline.notDispatched", tone: "neutral" },
  [ActionDispatchState.Dispatched]: { label: "tasks.timeline.dispatched", tone: "positive" },
  [ActionDispatchState.Aborted]: { label: "tasks.status.aborted", tone: "negative" },
  [ActionDispatchState.Unknown]: { label: "tasks.status.unknown", tone: "warning" },
};

const unknownStep: Step = { label: "tasks.status.unknown", tone: "neutral" };

/** 门禁、派发与执行三段进度：只陈述服务端给出的事实，不推断。 */
function TaskTimeline({ task }: { task: TaskView }) {
  const t = useT();
  const items: TimelineItem[] = [{ id: "created", title: t("tasks.timeline.created"), time: <When at={task.createdAt} /> }];
  const gate = Object.hasOwn(gateStep, task.gateState) ? gateStep[task.gateState] : unknownStep;
  items.push({ id: "gate", title: t("tasks.timeline.admission"), description: t(gate.label), tone: gate.tone });
  if (task.gateState === ActionGateState.Allowed) {
    const dispatch = Object.hasOwn(dispatchStep, task.dispatchState) ? dispatchStep[task.dispatchState] : unknownStep;
    items.push({ id: "dispatch", title: t("tasks.timeline.dispatch"), description: t(dispatch.label), tone: dispatch.tone });
    if (task.dispatchState === ActionDispatchState.Dispatched && task.workflowId !== undefined) {
      const phase = taskPhase(task);
      items.push({ id: "execution", title: t("tasks.timeline.execution"), description: t(phase.label),
        tone: phase.tone === "positive" ? "positive" : phase.tone === "negative" ? "negative" : "brand" });
    }
  }
  return <div className="rounded-xl border border-border bg-card p-4"><Timeline items={items} testId="task-timeline" /></div>;
}

export function TaskDetail({
  actionExecutionId,
  onBack,
  onOpen,
  onViewOperation,
}: {
  actionExecutionId: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  /** Host navigation to this execution on the business operations page (DD-168(14)). */
  onViewOperation?: (task: TaskView) => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const label = useActionLabel();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [state, reload] = useLoad(`task:${actionExecutionId}`, () => client.task(actionExecutionId));
  const [workspaces] = useLoad("workspaces", client.workspaces);
  const [confirmControl, setConfirmControl] = useState<TaskControl | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlOutcome, setControlOutcome] = useState<
    | { kind: "submitted"; control: TaskControl; operationId: string; actionExecutionId: string }
    | { kind: "failed"; control: TaskControl; failure: WriteFailure; actionKey: string; idempotencyKey: string }
    | null
  >(null);
  // 一个 ActionExecution 至多一个审批，其 ID 不变：取到一次即可一直用
  const approvalWorkflowId = useRef<string | undefined>(undefined);
  if (state.status === "ok") approvalWorkflowId.current ??= state.data.approvalWorkflowId;
  const originalAwaitingTerminal =
    state.status !== "ok" || state.data.taskStatus === undefined || state.data.taskStatus === TaskStatus.Running;
  const rerunHasIntent = controlOutcome?.control === "rerun" &&
    (controlOutcome.kind === "submitted" ||
      (controlOutcome.kind === "failed" && controlOutcome.failure.kind === "unknown"));

  const submitControl = async (control: TaskControl, actionKey: string, idempotencyKey: string) => {
    setControlBusy(true);
    setControlOutcome(null);
    try {
      const result = await client.submitAction({
        actionKey,
        idempotencyKey,
        originalActionExecutionId: actionExecutionId,
      });
      setControlOutcome({
        kind: "submitted",
        control,
        operationId: result.operationId,
        actionExecutionId: result.actionExecutionId,
      });
    } catch (error) {
      setControlOutcome({ kind: "failed", control, failure: writeFailure(error), actionKey, idempotencyKey });
    } finally {
      // §16.6: the dialog stays open while the request is in flight; the outcome is then shown on the page.
      setControlBusy(false);
      setDialogOpen(false);
      reload();
    }
  };

  const ask = (control: TaskControl) => { setConfirmControl(control); setDialogOpen(true); };

  const outcomeView = (
    <>
      {controlOutcome?.kind === "submitted" &&
      (controlOutcome.control === "rerun" || originalAwaitingTerminal) ? (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <span>{t(controlOutcome.control === "cancel" ? "tasks.cancelSubmitted" : "tasks.rerunSubmitted", {
            operation: controlOutcome.operationId,
          })}</span>
          {controlOutcome.control === "rerun" ? (
            <Button onClick={() => onOpen(controlOutcome.actionExecutionId)}>{t("tasks.openNew")}</Button>
          ) : null}
        </div>
      ) : null}
      {controlOutcome?.kind === "failed" && controlOutcome.failure.kind === "unknown" ? (
        <div className="flex flex-col gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-text" role="alert">
          <p>{t(controlOutcome.control === "cancel" ? "tasks.cancelUnknown" : "tasks.rerunUnknown", {
            operation: controlOutcome.failure.operationId ?? "—",
          })}</p>
          <Button
            className="w-fit"
            disabled={controlBusy}
            onClick={() => void submitControl(controlOutcome.control, controlOutcome.actionKey, controlOutcome.idempotencyKey)}
          >
            {t("tasks.cancelSendAgain")}
          </Button>
        </div>
      ) : null}
      {controlOutcome?.kind === "failed" && controlOutcome.failure.kind === "rejected" ? (
        <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-text" role="alert">
          {t(controlOutcome.control === "cancel" ? "tasks.cancelRejected" : "tasks.rerunRejected", {
            reason: failureText(controlOutcome.failure),
          })}
        </p>
      ) : null}
    </>
  );

  const workspaceName = (id: string | undefined) => id === undefined || workspaces.status !== "ok" || !Array.isArray(workspaces.data)
    ? undefined : workspaces.data.find((w) => w.id === id)?.name;

  return (
    <div className="flex flex-col gap-6" data-testid="task-detail">
      {state.status !== "ok" ? (
        <>
          <DetailHeader onBack={onBack} title={t("tasks.title")} actions={<RefreshButton onClick={reload} pending={state.status === "pending"} />} />
          {outcomeView}
        </>
      ) : null}
      <Resource state={state} reload={reload} skeleton={<DetailSkeleton />}>
        {(task) => {
          const canCancel = !!task.cancelActionKey && !controlBusy && controlOutcome?.kind !== "submitted" &&
            !(controlOutcome?.kind === "failed" && controlOutcome.failure.kind === "unknown");
          const canRerun = !!task.rerunActionKey && !controlBusy && !rerunHasIntent;
          const controlKey = confirmControl === "cancel" ? task.cancelActionKey : confirmControl === "rerun" ? task.rerunActionKey : undefined;
          const workspace = workspaceName(task.workspaceId);
          return (
            <>
              <DetailHeader
                onBack={onBack}
                title={label(task.actionKey)}
                status={<TaskStatusBadge task={task} />}
                subtitle={<span title={absoluteTime(locale, task.createdAt)}>{t("tasks.detail.started", { time: relativeTime(locale, task.createdAt) })}</span>}
                actions={<>
                  {canRerun ? <Button onClick={() => ask("rerun")}>{t("tasks.rerunRequest")}</Button> : null}
                  {canCancel ? <Button className="text-danger-text" onClick={() => ask("cancel")}>{t("tasks.cancelRequest")}</Button> : null}
                  <RefreshButton onClick={reload} />
                </>}
              />
              {outcomeView}
              <KeyValueList
                items={[
                  { id: "state", label: t("platform.state"), value: <TaskStatusBadge task={task} /> },
                  task.observation ? { id: "observation", label: t("tasks.reason"), value: reasonText(task.observation) } : undefined,
                  task.reason ? { id: "reason", label: t("tasks.reason"), value: reasonText(task.reason) } : undefined,
                  task.waitingReason ? { id: "waiting", label: t("tasks.waitingReason"), value: <WaitingReason code={task.waitingReason} /> } : undefined,
                  { id: "created", label: t("tasks.created"), value: absoluteTime(locale, task.createdAt) },
                  workspace ? { id: "workspace", label: t("platform.workspace"), value: workspace } : undefined,
                ]}
              />
              <PageSection title={t("tasks.detail.progress")}
                actions={onViewOperation ? <button type="button" onClick={() => onViewOperation(task)}
                  className="rounded-sm text-sm font-medium text-brand-text hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                  {t("tasks.viewOperation")}</button> : undefined}>
                <TaskTimeline task={task} />
              </PageSection>
              <TechnicalDetails items={[
                { id: "operation", label: t("tasks.operation"), value: <FullId value={task.operationId} label={t("tasks.operation")} /> },
                { id: "execution", label: t("tasks.execution"), value: <FullId value={task.actionExecutionId} label={t("tasks.execution")} /> },
                { id: "target", label: t("tasks.target"), value: <FullId value={task.targetId} label={t("tasks.target")} /> },
                task.workspaceId ? { id: "workspace", label: t("platform.workspace"), value: <FullId value={task.workspaceId} /> } : undefined,
                task.workflowId ? { id: "workflow", label: t("tasks.workflow"), value: <FullId value={task.workflowId} label={t("tasks.workflow")} /> } : undefined,
                task.workflowKind ? { id: "workflowKind", label: t("tasks.detail.workflowKind"), value: <code className="font-mono text-xs">{task.workflowKind}</code> } : undefined,
                { id: "actionKey", label: t("tasks.detail.actionKey"), value: <FullId value={task.actionKey} label={t("tasks.detail.actionKey")} /> },
                { id: "version", label: t("tasks.detail.version"), value: String(task.actionVersion) },
              ]} />
              <ConfirmDialog
                testId="task-control-dialog"
                open={dialogOpen && controlKey !== undefined}
                onOpenChange={(next) => { if (!next) setDialogOpen(false); }}
                title={t(confirmControl === "cancel" ? "tasks.confirmCancelTitle" : "tasks.confirmRerunTitle")}
                description={t(confirmControl === "cancel" ? "tasks.confirmCancel" : "tasks.confirmRerun")}
                confirmLabel={t(confirmControl === "cancel" ? "tasks.cancelRequest" : "tasks.rerunRequest")}
                tone={confirmControl === "cancel" ? "danger" : "default"}
                pending={controlBusy}
                onConfirm={() => {
                  if (controlBusy || !confirmControl || !controlKey) return;
                  void submitControl(confirmControl, controlKey, newIdempotencyKey());
                }}
              />
            </>
          );
        }}
      </Resource>
      {/* 审批面板在任务重读时保持挂载：撤回的结论不能随任务刷新一起消失 */}
      {approvalWorkflowId.current ? (
        <PageSection title={t("tasks.approval")}>
          <ApprovalPanel workflowId={approvalWorkflowId.current} role="initiator" onChanged={reload}
            ownerPending={state.status === "ok" && state.data.gateState === ActionGateState.Waiting} />
        </PageSection>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

function ApprovalStatusBadge({ approval }: { approval: ApprovalView }) {
  const t = useT();
  const locale = useLocale();
  if (approval.observation)
    return (
      <Badge tone="neutral">
        {t(
          approval.observation === ReasonCode.ExternalResultUnknown
            ? "tasks.status.unknown"
            : "tasks.status.delayed",
        )}
      </Badge>
    );
  return (
    <Badge tone={approvalTone[approval.status] ?? "neutral"}>
      {enumLabel(locale, approvalStatusMessages, approval.status)}
    </Badge>
  );
}

/** 待我审批与详情。Mobile 不渲染这一页（apps/02 §4：Mobile 只读）。 */
export function ApprovalsPage() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ListWithDetail
      open={open !== null}
      list={<ApprovalList onOpen={setOpen} />}
      detail={open ? (
        <div className="flex flex-col gap-3" data-testid="approval-detail">
          <ApprovalPanel key={open} workflowId={open} role="approver" onBack={() => setOpen(null)} />
        </div>
      ) : null}
    />
  );
}

function ApprovalList({ onOpen }: { onOpen: (workflowId: string) => void }) {
  const client = useBffClient();
  const t = useT();
  const label = useActionLabel();
  const locale = useLocale();
  const [state, reload] = useLoad("approvals", client.pendingApprovals);
  const columns: DataColumn<ApprovalView>[] = [
    { key: "action", header: t("platform.action"), truncate: true,
      cell: (a) => <span className="font-medium text-foreground">{label(a.actionKey)}</span>, sortValue: (a) => label(a.actionKey) },
    { key: "status", header: t("approvals.status"), width: "13rem", cell: (a) => <ApprovalStatusBadge approval={a} /> },
    { key: "expires", header: t("approvals.expires"), width: "9rem", cell: (a) => <When at={a.expiresAt} />,
      sortValue: (a) => Date.parse(a.expiresAt) },
  ];
  return (
    <PageSection title={t("approvals.pendingTitle")} description={t("approvals.list.explain")} testId="approval-list">
      <Resource state={state} reload={reload}>
        {(rows) => (
          <DataTable
            testId="approval-table"
            label={t("approvals.list.table")}
            rows={rows}
            columns={columns}
            rowKey={(a) => a.workflowId}
            onRowClick={(a) => onOpen(a.workflowId)}
            search={{ placeholder: t("tasks.list.search"),
              text: (a) => `${label(a.actionKey)} ${enumLabel(locale, approvalStatusMessages, a.status)}` }}
            toolbar={<RefreshButton onClick={reload} />}
            empty={<EmptyState icon={ClipboardCheck} title={t("approvals.empty.title")} description={t("approvals.empty.body")} />}
          />
        )}
      </Resource>
    </PageSection>
  );
}

// A definite withdraw/decision returns before Core's gate and the approval
// projection converge; re-read a bounded few times instead of showing the
// closed request as still waiting until a manual refresh.
const SETTLE_ATTEMPTS = 5;
const SETTLE_DELAY_MS = 1000;

type ControlOutcome =
  | { kind: "decided"; outcome: ApprovalDecisionOutcome }
  | { kind: "withdrawn"; status: ApprovalStatus }
  | { kind: "failed"; failure: WriteFailure; retry?: ApprovalDecision };

/**
 * 一项审批的事实与本人可用的控制。`initiator` 可撤回，`approver` 可决定；按钮只在审批
 * 仍未决且投影可担保时出现，能不能做由 BFF 回答。
 */
export function ApprovalPanel({
  workflowId,
  role,
  onBack,
  onChanged,
  ownerPending = false,
}: {
  workflowId: string;
  role: "initiator" | "approver";
  onBack?: () => void;
  onChanged?: () => void;
  /** The owning task still reads its pre-decision gate. */
  ownerPending?: boolean;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const label = useActionLabel();
  const me = useCurrentPrincipalId();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [state, reload] = useLoad(`approval:${workflowId}`, () => client.approval(workflowId));
  const [confirming, setConfirming] = useState<ApprovalDecision | "withdraw" | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ControlOutcome | null>(null);
  const [settleAttempts, setSettleAttempts] = useState(0);
  const closedStatus = outcome?.kind === "withdrawn" ? outcome.status
    : outcome?.kind === "decided" ? outcome.outcome.status : undefined;
  const awaitingProjection = closedStatus !== undefined && !approvalOpen(closedStatus)
    && ((state.status === "ok" && approvalOpen(state.data.status)) || ownerPending);
  useEffect(() => {
    if (!awaitingProjection || settleAttempts >= SETTLE_ATTEMPTS) return;
    const timer = setTimeout(() => {
      setSettleAttempts((attempts) => attempts + 1);
      reload();
      onChanged?.();
    }, SETTLE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [awaitingProjection, settleAttempts, reload, onChanged]);

  const refresh = () => {
    setConfirming(null);
    reload();
  };

  const run = async (control: ApprovalDecision | "withdraw") => {
    setBusy(true);
    setSettleAttempts(0);
    const unknown = outcome?.kind === "failed" && outcome.failure.kind === "unknown";
    if (!unknown) setOutcome(null);
    try {
      if (control === "withdraw") {
        const r = await client.withdraw(workflowId);
        setOutcome({ kind: "withdrawn", status: r.status });
      } else {
        const r = await client.decide(workflowId, control);
        setOutcome({ kind: "decided", outcome: r });
      }
    } catch (e) {
      // 同人同值 Update 可重发；重发的准入拒绝不能否定原未知决定。
      // 保留原决定与 operation 查证引用，直到该 Update 返回确定结论。
      if (!unknown) {
        setOutcome({
          kind: "failed",
          failure: writeFailure(e),
          retry: control === "withdraw" ? undefined : control,
        });
      }
    } finally {
      // §16.6: the confirmation stays open while in flight and closes with the outcome.
      setBusy(false);
      refresh();
      onChanged?.();
    }
  };

  const decisionLabel = (d: ApprovalDecision) => enumLabel(locale, approvalDecisionMessages, d);
  const statusLabel = (s: ApprovalStatus) => enumLabel(locale, approvalStatusMessages, s);
  const who = (principalId: string) => (me !== undefined && principalId === me ? t("approvals.you") : t("approvals.otherMember"));

  const outcomeView = (() => {
    if (!outcome) return null;
    if (outcome.kind === "decided")
      return (
        <p role="status" className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          {t("approvals.decided", {
            decision: outcome.outcome.decision ? decisionLabel(outcome.outcome.decision) : "—",
            status: statusLabel(outcome.outcome.status),
          })}
        </p>
      );
    if (outcome.kind === "withdrawn")
      return <p role="status" className="rounded-xl border border-border bg-card px-4 py-3 text-sm">{t("approvals.withdrawn", { status: statusLabel(outcome.status) })}</p>;
    const { failure, retry } = outcome;
    if (failure.kind === "unknown")
      return (
        <div className="flex flex-col gap-2 rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning-text" role="alert">
          <p>
            {t(retry ? "approvals.decisionUnknown" : "approvals.withdrawUnknown", {
              operation: failure.operationId ?? "—",
            })}
          </p>
          {retry ? (
            <Button className="w-fit" disabled={busy} onClick={() => void run(retry)}>
              {t("approvals.sendAgain")}
            </Button>
          ) : null}
        </div>
      );
    return (
      <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger-text" role="alert">
        {t(retry ? "approvals.decisionRejected" : "approvals.withdrawRejected", {
          reason: failureText(failure),
        })}
      </p>
    );
  })();

  const deny = confirming === ApprovalDecision.Deny;
  const dialog = (
    <ConfirmDialog
      testId="approval-confirm-dialog"
      open={confirming !== null}
      onOpenChange={(next) => { if (!next) setConfirming(null); }}
      title={t(confirming === "withdraw" ? "approvals.confirmWithdrawTitle" : deny ? "approvals.confirmDenyTitle" : "approvals.confirmApproveTitle")}
      description={confirming === "withdraw" || confirming === null
        ? t("approvals.confirmWithdraw")
        : t("approvals.confirmDecision", { decision: decisionLabel(confirming) })}
      confirmLabel={t(confirming === "withdraw" ? "approvals.withdraw" : deny ? "approvals.deny" : "approvals.approve")}
      tone={confirming === ApprovalDecision.Approve ? "default" : "danger"}
      pending={busy}
      onConfirm={() => { if (confirming !== null && !busy) void run(confirming); }}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      {role === "approver" && state.status !== "ok" ? (
        <DetailHeader onBack={onBack} title={t("tasks.approval")} actions={<RefreshButton onClick={refresh} pending={state.status === "pending"} />} />
      ) : null}
      {state.status !== "ok" ? outcomeView : null}
      <Resource state={state} reload={refresh} skeleton={<DetailSkeleton lines={4} />}>
        {(a) => {
          // 投影不可担保为当前时不给控制：先对账，再决定。本人刚得到确定结论（决定已记录、
          // 已撤回）或结果不明时也不再给新控制：未决投影不能证明此前决定尚未记录。
          const submitted = outcome !== null &&
            (outcome.kind !== "failed" || outcome.failure.kind === "unknown");
          const controllable = approvalOpen(a.status) && !a.observation && !busy && !submitted;
          const controls = controllable ? (
            role === "approver" ? (
              <>
                <Button className="text-danger-text" onClick={() => setConfirming(ApprovalDecision.Deny)}>{t("approvals.deny")}</Button>
                <Button onClick={() => setConfirming(ApprovalDecision.Approve)}>{t("approvals.approve")}</Button>
              </>
            ) : (
              <Button className="text-danger-text" onClick={() => setConfirming("withdraw")}>{t("approvals.withdraw")}</Button>
            )
          ) : null;
          const decisions: TimelineItem[] = a.decisions.map((d) => ({
            id: d.approverPrincipalId,
            title: t("approvals.decisionBy", { who: who(d.approverPrincipalId), decision: decisionLabel(d.decision) }),
            time: <When at={d.decidedAt} />,
            tone: d.decision === ApprovalDecision.Approve ? "positive" : "negative",
          }));
          return (
            <>
              {role === "approver" ? (
                <DetailHeader
                  onBack={onBack}
                  title={label(a.actionKey)}
                  status={<ApprovalStatusBadge approval={a} />}
                  subtitle={<span title={absoluteTime(locale, a.expiresAt)}>{t("approvals.expiresAt", { time: relativeTime(locale, a.expiresAt) })}</span>}
                  actions={<>{controls}<RefreshButton onClick={refresh} /></>}
                />
              ) : null}
              {outcomeView}
              {role === "approver" ? <InvitationForApproval workflowId={a.workflowId} /> : null}
              {a.automationStep ? (
                <PageSection title={t("approvals.step")}>
                  <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
                    <p className="text-sm font-medium">{a.automationStep.name ?? a.automationStep.id}</p>
                    <p className="whitespace-pre-wrap break-words text-sm">{a.automationStep.message}</p>
                  </div>
                </PageSection>
              ) : null}
              <KeyValueList
                items={[
                  { id: "status", label: t("approvals.status"), value: <ApprovalStatusBadge approval={a} /> },
                  a.observation ? { id: "observation", label: t("tasks.reason"), value: reasonText(a.observation) } : undefined,
                  a.reason ? { id: "reason", label: t("tasks.reason"), value: reasonText(a.reason) } : undefined,
                  { id: "expires", label: t("approvals.expires"), value: <When at={a.expiresAt} /> },
                  { id: "initiator", label: t("approvals.initiator"), value: who(a.initiatorPrincipalId) },
                  {
                    id: "requirements",
                    label: t("approvals.requirements"),
                    value: <TagList items={a.roleRequirements.map((r) =>
                      t("approvals.requirement", {
                        selector: enumLabel(locale, approvalSelectorMessages, r.selector),
                        count: r.minDistinct,
                      }))} />,
                  },
                ]}
              />
              <PageSection title={t("approvals.decisions")}>
                {decisions.length === 0 ? (
                  <p className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">{t("approvals.noDecisions")}</p>
                ) : (
                  <div className="rounded-xl border border-border bg-card p-4"><Timeline items={decisions} testId="approval-decisions" /></div>
                )}
              </PageSection>
              {role === "initiator" ? <div className="flex items-center gap-2">{controls}<RefreshButton onClick={refresh} /></div> : null}
              <TechnicalDetails items={[
                { id: "workflow", label: t("tasks.workflow"), value: <FullId value={a.workflowId} label={t("tasks.workflow")} /> },
                { id: "execution", label: t("tasks.execution"), value: <FullId value={a.actionExecutionId} label={t("tasks.execution")} /> },
                { id: "targetType", label: t("approvals.targetType"), value: <code className="font-mono text-xs">{a.targetType}</code> },
                { id: "target", label: t("tasks.target"), value: <FullId value={a.targetId} label={t("tasks.target")} /> },
                { id: "initiator", label: t("approvals.initiator"), value: <FullId value={a.initiatorPrincipalId} /> },
                ...a.decisions.map((d) => ({ id: `decider:${d.approverPrincipalId}`, label: decisionLabel(d.decision), value: <FullId value={d.approverPrincipalId} /> })),
                a.automationStep ? { id: "step", label: t("approvals.step"), value: <FullId value={a.automationStep.versionAssetId} /> } : undefined,
                { id: "actionKey", label: t("tasks.detail.actionKey"), value: <FullId value={a.actionKey} label={t("tasks.detail.actionKey")} /> },
              ]} />
            </>
          );
        }}
      </Resource>
      {dialog}
    </div>
  );
}
