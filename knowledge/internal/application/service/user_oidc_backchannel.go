package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
)

// oidcBackchannelLogoutEvent is the event member a logout token must carry
// (OpenID Connect Back-Channel Logout 1.0 §2.4).
const oidcBackchannelLogoutEvent = "http://schemas.openid.net/event/backchannel-logout"

// oidcLogoutTokenMaxAge bounds how old a logout token may be when it arrives;
// its jti is remembered for the same window to refuse replays.
const oidcLogoutTokenMaxAge = 10 * time.Minute

var (
	// ErrInvalidLogoutToken is returned for any logout token that fails
	// validation, including a replayed jti; the handler answers 400.
	ErrInvalidLogoutToken = errors.New("invalid logout token")
	// ErrNativeSessionExpired is returned when a Kailo-bound native session
	// has reached its deadline or cannot be continued.
	ErrNativeSessionExpired = errors.New("native session expired")
)

// nativeSession is what a native token pair remembers about the sign-in it
// came from (Kailo DD-133, 07 §4.7.5): the identity-provider session id and
// the latest instant the session may live.
type nativeSession struct {
	sid      *string
	deadline *time.Time
}

// newKailoSession starts a Kailo-bound session from the verified ID token
// claims: the IdP `sid` (when present) and a deadline no later than the
// configured cap, so the native session never outlives the IdP SSO session.
func newKailoSession(claims map[string]interface{}, maxLifetime time.Duration) nativeSession {
	deadline := time.Now().Add(maxLifetime)
	session := nativeSession{deadline: &deadline}
	if sid := extractClaimAsString(claims, "sid"); sid != "" {
		session.sid = &sid
	}
	return session
}

func sessionOfToken(record *types.AuthToken) nativeSession {
	if record == nil {
		return nativeSession{}
	}
	return nativeSession{sid: record.OIDCSID, deadline: record.SessionExpiresAt}
}

func (s nativeSession) isKailo() bool { return s.deadline != nil }

// cap bounds an expiry by the session deadline.
func (s nativeSession) cap(expiry time.Time) time.Time {
	if s.deadline != nil && s.deadline.Before(expiry) {
		return *s.deadline
	}
	return expiry
}

// logDigest identifies a sid/sub in logs without recording its value.
func logDigest(value string) string {
	if value == "" {
		return "-"
	}
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:6])
}

// LogoutByOIDCBackchannel validates an OpenID Connect back-channel logout
// token sent by the identity provider when the Kailo session ends (07
// §4.7.5) and ends the matching native sessions: those created from the
// token's `sid`, or every session of its iss+sub when no sid is given. An
// unknown subject is a successful no-op: the person may never have opened
// the knowledge page. Validation failures (including a replayed jti) return
// ErrInvalidLogoutToken; storage failures are returned as is.
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
	if s.logoutRepo == nil {
		return errors.New("back-channel logout storage is not configured")
	}
	subject := extractClaimAsString(claims, "sub")
	sid := extractClaimAsString(claims, "sid")
	jti := extractClaimAsString(claims, "jti")
	issuedAt, _ := jwt.MapClaims(claims).GetIssuedAt()
	fresh, err := s.logoutRepo.RecordLogoutTokenID(ctx, jti, issuedAt.Add(oidcLogoutTokenMaxAge+2*oidcIDTokenLeeway))
	if err != nil {
		return fmt.Errorf("failed to record logout token: %w", err)
	}
	if !fresh {
		logger.Warnf(ctx, "OIDC back-channel logout replay refused (sid %s, sub %s)", logDigest(sid), logDigest(subject))
		return ErrInvalidLogoutToken
	}

	users, err := s.logoutUsers(ctx, strings.TrimSpace(cfg.IssuerURL), subject, sid)
	if err != nil {
		return err
	}
	for _, user := range users {
		if sid != "" {
			if _, err := s.logoutRepo.RevokeTokensBySID(ctx, user.ID, sid); err != nil {
				return fmt.Errorf("failed to revoke sessions: %w", err)
			}
		} else if err := s.tokenRepo.RevokeTokensByUserID(ctx, user.ID); err != nil {
			return fmt.Errorf("failed to revoke sessions: %w", err)
		}
	}
	logger.Infof(ctx, "OIDC back-channel logout ended native sessions (sid %s, sub %s, accounts %d)",
		logDigest(sid), logDigest(subject), len(users))
	return nil
}

// logoutUsers resolves the native accounts a logout token addresses. With a
// sub, only the account bound to iss+sub; with a sid only, every account
// holding a session of that sid (the sid alone identifies the IdP session).
func (s *userService) logoutUsers(ctx context.Context, issuer, subject, sid string) ([]*types.User, error) {
	if subject != "" {
		user, err := s.userRepo.GetUserByOIDCIdentity(ctx, issuer, subject)
		if err != nil && !isUserLookupNotFound(err) {
			return nil, fmt.Errorf("failed to resolve logout subject: %w", err)
		}
		if user == nil || isUserLookupNotFound(err) {
			return nil, nil
		}
		return []*types.User{user}, nil
	}
	ids, err := s.logoutRepo.UserIDsBySID(ctx, sid)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve logout session: %w", err)
	}
	users := make([]*types.User, 0, len(ids))
	for _, id := range ids {
		users = append(users, &types.User{ID: id})
	}
	return users, nil
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
	if extractClaimAsString(verified, "sub") == "" && extractClaimAsString(verified, "sid") == "" {
		return nil, errors.New("logout token has neither sid nor sub")
	}
	if jti := extractClaimAsString(verified, "jti"); jti == "" || len(jti) > 255 {
		return nil, errors.New("logout token needs a jti of at most 255 characters")
	}
	return verified, nil
}
