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

func TestNativeHumanActionUsesOriginalPrivateTransport(t *testing.T) {
	const binding = "00000000-0000-4000-8000-000000000001"
	const key = "00000000-0000-4000-8000-000000000002"
	for _, scenario := range []string{"observe", "absent", "command", "resource", "denied", "unavailable", "redirect", "malformed", "trailing", "oversized", "ambiguous-intent", "wrong-key"} {
		t.Run(scenario, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.URL.Path == "/token" {
					user, secret, ok := r.BasicAuth()
					if !ok || user != "binding-client" || secret != "fixture-only" || r.Header.Get("X-Kailo-Native-Human-Token") != "" {
						t.Error("binding identity transport mixed HUMAN and SERVICE credentials")
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "service-only", "token_type": "Bearer", "expires_in": 60})
					return
				}
				calls++
				var request map[string]interface{}
				if r.URL.Path != "/service/v1/adapter/human-action" || r.Method != http.MethodPost ||
					r.Header.Get("Authorization") != "Bearer service-only" || r.Header.Get("X-Kailo-Native-Human-Token") != "real-human-access-proof" ||
					json.NewDecoder(r.Body).Decode(&request) != nil || len(request) != 2 || request["bindingId"] != binding {
					t.Error("original binding/HUMAN authenticated consumer was bypassed")
				}
				switch scenario {
				case "absent":
					w.WriteHeader(http.StatusNotFound)
				case "denied":
					w.WriteHeader(http.StatusForbidden)
				case "unavailable":
					w.WriteHeader(http.StatusServiceUnavailable)
				case "redirect":
					http.Redirect(w, r, "/disclose", http.StatusTemporaryRedirect)
					return
				case "malformed":
					_, _ = w.Write([]byte("{"))
					return
				case "trailing":
					_, _ = w.Write([]byte(`{} {"credential":"must-not-disclose"}`))
					return
				case "oversized":
					_, _ = w.Write([]byte(strings.Repeat(" ", 4097)))
					return
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"submission": map[string]any{"operationId": key}})
			}))
			defer server.Close()
			secret := filepath.Join(t.TempDir(), "client-secret")
			if err := os.WriteFile(secret, []byte("fixture-only"), 0600); err != nil {
				t.Fatal(err)
			}
			d := Delivery{BindingID: binding, InstanceServiceUUID: key, CorePEPURL: server.URL + "/service/v1/adapter/pep_check",
				OIDCTokenURL: server.URL + "/token", ClientID: "binding-client", ClientSecretFile: secret,
				RequestTimeout: "1s", MaxResponseBytes: 4096, ClientSecretMaxBytes: 128}
			intent := map[string]interface{}{"idempotencyKey": key}
			switch scenario {
			case "command":
				intent = map[string]interface{}{"command": map[string]interface{}{"idempotencyKey": key}}
			case "resource":
				intent = map[string]interface{}{"resolveResource": map[string]interface{}{"nativeRef": key}}
			case "ambiguous-intent":
				intent["command"] = map[string]interface{}{}
			case "wrong-key":
				intent["idempotencyKey"] = "another-request"
			}
			answer, exists, err := d.HumanAction(context.Background(), "real-human-access-proof", intent)
			if scenario == "ambiguous-intent" || scenario == "wrong-key" {
				if calls != 0 || err == nil || exists || answer != nil {
					t.Fatal("invalid intent reached an authority")
				}
				return
			}
			if calls != 1 {
				t.Fatalf("original intent was replayed or not sent: %d", calls)
			}
			if scenario == "absent" {
				if err != nil || exists || answer != nil {
					t.Fatal("authoritative absent AE was conflated with unavailable")
				}
			} else if scenario == "observe" || scenario == "command" || scenario == "resource" {
				if err != nil || !exists || answer == nil {
					t.Fatalf("exact original result was refused: %v", err)
				}
			} else if err == nil || exists || answer != nil || strings.Contains(err.Error(), "must-not-disclose") {
				t.Fatal("uncertain/refused authority result authorized replay or leaked details")
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
