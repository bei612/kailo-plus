package auth_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
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
	cellsuuid "github.com/pydio/cells/v5/common/utils/uuid"
)

const (
	dirBinding  = "0b7a6d52-5d0e-4c3b-9a49-3f1f3e3c2a01"
	dirTenant   = "6f0c2a1e-8b9d-4e4f-a1b2-c3d4e5f60718"
	dirWsDesign = "11111111-2222-4333-8444-555555555501"
	dirWsOps    = "11111111-2222-4333-8444-555555555502"
	dirClient   = "kailo-cells-directory"
)

func useDirectoryStore(t *testing.T) string {
	t.Helper()
	store := filepath.Join(t.TempDir(), "kailo", "member-directory.json")
	previous := auth.NativeOIDCDirectoryStorePath
	auth.NativeOIDCDirectoryStorePath = func() string { return store }
	t.Cleanup(func() { auth.NativeOIDCDirectoryStorePath = previous })
	return store
}

type dirMember struct {
	principal, name, role string
	subjects            []string
	foreign             bool
	workspaces          map[string]string // id → role
}

func dirSnapshot(version, tenant string, workspaces map[string]string, members ...dirMember) map[string]any {
	ws := []map[string]any{}
	for id, name := range workspaces {
		ws = append(ws, map[string]any{"workspaceId": id, "name": name})
	}
	ms := []map[string]any{}
	for _, m := range members {
		ids := []map[string]any{}
		for _, s := range m.subjects {
			ids = append(ids, map[string]any{"issuer": provisionIssuer, "subject": s, "picture": "https://kailo.example.invalid/api/v1/identity/avatars/" + s})
		}
		if m.foreign {
			ids = append(ids, map[string]any{"issuer": "https://other.example.invalid/realms/x", "subject": "foreign-" + m.principal[:4], "picture": "https://x.invalid/a"})
		}
		mws := []map[string]any{}
		for id, r := range m.workspaces {
			mws = append(mws, map[string]any{"workspaceId": id, "role": r})
		}
		ms = append(ms, map[string]any{"principalId": m.principal, "displayName": m.name, "tenantRole": m.role, "identities": ids, "workspaces": mws})
	}
	return map[string]any{"bindingId": dirBinding, "directoryVersion": strings.Repeat(version, 64)[:64],
		"tenant": map[string]any{"tenantId": tenant, "name": "Kailo Directory"}, "workspaces": ws, "members": ms}
}

// fakeCore answers the IdP token endpoint and the Core directory read.
type fakeCore struct {
	sync.Mutex
	tokenStatus, readStatus int
	body                    []byte
	reads                   int
	secret                  string
}

func (f *fakeCore) set(status int, body any) {
	f.Lock()
	defer f.Unlock()
	f.readStatus = status
	switch b := body.(type) {
	case []byte:
		f.body = b
	default:
		f.body, _ = json.Marshal(b)
	}
}

func (f *fakeCore) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.Lock()
	defer f.Unlock()
	switch r.URL.Path {
	case "/token":
		user, pass, ok := r.BasicAuth()
		if f.tokenStatus != 0 || !ok || user != dirClient || pass != f.secret || r.FormValue("grant_type") != "client_credentials" {
			w.WriteHeader(max(f.tokenStatus, http.StatusUnauthorized))
			return
		}
		_, _ = io.WriteString(w, `{"access_token":"directory-token","token_type":"Bearer","expires_in":60}`)
	case "/service/v1/component-directory/bindings/" + dirBinding + "/members":
		f.reads++
		if r.Header.Get("Authorization") != "Bearer directory-token" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.WriteHeader(f.readStatus)
		_, _ = w.Write(f.body)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

func userByUUID(t *testing.T, ctx context.Context, id string) *idm.User {
	t.Helper()
	found := searchUsers(t, ctx, &idm.UserSingleQuery{Uuid: id})
	if len(found) != 1 {
		t.Fatalf("account %s: %d found", id, len(found))
	}
	return found[0]
}

func derived(subject string) string {
	return uuid.NewSHA1(uuid.MustParse("ea26a77c-2ecd-45ee-a46e-9c1f968c908c"), []byte(provisionIssuer+"\x00"+subject)).String()
}

func hasRole(u *idm.User, id string) bool {
	return slices.ContainsFunc(u.GetRoles(), func(r *idm.Role) bool { return r.GetUuid() == id })
}

func workspaceRole(t *testing.T, ctx context.Context, workspaceID string) *idm.Role {
	t.Helper()
	q, _ := anypb.New(&idm.RoleSingleQuery{Uuid: []string{auth.NativeOIDCWorkspaceRoleID(workspaceID)}})
	stream, err := idmc.RoleServiceClient(ctx).SearchRole(ctx, &idm.SearchRoleRequest{Query: &service.Query{SubQueries: []*anypb.Any{q}}})
	if err != nil {
		t.Fatal(err)
	}
	for {
		r, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			t.Fatal(err)
		}
		return r.GetRole()
	}
}

