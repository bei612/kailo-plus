package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"gorm.io/gorm"
)

const (
	dirTenant  = "6179e160-0000-4000-8000-000000000001"
	dirBinding = "0b3c1f9e-0000-4000-8000-0000000000aa"
	dirWsA     = "aaaaaaaa-0000-4000-8000-00000000000a"
	dirWsB     = "bbbbbbbb-0000-4000-8000-00000000000b"
	dirAda     = "11111111-0000-4000-8000-000000000001"
	dirBob     = "22222222-0000-4000-8000-000000000002"
	dirCarol   = "33333333-0000-4000-8000-000000000003"
	dirClient  = "kailo-knowledge-directory"
	dirSecret  = "fixture-directory-secret"
)

// fakeCore stands in for the IdP token endpoint and Core's directory read.
type fakeCore struct {
	mu       sync.Mutex
	status   int
	body     []byte
	reads    int
	receipts []map[string]interface{}
	intents  []map[string]interface{}
	server   *httptest.Server
}

func newFakeCore(t *testing.T) *fakeCore {
	t.Helper()
	c := &fakeCore{status: http.StatusOK}
	c.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			id, secret, ok := r.BasicAuth()
			if r.Method != http.MethodPost || !ok || id != dirClient || secret != dirSecret ||
				r.FormValue("grant_type") != "client_credentials" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "directory-token", "token_type": "Bearer"})
		case "/service/v1/component-directory/bindings/" + dirBinding + "/members":
			c.mu.Lock()
			defer c.mu.Unlock()
			c.reads++
			if r.Header.Get("Authorization") != "Bearer directory-token" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			if r.URL.Query().Get("schema") != "2" {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(c.status)
			_, _ = w.Write(c.body)
		case "/service/v1/component-directory/bindings/" + dirBinding + "/receipt",
			"/service/v1/component-directory/bindings/" + dirBinding + "/share-intents":
			c.mu.Lock()
			defer c.mu.Unlock()
			if r.Header.Get("Authorization") != "Bearer directory-token" {
				w.WriteHeader(http.StatusForbidden)
				return
			}
			var body map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			if strings.HasSuffix(r.URL.Path, "/receipt") {
				if r.Method != http.MethodPut {
					w.WriteHeader(http.StatusMethodNotAllowed)
					return
				}
				c.receipts = append(c.receipts, body)
				w.WriteHeader(http.StatusNoContent)
				return
			}
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				return
			}
			c.intents = append(c.intents, body)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{
				"intentId": "9e1f0000-0000-4000-8000-0000000000c1", "expiresAt": "2026-10-30T10:00:00Z"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(c.server.Close)
	return c
}

func (c *fakeCore) lastReceipt() map[string]interface{} {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.receipts) == 0 {
		return nil
	}
	return c.receipts[len(c.receipts)-1]
}

func (c *fakeCore) answer(status int, body []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.status, c.body = status, body
}

type dirMember struct {
	principal, sub, name, role string
	ws                         map[string]string
	issuer                     string
	// create: Kailo Tenant create; wsCreate: Workspace create (ADMIN implies it).
	create   bool
	wsCreate map[string]bool
}

func directoryJSON(t *testing.T, version string, binding, tenant string, wsNames map[string]string, members ...dirMember) []byte {
	return directoryJSONWithShares(t, version, binding, tenant, wsNames, []map[string]interface{}{}, members...)
}

