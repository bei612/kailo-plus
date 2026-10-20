package auth_test

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	jose "github.com/go-jose/go-jose/v3"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	grpcclient "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/permissions"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/server/stubs/idmtest"
	"github.com/pydio/cells/v5/common/storage/sql"
	"github.com/pydio/cells/v5/common/storage/test"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
	"github.com/pydio/cells/v5/common/utils/uuid"
	acldao "github.com/pydio/cells/v5/idm/acl/dao/sql"
	roledao "github.com/pydio/cells/v5/idm/role/dao/sql"
	usrdao "github.com/pydio/cells/v5/idm/user/dao/sql"
)

const (
	provisionIssuer = "https://idp.example.invalid/realms/kailo"
	provisionClient = "cells-oidc-client"
)

// Native user, role and ACL services over the same sqlite DAOs as the other
// idmtest-based tests; only the oidc/login policy source is a fixture.
func provisionTestCases() []test.ServicesStorageTestCase {
	unique := uuid.New()[:6] + "_"
	return []test.ServicesStorageTestCase{{
		DSN:       map[string]string{"sql": sql.SqliteDriver + "://" + sql.SharedMemDSN + "&hookNames=cleanTables&prefix=" + unique + "&policies=" + unique + "{{ .Meta.policies }}"},
		Condition: os.Getenv("CELLS_TEST_SKIP_SQLITE") != "true",
		Services: map[string]map[string]map[string]any{
			common.ServiceUserGRPC: {"sql": {"func": usrdao.NewDAO}},
			common.ServiceRoleGRPC: {"sql": {"func": roledao.NewDAO}},
			common.ServiceAclGRPC:  {"sql": {"func": acldao.NewDAO}},
		},
		Label: "Sqlite",
	}}
}

type provisionLoginPolicy struct {
	idm.UnimplementedPolicyEngineServiceServer
}

func (*provisionLoginPolicy) StreamPolicyGroups(_ *idm.ListPolicyGroupsRequest, stream idm.PolicyEngineService_StreamPolicyGroupsServer) error {
	return stream.Send(&idm.PolicyGroup{Policies: []*idm.Policy{{ID: "standard-oidc-login",
		Subjects: []string{"profile:" + common.PydioProfileStandard}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}})
}

// provisionIdP signs ID tokens and verifies them with go-oidc exactly as the
// native callback does, so the tests hold genuinely verified *oidc.IDToken.
type provisionIdP struct {
	t   *testing.T
	key *rsa.PrivateKey
}

func (p provisionIdP) token(issuer, subject, audience string, claims map[string]any) *oidc.IDToken {
	p.t.Helper()
	payload := map[string]any{"iss": issuer, "sub": subject, "aud": audience,
		"exp": time.Now().Add(time.Minute).Unix(), "iat": time.Now().Unix()}
	for k, v := range claims {
		payload[k] = v
	}
	data, err := json.Marshal(payload)
	if err != nil {
		p.t.Fatal(err)
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: p.key}, nil)
	if err != nil {
		p.t.Fatal(err)
	}
	signed, err := signer.Sign(data)
	if err != nil {
		p.t.Fatal(err)
	}
	raw, err := signed.CompactSerialize()
	if err != nil {
		p.t.Fatal(err)
	}
	keys := &oidc.StaticKeySet{PublicKeys: []crypto.PublicKey{&p.key.PublicKey}}
	// The audience check is the callback's (connector client); a foreign
	// audience is verified here only to prove the entry checks it again.
	verifier := oidc.NewVerifier(issuer, keys, &oidc.Config{ClientID: provisionClient, SkipClientIDCheck: audience != provisionClient})
	id, err := verifier.Verify(context.Background(), raw)
	if err != nil {
		p.t.Fatal(err)
	}
	return id
}

