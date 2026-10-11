package mcpserver

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
	"testing"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/ratelimit"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type nativeBindingFixture struct {
	server     *Server
	ep         *types.MCPEndpoint
	claims     map[string]any
	arguments  map[string]any
	operation  string
	config     map[string]any
	configFile string
	peps       int
	deny       bool
	foreign    bool
}

func newNativeBindingFixture(t *testing.T) *nativeBindingFixture {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	require.NoError(t, db.AutoMigrate(&types.MCPEndpoint{}))
	f := &nativeBindingFixture{operation: "query_revision"}
	kb := uuid.NewString()
	f.ep = &types.MCPEndpoint{ID: uuid.NewString(), TenantID: 17, Enabled: true, KnowledgeBaseIDs: types.StringArray{kb},
		Tools: types.StringArray{types.MCPEndpointToolReadDocument, types.MCPEndpointToolSearchKnowledge, types.MCPEndpointToolExportDocument,
			types.MCPEndpointToolAddDocument, types.MCPEndpointToolDeleteDocument, types.MCPEndpointToolUpdateDocument, types.MCPEndpointToolListKnowledgeBases}}
	credential := uuid.NewString()
	digest := sha256.Sum256([]byte(credential))
	f.ep.TokenHash = hex.EncodeToString(digest[:])
	require.NoError(t, db.Create(f.ep).Error)
	f.arguments = map[string]any{"authorizationTargetNativeRef": kb, "nativeObjectRef": uuid.NewString(), "idempotencyKey": uuid.NewString()}
	f.claims = map[string]any{"tenant_id": uuid.NewString(), "action_execution_id": uuid.NewString(),
		"operation_id": uuid.NewString(), "action_key": "knowledge.read@v2", "target_id": uuid.NewString()}
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/token" {
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "fixture-service-identity", "token_type": "Bearer"})
			return
		}
		require.Equal(t, "/service/v1/adapter/pep_check", r.URL.Path)
		require.Equal(t, "Bearer fixture-service-identity", r.Header.Get("Authorization"))
		var proof map[string]string
		require.NoError(t, json.NewDecoder(r.Body).Decode(&proof))
		require.Equal(t, f.config["bindingId"], proof["bindingId"])
		require.Equal(t, f.operation, proof["operation"])
		var args map[string]any
		require.NoError(t, json.Unmarshal([]byte(proof["argumentsJson"]), &args))
		require.Equal(t, f.arguments, args)
		f.peps++
		if f.deny {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		op := f.claims["operation_id"]
		if f.foreign {
			op = uuid.NewString()
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"actionExecutionId": f.claims["action_execution_id"],
			"operationId": op, "authorizationMinZedToken": "fresh",
			"bindingGeneration": 9,
			"targetResource":    map[string]any{"resourceId": f.claims["target_id"], "nativeRef": kb, "nativeScopeRef": kb}})
	}))
	t.Cleanup(core.Close)
	dir := t.TempDir()
	nativeFile, serviceFile := filepath.Join(dir, "native"), filepath.Join(dir, "service")
	require.NoError(t, os.WriteFile(nativeFile, []byte(credential), 0600))
	require.NoError(t, os.WriteFile(serviceFile, []byte(uuid.NewString()), 0600))
	f.config = map[string]any{"bindingId": uuid.NewString(), "tenantId": f.claims["tenant_id"],
		"nativeKnowledgeBaseId": kb, "nativeMcpUrl": core.URL + "/mcp/" + f.ep.ID,
		"nativeMcpBearerFile": nativeFile, "oidcClientSecretFile": serviceFile, "oidcClientId": "fixture-native-pep",
		"oidcTokenUrl": core.URL + "/token", "corePepUrl": core.URL + "/service/v1/adapter/pep_check", "timeoutMs": 3000, "maxBodyBytes": 65536}
	f.configFile = filepath.Join(dir, "adapter.json")
	f.writeConfig(t)
	f.server = &Server{db: db, cfg: &config.Config{MCPAdapterConfigs: []string{f.configFile}}}
	require.NoError(t, f.server.initializeNativeBindings(context.Background()))
	return f
}

