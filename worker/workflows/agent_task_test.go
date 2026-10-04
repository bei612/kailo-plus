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
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

func scheduleTaskTest(t *testing.T) (*testsuite.TestWorkflowEnvironment, generated.AgentTaskWorkflowInput, json.RawMessage) {
	t.Helper()
	Configure(Retry{StartToClose: 10 * time.Second, ScheduleToClose: 20 * time.Second,
		InitialInterval: time.Second, MaxInterval: time.Second, MaxAttempts: 1, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(AgentTask, workflow.RegisterOptions{Name: AgentTaskKind})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	in := generated.AgentTaskWorkflowInput{InvocationID: "invocation", InstallationID: "installation", AgentVersionAssetID: "version",
		ProjectionGeneration: 1, HeartbeatTimeoutSeconds: 3, HeartbeatIntervalSeconds: 1, ObservationIntervalSeconds: 1}
	source := json.RawMessage(`{"sourceKind":"SCHEDULE","scheduleId":"native-schedule","automationResourceId":"automation","automationVersionAssetId":"automation-version"}`)
	return env, in, source
}

func admittedTask(in generated.AgentTaskWorkflowInput) generated.AutomationScheduleAdmitResult {
	task := generated.TaskInputClass(in)
	return generated.AutomationScheduleAdmitResult{Admitted: true, ReasonCode: "NONE", TaskInput: &task}
}

func finishTaskMock(env *testsuite.TestWorkflowEnvironment, check func(generated.AgentTaskWorkflowInput)) {
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
			check(in)
			status := generated.Completed
			if in.CancelPending {
				status = generated.Canceled
			}
			return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: status, WaitingReason: "NONE", FinishActivity: true}, nil
		})
}

func TestAgentTaskScheduleUnknownRoundsDoNotAbandonCommittedAdmission(t *testing.T) {
	env, in, source := scheduleTaskTest(t)
	attempts, advances := 0, 0
	env.OnActivity("AdmitAutomationSchedule", mock.Anything, mock.Anything).Return(
		func(_ context.Context, actual generated.AutomationScheduleTaskInput) (generated.AutomationScheduleAdmitResult, error) {
			attempts++
			if actual.ScheduleID != "native-schedule" || actual.AutomationResourceID != "automation" {
				t.Fatal("unknown retry changed frozen native source")
			}
			switch attempts {
			case 1:
				return generated.AutomationScheduleAdmitResult{}, errors.New("ACK unavailable")
			case 2:
				return generated.AutomationScheduleAdmitResult{}, temporal.NewNonRetryableApplicationError("service authentication unavailable", activities.ErrTypeRejected, nil)
			default:
				return admittedTask(in), nil
			}
		})
	finishTaskMock(env, func(actual generated.AgentTaskWorkflowInput) {
		advances++
		if attempts != 3 || actual != in {
			t.Fatal("advanced before exact original admission was recovered")
		}
	})
	env.ExecuteWorkflow(AgentTaskKind, source)
	if err := env.GetWorkflowError(); err != nil || attempts != 3 || advances != 1 {
		t.Fatalf("same-source admission must recover: attempts=%d advances=%d error=%v", attempts, advances, err)
	}
}

func TestAgentTaskScheduleConfirmedDenialNeverAdvances(t *testing.T) {
	env, _, source := scheduleTaskTest(t)
	env.OnActivity("AdmitAutomationSchedule", mock.Anything, mock.Anything).Return(
		generated.AutomationScheduleAdmitResult{Admitted: false, ReasonCode: "PERMISSION_DENIED"}, nil)
	env.ExecuteWorkflow(AgentTaskKind, source)
	if env.GetWorkflowError() == nil {
		t.Fatal("confirmed admission denial must terminate without AgentTask activities")
	}
	env.AssertNotCalled(t, "AdvanceAgentTask", mock.Anything, mock.Anything)
	env.AssertNotCalled(t, "ProjectAgentTaskState", mock.Anything, mock.Anything)
}

func TestAgentTaskScheduleCancelAfterLostACKRecoversThenDrains(t *testing.T) {
	env, in, source := scheduleTaskTest(t)
	attempts, advances := 0, 0
	env.OnActivity("AdmitAutomationSchedule", mock.Anything, mock.Anything).Return(
		func(context.Context, generated.AutomationScheduleTaskInput) (generated.AutomationScheduleAdmitResult, error) {
			attempts++
			if attempts == 1 {
				return generated.AutomationScheduleAdmitResult{}, errors.New("committed response lost")
			}
			return admittedTask(in), nil
		})
	finishTaskMock(env, func(actual generated.AgentTaskWorkflowInput) {
		advances++
		if !actual.CancelPending || actual.InvocationID != in.InvocationID {
			t.Fatal("cancellation must drain the already-admitted original Invocation")
		}
	})
	env.RegisterDelayedCallback(env.CancelWorkflow, 30*time.Second)
	env.ExecuteWorkflow(AgentTaskKind, source)
	if err := env.GetWorkflowError(); !temporal.IsCanceledError(err) || attempts != 2 || advances != 1 {
		t.Fatalf("lost ACK must not abandon cancellation: attempts=%d advances=%d error=%v", attempts, advances, err)
	}
}

