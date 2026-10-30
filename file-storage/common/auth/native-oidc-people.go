package auth

import (
	"context"
	"path"
	"strings"

	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
)

// DD-133(4), .design/07 §4.7.4 (Cells mapping, Tenant row): the people a
// Kailo member can find — user search, user lookup, and therefore the people
// picker, @ and share targets — are the accounts of the instance's Tenant
// group only. Native accounts outside it (installation administrator,
// binding service accounts, accounts of another Tenant or created before the
// Tenant group) keep the native default policy "profile:standard READ", so
// the resource policies alone would list them; the native REST user handler
// narrows the query with this scope. Only local operator administrators (no
// Kailo identity link) are not narrowed: a Kailo Tenant administrator is a
// native admin profile too (07 §4.7.4 role derivation), but it is a person of
// this Tenant and finds only its Tenant (V-SCN-205, DD-164(1)).

// NativeOIDCPeopleScope returns the Tenant group path a caller's people
// lookups are restricted to, and false when no restriction applies: no Kailo
// Tenant organisation is configured, or the caller is a native administrator
// account that is not a Kailo account. A caller without claims, or whose
// account cannot be read, is restricted.
func NativeOIDCPeopleScope(ctx context.Context) (string, bool) {
	c, err := loadNativeOIDCConnector(ctx)
	if err != nil || !c.ProvisionUsers || c.Organization == nil || c.Organization.Tenant.ID == "" {
		return "", false
	}
	scope := NativeOIDCTenantGroupPath(c.Organization.Tenant.ID)
	if claims, ok := claim.FromContext(ctx); ok && claims.Profile == common.PydioProfileAdmin && !nativeOIDCKailoCaller(ctx, c, claims, scope) {
		return "", false
	}
	return scope, true
}

// nativeOIDCKailoCaller tells whether an admin-profile caller is a Kailo
// account: inside the Tenant group, carrying the Kailo identity link, or an
// explicitly linked connector account. Unknown means yes (fail closed).
func nativeOIDCKailoCaller(ctx context.Context, c NativeOIDCConnector, claims claim.Claims, scope string) bool {
	if gp := path.Join("/", claims.GroupPath); claims.GroupPath != "" && (gp == scope || strings.HasPrefix(gp, scope+"/")) {
		return true
	}
	q := &idm.UserSingleQuery{Login: claims.Name}
	if claims.Subject != "" {
		q = &idm.UserSingleQuery{Uuid: claims.Subject}
	} else if claims.Name == "" {
		return true
	}
	found, err := searchNativeUsers(ctx, q)
	if err != nil || len(found) != 1 || found[0].GetIsGroup() {
		return true
	}
	u := found[0]
	if u.GetAttributes()[NativeOIDCIssuerAttribute] != "" || u.GetAttributes()[NativeOIDCSubjectAttribute] != "" {
		return true
	}
	for _, link := range c.Users {
		if link.UserUUID == u.GetUuid() {
			return true
		}
	}
	return NativeOIDCPeopleVisible(u, scope)
}

// ScopeNativeOIDCPeopleQuery returns query narrowed to the accounts inside
// scope (recursively); the original sub-queries and operation are kept as one
// nested query, paging and resource policies stay on the outer query.
func ScopeNativeOIDCPeopleQuery(query *service.Query, scope string) *service.Query {
	inside, _ := anypb.New(&idm.UserSingleQuery{GroupPath: scope, Recursive: true})
	scoped := &service.Query{Limit: query.GetLimit(), Offset: query.GetOffset(), GroupBy: query.GetGroupBy(),
		ResourcePolicyQuery: query.GetResourcePolicyQuery(), Operation: service.OperationType_AND,
		SubQueries: []*anypb.Any{inside}}
	if len(query.GetSubQueries()) > 0 {
		original, _ := anypb.New(&service.Query{SubQueries: query.GetSubQueries(), Operation: query.GetOperation()})
		scoped.SubQueries = append(scoped.SubQueries, original)
	}
	return scoped
}

// NativeOIDCPeopleVisible reports whether one account or group returned by
// the native user service lies inside scope (defence in depth after the
// scoped query): a user or group below the Tenant group, or the group itself.
func NativeOIDCPeopleVisible(u *idm.User, scope string) bool {
	scope = strings.TrimSuffix(scope, "/")
	full := path.Join("/", u.GetGroupPath())
	if u.GetIsGroup() {
		full = path.Join("/", u.GetGroupPath(), u.GetGroupLabel())
		if full == scope {
			return true
		}
	}
	return full == scope || strings.HasPrefix(full, scope+"/")
}
