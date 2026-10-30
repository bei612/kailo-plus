import {
  ActionDispatchState,
  ActionGateState,
  ApprovalStatus,
  ErrorClass,
  ReasonCode,
  type ApprovalView,
  type TaskView,
  TaskStatus,
} from "@client-kit/contracts";
import { describe, expect, it, vi } from "vitest";
import { createBffClient } from "../src/client";
import { taskPhase, taskProgress, taskSegment } from "../src/governance";
import { PlatformProvider } from "../src/react/context";
import { ApprovalsPage, TasksPage } from "../src/react/governance";
import { type BffReply, type BffRequest, TransportError } from "../src/transport";
import { button, click, render, settle } from "./render";

const WF = "platform:APPROVAL:t1:ae1:1";

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

function mount(route: Route, ui: React.ReactNode, locale: "en" | "zh-CN" = "en") {
  const send = vi.fn(async (r: BffRequest) => route(r));
  return { send, host: render(<PlatformProvider client={createBffClient({ send })} locale={locale}>{ui}</PlatformProvider>) };
}

const posts = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.map(([r]) => r as BffRequest).filter((r) => r.method === "POST");

/** DD-170 §16.6: confirmations are dialogs portalled beside the page. */
const dialog = () => document.querySelector<HTMLElement>("[data-testid$=-dialog][role=alertdialog], [role=alertdialog]");
const confirm = async () => click(document.querySelector<HTMLButtonElement>("[data-testid=confirm-dialog-action]")!);
/** Opens a task from the task page by its row. */
const openTask = async (el: HTMLElement, id = "ae1") => {
  // "Ended" is collapsed by default (.design/06 §8): expand it when the task is there.
  if (!el.querySelector(`[data-task-row="${id}"]`)) {
    const ended = el.querySelector<HTMLElement>("[data-testid=task-segment-ended]");
    if (ended) await click(button(ended, "Show"));
  }
  await click(el.querySelector<HTMLButtonElement>(`[data-task-row="${id}"] button`)!);
};
/** The open detail's own refresh (the hidden list keeps its own). */
const refresh = async (el: HTMLElement, detail = "task-detail") =>
  click(el.querySelector<HTMLButtonElement>(`[data-testid=${detail}] button[aria-label="Refresh"]`)!);
/** Task-page routes also read approvals waiting for me; none unless a test says otherwise. */
const withApprovals = (route: Route): Route => (r) =>
  r.method === "GET" && r.path === "/api/v1/approvals" ? { status: 200, body: [] } : route(r);

describe("taskPhase", () => {
  it("keeps future gate, dispatch and workflow values unknown", () => {
    for (const over of [{ gateState: "FUTURE" }, { dispatchState: "FUTURE" }, { taskStatus: "FUTURE" }]) {
      const value = JSON.parse(JSON.stringify({ ...task(), ...over }));
      expect(taskPhase(value)).toEqual({ label: "tasks.status.unknown", tone: "neutral" });
    }
  });
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

  it("取消控制的派发成功只表示请求被接收，不说原任务已取消", () => {
    expect(taskPhase(task({ actionKey: "task.cancel.workspace.create.v1" }))).toEqual({
      label: "tasks.status.cancelRequestAccepted",
      tone: "neutral",
    });
  });
});

describe("taskSegment", () => {
  it("never counts unknown or reconciling outcomes as ended", () => {
    expect(taskSegment(task({ dispatchState: ActionDispatchState.Unknown }))).toBe("attention");
    expect(taskSegment(task({ workflowId: "w", taskStatus: TaskStatus.Completed, observation: ReasonCode.ProjectionDelayed }))).toBe("attention");
    expect(taskSegment(task({ gateState: ActionGateState.Waiting }))).toBe("active");
    expect(taskSegment(task({ workflowId: "w", taskStatus: TaskStatus.Failed }))).toBe("ended");
    expect(taskSegment(task())).toBe("ended");
  });
  it("counts reached steps of admission, dispatch and execution", () => {
    expect(taskProgress(task({ gateState: ActionGateState.Waiting }))).toEqual({ done: 0, total: 2 });
    expect(taskProgress(task({ workflowId: "w", taskStatus: TaskStatus.Running }))).toEqual({ done: 2, total: 3 });
    expect(taskProgress(task({ workflowId: "w", taskStatus: TaskStatus.Completed }))).toEqual({ done: 3, total: 3 });
  });
});

