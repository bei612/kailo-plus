/**
 * 可用 JSON Schema 子集的可执行定义。它穷举 contracts/README.md 第 1
 * 节允许的每一种构造；四侧生成器必须全部生成成功并通过双向序列化。新增构造先加进本文件并四侧验证通过，才允许在其他 schema 中使用。
 */
export interface Canary {
    /**
     * 可选的枚举引用
     */
    capabilityState?: CapabilityState;
    /**
     * 基础 integer
     */
    count: number;
    /**
     * 基础 boolean
     */
    enabled: boolean;
    /**
     * 跨文件 $ref 引用封闭枚举
     */
    errorClass: ErrorClass;
    /**
     * format: uuid
     */
    id: string;
    /**
     * 基础 string
     */
    name: string;
    /**
     * 内联对象，同样显式关闭 additionalProperties
     */
    nested: Nested;
    /**
     * RFC3339 时间戳，按普通 string 传输。format: date-time 不在可用子集内——Dart 的 toIso8601String()
     * 强制补毫秒，四侧线格式不等价。取值合法性由 Core 在 Admission 校验，不由 schema 承担。
     */
    occurredAt?: string;
    /**
     * 基础 number
     */
    ratio: number;
    /**
     * 同构数组
     */
    tags: string[];
    /**
     * 变体类型的平坦表达：封闭枚举 tag 加各变体字段全部可选，替代被禁用的 oneOf
     */
    variants?: Variant[];
}

/**
 * 可选的枚举引用
 *
 * 能力状态。权威定义见 .design/02-源码证据与设计决策.md。BLOCKED 的能力不得生成任何入口、路由、动作、工具或开关。
 */
export enum CapabilityState {
    AdapterRequired = "ADAPTER_REQUIRED",
    Blocked = "BLOCKED",
    DesignDefined = "DESIGN_DEFINED",
    Excluded = "EXCLUDED",
    UpstreamSupported = "UPSTREAM_SUPPORTED",
}

/**
 * 跨文件 $ref 引用封闭枚举
 *
 * 错误分类。每个 API 错误、Workflow 失败与 UI 状态必须落在其中之一。权威定义见 apps/06-工程基线规范.md 第 4 节。UNKNOWN
 * 表示外部副作用结果不明，等待对账，禁止渲染成成功或失败，也禁止盲目重放。
 */
export enum ErrorClass {
    Blocked = "BLOCKED",
    Conflict = "CONFLICT",
    Denied = "DENIED",
    Limit = "LIMIT",
    Precondition = "PRECONDITION",
    Unknown = "UNKNOWN",
}

/**
 * 内联对象，同样显式关闭 additionalProperties
 */
export interface Nested {
    label:    string;
    weights?: number[];
}

export interface Variant {
    fileDigest?:  string;
    kind:         Kind;
    messageBody?: string;
    taskAttempt?: number;
}

export enum Kind {
    File = "FILE",
    Message = "MESSAGE",
    Task = "TASK",
}

/**
 * POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
 * actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
 */
export interface ActionCommand {
    actionKey: string;
    /**
     * 调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
     */
    idempotencyKey: string;
    /**
     * tenant.member.invite.revoke 的目标邀请
     */
    invitationId?: string;
    /**
     * workspace.create 的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
     */
    name?: string;
    /**
     * 成员动作的目标 Principal
     */
    principalId?: string;
    /**
     * workspace.create 的 slug
     */
    slug?: string;
    /**
     * Workspace 内动作的执行 Workspace
     */
    workspaceId?: string;
}

/**
 * POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
 * 必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。
 */
export interface ActionSubmission {
    actionExecutionId:   string;
    actionKey:           string;
    approvalWorkflowId?: string;
    dispatchState:       ActionDispatchState;
    gateState:           ActionGateState;
    invitation?:         InvitationClass;
    operationId:         string;
    reason?:             ReasonCode;
    workflowId?:         string;
}

