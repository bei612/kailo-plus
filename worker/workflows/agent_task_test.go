package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
			status := generated.TaskStatusCOMPLETED
			if in.CancelPending {
				status = generated.TaskStatusCANCELED
			}
			return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: status, WaitingReason: "NONE", FinishActivity: true}, nil
		})
}

func TestAgentTaskOrderedDelayUsesDurableTimerBeforeNextAdvance(t *testing.T) {
	env, in, _ := scheduleTaskTest(t)
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	started := env.Now()
	advances := 0
	env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
		func(_ context.Context, actual generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
			advances++
			if actual != in {
				t.Fatal("Delay changed original Invocation")
			}
			if advances == 1 {
				return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID,
					Status: generated.TaskStatusRUNNING, WaitingReason: "WAITING_TIMER", FinishActivity: true,
					DelayStep: &generated.DelayStep{ID: "wait", Seconds: 62}}, nil
			}
			if env.Now().Sub(started) < 62*time.Second {
				t.Fatal("message step advanced before native Delay")
			}
			return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE", FinishActivity: true}, nil
		})
	raw, _ := json.Marshal(in)
	env.ExecuteWorkflow(AgentTaskKind, json.RawMessage(raw))
	if err := env.GetWorkflowError(); err != nil || advances != 2 {
		t.Fatalf("Delay did not finish through original workflow: advances=%d error=%v", advances, err)
	}
}

func TestAgentTaskDelayDeadlineKeepsIndependentTimersAndDrainsCancel(t *testing.T) {
	for _, scenario := range []struct {
		name             string
		seconds, timeout int64
		cancel           bool
		elapsed          time.Duration
	}{
		{"deadline", 62, 5, false, 5 * time.Second}, {"completion", 5, 62, false, 5 * time.Second},
		{"same-task", 5, 5, false, 5 * time.Second}, {"cancel", 62, 5, true, time.Second},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			env, in, _ := scheduleTaskTest(t)
			env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
			started := env.Now()
			advances := 0
			scheduled := []time.Duration{}
			canceled := 0
			env.SetOnTimerScheduledListener(func(_ string, duration time.Duration) { scheduled = append(scheduled, duration) })
			env.SetOnTimerCanceledListener(func(string) { canceled++ })
			env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(func(_ context.Context, actual generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
				advances++
				if advances == 1 {
					return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING,
						WaitingReason: "WAITING_TIMER", FinishActivity: true, DelayStep: &generated.DelayStep{ID: "wait", Seconds: scenario.seconds, TimeoutSeconds: &scenario.timeout}}, nil
				}
				if env.Now().Sub(started) != scenario.elapsed || actual.CancelPending != scenario.cancel {
					t.Fatal("deadline changed timer or cancel outcome", env.Now().Sub(started), actual.CancelPending)
				}
				status := generated.TaskStatusCOMPLETED
				if scenario.cancel {
					status = generated.TaskStatusCANCELED
				}
				return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: status, WaitingReason: "NONE", FinishActivity: true}, nil
			})
			if scenario.cancel {
				env.RegisterDelayedCallback(env.CancelWorkflow, time.Second)
			}
			raw, _ := json.Marshal(in)
			env.ExecuteWorkflow(AgentTaskKind, json.RawMessage(raw))
			if advances != 2 || (env.GetWorkflowError() != nil) != scenario.cancel {
				t.Fatal("deadline did not return to original observation", advances, env.GetWorkflowError())
			}
			if len(scheduled) != 2 || scheduled[0] != time.Duration(scenario.seconds)*time.Second || scheduled[1] != time.Duration(scenario.timeout)*time.Second {
				t.Fatal("deadline replaced the original duration", scheduled)
			}
			if scenario.name != "same-task" && canceled == 0 {
				t.Fatal("losing timer was not canceled")
			}
		})
	}
}

