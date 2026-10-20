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
 * Delete selected native objects in the admitted Resource using the original
 * recycle/permanent-delete choice. Each native object identity must be independently
 * authorized and retained in the native first-dispatch claim.
 */
export interface FileStorageDeleteInput {
    nativeObjectRefs:  string[];
    removePermanently: boolean;
    resourceId:        string;
}

/**
 * Metadata-only result. Success requires all selected native identities to have linked
 * durable deletion or recycle acknowledgements; an accepted job, Finished status or absent
 * current object is not terminal evidence.
 */
export interface FileStorageDeleteOutput {
}

/**
 * Export exactly the authorized typed native file revision, including empty or non-UTF-8
 * files.
 */
export interface FileStorageExportInput {
    displayName:     string;
    mediaType:       string;
    nativeObjectRef: string;
    nativeRevision:  string;
    resourceId:      string;
}

/**
 * Immediate authorized binary result using the existing export encoding; not a persisted
 * Core blob, URL, or native credential.
 */
export interface FileStorageExportOutput {
    contentBase64: string;
    filename:      string;
    mediaType:     string;
}

/**
 * DD-89: list the source Resource through its bound native root; the client cannot supply
 * another root or native credential.
 */
export interface FileStorageListInput {
    resourceId: string;
}

/**
 * DD-89: complete native listing is transported only between components, not persisted by
 * Core. Its canonical item digest is the native listing revision, never a fabricated file
 * VersionId.
 */
export interface FileStorageListOutput {
    items:           ContentReferenceElement[];
    listingDigest:   string;
    nativeObjectRef: string;
    nativeRevision:  string;
    operationId:     string;
    resourceId:      string;
}

/**
 * design03 的唯一内容引用线格式；不是业务正文。Adapter typed 槽是传递引用的唯一来源，resultJson 不用于识别或重建引用。
 */
export interface ContentReferenceElement {
    assetId?:        string;
    displayName:     string;
    mediaType:       string;
    nativeObjectRef: string;
    nativeRevision:  string;
    resourceId:      string;
}

/**
 * List published native revisions of one UUID inside the admitted Resource's bound root; no
 * caller-supplied path or credential.
 */
export interface FileStorageListRevisionsInput {
    nativeObjectRef: string;
    resourceId:      string;
}

/**
 * Published version references from the original native version collection; also supplied
 * in the adapter's typed ContentReference slot. Not SERVICE list_output or a completion
 * receipt.
 */
export interface FileStorageListRevisionsOutput {
    citations: ContentReferenceElement[];
}

/**
 * Read the exact typed native file revision in the admitted Resource; never substitute the
 * current head.
 */
export interface FileStorageReadInput {
    displayName:     string;
    mediaType:       string;
    nativeObjectRef: string;
    nativeRevision:  string;
    resourceId:      string;
}

/**
 * Exact valid UTF-8 native bytes, disclosed only through the original result policy. Binary
 * files use export.
 */
export interface FileStorageReadOutput {
    text: string;
}

/**
 * Manage an existing native share under the admitted Resource. Revocation removes access
 * through that exact share; it neither deletes file content nor grants platform resource
 * permission. Native share identity alone is not evidence of ownership or successful
 * revocation.
 */
export interface FileStorageShareInput {
    nativeShareRef: string;
    operation:      FileStorageShareOperation;
    resourceId:     string;
}

export enum FileStorageShareOperation {
    Revoke = "REVOKE",
}

/**
 * Metadata-only share result. Revocation requires an authorized first-dispatch claim and
 * confirmed removal of the frozen native share access. An unowned missing identifier,
 * accepted request or partial native cleanup is not successful revocation.
 */
export interface FileStorageShareOutput {
}

/**
 * Apply an existing immutable native revision, or dispatch a native first-byte intent. An
 * intent is not a ContentReference: its node/revision identifiers name reserved native
 * locations only; bytes remain at the source and no result exists before the immutable
 * native ACK.
 */
export interface FileStorageWriteInput {
    contentLength?:   number;
    displayName?:     string;
    mediaType?:       string;
    multipart?:       boolean;
    nativeDeadline?:  number;
    nativeIntentId?:  string;
    nativeNodeId?:    string;
    nativeObjectRef?: string;
    nativeRevision?:  string;
    resourceId:       string;
}

/**
 * Metadata-only write result. The exact confirmed result revision belongs in the adapter's
 * typed ContentReference slot; an empty result, accepted write, or current head alone is
 * not terminal evidence.
 */
export interface FileStorageWriteOutput {
}

/**
 * Metadata-only input of the receiver native synchronization admission. Core injects the
 * read execution reference and native receiver root.
 */
