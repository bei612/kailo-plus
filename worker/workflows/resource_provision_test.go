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

func TestResourceProvisionUnknownKeepsOriginalReferenceUntilReceipt(t *testing.T) {
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	raw, err := os.ReadFile("../../contracts/samples/resource-provision.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		Target generated.ResourceProvisionTarget `json:"target"`
	}
	if err := json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	sample.Target.WorkflowID = t.Name()
	in := ComponentTaskInput{Kind: generated.WorkflowKind("RESOURCE_PROVISION"), ResourceProvision: &sample.Target}
	calls := 0
	unknown := 0
	env.OnActivity("AdvanceResourceProvision", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ResourceProvisionAdvanceRequest) (generated.ResourceProvisionAdvanceResult, error) {
			calls++
			if request.Target != generated.ResourceProvisionAdvanceRequestTarget(*in.ResourceProvision) || request.RunID == "" {
				t.Fatal("retry substituted the frozen resource/admission")
			}
			if calls == 1 {
				return generated.ResourceProvisionAdvanceResult{}, errors.New("committed receipt ACK lost")
			}
			if calls == 2 {
				return generated.ResourceProvisionAdvanceResult{ResourceID: "different-resource", Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
			}
			return generated.ResourceProvisionAdvanceResult{ResourceID: request.Target.ResourceID, Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
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
