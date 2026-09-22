package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"go.temporal.io/sdk/temporal"
)

// 非重试错误类型。Activity 选项把它们列进 NonRetryableErrorTypes：默认重试
// 策略是无限次，把「同样的请求重试多少次都一样」的错误交给它等于永远卡住
// （06 §5.1）。
const (
	// 请求本身不成立：事实不存在、版本不符、状态机不允许
	ErrTypeRejected = "CORE_REQUEST_REJECTED"
	// 前置条件不成立：binding 不是 ACTIVE、托管方不是 Core
	ErrTypeAdmissionDenied = "ADMISSION_DENIED"
)

// CoreAPI 是 Worker 到 Core service API 的客户端（01 §4）。
//
// 令牌以 client_credentials 取得并按到期时间复用。不做后台刷新：刷新失败与
// 过期是同一种情况，下次调用前重新取能同时覆盖两者，也少一条后台失败路径。
type CoreAPI struct {
	base      string
	tokenURL  string
	clientID  string
	secret    string
	http      *http.Client
	mu        sync.Mutex
	token     string
	tokenTill time.Time
}

// NewCoreAPIFromEnv 按部署投递的配置构造客户端。
//
// 五项都不接受默认值：少任一项都说明 Worker 没被正确接上 Core，此时回落到
// 某个猜测的地址会让状态投影写进一个不是权威的实例。
func NewCoreAPIFromEnv() (*CoreAPI, error) {
	get := func(k string) (string, error) {
		v := os.Getenv(k)
		if v == "" {
			return "", fmt.Errorf("缺少 %s", k)
		}
		return v, nil
	}
	var err error
	c := &CoreAPI{http: &http.Client{Timeout: 20 * time.Second}}
	if c.base, err = get("CORE_SERVICE_URL"); err != nil {
		return nil, err
	}
	if c.tokenURL, err = get("OIDC_TOKEN_URL"); err != nil {
		return nil, err
	}
	if c.clientID, err = get("OIDC_WORKER_CLIENT_ID"); err != nil {
		return nil, err
	}
	if c.secret, err = get("OIDC_WORKER_CLIENT_SECRET"); err != nil {
		return nil, err
	}
	return c, nil
}

func (c *CoreAPI) accessToken(ctx context.Context) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	// 留 30 秒余量：正好卡在到期瞬间取到的令牌会在服务端被判过期。
	if c.token != "" && time.Now().Add(30*time.Second).Before(c.tokenTill) {
		return c.token, nil
	}
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {c.clientID},
		"client_secret": {c.secret},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.tokenURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
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
	c.token = body.AccessToken
	c.tokenTill = time.Now().Add(time.Duration(body.ExpiresIn) * time.Second)
	return c.token, nil
}

// post 调用一个 service endpoint 并按状态码分类结果。
//
// 分类是这个函数存在的全部理由：4xx 与 5xx 在 Temporal 里的含义完全不同。
// 4xx 表示「同样的请求重试多少次都一样」，必须以非重试错误返回，否则默认
// 无限重试会把一次确定的拒绝变成永远卡住的 Activity；5xx 与网络失败是结果
// 不明，交给 RetryPolicy。
func (c *CoreAPI) post(ctx context.Context, path string, payload any, out any) error {
	token, err := c.accessToken(ctx)
	if err != nil {
		return err
	}
	buf, err := json.Marshal(payload)
	if err != nil {
		return temporal.NewNonRetryableApplicationError(
			"请求体不可序列化", ErrTypeRejected, err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(buf))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := c.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	switch {
	case resp.StatusCode == http.StatusOK:
		if out == nil {
			return nil
		}
		return json.Unmarshal(body, out)
	case resp.StatusCode == http.StatusForbidden:
		return temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("%s 前置条件不成立: %s", path, body), ErrTypeAdmissionDenied, nil)
	case resp.StatusCode >= 400 && resp.StatusCode < 500:
		return temporal.NewNonRetryableApplicationError(
			fmt.Sprintf("%s 被拒绝: HTTP %d %s", path, resp.StatusCode, body),
			ErrTypeRejected, nil)
	default:
		// 5xx 含 Core 对「roster 未收敛」的回答，那是结果不明而非失败
		return fmt.Errorf("%s 结果不明: HTTP %d %s", path, resp.StatusCode, body)
	}
}

