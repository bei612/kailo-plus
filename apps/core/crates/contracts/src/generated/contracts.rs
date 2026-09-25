// Example code that deserializes and serializes the model.
// extern crate serde;
// #[macro_use]
// extern crate serde_derive;
// extern crate serde_json;
//
// use generated_module::Canary;
//
// fn main() {
//     let json = r#"{"answer": 42}"#;
//     let model: Canary = serde_json::from_str(&json).unwrap();
// }

use serde::{Deserialize, Serialize};

/// 可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
/// 节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Canary {
    /// 可选的枚举引用
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_state: Option<CapabilityState>,

    /// 基础 integer
    pub count: i64,

    /// 基础 boolean
    pub enabled: bool,

    /// 跨文件 $ref 引用封闭枚举
    pub error_class: ErrorClass,

    /// format: uuid
    pub id: String,

    /// 基础 string
    pub name: String,

    /// 内联对象，同样显式关闭 additionalProperties
    pub nested: Nested,

    /// RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
    /// 强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub occurred_at: Option<String>,

    /// 基础 number
    pub ratio: f64,

    /// 同构数组
    pub tags: Vec<String>,

    /// 变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
    #[serde(skip_serializing_if = "Option::is_none")]
    pub variants: Option<Vec<Variant>>,
}

/// 可选的枚举引用
///
/// 能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapabilityState {
    #[serde(rename = "ADAPTER_REQUIRED")]
    AdapterRequired,

    Blocked,

    #[serde(rename = "DESIGN_DEFINED")]
    DesignDefined,

    Excluded,

    #[serde(rename = "UPSTREAM_SUPPORTED")]
    UpstreamSupported,
}

/// 跨文件 $ref 引用封闭枚举
///
/// 错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
/// 表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ErrorClass {
    #[serde(rename = "BLOCKED")]
    Blocked,

    #[serde(rename = "CONFLICT")]
    Conflict,

    #[serde(rename = "DENIED")]
    Denied,

    #[serde(rename = "LIMIT")]
    Limit,

    #[serde(rename = "PRECONDITION")]
    Precondition,

    #[serde(rename = "UNKNOWN")]
    Unknown,
}

/// 内联对象，同样显式关闭 additionalProperties
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Nested {
    pub label: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub weights: Option<Vec<f64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_digest: Option<String>,

    pub kind: Kind,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_body: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_attempt: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Kind {
    #[serde(rename = "FILE")]
    File,

    #[serde(rename = "MESSAGE")]
    Message,

    #[serde(rename = "TASK")]
    Task,
}

/// POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
/// actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCommand {
    pub action_key: String,

    /// 调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
    pub idempotency_key: String,

    /// tenant.member.invite.revoke 的目标邀请
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation_id: Option<String>,

    /// workspace.create 的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// 成员动作的目标 Principal
    #[serde(skip_serializing_if = "Option::is_none")]
    pub principal_id: Option<String>,

    /// workspace.create 的 slug
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,

    /// Workspace 内动作的执行 Workspace
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
/// 必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionSubmission {
    pub action_execution_id: String,

    pub action_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    pub dispatch_state: ActionDispatchState,

    pub gate_state: ActionGateState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation: Option<InvitationClass>,

    pub operation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
}

/// ActionExecution 的派发状态（.design/03 §6）。UNKNOWN 是结果不明，既不是成功也不是失败——只有已登记的 native query/dedupe
/// seam 能把它收敛，不能因无 native ID 就自动重放（DD-48）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionDispatchState {
    Aborted,

    Dispatched,

    #[serde(rename = "NOT_DISPATCHED")]
    NotDispatched,

    Unknown,
}

