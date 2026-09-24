package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"

	"github.com/kailo/apps/worker/internal/contracts/generated"
	"github.com/kailo/apps/worker/internal/oidc"
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
// 令牌来自与 Temporal 连接共用的 oidc.Source：同一个服务身份只有一份取令牌、
// 缓存与失效的逻辑。
type CoreAPI struct {
	base   string
	tokens *oidc.Source
	http   *http.Client
}

// NewCoreAPIFromEnv 按部署投递的配置构造客户端。
//
// 地址不接受默认值：少了它说明 Worker 没被正确接上 Core，此时回落到某个猜测
// 的地址会让状态投影写进一个不是权威的实例。
func NewCoreAPIFromEnv(tokens *oidc.Source) (*CoreAPI, error) {
	base := os.Getenv("CORE_SERVICE_URL")
	if base == "" {
		return nil, fmt.Errorf("缺少 CORE_SERVICE_URL")
	}
	// 不设客户端级超时：每次调用带 Activity 的 ctx，期限由 StartToClose 给出
	return &CoreAPI{base: base, tokens: tokens, http: &http.Client{}}, nil
}

// post 调用一个 service endpoint 并按状态码分类结果。
//
// 分类是这个函数存在的全部理由：4xx 与 5xx 在 Temporal 里的含义完全不同。
// 4xx 表示「同样的请求重试多少次都一样」，必须以非重试错误返回，否则默认
// 无限重试会把一次确定的拒绝变成永远卡住的 Activity；5xx 与网络失败是结果
// 不明，交给 RetryPolicy。
func (c *CoreAPI) post(ctx context.Context, path string, payload any, out any) error {
	buf, err := json.Marshal(payload)
	if err != nil {
		return temporal.NewNonRetryableApplicationError(
			"请求体不可序列化", ErrTypeRejected, err)
	}
	// 401 先当作令牌失效（IdP 轮换签名密钥、到期临界）：丢弃缓存重取再试一次。
	// 第二次仍 401 才是真的无权，按确定的拒绝处理。
	for attempt := 0; ; attempt++ {
		token, err := c.tokens.Token(ctx)
		if err != nil {
			return err
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
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		resp.Body.Close()

		switch {
		case resp.StatusCode == http.StatusUnauthorized && attempt == 0:
			c.tokens.Invalidate()
			continue
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
}

// ProjectTaskState 写回一次状态跃迁（.design/06 §3.1），载荷由 contracts 定义。
func (c *CoreAPI) ProjectTaskState(ctx context.Context, in generated.TaskStateReport) error {
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

// IdentityProjectionInput 是原生设备公钥投影的载荷（DD-79）。方向不在这里：
// Core 按 binding 状态决定投入还是移出，Worker 只给出冻结的 pubkey 与版本。
type IdentityProjectionInput struct {
	Pubkey         string `json:"pubkey"`
	BindingVersion int32  `json:"bindingVersion"`
}

// IdentityProjectionOutput 回传查证后该 binding 的状态。
type IdentityProjectionOutput struct {
	Converged bool   `json:"converged"`
	Pubkey    string `json:"pubkey"`
	State     string `json:"state"`
}

// ProjectBuzzIdentity 把一台设备的公钥投入或移出 roster。
//
// 撤权与登记并发、且撤权先到时 Core 回 409：这次登记不成立，属于确定的结论，
// 不重试。roster 未收敛回 503，按投影类的重试上界继续。
func (c *CoreAPI) ProjectBuzzIdentity(
	ctx context.Context, in IdentityProjectionInput,
) (IdentityProjectionOutput, error) {
	var out IdentityProjectionOutput
	err := c.post(ctx, "/service/v1/identity-projections/buzz", in, &out)
	return out, err
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

// ProjectApprovalState 写回审批的一次状态跃迁（.design/06 §4）。ApprovalProjection
// 只接受这一条写入路径（DD-47）；载荷由 contracts 定义。
func (c *CoreAPI) ProjectApprovalState(ctx context.Context, in generated.ApprovalStateReport) error {
	return c.post(ctx, "/service/v1/approval-projections", in, nil)
}

// FreshApprovalAdmission 请 Core 判定 approver 此刻的资格：active HUMAN、fresh
// 选择器 permission、职责分离（.design/06 §4）。资格未通过是 200 里的
// admitted=false，不是调用失败。
func (c *CoreAPI) FreshApprovalAdmission(
	ctx context.Context, in generated.FreshApprovalAdmissionRequest,
) (generated.FreshApprovalAdmissionResult, error) {
	var out generated.FreshApprovalAdmissionResult
	err := c.post(ctx, "/service/v1/approvals/admission", in, &out)
	return out, err
}
