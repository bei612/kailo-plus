package auth

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

	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
	"github.com/pydio/cells/v5/common/utils/uuid"
)

func TestNativeUploadFreshConsumesSameExecutionAndFrozenGeneration(t *testing.T) {
	for _, scenario := range []string{"allowed", "missing-generation", "changed-generation", "changed-node", "foreign-user", "expired", "unix-expiry", "invalid-expiry", "revoke"} {
		t.Run(scenario, func(t *testing.T) {
			binding, ae, external, key, intentID, node, user, principal, resource, operation, policy := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
			input := map[string]interface{}{"resourceId": resource, "nativeIntentId": intentID, "nativeNodeId": node,
				"nativeDeadline": float64(time.Now().Add(time.Hour).Unix()), "contentLength": float64(0), "multipart": false}
			claims := map[string]interface{}{"tenant_id": binding, "action_execution_id": ae, "external_execution_id": external,
				"idempotency_key": key, "operation_id": operation, "actor_principal_id": principal, "initiating_human_principal_id": principal,
				"action_key": "file_storage.write@v1", "action_definition_version": float64(1), "target_type": "RESOURCE", "target_id": resource,
				"result_exposure_policy_id": policy, "result_exposure_policy_version": float64(1)}
			payload, _ := json.Marshal(claims)
			token := "fixture." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture"
			generation, admissions, peps := float64(3), 0, 0
			var arguments string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service", "token_type": "Bearer", "expires_in": 60})
					return
				}
				var body map[string]interface{}
				if r.Header.Get("Authorization") != "Bearer service" || json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Error("binding service authentication missing")
				}
				if r.URL.Path == "/service/v1/adapter/human-action" {
					admissions++
					if r.Header.Get("X-Kailo-Native-Human-Token") != "human" {
						t.Error("separate HUMAN credential missing")
					}
					reference, ok := body["nativeExecutionAdmission"].(map[string]interface{})
					if !ok || len(reference) != 3 || reference["actionExecutionId"] != ae || reference["externalExecutionId"] != external || reference["nativeIntentId"] != intentID {
						t.Error("new execution or foreign intent requested")
					}
					raw, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": resource}, "input": input})
					arguments = string(raw)
					expires := time.Now().Add(time.Minute)
					if scenario == "expired" {
						expires = time.Now().Add(-time.Second)
					}
					var expiry interface{} = expires.UTC().Format(time.RFC3339Nano)
					if scenario == "unix-expiry" {
						expiry = expires.Unix()
					}
					if scenario == "invalid-expiry" {
						expiry = "+10000-01-01T00:00:00Z"
					}
					json.NewEncoder(w).Encode(map[string]interface{}{"nativeExecutionAdmission": map[string]interface{}{"actionToken": token, "argumentsJson": arguments, "expiresAt": expiry}})
					return
				}
				peps++
				if r.URL.Path != "/service/v1/adapter/pep_check" || body["actionToken"] != token || body["argumentsJson"] != arguments || body["operation"] != "execute" {
					t.Error("actual PEP proof changed")
				}
				if scenario == "revoke" && peps > 1 {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				result := map[string]interface{}{"actionExecutionId": ae, "operationId": operation, "authorizationMinZedToken": "fresh",
					"targetResource": map[string]interface{}{"resourceId": resource, "nativeType": "folder", "nativeRef": binding, "nativeInstanceRef": "instance", "nativeScopeRef": binding}}
				if scenario != "missing-generation" {
					result["bindingGeneration"] = generation
				}
				json.NewEncoder(w).Encode(result)
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			d := NativeWriteDelivery{NativeActorDelivery: NativeActorDelivery{Delivery: protocol.Delivery{BindingID: binding, InstanceServiceUUID: binding,
				CorePEPURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/token", ClientID: "binding", ClientSecretFile: secret,
				RequestTimeout: "1s", MaxResponseBytes: 8192, ClientSecretMaxBytes: 128}, TenantID: binding, NativeRootRef: binding, NativeScopeRef: binding, NativeInstanceRef: "instance"}}
			configuration, _ := json.Marshal(map[string]interface{}{"actors": []map[string]interface{}{{"principalId": principal, "kind": "HUMAN", "userUuid": user}},
				"write": map[string]interface{}{"actionVersion": 1, "resultExposurePolicyId": policy, "resultExposurePolicyVersion": 1}})
			if err := json.Unmarshal(configuration, &d); err != nil {
				t.Fatal(err)
			}
			u := &NativeUploadExecution{Delivery: d, ActionExecutionID: ae, ExternalExecutionID: external, NativeIntentID: intentID, Key: key, NativeUserID: user, HumanToken: "human"}
			ctx := claim.ToContext(context.Background(), claim.Claims{Subject: user})
			err := u.Fresh(ctx)
			if scenario == "missing-generation" || scenario == "expired" || scenario == "unix-expiry" || scenario == "invalid-expiry" {
				if err == nil {
					t.Fatal("missing generation or expired admission accepted")
				}
				return
			}
			if err != nil || u.Generation != 3 {
				t.Fatal("original frozen generation not consumed", err)
			}
			switch scenario {
			case "changed-generation":
				generation = 4
			case "changed-node":
				input["nativeNodeId"] = uuid.New()
			case "foreign-user":
				ctx = claim.ToContext(context.Background(), claim.Claims{Subject: uuid.New()})
			}
			err = u.Fresh(ctx)
			if scenario == "allowed" {
				if err != nil || admissions != 2 || peps != 2 {
					t.Fatal("fresh same execution did not call both authorities", admissions, peps, err)
				}
			} else if err == nil {
				t.Fatal("changed/withdrawn writer authorization accepted", scenario)
			}
		})
	}
}
