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
use std::collections::HashMap;

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

    pub kind: VariantKind,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_body: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_attempt: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum VariantKind {
    #[serde(rename = "FILE")]
    File,

    #[serde(rename = "MESSAGE")]
    Message,

    #[serde(rename = "TASK")]
    Task,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationModelAdmission {
    pub binding_id: String,

    pub gateway_principal_id: String,

    pub generation: i64,

    pub method: String,

    pub path: String,

    pub traceparent: String,
}

/// 07§5/6.2：validate_binding 的非正文观察。精确原生scope/实例、隔离与配置引用摘要，不是用户声明的通过布尔值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterBindingObservation {
    pub artifact_digest: String,

    pub binding_id: String,

    pub config_digest: String,

    pub execution_mappings: Vec<AdapterExecutionMapping>,

    pub isolation_mode: ApplicationIsolationMode,

    pub native_instance_ref: String,

    pub native_scope_ref: String,

    pub secret_reads: Vec<AdapterSecretRead>,

    pub secret_ref_digest: String,

    pub tenant_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterExecutionMapping {
    pub action_key: String,

    pub action_version: i64,

    pub cancel_capability: NativeCancelCapability,

    pub native_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum NativeCancelCapability {
    #[serde(rename = "SUPPORTED")]
    Supported,

    #[serde(rename = "UNSUPPORTED")]
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApplicationIsolationMode {
    #[serde(rename = "DEDICATED_INSTANCE")]
    DedicatedInstance,

    Namespace,

    #[serde(rename = "NATIVE_TENANT")]
    NativeTenant,

    #[serde(rename = "RESOURCE_FILTER")]
    ResourceFilter,

    #[serde(rename = "RESOURCE_INSTANCE")]
    ResourceInstance,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterSecretRead {
    pub audience: String,

    pub request_id: String,

    pub secret_key: String,

    pub version: i64,
}

/// ADR-12 execute/observe/cancel/reconcile 的原生观察。字段取自 design03 ExternalExecution；nativeId
/// 允许未取得，值域与具体操作的终态证据由接收者验证。取消接收仍为 RUNNING/UNKNOWN，不伪装 CANCELLED。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterExecutionObservation {
    pub cancel_capability: NativeCancelCapability,

    pub idempotency_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_observed_at: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_status: Option<String>,

    pub native_type: String,

    pub platform_status: ExternalExecutionStatus,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_at: Option<String>,
}

/// design03§6 ExternalExecution 的既定平台状态；HTTP成功和cancel accepted均不构成终态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExternalExecutionStatus {
    Cancelled,

    Failed,

    #[serde(rename = "PENDING_DISPATCH")]
    PendingDispatch,

    Running,

    Succeeded,

    Unknown,
}

/// 原 ExternalExecution 的 observe/extract_usage 引用；不携带正文，不新建执行，不接受引用自报 scope。nativeId
/// 未取得时只用冻结幂等键查证。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterExecutionReference {
    pub external_execution_id: String,

    pub idempotency_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_id: Option<String>,

    pub native_type: String,
}

/// ADR-12 执行响应分离原生任务观察与能力结果。HTTP 接收不是终态；resultJson 只在原生 SUCCEEDED 且符合固定结果 schema 时消费。它不进入
/// Core 的套件报告。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterExecutionResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ReferenceClass>,

    pub execution: ExecutionClass,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_json: Option<String>,
}

/// design03 的唯一内容引用线格式；不是业务正文。Adapter typed 槽是传递引用的唯一来源，resultJson 不用于识别或重建引用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceClass {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,

    pub display_name: String,

    pub media_type: String,

    pub native_object_ref: String,

    pub native_revision: String,

    pub resource_id: String,
}

/// ADR-12 execute/observe/cancel/reconcile 的原生观察。字段取自 design03 ExternalExecution；nativeId
/// 允许未取得，值域与具体操作的终态证据由接收者验证。取消接收仍为 RUNNING/UNKNOWN，不伪装 CANCELLED。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionClass {
    pub cancel_capability: NativeCancelCapability,

    pub idempotency_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_observed_at: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_status: Option<String>,

    pub native_type: String,

    pub platform_status: ExternalExecutionStatus,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_at: Option<String>,
}

/// DD-48/51/94 extract_usage 的原生终态用量元数据；scope/customer/dimensions 只由 Core 原
/// ExternalExecution 决定。完整集合与冻结 action meters 精确相等，缺失不是零。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterExecutionUsage {
    pub external_execution_id: String,

    pub idempotency_key: String,

    pub measurements: Vec<Measurement>,

    pub native_id: String,

    pub native_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Measurement {
    pub meter_key: String,

    pub occurred_at: String,

    pub quantity: i64,
}

/// ADR-12
/// adapter入站fresh校验。ActionToken只瞬时校验、不入history或审计正文；参数由原ActionToken摘要绑定，binding由受认证client精确匹配。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterPepCheckRequest {
    pub action_token: String,

    pub arguments_json: String,

    pub binding_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ReferenceClass>,

    pub operation: String,
}

/// 只在原动作和精确binding仍被fresh授权时返回当前授权revision；不是可复用的新授权票据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterPepCheckResponse {
    pub action_execution_id: String,

    pub authorization_min_zed_token: String,

    pub operation_id: String,
}

/// DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
/// VersionId，不提供文件字节或当前权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolRevisionQuery {
    pub base_revision: String,

    pub protocol_session_id: String,

    pub write_observation: WriteObservationClass,
}

/// 18 §5.4: authenticated native PutFile evidence for the existing ProtocolSession; never
/// file bytes or an authorization grant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteObservationClass {
    pub base_modified_at: String,

    pub bytes_written: i64,

    pub correlation_ref: String,

    pub editors: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_etag: Option<String>,

    pub phase: Phase,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Phase {
    #[serde(rename = "ACCEPTED")]
    Accepted,

    #[serde(rename = "CONFLICT")]
    Conflict,

    #[serde(rename = "FAILED")]
    Failed,

    #[serde(rename = "STARTED")]
    Started,

    #[serde(rename = "UNKNOWN")]
    Unknown,
}

/// 18: execute the original admitted file protocol Session, not an arbitrary editor URL or
/// native object create. All fields are frozen Core facts and the whole body is covered by
/// ActionToken.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProtocolSessionLaunchRequest {
    pub admitted_mode: TedMode,

    pub authorization_target_native_ref: String,

    pub expires_at: String,

    pub idempotency_key: String,

    pub locale: Locale,

    pub protocol_session_id: String,

    pub reference: ReferenceClass,

    pub theme: Theme,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TedMode {
    #[serde(rename = "EDIT")]
    Edit,

    #[serde(rename = "VIEW")]
    View,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Locale {
    En,

    #[serde(rename = "zh-CN")]
    ZhCn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Theme {
    #[serde(rename = "DARK")]
    Dark,

    #[serde(rename = "LIGHT")]
    Light,
}

/// 18: the original native PAT reference plus transient launch descriptor. This value occurs
/// only in the original execute response; it must not be stored as reconciliation evidence
/// or recovered by reminting a token.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProtocolSessionLaunchResponse {
    pub launch_descriptor: LaunchDescriptorClass,

    pub native_session_ref: String,
}

/// DD-95/103: transient, fixed-origin launch returned by the admitted binding adapter;
/// credentials are only string form fields, never a persisted Task, chat or ContentReference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchDescriptorClass {
    pub action_url: String,

    pub editor_origin: String,

    pub expires_at: String,

    pub form_fields: HashMap<String, String>,

    pub method: Method,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Method {
    #[serde(rename = "GET")]
    Get,

    #[serde(rename = "POST")]
    Post,
}

/// DD-90, 18 §5.1: binding-authenticated permission to observe/revoke the original document
/// PAT. These closed lifecycle facts never authorize file reads, writes or token creation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionLifecyclePepResponse {
    pub decision: Decision,

    pub expires_at: String,

    pub native_object_ref: String,

    pub protocol_session_id: String,

    pub requested_mode: TedMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Decision {
    #[serde(rename = "ALLOW")]
    Allow,
}

/// 18 §5.1: observe/cancel the same native document PAT only. No access token, launch
/// descriptor or file bytes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProtocolSessionLifecycleRequest {
    pub idempotency_key: String,

    pub native_object_ref: String,

    pub protocol_session_id: String,
}

/// Original Cells PAT metadata only. ABSENT is a successful native lookup; errors must
/// remain unavailable, never ABSENT.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProtocolSessionLifecycleResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,

    pub native_object_ref: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_ref: Option<String>,

    pub native_state: NativeState,

    pub protocol_session_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum NativeState {
    #[serde(rename = "ABSENT")]
    Absent,

    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "EXPIRED")]
    Expired,
}

/// 18 §5.2: authenticated binding→Core PEP for an existing ProtocolSession. No native token
/// grants platform permissions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionPepRequest {
    pub binding_id: String,

    pub native_object_ref: String,

    pub native_operation: NativeOperation,

    pub protocol_session_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_observation: Option<WriteObservationClass>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NativeOperation {
    Observe,

    Open,

    Read,

    #[serde(rename = "TOKEN_OBSERVE")]
    TokenObserve,

    #[serde(rename = "TOKEN_REVOKE")]
    TokenRevoke,

    Write,
}

/// Original Session facts, not native revision existence or write success. Cells must still
/// query its exact VersionId and ACLs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionPepResponse {
    pub admitted_mode: TedMode,

    pub base_revision: String,

    pub decision: Decision,

    pub display_name: String,

    pub expires_at: String,

    pub export_allowed: bool,

    pub min_zed_token: String,

    /// Confirmed original native token/session reference. Required by native READ/WRITE
    /// consumers, absent before the first native OPEN creation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_session_ref: Option<String>,

    /// Original active issuer from the HUMAN's frozen ExternalIdentity, never a browser-supplied
    /// claim.
    pub oidc_issuer: String,

    /// Original active subject paired with oidcIssuer. Cells resolves its existing explicit
    /// native user link; no email or display-name fallback.
    pub oidc_subject: String,

    pub platform_human_id: String,

    /// Exact canonical platform PUBLIC_ORIGIN from the Core deployment, never the native request
    /// Origin or a browser-supplied field. Required by the native FileInfo consumer; unavailable
    /// origin refuses its editor projection.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_message_origin: Option<String>,
}

/// 18 §5.4: authenticated native PutFile evidence for the existing ProtocolSession; never
/// file bytes or an authorization grant.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolWriteObservation {
    pub base_modified_at: String,

    pub bytes_written: i64,

    pub correlation_ref: String,

    pub editors: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_etag: Option<String>,

    pub phase: Phase,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_revision: Option<String>,
}

/// Receipt of native write evidence. It grants no read or write permission.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolWriteReceipt {
    pub protocol_session_id: String,

    pub state: ProtocolWriteReceiptState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProtocolWriteReceiptState {
    #[serde(rename = "CONFLICT")]
    Conflict,

    #[serde(rename = "DIRTY")]
    Dirty,

    #[serde(rename = "FAILED")]
    Failed,

    #[serde(rename = "SAVED")]
    Saved,

    #[serde(rename = "UNKNOWN")]
    Unknown,
}

///
/// 07§5.2与ADR-12：查询同一native对象当前权威revision；ActionToken通过Authorization头传输，幂等键与Idempotency-Key头一致。authorizationTargetNativeRef仅为Core从实际受权Resource/Asset解析的原生目标定位，参与同一参数签名；adapter须核实被查对象在该目标及固定binding
/// scope内。缺省保持确切目标查询，不授予一般子对象读取。不是execute或权限授予。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterQueryRevisionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_target_native_ref: Option<String>,

    pub idempotency_key: String,

    pub native_object_ref: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_reconcile: Option<ProtocolReconcileClass>,
}

/// DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
/// VersionId，不提供文件字节或当前权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolReconcileClass {
    pub base_revision: String,

    pub protocol_session_id: String,

    pub write_observation: WriteObservationClass,
}

///
/// 07§5.2与18§5：只返回被查证同一native对象当前权威revision，不替换调用方冻结ContentReference、不以mtime/ETag猜测revision。未知或fresh授权失败不得生成成功应答。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterQueryRevisionResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_ref: Option<String>,

    pub native_object_ref: String,

    pub native_revision: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_session_id: Option<String>,
}

/// DD-89: receiver binding authenticates as its own ServicePrincipal for one source-resource
/// read batch. Input is checked against the approved source action schema; Core retains its
/// digest, not the returned business content.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReadGrantRequest {
    pub action_key: String,

    pub action_version: i64,

    pub idempotency_key: String,

    pub input_json: String,

    pub receiver_action_execution_id: String,

    pub receiver_arguments_json: String,

    pub receiver_binding_id: String,

    pub source_resource_id: String,
}

/// DD-89: short-lived source Adapter authorization, not native credentials or proof that the
/// batch finished. The endpoint is resolved from the existing controlled adapter directory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReadGrantResponse {
    pub action_execution_id: String,

    pub action_token: String,

    pub arguments_json: String,

    pub endpoint: String,

    pub expires_at: i64,

    pub operation_id: String,

    pub source_binding_id: String,
}

/// DD-98：按同一 platform Resource ref CREATE/LOOKUP；FOUND 保留上游实际引用，不由套件预测或生成 native ID。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterScopeObservation {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_ref: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_type: Option<String>,

    pub platform_resource_ref: String,

    pub result: NativeScopeResult,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NativeScopeResult {
    #[serde(rename = "ABSENT_FENCED")]
    AbsentFenced,

    Found,

    Refused,
}

/// POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
/// actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCommand {
    pub action_key: String,

    /// 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_version_content: Option<ContentClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_binding_create: Option<ApplicationBindingCreateClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_binding_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_binding_version: Option<i64>,

    /// AgentVersion 管理动作的目标 Asset；Core 核对父 Resource、Tenant、owner、版本与投影。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,

    /// 调用方实际读取的 Asset 版本；旧版本不能改写新的草稿或发布事实。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_version: Option<i64>,

    /// 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_version_content: Option<AutomationVersionContentClass>,

    /// 仅 capability_contract.approve/deprecate：固定已登记版本。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_contract_ref: Option<CapabilityContractRefClass>,

    /// 仅 capability_contract.register：真实 schema 与测试向量内容。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_contract_registration: Option<CapabilityContractRegistrationClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_action: Option<ComponentActionClass>,

    /// 仅组件批准：已登记的不可变ComponentRelease标识。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_release_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_release_registration: Option<ComponentReleaseRegistrationClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_open: Option<ConversationOpenClass>,

    /// 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_grant: Option<ParametersClass>,

    /// 显式 Delegation 管理的稳定 Grant ID；授予者提供新 ID，撤销引用实际已有 ID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_id: Option<String>,

    /// 仅 revoke：调用方实际读取的 Grant 版本。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_version: Option<i64>,

    /// 仅 automation.create：同一 Workspace 的确切 AgentInstallation Resource，不从名称或当前默认配置推断。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub executor_installation_resource_id: Option<String>,

    /// EXPLICIT 动作或 HUMAN owner 的一次手动 automation.run，由用户在当前目标详情上确认后设为 true；其他动作不得携带。手动运行只提交
    /// resourceId/resourceVersion/workspaceId 与同一幂等键，不选择 Grant、Agent、来源或结果位置。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub explicit_confirmation: Option<bool>,

    /// 调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
    pub idempotency_key: String,

    /// tenant.member.invite.revoke 的目标邀请
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation_id: Option<String>,

    /// 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_route_create: Option<LlmRouteCreateClass>,

    /// 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
    /// 输入；其他命令禁止携带。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_write: Option<MemoryWriteClass>,

    /// workspace.create 或 AgentDefinition 创建/更新的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// 任务控制只接收原 ActionExecution ID；原 Workflow、target 与 scope 由 Core 解析
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_action_execution_id: Option<String>,

    /// 成员动作的目标 Principal；resource.transfer_owner 的新 owner
    #[serde(skip_serializing_if = "Option::is_none")]
    pub principal_id: Option<String>,

    /// Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
    /// identity; no Agent or caller-selected native credentials.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_session_open: Option<ProtocolSessionOpenClass>,

    /// 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
    /// 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略保留原 AGENT 自身读取授权命令。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_resource: Option<ReceiverResource>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_create: Option<ResourceCreateClass>,

    /// Resource 管理动作的目标；Core 重新核对同 Tenant、scope、owner 和投影
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,

    /// 调用方实际读取的 Resource 版本；与当前事实不同即 CONFLICT
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_version: Option<i64>,

    /// workspace.create 或 agent.definition.create 的稳定 slug
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,

    /// 仅 agent.invoke 人工分派：本人在该 Workspace Channel 已持久发布的消息 ID；Core 回读验签并与普通 mention 共用源事件幂等。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_event_id: Option<String>,

    /// tenant.suspend / tenant.restore 的目标业务 Tenant；执行 Tenant 仍是会话 Tenant（Platform Catalog）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_channel: Option<WorkspaceChannelClass>,

    /// Workspace 内动作的执行 Workspace
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,

    /// 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_visibility: Option<WorkspaceVisibility>,
}

/// 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
///
/// 03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
/// environment。发布不等于安装或运行授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentClass {
    /// 精确 contract_key@version，不引用业务能力实现名。
    pub capability_requirements: Vec<String>,

    pub declared_tool_resource_ids: Vec<String>,

    pub instructions: String,

    pub memory_policy: ContentMemoryPolicy,

    pub model_route_resource_id: String,

    pub parallelism: i64,

    pub persona_identity: ContentPersonaIdentity,

    /// RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。
    pub reply_policy: String,

    pub runtime_profile_key: String,

    pub skill_version_asset_ids: Vec<String>,

    pub trigger_defaults: Vec<AgentTrigger>,

    pub turn_limits: ContentTurnLimits,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentMemoryPolicy {
    pub cold_write: AgentMemoryColdWrite,

    pub core_write: AgentMemoryCoreWrite,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentMemoryColdWrite {
    Disabled,

    #[serde(rename = "INVOCATION_SCOPED")]
    InvocationScoped,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentMemoryCoreWrite {
    #[serde(rename = "AGENT_WITH_APPROVAL")]
    AgentWithApproval,

    #[serde(rename = "HUMAN_ONLY")]
    HumanOnly,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentPersonaIdentity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentTrigger {
    #[serde(rename = "MANUAL_ASSIGNMENT")]
    ManualAssignment,

    Mention,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentTurnLimits {
    pub idle_timeout_seconds: i64,

    pub max_turn_duration_seconds: i64,
}

/// DD-88/94：pin 已批准 release 的业务绑定选择。只携带 SecretRef，不接受密钥正文或运行端点 URL。Workspace 取原
/// ActionCommand。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingCreateClass {
    pub adapter_service_ref: String,

    pub binding_id: String,

    pub call_identity_mode: ApplicationCallIdentityMode,

    pub capability_categories: Vec<ApplicationBindingCreateCapabilityCategory>,

    pub component_release_id: String,

    pub isolation_mode: ApplicationIsolationMode,

    pub model_call_mode: ApplicationModelCallMode,

    pub native_instance_ref: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_scope_ref: Option<String>,

    pub normalized_config_json: String,

    pub retain_on_tenant_delete: bool,

    pub secret_refs: Vec<ApplicationBindingCreateSecretRef>,

    pub service_principal_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApplicationCallIdentityMode {
    #[serde(rename = "END_USER_TOKEN")]
    EndUserToken,

    #[serde(rename = "INSTANCE_SERVICE")]
    InstanceService,

    #[serde(rename = "TENANT_SERVICE")]
    TenantService,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApplicationBindingCreateCapabilityCategory {
    pub category: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApplicationModelCallMode {
    None,

    #[serde(rename = "PLATFORM_LLM_ROUTE")]
    PlatformLlmRoute,

    #[serde(rename = "SELF_MANAGED_MODEL")]
    SelfManagedModel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingCreateSecretRef {
    pub audience: String,

    pub locator: String,

    pub secret_key: String,

    pub version: i64,
}

/// 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
///
/// REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval/calendar，不含触发消息正文、provider
/// 配置或凭据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationVersionContentClass {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<ContentAction>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<ApprovalPolicyElement>,

    /// 有序 steps 形态为 2，旧单 action 格式缺省保持原摘要。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_version: Option<i64>,

    /// 原工作流名称；随不可变版本冻结。旧版本缺省不补写、不重算历史摘要。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    pub result_target: AutomationResultTarget,

    /// 不可与旧 action 混用；支持有序 Delay、一个引用既有策略的 request_approval，最后发送一条消息。步骤审批不可同时声明版本级
    /// approvalPolicy；此切片不是原多副作用的产品上限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<StepElement>>,

    pub trigger: ContentTrigger,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ContentAction {
    pub kind: ActionKind,

    pub template: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ActionKind {
    #[serde(rename = "AGENT_TURN")]
    AgentTurn,

    #[serde(rename = "POST_MESSAGE")]
    PostMessage,
}

/// DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
///
/// request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalPolicyElement {
    pub id: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutomationResultTarget {
    Channel,

    #[serde(rename = "TRIGGER_THREAD")]
    TriggerThread,
}

/// 原 Buzz 有序步骤的已接通动作；步骤执行和延时仍归 Temporal。其它原动作不由此宣称已实现。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepElement {
    pub action: ActionEnum,

    /// request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<ApprovalPolicyElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<String>,

    pub id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionEnum {
    Delay,

    #[serde(rename = "request_approval")]
    RequestApproval,

    #[serde(rename = "send_message")]
    SendMessage,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentTrigger {
    pub kind: AutomationTriggerKind,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mention_principal_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_spec: Option<ScheduleSpecClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_prefix: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutomationTriggerKind {
    #[serde(rename = "CHANNEL_MESSAGE")]
    ChannelMessage,

    Mention,

    Schedule,
}

/// Temporal 原生 Schedule：显式 interval 或 Buzz UTC cron，二者互斥。catchupWindow 不小于原生的 10 秒，Overlap
/// 固定 SKIP。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleSpecClass {
    pub catchup_window_seconds: i64,

    /// 原 Buzz UTC cron：表单五字段，YAML 六字段包含秒、七字段增加年份；匹配由 Temporal 原生日历执行，不建立本地定时器。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub every_seconds: Option<i64>,

    /// 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<ScheduleSpecKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_seconds: Option<i64>,
}

/// 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ScheduleSpecKind {
    #[serde(rename = "CRON")]
    Cron,

    #[serde(rename = "INTERVAL")]
    Interval,
}

/// 仅 capability_contract.approve/deprecate：固定已登记版本。
///
/// 固定 Catalog 自然键，不授予业务能力 consume 权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRefClass {
    pub category_key: String,

    pub contract_version: i64,
}

/// 仅 capability_contract.register：真实 schema 与测试向量内容。
///
/// DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistrationClass {
    pub category_key: String,

    pub content_reference_semantics: CapabilityContractRegistrationContentReferenceSemantics,

    pub contract_version: i64,

    pub operation_contracts: Vec<CapabilityContractRegistrationOperationContract>,

    pub protocol_session_kinds: Vec<String>,

    pub required_declarations: Vec<CapabilityRequiredDeclaration>,

    pub resource_type_family: Vec<CapabilityContractRegistrationResourceTypeFamily>,

    pub schema_documents: Vec<String>,

    /// CapabilityConformanceVectors 的 JSON 编码，formatVersion 固定格式；任意自然语言对象数组不构成可执行向量。Core
    /// 校验所有步骤参数/结果符合契约 schema，覆盖所有 operationContracts，然后固定 canonical digest。
    pub test_vectors_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistrationContentReferenceSemantics {
    pub authorization_target_rule: String,

    pub native_object_ref_rule: String,

    pub native_revision_rule: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistrationOperationContract {
    pub contract_key: String,

    pub input_schema_digest: String,

    pub output_schema_digest: String,

    pub permission: CapabilityPermission,

    pub surface: CapabilitySurface,

    pub target_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityPermission {
    Approve,

    Audit,

    Consume,

    Create,

    Delegate,

    Delete,

    Discover,

    Execute,

    Export,

    Manage,

    Read,

    Share,

    #[serde(rename = "transfer_owner")]
    TransferOwner,

    Update,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CapabilitySurface {
    #[serde(rename = "ACTION")]
    Action,

    #[serde(rename = "TOOL")]
    Tool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapabilityRequiredDeclaration {
    Cancel,

    Meter,

    Observe,

    #[serde(rename = "ONLINE_EDITING")]
    OnlineEditing,

    #[serde(rename = "READ_EDGE")]
    ReadEdge,

    #[serde(rename = "REVISION_QUERY")]
    RevisionQuery,

    #[serde(rename = "TENANT_DELETE")]
    TenantDelete,

    #[serde(rename = "VERSIONED_MODEL")]
    VersionedModel,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistrationResourceTypeFamily {
    pub kind: String,

    pub type_key: String,
}

/// Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。参数是组件原生持久内容引用，不把 SQL、提示或结果正文写入
/// Core/Temporal。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentActionClass {
    pub action_version: i64,

    pub input_reference: ReferenceClass,

    pub result_exposure_policy_id: String,

    pub result_exposure_policy_version: i64,
}

/// 组件登记只提交实际 manifest、包清单与 binding config schema；不接收 suite 通过声明、报告或候选执行地址。Core 解析并冻结内容，原
/// Worker 独立执行隔离套件。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleaseRegistrationClass {
    pub binding_config_schema_json: String,

    pub manifest_json: String,

    pub package_json: String,
}

/// 原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationOpenClass {
    pub participant_principal_ids: Vec<String>,
}

/// 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParametersClass {
    pub expires_at: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<i64>,

    pub scopes: Vec<ScopeElement>,

    pub valid_from: String,
}

/// 03 §6 的确切 Action/target/exposure 限制；管理发现与原 Grant 写入共用，发现不授予 permission。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeElement {
    pub action_key: String,

    pub action_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub create_workspace_id: Option<String>,

    pub output_schema_hash: String,

    pub redaction_policy: String,

    pub result_exposure_mode: ResultExposureMode,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,

    pub target_type: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_resource_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResultExposureMode {
    #[serde(rename = "CONSUME_ONLY")]
    ConsumeOnly,

    Export,

    Read,
}

/// 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
///
/// 受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
/// 仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRouteCreateClass {
    pub model: Model,

    pub provider: Model,

    pub provider_credential_mode: LlmProviderCredentialMode,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_secret_ref: Option<LlmRouteCreateProviderSecretRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Model {
    pub id: String,

    pub revision: i64,

    pub sha256: String,
}

/// 提供方认证的显式封闭选择；NONE 不豁免 Gateway 调用者认证或业务授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LlmProviderCredentialMode {
    None,

    #[serde(rename = "SECRET_REF")]
    SecretRef,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlmRouteCreateProviderSecretRef {
    pub audience: String,

    pub locator: String,

    pub version: i64,
}

/// 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
/// 输入；其他命令禁止携带。
///
/// HUMAN Memory Action 本次瞬态输入；正文仅用于原生 NIP-AE 构造，不进入 ActionExecution、审计、outbox 或 history。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryWriteClass {
    /// entry.patch 当前原生 value 的 SHA-256。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_hash: Option<String>,

    /// 调用方实际读取的 head；null 只表示原生确认不存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,

    /// 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
    pub expected_head_state: ExpectedHeadState,

    /// entry.patch 的原生严格 unified diff，不支持 fuzz、offset 或多文件。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,

    pub slug: String,

    /// core.replace 的 profile 或 entry.set 的 value；完整序列化 JSON body 必须满足原生 NIP-44 上界。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ExpectedHeadState {
    #[serde(rename = "ABSENT")]
    Absent,

    #[serde(rename = "FOUND")]
    Found,
}

/// Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
/// identity; no Agent or caller-selected native credentials.
///
/// 03/07/18: the original HUMAN file protocol action, not an arbitrary editor or native URL.
/// Revision and presentation are frozen once; session expiry comes from controlled Core
/// delivery.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionOpenClass {
    pub action_version: i64,

    /// The selected native source binding; must equal the target's real binding, not an
    /// authorization claim.
    pub application_binding_id: String,

    pub locale: Locale,

    /// Exact approved projection selected by the native menu; never latest.
    pub projection_generation: i64,

    pub reference: ReferenceClass,

    pub theme: Theme,
}

/// 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
/// 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略保留原 AGENT 自身读取授权命令。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReceiverResource {
    pub id: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceCreateClass {
    pub evidence_digest: String,

    pub evidence_ref: String,

    pub native_ref: String,

    pub native_type: String,

    pub type_key: String,
}

/// workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChannelClass {
    pub channel_type: ChannelType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelType {
    Forum,

    Stream,
}

/// 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
///
/// DD-80 的产品可见性：open 仅指同 Tenant 成员可发现并经 Core 加入；Relay 投影始终 private。
///
/// Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceVisibility {
    Open,

    Private,
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

    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_launch: Option<LaunchDescriptorClass>,

    pub gate_state: ActionGateState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation: Option<InvitationClass>,

    pub operation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_session_id: Option<String>,

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

    #[serde(rename = "BINDING_NOT_ACTIVE")]
    BindingNotActive,

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

    #[serde(rename = "PAYLOAD_TOO_LARGE")]
    PayloadTooLarge,

    #[serde(rename = "PERMISSION_DENIED")]
    PermissionDenied,

    #[serde(rename = "PROJECTION_DELAYED")]
    ProjectionDelayed,

    #[serde(rename = "PUBLISH_REJECTED")]
    PublishRejected,

    #[serde(rename = "PUBLISH_RESULT_UNKNOWN")]
    PublishResultUnknown,

    #[serde(rename = "QUOTA_EXHAUSTED")]
    QuotaExhausted,

    #[serde(rename = "RATE_LIMITED")]
    RateLimited,

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

    #[serde(rename = "TENANT_NOT_ACTIVE")]
    TenantNotActive,

    #[serde(rename = "TENANT_SELECTION_NOT_AVAILABLE")]
    TenantSelectionNotAvailable,

    #[serde(rename = "WAITING_APPROVAL")]
    WaitingApproval,
}

/// 同 Tenant 且当前 discover 权限允许的 AgentDefinition 页；nextOffset 续读同一排序，不代表总量上限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionPage {
    pub definitions: Vec<DefinitionElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

/// DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionElement {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_published_version_asset_id: Option<String>,

    pub display_name: String,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub stable_slug: String,

    pub status: String,
}

/// 03 §7 Resource 的正式状态，投影未闭合不得呈现 ACTIVE。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ResourceState {
    Active,

    Deleted,

    Deleting,

    Failed,

    Provisioning,

    #[serde(rename = "RETAINED_READ_ONLY")]
    RetainedReadOnly,

    Unknown,
}

/// DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_published_version_asset_id: Option<String>,

    pub display_name: String,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub stable_slug: String,

    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelegationPage {
    pub can_grant: bool,

    pub can_revoke: bool,

    pub grants: Vec<GrantElement>,

    pub installation_resource_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub resource_version: i64,

    pub workspace_id: String,
}

/// 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GrantElement {
    pub delegation_id: String,

    pub delegation_version: i64,

    pub grantor_principal_id: String,

    pub parameters: ParametersClass,

    pub state: GrantState,

    pub uses: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum GrantState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "EXPIRED")]
    Expired,

    #[serde(rename = "REVOKED")]
    Revoked,

    #[serde(rename = "REVOKING")]
    Revoking,
}

