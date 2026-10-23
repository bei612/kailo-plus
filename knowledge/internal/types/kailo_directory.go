package types

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Kailo member directory (Kailo DD-133(4), 07 §4.7.4): the read-only full
// snapshot Core answers to this component instance's own directory client
// (contracts/api/component_member_directory.schema.json). Roles and
// memberships of the Kailo Tenant this instance serves come only from it.

// KailoDirectoryRole is a role in the directory (SpiceDB manage → ADMIN).
type KailoDirectoryRole string

const (
	KailoDirectoryRoleAdmin  KailoDirectoryRole = "ADMIN"
	KailoDirectoryRoleMember KailoDirectoryRole = "MEMBER"
)

var (
	kailoDirectoryUUID    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	kailoDirectoryVersion = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

// KailoDirectoryTenant is the binding's Tenant.
type KailoDirectoryTenant struct {
	TenantID string `json:"tenantId"`
	Name     string `json:"name"`
}

// KailoDirectoryWorkspace is one ACTIVE Workspace in the binding scope.
type KailoDirectoryWorkspace struct {
	WorkspaceID string `json:"workspaceId"`
	Name        string `json:"name"`
}

// KailoDirectoryIdentity is one ACTIVE external identity of a member.
type KailoDirectoryIdentity struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
	Picture string `json:"picture"`
}

// KailoDirectoryMembership is one ACTIVE Workspace membership of a member.
type KailoDirectoryMembership struct {
	WorkspaceID string             `json:"workspaceId"`
	Role        KailoDirectoryRole `json:"role"`
}

// KailoDirectoryMember is one ACTIVE HUMAN member in the binding scope.
type KailoDirectoryMember struct {
	PrincipalID string                     `json:"principalId"`
	DisplayName string                     `json:"displayName"`
	TenantRole  KailoDirectoryRole         `json:"tenantRole"`
	Identities  []KailoDirectoryIdentity   `json:"identities"`
	Workspaces  []KailoDirectoryMembership `json:"workspaces"`
}

// KailoMemberDirectory is one complete directory snapshot.
type KailoMemberDirectory struct {
	BindingID        string                    `json:"bindingId"`
	DirectoryVersion string                    `json:"directoryVersion"`
	Tenant           KailoDirectoryTenant      `json:"tenant"`
	Workspaces       []KailoDirectoryWorkspace `json:"workspaces"`
	Members          []KailoDirectoryMember    `json:"members"`
}

// The wire forms keep every required member as a pointer so an absent field
// is told apart from an empty one; unknown fields are refused (the schema is
// additionalProperties=false everywhere).
type wireDirectory struct {
	BindingID        *string                   `json:"bindingId"`
	DirectoryVersion *string                   `json:"directoryVersion"`
	Tenant           *wireDirectoryTenant      `json:"tenant"`
	Workspaces       *[]wireDirectoryWorkspace `json:"workspaces"`
	Members          *[]wireDirectoryMember    `json:"members"`
}

type wireDirectoryTenant struct {
	TenantID *string `json:"tenantId"`
	Name     *string `json:"name"`
}

type wireDirectoryWorkspace struct {
	WorkspaceID *string `json:"workspaceId"`
	Name        *string `json:"name"`
}

type wireDirectoryIdentity struct {
	Issuer  *string `json:"issuer"`
	Subject *string `json:"subject"`
	Picture *string `json:"picture"`
}

type wireDirectoryMembership struct {
	WorkspaceID *string `json:"workspaceId"`
	Role        *string `json:"role"`
}

type wireDirectoryMember struct {
	PrincipalID *string                    `json:"principalId"`
	DisplayName *string                    `json:"displayName"`
	TenantRole  *string                    `json:"tenantRole"`
	Identities  *[]wireDirectoryIdentity   `json:"identities"`
	Workspaces  *[]wireDirectoryMembership `json:"workspaces"`
}

// ErrKailoDirectoryInvalid marks a snapshot that does not match the contract.
var ErrKailoDirectoryInvalid = errors.New("kailo member directory does not match the contract")

func invalidDirectory(what string) error {
	return fmt.Errorf("%w: %s", ErrKailoDirectoryInvalid, what)
}

func directoryRole(value *string) (KailoDirectoryRole, bool) {
	if value == nil {
		return "", false
	}
	switch KailoDirectoryRole(*value) {
	case KailoDirectoryRoleAdmin, KailoDirectoryRoleMember:
		return KailoDirectoryRole(*value), true
	}
	return "", false
}