func setProvisionConnector(t *testing.T, ctx context.Context, c auth.NativeOIDCConnector) {
	t.Helper()
	if err := config.Set(ctx, []map[string]any{{"id": "platform-identity", "type": "kailo-oidc", "config": c}},
		"services", "pydio.web.oauth", "connectors"); err != nil {
		t.Fatal(err)
	}
}

func searchUsers(t *testing.T, ctx context.Context, q *idm.UserSingleQuery) []*idm.User {
	t.Helper()
	query, _ := anypb.New(q)
	stream, err := idmc.UserServiceClient(ctx).SearchUser(ctx, &idm.SearchUserRequest{Query: &service.Query{SubQueries: []*anypb.Any{query}}})
	if err != nil {
		t.Fatal(err)
	}
	var users []*idm.User
	for {
		response, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return users
		}
		if err != nil {
			t.Fatal(err)
		}
		users = append(users, response.GetUser())
	}
}

func createNativeUser(t *testing.T, ctx context.Context, u *idm.User) {
	t.Helper()
	if _, err := idmc.UserServiceClient(ctx).CreateUser(ctx, &idm.CreateUserRequest{User: u}); err != nil {
		t.Fatal(err)
	}
}

func subjectDigest(subject string) string {
	digest := sha256.Sum256([]byte(provisionIssuer + "\x00" + subject))
	return hex.EncodeToString(digest[:])[:12]
}

func linkedTo(t *testing.T, ctx context.Context, subject string) []*idm.User {
	t.Helper()
	return searchUsers(t, ctx, &idm.UserSingleQuery{AttributeName: auth.NativeOIDCSubjectAttribute, AttributeValue: subject})
}

