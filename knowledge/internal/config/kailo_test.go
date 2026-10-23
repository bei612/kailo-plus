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

func kailoDirectoryEnv(t *testing.T) {
	t.Helper()
	t.Setenv("KAILO_INTEGRATION_ENABLE", "true")
	t.Setenv("KAILO_TENANT_ID", "6179e160-0000-4000-8000-000000000001")
	t.Setenv("KAILO_TENANT_NAME", "Acme")
	t.Setenv("KAILO_DIRECTORY_BINDING_ID", "0b3c1f9e-0000-4000-8000-0000000000aa")
	t.Setenv("KAILO_DIRECTORY_CLIENT_ID", "kailo-knowledge-directory")
	t.Setenv("KAILO_DIRECTORY_CLIENT_SECRET_FILE", "/run/secrets/kailo_directory_client_secret")
	t.Setenv("KAILO_DIRECTORY_TOKEN_URL", "http://idp.example:8080/realms/kailo/protocol/openid-connect/token")
	t.Setenv("KAILO_DIRECTORY_CORE_URL", "http://core-bff:8081")
	t.Setenv("KAILO_DIRECTORY_INTERVAL_SECONDS", "")
}

func directoryConfig() *Config {
	return &Config{OIDCAuth: &OIDCAuthConfig{Enable: true, ClientID: "kailo-knowledge-native",
		IssuerURL: "http://idp.example:8080/realms/kailo"}}
}

func TestKailoDirectoryEnvIsOneGroup(t *testing.T) {
	kailoDirectoryEnv(t)
	cfg := directoryConfig()
	applyKailoEnvOverrides(cfg)
	if errs := validateKailoConfig(cfg); len(errs) != 0 {
		t.Fatalf("complete directory group rejected: %v", errs)
	}
	d := cfg.KailoDirectory()
	if d == nil || d.Interval != DefaultKailoDirectoryInterval || d.CoreURL != "http://core-bff:8081" {
		t.Fatalf("directory = %+v", d)
	}
	t.Setenv("KAILO_DIRECTORY_INTERVAL_SECONDS", "15")
	cfg = directoryConfig()
	applyKailoEnvOverrides(cfg)
	if cfg.KailoDirectory().Interval != 15*time.Second {
		t.Fatalf("interval = %v", cfg.KailoDirectory().Interval)
	}

	// A partial group is refused rather than silently left undelivered.
	t.Setenv("KAILO_DIRECTORY_CORE_URL", "")
	cfg = directoryConfig()
	applyKailoEnvOverrides(cfg)
	if errs := validateKailoConfig(cfg); len(errs) != 1 {
		t.Fatalf("errors = %v, want the missing Core URL", errs)
	}
	for name, value := range map[string]string{
		"KAILO_DIRECTORY_CORE_URL":           "http://core-bff:8081/service",
		"KAILO_DIRECTORY_BINDING_ID":         "not-a-uuid",
		"KAILO_DIRECTORY_CLIENT_ID":          "kailo-knowledge-native",
		"KAILO_DIRECTORY_CLIENT_SECRET_FILE": "relative/secret",
		"KAILO_DIRECTORY_TOKEN_URL":          "ftp://idp.example/token",
		"KAILO_DIRECTORY_INTERVAL_SECONDS":   "5",
	} {
		kailoDirectoryEnv(t)
		t.Setenv(name, value)
		cfg = directoryConfig()
		applyKailoEnvOverrides(cfg)
		if errs := validateKailoConfig(cfg); len(errs) != 1 {
			t.Fatalf("%s=%s: errors = %v, want one", name, value, errs)
		}
	}
	kailoDirectoryEnv(t)
	cfg = directoryConfig()
	cfg.OIDCAuth.IssuerURL = ""
	applyKailoEnvOverrides(cfg)
	if errs := validateKailoConfig(cfg); len(errs) != 1 {
		t.Fatalf("errors = %v, want the issuer requirement", errs)
	}
}

func TestKailoDirectoryUnsetIsNotDelivered(t *testing.T) {
	kailoDirectoryEnv(t)
	for _, name := range []string{"KAILO_DIRECTORY_BINDING_ID", "KAILO_DIRECTORY_CLIENT_ID",
		"KAILO_DIRECTORY_CLIENT_SECRET_FILE", "KAILO_DIRECTORY_TOKEN_URL", "KAILO_DIRECTORY_CORE_URL"} {
		t.Setenv(name, "")
	}
	cfg := directoryConfig()
	applyKailoEnvOverrides(cfg)
	if errs := validateKailoConfig(cfg); len(errs) != 0 || cfg.KailoDirectory() != nil {
		t.Fatalf("an unset directory must leave the pre-directory behaviour: %v %+v", errs, cfg.KailoDirectory())
	}
	t.Setenv("KAILO_DIRECTORY_INTERVAL_SECONDS", "60")
	cfg = directoryConfig()
	applyKailoEnvOverrides(cfg)
	if errs := validateKailoConfig(cfg); len(errs) != 1 {
		t.Fatalf("an interval without a directory must be refused: %v", errs)
	}
}

// DD-138(4): the long-answer notification threshold.
func TestKailoLongAnswerNotifyAfter(t *testing.T) {
	t.Setenv("KAILO_INTEGRATION_ENABLE", "true")
	t.Setenv("KAILO_LONG_ANSWER_NOTIFY_SECONDS", "")
	cfg := &Config{OIDCAuth: &OIDCAuthConfig{Enable: true}}
	applyKailoEnvOverrides(cfg)
	if cfg.KailoLongAnswerNotifyAfter() != DefaultKailoLongAnswerNotifyAfter {
		t.Fatalf("default threshold = %v", cfg.KailoLongAnswerNotifyAfter())
	}
	t.Setenv("KAILO_LONG_ANSWER_NOTIFY_SECONDS", "90")
	applyKailoEnvOverrides(cfg)
	if cfg.KailoLongAnswerNotifyAfter() != 90*time.Second {
		t.Fatalf("configured threshold = %v", cfg.KailoLongAnswerNotifyAfter())
	}
	t.Setenv("KAILO_LONG_ANSWER_NOTIFY_SECONDS", "soon")
	applyKailoEnvOverrides(cfg)
	found := false
	for _, err := range validateKailoConfig(cfg) {
		if err == "kailo.long_answer_notify_after must be a positive duration" {
			found = true
		}
	}
	if !found {
		t.Fatal("an invalid threshold must be refused")
	}
}
