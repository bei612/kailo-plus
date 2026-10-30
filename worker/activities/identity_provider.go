package activities

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"apps/worker/internal/oidc"
)

// IdentityProviderSubject 是一个要结束其 IdP 会话的外部身份（issuer+subject），由 Core 在 Tenant
// 撤权启动时冻结进 Workflow input。它只定位 IdP 用户，不是凭据。
type IdentityProviderSubject struct {
	Issuer  string `json:"issuer"`
	Subject string `json:"subject"`
}

// EndSessionsInput 是一次 Tenant 撤权中要结束 IdP 会话的全部外部身份。
type EndSessionsInput struct {
	Subjects []IdentityProviderSubject `json:"subjects"`
}

// EndSessionsOutput 进入 Workflow history 与 Core 审计（IDP_SESSIONS_TERMINATED）：只有计数与回应类别，
// 不含 subject。Identities = Ended + Absent + Foreign。
type EndSessionsOutput struct {
	// 本次处理的外部身份数
	Identities int `json:"identities"`
	// IdP 已结束其全部会话的用户数（IdP 回应 204）
	Ended int `json:"ended"`
	// IdP 中已不存在的用户数（回应 404：没有会话可结束，同样是确定的完成）
	Absent int `json:"absent"`
	// issuer 不是部署 IdP 的外部身份数：部署只有一个 IdP，这些身份没有可结束的会话
	Foreign int `json:"foreign"`
}

// IdentityProvider 以部署声明的专用 client（只有 realm-management manage-users）调用 IdP 的用户退出
// 接口（DD-164(6)、.design/07 §4.7.5「撤权」）：IdP 结束该用户全部会话、设置令牌不早于时间，
// 并对会话中出现过的每个 client 投递 back-channel logout_token，组件随之结束其会话。
type IdentityProvider struct {
	issuer string
	admin  string // <issuer origin>/admin/realms/<realm>
	tokens *oidc.Source
	http   *http.Client
}

// NewIdentityProviderFromEnv 按部署投递构造。缺任一项即拒绝启动（DD-164(6)）：没有它，Tenant 撤权
// 永远停在 REVOKING，而不是悄悄跳过结束 IdP 会话。
func NewIdentityProviderFromEnv() (*IdentityProvider, error) {
	get := func(k string) (string, error) {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v, nil
		}
		return "", fmt.Errorf("缺少 %s（DD-164(6) 会话终止 client 未投递）", k)
	}
	issuer, err := get("IDP_SESSION_TERMINATION_ISSUER")
	if err != nil {
		return nil, err
	}
	clientID, err := get("IDP_SESSION_TERMINATION_CLIENT_ID")
	if err != nil {
		return nil, err
	}
	secret, err := get("IDP_SESSION_TERMINATION_CLIENT_SECRET")
	if err != nil {
		return nil, err
	}
	tokenURL, err := get("OIDC_TOKEN_URL")
	if err != nil {
		return nil, err
	}
	return NewIdentityProvider(issuer, tokenURL, clientID, secret)
}

// NewIdentityProvider 校验 issuer 形如 <origin>/realms/<realm> 并派生管理接口地址。
func NewIdentityProvider(issuer, tokenURL, clientID, secret string) (*IdentityProvider, error) {
	admin, err := adminBase(issuer)
	if err != nil {
		return nil, err
	}
	client := &http.Client{
		Timeout: 30 * time.Second,
		// 管理令牌不随跳转转发
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	tokens, err := oidc.NewSource(tokenURL, clientID, secret, client)
	if err != nil {
		return nil, err
	}
	return &IdentityProvider{issuer: issuer, admin: admin, tokens: tokens, http: client}, nil
}

func adminBase(issuer string) (string, error) {
	u, err := url.Parse(issuer)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.User != nil ||
		u.RawQuery != "" || u.Fragment != "" {
		return "", fmt.Errorf("IDP_SESSION_TERMINATION_ISSUER 不是有效的 issuer")
	}
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) != 2 || parts[0] != "realms" || parts[1] == "" {
		return "", fmt.Errorf("IDP_SESSION_TERMINATION_ISSUER 必须形如 <origin>/realms/<realm>")
	}
	return u.Scheme + "://" + u.Host + "/admin/realms/" + url.PathEscape(parts[1]), nil
}

// EndSessions 对每个部署 issuer 下的外部身份调用用户退出接口。幂等：重复调用只是再结束一次（已无会话）。
// 204 与 404 是确定的完成；401/403 先丢弃令牌重取一次，仍被拒或其他状态与网络失败都是可重试错误——
// 撤权必须闭合，成员在确定成功前停在 REVOKING（Workflow 按轮重做）。
func (p *IdentityProvider) EndSessions(ctx context.Context, in EndSessionsInput) (EndSessionsOutput, error) {
	out := EndSessionsOutput{Identities: len(in.Subjects)}
	for _, s := range in.Subjects {
		if s.Issuer != p.issuer {
			out.Foreign++
			continue
		}
		if strings.TrimSpace(s.Subject) == "" || len(s.Subject) > 255 {
			return out, fmt.Errorf("外部身份 subject 无效")
		}
		ended, err := p.logout(ctx, s.Subject)
		if err != nil {
			return out, err
		}
		if ended {
			out.Ended++
		} else {
			out.Absent++
		}
	}
	return out, nil
}

func (p *IdentityProvider) logout(ctx context.Context, subject string) (bool, error) {
	target := p.admin + "/users/" + url.PathEscape(subject) + "/logout"
	for attempt := 0; ; attempt++ {
		token, err := p.tokens.Token(ctx)
		if err != nil {
			return false, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, target, nil)
		if err != nil {
			return false, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := p.http.Do(req)
		if err != nil {
			return false, err
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
		resp.Body.Close()
		switch resp.StatusCode {
		case http.StatusNoContent, http.StatusOK:
			return true, nil
		case http.StatusNotFound:
			return false, nil
		case http.StatusUnauthorized, http.StatusForbidden:
			if attempt == 0 {
				p.tokens.Invalidate()
				continue
			}
		}
		// subject 不进入错误消息与 history
		return false, errors.New("IdP 用户退出接口回应 HTTP " + fmt.Sprint(resp.StatusCode))
	}
}