/**
 * ActionExecution 的派发状态（.design/03 §6）。UNKNOWN 是结果不明，既不是成功也不是失败——只有已登记的 native query/dedupe
 * seam 能把它收敛，不能因无 native ID 就自动重放（DD-48）。
 */
export enum ActionDispatchState {
    Aborted = "ABORTED",
    Dispatched = "DISPATCHED",
    NotDispatched = "NOT_DISPATCHED",
    Unknown = "UNKNOWN",
}

/**
 * ActionExecution 的准入门禁状态（.design/03 §6）。它与 dispatch_state
 * 是两台独立状态机：门禁说的是「允许不允许」，派发说的是「副作用发生没发生」，合并后无法表达「准入通过但派发结果不明」。
 */
export enum ActionGateState {
    Allowed = "ALLOWED",
    Denied = "DENIED",
    Evaluating = "EVALUATING",
    Expired = "EXPIRED",
    Revoked = "REVOKED",
    Waiting = "WAITING",
}

/**
 * tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
 * 里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
 */
export interface InvitationClass {
    /**
     * RFC3339，UTC
     */
    expiresAt:    string;
    invitationId: string;
    /**
     * 部署登记的链接基址 + '#' + 一次性凭据
     */
    link: string;
}

/**
 * 稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
 * 字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
 *
 * admitted=false 时的拒绝原因
 *
 * INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
 */
export enum ReasonCode {
    AdmissionAbandoned = "ADMISSION_ABANDONED",
    ApprovalConsumeWindowClosed = "APPROVAL_CONSUME_WINDOW_CLOSED",
    ApprovalDenied = "APPROVAL_DENIED",
    ApprovalExpired = "APPROVAL_EXPIRED",
    ApprovalInvalidated = "APPROVAL_INVALIDATED",
    ApprovalNotOpen = "APPROVAL_NOT_OPEN",
    ApprovalSelectorUnresolvable = "APPROVAL_SELECTOR_UNRESOLVABLE",
    ApprovalWithdrawn = "APPROVAL_WITHDRAWN",
    ApproverNotEligible = "APPROVER_NOT_ELIGIBLE",
    CapabilityBlocked = "CAPABILITY_BLOCKED",
    ClientKeyAlreadyBound = "CLIENT_KEY_ALREADY_BOUND",
    ClientKeyLimitReached = "CLIENT_KEY_LIMIT_REACHED",
    ClientKeyNotFound = "CLIENT_KEY_NOT_FOUND",
    ClientKeyProofInvalid = "CLIENT_KEY_PROOF_INVALID",
    DependencyUnavailable = "DEPENDENCY_UNAVAILABLE",
    DispatchResultUnknown = "DISPATCH_RESULT_UNKNOWN",
    DuplicateDecision = "DUPLICATE_DECISION",
    ExternalResultUnknown = "EXTERNAL_RESULT_UNKNOWN",
    IdempotencyKeyReused = "IDEMPOTENCY_KEY_REUSED",
    IdentityHeaderMissing = "IDENTITY_HEADER_MISSING",
    IdentityUnknown = "IDENTITY_UNKNOWN",
    InvalidParameters = "INVALID_PARAMETERS",
    InvitationAlreadyRedeemed = "INVITATION_ALREADY_REDEEMED",
    InvitationExpired = "INVITATION_EXPIRED",
    InvitationNotFound = "INVITATION_NOT_FOUND",
    InvitationRevoked = "INVITATION_REVOKED",
    InviteeAlreadyMember = "INVITEE_ALREADY_MEMBER",
    LastTenantAdmin = "LAST_TENANT_ADMIN",
    NativeSurfaceRequired = "NATIVE_SURFACE_REQUIRED",
    PermissionDenied = "PERMISSION_DENIED",
    ProjectionDelayed = "PROJECTION_DELAYED",
    PublishRejected = "PUBLISH_REJECTED",
    PublishResultUnknown = "PUBLISH_RESULT_UNKNOWN",
    ScopeGuardFailed = "SCOPE_GUARD_FAILED",
    SelfApprovalDenied = "SELF_APPROVAL_DENIED",
    SessionNotActive = "SESSION_NOT_ACTIVE",
    SurfaceCapabilityUnavailable = "SURFACE_CAPABILITY_UNAVAILABLE",
    TargetNotFound = "TARGET_NOT_FOUND",
    TargetStateConflict = "TARGET_STATE_CONFLICT",
    TenantMembershipNotActive = "TENANT_MEMBERSHIP_NOT_ACTIVE",
    TenantSelectionNotAvailable = "TENANT_SELECTION_NOT_AVAILABLE",
    WaitingApproval = "WAITING_APPROVAL",
}

