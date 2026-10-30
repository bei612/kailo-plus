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
	dirRoot     = "kailobinding/kailo-binding"
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
	subjects              []string
	foreign               bool
	workspaces            map[string]string // id → role
	// readOnly: Workspaces where the member has no Kailo `create` (schema 2).
	readOnly     map[string]bool
	tenantCreate bool
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
			mws = append(mws, map[string]any{"workspaceId": id, "role": r, "create": !m.readOnly[id]})
		}
		ms = append(ms, map[string]any{"principalId": m.principal, "displayName": m.name, "tenantRole": m.role,
			"tenantCreate": m.tenantCreate || m.role == "ADMIN", "identities": ids, "workspaces": mws})
	}
	return map[string]any{"schema": 2, "bindingId": dirBinding, "directoryVersion": strings.Repeat(version, 64)[:64],
		"tenant": map[string]any{"tenantId": tenant, "name": "Kailo Directory"}, "workspaces": ws, "members": ms, "shares": []any{}}
}

// dirShare is one shares[] entry: grants as subject → access.
func dirShare(resource, node, owner string, grants ...map[string]any) map[string]any {
	gs := []map[string]any{}
	for _, g := range grants {
		gs = append(gs, g)
	}
	return map[string]any{"resourceId": resource, "nativeType": "folder", "nativeId": node, "ownerPrincipalId": owner, "grants": gs}
}

func dirGrant(kind, id, access string) map[string]any {
	subject := map[string]any{"kind": kind}
	switch kind {
	case "PRINCIPAL":
		subject["principalId"] = id
	case "WORKSPACE":
		subject["workspaceId"] = id
	}
	return map[string]any{"subject": subject, "access": access}
}

