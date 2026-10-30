package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// Kailo share projection for knowledge bases (DD-164(4), 07 §4.7.4 "schema 2
// 角色派生" and shares[]). Kailo is the only authority of who a knowledge
// base is shared with; this instance only converges kb_shares to the
// directory's shares[]:
//   - WORKSPACE grantee → a Kailo-managed organisation (kailo_share_ref
//     "workspace:<id>") whose only member space is that Workspace's space;
//   - TENANT grantee → the Kailo Tenant organisation (kailo_tenant_ref);
//   - READ → viewer, WRITE → editor (the space roles still cap a viewer).
//
// Every row it writes carries kailo_resource_ref; rows of a Resource no
// longer in the snapshot are removed. PRINCIPAL grantees other than the
// owner are not projected in phase 1 and are reported in the receipt.
//
// Native data is never deleted for the switch (DD-164(4)⑧): before shares[]
// is converged, every native share of a knowledge base into a Kailo
// organisation that is not yet Kailo-managed is adopted — registered with
// Core as a Kailo share (owner: the knowledge base creator's Kailo identity,
// else the sharer's) and, once Core's answer is definite and read back,
// marked with the Resource it now belongs to. Native shares that cannot be
// mapped or are refused stay untouched and are reported; a row without
// kailo_resource_ref is never removed by the projection.

const (
	kailoReasonObjectMissing      = "NATIVE_OBJECT_MISSING"
	kailoReasonSubjectUnsupported = "SUBJECT_NOT_SUPPORTED"
	kailoReasonOrgMissing         = "NATIVE_ORGANIZATION_MISSING"
	kailoReasonUnmappable         = "SUBJECT_UNMAPPABLE"
	kailoReasonOwnerNotMember     = "OWNER_NOT_MEMBER"
	kailoReasonAdoptionRefused    = "ADOPTION_REFUSED"
	kailoReasonAdoptionMismatch   = "ADOPTION_MISMATCH"
)

// kailoWorkspaceShareRef is the kailo_share_ref of a Workspace grantee.
func kailoWorkspaceShareRef(workspaceID string) string {
	return "workspace:" + workspaceID
}

func kailoSharePermission(access string) types.OrgMemberRole {
	if access == types.KailoShareAccessWrite {
		return types.OrgRoleEditor
	}
	return types.OrgRoleViewer
}

// applyKnowledgeBaseShares converges kb_shares with directory.Shares. It
// returns the skipped items for the receipt; an error leaves the snapshot
// unrecorded so the next read retries it.
func (s *kailoOrgService) applyKnowledgeBaseShares(
	ctx context.Context,
	issuer string,
	directory *types.KailoMemberDirectory,
	adopter interfaces.KailoShareAdopter,
) ([]types.KailoReceiptFailure, error) {
	failures := []types.KailoReceiptFailure{}
	db := s.db.WithContext(ctx)

	var tenantOrg *types.Organization
	var org types.Organization
	err := db.Select("id", "owner_id", "owner_tenant_id").
		Where("kailo_tenant_ref = ?", directory.Tenant.TenantID).First(&org).Error
	switch {
	case err == nil:
		tenantOrg = &org
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return nil, fmt.Errorf("look up Kailo tenant organization: %w", err)
	}

	// DD-164(4)⑧: adopt existing native shares first; an indefinite answer
	// stops here and nothing is converged until the next read.
	adopted, adoptionFailures, err := s.adoptNativeShares(ctx, issuer, directory, tenantOrg, adopter)
	if err != nil {
		return nil, err
	}
	failures = append(failures, adoptionFailures...)

	// Resources adopted now are not in this snapshot yet: keep their rows
	// until a snapshot that carries them is converged.
	managed := map[string]bool{}
	for id := range adopted {
		managed[id] = true
	}
	for _, share := range directory.Shares {
		if share.NativeType != types.KailoSharedKnowledgeBase {
			continue // folders belong to the file storage component
		}
		managed[share.ResourceID] = true
		delete(adopted, share.ResourceID)
		var kb types.KnowledgeBase
		err := db.Select("id", "tenant_id", "creator_id").Where("id = ?", share.NativeID).First(&kb).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			failures = append(failures, types.KailoReceiptFailure{
				Kind: types.KailoReceiptKindShare, Ref: share.ResourceID, ReasonCode: kailoReasonObjectMissing})
			// The object is gone: no native row of this Resource may stay.
			if err := s.retireManagedShares(db, share.ResourceID, nil); err != nil {
				return nil, err
			}
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("look up shared knowledge base: %w", err)
		}
		sharer := s.shareOwnerUserID(db, issuer, directory, share, kb)
		desired := map[string]types.OrgMemberRole{}
		unsupported := false
		for _, grant := range share.Grants {
			var orgID string
			switch grant.Subject.Kind {
			case types.KailoShareSubjectPrincipal:
				if grant.Subject.PrincipalID != share.OwnerPrincipalID {
					unsupported = true
				}
				continue
			case types.KailoShareSubjectTenant:
				if tenantOrg == nil {
					failures = append(failures, types.KailoReceiptFailure{
						Kind: types.KailoReceiptKindShare, Ref: share.ResourceID, ReasonCode: kailoReasonOrgMissing})
					continue
				}
				orgID = tenantOrg.ID
			case types.KailoShareSubjectWorkspace:
				id, err := s.ensureWorkspaceShareOrg(db, directory, grant.Subject.WorkspaceID, sharer)
				if err != nil {
					return nil, err
				}
				orgID = id
			default:
				continue
			}
			permission := kailoSharePermission(grant.Access)
			if current, ok := desired[orgID]; !ok || permission.HasPermission(current) {
				desired[orgID] = permission
			}
		}
		if unsupported {
			failures = append(failures, types.KailoReceiptFailure{
				Kind: types.KailoReceiptKindShare, Ref: share.ResourceID, ReasonCode: kailoReasonSubjectUnsupported})
		}
		if err := s.convergeKnowledgeBaseShare(db, share.ResourceID, kb, sharer, desired); err != nil {
			return nil, err
		}
	}
	if err := s.retireAbsentShares(db, managed); err != nil {
		return nil, err
	}
	sort.SliceStable(failures, func(i, j int) bool { return failures[i].Ref < failures[j].Ref })
	return failures, nil
}