export interface KnowledgeSyncInput {
    batchId:                     string;
    importConfigRef:             string;
    sourceReadActionExecutionId: string;
    sourceResourceId:            string;
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
 * 07§5.2/6.2 已停止新准入的 binding reconcile。引用原停用生命周期及冻结代次，只观察原生任务，不创建 ExternalExecution 或重放动作。
 */
export interface AdapterBindingReconcileRequest {
    bindingId:         string;
    configDigest:      string;
    generation:        number;
    idempotencyKey:    string;
    nativeInstanceRef: string;
    nativeScopeRef:    string;
}

/**
 * 完整原生枚举的同引用观察，非新的任务/结果权威。complete 只在全部原存储流正常结束后成立；部分枚举、超限或不可核验不得当空集合。observations
 * 保留所有代次的原始幂等引用，未知任务不得遗漏；Core 自行核验终态，不接收 drained 声明。
 */
export interface AdapterBindingReconcileResponse {
    complete:     boolean;
    observations: ExecutionElement[];
    reference:    ReferenceClass;
}

/**
 * ADR-12 execute/observe/cancel/reconcile 的原生观察。字段取自 design03 ExternalExecution；nativeId
 * 允许未取得，值域与具体操作的终态证据由接收者验证。取消接收仍为 RUNNING/UNKNOWN，不伪装 CANCELLED。
 */
export interface ExecutionElement {
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
 * 07§5.2/6.2 已停止新准入的 binding reconcile。引用原停用生命周期及冻结代次，只观察原生任务，不创建 ExternalExecution 或重放动作。
 */
export interface ReferenceClass {
    bindingId:         string;
    configDigest:      string;
    generation:        number;
    idempotencyKey:    string;
    nativeInstanceRef: string;
    nativeScopeRef:    string;
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
    contentReference?: ContentReferenceElement;
    /**
     * 来源 citation 的 typed 槽；与固定结果 schema 中 citations 逐项一致。它不是源正文读取证明，打开来源时重新授权。
     */
    contentReferences?: ContentReferenceElement[];
    execution:          ExecutionElement;
    resultJson?:        string;
    sourceResources?:   SourceResourceElement[];
}

/**
 * Actual native planner source within the existing execution binding. Metadata only:
 * neither SQL/content nor a grant. The original action and result-exposure authority must
 * authorize every resolved Resource.
 */
export interface SourceResourceElement {
    nativeRef:  string;
    nativeType: string;
}

/**
 * DD-48/51/94 extract_usage 的原生终态用量元数据；scope/customer/dimensions 只由 Core 原
 * ExternalExecution 决定。完整集合与冻结 action meters 精确相等，缺失不是零。
 */
export interface AdapterExecutionUsage {
    externalExecutionId: string;
    idempotencyKey:      string;
    measurements:        AdapterExecutionUsageMeasurement[];
    nativeId:            string;
    nativeType:          string;
}

export interface AdapterExecutionUsageMeasurement {
    meterKey:   string;
    occurredAt: string;
    quantity:   number;
}

/**
 * 绑定 SERVICE 领取原已派发 HUMAN COMPONENT_ACTION 的既存 native task 未消费步骤；不创建执行或延长期限。
 */
export interface NativeTaskExecutionAdmissionRequest {
    actionExecutionId: string;
    bindingId:         string;
    execution:         ExecutionClass;
    /**
     * 首次 dispatch 审计时间与冻结声明期限得出的原 RFC3339 截止时间，不接受续期。
     */
    nativeTaskDeadline: string;
}

/**
 * 原 ExternalExecution 的 observe/extract_usage 引用；不携带正文，不新建执行，不接受引用自报 scope。nativeId
 * 未取得时只用冻结幂等键查证。
 */
export interface ExecutionClass {
    externalExecutionId: string;
    idempotencyKey:      string;
    nativeId?:           string;
    nativeType:          string;
}

/**
 * 仅当次原任务执行上下文可用的票据；原生任务不得持久化票据或参数凭据。
 */
export interface NativeTaskExecutionAdmissionResponse {
    actionToken?:       string;
    argumentsJson?:     string;
    expiresAt?:         string;
    nativeTaskDeadline: string;
    state:              NativeTaskAdmissionState;
}

/**
 * 单次原生任务准入查询结果，不是新的持久任务生命周期。PENDING_REFERENCE 无票据；ADMITTED 才允许消费原任务尚未领取步骤。
 */
export enum NativeTaskAdmissionState {
    Admitted = "ADMITTED",
    PendingReference = "PENDING_REFERENCE",
}

/**
 * ADR-12
 * adapter入站fresh校验。ActionToken只瞬时校验、不入history或审计正文；参数由原ActionToken摘要绑定，binding由受认证client精确匹配。
 */
export interface AdapterPepCheckRequest {
    actionToken:       string;
    argumentsJson:     string;
    bindingId:         string;
    contentReference?: ContentReferenceElement;
    operation:         string;
    sourceResources?:  SourceResourceElement[];
}

/**
 * 只在原动作和精确binding仍被fresh授权时返回当前授权revision；不是可复用的新授权票据。
 */
export interface AdapterPepCheckResponse {
    actionExecutionId:        string;
    authorizationMinZedToken: string;
    /**
     * 原业务 AE 冻结的 component_projection_generation；由 Core 核验同 binding 后返回，不从调用方 token
     * 扩展或当前部署配置推断。缺省时原生任务不得新建代次归属。
     */
    bindingGeneration?: number;
    /**
     * 仅声明原生异步任务执行期限的 HUMAN COMPONENT_ACTION 返回；原首次 dispatch 时间加已批准声明的期限，RFC3339，不随本次 fresh
     * Check 续期。
     */
    nativeTaskDeadline?: string;
    operationId:         string;
    /**
     * 本次已授权 execute 的 Resource 与其 binding 原生引用事实；不是新授权票据。缺省时消费者不得推断对象身份。
     */
    targetResource?: AdapterAuthorizedResource;
}

/**
 * 本次已授权 execute 的 Resource 与其 binding 原生引用事实；不是新授权票据。缺省时消费者不得推断对象身份。
 */
export interface AdapterAuthorizedResource {
    nativeInstanceRef: string;
    nativeRef:         string;
    nativeScopeRef:    string;
    nativeType:        string;
    resourceId:        string;
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
    reference:                    ContentReferenceElement;
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
    method:       LaunchDescriptorMethod;
}

export enum LaunchDescriptorMethod {
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
 * DD-89: receiver binding authenticates as its own ServicePrincipal for one source-resource
 * read batch. Input is checked against the approved source action schema; Core retains its
 * digest, not the returned business content.
 */
export interface AdapterReadGrantRequest {
    actionKey:      string;
    actionVersion:  number;
    idempotencyKey: string;
    inputJson:      string;
    /**
     * Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
     * exactly one mode, freezes these references, and resolves the receiver from its
     * authenticated binding.
     */
    nativeBatch?: NativeBatch;
    /**
     * 只观察已存在的同一原生 SOURCE AE；必须匹配原 key/nativeBatch（或锚定的 receiverActionExecutionId 与
     * receiverArgumentsJson）/输入，查无或未就绪不得创建、续发 grant 或进入新准入。
     */
    observeActionExecutionId?:  string;
    receiverActionExecutionId?: string;
    receiverArgumentsJson?:     string;
    receiverBindingId:          string;
    sourceResourceId:           string;
}

/**
 * Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
 * exactly one mode, freezes these references, and resolves the receiver from its
 * authenticated binding.
 */
export interface NativeBatch {
    actionKey:          string;
    actionVersion:      number;
    batchId:            string;
    importConfigRef:    string;
    receiverResourceId: string;
}

/**
 * DD-89: short-lived source Adapter authorization, not native credentials or proof that the
 * batch finished. The endpoint is resolved from the existing controlled adapter directory.
 */
export interface AdapterReadGrantResponse {
    actionExecutionId: string;
    actionToken?:      string;
    argumentsJson?:    string;
    endpoint?:         string;
    expiresAt?:        number;
    operationId:       string;
    /**
     * Native retry observation. COMPLETED requires both immutable receipts and committed usage;
     * UNKNOWN/PENDING carry no renewed authorization.
     */
    outcome?: Outcome;
    /**
     * 仅 COMPLETED 观察返回同一 Operation 已核实的原接收方子执行引用。
     */
    receiverActionExecutionId?: string;
    /**
     * 仅 COMPLETED 观察返回原子执行冻结的 receiver generation，不是当前绑定代次。
     */
    receiverGeneration?: number;
    receiverReceipt?:    AdapterReadReceipt;
    /**
     * Separate governed receiver action in the same read Operation. The native importer must
     * perform the existing authenticated PEP check with this token immediately before its
     * write; issuance is not completion.
     */
    receiverWrite?:  ReceiverWrite;
    sourceBindingId: string;
    /**
     * 仅原生批次 COMPLETED 观察返回已保存的 SOURCE 回执；不是新的读取授权。
     */
    sourceReceipt?: AdapterReadReceipt;
}

/**
 * Native retry observation. COMPLETED requires both immutable receipts and committed usage;
 * UNKNOWN/PENDING carry no renewed authorization.
 */
export enum Outcome {
    Completed = "COMPLETED",
    Pending = "PENDING",
    Unknown = "UNKNOWN",
}

/**
 * DD-89: authenticated native source-read or completed receiver-import metadata for one
 * original SERVICE Operation; never file bodies or credentials.
 *
 * 仅原生批次 COMPLETED 观察返回已保存的 SOURCE 回执；不是新的读取授权。
 */
export interface AdapterReadReceipt {
    bindingId: string;
    /**
     * Original native RFC3339 timestamp; Core validates it without rewriting the native
     * representation.
     */
    completedAt:     string;
    contentBytes:    number;
    contentSha256:   string;
    idempotencyKey:  string;
    measurements:    AdapterReadReceiptMeasurement[];
    nativeObjectRef: string;
    nativeRevision:  string;
    operationId:     string;
    role:            ApplicationReadResourceDirection;
}

export interface AdapterReadReceiptMeasurement {
    meterKey: string;
    quantity: number;
}

export enum ApplicationReadResourceDirection {
    Receiver = "RECEIVER",
    Source = "SOURCE",
}

/**
 * Separate governed receiver action in the same read Operation. The native importer must
 * perform the existing authenticated PEP check with this token immediately before its
 * write; issuance is not completion.
 */
export interface ReceiverWrite {
    actionExecutionId: string;
    actionToken:       string;
    argumentsJson:     string;
    expiresAt:         number;
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
 * Actual native planner source within the existing execution binding. Metadata only:
 * neither SQL/content nor a grant. The original action and result-exposure authority must
 * authorize every resolved Resource.
 */
export interface AdapterSourceResource {
    nativeRef:  string;
    nativeType: string;
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
     * 仅 application_binding.create 的瞬态输入（03 §9、DD-70）：按已批准 release 的 secretSchema 逐项提交 secret
     * 值，每个 secretKey 恰好一项。Core 在同一 Governed Action 的准入通过后写入该 Tenant 的 OpenBao namespace，只把版本号记成
     * SecretRef；值不进入 Params、ActionExecution、日志、Workflow history、AuditEvent 或回应。其他命令禁止携带。
     */
    bindingSecretValues?: ActionCommandBindingSecretValue[];
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
     * 仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
     * 授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
     */
    grantPermission?: ResourceGrantPermission;
    huddleAgent?:     HuddleAgentClass;
    /**
     * 仅 huddle.agent.add / huddle.agent.remove / huddle.end 且必带（DD-125(3)）：目标
     * HuddleBuzzBinding；父 Workspace 的 Huddle 另须 workspaceId 等于其父 Workspace。
     */
    huddleId?:    string;
    huddleStart?: HuddleStartClass;
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
     * 仅 moderation.message.delete 且必带（DD-125(2)）：workspaceId 所指 Workspace Channel 中一条消息的 Relay
     * 事件 ID；Core 以 CONTROL 回读确认属于该 Channel 后签 9005，按 DD-81 以 9005 事件 ID 对账。
     */
    moderationEventId?: string;
    /**
     * 仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
     * 是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
     * CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
     * agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
     */
    moderationMember?: ActionCommandModerationMember;
    /**
     * 仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
     * conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
     * kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
     */
    moderationReport?: ActionCommandModerationReport;
    /**
     * 仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
     * ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
     */
    moderationResolution?: ActionCommandModerationResolution;
    /**
     * workspace.create 或 AgentDefinition 创建/更新的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
     */
    name?: string;
    /**
     * 任务控制只接收原 ActionExecution ID；原 Workflow、target 与 scope 由 Core 解析。Agent
     * 回合中断（task.cancel.agent.invoke.v1）的发起人可以是原发起人或该 Installation manage 持有人（DD-125(6) 扩展
     * DD-84），其余规则不变
     */
    originalActionExecutionId?: string;
    /**
     * 成员动作的目标 Principal；resource.transfer_owner 的新 owner；resource.grant_read/revoke_read 的同
     * Tenant 接收者，Core 核对真实 HUMAN 成员、原 AGENT Installation 或 receiverResource 所属 SERVICE
     */
    principalId?: string;
    /**
     * Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
     * identity; no Agent or caller-selected native credentials.
     */
    protocolSessionOpen?: ProtocolSessionOpenClass;
    /**
     * 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
     * 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
     * Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
     */
    receiverResource?: ActionCommandReceiverResource;
    resourceCreate?:   ResourceCreateClass;
    /**
     * Resource 管理动作的目标；Core 重新核对同 Tenant、scope、owner 和投影。agent.installation.disable /
     * agent.installation.enable（DD-125(6)、05 §2.11）只带 resourceId、resourceVersion 与
     * explicitConfirmation=true：目标 Workspace 由 Installation 的 home Workspace
     * 解析（TARGET_HOME_WORKSPACE），不接受 workspaceId、assetId 或其他参数；原“重启”是 assetId 等于固定 Version 的
     * agent.installation.upgrade
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
    tenantId?: string;
    /**
     * 仅 tenant.quota.set（DD-123）
     */
    tenantQuotaSetting?: TenantQuotaSettingClass;
    /**
     * 仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
     * explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
     */
    workspaceCanvas?:  WorkspaceCanvasClass;
    workspaceChannel?: WorkspaceChannelClass;
    /**
     * Workspace 内动作的执行 Workspace
     */
    workspaceId?: string;
    /**
     * 仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
     * 或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
     */
    workspaceUpdate?: WorkspaceUpdateClass;
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
 * DD-88/94：pin 已批准 release 的业务绑定选择。不接受密钥正文、调用方自选 SecretRef 或运行端点 URL；secret 值只经同一
 * ActionCommand 的瞬态 bindingSecretValues 提交（03 §9）。Workspace 取原 ActionCommand。
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
    /**
     * 必须为空数组。binding 的 SecretRef 只由 Core 在本动作内把 bindingSecretValues 写入该 Tenant OpenBao
     * namespace 的 application-binding/<bindingId>/<secretKey> 后按返回版本生成；调用方提供的 locator/version
     * 一律拒绝（03 §9，不以运维旁路写入的 KV 冒充受治理写入）。
     */
    secretRefs:         ApplicationBindingCreateSecretRef[];
    servicePrincipalId: string;
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
 * REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval/calendar，不含触发消息正文、provider
 * 配置或凭据。
 */
export interface AutomationVersionContentClass {
    action?:         AutomationVersionContentAction;
    approvalPolicy?: ApprovalPolicyElement;
    /**
     * 固定 Buzz WorkflowDef 的可选说明；随原不可变版本和 config_hash 冻结。旧版本缺省不补写，空值与空白沿原 YAML 保留。
     */
    description?: string;
    /**
     * 2保留历史单副作用步骤；3为有序多消息。旧单 action 格式缺省保持原摘要。
     */
    formatVersion?: number;
    /**
     * 原工作流名称；随不可变版本冻结。旧版本缺省不补写、不重算历史摘要。
     */
    name?:        string;
    resultTarget: AutomationResultTarget;
    /**
     *
     * 不可与旧action混用。格式3逐条发送消息并查证原生回执，支持消息间Delay及首副作用前一个原策略审批；UNKNOWN不推进。步骤审批不可同时声明版本级approvalPolicy。其余原动作仍在恢复范围。
     */
    steps?:  StepElement[];
    trigger: AutomationVersionContentTrigger;
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
 *
 * request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
 */
export interface ApprovalPolicyElement {
    id:      string;
    version: number;
}

export enum AutomationResultTarget {
    Channel = "CHANNEL",
    TriggerThread = "TRIGGER_THREAD",
}

/**
 * 原 Buzz 有序步骤的已接通动作；步骤执行和延时仍归 Temporal。call_webhook 需要工作区管理权限（原
 * requires_elevated_authority），保存与每次运行均重新核验。其它原动作不由此宣称已实现。
 */
export interface StepElement {
    action: ActionEnum;
    /**
     * request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
     */
    approvalPolicy?: ApprovalPolicyElement;
    /**
     * 原请求体模板；不保存响应正文。
     */
    body?:     string;
    duration?: string;
    /**
     * 原 buzz-sdk build_reaction 的字符上限；目标仅为该次真实触发消息。
     */
    emoji?: string;
    /**
     * 原附加请求头，值可含原模板变量。凭据类请求头（Authorization、Cookie，以及名称含 token/secret/password/api-key/apikey
     * 者）不得明文保存，必须改用 secretHeaders。
     */
    headers?: { [key: string]: string };
    id:       string;
    /**
     * 固定 Buzz Step.if 的 evalexpr 条件，原 4096 UTF-8
     * 字节上限；为假时跳过该步骤（不失败）。只允许引用触发变量（trigger_text/author/channel_id/timestamp/emoji/message_id/is_reply），引用步骤输出在定义校验时以
     * CAPABILITY_BLOCKED 拒绝。Kailo 在 automation.run 准入时按已验签触发事件一次求值并把跳过集合冻结进该
     * ActionExecution；求值错误使该运行在任何副作用前失败。
     */
    if?:      string;
    message?: string;
    /**
     * 原 HTTP 方法，缺省 POST。
     */
    method?: StepMethod;
    name?:   string;
    /**
     * Kailo 治理：请求头密钥只以同 Tenant OpenBao SecretRef 保存，Core 仅在派发时读取 field=value
     * 注入请求，不写入版本、参数、审计或轨迹。名称不得与 headers 重复（不区分大小写）。
     */
    secretHeaders?: { [key: string]: SecretHeaderValue };
    text?:          string;
    /**
     * 固定 Buzz Step.timeout_secs。Delay 由原 AgentTask 的独立 Temporal Timer
     * 执行；send_message/add_reaction/set_channel_topic/call_webhook 由 Core
     * 自本运行首次到达该步骤起计时，截止前未派发则以 STEP_TIMEOUT 失败，已派发的结果走既有对账（不明记 UNKNOWN，不重放）；call_webhook
     * 的单次请求另受原 10 秒上限。缺省保持既有版本行为，不给历史补写默认值。
     */
    timeout_secs?: number;
    /**
     * 原频道主题；空字符串清空主题，不改变频道名称、描述或成员。
     */
    topic?: string;
    /**
     * 固定 Buzz ActionDef::CallWebhook.url：公网 HTTPS
     * 端点。scheme、主机与端口必须是字面值（原模板变量只可出现在路径与查询中），不得含用户信息。Core 每次派发前按 DNS 结果拒绝非全局单播地址，并只经
     * AgentGateway 出站，不跟随重定向。
     */
    url?: string;
}

export enum ActionEnum {
    AddReaction = "add_reaction",
    CallWebhook = "call_webhook",
    Delay = "delay",
    RequestApproval = "request_approval",
    SendMessage = "send_message",
    SetChannelTopic = "set_channel_topic",
}

/**
 * 原 HTTP 方法，缺省 POST。
 */
export enum StepMethod {
    Delete = "DELETE",
    Get = "GET",
    Patch = "PATCH",
    Post = "POST",
    Put = "PUT",
}

/**
 * 同 Tenant OpenBao KV v2 的精确版本引用（DD-70）；只是 locator，不含密钥正文。audience 必须是 Core 的服务身份。
 */
export interface SecretHeaderValue {
    audience: string;
    locator:  string;
    version:  number;
}

export interface AutomationVersionContentTrigger {
    /**
     * 固定 Buzz TriggerDef::ReactionAdded.emoji；仅 REACTION_ADDED，可选，精确匹配原回应内容。
     */
    emoji?: string;
    /**
     * 固定 Buzz evalexpr 消息触发条件；CHANNEL_MESSAGE/MENTION/DIFF_POSTED/REACTION_ADDED（DIFF_POSTED
     * 为同频道 kind:40008，与消息触发同一组变量；REACTION_ADDED 另有 trigger_emoji 与被回应消息 trigger_message_id），原
     * 4096 UTF-8 字节上限。只匹配已验签且当前准入 HUMAN 事件；错误不匹配，不持久化触发正文。旧 textPrefix 若同时存在则均须满足。
     */
    filter?:             string;
    kind:                AutomationTriggerKind;
    mentionPrincipalId?: string;
    scheduleSpec?:       ScheduleSpecClass;
    textPrefix?:         string;
}

export enum AutomationTriggerKind {
    ChannelMessage = "CHANNEL_MESSAGE",
    DiffPosted = "DIFF_POSTED",
    Mention = "MENTION",
    ReactionAdded = "REACTION_ADDED",
    Schedule = "SCHEDULE",
    Webhook = "WEBHOOK",
}

/**
 * Temporal 原生 Schedule：显式 interval 或 Buzz UTC cron，二者互斥。catchupWindow 不小于原生的 10 秒，Overlap
 * 固定 SKIP。
 */
export interface ScheduleSpecClass {
    catchupWindowSeconds: number;
    /**
     * 原 Buzz UTC cron：表单五字段，YAML 六字段包含秒、七字段增加年份；匹配由 Temporal 原生日历执行，不建立本地定时器。
     */
    cron?:         string;
    everySeconds?: number;
    /**
     * 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
     */
    kind?:          ScheduleSpecKind;
    offsetSeconds?: number;
}

/**
 * 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
 */
export enum ScheduleSpecKind {
    Cron = "CRON",
    Interval = "INTERVAL",
}

export interface ActionCommandBindingSecretValue {
    secretKey: string;
    value:     string;
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
 * Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。inputReference 或 inputJson 恰一：前者保持持久
 * ContentReference，后者是原登记能力 inputSchema 的规范化元数据参数，不把 SQL、提示或结果正文写入 Core/Temporal。Core
 * 仍校验原目标、能力 schema、审批和用量。
 */
export interface ComponentActionClass {
    actionVersion: number;
    /**
     * Canonical JSON for the existing registered capability input schema; mutually exclusive
     * with inputReference, validated before AE admission.
     */
    inputJson?:                  string;
    inputReference?:             ContentReferenceElement;
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
    /**
     * DD-126(5)：续签时被替换的本人 Grant；与 renewsDelegationVersion 成对出现，缺省为新授予。
     */
    renewsDelegationId?: string;
    /**
     * DD-126(5)：被替换 Grant 的当前 version（CAS）。
     */
    renewsDelegationVersion?: number;
    scopes:                   ScopeElement[];
    validFrom:                Date;
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
 * 仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
 * 授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
 */
export enum ResourceGrantPermission {
    Consume = "consume",
    Discover = "discover",
    Execute = "execute",
    Read = "read",
}

/**
 * 仅 huddle.agent.add / huddle.agent.remove（DD-125(3)）且必带，目标 Huddle 由 ActionCommand.huddleId
 * 给出。加入要求父 Workspace 中 ACTIVE、有 ChannelAgentBinding 且本人有 execute 的 Installation，Tenant
 * CONTROL 以 9000 role=bot 投影并回读；移除另接受父 Workspace manage，CONTROL 以 9001 移出并回读。私聊父的 Huddle 没有
 * Agent。
 */
export interface HuddleAgentClass {
    agentInstallationResourceId: string;
}

/**
 * 仅 huddle.start（DD-125(3)、05 §2.11）且必带：在父 Workspace 或父私聊中发起原版 Huddle。parentWorkspaceId 与
 * parentConversationId 恰有一个：前者要求执行 Workspace 即该 Workspace（discover），后者要求本人是该私聊当前参与者。Core
 * 预分配 HuddleBuzzBinding 与临时 Channel UUID，由 Tenant CONTROL 以带 creator 的
 * 9007（private、stream、ttl=3600）投影临时频道，并以 9000 role=bot 加入所选 Agent；私聊父不接受
 * Agent。creatorPubkey 是本人发起会话的 ACTIVE HUMAN 公钥（原生端为该设备 CLIENT 公钥），省略即本人 SERVER
 * 公钥（Web）；它是临时频道的 created_by，也是唯一可签 48100/48106 的公钥。
 */
export interface HuddleStartClass {
    /**
     * 原 Add agents 所选 Agent（至多 20 个，沿原 MAX_HUDDLE_AGENTS）：父 Workspace 中 ACTIVE、有
     * ChannelAgentBinding 且本人有 execute 的 Installation
     */
    agentInstallationResourceIds?: string[];
    /**
     * 原 buildHuddleChannelName 生成的临时频道名
     */
    channelName: string;
    /**
     * 64 位小写十六进制 Nostr 公钥；省略即本人 SERVER 公钥
     */
    creatorPubkey?: string;
    /**
     * 父私聊（ConversationBuzzBinding id）
     */
    parentConversationId?: string;
    /**
     * 父 Workspace；须等于 ActionCommand.workspaceId
     */
    parentWorkspaceId?: string;
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
 * 仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
 * 是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
 * CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
 * agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
 */
export interface ActionCommandModerationMember {
    /**
     * 64 位小写十六进制 Nostr 公钥
     */
    targetPubkey:     string;
    timeoutDuration?: ModerationTimeoutDuration;
}

/**
 * 原禁言时长预设（moderation/lib/timeout.ts::TIMEOUT_PRESETS：1 小时、24 小时、7 天）。到期时刻由 Core
 * 在准入时以数据库时钟冻结，不接受调用方给出的绝对时刻（DD-125(2)）。
 */
export enum ModerationTimeoutDuration {
    OneDay = "ONE_DAY",
    OneHour = "ONE_HOUR",
    SevenDays = "SEVEN_DAYS",
}

/**
 * 仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
 * conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
 * kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
 */
export interface ActionCommandModerationReport {
    /**
     * 消息所在私聊；本人须为其当前参与者
     */
    conversationId?: string;
    /**
     * 被举报消息的 Relay 事件 ID（64 位小写十六进制）
     */
    eventId: string;
    /**
     * 原“补充说明（可选）”，至多 1000 字符
     */
    note?:      string;
    reportType: ModerationReportType;
    /**
     * 消息所在 Workspace Channel；本人须为其当前成员
     */
    workspaceId?: string;
}

/**
 * 原 Buzz NIP-56 举报类型（buzz-relay handlers/report.rs::REPORT_TYPES，SF-BUZ-52）。线格式即 kind 1984
 * 目标标签第三元素，Relay 只接受这七个值（DD-125(2)）。
 */
export enum ModerationReportType {
    Illegal = "illegal",
    Impersonation = "impersonation",
    Malware = "malware",
    Nudity = "nudity",
    Other = "other",
    Profanity = "profanity",
    Spam = "spam",
}

/**
 * 仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
 * ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
 */
export interface ActionCommandModerationResolution {
    reportEventIds:   string[];
    resolutionAction: ModerationResolutionAction;
    status:           ModerationResolutionStatus;
}

/**
 * 审核队列可提交的 kind 9044 action 标签（原 settings/lib/moderationQueue.ts::resolvableActions）。9044
 * 只记决定、不执法；delete/kick/ban 须先经各自受治理动作执法（DD-125(2)）。原队列不提供禁言，因此不含 timeout。
 */
export enum ModerationResolutionAction {
    Ban = "ban",
    Delete = "delete",
    Dismiss = "dismiss",
    Escalate = "escalate",
    Kick = "kick",
}

/**
 * kind 9044 的 status 标签（moderation_commands.rs，SF-BUZ-52）：dismiss 只与 dismissed 配对，其余处理一律
 * resolved。
 */
export enum ModerationResolutionStatus {
    Dismissed = "dismissed",
    Resolved = "resolved",
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
    reference:            ContentReferenceElement;
    theme:                Theme;
}

/**
 * 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
 * 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
 * Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
 */
export interface ActionCommandReceiverResource {
    id:      string;
    version: number;
}

export interface ResourceCreateClass {
    evidenceDigest: string;
    evidenceRef:    string;
    nativeRef:      string;
    nativeType:     string;
    typeKey:        string;
}

/**
 * 仅 tenant.quota.set（DD-123）
 *
 * DD-123: tenant.quota.set parameters. Writes only the Tenant Customer's hard-limit
 * OpenMeter entitlement for the platform feature, resetting monthly.
 */
export interface TenantQuotaSettingClass {
    feature:        TenantQuotaFeature;
    limitPerPeriod: number;
}

export enum TenantQuotaFeature {
    AgentMemoryWrites = "agent_memory_writes",
    AgentTokens = "agent_tokens",
    AutomationRuns = "automation_runs",
}

/**
 * 仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
 * explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
 *
 * 仅 workspace.canvas.set（DD-125(4)、05 §2.11）的瞬态输入：原频道 Canvas 的 Markdown 正文（SF-BUZ-54，UTF-8
 * 不超过 64 KiB，空串即原“清空”）。Core 只用它签 Tenant CONTROL 的 kind 40100 并按 DD-81 对账；正文不进入
 * Params、ActionExecution、审计、日志或 Workflow history，只冻结其 SHA-256 与字节数，同一幂等键重发须携带同一正文。
 */
export interface WorkspaceCanvasClass {
    content: string;
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
 * 仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
 * 或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
 *
 * workspace.update 的冻结目标状态（DD-119）。至少给出 name、description、ttlSeconds/clearTtl、visibility
 * 之一，或只给 reopen=true；省略的字段保持不变。Core 在 Admission 校验组合，空集、ttlSeconds 与 clearTtl 同时出现、reopen
 * 与其他字段混用或取 false 均以 INVALID_PARAMETERS 拒绝。stream/forum 类型只在创建时设定，不可编辑；slug 不变。
 */
export interface WorkspaceUpdateClass {
    /**
     * 只能为 true：清除 TTL 改为长期频道（原 9002 空 ttl 标签）；与 ttlSeconds 互斥。
     */
    clearTtl?: boolean;
    /**
     * 原 9002 about；空字符串清空描述。
     */
    description?: string;
    /**
     * 新的频道与 Workspace 显示名；CONTROL 9002 回读 39000 一致后才在同一事务提交 Core 的 Workspace 名称。
     */
    name?: string;
    /**
     * 只能为 true 且单独出现：解档被原生 reaper 按 TTL 到期归档的 Channel。要求 Workspace ACTIVE、回读 archived=true 且设有
     * TTL，CONTROL 发 archived=false 后回读确认；主动归档仍用 workspace.suspend/restore。
     */
    reopen?: boolean;
    /**
     * 设置原 Buzz 临时频道的不活跃期限（秒）。
     */
    ttlSeconds?: number;
    /**
     * 只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
     */
    visibility?: WorkspaceVisibility;
}

/**
 * 只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
 *
 * DD-80 的产品可见性：open 仅指同 Tenant 成员可发现并经 Core 加入；Relay 投影始终 private。
 *
 * 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
 *
 * Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
 */
export enum WorkspaceVisibility {
    Open = "open",
    Private = "private",
}

/**
 * POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
 * 必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite
 * 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。webhookSecret 同理，只在生成或轮换 WEBHOOK 密钥的 automation.enable /
 * automation.rotate_webhook_secret 首次回应中出现（DD-116）。
 */
export interface ActionSubmission {
    actionExecutionId:   string;
    actionKey:           string;
    approvalWorkflowId?: string;
    dispatchState:       ActionDispatchState;
    documentLaunch?:     LaunchDescriptorClass;
    gateState:           ActionGateState;
    /**
     * 仅 huddle.start（DD-125(3)）：Core 预分配的 HuddleBuzzBinding；同一幂等键的重放给出同一值
     */
    huddleId?:          string;
    invitation?:        InvitationClass;
    operationId:        string;
    protocolSessionId?: string;
    reason?:            ReasonCode;
    webhookSecret?:     WebhookSecretClass;
    workflowId?:        string;
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
    DelegationRenewalRequired = "DELEGATION_RENEWAL_REQUIRED",
    DelegationRequired = "DELEGATION_REQUIRED",
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
    StepTimeout = "STEP_TIMEOUT",
    SurfaceCapabilityUnavailable = "SURFACE_CAPABILITY_UNAVAILABLE",
    TargetNotFound = "TARGET_NOT_FOUND",
    TargetStateConflict = "TARGET_STATE_CONFLICT",
    TenantMembershipNotActive = "TENANT_MEMBERSHIP_NOT_ACTIVE",
    TenantNotActive = "TENANT_NOT_ACTIVE",
    TenantSelectionNotAvailable = "TENANT_SELECTION_NOT_AVAILABLE",
    WaitingApproval = "WAITING_APPROVAL",
}

/**
 * DD-116：WEBHOOK 触发密钥的唯一一次明文交付。只出现在生成或轮换该密钥的那次 ActionSubmission 中；之后只给出
 * AutomationView.webhookSecretHint。投递方用它按 Standard Webhooks 对
 * `{webhook-id}.{webhook-timestamp}.{正文}` 计算 HMAC-SHA256。
 */
export interface WebhookSecretClass {
    automationResourceId: string;
    hint:                 string;
    /**
     * 32 字节随机密钥的 base64 展示形式。
     */
    secret: string;
    /**
     * 公开投递地址；部署未配置公开基址时省略。
     */
    url?: string;
}

/**
 * GET /api/v1/workspaces/{workspaceId}/agent-turns（DD-125(6)）：已准入 Workspace 内本人持有
 * Installation audit 的运行中回合；没有 audit 的 Installation 不出现（成员只见 20002）。每次读取写 ACCESS 审计。
 */
export interface AgentActiveTurnPage {
    turns:       ActiveTurnElement[];
    workspaceId: string;
}

/**
 * DD-125(6)、17 §8：一个仍在运行的 Agent 回合（Invocation DISPATCHING/RUNNING）。只对该 Installation
 * Resource audit 持有人呈现（回合开始时刻、活动入口与中断）；其他成员只见 Agent 20002 的工作中信号。读取写 ACCESS 审计。
 */
export interface ActiveTurnElement {
    /**
     * Installation 的 ACTIVE AGENT 公钥，供原工作中 Agent 行匹配资料与 20002。
     */
    agentPubkey?: string;
    /**
     * DD-84 取消控制键（task.cancel.agent.invoke.v1）：本人是原发起人或持有该 Installation manage、控制定义 ACTIVE 且原
     * Workflow 仍 OPEN 时给出。省略即不显示中断；提交仍完整重新准入。
     */
    cancelActionKey?: string;
    installationId:   string;
    invocationId:     string;
    /**
     * 该回合的 agent.invoke ActionExecution；中断时作为 DD-84 取消控制的 originalActionExecutionId。
     */
    originalActionExecutionId: string;
    projectionGeneration:      number;
    /**
     * AgentSession 根引用。
     */
    rootEventId: string;
    /**
     * 原生 turn 开始时刻（RFC3339，取自 Codex turn startedAt）；不可查证时省略，不以本机时钟代替。
     */
    startedAt?: string;
    /**
     * AgentSession 的原生 thread ID。
     */
    threadId?: string;
    /**
     * 已记录的原生 turn ID；派发结果尚未记录时省略。
     */
    turnId?: string;
}

/**
 * DD-125(6)、17 §8：一个仍在运行的 Agent 回合（Invocation DISPATCHING/RUNNING）。只对该 Installation
 * Resource audit 持有人呈现（回合开始时刻、活动入口与中断）；其他成员只见 Agent 20002 的工作中信号。读取写 ACCESS 审计。
 */
export interface AgentActiveTurnView {
    /**
     * Installation 的 ACTIVE AGENT 公钥，供原工作中 Agent 行匹配资料与 20002。
     */
    agentPubkey?: string;
    /**
     * DD-84 取消控制键（task.cancel.agent.invoke.v1）：本人是原发起人或持有该 Installation manage、控制定义 ACTIVE 且原
     * Workflow 仍 OPEN 时给出。省略即不显示中断；提交仍完整重新准入。
     */
    cancelActionKey?: string;
    installationId:   string;
    invocationId:     string;
    /**
     * 该回合的 agent.invoke ActionExecution；中断时作为 DD-84 取消控制的 originalActionExecutionId。
     */
    originalActionExecutionId: string;
    projectionGeneration:      number;
    /**
     * AgentSession 根引用。
     */
    rootEventId: string;
    /**
     * 原生 turn 开始时刻（RFC3339，取自 Codex turn startedAt）；不可查证时省略，不以本机时钟代替。
     */
    startedAt?: string;
    /**
     * AgentSession 的原生 thread ID。
     */
    threadId?: string;
    /**
     * 已记录的原生 turn ID；派发结果尚未记录时省略。
     */
    turnId?: string;
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
 * 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。state 是持久记录；effectiveState 是
 * DD-126(4) 的只读投影，只有它为 ACTIVE 时 Grant 才真实可用（仍不证明当次 permission）。
 */
export interface GrantElement {
    delegationId:      string;
    delegationVersion: number;
    /**
     * DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
     * Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
     * 按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
     */
    effectiveState:     DelegationEffectiveState;
    grantorPrincipalId: string;
    parameters:         DelegationGrantClass;
    state:              GrantState;
    /**
     * DD-126(5)：state=SUPERSEDED 时替换本 Grant 的续签 Grant。
     */
    supersededByDelegationId?: string;
    uses:                      number;
}

/**
 * DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
 * Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
 * 按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
 */
export enum DelegationEffectiveState {
    Active = "ACTIVE",
    Expired = "EXPIRED",
    NeedsRenewal = "NEEDS_RENEWAL",
    NotYetValid = "NOT_YET_VALID",
    Revoked = "REVOKED",
    Revoking = "REVOKING",
    Superseded = "SUPERSEDED",
    UsesExhausted = "USES_EXHAUSTED",
}

export enum GrantState {
    Active = "ACTIVE",
    Expired = "EXPIRED",
    Revoked = "REVOKED",
    Revoking = "REVOKING",
    Superseded = "SUPERSEDED",
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
 * 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。state 是持久记录；effectiveState 是
 * DD-126(4) 的只读投影，只有它为 ACTIVE 时 Grant 才真实可用（仍不证明当次 permission）。
 */
export interface AgentDelegationView {
    delegationId:      string;
    delegationVersion: number;
    /**
     * DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
     * Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
     * 按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
     */
    effectiveState:     DelegationEffectiveState;
    grantorPrincipalId: string;
    parameters:         DelegationGrantClass;
    state:              GrantState;
    /**
     * DD-126(5)：state=SUPERSEDED 时替换本 Grant 的续签 Grant。
     */
    supersededByDelegationId?: string;
    uses:                      number;
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
    /**
     * 17 §3：固定 Version personaIdentity 的展示名，经同一 Installation Resource read
     * 准入；只供提及与成员目录呈现，不授予执行或 Definition 读取。旧服务缺省时调用方回退到原 Definition 读取。
     */
    agentDisplayName?:   string;
    agentPrincipalId:    string;
    agentPrincipalState: AgentPrincipalState;
    /**
     * 原 Installation 的 ACTIVE AGENT BuzzIdentityBinding 公开公钥；经相同 Resource read 准入，仅供原 Inbox
     * owner/作者匹配，不授予执行或签名权限。旧服务缺省不证明身份映射。
     */
    agentPubkey?:    null | string;
    agentResourceId: string;
    /**
     * 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
     * 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
     * 准入。缺失或空集合不支持 Schedule。
     */
    automationResultTargets?: AutomationResultTarget[];
    /**
     * DD-125(6)、17 §8：本人 fresh Installation Resource audit 允许读取会话转写、实时 item
     * 与运行中回合（受审计敏感读取）。false 或缺省时只呈现 20002 工作中信号。
     */
    canAudit?: boolean;
    /**
     * DD-125(6)、05 §2.11：原“停止 / 从频道移除 / 删除”入口。动作目录开放 agent.installation.disable、安装 ACTIVE
     * 且没有未终结投影、本人 fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与
     * explicitConfirmation。不代表已准入，旧服务缺省不显示。
     */
    canDisable?: boolean;
    /**
     * DD-125(6)：原“启动”入口。目录开放 agent.installation.enable、安装 DISABLED、固定 Version 仍 PUBLISHED、本人
     * fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与 explicitConfirmation。
     */
    canEnable?: boolean;
    /**
     * DD-125(6)、DD-122(4)：原“重启”入口，即对固定 Version 的同版本
     * agent.installation.upgrade（assetId=pinnedVersionAssetId）。canUpgrade 成立且固定 Version 仍
     * PUBLISHED 时为 true；仍沿升级审批与排空。
     */
    canRestart?: boolean;
    /**
     * 当前 ACTIVE 安装可按原 manage 权限申请已发布目标版本；仍须原治理审批，不代表升级已经准入。旧服务缺省不显示入口。
     */
    canUpgrade?:          boolean;
    channelBinding?:      InstallationChannelBinding;
    executionPermission?: InstallationExecutionPermission;
    ownerPrincipalId:     string;
    pinnedVersionAssetId: string;
    projection?:          ProjectionClass;
    readPermission?:      InstallationReadPermission;
    resourceId:           string;
    resourceState:        ResourceState;
    resourceVersion:      number;
    state:                AgentInstallationState;
    workspaceId:          string;
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
 * DD-122: the tools an Agent Installation's current generation requests and their effective
 * state. Read-only; grants happen only through installation create/upgrade.
 */
export interface AgentInstallationToolPage {
    generation:             number;
    installationResourceId: string;
    tools:                  AgentInstallationToolView[];
}

export interface AgentInstallationToolView {
    applicationBindingId?: string;
    bindingStatus:         AgentToolBindingStatus;
    /**
     * APPLICATION only: the requested capability contract key@version.
     */
    capabilityRequirement?: string;
    name?:                  string;
    reasonCode?:            ReasonCode;
    source:                 AgentInstallationToolSource;
    /**
     * Absent when an application capability requirement has no resolved provider yet.
     */
    toolResourceId?: string;
}

export enum AgentToolBindingStatus {
    Active = "ACTIVE",
    NoPermission = "NO_PERMISSION",
    Pending = "PENDING",
    Revoked = "REVOKED",
}

export enum AgentInstallationToolSource {
    Application = "APPLICATION",
    PlatformNative = "PLATFORM_NATIVE",
}

/**
 * 05 §2.10、17 §8：一个 Agent Installation 在其 Workspace 的成员使用权目录。requested 是该成员显式持有
 * reader/executor/delegator 三项关系；effective 是 fresh read/execute/delegate 全部允许（含 owner/admin
 * 既有权限）。canGrant/canRevoke 只说明当前查看者可提交对应受治理请求，不代表请求已准入。
 */
export interface AgentInstallationUsePage {
    installationId:            string;
    members:                   Member[];
    pendingActionExecutionId?: string;
    resourceVersion:           number;
    /**
     * DD-125(6)：原 respondTo 在本页的映射。至少一名成员 requested=true 即 ALLOWLIST，否则 OWNER_ONLY；切换只经逐成员
     * agent.installation.use.grant/revoke，不存在 anyone。旧服务缺省时客户端按 members 推导。
     */
    respondTo?: AgentRespondToMode;
}

export interface Member {
    canGrant:    boolean;
    canRevoke:   boolean;
    displayName: string;
    effective:   boolean;
    principalId: string;
    requested:   boolean;
}

/**
 * DD-125(6)：原 respondTo 在本页的映射。至少一名成员 requested=true 即 ALLOWLIST，否则 OWNER_ONLY；切换只经逐成员
 * agent.installation.use.grant/revoke，不存在 anyone。旧服务缺省时客户端按 members 推导。
 *
 * 原 Buzz respondTo 在 Kailo 的映射（DD-125(6)、05 §2.10）：OWNER_ONLY ≙ 默认（只有 owner、Workspace
 * manage 与 Tenant manage 持有使用权），ALLOWLIST ≙ 至少一名成员经 agent.installation.use.grant 显式授予。原
 * anyone 不提供：频道成员关系不推导业务 Resource permission（10 §3）。
 */
export enum AgentRespondToMode {
    Allowlist = "ALLOWLIST",
    OwnerOnly = "OWNER_ONLY",
}

/**
 * 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
 * 正文、执行或管理权限。
 */
export interface AgentInstallationView {
    activeProjectionGeneration?: number;
    /**
     * 17 §3：固定 Version personaIdentity 的展示名，经同一 Installation Resource read
     * 准入；只供提及与成员目录呈现，不授予执行或 Definition 读取。旧服务缺省时调用方回退到原 Definition 读取。
     */
    agentDisplayName?:   string;
    agentPrincipalId:    string;
    agentPrincipalState: AgentPrincipalState;
    /**
     * 原 Installation 的 ACTIVE AGENT BuzzIdentityBinding 公开公钥；经相同 Resource read 准入，仅供原 Inbox
     * owner/作者匹配，不授予执行或签名权限。旧服务缺省不证明身份映射。
     */
    agentPubkey?:    null | string;
    agentResourceId: string;
    /**
     * 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
     * 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
     * 准入。缺失或空集合不支持 Schedule。
     */
    automationResultTargets?: AutomationResultTarget[];
    /**
     * DD-125(6)、17 §8：本人 fresh Installation Resource audit 允许读取会话转写、实时 item
     * 与运行中回合（受审计敏感读取）。false 或缺省时只呈现 20002 工作中信号。
     */
    canAudit?: boolean;
    /**
     * DD-125(6)、05 §2.11：原“停止 / 从频道移除 / 删除”入口。动作目录开放 agent.installation.disable、安装 ACTIVE
     * 且没有未终结投影、本人 fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与
     * explicitConfirmation。不代表已准入，旧服务缺省不显示。
     */
    canDisable?: boolean;
    /**
     * DD-125(6)：原“启动”入口。目录开放 agent.installation.enable、安装 DISABLED、固定 Version 仍 PUBLISHED、本人
     * fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与 explicitConfirmation。
     */
    canEnable?: boolean;
    /**
     * DD-125(6)、DD-122(4)：原“重启”入口，即对固定 Version 的同版本
     * agent.installation.upgrade（assetId=pinnedVersionAssetId）。canUpgrade 成立且固定 Version 仍
     * PUBLISHED 时为 true；仍沿升级审批与排空。
     */
    canRestart?: boolean;
    /**
     * 当前 ACTIVE 安装可按原 manage 权限申请已发布目标版本；仍须原治理审批，不代表升级已经准入。旧服务缺省不显示入口。
     */
    canUpgrade?:          boolean;
    channelBinding?:      AgentInstallationViewChannelBinding;
    executionPermission?: AgentInstallationViewExecutionPermission;
    ownerPrincipalId:     string;
    pinnedVersionAssetId: string;
    projection?:          ProjectionClass;
    readPermission?:      AgentInstallationViewReadPermission;
    resourceId:           string;
    resourceState:        ResourceState;
    resourceVersion:      number;
    state:                AgentInstallationState;
    workspaceId:          string;
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
 * 原 Session 同 generation 调用元事实，逐页 fresh Installation read，且仅本人发起或实际 AE 目标 audit 允许；不返回
 * prompt、tool result、reasoning、凭据或成本。未授权项过滤后空页仍可能有 nextCursor。
 */
export interface AgentInvocationPage {
    invocations: InvocationElement[];
    nextCursor?: string;
}

/**
 * 原 AgentInvocation 持久状态，不替代 Temporal。observation 或 UNKNOWN 时不得渲染为成功/失败；cancelPending
 * 不等于已取消；createdAt/updatedAt 是 Core 记录时间，不是假造的原生事件时间。
 */
export interface InvocationElement {
    actionExecutionId: string;
    cancelPending:     boolean;
    /**
     * 当前 HUMAN 是否为原任务发起人。仅控制任务详情入口；任务读取仍执行自身实时授权。
     */
    canReadTask: boolean;
    /**
     * Core 记录的 RFC3339 时间字符串，按原线格式传输。
     */
    createdAt:      string;
    invocationId:   string;
    observation?:   ReasonCode;
    runtimeTurnId?: string;
    status:         InvocationStatus;
    /**
     * Core 记录的 RFC3339 时间字符串，按原线格式传输。
     */
    updatedAt: string;
}

export enum InvocationStatus {
    Canceled = "CANCELED",
    Completed = "COMPLETED",
    Created = "CREATED",
    Dispatching = "DISPATCHING",
    Failed = "FAILED",
    Running = "RUNNING",
    Unknown = "UNKNOWN",
}

/**
 * 原 AgentInvocation 持久状态，不替代 Temporal。observation 或 UNKNOWN 时不得渲染为成功/失败；cancelPending
 * 不等于已取消；createdAt/updatedAt 是 Core 记录时间，不是假造的原生事件时间。
 */
export interface AgentInvocationView {
    actionExecutionId: string;
    cancelPending:     boolean;
    /**
     * 当前 HUMAN 是否为原任务发起人。仅控制任务详情入口；任务读取仍执行自身实时授权。
     */
    canReadTask: boolean;
    /**
     * Core 记录的 RFC3339 时间字符串，按原线格式传输。
     */
    createdAt:      string;
    invocationId:   string;
    observation?:   ReasonCode;
    runtimeTurnId?: string;
    status:         InvocationStatus;
    /**
     * Core 记录的 RFC3339 时间字符串，按原线格式传输。
     */
    updatedAt: string;
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
 * DD-121: only agent.invoke executions initiated by the caller for the requested source
 * events; no message body, no other member's executions, no Agent internals. A mentioned
 * Agent without an outcome is still PENDING (not yet scanned).
 */
export interface AgentMentionOutcomePage {
    outcomes: AgentMentionOutcomeView[];
}

export interface AgentMentionOutcomeView {
    eventId:        string;
    installationId: string;
    reasonCode?:    ReasonCode;
    replyEventId?:  string;
    state:          AgentMentionOutcomeState;
}

export enum AgentMentionOutcomeState {
    Denied = "DENIED",
    Failed = "FAILED",
    Replied = "REPLIED",
    Running = "RUNNING",
}

/**
 * DD-121: the caller's own channel messages (event IDs) whose agent.invoke admission
 * outcome the caller may see.
 */
export interface AgentMentionOutcomeQueryRequest {
    eventIds: string[];
}

/**
 * 17 §8、19 §4：已准入 Workspace 与 Installation read 的原 Session 元事实；不包含或授权 Codex rollout
 * 正文。cursor 固定 HUMAN、scope、筛选与原生 generation。
 */
export interface AgentSessionPage {
    nextCursor?: string;
    sessions:    SessionElement[];
}

export interface SessionElement {
    agentVersionAssetId: string;
    /**
     * Core 记录的 RFC3339 时间字符串，按原线格式传输。
     */
    createdAt:              string;
    installationResourceId: string;
    projectionGeneration:   number;
    /**
     * 既有 BUZZ_EVENT、SCHEDULE 或 MANUAL Session 根引用；不从客户端生成 native thread。
     */
    rootEventId:      string;
    runtimeThreadId?: string;
    status:           SessionStatus;
    workspaceId:      string;
}

export enum SessionStatus {
    Active = "ACTIVE",
    Closed = "CLOSED",
    Pending = "PENDING",
    Starting = "STARTING",
    Unknown = "UNKNOWN",
}

export interface AgentSessionView {
    agentVersionAssetId: string;
    /**
     * Core 记录的 RFC3339 时间字符串，按原线格式传输。
     */
    createdAt:              string;
    installationResourceId: string;
    projectionGeneration:   number;
    /**
     * 既有 BUZZ_EVENT、SCHEDULE 或 MANUAL Session 根引用；不从客户端生成 native thread。
     */
    rootEventId:      string;
    runtimeThreadId?: string;
    status:           SessionStatus;
    workspaceId:      string;
}

/**
 * GET /api/v1/agent-installations/{id}/transcript/stream 的 SSE 数据帧（DD-125(6)）：Core 从同一
 * Installation 原生进程读到的 item/started、item/completed、turn/started、turn/completed 通知，按 thread
 * 解析到 AgentSession 后转发；只在建立时与周期性再准入下 Installation audit 成立期间发送，建立时写 ACCESS
 * 审计。帧不落库，断线后以分页读取补齐。
 */
export interface AgentTranscriptEvent {
    /**
     * 原生通知时间（item 的 startedAtMs/completedAtMs 或 turn 通知的 emittedAtMs），Unix 毫秒。
     */
    atMs?:          number;
    installationId: string;
    /**
     * ITEM_STARTED / ITEM_COMPLETED 时给出。
     */
    item?:                ItemElement;
    phase:                AgentTranscriptEventPhase;
    projectionGeneration: number;
    rootEventId:          string;
    threadId:             string;
    turnId:               string;
}

/**
 * ITEM_STARTED / ITEM_COMPLETED 时给出。
 *
 * DD-125(6)、SF-COD-09/17、17 §8：一条 Codex ThreadItem 的转写适配形状。BFF 只在 Installation Resource
 * audit 准入后，由 Core 经同一 Installation 的原生 app-server 读取（thread/items/list 或
 * item/started、item/completed 通知），按固定 Codex 类型逐字段映射后直接回应；Core 不存储、不复制正文。变体按 kind
 * 解释，各变体字段全部可选（contracts §1 平坦结构）。客户端把它适配为原 Buzz 转写条目。
 */
export interface ItemElement {
    /**
     * COMMAND_EXECUTION 的 stdout/stderr 聚合输出。
     */
    aggregatedOutput?: string;
    /**
     * 工具调用参数的 JSON 文本（原生 arguments 原样序列化）。
     */
    argumentsJson?: string;
    /**
     * COMMAND_EXECUTION 的命令。
     */
    command?: string;
    /**
     * item/completed 的 completedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
     */
    completedAtMs?: number;
    /**
     * COMMAND_EXECUTION 的工作目录（Installation 隔离目录内）。
     */
    cwd?: string;
    /**
     * COMMAND_EXECUTION、MCP_TOOL_CALL、DYNAMIC_TOOL_CALL 的原生耗时。
     */
    durationMs?: number;
    /**
     * MCP_TOOL_CALL 的原生 error.message。
     */
    errorText?: string;
    exitCode?:  number;
    /**
     * FILE_CHANGE 的逐文件变更。
     */
    fileChanges?: ItemFileChange[];
    /**
     * 原生 ThreadItem.id。
     */
    itemId: string;
    kind:   AgentTranscriptItemKind;
    /**
     * 原生 ThreadItem 的 type 标签原文（如 commandExecution）；OTHER 时客户端以原 raw 条目呈现。
     */
    nativeType: string;
    phase?:     AgentTranscriptMessagePhase;
    /**
     * WEB_SEARCH 的查询词（部署已关闭托管搜索，一般不出现）。
     */
    query?: string;
    /**
     * REASONING 的原文段（原生提供时）。
     */
    reasoningContent?: string[];
    /**
     * REASONING 的 summary 段。
     */
    reasoningSummary?: string[];
    /**
     * 工具结果中的文本内容按原顺序以换行连接；非文本内容不转发。
     */
    resultText?: string;
    /**
     * MCP_TOOL_CALL 的 MCP server 名；DYNAMIC_TOOL_CALL 的 namespace。
     */
    server?: string;
    /**
     * item/started 的 startedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
     */
    startedAtMs?: number;
    status?:      AgentTranscriptItemStatus;
    /**
     * USER_MESSAGE 的文本输入按原顺序以换行连接；AGENT_MESSAGE 与 PLAN 的正文。
     */
    text?: string;
    /**
     * MCP_TOOL_CALL / DYNAMIC_TOOL_CALL 的工具名。
     */
    tool?: string;
    /**
     * 所属原生 turn ID。
     */
    turnId: string;
}

export interface ItemFileChange {
    changeKind: AgentTranscriptFileChangeKind;
    /**
     * 原生 unified diff 文本。
     */
    diff: string;
    /**
     * UPDATE 改名时的目标路径。
     */
    movePath?: string;
    path:      string;
}

/**
 * Codex FileUpdateChange.kind 的标签（add/delete/update）；update 的改名目标另以 movePath 给出。
 */
export enum AgentTranscriptFileChangeKind {
    Add = "ADD",
    Delete = "DELETE",
    Update = "UPDATE",
}

/**
 * DD-125(6)、SF-COD-17：Codex app-server 持久 ThreadItem 的类型标签在转写线格式中的封闭投影。BFF 只把固定 Codex 的
 * userMessage/agentMessage/plan/reasoning/commandExecution/fileChange/mcpToolCall/dynamicToolCall/webSearch/imageView/contextCompaction
 * 映射为对应值，其余原生类型一律 OTHER 并保留 nativeType；客户端按原 Buzz 转写条目（TranscriptItem）呈现。
 */
export enum AgentTranscriptItemKind {
    AgentMessage = "AGENT_MESSAGE",
    CommandExecution = "COMMAND_EXECUTION",
    ContextCompaction = "CONTEXT_COMPACTION",
    DynamicToolCall = "DYNAMIC_TOOL_CALL",
    FileChange = "FILE_CHANGE",
    ImageView = "IMAGE_VIEW",
    MCPToolCall = "MCP_TOOL_CALL",
    Other = "OTHER",
    Plan = "PLAN",
    Reasoning = "REASONING",
    UserMessage = "USER_MESSAGE",
    WebSearch = "WEB_SEARCH",
}

/**
 * Codex agentMessage 的 phase（commentary / final_answer）；原生缺省 phase 的旧消息省略本字段。
 */
export enum AgentTranscriptMessagePhase {
    Commentary = "COMMENTARY",
    FinalAnswer = "FINAL_ANSWER",
}

/**
 * Codex commandExecution/fileChange/mcpToolCall/dynamicToolCall
 * 的原生状态（inProgress/completed/failed/declined）在转写中的封闭投影；无状态的条目省略。
 */
export enum AgentTranscriptItemStatus {
    Completed = "COMPLETED",
    Declined = "DECLINED",
    Failed = "FAILED",
    InProgress = "IN_PROGRESS",
}

/**
 * 实时转写帧的来源通知：item/started、item/completed、turn/started、turn/completed（SF-COD-17）。只转发 Core
 * 已从同一 Installation 原生进程读到的通知，不合成。
 */
export enum AgentTranscriptEventPhase {
    ItemCompleted = "ITEM_COMPLETED",
    ItemStarted = "ITEM_STARTED",
    TurnCompleted = "TURN_COMPLETED",
    TurnStarted = "TURN_STARTED",
}

/**
 * DD-125(6)、SF-COD-09/17、17 §8：一条 Codex ThreadItem 的转写适配形状。BFF 只在 Installation Resource
 * audit 准入后，由 Core 经同一 Installation 的原生 app-server 读取（thread/items/list 或
 * item/started、item/completed 通知），按固定 Codex 类型逐字段映射后直接回应；Core 不存储、不复制正文。变体按 kind
 * 解释，各变体字段全部可选（contracts §1 平坦结构）。客户端把它适配为原 Buzz 转写条目。
 */
export interface AgentTranscriptItem {
    /**
     * COMMAND_EXECUTION 的 stdout/stderr 聚合输出。
     */
    aggregatedOutput?: string;
    /**
     * 工具调用参数的 JSON 文本（原生 arguments 原样序列化）。
     */
    argumentsJson?: string;
    /**
     * COMMAND_EXECUTION 的命令。
     */
    command?: string;
    /**
     * item/completed 的 completedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
     */
    completedAtMs?: number;
    /**
     * COMMAND_EXECUTION 的工作目录（Installation 隔离目录内）。
     */
    cwd?: string;
    /**
     * COMMAND_EXECUTION、MCP_TOOL_CALL、DYNAMIC_TOOL_CALL 的原生耗时。
     */
    durationMs?: number;
    /**
     * MCP_TOOL_CALL 的原生 error.message。
     */
    errorText?: string;
    exitCode?:  number;
    /**
     * FILE_CHANGE 的逐文件变更。
     */
    fileChanges?: AgentTranscriptItemFileChange[];
    /**
     * 原生 ThreadItem.id。
     */
    itemId: string;
    kind:   AgentTranscriptItemKind;
    /**
     * 原生 ThreadItem 的 type 标签原文（如 commandExecution）；OTHER 时客户端以原 raw 条目呈现。
     */
    nativeType: string;
    phase?:     AgentTranscriptMessagePhase;
    /**
     * WEB_SEARCH 的查询词（部署已关闭托管搜索，一般不出现）。
     */
    query?: string;
    /**
     * REASONING 的原文段（原生提供时）。
     */
    reasoningContent?: string[];
    /**
     * REASONING 的 summary 段。
     */
    reasoningSummary?: string[];
    /**
     * 工具结果中的文本内容按原顺序以换行连接；非文本内容不转发。
     */
    resultText?: string;
    /**
     * MCP_TOOL_CALL 的 MCP server 名；DYNAMIC_TOOL_CALL 的 namespace。
     */
    server?: string;
    /**
     * item/started 的 startedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
     */
    startedAtMs?: number;
    status?:      AgentTranscriptItemStatus;
    /**
     * USER_MESSAGE 的文本输入按原顺序以换行连接；AGENT_MESSAGE 与 PLAN 的正文。
     */
    text?: string;
    /**
     * MCP_TOOL_CALL / DYNAMIC_TOOL_CALL 的工具名。
     */
    tool?: string;
    /**
     * 所属原生 turn ID。
     */
    turnId: string;
}

export interface AgentTranscriptItemFileChange {
    changeKind: AgentTranscriptFileChangeKind;
    /**
     * 原生 unified diff 文本。
     */
    diff: string;
    /**
     * UPDATE 改名时的目标路径。
     */
    movePath?: string;
    path:      string;
}

/**
 * GET
 * /api/v1/agent-installations/{id}/transcript?rootEventId&projectionGeneration&cursor（DD-125(6)、V-SCN-143）：按
 * AgentSession 分页读取 Codex thread/items/list（升序），要求 Installation Resource audit，受审计敏感读取，Core
 * 不复制正文。nextCursor 绑定读者、Installation 与 Session，原生 cursor 不外露。activeTurn 只在该 Session
 * 有运行中回合时给出。Session 尚无原生 thread 时 items 为空且省略 threadId。
 */
export interface AgentTranscriptPage {
    activeTurn?:          ActiveTurnElement;
    installationId:       string;
    items:                ItemElement[];
    nextCursor?:          string;
    projectionGeneration: number;
    rootEventId:          string;
    threadId?:            string;
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
     * Exact avatar URLs belonging to this authorized Version's current Tenant Community mapped
     * to the existing same-origin profile media reader. Read projection only; not content, a
     * credential, or an arbitrary remote proxy.
     */
    avatarMediaPaths?: { [key: string]: string };
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
     * Exact avatar URLs belonging to this authorized Version's current Tenant Community mapped
     * to the existing same-origin profile media reader. Read projection only; not content, a
     * credential, or an arbitrary remote proxy.
     */
    avatarMediaPaths?: { [key: string]: string };
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
    /**
     * 仅 canCreate=true 时给出：Catalog 中已 APPROVED 的 APPLICATION release 的绑定所需公开声明（03
     * §9）。secretSchema 只含键与格式声明，供 Tenant admin 按项提交 bindingSecretValues；不含任何 secret
     * 值、SecretRef、locator 或 Catalog 管理权。
     */
    bindableReleases?: ApplicationBindableRelease[];
    bindings:          ApplicationBindingView[];
    canCreate:         boolean;
    nextOffset?:       number;
}

export interface ApplicationBindableRelease {
    componentReleaseId: string;
    componentTypeKey:   string;
    secretSchema:       ApplicationBindableSecret[];
    version:            string;
}

export interface ApplicationBindableSecret {
    lengthOrFormat: string;
    secretKey:      string;
    valueType:      string;
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
    /**
     * Active approved binding declares a SERVICE read receiver. Resource discovery and writes
     * still freshly check the original source share and receiver update permissions.
     */
    hasReadReceiver?: boolean;
    /**
     * DD-127(4): presentation category the approved NATIVE_PAGE release declares. The sidebar
     * labels the entry by capabilityCategories ∪ this value; it grants nothing.
     */
    nativePageCategory?: NativePageCategory;
    state:               ApplicationBindingState;
    tenantId:            string;
    version:             number;
    workspaceId?:        string;
}

export interface ApplicationBindingCapability {
    category: string;
    version:  number;
}

/**
 * DD-127(4): presentation category the approved NATIVE_PAGE release declares. The sidebar
 * labels the entry by capabilityCategories ∪ this value; it grants nothing.
 *
 * DD-127(4)：NATIVE_PAGE 入口的呈现类别，决定侧边栏标签与图标；不授予能力、不参与类别解析或授权。
 */
export enum NativePageCategory {
    DataQuery = "data_query",
    FileStorage = "file_storage",
    Knowledge = "knowledge",
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
 * Existing Resource references authorized for a HUMAN configuring a receiver binding's
 * service read permission. No business body, credential or independent directory authority.
 */
export interface ApplicationReadResourcePage {
    bindingId:          string;
    bindingVersion:     number;
    direction:          ApplicationReadResourceDirection;
    nextOffset?:        number;
    resources:          ApplicationReadResource[];
    servicePrincipalId: string;
    tenantId:           string;
    workspaceId?:       string;
}

export interface ApplicationReadResource {
    bindingId:    string;
    nativeRef:    string;
    resourceId:   string;
    typeKey:      string;
    version:      number;
    workspaceId?: string;
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
 * GET /api/v1/approvals（待我审批）、GET /api/v1/approvals/initiated（本人发起且已有结果的审批，DD-125(5) Inbox
 * Needs action 的第二来源）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history 的投影。
 */
export interface ApprovalView {
    actionExecutionId: string;
    actionKey:         string;
    automationStep?:   AutomationStepClass;
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
 * 有权读取的审批所绑定不可变 AutomationVersion 中的步骤展示，不是另一审批或内容权威。
 */
export interface AutomationStepClass {
    id:             string;
    message:        string;
    name?:          string;
    versionAssetId: string;
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
 * 有权读取的审批所绑定不可变 AutomationVersion 中的步骤展示，不是另一审批或内容权威。
 */
export interface AutomationApprovalStepView {
    id:             string;
    message:        string;
    name?:          string;
    versionAssetId: string;
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
    /**
     * RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition 写事务记录的真实创建时间；历史无证据时省略，不回填当前时间。
     */
    createdAt?:                     string;
    delegationId?:                  string;
    executorInstallationResourceId: string;
    ownerPrincipalId:               string;
    pinnedVersionAssetId?:          string;
    resourceId:                     string;
    resourceState:                  ResourceState;
    resourceVersion:                number;
    state:                          AutomationState;
    /**
     * RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition/Version 实际写入时间；未观察到更新的历史行省略，不从
     * UUID、审计投递时间或浏览器时钟推测。
     */
    updatedAt?: string;
    /**
     * 当前 WEBHOOK 密钥展示形式的末四位，仅用于辨认；密钥本身不可再取回（DD-116）。
     */
    webhookSecretHint?: string;
    /**
     * WEBHOOK 触发的公开投递地址（部署配置的公开基址 + /hooks/{resourceId}）；只在密钥 ACTIVE 时给出（DD-116）。
     */
    webhookUrl?: string;
    workspaceId: string;
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
     * 原 TaskProjection 步骤证据。旧投影缺省表示尚无步骤证据，不表示没有步骤或运行成功；不通过读取原 history 旁路回填。
     */
    executionTrace?: ExecutionTraceElement[];
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
 * 既有 TaskProjection 中固定 AutomationVersion 步骤的可核验证据；不是执行权威。不含正文、模板、密钥、任意输出或原始 Temporal
 * history。时间仅来自原生事实，未知时省略。
 */
export interface ExecutionTraceElement {
    /**
     * 原生计时终态时间 RFC3339；不存在则省略，不由父任务完成推断。
     */
    completedAt?: string;
    error?:       ReasonCode;
    output:       ExecutionTraceOutput;
    /**
     * 原生步骤开始时间 RFC3339；不存在则省略，不用投影更新时间替代。
     */
    startedAt?: string;
    status:     AutomationStepStatus;
    stepId:     string;
}

export interface ExecutionTraceOutput {
    actionExecutionId?:  string;
    approvalWorkflowId?: string;
    eventId?:            string;
    historyEventId?:     number;
    /**
     * call_webhook 实际收到的 HTTP 状态码；不保存响应正文或请求头。
     */
    httpStatus?: number;
    /**
     * call_webhook 本次派发的稳定请求引用（随请求发送的 Kailo-Request-Id）。
     */
    requestId?:  string;
    runId?:      string;
    workflowId?: string;
}

export enum AutomationStepStatus {
    Cancelled = "cancelled",
    Completed = "completed",
    Failed = "failed",
    Pending = "pending",
    Running = "running",
    Skipped = "skipped",
    Unknown = "unknown",
    WaitingApproval = "waiting_approval",
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
     * 原 TaskProjection 步骤证据。旧投影缺省表示尚无步骤证据，不表示没有步骤或运行成功；不通过读取原 history 旁路回填。
     */
    executionTrace?: ExecutionTraceElement[];
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
    /**
     * RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition 写事务记录的真实创建时间；历史无证据时省略，不回填当前时间。
     */
    createdAt?:                     string;
    delegationId?:                  string;
    executorInstallationResourceId: string;
    ownerPrincipalId:               string;
    pinnedVersionAssetId?:          string;
    resourceId:                     string;
    resourceState:                  ResourceState;
    resourceVersion:                number;
    state:                          AutomationState;
    /**
     * RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition/Version 实际写入时间；未观察到更新的历史行省略，不从
     * UUID、审计投递时间或浏览器时钟推测。
     */
    updatedAt?: string;
    /**
     * 当前 WEBHOOK 密钥展示形式的末四位，仅用于辨认；密钥本身不可再取回（DD-116）。
     */
    webhookSecretHint?: string;
    /**
     * WEBHOOK 触发的公开投递地址（部署配置的公开基址 + /hooks/{resourceId}）；只在密钥 ACTIVE 时给出（DD-116）。
     */
    webhookUrl?: string;
    workspaceId: string;
}

/**
 * DD-116：WEBHOOK 触发密钥的唯一一次明文交付。只出现在生成或轮换该密钥的那次 ActionSubmission 中；之后只给出
 * AutomationView.webhookSecretHint。投递方用它按 Standard Webhooks 对
 * `{webhook-id}.{webhook-timestamp}.{正文}` 计算 HMAC-SHA256。
 */
export interface AutomationWebhookSecret {
    automationResourceId: string;
    hint:                 string;
    /**
     * 32 字节随机密钥的 base64 展示形式。
     */
    secret: string;
    /**
     * 公开投递地址；部署未配置公开基址时省略。
     */
    url?: string;
}

/**
 * GET /api/v1/operations 的有界回应（.design/14 §7）：本人发起或实际执行的操作，或调用方对其持有 audit permission 的
 * Tenant/Workspace 范围内的操作，每次 fresh Check；新的在前。
 */
export interface BusinessOperationPage {
    /**
     * 下一页首项之前的 ActionExecution ID；缺省即已读完
     */
    nextCursor?: string;
    operations:  OperationElement[];
}

/**
 * 业务操作时间线的一项：一个根 Governed Action（.design/14 §2、§7）。只含平台元数据与权威引用，不含参数、正文、prompt/response
 * 或原生结果；用量只来自 Core UsageEvent outbox 的冻结 quantity 与投递事实，不是余额或账单。
 */
export interface OperationElement {
    actionExecutionId: string;
    actionKey:         string;
    actionVersion:     number;
    actorPrincipalId:  string;
    approvalStatus?:   ApprovalStatus;
    /**
     * RFC3339，UTC
     */
    createdAt:            string;
    initiatorPrincipalId: string;
    operationId:          string;
    phase:                BusinessOperationPhase;
    reason?:              ReasonCode;
    targetId:             string;
    /**
     * RFC3339，UTC；只在阶段为确定终态且终态时间来自 TaskProjection 或同 operation 的审计事实时给出
     */
    terminalAt?:   string;
    usage:         OperationUsage[];
    usageState:    OperationUsageState;
    workflowKind?: WorkflowKind;
    /**
     * 缺省即 Tenant 级动作
     */
    workspaceId?: string;
}

/**
 * 业务操作视图的当前阶段（.design/14 §7、§8），由 Core 按 ActionExecution 准入/派发、ApprovalProjection 与
 * TaskProjection 唯一推导；投影不可担保为当前时为 PROJECTION_DELAYED，外部结果不明时为 UNKNOWN，二者都不是成功或失败。APPLIED
 * 只用于无 Workflow 的同步动作返回结果；CANCEL_REQUESTED 只表示取消控制被接受，不表示原任务已终结。
 */
export enum BusinessOperationPhase {
    Aborted = "ABORTED",
    Applied = "APPLIED",
    AwaitingApproval = "AWAITING_APPROVAL",
    CancelRequested = "CANCEL_REQUESTED",
    Canceled = "CANCELED",
    Completed = "COMPLETED",
    Denied = "DENIED",
    Evaluating = "EVALUATING",
    Expired = "EXPIRED",
    Failed = "FAILED",
    NotStarted = "NOT_STARTED",
    ProjectionDelayed = "PROJECTION_DELAYED",
    Revoked = "REVOKED",
    Running = "RUNNING",
    Terminated = "TERMINATED",
    TimedOut = "TIMED_OUT",
    Unknown = "UNKNOWN",
}

export interface OperationUsage {
    meterKey: string;
    /**
     * 冻结 CloudEvent 的 quantity；status 非 COMMITTED 时不表示已入账
     */
    quantity: number;
    status:   UsageSettlementStatus;
}

/**
 * Core UsageEvent outbox 的投递事实（.design/11 §4 第 7 条）。PENDING_PUBLISH 尚未取得 OpenMeter
 * 回应；ACCEPTED 只表示 202 接收；COMMITTED 表示按 ID/source 查到 stored_at；UNKNOWN 待对账；FAILED 为确定拒绝。均不表示
 * invoice 已结算。
 */
export enum UsageSettlementStatus {
    Accepted = "ACCEPTED",
    Committed = "COMMITTED",
    Failed = "FAILED",
    PendingPublish = "PENDING_PUBLISH",
    Unknown = "UNKNOWN",
}

/**
 * 一个业务操作的用量结算状态（.design/11 §4、§6，.design/14
 * §8）。NOT_METERED：动作定义没有用量来源；NOT_DISPATCHED：有计量但没有派发；BILLING_UNAVAILABLE：已派发却没有可结算的持久用量事实（不显示零）；SETTLEMENT_PENDING：用量事件待发布或
 * OpenMeter 仅 202 接收；COMMITTED：全部事件已按 ID/source 查到
 * stored_at；UNKNOWN：投递或查证结果不明，待对账；FAILED：投递被确定拒绝。COMMITTED 不代表账单已结算。
 */
export enum OperationUsageState {
    BillingUnavailable = "BILLING_UNAVAILABLE",
    Committed = "COMMITTED",
    Failed = "FAILED",
    NotDispatched = "NOT_DISPATCHED",
    NotMetered = "NOT_METERED",
    SettlementPending = "SETTLEMENT_PENDING",
    Unknown = "UNKNOWN",
}

/**
 * 一个阶段在所选范围与区间内的根业务操作数量。只列出现过的阶段，不补零。
 */
export interface BusinessOperationPhaseCount {
    count: number;
    phase: BusinessOperationPhase;
}

/**
 * GET /api/v1/operations/summary：Tenant 或其中一个 Workspace 在区间内的业务聚合（.design/14 §7），调用方须对该范围持有
 * audit permission，每次 fresh Check。等待审批、运行中、UNKNOWN、投影落后与撤销单列，不从分母中丢弃；平均耗时只取有确定终态时间的操作。
 */
export interface BusinessOperationSummary {
    actions: BusinessOperationActionSummary[];
    /**
     * RFC3339，含
     */
    from:     string;
    phases:   PhaseElement[];
    tenantId: string;
    /**
     * RFC3339，不含
     */
    to:           string;
    total:        number;
    usageStates:  UsageStateElement[];
    workspaceId?: string;
}

export interface BusinessOperationActionSummary {
    actionKey: string;
    /**
     * timedTerminalCount 为 0 时缺省
     */
    averageTerminalSeconds?: number;
    phases:                  PhaseElement[];
    /**
     * 有确定终态时间、计入平均耗时的操作数
     */
    timedTerminalCount: number;
    total:              number;
}

/**
 * 一个阶段在所选范围与区间内的根业务操作数量。只列出现过的阶段，不补零。
 */
export interface PhaseElement {
    count: number;
    phase: BusinessOperationPhase;
}

/**
 * 一个用量结算状态在所选范围与区间内的根业务操作数量。只列出现过的状态，不补零。
 */
export interface UsageStateElement {
    count: number;
    state: OperationUsageState;
}

/**
 * 业务操作时间线的一项：一个根 Governed Action（.design/14 §2、§7）。只含平台元数据与权威引用，不含参数、正文、prompt/response
 * 或原生结果；用量只来自 Core UsageEvent outbox 的冻结 quantity 与投递事实，不是余额或账单。
 */
export interface BusinessOperationView {
    actionExecutionId: string;
    actionKey:         string;
    actionVersion:     number;
    actorPrincipalId:  string;
    approvalStatus?:   ApprovalStatus;
    /**
     * RFC3339，UTC
     */
    createdAt:            string;
    initiatorPrincipalId: string;
    operationId:          string;
    phase:                BusinessOperationPhase;
    reason?:              ReasonCode;
    targetId:             string;
    /**
     * RFC3339，UTC；只在阶段为确定终态且终态时间来自 TaskProjection 或同 operation 的审计事实时给出
     */
    terminalAt?:   string;
    usage:         BusinessOperationViewUsage[];
    usageState:    OperationUsageState;
    workflowKind?: WorkflowKind;
    /**
     * 缺省即 Tenant 级动作
     */
    workspaceId?: string;
}

export interface BusinessOperationViewUsage {
    meterKey: string;
    /**
     * 冻结 CloudEvent 的 quantity；status 非 COMMITTED 时不表示已入账
     */
    quantity: number;
    status:   UsageSettlementStatus;
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
    /**
     * PLATFORM_SEED 的部署引导证据；不冒充人为登记或批准。
     */
    bootstrapActionExecutionId?:    string;
    canApprove:                     boolean;
    canDeprecate:                   boolean;
    categoryKey:                    string;
    conformanceSuiteDigest:         string;
    contractVersion:                number;
    registeredByActionExecutionId?: string;
    schemaSetDigest:                string;
    status:                         CapabilityContractStatus;
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
    /**
     * PLATFORM_SEED 的部署引导证据；不冒充人为登记或批准。
     */
    bootstrapActionExecutionId?:    string;
    canApprove:                     boolean;
    canDeprecate:                   boolean;
    categoryKey:                    string;
    conformanceSuiteDigest:         string;
    contractVersion:                number;
    registeredByActionExecutionId?: string;
    schemaSetDigest:                string;
    status:                         CapabilityContractStatus;
}

/**
 * PUT /api/v1/user-state/channel-templates/{templateId} 的请求体（DD-125(4)、03
 * CollaborationUserState.channel_templates）：新建或替换本人的原频道模板；templateId 由客户端以 UUID 生成。字段沿原
 * ChannelTemplateRecord；agentResourceIds 只引用同 Tenant 的 AgentDefinition Resource（≙ 原
 * persona），原 runtime/model/backend 与 team 条目不适用。canvasTemplate 不超过 64 KiB，每人至多 200
 * 个模板。模板不授予任何权限：应用时仍逐项提交 workspace.create、workspace.canvas.set 与
 * agent.installation.create。DELETE 同一路径以 UserStateVersion 为请求体。version 不符即 409。
 */
export interface ChannelTemplateRequest {
    agentResourceIds: string[];
    canvasTemplate?:  string;
    channelType:      ChannelType;
    description?:     string;
    name:             string;
    version:          number;
    visibility:       WorkspaceVisibility;
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
    ReceiverObserve = "receiver_observe",
    ReceiverStart = "receiver_start",
    Reconcile = "reconcile",
    ResolveNativeScope = "resolve_native_scope",
    ValidateBinding = "validate_binding",
}

/**
 * Core原canonical_digest对同一已授权步骤实际响应的摘要；仅规范化事实，不声明套件通过或登记成功。
 */
export interface ComponentConformanceWireDigests {
    /**
     * 仅成功 validate_binding：严格解析既有 AdapterBindingObservation 并核对请求的 SecretRef 后，仅去除实际
     * secretReads.requestId 的固定字段摘要。完整实际响应仍由 responseDigest 固定；不代替绑定激活的 OpenBao 审计核验。
     */
    bindingDigest?: string;
    /**
     * DD-124：仅当冻结步骤声明 captures 且实际应答为带原生状态的 SUCCEEDED 时，从 typed ContentReference 或登记的
     * generatedRefs 输出字段取出的值。
     */
    captures?:                  CaptureElement[];
    nativeReceiverObservation?: NativeReceiverObservationClass;
    requestDigest:              string;
    responseDigest:             string;
    resultDigest?:              string;
}

/**
 * DD-124(2): one captured value of the current suite run. Core derives it only from the
 * candidate's actual wire response or typed ContentReference; it is kept only in that
 * step's observation evidence and re-checked when the report is recorded. Never a fixture,
 * seed or administrator value.
 */
export interface CaptureElement {
    key:   string;
    value: string;
}

/**
 * 原生 SyncLog 的真实批次与同批多个原 SERVICE read Operation 元数据；completed 不能单独证明通过，Core 仍核对每个
 * SOURCE/RECEIVER 回执及冻结请求。DD-124(4)：请求省略 importConfigRef 时，本观察是隔离 Core 真实 APPLICATION
 * 接收方动作的原生执行（nativeBatchId 为其原生任务标识，nativeStatus 为原生状态原值），每个 read Operation 锚定该动作而无
 * nativeBatch；RECEIVER case 中不读取来源的步骤（如 read/export/search/delete）可无 read Operation，读取由整个
 * case 承载。执行、operation 与批次标识须为隔离 Core 本次生成且不在计划或 fixture 中。
 */
export interface NativeReceiverObservationClass {
    completed:      boolean;
    finishedAt?:    string;
    nativeBatchId:  string;
    nativeStatus:   string;
    readOperations: NativeReceiverObservationReadOperation[];
    request:        RequestClass;
    startedAt:      string;
}

export interface NativeReceiverObservationReadOperation {
    actionExecutionId: string;
    /**
     * 原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
     * receiverActionExecutionId）。
     */
    nativeBatch?:              ReadOperationNativeBatch;
    operationId:               string;
    readRequest:               ReadRequestClass;
    receiverActionExecutionId: string;
    receiverGeneration:        number;
    receiverReceipt:           AdapterReadReceipt;
    sourceBindingId:           string;
    sourceReceipt:             AdapterReadReceipt;
    sourceResourceId:          string;
}

/**
 * 原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
 * receiverActionExecutionId）。
 *
 * Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
 * exactly one mode, freezes these references, and resolves the receiver from its
 * authenticated binding.
 */
export interface ReadOperationNativeBatch {
    actionKey:          string;
    actionVersion:      number;
    batchId:            string;
    importConfigRef:    string;
    receiverResourceId: string;
}

/**
 * DD-89: receiver binding authenticates as its own ServicePrincipal for one source-resource
 * read batch. Input is checked against the approved source action schema; Core retains its
 * digest, not the returned business content.
 */
export interface ReadRequestClass {
    actionKey:      string;
    actionVersion:  number;
    idempotencyKey: string;
    inputJson:      string;
    /**
     * Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
     * exactly one mode, freezes these references, and resolves the receiver from its
     * authenticated binding.
     */
    nativeBatch?: ReadOperationNativeBatch;
    /**
     * 只观察已存在的同一原生 SOURCE AE；必须匹配原 key/nativeBatch（或锚定的 receiverActionExecutionId 与
     * receiverArgumentsJson）/输入，查无或未就绪不得创建、续发 grant 或进入新准入。
     */
    observeActionExecutionId?:  string;
    receiverActionExecutionId?: string;
    receiverArgumentsJson?:     string;
    receiverBindingId:          string;
    sourceResourceId:           string;
}

/**
 * 07§8A 隔离原生接收方验证的冻结请求。原生生成真实 batch ID；同键重入与观察必须保持全部字段，不是生产 execute 输入或通用 HTTP
 * 脚本。DD-124(4)：importConfigRef 存在时为 NATIVE_MANAGED 原生批次，由候选实现原生发起；省略时为隔离部署内的 APPLICATION
 * 接收方动作（如经 READ_EDGE 的 ingest），由平台维护的隔离部署以真实 APPLICATION ActionExecution
 * 准入与派发，原能力输入只由已登记向量与 fixture 前置值冻结。
 */
export interface RequestClass {
    bindingId: string;
    /**
     * 受控夹具固定的 RFC3339 首派期限，须受原生 SyncLog 保留策略约束；过期仍可观察同一批次，不得续期重派。
     */
    expiresAt:        string;
    generation:       number;
    idempotencyKey:   string;
    importConfigRef?: string;
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
    /**
     * DD-124：本步 CAPTURE 绑定所需的值，只取同 case 更早步骤已记录观察中的 captures；Core 代入后签名，登记时再按报告重算，不能以 fixture
     * 或管理员值替代。
     */
    captures?:         CaptureElement[];
    contentReference?: ContentReferenceElement;
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
     * DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
     */
    receiverEnvironment?: ReceiverEnvironmentClass;
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

/**
 * DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
 *
 * DD-124(4), 07 §8A: identity of the isolated receiver deployment a plan with
 * receiver_start/receiver_observe steps observes. isolatedCoreBuildId is the
 * PlatformBuildInfo CORE buildId of the isolated Core/Worker and must equal the current
 * production Core build. sourceReleaseId with its artifact and manifest digests names the
 * production Catalog release, APPROVED and declaring read_edge SOURCE or BOTH, that the
 * isolated deployment runs as the source. It is delivered with the isolated identity, fixed
 * by the plan identity digest and copied into the plan; it is not evidence that any step
 * passed.
 *
 * DD-124(4)：计划含 receiver_start/receiver_observe 步骤时必填；固定隔离接收方部署的 Core 构建与来源
 * release，随身份摘要进入原计划。
 */
export interface ReceiverEnvironmentClass {
    isolatedCoreBuildId:  string;
    sourceArtifactDigest: string;
    sourceManifestDigest: string;
    sourceReleaseId:      string;
}

export interface PlanStep {
    /**
     * DD-124：仅 V2 契约步骤。Core 冻结时已代入 PRECONDITION 的 fixture 值，这里只保留 CAPTURE 的代入位置声明（不含值）；运行时 Core
     * 在 ActionToken 签名前代入请求、在比对前代入期望。权限拒绝重放保留同一 INPUT 声明。接收方向步骤只保留本步自身捕获的 INPUT 声明：请求不被代入，Core
     * 以它们比对隔离 Core 实际产生的接收方准入。
     */
    bindings?: BindingElement[];
    /**
     * DD-124：仅 V2 契约步骤。本步 SUCCEEDED 且原生终态证据完整时由 Core 从实际应答的封闭槽位取值，写入本步观察证据。
     */
    captures?: CaptureClass[];
    caseKey:   string;
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
    /**
     * 仅接收方向步骤（V1 的 NATIVE_INTERNAL/NATIVE 能力步骤，或 V2 RECEIVER case 的步骤），由 Core
     * 保留已代入前置值的原能力向量输入；SOURCE AE 与 batch 必须以同批真实入站观察替换，不是预造授权。
     */
    nativeReceiverInputJson?: string;
    operation:                ComponentConformanceOperation;
    referenceAssetId?:        string;
    referenceFromStepKey?:    string;
    referenceResourceId?:     string;
    requestJson:              string;
    stepKey:                  string;
}

/**
 * DD-124(2): one substitution position of a V2 step. pointer is an RFC 6901 JSON Pointer
 * into the step input (INPUT) or expected output (EXPECTED); the literal there must be
 * exactly the reserved placeholder {{SOURCE:key}}. INPUT may bind PRECONDITION or CAPTURE;
 * EXPECTED may bind CAPTURE or a PRECONDITION already sent as INPUT in this case. In a
 * RECEIVER case INPUT may also bind the step's own captures: Core compares that input with
 * the admission the isolated Core actually produced whenever the step's evidence has reads.
 * The plan digest fixes the declaration, never the value.
 */
export interface BindingElement {
    key:     string;
    pointer: string;
    side:    CapabilityVectorSide;
    source:  CapabilityVectorBindingSource;
}

/**
 * DD-124(2): the vector document a JSON Pointer addresses — the step input or its expected
 * output.
 */
export enum CapabilityVectorSide {
    Expected = "EXPECTED",
    Input = "INPUT",
}

/**
 * DD-124(1)(2): the two non-literal value sources of a V2 conformance vector. Every other
 * value is LITERAL; there is no third binding source.
 */
export enum CapabilityVectorBindingSource {
    Capture = "CAPTURE",
    Precondition = "PRECONDITION",
}

/**
 * DD-124(1)(2): a value this step's actual SUCCEEDED observation produces for later steps
 * of the same case. key is unique in the case and must be consumed at least once. pointer
 * is present only for GENERATED_REF and must equal an EXPECTED generatedRefs entry of the
 * step's contract key; in a RECEIVER case it equals an INPUT entry and reads the admission
 * the isolated Core produced. ACTION_EXECUTION_ID and OPERATION_ID exist only in RECEIVER
 * cases; a step of a RECEIVER case takes them and CONTENT_REFERENCE_* from its own read and
 * the receiver's read_receipt of that admission, so a capturing step's evidence has reads.
 */
export interface CaptureClass {
    key:      string;
    pointer?: string;
    slot:     CapabilityVectorCaptureSlot;
}

/**
 * DD-124(1): the closed observation slots a CAPTURE may take. CONTENT_REFERENCE_* read the
 * adapter's typed ContentReference; GENERATED_REF reads an output field listed in the
 * vector document's generatedRefs; ACTION_EXECUTION_ID/OPERATION_ID are the SOURCE read
 * ActionExecution and Operation the isolated Core generated for a step of a RECEIVER case
 * in this run (never present in the plan or fixture).
 */
export enum CapabilityVectorCaptureSlot {
    ActionExecutionID = "ACTION_EXECUTION_ID",
    ContentReferenceNativeObjectRef = "CONTENT_REFERENCE_NATIVE_OBJECT_REF",
    ContentReferenceNativeRevision = "CONTENT_REFERENCE_NATIVE_REVISION",
    GeneratedRef = "GENERATED_REF",
    OperationID = "OPERATION_ID",
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
    items:       ItemClass[];
    nextCursor?: string;
}

/**
 * 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
 */
export interface ItemClass {
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
    items:           ConversationParticipantPageItem[];
    maxParticipants: number;
    nextCursor?:     string;
}

/**
 * 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
 */
export interface ConversationParticipantPageItem {
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
    /**
     * 与 updateActionKey 同时给出且为 true 时，Channel 是被原生 reaper 按 TTL 到期归档的，界面只提供以 workspace.update 的
     * reopen 解档；省略或 false 时 updateActionKey 只用于修改名称、描述、TTL 与可见性。
     */
    canReopen?: boolean;
    channel:    ChannelClass;
    createdAt:  Date;
    id:         string;
    /**
     * 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
     */
    isMember:       boolean;
    joinActionKey?: JoinActionKey;
    /**
     * 当前 Principal 持有 ACTIVE WorkspaceMembership、fresh Workspace discover
     * 检查通过且目录已开放时给出；主体固定为本人。省略即不显示退出入口。
     */
    leaveActionKey?:  LeaveActionKey;
    memberCount:      number;
    membershipState?: WorkspaceMembershipState;
    /**
     * 当前 Principal 经 fresh Workspace manage 检查、目录已开放、Workspace ACTIVE 且没有未终结的 workspace.update
     * 时给出；Channel 已归档时仅在 canReopen 为 true 时给出。省略即不显示编辑入口，提交仍重新准入。
     */
    updateActionKey?: UpdateActionKey;
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
    /**
     * 原 39000 topic 标签；Relay 对空主题省略该标签，缺省即无主题。
     */
    topic?:       string;
    ttlDeadline?: Date;
    ttlSeconds?:  number;
}

export enum JoinActionKey {
    WorkspaceJoin = "workspace.join",
}

export enum LeaveActionKey {
    WorkspaceLeave = "workspace.leave",
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

export enum UpdateActionKey {
    WorkspaceUpdate = "workspace.update",
}

export interface DiscoverableWorkspacePage {
    items:       DiscoverableWorkspacePageItem[];
    nextCursor?: string;
}

export interface DiscoverableWorkspacePageItem {
    /**
     * 与 updateActionKey 同时给出且为 true 时，Channel 是被原生 reaper 按 TTL 到期归档的，界面只提供以 workspace.update 的
     * reopen 解档；省略或 false 时 updateActionKey 只用于修改名称、描述、TTL 与可见性。
     */
    canReopen?: boolean;
    channel:    ChannelClass;
    createdAt:  Date;
    id:         string;
    /**
     * 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
     */
    isMember:       boolean;
    joinActionKey?: JoinActionKey;
    /**
     * 当前 Principal 持有 ACTIVE WorkspaceMembership、fresh Workspace discover
     * 检查通过且目录已开放时给出；主体固定为本人。省略即不显示退出入口。
     */
    leaveActionKey?:  LeaveActionKey;
    memberCount:      number;
    membershipState?: WorkspaceMembershipState;
    /**
     * 当前 Principal 经 fresh Workspace manage 检查、目录已开放、Workspace ACTIVE 且没有未终结的 workspace.update
     * 时给出；Channel 已归档时仅在 canReopen 为 true 时给出。省略即不显示编辑入口，提交仍重新准入。
     */
    updateActionKey?: UpdateActionKey;
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
 * PUT /api/v1/user-state/followed-principals 的请求体（DD-125(5)、03
 * CollaborationUserState.followed_principals）：原 Pulse 关注/取消关注，取代逐公钥 kind 3。pubkey 是被关注者的任一
 * Buzz 公钥，Core 解析为同 Tenant 的 HUMAN Principal 并按 Principal 存储；关注要求该公钥当前
 * ACTIVE，取消关注也接受其已撤销的历史公钥。读取时按被关注 Principal 的全部 ACTIVE 公钥展开。version 不符即 409。
 */
export interface FollowedPrincipalRequest {
    followed: boolean;
    pubkey:   string;
    version:  number;
}

/**
 * POST /api/v1/huddles/{huddleId}/announcement（仅 Web 创建者，DD-125(3)）：BFF 以本人 SERVER 身份为
 * ACTIVE 的 Huddle 各签一次 48106（临时频道，原 voice_mode_guidelines 正文）与 48100（父频道，content 为
 * ephemeral_channel_id），签名事件随绑定持久化，重试只重投同一事件、不重签（DD-81）。48106 按原版尽力发布，48100 是必需的发现链接。
 */
export interface HuddleAnnouncementView {
    /**
     * 48106 事件 ID；尽力发布
     */
    guidelinesEventId?: string;
    /**
     * Relay 已接受或回读到 48100
     */
    startedDelivered: boolean;
    /**
     * 48100 事件 ID
     */
    startedEventId: string;
}

/**
 * 父频道中一条原版 Huddle 生命周期事件（kind 48100–48103，SF-BUZ-53），由 BFF 以本人身份读取并校验签名：48100
 * 只取临时频道创建者签名，48101/48102 只取 Relay 签名，48103 取创建者或 Relay 签名。content 按原 JSON 解析为下列字段，未知字段丢弃。
 */
export interface HuddleLifecycleEvent {
    admissionId?: string;
    /**
     * 事件 created_at（Unix 秒）
     */
    createdAt:          number;
    ephemeralChannelId: string;
    eventId:            string;
    generation?:        string;
    kind:               number;
    /**
     * 48101/48102 的 p 标签
     */
    participantPubkey?: string;
    /**
     * 签名者公钥
     */
    pubkey:          string;
    rosterRevision?: number;
}

/**
 * GET /api/v1/huddles/{huddleId}/lifecycle：该 Huddle 在父频道中的生命周期事件（按 created_at 升序）与 Relay
 * 合成的存活（48104，房间非空才为 true），供原 huddlePresence 重建参与者与卡片状态。
 */
export interface HuddleLifecyclePage {
    events: EventElement[];
    /**
     * Relay 48104 存活查询是否返回该会话
     */
    live: boolean;
}

/**
 * 父频道中一条原版 Huddle 生命周期事件（kind 48100–48103，SF-BUZ-53），由 BFF 以本人身份读取并校验签名：48100
 * 只取临时频道创建者签名，48101/48102 只取 Relay 签名，48103 取创建者或 Relay 签名。content 按原 JSON 解析为下列字段，未知字段丢弃。
 */
export interface EventElement {
    admissionId?: string;
    /**
     * 事件 created_at（Unix 秒）
     */
    createdAt:          number;
    ephemeralChannelId: string;
    eventId:            string;
    generation?:        string;
    kind:               number;
    /**
     * 48101/48102 的 p 标签
     */
    participantPubkey?: string;
    /**
     * 签名者公钥
     */
    pubkey:          string;
    rosterRevision?: number;
}

/**
 * GET /api/v1/huddles：一个父 Workspace 或父私聊中本人可见、尚未结束的 Huddle（PROVISIONING 或 ACTIVE），按创建时间倒序。
 */
export interface HuddlePage {
    items: HuddlePageItem[];
}

/**
 * 本人可见的一个原版 Huddle 临时频道投影（HuddleBuzzBinding，DD-125(3)）。只含平台引用与状态，不含音频、参与者音频状态或消息正文；参与者与存活由
 * Relay 的 48101–48104 呈现。
 */
export interface HuddlePageItem {
    agentInstallationResourceIds: string[];
    /**
     * Core 预分配的临时 Channel UUID（原 ephemeral_channel_id）
     */
    channelId:   string;
    channelName: string;
    createdAt:   Date;
    /**
     * 临时频道 created_by：本人发起会话的 HUMAN 公钥
     */
    creatorPubkey:        string;
    endedAt?:             Date;
    huddleId:             string;
    initiatorPrincipalId: string;
    /**
     * 发起该 Huddle 的 huddle.start operation
     */
    operationId:           string;
    parentChannelId:       string;
    parentConversationId?: string;
    parentWorkspaceId?:    string;
    state:                 HuddleState;
    version:               number;
}

/**
 * HuddleBuzzBinding 状态（03 §2、DD-125(3)）：PROVISIONING 为 CONTROL 9007/9000 投影尚未回读一致（结果不明保留并按
 * Channel UUID 对账）；ACTIVE 为投影回读一致；ENDED 为观察到 48103 或临时频道已归档，终态、不复用；ERROR 为 Relay
 * 确定拒绝投影，不再签发。
 */
export enum HuddleState {
    Active = "ACTIVE",
    Ended = "ENDED",
    Error = "ERROR",
    Provisioning = "PROVISIONING",
}

/**
 * 本人可见的一个原版 Huddle 临时频道投影（HuddleBuzzBinding，DD-125(3)）。只含平台引用与状态，不含音频、参与者音频状态或消息正文；参与者与存活由
 * Relay 的 48101–48104 呈现。
 */
export interface HuddleView {
    agentInstallationResourceIds: string[];
    /**
     * Core 预分配的临时 Channel UUID（原 ephemeral_channel_id）
     */
    channelId:   string;
    channelName: string;
    createdAt:   Date;
    /**
     * 临时频道 created_by：本人发起会话的 HUMAN 公钥
     */
    creatorPubkey:        string;
    endedAt?:             Date;
    huddleId:             string;
    initiatorPrincipalId: string;
    /**
     * 发起该 Huddle 的 huddle.start operation
     */
    operationId:           string;
    parentChannelId:       string;
    parentConversationId?: string;
    parentWorkspaceId?:    string;
    state:                 HuddleState;
    version:               number;
}

/**
 * GET /api/v1/huddles/voice：Web Huddle
 * 的转写与朗读是否可用（DD-125(3)、V-SCN-160）。不可用时通话、加入、发言、收听与离开不受影响。
 */
export interface HuddleVoiceView {
    speech:        HuddleVoiceAvailability;
    transcription: HuddleVoiceAvailability;
}

/**
 * Web Huddle 转写或朗读的可用性（DD-125(3)、V-SCN-160）：UNAVAILABLE 为 Huddle
 * 语音推理服务未部署、超出部署登记的并发上界或不可用，此时按原版“仅语音模式”显示不可用而通话照常。
 */
export enum HuddleVoiceAvailability {
    Available = "AVAILABLE",
    Unavailable = "UNAVAILABLE",
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
 * GET /api/v1/moderation/access（DD-125(2)）：原版只对 Community owner/admin 显示的审核入口在 Kailo 对应
 * Tenant manage。canModerate 是与 moderation.ban 准入同一条 fresh 判定（目录开放、非 Platform Catalog、scope
 * guard 与 tenant manage）的提示，不是授权票据，提交时仍完整重新准入；它不读取任何限制或队列事实。
 */
export interface ModerationAccessView {
    canModerate: boolean;
}

/**
 * GET /api/v1/moderation/audit（DD-125(2)）：Relay moderation_actions（审核日志）是唯一权威，Core 以 Tenant
 * CONTROL 经 NIP-98 读取 /moderation/audit，只回给 fresh Tenant manage 的请求者，每次读取写 ACCESS
 * 审计，不复制。单次至多 500 行，按时间倒序。CONTROL 签发的执法行其 actorPubkey 是 CONTROL；发起人与准入记录在 Core 的
 * ActionExecution 与 AuditEvent。
 */
export interface ModerationAuditPage {
    items: ModerationAuditView[];
    /**
     * Relay 返回已达单次读取上界（500 行）
     */
    truncated: boolean;
}

export interface ModerationAuditView {
    /**
     * Relay 审核日志词表（ban、unban、timeout、untimeout、resolve:<action>、dismiss_report、escalate 等），原样呈现
     */
    action:      string;
    actorPubkey: string;
    channelId?:  string;
    /**
     * RFC3339
     */
    createdAt:      string;
    id:             string;
    publicReason?:  string;
    targetEventId?: string;
    targetPubkey?:  string;
}

/**
 * GET /api/v1/moderation/reports[?status=open]（DD-125(2)、V-SCN-130）：Relay
 * moderation_reports 是唯一权威，Core 以 Tenant CONTROL 经 NIP-98 读取 /moderation/reports，只回给 fresh
 * Tenant manage 的请求者，每次读取写 ACCESS 审计，Core 不复制。单次至多 500 行（Relay 上界），按创建时间倒序。reporterPubkey
 * 只出现在此审核面，不得进入被举报人可见的任何视图。
 */
export interface ModerationReportPage {
    items: ModerationReportView[];
    /**
     * Relay 返回已达单次读取上界（500 行），更早的行未包含
     */
    truncated: boolean;
}

export interface ModerationReportView {
    /**
     * 事件目标所在 Relay Channel；其余目标缺省
     */
    channelId?: string;
    /**
     * RFC3339
     */
    createdAt: string;
    /**
     * Relay 举报行 ID
     */
    id:             string;
    note?:          string;
    reporterPubkey: string;
    /**
     * 签名的 kind 1984 事件 ID；9044 以它定位举报
     */
    reportEventId: string;
    reportType:    ModerationReportType;
    /**
     * RFC3339
     */
    resolvedAt?:       string;
    resolvedByPubkey?: string;
    status:            ModerationReportStatus;
    /**
     * 事件 ID、公钥或附件 SHA-256（十六进制）
     */
    target: string;
    /**
     * 事件目标由 CONTROL 回读得到的签名者；pubkey 目标即其本身；不可读时缺省
     */
    targetAuthorPubkey?: string;
    targetKind:          ModerationReportTargetKind;
    /**
     * targetAuthorPubkey 属于本 Tenant 某 HUMAN Principal 时给出；AGENT 或未知公钥缺省（不提供封禁与踢出）
     */
    targetPrincipalId?: string;
    /**
     * channelId 对应本 Tenant 的 Workspace 时给出，供 moderation.message.delete 与
     * workspace.member.revoke 定位
     */
    workspaceId?: string;
}

/**
 * Relay moderation_reports.status（buzz migrations/0006_moderation.sql 的 CHECK
 * 词表，SF-BUZ-52）。open 是唯一可处理状态；Relay 举报表是唯一权威，Core 不复制（DD-125(2)）。
 */
export enum ModerationReportStatus {
    Dismissed = "dismissed",
    Escalated = "escalated",
    Open = "open",
    Resolved = "resolved",
}

/**
 * 举报目标类别（Relay report_json.target_kind）：event 为消息事件、pubkey 为成员、blob 为附件（SF-BUZ-52）。
 */
export enum ModerationReportTargetKind {
    Blob = "blob",
    Event = "event",
    Pubkey = "pubkey",
}

/**
 * GET /api/v1/moderation/restricted（DD-125(2)、V-SCN-127）：Relay community_bans
 * 中当前有效的封禁与禁言，是唯一权威；Core 以 Tenant CONTROL 经 NIP-98 读取 /moderation/restricted，只回给 fresh
 * Tenant manage 的请求者，每次读取写 ACCESS 审计，不复制。成员与原版一样读不到自己的限制。
 */
export interface ModerationRestrictionPage {
    items: ModerationRestrictionView[];
}

export interface ModerationRestrictionView {
    /**
     * RFC3339；永久封禁缺省
     */
    banExpiresAt?: string;
    banned:        boolean;
    /**
     * RFC3339；未禁言缺省
     */
    mutedUntil?: string;
    /**
     * 该公钥属于本 Tenant 某 HUMAN Principal 时给出
     */
    principalId?: string;
    pubkey:       string;
    /**
     * RFC3339
     */
    updatedAt: string;
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
     * 当前固定 Relay NIP-11 的 max_limit；旧客户端忽略，新 Pulse 消费者缺失时不猜测上限。
     */
    relayQueryLimit?: number;
    /**
     * 原生端直连的 Relay 地址
     */
    relayUrl: string;
}

/**
 * Binding SERVICE transport. Command, observation and scope/resource access additionally
 * require the independently verified native HUMAN token. readReceipt is SERVICE-only
 * incurred-usage metadata for the already admitted original HUMAN SYNC operation; it never
 * authorizes content disclosure. Tokens stay in transport, not this document.
 */
export interface NativeHumanActionRequest {
    /**
     * Native metadata access uses existing tenant/workspace permissions. Scope and identity
     * come exclusively from the authenticated binding and HUMAN token, never from
     * client-selected IDs. This is not Action admission or a reusable ticket.
     */
    authorizeScope?: NativeHumanScopeQuery;
    bindingId:       string;
    command?:        CommandClass;
    idempotencyKey?: string;
    /**
     * Same-request writer admission for the original dispatched AE/EE and native intent, never
     * another execute. Both the binding SERVICE and independent current HUMAN credentials are
     * required.
     */
    nativeExecutionAdmission?: NativeHumanActionRequestNativeExecutionAdmission;
    readReceipt?:              ReadReceiptClass;
    /**
     * Read the already-registered exact native object for the verified HUMAN and action. This
     * never creates a Resource or native object.
     */
    resolveResource?: NativeHumanResourceQuery;
    sourceResources?: SourceResourceElement[];
}

/**
 * Native metadata access uses existing tenant/workspace permissions. Scope and identity
 * come exclusively from the authenticated binding and HUMAN token, never from
 * client-selected IDs. This is not Action admission or a reusable ticket.
 */
export interface NativeHumanScopeQuery {
    permission: Permission;
}

export enum Permission {
    Discover = "discover",
    Manage = "manage",
}

/**
 * POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
 * actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
 */
export interface CommandClass {
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
     * 仅 application_binding.create 的瞬态输入（03 §9、DD-70）：按已批准 release 的 secretSchema 逐项提交 secret
     * 值，每个 secretKey 恰好一项。Core 在同一 Governed Action 的准入通过后写入该 Tenant 的 OpenBao namespace，只把版本号记成
     * SecretRef；值不进入 Params、ActionExecution、日志、Workflow history、AuditEvent 或回应。其他命令禁止携带。
     */
    bindingSecretValues?: CommandBindingSecretValue[];
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
     * 仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
     * 授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
     */
    grantPermission?: ResourceGrantPermission;
    huddleAgent?:     HuddleAgentClass;
    /**
     * 仅 huddle.agent.add / huddle.agent.remove / huddle.end 且必带（DD-125(3)）：目标
     * HuddleBuzzBinding；父 Workspace 的 Huddle 另须 workspaceId 等于其父 Workspace。
     */
    huddleId?:    string;
    huddleStart?: HuddleStartClass;
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
     * 仅 moderation.message.delete 且必带（DD-125(2)）：workspaceId 所指 Workspace Channel 中一条消息的 Relay
     * 事件 ID；Core 以 CONTROL 回读确认属于该 Channel 后签 9005，按 DD-81 以 9005 事件 ID 对账。
     */
    moderationEventId?: string;
    /**
     * 仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
     * 是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
     * CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
     * agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
     */
    moderationMember?: CommandModerationMember;
    /**
     * 仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
     * conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
     * kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
     */
    moderationReport?: CommandModerationReport;
    /**
     * 仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
     * ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
     */
    moderationResolution?: CommandModerationResolution;
    /**
     * workspace.create 或 AgentDefinition 创建/更新的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
     */
    name?: string;
    /**
     * 任务控制只接收原 ActionExecution ID；原 Workflow、target 与 scope 由 Core 解析。Agent
     * 回合中断（task.cancel.agent.invoke.v1）的发起人可以是原发起人或该 Installation manage 持有人（DD-125(6) 扩展
     * DD-84），其余规则不变
     */
    originalActionExecutionId?: string;
    /**
     * 成员动作的目标 Principal；resource.transfer_owner 的新 owner；resource.grant_read/revoke_read 的同
     * Tenant 接收者，Core 核对真实 HUMAN 成员、原 AGENT Installation 或 receiverResource 所属 SERVICE
     */
    principalId?: string;
    /**
     * Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
     * identity; no Agent or caller-selected native credentials.
     */
    protocolSessionOpen?: ProtocolSessionOpenClass;
    /**
     * 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
     * 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
     * Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
     */
    receiverResource?: CommandReceiverResource;
    resourceCreate?:   ResourceCreateClass;
    /**
     * Resource 管理动作的目标；Core 重新核对同 Tenant、scope、owner 和投影。agent.installation.disable /
     * agent.installation.enable（DD-125(6)、05 §2.11）只带 resourceId、resourceVersion 与
     * explicitConfirmation=true：目标 Workspace 由 Installation 的 home Workspace
     * 解析（TARGET_HOME_WORKSPACE），不接受 workspaceId、assetId 或其他参数；原“重启”是 assetId 等于固定 Version 的
     * agent.installation.upgrade
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
    tenantId?: string;
    /**
     * 仅 tenant.quota.set（DD-123）
     */
    tenantQuotaSetting?: TenantQuotaSettingClass;
    /**
     * 仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
     * explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
     */
    workspaceCanvas?:  WorkspaceCanvasClass;
    workspaceChannel?: WorkspaceChannelClass;
    /**
     * Workspace 内动作的执行 Workspace
     */
    workspaceId?: string;
    /**
     * 仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
     * 或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
     */
    workspaceUpdate?: WorkspaceUpdateClass;
    /**
     * 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
     */
    workspaceVisibility?: WorkspaceVisibility;
}

export interface CommandBindingSecretValue {
    secretKey: string;
    value:     string;
}

/**
 * 仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
 * 是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
 * CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
 * agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
 */
export interface CommandModerationMember {
    /**
     * 64 位小写十六进制 Nostr 公钥
     */
    targetPubkey:     string;
    timeoutDuration?: ModerationTimeoutDuration;
}

/**
 * 仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
 * conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
 * kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
 */
export interface CommandModerationReport {
    /**
     * 消息所在私聊；本人须为其当前参与者
     */
    conversationId?: string;
    /**
     * 被举报消息的 Relay 事件 ID（64 位小写十六进制）
     */
    eventId: string;
    /**
     * 原“补充说明（可选）”，至多 1000 字符
     */
    note?:      string;
    reportType: ModerationReportType;
    /**
     * 消息所在 Workspace Channel；本人须为其当前成员
     */
    workspaceId?: string;
}

/**
 * 仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
 * ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
 */
export interface CommandModerationResolution {
    reportEventIds:   string[];
    resolutionAction: ModerationResolutionAction;
    status:           ModerationResolutionStatus;
}

/**
 * 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
 * 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
 * Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
 */
export interface CommandReceiverResource {
    id:      string;
    version: number;
}

/**
 * Same-request writer admission for the original dispatched AE/EE and native intent, never
 * another execute. Both the binding SERVICE and independent current HUMAN credentials are
 * required.
 */
export interface NativeHumanActionRequestNativeExecutionAdmission {
    actionExecutionId:   string;
    externalExecutionId: string;
    nativeIntentId:      string;
}

/**
 * Original HUMAN synchronous application read completion, authenticated by its binding
 * SERVICE. Metadata only; no body, replacement identity, native Task or ExternalExecution.
 */
export interface ReadReceiptClass {
    completedAt:     string;
    contentBytes:    number;
    contentSha256:   string;
    idempotencyKey:  string;
    measurements:    ReadReceiptMeasurement[];
    nativeObjectRef: string;
    nativeRevision:  string;
    operationId:     string;
    startedAt:       string;
}

export interface ReadReceiptMeasurement {
    meterKey: string;
    quantity: number;
}

/**
 * Read the already-registered exact native object for the verified HUMAN and action. This
 * never creates a Resource or native object.
 */
export interface NativeHumanResourceQuery {
    actionKey:     string;
    actionVersion: number;
    nativeRef:     string;
    nativeType:    string;
    workspaceId?:  string;
}

/**
 * Reference-only observation of the original HUMAN AE. Component terminal status comes from
 * original component-action audit after native/usage reconciliation. Native-origin platform
 * resource permission actions use their exact permission-outcome audit; that outcome does
 * not assert completion of a component's native sharing RPCs. Never infer a terminal result
 * from HTTP acceptance.
 */
export interface NativeHumanActionResult {
    /**
     * Original admitted canonical capability metadata input; exactly one input form, never a
     * result body or a new execution authority.
     */
    inputJson?:      string;
    inputReference?: ContentReferenceElement;
    /**
     * Original dispatched native-writer reference only. Neither existence nor RUNNING proves
     * byte completion; no bearer is exposed by observation.
     */
    nativeExecution?: NativeExecution;
    /**
     * Transient same-request writer bearer for the exact original AE/EE. The native task must
     * atomically claim the byte step before using it; never persisted or exposed to the browser.
     */
    nativeExecutionAdmission?: NativeHumanActionResultNativeExecutionAdmission;
    nativeId?:                 string;
    nativeType?:               string;
    /**
     * First native same-request read only. Never returned by idempotency observation or retried
     * admission; the bearer is not persisted.
     */
    readAdmission?:  ReadAdmission;
    submission:      SubmissionClass;
    terminalStatus?: TaskStatus;
}

/**
 * Original dispatched native-writer reference only. Neither existence nor RUNNING proves
 * byte completion; no bearer is exposed by observation.
 */
export interface NativeExecution {
    bindingGeneration:   number;
    externalExecutionId: string;
    idempotencyKey:      string;
    nativeIntentId:      string;
}

/**
 * Transient same-request writer bearer for the exact original AE/EE. The native task must
 * atomically claim the byte step before using it; never persisted or exposed to the browser.
 */
export interface NativeHumanActionResultNativeExecutionAdmission {
    actionToken:   string;
    argumentsJson: string;
    /**
     * RFC3339 admission expiry, preserved verbatim across language bindings and validated by
     * the native writer before every byte step.
     */
    expiresAt: string;
}

/**
 * First native same-request read only. Never returned by idempotency observation or retried
 * admission; the bearer is not persisted.
 */
export interface ReadAdmission {
    actionToken:   string;
    argumentsJson: string;
    expiresAt:     number;
}

/**
 * POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
 * 必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite
 * 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。webhookSecret 同理，只在生成或轮换 WEBHOOK 密钥的 automation.enable /
 * automation.rotate_webhook_secret 首次回应中出现（DD-116）。
 */
export interface SubmissionClass {
    actionExecutionId:   string;
    actionKey:           string;
    approvalWorkflowId?: string;
    dispatchState:       ActionDispatchState;
    documentLaunch?:     LaunchDescriptorClass;
    gateState:           ActionGateState;
    /**
     * 仅 huddle.start（DD-125(3)）：Core 预分配的 HuddleBuzzBinding；同一幂等键的重放给出同一值
     */
    huddleId?:          string;
    invitation?:        InvitationClass;
    operationId:        string;
    protocolSessionId?: string;
    reason?:            ReasonCode;
    webhookSecret?:     WebhookSecretClass;
    workflowId?:        string;
}

/**
 * Original HUMAN synchronous application read completion, authenticated by its binding
 * SERVICE. Metadata only; no body, replacement identity, native Task or ExternalExecution.
 */
export interface NativeHumanReadReceipt {
    completedAt:     string;
    contentBytes:    number;
    contentSha256:   string;
    idempotencyKey:  string;
    measurements:    NativeHumanReadReceiptMeasurement[];
    nativeObjectRef: string;
    nativeRevision:  string;
    operationId:     string;
    startedAt:       string;
}

export interface NativeHumanReadReceiptMeasurement {
    meterKey: string;
    quantity: number;
}

/**
 * Current already-registered native Resource selected under the original HUMAN action
 * permission. Metadata only, not an admission ticket; submission rechecks version, binding
 * and permission.
 */
export interface NativeHumanResourceResult {
    resource: NativeHumanResourceSelection;
}

export interface NativeHumanResourceSelection {
    nativeInstanceRef: string;
    nativeRef:         string;
    nativeScopeRef:    string;
    nativeType:        string;
    resourceId:        string;
    resourceVersion:   number;
}

/**
 * Fresh permission check for native metadata in the authenticated binding's existing
 * tenant/workspace scope. Not an ActionExecution, permission cache, or execution ticket;
 * native Resource bodies still require their own current read permission.
 */
export interface NativeHumanScopeResult {
    scope: NativeHumanScopeSelection;
}

export interface NativeHumanScopeSelection {
    bindingId:         string;
    checkedRevision:   string;
    generation:        number;
    nativeInstanceRef: string;
    nativeScopeRef:    string;
    permission:        Permission;
    tenantId:          string;
    workspaceId?:      string;
}

/**
 * 一个用量结算状态在所选范围与区间内的根业务操作数量。只列出现过的状态，不补零。
 */
export interface OperationUsageCount {
    count: number;
    state: OperationUsageState;
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
 * DD-40 original Projects Added/remove preference. Native coordinate only, not membership
 * or content permission. Uses the same CollaborationUserState version CAS.
 */
export interface ProjectPreferenceRequest {
    projectAddress: string;
    selected:       boolean;
    version:        number;
}

/**
 * DD-118: the original Buzz Desktop merge_project_pull_request through BFF. Only when the
 * person's own SERVER key is the repository coordinate owner: Core merges the review's
 * source branch into the target branch in a temporary clone, pushes as that owner (Relay
 * pre-receive policy decides), then publishes the owner-signed original kind 1631 merged
 * status through the existing publication chain. Carries the Idempotency-Key header; the
 * push is keyed by (repository, target ref, old->new) and reconciled from info/refs; 1631
 * follows DD-81.
 */
export interface ProjectsGitMergeRequest {
    /**
     * Original expected source head; a moved source branch is a conflict, never a silent merge
     * of other commits.
     */
    expectedCommit: string;
    /**
     * The original 1618 review being merged.
     */
    pullRequestEventId: string;
    repository:         string;
    sourceBranch:       string;
    targetBranch:       string;
}

/**
 * DD-118: the original ProjectRepoMergeResult without its English message. statusEventId is
 * the owner-signed 1631 merged status; it is present once that publication is accepted.
 */
export interface ProjectsGitMergeResponse {
    mergeCommit:    string;
    statusEventId?: string;
}

/**
 * DD-118: the original Buzz Desktop remote repository reads
 * (get_project_repo_snapshot/get_project_repo_file_content/get_project_repo_diff) through
 * BFF. The repository is named by its 30617 coordinate, never by a clone URL; Relay
 * authorize_git_read decides access with the person's own SERVER identity.
 */
export interface ProjectsGitQueryRequest {
    baseBranch?:    string;
    defaultBranch?: string;
    /**
     * FILE_CONTENT only.
     */
    path?:         string;
    repository:    string;
    targetCommit?: string;
    targetRef?:    string;
    view:          ProjectsGitQueryRequestView;
}

export enum ProjectsGitQueryRequestView {
    Diff = "DIFF",
    FileContent = "FILE_CONTENT",
    Snapshot = "SNAPSHOT",
}

/**
 * DD-118: exactly one of snapshot/content/diff matches the requested view, in the original
 * Buzz Desktop shapes (ProjectRepoSnapshot, file preview, ProjectRepoDiff) with the
 * original 64 KiB, 2000-line and 250-file bounds.
 */
export interface ProjectsGitQueryResponse {
    /**
     * FILE_CONTENT preview; null when the file is binary or over the original preview bound.
     */
    content?:  null | string;
    diff?:     ProjectRepoDiff;
    snapshot?: ProjectRepoSnapshot;
    view:      ProjectsGitQueryRequestView;
}

export interface ProjectRepoDiff {
    additions:  number;
    commitBody: null | string;
    deletions:  number;
    files:      ProjectRepoDiffFile[];
}

export interface ProjectRepoDiffFile {
    additions: number;
    deletions: number;
    patch:     string;
    path:      string;
    truncated: boolean;
}

export interface ProjectRepoSnapshot {
    commits:      ProjectRepoCommit[];
    contributors: ProjectRepoContributor[];
    files:        ProjectRepoFile[];
    /**
     * Absent when the original value is null.
     */
    latestCommit?: ProjectRepoCommit;
}

/**
 * Absent when the original value is null.
 */
export interface ProjectRepoCommit {
    authorEmail: string;
    authorName:  string;
    hash:        string;
    shortHash:   string;
    subject:     string;
    timestamp:   number;
}

export interface ProjectRepoContributor {
    commitCount:  number;
    email:        string;
    lastCommitAt: number;
    name:         string;
}

export interface ProjectRepoFile {
    kind:          string;
    lastChangedAt: number | null;
    /**
     * Absent when the original value is null.
     */
    latestCommit?:  ProjectRepoCommit;
    path:           string;
    previewContent: null | string;
    size:           number | null;
}

/**
 * DD-118: the original Buzz Desktop
 * create_project_remote_branch/delete_project_remote_branch through BFF. The person's own
 * SERVER identity pushes to the Relay repository named by its 30617 coordinate; Relay
 * pre-receive policy decides. The request carries the Idempotency-Key header; the push is
 * keyed by (repository, ref, old->new) and reconciled from info/refs.
 */
export interface ProjectsGitRefRequest {
    /**
     * CREATE_BRANCH: the new branch. DELETE_BRANCH: the branch to delete.
     */
    branch: string;
    /**
     * CREATE_BRANCH: the source branch head the new branch starts at. DELETE_BRANCH: the branch
     * head being deleted.
     */
    expectedCommit: string;
    operation:      ProjectGitRefOperation;
    repository:     string;
    /**
     * CREATE_BRANCH only: the original source branch.
     */
    sourceBranch?: string;
}

export enum ProjectGitRefOperation {
    CreateBranch = "CREATE_BRANCH",
    DeleteBranch = "DELETE_BRANCH",
}

/**
 * DD-118: the original ProjectRepoBranchResult without its English message; the branch and
 * the commit the ref now points at (DELETE_BRANCH: the deleted head).
 */
export interface ProjectsGitRefResponse {
    branch: string;
    commit: string;
}

/**
 * Typed original Community announcement mutation. Actor is the authenticated SERVER or
 * CLIENT signer, never supplied by this request. Creation resolves the home Channel from an
 * admitted Workspace; metadata is transient and remains Relay-owned. DELETE selects a real
 * signed current announcement; it does not delete its channel or repositories.
 * CREATE_PULL_REQUEST publishes the original NIP-34 1618 review for a branch already on the
 * repository (DD-118); the push itself is not part of this request. APPROVE_PULL_REQUEST
 * and the request-changes / inline-line variants of CREATE_PULL_REQUEST_COMMENT publish the
 * original labeled kind-1 review comments (desktop
 * pullRequestReviews.ts::submitProjectPullRequestReview,
 * hooks.ts::createProjectPullRequestComment) against the named review head; they introduce
 * no new Nostr kind (DD-118(5)). ATTACH_REPOSITORY (original useAttachProjectRepository /
 * useAddProjectRepository) republishes the signer's current 30621 head named by
 * targetEventId with one more member `a` coordinate; every other tag and the content are
 * kept. BIND_REPOSITORY_CHANNEL (original useBindProjectRepositoryChannel) republishes the
 * signer's current 30617 head with `buzz-channel` replaced by the admitted Workspace's
 * Channel. ADD_PROJECT_CHANNEL (original useAddProjectChannel) appends that Channel as a
 * `buzz-related-channel` tag to the signer's current 30621 head; the Channel itself is
 * created by the existing workspace.create action, never by this request. None of them
 * grants Git, Channel or project authority (REQ-24, DD-80, DD-118).
 */
export interface ProjectsPublishRequest {
    /**
     * Original inline diff anchor `line`: a 1-based line on the given side of the review diff.
     */
    anchorLine?: number;
    /**
     * Original inline diff anchor `file` (normalizeProjectPullRequestCommentAnchor):
     * repository-relative, no leading slash, backslash, NUL, empty, `.` or `..` segment; at
     * most 4096 UTF-16 code units. Only on CREATE_PULL_REQUEST_COMMENT, together with
     * anchorSide, anchorLine and commit.
     */
    anchorPath?: string;
    /**
     * Original inline diff anchor `side`.
     */
    anchorSide?: ProjectPullRequestCommentSide;
    /**
     * Original transient display label, trimmed and limited to 128 Unicode characters by the
     * consumer. Never an identity or authorization claim.
     */
    assigneeLabel?: string;
    /**
     * Other HUMAN recipient of an original issue-author/repository-owner assignment. Resolved
     * against the admitted Tenant's existing HUMAN identity directory; never a signing
     * identity. Self operations do not accept this field.
     */
    assigneePubkey?: string;
    attachments?:    AttachmentElement[];
    /**
     * Original complete markdown including attachment markdown. Issues may be empty; comments
     * must be nonempty after trim. Current Relay NIP-11 and body admission limits are enforced
     * before signing.
     */
    body?: string;
    /**
     * Original 1618 `branch-name`: the compare branch, already present on the Relay repository.
     */
    branchName?: string;
    category?:   ProjectIssueCategory;
    /**
     * CREATE_REPOSITORY only: the original optional `clone` tag of a new repository
     * announcement (AddProjectRepositoryDialog Clone URL). Only metadata: Kailo reads
     * repository content through the 30617 coordinate (DD-118) and never fetches this URL.
     */
    cloneUrl?: string;
    /**
     * Original `c`. CREATE_PULL_REQUEST: compare branch head read from the trusted repository
     * state. APPROVE_PULL_REQUEST and CREATE_PULL_REQUEST_COMMENT with reviewDecision or an
     * anchor: the review head the reviewer looked at; the consumer refuses with
     * TARGET_STATE_CONFLICT unless it is still the review's current trusted head. Required by
     * those review comments and refused on ordinary comments.
     */
    commit?:      string;
    description?: string;
    mentions?:    string[];
    /**
     * Original 1618 `merge-base`, when known.
     */
    mergeBase?: string;
    name?:      string;
    operation:  ProjectPublicationOperation;
    /**
     * Optional immutable original per-self assignment operation head. Same publication intent
     * retains it across UNKNOWN observation; never an authorization grant.
     */
    priorEventId?: string;
    /**
     * Original pullRequestReviews.ts lifecycle states the UI may publish (NIP-34
     * 1630/1633/1632). Merged (1631) happens through git and is never accepted here. Only the
     * review author or repository owner signs it.
     */
    pullRequestStatus?: ProjectPullRequestLifecycleStatus;
    /**
     * ATTACH_REPOSITORY only: the original NIP-34 repository coordinate added as a member `a`
     * tag. A coordinate, never a clone URL or an access grant; the repository head may not
     * exist yet when it is the first step of the original add-repository sequence.
     */
    repositoryAddress?: string;
    /**
     * Original hooks.ts ProjectPullRequestCommentDecision on CREATE_PULL_REQUEST_COMMENT only:
     * adds the `changes-requested` label. Only a requested reviewer or the repository owner,
     * never the review author, may request changes on an open or draft review; readers trust
     * nothing else (projectPullRequests.mjs).
     */
    reviewDecision?: ProjectPullRequestCommentDecision;
    /**
     * Original requested reviewers (p tags beside the repository owner). Never a signing
     * identity or grant.
     */
    reviewers?: string[];
    /**
     * Original 1618 `target-branch`: the base branch.
     */
    targetBranch?:  string;
    targetEventId?: string;
    /**
     * Original trimmed issue subject; the consumer additionally enforces the original
     * JavaScript 256 UTF-16 code-unit limit.
     */
    title?:       string;
    visibility?:  ProjectListingVisibility;
    workspaceId?: string;
}

/**
 * Original inline diff anchor `side`.
 */
export enum ProjectPullRequestCommentSide {
    New = "new",
    Old = "old",
}

export interface AttachmentElement {
    /**
     * 原 Buzz imeta 模糊预览编码。
     */
    blurhash?: string;
    /**
     * 原 Buzz imeta 媒体尺寸显示元数据。
     */
    dim?: string;
    /**
     * 原附件 Markdown 链接显示名称；与 filename 分离，只写入消息正文，不生成 imeta 字段。
     */
    displayLabel?: string;
    /**
     * 原 video/mp4 时长（秒），须为正有限数；Relay 校验原 sidecar。
     */
    duration?: number;
    /**
     * 原 Buzz imeta filename；仅为显示及下载名称，不参与媒体存储寻址。
     */
    filename?: string;
    /**
     * 原 video/mp4 独立 poster 图片引用；只允许当前 Community 的媒体路径，Relay 校验原图片 sidecar。
     */
    image?: string;
    sha256: string;
    size:   number;
    /**
     * 沿原 Buzz Markdown 隐藏图片或视频；普通文件仍为文件链接。
     */
    spoiler?: boolean;
    /**
     * 当前 Community 内与附件 hash 相同的原 .thumb.jpg 引用；Relay 验证实际缩略图存在。
     */
    thumb?: string;
    type:   string;
    url:    string;
}

export enum ProjectIssueCategory {
    ChangeRequest = "change-request",
    Improvement = "improvement",
    Issue = "issue",
}

export enum ProjectPublicationOperation {
    AddProjectChannel = "ADD_PROJECT_CHANNEL",
    ApprovePullRequest = "APPROVE_PULL_REQUEST",
    AssignIssue = "ASSIGN_ISSUE",
    AttachRepository = "ATTACH_REPOSITORY",
    BindRepositoryChannel = "BIND_REPOSITORY_CHANNEL",
    CreateIssue = "CREATE_ISSUE",
    CreateIssueComment = "CREATE_ISSUE_COMMENT",
    CreateProject = "CREATE_PROJECT",
    CreatePullRequest = "CREATE_PULL_REQUEST",
    CreatePullRequestComment = "CREATE_PULL_REQUEST_COMMENT",
    CreateRepository = "CREATE_REPOSITORY",
    Delete = "DELETE",
    SelfAssignIssue = "SELF_ASSIGN_ISSUE",
    SelfUnassignIssue = "SELF_UNASSIGN_ISSUE",
    SetPullRequestStatus = "SET_PULL_REQUEST_STATUS",
    UnassignIssue = "UNASSIGN_ISSUE",
}

/**
 * Original pullRequestReviews.ts lifecycle states the UI may publish (NIP-34
 * 1630/1633/1632). Merged (1631) happens through git and is never accepted here. Only the
 * review author or repository owner signs it.
 */
export enum ProjectPullRequestLifecycleStatus {
    Closed = "closed",
    Draft = "draft",
    Open = "open",
}

/**
 * Original hooks.ts ProjectPullRequestCommentDecision on CREATE_PULL_REQUEST_COMMENT only:
 * adds the `changes-requested` label. Only a requested reviewer or the repository owner,
 * never the review author, may request changes on an open or draft review; readers trust
 * nothing else (projectPullRequests.mjs).
 */
export enum ProjectPullRequestCommentDecision {
    RequestChanges = "request-changes",
}

export enum ProjectListingVisibility {
    Listed = "listed",
    Unlisted = "unlisted",
}

/**
 * Original Buzz Community project/repository announcements, coordinate-scoped work-item
 * events and tombstones. Reads do not authorize Git transport or mutations.
 * REPOSITORY_STATES returns the original trusted 30618 repository state (signed by the
 * coordinate owner or the Relay itself) for the requested 30617 coordinates.
 */
export interface ProjectsQueryRequest {
    coordinates?: string[];
    since?:       number;
    until?:       number;
    view:         ProjectsQueryRequestView;
}

export enum ProjectsQueryRequestView {
    Deletions = "DELETIONS",
    Projects = "PROJECTS",
    Repositories = "REPOSITORIES",
    RepositoryStates = "REPOSITORY_STATES",
    WorkItemActivity = "WORK_ITEM_ACTIVITY",
    WorkItems = "WORK_ITEMS",
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
    reference:              ContentReferenceElement;
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

export interface PulsePublishRequest {
    attachments?:   AttachmentElement[];
    content:        string;
    mentions?:      string[];
    operation:      Operation;
    targetEventId?: string;
}

export enum Operation {
    Like = "LIKE",
    Note = "NOTE",
    Unlike = "UNLIKE",
}

export interface PulseQueryRequest {
    authors?:  string[];
    before?:   number;
    eventIds?: string[];
    view:      PulseQueryRequestView;
}

export enum PulseQueryRequestView {
    Agents = "AGENTS",
    Contacts = "CONTACTS",
    Liked = "LIKED",
    Notes = "NOTES",
    Profiles = "PROFILES",
    Reactions = "REACTIONS",
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
 * Original reminder create/complete/snooze/cancel. Identity comes only from the
 * authenticated host; mutations select the actual current signed 30300 head. Source
 * messages are freshly authorized and read by the host; no caller-supplied preview, author,
 * kind, ciphertext or key is trusted.
 */
export interface ReminderPublishRequest {
    channelId?:     string;
    eventId?:       string;
    notBefore?:     number;
    note?:          string;
    operation:      ReminderOperation;
    sourceEventId?: string;
}

export enum ReminderOperation {
    Cancel = "CANCEL",
    Complete = "COMPLETE",
    Create = "CREATE",
    Snooze = "SNOOZE",
}

/**
 * 原 Reminder 目标引用重新读取；字段只是查找键，必须重做当前用户、channel scope 与事件签名/归属检查，不能以已解密提醒或目录缓存授予正文读取。
 */
export interface ReminderSourceRequest {
    channelId: string;
    eventId:   string;
}

/**
 * Original Buzz 30300 author-only encrypted reminder, decrypted only by its own SERVER or
 * local CLIENT identity. A transient Relay read, never a Core body record. Embedded target
 * metadata is a historical preview, not current authorization.
 */
export interface ReminderView {
    content:    ReminderContent;
    createdAt:  number;
    eventId:    string;
    id:         string;
    notBefore?: number;
}

export interface ReminderContent {
    note?:   string;
    status:  ReminderStatus;
    target?: ReminderTarget;
}

export enum ReminderStatus {
    Cancelled = "cancelled",
    Done = "done",
    Pending = "pending",
}

export interface ReminderTarget {
    authorPubkey: string;
    channelId:    string;
    eventId:      string;
    preview:      string;
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
    /**
     * 当前 Workspace manage 与 workspace.member.add 目录均有效且已开放，目标在该 Workspace 没有未撤销的
     * WorkspaceMembership（不存在或 REVOKED）；省略或 false 不显示添加动作，提交仍重新准入。
     */
    canAddToWorkspace?:     boolean;
    canGrantTenantAdmin:    boolean;
    canGrantWorkspaceAdmin: boolean;
    /**
     * 当前 Tenant manage 与 tenant.member.revoke 目录均有效，且不是最后有效 Tenant admin；提交仍走原审批与重新准入，省略或 false
     * 不显示动作。
     */
    canRemoveFromTenant?: boolean;
    /**
     * 当前 Workspace manage 与 workspace.member.revoke 目录均有效，目标存在可撤 WorkspaceMembership；省略或 false
     * 不显示动作，提交仍重新准入。
     */
    canRemoveFromWorkspace?: boolean;
    canRevokeTenantAdmin:    boolean;
    canRevokeWorkspaceAdmin: boolean;
    /**
     * RFC3339，TenantMembership 的原始创建时间，用于原版 Added 日期；不是审批通过、激活或最近重新加入时间。只向具有 Tenant manage
     * 的查看者提供，旧服务或仅 Workspace manage 时省略，客户端不编造日期。
     */
    createdAt?:  string;
    displayName: string;
    /**
     * 有效 Tenant admin 仅剩此人；该人的撤销按钮禁用，服务端最终准入仍重查
     */
    lastTenantAdmin: boolean;
    principalId:     string;
    /**
     * 同一 Tenant、同一 HUMAN Principal 当前 ACTIVE 的 Buzz 身份公钥，按公钥排序；仅向具有 Tenant manage
     * 的查看者提供非空列表，无有效绑定、旧服务或仅 Workspace manage 时省略。缺省不提供可读取资料的身份凭据，不以当前查看者或其他 Workspace 身份替代。
     */
    pubkeys?:    string[];
    tenantAdmin: boolean;
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
    /**
     * 当前 Tenant 的显示名，也就是其绑定 Community 的名称（01 §2：一个 Tenant 绑定一个
     * Community），只用于界面上认出本人所在社区，不参与任何判定；读不到时缺省
     */
    tenantName?:       string;
    tenantPrincipalId: string;
}

/**
 * PlatformSession.access_mode（.design/03 §2）；受限会话不授予普通管理面或协作面准入。
 */
export enum PlatformSessionAccessMode {
    Full = "FULL",
    LifecycleRestricted = "LIFECYCLE_RESTRICTED",
}

/**
 * PUT /api/v1/user-state/sidebar-assignments 的请求体（DD-125(5)）：原
 * assignChannel/unassignChannel。channelKey 是原生 Buzz Channel ID，必须属于本人当前是成员的 Workspace
 * 或参与中的私聊；sectionId 缺省即移出分区，给出时必须是现有分区。每人至多 1000 个归属（原
 * MAX_CHANNEL_SECTION_ASSIGNMENTS）。失去资格的归属保留但不呈现。version 不符即 409。
 */
export interface SidebarAssignmentRequest {
    channelKey: string;
    sectionId?: string;
    version:    number;
}

/**
 * PUT /api/v1/user-state/sidebar-sections/{sectionId} 的请求体（DD-125(5)、03
 * CollaborationUserState.sidebar_sections）：新建或改名原自定义频道分区；sectionId 由客户端以 UUID 生成。name
 * 去首尾空白后非空，icon 缺省即无图标，order 是原分区顺序。每人至多 100 个分区（原 MAX_CHANNEL_SECTIONS）。version 不符即
 * 409。DELETE 同一路径以 UserStateVersion 为请求体，同时清除指向该分区的归属与该分区的排序分组。
 */
export interface SidebarSectionRequest {
    icon?:   string;
    name:    string;
    order:   number;
    version: number;
}

/**
 * PUT /api/v1/user-state/sidebar-section-order 的请求体（DD-125(5)）：原
 * reorderSections/moveSectionUp/moveSectionDown 的结果顺序。sectionIds 必须恰为当前全部分区 ID 的一个排列，Core
 * 按下标写回 order。version 不符即 409。
 */
export interface SidebarSectionOrderRequest {
    sectionIds: string[];
    version:    number;
}

/**
 * PUT /api/v1/user-state/sidebar-sort 的请求体（DD-125(5)、03
 * CollaborationUserState.sidebar_sort）：原分组排序。groupKey 只接受原固定分组 starred/channels/forums/dms
 * 或 section:<现有分区 ID>；每人至多 104 个分组（原 MAX_CHANNEL_SORT_GROUPS）。version 不符即 409。
 */
export interface SidebarSortRequest {
    groupKey: string;
    mode:     SidebarSortMode;
    version:  number;
}

/**
 * 原 Buzz 侧栏分组排序（channelSortPreference.ts::ChannelSortMode）：alpha 按名称，recent
 * 按最近消息（DD-125(5)）。
 */
export enum SidebarSortMode {
    Alpha = "alpha",
    Recent = "recent",
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
 * DD-123: platform quota items of the Tenant read from OpenMeter (the only authority).
 * Tenant admin and auditor only.
 */
export interface TenantQuotaPage {
    quotas: TenantQuotaView[];
    /**
     * Present only when the caller may set quotas now (Tenant manage); auditors read without it.
     */
    setActionKey?: SetActionKey;
}

export interface TenantQuotaView {
    feature:         TenantQuotaFeature;
    hardLimit:       boolean;
    hasAccess:       boolean;
    limitPerPeriod?: number;
    periodResetAt?:  Date;
    usage?:          number;
}

export enum SetActionKey {
    TenantQuotaSet = "tenant.quota.set",
}

/**
 * PUT /api/v1/user-state/threads 的请求体（DD-40、DD-125(1)、03
 * CollaborationUserState.thread_preferences）。threadKey 为 thread:<Buzz root event id>，Core
 * 以本人 SERVER 身份回读根事件并核验当前 Workspace 成员或私聊参与资格。保留原联动：followed=true 记 FOLLOWED（关注即解除静音），false
 * 记 MUTED（取消关注即静音）；每人至多 500 条，超出淘汰最早写入的关注。version 是读到的 CollaborationUserState 版本，不符即 409。不是
 * Governed Action。
 */
export interface ThreadPreferenceRequest {
    followed:  boolean;
    threadKey: string;
    version:   number;
}

/**
 * GET /api/v1/usage-billing：Tenant 或其中一个 Workspace 在区间内的用量与账单视图（.design/11 §6–7、.design/14
 * §7–8），调用方须对该范围持有 audit permission，每次 fresh Check。committed usage、额度与账单直接读 OpenMeter，Core
 * 不复制或聚合成账本；投递计数只来自 Core UsageEvent outbox。缺口用确定状态表达，不显示零或已结算。
 */
export interface UsageBillingView {
    billingState:     UsageSectionState;
    customerState:    UsageCustomerState;
    delivery:         UsageDeliveryCount[];
    entitlements:     UsageEntitlementView[];
    entitlementState: UsageSectionState;
    /**
     * RFC3339，含
     */
    from:           string;
    invoices:       UsageInvoiceView[];
    meters:         UsageMeterView[];
    operationUsage: UsageStateElement[];
    tenantId:       string;
    /**
     * RFC3339，不含
     */
    to:           string;
    workspaceId?: string;
}

/**
 * 用量与账单页中额度、账单两类 Customer
 * 级事实的读取结论。AVAILABLE：原生查询成功（列表可以为空）；UNAVAILABLE：原生查询失败或结果不可查证；TENANT_SCOPE_ONLY：所选
 * Workspace 视图不展示 Customer 级事实；NOT_PROVISIONED：Tenant 没有有效 Customer 映射。
 */
export enum UsageSectionState {
    Available = "AVAILABLE",
    NotProvisioned = "NOT_PROVISIONED",
    TenantScopeOnly = "TENANT_SCOPE_ONLY",
    Unavailable = "UNAVAILABLE",
}

/**
 * 当前 Tenant 的 OpenMeter Customer 映射（DD-38、.design/11 §3）。ACTIVE：Core binding 有效且原生 Customer
 * 读回同 Tenant 且未删除；NOT_PROVISIONED：没有 binding；REVOKED：binding 已撤销；UNAVAILABLE：原生事实不可读或与
 * binding 不一致，结果不明。
 */
export enum UsageCustomerState {
    Active = "ACTIVE",
    NotProvisioned = "NOT_PROVISIONED",
    Revoked = "REVOKED",
    Unavailable = "UNAVAILABLE",
}

export interface UsageDeliveryCount {
    count:  number;
    status: UsageSettlementStatus;
}

export interface UsageEntitlementView {
    /**
     * 仅 metered；OpenMeter 十进制原文
     */
    balance?: string;
    /**
     * 原生 entitlement 类型原文
     */
    entitlementType: string;
    featureKey:      string;
    hasAccess:       boolean;
    /**
     * 仅 metered
     */
    overage?: string;
    /**
     * 仅 metered；当前用量周期内的原生 usage
     */
    usage?: string;
}

export interface UsageInvoiceView {
    currency?:          string;
    id:                 string;
    issuedAt?:          string;
    number?:            string;
    servicePeriodFrom?: string;
    servicePeriodTo?:   string;
    /**
     * 原生 invoice status 原文；只有原生终态才可称为已结算
     */
    status: string;
    /**
     * 原生 totals.total 十进制原文
     */
    total?: string;
}

export interface UsageMeterView {
    /**
     * 原生 meter 的聚合方式原文
     */
    aggregation?: string;
    /**
     * ActionDefinition 登记的平台 meter 选择键
     */
    meterKey: string;
    /**
     * 仅 COMMITTED 时给出；OpenMeter 返回的十进制原文
     */
    quantity?: string;
    state:     MeterUsageState;
}

/**
 * 一个已登记 meter 在所选区间内的 OpenMeter committed usage 查询结论（.design/11 §7）。COMMITTED：原生查询返回该
 * Customer 的聚合值；NO_COMMITTED_USAGE：原生查询成功且区间内没有已存储事件；WORKSPACE_DIMENSION_UNAVAILABLE：原生
 * meter 未声明 workspace_id 维度，不能按 Workspace 归因；METER_NOT_REGISTERED：动作登记的 meter 在 OpenMeter
 * 中不存在或不唯一；UNAVAILABLE：查询失败或结果不可查证。后三者都不显示数值。
 */
export enum MeterUsageState {
    Committed = "COMMITTED",
    MeterNotRegistered = "METER_NOT_REGISTERED",
    NoCommittedUsage = "NO_COMMITTED_USAGE",
    Unavailable = "UNAVAILABLE",
    WorkspaceDimensionUnavailable = "WORKSPACE_DIMENSION_UNAVAILABLE",
}

/**
 * CollaborationUserState 写入成功后的新版本（/api/v1/user-state/* 各 PUT/DELETE 的 200 回应）。DD-125 的
 * DELETE /api/v1/user-state/sidebar-sections/{sectionId} 与 DELETE
 * /api/v1/user-state/channel-templates/{templateId} 也以它为请求体：version 是读到的版本，不符即 409。
 */
export interface UserStateVersion {
    version: number;
}

/**
 * GET /api/v1/workspaces/{workspaceId}/canvas（DD-125(4)、V-SCN-135）：BFF 以本人身份在已准入 Workspace
 * 的 Channel 下按 #h 读取 kind 40100，只采纳作者为该 Tenant CONTROL 的最新一条并验签；其他作者的 40100 一律忽略。正文原样透传，不进
 * Core 存储。没有采纳的事件时 content、eventId、createdAt 都省略（原“No canvas set”）。
 */
export interface WebChannelCanvasView {
    /**
     * 原 Markdown 正文；空串表示管理者已清空。
     */
    content?: string;
    /**
     * 被采纳事件的 created_at，RFC3339。
     */
    createdAt?: string;
    /**
     * 被采纳的 CONTROL 40100 事件 ID。
     */
    eventId?: string;
    /**
     * 固定为 workspace.canvas.set：目录已开放、Workspace ACTIVE 且本人经 fresh Workspace manage 检查时给出（≙ 原
     * canEditNarrative）。省略即不显示编辑入口；提交仍重新准入。
     */
    setActionKey?: string;
    workspaceId:   string;
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
    /**
     * 原 39000 topic 标签；Relay 对空主题省略该标签，缺省即无主题。
     */
    topic?:       string;
    ttlDeadline?: Date;
    ttlSeconds?:  number;
}

/**
 * Own NIP-30 set mutation. The admitted host derives the signer and community; omitted
 * imageUrl removes only the caller's entry.
 */
export interface WebCustomEmojiMutation {
    expectedPubkey: string;
    idempotencyKey: string;
    imageUrl?:      string;
    shortcode:      string;
}

/**
 * Verified original per-author kind:30030 snapshots, not a Core-owned emoji directory.
 * Clients apply the original deterministic community union.
 */
export interface WebCustomEmojiView {
    events:     { [key: string]: any }[];
    mediaPaths: { [key: string]: string };
    pubkey:     string;
}

/**
 * GET /api/v1/gifs（DD-125(5)、09 §3、V-SCN-140）：原 GIF 选择器是否出现。available 仅在本 Tenant ACTIVE
 * TenantBuzzBinding 的 NIP-11 快照与运行期文档一致且广告 buzz-gif/gif（provider klipy，原 /gifs/search 与
 * /gifs/share）、并且部署登记了至少一个 GIF 图片来源时为 true；否则按原版不出现。imageOrigins 是部署登记的 https 来源（与 Web 静态
 * CSP img-src 追加项同一份），Web 只对这些来源内联渲染无 imeta 的 GIF；KLIPY 密钥只在 Relay 部署环境。
 */
export interface WebGIFCapabilityView {
    available:    boolean;
    imageOrigins: string[];
}

/**
 * 原 normalizeKlipyGifs 的一项（BFF 归一化，Browser 不接收提供方原始 JSON）：original 取 md/hd/sm/xs 的首个完整
 * gif，preview 取 sm.webp/sm.gif/xs.webp/xs.gif/md.webp 或 original，poster 取首个完整 jpg。所有地址都是
 * https 且来源在部署登记的 GIF 图片来源之内，否则该项不返回。发送时原版把 url 以 ![image](url) 追加到正文，不带 imeta。
 */
export interface WebGIFItem {
    height:        number;
    posterUrl?:    string;
    previewHeight: number;
    previewUrl:    string;
    previewWidth:  number;
    size:          number;
    slug:          string;
    title:         string;
    url:           string;
    width:         number;
}

/**
 * POST /api/v1/gifs/search：BFF 以本人身份经 NIP-98 转发 Relay 原 /gifs/search（成员门与 GIF 限速由 Relay
 * 执行，超额以 LIMIT 类回应）。query 为空即原 trending，至多 200 字符；locale 为浏览器语言（1–32 字符）。原 KLIPY
 * customer_id 由 BFF 按 Tenant 与本人 Principal 派生为稳定匿名标识，Browser 不提供。
 */
export interface WebGIFSearchRequest {
    locale: string;
    query:  string;
}

/**
 * POST /api/v1/gifs/search 的回应：原 Relay 固定一页（24 项）结果，按提供方顺序。
 */
export interface WebGIFSearchView {
    gifs: GIFElement[];
}

/**
 * 原 normalizeKlipyGifs 的一项（BFF 归一化，Browser 不接收提供方原始 JSON）：original 取 md/hd/sm/xs 的首个完整
 * gif，preview 取 sm.webp/sm.gif/xs.webp/xs.gif/md.webp 或 original，poster 取首个完整 jpg。所有地址都是
 * https 且来源在部署登记的 GIF 图片来源之内，否则该项不返回。发送时原版把 url 以 ![image](url) 追加到正文，不带 imeta。
 */
export interface GIFElement {
    height:        number;
    posterUrl?:    string;
    previewHeight: number;
    previewUrl:    string;
    previewWidth:  number;
    size:          number;
    slug:          string;
    title:         string;
    url:           string;
    width:         number;
}

/**
 * POST /api/v1/gifs/share（原选择时的分享上报，尽力而为）：BFF 以本人身份经 NIP-98 转发 Relay 原 /gifs/share，成功回
 * 204。slug 为 1–200 字符。
 */
export interface WebGIFShareRequest {
    slug: string;
}

/**
 * DD-39/72/75：本人原 Relay mentions feed。Core 逐项核验当前资源准入、签名和频道线程归属；不接受身份、scope 或任意 Relay
 * filter。
 */
export interface WebInboxQuery {
    limit?: number;
    since?: number;
}

/**
 * POST /api/v1/workspaces/{workspaceId}/link-previews 与
 * /api/v1/conversations/{conversationId}/link-previews（DD-125(5)、09 §3、V-SCN-139）：Web 原
 * composer 的链接预览抓取由 BFF 代为执行。只接受 http/https 与默认端口；BFF 每一跳在 DNS 解析后拒绝回环、私网、链路本地、CGNAT、组播、ULA
 * 与部署登记的内部网段，只连接已校验地址，至多 3 次跳转、256 KB，不带 cookie 与凭据；按 Principal 限速，超额以 LIMIT
 * 类拒绝；预览图以本人身份上传为 Relay 媒体。审计只记主机与 URL 摘要。
 */
export interface WebLinkPreviewRequest {
    /**
     * 原 extractSupportedLinkPreviews 识别出的链接（http/https）。
     */
    url: string;
}

/**
 * BFF 为本人短期持有的一份链接预览快照（DD-125(5)）。字段即原 11 元素 link-preview snapshot 标签的内容（版本 1）：canonicalUrl
 * 为 https、无凭据与片段；title 不超过 300 字节、siteName 100 字节、description 1000 字节；imageUrl/faviconUrl
 * 是本人上传的 Relay 媒体地址，缺省即无图。发布请求只能以 snapshotId 引用本人未过期的快照（linkPreviewSnapshotIds），Browser
 * 不提交原始标签。
 */
export interface WebLinkPreviewSnapshotView {
    canonicalUrl: string;
    description:  string;
    /**
     * 快照失效时刻，RFC3339；之后发布引用它以 TARGET_NOT_FOUND 拒绝。
     */
    expiresAt:   string;
    faviconUrl?: string;
    imageUrl?:   string;
    siteName:    string;
    snapshotId:  string;
    title:       string;
    /**
     * 请求的链接，原样回显，供 composer 与正文中的链接对应。
     */
    url: string;
}

export interface WebMessageAttachment {
    /**
     * 原 Buzz imeta 模糊预览编码。
     */
    blurhash?: string;
    /**
     * 原 Buzz imeta 媒体尺寸显示元数据。
     */
    dim?: string;
    /**
     * 原附件 Markdown 链接显示名称；与 filename 分离，只写入消息正文，不生成 imeta 字段。
     */
    displayLabel?: string;
    /**
     * 原 video/mp4 时长（秒），须为正有限数；Relay 校验原 sidecar。
     */
    duration?: number;
    /**
     * 原 Buzz imeta filename；仅为显示及下载名称，不参与媒体存储寻址。
     */
    filename?: string;
    /**
     * 原 video/mp4 独立 poster 图片引用；只允许当前 Community 的媒体路径，Relay 校验原图片 sidecar。
     */
    image?: string;
    sha256: string;
    size:   number;
    /**
     * 沿原 Buzz Markdown 隐藏图片或视频；普通文件仍为文件链接。
     */
    spoiler?: boolean;
    /**
     * 当前 Community 内与附件 hash 相同的原 .thumb.jpg 引用；Relay 验证实际缩略图存在。
     */
    thumb?: string;
    type:   string;
    url:    string;
}

/**
 * Typed read of authors proven by signed events in one currently admitted channel or
 * private conversation. No caller-selected pubkey or Relay filter; Core partitions Relay
 * reads by its existing page/NIP-11 limits.
 */
export interface WebMessageAuthorQuery {
    eventIds: string[];
}

/**
 * Exact event-id keyed profiles from one fresh admitted read. Every requested message must
 * be verified; a missing kind:0 is an empty profile, while missing message proof fails the
 * whole read. No profile body is persisted by Core.
 */
export interface WebMessageAuthorView {
    profiles: { [key: string]: ProfileValue };
}

/**
 * Profile read from Buzz for the current identity or an author proven by a currently
 * admitted channel/private-conversation message, never a Core profile copy. An absent
 * kind:0 is an empty profile, not a fabricated event.
 */
export interface ProfileValue {
    about?: null | string;
    /**
     * Same-origin BFF paths for exact media URLs on the current community. A read projection,
     * never an upload or remote proxy authority.
     */
    avatarMediaPaths: { [key: string]: string };
    avatarUrl?:       null | string;
    displayName?:     null | string;
    eventId?:         null | string;
    nip05Handle?:     null | string;
    pubkey:           string;
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
    /**
     * 原 Inbox Agents：仅 Workspace 内读取本人拥有且 ACTIVE 的既有安装作者消息；Core fresh read 解析其公开签名身份，不接受任意
     * author。不得与线程读取或其他消息类型组合。
     */
    agentInstallationId?: string;
    /**
     * 原 Inbox item 冷定位：仅在路径指定并 freshly admitted 的 Workspace/Conversation 内验证精确 Stream/Forum
     * 消息及线程祖先。不能与其他 messageType、parentEventId、agentInstallationId 或分页游标组合；不是全局 event
     * 读取或权限证明。缺省保持原窗口/线程语义。
     */
    anchorEventId?: string;
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
 * DD-120: only snapshot events signed by the Relay itself whose single p tag is a requested
 * pubkey bound in this Tenant. A pubkey without a fact is absent, never reported offline.
 */
export interface WebPresencePage {
    presences: WebPresenceView[];
}

export interface WebPresenceView {
    observedAt?: number;
    pubkey:      string;
    status:      WebPresenceStatus;
}

export enum WebPresenceStatus {
    Away = "away",
    Offline = "offline",
    Online = "online",
}

/**
 * DD-120: presence for the requested pubkeys from the Relay-signed 20001 snapshot.
 */
export interface WebPresenceQueryRequest {
    pubkeys: string[];
}

/**
 * DD-120: the person's own presence heartbeat or manual choice. Core signs the original
 * kind 20001 with the person's SERVER key over the existing NIP-42 session connection;
 * latest wins, not stored, never reconciled by event ID. offline releases the presence
 * lease.
 */
export interface WebPresenceUpdateRequest {
    status: WebPresenceStatus;
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
 * Profile read from Buzz for the current identity or an author proven by a currently
 * admitted channel/private-conversation message, never a Core profile copy. An absent
 * kind:0 is an empty profile, not a fabricated event.
 */
export interface WebProfileView {
    about?: null | string;
    /**
     * Same-origin BFF paths for exact media URLs on the current community. A read projection,
     * never an upload or remote proxy authority.
     */
    avatarMediaPaths: { [key: string]: string };
    avatarUrl?:       null | string;
    displayName?:     null | string;
    eventId?:         null | string;
    nip05Handle?:     null | string;
    pubkey:           string;
}

/**
 * Web HUMAN 的原 Buzz 消息语义输入；身份、Channel、回复祖先与 mention 公钥均由 BFF 在原 scope 中解析，不接受 raw tags 或
 * signed event。
 */
export interface WebPublishMessageRequest {
    attachments?: AttachmentElement[];
    content:      string;
    /**
     * 删除本人原 Buzz 消息；BFF 回读当前 Channel 原事件核对本人签名身份，发原 kind 5。与
     * editEventId、parentEventId、非空正文、附件及提及互斥；不授予 kind 9005 管理员删除权限。
     */
    deleteEventId?: string;
    /**
     * 编辑原 Buzz 消息；BFF 回读同 Channel 原事件并核对本人签名身份，发原 kind 40003。与 parentEventId 互斥，缺省保持原新消息语义。
     */
    editEventId?: string;
    /**
     * DD-125(5) 原 composer 链接预览：本人经 BFF 抓取得到、尚未过期的快照 ID（至多 8 个，去重保序）。只用于新的 STREAM
     * 消息（kind:9，含线程回复）：BFF 只接受本人的快照，按原 11 元素 link-preview snapshot 标签随该消息发布并把 ID
     * 冻结在发布幂等记录；canonicalUrl 不在正文中的快照按原接收规则不签入（正文照常发布）；引用他人或已过期的快照以 TARGET_NOT_FOUND 拒绝。与
     * suppressLinkPreviews、editEventId（原编辑不带快照）、deleteEventId、sendToChannelSourceEventId 互斥；不接受
     * Browser 提交的原始 link-preview 标签。
     */
    linkPreviewSnapshotIds?: string[];
    /**
     * 用户明确选中的本 Workspace Installation；缺省为空，BFF 排序去重并冻结于原发布幂等记录。
     */
    mentionInstallationIds?: string[];
    /**
     * 原 Buzz HUMAN 提及的精确公钥；缺省为空。BFF 核对当前 Tenant、消息目的地成员及 ACTIVE 身份，排序去重冻结在原发布幂等记录；不接受 Agent
     * 公钥绕过 Installation 准入。
     */
    mentionPubkeys?: string[];
    messageType?:    WebMessageType;
    /**
     * 原 Relay 消息引用；BFF 在当前 Channel 回读验签并解析 NIP-10 祖先。
     */
    parentEventId?: string;
    /**
     * DD-125(1) 原“发送到频道”：当前 Channel 中一条线程回复的 Relay 事件 ID。BFF 回读该回复，要求作者为本人或本人是其 Installation
     * owner，按原 getSendToChannelSemantics 只复制正文与 emoji/imeta/link-preview/mention
     * 标签、重算提及并排除源作者，由线程根按原截断规则生成 buzz:sent-from-thread，以本人身份发一条新的顶层 kind:9，沿 DD-81 幂等与对账。与
     * parentEventId、editEventId、deleteEventId 互斥；content 须为空且不带附件、提及或 Installation
     * 提及——正文与标签只取自回读的源事件，不接受 Browser 提交的原始标签。
     */
    sendToChannelSourceEventId?: string;
    /**
     * DD-125(5) 原 link-preview none：为 true 时签发唯一的 ["link-preview", "none"] 标签，接收方不显示预览。与
     * editEventId 同用即原“对所有人移除预览”（本人消息的 40003 编辑）。省略或 false 不加该标签。
     */
    suppressLinkPreviews?: boolean;
}

/**
 * Web HUMAN 修改已准入 Workspace 对应 Channel 的原主题（DD-119、09 §3）。BFF 以本人 SERVER 身份按 DD-81 签发严格
 * h+topic 两标签的 kind 9002，幂等键沿原发布的 Idempotency-Key 请求头；不接受 raw tags、signed event
 * 或任何管理标签。结果不明只对账不重签；已归档 Channel 不接受。
 */
export interface WebPublishTopicRequest {
    /**
     * 原频道主题；空字符串清空主题，不改变频道名称、描述、TTL 或成员。
     */
    topic: string;
}

/**
 * DD-39 / REQ-24：原 Buzz TopbarSearch 的语义查询。Core 以本人 SERVER 身份向原 Relay FTS 查询，只在当前已准入
 * Channel/DM 范围内读取；不接受任意 Relay filter、租户或身份。页与 frame 上界来自已核验 NIP-11 和既有 BFF 配置。
 */
export interface WebSearchQuery {
    authors?:   string[];
    channelId?: string;
    limit?:     number;
    q:          string;
    since?:     number;
    until?:     number;
}

/**
 * DD-120(1)：线程内输入中提示的类型化线程引用，POST /api/v1/workspaces/{workspace_id}/typing 与
 * /api/v1/conversations/{conversation_id}/typing 的可选请求体；缺省请求体即主频道输入。Core 以本人 SERVER 身份签发原版
 * kind 20002：唯一 h 标签取自已准入的 scope，按原 buildThreadReferenceTags 追加 e root/reply 标签；不接受 raw
 * tags、频道或身份。瞬时事件最新者为准，超时不报成功也不重签。
 */
export interface WebTypingRequest {
    /**
     * 原 typingParentEventId：线程面板的 thread head 事件 ID（64 位小写十六进制），成为 e reply 标签
     */
    parentEventId: string;
    /**
     * 原 typingRootEventId：thread head 所在线程的根事件 ID；缺省或等于 parentEventId 时只发 e reply 标签
     */
    rootEventId?: string;
}

/**
 * DD-120: the latest verified 30315 per requested pubkey; empty content means cleared and
 * is omitted.
 */
export interface WebUserStatusPage {
    statuses: WebUserStatusView[];
}

export interface WebUserStatusView {
    createdAt:  number;
    emoji?:     string;
    eventId:    string;
    expiresAt?: number;
    pubkey:     string;
    text:       string;
}

/**
 * DD-120: the original NIP-38 kind 30315 `d=general` statuses for the requested pubkeys.
 */
export interface WebUserStatusQueryRequest {
    pubkeys: string[];
}

/**
 * DD-120: the person's own original NIP-38 30315 (`d=general`, optional `emoji` and
 * `expiration` tags), published by Core with the SERVER key under DD-81 (Idempotency-Key
 * header). Empty text clears the status.
 */
export interface WebUserStatusUpdateRequest {
    emoji?:     string;
    expiresAt?: number;
    text:       string;
}

/**
 * POST /api/v1/workspace-activity 的回应：按请求顺序给出每个 Workspace 的原生 Channel ID 与经签名、scope
 * 与窗口边界核验的首页事件，语义与单个 GET /workspaces/{id}/messages 首页相同。任一项准入或核验失败即整次失败，不返回部分结果。
 */
export interface WebWorkspaceActivityPage {
    items: WebWorkspaceActivity[];
}

export interface WebWorkspaceActivity {
    channelId:   string;
    events:      { [key: string]: any }[];
    workspaceId: string;
}

/**
 * POST /api/v1/workspace-activity：一次读取调用方多个已加入 Workspace 的原版频道窗口首页（侧栏最近活动与未读、Inbox
 * 原兴趣规则的输入），对应固定 Buzz desktop/src-tauri/src/commands/channels/fetch.rs 的批量 last-message
 * 查询。每项仍单独做 HUMAN 协作准入；同一请求内 Workspace 不得重复。messageType 只接受频道窗口的 STREAM 或 FORUM_POST。
 */
export interface WebWorkspaceActivityQuery {
    items: WebWorkspaceActivityTarget[];
}

export interface WebWorkspaceActivityTarget {
    messageType: WebMessageType;
    workspaceId: string;
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
    actionTokenAudience: string;
    adapterServiceRef:   string;
    artifactDigest:      string;
    baseUrl:             string;
    /**
     * 可选的既有原生对象受控归属证据；复用同一绑定事实结构，仅供既有resource.create核验，不授予权限或创建原生对象。无登记证据时省略，不投递空数组。
     */
    bindings?:                  AdapterBinding[];
    maxResponseBytes:           number;
    mcpUrl?:                    string;
    modelCredentialDeliveries?: ApplicationModelCredentialDelivery[];
    /**
     * 受控原生浏览器认证信任投递；IdP只认证HUMAN，不承载实例业务许可。绑定、ACTIVE成员与SpiceDB实时检查决定权限；不由请求提供issuer/subject/key
     * URL。
     */
    nativeHumanIdentities?: ApplicationNativeHumanIdentity[];
    nativeInstanceRef:      string;
    secretReaders:          AdapterSecretReader[];
    timeoutSeconds:         number;
}

export interface AdapterBinding {
    bindingId:             string;
    configDigest:          string;
    credentialGeneration?: number;
    isolationMode:         string;
    /**
     * 原受控投递映射：无secret值；精确版本由Core以原audience读取并向Gateway独占文件投递。
     */
    nativeCredentials?: ComponentProtocolPeerEnvironmentNativeCredential[];
    /**
     * 绑定已有原生对象的受控投递事实，不创建对象或授予权限；父项唯一固定实例与作用域。
     */
    nativeResources?:   PurpleApplicationNativeResourceDelivery[];
    nativeScopeRef:     string;
    servicePrincipalId: string;
    tenantId:           string;
    workspaceId?:       string;
}

export interface ComponentProtocolPeerEnvironmentNativeCredential {
    audience:  string;
    header:    string;
    locator:   string;
    prefix:    string;
    secretKey: string;
    version:   number;
}

export interface PurpleApplicationNativeResourceDelivery {
    evidenceDigest: string;
    evidenceRef:    string;
    nativeRef:      string;
    nativeType:     string;
    typeKey:        string;
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

export interface ApplicationNativeHumanIdentity {
    audience:           string;
    bindingId:          string;
    configDigest:       string;
    generation:         number;
    identityProviderId: string;
    jwksFile:           string;
}

export interface AdapterSecretReader {
    audience:           string;
    roleName:           string;
    servicePrincipalId: string;
}

export interface ApplicationProtocolPeerDelivery {
    adapterServiceRef:          string;
    artifactDigest:             string;
    bindings:                   ProtocolPeerBinding[];
    maxResponseBytes:           number;
    mcpUrl:                     string;
    modelCredentialDeliveries?: ApplicationModelCredentialDelivery[];
    nativeInstanceRef:          string;
    secretReaders?:             ProtocolPeerSecretReader[];
    timeoutSeconds:             number;
}

export interface ProtocolPeerBinding {
    bindingId:             string;
    configDigest:          string;
    credentialGeneration?: number;
    isolationMode:         string;
    /**
     * 原受控投递映射：无secret值；精确版本由Core以原audience读取并向Gateway独占文件投递。
     */
    nativeCredentials?: PurpleApplicationPeerCredentialDelivery[];
    /**
     * 绑定已有原生对象的受控投递事实，不创建对象或授予权限；父项唯一固定实例与作用域。
     */
    nativeResources?:   FluffyApplicationNativeResourceDelivery[];
    nativeScopeRef:     string;
    servicePrincipalId: string;
    tenantId:           string;
    workspaceId?:       string;
}

export interface PurpleApplicationPeerCredentialDelivery {
    audience:  string;
    header:    string;
    locator:   string;
    prefix:    string;
    secretKey: string;
    version:   number;
}

export interface FluffyApplicationNativeResourceDelivery {
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
 * DD-88/94：pin 已批准 release 的业务绑定选择。不接受密钥正文、调用方自选 SecretRef 或运行端点 URL；secret 值只经同一
 * ActionCommand 的瞬态 bindingSecretValues 提交（03 §9）。Workspace 取原 ActionCommand。
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
    /**
     * 必须为空数组。binding 的 SecretRef 只由 Core 在本动作内把 bindingSecretValues 写入该 Tenant OpenBao
     * namespace 的 application-binding/<bindingId>/<secretKey> 后按返回版本生成；调用方提供的 locator/version
     * 一律拒绝（03 §9，不以运维旁路写入的 KV 冒充受治理写入）。
     */
    secretRefs:         ApplicationBindingCreateSecretRefClass[];
    servicePrincipalId: string;
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
 * Temporal 原生 Schedule：显式 interval 或 Buzz UTC cron，二者互斥。catchupWindow 不小于原生的 10 秒，Overlap
 * 固定 SKIP。
 */
export interface AutomationScheduleSpec {
    catchupWindowSeconds: number;
    /**
     * 原 Buzz UTC cron：表单五字段，YAML 六字段包含秒、七字段增加年份；匹配由 Temporal 原生日历执行，不建立本地定时器。
     */
    cron?:         string;
    everySeconds?: number;
    /**
     * 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
     */
    kind?:          ScheduleSpecKind;
    offsetSeconds?: number;
}

/**
 * 同 Tenant OpenBao KV v2 的精确版本引用（DD-70）；只是 locator，不含密钥正文。audience 必须是 Core 的服务身份。
 */
export interface AutomationSecretRef {
    audience: string;
    locator:  string;
    version:  number;
}

/**
 * 原 Buzz 有序步骤的已接通动作；步骤执行和延时仍归 Temporal。call_webhook 需要工作区管理权限（原
 * requires_elevated_authority），保存与每次运行均重新核验。其它原动作不由此宣称已实现。
 */
export interface AutomationStep {
    action: ActionEnum;
    /**
     * request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
     */
    approvalPolicy?: ApprovalPolicyElement;
    /**
     * 原请求体模板；不保存响应正文。
     */
    body?:     string;
    duration?: string;
    /**
     * 原 buzz-sdk build_reaction 的字符上限；目标仅为该次真实触发消息。
     */
    emoji?: string;
    /**
     * 原附加请求头，值可含原模板变量。凭据类请求头（Authorization、Cookie，以及名称含 token/secret/password/api-key/apikey
     * 者）不得明文保存，必须改用 secretHeaders。
     */
    headers?: { [key: string]: string };
    id:       string;
    /**
     * 固定 Buzz Step.if 的 evalexpr 条件，原 4096 UTF-8
     * 字节上限；为假时跳过该步骤（不失败）。只允许引用触发变量（trigger_text/author/channel_id/timestamp/emoji/message_id/is_reply），引用步骤输出在定义校验时以
     * CAPABILITY_BLOCKED 拒绝。Kailo 在 automation.run 准入时按已验签触发事件一次求值并把跳过集合冻结进该
     * ActionExecution；求值错误使该运行在任何副作用前失败。
     */
    if?:      string;
    message?: string;
    /**
     * 原 HTTP 方法，缺省 POST。
     */
    method?: StepMethod;
    name?:   string;
    /**
     * Kailo 治理：请求头密钥只以同 Tenant OpenBao SecretRef 保存，Core 仅在派发时读取 field=value
     * 注入请求，不写入版本、参数、审计或轨迹。名称不得与 headers 重复（不区分大小写）。
     */
    secretHeaders?: { [key: string]: SecretHeaderValue };
    text?:          string;
    /**
     * 固定 Buzz Step.timeout_secs。Delay 由原 AgentTask 的独立 Temporal Timer
     * 执行；send_message/add_reaction/set_channel_topic/call_webhook 由 Core
     * 自本运行首次到达该步骤起计时，截止前未派发则以 STEP_TIMEOUT 失败，已派发的结果走既有对账（不明记 UNKNOWN，不重放）；call_webhook
     * 的单次请求另受原 10 秒上限。缺省保持既有版本行为，不给历史补写默认值。
     */
    timeout_secs?: number;
    /**
     * 原频道主题；空字符串清空主题，不改变频道名称、描述或成员。
     */
    topic?: string;
    /**
     * 固定 Buzz ActionDef::CallWebhook.url：公网 HTTPS
     * 端点。scheme、主机与端口必须是字面值（原模板变量只可出现在路径与查询中），不得含用户信息。Core 每次派发前按 DNS 结果拒绝非全局单播地址，并只经
     * AgentGateway 出站，不跟随重定向。
     */
    url?: string;
}

/**
 * 既有 TaskProjection 中固定 AutomationVersion 步骤的可核验证据；不是执行权威。不含正文、模板、密钥、任意输出或原始 Temporal
 * history。时间仅来自原生事实，未知时省略。
 */
export interface AutomationStepTrace {
    /**
     * 原生计时终态时间 RFC3339；不存在则省略，不由父任务完成推断。
     */
    completedAt?: string;
    error?:       ReasonCode;
    output:       AutomationStepTraceOutput;
    /**
     * 原生步骤开始时间 RFC3339；不存在则省略，不用投影更新时间替代。
     */
    startedAt?: string;
    status:     AutomationStepStatus;
    stepId:     string;
}

export interface AutomationStepTraceOutput {
    actionExecutionId?:  string;
    approvalWorkflowId?: string;
    eventId?:            string;
    historyEventId?:     number;
    /**
     * call_webhook 实际收到的 HTTP 状态码；不保存响应正文或请求头。
     */
    httpStatus?: number;
    /**
     * call_webhook 本次派发的稳定请求引用（随请求发送的 Kailo-Request-Id）。
     */
    requestId?:  string;
    runId?:      string;
    workflowId?: string;
}

/**
 * REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval/calendar，不含触发消息正文、provider
 * 配置或凭据。
 */
export interface AutomationVersionContent {
    action?:         AutomationVersionContentActionClass;
    approvalPolicy?: ApprovalPolicyElement;
    /**
     * 固定 Buzz WorkflowDef 的可选说明；随原不可变版本和 config_hash 冻结。旧版本缺省不补写，空值与空白沿原 YAML 保留。
     */
    description?: string;
    /**
     * 2保留历史单副作用步骤；3为有序多消息。旧单 action 格式缺省保持原摘要。
     */
    formatVersion?: number;
    /**
     * 原工作流名称；随不可变版本冻结。旧版本缺省不补写、不重算历史摘要。
     */
    name?:        string;
    resultTarget: AutomationResultTarget;
    /**
     *
     * 不可与旧action混用。格式3逐条发送消息并查证原生回执，支持消息间Delay及首副作用前一个原策略审批；UNKNOWN不推进。步骤审批不可同时声明版本级approvalPolicy。其余原动作仍在恢复范围。
     */
    steps?:  StepElement[];
    trigger: AutomationVersionContentTriggerClass;
}

export interface AutomationVersionContentActionClass {
    kind:     ActionKind;
    template: string;
}

export interface AutomationVersionContentTriggerClass {
    /**
     * 固定 Buzz TriggerDef::ReactionAdded.emoji；仅 REACTION_ADDED，可选，精确匹配原回应内容。
     */
    emoji?: string;
    /**
     * 固定 Buzz evalexpr 消息触发条件；CHANNEL_MESSAGE/MENTION/DIFF_POSTED/REACTION_ADDED（DIFF_POSTED
     * 为同频道 kind:40008，与消息触发同一组变量；REACTION_ADDED 另有 trigger_emoji 与被回应消息 trigger_message_id），原
     * 4096 UTF-8 字节上限。只匹配已验签且当前准入 HUMAN 事件；错误不匹配，不持久化触发正文。旧 textPrefix 若同时存在则均须满足。
     */
    filter?:             string;
    kind:                AutomationTriggerKind;
    mentionPrincipalId?: string;
    scheduleSpec?:       ScheduleSpecClass;
    textPrefix?:         string;
}

/**
 * DD-102 / ADR-12：能力契约固定的机器向量。每个 case 按 steps 顺序执行契约操作，参数与预期结果是实际
 * JSON，不执行文本代码。格式有效不表示组件套件通过；线协议性质、真实执行与 release 证据关联另行核验。DD-124：V2 的每个值只来自
 * LITERAL、PRECONDITION 或 CAPTURE；generatedRefs、preconditionKinds、preconditions、bindings 与
 * captures 只属于 V2，V1 仍按原规则执行。
 */
export interface CapabilityConformanceVectors {
    cases:         Case[];
    formatVersion: CapabilityVectorFormat;
    /**
     * V2 only. Contract fields whose values the implementation generates (opaque non-empty
     * strings). nativeRevision is always implementation-generated and need not be listed. A
     * listed position present in a step document may never be LITERAL; EXPECTED entries are the
     * only output fields a GENERATED_REF capture of a FORWARD step may read. A step of a
     * RECEIVER case is not sent by the production Core: its input is the admission the isolated
     * Core produced, so a GENERATED_REF capture of that step reads an INPUT entry of its own
     * contract key.
     */
    generatedRefs?: CapabilityVectorGeneratedRef[];
    /**
     * V2 only. Closed list of native object kinds a case may declare as preconditions and the
     * properties each must verify by a literal expectation.
     */
    preconditionKinds?: CapabilityVectorPreconditionKind[];
}

export interface Case {
    caseKey: string;
    /**
     * V2 only; absent means FORWARD. A RECEIVER case (DD-124(3)(4)) runs entirely in the
     * isolated deployment; the production plan observes each of its steps only through
     * receiver_start/receiver_observe and accepts the isolated Core's execution and operation
     * ids, both read_receipts, native batch or execution and native terminal evidence, never
     * business results: every step names the receiver Resource by referenceResourceKey and
     * expects {}. Every platform Resource id of the case, typed or a
     * resourceId/sourceResourceId/assetId member of a step document, is a PRECONDITION. A step
     * input is the admission the isolated Core performs: it may bind the step's own
     * ACTION_EXECUTION_ID, OPERATION_ID or GENERATED_REF captures and earlier steps' captures,
     * which the isolated deployment supplies from its own run. The case as a whole carries the
     * source reads; Core compares a step's input with the admission whenever its evidence has
     * reads.
     */
    direction?: CapabilityVectorCaseDirection;
    /**
     * V2 only. Native objects the isolated fixture creates through the candidate's own native
     * entry before the run; the fixture supplies only their actual identifiers. Every
     * registered property of the kind is declared with its literal value and verified by a
     * later literal expectation of this case; in a RECEIVER case, whose expectations are {}, by
     * a literal member of a later step input, which Core compares with the isolated admission.
     */
    preconditions?: CapabilityVectorPrecondition[];
    steps:          Step[];
}

/**
 * V2 only; absent means FORWARD. A RECEIVER case (DD-124(3)(4)) runs entirely in the
 * isolated deployment; the production plan observes each of its steps only through
 * receiver_start/receiver_observe and accepts the isolated Core's execution and operation
 * ids, both read_receipts, native batch or execution and native terminal evidence, never
 * business results: every step names the receiver Resource by referenceResourceKey and
 * expects {}. Every platform Resource id of the case, typed or a
 * resourceId/sourceResourceId/assetId member of a step document, is a PRECONDITION. A step
 * input is the admission the isolated Core performs: it may bind the step's own
 * ACTION_EXECUTION_ID, OPERATION_ID or GENERATED_REF captures and earlier steps' captures,
 * which the isolated deployment supplies from its own run. The case as a whole carries the
 * source reads; Core compares a step's input with the admission whenever its evidence has
 * reads.
 *
 * DD-124(3)(4): the direction of a whole V2 case. FORWARD cases are driven by the
 * production Core probe execute. RECEIVER marks a case that depends on the service read
 * edge (an ingest consuming a source through READ_EDGE, a NATIVE_MANAGED receiver key):
 * every step of it runs in the isolated deployment of 07 §8A and the production plan only
 * observes each step through receiver_start/receiver_observe; steps are never split between
 * the directions.
 */
export enum CapabilityVectorCaseDirection {
    Forward = "FORWARD",
    Receiver = "RECEIVER",
}

export interface CapabilityVectorPrecondition {
    key:        string;
    kind:       string;
    properties: CapabilityVectorPreconditionProperty[];
}

export interface CapabilityVectorPreconditionProperty {
    name:      string;
    valueJson: string;
}

export interface Step {
    /**
     * V2 only. Every reserved placeholder in inputJson/expectedOutputJson is declared here
     * exactly once.
     */
    bindings?: BindingElement[];
    /**
     * V2 only. Values this step's SUCCEEDED observation with complete native terminal evidence
     * provides to later steps.
     */
    captures?:          CaptureClass[];
    contractKey:        string;
    expectedOutputJson: string;
    inputJson:          string;
    referenceAssetId?:  string;
    /**
     * V1 only. 只引用同 case 已成功的更早 stepKey 的唯一 typed ContentReference；不得指定 JSON 路径或表达式。与固定
     * Resource/Asset 目标一起进入规范化参数 hash。
     */
    referenceFromStepKey?: string;
    /**
     * Literal platform Resource id of the step target. DD-124(4): a RECEIVER case never names a
     * platform Resource by literal; it uses referenceResourceKey.
     */
    referenceResourceId?: string;
    /**
     * V2 only. Key of a PRECONDITION of this case whose fixture value is the step's reference
     * Resource id; Core freezes that value into the plan step's referenceResourceId. DD-124(4):
     * in a receiver-direction case it is the id the isolated Core's real resource.create (DD-98
     * existing native reference) returned. Mutually exclusive with referenceResourceId,
     * referenceAssetId and referenceFromStepKey; it counts as this step sending that
     * precondition.
     */
    referenceResourceKey?: string;
    stepKey:               string;
}

export enum CapabilityVectorFormat {
    V1 = "V1",
    V2 = "V2",
}

export interface CapabilityVectorGeneratedRef {
    contractKey: string;
    pointer:     string;
    side:        CapabilityVectorSide;
}

export interface CapabilityVectorPreconditionKind {
    description: string;
    kind:        string;
    properties:  string[];
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
 * DD-124(2): one substitution position of a V2 step. pointer is an RFC 6901 JSON Pointer
 * into the step input (INPUT) or expected output (EXPECTED); the literal there must be
 * exactly the reserved placeholder {{SOURCE:key}}. INPUT may bind PRECONDITION or CAPTURE;
 * EXPECTED may bind CAPTURE or a PRECONDITION already sent as INPUT in this case. In a
 * RECEIVER case INPUT may also bind the step's own captures: Core compares that input with
 * the admission the isolated Core actually produced whenever the step's evidence has reads.
 * The plan digest fixes the declaration, never the value.
 */
export interface CapabilityVectorBinding {
    key:     string;
    pointer: string;
    side:    CapabilityVectorSide;
    source:  CapabilityVectorBindingSource;
}

/**
 * DD-124(1)(2): a value this step's actual SUCCEEDED observation produces for later steps
 * of the same case. key is unique in the case and must be consumed at least once. pointer
 * is present only for GENERATED_REF and must equal an EXPECTED generatedRefs entry of the
 * step's contract key; in a RECEIVER case it equals an INPUT entry and reads the admission
 * the isolated Core produced. ACTION_EXECUTION_ID and OPERATION_ID exist only in RECEIVER
 * cases; a step of a RECEIVER case takes them and CONTENT_REFERENCE_* from its own read and
 * the receiver's read_receipt of that admission, so a capturing step's evidence has reads.
 */
export interface CapabilityVectorCapture {
    key:      string;
    pointer?: string;
    slot:     CapabilityVectorCaptureSlot;
}

/**
 * Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。inputReference 或 inputJson 恰一：前者保持持久
 * ContentReference，后者是原登记能力 inputSchema 的规范化元数据参数，不把 SQL、提示或结果正文写入 Core/Temporal。Core
 * 仍校验原目标、能力 schema、审批和用量。
 */
export interface ComponentActionInput {
    actionVersion: number;
    /**
     * Canonical JSON for the existing registered capability input schema; mutually exclusive
     * with inputReference, validated before AE admission.
     */
    inputJson?:                  string;
    inputReference?:             ContentReferenceElement;
    resultExposurePolicyId:      string;
    resultExposurePolicyVersion: number;
}

/**
 * DD-124(2): one captured value of the current suite run. Core derives it only from the
 * candidate's actual wire response or typed ContentReference; it is kept only in that
 * step's observation evidence and re-checked when the report is recorded. Never a fixture,
 * seed or administrator value.
 */
export interface ComponentConformanceCaptureValue {
    key:   string;
    value: string;
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
    /**
     * 仅隔离原生接收方套件：原 receiver ServicePrincipal 的受控 OIDC 投递，逐 binding/generation 选择；不是生产绑定注册表，不转发
     * Worker 的平台 bearer。
     */
    nativeReadAuthorities?: ComponentNativeReadAuthority[];
    /**
     * DD-124(4)：仅隔离部署内 APPLICATION 接收方动作（省略 importConfigRef 的
     * receiver_start/receiver_observe）。平台维护的隔离部署入口 origin，不是候选 adapter；它以隔离 HUMAN 经隔离 Core 原
     * Action Admission 准入与派发并观察该动作。
     */
    receiverActionBaseUrl?: string;
}

export interface ComponentNativeReadAuthority {
    bindingId:            string;
    coreBaseUrl:          string;
    generation:           number;
    oidcClientId:         string;
    oidcClientSecretFile: string;
    oidcTokenUrl:         string;
}

/**
 * 隔离开发环境受控投递的协议夹具数据，不来自登记请求。Core 只采用固定协议用例并核对全部必需覆盖；没有脚本、条件、路径表达式或通过声明。
 */
export interface ComponentConformanceFixture {
    artifactDigest: string;
    /**
     * 接收方向步骤（V1 NATIVE_INTERNAL/NATIVE 契约步骤，V2 direction=RECEIVER case 的每个步骤）各恰一项的冻结接收方请求；Core
     * 以计划步骤幂等键替换 idempotencyKey。DD-124(4)：NATIVE_MANAGED 键的请求携带与已代入向量输入一致的
     * importConfigRef；APPLICATION 接收方动作省略它。请求只是隔离部署内的启动/观察引用，不含任何执行、operation 或批次标识。
     */
    nativeReceivers?: ComponentNativeReceiverFixture[];
    /**
     * DD-124(1)：V2 契约 case 声明的前置原生对象取值。只能是候选实现原生入口创建时实际返回的标识（接收方向 case 的平台 Resource 前置值为隔离 Core
     * 经真实 resource.create 登记既有原生引用后返回的 Resource ID，DD-124(4)）；Core
     * 在冻结计划时代入，并核对每个声明恰有一个取值。不是期望值来源。
     */
    preconditions?: ComponentConformancePreconditionValue[];
    steps:          PlanStep[];
}

export interface ComponentNativeReceiverFixture {
    caseKey:     string;
    contractKey: string;
    request:     RequestClass;
    stepKey:     string;
}

export interface ComponentConformancePreconditionValue {
    /**
     * 计划内 case 键 <categoryKey>:<contractVersion>:<caseKey>。
     */
    caseKey: string;
    key:     string;
    value:   string;
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
    /**
     * DD-124(4)：计划含 receiver_start/receiver_observe 步骤时必填；固定隔离接收方部署的 Core 构建与来源
     * release，随身份摘要进入原计划。
     */
    receiverEnvironment?: ReceiverEnvironmentClass;
    secretAudience:       string;
    secretLocator:        string;
    secretVersion:        number;
    tokenSeconds:         number;
}

export interface ComponentConformanceIdentityContext {
    actionDefinitionVersion: number;
    actionKey:               string;
    actorPrincipalId:        string;
    /**
     * 隔离环境PEP的实际模拟授权revision，不得指向生产SpiceDB事实。
     */
    authorizationMinZedToken: string;
    caseKey:                  string;
    /**
     * execute场景必填的隔离native执行引用；不在生产库创建ExternalExecution。
     */
    externalExecutionId?: string;
    operation:            ComponentConformanceOperation;
    /**
     * 业务上下文必填并与版本成对；确切 application_binding.create 的 handshake/validate_binding
     * 管理上下文必须省略两字段，不授业务内容访问。
     */
    resultExposurePolicyId?: string;
    /**
     * 业务上下文必填；结果为 NONE 的确切绑定管理上下文必须与策略 ID 一起省略。
     */
    resultExposurePolicyVersion?: number;
    stepKey:                      string;
    targetId?:                    string;
    targetType:                   string;
    tenantId:                     string;
    workspaceId?:                 string;
}

/**
 * DD-124(4), 07 §8A: identity of the isolated receiver deployment a plan with
 * receiver_start/receiver_observe steps observes. isolatedCoreBuildId is the
 * PlatformBuildInfo CORE buildId of the isolated Core/Worker and must equal the current
 * production Core build. sourceReleaseId with its artifact and manifest digests names the
 * production Catalog release, APPROVED and declaring read_edge SOURCE or BOTH, that the
 * isolated deployment runs as the source. It is delivered with the isolated identity, fixed
 * by the plan identity digest and copied into the plan; it is not evidence that any step
 * passed.
 */
export interface ComponentConformanceReceiverEnvironment {
    isolatedCoreBuildId:  string;
    sourceArtifactDigest: string;
    sourceManifestDigest: string;
    sourceReleaseId:      string;
}

/**
 * 原生 SyncLog 的真实批次与同批多个原 SERVICE read Operation 元数据；completed 不能单独证明通过，Core 仍核对每个
 * SOURCE/RECEIVER 回执及冻结请求。DD-124(4)：请求省略 importConfigRef 时，本观察是隔离 Core 真实 APPLICATION
 * 接收方动作的原生执行（nativeBatchId 为其原生任务标识，nativeStatus 为原生状态原值），每个 read Operation 锚定该动作而无
 * nativeBatch；RECEIVER case 中不读取来源的步骤（如 read/export/search/delete）可无 read Operation，读取由整个
 * case 承载。执行、operation 与批次标识须为隔离 Core 本次生成且不在计划或 fixture 中。
 */
export interface ComponentNativeReceiverObservation {
    completed:      boolean;
    finishedAt?:    string;
    nativeBatchId:  string;
    nativeStatus:   string;
    readOperations: ComponentNativeReceiverObservationReadOperation[];
    request:        RequestClass;
    startedAt:      string;
}

export interface ComponentNativeReceiverObservationReadOperation {
    actionExecutionId: string;
    /**
     * 原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
     * receiverActionExecutionId）。
     */
    nativeBatch?:              ReadOperationNativeBatch;
    operationId:               string;
    readRequest:               ReadRequestClass;
    receiverActionExecutionId: string;
    receiverGeneration:        number;
    receiverReceipt:           AdapterReadReceipt;
    sourceBindingId:           string;
    sourceReceipt:             AdapterReadReceipt;
    sourceResourceId:          string;
}

/**
 * 07§8A 隔离原生接收方验证的冻结请求。原生生成真实 batch ID；同键重入与观察必须保持全部字段，不是生产 execute 输入或通用 HTTP
 * 脚本。DD-124(4)：importConfigRef 存在时为 NATIVE_MANAGED 原生批次，由候选实现原生发起；省略时为隔离部署内的 APPLICATION
 * 接收方动作（如经 READ_EDGE 的 ingest），由平台维护的隔离部署以真实 APPLICATION ActionExecution
 * 准入与派发，原能力输入只由已登记向量与 fixture 前置值冻结。
 */
export interface ComponentNativeReceiverRequest {
    bindingId: string;
    /**
     * 受控夹具固定的 RFC3339 首派期限，须受原生 SyncLog 保留策略约束；过期仍可观察同一批次，不得续期重派。
     */
    expiresAt:        string;
    generation:       number;
    idempotencyKey:   string;
    importConfigRef?: string;
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
    /**
     * 隔离原生MCP的既有版本化SecretRef与header映射；经原Core/OpenBao审计和Gateway文件投递，不含凭据值，不借用生产binding身份。
     */
    nativeCredentials?: ComponentProtocolPeerEnvironmentNativeCredential[];
    readOnlyTools:      string[];
    timeoutSeconds:     number;
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
    /**
     * DD-126(5)：续签时被替换的本人 Grant；与 renewsDelegationVersion 成对出现，缺省为新授予。
     */
    renewsDelegationId?: string;
    /**
     * DD-126(5)：被替换 Grant 的当前 version（CAS）。
     */
    renewsDelegationVersion?: number;
    scopes:                   ScopeElement[];
    validFrom:                Date;
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
    method:       LaunchDescriptorMethod;
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
    /**
     * 仅随 PUBLISH_REJECTED：Relay 以社区禁言或封禁拒绝本人内容写入时的结构化原因，供原禁言横幅倒计时（DD-125(2)、V-SCN-129）。只来自
     * Relay 对本人这次写入的拒绝文本，不是限制列表读取；其他拒绝缺省。
     */
    restriction?: PublishRestriction;
}

/**
 * 仅随 PUBLISH_REJECTED：Relay 以社区禁言或封禁拒绝本人内容写入时的结构化原因，供原禁言横幅倒计时（DD-125(2)、V-SCN-129）。只来自
 * Relay 对本人这次写入的拒绝文本，不是限制列表读取；其他拒绝缺省。
 */
export interface PublishRestriction {
    kind: PublishRestrictionKind;
    /**
     * TIMED_OUT 的到期时刻（RFC3339，取自 Relay 拒绝文本的 unix 秒）；BANNED 或拒绝文本未给出可解析时刻时缺省
     */
    until?: string;
}

/**
 * Relay 以社区限制拒绝本人内容写入的类别（DD-125(2)）：TIMED_OUT 对应 `restricted: you are timed out until
 * <ts>`，BANNED 对应 `blocked: you are banned from this community`。
 */
export enum PublishRestrictionKind {
    Banned = "BANNED",
    TimedOut = "TIMED_OUT",
}

/**
 * 仅 huddle.agent.add / huddle.agent.remove（DD-125(3)）且必带，目标 Huddle 由 ActionCommand.huddleId
 * 给出。加入要求父 Workspace 中 ACTIVE、有 ChannelAgentBinding 且本人有 execute 的 Installation，Tenant
 * CONTROL 以 9000 role=bot 投影并回读；移除另接受父 Workspace manage，CONTROL 以 9001 移出并回读。私聊父的 Huddle 没有
 * Agent。
 */
export interface HuddleAgentInput {
    agentInstallationResourceId: string;
}

/**
 * 仅 huddle.start（DD-125(3)、05 §2.11）且必带：在父 Workspace 或父私聊中发起原版 Huddle。parentWorkspaceId 与
 * parentConversationId 恰有一个：前者要求执行 Workspace 即该 Workspace（discover），后者要求本人是该私聊当前参与者。Core
 * 预分配 HuddleBuzzBinding 与临时 Channel UUID，由 Tenant CONTROL 以带 creator 的
 * 9007（private、stream、ttl=3600）投影临时频道，并以 9000 role=bot 加入所选 Agent；私聊父不接受
 * Agent。creatorPubkey 是本人发起会话的 ACTIVE HUMAN 公钥（原生端为该设备 CLIENT 公钥），省略即本人 SERVER
 * 公钥（Web）；它是临时频道的 created_by，也是唯一可签 48100/48106 的公钥。
 */
export interface HuddleStartInput {
    /**
     * 原 Add agents 所选 Agent（至多 20 个，沿原 MAX_HUDDLE_AGENTS）：父 Workspace 中 ACTIVE、有
     * ChannelAgentBinding 且本人有 execute 的 Installation
     */
    agentInstallationResourceIds?: string[];
    /**
     * 原 buildHuddleChannelName 生成的临时频道名
     */
    channelName: string;
    /**
     * 64 位小写十六进制 Nostr 公钥；省略即本人 SERVER 公钥
     */
    creatorPubkey?: string;
    /**
     * 父私聊（ConversationBuzzBinding id）
     */
    parentConversationId?: string;
    /**
     * 父 Workspace；须等于 ActionCommand.workspaceId
     */
    parentWorkspaceId?: string;
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
    reference:       ContentReferenceElement;
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
    reference:            ContentReferenceElement;
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
     * AgentTask 的 ProjectAgentTaskState Activity 原生执行 ID，仅由 ActivityInfo 投递。Core
     * 校验同固定执行链的已调度载荷后生成步骤投影；旧 writer/修复报告缺省时保留原轨迹，不推测或清空。
     */
    activityId?: string;
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
 * DD-123: tenant.quota.set parameters. Writes only the Tenant Customer's hard-limit
 * OpenMeter entitlement for the platform feature, resetting monthly.
 */
export interface TenantQuotaSetting {
    feature:        TenantQuotaFeature;
    limitPerPeriod: number;
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
 * 仅 workspace.canvas.set（DD-125(4)、05 §2.11）的瞬态输入：原频道 Canvas 的 Markdown 正文（SF-BUZ-54，UTF-8
 * 不超过 64 KiB，空串即原“清空”）。Core 只用它签 Tenant CONTROL 的 kind 40100 并按 DD-81 对账；正文不进入
 * Params、ActionExecution、审计、日志或 Workflow history，只冻结其 SHA-256 与字节数，同一幂等键重发须携带同一正文。
 */
export interface WorkspaceCanvasSetInput {
    content: string;
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
 * workspace.update 的冻结目标状态（DD-119）。至少给出 name、description、ttlSeconds/clearTtl、visibility
 * 之一，或只给 reopen=true；省略的字段保持不变。Core 在 Admission 校验组合，空集、ttlSeconds 与 clearTtl 同时出现、reopen
 * 与其他字段混用或取 false 均以 INVALID_PARAMETERS 拒绝。stream/forum 类型只在创建时设定，不可编辑；slug 不变。
 */
export interface WorkspaceUpdate {
    /**
     * 只能为 true：清除 TTL 改为长期频道（原 9002 空 ttl 标签）；与 ttlSeconds 互斥。
     */
    clearTtl?: boolean;
    /**
     * 原 9002 about；空字符串清空描述。
     */
    description?: string;
    /**
     * 新的频道与 Workspace 显示名；CONTROL 9002 回读 39000 一致后才在同一事务提交 Core 的 Workspace 名称。
     */
    name?: string;
    /**
     * 只能为 true 且单独出现：解档被原生 reaper 按 TTL 到期归档的 Channel。要求 Workspace ACTIVE、回读 archived=true 且设有
     * TTL，CONTROL 发 archived=false 后回读确认；主动归档仍用 workspace.suspend/restore。
     */
    reopen?: boolean;
    /**
     * 设置原 Buzz 临时频道的不活跃期限（秒）。
     */
    ttlSeconds?: number;
    /**
     * 只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
     */
    visibility?: WorkspaceVisibility;
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
     * 同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
     */
    delayStep?: DelayStep;
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
 * 同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
 */
export interface DelayStep {
    id:      string;
    seconds: number;
    /**
     * 显式 Delay 步骤时限；独立原生 Timer，不替换 seconds。缺省走原 history 分支。
     */
    timeoutSeconds?: number;
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
    /**
     * 成功 validate_binding 的固定字段摘要，由 Core 从真实回执按 component_conformance_wire_digests 计算；其他操作不得携带。
     */
    bindingDigest?: string;
    /**
     * DD-124：本步声明的捕获值，只由 Core 从本次实际应答的封闭槽位取得；仅随该步观察证据保存。
     */
    captures?:                  CaptureElement[];
    caseKey:                    string;
    contentReference?:          ContentReferenceElement;
    errorClass?:                ErrorClass;
    httpStatus:                 number;
    mcpResultKind?:             MCPResultKind;
    nativeObservation?:         ExecutionElement;
    nativeReceiverObservation?: NativeReceiverObservationClass;
    nativeScopeObservation?:    NativeScopeObservationClass;
    operation:                  ComponentConformanceOperation;
    requestDigest:              string;
    responseDigest:             string;
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
     * DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
     */
    receiverEnvironment?: ReceiverEnvironmentClass;
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
    /**
     * DD-124：仅 V2 契约步骤。Core 冻结时已代入 PRECONDITION 的 fixture 值，这里只保留 CAPTURE 的代入位置声明（不含值）；运行时 Core
     * 在 ActionToken 签名前代入请求、在比对前代入期望。权限拒绝重放保留同一 INPUT 声明。接收方向步骤只保留本步自身捕获的 INPUT 声明：请求不被代入，Core
     * 以它们比对隔离 Core 实际产生的接收方准入。
     */
    bindings?: BindingElement[];
    /**
     * DD-124：仅 V2 契约步骤。本步 SUCCEEDED 且原生终态证据完整时由 Core 从实际应答的封闭槽位取值，写入本步观察证据。
     */
    captures?: CaptureClass[];
    caseKey:   string;
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
    /**
     * 仅接收方向步骤（V1 的 NATIVE_INTERNAL/NATIVE 能力步骤，或 V2 RECEIVER case 的步骤），由 Core
     * 保留已代入前置值的原能力向量输入；SOURCE AE 与 batch 必须以同批真实入站观察替换，不是预造授权。
     */
    nativeReceiverInputJson?: string;
    operation:                ComponentConformanceOperation;
    referenceAssetId?:        string;
    referenceFromStepKey?:    string;
    referenceResourceId?:     string;
    requestJson:              string;
    stepKey:                  string;
}

/**
 * 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
 * history 承接，不建立另一执行账本。
 */
export interface ComponentConformanceProbe {
    /**
     * DD-124：本步 CAPTURE 绑定所需的值，只取同 case 更早步骤已记录观察中的 captures；Core 代入后签名，登记时再按报告重算，不能以 fixture
     * 或管理员值替代。
     */
    captures?:         CaptureElement[];
    contentReference?: ContentReferenceElement;
    plan:              PlanClass;
    /**
     * 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
     */
    reconcile?: boolean;
    stepIndex:  number;
}

export interface ComponentConformanceStepObservation {
    /**
     * 成功 validate_binding 的固定字段摘要，由 Core 从真实回执按 component_conformance_wire_digests 计算；其他操作不得携带。
     */
    bindingDigest?: string;
    /**
     * DD-124：本步声明的捕获值，只由 Core 从本次实际应答的封闭槽位取得；仅随该步观察证据保存。
     */
    captures?:                  CaptureElement[];
    caseKey:                    string;
    contentReference?:          ContentReferenceElement;
    errorClass?:                ErrorClass;
    httpStatus:                 number;
    mcpResultKind?:             MCPResultKind;
    nativeObservation?:         ExecutionElement;
    nativeReceiverObservation?: NativeReceiverObservationClass;
    nativeScopeObservation?:    NativeScopeObservationClass;
    operation:                  ComponentConformanceOperation;
    requestDigest:              string;
    responseDigest:             string;
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
