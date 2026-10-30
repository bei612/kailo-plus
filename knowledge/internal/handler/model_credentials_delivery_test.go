package handler

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
	"github.com/gin-gonic/gin"
)

// Reuse the native service interface; the real handler must read the model and
// never write for a challenge. Unimplemented interface methods fail the test.
type deliveryModelService struct {
	interfaces.ModelService
	model  *types.Model
	reads  int
	writes int
}

func (s *deliveryModelService) GetModelByID(context.Context, string) (*types.Model, error) {
	s.reads++
	return s.model, nil
}

func (s *deliveryModelService) UpdateModelCredentials(_ context.Context, _ string, key, app *string) (*types.Model, error) {
	s.writes++
	if key != nil {
		s.model.Parameters.APIKey = *key
	}
	if app != nil {
		s.model.Parameters.AppSecret = *app
	}
	return s.model, nil
}

func credentialPut(s *deliveryModelService, body string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("PUT", "/models/native-model/credentials", strings.NewReader(body))
	c.Params = gin.Params{{Key: "id", Value: "native-model"}}
	c.Set(types.TenantIDContextKey.String(), uint64(42))
	NewModelCredentialsHandler(s, nil).Put(c)
	return c, w
}

func kailoCredentialPut(s *deliveryModelService, body string) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("PUT", "/models/native-model/credentials", strings.NewReader(body))
	c.Params = gin.Params{{Key: "id", Value: "native-model"}}
	c.Set(types.TenantIDContextKey.String(), uint64(42))
	cfg := &config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true}}
	NewModelCredentialsHandler(s, cfg).Put(c)
	return c, w
}

// DD-138(6): in Kailo mode only a Kailo-routed model's credential may be
// written (the DD-128 delivery); every other model is refused with 403.
func TestModelCredentialsKailoModeWritesOnlyRoutedModels(t *testing.T) {
	routed := &deliveryModelService{model: &types.Model{ID: "native-model", TenantID: 42,
		ManagedBy: "kailo-model-route", PlatformScopeRef: "77777777-7777-4777-8777-777777777777"}}
	c, _ := kailoCredentialPut(routed, `{"api_key":"fixture-delivered"}`)
	if len(c.Errors) > 0 || routed.writes != 1 || routed.model.Parameters.APIKey != "fixture-delivered" {
		t.Fatal("Kailo-routed model delivery must still write", c.Errors)
	}
	nonce := strings.Repeat("a1", 32)
	c, w := kailoCredentialPut(routed, `{"verification_nonce":"`+nonce+`"}`)
	if len(c.Errors) > 0 || routed.writes != 1 || !strings.Contains(w.Body.String(), "api_key_proof") {
		t.Fatal("Kailo-routed read-back must stay available without writing", c.Errors)
	}

	for _, m := range []*types.Model{
		{ID: "native-model", TenantID: 42},
		{ID: "native-model", TenantID: 42, ManagedBy: "yaml", IsBuiltin: true},
	} {
		s := &deliveryModelService{model: m}
		c, w := kailoCredentialPut(s, `{"api_key":"fixture-other"}`)
		if s.writes != 0 || w.Code != 403 || !strings.Contains(w.Body.String(), "KAILO_MANAGED") || !c.IsAborted() {
			t.Fatalf("Kailo mode wrote a non-routed model credential: code=%d body=%s", w.Code, w.Body.String())
		}
	}
	foreign := &deliveryModelService{model: &types.Model{ID: "native-model", TenantID: 43, ManagedBy: "kailo-model-route"}}
	c, _ = kailoCredentialPut(foreign, `{"api_key":"fixture-other"}`)
	if foreign.writes != 0 || len(c.Errors) == 0 {
		t.Fatal("Kailo mode wrote another workspace's model credential")
	}
}

