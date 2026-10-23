package web

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v3"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/config"
)

func (f *nativeOIDCFixture) logoutToken(t *testing.T, change func(map[string]any), alg jose.SignatureAlgorithm, key any) string {
	t.Helper()
	claims := map[string]any{"iss": f.issuer.URL, "aud": f.connector.Config.ClientID, "iat": time.Now().Unix(), "exp": time.Now().Add(2 * time.Minute).Unix(),
		"jti": "jti-" + time.Now().Format(time.RFC3339Nano), "sid": "idp-sid-1", "sub": f.subject,
		"events": map[string]any{"http://schemas.openid.net/event/backchannel-logout": map[string]any{}}}
	if change != nil {
		change(claims)
	}
	payload, _ := json.Marshal(claims)
	if key == nil {
		key = jose.JSONWebKey{Key: f.key, KeyID: "fixture-key"}
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: alg, Key: key}, nil)
	if err != nil {
		t.Fatal(err)
	}
	signed, err := signer.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := signed.CompactSerialize()
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func postLogout(f *nativeOIDCFixture, contentType, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "https://cells.example.invalid"+KailoOIDCBackchannelLogoutPath, strings.NewReader(body)).WithContext(f.ctx)
	r.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	NativeKailoOIDCBackchannelLogout(w, r)
	return w
}

func withBackchannel(t *testing.T, f *nativeOIDCFixture) {
	t.Helper()
	store := filepath.Join(t.TempDir(), "kailo", "oidc-sessions.json")
	previous := auth.NativeOIDCSessionStorePath
	auth.NativeOIDCSessionStorePath = func() string { return store }
	t.Cleanup(func() { auth.NativeOIDCSessionStorePath = previous })
	f.connector.Config.BackchannelLogout = &kailoBackchannelConfig{SessionMaxAgeSeconds: 3600, LogoutTokenMaxAgeSeconds: 120}
	if err := config.Set(f.ctx, []kailoOIDCConnector{f.connector}, "services", "pydio.web.oauth", "connectors"); err != nil {
		t.Fatal(err)
	}
}

// 07 §4.7.5: a verified logout_token of the IdP SSO session ends the native
// sessions the Kailo login opened; tokens of an ended session are refused.
func TestKailoBackchannelLogoutEndsTheLoginSession(t *testing.T) {
	f := newNativeOIDCFixture(t)
	withBackchannel(t, f)
	f.idpSession = "idp-sid-1"
	cookie, state := f.begin()
	if w := f.callback(cookie, state); w.Code != http.StatusSeeOther {
		t.Fatalf("login: %d %s", w.Code, w.Body.String())
	}
	if auth.NativeOIDCSessionEnded("native-session") {
		t.Fatal("fresh native session reported ended")
	}
	form := "application/x-www-form-urlencoded"
	foreign := f.logoutToken(t, func(c map[string]any) { c["sid"] = "another-idp-session" }, jose.RS256, nil)
	if w := postLogout(f, form, url.Values{"logout_token": {foreign}}.Encode()); w.Code != http.StatusOK || auth.NativeOIDCSessionEnded("native-session") {
		t.Fatalf("another IdP session ended this one: %d", w.Code)
	}
	token := f.logoutToken(t, nil, jose.RS256, nil)
	w := postLogout(f, form, url.Values{"logout_token": {token}}.Encode())
	if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" || !auth.NativeOIDCSessionEnded("native-session") {
		t.Fatalf("logout: %d ended=%v", w.Code, auth.NativeOIDCSessionEnded("native-session"))
	}
	if w := postLogout(f, form, url.Values{"logout_token": {token}}.Encode()); w.Code != http.StatusBadRequest {
		t.Fatalf("replayed jti accepted: %d", w.Code)
	}
}

func TestKailoBackchannelLogoutWithoutSidEndsTheSubject(t *testing.T) {
	f := newNativeOIDCFixture(t)
	withBackchannel(t, f)
	cookie, state := f.begin()
	if w := f.callback(cookie, state); w.Code != http.StatusSeeOther {
		t.Fatalf("login: %d", w.Code)
	}
	token := f.logoutToken(t, func(c map[string]any) { delete(c, "sid") }, jose.RS256, nil)
	if w := postLogout(f, "application/x-www-form-urlencoded; charset=utf-8", url.Values{"logout_token": {token}}.Encode()); w.Code != http.StatusOK || !auth.NativeOIDCSessionEnded("native-session") {
		t.Fatalf("sub-only logout: %d", w.Code)
	}
}