/// ActionExecution 的准入门禁状态（.design/03 §6）。它与 dispatch_state
/// 是两台独立状态机：门禁说的是「允许不允许」，派发说的是「副作用发生没发生」，合并后无法表达「准入通过但派发结果不明」。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ActionGateState {
    #[serde(rename = "ALLOWED")]
    Allowed,

    #[serde(rename = "DENIED")]
    Denied,

    #[serde(rename = "EVALUATING")]
    Evaluating,

    #[serde(rename = "EXPIRED")]
    Expired,

    #[serde(rename = "REVOKED")]
    Revoked,

    #[serde(rename = "WAITING")]
    Waiting,
}

/// tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
/// 里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitationClass {
    /// RFC3339，UTC
    pub expires_at: String,

    pub invitation_id: String,

    /// 部署登记的链接基址 + '#' + 一次性凭据
    pub link: String,
}

/// 稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
/// 字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
///
/// admitted=false 时的拒绝原因
///
/// INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReasonCode {
    #[serde(rename = "ADMISSION_ABANDONED")]
    AdmissionAbandoned,

    #[serde(rename = "APPROVAL_CONSUME_WINDOW_CLOSED")]
    ApprovalConsumeWindowClosed,

    #[serde(rename = "APPROVAL_DENIED")]
    ApprovalDenied,

    #[serde(rename = "APPROVAL_EXPIRED")]
    ApprovalExpired,

    #[serde(rename = "APPROVAL_INVALIDATED")]
    ApprovalInvalidated,

    #[serde(rename = "APPROVAL_NOT_OPEN")]
    ApprovalNotOpen,

    #[serde(rename = "APPROVAL_SELECTOR_UNRESOLVABLE")]
    ApprovalSelectorUnresolvable,

    #[serde(rename = "APPROVAL_WITHDRAWN")]
    ApprovalWithdrawn,

    #[serde(rename = "APPROVER_NOT_ELIGIBLE")]
    ApproverNotEligible,

    #[serde(rename = "CAPABILITY_BLOCKED")]
    CapabilityBlocked,

    #[serde(rename = "CLIENT_KEY_ALREADY_BOUND")]
    ClientKeyAlreadyBound,

    #[serde(rename = "CLIENT_KEY_LIMIT_REACHED")]
    ClientKeyLimitReached,

    #[serde(rename = "CLIENT_KEY_NOT_FOUND")]
    ClientKeyNotFound,

    #[serde(rename = "CLIENT_KEY_PROOF_INVALID")]
    ClientKeyProofInvalid,

    #[serde(rename = "DEPENDENCY_UNAVAILABLE")]
    DependencyUnavailable,

    #[serde(rename = "DISPATCH_RESULT_UNKNOWN")]
    DispatchResultUnknown,

    #[serde(rename = "DUPLICATE_DECISION")]
    DuplicateDecision,

    #[serde(rename = "EXTERNAL_RESULT_UNKNOWN")]
    ExternalResultUnknown,

    #[serde(rename = "IDEMPOTENCY_KEY_REUSED")]
    IdempotencyKeyReused,

    #[serde(rename = "IDENTITY_HEADER_MISSING")]
    IdentityHeaderMissing,

    #[serde(rename = "IDENTITY_UNKNOWN")]
    IdentityUnknown,

    #[serde(rename = "INVALID_PARAMETERS")]
    InvalidParameters,

    #[serde(rename = "INVITATION_ALREADY_REDEEMED")]
    InvitationAlreadyRedeemed,

    #[serde(rename = "INVITATION_EXPIRED")]
    InvitationExpired,

    #[serde(rename = "INVITATION_NOT_FOUND")]
    InvitationNotFound,

    #[serde(rename = "INVITATION_REVOKED")]
    InvitationRevoked,

    #[serde(rename = "INVITEE_ALREADY_MEMBER")]
    InviteeAlreadyMember,

    #[serde(rename = "LAST_TENANT_ADMIN")]
    LastTenantAdmin,

    #[serde(rename = "NATIVE_SURFACE_REQUIRED")]
    NativeSurfaceRequired,

    #[serde(rename = "PERMISSION_DENIED")]
    PermissionDenied,

    #[serde(rename = "PROJECTION_DELAYED")]
    ProjectionDelayed,

    #[serde(rename = "PUBLISH_REJECTED")]
    PublishRejected,

    #[serde(rename = "PUBLISH_RESULT_UNKNOWN")]
    PublishResultUnknown,

    #[serde(rename = "SCOPE_GUARD_FAILED")]
    ScopeGuardFailed,

    #[serde(rename = "SELF_APPROVAL_DENIED")]
    SelfApprovalDenied,

    #[serde(rename = "SESSION_NOT_ACTIVE")]
    SessionNotActive,

    #[serde(rename = "SURFACE_CAPABILITY_UNAVAILABLE")]
    SurfaceCapabilityUnavailable,

    #[serde(rename = "TARGET_NOT_FOUND")]
    TargetNotFound,

    #[serde(rename = "TARGET_STATE_CONFLICT")]
    TargetStateConflict,

    #[serde(rename = "TENANT_MEMBERSHIP_NOT_ACTIVE")]
    TenantMembershipNotActive,

    #[serde(rename = "TENANT_SELECTION_NOT_AVAILABLE")]
    TenantSelectionNotAvailable,

    #[serde(rename = "WAITING_APPROVAL")]
    WaitingApproval,
}

