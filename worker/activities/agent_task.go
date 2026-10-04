package activities

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/activity"
	"go.temporal.io/sdk/temporal"
)

// AdvanceAgentTask 推进 Core 已持久化的 Invocation。Activity 不拥有 runtime，
// 不携带 prompt/token，也不把 HTTP 成功当作 turn/reply/usage 终态。
func (c *CoreAPI) AdvanceAgentTask(ctx context.Context, input generated.AgentTaskWorkflowInput) (generated.AgentTaskAdvanceResult, error) {
	info := activity.GetInfo(ctx)
	var out generated.AgentTaskAdvanceResult
	if !info.IsWorkflowActivity() || info.IsLocalActivity || info.ActivityID == "" || info.Attempt <= 0 ||
		input.HeartbeatIntervalSeconds <= 0 || input.ObservationIntervalSeconds <= 0 ||
		input.HeartbeatIntervalSeconds > math.MaxInt64/int64(time.Second) ||
		input.ObservationIntervalSeconds > math.MaxInt64/int64(time.Second) ||
		input.HeartbeatTimeoutSeconds > math.MaxInt64/int64(time.Second) ||
		time.Duration(input.HeartbeatIntervalSeconds)*time.Second >= info.HeartbeatTimeout ||
		time.Duration(input.HeartbeatTimeoutSeconds)*time.Second != info.HeartbeatTimeout {
		return out, temporal.NewNonRetryableApplicationError("AgentTask holder 或心跳配置不成立", ErrTypeRejected, nil)
	}
	// holder 来自 SDK 而不是 Workflow/browser 传来的猜测；retry 沿同 ActivityID
	// 带真实新 attempt。Core 独立读取 Temporal，再续同一个 CapacityLease。
	in := generated.AgentTaskAdvanceRequest{
		InvocationID: input.InvocationID, InstallationID: input.InstallationID,
		AgentVersionAssetID: input.AgentVersionAssetID, ProjectionGeneration: input.ProjectionGeneration,
		WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID,
		ActivityID: info.ActivityID, Attempt: int64(info.Attempt), CancelRequested: input.CancelPending,
		HeartbeatIntervalSeconds: input.HeartbeatIntervalSeconds, ObservationIntervalSeconds: input.ObservationIntervalSeconds,
	}
	heartbeat := time.NewTicker(time.Duration(in.HeartbeatIntervalSeconds) * time.Second)
	defer heartbeat.Stop()
	heartbeatContext, stopHeartbeat := context.WithCancel(ctx)
	heartbeatDone := make(chan struct{})
	defer func() { stopHeartbeat(); <-heartbeatDone }()
	go func() {
		defer close(heartbeatDone)
		for {
			activity.RecordHeartbeat(heartbeatContext, in.InvocationID)
			select {
			case <-heartbeatContext.Done():
				return
			case <-heartbeat.C:
			}
		}
	}()
	for {
		var err error
		out, err = c.advanceAgentTaskOnce(ctx, in)
		if err != nil {
			// HTTP 结果不明结束本 attempt；lease 继续占用，绝不以错误归还。
			return out, err
		}
		if out.FinishActivity {
			// SDK 返回才形成 ActivityCompleted；Core release 必须读回该事件。
			return out, nil
		}
		timer := time.NewTimer(time.Duration(in.ObservationIntervalSeconds) * time.Second)
		select {
		case <-ctx.Done():
			timer.Stop()
			return out, ctx.Err()
		case <-timer.C:
		}
	}
}

