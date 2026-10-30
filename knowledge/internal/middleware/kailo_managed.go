package middleware

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"

	"github.com/Tencent/WeKnora/internal/config"
)

// kailoClosedRoute is one native route that Kailo mode closes (Kailo DD-133):
// identity is the Kailo OIDC identity, and spaces, members, roles and
// organisations are derived from Kailo membership on every login. DD-138(6)
// (design 07 §4.8.5) adds the settings Kailo or the deployment owns: model
// registry writes (models come from Kailo model routing, DD-128), storage and
// parser writes (READ_ONLY admin surfaces) and instance administration.
type kailoClosedRoute struct {
	method string
	path   *regexp.Regexp
}

func kailoRoute(method, pattern string) kailoClosedRoute {
	return kailoClosedRoute{method: method, path: regexp.MustCompile("^/api/v1" + pattern + "$")}
}

// kailoAnyMethod closes every method of a route.
const kailoAnyMethod = "*"

var kailoClosedRoutes = []kailoClosedRoute{
	// Local credentials and self-service accounts.
	kailoRoute(http.MethodPost, `/auth/login`),
	kailoRoute(http.MethodPost, `/auth/register`),
	kailoRoute(http.MethodPost, `/auth/register-by-invite`),
	kailoRoute(http.MethodPost, `/auth/invitations/lookup`),
	kailoRoute(http.MethodPost, `/auth/auto-setup`),
	kailoRoute(http.MethodPost, `/auth/change-password`),
	kailoRoute(http.MethodPost, `/system/admin/users/create`),
	kailoRoute(http.MethodPost, `/system/admin/users/reset-password`),
	// Spaces and their membership.
	kailoRoute(http.MethodPost, `/tenants`),
	kailoRoute(http.MethodDelete, `/tenants/[^/]+`),
	kailoRoute(http.MethodPost, `/tenants/[^/]+/members`),
	kailoRoute(http.MethodPut, `/tenants/[^/]+/members/[^/]+`),
	kailoRoute(http.MethodDelete, `/tenants/[^/]+/members/[^/]+`),
	kailoRoute(http.MethodPost, `/tenants/[^/]+/leave`),
	kailoRoute(http.MethodPost, `/tenants/[^/]+/invitations`),
	kailoRoute(http.MethodDelete, `/tenants/[^/]+/invitations/[^/]+`),
	kailoRoute(http.MethodPost, `/tenants/[^/]+/invite-links`),
	kailoRoute(http.MethodPost, `/me/invitations/[^/]+/accept`),
	kailoRoute(http.MethodPost, `/me/invitations/[^/]+/decline`),
	kailoRoute(http.MethodPost, `/me/invitations/accept-by-token`),
	// Knowledge base shares are a projection of Kailo authorization
	// (DD-164(4)): the directory sync writes them, the page asks Kailo.
	kailoRoute(http.MethodPost, `/knowledge-bases/[^/]+/shares`),
	kailoRoute(http.MethodPut, `/knowledge-bases/[^/]+/shares/[^/]+`),
	kailoRoute(http.MethodDelete, `/knowledge-bases/[^/]+/shares/[^/]+`),
	// Organisations: membership and discovery. Sharing an agent to the Kailo
	// Tenant organisation stays open.
	kailoRoute(http.MethodPost, `/organizations`),
	kailoRoute(http.MethodGet, `/organizations/preview/[^/]+`),
	kailoRoute(http.MethodPost, `/organizations/join`),
	kailoRoute(http.MethodPost, `/organizations/join-request`),
	kailoRoute(http.MethodGet, `/organizations/search`),
	kailoRoute(http.MethodPost, `/organizations/join-by-id`),
	kailoRoute(http.MethodPut, `/organizations/[^/]+`),
	kailoRoute(http.MethodDelete, `/organizations/[^/]+`),
	kailoRoute(http.MethodPost, `/organizations/[^/]+/leave`),
	kailoRoute(http.MethodPost, `/organizations/[^/]+/request-upgrade`),
	kailoRoute(http.MethodPost, `/organizations/[^/]+/invite-code`),
	kailoRoute(http.MethodGet, `/organizations/[^/]+/search-tenants`),
	kailoRoute(http.MethodGet, `/organizations/[^/]+/search-users`),
	kailoRoute(http.MethodPost, `/organizations/[^/]+/invite`),
	kailoRoute(http.MethodPut, `/organizations/[^/]+/members/[^/]+`),
	kailoRoute(http.MethodDelete, `/organizations/[^/]+/members/[^/]+`),
	kailoRoute(http.MethodPut, `/organizations/[^/]+/join-requests/[^/]+/review`),

	// DD-138(6) MODELS, READ_ONLY admin surface `models.catalog`: the model
	// registry is Kailo model routing (DD-128). Creating, editing, deleting
	// and debugging models, upstream cloud credentials and local model
	// downloads are refused. PUT /models/:id/credentials stays routed: it is
	// the DD-128 delivery channel (fork/deploy/provision.py) and the handler
	// admits it only for Kailo-routed models (handler/model_credentials.go).
	// Reading models and choosing among them on a knowledge base or agent stay.
	kailoRoute(http.MethodPost, `/models`),
	kailoRoute(http.MethodPut, `/models/[^/]+`),
	kailoRoute(http.MethodDelete, `/models/[^/]+`),
	kailoRoute(http.MethodPost, `/models/[^/]+/debug`),
	kailoRoute(http.MethodDelete, `/models/[^/]+/credentials/[^/]+`),
	kailoRoute(http.MethodPost, `/weknoracloud/credentials`),
	// Legacy KB initialisation creates or rewrites model rows from raw
	// endpoints and keys; PUT /initialization/config/:kbId (choosing existing
	// models) stays.
	kailoRoute(http.MethodPost, `/initialization/initialize/[^/]+`),
	kailoRoute(http.MethodPost, `/initialization/ollama/models/check`),
	kailoRoute(http.MethodPost, `/initialization/ollama/models/download`),
	kailoRoute(http.MethodPost, `/initialization/remote/check`),
	kailoRoute(http.MethodPost, `/initialization/embedding/test`),
	kailoRoute(http.MethodPost, `/initialization/rerank/check`),
	kailoRoute(http.MethodPost, `/initialization/asr/check`),
	kailoRoute(http.MethodPost, `/initialization/multimodal/test`),

	// DD-138(6) STORAGE, READ_ONLY admin surface `storage.backends`: storage
	// backends, vector stores and the storage engine are deployment-declared.
	kailoRoute(http.MethodPost, `/vector-stores`),
	kailoRoute(http.MethodPost, `/vector-stores/test`),
	kailoRoute(http.MethodPut, `/vector-stores/[^/]+`),
	kailoRoute(http.MethodDelete, `/vector-stores/[^/]+`),
	kailoRoute(http.MethodPost, `/vector-stores/[^/]+/test`),
	kailoRoute(http.MethodPost, `/storage-backends`),
	kailoRoute(http.MethodPost, `/storage-backends/test`),
	kailoRoute(http.MethodPut, `/storage-backends/[^/]+`),
	kailoRoute(http.MethodDelete, `/storage-backends/[^/]+`),
	kailoRoute(http.MethodPost, `/storage-backends/[^/]+/test`),
	kailoRoute(http.MethodPut, `/storage-backends/[^/]+/default`),
	kailoRoute(http.MethodPut, `/tenants/kv/storage-engine-config`),
	kailoRoute(http.MethodPost, `/system/storage-engine-check`),

	// DD-138(6) INDEXING, READ_ONLY admin surface `indexing.parsers`: parser
	// engines and the document reader are deployment-declared.
	kailoRoute(http.MethodPut, `/tenants/kv/parser-engine-config`),
	kailoRoute(http.MethodPost, `/system/parser-engines/check`),
	kailoRoute(http.MethodPost, `/system/docreader/reconnect`),

	// DD-138(6) with DD-163 (design 07 §4.8.5 ownership table, §4.8.8): answer
	// skills (and the sandboxes they install into) and MCP services serve only
	// the agent mode Kailo mode closes (kailo_converge.go), so they are not
	// admin surfaces and their writes are refused. Reads stay. The MCP
	// publication endpoints (/mcp-endpoints, /mcp/:endpoint_id) are Kailo's
	// publication surface (08 §5) and stay open.
	kailoRoute(http.MethodPost, `/skills/catalog`),
	kailoRoute(http.MethodPost, `/skills/catalog/[^/]+/install`),
	kailoRoute(http.MethodDelete, `/skills/catalog/[^/]+`),
	kailoRoute(http.MethodPost, `/sandbox-configs`),
	kailoRoute(http.MethodPut, `/sandbox-configs/[^/]+`),
	kailoRoute(http.MethodDelete, `/sandbox-configs/[^/]+`),
	kailoRoute(http.MethodPost, `/sandbox-configs/templates/query`),
	kailoRoute(http.MethodPost, `/sandbox-configs/[^/]+/skills(?:/.*)?`),
	kailoRoute(http.MethodPatch, `/sandbox-configs/[^/]+/skills/.+`),
	kailoRoute(http.MethodDelete, `/sandbox-configs/[^/]+/skills/.+`),
	kailoRoute(http.MethodPost, `/system/sandbox-check`),
	kailoRoute(http.MethodPost, `/mcp-services`),
	kailoRoute(http.MethodPut, `/mcp-services/[^/]+`),
	kailoRoute(http.MethodDelete, `/mcp-services/[^/]+`),
	kailoRoute(http.MethodPost, `/mcp-services/[^/]+/test`),
	kailoRoute(http.MethodPost, `/mcp-services/[^/]+/metadata/refresh`),
	kailoRoute(http.MethodPost, `/mcp-services/[^/]+/usage-instructions/generate`),
	kailoRoute(http.MethodPut, `/mcp-services/[^/]+/credentials`),
	kailoRoute(http.MethodDelete, `/mcp-services/[^/]+/credentials/[^/]+`),
	kailoRoute(http.MethodPut, `/mcp-services/[^/]+/tool-approvals/[^/]+`),
	kailoRoute(http.MethodPost, `/mcp-services/[^/]+/oauth/authorize-url`),
	kailoRoute(http.MethodDelete, `/mcp-services/[^/]+/oauth/token`),

	// DD-138(6) instance administration is not an admin surface: system
	// administrators, global runtime settings, runtime queues, platform API
	// keys and the platform audit feed are closed outright; workspace API
	// keys and API principals (credentials minted outside Kailo SecretRefs)
	// and the workspace audit feed likewise.
	kailoRoute(kailoAnyMethod, `/system/admin/.+`),
	kailoRoute(http.MethodPost, `/tenants/[^/]+/api-keys`),
	kailoRoute(http.MethodPut, `/tenants/[^/]+/api-keys/[^/]+`),
	kailoRoute(http.MethodDelete, `/tenants/[^/]+/api-keys/[^/]+`),
	kailoRoute(http.MethodPut, `/tenants/[^/]+/api-principal-config`),
	kailoRoute(http.MethodPost, `/tenants/[^/]+/api-principal-test-token`),
	kailoRoute(http.MethodGet, `/tenants/[^/]+/audit-log`),
}

// IsKailoClosedRoute reports whether Kailo mode closes method+path.
func IsKailoClosedRoute(method, path string) bool {
	for _, route := range kailoClosedRoutes {
		if (route.method == kailoAnyMethod || route.method == method) && route.path.MatchString(path) {
			return true
		}
	}
	return false
}

// KailoManagedGuard rejects, in Kailo mode, every native route that would
// create a local credential or change spaces, members, roles or
// organisations outside the Kailo membership projection, and (DD-138(6))
// every write to settings Kailo or the deployment owns.
func KailoManagedGuard(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.KailoEnabled() || !IsKailoClosedRoute(c.Request.Method, c.Request.URL.Path) {
			c.Next()
			return
		}
		c.JSON(http.StatusForbidden, gin.H{
			"error": "Managed by Kailo",
			"code":  "KAILO_MANAGED",
		})
		c.Abort()
	}
}
