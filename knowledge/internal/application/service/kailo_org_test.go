package service

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
)

const (
	kailoTestIssuer   = "https://kailo-idp.example/realms/kailo"
	kailoTestClientID = "kailo-knowledge-native"
)

// kailoFixture is a Kailo-mode native service against a real SQLite schema
// (identity and Kailo mapping columns installed by the actual migrations)
// and a local identity-provider fixture serving token, userinfo and JWKS.
type kailoFixture struct {
	svc    *userService
	db     *gorm.DB
	tokens *stubAuthTokenRepo
	claims map[string]interface{}
	key    *rsa.PrivateKey
}

func newKailoFixture(t *testing.T) *kailoFixture {
	t.Helper()
	withOIDCSSRFWhitelist(t, "127.0.0.1")
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &kailoFixture{tokens: &stubAuthTokenRepo{}, key: key}
	jwks := rsaJWK(key, "kailo-kid")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "fixture-token"})
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer fixture-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(w).Encode(f.claims)
		case "/jwks":
			_ = json.NewEncoder(w).Encode(oidcJWKS{Keys: []oidcJWK{jwks}})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(provider.Close)

	db, err := gorm.Open(sqlite.Open("file:"+strings.ReplaceAll(t.Name(), "/", "_")+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&types.Tenant{}, &types.User{}, &types.TenantMember{},
		&types.Organization{}, &types.OrganizationTenantMember{}); err != nil {
		t.Fatal(err)
	}
	// Install the identity and Kailo mapping columns, constraints and
	// immutability triggers through the actual migrations.
	if err := db.Exec("DROP INDEX idx_users_oidc_identity; ALTER TABLE users DROP COLUMN oidc_subject; ALTER TABLE users DROP COLUMN oidc_issuer; " +
		"DROP INDEX idx_tenants_kailo_scope_ref; ALTER TABLE tenants DROP COLUMN kailo_scope_ref; " +
		"DROP INDEX idx_organizations_kailo_tenant_ref; ALTER TABLE organizations DROP COLUMN kailo_tenant_ref").Error; err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"000024_oidc_identity.up.sql", "000028_kailo_org_mapping.up.sql"} {
		migration, err := os.ReadFile("../../../migrations/sqlite/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Exec(string(migration)).Error; err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	tenantSvc := NewTenantService(repository.NewTenantRepository(db), nil)
	f.db = db
	f.svc = &userService{
		userRepo:      repository.NewUserRepository(db),
		tokenRepo:     f.tokens,
		tenantService: tenantSvc,
		memberService: NewTenantMemberService(repository.NewTenantMemberRepository(db), nil, nil, nil),
		config: &config.Config{
			OIDCAuth: &config.OIDCAuthConfig{
				Enable: true, IssuerURL: kailoTestIssuer, ClientID: kailoTestClientID,
				AuthorizationEndpoint: provider.URL + "/authorize", TokenEndpoint: provider.URL + "/token",
				UserInfoEndpoint: provider.URL + "/userinfo", JwksURI: provider.URL + "/jwks",
			},
			Kailo: &config.KailoIntegrationConfig{Enable: true, OrgSync: config.KailoOrgSyncRequired, OrgClaim: "kailo_org"},
		},
		kailoOrg: NewKailoOrgService(db, tenantSvc, f.tokens, nil),
	}
	return f
}

func kailoClaims(sub, email, name string, org map[string]interface{}) map[string]interface{} {
	claims := map[string]interface{}{"sub": sub, "email": email, "name": name, "email_verified": true}
	if org != nil {
		claims["kailo_org"] = org
	}
	return claims
}

func kailoOrg(tenantRole string, workspaces ...map[string]interface{}) map[string]interface{} {
	ws := make([]interface{}, 0, len(workspaces))
	for _, w := range workspaces {
		ws = append(ws, w)
	}
	return map[string]interface{}{
		"v":          1,
		"tenant":     map[string]interface{}{"id": "6179e160-tenant", "name": "Acme", "role": tenantRole},
		"workspaces": ws,
	}
}

func kailoWorkspace(id, name, role string) map[string]interface{} {
	return map[string]interface{}{"id": id, "name": name, "role": role}
}

func (f *kailoFixture) login(t *testing.T) *types.OIDCCallbackResponse {
	t.Helper()
	resp, err := f.svc.LoginWithOIDC(context.Background(), "fixture-code",
		"https://knowledge.example/api/v1/auth/oidc/callback", types.TenantProvisioningCreatePersonal)
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if !resp.Success {
		t.Fatalf("login refused: %s", resp.Message)
	}
	return resp
}

func (f *kailoFixture) space(t *testing.T, ref string) *types.Tenant {
	t.Helper()
	var space types.Tenant
	if err := f.db.Where("kailo_scope_ref = ?", ref).First(&space).Error; err != nil {
		t.Fatalf("space %s: %v", ref, err)
	}
	return &space
}

func (f *kailoFixture) role(t *testing.T, userID string, tenantID uint64) types.TenantRole {
	t.Helper()
	var member types.TenantMember
	err := f.db.Where("user_id = ? AND tenant_id = ? AND deleted_at IS NULL", userID, tenantID).First(&member).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ""
	}
	if err != nil {
		t.Fatal(err)
	}
	return member.Role
}

