package workflows

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"github.com/stretchr/testify/mock"
	"go.temporal.io/sdk/testsuite"
	"go.temporal.io/sdk/workflow"
)

const suspensionTenant = "33333333-3333-3333-3333-333333333333"

type tenantRun struct {
	mu       sync.Mutex
	steps    []string
	to       []string
	kinds    []string
	statuses []generated.TaskStatus
}

func (r *tenantRun) add(step string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.steps = append(r.steps, step)
}

// tenantFaults 指定哪一步返回什么错误；reconcile 按段、transition 按目标状态给出。
type tenantFaults struct {
	archive    map[bool]error
	reconcile  map[string]error
	transition map[string]error
}

func runTenantSegment(t *testing.T, operation string, faults tenantFaults) (*tenantRun, error) {
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
	run := &tenantRun{}
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, report generated.TaskStateReport) error {
			run.mu.Lock()
			defer run.mu.Unlock()
			run.statuses = append(run.statuses, report.Status)
			return nil
		})
	env.OnActivity("ConvergeTenantCommunityArchive", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.TenantArchiveInput) error {
			if in.TenantID != suspensionTenant || in.TenantVersion != 7 {
				t.Errorf("归档载荷不符：%+v", in)
			}
			if in.Archived {
				run.add("archive")
			} else {
				run.add("unarchive")
			}
			return faults.archive[in.Archived]
		})
	env.OnActivity("ReconcileTenantRestore", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.TenantRestoreInput) error {
			run.add("reconcile:" + in.Phase)
			return faults.reconcile[in.Phase]
		})
	env.OnActivity("VerifyTenantBuzz", mock.Anything, mock.Anything).Return(
		func(context.Context, activities.TenantStepInput) error {
			// NIP-11 与 host 无关，不能证明 host 由该 Community 服务（M1）
			t.Error("暂停与恢复不得以 VerifyTenantBuzz 作为 host 证明")
			return nil
		})
	env.OnActivity("ProvisionTenantBuzz", mock.Anything, mock.Anything).Return(
		func(context.Context, activities.TenantStepInput) error {
			t.Error("暂停与恢复不得执行建立链的 Community 创建")
			return nil
		})
	env.OnActivity("TransitionScope", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.ScopeTransitionInput) (activities.TransitionOutput, error) {
			run.mu.Lock()
			run.to = append(run.to, in.ToState)
			run.kinds = append(run.kinds, in.Kind)
			run.mu.Unlock()
			run.add("transition:" + in.ToState)
			if err := faults.transition[in.ToState]; err != nil {
				return activities.TransitionOutput{}, err
			}
			return activities.TransitionOutput{State: in.ToState, Version: in.FromVersion + 1}, nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{
		Kind:  generated.TenantLifecycle,
		Scope: &ScopeTarget{ID: suspensionTenant, Version: 7, Operation: operation},
	})
	return run, env.GetWorkflowError()
}

// DD-96(3)：暂停归档 Community 并回读查证后才跃迁 SUSPENDED。
func TestTenantSuspendArchivesThenTransitions(t *testing.T) {
	run, err := runTenantSegment(t, scopeOperationSuspend, tenantFaults{})
	if err != nil {
		t.Fatalf("暂停应完成，得到 %v", err)
	}
	if !sameSteps(run.steps, "archive", "transition:SUSPENDED") {
		t.Fatalf("暂停顺序不符：%v", run.steps)
	}
	if run.kinds[0] != "TENANT" {
		t.Fatalf("跃迁的 kind 应为 TENANT，得到 %v", run.kinds)
	}
	if last := run.statuses[len(run.statuses)-1]; last != generated.Completed {
		t.Fatalf("终态投影应为 COMPLETED，得到 %v", run.statuses)
	}
}

// DD-96(4)：解档前对账 binding/SpiceDB，解档后经 host 对账 roster，全部一致才 ACTIVE。
func TestTenantRestoreReconcilesAroundUnarchive(t *testing.T) {
	run, err := runTenantSegment(t, scopeOperationRestore, tenantFaults{})
	if err != nil {
		t.Fatalf("恢复应完成，得到 %v", err)
	}
	if !sameSteps(run.steps, "reconcile:BINDINGS", "unarchive", "reconcile:ROSTER", "transition:ACTIVE") {
		t.Fatalf("恢复顺序不符：%v", run.steps)
	}
}

