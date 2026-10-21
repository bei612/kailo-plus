package auth_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"io"
	"testing"

	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/server/stubs/idmtest"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/uuid"
)

func userLanguage(t *testing.T, ctx context.Context, userUUID string) []string {
	t.Helper()
	query, _ := anypb.New(&idm.ACLSingleQuery{RoleIDs: []string{userUUID}, Actions: []*idm.ACLAction{{Name: "parameter:core.conf:lang"}}})
	stream, err := idmc.ACLServiceClient(ctx).SearchACL(ctx, &idm.SearchACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{query}}})
	if err != nil {
		t.Fatal(err)
	}
	var values []string
	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return values
		}
		if err != nil {
			t.Fatal(err)
		}
		values = append(values, response.GetACL().GetAction().GetValue())
	}
}

func tenantGroup(t *testing.T, ctx context.Context, tenantID string) *idm.User {
	t.Helper()
	for _, g := range searchUsers(t, ctx, &idm.UserSingleQuery{FullPath: auth.NativeOIDCTenantGroupPath(tenantID)}) {
		if g.GetIsGroup() {
			return g
		}
	}
	t.Fatalf("no native group for Tenant %s", tenantID)
	return nil
}

func hasPolicy(policies []*service.ResourcePolicy, action service.ResourcePolicyAction, subject string) bool {
	for _, p := range policies {
		if p.GetAction() == action && p.GetSubject() == subject && p.GetEffect() == service.ResourcePolicy_allow {
			return true
		}
	}
	return false
}

