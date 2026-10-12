package jobs

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/config"
	"google.golang.org/protobuf/proto"
)

func TestNativeDeleteFreshWaitsOnlyForOriginalUnobservedReference(t *testing.T) {
	const binding = "00000000-0000-4000-8000-000000000001"
	const actor = "00000000-0000-4000-8000-000000000002"
	const user = "00000000-0000-4000-8000-000000000003"
	const key = "00000000-0000-4000-8000-000000000004"
	const external = "00000000-0000-4000-8000-000000000005"
	const root = "00000000-0000-4000-8000-000000000006"
	for _, scenario := range []string{"pending-then-admitted", "permission-denied", "pending-with-ticket", "different-deadline", "generation-drift", "changed-input", "cancelled", "revoked-between-writes"} {
		t.Run(scenario, func(t *testing.T) {
			deadline := time.Now().Add(time.Minute).UTC().Truncate(time.Second).Format("2006-01-02T15:04:05.000Z")
			claims := map[string]interface{}{"tenant_id": binding, "actor_principal_id": actor, "initiating_human_principal_id": actor,
				"operation_id": key, "action_execution_id": key, "action_key": "file_storage.delete@v1", "target_type": "RESOURCE", "target_id": root,
				"external_execution_id": external, "idempotency_key": key}
			payload, _ := json.Marshal(claims)
			token := "fixture." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture"
			input := map[string]interface{}{"resourceId": root, "nativeObjectRefs": []interface{}{root}, "removePermanently": true}
			arguments, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": root}, "input": input})
			admissions, peps := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "binding-service", "token_type": "Bearer", "expires_in": 60})
					return
				}
				if r.Header.Get("Authorization") != "Bearer binding-service" || r.Header.Get("X-Kailo-Native-Human-Token") != "" {
					t.Error("SERVICE task borrowed HUMAN identity")
				}
				var request map[string]interface{}
				if json.NewDecoder(r.Body).Decode(&request) != nil || request["bindingId"] != binding {
					t.Error("wrong binding ingress")
				}
				if r.URL.Path == "/service/v1/adapter/request_native_task_execution_admission" {
					admissions++
					if request["actionExecutionId"] != key || request["nativeTaskDeadline"] != deadline {
						t.Error("frozen task reference changed")
					}
					if scenario == "permission-denied" || (scenario == "revoked-between-writes" && admissions > 1) {
						w.WriteHeader(403)
						return
					}
					if admissions == 1 && (scenario == "pending-then-admitted" || scenario == "pending-with-ticket") {
						answer := map[string]interface{}{"state": "PENDING_REFERENCE", "nativeTaskDeadline": deadline}
						if scenario == "pending-with-ticket" {
							answer["actionToken"] = token
						}
						json.NewEncoder(w).Encode(answer)
						return
					}
					answer := map[string]interface{}{"state": "ADMITTED", "nativeTaskDeadline": deadline, "actionToken": token, "argumentsJson": string(arguments), "expiresAt": deadline}
					if scenario == "different-deadline" {
						answer["nativeTaskDeadline"] = time.Now().Add(2 * time.Minute).Format(time.RFC3339)
					}
					if scenario == "changed-input" {
						answer["argumentsJson"] = `{"target":{},"input":{}}`
					}
					json.NewEncoder(w).Encode(answer)
					return
				}
				if r.URL.Path != "/service/v1/adapter/pep_check" {
					t.Error("new shadow transport")
					w.WriteHeader(404)
					return
				}
				peps++
				generation := 1
				if scenario == "generation-drift" {
					generation = 2
				}
				json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": key, "operationId": key, "authorizationMinZedToken": "fresh",
					"bindingGeneration": generation, "nativeTaskDeadline": deadline, "targetResource": map[string]interface{}{
						"resourceId": root, "nativeType": "folder", "nativeRef": root, "nativeInstanceRef": "isolated", "nativeScopeRef": binding}})
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "client-secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			delivery := auth.NativeDeleteDelivery{NativeActorDelivery: auth.NativeActorDelivery{Delivery: protocol.Delivery{
				BindingID: binding, InstanceServiceUUID: external, CorePEPURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/token",
				ClientID: "isolated-binding", ClientSecretFile: secret, ClientSecretMaxBytes: 128, MaxResponseBytes: 8192, RequestTimeout: "1s"},
				TenantID: binding, NativeInstanceRef: "isolated", NativeScopeRef: binding, NativeRootRef: root}, ExecutionDeadline: deadline, ExecutionGeneration: 1}
			encoded, _ := json.Marshal(map[string]interface{}{"actors": []map[string]string{{"principalId": actor, "kind": "HUMAN", "userUuid": user}}})
			if err := json.Unmarshal(encoded, &delivery); err != nil {
				t.Fatal(err)
			}
			delivery.Delete.NativeJobID, delivery.Delete.NativeType, delivery.Delete.AdmissionPollInterval = "original-delete-owner", "job", "1ms"
			task, err := NewNativeDeleteTask(delivery, key, "native-owner", user, claims, input)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := NewNativeDeleteTask(delivery, key, common.PydioSystemUsername, user, claims, input); err == nil {
				t.Fatal("governed claim accepted system-admin router owner")
			}
			before := proto.Clone(task)
			ctx := config.WithStubStore(context.Background())
			if err := config.Set(ctx, delivery, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
				t.Fatal(err)
			}
			if scenario == "cancelled" {
				cancelled, cancel := context.WithCancel(ctx)
				cancel()
				ctx = cancelled
			}
			if scenario == "revoked-between-writes" {
				ctx = context.WithValue(ctx, nativeDeleteContextKey{}, task)
				ctx = context.WithValue(ctx, ClaimedTaskContextKey{}, true)
				if err := FreshNativeDeleteStep(ctx, true); err != nil {
					t.Fatal(err)
				}
				if err := FreshNativeDeleteStep(ctx, true); err == nil {
					t.Fatal("later native step ignored original initiator revocation")
				}
				if admissions != 2 || peps != 1 || !proto.Equal(task, before) {
					t.Fatal("revoked step retried or modified terminal evidence")
				}
				return
			}
			err = NativeDeleteFresh(ctx, task, true)
			if scenario == "pending-then-admitted" {
				if err != nil || admissions != 2 || peps != 1 {
					t.Fatalf("same task handoff failed: %v admissions=%d peps=%d", err, admissions, peps)
				}
			} else if err == nil {
				t.Fatal("missing/changed authority reached the original mutation")
			}
			if scenario == "permission-denied" && (admissions != 1 || peps != 0) {
				t.Fatal("revocation was polled or authorized")
			}
			if !proto.Equal(task, before) {
				t.Fatal("fresh admission persisted a token or changed the original claim")
			}
		})
	}
	if FreshNativeDeleteStep(context.Background(), true) == nil {
		t.Fatal("lost task context became independent native authority")
	}
}
