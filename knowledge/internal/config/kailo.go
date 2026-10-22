package config

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// DefaultKailoSessionMaxLifetime bounds a native session in Kailo mode. It
// equals the identity provider's default SSO session maximum, so a native
// session never outlives the Kailo sign-in it came from (07 §4.7.5).
const DefaultKailoSessionMaxLifetime = 10 * time.Hour

var kailoTenantIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{1,140}$`)

// KailoIntegrationConfig switches the native service into the Kailo embedded
// product (Kailo DD-133, 07 §4.7): OIDC is the only way in, local password
// accounts, registration, invitations and native membership edits are
// closed, and every login is placed in the Kailo Tenant this dedicated
// instance serves (07 §4.7.4, DEDICATED_INSTANCE).
type KailoIntegrationConfig struct {
	Enable bool `yaml:"enable" json:"enable"`
	// TenantID / TenantName identify the Kailo Tenant of the binding this
	// deployment unit serves (deployment facts, never request input).
	TenantID   string `yaml:"tenant_id"   json:"tenant_id"`
	TenantName string `yaml:"tenant_name" json:"tenant_name"`
	// SessionMaxLifetime caps a native session including refresh rotations.
	SessionMaxLifetime time.Duration `yaml:"session_max_lifetime" json:"session_max_lifetime"`
}

// KailoEnabled reports whether the Kailo embedded product mode is on.
func (c *Config) KailoEnabled() bool {
	return c != nil && c.Kailo != nil && c.Kailo.Enable
}

// LocalAuthDisabled reports whether local password login, registration,
// invitation redemption and password changes are closed. In Kailo mode the
// only identity is the Kailo OIDC identity.
func (c *Config) LocalAuthDisabled() bool {
	return c.KailoEnabled()
}

// KailoSessionMaxLifetime returns the native session cap in Kailo mode, or 0
// (no cap) in native mode.
func (c *Config) KailoSessionMaxLifetime() time.Duration {
	if !c.KailoEnabled() {
		return 0
	}
	if c.Kailo.SessionMaxLifetime <= 0 {
		return DefaultKailoSessionMaxLifetime
	}
	return c.Kailo.SessionMaxLifetime
}

func applyKailoEnvOverrides(cfg *Config) {
	if cfg.Kailo == nil {
		cfg.Kailo = &KailoIntegrationConfig{}
	}
	if value := strings.TrimSpace(os.Getenv("KAILO_INTEGRATION_ENABLE")); value != "" {
		cfg.Kailo.Enable = strings.EqualFold(value, "true")
	}
	if value := strings.TrimSpace(os.Getenv("KAILO_TENANT_ID")); value != "" {
		cfg.Kailo.TenantID = value
	}
	if value := os.Getenv("KAILO_TENANT_NAME"); strings.TrimSpace(value) != "" {
		cfg.Kailo.TenantName = strings.Join(strings.Fields(value), " ")
	}
	if value := strings.TrimSpace(os.Getenv("KAILO_SESSION_MAX_LIFETIME")); value != "" {
		if d, err := time.ParseDuration(value); err == nil {
			cfg.Kailo.SessionMaxLifetime = d
		} else {
			cfg.Kailo.SessionMaxLifetime = -1
		}
	}
}

func validateKailoConfig(cfg *Config) []string {
	if cfg == nil || cfg.Kailo == nil || !cfg.Kailo.Enable {
		return nil
	}
	var errs []string
	if cfg.OIDCAuth == nil || !cfg.OIDCAuth.Enable {
		errs = append(errs, "kailo.enable requires oidc_auth.enable: Kailo users sign in only through the Kailo identity provider")
	}
	if !kailoTenantIDPattern.MatchString(cfg.Kailo.TenantID) {
		errs = append(errs, "kailo.tenant_id must be the Kailo Tenant id of this deployment (letters, digits, . _ : -)")
	}
	if name := strings.TrimSpace(cfg.Kailo.TenantName); name == "" || utf8.RuneCountInString(name) > 100 {
		errs = append(errs, "kailo.tenant_name must be the Kailo Tenant display name (1-100 characters)")
	}
	if cfg.Kailo.SessionMaxLifetime < 0 {
		errs = append(errs, fmt.Sprintf("kailo.session_max_lifetime must be a positive duration, got %v", cfg.Kailo.SessionMaxLifetime))
	}
	return errs
}
