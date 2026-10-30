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
	kailoTestTenant   = "6179e160-tenant"
	kailoTestSpaceRef = "tenant:" + kailoTestTenant
)

// kailoFixture is a Kailo-mode native service against a real SQLite schema
// (identity and Kailo columns, triggers and tables installed by the actual
// migrations) and a local identity-provider fixture serving token, userinfo
// and JWKS. Tokens are stored by the real token repository.
type kailoFixture struct {
	svc    *userService
	db     *gorm.DB
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
	f := &kailoFixture{key: key}
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
	if err := db.AutoMigrate(&types.Tenant{}, &types.User{}, &types.TenantMember{}, &types.AuthToken{},
		&types.Organization{}, &types.OrganizationTenantMember{}); err != nil {
		t.Fatal(err)
	}
	// Install the identity and Kailo columns, constraints, triggers and
	// tables through the actual migrations.
	if err := db.Exec("DROP INDEX idx_users_oidc_identity; ALTER TABLE users DROP COLUMN oidc_subject; ALTER TABLE users DROP COLUMN oidc_issuer; " +
		"DROP INDEX idx_tenants_kailo_scope_ref; ALTER TABLE tenants DROP COLUMN kailo_scope_ref; " +
		"DROP INDEX idx_organizations_kailo_tenant_ref; ALTER TABLE organizations DROP COLUMN kailo_tenant_ref; " +
		"DROP INDEX idx_organizations_kailo_share_ref; ALTER TABLE organizations DROP COLUMN kailo_share_ref; " +
		"ALTER TABLE auth_tokens DROP COLUMN oidc_sid; ALTER TABLE auth_tokens DROP COLUMN session_expires_at").Error; err != nil {
		t.Fatal(err)
	}
	// Knowledge bases and their shares as the native SQLite schema creates
	// them (only the columns the Kailo share projection reads).
	if err := db.Exec("CREATE TABLE knowledge_bases (id VARCHAR(36) PRIMARY KEY, name VARCHAR(255) NOT NULL DEFAULT '', " +
		"tenant_id INTEGER NOT NULL, creator_id VARCHAR(36), deleted_at DATETIME)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(sqliteCreateTable(t, "kb_shares")).Error; err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"000024_oidc_identity.up.sql", "000028_kailo_integration.up.sql",
		"000029_kailo_member_directory.up.sql", "000030_kailo_share_projection.up.sql"} {
		migration, err := os.ReadFile("../../../migrations/sqlite/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if err := db.Exec(string(migration)).Error; err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	tenantSvc := NewTenantService(repository.NewTenantRepository(db), nil)
	tokens := repository.NewAuthTokenRepository(db)
	f.db = db
	f.svc = &userService{
		userRepo:      repository.NewUserRepository(db),
		tokenRepo:     tokens,
		tenantService: tenantSvc,
		memberService: NewTenantMemberService(repository.NewTenantMemberRepository(db), nil, nil, nil),
		config: &config.Config{
			OIDCAuth: &config.OIDCAuthConfig{
				Enable: true, IssuerURL: kailoTestIssuer, ClientID: kailoTestClientID,
				AuthorizationEndpoint: provider.URL + "/authorize", TokenEndpoint: provider.URL + "/token",
				UserInfoEndpoint: provider.URL + "/userinfo", JwksURI: provider.URL + "/jwks",
			},
			Kailo: &config.KailoIntegrationConfig{Enable: true, TenantID: kailoTestTenant, TenantName: "Acme"},
		},
		kailoOrg:   NewKailoOrgService(db, tenantSvc, tokens, nil),
		logoutRepo: repository.NewOIDCLogoutRepository(db),
	}
	return f
}

func kailoClaims(sub, email, name, sid string) map[string]interface{} {
	return map[string]interface{}{"sub": sub, "email": email, "name": name, "email_verified": true, "sid": sid}
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

func (f *kailoFixture) valid(t *testing.T, access string) bool {
	t.Helper()
	_, _, err := f.svc.ValidateToken(context.Background(), access)
	return err == nil
}

func TestKailoLoginPutsEveryTenantMemberIntoOneSpace(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada Lovelace", "sid-ada")
	ada := f.login(t)
	space := f.space(t, kailoTestSpaceRef)
	if space.Name != "Acme" {
		t.Fatalf("space name = %q", space.Name)
	}
	if ada.Tenant == nil || ada.Tenant.ID != space.ID || ada.User.TenantID != space.ID {
		t.Fatalf("the Tenant space must be the home space: %+v", ada.Tenant)
	}
	f.claims = kailoClaims("bob", "bob@example.com", "Bob", "sid-bob")
	bob := f.login(t)
	if bob.User.TenantID != space.ID {
		t.Fatalf("second member landed in space %d, want the shared Tenant space %d", bob.User.TenantID, space.ID)
	}
	// Until the member directory supplies roles nobody is an administrator.
	for _, user := range []*types.User{ada.User, bob.User} {
		if got := f.role(t, user.ID, space.ID); got != types.TenantRoleContributor {
			t.Fatalf("role of %s = %q, want contributor", user.Username, got)
		}
	}
	if n := f.count(t, &types.Tenant{}); n != 1 {
		t.Fatalf("native spaces = %d, want only the Tenant space (no personal spaces)", n)
	}
	var org types.Organization
	if err := f.db.Select("id", "owner_tenant_id").Where("kailo_tenant_ref = ?", kailoTestTenant).First(&org).Error; err != nil {
		t.Fatalf("Tenant organization: %v", err)
	}
	var members []types.OrganizationTenantMember
	if err := f.db.Where("organization_id = ?", org.ID).Find(&members).Error; err != nil {
		t.Fatal(err)
	}
	if org.OwnerTenantID != space.ID || len(members) != 1 || members[0].TenantID != space.ID || members[0].Role != types.OrgRoleAdmin {
		t.Fatalf("organization = %+v members = %+v", org, members)
	}
}

func TestKailoMembershipSyncFollowsDirectoryRolesAndWorkspaces(t *testing.T) {
	// The directory-backed projection (07 §4.7.4) goes through the same
	// reconciliation: Workspace spaces, admin roles, and removals.
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", "sid-1")
	user := f.login(t).User
	ctx := context.Background()
	membership := &types.KailoMembership{
		Tenant:     types.KailoScope{ID: kailoTestTenant, Name: "Acme", Role: types.KailoRoleAdmin, Create: true},
		Workspaces: []types.KailoScope{{ID: "ws-a", Name: "A", Role: types.KailoRoleMember}},
	}
	if _, err := f.svc.kailoOrg.SyncLogin(ctx, user, membership); err != nil {
		t.Fatal(err)
	}
	wsA := f.space(t, "workspace:ws-a")
	tenantSpace := f.space(t, kailoTestSpaceRef)
	if f.role(t, user.ID, tenantSpace.ID) != types.TenantRoleAdmin || f.role(t, user.ID, wsA.ID) != types.TenantRoleAdmin {
		t.Fatal("a Tenant administrator administers the Tenant space and every Workspace space")
	}
	membership.Tenant.Role = types.KailoRoleMember
	membership.Tenant.Create = true
	membership.Workspaces = nil
	if _, err := f.svc.kailoOrg.SyncLogin(ctx, user, membership); err != nil {
		t.Fatal(err)
	}
	if got := f.role(t, user.ID, wsA.ID); got != "" {
		t.Fatalf("membership removed in Kailo survived natively with role %q", got)
	}
	if got := f.role(t, user.ID, tenantSpace.ID); got != types.TenantRoleContributor {
		t.Fatalf("demoted role = %q", got)
	}
	var revoked int64
	if err := f.db.Model(&types.AuthToken{}).Where("user_id = ? AND is_revoked = ?", user.ID, true).Count(&revoked).Error; err != nil || revoked == 0 {
		t.Fatalf("earlier sessions of a removed member must be revoked (revoked=%d err=%v)", revoked, err)
	}
}

func TestKailoLoginRefreshesProfileEveryTime(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada Lovelace", "sid-1")
	f.claims["picture"] = "https://kailo.example/api/v1/identity/avatars/ada"
	f.claims["locale"] = "en_US"
	first := f.login(t)
	if first.User.Username != "Ada Lovelace" || first.User.Avatar != "https://kailo.example/api/v1/identity/avatars/ada" {
		t.Fatalf("profile not taken from Kailo: %+v", first.User)
	}
	if first.User.Preferences.Locale == nil || *first.User.Preferences.Locale != "en-US" {
		t.Fatalf("locale = %v", first.User.Preferences.Locale)
	}

	f.claims["name"] = "Ada King"
	f.claims["email"] = "ada.king@example.com"
	delete(f.claims, "picture")
	f.claims["locale"] = "zh-CN"
	f.login(t)
	var stored types.User
	if err := f.db.First(&stored, "id = ?", first.User.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Username != "Ada King" || stored.Email != "ada.king@example.com" || stored.Avatar != "" ||
		stored.Preferences.Locale == nil || *stored.Preferences.Locale != "zh-CN" {
		t.Fatalf("profile was not refreshed: %+v", stored)
	}

	// An unverified address is never written.
	f.claims["email"] = "unverified@example.com"
	f.claims["email_verified"] = false
	f.login(t)
	if err := f.db.First(&stored, "id = ?", first.User.ID).Error; err != nil || stored.Email != "ada.king@example.com" {
		t.Fatalf("unverified email was written: %q err=%v", stored.Email, err)
	}

	// Another account already shows the same name: the preferred username
	// disambiguates instead of failing the login.
	f.claims = kailoClaims("ada-2", "other.ada@example.com", "Ada King", "sid-2")
	f.claims["preferred_username"] = "aking2"
	if got := f.login(t).User.Username; got != "Ada King (aking2)" {
		t.Fatalf("duplicate display name = %q", got)
	}
}

func TestKailoLoginAdoptsMappedSpaceAndDropsNativeOwnership(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", "sid-1")
	// A legacy personal space with data, adopted for the Kailo Tenant by
	// kailo-org-adopt.sh; its creator was the native owner.
	f.svc.config.Kailo.Enable = false
	legacy := f.login(t)
	f.svc.config.Kailo.Enable = true
	if legacy.User.TenantID == 0 {
		t.Fatal("legacy login should have created a personal space")
	}
	if err := f.db.Exec("UPDATE tenants SET kailo_scope_ref = ?, name = ? WHERE id = ?",
		kailoTestSpaceRef, "Acme", legacy.User.TenantID).Error; err != nil {
		t.Fatal(err)
	}
	resp := f.login(t)
	if resp.User.TenantID != legacy.User.TenantID {
		t.Fatalf("adopted space %d was not reused, got %d", legacy.User.TenantID, resp.User.TenantID)
	}
	if got := f.role(t, resp.User.ID, legacy.User.TenantID); got != types.TenantRoleContributor {
		t.Fatalf("native ownership must follow Kailo, got %q", got)
	}
	if n := f.count(t, &types.Tenant{}); n != 1 {
		t.Fatalf("spaces = %d, want the adopted space only", n)
	}
}

func TestKailoLoginRenamesSpaceAndOrganization(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", "sid-1")
	f.login(t)
	f.svc.config.Kailo.TenantName = "Acme Labs"
	f.login(t)
	if got := f.space(t, kailoTestSpaceRef).Name; got != "Acme Labs" {
		t.Fatalf("space name = %q", got)
	}
	var o types.Organization
	if err := f.db.Select("name").Where("kailo_tenant_ref = ?", kailoTestTenant).First(&o).Error; err != nil || o.Name != "Acme Labs" {
		t.Fatalf("organization name = %q err=%v", o.Name, err)
	}
}

func TestKailoScopeReferenceIsImmutable(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", "sid-1")
	resp := f.login(t)
	err := f.db.Exec("UPDATE tenants SET kailo_scope_ref = ? WHERE id = ?", "tenant:other", resp.User.TenantID).Error
	if err == nil || !strings.Contains(err.Error(), "immutable") {
		t.Fatalf("rewriting a Kailo scope reference must fail, err=%v", err)
	}
}

func TestKailoSessionIsBoundToTheIdPSession(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", "sid-1")
	resp := f.login(t)
	var rows []types.AuthToken
	if err := f.db.Where("user_id = ?", resp.User.ID).Find(&rows).Error; err != nil || len(rows) != 2 {
		t.Fatalf("tokens = %d err=%v", len(rows), err)
	}
	for _, row := range rows {
		if row.OIDCSID == nil || *row.OIDCSID != "sid-1" || row.SessionExpiresAt == nil ||
			row.SessionExpiresAt.After(time.Now().Add(config.DefaultKailoSessionMaxLifetime)) || row.ExpiresAt.After(*row.SessionExpiresAt) {
			t.Fatalf("token row not bound to the IdP session: %+v", row)
		}
	}
	deadline := *rows[0].SessionExpiresAt

	// Refresh keeps the same sid and deadline.
	_, refreshed, err := f.svc.RefreshToken(context.Background(), resp.RefreshToken)
	if err != nil {
		t.Fatal(err)
	}
	var next types.AuthToken
	if err := f.db.Where("token = ?", refreshed).First(&next).Error; err != nil {
		t.Fatal(err)
	}
	if next.OIDCSID == nil || *next.OIDCSID != "sid-1" || next.SessionExpiresAt == nil || !next.SessionExpiresAt.Equal(deadline) {
		t.Fatalf("refresh changed the session: %+v", next)
	}

	// A session past its deadline cannot be refreshed.
	if err := f.db.Model(&types.AuthToken{}).Where("token = ?", refreshed).
		Update("session_expires_at", time.Now().Add(-time.Minute)).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.svc.RefreshToken(context.Background(), refreshed); !errors.Is(err, ErrNativeSessionExpired) {
		t.Fatalf("expired session refresh err = %v", err)
	}
}

func (f *kailoFixture) logoutToken(t *testing.T, mutate func(jwt.MapClaims)) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":    kailoTestIssuer,
		"aud":    kailoTestClientID,
		"sub":    "ada",
		"sid":    "sid-1",
		"iat":    time.Now().Unix(),
		"jti":    "logout-" + t.Name() + "-" + time.Now().Format("150405.000000000"),
		"events": map[string]interface{}{oidcBackchannelLogoutEvent: map[string]interface{}{}},
	}
	if mutate != nil {
		mutate(claims)
	}
	return signedIDToken(t, f.key, "kailo-kid", claims)
}

func TestKailoBackchannelLogoutEndsOnlyTheIdPSession(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", "sid-1")
	browserOne := f.login(t)
	f.claims["sid"] = "sid-2"
	browserTwo := f.login(t)

	token := f.logoutToken(t, nil)
	if err := f.svc.LogoutByOIDCBackchannel(context.Background(), token); err != nil {
		t.Fatalf("valid logout token rejected: %v", err)
	}
	if f.valid(t, browserOne.Token) {
		t.Fatal("the session of the logged-out sid is still valid")
	}
	if !f.valid(t, browserTwo.Token) {
		t.Fatal("a different IdP session of the same person must survive")
	}
	// Redelivery of the same token is a replay.
	if err := f.svc.LogoutByOIDCBackchannel(context.Background(), token); !errors.Is(err, ErrInvalidLogoutToken) {
		t.Fatalf("replay err = %v", err)
	}

	// sub without sid ends every session of the person.
	noSID := f.logoutToken(t, func(c jwt.MapClaims) { delete(c, "sid"); c["jti"] = "logout-sub-only" })
	if err := f.svc.LogoutByOIDCBackchannel(context.Background(), noSID); err != nil || f.valid(t, browserTwo.Token) {
		t.Fatalf("sub-only logout: err=%v still valid=%v", err, f.valid(t, browserTwo.Token))
	}

	// sid without sub ends that session wherever it is.
	f.claims["sid"] = "sid-3"
	browserThree := f.login(t)
	sidOnly := f.logoutToken(t, func(c jwt.MapClaims) { delete(c, "sub"); c["sid"] = "sid-3"; c["jti"] = "logout-sid-only" })
	if err := f.svc.LogoutByOIDCBackchannel(context.Background(), sidOnly); err != nil || f.valid(t, browserThree.Token) {
		t.Fatalf("sid-only logout: err=%v", err)
	}

	unknown := f.logoutToken(t, func(c jwt.MapClaims) { c["sub"] = "never-logged-in"; c["jti"] = "logout-unknown" })
	if err := f.svc.LogoutByOIDCBackchannel(context.Background(), unknown); err != nil {
		t.Fatalf("unknown subject must be a no-op: err=%v", err)
	}
}

func TestKailoBackchannelLogoutRejectsInvalidTokens(t *testing.T) {
	f := newKailoFixture(t)
	f.claims = kailoClaims("ada", "ada@example.com", "Ada", "sid-1")
	session := f.login(t)
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
		"no sid or sub":  f.logoutToken(t, func(c jwt.MapClaims) { delete(c, "sub"); delete(c, "sid") }),
		"no jti":         f.logoutToken(t, func(c jwt.MapClaims) { delete(c, "jti") }),
		"too old":        f.logoutToken(t, func(c jwt.MapClaims) { c["iat"] = time.Now().Add(-time.Hour).Unix() }),
		"wrong signer": signedIDToken(t, other, "kailo-kid", jwt.MapClaims{"iss": kailoTestIssuer, "aud": kailoTestClientID,
			"sub": "ada", "iat": time.Now().Unix(), "jti": "x",
			"events": map[string]interface{}{oidcBackchannelLogoutEvent: map[string]interface{}{}}}),
		"unsigned": unsignedJWT(jwt.MapClaims{"iss": kailoTestIssuer, "aud": kailoTestClientID, "sub": "ada", "iat": time.Now().Unix(), "jti": "y"}),
		"empty":    "",
	}
	for name, token := range cases {
		t.Run(name, func(t *testing.T) {
			if err := f.svc.LogoutByOIDCBackchannel(context.Background(), token); !errors.Is(err, ErrInvalidLogoutToken) {
				t.Fatalf("err = %v, want ErrInvalidLogoutToken", err)
			}
		})
	}
	if !f.valid(t, session.Token) {
		t.Fatal("an invalid logout token ended a session")
	}
}

// sqliteCreateTable is the CREATE TABLE statement of table in the native
// SQLite init migration.
func sqliteCreateTable(t *testing.T, table string) string {
	t.Helper()
	raw, err := os.ReadFile("../../../migrations/sqlite/000000_init.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	start := strings.Index(text, "CREATE TABLE IF NOT EXISTS "+table+" (")
	if start < 0 {
		t.Fatalf("no CREATE TABLE for %s", table)
	}
	end := strings.Index(text[start:], ");")
	return text[start : start+end+2]
}
