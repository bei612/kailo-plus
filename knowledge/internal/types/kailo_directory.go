package types

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

// Kailo member directory (Kailo DD-133(4), 07 §4.7.4): the read-only full
// snapshot Core answers to this component instance's own directory client.
// This instance reads schema 2 only (DD-164(2),
// contracts/api/component_member_directory_v2.schema.json): schema 1 plus
// Kailo create permissions and the Resource-level share projection. Roles,
// memberships and knowledge base shares of the Kailo Tenant this instance
// serves come only from it.

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
	Create      bool               `json:"create"`
}

// KailoDirectoryMember is one ACTIVE HUMAN member in the binding scope.
type KailoDirectoryMember struct {
	PrincipalID  string                     `json:"principalId"`
	DisplayName  string                     `json:"displayName"`
	TenantRole   KailoDirectoryRole         `json:"tenantRole"`
	TenantCreate bool                       `json:"tenantCreate"`
	Identities   []KailoDirectoryIdentity   `json:"identities"`
	Workspaces   []KailoDirectoryMembership `json:"workspaces"`
}

// Share subject kinds and accesses of the share projection (DD-164(4)).
const (
	KailoShareSubjectPrincipal = "PRINCIPAL"
	KailoShareSubjectWorkspace = "WORKSPACE"
	KailoShareSubjectTenant    = "TENANT"
	KailoShareAccessRead       = "READ"
	KailoShareAccessWrite      = "WRITE"
	// KailoSharedKnowledgeBase is the native type this component projects;
	// shares of other native types (folders) belong to other components.
	KailoSharedKnowledgeBase = "knowledge_base"
	KailoSharedFolder        = "folder"
)

// KailoShareSubject is the grantee of one share grant.
type KailoShareSubject struct {
	Kind        string `json:"kind"`
	PrincipalID string `json:"principalId,omitempty"`
	WorkspaceID string `json:"workspaceId,omitempty"`
}

// KailoShareGrant is one grant on a component shared object.
type KailoShareGrant struct {
	Subject KailoShareSubject `json:"subject"`
	Access  string            `json:"access"`
}

// KailoDirectoryShare is one ACTIVE component.shared_object Resource of the
// binding with its complete grant list (owner first as WRITE).
type KailoDirectoryShare struct {
	ResourceID       string            `json:"resourceId"`
	NativeType       string            `json:"nativeType"`
	NativeID         string            `json:"nativeId"`
	OwnerPrincipalID string            `json:"ownerPrincipalId"`
	Grants           []KailoShareGrant `json:"grants"`
}

// KailoMemberDirectory is one complete directory snapshot (schema 2).
type KailoMemberDirectory struct {
	Schema           int                       `json:"schema"`
	BindingID        string                    `json:"bindingId"`
	DirectoryVersion string                    `json:"directoryVersion"`
	Tenant           KailoDirectoryTenant      `json:"tenant"`
	Workspaces       []KailoDirectoryWorkspace `json:"workspaces"`
	Members          []KailoDirectoryMember    `json:"members"`
	Shares           []KailoDirectoryShare     `json:"shares"`
}

// KailoDirectorySchema is the only directory schema this instance reads.
const KailoDirectorySchema = 2

// The wire forms keep every required member as a pointer so an absent field
// is told apart from an empty one; unknown fields are refused (the schema is
// additionalProperties=false everywhere).
type wireDirectory struct {
	Schema           *int                      `json:"schema"`
	BindingID        *string                   `json:"bindingId"`
	DirectoryVersion *string                   `json:"directoryVersion"`
	Tenant           *wireDirectoryTenant      `json:"tenant"`
	Workspaces       *[]wireDirectoryWorkspace `json:"workspaces"`
	Members          *[]wireDirectoryMember    `json:"members"`
	Shares           *[]wireDirectoryShare     `json:"shares"`
}

type wireShareSubject struct {
	Kind        *string `json:"kind"`
	PrincipalID *string `json:"principalId"`
	WorkspaceID *string `json:"workspaceId"`
}

type wireShareGrant struct {
	Subject *wireShareSubject `json:"subject"`
	Access  *string           `json:"access"`
}