describe("TasksPage", () => {
  it.each(["en", "zh-CN"] as const)("shows translated action and waiting condition with original codes in %s", async (locale) => {
    const value = task({ actionKey: "agent.invoke", workflowId: "w", taskStatus: TaskStatus.Running,
      waitingReason: "UNKNOWN_EXTERNAL_RESULT" });
    const { host } = mount(withApprovals((r) => r.path === "/api/v1/tasks"
      ? { status: 200, body: [value] } : { status: 200, body: value }), <TasksPage allowComponentActions={false} />, locale);
    const el = await host;
    await settle();
    expect(el.textContent).toContain(locale === "en" ? "Run Agent" : "运行 Agent");
    // DD-170 §16.5: the list shows the action's name, never its wire key.
    expect(el.querySelector("[data-testid=task-list]")?.textContent).not.toContain("agent.invoke");
    expect(el.querySelector("[data-testid=task-segment-active]")?.textContent).toContain(locale === "en" ? "Run Agent" : "运行 Agent");
    await openTask(el);
    expect(el.querySelector("[data-testid=technical-details]")?.textContent).toContain("agent.invoke");
    expect(el.querySelector('[title="UNKNOWN_EXTERNAL_RESULT"]')?.textContent)
      .toBe(locale === "en" ? "Outcome not known yet — waiting for reconciliation" : "结果尚不明确，等待对账");
    expect(el.querySelector('[title="ALLOWED · DISPATCHED · RUNNING"]')).not.toBeNull();
  });
  it("读不到不是「没有任务」", async () => {
    const { host } = mount(() => {
      throw new TransportError("down");
    }, <TasksPage />);
    const el = await host;
    await settle();
    // DD-170 §16.4: an unread list is an error with a retry, never the empty state.
    expect(el.querySelector("[data-testid=error-state]")).not.toBeNull();
    expect(el.querySelector("[data-testid=empty-state]")).toBeNull();
    expect(el.textContent).not.toContain("No tasks yet");
  });

  it("列表 → 详情：状态、原因、operation 与审批；撤回需确认并经 BFF", async () => {
    let status = ApprovalStatus.Waiting;
    const { send, host } = mount(withApprovals((r) => {
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
    }), <TasksPage />);
    const el = await host;
    await settle();
    expect(el.textContent).toContain("Waiting for approval");
    await openTask(el);
    expect(el.textContent).toContain("op-1");
    expect(el.textContent).toContain("Waiting for approval.");
    expect(el.textContent).not.toContain("WAITING_APPROVAL");
    expect(el.textContent).toContain("Organization admin: at least 1");
    await click(button(el, "Withdraw request"));
    // 先确认，未确认前不提交
    expect(posts(send)).toHaveLength(0);
    await confirm();
    expect(posts(send)).toEqual([{ method: "POST", path: `/api/v1/approvals/${encodeURIComponent(WF)}/withdraw` }]);
    expect(el.textContent).toContain("The request is now: Withdrawn.");
    // 审批已终结：不再给撤回
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Withdraw request")).toBe(false);
  });

  it("撤回已确定而投影仍停在未决：不再给撤回，结论照旧显示", async () => {
    const { send, host } = mount(withApprovals((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [task({ approvalWorkflowId: WF })] };
      if (r.path === "/api/v1/tasks/ae1") return { status: 200, body: task({ approvalWorkflowId: WF }) };
      if (r.method === "POST") return { status: 200, body: { status: ApprovalStatus.Cancelled } };
      // 写回还没到 Core：投影仍是 WAITING
      return { status: 200, body: approval() };
    }), <TasksPage />);
    const el = await host;
    await settle();
    await openTask(el);
    await click(button(el, "Withdraw request"));
    await confirm();
    expect(el.textContent).toContain("The request is now: Withdrawn.");
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Withdraw request");
    expect(posts(send)).toHaveLength(1);
  });

  // Live: Core closed the gate moments after the withdraw reply, but the detail
  // kept "Waiting for approval" until a manual refresh.
  it("re-reads the task and approval after a definite withdraw until they leave waiting", async () => {
    let withdrawn = false, lagging = 0;
    const { send, host } = mount(withApprovals((r) => {
      const settled = withdrawn && lagging-- <= 0;
      if (r.path === "/api/v1/tasks") return { status: 200, body: [task({ gateState: ActionGateState.Waiting, approvalWorkflowId: WF })] };
      if (r.path === "/api/v1/tasks/ae1") return { status: 200, body: task({ approvalWorkflowId: WF,
        gateState: settled ? ActionGateState.Revoked : ActionGateState.Waiting,
        reason: settled ? ReasonCode.ApprovalWithdrawn : ReasonCode.WaitingApproval }) };
      if (r.method === "POST") { withdrawn = true; lagging = 2; return { status: 200, body: { status: ApprovalStatus.Cancelled } }; }
      return { status: 200, body: approval({ status: settled ? ApprovalStatus.Cancelled : ApprovalStatus.Waiting }) };
    }), <TasksPage />);
    const el = await host;
    await settle();
    await openTask(el);
    expect(el.textContent).toContain("Waiting for approval.");
    expect(el.textContent).not.toContain("WAITING_APPROVAL");
    await click(button(el, "Withdraw request"));
    await confirm();
    expect(el.textContent).toContain("Waiting for approval.");
    expect(el.textContent).not.toContain("WAITING_APPROVAL");
    await vi.waitFor(async () => {
      await settle();
      expect(el.textContent).not.toContain("WAITING_APPROVAL");
      expect(el.textContent).toContain("The request was withdrawn.");
      expect(el.textContent).not.toContain("APPROVAL_WITHDRAWN");
    }, { timeout: 6000, interval: 200 });
    expect(posts(send)).toHaveLength(1);
  }, 10000);

  it("投影不可担保时不给控制", async () => {
    const { host } = mount(withApprovals((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [task({ approvalWorkflowId: WF })] };
      if (r.path === "/api/v1/tasks/ae1") return { status: 200, body: task({ approvalWorkflowId: WF }) };
      return { status: 200, body: approval({ observation: ReasonCode.ProjectionDelayed }) };
    }), <TasksPage />);
    const el = await host;
    await settle();
    await openTask(el);
    expect(el.textContent).toContain("Status may be out of date");
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Withdraw request");
  });

  it("只在详情取得 BFF 控制键后显示取消；提交的是原动作 ID，不是 Workflow ID", async () => {
    let terminal = false;
    const { host, send } = mount(withApprovals((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [task({ workflowId: "workflow-1" })] };
      if (r.path === "/api/v1/tasks/ae1")
        return { status: 200, body: task({ workflowId: "workflow-1", taskStatus: terminal ? TaskStatus.Canceled : TaskStatus.Running, cancelActionKey: terminal ? undefined : "task.cancel.workspace.create.v1", rerunActionKey: terminal ? "task.rerun.workspace.create.v1" : undefined }) };
      if (r.path === "/api/v1/actions")
        return { status: 202, body: { actionExecutionId: "cancel-ae", actionKey: "task.cancel.workspace.create.v1", operationId: "cancel-op", gateState: "ALLOWED", dispatchState: "NOT_DISPATCHED" } };
      throw new Error(`未预期 ${r.method} ${r.path}`);
    }), <TasksPage />);
    const el = await host;
    await settle();
    expect(el.textContent).not.toContain("Request cancellation");
    await openTask(el);
    await click(button(el, "Request cancellation"));
    expect(posts(send)).toHaveLength(0);
    await confirm();
    expect(posts(send)).toHaveLength(1);
    expect(posts(send)[0]?.body).toMatchObject({
      actionKey: "task.cancel.workspace.create.v1",
      originalActionExecutionId: "ae1",
    });
    expect(posts(send)[0]?.body).not.toHaveProperty("workflowId");
    expect(el.textContent).toContain("original task is not yet confirmed canceled");
    terminal = true;
    await refresh(el);
    await settle();
    expect(el.textContent).toContain("Canceled");
    expect(el.textContent).not.toContain("original task is not yet confirmed canceled");
    expect(el.textContent).toContain("Run again");
  });

  it("取消提交结果不明时使用同一幂等键重发，不产生第二次意图", async () => {
    let writes = 0;
    const { host, send } = mount(withApprovals((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [task()] };
      if (r.path === "/api/v1/tasks/ae1")
        return { status: 200, body: task({ cancelActionKey: writes === 0 ? "task.cancel.workspace.create.v1" : undefined }) };
      if (r.path === "/api/v1/actions") {
        writes += 1;
        if (writes === 1) throw new TransportError("connection lost");
        return { status: 202, body: { actionExecutionId: "cancel-ae", actionKey: "task.cancel.workspace.create.v1", operationId: "cancel-op", gateState: "ALLOWED", dispatchState: "UNKNOWN" } };
      }
      throw new Error(`未预期 ${r.method} ${r.path}`);
    }), <TasksPage />);
    const el = await host;
    await settle();
    await openTask(el);
    await click(button(el, "Request cancellation"));
    await confirm();
    expect(el.textContent).toContain("outcome is unknown");
    await click(button(el, "Resend same request"));
    expect(posts(send)).toHaveLength(2);
    expect((posts(send)[0]?.body as { idempotencyKey: string }).idempotencyKey).toBe(
      (posts(send)[1]?.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(el.textContent).not.toContain("original task is canceled");
  });

  it("重跑只使用详情下发的控制键，独立审批在新任务里呈现", async () => {
    const { host, send } = mount(withApprovals((r) => {
      if (r.path === "/api/v1/tasks")
        return { status: 200, body: [task({ taskStatus: TaskStatus.Failed, workflowId: "old-workflow" })] };
      if (r.path === "/api/v1/tasks/ae1")
        return {
          status: 200,
          body: task({
            taskStatus: TaskStatus.Failed,
            workflowId: "old-workflow",
            rerunActionKey: "task.rerun.tenant.member.revoke.v1",
          }),
        };
      if (r.path === "/api/v1/tasks/rerun-ae")
        return {
          status: 200,
          body: task({
            actionExecutionId: "rerun-ae",
            actionKey: "task.rerun.tenant.member.revoke.v1",
            gateState: ActionGateState.Waiting,
            dispatchState: ActionDispatchState.NotDispatched,
            approvalWorkflowId: WF,
          }),
        };
      if (r.path === "/api/v1/actions")
        return {
          status: 202,
          body: {
            actionExecutionId: "rerun-ae",
            actionKey: "task.rerun.tenant.member.revoke.v1",
            operationId: "rerun-op",
            gateState: "WAITING",
            dispatchState: "NOT_DISPATCHED",
          },
        };
      if (r.path === `/api/v1/approvals/${encodeURIComponent(WF)}`)
        return { status: 200, body: approval({ actionExecutionId: "rerun-ae" }) };
      throw new Error(`未预期 ${r.method} ${r.path}`);
    }), <TasksPage />);
    const el = await host;
    await settle();
    expect(el.textContent).not.toContain("Run again");
    await openTask(el);
    await click(button(el, "Run again"));
    expect(posts(send)).toHaveLength(0);
    await confirm();
    expect(posts(send)[0]?.body).toMatchObject({
      actionKey: "task.rerun.tenant.member.revoke.v1",
      originalActionExecutionId: "ae1",
    });
    expect(posts(send)[0]?.body).not.toHaveProperty("workflowId");
    expect(el.textContent).toContain("new task for approval");
    await click(button(el, "Open the new task"));
    expect(el.textContent).toContain("Waiting for approval");
  });
});

