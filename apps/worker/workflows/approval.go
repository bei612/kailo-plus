package workflows

import (
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/kailo/apps/worker/activities"
	"github.com/kailo/apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ApprovalKind 是 Worker 注册的审批 Workflow 类型名，与 Core 的
// APPROVAL_WORKFLOW_TYPE 逐字相同。
const ApprovalKind = "ApprovalWorkflow"

// 四个 Update 的名字。决定的 Update ID 固定为 <approval_workflow_id>:<approver>，
// 其余三个为 <action_execution_id>:<name>，都由 Server 侧去重（.design/06 §4）。
const (
	UpdateDecide     = "decide"
	UpdateWithdraw   = "withdraw"
	UpdateConsume    = "consume"
	UpdateInvalidate = "invalidate"
)

// waitingApproval 是审批等待期间写回 TaskProjection 的等待原因，取 contracts 的
// reason code，不带自由文本。
const waitingApproval = string(generated.WaitingApproval)

// changeApprovalContinueAsNew 门控 continue-as-new（.design/06 §3）。一经发布即不可
// 改名、不可复用：已录制的 history 里记着它。门控之前的在途审批与录制 history 不做
// continue-as-new，重放走原来的命令序列。
const changeApprovalContinueAsNew = "approval-continue-as-new"

// errContinueAsNew 是「此处需要续跑」的内部信号：写回循环在 Server 建议续跑时以它
// 返回，由主协程在安全点排空 handler 后续跑。它从不离开本 Workflow。
var errContinueAsNew = errors.New("审批需要 continue-as-new")

// approval 是一条审批的全部可变状态。只有 update handler 与主协程改它，二者
// 在同一个确定性调度器上交替运行，不存在并发写。
type approval struct {
	in              generated.ApprovalWorkflowInput
	expiresAt       time.Time
	status          generated.ApprovalStatus
	reason          *generated.ReasonCode
	decisions       []generated.ApprovalDecisionRecord
	refused         map[string]generated.ReasonCode // 资格未通过的 approver：同一 Update ID 只判一次
	inFlight        map[string]bool                 // 正在做资格判定的 approver
	consumeDeadline time.Time
	consumedAt      time.Time
	// 每次状态变化加一；主协程据此知道需要再写一次投影
	version int
	// 此前各 run 的 history 长度之和：投影的 event_id 跨 run 单调（06 §3）
	eventBase int64
	// 本次执行是否启用 continue-as-new（GetVersion 门控的结论）
	canEnabled bool
	// 已请求续跑：handler 不再发起新的资格判定，主协程排空 handler 后续跑
	wantCAN bool
}

// suggested 是 Server 对本 run 的续跑建议（history 事件数、字节或 Update 数接近上限）。
// 它记在 WorkflowTaskStarted 事件里，重放取到同一个值。
func (a *approval) suggested(ctx workflow.Context) bool {
	return a.canEnabled && workflow.GetInfo(ctx).GetContinueAsNewSuggested()
}

func refuse(code generated.ReasonCode, msg string) error {
	// type 固定为 contracts 的 reason code：Core 读 ApplicationFailureInfo.type 映射拒绝原因
	return temporal.NewNonRetryableApplicationError(msg, string(code), nil)
}

func (a *approval) recorded(approver string) *generated.ApprovalDecisionRecord {
	for i := range a.decisions {
		if a.decisions[i].ApproverPrincipalID == approver {
			return &a.decisions[i]
		}
	}
	return nil
}

func (a *approval) set(status generated.ApprovalStatus, reason *generated.ReasonCode) {
	a.status = status
	a.reason = reason
	a.version++
}

func reasonPtr(r generated.ReasonCode) *generated.ReasonCode { return &r }

// satisfied 判定角色要求是否逐项满足：每项各自数不同 approver，同一人可在多个
// 要求中计数，但只有一个决定（.design/03 §6）。不以总人数替代某一项。
func (a *approval) satisfied() bool {
	if a.in.OwnerRequirement != generated.None {
		// Core 在请求时已拒绝本切片无法解析的 owner 要求；走到这里说明输入与
		// Core 的判定不一致，按不满足处理——fail closed
		return false
	}
	for _, req := range a.in.RoleRequirements {
		n := int64(0)
		for _, d := range a.decisions {
			if d.Decision != generated.Approve {
				continue
			}
			for _, s := range d.SatisfiedSelectors {
				if s == req.Selector {
					n++
					break
				}
			}
		}
		if n < req.MinDistinct {
			return false
		}
	}
	return len(a.in.RoleRequirements) > 0
}

// validateDecide 是 decide 的 Validator：只做确定性的状态判断，不调度 Activity、
// 不改状态（SF-TSDK-09）。重放时整段跳过，因此它的结论不能是 history 的一部分。
func (a *approval) validateDecide(ctx workflow.Context, u generated.ApprovalDecisionUpdate) error {
	if u.Decision != generated.Approve && u.Decision != generated.ApprovalDecisionDENY {
		return refuse(generated.InvalidParameters, "决定只能是 APPROVE 或 DENY")
	}
	if u.ApproverPrincipalID == "" {
		return refuse(generated.InvalidParameters, "缺 approver")
	}
	if d := a.recorded(u.ApproverPrincipalID); d != nil {
		if d.Decision == u.Decision {
			return nil // 同值重复：幂等，handler 回原决定
		}
		return refuse(generated.DuplicateDecision, "该 approver 已有不可变的相反决定")
	}
	if _, ok := a.refused[u.ApproverPrincipalID]; ok {
		return nil // 资格已判定未通过：handler 回同一结论
	}
	if a.inFlight[u.ApproverPrincipalID] {
		return refuse(generated.DuplicateDecision, "该 approver 的决定正在判定")
	}
	// 续跑前排空 handler：新的资格判定留给续跑后的 run。拒绝不形成决定，同一
	// Update ID 在新 run 上可以重发
	if a.wantCAN {
		return refuse(generated.DependencyUnavailable, "审批正在续跑，稍后重发")
	}
	if a.status != generated.ApprovalStatusWAITING {
		return refuse(generated.ApprovalNotOpen, "审批不在等待决定")
	}
	if !workflow.Now(ctx).Before(a.expiresAt) {
		return refuse(generated.ApprovalExpired, "审批已过期")
	}
	// 冻结名单：只有 owner 要求而没有角色要求时，approver 必须是冻结的 owner 之一
	if len(a.in.RoleRequirements) == 0 {
		for _, o := range a.in.AffectedOwnerRefs {
			if o.OwnerPrincipalID == u.ApproverPrincipalID {
				return nil
			}
		}
		return refuse(generated.ApproverNotEligible, "approver 不在冻结的 owner 名单内")
	}
	return nil
}

// decide 是 decide 的 handler。active HUMAN、fresh 选择器 permission、职责分离由
// FreshApprovalAdmission Activity 在 Core 判定；未通过作为一条被拒决定进入
// history，而不是 pre-history 拒绝（.design/06 §4）。
func (a *approval) decide(ctx workflow.Context, u generated.ApprovalDecisionUpdate) (generated.ApprovalDecisionOutcome, error) {
	outcome := func(admitted bool, d *generated.ApprovalDecision, r *generated.ReasonCode) generated.ApprovalDecisionOutcome {
		return generated.ApprovalDecisionOutcome{
			ApproverPrincipalID: u.ApproverPrincipalID, Admitted: admitted,
			Decision: d, Reason: r, Status: a.status,
		}
	}
	if d := a.recorded(u.ApproverPrincipalID); d != nil {
		dec := d.Decision
		return outcome(true, &dec, nil), nil
	}
	if r, ok := a.refused[u.ApproverPrincipalID]; ok {
		return outcome(false, nil, reasonPtr(r)), nil
	}

	a.inFlight[u.ApproverPrincipalID] = true
	defer delete(a.inFlight, u.ApproverPrincipalID)
	result, err := a.admit(ctx, u)
	if err != nil {
		return generated.ApprovalDecisionOutcome{}, err
	}
	// 判定期间审批可能已终结（过期、撤回、另一人否决）：不再形成决定
	if a.status != generated.ApprovalStatusWAITING {
		return outcome(false, nil, reasonPtr(generated.ApprovalNotOpen)), nil
	}
	if !result.Admitted {
		r := generated.ApproverNotEligible
		if result.Reason != nil {
			r = *result.Reason
		}
		a.refused[u.ApproverPrincipalID] = r
		return outcome(false, nil, reasonPtr(r)), nil
	}
	a.decisions = append(a.decisions, generated.ApprovalDecisionRecord{
		ApproverPrincipalID: u.ApproverPrincipalID,
		Decision:            u.Decision,
		DecidedAt:           workflow.Now(ctx).UTC().Format(time.RFC3339Nano),
		SatisfiedSelectors:  result.SatisfiedSelectors,
	})
	switch {
	// 任一有效 DENY 终结本次请求
	case u.Decision == generated.ApprovalDecisionDENY:
		a.set(generated.ApprovalStatusDENIED, reasonPtr(generated.ApprovalDenied))
	case a.satisfied():
		a.consumeDeadline = workflow.Now(ctx).Add(time.Duration(a.in.ConsumeWindowSeconds) * time.Second)
		a.set(generated.Approved, nil)
	default:
		a.version++
	}
	dec := u.Decision
	return outcome(true, &dec, nil), nil
}

// admit 调用 FreshApprovalAdmission。依赖暂不可用时按轮等待——那不是 approver
// 失格；到期仍未判定就按过期回答。Core 的确定拒绝（4xx）只可能是请求本身不成立，
// 按不合格处理。
func (a *approval) admit(ctx workflow.Context, u generated.ApprovalDecisionUpdate) (generated.FreshApprovalAdmissionResult, error) {
	ao := workflow.WithActivityOptions(ctx, activityOptions())
	for {
		var r generated.FreshApprovalAdmissionResult
		err := workflow.ExecuteActivity(ao, (*activities.CoreAPI).FreshApprovalAdmission,
			generated.FreshApprovalAdmissionRequest{
				ApprovalWorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
				ApproverPrincipalID: u.ApproverPrincipalID,
				Decision:            u.Decision,
			}).Get(ctx, &r)
		if err == nil {
			return r, nil
		}
		var app *temporal.ApplicationError
		if errors.As(err, &app) &&
			(app.Type() == activities.ErrTypeRejected || app.Type() == activities.ErrTypeAdmissionDenied) {
			return generated.FreshApprovalAdmissionResult{Reason: reasonPtr(generated.ApproverNotEligible)}, nil
		}
		if !workflow.Now(ctx).Add(retry.RoundInterval).Before(a.expiresAt) {
			return generated.FreshApprovalAdmissionResult{Reason: reasonPtr(generated.ApprovalExpired)}, nil
		}
		// 每一轮都往 history 里加事件：Server 建议续跑时不再等下一轮，交还这次
		// 判定（不形成决定），由主协程续跑。approver 以同一 Update ID 重发即可
		if a.wantCAN || a.suggested(ctx) {
			a.wantCAN = true
			return generated.FreshApprovalAdmissionResult{},
				refuse(generated.DependencyUnavailable, "资格判定依赖不可用且审批需要续跑，稍后重发")
		}
		workflow.GetLogger(ctx).Warn("审批者资格判定未完成，等待下一轮", "error", err)
		if err := workflow.Sleep(ctx, retry.RoundInterval); err != nil {
			return generated.FreshApprovalAdmissionResult{}, err
		}
	}
}

func (a *approval) validateWithdraw(workflow.Context) error {
	if a.status == generated.Cancelled {
		return nil // 重复撤回：幂等
	}
	if a.status != generated.Requested && a.status != generated.ApprovalStatusWAITING {
		return refuse(generated.ApprovalNotOpen, "审批已不在未决状态")
	}
	return nil
}

func (a *approval) withdraw(workflow.Context) (generated.ApprovalControlOutcome, error) {
	if a.status == generated.Requested || a.status == generated.ApprovalStatusWAITING {
		a.set(generated.Cancelled, reasonPtr(generated.ApprovalWithdrawn))
	}
	return generated.ApprovalControlOutcome{Status: a.status}, nil
}

// validateConsume：只在 APPROVED 时接受；已 CONSUMED 是同一 Update ID 的重发。
func (a *approval) validateConsume(workflow.Context) error {
	if a.status == generated.Approved || a.status == generated.Consumed {
		return nil
	}
	return refuse(generated.ApprovalNotOpen, "批准不在可消费状态")
}

func (a *approval) consume(ctx workflow.Context) (generated.ApprovalControlOutcome, error) {
	if a.status == generated.Approved {
		a.consumedAt = workflow.Now(ctx)
		a.set(generated.Consumed, nil)
	}
	return generated.ApprovalControlOutcome{Status: a.status}, nil
}

func (a *approval) validateInvalidate(_ workflow.Context, _ generated.ApprovalInvalidateUpdate) error {
	if a.status == generated.Approved || a.status == generated.Invalidated {
		return nil
	}
	return refuse(generated.ApprovalNotOpen, "批准不在可失效状态")
}

func (a *approval) invalidate(_ workflow.Context, u generated.ApprovalInvalidateUpdate) (generated.ApprovalControlOutcome, error) {
	if a.status == generated.Approved {
		a.set(generated.Invalidated, reasonPtr(u.Reason))
	}
	return generated.ApprovalControlOutcome{Status: a.status}, nil
}

func terminal(s generated.ApprovalStatus) bool {
	switch s {
	case generated.ApprovalStatusDENIED, generated.ApprovalStatusEXPIRED, generated.Cancelled,
		generated.Consumed, generated.Invalidated:
		return true
	}
	return false
}

// report 把当前状态写成投影载荷。event_id 取 history 长度：单调，且重放走过同一
// 段 history，在同一调用点取到同一个值。
func (a *approval) report(ctx workflow.Context) generated.ApprovalStateReport {
	info := workflow.GetInfo(ctx)
	r := generated.ApprovalStateReport{
		WorkflowID: info.WorkflowExecution.ID,
		RunID:      info.WorkflowExecution.RunID,
		EventID:    a.eventBase + int64(info.GetCurrentHistoryLength()),
		Status:     a.status,
		Decisions:  make([]generated.DecisionElement, 0, len(a.decisions)),
		ExpiresAt:  a.in.ExpiresAt,
		Reason:     a.reason,
	}
	for _, d := range a.decisions {
		r.Decisions = append(r.Decisions, generated.DecisionElement(d))
	}
	if !a.consumeDeadline.IsZero() {
		s := a.consumeDeadline.UTC().Format(time.RFC3339Nano)
		r.ConsumeDeadline = &s
	}
	if !a.consumedAt.IsZero() {
		s := a.consumedAt.UTC().Format(time.RFC3339Nano)
		r.ConsumedAt = &s
	}
	return r
}

// Approval 执行一条 ApprovalWorkflow（.design/06 §4）：
//
//	REQUESTED → WAITING → APPROVED | DENIED | EXPIRED | CANCELLED
//	APPROVED → CONSUMED | INVALIDATED
//
// 决定只经 decide Update 进入；APPROVED 之后等 Core 的 consume 或 invalidate，同时
// consume_deadline 的 timer 超时自动 INVALIDATED。每次对外可见的跃迁经
// ProjectApprovalState 写回 Core；最后一次投影写入前不视为终结。
//
// Core 长时间不可达时写回按轮等待，每一轮都让 history 变长。Server 建议续跑时，
// 主协程在安全点排空 handler、以同一冻结 input 加上已有状态（`resume`）continue-as-new：
// 同一 workflow ID，决定、资格结论、consume 截止与 event_id 基数都带过去（06 §3）。
func Approval(ctx workflow.Context, in generated.ApprovalWorkflowInput) error {
	expiresAt, err := time.Parse(time.RFC3339Nano, in.ExpiresAt)
	if err != nil {
		return temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("expiresAt 不是 RFC3339: %v", err), activities.ErrTypeRejected, nil)
	}
	a := &approval{
		in: in, expiresAt: expiresAt, status: generated.Requested,
		refused: map[string]generated.ReasonCode{}, inFlight: map[string]bool{},
	}
	if err := a.restore(in.Resume); err != nil {
		return err
	}
	// handler 先于任何阻塞调用注册：否则早到的 Update 找不到 handler
	for _, h := range []struct {
		name      string
		handler   any
		validator any
	}{
		{UpdateDecide, a.decide, a.validateDecide},
		{UpdateWithdraw, a.withdraw, a.validateWithdraw},
		{UpdateConsume, a.consume, a.validateConsume},
		{UpdateInvalidate, a.invalidate, a.validateInvalidate},
	} {
		if err := workflow.SetUpdateHandlerWithOptions(ctx, h.name, h.handler,
			workflow.UpdateHandlerOptions{Validator: h.validator}); err != nil {
			return err
		}
	}
	a.canEnabled = workflow.GetVersion(ctx, changeApprovalContinueAsNew,
		workflow.DefaultVersion, 1) == 1

	project := func() error {
		return a.projectUntilDone(ctx, func(ao workflow.Context) error {
			return workflow.ExecuteActivity(ao, (*activities.CoreAPI).ProjectApprovalState, a.report(ctx)).Get(ctx, nil)
		})
	}
	task := func(status generated.TaskStatus, waiting *string) error {
		return a.projectUntilDone(ctx, func(ao workflow.Context) error {
			info := workflow.GetInfo(ctx)
			return workflow.ExecuteActivity(ao, (*activities.CoreAPI).ProjectTaskState,
				generated.TaskStateReport{
					WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID,
					EventID: a.eventBase + int64(info.GetCurrentHistoryLength()), Status: status, WaitingReason: waiting,
				}).Get(ctx, nil)
		})
	}
	// 写回失败只有两种结局：Core 的确定拒绝（原样返回），或需要续跑
	done := func(err error) error {
		if errors.Is(err, errContinueAsNew) {
			return a.continueAsNew(ctx)
		}
		return err
	}

	projected := -1
	// 首个 run，或续跑发生在 REQUESTED 的两次写回之间：两次写回都按 event_id 单调、
	// 重做无害，重做后开放决定
	if in.Resume == nil || a.status == generated.Requested {
		w := waitingApproval
		if err := task(generated.Running, &w); err != nil {
			return done(err)
		}
		// REQUESTED：请求已登记、冻结内容写入 history；随后开放决定
		if err := project(); err != nil {
			return done(err)
		}
		a.set(generated.ApprovalStatusWAITING, nil)
	}

	for {
		if a.version != projected {
			projected = a.version
			if err := project(); err != nil {
				return done(err)
			}
			continue // 投影期间可能又有变化，先写到最新
		}
		if terminal(a.status) {
			break
		}
		// 安全点：状态已全部写回。续跑在这里发生，不在写回半途
		if a.wantCAN || a.suggested(ctx) {
			return a.continueAsNew(ctx)
		}
		var deadline time.Time
		var onTimeout func()
		switch a.status {
		case generated.ApprovalStatusWAITING:
			deadline = a.expiresAt
			onTimeout = func() { a.set(generated.ApprovalStatusEXPIRED, reasonPtr(generated.ApprovalExpired)) }
		case generated.Approved:
			deadline = a.consumeDeadline
			onTimeout = func() {
				a.set(generated.Invalidated, reasonPtr(generated.ApprovalConsumeWindowClosed))
			}
		}
		seen := a.version
		remaining := deadline.Sub(workflow.Now(ctx))
		changed := true
		if remaining > 0 {
			ok, err := workflow.AwaitWithTimeout(ctx, remaining, func() bool { return a.version != seen || a.wantCAN })
			if err != nil {
				return err
			}
			changed = ok
		} else {
			changed = false
		}
		if !changed && a.version == seen {
			onTimeout()
		}
	}

	// 等在途的 handler 结束：它们在终态之后只会回答「不再开放」，但回答必须送达
	if err := workflow.Await(ctx, func() bool { return workflow.AllHandlersFinished(ctx) }); err != nil {
		return err
	}
	if a.version != projected {
		if err := project(); err != nil {
			return done(err)
		}
	}
	return done(task(generated.Completed, nil))
}