/**
 * POST /api/v1/approvals/{workflowId}/decision 的请求体；approver 由 PlatformSession 决定。回应为
 * ApprovalDecisionOutcome。
 */
export interface ApprovalDecisionRequest {
    decision: ApprovalDecision;
}

/**
 * approver 的不可变决定（.design/03 §6）。
 *
 * 已形成的决定；admitted=false 时缺省
 */
export enum ApprovalDecision {
    Approve = "APPROVE",
    Deny = "DENY",
}

/**
 * GET /api/v1/approvals（待我审批）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history
 * 的投影。
 */
export interface ApprovalView {
    actionExecutionId: string;
    actionKey:         string;
    /**
     * RFC3339，UTC
     */
    consumeDeadline?: string;
    decisions:        DecisionElement[];
    /**
     * RFC3339，UTC
     */
    expiresAt:            string;
    initiatorPrincipalId: string;
    observation?:         ReasonCode;
    reason?:              ReasonCode;
    roleRequirements:     RoleRequirementElement[];
    status:               ApprovalStatus;
    targetId:             string;
    targetType:           string;
    workflowId:           string;
    workspaceId?:         string;
}

/**
 * 一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
 */
export interface DecisionElement {
    approverPrincipalId: string;
    /**
     * RFC3339，UTC
     */
    decidedAt: string;
    decision:  ApprovalDecision;
    /**
     * 该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
     */
    satisfiedSelectors: ApprovalSelector[];
}

/**
 * ApprovalPolicy.role_requirements 的角色选择器（.design/03 §4、.design/10 §2）：RESOURCE_APPROVER
 * 对目标 Resource/Asset 做 approve，WORKSPACE_ADMIN 对冻结 Workspace 做 manage，TENANT_ADMIN 对冻结
 * Tenant 做 manage。
 */
export enum ApprovalSelector {
    ResourceApprover = "RESOURCE_APPROVER",
    TenantAdmin = "TENANT_ADMIN",
    WorkspaceAdmin = "WORKSPACE_ADMIN",
}

/**
 * ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
 * §4）。
 */
export interface RoleRequirementElement {
    minDistinct: number;
    selector:    ApprovalSelector;
}

/**
 * ApprovalWorkflow 的状态（.design/06 §4）：REQUESTED → WAITING → APPROVED | DENIED | EXPIRED |
 * CANCELLED；APPROVED → CONSUMED | INVALIDATED。只由 Temporal history 投影。
 */
export enum ApprovalStatus {
    Approved = "APPROVED",
    Cancelled = "CANCELLED",
    Consumed = "CONSUMED",
    Denied = "DENIED",
    Expired = "EXPIRED",
    Invalidated = "INVALIDATED",
    Requested = "REQUESTED",
    Waiting = "WAITING",
}

/**
 * GET /api/v1/identity/client-keys 回应数组的元素：本人登记且未撤销的原生设备公钥（DD-77/79）。
 */
export interface ClientKeyView {
    /**
     * RFC3339
     */
    createdAt: string;
    pubkey:    string;
    state:     BuzzIdentityState;
}

/**
 * BuzzIdentityBinding 状态机。custody=CLIENT 时跳过 PENDING_SECRET，自 RECONCILING 起始。
 */
