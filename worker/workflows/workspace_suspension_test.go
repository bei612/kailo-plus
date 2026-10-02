package workflows

import (
	"context"
	"sync"
	"testing"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

const suspensionWorkspace = "22222222-2222-2222-2222-222222222222"

// suspensionRun 以 mock Activity 跑一条 WORKSPACE_LIFECYCLE，记录每一步的顺序与载荷。
type suspensionRun struct {
	mu       sync.Mutex
	steps    []string
	archives []activities.WorkspaceArchiveInput
	rosters  []activities.WorkspaceRosterInput
	to       []string
	statuses []generated.TaskStatus
}

func (r *suspensionRun) add(step string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.steps = append(r.steps, step)
}

// segmentFaults 指定哪一步返回什么错误；transition 按目标状态给出。
type segmentFaults struct {
	archive    error
	roster     error
	transition map[string]error
}

func runWorkspaceSegment(t *testing.T, operation string, faults segmentFaults) (*suspensionRun, error) {
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
	run := &suspensionRun{}
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.TaskStateReport) error {
			run.mu.Lock()
			defer run.mu.Unlock()
			run.statuses = append(run.statuses, report.Status)
			return nil
		})
	env.OnActivity("Converge", mock.Anything, mock.Anything, mock.Anything).Return(
		func(_ context.Context, rel activities.Relationship, want activities.Presence) error {
			if rel.ResourceType != "workspace" || rel.Relation != "tenant" || want != activities.Present {
				t.Errorf("恢复只能查证 workspace#tenant 归属关系，得到 %s %s", rel, want)
			}
			run.add("spicedb")
			return nil
		})
	env.OnActivity("ConvergeWorkspaceChannelArchive", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.WorkspaceArchiveInput) error {
			run.mu.Lock()
			run.archives = append(run.archives, in)
			run.mu.Unlock()
			run.add("archive")
			return faults.archive
		})
	env.OnActivity("ConvergeWorkspaceChannelRoster", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.WorkspaceRosterInput) error {
			run.mu.Lock()
			run.rosters = append(run.rosters, in)
			run.mu.Unlock()
			run.add("roster:" + in.Mode)
			return faults.roster
		})
	env.OnActivity("TransitionScope", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.ScopeTransitionInput) (activities.TransitionOutput, error) {
			run.mu.Lock()
			run.to = append(run.to, in.ToState)
			run.mu.Unlock()
			run.add("transition:" + in.ToState)
			if err := faults.transition[in.ToState]; err != nil {
				return activities.TransitionOutput{}, err
			}
			return activities.TransitionOutput{State: in.ToState, Version: in.FromVersion + 1}, nil
		})
	env.OnActivity("ProvisionWorkspaceBuzz", mock.Anything, mock.Anything).Return(
		func(context.Context, activities.WorkspaceStepInput) error {
			t.Error("暂停与恢复不得执行建立链的 Channel 创建")
			return nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{
		Kind: generated.WorkspaceLifecycle,
		Scope: &ScopeTarget{
			ID: suspensionWorkspace, Version: 4,
			TenantID: "11111111-1111-1111-1111-111111111111", Operation: operation,
		},
	})
	return run, env.GetWorkflowError()
}

func rejectedErr() error {
	return temporal.NewNonRetryableApplicationError("被拒绝", activities.ErrTypeRejected, nil)
}

func sameSteps(got []string, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}

