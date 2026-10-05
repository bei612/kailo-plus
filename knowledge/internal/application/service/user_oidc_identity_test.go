package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/Tencent/WeKnora/internal/application/repository"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// Exercise the actual code-exchange → UserInfo → native repository → local
// token path. The IdP here is a local HTTP fixture, not a platform admin token.
func nativeOIDCLoginFixture(t *testing.T) (*userService, *gorm.DB, map[string]string) {
	t.Helper()
	withOIDCSSRFWhitelist(t, "127.0.0.1")
	claims := map[string]string{"sub": "human-one", "email": "one@example.com", "name": "Human One"}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": "fixture-token"})
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer fixture-token" {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_ = json.NewEncoder(w).Encode(claims)
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
	if err := db.AutoMigrate(&types.Tenant{}, &types.User{}); err != nil {
		t.Fatal(err)
	}
	// Keep the native user shape, but install the identity columns and guards
	// through the actual migration instead of trusting AutoMigrate's naming.
	if err := db.Exec("DROP INDEX idx_users_oidc_identity; ALTER TABLE users DROP COLUMN oidc_subject; ALTER TABLE users DROP COLUMN oidc_issuer").Error; err != nil {
		t.Fatal(err)
	}
	identityMigration, err := os.ReadFile("../../../migrations/sqlite/000024_oidc_identity.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(identityMigration)).Error; err != nil {
		t.Fatal(err)
	}
	svc := &userService{
		userRepo:  repository.NewUserRepository(db),
		tokenRepo: &stubAuthTokenRepo{},
		config: &config.Config{OIDCAuth: &config.OIDCAuthConfig{
			Enable: true, IssuerURL: "https://kailo-idp.example/realms/development",
			AuthorizationEndpoint: provider.URL + "/authorize", TokenEndpoint: provider.URL + "/token",
			UserInfoEndpoint: provider.URL + "/userinfo", ClientID: "weknora-native",
		}},
	}
	return svc, db, claims
}

func nativeLogin(t *testing.T, svc *userService) (*types.OIDCCallbackResponse, error) {
	t.Helper()
	return svc.LoginWithOIDC(context.Background(), "fixture-code", "https://knowledge.example/api/v1/auth/oidc/callback", types.TenantProvisioningTenantless)
}

func TestKailoOIDCNativeIdentitySurvivesEmailChange(t *testing.T) {
	svc, db, claims := nativeOIDCLoginFixture(t)
	first, err := nativeLogin(t, svc)
	if err != nil || !first.Success || !first.IsNewUser {
		t.Fatalf("first native login: response=%+v err=%v", first, err)
	}
	if first.User.OIDCIssuer == nil || first.User.OIDCSubject == nil || *first.User.OIDCSubject != claims["sub"] {
		t.Fatal("authenticated identity was not persisted with the native account")
	}
	if first.User.CanAccessAllTenants || first.User.IsSystemAdmin || first.User.TenantID != 0 {
		t.Fatal("OIDC introduced privileges outside the original native provisioning policy")
	}
	claims["email"] = "changed@example.com"
	second, err := nativeLogin(t, svc)
	if err != nil || !second.Success || second.IsNewUser || second.User.ID != first.User.ID {
		t.Fatalf("changed email must retain the same native identity: response=%+v err=%v", second, err)
	}
	var count int64
	if err := db.Model(&types.User{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("native user count=%d err=%v", count, err)
	}
}

func TestKailoOIDCEmailCollisionCannotTakeOverNativeUser(t *testing.T) {
	for _, existingIdentity := range []string{"local", "other-subject", "other-issuer"} {
		t.Run(existingIdentity, func(t *testing.T) {
			svc, db, claims := nativeOIDCLoginFixture(t)
			user := &types.User{ID: "native-existing", Username: "native-admin", Email: claims["email"], PasswordHash: "hashed", IsActive: true, IsSystemAdmin: true}
			issuer, subject := svc.config.OIDCAuth.IssuerURL, claims["sub"]
			if existingIdentity == "other-subject" {
				subject = "different-human"
				user.OIDCIssuer, user.OIDCSubject = &issuer, &subject
			} else if existingIdentity == "other-issuer" {
				issuer = "https://other-idp.example"
				user.OIDCIssuer, user.OIDCSubject = &issuer, &subject
			}
			if err := svc.userRepo.CreateUser(context.Background(), user); err != nil {
				t.Fatal(err)
			}
			if result, err := nativeLogin(t, svc); err == nil || result != nil {
				t.Fatalf("email collision authenticated another native account: result=%+v err=%v", result, err)
			}
			var stored types.User
			if err := db.First(&stored, "id = ?", user.ID).Error; err != nil || !stored.IsSystemAdmin {
				t.Fatalf("original native account was changed: err=%v", err)
			}
		})
	}
}

func TestKailoOIDCDisabledNativeIdentityDoesNotIssueSession(t *testing.T) {
	svc, db, _ := nativeOIDCLoginFixture(t)
	first, err := nativeLogin(t, svc)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&types.User{}).Where("id = ?", first.User.ID).Update("is_active", false).Error; err != nil {
		t.Fatal(err)
	}
	second, err := nativeLogin(t, svc)
	if err != nil || second.Success || second.Token != "" || second.RefreshToken != "" {
		t.Fatalf("disabled native identity authenticated: response=%+v err=%v", second, err)
	}
}
