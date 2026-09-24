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

// 审批状态机的确定性核验。用 Temporal 的测试环境（时间可跳跃）而不是真实
// Server：过期与 consume 截止是小时级 timer，只有跳时才能在测试里走到。真实
// Server 上的端到端链路（准入 → 审批 → 重新准入 → dispatch → CONSUMED）由
// core/crates/kailo-core/tests/governed_action.rs 核验。

const (
	initiator = "11111111-1111-1111-1111-111111111111"
	approverA = "22222222-2222-2222-2222-222222222222"
	approverB = "33333333-3333-3333-3333-333333333333"
)

type recorder struct {
	mu      sync.Mutex
	reports []generated.ApprovalStateReport
	tasks   []generated.TaskStatus
	// Core 不可达的模拟：置真后审批投影写回与资格判定分别失败
	projectDown bool
	admitDown   bool
}

func (r *recorder) set(f func(*recorder)) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f(r)
}

func (r *recorder) last() generated.ApprovalStateReport {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.reports[len(r.reports)-1]
}

func (r *recorder) statuses() []generated.ApprovalStatus {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []generated.ApprovalStatus
	for _, x := range r.reports {
		if len(out) == 0 || out[len(out)-1] != x.Status {
			out = append(out, x.Status)
		}
	}
	return out
}

func setup(t *testing.T, admit func(generated.FreshApprovalAdmissionRequest) generated.FreshApprovalAdmissionResult) (*testsuite.TestWorkflowEnvironment, *recorder, generated.ApprovalWorkflowInput) {
	t.Helper()
	Configure(Retry{
		StartToClose: time.Second, ScheduleToClose: time.Second, MaxAttempts: 1,
		InitialInterval: time.Second, MaxInterval: time.Second, RoundInterval: time.Minute,
	})
	var s testsuite.WorkflowTestSuite
	env := s.NewTestWorkflowEnvironment()
	env.SetStartTime(time.Date(2026, 9, 24, 0, 0, 0, 0, time.UTC))
	rec := &recorder{}
	env.RegisterWorkflowWithOptions(Approval, workflow.RegisterOptions{Name: ApprovalKind})
	var core *activities.CoreAPI
	env.RegisterActivity(core)
	env.OnActivity("ProjectApprovalState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, r generated.ApprovalStateReport) error {
			rec.mu.Lock()
			defer rec.mu.Unlock()
			if rec.projectDown {
				return errors.New("Core 不可达")
			}
			rec.reports = append(rec.reports, r)
			return nil
		})
	env.OnActivity("ProjectTaskState", mock.Anything, mock.Anything).Return(
		func(_ context.Context, r generated.TaskStateReport) error {
			rec.mu.Lock()
			rec.tasks = append(rec.tasks, r.Status)
			rec.mu.Unlock()
			return nil
		})
	env.OnActivity("FreshApprovalAdmission", mock.Anything, mock.Anything).Return(
		func(_ context.Context, req generated.FreshApprovalAdmissionRequest) (generated.FreshApprovalAdmissionResult, error) {
			rec.mu.Lock()
			down := rec.admitDown
			rec.mu.Unlock()
			if down {
				return generated.FreshApprovalAdmissionResult{}, errors.New("Core 不可达")
			}
			return admit(req), nil
		})
	in := generated.ApprovalWorkflowInput{
		ActionExecutionID: "44444444-4444-4444-4444-444444444444", OperationID: "55555555-5555-5555-5555-555555555555",
		TenantID: "66666666-6666-6666-6666-666666666666", ActionKey: "tenant.member.revoke",
		ActionDefinitionVersion: 1, TargetType: "TENANT_MEMBERSHIP", TargetID: "77777777-7777-7777-7777-777777777777",
		ParameterHash: "h", PolicyID: "88888888-8888-8888-8888-888888888888", PolicyVersion: 1,
		RoleRequirements:     []generated.RoleRequirementElement{{Selector: generated.TenantAdmin, MinDistinct: 1}},
		OwnerRequirement:     generated.None,
		AffectedOwnerRefs:    []generated.AffectedOwnerRefElement{},
		SelfApproval:         generated.ApprovalSelfApprovalDENY,
		InitiatorPrincipalID: initiator,
		ExpiresAt:            "2026-09-24T01:00:00Z",
		ConsumeWindowSeconds: 600,
	}
	return env, rec, in
}

