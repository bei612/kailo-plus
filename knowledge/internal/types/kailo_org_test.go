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
	if KailoRoleAdmin.NativeTenantRole() != TenantRoleAdmin {
		t.Fatal("Kailo admin must be native admin")
	}
	if KailoRoleMember.NativeTenantRole() != TenantRoleContributor {
		t.Fatal("Kailo member must be native contributor")
	}
}
