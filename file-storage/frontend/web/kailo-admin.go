package web

// Kailo admin surfaces of the native console (DD-138(6), design 07 §4.8.5).
//
// In Kailo mode the native admin console is not a product anyone can reach:
// before any page is served, a request for the console (the settings
// workspace, at /settings or any path the React router resolves to that
// slug) is sent to the business home. The only admin pages left are the
// admin surfaces declared in fork/release/manifest.native-page.json
// (frontendPresentationContract.adminSurfaces), each at its fixed path and
// served only when the launch carries the matching kailo_admin_surface key.
// The key selects what is rendered; it is not authorization: the native REST
// policies still decide from the directory-derived admin profile, and the
// storage writes of the read-only surface are refused server-side
// (common/auth/native-kailo-admin.go).
import (
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/config/routing"
)

const (
	// KailoAdminSurfaceParam is the launch parameter Kailo adds to an admin surface path.
	KailoAdminSurfaceParam = "kailo_admin_surface"
	kailoAdminSegment      = "kailo-admin"
	kailoBusinessHome      = "/"
	// The native console workspace (common.IdmWsInternalSettingsID slug).
	nativeSettingsSlug = "settings"
)

// kailoAdminSurfaces is the fixed allowlist: declared path -> declared key.
// It must equal adminSurfaces of fork/release/manifest.native-page.json and
// KAILO_ADMIN_SURFACES of frontend/assets/kailo.embed/kailo-cells.js.
var kailoAdminSurfaces = map[string]string{
	"/kailo-admin/data-sources": "storage.dataSources",
	"/kailo-admin/metadata":     "files.metadata",
}

// Same shape as a Kailo preference key (07 §4.8.2): 2-4 lowerCamel segments.
var kailoAdminSurfaceKey = regexp.MustCompile(`^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,3}$`)

// kailoRequestedPath is the path the browser asked for: the catch-all route
// rewrites the request to "/" before the index handler runs.
func kailoRequestedPath(r *http.Request) string {
	if p := routing.CatchAllRequestedPath(r.Context()); p != "" {
		return p
	}
	return r.URL.Path
}

// kailoFirstSegment is the first path segment ("" for "/").
func kailoFirstSegment(p string) string {
	p = strings.TrimLeft(p, "/")
	if i := strings.Index(p, "/"); i >= 0 {
		p = p[:i]
	}
	return p
}

// kailoNativeConsoleSegment mirrors the React WorkspaceRouter, which drops the
// first "ws-" of the segment before matching a workspace slug.
func kailoNativeConsoleSegment(segment string) bool {
	return strings.Replace(segment, "ws-", "", 1) == nativeSettingsSlug
}

// KailoAdminSurfaceFor returns the declared key for a surface path and launch
// query, or "" when the path is not declared or the key is missing, repeated,
// malformed or declared for another path.
func KailoAdminSurfaceFor(path, rawQuery string) string {
	declared, ok := kailoAdminSurfaces[path]
	if !ok {
		return ""
	}
	values, err := url.ParseQuery(rawQuery)
	if err != nil {
		return ""
	}
	keys := values[KailoAdminSurfaceParam]
	if len(keys) != 1 || len(keys[0]) > 64 || !kailoAdminSurfaceKey.MatchString(keys[0]) || keys[0] != declared {
		return ""
	}
	return declared
}

// kailoAdminClosed reports whether, in Kailo mode, this page request targets
// the native console or an undeclared admin surface.
func kailoAdminClosed(r *http.Request) bool {
	if !auth.NativeKailoMode() {
		return false
	}
	requested := kailoRequestedPath(r)
	segment := kailoFirstSegment(requested)
	if kailoNativeConsoleSegment(segment) {
		return true
	}
	if segment == kailoAdminSegment {
		return KailoAdminSurfaceFor(requested, r.URL.RawQuery) == ""
	}
	return false
}

// kailoAdminRedirect sends a closed admin request to the business home and
// reports whether it did; the caller then serves nothing else.
func kailoAdminRedirect(w http.ResponseWriter, r *http.Request) bool {
	if !kailoAdminClosed(r) {
		return false
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, kailoBusinessHome, http.StatusFound)
	return true
}
