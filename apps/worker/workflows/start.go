package workflows

import (
	"context"
	"errors"

	"github.com/kailo/apps/worker/internal/contracts/generated"
	"go.temporal.io/api/enums/v1"
	"go.temporal.io/api/serviceerror"
	"go.temporal.io/sdk/client"
)

// StartOptions 构造至多一次启动所需的选项（.design/06）。
//
// 不能依赖 Server 的 request-ID 去重：SDK 每次 Start 都填新的 RequestId，
// 而 SignalWithStart 一类 API 默认 AllowDuplicate（SF-TSDK-10）。
// 因此三项必须同时给全，缺任一项都会让重复 Start 产生第二个 execution。
func StartOptions(kind generated.WorkflowKind, taskQueue, tenantID, primaryEntityID string, entityVersion int) client.StartWorkflowOptions {
	return client.StartWorkflowOptions{
		ID:                                       WorkflowID(kind, tenantID, primaryEntityID, entityVersion),
		TaskQueue:                                taskQueue,
		WorkflowIDReusePolicy:                    enums.WORKFLOW_ID_REUSE_POLICY_REJECT_DUPLICATE,
		WorkflowIDConflictPolicy:                 enums.WORKFLOW_ID_CONFLICT_POLICY_FAIL,
		WorkflowExecutionErrorWhenAlreadyStarted: true,
	}
}

// StartOnce 执行至多一次启动。
//
// 收到 WorkflowExecutionAlreadyStarted 即视为「已启动成功」而不是失败：
// 该错误恰好证明同一 ID 的 execution 已存在，重试 Start 只会再撞一次。
// 其余错误原样返回——Start 返回不明时调用方只能用同一 ID 调 Describe，
// 不得换 ID 重试（DD-48）。
func StartOnce(ctx context.Context, c client.Client, opts client.StartWorkflowOptions, workflowType string, args ...any) (client.WorkflowRun, error) {
	run, err := c.ExecuteWorkflow(ctx, opts, workflowType, args...)
	if err == nil {
		return run, nil
	}
	var already *serviceerror.WorkflowExecutionAlreadyStarted
	if errors.As(err, &already) {
		return c.GetWorkflow(ctx, opts.ID, ""), nil
	}
	return nil, err
}
