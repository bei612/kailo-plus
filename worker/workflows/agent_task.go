package workflows

import (
	"fmt"
	"math"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// AgentTask 是 .design/06 §6 的独立 Workflow，kind=NONE；不复用安装 kind。
const AgentTaskKind = "AgentTaskWorkflow"

// AgentTask 保留同一 Invocation/Workflow 引用跨 continue-as-new。Core 的持久
// dispatch intent 是副作用防重边界；UNKNOWN 轮次只能对账，不能重新发 turn。
func AgentTask(ctx workflow.Context, in generated.AgentTaskWorkflowInput) error {
	if in.InvocationID == "" || in.InstallationID == "" || in.AgentVersionAssetID == "" || in.ProjectionGeneration <= 0 || in.EventBase < 0 ||
		in.HeartbeatTimeoutSeconds <= 0 || in.HeartbeatIntervalSeconds <= 0 || in.ObservationIntervalSeconds <= 0 ||
		in.HeartbeatIntervalSeconds >= in.HeartbeatTimeoutSeconds ||
		in.HeartbeatTimeoutSeconds > math.MaxInt64/int64(time.Second) ||
		in.HeartbeatIntervalSeconds > math.MaxInt64/int64(time.Second) ||
		in.ObservationIntervalSeconds > math.MaxInt64/int64(time.Second) {
		return temporal.NewNonRetryableApplicationError("AgentTask 冻结输入不成立", activities.ErrTypeRejected, nil)
	}
	// 与旧 ComponentTask/Approval history 分开注册，不改变旧 GetVersion 分支。
	project := func(c workflow.Context, status generated.TaskStatus, waiting string) error {
		var reason *string
		if waiting != "NONE" {
			reason = &waiting
		}
		options := workflow.WithActivityOptions(c, activityOptions())
		info := workflow.GetInfo(c)
		return workflow.ExecuteActivity(options, (*activities.CoreAPI).ProjectAgentTaskState, generated.TaskStateReport{
			WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID,
			EventID: in.EventBase + int64(info.GetCurrentHistoryLength()), Status: status, WaitingReason: reason,
		}).Get(c, nil)
	}
	// Activity 在 native 占用期间不得因 Workflow cancel 先被杀掉。Core 会从
	// 同 run 的原生 cancel history 观察取消并 interrupt 原 turn；这里持续收尾。
	loop, _ := workflow.NewDisconnectedContext(ctx)
	begun := false
	for {
		if ctx.Err() != nil && !in.CancelPending {
			// cancel accepted 不是 CANCELED；脱离已取消上下文继续原生收尾观察。
			in.CancelPending = true
			loop, _ = workflow.NewDisconnectedContext(ctx)
		}
		if !begun {
			// 投影的 transport/ACK 错误不证明 Invocation 失败。与后续观察
			// 共用有界轮次，在持久 timer 后重试；未确认投影时不占 runner。
			begun = project(loop, generated.Running, "UNKNOWN_EXTERNAL_RESULT") == nil
		}
		if begun {
			options := activityOptions()
			options.HeartbeatTimeout = time.Duration(in.HeartbeatTimeoutSeconds) * time.Second
			if options.HeartbeatTimeout >= options.StartToCloseTimeout || options.HeartbeatTimeout >= options.ScheduleToCloseTimeout {
				return temporal.NewNonRetryableApplicationError("AgentTask 心跳必须短于 Activity 执行期限", activities.ErrTypeRejected, nil)
			}
			options.WaitForCancellation = true
			options.ActivityID = fmt.Sprintf("%s:%d", in.InvocationID, in.EventBase+int64(workflow.GetInfo(loop).GetCurrentHistoryLength()))
			// SDK retry 保留 ActivityID、只换 attempt，Core 沿原持久意图续同 lease。
			options.RetryPolicy.NonRetryableErrorTypes = append(options.RetryPolicy.NonRetryableErrorTypes, activities.ErrTypeUnknownExternalResult)
			activityContext := workflow.WithActivityOptions(loop, options)
			var out generated.AgentTaskAdvanceResult
			err := workflow.ExecuteActivity(activityContext, (*activities.CoreAPI).AdvanceAgentTask, in).Get(loop, &out)
			status, reason := generated.Running, "UNKNOWN_EXTERNAL_RESULT"
			if err == nil {
				status, reason = out.Status, out.WaitingReason
			}
			// finishActivity 只确认结束 holder，不是业务终态。RELEASED 后
			// 后续 Activity 只观察同一 Invocation，不由 Worker 再占 units。
			// 任何终态都先落投影；ACK 不明时继续对账，不返回假 terminal。
			if err := project(loop, status, reason); err == nil && status != generated.Running {
				switch status {
				case generated.Completed:
					return nil
				case generated.Canceled:
					return temporal.NewCanceledError()
				default:
					return temporal.NewNonRetryableApplicationError("AgentTask 权威事实确认失败", activities.ErrTypeRejected, nil)
				}
			}
		}
		if err := workflow.Sleep(loop, retry.RoundInterval); err != nil {
			continue
		}
		if workflow.GetInfo(loop).GetContinueAsNewSuggested() {
			in.EventBase += int64(workflow.GetInfo(loop).GetCurrentHistoryLength())
			return workflow.NewContinueAsNewError(loop, AgentTask, in)
		}
	}
}