/// 原 Grant 校验器当前允许的确切 Action/target/exposure；空页没有可授予对象，不伪造默认 Scope。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelegationTargetPage {
    pub installation_resource_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub resource_version: i64,

    pub scopes: Vec<ScopeElement>,

    pub workspace_id: String,
}

/// 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelegationView {
    pub delegation_id: String,

    pub delegation_version: i64,

    pub grantor_principal_id: String,

    pub parameters: ParametersClass,

    pub state: GrantState,

    pub uses: i64,
}

/// 实际 ACTIVE Definition/PUBLISHED Asset 的安装来源与版本；不表示新 Installation 或 runtime 已 ACTIVE。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationCandidate {
    pub agent_resource_id: String,

    pub agent_version_asset_id: String,

    pub asset_version: i64,

    pub display_name: String,

    pub ordinal: i64,

    pub resource_version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationCandidatePage {
    /// 原 Installation create exposure、目录与 fresh Workspace create；每个候选还须 consume/投影查证，提交时全部重验。
    pub can_create: bool,

    pub candidates: Vec<CandidateElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub workspace_id: String,
}

/// 实际 ACTIVE Definition/PUBLISHED Asset 的安装来源与版本；不表示新 Installation 或 runtime 已 ACTIVE。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateElement {
    pub agent_resource_id: String,

    pub agent_version_asset_id: String,

    pub asset_version: i64,

    pub display_name: String,

    pub ordinal: i64,

    pub resource_version: i64,
}

/// 按既有部署登记页长扫描同一 Workspace，再以 fresh Installation Resource read 过滤；空页不代表整个 Workspace 无安装。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationPage {
    pub installations: Vec<InstallationElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

/// 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
/// 正文、执行或管理权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationElement {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_projection_generation: Option<i64>,

    pub agent_principal_id: String,

    pub agent_principal_state: AgentPrincipalState,

    pub agent_resource_id: String,

    /// 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
    /// 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
    /// 准入。缺失或空集合不支持 Schedule。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_result_targets: Option<Vec<AutomationResultTarget>>,

    /// 当前 ACTIVE 安装可按原 manage 权限申请已发布目标版本；仍须原治理审批，不代表升级已经准入。旧服务缺省不显示入口。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_upgrade: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_binding: Option<InstallationChannelBinding>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_permission: Option<InstallationExecutionPermission>,

    pub owner_principal_id: String,

    pub pinned_version_asset_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<ProjectionClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_permission: Option<InstallationReadPermission>,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub state: AgentInstallationState,

    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentPrincipalState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DISABLED")]
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationChannelBinding {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,

    pub status: ChannelBindingStatus,

    pub triggers: Vec<AgentTrigger>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ChannelBindingStatus {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DISABLED")]
    Disabled,

    #[serde(rename = "ERROR")]
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationExecutionPermission {
    pub can_grant: bool,

    pub can_revoke: bool,

    pub effective: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_action_execution_id: Option<String>,

    pub requested: bool,
}

/// 17 §8 的持久运行投影摘要；不证明本机进程当前健康，不返回正文、凭据或隔离目录。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionClass {
    pub agent_version_asset_id: String,

    pub config_hash: String,

    pub generation: i64,

    pub runtime_profile_key: String,

    pub state: AgentRuntimeProjectionState,
}

/// 03 §7 的静态运行投影状态，不承载 Invocation 动态准入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentRuntimeProjectionState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "PENDING")]
    Pending,

    #[serde(rename = "REVOKED")]
    Revoked,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationReadPermission {
    pub can_grant: bool,

    pub can_revoke: bool,

    pub effective: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_action_execution_id: Option<String>,

    pub requested: bool,
}

/// 03 §7、17 §6 的 Installation 状态；ACTIVE 要求实际投影与运行查证闭合。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentInstallationState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DISABLED")]
    Disabled,

    #[serde(rename = "DRAINING")]
    Draining,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "PROVISIONING")]
    Provisioning,
}

/// 17 §8 的持久运行投影摘要；不证明本机进程当前健康，不返回正文、凭据或隔离目录。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationProjectionView {
    pub agent_version_asset_id: String,

    pub config_hash: String,

    pub generation: i64,

    pub runtime_profile_key: String,

    pub state: AgentRuntimeProjectionState,
}

/// 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
/// 正文、执行或管理权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_projection_generation: Option<i64>,

    pub agent_principal_id: String,

    pub agent_principal_state: AgentPrincipalState,

    pub agent_resource_id: String,

    /// 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
    /// 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
    /// 准入。缺失或空集合不支持 Schedule。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_result_targets: Option<Vec<AutomationResultTarget>>,

    /// 当前 ACTIVE 安装可按原 manage 权限申请已发布目标版本；仍须原治理审批，不代表升级已经准入。旧服务缺省不显示入口。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_upgrade: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_binding: Option<AgentInstallationViewChannelBinding>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_permission: Option<AgentInstallationViewExecutionPermission>,

    pub owner_principal_id: String,

    pub pinned_version_asset_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<ProjectionClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_permission: Option<AgentInstallationViewReadPermission>,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub state: AgentInstallationState,

    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationViewChannelBinding {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,

    pub status: ChannelBindingStatus,

    pub triggers: Vec<AgentTrigger>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationViewExecutionPermission {
    pub can_grant: bool,

    pub can_revoke: bool,

    pub effective: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_action_execution_id: Option<String>,

    pub requested: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationViewReadPermission {
    pub can_grant: bool,

    pub can_revoke: bool,

    pub effective: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_action_execution_id: Option<String>,

    pub requested: bool,
}

/// 19 §5：复合游标走到原生末尾才 COMPLETE。BOUND_EXCEEDED/UNKNOWN 不是空库存；只是本次 best-effort head tuple
/// snapshot，不是严格存量权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryEntryPage {
    pub entries: Vec<EntryElement>,

    pub installation_resource_id: String,

    pub operation_id: String,

    pub state: AgentMemoryEntryPageState,

    pub workspace_id: String,
}

/// NIP-AE cold head tuple，不含 value；tombstone 是当前原生 head，不回退旧 value。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntryElement {
    pub created_at: i64,

    pub event_id: String,

    pub slug: String,

    pub tombstone: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentMemoryEntryPageState {
    #[serde(rename = "BOUND_EXCEEDED")]
    BoundExceeded,

    Complete,

    Unknown,
}

/// NIP-AE cold head tuple，不含 value；tombstone 是当前原生 head，不回退旧 value。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryEntryView {
    pub created_at: i64,

    pub event_id: String,

    pub slug: String,

    pub tombstone: bool,
}

/// DD-66/68、19 §5：fresh HUMAN Installation read 后的原生 core/cold head。正文仅本次 no-store HTTP，不入
/// Core 数据库、审计或客户端持久存储。ABSENT 不等于 UNREADABLE；tombstone 可带原 head 引用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryReadView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,

    /// UTF-8 bytes of the returned content string, not the whole native NIP-44 JSON body or a
    /// billing measurement.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_bytes: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,

    pub installation_resource_id: String,

    pub operation_id: String,

    pub slug: String,

    pub state: AgentMemoryReadViewState,

    /// FOUND only: native buzz mem hash of the exact UTF-8 value, used by strict patch baseHash;
    /// not the JSON body or a stored plaintext copy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value_hash: Option<String>,

    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentMemoryReadViewState {
    #[serde(rename = "ABSENT")]
    Absent,

    #[serde(rename = "FOUND")]
    Found,

    #[serde(rename = "UNREADABLE")]
    Unreadable,
}

/// DD-24/25/26：Definition 范围的受权版本配置目录，消费平台发布 RuntimeProfile 合同与已治理 Route。缺真实来源时两目录为空且
/// canCreate=false；目录或 canCreate 不授予发布、安装和运行权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionConfigurationPage {
    pub agent_resource_id: String,

    pub can_create: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub profiles: Vec<RuntimeProfileDirectorySchema>,

    pub resource_version: i64,

    pub routes: Vec<RouteElement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfileDirectorySchema {
    pub capability_contract: PurpleCapabilityContract,

    pub key: String,

    pub kind: RuntimeProfileKind,

    pub status: String,

    pub web_availability: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurpleCapabilityContract {
    pub capability_requirements: Vec<String>,

    pub max_idle_timeout_seconds: i64,

    pub max_parallelism: i64,

    pub max_turn_duration_seconds: i64,

    pub reply_policies: Vec<String>,

    /// 同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_policy_mappings: Option<Vec<PurpleRuntimeReplyPolicyMapping>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PurpleRuntimeReplyPolicyMapping {
    pub broadcast_replies: bool,

    pub key: String,

    pub thread_replies: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RuntimeProfileKind {
    #[serde(rename = "LOCAL_ACP")]
    LocalAcp,

    #[serde(rename = "REMOTE_PROVIDER")]
    RemoteProvider,

    #[serde(rename = "SERVER_CODEX")]
    ServerCodex,
}

/// 03 §7、17 §3：同 Tenant、fresh read 与 Workspace scope 查证后的既有治理 Route 元数据。原生 revision/hash
/// 已回读；不包含 provider 配置、正文、凭据或模型 endpoint，不证明某次执行已获准。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteElement {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_workspace_id: Option<String>,

    pub native_config_hash: String,

    pub native_config_resource_id: String,

    pub native_revision: i64,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_version: i64,
}

/// DD-24/25、17 §3/8：同 Definition 下逐项 fresh Asset read 后的版本目录；DRAFT 可发现，PUBLISHED/RETIRED
/// 不可编辑。nextOffset 属原始扫描窗口，空的受权页不证明全集为空。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionPage {
    pub agent_resource_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub resource_version: i64,

    pub versions: Vec<VersionElement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionElement {
    pub agent_resource_id: String,

    pub asset_id: String,

    pub asset_version: i64,

    /// 当前 HUMAN 对此 exact DRAFT 的已登记 EXPLICIT publish 动作及 fresh Asset manage
    /// 资格；缺字段不允许发布，不证明已安装或可运行。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_publish: Option<bool>,

    /// 当前 HUMAN 对此 exact PUBLISHED 的已登记 EXPLICIT retire 动作及 fresh Asset manage
    /// 资格；缺字段不允许退役，退役只禁止新安装，保留既有安装与在途的固定版本。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_retire: Option<bool>,

    /// 当前 HUMAN 对此 exact DRAFT 的已登记 update 动作及 fresh Asset update 资格；缺字段不允许编辑，提交时仍重验。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_update: Option<bool>,

    pub config_hash: String,

    pub content: ContentClass,

    pub ordinal: i64,

    pub owner_principal_id: String,

    pub state: AgentVersionState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentVersionState {
    #[serde(rename = "DRAFT")]
    Draft,

    #[serde(rename = "PUBLISHED")]
    Published,

    #[serde(rename = "RETIRED")]
    Retired,
}

/// 03 §7、17 §3：同 Tenant、fresh read 与 Workspace scope 查证后的既有治理 Route 元数据。原生 revision/hash
/// 已回读；不包含 provider 配置、正文、凭据或模型 endpoint，不证明某次执行已获准。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionRouteOption {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_workspace_id: Option<String>,

    pub native_config_hash: String,

    pub native_config_resource_id: String,

    pub native_revision: i64,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionView {
    pub agent_resource_id: String,

    pub asset_id: String,

    pub asset_version: i64,

    /// 当前 HUMAN 对此 exact DRAFT 的已登记 EXPLICIT publish 动作及 fresh Asset manage
    /// 资格；缺字段不允许发布，不证明已安装或可运行。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_publish: Option<bool>,

    /// 当前 HUMAN 对此 exact PUBLISHED 的已登记 EXPLICIT retire 动作及 fresh Asset manage
    /// 资格；缺字段不允许退役，退役只禁止新安装，保留既有安装与在途的固定版本。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_retire: Option<bool>,

    /// 当前 HUMAN 对此 exact DRAFT 的已登记 update 动作及 fresh Asset update 资格；缺字段不允许编辑，提交时仍重验。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_update: Option<bool>,

    pub config_hash: String,

    pub content: ContentClass,

    pub ordinal: i64,

    pub owner_principal_id: String,

    pub state: AgentVersionState,
}

/// 当前HUMAN管理scope内的真实接入元数据。不是组件内部状态、配置、SecretRef或原生管理credential。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingPage {
    pub bindings: Vec<ApplicationBindingView>,

    pub can_create: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_projection_generation: Option<i64>,

    pub binding_id: String,

    pub can_disable: bool,

    pub capability_categories: Vec<ApplicationBindingCapability>,

    pub component_release_id: String,

    pub component_type_key: String,

    /// Approved release declares an independent native page. Launch still freshly checks
    /// binding, scope and deployment origins.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_native_page: Option<bool>,

    pub state: ApplicationBindingState,

    pub tenant_id: String,

    pub version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApplicationBindingCapability {
    pub category: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ApplicationBindingState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DISABLED")]
    Disabled,

    #[serde(rename = "DISABLING")]
    Disabling,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "PROVISIONING")]
    Provisioning,

    #[serde(rename = "UPGRADING")]
    Upgrading,
}

