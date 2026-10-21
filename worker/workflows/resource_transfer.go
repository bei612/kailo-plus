package workflows

import (
	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// resourceTransfer 执行 DD-42 的两段式转移中的一段（DD-131(2)(3)）：
// RESOURCE_EXPORT 在源 Tenant 生成 ExportPackage，RESOURCE_IMPORT 在目标 Tenant 以本会话上传的
// 包新建 Definition/DRAFT Version（团队另建 agent.team）。Workflow 只携带原 ActionExecution
// 引用与准入版本，不携带包字节、清单或 instructions；每轮由 Core 以原执行、WorkflowRef 与
// Temporal 观察核对后推进。结果不明投影为 RUNNING/UNKNOWN_EXTERNAL_RESULT，同一冻结目标重试，
// 不换键重发。
func resourceTransfer(ctx workflow.Context, in ComponentTaskInput) error {
	target := in.ResourceTransfer
	if target == nil || target.ActionExecutionID == "" || target.ActionKey == "" || target.TargetID == "" ||
		target.TargetVersion < 0 || target.WorkflowID != workflow.GetInfo(ctx).WorkflowExecution.ID || in.EventBase < 0 {
		return temporal.NewNonRetryableApplicationError("transfer frozen target invalid", activities.ErrTypeRejected, nil)
	}
	export := in.Kind == generated.WorkflowKind("RESOURCE_EXPORT")
	if export != (target.ActionKey == "agent.definition.export" || target.ActionKey == "agent.team.export") ||
		(!export && target.ActionKey != "agent.definition.import" && target.ActionKey != "agent.team.import") {
		return temporal.NewNonRetryableApplicationError("transfer kind and action differ", activities.ErrTypeRejected, nil)
	}
	loop := ctx
	if in.CancelPending {
		loop, _ = workflow.NewDisconnectedContext(ctx)
	}
	for {
		if ctx.Err() != nil && !in.CancelPending {
			in.CancelPending = true
			loop, _ = workflow.NewDisconnectedContext(ctx)
		}
		options := activityOptions()
		options.RetryPolicy.MaximumAttempts = 1
		var result generated.ResourceTransferAdvanceResult
		info := workflow.GetInfo(loop)
		err := workflow.ExecuteActivity(workflow.WithActivityOptions(loop, options), (*activities.CoreAPI).AdvanceResourceTransfer,
			generated.ResourceTransferAdvanceRequest{Target: *target, RunID: info.WorkflowExecution.RunID, CancelRequested: in.CancelPending}).Get(loop, &result)
		status, reason := generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
		if err == nil && result.ActionExecutionID == target.ActionExecutionID {
			switch result.Status {
			case generated.TaskStatusRUNNING, generated.TaskStatusCOMPLETED, generated.TaskStatusFAILED:
				status, reason = result.Status, result.WaitingReason
			}
		}
		var waiting *string
		if reason != "NONE" {
			waiting = &reason
		}
		projected := workflow.ExecuteActivity(workflow.WithActivityOptions(loop, activityOptions()), (*activities.CoreAPI).ProjectAgentTaskState,
			generated.TaskStateReport{WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID, EventID: eventID(loop, in), Status: status, WaitingReason: waiting}).Get(loop, nil)
		if projected == nil && status != generated.TaskStatusRUNNING {
			if status == generated.TaskStatusCOMPLETED {
				return nil
			}
			return temporal.NewNonRetryableApplicationError("transfer authoritative refusal", activities.ErrTypeRejected, nil)
		}
		if err := workflow.Sleep(loop, retry.RoundInterval); err != nil {
			continue
		}
		if workflow.GetInfo(loop).GetContinueAsNewSuggested() {
			in.EventBase = eventID(loop, in)
			return workflow.NewContinueAsNewError(loop, ComponentTask, in)
		}
	}
}
