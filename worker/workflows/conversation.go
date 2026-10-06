package workflows

import (
	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Native DM projection is one kind on the existing durable lifecycle engine.
func conversationProjection(ctx workflow.Context, in ComponentTaskInput) error {
	target := in.Conversation
	if target == nil || target.ActionExecutionID == "" || target.ConversationID == "" || target.WorkflowID != workflow.GetInfo(ctx).WorkflowExecution.ID {
		return temporal.NewNonRetryableApplicationError("DM projection target invalid", activities.ErrTypeRejected, nil)
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
		var result generated.ConversationProjectionResult
		err := workflow.ExecuteActivity(workflow.WithActivityOptions(loop, activityOptions()), (*activities.CoreAPI).ProjectConversation,
			generated.ConversationProjectionRequest{Target: generated.ConversationProjectionRequestTarget(*target), RunID: workflow.GetInfo(loop).WorkflowExecution.RunID}).Get(loop, &result)
		status, reason := generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
		if err == nil && result.ConversationID == target.ConversationID && result.Status == generated.Completed && result.WaitingReason == "NONE" {
			status, reason = generated.Completed, "NONE"
		}
		var waiting *string
		if reason != "NONE" {
			waiting = &reason
		}
		if projector(in)(loop, status, waiting).Get(loop, nil) == nil && status == generated.Completed {
			return nil
		}
		// Cancel never substitutes for an acknowledgment of the same native DM.
		if err := workflow.Sleep(loop, retry.RoundInterval); err != nil {
			continue
		}
		if workflow.GetInfo(loop).GetContinueAsNewSuggested() {
			in.EventBase = eventID(loop, in)
			return workflow.NewContinueAsNewError(loop, ComponentTask, in)
		}
	}
}