type wireDirectoryShare struct {
	ResourceID       *string           `json:"resourceId"`
	NativeType       *string           `json:"nativeType"`
	NativeID         *string           `json:"nativeId"`
	OwnerPrincipalID *string           `json:"ownerPrincipalId"`
	Grants           *[]wireShareGrant `json:"grants"`
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
	Create      *bool   `json:"create"`
}

type wireDirectoryMember struct {
	PrincipalID  *string                    `json:"principalId"`
	DisplayName  *string                    `json:"displayName"`
	TenantRole   *string                    `json:"tenantRole"`
	TenantCreate *bool                      `json:"tenantCreate"`
	Identities   *[]wireDirectoryIdentity   `json:"identities"`
	Workspaces   *[]wireDirectoryMembership `json:"workspaces"`
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
	if wire.Schema == nil || *wire.Schema != KailoDirectorySchema {
		// Schema 1 (no create permissions, no shares) is never read as
		// schema 2: the last applied state stays (DD-164(2)).
		return nil, invalidDirectory("schema")
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
	if wire.Workspaces == nil || wire.Members == nil || wire.Shares == nil {
		return nil, invalidDirectory("workspaces, members and shares are required")
	}
	out := &KailoMemberDirectory{
		Schema:           KailoDirectorySchema,
		BindingID:        strings.ToLower(*wire.BindingID),
		DirectoryVersion: *wire.DirectoryVersion,
		Tenant:           KailoDirectoryTenant{TenantID: strings.ToLower(*wire.Tenant.TenantID), Name: *wire.Tenant.Name},
		Workspaces:       []KailoDirectoryWorkspace{},
		Members:          []KailoDirectoryMember{},
		Shares:           []KailoDirectoryShare{},
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
			m.TenantCreate == nil || m.Identities == nil || m.Workspaces == nil {
			return nil, invalidDirectory("member")
		}
		member := KailoDirectoryMember{
			PrincipalID:  strings.ToLower(*m.PrincipalID),
			DisplayName:  *m.DisplayName,
			TenantRole:   role,
			TenantCreate: *m.TenantCreate,
			Identities:   []KailoDirectoryIdentity{},
			Workspaces:   []KailoDirectoryMembership{},
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
			if ws.WorkspaceID == nil || !ok || ws.Create == nil {
				return nil, invalidDirectory("membership")
			}
			id := strings.ToLower(*ws.WorkspaceID)
			if !known[id] || seen[id] {
				return nil, invalidDirectory("membership outside the snapshot workspaces")
			}
			seen[id] = true
			member.Workspaces = append(member.Workspaces,
				KailoDirectoryMembership{WorkspaceID: id, Role: wsRole, Create: *ws.Create})
		}
		out.Members = append(out.Members, member)
	}
	resources := map[string]bool{}
	for _, sh := range *wire.Shares {
		share, err := parseDirectoryShare(sh, known)
		if err != nil {
			return nil, err
		}
		if resources[share.ResourceID] {
			return nil, invalidDirectory("duplicate share")
		}
		resources[share.ResourceID] = true
		out.Shares = append(out.Shares, share)
	}
	return out, nil
}

// kailoShareNativeID is 1-255 visible characters (07 §4.7.4 share intents).
var kailoShareNativeID = regexp.MustCompile(`^[\x21-\x7e]{1,255}$`)

func parseDirectoryShare(sh wireDirectoryShare, workspaces map[string]bool) (KailoDirectoryShare, error) {
	var share KailoDirectoryShare
	if sh.ResourceID == nil || !kailoDirectoryUUID.MatchString(*sh.ResourceID) ||
		sh.OwnerPrincipalID == nil || !kailoDirectoryUUID.MatchString(*sh.OwnerPrincipalID) ||
		sh.NativeType == nil || (*sh.NativeType != KailoSharedKnowledgeBase && *sh.NativeType != KailoSharedFolder) ||
		sh.NativeID == nil || !kailoShareNativeID.MatchString(*sh.NativeID) || sh.Grants == nil {
		return share, invalidDirectory("share")
	}
	share = KailoDirectoryShare{
		ResourceID:       strings.ToLower(*sh.ResourceID),
		NativeType:       *sh.NativeType,
		NativeID:         *sh.NativeID,
		OwnerPrincipalID: strings.ToLower(*sh.OwnerPrincipalID),
		Grants:           []KailoShareGrant{},
	}
	for _, g := range *sh.Grants {
		if g.Subject == nil || g.Subject.Kind == nil || g.Access == nil ||
			(*g.Access != KailoShareAccessRead && *g.Access != KailoShareAccessWrite) {
			return share, invalidDirectory("share grant")
		}
		subject := KailoShareSubject{Kind: *g.Subject.Kind}
		switch subject.Kind {
		case KailoShareSubjectPrincipal:
			if g.Subject.PrincipalID == nil || !kailoDirectoryUUID.MatchString(*g.Subject.PrincipalID) ||
				g.Subject.WorkspaceID != nil {
				return share, invalidDirectory("share principal")
			}
			subject.PrincipalID = strings.ToLower(*g.Subject.PrincipalID)
		case KailoShareSubjectWorkspace:
			if g.Subject.WorkspaceID == nil || g.Subject.PrincipalID != nil ||
				!workspaces[strings.ToLower(*g.Subject.WorkspaceID)] {
				return share, invalidDirectory("share workspace outside the snapshot")
			}
			subject.WorkspaceID = strings.ToLower(*g.Subject.WorkspaceID)
		case KailoShareSubjectTenant:
			// DD-164(4)③ (amended 1c803580): all Tenant members may READ or WRITE.
			if g.Subject.PrincipalID != nil || g.Subject.WorkspaceID != nil {
				return share, invalidDirectory("share tenant")
			}
		default:
			return share, invalidDirectory("share subject")
		}
		share.Grants = append(share.Grants, KailoShareGrant{Subject: subject, Access: *g.Access})
	}
	return share, nil
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

// Membership maps one directory member onto the native projection
// (DD-164(3), 07 §4.7.4 "schema 2 角色派生"): Tenant ADMIN → admin of the
// Tenant space and of every Workspace space in the snapshot; otherwise the
// Tenant space role follows tenantCreate (contributor) or not (viewer), and
// each Workspace space the member belongs to follows that Workspace's role
// (ADMIN → admin) and create (contributor, else viewer).
func (d *KailoMemberDirectory) Membership(m *KailoDirectoryMember, fallbackTenantName string) *KailoMembership {
	membership := &KailoMembership{Tenant: KailoScope{
		ID:     d.Tenant.TenantID,
		Name:   d.TenantName(fallbackTenantName),
		Role:   KailoRoleMember,
		Create: m.TenantCreate,
	}}
	if m.TenantRole == KailoDirectoryRoleAdmin {
		membership.Tenant.Role = KailoRoleAdmin
		membership.Tenant.Create = true
		for _, ws := range d.Workspaces {
			membership.Workspaces = append(membership.Workspaces,
				KailoScope{ID: ws.WorkspaceID, Name: d.workspaceName(ws.WorkspaceID), Role: KailoRoleAdmin, Create: true})
		}
		return membership
	}
	for _, ws := range m.Workspaces {
		role := KailoRoleMember
		if ws.Role == KailoDirectoryRoleAdmin {
			role = KailoRoleAdmin
		}
		membership.Workspaces = append(membership.Workspaces,
			KailoScope{ID: ws.WorkspaceID, Name: d.workspaceName(ws.WorkspaceID), Role: role, Create: ws.Create})
	}
	return membership
}

// MemberByPrincipal returns the member with principalID, or nil.
func (d *KailoMemberDirectory) MemberByPrincipal(principalID string) *KailoDirectoryMember {
	for i := range d.Members {
		if d.Members[i].PrincipalID == principalID {
			return &d.Members[i]
		}
	}
	return nil
}

// ParseRecordedKailoMemberDirectory reads the snapshot this instance
// recorded. A snapshot recorded before the schema 2 upgrade (schema 1, no
// create permissions and no shares) keeps its schema 1 meaning until the
// first schema 2 snapshot is applied: every member keeps the contributor
// projection it had, nobody is refused at login for the upgrade alone.
func ParseRecordedKailoMemberDirectory(raw []byte) (*KailoMemberDirectory, error) {
	if snapshot, err := ParseKailoMemberDirectory(raw); err == nil {
		return snapshot, nil
	}
	var legacy map[string]interface{}
	if err := json.Unmarshal(raw, &legacy); err != nil {
		return nil, invalidDirectory("recorded snapshot")
	}
	if _, upgraded := legacy["schema"]; upgraded {
		return nil, invalidDirectory("recorded snapshot")
	}
	legacy["schema"] = KailoDirectorySchema
	legacy["shares"] = []interface{}{}
	members, _ := legacy["members"].([]interface{})
	for _, m := range members {
		member, ok := m.(map[string]interface{})
		if !ok {
			return nil, invalidDirectory("recorded member")
		}
		member["tenantCreate"] = true
		workspaces, _ := member["workspaces"].([]interface{})
		for _, ws := range workspaces {
			if membership, ok := ws.(map[string]interface{}); ok {
				membership["create"] = true
			}
		}
	}
	upgraded, err := json.Marshal(legacy)
	if err != nil {
		return nil, invalidDirectory("recorded snapshot")
	}
	snapshot, err := ParseKailoMemberDirectory(upgraded)
	if err != nil {
		return nil, err
	}
	snapshot.Schema = 1
	return snapshot, nil
}

// Receipt failure kinds and outcomes (DD-164(4)⑥,
// contracts/api/component_directory_receipt_request.schema.json).
const (
	KailoReceiptKindTenant    = "TENANT"
	KailoReceiptKindMember    = "MEMBER"
	KailoReceiptKindWorkspace = "WORKSPACE"
	KailoReceiptKindShare     = "SHARE"
	KailoReceiptApplied       = "APPLIED"
	KailoReceiptFailed        = "FAILED"
	// KailoReceiptMaxFailures bounds the reported items (contract maxItems).
	KailoReceiptMaxFailures = 100
)

// KailoReceiptFailure is one item the component could not converge. It
// names Kailo ids and a reason code only, never personal data.
type KailoReceiptFailure struct {
	Kind       string `json:"kind"`
	Ref        string `json:"ref"`
	ReasonCode string `json:"reasonCode"`
}

// KailoDirectoryApplyResult is the outcome of converging one snapshot.
type KailoDirectoryApplyResult struct {
	// Applied is false when the snapshot's version was already recorded.
	Applied bool
	// AppliedAt is when the recorded snapshot was completely applied.
	AppliedAt time.Time
	// Failures are the items skipped while applying the recorded snapshot.
	Failures []KailoReceiptFailure
}

// WorkspaceDisplayName is the exported form of workspaceName for the share
// projection's per-Workspace organisations.
func (d *KailoMemberDirectory) WorkspaceDisplayName(id string) string { return d.workspaceName(id) }

// KailoShareAdoptionRequest registers one existing native share as a Kailo
// share (DD-164(4)⑧, contracts/api/component_share_adoption_request.schema.json).
type KailoShareAdoptionRequest struct {
	NativeType  string                  `json:"nativeType"`
	NativeID    string                  `json:"nativeId"`
	Name        string                  `json:"name"`
	Owner       KailoShareAdoptionOwner `json:"owner"`
	WorkspaceID string                  `json:"workspaceId,omitempty"`
	Grants      []KailoShareGrant       `json:"grants"`
}

// KailoShareAdoptionOwner is the native owner's Kailo identity.
type KailoShareAdoptionOwner struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
}

// KailoShareAdoptionResult is Core's answer: the Resource now authoritative
// for the native object, its grants without the owner, and whether this call
// created it (false: it existed and nothing changed).
type KailoShareAdoptionResult struct {
	ResourceID       string            `json:"resourceId"`
	OwnerPrincipalID string            `json:"ownerPrincipalId"`
	Adopted          bool              `json:"adopted"`
	Grants           []KailoShareGrant `json:"grants"`
}

// ErrKailoShareAdoptionRefused is a definite refusal of an adoption (Core
// answered 4xx): the native share stays untouched and is reported.
var ErrKailoShareAdoptionRefused = errors.New("kailo share adoption refused")
