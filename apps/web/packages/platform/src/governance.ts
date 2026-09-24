// 任务工作台的状态解读（.design/06 §3.1、§9；apps/06 §4）。Web 与 Desktop 用同一份。
//
// 一项任务的状态由两台独立状态机（门禁、派发）加上 Workflow 投影组成。这里只把它们
// 折成用户能读的一句话与色调，不推断任何服务端没有说的事实：
//
// - `observation` 非空即投影不可担保为当前（PROJECTION_DELAYED）或结果不明
//   （EXTERNAL_RESULT_UNKNOWN）。此时一律显示「等待对账」，不渲染成成功或失败；
// - 只有 Workflow 的终态 COMPLETED 才是「完成」；没有 Workflow 的同步动作以派发
//   DISPATCHED 为终态（Core 写成功后才记，结果不明时记 UNKNOWN）；
// - 其余的否定结论都来自门禁或 Workflow 自己的终态。

import {
  ActionDispatchState,
  ActionGateState,
  ApprovalStatus,
  ReasonCode,
  type TaskView,
  TaskStatus,
} from "@kailo/contracts";
import type { PlatformMessageKey } from "./i18n";
import type { Tone } from "./react/ui";

export type TaskPhase = { label: PlatformMessageKey; tone: Tone };

const phase = (label: PlatformMessageKey, tone: Tone = "neutral"): TaskPhase => ({ label, tone });

const terminal: Record<TaskStatus, TaskPhase> = {
  [TaskStatus.Running]: phase("tasks.status.running"),
  [TaskStatus.Completed]: phase("tasks.status.completed", "positive"),
  [TaskStatus.Failed]: phase("tasks.status.failed", "negative"),
  [TaskStatus.Canceled]: phase("tasks.status.canceled", "negative"),
  [TaskStatus.Terminated]: phase("tasks.status.terminated", "negative"),
  [TaskStatus.TimedOut]: phase("tasks.status.timedOut", "negative"),
};

export function taskPhase(task: TaskView): TaskPhase {
  if (task.observation === ReasonCode.ExternalResultUnknown) return phase("tasks.status.unknown");
  if (task.observation !== undefined) return phase("tasks.status.delayed");
  switch (task.gateState) {
    case ActionGateState.Evaluating:
      return phase("tasks.status.evaluating");
    case ActionGateState.Waiting:
      return phase("tasks.status.waitingApproval");
    case ActionGateState.Denied:
      return phase("tasks.status.denied", "negative");
    case ActionGateState.Revoked:
      return phase("tasks.status.revoked", "negative");
    case ActionGateState.Expired:
      return phase("tasks.status.expired", "negative");
    case ActionGateState.Allowed:
      break;
  }
  switch (task.dispatchState) {
    case ActionDispatchState.NotDispatched:
      return phase("tasks.status.notStarted");
    case ActionDispatchState.Aborted:
      return phase("tasks.status.aborted", "negative");
    case ActionDispatchState.Unknown:
      return phase("tasks.status.unknown");
    case ActionDispatchState.Dispatched:
      break;
  }
  if (task.workflowId === undefined) return phase("tasks.status.applied", "positive");
  return task.taskStatus === undefined ? phase("tasks.status.started") : terminal[task.taskStatus];
}

/** 审批仍接受决定与撤回（.design/06 §4 的未决状态）。 */
export function approvalOpen(status: ApprovalStatus): boolean {
  return status === ApprovalStatus.Requested || status === ApprovalStatus.Waiting;
}