func (c *CoreAPI) advanceAgentTaskOnce(ctx context.Context, in generated.AgentTaskAdvanceRequest) (generated.AgentTaskAdvanceResult, error) {
	var raw json.RawMessage
	var out generated.AgentTaskAdvanceResult
	if err := c.post(ctx, "/service/v1/agent-tasks/advance", in, &raw); err != nil {
		return out, err
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return out, temporal.NewNonRetryableApplicationError("AgentTask 回应不可解析", ErrTypeUnknownExternalResult, nil)
	}
	for _, key := range []string{"invocationId", "status", "waitingReason", "finishActivity"} {
		value, ok := fields[key]
		if !ok || string(value) == "null" {
			return out, temporal.NewNonRetryableApplicationError("AgentTask 回应缺冻结引用或状态", ErrTypeUnknownExternalResult, nil)
		}
	}
	if json.Unmarshal(raw, &out) != nil || out.InvocationID != in.InvocationID || out.WaitingReason == "" {
		return out, temporal.NewNonRetryableApplicationError("AgentTask 回应与冻结 Invocation 不符", ErrTypeUnknownExternalResult, nil)
	}
	if out.Status != generated.TaskStatusRUNNING && !out.FinishActivity {
		return out, temporal.NewNonRetryableApplicationError("AgentTask 终态缺 Activity 收尾证据", ErrTypeUnknownExternalResult, nil)
	}
	if (out.ApprovalWorkflowID == nil) != (out.ApprovalInput == nil) ||
		(out.ApprovalWorkflowID != nil && (*out.ApprovalWorkflowID == "" || out.Status != generated.TaskStatusRUNNING ||
			!out.FinishActivity || out.WaitingReason != "WAITING_APPROVAL")) {
		return out, temporal.NewNonRetryableApplicationError("AgentTask step approval reference is incomplete", ErrTypeUnknownExternalResult, nil)
	}
	switch out.Status {
	case generated.TaskStatusRUNNING, generated.Completed, generated.TaskStatusFAILED, generated.Canceled:
		return out, nil
	default:
		return out, temporal.NewNonRetryableApplicationError("AgentTask 回应状态未知", ErrTypeUnknownExternalResult, nil)
	}
}

// ProjectAgentTaskState 消费唯一 TaskProjection 写入面的实际 ACK。HTTP 200
// 可以是「更旧事件已忽略」，不能据此关闭尚未投影的 AgentTask 终态。
func (c *CoreAPI) ProjectAgentTaskState(ctx context.Context, in generated.TaskStateReport) error {
	var ack struct {
		Applied     *bool  `json:"applied"`
		LastEventID *int64 `json:"lastEventId"`
	}
	if err := c.post(ctx, "/service/v1/task-projections", in, &ack); err != nil {
		return err
	}
	// 同一 event 的幂等 ACK 可为 applied=false；更高 event 不是本次报告的证据。
	if ack.Applied == nil || ack.LastEventID == nil || *ack.LastEventID != in.EventID {
		return temporal.NewNonRetryableApplicationError("AgentTask 投影未确认同一 event", ErrTypeUnknownExternalResult, nil)
	}
	return nil
}

const ErrTypeUnknownExternalResult = "UNKNOWN_EXTERNAL_RESULT"

// Native scheduler 已启动原 Workflow。只有原 SERVICE 调用面可回填准入，
// planned time 不由 Worker 提供；Core 独立查 start history/native SA。
func (c *CoreAPI) AdmitAutomationSchedule(ctx context.Context, source generated.AutomationScheduleTaskInput) (generated.AutomationScheduleAdmitResult, error) {
	var out generated.AutomationScheduleAdmitResult
	info := activity.GetInfo(ctx)
	if !info.IsWorkflowActivity() || info.IsLocalActivity || info.WorkflowExecution.ID == "" || info.WorkflowExecution.RunID == "" {
		return out, temporal.NewNonRetryableApplicationError("Schedule Activity 不成立", ErrTypeRejected, nil)
	}
	in := generated.AutomationScheduleAdmitRequest{Input: generated.InputClass(source), WorkflowID: info.WorkflowExecution.ID, RunID: info.WorkflowExecution.RunID}
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/automations/schedule-admit", in, &raw); err != nil {
		return out, err
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields["admitted"] == nil || fields["reasonCode"] == nil ||
		string(fields["admitted"]) == "null" || json.Unmarshal(raw, &out) != nil || out.ReasonCode == "" ||
		(out.Admitted && out.TaskInput == nil) || (!out.Admitted && out.TaskInput != nil) {
		return out, temporal.NewNonRetryableApplicationError("Schedule admission 未确认", ErrTypeUnknownExternalResult, nil)
	}
	return out, nil
}