func TestNativeOIDCFirstLoginProvisioning(t *testing.T) {
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
		on := auth.NativeOIDCConnector{Issuer: provisionIssuer, ClientID: provisionClient, ProvisionUsers: true, ProvisionProfile: common.PydioProfileStandard}
		off := auth.NativeOIDCConnector{Issuer: provisionIssuer, ClientID: provisionClient}

		t.Run("first-login-provisions-standard-account", func(t *testing.T) {
			idp := provisionIdP{t: t, key: key}
			setProvisionConnector(t, ctx, on)
			id := idp.token(provisionIssuer, "subject-new", provisionClient, map[string]any{"preferred_username": " New.Member ",
				"name": "New Member", "email": "new.member@example.invalid", "email_verified": true, "groups": []string{"admin"}})
			user, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-new", id)
			if err != nil {
				t.Fatal(err)
			}
			a := user.GetAttributes()
			if user.Login != "new.member" || user.GroupPath != "/" || a[idm.UserAttrProfile] != common.PydioProfileStandard ||
				a[auth.NativeOIDCIssuerAttribute] != provisionIssuer || a[auth.NativeOIDCSubjectAttribute] != "subject-new" ||
				a[idm.UserAttrDisplayName] != "New Member" || a[idm.UserAttrEmail] != "new.member@example.invalid" {
				t.Fatalf("unexpected provisioned account: %v %v", user.Login, a)
			}
			roleQuery, _ := anypb.New(&idm.RoleSingleQuery{Uuid: []string{user.Uuid}})
			roles, err := idmc.RoleServiceClient(ctx).SearchRole(ctx, &idm.SearchRoleRequest{Query: &service.Query{SubQueries: []*anypb.Any{roleQuery}}})
			if err != nil {
				t.Fatal(err)
			}
			role, err := roles.Recv()
			if err != nil || !role.GetRole().GetUserRole() {
				t.Fatalf("personal user role missing: %v", err)
			}
			aclQuery, _ := anypb.New(&idm.ACLSingleQuery{RoleIDs: []string{user.Uuid}})
			acls, err := idmc.ACLServiceClient(ctx).SearchACL(ctx, &idm.SearchACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{aclQuery}}})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := acls.Recv(); !errors.Is(err, io.EOF) {
				t.Fatal("provisioning granted an ACL")
			}
			// Only the native root group, profile auto-applied and personal roles.
			for _, r := range user.GetRoles() {
				if !r.GetUserRole() && !r.GetGroupRole() && len(r.GetAutoApplies()) == 0 {
					t.Fatalf("provisioning assigned role %s", r.GetUuid())
				}
			}

			// Attribute link: the PAT/WOPI path (no ID token) and a later login
			// both resolve the same account; nothing is created again.
			for _, login := range []*oidc.IDToken{nil, idp.token(provisionIssuer, "subject-new", provisionClient, map[string]any{"preferred_username": "renamed", "email": "other@example.invalid", "email_verified": true})} {
				again, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-new", login)
				if err != nil || again.Uuid != user.Uuid || again.Login != "new.member" || again.GetAttributes()[idm.UserAttrEmail] != "new.member@example.invalid" {
					t.Fatalf("provisioned account not resolved by its link: %v", err)
				}
			}
			if n := len(linkedTo(t, ctx, "subject-new")); n != 1 {
				t.Fatalf("%d accounts linked", n)
			}
		})

		t.Run("unverified-email-is-not-stored", func(t *testing.T) {
			setProvisionConnector(t, ctx, on)
			id := provisionIdP{t: t, key: key}.token(provisionIssuer, "subject-unverified", provisionClient, map[string]any{"preferred_username": "unverified", "email": "x@example.invalid"})
			user, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-unverified", id)
			if err != nil || user.GetAttributes()[idm.UserAttrEmail] != "" {
				t.Fatalf("unverified email stored or login failed: %v", err)
			}
		})

		t.Run("explicit-link-wins", func(t *testing.T) {
			idp := provisionIdP{t: t, key: key}
			setProvisionConnector(t, ctx, on)
			provisioned, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-explicit",
				idp.token(provisionIssuer, "subject-explicit", provisionClient, map[string]any{"preferred_username": "explicit.jit"}))
			if err != nil {
				t.Fatal(err)
			}
			linked := &idm.User{Uuid: "00000000-0000-4000-8000-00000000a001", Login: "explicit.member", GroupPath: "/",
				Attributes: map[string]string{idm.UserAttrProfile: common.PydioProfileStandard}}
			createNativeUser(t, ctx, linked)
			explicit := on
			explicit.Users = []auth.NativeOIDCUser{{Subject: "subject-explicit", UserUUID: linked.Uuid}}
			setProvisionConnector(t, ctx, explicit)
			for _, login := range []*oidc.IDToken{nil, idp.token(provisionIssuer, "subject-explicit", provisionClient, nil)} {
				user, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-explicit", login)
				if err != nil || user.Uuid != linked.Uuid || user.Uuid == provisioned.Uuid {
					t.Fatalf("explicit link did not take precedence: %v", err)
				}
			}
		})

		t.Run("concurrent-first-logins-create-one-account", func(t *testing.T) {
			setProvisionConnector(t, ctx, on)
			id := provisionIdP{t: t, key: key}.token(provisionIssuer, "subject-concurrent", provisionClient, map[string]any{"preferred_username": "concurrent"})
			const logins = 8
			uuids := make([]string, logins)
			errs := make([]error, logins)
			start := make(chan struct{})
			var wg sync.WaitGroup
			for i := 0; i < logins; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					<-start
					user, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-concurrent", id)
					errs[i] = err
					if user != nil {
						uuids[i] = user.Uuid
					}
				}(i)
			}
			close(start)
			wg.Wait()
			for i := range uuids {
				if errs[i] != nil || uuids[i] == "" || uuids[i] != uuids[0] {
					t.Fatalf("concurrent first login %d diverged: %v", i, errs[i])
				}
			}
			if n := len(linkedTo(t, ctx, "subject-concurrent")); n != 1 {
				t.Fatalf("%d accounts for one identity", n)
			}
			if n := len(searchUsers(t, ctx, &idm.UserSingleQuery{Login: "concurrent"})); n != 1 {
				t.Fatalf("%d accounts with the login", n)
			}
		})

		t.Run("login-conflict-uses-deterministic-suffix", func(t *testing.T) {
			idp := provisionIdP{t: t, key: key}
			setProvisionConnector(t, ctx, on)
			for _, c := range []struct{ subject, preferred, login string }{
				{"subject-admin", "admin", "admin-" + subjectDigest("subject-admin")},
				{"subject-invalid", "Bad Name!", "oidc-" + subjectDigest("subject-invalid")},
				{"subject-missing", "", "oidc-" + subjectDigest("subject-missing")},
			} {
				claims := map[string]any{}
				if c.preferred != "" {
					claims["preferred_username"] = c.preferred
				}
				user, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, c.subject, idp.token(provisionIssuer, c.subject, provisionClient, claims))
				if err != nil || user.Login != c.login {
					t.Fatalf("%s: expected %s: %v %v", c.subject, c.login, user.GetLogin(), err)
				}
			}
			if admins := searchUsers(t, ctx, &idm.UserSingleQuery{Login: "admin"}); len(admins) != 1 || admins[0].GetAttributes()[auth.NativeOIDCSubjectAttribute] != "" {
				t.Fatal("existing native user was linked or replaced")
			}
			// The single fallback is taken too: refuse instead of trying further.
			createNativeUser(t, ctx, &idm.User{Login: "admin-" + subjectDigest("subject-blocked"), GroupPath: "/",
				Attributes: map[string]string{idm.UserAttrProfile: common.PydioProfileStandard}})
			if _, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-blocked",
				idp.token(provisionIssuer, "subject-blocked", provisionClient, map[string]any{"preferred_username": "admin"})); err == nil {
				t.Fatal("a third login name was invented")
			}
			if n := len(linkedTo(t, ctx, "subject-blocked")); n != 0 {
				t.Fatal("refused provisioning left an account")
			}
		})

		t.Run("switch-off-keeps-explicit-link-semantics", func(t *testing.T) {
			setProvisionConnector(t, ctx, off)
			id := provisionIdP{t: t, key: key}.token(provisionIssuer, "subject-off", provisionClient, map[string]any{"preferred_username": "switch.off"})
			if _, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-off", id); !errors.Is(err, auth.ErrNativeOIDCNotLinked) {
				t.Fatalf("unlinked identity with provisioning off: %v", err)
			}
			if len(searchUsers(t, ctx, &idm.UserSingleQuery{Login: "switch.off"})) != 0 || len(linkedTo(t, ctx, "subject-off")) != 0 {
				t.Fatal("provisioning off created an account")
			}
			// An already provisioned account still resolves; only creation stops.
			if user, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-new", nil); err != nil || user.Login != "new.member" {
				t.Fatalf("provisioned account lost with the switch off: %v", err)
			}
		})

		t.Run("foreign-issuer-audience-or-token-refused", func(t *testing.T) {
			idp := provisionIdP{t: t, key: key}
			setProvisionConnector(t, ctx, on)
			other := "https://other-idp.example.invalid"
			for name, call := range map[string]func() error{
				"issuer": func() error {
					_, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, other, "subject-foreign", idp.token(other, "subject-foreign", provisionClient, map[string]any{"preferred_username": "foreign"}))
					return err
				},
				"audience": func() error {
					_, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-foreign", idp.token(provisionIssuer, "subject-foreign", "another-client", map[string]any{"preferred_username": "foreign"}))
					return err
				},
				"token-of-another-subject": func() error {
					_, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-foreign", idp.token(provisionIssuer, "subject-other", provisionClient, map[string]any{"preferred_username": "foreign"}))
					return err
				},
			} {
				if err := call(); err == nil || errors.Is(err, auth.ErrNativeOIDCNotLinked) {
					t.Fatalf("%s: refused for the wrong reason or accepted: %v", name, err)
				}
			}
			if len(searchUsers(t, ctx, &idm.UserSingleQuery{Login: "foreign"})) != 0 || len(linkedTo(t, ctx, "subject-foreign")) != 0 {
				t.Fatal("a foreign token created an account")
			}
		})

		t.Run("occupied-derived-account-refused", func(t *testing.T) {
			idp := provisionIdP{t: t, key: key}
			setProvisionConnector(t, ctx, on)
			// Learn the derived UUID from a first identity, then occupy the
			// derived UUID of a second one with an account lacking its link.
			first, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-derived",
				idp.token(provisionIssuer, "subject-derived", provisionClient, map[string]any{"preferred_username": "derived"}))
			if err != nil {
				t.Fatal(err)
			}
			stored := searchUsers(t, ctx, &idm.UserSingleQuery{Uuid: first.Uuid})[0]
			stripped := proto.Clone(stored).(*idm.User)
			auth.WithoutNativeOIDCLink(stripped.Attributes)
			createNativeUser(t, ctx, stripped)
			if _, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-derived",
				idp.token(provisionIssuer, "subject-derived", provisionClient, map[string]any{"preferred_username": "derived"})); err == nil {
				t.Fatal("an account without the link was taken over")
			}
			// A link copied onto another UUID never resolves.
			createNativeUser(t, ctx, &idm.User{Uuid: "00000000-0000-4000-8000-00000000a002", Login: "copied.link", GroupPath: "/",
				Attributes: map[string]string{idm.UserAttrProfile: common.PydioProfileStandard,
					auth.NativeOIDCIssuerAttribute: provisionIssuer, auth.NativeOIDCSubjectAttribute: "subject-copied"}})
			setProvisionConnector(t, ctx, off)
			if _, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "subject-copied", nil); !errors.Is(err, auth.ErrNativeOIDCNotLinked) {
				t.Fatalf("copied link attributes resolved: %v", err)
			}
		})
	})
}

