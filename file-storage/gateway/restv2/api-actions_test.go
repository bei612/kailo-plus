package restv2

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	restful "github.com/emicklei/go-restful/v3"
	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/errors"
	treeer "github.com/pydio/cells/v5/data/tree/rest"
)

func TestNativeBackgroundActionsRequireAdmission(t *testing.T) {
	for _, route := range []struct {
		name   string
		action string
		method string
		call   func(*restful.Request, *restful.Response) error
	}{
		{"perform-delete", "delete", http.MethodPost, (&Handler{}).PerformAction},
		{"perform-restore", "restore", http.MethodPost, (&Handler{}).PerformAction},
		{"perform-copy", "copy", http.MethodPost, (&Handler{}).PerformAction},
		{"perform-move", "move", http.MethodPost, (&Handler{}).PerformAction},
		{"perform-extract", "extract", http.MethodPost, (&Handler{}).PerformAction},
		{"perform-compress", "compress", http.MethodPost, (&Handler{}).PerformAction},
		{"control", "delete", http.MethodPatch, (&Handler{}).ControlBackgroundAction},
		{"legacy-delete", "delete", http.MethodPost, (&treeer.Handler{}).DeleteNodes},
	} {
		for _, mode := range []string{"independent", "bound-empty", "bound", "proof", "empty-proof", "duplicate-proof"} {
			t.Run(route.name+"/"+mode, func(t *testing.T) {
				ctx := config.WithStubStore(context.Background())
				if strings.HasPrefix(mode, "bound") {
					delivery := map[string]interface{}{}
					if mode == "bound" {
						delivery["bindingId"] = "00000000-0000-4000-8000-000000000001"
					}
					if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
						t.Fatal(err)
					}
				}
				// A deliberately malformed body independently proves that the
				// managed refusal happens before input parsing, node resolution,
				// recycle metadata writes, task lookup or task control dispatch.
				request := httptest.NewRequest(route.method, "/native-action/"+route.action, strings.NewReader("{")).WithContext(ctx)
				request.Header.Set("Content-Type", "application/json")
				switch mode {
				case "proof":
					request.Header.Set("X-Kailo-Native-Execution", "unconsumed-proof")
				case "empty-proof":
					request.Header["X-Kailo-Native-Execution"] = []string{""}
				case "duplicate-proof":
					request.Header["X-Kailo-Native-Execution"] = []string{"first", "second"}
				}
				var err error
				service := new(restful.WebService).Path("/native-action").Consumes(restful.MIME_JSON)
				service.Route(service.Method(route.method).Path("/{Name}").To(func(req *restful.Request, resp *restful.Response) {
					err = route.call(req, resp)
				}))
				container := restful.NewContainer()
				container.Add(service)
				container.ServeHTTP(httptest.NewRecorder(), request)
				if mode == "independent" {
					if err == nil || errors.Is(err, errors.StatusForbidden) {
						t.Fatalf("independent route lost its original input validation: %v", err)
					}
				} else if !errors.Is(err, errors.StatusForbidden) {
					t.Fatalf("native route reached old parsing/dispatch without admission: %v", err)
				}
				if len(request.Header.Values("X-Kailo-Native-Execution")) != 0 {
					t.Fatal("unconsumed execution credential remained in request diagnostics")
				}
			})
		}
	}
}

func TestNativeMutationGuardPreservesReadProof(t *testing.T) {
	for _, bound := range []bool{false, true} {
		for _, method := range []string{http.MethodGet, http.MethodHead, http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete} {
			t.Run(fmt.Sprintf("bound=%t/%s", bound, method), func(t *testing.T) {
				ctx := config.WithStubStore(context.Background())
				if bound {
					if err := config.Set(ctx, map[string]interface{}{}, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
						t.Fatal(err)
					}
				}
				request := httptest.NewRequest(method, "/native-action", nil).WithContext(ctx)
				request.Header.Set("X-Kailo-Native-Execution", "exact-original-read-proof")
				err := auth.AuthorizeNativeDataMutation(request)
				read := method == http.MethodGet || method == http.MethodHead
				if read {
					if err != nil || request.Header.Get("X-Kailo-Native-Execution") != "exact-original-read-proof" {
						t.Fatalf("mutation guard consumed a read consumer's proof: %v", err)
					}
				} else if !errors.Is(err, errors.StatusForbidden) || len(request.Header.Values("X-Kailo-Native-Execution")) != 0 {
					t.Fatalf("unsupported mutation proof was accepted or not removed: %v", err)
				}
			})
		}
	}
}
