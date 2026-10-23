package repository

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// oidcLogoutTokenID is one recorded logout_token jti (migration 000109).
type oidcLogoutTokenID struct {
	JTI       string    `gorm:"column:jti;primaryKey"`
	ExpiresAt time.Time `gorm:"column:expires_at"`
}

func (oidcLogoutTokenID) TableName() string { return "oidc_logout_token_ids" }

type oidcLogoutRepository struct {
	db *gorm.DB
}

// NewOIDCLogoutRepository creates the back-channel logout repository.
func NewOIDCLogoutRepository(db *gorm.DB) interfaces.OIDCLogoutRepository {
	return &oidcLogoutRepository{db: db}
}

func (r *oidcLogoutRepository) RecordLogoutTokenID(ctx context.Context, jti string, expiresAt time.Time) (bool, error) {
	db := r.db.WithContext(ctx)
	if err := db.Where("expires_at < ?", time.Now()).Delete(&oidcLogoutTokenID{}).Error; err != nil {
		return false, err
	}
	result := db.Clauses(clause.OnConflict{DoNothing: true}).Create(&oidcLogoutTokenID{JTI: jti, ExpiresAt: expiresAt})
	if result.Error != nil {
		return false, result.Error
	}
	return result.RowsAffected == 1, nil
}

func (r *oidcLogoutRepository) RevokeTokensBySID(ctx context.Context, userID, sid string) (int64, error) {
	result := r.db.WithContext(ctx).Model(&types.AuthToken{}).
		Where("user_id = ? AND oidc_sid = ? AND is_revoked = ?", userID, sid, false).
		Updates(map[string]interface{}{"is_revoked": true, "updated_at": time.Now()})
	return result.RowsAffected, result.Error
}

func (r *oidcLogoutRepository) UserIDsBySID(ctx context.Context, sid string) ([]string, error) {
	var ids []string
	err := r.db.WithContext(ctx).Model(&types.AuthToken{}).
		Where("oidc_sid = ? AND is_revoked = ?", sid, false).
		Distinct().Pluck("user_id", &ids).Error
	return ids, err
}