// DD-133(4), 07 §4.7.4: the member directory pre-provisions, derives roles
// and Workspace teams, revokes and readmits; failures change nothing; logins
// follow the applied snapshot, also after a restart.
func TestNativeOIDCMemberDirectory(t *testing.T) {
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
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
		grpcclient.RegisterMock(common.ServicePolicyGRPC, &idm.PolicyEngineServiceStub{PolicyEngineServiceServer: &kailoLoginPolicy{}})
		permissions.ClearCachedPolicies(ctx, "oidc")
		idp := provisionIdP{t: t, key: key}
		store := useDirectoryStore(t)
		useSessionStore(t)
		setProvisionConnector(t, ctx, auth.NativeOIDCConnector{Issuer: provisionIssuer, ClientID: provisionClient, ProvisionUsers: true,
			ProvisionProfile: common.PydioProfileStandard,
			Organization:     &auth.NativeOIDCOrganization{Tenant: auth.NativeOIDCTenant{ID: dirTenant, Name: "Kailo Verify"}}})
		core := &fakeCore{secret: "directory-secret"}
		server := httptest.NewServer(core)
		defer server.Close()
		secretFile := filepath.Join(t.TempDir(), "client_secret")
		if err := os.WriteFile(secretFile, []byte(core.secret+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
		cfg := &auth.NativeOIDCDirectoryConfig{BindingID: dirBinding, ClientID: dirClient, ClientSecretFile: secretFile,
			TokenURL: server.URL + "/token", CoreURL: server.URL, Interval: time.Minute}
		login := func(subject string, claims map[string]any) (*idm.User, error) {
			return auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, subject, idp.token(provisionIssuer, subject, provisionClient, claims))
		}
		admin := dirMember{principal: "a0000000-0000-4000-8000-000000000001", name: "Admin Person", role: "ADMIN", subjects: []string{"dir-admin"}, foreign: true}
		bob := dirMember{principal: "b0000000-0000-4000-8000-000000000002", name: "Bob Member", role: "MEMBER", subjects: []string{"dir-bob"},
			workspaces: map[string]string{dirWsDesign: "ADMIN"}}
		pre := dirMember{principal: "c0000000-0000-4000-8000-000000000003", name: "Pre Member", role: "MEMBER", subjects: []string{"dir-pre"}}
		both := map[string]string{dirWsDesign: "Design", dirWsOps: "Ops"}
		groupPath := auth.NativeOIDCTenantGroupPath(dirTenant)

		t.Run("before-delivery-unchanged", func(t *testing.T) {
			u, err := login("dir-pre", map[string]any{"preferred_username": "pre"})
			if err != nil || u.GetAttributes()[idm.UserAttrProfile] != common.PydioProfileStandard || u.GetGroupPath() != groupPath {
				t.Fatalf("pre-directory login: %v", err)
			}
			if _, err := login("dir-stranger", map[string]any{"preferred_username": "stranger"}); err != nil {
				t.Fatalf("pre-directory first login of anybody provisions: %v", err)
			}
		})

		t.Run("first-snapshot", func(t *testing.T) {
			core.set(http.StatusOK, dirSnapshot("1", dirTenant, both, admin, bob, pre))
			applied, err := auth.SyncNativeOIDCDirectory(ctx, cfg)
			if err != nil || !applied {
				t.Fatalf("first snapshot: %v %v", applied, err)
			}
			a := userByUUID(t, ctx, derived("dir-admin"))
			if a.GetAttributes()[idm.UserAttrProfile] != common.PydioProfileAdmin || a.GetGroupPath() != groupPath ||
				a.GetAttributes()[idm.UserAttrDisplayName] != "Admin Person" || a.GetLogin() != "admin.person" ||
				a.GetAttributes()[idm.UserAttrAvatar] != "https://kailo.example.invalid/api/v1/identity/avatars/dir-admin" {
				t.Fatalf("pre-provisioned admin: %s %s %v", a.GetLogin(), a.GetGroupPath(), a.GetAttributes())
			}
			b := userByUUID(t, ctx, derived("dir-bob"))
			if b.GetAttributes()[idm.UserAttrProfile] != common.PydioProfileStandard || !hasRole(b, auth.NativeOIDCWorkspaceRoleID(dirWsDesign)) ||
				hasRole(b, auth.NativeOIDCWorkspaceRoleID(dirWsOps)) {
				t.Fatalf("member teams: %v", b.GetRoles())
			}
			if r := workspaceRole(t, ctx, dirWsDesign); r == nil || !r.GetIsTeam() || r.GetLabel() != "Design" {
				t.Fatalf("Workspace team: %v", r)
			}
			if len(linkedTo(t, ctx, "foreign-a000")) != 0 {
				t.Fatal("identity of another issuer provisioned")
			}
			if g := tenantGroup(t, ctx, dirTenant); g.GetAttributes()[idm.UserAttrDisplayName] != "Kailo Directory" {
				t.Fatalf("Tenant group label: %v", g.GetAttributes())
			}
			if info, err := os.Stat(store); err != nil || info.Mode().Perm() != 0600 {
				t.Fatalf("store: %v", err)
			}
			// The stranger provisioned before delivery is not in the snapshot.
			if s := userByUUID(t, ctx, derived("dir-stranger")); !permissions.IsUserLocked(s) {
				t.Fatal("account absent from the first snapshot is not locked")
			}
		})

		t.Run("same-version-writes-nothing", func(t *testing.T) {
			b := userByUUID(t, ctx, derived("dir-bob"))
			b.Attributes[idm.UserAttrDisplayName] = "Tampered"
			createNativeUser(t, ctx, b)
			applied, err := auth.SyncNativeOIDCDirectory(ctx, cfg)
			if err != nil || applied || userByUUID(t, ctx, derived("dir-bob")).GetAttributes()[idm.UserAttrDisplayName] != "Tampered" {
				t.Fatalf("unchanged version re-applied: %v %v", applied, err)
			}
		})

		t.Run("failures-keep-the-organisation", func(t *testing.T) {
			before, _ := os.ReadFile(store)
			changed := dirSnapshot("2", dirTenant, map[string]string{}, pre)
			for name, prepare := range map[string]func(){
				"core-503":     func() { core.set(http.StatusServiceUnavailable, changed) },
				"core-403":     func() { core.set(http.StatusForbidden, changed) },
				"token-401":    func() { core.set(http.StatusOK, changed); core.tokenStatus = http.StatusUnauthorized },
				"bad-json":     func() { core.set(http.StatusOK, []byte(`{"bindingId":`)) },
				"unknown-key":  func() { c := dirSnapshot("2", dirTenant, nil, pre); c["extra"] = 1; core.set(http.StatusOK, c) },
				"bad-role":     func() { c := dirSnapshot("2", dirTenant, nil, dirMember{principal: pre.principal, name: "x", role: "OWNER"}); core.set(http.StatusOK, c) },
				"other-tenant": func() { core.set(http.StatusOK, dirSnapshot("2", "6f0c2a1e-8b9d-4e4f-a1b2-c3d4e5f60799", nil, pre)) },
				"other-binding": func() {
					c := dirSnapshot("2", dirTenant, nil, pre)
					c["bindingId"] = "0b7a6d52-5d0e-4c3b-9a49-3f1f3e3c2a99"
					core.set(http.StatusOK, c)
				},
			} {
				prepare()
				applied, err := auth.SyncNativeOIDCDirectory(ctx, cfg)
				core.tokenStatus = 0
				if err == nil || applied {
					t.Fatalf("%s: applied=%v", name, applied)
				}
				after, _ := os.ReadFile(store)
				if string(after) != string(before) || userByUUID(t, ctx, derived("dir-admin")).GetAttributes()[idm.UserAttrProfile] != common.PydioProfileAdmin ||
					permissions.IsUserLocked(userByUUID(t, ctx, derived("dir-bob"))) {
					t.Fatalf("%s changed the organisation", name)
				}
			}
			var unavailable *auth.NativeOIDCDirectoryUnavailable
			core.set(http.StatusServiceUnavailable, nil)
			if _, err := auth.SyncNativeOIDCDirectory(ctx, cfg); !errors.As(err, &unavailable) || unavailable.Status != http.StatusServiceUnavailable {
				t.Fatalf("503 not reported as unavailable: %v", err)
			}
		})

		t.Run("revoke-demote-and-workspace-gone", func(t *testing.T) {
			if err := auth.RecordNativeOIDCSession("native-bob", provisionIssuer, "dir-bob", "sid-bob", derived("dir-bob"), time.Hour); err != nil {
				t.Fatal(err)
			}
			demoted := admin
			demoted.role = "MEMBER"
			inOps := pre
			inOps.workspaces = map[string]string{dirWsOps: "MEMBER"}
			core.set(http.StatusOK, dirSnapshot("3", dirTenant, map[string]string{dirWsOps: "Ops"}, demoted, inOps))
			if applied, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err != nil || !applied {
				t.Fatalf("second snapshot: %v", err)
			}
			if a := userByUUID(t, ctx, derived("dir-admin")); a.GetAttributes()[idm.UserAttrProfile] != common.PydioProfileStandard {
				t.Fatal("admin not demoted")
			}
			b := userByUUID(t, ctx, derived("dir-bob"))
			if !permissions.IsUserLocked(b) || b.GetAttributes()[auth.NativeOIDCDirectoryLockAttribute] == "" || hasRole(b, auth.NativeOIDCWorkspaceRoleID(dirWsDesign)) {
				t.Fatalf("removed member not revoked: %v %v", b.GetAttributes(), b.GetRoles())
			}
			if !auth.NativeOIDCSessionEnded("native-bob") {
				t.Fatal("removed member's native session still valid")
			}
			if !hasRole(userByUUID(t, ctx, derived("dir-pre")), auth.NativeOIDCWorkspaceRoleID(dirWsOps)) {
				t.Fatal("Workspace team not attached")
			}
			if workspaceRole(t, ctx, dirWsDesign) == nil {
				t.Fatal("team of a vanished Workspace deleted (native ACLs would be lost)")
			}
			if _, err := login("dir-bob", map[string]any{"preferred_username": "bob"}); !errors.Is(err, auth.ErrNativeOIDCNotMember) {
				t.Fatalf("removed member logged in: %v", err)
			}
			if _, err := auth.ResolveOrProvisionNativeOIDCUser(ctx, provisionIssuer, "dir-bob", nil); !errors.Is(err, auth.ErrNativeOIDCNotMember) {
				t.Fatalf("removed member resolved without login: %v", err)
			}
		})

		t.Run("login-follows-directory", func(t *testing.T) {
			core.set(http.StatusOK, dirSnapshot("4", dirTenant, map[string]string{dirWsOps: "Ops"}, admin, pre))
			if _, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err != nil {
				t.Fatal(err)
			}
			u, err := login("dir-admin", map[string]any{"preferred_username": "x", "name": "Token Name", "email": "a@example.invalid", "email_verified": true})
			if err != nil {
				t.Fatal(err)
			}
			if a := u.GetAttributes(); a[idm.UserAttrProfile] != common.PydioProfileAdmin || a[idm.UserAttrDisplayName] != "Admin Person" ||
				a[idm.UserAttrEmail] != "a@example.invalid" || u.GetLogin() != "admin.person" {
				t.Fatalf("login did not follow the directory: %s %v", u.GetLogin(), a)
			}
			if _, err := login("dir-newcomer", map[string]any{"preferred_username": "newcomer"}); !errors.Is(err, auth.ErrNativeOIDCNotMember) {
				t.Fatalf("identity outside the directory provisioned: %v", err)
			}
			if len(linkedTo(t, ctx, "dir-newcomer")) != 0 {
				t.Fatal("refused login created an account")
			}
		})

		t.Run("readmit-unlocks", func(t *testing.T) {
			core.set(http.StatusOK, dirSnapshot("5", dirTenant, both, admin, bob, pre))
			if _, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err != nil {
				t.Fatal(err)
			}
			b := userByUUID(t, ctx, derived("dir-bob"))
			if permissions.IsUserLocked(b) || b.GetAttributes()[auth.NativeOIDCDirectoryLockAttribute] != "" || !hasRole(b, auth.NativeOIDCWorkspaceRoleID(dirWsDesign)) {
				t.Fatalf("readmitted member: %v", b.GetAttributes())
			}
			if _, err := login("dir-bob", map[string]any{"preferred_username": "bob"}); err != nil {
				t.Fatalf("readmitted member cannot log in: %v", err)
			}
		})

		t.Run("restart-keeps-the-applied-snapshot", func(t *testing.T) {
			raw, err := os.ReadFile(store)
			if err != nil {
				t.Fatal(err)
			}
			restarted := filepath.Join(t.TempDir(), "member-directory.json")
			if err := os.WriteFile(restarted, raw, 0600); err != nil {
				t.Fatal(err)
			}
			auth.NativeOIDCDirectoryStorePath = func() string { return restarted }
			core.set(http.StatusServiceUnavailable, nil)
			if _, err := login("dir-newcomer", nil); !errors.Is(err, auth.ErrNativeOIDCNotMember) {
				t.Fatalf("restart fell back to the pre-directory behaviour: %v", err)
			}
			u, err := login("dir-admin", nil)
			if err != nil || u.GetAttributes()[idm.UserAttrProfile] != common.PydioProfileAdmin {
				t.Fatalf("restart lost the directory role: %v", err)
			}
		})
	})
}

