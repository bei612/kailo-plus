package activities

import (
	"apps/worker/internal/contracts/generated"
	"context"
	"encoding/json"
	"go.temporal.io/sdk/temporal"
)

func (c *CoreAPI) AdvanceResourceProvision(ctx context.Context, in generated.ResourceProvisionAdvanceRequest) (generated.ResourceProvisionAdvanceResult, error) {
	var out generated.ResourceProvisionAdvanceResult
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/resources/advance", in, &raw); err != nil {
		return out, err
	}
	if decodeConformanceJSON(raw, &out) != nil || out.ResourceID != in.Target.ResourceID || out.WaitingReason == "" {
		return out, temporal.NewNonRetryableApplicationError("Resource reference observation invalid", ErrTypeUnknownExternalResult, nil)
	}
	switch out.Status {
	case generated.TaskStatusRUNNING, generated.TaskStatusCOMPLETED, generated.TaskStatusFAILED:
		return out, nil
	}
	return out, temporal.NewNonRetryableApplicationError("Resource reference state unknown", ErrTypeUnknownExternalResult, nil)
}