func admitted(generated.FreshApprovalAdmissionRequest) generated.FreshApprovalAdmissionResult {
	return generated.FreshApprovalAdmissionResult{Admitted: true, SatisfiedSelectors: []generated.ApprovalSelector{generated.TenantAdmin}}
}

type updateResult struct {
	rejected error
	outcome  any
	err      error
}

func (u *updateResult) callbacks() *testsuite.TestUpdateCallback {
	return &testsuite.TestUpdateCallback{
		OnReject:   func(err error) { u.rejected = err },
		OnAccept:   func() {},
		OnComplete: func(v interface{}, err error) { u.outcome, u.err = v, err },
	}
}

func decideAt(env *testsuite.TestWorkflowEnvironment, after time.Duration, approver string, d generated.ApprovalDecision, res *updateResult) {
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateDecide, "wf:"+approver, res.callbacks(),
			generated.ApprovalDecisionUpdate{ApproverPrincipalID: approver, Decision: d})
	}, after)
}

func reasonOf(err error) string {
	var app *temporal.ApplicationError
	if errors.As(err, &app) {
		return app.Type()
	}
	return ""
}

func TestApproveThenConsume(t *testing.T) {
	env, rec, in := setup(t, admitted)
	var dec, dup, conflict, consumed updateResult
	decideAt(env, time.Minute, approverA, generated.Approve, &dec)
	// 同值重复：幂等，回原决定
	decideAt(env, 2*time.Minute, approverA, generated.Approve, &dup)
	// 冲突值：Validator 拒绝。用另一个 Update ID 才能走到 Validator——同一 ID 由
	// Server 去重，直接拿回第一次的结论（Core 比对后回 DUPLICATE_DECISION）
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateDecide, "wf:"+approverA+":again", conflict.callbacks(),
			generated.ApprovalDecisionUpdate{ApproverPrincipalID: approverA, Decision: generated.ApprovalDecisionDENY})
	}, 150*time.Second)
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateConsume, in.ActionExecutionID+":consume", consumed.callbacks())
	}, 3*time.Minute)
	env.ExecuteWorkflow(ApprovalKind, in)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("workflow 失败: %v", err)
	}
	if dec.err != nil || dec.outcome.(generated.ApprovalDecisionOutcome).Status != generated.Approved {
		t.Fatalf("批准未使状态进入 APPROVED: %+v %v", dec.outcome, dec.err)
	}
	if dup.rejected != nil || !dup.outcome.(generated.ApprovalDecisionOutcome).Admitted {
		t.Fatalf("同值重复应幂等: rejected=%v outcome=%+v", dup.rejected, dup.outcome)
	}
	if reasonOf(conflict.rejected) != string(generated.DuplicateDecision) {
		t.Fatalf("冲突值应被拒绝为 DUPLICATE_DECISION，得到 %v", conflict.rejected)
	}
	want := []generated.ApprovalStatus{generated.Requested, generated.ApprovalStatusWAITING, generated.Approved, generated.Consumed}
	if got := rec.statuses(); len(got) != len(want) || got[3] != want[3] || got[2] != want[2] {
		t.Fatalf("投影序列 %v，期望 %v", got, want)
	}
	if rec.last().ConsumeDeadline == nil || rec.last().ConsumedAt == nil {
		t.Fatalf("终态投影缺 consumeDeadline/consumedAt: %+v", rec.last())
	}
	if rec.tasks[len(rec.tasks)-1] != generated.Completed {
		t.Fatalf("终态之后没有写 COMPLETED 的任务投影")
	}
}

func TestDenyTerminates(t *testing.T) {
	env, rec, in := setup(t, admitted)
	var d updateResult
	decideAt(env, time.Minute, approverA, generated.ApprovalDecisionDENY, &d)
	env.ExecuteWorkflow(ApprovalKind, in)
	if rec.last().Status != generated.ApprovalStatusDENIED || *rec.last().Reason != generated.ApprovalDenied {
		t.Fatalf("有效 DENY 应终结为 DENIED: %+v", rec.last())
	}
}

