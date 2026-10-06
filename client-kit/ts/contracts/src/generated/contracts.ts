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
    kind:         VariantKind;
    messageBody?: string;
    taskAttempt?: number;
}

export enum VariantKind {
    File = "FILE",
    Message = "MESSAGE",
    Task = "TASK",
}

export interface ApplicationModelAdmission {
    bindingId:          string;
    gatewayPrincipalId: string;
    generation:         number;
    method:             string;
    path:               string;
    traceparent:        string;
}

/**
 * 07§5/6.2：validate_binding 的非正文观察。精确原生scope/实例、隔离与配置引用摘要，不是用户声明的通过布尔值。
 */
export interface AdapterBindingObservation {
    artifactDigest:    string;
    bindingId:         string;
    configDigest:      string;
    executionMappings: AdapterExecutionMapping[];
    isolationMode:     ApplicationIsolationMode;
    nativeInstanceRef: string;
    nativeScopeRef:    string;
    secretReads:       AdapterSecretRead[];
    secretRefDigest:   string;
    tenantId:          string;
    workspaceId?:      string;
}

export interface AdapterExecutionMapping {
    actionKey:        string;
    actionVersion:    number;
    cancelCapability: NativeCancelCapability;
    nativeType:       string;
}

export enum NativeCancelCapability {
    Supported = "SUPPORTED",
    Unsupported = "UNSUPPORTED",
}

export enum ApplicationIsolationMode {
    DedicatedInstance = "DEDICATED_INSTANCE",
    Namespace = "NAMESPACE",
    NativeTenant = "NATIVE_TENANT",
    ResourceFilter = "RESOURCE_FILTER",
    ResourceInstance = "RESOURCE_INSTANCE",
}

export interface AdapterSecretRead {
    audience:  string;
    requestId: string;
    secretKey: string;
    version:   number;
}

/**
 * ADR-12 execute/observe/cancel/reconcile 的原生观察。字段取自 design03 ExternalExecution；nativeId
 * 允许未取得，值域与具体操作的终态证据由接收者验证。取消接收仍为 RUNNING/UNKNOWN，不伪装 CANCELLED。
 */
export interface AdapterExecutionObservation {
    cancelCapability: NativeCancelCapability;
    idempotencyKey:   string;
    lastObservedAt?:  string;
    nativeId?:        string;
    nativeStatus?:    string;
    nativeType:       string;
    platformStatus:   ExternalExecutionStatus;
    terminalAt?:      string;
}

/**
 * design03§6 ExternalExecution 的既定平台状态；HTTP成功和cancel accepted均不构成终态。
 */
export enum ExternalExecutionStatus {
    Cancelled = "CANCELLED",
    Failed = "FAILED",
    PendingDispatch = "PENDING_DISPATCH",
    Running = "RUNNING",
    Succeeded = "SUCCEEDED",
    Unknown = "UNKNOWN",
}

/**
 * 原 ExternalExecution 的 observe/extract_usage 引用；不携带正文，不新建执行，不接受引用自报 scope。nativeId
 * 未取得时只用冻结幂等键查证。
 */
export interface AdapterExecutionReference {
    externalExecutionId: string;
    idempotencyKey:      string;
    nativeId?:           string;
    nativeType:          string;
}

/**
 * ADR-12 执行响应分离原生任务观察与能力结果。HTTP 接收不是终态；resultJson 只在原生 SUCCEEDED 且符合固定结果 schema 时消费。它不进入
 * Core 的套件报告。
 */
export interface AdapterExecutionResponse {
    contentReference?: ContentReferenceClass;
    execution:         ExecutionClass;
    resultJson?:       string;
}

/**
 * design03 的唯一内容引用线格式；不是业务正文。Adapter typed 槽是传递引用的唯一来源，resultJson 不用于识别或重建引用。
 */
export interface ContentReferenceClass {
    assetId?:        string;
    displayName:     string;
    mediaType:       string;
    nativeObjectRef: string;
    nativeRevision:  string;
    resourceId:      string;
}

/**
 * ADR-12 execute/observe/cancel/reconcile 的原生观察。字段取自 design03 ExternalExecution；nativeId
 * 允许未取得，值域与具体操作的终态证据由接收者验证。取消接收仍为 RUNNING/UNKNOWN，不伪装 CANCELLED。
 */
export interface ExecutionClass {
    cancelCapability: NativeCancelCapability;
    idempotencyKey:   string;
    lastObservedAt?:  string;
    nativeId?:        string;
    nativeStatus?:    string;
    nativeType:       string;
    platformStatus:   ExternalExecutionStatus;
    terminalAt?:      string;
}

/**
 * DD-48/51/94 extract_usage 的原生终态用量元数据；scope/customer/dimensions 只由 Core 原
 * ExternalExecution 决定。完整集合与冻结 action meters 精确相等，缺失不是零。
 */
export interface AdapterExecutionUsage {
    externalExecutionId: string;
    idempotencyKey:      string;
    measurements:        Measurement[];
    nativeId:            string;
    nativeType:          string;
}

export interface Measurement {
    meterKey:   string;
    occurredAt: string;
    quantity:   number;
}

/**
 * ADR-12
 * adapter入站fresh校验。ActionToken只瞬时校验、不入history或审计正文；参数由原ActionToken摘要绑定，binding由受认证client精确匹配。
 */
export interface AdapterPepCheckRequest {
    actionToken:       string;
    argumentsJson:     string;
    bindingId:         string;
    contentReference?: ContentReferenceClass;
    operation:         string;
}

/**
 * 只在原动作和精确binding仍被fresh授权时返回当前授权revision；不是可复用的新授权票据。
 */
export interface AdapterPepCheckResponse {
    actionExecutionId:        string;
    authorizationMinZedToken: string;
    operationId:              string;
}

/**
 * DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
 * VersionId，不提供文件字节或当前权限。
 */
export interface ProtocolRevisionQuery {
    baseRevision:      string;
    protocolSessionId: string;
    writeObservation:  WriteObservationClass;
}

/**
 * 18 §5.4: authenticated native PutFile evidence for the existing ProtocolSession; never
 * file bytes or an authorization grant.
 */
export interface WriteObservationClass {
    baseModifiedAt:  Date;
    bytesWritten:    number;
    correlationRef:  string;
    editors:         string;
    nativeEtag?:     string;
    phase:           Phase;
    resultRevision?: string;
}

export enum Phase {
    Accepted = "ACCEPTED",
    Conflict = "CONFLICT",
    Failed = "FAILED",
    Started = "STARTED",
    Unknown = "UNKNOWN",
}

/**
 * 18: execute the original admitted file protocol Session, not an arbitrary editor URL or
 * native object create. All fields are frozen Core facts and the whole body is covered by
 * ActionToken.
 */
export interface AdapterProtocolSessionLaunchRequest {
    admittedMode:                 TedMode;
    authorizationTargetNativeRef: string;
    expiresAt:                    string;
    idempotencyKey:               string;
    locale:                       Locale;
    protocolSessionId:            string;
    reference:                    ContentReferenceClass;
    theme:                        Theme;
}

export enum TedMode {
    Edit = "EDIT",
    View = "VIEW",
}

export enum Locale {
    En = "en",
    ZhCN = "zh-CN",
}

export enum Theme {
    Dark = "DARK",
    Light = "LIGHT",
}

/**
 * 18: the original native PAT reference plus transient launch descriptor. This value occurs
 * only in the original execute response; it must not be stored as reconciliation evidence
 * or recovered by reminting a token.
 */
export interface AdapterProtocolSessionLaunchResponse {
    launchDescriptor: LaunchDescriptorClass;
    nativeSessionRef: string;
}

/**
 * DD-95/103: transient, fixed-origin launch returned by the admitted binding adapter;
 * credentials are only string form fields, never a persisted Task, chat or ContentReference.
 */
export interface LaunchDescriptorClass {
    actionUrl:    string;
    editorOrigin: string;
    expiresAt:    string;
    formFields:   { [key: string]: string };
    method:       Method;
}

export enum Method {
    Get = "GET",
    Post = "POST",
}

/**
 * DD-90, 18 §5.1: binding-authenticated permission to observe/revoke the original document
 * PAT. These closed lifecycle facts never authorize file reads, writes or token creation.
 */
export interface ProtocolSessionLifecyclePepResponse {
    decision:          Decision;
    expiresAt:         Date;
    nativeObjectRef:   string;
    protocolSessionId: string;
    requestedMode:     TedMode;
}

export enum Decision {
    Allow = "ALLOW",
}

/**
 * 18 §5.1: observe/cancel the same native document PAT only. No access token, launch
 * descriptor or file bytes.
 */
export interface AdapterProtocolSessionLifecycleRequest {
    idempotencyKey:    string;
    nativeObjectRef:   string;
    protocolSessionId: string;
}

/**
 * Original Cells PAT metadata only. ABSENT is a successful native lookup; errors must
 * remain unavailable, never ABSENT.
 */
export interface AdapterProtocolSessionLifecycleResponse {
    expiresAt?:        Date;
    nativeObjectRef:   string;
    nativeSessionRef?: string;
    nativeState:       NativeState;
    protocolSessionId: string;
}

export enum NativeState {
    Absent = "ABSENT",
    Active = "ACTIVE",
    Expired = "EXPIRED",
}

/**
 * 18 §5.2: authenticated binding→Core PEP for an existing ProtocolSession. No native token
 * grants platform permissions.
 */
export interface ProtocolSessionPepRequest {
    bindingId:         string;
    nativeObjectRef:   string;
    nativeOperation:   NativeOperation;
    protocolSessionId: string;
    writeObservation?: WriteObservationClass;
}

export enum NativeOperation {
    Observe = "OBSERVE",
    Open = "OPEN",
    Read = "READ",
    TokenObserve = "TOKEN_OBSERVE",
    TokenRevoke = "TOKEN_REVOKE",
    Write = "WRITE",
}

/**
 * Original Session facts, not native revision existence or write success. Cells must still
 * query its exact VersionId and ACLs.
 */
export interface ProtocolSessionPepResponse {
    admittedMode:  TedMode;
    baseRevision:  string;
    decision:      Decision;
    displayName:   string;
    expiresAt:     Date;
    exportAllowed: boolean;
    minZedToken:   string;
    /**
     * Confirmed original native token/session reference. Required by native READ/WRITE
     * consumers, absent before the first native OPEN creation.
     */
    nativeSessionRef?: string;
    /**
     * Original active issuer from the HUMAN's frozen ExternalIdentity, never a browser-supplied
     * claim.
     */
    oidcIssuer: string;
    /**
     * Original active subject paired with oidcIssuer. Cells resolves its existing explicit
     * native user link; no email or display-name fallback.
     */
    oidcSubject:     string;
    platformHumanId: string;
    /**
     * Exact canonical platform PUBLIC_ORIGIN from the Core deployment, never the native request
     * Origin or a browser-supplied field. Required by the native FileInfo consumer; unavailable
     * origin refuses its editor projection.
     */
    postMessageOrigin?: string;
}

/**
 * 18 §5.4: authenticated native PutFile evidence for the existing ProtocolSession; never
 * file bytes or an authorization grant.
 */
export interface ProtocolWriteObservation {
    baseModifiedAt:  Date;
    bytesWritten:    number;
    correlationRef:  string;
    editors:         string;
    nativeEtag?:     string;
    phase:           Phase;
    resultRevision?: string;
}

/**
 * Receipt of native write evidence. It grants no read or write permission.
 */
export interface ProtocolWriteReceipt {
    protocolSessionId: string;
    state:             ProtocolWriteReceiptState;
}

export enum ProtocolWriteReceiptState {
    Conflict = "CONFLICT",
    Dirty = "DIRTY",
    Failed = "FAILED",
    Saved = "SAVED",
    Unknown = "UNKNOWN",
}

/**
 *
 * 07§5.2与ADR-12：查询同一native对象当前权威revision；ActionToken通过Authorization头传输，幂等键与Idempotency-Key头一致。authorizationTargetNativeRef仅为Core从实际受权Resource/Asset解析的原生目标定位，参与同一参数签名；adapter须核实被查对象在该目标及固定binding
 * scope内。缺省保持确切目标查询，不授予一般子对象读取。不是execute或权限授予。
 */
export interface AdapterQueryRevisionRequest {
    authorizationTargetNativeRef?: string;
    idempotencyKey:                string;
    nativeObjectRef:               string;
    protocolReconcile?:            ProtocolReconcileClass;
}

/**
 * DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
 * VersionId，不提供文件字节或当前权限。
 */
export interface ProtocolReconcileClass {
    baseRevision:      string;
    protocolSessionId: string;
    writeObservation:  WriteObservationClass;
}

/**
 *
 * 07§5.2与18§5：只返回被查证同一native对象当前权威revision，不替换调用方冻结ContentReference、不以mtime/ETag猜测revision。未知或fresh授权失败不得生成成功应答。
 */
export interface AdapterQueryRevisionResponse {
    correlationRef?:    string;
    nativeObjectRef:    string;
    nativeRevision:     string;
    protocolSessionId?: string;
}

/**
 * DD-98：按同一 platform Resource ref CREATE/LOOKUP；FOUND 保留上游实际引用，不由套件预测或生成 native ID。
 */
export interface AdapterScopeObservation {
    nativeRef?:          string;
    nativeType?:         string;
    platformResourceRef: string;
    result:              NativeScopeResult;
}

export enum NativeScopeResult {
    AbsentFenced = "ABSENT_FENCED",
    Found = "FOUND",
    Refused = "REFUSED",
}

/**
 * POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
 * actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
 */