/// Authorized ACTIVE binding's independent native page. Exact origin is release and
/// deployment approved; no native credential or page body is returned.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationNativePage {
    pub allowed_origins: Vec<String>,

    pub binding_id: String,

    pub origin: String,

    pub projection_generation: i64,

    pub url: String,
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

    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_step: Option<AutomationStepClass>,

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

/// 有权读取的审批所绑定不可变 AutomationVersion 中的步骤展示，不是另一审批或内容权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStepClass {
    pub id: String,

    pub message: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    pub version_asset_id: String,
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

/// GET /api/v1/audit/events 的有界回应：当前 Tenant（或其中一个 Workspace）范围内的审计事件，调用方须对该范围持有 audit
/// permission，每次 fresh Check。证据只列种类，不含稳定 ID；稳定 ID 经单条解引用在同一授权下取得（.design/03 §14）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEventPage {
    pub events: Vec<AuditEventView>,

    /// 下一页首项之前的事件 ID；缺省即已经读完
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditEventView {
    pub action_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_principal_id: Option<String>,

    pub decision: String,

    pub event_type: AuditEventType,

    pub evidence: Vec<AuditEvidenceSlot>,

    pub id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub initiator_principal_id: Option<String>,

    /// RFC3339
    pub occurred_at: String,

    pub result_code: String,

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AuditEvidenceSlot {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authority: Option<EvidenceAuthority>,

    /// 证据在该事件中的位置，解引用时使用
    pub index: i64,

    /// 存量种类不可识别时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<EvidenceKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensitivity: Option<EvidenceSensitivity>,
}

/// EvidenceRef 所指证据的源码权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EvidenceAuthority {
    #[serde(rename = "AGENTGATEWAY")]
    Agentgateway,

    #[serde(rename = "BUZZ")]
    Buzz,

    #[serde(rename = "CORE")]
    Core,

    #[serde(rename = "OIDC")]
    Oidc,

    #[serde(rename = "OPENMETER")]
    Openmeter,

    #[serde(rename = "SPICEDB")]
    Spicedb,

    #[serde(rename = "TEMPORAL")]
    Temporal,
}

/// 存量种类不可识别时缺省
///
/// AuditEvent 中 EvidenceRef 的封闭种类（.design/03 §14）。每种只承载其权威源中的稳定 ID（可带
/// version），权威源、证据类型与敏感级别由种类唯一确定（Core 的固定描述表）。库中存量出现不在此列的种类时解释为不可用，不猜测含义。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceKind {
    #[serde(rename = "ACTION_EXECUTION_ID")]
    ActionExecutionId,

    #[serde(rename = "ADMIT_ACTION_EXECUTION_ID")]
    AdmitActionExecutionId,

    #[serde(rename = "AGENTGATEWAY_USAGE_ID")]
    AgentgatewayUsageId,

    #[serde(rename = "APPROVAL_POLICY")]
    ApprovalPolicy,

    #[serde(rename = "APPROVAL_WORKFLOW_ID")]
    ApprovalWorkflowId,

    #[serde(rename = "BUZZ_DELETION_INVENTORY_DIGEST")]
    BuzzDeletionInventoryDigest,

    #[serde(rename = "BUZZ_DELETION_REQUEST_ID")]
    BuzzDeletionRequestId,

    #[serde(rename = "BUZZ_EVENT_ID")]
    BuzzEventId,

    #[serde(rename = "BUZZ_PUBKEY")]
    BuzzPubkey,

    #[serde(rename = "DEPLOYMENT_BOOTSTRAP")]
    DeploymentBootstrap,

    #[serde(rename = "EXTERNAL_SUBJECT_SHA256")]
    ExternalSubjectSha256,

    #[serde(rename = "OPENMETER_EVENT_ID")]
    OpenmeterEventId,

    #[serde(rename = "ORIGINAL_ACTION_EXECUTION_ID")]
    OriginalActionExecutionId,

    #[serde(rename = "PLATFORM_SESSION_ID")]
    PlatformSessionId,

    #[serde(rename = "SECRET_REF_REHOME_ID")]
    SecretRefRehomeId,

    #[serde(rename = "SPICEDB_RELATIONSHIP")]
    SpicedbRelationship,

    #[serde(rename = "SPICEDB_ZEDTOKEN")]
    SpicedbZedtoken,

    #[serde(rename = "TEMPORAL_FIRST_RUN_ID")]
    TemporalFirstRunId,

    #[serde(rename = "TEMPORAL_RUN_ID")]
    TemporalRunId,

    #[serde(rename = "TEMPORAL_WORKFLOW_ID")]
    TemporalWorkflowId,

    #[serde(rename = "TENANT_DELETE_SUBPROCESS_ID")]
    TenantDeleteSubprocessId,

    #[serde(rename = "TENANT_INVITATION_ID")]
    TenantInvitationId,

    #[serde(rename = "TENANT_LIFECYCLE_SNAPSHOT_ID")]
    TenantLifecycleSnapshotId,

    #[serde(rename = "TENANT_MEMBERSHIP_ID")]
    TenantMembershipId,

    #[serde(rename = "TRACE_ID")]
    TraceId,

    #[serde(rename = "USAGE_EVENT_ID")]
    UsageEventId,
}

/// EvidenceRef 的敏感级别。SUMMARY 在当前 audit permission 下可解引用；RESTRICTED 还需 ResultExposure
/// 授权，在其交付前一律不可用（fail closed）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EvidenceSensitivity {
    #[serde(rename = "RESTRICTED")]
    Restricted,

    #[serde(rename = "SUMMARY")]
    Summary,
}

/// 有权读取的审批所绑定不可变 AutomationVersion 中的步骤展示，不是另一审批或内容权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationApprovalStepView {
    pub id: String,

    pub message: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    pub version_asset_id: String,
}

/// 实际 ACTIVE Grant 对该 Automation/run 的引用；不暴露 Secret、授予新权限或查询额度。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDelegationView {
    pub delegation_id: String,

    pub delegation_version: i64,

    pub executor_installation_resource_id: String,

    /// RFC3339，UTC；与现有管理查询时间字段一致。
    pub expires_at: String,

    pub owner_principal_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDetailView {
    pub automation: AutomationElement,

    /// 当前 Resource manage；不是运行准入、额度允许或业务成功。
    pub can_manage: bool,

    /// 仅当前 ACTIVE HUMAN owner、Workspace membership 与 Resource execute，以及已启用固定版本允许显示手动运行；仍须原
    /// automation.run 的准入、Delegation、额度及步骤审批。缺省关闭，不是业务成功。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_run: Option<bool>,

    pub delegations: Vec<DelegationElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_delegation_offset: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_version_offset: Option<i64>,

    pub versions: Vec<VersionClass>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationElement {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_id: Option<String>,

    pub executor_installation_resource_id: String,

    pub owner_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned_version_asset_id: Option<String>,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub state: AutomationState,

    pub workspace_id: String,
}

/// 03 §7、05 §2.9：AutomationDefinition 的真实管理状态，不是 Invocation 终态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AutomationState {
    #[serde(rename = "DELETED")]
    Deleted,

    #[serde(rename = "DISABLED")]
    Disabled,

    #[serde(rename = "DRAFT")]
    Draft,

    #[serde(rename = "ENABLED")]
    Enabled,

    #[serde(rename = "PAUSED")]
    Paused,
}

/// 实际 ACTIVE Grant 对该 Automation/run 的引用；不暴露 Secret、授予新权限或查询额度。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationElement {
    pub delegation_id: String,

    pub delegation_version: i64,

    pub executor_installation_resource_id: String,

    /// RFC3339，UTC；与现有管理查询时间字段一致。
    pub expires_at: String,

    pub owner_principal_id: String,
}

/// Core 自有 AutomationVersion 正文只在该 Asset fresh read 授权后返回；immutable Asset 三态复用既有版本契约。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionClass {
    pub asset_id: String,

    pub asset_version: i64,

    pub automation_resource_id: String,

    pub config_hash: String,

    pub content: AutomationVersionContentClass,

    pub ordinal: i64,

    pub owner_principal_id: String,

    pub state: AgentVersionState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPage {
    pub automations: Vec<AutomationElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_approval_policies: Option<Vec<ApprovalPolicyElement>>,

    /// 本次 fresh Workspace create 与已暴露真实动作共同成立；写前仍重新核验。
    pub can_create: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

/// GET /api/v1/automations/{resource_id}/runs：可读 Automation 的本人运行历史。游标只作分页，不授予权限；每页重新核验。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunPage {
    pub automation_resource_id: String,

    /// 不透明 createdAt/id 稳定分页边界；缺省表示本次查询没有更多行。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,

    pub runs: Vec<RunElement>,
}

/// 本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunElement {
    /// 原 TaskProjection 进度；缺省不推测百分比或成功。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<String>,

    /// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_approval_task: Option<TaskClass>,

    pub task: TaskClass,

    /// 同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
    pub usage_event_ids: Vec<String>,
}

/// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
///
/// GET /api/v1/tasks 与 /api/v1/tasks/{actionExecutionId} 的元素：调用方本人发起的一个受治理动作。observation
/// 非空时投影不可担保为当前（PROJECTION_DELAYED）或结果不明（EXTERNAL_RESULT_UNKNOWN），UI 不得把它渲染成成功或失败。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskClass {
    pub action_execution_id: String,

    pub action_key: String,

    pub action_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_status: Option<ApprovalStatus>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    /// 仅任务详情且 Core 当前完成本人、权限、原 Workflow 运行事实重查后提供；提交时仍重新准入
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel_action_key: Option<String>,

    /// RFC3339，UTC
    pub created_at: String,

    pub dispatch_state: ActionDispatchState,

    pub gate_state: ActionGateState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation: Option<ReasonCode>,

    pub operation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    /// 仅任务详情且 Core 证明原 Workflow 已关闭、终态投影一致、原目标仍在收敛版本并完成本人和权限重查后提供；提交与派发时仍重新准入
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rerun_action_key: Option<String>,

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
    #[serde(rename = "AGENT_INSTALLATION")]
    AgentInstallation,

    #[serde(rename = "BUZZ_IDENTITY_PROJECTION")]
    BuzzIdentityProjection,

    #[serde(rename = "COMPONENT_ACTION")]
    ComponentAction,

    #[serde(rename = "COMPONENT_BINDING")]
    ComponentBinding,

    #[serde(rename = "COMPONENT_DISABLE")]
    ComponentDisable,

    #[serde(rename = "COMPONENT_RELEASE")]
    ComponentRelease,

    #[serde(rename = "CONVERSATION_PROJECTION")]
    ConversationProjection,

    #[serde(rename = "MEMBERSHIP_PROJECTION")]
    MembershipProjection,

    #[serde(rename = "MEMBERSHIP_REVOCATION")]
    MembershipRevocation,

    #[serde(rename = "PROTOCOL_SESSION_RECONCILE")]
    ProtocolSessionReconcile,

    #[serde(rename = "RESOURCE_PROVISION")]
    ResourceProvision,

    #[serde(rename = "SECRET_REF_REHOME")]
    SecretRefRehome,

    #[serde(rename = "TENANT_LIFECYCLE")]
    TenantLifecycle,

    #[serde(rename = "WORKSPACE_LIFECYCLE")]
    WorkspaceLifecycle,
}

/// 本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunView {
    /// 原 TaskProjection 进度；缺省不推测百分比或成功。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<String>,

    /// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_approval_task: Option<TaskClass>,

    pub task: TaskClass,

    /// 同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
    pub usage_event_ids: Vec<String>,
}

/// Core 自有 AutomationVersion 正文只在该 Asset fresh read 授权后返回；immutable Asset 三态复用既有版本契约。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationVersionView {
    pub asset_id: String,

    pub asset_version: i64,

    pub automation_resource_id: String,

    pub config_hash: String,

    pub content: AutomationVersionContentClass,

    pub ordinal: i64,

    pub owner_principal_id: String,

    pub state: AgentVersionState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_id: Option<String>,

    pub executor_installation_resource_id: String,

    pub owner_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned_version_asset_id: Option<String>,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub state: AutomationState,

    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractPage {
    pub can_register: bool,

    pub contracts: Vec<ContractElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

/// 受权 Catalog 元数据，不复制 schema/测试向量或业务正文，不证明 release/binding 可用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContractElement {
    /// PLATFORM_SEED 的部署引导证据；不冒充人为登记或批准。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bootstrap_action_execution_id: Option<String>,

    pub can_approve: bool,

    pub can_deprecate: bool,

    pub category_key: String,

    pub conformance_suite_digest: String,

    pub contract_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered_by_action_execution_id: Option<String>,

    pub schema_set_digest: String,

    pub status: CapabilityContractStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CapabilityContractStatus {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DEPRECATED")]
    Deprecated,

    #[serde(rename = "DRAFT")]
    Draft,

    #[serde(rename = "RETIRED")]
    Retired,
}

/// 受权 Catalog 元数据，不复制 schema/测试向量或业务正文，不证明 release/binding 可用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractView {
    /// PLATFORM_SEED 的部署引导证据；不冒充人为登记或批准。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bootstrap_action_execution_id: Option<String>,

    pub can_approve: bool,

    pub can_deprecate: bool,

    pub category_key: String,

    pub conformance_suite_digest: String,

    pub contract_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub registered_by_action_execution_id: Option<String>,

    pub schema_set_digest: String,

    pub status: CapabilityContractStatus,
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

///
/// Core私网仅向受信Worker返回的逐次隔离探测凭据。token仅在Activity内存中使用，禁止进入Temporal输入、输出或报告。其声明绑定固定模拟上下文与完整实际参数，不授予生产binding授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceAuthorization {
    pub expected_response_digest: String,

    pub operation: ComponentConformanceOperation,

    pub request_digest: String,

    pub request_json: String,

    pub token: String,
}