// DD-133 §3: every browser login refreshes the account from Kailo; the Kailo
// Tenant selects the native group, the Tenant-admin claim the profile.
func TestNativeOIDCKailoUserSystem(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	test.RunServicesTests(uuid.New(), provisionTestCases(), t, func(ctx context.Context) {
		sd, err := idmtest.GetStartData()
		if err != nil {
			t.Error(err)
			return
		}
		if err := idmtest.RegisterIdmMocksWithData(ctx, sd); err != nil {
			t.Error(err)
			return
		}
		grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &provisionLoginPolicy{}})
		permissions.ClearCachedPolicies(ctx, "oidc")
		idp := provisionIdP{t: t, key: key}
		dedicated := auth.NativeOIDCConnector{Issuer: provisionIssuer, ClientID: provisionClient, ProvisionUsers: true, ProvisionProfile: common.PydioProfileStandard,
			Organization: &auth.NativeOIDCOrganization{Tenants: []auth.NativeOIDCTenant{{ID: "6179e160-tenant", Name: "Kailo Verify"}}, TenantAdminClaim: "kailo_tenant_admin"}}

		t.Run("tenant-group-profile-and-refresh", func(t *testing.T) {
			setProvisionConnector(t, ctx, dedicated)
			first, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-member", idp.token(provisionIssuer, "subject-member", provisionClient, map[string]any{
				"preferred_username": "member", "name": "成员甲", "email": "member@example.invalid", "email_verified": true,
				"picture": "https://kailo.example.invalid/avatars/member.png", "locale": "zh-CN", "kailo_tenant_admin": true}))
			if err != nil {
				t.Fatal(err)
			}
			group := tenantGroup(t, ctx, "6179e160-tenant")
			a := first.GetAttributes()
			if first.GetGroupPath() != "/kailo-6179e160-tenant" || a[idm.UserAttrProfile] != common.PydioProfileAdmin || a[idm.UserAttrDisplayName] != "成员甲" ||
				a[idm.UserAttrAvatar] != "https://kailo.example.invalid/avatars/member.png" || a[idm.UserAttrEmail] != "member@example.invalid" {
				t.Fatalf("first login not mapped from Kailo: %s %v", first.GetGroupPath(), a)
			}
			if group.GetAttributes()[idm.UserAttrDisplayName] != "Kailo Verify" || !hasPolicy(group.GetPolicies(), service.ResourcePolicyAction_READ, "role:"+group.GetUuid()) {
				t.Fatalf("Tenant group not readable by its members: %v", group.GetPolicies())
			}
			stored := searchUsers(t, ctx, &idm.UserSingleQuery{Uuid: first.GetUuid()})[0]
			if !hasPolicy(stored.GetPolicies(), service.ResourcePolicyAction_READ, "role:"+group.GetUuid()) ||
				hasPolicy(stored.GetPolicies(), service.ResourcePolicyAction_READ, "profile:"+common.PydioProfileStandard) {
				t.Fatalf("account visibility is not limited to its Tenant: %v", stored.GetPolicies())
			}
			if lang := userLanguage(t, ctx, first.GetUuid()); len(lang) != 1 || lang[0] != "zh-cn" {
				t.Fatalf("Kailo locale not applied: %v", lang)
			}
			var inGroup bool
			for _, r := range first.GetRoles() {
				inGroup = inGroup || r.GetUuid() == group.GetUuid()
			}
			if !inGroup {
				t.Fatal("account does not inherit its Tenant group role")
			}

			// Next login: Kailo changed name, dropped the picture, revoked the
			// Tenant admin role and switched to English.
			again, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-member", idp.token(provisionIssuer, "subject-member", provisionClient, map[string]any{
				"preferred_username": "renamed", "name": "Member A", "locale": "en", "kailo_tenant_admin": false}))
			if err != nil {
				t.Fatal(err)
			}
			b := again.GetAttributes()
			if again.GetUuid() != first.GetUuid() || again.GetLogin() != "member" || b[idm.UserAttrProfile] != common.PydioProfileStandard ||
				b[idm.UserAttrDisplayName] != "Member A" || b[idm.UserAttrAvatar] != "" || b[idm.UserAttrEmail] != "member@example.invalid" {
				t.Fatalf("later login not refreshed from Kailo: %s %v", again.GetLogin(), b)
			}
			if lang := userLanguage(t, ctx, first.GetUuid()); len(lang) != 1 || lang[0] != "en-us" {
				t.Fatalf("Kailo locale not replaced: %v", lang)
			}
			// Resolution without an ID token (PAT/WOPI) changes nothing.
			resolved, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-member", nil)
			if err != nil || resolved.GetAttributes()[idm.UserAttrDisplayName] != "Member A" {
				t.Fatalf("resolve-only path: %v", err)
			}
		})

		t.Run("tenant-claim-admits-only-declared-tenants", func(t *testing.T) {
			shared := dedicated
			shared.Organization = &auth.NativeOIDCOrganization{TenantClaim: "kailo_tenant", Tenants: []auth.NativeOIDCTenant{
				{ID: "tenant-a", Name: "Tenant A"}, {ID: "tenant-b", Name: "Tenant B"}}}
			setProvisionConnector(t, ctx, shared)
			for _, claim := range []any{"tenant-x", nil, []any{"tenant-a", "tenant-b"}} {
				claims := map[string]any{"preferred_username": "outsider"}
				if claim != nil {
					claims["kailo_tenant"] = claim
				}
				if _, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-outsider", idp.token(provisionIssuer, "subject-outsider", provisionClient, claims)); !errors.Is(err, auth.ErrNativeOIDCTenantRefused) {
					t.Fatalf("Tenant %v admitted: %v", claim, err)
				}
			}
			if len(linkedTo(t, ctx, "subject-outsider")) != 0 {
				t.Fatal("a refused identity got an account")
			}
			user, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-b", idp.token(provisionIssuer, "subject-b", provisionClient, map[string]any{
				"preferred_username": "member.b", "kailo_tenant": []any{"tenant-x", "TENANT-B"}}))
			if err != nil || user.GetGroupPath() != "/kailo-tenant-b" || user.GetAttributes()[idm.UserAttrProfile] != common.PydioProfileStandard {
				t.Fatalf("declared Tenant member not placed in its group: %v %v", user.GetGroupPath(), err)
			}
			// Removed from the Tenant in Kailo: the next login is refused.
			if _, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-b", idp.token(provisionIssuer, "subject-b", provisionClient, map[string]any{
				"kailo_tenant": "tenant-x"})); !errors.Is(err, auth.ErrNativeOIDCTenantRefused) {
				t.Fatalf("former member admitted: %v", err)
			}
		})

		t.Run("root-group-account-moves-into-its-tenant", func(t *testing.T) {
			legacy := dedicated
			legacy.Organization = nil
			setProvisionConnector(t, ctx, legacy)
			before, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-legacy", idp.token(provisionIssuer, "subject-legacy", provisionClient, map[string]any{"preferred_username": "legacy"}))
			if err != nil || before.GetGroupPath() != "/" {
				t.Fatalf("legacy account: %v", err)
			}
			setProvisionConnector(t, ctx, dedicated)
			after, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-legacy", idp.token(provisionIssuer, "subject-legacy", provisionClient, map[string]any{"preferred_username": "legacy"}))
			if err != nil || after.GetUuid() != before.GetUuid() || after.GetGroupPath() != "/kailo-6179e160-tenant" {
				t.Fatalf("existing account not moved into its Tenant: %v %v", after.GetGroupPath(), err)
			}
		})

		t.Run("explicit-link-refreshes-profile-only", func(t *testing.T) {
			linked := &idm.User{Uuid: "00000000-0000-4000-8000-00000000b001", Login: "bootstrap.admin", GroupPath: "/",
				Attributes: map[string]string{idm.UserAttrProfile: common.PydioProfileAdmin, idm.UserAttrDisplayName: "Old"}}
			createNativeUser(t, ctx, linked)
			explicit := dedicated
			explicit.Users = []auth.NativeOIDCUser{{Subject: "subject-linked", UserUUID: linked.Uuid}}
			setProvisionConnector(t, ctx, explicit)
			user, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-linked", idp.token(provisionIssuer, "subject-linked", provisionClient, map[string]any{
				"name": "Bootstrap Admin", "kailo_tenant_admin": false}))
			if err != nil || user.GetGroupPath() != "/" || user.GetAttributes()[idm.UserAttrProfile] != common.PydioProfileAdmin || user.GetAttributes()[idm.UserAttrDisplayName] != "Bootstrap Admin" {
				t.Fatalf("explicit link: %v %v", user.GetAttributes(), err)
			}
		})
	})
}

