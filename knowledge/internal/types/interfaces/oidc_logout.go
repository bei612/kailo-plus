package interfaces

import (
	"context"
	"time"
)

// OIDCLogoutRepository persists what back-channel logout needs beyond the
// token table itself (Kailo DD-133, 07 §4.7.5).
type OIDCLogoutRepository interface {
	// RecordLogoutTokenID stores a logout_token jti until expiresAt. It
	// returns false when the jti was already recorded (a replay). Expired
	// entries are purged opportunistically.
	RecordLogoutTokenID(ctx context.Context, jti string, expiresAt time.Time) (bool, error)
	// RevokeTokensBySID revokes every native token of the user created from
	// the identity-provider session sid and returns how many were revoked.
	RevokeTokensBySID(ctx context.Context, userID, sid string) (int64, error)
	// UserIDsBySID lists the users holding unrevoked tokens of sid.
	UserIDsBySID(ctx context.Context, sid string) ([]string, error)
}