/// 原登记套件的真实操作种类；MCP 方法不属于 AdapterProtocolOperation，也不要求原生 peer 实现 Adapter API。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComponentConformanceOperation {
    Cancel,

    Execute,

    #[serde(rename = "extract_usage")]
    ExtractUsage,

    Handshake,

    #[serde(rename = "map_native_status_error")]
    MapNativeStatusError,

    #[serde(rename = "mcp_call")]
    McpCall,

    #[serde(rename = "mcp_initialize")]
    McpInitialize,

    #[serde(rename = "mcp_list")]
    McpList,

    Observe,

    #[serde(rename = "query_revision")]
    QueryRevision,

    Reconcile,

    #[serde(rename = "resolve_native_scope")]
    ResolveNativeScope,

    #[serde(rename = "validate_binding")]
    ValidateBinding,
}

/// Core原canonical_digest对同一已授权步骤实际响应的摘要；仅规范化事实，不声明套件通过或登记成功。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceWireDigests {
    pub request_digest: String,

    pub response_digest: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_digest: Option<String>,
}

/// 受信Worker实际HTTP响应的瞬时核验输入。正文仅在Activity与Core请求内存中存在，不得进入Temporal历史、报告、日志或数据库；不是用户上传的通过声明。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceWireObservation {
    pub http_status: i64,

    pub probe: ProbeClass,

    pub response_json: String,
}

/// 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
/// history 承接，不建立另一执行账本。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeClass {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ReferenceClass>,

    pub plan: PlanClass,

    /// 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconcile: Option<bool>,

    pub step_index: i64,
}

/// 受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanClass {
    pub action_execution_id: String,

    pub artifact_digest: String,

    pub component_release_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector_kind: Option<ConnectorKind>,

    pub contract_digests: Vec<String>,

    /// 独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
    pub identity_digest: String,

    pub operation_id: String,

    pub plan_digest: String,

    /// Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
    /// Describe 与同 workflow 的当前 TaskProjection 核对。
    pub run_id: String,

    pub steps: Vec<PlanStep>,

    pub suite_digest: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ConnectorKind {
    #[serde(rename = "PROTOCOL_PEER")]
    ProtocolPeer,

    #[serde(rename = "REMOTE_ADAPTER")]
    RemoteAdapter,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub case_key: String,

    /// 只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
    /// native 任务元数据。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_key: Option<String>,

    /// Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
    pub expected_http_status: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_mcp_result_kind: Option<McpResultKind>,

    pub expected_response_json: String,

    pub idempotency_key: String,

    pub operation: ComponentConformanceOperation,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_asset_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_from_step_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_resource_id: Option<String>,

    pub request_json: String,

    pub step_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum McpResultKind {
    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "RESULT")]
    Result,
}

/// 原受信Worker在原审批后的COMPONENT_RELEASE Activity报告实际自身能力。Core自行读取自身与当前Web事实，并重新核验原release套件和审批。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleaseApprovalReport {
    pub run_id: String,

    pub target: TargetClass,

    pub worker_build: WorkerBuildClass,
}

/// 原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetClass {
    pub action_execution_id: String,

    pub component_release_id: String,

    pub workflow_id: String,
}

/// 设计03的当前已部署主体能力事实，由原受信服务/当前Web产物观察产生，不接受管理表单声明。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerBuildClass {
    pub adapter_protocol_versions: Vec<String>,

    pub build_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector_kinds: Option<Vec<String>>,

    pub driver_registry_keys: Vec<String>,

    pub host_api_version: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_protocol_versions: Option<Vec<String>>,

    pub platform_port_keys: Vec<PlatformPortKey>,

    pub reported_at: String,

    pub subject: Subject,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlatformPortKey {
    #[serde(rename = "AI_GATEWAY")]
    AiGateway,

    #[serde(rename = "APPROVAL_WORKFLOW")]
    ApprovalWorkflow,

    Authorization,

    #[serde(rename = "COLLABORATION_RELAY")]
    CollaborationRelay,

    #[serde(rename = "CORE_INTERNAL")]
    CoreInternal,

    #[serde(rename = "IDENTITY_EDGE")]
    IdentityEdge,

    #[serde(rename = "METERING_BILLING")]
    MeteringBilling,

    #[serde(rename = "SECRET_STORE")]
    SecretStore,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Subject {
    #[serde(rename = "BUZZ_WEB")]
    BuzzWeb,

    Core,

    Worker,
}

/// 受Catalog管理权限保护的已登记release元数据，正文与套件令牌不外露；REGISTERED不等于APPROVED或binding可用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleasePage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_approve: Option<bool>,

    pub can_register: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub releases: Vec<ComponentReleaseView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleaseView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approved_by_action_execution_id: Option<String>,

    pub artifact_digest: String,

    pub component_release_id: String,

    pub component_type_key: String,

    pub manifest_digest: String,

    pub operation_id: String,

    pub registered_by_action_execution_id: String,

    pub status: ComponentReleaseStatus,

    pub suite_digest: String,

    pub version: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ComponentReleaseStatus {
    #[serde(rename = "APPROVED")]
    Approved,

    #[serde(rename = "REGISTERED")]
    Registered,

    #[serde(rename = "REJECTED")]
    Rejected,

    #[serde(rename = "REVOKED")]
    Revoked,
}

/// 原准入同事务登记后的不可变引用；不是组件激活或审批回执。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleaseReceipt {
    pub action_execution_id: String,

    pub component_release_id: String,

    pub plan_digest: String,

    pub status: ComponentReleaseStatus,
}

/// 原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationOpenRequest {
    pub participant_principal_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationPage {
    pub items: Vec<ItemElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemElement {
    pub channel_id: String,

    pub id: String,

    pub operation_id: String,

    pub participant_principal_ids: Vec<String>,

    pub state: ItemState,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ItemState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DISABLED")]
    Disabled,

    #[serde(rename = "PROVISIONING")]
    Provisioning,

    #[serde(rename = "RECONCILING")]
    Reconciling,
}

/// 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationParticipant {
    pub display_name: String,

    pub principal_id: String,

    pub pubkeys: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationParticipantPage {
    pub items: Vec<ItemClass>,

    pub max_participants: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemClass {
    pub display_name: String,

    pub principal_id: String,

    pub pubkeys: Vec<String>,
}

/// PUT /api/v1/user-state/conversations/{conversationId} 的请求体（DD-40）：参与者私聊的收藏与静音，复用同一
/// CollaborationUserState version CAS。隐藏状态不在此权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ConversationPreferenceRequest {
    pub muted: bool,

    pub starred: bool,

    pub version: i64,
}

/// 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationView {
    pub channel_id: String,

    pub id: String,

    pub operation_id: String,

    pub participant_principal_ids: Vec<String>,

    pub state: ItemState,

    pub version: i64,
}

/// 已授权普通 Action 的 v1 平台元数据结果；不含业务正文、邀请凭证、文档或协议会话。仅 agent.invoke、automation.run 及已接入普通
/// resource 动作使用；与通用 BFF ActionSubmission 的可选扩展解耦。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegatedActionMetadataV1 {
    pub action_execution_id: String,

    pub action_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    pub dispatch_state: ActionDispatchState,

    pub gate_state: ActionGateState,

    pub operation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableWorkspace {
    pub channel: ChannelClass,

    pub created_at: String,

    pub id: String,

    /// 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
    pub is_member: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub join_action_key: Option<JoinActionKey>,

    pub member_count: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_state: Option<WorkspaceMembershipState>,

    pub visibility: WorkspaceVisibility,
}

/// Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelClass {
    pub archived: bool,

    pub channel_id: String,

    pub channel_type: ChannelType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_deadline: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum JoinActionKey {
    #[serde(rename = "workspace.join")]
    WorkspaceJoin,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableWorkspacePage {
    pub items: Vec<DiscoverableWorkspacePageItem>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableWorkspacePageItem {
    pub channel: ChannelClass,

    pub created_at: String,

    pub id: String,

    /// 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
    pub is_member: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub join_action_key: Option<JoinActionKey>,

    pub member_count: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_state: Option<WorkspaceMembershipState>,

    pub visibility: WorkspaceVisibility,
}

/// GET /api/v1/audit/events/{id}/evidence/{index} 的回应。每次以事件 scope 的当前 audit permission fresh
/// 授权；每种证据另向其权威源查证原对象仍存在：明确不存在回 404（正文为 NOT_FOUND 的不可用视图），权威源不提供查证接口为 UNVERIFIABLE，权威源不可达回
/// 503。不可用时不回任何 ref 内容。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authority: Option<EvidenceAuthority>,

    pub available: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<EvidenceKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensitivity: Option<EvidenceSensitivity>,

    /// 权威源中的稳定 ID；仅 available 为 true 时出现
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stable_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<EvidenceUnavailableReason>,

    /// 该 ID 的版本；证据未登记版本时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i64>,
}

/// 解引用只显示不可用时的原因：原证据已不存在（HTTP 404）、敏感级别未获授权、存量种类不可识别、权威源无法按该 ID 查证其仍存在。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceUnavailableReason {
    #[serde(rename = "NOT_FOUND")]
    NotFound,

    Restricted,

    Unrecognized,

    Unverifiable,
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

/// GET /api/v1/identity/legacy-secret-refs 的有界视图。只列当前 Tenant 中可发起 DD-85 归位的 SERVER
/// binding，不暴露 locator、版本或私钥。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacySecretRefPage {
    pub bindings: Vec<LegacySecretRefBinding>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// 业务 Tenant 的旧 SERVER 身份引用；仅给有 tenant manage 权限的人展示。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacySecretRefBinding {
    pub kind: BindingKind,

    pub principal_id: String,

    pub pubkey: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum BindingKind {
    #[serde(rename = "CONTROL")]
    Control,

    #[serde(rename = "HUMAN")]
    Human,
}

/// GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
/// communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCommunityFacts {
    /// 该 Tenant 的 Community host，可能带非默认端口
    pub community_host: String,

    /// 当前固定 Relay NIP-11 的 max_limit；旧客户端忽略，新 Pulse 消费者缺失时不猜测上限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay_query_limit: Option<i64>,

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

/// GET /api/v1/platform-info 的回应（DD-111）：只含公开展示字段，不依赖 PlatformSession
/// 与身份解析，仍在网关入口的认证之后。displayName 取自部署配置 PLATFORM_DISPLAY_NAME，是界面上产品名的唯一来源。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    /// 部署的显示名，去除首尾空白后非空
    pub display_name: String,
}

/// GET /api/v1/platform/tenants 的有界回应：只对 Platform Catalog Tenant 中持有 fresh Catalog manage
/// 的会话开放，列出业务 Tenant 及其当前状态与可发起的暂停/恢复动作提示（DD-96）。动作提交仍由 Core 重新准入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformTenantPage {
    /// 下一页的 Core 索引偏移，缺省即读完
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub tenants: Vec<PlatformTenantView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformTenantView {
    pub id: String,

    /// 按该 Tenant 当前状态可发起的暂停（ACTIVE，或协作面 binding 为 ACTIVE 的 ERROR）或恢复（SUSPENDED）动作
    /// key；目录未开放、处于收敛中或本页提示判定失败时省略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle_action_key: Option<TenantLifecycleActionKey>,

    pub name: String,

    pub slug: String,

    pub state: TenantState,
}

/// 按该 Tenant 当前状态可发起的暂停（ACTIVE，或协作面 binding 为 ACTIVE 的 ERROR）或恢复（SUSPENDED）动作
/// key；目录未开放、处于收敛中或本页提示判定失败时省略
///
/// 业务 Tenant 暂停与恢复的 ActionDefinition key（DD-96）。两者都由 Platform Catalog Tenant 的
/// platform-admin 发起；Tenant delete 随 Stage 3 注册，不在此列。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TenantLifecycleActionKey {
    #[serde(rename = "tenant.restore")]
    TenantRestore,

    #[serde(rename = "tenant.suspend")]
    TenantSuspend,
}