func TestKailoBackchannelLogoutRefusals(t *testing.T) {
	f := newNativeOIDCFixture(t)
	withBackchannel(t, f)
	form := "application/x-www-form-urlencoded"
	cases := map[string]string{
		"nonce":        f.logoutToken(t, func(c map[string]any) { c["nonce"] = "n" }, jose.RS256, nil),
		"no-event":     f.logoutToken(t, func(c map[string]any) { delete(c, "events") }, jose.RS256, nil),
		"other-event":  f.logoutToken(t, func(c map[string]any) { c["events"] = map[string]any{"urn:other": map[string]any{}} }, jose.RS256, nil),
		"audience":     f.logoutToken(t, func(c map[string]any) { c["aud"] = "another-client" }, jose.RS256, nil),
		"issuer":       f.logoutToken(t, func(c map[string]any) { c["iss"] = "https://other-idp.example.invalid" }, jose.RS256, nil),
		"no-sid-sub":   f.logoutToken(t, func(c map[string]any) { delete(c, "sid"); delete(c, "sub") }, jose.RS256, nil),
		"no-jti":       f.logoutToken(t, func(c map[string]any) { delete(c, "jti") }, jose.RS256, nil),
		"old":          f.logoutToken(t, func(c map[string]any) { c["iat"] = time.Now().Add(-10 * time.Minute).Unix() }, jose.RS256, nil),
		"future":       f.logoutToken(t, func(c map[string]any) { c["iat"] = time.Now().Add(10 * time.Minute).Unix() }, jose.RS256, nil),
		"expired":      f.logoutToken(t, func(c map[string]any) { c["exp"] = time.Now().Add(-10 * time.Minute).Unix() }, jose.RS256, nil),
		"hmac":         f.logoutToken(t, nil, jose.HS256, []byte("fixture-shared-secret-of-32-bytes!!")),
		"not-a-jwt":    "not.a.jwt",
		"other-signer": "",
	}
	other := newNativeOIDCFixture(t)
	other.issuer.URL = f.issuer.URL
	cases["other-signer"] = other.logoutToken(t, nil, jose.RS256, nil)
	for name, token := range cases {
		if w := postLogout(f, form, url.Values{"logout_token": {token}}.Encode()); w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, w.Code)
		}
	}
	good := f.logoutToken(t, nil, jose.RS256, nil)
	for name, w := range map[string]*httptest.ResponseRecorder{
		"json":     postLogout(f, "application/json", url.Values{"logout_token": {good}}.Encode()),
		"two":      postLogout(f, form, url.Values{"logout_token": {good, good}}.Encode()),
		"no-token": postLogout(f, form, "other=1"),
	} {
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", name, w.Code)
		}
	}
	get := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid"+KailoOIDCBackchannelLogoutPath, nil).WithContext(f.ctx)
	w := httptest.NewRecorder()
	NativeKailoOIDCBackchannelLogout(w, get)
	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: %d", w.Code)
	}
	// Unknown sessions: valid and idempotent.
	if w := postLogout(f, form, url.Values{"logout_token": {good}}.Encode()); w.Code != http.StatusOK {
		t.Fatalf("valid token without sessions: %d", w.Code)
	}
	// Disabled receiver.
	f.connector.Config.BackchannelLogout = nil
	if err := config.Set(f.ctx, []kailoOIDCConnector{f.connector}, "services", "pydio.web.oauth", "connectors"); err != nil {
		t.Fatal(err)
	}
	if w := postLogout(f, form, url.Values{"logout_token": {f.logoutToken(t, nil, jose.RS256, nil)}}.Encode()); w.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled receiver: %d", w.Code)
	}
	bad := f.connector
	bad.Config.BackchannelLogout = &kailoBackchannelConfig{SessionMaxAgeSeconds: 3600}
	if bad.validate("https://cells.example.invalid") == nil {
		t.Fatal("implicit logout token bound accepted")
	}
}
