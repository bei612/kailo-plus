package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/config/routing"
)

// DD-138(6), design 07 §4.8.5 (V-SCN-270): in Kailo mode the native admin
// console is closed on the server before any page is served; only declared
// admin surface paths carrying their own key are served.
func TestKailoNativeConsoleClosed(t *testing.T) {
	mode := auth.NativeKailoMode
	t.Cleanup(func() { auth.NativeKailoMode = mode })
	auth.NativeKailoMode = func() bool { return true }

	closed := []string{
		"/settings",
		"/settings/",
		"/settings/data/datasources",
		"/settings/idm/users?x=1",
		"/ws-settings/admin/logs",
		"/%73ettings/parameters",
		"/kailo-admin",
		"/kailo-admin/",
		"/kailo-admin/data-sources",
		"/kailo-admin/data-sources?kailo_admin_surface=",
		"/kailo-admin/data-sources?kailo_admin_surface=files.metadata",
		"/kailo-admin/data-sources?kailo_admin_surface=storage.dataSources&kailo_admin_surface=storage.dataSources",
		"/kailo-admin/data-sources?kailo_admin_surface=Storage.dataSources",
		"/kailo-admin/data-sources?kailo_admin_surface=storage",
		"/kailo-admin/data-sources/?kailo_admin_surface=storage.dataSources",
		"/kailo-admin/data-sources/x?kailo_admin_surface=storage.dataSources",
		"/kailo-admin/metadata?kailo_admin_surface=storage.dataSources",
		"/kailo-admin/users?kailo_admin_surface=members.users",
		"/kailo-admin/metadata?kailo_admin_surface=files.metadata;x",
	}
	for _, target := range closed {
		w := httptest.NewRecorder()
		if !kailoAdminRedirect(w, httptest.NewRequest(http.MethodGet, target, nil)) {
			t.Fatalf("%s was served", target)
		}
		if w.Code != http.StatusFound || w.Header().Get("Location") != "/" {
			t.Fatalf("%s -> %d %q, want 302 /", target, w.Code, w.Header().Get("Location"))
		}
	}

	served := []string{
		"/",
		"/ws-personal-files/folder",
		"/welcome",
		"/directory",
		"/login/callback?code=x",
		"/settingsx",
		"/my-settings/a",
		"/kailo-admin/data-sources?kailo_admin_surface=storage.dataSources",
		"/kailo-admin/data-sources?kailo_theme=dark&kailo_locale=en&kailo_admin_surface=storage.dataSources",
		"/kailo-admin/metadata?kailo_admin_surface=files.metadata&kailo_theme=light",
	}
	for _, target := range served {
		w := httptest.NewRecorder()
		if kailoAdminRedirect(w, httptest.NewRequest(http.MethodGet, target, nil)) {
			t.Fatalf("%s was redirected", target)
		}
	}
}

// The catch-all route rewrites the request to "/" before the index handler;
// the guard decides on the path the browser asked for.
func TestKailoNativeConsoleClosedAfterCatchAllRewrite(t *testing.T) {
	mode := auth.NativeKailoMode
	t.Cleanup(func() { auth.NativeKailoMode = mode })
	auth.NativeKailoMode = func() bool { return true }

	r := httptest.NewRequest(http.MethodGet, "/?kailo_admin_surface=storage.dataSources", nil)
	r = r.WithContext(routing.WithCatchAllRequestedPath(r.Context(), "/settings/data/datasources"))
	if w := httptest.NewRecorder(); !kailoAdminRedirect(w, r) || w.Code != http.StatusFound {
		t.Fatal("rewritten console request was served")
	}
	r = httptest.NewRequest(http.MethodGet, "/?kailo_admin_surface=storage.dataSources", nil)
	r = r.WithContext(routing.WithCatchAllRequestedPath(r.Context(), "/kailo-admin/data-sources"))
	if kailoAdminRedirect(httptest.NewRecorder(), r) {
		t.Fatal("rewritten declared surface request was redirected")
	}
	// Index handler: the redirect happens before any plugin or template work.
	h := &IndexHandler{}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/settings", nil))
	if w.Code != http.StatusFound || w.Header().Get("Location") != "/" {
		t.Fatalf("index served the console: %d", w.Code)
	}
}

func TestKailoNativeConsoleOutsideKailoMode(t *testing.T) {
	mode := auth.NativeKailoMode
	t.Cleanup(func() { auth.NativeKailoMode = mode })
	auth.NativeKailoMode = func() bool { return false }
	for _, target := range []string{"/settings/data/datasources", "/kailo-admin/data-sources"} {
		if kailoAdminRedirect(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, target, nil)) {
			t.Fatalf("%s redirected outside Kailo mode", target)
		}
	}
}

// The server allowlist is the release declaration (fork/release/manifest.native-page.json).
func TestKailoAdminSurfacesMatchReleaseManifest(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "fork", "release", "manifest.native-page.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		FrontendPresentationContract struct {
			AdminSurfaces []struct {
				Key  string `json:"key"`
				Path string `json:"path"`
			} `json:"adminSurfaces"`
		} `json:"frontendPresentationContract"`
	}
	if err := json.Unmarshal(raw, &manifest); err != nil {
		t.Fatal(err)
	}
	declared := map[string]string{}
	for _, s := range manifest.FrontendPresentationContract.AdminSurfaces {
		declared[s.Path] = s.Key
	}
	if !reflect.DeepEqual(declared, kailoAdminSurfaces) {
		t.Fatalf("manifest adminSurfaces %v != server allowlist %v", declared, kailoAdminSurfaces)
	}
}