func (f *kailoFixture) count(t *testing.T, model interface{}) int64 {
	t.Helper()
	var n int64
	if err := f.db.Model(model).Count(&n).Error; err != nil {
		t.Fatal(err)
	}
	return n
}

func TestKailoOrgLoginPutsTenantMembersIntoOneSpace(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada Lovelace",
		kailoOrg("admin", kailoWorkspace("ws-research", "Research", "member")))
	ada := f.login(t)

	tenantSpace := f.space(t, "tenant:6179e160-tenant")
	research := f.space(t, "workspace:ws-research")
	if tenantSpace.Name != "Acme" || research.Name != "Research" {
		t.Fatalf("space names = %q / %q", tenantSpace.Name, research.Name)
	}
	if ada.Tenant == nil || ada.Tenant.ID != tenantSpace.ID || ada.User.TenantID != tenantSpace.ID {
		t.Fatalf("the Tenant space must be the home space: response=%+v", ada.Tenant)
	}
	if got := f.role(t, ada.User.ID, tenantSpace.ID); got != types.TenantRoleAdmin {
		t.Fatalf("Tenant admin role in Tenant space = %q", got)
	}
	if got := f.role(t, ada.User.ID, research.ID); got != types.TenantRoleAdmin {
		t.Fatalf("a Tenant admin administers every Workspace space, got %q", got)
	}

	f.claims = kailoClaims("bob", "bob@example.com", "Bob", kailoOrg("member", kailoWorkspace("ws-research", "Research", "member")))
	bob := f.login(t)
	if bob.User.TenantID != tenantSpace.ID {
		t.Fatalf("second member landed in space %d, want the shared Tenant space %d", bob.User.TenantID, tenantSpace.ID)
	}
	if got := f.role(t, bob.User.ID, tenantSpace.ID); got != types.TenantRoleContributor {
		t.Fatalf("member role = %q, want contributor", got)
	}
	if got := f.role(t, bob.User.ID, research.ID); got != types.TenantRoleContributor {
		t.Fatalf("workspace member role = %q, want contributor", got)
	}
	if n := f.count(t, &types.Tenant{}); n != 2 {
		t.Fatalf("native spaces = %d, want only the Tenant and Workspace spaces (no personal spaces)", n)
	}

	var org types.Organization
	if err := f.db.Where("kailo_tenant_ref = ?", "6179e160-tenant").First(&org).Error; err != nil {
		t.Fatalf("Tenant organization: %v", err)
	}
	if org.OwnerTenantID != tenantSpace.ID || org.Name != "Acme" {
		t.Fatalf("organization = %+v", org)
	}
	var orgSpaces []types.OrganizationTenantMember
	if err := f.db.Where("organization_id = ?", org.ID).Find(&orgSpaces).Error; err != nil {
		t.Fatal(err)
	}
	roles := map[uint64]types.OrgMemberRole{}
	for _, m := range orgSpaces {
		roles[m.TenantID] = m.Role
	}
	if len(roles) != 2 || roles[tenantSpace.ID] != types.OrgRoleAdmin || roles[research.ID] != types.OrgRoleEditor {
		t.Fatalf("organization spaces = %+v", roles)
	}
}