func TestNativeOIDCDirectoryConfigFromEnv(t *testing.T) {
	keys := map[string]string{"KAILO_DIRECTORY_BINDING_ID": dirBinding, "KAILO_DIRECTORY_CLIENT_ID": dirClient,
		"KAILO_DIRECTORY_CLIENT_SECRET_FILE": "/run/secrets/cells_directory_client_secret",
		"KAILO_DIRECTORY_TOKEN_URL":          "http://idp.example.invalid/realms/kailo/protocol/openid-connect/token",
		"KAILO_DIRECTORY_CORE_URL":           "http://core-bff:8081"}
	for k := range keys {
		t.Setenv(k, "")
	}
	t.Setenv("KAILO_DIRECTORY_INTERVAL_SECONDS", "")
	if c, err := auth.NativeOIDCDirectoryConfigFromEnv(); c != nil || err != nil {
		t.Fatalf("absent delivery: %v %v", c, err)
	}
	t.Setenv("KAILO_DIRECTORY_BINDING_ID", dirBinding)
	if _, err := auth.NativeOIDCDirectoryConfigFromEnv(); err == nil {
		t.Fatal("partial delivery accepted")
	}
	for k, v := range keys {
		t.Setenv(k, v)
	}
	c, err := auth.NativeOIDCDirectoryConfigFromEnv()
	if err != nil || c.Interval != time.Minute {
		t.Fatalf("complete delivery: %v", err)
	}
	for k, bad := range map[string]string{"KAILO_DIRECTORY_INTERVAL_SECONDS": "5", "KAILO_DIRECTORY_BINDING_ID": "not-a-uuid",
		"KAILO_DIRECTORY_CLIENT_ID": "a b", "KAILO_DIRECTORY_CORE_URL": "http://core-bff:8081/service?x=1",
		"KAILO_DIRECTORY_TOKEN_URL": "ftp://idp", "KAILO_DIRECTORY_CLIENT_SECRET_FILE": "relative"} {
		t.Setenv(k, bad)
		if _, err := auth.NativeOIDCDirectoryConfigFromEnv(); err == nil {
			t.Errorf("%s=%q accepted", k, bad)
		}
		if v, ok := keys[k]; ok {
			t.Setenv(k, v)
		} else {
			t.Setenv(k, "")
		}
	}
}

