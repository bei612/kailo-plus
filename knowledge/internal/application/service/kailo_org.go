package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// kailoSyncActor is recorded as the audit actor of memberships derived from
// Kailo; no native user granted them.
const kailoSyncActor = "kailo-org-sync"

// kailoOrgService implements interfaces.KailoOrgService (Kailo DD-133 §3).
//
// Mapping, per Kailo Tenant T and Workspace W:
//   - T  → one native space with kailo_scope_ref "tenant:<T>"; every member
//     of T is a member of it.
//   - W  → one native space with kailo_scope_ref "workspace:<W>"; members are
//     the members of W.
//   - T  → one native organisation with kailo_tenant_ref "<T>" whose member
//     spaces are T's mapped spaces, so a knowledge base or agent shared to the
//     organisation reaches every space of the same Kailo Tenant and nothing
//     outside it.
//   - Kailo admin → native admin; Kailo member → native contributor. A
//     Tenant admin is admin in every Workspace space too. Ownership is never
//     granted natively.
//
// Spaces are created lazily by the first login that needs them and keep
// their reference forever (migration 000109), so one Kailo scope always
// resolves to the same native space. Creation is serialised in-process: the
// Kailo deployment runs a single native app instance, and the unique
// reference index rejects a concurrent duplicate from any other writer.
type kailoOrgService struct {
	db            *gorm.DB
	tenantService interfaces.TenantService
	tokenRepo     interfaces.AuthTokenRepository
	audit         interfaces.AuditLogService

	mu sync.Mutex
}

// NewKailoOrgService constructs the Kailo membership projection.
func NewKailoOrgService(
	db *gorm.DB,
	tenantService interfaces.TenantService,
	tokenRepo interfaces.AuthTokenRepository,
	audit interfaces.AuditLogService,
) interfaces.KailoOrgService {
	return &kailoOrgService{db: db, tenantService: tenantService, tokenRepo: tokenRepo, audit: audit}
}

type kailoDesiredSpace struct {
	space *types.Tenant
	role  types.TenantRole
	org   types.OrgMemberRole
}

func (s *kailoOrgService) SyncLogin(
	ctx context.Context,
	user *types.User,
	claim *types.KailoOrgClaim,
) (*types.Tenant, error) {
	if user == nil || claim == nil {
		return nil, errors.New("kailo organisation sync needs a user and a verified claim")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	tenantSpace, err := s.ensureSpace(ctx, claim.TenantScopeRef(), claim.Tenant.Name)
	if err != nil {
		return nil, err
	}
	desired := map[uint64]kailoDesiredSpace{
		tenantSpace.ID: {space: tenantSpace, role: claim.Tenant.Role.NativeTenantRole(), org: types.OrgRoleAdmin},
	}
	for _, ws := range claim.Workspaces {
		space, err := s.ensureSpace(ctx, types.KailoWorkspaceScopeRef(ws.ID), ws.Name)
		if err != nil {
			return nil, err
		}
		role := ws.Role.NativeTenantRole()
		if claim.Tenant.Role == types.KailoRoleAdmin {
			role = types.TenantRoleAdmin
		}
		desired[space.ID] = kailoDesiredSpace{space: space, role: role, org: types.OrgRoleEditor}
	}

	var changes []kailoMembershipChange
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		org, err := s.ensureOrganization(tx, claim, tenantSpace, user.ID)
		if err != nil {
			return err
		}
		for _, d := range desired {
			if err := ensureOrgSpace(tx, org.ID, d.space.ID, d.org, user.ID); err != nil {
				return err
			}
		}
		changes, err = reconcileKailoMemberships(tx, user.ID, desired)
		if err != nil {
			return err
		}
		return setKailoHomeSpace(tx, user, tenantSpace.ID, desired)
	})
	if err != nil {
		return nil, fmt.Errorf("kailo organisation sync failed: %w", err)
	}
	s.emitMembershipAudit(ctx, user.ID, changes)
	removed := false
	for _, change := range changes {
		if change.action == types.AuditActionMemberRemoved {
			removed = true
		}
	}
	if removed && s.tokenRepo != nil {
		// A removed membership must not survive in an earlier session.
		if err := s.tokenRepo.RevokeTokensByUserID(ctx, user.ID); err != nil {
			return nil, fmt.Errorf("kailo organisation sync could not revoke stale sessions: %w", err)
		}
	}
	return tenantSpace, nil
}

