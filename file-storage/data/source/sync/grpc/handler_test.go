package grpc

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/sync"
)

// A datasource whose sync has not initialised (InitSync stops before setting
// the config while its index lacks a table and root) answers TriggerResync
// as unavailable instead of dereferencing the missing config.
func TestTriggerResyncBeforeInitIsUnavailable(t *testing.T) {
	h := &Handler{PresetSync: &Syncer{DsName: "pydiods1"}}
	_, err := h.TriggerResync(context.Background(), &sync.ResyncRequest{Path: "/"})
	if !errors.Is(err, errors.StatusServiceUnavailable) {
		t.Fatalf("TriggerResync before init: %v", err)
	}
}
