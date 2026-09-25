import {
  ActionDispatchState,
  ActionGateState,
  ApprovalStatus,
  ErrorClass,
  ReasonCode,
  type ApprovalView,
  type TaskView,
  TaskStatus,
} from "@kailo/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { taskPhase } from "../src/governance";
import { PlatformProvider } from "../src/react/context";
import { ApprovalsPage, TasksPage } from "../src/react/governance";
import { type BffReply, type BffRequest, TransportError } from "../src/transport";
import { button, click, render, settle } from "./render";

const WF = "kailo:APPROVAL:t1:ae1:1";

const task = (over: Partial<TaskView> = {}): TaskView => ({
  operationId: "op-1",
  actionExecutionId: "ae1",
  actionKey: "tenant.member.revoke",
  actionVersion: 1,
  targetId: "tg1",
  gateState: ActionGateState.Allowed,
  dispatchState: ActionDispatchState.Dispatched,
  createdAt: new Date().toISOString(),
  ...over,
});

const approval = (over: Partial<ApprovalView> = {}): ApprovalView => ({
  workflowId: WF,
  actionExecutionId: "ae1",
  actionKey: "tenant.member.revoke",
  targetType: "tenant_membership",
  targetId: "tg1",
  initiatorPrincipalId: "p-init",
  status: ApprovalStatus.Waiting,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  decisions: [],
  roleRequirements: [{ selector: "TENANT_ADMIN" as ApprovalView["roleRequirements"][0]["selector"], minDistinct: 1 }],
  ...over,
});

type Route = (r: BffRequest) => BffReply | Promise<BffReply>;

function mount(route: Route, ui: React.ReactNode) {
  const send = vi.fn(async (r: BffRequest) => route(r));
  return { send, host: render(<PlatformProvider client={createBffClient({ send })} locale="en">{ui}</PlatformProvider>) };
}

const posts = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map(([r]) => r as BffRequest).filter((r) => r.method === "POST");

describe("taskPhase", () => {
  it("结果不明与投影落后不说成功也不说失败", () => {
    const unknown = taskPhase(task({ taskStatus: TaskStatus.Completed, workflowId: "w", observation: ReasonCode.ExternalResultUnknown }));
    expect(unknown).toEqual({ label: "tasks.status.unknown", tone: "neutral" });
    const delayed = taskPhase(task({ taskStatus: TaskStatus.Failed, workflowId: "w", observation: ReasonCode.ProjectionDelayed }));
    expect(delayed).toEqual({ label: "tasks.status.delayed", tone: "neutral" });
    expect(taskPhase(task({ dispatchState: ActionDispatchState.Unknown })).tone).toBe("neutral");
  });

  it("只有 Workflow 终态 COMPLETED 才是完成；派发了但没有投影只是「已开始」", () => {
    expect(taskPhase(task({ workflowId: "w" })).label).toBe("tasks.status.started");
    expect(taskPhase(task({ workflowId: "w", taskStatus: TaskStatus.Running })).label).toBe("tasks.status.running");
    expect(taskPhase(task({ workflowId: "w", taskStatus: TaskStatus.Completed }))).toEqual({
      label: "tasks.status.completed",
      tone: "positive",
    });
    // 同步动作没有 Workflow：Core 写成功后才记 DISPATCHED
    expect(taskPhase(task()).label).toBe("tasks.status.applied");
  });

  it("门禁结论先于派发", () => {
    expect(taskPhase(task({ gateState: ActionGateState.Waiting })).label).toBe("tasks.status.waitingApproval");
    expect(taskPhase(task({ gateState: ActionGateState.Denied })).tone).toBe("negative");
  });
});

