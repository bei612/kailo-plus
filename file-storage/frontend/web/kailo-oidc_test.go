package web

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v3"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	clientgrpc "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/permissions"
	pauth "github.com/pydio/cells/v5/common/proto/auth"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/install"
	"github.com/pydio/cells/v5/common/utils/cache/gocache"
	cachehelper "github.com/pydio/cells/v5/common/utils/cache/helper"
)

type nativeOIDCFixture struct {
	t                                     *testing.T
	ctx                                   context.Context
	connector                             kailoOIDCConnector
	issuer                                *httptest.Server
	nonce, verifier, subject, email       string
	badNonce, revokeDuringExchange        bool
	denyNativePolicy, unknownNativePolicy bool
	user                                  *idm.User
	accessMode                            string
	accessToken                           string
	exchanges, nativeCodes                int
}

var nativeOIDCTestProvider sync.Once

func TestKailoOIDCLoginOption(t *testing.T) {
	f := newNativeOIDCFixture(t)
	request := func(query string) *http.Request {
		return httptest.NewRequest(http.MethodGet, "https://cells.example.invalid/login"+query, nil).WithContext(f.ctx)
	}
	option := nativeOIDCLoginOption(request(""))
	if len(option) != 2 || option["label"] != f.connector.Name || option["href"] != KailoOIDCLoginPath {
		t.Fatalf("expected only the native login label and route, got %v", option)
	}
	challenge := "native challenge&redirect_uri=https://other.example.invalid"
	option = nativeOIDCLoginOption(request("?" + url.Values{"login_challenge": {challenge}, "redirect_uri": {"https://other.example.invalid"}}.Encode()))
	login, err := url.Parse(option["href"])
	if err != nil || login.IsAbs() || login.Host != "" || login.Path != KailoOIDCLoginPath || len(login.Query()) != 1 || login.Query().Get("login_challenge") != challenge {
		t.Fatalf("native challenge must remain encoded data on the same route: %v", option)
	}
	for _, query := range []string{"?login_challenge=one&login_challenge=two", "?login_challenge=%zz"} {
		if nativeOIDCLoginOption(request(query)) != nil {
			t.Fatal("ambiguous or malformed native login query exposed a login option")
		}
	}
	invalid := f.connector
	invalid.Config.RedirectURI = "https://other.example.invalid" + KailoOIDCCallbackPath
	for _, entries := range [][]kailoOIDCConnector{nil, {f.connector, f.connector}, {invalid}} {
		if err := config.Set(f.ctx, entries, "services", "pydio.web.oauth", "connectors"); err != nil {
			t.Fatal(err)
		}
		if nativeOIDCLoginOption(request("")) != nil {
			t.Fatal("unavailable native connector exposed a login option")
		}
	}
}