/// POST /api/v1/approvals/{workflowId}/decision 的请求体；approver 由 PlatformSession 决定。回应为
/// ApprovalDecisionOutcome。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalDecisionRequest {
    pub decision: ApprovalDecision,
}

/// approver 的不可变决定（.design/03 §6）。
///
/// 已形成的决定；admitted=false 时缺省
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ApprovalDecision {
    #[serde(rename = "APPROVE")]
    Approve,

    #[serde(rename = "DENY")]
    Deny,
}

/// GET /api/v1/approvals（待我审批）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history
/// 的投影。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalView {
    pub action_execution_id: String,

    pub action_key: String,

    /// RFC3339，UTC
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consume_deadline: Option<String>,

    pub decisions: Vec<DecisionElement>,

    /// RFC3339，UTC
    pub expires_at: String,

    pub initiator_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub role_requirements: Vec<RoleRequirementElement>,

    pub status: ApprovalStatus,

    pub target_id: String,

    pub target_type: String,

    pub workflow_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// 一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DecisionElement {
    pub approver_principal_id: String,

    /// RFC3339，UTC
    pub decided_at: String,

    pub decision: ApprovalDecision,

    /// 该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
    pub satisfied_selectors: Vec<ApprovalSelector>,
}

/// ApprovalPolicy.role_requirements 的角色选择器（.design/03 §4、.design/10 §2）：RESOURCE_APPROVER
/// 对目标 Resource/Asset 做 approve，WORKSPACE_ADMIN 对冻结 Workspace 做 manage，TENANT_ADMIN 对冻结
/// Tenant 做 manage。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalSelector {
    #[serde(rename = "RESOURCE_APPROVER")]
    ResourceApprover,

    #[serde(rename = "TENANT_ADMIN")]
    TenantAdmin,

    #[serde(rename = "WORKSPACE_ADMIN")]
    WorkspaceAdmin,
}

/// ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
/// §4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleRequirementElement {
    pub min_distinct: i64,

    pub selector: ApprovalSelector,
}

/// ApprovalWorkflow 的状态（.design/06 §4）：REQUESTED → WAITING → APPROVED | DENIED | EXPIRED |
/// CANCELLED；APPROVED → CONSUMED | INVALIDATED。只由 Temporal history 投影。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ApprovalStatus {
    #[serde(rename = "APPROVED")]
    Approved,

    #[serde(rename = "CANCELLED")]
    Cancelled,

    #[serde(rename = "CONSUMED")]
    Consumed,

    #[serde(rename = "DENIED")]
    Denied,

    #[serde(rename = "EXPIRED")]
    Expired,

    #[serde(rename = "INVALIDATED")]
    Invalidated,

    #[serde(rename = "REQUESTED")]
    Requested,

    #[serde(rename = "WAITING")]
    Waiting,
}