// restore 把续跑带入的状态装回。首个 run 没有 resume，什么也不做。
func (a *approval) restore(r *generated.ResumeClass) error {
	if r == nil {
		return nil
	}
	parse := func(s *string) (time.Time, error) {
		if s == nil {
			return time.Time{}, nil
		}
		return time.Parse(time.RFC3339Nano, *s)
	}
	var err error
	if a.consumeDeadline, err = parse(r.ConsumeDeadline); err != nil {
		return temporal.NewNonRetryableApplicationError("resume.consumeDeadline 不是 RFC3339", activities.ErrTypeRejected, err)
	}
	if a.consumedAt, err = parse(r.ConsumedAt); err != nil {
		return temporal.NewNonRetryableApplicationError("resume.consumedAt 不是 RFC3339", activities.ErrTypeRejected, err)
	}
	a.status, a.reason, a.eventBase = r.Status, r.Reason, r.EventBase
	for _, d := range r.Decisions {
		a.decisions = append(a.decisions, generated.ApprovalDecisionRecord(d))
	}
	for _, x := range r.Refusals {
		a.refused[x.ApproverPrincipalID] = x.Reason
	}
	return nil
}

// continueAsNew 排空 handler 后以同一冻结 input 与已有状态续跑。排空期间资格判定
// 不再发起新一轮（admit 看见 wantCAN 即交还），新的 decide 由 Validator 拒绝；
// consume/withdraw/invalidate 不调 Activity，照常完成，其结果随状态一起带走。
func (a *approval) continueAsNew(ctx workflow.Context) error {
	a.wantCAN = true
	if err := workflow.Await(ctx, func() bool { return workflow.AllHandlersFinished(ctx) }); err != nil {
		return err
	}
	next := a.in
	r := generated.ResumeClass{
		Status:    a.status,
		Reason:    a.reason,
		Decisions: make([]generated.DecisionElement, 0, len(a.decisions)),
		Refusals:  make([]generated.RefusalElement, 0, len(a.refused)),
		EventBase: a.eventBase + int64(workflow.GetInfo(ctx).GetCurrentHistoryLength()),
	}
	for _, d := range a.decisions {
		r.Decisions = append(r.Decisions, generated.DecisionElement(d))
	}
	// map 的遍历序每次不同，续跑的 input 必须确定
	approvers := make([]string, 0, len(a.refused))
	for k := range a.refused {
		approvers = append(approvers, k)
	}
	sort.Strings(approvers)
	for _, k := range approvers {
		r.Refusals = append(r.Refusals, generated.RefusalElement{ApproverPrincipalID: k, Reason: a.refused[k]})
	}
	if !a.consumeDeadline.IsZero() {
		s := a.consumeDeadline.UTC().Format(time.RFC3339Nano)
		r.ConsumeDeadline = &s
	}
	if !a.consumedAt.IsZero() {
		s := a.consumedAt.UTC().Format(time.RFC3339Nano)
		r.ConsumedAt = &s
	}
	next.Resume = &r
	workflow.GetLogger(ctx).Info("审批 continue-as-new", "status", a.status, "decisions", len(a.decisions), "eventBase", r.EventBase)
	return workflow.NewContinueAsNewError(ctx, ApprovalKind, next)
}

// projectUntilDone 执行一次写回，直到成功或被 Core 确定拒绝。Core 暂不可用时按轮
// 等待——「Workflow 未完成最后一次投影即不视为 terminal」（.design/06 §3.1）；每一轮
// 之后若 Server 建议续跑，以 errContinueAsNew 交还主协程。
func (a *approval) projectUntilDone(ctx workflow.Context, fn func(workflow.Context) error) error {
	ao := workflow.WithActivityOptions(ctx, activityOptions())
	for {
		err := fn(ao)
		if err == nil {
			return nil
		}
		var app *temporal.ApplicationError
		if errors.As(err, &app) &&
			(app.Type() == activities.ErrTypeRejected || app.Type() == activities.ErrTypeAdmissionDenied) {
			return err
		}
		workflow.GetLogger(ctx).Warn("审批投影未写入，等待下一轮", "error", err)
		if err := workflow.Sleep(ctx, retry.RoundInterval); err != nil {
			return err
		}
		if a.suggested(ctx) {
			return errContinueAsNew
		}
	}
}
