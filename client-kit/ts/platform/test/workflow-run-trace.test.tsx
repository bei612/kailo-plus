import { describe, expect, it, vi } from "vitest";
import { ActionDispatchState, ActionGateState, ApprovalStatus, AutomationStepStatus, ReasonCode, TaskStatus,
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
  it("opens only the evidenced approval child without writing or claiming UNKNOWN completed", async () => {
    const { host, onOpen, send } = await setup({ task: { ...task, observation: ReasonCode.ExternalResultUnknown },
      stepApprovalTask: child, usageEventIds: [], executionTrace: [
        { stepId: "publish", status: AutomationStepStatus.Unknown, output: { eventId: "original-event" }, error: ReasonCode.ExternalResultUnknown },
        { stepId: "approve", status: AutomationStepStatus.WaitingApproval, output: { actionExecutionId: child.actionExecutionId } },
      ] });
    expect(host.textContent).toContain("The outcome is not known yet; it is being reconciled.");
    expect(host.textContent).toContain("Waiting for approval");
    expect(host.textContent).not.toMatch(/completed/i);
    await click(button(host, "Step approval"));
    expect(onOpen.mock.calls).toEqual([["approval-child"]]);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not invent steps from the parent terminal status when old projections lack trace", async () => {
    const { host } = await setup({ task, usageEventIds: [] });
    expect(host.querySelector('[data-testid="workflow-run-trace"]')).toBeNull();
    expect(host.querySelector('[data-testid="workflow-approval-trace"]')).toBeNull();
    expect(host.textContent).toContain("No steps recorded yet.");
    expect(host.textContent).not.toMatch(/Step approval|No approval|step 1|Duration|Output/i);
  });

  it("renders real step approval evidence in Chinese using shared governance translations", async () => {
    const { host } = await setup({ task: { ...task, taskStatus: TaskStatus.Running,
      waitingReason: "CONVERGENCE_PENDING" }, stepApprovalTask: { ...child, waitingReason: "CONVERGENCE_PENDING" }, usageEventIds: [],
      executionTrace: [{ stepId: "approve", status: AutomationStepStatus.WaitingApproval, output: { actionExecutionId: child.actionExecutionId } }] }, "zh-CN");
    expect(host.textContent).toContain("等待状态同步");
    expect(host.textContent).toContain("等待审批");
    expect(host.textContent).not.toContain("CONVERGENCE_PENDING");
    expect(host.textContent).not.toContain("Step approval");
  });

  it.each([undefined, [], [{ stepId: "approve", status: AutomationStepStatus.Completed, output: { actionExecutionId: child.actionExecutionId } }]])(
    "preserves actual child governance navigation even when trace is absent or approval is terminal: %j", async (executionTrace) => {
      const { host, onOpen, send } = await setup({ task, stepApprovalTask: child, usageEventIds: [], executionTrace });
      await click(button(host, "Step approval"));
      expect(onOpen.mock.calls).toEqual([[child.actionExecutionId]]);
      expect(send).not.toHaveBeenCalled();
      expect(host.querySelector('[data-testid="workflow-approval-trace"]')).toBeNull();
    });

  it("shows native timer duration and references without fabricating future times or approval access", async () => {
    const { host } = await setup({ task, stepApprovalTask: child, usageEventIds: [], executionTrace: [
      { stepId: "delay", status: AutomationStepStatus.Completed, startedAt: "2026-10-06T00:00:00Z", completedAt: "2026-10-06T00:01:02Z", output: { runId: "native-run", historyEventId: 19 } },
      { stepId: "zero", status: AutomationStepStatus.Skipped, output: {} },
      { stepId: "future", status: AutomationStepStatus.Pending, output: {} },
      { stepId: "other-approval", status: AutomationStepStatus.WaitingApproval, output: { actionExecutionId: "other-child" } },
    ] });
    expect(host.textContent).toContain("62.0s");
    expect(host.textContent).toContain("skipped");
    expect(host.textContent).toContain("pending");
    expect(host.querySelectorAll("pre")).toHaveLength(2);
    expect(host.querySelector("pre")?.textContent).toContain('"historyEventId": 19');
    expect(host.querySelector('[data-testid="workflow-approval-trace"]')).toBeNull();
    expect(host.textContent).not.toContain("0ms");
  });
});