// shareOwnerUserID is the native account of the Resource owner when it has
// one in this instance, else the knowledge base creator, else the sync actor.
func (s *kailoOrgService) shareOwnerUserID(
	db *gorm.DB,
	issuer string,
	directory *types.KailoMemberDirectory,
	share types.KailoDirectoryShare,
	kb types.KnowledgeBase,
) string {
	if member := directory.MemberByPrincipal(share.OwnerPrincipalID); member != nil {
		for _, identity := range member.Identities {
			if identity.Issuer != issuer {
				continue
			}
			var user types.User
			if err := db.Select("id").Where("oidc_issuer = ? AND oidc_subject = ?", identity.Issuer, identity.Subject).
				First(&user).Error; err == nil {
				return user.ID
			}
		}
	}
	if kb.CreatorID != "" {
		return kb.CreatorID
	}
	return kailoSyncActor
}

// ensureWorkspaceShareOrg returns the Kailo-managed organisation of one
// Workspace grantee, creating it on first use; its only member space is the
// Workspace's space, as an editor (the share permission caps access).
func (s *kailoOrgService) ensureWorkspaceShareOrg(
	db *gorm.DB,
	directory *types.KailoMemberDirectory,
	workspaceID, ownerUserID string,
) (string, error) {
	space, err := findKailoSpace(db, types.KailoWorkspaceScopeRef(workspaceID))
	if err != nil || space == nil {
		return "", fmt.Errorf("workspace space missing for a share grant: %v", err)
	}
	ref := kailoWorkspaceShareRef(workspaceID)
	name := directory.WorkspaceDisplayName(workspaceID)
	var orgID string
	err = db.Transaction(func(tx *gorm.DB) error {
		var org types.Organization
		err := tx.Select("id", "name").Where("kailo_share_ref = ?", ref).First(&org).Error
		switch {
		case err == nil:
			if org.Name != name {
				if err := tx.Model(&types.Organization{}).Where("id = ?", org.ID).
					Updates(map[string]interface{}{"name": name, "updated_at": time.Now()}).Error; err != nil {
					return fmt.Errorf("rename Kailo workspace share organization: %w", err)
				}
			}
		case errors.Is(err, gorm.ErrRecordNotFound):
			now := time.Now()
			expired := now.Add(-time.Second)
			org = types.Organization{
				ID:            uuid.New().String(),
				Name:          name,
				Description:   "Kailo",
				OwnerID:       ownerUserID,
				OwnerTenantID: space.ID,
				// Joining by code is closed in Kailo mode (see ensureOrganization).
				InviteCode:          generateInviteCode(),
				InviteCodeExpiresAt: &expired,
				MemberLimit:         0,
				KailoShareRef:       &ref,
				CreatedAt:           now,
				UpdatedAt:           now,
			}
			if err := tx.Create(&org).Error; err != nil {
				return fmt.Errorf("create Kailo workspace share organization: %w", err)
			}
		default:
			return fmt.Errorf("look up Kailo workspace share organization: %w", err)
		}
		if err := ensureOrgSpace(tx, org.ID, space.ID, types.OrgRoleEditor, ownerUserID); err != nil {
			return err
		}
		// The organisation stands for this Workspace only.
		if err := tx.Where("organization_id = ? AND tenant_id <> ?", org.ID, space.ID).
			Delete(&types.OrganizationTenantMember{}).Error; err != nil {
			return fmt.Errorf("trim Kailo workspace share organization: %w", err)
		}
		orgID = org.ID
		return nil
	})
	return orgID, err
}