func TestNativeOIDCOrganizationValidation(t *testing.T) {
	base := auth.NativeOIDCConnector{Issuer: provisionIssuer, ClientID: provisionClient}
	one := []auth.NativeOIDCTenant{{ID: "tenant-a", Name: "Tenant A"}}
	two := []auth.NativeOIDCTenant{{ID: "tenant-a", Name: "Tenant A"}, {ID: "tenant-b", Name: "Tenant B"}}
	for name, o := range map[string]*auth.NativeOIDCOrganization{
		"no-tenants":                 {},
		"several-without-claim":      {Tenants: two},
		"admin-claim-several":        {Tenants: two, TenantClaim: "kailo_tenant", TenantAdminClaim: "kailo_tenant_admin"},
		"duplicate-tenant":           {Tenants: []auth.NativeOIDCTenant{{ID: "a", Name: "A"}, {ID: "A", Name: "B"}}, TenantClaim: "t"},
		"blank-name":                 {Tenants: []auth.NativeOIDCTenant{{ID: "a", Name: " "}}},
		"invalid-id":                 {Tenants: []auth.NativeOIDCTenant{{ID: "../a", Name: "A"}}},
		"invalid-claim":              {Tenants: one, TenantClaim: "bad claim"},
		"non-printable-tenant-label": {Tenants: []auth.NativeOIDCTenant{{ID: "a", Name: "A\nB"}}},
	} {
		c := base
		c.Organization = o
		if c.Validate() == nil {
			t.Errorf("%s accepted", name)
		}
	}
	for _, o := range []*auth.NativeOIDCOrganization{nil, {Tenants: one}, {Tenants: one, TenantAdminClaim: "kailo_tenant_admin"}, {Tenants: two, TenantClaim: "kailo_tenant"}} {
		c := base
		c.Organization = o
		if err := c.Validate(); err != nil {
			t.Error(err)
		}
	}
	if auth.NativeOIDCTenantGroupPath("6179E160-ABC") != "/kailo-6179e160-abc" || auth.NativeOIDCTenantGroupPath("a.b") == "/kailo-a.b" {
		t.Fatal("unexpected Tenant group path")
	}
	for in, want := range map[string]string{"zh-CN": "zh-cn", "zh_Hans": "zh-cn", "zh": "zh-cn", "en": "en-us", "EN-GB": "en-us", "fr": "fr", "xx": "", "": ""} {
		if got := auth.NativeOIDCLanguage(in); got != want {
			t.Errorf("language %q: %q, want %q", in, got, want)
		}
	}
}
