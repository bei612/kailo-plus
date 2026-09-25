package workflows

import (
	"errors"
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

// GetVersion 的 changeID。一经发布即不可改名、不可复用：已录制的 history 里记着它。
const changeTenantRevocationAllRelations = "tenant-revocation-all-relations"

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

// ScopeTarget 是 Tenant/Workspace 生命周期的冻结输入。
//
// 与 MembershipTarget 分开：scope 的投影目标是它自己的 Buzz 绑定
// （Community / Channel），而成员的投影目标是 roster 里的一个 pubkey。
type ScopeTarget struct {
	ID      string `json:"id"`
	Version int32  `json:"version"`
	// Workspace 才有：SpiceDB 里 workspace 通过 tenant 关系归属其 Tenant
	TenantID string `json:"tenantId,omitempty"`
}

// IdentityTarget 是原生设备公钥投影的冻结输入（DD-79）。
//
// 只冻结 pubkey 与 binding 版本：投入还是移出由 Core 按 binding 状态决定，
// Workflow 不重复判定——两处判定迟早不一致。
type IdentityTarget struct {
	Pubkey         string `json:"pubkey"`
	BindingVersion int32  `json:"bindingVersion"`
}

// ComponentTaskInput 是 ComponentTaskWorkflow 的统一输入。
type ComponentTaskInput struct {
	Kind       generated.WorkflowKind `json:"kind"`
	Membership *MembershipTarget      `json:"membership,omitempty"`
	Scope      *ScopeTarget           `json:"scope,omitempty"`
	Identity   *IdentityTarget        `json:"identity,omitempty"`
	// continue-as-new 时带入的 history 长度累计。投影的 event_id 按 workflow ID
	// 单调去重（06 §2：按 workflow ID 而非 run ID 聚合），新 run 的 history 从零
	// 数起，不加上它，续跑后的投影会被当成旧事件丢掉。
	EventBase int64 `json:"eventBase,omitempty"`
	// 取消后的终态投影尚未落库时，continue-as-new 只续跑收尾，不重放业务步骤。
	CancelPending bool `json:"cancelPending,omitempty"`
}

// Retry 是 Activity 的超时与重试上界，以及两轮收敛之间的等待。它们是部署
// 事实，由进程启动时给出（main.go 的 Configure），不写死在 Workflow 里。
type Retry struct {
	StartToClose    time.Duration
	ScheduleToClose time.Duration
	MaxAttempts     int32
	InitialInterval time.Duration
	MaxInterval     time.Duration
	// 一轮 Activity 重试耗尽后，Workflow 以持久 timer 等这么久再做下一轮
	RoundInterval time.Duration
}

var retry Retry

// Configure 在注册 Workflow 之前调用一次。Workflow 代码只读它，重放同一段
// history 时取到同一组值；换值只影响之后新发出的命令。
func Configure(r Retry) { retry = r }

// 每个 Activity 显式固定两个超时与重试上界（06 §5.1）。上界约束的是**一轮**，
// 不是整条收敛：见 converge。
func activityOptions() workflow.ActivityOptions {
	return workflow.ActivityOptions{
		StartToCloseTimeout:    retry.StartToClose,
		ScheduleToCloseTimeout: retry.ScheduleToClose,
		RetryPolicy: &temporal.RetryPolicy{
			InitialInterval:    retry.InitialInterval,
			BackoffCoefficient: 2,
			MaximumInterval:    retry.MaxInterval,
			MaximumAttempts:    retry.MaxAttempts,
			NonRetryableErrorTypes: []string{
				activities.ErrTypeRejected,
				activities.ErrTypeAdmissionDenied,
			},
		},
	}
}

// waitingConvergence 是一轮重试耗尽、等待下一轮时写回的等待原因。它是封闭
// 取值，不带错误原文：错误原文是高基数自由文本，不进投影（07 §3）。
const waitingConvergence = "CONVERGENCE_PENDING"

// converge 执行一步幂等的收敛，直到成功或被确定拒绝。
//
// 这些 Activity 的失败只有两种：依赖暂不可用或快照落后（结果不明），以及
// Core 的 4xx 拒绝（确定失败，NonRetryableErrorTypes）。前一种在一轮重试上界
// 内没有恢复时，Workflow 不能就此失败——撤权会停在 REVOKING，而那把钥匙仍在
// Relay 的 roster 上，原生端照样直连发布（DD-45「对账闭合后才 REVOKED」）。
// 因此以持久 timer 等一轮再做，并写回等待原因让工作台看得见；history 接近
// 上限时 continue-as-new（06 §2）。拒绝则立即返回，由调用方写 FAILED。
func converge(
	ctx workflow.Context,
	in ComponentTaskInput,
	project func(workflow.Context, generated.TaskStatus, *string) workflow.Future,
	fn func(workflow.Context) workflow.Future,
	result interface{},
) error {
	ao := workflow.WithActivityOptions(ctx, activityOptions())
	for {
		if temporal.IsCanceledError(ctx.Err()) {
			return temporal.NewCanceledError()
		}
		future := fn(ao)
		var err error
		selector := workflow.NewSelector(ctx)
		selector.AddFuture(future, func(f workflow.Future) { err = f.Get(ctx, result) })
		selector.AddReceive(ctx.Done(), func(workflow.ReceiveChannel, bool) {
			err = temporal.NewCanceledError()
		})
		selector.Select(ctx)
		if temporal.IsCanceledError(ctx.Err()) {
			return temporal.NewCanceledError()
		}
		if err == nil {
			return nil
		}
		var app *temporal.ApplicationError
		if errors.As(err, &app) &&
			(app.Type() == activities.ErrTypeRejected || app.Type() == activities.ErrTypeAdmissionDenied) {
			return err
		}
		workflow.GetLogger(ctx).Warn("本轮收敛未完成，等待下一轮", "error", err)
		reason := waitingConvergence
		// 等待原因写不进去不阻塞收敛本身：下一轮会再写
		_ = project(ctx, generated.Running, &reason).Get(ctx, nil)
		if err := workflow.Sleep(ctx, retry.RoundInterval); err != nil {
			return err
		}
		if workflow.GetInfo(ctx).GetContinueAsNewSuggested() {
			next := in
			next.EventBase = eventID(ctx, in)
			return workflow.NewContinueAsNewError(ctx, ComponentTask, next)
		}
	}
}

// eventID 是本次投影的单调序号：跨 run 累计的 history 长度。
func eventID(ctx workflow.Context, in ComponentTaskInput) int64 {
	return in.EventBase + int64(workflow.GetInfo(ctx).GetCurrentHistoryLength())
}

// projector 返回一个把状态写回 Core 的闭包。
//
// event_id 取自 history 长度（加上 continue-as-new 带入的累计）：它单调，且
// 重放会走过同一段 history，因此在每个调用点取到同一个值——既能给 Core 做单调
// 去重，又不破坏确定性（时钟与随机数都不行）。
func projector(in ComponentTaskInput) func(workflow.Context, generated.TaskStatus, *string) workflow.Future {
	return func(ctx workflow.Context, status generated.TaskStatus, waiting *string) workflow.Future {
		info := workflow.GetInfo(ctx)
		o := workflow.WithActivityOptions(ctx, activityOptions())
		return workflow.ExecuteActivity(o, (*activities.CoreAPI).ProjectTaskState,
			generated.TaskStateReport{
				WorkflowID:    info.WorkflowExecution.ID,
				RunID:         info.WorkflowExecution.RunID,
				EventID:       eventID(ctx, in),
				Status:        status,
				WaitingReason: waiting,
			})
	}
}

// task 是一条 ComponentTaskWorkflow 的公共骨架：先写 RUNNING，逐步收敛，最后写
// COMPLETED；任一步被确定拒绝则写 FAILED 并把原因抛出。
//
// RUNNING 与 COMPLETED 的写回同样走 converge：Core 暂不可用时不能因此放弃
// 收敛，而「Workflow 未完成最后一次投影即不视为 terminal」（06 §3.1）。
type task struct {
	ctx     workflow.Context
	in      ComponentTaskInput
	project func(workflow.Context, generated.TaskStatus, *string) workflow.Future
}

func newTask(ctx workflow.Context, in ComponentTaskInput) *task {
	return &task{ctx: ctx, in: in, project: projector(in)}
}

func (t *task) step(fn func(workflow.Context) workflow.Future, result interface{}) error {
	return converge(t.ctx, t.in, t.project, fn, result)
}

func (t *task) begin() error {
	return t.step(func(ctx workflow.Context) workflow.Future {
		return t.project(ctx, generated.Running, nil)
	}, nil)
}

func (t *task) complete() error {
	return t.step(func(ctx workflow.Context) workflow.Future {
		return t.project(ctx, generated.Completed, nil)
	}, nil)
}

// fail 记下失败再把原因抛出。失败路径也要留下可见状态；投影自己再失败时，
// 两个错误一并返回而不是丢掉其中一个：工作台上看不到的失败，和没发生过的
// 失败无法区分。
func (t *task) fail(cause error) error {
	var cont *workflow.ContinueAsNewError
	if errors.As(cause, &cont) {
		return cause
	}
	if temporal.IsCanceledError(t.ctx.Err()) {
		return t.cancel()
	}
	if err := t.project(t.ctx, generated.Failed, nil).Get(t.ctx, nil); err != nil {
		if temporal.IsCanceledError(t.ctx.Err()) {
			return t.cancel()
		}
		workflow.GetLogger(t.ctx).Error("终态投影失败", "cause", cause, "error", err)
		return fmt.Errorf("%w（且 FAILED 投影未写入: %v）", cause, err)
	}
	return cause
}

// cancel 在与已取消的业务 Context 脱离后写 CANCELED。当前激活的 kind 没有
// ExternalExecution 或 CapacityLease 可清理；已投递的幂等投影仍以实体的
// PROVISIONING/REVOKING 与后续 rerun 对账，不能把取消解释为外部副作用已回滚。
func (t *task) cancel() error {
	detached, done := workflow.NewDisconnectedContext(t.ctx)
	defer done()
	next := t.in
	next.CancelPending = true
	err := converge(detached, next, t.project, func(ctx workflow.Context) workflow.Future {
		return t.project(ctx, generated.Canceled, nil)
	}, nil)
	if err != nil {
		return err
	}
	return temporal.NewCanceledError()
}

// ComponentTask 执行一个 ComponentTaskWorkflow。
//
// 未实现的 kind 落到 default 分支当场失败——不写一个「什么都不做就成功」的
// 分支，那会让未实现的能力看起来像执行过了。
func ComponentTask(ctx workflow.Context, in ComponentTaskInput) error {
	if in.CancelPending {
		return newTask(ctx, in).cancel()
	}
	switch in.Kind {
	case generated.MembershipProjection:
		return membershipLifecycle(ctx, in, activities.Present, "ACTIVE")
	case generated.MembershipRevocation:
		return membershipLifecycle(ctx, in, activities.Absent, "REVOKED")
	case generated.TenantLifecycle:
		return tenantLifecycle(ctx, in)
	case generated.WorkspaceLifecycle:
		return workspaceLifecycle(ctx, in)
	case generated.BuzzIdentityProjection:
		return identityProjection(ctx, in)
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
	t := newTask(ctx, in)
	if err := t.begin(); err != nil {
		return t.fail(err)
	}

	// 1. SpiceDB 关系：授权投影。Converge 内部以 FullyConsistent 读回查证。
	relationObject := "tenant"
	if m.Scope == "WORKSPACE" {
		relationObject = "workspace"
	}
	// Tenant 撤权撤掉该 Principal 在本 Tenant 的全部 tenant/workspace 关系，不只是
	// member：角色（DD-82）也是 relationship，只撤 member 会让失权者仍持有 admin。
	// 行为变化以 GetVersion 门控：在途与已录制的旧 history 走原来那一步。
	fullRevocation := false
	if m.Scope == "TENANT" && want == activities.Absent {
		fullRevocation = workflow.GetVersion(ctx, changeTenantRevocationAllRelations,
			workflow.DefaultVersion, 1) == 1
	}
	if fullRevocation {
		if err := t.step(func(ao workflow.Context) workflow.Future {
			return workflow.ExecuteActivity(ao, (*activities.SpiceDB).RevokeSubject,
				activities.SubjectScope{
					TenantID:           m.RelationObjectID,
					SubjectPrincipalID: m.SubjectPrincipalID,
				})
		}, nil); err != nil {
			return t.fail(err)
		}
	} else if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.SpiceDB).Converge,
			activities.Relationship{
				ResourceType: relationObject,
				ResourceID:   m.RelationObjectID,
				Relation:     "member",
				SubjectType:  "principal",
				SubjectID:    m.SubjectPrincipalID,
			}, want)
	}, nil); err != nil {
		return t.fail(err)
	}

	// 2. Buzz roster：协作数据平面的准入执行点。签名在 Core，因为 CONTROL
	//    私钥在那里（DD-72）。
	presence := "PRESENT"
	if want == activities.Absent {
		presence = "ABSENT"
	}
	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).ProjectBuzzRoster,
			activities.BuzzProjectionInput{
				Scope:             m.Scope,
				MembershipID:      m.MembershipID,
				MembershipVersion: m.MembershipVersion,
				Presence:          presence,
			})
	}, nil); err != nil {
		return t.fail(err)
	}

	// 3. 两个投影都已查证，才让 Core 跃迁成员状态。
	var out activities.TransitionOutput
	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).TransitionMembership,
			activities.TransitionInput{
				Scope:        m.Scope,
				MembershipID: m.MembershipID,
				FromVersion:  m.MembershipVersion,
				ToState:      terminal,
				WorkflowID:   workflow.GetInfo(ctx).WorkflowExecution.ID,
			})
	}, &out); err != nil {
		return t.fail(err)
	}
	workflow.GetLogger(ctx).Info("成员状态已跃迁", "state", out.State, "version", out.Version)

	// 终态投影失败就不算 terminal（06 §3.1）：工作台上看不到的完成不是完成。
	return t.complete()
}