func (f *nativeBindingFixture) writeConfig(t *testing.T) {
	t.Helper()
	raw, err := json.Marshal(f.config)
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(f.configFile, raw, 0600))
}

func (f *nativeBindingFixture) request(t *testing.T, tool string, args map[string]any) mcp.CallToolRequest {
	t.Helper()
	claims, err := json.Marshal(f.claims)
	require.NoError(t, err)
	arguments, err := json.Marshal(f.arguments)
	require.NoError(t, err)
	proof, err := json.Marshal(map[string]string{"actionToken": "fixture." + base64.RawURLEncoding.EncodeToString(claims) + ".signature",
		"argumentsJson": string(arguments), "operation": f.operation})
	require.NoError(t, err)
	request := nativeToolRequest(t, args)
	request.Params.Name = tool
	request.Header = http.Header{nativeActionProofHeader: []string{base64.RawURLEncoding.EncodeToString(proof)}}
	// Use net/http canonicalization, as the actual MCP transport does.
	request.Header.Set(nativeActionProofHeader, base64.RawURLEncoding.EncodeToString(proof))
	return request
}

func TestNativeBindingFreshAdmissionAndRetainedOwnership(t *testing.T) {
	f := newNativeBindingFixture(t)
	req := f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": f.arguments["nativeObjectRef"], "metadata_only": true})
	ctx, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
	require.NoError(t, err)
	current, err := endpointFromContext(ctx)
	require.NoError(t, err)
	require.Equal(t, f.config["bindingId"], current.PlatformBindingID)
	require.Equal(t, 1, f.peps)
	f.deny = true
	_, err = f.server.authorizeNativePlatformTool(ctx, current, req)
	require.Error(t, err, "revocation must be rechecked, not cached by native endpoint")
	f.deny = false
	f.foreign = true
	_, err = f.server.authorizeNativePlatformTool(ctx, current, req)
	require.Error(t, err, "another PEP operation cannot authorize native content")
	f.server.cfg.MCPAdapterConfigs = nil
	_, err = f.server.authorizeNativePlatformTool(ctx, f.ep, req)
	require.Error(t, err, "removed delivery must not restore bearer-only access")
}

func TestNativeBindingTokenAloneCannotAuthorizeAndIndependentEndpointUnchanged(t *testing.T) {
	f := newNativeBindingFixture(t)
	req := f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": f.arguments["nativeObjectRef"], "metadata_only": true})
	req.Header = nil
	_, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
	require.Error(t, err)
	require.Zero(t, f.peps)
	independent := &types.MCPEndpoint{ID: uuid.NewString(), TenantID: f.ep.TenantID, Enabled: true,
		TokenHash: uuid.NewString(), Tools: types.StringArray{types.MCPEndpointToolReadDocument}}
	require.NoError(t, f.server.db.Create(independent).Error)
	_, err = f.server.authorizeNativePlatformTool(context.Background(), independent, req)
	require.NoError(t, err, "independent native endpoint must retain upstream authentication")
	require.NoError(t, f.server.db.Model(&types.MCPEndpoint{}).Where("id = ?", independent.ID).UpdateColumn("token_hash", uuid.NewString()).Error)
	_, err = f.server.authorizeNativePlatformTool(context.Background(), independent, req)
	require.Error(t, err, "independent credential rotation must revoke the request's old authenticated identity")
}