export interface ActionCommand {
    actionKey: string;
    /**
     * 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
     */
    agentVersionContent?:       AgentVersionContentClass;
    applicationBindingCreate?:  ApplicationBindingCreateClass;
    applicationBindingId?:      string;
    applicationBindingVersion?: number;
    /**
     * AgentVersion 管理动作的目标 Asset；Core 核对父 Resource、Tenant、owner、版本与投影。
     */
    assetId?: string;
    /**
     * 调用方实际读取的 Asset 版本；旧版本不能改写新的草稿或发布事实。
     */
    assetVersion?: number;
    /**
     * 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
     */
    automationVersionContent?: AutomationVersionContentClass;
    /**
     * 仅 capability_contract.approve/deprecate：固定已登记版本。
     */
    capabilityContractRef?: CapabilityContractRefClass;
    /**
     * 仅 capability_contract.register：真实 schema 与测试向量内容。
     */
    capabilityContractRegistration?: CapabilityContractRegistrationClass;
    componentAction?:                ComponentActionClass;
    /**
     * 仅组件批准：已登记的不可变ComponentRelease标识。
     */
    componentReleaseId?:           string;
    componentReleaseRegistration?: ComponentReleaseRegistrationClass;
    conversationOpen?:             ConversationOpenClass;
    /**
     * 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
     */
    delegationGrant?: DelegationGrantClass;
    /**
     * 显式 Delegation 管理的稳定 Grant ID；授予者提供新 ID，撤销引用实际已有 ID。
     */
    delegationId?: string;
    /**
     * 仅 revoke：调用方实际读取的 Grant 版本。
     */
    delegationVersion?: number;
    /**
     * 仅 automation.create：同一 Workspace 的确切 AgentInstallation Resource，不从名称或当前默认配置推断。
     */
    executorInstallationResourceId?: string;
    /**
     * EXPLICIT 动作或 HUMAN owner 的一次手动 automation.run，由用户在当前目标详情上确认后设为 true；其他动作不得携带。手动运行只提交
     * resourceId/resourceVersion/workspaceId 与同一幂等键，不选择 Grant、Agent、来源或结果位置。
     */
    explicitConfirmation?: boolean;
    /**
     * 调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
     */
    idempotencyKey: string;
    /**
     * tenant.member.invite.revoke 的目标邀请
     */
    invitationId?: string;
    /**
     * 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
     */
    llmRouteCreate?: LlmRouteCreateClass;
    /**
     * 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
     * 输入；其他命令禁止携带。
     */
    memoryWrite?: MemoryWriteClass;
    /**
     * workspace.create 或 AgentDefinition 创建/更新的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
     */
    name?: string;
    /**
     * 任务控制只接收原 ActionExecution ID；原 Workflow、target 与 scope 由 Core 解析
     */
    originalActionExecutionId?: string;
    /**
     * 成员动作的目标 Principal；resource.transfer_owner 的新 owner
     */
    principalId?: string;
    /**
     * Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
     * identity; no Agent or caller-selected native credentials.
     */
    protocolSessionOpen?: ProtocolSessionOpenClass;
    resourceCreate?:      ResourceCreateClass;
    /**
     * Resource 管理动作的目标；Core 重新核对同 Tenant、scope、owner 和投影
     */
    resourceId?: string;
    /**
     * 调用方实际读取的 Resource 版本；与当前事实不同即 CONFLICT
     */
    resourceVersion?: number;
    /**
     * workspace.create 或 agent.definition.create 的稳定 slug
     */
    slug?: string;
    /**
     * 仅 agent.invoke 人工分派：本人在该 Workspace Channel 已持久发布的消息 ID；Core 回读验签并与普通 mention 共用源事件幂等。
     */
    sourceEventId?: string;
    /**
     * tenant.suspend / tenant.restore 的目标业务 Tenant；执行 Tenant 仍是会话 Tenant（Platform Catalog）
     */
    tenantId?:         string;
    workspaceChannel?: WorkspaceChannelClass;
    /**
     * Workspace 内动作的执行 Workspace
     */
    workspaceId?: string;
    /**
     * 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
     */
    workspaceVisibility?: WorkspaceVisibility;
}

/**
 * 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
 *
 * 03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
 * environment。发布不等于安装或运行授权。
 */
export interface AgentVersionContentClass {
    /**
     * 精确 contract_key@version，不引用业务能力实现名。
     */
    capabilityRequirements:  string[];
    declaredToolResourceIds: string[];
    instructions:            string;
    memoryPolicy:            AgentVersionContentMemoryPolicy;
    modelRouteResourceId:    string;
    parallelism:             number;
    personaIdentity:         AgentVersionContentPersonaIdentity;
    /**
     * RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。
     */
    replyPolicy:          string;
    runtimeProfileKey:    string;
    skillVersionAssetIds: string[];
    triggerDefaults:      AgentTrigger[];
    turnLimits:           AgentVersionContentTurnLimits;
}

export interface AgentVersionContentMemoryPolicy {
    coldWrite: AgentMemoryColdWrite;
    coreWrite: AgentMemoryCoreWrite;
}

export enum AgentMemoryColdWrite {
    Disabled = "DISABLED",
    InvocationScoped = "INVOCATION_SCOPED",
}

export enum AgentMemoryCoreWrite {
    AgentWithApproval = "AGENT_WITH_APPROVAL",
    HumanOnly = "HUMAN_ONLY",
}

export interface AgentVersionContentPersonaIdentity {
    avatarUrl?:   string;
    description?: string;
    displayName:  string;
}

export enum AgentTrigger {
    ManualAssignment = "MANUAL_ASSIGNMENT",
    Mention = "MENTION",
}

export interface AgentVersionContentTurnLimits {
    idleTimeoutSeconds:     number;
    maxTurnDurationSeconds: number;
}

/**
 * DD-88/94：pin 已批准 release 的业务绑定选择。只携带 SecretRef，不接受密钥正文或运行端点 URL。Workspace 取原
 * ActionCommand。
 */
export interface ApplicationBindingCreateClass {
    adapterServiceRef:    string;
    bindingId:            string;
    callIdentityMode:     ApplicationCallIdentityMode;
    capabilityCategories: ApplicationBindingCreateCapabilityCategory[];
    componentReleaseId:   string;
    isolationMode:        ApplicationIsolationMode;
    modelCallMode:        ApplicationModelCallMode;
    nativeInstanceRef:    string;
    nativeScopeRef?:      string;
    normalizedConfigJson: string;
    retainOnTenantDelete: boolean;
    secretRefs:           ApplicationBindingCreateSecretRef[];
    servicePrincipalId:   string;
}

export enum ApplicationCallIdentityMode {
    EndUserToken = "END_USER_TOKEN",
    InstanceService = "INSTANCE_SERVICE",
    TenantService = "TENANT_SERVICE",
}

export interface ApplicationBindingCreateCapabilityCategory {
    category: string;
    version:  number;
}

export enum ApplicationModelCallMode {
    None = "NONE",
    PlatformLlmRoute = "PLATFORM_LLM_ROUTE",
    SelfManagedModel = "SELF_MANAGED_MODEL",
}

export interface ApplicationBindingCreateSecretRef {
    audience:  string;
    locator:   string;
    secretKey: string;
    version:   number;
}

/**
 * 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
 *
 * REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval，不含消息正文、provider 配置或凭据。
 */
export interface AutomationVersionContentClass {
    action:          AutomationVersionContentAction;
    approvalPolicy?: ApprovalPolicyElement;
    resultTarget:    AutomationResultTarget;
    trigger:         AutomationVersionContentTrigger;
}

export interface AutomationVersionContentAction {
    kind:     ActionKind;
    template: string;
}

export enum ActionKind {
    AgentTurn = "AGENT_TURN",
    PostMessage = "POST_MESSAGE",
}

/**
 * DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
 */
export interface ApprovalPolicyElement {
    id:      string;
    version: number;
}

export enum AutomationResultTarget {
    Channel = "CHANNEL",
    TriggerThread = "TRIGGER_THREAD",
}

export interface AutomationVersionContentTrigger {
    kind:                AutomationTriggerKind;
    mentionPrincipalId?: string;
    scheduleSpec?:       ScheduleSpecClass;
    textPrefix?:         string;
}

export enum AutomationTriggerKind {
    ChannelMessage = "CHANNEL_MESSAGE",
    Mention = "MENTION",
    Schedule = "SCHEDULE",
}

/**
 * Temporal IntervalSpec 的显式秒数；offset 小于 every，catchupWindow 不小于原生的 10 秒。Overlap 固定
 * SKIP，不另实现 cron。
 */
export interface ScheduleSpecClass {
    catchupWindowSeconds: number;
    everySeconds:         number;
    offsetSeconds:        number;
}

/**
 * 仅 capability_contract.approve/deprecate：固定已登记版本。
 *
 * 固定 Catalog 自然键，不授予业务能力 consume 权限。
 */
export interface CapabilityContractRefClass {
    categoryKey:     string;
    contractVersion: number;
}

/**
 * 仅 capability_contract.register：真实 schema 与测试向量内容。
 *
 * DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
 */
export interface CapabilityContractRegistrationClass {
    categoryKey:               string;
    contentReferenceSemantics: CapabilityContractRegistrationContentReferenceSemantics;
    contractVersion:           number;
    operationContracts:        CapabilityContractRegistrationOperationContract[];
    protocolSessionKinds:      string[];
    requiredDeclarations:      CapabilityRequiredDeclaration[];
    resourceTypeFamily:        CapabilityContractRegistrationResourceTypeFamily[];
    schemaDocuments:           string[];
    /**
     * CapabilityConformanceVectors 的 JSON 编码，formatVersion 固定格式；任意自然语言对象数组不构成可执行向量。Core
     * 校验所有步骤参数/结果符合契约 schema，覆盖所有 operationContracts，然后固定 canonical digest。
     */
    testVectorsJson: string;
}

export interface CapabilityContractRegistrationContentReferenceSemantics {
    authorizationTargetRule: string;
    nativeObjectRefRule:     string;
    nativeRevisionRule:      string;
}

export interface CapabilityContractRegistrationOperationContract {
    contractKey:        string;
    inputSchemaDigest:  string;
    outputSchemaDigest: string;
    permission:         CapabilityPermission;
    surface:            CapabilitySurface;
    targetType:         string;
}

export enum CapabilityPermission {
    Approve = "approve",
    Audit = "audit",
    Consume = "consume",
    Create = "create",
    Delegate = "delegate",
    Delete = "delete",
    Discover = "discover",
    Execute = "execute",
    Export = "export",
    Manage = "manage",
    Read = "read",
    Share = "share",
    TransferOwner = "transfer_owner",
    Update = "update",
}

export enum CapabilitySurface {
    Action = "ACTION",
    Tool = "TOOL",
}

export enum CapabilityRequiredDeclaration {
    Cancel = "CANCEL",
    Meter = "METER",
    Observe = "OBSERVE",
    OnlineEditing = "ONLINE_EDITING",
    ReadEdge = "READ_EDGE",
    RevisionQuery = "REVISION_QUERY",
    TenantDelete = "TENANT_DELETE",
    VersionedModel = "VERSIONED_MODEL",
}

export interface CapabilityContractRegistrationResourceTypeFamily {
    kind:    string;
    typeKey: string;
}

/**
 * Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。参数是组件原生持久内容引用，不把 SQL、提示或结果正文写入
 * Core/Temporal。
 */
export interface ComponentActionClass {
    actionVersion:               number;
    inputReference:              ContentReferenceClass;
    resultExposurePolicyId:      string;
    resultExposurePolicyVersion: number;
}

/**
 * 组件登记只提交实际 manifest、包清单与 binding config schema；不接收 suite 通过声明、报告或候选执行地址。Core 解析并冻结内容，原
 * Worker 独立执行隔离套件。
 */
export interface ComponentReleaseRegistrationClass {
    bindingConfigSchemaJson: string;
    manifestJson:            string;
    packageJson:             string;
}

/**
 * 原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
 */
export interface ConversationOpenClass {
    participantPrincipalIds: string[];
}

/**
 * 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
 */
export interface DelegationGrantClass {
    expiresAt: Date;
    maxUses?:  number;
    scopes:    ScopeElement[];
    validFrom: Date;
}

/**
 * 03 §6 的确切 Action/target/exposure 限制；管理发现与原 Grant 写入共用，发现不授予 permission。
 */
export interface ScopeElement {
    actionKey:          string;
    actionVersion:      number;
    createWorkspaceId?: string;
    outputSchemaHash:   string;
    redactionPolicy:    string;
    resultExposureMode: ResultExposureMode;
    targetId?:          string;
    targetType:         string;
    toolResourceId?:    string;
}

export enum ResultExposureMode {
    ConsumeOnly = "CONSUME_ONLY",
    Export = "EXPORT",
    Read = "READ",
}

/**
 * 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
 *
 * 受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
 * 仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
 */
export interface LlmRouteCreateClass {
    model:                  Model;
    provider:               Model;
    providerCredentialMode: LlmProviderCredentialMode;
    providerSecretRef?:     LlmRouteCreateProviderSecretRef;
}

export interface Model {
    id:       string;
    revision: number;
    sha256:   string;
}

/**
 * 提供方认证的显式封闭选择；NONE 不豁免 Gateway 调用者认证或业务授权。
 */
export enum LlmProviderCredentialMode {
    None = "NONE",
    SecretRef = "SECRET_REF",
}

export interface LlmRouteCreateProviderSecretRef {
    audience: string;
    locator:  string;
    version:  number;
}

/**
 * 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
 * 输入；其他命令禁止携带。
 *
 * HUMAN Memory Action 本次瞬态输入；正文仅用于原生 NIP-AE 构造，不进入 ActionExecution、审计、outbox 或 history。
 */
export interface MemoryWriteClass {
    /**
     * entry.patch 当前原生 value 的 SHA-256。
     */
    baseHash?: string;
    /**
     * 调用方实际读取的 head；null 只表示原生确认不存在。
     */
    expectedHeadEventId?: null | string;
    /**
     * 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
     */
    expectedHeadState: ExpectedHeadState;
    /**
     * entry.patch 的原生严格 unified diff，不支持 fuzz、offset 或多文件。
     */
    patch?: string;
    slug:   string;
    /**
     * core.replace 的 profile 或 entry.set 的 value；完整序列化 JSON body 必须满足原生 NIP-44 上界。
     */
    value?: string;
}

/**
 * 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
 */
export enum ExpectedHeadState {
    Absent = "ABSENT",
    Found = "FOUND",
}

/**
 * Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
 * identity; no Agent or caller-selected native credentials.
 *
 * 03/07/18: the original HUMAN file protocol action, not an arbitrary editor or native URL.
 * Revision and presentation are frozen once; session expiry comes from controlled Core
 * delivery.
 */
export interface ProtocolSessionOpenClass {
    actionVersion: number;
    /**
     * The selected native source binding; must equal the target's real binding, not an
     * authorization claim.
     */
    applicationBindingId: string;
    locale:               Locale;
    /**
     * Exact approved projection selected by the native menu; never latest.
     */
    projectionGeneration: number;
    reference:            ContentReferenceClass;
    theme:                Theme;
}

export interface ResourceCreateClass {
    evidenceDigest: string;
    evidenceRef:    string;
    nativeRef:      string;
    nativeType:     string;
    typeKey:        string;
}

/**
 * workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
 */
export interface WorkspaceChannelClass {
    channelType:  ChannelType;
    description?: string;
    /**
     * 原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
     */
    ttlSeconds?: number;
}

export enum ChannelType {
    Forum = "forum",
    Stream = "stream",
}

/**
 * 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
 *
 * DD-80 的产品可见性：open 仅指同 Tenant 成员可发现并经 Core 加入；Relay 投影始终 private。
 *
 * Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
 */
