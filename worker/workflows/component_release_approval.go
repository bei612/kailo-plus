package workflows

import (
	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func componentReleaseApproval(ctx workflow.Context, in ComponentTaskInput) error {
	target := in.ReleaseApproval
	if target == nil || in.Release != nil || len(in.ReleaseObservations) != 0 || in.ReleaseReconcile ||
		target.WorkflowID != workflow.GetInfo(ctx).WorkflowExecution.ID {
		return temporal.NewNonRetryableApplicationError("组件批准缺原准入目标", activities.ErrTypeRejected, nil)
	}
	task := newTask(ctx, in)
	if in.CancelPending {
		return task.cancel()
	}
	if err := task.begin(); err != nil {
		return task.fail(err)
	}
	var receipt generated.ComponentReleaseReceipt
	if err := task.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).ApproveComponentRelease,
			generated.ComponentReleaseApprovalReport{Target: generated.TargetClass(*target), RunID: workflow.GetInfo(ctx).WorkflowExecution.RunID})
	}, &receipt); err != nil {
		return task.fail(err)
	}
	if receipt.ActionExecutionID != target.ActionExecutionID || receipt.ComponentReleaseID != target.ComponentReleaseID ||
		receipt.Status != generated.ComponentReleaseStatus("APPROVED") {
		return task.fail(temporal.NewNonRetryableApplicationError("批准回执与原执行不符", activities.ErrTypeRejected, nil))
	}
	return task.complete()
}