// DD-97：暂停先清空 roster、再归档，两步查证后才跃迁 SUSPENDED。
func TestWorkspaceSuspendClearsRosterThenArchives(t *testing.T) {
	run, err := runWorkspaceSegment(t, scopeOperationSuspend, segmentFaults{})
	if err != nil {
		t.Fatalf("暂停应完成，得到 %v", err)
	}
	if !sameSteps(run.steps, "roster:CLEAR", "archive", "transition:SUSPENDED") {
		t.Fatalf("暂停必须先清空 roster、再归档、最后跃迁，顺序 %v", run.steps)
	}
	if a := run.archives[0]; !a.Archived || a.WorkspaceVersion != 4 || a.WorkspaceID != suspensionWorkspace {
		t.Fatalf("归档载荷不符：%+v", a)
	}
	if r := run.rosters[0]; r.WorkspaceVersion != 4 || r.WorkspaceID != suspensionWorkspace {
		t.Fatalf("roster 载荷不符：%+v", r)
	}
	if last := run.statuses[len(run.statuses)-1]; last != generated.Completed {
		t.Fatalf("终态投影应为 COMPLETED，得到 %v", run.statuses)
	}
}

// 恢复先对账归属关系、再解档、再按 Core 事实重建 roster，全部查证后才 ACTIVE。
func TestWorkspaceRestoreUnarchivesThenRebuildsRoster(t *testing.T) {
	run, err := runWorkspaceSegment(t, scopeOperationRestore, segmentFaults{})
	if err != nil {
		t.Fatalf("恢复应完成，得到 %v", err)
	}
	if !sameSteps(run.steps, "spicedb", "archive", "roster:REBUILD", "transition:ACTIVE") {
		t.Fatalf("恢复顺序不符：%v", run.steps)
	}
	if a := run.archives[0]; a.Archived {
		t.Fatalf("恢复应解档，得到 %+v", a)
	}
}

// 归档被确定拒绝时 Workspace 进入 ERROR（可再暂停收敛），任务写 FAILED；不跃迁到 SUSPENDED。
func TestWorkspaceSuspendRejectedEntersError(t *testing.T) {
	run, err := runWorkspaceSegment(t, scopeOperationSuspend, segmentFaults{archive: rejectedErr()})
	if err == nil {
		t.Fatal("确定的拒绝必须让 Workflow 失败")
	}
	if len(run.to) != 1 || run.to[0] != "ERROR" {
		t.Fatalf("归档被拒绝时应只跃迁到 ERROR，得到 %v", run.to)
	}
	if last := run.statuses[len(run.statuses)-1]; last != generated.TaskStatusFAILED {
		t.Fatalf("终态投影应为 FAILED，得到 %v", run.statuses)
	}
}

// 重建被拒绝时不开放，进入 ERROR。
func TestWorkspaceRestoreRosterRejectedEntersError(t *testing.T) {
	run, err := runWorkspaceSegment(t, scopeOperationRestore, segmentFaults{roster: rejectedErr()})
	if err == nil {
		t.Fatal("确定的拒绝必须让 Workflow 失败")
	}
	if len(run.to) != 1 || run.to[0] != "ERROR" {
		t.Fatalf("重建被拒绝时应只跃迁到 ERROR，得到 %v", run.to)
	}
}

// 跃迁本身被拒绝：只再试一次 ERROR；ERROR 也被拒绝时只上报，不循环。
func TestWorkspaceTransitionRejectedTriesErrorOnce(t *testing.T) {
	run, err := runWorkspaceSegment(t, scopeOperationSuspend, segmentFaults{
		transition: map[string]error{"SUSPENDED": rejectedErr(), "ERROR": rejectedErr()},
	})
	if err == nil {
		t.Fatal("跃迁被拒绝必须让 Workflow 失败")
	}
	if !sameSteps(run.to, "SUSPENDED", "ERROR") {
		t.Fatalf("应先试 SUSPENDED、再试一次 ERROR，得到 %v", run.to)
	}
	if last := run.statuses[len(run.statuses)-1]; last != generated.TaskStatusFAILED {
		t.Fatalf("终态投影应为 FAILED，得到 %v", run.statuses)
	}
}

func TestWorkspaceUnknownOperationIsRejected(t *testing.T) {
	run, err := runWorkspaceSegment(t, "DELETE", segmentFaults{})
	if err == nil || len(run.steps) != 0 {
		t.Fatalf("未实现的 operation 必须当场拒绝且不执行任何步骤，得到 %v，步骤 %v", err, run.steps)
	}
}