export enum WorkspaceVisibility {
    Open = "open",
    Private = "private",
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
    documentLaunch?:     LaunchDescriptorClass;
    gateState:           ActionGateState;
    invitation?:         InvitationClass;
    operationId:         string;
    protocolSessionId?:  string;
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
    BindingNotActive = "BINDING_NOT_ACTIVE",
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
    PayloadTooLarge = "PAYLOAD_TOO_LARGE",
    PermissionDenied = "PERMISSION_DENIED",
    ProjectionDelayed = "PROJECTION_DELAYED",
    PublishRejected = "PUBLISH_REJECTED",
    PublishResultUnknown = "PUBLISH_RESULT_UNKNOWN",
    QuotaExhausted = "QUOTA_EXHAUSTED",
    RateLimited = "RATE_LIMITED",
    ScopeGuardFailed = "SCOPE_GUARD_FAILED",
    SelfApprovalDenied = "SELF_APPROVAL_DENIED",
    SessionNotActive = "SESSION_NOT_ACTIVE",
    SurfaceCapabilityUnavailable = "SURFACE_CAPABILITY_UNAVAILABLE",
    TargetNotFound = "TARGET_NOT_FOUND",
    TargetStateConflict = "TARGET_STATE_CONFLICT",
    TenantMembershipNotActive = "TENANT_MEMBERSHIP_NOT_ACTIVE",
    TenantNotActive = "TENANT_NOT_ACTIVE",
    TenantSelectionNotAvailable = "TENANT_SELECTION_NOT_AVAILABLE",
    WaitingApproval = "WAITING_APPROVAL",
}

/**
 * 同 Tenant 且当前 discover 权限允许的 AgentDefinition 页；nextOffset 续读同一排序，不代表总量上限。
 */
export interface AgentDefinitionPage {
    definitions: DefinitionElement[];
    nextOffset?: number;
}

/**
 * DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
 */
export interface DefinitionElement {
    currentPublishedVersionAssetId?: string;
    displayName:                     string;
    ownerPrincipalId:                string;
    resourceId:                      string;
    resourceState:                   ResourceState;
    resourceVersion:                 number;
    stableSlug:                      string;
    status:                          string;
}

/**
 * 03 §7 Resource 的正式状态，投影未闭合不得呈现 ACTIVE。
 */
export enum ResourceState {
    Active = "ACTIVE",
    Deleted = "DELETED",
    Deleting = "DELETING",
    Failed = "FAILED",
    Provisioning = "PROVISIONING",
    RetainedReadOnly = "RETAINED_READ_ONLY",
    Unknown = "UNKNOWN",
}

/**
 * DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
 */
export interface AgentDefinitionView {
    currentPublishedVersionAssetId?: string;
    displayName:                     string;
    ownerPrincipalId:                string;
    resourceId:                      string;
    resourceState:                   ResourceState;
    resourceVersion:                 number;
    stableSlug:                      string;
    status:                          string;
}

export interface AgentDelegationPage {
    canGrant:               boolean;
    canRevoke:              boolean;
    grants:                 GrantElement[];
    installationResourceId: string;
    nextOffset?:            number;
    resourceVersion:        number;
    workspaceId:            string;
}

/**
 * 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。
 */
export interface GrantElement {
    delegationId:       string;
    delegationVersion:  number;
    grantorPrincipalId: string;
    parameters:         DelegationGrantClass;
    state:              GrantState;
    uses:               number;
}

export enum GrantState {
    Active = "ACTIVE",
    Expired = "EXPIRED",
    Revoked = "REVOKED",
    Revoking = "REVOKING",
}

/**
 * 原 Grant 校验器当前允许的确切 Action/target/exposure；空页没有可授予对象，不伪造默认 Scope。
 */
export interface AgentDelegationTargetPage {
    installationResourceId: string;
    nextOffset?:            number;
    resourceVersion:        number;
    scopes:                 ScopeElement[];
    workspaceId:            string;
}

/**
 * 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。
 */
export interface AgentDelegationView {
    delegationId:       string;
    delegationVersion:  number;
    grantorPrincipalId: string;
    parameters:         DelegationGrantClass;
    state:              GrantState;
    uses:               number;
}

/**
 * 实际 ACTIVE Definition/PUBLISHED Asset 的安装来源与版本；不表示新 Installation 或 runtime 已 ACTIVE。
 */
export interface AgentInstallationCandidate {
    agentResourceId:     string;
    agentVersionAssetId: string;
    assetVersion:        number;
    displayName:         string;
    ordinal:             number;
    resourceVersion:     number;
}

export interface AgentInstallationCandidatePage {
    /**
     * 原 Installation create exposure、目录与 fresh Workspace create；每个候选还须 consume/投影查证，提交时全部重验。
     */
    canCreate:   boolean;
    candidates:  CandidateElement[];
    nextOffset?: number;
    workspaceId: string;
}

/**
 * 实际 ACTIVE Definition/PUBLISHED Asset 的安装来源与版本；不表示新 Installation 或 runtime 已 ACTIVE。
 */
export interface CandidateElement {
    agentResourceId:     string;
    agentVersionAssetId: string;
    assetVersion:        number;
    displayName:         string;
    ordinal:             number;
    resourceVersion:     number;
}

/**
 * 按既有部署登记页长扫描同一 Workspace，再以 fresh Installation Resource read 过滤；空页不代表整个 Workspace 无安装。
 */
export interface AgentInstallationPage {
    installations: InstallationElement[];
    nextOffset?:   number;
}

/**
 * 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
 * 正文、执行或管理权限。
 */
export interface InstallationElement {
    activeProjectionGeneration?: number;
    agentPrincipalId:            string;
    agentPrincipalState:         AgentPrincipalState;
    agentResourceId:             string;
    /**
     * 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
     * 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
     * 准入。缺失或空集合不支持 Schedule。
     */
    automationResultTargets?: AutomationResultTarget[];
    channelBinding?:          InstallationChannelBinding;
    executionPermission?:     InstallationExecutionPermission;
    ownerPrincipalId:         string;
    pinnedVersionAssetId:     string;
    projection?:              ProjectionClass;
    readPermission?:          InstallationReadPermission;
    resourceId:               string;
    resourceState:            ResourceState;
    resourceVersion:          number;
    state:                    AgentInstallationState;
    workspaceId:              string;
}

export enum AgentPrincipalState {
    Active = "ACTIVE",
    Disabled = "DISABLED",
}

export interface InstallationChannelBinding {
    channelId?: string;
    status:     ChannelBindingStatus;
    triggers:   AgentTrigger[];
}

export enum ChannelBindingStatus {
    Active = "ACTIVE",
    Disabled = "DISABLED",
    Error = "ERROR",
}

export interface InstallationExecutionPermission {
    canGrant:                  boolean;
    canRevoke:                 boolean;
    effective:                 boolean;
    pendingActionExecutionId?: string;
    requested:                 boolean;
}

/**
 * 17 §8 的持久运行投影摘要；不证明本机进程当前健康，不返回正文、凭据或隔离目录。
 */
export interface ProjectionClass {
    agentVersionAssetId: string;
    configHash:          string;
    generation:          number;
    runtimeProfileKey:   string;
    state:               AgentRuntimeProjectionState;
}

/**
 * 03 §7 的静态运行投影状态，不承载 Invocation 动态准入。
 */
export enum AgentRuntimeProjectionState {
    Active = "ACTIVE",
    Error = "ERROR",
    Pending = "PENDING",
    Revoked = "REVOKED",
}

export interface InstallationReadPermission {
    canGrant:                  boolean;
    canRevoke:                 boolean;
    effective:                 boolean;
    pendingActionExecutionId?: string;
    requested:                 boolean;
}

/**
 * 03 §7、17 §6 的 Installation 状态；ACTIVE 要求实际投影与运行查证闭合。
 */
export enum AgentInstallationState {
    Active = "ACTIVE",
    Disabled = "DISABLED",
    Draining = "DRAINING",
    Error = "ERROR",
    Provisioning = "PROVISIONING",
}

/**
 * 17 §8 的持久运行投影摘要；不证明本机进程当前健康，不返回正文、凭据或隔离目录。
 */
export interface AgentInstallationProjectionView {
    agentVersionAssetId: string;
    configHash:          string;
    generation:          number;
    runtimeProfileKey:   string;
    state:               AgentRuntimeProjectionState;
}

/**
 * 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
 * 正文、执行或管理权限。
 */
export interface AgentInstallationView {
    activeProjectionGeneration?: number;
    agentPrincipalId:            string;
    agentPrincipalState:         AgentPrincipalState;
    agentResourceId:             string;
    /**
     * 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
     * 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
     * 准入。缺失或空集合不支持 Schedule。
     */
    automationResultTargets?: AutomationResultTarget[];
    channelBinding?:          AgentInstallationViewChannelBinding;
    executionPermission?:     AgentInstallationViewExecutionPermission;
    ownerPrincipalId:         string;
    pinnedVersionAssetId:     string;
    projection?:              ProjectionClass;
    readPermission?:          AgentInstallationViewReadPermission;
    resourceId:               string;
    resourceState:            ResourceState;
    resourceVersion:          number;
    state:                    AgentInstallationState;
    workspaceId:              string;
}

export interface AgentInstallationViewChannelBinding {
    channelId?: string;
    status:     ChannelBindingStatus;
    triggers:   AgentTrigger[];
}

export interface AgentInstallationViewExecutionPermission {
    canGrant:                  boolean;
    canRevoke:                 boolean;
    effective:                 boolean;
    pendingActionExecutionId?: string;
    requested:                 boolean;
}

export interface AgentInstallationViewReadPermission {
    canGrant:                  boolean;
    canRevoke:                 boolean;
    effective:                 boolean;
    pendingActionExecutionId?: string;
    requested:                 boolean;
}

/**
 * 19 §5：复合游标走到原生末尾才 COMPLETE。BOUND_EXCEEDED/UNKNOWN 不是空库存；只是本次 best-effort head tuple
 * snapshot，不是严格存量权威。
 */
export interface AgentMemoryEntryPage {
    entries:                EntryElement[];
    installationResourceId: string;
    operationId:            string;
    state:                  AgentMemoryEntryPageState;
    workspaceId:            string;
}

/**
 * NIP-AE cold head tuple，不含 value；tombstone 是当前原生 head，不回退旧 value。
 */
export interface EntryElement {
    createdAt: number;
    eventId:   string;
    slug:      string;
    tombstone: boolean;
}

export enum AgentMemoryEntryPageState {
    BoundExceeded = "BOUND_EXCEEDED",
    Complete = "COMPLETE",
    Unknown = "UNKNOWN",
}

/**
 * NIP-AE cold head tuple，不含 value；tombstone 是当前原生 head，不回退旧 value。
 */
export interface AgentMemoryEntryView {
    createdAt: number;
    eventId:   string;
    slug:      string;
    tombstone: boolean;
}

/**
 * DD-66/68、19 §5：fresh HUMAN Installation read 后的原生 core/cold head。正文仅本次 no-store HTTP，不入
 * Core 数据库、审计或客户端持久存储。ABSENT 不等于 UNREADABLE；tombstone 可带原 head 引用。
 */
export interface AgentMemoryReadView {
    content?: string;
    /**
     * UTF-8 bytes of the returned content string, not the whole native NIP-44 JSON body or a
     * billing measurement.
     */
    contentBytes?:          number;
    createdAt?:             number;
    eventId?:               string;
    installationResourceId: string;
    operationId:            string;
    slug:                   string;
    state:                  AgentMemoryReadViewState;
    /**
     * FOUND only: native buzz mem hash of the exact UTF-8 value, used by strict patch baseHash;
     * not the JSON body or a stored plaintext copy.
     */
    valueHash?:  string;
    workspaceId: string;
}

export enum AgentMemoryReadViewState {
    Absent = "ABSENT",
    Found = "FOUND",
    Unreadable = "UNREADABLE",
}

/**
 * DD-24/25/26：Definition 范围的受权版本配置目录，消费平台发布 RuntimeProfile 合同与已治理 Route。缺真实来源时两目录为空且
 * canCreate=false；目录或 canCreate 不授予发布、安装和运行权限。
 */
export interface AgentVersionConfigurationPage {
    agentResourceId: string;
    canCreate:       boolean;
    nextOffset:      number | null;
    profiles:        RuntimeProfileDirectorySchema[];
    resourceVersion: number;
    routes:          RouteElement[];
}

export interface RuntimeProfileDirectorySchema {
    capabilityContract: PurpleCapabilityContract;
    key:                string;
    kind:               RuntimeProfileKind;
    status:             string;
    webAvailability:    string;
}

export interface PurpleCapabilityContract {
    capabilityRequirements: string[];
    maxIdleTimeoutSeconds:  number;
    maxParallelism:         number;
    maxTurnDurationSeconds: number;
    replyPolicies:          string[];
    /**
     * 同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
     */
    replyPolicyMappings?: PurpleRuntimeReplyPolicyMapping[];
}

export interface PurpleRuntimeReplyPolicyMapping {
    broadcastReplies: boolean;
    key:              string;
    threadReplies:    boolean;
}

export enum RuntimeProfileKind {
    LocalACP = "LOCAL_ACP",
    RemoteProvider = "REMOTE_PROVIDER",
    ServerCodex = "SERVER_CODEX",
}

/**
 * 03 §7、17 §3：同 Tenant、fresh read 与 Workspace scope 查证后的既有治理 Route 元数据。原生 revision/hash
 * 已回读；不包含 provider 配置、正文、凭据或模型 endpoint，不证明某次执行已获准。
 */
export interface RouteElement {
    homeWorkspaceId:        null | string;
    nativeConfigHash:       string;
    nativeConfigResourceId: string;
    nativeRevision:         number;
    ownerPrincipalId:       string;
    resourceId:             string;
    resourceVersion:        number;
}

/**
 * DD-24/25、17 §3/8：同 Definition 下逐项 fresh Asset read 后的版本目录；DRAFT 可发现，PUBLISHED/RETIRED
 * 不可编辑。nextOffset 属原始扫描窗口，空的受权页不证明全集为空。
 */
export interface AgentVersionPage {
    agentResourceId: string;
    nextOffset:      number | null;
    resourceVersion: number;
    versions:        VersionElement[];
}

export interface VersionElement {
    agentResourceId: string;
    assetId:         string;
    assetVersion:    number;
    /**
     * 当前 HUMAN 对此 exact DRAFT 的已登记 EXPLICIT publish 动作及 fresh Asset manage
     * 资格；缺字段不允许发布，不证明已安装或可运行。
     */
    canPublish?: boolean;
    /**
     * 当前 HUMAN 对此 exact PUBLISHED 的已登记 EXPLICIT retire 动作及 fresh Asset manage
     * 资格；缺字段不允许退役，退役只禁止新安装，保留既有安装与在途的固定版本。
     */
    canRetire?: boolean;
    /**
     * 当前 HUMAN 对此 exact DRAFT 的已登记 update 动作及 fresh Asset update 资格；缺字段不允许编辑，提交时仍重验。
     */
    canUpdate?:       boolean;
    configHash:       string;
    content:          AgentVersionContentClass;
    ordinal:          number;
    ownerPrincipalId: string;
    state:            AgentVersionState;
}

