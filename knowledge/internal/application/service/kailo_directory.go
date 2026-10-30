package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
)

// Kailo member directory projection (DD-133(4), 07 §4.7.4 WeKnora table).
// ApplyDirectory converges the whole instance with one complete snapshot;
// the login path (userService.LoginWithOIDC) reads the recorded snapshot so
// a sign-in never falls back to the pre-directory member role.

// kailoMemberDirectoryRow is the single recorded snapshot (migration 000110).
type kailoMemberDirectoryRow struct {
	ID               int       `gorm:"column:id;primaryKey"`
	BindingID        string    `gorm:"column:binding_id"`
	DirectoryVersion string    `gorm:"column:directory_version"`
	Snapshot         string    `gorm:"column:snapshot"`
	AppliedAt        time.Time `gorm:"column:applied_at"`
	// ReceiptFailures is the JSON array of items this snapshot could not
	// converge (migration 000111), reported in the receipt (DD-164(4)⑥).
	ReceiptFailures string `gorm:"column:receipt_failures"`
}

func (row *kailoMemberDirectoryRow) failures() []types.KailoReceiptFailure {
	failures := []types.KailoReceiptFailure{}
	if row == nil || row.ReceiptFailures == "" {
		return failures
	}
	if err := json.Unmarshal([]byte(row.ReceiptFailures), &failures); err != nil {
		return []types.KailoReceiptFailure{}
	}
	return failures
}

func (kailoMemberDirectoryRow) TableName() string { return "kailo_member_directory" }

// kailoDirectoryEmailDomain is a reserved, never-deliverable domain (RFC
// 2606): an account pre-provisioned from the directory has no address yet,
// because the directory carries none (07 §4.7.4). The native column is
// unique and required, so the placeholder is derived from the identity; the
// first login replaces it with the verified OIDC email (07 §4.7.3).
const kailoDirectoryEmailDomain = "directory.kailo.invalid"

func (s *kailoOrgService) recordedDirectory(db *gorm.DB) (*kailoMemberDirectoryRow, error) {
	var row kailoMemberDirectoryRow
	err := db.Where("id = ?", 1).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read recorded member directory: %w", err)
	}
	return &row, nil
}

// DirectorySnapshot implements interfaces.KailoOrgService.
func (s *kailoOrgService) DirectorySnapshot(ctx context.Context, bindingID string) (*types.KailoMemberDirectory, error) {
	row, err := s.recordedDirectory(s.db.WithContext(ctx))
	if err != nil || row == nil || !strings.EqualFold(row.BindingID, bindingID) {
		// A snapshot recorded for another binding says nothing about this one.
		return nil, err
	}
	snapshot, err := types.ParseRecordedKailoMemberDirectory([]byte(row.Snapshot))
	if err != nil {
		return nil, fmt.Errorf("recorded member directory is unreadable: %w", err)
	}
	return snapshot, nil
}

// ApplyDirectory implements interfaces.KailoOrgService.
func (s *kailoOrgService) ApplyDirectory(
	ctx context.Context,
	issuer, fallbackTenantName string,
	directory *types.KailoMemberDirectory,
) (*types.KailoDirectoryApplyResult, error) {
	if directory == nil || strings.TrimSpace(issuer) == "" {
		return nil, errors.New("kailo directory sync needs a snapshot and the OIDC issuer")
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	recorded, err := s.recordedDirectory(s.db.WithContext(ctx))
	if err != nil {
		return nil, err
	}
	if recorded != nil && strings.EqualFold(recorded.BindingID, directory.BindingID) &&
		recorded.DirectoryVersion == directory.DirectoryVersion {
		return &types.KailoDirectoryApplyResult{AppliedAt: recorded.AppliedAt, Failures: recorded.failures()}, nil
	}

	// Every space the snapshot names exists (and carries the directory name)
	// whether or not anybody is in it yet.
	tenantRef := types.KailoScopeRefTenantPrefix + directory.Tenant.TenantID
	if _, err := s.ensureSpace(ctx, tenantRef, directory.TenantName(fallbackTenantName)); err != nil {
		return nil, err
	}
	for _, ws := range directory.Workspaces {
		name := types.NormaliseKailoName(ws.Name)
		if name == "" {
			name = ws.WorkspaceID
		}
		if _, err := s.ensureSpace(ctx, types.KailoWorkspaceScopeRef(ws.WorkspaceID), name); err != nil {
			return nil, err
		}
	}

	keep := map[string]bool{}
	for i := range directory.Members {
		member := &directory.Members[i]
		membership := directory.Membership(member, fallbackTenantName)
		for _, identity := range member.Identities {
			if identity.Issuer != issuer {
				continue // another issuer cannot sign in to this instance
			}
			user, err := s.directoryUser(ctx, identity, member.DisplayName)
			if err != nil {
				return nil, err
			}
			if user == nil {
				continue
			}
			if err := s.refreshDirectoryProfile(ctx, user, identity, member.DisplayName); err != nil {
				return nil, err
			}
			if _, err := s.syncLocked(ctx, user, membership); err != nil {
				return nil, err
			}
			keep[user.ID] = true
		}
	}
	if err := s.removeAbsent(ctx, keep); err != nil {
		return nil, err
	}
	if err := s.linkDirectorySpaces(ctx, directory); err != nil {
		return nil, err
	}
	failures, err := s.applyKnowledgeBaseShares(ctx, issuer, directory)
	if err != nil {
		return nil, err
	}
	if len(failures) > types.KailoReceiptMaxFailures {
		failures = failures[:types.KailoReceiptMaxFailures]
	}

	raw, err := json.Marshal(directory)
	if err != nil {
		return nil, fmt.Errorf("encode member directory: %w", err)
	}
	failuresRaw, err := json.Marshal(failures)
	if err != nil {
		return nil, fmt.Errorf("encode directory receipt failures: %w", err)
	}
	row := kailoMemberDirectoryRow{ID: 1, BindingID: directory.BindingID,
		DirectoryVersion: directory.DirectoryVersion, Snapshot: string(raw), AppliedAt: time.Now(),
		ReceiptFailures: string(failuresRaw)}
	if err := s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns([]string{"binding_id", "directory_version", "snapshot", "applied_at",
			"receipt_failures"}),
	}).Create(&row).Error; err != nil {
		return nil, fmt.Errorf("record member directory: %w", err)
	}
	logger.Infof(ctx, "[kailo] member directory applied: %d members, %d shares, %d share items skipped",
		len(directory.Members), len(directory.Shares), len(failures))
	return &types.KailoDirectoryApplyResult{Applied: true, AppliedAt: row.AppliedAt, Failures: failures}, nil
}