/// Tenant 状态机。权威定义见 .design/03-领域模型与权限模型.md。DELETING/DELETED 因 GAP-LCM-01
/// 开放而不注册入口，但状态本身保留以承载已有记录。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TenantState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DELETED")]
    Deleted,

    #[serde(rename = "DELETING")]
    Deleting,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "PROVISIONING")]
    Provisioning,

    #[serde(rename = "RESTORING")]
    Restoring,

    #[serde(rename = "SUSPENDED")]
    Suspended,

    #[serde(rename = "SUSPENDING")]
    Suspending,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformToolPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub tools: Vec<ToolElement>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolElement {
    pub action_key: ActionKey,

    pub can_consume: bool,

    pub input_schema_hash: String,

    pub name: ActionKey,

    pub output_schema_hash: String,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub source: Source,

    pub status: ToolStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ActionKey {
    #[serde(rename = "agent.memory.entry.list")]
    AgentMemoryEntryList,

    #[serde(rename = "agent.memory.entry.read")]
    AgentMemoryEntryRead,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Source {
    #[serde(rename = "PLATFORM_NATIVE")]
    PlatformNative,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ToolStatus {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "PROVISIONING")]
    Provisioning,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformToolView {
    pub action_key: ActionKey,

    pub can_consume: bool,

    pub input_schema_hash: String,

    pub name: ActionKey,

    pub output_schema_hash: String,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub source: Source,

    pub status: ToolStatus,
}

/// Original Buzz Community project/repository announcements and coordinate-scoped tombstones
/// only; no Git content or mutation authorization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectsQueryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coordinates: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,

    pub view: ProjectsQueryRequestView,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProjectsQueryRequestView {
    #[serde(rename = "DELETIONS")]
    Deletions,

    #[serde(rename = "PROJECTS")]
    Projects,

    #[serde(rename = "REPOSITORIES")]
    Repositories,
}

/// 03/18: only the initiating HUMAN's fresh-authorized original Session facts. No PAT,
/// launch credential, native body or replacement revision is recoverable from this reader.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionView {
    pub action_execution_id: String,

    pub admitted_mode: TedMode,

    pub application_binding_id: String,

    pub base_revision: String,

    pub effective_editor_origins: Vec<String>,

    pub expires_at: String,

    pub launch_locale: Locale,

    pub launch_theme: Theme,

    pub protocol_session_id: String,

    pub reference: ReferenceClass,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_revision: Option<String>,

    pub state: ProtocolSessionViewState,

    pub tenant_id: String,

    pub version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtocolSessionViewState {
    Admitted,

    Closed,

    Conflict,

    Dirty,

    Expired,

    Failed,

    Open,

    Opening,

    #[serde(rename = "READ_ONLY")]
    ReadOnly,

    Revoked,

    Saved,

    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PulsePublishRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<AttachmentElement>>,

    pub content: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<String>>,

    pub operation: Operation,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_event_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentElement {
    /// 原 Buzz imeta 模糊预览编码。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blurhash: Option<String>,

    /// 原 Buzz imeta 媒体尺寸显示元数据。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dim: Option<String>,

    /// 原附件 Markdown 链接显示名称；与 filename 分离，只写入消息正文，不生成 imeta 字段。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_label: Option<String>,

    /// 原 video/mp4 时长（秒），须为正有限数；Relay 校验原 sidecar。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,

    /// 原 Buzz imeta filename；仅为显示及下载名称，不参与媒体存储寻址。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,

    /// 原 video/mp4 独立 poster 图片引用；只允许当前 Community 的媒体路径，Relay 校验原图片 sidecar。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,

    pub sha256: String,

    pub size: i64,

    /// 沿原 Buzz Markdown 隐藏图片或视频；普通文件仍为文件链接。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spoiler: Option<bool>,

    /// 当前 Community 内与附件 hash 相同的原 .thumb.jpg 引用；Relay 验证实际缩略图存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,

    #[serde(rename = "type")]
    pub web_message_attachment_type: String,

    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Operation {
    #[serde(rename = "LIKE")]
    Like,

    #[serde(rename = "NOTE")]
    Note,

    #[serde(rename = "UNLIKE")]
    Unlike,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PulseQueryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_ids: Option<Vec<String>>,

    pub view: PulseQueryRequestView,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PulseQueryRequestView {
    #[serde(rename = "AGENTS")]
    Agents,

    #[serde(rename = "CONTACTS")]
    Contacts,

    #[serde(rename = "LIKED")]
    Liked,

    #[serde(rename = "NOTES")]
    Notes,

    #[serde(rename = "PROFILES")]
    Profiles,

    #[serde(rename = "REACTIONS")]
    Reactions,
}

/// PUT /api/v1/user-state/read 的请求体（DD-40、03 §2）。contextKey 只接受调用方可读 Workspace 内的 Channel
/// ID、msg:<Buzz event id> 或 thread:<Buzz root event id>；version 是读到的 CollaborationUserState
/// 版本，不符即 409。
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

    /// 当前 Tenant manage 与 tenant.member.revoke 目录均有效，且不是最后有效 Tenant admin；提交仍走原审批与重新准入，省略或 false
    /// 不显示动作。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_remove_from_tenant: Option<bool>,

    /// 当前 Workspace manage 与 workspace.member.revoke 目录均有效，目标存在可撤 WorkspaceMembership；省略或 false
    /// 不显示动作，提交仍重新准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_remove_from_workspace: Option<bool>,

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

/// GET /api/v1/role-workspaces 的有界回应：当前 Principal 对哪些 Workspace 持有 fresh manage
/// permission（ACTIVE、暂停中、已暂停、恢复中，以及已有协作面 binding 的 ERROR，各带当前状态），并附当前可用的 Workspace
/// 创建、暂停与恢复动作提示。动作提交仍由 Core 重新准入，不等于可进入频道。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleWorkspacePage {
    /// 当前 Principal 经 fresh Tenant create 检查可见的动作 key；目录未开放或无权时省略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub create_action_key: Option<CreateActionKey>,

    /// 下一页的 Core 索引偏移；不暴露无权 Workspace 的 ID，缺省即读完
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub workspaces: Vec<RoleWorkspaceView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CreateActionKey {
    #[serde(rename = "workspace.create")]
    WorkspaceCreate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleWorkspaceView {
    pub id: String,

    /// 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
    /// ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle_action_key: Option<WorkspaceLifecycleActionKey>,

    pub name: String,

    pub state: WorkspaceState,
}

/// 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
/// ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
///
/// Workspace 暂停与恢复的 ActionDefinition key（.design/06 §7.3）。两者都从 Tenant scope 发起；当前不登记
/// Workspace delete（DD-46）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceLifecycleActionKey {
    #[serde(rename = "workspace.restore")]
    WorkspaceRestore,

    #[serde(rename = "workspace.suspend")]
    WorkspaceSuspend,
}

/// Workspace 状态机。权威定义见 .design/03-领域模型与权限模型.md。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "PROVISIONING")]
    Provisioning,

    #[serde(rename = "RESTORING")]
    Restoring,

    #[serde(rename = "SUSPENDED")]
    Suspended,

    #[serde(rename = "SUSPENDING")]
    Suspending,
}

/// GET /api/v1/session 的回应：已解析的执行身份与本次 PlatformSession。原生端以 platformSessionId
/// 绑定设备持钥证明（DD-79）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformSessionView {
    pub access_mode: PlatformSessionAccessMode,

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

/// PlatformSession.access_mode（.design/03 §2）；受限会话不授予普通管理面或协作面准入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlatformSessionAccessMode {
    Full,

    #[serde(rename = "LIFECYCLE_RESTRICTED")]
    LifecycleRestricted,
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

    /// 仅任务详情且 Core 当前完成本人、权限、原 Workflow 运行事实重查后提供；提交时仍重新准入
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel_action_key: Option<String>,

    /// RFC3339，UTC
    pub created_at: String,

    pub dispatch_state: ActionDispatchState,

    pub gate_state: ActionGateState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation: Option<ReasonCode>,

    pub operation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    /// 仅任务详情且 Core 证明原 Workflow 已关闭、终态投影一致、原目标仍在收敛版本并完成本人和权限重查后提供；提交与派发时仍重新准入
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rerun_action_key: Option<String>,

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

/// Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebChannelView {
    pub archived: bool,

    pub channel_id: String,

    pub channel_type: ChannelType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_deadline: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebMessageAttachment {
    /// 原 Buzz imeta 模糊预览编码。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blurhash: Option<String>,

    /// 原 Buzz imeta 媒体尺寸显示元数据。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dim: Option<String>,

    /// 原附件 Markdown 链接显示名称；与 filename 分离，只写入消息正文，不生成 imeta 字段。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_label: Option<String>,

    /// 原 video/mp4 时长（秒），须为正有限数；Relay 校验原 sidecar。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<f64>,

    /// 原 Buzz imeta filename；仅为显示及下载名称，不参与媒体存储寻址。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,

    /// 原 video/mp4 独立 poster 图片引用；只允许当前 Community 的媒体路径，Relay 校验原图片 sidecar。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,

    pub sha256: String,

    pub size: i64,

    /// 沿原 Buzz Markdown 隐藏图片或视频；普通文件仍为文件链接。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub spoiler: Option<bool>,

    /// 当前 Community 内与附件 hash 相同的原 .thumb.jpg 引用；Relay 验证实际缩略图存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thumb: Option<String>,

    #[serde(rename = "type")]
    pub web_message_attachment_type: String,

    pub url: String,
}

/// 原 Buzz 线程分页的复合游标；下一请求以 before=createdAt、beforeId=eventId 原样提交，避免同秒回复丢失。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebMessageCursor {
    pub created_at: i64,

    pub event_id: String,
}

/// 同一已准入 Channel 的原生消息分页或线程读取。before/beforeId 必须成对，频道窗口向前翻历史，线程沿原 Relay
/// 协议向后读回复；上界来自运行时配置与原协议上界，不接受任意 Relay filter。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebMessageQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_type: Option<WebMessageType>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_event_id: Option<String>,
}

/// 原 Buzz 频道消息语义。缺省 STREAM 保持旧请求；不允许调用者提交任意事件 kind。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum WebMessageType {
    #[serde(rename = "FORUM_COMMENT")]
    ForumComment,

    #[serde(rename = "FORUM_POST")]
    ForumPost,

    Stream,
}

/// Own Buzz kind:0 metadata. The authenticated host chooses the signer and Tenant; no raw
/// event, author, relay URL or management tags are accepted. Omitted fields are preserved;
/// empty strings explicitly clear a field.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebProfileUpdateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,

    /// Read snapshot guard only. Core derives the signer from the active identity; a mismatch
    /// rejects without publication.
    pub expected_pubkey: String,

    pub idempotency_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub nip05_handle: Option<String>,
}

/// Profile read from Buzz for the current identity or an author proven by a currently
/// admitted channel/private-conversation message, never a Core profile copy. An absent
/// kind:0 is an empty profile, not a fabricated event.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebProfileView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub about: Option<String>,

    /// Same-origin BFF paths for exact media URLs on the current community. A read projection,
    /// never an upload or remote proxy authority.
    pub avatar_media_paths: HashMap<String, String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub nip05_handle: Option<String>,

    pub pubkey: String,
}

/// Web HUMAN 的原 Buzz 消息语义输入；身份、Channel、回复祖先与 mention 公钥均由 BFF 在原 scope 中解析，不接受 raw tags 或
/// signed event。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPublishMessageRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<AttachmentElement>>,

    pub content: String,

    /// 删除本人原 Buzz 消息；BFF 回读当前 Channel 原事件核对本人签名身份，发原 kind 5。与
    /// editEventId、parentEventId、非空正文、附件及提及互斥；不授予 kind 9005 管理员删除权限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_event_id: Option<String>,

    /// 编辑原 Buzz 消息；BFF 回读同 Channel 原事件并核对本人签名身份，发原 kind 40003。与 parentEventId 互斥，缺省保持原新消息语义。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_event_id: Option<String>,

    /// 用户明确选中的本 Workspace Installation；缺省为空，BFF 排序去重并冻结于原发布幂等记录。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mention_installation_ids: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_type: Option<WebMessageType>,

    /// 原 Relay 消息引用；BFF 在当前 Channel 回读验签并解析 NIP-10 祖先。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_event_id: Option<String>,
}

/// GET /api/v1/workspaces 回应数组的元素：调用方有 ACTIVE WorkspaceMembership 或 fresh manage 管理资格，且两侧
/// binding 都 ACTIVE 的 Workspace。管理可见不代表可读取协作消息；isMember 投影真实成员事实。Workspace id 同时是其 Channel
/// id（DD-80）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    pub id: String,

    /// 调用方是否有 ACTIVE WorkspaceMembership；管理资格不使该值为真。旧回应缺省表示未知，不得当作已加入频道。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_member: Option<bool>,

    pub name: String,

    pub slug: String,

    /// Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<WorkspaceVisibility>,
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

/// PUT /api/v1/user-state/workspaces/{workspaceId} 的请求体（DD-40）：该 Workspace 的收藏与静音。version
/// 是读到的 CollaborationUserState 版本，不符即 409；updatedAt 由 Core 用库时钟补写，不取调用方的值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspacePreferenceRequest {
    pub muted: bool,

    pub starred: bool,

    pub version: i64,
}

/// DD-49/70/71/94：Core-only签发投递。只有版本化OpenBao引用及Agent已发布JWKS文件引用，不含私钥正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionTokenSigningDelivery {
    pub issuer: String,

    pub jwks_file: String,

    pub private_key_field: String,

    pub secret_audience: String,

    pub secret_locator: String,

    pub secret_version: i64,

    pub token_seconds: i64,
}

/// Installation 只取自受验签的 Invocation Session，不接受调用方目标覆盖。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentMemoryEntryListInput {}

/// 只读当前 Invocation Installation 的 cold mem entry，不接受 core 或其他 Installation。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentMemoryEntryReadInput {
    pub slug: String,
}

/// HUMAN Memory Action 本次瞬态输入；正文仅用于原生 NIP-AE 构造，不进入 ActionExecution、审计、outbox 或 history。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryWriteInput {
    /// entry.patch 当前原生 value 的 SHA-256。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_hash: Option<String>,

    /// 调用方实际读取的 head；null 只表示原生确认不存在。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_head_event_id: Option<String>,

    /// 原生读取的确定状态；UNKNOWN/UNREADABLE 不构成覆盖写许可。
    pub expected_head_state: ExpectedHeadState,

    /// entry.patch 的原生严格 unified diff，不支持 fuzz、offset 或多文件。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,

    pub slug: String,

    /// core.replace 的 profile 或 entry.set 的 value；完整序列化 JSON body 必须满足原生 NIP-44 上界。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
}

