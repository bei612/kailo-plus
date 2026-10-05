package web

// Native federation only: the external identity selects an explicitly linked
// Cells user. It does not create users, roles, workspaces or platform authority.
import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/gorilla/sessions"
	"golang.org/x/oauth2"
	"google.golang.org/protobuf/types/known/anypb"

	"github.com/pydio/cells/v5/common"
	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/auth/hydra"
	"github.com/pydio/cells/v5/common/client/commons/idmc"
	clientgrpc "github.com/pydio/cells/v5/common/client/grpc"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/config/routing"
	"github.com/pydio/cells/v5/common/permissions"
	nativeauth "github.com/pydio/cells/v5/common/proto/auth"
	"github.com/pydio/cells/v5/common/proto/idm"
	"github.com/pydio/cells/v5/common/proto/service"
	"github.com/pydio/cells/v5/common/service/frontend/sessions/utils"
)

const (
	KailoOIDCLoginPath    = "/auth/kailo/login"
	KailoOIDCCallbackPath = "/auth/kailo/callback"
	kailoOIDCCookie       = "cells_kailo_oidc"
)

type kailoOIDCUser struct {
	Subject  string `json:"subject"`
	UserUUID string `json:"userUuid"`
}

type kailoOIDCConfig struct {
	Issuer                   string          `json:"issuer"`
	ClientID                 string          `json:"clientId"`
	ClientSecretFile         string          `json:"clientSecretFile"`
	RedirectURI              string          `json:"redirectUri"`
	Users                    []kailoOIDCUser `json:"users"`
	RequestTimeout           string          `json:"requestTimeout"`
	TransactionMaxAgeSeconds int             `json:"transactionMaxAgeSeconds"`
	ClientSecretMaxBytes     int64           `json:"clientSecretMaxBytes"`
}

type kailoOIDCConnector struct {
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Type   string          `json:"type"`
	Config kailoOIDCConfig `json:"config"`
}

// Use the native OAuth connector configuration, not a parallel user/ACL store.
func loadKailoOIDC(ctx context.Context) (kailoOIDCConnector, error) {
	var entries []kailoOIDCConnector
	if err := config.Get(ctx, "services", "pydio.web.oauth", "connectors").Scan(&entries); err != nil {
		return kailoOIDCConnector{}, err
	}
	var selected *kailoOIDCConnector
	for i := range entries {
		if entries[i].Type != "kailo-oidc" {
			continue
		}
		if selected != nil {
			return kailoOIDCConnector{}, errors.New("ambiguous native OIDC connector")
		}
		selected = &entries[i]
	}
	if selected == nil {
		return kailoOIDCConnector{}, errors.New("native OIDC connector is not configured")
	}
	if err := selected.validate(routing.GetDefaultSiteURL(ctx)); err != nil {
		return kailoOIDCConnector{}, err
	}
	return *selected, nil
}

func nativeOIDCURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("invalid native OIDC URL")
	}
	// Origins come from controlled native deployment configuration, not from
	// the browser. Preserve native HTTP(S), including explicit LAN deployment.
	if u.Scheme != "https" && u.Scheme != "http" {
		return nil, errors.New("native OIDC requires a configured HTTP(S) origin")
	}
	return u, nil
}

func (c kailoOIDCConnector) validate(nativeOrigin string) error {
	if c.ID == "" || c.Name == "" || c.Config.ClientID == "" || !filepath.IsAbs(c.Config.ClientSecretFile) {
		return errors.New("incomplete native OIDC connector")
	}
	if timeout, err := time.ParseDuration(c.Config.RequestTimeout); err != nil || timeout <= 0 || c.Config.TransactionMaxAgeSeconds <= 0 || c.Config.ClientSecretMaxBytes <= 0 {
		return errors.New("native OIDC bounds must be explicitly configured")
	}
	if _, err := nativeOIDCURL(c.Config.Issuer); err != nil {
		return err
	}
	u, err := nativeOIDCURL(c.Config.RedirectURI)
	if err != nil {
		return err
	}
	base, err := nativeOIDCURL(strings.TrimSuffix(nativeOrigin, "/"))
	if err != nil || base.Path != "" || c.Config.RedirectURI != strings.TrimSuffix(nativeOrigin, "/")+KailoOIDCCallbackPath || u.Path != KailoOIDCCallbackPath {
		return errors.New("OIDC callback must be the configured native frontend origin")
	}
	subjects, users := map[string]bool{}, map[string]bool{}
	for _, link := range c.Config.Users {
		if strings.TrimSpace(link.Subject) == "" || strings.TrimSpace(link.UserUUID) == "" || subjects[link.Subject] || users[link.UserUUID] {
			return errors.New("ambiguous or empty native OIDC user link")
		}
		subjects[link.Subject], users[link.UserUUID] = true, true
	}
	return nil
}