export enum AgentVersionState {
    Draft = "DRAFT",
    Published = "PUBLISHED",
    Retired = "RETIRED",
}

/**
 * 03 §7、17 §3：同 Tenant、fresh read 与 Workspace scope 查证后的既有治理 Route 元数据。原生 revision/hash
 * 已回读；不包含 provider 配置、正文、凭据或模型 endpoint，不证明某次执行已获准。
 */
export interface AgentVersionRouteOption {
    homeWorkspaceId:        null | string;
    nativeConfigHash:       string;
    nativeConfigResourceId: string;
    nativeRevision:         number;
    ownerPrincipalId:       string;
    resourceId:             string;
    resourceVersion:        number;
}

export interface AgentVersionView {
    agentResourceId: string;
    assetId:         string;
    assetVersion:    number;
    /**
     * 当前 HUMAN 对此 exact DRAFT 的已登记 EXPLICIT publish 动作及 fresh Asset manage
     * 资格；缺字段不允许发布，不证明已安装或可运行。
     */
    canPublish?: boolean;
    /**
     * 当前 HUMAN 对此 exact PUBLISHED 的已登记 EXPLICIT retire 动作及 fresh Asset manage
     * 资格；缺字段不允许退役，退役只禁止新安装，保留既有安装与在途的固定版本。
     */
    canRetire?: boolean;
    /**
     * 当前 HUMAN 对此 exact DRAFT 的已登记 update 动作及 fresh Asset update 资格；缺字段不允许编辑，提交时仍重验。
     */
    canUpdate?:       boolean;
    configHash:       string;
    content:          AgentVersionContentClass;
    ordinal:          number;
    ownerPrincipalId: string;
    state:            AgentVersionState;
}

/**
 * 当前HUMAN管理scope内的真实接入元数据。不是组件内部状态、配置、SecretRef或原生管理credential。
 */
export interface ApplicationBindingPage {
    bindings:    ApplicationBindingView[];
    canCreate:   boolean;
    nextOffset?: number;
}

export interface ApplicationBindingView {
    activeProjectionGeneration?: number;
    bindingId:                   string;
    canDisable:                  boolean;
    capabilityCategories:        ApplicationBindingCapability[];
    componentReleaseId:          string;
    componentTypeKey:            string;
    /**
     * Approved release declares an independent native page. Launch still freshly checks
     * binding, scope and deployment origins.
     */
    hasNativePage?: boolean;
    state:          ApplicationBindingState;
    tenantId:       string;
    version:        number;
    workspaceId?:   string;
}

export interface ApplicationBindingCapability {
    category: string;
    version:  number;
}

export enum ApplicationBindingState {
    Active = "ACTIVE",
    Disabled = "DISABLED",
    Disabling = "DISABLING",
    Error = "ERROR",
    Provisioning = "PROVISIONING",
    Upgrading = "UPGRADING",
}

/**
 * Authorized ACTIVE binding's independent native page. Exact origin is release and
 * deployment approved; no native credential or page body is returned.
 */
