package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

func protocolSessionTest(t *testing.T) (*testsuite.TestWorkflowEnvironment, ComponentTaskInput) {
	t.Helper()
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	target := generated.ProtocolSessionReconcileTarget{ActionExecutionID: "original-session", ProtocolSessionID: "original-session",
		SessionVersion: 8, WorkflowID: t.Name(), BindingID: "original-binding", ReleaseID: "original-release",
		ProjectionGeneration: 2, ActionDefinitionID: "original-definition", BaseRevision: "base-v1",
		NativeObjectRef: "original-node", CorrelationRef: "first-write"}
	return env, ComponentTaskInput{Kind: generated.ProtocolSessionReconcile, ProtocolSession: &target}
}

func protocolResult(in ComponentTaskInput, version int64, state string, status generated.TaskStatus, write string) generated.ProtocolSessionReconcileResult {
	out := generated.ProtocolSessionReconcileResult{ProtocolSessionID: in.ProtocolSession.ProtocolSessionID,
		Round:  generated.RoundClass{SessionVersion: version, State: generated.ProtocolSessionViewState(state)},
		Status: status, WaitingReason: "NONE"}
	if status == generated.TaskStatusRUNNING {
		out.WaitingReason = "PROTOCOL_SESSION_OPEN"
	}
	if state == "UNKNOWN" {
		out.WaitingReason = "UNKNOWN_EXTERNAL_RESULT"
	}
	if write != "" {
		revision, etag := "revision-"+write, "etag-"+write
		out.Round.WriteObservation = &generated.WriteObservationClass{Phase: generated.Phase("ACCEPTED"),
			CorrelationRef: write, ResultRevision: &revision, NativeEtag: &etag, BytesWritten: 10,
			BaseModifiedAt: time.Unix(10, 0).UTC(), Editors: "native-human"}
	}
	return out
}

func assertProtocolTarget(t *testing.T, in ComponentTaskInput, request generated.ProtocolSessionReconcileRequest) {
	t.Helper()
	if request.Target != generated.ProtocolSessionReconcileRequestTarget(*in.ProtocolSession) || request.RunID == "" {
		t.Fatal("round replaced the frozen initial Session, base, binding or identity")
	}
}

func TestProtocolSessionSavedKeepsOneWorkflowForLaterSave(t *testing.T) {
	env, in := protocolSessionTest(t)
	calls := 0
	env.OnActivity("AdvanceProtocolSession", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ProtocolSessionReconcileRequest) (generated.ProtocolSessionReconcileResult, error) {
			calls++
			assertProtocolTarget(t, in, request)
			switch calls {
			case 1:
				if request.Round != nil {
					t.Fatal("first round invented evidence")
				}
				return protocolResult(in, 8, "UNKNOWN", generated.TaskStatusRUNNING, "first-write"), nil
			case 2:
				if request.Round == nil || request.Round.SessionVersion != 8 || request.Round.WriteObservation.CorrelationRef != "first-write" {
					t.Fatal("query did not consume the Activity-history snapshot")
				}
				return protocolResult(in, 9, "SAVED", generated.TaskStatusRUNNING, "first-write"), nil
			case 3:
				if request.Round != nil {
					t.Fatal("SAVED did not close only the old query round")
				}
				return protocolResult(in, 11, "UNKNOWN", generated.TaskStatusRUNNING, "second-write"), nil
			case 4:
				if request.Round == nil || request.Round.SessionVersion != 11 || request.Round.WriteObservation.CorrelationRef != "second-write" {
					t.Fatal("later save reused the old round or unfrozen callback evidence")
				}
				return protocolResult(in, 12, "SAVED", generated.TaskStatusRUNNING, "second-write"), nil
			case 5:
				if request.Round != nil {
					t.Fatal("second SAVED left a stale query")
				}
				return protocolResult(in, 13, "EXPIRED", generated.TaskStatusCOMPLETED, "second-write"), nil
			default:
				t.Fatal("unexpected round")
				return generated.ProtocolSessionReconcileResult{}, nil
			}
		})
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if err := env.GetWorkflowError(); err != nil || calls != 5 {
		t.Fatalf("calls=%d error=%v", calls, err)
	}
}