func TestTenantSuspendRejectedEntersError(t *testing.T) {
	run, err := runTenantSegment(t, scopeOperationSuspend, tenantFaults{archive: map[bool]error{true: rejectedErr()}})
	if err == nil {
		t.Fatal("确定的拒绝必须让 Workflow 失败")
	}
	if !sameSteps(run.to, "ERROR") || run.kinds[0] != "TENANT" {
		t.Fatalf("归档被拒绝时应只跃迁 Tenant 到 ERROR，得到 %v %v", run.to, run.kinds)
	}
	if last := run.statuses[len(run.statuses)-1]; last != generated.Failed {
		t.Fatalf("终态投影应为 FAILED，得到 %v", run.statuses)
	}
}

// 解档前的对账被拒绝：不解档、不开放，进入 ERROR。
func TestTenantRestoreBindingsRejectedDoesNotUnarchive(t *testing.T) {
	run, err := runTenantSegment(t, scopeOperationRestore,
		tenantFaults{reconcile: map[string]error{activities.RestoreBindings: rejectedErr()}})
	if err == nil {
		t.Fatal("确定的拒绝必须让 Workflow 失败")
	}
	if !sameSteps(run.steps, "reconcile:BINDINGS", "transition:ERROR") {
		t.Fatalf("对账被拒绝后不得解档，步骤 %v", run.steps)
	}
}

// H2：解档之后失败，Community 已对原生端开放——先补偿归档，再置 ERROR。
func TestTenantRestoreFailureAfterUnarchiveArchivesBeforeError(t *testing.T) {
	run, err := runTenantSegment(t, scopeOperationRestore,
		tenantFaults{reconcile: map[string]error{activities.RestoreRoster: rejectedErr()}})
	if err == nil {
		t.Fatal("确定的拒绝必须让 Workflow 失败")
	}
	if !sameSteps(run.steps, "reconcile:BINDINGS", "unarchive", "reconcile:ROSTER", "archive", "transition:ERROR") {
		t.Fatalf("解档后失败应先归档再 ERROR，步骤 %v", run.steps)
	}
	if last := run.statuses[len(run.statuses)-1]; last != generated.Failed {
		t.Fatalf("终态投影应为 FAILED，得到 %v", run.statuses)
	}
}

// 补偿归档本身被拒绝：仍置 ERROR，两个错误一并上报。
func TestTenantRestoreCompensationFailureStillEntersError(t *testing.T) {
	run, err := runTenantSegment(t, scopeOperationRestore, tenantFaults{
		reconcile: map[string]error{activities.RestoreRoster: rejectedErr()},
		archive:   map[bool]error{true: rejectedErr()},
	})
	if err == nil || !strings.Contains(err.Error(), "补偿归档") {
		t.Fatalf("应同时上报原失败与补偿归档失败，得到 %v", err)
	}
	if !sameSteps(run.steps, "reconcile:BINDINGS", "unarchive", "reconcile:ROSTER", "archive", "transition:ERROR") {
		t.Fatalf("补偿归档失败后仍应置 ERROR，步骤 %v", run.steps)
	}
}

// 最终跃迁被拒绝：先补偿归档，再只试一次 ERROR；ERROR 也被拒绝时只上报，不循环。
func TestTenantTransitionRejectedTriesErrorOnce(t *testing.T) {
	run, err := runTenantSegment(t, scopeOperationRestore, tenantFaults{
		transition: map[string]error{"ACTIVE": rejectedErr(), "ERROR": rejectedErr()},
	})
	if err == nil {
		t.Fatal("跃迁被拒绝必须让 Workflow 失败")
	}
	if !sameSteps(run.to, "ACTIVE", "ERROR") {
		t.Fatalf("应先试 ACTIVE、再试一次 ERROR，得到 %v", run.to)
	}
	if !sameSteps(run.steps, "reconcile:BINDINGS", "unarchive", "reconcile:ROSTER", "transition:ACTIVE", "archive", "transition:ERROR") {
		t.Fatalf("跃迁被拒应先补偿归档，步骤 %v", run.steps)
	}
}

func TestTenantUnknownOperationIsRejected(t *testing.T) {
	run, err := runTenantSegment(t, "DELETE", tenantFaults{})
	if err == nil || len(run.steps) != 0 {
		t.Fatalf("未实现的 operation 必须当场拒绝且不执行任何步骤，得到 %v，步骤 %v", err, run.steps)
	}
}