// convergeKnowledgeBaseShare makes the rows of one Resource equal desired
// (organisation → permission). A native row for the same knowledge base and
// organisation is adopted rather than duplicated.
func (s *kailoOrgService) convergeKnowledgeBaseShare(
	db *gorm.DB,
	resourceID string,
	kb types.KnowledgeBase,
	sharer string,
	desired map[string]types.OrgMemberRole,
) error {
	return db.Transaction(func(tx *gorm.DB) error {
		var rows []types.KnowledgeBaseShare
		if err := tx.Where("knowledge_base_id = ? AND (kailo_resource_ref = ? OR organization_id IN ?)",
			kb.ID, resourceID, keysOf(desired)).Find(&rows).Error; err != nil {
			return fmt.Errorf("list knowledge base shares: %w", err)
		}
		now := time.Now()
		seen := map[string]bool{}
		for _, row := range rows {
			permission, keep := desired[row.OrganizationID]
			if !keep || seen[row.OrganizationID] {
				if err := tx.Delete(&types.KnowledgeBaseShare{}, "id = ?", row.ID).Error; err != nil {
					return fmt.Errorf("remove knowledge base share: %w", err)
				}
				continue
			}
			seen[row.OrganizationID] = true
			if row.Permission == permission && row.KailoResourceRef != nil && *row.KailoResourceRef == resourceID {
				continue
			}
			ref := resourceID
			if err := tx.Model(&types.KnowledgeBaseShare{}).Where("id = ?", row.ID).Updates(map[string]interface{}{
				"permission": permission, "kailo_resource_ref": ref, "updated_at": now}).Error; err != nil {
				return fmt.Errorf("update knowledge base share: %w", err)
			}
		}
		for orgID, permission := range desired {
			if seen[orgID] {
				continue
			}
			ref := resourceID
			if err := tx.Create(&types.KnowledgeBaseShare{
				ID:               uuid.New().String(),
				KnowledgeBaseID:  kb.ID,
				OrganizationID:   orgID,
				SharedByUserID:   sharer,
				SourceTenantID:   kb.TenantID,
				Permission:       permission,
				KailoResourceRef: &ref,
				CreatedAt:        now,
				UpdatedAt:        now,
			}).Error; err != nil {
				return fmt.Errorf("create knowledge base share: %w", err)
			}
		}
		return nil
	})
}

// retireManagedShares removes every row of one Resource.
func (s *kailoOrgService) retireManagedShares(db *gorm.DB, resourceID string, _ *types.KnowledgeBase) error {
	if err := db.Where("kailo_resource_ref = ?", resourceID).Delete(&types.KnowledgeBaseShare{}).Error; err != nil {
		return fmt.Errorf("remove shares of a missing knowledge base: %w", err)
	}
	return nil
}

// retireAbsentShares removes the Kailo-managed rows of Resources no longer
// in the snapshot (unshared in Kailo, or the Resource ended). A native row
// (kailo_resource_ref NULL) is never removed here: it is adopted first or
// left untouched and reported (DD-164(4)⑧).
func (s *kailoOrgService) retireAbsentShares(db *gorm.DB, managed map[string]bool) error {
	var rows []types.KnowledgeBaseShare
	if err := db.Select("id", "kailo_resource_ref").
		Where("deleted_at IS NULL AND kailo_resource_ref IS NOT NULL").Find(&rows).Error; err != nil {
		return fmt.Errorf("list Kailo knowledge base shares: %w", err)
	}
	var retire []string
	for _, row := range rows {
		if managed[strings.ToLower(*row.KailoResourceRef)] {
			continue
		}
		retire = append(retire, row.ID)
	}
	if len(retire) == 0 {
		return nil
	}
	if err := db.Where("id IN ?", retire).Delete(&types.KnowledgeBaseShare{}).Error; err != nil {
		return fmt.Errorf("retire knowledge base shares: %w", err)
	}
	logger.Infof(context.Background(), "[kailo] retired %d knowledge base shares no longer granted in Kailo", len(retire))
	return nil
}

