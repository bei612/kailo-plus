package activities

import (
	"context"
	"encoding/hex"
	"errors"
	"time"

	"apps/worker/internal/contracts/generated"
)

// Set only by the original release build from its frozen source commit. A
// developer binary without provenance cannot approve a component release.
var platformBuildID string

func (c *CoreAPI) ApproveComponentRelease(ctx context.Context, in generated.ComponentReleaseApprovalReport) (generated.ComponentReleaseReceipt, error) {
	var out generated.ComponentReleaseReceipt
	decoded, err := hex.DecodeString(platformBuildID)
	if err != nil || len(decoded) != 20 {
		return out, errors.New("Worker build provenance unavailable")
	}
	// The activity owns these facts. Workflow history and caller input cannot
	// supply a pass bit, pretend driver registry, or substitute another build.
	in.WorkerBuild = generated.WorkerBuildClass{
		Subject: generated.Subject("WORKER"), BuildID: platformBuildID, HostAPIVersion: "NONE",
		AdapterProtocolVersions: []string{"1"}, DriverRegistryKeys: []string{},
		ConnectorKinds:   []string{"REMOTE_ADAPTER", "PROTOCOL_PEER"},
		PlatformPortKeys: []generated.PlatformPortKey{}, ReportedAt: time.Now().UTC(),
	}
	err = c.post(ctx, "/service/v1/component-releases/approve", in, &out)
	return out, err
}