describe("TasksPage segments (.design/06 §8)", () => {
  it("groups by what to do next: approvals for me and unknown outcomes need action; ended is collapsed", async () => {
    const tasks = [
      task({ actionExecutionId: "ae-run", actionKey: "agent.invoke", workflowId: "w", taskStatus: TaskStatus.Running }),
      task({ actionExecutionId: "ae-done", actionKey: "workspace.create" }),
      task({ actionExecutionId: "ae-unk", actionKey: "tenant.admin.grant", dispatchState: ActionDispatchState.Unknown }),
    ];
    const { host, send } = mount((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: tasks };
      if (r.path === "/api/v1/approvals") return { status: 200, body: [approval({ workflowId: "wf-me" })] };
      if (r.path === "/api/v1/invitations") return { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } };
      if (r.path === `/api/v1/approvals/${encodeURIComponent("wf-me")}`) return { status: 200, body: approval({ workflowId: "wf-me" }) };
      throw new Error(`未预期 ${r.method} ${r.path}`);
    }, <TasksPage allowComponentActions={false} />);
    const el = await host;
    await settle();
    const attention = el.querySelector("[data-testid=task-segment-attention]") as HTMLElement;
    expect(attention.textContent).toContain("Remove organization member");
    expect(attention.textContent).toContain("Waiting for your decision");
    expect(attention.querySelector('[data-task-row="ae-unk"]')).not.toBeNull();
    expect(el.querySelector('[data-testid=task-segment-active] [data-task-row="ae-run"]')?.textContent).toContain("Step 2 of 3");
    const ended = el.querySelector("[data-testid=task-segment-ended]") as HTMLElement;
    expect(ended.querySelector('[data-task-row="ae-done"]')).toBeNull();
    await click(button(ended, "Show"));
    expect(ended.querySelector('[data-task-row="ae-done"]')?.textContent).toContain("View result");
    // The next step for an approval waiting for me opens that approval, not a bare decision.
    await click(button(attention, "Review"));
    expect(el.querySelector("[data-testid=approval-detail]")?.textContent).toContain("Remove organization member");
    expect(posts(send)).toHaveLength(0);
  });

  it("keeps the cancellation dialog open and disabled while the request is in flight", async () => {
    let finish: ((reply: BffReply) => void) | undefined;
    const { host, send } = mount(withApprovals((r) => {
      if (r.path === "/api/v1/tasks") return { status: 200, body: [task({ workflowId: "w", taskStatus: TaskStatus.Running })] };
      if (r.path === "/api/v1/tasks/ae1")
        return { status: 200, body: task({ workflowId: "w", taskStatus: TaskStatus.Running, cancelActionKey: "task.cancel.workspace.create.v1" }) };
      if (r.path === "/api/v1/actions") return new Promise<BffReply>((resolve) => { finish = resolve; });
      throw new Error(`未预期 ${r.method} ${r.path}`);
    }), <TasksPage />);
    const el = await host;
    await settle();
    await openTask(el);
    await click(button(el, "Request cancellation"));
    expect(dialog()?.textContent).toContain("Cancel this task?");
    await confirm();
    const action = document.querySelector<HTMLButtonElement>("[data-testid=confirm-dialog-action]");
    expect(action?.disabled).toBe(true);
    await click(action!);
    expect(posts(send)).toHaveLength(1);
    finish?.({ status: 202, body: { actionExecutionId: "cancel-ae", actionKey: "task.cancel.workspace.create.v1", operationId: "cancel-op", gateState: "ALLOWED", dispatchState: "DISPATCHED" } });
    await settle();
    expect(dialog()).toBeNull();
    expect(el.textContent).toContain("original task is not yet confirmed canceled");
  });
});

