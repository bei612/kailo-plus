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

// DD-138(6), design 07 §4.8.5 (V-SCN-269): a data source re-sync is an
// operational action of the deployment; in Kailo mode a person Kailo manages
// cannot queue it (the read-only storage.dataSources surface offers none).
func TestKailoDatasourceResyncRefusedForKailoPeople(t *testing.T) {
	mode, person := auth.NativeKailoMode, auth.NativeKailoPersonRequest
	t.Cleanup(func() { auth.NativeKailoMode, auth.NativeKailoPersonRequest = mode, person })
	auth.NativeKailoMode = func() bool { return true }
	auth.NativeKailoPersonRequest = func(context.Context) (bool, error) { return true, nil }

	body := `{"JobName":"datasource-resync","JsonParameters":"{\"dsName\":\"pydiods1\"}"}`
	r := httptest.NewRequest(http.MethodPut, "/a/jobs/user/datasource-resync", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	h := new(JobsHandler)
	if err := h.UserCreateJob(restful.NewRequest(r), restful.NewResponse(httptest.NewRecorder())); !errors.Is(err, errors.StatusForbidden) {
		t.Fatalf("datasource-resync by a Kailo person = %v, want forbidden", err)
	}
}