// ensureSpace returns the native space representing ref, creating it with
// the native space defaults (including its default storage backend) on
// first use, and keeps its name in step with Kailo.
func (s *kailoOrgService) ensureSpace(ctx context.Context, ref, name string) (*types.Tenant, error) {
	space, err := findKailoSpace(s.db.WithContext(ctx), ref)
	if err != nil {
		return nil, err
	}
	if space == nil {
		ref := ref
		created, createErr := s.tenantService.CreateTenant(ctx, &types.Tenant{
			Name:          name,
			Description:   "Kailo",
			KailoScopeRef: &ref,
		})
		if createErr != nil {
			// Another writer may have created the same scope; the unique
			// reference index rejected our insert. Use the winner.
			space, err = findKailoSpace(s.db.WithContext(ctx), ref)
			if err != nil || space == nil {
				return nil, fmt.Errorf("create native space for %s: %w", ref, createErr)
			}
			return space, nil
		}
		logger.Infof(ctx, "[kailo] created native space %d for %s", created.ID, ref)
		return created, nil
	}
	if space.Name != name {
		if err := s.db.WithContext(ctx).Model(&types.Tenant{}).Where("id = ?", space.ID).
			Updates(map[string]interface{}{"name": name, "updated_at": time.Now()}).Error; err != nil {
			return nil, fmt.Errorf("rename native space %d: %w", space.ID, err)
		}
		space.Name = name
	}
	return space, nil
}

func findKailoSpace(db *gorm.DB, ref string) (*types.Tenant, error) {
	var space types.Tenant
	err := db.Unscoped().Where("kailo_scope_ref = ?", ref).First(&space).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("look up native space for %s: %w", ref, err)
	}
	if space.DeletedAt.Valid {
		// A retired mapped space is never silently replaced by a new one:
		// its knowledge would become unreachable under the same Kailo scope.
		return nil, fmt.Errorf("native space %d for %s has been deleted", space.ID, ref)
	}
	return &space, nil
}

func (s *kailoOrgService) ensureOrganization(
	tx *gorm.DB,
	claim *types.KailoOrgClaim,
	tenantSpace *types.Tenant,
	userID string,
) (*types.Organization, error) {
	ref := claim.Tenant.ID
	var org types.Organization
	err := tx.Where("kailo_tenant_ref = ?", ref).First(&org).Error
	if err == nil {
		if org.Name != claim.Tenant.Name {
			if err := tx.Model(&types.Organization{}).Where("id = ?", org.ID).
				Updates(map[string]interface{}{"name": claim.Tenant.Name, "updated_at": time.Now()}).Error; err != nil {
				return nil, fmt.Errorf("rename Kailo tenant organization: %w", err)
			}
			org.Name = claim.Tenant.Name
		}
		return &org, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("look up Kailo tenant organization: %w", err)
	}
	now := time.Now()
	expired := now.Add(-time.Second)
	org = types.Organization{
		ID:            uuid.New().String(),
		Name:          claim.Tenant.Name,
		Description:   "Kailo",
		OwnerID:       userID,
		OwnerTenantID: tenantSpace.ID,
		// Joining by code is closed in Kailo mode; the code only satisfies
		// the native uniqueness constraint and is already expired.
		InviteCode:          generateInviteCode(),
		InviteCodeExpiresAt: &expired,
		MemberLimit:         0,
		KailoTenantRef:      &ref,
		CreatedAt:           now,
		UpdatedAt:           now,
	}
	if err := tx.Create(&org).Error; err != nil {
		return nil, fmt.Errorf("create Kailo tenant organization: %w", err)
	}
	return &org, nil
}

func ensureOrgSpace(tx *gorm.DB, orgID string, spaceID uint64, role types.OrgMemberRole, userID string) error {
	var member types.OrganizationTenantMember
	err := tx.Where("organization_id = ? AND tenant_id = ?", orgID, spaceID).First(&member).Error
	if err == nil {
		if member.Role == role {
			return nil
		}
		return tx.Model(&types.OrganizationTenantMember{}).Where("id = ?", member.ID).
			Updates(map[string]interface{}{"role": role, "updated_at": time.Now()}).Error
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return fmt.Errorf("look up organization space: %w", err)
	}
	now := time.Now()
	return tx.Create(&types.OrganizationTenantMember{
		ID:                   uuid.New().String(),
		OrganizationID:       orgID,
		TenantID:             spaceID,
		Role:                 role,
		RepresentativeUserID: userID,
		JoinedAt:             &now,
		CreatedAt:            now,
		UpdatedAt:            now,
	}).Error
}

type kailoMembershipChange struct {
	tenantID uint64
	action   types.AuditAction
	oldRole  types.TenantRole
	newRole  types.TenantRole
}

