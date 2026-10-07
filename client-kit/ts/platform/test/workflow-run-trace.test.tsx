import { describe, expect, it, vi } from "vitest";
import { ActionDispatchState, ActionGateState, ApprovalStatus, ReasonCode, TaskStatus,
  type AutomationRunView, type TaskView } from "@client-kit/contracts";
import { createBffClient } from "../src/client";
import { PlatformProvider } from "../src/react/context";
import { WorkflowRunTrace } from "../src/react/workflow-run-trace";
import { button, click, render } from "./render";

const task: TaskView = {
  operationId: "operation", actionExecutionId: "execution", actionKey: "automation.run", actionVersion: 1,
  targetId: "workflow", workspaceId: "workspace", gateState: ActionGateState.Allowed,
  dispatchState: ActionDispatchState.Dispatched, workflowId: "workflow-run",
  taskStatus: TaskStatus.Completed, createdAt: "2026-10-06T00:00:00Z",
};
const child: TaskView = {
  ...task, actionExecutionId: "approval-child", gateState: ActionGateState.Waiting,
  dispatchState: ActionDispatchState.NotDispatched, workflowId: undefined, taskStatus: undefined,
  approvalWorkflowId: "approval-workflow", approvalStatus: ApprovalStatus.Waiting,
};
async function setup(run: AutomationRunView, locale: "en" | "zh-CN" = "en") {
  const onOpen = vi.fn();
  const send = vi.fn(async () => ({ status: 503, body: undefined }));
  const host = await render(<PlatformProvider client={createBffClient({ send })} locale={locale}>
    <WorkflowRunTrace run={run} onOpen={onOpen} />
  </PlatformProvider>);
  return { host, onOpen, send };
}

describe("original workflow trace presentation over existing task references", () => {
  it("opens the exact parent and approval child without writing or claiming UNKNOWN completed", async () => {
    const { host, onOpen, send } = await setup({ task: { ...task, observation: ReasonCode.ExternalResultUnknown },
      stepApprovalTask: child, usageEventIds: [] });
    expect(host.textContent).toContain("Outcome not known yet");
    expect(host.textContent).toContain("Waiting for approval");
    expect(host.textContent).not.toContain("Completed");
    await click(button(host, "Step approval"));
    await click(button(host, "Action execution"));
    expect(onOpen.mock.calls).toEqual([["approval-child"], ["execution"]]);
    expect(send).not.toHaveBeenCalled();
  });

  it("shows only the actual parent when no approval reference or native step trace was returned", async () => {
    const { host } = await setup({ task, usageEventIds: [] });
    expect(host.querySelectorAll('[data-testid="workflow-execution-trace"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="workflow-approval-trace"]')).toBeNull();
    expect(host.textContent).toContain("Completed");
    expect(host.textContent).not.toMatch(/Step approval|No approval|step 1|Duration|Output/i);
  });

  it("renders real waiting reasons in Chinese using the shared Tasks translation", async () => {
    const { host } = await setup({ task: { ...task, taskStatus: TaskStatus.Running,
      waitingReason: "CONVERGENCE_PENDING" }, stepApprovalTask: child, usageEventIds: [] }, "zh-CN");
    expect(host.textContent).toContain("等待状态同步");
    expect(host.textContent).toContain("等待审批");
    expect(host.textContent).not.toContain("CONVERGENCE_PENDING");
    expect(host.textContent).not.toContain("Step approval");
  });

  it("keeps a stale failed projection neutral rather than presenting a confirmed failure", async () => {
    const { host } = await setup({ task: { ...task, taskStatus: TaskStatus.Failed,
      observation: ReasonCode.ProjectionDelayed }, usageEventIds: [] });
    expect(host.textContent).toContain("Status may be out of date");
    expect(host.textContent).not.toContain("Failed");
  });
});
