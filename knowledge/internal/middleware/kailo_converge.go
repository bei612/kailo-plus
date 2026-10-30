package middleware

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"

	"github.com/Tencent/WeKnora/internal/config"
)

// Kailo DD-163 (design 07 §4.8.8): collaboration and AI exist once, in
// Kailo. In Kailo mode this knowledge service keeps retrieval-based Q&A
// (the built-in quick answer) as its core business and closes the native
// features that duplicate Kailo's Agent, memory, IM and embedding:
//
//   - custom agents and their sharing (Kailo Agent + knowledge tools);
//   - agent mode and its runtime: agent-chat, steer, tool approvals, MCP
//     OAuth resolution, sandbox terminal/desktop, local browser, artifacts;
//   - long-term memory (Kailo Agent memory, design 19);
//   - IM integrations and web embedding (Kailo channels, DMs and the
//     third-party access surface).
//
// The guard is mounted on the engine before any route is registered, so it
// also covers the routes registered ahead of the global Auth middleware (IM
// callbacks, embed public routes, sandbox WebSockets, local browser).
// Instance configuration of skills, MCP services, web search and sandboxes
// belongs to DD-138(6) admin surfaces and is not listed here; the Kailo MCP
// publication surface /mcp/:endpoint_id stays (08 §5).

// kailoConvergeAnyMethod closes every method of a route.
const kailoConvergeAnyMethod = "*"

type kailoConvergeRoute struct {
	method string
	path   *regexp.Regexp
}

func convergeRoute(method, pattern string) kailoConvergeRoute {
	return kailoConvergeRoute{method: method, path: regexp.MustCompile("^/api/v1" + pattern + "$")}
}

const kailoConvergeID = `[^/]+`

var kailoConvergeClosedRoutes = []kailoConvergeRoute{
	// Custom agents: creating, copying and deleting are closed; editing is
	// closed except for the built-in quick answer, whose answer settings
	// (projected chat model, retrieval scope, web search) are business
	// settings of the retained Q&A.
	convergeRoute(http.MethodPost, `/agents`),
	convergeRoute(http.MethodPost, `/agents/`+kailoConvergeID+`/copy`),
	convergeRoute(http.MethodDelete, `/agents/`+kailoConvergeID),
	// (PUT on the quick answer is let through by IsKailoConvergeClosedRoute.)
	convergeRoute(http.MethodPut, `/agents/`+kailoConvergeID),
	// Agent sharing.
	convergeRoute(kailoConvergeAnyMethod, `/agents/`+kailoConvergeID+`/shares(?:/.*)?`),
	convergeRoute(kailoConvergeAnyMethod, `/shared-agents(?:/.*)?`),
	convergeRoute(http.MethodGet, `/organizations/`+kailoConvergeID+`/agent-shares`),
	convergeRoute(http.MethodGet, `/organizations/`+kailoConvergeID+`/shared-agents`),

	// Agent mode and its runtime.
	convergeRoute(kailoConvergeAnyMethod, `/agent-chat(?:/.*)?`),
	convergeRoute(kailoConvergeAnyMethod, `/agent/.+`),
	convergeRoute(kailoConvergeAnyMethod, `/sessions/`+kailoConvergeID+`/steer(?:/.*)?`),
	convergeRoute(kailoConvergeAnyMethod, `/sessions/`+kailoConvergeID+`/sandbox/.+`),
	convergeRoute(kailoConvergeAnyMethod, `/sessions/`+kailoConvergeID+`/local-browser`),
	convergeRoute(kailoConvergeAnyMethod, `/local-browser/.+`),
	convergeRoute(kailoConvergeAnyMethod, `/me/browser(?:/.*)?`),
	// Artifacts (files produced by agent and sandbox runs).
	convergeRoute(kailoConvergeAnyMethod, `/artifacts(?:/.*)?`),
	convergeRoute(kailoConvergeAnyMethod, `/sessions/`+kailoConvergeID+`/artifacts(?:/.*)?`),
	convergeRoute(kailoConvergeAnyMethod, `/sessions/`+kailoConvergeID+`/messages/`+kailoConvergeID+`/artifacts(?:/.*)?`),

	// Long-term memory and the workspace memory switch.
	convergeRoute(kailoConvergeAnyMethod, `/memory(?:/.*)?`),
	convergeRoute(http.MethodPut, `/tenants/kv/memory-config`),

	// IM integrations: public callbacks and channel management.
	convergeRoute(kailoConvergeAnyMethod, `/im/.+`),
	convergeRoute(kailoConvergeAnyMethod, `/agents/`+kailoConvergeID+`/im-channels(?:/.*)?`),
	convergeRoute(kailoConvergeAnyMethod, `/im-channels(?:/.*)?`),
	convergeRoute(kailoConvergeAnyMethod, `/wechat/.+`),

	// Web embedding: public embed API, frame policy and channel management.
	convergeRoute(kailoConvergeAnyMethod, `/embed-frame-policy`),
	convergeRoute(kailoConvergeAnyMethod, `/embed/.+`),
	convergeRoute(kailoConvergeAnyMethod, `/agents/`+kailoConvergeID+`/embed-channels(?:/.*)?`),
	convergeRoute(kailoConvergeAnyMethod, `/embed-channels(?:/.*)?`),
}

// KailoQuickAnswerAgentID is the only agent Kailo mode answers with
// (types.BuiltinQuickAnswerID; repeated here to keep middleware free of the
// types package).
const KailoQuickAnswerAgentID = "builtin-quick-answer"

// IsKailoConvergeClosedRoute reports whether Kailo mode closes method+path
// under DD-163.
func IsKailoConvergeClosedRoute(method, path string) bool {
	if method == http.MethodPut && path == "/api/v1/agents/"+KailoQuickAnswerAgentID {
		return false
	}
	for _, route := range kailoConvergeClosedRoutes {
		if (route.method == kailoConvergeAnyMethod || route.method == method) && route.path.MatchString(path) {
			return true
		}
	}
	return false
}

// KailoConvergeGuard rejects, in Kailo mode, every native route that DD-163
// closes. It is mounted on the engine so pre-Auth routes are covered too.
func KailoConvergeGuard(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.KailoEnabled() || !IsKailoConvergeClosedRoute(c.Request.Method, c.Request.URL.Path) {
			c.Next()
			return
		}
		AbortKailoManaged(c)
	}
}

// AbortKailoManaged writes the Kailo-mode refusal shared with KailoManagedGuard.
func AbortKailoManaged(c *gin.Context) {
	c.JSON(http.StatusForbidden, gin.H{
		"error": "Managed by Kailo",
		"code":  "KAILO_MANAGED",
	})
	c.Abort()
}
