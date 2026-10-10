package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/protocol"
)

func TestNativeHumanReadAdmissionConsumesOriginalResolvedResourceAndPEP(t *testing.T) {
	const binding = "00000000-0000-4000-8000-000000000001"
	const operation = "00000000-0000-4000-8000-000000000002"
	const requestKey = "00000000-0000-4000-8000-000000000003"
	const resourceID = "00000000-0000-4000-8000-000000000004"
	const actor = "00000000-0000-4000-8000-000000000005"
	const nativeUser = "00000000-0000-4000-8000-000000000006"
	const node = "00000000-0000-4000-8000-000000000007"
	for _, scenario := range []string{"allowed", "foreign-resource", "missing-admission", "replay", "foreign-user", "changed-input", "foreign-key", "agent"} {
		t.Run(scenario, func(t *testing.T) {
			input := map[string]interface{}{"resourceId": resourceID, "nativeObjectRef": node, "nativeRevision": "fixed", "displayName": "file", "mediaType": "text/plain"}
			claims := map[string]interface{}{"action_execution_id": requestKey, "operation_id": operation, "tenant_id": binding,
				"actor_principal_id": actor, "initiating_human_principal_id": actor, "idempotency_key": requestKey,
				"action_key": "file_storage.export@v1", "target_type": "RESOURCE", "target_id": resourceID}
			if scenario == "foreign-key" {
				claims["idempotency_key"] = node
			}
			if scenario == "agent" {
				claims["agent_principal_id"] = actor
			}
			payload, _ := json.Marshal(claims)
			token := "fixture." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture"
			arguments, _ := json.Marshal(map[string]interface{}{"target": map[string]interface{}{"resourceId": resourceID}, "input": input})
			if scenario == "changed-input" {
				arguments = []byte(`{"target":{},"input":{}}`)
			}
			calls := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service", "token_type": "Bearer", "expires_in": 60})
					return
				}
				var raw map[string]interface{}
				if r.Header.Get("Authorization") != "Bearer service" || json.NewDecoder(r.Body).Decode(&raw) != nil {
					t.Error("unverified binding transport")
				}
				resource := map[string]interface{}{"resourceId": resourceID, "nativeType": "folder", "nativeRef": binding, "nativeInstanceRef": "native-instance", "nativeScopeRef": binding}
				if r.URL.Path == "/service/v1/adapter/pep_check" {
					calls = append(calls, "pep")
					if raw["actionToken"] != token || raw["argumentsJson"] != string(arguments) || raw["operation"] != "execute" {
						t.Error("original PEP did not receive exact proof")
					}
					json.NewEncoder(w).Encode(map[string]interface{}{"actionExecutionId": requestKey, "operationId": operation, "authorizationMinZedToken": "fresh", "targetResource": resource})
					return
				}
				if r.URL.Path != "/service/v1/adapter/human-action" || r.Header.Get("X-Kailo-Native-Human-Token") != "human" {
					t.Error("original HUMAN transport not consumed")
				}
				if _, ok := raw["resolveResource"]; ok {
					calls = append(calls, "resolve")
					resource["resourceVersion"] = 4
					if scenario == "foreign-resource" {
						resource["nativeInstanceRef"] = "foreign"
					}
					json.NewEncoder(w).Encode(map[string]interface{}{"resource": resource})
					return
				}
				calls = append(calls, "admit")
				command, _ := raw["command"].(map[string]interface{})
				if command["idempotencyKey"] != requestKey || command["resourceVersion"] != float64(4) {
					t.Error("original resource/key not frozen")
				}
				answer := map[string]interface{}{}
				if scenario != "missing-admission" && scenario != "replay" {
					answer["readAdmission"] = map[string]interface{}{"actionToken": token, "argumentsJson": string(arguments), "expiresAt": 1791504060}
				}
				json.NewEncoder(w).Encode(answer)
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			d := NativeActorDelivery{Delivery: protocol.Delivery{BindingID: binding, InstanceServiceUUID: binding, CorePEPURL: server.URL + "/service/v1/adapter/pep_check",
				OIDCTokenURL: server.URL + "/token", ClientID: "binding", ClientSecretFile: secret, RequestTimeout: "1s", MaxResponseBytes: 8192, ClientSecretMaxBytes: 128},
				TenantID: binding, NativeRootRef: binding, NativeScopeRef: binding, NativeInstanceRef: "native-instance"}
			links, _ := json.Marshal(map[string]interface{}{"actors": []map[string]interface{}{{"principalId": actor, "kind": "HUMAN", "userUuid": nativeUser}},
				"read": map[string]interface{}{"human": map[string]interface{}{"actions": map[string]interface{}{"file_storage.export@v1": map[string]interface{}{"actionVersion": 1, "nativeType": "folder", "resultExposurePolicyId": resourceID, "resultExposurePolicyVersion": 1}}}}})
			if err := json.Unmarshal(links, &d); err != nil {
				t.Fatal(err)
			}
			user := nativeUser
			if scenario == "foreign-user" {
				user = node
			}
			ctx := claim.ToContext(context.Background(), claim.Claims{Subject: user})
			ctx = context.WithValue(ctx, nativeHumanReadContextKey{}, &nativeHumanReadIntent{delivery: d, token: "human", key: requestKey, action: "file_storage.export@v1", revision: "fixed"})
			read, err := AdmitNativeHumanRead(ctx, node, "fixed", "file", "text/plain")
			if scenario == "allowed" {
				if err != nil || read == nil || !read.IsHumanSynchronous() || strings.Join(calls, ",") != "resolve,admit,pep" {
					t.Fatalf("original chain did not admit: %v %v", calls, err)
				}
			} else if err == nil || read != nil {
				t.Fatalf("accepted %s", scenario)
			}
		})
	}
}

