package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
	"github.com/Tencent/WeKnora/internal/logger"
	"github.com/Tencent/WeKnora/internal/types"
	"github.com/Tencent/WeKnora/internal/types/interfaces"
)

// Kailo member directory read (DD-133(4), 07 §4.7.4): this instance reads
// GET /service/v1/component-directory/bindings/{binding}/members on Core's
// service listener with a client-credentials token of its own directory
// client, every interval, and converges with the snapshot. Anything short of
// a complete, valid snapshot for this binding and Tenant changes nothing.

const (
	kailoDirectorySecretMaxBytes   = 4 << 10
	kailoDirectoryResponseMaxBytes = 16 << 20
	kailoDirectoryTokenMaxBytes    = 64 << 10
	kailoDirectoryTokenTimeout     = 10 * time.Second
	kailoDirectoryReadTimeout      = 30 * time.Second
)

// errKailoDirectoryUnavailable is any failed read; the reason is logged as a
// category only, never with a token, credential or response body.
type kailoDirectoryReadError struct{ category string }

func (e *kailoDirectoryReadError) Error() string { return "member directory unavailable: " + e.category }

func directoryReadError(format string, args ...interface{}) error {
	return &kailoDirectoryReadError{category: fmt.Sprintf(format, args...)}
}

// kailoDirectoryClient reads one snapshot.
type kailoDirectoryClient struct {
	cfg  config.KailoDirectoryConfig
	http *http.Client
}

func newKailoDirectoryClient(cfg config.KailoDirectoryConfig) *kailoDirectoryClient {
	transport := &http.Transport{
		// Deployment-declared private endpoints: no proxy, no redirects.
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: kailoDirectoryReadTimeout,
		MaxIdleConns:          2,
		IdleConnTimeout:       90 * time.Second,
	}
	return &kailoDirectoryClient{cfg: cfg, http: &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}}
}

func (c *kailoDirectoryClient) secret() (string, error) {
	file, err := os.Open(c.cfg.ClientSecretFile)
	if err != nil {
		return "", directoryReadError("directory client credential is unavailable")
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, kailoDirectorySecretMaxBytes+1))
	if err != nil || len(raw) > kailoDirectorySecretMaxBytes {
		return "", directoryReadError("directory client credential is unreadable")
	}
	value := strings.TrimRight(string(raw), "\r\n")
	if value == "" || strings.ContainsAny(value, "\r\n") {
		return "", directoryReadError("directory client credential is invalid")
	}
	return value, nil
}