export enum BuzzIdentityState {
    Active = "ACTIVE",
    PendingSecret = "PENDING_SECRET",
    Reconciling = "RECONCILING",
    Revoked = "REVOKED",
    Revoking = "REVOKING",
}

/**
 * 设备公钥登记（POST /api/v1/identity/client-keys）与撤销（DELETE
 * /api/v1/identity/client-keys/{pubkey}）的回应。
 */
export interface ClientKeyStatus {
    pubkey: string;
    state:  BuzzIdentityState;
    /**
     * 推进该状态的 Workflow；本次调用没有需要推进的状态时缺省
     */
    workflowId?: string;
}

/**
 * POST /api/v1/invitations/redeem 的回应与 GET /api/v1/invitations/redemptions
 * 的元素：兑换者自己看到的进度（DD-83）。membershipState=INVITED 且 admissionGateState=WAITING 表示等待 Tenant
 * admin 确认；ACTIVE 即可登录该 Tenant；REVOKED 即本次邀请已终结，reason 给出原因。
 */
export interface InvitationRedemptionView {
    admissionGateState: ActionGateState;
    invitationId:       string;
    membershipState:    TenantMembershipState;
    reason?:            ReasonCode;
    /**
     * RFC3339，UTC
     */
    redeemedAt: string;
    tenantId:   string;
    tenantName: string;
}

/**
 * TenantMembership 状态机。REVOKING 期间必须立即拒绝新动作，对账完成后才进 REVOKED（.design/10 §4）。
 */
export enum TenantMembershipState {
    Active = "ACTIVE",
    Error = "ERROR",
    Invited = "INVITED",
    Provisioning = "PROVISIONING",
    Revoked = "REVOKED",
    Revoking = "REVOKING",
}

/**
 * POST /api/v1/invitations/redeem 的请求体（DD-83）。兑换者身份只取网关投影的 issuer/subject，不接受请求体自报。
 */
export interface InvitationRedemptionRequest {
    /**
     * 邀请链接 fragment 里的一次性凭据
     */
    credential: string;
    /**
     * 兑换者自报的显示名：只作展示，审批人据此与被邀请人对照，不参与任何判定
     */
    displayName: string;
}

/**
 * tenant.member.invite 首次回应里一次性出现的邀请（DD-83）。link 含明文凭据（在 URL fragment
 * 里），服务端只存其摘要，之后任何回应都不再给出；丢失即撤回重发。
 */
export interface IssuedInvitation {
    /**
     * RFC3339，UTC
     */
    expiresAt:    string;
    invitationId: string;
    /**
     * 部署登记的链接基址 + '#' + 一次性凭据
     */
    link: string;
}

/**
 * GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
 * communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
 */
export interface NativeCommunityFacts {
    /**
     * 该 Tenant 的 Community host，可能带非默认端口
     */
    communityHost: string;
    /**
     * 原生端直连的 Relay 地址
     */
    relayUrl: string;
}

/**
 * GET /api/v1/audit 回应数组的元素：调用方本人在当前 Tenant 内的动作（.design/03 §14 的最小集合）。
 */
export interface OwnAuditEntry {
    actionKey: string;
    decision:  string;
    eventType: AuditEventType;
    /**
     * RFC3339
     */
    occurredAt: string;
    resultCode: string;
    /**
     * 动作所在的 Workspace；Tenant 级动作（设备公钥登记、认证等）缺省
     */
    workspaceId?: string;
}

/**
 * AuditEvent 的类型（.design/03 §9）。tenant_id 为空只允许 AUTHENTICATION 与 SESSION，且仅限 AgentGateway
 * OIDC callback 之后、Core 尚未解析出可用 TenantMembership 的那段边界（DD-52/54）。
 */
export enum AuditEventType {
    Access = "ACCESS",
    Approval = "APPROVAL",
    Authentication = "AUTHENTICATION",
    Decision = "DECISION",
    Dispatch = "DISPATCH",
    Intent = "INTENT",
    Outcome = "OUTCOME",
    Reconciliation = "RECONCILIATION",
    Revocation = "REVOCATION",
    Session = "SESSION",
}

