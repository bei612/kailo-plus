package workflows

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

const metadataAction = "33333333-3333-3333-3333-333333333333"

// metadataRun 记录 METADATA 段每一轮发给 Core 的载荷与写回的投影。
type metadataRun struct {
	mu       sync.Mutex
	calls    []activities.WorkspaceMetadataInput
	statuses []generated.TaskStatus
	waiting  []string
}

type metadataAnswer func(round int, in activities.WorkspaceMetadataInput) (activities.WorkspaceMetadataResult, error)

func metadataState(state string) (activities.WorkspaceMetadataResult, error) {
	return activities.WorkspaceMetadataResult{State: state}, nil
}

// runWorkspaceMetadata 以 mock Activity 跑一条 WORKSPACE_LIFECYCLE 的 METADATA 段；answer
// 按轮次给出 Core 的回答。
func runWorkspaceMetadata(t *testing.T, action string, answer metadataAnswer) (*metadataRun, error) {
	t.Helper()
	Configure(Retry{
		StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute,
	})
	var suite testsuite.WorkflowTestSuite
	env := suite.NewTestWorkflowEnvironment()
	env.RegisterWorkflowWithOptions(ComponentTask, workflow.RegisterOptions{Name: ComponentTaskKind})
	var core *activities.CoreAPI
	var spice *activities.SpiceDB
	env.RegisterActivity(core)
	env.RegisterActivity(spice)
	run := &metadataRun{}
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.TaskStateReport) error {
			run.mu.Lock()
			defer run.mu.Unlock()
			run.statuses = append(run.statuses, report.Status)
			if report.WaitingReason != nil {
				run.waiting = append(run.waiting, *report.WaitingReason)
			}
			return nil
		})
	env.OnActivity("ConvergeWorkspaceChannelMetadata", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.WorkspaceMetadataInput) (activities.WorkspaceMetadataResult, error) {
			run.mu.Lock()
			run.calls = append(run.calls, in)
			round := len(run.calls)
			run.mu.Unlock()
			return answer(round, in)
		})
	env.OnActivity("TransitionScope", mock.Anything, mock.Anything).Return(
		func(context.Context, activities.ScopeTransitionInput) (activities.TransitionOutput, error) {
			t.Error("频道编辑不跃迁 Workspace 状态")
			return activities.TransitionOutput{}, nil
		})
	env.OnActivity("ConvergeWorkspaceChannelArchive", mock.Anything, mock.Anything).Return(
		func(context.Context, activities.WorkspaceArchiveInput) error {
			t.Error("频道编辑不经暂停与恢复的归档端点")
			return nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{
		Kind: generated.WorkspaceLifecycle,
		Scope: &ScopeTarget{
			ID: suspensionWorkspace, Version: 4, TenantID: "11111111-1111-1111-1111-111111111111",
			Operation: scopeOperationMetadata, ActionExecutionID: action,
		},
	})
	return run, env.GetWorkflowError()
}

func lastStatus(run *metadataRun) generated.TaskStatus {
	return run.statuses[len(run.statuses)-1]
}

// V-SCN-94：回读一致即完成，载荷只带引用与冻结版本，不跃迁 Workspace 状态。
func TestWorkspaceMetadataConvergesWithoutScopeTransition(t *testing.T) {
	run, err := runWorkspaceMetadata(t, metadataAction,
		func(int, activities.WorkspaceMetadataInput) (activities.WorkspaceMetadataResult, error) {
			return metadataState(activities.MetadataConverged)
		})
	if err != nil {
		t.Fatalf("回读一致应完成，得到 %v", err)
	}
	if len(run.calls) != 1 {
		t.Fatalf("已收敛不应再签发，调用 %d 次", len(run.calls))
	}
	in := run.calls[0]
	if in.WorkspaceID != suspensionWorkspace || in.WorkspaceVersion != 4 ||
		in.ActionExecutionID != metadataAction || in.LastRound {
		t.Fatalf("载荷不符：%+v", in)
	}
	if lastStatus(run) != generated.TaskStatusCOMPLETED {
		t.Fatalf("终态投影应为 COMPLETED，得到 %v", run.statuses)
	}
}