/// 03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
/// environment。发布不等于安装或运行授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionContent {
    /// 精确 contract_key@version，不引用业务能力实现名。
    pub capability_requirements: Vec<String>,

    pub declared_tool_resource_ids: Vec<String>,

    pub instructions: String,

    pub memory_policy: AgentVersionContentMemoryPolicy,

    pub model_route_resource_id: String,

    pub parallelism: i64,

    pub persona_identity: AgentVersionContentPersonaIdentity,

    /// RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。
    pub reply_policy: String,

    pub runtime_profile_key: String,

    pub skill_version_asset_ids: Vec<String>,

    pub trigger_defaults: Vec<AgentTrigger>,

    pub turn_limits: AgentVersionContentTurnLimits,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionContentMemoryPolicy {
    pub cold_write: AgentMemoryColdWrite,

    pub core_write: AgentMemoryCoreWrite,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionContentPersonaIdentity {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub display_name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionContentTurnLimits {
    pub idle_timeout_seconds: i64,

    pub max_turn_duration_seconds: i64,
}

/// DD-94部署投递面：adapter服务引用解析到固定部署产物/原生实例与受限传输。不是Catalog或业务授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationAdapterDirectory {
    pub adapters: Vec<ApplicationAdapterDelivery>,

    /// 受控部署事实，不是 Tool 注册表或业务授权；原生 MCP peer 不接收 ActionToken。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_peers: Option<Vec<ApplicationProtocolPeerDelivery>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationAdapterDelivery {
    pub action_token_audience: String,

    pub adapter_service_ref: String,

    pub artifact_digest: String,

    pub base_url: String,

    pub max_response_bytes: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_credential_deliveries: Option<Vec<ApplicationModelCredentialDelivery>>,

    pub native_instance_ref: String,

    pub secret_readers: Vec<AdapterSecretReader>,

    pub timeout_seconds: i64,
}

/// 受控原生模型凭据交接回执；无密钥值，不创建模型，不替代OpenBao审计或binding准入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationModelCredentialDelivery {
    pub binding_id: String,

    pub config_digest: String,

    pub generation: i64,

    pub native_model_ref: String,

    pub native_proof: String,

    pub native_scope_ref: String,

    pub request_id: String,

    pub route_resource_id: String,

    pub secret_ref: ApplicationModelServiceSecretRef,

    pub service_principal_id: String,

    pub verification_nonce: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApplicationModelServiceSecretRef {
    pub audience: String,

    pub locator: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterSecretReader {
    pub audience: String,

    pub role_name: String,

    pub service_principal_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationProtocolPeerDelivery {
    pub adapter_service_ref: String,

    pub artifact_digest: String,

    pub bindings: Vec<ApplicationProtocolPeerBindingDelivery>,

    pub max_response_bytes: i64,

    pub mcp_url: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_credential_deliveries: Option<Vec<ApplicationModelCredentialDelivery>>,

    pub native_instance_ref: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret_readers: Option<Vec<ProtocolPeerSecretReader>>,

    pub timeout_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationProtocolPeerBindingDelivery {
    pub binding_id: String,

    pub config_digest: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_generation: Option<i64>,

    pub isolation_mode: String,

    /// 原受控投递映射：无secret值；精确版本由Core以原audience读取并向Gateway独占文件投递。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_credentials: Option<Vec<BindingNativeCredential>>,

    /// 绑定已有原生对象的受控投递事实，不创建对象或授予权限；父项唯一固定实例与作用域。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_resources: Option<Vec<ApplicationNativeResourceDelivery>>,

    pub native_scope_ref: String,

    pub service_principal_id: String,

    pub tenant_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BindingNativeCredential {
    pub audience: String,

    pub header: String,

    pub locator: String,

    pub prefix: String,

    pub secret_key: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationNativeResourceDelivery {
    pub evidence_digest: String,

    pub evidence_ref: String,

    pub native_ref: String,

    pub native_type: String,

    pub type_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolPeerSecretReader {
    pub audience: String,

    pub role_name: String,

    pub service_principal_id: String,
}

/// DD-88/94：pin 已批准 release 的业务绑定选择。只携带 SecretRef，不接受密钥正文或运行端点 URL。Workspace 取原
/// ActionCommand。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingCreate {
    pub adapter_service_ref: String,

    pub binding_id: String,

    pub call_identity_mode: ApplicationCallIdentityMode,

    pub capability_categories: Vec<ApplicationBindingCreateCapabilityCategoryClass>,

    pub component_release_id: String,

    pub isolation_mode: ApplicationIsolationMode,

    pub model_call_mode: ApplicationModelCallMode,

    pub native_instance_ref: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_scope_ref: Option<String>,

    pub normalized_config_json: String,

    pub retain_on_tenant_delete: bool,

    pub secret_refs: Vec<ApplicationBindingCreateSecretRefClass>,

    pub service_principal_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApplicationBindingCreateCapabilityCategoryClass {
    pub category: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingCreateSecretRefClass {
    pub audience: String,

    pub locator: String,

    pub secret_key: String,

    pub version: i64,
}

/// DD-92: modelGateway within the approved binding config. Only existing route and meter
/// references; no provider configuration, credential value or native model row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationModelGatewayConfig {
    pub meter_keys: Vec<String>,

    pub route_resource_ids: Vec<String>,
}

/// DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationApprovalPolicyRef {
    pub id: String,

    pub version: i64,
}

/// Temporal 原生 Schedule：显式 interval 或 Buzz UTC cron，二者互斥。catchupWindow 不小于原生的 10 秒，Overlap
/// 固定 SKIP。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationScheduleSpec {
    pub catchup_window_seconds: i64,

    /// 原 Buzz UTC cron：表单五字段，YAML 六字段包含秒、七字段增加年份；匹配由 Temporal 原生日历执行，不建立本地定时器。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub every_seconds: Option<i64>,

    /// 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<ScheduleSpecKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_seconds: Option<i64>,
}

/// 原 Buzz 有序步骤的已接通动作；步骤执行和延时仍归 Temporal。其它原动作不由此宣称已实现。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStep {
    pub action: ActionEnum,

    /// request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<ApprovalPolicyElement>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<String>,

    pub id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
}

/// REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval/calendar，不含触发消息正文、provider
/// 配置或凭据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationVersionContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<AutomationVersionContentAction>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<ApprovalPolicyElement>,

    /// 有序 steps 形态为 2，旧单 action 格式缺省保持原摘要。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_version: Option<i64>,

    /// 原工作流名称；随不可变版本冻结。旧版本缺省不补写、不重算历史摘要。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    pub result_target: AutomationResultTarget,

    /// 不可与旧 action 混用；支持有序 Delay、一个引用既有策略的 request_approval，最后发送一条消息。步骤审批不可同时声明版本级
    /// approvalPolicy；此切片不是原多副作用的产品上限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<StepElement>>,

    pub trigger: AutomationVersionContentTrigger,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationVersionContentAction {
    pub kind: ActionKind,

    pub template: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationVersionContentTrigger {
    pub kind: AutomationTriggerKind,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mention_principal_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_spec: Option<ScheduleSpecClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_prefix: Option<String>,
}

/// DD-102 / ADR-12：能力契约固定的机器向量。每个 case 按 steps 顺序执行契约操作，参数与预期结果是实际
/// JSON，不执行文本代码。格式有效不表示组件套件通过；线协议性质、真实执行与 release 证据关联另行核验。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityConformanceVectors {
    pub cases: Vec<Case>,

    pub format_version: CapabilityVectorFormat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Case {
    pub case_key: String,

    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub contract_key: String,

    pub expected_output_json: String,

    pub input_json: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_asset_id: Option<String>,

    /// 只引用同 case 已成功的更早 stepKey 的唯一 typed ContentReference；不得指定 JSON 路径或表达式。与固定 Resource/Asset
    /// 目标一起进入规范化参数 hash。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_from_step_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_resource_id: Option<String>,

    pub step_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CapabilityVectorFormat {
    V1,
}

/// 固定 Catalog 自然键，不授予业务能力 consume 权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRef {
    pub category_key: String,

    pub contract_version: i64,
}

/// DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistration {
    pub category_key: String,

    pub content_reference_semantics: CapabilityContractRegistrationContentReferenceSemanticsClass,

    pub contract_version: i64,

    pub operation_contracts: Vec<CapabilityContractRegistrationOperationContractClass>,

    pub protocol_session_kinds: Vec<String>,

    pub required_declarations: Vec<CapabilityRequiredDeclaration>,

    pub resource_type_family: Vec<CapabilityContractRegistrationResourceTypeFamilyClass>,

    pub schema_documents: Vec<String>,

    /// CapabilityConformanceVectors 的 JSON 编码，formatVersion 固定格式；任意自然语言对象数组不构成可执行向量。Core
    /// 校验所有步骤参数/结果符合契约 schema，覆盖所有 operationContracts，然后固定 canonical digest。
    pub test_vectors_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistrationContentReferenceSemanticsClass {
    pub authorization_target_rule: String,

    pub native_object_ref_rule: String,

    pub native_revision_rule: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistrationOperationContractClass {
    pub contract_key: String,

    pub input_schema_digest: String,

    pub output_schema_digest: String,

    pub permission: CapabilityPermission,

    pub surface: CapabilitySurface,

    pub target_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistrationResourceTypeFamilyClass {
    pub kind: String,

    pub type_key: String,
}

/// Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。参数是组件原生持久内容引用，不把 SQL、提示或结果正文写入
/// Core/Temporal。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentActionInput {
    pub action_version: i64,

    pub input_reference: ReferenceClass,

    pub result_exposure_policy_id: String,

    pub result_exposure_policy_version: i64,
}

/// 07§8A 的隔离环境投递配置，不是 Catalog/binding 权威。由运维配置精确绑定已装载候选 artifact；逐次短期模拟 token 仅由 Core
/// 对实际请求签发，不接受静态凭据文件或用户 action 自报地址。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceEnvironment {
    pub adapter_base_url: String,

    pub artifact_digest: String,

    pub max_response_bytes: i64,

    pub max_steps: i64,
}

/// 隔离开发环境受控投递的协议夹具数据，不来自登记请求。Core 只采用固定协议用例并核对全部必需覆盖；没有脚本、条件、路径表达式或通过声明。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceFixture {
    pub artifact_digest: String,

    pub steps: Vec<PlanStep>,
}

/// 仅用于07§8A隔离套件的模拟上下文投递。不是生产 Catalog、Delegation 或
/// ResultExposurePolicy。独立密钥/issuer/audience；其完整摘要固定在原登记计划。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceIdentity {
    pub artifact_digest: String,

    pub audience: String,

    pub contexts: Vec<ComponentConformanceIdentityContext>,

    pub issuer: String,

    pub jwks_file: String,

    pub private_key_field: String,

    pub secret_audience: String,

    pub secret_locator: String,

    pub secret_version: i64,

    pub token_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceIdentityContext {
    pub action_definition_version: i64,

    pub action_key: String,

    pub actor_principal_id: String,

    /// 隔离环境PEP的实际模拟授权revision，不得指向生产SpiceDB事实。
    pub authorization_min_zed_token: String,

    pub case_key: String,

    /// execute场景必填的隔离native执行引用；不在生产库创建ExternalExecution。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_execution_id: Option<String>,

    pub operation: AdapterProtocolOperation,

    pub result_exposure_policy_id: String,

    pub result_exposure_policy_version: i64,

    pub step_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,

    pub target_type: String,

    pub tenant_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// ADR-12 / design07§5.2 固定的出站逻辑操作。服务入站操作不通过此面调用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdapterProtocolOperation {
    Cancel,

    Execute,

    #[serde(rename = "extract_usage")]
    ExtractUsage,

    Handshake,

    #[serde(rename = "map_native_status_error")]
    MapNativeStatusError,

    Observe,

    #[serde(rename = "query_revision")]
    QueryRevision,

    Reconcile,

    #[serde(rename = "resolve_native_scope")]
    ResolveNativeScope,

    #[serde(rename = "validate_binding")]
    ValidateBinding,
}

/// 原 COMPONENT_CONFORMANCE_ENVIRONMENT_FILE 的 PROTOCOL_PEER 分支，仅隔离套件运行事实；readOnlyTools
/// 固定隔离实例实际上可安全执行的只读探针，不授予生产业务权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentProtocolPeerEnvironment {
    pub artifact_digest: String,

    pub initialize_result_json: String,

    pub list_result_json: String,

    pub max_response_bytes: i64,

    pub max_steps: i64,

    pub mcp_url: String,

    /// 隔离原生MCP的既有版本化SecretRef与header映射；经原Core/OpenBao审计和Gateway文件投递，不含凭据值，不借用生产binding身份。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_credentials: Option<Vec<ComponentProtocolPeerEnvironmentNativeCredential>>,

    pub read_only_tools: Vec<String>,

    pub timeout_seconds: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentProtocolPeerEnvironmentNativeCredential {
    pub audience: String,

    pub header: String,

    pub locator: String,

    pub prefix: String,

    pub secret_key: String,

    pub version: i64,
}

/// 原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleaseApprovalTarget {
    pub action_execution_id: String,

    pub component_release_id: String,

    pub workflow_id: String,
}

/// 组件登记只提交实际 manifest、包清单与 binding config schema；不接收 suite 通过声明、报告或候选执行地址。Core 解析并冻结内容，原
/// Worker 独立执行隔离套件。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleaseRegistration {
    pub binding_config_schema_json: String,

    pub manifest_json: String,

    pub package_json: String,
}

/// design03 的唯一内容引用线格式；不是业务正文。Adapter typed 槽是传递引用的唯一来源，resultJson 不用于识别或重建引用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentReference {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,

    pub display_name: String,

    pub media_type: String,

    pub native_object_ref: String,

    pub native_revision: String,

    pub resource_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationGrantParameters {
    pub expires_at: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<i64>,

    pub scopes: Vec<ScopeElement>,

    pub valid_from: String,
}

/// 03 §6 的确切 Action/target/exposure 限制；管理发现与原 Grant 写入共用，发现不授予 permission。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationScopeParameters {
    pub action_key: String,

    pub action_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub create_workspace_id: Option<String>,

    pub output_schema_hash: String,

    pub redaction_policy: String,

    pub result_exposure_mode: ResultExposureMode,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,

    pub target_type: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_resource_id: Option<String>,
}

/// DD-95/103: transient, fixed-origin launch returned by the admitted binding adapter;
/// credentials are only string form fields, never a persisted Task, chat or ContentReference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentLaunchDescriptor {
    pub action_url: String,

    pub editor_origin: String,

    pub expires_at: String,

    pub form_fields: HashMap<String, String>,

    pub method: Method,
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

/// 受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
/// 仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRouteCreateInput {
    pub model: Model,

    pub provider: Model,

    pub provider_credential_mode: LlmProviderCredentialMode,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_secret_ref: Option<LlmRouteCreateInputProviderSecretRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlmRouteCreateInputProviderSecretRef {
    pub audience: String,

    pub locator: String,

    pub version: i64,
}

/// 18: native authenticated file-menu metadata from the Adapter typed reference producer.
/// This is NOT Action admission; the normal Kailo HUMAN session must independently
/// fresh-admit the frozen target and version. No ticket or content bytes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDocumentSelection {
    pub action_key: NativeDocumentSelectionActionKey,

    pub action_version: i64,

    pub binding_id: String,

    pub generation: i64,

    pub reference: ReferenceClass,

    pub resource_version: i64,

    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum NativeDocumentSelectionActionKey {
    #[serde(rename = "file_storage.open_edit@v1")]
    FileStorageOpenEditV1,

    #[serde(rename = "file_storage.open_view@v1")]
    FileStorageOpenViewV1,
}

/// 设计03的当前已部署主体能力事实，由原受信服务/当前Web产物观察产生，不接受管理表单声明。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformBuildInfo {
    pub adapter_protocol_versions: Vec<String>,

    pub build_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector_kinds: Option<Vec<String>>,

    pub driver_registry_keys: Vec<String>,

    pub host_api_version: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_protocol_versions: Option<Vec<String>>,

    pub platform_port_keys: Vec<PlatformPortKey>,

    pub reported_at: String,

    pub subject: Subject,
}