func newNativeOIDCFixture(t *testing.T) *nativeOIDCFixture {
	t.Helper()
	f := &nativeOIDCFixture{t: t, ctx: config.WithStubStore(context.Background()), subject: "idp-subject", email: "external@example.invalid", user: &idm.User{Uuid: "native-user", Login: "native-login", Attributes: map[string]string{"email": "native@example.invalid"}}}
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f.issuer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]any{"issuer": f.issuer.URL, "authorization_endpoint": f.issuer.URL + "/authorize", "token_endpoint": f.issuer.URL + "/token", "jwks_uri": f.issuer.URL + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "fixture-key", Algorithm: "RS256", Use: "sig"}}})
		case "/token":
			f.exchanges++
			if f.exchanges > 1 {
				w.WriteHeader(http.StatusBadRequest)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "invalid_grant"})
				return
			}
			if err := r.ParseForm(); err != nil {
				t.Error(err)
				w.WriteHeader(400)
				return
			}
			if r.Form.Get("code_verifier") != f.verifier || r.Form.Get("redirect_uri") != f.connector.Config.RedirectURI || r.Form.Get("code") != "one-use-code" {
				t.Error("external exchange did not use the frozen PKCE transaction")
				w.WriteHeader(400)
				return
			}
			if f.revokeDuringExchange {
				_ = config.Set(f.ctx, []kailoOIDCConnector{}, "services", "pydio.web.oauth", "connectors")
			}
			nonce := f.nonce
			if f.badNonce {
				nonce = "different-transaction"
			}
			payload, _ := json.Marshal(map[string]any{"iss": f.issuer.URL, "sub": f.subject, "aud": "cells-oidc-client", "exp": time.Now().Add(time.Minute).Unix(), "iat": time.Now().Unix(), "nonce": nonce, "email": f.email, "groups": []string{"admin"}})
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "fixture-key"}}, nil)
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			signed, err := signer.Sign(payload)
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			raw, err := signed.CompactSerialize()
			if err != nil {
				t.Error(err)
				w.WriteHeader(500)
				return
			}
			access := "external-token-never-forwarded"
			if f.accessMode != "" && f.accessMode != "opaque" {
				accessClaims := map[string]any{"iss": f.issuer.URL, "sub": f.subject, "aud": f.connector.Config.ClientID,
					"exp": time.Now().Add(time.Minute).Unix(), "iat": time.Now().Unix(), "kailo_access": "native-component"}
				switch f.accessMode {
				case "wrong-subject":
					accessClaims["sub"] = "another-human"
				case "wrong-audience":
					accessClaims["aud"] = "another-native-audience"
				case "expired":
					accessClaims["exp"] = time.Now().Add(-time.Minute).Unix()
				}
				payload, _ := json.Marshal(accessClaims)
				signed, err := signer.Sign(payload)
				if err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				access, err = signed.CompactSerialize()
				if err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusInternalServerError)
					return
				}
				if f.accessMode == "id-token" {
					access = raw
				}
			}
			f.accessToken = access
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": access, "token_type": "Bearer", "id_token": raw})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(f.issuer.Close)
	secret := filepath.Join(t.TempDir(), "client-secret")
	if err := os.WriteFile(secret, []byte("fixture-only-secret"), 0600); err != nil {
		t.Fatal(err)
	}
	f.connector = kailoOIDCConnector{ID: "platform-identity", Name: "Platform identity", Type: "kailo-oidc", Config: kailoOIDCConfig{Issuer: f.issuer.URL, ClientID: "cells-oidc-client", ClientSecretFile: secret, RedirectURI: "https://cells.example.invalid" + KailoOIDCCallbackPath, Users: []kailoOIDCUser{{Subject: f.subject, UserUUID: f.user.Uuid}}, RequestTimeout: "10s", TransactionMaxAgeSeconds: 300, ClientSecretMaxBytes: 64}}
	for _, entry := range []struct {
		path  []string
		value any
	}{
		{[]string{"services", "pydio.web.oauth", "connectors"}, []kailoOIDCConnector{f.connector}},
		{[]string{"defaults", "sites"}, []*install.ProxyConfig{{ReverseProxyURL: "https://cells.example.invalid"}}},
		{[]string{"frontend", "session", "secureKey"}, base64.StdEncoding.EncodeToString(make([]byte, 64))},
	} {
		if err := config.Set(f.ctx, entry.value, entry.path...); err != nil {
			t.Fatal(err)
		}
	}
	cachehelper.SetStaticResolver("pm://", &gocache.URLOpener{})
	clientgrpc.RegisterMock(common.ServiceUserGRPC, f)
	clientgrpc.RegisterMock(common.ServiceOAuthGRPC, f)
	clientgrpc.RegisterMock(common.ServicePolicyGRPC, f)
	// Production registers this provider in idm/oauth/grpc/service::init.
	nativeOIDCTestProvider.Do(func() { auth.RegisterGRPCProvider(auth.ProviderTypeGrpc, common.ServiceOAuthGRPC) })
	permissions.ClearCachedPolicies(f.ctx, "oidc")
	return f
}

