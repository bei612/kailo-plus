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
	// DD-127: Core freezes an empty suite only for a release without any
	// contract (a native page entry has no adapter to test); the loop below
	// then records the original report directly.
	if plan == nil || (len(plan.Steps) == 0) != (len(plan.ContractDigests) == 0) ||
		len(in.ReleaseObservations) > len(plan.Steps) ||
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
		if err := componentReleaseCaptures(&probe, plan.Steps[index], in.ReleaseObservations); err != nil {
			return task.fail(err)
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
		} else if observed.NativeReceiverObservation != nil && !observed.NativeReceiverObservation.Completed {
			// The native batch already exists. Keep its frozen key/deadline
			// through ContinueAsNew and only observe; never run ManualSync again.
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
	// Always a JSON array: Observations is required even before the first step.
	observations := append([]generated.ComponentConformanceStepObservation{}, in.ReleaseObservations...)
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

// DD-124(2): a CAPTURE binding reads only a value recorded by an earlier
// accepted observation of the same case in this Workflow's own history. An
// EXPECTED binding to this step's own capture keeps its placeholder; Core
// normalizes the actual result there. Plans without bindings add nothing.
func componentReleaseCaptures(probe *generated.ComponentConformanceProbe, step generated.ComponentConformanceStep, observations []generated.ComponentConformanceStepObservation) error {
	own := make(map[string]bool)
	for _, capture := range step.Captures {
		own[capture.Key] = true
	}
	added := make(map[string]bool)
	for _, binding := range step.Bindings {
		if string(binding.Source) != "CAPTURE" || own[binding.Key] || added[binding.Key] {
			continue
		}
		added[binding.Key] = true
		found := false
		for _, previous := range observations {
			if previous.CaseKey != step.CaseKey {
				continue
			}
			for _, value := range previous.Captures {
				if !found && value.Key == binding.Key {
					probe.Captures = append(probe.Captures, value)
					found = true
				}
			}
		}
		if !found {
			return temporal.NewNonRetryableApplicationError("捕获值缺同 case 的实际观察", activities.ErrTypeRejected, nil)
		}
	}
	return nil
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
