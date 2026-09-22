package workflows

import (
	"fmt"
	"time"

	"github.com/kailo/apps/worker/activities"
	"github.com/kailo/apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// ComponentTaskKind 是 Worker 注册的 Workflow 类型名。
//
// .design/06 §5 明写：TENANT_LIFECYCLE、WORKSPACE_LIFECYCLE、
// MEMBERSHIP_PROJECTION、MEMBERSHIP_REVOCATION 等都只是 ComponentTaskWorkflow
// 的 kind，不增加顶层 Workflow 引擎。因此只注册一个类型，kind 在 input 里。
const ComponentTaskKind = "ComponentTaskWorkflow"

// MembershipTarget 是 Workflow 的冻结输入（DD-45）。
//
// 每个字段都是冻结值：Workflow 运行中不得更换 Tenant、Workspace、target type
// 或版本（06 §3）。要改就建新的 ActionExecution 与新的 Workflow。
type MembershipTarget struct {
	// TENANT 投 relay roster，WORKSPACE 投 Channel roster
	Scope             string `json:"scope"`
	MembershipID      string `json:"membershipId"`
	MembershipVersion int32  `json:"membershipVersion"`
	// SpiceDB 的关系主体。成员是 principal，客体是 tenant 或 workspace。
	SubjectPrincipalID string `json:"subjectPrincipalId"`
	// 关系客体的 ID：Scope=TENANT 时是 tenant_id，=WORKSPACE 时是 workspace_id
	RelationObjectID string `json:"relationObjectId"`
}

// ComponentTaskInput 是 ComponentTaskWorkflow 的统一输入。
type ComponentTaskInput struct {
	Kind       generated.WorkflowKind `json:"kind"`
	Membership *MembershipTarget      `json:"membership,omitempty"`
}

// 三类 Activity 的超时与重试纪律（06 §5.1）。SDK 要求每个 Activity 至少设置
// 一个超时，而 Server 默认重试策略是无限次——不显式固定就等于没有上界。
//
// 投影类 Activity 的重试上界必须覆盖 roster 快照的收敛时间：relay roster 的
// 快照由 best-effort 路径重建，读到旧值是结果不明，修复来自 Relay 的周期对账
// （SF-BUZ-34）。上界给得比对账间隔短，撤权会在还没收敛时就被判失败。
func projectionOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout:    30 * time.Second,
		ScheduleToCloseTimeout: 10 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    time.Second,
			BackoffCoefficient: 2,
			MaximumInterval:    30 * time.Second,
			MaximumAttempts:    20,
			NonRetryableErrorTypes: []string{
				activities.ErrTypeRejected,
				activities.ErrTypeAdmissionDenied,
			},
		},
	}
}

// 状态投影自己不该把 Workflow 拖住：它写的是工作台的可见状态，不是业务事实。
// 但也不能失败即忽略——Workflow 未完成最后一次投影即不视为 terminal（06 §3.1）。
func stateOptions() workflow.ActivityOptions {
	o := projectionOptions()
	o.ScheduleToCloseTimeout = 2 * time.Minute
	o.RetryPolicy.MaximumAttempts = 10
	return o
}

// ComponentTask 执行一个 ComponentTaskWorkflow。
//
// 一期只实现成员生命周期的两个 kind。其余 kind 在 .design/06 里已登记但没有
// 实现，落到 default 分支当场失败——不写一个「什么都不做就成功」的分支，
// 那会让未实现的能力看起来像执行过了。
func ComponentTask(ctx workflow.Context, in ComponentTaskInput) error {
	switch in.Kind {
	case generated.MembershipProjection:
		return membershipLifecycle(ctx, in, activities.Present, "ACTIVE")
	case generated.MembershipRevocation:
		return membershipLifecycle(ctx, in, activities.Absent, "REVOKED")
	default:
		return temporal.NewNonRetryableApplicationError(
			"kind 尚未实现", activities.ErrTypeRejected, nil)
	}
}

