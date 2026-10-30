package interfaces

import (
	"context"

	"github.com/Tencent/WeKnora/internal/types"
)

// KailoOrgService projects Kailo membership onto native spaces, space roles
// and the Tenant organisation (Kailo DD-133 §3). It is the only writer of
// memberships in Kailo-mapped spaces.
type KailoOrgService interface {
	// SyncLogin reconciles the user's memberships of mapped spaces with what
	// Kailo says about the person (types.KailoMembership) and returns the
	// Tenant space, which becomes the user's home space. Memberships of
	// spaces that are not Kailo-mapped are never touched.
	SyncLogin(ctx context.Context, user *types.User, membership *types.KailoMembership) (*types.Tenant, error)

	// ApplyDirectory converges every mapped space, membership and role with
	// one complete member directory snapshot (DD-133(4), 07 §4.7.4), knowledge
	// base shares included (DD-164(4)):
	// pre-provisions accounts for identities of this instance's issuer,
	// removes everyone no longer in the snapshot (revoking their sessions)
	// and records the snapshot only after all of it succeeded. It returns
	// applied=false when the snapshot's version is the one already recorded.
	// The result also carries the share projection items it skipped
	// (DD-164(4)) for the receipt; an unchanged version answers with the
	// recorded result.
	// adopter registers existing native shares of Kailo-mapped objects as
	// Kailo shares before shares[] is converged (DD-164(4)⑧); nil skips
	// adoption, and then no native share is ever removed.
	ApplyDirectory(ctx context.Context, issuer, fallbackTenantName string,
		directory *types.KailoMemberDirectory, adopter KailoShareAdopter) (*types.KailoDirectoryApplyResult, error)

	// DirectorySnapshot returns the last completely applied snapshot for the
	// binding, or nil when no directory has been delivered for it yet.
	DirectorySnapshot(ctx context.Context, bindingID string) (*types.KailoMemberDirectory, error)
}

// KailoShareAdopter calls Core's share adoption (DD-164(4)⑧). A definite
// refusal is types.ErrKailoShareAdoptionRefused; any other error is not
// definite and stops the convergence until the next read.
type KailoShareAdopter interface {
	AdoptShare(ctx context.Context, request *types.KailoShareAdoptionRequest) (*types.KailoShareAdoptionResult, error)
}
