package activities

import (
	"context"
	"encoding/json"

	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
)

// Only original Core facts advance a binding. No adapter URL, key or token
// crosses this Activity's history boundary.
func (c *CoreAPI) AdvanceApplicationBinding(ctx context.Context, in generated.ApplicationBindingAdvanceRequest) (generated.ApplicationBindingAdvanceResult, error) {
	var out generated.ApplicationBindingAdvanceResult
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/application-bindings/advance", in, &raw); err != nil {
		return out, err
	}
	if decodeConformanceJSON(raw, &out) != nil || out.BindingID != in.Target.BindingID || out.WaitingReason == "" {
		return out, temporal.NewNonRetryableApplicationError("Binding response is not verifiable", ErrTypeUnknownExternalResult, nil)
	}
	switch out.Status {
	case generated.TaskStatusRUNNING, generated.TaskStatusCOMPLETED, generated.Canceled, generated.TaskStatusFAILED:
		return out, nil
	default:
		return out, temporal.NewNonRetryableApplicationError("Binding response state unknown", ErrTypeUnknownExternalResult, nil)
	}
}
