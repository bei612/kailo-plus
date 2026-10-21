package interfaces

import (
	"context"

	"github.com/Tencent/WeKnora/internal/types"
)

// KailoOrgService projects Kailo membership onto native spaces, space roles
// and the Tenant organisation (Kailo DD-133 §3). It is the only writer of
// memberships in Kailo-mapped spaces.
type KailoOrgService interface {
	// SyncLogin reconciles the user's memberships of mapped spaces with the
	// verified organisation claim of the current login and returns the
	// Tenant space, which becomes the user's home space. Memberships of
	// spaces that are not Kailo-mapped are never touched.
	SyncLogin(ctx context.Context, user *types.User, claim *types.KailoOrgClaim) (*types.Tenant, error)
}