// adoptNativeShares registers every not-yet-managed native share of a
// knowledge base into a Kailo organisation with Core (DD-164(4)⑧) and marks
// the adopted rows with their Resource. It returns the Resources marked in
// this call. A definite refusal or an unmappable share is a receipt failure
// and leaves the rows untouched; an indefinite answer is an error.
func (s *kailoOrgService) adoptNativeShares(
	ctx context.Context,
	issuer string,
	directory *types.KailoMemberDirectory,
	tenantOrg *types.Organization,
	adopter interfaces.KailoShareAdopter,
) (map[string]bool, []types.KailoReceiptFailure, error) {
	adopted := map[string]bool{}
	failures := []types.KailoReceiptFailure{}
	if adopter == nil {
		return adopted, failures, nil
	}
	db := s.db.WithContext(ctx)
	type nativeRow struct {
		ID              string
		KnowledgeBaseID string
		OrganizationID  string
		SharedByUserID  string
		Permission      types.OrgMemberRole
		TenantRef       *string
		ShareRef        *string
	}
	var rows []nativeRow
	if err := db.Table("kb_shares").
		Select("kb_shares.id, kb_shares.knowledge_base_id, kb_shares.organization_id, kb_shares.shared_by_user_id, "+
			"kb_shares.permission, organizations.kailo_tenant_ref AS tenant_ref, organizations.kailo_share_ref AS share_ref").
		Joins("JOIN organizations ON organizations.id = kb_shares.organization_id").
		Where("kb_shares.deleted_at IS NULL AND kb_shares.kailo_resource_ref IS NULL AND "+
			"(organizations.kailo_tenant_ref IS NOT NULL OR organizations.kailo_share_ref IS NOT NULL)").
		Order("kb_shares.knowledge_base_id, kb_shares.id").Scan(&rows).Error; err != nil {
		return nil, nil, fmt.Errorf("list native knowledge base shares: %w", err)
	}
	workspaces := map[string]bool{}
	for _, ws := range directory.Workspaces {
		workspaces[ws.WorkspaceID] = true
	}
	byKB := map[string][]nativeRow{}
	var order []string
	for _, row := range rows {
		if _, ok := byKB[row.KnowledgeBaseID]; !ok {
			order = append(order, row.KnowledgeBaseID)
		}
		byKB[row.KnowledgeBaseID] = append(byKB[row.KnowledgeBaseID], row)
	}
	fail := func(kbID, reason string) {
		failures = append(failures, types.KailoReceiptFailure{
			Kind: types.KailoReceiptKindShare, Ref: truncateRunes(kbID, 64), ReasonCode: reason})
	}
	for _, kbID := range order {
		var kb types.KnowledgeBase
		if err := db.Select("id", "name", "tenant_id", "creator_id").Where("id = ?", kbID).First(&kb).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				continue // shares of a deleted knowledge base reach nobody
			}
			return nil, nil, fmt.Errorf("look up shared knowledge base: %w", err)
		}
		// Map each native share to a Kailo grant; the strongest wins per subject.
		grants := map[types.KailoShareSubject]string{}
		var mapped []string
		for _, row := range byKB[kbID] {
			var subject types.KailoShareSubject
			switch {
			case row.TenantRef != nil && tenantOrg != nil && row.OrganizationID == tenantOrg.ID:
				subject = types.KailoShareSubject{Kind: types.KailoShareSubjectTenant}
			case row.ShareRef != nil && strings.HasPrefix(*row.ShareRef, "workspace:") &&
				workspaces[strings.TrimPrefix(*row.ShareRef, "workspace:")]:
				subject = types.KailoShareSubject{Kind: types.KailoShareSubjectWorkspace,
					WorkspaceID: strings.TrimPrefix(*row.ShareRef, "workspace:")}
			default:
				fail(kbID, kailoReasonUnmappable)
				continue
			}
			access := types.KailoShareAccessRead
			if row.Permission.HasPermission(types.OrgRoleEditor) {
				access = types.KailoShareAccessWrite
			}
			if grants[subject] != types.KailoShareAccessWrite {
				grants[subject] = access
			}
			mapped = append(mapped, row.ID)
		}
		if len(mapped) == 0 {
			continue
		}
		candidates := []string{kb.CreatorID}
		for _, row := range byKB[kbID] {
			candidates = append(candidates, row.SharedByUserID)
		}
		owner := s.adoptionOwner(db, issuer, directory, candidates)
		if owner == nil {
			fail(kbID, kailoReasonOwnerNotMember)
			continue
		}
		request := &types.KailoShareAdoptionRequest{
			NativeType: types.KailoSharedKnowledgeBase,
			NativeID:   kb.ID,
			Name:       kailoShareName(kb.Name, kb.ID),
			Owner:      *owner,
			Grants:     sortedGrants(grants),
		}
		var space types.Tenant
		if err := db.Select("id", "kailo_scope_ref").Where("id = ?", kb.TenantID).First(&space).Error; err == nil &&
			space.KailoScopeRef != nil && strings.HasPrefix(*space.KailoScopeRef, types.KailoScopeRefWorkspacePrefix) {
			if id := strings.TrimPrefix(*space.KailoScopeRef, types.KailoScopeRefWorkspacePrefix); workspaces[id] {
				request.WorkspaceID = id
			}
		}
		result, err := adopter.AdoptShare(ctx, request)
		if errors.Is(err, types.ErrKailoShareAdoptionRefused) {
			fail(kbID, kailoReasonAdoptionRefused)
			continue
		}
		if err != nil {
			return nil, nil, fmt.Errorf("share adoption not definite: %w", err)
		}
		// Read back: a Resource created by this adoption must carry exactly
		// the grants asked for; an existing Resource is Kailo's and wins.
		if result.Adopted && !sameGrants(result.Grants, request.Grants) {
			fail(kbID, kailoReasonAdoptionMismatch)
			continue
		}
		ref := result.ResourceID
		if err := db.Model(&types.KnowledgeBaseShare{}).Where("id IN ? AND kailo_resource_ref IS NULL", mapped).
			Updates(map[string]interface{}{"kailo_resource_ref": ref, "updated_at": time.Now()}).Error; err != nil {
			return nil, nil, fmt.Errorf("mark adopted knowledge base shares: %w", err)
		}
		adopted[ref] = true
		logger.Infof(ctx, "[kailo] native shares of knowledge base %s adopted as Kailo Resource %s (created=%v)",
			kb.ID, ref, result.Adopted)
	}
	return adopted, failures, nil
}