func (c kailoOIDCConnector) digest() string {
	data, _ := json.Marshal(c)
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

func (c kailoOIDCConnector) nativeUserUUID(issuer, subject string) (string, error) {
	if issuer != c.Config.Issuer || subject == "" {
		return "", errors.New("unrecognized OIDC identity")
	}
	for _, link := range c.Config.Users {
		if link.Subject == subject {
			return link.UserUUID, nil
		}
	}
	return "", errors.New("OIDC identity is not linked to a native user")
}

func nativeFrontendCallback(origin *url.URL, login *nativeauth.GetLoginResponse) (*url.URL, error) {
	if login == nil || login.GetClientID() != config.DefaultOAuthClientID {
		return nil, errors.New("not a native frontend login")
	}
	requestURL, err := url.Parse(login.GetRequestURL())
	if err != nil {
		return nil, errors.New("invalid native login request")
	}
	q := requestURL.Query()
	if len(q["redirect_uri"]) > 1 || len(q["state"]) > 1 {
		return nil, errors.New("ambiguous native login request")
	}
	// Native CreateLogin intentionally has no redirect_uri. The original
	// cells-frontend client and Exchange use its configured /auth/callback.
	raw := q.Get("redirect_uri")
	if raw == "" {
		raw = origin.Scheme + "://" + origin.Host + "/auth/callback"
	}
	redirect, err := nativeOIDCURL(raw)
	if err != nil || redirect.Scheme != origin.Scheme || redirect.Host != origin.Host || redirect.Path != "/auth/callback" {
		return nil, errors.New("not a native frontend callback")
	}
	values := redirect.Query()
	if state := q.Get("state"); state != "" {
		values.Set("state", state)
	}
	redirect.RawQuery = values.Encode()
	return redirect, nil
}

func readNativeOIDCSecret(path string, maxBytes int64) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", errors.New("native OIDC credential is unavailable")
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || maxBytes <= 0 || !st.Mode().IsRegular() || st.Mode().Perm()&0077 != 0 || st.Size() < 1 || st.Size() > maxBytes {
		return "", errors.New("invalid native OIDC credential file")
	}
	b := make([]byte, st.Size())
	if _, err := f.ReadAt(b, 0); err != nil {
		return "", errors.New("native OIDC credential is unreadable")
	}
	secret := strings.TrimSpace(string(b))
	if secret == "" {
		return "", errors.New("native OIDC credential is empty")
	}
	return secret, nil
}

func nativeOIDCProvider(ctx context.Context, c kailoOIDCConnector) (*oidc.Provider, *oauth2.Config, error) {
	provider, err := oidc.NewProvider(ctx, c.Config.Issuer)
	if err != nil {
		return nil, nil, errors.New("native OIDC discovery is unavailable")
	}
	secret, err := readNativeOIDCSecret(c.Config.ClientSecretFile, c.Config.ClientSecretMaxBytes)
	if err != nil {
		return nil, nil, err
	}
	return provider, &oauth2.Config{ClientID: c.Config.ClientID, ClientSecret: secret, Endpoint: provider.Endpoint(), RedirectURL: c.Config.RedirectURI, Scopes: []string{oidc.ScopeOpenID}}, nil
}

func randomNativeOIDCValue() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func nativeOIDCStore(ctx context.Context, c kailoOIDCConnector) (*sessions.CookieStore, error) {
	key, err := utils.LoadKey(ctx)
	if err != nil || len(key) < 64 {
		return nil, errors.New("native session key is unavailable")
	}
	store := sessions.NewCookieStore(key[:32], key[32:64])
	u, _ := url.Parse(c.Config.RedirectURI)
	store.MaxAge(c.Config.TransactionMaxAgeSeconds)
	store.Options = &sessions.Options{Path: "/auth/kailo", MaxAge: c.Config.TransactionMaxAgeSeconds, HttpOnly: true, Secure: u.Scheme == "https", SameSite: http.SameSiteLaxMode}
	return store, nil
}

