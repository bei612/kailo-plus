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
	NewModelCredentialsHandler(s).Put(c)
	return c, w
}

func TestModelCredentialsDeliveryUsesStoredTenantModelNonce(t *testing.T) {
	nonce := strings.Repeat("a1", 32)
	s := &deliveryModelService{model: &types.Model{ID: "native-model", TenantID: 42}}
	s.model.Parameters.APIKey = "isolated-fixture-value"
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
	proof, err := hex.DecodeString(response.Data.APIKeyProof)
	if err != nil {
		t.Fatal(err)
	}
	for _, scope := range []struct {
		key, tenant, model, nonce string
		valid                     bool
	}{
		{"isolated-fixture-value", "42", "native-model", nonce, true},
		{"wrong-fixture-value", "42", "native-model", nonce, false},
		{"isolated-fixture-value", "43", "native-model", nonce, false},
		{"isolated-fixture-value", "42", "another-model", nonce, false},
		{"isolated-fixture-value", "42", "native-model", strings.Repeat("b2", 32), false},
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
	for _, m := range []*types.Model{{ID: "native-model", TenantID: 43}, {ID: "other", TenantID: 42}, {ID: "native-model", TenantID: 42, IsBuiltin: true}} {
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
}
