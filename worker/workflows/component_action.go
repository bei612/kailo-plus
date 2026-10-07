package workflows

import (
	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Native execution remains in its original service. This existing component
// Workflow only resumes the same AE/EE, including after a lost dispatch reply.
func componentAction(ctx workflow.Context, in ComponentTaskInput) error {
	target := in.ComponentAction
	if target == nil || target.ActionExecutionID == "" || target.BindingID == "" || target.BindingVersion < 1 || target.ComponentReleaseID == "" || target.ProjectionGeneration < 1 || target.WorkflowID != workflow.GetInfo(ctx).WorkflowExecution.ID || in.EventBase < 0 {
		return temporal.NewNonRetryableApplicationError("Component action frozen target invalid", activities.ErrTypeRejected, nil)
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
		options.RetryPolicy.NonRetryableErrorTypes = append(options.RetryPolicy.NonRetryableErrorTypes, activities.ErrTypeUnknownExternalResult)
		info := workflow.GetInfo(loop)
		var result generated.ComponentActionAdvanceResult
		err := workflow.ExecuteActivity(workflow.WithActivityOptions(loop, options), (*activities.CoreAPI).AdvanceComponentAction,
			generated.ComponentActionAdvanceRequest{Target: generated.ComponentActionAdvanceRequestTarget(*target), RunID: info.WorkflowExecution.RunID, CancelRequested: in.CancelPending}).Get(loop, &result)
		status, reason := generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
		if err == nil && result.ActionExecutionID == target.ActionExecutionID {
			switch result.Status {
			case generated.TaskStatusRUNNING, generated.TaskStatusCOMPLETED, generated.Canceled, generated.TaskStatusFAILED:
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
			switch status {
			case generated.TaskStatusCOMPLETED:
				return nil
			case generated.Canceled:
				return temporal.NewCanceledError()
			default:
				return temporal.NewNonRetryableApplicationError("Component action authoritative refusal", activities.ErrTypeRejected, nil)
			}
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
