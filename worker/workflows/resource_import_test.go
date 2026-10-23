package workflows

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

func resourceImportSample(t *testing.T) generated.ResourceImportTarget {
	raw, err := os.ReadFile("../../contracts/samples/agent-snapshot-import.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		AdvanceRequest struct {
			Target generated.ResourceImportTarget `json:"target"`
		} `json:"advanceRequest"`
	}
	if err := json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	sample.AdvanceRequest.Target.WorkflowID = t.Name()
	return sample.AdvanceRequest.Target
}

func TestResourceImportUnknownKeepsFrozenPackageUntilReceipt(t *testing.T) {
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	target := resourceImportSample(t)
	in := ComponentTaskInput{Kind: generated.WorkflowKind("RESOURCE_IMPORT"), ResourceImport: &target}
	calls := 0
	unknown := 0
	env.OnActivity("AdvanceResourceImport", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ResourceImportAdvanceRequest) (generated.ResourceImportAdvanceResult, error) {
			calls++
			if request.Target != *in.ResourceImport || request.RunID == "" {
				t.Fatal("retry substituted the frozen package or admission")
			}
			if calls == 1 {
				return generated.ResourceImportAdvanceResult{}, errors.New("committed receipt ACK lost")
			}
			if calls == 2 {
				return generated.ResourceImportAdvanceResult{ResourceID: "different-resource", Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
			}
			return generated.ResourceImportAdvanceResult{ResourceID: request.Target.ResourceID, Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
		})
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.TaskStateReport) error {
			if report.Status == generated.TaskStatusRUNNING {
				unknown++
				if report.WaitingReason == nil || *report.WaitingReason != "UNKNOWN_EXTERNAL_RESULT" {
					t.Fatal("uncertainty lost")
				}
			}
			return nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if err := env.GetWorkflowError(); err != nil || calls != 3 || unknown != 2 {
		t.Fatalf("calls=%d unknown=%d error=%v", calls, unknown, err)
	}
}

func TestResourceImportRejectsTargetWithoutPackageDigest(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	target := resourceImportSample(t)
	target.PackageDigest = ""
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{Kind: generated.WorkflowKind("RESOURCE_IMPORT"), ResourceImport: &target})
	if env.GetWorkflowError() == nil {
		t.Fatal("a target without the frozen package digest started")
	}
}