// Core owns the per-effect durable receipts; the existing Workflow must carry
// those observations through its normal Activity/Timer loop without a new run.
func TestAgentTaskOrderedMessageObservationsKeepOneInvocationAndStopOnFailure(t *testing.T) {
	for _, terminal := range []generated.TaskStatus{generated.TaskStatusCOMPLETED, generated.TaskStatusFAILED} {
		t.Run(string(terminal), func(t *testing.T) {
			env, in, _ := scheduleTaskTest(t)
			env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
			advances := 0
			var delayStarted time.Time
			env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
				func(_ context.Context, actual generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
					advances++
					if actual != in {
						t.Fatal("sequence changed frozen Invocation")
					}
					out := generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID,
						Status: generated.TaskStatusRUNNING, WaitingReason: "NONE", FinishActivity: true}
					switch advances {
					case 1: // first publication positively reconciled; yield the old Activity
					case 2:
						delayStarted = env.Now()
						out.WaitingReason = "WAITING_TIMER"
						out.DelayStep = &generated.DelayStep{ID: "between-messages", Seconds: 62}
					case 3:
						if env.Now().Sub(delayStarted) < 62*time.Second {
							t.Fatal("next effect overtook Delay")
						}
						out.WaitingReason = "UNKNOWN_EXTERNAL_RESULT"
					case 4:
						out.Status = terminal
					default:
						t.Fatal("terminal sequence advanced another effect")
					}
					return out, nil
				})
			raw, _ := json.Marshal(in)
			env.ExecuteWorkflow(AgentTaskKind, json.RawMessage(raw))
			if advances != 4 || (terminal == generated.TaskStatusCOMPLETED) != (env.GetWorkflowError() == nil) {
				t.Fatalf("sequence observations escaped original loop: advances=%d err=%v", advances, env.GetWorkflowError())
			}
		})
	}
}

func TestAgentTaskCancelDuringOrderedDelayDrainsWithoutPublishing(t *testing.T) {
	env, in, _ := scheduleTaskTest(t)
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	advances := 0
	env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
		func(_ context.Context, actual generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
			advances++
			if advances == 1 {
				return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID,
					Status: generated.TaskStatusRUNNING, WaitingReason: "WAITING_TIMER", FinishActivity: true,
					DelayStep: &generated.DelayStep{ID: "wait", Seconds: 62}}, nil
			}
			if !actual.CancelPending {
				t.Fatal("canceled Delay proceeded to a side effect")
			}
			return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusCANCELED, WaitingReason: "NONE", FinishActivity: true}, nil
		})
	env.RegisterDelayedCallback(env.CancelWorkflow, 10*time.Second)
	raw, _ := json.Marshal(in)
	env.ExecuteWorkflow(AgentTaskKind, json.RawMessage(raw))
	if !temporal.IsCanceledError(env.GetWorkflowError()) || advances != 2 {
		t.Fatalf("Delay cancellation must drain original invocation: advances=%d error=%v", advances, env.GetWorkflowError())
	}
}

func TestAgentTaskOrderedDelayPreservesOriginalContinuationAndCancelCheckpoint(t *testing.T) {
	for _, canceled := range []bool{false, true} {
		t.Run(fmt.Sprint(canceled), func(t *testing.T) {
			env, in, _ := scheduleTaskTest(t)
			in.EventBase = 11
			const historyLength = 7
			env.SetCurrentHistoryLength(historyLength)
			env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
			env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(generated.AgentTaskAdvanceResult{
				InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING, WaitingReason: "WAITING_TIMER", FinishActivity: true,
				DelayStep: &generated.DelayStep{ID: "wait", Seconds: 62},
			}, nil).Once()
			env.RegisterDelayedCallback(func() {
				env.SetContinueAsNewSuggested(true)
				if canceled {
					env.CancelWorkflow()
				}
			}, 10*time.Second)
			raw, _ := json.Marshal(in)
			env.ExecuteWorkflow(AgentTaskKind, json.RawMessage(raw))
			var next *workflow.ContinueAsNewError
			if !errors.As(env.GetWorkflowError(), &next) {
				t.Fatalf("Delay skipped original continuation: %v", env.GetWorkflowError())
			}
			var resumed generated.AgentTaskWorkflowInput
			if err := converter.GetDefaultDataConverter().FromPayloads(next.Input, &resumed); err != nil {
				t.Fatal(err)
			}
			if resumed.EventBase != in.EventBase+historyLength {
				t.Fatal("Delay continuation lost cumulative history position")
			}
			resumed.EventBase = in.EventBase
			in.CancelPending = canceled
			if resumed != in || next.WorkflowType.Name != AgentTaskKind {
				t.Fatal("Delay continuation lost invocation/cancel checkpoint")
			}
			env.AssertExpectations(t)
		})
	}
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
			return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE", FinishActivity: true}, nil
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
		generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING, WaitingReason: "UNKNOWN_EXTERNAL_RESULT", FinishActivity: true}, nil)
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