// adoptionOwner is the Kailo identity of the knowledge base creator, else of
// a sharer, among the members of this snapshot and this issuer; nil if none.
func (s *kailoOrgService) adoptionOwner(
	db *gorm.DB, issuer string, directory *types.KailoMemberDirectory, candidates []string,
) *types.KailoShareAdoptionOwner {
	for _, userID := range candidates {
		if userID == "" {
			continue
		}
		var user types.User
		if err := db.Select("id", "oidc_issuer", "oidc_subject").Where("id = ?", userID).First(&user).Error; err != nil ||
			user.OIDCIssuer == nil || user.OIDCSubject == nil || *user.OIDCIssuer != issuer {
			continue
		}
		if directory.MemberFor(*user.OIDCIssuer, *user.OIDCSubject) == nil {
			continue
		}
		return &types.KailoShareAdoptionOwner{Issuer: *user.OIDCIssuer, Subject: *user.OIDCSubject}
	}
	return nil
}

func sortedGrants(grants map[types.KailoShareSubject]string) []types.KailoShareGrant {
	out := make([]types.KailoShareGrant, 0, len(grants))
	for subject, access := range grants {
		out = append(out, types.KailoShareGrant{Subject: subject, Access: access})
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i].Subject, out[j].Subject
		if a.Kind != b.Kind {
			return a.Kind < b.Kind
		}
		return a.WorkspaceID+a.PrincipalID < b.WorkspaceID+b.PrincipalID
	})
	return out
}

func sameGrants(a, b []types.KailoShareGrant) bool {
	if len(a) != len(b) {
		return false
	}
	want := map[types.KailoShareGrant]bool{}
	for _, g := range b {
		want[normaliseGrant(g)] = true
	}
	for _, g := range a {
		if !want[normaliseGrant(g)] {
			return false
		}
	}
	return true
}

func normaliseGrant(g types.KailoShareGrant) types.KailoShareGrant {
	g.Subject.PrincipalID = strings.ToLower(g.Subject.PrincipalID)
	g.Subject.WorkspaceID = strings.ToLower(g.Subject.WorkspaceID)
	return g
}

func keysOf(m map[string]types.OrgMemberRole) []string {
	keys := make([]string, 0, len(m)+1)
	for k := range m {
		keys = append(keys, k)
	}
	if len(keys) == 0 {
		// IN () is invalid SQL; an impossible id keeps the query well-formed.
		keys = append(keys, "")
	}
	return keys
}