/**
 * PUT /api/v1/user-state/read 的请求体（DD-40）。contextKey 只接受调用方可读 Workspace 内的 Channel ID 或
 * msg:<Buzz event id>；version 是读到的 CollaborationUserState 版本，不符即 409。
 */
export interface ReadMarkRequest {
    contextKey: string;
    /**
     * RFC3339，Core 统一存成 UTC
     */
    lastReadAt: string;
    version:    number;
}

/**
 * GET /api/v1/session 的回应：已解析的执行身份与本次 PlatformSession。原生端以 platformSessionId
 * 绑定设备持钥证明（DD-79）。
 */
export interface PlatformSessionView {
    /**
     * 当前选定的 Workspace；未选定时缺省
     */
    currentWorkspaceId?: string;
    /**
     * HumanIdentity 的显示名，只用于界面上认出本人，不参与任何判定
     */
    displayName:        string;
    humanIdentityId:    string;
    platformSessionId:  string;
    tenantId:           string;
    tenantMembershipId: string;
    tenantPrincipalId:  string;
}

/**
 * GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
 * 非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
 */
export interface TaskView {
    actionExecutionId:   string;
    actionKey:           string;
    actionVersion:       number;
    approvalStatus?:     ApprovalStatus;
    approvalWorkflowId?: string;
    /**
     * RFC3339，UTC
     */
    createdAt:      string;
    dispatchState:  ActionDispatchState;
    gateState:      ActionGateState;
    observation?:   ReasonCode;
    operationId:    string;
    reason?:        ReasonCode;
    targetId:       string;
    taskStatus?:    TaskStatus;
    waitingReason?: string;
    workflowId?:    string;
    workflowKind?:  WorkflowKind;
    workspaceId?:   string;
}

/**
 * TaskProjection 的状态（.design/03 §6、.design/06 §3.1）。RUNNING 之外的值都是 Temporal 的终态，与其 close
 * status 一一对应：Workflow 自己写回的只有 COMPLETED 与 FAILED，其余三个只来自兜底对账对 Temporal 的观察。任一终态都使
 * WorkflowRef 进入 TERMINAL。
 */
export enum TaskStatus {
    Canceled = "CANCELED",
    Completed = "COMPLETED",
    Failed = "FAILED",
    Running = "RUNNING",
    Terminated = "TERMINATED",
    TimedOut = "TIMED_OUT",
}

/**
 * ComponentTaskWorkflow 的封闭 kind 列表。权威定义见 .design/06-Temporal任务工作台.md；新增 kind
 * 必须同时出现在那里，否则能力注册表在构建期拒绝。本文件只含已实现的 kind。
 */
export enum WorkflowKind {
    BuzzIdentityProjection = "BUZZ_IDENTITY_PROJECTION",
    MembershipProjection = "MEMBERSHIP_PROJECTION",
    MembershipRevocation = "MEMBERSHIP_REVOCATION",
    TenantLifecycle = "TENANT_LIFECYCLE",
    WorkspaceLifecycle = "WORKSPACE_LIFECYCLE",
}

/**
 * GET /api/v1/invitations 回应数组的元素：本 Tenant 的邀请，只对持有 Tenant manage
 * 的人可见（DD-83）。不含凭据或其摘要。兑换后的确认经 approvalWorkflowId 走既有的审批决定端点。
 */
export interface TenantInvitationView {
    admitActionExecutionId?: string;
    approvalStatus?:         ApprovalStatus;
    approvalWorkflowId?:     string;
    /**
     * RFC3339，UTC
     */
    createdAt: string;
    /**
     * RFC3339，UTC
     */
    expiresAt:    string;
    invitationId: string;
    /**
     * 邀请人写给审批人看的称呼，不参与寻址与判定
     */
    inviteeLabel:       string;
    inviterPrincipalId: string;
    membershipId?:      string;
    membershipState?:   TenantMembershipState;
    /**
     * RFC3339，UTC；只在 REDEEMED 时出现
     */
    redeemedAt?: string;
    /**
     * 兑换者自报的显示名，只作展示
     */
    redeemerDisplayName?: string;
    status:               TenantInvitationStatus;
}