func TestNativeBindingRejectsMappingDriftAndCallerSelectedDocuments(t *testing.T) {
	for _, change := range []string{"token", "scope", "binding", "duplicate", "proof-document", "proof-body"} {
		t.Run(change, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			req := f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": f.arguments["nativeObjectRef"], "metadata_only": true})
			_, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
			require.NoError(t, err)
			switch change {
			case "token":
				require.NoError(t, os.WriteFile(f.config["nativeMcpBearerFile"].(string), []byte(uuid.NewString()), 0600))
			case "scope":
				f.config["nativeKnowledgeBaseId"] = uuid.NewString()
				f.writeConfig(t)
			case "binding":
				f.config["bindingId"] = uuid.NewString()
				f.writeConfig(t)
			case "duplicate":
				f.server.cfg.MCPAdapterConfigs = append(f.server.cfg.MCPAdapterConfigs, f.configFile)
			case "proof-document":
				req.Params.Arguments = map[string]any{"knowledge_id": uuid.NewString(), "metadata_only": true}
			case "proof-body":
				req.Params.Arguments = map[string]any{"knowledge_id": f.arguments["nativeObjectRef"], "metadata_only": false}
			}
			_, err = f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
			require.Error(t, err)
		})
	}
}

func TestNativeBindingRejectsCredentialRotatedBetweenEndpointReads(t *testing.T) {
	f := newNativeBindingFixture(t)
	rotated := false
	require.NoError(t, f.server.db.Callback().Query().After("gorm:query").Register("rotate_native_credential", func(tx *gorm.DB) {
		if rotated || tx.Statement.Table != "mcp_endpoints" {
			return
		}
		rotated = true
		credential := uuid.NewString()
		digest := sha256.Sum256([]byte(credential))
		require.NoError(t, f.server.db.Model(&types.MCPEndpoint{}).Where("id = ?", f.ep.ID).
			UpdateColumn("token_hash", hex.EncodeToString(digest[:])).Error)
		require.NoError(t, os.WriteFile(f.config["nativeMcpBearerFile"].(string), []byte(credential), 0600))
	}))
	req := f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": f.arguments["nativeObjectRef"], "metadata_only": true})
	_, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
	require.True(t, rotated)
	require.Error(t, err, "matching newly rotated DB and delivery credentials cannot authorize the old request")
	require.Zero(t, f.peps)
}

func TestNativeBindingDoesNotTurnIngressAdmissionIntoDelayedWriteAuthority(t *testing.T) {
	for _, action := range []string{"ingest", "delete"} {
		t.Run(action, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			f.operation = "execute"
			f.claims["action_key"] = "knowledge." + action + "@v2"
			f.claims["idempotency_key"] = uuid.NewString()
			f.arguments = map[string]any{"target": map[string]any{"resourceId": f.claims["target_id"]}, "input": map[string]any{}}
			tool := types.MCPEndpointToolAddDocument
			if action == "delete" {
				tool = types.MCPEndpointToolDeleteDocument
			}
			req := f.request(t, tool, map[string]any{"knowledge_base_id": f.config["nativeKnowledgeBaseId"], "idempotency_key": f.claims["idempotency_key"]})
			_, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
			require.ErrorContains(t, err, "delayed execution")
			require.Equal(t, 1, f.peps, "the rejection is not evidence that ingress PEP failed")
		})
	}
}

func TestNativeBindingGuardDiscardsResultsAfterRevocation(t *testing.T) {
	f := newNativeBindingFixture(t)
	f.server.limiter = ratelimit.New(nil, "native-binding-fixture:", time.Minute, "")
	f.ep.Tools = types.StringArray{types.MCPEndpointToolReadDocument}
	req := f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": f.arguments["nativeObjectRef"], "metadata_only": true})
	called := false
	guarded := f.server.guardTool(func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		called = true
		f.deny = true
		return &mcp.CallToolResult{StructuredContent: map[string]string{"native": "not disclosed after revocation"}}, nil
	})
	result, err := guarded(context.WithValue(context.Background(), types.MCPEndpointContextKey, f.ep), req)
	require.NoError(t, err)
	require.True(t, called)
	require.True(t, result.IsError)
	require.Nil(t, result.StructuredContent)
	require.Equal(t, 2, f.peps)
}

