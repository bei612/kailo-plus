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

func resourceExportSample(t *testing.T) generated.ResourceExportTarget {
	raw, err := os.ReadFile("../../contracts/samples/agent-snapshot-export.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		AdvanceRequest struct {
			Target generated.ResourceExportTarget `json:"target"`
		} `json:"advanceRequest"`
	}
	if err := json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	sample.AdvanceRequest.Target.WorkflowID = t.Name()
	return sample.AdvanceRequest.Target
}

func TestResourceExportUnknownKeepsFrozenTargetUntilReceipt(t *testing.T) {
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	target := resourceExportSample(t)
	in := ComponentTaskInput{Kind: generated.WorkflowKind("RESOURCE_EXPORT"), ResourceExport: &target}
	calls, unknown := 0, 0
	env.OnActivity("AdvanceResourceExport", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ResourceExportAdvanceRequest) (generated.ResourceExportAdvanceResult, error) {
			calls++
			if request.Target != *in.ResourceExport || request.RunID == "" {
				t.Fatal("retry substituted the frozen package or admission")
			}
			if calls == 1 {
				return generated.ResourceExportAdvanceResult{}, errors.New("committed receipt ACK lost")
			}
			if calls == 2 {
				return generated.ResourceExportAdvanceResult{PackageAssetID: "different-package", Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
			}
			return generated.ResourceExportAdvanceResult{PackageAssetID: request.Target.PackageAssetID, Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
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

func TestResourceExportRejectsTargetWithoutPackageAsset(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	target := resourceExportSample(t)
	target.PackageAssetID = ""
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{Kind: generated.WorkflowKind("RESOURCE_EXPORT"), ResourceExport: &target})
	if env.GetWorkflowError() == nil {
		t.Fatal("a target without the prewritten package asset started")
	}
}
