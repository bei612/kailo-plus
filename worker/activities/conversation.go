package activities

import (
	"apps/worker/internal/contracts/generated"
	"context"
	"encoding/json"
	"go.temporal.io/sdk/temporal"
)

// ProjectConversation uses the original Core-authenticated Activity transport.
func (c *CoreAPI) ProjectConversation(ctx context.Context, in generated.ConversationProjectionRequest) (generated.ConversationProjectionResult, error) {
	var result generated.ConversationProjectionResult
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/conversations/project", in, &raw); err != nil {
		return result, err
	}
	if decodeConformanceJSON(raw, &result) != nil || result.ConversationID != in.Target.ConversationID ||
		!((result.Status == generated.Completed && result.WaitingReason == "NONE") ||
			(result.Status == generated.TaskStatusRUNNING && result.WaitingReason == "UNKNOWN_EXTERNAL_RESULT")) {
		return result, temporal.NewNonRetryableApplicationError("DM projection observation invalid", ErrTypeUnknownExternalResult, nil)
	}
	return result, nil
}