// tenantLifecycle 建立一个 Tenant 的协作面（`.design/09` 第 3 步）。
//
// 两步分开不是分层：provision 做完只证明事件发出去了，verify 才回头抓 NIP-11
// 确认该部署真的执行成员准入。把它们合成一步，就只剩「发出去了」这一个信号，
// 而 .design/09 明写「只发出 admin event 而未查证不得 active」。
func tenantLifecycle(ctx workflow.Context, in ComponentTaskInput) error {
	s := in.Scope
	if s == nil {
		return temporal.NewNonRetryableApplicationError(
			"TENANT_LIFECYCLE 缺少冻结的 scope 输入", activities.ErrTypeRejected, nil)
	}
	t := newTask(ctx, in)
	if err := t.begin(); err != nil {
		return t.fail(err)
	}

	stepIn := activities.TenantStepInput{TenantID: s.ID, TenantVersion: s.Version}
	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).ProvisionTenantBuzz, stepIn)
	}, nil); err != nil {
		return t.fail(err)
	}
	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).VerifyTenantBuzz, stepIn)
	}, nil); err != nil {
		return t.fail(err)
	}

	var out activities.TransitionOutput
	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).TransitionScope,
			activities.ScopeTransitionInput{
				Kind:        "TENANT",
				ID:          s.ID,
				FromVersion: s.Version,
				ToState:     "ACTIVE",
				WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
			})
	}, &out); err != nil {
		return t.fail(err)
	}
	workflow.GetLogger(ctx).Info("Tenant 已就绪", "state", out.State, "version", out.Version)
	return t.complete()
}

