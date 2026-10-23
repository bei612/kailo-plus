package activities

import (
	"apps/worker/internal/contracts/generated"
	"context"
	"encoding/json"
	"go.temporal.io/sdk/temporal"
)

func (c *CoreAPI) AdvanceResourceImport(ctx context.Context, in generated.ResourceImportAdvanceRequest) (generated.ResourceImportAdvanceResult, error) {
	var out generated.ResourceImportAdvanceResult
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/resource-imports/advance", in, &raw); err != nil {
		return out, err
	}
	if decodeConformanceJSON(raw, &out) != nil || out.ResourceID != in.Target.ResourceID || out.WaitingReason == "" {
		return out, temporal.NewNonRetryableApplicationError("Resource import observation invalid", ErrTypeUnknownExternalResult, nil)
	}
	switch out.Status {
	case generated.TaskStatusRUNNING, generated.TaskStatusCOMPLETED, generated.TaskStatusFAILED:
		return out, nil
	}
	return out, temporal.NewNonRetryableApplicationError("Resource import state unknown", ErrTypeUnknownExternalResult, nil)
}
