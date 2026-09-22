// Package oidc 提供 Worker 的 service identity 令牌。
//
// Worker 同时要两张票：连 Temporal 的（permissions 声明携带
// "<namespace>:<role>"，SF-TMP-06）与调 Core service API 的（audience 与 azp
// 由 Core 核对）。两张票来自同一个 client_credentials 客户端，因此取令牌这件事
// 只实现一次。
//
// 令牌会过期——本部署签发 900 秒。长期运行的进程持一张静态令牌，只是把失败
// 推迟到第一次续期之后，而那时通常已经没人在看日志了。
package oidc

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
)

// Source 按需取令牌并在到期前复用。
type Source struct {
	tokenURL string
	clientID string
	secret   string
	http     *http.Client

	mu    sync.Mutex
	token string
	till  time.Time
}

// FromEnv 构造令牌来源。三项都不接受默认值：缺任一项都说明 Worker 没有可用的
// service identity，此时以空令牌连接会被 Temporal 的 authorizer 直接拒绝，
// 而错误信息离真正的原因很远。
func FromEnv() (*Source, error) {
	get := func(k string) (string, error) {
		if v := os.Getenv(k); v != "" {
			return v, nil
		}
		return "", fmt.Errorf("缺少 %s", k)
	}
	var s Source
	var err error
	if s.tokenURL, err = get("OIDC_TOKEN_URL"); err != nil {
		return nil, err
	}
	if s.clientID, err = get("OIDC_WORKER_CLIENT_ID"); err != nil {
		return nil, err
	}
	if s.secret, err = get("OIDC_WORKER_CLIENT_SECRET"); err != nil {
		return nil, err
	}
	s.http = &http.Client{Timeout: 15 * time.Second}
	return &s, nil
}

// Token 返回一张仍然有效的访问令牌。
func (s *Source) Token(ctx context.Context) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// 留 30 秒余量：正好卡在到期瞬间取到的令牌会在服务端被判过期。
	if s.token != "" && time.Now().Add(30*time.Second).Before(s.till) {
		return s.token, nil
	}
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {s.clientID},
		"client_secret": {s.secret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.tokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := s.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("取服务令牌失败: HTTP %d", resp.StatusCode)
	}
	var body struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", err
	}
	if body.AccessToken == "" {
		return "", fmt.Errorf("令牌响应里没有 access_token")
	}
	s.token = body.AccessToken
	s.till = time.Now().Add(time.Duration(body.ExpiresIn) * time.Second)
	return s.token, nil
}
