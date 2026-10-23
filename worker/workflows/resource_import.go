package workflows

import (
	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// 06 §7.1、DD-42: the target-Tenant RESOURCE_IMPORT task. Core reads only the
// session-uploaded package bytes and recomputes the frozen digest; this loop
// owns retries and history and never carries the bytes or a source reference.
func resourceImport(ctx workflow.Context, in ComponentTaskInput) error {
	target := in.ResourceImport
	if target == nil || target.ActionExecutionID == "" || target.ResourceID == "" || target.VersionAssetID == "" || target.FormatKey == "" || len(target.PackageDigest) != 64 || target.WorkflowID != workflow.GetInfo(ctx).WorkflowExecution.ID || in.EventBase < 0 {
		return temporal.NewNonRetryableApplicationError("Resource import frozen target invalid", activities.ErrTypeRejected, nil)
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
		var result generated.ResourceImportAdvanceResult
		info := workflow.GetInfo(loop)
		err := workflow.ExecuteActivity(workflow.WithActivityOptions(loop, options), (*activities.CoreAPI).AdvanceResourceImport,
			generated.ResourceImportAdvanceRequest{Target: *target, RunID: info.WorkflowExecution.RunID, CancelRequested: in.CancelPending}).Get(loop, &result)
		status, reason := generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
		if err == nil && result.ResourceID == target.ResourceID {
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
			return temporal.NewNonRetryableApplicationError("Resource import authoritative refusal", activities.ErrTypeRejected, nil)
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