/**
 * TenantInvitation 在视图中的状态（DD-83）。库里只存 ISSUED/REDEEMED/REVOKED；EXPIRED 是查询时判定：expires_at
 * 已过的 ISSUED 邀请即 EXPIRED，没有回收作业去写它。
 */
export enum TenantInvitationStatus {
    Expired = "EXPIRED",
    Issued = "ISSUED",
    Redeemed = "REDEEMED",
    Revoked = "REVOKED",
}

/**
 * CollaborationUserState 写入成功后的新版本（PUT /api/v1/user-state/read 与 PUT
 * /api/v1/user-state/workspaces/{workspaceId} 的 200 回应）。
 */
export interface UserStateVersion {
    version: number;
}

/**
 * GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 且两侧 binding 都 ACTIVE 的
 * Workspace。Workspace id 同时是其 Channel id（DD-80）。
 */
export interface WorkspaceView {
    id:   string;
    name: string;
    slug: string;
}

/**
 * GET /api/v1/workspaces/{workspaceId}/members 回应数组的元素，按人聚合（DD-77）。
 */
export interface WorkspaceMemberView {
    displayName: string;
    principalId: string;
    /**
     * 此人全部 ACTIVE 的 Buzz 协议公钥：Web 一把，另加每台原生设备一把
     */
    pubkeys: string[];
    state:   WorkspaceMembershipState;
}

/**
 * WorkspaceMembership 状态机。REVOKING 期间立即拒绝新动作；重新授权创建新 membership version，不复活旧投影。
 */
export enum WorkspaceMembershipState {
    Active = "ACTIVE",
    Error = "ERROR",
    Provisioning = "PROVISIONING",
    Revoked = "REVOKED",
    Revoking = "REVOKING",
}

/**
 * PUT /api/v1/user-state/workspaces/{workspaceId} 的请求体（DD-40）：该 Workspace 的收藏与静音。version
 * 是读到的 CollaborationUserState 版本，不符即 409；updatedAt 由 Core 用库时钟补写，不取调用方的值。
 */
export interface WorkspacePreferenceRequest {
    muted:   boolean;
    starred: boolean;
    version: number;
}

/**
 * 统一错误体（apps/06-工程基线规范.md 第 4 节）。不携带业务正文、secret、原始 SQL、文件内容或完整 prompt/response。
 */
export interface ErrorBody {
    class: ErrorClass;
    /**
     * 贯穿 Core、Worker、adapter 与组件的关联键
     */
    operationId?: string;
    reason:       ReasonCode;
}

/**
 * BFF 从内网身份 header 解析出的执行身份（.design/09）。它只由已验证的 issuer/subject 推导，不接受调用方自报的任何字段。
 */
export interface ResolvedIdentity {
    /**
     * 当前选定的 Workspace；未选定时缺省
     */
    currentWorkspaceId?: string;
    humanIdentityId:     string;
    tenantId:            string;
    tenantMembershipId:  string;
    tenantPrincipalId:   string;
}

/**
 * Workflow 经 ProjectTaskState Activity 写回 Core 的一次状态跃迁（.design/06 §3.1）。Core 按 workflowId
 * 单调 upsert，eventId 不大于已有值的报告按幂等成功忽略。
 */
export interface TaskStateReport {
    /**
     * 报告时的 history 长度；同一 workflow 内单调，重放时取到同一值
     */
    eventId:        number;
    progress?:      string;
    runId:          string;
    status:         TaskStatus;
    waitingReason?: string;
    /**
     * 固定格式的业务 workflow ID
     */
    workflowId: string;
}

/**
 * Core 在 Temporal Start 之前持久化的唯一引用（.design/06）。workflowId 一律取
 * kailo:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>，使「不分配第二个业务 workflow ID」可被机械校验。
 */
