package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/Tencent/WeKnora/internal/logger"
)

// oidcBackchannelLogoutEvent is the event member a logout token must carry
// (OpenID Connect Back-Channel Logout 1.0 §2.4).
const oidcBackchannelLogoutEvent = "http://schemas.openid.net/event/backchannel-logout"

// oidcLogoutTokenMaxAge bounds how old a logout token may be when it arrives.
const oidcLogoutTokenMaxAge = 10 * time.Minute

// ErrInvalidLogoutToken is returned for any logout token that fails
// validation; the handler answers 400 as the specification requires.
var ErrInvalidLogoutToken = errors.New("invalid logout token")

// LogoutByOIDCBackchannel validates an OpenID Connect back-channel logout
// token sent by the identity provider when the Kailo session ends (Kailo
// DD-133 §2) and revokes every native session of the account bound to the
// token's iss+sub. An unknown subject is a successful no-op: the person may
// never have opened the knowledge page.
func (s *userService) LogoutByOIDCBackchannel(ctx context.Context, logoutToken string) error {
	cfg, err := s.getOIDCConfig(ctx)
	if err != nil {
		return err
	}
	claims, err := s.verifyOIDCLogoutToken(ctx, cfg.JwksURI, cfg.IssuerURL, cfg.ClientID, logoutToken)
	if err != nil {
		logger.Warnf(ctx, "OIDC back-channel logout rejected: %v", err)
		return ErrInvalidLogoutToken
	}
	subject := extractClaimAsString(claims, "sub")
	user, err := s.userRepo.GetUserByOIDCIdentity(ctx, strings.TrimSpace(cfg.IssuerURL), subject)
	if err != nil && !isUserLookupNotFound(err) {
		return fmt.Errorf("failed to resolve logout subject: %w", err)
	}
	if user == nil || isUserLookupNotFound(err) {
		return nil
	}
	if err := s.tokenRepo.RevokeTokensByUserID(ctx, user.ID); err != nil {
		return fmt.Errorf("failed to revoke sessions: %w", err)
	}
	logger.Infof(ctx, "OIDC back-channel logout revoked all sessions of user %s", user.ID)
	return nil
}

func (s *userService) verifyOIDCLogoutToken(
	ctx context.Context, jwksURI, issuer, clientID, token string,
) (map[string]interface{}, error) {
	issuer, clientID = strings.TrimSpace(issuer), strings.TrimSpace(clientID)
	if strings.TrimSpace(jwksURI) == "" || issuer == "" || clientID == "" {
		return nil, errors.New("OIDC issuer, client_id and jwks_uri are required to verify logout tokens")
	}
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("logout_token is required")
	}
	jwks, err := s.fetchOIDCJWKS(ctx, jwksURI)
	if err != nil {
		return nil, err
	}
	keyFunc := func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected logout token signing method: %v", t.Header["alg"])
		}
		kid, _ := t.Header["kid"].(string)
		return jwks.rsaKeyForKid(kid)
	}
	claims := jwt.MapClaims{}
	if _, err := jwt.NewParser(
		jwt.WithValidMethods([]string{"RS256", "RS384", "RS512"}),
		jwt.WithIssuedAt(),
		jwt.WithLeeway(oidcIDTokenLeeway),
		jwt.WithIssuer(issuer),
		jwt.WithAudience(clientID),
	).ParseWithClaims(token, claims, keyFunc); err != nil {
		return nil, fmt.Errorf("logout token verification failed: %w", err)
	}
	verified := map[string]interface{}(claims)
	issuedAt, err := claims.GetIssuedAt()
	if err != nil || issuedAt == nil {
		return nil, errors.New("logout token has no iat")
	}
	if time.Since(issuedAt.Time) > oidcLogoutTokenMaxAge+oidcIDTokenLeeway {
		return nil, errors.New("logout token is too old")
	}
	events, ok := verified["events"].(map[string]interface{})
	if !ok {
		return nil, errors.New("logout token has no events claim")
	}
	if _, ok := events[oidcBackchannelLogoutEvent].(map[string]interface{}); !ok {
		return nil, errors.New("logout token is not a back-channel logout event")
	}
	if _, present := verified["nonce"]; present {
		return nil, errors.New("logout token must not contain a nonce")
	}
	// The native identity key is iss+sub, so a sid-only token cannot be
	// mapped to an account; the Kailo identity provider always sends sub.
	if extractClaimAsString(verified, "sub") == "" {
		return nil, errors.New("logout token has no sub")
	}
	return verified, nil
}
