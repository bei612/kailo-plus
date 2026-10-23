package middleware

import (
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"

	"github.com/Tencent/WeKnora/internal/config"
)

// kailoClosedRoute is one native route that Kailo mode closes (Kailo DD-133):
// identity is the Kailo OIDC identity, and spaces, members, roles and
// organisations are derived from Kailo membership on every login.
type kailoClosedRoute struct {
	method string
	path   *regexp.Regexp
}

func kailoRoute(method, pattern string) kailoClosedRoute {
	return kailoClosedRoute{method: method, path: regexp.MustCompile("^/api/v1" + pattern + "$")}
}

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
	// Organisations: membership and discovery. Sharing a knowledge base or
	// agent to the Kailo Tenant organisation stays open.
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
}

// IsKailoClosedRoute reports whether Kailo mode closes method+path.
func IsKailoClosedRoute(method, path string) bool {
	for _, route := range kailoClosedRoutes {
		if route.method == method && route.path.MatchString(path) {
			return true
		}
	}
	return false
}

// KailoManagedGuard rejects, in Kailo mode, every native route that would
// create a local credential or change spaces, members, roles or
// organisations outside the Kailo membership projection.
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