export interface WorkflowRef {
    /**
     * RFC3339；Describe 返回 NotFound 时用它判断是否仍在 retention 窗口内
     */
    createdAt:       string;
    entityVersion:   number;
    kind:            WorkflowKind;
    primaryEntityId: string;
    /**
     * Start 成功后回填；未知时缺省
     */
    runId?:   string;
    tenantId: string;
    /**
     * 固定格式的业务 workflow ID
     */
    workflowId: string;
}

/**
 * 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
 */
export interface AffectedOwnerRef {
    ownerPrincipalId: string;
    targetId:         string;
    targetType:       string;
    targetVersion:    number;
}

/**
 * consume、invalidate、withdraw 三个 Update 的结果：执行后的 Approval 状态。
 */
export interface ApprovalControlOutcome {
    status: ApprovalStatus;
}

/**
 * decide Update 的结果。admitted=false 表示 FreshApprovalAdmission 未通过，这次 Update 没有形成决定；decision
 * 是该 approver 已记录的决定（重复同值时即原决定）。
 */
export interface ApprovalDecisionOutcome {
    admitted:            boolean;
    approverPrincipalId: string;
    /**
     * 已形成的决定；admitted=false 时缺省
     */
    decision?: ApprovalDecision;
    /**
     * admitted=false 时的拒绝原因
     */
    reason?: ReasonCode;
    status:  ApprovalStatus;
}

/**
 * 一条已形成的不可变决定。只有经 FreshApprovalAdmission 通过的 Update 才形成决定；decidedAt 取 workflow.Now()。
 */
export interface ApprovalDecisionRecord {
    approverPrincipalId: string;
    /**
     * RFC3339，UTC
     */
    decidedAt: string;
    decision:  ApprovalDecision;
    /**
     * 该 approver 在决定时经 fresh Check 满足的选择器；同一人可在多个要求中计数，但只产生一个决定
     */
    satisfiedSelectors: ApprovalSelector[];
}

/**
 * decide Update 的参数。Update ID 固定为 <approval_workflow_id>:<approver_principal_id>，由 Server
 * 侧去重；approverPrincipalId 由 Core 从 PlatformSession 取得，不接受 Browser 自报。
 */
export interface ApprovalDecisionUpdate {
    approverPrincipalId: string;
    decision:            ApprovalDecision;
}

/**
 * ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
 * ActionExecution。
 */
export interface ApprovalWorkflowInput {
    actionDefinitionVersion: number;
    actionExecutionId:       string;
    actionKey:               string;
    affectedOwnerRefs:       AffectedOwnerRefElement[];
    /**
     * APPROVED 之后等待 consume 的上界；超时自动 INVALIDATED
     */
    consumeWindowSeconds: number;
    /**
     * RFC3339，UTC。Core 按 ApprovalPolicy.expires_in 在请求时冻结；Workflow 以 workflow.Now() 与之比较
     */
    expiresAt:            string;
    initiatorPrincipalId: string;
    operationId:          string;
    ownerRequirement:     ApprovalOwnerRequirement;
    parameterHash:        string;
    policyId:             string;
    policyVersion:        number;
    resume?:              ResumeClass;
    roleRequirements:     RoleRequirementElement[];
    selfApproval:         ApprovalSelfApproval;
    targetId:             string;
    targetType:           string;
    tenantId:             string;
    /**
     * TENANT_ONLY 动作缺省
     */
    workspaceId?: string;
}

/**
 * 请求时从 Core owner 事实与已对账 SpiceDB owner relationship 冻结的受影响 owner（.design/03 §6）。
 */
export interface AffectedOwnerRefElement {
    ownerPrincipalId: string;
    targetId:         string;
    targetType:       string;
    targetVersion:    number;
}

/**
 * ApprovalPolicy.owner_requirement（.design/03 §4）。
 */
