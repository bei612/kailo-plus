package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
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
	// Directory is the Kailo member directory read (DD-133(4), 07 §4.7.4);
	// nil or empty means the directory is not delivered to this instance.
	Directory *KailoDirectoryConfig `yaml:"directory" json:"directory"`
	// LongAnswerNotifyAfter: a chat answer that took at least this long is
	// announced to the person who asked through Kailo notifications
	// (DD-138(4), 07 §4.8.3); 0 means DefaultKailoLongAnswerNotifyAfter.
	LongAnswerNotifyAfter time.Duration `yaml:"long_answer_notify_after" json:"long_answer_notify_after"`
}

// DefaultKailoLongAnswerNotifyAfter is the answer duration from which the
// asker is notified that the answer is ready (DD-138(4)).
const DefaultKailoLongAnswerNotifyAfter = 30 * time.Second

// KailoLongAnswerNotifyAfter returns the effective long-answer threshold.
func (c *Config) KailoLongAnswerNotifyAfter() time.Duration {
	if !c.KailoEnabled() || c.Kailo.LongAnswerNotifyAfter <= 0 {
		return DefaultKailoLongAnswerNotifyAfter
	}
	return c.Kailo.LongAnswerNotifyAfter
}

// Directory poll interval bounds (deployment contract, seconds).
const (
	DefaultKailoDirectoryInterval = 60 * time.Second
	minKailoDirectoryInterval     = 10 * time.Second
	maxKailoDirectoryInterval     = 3600 * time.Second
)

var kailoDirectoryUUIDPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
var kailoDirectoryClientPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,255}$`)

// KailoDirectoryConfig is the member directory read of this instance: the
// native page entry binding, the instance's own confidential directory
// client (client-credentials, audience Core service) and Core's service
// listener. All are deployment facts; the secret only lives in the file.
type KailoDirectoryConfig struct {
	BindingID        string        `yaml:"binding_id"         json:"binding_id"`
	ClientID         string        `yaml:"client_id"          json:"client_id"`
	ClientSecretFile string        `yaml:"client_secret_file" json:"client_secret_file"`
	TokenURL         string        `yaml:"token_url"          json:"token_url"`
	CoreURL          string        `yaml:"core_url"           json:"core_url"`
	Interval         time.Duration `yaml:"interval"           json:"interval"`
}

func (d *KailoDirectoryConfig) anySet() bool {
	return d != nil && (d.BindingID != "" || d.ClientID != "" || d.ClientSecretFile != "" ||
		d.TokenURL != "" || d.CoreURL != "")
}

// KailoDirectory returns the member directory configuration when Kailo mode
// is on and the directory is configured, otherwise nil.
func (c *Config) KailoDirectory() *KailoDirectoryConfig {
	if !c.KailoEnabled() || !c.Kailo.Directory.anySet() {
		return nil
	}
	d := *c.Kailo.Directory
	if d.Interval == 0 {
		d.Interval = DefaultKailoDirectoryInterval
	}
	return &d
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
	if value := strings.TrimSpace(os.Getenv("KAILO_LONG_ANSWER_NOTIFY_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
			cfg.Kailo.LongAnswerNotifyAfter = time.Duration(seconds) * time.Second
		} else {
			cfg.Kailo.LongAnswerNotifyAfter = -1
		}
	}
	directory := map[string]*string{}
	if cfg.Kailo.Directory == nil {
		cfg.Kailo.Directory = &KailoDirectoryConfig{}
	}
	d := cfg.Kailo.Directory
	directory["KAILO_DIRECTORY_BINDING_ID"] = &d.BindingID
	directory["KAILO_DIRECTORY_CLIENT_ID"] = &d.ClientID
	directory["KAILO_DIRECTORY_CLIENT_SECRET_FILE"] = &d.ClientSecretFile
	directory["KAILO_DIRECTORY_TOKEN_URL"] = &d.TokenURL
	directory["KAILO_DIRECTORY_CORE_URL"] = &d.CoreURL
	for name, target := range directory {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			*target = value
		}
	}
	if value := strings.TrimSpace(os.Getenv("KAILO_DIRECTORY_INTERVAL_SECONDS")); value != "" {
		if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
			d.Interval = time.Duration(seconds) * time.Second
		} else {
			d.Interval = -1
		}
	}
}

func absoluteHTTPURL(raw string, allowPath bool) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil &&
		u.RawQuery == "" && u.Fragment == "" && (allowPath || u.Path == "" || u.Path == "/")
}

func validateKailoDirectory(cfg *Config) []string {
	d := cfg.Kailo.Directory
	if !d.anySet() {
		if d != nil && d.Interval != 0 {
			return []string{"kailo.directory.interval is set but the member directory is not configured"}
		}
		return nil
	}
	var errs []string
	// The five keys are one group: a partial group would silently leave the
	// instance on the pre-directory behaviour while looking configured.
	if !kailoDirectoryUUIDPattern.MatchString(d.BindingID) {
		errs = append(errs, "kailo.directory.binding_id must be the native page entry binding UUID")
	}
	if !kailoDirectoryClientPattern.MatchString(d.ClientID) {
		errs = append(errs, "kailo.directory.client_id must be one IdP client id segment")
	}
	if cfg.OIDCAuth != nil && d.ClientID != "" && d.ClientID == strings.TrimSpace(cfg.OIDCAuth.ClientID) {
		errs = append(errs, "kailo.directory.client_id must be the directory client, not the browser client")
	}
	if !filepath.IsAbs(d.ClientSecretFile) {
		errs = append(errs, "kailo.directory.client_secret_file must be an absolute path")
	}
	if !absoluteHTTPURL(d.TokenURL, true) {
		errs = append(errs, "kailo.directory.token_url must be an absolute http(s) URL")
	}
	if !absoluteHTTPURL(d.CoreURL, false) {
		errs = append(errs, "kailo.directory.core_url must be the Core service origin (no path)")
	}
	if d.Interval != 0 && (d.Interval < minKailoDirectoryInterval || d.Interval > maxKailoDirectoryInterval) {
		errs = append(errs, "kailo.directory.interval must be between 10s and 3600s")
	}
	if cfg.OIDCAuth == nil || strings.TrimSpace(cfg.OIDCAuth.IssuerURL) == "" {
		errs = append(errs, "kailo.directory requires oidc_auth.issuer_url: directory identities are matched on it")
	}
	return errs
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
	if cfg.Kailo.LongAnswerNotifyAfter < 0 {
		errs = append(errs, "kailo.long_answer_notify_after must be a positive duration")
	}
	errs = append(errs, validateKailoDirectory(cfg)...)
	return errs
}
