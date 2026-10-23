package service

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/Tencent/WeKnora/internal/config"
)

// Service identity of this instance towards Kailo Core (DD-133(4), and
// DD-138(4) / 07 §4.8.3): the confidential directory client obtains
// client-credentials tokens at the configured token URL. The member directory
// read and the notification delivery share this code and configuration; the
// secret only ever lives in its file and is never logged.

// newKailoServiceHTTPClient is the HTTP client for the deployment-declared
// private endpoints (IdP token URL, Core service listener): no proxy, no
// redirects.
func newKailoServiceHTTPClient(responseTimeout time.Duration) *http.Client {
	transport := &http.Transport{
		Proxy:                 nil,
		DialContext:           (&net.Dialer{Timeout: 5 * time.Second}).DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: responseTimeout,
		MaxIdleConns:          2,
		IdleConnTimeout:       90 * time.Second,
	}
	return &http.Client{
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// readKailoDirectorySecret reads the directory client secret file.
func readKailoDirectorySecret(path string) (string, error) {
	file, err := os.Open(path)
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

// requestKailoServiceToken performs one client-credentials grant and returns
// the access token and its lifetime (0 when the IdP did not state one).
func requestKailoServiceToken(
	ctx context.Context, client *http.Client, cfg config.KailoDirectoryConfig,
) (string, time.Duration, error) {
	secret, err := readKailoDirectorySecret(cfg.ClientSecretFile)
	if err != nil {
		return "", 0, err
	}
	ctx, cancel := context.WithTimeout(ctx, kailoDirectoryTokenTimeout)
	defer cancel()
	form := url.Values{"grant_type": {"client_credentials"}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", 0, directoryReadError("token request")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	// RFC 6749 §2.3.1: form-encode both parts of the Basic credential.
	req.SetBasicAuth(url.QueryEscape(cfg.ClientID), url.QueryEscape(secret))
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, directoryReadError("token endpoint unreachable")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", 0, directoryReadError("token endpoint status %d", resp.StatusCode)
	}
	var body struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`

		// Raw so an unusual expires_in spelling never fails a token that
		// the directory read accepted before this field was read.
		ExpiresIn json.RawMessage `json:"expires_in"`
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, kailoDirectoryTokenMaxBytes+1))
	if err != nil || len(raw) > kailoDirectoryTokenMaxBytes || json.Unmarshal(raw, &body) != nil ||
		!strings.EqualFold(body.TokenType, "Bearer") || strings.TrimSpace(body.AccessToken) == "" {
		return "", 0, directoryReadError("token response")
	}
	lifetime := time.Duration(0)
	var seconds int64
	if json.Unmarshal(body.ExpiresIn, &seconds) == nil && seconds > 0 && seconds < 1<<31 {
		lifetime = time.Duration(seconds) * time.Second
	}
	return body.AccessToken, lifetime, nil
}

// kailoServiceTokenEarlyRefresh renews a cached token this long before the
// IdP-stated expiry so a request never carries an about-to-expire token.
const kailoServiceTokenEarlyRefresh = 30 * time.Second

// kailoServiceTokenSource caches the service token until shortly before its
// expiry (DD-138(4): notification delivery). A token without a stated
// lifetime, or one shorter than the early-refresh margin, is not cached.
type kailoServiceTokenSource struct {
	cfg    config.KailoDirectoryConfig
	client *http.Client
	now    func() time.Time

	mu     sync.Mutex
	token  string
	expiry time.Time
}

func newKailoServiceTokenSource(cfg config.KailoDirectoryConfig, client *http.Client) *kailoServiceTokenSource {
	return &kailoServiceTokenSource{cfg: cfg, client: client, now: time.Now}
}

// Token returns the cached token or obtains a new one.
func (s *kailoServiceTokenSource) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.token != "" && s.now().Before(s.expiry) {
		return s.token, nil
	}
	token, lifetime, err := requestKailoServiceToken(ctx, s.client, s.cfg)
	if err != nil {
		return "", err
	}
	s.token, s.expiry = "", time.Time{}
	if lifetime > kailoServiceTokenEarlyRefresh {
		s.token, s.expiry = token, s.now().Add(lifetime-kailoServiceTokenEarlyRefresh)
	}
	return token, nil
}

// Invalidate drops the cached token (after Core answered 401/403).
func (s *kailoServiceTokenSource) Invalidate() {
	s.mu.Lock()
	s.token, s.expiry = "", time.Time{}
	s.mu.Unlock()
}