export enum ApprovalOwnerRequirement {
    AllAffectedOwners = "ALL_AFFECTED_OWNERS",
    None = "NONE",
    TargetOwner = "TARGET_OWNER",
}

/**
 * ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
 * 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
 */
export interface ResumeClass {
    /**
     * RFC3339，UTC
     */
    consumedAt?: string;
    /**
     * RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
     */
    consumeDeadline?: string;
    decisions:        DecisionElement[];
    /**
     * 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
     * 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
     */
    eventBase: number;
    reason?:   ReasonCode;
    refusals:  RefusalElement[];
    status:    ApprovalStatus;
}

/**
 * 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
 * §4）。
 */
export interface RefusalElement {
    approverPrincipalId: string;
    reason:              ReasonCode;
}

/**
 * ApprovalPolicy.self_approval：发起者能否批准自己的请求（职责分离）。
 */
export enum ApprovalSelfApproval {
    Allow = "ALLOW",
    Deny = "DENY",
}

/**
 * invalidate Update 的参数：Core 在批准后重新准入不通过时发出（.design/06 §4）。Update ID 固定为
 * <action_execution_id>:invalidate。
 */
export interface ApprovalInvalidateUpdate {
    reason: ReasonCode;
}

/**
 * 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
 * §4）。
 */
export interface ApprovalRefusal {
    approverPrincipalId: string;
    reason:              ReasonCode;
}

/**
 * ApprovalWorkflow 经 continue-as-new 续跑时带入新 run 的已有状态（.design/06 §3）。冻结输入原样沿用；这里只放 history
 * 才知道的东西——状态、不可变决定、资格判定的结论与 consume 截止。由 Workflow 自己写入，Core 启动审批时从不填写。
 */
export interface ApprovalResume {
    /**
     * RFC3339，UTC
     */
    consumedAt?: string;
    /**
     * RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
     */
    consumeDeadline?: string;
    decisions:        DecisionElement[];
    /**
     * 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
     * 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
     */
    eventBase: number;
    reason?:   ReasonCode;
    refusals:  RefusalElement[];
    status:    ApprovalStatus;
}

/**
 * ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
 * §4）。
 */
export interface ApprovalRoleRequirement {
    minDistinct: number;
    selector:    ApprovalSelector;
}

/**
 * ApprovalWorkflow 经 ProjectApprovalState Activity 写回 Core 的一次状态跃迁。Core 按 workflowId 与
 * eventId 单调 upsert；ApprovalProjection 只接受这一条写入路径（DD-47）。
 */
export interface ApprovalStateReport {
    /**
     * RFC3339，UTC；进入 CONSUMED 时的 workflow.Now()
     */
    consumedAt?: string;
    /**
     * RFC3339，UTC；进入 APPROVED 时由 workflow.Now() 加 consumeWindowSeconds 得出
     */
    consumeDeadline?: string;
    decisions:        DecisionElement[];
    /**
     * 报告时跨 run 累计的 history 长度
     */
    eventId: number;
    /**
     * RFC3339，UTC
     */
    expiresAt: string;
    /**
     * INVALIDATED/EXPIRED/CANCELLED/DENIED 的原因
     */
    reason?:    ReasonCode;
    runId:      string;
    status:     ApprovalStatus;
    workflowId: string;
}

/**
 * FreshApprovalAdmission Activity 发往 Core service API 的请求（.design/06 §4）：active HUMAN、fresh
 * 选择器 permission、owner 对账与职责分离由 Core 判定。
 */
export interface FreshApprovalAdmissionRequest {
    approvalWorkflowId:  string;
    approverPrincipalId: string;
    decision:            ApprovalDecision;
}

/**
 * FreshApprovalAdmission 的结论。admitted=false 时 reason 必有；该结论作为一条被拒决定进入 history，而不是
 * pre-history 拒绝。
 */
export interface FreshApprovalAdmissionResult {
    admitted:           boolean;
    reason?:            ReasonCode;
    satisfiedSelectors: ApprovalSelector[];
}