// membershipLifecycle 是建立与撤权共用的收敛链（DD-45）。
//
// 顺序是设计定死的，不是实现偏好：先 SpiceDB 再 Buzz roster，两者都查证通过
// 后才让 Core 跃迁成员状态（.design/09 第 5 步）。反过来先跃迁再投影，就会出现
// 「Core 说 ACTIVE 而执行点还没生效」——那正是 fail-open。
//
// 建立与撤权用同一条链、只差目标存在性，是因为它们本来就是同一台状态机的两个
// 方向。分成两份实现会让两边的顺序与错误处理慢慢分叉。
func membershipLifecycle(
	ctx workflow.Context,
	in ComponentTaskInput,
	want activities.Presence,
	terminal string,
) error {
	m := in.Membership
	if m == nil {
		return temporal.NewNonRetryableApplicationError(
			"成员生命周期 kind 缺少冻结的 membership 输入", activities.ErrTypeRejected, nil)
	}

	info := workflow.GetInfo(ctx)
	// event_id 取自 history 长度：它在同一次 run 内单调，且重放会走过同一段
	// history，因此在每个调用点取到同一个值——既能给 Core 做单调去重，又不破坏
	// 确定性（时钟与随机数都不行）。
	project := func(status string) error {
		o := workflow.WithActivityOptions(ctx, stateOptions())
		return workflow.ExecuteActivity(o, (*activities.CoreAPI).ProjectTaskState,
			activities.ProjectTaskStateInput{
				WorkflowID: info.WorkflowExecution.ID,
				RunID:      info.WorkflowExecution.RunID,
				EventID:    int64(workflow.GetInfo(ctx).GetCurrentHistoryLength()),
				Status:     status,
			}).Get(ctx, nil)
	}

	// 失败路径也要留下可见状态。投影自己再失败时，两个错误一并返回而不是
	// 丢掉其中一个：工作台上看不到的失败，和没发生过的失败无法区分。
	failWith := func(cause error) error {
		if err := project("FAILED"); err != nil {
			workflow.GetLogger(ctx).Error("终态投影失败", "cause", cause, "error", err)
			return fmt.Errorf("%w（且 FAILED 投影未写入: %v）", cause, err)
		}
		return cause
	}

	if err := project("RUNNING"); err != nil {
		return err
	}

	// 1. SpiceDB 关系：授权投影。Converge 内部以 FullyConsistent 读回查证。
	relationObject := "tenant"
	if m.Scope == "WORKSPACE" {
		relationObject = "workspace"
	}
	ao := workflow.WithActivityOptions(ctx, projectionOptions())
	if err := workflow.ExecuteActivity(ao, (*activities.SpiceDB).Converge,
		activities.Relationship{
			ResourceType: relationObject,
			ResourceID:   m.RelationObjectID,
			Relation:     "member",
			SubjectType:  "principal",
			SubjectID:    m.SubjectPrincipalID,
		}, want).Get(ctx, nil); err != nil {
		_ = project("FAILED")
		return err
	}

	// 2. Buzz roster：协作数据平面的准入执行点。签名在 Core，因为 CONTROL
	//    私钥在那里（DD-72）。
	presence := "PRESENT"
	if want == activities.Absent {
		presence = "ABSENT"
	}
	if err := workflow.ExecuteActivity(ao, (*activities.CoreAPI).ProjectBuzzRoster,
		activities.BuzzProjectionInput{
			Scope:             m.Scope,
			MembershipID:      m.MembershipID,
			MembershipVersion: m.MembershipVersion,
			Presence:          presence,
		}).Get(ctx, nil); err != nil {
		return failWith(err)
	}

	// 3. 两个投影都已查证，才让 Core 跃迁成员状态。
	var out activities.TransitionOutput
	if err := workflow.ExecuteActivity(ao, (*activities.CoreAPI).TransitionMembership,
		activities.TransitionInput{
			Scope:        m.Scope,
			MembershipID: m.MembershipID,
			FromVersion:  m.MembershipVersion,
			ToState:      terminal,
			WorkflowID:   info.WorkflowExecution.ID,
		}).Get(ctx, &out); err != nil {
		return failWith(err)
	}
	workflow.GetLogger(ctx).Info("成员状态已跃迁", "state", out.State, "version", out.Version)

	// 终态投影失败就不算 terminal（06 §3.1）：工作台上看不到的完成不是完成。
	return project("COMPLETED")
}
