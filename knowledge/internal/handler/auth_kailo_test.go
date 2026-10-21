package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"github.com/Tencent/WeKnora/internal/application/service"
	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/types"
	secutils "github.com/Tencent/WeKnora/internal/utils"
)

type stubKailoAuthUserService struct {
	stubOIDCStartUserService
	loginErr  error
	logoutErr error
	logoutGot string
}

func (s *stubKailoAuthUserService) LoginWithOIDC(
	context.Context, string, string, types.TenantProvisioningMode,
) (*types.OIDCCallbackResponse, error) {
	return nil, s.loginErr
}

func (s *stubKailoAuthUserService) LogoutByOIDCBackchannel(_ context.Context, token string) error {
	s.logoutGot = token
	return s.logoutErr
}

func kailoAuthRouter(h *AuthHandler) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(errorCapture())
	r.GET("/auth/oidc/start", h.OIDCStart)
	r.GET("/auth/oidc/callback", h.OIDCRedirectCallback)
	r.POST("/auth/oidc/backchannel-logout", h.OIDCBackchannelLogout)
	r.GET("/auth/config", h.GetAuthConfig)
	return r
}

func kailoModeConfig() *config.Config {
	return &config.Config{
		Auth:     &config.AuthConfig{RegistrationMode: config.AuthRegistrationModeSelfServe},
		OIDCAuth: &config.OIDCAuthConfig{Enable: true},
		Kailo:    &config.KailoIntegrationConfig{Enable: true, OrgSync: config.KailoOrgSyncRequired},
	}
}

func TestOIDCStartCarriesSilentPromptAndSafeReturnPath(t *testing.T) {
	us := &stubKailoAuthUserService{stubOIDCStartUserService: stubOIDCStartUserService{
		getOIDCAuthorizationURL: func(context.Context, string) (*types.OIDCAuthURLResponse, error) {
			return &types.OIDCAuthURLResponse{Success: true, AuthorizationURL: "http://idp", Nonce: "n"}, nil
		},
	}}
	r := kailoAuthRouter(NewAuthHandler(kailoModeConfig(), us, nil, nil, nil))
	req := httptest.NewRequest(http.MethodGet,
		"/auth/oidc/start?prompt=none&return_to="+url.QueryEscape("/platform/knowledge-bases/kb-1?tab=docs"), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d", w.Code)
	}
	if us.lastOptions.Prompt != "none" || us.lastOptions.ReturnTo != "/platform/knowledge-bases/kb-1?tab=docs" {
		t.Fatalf("options = %+v", us.lastOptions)
	}
}

func TestOIDCStartDropsUnsafeOptions(t *testing.T) {
	for _, tc := range []struct{ prompt, returnTo string }{
		{"consent", "//evil.example/x"},
		{"select_account", "https://evil.example/"},
		{"none none", "/\\evil.example"},
		{"", "/api/v1/auth/logout"},
		{"", "/a#oidc_result=forged"},
		{"", "platform"},
		{"", "/\tplatform"},
	} {
		us := &stubKailoAuthUserService{stubOIDCStartUserService: stubOIDCStartUserService{
			getOIDCAuthorizationURL: func(context.Context, string) (*types.OIDCAuthURLResponse, error) {
				return &types.OIDCAuthURLResponse{Success: true, AuthorizationURL: "http://idp", Nonce: "n"}, nil
			},
		}}
		r := kailoAuthRouter(NewAuthHandler(kailoModeConfig(), us, nil, nil, nil))
		req := httptest.NewRequest(http.MethodGet, "/auth/oidc/start?prompt="+url.QueryEscape(tc.prompt)+
			"&return_to="+url.QueryEscape(tc.returnTo), nil)
		r.ServeHTTP(httptest.NewRecorder(), req)
		if us.lastOptions != (types.OIDCAuthOptions{}) {
			t.Errorf("prompt=%q return_to=%q kept options %+v", tc.prompt, tc.returnTo, us.lastOptions)
		}
	}
}

func signedCallbackState(t *testing.T, returnTo, prompt string) string {
	t.Helper()
	state, err := secutils.SignOIDCState(&secutils.OIDCStatePayload{
		Nonce: "nonce-1", RedirectURI: "http://knowledge.example/api/v1/auth/oidc/callback",
		ReturnTo: returnTo, Prompt: prompt,
	})
	if err != nil {
		t.Fatal(err)
	}
	return state
}

func callback(t *testing.T, h *AuthHandler, query string, withCookie bool) string {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/auth/oidc/callback?"+query, nil)
	if withCookie {
		req.AddCookie(&http.Cookie{Name: oidcNonceCookieName, Value: "nonce-1"})
	}
	w := httptest.NewRecorder()
	kailoAuthRouter(h).ServeHTTP(w, req)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d body=%s", w.Code, w.Body.String())
	}
	return w.Header().Get("Location")
}

func TestOIDCCallbackSilentFailureReturnsToOriginalPage(t *testing.T) {
	h := NewAuthHandler(kailoModeConfig(), &stubKailoAuthUserService{}, nil, nil, nil)
	state := signedCallbackState(t, "/platform/agents", "none")
	loc := callback(t, h, "error=login_required&state="+url.QueryEscape(state), true)
	if loc != "/platform/agents#oidc_error=login_required&oidc_prompt=none" {
		t.Fatalf("Location = %q", loc)
	}

	// Without the browser-bound nonce the state is not trusted: no return
	// path and no silent marker.
	loc = callback(t, h, "error=login_required&state="+url.QueryEscape(state), false)
	if loc != "/#oidc_error=login_required" {
		t.Fatalf("Location without nonce cookie = %q", loc)
	}
}

func TestOIDCCallbackReportsMissingKailoOrganisation(t *testing.T) {
	us := &stubKailoAuthUserService{loginErr: fmt.Errorf("%w: claim absent", service.ErrKailoOrgClaim)}
	h := NewAuthHandler(kailoModeConfig(), us, nil, nil, nil)
	state := signedCallbackState(t, "/platform/knowledge-bases", "")
	loc := callback(t, h, "code=c1&state="+url.QueryEscape(state), true)
	if loc != "/platform/knowledge-bases#oidc_error=kailo_org_missing" {
		t.Fatalf("Location = %q", loc)
	}
}

func TestOIDCBackchannelLogoutHandler(t *testing.T) {
	us := &stubKailoAuthUserService{}
	r := kailoAuthRouter(NewAuthHandler(kailoModeConfig(), us, nil, nil, nil))
	post := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/auth/oidc/backchannel-logout",
			strings.NewReader("logout_token=signed.logout.token"))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w
	}
	if w := post(); w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" || us.logoutGot != "signed.logout.token" {
		t.Fatalf("valid logout: status=%d cache=%q token=%q", w.Code, w.Header().Get("Cache-Control"), us.logoutGot)
	}
	us.logoutErr = service.ErrInvalidLogoutToken
	if w := post(); w.Code != http.StatusBadRequest {
		t.Fatalf("invalid logout token status = %d", w.Code)
	}
}

func TestAuthConfigInKailoModeClosesLocalCredentials(t *testing.T) {
	r := kailoAuthRouter(NewAuthHandler(kailoModeConfig(), &stubKailoAuthUserService{}, nil, nil, nil))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/auth/config", nil))
	var body map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["local_auth_enabled"] != false || body["oidc_auto_login"] != true ||
		body["registration_mode"] != config.AuthRegistrationModeInviteOnly {
		t.Fatalf("auth config = %v", body)
	}
}