func TestAgentTaskNativeDelayTraceKeepsOldCommandsAndProjectsNewRunningTimer(t *testing.T) {
	for _, version := range []workflow.Version{workflow.DefaultVersion, 1} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			env, in, _ := scheduleTaskTest(t)
			env.OnGetVersion("agent-task-native-delay-trace", workflow.DefaultVersion, 1).Return(version)
			projections, advances := 0, 0
			env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(
				func(context.Context, generated.TaskStateReport) error { projections++; return nil })
			env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
				func(context.Context, generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
					advances++
					if advances == 1 {
						return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING,
							WaitingReason: "WAITING_TIMER", FinishActivity: true, DelayStep: &generated.DelayStep{ID: "wait", Seconds: 62}}, nil
					}
					return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusCOMPLETED,
						WaitingReason: "NONE", FinishActivity: true}, nil
				})
			started := env.Now()
			env.ExecuteWorkflow(AgentTaskKind, in)
			want := 3
			if version != workflow.DefaultVersion {
				want++
			}
			if err := env.GetWorkflowError(); err != nil || projections != want || advances != 2 || env.Now().Sub(started) < 62*time.Second {
				t.Fatalf("native timer trace changed effects or legacy commands: projections=%d want=%d advances=%d error=%v", projections, want, advances, err)
			}
		})
	}
}

func TestAgentTaskRunningTraceFailureDoesNotTrapCompletedOrCancelledTimer(t *testing.T) {
	for _, cancel := range []bool{false, true} {
		t.Run(fmt.Sprint(cancel), func(t *testing.T) {
			env, in, _ := scheduleTaskTest(t)
			env.OnGetVersion("agent-task-native-delay-trace", workflow.DefaultVersion, 1).Return(workflow.Version(1))
			projections, advances := 0, 0
			env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(
				func(context.Context, generated.TaskStateReport) error {
					projections++
					if projections >= 3 {
						return temporal.NewNonRetryableApplicationError("projection unavailable", activities.ErrTypeUnknownExternalResult, nil)
					}
					return nil
				})
			env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
				func(context.Context, generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
					advances++
					return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING,
						WaitingReason: "WAITING_TIMER", FinishActivity: true, DelayStep: &generated.DelayStep{ID: "wait", Seconds: 62}}, nil
				})
			env.RegisterDelayedCallback(func() {
				env.SetContinueAsNewSuggested(true)
				if cancel {
					env.CancelWorkflow()
				}
			}, 5*time.Second)
			started := env.Now()
			env.ExecuteWorkflow(AgentTaskKind, in)
			var next *workflow.ContinueAsNewError
			if !errors.As(env.GetWorkflowError(), &next) {
				t.Fatalf("native timer must reach original continuation: %v", env.GetWorkflowError())
			}
			var resumed generated.AgentTaskWorkflowInput
			if err := converter.GetDefaultDataConverter().FromPayloads(next.Input, &resumed); err != nil {
				t.Fatal(err)
			}
			if projections != 3 || advances != 1 || resumed.CancelPending != cancel || resumed.InvocationID != in.InvocationID {
				t.Fatalf("running trace retried/restarted an effect or lost cancellation: projections=%d advances=%d cancel=%t", projections, advances, resumed.CancelPending)
			}
			if !cancel && env.Now().Sub(started) < 62*time.Second {
				t.Fatal("trace failure bypassed the native delay")
			}
		})
	}
}

func TestAgentTaskStepApprovalStartsOriginalChildOnceWithoutWaitingForItsCompletion(t *testing.T) {
	env, in, _ := scheduleTaskTest(t)
	startedAt := env.Now()
	var terminalAt time.Time
	childID := "platform:approval:step-fixture"
	child := generated.ApprovalInputClass{ActionKey: "automation.run", ActionExecutionID: "child", PolicyID: "policy", PolicyVersion: 2}
	starts, advances := 0, 0
	env.RegisterWorkflowWithOptions(
		func(ctx workflow.Context, actual generated.ApprovalWorkflowInput) error {
			starts++
			if actual.ActionExecutionID != "child" || actual.PolicyID != "policy" || actual.PolicyVersion != 2 {
				t.Fatal("child lost the Core-frozen approval input")
			}
			return workflow.Sleep(ctx, time.Hour)
		}, workflow.RegisterOptions{Name: ApprovalKind})
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
		func(context.Context, generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
			advances++
			out := generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING, WaitingReason: "WAITING_APPROVAL", FinishActivity: true,
				ApprovalWorkflowID: &childID, ApprovalInput: &child}
			if advances == 3 {
				terminalAt = env.Now()
				out.Status, out.WaitingReason, out.ApprovalWorkflowID, out.ApprovalInput = generated.TaskStatusCOMPLETED, "NONE", nil, nil
			}
			return out, nil
		})
	env.ExecuteWorkflow(AgentTaskKind, in)
	if err := env.GetWorkflowError(); err != nil || starts != 1 || advances != 3 {
		t.Fatalf("same child must be polled without a second start: %v starts=%d advances=%d", err, starts, advances)
	}
	if terminalAt.IsZero() || terminalAt.Sub(startedAt) >= time.Hour {
		t.Fatal("parent waited for child completion rather than its native start acknowledgement")
	}
}