/// GET /api/v1/identity/client-keys 回应数组的元素：本人登记且未撤销的原生设备公钥（DD-77/79）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientKeyView {
    /// RFC3339
    pub created_at: String,

    pub pubkey: String,

    pub state: BuzzIdentityState,
}

/// BuzzIdentityBinding 状态机。custody=CLIENT 时跳过 PENDING_SECRET，自 RECONCILING 起始。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BuzzIdentityState {
    Active,

    #[serde(rename = "PENDING_SECRET")]
    PendingSecret,

    Reconciling,

    Revoked,

    Revoking,
}

/// 设备公钥登记（POST /api/v1/identity/client-keys）与撤销（DELETE
/// /api/v1/identity/client-keys/{pubkey}）的回应。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientKeyStatus {
    pub pubkey: String,

    /// 状态仍在收敛时，客户端再次读取设备状态前至少等待的毫秒数；确定终态时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recheck_after_millis: Option<i64>,

    pub state: BuzzIdentityState,

    /// 推进该状态的 Workflow；本次调用没有需要推进的状态时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
}

/// POST /api/v1/invitations/redeem 的回应与 GET /api/v1/invitations/redemptions
/// 的元素：兑换者自己看到的进度（DD-83）。membershipState=INVITED 且 admissionGateState=WAITING 表示等待 Tenant
/// admin 确认；ACTIVE 即可登录该 Tenant；REVOKED 即本次邀请已终结，reason 给出原因。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitationRedemptionView {
    pub admission_gate_state: ActionGateState,

    pub invitation_id: String,

    pub membership_state: TenantMembershipState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    /// RFC3339，UTC
    pub redeemed_at: String,

    pub tenant_id: String,

    pub tenant_name: String,
}

/// TenantMembership 状态机。REVOKING 期间必须立即拒绝新动作，对账完成后才进 REVOKED（.design/10 §4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TenantMembershipState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "INVITED")]
    Invited,

    #[serde(rename = "PROVISIONING")]
    Provisioning,

    #[serde(rename = "REVOKED")]
    Revoked,

    #[serde(rename = "REVOKING")]
    Revoking,
}

/// POST /api/v1/invitations/redeem 的请求体（DD-83）。兑换者身份只取网关投影的 issuer/subject，不接受请求体自报。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InvitationRedemptionRequest {
    /// 邀请链接 fragment 里的一次性凭据
    pub credential: String,

    /// 兑换者自报的显示名：只作展示，审批人据此与被邀请人对照，不参与任何判定
    pub display_name: String,
}

/// tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
/// 里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IssuedInvitation {
    /// RFC3339，UTC
    pub expires_at: String,

    pub invitation_id: String,

    /// 部署登记的链接基址 + '#' + 一次性凭据
    pub link: String,
}

/// GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
/// communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCommunityFacts {
    /// 该 Tenant 的 Community host，可能带非默认端口
    pub community_host: String,

    /// 原生端直连的 Relay 地址
    pub relay_url: String,
}

/// GET /api/v1/audit 回应数组的元素：调用方本人在当前 Tenant 内的动作（.design/03 §14 的最小集合）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnAuditEntry {
    pub action_key: String,

    pub decision: String,

    pub event_type: AuditEventType,

    /// RFC3339
    pub occurred_at: String,

    pub result_code: String,

    /// 动作所在的 Workspace；Tenant 级动作（设备公钥登记、认证等）缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// AuditEvent 的类型（.design/03 §9）。tenant_id 为空只允许 AUTHENTICATION 与 SESSION，且仅限 AgentGateway