func TestModelCredentialsDeliveryUsesStoredTenantModelNonce(t *testing.T) {
	nonce := strings.Repeat("a1", 32)
	s := &deliveryModelService{model: &types.Model{ID: "native-model", TenantID: 42}}
	s.model.Parameters.APIKey = "isolated-fixture-value"
	s.model.ManagedBy = "kailo-model-route"
	s.model.PlatformScopeRef = "77777777-7777-4777-8777-777777777777"
	c, w := credentialPut(s, `{"verification_nonce":"`+nonce+`"}`)
	if len(c.Errors) > 0 || s.reads != 1 || s.writes != 0 {
		t.Fatal("challenge must read once without writing", c.Errors)
	}
	var response struct {
		Data modelCredentialsResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.VerificationNonce != nonce || strings.Contains(w.Body.String(), s.model.Parameters.APIKey) {
		t.Fatal("response must echo only the nonce and scoped proof")
	}
	if response.Data.ManagedBy != s.model.ManagedBy {
		t.Fatal("delivery must read back the persisted native ownership")
	}
	proof, err := hex.DecodeString(response.Data.APIKeyProof)
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range []struct {
		key, tenant, model, nonce string
		valid                     bool
	}{
		{"isolated-fixture-value", s.model.PlatformScopeRef, "native-model", nonce, true},
		{"wrong-fixture-value", s.model.PlatformScopeRef, "native-model", nonce, false},
		{"isolated-fixture-value", "42", "native-model", nonce, false},
		{"isolated-fixture-value", "43", "native-model", nonce, false},
		{"isolated-fixture-value", s.model.PlatformScopeRef, "another-model", nonce, false},
		{"isolated-fixture-value", s.model.PlatformScopeRef, "native-model", strings.Repeat("b2", 32), false},
	} {
		mac := hmac.New(sha256.New, []byte(scope.key))
		_, _ = mac.Write([]byte("application-model-key:v1\x00" + scope.tenant + "\x00" + scope.model + "\x00" + scope.nonce))
		if hmac.Equal(proof, mac.Sum(nil)) != scope.valid {
			t.Fatal("proof accepted changed scope/value/nonce")
		}
	}
}

func TestModelCredentialsDeliveryRejectsUnknownMixedOrForeign(t *testing.T) {
	for _, body := range []string{
		`{"verification_nonce":"short"}`,
		`{"verification_nonce":"` + strings.Repeat("AA", 32) + `"}`,
		`{"verification_nonce":"` + strings.Repeat("aa", 32) + `","api_key":"fixture"}`,
		`{"verification_nonce":"` + strings.Repeat("aa", 32) + `","tenant_id":42}`,
		`{"unknown":true}`, `{}` + `{}`,
	} {
		s := &deliveryModelService{model: &types.Model{ID: "native-model", TenantID: 42}}
		c, _ := credentialPut(s, body)
		if len(c.Errors) == 0 || s.reads != 0 || s.writes != 0 {
			t.Fatal("invalid request reached native service", body)
		}
	}
	for _, m := range []*types.Model{{ID: "native-model", TenantID: 43}, {ID: "other", TenantID: 42}, {ID: "native-model", TenantID: 42, IsBuiltin: true},
		{ID: "native-model", TenantID: 42, ManagedBy: "kailo-model-route"},
		{ID: "native-model", TenantID: 42, ManagedBy: "kailo-model-route", PlatformScopeRef: "42"}} {
		s := &deliveryModelService{model: m}
		c, w := credentialPut(s, `{"verification_nonce":"`+strings.Repeat("aa", 32)+`"}`)
		if len(c.Errors) == 0 || s.writes != 0 || strings.Contains(w.Body.String(), "api_key_proof") {
			t.Fatal("foreign model produced a proof")
		}
	}
}

func TestModelCredentialsDeliveryPreservesLegacyEmptyAndWrite(t *testing.T) {
	s := &deliveryModelService{model: &types.Model{ID: "native-model", TenantID: 42}}
	c, w := credentialPut(s, `{}`)
	if len(c.Errors) > 0 || strings.Contains(w.Body.String(), "api_key_proof") || strings.Contains(w.Body.String(), "verification_nonce") {
		t.Fatal("legacy configured response changed")
	}
	c, w = credentialPut(s, `{"api_key":"fixture-updated"}`)
	if len(c.Errors) > 0 || s.writes != 1 || s.model.Parameters.APIKey != "fixture-updated" || strings.Contains(w.Body.String(), "fixture-updated") {
		t.Fatal("legacy credential update failed or disclosed its value")
	}
	nonce := strings.Repeat("a1", 32)
	c, w = credentialPut(s, `{"verification_nonce":"`+nonce+`"}`)
	if len(c.Errors) > 0 {
		t.Fatal(c.Errors)
	}
	var response struct {
		Data modelCredentialsResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, []byte("fixture-updated"))
	_, _ = mac.Write([]byte("application-model-key:v1\x0042\x00native-model\x00" + nonce))
	if response.Data.APIKeyProof != hex.EncodeToString(mac.Sum(nil)) {
		t.Fatal("independent native tenant proof changed")
	}
}
