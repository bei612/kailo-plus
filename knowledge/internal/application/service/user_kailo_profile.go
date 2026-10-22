package service

import (
	"context"
	"fmt"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
)

const (
	usernameMaxRunes = 100
	avatarMaxBytes   = 500
)

var oidcLocalePattern = regexp.MustCompile(`^[A-Za-z]{2,3}([-_][A-Za-z0-9]{2,8}){0,3}$`)

// refreshOIDCProfile copies the Kailo profile carried by the verified OIDC
// claims onto the native account on every login (Kailo DD-133 §3): display
// name, email, avatar and locale. The identity key stays iss+sub; none of
// these fields is used to find or link an account.
func (s *userService) refreshOIDCProfile(ctx context.Context, user *types.User, info *types.OIDCUserInfo) error {
	changed := false

	if name := s.oidcDisplayName(ctx, user, info); name != "" && name != user.Username {
		user.Username = name
		changed = true
	}

	// 07 §4.7.3: email is profile data only and is written only when the
	// identity provider says it is verified.
	if email := strings.TrimSpace(info.Email); email != "" && !strings.EqualFold(email, user.Email) &&
		oidcClaimIsTrue(info.Claims, "email_verified") {
		other, err := s.userRepo.GetUserByEmail(ctx, email)
		switch {
		case err != nil && !isUserLookupNotFound(err):
			return fmt.Errorf("failed to check OIDC email: %w", err)
		case other != nil && other.ID != user.ID:
			// Another native account owns this address. Keep the previous
			// address rather than refusing the login or merging accounts.
			logger.Warnf(ctx, "OIDC profile refresh: email of user %s is used by another account; keeping the previous one", user.ID)
		default:
			user.Email = email
			changed = true
		}
	}

	if avatar := oidcAvatar(info.Claims); avatar != user.Avatar {
		user.Avatar = avatar
		changed = true
	}

	locale := oidcLocale(info.Claims)
	if !sameOptionalString(locale, user.Preferences.Locale) {
		user.Preferences.Locale = locale
		changed = true
	}

	if !changed {
		return nil
	}
	user.UpdatedAt = time.Now()
	if err := s.userRepo.UpdateUser(ctx, user); err != nil {
		return fmt.Errorf("failed to refresh OIDC profile: %w", err)
	}
	return nil
}

// oidcDisplayName returns the Kailo display name to store as the native
// username, or "" to keep the current one. Native usernames are unique, so
// when another account already shows the same name the preferred username is
// appended; if that is taken too the current name is kept.
func (s *userService) oidcDisplayName(ctx context.Context, user *types.User, info *types.OIDCUserInfo) string {
	base := normaliseDisplayName(info.Username)
	if base == "" {
		return ""
	}
	candidates := []string{base}
	if handle := normaliseDisplayName(extractClaimAsString(info.Claims, "preferred_username")); handle != "" && handle != base {
		candidates = append(candidates, truncateRunes(base+" ("+handle+")", usernameMaxRunes))
	}
	for _, candidate := range candidates {
		if candidate == user.Username {
			return candidate
		}
		other, err := s.userRepo.GetUserByUsername(ctx, candidate)
		if err != nil && !isUserLookupNotFound(err) {
			logger.Warnf(ctx, "OIDC profile refresh: failed to check username: %v", err)
			return ""
		}
		if other == nil || other.ID == user.ID {
			return candidate
		}
	}
	return ""
}

func normaliseDisplayName(value string) string {
	return truncateRunes(strings.Join(strings.Fields(value), " "), usernameMaxRunes)
}

func truncateRunes(value string, max int) string {
	if utf8.RuneCountInString(value) <= max {
		return value
	}
	return string([]rune(value)[:max])
}

// oidcAvatar accepts only an absolute http(s) picture URL that fits the
// native column; anything else clears the avatar so a stale picture never
// outlives the Kailo profile.
func oidcAvatar(claims map[string]interface{}) string {
	raw := extractClaimAsString(claims, "picture")
	if raw == "" || len(raw) > avatarMaxBytes {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || parsed.User != nil ||
		(parsed.Scheme != "https" && parsed.Scheme != "http") {
		return ""
	}
	return raw
}

func oidcLocale(claims map[string]interface{}) *string {
	raw := extractClaimAsString(claims, "locale")
	if raw == "" || !oidcLocalePattern.MatchString(raw) {
		return nil
	}
	value := strings.ReplaceAll(raw, "_", "-")
	return &value
}

func oidcClaimIsTrue(claims map[string]interface{}, key string) bool {
	switch v := claims[key].(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(strings.TrimSpace(v), "true")
	default:
		return false
	}
}

func sameOptionalString(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}