describe("ApprovalsPage", () => {
  const openFirst = async (route: Route) => {
    const m = mount(
      (r) =>
        r.path === "/api/v1/approvals"
          ? { status: 200, body: [approval()] }
          : r.path === "/api/v1/invitations"
            ? { status: 403, body: { class: ErrorClass.Denied, reason: ReasonCode.PermissionDenied } }
            : route(r),
      <ApprovalsPage />,
    );
    const el = await m.host;
    await settle();
    // DD-170 §16.2: the row opens the detail; the list shows the action's name, not its key.
    expect(el.querySelector("[data-testid=approval-table]")?.textContent).toContain("Remove organization member");
    expect(el.querySelector("[data-testid=approval-table]")?.textContent).not.toContain("tenant.member.revoke");
    await click(el.querySelector<HTMLElement>(`tr[data-row-key="${WF}"]`)!);
    return { el, send: m.send };
  };

  it("shows the immutable approval step request without changing UNKNOWN decision semantics", async () => {
    const step = {versionAssetId:"version-reference",id:"review-reply",name:"Review reply",message:"Review <b>this reply</b> before publication"};
    const {el, send} = await openFirst(() => ({status:200,body:approval({
      automationStep:step,observation:ReasonCode.ExternalResultUnknown,
    })}));
    expect(el.textContent).toContain(step.name);
    expect(el.textContent).toContain(step.message);
    expect(el.textContent).toContain(step.versionAssetId);
    expect(el.querySelector("b")).toBeNull();
    expect([...el.querySelectorAll("button")].some((node) => node.textContent === "Approve" && !node.disabled)).toBe(false);
    expect(posts(send)).toHaveLength(0);
  });

  it.each([
    ["waiting", approval()],
    ["terminal", approval({ status: ApprovalStatus.Consumed })],
    ["delayed", approval({ observation: ReasonCode.ProjectionDelayed })],
  ])("refresh clears the prior confirmation before a %s projection", async (_, refreshed) => {
    let reads = 0;
    const { el, send } = await openFirst(() => ({
      status: 200,
      body: ++reads === 1 ? approval() : refreshed,
    }));
    await click(button(el, "Approve"));
    expect(dialog()?.textContent).toContain("cannot be changed afterwards");
    await refresh(el, "approval-detail");
    expect(document.body.textContent).not.toContain("cannot be changed afterwards");
    expect(dialog()).toBeNull();
    expect(posts(send)).toHaveLength(0);
  });

  it.each([
    ["transport", 403],
    ["transport", 409],
    ["UNKNOWN", 403],
    ["UNKNOWN", 409],
  ] as const)("retains the original %s decision across repeated %s recheck refusals", async (initial, status) => {
    let writes = 0;
    let finishRetry: ((reply: BffReply) => void) | undefined;
    const refusal: BffReply = {
      status,
      body: {
        class: status === 403 ? ErrorClass.Denied : ErrorClass.Conflict,
        reason: status === 403 ? ReasonCode.ApproverNotEligible : ReasonCode.DuplicateDecision,
        operationId: "other-operation",
      },
    };
    const { el, send } = await openFirst((r) => {
      if (r.method !== "POST") return { status: 200, body: approval() };
      writes += 1;
      if (writes === 1) {
        if (initial === "transport") throw new TransportError("connection lost");
        return {
          status: 503,
          body: { class: ErrorClass.Unknown, reason: ReasonCode.DependencyUnavailable, operationId: "original-operation" },
        };
      }
      if (writes === 2) return new Promise<BffReply>((resolve) => { finishRetry = resolve; });
      if (writes === 3) return refusal;
      return { status: 200, body: { approverPrincipalId: "me", admitted: true, decision: "APPROVE", status: "APPROVED" } };
    });
    await click(button(el, "Approve"));
    await confirm();
    await click(button(el, "Send the same decision again"));
    // The original uncertainty remains visible even while the retry is in flight.
    expect(el.querySelector("[role=alert]")?.textContent).toContain("not known");
    expect(button(el, "Send the same decision again").disabled).toBe(true);
    expect(finishRetry).toBeDefined();
    finishRetry?.(refusal);
    await settle();
    await click(button(el, "Send the same decision again"));
    await refresh(el, "approval-detail");
    const alert = el.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toContain("not known");
    expect(alert).not.toContain("not accepted");
    expect(alert).not.toContain("other-operation");
    if (initial === "UNKNOWN") expect(alert).toContain("original-operation");
    const controls = [...el.querySelectorAll("button")].map((b) => b.textContent);
    expect(controls).not.toContain("Approve");
    expect(controls).not.toContain("Deny");
    expect(controls).not.toContain("Confirm");
    await click(button(el, "Send the same decision again"));
    expect(posts(send).map((r) => ({ path: r.path, body: r.body }))).toEqual(
      Array.from({ length: 4 }, () => ({
        path: `/api/v1/approvals/${encodeURIComponent(WF)}/decision`,
        body: { decision: "APPROVE" },
      })),
    );
    expect(el.querySelector("[role=status]")?.textContent).toContain("Approved, not carried out yet");
  });

  it("批准需确认，经决定端点提交，显示记录后的状态", async () => {
    const { el, send } = await openFirst((r) =>
      r.method === "POST"
        ? { status: 200, body: { approverPrincipalId: "me", admitted: true, decision: "APPROVE", status: "APPROVED" } }
        : { status: 200, body: approval() },
    );
    await click(button(el, "Approve"));
    expect(dialog()?.textContent).toContain("cannot be changed afterwards");
    expect(posts(send)).toHaveLength(0);
    await confirm();
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
    await confirm();
    const alert = el.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toContain("not known");
    expect(alert).toContain("op-9");
    expect(alert).not.toContain("not accepted");
    await click(button(el, "Send the same decision again"));
    expect(posts(send).map((r) => r.body)).toEqual([{ decision: "DENY" }, { decision: "DENY" }]);
    expect(el.querySelector("[role=status]")?.textContent).toContain("Denied");
  });

  it("冲突与资格拒绝只以用户能懂的话显示，正文不含 reason code", async () => {
    const { el } = await openFirst((r) =>
      r.method === "POST"
        ? { status: 409, body: { class: ErrorClass.Conflict, reason: ReasonCode.DuplicateDecision, operationId: "op-2" } }
        : { status: 200, body: approval() },
    );
    await click(button(el, "Approve"));
    await confirm();
    expect(el.querySelector("[role=alert]")?.textContent).toBe(
      "Your decision was not accepted: You already recorded a different decision, which cannot be changed.",
    );
    // A first, definite refusal is not an uncertain earlier decision.
    expect(button(el, "Approve").disabled).toBe(false);
    expect(button(el, "Deny").disabled).toBe(false);
  });
});
