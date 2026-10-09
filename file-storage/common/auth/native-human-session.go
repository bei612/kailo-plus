package auth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/sessions"

	"github.com/pydio/cells/v5/common/auth/claim"
	"github.com/pydio/cells/v5/common/config"
	"github.com/pydio/cells/v5/common/config/routing"
	"github.com/pydio/cells/v5/common/service/frontend/sessions/utils"
)

const nativeHumanCookie = "cells_native_human"

// This is a native encrypted session credential, not a platform cookie or an
// account/permission projection. It is never returned by a JSON/UI endpoint.
func nativeHumanStore(ctx context.Context) (*sessions.CookieStore, error) {
	key, err := utils.LoadKey(ctx)
	origin, originError := url.Parse(routing.GetDefaultSiteURL(ctx))
	if err != nil || len(key) < 64 || originError != nil || origin.Host == "" ||
		(origin.Scheme != "https" && origin.Scheme != "http") {
		return nil, errors.New("native human session is unavailable")
	}
	store := sessions.NewCookieStore(key[:32], key[32:64])
	store.Options = &sessions.Options{Path: "/", HttpOnly: true, Secure: origin.Scheme == "https", SameSite: http.SameSiteStrictMode}
	return store, nil
}

// SaveNativeHumanToken is called only after the native OIDC callback has
// independently verified the access JWT and matched its issuer/audience/subject
// to the ID-token transaction and the exact existing native user.
func SaveNativeHumanToken(r *http.Request, w http.ResponseWriter, token, issuer, subject, audience, nativeUser, nativeSession string, expires time.Time) error {
	store, err := nativeHumanStore(r.Context())
	if err != nil || token == "" || strings.ContainsAny(token, "\r\n") || issuer == "" || subject == "" || audience == "" || nativeUser == "" || nativeSession == "" || !expires.After(time.Now()) {
		return errors.New("native human session cannot be established")
	}
	// A freshly verified login replaces this one credential. A corrupt previous
	// cookie is not a reason to preserve it or to reuse its values.
	s := sessions.NewSession(store, nativeHumanCookie)
	options := *store.Options
	s.Options = &options
	s.Values = map[interface{}]interface{}{"accessToken": token, "issuer": issuer, "subject": subject, "audience": audience,
		"nativeUser": nativeUser, "nativeSession": nativeSession, "expires": expires.Unix()}
	s.Options.MaxAge = int(time.Until(expires).Seconds())
	if s.Options.MaxAge <= 0 || s.Save(r, w) != nil {
		return errors.New("native human session cannot be established")
	}
	return nil
}

func ClearNativeHumanToken(r *http.Request, w http.ResponseWriter) error {
	// Independent native installations have no such credential to invalidate.
	if _, err := r.Cookie(nativeHumanCookie); err == http.ErrNoCookie {
		return nil
	}
	store, err := nativeHumanStore(r.Context())
	if err != nil {
		return err
	}
	// Clearing must also work for a corrupt/tampered cookie; decoding it first
	// would make logout depend on an attacker-controlled old credential.
	s := sessions.NewSession(store, nativeHumanCookie)
	options := *store.Options
	s.Options = &options
	s.Values = map[interface{}]interface{}{}
	s.Options.MaxAge = -1
	return s.Save(r, w)
}

// NativeHumanToken binds the backend-only proof to the currently authenticated
// native JWT, fresh original connector and fresh native user/lock checks. A
// Cells refresh does not extend the upstream token: expiry requires real OIDC
// reauthentication, never a fabricated HUMAN token or a SERVICE fallback.
func NativeHumanToken(r *http.Request) (string, error) {
	refused := errors.New("native human session is unavailable")
	store, err := nativeHumanStore(r.Context())
	if err != nil {
		return "", refused
	}
	s, err := store.Get(r, nativeHumanCookie)
	if err != nil || s.IsNew || len(s.Values) != 7 {
		return "", refused
	}
	token, _ := s.Values["accessToken"].(string)
	issuer, _ := s.Values["issuer"].(string)
	subject, _ := s.Values["subject"].(string)
	audience, _ := s.Values["audience"].(string)
	nativeUser, _ := s.Values["nativeUser"].(string)
	nativeSession, _ := s.Values["nativeSession"].(string)
	expires, _ := s.Values["expires"].(int64)
	current, ok := claim.FromContext(r.Context())
	if !ok || current.Subject != nativeUser || nativeSession == "" || current.SessionID != nativeSession || token == "" || expires <= time.Now().Unix() {
		return "", refused
	}
	var connectors []struct {
		ID     string `json:"id"`
		Type   string `json:"type"`
		Config struct {
			Issuer   string `json:"issuer"`
			ClientID string `json:"clientId"`
		} `json:"config"`
	}
	if config.Get(r.Context(), "services", "pydio.web.oauth", "connectors").Scan(&connectors) != nil {
		return "", refused
	}
	matched := false
	for _, connector := range connectors {
		if connector.Type != "kailo-oidc" {
			continue
		}
		if matched || connector.Config.Issuer != issuer || connector.Config.ClientID != audience || connector.ID != current.AuthSource {
			return "", refused
		}
		matched = true
	}
	user, err := ResolveNativeOIDCUser(r.Context(), issuer, subject)
	if !matched || err != nil || user.GetUuid() != nativeUser {
		return "", refused
	}
	return token, nil
}
