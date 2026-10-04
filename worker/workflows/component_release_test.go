package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"os"
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

func releaseWorkflowTest(t *testing.T, project ...func(context.Context, generated.TaskStateReport) error) (*testsuite.TestWorkflowEnvironment, ComponentTaskInput) {
	t.Helper()
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	if len(project) == 0 {
		env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(nil)
	} else {
		env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(project[0])
	}
	plan := &generated.PlanClass{WorkflowID: t.Name(), ActionExecutionID: "original-action", OperationID: "original-operation",
		ComponentReleaseID: "candidate", ArtifactDigest: "artifact", PlanDigest: "frozen-plan", SuiteDigest: "frozen-suite", ContractDigests: []string{"contract"},
		Steps: []generated.PlanStep{{CaseKey: "capability", StepKey: "execute", IdempotencyKey: "original-key", Operation: generated.AdapterProtocolOperation("execute")}}}
	return env, ComponentTaskInput{Kind: generated.WorkflowKind("COMPONENT_RELEASE"), Release: plan}
}

func TestComponentReleaseLostACKOnlyReconcilesOriginalAttempt(t *testing.T) {
	env, in := releaseWorkflowTest(t)
	attempts, reports := 0, 0
	env.OnActivity("RunComponentConformanceStep", mock.Anything, mock.Anything).Return(
		func(_ context.Context, probe generated.ComponentConformanceProbe) (generated.ComponentConformanceStepObservation, error) {
			attempts++
			if probe.Plan.ActionExecutionID != in.Release.ActionExecutionID || probe.Plan.Steps[0].IdempotencyKey != "original-key" || probe.Plan.RunID == "" {
				t.Fatal("attempt changed original execution identity")
			}
			if attempts == 1 {
				if probe.Reconcile != nil {
					t.Fatal("first dispatch marked observation")
				}
				return generated.ComponentConformanceStepObservation{}, errors.New("lost native ACK")
			}
			if probe.Reconcile == nil || !*probe.Reconcile {
				t.Fatal("uncertain write was dispatched again")
			}
			return generated.ComponentConformanceStepObservation{CaseKey: "capability", StepKey: "execute", Operation: generated.AdapterProtocolOperation("reconcile")}, nil
		})
	env.OnActivity("RecordComponentConformance", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.ComponentConformanceObservation) (generated.ComponentReleaseReceipt, error) {
			reports++
			if report.ActionExecutionID != in.Release.ActionExecutionID || report.PlanDigest != in.Release.PlanDigest || len(report.Observations) != 1 || attempts != 2 {
				t.Fatal("report detached from actual original attempt")
			}
			return generated.ComponentReleaseReceipt{ActionExecutionID: report.ActionExecutionID, ComponentReleaseID: report.ComponentReleaseID,
				PlanDigest: report.PlanDigest, Status: generated.ComponentReleaseStatus("REGISTERED")}, nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if err := env.GetWorkflowError(); err != nil || attempts != 2 || reports != 1 {
		t.Fatalf("attempts=%d reports=%d error=%v", attempts, reports, err)
	}
}

func TestComponentReleasePreviousRunningSurvivesNextProbeRejection(t *testing.T) {
	for _, rejection := range []string{activities.ErrTypeAdmissionDenied, activities.ErrTypeRejected} {
		t.Run(rejection, func(t *testing.T) {
			env, in := releaseWorkflowTest(t)
			in.Release.Steps = append(in.Release.Steps, generated.PlanStep{CaseKey: "capability", StepKey: "cancel",
				IdempotencyKey: "original-key", Operation: generated.AdapterProtocolOperation("cancel")})
			attempts, unsafe := 0, false
			env.OnActivity("RunComponentConformanceStep", mock.Anything, mock.Anything).Return(
				func(_ context.Context, probe generated.ComponentConformanceProbe) (generated.ComponentConformanceStepObservation, error) {
					attempts++
					if attempts == 1 {
						return generated.ComponentConformanceStepObservation{CaseKey: "capability", StepKey: "execute",
							NativeObservation: &generated.ExecutionClass{IdempotencyKey: "original-key", PlatformStatus: generated.ExternalExecutionStatus("RUNNING")}}, nil
					}
					unsafe = unsafe || probe.StepIndex != 1 || probe.Plan.Steps[probe.StepIndex].IdempotencyKey != "original-key" ||
						(attempts > 2 && (probe.Reconcile == nil || !*probe.Reconcile))
					return generated.ComponentConformanceStepObservation{}, temporal.NewNonRetryableApplicationError("fresh authorization refused before this probe", rejection, nil)
				})
			env.RegisterDelayedCallback(func() { env.SetContinueAsNewSuggested(true) }, retry.RoundInterval/2)
			env.ExecuteWorkflow(ComponentTaskKind, in)
			var continued *workflow.ContinueAsNewError
			if !errors.As(env.GetWorkflowError(), &continued) || attempts != 3 || unsafe {
				t.Fatalf("previous native effect was abandoned/replayed: attempts=%d unsafe=%v error=%v", attempts, unsafe, env.GetWorkflowError())
			}
			var next ComponentTaskInput
			if err := converter.GetDefaultDataConverter().FromPayloads(continued.Input, &next); err != nil {
				t.Fatal(err)
			}
			if !next.ReleaseReconcile || len(next.ReleaseObservations) != 1 ||
				next.ReleaseObservations[0].NativeObservation.IdempotencyKey != "original-key" {
				t.Fatal("continuation discarded original pending native observation")
			}
			env.AssertNotCalled(t, "RecordComponentConformance", mock.Anything, mock.Anything)
		})
	}
}

func TestComponentReleaseCheckedSameKeyTerminalCanFinishFailedSuite(t *testing.T) {
	env, in := releaseWorkflowTest(t)
	in.Release.Steps = append(in.Release.Steps, generated.PlanStep{StepKey: "cancel", IdempotencyKey: "original-key", Operation: generated.AdapterProtocolOperation("cancel")})
	attempts := 0
	env.OnActivity("RunComponentConformanceStep", mock.Anything, mock.Anything).Return(
		func(_ context.Context, _ generated.ComponentConformanceProbe) (generated.ComponentConformanceStepObservation, error) {
			attempts++
			if attempts == 1 {
				return generated.ComponentConformanceStepObservation{NativeObservation: &generated.ExecutionClass{IdempotencyKey: "original-key", PlatformStatus: generated.ExternalExecutionStatus("RUNNING")}}, nil
			}
			now, status := "2026-10-04T00:00:00Z", "completed"
			actual := generated.ComponentConformanceStepObservation{NativeObservation: &generated.ExecutionClass{
				IdempotencyKey: "original-key", PlatformStatus: generated.ExternalExecutionStatus("SUCCEEDED"),
				NativeStatus: &status, TerminalAt: &now, LastObservedAt: &now}}
			return actual, temporal.NewNonRetryableApplicationError("cancel expectation failed but native is terminal", activities.ErrTypeRejected, nil, actual)
		})
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if env.GetWorkflowError() == nil || attempts != 2 {
		t.Fatalf("checked native terminal must not stay pending: %v attempts=%d", env.GetWorkflowError(), attempts)
	}
	env.AssertNotCalled(t, "RecordComponentConformance", mock.Anything, mock.Anything)
}

func TestComponentReleaseCancellationDrainsUnknownWithoutAnotherProbe(t *testing.T) {
	env, in := releaseWorkflowTest(t)
	in.Release.Steps = append(in.Release.Steps, generated.PlanStep{CaseKey: "next", StepKey: "never", Operation: generated.AdapterProtocolOperation("execute")})
	attempts := 0
	env.OnActivity("RunComponentConformanceStep", mock.Anything, mock.Anything).Return(
		func(_ context.Context, probe generated.ComponentConformanceProbe) (generated.ComponentConformanceStepObservation, error) {
			attempts++
			if probe.StepIndex != 0 {
				t.Fatal("cancellation started another external probe")
			}
			if attempts == 1 {
				return generated.ComponentConformanceStepObservation{}, errors.New("unknown before cancellation")
			}
			if probe.Reconcile == nil || !*probe.Reconcile {
				t.Fatal("cancel drain replayed execute")
			}
			status := generated.ExternalExecutionStatus("RUNNING")
			if attempts >= 3 {
				status = generated.ExternalExecutionStatus("SUCCEEDED")
			}
			return generated.ComponentConformanceStepObservation{NativeObservation: &generated.ExecutionClass{PlatformStatus: status}}, nil
		})
	env.RegisterDelayedCallback(env.CancelWorkflow, retry.RoundInterval/2)
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if err := env.GetWorkflowError(); !temporal.IsCanceledError(err) || attempts != 3 {
		t.Fatalf("drain attempts=%d error=%v", attempts, err)
	}
	env.AssertNotCalled(t, "RecordComponentConformance", mock.Anything, mock.Anything)
}

func TestComponentReleaseCommittedReportLostACKContinuesWithoutProbes(t *testing.T) {
	env, in := releaseWorkflowTest(t)
	observations := []generated.ComponentConformanceStepObservation{{CaseKey: "capability", StepKey: "execute", Operation: generated.AdapterProtocolOperation("execute")}}
	// When provided, reuse the actual isolated wire observations in the Core
	// persistence check; this does not turn the SDK simulation into live Temporal.
	if path := os.Getenv("COMPONENT_CONFORMANCE_WIRE_EVIDENCE"); path != "" {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var evidence struct {
			Plan   generated.PlanClass `json:"plan"`
			Report struct {
				Observations []generated.ComponentConformanceStepObservation `json:"observations"`
			} `json:"report"`
		}
		if err := json.Unmarshal(data, &evidence); err != nil {
			t.Fatal(err)
		}
		in.Release = &evidence.Plan
		observations = evidence.Report.Observations
		env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: in.Release.WorkflowID})
	}
	probes := 0
	env.OnActivity("RunComponentConformanceStep", mock.Anything, mock.Anything).Return(
		func(_ context.Context, probe generated.ComponentConformanceProbe) (generated.ComponentConformanceStepObservation, error) {
			probes++
			return observations[probe.StepIndex], nil
		})
	var committed generated.ComponentConformanceObservation
	env.OnActivity("RecordComponentConformance", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.ComponentConformanceObservation) (generated.ComponentReleaseReceipt, error) {
			committed = report
			return generated.ComponentReleaseReceipt{}, errors.New("Core committed; ACK lost")
		})
	env.RegisterDelayedCallback(func() { env.SetContinueAsNewSuggested(true) }, retry.RoundInterval/2)
	env.ExecuteWorkflow(ComponentTaskKind, in)
	var can *workflow.ContinueAsNewError
	if !errors.As(env.GetWorkflowError(), &can) {
		t.Fatalf("expected CAN after lost ACK: %v", env.GetWorkflowError())
	}
	var next ComponentTaskInput
	if err := converter.GetDefaultDataConverter().FromPayloads(can.Input, &next); err != nil {
		t.Fatal(err)
	}
	if len(next.ReleaseObservations) != len(in.Release.Steps) || probes != len(in.Release.Steps) {
		t.Fatal("CAN discarded completed native observations")
	}
	resumed, _ := releaseWorkflowTest(t)
	resumed.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: in.Release.WorkflowID})
	var recovered generated.ComponentConformanceObservation
	resumed.OnActivity("RecordComponentConformance", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.ComponentConformanceObservation) (generated.ComponentReleaseReceipt, error) {
			recovered = report
			original := committed
			original.RunID = report.RunID
			if report.RunID == committed.RunID || !reflect.DeepEqual(original, report) {
				t.Fatal("recovery changed more than the current Temporal run")
			}
			return generated.ComponentReleaseReceipt{ActionExecutionID: report.ActionExecutionID,
				ComponentReleaseID: report.ComponentReleaseID, PlanDigest: report.PlanDigest,
				Status: generated.ComponentReleaseStatus("REGISTERED")}, nil
		})
	resumed.ExecuteWorkflow(func(ctx workflow.Context, input ComponentTaskInput) error {
		// The SDK harness uses the same default run ID in each environment.
		// Supply the distinct run identity that Temporal assigns to CAN.
		workflow.GetInfo(ctx).WorkflowExecution.RunID = "continued-suite-run"
		return ComponentTask(ctx, input)
	}, next)
	if err := resumed.GetWorkflowError(); err != nil {
		t.Fatal(err)
	}
	resumed.AssertNotCalled(t, "RunComponentConformanceStep", mock.Anything, mock.Anything)
	if path := os.Getenv("COMPONENT_CONFORMANCE_RECOVERY_EVIDENCE"); path != "" {
		data, err := json.Marshal(map[string]interface{}{"plan": in.Release, "report": committed, "resumedReport": recovered})
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
}

