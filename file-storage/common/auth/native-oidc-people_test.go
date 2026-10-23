package auth_test

import (
	"context"
	"errors"
	"io"
	"slices"
	"testing"

	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/server/stubs/idmtest"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	cellsuuid "github.com/pydio/cells/v5/common/utils/uuid"
)

const otherTenant = "6f0c2a1e-8b9d-4e4f-a1b2-c3d4e5f60799"

func peopleLogins(t *testing.T, ctx context.Context, query *service.Query, scope string) []string {
	t.Helper()
	stream, err := idmc.UserServiceClient(ctx).SearchUser(ctx, &idm.SearchUserRequest{Query: query})
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for {
		r, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		u := r.GetUser()
		if !u.GetIsGroup() {
			if !auth.NativeOIDCPeopleVisible(u, scope) {
				t.Errorf("scoped query returned %s outside %s", u.GetLogin(), scope)
			}
			out = append(out, u.GetLogin())
		}
	}
	slices.Sort(out)
	return out
}

// DD-133(4), 07 §4.7.4 (Cells, Tenant row): a Kailo member's user search and
// lookup — the people picker, @ and share targets — list the accounts of its
// Tenant only, never the installation admin, service accounts or another
// Tenant, although those native accounts carry the default
// "profile:standard READ" policy. Native admins are not narrowed.
func TestNativeOIDCPeopleScope(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	test.RunServicesTests(cellsuuid.New(), provisionTestCases(), t, func(ctx context.Context) {
		sd, err := idmtest.GetStartData()
		if err != nil {
			t.Error(err)
			return
		}
		if err := idmtest.RegisterIdmMocksWithData(ctx, sd); err != nil {
			t.Error(err)
			return
		}
		tenantPath := auth.NativeOIDCTenantGroupPath(dirTenant)
		for _, u := range []*idm.User{
			{Login: "tenant-alice", GroupPath: tenantPath, Attributes: map[string]string{idm.UserAttrDisplayName: "Alice"}},
			{Login: "tenant-bob", GroupPath: tenantPath, Attributes: map[string]string{idm.UserAttrDisplayName: "Bob"}},
			{Login: "kailo-platform-admin", GroupPath: "/", Attributes: map[string]string{idm.UserAttrDisplayName: "Platform admin"}},
			{Login: "binding-service", GroupPath: "/"},
			{Login: "other-carol", GroupPath: auth.NativeOIDCTenantGroupPath(otherTenant), Attributes: map[string]string{idm.UserAttrDisplayName: "Carol"}},
		} {
			createNativeUser(t, ctx, u)
		}
		member := claim.ToContext(ctx, claim.Claims{Name: "tenant-alice", Profile: common.PydioProfileStandard})
		admin := claim.ToContext(ctx, claim.Claims{Name: "admin", Profile: common.PydioProfileAdmin})

		t.Run("no-organisation-no-scope", func(t *testing.T) {
			setProvisionConnector(t, ctx, auth.NativeOIDCConnector{Issuer: provisionIssuer, ClientID: provisionClient})
			if _, scoped := auth.NativeOIDCPeopleScope(member); scoped {
				t.Fatal("scope without a Kailo Tenant organisation")
			}
		})

		setProvisionConnector(t, ctx, auth.NativeOIDCConnector{Issuer: provisionIssuer, ClientID: provisionClient, ProvisionUsers: true,
			ProvisionProfile: common.PydioProfileStandard,
			Organization:     &auth.NativeOIDCOrganization{Tenant: auth.NativeOIDCTenant{ID: dirTenant, Name: "Kailo Verify"}}})

		t.Run("admin-not-narrowed", func(t *testing.T) {
			if _, scoped := auth.NativeOIDCPeopleScope(admin); scoped {
				t.Fatal("native admin narrowed")
			}
		})

		t.Run("member-sees-own-tenant-only", func(t *testing.T) {
			scope, scoped := auth.NativeOIDCPeopleScope(member)
			if !scoped || scope != tenantPath {
				t.Fatalf("member scope: %q %v", scope, scoped)
			}
			if _, scoped := auth.NativeOIDCPeopleScope(ctx); !scoped {
				t.Fatal("caller without claims not narrowed")
			}
			// The picker's wildcard search: login OR display name, as the REST handler builds it.
			login, _ := anypb.New(&idm.UserSingleQuery{Login: "*"})
			name, _ := anypb.New(&idm.UserSingleQuery{AttributeName: idm.UserAttrDisplayName, AttributeValue: "*"})
			wild, _ := anypb.New(&service.Query{Operation: service.OperationType_OR, SubQueries: []*anypb.Any{login, name}})
			for label, q := range map[string]*service.Query{
				"empty":    {},
				"wildcard": {SubQueries: []*anypb.Any{wild}},
				"or":       {Operation: service.OperationType_OR, SubQueries: []*anypb.Any{login, name}},
			} {
				got := peopleLogins(t, ctx, auth.ScopeNativeOIDCPeopleQuery(q, scope), scope)
				if !slices.Equal(got, []string{"tenant-alice", "tenant-bob"}) {
					t.Errorf("%s: member search returned %v", label, got)
				}
			}
			exact, _ := anypb.New(&idm.UserSingleQuery{Login: "kailo-platform-admin"})
			if got := peopleLogins(t, ctx, auth.ScopeNativeOIDCPeopleQuery(&service.Query{Limit: 1, SubQueries: []*anypb.Any{exact}}, scope), scope); len(got) != 0 {
				t.Fatalf("member looked up an account outside the Tenant: %v", got)
			}
		})

		t.Run("visibility", func(t *testing.T) {
			cases := map[*idm.User]bool{
				{Login: "a", GroupPath: tenantPath}:                                  true,
				{Login: "b", GroupPath: tenantPath + "/team"}:                        true,
				{IsGroup: true, GroupPath: "/", GroupLabel: tenantPath[1:]}:          true,
				{Login: "c", GroupPath: "/"}:                                         false,
				{Login: "d", GroupPath: tenantPath + "x"}:                            false,
				{Login: "e", GroupPath: auth.NativeOIDCTenantGroupPath(otherTenant)}: false,
			}
			for u, want := range cases {
				if auth.NativeOIDCPeopleVisible(u, tenantPath) != want {
					t.Errorf("%s%s visible=%v", u.GetGroupPath(), u.GetLogin(), !want)
				}
			}
		})
	})
}