// refreshDirectoryProfile keeps the native display name and avatar of a
// directory member equal to Kailo's (DD-164(9)): the directory's display
// name wins over the IdP name; a name another account already shows gets
// the short identity digest appended, and if that is taken too the current
// name stays.
func (s *kailoOrgService) refreshDirectoryProfile(
	ctx context.Context,
	user *types.User,
	identity types.KailoDirectoryIdentity,
	displayName string,
) error {
	updates := map[string]interface{}{}
	if base := normaliseDisplayName(displayName); base != "" && base != user.Username {
		digest := sha256.Sum256([]byte(identity.Issuer + "\x00" + identity.Subject))
		short := hex.EncodeToString(digest[:])
		for _, candidate := range []string{base, truncateRunes(base, usernameMaxRunes-11) + " (" + short[:8] + ")"} {
			var n int64
			if err := s.db.WithContext(ctx).Unscoped().Model(&types.User{}).
				Where("username = ? AND id <> ?", candidate, user.ID).Count(&n).Error; err != nil {
				return fmt.Errorf("check directory display name: %w", err)
			}
			if n == 0 {
				if candidate != user.Username {
					updates["username"] = candidate
					user.Username = candidate
				}
				break
			}
		}
	}
	if avatar := oidcAvatar(map[string]interface{}{"picture": identity.Picture}); avatar != user.Avatar {
		updates["avatar"] = avatar
		user.Avatar = avatar
	}
	if len(updates) == 0 {
		return nil
	}
	updates["updated_at"] = time.Now()
	if err := s.db.WithContext(ctx).Model(&types.User{}).Where("id = ?", user.ID).Updates(updates).Error; err != nil {
		return fmt.Errorf("refresh directory profile: %w", err)
	}
	return nil
}