func TestAgentTaskStepApprovalCancellationRemainsOnOriginalInvocation(t *testing.T) {
	env, in, _ := scheduleTaskTest(t)
	childID := "platform:approval:cancel-fixture"
	child := generated.ApprovalInputClass{ActionKey: "automation.run"}
	env.RegisterWorkflowWithOptions(
		func(ctx workflow.Context, _ generated.ApprovalWorkflowInput) error {
			return workflow.Sleep(ctx, time.Hour)
		}, workflow.RegisterOptions{Name: ApprovalKind})
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	advances := 0
	env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
		func(_ context.Context, actual generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
			advances++
			if actual.InvocationID != in.InvocationID {
				t.Fatal("changed original Invocation")
			}
			if advances == 1 {
				return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusRUNNING, WaitingReason: "WAITING_APPROVAL", FinishActivity: true,
					ApprovalWorkflowID: &childID, ApprovalInput: &child}, nil
			}
			if !actual.CancelPending {
				t.Fatal("lost cancellation while approval was pending")
			}
			return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusCANCELED, WaitingReason: "NONE", FinishActivity: true}, nil
		})
	env.RegisterDelayedCallback(env.CancelWorkflow, 30*time.Second)
	env.ExecuteWorkflow(AgentTaskKind, in)
	if !temporal.IsCanceledError(env.GetWorkflowError()) || advances != 2 {
		t.Fatalf("cancel did not drain original gate: %v", env.GetWorkflowError())
	}
}

// Core 数据库确定拒绝推进或投影时，AgentTask 不再按轮重做：同一请求每轮都会被
// 拒绝并占着 Core 连接。Workflow 以 CORE_PERSISTENCE_REJECTED 明确失败。
func TestAgentTaskPersistenceRejectionFailsInsteadOfRedoingEveryRound(t *testing.T) {
	rejected := func() error {
		return temporal.NewNonRetryableApplicationError("rejected", activities.ErrTypePersistenceRejected, nil)
	}
	for _, c := range []struct {
		name                            string
		rejectProjection, rejectAdvance int
		wantProjections, wantAdvances   int
	}{
		{name: "begin projection", rejectProjection: 1, wantProjections: 1, wantAdvances: 0},
		{name: "terminal projection", rejectProjection: 2, wantProjections: 2, wantAdvances: 1},
		{name: "advance", rejectAdvance: 1, wantProjections: 2, wantAdvances: 1},
	} {
		t.Run(c.name, func(t *testing.T) {
			env, in, _ := scheduleTaskTest(t)
			projections, advances := 0, 0
			env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(
				func(context.Context, generated.TaskStateReport) error {
					projections++
					if projections == c.rejectProjection {
						return rejected()
					}
					return nil
				})
			env.OnActivity("AdvanceAgentTask", mock.Anything, mock.Anything).Return(
				func(context.Context, generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
					advances++
					if advances == c.rejectAdvance {
						return generated.AgentTaskAdvanceResult{}, rejected()
					}
					return generated.AgentTaskAdvanceResult{InvocationID: in.InvocationID, Status: generated.TaskStatusCOMPLETED,
						WaitingReason: "NONE", FinishActivity: true}, nil
				})
			env.ExecuteWorkflow(AgentTaskKind, in)
			var app *temporal.ApplicationError
			if err := env.GetWorkflowError(); !errors.As(err, &app) || app.Type() != activities.ErrTypePersistenceRejected {
				t.Fatalf("workflow must fail explicitly on persistence rejection: %v", err)
			}
			if projections != c.wantProjections || advances != c.wantAdvances {
				t.Fatalf("rejected request was redone: projections=%d advances=%d", projections, advances)
			}
		})
	}
}
