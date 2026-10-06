package workflows

import (
	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"context"
	"errors"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/client"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
	"testing"
	"time"
)

func TestConversationProjectionKeepsUnknownUntilSameNativeReceipt(t *testing.T) {
	Configure(Retry{StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1, InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	env.SetStartWorkflowOptions(client.StartWorkflowOptions{ID: t.Name()})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	target := generated.ConversationProjectionTarget{ActionExecutionID: "original-ae", ConversationID: "original-native-dm", WorkflowID: t.Name()}
	calls, unknown := 0, 0
	env.OnActivity("ProjectConversation", mock.Anything, mock.Anything).Return(func(_ context.Context, request generated.ConversationProjectionRequest) (generated.ConversationProjectionResult, error) {
		calls++
		if request.Target != generated.ConversationProjectionRequestTarget(target) || request.RunID == "" {
			t.Fatal("frozen projection changed")
		}
		if calls == 1 {
			return generated.ConversationProjectionResult{}, errors.New("native reply lost")
		}
		if calls == 2 {
			return generated.ConversationProjectionResult{ConversationID: "different-dm", Status: generated.Completed, WaitingReason: "NONE"}, nil
		}
		return generated.ConversationProjectionResult{ConversationID: target.ConversationID, Status: generated.Completed, WaitingReason: "NONE"}, nil
	})
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(func(_ context.Context, report generated.TaskStateReport) error {
		if report.Status == generated.TaskStatusRUNNING {
			unknown++
			if report.WaitingReason == nil || *report.WaitingReason != "UNKNOWN_EXTERNAL_RESULT" {
				t.Fatal("uncertainty hidden")
			}
		} else if report.Status != generated.Completed {
			t.Fatal("uncertain native projection rendered failed/canceled")
		}
		return nil
	})
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{Kind: generated.WorkflowKind("CONVERSATION_PROJECTION"), Conversation: &target, CancelPending: true})
	if err := env.GetWorkflowError(); err != nil || calls != 3 || unknown != 2 {
		t.Fatalf("calls=%d unknown=%d err=%v", calls, unknown, err)
	}
}