// directoryUser returns the native account of identity, pre-provisioning it
// with the shape of a first OIDC login (no personal space, OIDC-only) when
// there is none. It returns nil, nil for an identity held by a deleted
// account: the identity pair stays reserved by that account (migration
// 000024), so it is reported and skipped rather than blocking the sync.
func (s *kailoOrgService) directoryUser(
	ctx context.Context,
	identity types.KailoDirectoryIdentity,
	displayName string,
) (*types.User, error) {
	db := s.db.WithContext(ctx)
	var user types.User
	err := db.Unscoped().Where("oidc_issuer = ? AND oidc_subject = ?", identity.Issuer, identity.Subject).First(&user).Error
	if err == nil {
		if user.DeletedAt.Valid {
			logger.Warnf(ctx, "[kailo] member directory: identity belongs to deleted account %s; skipped", user.ID)
			return nil, nil
		}
		return &user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, fmt.Errorf("look up directory identity: %w", err)
	}

	digest := sha256.Sum256([]byte(identity.Issuer + "\x00" + identity.Subject))
	short := hex.EncodeToString(digest[:])
	username, err := s.directoryUsername(db, displayName, short)
	if err != nil {
		return nil, err
	}
	password, err := generateRandomString(32)
	if err != nil {
		return nil, fmt.Errorf("generate directory account password: %w", err)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash directory account password: %w", err)
	}
	issuer, subject := identity.Issuer, identity.Subject
	oidcOnly := true
	now := time.Now()
	created := &types.User{
		ID:           uuid.New().String(),
		Username:     username,
		Email:        "kailo-" + short[:32] + "@" + kailoDirectoryEmailDomain,
		OIDCIssuer:   &issuer,
		OIDCSubject:  &subject,
		PasswordHash: string(hash),
		Avatar:       oidcAvatar(map[string]interface{}{"picture": identity.Picture}),
		IsActive:     true,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	created.Preferences.OidcOnlyLogin = &oidcOnly
	// Same rule as repository.CreateUser for a first OIDC login: the account
	// has no tenant yet, so tenant_id is stored as SQL NULL. Writing GORM's
	// uint64 zero violates the PostgreSQL fk_users_tenant constraint and the
	// whole snapshot would never apply. syncLocked sets the home space next.
	if err := db.Omit("tenant_id").Create(created).Error; err != nil {
		// A simultaneous first login may have inserted this identity.
		if lookup := db.Where("oidc_issuer = ? AND oidc_subject = ?", issuer, subject).First(&user).Error; lookup == nil {
			return &user, nil
		}
		return nil, fmt.Errorf("pre-provision directory account: %w", err)
	}
	logger.Infof(ctx, "[kailo] member directory pre-provisioned account %s", created.ID)
	return created, nil
}

// directoryUsername picks the Kailo display name, or the name with a short
// identity digest, or kailo-<digest>; usernames are unique across every
// account including deleted ones.
func (s *kailoOrgService) directoryUsername(db *gorm.DB, displayName, digest string) (string, error) {
	base := normaliseDisplayName(displayName)
	var candidates []string
	if base != "" {
		candidates = append(candidates, base, truncateRunes(base, usernameMaxRunes-11)+" ("+digest[:8]+")")
	}
	candidates = append(candidates, "kailo-"+digest[:12], "kailo-"+digest[:32])
	for _, candidate := range candidates {
		var n int64
		if err := db.Unscoped().Model(&types.User{}).Where("username = ?", candidate).Count(&n).Error; err != nil {
			return "", fmt.Errorf("check directory username: %w", err)
		}
		if n == 0 {
			return candidate, nil
		}
	}
	return "", errors.New("no free username for the directory account")
}

// removeAbsent takes every person who still holds a mapped membership but is
// not in the snapshot out of every mapped space and ends all their native
// sessions. Their account and knowledge stay (historic ownership).
func (s *kailoOrgService) removeAbsent(ctx context.Context, keep map[string]bool) error {
	var holders []string
	if err := s.db.WithContext(ctx).Table("tenant_members").
		Distinct("tenant_members.user_id").
		Joins("JOIN tenants ON tenants.id = tenant_members.tenant_id").
		Where("tenant_members.deleted_at IS NULL AND tenants.kailo_scope_ref IS NOT NULL").
		Pluck("tenant_members.user_id", &holders).Error; err != nil {
		return fmt.Errorf("list mapped members: %w", err)
	}
	for _, userID := range holders {
		if keep[userID] {
			continue
		}
		var changes []kailoMembershipChange
		err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			var err error
			changes, err = reconcileKailoMemberships(tx, userID, map[uint64]kailoDesiredSpace{})
			return err
		})
		if err != nil {
			return fmt.Errorf("remove absent member: %w", err)
		}
		if err := s.afterReconcile(ctx, userID, changes); err != nil {
			return err
		}
		logger.Infof(ctx, "[kailo] member directory removed account %s from the Kailo organisation", userID)
	}
	return nil
}

// linkDirectorySpaces makes every Workspace space of the snapshot an editor
// member of the Tenant organisation, also before anybody joined it.
func (s *kailoOrgService) linkDirectorySpaces(ctx context.Context, directory *types.KailoMemberDirectory) error {
	db := s.db.WithContext(ctx)
	var org types.Organization
	err := db.Select("id", "owner_id").Where("kailo_tenant_ref = ?", directory.Tenant.TenantID).First(&org).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil // created with the first member
	}
	if err != nil {
		return fmt.Errorf("look up Kailo tenant organization: %w", err)
	}
	return db.Transaction(func(tx *gorm.DB) error {
		for _, ws := range directory.Workspaces {
			space, err := findKailoSpace(tx, types.KailoWorkspaceScopeRef(ws.WorkspaceID))
			if err != nil || space == nil {
				return fmt.Errorf("workspace space missing after creation: %v", err)
			}
			if err := ensureOrgSpace(tx, org.ID, space.ID, types.OrgRoleEditor, org.OwnerID); err != nil {
				return err
			}
		}
		return nil
	})
}
