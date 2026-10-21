package types

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// KailoOrgClaimVersion is the only organisation projection version accepted.
const KailoOrgClaimVersion = 1

// Limits of the Kailo organisation projection (Kailo DD-133 §3).
const (
	kailoScopeNameMaxRunes = 100
	kailoMaxWorkspaces     = 200
	// KailoScopeRefTenantPrefix / KailoScopeRefWorkspacePrefix prefix
	// tenants.kailo_scope_ref; migration 000109 enforces the same format.
	KailoScopeRefTenantPrefix    = "tenant:"
	KailoScopeRefWorkspacePrefix = "workspace:"
)

var kailoScopeIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,140}$`)

// KailoScopeRole is a Kailo membership role as projected to components.
type KailoScopeRole string

const (
	// KailoRoleAdmin is a Kailo Tenant (or Workspace) administrator.
	KailoRoleAdmin KailoScopeRole = "admin"
	// KailoRoleMember is an ordinary Kailo member.
	KailoRoleMember KailoScopeRole = "member"
)

// NativeTenantRole derives the native space role from the Kailo role:
// administrators manage the space (models, settings, every knowledge base);
// members create knowledge bases and agents and edit their own, and read
// everything else in the space. Ownership is never granted natively.
func (r KailoScopeRole) NativeTenantRole() TenantRole {
	if r == KailoRoleAdmin {
		return TenantRoleAdmin
	}
	return TenantRoleContributor
}

// KailoScope is one Kailo Tenant or Workspace with the caller's role in it.
type KailoScope struct {
	ID   string         `json:"id"`
	Name string         `json:"name"`
	Role KailoScopeRole `json:"role"`
}

// KailoOrgClaim is the organisation projection Kailo issues on the
// component's dedicated OIDC client:
//
//	{"v":1,
//	 "tenant":{"id":"<Kailo tenant id>","name":"<display name>","role":"admin|member"},
//	 "workspaces":[{"id":"<Kailo workspace id>","name":"…","role":"admin|member"}]}
//
// Kailo Core stays the membership authority; the identity provider only
// carries Core's projection inside the verified token.
type KailoOrgClaim struct {
	Version    int          `json:"v"`
	Tenant     KailoScope   `json:"tenant"`
	Workspaces []KailoScope `json:"workspaces,omitempty"`
}

// ErrKailoOrgClaimMissing means the verified token carried no organisation claim.
var ErrKailoOrgClaimMissing = errors.New("kailo organisation claim is missing")

// ParseKailoOrgClaim validates the raw claim value (a JSON object, or a JSON
// object encoded as a string as some identity-provider mappers emit it).
func ParseKailoOrgClaim(raw interface{}) (*KailoOrgClaim, error) {
	var data []byte
	switch v := raw.(type) {
	case nil:
		return nil, ErrKailoOrgClaimMissing
	case string:
		if strings.TrimSpace(v) == "" {
			return nil, ErrKailoOrgClaimMissing
		}
		data = []byte(v)
	case map[string]interface{}:
		encoded, err := json.Marshal(v)
		if err != nil {
			return nil, fmt.Errorf("kailo organisation claim: %w", err)
		}
		data = encoded
	default:
		return nil, errors.New("kailo organisation claim must be a JSON object")
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	var claim KailoOrgClaim
	if err := decoder.Decode(&claim); err != nil {
		return nil, fmt.Errorf("kailo organisation claim is malformed: %w", err)
	}
	if claim.Version != KailoOrgClaimVersion {
		return nil, fmt.Errorf("kailo organisation claim version %d is not supported", claim.Version)
	}
	if err := normaliseKailoScope(&claim.Tenant, "tenant"); err != nil {
		return nil, err
	}
	if len(claim.Workspaces) > kailoMaxWorkspaces {
		return nil, fmt.Errorf("kailo organisation claim lists more than %d workspaces", kailoMaxWorkspaces)
	}
	seen := make(map[string]struct{}, len(claim.Workspaces))
	for i := range claim.Workspaces {
		if err := normaliseKailoScope(&claim.Workspaces[i], "workspace"); err != nil {
			return nil, err
		}
		if _, dup := seen[claim.Workspaces[i].ID]; dup {
			return nil, fmt.Errorf("kailo organisation claim repeats workspace %q", claim.Workspaces[i].ID)
		}
		seen[claim.Workspaces[i].ID] = struct{}{}
	}
	return &claim, nil
}

func normaliseKailoScope(scope *KailoScope, kind string) error {
	scope.ID = strings.TrimSpace(scope.ID)
	if !kailoScopeIDPattern.MatchString(scope.ID) {
		return fmt.Errorf("kailo organisation claim has an invalid %s id", kind)
	}
	scope.Name = strings.Join(strings.Fields(scope.Name), " ")
	if scope.Name == "" {
		return fmt.Errorf("kailo organisation claim %s %q has no name", kind, scope.ID)
	}
	if utf8.RuneCountInString(scope.Name) > kailoScopeNameMaxRunes {
		runes := []rune(scope.Name)
		scope.Name = string(runes[:kailoScopeNameMaxRunes])
	}
	switch KailoScopeRole(strings.ToLower(strings.TrimSpace(string(scope.Role)))) {
	case KailoRoleAdmin:
		scope.Role = KailoRoleAdmin
	case KailoRoleMember:
		scope.Role = KailoRoleMember
	default:
		return fmt.Errorf("kailo organisation claim %s %q has an unknown role", kind, scope.ID)
	}
	return nil
}

// TenantScopeRef is the kailo_scope_ref of the Tenant's own space.
func (c *KailoOrgClaim) TenantScopeRef() string {
	return KailoScopeRefTenantPrefix + c.Tenant.ID
}

// KailoWorkspaceScopeRef is the kailo_scope_ref of a Workspace space.
func KailoWorkspaceScopeRef(workspaceID string) string {
	return KailoScopeRefWorkspacePrefix + workspaceID
}
