package workflows

import (
	"encoding/json"
	"fmt"
	"math"
	"time"

	"apps/worker/activities"
	"apps/worker/internal/contracts/generated"
	enumspb "go.temporal.io/api/enums/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// AgentTask 是 .design/06 §6 的独立 Workflow，kind=NONE；不复用安装 kind。
const AgentTaskKind = "AgentTaskWorkflow"

// AgentTask 保留同一 Invocation/Workflow 引用跨 continue-as-new。Core 的持久
// dispatch intent 是副作用防重边界；UNKNOWN 轮次只能对账，不能重新发 turn。
func AgentTask(ctx workflow.Context, raw json.RawMessage) error {
	// 原 input 未含 sourceKind，保持旧 history 的第一条 command 不变。
	// Schedule 变体仅由 native Schedule 写入，Core 首 Activity 查原生 start。
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return temporal.NewNonRetryableApplicationError("AgentTask input 不可解析", activities.ErrTypeRejected, nil)
	}
	var in generated.AgentTaskWorkflowInput
	if kind, schedule := fields["sourceKind"]; schedule {
		if string(kind) != `"SCHEDULE"` {
			return temporal.NewNonRetryableApplicationError("AgentTask source 未实现", activities.ErrTypeRejected, nil)
		}
		for key := range fields {
			if key != "sourceKind" && key != "scheduleId" && key != "automationResourceId" && key != "automationVersionAssetId" && key != "cancelPending" {
				return temporal.NewNonRetryableApplicationError("Schedule input 含未知字段", activities.ErrTypeRejected, nil)
			}
		}
		cancelPending := false
		if value, present := fields["cancelPending"]; present {
			if string(value) == "null" || json.Unmarshal(value, &cancelPending) != nil {
				return temporal.NewNonRetryableApplicationError("Schedule cancel checkpoint 不成立", activities.ErrTypeRejected, nil)
			}
		}
		// 续跑位只能收窄为取消，不作为 native Schedule input 或准入事实。
		delete(fields, "cancelPending")
		sourceJSON, err := json.Marshal(fields)
		if err != nil {
			return temporal.NewNonRetryableApplicationError("Schedule input 不可序列化", activities.ErrTypeRejected, nil)
		}
		var source generated.AutomationScheduleTaskInput
		if json.Unmarshal(sourceJSON, &source) != nil || source.ScheduleID == "" || source.AutomationResourceID == "" || source.AutomationVersionAssetID == "" {
			return temporal.NewNonRetryableApplicationError("Schedule input 缺固定引用", activities.ErrTypeRejected, nil)
		}
		// ACK 丢失可能发生在 Core 已提交 ALLOWED 之后。包括 service 4xx、
		// Activity 超时或取消在内的 transport error 都不能裁定原准入未发生。
		// 只有同 native Workflow/key 的明确 admitted=false 才是业务拒绝。
		loop, _ := workflow.NewDisconnectedContext(ctx)
		for {
			cancelPending = cancelPending || ctx.Err() != nil
			options := workflow.WithActivityOptions(loop, activityOptions())
			var admitted generated.AutomationScheduleAdmitResult
			err := workflow.ExecuteActivity(options, (*activities.CoreAPI).AdmitAutomationSchedule, source).Get(loop, &admitted)
			cancelPending = cancelPending || ctx.Err() != nil
			if err == nil {
				if !admitted.Admitted {
					return temporal.NewNonRetryableApplicationError("Schedule 准入被拒绝", activities.ErrTypeRejected, nil)
				}
				if admitted.TaskInput != nil {
					in = generated.AgentTaskWorkflowInput(*admitted.TaskInput)
					in.CancelPending = in.CancelPending || cancelPending
					break
				}
			}
			workflow.GetLogger(ctx).Warn("Schedule 准入未确认，保留同源等待下一轮")
			if err := workflow.Sleep(loop, retry.RoundInterval); err != nil {
				continue
			}
			cancelPending = cancelPending || ctx.Err() != nil
			if workflow.GetInfo(loop).GetContinueAsNewSuggested() {
				if cancelPending {
					fields["cancelPending"] = json.RawMessage("true")
				}
				next, err := json.Marshal(fields)
				if err != nil {
					return temporal.NewNonRetryableApplicationError("Schedule checkpoint 不可序列化", activities.ErrTypeUnknownExternalResult, nil)
				}
				// Core 沿 native first-execution chain 验证原 scheduler start，
				// 新 run 不是新的计划时间、授权或模型执行意图。
				return workflow.NewContinueAsNewError(loop, AgentTask, json.RawMessage(next))
			}
		}
	} else if json.Unmarshal(raw, &in) != nil {
		return temporal.NewNonRetryableApplicationError("AgentTask input 不成立", activities.ErrTypeRejected, nil)
	}
	return agentTask(ctx, in)
}

