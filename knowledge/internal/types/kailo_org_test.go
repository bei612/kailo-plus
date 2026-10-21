package types

import (
	"errors"
	"strings"
	"testing"
)

func TestParseKailoOrgClaimAcceptsObjectAndString(t *testing.T) {
	object := map[string]interface{}{
		"v":      float64(1),
		"tenant": map[string]interface{}{"id": "t-1", "name": "  Acme   Corp ", "role": "ADMIN"},
		"workspaces": []interface{}{
			map[string]interface{}{"id": "w-1", "name": "Research", "role": "member"},
		},
	}
	claim, err := ParseKailoOrgClaim(object)
	if err != nil {
		t.Fatal(err)
	}
	if claim.Tenant.Name != "Acme Corp" || claim.Tenant.Role != KailoRoleAdmin || claim.TenantScopeRef() != "tenant:t-1" {
		t.Fatalf("tenant = %+v", claim.Tenant)
	}
	if len(claim.Workspaces) != 1 || KailoWorkspaceScopeRef(claim.Workspaces[0].ID) != "workspace:w-1" {
		t.Fatalf("workspaces = %+v", claim.Workspaces)
	}

	fromString, err := ParseKailoOrgClaim(`{"v":1,"tenant":{"id":"t-1","name":"Acme","role":"member"}}`)
	if err != nil || fromString.Tenant.Role != KailoRoleMember || len(fromString.Workspaces) != 0 {
		t.Fatalf("string claim = %+v err=%v", fromString, err)
	}
}

func TestParseKailoOrgClaimRejectsInvalidProjection(t *testing.T) {
	cases := map[string]interface{}{
		"missing":          nil,
		"blank":            "  ",
		"not an object":    []interface{}{"t-1"},
		"malformed json":   `{"v":1,`,
		"unknown version":  `{"v":2,"tenant":{"id":"t-1","name":"Acme","role":"member"}}`,
		"unknown field":    `{"v":1,"tenant":{"id":"t-1","name":"Acme","role":"member"},"groups":["x"]}`,
		"bad tenant id":    `{"v":1,"tenant":{"id":"t 1/..","name":"Acme","role":"member"}}`,
		"no tenant name":   `{"v":1,"tenant":{"id":"t-1","name":" ","role":"member"}}`,
		"unknown role":     `{"v":1,"tenant":{"id":"t-1","name":"Acme","role":"owner"}}`,
		"duplicate ws":     `{"v":1,"tenant":{"id":"t-1","name":"Acme","role":"member"},"workspaces":[{"id":"w","name":"A","role":"member"},{"id":"w","name":"B","role":"member"}]}`,
		"bad workspace id": `{"v":1,"tenant":{"id":"t-1","name":"Acme","role":"member"},"workspaces":[{"id":"","name":"A","role":"member"}]}`,
	}
	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			if claim, err := ParseKailoOrgClaim(raw); err == nil {
				t.Fatalf("accepted %+v", claim)
			}
		})
	}
	if _, err := ParseKailoOrgClaim(nil); !errors.Is(err, ErrKailoOrgClaimMissing) {
		t.Fatalf("missing claim error = %v", err)
	}
}

func TestParseKailoOrgClaimBoundsNames(t *testing.T) {
	long := strings.Repeat("名", 300)
	claim, err := ParseKailoOrgClaim(map[string]interface{}{
		"v":      1,
		"tenant": map[string]interface{}{"id": "t-1", "name": long, "role": "member"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := len([]rune(claim.Tenant.Name)); got != kailoScopeNameMaxRunes {
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
