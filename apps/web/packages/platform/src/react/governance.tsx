// 任务工作台与审批箱（.design/06 §9、apps/02 §4）：本人任务、待我审批、详情、批准/拒绝
// 与撤回。Web 与 Desktop 渲染的是同一份组件，数据全部经 BFF。
//
// 只渲染服务端已开放的控制：任务取消只使用详情给出的 cancelActionKey，重跑尚无
// 用户可达的 Governed Action；撤回与决定各有 BFF 端点。可见范围、资格与冲突都由
// BFF 判定，按下之后仍以 BFF 的重新准入为准。
//
// 结果不明（没有回应、EXTERNAL_RESULT_UNKNOWN、PROJECTION_DELAYED）不渲染成成功或
// 失败：显示「等待对账」并给出 operation 作为查证入口。

import {
  ApprovalDecision,
  type ApprovalDecisionOutcome,
  ApprovalStatus,
  type ApprovalView,
  ReasonCode,
  type TaskView,
} from "@kailo/contracts";
import { type ReactNode, useRef, useState } from "react";
import { relativeTime } from "../format";
import { approvalOpen, newIdempotencyKey, taskPhase } from "../governance";
import {
  approvalDecisionMessages,
  approvalSelectorMessages,
  approvalStatusMessages,
  enumLabel,
} from "../i18n";
import { type WriteFailure, writeFailure } from "../transport";
import { useBffClient, useFailureText, useLocale, useReasonText, useT } from "./context";
import { InvitationForApproval } from "./invitations";
import { Resource } from "./pages";
import { Badge, Button, Cell, Notice, Table, type Tone } from "./ui";
import { useLoad } from "./use-load";

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

function When({ at }: { at: string }) {
  const locale = useLocale();
  return <span title={at}>{relativeTime(locale, at)}</span>;
}

/** 列表里打开详情的入口：动作名本身。 */
function OpenLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="text-left underline-offset-2 hover:underline" onClick={onClick}>
      {children}
    </button>
  );
}

type Fact = [label: string, value: ReactNode];