// ParseKailoMemberDirectory decodes and validates one snapshot strictly. A
// snapshot that fails any check is refused as a whole: it is never applied
// in part and never read as an empty directory.
func ParseKailoMemberDirectory(raw []byte) (*KailoMemberDirectory, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	var wire wireDirectory
	if err := dec.Decode(&wire); err != nil {
		return nil, invalidDirectory("not a directory object")
	}
	if dec.More() {
		return nil, invalidDirectory("trailing data")
	}
	if wire.BindingID == nil || !kailoDirectoryUUID.MatchString(*wire.BindingID) {
		return nil, invalidDirectory("bindingId")
	}
	if wire.DirectoryVersion == nil || !kailoDirectoryVersion.MatchString(*wire.DirectoryVersion) {
		return nil, invalidDirectory("directoryVersion")
	}
	if wire.Tenant == nil || wire.Tenant.TenantID == nil || !kailoDirectoryUUID.MatchString(*wire.Tenant.TenantID) ||
		wire.Tenant.Name == nil {
		return nil, invalidDirectory("tenant")
	}
	if wire.Workspaces == nil || wire.Members == nil {
		return nil, invalidDirectory("workspaces and members are required")
	}
	out := &KailoMemberDirectory{
		BindingID:        strings.ToLower(*wire.BindingID),
		DirectoryVersion: *wire.DirectoryVersion,
		Tenant:           KailoDirectoryTenant{TenantID: strings.ToLower(*wire.Tenant.TenantID), Name: *wire.Tenant.Name},
		Workspaces:       []KailoDirectoryWorkspace{},
		Members:          []KailoDirectoryMember{},
	}
	known := map[string]bool{}
	for _, ws := range *wire.Workspaces {
		if ws.WorkspaceID == nil || !kailoDirectoryUUID.MatchString(*ws.WorkspaceID) || ws.Name == nil {
			return nil, invalidDirectory("workspace")
		}
		id := strings.ToLower(*ws.WorkspaceID)
		if known[id] {
			return nil, invalidDirectory("duplicate workspace")
		}
		known[id] = true
		out.Workspaces = append(out.Workspaces, KailoDirectoryWorkspace{WorkspaceID: id, Name: *ws.Name})
	}
	identities := map[[2]string]bool{}
	for _, m := range *wire.Members {
		role, ok := directoryRole(m.TenantRole)
		if m.PrincipalID == nil || !kailoDirectoryUUID.MatchString(*m.PrincipalID) || m.DisplayName == nil || !ok ||
			m.Identities == nil || m.Workspaces == nil {
			return nil, invalidDirectory("member")
		}
		member := KailoDirectoryMember{
			PrincipalID: strings.ToLower(*m.PrincipalID),
			DisplayName: *m.DisplayName,
			TenantRole:  role,
			Identities:  []KailoDirectoryIdentity{},
			Workspaces:  []KailoDirectoryMembership{},
		}
		for _, id := range *m.Identities {
			if id.Issuer == nil || id.Subject == nil || id.Picture == nil ||
				strings.TrimSpace(*id.Issuer) == "" || strings.TrimSpace(*id.Subject) == "" {
				return nil, invalidDirectory("identity")
			}
			key := [2]string{*id.Issuer, *id.Subject}
			if identities[key] {
				// One identity belongs to one person; a repeat is a contract breach.
				return nil, invalidDirectory("duplicate identity")
			}
			identities[key] = true
			member.Identities = append(member.Identities,
				KailoDirectoryIdentity{Issuer: *id.Issuer, Subject: *id.Subject, Picture: *id.Picture})
		}
		seen := map[string]bool{}
		for _, ws := range *m.Workspaces {
			wsRole, ok := directoryRole(ws.Role)
			if ws.WorkspaceID == nil || !ok {
				return nil, invalidDirectory("membership")
			}
			id := strings.ToLower(*ws.WorkspaceID)
			if !known[id] || seen[id] {
				return nil, invalidDirectory("membership outside the snapshot workspaces")
			}
			seen[id] = true
			member.Workspaces = append(member.Workspaces, KailoDirectoryMembership{WorkspaceID: id, Role: wsRole})
		}
		out.Members = append(out.Members, member)
	}
	return out, nil
}

// MemberFor returns the member holding issuer+subject, or nil.
func (d *KailoMemberDirectory) MemberFor(issuer, subject string) *KailoDirectoryMember {
	if d == nil {
		return nil
	}
	for i := range d.Members {
		for _, id := range d.Members[i].Identities {
			if id.Issuer == issuer && id.Subject == subject {
				return &d.Members[i]
			}
		}
	}
	return nil
}

// workspaceName is the snapshot name of a Workspace, never empty.
func (d *KailoMemberDirectory) workspaceName(id string) string {
	for _, ws := range d.Workspaces {
		if ws.WorkspaceID == id {
			if name := NormaliseKailoName(ws.Name); name != "" {
				return name
			}
		}
	}
	return id
}

// TenantName is the directory's Tenant name, or fallback when it is blank.
func (d *KailoMemberDirectory) TenantName(fallback string) string {
	if name := NormaliseKailoName(d.Tenant.Name); name != "" {
		return name
	}
	return NormaliseKailoName(fallback)
}

// Membership maps one directory member onto the native projection (07
// §4.7.4 WeKnora table): Tenant ADMIN → admin of the Tenant space and of
// every Workspace space in the snapshot; MEMBER → contributor of the Tenant
// space and of the Workspace spaces they belong to. A Workspace-level ADMIN
// does not raise the native role: administrators come only from the Tenant.
func (d *KailoMemberDirectory) Membership(m *KailoDirectoryMember, fallbackTenantName string) *KailoMembership {
	membership := &KailoMembership{Tenant: KailoScope{
		ID:   d.Tenant.TenantID,
		Name: d.TenantName(fallbackTenantName),
		Role: KailoRoleMember,
	}}
	if m.TenantRole == KailoDirectoryRoleAdmin {
		membership.Tenant.Role = KailoRoleAdmin
		for _, ws := range d.Workspaces {
			membership.Workspaces = append(membership.Workspaces,
				KailoScope{ID: ws.WorkspaceID, Name: d.workspaceName(ws.WorkspaceID), Role: KailoRoleAdmin})
		}
		return membership
	}
	for _, ws := range m.Workspaces {
		membership.Workspaces = append(membership.Workspaces,
			KailoScope{ID: ws.WorkspaceID, Name: d.workspaceName(ws.WorkspaceID), Role: KailoRoleMember})
	}
	return membership
}
