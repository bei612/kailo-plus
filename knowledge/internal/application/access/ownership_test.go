package access

import (
	"errors"
	"fmt"
	"testing"

	"github.com/Tencent/WeKnora/internal/types"
	"github.com/stretchr/testify/require"
)

func TestCheckOwnershipOrRoleSkipsLookupWhenGateAlreadyResolved(t *testing.T) {
	for _, tt := range []struct {
		name    string
		request OwnershipRequest
		skipped bool
	}{
		{name: "API key", request: OwnershipRequest{APIKey: true, Role: types.TenantRoleViewer, Enforce: true}},
		{name: "admin", request: OwnershipRequest{Role: types.TenantRoleAdmin, Enforce: true}},
		{name: "owner role", request: OwnershipRequest{Role: types.TenantRoleOwner, Enforce: true}},
		{
			name: "cross tenant superuser",
			request: OwnershipRequest{
				Role:                 types.TenantRoleViewer,
				CrossTenantSuperuser: true,
				Enforce:              true,
			},
		},

		{name: "enforcement disabled", request: OwnershipRequest{Role: types.TenantRoleViewer}, skipped: true},
		{name: "role before rollout", request: OwnershipRequest{Role: types.TenantRoleAdmin}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			decision, err := CheckOwnershipOrRole(tt.request, types.TenantRoleAdmin, func() (string, error) {
				t.Fatal("ownership lookup must not run on a fast path")
				return "", errors.New("unavailable")
			})
			require.NoError(t, err)
			require.Equal(t, tt.skipped, decision.EnforcementSkipped)
			require.False(t, decision.LookupFailed)
		})
	}
}

func TestCheckOwnershipOrRoleResolvesCreator(t *testing.T) {
	failure := errors.New("database unavailable")
	for _, tt := range []struct {
		name, user, creator string
		lookupErr, wantErr  error
		lookupFailed        bool
	}{
		{name: "creator", user: "user", creator: "user"},
		{name: "other creator", user: "user", creator: "other", wantErr: ErrOwnershipForbidden},
		{name: "tenant owned", user: "user", wantErr: ErrOwnershipForbidden},
		{name: "missing identity cannot match empty creator", wantErr: ErrOwnershipForbidden},
		{name: "missing resource", user: "user", lookupErr: ErrResourceNotFound, wantErr: ErrResourceNotFound},
		{
			name: "wrapped missing resource",
			user: "user",
			lookupErr: fmt.Errorf("load: %w",
				ErrResourceNotFound),
			wantErr: ErrResourceNotFound,
		},

		{
			name:         "lookup failure wins over creator match",
			user:         "user",
			creator:      "user",
			lookupErr:    failure,
			wantErr:      failure,
			lookupFailed: true,
		},

		{
			name:         "lookup denial remains a lookup failure",
			lookupErr:    ErrOwnershipForbidden,
			wantErr:      ErrOwnershipForbidden,
			lookupFailed: true,
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			calls := 0
			decision, err := CheckOwnershipOrRole(
				OwnershipRequest{UserID: tt.user, Role: types.TenantRoleContributor, Enforce: true},
				types.TenantRoleAdmin,
				func() (string, error) {
					calls++
					return tt.creator, tt.lookupErr
				},
			)
			require.Equal(t, 1, calls)
			require.ErrorIs(t, err, tt.wantErr)
			require.Equal(t, tt.creator, decision.CreatorID)
			require.Equal(t, tt.lookupFailed, decision.LookupFailed)
		})
	}
}

func TestCheckOwnershipOrRoleMissingLookupFailsClosed(t *testing.T) {
	decision, err := CheckOwnershipOrRole(OwnershipRequest{Enforce: true}, types.TenantRoleAdmin, nil)
	require.Error(t, err)
	require.True(t, decision.LookupFailed)
}

// Kailo DD-164(3) (amended 1c803580): the owner keeps editing, deleting and
// sharing their own resources whatever their space role; others need the role.
func TestCheckOwnershipOrRoleOwnerKeepsOwnResourcesAsViewer(t *testing.T) {
	lookup := func() (string, error) { return "u-1", nil }
	owner := OwnershipRequest{UserID: "u-1", Role: types.TenantRoleViewer, Enforce: true}
	if _, err := CheckOwnershipOrRole(owner, types.TenantRoleAdmin, lookup); err != nil {
		t.Fatalf("viewer owner: %v", err)
	}
	other := OwnershipRequest{UserID: "u-2", Role: types.TenantRoleViewer, Enforce: true}
	if _, err := CheckOwnershipOrRole(other, types.TenantRoleAdmin, lookup); !errors.Is(err, ErrOwnershipForbidden) {
		t.Fatalf("viewer on another's resource: %v", err)
	}
}
