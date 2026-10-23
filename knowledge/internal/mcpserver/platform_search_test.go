package mcpserver

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/require"
)

// DD-138(5), 07 §4.8.4: the bound native endpoint verifies Core's Search
// Token itself; no PEP call is made and only read-only tools are admitted.

type searchFixture struct {
	*nativeBindingFixture
	key       *ecdsa.PrivateKey
	kid       string
	arguments string
	claims    map[string]any
}

func newSearchFixture(t *testing.T) *searchFixture {
	t.Helper()
	f := &searchFixture{nativeBindingFixture: newNativeBindingFixture(t), kid: "core-search-1"}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	f.key = key
	jwks := map[string]any{"keys": []map[string]any{{"kty": "EC", "crv": "P-256", "kid": f.kid, "alg": "ES256", "use": "sig",
		"x": base64.RawURLEncoding.EncodeToString(key.PublicKey.X.FillBytes(make([]byte, 32))),
		"y": base64.RawURLEncoding.EncodeToString(key.PublicKey.Y.FillBytes(make([]byte, 32)))}}}
	raw, err := json.Marshal(jwks)
	require.NoError(t, err)
	jwksFile := filepath.Join(t.TempDir(), "jwks.json")
	require.NoError(t, os.WriteFile(jwksFile, raw, 0o600))
	f.config["actionTokenIssuer"] = "https://core.kailo.example"
	f.config["actionTokenAudience"] = "kailo-adapter-knowledge"
	f.config["actionTokenJwksFile"] = jwksFile
	f.writeConfig(t)
	kb := f.config["nativeKnowledgeBaseId"].(string)
	f.arguments = `{"idempotencyKey":"` + uuid.NewString() + `","limit":5,"locale":"EN","query":"travel policy",` +
		`"resources":[{"nativeId":"` + kb + `","nativeType":"knowledge_base","resourceId":"` + uuid.NewString() + `"}]}`
	now := time.Now().Unix()
	digest := sha256.Sum256([]byte(f.arguments))
	f.claims = map[string]any{"iss": "https://core.kailo.example", "aud": "kailo-adapter-knowledge",
		"iat": now - 1, "exp": now + 59, "jti": uuid.NewString(), "token_use": "COMPONENT_SEARCH",
		"tenant_id": f.config["tenantId"], "binding_id": f.config["bindingId"], "actor_principal_id": uuid.NewString(),
		"projection_generation": 3, "authorization_min_zed_token": "zed",
		"normalized_parameter_hash": hex.EncodeToString(digest[:])}
	return f
}

func (f *searchFixture) token(t *testing.T) string {
	t.Helper()
	header, err := json.Marshal(map[string]string{"alg": "ES256", "kid": f.kid, "typ": "JWT"})
	require.NoError(t, err)
	payload, err := json.Marshal(f.claims)
	require.NoError(t, err)
	signing := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(signing))
	r, s, err := ecdsa.Sign(rand.Reader, f.key, digest[:])
	require.NoError(t, err)
	signature := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	return signing + "." + base64.RawURLEncoding.EncodeToString(signature)
}

func (f *searchFixture) request(t *testing.T, tool string, args map[string]any) mcp.CallToolRequest {
	t.Helper()
	proof, err := json.Marshal(map[string]string{"actionToken": f.token(t), "argumentsJson": f.arguments, "operation": "search"})
	require.NoError(t, err)
	request := nativeToolRequest(t, args)
	request.Params.Name = tool
	request.Header = http.Header{}
	request.Header.Set(nativeActionProofHeader, base64.RawURLEncoding.EncodeToString(proof))
	return request
}

func TestNativeSearchTokenAdmitsOnlyReadOnlyToolsOnTheBoundKnowledgeBase(t *testing.T) {
	f := newSearchFixture(t)
	kb := f.config["nativeKnowledgeBaseId"].(string)
	for _, req := range []mcp.CallToolRequest{
		f.request(t, types.MCPEndpointToolSearchKnowledge, map[string]any{"query": "travel policy", "knowledge_base_ids": []string{kb}}),
		f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": uuid.NewString(), "metadata_only": true}),
		f.request(t, types.MCPEndpointToolListKnowledgeBases, map[string]any{}),
	} {
		ctx, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
		require.NoError(t, err, req.Params.Name)
		_, err = endpointFromContext(ctx)
		require.NoError(t, err)
	}
	require.Zero(t, f.peps, "search makes no Core PEP call")
	for name, req := range map[string]mcp.CallToolRequest{
		"other query":    f.request(t, types.MCPEndpointToolSearchKnowledge, map[string]any{"query": "salaries", "knowledge_base_ids": []string{kb}}),
		"other kb":       f.request(t, types.MCPEndpointToolSearchKnowledge, map[string]any{"query": "travel policy", "knowledge_base_ids": []string{uuid.NewString()}}),
		"full read":      f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": uuid.NewString()}),
		"export":         f.request(t, types.MCPEndpointToolExportDocument, map[string]any{"knowledge_id": uuid.NewString()}),
		"delete":         f.request(t, types.MCPEndpointToolDeleteDocument, map[string]any{"knowledge_id": uuid.NewString()}),
		"add":            f.request(t, types.MCPEndpointToolAddDocument, map[string]any{"knowledge_base_id": kb}),
		"no kb selected": f.request(t, types.MCPEndpointToolSearchKnowledge, map[string]any{"query": "travel policy"}),
	} {
		_, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
		require.Error(t, err, name)
	}
}

func TestNativeSearchTokenRejectsForeignOrAlteredTokens(t *testing.T) {
	for _, change := range []string{"binding", "tenant", "token_use", "hash", "lifetime", "expired", "audience",
		"issuer", "action", "resources", "signature"} {
		t.Run(change, func(t *testing.T) {
			f := newSearchFixture(t)
			kb := f.config["nativeKnowledgeBaseId"].(string)
			now := time.Now().Unix()
			switch change {
			case "binding":
				f.claims["binding_id"] = uuid.NewString()
			case "tenant":
				f.claims["tenant_id"] = uuid.NewString()
			case "token_use":
				f.claims["token_use"] = "ACTION"
			case "hash":
				f.arguments = f.arguments[:len(f.arguments)-1] + " }"
			case "lifetime":
				f.claims["iat"], f.claims["exp"] = now-1, now+120
			case "expired":
				f.claims["iat"], f.claims["exp"] = now-90, now-30
			case "audience":
				f.claims["aud"] = "kailo-adapter-other"
			case "issuer":
				f.claims["iss"] = "https://other.example"
			case "action":
				f.claims["action_key"] = "knowledge.delete@v3"
			case "resources":
				f.arguments = `{"query":"travel policy","resources":[{"nativeId":"` + uuid.NewString() + `"}]}`
				digest := sha256.Sum256([]byte(f.arguments))
				f.claims["normalized_parameter_hash"] = hex.EncodeToString(digest[:])
			case "signature":
				other, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
				require.NoError(t, err)
				f.key = other
			}
			req := f.request(t, types.MCPEndpointToolSearchKnowledge, map[string]any{"query": "travel policy", "knowledge_base_ids": []string{kb}})
			_, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
			require.Error(t, err)
			require.Zero(t, f.peps)
		})
	}
}
