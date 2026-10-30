package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/Tencent/WeKnora/internal/config"
)

func kailoGuardRouter(cfg *config.Config) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	v1 := r.Group("/api/v1")
	v1.Use(KailoManagedGuard(cfg))
	v1.Any("/*path", func(c *gin.Context) { c.Status(http.StatusNoContent) })
	return r
}

func TestKailoManagedGuardClosesLocalCredentialsAndMembershipEdits(t *testing.T) {
	enabled := kailoGuardRouter(&config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true}})
	disabled := kailoGuardRouter(&config.Config{})
	closed := []struct{ method, path string }{
		{http.MethodPost, "/api/v1/auth/login"},
		{http.MethodPost, "/api/v1/auth/register"},
		{http.MethodPost, "/api/v1/auth/register-by-invite"},
		{http.MethodPost, "/api/v1/auth/change-password"},
		{http.MethodPost, "/api/v1/system/admin/users/reset-password"},
		{http.MethodPost, "/api/v1/tenants"},
		{http.MethodDelete, "/api/v1/tenants/10002"},
		{http.MethodPost, "/api/v1/tenants/10002/members"},
		{http.MethodPut, "/api/v1/tenants/10002/members/u-1"},
		{http.MethodDelete, "/api/v1/tenants/10002/members/u-1"},
		{http.MethodPost, "/api/v1/tenants/10002/leave"},
		{http.MethodPost, "/api/v1/tenants/10002/invitations"},
		{http.MethodPost, "/api/v1/tenants/10002/invite-links"},
		{http.MethodPost, "/api/v1/me/invitations/inv-1/accept"},
		{http.MethodPost, "/api/v1/organizations"},
		{http.MethodPost, "/api/v1/organizations/join"},
		{http.MethodGet, "/api/v1/organizations/search"},
		{http.MethodGet, "/api/v1/organizations/org-1/search-users"},
		{http.MethodDelete, "/api/v1/organizations/org-1/members/10003"},
		{http.MethodPost, "/api/v1/organizations/org-1/leave"},
	}
	for _, tc := range closed {
		w := httptest.NewRecorder()
		enabled.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != http.StatusForbidden {
			t.Errorf("Kailo mode %s %s = %d, want 403", tc.method, tc.path, w.Code)
		}
		w = httptest.NewRecorder()
		disabled.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != http.StatusNoContent {
			t.Errorf("native mode %s %s = %d, want pass-through", tc.method, tc.path, w.Code)
		}
	}

	open := []struct{ method, path string }{
		{http.MethodGet, "/api/v1/auth/oidc/start"},
		{http.MethodPost, "/api/v1/auth/oidc/backchannel-logout"},
		{http.MethodPost, "/api/v1/auth/logout"},
		{http.MethodPost, "/api/v1/auth/switch-tenant"},
		{http.MethodGet, "/api/v1/tenants"},
		{http.MethodGet, "/api/v1/tenants/10002/members"},
		{http.MethodGet, "/api/v1/organizations"},
		{http.MethodGet, "/api/v1/organizations/org-1/members"},
		// Knowledge base shares are closed (DD-164(4), kailo_share_routes_test.go).
		{http.MethodGet, "/api/v1/knowledge-bases/kb-1/shares"},
		{http.MethodPost, "/api/v1/agents/ag-1/shares"},
		{http.MethodPost, "/api/v1/knowledge-bases"},
	}
	for _, tc := range open {
		w := httptest.NewRecorder()
		enabled.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != http.StatusNoContent {
			t.Errorf("Kailo mode %s %s = %d, want open", tc.method, tc.path, w.Code)
		}
	}
}
