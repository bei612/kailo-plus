package auth

import (
	"context"
	"testing"

	"github.com/pydio/cells/v5/common/errors"
)

// DD-138(6): a deployment-declared storage write whose caller carries no
// native identity is refused in Kailo mode (fails closed).
func TestNativeKailoManagedWriteWithoutIdentity(t *testing.T) {
	mode := NativeKailoMode
	t.Cleanup(func() { NativeKailoMode = mode })
	NativeKailoMode = func() bool { return true }
	if err := NativeKailoRefuseManagedWrite(context.Background()); !errors.Is(err, errors.StatusForbidden) {
		t.Fatalf("write without identity = %v, want forbidden", err)
	}
	NativeKailoMode = func() bool { return false }
	if err := NativeKailoRefuseManagedWrite(context.Background()); err != nil {
		t.Fatalf("native mode write = %v, want nil", err)
	}
}