func (f *nativeOIDCFixture) Invoke(ctx context.Context, method string, args any, reply any, opts ...grpc.CallOption) error {
	switch method {
	case "/idm.PolicyEngineService/IsAllowed":
		in := args.(*idm.PolicyEngineRequest)
		if in.Resource != "oidc" || in.Action != "login" {
			return errors.New("not the original native login policy")
		}
		if f.unknownNativePolicy {
			return errors.New("native policy service unavailable")
		}
		reply.(*idm.PolicyEngineResponse).Allowed = !f.denyNativePolicy
	case "/idm.UserService/SearchOne":
		query := new(idm.UserSingleQuery)
		if err := args.(*idm.SearchUserRequest).Query.SubQueries[0].UnmarshalTo(query); err != nil {
			return err
		}
		if query.Uuid != "native-user" || query.NodeType != idm.NodeType_USER {
			return errors.New("not an exact native user lookup")
		}
		reply.(*idm.SearchUserResponse).User = f.user
	case "/auth.LoginProvider/CreateLogin":
		if args.(*pauth.CreateLoginRequest).ClientID != config.DefaultOAuthClientID {
			return errors.New("not the original frontend client")
		}
		reply.(*pauth.CreateLoginResponse).Login = &pauth.ID{Challenge: "native-challenge"}
	case "/auth.LoginProvider/GetLogin":
		if args.(*pauth.GetLoginRequest).Challenge != "native-challenge" {
			return errors.New("unknown native challenge")
		}
		out := reply.(*pauth.GetLoginResponse)
		out.Challenge, out.ClientID, out.RequestURL, out.SessionID = "native-challenge", config.DefaultOAuthClientID, "https://cells.example.invalid/oauth2/auth", "native-session"
	case "/auth.LoginChallengeCode/LoginChallengeCode":
		in := args.(*pauth.LoginChallengeCodeRequest)
		if in.Challenge != "native-challenge" || in.Claims["subject"] != f.user.Uuid || in.Claims["name"] != f.user.Login || in.Claims["email"] != f.user.Attributes["email"] || in.Claims["authSource"] != f.connector.ID {
			return errors.New("external claims replaced native identity")
		}
		f.nativeCodes++
		out := reply.(*pauth.LoginChallengeCodeResponse)
		out.Code, out.LoginResponse = "native-one-use-code", &pauth.GetLoginResponse{Challenge: "native-challenge", ClientID: config.DefaultOAuthClientID, RequestURL: "https://cells.example.invalid/oauth2/auth", SessionID: "native-session"}
	default:
		return errors.New("unexpected native RPC: " + method)
	}
	return nil
}

func (f *nativeOIDCFixture) NewStream(ctx context.Context, desc *grpc.StreamDesc, method string, opts ...grpc.CallOption) (grpc.ClientStream, error) {
	if method != "/idm.PolicyEngineService/StreamPolicyGroups" {
		return nil, errors.New("unexpected native stream")
	}
	return &nativeOIDCPolicyStream{ctx: ctx}, nil
}

type nativeOIDCPolicyStream struct {
	ctx  context.Context
	sent bool
}

func (s *nativeOIDCPolicyStream) Header() (metadata.MD, error) { return nil, nil }
func (s *nativeOIDCPolicyStream) Trailer() metadata.MD         { return nil }
func (s *nativeOIDCPolicyStream) CloseSend() error             { return nil }
func (s *nativeOIDCPolicyStream) Context() context.Context     { return s.ctx }
func (s *nativeOIDCPolicyStream) SendMsg(any) error            { return nil }
func (s *nativeOIDCPolicyStream) RecvMsg(value any) error {
	if s.sent {
		return io.EOF
	}
	s.sent = true
	value.(*idm.PolicyGroup).Policies = []*idm.Policy{{ID: "native-login-policy", Subjects: []string{"subject:native-user"}, Resources: []string{"oidc"}, Actions: []string{"login"}, Effect: idm.PolicyEffect_allow}}
	return nil
}

func (f *nativeOIDCFixture) begin() (*http.Cookie, string) {
	f.t.Helper()
	r := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid"+KailoOIDCLoginPath, nil).WithContext(f.ctx)
	w := httptest.NewRecorder()
	NativeKailoOIDC(w, r)
	if w.Code != http.StatusFound {
		f.t.Fatalf("native login returned %d: %s", w.Code, w.Body.String())
	}
	location, err := url.Parse(w.Header().Get("Location"))
	if err != nil {
		f.t.Fatal(err)
	}
	query := location.Query()
	f.nonce = query.Get("nonce")
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || !cookies[0].Secure || cookies[0].MaxAge != f.connector.Config.TransactionMaxAgeSeconds || cookies[0].SameSite != http.SameSiteLaxMode || query.Get("code_challenge_method") != "S256" {
		f.t.Fatal("native login omitted its secure browser transaction")
	}
	store, err := nativeOIDCStore(f.ctx, f.connector)
	if err != nil {
		f.t.Fatal(err)
	}
	saved := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid"+KailoOIDCCallbackPath, nil)
	saved.AddCookie(cookies[0])
	session, err := store.Get(saved, kailoOIDCCookie)
	if err != nil {
		f.t.Fatal(err)
	}
	f.verifier, _ = session.Values["verifier"].(string)
	return cookies[0], query.Get("state")
}

func (f *nativeOIDCFixture) callback(cookie *http.Cookie, state string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "https://cells.example.invalid"+KailoOIDCCallbackPath+"?"+url.Values{"state": []string{state}, "code": []string{"one-use-code"}}.Encode(), nil).WithContext(f.ctx)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	NativeKailoOIDC(w, r)
	return w
}

