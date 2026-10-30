package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/Tencent/WeKnora/internal/config"
)

// convergeRouter mounts the guard on the engine, as router.NewRouter does,
// so pre-Auth routes outside /api/v1 groups are covered too.
func convergeRouter(cfg *config.Config) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(KailoConvergeGuard(cfg))
	r.NoRoute(func(c *gin.Context) { c.Status(http.StatusNoContent) })
	return r
}

func TestKailoConvergeGuardClosesDuplicateAgentMemoryIMAndEmbed(t *testing.T) {
	enabled := convergeRouter(&config.Config{Kailo: &config.KailoIntegrationConfig{Enable: true}})
	disabled := convergeRouter(&config.Config{})
	closed := []struct{ method, path string }{
		// Custom agents and sharing.
		{http.MethodPost, "/api/v1/agents"},
		{http.MethodPost, "/api/v1/agents/a-1/copy"},
		{http.MethodPut, "/api/v1/agents/a-1"},
		{http.MethodPut, "/api/v1/agents/builtin-smart-reasoning"},
		{http.MethodDelete, "/api/v1/agents/a-1"},
		{http.MethodPost, "/api/v1/agents/a-1/shares"},
		{http.MethodGet, "/api/v1/agents/a-1/shares"},
		{http.MethodDelete, "/api/v1/agents/a-1/shares/s-1"},
		{http.MethodGet, "/api/v1/shared-agents"},
		{http.MethodPost, "/api/v1/shared-agents/disabled"},
		{http.MethodGet, "/api/v1/organizations/org-1/agent-shares"},
		{http.MethodGet, "/api/v1/organizations/org-1/shared-agents"},
		// Agent mode and its runtime.
		{http.MethodPost, "/api/v1/agent-chat/sess-1"},
		{http.MethodPost, "/api/v1/agent/tool-approvals/p-1"},
		{http.MethodPost, "/api/v1/agent/mcp-oauth-resolutions/p-1"},
		{http.MethodPost, "/api/v1/agent/mcp-oauth-resolutions/p-1/cancel"},
		{http.MethodPost, "/api/v1/sessions/sess-1/steer"},
		{http.MethodGet, "/api/v1/sessions/sess-1/steer"},
		{http.MethodDelete, "/api/v1/sessions/sess-1/steer/st-1"},
		{http.MethodPost, "/api/v1/sessions/sess-1/steer/st-1/inject"},
		{http.MethodPost, "/api/v1/sessions/sess-1/sandbox/terminal-ticket"},
		{http.MethodPost, "/api/v1/sessions/sess-1/sandbox/desktop-ticket"},
		{http.MethodPost, "/api/v1/sessions/sess-1/sandbox/desktop/activity"},
		{http.MethodGet, "/api/v1/sessions/sess-1/sandbox/terminal"},
		{http.MethodGet, "/api/v1/sessions/sess-1/sandbox/desktop"},
		{http.MethodGet, "/api/v1/sessions/sess-1/local-browser"},
		{http.MethodPost, "/api/v1/sessions/sess-1/local-browser"},
		{http.MethodGet, "/api/v1/local-browser/extension"},
		{http.MethodPost, "/api/v1/local-browser/extension/authorize"},
		{http.MethodPost, "/api/v1/local-browser/internal"},
		{http.MethodGet, "/api/v1/me/browser"},
		{http.MethodPost, "/api/v1/me/browser"},
		{http.MethodGet, "/api/v1/me/browser/extension"},
		// Artifacts.
		{http.MethodGet, "/api/v1/artifacts"},
		{http.MethodGet, "/api/v1/sessions/sess-1/artifacts"},
		{http.MethodGet, "/api/v1/sessions/sess-1/messages/m-1/artifacts"},
		{http.MethodGet, "/api/v1/sessions/sess-1/messages/m-1/artifacts/0/download"},
		// Memory.
		{http.MethodGet, "/api/v1/memory/settings"},
		{http.MethodPut, "/api/v1/memory/settings"},
		{http.MethodGet, "/api/v1/memory/items"},
		{http.MethodPost, "/api/v1/memory/items"},
		{http.MethodDelete, "/api/v1/memory/items/i-1"},
		{http.MethodPost, "/api/v1/memory/topics/t-1/promote"},
		{http.MethodGet, "/api/v1/memory/export"},
		{http.MethodPost, "/api/v1/memory/consolidate"},
		{http.MethodPut, "/api/v1/tenants/kv/memory-config"},
		// IM.
		{http.MethodGet, "/api/v1/im/callback/ch-1"},
		{http.MethodPost, "/api/v1/im/callback/ch-1"},
		{http.MethodPost, "/api/v1/agents/a-1/im-channels"},
		{http.MethodGet, "/api/v1/agents/a-1/im-channels"},
		{http.MethodGet, "/api/v1/im-channels"},
		{http.MethodPut, "/api/v1/im-channels/ch-1"},
		{http.MethodDelete, "/api/v1/im-channels/ch-1"},
		{http.MethodPost, "/api/v1/im-channels/ch-1/toggle"},
		{http.MethodPost, "/api/v1/wechat/qrcode"},
		{http.MethodPost, "/api/v1/wechat/qrcode/status"},
		// Web embedding.
		{http.MethodGet, "/api/v1/embed-frame-policy"},
		{http.MethodPost, "/api/v1/embed/ch-1/exchange"},
		{http.MethodGet, "/api/v1/embed/ch-1/config"},
		{http.MethodPost, "/api/v1/embed/ch-1/knowledge-chat/sess-1"},
		{http.MethodPost, "/api/v1/embed/ch-1/agent-chat/sess-1"},
		{http.MethodGet, "/api/v1/embed/ch-1/files"},
		{http.MethodPost, "/api/v1/agents/a-1/embed-channels"},
		{http.MethodGet, "/api/v1/agents/a-1/embed-channels"},
		{http.MethodGet, "/api/v1/embed-channels"},
		{http.MethodPut, "/api/v1/embed-channels/ch-1"},
		{http.MethodPost, "/api/v1/embed-channels/ch-1/rotate-token"},
		{http.MethodGet, "/api/v1/embed-channels/ch-1/stats"},
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

	// Retained: retrieval Q&A and its history, the quick answer's settings,
	// reading the agent list the chat input resolves the quick answer from,
	// the Kailo MCP publication surface, KB sharing, and the DD-138(6) admin
	// configuration (skills, MCP services, web search, sandboxes, endpoints).
	open := []struct{ method, path string }{
		{http.MethodPost, "/api/v1/knowledge-chat/sess-1"},
		{http.MethodPost, "/api/v1/knowledge-search"},
		{http.MethodPost, "/api/v1/sessions"},
		{http.MethodGet, "/api/v1/sessions"},
		{http.MethodGet, "/api/v1/sessions/sess-1"},
		{http.MethodPost, "/api/v1/sessions/sess-1/stop"},
		{http.MethodGet, "/api/v1/sessions/continue-stream/sess-1"},
		{http.MethodGet, "/api/v1/messages/sess-1/load"},
		{http.MethodGet, "/api/v1/agents"},
		{http.MethodGet, "/api/v1/agents/builtin-quick-answer"},
		{http.MethodPut, "/api/v1/agents/builtin-quick-answer"},
		{http.MethodPost, "/mcp/ep-1"},
		{http.MethodGet, "/api/v1/mcp-endpoints"},
		{http.MethodPost, "/api/v1/mcp-endpoints"},
		{http.MethodGet, "/api/v1/skills"},
		{http.MethodPost, "/api/v1/skills/catalog"},
		{http.MethodGet, "/api/v1/mcp-services"},
		{http.MethodPost, "/api/v1/mcp-services"},
		{http.MethodGet, "/api/v1/web-search-providers"},
		{http.MethodGet, "/api/v1/sandbox-configs"},
		{http.MethodPost, "/api/v1/knowledge-bases/kb-1/shares"},
		{http.MethodGet, "/api/v1/tenants/kv/memory-config"},
		{http.MethodGet, "/api/v1/user/favorites"},
		{http.MethodGet, "/health"},
	}
	for _, tc := range open {
		w := httptest.NewRecorder()
		enabled.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != http.StatusNoContent {
			t.Errorf("Kailo mode %s %s = %d, want pass-through", tc.method, tc.path, w.Code)
		}
	}
}