/// 03/07/18: the original HUMAN file protocol action, not an arbitrary editor or native URL.
/// Revision and presentation are frozen once; session expiry comes from controlled Core
/// delivery.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionOpenInput {
    pub action_version: i64,

    /// The selected native source binding; must equal the target's real binding, not an
    /// authorization claim.
    pub application_binding_id: String,

    pub locale: Locale,

    /// Exact approved projection selected by the native menu; never latest.
    pub projection_generation: i64,

    pub reference: ReferenceClass,

    pub theme: Theme,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceCreate {
    pub evidence_digest: String,

    pub evidence_ref: String,

    pub native_ref: String,

    pub native_type: String,

    pub type_key: String,
}

/// 03 §7 的平台发布 Catalog 投递，不是用户 Resource 或 Agent 注册表。部署没有提供实际合同、凭据链与 runtime 对账证据时不得填 ACTIVE。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuntimeProfileDirectory {
    pub profiles: Vec<Profile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub capability_contract: FluffyCapabilityContract,

    pub key: String,

    pub kind: RuntimeProfileKind,

    pub status: String,

    pub web_availability: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FluffyCapabilityContract {
    pub capability_requirements: Vec<String>,

    pub max_idle_timeout_seconds: i64,

    pub max_parallelism: i64,

    pub max_turn_duration_seconds: i64,

    pub reply_policies: Vec<String>,

    /// 同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_policy_mappings: Option<Vec<FluffyRuntimeReplyPolicyMapping>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FluffyRuntimeReplyPolicyMapping {
    pub broadcast_replies: bool,

    pub key: String,

    pub thread_replies: bool,
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
/// platform:<kind>:<tenantId>:<primaryEntityId>:<entityVersion>（前缀是协议常量，不随部署显示名变化；ADR-17
/// 迁移窗口内的存量引用仍为旧前缀），使「不分配第二个业务 workflow ID」可被机械校验。
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

/// workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChannelCreate {
    pub channel_type: ChannelType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<i64>,
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

/// 唯一安装 Workflow 推进同一 ActionExecution/version/generation；取消接收不是原生清理终态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationAdvanceRequest {
    pub action_execution_id: String,

    pub agent_version_asset_id: String,

    pub cancel_requested: bool,

    pub installation_id: String,

    pub projection_generation: i64,

    pub run_id: String,

    pub workflow_id: String,
}

/// Core 查证后的安装生命周期状态；身份/模型/记忆/runtime 未闭合只返回 RUNNING/UNKNOWN，不把 spawn 当 ACTIVE。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationAdvanceResult {
    pub installation_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

/// DD-25/48：既有 ComponentTaskWorkflow 的 AGENT_INSTALLATION 冻结目标；不含凭据或 Version 正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationWorkflowTarget {
    pub action_execution_id: String,

    pub agent_version_asset_id: String,

    pub installation_id: String,

    pub projection_generation: i64,
}

/// Worker 推进已冻结 Invocation；未知原生结果只观察，不再次 turn/start。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskAdvanceRequest {
    pub activity_id: String,

    pub agent_version_asset_id: String,

    pub attempt: i64,

    pub cancel_requested: bool,

    pub heartbeat_interval_seconds: i64,

    pub installation_id: String,

    pub invocation_id: String,

    pub observation_interval_seconds: i64,

    pub projection_generation: i64,

    pub run_id: String,

    pub workflow_id: String,
}

/// Core 查证的引用与状态；native completed 缺 reply/usage 证据仍 RUNNING。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskAdvanceResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_input: Option<ApprovalInputClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    /// 同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_step: Option<DelayStep>,

    /// 已查证安全停止此 Activity；不等于 Invocation 成功或 Capacity 已释放。
    pub finish_activity: bool,

    pub invocation_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

/// ApprovalWorkflow 的冻结输入（.design/06 §4）。运行中不得更换 Tenant、Workspace、target、参数摘要或策略版本；意图改变时建立新
/// ActionExecution。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalInputClass {
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

/// 同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DelayStep {
    pub id: String,

    pub seconds: i64,
}

/// DD-47/48：固定 AgentInvocation 与版本/投影引用；不携带 prompt、token 或原生正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTaskWorkflowInput {
    pub agent_version_asset_id: String,

    pub cancel_pending: bool,

    pub event_base: i64,

    pub heartbeat_interval_seconds: i64,

    pub heartbeat_timeout_seconds: i64,

    pub installation_id: String,

    pub invocation_id: String,

    pub observation_interval_seconds: i64,

    pub projection_generation: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingAdvanceRequest {
    pub cancel_requested: bool,

    pub run_id: String,

    pub target: ApplicationBindingAdvanceRequestTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingAdvanceRequestTarget {
    pub action_execution_id: String,

    pub binding_id: String,

    pub binding_version: i64,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingAdvanceResult {
    pub binding_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingTarget {
    pub action_execution_id: String,

    pub binding_id: String,

    pub binding_version: i64,

    pub workflow_id: String,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationScheduleAdmitRequest {
    pub input: InputClass,

    pub run_id: String,

    pub workflow_id: String,
}

/// DD-107 Schedule 原生启动 AgentTaskWorkflow 的输入。计划时间仅取 native history，不由调用方提供。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputClass {
    pub automation_resource_id: String,

    pub automation_version_asset_id: String,

    /// 原 Workflow continue-as-new 仅携 true 保留已观察取消；首 native Schedule input 缺省。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel_pending: Option<bool>,

    pub schedule_id: String,

    pub source_kind: AutomationScheduleSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AutomationScheduleSource {
    #[serde(rename = "SCHEDULE")]
    Schedule,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationScheduleAdmitResult {
    pub admitted: bool,

    pub reason_code: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_input: Option<TaskInputClass>,
}

/// DD-47/48：固定 AgentInvocation 与版本/投影引用；不携带 prompt、token 或原生正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInputClass {
    pub agent_version_asset_id: String,

    pub cancel_pending: bool,

    pub event_base: i64,

    pub heartbeat_interval_seconds: i64,

    pub heartbeat_timeout_seconds: i64,

    pub installation_id: String,

    pub invocation_id: String,

    pub observation_interval_seconds: i64,

    pub projection_generation: i64,
}

/// DD-107 Schedule 原生启动 AgentTaskWorkflow 的输入。计划时间仅取 native history，不由调用方提供。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationScheduleTaskInput {
    pub automation_resource_id: String,

    pub automation_version_asset_id: String,

    /// 原 Workflow continue-as-new 仅携 true 保留已观察取消；首 native Schedule input 缺省。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel_pending: Option<bool>,

    pub schedule_id: String,

    pub source_kind: AutomationScheduleSource,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentActionAdvanceRequest {
    pub cancel_requested: bool,

    pub run_id: String,

    pub target: ComponentActionAdvanceRequestTarget,
}

/// 原 ComponentTaskWorkflow(kind=COMPONENT_ACTION) 的冻结引用；全部业务参数仍从原 AE 的引用/hash读取。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentActionAdvanceRequestTarget {
    pub action_execution_id: String,

    pub binding_id: String,

    pub binding_version: i64,

    pub component_release_id: String,

    pub projection_generation: i64,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentActionAdvanceResult {
    pub action_execution_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

/// 原 ComponentTaskWorkflow(kind=COMPONENT_ACTION) 的冻结引用；全部业务参数仍从原 AE 的引用/hash读取。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentActionTarget {
    pub action_execution_id: String,

    pub binding_id: String,

    pub binding_version: i64,

    pub component_release_id: String,

    pub projection_generation: i64,

    pub workflow_id: String,
}

/// 受信 Worker 的一次实际线协议观察，附着冻结 ActionExecution。Core 以自身 plan 逐项匹配，不接收 pass 布尔值；UNKNOWN
/// 不表示套件失败或成功。响应正文与测试凭据不进入报告。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceObservation {
    pub action_execution_id: String,

    pub artifact_digest: String,

    pub component_release_id: String,

    pub contract_digests: Vec<String>,

    pub observations: Vec<ObservationElement>,

    pub operation_id: String,

    pub plan_digest: String,

    pub run_id: String,

    pub suite_digest: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObservationElement {
    pub case_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ReferenceClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_class: Option<ErrorClass>,

    pub http_status: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_result_kind: Option<McpResultKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_observation: Option<ExecutionClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_scope_observation: Option<NativeScopeObservationClass>,

    pub operation: ComponentConformanceOperation,

    pub request_digest: String,

    pub response_digest: String,

    /// 实际返回的能力结果摘要；原结果正文不进入报告或 Core。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_digest: Option<String>,

    pub step_key: String,
}

/// DD-98：按同一 platform Resource ref CREATE/LOOKUP；FOUND 保留上游实际引用，不由套件预测或生成 native ID。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeScopeObservationClass {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_ref: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_type: Option<String>,

    pub platform_resource_ref: String,

    pub result: NativeScopeResult,
}

/// 受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformancePlan {
    pub action_execution_id: String,

    pub artifact_digest: String,

    pub component_release_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector_kind: Option<ConnectorKind>,

    pub contract_digests: Vec<String>,

    /// 独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
    pub identity_digest: String,

    pub operation_id: String,

    pub plan_digest: String,

    /// Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
    /// Describe 与同 workflow 的当前 TaskProjection 核对。
    pub run_id: String,

    pub steps: Vec<ComponentConformancePlanStep>,

    pub suite_digest: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformancePlanStep {
    pub case_key: String,

    /// 只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
    /// native 任务元数据。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_key: Option<String>,

    /// Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
    pub expected_http_status: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_mcp_result_kind: Option<McpResultKind>,

    pub expected_response_json: String,

    pub idempotency_key: String,

    pub operation: ComponentConformanceOperation,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_asset_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_from_step_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_resource_id: Option<String>,

    pub request_json: String,

    pub step_key: String,
}

/// 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
/// history 承接，不建立另一执行账本。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceProbe {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ReferenceClass>,

    pub plan: PlanClass,

    /// 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconcile: Option<bool>,

    pub step_index: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceStepObservation {
    pub case_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ReferenceClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_class: Option<ErrorClass>,

    pub http_status: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_result_kind: Option<McpResultKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_observation: Option<ExecutionClass>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_scope_observation: Option<NativeScopeObservationClass>,

    pub operation: ComponentConformanceOperation,

    pub request_digest: String,

    pub response_digest: String,

    /// 实际返回的能力结果摘要；原结果正文不进入报告或 Core。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_digest: Option<String>,

    pub step_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationProjectionRequest {
    pub run_id: String,

    pub target: ConversationProjectionRequestTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationProjectionRequestTarget {
    pub action_execution_id: String,

    pub conversation_id: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationProjectionResult {
    pub conversation_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationProjectionTarget {
    pub action_execution_id: String,

    pub conversation_id: String,

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionReconcileRequest {
    pub cancel_requested: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub round: Option<RoundClass>,

    pub run_id: String,

    pub target: ProtocolSessionReconcileRequestTarget,
}

/// Actual original Session snapshot. The Activity result freezes this query round into
/// history, not into a new authority.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoundClass {
    pub session_version: i64,

    pub state: ProtocolSessionViewState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_observation: Option<WriteObservationClass>,
}

/// DD-90: immutable first UNKNOWN input for the original Session's one Workflow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionReconcileRequestTarget {
    pub action_definition_id: String,

    pub action_execution_id: String,

    pub base_revision: String,

    pub binding_id: String,

    pub correlation_ref: String,

    pub native_object_ref: String,

    pub projection_generation: i64,

    pub protocol_session_id: String,

    pub release_id: String,

    pub session_version: i64,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionReconcileResult {
    pub protocol_session_id: String,

    pub round: RoundClass,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

/// Actual original Session snapshot. The Activity result freezes this query round into
/// history, not into a new authority.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionReconcileRound {
    pub session_version: i64,

    pub state: ProtocolSessionViewState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_observation: Option<WriteObservationClass>,
}

/// DD-90: immutable first UNKNOWN input for the original Session's one Workflow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionReconcileTarget {
    pub action_definition_id: String,

    pub action_execution_id: String,

    pub base_revision: String,

    pub binding_id: String,

    pub correlation_ref: String,

    pub native_object_ref: String,

    pub projection_generation: i64,

    pub protocol_session_id: String,

    pub release_id: String,

    pub session_version: i64,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProvisionAdvanceRequest {
    pub cancel_requested: bool,

    pub run_id: String,

    pub target: ResourceProvisionAdvanceRequestTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProvisionAdvanceRequestTarget {
    pub action_execution_id: String,

    pub binding_id: String,

    pub binding_version: i64,

    pub component_release_id: String,

    pub native_instance_ref: String,

    pub native_scope_ref: String,

    pub projection_generation: i64,

    pub reference: ResourceCreateClass,

    pub resource_id: String,

    pub resource_version: i64,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProvisionAdvanceResult {
    pub resource_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProvisionTarget {
    pub action_execution_id: String,

    pub binding_id: String,

    pub binding_version: i64,

    pub component_release_id: String,

    pub native_instance_ref: String,

    pub native_scope_ref: String,

    pub projection_generation: i64,

    pub reference: ResourceCreateClass,

    pub resource_id: String,

    pub resource_version: i64,

    pub workflow_id: String,
}

/// TENANT_LIFECYCLE DELETE Activity 只推进已准入且已冻结的 Tenant 删除，不重新解析绑定或建立新快照。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantDeleteAdvanceRequest {
    pub cancel_requested: bool,

    pub snapshot_id: String,

    pub tenant_id: String,

    pub tenant_version: i64,
}

/// Core 返回已经持久化的删除推进事实；UNKNOWN 由错误分类表达，不伪装为 completed 或 canceled。原生证据只保留引用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantDeleteAdvanceResult {
    pub canceled: bool,

    pub completed: bool,

    pub irreversible_dispatch_started: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_inventory_digest: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_request_id: Option<String>,

    pub snapshot_id: String,

    pub subprocess_id: String,
}