func TestKailoOrgLoginRefreshesProfileEveryTime(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada Lovelace", kailoOrg("member"))
	f.claims["picture"] = "https://kailo.example/avatars/ada.png"
	f.claims["locale"] = "en_US"
	first := f.login(t)
	if first.User.Username != "Ada Lovelace" || first.User.Avatar != "https://kailo.example/avatars/ada.png" {
		t.Fatalf("profile not taken from Kailo: %+v", first.User)
	}
	if first.User.Preferences.Locale == nil || *first.User.Preferences.Locale != "en-US" {
		t.Fatalf("locale = %v", first.User.Preferences.Locale)
	}

	f.claims["name"] = "Ada King"
	f.claims["email"] = "ada.king@example.com"
	delete(f.claims, "picture")
	f.claims["locale"] = "zh-CN"
	second := f.login(t)
	var stored types.User
	if err := f.db.First(&stored, "id = ?", first.User.ID).Error; err != nil {
		t.Fatal(err)
	}
	if second.User.ID != first.User.ID || stored.Username != "Ada King" || stored.Email != "ada.king@example.com" ||
		stored.Avatar != "" || stored.Preferences.Locale == nil || *stored.Preferences.Locale != "zh-CN" {
		t.Fatalf("profile was not refreshed: %+v", stored)
	}

	// Another account already shows the same name: the preferred username
	// disambiguates instead of failing the login.
	f.claims = kailoClaims("ada-2", "other.ada@example.com", "Ada King", kailoOrg("member"))
	f.claims["preferred_username"] = "aking2"
	third := f.login(t)
	if third.User.Username != "Ada King (aking2)" {
		t.Fatalf("duplicate display name = %q", third.User.Username)
	}
}

func TestKailoOrgLoginFollowsKailoMembershipRemoval(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", kailoOrg("member", kailoWorkspace("ws-a", "A", "admin")))
	first := f.login(t)
	wsA := f.space(t, "workspace:ws-a")
	if got := f.role(t, first.User.ID, wsA.ID); got != types.TenantRoleAdmin {
		t.Fatalf("workspace admin role = %q", got)
	}

	f.claims["kailo_org"] = kailoOrg("member")
	f.login(t)
	if got := f.role(t, first.User.ID, wsA.ID); got != "" {
		t.Fatalf("membership removed in Kailo survived natively with role %q", got)
	}
	revoked := false
	for _, id := range f.tokens.revokedUserIDs {
		revoked = revoked || id == first.User.ID
	}
	if !revoked {
		t.Fatal("earlier sessions of a removed member must be revoked")
	}
}

func TestKailoOrgLoginWithoutClaimIsRefusedBeforeProvisioning(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", nil)
	_, err := f.svc.LoginWithOIDC(context.Background(), "fixture-code",
		"https://knowledge.example/api/v1/auth/oidc/callback", types.TenantProvisioningCreatePersonal)
	if !errors.Is(err, ErrKailoOrgClaim) {
		t.Fatalf("err = %v, want ErrKailoOrgClaim", err)
	}
	if n := f.count(t, &types.User{}); n != 0 {
		t.Fatalf("users = %d, want none", n)
	}
	if n := f.count(t, &types.Tenant{}); n != 0 {
		t.Fatalf("spaces = %d, want none (no personal space fallback)", n)
	}
}

func TestKailoOrgLoginAcceptsStringEncodedClaim(t *testing.T) {
	f := newKailoFixture(t)
	encoded, err := json.Marshal(kailoOrg("member"))
	if err != nil {
		t.Fatal(err)
	}
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", nil)
	f.claims["kailo_org"] = string(encoded)
	resp := f.login(t)
	if resp.User.TenantID != f.space(t, "tenant:6179e160-tenant").ID {
		t.Fatal("string-encoded organisation claim was not applied")
	}
}

func TestKailoOrgLoginAdoptsMappedSpaceAndFollowsKailoRole(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", kailoOrg("member"))
	// A legacy personal space with data, already adopted for the Kailo Tenant
	// by the migration script; its creator was the native owner.
	f.svc.config.Kailo.Enable = false
	legacy := f.login(t)
	f.svc.config.Kailo.Enable = true
	if legacy.User.TenantID == 0 {
		t.Fatal("legacy login should have created a personal space")
	}
	if err := f.db.Exec("UPDATE tenants SET kailo_scope_ref = ?, name = ? WHERE id = ?",
		"tenant:6179e160-tenant", "Acme", legacy.User.TenantID).Error; err != nil {
		t.Fatal(err)
	}

	resp := f.login(t)
	if resp.User.TenantID != legacy.User.TenantID {
		t.Fatalf("adopted space %d was not reused, got %d", legacy.User.TenantID, resp.User.TenantID)
	}
	if got := f.role(t, resp.User.ID, legacy.User.TenantID); got != types.TenantRoleContributor {
		t.Fatalf("native ownership must follow the Kailo role, got %q", got)
	}
	if n := f.count(t, &types.Tenant{}); n != 1 {
		t.Fatalf("spaces = %d, want the adopted space only", n)
	}
}

