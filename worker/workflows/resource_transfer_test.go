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

func transferSample(t *testing.T) generated.ResourceTransferTarget {
	t.Helper()
	raw, err := os.ReadFile("../../contracts/samples/agent-teams-snapshots.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	var sample struct {
		Request generated.ResourceTransferAdvanceRequest `json:"transferAdvanceRequest"`
	}
	if err := json.Unmarshal(raw, &sample); err != nil {
		t.Fatal(err)
	}
	sample.Request.Target.WorkflowID = t.Name()
	return sample.Request.Target
}

// DD-42/DD-131：结果不明保持同一冻结目标重试，只有回显同一 ActionExecution 的回执才终结。
func TestResourceTransferUnknownRetriesTheFrozenTargetUntilReceipt(t *testing.T) {
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	target := transferSample(t)
	in := ComponentTaskInput{Kind: generated.WorkflowKind("RESOURCE_EXPORT"), ResourceTransfer: &target}
	calls, unknown := 0, 0
	env.OnActivity("AdvanceResourceTransfer", mock.Anything, mock.Anything).Return(
		func(_ context.Context, request generated.ResourceTransferAdvanceRequest) (generated.ResourceTransferAdvanceResult, error) {
			calls++
			if request.Target != target || request.RunID == "" || request.CancelRequested {
				t.Fatal("retry substituted the frozen transfer target")
			}
			switch calls {
			case 1:
				return generated.ResourceTransferAdvanceResult{}, errors.New("receipt lost")
			case 2:
				return generated.ResourceTransferAdvanceResult{ActionExecutionID: "other", Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
			}
			return generated.ResourceTransferAdvanceResult{ActionExecutionID: target.ActionExecutionID, Status: generated.TaskStatusCOMPLETED, WaitingReason: "NONE"}, nil
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

// 导入失败是权威拒绝（整包不提交）：Workflow 以不可重试错误终结。
func TestResourceTransferImportRefusalIsTerminal(t *testing.T) {
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	target := transferSample(t)
	target.ActionKey = "agent.team.import"
	in := ComponentTaskInput{Kind: generated.WorkflowKind("RESOURCE_IMPORT"), ResourceTransfer: &target}
	env.OnActivity("AdvanceResourceTransfer", mock.Anything, mock.Anything).Return(
		generated.ResourceTransferAdvanceResult{ActionExecutionID: target.ActionExecutionID, Status: generated.TaskStatusFAILED, WaitingReason: "NONE"}, nil)
	env.OnActivity("ProjectAgentTaskState", mock.Anything, mock.Anything).Return(nil)
	env.ExecuteWorkflow(ComponentTaskKind, in)
	if err := env.GetWorkflowError(); err == nil {
		t.Fatal("authoritative import refusal must fail the workflow")
	}
}

// kind 与动作键必须成对：导出动作不能借 RESOURCE_IMPORT 运行。
func TestResourceTransferRejectsMismatchedKind(t *testing.T) {
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	target := transferSample(t)
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{Kind: generated.WorkflowKind("RESOURCE_IMPORT"), ResourceTransfer: &target})
	if err := env.GetWorkflowError(); err == nil {
		t.Fatal("mismatched transfer kind was accepted")
	}
}
