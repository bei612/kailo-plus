package workflows

import (
	"errors"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ComponentTask owns the execution history. There is no runner job registry or
// per-probe Core state machine. A lost mutating reply never repeats the write.
func componentRelease(ctx workflow.Context, in ComponentTaskInput) error {
	if in.ReleaseApproval != nil {
		return componentReleaseApproval(ctx, in)
	}
	plan := in.Release
	if plan == nil || len(plan.Steps) == 0 || len(in.ReleaseObservations) > len(plan.Steps) ||
		plan.WorkflowID != workflow.GetInfo(ctx).WorkflowExecution.ID {
		return temporal.NewNonRetryableApplicationError("组件登记缺冻结套件输入", activities.ErrTypeRejected, nil)
	}
	task := newTask(ctx, in)
	if err := task.begin(); err != nil {
		return task.fail(err)
	}
	plan.RunID = workflow.GetInfo(ctx).WorkflowExecution.RunID
	options := activityOptions()
	options.RetryPolicy.MaximumAttempts = 1
	ao := workflow.WithActivityOptions(ctx, options)
	for len(in.ReleaseObservations) < len(plan.Steps) {
		task.in = in
		task.project = projector(in)
		if in.CancelPending && !in.ReleaseReconcile {
			return task.cancel()
		}
		index := len(in.ReleaseObservations)
		probe := generated.ComponentConformanceProbe{Plan: *plan, StepIndex: int64(index)}
		if source := plan.Steps[index].ReferenceFromStepKey; source != nil {
			for _, previous := range in.ReleaseObservations {
				if previous.CaseKey == plan.Steps[index].CaseKey && previous.StepKey == *source {
					probe.ContentReference = previous.ContentReference
					break
				}
			}
			if probe.ContentReference == nil {
				return task.fail(temporal.NewNonRetryableApplicationError("原步骤缺真实内容引用", activities.ErrTypeRejected, nil))
			}
		}
		if in.ReleaseReconcile {
			reconcile := true
			probe.Reconcile = &reconcile
		}
		var observed generated.ComponentConformanceStepObservation
		err := workflow.ExecuteActivity(ao, (*activities.CoreAPI).RunComponentConformanceStep, probe).Get(ao, &observed)
		if err != nil {
			var application *temporal.ApplicationError
			pending := componentReleasePendingNative(in.ReleaseObservations, plan.Steps[index].IdempotencyKey)
			// A rejection before this probe is not proof that a previous
			// same-key execute has stopped. Keep the existing observation
			// responsibility; the next round can only reconcile, not cancel
			// or execute again. An Activity's checked terminal observation
			// may prove a failed protocol expectation without leaving work
			// in flight, unlike an authorization/configuration rejection.
			if pending && errors.As(err, &application) && application.HasDetails() {
				var actual generated.ComponentConformanceStepObservation
				if application.Details(&actual) == nil && actual.NativeObservation != nil {
					native := actual.NativeObservation
					pending = native.IdempotencyKey != plan.Steps[index].IdempotencyKey ||
						(native.PlatformStatus != generated.ExternalExecutionStatus("SUCCEEDED") &&
							native.PlatformStatus != generated.ExternalExecutionStatus("FAILED") &&
							native.PlatformStatus != generated.ExternalExecutionStatus("CANCELLED")) ||
						native.TerminalAt == nil || native.LastObservedAt == nil || native.NativeStatus == nil
				}
			}
			if errors.As(err, &application) && (application.Type() == activities.ErrTypeRejected ||
				(!in.ReleaseReconcile && application.Type() == activities.ErrTypeAdmissionDenied)) && !pending {
				// A definite protocol mismatch is not a native failure. The
				// suite failed to establish conformance; no release is written.
				return task.fail(err)
			}
			// Transport timeout, Worker crash and unknown native evidence all
			// keep the same attempt pending and select only protocol lookup.
			in.ReleaseReconcile = true
		} else if observed.NativeObservation != nil &&
			(observed.NativeObservation.PlatformStatus == generated.ExternalExecutionStatus("UNKNOWN") ||
				((in.CancelPending || plan.Steps[index].ContractKey != nil) && observed.NativeObservation.PlatformStatus != generated.ExternalExecutionStatus("SUCCEEDED"))) {
			status := string(observed.NativeObservation.PlatformStatus)
			if status == "FAILED" || status == "CANCELLED" {
				return task.fail(temporal.NewNonRetryableApplicationError("能力向量原生终态未成功", activities.ErrTypeRejected, nil))
			}
			in.ReleaseReconcile = true
		} else {
			in.ReleaseObservations = append(in.ReleaseObservations, observed)
			in.ReleaseReconcile = false
			continue
		}
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() {
			in.EventBase = eventID(ctx, in)
			return workflow.NewContinueAsNewError(ctx, ComponentTask, in)
		}
		if err := workflow.Sleep(ctx, retry.RoundInterval); err != nil {
			// Cancellation cannot certify an in-flight native side effect.
			// The disconnected original Workflow keeps reconciling that key.
			in.CancelPending = true
			ctx, _ = workflow.NewDisconnectedContext(ctx)
			task.ctx = ctx
			ao = workflow.WithActivityOptions(ctx, options)
		}
	}
	task.in = in
	task.project = projector(in)
	if in.CancelPending {
		return task.cancel()
	}
	observations := make([]generated.ObservationElement, len(in.ReleaseObservations))
	for index, observation := range in.ReleaseObservations {
		observations[index] = generated.ObservationElement(observation)
	}
	report := generated.ComponentConformanceObservation{
		ActionExecutionID: plan.ActionExecutionID, OperationID: plan.OperationID,
		WorkflowID: plan.WorkflowID, RunID: plan.RunID, ComponentReleaseID: plan.ComponentReleaseID,
		ArtifactDigest: plan.ArtifactDigest, ContractDigests: plan.ContractDigests,
		SuiteDigest: plan.SuiteDigest, PlanDigest: plan.PlanDigest, Observations: observations,
	}
	var receipt generated.ComponentReleaseReceipt
	if err := task.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).RecordComponentConformance, report)
	}, &receipt); err != nil {
		return task.fail(err)
	}
	if receipt.ActionExecutionID != plan.ActionExecutionID || receipt.ComponentReleaseID != plan.ComponentReleaseID ||
		receipt.PlanDigest != plan.PlanDigest || string(receipt.Status) != "REGISTERED" {
		return task.fail(temporal.NewNonRetryableApplicationError("登记回执与原执行不符", activities.ErrTypeRejected, nil))
	}
	return task.complete()
}

// Derived from original Workflow observations, not a second execution ledger.
// Later observations of the same native key supersede earlier RUNNING facts.
func componentReleasePendingNative(observations []generated.ComponentConformanceStepObservation, key string) bool {
	for index := len(observations) - 1; index >= 0; index-- {
		native := observations[index].NativeObservation
		if native == nil || native.IdempotencyKey != key {
			continue
		}
		switch string(native.PlatformStatus) {
		case "SUCCEEDED", "FAILED", "CANCELLED":
			return false
		default:
			return true
		}
	}
	return false
}
