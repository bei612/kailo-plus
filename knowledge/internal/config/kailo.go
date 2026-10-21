package config

import (
	"fmt"
	"os"
	"strings"
)

// Kailo organisation sync modes (Kailo DD-133 §3).
const (
	// KailoOrgSyncRequired derives every login's native spaces, roles and
	// organisation from the verified Kailo organisation claim. A login without
	// a valid claim is refused instead of falling back to a personal space.
	KailoOrgSyncRequired = "required"
	// KailoOrgSyncDisabled keeps native membership management.
	KailoOrgSyncDisabled = "disabled"

	// DefaultKailoOrgClaim is the claim carrying the Kailo organisation
	// projection on the component's dedicated OIDC client.
	DefaultKailoOrgClaim = "kailo_org"
)

// KailoIntegrationConfig switches the native service into the Kailo embedded
// product (Kailo DD-133): OIDC is the only way in, local password accounts,
// registration, invitations and native membership edits are closed, and
// membership is projected from Kailo on every login.
type KailoIntegrationConfig struct {
	Enable   bool   `yaml:"enable"    json:"enable"`
	OrgClaim string `yaml:"org_claim" json:"org_claim"`
	OrgSync  string `yaml:"org_sync"  json:"org_sync"`
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

// KailoOrgSyncRequired reports whether OIDC logins must carry the Kailo
// organisation claim and have their membership derived from it.
func (c *Config) KailoOrgSyncRequired() bool {
	return c.KailoEnabled() && c.Kailo.OrgSync == KailoOrgSyncRequired
}

// KailoOrgClaimName returns the configured organisation claim name.
func (c *Config) KailoOrgClaimName() string {
	if c == nil || c.Kailo == nil || strings.TrimSpace(c.Kailo.OrgClaim) == "" {
		return DefaultKailoOrgClaim
	}
	return strings.TrimSpace(c.Kailo.OrgClaim)
}

func applyKailoEnvOverrides(cfg *Config) {
	if cfg.Kailo == nil {
		cfg.Kailo = &KailoIntegrationConfig{}
	}
	if value := strings.TrimSpace(os.Getenv("KAILO_INTEGRATION_ENABLE")); value != "" {
		cfg.Kailo.Enable = strings.EqualFold(value, "true")
	}
	if value := strings.TrimSpace(os.Getenv("KAILO_ORG_CLAIM")); value != "" {
		cfg.Kailo.OrgClaim = value
	}
	if value := strings.TrimSpace(os.Getenv("KAILO_ORG_SYNC")); value != "" {
		cfg.Kailo.OrgSync = strings.ToLower(value)
	}
	if strings.TrimSpace(cfg.Kailo.OrgClaim) == "" {
		cfg.Kailo.OrgClaim = DefaultKailoOrgClaim
	}
	if strings.TrimSpace(cfg.Kailo.OrgSync) == "" {
		if cfg.Kailo.Enable {
			cfg.Kailo.OrgSync = KailoOrgSyncRequired
		} else {
			cfg.Kailo.OrgSync = KailoOrgSyncDisabled
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
	switch cfg.Kailo.OrgSync {
	case KailoOrgSyncRequired, KailoOrgSyncDisabled:
	default:
		errs = append(errs, fmt.Sprintf("kailo.org_sync must be %q or %q, got %q",
			KailoOrgSyncRequired, KailoOrgSyncDisabled, cfg.Kailo.OrgSync))
	}
	return errs
}
