package types

import (
	"strings"
	"testing"
)

func TestDeploymentKailoMembershipIsMemberOfTheServedTenantOnly(t *testing.T) {
	m := DeploymentKailoMembership(" t-1 ", "  Acme   Corp ")
	if m.Tenant.ID != "t-1" || m.Tenant.Name != "Acme Corp" || m.Tenant.Role != KailoRoleMember || len(m.Workspaces) != 0 {
		t.Fatalf("membership = %+v", m)
	}
	if m.TenantScopeRef() != "tenant:t-1" || KailoWorkspaceScopeRef("w-1") != "workspace:w-1" {
		t.Fatal("scope references")
	}
	if got := len([]rune(NormaliseKailoName(strings.Repeat("名", 300)))); got != kailoScopeNameMaxRunes {
		t.Fatalf("name runes = %d", got)
	}
}

func TestKailoRoleMapping(t *testing.T) {
	cases := []struct {
		scope KailoScope
		want  TenantRole
	}{
		{KailoScope{Role: KailoRoleAdmin}, TenantRoleAdmin},
		{KailoScope{Role: KailoRoleAdmin, Create: true}, TenantRoleAdmin},
		{KailoScope{Role: KailoRoleMember, Create: true}, TenantRoleContributor},
		// DD-164(3): a member without Kailo create only reads.
		{KailoScope{Role: KailoRoleMember}, TenantRoleViewer},
	}
	for _, c := range cases {
		if got := c.scope.NativeRole(); got != c.want {
			t.Fatalf("%+v -> %q, want %q", c.scope, got, c.want)
		}
	}
	if DeploymentKailoMembership("t", "n").Tenant.NativeRole() != TenantRoleContributor {
		t.Fatal("before the directory every login is a contributor")
	}
}