/// OIDC callback 之后、Core 尚未解析出可用 TenantMembership 的那段边界（DD-52/54）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AuditEventType {
    #[serde(rename = "ACCESS")]
    Access,

    #[serde(rename = "APPROVAL")]
    Approval,

    #[serde(rename = "AUTHENTICATION")]
    Authentication,

    #[serde(rename = "DECISION")]
    Decision,

    #[serde(rename = "DISPATCH")]
    Dispatch,

    #[serde(rename = "INTENT")]
    Intent,

    #[serde(rename = "OUTCOME")]
    Outcome,

    #[serde(rename = "RECONCILIATION")]
    Reconciliation,

    #[serde(rename = "REVOCATION")]
    Revocation,

    #[serde(rename = "SESSION")]
    Session,
}

/// PUT /api/v1/user-state/read 的请求体（DD-40）。contextKey 只接受调用方可读 Workspace 内的 Channel ID 或
/// msg:<Buzz event id>；version 是读到的 CollaborationUserState 版本，不符即 409。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMarkRequest {
    pub context_key: String,

    /// RFC3339，Core 统一存成 UTC
    pub last_read_at: String,

    pub version: i64,
}

/// GET /api/v1/role-members 的有界回应。只列当前 Tenant 的 ACTIVE HUMAN 成员；角色从 SpiceDB fresh
/// 读取，动作可用性只作界面提示，提交时仍重新准入（DD-82）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleMemberPage {
    pub members: Vec<RoleMemberView>,

    /// 下一页首项之前的 Principal ID；缺省即已经读完
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleMemberView {
    pub can_grant_tenant_admin: bool,

    pub can_grant_workspace_admin: bool,

    pub can_revoke_tenant_admin: bool,

    pub can_revoke_workspace_admin: bool,

    pub display_name: String,

    /// 有效 Tenant admin 仅剩此人；该人的撤销按钮禁用，服务端最终准入仍重查
    pub last_tenant_admin: bool,

    pub principal_id: String,

    pub tenant_admin: bool,

    /// 没有 workspaceId 时恒为 false
    pub workspace_admin: bool,
}

/// GET /api/v1/role-workspaces 的有界回应：当前 Principal 对哪些 ACTIVE Workspace 持有 fresh manage
/// permission。只供角色管理选择，不等于可进入频道。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleWorkspacePage {
    /// 下一页的 Core 索引偏移；不暴露无权 Workspace 的 ID，缺省即读完
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub workspaces: Vec<RoleWorkspaceView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoleWorkspaceView {
    pub id: String,

    pub name: String,
}

/// GET /api/v1/session 的回应：已解析的执行身份与本次 PlatformSession。原生端以 platformSessionId
/// 绑定设备持钥证明（DD-79）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSessionView {
    /// 当前选定的 Workspace；未选定时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_workspace_id: Option<String>,

    /// HumanIdentity 的显示名，只用于界面上认出本人，不参与任何判定
    pub display_name: String,

    pub human_identity_id: String,

    pub platform_session_id: String,

    pub tenant_id: String,

    pub tenant_membership_id: String,

    pub tenant_principal_id: String,
}

/// GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
/// 非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    pub action_execution_id: String,

    pub action_key: String,

    pub action_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_status: Option<ApprovalStatus>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    /// RFC3339，UTC
    pub created_at: String,

    pub dispatch_state: ActionDispatchState,

    pub gate_state: ActionGateState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation: Option<ReasonCode>,

    pub operation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub target_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_status: Option<TaskStatus>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting_reason: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_kind: Option<WorkflowKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// TaskProjection 的状态（.design/03 §6、.design/06 §3.1）。RUNNING 之外的值都是 Temporal 的终态，与其 close
/// status 一一对应：Workflow 自己写回的只有 COMPLETED 与 FAILED，其余三个只来自兜底对账对 Temporal 的观察。任一终态都使
/// WorkflowRef 进入 TERMINAL。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TaskStatus {
    Canceled,

    Completed,

    Failed,

    Running,

    Terminated,

    #[serde(rename = "TIMED_OUT")]
    TimedOut,
}

/// ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
/// 必须同时出现在那里，否则能力注册表在构建期拒绝。本文件只含已实现的 kind。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WorkflowKind {
    #[serde(rename = "BUZZ_IDENTITY_PROJECTION")]
    BuzzIdentityProjection,

    #[serde(rename = "MEMBERSHIP_PROJECTION")]
    MembershipProjection,

    #[serde(rename = "MEMBERSHIP_REVOCATION")]
    MembershipRevocation,

    #[serde(rename = "TENANT_LIFECYCLE")]
    TenantLifecycle,

    #[serde(rename = "WORKSPACE_LIFECYCLE")]
    WorkspaceLifecycle,
}

/// GET /api/v1/invitations 回应数组的元素：本 Tenant 的邀请，只对持有 Tenant manage
/// 的人可见（DD-83）。不含凭据或其摘要。兑换后的确认经 approvalWorkflowId 走既有的审批决定端点。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantInvitationView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admit_action_execution_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_status: Option<ApprovalStatus>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    /// RFC3339，UTC
    pub created_at: String,

    /// RFC3339，UTC
    pub expires_at: String,

    pub invitation_id: String,

    /// 邀请人写给审批人看的称呼，不参与寻址与判定
    pub invitee_label: String,

    pub inviter_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_state: Option<TenantMembershipState>,

    /// RFC3339，UTC；只在 REDEEMED 时出现
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redeemed_at: Option<String>,

    /// 兑换者自报的显示名，只作展示
    #[serde(skip_serializing_if = "Option::is_none")]
    pub redeemer_display_name: Option<String>,

    pub status: TenantInvitationStatus,
}

/// TenantInvitation 在视图中的状态（DD-83）。库里只存 ISSUED/REDEEMED/REVOKED；EXPIRED 是查询时判定：expires_at
/// 已过的 ISSUED 邀请即 EXPIRED，没有回收作业去写它。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TenantInvitationStatus {
    #[serde(rename = "EXPIRED")]
    Expired,

    #[serde(rename = "ISSUED")]
    Issued,

    #[serde(rename = "REDEEMED")]
    Redeemed,

    #[serde(rename = "REVOKED")]
    Revoked,
}

/// CollaborationUserState 写入成功后的新版本（PUT /api/v1/user-state/read 与 PUT
/// /api/v1/user-state/workspaces/{workspaceId} 的 200 回应）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserStateVersion {
    pub version: i64,
}

/// GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 且两侧 binding 都 ACTIVE 的
/// Workspace。Workspace id 同时是其 Channel id（DD-80）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceView {
    pub id: String,

    pub name: String,

    pub slug: String,
}

/// GET /api/v1/workspaces/{workspaceId}/members 回应数组的元素，按人聚合（DD-77）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMemberView {
    pub display_name: String,

    pub principal_id: String,

    /// 此人全部 ACTIVE 的 Buzz 协议公钥：Web 一把，另加每台原生设备一把
    pub pubkeys: Vec<String>,

    pub state: WorkspaceMembershipState,
}

/// WorkspaceMembership 状态机。REVOKING 期间立即拒绝新动作；重新授权创建新 membership version，不复活旧投影。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceMembershipState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "PROVISIONING")]
    Provisioning,

    #[serde(rename = "REVOKED")]
    Revoked,

    #[serde(rename = "REVOKING")]
    Revoking,
}

/// PUT /api/v1/user-state/workspaces/{workspaceId} 的请求体（DD-40）：该 Workspace 的收藏与静音。version
/// 是读到的 CollaborationUserState 版本，不符即 409；updatedAt 由 Core 用库时钟补写，不取调用方的值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspacePreferenceRequest {
    pub muted: bool,

    pub starred: bool,

    pub version: i64,
}

