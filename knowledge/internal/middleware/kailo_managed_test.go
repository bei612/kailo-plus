package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
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

// DD-138(6), design 07 §4.8.5: in Kailo mode the server refuses writes behind
// the READ_ONLY admin surfaces (models.catalog, storage.backends,
// indexing.parsers) and instance administration, while the reads the business
// pages use (model lists, KB model choice, storage and parser listings) and the
// EDITABLE surface (web search) stays open. DD-163: skills, sandboxes and MCP
// services are no surfaces; their writes are refused, MCP publication stays.
func TestKailoManagedGuardClosesAdminSurfaceWritesAndInstanceAdmin(t *testing.T) {
	enabled := kailoGuardRouter(&config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true}})
	disabled := kailoGuardRouter(&config.Config{})
	closed := []struct{ method, path string }{
		// models.catalog (MODELS, READ_ONLY)
		{http.MethodPost, "/api/v1/models"},
		{http.MethodPut, "/api/v1/models/m-1"},
		{http.MethodDelete, "/api/v1/models/m-1"},
		{http.MethodPost, "/api/v1/models/m-1/debug"},
		{http.MethodDelete, "/api/v1/models/m-1/credentials/api_key"},
		{http.MethodPost, "/api/v1/weknoracloud/credentials"},
		{http.MethodPost, "/api/v1/initialization/initialize/kb-1"},
		{http.MethodPost, "/api/v1/initialization/ollama/models/check"},
		{http.MethodPost, "/api/v1/initialization/ollama/models/download"},
		{http.MethodPost, "/api/v1/initialization/remote/check"},
		{http.MethodPost, "/api/v1/initialization/embedding/test"},
		{http.MethodPost, "/api/v1/initialization/rerank/check"},
		{http.MethodPost, "/api/v1/initialization/asr/check"},
		{http.MethodPost, "/api/v1/initialization/multimodal/test"},
		// storage.backends (STORAGE, READ_ONLY)
		{http.MethodPost, "/api/v1/vector-stores"},
		{http.MethodPost, "/api/v1/vector-stores/test"},
		{http.MethodPut, "/api/v1/vector-stores/vs-1"},
		{http.MethodDelete, "/api/v1/vector-stores/vs-1"},
		{http.MethodPost, "/api/v1/vector-stores/vs-1/test"},
		{http.MethodPost, "/api/v1/storage-backends"},
		{http.MethodPost, "/api/v1/storage-backends/test"},
		{http.MethodPut, "/api/v1/storage-backends/sb-1"},
		{http.MethodDelete, "/api/v1/storage-backends/sb-1"},
		{http.MethodPost, "/api/v1/storage-backends/sb-1/test"},
		{http.MethodPut, "/api/v1/storage-backends/sb-1/default"},
		{http.MethodPut, "/api/v1/tenants/kv/storage-engine-config"},
		{http.MethodPost, "/api/v1/system/storage-engine-check"},
		// DD-163: answer skills, their sandboxes and MCP services (no surface)
		{http.MethodPost, "/api/v1/skills/catalog"},
		{http.MethodPost, "/api/v1/skills/catalog/sk-1/install"},
		{http.MethodDelete, "/api/v1/skills/catalog/sk-1"},
		{http.MethodPut, "/api/v1/sandbox-configs/workspace-policy"},
		{http.MethodPost, "/api/v1/sandbox-configs/templates/query"},
		{http.MethodPost, "/api/v1/sandbox-configs"},
		{http.MethodPut, "/api/v1/sandbox-configs/sc-1"},
		{http.MethodDelete, "/api/v1/sandbox-configs/sc-1"},
		{http.MethodPost, "/api/v1/sandbox-configs/sc-1/skills"},
		{http.MethodPost, "/api/v1/sandbox-configs/sc-1/skills/s-1/reinstall"},
		{http.MethodPost, "/api/v1/sandbox-configs/sc-1/skills/s-1/guidance"},
		{http.MethodPost, "/api/v1/sandbox-configs/sc-1/skills/s-1/stop"},
		{http.MethodPatch, "/api/v1/sandbox-configs/sc-1/skills/s-1"},
		{http.MethodDelete, "/api/v1/sandbox-configs/sc-1/skills/s-1"},
		{http.MethodPost, "/api/v1/system/sandbox-check"},
		{http.MethodPost, "/api/v1/mcp-services"},
		{http.MethodPut, "/api/v1/mcp-services/mcp-1"},
		{http.MethodDelete, "/api/v1/mcp-services/mcp-1"},
		{http.MethodPost, "/api/v1/mcp-services/mcp-1/test"},
		{http.MethodPost, "/api/v1/mcp-services/mcp-1/metadata/refresh"},
		{http.MethodPost, "/api/v1/mcp-services/mcp-1/usage-instructions/generate"},
		{http.MethodPut, "/api/v1/mcp-services/mcp-1/credentials"},
		{http.MethodDelete, "/api/v1/mcp-services/mcp-1/credentials/token"},
		{http.MethodPut, "/api/v1/mcp-services/mcp-1/tool-approvals/search"},
		{http.MethodPost, "/api/v1/mcp-services/mcp-1/oauth/authorize-url"},
		{http.MethodDelete, "/api/v1/mcp-services/mcp-1/oauth/token"},
		// indexing.parsers (INDEXING, READ_ONLY)
		{http.MethodPut, "/api/v1/tenants/kv/parser-engine-config"},
		{http.MethodPost, "/api/v1/system/parser-engines/check"},
		{http.MethodPost, "/api/v1/system/docreader/reconnect"},
		// Instance administration (not a surface)
		{http.MethodPost, "/api/v1/system/admin/promote"},
		{http.MethodPost, "/api/v1/system/admin/revoke"},
		{http.MethodGet, "/api/v1/system/admin/list"},
		{http.MethodGet, "/api/v1/system/admin/api-keys"},
		{http.MethodPost, "/api/v1/system/admin/api-keys"},
		{http.MethodDelete, "/api/v1/system/admin/api-keys/7"},
		{http.MethodGet, "/api/v1/system/admin/settings"},
		{http.MethodPut, "/api/v1/system/admin/settings/max_upload"},
		{http.MethodDelete, "/api/v1/system/admin/settings/max_upload"},
		{http.MethodGet, "/api/v1/system/admin/runtime/queues"},
		{http.MethodPost, "/api/v1/system/admin/runtime/queues/default/tasks/t-1/actions/retry"},
		{http.MethodDelete, "/api/v1/system/admin/runtime/queues/default/archived"},
		{http.MethodPost, "/api/v1/system/admin/tenants/apply-default-storage-quota"},
		{http.MethodGet, "/api/v1/system/admin/audit-log"},
		{http.MethodPost, "/api/v1/tenants/10002/api-keys"},
		{http.MethodPut, "/api/v1/tenants/10002/api-keys/3"},
		{http.MethodDelete, "/api/v1/tenants/10002/api-keys/3"},
		{http.MethodPut, "/api/v1/tenants/10002/api-principal-config"},
		{http.MethodPost, "/api/v1/tenants/10002/api-principal-test-token"},
		{http.MethodGet, "/api/v1/tenants/10002/audit-log"},
	}
	for _, tc := range closed {
		w := httptest.NewRecorder()
		enabled.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != http.StatusForbidden || !strings.Contains(w.Body.String(), "KAILO_MANAGED") {
			t.Errorf("Kailo mode %s %s = %d, want 403 KAILO_MANAGED", tc.method, tc.path, w.Code)
		}
		w = httptest.NewRecorder()
		disabled.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != http.StatusNoContent {
			t.Errorf("native mode %s %s = %d, want pass-through", tc.method, tc.path, w.Code)
		}
	}

	open := []struct{ method, path string }{
		// Business reads and choices among provided models stay.
		{http.MethodGet, "/api/v1/models"},
		{http.MethodGet, "/api/v1/models/m-1"},
		{http.MethodGet, "/api/v1/models/providers"},
		// DD-128 delivery channel; the handler admits only Kailo-routed models.
		{http.MethodPut, "/api/v1/models/m-1/credentials"},
		{http.MethodGet, "/api/v1/initialization/config/kb-1"},
		{http.MethodPut, "/api/v1/initialization/config/kb-1"},
		{http.MethodPut, "/api/v1/knowledge-bases/kb-1"},
		{http.MethodGet, "/api/v1/vector-stores"},
		{http.MethodGet, "/api/v1/vector-stores/types"},
		{http.MethodGet, "/api/v1/storage-backends"},
		{http.MethodGet, "/api/v1/tenants/kv/parser-engine-config"},
		{http.MethodGet, "/api/v1/tenants/kv/storage-engine-config"},
		{http.MethodGet, "/api/v1/system/parser-engines"},
		{http.MethodGet, "/api/v1/system/storage-engine-status"},
		{http.MethodGet, "/api/v1/system/info"},
		{http.MethodGet, "/api/v1/system/capabilities"},
		// Reads of skills, sandboxes and MCP services stay.
		{http.MethodGet, "/api/v1/skills"},
		{http.MethodGet, "/api/v1/skills/catalog"},
		{http.MethodGet, "/api/v1/sandbox-configs"},
		{http.MethodGet, "/api/v1/sandbox-configs/sc-1"},
		{http.MethodGet, "/api/v1/sandbox-configs/sc-1/skills"},
		{http.MethodGet, "/api/v1/mcp-services"},
		{http.MethodGet, "/api/v1/mcp-services/mcp-1/tools"},
		// MCP publication (08 §5): native endpoint management and the served surface stay.
		{http.MethodPost, "/api/v1/mcp-endpoints"},
		{http.MethodPut, "/api/v1/mcp-endpoints/ep-1"},
		{http.MethodDelete, "/api/v1/mcp-endpoints/ep-1"},
		{http.MethodPost, "/api/v1/mcp-endpoints/ep-1/rotate-token"},
		// EDITABLE admin surface answers.webSearch.
		{http.MethodPost, "/api/v1/web-search-providers"},
		{http.MethodPut, "/api/v1/web-search-providers/ws-1"},
		{http.MethodPut, "/api/v1/tenants/kv/web-search-config"},
		{http.MethodGet, "/api/v1/tenants/10002/api-keys"},
	}
	for _, tc := range open {
		w := httptest.NewRecorder()
		enabled.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != http.StatusNoContent {
			t.Errorf("Kailo mode %s %s = %d, want open", tc.method, tc.path, w.Code)
		}
	}
}