func TestNativeOIDCConnectorValidation(t *testing.T) {
	base := auth.NativeOIDCConnector{Issuer: provisionIssuer, ClientID: provisionClient}
	for name, c := range map[string]auth.NativeOIDCConnector{
		"enabled-without-profile": {Issuer: provisionIssuer, ClientID: provisionClient, ProvisionUsers: true},
		"enabled-admin-profile":   {Issuer: provisionIssuer, ClientID: provisionClient, ProvisionUsers: true, ProvisionProfile: common.PydioProfileAdmin},
		"disabled-with-profile":   {Issuer: provisionIssuer, ClientID: provisionClient, ProvisionProfile: common.PydioProfileStandard},
		"missing-client":          {Issuer: provisionIssuer},
		"duplicate-subject": {Issuer: provisionIssuer, ClientID: provisionClient, Users: []auth.NativeOIDCUser{
			{Subject: "s", UserUUID: "u1"}, {Subject: "s", UserUUID: "u2"}}},
	} {
		if c.Validate() == nil {
			t.Fatalf("%s accepted", name)
		}
	}
	enabled := base
	enabled.ProvisionUsers, enabled.ProvisionProfile = true, common.PydioProfileStandard
	for _, c := range []auth.NativeOIDCConnector{base, enabled} {
		if err := c.Validate(); err != nil {
			t.Fatal(err)
		}
	}
}

func TestNativeOIDCLinkIsNotWritableThroughREST(t *testing.T) {
	attributes := map[string]string{auth.NativeOIDCIssuerAttribute: provisionIssuer, auth.NativeOIDCSubjectAttribute: "victim",
		idm.UserAttrDisplayName: "Display"}
	auth.WithoutNativeOIDCLink(attributes)
	if len(attributes) != 1 || attributes[idm.UserAttrDisplayName] != "Display" {
		t.Fatalf("link attributes survived a REST write: %v", attributes)
	}
	auth.WithoutNativeOIDCLink(nil)
}
