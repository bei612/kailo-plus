package config

import "testing"

func TestKailoEnvOverridesDefaultToRequiredOrgSync(t *testing.T) {
	t.Setenv("KAILO_INTEGRATION_ENABLE", "true")
	t.Setenv("KAILO_ORG_CLAIM", "")
	t.Setenv("KAILO_ORG_SYNC", "")
	cfg := &Config{OIDCAuth: &OIDCAuthConfig{Enable: true}}
	applyKailoEnvOverrides(cfg)
	if !cfg.KailoEnabled() || !cfg.LocalAuthDisabled() || !cfg.KailoOrgSyncRequired() {
		t.Fatalf("Kailo mode = %+v", cfg.Kailo)
	}
	if cfg.KailoOrgClaimName() != DefaultKailoOrgClaim {
		t.Fatalf("claim = %q", cfg.KailoOrgClaimName())
	}
	if errs := validateKailoConfig(cfg); len(errs) != 0 {
		t.Fatalf("valid Kailo config rejected: %v", errs)
	}
}

func TestKailoConfigRequiresOIDCAndKnownSyncMode(t *testing.T) {
	cfg := &Config{Kailo: &KailoIntegrationConfig{Enable: true, OrgSync: "maybe"}}
	if errs := validateKailoConfig(cfg); len(errs) != 2 {
		t.Fatalf("errors = %v, want OIDC and org_sync errors", errs)
	}
	var nilCfg *Config
	if nilCfg.KailoEnabled() || nilCfg.LocalAuthDisabled() || nilCfg.KailoOrgSyncRequired() {
		t.Fatal("a nil config must mean native mode")
	}
	if (&Config{}).KailoOrgClaimName() != DefaultKailoOrgClaim {
		t.Fatal("default claim name")
	}
}
