package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/config"
)

func (f *nativeOIDCFixture) beginSilent() (*http.Cookie, string, *url.URL) {
	f.t.Helper()
	r := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid"+KailoOIDCLoginPath+"?prompt=none", nil).WithContext(f.ctx)
	w := httptest.NewRecorder()
	NativeKailoOIDC(w, r)
	if w.Code != http.StatusFound {
		f.t.Fatalf("silent login returned %d: %s", w.Code, w.Body.String())
	}
	location, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		f.t.Fatal(err)
	}
	cookies := w.Result().Cookies()
	if len(cookies) != 1 {
		f.t.Fatal("silent login omitted its browser transaction")
	}
	f.nonce = location.Query().Get("nonce")
	store, err := nativeOIDCStore(f.ctx, f.connector)
	if err != nil {
		f.t.Fatal(err)
	}
	saved := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid"+KailoOIDCCallbackPath, nil)
	saved.AddCookie(cookies[0])
	session, err := store.Get(saved, kailoOIDCCookie)
	if err != nil || session.Values["silent"] != true {
		f.t.Fatal("silent transaction not recorded")
	}
	f.verifier, _ = session.Values["verifier"].(string)
	return cookies[0], location.Query().Get("state"), location
}

func (f *nativeOIDCFixture) callbackQuery(cookie *http.Cookie, query url.Values) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid"+KailoOIDCCallbackPath+"?"+query.Encode(), nil).WithContext(f.ctx)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	NativeKailoOIDC(w, r)
	return w
}

// DD-133 §2: inside a Kailo frame the OIDC login is silent; no IdP session
// asks the Kailo host to sign in at top level, never a form or popup here.
func TestKailoSilentLoginWithoutIdPSession(t *testing.T) {
	t.Setenv("KAILO_FRAME_ANCESTORS", "http://kailo.example.invalid:58090")
	f := newNativeOIDCFixture(t)
	cookie, state, location := f.beginSilent()
	if location.Query().Get("prompt") != "none" {
		t.Fatalf("silent login did not ask the IdP for prompt=none: %s", location)
	}
	w := f.callbackQuery(cookie, url.Values{"state": {state}, "error": {"login_required"}})
	body := w.Body.String()
	if w.Code != http.StatusOK || f.exchanges != 0 || f.nativeCodes != 0 || !strings.Contains(body, "kailo.native.auth-required") ||
		!strings.Contains(body, `["http://kailo.example.invalid:58090"]`) || strings.Contains(strings.ToLower(body), "password") {
		t.Fatalf("silent login_required: status=%d body=%s", w.Code, body)
	}
	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "frame-ancestors 'self' http://kailo.example.invalid:58090") || !strings.Contains(csp, "script-src 'nonce-") {
		t.Fatalf("auth-required page policy: %s", csp)
	}
	// The answer clears the browser transaction.
	var cleared bool
	for _, c := range w.Result().Cookies() {
		cleared = cleared || (c.Name == kailoOIDCCookie && c.MaxAge < 0)
	}
	if !cleared {
		t.Fatal("silent transaction cookie kept")
	}
}

func TestKailoSilentLoginRefusals(t *testing.T) {
	f := newNativeOIDCFixture(t)
	// An interactive transaction never turns an IdP error into the host page.
	cookie, state := f.begin()
	if w := f.callbackQuery(cookie, url.Values{"state": {state}, "error": {"login_required"}}); w.Code != http.StatusUnauthorized {
		t.Fatalf("interactive IdP error: %d", w.Code)
	}
	// A silent answer for another browser transaction is refused.
	cookie, _, _ = f.beginSilent()
	if w := f.callbackQuery(cookie, url.Values{"state": {"other-browser-state"}, "error": {"login_required"}}); w.Code != http.StatusUnauthorized {
		t.Fatalf("foreign silent state: %d", w.Code)
	}
	// Other IdP errors stay errors.
	cookie, state, _ = f.beginSilent()
	if w := f.callbackQuery(cookie, url.Values{"state": {state}, "error": {"access_denied"}}); w.Code != http.StatusUnauthorized {
		t.Fatalf("silent access_denied: %d", w.Code)
	}
	// With an IdP session the silent login completes like the interactive one.
	cookie, state, _ = f.beginSilent()
	if w := f.callbackQuery(cookie, url.Values{"state": {state}, "code": {"one-use-code"}}); w.Code != http.StatusSeeOther || f.nativeCodes != 1 {
		t.Fatalf("silent login with an IdP session: %d", w.Code)
	}
}

func TestKailoTenantOutsiderRefused(t *testing.T) {
	f := newNativeOIDCFixture(t)
	f.subject, f.preferredUsername = "outsider-subject", "outsider"
	f.connector.Config.ProvisionUsers, f.connector.Config.ProvisionProfile = true, "standard"
	f.connector.Config.Organization = &auth.NativeOIDCOrganization{TenantClaim: "kailo_tenant",
		Tenants: []auth.NativeOIDCTenant{{ID: "tenant-a", Name: "Tenant A"}, {ID: "tenant-b", Name: "Tenant B"}}}
	if err := config.Set(f.ctx, []kailoOIDCConnector{f.connector}, "services", "pydio.web.oauth", "connectors"); err != nil {
		t.Fatal(err)
	}
	cookie, state := f.begin()
	if w := f.callback(cookie, state); w.Code != http.StatusForbidden || f.creates != 0 || f.nativeCodes != 0 {
		t.Fatalf("identity outside the declared Tenants: status=%d creates=%d", w.Code, f.creates)
	}
}