func TestProtocolSessionLostQueryAcknowledgmentRetainsExactRound(t *testing.T) {
	env, in := protocolSessionTest(t)
	calls := 0
	var lost *generated.RoundClass
	env.OnActivity("AdvanceProtocolSession", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ProtocolSessionReconcileRequest) (generated.ProtocolSessionReconcileResult, error) {
			calls++
			assertProtocolTarget(t, in, request)
			if calls == 1 {
				return protocolResult(in, 8, "UNKNOWN", generated.TaskStatusRUNNING, "first-write"), nil
			}
			if calls == 2 {
				lost = request.Round
				return generated.ProtocolSessionReconcileResult{}, errors.New("original query ACK lost")
			}
			if calls == 3 {
				if lost == nil || !reflect.DeepEqual(lost, request.Round) {
					t.Fatal("lost ACK replaced or discarded the query round")
				}
				return protocolResult(in, 9, "SAVED", generated.TaskStatusRUNNING, "first-write"), nil
			}
			return protocolResult(in, 10, "CLOSED", generated.TaskStatusCOMPLETED, "first-write"), nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if err := env.GetWorkflowError(); err != nil || calls != 4 {
		t.Fatalf("calls=%d error=%v", calls, err)
	}
}

func TestProtocolSessionLateZeroWriteOutcomeFreezesSameRound(t *testing.T) {
	for _, phase := range []string{"FAILED", "CONFLICT"} {
		t.Run(phase, func(t *testing.T) {
			env, in := protocolSessionTest(t)
			calls := 0
			env.OnActivity("AdvanceProtocolSession", mock.Anything, mock.Anything).Return(
				func(_ context.Context, request generated.ProtocolSessionReconcileRequest) (generated.ProtocolSessionReconcileResult, error) {
					calls++
					assertProtocolTarget(t, in, request)
					if calls == 1 {
						out := protocolResult(in, 8, "UNKNOWN", generated.TaskStatusRUNNING, "")
						out.Round.WriteObservation = &generated.WriteObservationClass{Phase: generated.Phase(phase),
							CorrelationRef: "first-write", BytesWritten: 0, BaseModifiedAt: time.Unix(10, 0).UTC(), Editors: "native-human"}
						return out, nil
					}
					if request.Round == nil || request.Round.SessionVersion != 8 ||
						string(request.Round.WriteObservation.Phase) != phase || request.Round.WriteObservation.BytesWritten != 0 {
						t.Fatal("late definite writer outcome did not consume its exact Activity-history round")
					}
					return protocolResult(in, 9, "FAILED", generated.TaskStatusFAILED, ""), nil
				})
			env.ExecuteWorkflow(ComponentTaskKind, in)
			if env.GetWorkflowError() == nil || calls != 2 {
				t.Fatalf("calls=%d error=%v", calls, env.GetWorkflowError())
			}
		})
	}
}

func TestProtocolSessionCancellationDrainsUnknownSameSession(t *testing.T) {
	env, in := protocolSessionTest(t)
	calls := 0
	env.RegisterDelayedCallback(env.CancelWorkflow, retry.RoundInterval/2)
	env.OnActivity("AdvanceProtocolSession", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ProtocolSessionReconcileRequest) (generated.ProtocolSessionReconcileResult, error) {
			calls++
			assertProtocolTarget(t, in, request)
			if calls == 1 {
				return generated.ProtocolSessionReconcileResult{}, errors.New("native write status unconfirmed")
			}
			if !request.CancelRequested {
				t.Fatal("cancellation was not preserved in disconnected cleanup")
			}
			if calls == 2 {
				return protocolResult(in, 8, "UNKNOWN", generated.TaskStatusRUNNING, "first-write"), nil
			}
			if request.Round == nil {
				t.Fatal("cancel abandoned the committed original write")
			}
			return protocolResult(in, 10, "REVOKED", generated.Canceled, "first-write"), nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if err := env.GetWorkflowError(); !temporal.IsCanceledError(err) || calls != 3 {
		t.Fatalf("calls=%d error=%v", calls, err)
	}
}

func TestProtocolSessionContinueAsNewCarriesInitialAndPendingRound(t *testing.T) {
	env, in := protocolSessionTest(t)
	// The SDK test environment reports zero current-history length. Preserve
	// a prior run's real event base rather than inventing history in this test.
	in.EventBase = 7
	calls := 0
	env.RegisterDelayedCallback(func() { env.CancelWorkflow(); env.SetContinueAsNewSuggested(true) }, retry.RoundInterval/2)
	env.OnActivity("AdvanceProtocolSession", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ProtocolSessionReconcileRequest) (generated.ProtocolSessionReconcileResult, error) {
			calls++
			if calls == 1 {
				return protocolResult(in, 8, "UNKNOWN", generated.TaskStatusRUNNING, "first-write"), nil
			}
			return generated.ProtocolSessionReconcileResult{}, errors.New("query outcome unconfirmed")
		})
	env.ExecuteWorkflow(ComponentTaskKind, in)
	var continued *workflow.ContinueAsNewError
	if !errors.As(env.GetWorkflowError(), &continued) {
		t.Fatalf("unknown session did not continue: %v", env.GetWorkflowError())
	}
	var next ComponentTaskInput
	if err := converter.GetDefaultDataConverter().FromPayloads(continued.Input, &next); err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(in.ProtocolSession)
	after, _ := json.Marshal(next.ProtocolSession)
	if string(before) != string(after) || !next.CancelPending || next.ProtocolSessionRound == nil ||
		next.ProtocolSessionRound.SessionVersion != 8 || next.ProtocolSessionRound.WriteObservation.CorrelationRef != "first-write" ||
		continued.WorkflowType.Name != ComponentTaskKind || next.EventBase < in.EventBase {
		t.Fatal("continuation lost initial input, original round, cancellation or projection sequence")
	}
}