func TestExpiry(t *testing.T) {
	env, rec, in := setup(t, admitted)
	var late updateResult
	// 过期之后的决定：Validator 拒绝，不形成决定
	decideAt(env, 2*time.Hour, approverA, generated.Approve, &late)
	env.ExecuteWorkflow(ApprovalKind, in)
	if rec.last().Status != generated.ApprovalStatusEXPIRED || len(rec.last().Decisions) != 0 {
		t.Fatalf("到期应 EXPIRED 且没有决定: %+v", rec.last())
	}
	if late.outcome != nil && late.rejected == nil {
		t.Fatalf("过期后的 Update 不应被接受: %+v", late.outcome)
	}
}

func TestConsumeDeadlineInvalidates(t *testing.T) {
	env, rec, in := setup(t, admitted)
	var d updateResult
	decideAt(env, time.Minute, approverA, generated.Approve, &d)
	env.ExecuteWorkflow(ApprovalKind, in)
	last := rec.last()
	if last.Status != generated.Invalidated || *last.Reason != generated.ApprovalConsumeWindowClosed {
		t.Fatalf("APPROVED 之后没有 consume 应在截止时 INVALIDATED: %+v", last)
	}
}

func TestInvalidateAfterApproval(t *testing.T) {
	env, rec, in := setup(t, admitted)
	var d, inv, consume updateResult
	decideAt(env, time.Minute, approverA, generated.Approve, &d)
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateInvalidate, in.ActionExecutionID+":invalidate", inv.callbacks(),
			generated.ApprovalInvalidateUpdate{Reason: generated.PermissionDenied})
	}, 2*time.Minute)
	// 失效之后不能再消费
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateConsume, in.ActionExecutionID+":consume", consume.callbacks())
	}, 3*time.Minute)
	env.ExecuteWorkflow(ApprovalKind, in)
	if rec.last().Status != generated.Invalidated || *rec.last().Reason != generated.PermissionDenied {
		t.Fatalf("invalidate 应使批准失效并带原因: %+v", rec.last())
	}
	if consume.rejected == nil && consume.outcome != nil {
		t.Fatalf("已失效的批准不应被消费: %+v", consume.outcome)
	}
}

func TestIneligibleApproverDoesNotDecide(t *testing.T) {
	env, rec, in := setup(t, func(r generated.FreshApprovalAdmissionRequest) generated.FreshApprovalAdmissionResult {
		if r.ApproverPrincipalID == approverA {
			reason := generated.ApproverNotEligible
			return generated.FreshApprovalAdmissionResult{Reason: &reason}
		}
		return admitted(r)
	})
	var a, b updateResult
	decideAt(env, time.Minute, approverA, generated.ApprovalDecisionDENY, &a)
	decideAt(env, 2*time.Minute, approverB, generated.Approve, &b)
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateConsume, in.ActionExecutionID+":consume", (&updateResult{}).callbacks())
	}, 3*time.Minute)
	env.ExecuteWorkflow(ApprovalKind, in)
	out := a.outcome.(generated.ApprovalDecisionOutcome)
	if out.Admitted || *out.Reason != generated.ApproverNotEligible {
		t.Fatalf("不合格 approver 的 DENY 不应形成决定: %+v", out)
	}
	if rec.last().Status != generated.Consumed || len(rec.last().Decisions) != 1 {
		t.Fatalf("不合格的否决不应终结审批: %+v", rec.last())
	}
}

func TestWithdraw(t *testing.T) {
	env, rec, in := setup(t, admitted)
	var w, d updateResult
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateWithdraw, in.ActionExecutionID+":withdraw", w.callbacks())
	}, time.Minute)
	decideAt(env, 2*time.Minute, approverA, generated.Approve, &d)
	env.ExecuteWorkflow(ApprovalKind, in)
	if rec.last().Status != generated.Cancelled {
		t.Fatalf("撤回应 CANCELLED: %+v", rec.last())
	}
	// 撤回之后审批已终结：决定不被接受（Workflow 已关闭或 Validator 拒绝），也不进投影
	if d.outcome != nil && d.rejected == nil {
		t.Fatalf("撤回之后的决定不应被接受: %+v", d.outcome)
	}
	if len(rec.last().Decisions) != 0 {
		t.Fatalf("撤回之后不应有决定: %+v", rec.last())
	}
}