// workspaceLifecycle 建立一个 Workspace 的协作面与授权归属。
//
// SpiceDB 那一步写的是 workspace 对 tenant 的归属关系，不是成员关系：
// .design/03 §5 的 workspace 定义里 `relation tenant: tenant` 正是它，
// workspace 的 discover/create/manage/audit 都经 `tenant->...` 继承。少了它，
// Tenant admin 对新建 Workspace 的权限无从推导。
func workspaceLifecycle(ctx workflow.Context, in ComponentTaskInput) error {
	s := in.Scope
	if s == nil || s.TenantID == "" {
		return temporal.NewNonRetryableApplicationError(
			"WORKSPACE_LIFECYCLE 缺少冻结的 scope 或 tenant 输入", activities.ErrTypeRejected, nil)
	}
	t := newTask(ctx, in)
	if err := t.begin(); err != nil {
		return t.fail(err)
	}

	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.SpiceDB).Converge,
			activities.Relationship{
				ResourceType: "workspace", ResourceID: s.ID, Relation: "tenant",
				SubjectType: "tenant", SubjectID: s.TenantID,
			}, activities.Present)
	}, nil); err != nil {
		return t.fail(err)
	}
	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).ProvisionWorkspaceBuzz,
			activities.WorkspaceStepInput{
				WorkspaceID: s.ID, WorkspaceVersion: s.Version,
			})
	}, nil); err != nil {
		return t.fail(err)
	}

	var out activities.TransitionOutput
	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).TransitionScope,
			activities.ScopeTransitionInput{
				Kind:        "WORKSPACE",
				ID:          s.ID,
				FromVersion: s.Version,
				ToState:     "ACTIVE",
				WorkflowID:  workflow.GetInfo(ctx).WorkflowExecution.ID,
			})
	}, &out); err != nil {
		return t.fail(err)
	}
	workflow.GetLogger(ctx).Info("Workspace 已就绪", "state", out.State, "version", out.Version)
	return t.complete()
}

