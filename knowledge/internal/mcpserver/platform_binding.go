package mcpserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/google/uuid"
	"github.com/mark3labs/mcp-go/mcp"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const nativeActionProofHeader = "X-Kailo-Native-Action"

type nativeAdapterDelivery struct {
	values map[string]json.RawMessage
	ep     *types.MCPEndpoint
}

func nativeText(value map[string]json.RawMessage, key string) string {
	var text string
	_ = json.Unmarshal(value[key], &text)
	return text
}

func nativeNumber(value map[string]json.RawMessage, key string) int64 {
	var number int64
	if json.Unmarshal(value[key], &number) != nil {
		return 0
	}
	return number
}

func nativeUUID(text string) bool {
	id, err := uuid.Parse(text)
	return err == nil && id != uuid.Nil && id.String() == text
}

func privateNativeInput(path string) ([]byte, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("native binding delivery requires an absolute private file")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0007 != 0 {
		return nil, errors.New("native binding delivery is unavailable")
	}
	return os.ReadFile(path)
}

// Resolve only controlled adapter delivery, never a caller-supplied binding.
// Persisting the exact endpoint mapping makes a removed/missing delivery fail
// closed instead of silently turning a previously bound token independent.
func (s *Server) nativeAdapter(ctx context.Context, ep *types.MCPEndpoint, initializing bool) (*nativeAdapterDelivery, error) {
	if s.db != nil {
		var current types.MCPEndpoint
		if err := s.db.WithContext(ctx).Where("id = ? AND tenant_id = ?", ep.ID, ep.TenantID).Take(&current).Error; err != nil {
			return nil, errors.New("native endpoint no longer available")
		}
		if !current.Enabled || current.TokenHash != ep.TokenHash {
			return nil, errors.New("native endpoint is disabled or its authenticated credential changed")
		}
		ep = &current
	}
	var matched map[string]json.RawMessage
	if s.cfg != nil {
		for _, path := range s.cfg.MCPAdapterConfigs {
			raw, err := privateNativeInput(path)
			var value map[string]json.RawMessage
			if err != nil || json.Unmarshal(raw, &value) != nil || value == nil {
				return nil, errors.New("native adapter configuration unavailable")
			}
			u, err := url.Parse(nativeText(value, "nativeMcpUrl"))
			if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
				return nil, errors.New("native adapter endpoint mapping invalid")
			}
			if u.Path != "/mcp/"+ep.ID {
				continue
			}
			if matched != nil || !nativeUUID(nativeText(value, "bindingId")) || !nativeUUID(nativeText(value, "tenantId")) ||
				!nativeUUID(nativeText(value, "nativeKnowledgeBaseId")) || nativeNumber(value, "timeoutMs") <= 0 || nativeNumber(value, "maxBodyBytes") <= 0 {
				return nil, errors.New("native adapter binding mapping is not unique and complete")
			}
			matched = value
		}
	}
	if matched == nil {
		if ep.PlatformBindingID != "" {
			return nil, errors.New("bound native endpoint lost its controlled delivery")
		}
		return &nativeAdapterDelivery{ep: ep}, nil
	}
	credential, err := privateNativeInput(nativeText(matched, "nativeMcpBearerFile"))
	if err != nil || len(credential) == 0 || s.db == nil {
		return nil, errors.New("native endpoint projection unavailable")
	}
	digest := sha256.Sum256([]byte(strings.TrimSpace(string(credential))))
	binding, kbID := nativeText(matched, "bindingId"), nativeText(matched, "nativeKnowledgeBaseId")
	var current types.MCPEndpoint
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id = ? AND tenant_id = ?", ep.ID, ep.TenantID).Take(&current).Error; err != nil {
			return err
		}
		if !current.Enabled || current.TokenHash != ep.TokenHash || current.TokenHash != hex.EncodeToString(digest[:]) || len(current.KnowledgeBaseIDs) != 1 || current.KnowledgeBaseIDs[0] != kbID ||
			(current.PlatformBindingID != "" && current.PlatformBindingID != binding) {
			return errors.New("native endpoint differs from its controlled binding projection")
		}
		if current.PlatformBindingID == "" {
			if !initializing {
				return errors.New("native binding projection was not installed at startup")
			}
			if err := tx.Model(&current).UpdateColumn("platform_binding_id", binding).Error; err != nil {
				return err
			}
			current.PlatformBindingID = binding
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &nativeAdapterDelivery{values: matched, ep: &current}, nil
}

