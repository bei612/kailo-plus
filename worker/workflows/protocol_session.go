package workflows

import (
	"encoding/json"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// Generated nested types can share a schema without sharing their Go name.
// Use their actual wire representation, not a parallel handwritten DTO.
func protocolRequest(in ComponentTaskInput, run string) (generated.ProtocolSessionReconcileRequest, error) {
	value := map[string]interface{}{"target": in.ProtocolSession, "runId": run, "cancelRequested": in.CancelPending}
	if in.ProtocolSessionRound != nil {
		value["round"] = in.ProtocolSessionRound
	}
	raw, err := json.Marshal(value)
	var request generated.ProtocolSessionReconcileRequest
	if err == nil {
		err = json.Unmarshal(raw, &request)
	}
	return request, err
}

func protocolRound(out generated.ProtocolSessionReconcileResult) (*generated.ProtocolSessionReconcileRound, error) {
	raw, err := json.Marshal(out.Round)
	var round generated.ProtocolSessionReconcileRound
	if err == nil {
		err = json.Unmarshal(raw, &round)
	}
	return &round, err
}

// The initial target never changes. An Activity result is the only producer
// of a later round, so the query target is recorded in actual Temporal history
// before the next command. SAVED waits; it does not complete or restart this
// Workflow. Cancellation uses the same disconnected cleanup path and key.
func protocolSession(ctx workflow.Context, in ComponentTaskInput) error {
	target := in.ProtocolSession
	if target == nil || target.ProtocolSessionID == "" || target.ActionExecutionID != target.ProtocolSessionID ||
		target.SessionVersion <= 0 || target.WorkflowID != workflow.GetInfo(ctx).WorkflowExecution.ID ||
		target.BindingID == "" || target.ReleaseID == "" || target.ActionDefinitionID == "" ||
		target.ProjectionGeneration <= 0 || target.BaseRevision == "" || target.NativeObjectRef == "" ||
		target.CorrelationRef == "" || in.EventBase < 0 {
		return temporal.NewNonRetryableApplicationError("ProtocolSession frozen target invalid", activities.ErrTypeRejected, nil)
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
		request, err := protocolRequest(in, info.WorkflowExecution.RunID)
		if err != nil {
			return err
		}
		var result generated.ProtocolSessionReconcileResult
		err = workflow.ExecuteActivity(workflow.WithActivityOptions(loop, options),
			(*activities.CoreAPI).AdvanceProtocolSession, request).Get(loop, &result)
		status, reason := generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
		queryNext := false
		if err == nil && result.ProtocolSessionID == target.ProtocolSessionID {
			status, reason = result.Status, result.WaitingReason
			// This conversion preserves the exact Activity result. It cannot
			// change the initial input's base, binding or native reference.
			snapshot, parse := protocolRound(result)
			if parse == nil && status == generated.TaskStatusRUNNING && string(snapshot.State) == "UNKNOWN" &&
				snapshot.WriteObservation != nil && (string(snapshot.WriteObservation.Phase) == "ACCEPTED" ||
				string(snapshot.WriteObservation.Phase) == "FAILED" || string(snapshot.WriteObservation.Phase) == "CONFLICT") {
				in.ProtocolSessionRound = snapshot
				queryNext = true
			} else if parse == nil {
				in.ProtocolSessionRound = nil
			} else {
				status, reason = generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
			}
		}
		var waiting *string
		if reason != "NONE" {
			waiting = &reason
		}
		projected := workflow.ExecuteActivity(workflow.WithActivityOptions(loop, activityOptions()),
			(*activities.CoreAPI).ProjectAgentTaskState, generated.TaskStateReport{
				WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID,
				EventID: eventID(loop, in), Status: status, WaitingReason: waiting,
			}).Get(loop, nil)
		if projected == nil && status != generated.TaskStatusRUNNING {
			switch status {
			case generated.Completed:
				return nil
			case generated.Canceled:
				return temporal.NewCanceledError()
			default:
				return temporal.NewNonRetryableApplicationError("ProtocolSession confirmed failure", activities.ErrTypeRejected, nil)
			}
		}
		if !queryNext {
			if err := workflow.Sleep(loop, retry.RoundInterval); err != nil {
				continue
			}
		}
		if workflow.GetInfo(loop).GetContinueAsNewSuggested() {
			next := in
			next.EventBase = eventID(loop, in)
			return workflow.NewContinueAsNewError(loop, ComponentTaskKind, next)
		}
	}
}