// identityProjection 把一台原生设备的公钥投入或移出 roster（DD-79）。
//
// 整条收敛在 Core 的一次调用里完成：relay roster、此人全部 Channel roster、每次
// 投入后的撤权复核，以及最后的状态跃迁。拆成多个 Activity 会让「投入之后、
// 复核之前」横跨两次调用，而撤权恰恰可能落在那个缝里。
func identityProjection(ctx workflow.Context, in ComponentTaskInput) error {
	id := in.Identity
	if id == nil {
		return temporal.NewNonRetryableApplicationError(
			"BUZZ_IDENTITY_PROJECTION 缺少冻结的 identity 输入", activities.ErrTypeRejected, nil)
	}
	t := newTask(ctx, in)
	if err := t.begin(); err != nil {
		return t.fail(err)
	}

	var out activities.IdentityProjectionOutput
	if err := t.step(func(ao workflow.Context) workflow.Future {
		return workflow.ExecuteActivity(ao, (*activities.CoreAPI).ProjectBuzzIdentity,
			activities.IdentityProjectionInput{
				Pubkey:         id.Pubkey,
				BindingVersion: id.BindingVersion,
			})
	}, &out); err != nil {
		return t.fail(err)
	}
	workflow.GetLogger(ctx).Info("设备公钥已收敛", "pubkey", out.Pubkey, "state", out.State)
	return t.complete()
}