// ProjectTaskStateInput 对应 .design/06 §3.1 的投影载荷。
type ProjectTaskStateInput struct {
	WorkflowID    string  `json:"workflowId"`
	RunID         string  `json:"runId"`
	EventID       int64   `json:"eventId"`
	Status        string  `json:"status"`
	WaitingReason *string `json:"waitingReason,omitempty"`
	Progress      *string `json:"progress,omitempty"`
}

func (c *CoreAPI) ProjectTaskState(ctx context.Context, in ProjectTaskStateInput) error {
	return c.post(ctx, "/service/v1/task-projections", in, nil)
}

// BuzzProjectionInput 是 roster 投影的载荷。membership 版本是 Workflow input
// 冻结的那个：Core 用它确认这条 Workflow 没有对着一个已经变过的事实做投影。
type BuzzProjectionInput struct {
	Scope             string `json:"scope"`
	MembershipID      string `json:"membershipId"`
	MembershipVersion int32  `json:"membershipVersion"`
	Presence          string `json:"presence"`
}

func (c *CoreAPI) ProjectBuzzRoster(ctx context.Context, in BuzzProjectionInput) error {
	return c.post(ctx, "/service/v1/membership-projections/buzz", in, nil)
}

// TransitionInput 是成员状态跃迁的载荷。
type TransitionInput struct {
	Scope        string `json:"scope"`
	MembershipID string `json:"membershipId"`
	FromVersion  int32  `json:"fromVersion"`
	ToState      string `json:"toState"`
	WorkflowID   string `json:"workflowId"`
}

// TransitionOutput 回传跃迁后的权威状态与新版本。
type TransitionOutput struct {
	State   string `json:"state"`
	Version int32  `json:"version"`
}

func (c *CoreAPI) TransitionMembership(
	ctx context.Context, in TransitionInput,
) (TransitionOutput, error) {
	var out TransitionOutput
	err := c.post(ctx, "/service/v1/memberships/state", in, &out)
	return out, err
}

// TenantStepInput 是 Tenant 生命周期两步的载荷。tenant 版本是 Workflow input
// 冻结的那个：Core 用它确认这条 Workflow 没有对着一个已经变过的事实做投影。
type TenantStepInput struct {
	TenantID      string `json:"tenantId"`
	TenantVersion int32  `json:"tenantVersion"`
}

func (c *CoreAPI) ProvisionTenantBuzz(ctx context.Context, in TenantStepInput) error {
	return c.post(ctx, "/service/v1/tenants/buzz-provision", in, nil)
}

func (c *CoreAPI) VerifyTenantBuzz(ctx context.Context, in TenantStepInput) error {
	return c.post(ctx, "/service/v1/tenants/buzz-verify", in, nil)
}

// WorkspaceStepInput 同理。
type WorkspaceStepInput struct {
	WorkspaceID      string `json:"workspaceId"`
	WorkspaceVersion int32  `json:"workspaceVersion"`
}

func (c *CoreAPI) ProvisionWorkspaceBuzz(ctx context.Context, in WorkspaceStepInput) error {
	return c.post(ctx, "/service/v1/workspaces/buzz-provision", in, nil)
}

// ScopeTransitionInput 是 Tenant/Workspace 自身状态的跃迁载荷。
// 与成员状态跃迁分开：两者是不同的状态机（scope 有 SUSPENDING/RESTORING）。
type ScopeTransitionInput struct {
	Kind        string `json:"kind"`
	ID          string `json:"id"`
	FromVersion int32  `json:"fromVersion"`
	ToState     string `json:"toState"`
	WorkflowID  string `json:"workflowId"`
}

func (c *CoreAPI) TransitionScope(
	ctx context.Context, in ScopeTransitionInput,
) (TransitionOutput, error) {
	var out TransitionOutput
	err := c.post(ctx, "/service/v1/scopes/state", in, &out)
	return out, err
}