func TestKailoOIDCNativeConsumer(t *testing.T) {
	for _, scenario := range []struct {
		name          string
		change        func(*nativeOIDCFixture)
		status, codes int
	}{
		{"linked-native-user", func(*nativeOIDCFixture) {}, http.StatusSeeOther, 1},
		{"email-change-keeps-native-user", func(f *nativeOIDCFixture) { f.email = "new@example.invalid" }, http.StatusSeeOther, 1},
		{"same-email-other-subject-refused", func(f *nativeOIDCFixture) { f.subject = "unlinked-subject"; f.email = f.user.Attributes["email"] }, http.StatusForbidden, 0},
		{"nonce-refused", func(f *nativeOIDCFixture) { f.badNonce = true }, http.StatusUnauthorized, 0},
		{"native-lock-refused", func(f *nativeOIDCFixture) { f.user.Attributes["locks"] = `["logout"]` }, http.StatusForbidden, 0},
		{"fresh-native-policy-denied", func(f *nativeOIDCFixture) { f.denyNativePolicy = true }, http.StatusForbidden, 0},
		{"fresh-native-policy-unknown", func(f *nativeOIDCFixture) { f.unknownNativePolicy = true }, http.StatusForbidden, 0},
		{"deleted-native-user-refused", func(f *nativeOIDCFixture) { f.user = nil }, http.StatusForbidden, 0},
		{"connector-revoked-during-exchange", func(f *nativeOIDCFixture) { f.revokeDuringExchange = true }, http.StatusUnauthorized, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := newNativeOIDCFixture(t)
			cookie, state := f.begin()
			scenario.change(f)
			w := f.callback(cookie, state)
			if w.Code != scenario.status || f.nativeCodes != scenario.codes {
				t.Fatalf("status=%d nativeCodes=%d body=%s", w.Code, f.nativeCodes, w.Body.String())
			}
			for _, c := range w.Result().Cookies() {
				if c.Name == kailoOIDCCookie && c.MaxAge >= 0 {
					t.Fatal("pending transaction not cleared")
				}
			}
			if w.Code == http.StatusSeeOther {
				u, err := url.Parse(w.Header().Get("Location"))
				if err != nil {
					t.Fatal(err)
				}
				if u.Scheme != "https" || u.Host != "cells.example.invalid" || u.Path != "/login/callback" || u.Query().Get("code") != "native-one-use-code" || strings.Contains(u.String(), "external-token") {
					t.Fatal("native UI did not receive only its own authorization code")
				}
			}
		})
	}
}

func TestKailoOIDCOneUseExternalCode(t *testing.T) {
	f := newNativeOIDCFixture(t)
	cookie, state := f.begin()
	if w := f.callback(cookie, state); w.Code != http.StatusSeeOther {
		t.Fatalf("initial code did not finish: %d", w.Code)
	}
	if w := f.callback(cookie, state); w.Code != http.StatusUnauthorized || f.nativeCodes != 1 {
		t.Fatal("replayed external code minted another native code")
	}
}

