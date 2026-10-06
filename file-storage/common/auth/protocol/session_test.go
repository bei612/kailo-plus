package protocol

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

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