func TestKailoOrgLoginRenamesSpaceAndOrganization(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", kailoOrg("admin"))
	f.login(t)
	org := kailoOrg("admin")
	org["tenant"].(map[string]interface{})["name"] = "Acme Labs"
	f.claims["kailo_org"] = org
	f.login(t)
	if got := f.space(t, "tenant:6179e160-tenant").Name; got != "Acme Labs" {
		t.Fatalf("space name = %q", got)
	}
	var o types.Organization
	if err := f.db.Where("kailo_tenant_ref = ?", "6179e160-tenant").First(&o).Error; err != nil || o.Name != "Acme Labs" {
		t.Fatalf("organization name = %q err=%v", o.Name, err)
	}
}

func TestKailoScopeReferenceIsImmutable(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", kailoOrg("member"))
	resp := f.login(t)
	err := f.db.Exec("UPDATE tenants SET kailo_scope_ref = ? WHERE id = ?", "tenant:other", resp.User.TenantID).Error
	if err == nil || !strings.Contains(err.Error(), "immutable") {
		t.Fatalf("rewriting a Kailo scope reference must fail, err=%v", err)
	}
}

func (f *kailoFixture) logoutToken(t *testing.T, mutate func(jwt.MapClaims)) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":    kailoTestIssuer,
		"aud":    kailoTestClientID,
		"sub":    "ada",
		"sid":    "session-1",
		"iat":    time.Now().Unix(),
		"jti":    "logout-1",
		"events": map[string]interface{}{oidcBackchannelLogoutEvent: map[string]interface{}{}},
	}
	if mutate != nil {
		mutate(claims)
	}
	return signedIDToken(t, f.key, "kailo-kid", claims)
}

func TestKailoBackchannelLogoutRevokesSessions(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", kailoOrg("member"))
	user := f.login(t).User
	f.tokens.revokedUserIDs = nil

	if err := f.svc.LogoutByOIDCBackchannel(context.Background(), f.logoutToken(t, nil)); err != nil {
		t.Fatalf("valid logout token rejected: %v", err)
	}
	if len(f.tokens.revokedUserIDs) != 1 || f.tokens.revokedUserIDs[0] != user.ID {
		t.Fatalf("revoked = %v, want %s", f.tokens.revokedUserIDs, user.ID)
	}

	f.tokens.revokedUserIDs = nil
	unknown := f.logoutToken(t, func(c jwt.MapClaims) { c["sub"] = "never-logged-in" })
	if err := f.svc.LogoutByOIDCBackchannel(context.Background(), unknown); err != nil || len(f.tokens.revokedUserIDs) != 0 {
		t.Fatalf("unknown subject must be a no-op: err=%v revoked=%v", err, f.tokens.revokedUserIDs)
	}
}

func TestKailoBackchannelLogoutRejectsInvalidTokens(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", kailoOrg("member"))
	f.login(t)
	f.tokens.revokedUserIDs = nil
	other, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	cases := map[string]string{
		"wrong audience": f.logoutToken(t, func(c jwt.MapClaims) { c["aud"] = "another-client" }),
		"wrong issuer":   f.logoutToken(t, func(c jwt.MapClaims) { c["iss"] = "https://evil.example" }),
		"no event":       f.logoutToken(t, func(c jwt.MapClaims) { delete(c, "events") }),
		"other event":    f.logoutToken(t, func(c jwt.MapClaims) { c["events"] = map[string]interface{}{"urn:other": map[string]interface{}{}} }),
		"nonce present":  f.logoutToken(t, func(c jwt.MapClaims) { c["nonce"] = "n" }),
		"no subject":     f.logoutToken(t, func(c jwt.MapClaims) { delete(c, "sub") }),
		"too old":        f.logoutToken(t, func(c jwt.MapClaims) { c["iat"] = time.Now().Add(-time.Hour).Unix() }),
		"wrong signer":   signedIDToken(t, other, "kailo-kid", jwt.MapClaims{"iss": kailoTestIssuer, "aud": kailoTestClientID, "sub": "ada", "iat": time.Now().Unix(), "events": map[string]interface{}{oidcBackchannelLogoutEvent: map[string]interface{}{}}}),
		"unsigned":       unsignedJWT(jwt.MapClaims{"iss": kailoTestIssuer, "aud": kailoTestClientID, "sub": "ada", "iat": time.Now().Unix()}),
		"empty":          "",
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if err := f.svc.LogoutByOIDCBackchannel(context.Background(), token); !errors.Is(err, ErrInvalidLogoutToken) {
				t.Fatalf("err = %v, want ErrInvalidLogoutToken", err)
			}
		})
	}
	if len(f.tokens.revokedUserIDs) != 0 {
		t.Fatalf("an invalid logout token revoked sessions: %v", f.tokens.revokedUserIDs)
	}
}
