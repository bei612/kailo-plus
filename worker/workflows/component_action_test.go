package workflows

import (
	"context"
	"errors"
	"testing"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

func TestComponentActionKeepsOriginalExecutionOnLostAcknowledgment(t *testing.T) {
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	target := generated.ComponentActionTarget{ActionExecutionID: "original-ae", BindingID: "binding", BindingVersion: 2,
		ComponentReleaseID: "release", ProjectionGeneration: 3, WorkflowID: t.Name()}
	calls, unknown := 0, 0
	env.OnActivity("AdvanceComponentAction", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ComponentActionAdvanceRequest) (generated.ComponentActionAdvanceResult, error) {
			calls++
			if request.Target != generated.ComponentActionAdvanceRequestTarget(target) || request.RunID == "" || request.CancelRequested {
				t.Fatal("retry substituted frozen execution or cancellation")
			}
			if calls == 1 {
				return generated.ComponentActionAdvanceResult{}, errors.New("native dispatch receipt lost")
			}
			if calls == 2 {
				return generated.ComponentActionAdvanceResult{ActionExecutionID: "other-ae", Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
			}
			return generated.ComponentActionAdvanceResult{ActionExecutionID: target.ActionExecutionID, Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
		})
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.TaskStateReport) error {
			if report.WorkflowID != target.WorkflowID {
				t.Fatal("projection escaped original workflow")
			}
			if report.Status == generated.TaskStatusRUNNING {
				unknown++
				if report.WaitingReason == nil || *report.WaitingReason != "UNKNOWN_EXTERNAL_RESULT" {
					t.Fatal("uncertainty lost")
				}
			}
			return nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{Kind: generated.WorkflowKind("COMPONENT_ACTION"), ComponentAction: &target})
	if err := env.GetWorkflowError(); err != nil || calls != 3 || unknown != 2 {
		t.Fatalf("calls=%d unknown=%d error=%v", calls, unknown, err)
	}
}

func TestComponentActionCancellationWaitsForAuthoritativeReceipt(t *testing.T) {
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	target := generated.ComponentActionTarget{ActionExecutionID: "original-ae", BindingID: "binding", BindingVersion: 2,
		ComponentReleaseID: "release", ProjectionGeneration: 3, WorkflowID: t.Name()}
	calls := 0
	env.OnActivity("AdvanceComponentAction", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ComponentActionAdvanceRequest) (generated.ComponentActionAdvanceResult, error) {
			calls++
			if !request.CancelRequested || request.Target != generated.ComponentActionAdvanceRequestTarget(target) {
				t.Fatal("cancel resumed as a fresh action")
			}
			status, reason := generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
			if calls == 2 {
				status, reason = generated.Canceled, "NONE"
			}
			return generated.ComponentActionAdvanceResult{ActionExecutionID: target.ActionExecutionID, Status: status, WaitingReason: reason}, nil
		})
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{Kind: generated.WorkflowKind("COMPONENT_ACTION"), ComponentAction: &target, CancelPending: true})
	if env.GetWorkflowError() == nil || calls != 2 {
		t.Fatalf("cancel not reconciled: calls=%d error=%v", calls, env.GetWorkflowError())
	}
}
