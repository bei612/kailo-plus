package workflows

import (
	"context"
	"testing"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

func TestAgentTaskConfirmedHandoffUsesFrozenObservation(t *testing.T) {
	for _, tc := range []struct {
		name       string
		reason     string
		finish     bool
		legacy     bool
		projectErr bool
		advanceErr bool
		want       time.Duration
	}{
		{name: "capacity completed holder", reason: "CAPACITY_UNAVAILABLE", finish: true, want: time.Second},
		{name: "usage convergence", reason: "BILLING_UNAVAILABLE", finish: true, want: time.Second},
		{name: "legacy history", reason: "CAPACITY_UNAVAILABLE", finish: true, legacy: true, want: time.Minute},
		{name: "unconfirmed holder", reason: "CAPACITY_UNAVAILABLE", want: time.Minute},
		{name: "unknown result", reason: "UNKNOWN_EXTERNAL_RESULT", finish: true, want: time.Minute},
		{name: "unknown reason", reason: "FUTURE_REASON", finish: true, want: time.Minute},
		{name: "approval pending", reason: "WAITING_APPROVAL", finish: true, want: time.Minute},
		{name: "projection ACK missing", reason: "CAPACITY_UNAVAILABLE", finish: true, projectErr: true, want: time.Minute},
		{name: "advance ACK missing", reason: "CAPACITY_UNAVAILABLE", finish: true, advanceErr: true, want: time.Minute},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env, in, _ := scheduleTaskTest(t)
			if tc.legacy {
				env.OnGetVersion("agent-task-confirmed-handoff-observation", workflow.DefaultVersion, workflow.Version(1)).Return(workflow.DefaultVersion)
			}
			projects, advances := 0, 0
			start := env.Now()
			env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(
				func(context.Context, generated.TaskStateReport) error {
					projects++
					if tc.projectErr && projects == 2 {
						return temporal.NewNonRetryableApplicationError("ACK unknown", activities.ErrTypeUnknownExternalResult, nil)
					}
					return nil
				})
			env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
				func(_ context.Context, actual generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
					advances++
					if actual != in {
						t.Fatal("handoff changed frozen invocation or authorization inputs")
					}
					if advances == 1 {
						out := generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING, WaitingReason: tc.reason, FinishActivity: tc.finish}
						if tc.advanceErr {
							return out, temporal.NewNonRetryableApplicationError("ACK unknown", activities.ErrTypeUnknownExternalResult, nil)
						}
						return out, nil
					}
					if elapsed := env.Now().Sub(start); elapsed != tc.want {
						t.Errorf("handoff waited %s, want %s", elapsed, tc.want)
					}
					return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.Completed, WaitingReason: "NONE", FinishActivity: true}, nil
				})
			env.ExecuteWorkflow(AgentTaskKind, in)
			if err := env.GetWorkflowError(); err != nil || advances != 2 || projects != 3 {
				t.Fatalf("handoff lost observation or terminal projection: error=%v advances=%d projects=%d", err, advances, projects)
			}
		})
	}
}

func TestAgentTaskConfirmedHandoffStillDrainsCancellation(t *testing.T) {
	env, in, _ := scheduleTaskTest(t)
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	advances := 0
	env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
		func(_ context.Context, actual generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
			advances++
			if actual.InvocationID != in.InvocationID {
				t.Fatal("cancellation changed invocation")
			}
			if advances == 1 {
				return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING, WaitingReason: "BILLING_UNAVAILABLE", FinishActivity: true}, nil
			}
			if !actual.CancelPending {
				t.Fatal("handoff dropped pending cancellation")
			}
			return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.Canceled, WaitingReason: "NONE", FinishActivity: true}, nil
		})
	env.RegisterDelayedCallback(env.CancelWorkflow, time.Second/2)
	env.ExecuteWorkflow(AgentTaskKind, in)
	if !temporal.IsCanceledError(env.GetWorkflowError()) || advances != 2 {
		t.Fatalf("cancellation did not drain original invocation: %v advances=%d", env.GetWorkflowError(), advances)
	}
}