/// 统一错误体（apps/06-工程基线规范.md 第 4 节）。不携带业务正文、secret、原始 SQL、文件内容或完整 prompt/response。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorBody {
    pub class: ErrorClass,

    /// 贯穿 Core、Worker、adapter 与组件的关联键
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,

    pub reason: ReasonCode,
}

/// BFF 从内网身份 header 解析出的执行身份（.design/09）。它只由已验证的 issuer/subject 推导，不接受调用方自报的任何字段。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedIdentity {
    /// 当前选定的 Workspace；未选定时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_workspace_id: Option<String>,

    pub human_identity_id: String,

    pub tenant_id: String,

    pub tenant_membership_id: String,

    pub tenant_principal_id: String,
}

/// Workflow 经 ProjectTaskState Activity 写回 Core 的一次状态跃迁（.design/06 §3.1）。Core 按 workflowId
/// 单调 upsert，eventId 不大于已有值的报告按幂等成功忽略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStateReport {
    /// 报告时的 history 长度；同一 workflow 内单调，重放时取到同一值
    pub event_id: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<String>,

    pub run_id: String,

    pub status: TaskStatus,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub waiting_reason: Option<String>,

    /// 固定格式的业务 workflow ID
    pub workflow_id: String,
}

/// Core 在 Temporal Start 之前持久化的唯一引用（.design/06）。workflowId 一律取
/// kailo:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>，使「不分配第二个业务 workflow ID」可被机械校验。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRef {
    /// RFC3339；Describe 返回 NotFound 时用它判断是否仍在 retention 窗口内
    pub created_at: String,

    pub entity_version: i64,

    pub kind: WorkflowKind,

    pub primary_entity_id: String,

    /// Start 成功后回填；未知时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,

    pub tenant_id: String,

    /// 固定格式的业务 workflow ID
    pub workflow_id: String,
}

/// 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedOwnerRef {
    pub owner_principal_id: String,

    pub target_id: String,

    pub target_type: String,

    pub target_version: i64,
}

/// consume、invalidate、withdraw 三个 Update 的结果：执行后的 Approval 状态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalControlOutcome {
    pub status: ApprovalStatus,
}

/// decide Update 的结果。admitted=false 表示 FreshApprovalAdmission 未通过，这次 Update 没有形成决定；decision
/// 是该 approver 已记录的决定（重复同值时即原决定）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecisionOutcome {
    pub admitted: bool,

    pub approver_principal_id: String,

    /// 已形成的决定；admitted=false 时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub decision: Option<ApprovalDecision>,

    /// admitted=false 时的拒绝原因
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub status: ApprovalStatus,
}

/// 一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecisionRecord {
    pub approver_principal_id: String,

    /// RFC3339，UTC
    pub decided_at: String,

    pub decision: ApprovalDecision,

    /// 该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
    pub satisfied_selectors: Vec<ApprovalSelector>,
}

/// decide Update 的参数。Update ID 固定为 <approval_workflow_id>:<approver_principal_id>，由 Server
/// 侧去重；approverPrincipalId 由 Core 从 PlatformSession 取得，不接受 Browser 自报。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecisionUpdate {
    pub approver_principal_id: String,

    pub decision: ApprovalDecision,
}

/// ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
/// ActionExecution。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalWorkflowInput {
    pub action_definition_version: i64,

    pub action_execution_id: String,

    pub action_key: String,

    pub affected_owner_refs: Vec<AffectedOwnerRefElement>,

    /// APPROVED 之后等待 consume 的上界；超时自动 INVALIDATED
    pub consume_window_seconds: i64,

    /// RFC3339，UTC。Core 按 ApprovalPolicy.expires_in 在请求时冻结；Workflow 以 workflow.Now() 与之比较
    pub expires_at: String,

    pub initiator_principal_id: String,

    pub operation_id: String,

    pub owner_requirement: ApprovalOwnerRequirement,

    pub parameter_hash: String,

    pub policy_id: String,

    pub policy_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub resume: Option<ResumeClass>,

    pub role_requirements: Vec<RoleRequirementElement>,

    pub self_approval: ApprovalSelfApproval,

    pub target_id: String,

    pub target_type: String,

    pub tenant_id: String,

    /// TENANT_ONLY 动作缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AffectedOwnerRefElement {
    pub owner_principal_id: String,

    pub target_id: String,

    pub target_type: String,

    pub target_version: i64,
}

