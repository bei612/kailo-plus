package grpc

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common/errors"
	"github.com/pydio/cells/v5/common/proto/update"
)

// Kailo (DD-133(1), DD-138(7)): the upstream update and upgrade are refused
// on the server whatever the request carries.
func TestKailoUpdateServiceClosed(t *testing.T) {
	h := new(Handler)
	if rsp, err := h.UpdateRequired(context.Background(), &update.UpdateRequest{Channel: "stable"}); rsp != nil || !errors.Is(err, errors.StatusForbidden) {
		t.Fatalf("UpdateRequired = %v, %v; want nil, forbidden", rsp, err)
	}
	if rsp, err := h.ApplyUpdate(context.Background(), &update.ApplyUpdateRequest{TargetVersion: "9.9.9", PackageName: "cells"}); rsp != nil || !errors.Is(err, errors.StatusForbidden) {
		t.Fatalf("ApplyUpdate = %v, %v; want nil, forbidden", rsp, err)
	}
}
