package protocol

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAuthorizeActionUsesOriginalBindingPEP(t *testing.T) {
	ids := []string{"00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002",
		"00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004"}
	for _, scenario := range []string{"allowed", "denied", "unknown-field", "wrong-ae", "wrong-operation", "wrong-resource", "missing-target", "empty-zed"} {
		t.Run(scenario, func(t *testing.T) {
			payload, _ := json.Marshal(map[string]interface{}{"action_execution_id": ids[1], "operation_id": ids[2],
				"target_type": "RESOURCE", "target_id": ids[3]})
			token := "fixture." + base64.RawURLEncoding.EncodeToString(payload) + ".fixture"
			arguments := `{"input":{"resourceId":"` + ids[3] + `"},"target":{"resourceId":"` + ids[3] + `"}}`
			peps := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					_ = json.NewEncoder(w).Encode(map[string]interface{}{"access_token": "fixture-only", "token_type": "Bearer", "expires_in": 60})
					return
				}
				peps++
				var request map[string]interface{}
				if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer fixture-only" ||
					json.NewDecoder(r.Body).Decode(&request) != nil || len(request) != 4 || request["bindingId"] != ids[0] ||
					request["actionToken"] != token || request["argumentsJson"] != arguments || request["operation"] != "execute" {
					t.Error("original authenticated token/arguments consumer was not used")
				}
				result := map[string]interface{}{"actionExecutionId": ids[1], "operationId": ids[2], "authorizationMinZedToken": "fresh",
					"targetResource": map[string]interface{}{"resourceId": ids[3], "nativeRef": ids[0], "nativeType": "folder",
						"nativeInstanceRef": "fixture-instance", "nativeScopeRef": ids[1]}}
				switch scenario {
				case "denied":
					w.WriteHeader(http.StatusForbidden)
				case "unknown-field":
					result["secret"] = "must-not-disclose"
				case "wrong-ae":
					result["actionExecutionId"] = ids[0]
				case "wrong-operation":
					result["operationId"] = ids[0]
				case "wrong-resource":
					result["targetResource"].(map[string]interface{})["resourceId"] = ids[0]
				case "missing-target":
					delete(result, "targetResource")
				case "empty-zed":
					result["authorizationMinZedToken"] = ""
				}
				_ = json.NewEncoder(w).Encode(result)
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			delivery := Delivery{BindingID: ids[0], InstanceServiceUUID: ids[1], CorePEPURL: server.URL + "/service/v1/adapter/pep_check",
				OIDCTokenURL: server.URL + "/token", ClientID: "fixture", ClientSecretFile: secret, RequestTimeout: "1s", MaxResponseBytes: 4096, ClientSecretMaxBytes: 128}
			claims, target, err := delivery.AuthorizeAction(context.Background(), token, arguments)
			if peps != 1 {
				t.Fatal("fresh original PEP was not called exactly once")
			}
			if scenario == "allowed" {
				if err != nil || claims["target_id"] != ids[3] || target["nativeRef"] != ids[0] {
					t.Fatalf("exact authoritative facts were refused: %v", err)
				}
			} else if err == nil || claims != nil || target != nil || strings.Contains(err.Error(), "must-not-disclose") {
				t.Fatalf("unknown/foreign authority result was disclosed: %v", err)
			}
		})
	}
}

func TestResolveRequiresOriginalHostOrigin(t *testing.T) {
	for _, origin := range []string{"https://platform.example", "http://192.168.0.193:8080", "", "*", "https://platform.example/path", "https://user@platform.example", "https://platform.example?origin=other"} {
		t.Run(origin, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "fixture-only", "token_type": "Bearer", "expires_in": 60})
					return
				}
				if r.URL.Path != "/service/v1/adapter/pep_check" || r.Header.Get("Authorization") != "Bearer fixture-only" {
					t.Error("original authenticated PEP route was not used")
					w.WriteHeader(http.StatusForbidden)
					return
				}
				_ = json.NewEncoder(w).Encode(Facts{Decision: "ALLOW", PlatformHumanID: "00000000-0000-4000-8000-000000000003",
					OIDCIssuer: "https://idp.example/realm", OIDCSubject: "original-human", DisplayName: "Original Human",
					AdmittedMode: "EDIT", MinZedToken: "original", BaseRevision: "exact-native-version", ExpiresAt: time.Now().Add(time.Minute),
					PostMessageOrigin: origin})
			}))
			defer server.Close()
			secretFile := filepath.Join(t.TempDir(), "secret")
			if err := os.WriteFile(secretFile, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			delivery := Delivery{BindingID: "00000000-0000-4000-8000-000000000001", InstanceServiceUUID: "00000000-0000-4000-8000-000000000002",
				CorePEPURL: server.URL + "/service/v1/adapter/pep_check", OIDCTokenURL: server.URL + "/token", ClientID: "fixture-client",
				ClientSecretFile: secretFile, RequestTimeout: "1s", MaxResponseBytes: 4096, ClientSecretMaxBytes: 128}
			facts, err := delivery.Resolve(context.Background(), "00000000-0000-4000-8000-000000000004", "00000000-0000-4000-8000-000000000005", "READ")
			allowed := origin == "https://platform.example" || origin == "http://192.168.0.193:8080"
			if allowed {
				if err != nil || facts.PostMessageOrigin != origin {
					t.Fatalf("controlled original host refused: %v", err)
				}
			} else if err == nil || facts != nil {
				t.Fatal("missing or caller-shaped origin was allowed")
			}
		})
	}
}
