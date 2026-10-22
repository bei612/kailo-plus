package config

import (
	"testing"
	"time"
)

func TestKailoEnvOverrides(t *testing.T) {
	t.Setenv("KAILO_INTEGRATION_ENABLE", "true")
	t.Setenv("KAILO_TENANT_ID", "6179e160-tenant")
	t.Setenv("KAILO_TENANT_NAME", "  Kailo   验证 ")
	t.Setenv("KAILO_SESSION_MAX_LIFETIME", "")
	cfg := &Config{OIDCAuth: &OIDCAuthConfig{Enable: true}}
	applyKailoEnvOverrides(cfg)
	if !cfg.KailoEnabled() || !cfg.LocalAuthDisabled() || cfg.Kailo.TenantName != "Kailo 验证" {
		t.Fatalf("Kailo mode = %+v", cfg.Kailo)
	}
	if cfg.KailoSessionMaxLifetime() != DefaultKailoSessionMaxLifetime {
		t.Fatalf("session cap = %v", cfg.KailoSessionMaxLifetime())
	}
	if errs := validateKailoConfig(cfg); len(errs) != 0 {
		t.Fatalf("valid Kailo config rejected: %v", errs)
	}
	t.Setenv("KAILO_SESSION_MAX_LIFETIME", "8h")
	applyKailoEnvOverrides(cfg)
	if cfg.KailoSessionMaxLifetime() != 8*time.Hour {
		t.Fatalf("session cap = %v", cfg.KailoSessionMaxLifetime())
	}
}

func TestKailoConfigRequiresOIDCTenantAndValidLifetime(t *testing.T) {
	t.Setenv("KAILO_SESSION_MAX_LIFETIME", "forever")
	cfg := &Config{Kailo: &KailoIntegrationConfig{Enable: true, TenantID: "bad id/", TenantName: " "}}
	applyKailoEnvOverrides(cfg)
	if errs := validateKailoConfig(cfg); len(errs) != 4 {
		t.Fatalf("errors = %v, want OIDC, tenant id, tenant name and lifetime errors", errs)
	}
	var nilCfg *Config
	if nilCfg.KailoEnabled() || nilCfg.LocalAuthDisabled() || nilCfg.KailoSessionMaxLifetime() != 0 {
		t.Fatal("a nil config must mean native mode")
	}
}
