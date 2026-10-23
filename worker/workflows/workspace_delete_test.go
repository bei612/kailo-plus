package workflows

import (
	"context"
	"sync"
	"testing"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

const deleteSnapshot = "33333333-3333-3333-3333-333333333333"

// deleteRun 记录 DELETE 段每一轮推进的载荷、调用次数与任务投影。
type deleteRun struct {
	mu       sync.Mutex
	inputs   []activities.WorkspaceDeleteAdvanceInput
	statuses []generated.TaskStatus
}

// runWorkspaceDelete 以 mock Activity 跑 WORKSPACE_LIFECYCLE 的 DELETE 段；answers 是 Core
// 依次给出的回答，最后一个之后一律重复最后一个。
func runWorkspaceDelete(t *testing.T, snapshot string, answers ...func() (activities.WorkspaceDeleteAdvanceResult, error)) (*deleteRun, error) {
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
	run := &deleteRun{}
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.TaskStateReport) error {
			run.mu.Lock()
			defer run.mu.Unlock()
			run.statuses = append(run.statuses, report.Status)
			return nil
		})
	env.OnActivity("AdvanceWorkspaceDelete", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.WorkspaceDeleteAdvanceInput) (activities.WorkspaceDeleteAdvanceResult, error) {
			run.mu.Lock()
			run.inputs = append(run.inputs, in)
			n := len(run.inputs)
			run.mu.Unlock()
			if n > len(answers) {
				n = len(answers)
			}
			return answers[n-1]()
		})
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{
		Kind: generated.WorkspaceLifecycle,
		Scope: &ScopeTarget{
			ID: suspensionWorkspace, Version: 7, SnapshotID: snapshot,
			TenantID: "11111111-1111-1111-1111-111111111111", Operation: scopeOperationDelete,
		},
	})
	return run, env.GetWorkflowError()
}

func pending(stage string) func() (activities.WorkspaceDeleteAdvanceResult, error) {
	return func() (activities.WorkspaceDeleteAdvanceResult, error) {
		return activities.WorkspaceDeleteAdvanceResult{
			State: activities.WorkspaceDeletePending, Stage: stage, SnapshotID: deleteSnapshot,
		}, nil
	}
}

func deleted() (activities.WorkspaceDeleteAdvanceResult, error) {
	return activities.WorkspaceDeleteAdvanceResult{
		State: activities.WorkspaceDeleted, SnapshotID: deleteSnapshot,
	}, nil
}

// DD-150(2)：未确认的段只让 Workflow 等下一轮，同一冻结引用重试，直到 Core 回读确认 DELETED。
func TestWorkspaceDeleteAdvancesUntilCoreConfirmsDeleted(t *testing.T) {
	run, err := runWorkspaceDelete(t, deleteSnapshot, pending("AGENTS"), pending("RELAY"), deleted)
	if err != nil {
		t.Fatalf("删除应完成，得到 %v", err)
	}
	if len(run.inputs) != 3 {
		t.Fatalf("应推进三轮，得到 %d", len(run.inputs))
	}
	for _, in := range run.inputs {
		if in.WorkspaceID != suspensionWorkspace || in.WorkspaceVersion != 7 || in.SnapshotID != deleteSnapshot {
			t.Fatalf("每一轮都必须携带同一冻结引用，得到 %+v", in)
		}
	}
	if last := run.statuses[len(run.statuses)-1]; last != generated.TaskStatusCOMPLETED {
		t.Fatalf("终态投影应为 COMPLETED，得到 %v", run.statuses)
	}
}

// 依赖不可用不是失败：保持 DELETING，下一轮继续，Workflow 不写 FAILED。
func TestWorkspaceDeleteRetriesUnavailableRounds(t *testing.T) {
	unavailable := func() (activities.WorkspaceDeleteAdvanceResult, error) {
		return activities.WorkspaceDeleteAdvanceResult{}, context.DeadlineExceeded
	}
	run, err := runWorkspaceDelete(t, deleteSnapshot, unavailable, deleted)
	if err != nil {
		t.Fatalf("不可用之后应继续直到删除，得到 %v", err)
	}
	if len(run.inputs) != 2 {
		t.Fatalf("应推进两轮，得到 %d", len(run.inputs))
	}
	for _, status := range run.statuses[:len(run.statuses)-1] {
		if status == generated.TaskStatusFAILED {
			t.Fatalf("结果不明期间不得写 FAILED：%v", run.statuses)
		}
	}
}

// Core 的确定拒绝（快照、版本或状态不符）让 Workflow 失败，不跃迁 ERROR（删除不可逆）。
func TestWorkspaceDeleteRejectedFailsWithoutTransition(t *testing.T) {
	refused := func() (activities.WorkspaceDeleteAdvanceResult, error) {
		return activities.WorkspaceDeleteAdvanceResult{}, rejectedErr()
	}
	run, err := runWorkspaceDelete(t, deleteSnapshot, refused)
	if err == nil {
		t.Fatal("确定的拒绝必须让 Workflow 失败")
	}
	if last := run.statuses[len(run.statuses)-1]; last != generated.TaskStatusFAILED {
		t.Fatalf("终态投影应为 FAILED，得到 %v", run.statuses)
	}
}

// DELETED 回答的快照不是本次冻结的那一个，不算成功证据。
func TestWorkspaceDeleteIgnoresAnotherSnapshot(t *testing.T) {
	other := func() (activities.WorkspaceDeleteAdvanceResult, error) {
		return activities.WorkspaceDeleteAdvanceResult{
			State: activities.WorkspaceDeleted, SnapshotID: "44444444-4444-4444-4444-444444444444",
		}, nil
	}
	_, err := runWorkspaceDelete(t, deleteSnapshot, other)
	if err == nil {
		t.Fatal("其他快照的 DELETED 必须让 Workflow 失败，不能记为完成")
	}
}

// 缺少冻结快照的 DELETE 段当场失败，不推进任何一轮。
func TestWorkspaceDeleteRequiresFrozenSnapshot(t *testing.T) {
	run, err := runWorkspaceDelete(t, "", deleted)
	if err == nil {
		t.Fatal("缺少快照必须失败")
	}
	if len(run.inputs) != 0 {
		t.Fatalf("缺少快照不得推进，得到 %d 轮", len(run.inputs))
	}
}
