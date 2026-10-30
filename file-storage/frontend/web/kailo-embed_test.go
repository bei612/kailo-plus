package web

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

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
	if w.Code != http.StatusOK || f.exchanges != 0 || f.nativeCodes != 0 || !strings.Contains(body, "requestTopLevelSignIn()") ||
		!strings.Contains(body, `<meta name="kailo-web-origin" content="http://kailo.example.invalid:58090">`) ||
		!strings.Contains(body, "kailo.embed/kailo-embed.js") || strings.Contains(strings.ToLower(body), "password") {
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
	t.Setenv("KAILO_FRAME_ANCESTORS", "http://kailo.example.invalid:58090 tauri://localhost")
	head := string(kailoHead("v1&x"))
	// Root-absolute: the head precedes <base> and the page is also served at
	// nested paths such as /login/callback.
	order := []string{`<meta name="kailo-web-origin" content="http://kailo.example.invalid:58090">`,
		`<meta name="kailo-embed-features" content="page toast confirm shortcuts prompt">`, `"/plug/kailo.embed/kailo-theme-tokens.css?v=v1%26x"`,
		`"/plug/kailo.embed/kailo-overlay.css?v=v1%26x"`, `"/plug/kailo.embed/kailo-embed.js?v=v1%26x"`, `"/plug/kailo.embed/kailo-cells.js?v=v1%26x"`}
	last := -1
	for _, want := range order {
		at := strings.Index(head, want)
		if at <= last {
			t.Fatalf("head lacks %s in 07 §4.7.1 order: %s", want, head)
		}
		last = at
	}
}