func (c *kailoDirectoryClient) token(ctx context.Context) (string, error) {
	secret, err := c.secret()
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithTimeout(ctx, kailoDirectoryTokenTimeout)
	defer cancel()
	form := url.Values{"grant_type": {"client_credentials"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", directoryReadError("token request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	// RFC 6749 §2.3.1: form-encode both parts of the Basic credential.
	req.SetBasicAuth(url.QueryEscape(c.cfg.ClientID), url.QueryEscape(secret))
	resp, err := c.http.Do(req)
	if err != nil {
		return "", directoryReadError("token endpoint unreachable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", directoryReadError("token endpoint status %d", resp.StatusCode)
	}
	var body struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, kailoDirectoryTokenMaxBytes+1))
	if err != nil || len(raw) > kailoDirectoryTokenMaxBytes || json.Unmarshal(raw, &body) != nil ||
		!strings.EqualFold(body.TokenType, "Bearer") || strings.TrimSpace(body.AccessToken) == "" {
		return "", directoryReadError("token response")
	}
	return body.AccessToken, nil
}

// Read returns the validated snapshot of the configured binding.
func (c *kailoDirectoryClient) Read(ctx context.Context) (*types.KailoMemberDirectory, error) {
	token, err := c.token(ctx)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, kailoDirectoryReadTimeout)
	defer cancel()
	endpoint := strings.TrimRight(c.cfg.CoreURL, "/") + "/service/v1/component-directory/bindings/" +
		url.PathEscape(c.cfg.BindingID) + "/members"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, directoryReadError("directory request")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, directoryReadError("Core unreachable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// 503: Core could not read everything; 401/403/404: not (yet) allowed.
		// Either way the last applied state stays.
		return nil, directoryReadError("Core status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, kailoDirectoryResponseMaxBytes+1))
	if err != nil || len(raw) > kailoDirectoryResponseMaxBytes {
		return nil, directoryReadError("directory response too large or truncated")
	}
	snapshot, err := types.ParseKailoMemberDirectory(raw)
	if err != nil {
		return nil, directoryReadError("directory response does not match the contract")
	}
	if !strings.EqualFold(snapshot.BindingID, c.cfg.BindingID) {
		return nil, directoryReadError("directory answered for another binding")
	}
	return snapshot, nil
}

// KailoDirectorySyncRunner reads the directory on start and every interval,
// one read at a time, and applies a changed snapshot. With Kailo mode or the
// directory not configured it does nothing.
type KailoDirectorySyncRunner struct {
	org        interfaces.KailoOrgService
	client     *kailoDirectoryClient
	issuer     string
	tenantID   string
	tenantName string
	interval   time.Duration

	startOnce sync.Once
	stopOnce  sync.Once
	stopCh    chan struct{}
	doneCh    chan struct{}
	started   atomic.Bool
}

// NewKailoDirectorySyncRunner constructs the runner from the configuration.
func NewKailoDirectorySyncRunner(cfg *config.Config, org interfaces.KailoOrgService) *KailoDirectorySyncRunner {
	r := &KailoDirectorySyncRunner{org: org, stopCh: make(chan struct{}), doneCh: make(chan struct{})}
	d := cfg.KailoDirectory()
	if d == nil || org == nil {
		return r
	}
	r.client = newKailoDirectoryClient(*d)
	r.interval = d.Interval
	r.issuer = strings.TrimSpace(cfg.OIDCAuth.IssuerURL)
	r.tenantID = strings.TrimSpace(cfg.Kailo.TenantID)
	r.tenantName = cfg.Kailo.TenantName
	return r
}

// Start launches the loop (no-op when not configured or already started).
func (r *KailoDirectorySyncRunner) Start(ctx context.Context) {
	if r == nil || r.client == nil {
		return
	}
	r.startOnce.Do(func() {
		r.started.Store(true)
		go func() {
			defer close(r.doneCh)
			ticker := time.NewTicker(r.interval)
			defer ticker.Stop()
			for {
				r.SyncOnce(ctx)
				select {
				case <-r.stopCh:
					return
				case <-ctx.Done():
					return
				case <-ticker.C:
				}
			}
		}()
	})
}

// Stop ends the loop and waits for an in-flight sync to finish.
func (r *KailoDirectorySyncRunner) Stop() {
	if r == nil {
		return
	}
	r.stopOnce.Do(func() { close(r.stopCh) })
	if r.started.Load() {
		<-r.doneCh
	}
}

// SyncOnce reads and, when the snapshot changed, applies it. It reports
// whether a snapshot was applied; failures leave everything as it was.
func (r *KailoDirectorySyncRunner) SyncOnce(ctx context.Context) bool {
	if r == nil || r.client == nil {
		return false
	}
	snapshot, err := r.client.Read(ctx)
	if err != nil {
		var readErr *kailoDirectoryReadError
		if errors.As(err, &readErr) {
			logger.Warnf(ctx, "[kailo] %s; keeping the last applied directory", readErr.Error())
		} else {
			logger.Warnf(ctx, "[kailo] member directory unavailable; keeping the last applied directory")
		}
		return false
	}
	if !strings.EqualFold(snapshot.Tenant.TenantID, r.tenantID) {
		logger.Warnf(ctx, "[kailo] member directory names another Tenant than this deployment; ignored")
		return false
	}
	// Mapped spaces carry the deployment's own spelling of the Tenant id.
	snapshot.Tenant.TenantID = r.tenantID
	applied, err := r.org.ApplyDirectory(ctx, r.issuer, r.tenantName, snapshot)
	if err != nil {
		logger.Errorf(ctx, "[kailo] member directory apply failed, retrying next interval: %v", err)
		return false
	}
	return applied
}