export interface ApplicationNativePage {
    allowedOrigins:       string[];
    bindingId:            string;
    origin:               string;
    projectionGeneration: number;
    url:                  string;
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
 * GET /api/v1/audit/events 的有界回应：当前 Tenant（或其中一个 Workspace）范围内的审计事件，调用方须对该范围持有 audit
 * permission，每次 fresh Check。证据只列种类，不含稳定 ID；稳定 ID 经单条解引用在同一授权下取得（.design/03 §14）。
 */
export interface AuditEventPage {
    events: AuditEventView[];
    /**
     * 下一页首项之前的事件 ID；缺省即已经读完
     */
    nextCursor?: string;
}

export interface AuditEventView {
    actionKey:             string;
    actorPrincipalId?:     string;
    decision:              string;
    eventType:             AuditEventType;
    evidence:              AuditEvidenceSlot[];
    id:                    string;
    initiatorPrincipalId?: string;
    /**
     * RFC3339
     */
    occurredAt:   string;
    resultCode:   string;
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

export interface AuditEvidenceSlot {
    authority?: EvidenceAuthority;
    /**
     * 证据在该事件中的位置，解引用时使用
     */
    index: number;
    /**
     * 存量种类不可识别时缺省
     */
    kind?:        EvidenceKind;
    sensitivity?: EvidenceSensitivity;
}

/**
 * EvidenceRef 所指证据的源码权威。
 */
export enum EvidenceAuthority {
    Agentgateway = "AGENTGATEWAY",
    Buzz = "BUZZ",
    Core = "CORE",
    Oidc = "OIDC",
    Openmeter = "OPENMETER",
    Spicedb = "SPICEDB",
    Temporal = "TEMPORAL",
}

/**
 * 存量种类不可识别时缺省
 *
 * AuditEvent 中 EvidenceRef 的封闭种类（.design/03 §14）。每种只承载其权威源中的稳定 ID（可带
 * version），权威源、证据类型与敏感级别由种类唯一确定（Core 的固定描述表）。库中存量出现不在此列的种类时解释为不可用，不猜测含义。
 */
export enum EvidenceKind {
    ActionExecutionID = "ACTION_EXECUTION_ID",
    AdmitActionExecutionID = "ADMIT_ACTION_EXECUTION_ID",
    AgentgatewayUsageID = "AGENTGATEWAY_USAGE_ID",
    ApprovalPolicy = "APPROVAL_POLICY",
    ApprovalWorkflowID = "APPROVAL_WORKFLOW_ID",
    BuzzDeletionInventoryDigest = "BUZZ_DELETION_INVENTORY_DIGEST",
    BuzzDeletionRequestID = "BUZZ_DELETION_REQUEST_ID",
    BuzzEventID = "BUZZ_EVENT_ID",
    BuzzPubkey = "BUZZ_PUBKEY",
    DeploymentBootstrap = "DEPLOYMENT_BOOTSTRAP",
    ExternalSubjectSha256 = "EXTERNAL_SUBJECT_SHA256",
    OpenmeterEventID = "OPENMETER_EVENT_ID",
    OriginalActionExecutionID = "ORIGINAL_ACTION_EXECUTION_ID",
    PlatformSessionID = "PLATFORM_SESSION_ID",
    SecretRefRehomeID = "SECRET_REF_REHOME_ID",
    SpicedbRelationship = "SPICEDB_RELATIONSHIP",
    SpicedbZedtoken = "SPICEDB_ZEDTOKEN",
    TemporalFirstRunID = "TEMPORAL_FIRST_RUN_ID",
    TemporalRunID = "TEMPORAL_RUN_ID",
    TemporalWorkflowID = "TEMPORAL_WORKFLOW_ID",
    TenantDeleteSubprocessID = "TENANT_DELETE_SUBPROCESS_ID",
    TenantInvitationID = "TENANT_INVITATION_ID",
    TenantLifecycleSnapshotID = "TENANT_LIFECYCLE_SNAPSHOT_ID",
    TenantMembershipID = "TENANT_MEMBERSHIP_ID",
    TraceID = "TRACE_ID",
    UsageEventID = "USAGE_EVENT_ID",
}

/**
 * EvidenceRef 的敏感级别。SUMMARY 在当前 audit permission 下可解引用；RESTRICTED 还需 ResultExposure
 * 授权，在其交付前一律不可用（fail closed）。
 */
export enum EvidenceSensitivity {
    Restricted = "RESTRICTED",
    Summary = "SUMMARY",
}

/**
 * 实际 ACTIVE Grant 对该 Automation/run 的引用；不暴露 Secret、授予新权限或查询额度。
 */
export interface AutomationDelegationView {
    delegationId:                   string;
    delegationVersion:              number;
    executorInstallationResourceId: string;
    /**
     * RFC3339，UTC；与现有管理查询时间字段一致。
     */
    expiresAt:        string;
    ownerPrincipalId: string;
}

export interface AutomationDetailView {
    automation: AutomationElement;
    /**
     * 当前 Resource manage；不是运行准入、额度允许或业务成功。
     */
    canManage: boolean;
    /**
     * 仅当前 ACTIVE HUMAN owner、Workspace membership 与 Resource execute，以及已启用固定版本允许显示手动运行；仍须原
     * automation.run 的准入、Delegation、额度及步骤审批。缺省关闭，不是业务成功。
     */
    canRun?:               boolean;
    delegations:           DelegationElement[];
    nextDelegationOffset?: number;
    nextVersionOffset?:    number;
    versions:              VersionClass[];
}

export interface AutomationElement {
    delegationId?:                  string;
    executorInstallationResourceId: string;
    ownerPrincipalId:               string;
    pinnedVersionAssetId?:          string;
    resourceId:                     string;
    resourceState:                  ResourceState;
    resourceVersion:                number;
    state:                          AutomationState;
    workspaceId:                    string;
}

/**
 * 03 §7、05 §2.9：AutomationDefinition 的真实管理状态，不是 Invocation 终态。
 */
export enum AutomationState {
    Deleted = "DELETED",
    Disabled = "DISABLED",
    Draft = "DRAFT",
    Enabled = "ENABLED",
    Paused = "PAUSED",
}

/**
 * 实际 ACTIVE Grant 对该 Automation/run 的引用；不暴露 Secret、授予新权限或查询额度。
 */
export interface DelegationElement {
    delegationId:                   string;
    delegationVersion:              number;
    executorInstallationResourceId: string;
    /**
     * RFC3339，UTC；与现有管理查询时间字段一致。
     */
    expiresAt:        string;
    ownerPrincipalId: string;
}

/**
 * Core 自有 AutomationVersion 正文只在该 Asset fresh read 授权后返回；immutable Asset 三态复用既有版本契约。
 */
export interface VersionClass {
    assetId:              string;
    assetVersion:         number;
    automationResourceId: string;
    configHash:           string;
    content:              AutomationVersionContentClass;
    ordinal:              number;
    ownerPrincipalId:     string;
    state:                AgentVersionState;
}

export interface AutomationPage {
    automations:                AutomationElement[];
    availableApprovalPolicies?: ApprovalPolicyElement[];
    /**
     * 本次 fresh Workspace create 与已暴露真实动作共同成立；写前仍重新核验。
     */
    canCreate:   boolean;
    nextOffset?: number;
}

/**
 * GET /api/v1/automations/{resource_id}/runs：可读 Automation 的本人运行历史。游标只作分页，不授予权限；每页重新核验。
 */
export interface AutomationRunPage {
    automationResourceId: string;
    /**
     * 不透明 createdAt/id 稳定分页边界；缺省表示本次查询没有更多行。
     */
    nextCursor?: string;
    runs:        RunElement[];
}

/**
 * 本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
 */
export interface RunElement {
    /**
     * 原 TaskProjection 进度；缺省不推测百分比或成功。
     */
    progress?: string;
    /**
     * 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
     */
    stepApprovalTask?: StepApprovalTaskClass;
    task:              StepApprovalTaskClass;
    /**
     * 同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
     */
    usageEventIds: string[];
}

/**
 * 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
 *
 * GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
 * 非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
 */
export interface StepApprovalTaskClass {
    actionExecutionId:   string;
    actionKey:           string;
    actionVersion:       number;
    approvalStatus?:     ApprovalStatus;
    approvalWorkflowId?: string;
    /**
     * 仅任务详情且 Core 当前完成本人、权限、原 Workflow 运行事实重查后提供；提交时仍重新准入
     */
    cancelActionKey?: string;
    /**
     * RFC3339，UTC
     */
    createdAt:     string;
    dispatchState: ActionDispatchState;
    gateState:     ActionGateState;
    observation?:  ReasonCode;
    operationId:   string;
    reason?:       ReasonCode;
    /**
     * 仅任务详情且 Core 证明原 Workflow 已关闭、终态投影一致、原目标仍在收敛版本并完成本人和权限重查后提供；提交与派发时仍重新准入
     */
    rerunActionKey?: string;
    targetId:        string;
    taskStatus?:     TaskStatus;
    waitingReason?:  string;
    workflowId?:     string;
    workflowKind?:   WorkflowKind;
    workspaceId?:    string;
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
    AgentInstallation = "AGENT_INSTALLATION",
    BuzzIdentityProjection = "BUZZ_IDENTITY_PROJECTION",
    ComponentAction = "COMPONENT_ACTION",
    ComponentBinding = "COMPONENT_BINDING",
    ComponentDisable = "COMPONENT_DISABLE",
    ComponentRelease = "COMPONENT_RELEASE",
    ConversationProjection = "CONVERSATION_PROJECTION",
    MembershipProjection = "MEMBERSHIP_PROJECTION",
    MembershipRevocation = "MEMBERSHIP_REVOCATION",
    ProtocolSessionReconcile = "PROTOCOL_SESSION_RECONCILE",
    ResourceProvision = "RESOURCE_PROVISION",
    SecretRefRehome = "SECRET_REF_REHOME",
    TenantLifecycle = "TENANT_LIFECYCLE",
    WorkspaceLifecycle = "WORKSPACE_LIFECYCLE",
}

/**
 * 本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
 */
export interface AutomationRunView {
    /**
     * 原 TaskProjection 进度；缺省不推测百分比或成功。
     */
    progress?: string;
    /**
     * 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
     */
    stepApprovalTask?: StepApprovalTaskClass;
    task:              StepApprovalTaskClass;
    /**
     * 同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
     */
    usageEventIds: string[];
}

/**
 * Core 自有 AutomationVersion 正文只在该 Asset fresh read 授权后返回；immutable Asset 三态复用既有版本契约。
 */
export interface AutomationVersionView {
    assetId:              string;
    assetVersion:         number;
    automationResourceId: string;
    configHash:           string;
    content:              AutomationVersionContentClass;
    ordinal:              number;
    ownerPrincipalId:     string;
    state:                AgentVersionState;
}

export interface AutomationView {
    delegationId?:                  string;
    executorInstallationResourceId: string;
    ownerPrincipalId:               string;
    pinnedVersionAssetId?:          string;
    resourceId:                     string;
    resourceState:                  ResourceState;
    resourceVersion:                number;
    state:                          AutomationState;
    workspaceId:                    string;
}

export interface CapabilityContractPage {
    canRegister: boolean;
    contracts:   ContractElement[];
    nextOffset?: number;
}

/**
 * 受权 Catalog 元数据，不复制 schema/测试向量或业务正文，不证明 release/binding 可用。
 */
export interface ContractElement {
    canApprove:                    boolean;
    canDeprecate:                  boolean;
    categoryKey:                   string;
    conformanceSuiteDigest:        string;
    contractVersion:               number;
    registeredByActionExecutionId: string;
    schemaSetDigest:               string;
    status:                        CapabilityContractStatus;
}

export enum CapabilityContractStatus {
    Active = "ACTIVE",
    Deprecated = "DEPRECATED",
    Draft = "DRAFT",
    Retired = "RETIRED",
}

/**
 * 受权 Catalog 元数据，不复制 schema/测试向量或业务正文，不证明 release/binding 可用。
 */
export interface CapabilityContractView {
    canApprove:                    boolean;
    canDeprecate:                  boolean;
    categoryKey:                   string;
    conformanceSuiteDigest:        string;
    contractVersion:               number;
    registeredByActionExecutionId: string;
    schemaSetDigest:               string;
    status:                        CapabilityContractStatus;
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
    /**
     * 状态仍在收敛时，客户端再次读取设备状态前至少等待的毫秒数；确定终态时缺省
     */
    recheckAfterMillis?: number;
    state:               BuzzIdentityState;
    /**
     * 推进该状态的 Workflow；本次调用没有需要推进的状态时缺省
     */
    workflowId?: string;
}

/**
 *
 * Core私网仅向受信Worker返回的逐次隔离探测凭据。token仅在Activity内存中使用，禁止进入Temporal输入、输出或报告。其声明绑定固定模拟上下文与完整实际参数，不授予生产binding授权。
 */
export interface ComponentConformanceAuthorization {
    expectedResponseDigest: string;
    operation:              ComponentConformanceOperation;
    requestDigest:          string;
    requestJson:            string;
    token:                  string;
}

/**
 * 原登记套件的真实操作种类；MCP 方法不属于 AdapterProtocolOperation，也不要求原生 peer 实现 Adapter API。
 */
export enum ComponentConformanceOperation {
    Cancel = "cancel",
    Execute = "execute",
    ExtractUsage = "extract_usage",
    Handshake = "handshake",
    MCPCall = "mcp_call",
    MCPInitialize = "mcp_initialize",
    MCPList = "mcp_list",
    MapNativeStatusError = "map_native_status_error",
    Observe = "observe",
    QueryRevision = "query_revision",
    Reconcile = "reconcile",
    ResolveNativeScope = "resolve_native_scope",
    ValidateBinding = "validate_binding",
}

/**
 * Core原canonical_digest对同一已授权步骤实际响应的摘要；仅规范化事实，不声明套件通过或登记成功。
 */
export interface ComponentConformanceWireDigests {
    requestDigest:  string;
    responseDigest: string;
    resultDigest?:  string;
}

/**
 * 受信Worker实际HTTP响应的瞬时核验输入。正文仅在Activity与Core请求内存中存在，不得进入Temporal历史、报告、日志或数据库；不是用户上传的通过声明。
 */
export interface ComponentConformanceWireObservation {
    httpStatus:   number;
    probe:        ProbeClass;
    responseJson: string;
}

/**
 * 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
 * history 承接，不建立另一执行账本。
 */
export interface ProbeClass {
    contentReference?: ContentReferenceClass;
    plan:              PlanClass;
    /**
     * 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
     */
    reconcile?: boolean;
    stepIndex:  number;
}

/**
 * 受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
 */
export interface PlanClass {
    actionExecutionId:  string;
    artifactDigest:     string;
    componentReleaseId: string;
    connectorKind?:     ConnectorKind;
    contractDigests:    string[];
    /**
     * 独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
     */
    identityDigest: string;
    operationId:    string;
    planDigest:     string;
    /**
     * Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
     * Describe 与同 workflow 的当前 TaskProjection 核对。
     */
    runId:       string;
    steps:       PlanStep[];
    suiteDigest: string;
    workflowId:  string;
}

export enum ConnectorKind {
    ProtocolPeer = "PROTOCOL_PEER",
    RemoteAdapter = "REMOTE_ADAPTER",
}

export interface PlanStep {
    caseKey: string;
    /**
     * 只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
     * native 任务元数据。
     */
    contractKey?: string;
    /**
     * Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
     */
    expectedHttpStatus:     number;
    expectedMcpResultKind?: MCPResultKind;
    expectedResponseJson:   string;
    idempotencyKey:         string;
    operation:              ComponentConformanceOperation;
    referenceAssetId?:      string;
    referenceFromStepKey?:  string;
    referenceResourceId?:   string;
    requestJson:            string;
    stepKey:                string;
}

export enum MCPResultKind {
    Error = "ERROR",
    Result = "RESULT",
}

/**
 * 原受信Worker在原审批后的COMPONENT_RELEASE Activity报告实际自身能力。Core自行读取自身与当前Web事实，并重新核验原release套件和审批。
 */
export interface ComponentReleaseApprovalReport {
    runId:       string;
    target:      TargetClass;
    workerBuild: WorkerBuildClass;
}

/**
 * 原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
 */
export interface TargetClass {
    actionExecutionId:  string;
    componentReleaseId: string;
    workflowId:         string;
}

/**
 * 设计03的当前已部署主体能力事实，由原受信服务/当前Web产物观察产生，不接受管理表单声明。
 */
export interface WorkerBuildClass {
    adapterProtocolVersions: string[];
    buildId:                 string;
    connectorKinds?:         string[];
    driverRegistryKeys:      string[];
    hostApiVersion:          string;
    mcpProtocolVersions?:    string[];
    platformPortKeys:        PlatformPortKey[];
    reportedAt:              Date;
    subject:                 Subject;
}

export enum PlatformPortKey {
    AIGateway = "AI_GATEWAY",
    ApprovalWorkflow = "APPROVAL_WORKFLOW",
    Authorization = "AUTHORIZATION",
    CollaborationRelay = "COLLABORATION_RELAY",
    CoreInternal = "CORE_INTERNAL",
    IdentityEdge = "IDENTITY_EDGE",
    MeteringBilling = "METERING_BILLING",
    SecretStore = "SECRET_STORE",
}

export enum Subject {
    BuzzWeb = "BUZZ_WEB",
    Core = "CORE",
    Worker = "WORKER",
}

/**
 * 受Catalog管理权限保护的已登记release元数据，正文与套件令牌不外露；REGISTERED不等于APPROVED或binding可用。
 */
export interface ComponentReleasePage {
    canApprove?: boolean;
    canRegister: boolean;
    nextOffset?: number;
    releases:    ComponentReleaseView[];
}

export interface ComponentReleaseView {
    approvedByActionExecutionId?:  string;
    artifactDigest:                string;
    componentReleaseId:            string;
    componentTypeKey:              string;
    manifestDigest:                string;
    operationId:                   string;
    registeredByActionExecutionId: string;
    status:                        ComponentReleaseStatus;
    suiteDigest:                   string;
    version:                       string;
    workflowId:                    string;
}

export enum ComponentReleaseStatus {
    Approved = "APPROVED",
    Registered = "REGISTERED",
    Rejected = "REJECTED",
    Revoked = "REVOKED",
}

/**
 * 原准入同事务登记后的不可变引用；不是组件激活或审批回执。
 */
export interface ComponentReleaseReceipt {
    actionExecutionId:  string;
    componentReleaseId: string;
    planDigest:         string;
    status:             ComponentReleaseStatus;
}

/**
 * 原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
 */
export interface ConversationOpenRequest {
    participantPrincipalIds: string[];
}

export interface ConversationPage {
    items:       ItemElement[];
    nextCursor?: string;
}

/**
 * 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
 */
export interface ItemElement {
    channelId:               string;
    id:                      string;
    operationId:             string;
    participantPrincipalIds: string[];
    state:                   ItemState;
    version:                 number;
}

export enum ItemState {
    Active = "ACTIVE",
    Disabled = "DISABLED",
    Provisioning = "PROVISIONING",
    Reconciling = "RECONCILING",
}

/**
 * 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
 */
export interface ConversationParticipant {
    displayName: string;
    principalId: string;
    pubkeys:     string[];
}

export interface ConversationParticipantPage {
    items:           ItemClass[];
    maxParticipants: number;
    nextCursor?:     string;
}

/**
 * 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
 */
export interface ItemClass {
    displayName: string;
    principalId: string;
    pubkeys:     string[];
}

/**
 * PUT /api/v1/user-state/conversations/{conversationId} 的请求体（DD-40）：参与者私聊的收藏与静音，复用同一
 * CollaborationUserState version CAS。隐藏状态不在此权威。
 */
export interface ConversationPreferenceRequest {
    muted:   boolean;
    starred: boolean;
    version: number;
}

/**
 * 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
 */
export interface ConversationView {
    channelId:               string;
    id:                      string;
    operationId:             string;
    participantPrincipalIds: string[];
    state:                   ItemState;
    version:                 number;
}

/**
 * 已授权普通 Action 的 v1 平台元数据结果；不含业务正文、邀请凭证、文档或协议会话。仅 agent.invoke、automation.run 及已接入普通
 * resource 动作使用；与通用 BFF ActionSubmission 的可选扩展解耦。
 */
export interface DelegatedActionMetadataV1 {
    actionExecutionId:   string;
    actionKey:           string;
    approvalWorkflowId?: string;
    dispatchState:       ActionDispatchState;
    gateState:           ActionGateState;
    operationId:         string;
    reason?:             ReasonCode;
    workflowId?:         string;
}

export interface DiscoverableWorkspace {
    channel:   ChannelClass;
    createdAt: Date;
    id:        string;
    /**
     * 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
     */
    isMember:         boolean;
    joinActionKey?:   JoinActionKey;
    memberCount:      number;
    membershipState?: WorkspaceMembershipState;
    visibility:       WorkspaceVisibility;
}

/**
 * Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
 */
export interface ChannelClass {
    archived:     boolean;
    channelId:    string;
    channelType:  ChannelType;
    description?: string;
    name:         string;
    ttlDeadline?: Date;
    ttlSeconds?:  number;
}

export enum JoinActionKey {
    WorkspaceJoin = "workspace.join",
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

export interface DiscoverableWorkspacePage {
    items:       DiscoverableWorkspacePageItem[];
    nextCursor?: string;
}

export interface DiscoverableWorkspacePageItem {
    channel:   ChannelClass;
    createdAt: Date;
    id:        string;
    /**
     * 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
     */
    isMember:         boolean;
    joinActionKey?:   JoinActionKey;
    memberCount:      number;
    membershipState?: WorkspaceMembershipState;
    visibility:       WorkspaceVisibility;
}

/**
 * GET /api/v1/audit/events/{id}/evidence/{index} 的回应。每次以事件 scope 的当前 audit permission fresh
 * 授权；每种证据另向其权威源查证原对象仍存在：明确不存在回 404（正文为 NOT_FOUND 的不可用视图），权威源不提供查证接口为 UNVERIFIABLE，权威源不可达回
 * 503。不可用时不回任何 ref 内容。
 */
export interface EvidenceView {
    authority?:   EvidenceAuthority;
    available:    boolean;
    kind?:        EvidenceKind;
    sensitivity?: EvidenceSensitivity;
    /**
     * 权威源中的稳定 ID；仅 available 为 true 时出现
     */
    stableId?:          string;
    unavailableReason?: EvidenceUnavailableReason;
    /**
     * 该 ID 的版本；证据未登记版本时缺省
     */
    version?: number;
}

/**
 * 解引用只显示不可用时的原因：原证据已不存在（HTTP 404）、敏感级别未获授权、存量种类不可识别、权威源无法按该 ID 查证其仍存在。
 */
export enum EvidenceUnavailableReason {
    NotFound = "NOT_FOUND",
    Restricted = "RESTRICTED",
    Unrecognized = "UNRECOGNIZED",
    Unverifiable = "UNVERIFIABLE",
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
 * GET /api/v1/identity/legacy-secret-refs 的有界视图。只列当前 Tenant 中可发起 DD-85 归位的 SERVER
 * binding，不暴露 locator、版本或私钥。
 */
export interface LegacySecretRefPage {
    bindings:    LegacySecretRefBinding[];
    nextCursor?: string;
}

/**
 * 业务 Tenant 的旧 SERVER 身份引用；仅给有 tenant manage 权限的人展示。
 */
export interface LegacySecretRefBinding {
    kind:        BindingKind;
    principalId: string;
    pubkey:      string;
}

export enum BindingKind {
    Control = "CONTROL",
    Human = "HUMAN",
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
 * GET /api/v1/platform-info 的回应（DD-111）：只含公开展示字段，不依赖 PlatformSession
 * 与身份解析，仍在网关入口的认证之后。displayName 取自部署配置 PLATFORM_DISPLAY_NAME，是界面上产品名的唯一来源。
 */
export interface PlatformInfo {
    /**
     * 部署的显示名，去除首尾空白后非空
     */
    displayName: string;
}

/**
 * GET /api/v1/platform/tenants 的有界回应：只对 Platform Catalog Tenant 中持有 fresh Catalog manage
 * 的会话开放，列出业务 Tenant 及其当前状态与可发起的暂停/恢复动作提示（DD-96）。动作提交仍由 Core 重新准入。
 */
export interface PlatformTenantPage {
    /**
     * 下一页的 Core 索引偏移，缺省即读完
     */
    nextOffset?: number;
    tenants:     PlatformTenantView[];
}

export interface PlatformTenantView {
    id: string;
    /**
     * 按该 Tenant 当前状态可发起的暂停（ACTIVE，或协作面 binding 为 ACTIVE 的 ERROR）或恢复（SUSPENDED）动作
     * key；目录未开放、处于收敛中或本页提示判定失败时省略
     */
    lifecycleActionKey?: TenantLifecycleActionKey;
    name:                string;
    slug:                string;
    state:               TenantState;
}

/**
 * 按该 Tenant 当前状态可发起的暂停（ACTIVE，或协作面 binding 为 ACTIVE 的 ERROR）或恢复（SUSPENDED）动作
 * key；目录未开放、处于收敛中或本页提示判定失败时省略
 *
 * 业务 Tenant 暂停与恢复的 ActionDefinition key（DD-96）。两者都由 Platform Catalog Tenant 的
 * platform-admin 发起；Tenant delete 随 Stage 3 注册，不在此列。
 */
export enum TenantLifecycleActionKey {
    TenantRestore = "tenant.restore",
    TenantSuspend = "tenant.suspend",
}

/**
 * Tenant 状态机。权威定义见 .design/03-领域模型与权限模型.md。DELETING/DELETED 因 GAP-LCM-01
 * 开放而不注册入口，但状态本身保留以承载已有记录。
 */
export enum TenantState {
    Active = "ACTIVE",
    Deleted = "DELETED",
    Deleting = "DELETING",
    Error = "ERROR",
    Provisioning = "PROVISIONING",
    Restoring = "RESTORING",
    Suspended = "SUSPENDED",
    Suspending = "SUSPENDING",
}

export interface PlatformToolPage {
    nextOffset?: number;
    tools:       ToolElement[];
}

export interface ToolElement {
    actionKey:        ActionKey;
    canConsume:       boolean;
    inputSchemaHash:  string;
    name:             ActionKey;
    outputSchemaHash: string;
    ownerPrincipalId: string;
    resourceId:       string;
    resourceState:    ResourceState;
    resourceVersion:  number;
    source:           Source;
    status:           ToolStatus;
}

export enum ActionKey {
    AgentMemoryEntryList = "agent.memory.entry.list",
    AgentMemoryEntryRead = "agent.memory.entry.read",
}

export enum Source {
    PlatformNative = "PLATFORM_NATIVE",
}

export enum ToolStatus {
    Active = "ACTIVE",
    Provisioning = "PROVISIONING",
}

export interface PlatformToolView {
    actionKey:        ActionKey;
    canConsume:       boolean;
    inputSchemaHash:  string;
    name:             ActionKey;
    outputSchemaHash: string;
    ownerPrincipalId: string;
    resourceId:       string;
    resourceState:    ResourceState;
    resourceVersion:  number;
    source:           Source;
    status:           ToolStatus;
}

/**
 * 03/18: only the initiating HUMAN's fresh-authorized original Session facts. No PAT,
 * launch credential, native body or replacement revision is recoverable from this reader.
 */
export interface ProtocolSessionView {
    actionExecutionId:      string;
    admittedMode:           TedMode;
    applicationBindingId:   string;
    baseRevision:           string;
    effectiveEditorOrigins: string[];
    expiresAt:              Date;
    launchLocale:           Locale;
    launchTheme:            Theme;
    protocolSessionId:      string;
    reference:              ContentReferenceClass;
    resultRevision?:        string;
    state:                  ProtocolSessionViewState;
    tenantId:               string;
    version:                number;
    workspaceId?:           string;
}

export enum ProtocolSessionViewState {
    Admitted = "ADMITTED",
    Closed = "CLOSED",
    Conflict = "CONFLICT",
    Dirty = "DIRTY",
    Expired = "EXPIRED",
    Failed = "FAILED",
    Open = "OPEN",
    Opening = "OPENING",
    ReadOnly = "READ_ONLY",
    Revoked = "REVOKED",
    Saved = "SAVED",
    Unknown = "UNKNOWN",
}

/**
 * PUT /api/v1/user-state/read 的请求体（DD-40、03 §2）。contextKey 只接受调用方可读 Workspace 内的 Channel
 * ID、msg:<Buzz event id> 或 thread:<Buzz root event id>；version 是读到的 CollaborationUserState
 * 版本，不符即 409。
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
 * GET /api/v1/role-members 的有界回应。只列当前 Tenant 的 ACTIVE HUMAN 成员；角色从 SpiceDB fresh
 * 读取，动作可用性只作界面提示，提交时仍重新准入（DD-82）。
 */
export interface RoleMemberPage {
    members: RoleMemberView[];
    /**
     * 下一页首项之前的 Principal ID；缺省即已经读完
     */
    nextCursor?: string;
}

export interface RoleMemberView {
    canGrantTenantAdmin:     boolean;
    canGrantWorkspaceAdmin:  boolean;
    canRevokeTenantAdmin:    boolean;
    canRevokeWorkspaceAdmin: boolean;
    displayName:             string;
    /**
     * 有效 Tenant admin 仅剩此人；该人的撤销按钮禁用，服务端最终准入仍重查
     */
    lastTenantAdmin: boolean;
    principalId:     string;
    tenantAdmin:     boolean;
    /**
     * 没有 workspaceId 时恒为 false
     */
    workspaceAdmin: boolean;
}

/**
 * GET /api/v1/role-workspaces 的有界回应：当前 Principal 对哪些 Workspace 持有 fresh manage
 * permission（ACTIVE、暂停中、已暂停、恢复中，以及已有协作面 binding 的 ERROR，各带当前状态），并附当前可用的 Workspace
 * 创建、暂停与恢复动作提示。动作提交仍由 Core 重新准入，不等于可进入频道。
 */
export interface RoleWorkspacePage {
    /**
     * 当前 Principal 经 fresh Tenant create 检查可见的动作 key；目录未开放或无权时省略
     */
    createActionKey?: CreateActionKey;
    /**
     * 下一页的 Core 索引偏移；不暴露无权 Workspace 的 ID，缺省即读完
     */
    nextOffset?: number;
    workspaces:  RoleWorkspaceView[];
}

export enum CreateActionKey {
    WorkspaceCreate = "workspace.create",
}

export interface RoleWorkspaceView {
    id: string;
    /**
     * 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
     * ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
     */
    lifecycleActionKey?: WorkspaceLifecycleActionKey;
    name:                string;
    state:               WorkspaceState;
}

/**
 * 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
 * ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
 *
 * Workspace 暂停与恢复的 ActionDefinition key（.design/06 §7.3）。两者都从 Tenant scope 发起；当前不登记
 * Workspace delete（DD-46）。
 */
export enum WorkspaceLifecycleActionKey {
    WorkspaceRestore = "workspace.restore",
    WorkspaceSuspend = "workspace.suspend",
}

/**
 * Workspace 状态机。权威定义见 .design/03-领域模型与权限模型.md。
 */
export enum WorkspaceState {
    Active = "ACTIVE",
    Error = "ERROR",
    Provisioning = "PROVISIONING",
    Restoring = "RESTORING",
    Suspended = "SUSPENDED",
    Suspending = "SUSPENDING",
}

/**
 * GET /api/v1/session 的回应：已解析的执行身份与本次 PlatformSession。原生端以 platformSessionId
 * 绑定设备持钥证明（DD-79）。
 */
export interface PlatformSessionView {
    accessMode: PlatformSessionAccessMode;
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
 * PlatformSession.access_mode（.design/03 §2）；受限会话不授予普通管理面或协作面准入。
 */
export enum PlatformSessionAccessMode {
    Full = "FULL",
    LifecycleRestricted = "LIFECYCLE_RESTRICTED",
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
     * 仅任务详情且 Core 当前完成本人、权限、原 Workflow 运行事实重查后提供；提交时仍重新准入
     */
    cancelActionKey?: string;
    /**
     * RFC3339，UTC
     */
    createdAt:     string;
    dispatchState: ActionDispatchState;
    gateState:     ActionGateState;
    observation?:  ReasonCode;
    operationId:   string;
    reason?:       ReasonCode;
    /**
     * 仅任务详情且 Core 证明原 Workflow 已关闭、终态投影一致、原目标仍在收敛版本并完成本人和权限重查后提供；提交与派发时仍重新准入
     */
    rerunActionKey?: string;
    targetId:        string;
    taskStatus?:     TaskStatus;
    waitingReason?:  string;
    workflowId?:     string;
    workflowKind?:   WorkflowKind;
    workspaceId?:    string;
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
 * Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
 */
export interface WebChannelView {
    archived:     boolean;
    channelId:    string;
    channelType:  ChannelType;
    description?: string;
    name:         string;
    ttlDeadline?: Date;
    ttlSeconds?:  number;
}

/**
 * 原 Buzz 线程分页的复合游标；下一请求以 before=createdAt、beforeId=eventId 原样提交，避免同秒回复丢失。
 */
export interface WebMessageCursor {
    createdAt: number;
    eventId:   string;
}

/**
 * 同一已准入 Channel 的原生消息分页或线程读取。before/beforeId 必须成对，频道窗口向前翻历史，线程沿原 Relay
 * 协议向后读回复；上界来自运行时配置与原协议上界，不接受任意 Relay filter。
 */
export interface WebMessageQuery {
    before?:        number;
    beforeId?:      string;
    messageType?:   WebMessageType;
    parentEventId?: string;
}

/**
 * 原 Buzz 频道消息语义。缺省 STREAM 保持旧请求；不允许调用者提交任意事件 kind。
 */
export enum WebMessageType {
    ForumComment = "FORUM_COMMENT",
    ForumPost = "FORUM_POST",
    Stream = "STREAM",
}

/**
 * Own Buzz kind:0 metadata. The authenticated host chooses the signer and Tenant; no raw
 * event, author, relay URL or management tags are accepted. Omitted fields are preserved;
 * empty strings explicitly clear a field.
 */
export interface WebProfileUpdateRequest {
    about?:       string;
    avatarUrl?:   string;
    displayName?: string;
    /**
     * Read snapshot guard only. Core derives the signer from the active identity; a mismatch
     * rejects without publication.
     */
    expectedPubkey: string;
    idempotencyKey: string;
    nip05Handle?:   string;
}

/**
 * Current own profile read from Buzz, never a Core profile copy. An absent kind:0 is an
 * empty profile, not a fabricated event.
 */
export interface WebProfileView {
    about: null | string;
    /**
     * Same-origin BFF paths for exact media URLs on the current community. A read projection,
     * never an upload or remote proxy authority.
     */
    avatarMediaPaths: { [key: string]: string };
    avatarUrl:        null | string;
    displayName:      null | string;
    eventId:          null | string;
    nip05Handle:      null | string;
    pubkey:           string;
}

/**
 * Web HUMAN 的原 Buzz 消息语义输入；身份、Channel、回复祖先与 mention 公钥均由 BFF 在原 scope 中解析，不接受 raw tags 或
 * signed event。
 */
export interface WebPublishMessageRequest {
    attachments?: WebMessageAttachment[];
    content:      string;
    /**
     * 编辑原 Buzz 消息；BFF 回读同 Channel 原事件并核对本人签名身份，发原 kind 40003。与 parentEventId 互斥，缺省保持原新消息语义。
     */
    editEventId?: string;
    /**
     * 用户明确选中的本 Workspace Installation；缺省为空，BFF 排序去重并冻结于原发布幂等记录。
     */
    mentionInstallationIds?: string[];
    messageType?:            WebMessageType;
    /**
     * 原 Relay 消息引用；BFF 在当前 Channel 回读验签并解析 NIP-10 祖先。
     */
    parentEventId?: string;
}

export interface WebMessageAttachment {
    /**
     * 原 Buzz imeta filename；仅为显示及下载名称，不参与媒体存储寻址。
     */
    filename?: string;
    sha256:    string;
    size:      number;
    /**
     * 沿原 Buzz Markdown 隐藏图片或视频；普通文件仍为文件链接。
     */
    spoiler?: boolean;
    type:     string;
    url:      string;
}

/**
 * GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 或 fresh manage 管理资格，且两侧
 * binding 都 ACTIVE 的 Workspace。管理可见不代表可读取协作消息；isMember 投影真实成员事实。Workspace id 同时是其 Channel
 * id（DD-80）。
 */
export interface WorkspaceView {
    id: string;
    /**
     * 调用方是否有 ACTIVE WorkspaceMembership；管理资格不使该值为真。旧回应缺省表示未知，不得当作已加入频道。
     */
    isMember?: boolean;
    name:      string;
    slug:      string;
    /**
     * Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
     */
    visibility?: WorkspaceVisibility;
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
 * PUT /api/v1/user-state/workspaces/{workspaceId} 的请求体（DD-40）：该 Workspace 的收藏与静音。version
 * 是读到的 CollaborationUserState 版本，不符即 409；updatedAt 由 Core 用库时钟补写，不取调用方的值。
 */
export interface WorkspacePreferenceRequest {
    muted:   boolean;
    starred: boolean;
    version: number;
}

/**
 * DD-49/70/71/94：Core-only签发投递。只有版本化OpenBao引用及Agent已发布JWKS文件引用，不含私钥正文。
 */
export interface ActionTokenSigningDelivery {
    issuer:          string;
    jwksFile:        string;
    privateKeyField: string;
    secretAudience:  string;
    secretLocator:   string;
    secretVersion:   number;
    tokenSeconds:    number;
}

/**
 * Installation 只取自受验签的 Invocation Session，不接受调用方目标覆盖。
 */
export interface AgentMemoryEntryListInput {
}

/**
 * 只读当前 Invocation Installation 的 cold mem entry，不接受 core 或其他 Installation。
 */
export interface AgentMemoryEntryReadInput {
    slug: string;
}

/**
 * HUMAN Memory Action 本次瞬态输入；正文仅用于原生 NIP-AE 构造，不进入 ActionExecution、审计、outbox 或 history。
 */
export interface AgentMemoryWriteInput {
    /**
     * entry.patch 当前原生 value 的 SHA-256。
     */
    baseHash?: string;
    /**
     * 调用方实际读取的 head；null 只表示原生确认不存在。
     */
    expectedHeadEventId?: null | string;
    /**
     * 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
     */
    expectedHeadState: ExpectedHeadState;
    /**
     * entry.patch 的原生严格 unified diff，不支持 fuzz、offset 或多文件。
     */
    patch?: string;
    slug:   string;
    /**
     * core.replace 的 profile 或 entry.set 的 value；完整序列化 JSON body 必须满足原生 NIP-44 上界。
     */
    value?: string;
}

/**
 * 03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
 * environment。发布不等于安装或运行授权。
 */
export interface AgentVersionContent {
    /**
     * 精确 contract_key@version，不引用业务能力实现名。
     */
    capabilityRequirements:  string[];
    declaredToolResourceIds: string[];
    instructions:            string;
    memoryPolicy:            AgentVersionContentMemoryPolicyClass;
    modelRouteResourceId:    string;
    parallelism:             number;
    personaIdentity:         AgentVersionContentPersonaIdentityClass;
    /**
     * RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。
     */
    replyPolicy:          string;
    runtimeProfileKey:    string;
    skillVersionAssetIds: string[];
    triggerDefaults:      AgentTrigger[];
    turnLimits:           AgentVersionContentTurnLimitsClass;
}

export interface AgentVersionContentMemoryPolicyClass {
    coldWrite: AgentMemoryColdWrite;
    coreWrite: AgentMemoryCoreWrite;
}

export interface AgentVersionContentPersonaIdentityClass {
    avatarUrl?:   string;
    description?: string;
    displayName:  string;
}

export interface AgentVersionContentTurnLimitsClass {
    idleTimeoutSeconds:     number;
    maxTurnDurationSeconds: number;
}

/**
 * DD-94部署投递面：adapter服务引用解析到固定部署产物/原生实例与受限传输。不是Catalog或业务授权。
 */
export interface ApplicationAdapterDirectory {
    adapters: ApplicationAdapterDelivery[];
    /**
     * 受控部署事实，不是 Tool 注册表或业务授权；原生 MCP peer 不接收 ActionToken。
     */
    protocolPeers?: ApplicationProtocolPeerDelivery[];
}

export interface ApplicationAdapterDelivery {
    actionTokenAudience:        string;
    adapterServiceRef:          string;
    artifactDigest:             string;
    baseUrl:                    string;
    maxResponseBytes:           number;
    mcpUrl?:                    string;
    modelCredentialDeliveries?: ApplicationModelCredentialDelivery[];
    nativeInstanceRef:          string;
    secretReaders:              AdapterSecretReader[];
    timeoutSeconds:             number;
}

/**
 * 受控原生模型凭据交接回执；无密钥值，不创建模型，不替代OpenBao审计或binding准入。
 */
export interface ApplicationModelCredentialDelivery {
    bindingId:          string;
    configDigest:       string;
    generation:         number;
    nativeModelRef:     string;
    nativeProof:        string;
    nativeScopeRef:     string;
    requestId:          string;
    routeResourceId:    string;
    secretRef:          ApplicationModelServiceSecretRef;
    servicePrincipalId: string;
    verificationNonce:  string;
}

export interface ApplicationModelServiceSecretRef {
    audience: string;
    locator:  string;
    version:  number;
}

export interface AdapterSecretReader {
    audience:           string;
    roleName:           string;
    servicePrincipalId: string;
}

export interface ApplicationProtocolPeerDelivery {
    adapterServiceRef:          string;
    artifactDigest:             string;
    bindings:                   ApplicationProtocolPeerBindingDelivery[];
    maxResponseBytes:           number;
    mcpUrl:                     string;
    modelCredentialDeliveries?: ApplicationModelCredentialDelivery[];
    nativeInstanceRef:          string;
    secretReaders?:             ProtocolPeerSecretReader[];
    timeoutSeconds:             number;
}

export interface ApplicationProtocolPeerBindingDelivery {
    bindingId:             string;
    configDigest:          string;
    credentialGeneration?: number;
    isolationMode:         string;
    /**
     * 原受控投递映射：无secret值；精确版本由Core以原audience读取并向Gateway独占文件投递。
     */
    nativeCredentials?: ApplicationPeerCredentialDelivery[];
    /**
     * 绑定已有原生对象的受控投递事实，不创建对象或授予权限；父项唯一固定实例与作用域。
     */
    nativeResources?:   ApplicationNativeResourceDelivery[];
    nativeScopeRef:     string;
    servicePrincipalId: string;
    tenantId:           string;
    workspaceId?:       string;
}

export interface ApplicationPeerCredentialDelivery {
    audience:  string;
    header:    string;
    locator:   string;
    prefix:    string;
    secretKey: string;
    version:   number;
}

export interface ApplicationNativeResourceDelivery {
    evidenceDigest: string;
    evidenceRef:    string;
    nativeRef:      string;
    nativeType:     string;
    typeKey:        string;
}

export interface ProtocolPeerSecretReader {
    audience:           string;
    roleName:           string;
    servicePrincipalId: string;
}

/**
 * DD-88/94：pin 已批准 release 的业务绑定选择。只携带 SecretRef，不接受密钥正文或运行端点 URL。Workspace 取原
 * ActionCommand。
 */
export interface ApplicationBindingCreate {
    adapterServiceRef:    string;
    bindingId:            string;
    callIdentityMode:     ApplicationCallIdentityMode;
    capabilityCategories: ApplicationBindingCreateCapabilityCategoryClass[];
    componentReleaseId:   string;
    isolationMode:        ApplicationIsolationMode;
    modelCallMode:        ApplicationModelCallMode;
    nativeInstanceRef:    string;
    nativeScopeRef?:      string;
    normalizedConfigJson: string;
    retainOnTenantDelete: boolean;
    secretRefs:           ApplicationBindingCreateSecretRefClass[];
    servicePrincipalId:   string;
}

export interface ApplicationBindingCreateCapabilityCategoryClass {
    category: string;
    version:  number;
}

export interface ApplicationBindingCreateSecretRefClass {
    audience:  string;
    locator:   string;
    secretKey: string;
    version:   number;
}

/**
 * DD-92: modelGateway within the approved binding config. Only existing route and meter
 * references; no provider configuration, credential value or native model row.
 */
export interface ApplicationModelGatewayConfig {
    meterKeys:        string[];
    routeResourceIds: string[];
}

/**
 * DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
 */
export interface AutomationApprovalPolicyRef {
    id:      string;
    version: number;
}

/**
 * Temporal IntervalSpec 的显式秒数；offset 小于 every，catchupWindow 不小于原生的 10 秒。Overlap 固定
 * SKIP，不另实现 cron。
 */
export interface AutomationScheduleSpec {
    catchupWindowSeconds: number;
    everySeconds:         number;
    offsetSeconds:        number;
}

/**
 * REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval，不含消息正文、provider 配置或凭据。
 */
export interface AutomationVersionContent {
    action:          AutomationVersionContentActionClass;
    approvalPolicy?: ApprovalPolicyElement;
    resultTarget:    AutomationResultTarget;
    trigger:         AutomationVersionContentTriggerClass;
}

export interface AutomationVersionContentActionClass {
    kind:     ActionKind;
    template: string;
}

export interface AutomationVersionContentTriggerClass {
    kind:                AutomationTriggerKind;
    mentionPrincipalId?: string;
    scheduleSpec?:       ScheduleSpecClass;
    textPrefix?:         string;
}

/**
 * DD-102 / ADR-12：能力契约固定的机器向量。每个 case 按 steps 顺序执行契约操作，参数与预期结果是实际
 * JSON，不执行文本代码。格式有效不表示组件套件通过；线协议性质、真实执行与 release 证据关联另行核验。
 */
export interface CapabilityConformanceVectors {
    cases:         Case[];
    formatVersion: CapabilityVectorFormat;
}

export interface Case {
    caseKey: string;
    steps:   Step[];
}

export interface Step {
    contractKey:        string;
    expectedOutputJson: string;
    inputJson:          string;
    referenceAssetId?:  string;
    /**
     * 只引用同 case 已成功的更早 stepKey 的唯一 typed ContentReference；不得指定 JSON 路径或表达式。与固定 Resource/Asset
     * 目标一起进入规范化参数 hash。
     */
    referenceFromStepKey?: string;
    referenceResourceId?:  string;
    stepKey:               string;
}

export enum CapabilityVectorFormat {
    V1 = "V1",
}

/**
 * 固定 Catalog 自然键，不授予业务能力 consume 权限。
 */
export interface CapabilityContractRef {
    categoryKey:     string;
    contractVersion: number;
}

/**
 * DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
 */
export interface CapabilityContractRegistration {
    categoryKey:               string;
    contentReferenceSemantics: CapabilityContractRegistrationContentReferenceSemanticsClass;
    contractVersion:           number;
    operationContracts:        CapabilityContractRegistrationOperationContractClass[];
    protocolSessionKinds:      string[];
    requiredDeclarations:      CapabilityRequiredDeclaration[];
    resourceTypeFamily:        CapabilityContractRegistrationResourceTypeFamilyClass[];
    schemaDocuments:           string[];
    /**
     * CapabilityConformanceVectors 的 JSON 编码，formatVersion 固定格式；任意自然语言对象数组不构成可执行向量。Core
     * 校验所有步骤参数/结果符合契约 schema，覆盖所有 operationContracts，然后固定 canonical digest。
     */
    testVectorsJson: string;
}

export interface CapabilityContractRegistrationContentReferenceSemanticsClass {
    authorizationTargetRule: string;
    nativeObjectRefRule:     string;
    nativeRevisionRule:      string;
}

export interface CapabilityContractRegistrationOperationContractClass {
    contractKey:        string;
    inputSchemaDigest:  string;
    outputSchemaDigest: string;
    permission:         CapabilityPermission;
    surface:            CapabilitySurface;
    targetType:         string;
}

export interface CapabilityContractRegistrationResourceTypeFamilyClass {
    kind:    string;
    typeKey: string;
}

/**
 * Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。参数是组件原生持久内容引用，不把 SQL、提示或结果正文写入
 * Core/Temporal。
 */
export interface ComponentActionInput {
    actionVersion:               number;
    inputReference:              ContentReferenceClass;
    resultExposurePolicyId:      string;
    resultExposurePolicyVersion: number;
}

/**
 * 07§8A 的隔离环境投递配置，不是 Catalog/binding 权威。由运维配置精确绑定已装载候选 artifact；逐次短期模拟 token 仅由 Core
 * 对实际请求签发，不接受静态凭据文件或用户 action 自报地址。
 */
export interface ComponentConformanceEnvironment {
    adapterBaseUrl:   string;
    artifactDigest:   string;
    maxResponseBytes: number;
    maxSteps:         number;
}

/**
 * 隔离开发环境受控投递的协议夹具数据，不来自登记请求。Core 只采用固定协议用例并核对全部必需覆盖；没有脚本、条件、路径表达式或通过声明。
 */
export interface ComponentConformanceFixture {
    artifactDigest: string;
    steps:          PlanStep[];
}

/**
 * 仅用于07§8A隔离套件的模拟上下文投递。不是生产 Catalog、Delegation 或
 * ResultExposurePolicy。独立密钥/issuer/audience；其完整摘要固定在原登记计划。
 */
export interface ComponentConformanceIdentity {
    artifactDigest:  string;
    audience:        string;
    contexts:        ComponentConformanceIdentityContext[];
    issuer:          string;
    jwksFile:        string;
    privateKeyField: string;
    secretAudience:  string;
    secretLocator:   string;
    secretVersion:   number;
    tokenSeconds:    number;
}

export interface ComponentConformanceIdentityContext {
    actionDefinitionVersion:     number;
    actionKey:                   string;
    actorPrincipalId:            string;
    caseKey:                     string;
    operation:                   AdapterProtocolOperation;
    resultExposurePolicyId:      string;
    resultExposurePolicyVersion: number;
    stepKey:                     string;
    targetId?:                   string;
    targetType:                  string;
    tenantId:                    string;
    workspaceId?:                string;
}

/**
 * ADR-12 / design07§5.2 固定的出站逻辑操作。服务入站操作不通过此面调用。
 */
export enum AdapterProtocolOperation {
    Cancel = "cancel",
    Execute = "execute",
    ExtractUsage = "extract_usage",
    Handshake = "handshake",
    MapNativeStatusError = "map_native_status_error",
    Observe = "observe",
    QueryRevision = "query_revision",
    Reconcile = "reconcile",
    ResolveNativeScope = "resolve_native_scope",
    ValidateBinding = "validate_binding",
}

/**
 * 原 COMPONENT_CONFORMANCE_ENVIRONMENT_FILE 的 PROTOCOL_PEER 分支，仅隔离套件运行事实；readOnlyTools
 * 固定隔离实例实际上可安全执行的只读探针，不授予生产业务权限。
 */
export interface ComponentProtocolPeerEnvironment {
    artifactDigest:       string;
    initializeResultJson: string;
    listResultJson:       string;
    maxResponseBytes:     number;
    maxSteps:             number;
    mcpUrl:               string;
    readOnlyTools:        string[];
    timeoutSeconds:       number;
}

/**
 * 原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
 */
export interface ComponentReleaseApprovalTarget {
    actionExecutionId:  string;
    componentReleaseId: string;
    workflowId:         string;
}

/**
 * 组件登记只提交实际 manifest、包清单与 binding config schema；不接收 suite 通过声明、报告或候选执行地址。Core 解析并冻结内容，原
 * Worker 独立执行隔离套件。
 */
export interface ComponentReleaseRegistration {
    bindingConfigSchemaJson: string;
    manifestJson:            string;
    packageJson:             string;
}

/**
 * design03 的唯一内容引用线格式；不是业务正文。Adapter typed 槽是传递引用的唯一来源，resultJson 不用于识别或重建引用。
 */
export interface ContentReference {
    assetId?:        string;
    displayName:     string;
    mediaType:       string;
    nativeObjectRef: string;
    nativeRevision:  string;
    resourceId:      string;
}

export interface DelegationGrantParameters {
    expiresAt: Date;
    maxUses?:  number;
    scopes:    ScopeElement[];
    validFrom: Date;
}

/**
 * 03 §6 的确切 Action/target/exposure 限制；管理发现与原 Grant 写入共用，发现不授予 permission。
 */
export interface DelegationScopeParameters {
    actionKey:          string;
    actionVersion:      number;
    createWorkspaceId?: string;
    outputSchemaHash:   string;
    redactionPolicy:    string;
    resultExposureMode: ResultExposureMode;
    targetId?:          string;
    targetType:         string;
    toolResourceId?:    string;
}

/**
 * DD-95/103: transient, fixed-origin launch returned by the admitted binding adapter;
 * credentials are only string form fields, never a persisted Task, chat or ContentReference.
 */
export interface DocumentLaunchDescriptor {
    actionUrl:    string;
    editorOrigin: string;
    expiresAt:    string;
    formFields:   { [key: string]: string };
    method:       Method;
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
 * 受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
 * 仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
 */
export interface LlmRouteCreateInput {
    model:                  Model;
    provider:               Model;
    providerCredentialMode: LlmProviderCredentialMode;
    providerSecretRef?:     LlmRouteCreateInputProviderSecretRef;
}

export interface LlmRouteCreateInputProviderSecretRef {
    audience: string;
    locator:  string;
    version:  number;
}

/**
 * 18: native authenticated file-menu metadata from the Adapter typed reference producer.
 * This is NOT Action admission; the normal Kailo HUMAN session must independently
 * fresh-admit the frozen target and version. No ticket or content bytes.
 */
export interface NativeDocumentSelection {
    actionKey:       NativeDocumentSelectionActionKey;
    actionVersion:   number;
    bindingId:       string;
    generation:      number;
    reference:       ContentReferenceClass;
    resourceVersion: number;
    workspaceId:     string;
}

export enum NativeDocumentSelectionActionKey {
    FileStorageOpenEditV1 = "file_storage.open_edit@v1",
    FileStorageOpenViewV1 = "file_storage.open_view@v1",
}

/**
 * 设计03的当前已部署主体能力事实，由原受信服务/当前Web产物观察产生，不接受管理表单声明。
 */
export interface PlatformBuildInfo {
    adapterProtocolVersions: string[];
    buildId:                 string;
    connectorKinds?:         string[];
    driverRegistryKeys:      string[];
    hostApiVersion:          string;
    mcpProtocolVersions?:    string[];
    platformPortKeys:        PlatformPortKey[];
    reportedAt:              Date;
    subject:                 Subject;
}

/**
 * 03/07/18: the original HUMAN file protocol action, not an arbitrary editor or native URL.
 * Revision and presentation are frozen once; session expiry comes from controlled Core
 * delivery.
 */
export interface ProtocolSessionOpenInput {
    actionVersion: number;
    /**
     * The selected native source binding; must equal the target's real binding, not an
     * authorization claim.
     */
    applicationBindingId: string;
    locale:               Locale;
    /**
     * Exact approved projection selected by the native menu; never latest.
     */
    projectionGeneration: number;
    reference:            ContentReferenceClass;
    theme:                Theme;
}

export interface ResourceCreate {
    evidenceDigest: string;
    evidenceRef:    string;
    nativeRef:      string;
    nativeType:     string;
    typeKey:        string;
}

/**
 * 03 §7 的平台发布 Catalog 投递，不是用户 Resource 或 Agent 注册表。部署没有提供实际合同、凭据链与 runtime 对账证据时不得填 ACTIVE。
 */
export interface RuntimeProfileDirectory {
    profiles: Profile[];
}

export interface Profile {
    capabilityContract: FluffyCapabilityContract;
    key:                string;
    kind:               RuntimeProfileKind;
    status:             string;
    webAvailability:    string;
}

export interface FluffyCapabilityContract {
    capabilityRequirements: string[];
    maxIdleTimeoutSeconds:  number;
    maxParallelism:         number;
    maxTurnDurationSeconds: number;
    replyPolicies:          string[];
    /**
     * 同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
     */
    replyPolicyMappings?: FluffyRuntimeReplyPolicyMapping[];
}

export interface FluffyRuntimeReplyPolicyMapping {
    broadcastReplies: boolean;
    key:              string;
    threadReplies:    boolean;
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
 * platform:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>（前缀是协议常量，不随部署显示名变化；ADR-17
 * 迁移窗口内的存量引用仍为旧前缀），使「不分配第二个业务 workflow ID」可被机械校验。
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
 * workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
 */
export interface WorkspaceChannelCreate {
    channelType:  ChannelType;
    description?: string;
    /**
     * 原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
     */
    ttlSeconds?: number;
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
 * 唯一安装 Workflow 推进同一 ActionExecution/version/generation；取消接收不是原生清理终态。
 */
export interface AgentInstallationAdvanceRequest {
    actionExecutionId:    string;
    agentVersionAssetId:  string;
    cancelRequested:      boolean;
    installationId:       string;
    projectionGeneration: number;
    runId:                string;
    workflowId:           string;
}

/**
 * Core 查证后的安装生命周期状态；身份/模型/记忆/runtime 未闭合只返回 RUNNING/UNKNOWN，不把 spawn 当 ACTIVE。
 */
export interface AgentInstallationAdvanceResult {
    installationId: string;
    status:         TaskStatus;
    waitingReason:  string;
}

/**
 * DD-25/48：既有 ComponentTaskWorkflow 的 AGENT_INSTALLATION 冻结目标；不含凭据或 Version 正文。
 */
export interface AgentInstallationWorkflowTarget {
    actionExecutionId:    string;
    agentVersionAssetId:  string;
    installationId:       string;
    projectionGeneration: number;
}

/**
 * Worker 推进已冻结 Invocation；未知原生结果只观察，不再次 turn/start。
 */
export interface AgentTaskAdvanceRequest {
    activityId:                 string;
    agentVersionAssetId:        string;
    attempt:                    number;
    cancelRequested:            boolean;
    heartbeatIntervalSeconds:   number;
    installationId:             string;
    invocationId:               string;
    observationIntervalSeconds: number;
    projectionGeneration:       number;
    runId:                      string;
    workflowId:                 string;
}

/**
 * Core 查证的引用与状态；native completed 缺 reply/usage 证据仍 RUNNING。
 */
export interface AgentTaskAdvanceResult {
    approvalInput?:      ApprovalInputClass;
    approvalWorkflowId?: string;
    /**
     * 已查证安全停止此 Activity；不等于 Invocation 成功或 Capacity 已释放。
     */
    finishActivity: boolean;
    invocationId:   string;
    status:         TaskStatus;
    waitingReason:  string;
}

/**
 * ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
 * ActionExecution。
 */
export interface ApprovalInputClass {
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
 * DD-47/48：固定 AgentInvocation 与版本/投影引用；不携带 prompt、token 或原生正文。
 */
export interface AgentTaskWorkflowInput {
    agentVersionAssetId:        string;
    cancelPending:              boolean;
    eventBase:                  number;
    heartbeatIntervalSeconds:   number;
    heartbeatTimeoutSeconds:    number;
    installationId:             string;
    invocationId:               string;
    observationIntervalSeconds: number;
    projectionGeneration:       number;
}

export interface ApplicationBindingAdvanceRequest {
    cancelRequested: boolean;
    runId:           string;
    target:          ApplicationBindingAdvanceRequestTarget;
}

export interface ApplicationBindingAdvanceRequestTarget {
    actionExecutionId: string;
    bindingId:         string;
    bindingVersion:    number;
    workflowId:        string;
}

export interface ApplicationBindingAdvanceResult {
    bindingId:     string;
    status:        TaskStatus;
    waitingReason: string;
}

export interface ApplicationBindingTarget {
    actionExecutionId: string;
    bindingId:         string;
    bindingVersion:    number;
    workflowId:        string;
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

export interface AutomationScheduleAdmitRequest {
    input:      InputClass;
    runId:      string;
    workflowId: string;
}

/**
 * DD-107 Schedule 原生启动 AgentTaskWorkflow 的输入。计划时间仅取 native history，不由调用方提供。
 */
export interface InputClass {
    automationResourceId:     string;
    automationVersionAssetId: string;
    /**
     * 原 Workflow continue-as-new 仅携 true 保留已观察取消；首 native Schedule input 缺省。
     */
    cancelPending?: boolean;
    scheduleId:     string;
    sourceKind:     AutomationScheduleSource;
}

export enum AutomationScheduleSource {
    Schedule = "SCHEDULE",
}

export interface AutomationScheduleAdmitResult {
    admitted:   boolean;
    reasonCode: string;
    taskInput?: TaskInputClass;
}

/**
 * DD-47/48：固定 AgentInvocation 与版本/投影引用；不携带 prompt、token 或原生正文。
 */
export interface TaskInputClass {
    agentVersionAssetId:        string;
    cancelPending:              boolean;
    eventBase:                  number;
    heartbeatIntervalSeconds:   number;
    heartbeatTimeoutSeconds:    number;
    installationId:             string;
    invocationId:               string;
    observationIntervalSeconds: number;
    projectionGeneration:       number;
}

/**
 * DD-107 Schedule 原生启动 AgentTaskWorkflow 的输入。计划时间仅取 native history，不由调用方提供。
 */
export interface AutomationScheduleTaskInput {
    automationResourceId:     string;
    automationVersionAssetId: string;
    /**
     * 原 Workflow continue-as-new 仅携 true 保留已观察取消；首 native Schedule input 缺省。
     */
    cancelPending?: boolean;
    scheduleId:     string;
    sourceKind:     AutomationScheduleSource;
}

export interface ComponentActionAdvanceRequest {
    cancelRequested: boolean;
    runId:           string;
    target:          ComponentActionAdvanceRequestTarget;
}

/**
 * 原 ComponentTaskWorkflow(kind=COMPONENT_ACTION) 的冻结引用；全部业务参数仍从原 AE 的引用/hash读取。
 */
export interface ComponentActionAdvanceRequestTarget {
    actionExecutionId:    string;
    bindingId:            string;
    bindingVersion:       number;
    componentReleaseId:   string;
    projectionGeneration: number;
    workflowId:           string;
}

export interface ComponentActionAdvanceResult {
    actionExecutionId: string;
    status:            TaskStatus;
    waitingReason:     string;
}

/**
 * 原 ComponentTaskWorkflow(kind=COMPONENT_ACTION) 的冻结引用；全部业务参数仍从原 AE 的引用/hash读取。
 */
export interface ComponentActionTarget {
    actionExecutionId:    string;
    bindingId:            string;
    bindingVersion:       number;
    componentReleaseId:   string;
    projectionGeneration: number;
    workflowId:           string;
}

/**
 * 受信 Worker 的一次实际线协议观察，附着冻结 ActionExecution。Core 以自身 plan 逐项匹配，不接收 pass 布尔值；UNKNOWN
 * 不表示套件失败或成功。响应正文与测试凭据不进入报告。
 */
export interface ComponentConformanceObservation {
    actionExecutionId:  string;
    artifactDigest:     string;
    componentReleaseId: string;
    contractDigests:    string[];
    observations:       ObservationElement[];
    operationId:        string;
    planDigest:         string;
    runId:              string;
    suiteDigest:        string;
    workflowId:         string;
}

export interface ObservationElement {
    caseKey:                 string;
    contentReference?:       ContentReferenceClass;
    errorClass?:             ErrorClass;
    httpStatus:              number;
    mcpResultKind?:          MCPResultKind;
    nativeObservation?:      ExecutionClass;
    nativeScopeObservation?: NativeScopeObservationClass;
    operation:               ComponentConformanceOperation;
    requestDigest:           string;
    responseDigest:          string;
    /**
     * 实际返回的能力结果摘要；原结果正文不进入报告或 Core。
     */
    resultDigest?: string;
    stepKey:       string;
}

/**
 * DD-98：按同一 platform Resource ref CREATE/LOOKUP；FOUND 保留上游实际引用，不由套件预测或生成 native ID。
 */
export interface NativeScopeObservationClass {
    nativeRef?:          string;
    nativeType?:         string;
    platformResourceRef: string;
    result:              NativeScopeResult;
}

/**
 * 受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
 */
export interface ComponentConformancePlan {
    actionExecutionId:  string;
    artifactDigest:     string;
    componentReleaseId: string;
    connectorKind?:     ConnectorKind;
    contractDigests:    string[];
    /**
     * 独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
     */
    identityDigest: string;
    operationId:    string;
    planDigest:     string;
    /**
     * Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
     * Describe 与同 workflow 的当前 TaskProjection 核对。
     */
    runId:       string;
    steps:       ComponentConformancePlanStep[];
    suiteDigest: string;
    workflowId:  string;
}

export interface ComponentConformancePlanStep {
    caseKey: string;
    /**
     * 只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
     * native 任务元数据。
     */
    contractKey?: string;
    /**
     * Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
     */
    expectedHttpStatus:     number;
    expectedMcpResultKind?: MCPResultKind;
    expectedResponseJson:   string;
    idempotencyKey:         string;
    operation:              ComponentConformanceOperation;
    referenceAssetId?:      string;
    referenceFromStepKey?:  string;
    referenceResourceId?:   string;
    requestJson:            string;
    stepKey:                string;
}

/**
 * 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
 * history 承接，不建立另一执行账本。
 */
export interface ComponentConformanceProbe {
    contentReference?: ContentReferenceClass;
    plan:              PlanClass;
    /**
     * 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
     */
    reconcile?: boolean;
    stepIndex:  number;
}

export interface ComponentConformanceStepObservation {
    caseKey:                 string;
    contentReference?:       ContentReferenceClass;
    errorClass?:             ErrorClass;
    httpStatus:              number;
    mcpResultKind?:          MCPResultKind;
    nativeObservation?:      ExecutionClass;
    nativeScopeObservation?: NativeScopeObservationClass;
    operation:               ComponentConformanceOperation;
    requestDigest:           string;
    responseDigest:          string;
    /**
     * 实际返回的能力结果摘要；原结果正文不进入报告或 Core。
     */
    resultDigest?: string;
    stepKey:       string;
}

export interface ConversationProjectionRequest {
    runId:  string;
    target: ConversationProjectionRequestTarget;
}

export interface ConversationProjectionRequestTarget {
    actionExecutionId: string;
    conversationId:    string;
    workflowId:        string;
}

export interface ConversationProjectionResult {
    conversationId: string;
    status:         TaskStatus;
    waitingReason:  string;
}

export interface ConversationProjectionTarget {
    actionExecutionId: string;
    conversationId:    string;
    workflowId:        string;
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

export interface ProtocolSessionReconcileRequest {
    cancelRequested: boolean;
    round?:          RoundClass;
    runId:           string;
    target:          ProtocolSessionReconcileRequestTarget;
}

/**
 * Actual original Session snapshot. The Activity result freezes this query round into
 * history, not into a new authority.
 */
export interface RoundClass {
    sessionVersion:    number;
    state:             ProtocolSessionViewState;
    writeObservation?: WriteObservationClass;
}

/**
 * DD-90: immutable first UNKNOWN input for the original Session's one Workflow.
 */
export interface ProtocolSessionReconcileRequestTarget {
    actionDefinitionId:   string;
    actionExecutionId:    string;
    baseRevision:         string;
    bindingId:            string;
    correlationRef:       string;
    nativeObjectRef:      string;
    projectionGeneration: number;
    protocolSessionId:    string;
    releaseId:            string;
    sessionVersion:       number;
    workflowId:           string;
}

export interface ProtocolSessionReconcileResult {
    protocolSessionId: string;
    round:             RoundClass;
    status:            TaskStatus;
    waitingReason:     string;
}

/**
 * Actual original Session snapshot. The Activity result freezes this query round into
 * history, not into a new authority.
 */
export interface ProtocolSessionReconcileRound {
    sessionVersion:    number;
    state:             ProtocolSessionViewState;
    writeObservation?: WriteObservationClass;
}

/**
 * DD-90: immutable first UNKNOWN input for the original Session's one Workflow.
 */
export interface ProtocolSessionReconcileTarget {
    actionDefinitionId:   string;
    actionExecutionId:    string;
    baseRevision:         string;
    bindingId:            string;
    correlationRef:       string;
    nativeObjectRef:      string;
    projectionGeneration: number;
    protocolSessionId:    string;
    releaseId:            string;
    sessionVersion:       number;
    workflowId:           string;
}

export interface ResourceProvisionAdvanceRequest {
    cancelRequested: boolean;
    runId:           string;
    target:          ResourceProvisionAdvanceRequestTarget;
}

export interface ResourceProvisionAdvanceRequestTarget {
    actionExecutionId:    string;
    bindingId:            string;
    bindingVersion:       number;
    componentReleaseId:   string;
    nativeInstanceRef:    string;
    nativeScopeRef:       string;
    projectionGeneration: number;
    reference:            ResourceCreateClass;
    resourceId:           string;
    resourceVersion:      number;
    workflowId:           string;
}

export interface ResourceProvisionAdvanceResult {
    resourceId:    string;
    status:        TaskStatus;
    waitingReason: string;
}

export interface ResourceProvisionTarget {
    actionExecutionId:    string;
    bindingId:            string;
    bindingVersion:       number;
    componentReleaseId:   string;
    nativeInstanceRef:    string;
    nativeScopeRef:       string;
    projectionGeneration: number;
    reference:            ResourceCreateClass;
    resourceId:           string;
    resourceVersion:      number;
    workflowId:           string;
}

/**
 * TENANT_LIFECYCLE DELETE Activity 只推进已准入且已冻结的 Tenant 删除，不重新解析绑定或建立新快照。
 */
export interface TenantDeleteAdvanceRequest {
    cancelRequested: boolean;
    snapshotId:      string;
    tenantId:        string;
    tenantVersion:   number;
}

/**
 * Core 返回已经持久化的删除推进事实；UNKNOWN 由错误分类表达，不伪装为 completed 或 canceled。原生证据只保留引用。
 */
export interface TenantDeleteAdvanceResult {
    canceled:                    boolean;
    completed:                   boolean;
    irreversibleDispatchStarted: boolean;
    nativeInventoryDigest?:      string;
    nativeRequestId?:            string;
    snapshotId:                  string;
    subprocessId:                string;
}