func TestAgentTaskScheduleUnknownContinueAsNewKeepsSourceAndCancellation(t *testing.T) {
	env, in, source := scheduleTaskTest(t)
	env.OnActivity("AdmitAutomationSchedule", mock.Anything, mock.Anything).Return(
		generated.AutomationScheduleAdmitResult{}, errors.New("Core unavailable"))
	env.RegisterDelayedCallback(func() { env.CancelWorkflow(); env.SetContinueAsNewSuggested(true) }, 30*time.Second)
	env.ExecuteWorkflow(AgentTaskKind, source)
	var next *workflow.ContinueAsNewError
	if !errors.As(env.GetWorkflowError(), &next) {
		t.Fatalf("unknown native admission must continue as new: %v", env.GetWorkflowError())
	}
	var resumed json.RawMessage
	if err := converter.GetDefaultDataConverter().FromPayloads(next.Input, &resumed); err != nil {
		t.Fatal(err)
	}
	var before, after map[string]json.RawMessage
	_ = json.Unmarshal(source, &before)
	_ = json.Unmarshal(resumed, &after)
	if string(after["cancelPending"]) != "true" {
		t.Fatal("continue-as-new lost the pending cancellation")
	}
	delete(after, "cancelPending")
	if !reflect.DeepEqual(before, after) || next.WorkflowType.Name != AgentTaskKind {
		t.Fatal("continue-as-new changed the original Schedule identity")
	}
	env.AssertNotCalled(t, "AdvanceAgentTask", mock.Anything, mock.Anything)

	continued, _, _ := scheduleTaskTest(t)
	continued.OnActivity("AdmitAutomationSchedule", mock.Anything, mock.Anything).Return(admittedTask(in), nil)
	advances := 0
	finishTaskMock(continued, func(actual generated.AgentTaskWorkflowInput) {
		advances++
		if !actual.CancelPending {
			t.Fatal("new run or Core task input cleared cancellation")
		}
	})
	continued.ExecuteWorkflow(AgentTaskKind, resumed)
	if err := continued.GetWorkflowError(); !temporal.IsCanceledError(err) || advances != 1 {
		t.Fatalf("continued cancellation must use existing drain: advances=%d error=%v", advances, err)
	}
}

func TestAgentTaskOrdinaryInputKeepsOriginalFirstCommand(t *testing.T) {
	env, in, _ := scheduleTaskTest(t)
	var sequence []string
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(
		func(context.Context, generated.TaskStateReport) error {
			sequence = append(sequence, "project")
			return nil
		})
	env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
		func(_ context.Context, actual generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
			sequence = append(sequence, "advance")
			if actual != in {
				t.Fatal("ordinary frozen input changed")
			}
			return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.Completed, WaitingReason: "NONE", FinishActivity: true}, nil
		})
	env.ExecuteWorkflow(AgentTaskKind, in)
	if err := env.GetWorkflowError(); err != nil || !reflect.DeepEqual(sequence, []string{"project", "advance", "project"}) {
		t.Fatalf("ordinary command sequence changed: %v %v", sequence, err)
	}
	env.AssertNotCalled(t, "AdmitAutomationSchedule", mock.Anything, mock.Anything)
}

func TestAgentTaskOrdinaryContinueAsNewKeepsTypedPayload(t *testing.T) {
	env, in, _ := scheduleTaskTest(t)
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
		generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.Running, WaitingReason: "UNKNOWN_EXTERNAL_RESULT", FinishActivity: true}, nil)
	env.RegisterDelayedCallback(func() { env.SetContinueAsNewSuggested(true) }, 30*time.Second)
	env.ExecuteWorkflow(AgentTaskKind, in)
	var next *workflow.ContinueAsNewError
	if !errors.As(env.GetWorkflowError(), &next) {
		t.Fatalf("ordinary continuation must not panic on the JSON entry signature: %v", env.GetWorkflowError())
	}
	var resumed generated.AgentTaskWorkflowInput
	if err := converter.GetDefaultDataConverter().FromPayloads(next.Input, &resumed); err != nil {
		t.Fatal(err)
	}
	resumed.EventBase = in.EventBase // Existing cumulative event counter is allowed to advance.
	if resumed != in || next.WorkflowType.Name != AgentTaskKind {
		t.Fatal("ordinary continuation changed the original frozen payload or registered type")
	}
	env.AssertNotCalled(t, "AdmitAutomationSchedule", mock.Anything, mock.Anything)
}