// DD-133 §2: the IdP front-channel logout ends this browser's native session.
func TestKailoFrontChannelLogout(t *testing.T) {
	t.Setenv("KAILO_FRAME_ANCESTORS", "http://kailo.example.invalid:58090")
	f := newNativeOIDCFixture(t)
	get := func(query string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid"+KailoOIDCLogoutPath+query, nil).WithContext(f.ctx)
		w := httptest.NewRecorder()
		NativeKailoOIDCLogout(w, r)
		return w
	}
	for _, query := range []string{"?iss=" + url.QueryEscape("https://other-idp.example.invalid"), "?iss=a&iss=b", "?sid=a&sid=b"} {
		if w := get(query); w.Code != http.StatusBadRequest {
			t.Fatalf("%s accepted: %d", query, w.Code)
		}
	}
	w := get("?iss=" + url.QueryEscape(f.issuer.URL) + "&sid=idp-session")
	csp := w.Header().Get("Content-Security-Policy")
	if w.Code != http.StatusOK || !strings.Contains(csp, "frame-ancestors 'self' "+f.issuer.URL+" http://kailo.example.invalid:58090") ||
		!strings.Contains(w.Body.String(), `AuthInfo:{type:"logout"}`) || !strings.Contains(w.Body.String(), "kailo.native.logged-out") ||
		w.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("front-channel logout page: %d %s %s", w.Code, csp, w.Body.String())
	}
	r := httptest.NewRequest(http.MethodPost, "https://cells.example.invalid"+KailoOIDCLogoutPath, nil).WithContext(f.ctx)
	r.AddCookie(&http.Cookie{Name: "pydio", Value: "native-session"})
	post := httptest.NewRecorder()
	NativeKailoOIDCLogout(post, r)
	var expired bool
	for _, c := range post.Result().Cookies() {
		expired = expired || (c.Name == "pydio" && c.MaxAge < 0 && strings.HasSuffix(c.Path, "/frontend"))
	}
	if post.Code != http.StatusNoContent || !expired {
		t.Fatalf("native session cookie not expired: %d %v", post.Code, post.Result().Cookies())
	}
	foreign := httptest.NewRequest(http.MethodGet, "https://other.example.invalid"+KailoOIDCLogoutPath, nil).WithContext(f.ctx)
	if w := httptest.NewRecorder(); func() int { NativeKailoOIDCLogout(w, foreign); return w.Code }() != http.StatusBadRequest {
		t.Fatal("logout served on another host")
	}
}

func TestKailoEmbedParameters(t *testing.T) {
	t.Setenv("KAILO_FRAME_ANCESTORS", "http://kailo.example.invalid:58090 tauri://localhost")
	t.Setenv("PLATFORM_DISPLAY_NAME", "Kailo")
	f := newNativeOIDCFixture(t)
	f.connector.Config.PlatformLogoutURL = "http://kailo.example.invalid:58090/app/?signout=1"
	if err := config.Set(f.ctx, []kailoOIDCConnector{f.connector}, "services", "pydio.web.oauth", "connectors"); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid/", nil).WithContext(f.ctx)
	p := nativeKailoEmbedParameters(r)
	titles := p["titles"].(map[string]string)
	origins := p["origins"].([]string)
	if titles["zh-cn"] != "Kailo 云盘" || titles["en-us"] != "Kailo Files" || len(origins) != 2 || origins[0] != "http://kailo.example.invalid:58090" ||
		p["sso"] != true || p["logoutUrl"] != f.connector.Config.PlatformLogoutURL || p["component"] != "file_storage" {
		t.Fatalf("unexpected embedding parameters: %v", p)
	}
	for _, field := range []string{"clientId", "issuer", "users", "secret"} {
		if _, ok := p[field]; ok {
			t.Fatalf("connector field %s exposed", field)
		}
	}
	for _, bad := range []string{"javascript:alert(1)", "/relative", "https://user:pw@kailo.example.invalid/"} {
		c := f.connector
		c.Config.PlatformLogoutURL = bad
		if c.validate("https://cells.example.invalid") == nil {
			t.Fatalf("platform logout URL %q accepted", bad)
		}
	}
	t.Setenv("PLATFORM_DISPLAY_NAME", "bad\nname")
	t.Setenv("KAILO_FRAME_ANCESTORS", "*")
	p = nativeKailoEmbedParameters(r)
	if p["titles"].(map[string]string)["zh-cn"] != "云盘" || len(p["origins"].([]string)) != 0 {
		t.Fatalf("unsafe deployment values used: %v", p)
	}
	head := string(kailoHead("v1&x"))
	for _, want := range []string{"plug/kailo.embed/kailo-theme-tokens.css?v=v1%26x", "plug/kailo.embed/kailo-overlay.css?v=v1%26x", "plug/kailo.embed/kailo-cells.js?v=v1%26x"} {
		if !strings.Contains(head, want) {
			t.Fatalf("head lacks %s: %s", want, head)
		}
	}
}