/** 事实表；值缺省（undefined）的行不显示——没有就是没有，不画一个「—」。 */
function Facts({ rows }: { rows: (Fact | undefined)[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.filter((r): r is Fact => r !== undefined).map(([label, value], i) => (
        // 同一标签可出现两次（投影观察与门禁原因），标签加位置才唯一
        <div key={`${label}:${i}`} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Mono({ children }: { children: string }) {
  return <span className="font-mono text-xs">{children}</span>;
}

function Toolbar({ onBack, onRefresh }: { onBack?: () => void; onRefresh: () => void }) {
  const t = useT();
  return (
    <div className="flex gap-2">
      {onBack ? <Button onClick={onBack}>{t("platform.back")}</Button> : null}
      <Button onClick={onRefresh}>{t("platform.refresh")}</Button>
    </div>
  );
}

/** 需要二次确认的控制：先说清后果，再提交。 */
function Confirm({
  prompt,
  onConfirm,
  onCancel,
}: {
  prompt: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-col gap-2 rounded-md border p-3" role="group">
      <p>{prompt}</p>
      <div className="flex gap-2">
        <Button onClick={onConfirm}>{t("platform.confirm")}</Button>
        <Button onClick={onCancel}>{t("platform.cancel")}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 本人任务
// ---------------------------------------------------------------------------

function TaskStatusBadge({ task }: { task: TaskView }) {
  const t = useT();
  const phase = taskPhase(task);
  return <Badge tone={phase.tone}>{t(phase.label)}</Badge>;
}

/** 本人发起的受治理动作与详情。 */
export function TasksPage() {
  const [open, setOpen] = useState<string | null>(null);
  return open ? (
    <TaskDetail actionExecutionId={open} onBack={() => setOpen(null)} />
  ) : (
    <TaskList onOpen={setOpen} />
  );
}

function TaskList({ onOpen }: { onOpen: (actionExecutionId: string) => void }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("tasks", client.tasks);
  return (
    <div className="flex flex-col gap-3">
      <Toolbar onRefresh={reload} />
      <Resource state={state} reload={reload}>
        {(rows) =>
          rows.length === 0 ? (
            <Notice>{t("tasks.none")}</Notice>
          ) : (
            <Table head={[t("tasks.created"), t("platform.action"), t("platform.state")]}>
              {rows.map((task) => (
                <tr key={task.actionExecutionId}>
                  <Cell>
                    <When at={task.createdAt} />
                  </Cell>
                  <Cell>
                    <OpenLink onClick={() => onOpen(task.actionExecutionId)}>{task.actionKey}</OpenLink>
                  </Cell>
                  <Cell>
                    <TaskStatusBadge task={task} />
                  </Cell>
                </tr>
              ))}
            </Table>
          )
        }
      </Resource>
    </div>
  );
}

function TaskDetail({ actionExecutionId, onBack }: { actionExecutionId: string; onBack: () => void }) {
  const client = useBffClient();
  const t = useT();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [state, reload] = useLoad(`task:${actionExecutionId}`, () => client.task(actionExecutionId));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelOutcome, setCancelOutcome] = useState<
    | { kind: "submitted"; operationId: string; actionExecutionId: string }
    | { kind: "failed"; failure: WriteFailure; actionKey: string; idempotencyKey: string }
    | null
  >(null);
  // 一个 ActionExecution 至多一个审批，其 ID 不变：取到一次即可一直用
  const approvalWorkflowId = useRef<string | undefined>(undefined);
  if (state.status === "ok") approvalWorkflowId.current ??= state.data.approvalWorkflowId;

  const cancel = async (actionKey: string, idempotencyKey: string) => {
    setConfirmCancel(false);
    setCancelBusy(true);
    setCancelOutcome(null);
    try {
      const result = await client.submitAction({
        actionKey,
        idempotencyKey,
        originalActionExecutionId: actionExecutionId,
      });
      setCancelOutcome({
        kind: "submitted",
        operationId: result.operationId,
        actionExecutionId: result.actionExecutionId,
      });
    } catch (error) {
      setCancelOutcome({ kind: "failed", failure: writeFailure(error), actionKey, idempotencyKey });
    } finally {
      setCancelBusy(false);
      reload();
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="task-detail">
      <Toolbar onBack={onBack} onRefresh={reload} />
      {cancelOutcome?.kind === "submitted" ? (
        <p role="status">
          {t("tasks.cancelSubmitted", { operation: cancelOutcome.operationId })} {cancelOutcome.actionExecutionId}
        </p>
      ) : null}
      {cancelOutcome?.kind === "failed" && cancelOutcome.failure.kind === "unknown" ? (
        <div className="flex flex-col gap-2" role="alert">
          <p>{t("tasks.cancelUnknown", { operation: cancelOutcome.failure.operationId ?? "—" })}</p>
          <Button
            className="w-fit"
            disabled={cancelBusy}
            onClick={() => void cancel(cancelOutcome.actionKey, cancelOutcome.idempotencyKey)}
          >
            {t("tasks.cancelSendAgain")}
          </Button>
        </div>
      ) : null}
      {cancelOutcome?.kind === "failed" && cancelOutcome.failure.kind === "rejected" ? (
        <p className="text-destructive" role="alert">
          {t("tasks.cancelRejected", { reason: failureText(cancelOutcome.failure) })}
        </p>
      ) : null}
      <Resource state={state} reload={reload}>
        {(task) => (
          <div className="flex flex-col gap-4">
            <h2 className="text-sm font-medium">{task.actionKey}</h2>
            <Facts
              rows={[
                [t("platform.state"), <TaskStatusBadge key="s" task={task} />],
                task.observation ? [t("tasks.reason"), reasonText(task.observation)] : undefined,
                task.reason ? [t("tasks.reason"), reasonText(task.reason)] : undefined,
                task.waitingReason ? [t("tasks.waitingReason"), task.waitingReason] : undefined,
                [t("tasks.created"), <When key="c" at={task.createdAt} />],
                [t("tasks.operation"), <Mono key="o">{task.operationId}</Mono>],
                [t("tasks.execution"), <Mono key="e">{task.actionExecutionId}</Mono>],
                [t("tasks.target"), <Mono key="g">{task.targetId}</Mono>],
                task.workflowId
                  ? [
                      t("tasks.workflow"),
                      <Mono key="w">{`${task.workflowKind ?? ""} ${task.workflowId}`.trim()}</Mono>,
                    ]
                  : undefined,
              ]}
            />
            {confirmCancel && task.cancelActionKey ? (
              <Confirm
                prompt={t("tasks.confirmCancel")}
                onConfirm={() => void cancel(task.cancelActionKey!, newIdempotencyKey())}
                onCancel={() => setConfirmCancel(false)}
              />
            ) : task.cancelActionKey && !cancelBusy && cancelOutcome?.kind !== "submitted" &&
              !(cancelOutcome?.kind === "failed" && cancelOutcome.failure.kind === "unknown") ? (
              <Button className="w-fit" onClick={() => setConfirmCancel(true)}>
                {t("tasks.cancelRequest")}
              </Button>
            ) : null}
          </div>
        )}
      </Resource>
      {/* 审批面板在任务重读时保持挂载：撤回的结论不能随任务刷新一起消失 */}
      {approvalWorkflowId.current ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">{t("tasks.approval")}</h3>
          <ApprovalPanel workflowId={approvalWorkflowId.current} role="initiator" onChanged={reload} />
        </section>
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
  return open ? (
    <div className="flex flex-col gap-3" data-testid="approval-detail">
      <ApprovalPanel workflowId={open} role="approver" onBack={() => setOpen(null)} />
    </div>
  ) : (
    <ApprovalList onOpen={setOpen} />
  );
}

function ApprovalList({ onOpen }: { onOpen: (workflowId: string) => void }) {
  const client = useBffClient();
  const t = useT();
  const [state, reload] = useLoad("approvals", client.pendingApprovals);
  return (
    <div className="flex flex-col gap-3">
      <Toolbar onRefresh={reload} />
      <Resource state={state} reload={reload}>
        {(rows) =>
          rows.length === 0 ? (
            <Notice>{t("approvals.none")}</Notice>
          ) : (
            <Table head={[t("platform.action"), t("approvals.status"), t("approvals.expires")]}>
              {rows.map((a) => (
                <tr key={a.workflowId}>
                  <Cell>
                    <OpenLink onClick={() => onOpen(a.workflowId)}>{a.actionKey}</OpenLink>
                  </Cell>
                  <Cell>
                    <ApprovalStatusBadge approval={a} />
                  </Cell>
                  <Cell>
                    <When at={a.expiresAt} />
                  </Cell>
                </tr>
              ))}
            </Table>
          )
        }
      </Resource>
    </div>
  );
}

type ControlOutcome =
  | { kind: "decided"; outcome: ApprovalDecisionOutcome }
  | { kind: "withdrawn"; status: ApprovalStatus }
  | { kind: "failed"; failure: WriteFailure; retry?: ApprovalDecision };

/**
 * 一项审批的事实与本人可用的控制。`initiator` 可撤回，`approver` 可决定；按钮只在审批
 * 仍未决且投影可担保时出现，能不能做由 BFF 回答。
 */
function ApprovalPanel({
  workflowId,
  role,
  onBack,
  onChanged,
}: {
  workflowId: string;
  role: "initiator" | "approver";
  onBack?: () => void;
  onChanged?: () => void;
}) {
  const client = useBffClient();
  const t = useT();
  const locale = useLocale();
  const reasonText = useReasonText();
  const failureText = useFailureText();
  const [state, reload] = useLoad(`approval:${workflowId}`, () => client.approval(workflowId));
  const [confirming, setConfirming] = useState<ApprovalDecision | "withdraw" | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ControlOutcome | null>(null);

  const run = async (control: ApprovalDecision | "withdraw") => {
    setConfirming(null);
    setBusy(true);
    setOutcome(null);
    try {
      if (control === "withdraw") {
        const r = await client.withdraw(workflowId);
        setOutcome({ kind: "withdrawn", status: r.status });
      } else {
        const r = await client.decide(workflowId, control);
        setOutcome({ kind: "decided", outcome: r });
      }
    } catch (e) {
      // 决定是按人去重的 Update：结果不明时原样重发是安全的
      setOutcome({
        kind: "failed",
        failure: writeFailure(e),
        retry: control === "withdraw" ? undefined : control,
      });
    } finally {
      setBusy(false);
      reload();
      onChanged?.();
    }
  };

  const decisionLabel = (d: ApprovalDecision) => enumLabel(locale, approvalDecisionMessages, d);
  const statusLabel = (s: ApprovalStatus) => enumLabel(locale, approvalStatusMessages, s);

  const outcomeView = (() => {
    if (!outcome) return null;
    if (outcome.kind === "decided")
      return (
        <p role="status">
          {t("approvals.decided", {
            decision: outcome.outcome.decision ? decisionLabel(outcome.outcome.decision) : "—",
            status: statusLabel(outcome.outcome.status),
          })}
        </p>
      );
    if (outcome.kind === "withdrawn")
      return <p role="status">{t("approvals.withdrawn", { status: statusLabel(outcome.status) })}</p>;
    const { failure, retry } = outcome;
    if (failure.kind === "unknown")
      return (
        <div className="flex flex-col gap-2" role="alert">
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
      <p className="text-destructive" role="alert">
        {t(retry ? "approvals.decisionRejected" : "approvals.withdrawRejected", {
          reason: failureText(failure),
        })}
      </p>
    );
  })();

  return (
    <div className="flex flex-col gap-3">
      <Toolbar onBack={onBack} onRefresh={reload} />
      {outcomeView}
      <Resource state={state} reload={reload}>
        {(a) => {
          // 投影不可担保为当前时不给控制：先对账，再决定。本人刚得到确定结论（决定已记录、
          // 已撤回）时也不再给：投影可能还停在未决，那是写回尚未到达，不是还能再做一次
          const settled = outcome !== null && outcome.kind !== "failed";
          const controllable = approvalOpen(a.status) && !a.observation && !busy && !settled;
          return (
            <div className="flex flex-col gap-4">
              {role === "approver" ? <h2 className="text-sm font-medium">{a.actionKey}</h2> : null}
              {role === "approver" ? <InvitationForApproval workflowId={a.workflowId} /> : null}
              <Facts
                rows={[
                  [t("approvals.status"), <ApprovalStatusBadge key="s" approval={a} />],
                  a.observation ? [t("tasks.reason"), reasonText(a.observation)] : undefined,
                  a.reason ? [t("tasks.reason"), reasonText(a.reason)] : undefined,
                  [t("approvals.expires"), <When key="x" at={a.expiresAt} />],
                  [t("tasks.target"), <Mono key="g">{`${a.targetType} ${a.targetId}`}</Mono>],
                  [t("approvals.initiator"), <Mono key="i">{a.initiatorPrincipalId}</Mono>],
                  [t("tasks.execution"), <Mono key="e">{a.actionExecutionId}</Mono>],
                  [t("tasks.workflow"), <Mono key="w">{a.workflowId}</Mono>],
                  [
                    t("approvals.requirements"),
                    a.roleRequirements
                      .map((r) =>
                        t("approvals.requirement", {
                          selector: enumLabel(locale, approvalSelectorMessages, r.selector),
                          count: r.minDistinct,
                        }),
                      )
                      .join("; "),
                  ],
                ]}
              />
              <section className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">{t("approvals.decisions")}</h3>
                {a.decisions.length === 0 ? (
                  <p className="text-muted-foreground">{t("approvals.noDecisions")}</p>
                ) : (
                  <Table head={[t("platform.member"), t("platform.result"), t("platform.time")]}>
                    {a.decisions.map((d) => (
                      <tr key={d.approverPrincipalId}>
                        <Cell mono>{d.approverPrincipalId}</Cell>
                        <Cell>
                          <Badge tone={d.decision === ApprovalDecision.Approve ? "positive" : "negative"}>
                            {decisionLabel(d.decision)}
                          </Badge>
                        </Cell>
                        <Cell>
                          <When at={d.decidedAt} />
                        </Cell>
                      </tr>
                    ))}
                  </Table>
                )}
              </section>
              {confirming ? (
                <Confirm
                  prompt={
                    confirming === "withdraw"
                      ? t("approvals.confirmWithdraw")
                      : t("approvals.confirmDecision", { decision: decisionLabel(confirming) })
                  }
                  onConfirm={() => void run(confirming)}
                  onCancel={() => setConfirming(null)}
                />
              ) : controllable ? (
                <div className="flex gap-2">
                  {role === "approver" ? (
                    <>
                      <Button onClick={() => setConfirming(ApprovalDecision.Approve)}>
                        {t("approvals.approve")}
                      </Button>
                      <Button onClick={() => setConfirming(ApprovalDecision.Deny)}>{t("approvals.deny")}</Button>
                    </>
                  ) : (
                    <Button onClick={() => setConfirming("withdraw")}>{t("approvals.withdraw")}</Button>
                  )}
                </div>
              ) : null}
            </div>
          );
        }}
      </Resource>
    </div>
  );
}