// Project controlled ownership before the server accepts its first request.
// A failed/missing delivery prevents startup instead of serving the endpoint
// as an independent credential until somebody happens to call tools/list.
func (s *Server) initializeNativeBindings(ctx context.Context) error {
	if s.cfg == nil {
		return nil
	}
	for _, path := range s.cfg.MCPAdapterConfigs {
		raw, err := privateNativeInput(path)
		var value map[string]json.RawMessage
		if err != nil || json.Unmarshal(raw, &value) != nil || s.db == nil {
			return errors.New("native binding startup delivery unavailable")
		}
		u, err := url.Parse(nativeText(value, "nativeMcpUrl"))
		if err != nil || !strings.HasPrefix(u.Path, "/mcp/") || !nativeUUID(strings.TrimPrefix(u.Path, "/mcp/")) {
			return errors.New("native binding startup endpoint invalid")
		}
		var ep types.MCPEndpoint
		if err := s.db.WithContext(ctx).Where("id = ?", strings.TrimPrefix(u.Path, "/mcp/")).Take(&ep).Error; err != nil {
			return errors.New("native binding startup endpoint unavailable")
		}
		if _, err := s.nativeAdapter(ctx, &ep, true); err != nil {
			return err
		}
	}
	return nil
}

// The native service asks the same Core PEP as its adapter. A native token only
// authenticates an endpoint; it never proves platform admission or generation.
func (d *nativeAdapterDelivery) authorize(ctx context.Context, encoded string) (map[string]json.RawMessage, map[string]json.RawMessage, string, error) {
	refused := errors.New("native platform authorization refused or unavailable")
	limit := nativeNumber(d.values, "maxBodyBytes")
	if encoded == "" || int64(len(encoded)) > limit {
		return nil, nil, "", refused
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	var proof map[string]json.RawMessage
	if err != nil || json.Unmarshal(raw, &proof) != nil || len(proof) != 3 {
		return nil, nil, "", refused
	}
	token, arguments, operation := nativeText(proof, "actionToken"), nativeText(proof, "argumentsJson"), nativeText(proof, "operation")
	if token == "" || arguments == "" || operation == "" {
		return nil, nil, "", refused
	}
	pep, err := url.Parse(nativeText(d.values, "corePepUrl"))
	if err != nil || (pep.Scheme != "http" && pep.Scheme != "https") || pep.Host == "" || pep.User != nil ||
		pep.Path != "/service/v1/adapter/pep_check" || pep.RawQuery != "" || pep.Fragment != "" {
		return nil, nil, "", refused
	}
	secret, err := privateNativeInput(nativeText(d.values, "oidcClientSecretFile"))
	credential := strings.TrimSpace(string(secret))
	if err != nil || credential == "" || strings.ContainsAny(credential, "\r\n") {
		return nil, nil, "", refused
	}
	httpClient := &http.Client{Timeout: time.Duration(nativeNumber(d.values, "timeoutMs")) * time.Millisecond,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, httpClient)
	identity := clientcredentials.Config{ClientID: nativeText(d.values, "oidcClientId"), ClientSecret: credential,
		TokenURL: nativeText(d.values, "oidcTokenUrl"), AuthStyle: oauth2.AuthStyleInHeader}
	idp, err := url.Parse(identity.TokenURL)
	if err != nil || (idp.Scheme != "http" && idp.Scheme != "https") || idp.Host == "" || idp.User != nil ||
		idp.RawQuery != "" || idp.Fragment != "" || identity.ClientID == "" {
		return nil, nil, "", refused
	}
	bearer, err := identity.Token(ctx)
	if err != nil || bearer == nil || !bearer.Valid() {
		return nil, nil, "", refused
	}
	body, err := json.Marshal(map[string]string{"bindingId": d.ep.PlatformBindingID, "actionToken": token, "argumentsJson": arguments, "operation": operation})
	if err != nil {
		return nil, nil, "", refused
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, pep.String(), bytes.NewReader(body))
	if err != nil {
		return nil, nil, "", refused
	}
	request.Header.Set("Authorization", "Bearer "+bearer.AccessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, nil, "", refused
	}
	defer response.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	var result map[string]json.RawMessage
	if err != nil || int64(len(answer)) > limit || response.StatusCode != http.StatusOK ||
		!strings.HasPrefix(response.Header.Get("Content-Type"), "application/json") || json.Unmarshal(answer, &result) != nil {
		return nil, nil, "", refused
	}
	// Decode claims only after Core authenticated the exact token and its
	// arguments digest. No unverified generation from the JWT is consumed.
	parts := strings.Split(token, ".")
	var claims map[string]json.RawMessage
	if len(parts) != 3 {
		return nil, nil, "", refused
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || json.Unmarshal(payload, &claims) != nil ||
		!nativeUUID(nativeText(result, "actionExecutionId")) || !nativeUUID(nativeText(result, "operationId")) ||
		nativeText(claims, "tenant_id") != nativeText(d.values, "tenantId") ||
		nativeText(claims, "action_execution_id") != nativeText(result, "actionExecutionId") ||
		nativeText(claims, "operation_id") != nativeText(result, "operationId") || nativeText(result, "authorizationMinZedToken") == "" {
		return nil, nil, "", refused
	}
	claims["native_arguments"] = json.RawMessage(arguments)
	return claims, result, operation, nil
}

func (s *Server) authorizeNativePlatformTool(ctx context.Context, ep *types.MCPEndpoint, req mcp.CallToolRequest) (context.Context, error) {
	delivery, err := s.nativeAdapter(ctx, ep, false)
	if err != nil {
		return ctx, err
	}
	if !delivery.ep.HasTool(req.Params.Name) {
		return ctx, errors.New("native endpoint no longer permits this tool")
	}
	if delivery.values == nil {
		return context.WithValue(ctx, types.MCPEndpointContextKey, delivery.ep), nil
	}
	claims, admitted, operation, err := delivery.authorize(ctx, req.Header.Get(nativeActionProofHeader))
	if err != nil {
		return ctx, err
	}
	key, tool := nativeText(claims, "action_key"), req.Params.Name
	action := ""
	for _, name := range []string{"search", "read", "export", "ingest", "delete"} {
		for _, version := range []string{"@v1", "@v2", "@v3"} {
			if key == "knowledge."+name+version {
				action = name
			}
		}
	}
	var arguments, input map[string]json.RawMessage
	if json.Unmarshal(claims["native_arguments"], &arguments) != nil {
		return ctx, errors.New("native execution arguments unavailable")
	}
	kbID := nativeText(delivery.values, "nativeKnowledgeBaseId")
	allowed := false
	switch operation {
	case "handshake", "validate_binding":
		allowed = action == "" && tool == types.MCPEndpointToolListKnowledgeBases
	case "observe", "reconcile", "extract_usage":
		allowed = ((action == "ingest" && tool == types.MCPEndpointToolAddDocument) ||
			(action == "delete" && tool == types.MCPEndpointToolDeleteDocument)) && req.GetBool("observe_only", false) &&
			req.GetString("knowledge_base_id", "") == kbID &&
			nativeUUID(nativeText(arguments, "idempotencyKey")) && req.GetString("idempotency_key", "") == nativeText(arguments, "idempotencyKey")
	case "query_revision":
		allowed = action != "" && nativeText(arguments, "authorizationTargetNativeRef") == kbID &&
			((tool == types.MCPEndpointToolListKnowledgeBases && nativeText(arguments, "nativeObjectRef") == kbID) ||
				(tool == types.MCPEndpointToolReadDocument && req.GetBool("metadata_only", false) &&
					req.GetString("knowledge_id", "") == nativeText(arguments, "nativeObjectRef")))
	case "execute":
		// The original parse/delete workers have no fresh platform job
		// authorization consumer. Never serialize this ingress token or let it
		// stand in for the authorization of those later native writes.
		if tool == types.MCPEndpointToolAddDocument || tool == types.MCPEndpointToolDeleteDocument {
			return ctx, errors.New("bound native delayed execution is unavailable")
		}
		var target map[string]json.RawMessage
		if json.Unmarshal(admitted["targetResource"], &target) != nil ||
			nativeText(target, "resourceId") != nativeText(claims, "target_id") ||
			nativeText(target, "nativeRef") != nativeText(delivery.values, "nativeKnowledgeBaseId") ||
			nativeText(target, "nativeScopeRef") != nativeText(delivery.values, "nativeKnowledgeBaseId") ||
			json.Unmarshal(arguments["input"], &input) != nil {
			return ctx, errors.New("native execution resource scope unavailable")
		}
		switch action {
		case "search":
			allowed = (tool == types.MCPEndpointToolSearchKnowledge && req.GetString("query", "") == nativeText(input, "query")) ||
				(tool == types.MCPEndpointToolReadDocument && req.GetBool("metadata_only", false))
		case "read":
			allowed = tool == types.MCPEndpointToolReadDocument && req.GetString("knowledge_id", "") == nativeText(input, "nativeObjectRef")
		case "export":
			allowed = (tool == types.MCPEndpointToolExportDocument ||
				(tool == types.MCPEndpointToolReadDocument && req.GetBool("metadata_only", false))) &&
				req.GetString("knowledge_id", "") == nativeText(input, "nativeObjectRef")
		}
	}
	if !allowed {
		return ctx, errors.New("native tool differs from the admitted operation and scope")
	}
	ctx = context.WithValue(ctx, types.MCPEndpointContextKey, delivery.ep)
	if operation == "execute" && (action == "read" || action == "export") {
		if s.knowledgeService == nil || s.kbService == nil {
			return ctx, errors.New("native document authorization unavailable")
		}
		document, _, err := s.knowledgeInScope(ctx, delivery.ep, nativeText(input, "nativeObjectRef"))
		if err != nil || document.UpdatedAt.IsZero() || document.UpdatedAt.UTC().Format(time.RFC3339Nano) != nativeText(input, "nativeRevision") {
			return ctx, errors.New("native document no longer matches its admitted revision")
		}
	}
	return ctx, nil
}
