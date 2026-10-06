package activities

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"apps/worker/internal/contracts/generated"
	"apps/worker/internal/oidc"
)

func TestComponentActionActivityConsumesOnlyOriginalCoreReceipt(t *testing.T) {
	for _, mode := range []string{"completed", "wrong-action", "unknown-status", "extra-body", "unavailable"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			in := generated.ComponentActionAdvanceRequest{Target: generated.ComponentActionAdvanceRequestTarget{
				ActionExecutionID: "original-ae", BindingID: "original-binding", BindingVersion: 2,
				ComponentReleaseID: "release", ProjectionGeneration: 3, WorkflowID: "workflow"}, RunID: "run", CancelRequested: true}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
				if request.URL.Path == "/token" {
					_, _ = io.WriteString(w, `{"access_token":"isolated-worker","expires_in":300}`)
					return
				}
				calls++
				if request.URL.Path != "/service/v1/component-actions/advance" || request.Method != "POST" || request.Header.Get("Authorization") != "Bearer isolated-worker" {
					t.Error("action bypassed original authenticated Core observer")
				}
				var received generated.ComponentActionAdvanceRequest
				if json.NewDecoder(request.Body).Decode(&received) != nil || received != in {
					t.Error("frozen request changed")
				}
				if mode == "unavailable" {
					w.WriteHeader(503)
					return
				}
				out := map[string]any{"actionExecutionId": "original-ae", "status": "COMPLETED", "waitingReason": "NONE"}
				if mode == "wrong-action" {
					out["actionExecutionId"] = "other-ae"
				}
				if mode == "unknown-status" {
					out["status"] = "ACCEPTED"
				}
				if mode == "extra-body" {
					out["result"] = "untrusted body"
				}
				_ = json.NewEncoder(w).Encode(out)
			}))
			defer server.Close()
			t.Setenv("OIDC_TOKEN_URL", server.URL+"/token")
			t.Setenv("OIDC_WORKER_CLIENT_ID", "isolated-worker")
			t.Setenv("OIDC_WORKER_CLIENT_SECRET", "isolated-fixture")
			tokens, err := oidc.FromEnv()
			if err != nil {
				t.Fatal(err)
			}
			api := &CoreAPI{base: server.URL, tokens: tokens, http: server.Client()}
			out, err := api.AdvanceComponentAction(context.Background(), in)
			if (err == nil) != (mode == "completed") || calls != 1 {
				t.Fatalf("mode=%s calls=%d result=%+v err=%v", mode, calls, out, err)
			}
		})
	}
}
