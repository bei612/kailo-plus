package workflows

import (
	"context"
	"errors"
	"strings"
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

// runMembershipRevocation 执行一次成员撤权链，按顺序记下每一步。
func runMembershipRevocation(t *testing.T, m MembershipTarget) ([]string, error) {
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
	var mu sync.Mutex
	var steps []string
	add := func(s string) {
		mu.Lock()
		defer mu.Unlock()
		steps = append(steps, s)
	}
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(nil)
	env.OnActivity("RevokeSubject", mock.Anything, mock.Anything).Return(
		func(_ context.Context, s activities.SubjectScope) error {
			add("revoke-subject:tenant=" + s.TenantID + ",workspace=" + s.WorkspaceID)
			return nil
		})
	env.OnActivity("Converge", mock.Anything, mock.Anything, mock.Anything).Return(
		func(_ context.Context, rel activities.Relationship, _ activities.Presence) error {
			add("converge:" + rel.ResourceType + "#" + rel.Relation)
			return nil
		})
	env.OnActivity("ProjectBuzzRoster", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.BuzzProjectionInput) error {
			add("roster:" + in.Scope + ":" + in.MembershipID + ":" + in.Presence)
			return nil
		})
	env.OnActivity("TransitionMembership", mock.Anything, mock.Anything).Return(
		func(_ context.Context, in activities.TransitionInput) (activities.TransitionOutput, error) {
			add("transition:" + in.Scope + ":" + in.MembershipID + ":" + in.ToState)
			return activities.TransitionOutput{State: in.ToState, Version: in.FromVersion + 1}, nil
		})
	env.ExecuteWorkflow(ComponentTaskKind, ComponentTaskInput{
		Kind: generated.MembershipRevocation, Membership: &m,
	})
	return steps, env.GetWorkflowError()
}

// V-SCN-34：Tenant 撤权先按主体撤全部关系，再逐个把连带的 WorkspaceMembership
// 撤出 Channel roster 并推进到 REVOKED，最后才撤 relay roster、推进 Tenant 成员。
func TestTenantRevocationConvergesWorkspaceMembershipsFirst(t *testing.T) {
	steps, err := runMembershipRevocation(t, MembershipTarget{
		Scope: "TENANT", MembershipID: "tm", MembershipVersion: 3,
		SubjectPrincipalID: "p", RelationObjectID: "t",
		WorkspaceMemberships: []WorkspaceMembershipRef{
			{MembershipID: "wm1", MembershipVersion: 2, WorkspaceID: "w1"},
			{MembershipID: "wm2", MembershipVersion: 5, WorkspaceID: "w2"},
		},
	})
	if err != nil {
		t.Fatalf("撤权链失败：%v", err)
	}
	want := []string{
		"revoke-subject:tenant=t,workspace=",
		"roster:WORKSPACE:wm1:ABSENT",
		"transition:WORKSPACE:wm1:REVOKED",
		"roster:WORKSPACE:wm2:ABSENT",
		"transition:WORKSPACE:wm2:REVOKED",
		"roster:TENANT:tm:ABSENT",
		"transition:TENANT:tm:REVOKED",
	}
	if strings.Join(steps, "\n") != strings.Join(want, "\n") {
		t.Fatalf("步骤顺序不符：\n%s", strings.Join(steps, "\n"))
	}
}

// V-SCN-35：Workspace 撤权撤掉此人在该 Workspace 上的全部关系（含 workspace#admin），
// 不只是 member。
func TestWorkspaceRevocationRevokesAllRelationsOnWorkspace(t *testing.T) {
	steps, err := runMembershipRevocation(t, MembershipTarget{
		Scope: "WORKSPACE", MembershipID: "wm", MembershipVersion: 4,
		SubjectPrincipalID: "p", RelationObjectID: "w",
	})
	if err != nil {
		t.Fatalf("撤权链失败：%v", err)
	}
	want := []string{
		"revoke-subject:tenant=,workspace=w",
		"roster:WORKSPACE:wm:ABSENT",
		"transition:WORKSPACE:wm:REVOKED",
	}
	if strings.Join(steps, "\n") != strings.Join(want, "\n") {
		t.Fatalf("步骤顺序不符：\n%s", strings.Join(steps, "\n"))
	}
}
