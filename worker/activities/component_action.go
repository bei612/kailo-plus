package activities

import (
	"apps/worker/internal/contracts/generated"
	"context"
	"encoding/json"
	"go.temporal.io/sdk/temporal"
)

// Original Core AE/EE facts alone can advance the component action.
func (c *CoreAPI) AdvanceComponentAction(ctx context.Context, in generated.ComponentActionAdvanceRequest) (generated.ComponentActionAdvanceResult, error) {
	var out generated.ComponentActionAdvanceResult
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/component-actions/advance", in, &raw); err != nil {
		return out, err
	}
	if decodeConformanceJSON(raw, &out) != nil || out.ActionExecutionID != in.Target.ActionExecutionID || out.WaitingReason == "" {
		return out, temporal.NewNonRetryableApplicationError("Component action response identity invalid", ErrTypeUnknownExternalResult, nil)
	}
	switch out.Status {
	case generated.TaskStatusRUNNING, generated.Completed, generated.Canceled, generated.TaskStatusFAILED:
		return out, nil
	default:
		return out, temporal.NewNonRetryableApplicationError("Component action outcome unknown", ErrTypeUnknownExternalResult, nil)
	}
}