func TestNativeHumanReadCompletionKeepsServiceReceiptAndHumanDisclosureSeparate(t *testing.T) {
	const binding = "00000000-0000-4000-8000-000000000001"
	const operation = "00000000-0000-4000-8000-000000000002"
	const key = "00000000-0000-4000-8000-000000000003"
	input := map[string]interface{}{"resourceId": binding, "nativeObjectRef": key, "nativeRevision": "fixed", "displayName": "file", "mediaType": "text/plain"}
	for _, scenario := range []string{"complete", "meter-pending", "meter-timeout", "receipt-rejected", "wrong-operation", "wrong-digest", "extra-receipt-field", "revoked-human", "pending", "foreign-input", "reissued-ticket"} {
		t.Run(scenario, func(t *testing.T) {
			receipts, observations := 0, 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "service", "token_type": "Bearer", "expires_in": 60})
					return
				}
				var raw map[string]interface{}
				if r.URL.Path != "/service/v1/adapter/human-action" || r.Header.Get("Authorization") != "Bearer service" || json.NewDecoder(r.Body).Decode(&raw) != nil || raw["bindingId"] != binding {
					t.Error("existing private binding transport bypassed")
				}
				if _, ok := raw["readReceipt"]; ok {
					receipts++
					if observations != 0 || r.Header.Get("X-Kailo-Native-Human-Token") != "" {
						t.Error("receipt incorrectly requires renewed HUMAN access")
					}
					if scenario == "receipt-rejected" {
						w.WriteHeader(http.StatusForbidden)
						return
					}
					if scenario == "meter-timeout" || (scenario == "meter-pending" && receipts == 1) {
						w.WriteHeader(http.StatusServiceUnavailable)
						return
					}
					digest, err := humanReadReceiptDigest(raw["readReceipt"].(map[string]interface{}))
					if err != nil {
						t.Error(err)
						return
					}
					answer := map[string]interface{}{"operationId": operation, "receiptDigest": digest}
					if scenario == "wrong-digest" {
						answer["receiptDigest"] = strings.Repeat("a", 64)
					}
					if scenario == "wrong-operation" {
						answer["operationId"] = key
					}
					if scenario == "extra-receipt-field" {
						answer["body"] = "must not be accepted"
					}
					json.NewEncoder(w).Encode(answer)
					return
				}
				observations++
				if receipts < 1 || raw["idempotencyKey"] != key || r.Header.Get("X-Kailo-Native-Human-Token") != "human" {
					t.Error("disclosure did not recheck original HUMAN after receipt")
				}
				if scenario == "revoked-human" {
					w.WriteHeader(http.StatusForbidden)
					return
				}
				answer := map[string]interface{}{"terminalStatus": "COMPLETED", "inputReference": input}
				if scenario == "pending" {
					delete(answer, "terminalStatus")
				}
				if scenario == "foreign-input" {
					answer["inputReference"] = map[string]interface{}{"nativeRevision": "new head"}
				}
				if scenario == "reissued-ticket" {
					answer["readAdmission"] = map[string]interface{}{"actionToken": "unexpected"}
				}
				json.NewEncoder(w).Encode(answer)
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			read := &NativeReadExecution{Delivery: NativeActorDelivery{Delivery: protocol.Delivery{BindingID: binding, InstanceServiceUUID: binding,
				CorePEPURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/token", ClientID: "binding", ClientSecretFile: secret,
				RequestTimeout: "100ms", MaxResponseBytes: 4096, ClientSecretMaxBytes: 128}, Read: &NativeReadDelivery{Human: &NativeHumanReadDelivery{ReceiptPollInterval: "10ms"}}}, Claims: map[string]interface{}{"operation_id": operation},
				Input: input, Key: key, humanToken: "human"}
			err := read.CompleteHumanRead(context.Background(), map[string]interface{}{"operationId": operation})
			if (scenario == "complete" || scenario == "meter-pending") != (err == nil) {
				t.Fatalf("completion %s got %v", scenario, err)
			}
			if scenario == "meter-pending" {
				if receipts != 2 || observations != 1 {
					t.Fatal("pending original metering did not settle before disclosure")
				}
			} else if scenario == "meter-timeout" {
				if observations != 0 {
					t.Fatal("unsettled usage exposed body")
				}
			} else if receipts != 1 {
				t.Fatal("original receipt was not recorded exactly once")
			}
			if (scenario == "receipt-rejected" || scenario == "wrong-operation" || scenario == "wrong-digest" || scenario == "extra-receipt-field") && observations != 0 {
				t.Fatal("disclosure checked despite invalid receipt")
			}
		})
	}
}

func TestNativeHumanReadReceiptDigestMatchesCoreUTF8CanonicalIntegers(t *testing.T) {
	receipt := map[string]interface{}{
		"nativeRevision": "<&>\u2028\u2029\\u2028",
		"contentBytes":   int64(9007199254740993),
		"measurements": []struct {
			Quantity int64  `json:"quantity"`
			MeterKey string `json:"meterKey"`
		}{{9007199254740993, "bytes"}},
	}
	// Explicit Core sorted JSON bytes, not the function under test as oracle.
	canonical := "{\"contentBytes\":9007199254740993,\"measurements\":[{\"meterKey\":\"bytes\",\"quantity\":9007199254740993}],\"nativeRevision\":\"<&>\u2028\u2029\\\\u2028\"}"
	want := sha256.Sum256([]byte(canonical))
	got, err := humanReadReceiptDigest(receipt)
	if err != nil || got != hex.EncodeToString(want[:]) {
		t.Fatalf("Core canonical digest mismatch: got %s, error %v", got, err)
	}
}
