package workflows

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/kailo/apps/worker/activities"
	"github.com/kailo/apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

// 取消请求只中止 Workflow；已经投递的外部投影不能被解释为已回滚。终态必须
// 在脱离已取消的 Context 后由 ProjectTaskState 写回，Core 暂不可达时继续等待。
func TestComponentTaskCancelProjectsTerminal(t *testing.T) {
	runComponentCancellation(t, false)
}

func TestComponentTaskCancelWaitsForCore(t *testing.T) {
	runComponentCancellation(t, true)
}

func TestComponentTaskCancelResumeDoesNotRepeatBusinessStep(t *testing.T) {
	Configure(Retry{
		StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute,
	})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	called := 0
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.TaskStateReport) error {
			called++
			if report.Status != generated.Canceled {
				return errors.New("续跑重新执行了业务 Workflow")
			}
			return nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{
		Kind: generated.TenantLifecycle, CancelPending: true,
		Scope: &ScopeTarget{ID: "11111111-1111-1111-1111-111111111111", Version: 1},
	})
	if err := env.GetWorkflowError(); !temporal.IsCanceledError(err) || called != 1 {
		t.Fatalf("续跑只应写一次 CANCELED，结果 %v，投影次数 %d", err, called)
	}
}

func runComponentCancellation(t *testing.T, failCancelOnce bool) {
	t.Helper()
	Configure(Retry{
		StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute,
	})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	var mu sync.Mutex
	var statuses []generated.TaskStatus
	cancelAttempts := 0
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.TaskStateReport) error {
			mu.Lock()
			defer mu.Unlock()
			if report.Status == generated.Canceled {
				cancelAttempts++
				if failCancelOnce && cancelAttempts == 1 {
					return errors.New("Core temporarily unavailable")
				}
			}
			statuses = append(statuses, report.Status)
			return nil
		})
	env.OnActivity("ProvisionTenantBuzz", mock.Anything, mock.Anything).Return(
		errors.New("Core temporarily unavailable"))
	env.RegisterDelayedCallback(env.CancelWorkflow, 2*time.Minute)
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{
		Kind:  generated.TenantLifecycle,
		Scope: &ScopeTarget{ID: "11111111-1111-1111-1111-111111111111", Version: 1},
	})
	if err := env.GetWorkflowError(); !temporal.IsCanceledError(err) {
		t.Fatalf("Workflow 应以 CanceledError 终结，得到 %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(statuses) == 0 || statuses[len(statuses)-1] != generated.Canceled {
		t.Fatalf("取消后必须写入 CANCELED 终态，得到 %v", statuses)
	}
	if failCancelOnce && cancelAttempts != 2 {
		t.Fatalf("取消终态必须在 Core 恢复后重试，尝试次数 %d", cancelAttempts)
	}
}