// NativeKailoOIDC serves only the two native frontend authentication routes.
// No upstream bearer/refresh token reaches the original frontend or Core.
func NativeKailoOIDC(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	c, err := loadKailoOIDC(r.Context())
	if err != nil {
		http.Error(w, "Native OIDC is unavailable", http.StatusServiceUnavailable)
		return
	}
	// loadKailoOIDC validated the explicit bound. One deadline covers discovery,
	// token exchange and native authentication; no independent default timeout.
	timeout, _ := time.ParseDuration(c.Config.RequestTimeout)
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	ctx = oidc.ClientContext(ctx, &http.Client{Timeout: timeout})
	cb, _ := url.Parse(c.Config.RedirectURI)
	if r.Host != cb.Host {
		http.Error(w, "Invalid native frontend origin", http.StatusBadRequest)
		return
	}
	store, err := nativeOIDCStore(ctx, c)
	if err != nil {
		http.Error(w, "Native OIDC is unavailable", http.StatusServiceUnavailable)
		return
	}
	if r.URL.Path == KailoOIDCLoginPath {
		_, oc, err := nativeOIDCProvider(ctx, c)
		if err != nil {
			http.Error(w, "Native OIDC is unavailable", http.StatusServiceUnavailable)
			return
		}
		// Replace, do not reuse, any pending browser authentication transaction.
		s, _ := store.New(r, kailoOIDCCookie)
		state, e1 := randomNativeOIDCValue()
		nonce, e2 := randomNativeOIDCValue()
		verifier, e3 := randomNativeOIDCValue()
		if e1 != nil || e2 != nil || e3 != nil {
			http.Error(w, "Native OIDC is unavailable", http.StatusServiceUnavailable)
			return
		}
		s.Values = map[interface{}]interface{}{"state": state, "nonce": nonce, "verifier": verifier, "connector": c.digest(), "issued": time.Now().Unix()}
		// An incoming native OAuth challenge stays in this signed transaction.
		if challenge := r.URL.Query().Get("login_challenge"); challenge != "" {
			s.Values["challenge"] = challenge
		}
		if err := s.Save(r, w); err != nil {
			http.Error(w, "Native OIDC is unavailable", http.StatusServiceUnavailable)
			return
		}
		http.Redirect(w, r, oc.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oidc.Nonce(nonce)), http.StatusFound)
		return
	}
	if r.URL.Path != KailoOIDCCallbackPath {
		http.NotFound(w, r)
		return
	}
	s, err := store.Get(r, kailoOIDCCookie)
	if err != nil || s.IsNew {
		http.Error(w, "Invalid OIDC transaction", http.StatusUnauthorized)
		return
	}
	state, _ := s.Values["state"].(string)
	nonce, _ := s.Values["nonce"].(string)
	verifier, _ := s.Values["verifier"].(string)
	digest, _ := s.Values["connector"].(string)
	issued, _ := s.Values["issued"].(int64)
	challenge, _ := s.Values["challenge"].(string)
	// Clear before the external exchange: a failed result is not a replay command.
	s.Values = map[interface{}]interface{}{}
	s.Options.MaxAge = -1
	if err := s.Save(r, w); err != nil {
		http.Error(w, "Invalid OIDC transaction", http.StatusUnauthorized)
		return
	}
	q := r.URL.Query()
	if state == "" || nonce == "" || verifier == "" || digest != c.digest() || issued <= 0 || time.Now().Unix()-issued > int64(c.Config.TransactionMaxAgeSeconds) || issued > time.Now().Unix() || len(q["state"]) != 1 || len(q["code"]) != 1 || q.Get("code") == "" || q.Has("error") || subtle.ConstantTimeCompare([]byte(state), []byte(q.Get("state"))) != 1 {
		http.Error(w, "Invalid OIDC transaction", http.StatusUnauthorized)
		return
	}
	provider, oc, err := nativeOIDCProvider(ctx, c)
	if err != nil {
		http.Error(w, "Native OIDC is unavailable", http.StatusServiceUnavailable)
		return
	}
	token, err := oc.Exchange(ctx, q.Get("code"), oauth2.VerifierOption(verifier))
	if err != nil {
		http.Error(w, "OIDC exchange was refused", http.StatusUnauthorized)
		return
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok {
		http.Error(w, "OIDC identity is unavailable", http.StatusUnauthorized)
		return
	}
	id, err := provider.Verifier(&oidc.Config{ClientID: c.Config.ClientID}).Verify(ctx, raw)
	if err != nil || id.Nonce != nonce {
		http.Error(w, "OIDC identity is invalid", http.StatusUnauthorized)
		return
	}
	// A changed/revoked native connector or user link cannot finish an older
	// browser transaction, including a change during discovery/token exchange.
	fresh, err := loadKailoOIDC(ctx)
	if err != nil || fresh.digest() != c.digest() {
		http.Error(w, "Native OIDC configuration changed", http.StatusUnauthorized)
		return
	}
	uuid, err := c.nativeUserUUID(id.Issuer, id.Subject)
	if err != nil {
		http.Error(w, "OIDC identity is not linked", http.StatusForbidden)
		return
	}
	// SearchOne on the actual native UUID bypasses the quick user cache. Do not
	// accept an email/login claim, IdP groups, or create a fallback native user.
	query, _ := anypb.New(&idm.UserSingleQuery{Uuid: uuid, NodeType: idm.NodeType_USER})
	userResponse, err := idmc.UserServiceClient(ctx).SearchOne(ctx, &idm.SearchUserRequest{Query: &service.Query{SubQueries: []*anypb.Any{query}, Operation: service.OperationType_AND}})
	if err != nil || userResponse.GetUser() == nil || userResponse.GetUser().GetUuid() != uuid || userResponse.GetUser().GetLogin() == "" || userResponse.GetUser().GetIsGroup() || userResponse.GetUser().IsHidden() {
		http.Error(w, "Native user is unavailable", http.StatusForbidden)
		return
	}
	user := userResponse.GetUser()
	if err := auth.VerifyContext(ctx, user); err != nil {
		http.Error(w, "Native login is not permitted", http.StatusForbidden)
		return
	}
	// Use the same native policy service as LoginSuccessWrapper before minting
	// the code; a cached earlier allow or an unavailable service is not enough.
	policyContext := make(map[string]string)
	permissions.PolicyContextFromMetadata(policyContext, ctx)
	policy, err := idm.NewPolicyEngineServiceClient(clientgrpc.ResolveConn(ctx, common.ServicePolicyGRPC)).IsAllowed(ctx, &idm.PolicyEngineRequest{
		Subjects: permissions.PolicyRequestSubjectsFromUser(ctx, user, false),
		Resource: "oidc", Action: "login", Context: policyContext,
	})
	if err != nil || !policy.GetAllowed() {
		http.Error(w, "Native login is not permitted", http.StatusForbidden)
		return
	}
	if challenge == "" {
		login, err := hydra.CreateLogin(ctx, config.DefaultOAuthClientID, []string{"openid", "profile", "offline"}, nil)
		if err != nil || login == nil || login.GetChallenge() == "" {
			http.Error(w, "Native login is unavailable", http.StatusServiceUnavailable)
			return
		}
		challenge = login.GetChallenge()
	}
	before, err := hydra.GetLogin(ctx, challenge)
	if err != nil {
		http.Error(w, "Native login is unavailable", http.StatusServiceUnavailable)
		return
	}
	redirect, err := nativeFrontendCallback(cb, before)
	if err != nil {
		http.Error(w, "Invalid native callback", http.StatusUnauthorized)
		return
	}
	login, code, err := auth.DefaultJWTVerifier().LoginChallengeCode(ctx, claim.Claims{Subject: user.Uuid, Name: user.Login, Email: user.GetAttributes()["email"], AuthSource: c.ID}, auth.SetChallenge(challenge))
	if err != nil || login == nil || code == "" {
		http.Error(w, "Native login is unavailable", http.StatusServiceUnavailable)
		return
	}
	// The original Cells callback exchanges its own one-use code and executes
	// LoginSuccessWrapper (native lock/hidden/policy/ACL checks) again.
	confirmed, err := nativeFrontendCallback(cb, login)
	if err != nil || confirmed.String() != redirect.String() || login.GetChallenge() != before.GetChallenge() {
		http.Error(w, "Invalid native callback", http.StatusUnauthorized)
		return
	}
	values := redirect.Query()
	values.Set("code", code)
	redirect.RawQuery = values.Encode()
	http.Redirect(w, r, redirect.String(), http.StatusSeeOther)
}