func directoryJSONWithShares(t *testing.T, version string, binding, tenant string, wsNames map[string]string,
	shares []map[string]interface{}, members ...dirMember) []byte {
	t.Helper()
	workspaces := []map[string]string{}
	for _, id := range []string{dirWsA, dirWsB} {
		if name, ok := wsNames[id]; ok {
			workspaces = append(workspaces, map[string]string{"workspaceId": id, "name": name})
		}
	}
	list := []map[string]interface{}{}
	for _, m := range members {
		issuer := m.issuer
		if issuer == "" {
			issuer = kailoTestIssuer
		}
		memberships := []map[string]interface{}{}
		for _, id := range []string{dirWsA, dirWsB} {
			if role, ok := m.ws[id]; ok {
				memberships = append(memberships, map[string]interface{}{"workspaceId": id, "role": role,
					"create": role == "ADMIN" || m.role == "ADMIN" || m.wsCreate[id]})
			}
		}
		list = append(list, map[string]interface{}{
			"principalId": m.principal, "displayName": m.name, "tenantRole": m.role,
			"tenantCreate": m.create || m.role == "ADMIN",
			"identities": []map[string]string{{"issuer": issuer, "subject": m.sub,
				"picture": "https://kailo.example/api/v1/identity/avatars/" + m.sub}},
			"workspaces": memberships,
		})
	}
	digest := sha256.Sum256([]byte(version))
	raw, err := json.Marshal(map[string]interface{}{
		"schema": 2, "shares": shares,
		"bindingId": binding, "directoryVersion": hex.EncodeToString(digest[:]),
		"tenant": map[string]string{"tenantId": tenant, "name": "Acme Corp"}, "workspaces": workspaces, "members": list,
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func firstSnapshot(t *testing.T) []byte {
	return directoryJSON(t, "v1", dirBinding, dirTenant, map[string]string{dirWsA: "Alpha", dirWsB: "Beta"},
		dirMember{principal: dirAda, sub: "ada", name: "Ada Lovelace", role: "ADMIN", ws: map[string]string{dirWsA: "MEMBER"}},
		dirMember{principal: dirBob, sub: "bob", name: "Bob", role: "MEMBER", ws: map[string]string{dirWsA: "ADMIN"}},
		dirMember{principal: dirCarol, sub: "carol", name: "Carol", role: "MEMBER", issuer: "https://other-idp.example"})
}

// newDirectoryFixture is the Kailo fixture with the member directory
// configured against a fake Core; the deployment Tenant is the directory's.
func newDirectoryFixture(t *testing.T) (*kailoFixture, *fakeCore, *KailoDirectorySyncRunner) {
	t.Helper()
	f := newKailoFixture(t)
	core := newFakeCore(t)
	secret := filepath.Join(t.TempDir(), "client_secret")
	if err := os.WriteFile(secret, []byte(dirSecret+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	f.svc.config.Kailo.TenantID = dirTenant
	f.svc.config.Kailo.Directory = &config.KailoDirectoryConfig{
		BindingID: dirBinding, ClientID: dirClient, ClientSecretFile: secret,
		TokenURL: core.server.URL + "/token", CoreURL: core.server.URL,
	}
	return f, core, NewKailoDirectorySyncRunner(f.svc.config, f.svc.kailoOrg)
}

func (f *kailoFixture) userBySubject(t *testing.T, sub string) *types.User {
	t.Helper()
	var user types.User
	if err := f.db.Where("oidc_issuer = ? AND oidc_subject = ?", kailoTestIssuer, sub).First(&user).Error; err != nil {
		return nil
	}
	return &user
}

func (f *kailoFixture) recordedVersion(t *testing.T) string {
	t.Helper()
	var row kailoMemberDirectoryRow
	if err := f.db.Where("id = 1").First(&row).Error; err != nil {
		return ""
	}
	return row.DirectoryVersion
}

func TestKailoDirectoryPreProvisionsMembersRolesAndWorkspaces(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("first snapshot was not applied")
	}
	ada, bob := f.userBySubject(t, "ada"), f.userBySubject(t, "bob")
	if ada == nil || bob == nil {
		t.Fatal("directory members were not pre-provisioned")
	}
	if n := f.count(t, &types.User{}); n != 2 {
		t.Fatalf("accounts = %d: an identity of another issuer must not be provisioned", n)
	}
	if ada.Username != "Ada Lovelace" || ada.Avatar != "https://kailo.example/api/v1/identity/avatars/ada" ||
		ada.TenantID == 0 || ada.Preferences.OidcOnlyLogin == nil || !*ada.Preferences.OidcOnlyLogin {
		t.Fatalf("pre-provisioned account = %+v", ada)
	}
	tenant := f.space(t, "tenant:"+dirTenant)
	wsA, wsB := f.space(t, "workspace:"+dirWsA), f.space(t, "workspace:"+dirWsB)
	if tenant.Name != "Acme Corp" || wsA.Name != "Alpha" || wsB.Name != "Beta" {
		t.Fatalf("space names = %q %q %q", tenant.Name, wsA.Name, wsB.Name)
	}
	// Tenant ADMIN → admin of the Tenant space and of every Workspace space.
	for _, space := range []*types.Tenant{tenant, wsA, wsB} {
		if got := f.role(t, ada.ID, space.ID); got != types.TenantRoleAdmin {
			t.Fatalf("admin role in %s = %q", space.Name, got)
		}
	}
	// DD-164(3): a member without Tenant create only reads the Tenant space;
	// a Workspace ADMIN administers that Workspace's space.
	if f.role(t, bob.ID, tenant.ID) != types.TenantRoleViewer || f.role(t, bob.ID, wsA.ID) != types.TenantRoleAdmin ||
		f.role(t, bob.ID, wsB.ID) != "" {
		t.Fatal("member roles do not follow the directory")
	}
	var owners int64
	f.db.Model(&types.TenantMember{}).Where("role = ? AND deleted_at IS NULL", types.TenantRoleOwner).Count(&owners)
	var admins int64
	f.db.Model(&types.User{}).Where("is_system_admin = ?", true).Count(&admins)
	if owners != 0 || admins != 0 {
		t.Fatal("the directory never grants ownership or system administration")
	}
	var org types.Organization
	if err := f.db.Select("id").Where("kailo_tenant_ref = ?", dirTenant).First(&org).Error; err != nil {
		t.Fatal(err)
	}
	var linked []types.OrganizationTenantMember
	f.db.Where("organization_id = ?", org.ID).Find(&linked)
	if len(linked) != 3 {
		t.Fatalf("organisation spaces = %d, want Tenant + two Workspaces", len(linked))
	}
	if f.recordedVersion(t) == "" {
		t.Fatal("the applied snapshot was not recorded")
	}
	// The same version again changes nothing.
	if runner.SyncOnce(context.Background()) {
		t.Fatal("an unchanged directoryVersion must not be applied again")
	}
}

// A pre-provisioned account is inserted like repository.CreateUser inserts a
// first OIDC login: without tenant_id. PostgreSQL's fk_users_tenant refuses
// the uint64 zero (production 2026-10-23: every snapshot failed with SQLSTATE
// 23503); the fixture's SQLite does not enforce it, so the insert is checked.
func TestKailoDirectoryPreProvisionInsertsNoZeroTenant(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	var inserts []string
	if err := f.db.Callback().Create().After("gorm:create").Register("kailo_test:user_inserts", func(tx *gorm.DB) {
		if tx.Statement.Table == "users" {
			inserts = append(inserts, tx.Statement.SQL.String())
		}
	}); err != nil {
		t.Fatal(err)
	}
	core.answer(http.StatusOK, firstSnapshot(t))
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("first snapshot was not applied")
	}
	if len(inserts) != 2 {
		t.Fatalf("user inserts = %d, want the two directory members of this issuer", len(inserts))
	}
	for _, statement := range inserts {
		if strings.Contains(statement, "tenant_id") {
			t.Fatalf("pre-provisioning writes tenant_id: %s", statement)
		}
	}
	if ada := f.userBySubject(t, "ada"); ada == nil || ada.TenantID == 0 {
		t.Fatal("the applied snapshot must still give the account its home space")
	}
}

func TestKailoDirectoryFailuresKeepTheAppliedState(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	runner.SyncOnce(context.Background())
	before := f.recordedVersion(t)
	ada := f.userBySubject(t, "ada")
	tenant := f.space(t, "tenant:"+dirTenant)

	empty := directoryJSON(t, "v2", dirBinding, dirTenant, map[string]string{})
	cases := map[string]func(){
		"503":           func() { core.answer(http.StatusServiceUnavailable, []byte(`{"error":"unavailable"}`)) },
		"401":           func() { core.answer(http.StatusUnauthorized, nil) },
		"bad json":      func() { core.answer(http.StatusOK, []byte(`{"bindingId":`)) },
		"unknown field": func() { core.answer(http.StatusOK, append(empty[:len(empty)-1], []byte(`,"extra":1}`)...)) },
		"other binding": func() { core.answer(http.StatusOK, directoryJSON(t, "v2", dirTenant, dirTenant, map[string]string{})) },
		"other tenant": func() {
			core.answer(http.StatusOK, directoryJSON(t, "v2", dirBinding, dirBinding, map[string]string{}))
		},
		"missing member": func() { core.answer(http.StatusOK, []byte(`{"bindingId":"`+dirBinding+`"}`)) },
	}
	for name, setup := range cases {
		setup()
		if runner.SyncOnce(context.Background()) {
			t.Fatalf("%s: applied", name)
		}
		if f.recordedVersion(t) != before || f.role(t, ada.ID, tenant.ID) != types.TenantRoleAdmin {
			t.Fatalf("%s changed the applied directory", name)
		}
	}
	// A wrong client credential never reaches Core.
	if err := os.WriteFile(f.svc.config.Kailo.Directory.ClientSecretFile, []byte("wrong"), 0o600); err != nil {
		t.Fatal(err)
	}
	core.answer(http.StatusOK, empty)
	reads := core.reads
	if runner.SyncOnce(context.Background()) || core.reads != reads || f.recordedVersion(t) != before {
		t.Fatal("a refused token must change nothing")
	}
}

func TestKailoDirectoryRemovesDemotesAndRenames(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	core.answer(http.StatusOK, firstSnapshot(t))
	runner.SyncOnce(context.Background())
	f.claims = kailoClaims("bob", "bob@example.com", "Bob", "sid-bob")
	bobLogin := f.login(t)
	if !f.valid(t, bobLogin.Token) {
		t.Fatal("bob's session must be valid before removal")
	}
	ada := f.userBySubject(t, "ada")

	core.answer(http.StatusOK, directoryJSON(t, "v2", dirBinding, dirTenant, map[string]string{dirWsA: "Alpha 2", dirWsB: "Beta"},
		dirMember{principal: dirAda, sub: "ada", name: "Ada Lovelace", role: "MEMBER", ws: map[string]string{dirWsA: "MEMBER"}}))
	if !runner.SyncOnce(context.Background()) {
		t.Fatal("changed snapshot not applied")
	}
	tenant := f.space(t, "tenant:"+dirTenant)
	wsA, wsB := f.space(t, "workspace:"+dirWsA), f.space(t, "workspace:"+dirWsB)
	if wsA.Name != "Alpha 2" {
		t.Fatalf("workspace space name = %q", wsA.Name)
	}
	if f.role(t, ada.ID, tenant.ID) != types.TenantRoleViewer || f.role(t, ada.ID, wsA.ID) != types.TenantRoleViewer ||
		f.role(t, ada.ID, wsB.ID) != "" {
		t.Fatal("a demoted administrator without create keeps only the read-only member projection")
	}
	bob := f.userBySubject(t, "bob")
	for _, space := range []*types.Tenant{tenant, wsA, wsB} {
		if got := f.role(t, bob.ID, space.ID); got != "" {
			t.Fatalf("removed member keeps role %q in %s", got, space.Name)
		}
	}
	if f.valid(t, bobLogin.Token) {
		t.Fatal("a removed member's sessions must be revoked")
	}
	var deleted int64
	f.db.Unscoped().Model(&types.User{}).Where("id = ? AND deleted_at IS NOT NULL", bob.ID).Count(&deleted)
	if deleted != 0 || f.userBySubject(t, "bob") == nil {
		t.Fatal("the account of a removed member is kept")
	}
}

func TestKailoLoginFollowsTheAppliedDirectory(t *testing.T) {
	f, core, runner := newDirectoryFixture(t)
	// Configured but nothing applied yet: the pre-directory behaviour.
	f.claims = kailoClaims("dave", "dave@example.com", "Dave", "sid-dave")
	dave := f.login(t).User
	tenant := f.space(t, "tenant:"+dirTenant)
	if f.role(t, dave.ID, tenant.ID) != types.TenantRoleContributor {
		t.Fatal("before delivery every login is a contributor")
	}

	core.answer(http.StatusOK, firstSnapshot(t))
	runner.SyncOnce(context.Background())
	if f.role(t, dave.ID, tenant.ID) != "" {
		t.Fatal("a person outside the first snapshot is removed")
	}

	// The administrator keeps the directory role across logins.
	f.claims = kailoClaims("ada", "ada@example.com", "Ada Lovelace", "sid-ada")
	ada := f.login(t).User
	if ada.ID != f.userBySubject(t, "ada").ID || f.role(t, ada.ID, tenant.ID) != types.TenantRoleAdmin {
		t.Fatal("login must reuse the pre-provisioned account and keep the directory role")
	}
	if ada.Email != "ada@example.com" {
		t.Fatalf("verified OIDC email must replace the placeholder, got %q", ada.Email)
	}

	// Outside the directory: refused, and no account is created.
	users := f.count(t, &types.User{})
	f.claims = kailoClaims("eve", "eve@example.com", "Eve", "sid-eve")
	resp, err := f.svc.LoginWithOIDC(context.Background(), "fixture-code",
		"https://knowledge.example/api/v1/auth/oidc/callback", types.TenantProvisioningCreatePersonal)
	if err != nil || resp.Success || resp.Message != kailoNotMemberMessage {
		t.Fatalf("non-member login = %+v, %v", resp, err)
	}
	if f.count(t, &types.User{}) != users {
		t.Fatal("a refused login must not create an account")
	}

	// A restarted service (new projection over the same database) follows
	// the recorded snapshot before its first read.
	restarted := NewKailoOrgService(f.db, f.svc.tenantService, f.svc.tokenRepo, nil)
	snapshot, err := restarted.DirectorySnapshot(context.Background(), dirBinding)
	if err != nil || snapshot == nil || snapshot.MemberFor(kailoTestIssuer, "ada") == nil {
		t.Fatalf("recorded snapshot after restart = %v, %v", snapshot, err)
	}
	f.svc.kailoOrg = restarted
	f.claims = kailoClaims("ada", "ada@example.com", "Ada Lovelace", "sid-ada-2")
	if f.role(t, f.login(t).User.ID, tenant.ID) != types.TenantRoleAdmin {
		t.Fatal("after a restart the login keeps the directory role")
	}
	// A snapshot recorded for another binding is not this binding's directory.
	other, err := restarted.DirectorySnapshot(context.Background(), dirWsA)
	if err != nil || other != nil {
		t.Fatalf("snapshot for another binding = %v, %v", other, err)
	}
}

func TestKailoDirectoryDisabledRunnerDoesNothing(t *testing.T) {
	f := newKailoFixture(t)
	runner := NewKailoDirectorySyncRunner(f.svc.config, f.svc.kailoOrg)
	if runner.SyncOnce(context.Background()) {
		t.Fatal("an unconfigured directory must not sync")
	}
	runner.Start(context.Background())
	runner.Stop()
}

func TestParseKailoMemberDirectoryIsStrict(t *testing.T) {
	good := firstSnapshot(t)
	if _, err := types.ParseKailoMemberDirectory(good); err != nil {
		t.Fatalf("valid snapshot refused: %v", err)
	}
	mutate := func(change func(map[string]interface{})) []byte {
		var copy map[string]interface{}
		_ = json.Unmarshal(good, &copy)
		change(copy)
		raw, _ := json.Marshal(copy)
		return raw
	}
	bad := map[string][]byte{
		"version":   mutate(func(v map[string]interface{}) { v["directoryVersion"] = "abc" }),
		"no tenant": mutate(func(v map[string]interface{}) { delete(v, "tenant") }),
		"role": mutate(func(v map[string]interface{}) {
			v["members"].([]interface{})[0].(map[string]interface{})["tenantRole"] = "OWNER"
		}),
		"ws scope": mutate(func(v map[string]interface{}) {
			v["members"].([]interface{})[0].(map[string]interface{})["workspaces"] =
				[]map[string]string{{"workspaceId": "cccccccc-0000-4000-8000-00000000000c", "role": "MEMBER"}}
		}),
		"null members": mutate(func(v map[string]interface{}) { v["members"] = nil }),
		"trailing":     append(append([]byte{}, good...), []byte(` {}`)...),
	}
	for name, raw := range bad {
		if _, err := types.ParseKailoMemberDirectory(raw); err == nil {
			t.Fatalf("%s: accepted", name)
		}
	}
}
