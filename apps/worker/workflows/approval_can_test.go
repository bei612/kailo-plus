package workflows

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/kailo/apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/converter"
	"go.temporal.io/sdk/workflow"
)

// ApprovalWorkflow 的 continue-as-new（.design/06 §3）：Core 长时间不可达时写回按轮
// 等待，每轮都让 history 变长；Server 建议续跑时以同一冻结 input 加已有状态续跑。
// 真实 Server 上录制的续跑 history 在 replay-tests 里回归。

// canInput 跑第一段：两人批准的策略，A 批准之后 Core 断开，写回失败一轮后续跑。
// 返回原始 input 与续跑 input。
func canInput(t *testing.T) (generated.ApprovalWorkflowInput, generated.ApprovalWorkflowInput) {
	t.Helper()
	env, rec, in := setup(t, admitted)
	in.RoleRequirements = []generated.RoleRequirementElement{{Selector: generated.TenantAdmin, MinDistinct: 2}}
	env.RegisterDelayedCallback(func() {
		rec.set(func(r *recorder) { r.projectDown = true })
		env.SetContinueAsNewSuggested(true)
	}, 30*time.Second)
	var a updateResult
	decideAt(env, time.Minute, approverA, generated.Approve, &a)
	env.ExecuteWorkflow(ApprovalKind, in)

	var can *workflow.ContinueAsNewError
	if !errors.As(env.GetWorkflowError(), &can) {
		t.Fatalf("Core 不可达且 Server 建议续跑时应 continue-as-new，得到 %v", env.GetWorkflowError())
	}
	if can.WorkflowType == nil || can.WorkflowType.Name != ApprovalKind {
		t.Fatalf("续跑换了 Workflow 类型: %+v", can.WorkflowType)
	}
	var next generated.ApprovalWorkflowInput
	if err := converter.GetDefaultDataConverter().FromPayloads(can.Input, &next); err != nil {
		t.Fatalf("续跑 input 不可解码: %v", err)
	}
	if a.err != nil || !a.outcome.(generated.ApprovalDecisionOutcome).Admitted {
		t.Fatalf("A 的批准应在续跑前形成: %+v %v", a.outcome, a.err)
	}
	return in, next
}

func TestContinueAsNewCarriesFrozenInputAndDecisions(t *testing.T) {
	in, next := canInput(t)
	r := next.Resume
	if r == nil {
		t.Fatalf("续跑 input 没有带已有状态")
	}
	frozen := next
	frozen.Resume = nil
	if fmt.Sprintf("%+v", frozen) != fmt.Sprintf("%+v", in) {
		t.Fatalf("续跑改动了冻结 input：\n%+v\n%+v", frozen, in)
	}
	if r.Status != generated.ApprovalStatusWAITING || len(r.Decisions) != 1 ||
		r.Decisions[0].ApproverPrincipalID != approverA || r.Decisions[0].Decision != generated.Approve {
		t.Fatalf("续跑没有带上 A 的决定: %+v", r)
	}
}

// 续跑后的 run 从带入的状态继续：B 一人批准即满足两人要求（另一票是续跑带来的 A），
// APPROVED → consume；A 以同一 Update ID 重发拿回原决定，冲突值仍被拒绝。测试环境不计 history 长度，
// event_id 基数跨 run 单调由真实 Server 上的录制与集成核验证明。
func TestContinueAsNewResumesWithoutLosingDecisions(t *testing.T) {
	_, next := canInput(t)
	env, rec, _ := setup(t, admitted)
	var again, conflict, b, consumed updateResult
	// B 一人批准即满足「两人」：另一票只能是续跑带来的 A
	decideAt(env, time.Minute, approverB, generated.Approve, &b)
	decideAt(env, 90*time.Second, approverA, generated.Approve, &again)
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateDecide, "wf:"+approverA+":again", conflict.callbacks(),
			generated.ApprovalDecisionUpdate{ApproverPrincipalID: approverA, Decision: generated.ApprovalDecisionDENY})
	}, 100*time.Second)
	env.RegisterDelayedCallback(func() {
		env.UpdateWorkflow(UpdateConsume, next.ActionExecutionID+":consume", consumed.callbacks())
	}, 3*time.Minute)
	env.ExecuteWorkflow(ApprovalKind, next)

	if err := env.GetWorkflowError(); err != nil {
		t.Fatalf("续跑后的 run 失败: %v", err)
	}
	if bo, ok := b.outcome.(generated.ApprovalDecisionOutcome); !ok || bo.Status != generated.Approved {
		t.Fatalf("B 的批准应与续跑带来的 A 一起满足两人要求: %+v %v", b.outcome, b.err)
	}
	out, ok := again.outcome.(generated.ApprovalDecisionOutcome)
	if again.err != nil || !ok || !out.Admitted || out.Decision == nil || *out.Decision != generated.Approve {
		t.Fatalf("A 重发应拿回续跑前的决定: %+v %v", again.outcome, again.err)
	}
	if reasonOf(conflict.rejected) != string(generated.DuplicateDecision) {
		t.Fatalf("续跑后 A 的冲突值应仍被拒绝为 DUPLICATE_DECISION，得到 %v", conflict.rejected)
	}
	last := rec.last()
	if last.Status != generated.Consumed || len(last.Decisions) != 2 {
		t.Fatalf("续跑后应在两人批准后 APPROVED 并被消费: %+v", last)
	}
	if rec.statuses()[0] == generated.Requested {
		t.Fatalf("续跑后的 run 不应回到 REQUESTED: %v", rec.statuses())
	}
}

// 续跑前排空 handler：Server 建议续跑时，资格判定依赖不可用的 decide 交还为
// DEPENDENCY_UNAVAILABLE（不形成决定、不进资格结论），审批随即续跑。
func TestContinueAsNewDrainsPendingAdmission(t *testing.T) {
	env, rec, in := setup(t, admitted)
	rec.set(func(r *recorder) { r.admitDown = true })
	env.RegisterDelayedCallback(func() { env.SetContinueAsNewSuggested(true) }, 30*time.Second)
	var a updateResult
	decideAt(env, time.Minute, approverA, generated.Approve, &a)
	env.ExecuteWorkflow(ApprovalKind, in)

	var can *workflow.ContinueAsNewError
	if !errors.As(env.GetWorkflowError(), &can) {
		t.Fatalf("应 continue-as-new，得到 %v", env.GetWorkflowError())
	}
	if reasonOf(a.err) != string(generated.DependencyUnavailable) {
		t.Fatalf("排空时在途的资格判定应交还为 DEPENDENCY_UNAVAILABLE，得到 %v %+v", a.err, a.outcome)
	}
	var next generated.ApprovalWorkflowInput
	if err := converter.GetDefaultDataConverter().FromPayloads(can.Input, &next); err != nil {
		t.Fatalf("续跑 input 不可解码: %v", err)
	}
	if len(next.Resume.Decisions) != 0 || len(next.Resume.Refusals) != 0 {
		t.Fatalf("交还的判定不应留下决定或资格结论: %+v", next.Resume)
	}
}