// fakeCore answers the IdP token endpoint and the Core directory read.
type fakeCore struct {
	sync.Mutex
	tokenStatus, readStatus int
	body                    []byte
	reads                   int
	secret                  string
	query                   string
	receipts                []map[string]any
	receiptStatus           int
	intents                 []map[string]any
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
		f.query = r.URL.RawQuery
		if r.Header.Get("Authorization") != "Bearer directory-token" {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.WriteHeader(f.readStatus)
		_, _ = w.Write(f.body)
	case "/service/v1/component-directory/bindings/" + dirBinding + "/receipt":
		var receipt map[string]any
		if r.Method != http.MethodPut || r.Header.Get("Authorization") != "Bearer directory-token" || json.NewDecoder(r.Body).Decode(&receipt) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if f.receiptStatus != 0 {
			w.WriteHeader(f.receiptStatus)
			return
		}
		f.receipts = append(f.receipts, receipt)
		w.WriteHeader(http.StatusNoContent)
	case "/service/v1/component-directory/bindings/" + dirBinding + "/share-intents":
		var intent map[string]any
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer directory-token" || json.NewDecoder(r.Body).Decode(&intent) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.intents = append(f.intents, intent)
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"intentId":"9e0c2a1e-8b9d-4e4f-a1b2-c3d4e5f60718","expiresAt":"2026-10-30T10:10:00Z"}`)
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

func nativeWorkspace(t *testing.T, ctx context.Context, workspaceID string) *idm.Workspace {
	t.Helper()
	q, _ := anypb.New(&idm.WorkspaceSingleQuery{Slug: auth.NativeOIDCWorkspaceRoleID(workspaceID)})
	stream, err := idmc.WorkspaceServiceClient(ctx).SearchWorkspace(ctx, &idm.SearchWorkspaceRequest{Query: &service.Query{SubQueries: []*anypb.Any{q}}})
	if err != nil {
		t.Fatal(err)
	}
	var found []*idm.Workspace
	for {
		r, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		found = append(found, r.GetWorkspace())
	}
	if len(found) > 1 {
		t.Fatalf("%d native workspaces for one Kailo Workspace", len(found))
	}
	if len(found) == 0 {
		return nil
	}
	return found[0]
}

// workspaceACLs lists the ACL action names on one workspace: "<role>:<action>"
// for role grants, "root:<path>" for the workspace root.
func workspaceACLs(t *testing.T, ctx context.Context, ws *idm.Workspace) []string {
	t.Helper()
	q, _ := anypb.New(&idm.ACLSingleQuery{WorkspaceIDs: []string{ws.GetUUID()}})
	stream, err := idmc.ACLServiceClient(ctx).SearchACL(ctx, &idm.SearchACLRequest{Query: &service.Query{SubQueries: []*anypb.Any{q}}})
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
		a := r.GetACL()
		switch {
		case a.GetAction().GetName() == permissions.AclWsrootActionName:
			out = append(out, "root:"+a.GetNodeID()+":"+a.GetAction().GetValue())
		case a.GetRoleID() != "":
			out = append(out, a.GetRoleID()+":"+a.GetAction().GetName()+":"+a.GetNodeID())
		}
	}
	slices.Sort(out)
	return out
}

func wsHasPolicy(ws *idm.Workspace, action service.ResourcePolicyAction, subject string) bool {
	return slices.ContainsFunc(ws.GetPolicies(), func(p *service.ResourcePolicy) bool {
		return p.GetAction() == action && p.GetSubject() == subject && p.GetEffect() == service.ResourcePolicy_allow
	})
}

// fakeFolders stands in for the admin router: one stable node UUID per path.
type fakeFolders struct {
	sync.Mutex
	nodes map[string]string
}

func (f *fakeFolders) ensure(_ context.Context, p string) (string, error) {
	f.Lock()
	defer f.Unlock()
	if f.nodes == nil {
		f.nodes = map[string]string{}
	}
	if _, ok := f.nodes[p]; !ok {
		f.nodes[p] = uuid.NewSHA1(uuid.NameSpaceURL, []byte(p)).String()
	}
	return f.nodes[p], nil
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
			TokenURL: server.URL + "/token", CoreURL: server.URL, WorkspaceRoot: dirRoot, Interval: time.Minute}
		folders := &fakeFolders{}
		previousFolder := auth.NativeOIDCWorkspaceFolder
		auth.NativeOIDCWorkspaceFolder = folders.ensure
		defer func() { auth.NativeOIDCWorkspaceFolder = previousFolder }()
		// Shared folders (DD-164(4)): node UUID → name; absent = deleted natively.
		shareNodes := map[string]string{}
		var shareNodesMu sync.Mutex
		previousNode := auth.NativeOIDCShareNode
		auth.NativeOIDCShareNode = func(_ context.Context, id string) (bool, bool, string, error) {
			shareNodesMu.Lock()
			defer shareNodesMu.Unlock()
			name, ok := shareNodes[id]
			return ok, ok, name, nil
		}
		defer func() { auth.NativeOIDCShareNode = previousNode }()
		// 07 §4.7.4 撤员时的原生令牌: logins whose tokens were revoked.
		var revoked []string
		previousRevoke := auth.NativeOIDCRevokeAccountTokens
		auth.NativeOIDCRevokeAccountTokens = func(_ context.Context, login string) error {
			revoked = append(revoked, login)
			return nil
		}
		defer func() { auth.NativeOIDCRevokeAccountTokens = previousRevoke }()
		folderOf := func(workspaceID string) string {
			id, _ := folders.ensure(ctx, dirRoot+"/"+workspaceID)
			return id
		}
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
			if core.query != "schema=2" {
				t.Fatalf("directory read without schema 2: %q", core.query)
			}
			if len(core.receipts) != 1 || core.receipts[0]["outcome"] != "APPLIED" || core.receipts[0]["schema"] != float64(2) ||
				core.receipts[0]["directoryVersion"] != strings.Repeat("1", 64) || len(core.receipts[0]["failures"].([]any)) != 0 {
				t.Fatalf("receipt after the first snapshot: %v", core.receipts)
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
			if r := workspaceRole(t, ctx, dirWsDesign); r == nil || r.GetIsTeam() || r.GetLabel() != "Design" {
				t.Fatalf("Workspace role: %v", r)
			}
			// 07 §4.7.4: native workspace slug kailo-ws-<id>, ADMIN scope, rooted on
			// <binding datasource>/<Tenant root>/<id>, the same-named role holding
			// read and write ACLs on that root; Workspace ADMIN gets WRITE.
			slug := "kailo-ws-" + dirWsDesign
			ws := nativeWorkspace(t, ctx, dirWsDesign)
			if ws == nil || ws.GetSlug() != slug || ws.GetLabel() != "Design" || ws.GetScope() != idm.WorkspaceScope_ADMIN {
				t.Fatalf("native workspace: %v", ws)
			}
			folder := folderOf(dirWsDesign)
			want := []string{"root:" + folder + ":" + dirRoot + "/" + dirWsDesign, slug + ":read:" + folder, slug + ":write:" + folder,
				"kailo-wsr-" + dirWsDesign + ":read:" + folder}
			slices.Sort(want)
			if got := workspaceACLs(t, ctx, ws); !slices.Equal(got, want) {
				t.Fatalf("workspace ACLs: %v, want %v", got, want)
			}
			if !wsHasPolicy(ws, service.ResourcePolicyAction_WRITE, permissions.PolicySubjectUuidPrefix+derived("dir-bob")) ||
				wsHasPolicy(ws, service.ResourcePolicyAction_WRITE, permissions.PolicySubjectUuidPrefix+derived("dir-admin")) ||
				!wsHasPolicy(ws, service.ResourcePolicyAction_READ, permissions.PolicySubjectRolePrefix+slug) ||
				!wsHasPolicy(ws, service.ResourcePolicyAction_READ, permissions.PolicySubjectRolePrefix+"kailo-wsr-"+dirWsDesign) {
				t.Fatalf("workspace policies: %v", ws.GetPolicies())
			}
			ops := nativeWorkspace(t, ctx, dirWsOps)
			if ops == nil || slices.ContainsFunc(ops.GetPolicies(), func(p *service.ResourcePolicy) bool {
				return p.GetAction() == service.ResourcePolicyAction_WRITE && strings.HasPrefix(p.GetSubject(), permissions.PolicySubjectUuidPrefix)
			}) {
				t.Fatalf("Workspace without ADMIN members has account WRITE policies: %v", ops)
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
				"core-503":    func() { core.set(http.StatusServiceUnavailable, changed) },
				"core-403":    func() { core.set(http.StatusForbidden, changed) },
				"token-401":   func() { core.set(http.StatusOK, changed); core.tokenStatus = http.StatusUnauthorized },
				"bad-json":    func() { core.set(http.StatusOK, []byte(`{"bindingId":`)) },
				"unknown-key": func() { c := dirSnapshot("2", dirTenant, nil, pre); c["extra"] = 1; core.set(http.StatusOK, c) },
				"bad-role": func() {
					c := dirSnapshot("2", dirTenant, nil, dirMember{principal: pre.principal, name: "x", role: "OWNER"})
					core.set(http.StatusOK, c)
				},
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
			if !slices.Contains(revoked, b.GetLogin()) || slices.Contains(revoked, "admin.person") {
				t.Fatalf("access tokens revoked for %v", revoked)
			}
			if !hasRole(userByUUID(t, ctx, derived("dir-pre")), auth.NativeOIDCWorkspaceRoleID(dirWsOps)) {
				t.Fatal("Workspace team not attached")
			}
			// The Design Workspace left the snapshot: grants revoked, out of the
			// members' view, workspace and root (files) kept.
			gone := nativeWorkspace(t, ctx, dirWsDesign)
			folder := folderOf(dirWsDesign)
			if gone == nil || workspaceRole(t, ctx, dirWsDesign) == nil {
				t.Fatal("vanished Workspace deleted")
			}
			if got := workspaceACLs(t, ctx, gone); !slices.Equal(got, []string{"root:" + folder + ":" + dirRoot + "/" + dirWsDesign}) {
				t.Fatalf("vanished Workspace grants: %v", got)
			}
			if wsHasPolicy(gone, service.ResourcePolicyAction_READ, permissions.PolicySubjectRolePrefix+"kailo-ws-"+dirWsDesign) ||
				wsHasPolicy(gone, service.ResourcePolicyAction_WRITE, permissions.PolicySubjectUuidPrefix+derived("dir-bob")) {
				t.Fatalf("vanished Workspace still in the members' view: %v", gone.GetPolicies())
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
			back := nativeWorkspace(t, ctx, dirWsDesign)
			if len(workspaceACLs(t, ctx, back)) != 4 || !wsHasPolicy(back, service.ResourcePolicyAction_WRITE, permissions.PolicySubjectUuidPrefix+derived("dir-bob")) {
				t.Fatalf("Workspace back in the snapshot not restored: %v", back.GetPolicies())
			}
		})

		// DD-164(3): without Workspace `create` a member holds the read-only
		// role; with it, the read and write role.
		t.Run("schema2-read-only-member", func(t *testing.T) {
			viewer := bob
			viewer.workspaces = map[string]string{dirWsDesign: "MEMBER", dirWsOps: "MEMBER"}
			viewer.readOnly = map[string]bool{dirWsOps: true}
			core.set(http.StatusOK, dirSnapshot("6", dirTenant, both, admin, viewer, pre))
			if applied, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err != nil || !applied {
				t.Fatalf("read-only snapshot: %v", err)
			}
			b := userByUUID(t, ctx, derived("dir-bob"))
			if !hasRole(b, auth.NativeOIDCWorkspaceRoleID(dirWsDesign)) || hasRole(b, auth.NativeOIDCWorkspaceReaderRoleID(dirWsDesign)) ||
				!hasRole(b, auth.NativeOIDCWorkspaceReaderRoleID(dirWsOps)) || hasRole(b, auth.NativeOIDCWorkspaceRoleID(dirWsOps)) {
				t.Fatalf("roles by Workspace create: %v", b.GetRoles())
			}
			u, err := login("dir-bob", map[string]any{"preferred_username": "bob", "name": "IdP Name"})
			if err != nil || !hasRole(u, auth.NativeOIDCWorkspaceReaderRoleID(dirWsOps)) || hasRole(u, auth.NativeOIDCWorkspaceRoleID(dirWsOps)) ||
				u.GetAttributes()[idm.UserAttrDisplayName] != "Bob Member" {
				t.Fatalf("login did not keep the read-only role and Kailo name: %v %v", err, u.GetRoles())
			}
		})

		// DD-164(4): shares[] → Kailo-managed shared workspaces; missing
		// folders are reported and the rest converges; unshared ones are removed.
		t.Run("schema2-shares", func(t *testing.T) {
			const resA, resB = "d0000000-0000-4000-8000-0000000000a1", "d0000000-0000-4000-8000-0000000000b2"
			nodeA, nodeB := "e0000000-0000-4000-8000-0000000000a1", "e0000000-0000-4000-8000-0000000000b2"
			shareNodesMu.Lock()
			shareNodes[nodeA] = "Quarterly"
			shareNodesMu.Unlock()
			snap := dirSnapshot("7", dirTenant, both, admin, bob, pre)
			snap["shares"] = []any{
				dirShare(resA, nodeA, admin.principal, dirGrant("PRINCIPAL", admin.principal, "WRITE"), dirGrant("PRINCIPAL", pre.principal, "READ"),
					dirGrant("WORKSPACE", dirWsOps, "WRITE"), dirGrant("TENANT", "", "READ")),
				dirShare(resB, nodeB, admin.principal, dirGrant("PRINCIPAL", admin.principal, "WRITE")),
			}
			core.receipts = nil
			core.set(http.StatusOK, snap)
			if applied, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err != nil || !applied {
				t.Fatalf("shares snapshot: %v", err)
			}
			ws := shareWorkspace(t, ctx, resA)
			if ws == nil || ws.GetScope() != idm.WorkspaceScope_ROOM || ws.GetLabel() != "Quarterly" {
				t.Fatalf("shared workspace: %v", ws)
			}
			group := tenantGroup(t, ctx, dirTenant).GetUuid()
			want := []string{"root:" + nodeA + ":uuid:" + nodeA,
				derived("dir-admin") + ":read:" + nodeA, derived("dir-admin") + ":write:" + nodeA,
				derived("dir-pre") + ":read:" + nodeA,
				"kailo-ws-" + dirWsOps + ":read:" + nodeA, "kailo-ws-" + dirWsOps + ":write:" + nodeA,
				"kailo-wsr-" + dirWsOps + ":read:" + nodeA, "kailo-wsr-" + dirWsOps + ":write:" + nodeA,
				group + ":read:" + nodeA}
			slices.Sort(want)
			if got := workspaceACLs(t, ctx, ws); !slices.Equal(got, want) {
				t.Fatalf("shared workspace ACLs:\n got %v\nwant %v", got, want)
			}
			if !wsHasPolicy(ws, service.ResourcePolicyAction_READ, permissions.PolicySubjectRolePrefix+derived("dir-pre")) ||
				wsHasPolicy(ws, service.ResourcePolicyAction_WRITE, permissions.PolicySubjectUuidPrefix+derived("dir-admin")) {
				t.Fatalf("shared workspace policies: %v", ws.GetPolicies())
			}
			if shareWorkspace(t, ctx, resB) != nil {
				t.Fatal("shared workspace created for a missing folder")
			}
			if len(core.receipts) != 1 || core.receipts[0]["outcome"] != "APPLIED" {
				t.Fatalf("receipt: %v", core.receipts)
			}
			failures := core.receipts[0]["failures"].([]any)
			if len(failures) != 1 || failures[0].(map[string]any)["ref"] != resB || failures[0].(map[string]any)["reasonCode"] != "NATIVE_OBJECT_MISSING" {
				t.Fatalf("missing folder not reported: %v", failures)
			}
			// A failure keeps the version open: the next period applies again.
			shareNodesMu.Lock()
			shareNodes[nodeB] = "Restored"
			shareNodesMu.Unlock()
			if applied, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err != nil || !applied || shareWorkspace(t, ctx, resB) == nil {
				t.Fatalf("restored folder not converged on the same version: %v %v", applied, err)
			}
			// Revoke pre and the TENANT grant, then unshare B entirely.
			snap = dirSnapshot("8", dirTenant, both, admin, bob, pre)
			snap["shares"] = []any{dirShare(resA, nodeA, admin.principal, dirGrant("PRINCIPAL", admin.principal, "WRITE"), dirGrant("WORKSPACE", dirWsOps, "READ"))}
			core.set(http.StatusOK, snap)
			if applied, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err != nil || !applied {
				t.Fatalf("revoking snapshot: %v", err)
			}
			want = []string{"root:" + nodeA + ":uuid:" + nodeA,
				derived("dir-admin") + ":read:" + nodeA, derived("dir-admin") + ":write:" + nodeA,
				"kailo-ws-" + dirWsOps + ":read:" + nodeA, "kailo-wsr-" + dirWsOps + ":read:" + nodeA}
			slices.Sort(want)
			if got := workspaceACLs(t, ctx, shareWorkspace(t, ctx, resA)); !slices.Equal(got, want) {
				t.Fatalf("after revocation:\n got %v\nwant %v", got, want)
			}
			if shareWorkspace(t, ctx, resB) != nil {
				t.Fatal("unshared folder still has its shared workspace")
			}
		})

		t.Run("failed-apply-and-receipt-retry", func(t *testing.T) {
			core.receipts = nil
			core.receiptStatus = http.StatusServiceUnavailable
			core.set(http.StatusOK, dirSnapshot("9", "6f0c2a1e-8b9d-4e4f-a1b2-c3d4e5f60799", both, admin))
			if _, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err == nil {
				t.Fatal("other Tenant applied")
			}
			if len(core.receipts) != 0 {
				t.Fatal("receipt recorded while Core refused it")
			}
			core.receiptStatus = 0
			if _, err := auth.SyncNativeOIDCDirectory(ctx, cfg); err == nil {
				t.Fatal("other Tenant applied")
			}
			if len(core.receipts) != 1 || core.receipts[0]["outcome"] != "FAILED" {
				t.Fatalf("failed apply receipt: %v", core.receipts)
			}
			item := core.receipts[0]["failures"].([]any)[0].(map[string]any)
			if item["kind"] != "TENANT" || item["reasonCode"] != "TENANT_MISMATCH" {
				t.Fatalf("failed receipt item: %v", item)
			}
		})

		t.Run("share-intent", func(t *testing.T) {
			previous := auth.NativeOIDCShareIntentDirectory
			auth.NativeOIDCShareIntentDirectory = func() (*auth.NativeOIDCDirectoryConfig, error) { return cfg, nil }
			defer func() { auth.NativeOIDCShareIntentDirectory = previous }()
			created, err := auth.CreateNativeOIDCShareIntent(ctx, auth.NativeOIDCShareIntent{NodeUUID: "E0000000-0000-4000-8000-0000000000A1",
				Name: " Quarterly ", Issuer: provisionIssuer, Subject: "dir-admin", WorkspaceID: dirWsOps})
			if err != nil || created.IntentID != "9e0c2a1e-8b9d-4e4f-a1b2-c3d4e5f60718" {
				t.Fatalf("share intent: %v", err)
			}
			got := core.intents[len(core.intents)-1]
			if got["nativeType"] != "folder" || got["nativeId"] != "e0000000-0000-4000-8000-0000000000a1" || got["name"] != "Quarterly" ||
				got["workspaceId"] != dirWsOps || got["initiator"].(map[string]any)["subject"] != "dir-admin" {
				t.Fatalf("share intent request: %v", got)
			}
			if _, err := auth.CreateNativeOIDCShareIntent(ctx, auth.NativeOIDCShareIntent{NodeUUID: "not-a-uuid", Name: "x", Issuer: provisionIssuer, Subject: "s"}); err == nil {
				t.Fatal("invalid node accepted")
			}
			auth.NativeOIDCShareIntentDirectory = func() (*auth.NativeOIDCDirectoryConfig, error) { return nil, nil }
			if _, err := auth.CreateNativeOIDCShareIntent(ctx, auth.NativeOIDCShareIntent{NodeUUID: "e0000000-0000-4000-8000-0000000000a1", Name: "x",
				Issuer: provisionIssuer, Subject: "s"}); !errors.Is(err, auth.ErrNativeOIDCShareUnavailable) {
				t.Fatalf("share without a directory delivery: %v", err)
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
		"KAILO_DIRECTORY_CORE_URL":           "http://core-bff:8081",
		"KAILO_DIRECTORY_WORKSPACE_ROOT":     "kailobinding/kailo-binding"}
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
		"KAILO_DIRECTORY_TOKEN_URL": "ftp://idp", "KAILO_DIRECTORY_CLIENT_SECRET_FILE": "relative",
		"KAILO_DIRECTORY_WORKSPACE_ROOT": "kailobinding/../x"} {
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
	if len(s.Members[0].WorkspaceAdmins) != 0 {
		t.Fatalf("Workspace MEMBER parsed as ADMIN: %v", s.Members[0].WorkspaceAdmins)
	}
	if !slices.Equal(s.Members[0].WorkspaceWriters, []string{dirWsOps}) || !s.Members[0].TenantCreate || len(s.Shares) != 0 {
		t.Fatalf("schema 2 create flags: %+v", s.Members[0])
	}
	withShare := dirSnapshot("a", dirTenant, map[string]string{dirWsOps: "Ops"}, member)
	withShare["shares"] = []any{dirShare("D0000000-0000-4000-8000-0000000000A1", "n1", member.principal,
		dirGrant("PRINCIPAL", member.principal, "WRITE"), dirGrant("WORKSPACE", dirWsOps, "READ"), dirGrant("TENANT", "", "READ"))}
	raw, _ = json.Marshal(withShare)
	if s, err = auth.ParseNativeOIDCDirectory(raw); err != nil || len(s.Shares) != 1 || s.Shares[0].ResourceID != "d0000000-0000-4000-8000-0000000000a1" ||
		len(s.Shares[0].Grants) != 3 || !s.Shares[0].Grants[0].Write || s.Shares[0].Grants[1].WorkspaceID != dirWsOps {
		t.Fatalf("shares: %v %+v", err, s)
	}
	member.workspaces = map[string]string{dirWsOps: "ADMIN"}
	raw, _ = json.Marshal(dirSnapshot("a", dirTenant, map[string]string{dirWsOps: "Ops"}, member))
	if s, err = auth.ParseNativeOIDCDirectory(raw); err != nil || !slices.Equal(s.Members[0].WorkspaceAdmins, []string{dirWsOps}) {
		t.Fatalf("Workspace ADMIN: %v", err)
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
		// DD-164(2): schema 2 only.
		"schema-1":         func(m map[string]any) { delete(m, "schema"); delete(m, "shares") },
		"schema-3":         func(m map[string]any) { m["schema"] = 3 },
		"no-tenant-create": func(m map[string]any) { delete(m["members"].([]map[string]any)[0], "tenantCreate") },
		"no-ws-create": func(m map[string]any) {
			delete(m["members"].([]map[string]any)[0]["workspaces"].([]map[string]any)[0], "create")
		},
		"tenant-write": func(m map[string]any) {
			m["shares"] = []any{dirShare("d0000000-0000-4000-8000-0000000000a1", "n1", member.principal, dirGrant("TENANT", "", "WRITE"))}
		},
		"unknown-grantee": func(m map[string]any) {
			m["shares"] = []any{dirShare("d0000000-0000-4000-8000-0000000000a1", "n1", member.principal,
				dirGrant("PRINCIPAL", "b0000000-0000-4000-8000-000000000009", "READ"))}
		},
		"unknown-workspace-grant": func(m map[string]any) {
			m["shares"] = []any{dirShare("d0000000-0000-4000-8000-0000000000a1", "n1", member.principal, dirGrant("WORKSPACE", dirWsDesign, "READ"))}
		},
		"duplicate-subject": func(m map[string]any) {
			m["shares"] = []any{dirShare("d0000000-0000-4000-8000-0000000000a1", "n1", member.principal,
				dirGrant("TENANT", "", "READ"), dirGrant("TENANT", "", "READ"))}
		},
		"bad-native-type": func(m map[string]any) {
			sh := dirShare("d0000000-0000-4000-8000-0000000000a1", "n1", member.principal)
			sh["nativeType"] = "file"
			m["shares"] = []any{sh}
		},
		"duplicate-resource": func(m map[string]any) {
			sh := dirShare("d0000000-0000-4000-8000-0000000000a1", "n1", member.principal)
			m["shares"] = []any{sh, sh}
		},
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

func shareWorkspace(t *testing.T, ctx context.Context, resourceID string) *idm.Workspace {
	t.Helper()
	q, _ := anypb.New(&idm.WorkspaceSingleQuery{Slug: auth.NativeOIDCShareSlug(resourceID)})
	stream, err := idmc.WorkspaceServiceClient(ctx).SearchWorkspace(ctx, &idm.SearchWorkspaceRequest{Query: &service.Query{SubQueries: []*anypb.Any{q}}})
	if err != nil {
		t.Fatal(err)
	}
	var found *idm.Workspace
	for {
		r, err := stream.Recv()
		if errors.Is(err, io.EOF) {
			return found
		}
		if err != nil {
			t.Fatal(err)
		}
		found = r.GetWorkspace()
	}
}
