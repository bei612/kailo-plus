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
  type InvitationRedemptionView,
  ReasonCode,
  type TaskView,
  TaskStatus,
  TenantMembershipState,
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

/**
 * 一次意图的幂等键（UUID v4）。用 getRandomValues 而不是 randomUUID：后者只在安全
 * 上下文（https 或 localhost）里存在，本地部署经 http 访问网关。
 */
export function newIdempotencyKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type RedemptionPhase =
  | { kind: "active" }
  | { kind: "provisioning" }
  | { kind: "waiting" }
  | { kind: "evaluating" }
  | { kind: "ended"; reason?: ReasonCode }
  | { kind: "other" };

/**
 * 兑换者看到的进度（DD-83）：INVITED 且门禁 WAITING 即等待 admin 确认；REVOKED 即
 * 这次邀请已终结（reason 给出原因）；ACTIVE 即可以进入。其余组合如实显示原状态。
 */
export function redemptionPhase(view: InvitationRedemptionView): RedemptionPhase {
  switch (view.membershipState) {
    case TenantMembershipState.Active:
      return { kind: "active" };
    case TenantMembershipState.Provisioning:
      return { kind: "provisioning" };
    case TenantMembershipState.Revoked:
      return { kind: "ended", reason: view.reason };
    case TenantMembershipState.Invited:
      if (view.admissionGateState === ActionGateState.Waiting) return { kind: "waiting" };
      if (view.admissionGateState === ActionGateState.Evaluating) return { kind: "evaluating" };
      return { kind: "other" };
    default:
      return { kind: "other" };
  }
}

/** 审批仍接受决定与撤回（.design/06 §4 的未决状态）。 */
export function approvalOpen(status: ApprovalStatus): boolean {
  return status === ApprovalStatus.Requested || status === ApprovalStatus.Waiting;
}