describe("TasksPage", () => {
  it("读不到不是「没有任务」", async () => {
    const { host } = mount(() => {
      throw new TransportError("down");
    }, <TasksPage />);
    const el = await host;
    await settle();
    expect(el.textContent).toContain("the result is unknown");
    expect(el.textContent).not.toContain("not started any");
  });

  it("列表 → 详情：状态、原因、operation 与审批；撤回需确认并经 BFF", async () => {
    let status = ApprovalStatus.Waiting;
    const { send, host } = mount((r) => {
      if (r.path === "/api/v1/tasks")
        return { status: 200, body: [task({ gateState: ActionGateState.Waiting, approvalWorkflowId: WF, reason: ReasonCode.WaitingApproval })] };
      if (r.path === "/api/v1/tasks/ae1")
        return { status: 200, body: task({ gateState: status === ApprovalStatus.Waiting ? ActionGateState.Waiting : ActionGateState.Revoked, approvalWorkflowId: WF, reason: ReasonCode.WaitingApproval }) };
      if (r.path === `/api/v1/approvals/${encodeURIComponent(WF)}`) return { status: 200, body: approval({ status }) };
      if (r.method === "POST" && r.path === `/api/v1/approvals/${encodeURIComponent(WF)}/withdraw`) {
        status = ApprovalStatus.Cancelled;
        return { status: 200, body: { status } };
      }
      throw new Error(`未预期 ${r.method} ${r.path}`);
    }, <TasksPage />);
    const el = await host;
    await settle();
    expect(el.textContent).toContain("Waiting for approval");
    await click(button(el, "tenant.member.revoke"));
    expect(el.textContent).toContain("op-1");
    expect(el.textContent).toContain("Waiting for approval. (WAITING_APPROVAL)");
    expect(el.textContent).toContain("Organization admin: at least 1");
    await click(button(el, "Withdraw request"));
    // 先确认，未确认前不提交
    expect(posts(send)).toHaveLength(0);
    await click(button(el, "Confirm"));
    expect(posts(send)).toEqual([{ method: "POST", path: `/api/v1/approvals/${encodeURIComponent(WF)}/withdraw` }]);
    expect(el.textContent).toContain("The request is now: Withdrawn.");
    // 审批已终结：不再给撤回
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Withdraw request")).toBe(false);
  });

  it("撤回已确定而投影仍停在未决：不再给撤回，结论照旧显示", async () => {
    const { send, host } = mount((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [task({ approvalWorkflowId: WF })] };
      if (r.path === "/api/v1/tasks/ae1") return { status: 200, body: task({ approvalWorkflowId: WF }) };
      if (r.method === "POST") return { status: 200, body: { status: ApprovalStatus.Cancelled } };
      // 写回还没到 Core：投影仍是 WAITING
      return { status: 200, body: approval() };
    }, <TasksPage />);
    const el = await host;
    await settle();
    await click(button(el, "tenant.member.revoke"));
    await click(button(el, "Withdraw request"));
    await click(button(el, "Confirm"));
    expect(el.textContent).toContain("The request is now: Withdrawn.");
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Withdraw request");
    expect(posts(send)).toHaveLength(1);
  });

  it("投影不可担保时不给控制", async () => {
    const { host } = mount((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [task({ approvalWorkflowId: WF })] };
      if (r.path === "/api/v1/tasks/ae1") return { status: 200, body: task({ approvalWorkflowId: WF }) };
      return { status: 200, body: approval({ observation: ReasonCode.ProjectionDelayed }) };
    }, <TasksPage />);
    const el = await host;
    await settle();
    await click(button(el, "tenant.member.revoke"));
    expect(el.textContent).toContain("Status may be out of date");
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Withdraw request");
  });
});

describe("ApprovalsPage", () => {
  const openFirst = async (route: Route) => {
    const m = mount((r) => (r.path === "/api/v1/approvals" ? { status: 200, body: [approval()] } : route(r)), <ApprovalsPage />);
    const el = await m.host;
    await settle();
    await click(button(el, "tenant.member.revoke"));
    return { el, send: m.send };
  };

  it("批准需确认，经决定端点提交，显示记录后的状态", async () => {
    const { el, send } = await openFirst((r) =>
      r.method === "POST"
        ? { status: 200, body: { approverPrincipalId: "me", admitted: true, decision: "APPROVE", status: "APPROVED" } }
        : { status: 200, body: approval() },
    );
    await click(button(el, "Approve"));
    expect(el.textContent).toContain("cannot be changed afterwards");
    await click(button(el, "Confirm"));
    expect(posts(send)).toEqual([
      { method: "POST", path: `/api/v1/approvals/${encodeURIComponent(WF)}/decision`, body: { decision: "APPROVE" } },
    ]);
    expect(el.querySelector("[role=status]")?.textContent).toContain("Approved, not carried out yet");
  });

  it("结果不明：不说成功或失败，可原样重发同一决定", async () => {
    let calls = 0;
    const { el, send } = await openFirst((r) => {
      if (r.method !== "POST") return { status: 200, body: approval() };
      calls += 1;
      if (calls === 1) return { status: 503, body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "op-9" } };
      return { status: 200, body: { approverPrincipalId: "me", admitted: true, decision: "DENY", status: "DENIED" } };
    });
    await click(button(el, "Deny"));
    await click(button(el, "Confirm"));
    const alert = el.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toContain("not known");
    expect(alert).toContain("op-9");
    expect(alert).not.toContain("not accepted");
    await click(button(el, "Send the same decision again"));
    expect(posts(send).map((r) => r.body)).toEqual([{ decision: "DENY" }, { decision: "DENY" }]);
    expect(el.querySelector("[role=status]")?.textContent).toContain("Denied");
  });

  it("冲突与资格拒绝以用户能懂的话加 reason code 显示", async () => {
    const { el } = await openFirst((r) =>
      r.method === "POST"
        ? { status: 409, body: { class: ErrorClass.Conflict, reason: ReasonCode.DuplicateDecision, operationId: "op-2" } }
        : { status: 200, body: approval() },
    );
    await click(button(el, "Approve"));
    await click(button(el, "Confirm"));
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "Your decision was not accepted: You already recorded a different decision, which cannot be changed. (DUPLICATE_DECISION)",
    );
  });
});