func TestComponentReleaseCancelProjectionCANKeepsDrainedObservations(t *testing.T) {
	env, in := releaseWorkflowTest(t, func(_ context.Context, projection generated.TaskStateReport) error {
		if projection.Status == generated.Canceled {
			return errors.New("cancel projection ACK lost")
		}
		return nil
	})
	in.Release.Steps = append(in.Release.Steps, generated.PlanStep{CaseKey: "next", StepKey: "never", Operation: generated.AdapterProtocolOperation("execute")})
	attempts := 0
	env.OnActivity("RunComponentConformanceStep", mock.Anything, mock.Anything).Return(
		func(_ context.Context, probe generated.ComponentConformanceProbe) (generated.ComponentConformanceStepObservation, error) {
			attempts++
			if probe.StepIndex != 0 {
				t.Fatal("cancel started another probe")
			}
			if attempts == 1 {
				return generated.ComponentConformanceStepObservation{}, errors.New("native ACK lost")
			}
			return generated.ComponentConformanceStepObservation{CaseKey: "capability", StepKey: "execute",
				NativeObservation: &generated.ExecutionClass{PlatformStatus: generated.ExternalExecutionStatus("SUCCEEDED")}}, nil
		})
	env.RegisterDelayedCallback(env.CancelWorkflow, retry.RoundInterval/2)
	env.RegisterDelayedCallback(func() { env.SetContinueAsNewSuggested(true) }, retry.RoundInterval+retry.RoundInterval/2)
	env.ExecuteWorkflow(ComponentTaskKind, in)
	var can *workflow.ContinueAsNewError
	if !errors.As(env.GetWorkflowError(), &can) {
		t.Fatalf("expected cancel CAN: %v", env.GetWorkflowError())
	}
	var next ComponentTaskInput
	if err := converter.GetDefaultDataConverter().FromPayloads(can.Input, &next); err != nil {
		t.Fatal(err)
	}
	if !next.CancelPending || next.ReleaseReconcile || len(next.ReleaseObservations) != 1 || attempts != 2 {
		t.Fatalf("cancel CAN lost accumulated native evidence: %+v attempts=%d", next, attempts)
	}
	resumed, _ := releaseWorkflowTest(t)
	resumed.ExecuteWorkflow(ComponentTaskKind, next)
	if !temporal.IsCanceledError(resumed.GetWorkflowError()) {
		t.Fatal(resumed.GetWorkflowError())
	}
	resumed.AssertNotCalled(t, "RunComponentConformanceStep", mock.Anything, mock.Anything)
	resumed.AssertNotCalled(t, "RecordComponentConformance", mock.Anything, mock.Anything)
}

func TestComponentReleaseRefusalCannotRegister(t *testing.T) {
	env, in := releaseWorkflowTest(t)
	env.OnActivity("RunComponentConformanceStep", mock.Anything, mock.Anything).Return(generated.ComponentConformanceStepObservation{},
		temporal.NewNonRetryableApplicationError("native evidence mismatch", activities.ErrTypeRejected, nil))
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if env.GetWorkflowError() == nil {
		t.Fatal("definite conformance rejection completed")
	}
	env.AssertNotCalled(t, "RecordComponentConformance", mock.Anything, mock.Anything)
}
