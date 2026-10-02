package activities

import (
	"context"
	"encoding/json"

	"apps/worker/internal/contracts/generated"
	"go.temporal.io/sdk/temporal"
)

// AdvanceAgentInstallation consumes the Core-owned installation intent. The
// Worker carries only references, and never promotes an HTTP ACK to readiness.
func (c *CoreAPI) AdvanceAgentInstallation(ctx context.Context, in generated.AgentInstallationAdvanceRequest) (generated.AgentInstallationAdvanceResult, error) {
	var raw json.RawMessage
	var out generated.AgentInstallationAdvanceResult
	if err := c.post(ctx, "/service/v1/agent-installations/advance", in, &raw); err != nil {
		return out, err
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil {
		return out, temporal.NewNonRetryableApplicationError("Installation 回应不可解析", ErrTypeUnknownExternalResult, nil)
	}
	for _, key := range []string{"installationId", "status", "waitingReason"} {
		value, ok := fields[key]
		if !ok || string(value) == "null" {
			return out, temporal.NewNonRetryableApplicationError("Installation 回应缺冻结引用或状态", ErrTypeUnknownExternalResult, nil)
		}
	}
	if json.Unmarshal(raw, &out) != nil || out.InstallationID != in.InstallationID || out.WaitingReason == "" {
		return out, temporal.NewNonRetryableApplicationError("Installation 回应与冻结目标不符", ErrTypeUnknownExternalResult, nil)
	}
	switch out.Status {
	case generated.Running, generated.Completed, generated.TaskStatusFAILED, generated.Canceled:
		return out, nil
	default:
		return out, temporal.NewNonRetryableApplicationError("Installation 回应状态未知", ErrTypeUnknownExternalResult, nil)
	}
}