// reconcileKailoMemberships makes the user's memberships of mapped spaces
// equal to desired; memberships of unmapped spaces are left alone.
func reconcileKailoMemberships(
	tx *gorm.DB,
	userID string,
	desired map[uint64]kailoDesiredSpace,
) ([]kailoMembershipChange, error) {
	var current []types.TenantMember
	if err := tx.Table("tenant_members").
		Select("tenant_members.*").
		Joins("JOIN tenants ON tenants.id = tenant_members.tenant_id").
		Where("tenant_members.user_id = ? AND tenant_members.deleted_at IS NULL AND tenants.kailo_scope_ref IS NOT NULL", userID).
		Find(&current).Error; err != nil {
		return nil, fmt.Errorf("list mapped memberships: %w", err)
	}
	var changes []kailoMembershipChange
	now := time.Now()
	seen := make(map[uint64]bool, len(current))
	for _, m := range current {
		d, keep := desired[m.TenantID]
		if !keep {
			if err := tx.Model(&types.TenantMember{}).Where("id = ?", m.ID).
				Update("deleted_at", now).Error; err != nil {
				return nil, fmt.Errorf("remove mapped membership: %w", err)
			}
			changes = append(changes, kailoMembershipChange{tenantID: m.TenantID, action: types.AuditActionMemberRemoved, oldRole: m.Role})
			continue
		}
		seen[m.TenantID] = true
		if m.Role == d.role && m.Status == types.TenantMemberStatusActive {
			continue
		}
		if err := tx.Model(&types.TenantMember{}).Where("id = ?", m.ID).
			Updates(map[string]interface{}{"role": d.role, "status": types.TenantMemberStatusActive, "updated_at": now}).Error; err != nil {
			return nil, fmt.Errorf("update mapped membership: %w", err)
		}
		changes = append(changes, kailoMembershipChange{tenantID: m.TenantID, action: types.AuditActionMemberRoleChanged, oldRole: m.Role, newRole: d.role})
	}
	for tenantID, d := range desired {
		if seen[tenantID] {
			continue
		}
		if err := tx.Create(&types.TenantMember{
			UserID:   userID,
			TenantID: tenantID,
			Role:     d.role,
			Status:   types.TenantMemberStatusActive,
			JoinedAt: now,
		}).Error; err != nil {
			return nil, fmt.Errorf("add mapped membership: %w", err)
		}
		changes = append(changes, kailoMembershipChange{tenantID: tenantID, action: types.AuditActionMemberAdded, newRole: d.role})
	}
	return changes, nil
}

// setKailoHomeSpace makes the Tenant space the user's home and drops a
// last-active preference that no longer points at a desired space.
func setKailoHomeSpace(tx *gorm.DB, user *types.User, homeID uint64, desired map[uint64]kailoDesiredSpace) error {
	changed := false
	if user.TenantID != homeID {
		user.TenantID = homeID
		changed = true
	}
	if last := user.Preferences.LastActiveTenantID; last != nil {
		if _, ok := desired[*last]; !ok {
			if !userHasUnmappedMembership(tx, user.ID, *last) {
				user.Preferences.LastActiveTenantID = nil
				changed = true
			}
		}
	}
	if !changed {
		return nil
	}
	user.UpdatedAt = time.Now()
	return tx.Model(&types.User{}).Where("id = ?", user.ID).Updates(map[string]interface{}{
		"tenant_id":   user.TenantID,
		"preferences": user.Preferences,
		"updated_at":  user.UpdatedAt,
	}).Error
}

func userHasUnmappedMembership(tx *gorm.DB, userID string, tenantID uint64) bool {
	var count int64
	err := tx.Table("tenant_members").
		Joins("JOIN tenants ON tenants.id = tenant_members.tenant_id").
		Where("tenant_members.user_id = ? AND tenant_members.tenant_id = ? AND tenant_members.deleted_at IS NULL "+
			"AND tenant_members.status = ? AND tenants.kailo_scope_ref IS NULL AND tenants.deleted_at IS NULL",
			userID, tenantID, types.TenantMemberStatusActive).
		Count(&count).Error
	return err == nil && count > 0
}

func (s *kailoOrgService) emitMembershipAudit(ctx context.Context, userID string, changes []kailoMembershipChange) {
	if s.audit == nil {
		return
	}
	for _, change := range changes {
		entry := &types.AuditLog{
			TenantID:     change.tenantID,
			ActorUserID:  kailoSyncActor,
			Action:       change.action,
			TargetType:   "tenant_member",
			TargetUserID: userID,
			Outcome:      types.AuditOutcomeSuccess,
		}
		if change.action == types.AuditActionMemberRoleChanged {
			entry.Details = types.JSON(fmt.Sprintf(`{"old_role":%q,"new_role":%q}`, change.oldRole, change.newRole))
		}
		_ = s.audit.Log(ctx, entry)
	}
}