func TestKailoOIDCNativeActionCredential(t *testing.T) {
	for _, mode := range []string{"valid", "opaque", "wrong-subject", "wrong-audience", "expired", "id-token"} {
		t.Run(mode, func(t *testing.T) {
			f := newNativeOIDCFixture(t)
			f.accessMode = mode
			if err := config.Set(f.ctx, map[string]any{"bindingId": "controlled"}, "services", common.ServiceRestNamespace_+"n", "platform"); err != nil {
				t.Fatal(err)
			}
			cookie, state := f.begin()
			response := f.callback(cookie, state)
			if mode != "valid" {
				if response.Code != http.StatusUnauthorized || f.nativeCodes != 0 {
					t.Fatalf("untrusted access identity minted a native code: status=%d codes=%d", response.Code, f.nativeCodes)
				}
				for _, c := range response.Result().Cookies() {
					if c.Name == "cells_native_human" && c.MaxAge >= 0 {
						t.Fatal("refused access token established a credential")
					}
				}
				return
			}
			if response.Code != http.StatusSeeOther || f.nativeCodes != 1 {
				t.Fatalf("confirmed real access JWT did not finish login: %d %s", response.Code, response.Body.String())
			}
			var humanCookie *http.Cookie
			for _, c := range response.Result().Cookies() {
				if c.Name == "cells_native_human" {
					humanCookie = c
				}
			}
			if humanCookie == nil || !humanCookie.HttpOnly || !humanCookie.Secure || humanCookie.Path != "/" ||
				humanCookie.SameSite != http.SameSiteStrictMode || humanCookie.MaxAge <= 0 ||
				strings.Contains(humanCookie.Value, f.accessToken) || strings.Contains(response.Body.String(), f.accessToken) {
				t.Fatal("upstream credential was not native-session encrypted/backend-only")
			}
			for _, scenario := range []string{"current", "same-session-refresh", "another-session", "another-user", "another-connector", "native-lock", "link-revoked", "audience-changed"} {
				t.Run(scenario, func(t *testing.T) {
					ctx := f.ctx
					claims := claim.Claims{Subject: f.user.Uuid, Name: f.user.Login, SessionID: "native-session", AuthSource: f.connector.ID}
					connector := f.connector
					switch scenario {
					case "same-session-refresh":
						claims.Expiry = time.Now().Add(time.Hour)
					case "another-session":
						claims.SessionID = "another-native-session"
					case "another-user":
						claims.Subject = "another-user"
					case "another-connector":
						claims.AuthSource = "another-connector"
					case "native-lock":
						f.user.Attributes["locks"] = `["logout"]`
						t.Cleanup(func() { delete(f.user.Attributes, "locks") })
					case "link-revoked":
						connector.Config.Users = nil
					case "audience-changed":
						connector.Config.ClientID = "rotated-audience"
					}
					if err := config.Set(ctx, []kailoOIDCConnector{connector}, "services", "pydio.web.oauth", "connectors"); err != nil {
						t.Fatal(err)
					}
					t.Cleanup(func() {
						_ = config.Set(ctx, []kailoOIDCConnector{f.connector}, "services", "pydio.web.oauth", "connectors")
					})
					r := httptest.NewRequest(http.MethodPost, "https://cells.example.invalid/n/versions", nil).WithContext(claim.ToContext(ctx, claims))
					r.AddCookie(humanCookie)
					actual, err := auth.NativeHumanToken(r)
					allowed := scenario == "current" || scenario == "same-session-refresh"
					if allowed && (err != nil || actual != f.accessToken) {
						t.Fatalf("current native user/session cannot use the original bearer: %v", err)
					}
					if !allowed && (err == nil || actual != "") {
						t.Fatal("changed/revoked native identity reused an upstream bearer")
					}
				})
			}
			for _, value := range []string{humanCookie.Value, "tampered-native-cookie"} {
				r := httptest.NewRequest(http.MethodDelete, "https://cells.example.invalid/a/frontend/session", nil).WithContext(f.ctx)
				r.AddCookie(&http.Cookie{Name: humanCookie.Name, Value: value})
				w := httptest.NewRecorder()
				if err := auth.ClearNativeHumanToken(r, w); err != nil {
					t.Fatal(err)
				}
				cookies := w.Result().Cookies()
				if len(cookies) != 1 || cookies[0].MaxAge >= 0 || strings.Contains(cookies[0].Value, f.accessToken) {
					t.Fatal("logout retained the native credential")
				}
			}
		})
	}
}

func TestKailoOIDCStateRefusesExternalExchange(t *testing.T) {
	f := newNativeOIDCFixture(t)
	cookie, _ := f.begin()
	w := f.callback(cookie, "other-browser-state")
	if w.Code != http.StatusUnauthorized || f.exchanges != 0 || f.nativeCodes != 0 {
		t.Fatal("state mismatch reached token/native code exchange")
	}
}

func TestKailoOIDCNativeLinksAndOrigin(t *testing.T) {
	f := newNativeOIDCFixture(t)
	if _, err := f.connector.nativeUserUUID(f.issuer.URL+"/other-issuer", f.subject); err == nil {
		t.Fatal("issuer mismatch accepted")
	}
	f.connector.Config.Users = append(f.connector.Config.Users, kailoOIDCUser{Subject: f.subject, UserUUID: "other-native-user"})
	if err := f.connector.validate("https://cells.example.invalid"); err == nil {
		t.Fatal("ambiguous subject link accepted")
	}
	f.connector.Config.Users = []kailoOIDCUser{{Subject: f.subject, UserUUID: "native-user"}}
	f.connector.Config.RedirectURI = "https://other.example.invalid" + KailoOIDCCallbackPath
	if err := f.connector.validate("https://cells.example.invalid"); err == nil {
		t.Fatal("callback origin substitution accepted")
	}
}

