package mcpserver

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/mark3labs/mcp-go/mcp"
)

// DD-138(5), 07 §4.8.4 / §5.2: Kailo unified search. Core calls the binding
// adapter's /platform-adapter/v1/search with a 60 s Search Token after it has
// done the fresh per-Resource `read` check itself; there is no ActionToken and
// no Core PEP call for this read-only operation. The adapter forwards the
// Search Token and the exact request body in the native action proof, and
// this endpoint verifies them independently (signature with the adapter's
// delivered JWKS, issuer, audience, lifetime, token_use, Tenant, binding and
// the request-body hash) before it lets the adapter run the read-only
// search_knowledge / read_document(metadata_only) / list_knowledge_bases
// tools on the bound knowledge base. The token never authorizes any write.

const (
	nativeSearchOperation  = "search"
	nativeSearchTokenUse   = "COMPONENT_SEARCH"
	nativeSearchMaxSeconds = 60
)

var nativeSearchForbiddenClaims = []string{"agent_principal_id", "delegation_id", "delegation_version",
	"result_exposure_policy_id", "result_exposure_policy_version", "action_execution_id", "target_id", "action_key"}

// nativeProof decodes the X-Kailo-Native-Action proof (actionToken,
// argumentsJson, operation) without authorizing anything.
func nativeProof(encoded string, limit int64) (token, arguments, operation string, ok bool) {
	if encoded == "" || int64(len(encoded)) > limit {
		return "", "", "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	var proof map[string]json.RawMessage
	if err != nil || json.Unmarshal(raw, &proof) != nil || len(proof) != 3 {
		return "", "", "", false
	}
	token, arguments, operation = nativeText(proof, "actionToken"), nativeText(proof, "argumentsJson"), nativeText(proof, "operation")
	return token, arguments, operation, token != "" && arguments != "" && operation != ""
}

func nativeSearchSegment(part string) ([]byte, error) {
	raw, err := base64.RawURLEncoding.DecodeString(part)
	if err != nil || base64.RawURLEncoding.EncodeToString(raw) != part {
		return nil, errors.New("search token segment invalid")
	}
	return raw, nil
}

// nativeSearchKey returns the ES256 verification key named by kid from the
// adapter's delivered JWKS file (the same keys the adapter verifies with).
func nativeSearchKey(path, kid string) (*ecdsa.PublicKey, error) {
	refused := errors.New("search token key unavailable")
	raw, err := privateNativeInput(path)
	var jwks struct {
		Keys []map[string]json.RawMessage `json:"keys"`
	}
	if err != nil || json.Unmarshal(raw, &jwks) != nil {
		return nil, refused
	}
	var match map[string]json.RawMessage
	for _, key := range jwks.Keys {
		if nativeText(key, "kid") == kid {
			if match != nil {
				return nil, refused
			}
			match = key
		}
	}
	if match == nil || nativeText(match, "kty") != "EC" || nativeText(match, "crv") != "P-256" ||
		match["d"] != nil || (match["alg"] != nil && nativeText(match, "alg") != "ES256") ||
		(match["use"] != nil && nativeText(match, "use") != "sig") {
		return nil, refused
	}
	x, errX := nativeSearchSegment(nativeText(match, "x"))
	y, errY := nativeSearchSegment(nativeText(match, "y"))
	if errX != nil || errY != nil || len(x) != 32 || len(y) != 32 {
		return nil, refused
	}
	key := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(x), Y: new(big.Int).SetBytes(y)}
	if !key.Curve.IsOnCurve(key.X, key.Y) {
		return nil, refused
	}
	return key, nil
}

// verifySearchToken checks the Search Token and returns the verified request
// body (AdapterSearchRequest).
func (d *nativeAdapterDelivery) verifySearchToken(token, arguments string, now time.Time) (map[string]json.RawMessage, error) {
	refused := errors.New("native search authorization refused")
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, refused
	}
	headerRaw, err1 := nativeSearchSegment(parts[0])
	payloadRaw, err2 := nativeSearchSegment(parts[1])
	signature, err3 := nativeSearchSegment(parts[2])
	var header, claims map[string]json.RawMessage
	if err1 != nil || err2 != nil || err3 != nil || len(signature) != 64 ||
		json.Unmarshal(headerRaw, &header) != nil || json.Unmarshal(payloadRaw, &claims) != nil ||
		len(header) != 3 || nativeText(header, "alg") != "ES256" || nativeText(header, "typ") != "JWT" ||
		nativeText(header, "kid") == "" {
		return nil, refused
	}
	key, err := nativeSearchKey(nativeText(d.values, "actionTokenJwksFile"), nativeText(header, "kid"))
	if err != nil {
		return nil, refused
	}
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(key, digest[:], new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])) {
		return nil, refused
	}
	iat, exp := nativeNumber(claims, "iat"), nativeNumber(claims, "exp")
	issuer, audience := nativeText(d.values, "actionTokenIssuer"), nativeText(d.values, "actionTokenAudience")
	if issuer == "" || audience == "" || nativeText(claims, "iss") != issuer || nativeText(claims, "aud") != audience ||
		iat <= 0 || exp <= iat || iat > now.Unix() || exp <= now.Unix() || exp-iat > nativeSearchMaxSeconds ||
		(claims["nbf"] != nil && nativeNumber(claims, "nbf") > now.Unix()) {
		return nil, refused
	}
	argumentsDigest := sha256.Sum256([]byte(arguments))
	binding := nativeText(d.values, "bindingId")
	if nativeText(claims, "token_use") != nativeSearchTokenUse || binding == "" || binding != d.ep.PlatformBindingID ||
		nativeText(claims, "binding_id") != binding || nativeText(claims, "tenant_id") != nativeText(d.values, "tenantId") ||
		nativeText(claims, "workspace_id") != nativeText(d.values, "workspaceId") ||
		!nativeUUID(nativeText(claims, "actor_principal_id")) || !nativeUUID(nativeText(claims, "jti")) ||
		nativeText(claims, "normalized_parameter_hash") != hex.EncodeToString(argumentsDigest[:]) {
		return nil, refused
	}
	for _, name := range nativeSearchForbiddenClaims {
		if claims[name] != nil {
			return nil, refused
		}
	}
	var request map[string]json.RawMessage
	if json.Unmarshal([]byte(arguments), &request) != nil {
		return nil, refused
	}
	return request, nil
}

// authorizeSearch admits only the read-only search tools on the bound
// knowledge base, and only when the verified request names it.
func (d *nativeAdapterDelivery) authorizeSearch(req mcp.CallToolRequest, token, arguments string) error {
	refused := errors.New("native tool differs from the admitted search scope")
	request, err := d.verifySearchToken(token, arguments, time.Now())
	if err != nil {
		return err
	}
	kbID := nativeText(d.values, "nativeKnowledgeBaseId")
	var resources []map[string]json.RawMessage
	if json.Unmarshal(request["resources"], &resources) != nil {
		return refused
	}
	named := false
	for _, resource := range resources {
		if nativeText(resource, "nativeId") == kbID {
			named = true
		}
	}
	if !named {
		return refused
	}
	switch req.Params.Name {
	case types.MCPEndpointToolSearchKnowledge:
		ids := req.GetStringSlice("knowledge_base_ids", nil)
		if req.GetString("query", "") != nativeText(request, "query") || len(ids) != 1 || ids[0] != kbID {
			return refused
		}
	case types.MCPEndpointToolReadDocument:
		if !req.GetBool("metadata_only", false) {
			return refused
		}
	case types.MCPEndpointToolListKnowledgeBases:
	default:
		return refused
	}
	return nil
}