func TestParseNativeOIDCDirectory(t *testing.T) {
	member := dirMember{principal: "a0000000-0000-4000-8000-000000000001", name: "A", role: "ADMIN", subjects: []string{"s"},
		workspaces: map[string]string{dirWsOps: "MEMBER"}}
	good := dirSnapshot("a", dirTenant, map[string]string{dirWsOps: "Ops"}, member)
	raw, _ := json.Marshal(good)
	s, err := auth.ParseNativeOIDCDirectory(raw)
	if err != nil || len(s.Members) != 1 || !s.Members[0].Admin || s.Members[0].Workspaces[0] != dirWsOps {
		t.Fatalf("valid snapshot: %v", err)
	}
	mutate := map[string]func(map[string]any){
		"missing-members":   func(m map[string]any) { delete(m, "members") },
		"short-version":     func(m map[string]any) { m["directoryVersion"] = "abc" },
		"unknown-workspace": func(m map[string]any) { m["workspaces"] = []any{} },
		"duplicate-identity": func(m map[string]any) {
			ms := m["members"].([]map[string]any)
			other := map[string]any{}
			for k, v := range ms[0] {
				other[k] = v
			}
			other["principalId"] = "b0000000-0000-4000-8000-000000000002"
			m["members"] = append(ms, other)
		},
		"null-identities": func(m map[string]any) { m["members"].([]map[string]any)[0]["identities"] = nil },
	}
	for name, change := range mutate {
		value := dirSnapshot("a", dirTenant, map[string]string{dirWsOps: "Ops"}, member)
		change(value)
		raw, _ := json.Marshal(value)
		if _, err := auth.ParseNativeOIDCDirectory(raw); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}
