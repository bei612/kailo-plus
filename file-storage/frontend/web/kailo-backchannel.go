package web

// OIDC Back-Channel Logout receiver of the Cells connector client (07 §4.7.5,
// DD-133). The IdP posts a signed logout_token server to server after the
// Kailo sign-out ended its SSO session; the recorded native sessions of that
// sid (or iss+sub) are ended through auth.EndNativeOIDCSessions. No cookie,
// browser session or redirect is involved.
import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"go.uber.org/zap"

	"github.com/pydio/cells/v5/common/auth"
	"github.com/pydio/cells/v5/common/telemetry/log"
)

const (
	KailoOIDCBackchannelLogoutPath = "/auth/kailo/backchannel-logout"
	kailoBackchannelEvent          = "http://schemas.openid.net/event/backchannel-logout"
	kailoLogoutTokenMaxBytes       = 64 << 10
	// Allowed clock skew for iat/exp of a logout_token.
	kailoLogoutTokenSkew = 60 * time.Second
)

// Asymmetric signatures only: "none" and HMAC are refused.
var kailoLogoutTokenAlgs = []string{oidc.RS256, oidc.RS384, oidc.RS512, oidc.ES256, oidc.ES384, oidc.ES512, oidc.PS256, oidc.PS384, oidc.PS512, oidc.EdDSA}

type kailoLogoutClaims struct {
	Events map[string]json.RawMessage `json:"events"`
	Nonce  *json.RawMessage           `json:"nonce"`
	SID    string                     `json:"sid"`
	JTI    string                     `json:"jti"`
	IAT    *int64                     `json:"iat"`
	EXP    *int64                     `json:"exp"`
}

func kailoDigest(value string) string {
	if value == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:12]
}

// verifyKailoLogoutToken applies the 07 §4.7.5 token rules; the error text
// is never returned to the caller.
func verifyKailoLogoutToken(ctx context.Context, verifier *oidc.IDTokenVerifier, raw string, maxAge time.Duration, now time.Time) (*oidc.IDToken, kailoLogoutClaims, error) {
	var claims kailoLogoutClaims
	token, err := verifier.Verify(ctx, raw)
	if err != nil {
		return nil, claims, err
	}
	if err := token.Claims(&claims); err != nil {
		return nil, claims, err
	}
	if _, ok := claims.Events[kailoBackchannelEvent]; !ok {
		return nil, claims, errors.New("not a back-channel logout event")
	}
	if claims.Nonce != nil || token.Nonce != "" {
		return nil, claims, errors.New("a logout token carries no nonce")
	}
	if claims.SID == "" && token.Subject == "" {
		return nil, claims, errors.New("logout token names neither sid nor sub")
	}
	if claims.JTI == "" || claims.IAT == nil {
		return nil, claims, errors.New("logout token lacks jti or iat")
	}
	iat := time.Unix(*claims.IAT, 0)
	if iat.After(now.Add(kailoLogoutTokenSkew)) || now.Sub(iat) > maxAge {
		return nil, claims, errors.New("logout token is outside its time window")
	}
	if claims.EXP != nil && time.Unix(*claims.EXP, 0).Before(now.Add(-kailoLogoutTokenSkew)) {
		return nil, claims, errors.New("logout token expired")
	}
	return token, claims, nil
}

// NativeKailoOIDCBackchannelLogout serves POST /auth/kailo/backchannel-logout.
func NativeKailoOIDCBackchannelLogout(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	c, err := loadKailoOIDC(r.Context())
	if err != nil || c.Config.BackchannelLogout == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	if media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || media != "application/x-www-form-urlencoded" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, kailoLogoutTokenMaxBytes)
	if err := r.ParseForm(); err != nil || len(r.PostForm["logout_token"]) != 1 || r.PostForm.Get("logout_token") == "" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	timeout, _ := time.ParseDuration(c.Config.RequestTimeout)
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	ctx = oidc.ClientContext(ctx, &http.Client{Timeout: timeout})
	provider, err := oidc.NewProvider(ctx, c.Config.Issuer)
	if err != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	// iss, aud (connector client) and signature by the issuer JWKS; expiry is
	// checked below with the logout-token rules (exp is optional there).
	verifier := provider.Verifier(&oidc.Config{ClientID: c.Config.ClientID, SupportedSigningAlgs: kailoLogoutTokenAlgs, SkipExpiryCheck: true})
	maxAge := time.Duration(c.Config.BackchannelLogout.LogoutTokenMaxAgeSeconds) * time.Second
	now := time.Now()
	token, claims, err := verifyKailoLogoutToken(ctx, verifier, r.PostForm.Get("logout_token"), maxAge, now)
	if err != nil {
		log.Logger(ctx).Info("Kailo back-channel logout refused", zap.Error(err))
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	ended, err := auth.EndNativeOIDCSessions(ctx, token.Issuer, token.Subject, claims.SID, claims.JTI,
		time.Unix(*claims.IAT, 0).Add(maxAge+kailoLogoutTokenSkew))
	if errors.Is(err, auth.ErrNativeOIDCLogoutReplay) {
		log.Logger(ctx).Info("Kailo back-channel logout replay refused", zap.String("sid", kailoDigest(claims.SID)), zap.String("sub", kailoDigest(token.Subject)))
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if err != nil {
		log.Logger(ctx).Error("Kailo back-channel logout failed", zap.String("sid", kailoDigest(claims.SID)), zap.String("sub", kailoDigest(token.Subject)))
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	log.Logger(ctx).Info("Kailo back-channel logout ended native sessions", zap.String("sid", kailoDigest(claims.SID)),
		zap.String("sub", kailoDigest(token.Subject)), zap.Int("sessions", ended))
	w.WriteHeader(http.StatusOK)
}
