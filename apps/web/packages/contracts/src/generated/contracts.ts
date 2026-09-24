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
 * 稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
 * 字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
 */
export enum ReasonCode {
    ClientKeyAlreadyBound = "CLIENT_KEY_ALREADY_BOUND",
    ClientKeyLimitReached = "CLIENT_KEY_LIMIT_REACHED",
    ClientKeyNotFound = "CLIENT_KEY_NOT_FOUND",
    ClientKeyProofInvalid = "CLIENT_KEY_PROOF_INVALID",
    DependencyUnavailable = "DEPENDENCY_UNAVAILABLE",
    IdentityHeaderMissing = "IDENTITY_HEADER_MISSING",
    IdentityUnknown = "IDENTITY_UNKNOWN",
    NativeSurfaceRequired = "NATIVE_SURFACE_REQUIRED",
    PublishRejected = "PUBLISH_REJECTED",
    PublishResultUnknown = "PUBLISH_RESULT_UNKNOWN",
    SessionNotActive = "SESSION_NOT_ACTIVE",
    SurfaceCapabilityUnavailable = "SURFACE_CAPABILITY_UNAVAILABLE",
    TenantMembershipNotActive = "TENANT_MEMBERSHIP_NOT_ACTIVE",
    TenantSelectionNotAvailable = "TENANT_SELECTION_NOT_AVAILABLE",
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