func agentTask(ctx workflow.Context, in generated.AgentTaskWorkflowInput) error {
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
	startedApproval := ""
	for {
		nextRound := retry.RoundInterval
		if ctx.Err() != nil && !in.CancelPending {
			// cancel accepted 不是 CANCELED；脱离已取消上下文继续原生收尾观察。
			in.CancelPending = true
			loop, _ = workflow.NewDisconnectedContext(ctx)
		}
		if !begun {
			// 投影的 transport/ACK 错误不证明 Invocation 失败。与后续观察
			// 共用有界轮次，在持久 timer 后重试；未确认投影时不占 runner。
			begun = project(loop, generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT") == nil
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
			status, reason := generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
			if err == nil {
				status, reason = out.Status, out.WaitingReason
				if out.ApprovalWorkflowID != nil && out.ApprovalInput != nil && startedApproval != *out.ApprovalWorkflowID {
					// Frozen Core input, original registered ApprovalWorkflow; no
					// new Workflow kind or child decision authority. The child
					// stays alive across parent ContinueAsNew, then the same ID
					// is observed rather than creating another approval.
					var childInput generated.ApprovalWorkflowInput
					raw, encodeErr := json.Marshal(out.ApprovalInput)
					if encodeErr != nil || json.Unmarshal(raw, &childInput) != nil || childInput.ActionKey != "automation.run" {
						status, reason = generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
					} else {
						childContext := workflow.WithChildOptions(loop, workflow.ChildWorkflowOptions{
							WorkflowID:            *out.ApprovalWorkflowID,
							WorkflowIDReusePolicy: enumspb.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
							ParentClosePolicy:     enumspb.PARENT_CLOSE_POLICY_ABANDON,
						})
						var execution workflow.Execution
						startErr := workflow.ExecuteChildWorkflow(childContext, ApprovalKind, childInput).
							GetChildWorkflowExecution().Get(loop, &execution)
						if startErr == nil || temporal.IsWorkflowExecutionAlreadyStartedError(startErr) {
							startedApproval = *out.ApprovalWorkflowID
						} else {
							status, reason = generated.TaskStatusRUNNING, "UNKNOWN_EXTERNAL_RESULT"
						}
					}
				}
			}
			// finishActivity 只确认结束 holder，不是业务终态。RELEASED 后
			// 后续 Activity 只观察同一 Invocation，不由 Worker 再占 units。
			// 任何终态都先落投影；ACK 不明时继续对账，不返回假 terminal。
			if projected := project(loop, status, reason); projected == nil {
				if err == nil && out.DelayStep != nil {
					// Original ordered Delay: a native durable Timer, not an Activity
					// sleep. Core reads this exact TimerFired before the next effect.
					// Cancellation stops the timer; the next Activity drains the same
					// Invocation instead of proceeding to the message step.
					if status != generated.TaskStatusRUNNING || reason != "WAITING_TIMER" ||
						!out.FinishActivity || out.DelayStep.ID == "" || out.DelayStep.Seconds <= 0 ||
						out.DelayStep.Seconds > math.MaxInt64/int64(time.Second) {
						return temporal.NewNonRetryableApplicationError("Delay input invalid", activities.ErrTypeUnknownExternalResult, nil)
					}
					timer := workflow.NewTimerWithOptions(ctx, time.Duration(out.DelayStep.Seconds)*time.Second,
						workflow.TimerOptions{Summary: "automation-delay:" + in.InvocationID + ":" + out.DelayStep.ID})
					if workflow.GetVersion(loop, "agent-task-native-delay-trace", workflow.DefaultVersion, 1) != workflow.DefaultVersion {
						// The timer must actually exist before a running step can be
						// observed. This running observation is not a terminal ACK:
						// use one bounded original Activity, then await the SAME timer.
						// Failure must not trap cancellation/ContinueAsNew behind an
						// unbounded projection loop. The outer path still requires the
						// terminal projection ACK before returning a business outcome.
						_ = project(loop, status, reason)
					}
					_ = timer.Get(ctx, nil)
					// Preserve cancellation before a native continuation; the next
					// run must drain, not restart the unfinished Delay or its effect.
					in.CancelPending = in.CancelPending || ctx.Err() != nil
					if workflow.GetInfo(loop).GetContinueAsNewSuggested() {
						in.EventBase += int64(workflow.GetInfo(loop).GetCurrentHistoryLength())
						return workflow.NewContinueAsNewError(loop, AgentTaskKind, in)
					}
					continue
				}
				if status != generated.TaskStatusRUNNING {
					switch status {
					case generated.TaskStatusCOMPLETED:
						return nil
					case generated.Canceled:
						return temporal.NewCanceledError()
					default:
						return temporal.NewNonRetryableApplicationError("AgentTask 权威事实确认失败", activities.ErrTypeRejected, nil)
					}
				}
				// 已确认的 holder/usage 交接继续观察同一 Invocation，不是失败
				// 重试。保留原生 ActivityCompleted 和最终用量核验，只解除误用
				// 故障退避造成的每次交接整轮等待；旧 history 仍走旧 timer。
				if err == nil && out.FinishActivity && (reason == "CAPACITY_UNAVAILABLE" || reason == "BILLING_UNAVAILABLE") &&
					workflow.GetVersion(loop, "agent-task-confirmed-handoff-observation", workflow.DefaultVersion, 1) != workflow.DefaultVersion {
					nextRound = time.Duration(in.ObservationIntervalSeconds) * time.Second
				}
			}
		}
		if err := workflow.Sleep(loop, nextRound); err != nil {
			continue
		}
		if workflow.GetInfo(loop).GetContinueAsNewSuggested() {
			in.EventBase += int64(workflow.GetInfo(loop).GetCurrentHistoryLength())
			// Registered name preserves the original typed payload; the public
			// entry now also accepts the Schedule JSON discriminant.
			return workflow.NewContinueAsNewError(loop, AgentTaskKind, in)
		}
	}
}