// 结果不明（回读未达目标、Core 暂不可用）以 PROJECTION_DELAYED 等一轮再收敛。
func TestWorkspaceMetadataWaitsProjectionDelayedThenConverges(t *testing.T) {
	run, err := runWorkspaceMetadata(t, metadataAction,
		func(round int, _ activities.WorkspaceMetadataInput) (activities.WorkspaceMetadataResult, error) {
			switch round {
			case 1:
				return metadataState(activities.MetadataPending)
			case 2:
				return activities.WorkspaceMetadataResult{}, errors.New("Core 503")
			default:
				return metadataState(activities.MetadataConverged)
			}
		})
	if err != nil {
		t.Fatalf("第三轮回读一致应完成，得到 %v", err)
	}
	if len(run.calls) != 3 {
		t.Fatalf("应收敛三轮，得到 %d", len(run.calls))
	}
	for _, in := range run.calls {
		if in.LastRound {
			t.Fatalf("上界之内不应进入只回读的最后一轮：%+v", in)
		}
	}
	if !sameSteps(run.waiting, waitingProjectionDelayed, waitingProjectionDelayed) {
		t.Fatalf("每次等待都应写回 PROJECTION_DELAYED，得到 %v", run.waiting)
	}
	if lastStatus(run) != generated.TaskStatusCOMPLETED {
		t.Fatalf("终态投影应为 COMPLETED，得到 %v", run.statuses)
	}
}

// 到上界仍不一致：最后一轮只回读不签发，结论 EXTERNAL_RESULT_UNKNOWN，任务 FAILED 交对账。
func TestWorkspaceMetadataUnresolvedEndsExternalResultUnknown(t *testing.T) {
	run, err := runWorkspaceMetadata(t, metadataAction,
		func(_ int, in activities.WorkspaceMetadataInput) (activities.WorkspaceMetadataResult, error) {
			if in.LastRound {
				return metadataState(activities.MetadataUnknown)
			}
			return metadataState(activities.MetadataPending)
		})
	if err == nil {
		t.Fatal("结果未决不得宣称完成")
	}
	if len(run.calls) != metadataRounds+1 {
		t.Fatalf("应在 %d 轮签发后再做一轮只回读，得到 %d", metadataRounds, len(run.calls))
	}
	for i, in := range run.calls {
		if in.LastRound != (i == metadataRounds) {
			t.Fatalf("第 %d 轮的 LastRound 不符：%+v", i+1, in)
		}
	}
	if lastStatus(run) != generated.TaskStatusFAILED {
		t.Fatalf("终态投影应为 FAILED，得到 %v", run.statuses)
	}
}

// Core 的确定拒绝（Workspace 被暂停、前置条件不成立、Relay 拒绝）立即失败，不再签发。
func TestWorkspaceMetadataRejectedFailsImmediately(t *testing.T) {
	run, err := runWorkspaceMetadata(t, metadataAction,
		func(int, activities.WorkspaceMetadataInput) (activities.WorkspaceMetadataResult, error) {
			return activities.WorkspaceMetadataResult{}, rejectedErr()
		})
	if err == nil {
		t.Fatal("确定的拒绝必须让 Workflow 失败")
	}
	if len(run.calls) != 1 {
		t.Fatalf("确定的拒绝不应重试，调用 %d 次", len(run.calls))
	}
	if lastStatus(run) != generated.TaskStatusFAILED {
		t.Fatalf("终态投影应为 FAILED，得到 %v", run.statuses)
	}
}

// 没有冻结的 workspace.update 引用时不执行任何一步。
func TestWorkspaceMetadataRequiresFrozenAction(t *testing.T) {
	run, err := runWorkspaceMetadata(t, "",
		func(int, activities.WorkspaceMetadataInput) (activities.WorkspaceMetadataResult, error) {
			return metadataState(activities.MetadataConverged)
		})
	if err == nil {
		t.Fatal("缺少冻结引用必须失败")
	}
	if len(run.calls) != 0 {
		t.Fatalf("缺少冻结引用时不应调用 Core，调用 %d 次", len(run.calls))
	}
}