/// ApprovalPolicy.owner_requirement（.design/03 §4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApprovalOwnerRequirement {
    #[serde(rename = "ALL_AFFECTED_OWNERS")]
    AllAffectedOwners,

    None,

    #[serde(rename = "TARGET_OWNER")]
    TargetOwner,
}

/// ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
/// 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeClass {
    /// RFC3339，UTC
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_at: Option<String>,

    /// RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consume_deadline: Option<String>,

    pub decisions: Vec<DecisionElement>,

    /// 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
    /// 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
    pub event_base: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub refusals: Vec<RefusalElement>,

    pub status: ApprovalStatus,
}

/// 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
/// §4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefusalElement {
    pub approver_principal_id: String,

    pub reason: ReasonCode,
}

/// ApprovalPolicy.self_approval：发起者能否批准自己的请求（职责分离）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ApprovalSelfApproval {
    #[serde(rename = "ALLOW")]
    Allow,

    #[serde(rename = "DENY")]
    Deny,
}

/// invalidate Update 的参数：Core 在批准后重新准入不通过时发出（.design/06 §4）。Update ID 固定为
/// <action_execution_id>:invalidate。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalInvalidateUpdate {
    pub reason: ReasonCode,
}

/// 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
/// §4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRefusal {
    pub approver_principal_id: String,

    pub reason: ReasonCode,
}

/// ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
/// 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalResume {
    /// RFC3339，UTC
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_at: Option<String>,

    /// RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consume_deadline: Option<String>,

    pub decisions: Vec<DecisionElement>,

    /// 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
    /// 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
    pub event_base: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub refusals: Vec<RefusalElement>,

    pub status: ApprovalStatus,
}

/// ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
/// §4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRoleRequirement {
    pub min_distinct: i64,

    pub selector: ApprovalSelector,
}

/// ApprovalWorkflow 经 ProjectApprovalState Activity 写回 Core 的一次状态跃迁。Core 按 workflowId 与
/// eventId 单调 upsert；ApprovalProjection 只接受这一条写入路径（DD-47）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalStateReport {
    /// RFC3339，UTC；进入 CONSUMED 时的 workflow.Now()
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_at: Option<String>,

    /// RFC3339，UTC；进入 APPROVED 时由 workflow.Now() 加 consumeWindowSeconds 得出
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consume_deadline: Option<String>,

    pub decisions: Vec<DecisionElement>,

    /// 报告时跨 run 累计的 history 长度
    pub event_id: i64,

    /// RFC3339，UTC
    pub expires_at: String,

    /// INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub run_id: String,

    pub status: ApprovalStatus,

    pub workflow_id: String,
}

/// FreshApprovalAdmission Activity 发往 Core service API 的请求（.design/06 §4）：active HUMAN、fresh
/// 选择器 permission、owner 对账与职责分离由 Core 判定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshApprovalAdmissionRequest {
    pub approval_workflow_id: String,

    pub approver_principal_id: String,

    pub decision: ApprovalDecision,
}

/// FreshApprovalAdmission 的结论。admitted=false 时 reason 必有；该结论作为一条被拒决定进入 history，而不是
/// pre-history 拒绝。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshApprovalAdmissionResult {
    pub admitted: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub satisfied_selectors: Vec<ApprovalSelector>,
}