func TestKailoOIDCNativeCallback(t *testing.T) {
	origin, _ := url.Parse("https://cells.example.invalid" + KailoOIDCCallbackPath)
	for _, login := range []*pauth.GetLoginResponse{
		{ClientID: "external-client", RequestURL: "https://cells.example.invalid/oauth2/auth"},
		{ClientID: config.DefaultOAuthClientID, RequestURL: "https://cells.example.invalid/oauth2/auth?redirect_uri=https%3A%2F%2Fother.example.invalid%2Fauth%2Fcallback"},
		{ClientID: config.DefaultOAuthClientID, RequestURL: "https://cells.example.invalid/oauth2/auth?redirect_uri=https%3A%2F%2Fcells.example.invalid%2Fauth%2Fcallback%3Fnext%3Dexternal"},
	} {
		if _, err := nativeFrontendCallback(origin, login); err == nil {
			t.Fatal("non-native callback accepted")
		}
	}
	got, err := nativeFrontendCallback(origin, &pauth.GetLoginResponse{ClientID: config.DefaultOAuthClientID, RequestURL: "https://cells.example.invalid/oauth2/auth"})
	if err != nil || got.String() != "https://cells.example.invalid/login/callback" {
		t.Fatalf("original CreateLogin shape refused: %v", err)
	}
	got, err = nativeFrontendCallback(origin, &pauth.GetLoginResponse{ClientID: config.DefaultOAuthClientID, RequestURL: "https://cells.example.invalid/oauth2/auth?redirect_uri=https%3A%2F%2Fcells.example.invalid%2Fauth%2Fcallback&state=native-state"})
	if err != nil || got.String() != "https://cells.example.invalid/login/callback?state=native-state" {
		t.Fatalf("registered native redirect did not reach original UI callback: %v", err)
	}
}

func TestKailoOIDCSecretFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "secret")
	if err := os.WriteFile(path, []byte("fixture-secret"), 0644); err != nil {
		t.Fatal(err)
	}
	maxBytes := int64(len("fixture-secret"))
	if _, err := readNativeOIDCSecret(path, maxBytes); err == nil {
		t.Fatal("world-readable credential accepted")
	}
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readNativeOIDCSecret(path, maxBytes); err != nil {
		t.Fatal(err)
	}
	if _, err := readNativeOIDCSecret(path, maxBytes-1); err == nil {
		t.Fatal("native-configured credential size bound ignored")
	}
}

func TestKailoOIDCExplicitConfigBounds(t *testing.T) {
	f := newNativeOIDCFixture(t)
	for _, change := range []func(*kailoOIDCConfig){
		func(c *kailoOIDCConfig) { c.RequestTimeout = "" },
		func(c *kailoOIDCConfig) { c.RequestTimeout = "0s" },
		func(c *kailoOIDCConfig) { c.RequestTimeout = "-1s" },
		func(c *kailoOIDCConfig) { c.TransactionMaxAgeSeconds = 0 },
		func(c *kailoOIDCConfig) { c.TransactionMaxAgeSeconds = -1 },
		func(c *kailoOIDCConfig) { c.ClientSecretMaxBytes = 0 },
		func(c *kailoOIDCConfig) { c.ClientSecretMaxBytes = -1 },
	} {
		bad := f.connector
		change(&bad.Config)
		if err := bad.validate("https://cells.example.invalid"); err == nil {
			t.Fatal("missing or non-positive native bound accepted")
		}
	}
	f.connector.Config.RequestTimeout = "23s"
	f.connector.Config.TransactionMaxAgeSeconds = 731
	f.connector.Config.ClientSecretMaxBytes = 321
	if err := f.connector.validate("https://cells.example.invalid"); err != nil {
		t.Fatal(err)
	}
	if err := config.Set(f.ctx, []kailoOIDCConnector{f.connector}, "services", "pydio.web.oauth", "connectors"); err != nil {
		t.Fatal(err)
	}
	cookie, _ := f.begin()
	if cookie.MaxAge != 731 {
		t.Fatal("native delivery was replaced by a fixed transaction age")
	}
	for _, origin := range []string{"http://192.168.0.193:8080", "https://cells.example.invalid"} {
		f.connector.Config.Issuer = origin + "/realms/development"
		f.connector.Config.RedirectURI = origin + KailoOIDCCallbackPath
		if err := f.connector.validate(origin); err != nil {
			t.Fatalf("controlled native HTTP(S) origin refused: %v", err)
		}
	}
}
