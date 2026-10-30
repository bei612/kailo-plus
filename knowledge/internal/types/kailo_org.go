package types

import (
	"strings"
	"unicode/utf8"
)

// tenants.kailo_scope_ref prefixes; migration 000109 enforces the format.
const (
	KailoScopeRefTenantPrefix    = "tenant:"
	KailoScopeRefWorkspacePrefix = "workspace:"
	kailoScopeNameMaxRunes       = 100
)

// KailoScopeRole is a Kailo membership role as projected to a component.
type KailoScopeRole string

const (
	// KailoRoleAdmin is a Kailo Tenant administrator (SpiceDB Tenant manage).
	KailoRoleAdmin KailoScopeRole = "admin"
	// KailoRoleMember is an ordinary Kailo member.
	KailoRoleMember KailoScopeRole = "member"
)

// KailoScope is one Kailo Tenant or Workspace and the person's role in it.
type KailoScope struct {
	ID   string
	Name string
	Role KailoScopeRole
	// Create is Kailo's create permission on the scope (directory schema 2:
	// tenantCreate, workspaces[].create). Only a scope with create gets
	// write access to content (Kailo DD-164(3)).
	Create bool
}

// NativeRole derives the native space role from Kailo (DD-164(3), 07
// §4.7.4 "schema 2 角色派生"): an administrator manages the space; a member
// with Kailo `create` on the scope is a contributor (creates knowledge bases
// and agents, edits their own); every other member only reads. Ownership is
// never granted natively.
func (s KailoScope) NativeRole() TenantRole {
	switch {
	case s.Role == KailoRoleAdmin:
		return TenantRoleAdmin
	case s.Create:
		return TenantRoleContributor
	default:
		return TenantRoleViewer
	}
}

// KailoMembership is what Kailo says about one person for this component
// instance (07 §4.7.4). Until the platform member directory is delivered it
// is derived from the deployment alone: the Tenant the instance serves, with
// the member role and no Workspaces; the directory will later supply the
// Tenant role and Workspace memberships. Identity-provider claims, groups,
// email or display names are never a source.
type KailoMembership struct {
	Tenant     KailoScope
	Workspaces []KailoScope
}

// DeploymentKailoMembership is the membership known before the member
// directory exists: contributor of the deployment's Tenant space (07 §4.7.4
// "成员目录未交付时"), nothing else and never an administrator.
func DeploymentKailoMembership(tenantID, tenantName string) *KailoMembership {
	return &KailoMembership{Tenant: KailoScope{
		ID:     strings.TrimSpace(tenantID),
		Name:   NormaliseKailoName(tenantName),
		Role:   KailoRoleMember,
		Create: true,
	}}
}

// NormaliseKailoName collapses whitespace and bounds a Kailo display name.
func NormaliseKailoName(value string) string {
	name := strings.Join(strings.Fields(value), " ")
	if utf8.RuneCountInString(name) > kailoScopeNameMaxRunes {
		name = string([]rune(name)[:kailoScopeNameMaxRunes])
	}
	return name
}

// TenantScopeRef is the kailo_scope_ref of the Tenant's own space.
func (m *KailoMembership) TenantScopeRef() string {
	return KailoScopeRefTenantPrefix + m.Tenant.ID
}

// KailoWorkspaceScopeRef is the kailo_scope_ref of a Workspace space.
func KailoWorkspaceScopeRef(workspaceID string) string {
	return KailoScopeRefWorkspacePrefix + workspaceID
}
