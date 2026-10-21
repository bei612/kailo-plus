package activities

import (
	"apps/worker/internal/contracts/generated"
	"context"
	"encoding/json"
	"go.temporal.io/sdk/temporal"
)

// AdvanceResourceTransfer 推进一轮 RESOURCE_EXPORT/RESOURCE_IMPORT（DD-42、DD-131(2)(3)）。
// Core 的回执必须回显同一 ActionExecution 且状态在封闭集合内；其余一律按结果不明处理。
func (c *CoreAPI) AdvanceResourceTransfer(ctx context.Context, in generated.ResourceTransferAdvanceRequest) (generated.ResourceTransferAdvanceResult, error) {
	var out generated.ResourceTransferAdvanceResult
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/resource-transfers/advance", in, &raw); err != nil {
		return out, err
	}
	if decodeConformanceJSON(raw, &out) != nil || out.ActionExecutionID != in.Target.ActionExecutionID || out.WaitingReason == "" {
		return out, temporal.NewNonRetryableApplicationError("transfer observation invalid", ErrTypeUnknownExternalResult, nil)
	}
	switch out.Status {
	case generated.TaskStatusRUNNING, generated.TaskStatusCOMPLETED, generated.TaskStatusFAILED:
		return out, nil
	}
	return out, temporal.NewNonRetryableApplicationError("transfer state unknown", ErrTypeUnknownExternalResult, nil)
}
