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

func TestProtocolSessionActualActivityRejectsUnconfirmedTerminal(t *testing.T) {
	for _, scenario := range []string{"saved-running", "closed-confirmed", "saved-completed", "pending-completed", "unknown-phase", "unknown-state", "unknown-status", "wrong-session"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/token" {
					_, _ = io.WriteString(w, `{"access_token":"isolated-worker","expires_in":300}`)
					return
				}
				calls++
				if r.URL.Path != "/service/v1/protocol-sessions/reconcile" || r.Header.Get("Authorization") != "Bearer isolated-worker" {
					t.Error("bypassed original Core service consumer")
				}
				var request generated.ProtocolSessionReconcileRequest
				if json.NewDecoder(r.Body).Decode(&request) != nil || request.Target.ProtocolSessionID != "original-session" {
					t.Error("original Session lost")
				}
				out := map[string]interface{}{"protocolSessionId": "original-session", "round": map[string]interface{}{"sessionVersion": 8, "state": "SAVED"}, "status": "RUNNING", "waitingReason": "PROTOCOL_SESSION_OPEN"}
				round := out["round"].(map[string]interface{})
				switch scenario {
				case "closed-confirmed":
					round["state"] = "CLOSED"
					out["status"] = "COMPLETED"
					out["waitingReason"] = "NONE"
				case "saved-completed":
					out["status"] = "COMPLETED"
					out["waitingReason"] = "NONE"
				case "pending-completed", "unknown-phase":
					round["state"] = "REVOKED"
					out["status"] = "COMPLETED"
					out["waitingReason"] = "NONE"
					phase := "STARTED"
					if scenario == "unknown-phase" {
						phase = "FUTURE"
					}
					round["writeObservation"] = map[string]interface{}{"phase": phase, "correlationRef": "original-write", "bytesWritten": 0, "editors": "native-human", "baseModifiedAt": "2026-10-05T00:00:00Z"}
				case "unknown-state":
					round["state"] = "FUTURE"
				case "unknown-status":
					out["status"] = "FUTURE"
				case "wrong-session":
					out["protocolSessionId"] = "another-session"
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
			request := generated.ProtocolSessionReconcileRequest{Target: generated.ProtocolSessionReconcileRequestTarget{ProtocolSessionID: "original-session", SessionVersion: 8}}
			_, err = api.AdvanceProtocolSession(context.Background(), request)
			success := scenario == "saved-running" || scenario == "closed-confirmed"
			if (err == nil) != success || calls != 1 {
				t.Fatalf("scenario=%s calls=%d err=%v", scenario, calls, err)
			}
		})
	}
}
