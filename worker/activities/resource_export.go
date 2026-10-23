package activities

import (
	"apps/worker/internal/contracts/generated"
	"context"
	"encoding/json"
	"go.temporal.io/sdk/temporal"
)

// AdvanceResourceExport asks Core to build, freeze and project one source-Tenant
// ExportPackage (06 §7.1、DD-42). The package bytes never enter Workflow history.
func (c *CoreAPI) AdvanceResourceExport(ctx context.Context, in generated.ResourceExportAdvanceRequest) (generated.ResourceExportAdvanceResult, error) {
	var out generated.ResourceExportAdvanceResult
	var raw json.RawMessage
	if err := c.post(ctx, "/service/v1/resource-exports/advance", in, &raw); err != nil {
		return out, err
	}
	if decodeConformanceJSON(raw, &out) != nil || out.PackageAssetID != in.Target.PackageAssetID || out.WaitingReason == "" {
		return out, temporal.NewNonRetryableApplicationError("Resource export observation invalid", ErrTypeUnknownExternalResult, nil)
	}
	switch out.Status {
	case generated.TaskStatusRUNNING, generated.TaskStatusCOMPLETED, generated.TaskStatusFAILED:
		return out, nil
	}
	return out, temporal.NewNonRetryableApplicationError("Resource export state unknown", ErrTypeUnknownExternalResult, nil)
}
