package workflows

import (
	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// The original ComponentTask owns retries and history. Existing references are
// rechecked, never converted into a native CREATE after a transport failure.
func resourceProvision(ctx workflow.Context, in ComponentTaskInput) error {
	target := in.ResourceProvision
	if target == nil || target.ActionExecutionID == "" || target.ResourceID == "" || target.ResourceVersion < 0 || target.BindingID == "" || target.BindingVersion < 1 || target.ComponentReleaseID == "" || target.ProjectionGeneration < 1 || target.NativeInstanceRef == "" || target.NativeScopeRef == "" || target.WorkflowID != workflow.GetInfo(ctx).WorkflowExecution.ID || in.EventBase < 0 {
		return temporal.NewNonRetryableApplicationError("Resource frozen target invalid", activities.ErrTypeRejected, nil)
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
		var result generated.ResourceProvisionAdvanceResult
		info := workflow.GetInfo(loop)
		err := workflow.ExecuteActivity(workflow.WithActivityOptions(loop, options), (*activities.CoreAPI).AdvanceResourceProvision,
			generated.ResourceProvisionAdvanceRequest{Target: generated.ResourceProvisionAdvanceRequestTarget(*target), RunID: info.WorkflowExecution.RunID, CancelRequested: in.CancelPending}).Get(loop, &result)
		status, reason := generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
		if err == nil && result.ResourceID == target.ResourceID {
			switch result.Status {
			case generated.TaskStatusRUNNING, generated.Completed, generated.TaskStatusFAILED:
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
			if status == generated.Completed {
				return nil
			}
			return temporal.NewNonRetryableApplicationError("Resource reference authoritative refusal", activities.ErrTypeRejected, nil)
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
