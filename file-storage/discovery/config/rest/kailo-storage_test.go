package rest

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	restful "github.com/emicklei/go-restful/v3"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/errors"
)

// DD-138(6), design 07 §4.8.5 (V-SCN-269): data sources are a READ_ONLY
// STORAGE admin surface in Kailo mode. Every native storage write is refused
// by this server for a person Kailo manages before the request body is read
// or the configuration is touched; outside Kailo mode nothing changes.
func TestKailoStorageWritesRefusedForKailoPeople(t *testing.T) {
	mode, person := auth.NativeKailoMode, auth.NativeKailoPersonRequest
	t.Cleanup(func() { auth.NativeKailoMode, auth.NativeKailoPersonRequest = mode, person })
	auth.NativeKailoMode = func() bool { return true }
	auth.NativeKailoPersonRequest = func(context.Context) (bool, error) { return true, nil }

	h := new(Handler)
	writes := map[string]func(*restful.Request, *restful.Response) error{
		"PutDataSource":       h.PutDataSource,
		"DeleteDataSource":    h.DeleteDataSource,
		"CreateStorageBucket": h.CreateStorageBucket,
		"CreateEncryptionKey": h.CreateEncryptionKey,
		"DeleteEncryptionKey": h.DeleteEncryptionKey,
		"ExportEncryptionKey": h.ExportEncryptionKey,
		"ImportEncryptionKey": h.ImportEncryptionKey,
	}
	for name, write := range writes {
		// A body the handler could otherwise act on: refusal comes first.
		body := `{"Name":"pydiods1","StorageType":"LOCAL","StorageConfiguration":{"folder":"/tmp/x"},"VersioningPolicyName":"x"}`
		r := httptest.NewRequest(http.MethodPost, "/a/config/datasource/pydiods1", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		err := write(restful.NewRequest(r), restful.NewResponse(httptest.NewRecorder()))
		if !errors.Is(err, errors.StatusForbidden) {
			t.Fatalf("%s by a Kailo person = %v, want forbidden", name, err)
		}
	}

	// An unresolvable caller fails closed.
	auth.NativeKailoPersonRequest = func(context.Context) (bool, error) { return false, errors.New("no identity") }
	r := httptest.NewRequest(http.MethodDelete, "/a/config/datasource/pydiods1", nil)
	if err := h.DeleteDataSource(restful.NewRequest(r), restful.NewResponse(httptest.NewRecorder())); !errors.Is(err, errors.StatusForbidden) {
		t.Fatalf("DeleteDataSource by an unresolved caller = %v, want forbidden", err)
	}
}

func TestKailoStorageGateLeavesDeploymentAndNativeMode(t *testing.T) {
	mode, person := auth.NativeKailoMode, auth.NativeKailoPersonRequest
	t.Cleanup(func() { auth.NativeKailoMode, auth.NativeKailoPersonRequest = mode, person })

	// Kailo mode, deployment's local account (deploy/reconcile.py): allowed.
	auth.NativeKailoMode = func() bool { return true }
	auth.NativeKailoPersonRequest = func(context.Context) (bool, error) { return false, nil }
	if err := auth.NativeKailoRefuseManagedWrite(context.Background()); err != nil {
		t.Fatalf("deployment write refused: %v", err)
	}
	// Outside Kailo mode the caller is not even resolved.
	auth.NativeKailoMode = func() bool { return false }
	auth.NativeKailoPersonRequest = func(context.Context) (bool, error) {
		t.Fatal("caller resolved outside Kailo mode")
		return true, nil
	}
	if err := auth.NativeKailoRefuseManagedWrite(context.Background()); err != nil {
		t.Fatalf("native mode write refused: %v", err)
	}
}
