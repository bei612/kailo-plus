package workflows

import (
	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// AGENT_INSTALLATION is a kind of the existing ComponentTaskWorkflow, not a new
// Workflow authority. All progress and termination use its original reference.
func agentInstallation(ctx workflow.Context, in ComponentTaskInput) error {
	target := in.Installation
	if target == nil || target.ActionExecutionID == "" || target.InstallationID == "" ||
		target.AgentVersionAssetID == "" || target.ProjectionGeneration <= 0 || in.EventBase < 0 {
		return temporal.NewNonRetryableApplicationError("Installation 冻结输入不成立", activities.ErrTypeRejected, nil)
	}
	project := func(c workflow.Context, status generated.TaskStatus, waiting string) error {
		var reason *string
		if waiting != "NONE" {
			reason = &waiting
		}
		info := workflow.GetInfo(c)
		return workflow.ExecuteActivity(workflow.WithActivityOptions(c, activityOptions()),
			(*activities.CoreAPI).ProjectAgentTaskState, generated.TaskStateReport{
				WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID,
				EventID: eventID(c, in), Status: status, WaitingReason: reason,
			}).Get(c, nil)
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
		// Native results may be unknown: the next durable round advances the same
		// Core intent, rather than transparently replaying this Activity attempt.
		options.RetryPolicy.MaximumAttempts = 1
		options.RetryPolicy.NonRetryableErrorTypes = append(options.RetryPolicy.NonRetryableErrorTypes, activities.ErrTypeUnknownExternalResult)
		var out generated.AgentInstallationAdvanceResult
		info := workflow.GetInfo(loop)
		err := workflow.ExecuteActivity(workflow.WithActivityOptions(loop, options),
			(*activities.CoreAPI).AdvanceAgentInstallation, generated.AgentInstallationAdvanceRequest{
				ActionExecutionID: target.ActionExecutionID, InstallationID: target.InstallationID,
				AgentVersionAssetID: target.AgentVersionAssetID, ProjectionGeneration: target.ProjectionGeneration,
				WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID,
				CancelRequested: in.CancelPending,
			}).Get(loop, &out)
		status, reason := generated.Running, "UNKNOWN_EXTERNAL_RESULT"
		if err == nil {
			status, reason = out.Status, out.WaitingReason
		}
		if err := project(loop, status, reason); err == nil && status != generated.Running {
			switch status {
			case generated.Completed:
				return nil
			case generated.Canceled:
				return temporal.NewCanceledError()
			default:
				return temporal.NewNonRetryableApplicationError("Installation 权威事实确认失败", activities.ErrTypeRejected, nil)
			}
		}
		if err := workflow.Sleep(loop, retry.RoundInterval); err != nil {
			continue
		}
		if workflow.GetInfo(loop).GetContinueAsNewSuggested() {
			next := in
			next.EventBase = eventID(loop, in)
			return workflow.NewContinueAsNewError(loop, ComponentTask, next)
		}
	}
}