func TestNativeBindingReadKeepsOriginalDocumentScopeAndRevision(t *testing.T) {
	f := newNativeBindingFixture(t)
	id := uuid.NewString()
	at := time.Now().UTC()
	kb := &types.KnowledgeBase{ID: f.config["nativeKnowledgeBaseId"].(string), TenantID: f.ep.TenantID}
	document := &types.Knowledge{ID: id, KnowledgeBaseID: kb.ID, TenantID: kb.TenantID, UpdatedAt: at}
	f.server.kbService = newScopeTestServer(kb).kbService
	f.server.knowledgeService = &stubKnowledgeService{docs: map[string]*types.Knowledge{id: document}}
	f.operation = "execute"
	f.arguments = map[string]any{"target": map[string]any{"resourceId": f.claims["target_id"]},
		"input": map[string]any{"nativeObjectRef": id, "nativeRevision": at.Format(time.RFC3339Nano)}}
	req := f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": id})
	ctx := mcpCallContext(f.ep.TenantID, f.ep)
	_, err := f.server.authorizeNativePlatformTool(ctx, f.ep, req)
	require.NoError(t, err)
	document.UpdatedAt = at.Add(time.Second)
	_, err = f.server.authorizeNativePlatformTool(ctx, f.ep, req)
	require.Error(t, err, "a newer document cannot reuse a signed older reference")
	document.UpdatedAt = at
	document.TenantID++
	_, err = f.server.authorizeNativePlatformTool(ctx, f.ep, req)
	require.Error(t, err, "matching document UUID alone cannot authorize another native owner")
}

func TestNativeBindingProtocolObservationCannotBecomeBusinessRead(t *testing.T) {
	for _, operation := range []string{"query_revision", "observe", "reconcile", "extract_usage"} {
		t.Run(operation, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			f.operation = operation
			f.claims["action_key"] = "knowledge.search@v2"
			req := f.request(t, types.MCPEndpointToolSearchKnowledge, map[string]any{"query": "not admitted"})
			_, err := f.server.authorizeNativePlatformTool(context.Background(), f.ep, req)
			require.Error(t, err)
		})
	}
}

func TestNativeBindingGuardUsesLatestEndpointAfterNativeRead(t *testing.T) {
	for _, change := range []string{"disabled", "removed tool", "removed delivery", "rotated token"} {
		t.Run(change, func(t *testing.T) {
			f := newNativeBindingFixture(t)
			f.server.limiter = ratelimit.New(nil, "native-binding-fixture:", time.Minute, "")
			req := f.request(t, types.MCPEndpointToolReadDocument, map[string]any{"knowledge_id": f.arguments["nativeObjectRef"], "metadata_only": true})
			guarded := f.server.guardTool(func(context.Context, mcp.CallToolRequest) (*mcp.CallToolResult, error) {
				switch change {
				case "disabled":
					require.NoError(t, f.server.db.Model(&types.MCPEndpoint{}).Where("id = ?", f.ep.ID).UpdateColumn("enabled", false).Error)
				case "removed tool":
					require.NoError(t, f.server.db.Model(&types.MCPEndpoint{}).Where("id = ?", f.ep.ID).UpdateColumn("tools", types.StringArray{}).Error)
				case "removed delivery":
					f.server.cfg.MCPAdapterConfigs = nil
				case "rotated token":
					require.NoError(t, f.server.db.Model(&types.MCPEndpoint{}).Where("id = ?", f.ep.ID).UpdateColumn("token_hash", uuid.NewString()).Error)
				}
				return &mcp.CallToolResult{StructuredContent: map[string]string{"native": "not disclosed"}}, nil
			})
			result, err := guarded(context.WithValue(context.Background(), types.MCPEndpointContextKey, f.ep), req)
			require.NoError(t, err)
			require.True(t, result.IsError)
			require.Nil(t, result.StructuredContent)
		})
	}
}
