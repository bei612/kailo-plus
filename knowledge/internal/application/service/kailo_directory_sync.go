package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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
// GET /service/v1/component-directory/bindings/{binding}/members?schema=2 on
// Core's service listener with a client-credentials token of its own
// directory client, every interval, and converges with the snapshot
// (memberships, roles by Kailo create, knowledge base shares; DD-164).
// Anything short of a complete, valid schema 2 snapshot for this binding and
// Tenant changes nothing. After each applied or failed snapshot it reports a
// receipt (PUT .../receipt, DD-164(4)⑥); a receipt never blocks the sync.

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

func (e *kailoDirectoryReadError) Error() string {
	return "member directory unavailable: " + e.category
}

func directoryReadError(format string, args ...interface{}) error {
	return &kailoDirectoryReadError{category: fmt.Sprintf(format, args...)}
}

// kailoDirectoryClient reads one snapshot.
type kailoDirectoryClient struct {
	cfg  config.KailoDirectoryConfig
	http *http.Client
}

func newKailoDirectoryClient(cfg config.KailoDirectoryConfig) *kailoDirectoryClient {
	return &kailoDirectoryClient{cfg: cfg, http: newKailoServiceHTTPClient(kailoDirectoryReadTimeout)}
}

// token fetches a fresh token on every read, as before the shared token
// source existed (DD-138(4) reuses the same request, see kailo_service_token.go).
func (c *kailoDirectoryClient) token(ctx context.Context) (string, error) {
	token, _, err := requestKailoServiceToken(ctx, c.http, c.cfg)
	return token, err
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
		url.PathEscape(c.cfg.BindingID) + "/members?schema=2"
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

	// lastReceipt is the receipt Core last accepted; an identical one is not
	// sent again (only the sync goroutine touches it).
	lastReceipt string
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
		r.report(ctx, snapshot.DirectoryVersion, types.KailoReceiptFailed, time.Now(), []types.KailoReceiptFailure{{
			Kind: types.KailoReceiptKindTenant, Ref: snapshot.Tenant.TenantID, ReasonCode: "TENANT_MISMATCH"}})
		return false
	}
	// Mapped spaces carry the deployment's own spelling of the Tenant id.
	snapshot.Tenant.TenantID = r.tenantID
	result, err := r.org.ApplyDirectory(ctx, r.issuer, r.tenantName, snapshot)
	if err != nil {
		logger.Errorf(ctx, "[kailo] member directory apply failed, retrying next interval: %v", err)
		r.report(ctx, snapshot.DirectoryVersion, types.KailoReceiptFailed, time.Now(), []types.KailoReceiptFailure{{
			Kind: types.KailoReceiptKindTenant, Ref: snapshot.Tenant.TenantID, ReasonCode: "NATIVE_APPLY_FAILED"}})
		return false
	}
	r.report(ctx, snapshot.DirectoryVersion, types.KailoReceiptApplied, result.AppliedAt, result.Failures)
	return result.Applied
}

// report sends the receipt unless Core already accepted the same one.
func (r *KailoDirectorySyncRunner) report(
	ctx context.Context, version, outcome string, appliedAt time.Time, failures []types.KailoReceiptFailure,
) {
	if failures == nil {
		failures = []types.KailoReceiptFailure{}
	}
	if len(failures) > types.KailoReceiptMaxFailures {
		failures = failures[:types.KailoReceiptMaxFailures]
	}
	body, err := json.Marshal(map[string]interface{}{
		"schema":           types.KailoDirectorySchema,
		"directoryVersion": version,
		"appliedAt":        appliedAt.UTC().Format(time.RFC3339),
		"outcome":          outcome,
		"failures":         failures,
	})
	if err != nil {
		return
	}
	// appliedAt of a failed attempt changes every interval; the receipt is
	// the same as long as version, outcome and failures are.
	key := version + "|" + outcome + "|" + string(mustJSON(failures))
	if outcome == types.KailoReceiptApplied && key == r.lastReceipt {
		return
	}
	if err := r.client.Receipt(ctx, body); err != nil {
		logger.Warnf(ctx, "[kailo] directory receipt not delivered (%v); will report again", err)
		return
	}
	r.lastReceipt = key
}

func mustJSON(v interface{}) []byte {
	raw, _ := json.Marshal(v)
	return raw
}

// Receipt PUTs one receipt body for the configured binding.
func (c *kailoDirectoryClient) Receipt(ctx context.Context, body []byte) error {
	token, err := c.token(ctx)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, kailoDirectoryReadTimeout)
	defer cancel()
	endpoint := strings.TrimRight(c.cfg.CoreURL, "/") + "/service/v1/component-directory/bindings/" +
		url.PathEscape(c.cfg.BindingID) + "/receipt"
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(body))
	if err != nil {
		return directoryReadError("receipt request")
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return directoryReadError("Core unreachable")
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return directoryReadError("Core status %d", resp.StatusCode)
	}
	return nil
}
