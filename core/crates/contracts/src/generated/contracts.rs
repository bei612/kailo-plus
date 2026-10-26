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
    pub nested: CanaryNested,

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
    pub variants: Option<Vec<CanaryVariantsItem>>,
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
pub struct CanaryNested {
    pub label: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub weights: Option<Vec<f64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanaryVariantsItem {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_digest: Option<String>,

    pub kind: CanaryVariantsItemKind,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_body: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_attempt: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CanaryVariantsItemKind {
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

/// Delete selected native objects in the admitted Resource using the original
/// recycle/permanent-delete choice. Each native object identity must be independently
/// authorized and retained in the native first-dispatch claim.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageDeleteInput {
    pub native_object_refs: Vec<String>,

    pub remove_permanently: bool,

    pub resource_id: String,
}

/// Metadata-only result. Success requires all selected native identities to have linked
/// durable deletion or recycle acknowledgements; an accepted job, Finished status or absent
/// current object is not terminal evidence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileStorageDeleteOutput {}

/// Export exactly the authorized typed native file revision, including empty or non-UTF-8
/// files.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageExportInput {
    pub display_name: String,

    pub media_type: String,

    pub native_object_ref: String,

    pub native_revision: String,

    pub resource_id: String,
}

/// Immediate authorized binary result using the existing export encoding; not a persisted
/// Core blob, URL, or native credential.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageExportOutput {
    pub content_base64: String,

    pub filename: String,

    pub media_type: String,
}

/// DD-89: list the source Resource through its bound native root; the client cannot supply
/// another root or native credential.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageListInput {
    pub resource_id: String,
}

/// DD-89: complete native listing is transported only between components, not persisted by
/// Core. Its canonical item digest is the native listing revision, never a fabricated file
/// VersionId.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageListOutput {
    pub items: Vec<ContentReference>,

    pub listing_digest: String,

    pub native_object_ref: String,

    pub native_revision: String,

    pub operation_id: String,

    pub resource_id: String,
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

/// List published native revisions of one UUID inside the admitted Resource's bound root; no
/// caller-supplied path or credential.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageListRevisionsInput {
    pub native_object_ref: String,

    pub resource_id: String,
}

/// Published version references from the original native version collection; also supplied
/// in the adapter's typed ContentReference slot. Not SERVICE list_output or a completion
/// receipt.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileStorageListRevisionsOutput {
    pub citations: Vec<ContentReference>,
}

/// Read the exact typed native file revision in the admitted Resource; never substitute the
/// current head.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageReadInput {
    pub display_name: String,

    pub media_type: String,

    pub native_object_ref: String,

    pub native_revision: String,

    pub resource_id: String,
}

/// Exact valid UTF-8 native bytes, disclosed only through the original result policy. Binary
/// files use export.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileStorageReadOutput {
    pub text: String,
}

/// Manage an existing native share under the admitted Resource. Revocation removes access
/// through that exact share; it neither deletes file content nor grants platform resource
/// permission. Native share identity alone is not evidence of ownership or successful
/// revocation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageShareInput {
    pub native_share_ref: String,

    pub operation: FileStorageShareOperation,

    pub resource_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FileStorageShareOperation {
    #[serde(rename = "REVOKE")]
    Revoke,
}

/// Metadata-only share result. Revocation requires an authorized first-dispatch claim and
/// confirmed removal of the frozen native share access. An unowned missing identifier,
/// accepted request or partial native cleanup is not successful revocation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileStorageShareOutput {}

/// Apply an existing immutable native revision, or dispatch a native first-byte intent. An
/// intent is not a ContentReference: its node/revision identifiers name reserved native
/// locations only; bytes remain at the source and no result exists before the immutable
/// native ACK.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStorageWriteInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_length: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub multipart: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_deadline: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_intent_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_node_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_object_ref: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_revision: Option<String>,

    pub resource_id: String,
}

/// Metadata-only write result. The exact confirmed result revision belongs in the adapter's
/// typed ContentReference slot; an empty result, accepted write, or current head alone is
/// not terminal evidence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FileStorageWriteOutput {}

/// Metadata-only input of the receiver native synchronization admission. Core injects the
/// read execution reference and native receiver root.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSyncInput {
    pub batch_id: String,

    pub import_config_ref: String,

    pub source_read_action_execution_id: String,

    pub source_resource_id: String,
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

/// 完整原生枚举的同引用观察，非新的任务/结果权威。complete 只在全部原存储流正常结束后成立；部分枚举、超限或不可核验不得当空集合。observations
/// 保留所有代次的原始幂等引用，未知任务不得遗漏；Core 自行核验终态，不接收 drained 声明。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdapterBindingReconcileResponse {
    pub complete: bool,

    pub observations: Vec<AdapterExecutionObservation>,

    pub reference: AdapterBindingReconcileRequest,
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

/// 07§5.2/6.2 已停止新准入的 binding reconcile。引用原停用生命周期及冻结代次，只观察原生任务，不创建 ExternalExecution 或重放动作。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterBindingReconcileRequest {
    pub binding_id: String,

    pub config_digest: String,

    pub generation: i64,

    pub idempotency_key: String,

    pub native_instance_ref: String,

    pub native_scope_ref: String,
}

/// ADR-12 执行响应分离原生任务观察与能力结果。HTTP 接收不是终态；resultJson 只在原生 SUCCEEDED 且符合固定结果 schema 时消费。它不进入
/// Core 的套件报告。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterExecutionResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ContentReference>,

    /// 来源 citation 的 typed 槽；与固定结果 schema 中 citations 逐项一致。它不是源正文读取证明，打开来源时重新授权。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_references: Option<Vec<ContentReference>>,

    pub execution: AdapterExecutionObservation,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_json: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_resources: Option<Vec<AdapterSourceResource>>,
}

/// Actual native planner source within the existing execution binding. Metadata only:
/// neither SQL/content nor a grant. The original action and result-exposure authority must
/// authorize every resolved Resource.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterSourceResource {
    pub native_ref: String,

    pub native_type: String,
}

/// DD-48/51/94 extract_usage 的原生终态用量元数据；scope/customer/dimensions 只由 Core 原
/// ExternalExecution 决定。完整集合与冻结 action meters 精确相等，缺失不是零。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterExecutionUsage {
    pub external_execution_id: String,

    pub idempotency_key: String,

    pub measurements: Vec<AdapterExecutionUsageMeasurementsItem>,

    pub native_id: String,

    pub native_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterExecutionUsageMeasurementsItem {
    pub meter_key: String,

    pub occurred_at: String,

    pub quantity: i64,
}

/// 绑定 SERVICE 领取原已派发 HUMAN COMPONENT_ACTION 的既存 native task 未消费步骤；不创建执行或延长期限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTaskExecutionAdmissionRequest {
    pub action_execution_id: String,

    pub binding_id: String,

    pub execution: AdapterExecutionReference,

    /// 首次 dispatch 审计时间与冻结声明期限得出的原 RFC3339 截止时间，不接受续期。
    pub native_task_deadline: String,
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

/// 仅当次原任务执行上下文可用的票据；原生任务不得持久化票据或参数凭据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTaskExecutionAdmissionResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_token: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments_json: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,

    pub native_task_deadline: String,

    pub state: NativeTaskAdmissionState,
}

/// 单次原生任务准入查询结果，不是新的持久任务生命周期。PENDING_REFERENCE 无票据；ADMITTED 才允许消费原任务尚未领取步骤。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum NativeTaskAdmissionState {
    Admitted,

    #[serde(rename = "PENDING_REFERENCE")]
    PendingReference,
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
    pub content_reference: Option<ContentReference>,

    pub operation: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_resources: Option<Vec<AdapterSourceResource>>,
}

/// 只在原动作和精确binding仍被fresh授权时返回当前授权revision；不是可复用的新授权票据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterPepCheckResponse {
    pub action_execution_id: String,

    pub authorization_min_zed_token: String,

    /// 原业务 AE 冻结的 component_projection_generation；由 Core 核验同 binding 后返回，不从调用方 token
    /// 扩展或当前部署配置推断。缺省时原生任务不得新建代次归属。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding_generation: Option<i64>,

    /// 仅声明原生异步任务执行期限的 HUMAN COMPONENT_ACTION 返回；原首次 dispatch 时间加已批准声明的期限，RFC3339，不随本次 fresh
    /// Check 续期。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_task_deadline: Option<String>,

    pub operation_id: String,

    /// 本次已授权 execute 的 Resource 与其 binding 原生引用事实；不是新授权票据。缺省时消费者不得推断对象身份。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_resource: Option<AdapterAuthorizedResource>,
}

/// 本次已授权 execute 的 Resource 与其 binding 原生引用事实；不是新授权票据。缺省时消费者不得推断对象身份。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterAuthorizedResource {
    pub native_instance_ref: String,

    pub native_ref: String,

    pub native_scope_ref: String,

    pub native_type: String,

    pub resource_id: String,
}

/// 18: execute the original admitted file protocol Session, not an arbitrary editor URL or
/// native object create. All fields are frozen Core facts and the whole body is covered by
/// ActionToken.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterProtocolSessionLaunchRequest {
    pub admitted_mode: ProtocolSessionMode,

    pub authorization_target_native_ref: String,

    pub expires_at: String,

    pub idempotency_key: String,

    pub locale: ProtocolSessionLocale,

    pub protocol_session_id: String,

    pub reference: ContentReference,

    pub theme: ProtocolSessionTheme,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProtocolSessionMode {
    #[serde(rename = "EDIT")]
    Edit,

    #[serde(rename = "VIEW")]
    View,
}

/// 系统通知文案的语言；通知不含正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProtocolSessionLocale {
    En,

    #[serde(rename = "zh-CN")]
    ZhCn,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProtocolSessionTheme {
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
    pub launch_descriptor: DocumentLaunchDescriptor,

    pub native_session_ref: String,
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

    pub method: DocumentLaunchDescriptorMethod,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DocumentLaunchDescriptorMethod {
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
    pub decision: ProtocolSessionLifecyclePepResponseDecision,

    pub expires_at: String,

    pub native_object_ref: String,

    pub protocol_session_id: String,

    pub requested_mode: ProtocolSessionMode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProtocolSessionLifecyclePepResponseDecision {
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

    pub native_state: AdapterProtocolSessionLifecycleResponseNativeState,

    pub protocol_session_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AdapterProtocolSessionLifecycleResponseNativeState {
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

    pub native_operation: ProtocolSessionPepRequestNativeOperation,

    pub protocol_session_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_observation: Option<ProtocolWriteObservation>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtocolSessionPepRequestNativeOperation {
    Observe,

    Open,

    Read,

    #[serde(rename = "TOKEN_OBSERVE")]
    TokenObserve,

    #[serde(rename = "TOKEN_REVOKE")]
    TokenRevoke,

    Write,
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

    pub phase: ProtocolWriteObservationPhase,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_revision: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ProtocolWriteObservationPhase {
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

/// Original Session facts, not native revision existence or write success. Cells must still
/// query its exact VersionId and ACLs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionPepResponse {
    pub admitted_mode: ProtocolSessionMode,

    pub base_revision: String,

    pub decision: ProtocolSessionLifecyclePepResponseDecision,

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
    pub protocol_reconcile: Option<ProtocolRevisionQuery>,
}

/// DD-90/18§5.4：原保存结果不明会话的确切写入证据查证；只核已有 ACCEPTED writer observation 对应的原生
/// VersionId，不提供文件字节或当前权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolRevisionQuery {
    pub base_revision: String,

    pub protocol_session_id: String,

    pub write_observation: ProtocolWriteObservation,
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

/// DD-89: short-lived source Adapter authorization, not native credentials or proof that the
/// batch finished. The endpoint is resolved from the existing controlled adapter directory.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReadGrantResponse {
    pub action_execution_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_token: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments_json: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,

    pub operation_id: String,

    /// Native retry observation. COMPLETED requires both immutable receipts and committed usage;
    /// UNKNOWN/PENDING carry no renewed authorization.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<AdapterReadGrantResponseOutcome>,

    /// 仅 COMPLETED 观察返回同一 Operation 已核实的原接收方子执行引用。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_action_execution_id: Option<String>,

    /// 仅 COMPLETED 观察返回原子执行冻结的 receiver generation，不是当前绑定代次。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_generation: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_receipt: Option<AdapterReadReceipt>,

    /// Separate governed receiver action in the same read Operation. The native importer must
    /// perform the existing authenticated PEP check with this token immediately before its
    /// write; issuance is not completion.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_write: Option<AdapterReadGrantResponseReceiverWrite>,

    pub source_binding_id: String,

    /// 仅原生批次 COMPLETED 观察返回已保存的 SOURCE 回执；不是新的读取授权。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_receipt: Option<AdapterReadReceipt>,
}

/// Native retry observation. COMPLETED requires both immutable receipts and committed usage;
/// UNKNOWN/PENDING carry no renewed authorization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AdapterReadGrantResponseOutcome {
    #[serde(rename = "COMPLETED")]
    Completed,

    #[serde(rename = "PENDING")]
    Pending,

    #[serde(rename = "UNKNOWN")]
    Unknown,
}

/// DD-89: authenticated native source-read or completed receiver-import metadata for one
/// original SERVICE Operation; never file bodies or credentials.
///
/// 仅原生批次 COMPLETED 观察返回已保存的 SOURCE 回执；不是新的读取授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReadReceipt {
    pub binding_id: String,

    /// Original native RFC3339 timestamp; Core validates it without rewriting the native
    /// representation.
    pub completed_at: String,

    pub content_bytes: i64,

    pub content_sha256: String,

    pub idempotency_key: String,

    pub measurements: Vec<AdapterReadReceiptMeasurementsItem>,

    pub native_object_ref: String,

    pub native_revision: String,

    pub operation_id: String,

    pub role: ApplicationReadResourceDirection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReadReceiptMeasurementsItem {
    pub meter_key: String,

    pub quantity: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ApplicationReadResourceDirection {
    #[serde(rename = "RECEIVER")]
    Receiver,

    #[serde(rename = "SOURCE")]
    Source,
}

/// Separate governed receiver action in the same read Operation. The native importer must
/// perform the existing authenticated PEP check with this token immediately before its
/// write; issuance is not completion.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReadGrantResponseReceiverWrite {
    pub action_execution_id: String,

    pub action_token: String,

    pub arguments_json: String,

    pub expires_at: i64,
}

/// DD-138(5)、07 §4.8.4/§5.2：Core → adapter POST /platform-adapter/v1/search 的请求体（规范 JSON，其
/// SHA-256 即 Search Token 的 normalized_parameter_hash）。resources 只含当前 HUMAN 已 fresh read 的该
/// binding Resource，adapter 只在这些 native 对象内检索。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterSearchRequest {
    pub idempotency_key: String,

    /// 1–20。
    pub limit: i64,

    /// ZH_CN 或 EN。
    pub locale: String,

    /// 去首尾空白后 1–200 字符。
    pub query: String,

    /// 1–50 项。
    pub resources: Vec<AdapterSearchResource>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterSearchResource {
    pub native_id: String,

    pub native_type: String,

    pub resource_id: String,
}

/// DD-138(5)、07 §4.8.4：adapter search 回应。至多 limit 项；title 1–200 字符、summary 至多 400 字符、path
/// 为该组件原生页面 origin 内相对路径。任一项不合则 Core 丢弃该来源的全部结果。不含正文、ContentReference 或凭据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AdapterSearchResponse {
    pub results: Vec<AdapterSearchResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterSearchResult {
    pub kind: ComponentSearchResultKind,

    pub path: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,

    pub title: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// DD-138(5)、07 §4.8.4：组件搜索结果的类别（封闭枚举）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComponentSearchResultKind {
    Dashboard,

    Document,

    File,

    Folder,

    #[serde(rename = "KNOWLEDGE_BASE")]
    KnowledgeBase,

    Question,
}

/// GET /api/v1/workspaces/{workspaceId}/agent-turns（DD-125(6)）：已准入 Workspace 内本人持有
/// Installation audit 的运行中回合；没有 audit 的 Installation 不出现（成员只见 20002）。每次读取写 ACCESS 审计。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActiveTurnPage {
    pub turns: Vec<AgentActiveTurnView>,

    pub workspace_id: String,
}

/// DD-125(6)、17 §8：一个仍在运行的 Agent 回合（Invocation DISPATCHING/RUNNING）。只对该 Installation
/// Resource audit 持有人呈现（回合开始时刻、活动入口与中断）；其他成员只见 Agent 20002 的工作中信号。读取写 ACCESS 审计。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActiveTurnView {
    /// Installation 的 ACTIVE AGENT 公钥，供原工作中 Agent 行匹配资料与 20002。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_pubkey: Option<String>,

    /// DD-84 取消控制键（task.cancel.agent.invoke.v1）：本人是原发起人或持有该 Installation manage、控制定义 ACTIVE 且原
    /// Workflow 仍 OPEN 时给出。省略即不显示中断；提交仍完整重新准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cancel_action_key: Option<String>,

    pub installation_id: String,

    pub invocation_id: String,

    /// 该回合的 agent.invoke ActionExecution；中断时作为 DD-84 取消控制的 originalActionExecutionId。
    pub original_action_execution_id: String,

    pub projection_generation: i64,

    /// AgentSession 根引用。
    pub root_event_id: String,

    /// 原生 turn 开始时刻（RFC3339，取自 Codex turn startedAt）；不可查证时省略，不以本机时钟代替。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,

    /// AgentSession 的原生 thread ID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,

    /// 已记录的原生 turn ID；派发结果尚未记录时省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_id: Option<String>,
}

/// DD-147(1)：GET /api/v1/workspaces/{workspaceId}/agent-authors。Workspace 成员（与成员名单同一准入）可读的
/// Agent 作者目录：本 Workspace 中有 ACTIVE ChannelAgentBinding 的未删除 Installation（排空或故障中的也保留，其历史消息仍需
/// owner 行）的 Agent 公钥、persona 显示名与 owner。只供消息行显示“managed by <owner>”，不含 Installation
/// 其余字段，不授予任何使用、读取或管理权限；作者名仍只读 Relay kind:0（DD-117(6)）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentAuthorDirectory {
    pub agents: Vec<AgentAuthorView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthorView {
    /// 固定版本 personaIdentity 的显示名；缺省时客户端用公钥简写，不以 Installation 目录合成作者名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_display_name: Option<String>,

    pub agent_pubkey: String,

    pub installation_resource_id: String,

    /// owner 在本 Tenant 的显示名；owner 已不是 ACTIVE 成员时省略，客户端显示原版 owner unavailable。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_display_name: Option<String>,

    pub owner_principal_id: String,
}

/// DD-131(6)：GET /api/v1/agent-catalog/owners?ids=<id>,<id>。目录条目（本人可 discover 的本 Tenant
/// ACTIVE AgentDefinition 与 agent.team）的 owner 名，供原版 “Added by <owner>”。一次至多一页 ID；不属本
/// Tenant、非 ACTIVE、非目录类型或读者当前不可 discover 的 ID 一律省略，不能用来查询任意 Principal；不授予任何权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentCatalogOwners {
    pub owners: Vec<AgentCatalogOwnerView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCatalogOwnerView {
    /// owner 在本 Tenant 的显示名；owner 已不是 ACTIVE 成员时省略，客户端显示原版 owner unavailable。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_display_name: Option<String>,

    pub owner_principal_id: String,

    pub resource_id: String,
}

/// 同 Tenant 且当前 discover 权限允许的 AgentDefinition 页；nextOffset 续读同一排序，不代表总量上限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionPage {
    pub definitions: Vec<AgentDefinitionView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

/// DD-24/25 的 Core Agent 稳定身份及实际 Resource 事实；不表示版本已发布或 Agent 可运行。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionView {
    /// DD-131(6)：该定义已由 agent.definition.share 写入 tenant#member 的 discoverer/reader；缺省即未分享。只表示同
    /// Tenant 成员可发现与读取，不授予任何 Installation 使用权。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_shared: Option<bool>,

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelegationPage {
    pub can_grant: bool,

    pub can_revoke: bool,

    pub grants: Vec<AgentDelegationView>,

    pub installation_resource_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub resource_version: i64,

    pub workspace_id: String,
}

/// 同 Installation 的实际 Grant、Scope 与使用引用；没有 token、正文或新的权限裁决。state 是持久记录；effectiveState 是
/// DD-126(4) 的只读投影，只有它为 ACTIVE 时 Grant 才真实可用（仍不证明当次 permission）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelegationView {
    pub delegation_id: String,

    pub delegation_version: i64,

    /// DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
    /// Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
    /// 按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
    pub effective_state: DelegationEffectiveState,

    pub grantor_principal_id: String,

    pub parameters: DelegationGrantParameters,

    pub state: AgentDelegationViewState,

    /// DD-126(5)：state=SUPERSEDED 时替换本 Grant 的续签 Grant。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub superseded_by_delegation_id: Option<String>,

    pub uses: i64,
}

/// DD-126(4)：ACTIVE＝持久 ACTIVE、在有效期内、次数未尽且每个 Scope 的同意摘要与当前解析定义相等；NEEDS_RENEWAL＝其余条件成立但有
/// Scope 的同意摘要已变化或当前已无可解析定义；NOT_YET_VALID/EXPIRED/USES_EXHAUSTED
/// 按时钟与使用次数；REVOKING/REVOKED/SUPERSEDED 取持久状态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DelegationEffectiveState {
    Active,

    Expired,

    #[serde(rename = "NEEDS_RENEWAL")]
    NeedsRenewal,

    #[serde(rename = "NOT_YET_VALID")]
    NotYetValid,

    Revoked,

    Revoking,

    Superseded,

    #[serde(rename = "USES_EXHAUSTED")]
    UsesExhausted,
}

/// 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DelegationGrantParameters {
    pub expires_at: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_uses: Option<i64>,

    /// DD-126(5)：续签时被替换的本人 Grant；与 renewsDelegationVersion 成对出现，缺省为新授予。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renews_delegation_id: Option<String>,

    /// DD-126(5)：被替换 Grant 的当前 version（CAS）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub renews_delegation_version: Option<i64>,

    pub scopes: Vec<DelegationScopeParameters>,

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

    pub result_exposure_mode: DelegationScopeParametersResultExposureMode,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,

    pub target_type: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_resource_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DelegationScopeParametersResultExposureMode {
    #[serde(rename = "CONSUME_ONLY")]
    ConsumeOnly,

    Export,

    Read,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentDelegationViewState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "EXPIRED")]
    Expired,

    #[serde(rename = "REVOKED")]
    Revoked,

    #[serde(rename = "REVOKING")]
    Revoking,

    #[serde(rename = "SUPERSEDED")]
    Superseded,
}

/// 原 Grant 校验器当前允许的确切 Action/target/exposure；空页没有可授予对象，不伪造默认 Scope。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDelegationTargetPage {
    pub installation_resource_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub resource_version: i64,

    pub scopes: Vec<DelegationScopeParameters>,

    pub workspace_id: String,
}

/// DD-131(2)、DD-26：导入人在本 Tenant 可选的 RuntimeProfile 与已治理
/// Route（与版本配置目录同一来源与过滤）。目录为空不阻止导入（导入时不强制选择，DD-131(2)）；canImport 只反映动作开放与 Tenant
/// create。目录不授予发布、安装或运行权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentImportConfigurationPage {
    pub can_import: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub profiles: Vec<RuntimeProfileDirectoryProfilesItem>,

    pub routes: Vec<AgentVersionRouteOption>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfileDirectoryProfilesItem {
    pub capability_contract: RuntimeProfileDirectoryProfilesItemCapabilityContract,

    pub key: String,

    pub kind: RuntimeProfileKind,

    pub status: String,

    pub web_availability: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeProfileDirectoryProfilesItemCapabilityContract {
    pub capability_requirements: Vec<String>,

    pub max_idle_timeout_seconds: i64,

    pub max_parallelism: i64,

    pub max_turn_duration_seconds: i64,

    pub reply_policies: Vec<String>,

    /// 同一发布合同中回复策略键到 Buzz ResolvedPersona 原生布尔字段的显式映射；缺映射不表示支持。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_policy_mappings: Option<Vec<RuntimeReplyPolicyMapping>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeReplyPolicyMapping {
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
pub struct AgentInstallationCandidatePage {
    /// 原 Installation create exposure、目录与 fresh Workspace create；每个候选还须 consume/投影查证，提交时全部重验。
    pub can_create: bool,

    pub candidates: Vec<AgentInstallationCandidate>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub workspace_id: String,
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

/// 按既有部署登记页长扫描同一 Workspace，再以 fresh Installation Resource read 过滤；空页不代表整个 Workspace 无安装。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationPage {
    pub installations: Vec<AgentInstallationView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

/// 03 §7、17 §8：同 Tenant、已准入 Workspace 且 fresh Installation Resource read 允许的只读事实；不授予 Version
/// 正文、执行或管理权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_projection_generation: Option<i64>,

    /// 17 §3：固定 Version personaIdentity 的展示名，经同一 Installation Resource read
    /// 准入；只供提及与成员目录呈现，不授予执行或 Definition 读取。旧服务缺省时调用方回退到原 Definition 读取。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_display_name: Option<String>,

    pub agent_principal_id: String,

    pub agent_principal_state: AgentInstallationViewAgentPrincipalState,

    /// 原 Installation 的 ACTIVE AGENT BuzzIdentityBinding 公开公钥；经相同 Resource read 准入，仅供原 Inbox
    /// owner/作者匹配，不授予执行或签名权限。旧服务缺省不证明身份映射。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_pubkey: Option<String>,

    pub agent_resource_id: String,

    /// 同固定 Version、ACTIVE 投影与原生 Profile 已支持的 Automation 来源结果位置；普通 Agent 仍沿其固定回复策略，Automation
    /// 则消息到原 Thread、Schedule/manual 到同 Workspace Channel。不代表 execute、Delegation 或 quota
    /// 准入。缺失或空集合不支持 Schedule。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_result_targets: Option<Vec<AutomationResultTarget>>,

    /// DD-125(6)、17 §8：本人 fresh Installation Resource audit 允许读取会话转写、实时 item
    /// 与运行中回合（受审计敏感读取）。false 或缺省时只呈现 20002 工作中信号。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_audit: Option<bool>,

    /// DD-125(6)、05 §2.11：原“停止 / 从频道移除 / 删除”入口。动作目录开放 agent.installation.disable、安装 ACTIVE
    /// 且没有未终结投影、本人 fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与
    /// explicitConfirmation。不代表已准入，旧服务缺省不显示。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_disable: Option<bool>,

    /// DD-125(6)：原“启动”入口。目录开放 agent.installation.enable、安装 DISABLED、固定 Version 仍 PUBLISHED、本人
    /// fresh Installation manage 时为 true；命令只带 resourceId、resourceVersion 与 explicitConfirmation。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_enable: Option<bool>,

    /// DD-125(6)、DD-122(4)：原“重启”入口，即对固定 Version 的同版本
    /// agent.installation.upgrade（assetId=pinnedVersionAssetId）。canUpgrade 成立且固定 Version 仍
    /// PUBLISHED 时为 true；仍沿升级审批与排空。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_restart: Option<bool>,

    /// 当前 ACTIVE 安装可按原 manage 权限申请已发布目标版本；仍须原治理审批，不代表升级已经准入。旧服务缺省不显示入口。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_upgrade: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_binding: Option<AgentInstallationViewChannelBinding>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_permission: Option<AgentInstallationViewExecutionPermission>,

    /// DD-147(1)：该 Installation owner 在本 Tenant 的显示名，只在其 TenantMembership 与 HumanIdentity 仍为
    /// ACTIVE 时给出；可读条件与本视图相同。缺省时客户端显示原版 owner unavailable，不以 Installation 目录合成作者名（DD-117(6)）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_display_name: Option<String>,

    pub owner_principal_id: String,

    pub pinned_version_asset_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub projection: Option<AgentInstallationProjectionView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_permission: Option<AgentInstallationViewReadPermission>,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub state: AgentInstallationState,

    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentInstallationViewAgentPrincipalState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DISABLED")]
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutomationResultTarget {
    Channel,

    #[serde(rename = "TRIGGER_THREAD")]
    TriggerThread,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationViewChannelBinding {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,

    pub status: AgentInstallationViewChannelBindingStatus,

    pub triggers: Vec<AgentTrigger>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentInstallationViewChannelBindingStatus {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DISABLED")]
    Disabled,

    #[serde(rename = "ERROR")]
    Error,
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
pub struct AgentInstallationViewExecutionPermission {
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
pub struct AgentInstallationProjectionView {
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
pub struct AgentInstallationViewReadPermission {
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

/// Installation 的 Skill 投影状态（requested/projection/current）；需 Installation read，读取不触发投影或重试。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationSkillPage {
    pub agent_version_asset_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<i64>,

    pub installation_resource_id: String,

    pub skills: Vec<AgentInstallationSkillView>,
}

/// DD-135(7)：Installation pinned Version 引用的一个 Skill 的 requested 事实、投影结果与当前状态；不含正文或物化路径。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationSkillView {
    pub artifact_digest: String,

    pub ordinal: i64,

    /// 当前 generation 已以 digest 物化并经 skills/list 核对。
    pub projected: bool,

    pub skill_resource_id: String,

    pub skill_version_asset_id: String,

    pub stable_slug: String,

    pub status: AgentInstallationSkillStatus,
}

/// DD-135(5)(7)、17 §4：Installation 中一个被引 Skill 的当前状态。PROJECTION_FAILED 与 RUNTIME_NOT_READY
/// 来自 generation 投影；DISABLED 与 NO_PERMISSION 来自读取时的 fresh 判定，与每次 turn/start 前的判定同一规则。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentInstallationSkillStatus {
    Disabled,

    Effective,

    #[serde(rename = "NO_PERMISSION")]
    NoPermission,

    #[serde(rename = "PROJECTION_FAILED")]
    ProjectionFailed,

    #[serde(rename = "RUNTIME_NOT_READY")]
    RuntimeNotReady,
}

/// DD-122: the tools an Agent Installation's current generation requests and their effective
/// state. Read-only; grants happen only through installation create/upgrade.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationToolPage {
    pub generation: i64,

    pub installation_resource_id: String,

    pub tools: Vec<AgentInstallationToolView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationToolView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_binding_id: Option<String>,

    pub binding_status: AgentToolBindingStatus,

    /// APPLICATION only: the requested capability contract key@version.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_requirement: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<ReasonCode>,

    pub source: AgentInstallationToolSource,

    /// Absent when an application capability requirement has no resolved provider yet.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_resource_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentToolBindingStatus {
    Active,

    #[serde(rename = "NO_PERMISSION")]
    NoPermission,

    Pending,

    Revoked,
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

    #[serde(rename = "DELEGATION_RENEWAL_REQUIRED")]
    DelegationRenewalRequired,

    #[serde(rename = "DELEGATION_REQUIRED")]
    DelegationRequired,

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

    #[serde(rename = "STEP_TIMEOUT")]
    StepTimeout,

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentInstallationToolSource {
    Application,

    #[serde(rename = "PLATFORM_NATIVE")]
    PlatformNative,

    #[serde(rename = "USER_REGISTERED_EXTERNAL")]
    UserRegisteredExternal,
}

/// 05 §2.10、17 §8：一个 Agent Installation 在其 Workspace 的成员使用权目录。requested 是该成员显式持有
/// reader/executor/delegator 三项关系；effective 是 fresh read/execute/delegate 全部允许（含 owner/admin
/// 既有权限）。canGrant/canRevoke 只说明当前查看者可提交对应受治理请求，不代表请求已准入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationUsePage {
    pub installation_id: String,

    pub members: Vec<AgentInstallationUsePageMembersItem>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_action_execution_id: Option<String>,

    pub resource_version: i64,

    /// DD-125(6)：原 respondTo 在本页的映射。至少一名成员 requested=true 即 ALLOWLIST，否则 OWNER_ONLY；切换只经逐成员
    /// agent.installation.use.grant/revoke，不存在 anyone。旧服务缺省时客户端按 members 推导。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub respond_to: Option<AgentRespondToMode>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInstallationUsePageMembersItem {
    pub can_grant: bool,

    pub can_revoke: bool,

    pub display_name: String,

    pub effective: bool,

    pub principal_id: String,

    pub requested: bool,
}

/// DD-125(6)：原 respondTo 在本页的映射。至少一名成员 requested=true 即 ALLOWLIST，否则 OWNER_ONLY；切换只经逐成员
/// agent.installation.use.grant/revoke，不存在 anyone。旧服务缺省时客户端按 members 推导。
///
/// 原 Buzz respondTo 在 Kailo 的映射（DD-125(6)、05 §2.10）：OWNER_ONLY ≙ 默认（只有 owner、Workspace
/// manage 与 Tenant manage 持有使用权），ALLOWLIST ≙ 至少一名成员经 agent.installation.use.grant 显式授予。原
/// anyone 不提供：频道成员关系不推导业务 Resource permission（10 §3）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentRespondToMode {
    Allowlist,

    #[serde(rename = "OWNER_ONLY")]
    OwnerOnly,
}

/// 原 Session 同 generation 调用元事实，逐页 fresh Installation read，且仅本人发起或实际 AE 目标 audit 允许；不返回
/// prompt、tool result、reasoning、凭据或成本。未授权项过滤后空页仍可能有 nextCursor。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInvocationPage {
    pub invocations: Vec<AgentInvocationView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// 原 AgentInvocation 持久状态，不替代 Temporal。observation 或 UNKNOWN 时不得渲染为成功/失败；cancelPending
/// 不等于已取消；createdAt/updatedAt 是 Core 记录时间，不是假造的原生事件时间。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInvocationView {
    pub action_execution_id: String,

    pub cancel_pending: bool,

    /// 当前 HUMAN 是否为原任务发起人。仅控制任务详情入口；任务读取仍执行自身实时授权。
    pub can_read_task: bool,

    /// Core 记录的 RFC3339 时间字符串，按原线格式传输。
    pub created_at: String,

    pub invocation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_turn_id: Option<String>,

    pub status: AgentInvocationViewStatus,

    /// Core 记录的 RFC3339 时间字符串，按原线格式传输。
    pub updated_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentInvocationViewStatus {
    #[serde(rename = "CANCELED")]
    Canceled,

    #[serde(rename = "COMPLETED")]
    Completed,

    #[serde(rename = "CREATED")]
    Created,

    #[serde(rename = "DISPATCHING")]
    Dispatching,

    #[serde(rename = "FAILED")]
    Failed,

    #[serde(rename = "RUNNING")]
    Running,

    #[serde(rename = "UNKNOWN")]
    Unknown,
}

/// 19 §5：复合游标走到原生末尾才 COMPLETE。BOUND_EXCEEDED/UNKNOWN 不是空库存；只是本次 best-effort head tuple
/// snapshot，不是严格存量权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryEntryPage {
    pub entries: Vec<AgentMemoryEntryView>,

    pub installation_resource_id: String,

    pub operation_id: String,

    /// 仅 HUMAN 管理读取且 state 为 COMPLETE 时提供（DD-125(10)）；BOUND_EXCEEDED/UNKNOWN 与 Agent
    /// 记忆工具结果省略，客户端保持 slug 顺序。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<AgentMemoryReferenceView>,

    pub state: AgentMemoryEntryPageState,

    pub workspace_id: String,
}

/// NIP-AE cold head tuple，不含 value 或任何正文；tombstone 是当前原生 head，不回退旧 value。listing 为 COMPLETE
/// 的 HUMAN 管理读取另含该条正文中的引用 slug（DD-125(10)），Agent 记忆工具结果不含。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryEntryView {
    pub created_at: i64,

    pub event_id: String,

    /// 仅 HUMAN 管理读取、listing COMPLETE 且非 tombstone 时提供：以原 extract_refs 从该条正文提取的 [[slug]]
    /// 引用，按首次出现顺序去重、只含合法 slug。BOUND_EXCEEDED/UNKNOWN、tombstone 与 Agent 记忆工具结果省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outgoing_refs: Option<Vec<String>>,

    pub slug: String,

    pub tombstone: bool,
}

/// 仅 HUMAN 管理读取且 state 为 COMPLETE 时提供（DD-125(10)）；BOUND_EXCEEDED/UNKNOWN 与 Agent
/// 记忆工具结果省略，客户端保持 slug 顺序。
///
/// agent.memory.entry.list 为 COMPLETE 时，在同一准入与同一次 NIP-AE 读取内，以原 extract_refs 从 core head
/// 与各条非 tombstone head 的已解密正文提取的引用关系（DD-125(10)）。只是派生视图：不含正文，不授予任何读取权；客户端据此按
/// core、其引用树先序、未被引用者按 slug 排列。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryReferenceView {
    /// 本次读取存在 core head；false 时客户端显示“没有 core”。
    pub core_exists: bool,

    /// core profile 中的引用，按首次出现顺序去重，只含合法 slug；没有 core 时为空。
    pub core_refs: Vec<String>,

    /// 按目标 slug 排序。
    pub dangling: Vec<AgentMemoryDanglingRefView>,
}

/// 被某条已解密 head 以 [[slug]] 引用、但不在本次 COMPLETE listing 的非 tombstone 条目集合中的目标（原版 Missing
/// link，DD-125(10)）。tombstone 目标与没有 core 时对 core 的引用同样悬挂。只含 slug，不含正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMemoryDanglingRefView {
    /// 引用者 slug，core 记为 "core"；去重并按 slug 排序。
    pub referenced_by: Vec<String>,

    pub slug: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentMemoryEntryPageState {
    #[serde(rename = "BOUND_EXCEEDED")]
    BoundExceeded,

    Complete,

    Unknown,
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

/// DD-121: only agent.invoke executions initiated by the caller for the requested source
/// events; no message body, no other member's executions, no Agent internals. A mentioned
/// Agent without an outcome is still PENDING (not yet scanned).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentMentionOutcomePage {
    pub outcomes: Vec<AgentMentionOutcomeView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMentionOutcomeView {
    pub event_id: String,

    pub installation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_event_id: Option<String>,

    pub state: AgentMentionOutcomeState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentMentionOutcomeState {
    #[serde(rename = "DENIED")]
    Denied,

    #[serde(rename = "FAILED")]
    Failed,

    #[serde(rename = "REPLIED")]
    Replied,

    #[serde(rename = "RUNNING")]
    Running,
}

/// DD-121: the caller's own channel messages (event IDs) whose agent.invoke admission
/// outcome the caller may see.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMentionOutcomeQueryRequest {
    pub event_ids: Vec<String>,
}

/// 17 §8、19 §4：已准入 Workspace 与 Installation read 的原 Session 元事实；不包含或授权 Codex rollout
/// 正文。cursor 固定 HUMAN、scope、筛选与原生 generation。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,

    pub sessions: Vec<AgentSessionView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionView {
    pub agent_version_asset_id: String,

    /// Core 记录的 RFC3339 时间字符串，按原线格式传输。
    pub created_at: String,

    pub installation_resource_id: String,

    pub projection_generation: i64,

    /// 既有 BUZZ_EVENT、SCHEDULE 或 MANUAL Session 根引用；不从客户端生成 native thread。
    pub root_event_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_thread_id: Option<String>,

    /// ABANDONED：只剩 birth 结果不明、Invocation 已全部确定终态的 Session 超过对账期限后由 Core 放弃，不再派发 turn（DD-154）。
    pub status: AgentSessionViewStatus,

    pub workspace_id: String,
}

/// ABANDONED：只剩 birth 结果不明、Invocation 已全部确定终态的 Session 超过对账期限后由 Core 放弃，不再派发 turn（DD-154）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentSessionViewStatus {
    #[serde(rename = "ABANDONED")]
    Abandoned,

    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "CLOSED")]
    Closed,

    #[serde(rename = "PENDING")]
    Pending,

    #[serde(rename = "STARTING")]
    Starting,

    #[serde(rename = "UNKNOWN")]
    Unknown,
}

/// DD-131(2)：校验通过的快照包的导入预览与一次性暂存引用。只含映射后将进入新 DRAFT 的可移植字段与被丢弃的原版字段类别；不回显包正文、名单公钥或记忆。确认导入经
/// agent.definition.import。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSnapshotImportPreview {
    /// 包内联的头像（≤2 MiB 的 data URL）供预览；上传时已按附件规则存为本 Tenant 内容寻址媒体对象，DRAFT personaIdentity 只引用该对象。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_data_url: Option<String>,

    /// 内联头像在本 Tenant 媒体中的对象地址（/media/<sha256>），即新 DRAFT 的 personaIdentity.avatarUrl。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub display_name: String,

    pub expires_at: String,

    pub format_key: AgentSnapshotImportPreviewFormatKey,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub idle_timeout_seconds: Option<i64>,

    /// 可为空串：包没有 systemPrompt 时生成空指令的 DRAFT，补充后才能发布。
    pub instructions: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_turn_duration_seconds: Option<i64>,

    pub media_type: AgentSnapshotMediaType,

    pub omitted: Vec<AgentSnapshotOmission>,

    pub package_byte_size: i64,

    pub package_digest: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub parallelism: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_is_built_in: Option<bool>,

    pub upload_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentSnapshotImportPreviewFormatKey {
    #[serde(rename = "buzz-agent-snapshot@1")]
    BuzzAgentSnapshot1,
}

/// 05 §2.12 TransferFormat 的 package_media_type：`.agent.json` 清单本身，或 tEXt
/// `buzz_agent_snapshot` 承载同一清单的 `.agent.png`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentSnapshotMediaType {
    #[serde(rename = "application/json")]
    ApplicationJson,

    #[serde(rename = "image/png")]
    ImagePng,
}

/// DD-131(2)：快照中存在、导入不带入新 DRAFT 的原版字段。RUNTIME/MODEL/PROVIDER/NAME_POOL
/// 属本机运行时（DD-26）；RESPOND_TO_ALLOWLIST 的名单公钥属来源身份；RESPOND_TO_ANYONE
/// 不提供（DD-125(6)）；SESSION_POLICY 由运行时合同决定；MEMORY 见 DD-131(4)；AVATAR
/// 只指包引用的外部头像地址（内联头像按附件规则导入，不在此列）；SKILLS 由 owner 按本 Tenant 目录重选。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentSnapshotOmission {
    Avatar,

    Memory,

    Model,

    #[serde(rename = "NAME_POOL")]
    NamePool,

    Provider,

    #[serde(rename = "RESPOND_TO_ALLOWLIST")]
    RespondToAllowlist,

    #[serde(rename = "RESPOND_TO_ANYONE")]
    RespondToAnyone,

    Runtime,

    #[serde(rename = "SESSION_POLICY")]
    SessionPolicy,

    Skills,
}

/// DD-131(2)、DD-143：一次 Agent 快照包的原始字节（标准 base64，Web 与 Desktop 同一 JSON 传输）。解码后 JSON 不超过 5
/// MiB、PNG 不超过 10 MiB；格式与版本由 Core 判定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSnapshotUploadRequest {
    pub content_base64: String,

    pub media_type: AgentSnapshotMediaType,
}

/// 同 Tenant 且读者当前可 discover 的未删除 AgentTeam 页（DD-131(1)(6)）；nextOffset 续读同一排序。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub teams: Vec<AgentTeamView>,
}

/// DD-131(1) 的 Tenant 级 agent_team Resource 及 AgentTeam 事实（03 §7）。memberAgentResourceIds
/// 只列读者当前可 discover 的成员，次序不变；hiddenMemberCount 是其余成员个数，不暴露其 ID。catalogShared 表示该团队已写入
/// tenant#member 的 discoverer/reader（DD-131(6)）。成员停用或删除不改写团队，部署与提及时按当前状态跳过。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamView {
    pub catalog_shared: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub hidden_member_count: i64,

    pub member_agent_resource_ids: Vec<String>,

    pub name: String,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,
}

/// DD-131(3)：校验通过的团队快照包的导入预览与一次性暂存引用。团队名与说明进入新 agent_team；每个成员按 DD-131(2) 映射为将新建的 Definition
/// 与 DRAFT。团队 instructions 不进入包也不导入（DD-131(1)）。确认导入经 agent.team.import，任一成员失败整包不提交。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamSnapshotImportPreview {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub expires_at: String,

    pub format_key: AgentTeamSnapshotImportPreviewFormatKey,

    pub media_type: AgentSnapshotMediaType,

    pub members: Vec<AgentTeamSnapshotImportPreviewMembersItem>,

    pub name: String,

    pub package_byte_size: i64,

    pub package_digest: String,

    /// 包内带有原版团队 instructions；按 DD-131(1) 不导入。
    pub team_instructions_omitted: bool,

    pub upload_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentTeamSnapshotImportPreviewFormatKey {
    #[serde(rename = "buzz-team-snapshot@1")]
    BuzzTeamSnapshot1,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamSnapshotImportPreviewMembersItem {
    /// 仅与 avatarUrl 同时出现：包内该成员头像的原字节（data URL），只供预览显示，不写入任何对象。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_data_url: Option<String>,

    /// 该成员内联头像在本 Tenant 媒体中的对象地址（/media/<sha256>），即其 DRAFT 的 personaIdentity.avatarUrl。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub display_name: String,

    /// 可为空串：成员没有 systemPrompt 时生成空指令的 DRAFT，补充后才能发布。
    pub instructions: String,

    pub omitted: Vec<AgentSnapshotOmission>,
}

/// DD-131(3)：一次团队快照包的原始字节（标准 base64，Web 与 Desktop 同一 JSON 传输）。解码后 JSON 不超过 25 MiB、PNG 不超过 50
/// MiB；格式与版本由 Core 判定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamSnapshotUploadRequest {
    pub content_base64: String,

    pub media_type: AgentSnapshotMediaType,
}

/// GET /api/v1/agent-installations/{id}/transcript/stream 的 SSE 数据帧（DD-125(6)）：Core 从同一
/// Installation 原生进程读到的 item/started、item/completed、turn/started、turn/completed 通知，按 thread
/// 解析到 AgentSession 后转发；只在建立时与周期性再准入下 Installation audit 成立期间发送，建立时写 ACCESS
/// 审计。帧不落库，断线后以分页读取补齐。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptEvent {
    /// 原生通知时间（item 的 startedAtMs/completedAtMs 或 turn 通知的 emittedAtMs），Unix 毫秒。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub at_ms: Option<i64>,

    pub installation_id: String,

    /// ITEM_STARTED / ITEM_COMPLETED 时给出。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item: Option<AgentTranscriptItem>,

    pub phase: AgentTranscriptEventPhase,

    pub projection_generation: i64,

    pub root_event_id: String,

    pub thread_id: String,

    pub turn_id: String,
}

/// ITEM_STARTED / ITEM_COMPLETED 时给出。
///
/// DD-125(6)、SF-COD-09/17、17 §8：一条 Codex ThreadItem 的转写适配形状。BFF 只在 Installation Resource
/// audit 准入后，由 Core 经同一 Installation 的原生 app-server 读取（thread/items/list 或
/// item/started、item/completed 通知），按固定 Codex 类型逐字段映射后直接回应；Core 不存储、不复制正文。变体按 kind
/// 解释，各变体字段全部可选（contracts §1 平坦结构）。客户端把它适配为原 Buzz 转写条目。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptItem {
    /// COMMAND_EXECUTION 的 stdout/stderr 聚合输出。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregated_output: Option<String>,

    /// 工具调用参数的 JSON 文本（原生 arguments 原样序列化）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments_json: Option<String>,

    /// COMMAND_EXECUTION 的命令。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,

    /// item/completed 的 completedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at_ms: Option<i64>,

    /// COMMAND_EXECUTION 的工作目录（Installation 隔离目录内）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,

    /// COMMAND_EXECUTION、MCP_TOOL_CALL、DYNAMIC_TOOL_CALL 的原生耗时。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,

    /// MCP_TOOL_CALL 的原生 error.message。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_text: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,

    /// FILE_CHANGE 的逐文件变更。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_changes: Option<Vec<AgentTranscriptFileChange>>,

    /// 原生 ThreadItem.id。
    pub item_id: String,

    pub kind: AgentTranscriptItemKind,

    /// 原生 ThreadItem 的 type 标签原文（如 commandExecution）；OTHER 时客户端以原 raw 条目呈现。
    pub native_type: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<AgentTranscriptMessagePhase>,

    /// WEB_SEARCH 的查询词（部署已关闭托管搜索，一般不出现）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub query: Option<String>,

    /// REASONING 的原文段（原生提供时）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<Vec<String>>,

    /// REASONING 的 summary 段。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reasoning_summary: Option<Vec<String>>,

    /// 工具结果中的文本内容按原顺序以换行连接；非文本内容不转发。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_text: Option<String>,

    /// MCP_TOOL_CALL 的 MCP server 名；DYNAMIC_TOOL_CALL 的 namespace。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server: Option<String>,

    /// item/started 的 startedAtMs（Unix 毫秒）；历史页没有该原生事实时省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at_ms: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<AgentTranscriptItemStatus>,

    /// USER_MESSAGE 的文本输入按原顺序以换行连接；AGENT_MESSAGE 与 PLAN 的正文。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,

    /// MCP_TOOL_CALL / DYNAMIC_TOOL_CALL 的工具名。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,

    /// 所属原生 turn ID。
    pub turn_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptFileChange {
    pub change_kind: AgentTranscriptFileChangeKind,

    /// 原生 unified diff 文本。
    pub diff: String,

    /// UPDATE 改名时的目标路径。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub move_path: Option<String>,

    pub path: String,
}

/// Codex FileUpdateChange.kind 的标签（add/delete/update）；update 的改名目标另以 movePath 给出。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentTranscriptFileChangeKind {
    #[serde(rename = "ADD")]
    Add,

    #[serde(rename = "DELETE")]
    Delete,

    #[serde(rename = "UPDATE")]
    Update,
}

/// DD-125(6)、SF-COD-17：Codex app-server 持久 ThreadItem 的类型标签在转写线格式中的封闭投影。BFF 只把固定 Codex 的
/// userMessage/agentMessage/plan/reasoning/commandExecution/fileChange/mcpToolCall/dynamicToolCall/webSearch/imageView/contextCompaction
/// 映射为对应值，其余原生类型一律 OTHER 并保留 nativeType；客户端按原 Buzz 转写条目（TranscriptItem）呈现。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentTranscriptItemKind {
    #[serde(rename = "AGENT_MESSAGE")]
    AgentMessage,

    #[serde(rename = "COMMAND_EXECUTION")]
    CommandExecution,

    #[serde(rename = "CONTEXT_COMPACTION")]
    ContextCompaction,

    #[serde(rename = "DYNAMIC_TOOL_CALL")]
    DynamicToolCall,

    #[serde(rename = "FILE_CHANGE")]
    FileChange,

    #[serde(rename = "IMAGE_VIEW")]
    ImageView,

    #[serde(rename = "MCP_TOOL_CALL")]
    McpToolCall,

    Other,

    Plan,

    Reasoning,

    #[serde(rename = "USER_MESSAGE")]
    UserMessage,

    #[serde(rename = "WEB_SEARCH")]
    WebSearch,
}

/// Codex agentMessage 的 phase（commentary / final_answer）；原生缺省 phase 的旧消息省略本字段。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentTranscriptMessagePhase {
    Commentary,

    #[serde(rename = "FINAL_ANSWER")]
    FinalAnswer,
}

/// Codex commandExecution/fileChange/mcpToolCall/dynamicToolCall
/// 的原生状态（inProgress/completed/failed/declined）在转写中的封闭投影；无状态的条目省略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentTranscriptItemStatus {
    Completed,

    Declined,

    Failed,

    #[serde(rename = "IN_PROGRESS")]
    InProgress,
}

/// 实时转写帧的来源通知：item/started、item/completed、turn/started、turn/completed（SF-COD-17）。只转发 Core
/// 已从同一 Installation 原生进程读到的通知，不合成。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AgentTranscriptEventPhase {
    #[serde(rename = "ITEM_COMPLETED")]
    ItemCompleted,

    #[serde(rename = "ITEM_STARTED")]
    ItemStarted,

    #[serde(rename = "TURN_COMPLETED")]
    TurnCompleted,

    #[serde(rename = "TURN_STARTED")]
    TurnStarted,
}

/// GET
/// /api/v1/agent-installations/{id}/transcript?rootEventId&projectionGeneration&cursor（DD-125(6)、V-SCN-143）：按
/// AgentSession 分页读取 Codex thread/items/list（升序），要求 Installation Resource audit，受审计敏感读取，Core
/// 不复制正文。nextCursor 绑定读者、Installation 与 Session，原生 cursor 不外露。activeTurn 只在该 Session
/// 有运行中回合时给出。Session 尚无原生 thread 时 items 为空且省略 threadId。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTranscriptPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_turn: Option<AgentActiveTurnView>,

    pub installation_id: String,

    pub items: Vec<AgentTranscriptItem>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,

    pub projection_generation: i64,

    pub root_event_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<String>,
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

    pub profiles: Vec<RuntimeProfileDirectoryProfilesItem>,

    pub resource_version: i64,

    pub routes: Vec<AgentVersionRouteOption>,
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

    pub versions: Vec<AgentVersionView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionView {
    pub agent_resource_id: String,

    pub asset_id: String,

    pub asset_version: i64,

    /// Exact avatar URLs belonging to this authorized Version's current Tenant Community mapped
    /// to the existing same-origin profile media reader. Read projection only; not content, a
    /// credential, or an arbitrary remote proxy.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_media_paths: Option<HashMap<String, String>>,

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

    pub content: AgentVersionContent,

    pub ordinal: i64,

    pub owner_principal_id: String,

    pub state: AgentVersionState,
}

/// 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
///
/// 03 §7、17 §3 的 requested 行为内容；不含 owner、Workspace、凭据、provider 地址或 host
/// environment。发布不等于安装或运行授权。DRAFT 可缺 runtimeProfileKey、modelRouteResourceId 与
/// replyPolicy，instructions 可为空串（DD-131(2) 导入草稿与原版一致不要求运行配置）；agent.version.publish
/// 准入时三者必须齐备且 instructions 非空，PUBLISHED 版本总是完整。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentVersionContent {
    /// 精确 contract_key@version，不引用业务能力实现名。
    pub capability_requirements: Vec<String>,

    pub declared_tool_resource_ids: Vec<String>,

    pub instructions: String,

    pub memory_policy: AgentVersionContentMemoryPolicy,

    /// DRAFT 可缺省；发布时必填。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_route_resource_id: Option<String>,

    pub parallelism: i64,

    pub persona_identity: AgentVersionContentPersonaIdentity,

    /// RuntimeProfile capability contract 所声明的回复策略键；不隐式授予触发或读取权限。DRAFT 可缺省；发布时必填。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reply_policy: Option<String>,

    /// DRAFT 可缺省；发布时必填。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_profile_key: Option<String>,

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AgentVersionState {
    #[serde(rename = "DRAFT")]
    Draft,

    #[serde(rename = "PUBLISHED")]
    Published,

    #[serde(rename = "RETIRED")]
    Retired,
}

/// 当前HUMAN管理scope内的真实接入元数据。不是组件内部状态、配置、SecretRef或原生管理credential。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingPage {
    /// 仅 canCreate=true 时给出：Catalog 中已 APPROVED 的 APPLICATION release 的绑定所需公开声明（03
    /// §9）。secretSchema 只含键与格式声明，供 Tenant admin 按项提交 bindingSecretValues；不含任何 secret
    /// 值、SecretRef、locator 或 Catalog 管理权。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bindable_releases: Option<Vec<ApplicationBindableRelease>>,

    pub bindings: Vec<ApplicationBindingView>,

    pub can_create: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindableRelease {
    pub component_release_id: String,

    pub component_type_key: String,

    pub secret_schema: Vec<ApplicationBindableSecret>,

    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindableSecret {
    pub length_or_format: String,

    pub secret_key: String,

    pub value_type: String,
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

    /// Active approved binding declares a SERVICE read receiver. Resource discovery and writes
    /// still freshly check the original source share and receiver update permissions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_read_receiver: Option<bool>,

    /// Core 在已准入绑定事务中冻结的已批准 release 最大暴露边界。固定归属于
    /// binding/release/generation/action/version；不是授权，不能替代 fresh target permission、schema 或
    /// redaction 校验。未 ACTIVE 的绑定仅向 canCreate 管理者提供部署引用，仍不得执行。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub human_action_policies: Option<Vec<ApplicationHumanActionPolicy>>,

    /// DD-127(4): presentation category the approved NATIVE_PAGE release declares. The sidebar
    /// labels the entry by capabilityCategories ∪ this value; it grants nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_page_category: Option<NativePageCategory>,

    /// DD-138: preference items the pinned APPROVED KAILO_EMBED release declares for Kailo
    /// settings (07 §4.8.2). Kailo settings render them by category, never by component. Absent
    /// when none; Core keeps no values.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferences: Option<Vec<ComponentPreferenceDeclaration>>,

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
#[serde(rename_all = "camelCase")]
pub struct ApplicationHumanActionPolicy {
    pub action_key: String,

    pub action_version: i64,

    pub component_release_id: String,

    pub generation: i64,

    pub result_exposure_policy_id: String,

    pub result_exposure_policy_version: i64,
}

/// DD-127(4): presentation category the approved NATIVE_PAGE release declares. The sidebar
/// labels the entry by capabilityCategories ∪ this value; it grants nothing.
///
/// DD-127(4)：NATIVE_PAGE 入口的呈现类别，决定侧边栏标签与图标；不授予能力、不参与类别解析或授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativePageCategory {
    #[serde(rename = "data_query")]
    DataQuery,

    #[serde(rename = "file_storage")]
    FileStorage,

    Knowledge,
}

/// DD-138：KAILO_EMBED release 向 Kailo 设置页贡献的一项偏好声明（03
/// FrontendPresentationContract.preference_declarations[]，07 §4.8.2）。值对象，随 APPROVED release
/// 固定；Core 不保存偏好的值。键规则、选项数量与文案长度由 Core 登记时校验。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentPreferenceDeclaration {
    /// BOOLEAN 为 true/false，ENUM 为 options[].value 之一。
    pub default_value: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<ComponentPreferenceText>,

    /// Kailo 侧偏好键，2–4 段以 . 连接，不含组件名。
    pub key: String,

    pub label: ComponentPreferenceText,

    /// ENUM 时 2–12 项；BOOLEAN 时为空。
    pub options: Vec<ComponentPreferenceOption>,

    pub settings_category: ComponentPreferenceCategory,

    pub value_type: ComponentPreferenceValueType,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct ComponentPreferenceText {
    pub en: String,

    pub zh_cn: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentPreferenceOption {
    pub label: ComponentPreferenceText,

    pub value: String,
}

/// DD-138：组件偏好项所属的 Kailo 设置功能分类（07 §4.8.2）。APPEARANCE 外观、NOTIFICATIONS 通知、DOCUMENTS
/// 文档与文件、ANSWERS 问答；不按组件分类。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ComponentPreferenceCategory {
    #[serde(rename = "ANSWERS")]
    Answers,

    #[serde(rename = "APPEARANCE")]
    Appearance,

    #[serde(rename = "DOCUMENTS")]
    Documents,

    #[serde(rename = "NOTIFICATIONS")]
    Notifications,
}

/// DD-138：组件偏好项的取值类型。只有布尔与封闭选项，不接受自由文本、数字区间、URL、凭据或用户数据（07 §4.8.2）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ComponentPreferenceValueType {
    #[serde(rename = "BOOLEAN")]
    Boolean,

    #[serde(rename = "ENUM")]
    Enum,
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

    /// DD-138: preference items the pinned APPROVED KAILO_EMBED release declares for Kailo
    /// settings (07 §4.8.2); the host sends their values to this page only. Absent when none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preferences: Option<Vec<ComponentPreferenceDeclaration>>,

    pub projection_generation: i64,

    pub url: String,
}

/// Existing Resource references authorized for a HUMAN configuring a receiver binding's
/// service read permission. No business body, credential or independent directory authority.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationReadResourcePage {
    pub binding_id: String,

    pub binding_version: i64,

    pub direction: ApplicationReadResourceDirection,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub resources: Vec<ApplicationReadResource>,

    pub service_principal_id: String,

    pub tenant_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationReadResource {
    pub binding_id: String,

    pub native_ref: String,

    pub resource_id: String,

    pub type_key: String,

    pub version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
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

/// GET /api/v1/approvals（待我审批）、GET /api/v1/approvals/initiated（本人发起且已有结果的审批，DD-125(5) Inbox
/// Needs action 的第二来源）与 /api/v1/approvals/{workflowId} 的元素。状态只来自 Temporal history 的投影。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalView {
    pub action_execution_id: String,

    pub action_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_step: Option<AutomationApprovalStepView>,

    /// RFC3339，UTC
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consume_deadline: Option<String>,

    pub decisions: Vec<ApprovalDecisionRecord>,

    /// RFC3339，UTC
    pub expires_at: String,

    pub initiator_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub observation: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_channel_request: Option<ProjectChannelRequestApprovalView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub role_requirements: Vec<ApprovalRoleRequirement>,

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
pub struct AutomationApprovalStepView {
    pub id: String,

    pub message: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    pub version_asset_id: String,
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

/// DD-140：有权读取的审批所冻结的项目频道申请与提议的 Installation，供 owner 端以原版对话框呈现；不是另一审批或内容权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelRequestApprovalView {
    pub installation_resource_id: String,

    pub request: ProjectChannelRequest,
}

/// DD-140：托管 Agent 平台原生工具 project_channel_request 的输入，与固定 Buzz
/// projectChannelRequest.ts::parseProjectChannelRequest 同形同界；只是提议，绑定 workspace.create 且必须由
/// Installation owner 批准。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectChannelRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 该 Installation 的 ACTIVE ChannelAgentBinding 所在 Workspace（即其频道 ID）。
    pub home_channel_id: String,

    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub template_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<i64>,

    pub visibility: WorkspaceVisibility,
}

/// 只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
///
/// DD-80 的产品可见性：open 仅指同 Tenant 成员可发现并经 Core 加入；Relay 投影始终 private。
///
/// 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
///
/// Core 产品可见性，不从 Relay private 投影推断；旧回应可能省略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceVisibility {
    Open,

    Private,
}

/// ApprovalPolicy.role_requirements 的一项：该选择器要求至少 minDistinct 个不同 active HUMAN 批准（.design/03
/// §4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRoleRequirement {
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
/// version），权威源、证据类型与敏感级别由种类唯一确定（Core 的固定描述表）。库中存量出现不在此列的种类时解释为不可用，不猜测含义。DD-135(8) 的 Skill
/// 证据：`SKILL_SLUG` 为定义 slug；`SKILL_VERSION_ASSET_ID` 为版本 Asset ID，version
/// 为版本序号；`SKILL_ARTIFACT_DIGEST` 为规范 artifact 的 SHA-256，version 为其字节数；`SKILL_UPLOAD_DIGEST`
/// 为上传字节的 SHA-256。均不含 SKILL.md 正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum EvidenceKind {
    #[serde(rename = "ACTION_EXECUTION_ID")]
    ActionExecutionId,

    #[serde(rename = "ADMIT_ACTION_EXECUTION_ID")]
    AdmitActionExecutionId,

    #[serde(rename = "AGENT_VERSION_ASSET_ID")]
    AgentVersionAssetId,

    #[serde(rename = "AGENTGATEWAY_USAGE_ID")]
    AgentgatewayUsageId,

    #[serde(rename = "APPLICATION_BINDING_ID")]
    ApplicationBindingId,

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

    #[serde(rename = "EXPORT_PACKAGE_ASSET_ID")]
    ExportPackageAssetId,

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

    #[serde(rename = "SKILL_ARTIFACT_DIGEST")]
    SkillArtifactDigest,

    #[serde(rename = "SKILL_SLUG")]
    SkillSlug,

    #[serde(rename = "SKILL_UPLOAD_DIGEST")]
    SkillUploadDigest,

    #[serde(rename = "SKILL_VERSION_ASSET_ID")]
    SkillVersionAssetId,

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

    #[serde(rename = "TRANSFER_FORMAT")]
    TransferFormat,

    #[serde(rename = "TRANSFER_PACKAGE_DIGEST")]
    TransferPackageDigest,

    #[serde(rename = "USAGE_EVENT_ID")]
    UsageEventId,

    #[serde(rename = "WORKSPACE_LIFECYCLE_SNAPSHOT_ID")]
    WorkspaceLifecycleSnapshotId,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationDetailView {
    pub automation: AutomationView,

    /// 当前 Resource manage；不是运行准入、额度允许或业务成功。
    pub can_manage: bool,

    /// 仅当前 ACTIVE HUMAN owner、Workspace membership 与 Resource execute，以及已启用固定版本允许显示手动运行；仍须原
    /// automation.run 的准入、Delegation、额度及步骤审批。缺省关闭，不是业务成功。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_run: Option<bool>,

    pub delegations: Vec<AutomationDelegationView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_delegation_offset: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_version_offset: Option<i64>,

    pub versions: Vec<AutomationVersionView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationView {
    /// RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition 写事务记录的真实创建时间；历史无证据时省略，不回填当前时间。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,

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

    /// RFC3339，UTC，与既有管理查询时间字段一致。原 AutomationDefinition/Version 实际写入时间；未观察到更新的历史行省略，不从
    /// UUID、审计投递时间或浏览器时钟推测。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,

    /// 当前 WEBHOOK 密钥展示形式的末四位，仅用于辨认；密钥本身不可再取回（DD-116）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_secret_hint: Option<String>,

    /// WEBHOOK 触发的公开投递地址（部署配置的公开基址 + /hooks/{resourceId}）；只在密钥 ACTIVE 时给出（DD-116）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_url: Option<String>,

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
pub struct AutomationDelegationView {
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
pub struct AutomationVersionView {
    pub asset_id: String,

    pub asset_version: i64,

    pub automation_resource_id: String,

    pub config_hash: String,

    pub content: AutomationVersionContent,

    pub ordinal: i64,

    pub owner_principal_id: String,

    pub state: AgentVersionState,
}

/// 仅 automation.create / automation.publish_version：Core 自有版本内容；publish 产生新的不可变版本，不改写旧版本。
///
/// REQ-23、DD-107、03 §7 的不可变自动化版本。Schedule 使用 Temporal 原生 interval/calendar，不含触发消息正文、provider
/// 配置或凭据。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationVersionContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<AutomationVersionContentAction>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<AutomationApprovalPolicyRef>,

    /// 固定 Buzz WorkflowDef 的可选说明；随原不可变版本和 config_hash 冻结。旧版本缺省不补写，空值与空白沿原 YAML 保留。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 2保留历史单副作用步骤；3为有序多消息。旧单 action 格式缺省保持原摘要。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub format_version: Option<i64>,

    /// 原工作流名称；随不可变版本冻结。旧版本缺省不补写、不重算历史摘要。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    pub result_target: AutomationResultTarget,

    ///
    /// 不可与旧action混用。格式3逐条发送消息并查证原生回执，支持消息间Delay及首副作用前一个原策略审批；UNKNOWN不推进。步骤审批不可同时声明版本级approvalPolicy。其余原动作仍在恢复范围。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub steps: Option<Vec<AutomationStep>>,

    pub trigger: AutomationVersionContentTrigger,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationVersionContentAction {
    pub kind: AutomationVersionContentActionKind,

    pub template: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutomationVersionContentActionKind {
    #[serde(rename = "AGENT_TURN")]
    AgentTurn,

    #[serde(rename = "POST_MESSAGE")]
    PostMessage,
}

/// DD-107 同 Tenant automation.run 的显式已登记审批策略；版本精确冻结，不授予审批权限。
///
/// request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationApprovalPolicyRef {
    pub id: String,

    pub version: i64,
}

/// 原 Buzz 有序步骤的已接通动作；步骤执行和延时仍归 Temporal。call_webhook 需要工作区管理权限（原
/// requires_elevated_authority），保存与每次运行均重新核验。其它原动作不由此宣称已实现。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStep {
    pub action: AutomationStepAction,

    /// request_approval 的精确既有策略引用；审批人和时限仍由该策略决定，不以自由文本 from 推断权限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_policy: Option<AutomationApprovalPolicyRef>,

    /// 原请求体模板；不保存响应正文。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<String>,

    /// 原 buzz-sdk build_reaction 的字符上限；目标仅为该次真实触发消息。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,

    /// 原附加请求头，值可含原模板变量。凭据类请求头（Authorization、Cookie，以及名称含 token/secret/password/api-key/apikey
    /// 者）不得明文保存，必须改用 secretHeaders。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,

    pub id: String,

    /// 固定 Buzz Step.if 的 evalexpr 条件，原 4096 UTF-8
    /// 字节上限；为假时跳过该步骤（不失败）。只允许引用触发变量（trigger_text/author/channel_id/timestamp/emoji/message_id/is_reply），引用步骤输出在定义校验时以
    /// CAPABILITY_BLOCKED 拒绝。Kailo 在 automation.run 准入时按已验签触发事件一次求值并把跳过集合冻结进该
    /// ActionExecution；求值错误使该运行在任何副作用前失败。
    #[serde(rename = "if")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub automation_step_if: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,

    /// 原 HTTP 方法，缺省 POST。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<AutomationStepMethod>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// Kailo 治理：请求头密钥只以同 Tenant OpenBao SecretRef 保存，Core 仅在派发时读取 field=value
    /// 注入请求，不写入版本、参数、审计或轨迹。名称不得与 headers 重复（不区分大小写）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret_headers: Option<HashMap<String, AutomationSecretRef>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,

    /// 固定 Buzz Step.timeout_secs。Delay 由原 AgentTask 的独立 Temporal Timer
    /// 执行；send_message/add_reaction/set_channel_topic/call_webhook 由 Core
    /// 自本运行首次到达该步骤起计时，截止前未派发则以 STEP_TIMEOUT 失败，已派发的结果走既有对账（不明记 UNKNOWN，不重放）；call_webhook
    /// 的单次请求另受原 10 秒上限。缺省保持既有版本行为，不给历史补写默认值。
    #[serde(rename = "timeout_secs")]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_secs: Option<i64>,

    /// 原频道主题；空字符串清空主题，不改变频道名称、描述或成员。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,

    /// 固定 Buzz ActionDef::CallWebhook.url：公网 HTTPS
    /// 端点。scheme、主机与端口必须是字面值（原模板变量只可出现在路径与查询中），不得含用户信息。Core 每次派发前按 DNS 结果拒绝非全局单播地址，并只经
    /// AgentGateway 出站，不跟随重定向。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationStepAction {
    #[serde(rename = "add_reaction")]
    AddReaction,

    #[serde(rename = "call_webhook")]
    CallWebhook,

    Delay,

    #[serde(rename = "request_approval")]
    RequestApproval,

    #[serde(rename = "send_message")]
    SendMessage,

    #[serde(rename = "set_channel_topic")]
    SetChannelTopic,
}

/// 原 HTTP 方法，缺省 POST。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AutomationStepMethod {
    #[serde(rename = "DELETE")]
    Delete,

    #[serde(rename = "GET")]
    Get,

    #[serde(rename = "PATCH")]
    Patch,

    #[serde(rename = "POST")]
    Post,

    #[serde(rename = "PUT")]
    Put,
}

/// 同 Tenant OpenBao KV v2 的精确版本引用（DD-70）；只是 locator，不含密钥正文。audience 必须是 Core 的服务身份。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AutomationSecretRef {
    pub audience: String,

    pub locator: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationVersionContentTrigger {
    /// 固定 Buzz TriggerDef::ReactionAdded.emoji；仅 REACTION_ADDED，可选，精确匹配原回应内容。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,

    /// 固定 Buzz evalexpr 消息触发条件；CHANNEL_MESSAGE/MENTION/DIFF_POSTED/REACTION_ADDED（DIFF_POSTED
    /// 为同频道 kind:40008，与消息触发同一组变量；REACTION_ADDED 另有 trigger_emoji 与被回应消息 trigger_message_id），原
    /// 4096 UTF-8 字节上限。只匹配已验签且当前准入 HUMAN 事件；错误不匹配，不持久化触发正文。旧 textPrefix 若同时存在则均须满足。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter: Option<String>,

    pub kind: AutomationTriggerKind,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mention_principal_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub schedule_spec: Option<AutomationScheduleSpec>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_prefix: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AutomationTriggerKind {
    #[serde(rename = "CHANNEL_MESSAGE")]
    ChannelMessage,

    #[serde(rename = "DIFF_POSTED")]
    DiffPosted,

    Mention,

    #[serde(rename = "REACTION_ADDED")]
    ReactionAdded,

    Schedule,

    Webhook,
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
    pub kind: Option<AutomationScheduleSpecKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset_seconds: Option<i64>,
}

/// 旧 interval 缺省保持原格式及摘要；cron 必须显式 CRON。互斥及必需字段由领域消费者验证。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum AutomationScheduleSpecKind {
    #[serde(rename = "CRON")]
    Cron,

    #[serde(rename = "INTERVAL")]
    Interval,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationPage {
    pub automations: Vec<AutomationView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub available_approval_policies: Option<Vec<AutomationApprovalPolicyRef>>,

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

    pub runs: Vec<AutomationRunView>,
}

/// 本人发起的 automation.run；原 TaskProjection 与 UsageEvent 引用，不是新的运行权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationRunView {
    /// 原 TaskProjection 步骤证据。旧投影缺省表示尚无步骤证据，不表示没有步骤或运行成功；不通过读取原 history 旁路回填。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_trace: Option<Vec<AutomationStepTrace>>,

    /// 原 TaskProjection 进度；缺省不推测百分比或成功。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<String>,

    /// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_approval_task: Option<TaskView>,

    pub task: TaskView,

    /// 同 Tenant/Workspace/Operation 的原 UsageEvent 引用；不代表已结算，空集合不代表零用量。
    pub usage_event_ids: Vec<String>,
}

/// 既有 TaskProjection 中固定 AutomationVersion 步骤的可核验证据；不是执行权威。不含正文、模板、密钥、任意输出或原始 Temporal
/// history。时间仅来自原生事实，未知时省略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStepTrace {
    /// 原生计时终态时间 RFC3339；不存在则省略，不由父任务完成推断。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<ReasonCode>,

    pub output: AutomationStepTraceOutput,

    /// 原生步骤开始时间 RFC3339；不存在则省略，不用投影更新时间替代。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,

    pub status: AutomationStepStatus,

    pub step_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationStepTraceOutput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_execution_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub history_event_id: Option<i64>,

    /// call_webhook 实际收到的 HTTP 状态码；不保存响应正文或请求头。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<i64>,

    /// call_webhook 本次派发的稳定请求引用（随请求发送的 Kailo-Request-Id）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationStepStatus {
    Cancelled,

    Completed,

    Failed,

    Pending,

    Running,

    Skipped,

    Unknown,

    #[serde(rename = "waiting_approval")]
    WaitingApproval,
}

/// 同一运行的原步骤审批 child ActionExecution；缺省不代表无需审批。详情仍经本人 Tasks/Approvals fresh 授权读取，不是额外运行记录。
///
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

    #[serde(rename = "RESOURCE_EXPORT")]
    ResourceExport,

    #[serde(rename = "RESOURCE_IMPORT")]
    ResourceImport,

    #[serde(rename = "RESOURCE_PROVISION")]
    ResourceProvision,

    #[serde(rename = "SECRET_REF_REHOME")]
    SecretRefRehome,

    #[serde(rename = "TENANT_LIFECYCLE")]
    TenantLifecycle,

    #[serde(rename = "WORKSPACE_LIFECYCLE")]
    WorkspaceLifecycle,
}

/// GET /api/v1/operations 的有界回应（.design/14 §7）：本人发起或实际执行的操作，或调用方对其持有 audit permission 的
/// Tenant/Workspace 范围内的操作，每次 fresh Check；新的在前。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessOperationPage {
    /// 下一页首项之前的 ActionExecution ID；缺省即已读完
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,

    pub operations: Vec<BusinessOperationView>,
}

/// 业务操作时间线的一项：一个根 Governed Action（.design/14 §2、§7）。只含平台元数据与权威引用，不含参数、正文、prompt/response
/// 或原生结果；用量只来自 Core UsageEvent outbox 的冻结 quantity 与投递事实，不是余额或账单。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessOperationView {
    pub action_execution_id: String,

    pub action_key: String,

    pub action_version: i64,

    pub actor_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_status: Option<ApprovalStatus>,

    /// RFC3339，UTC
    pub created_at: String,

    pub initiator_principal_id: String,

    pub operation_id: String,

    pub phase: BusinessOperationPhase,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub target_id: String,

    /// RFC3339，UTC；只在阶段为确定终态且终态时间来自 TaskProjection 或同 operation 的审计事实时给出
    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_at: Option<String>,

    pub usage: Vec<OperationUsageLine>,

    pub usage_state: OperationUsageState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_kind: Option<WorkflowKind>,

    /// 缺省即 Tenant 级动作
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// 业务操作视图的当前阶段（.design/14 §7、§8），由 Core 按 ActionExecution 准入/派发、ApprovalProjection 与
/// TaskProjection 唯一推导；投影不可担保为当前时为 PROJECTION_DELAYED，外部结果不明时为 UNKNOWN，二者都不是成功或失败。APPLIED
/// 只用于无 Workflow 的同步动作返回结果；CANCEL_REQUESTED 只表示取消控制被接受，不表示原任务已终结。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BusinessOperationPhase {
    Aborted,

    Applied,

    #[serde(rename = "AWAITING_APPROVAL")]
    AwaitingApproval,

    #[serde(rename = "CANCEL_REQUESTED")]
    CancelRequested,

    Canceled,

    Completed,

    Denied,

    Evaluating,

    Expired,

    Failed,

    #[serde(rename = "NOT_STARTED")]
    NotStarted,

    #[serde(rename = "PROJECTION_DELAYED")]
    ProjectionDelayed,

    Revoked,

    Running,

    Terminated,

    #[serde(rename = "TIMED_OUT")]
    TimedOut,

    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationUsageLine {
    pub meter_key: String,

    /// 冻结 CloudEvent 的 quantity；status 非 COMMITTED 时不表示已入账
    pub quantity: i64,

    pub status: UsageSettlementStatus,
}

/// Core UsageEvent outbox 的投递事实（.design/11 §4 第 7 条）。PENDING_PUBLISH 尚未取得 OpenMeter
/// 回应；ACCEPTED 只表示 202 接收；COMMITTED 表示按 ID/source 查到 stored_at；UNKNOWN 待对账；FAILED 为确定拒绝。均不表示
/// invoice 已结算。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UsageSettlementStatus {
    Accepted,

    Committed,

    Failed,

    #[serde(rename = "PENDING_PUBLISH")]
    PendingPublish,

    Unknown,
}

/// 一个业务操作的用量结算状态（.design/11 §4、§6，.design/14
/// §8）。NOT_METERED：动作定义没有用量来源；NOT_DISPATCHED：有计量但没有派发；BILLING_UNAVAILABLE：已派发却没有可结算的持久用量事实（不显示零）；SETTLEMENT_PENDING：用量事件待发布或
/// OpenMeter 仅 202 接收；COMMITTED：全部事件已按 ID/source 查到
/// stored_at；UNKNOWN：投递或查证结果不明，待对账；FAILED：投递被确定拒绝。COMMITTED 不代表账单已结算。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum OperationUsageState {
    #[serde(rename = "BILLING_UNAVAILABLE")]
    BillingUnavailable,

    Committed,

    Failed,

    #[serde(rename = "NOT_DISPATCHED")]
    NotDispatched,

    #[serde(rename = "NOT_METERED")]
    NotMetered,

    #[serde(rename = "SETTLEMENT_PENDING")]
    SettlementPending,

    Unknown,
}

/// GET /api/v1/operations/summary：Tenant 或其中一个 Workspace 在区间内的业务聚合（.design/14 §7），调用方须对该范围持有
/// audit permission，每次 fresh Check。等待审批、运行中、UNKNOWN、投影落后与撤销单列，不从分母中丢弃；平均耗时只取有确定终态时间的操作。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessOperationSummary {
    pub actions: Vec<BusinessOperationActionSummary>,

    /// RFC3339，含
    pub from: String,

    pub phases: Vec<BusinessOperationPhaseCount>,

    pub tenant_id: String,

    /// RFC3339，不含
    pub to: String,

    pub total: i64,

    pub usage_states: Vec<OperationUsageCount>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BusinessOperationActionSummary {
    pub action_key: String,

    /// timedTerminalCount 为 0 时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub average_terminal_seconds: Option<f64>,

    pub phases: Vec<BusinessOperationPhaseCount>,

    /// 有确定终态时间、计入平均耗时的操作数
    pub timed_terminal_count: i64,

    pub total: i64,
}

/// 一个阶段在所选范围与区间内的根业务操作数量。只列出现过的阶段，不补零。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BusinessOperationPhaseCount {
    pub count: i64,

    pub phase: BusinessOperationPhase,
}

/// 一个用量结算状态在所选范围与区间内的根业务操作数量。只列出现过的状态，不补零。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OperationUsageCount {
    pub count: i64,

    pub state: OperationUsageState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractPage {
    pub can_register: bool,

    pub contracts: Vec<CapabilityContractView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
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

/// PUT /api/v1/user-state/channel-templates/{templateId} 的请求体（DD-125(4)、03
/// CollaborationUserState.channel_templates）：新建或替换本人的原频道模板；templateId 由客户端以 UUID 生成。字段沿原
/// ChannelTemplateRecord；agentResourceIds 只引用同 Tenant 的 AgentDefinition Resource（≙ 原
/// persona），原 runtime/model/backend 与 team 条目不适用。canvasTemplate 不超过 64 KiB，每人至多 200
/// 个模板。模板不授予任何权限：应用时仍逐项提交 workspace.create、workspace.canvas.set 与
/// agent.installation.create。DELETE 同一路径以 UserStateVersion 为请求体。version 不符即 409。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelTemplateRequest {
    pub agent_resource_ids: Vec<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub canvas_template: Option<String>,

    pub channel_type: WorkspaceChannelCreateChannelType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub name: String,

    pub version: i64,

    pub visibility: WorkspaceVisibility,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceChannelCreateChannelType {
    Forum,

    Stream,
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

    #[serde(rename = "receiver_observe")]
    ReceiverObserve,

    #[serde(rename = "receiver_start")]
    ReceiverStart,

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
    /// 仅成功 validate_binding：严格解析既有 AdapterBindingObservation 并核对请求的 SecretRef 后，仅去除实际
    /// secretReads.requestId 的固定字段摘要。完整实际响应仍由 responseDigest 固定；不代替绑定激活的 OpenBao 审计核验。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding_digest: Option<String>,

    /// DD-124：仅当冻结步骤声明 captures 且实际应答为带原生状态的 SUCCEEDED 时，从 typed ContentReference 或登记的
    /// generatedRefs 输出字段取出的值。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captures: Option<Vec<ComponentConformanceCaptureValue>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receiver_observation: Option<ComponentNativeReceiverObservation>,

    pub request_digest: String,

    pub response_digest: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_digest: Option<String>,
}

/// DD-124(2): one captured value of the current suite run. Core derives it only from the
/// candidate's actual wire response or typed ContentReference; it is kept only in that
/// step's observation evidence and re-checked when the report is recorded. Never a fixture,
/// seed or administrator value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentConformanceCaptureValue {
    pub key: String,

    pub value: String,
}

/// 原生 SyncLog 的真实批次与同批多个原 SERVICE read Operation 元数据；completed 不能单独证明通过，Core 仍核对每个
/// SOURCE/RECEIVER 回执及冻结请求。DD-124(4)：请求省略 importConfigRef 时，本观察是隔离 Core 真实 APPLICATION
/// 接收方动作的原生执行（nativeBatchId 为其原生任务标识，nativeStatus 为原生状态原值），每个 read Operation 锚定该动作而无
/// nativeBatch；RECEIVER case 中不读取来源的步骤（如 read/export/search/delete）可无 read Operation，读取由整个
/// case 承载。执行、operation 与批次标识须为隔离 Core 本次生成且不在计划或 fixture 中。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNativeReceiverObservation {
    pub completed: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,

    pub native_batch_id: String,

    pub native_status: String,

    pub read_operations: Vec<ComponentNativeReadObservation>,

    pub request: ComponentNativeReceiverRequest,

    pub started_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNativeReadObservation {
    pub action_execution_id: String,

    /// 原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
    /// receiverActionExecutionId）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_batch: Option<AdapterReadGrantRequestNativeBatch>,

    pub operation_id: String,

    pub read_request: AdapterReadGrantRequest,

    pub receiver_action_execution_id: String,

    pub receiver_generation: i64,

    pub receiver_receipt: AdapterReadReceipt,

    pub source_binding_id: String,

    pub source_receipt: AdapterReadReceipt,

    pub source_resource_id: String,
}

/// Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
/// exactly one mode, freezes these references, and resolves the receiver from its
/// authenticated binding.
///
/// 原生批次读取必填且等于 readRequest.nativeBatch；锚定 APPLICATION 接收方动作的读取必须省略（readRequest 携带
/// receiverActionExecutionId）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdapterReadGrantRequestNativeBatch {
    pub action_key: String,

    pub action_version: i64,

    pub batch_id: String,

    pub import_config_ref: String,

    pub receiver_resource_id: String,
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

    /// Native SERVICE importer provenance instead of a HUMAN/AGENT execution. Core requires
    /// exactly one mode, freezes these references, and resolves the receiver from its
    /// authenticated binding.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_batch: Option<AdapterReadGrantRequestNativeBatch>,

    /// 只观察已存在的同一原生 SOURCE AE；必须匹配原 key/nativeBatch（或锚定的 receiverActionExecutionId 与
    /// receiverArgumentsJson）/输入，查无或未就绪不得创建、续发 grant 或进入新准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observe_action_execution_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_action_execution_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_arguments_json: Option<String>,

    pub receiver_binding_id: String,

    pub source_resource_id: String,
}

/// 07§8A 隔离原生接收方验证的冻结请求。原生生成真实 batch ID；同键重入与观察必须保持全部字段，不是生产 execute 输入或通用 HTTP
/// 脚本。DD-124(4)：importConfigRef 存在时为 NATIVE_MANAGED 原生批次，由候选实现原生发起；省略时为隔离部署内的 APPLICATION
/// 接收方动作（如经 READ_EDGE 的 ingest），由平台维护的隔离部署以真实 APPLICATION ActionExecution
/// 准入与派发，原能力输入只由已登记向量与 fixture 前置值冻结。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNativeReceiverRequest {
    pub binding_id: String,

    /// 受控夹具固定的 RFC3339 首派期限，须受原生 SyncLog 保留策略约束；过期仍可观察同一批次，不得续期重派。
    pub expires_at: String,

    pub generation: i64,

    pub idempotency_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub import_config_ref: Option<String>,
}

/// 受信Worker实际HTTP响应的瞬时核验输入。正文仅在Activity与Core请求内存中存在，不得进入Temporal历史、报告、日志或数据库；不是用户上传的通过声明。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceWireObservation {
    pub http_status: i64,

    pub probe: ComponentConformanceProbe,

    pub response_json: String,
}

/// 原 ComponentTaskWorkflow 的单个线协议 Activity 输入。步骤来自 Core 冻结计划；调度、尝试次数与 UNKNOWN 对账只由原 Temporal
/// history 承接，不建立另一执行账本。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceProbe {
    /// DD-124：本步 CAPTURE 绑定所需的值，只取同 case 更早步骤已记录观察中的 captures；Core 代入后签名，登记时再按报告重算，不能以 fixture
    /// 或管理员值替代。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captures: Option<Vec<ComponentConformanceCaptureValue>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ContentReference>,

    pub plan: ComponentConformancePlan,

    /// 只查询同一步冻结幂等键；不再发送原 execute/CREATE。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reconcile: Option<bool>,

    pub step_index: i64,
}

/// 受信 Worker 从 Core 取得的隔离执行输入。不是用户上传的通过声明；只含冻结引用与平台解释的数据，不含候选地址或凭据。顺序与全部内容进入 planDigest。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformancePlan {
    pub action_execution_id: String,

    pub artifact_digest: String,

    pub component_release_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector_kind: Option<ComponentConformancePlanConnectorKind>,

    pub contract_digests: Vec<String>,

    /// 独立隔离身份投递的完整规范化摘要，不含私钥或token，不是生产policy。
    pub identity_digest: String,

    pub operation_id: String,

    pub plan_digest: String,

    /// DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_environment: Option<ComponentConformanceReceiverEnvironment>,

    /// Core 冻结时为空；原 ComponentTaskWorkflow 启动后写入真实 Temporal run UUID。报告的 runId 仍必须为 UUID，Core 以
    /// Describe 与同 workflow 的当前 TaskProjection 核对。
    pub run_id: String,

    pub steps: Vec<ComponentConformanceStep>,

    pub suite_digest: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComponentConformancePlanConnectorKind {
    #[serde(rename = "PROTOCOL_PEER")]
    ProtocolPeer,

    #[serde(rename = "REMOTE_ADAPTER")]
    RemoteAdapter,
}

/// DD-124(4)：仅含接收方向步骤的计划。Core 冻结时从已核验的隔离身份复制；登记与批准以它核对当前 Core 构建与来源类别已 APPROVED 的 release。
///
/// DD-124(4), 07 §8A: identity of the isolated receiver deployment a plan with
/// receiver_start/receiver_observe steps observes. isolatedCoreBuildId is the
/// PlatformBuildInfo CORE buildId of the isolated Core/Worker and must equal the current
/// production Core build. sourceReleaseId with its artifact and manifest digests names the
/// production Catalog release, APPROVED and declaring read_edge SOURCE or BOTH, that the
/// isolated deployment runs as the source. It is delivered with the isolated identity, fixed
/// by the plan identity digest and copied into the plan; it is not evidence that any step
/// passed.
///
/// DD-124(4)：计划含 receiver_start/receiver_observe 步骤时必填；固定隔离接收方部署的 Core 构建与来源
/// release，随身份摘要进入原计划。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceReceiverEnvironment {
    pub isolated_core_build_id: String,

    pub source_artifact_digest: String,

    pub source_manifest_digest: String,

    pub source_release_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceStep {
    /// DD-124：仅 V2 契约步骤。Core 冻结时已代入 PRECONDITION 的 fixture 值，这里只保留 CAPTURE 的代入位置声明（不含值）；运行时 Core
    /// 在 ActionToken 签名前代入请求、在比对前代入期望。权限拒绝重放保留同一 INPUT 声明。接收方向步骤只保留本步自身捕获的 INPUT 声明：请求不被代入，Core
    /// 以它们比对隔离 Core 实际产生的接收方准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bindings: Option<Vec<CapabilityVectorBinding>>,

    /// DD-124：仅 V2 契约步骤。本步 SUCCEEDED 且原生终态证据完整时由 Core 从实际应答的封闭槽位取值，写入本步观察证据。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captures: Option<Vec<CapabilityVectorCapture>>,

    pub case_key: String,

    /// 只由 Core 从该 release implements 的 ACTIVE 契约步骤固定。存在时 expectedResponseJson 为该能力的业务结果，不是
    /// native 任务元数据。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_key: Option<String>,

    /// Adapter 为实际 HTTP 状态；MCP 原生结果固定 0，不以伪造 HTTP 状态证明协议成功。
    pub expected_http_status: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_mcp_result_kind: Option<ComponentConformanceStepExpectedMcpResultKind>,

    pub expected_response_json: String,

    pub idempotency_key: String,

    /// 仅接收方向步骤（V1 的 NATIVE_INTERNAL/NATIVE 能力步骤，或 V2 RECEIVER case 的步骤），由 Core
    /// 保留已代入前置值的原能力向量输入；SOURCE AE 与 batch 必须以同批真实入站观察替换，不是预造授权。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receiver_input_json: Option<String>,

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

/// DD-124(2): one substitution position of a V2 step. pointer is an RFC 6901 JSON Pointer
/// into the step input (INPUT) or expected output (EXPECTED); the literal there must be
/// exactly the reserved placeholder {{SOURCE:key}}. INPUT may bind PRECONDITION or CAPTURE;
/// EXPECTED may bind CAPTURE or a PRECONDITION already sent as INPUT in this case. In a
/// RECEIVER case INPUT may also bind the step's own captures: Core compares that input with
/// the admission the isolated Core actually produced whenever the step's evidence has reads.
/// The plan digest fixes the declaration, never the value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityVectorBinding {
    pub key: String,

    pub pointer: String,

    pub side: CapabilityVectorSide,

    pub source: CapabilityVectorBindingSource,
}

/// DD-124(2): the vector document a JSON Pointer addresses — the step input or its expected
/// output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CapabilityVectorSide {
    #[serde(rename = "EXPECTED")]
    Expected,

    #[serde(rename = "INPUT")]
    Input,
}

/// DD-124(1)(2): the two non-literal value sources of a V2 conformance vector. Every other
/// value is LITERAL; there is no third binding source.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CapabilityVectorBindingSource {
    #[serde(rename = "CAPTURE")]
    Capture,

    #[serde(rename = "PRECONDITION")]
    Precondition,
}

/// DD-124(1)(2): a value this step's actual SUCCEEDED observation produces for later steps
/// of the same case. key is unique in the case and must be consumed at least once. pointer
/// is present only for GENERATED_REF and must equal an EXPECTED generatedRefs entry of the
/// step's contract key; in a RECEIVER case it equals an INPUT entry and reads the admission
/// the isolated Core produced. ACTION_EXECUTION_ID and OPERATION_ID exist only in RECEIVER
/// cases; a step of a RECEIVER case takes them and CONTENT_REFERENCE_* from its own read and
/// the receiver's read_receipt of that admission, so a capturing step's evidence has reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityVectorCapture {
    pub key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub pointer: Option<String>,

    pub slot: CapabilityVectorCaptureSlot,
}

/// DD-124(1): the closed observation slots a CAPTURE may take. CONTENT_REFERENCE_* read the
/// adapter's typed ContentReference; GENERATED_REF reads an output field listed in the
/// vector document's generatedRefs; ACTION_EXECUTION_ID/OPERATION_ID are the SOURCE read
/// ActionExecution and Operation the isolated Core generated for a step of a RECEIVER case
/// in this run (never present in the plan or fixture).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CapabilityVectorCaptureSlot {
    #[serde(rename = "ACTION_EXECUTION_ID")]
    ActionExecutionId,

    #[serde(rename = "CONTENT_REFERENCE_NATIVE_OBJECT_REF")]
    ContentReferenceNativeObjectRef,

    #[serde(rename = "CONTENT_REFERENCE_NATIVE_REVISION")]
    ContentReferenceNativeRevision,

    #[serde(rename = "GENERATED_REF")]
    GeneratedRef,

    #[serde(rename = "OPERATION_ID")]
    OperationId,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ComponentConformanceStepExpectedMcpResultKind {
    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "RESULT")]
    Result,
}

/// Read-only member directory snapshot for an embedded component (.design/07 §4.7.4,
/// DD-133(4)): every ACTIVE HUMAN member in the native page entry binding's scope with Kailo
/// display name, avatar URL, Tenant role and ACTIVE Workspace memberships. A full snapshot,
/// never paged: a person absent from it is removed from the component organisation.
/// directoryVersion is the SHA-256 (hex) of the canonical JSON of every other field. No
/// email, Buzz key, session or credential.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentMemberDirectory {
    pub binding_id: String,

    /// Lowercase hex SHA-256 of the canonical JSON of this snapshot without directoryVersion;
    /// unchanged content keeps the same version.
    pub directory_version: String,

    pub members: Vec<ComponentDirectoryMember>,

    pub tenant: ComponentDirectoryTenant,

    /// Every ACTIVE Workspace in the binding scope (only the binding's own Workspace when it has
    /// one).
    pub workspaces: Vec<ComponentDirectoryWorkspace>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDirectoryMember {
    /// Kailo display name: the member's SERVER HUMAN kind:0 display_name (else name), else the
    /// HumanIdentity display name.
    pub display_name: String,

    /// One entry per ACTIVE external identity; the component keys its account on issuer +
    /// subject.
    pub identities: Vec<ComponentDirectoryIdentity>,

    pub principal_id: String,

    pub tenant_role: ComponentDirectoryRole,

    pub workspaces: Vec<ComponentDirectoryMembership>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentDirectoryIdentity {
    pub issuer: String,

    /// <PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>, the same value as the IdP picture
    /// claim.
    pub picture: String,

    pub subject: String,
}

/// 成员目录中的 Kailo 角色（.design/07 §4.7.4、DD-133(4)）：SpiceDB 对 Tenant 或 Workspace 有 `manage` 为
/// ADMIN，否则 MEMBER。只供组件派生自身角色，不授予 Kailo 侧任何权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ComponentDirectoryRole {
    #[serde(rename = "ADMIN")]
    Admin,

    #[serde(rename = "MEMBER")]
    Member,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDirectoryMembership {
    pub role: ComponentDirectoryRole,

    pub workspace_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDirectoryTenant {
    pub name: String,

    pub tenant_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentDirectoryWorkspace {
    pub name: String,

    pub workspace_id: String,
}

/// DD-138(4)、07 §4.8.3：组件以其成员目录 client 的 client-credentials 令牌向 Core 服务监听面 POST
/// /service/v1/component-notifications/bindings/{bindingId}/notifications 投递的一条通知。不建立
/// ActionExecution、不授予权限；未知字段整体拒绝。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNotificationDelivery {
    /// 触发者；须在同一目录范围内且不是接收人。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor: Option<ComponentPersonRef>,

    pub category: ComponentNotificationCategory,

    /// 1–128 个字母、数字、. _ : -，在该 binding 内唯一；同键同内容返回首次结果，同键异内容 409。
    pub idempotency_key: String,

    /// 事件发生时刻（RFC3339），不晚于 Core 当前时刻 5 分钟；缺省取接收时刻。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub occurred_at: Option<String>,

    /// 组件页面 origin 内的相对路径：1–1024 字符，以单个 / 开头，无反斜杠、空白与控制字符，无凭据类查询参数。
    pub path: String,

    pub recipient: ComponentPersonRef,

    /// 每种语言 1–280 字符，不含控制字符。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<ComponentText>,

    /// 每种语言 1–120 字符，不含控制字符。
    pub title: ComponentText,
}

/// 触发者；须在同一目录范围内且不是接收人。
///
/// 组件以 OIDC issuer + subject 指称 Kailo 成员（与 07 §4.7.4 成员目录 identities[] 同值）；Core 只在该 binding
/// 当前目录范围内解析。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentPersonRef {
    pub issuer: String,

    pub subject: String,
}

/// DD-138(4)、07 §4.8.3：组件投递到 Kailo 收件箱的通知类别（封闭枚举）。SHARED 分享给你；MENTIONED 提及你；COMMENTED
/// 评论了你的对象；ACCESS_REQUESTED 访问申请（进入「需要处理」）；TASK_COMPLETED 任务完成；CONTENT_UPDATED 你关注的内容有更新。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ComponentNotificationCategory {
    #[serde(rename = "ACCESS_REQUESTED")]
    AccessRequested,

    Commented,

    #[serde(rename = "CONTENT_UPDATED")]
    ContentUpdated,

    Mentioned,

    Shared,

    #[serde(rename = "TASK_COMPLETED")]
    TaskCompleted,
}

/// 每种语言 1–280 字符，不含控制字符。
///
/// 组件向 Kailo 提供的中英文文案（键恰为 ZH_CN、EN）。长度与字符规则由 Core 按使用处校验。
///
/// 每种语言 1–120 字符，不含控制字符。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct ComponentText {
    pub en: String,

    pub zh_cn: String,
}

/// DD-138(4)：GET /api/v1/inbox/component-notifications 的一页，按 receivedAt 倒序；nextCursor
/// 缺省表示没有更多。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNotificationPage {
    pub items: Vec<ComponentNotificationView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,

    /// 当前可见范围内本人未读条目总数（不受分页影响）。
    pub unread_count: i64,
}

/// DD-138(4)、03 ComponentNotification：当前会话 Principal
/// 收件箱中的一条组件通知。只含呈现类别，不含组件名、component_type_key 或 binding 配置；bindingId 只用于在 Kailo
/// 内容区打开该原生页面入口。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNotificationView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_display_name: Option<String>,

    /// 07 §4.7.3 Tenant 头像地址；缺省时客户端显示首字母。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_picture: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub actor_principal_id: Option<String>,

    pub binding_id: String,

    pub category: ComponentNotificationCategory,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_page_category: Option<NativePageCategory>,

    pub notification_id: String,

    pub occurred_at: String,

    pub path: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_at: Option<String>,

    pub received_at: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<ComponentText>,

    pub title: ComponentText,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// DD-138(4)：POST /api/v1/inbox/component-notifications/read。接收人把本人的条目标记为已读（个人状态，不建立
/// ActionExecution）；1–100 个 ID，非本人或不可见的 ID 被忽略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNotificationReadRequest {
    pub notification_ids: Vec<String>,
}

/// DD-138(4)：投递回执。新建 201、同键同内容重复 200（duplicate=true）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNotificationReceipt {
    pub duplicate: bool,

    pub notification_id: String,
}

/// 原受信Worker在原审批后的COMPONENT_RELEASE Activity报告实际自身能力。Core自行读取自身与当前Web事实，并重新核验原release套件和审批。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleaseApprovalReport {
    pub run_id: String,

    pub target: ComponentReleaseApprovalTarget,

    pub worker_build: PlatformBuildInfo,
}

/// 原ComponentTaskWorkflow的组件批准目标，只引用原准入与不可变release，不携带用户声明的兼容结论。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentReleaseApprovalTarget {
    pub action_execution_id: String,

    pub component_release_id: String,

    pub workflow_id: String,
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

    pub platform_port_keys: Vec<PlatformBuildInfoPlatformPortKeysItem>,

    pub reported_at: String,

    pub subject: PlatformBuildInfoSubject,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlatformBuildInfoPlatformPortKeysItem {
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
pub enum PlatformBuildInfoSubject {
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

/// DD-138(5)、07 §4.8.4：组件内容搜索结果。每项已解析到可在 Kailo 内容区打开的原生页面入口（bindingId 为该呈现类别生效的入口，不是 adapter
/// binding）；sources 列出每个呈现类别来源的状态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentSearchPage {
    pub results: Vec<ComponentSearchResult>,

    pub sources: Vec<ComponentSearchSource>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSearchResult {
    pub binding_id: String,

    pub kind: ComponentSearchResultKind,

    pub native_page_category: NativePageCategory,

    pub path: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,

    pub title: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSearchSource {
    pub native_page_category: NativePageCategory,

    pub state: ComponentSearchSourceState,
}

/// DD-138(5)：一次「搜索全部」中某个组件来源的结果状态。ANSWERED 表示该来源已按合同回应（可为零条）；UNAVAILABLE
/// 表示该来源超时、不可达或回应不合合同，其结果整体未采信。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ComponentSearchSourceState {
    #[serde(rename = "ANSWERED")]
    Answered,

    #[serde(rename = "UNAVAILABLE")]
    Unavailable,
}

/// DD-138(5)、07 §4.8.4：POST /api/v1/search/components。q 去首尾空白后 1–200 字符；limit 为每个来源的上限
/// 1–20（缺省 8）；locale 为 ZH_CN 或 EN（缺省 ZH_CN）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentSearchQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub locale: Option<String>,

    pub q: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationPage {
    pub items: Vec<ConversationView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// 已认证参与者可见的原 Relay 私聊引用，不包含消息正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationView {
    pub channel_id: String,

    pub id: String,

    pub operation_id: String,

    pub participant_principal_ids: Vec<String>,

    pub state: ConversationViewState,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ConversationViewState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DISABLED")]
    Disabled,

    #[serde(rename = "PROVISIONING")]
    Provisioning,

    #[serde(rename = "RECONCILING")]
    Reconciling,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationParticipantPage {
    pub items: Vec<ConversationParticipant>,

    pub max_participants: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// 同租户当前有效 HUMAN 及其已投影真实身份公钥，不伪造用户资料。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationParticipant {
    pub display_name: String,

    /// DD-139：同 Tenant 头像地址 <PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>（07 §4.7.3），只对有
    /// ACTIVE 外部身份的成员给出；只是地址，不含图片或资料正文，读取仍按该路由的 Tenant 准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,

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
pub struct DiscoverableWorkspacePage {
    pub items: Vec<DiscoverableWorkspace>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverableWorkspace {
    /// 与 updateActionKey 同时给出且为 true 时，Channel 是被原生 reaper 按 TTL 到期归档的，界面只提供以 workspace.update 的
    /// reopen 解档；省略或 false 时 updateActionKey 只用于修改名称、描述、TTL 与可见性。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_reopen: Option<bool>,

    pub channel: WebChannelView,

    pub created_at: String,

    pub id: String,

    /// 已通过当前 HUMAN Workspace 准入，而非只表示 join 已受理。
    pub is_member: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub join_action_key: Option<DiscoverableWorkspaceJoinActionKey>,

    /// 当前 Principal 持有 ACTIVE WorkspaceMembership、fresh Workspace discover
    /// 检查通过且目录已开放时给出；主体固定为本人。省略即不显示退出入口。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub leave_action_key: Option<DiscoverableWorkspaceLeaveActionKey>,

    pub member_count: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_state: Option<WorkspaceMembershipState>,

    /// 当前 Principal 经 fresh Workspace manage 检查、目录已开放、Workspace ACTIVE 且没有未终结的 workspace.update
    /// 时给出；Channel 已归档时仅在 canReopen 为 true 时给出。省略即不显示编辑入口，提交仍重新准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_action_key: Option<DiscoverableWorkspaceUpdateActionKey>,

    pub visibility: WorkspaceVisibility,
}

/// Web 经 BFF 以本人身份读取已准入 Workspace 对应的原 Relay 39000 元数据；类型来自原生签名证据，不从消息列表推断，不另存业务正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebChannelView {
    pub archived: bool,

    pub channel_id: String,

    pub channel_type: WorkspaceChannelCreateChannelType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub name: String,

    /// 原 39000 topic 标签；Relay 对空主题省略该标签，缺省即无主题。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub topic: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_deadline: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DiscoverableWorkspaceJoinActionKey {
    #[serde(rename = "workspace.join")]
    WorkspaceJoin,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum DiscoverableWorkspaceLeaveActionKey {
    #[serde(rename = "workspace.leave")]
    WorkspaceLeave,
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
pub enum DiscoverableWorkspaceUpdateActionKey {
    #[serde(rename = "workspace.update")]
    WorkspaceUpdate,
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

/// DD-42、06 §7.1：源 Tenant 的 ExportPackage Asset。只给当前对该 Asset 有 read 的 HUMAN；READY 后才有
/// digest、大小与下载路径。字节只经下载路由返回，不进入本视图、审计或 Workflow 历史。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPackageView {
    pub action_execution_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_size: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_digest: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_path: Option<String>,

    /// 原版文件名：`<显示名>.agent.json` 或 `.agent.png`；团队为 `.team.*`。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,

    pub format_key: String,

    pub media_type: String,

    pub package_asset_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_asset_id: Option<String>,

    pub source_resource_id: String,

    pub state: ExportPackageState,
}

/// 03 §3 ExportPackage 的状态：只有 READY 可下载；ERROR 是确定失败，DELETED 是 Tenant 销毁后的墓碑。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ExportPackageState {
    #[serde(rename = "CREATING")]
    Creating,

    #[serde(rename = "DELETED")]
    Deleted,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "READY")]
    Ready,

    #[serde(rename = "REVOKED")]
    Revoked,
}

/// DD-158(2): authenticated operator attachment read with encoding=base64 for native JSON
/// transport; same audited bytes as the binary response, nosniff.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAttachmentContent {
    pub data_base64: String,

    pub mime_type: String,

    pub sha256: String,
}

/// DD-158(1)：反馈已记入 Core 的回执；同键重放返回同一回执。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSubmissionReceipt {
    pub created_at: String,

    pub feedback_id: String,
}

/// DD-158(1)：POST /api/v1/feedback。ACTIVE Tenant 成员的 HUMAN 会话提交给部署运营方的私有反馈；不是 Governed
/// Action。idempotencyKey 由客户端在首次发送前冻结，同一本人同键重放返回原回执、同键异内容 409。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackSubmissionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment: Option<FeedbackAttachmentUpload>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<FeedbackCategory>,

    pub client: FeedbackClient,

    /// 本人在提交前预览并同意附带的固定诊断字段（应用版本、平台、User-Agent、语言、采集时间），≤4096 字节
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<String>,

    pub idempotency_key: String,

    /// 去首尾空白后 1–4000 字符
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAttachmentUpload {
    /// 标准 base64，解码后 ≤2 MiB
    pub data_base64: String,

    /// image/png、image/jpeg 或 image/webp；Core 另按文件头复核
    pub mime_type: String,
}

/// DD-158(1)：原版“发送反馈”的类别（Bug、Praise、Needs work）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FeedbackCategory {
    Bug,

    #[serde(rename = "NEEDS_WORK")]
    NeedsWork,

    Praise,
}

/// DD-158(1)：提交反馈的客户端，只用于运营方分拣。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FeedbackClient {
    #[serde(rename = "DESKTOP")]
    Desktop,

    #[serde(rename = "MOBILE")]
    Mobile,

    #[serde(rename = "WEB")]
    Web,
}

/// PUT /api/v1/user-state/followed-principals 的请求体（DD-125(5)、03
/// CollaborationUserState.followed_principals）：原 Pulse 关注/取消关注，取代逐公钥 kind 3。pubkey 是被关注者的任一
/// Buzz 公钥，Core 解析为同 Tenant 的 HUMAN Principal 并按 Principal 存储；关注要求该公钥当前
/// ACTIVE，取消关注也接受其已撤销的历史公钥。读取时按被关注 Principal 的全部 ACTIVE 公钥展开。version 不符即 409。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FollowedPrincipalRequest {
    pub followed: bool,

    pub pubkey: String,

    pub version: i64,
}

/// DD-134(2)：本会话在网关管理区可用的分区。只决定入口与按钮是否呈现；每个查询与动作仍在 BFF fresh 授权，前端隐藏不构成授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayAccess {
    /// TENANT 范围：application_binding.create 的准入预评估（Tenant manage）。
    pub can_bind_mcp: bool,

    /// llm_route.create 的准入预评估（Tenant create）。
    pub can_create_model_route: bool,

    /// PLATFORM 范围：active HUMAN 且 Catalog Tenant manage（交付目录读取、受控探测、契约与 release 登记批准）。
    pub can_manage_mcp: bool,

    /// PLATFORM 范围：Catalog Tenant audit。
    pub can_read_config: bool,

    /// TENANT 范围：Tenant discover。PLATFORM 范围恒为 false（平台只在实时配置中看到 route 的 Gateway 投影）。
    pub can_read_model_routes: bool,

    /// PLATFORM：Catalog Tenant audit；TENANT：Tenant audit（Workspace audit 只在选择该 Workspace 时生效）。
    pub can_read_stats: bool,

    /// TENANT 范围：Tenant discover。PLATFORM 范围恒为 false。
    pub can_read_tools: bool,

    pub scope: GatewayAdminScope,

    pub tenant_id: String,
}

/// DD-134(2)：网关管理区的范围取会话 Tenant。PLATFORM：Platform Catalog Tenant 会话，只见 Gateway 原生事实与 Tenant
/// 归属 ID；TENANT：业务 Tenant 会话，按 Tenant/Workspace audit 下钻本 Tenant 的业务关联。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum GatewayAdminScope {
    #[serde(rename = "PLATFORM")]
    Platform,

    #[serde(rename = "TENANT")]
    Tenant,
}

/// DD-134(3)⑤：单次调用下钻。TENANT 范围关联 ActionExecution 与同 operation 的 AuditEvent；PLATFORM 范围只有
/// call。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCallDetail {
    pub audit_events: Vec<GatewayCallAuditEvent>,

    pub call: GatewayCallView,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution: Option<GatewayCallExecution>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCallAuditEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_execution_id: Option<String>,

    pub action_key: String,

    pub decision: String,

    pub event_id: String,

    pub event_type: AuditEventType,

    pub occurred_at: String,

    pub result_code: String,
}

/// DD-134(3)⑤：一次模型或工具调用的元数据。不含 prompt 预览、turn、payload、工具参数或结果正文。PLATFORM 范围只填 Gateway 原生字段与
/// tenantId。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCallView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_execution_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_installation_resource_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_binding_id: Option<String>,

    /// MODEL 为 request log ID 前缀 model:，TOOL 为 ActionExecution ID 前缀 tool:。
    pub call_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_tokens: Option<i64>,

    pub kind: GatewayCallKind,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    /// Gateway 上的模型路由名（request log 的请求模型）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_route_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_route_resource_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,

    pub outcome: GatewayCallOutcome,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_tokens: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_log_id: Option<String>,

    pub started_at: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_resource_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_source: Option<AgentInstallationToolSource>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage_state: Option<OperationUsageState>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// DD-134(3)：MODEL 取 Gateway request log（时延为 Gateway durationMs）；TOOL 取 Core 工具子
/// ActionExecution 与审计（时延为 Core 观测的 INTENT 到 OUTCOME 间隔）。两者时延不混算。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum GatewayCallKind {
    #[serde(rename = "MODEL")]
    Model,

    #[serde(rename = "TOOL")]
    Tool,
}

/// DD-134(3)：一次调用的呈现状态。DENIED 是准入拒绝（含 PEP 拒绝）；UNKNOWN 是结果不明、待原 operation 对账；RUNNING 是已准入未终结。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum GatewayCallOutcome {
    #[serde(rename = "DENIED")]
    Denied,

    #[serde(rename = "FAILED")]
    Failed,

    #[serde(rename = "RUNNING")]
    Running,

    #[serde(rename = "SUCCEEDED")]
    Succeeded,

    #[serde(rename = "UNKNOWN")]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCallExecution {
    pub action_execution_id: String,

    pub action_key: String,

    pub action_version: i64,

    pub created_at: String,

    pub dispatch_state: ActionDispatchState,

    pub gate_state: ActionGateState,

    pub operation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_action_execution_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// DD-134(3)：时间窗内的调用列表，按开始时间倒序；nextCursor 只在同一查询条件内继续。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayCallPage {
    pub calls: Vec<GatewayCallView>,

    pub model_log_available: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,

    pub scope: GatewayAdminScope,

    pub truncated: bool,
}

/// DD-134(3)⑥：一个 ConfigResource 的 Core 写入证据（打码后的值）与相邻已记录 revision 之间的差异；当前 revision 没有证据时
/// currentSource=UNRECORDED。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfigHistory {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_revision: Option<i64>,

    pub current_source: GatewayConfigRevisionSource,

    pub id: String,

    pub kind: String,

    pub revisions: Vec<GatewayConfigRevisionView>,
}

/// DD-134(3)⑥：CORE_RECORDED 表示 Core 写入并回读确认时保存了该 revision 的写入证据；UNRECORDED 表示外部写入或早于写入证据，按
/// 17 §9 作为投影不一致信号，不反向导入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GatewayConfigRevisionSource {
    #[serde(rename = "CORE_RECORDED")]
    CoreRecorded,

    Unrecorded,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfigRevisionView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_execution_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_key: Option<String>,

    pub changes: Vec<GatewayConfigChange>,

    pub deleted: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,

    pub recorded_at: String,

    pub revision: i64,

    pub value_digest: String,

    pub value_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfigChange {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_json: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub before_json: Option<String>,

    pub change: GatewayConfigChangeKind,

    /// RFC 6901 JSON pointer。
    pub path: String,
}

/// DD-134(3)⑥：打码后的值在相邻两个已记录 revision 之间按 JSON 路径的差异。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum GatewayConfigChangeKind {
    #[serde(rename = "ADDED")]
    Added,

    #[serde(rename = "CHANGED")]
    Changed,

    #[serde(rename = "REMOVED")]
    Removed,
}

/// DD-134(3)⑥(4)：Gateway effective config 与 ConfigResource 当前值，均已在 Core 打码；只读。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfigView {
    pub effective_config_json: String,

    pub read_at: String,

    pub resources: Vec<GatewayConfigResourceView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayConfigResourceView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_execution_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub action_key: Option<String>,

    pub id: String,

    pub kind: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub operation_id: Option<String>,

    pub revision: i64,

    pub source: GatewayConfigRevisionSource,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,

    pub value_json: String,
}

/// DD-134(5)⑥：需由运维加入交付目录 protocolPeers[].bindings 的条目（不含 secret）；Core 回读到同 bindingId 的条目后才放行
/// application_binding.create。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpBindingDraft {
    pub adapter_service_ref: String,

    pub binding_id: String,

    pub config_digest: String,

    pub directory_entry_json: String,

    pub service_principal_id: String,
}

/// DD-134(5)⑥：为尚无交付归属事实的连接生成目录条目草稿；纯计算，不写任何状态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpBindingDraftRequest {
    pub component_release_id: String,

    pub isolation_mode: ApplicationIsolationMode,

    pub native_scope_ref: String,

    pub normalized_config_json: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// DD-134(5)①：部署交付目录的 protocolPeers 与一致性环境（只读，Catalog manage）。URL 已去掉 userinfo、query 与
/// fragment。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpPeerPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conformance_artifact_digest: Option<String>,

    pub directory_available: bool,

    pub peers: Vec<GatewayMcpPeerView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpPeerView {
    pub adapter_service_ref: String,

    pub artifact_digest: String,

    pub binding_facts: Vec<GatewayMcpBindingFact>,

    /// 部署一致性环境存在且其 artifactDigest 等于本条目。
    pub conformance_ready: bool,

    pub max_response_bytes: i64,

    pub mcp_url: String,

    pub native_instance_ref: String,

    pub timeout_seconds: i64,
}

/// DD-98/134(5)⑥：交付目录中一条 binding 归属事实（运维域），不是授权；不含 secret。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpBindingFact {
    pub binding_id: String,

    /// 已有同 ID 的 ApplicationBinding。
    pub bound: bool,

    pub config_digest: String,

    pub credential_keys: Vec<String>,

    pub isolation_mode: ApplicationIsolationMode,

    pub native_scope_ref: String,

    pub service_principal_id: String,

    pub tenant_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// DD-134(5)②：受控探测只接受交付目录条目引用，不接受 URL。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpProbeRequest {
    pub adapter_service_ref: String,
}

/// DD-134(5)②：经 Gateway 临时验证 route 的 initialize 与 tools/list 结果（route
/// 已删除并回读不存在）。matchingContracts 为输入 schema 摘要一致的 ACTIVE 契约 TOOL 键，并带该契约生成 PROTOCOL_PEER
/// release 草稿所需的 Catalog 元数据（DD-134(5)③④），不含 schema 正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpProbeResult {
    pub adapter_service_ref: String,

    pub probed_at: String,

    pub probe_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_version: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,

    pub tools: Vec<GatewayMcpProbedTool>,

    pub tool_schema_digest: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpProbedTool {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_title: Option<String>,

    pub input_schema_digest: String,

    pub input_schema_json: String,

    pub matching_contracts: Vec<GatewayMcpContractMatch>,

    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema_digest: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema_json: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only_hint: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpContractMatch {
    pub category_key: String,

    pub contract_key: String,

    pub contract_version: i64,

    /// 该 ACTIVE 契约的全部 operation 契约键；release 须为每个键登记动作与工具。
    pub operation_contract_keys: Vec<String>,

    /// 该 TOOL 契约键在 ACTIVE 契约中的输出 schema 摘要；release 的动作与工具逐字采用。
    pub output_schema_digest: String,

    pub permission: CapabilityPermission,

    /// 该 ACTIVE 契约 resourceTypeFamily 的全部 typeKey；release 须逐一登记。
    pub resource_type_keys: Vec<String>,

    /// 该 TOOL 契约键在 ACTIVE 契约中的 targetType。
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

/// DD-134(5)⑥：业务 Tenant 可建立连接的已批准 PROTOCOL_PEER release 与本 Tenant 的交付归属事实（Tenant manage）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayMcpReleasePage {
    pub releases: Vec<GatewayMcpReleaseView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpReleaseView {
    pub adapter_build_ref: String,

    /// 交付目录中 artifactDigest 等于 adapterBuildRef 的 peer；没有时省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_service_ref: Option<String>,

    pub allowed_model_call_modes: Vec<ApplicationModelCallMode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding_config_schema_json: Option<String>,

    pub binding_ids: Vec<String>,

    pub capability_categories: Vec<GatewayMcpReleaseCategory>,

    pub component_release_id: String,

    pub component_type_key: String,

    pub delivery_facts: Vec<GatewayMcpBindingFact>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_instance_ref: Option<String>,

    /// DD-155(3)：release 所选能力类别任一声明 tenantDelete=RETAIN_ON_TENANT_DELETE 即为
    /// true；建立连接的保留选项取此值，Core 要求一致。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retain_on_tenant_delete: Option<bool>,

    pub secret_keys: Vec<String>,

    pub status: ComponentReleaseStatus,

    pub tools: Vec<GatewayMcpReleaseTool>,

    pub version: String,
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
pub struct GatewayMcpReleaseCategory {
    pub category: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayMcpReleaseTool {
    pub action_key: String,

    pub capability_contract_key: String,

    pub name: String,
}

/// DD-134(7)：本 Tenant 的 llm_route Resource（按 discover 过滤）与时间窗用量；新建沿 llm_route.create，停用沿
/// llm_route.disable。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayModelRoutePage {
    pub can_create: bool,

    pub from: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub routes: Vec<GatewayModelRouteView>,

    pub to: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayModelRouteView {
    pub binding_count: i64,

    pub can_disable: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub home_workspace_id: Option<String>,

    pub installation_count: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_p95_ms: Option<i64>,

    pub native_id: String,

    pub owner_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests: Option<i64>,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<i64>,
}

/// DD-134(7)：Gateway 中已存在、尚未被 llm_route 引用的原生 provider 与 model ConfigResource（打码），供
/// llm_route.create 选择；revision 与 sha256 为 Core 回读值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayModelSourcePage {
    pub sources: Vec<GatewayModelSource>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayModelSource {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_required: Option<bool>,

    pub model: ModelClass,

    pub model_name: String,

    pub provider: ProviderClass,

    pub provider_type: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelClass {
    pub id: String,

    pub revision: i64,

    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderClass {
    pub id: String,

    pub revision: i64,

    pub sha256: String,
}

/// DD-134(3)：时间窗内按一个维度的聚合与时间桶。每次请求实时计算；扫描原始记录超出上限时 truncated=true，结果只基于已扫描部分。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStats {
    pub buckets: Vec<GatewayStatsBucket>,

    pub bucket_seconds: i64,

    pub dimension: GatewayStatsDimension,

    pub from: String,

    /// Gateway request log 是否可读；false 时模型调用计数缺失，不显示为零。
    pub model_log_available: bool,

    pub rows: Vec<GatewayStatsRow>,

    pub scope: GatewayAdminScope,

    pub to: String,

    pub totals: GatewayStatsCounters,

    pub truncated: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatsBucket {
    pub denied: i64,

    pub failed: i64,

    pub requests: i64,

    pub start: String,

    pub total_tokens: i64,
}

/// DD-134(3)④：聚合维度。TOOL、AGENT、BINDING 只在 TENANT 范围可用；TENANT 只在 PLATFORM 范围可用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GatewayStatsDimension {
    Agent,

    Binding,

    #[serde(rename = "MODEL_ROUTE")]
    ModelRoute,

    Tenant,

    Tool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GatewayStatsRow {
    pub counters: GatewayStatsCounters,

    /// 维度键：llm_route Resource ID 或 Gateway route 名、Tool Resource ID、Installation Resource
    /// ID、binding ID 或 Tenant ID；UNATTRIBUTED 为无法归属的记录。
    pub key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<GatewayCallKind>,

    /// 受权的展示名（工具名、Agent 名、模型名）；平台范围不含业务名称。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// DD-134(3)④：计数与分位数。错误率由呈现层按 failed/requests 计算；模型与工具时延分列，不混算。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayStatsCounters {
    /// 模型调用：Gateway 日志已有而没有 durable UsageEvent 或已记 BILLING_UNAVAILABLE 审计的次数（14 §8）。
    pub billing_unavailable: i64,

    pub denied: i64,

    pub failed: i64,

    pub input_tokens: i64,

    /// 模型调用 Gateway durationMs 的 P50；没有模型调用时省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_p50_ms: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_p95_ms: Option<i64>,

    pub output_tokens: i64,

    pub requests: i64,

    pub running: i64,

    pub succeeded: i64,

    /// 工具调用 Core 观测时延（INTENT 到 OUTCOME）的 P50；没有已终结工具调用时省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_p50_ms: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_p95_ms: Option<i64>,

    pub total_tokens: i64,

    pub unknown: i64,
}

/// DD-134(6)：本 Tenant 的 PLATFORM_NATIVE 与 APPLICATION 工具（按 Tool Resource discover
/// 过滤），附时间窗内调用统计。停用只作用于所属连接；PLATFORM_NATIVE 无启停入口。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayToolPage {
    pub from: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub to: String,

    pub tools: Vec<GatewayToolView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayToolView {
    pub action_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_binding_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_binding_version: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding_state: Option<ApplicationBindingState>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding_workspace_id: Option<String>,

    pub can_disable_binding: bool,

    /// 契约 permission 为 discover、consume 或 read，且存在本人可作用的 ACTIVE 目标 Resource 与有效结果策略；最终准入仍在提交时
    /// fresh 重做。
    pub can_test_call: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_contract_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_release_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_type_key: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract_permission: Option<CapabilityPermission>,

    pub denied: i64,

    pub failed: i64,

    /// 仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_connection_id: Option<String>,

    /// 仅 USER_REGISTERED_EXTERNAL：连接器显示名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_connection_name: Option<String>,

    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub release_version: Option<String>,

    pub requests: i64,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub source: AgentInstallationToolSource,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub test_call: Option<GatewayToolTestCall>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_p95_ms: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayToolTestCall {
    pub action_key: String,

    pub action_version: i64,

    /// 契约固定的输入 schema（canonical JSON）。
    pub input_schema_json: String,

    pub result_exposure_policy_id: String,

    pub result_exposure_policy_version: i64,

    pub targets: Vec<GatewayToolTestTarget>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayToolTestTarget {
    pub display_name: String,

    pub resource_id: String,

    pub resource_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// DD-134(6)：网关管理区测试调用的同请求回应。submission 是该工具 ActionDefinition 的准入与派发结论；resultJson
/// 只在本次调用已确定成功时出现，是经 ExtMcp 按冻结 ResultExposurePolicy 与输出 schema 过滤后的 canonical
/// JSON，只回给发起人本人且 Core 不保存；toolError 为真表示原生工具返回了错误结果（不含正文）。结果不明时两者都缺省，ActionExecution 停在
/// UNKNOWN，不重放。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayToolTestCallResult {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_json: Option<String>,

    pub submission: ActionSubmission,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_error: Option<bool>,
}

/// POST /api/v1/actions 的回应：本次 operation 的门禁与调度状态。gateState=WAITING 时 approvalWorkflowId
/// 必有；DENIED 时 reason 必有。invitation 只在 tenant.member.invite
/// 的首次回应中出现，同一幂等键的重放不再给出（DD-83）。webhookSecret 同理，只在生成或轮换 WEBHOOK 密钥的 automation.enable /
/// automation.rotate_webhook_secret 首次回应中出现（DD-116）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionSubmission {
    pub action_execution_id: String,

    pub action_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    pub dispatch_state: ActionDispatchState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_launch: Option<DocumentLaunchDescriptor>,

    pub gate_state: ActionGateState,

    /// 仅 huddle.start（DD-125(3)）：Core 预分配的 HuddleBuzzBinding；同一幂等键的重放给出同一值
    #[serde(skip_serializing_if = "Option::is_none")]
    pub huddle_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation: Option<IssuedInvitation>,

    pub operation_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_session_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub webhook_secret: Option<AutomationWebhookSecret>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workflow_id: Option<String>,
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

/// DD-116：WEBHOOK 触发密钥的唯一一次明文交付。只出现在生成或轮换该密钥的那次 ActionSubmission 中；之后只给出
/// AutomationView.webhookSecretHint。投递方用它按 Standard Webhooks 对
/// `{webhook-id}.{webhook-timestamp}.{正文}` 计算 HMAC-SHA256。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationWebhookSecret {
    pub automation_resource_id: String,

    pub hint: String,

    /// 32 字节随机密钥的 base64 展示形式。
    pub secret: String,

    /// 公开投递地址；部署未配置公开基址时省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
}

/// POST /api/v1/huddles/{huddleId}/announcement（仅 Web 创建者，DD-125(3)）：BFF 以本人 SERVER 身份为
/// ACTIVE 的 Huddle 各签一次 48106（临时频道，原 voice_mode_guidelines 正文）与 48100（父频道，content 为
/// ephemeral_channel_id），签名事件随绑定持久化，重试只重投同一事件、不重签（DD-81）。48106 按原版尽力发布，48100 是必需的发现链接。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HuddleAnnouncementView {
    /// 48106 事件 ID；尽力发布
    #[serde(skip_serializing_if = "Option::is_none")]
    pub guidelines_event_id: Option<String>,

    /// Relay 已接受或回读到 48100
    pub started_delivered: bool,

    /// 48100 事件 ID
    pub started_event_id: String,
}

/// GET /api/v1/huddles/{huddleId}/lifecycle：该 Huddle 在父频道中的生命周期事件（按 created_at 升序）与 Relay
/// 合成的存活（48104，房间非空才为 true），供原 huddlePresence 重建参与者与卡片状态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HuddleLifecyclePage {
    pub events: Vec<HuddleLifecycleEvent>,

    /// Relay 48104 存活查询是否返回该会话
    pub live: bool,
}

/// 父频道中一条原版 Huddle 生命周期事件（kind 48100–48103，SF-BUZ-53），由 BFF 以本人身份读取并校验签名：48100
/// 只取临时频道创建者签名，48101/48102 只取 Relay 签名，48103 取创建者或 Relay 签名。content 按原 JSON 解析为下列字段，未知字段丢弃。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HuddleLifecycleEvent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub admission_id: Option<String>,

    /// 事件 created_at（Unix 秒）
    pub created_at: i64,

    pub ephemeral_channel_id: String,

    pub event_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub generation: Option<String>,

    pub kind: i64,

    /// 48101/48102 的 p 标签
    #[serde(skip_serializing_if = "Option::is_none")]
    pub participant_pubkey: Option<String>,

    /// 签名者公钥
    pub pubkey: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub roster_revision: Option<i64>,
}

/// GET /api/v1/huddles：一个父 Workspace 或父私聊中本人可见、尚未结束的 Huddle（PROVISIONING 或 ACTIVE），按创建时间倒序。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HuddlePage {
    pub items: Vec<HuddleView>,
}

/// 本人可见的一个原版 Huddle 临时频道投影（HuddleBuzzBinding，DD-125(3)）。只含平台引用与状态，不含音频、参与者音频状态或消息正文；参与者与存活由
/// Relay 的 48101–48104 呈现。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HuddleView {
    pub agent_installation_resource_ids: Vec<String>,

    /// Core 预分配的临时 Channel UUID（原 ephemeral_channel_id）
    pub channel_id: String,

    pub channel_name: String,

    pub created_at: String,

    /// 临时频道 created_by：本人发起会话的 HUMAN 公钥
    pub creator_pubkey: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,

    pub huddle_id: String,

    pub initiator_principal_id: String,

    /// 发起该 Huddle 的 huddle.start operation
    pub operation_id: String,

    pub parent_channel_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_conversation_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_workspace_id: Option<String>,

    pub state: HuddleState,

    pub version: i64,
}

/// HuddleBuzzBinding 状态（03 §2、DD-125(3)）：PROVISIONING 为 CONTROL 9007/9000 投影尚未回读一致（结果不明保留并按
/// Channel UUID 对账）；ACTIVE 为投影回读一致；ENDED 为观察到 48103 或临时频道已归档，终态、不复用；ERROR 为 Relay
/// 确定拒绝投影，不再签发。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum HuddleState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "ENDED")]
    Ended,

    #[serde(rename = "ERROR")]
    Error,

    #[serde(rename = "PROVISIONING")]
    Provisioning,
}

/// GET /api/v1/huddles/voice：Web Huddle
/// 的转写与朗读是否可用（DD-125(3)、V-SCN-160）。不可用时通话、加入、发言、收听与离开不受影响。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HuddleVoiceView {
    pub speech: HuddleVoiceAvailability,

    pub transcription: HuddleVoiceAvailability,
}

/// Web Huddle 转写或朗读的可用性（DD-125(3)、V-SCN-160）：UNAVAILABLE 为 Huddle
/// 语音推理服务未部署、超出部署登记的并发上界或不可用，此时按原版“仅语音模式”显示不可用而通话照常。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum HuddleVoiceAvailability {
    #[serde(rename = "AVAILABLE")]
    Available,

    #[serde(rename = "UNAVAILABLE")]
    Unavailable,
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
    pub kind: LegacySecretRefBindingKind,

    pub principal_id: String,

    pub pubkey: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum LegacySecretRefBindingKind {
    #[serde(rename = "CONTROL")]
    Control,

    #[serde(rename = "HUMAN")]
    Human,
}

/// DD-149(10)：本人可发现的连接器与登记能力。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionPage {
    pub can_register_personal: bool,

    pub can_register_tenant: bool,

    pub connections: Vec<McpConnectionView>,

    pub policy: McpConnectionPolicyView,

    pub registrable_workspace_ids: Vec<String>,
}

/// DD-149(10)：连接器详情；凭据只以 credentialSet 表示，从不回显。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_header: Option<String>,

    pub auth_mode: McpConnectionAuthMode,

    pub can_manage: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,

    pub credential_set: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_updated_at: Option<String>,

    pub display_name: String,

    /// 最近一次探测的清单摘要与已确认的不同
    pub drift: bool,

    pub endpoint_host: String,

    pub endpoint_url: String,

    pub generation: i64,

    pub health: McpConnectionHealth,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub health_checked_at: Option<String>,

    pub id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_tools_digest: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_display_name: Option<String>,

    pub owner_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,

    pub slug: String,

    pub state: McpConnectionState,

    pub tools: Vec<McpConnectionToolView>,

    pub tools_digest: String,

    pub transport: McpConnectionTransport,

    pub version: i64,

    pub visibility: McpConnectionVisibility,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// DD-149(5)(6)：连接器认证方式。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpConnectionAuthMode {
    #[serde(rename = "API_KEY")]
    ApiKey,

    Bearer,

    None,

    Oauth,
}

/// DD-149(10)：最近一次探测观测；不是授权或状态权威。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpConnectionHealth {
    #[serde(rename = "AUTH_FAILED")]
    AuthFailed,

    #[serde(rename = "EGRESS_DENIED")]
    EgressDenied,

    Ok,

    #[serde(rename = "PROTOCOL_ERROR")]
    ProtocolError,

    #[serde(rename = "REAUTHORIZATION_REQUIRED")]
    ReauthorizationRequired,

    Unchecked,

    Unreachable,
}

/// DD-149(3)：连接器状态；DELETED 是墓碑。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum McpConnectionState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DELETED")]
    Deleted,

    #[serde(rename = "DISABLED")]
    Disabled,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionToolView {
    pub call_policy: McpToolCallPolicy,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive_hint: Option<bool>,

    pub input_schema_json: String,

    /// Agent 看到的工具名 <slug>__<上游名>
    pub name: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only_hint: Option<bool>,

    pub risk: McpToolRisk,

    pub risk_declared: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    pub tool_resource_id: String,

    pub upstream_name: String,
}

/// DD-149(7)：工具调用策略。AUTO 只允许 READ_ONLY；CONFIRM 由 Agent 负责人逐次确认；APPROVAL 由 Tenant 管理员逐次批准。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum McpToolCallPolicy {
    #[serde(rename = "APPROVAL")]
    Approval,

    #[serde(rename = "AUTO")]
    Auto,

    #[serde(rename = "CONFIRM")]
    Confirm,
}

/// DD-149(7)：工具风险等级（annotations 只是提示，最终为管理员确认值）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpToolRisk {
    Destructive,

    #[serde(rename = "READ_ONLY")]
    ReadOnly,

    Write,
}

/// DD-149(7)：连接器端点的 MCP 传输。STREAMABLE_HTTP 为现行 Streamable HTTP；SSE 为旧版 HTTP+SSE。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpConnectionTransport {
    Sse,

    #[serde(rename = "STREAMABLE_HTTP")]
    StreamableHttp,
}

/// DD-149(4)：连接器与其工具的可见范围。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum McpConnectionVisibility {
    #[serde(rename = "PERSONAL")]
    Personal,

    #[serde(rename = "TENANT")]
    Tenant,

    #[serde(rename = "WORKSPACE")]
    Workspace,
}

/// DD-149(4)(5)：Tenant 连接器策略与部署出站上限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionPolicyView {
    pub can_manage: bool,

    pub egress_host_suffixes: Vec<String>,

    pub member_registration: McpMemberRegistration,

    pub platform_any_public_host: bool,

    pub platform_host_suffixes: Vec<String>,

    pub version: i64,
}

/// DD-149(4)：Tenant 连接器策略中普通成员的登记权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum McpMemberRegistration {
    Disabled,

    #[serde(rename = "PERSONAL_ONLY")]
    PersonalOnly,
}

/// DD-149(7)：添加连接器前的只读探测。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionProbeRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_header: Option<String>,

    pub auth_mode: McpConnectionAuthMode,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<McpConnectionCredentialInput>,

    pub endpoint_url: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_attempt_id: Option<String>,

    pub transport: McpConnectionTransport,
}

/// DD-149(5)：仅 mcp_connection.create 与 mcp_connection.rotate_credential 的瞬态凭据（API_KEY 或
/// BEARER）；Core 写入该 Tenant 的 OpenBao 后只保存 SecretRef，值不进入
/// parameters、ActionExecution、日志、审计或回应。其他命令禁止携带。
///
/// DD-149(5)：API Key 或 Bearer 的一次性输入，只随
/// mcp_connection.create、mcp_connection.rotate_credential 与探测请求；Core 写入 OpenBao 后只保存
/// SecretRef，从不回显、记录或进入 parameters。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct McpConnectionCredentialInput {
    pub value: String,
}

/// DD-149(10)：以已保存凭据重新探测；变化需经 mcp_connection.update 重新确认。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionRefreshResult {
    pub added_tools: Vec<String>,

    pub changed_tools: Vec<String>,

    pub checked_at: String,

    pub drift: bool,

    pub health: McpConnectionHealth,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub probe: Option<McpConnectionProbeResult>,

    pub removed_tools: Vec<String>,
}

/// DD-149(7)：探测结果。toolsDigest 是规范化清单摘要，登记与更新以它比对 fresh 探测。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionProbeResult {
    pub endpoint_host: String,

    /// 上游 instructions（不可信内容，截断至 2000 字符）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,

    pub protocol_version: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_version: Option<String>,

    pub tools: Vec<McpProbedTool>,

    pub tools_digest: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpProbedTool {
    /// 上游描述（不可信内容，界面以纯文本显示）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive_hint: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotent_hint: Option<bool>,

    pub input_schema_json: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_world_hint: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema_json: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only_hint: Option<bool>,

    pub suggested_call_policy: McpToolCallPolicy,

    pub suggested_risk: McpToolRisk,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    pub upstream_name: String,
}

/// DD-149(6)：OAuth 授权尝试的状态；从不包含令牌。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOauthAttemptView {
    pub attempt_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_server: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorization_url: Option<String>,

    pub expires_at: String,

    /// 固定原因码
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,

    pub state: McpOauthAttemptState,
}

/// DD-149(6)：一次 OAuth 授权尝试的状态。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum McpOauthAttemptState {
    #[serde(rename = "COMPLETED")]
    Completed,

    #[serde(rename = "CONSUMED")]
    Consumed,

    #[serde(rename = "EXPIRED")]
    Expired,

    #[serde(rename = "FAILED")]
    Failed,

    #[serde(rename = "PENDING")]
    Pending,
}

/// DD-149(6)：发起一次 OAuth 授权尝试。forConnectionId 只用于轮换已存在连接器的授权。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpOauthStartRequest {
    /// 未提供注册端点时的预注册 client ID
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,

    /// 可选预注册 client 密钥，一次性输入，写入 OpenBao
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,

    pub endpoint_url: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub for_connection_id: Option<String>,

    pub transport: McpConnectionTransport,
}

/// GET /api/v1/moderation/access（DD-125(2)）：原版只对 Community owner/admin 显示的审核入口在 Kailo 对应
/// Tenant manage。canModerate 是与 moderation.ban 准入同一条 fresh 判定（目录开放、非 Platform Catalog、scope
/// guard 与 tenant manage）的提示，不是授权票据，提交时仍完整重新准入；它不读取任何限制或队列事实。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationAccessView {
    pub can_moderate: bool,
}

/// GET /api/v1/moderation/audit（DD-125(2)）：Relay moderation_actions（审核日志）是唯一权威，Core 以 Tenant
/// CONTROL 经 NIP-98 读取 /moderation/audit，只回给 fresh Tenant manage 的请求者，每次读取写 ACCESS
/// 审计，不复制。单次至多 500 行，按时间倒序。CONTROL 签发的执法行其 actorPubkey 是 CONTROL；发起人与准入记录在 Core 的
/// ActionExecution 与 AuditEvent。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModerationAuditPage {
    pub items: Vec<ModerationAuditView>,

    /// Relay 返回已达单次读取上界（500 行）
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationAuditView {
    /// Relay 审核日志词表（ban、unban、timeout、untimeout、resolve:<action>、dismiss_report、escalate 等），原样呈现
    pub action: String,

    pub actor_pubkey: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,

    /// RFC3339
    pub created_at: String,

    pub id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_reason: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_event_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_pubkey: Option<String>,
}

/// GET /api/v1/moderation/reports[?status=open]（DD-125(2)、V-SCN-130）：Relay
/// moderation_reports 是唯一权威，Core 以 Tenant CONTROL 经 NIP-98 读取 /moderation/reports，只回给 fresh
/// Tenant manage 的请求者，每次读取写 ACCESS 审计，Core 不复制。单次至多 500 行（Relay 上界），按创建时间倒序。reporterPubkey
/// 只出现在此审核面，不得进入被举报人可见的任何视图。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModerationReportPage {
    pub items: Vec<ModerationReportView>,

    /// Relay 返回已达单次读取上界（500 行），更早的行未包含
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationReportView {
    /// 事件目标所在 Relay Channel；其余目标缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,

    /// RFC3339
    pub created_at: String,

    /// Relay 举报行 ID
    pub id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,

    pub reporter_pubkey: String,

    /// 签名的 kind 1984 事件 ID；9044 以它定位举报
    pub report_event_id: String,

    pub report_type: ModerationReportType,

    /// RFC3339
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_by_pubkey: Option<String>,

    pub status: ModerationReportStatus,

    /// 事件 ID、公钥或附件 SHA-256（十六进制）
    pub target: String,

    /// 事件目标由 CONTROL 回读得到的签名者；pubkey 目标即其本身；不可读时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_author_pubkey: Option<String>,

    pub target_kind: ModerationReportTargetKind,

    /// targetAuthorPubkey 属于本 Tenant 某 HUMAN Principal 时给出；AGENT 或未知公钥缺省（不提供封禁与踢出）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_principal_id: Option<String>,

    /// channelId 对应本 Tenant 的 Workspace 时给出，供 moderation.message.delete 与
    /// workspace.member.revoke 定位
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// 原 Buzz NIP-56 举报类型（buzz-relay handlers/report.rs::REPORT_TYPES，SF-BUZ-52）。线格式即 kind 1984
/// 目标标签第三元素，Relay 只接受这七个值（DD-125(2)）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationReportType {
    Illegal,

    Impersonation,

    Malware,

    Nudity,

    Other,

    Profanity,

    Spam,
}

/// Relay moderation_reports.status（buzz migrations/0006_moderation.sql 的 CHECK
/// 词表，SF-BUZ-52）。open 是唯一可处理状态；Relay 举报表是唯一权威，Core 不复制（DD-125(2)）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationReportStatus {
    Dismissed,

    Escalated,

    Open,

    Resolved,
}

/// 举报目标类别（Relay report_json.target_kind）：event 为消息事件、pubkey 为成员、blob 为附件（SF-BUZ-52）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationReportTargetKind {
    Blob,

    Event,

    Pubkey,
}

/// GET /api/v1/moderation/restricted（DD-125(2)、V-SCN-127）：Relay community_bans
/// 中当前有效的封禁与禁言，是唯一权威；Core 以 Tenant CONTROL 经 NIP-98 读取 /moderation/restricted，只回给 fresh
/// Tenant manage 的请求者，每次读取写 ACCESS 审计，不复制。成员与原版一样读不到自己的限制。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModerationRestrictionPage {
    pub items: Vec<ModerationRestrictionView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationRestrictionView {
    /// RFC3339；永久封禁缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ban_expires_at: Option<String>,

    pub banned: bool,

    /// RFC3339；未禁言缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub muted_until: Option<String>,

    /// 该公钥属于本 Tenant 某 HUMAN Principal 时给出
    #[serde(skip_serializing_if = "Option::is_none")]
    pub principal_id: Option<String>,

    pub pubkey: String,

    /// RFC3339
    pub updated_at: String,
}

/// GET /api/v1/native/community 的回应，只对原生入口开放（DD-75/78）。relayUrl 的 authority 就是
/// communityHost：Relay 按连接的 Host 绑定 Community，非默认端口属于 host（SF-BUZ-32、SF-BUZ-41）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCommunityFacts {
    /// 该 Tenant 的 Community host，可能带非默认端口
    pub community_host: String,

    /// 读取上述部署事实时 Core 的 Unix 秒时刻；Native 仅以本次可信读的时刻判断原签事件是否严格超过窗口，不信任 Webview now 或设备跳钟。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish_result_observed_at_unix_seconds: Option<i64>,

    /// DD-81：与 Core 发布对账器同源的 PUBLISH_RESULT_SETTLE_SECONDS 部署事实，必须为正且不小于 Relay 时间漂移窗口；缺失时不得猜测未送达。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish_result_settle_seconds: Option<i64>,

    /// 当前固定 Relay NIP-11 的 max_limit；旧客户端忽略，新 Pulse 消费者缺失时不猜测上限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub relay_query_limit: Option<i64>,

    /// 原生端直连的 Relay 地址
    pub relay_url: String,
}

/// Binding SERVICE transport. Command, observation and scope/resource access additionally
/// require the independently verified native HUMAN token. readReceipt is SERVICE-only
/// incurred-usage metadata for the already admitted original HUMAN SYNC operation; it never
/// authorizes content disclosure. Tokens stay in transport, not this document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanActionRequest {
    /// Native metadata access uses existing tenant/workspace permissions. Scope and identity
    /// come exclusively from the authenticated binding and HUMAN token, never from
    /// client-selected IDs. This is not Action admission or a reusable ticket.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authorize_scope: Option<NativeHumanScopeQuery>,

    pub binding_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<ActionCommand>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,

    /// Same-request writer admission for the original dispatched AE/EE and native intent, never
    /// another execute. Both the binding SERVICE and independent current HUMAN credentials are
    /// required.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_execution_admission: Option<NativeHumanActionRequestNativeExecutionAdmission>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_receipt: Option<NativeHumanReadReceipt>,

    /// Read the already-registered exact native object for the verified HUMAN and action. This
    /// never creates a Resource or native object.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolve_resource: Option<NativeHumanResourceQuery>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_resources: Option<Vec<AdapterSourceResource>>,
}

/// Native metadata access uses existing tenant/workspace permissions. Scope and identity
/// come exclusively from the authenticated binding and HUMAN token, never from
/// client-selected IDs. This is not Action admission or a reusable ticket.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NativeHumanScopeQuery {
    pub permission: NativeHumanScopeQueryPermission,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NativeHumanScopeQueryPermission {
    Discover,

    Manage,
}

/// POST /api/v1/actions 的语义命令。actionKey 由 Core 的 ActionDefinition 目录解析，未登记即 BLOCKED；各动作所需参数按
/// actionKey 解释，多出或缺少的参数以 INVALID_PARAMETERS 拒绝。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionCommand {
    pub action_key: String,

    /// 仅 agent.definition.export（DD-131(2)、05 §2.12）：目标 Definition 的一个 PUBLISHED AgentVersion
    /// 与包媒体类型；其他动作携带即拒绝。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_definition_export: Option<AgentDefinitionExportInput>,

    /// 仅 agent.definition.import（DD-131(2)、05 §2.12）：本会话上传的快照包引用、包 digest 与本 Tenant
    /// 重选的运行配置；其他动作携带即拒绝。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_definition_import: Option<AgentDefinitionImportInput>,

    /// 仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）；其他动作携带即拒绝。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_team: Option<AgentTeamInput>,

    /// 仅 agent.team.export（DD-131(3)、05 §2.12）：团队快照包媒体类型；其他动作携带即拒绝。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_team_export: Option<AgentTeamExportInput>,

    /// 仅 agent.team.import（DD-131(3)、05 §2.12）：本会话上传的团队快照包引用与包 digest；其他动作携带即拒绝。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_team_import: Option<AgentTeamImportInput>,

    /// 仅 AgentVersion 草稿创建/编辑可携带；publish 只选择已有版本，不替换内容。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_version_content: Option<AgentVersionContent>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub application_binding_create: Option<ApplicationBindingCreate>,

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
    pub automation_version_content: Option<AutomationVersionContent>,

    /// 仅 application_binding.create 的瞬态输入（03 §9、DD-70）：按已批准 release 的 secretSchema 逐项提交 secret
    /// 值，每个 secretKey 恰好一项。Core 在同一 Governed Action 的准入通过后写入该 Tenant 的 OpenBao namespace，只把版本号记成
    /// SecretRef；值不进入 Params、ActionExecution、日志、Workflow history、AuditEvent 或回应。其他命令禁止携带。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding_secret_values: Option<Vec<ApplicationBindingSecretValue>>,

    /// 仅 capability_contract.approve/deprecate：固定已登记版本。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_contract_ref: Option<CapabilityContractRef>,

    /// 仅 capability_contract.register：真实 schema 与测试向量内容。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capability_contract_registration: Option<CapabilityContractRegistration>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_action: Option<ComponentActionInput>,

    /// 仅组件批准：已登记的不可变ComponentRelease标识。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_release_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub component_release_registration: Option<ComponentReleaseRegistration>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_open: Option<ConversationOpenRequest>,

    /// 仅 agent.delegation.grant：明确有效期、次数、确切动作与目标和最大结果暴露；不允许隐式通配。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delegation_grant: Option<DelegationGrantParameters>,

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

    /// 仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
    /// 授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grant_permission: Option<ResourceGrantPermission>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub huddle_agent: Option<HuddleAgentInput>,

    /// 仅 huddle.agent.add / huddle.agent.remove / huddle.end 且必带（DD-125(3)）：目标
    /// HuddleBuzzBinding；父 Workspace 的 Huddle 另须 workspaceId 等于其父 Workspace。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub huddle_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub huddle_start: Option<HuddleStartInput>,

    /// 调用方幂等键。同一发起者以同一键重发时回答原 operation；参数不同即 IDEMPOTENCY_KEY_REUSED
    pub idempotency_key: String,

    /// tenant.member.invite.revoke 的目标邀请
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invitation_id: Option<String>,

    /// 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub llm_route_create: Option<LlmRouteCreateInput>,

    /// 仅 mcp_connection.create（DD-149、05 §2.15）且必带；其他动作携带即拒绝。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_connection_create: Option<McpConnectionCreate>,

    /// DD-149(5)：仅 mcp_connection.create 与 mcp_connection.rotate_credential 的瞬态凭据（API_KEY 或
    /// BEARER）；Core 写入该 Tenant 的 OpenBao 后只保存 SecretRef，值不进入
    /// parameters、ActionExecution、日志、审计或回应。其他命令禁止携带。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_connection_credential: Option<McpConnectionCredentialInput>,

    /// 仅 mcp_connection.policy.update 且必带。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_connection_policy_update: Option<McpConnectionPolicyUpdate>,

    /// 仅 mcp_connection.update 且必带；目标连接器由 resourceId 与 resourceVersion 给出。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_connection_update: Option<McpConnectionUpdate>,

    /// DD-149(6)：仅 OAUTH 连接器的 mcp_connection.rotate_credential：本人本会话已完成且未使用的授权尝试。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_oauth_attempt_id: Option<String>,

    /// 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
    /// 输入；其他命令禁止携带。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memory_write: Option<AgentMemoryWriteInput>,

    /// 仅 moderation.message.delete 且必带（DD-125(2)）：workspaceId 所指 Workspace Channel 中一条消息的 Relay
    /// 事件 ID；Core 以 CONTROL 回读确认属于该 Channel 后签 9005，按 DD-81 以 9005 事件 ID 对账。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moderation_event_id: Option<String>,

    /// 仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
    /// 是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
    /// CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
    /// agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moderation_member: Option<ModerationMemberTarget>,

    /// 仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
    /// conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
    /// kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moderation_report: Option<ModerationReportSubmit>,

    /// 仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
    /// ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub moderation_resolution: Option<ModerationReportResolution>,

    /// workspace.create 或 AgentDefinition 创建/更新的显示名；tenant.member.invite 的被邀请人称呼（只作展示）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// 任务控制只接收原 ActionExecution ID；原 Workflow、target 与 scope 由 Core 解析。Agent
    /// 回合中断（task.cancel.agent.invoke.v1）的发起人可以是原发起人或该 Installation manage 持有人（DD-125(6) 扩展
    /// DD-84），其余规则不变
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_action_execution_id: Option<String>,

    /// 成员动作的目标 Principal；resource.transfer_owner 的新 owner；resource.grant_read/revoke_read 的同
    /// Tenant 接收者，Core 核对真实 HUMAN 成员、原 AGENT Installation 或 receiverResource 所属 SERVICE
    #[serde(skip_serializing_if = "Option::is_none")]
    pub principal_id: Option<String>,

    /// Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
    /// identity; no Agent or caller-selected native credentials.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub protocol_session_open: Option<ProtocolSessionOpenInput>,

    /// 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
    /// 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
    /// Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_resource: Option<ActionCommandReceiverResource>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_create: Option<ResourceCreate>,

    /// Resource 管理动作的目标；Core 重新核对同 Tenant、scope、owner 和投影。agent.installation.disable /
    /// agent.installation.enable（DD-125(6)、05 §2.11）只带 resourceId、resourceVersion 与
    /// explicitConfirmation=true：目标 Workspace 由 Installation 的 home Workspace
    /// 解析（TARGET_HOME_WORKSPACE），不接受 workspaceId、assetId 或其他参数；原“重启”是 assetId 等于固定 Version 的
    /// agent.installation.upgrade
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_id: Option<String>,

    /// 调用方实际读取的 Resource 版本；与当前事实不同即 CONFLICT
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resource_version: Option<i64>,

    /// 仅 skill.version.create（DD-135(3)）：本会话一次性上传引用与能力需求；其他动作携带即拒绝。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_version_upload: Option<SkillVersionUploadInput>,

    /// workspace.create 或 agent.definition.create 的稳定 slug
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,

    /// 仅 agent.invoke 人工分派：本人在该 Workspace Channel 已持久发布的消息 ID；Core 回读验签并与普通 mention 共用源事件幂等。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_event_id: Option<String>,

    /// tenant.suspend / tenant.restore 的目标业务 Tenant；执行 Tenant 仍是会话 Tenant（Platform Catalog）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_id: Option<String>,

    /// 仅 tenant.profile.update（DD-158(3)）且必带；其他动作携带即拒绝。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_profile: Option<TenantProfileInput>,

    /// 仅 tenant.quota.set（DD-123）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_quota_setting: Option<TenantQuotaSetting>,

    /// 仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
    /// explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_canvas: Option<WorkspaceCanvasSetInput>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_channel: Option<WorkspaceChannelCreate>,

    /// Workspace 内动作的执行 Workspace
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,

    /// 仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
    /// 或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_update: Option<WorkspaceUpdate>,

    /// 仅 workspace.create 使用；省略保持旧命令的 private 可见性。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_visibility: Option<WorkspaceVisibility>,
}

/// 仅 agent.definition.export（DD-131(2)、05 §2.12）：目标 Definition 的一个 PUBLISHED AgentVersion
/// 与包媒体类型；其他动作携带即拒绝。
///
/// 仅 agent.definition.export（DD-131(2)、05 §2.12）：命令的 Resource 目标是 AgentDefinition，这里冻结其一个
/// PUBLISHED AgentVersion 与包的媒体类型。包只含可移植字段，不含
/// owner、公钥、Installation、绑定、llm_route、RuntimeProfile、Delegation、记忆或任何 SecretRef。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionExportInput {
    pub media_type: AgentSnapshotMediaType,

    pub version_asset_id: String,
}

/// 仅 agent.definition.import（DD-131(2)、05 §2.12）：本会话上传的快照包引用、包 digest 与本 Tenant
/// 重选的运行配置；其他动作携带即拒绝。
///
/// 仅 agent.definition.import（DD-131(2)、05 §2.12）：引用本 PlatformSession、本人的一次性快照上传与其包字节
/// SHA-256；包不携带运行时与模型路由（DD-26）。导入时不强制选择：所给的 Profile 与 Route 在准入与 Workflow 内各自重验，缺省的由 owner
/// 发布前在版本编辑器补齐（DD-131(2)）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentDefinitionImportInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_route_resource_id: Option<String>,

    /// 上传返回的包字节 SHA-256；准入与 Workflow 读取包时重算比对。
    pub package_digest: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub runtime_profile_key: Option<String>,

    pub upload_id: String,
}

/// 仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）；其他动作携带即拒绝。
///
/// 仅 agent.team.create / agent.team.update 且必带（DD-131(1)、05 §2.12）：Tenant 级 Agent
/// 团队的名称、说明与有序成员。成员是同 Tenant、发起人当前可 read 的 AgentDefinition Resource，按给出次序保存、不重复、至多 64
/// 个（沿原团队目录上限）；不含原版团队级 instructions、内置 welcome 团队或任何运行配置。update 另带 resourceId 与读到的
/// resourceVersion 做 CAS。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamInput {
    /// 可选说明，至多 2000 字符；去首尾空白后为空即省略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub member_agent_resource_ids: Vec<String>,

    /// 去首尾空白后非空，至多 200 字符
    pub name: String,
}

/// 仅 agent.team.export（DD-131(3)、05 §2.12）：团队快照包媒体类型；其他动作携带即拒绝。
///
/// 仅 agent.team.export（DD-131(3)、05 §2.12）：命令的 Resource 目标是
/// agent_team，这里只冻结包媒体类型。各成员取审批开始时冻结的当前已发布版本；包是团队信息加各成员的 DD-131(2) 清单，不含团队
/// instructions、owner、公钥、Installation、绑定、llm_route、RuntimeProfile、记忆或任何 SecretRef。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamExportInput {
    pub media_type: AgentSnapshotMediaType,
}

/// 仅 agent.team.import（DD-131(3)、05 §2.12）：本会话上传的团队快照包引用与包 digest；其他动作携带即拒绝。
///
/// 仅 agent.team.import（DD-131(3)、05 §2.12）：本会话、本人上传的 buzz-team-snapshot@1 包引用与包
/// digest。agent_team 没有 slug；各成员 Definition 的 slug 由 Core 按成员显示名规范化生成并在本 Tenant 内加序号去重。成员
/// DRAFT 不带运行配置，由 owner 发布前补齐。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamImportInput {
    pub package_digest: String,

    pub upload_id: String,
}

/// DD-88/94：pin 已批准 release 的业务绑定选择。不接受密钥正文、调用方自选 SecretRef 或运行端点 URL；secret 值只经同一
/// ActionCommand 的瞬态 bindingSecretValues 提交（03 §9）。Workspace 取原 ActionCommand。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingCreate {
    pub adapter_service_ref: String,

    pub binding_id: String,

    pub call_identity_mode: ApplicationCallIdentityMode,

    pub capability_categories: Vec<ApplicationCapabilitySelection>,

    pub component_release_id: String,

    pub isolation_mode: ApplicationIsolationMode,

    pub model_call_mode: ApplicationModelCallMode,

    pub native_instance_ref: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_scope_ref: Option<String>,

    pub normalized_config_json: String,

    pub retain_on_tenant_delete: bool,

    /// 必须为空数组。binding 的 SecretRef 只由 Core 在本动作内把 bindingSecretValues 写入该 Tenant OpenBao
    /// namespace 的 application-binding/<bindingId>/<secretKey> 后按返回版本生成；调用方提供的 locator/version
    /// 一律拒绝（03 §9，不以运维旁路写入的 KV 冒充受治理写入）。
    pub secret_refs: Vec<ApplicationBindingSecretRef>,

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
pub struct ApplicationCapabilitySelection {
    pub category: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingSecretRef {
    pub audience: String,

    pub locator: String,

    pub secret_key: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingSecretValue {
    pub secret_key: String,

    pub value: String,
}

/// 仅 capability_contract.approve/deprecate：固定已登记版本。
///
/// 固定 Catalog 自然键，不授予业务能力 consume 权限。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRef {
    pub category_key: String,

    pub contract_version: i64,
}

/// 仅 capability_contract.register：真实 schema 与测试向量内容。
///
/// DD-102：平台管理员登记实际 schema 与一致性测试向量。Core 按实际 canonical JSON 计算摘要并固定原内容；不接受只填摘要。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityContractRegistration {
    pub category_key: String,

    pub content_reference_semantics: CapabilityContractRegistrationContentReferenceSemantics,

    pub contract_version: i64,

    pub operation_contracts: Vec<CapabilityContractRegistrationOperationContractsItem>,

    pub protocol_session_kinds: Vec<String>,

    pub required_declarations: Vec<CapabilityRequiredDeclaration>,

    pub resource_type_family: Vec<CapabilityContractRegistrationResourceTypeFamilyItem>,

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
pub struct CapabilityContractRegistrationOperationContractsItem {
    pub contract_key: String,

    pub input_schema_digest: String,

    pub output_schema_digest: String,

    pub permission: CapabilityPermission,

    pub surface: CapabilitySurface,

    pub target_type: String,
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
pub struct CapabilityContractRegistrationResourceTypeFamilyItem {
    pub kind: String,

    pub type_key: String,
}

/// Kailo HUMAN 通过原 ActionCommand 调用确切 APPLICATION 能力动作。inputReference 或 inputJson 恰一：前者保持持久
/// ContentReference，后者是原登记能力 inputSchema 的规范化元数据参数，不把 SQL、提示或结果正文写入 Core/Temporal。Core
/// 仍校验原目标、能力 schema、审批和用量。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentActionInput {
    pub action_version: i64,

    /// Canonical JSON for the existing registered capability input schema; mutually exclusive
    /// with inputReference, validated before AE admission.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_json: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_reference: Option<ContentReference>,

    pub result_exposure_policy_id: String,

    pub result_exposure_policy_version: i64,
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

/// 原生私聊的完整 HUMAN Principal 参与者集合，必须包含当前 HUMAN；不接受设备公钥、CONTROL 身份或 Workspace 冒名。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationOpenRequest {
    pub participant_principal_ids: Vec<String>,
}

/// 仅 resource.grant_read/revoke_read：授予或收回的 permission，省略即 read。AGENT 接收者按其工具契约所需 permission
/// 授予（DD-122）；HUMAN 与 SERVICE 接收者只接受 read
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResourceGrantPermission {
    Consume,

    Discover,

    Execute,

    Read,
}

/// 仅 huddle.agent.add / huddle.agent.remove（DD-125(3)）且必带，目标 Huddle 由 ActionCommand.huddleId
/// 给出。加入要求父 Workspace 中 ACTIVE、有 ChannelAgentBinding 且本人有 execute 的 Installation，Tenant
/// CONTROL 以 9000 role=bot 投影并回读；移除另接受父 Workspace manage，CONTROL 以 9001 移出并回读。私聊父的 Huddle 没有
/// Agent。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HuddleAgentInput {
    pub agent_installation_resource_id: String,
}

/// 仅 huddle.start（DD-125(3)、05 §2.11）且必带：在父 Workspace 或父私聊中发起原版 Huddle。parentWorkspaceId 与
/// parentConversationId 恰有一个：前者要求执行 Workspace 即该 Workspace（discover），后者要求本人是该私聊当前参与者。Core
/// 预分配 HuddleBuzzBinding 与临时 Channel UUID，由 Tenant CONTROL 以带 creator 的
/// 9007（private、stream、ttl=3600）投影临时频道，并以 9000 role=bot 加入所选 Agent；私聊父不接受
/// Agent。creatorPubkey 是本人发起会话的 ACTIVE HUMAN 公钥（原生端为该设备 CLIENT 公钥），省略即本人 SERVER
/// 公钥（Web）；它是临时频道的 created_by，也是唯一可签 48100/48106 的公钥。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HuddleStartInput {
    /// 原 Add agents 所选 Agent（至多 20 个，沿原 MAX_HUDDLE_AGENTS）：父 Workspace 中 ACTIVE、有
    /// ChannelAgentBinding 且本人有 execute 的 Installation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_installation_resource_ids: Option<Vec<String>>,

    /// 原 buildHuddleChannelName 生成的临时频道名
    pub channel_name: String,

    /// 64 位小写十六进制 Nostr 公钥；省略即本人 SERVER 公钥
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator_pubkey: Option<String>,

    /// 父私聊（ConversationBuzzBinding id）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_conversation_id: Option<String>,

    /// 父 Workspace；须等于 ActionCommand.workspaceId
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_workspace_id: Option<String>,
}

/// 仅 llm_route.create：确切原生 Provider/Model 与受控 provider SecretRef；不接收 URL 或 key 正文。
///
/// 受治理 Route 创建只传原生配置与同 Tenant OpenBao 凭据的确切引用。providerCredentialMode 必须明确提供：NONE
/// 仅表示固定原生提供方配置不使用认证；SECRET_REF 必须有确切引用。端点、模型正文与 key 不进入 Core 参数。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmRouteCreateInput {
    pub model: LlmRouteCreateInputNativeSource,

    pub provider: LlmRouteCreateInputNativeSource,

    pub provider_credential_mode: LlmProviderCredentialMode,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_secret_ref: Option<LlmRouteCreateInputProviderSecretRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LlmRouteCreateInputNativeSource {
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
pub struct LlmRouteCreateInputProviderSecretRef {
    pub audience: String,

    pub locator: String,

    pub version: i64,
}

/// 仅 mcp_connection.create（DD-149、05 §2.15）且必带；其他动作携带即拒绝。
///
/// 仅 mcp_connection.create（DD-149、05 §2.15）：端点、认证方式、可见范围与确认的工具清单。凭据值只经
/// ActionCommand.mcpConnectionCredential 一次性提交；OAuth 只引用本人本会话已完成的授权尝试。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionCreate {
    /// 仅 API_KEY：小写 header 名
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key_header: Option<String>,

    pub auth_mode: McpConnectionAuthMode,

    /// 连接器显示名，1–80 字符
    pub display_name: String,

    /// https 端点；不含 userinfo、query 与 fragment
    pub endpoint_url: String,

    /// 仅 OAUTH：本人本会话已完成且未使用的授权尝试
    #[serde(skip_serializing_if = "Option::is_none")]
    pub oauth_attempt_id: Option<String>,

    /// OAUTH 且可见范围不是 PERSONAL 时必须为 true：同意其他人的 Agent 以本人授权调用
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_authorization_consent: Option<bool>,

    pub tools: Vec<McpToolSelection>,

    /// 确认时探测结果的清单摘要；提交时 Core 重新探测比对
    pub tools_digest: String,

    pub transport: McpConnectionTransport,

    pub visibility: McpConnectionVisibility,

    /// 仅 WORKSPACE 可见范围：所属 Workspace
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// DD-149(7)：确认清单中的一个上游工具。未列出的上游工具即不启用。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolSelection {
    pub call_policy: McpToolCallPolicy,

    pub enabled: bool,

    pub risk: McpToolRisk,

    /// 风险等级低于 annotations 建议时必须为 true，作为管理员声明冻结进审计
    #[serde(skip_serializing_if = "Option::is_none")]
    pub risk_declared: Option<bool>,

    /// 上游 tools/list 中的工具名，原样
    pub upstream_name: String,
}

/// 仅 mcp_connection.policy.update 且必带。
///
/// 仅 mcp_connection.policy.update：Tenant 连接器策略；白名单条目须落在部署声明的出站上限内。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionPolicyUpdate {
    /// 小写主机名后缀；空表示只受部署上限约束
    pub egress_host_suffixes: Vec<String>,

    pub member_registration: McpMemberRegistration,
}

/// 仅 mcp_connection.update 且必带；目标连接器由 resourceId 与 resourceVersion 给出。
///
/// 仅 mcp_connection.update：以新探测结果重新确认工具清单、风险、策略与可见范围，形成新 generation。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpConnectionUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shared_authorization_consent: Option<bool>,

    pub tools: Vec<McpToolSelection>,

    pub tools_digest: String,

    pub visibility: McpConnectionVisibility,

    /// 仅 WORKSPACE 可见范围
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// 仅 HUMAN agent.memory.core.replace / entry.set / entry.patch / entry.remove 的瞬态 native
/// 输入；其他命令禁止携带。
///
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
    pub expected_head_state: AgentMemoryWriteInputExpectedHeadState,

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
pub enum AgentMemoryWriteInputExpectedHeadState {
    #[serde(rename = "ABSENT")]
    Absent,

    #[serde(rename = "FOUND")]
    Found,
}

/// 仅 moderation.ban / unban / timeout / untimeout 且必带（DD-125(2)）。targetPubkey
/// 是消息签名者或成员栏所列公钥，Core 解析为同 Tenant 非本人、非有效 Tenant admin 的 HUMAN Principal，并对其全部非 REVOKED 公钥由
/// CONTROL 签 9040–9043；AGENT 公钥以 PERMISSION_DENIED 拒绝（停用走
/// agent.installation.disable）。timeoutDuration 只随 moderation.timeout 且必带，到期时刻在准入时冻结。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationMemberTarget {
    /// 64 位小写十六进制 Nostr 公钥
    pub target_pubkey: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_duration: Option<ModerationTimeoutDuration>,
}

/// 原禁言时长预设（moderation/lib/timeout.ts::TIMEOUT_PRESETS：1 小时、24 小时、7 天）。到期时刻由 Core
/// 在准入时以数据库时钟冻结，不接受调用方给出的绝对时刻（DD-125(2)）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModerationTimeoutDuration {
    #[serde(rename = "ONE_DAY")]
    OneDay,

    #[serde(rename = "ONE_HOUR")]
    OneHour,

    #[serde(rename = "SEVEN_DAYS")]
    SevenDays,
}

/// 仅 moderation.report.submit（DD-125(2)、05 §2.11）且必带：原举报对话框的一条消息举报。Core 在 workspaceId 或
/// conversationId（恰好一个）给出的本人当前可读范围内以本人身份回读 eventId，以其签名者为 p 目标（HUMAN 目标须同 Tenant），再以本人身份签
/// kind 1984（e 标签带 reportType）；note 去首尾空白后作为正文，空即省略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationReportSubmit {
    /// 消息所在私聊；本人须为其当前参与者
    #[serde(skip_serializing_if = "Option::is_none")]
    pub conversation_id: Option<String>,

    /// 被举报消息的 Relay 事件 ID（64 位小写十六进制）
    pub event_id: String,

    /// 原“补充说明（可选）”，至多 1000 字符
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,

    pub report_type: ModerationReportType,

    /// 消息所在 Workspace Channel；本人须为其当前成员
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// 仅 moderation.report.resolve 且必带（DD-125(2)）：同一目标的一组未结举报（1–100 条 kind 1984 事件
/// ID，不重复），CONTROL 逐条签 9044 并按举报状态回读；只记决定、不执法。dismiss 与 dismissed 配对，其余与 resolved 配对。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModerationReportResolution {
    pub report_event_ids: Vec<String>,

    pub resolution_action: ModerationResolutionAction,

    pub status: ModerationResolutionStatus,
}

/// 审核队列可提交的 kind 9044 action 标签（原 settings/lib/moderationQueue.ts::resolvableActions）。9044
/// 只记决定、不执法；delete/kick/ban 须先经各自受治理动作执法（DD-125(2)）。原队列不提供禁言，因此不含 timeout。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationResolutionAction {
    Ban,

    Delete,

    Dismiss,

    Escalate,

    Kick,
}

/// kind 9044 的 status 标签（moderation_commands.rs，SF-BUZ-52）：dismiss 只与 dismissed 配对，其余处理一律
/// resolved。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationResolutionStatus {
    Dismissed,

    Resolved,
}

/// Only file_storage.open_view@v1/open_edit@v1, exact target version and the existing HUMAN
/// identity; no Agent or caller-selected native credentials.
///
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

    pub locale: ProtocolSessionLocale,

    /// Exact approved projection selected by the native menu; never latest.
    pub projection_generation: i64,

    pub reference: ContentReference,

    pub theme: ProtocolSessionTheme,
}

/// 仅 resource.grant_read/revoke_read 的 SERVICE 接收方 Resource；Core 从其真实 ApplicationBinding
/// 核对唯一 ServicePrincipal、scope 与读边能力，不接受调用方指定绑定或凭据。省略时，原 AGENT Installation 仍只接受自身 AGENT；组件
/// Resource 接收者必须是同 Tenant 的 HUMAN，授予时重新核对有效成员与目标 scope。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActionCommandReceiverResource {
    pub id: String,

    pub version: i64,
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

/// 仅 skill.version.create（DD-135(3)）：本会话一次性上传引用与能力需求；其他动作携带即拒绝。
///
/// 仅 skill.version.create（DD-135(3)）：引用本 PlatformSession、本人、目标定义的一次性上传及其规范 artifact
/// digest；能力需求只声明契约键与版本，不授予工具。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillVersionUploadInput {
    /// 上传返回的规范 SKILL.md SHA-256（64 位小写十六进制）；准入事务内重算比对。
    pub artifact_digest: String,

    /// contract_key@version，去重；须是引用它的 AgentVersion 能力需求的子集。
    pub capability_requirements: Vec<String>,

    pub upload_id: String,
}

/// 仅 tenant.profile.update（DD-158(3)）且必带；其他动作携带即拒绝。
///
/// 仅 tenant.profile.update 且必带（DD-158(3)、05 §2.11）：Tenant 显示名与图标。name 去首尾空白后 1–64 字符；icon
/// 是客户端按原版缩到 256 px 的 PNG/JPEG/WebP data URL（≤96 KiB）或单个 emoji；clearIcon=true 清除图标且不得同时给
/// icon。至少给出一项；目标固定为会话 Tenant，按 resourceVersion（读到的 Tenant version）CAS。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantProfileInput {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clear_icon: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// 仅 tenant.quota.set（DD-123）
///
/// DD-123: tenant.quota.set parameters. Writes only the Tenant Customer's hard-limit
/// OpenMeter entitlement for the platform feature, resetting monthly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantQuotaSetting {
    pub feature: TenantQuotaFeature,

    pub limit_per_period: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TenantQuotaFeature {
    #[serde(rename = "agent_memory_writes")]
    AgentMemoryWrites,

    #[serde(rename = "agent_tokens")]
    AgentTokens,

    #[serde(rename = "automation_runs")]
    AutomationRuns,
}

/// 仅 workspace.canvas.set 且必带（DD-125(4)）：目标 Workspace 由 workspaceId 给出，须带
/// explicitConfirmation=true；正文是瞬态输入，只冻结摘要。其他命令禁止携带。
///
/// 仅 workspace.canvas.set（DD-125(4)、05 §2.11）的瞬态输入：原频道 Canvas 的 Markdown 正文（SF-BUZ-54，UTF-8
/// 不超过 64 KiB，空串即原“清空”）。Core 只用它签 Tenant CONTROL 的 kind 40100 并按 DD-81 对账；正文不进入
/// Params、ActionExecution、审计、日志或 Workflow history，只冻结其 SHA-256 与字节数，同一幂等键重发须携带同一正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceCanvasSetInput {
    pub content: String,
}

/// workspace.create 的 Buzz 原生频道元数据。只用于创建时向 Relay 物化，不建立第二份频道内容权威。缺省保留旧命令的 stream 行为。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChannelCreate {
    pub channel_type: WorkspaceChannelCreateChannelType,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 原 Buzz 临时频道的不活跃期限（秒）。省略为长期频道；Relay 原生消息活动续期，原生 reaper 到期归档，不表示 Workspace 暂停或删除。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<i64>,
}

/// 仅 workspace.update 使用且必带，目标 Workspace 由 workspaceId 给出；该动作不接受顶层 name、workspaceVisibility
/// 或 workspaceChannel。workspace.leave 只带 workspaceId，主体固定为发起人，不接受 principalId。
///
/// workspace.update 的冻结目标状态（DD-119）。至少给出 name、description、ttlSeconds/clearTtl、visibility
/// 之一，或只给 reopen=true；省略的字段保持不变。Core 在 Admission 校验组合，空集、ttlSeconds 与 clearTtl 同时出现、reopen
/// 与其他字段混用或取 false 均以 INVALID_PARAMETERS 拒绝。stream/forum 类型只在创建时设定，不可编辑；slug 不变。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceUpdate {
    /// 只能为 true：清除 TTL 改为长期频道（原 9002 空 ttl 标签）；与 ttlSeconds 互斥。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clear_ttl: Option<bool>,

    /// 原 9002 about；空字符串清空描述。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    /// 新的频道与 Workspace 显示名；CONTROL 9002 回读 39000 一致后才在同一事务提交 Core 的 Workspace 名称。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// 只能为 true 且单独出现：解档被原生 reaper 按 TTL 到期归档的 Channel。要求 Workspace ACTIVE、回读 archived=true 且设有
    /// TTL，CONTROL 发 archived=false 后回读确认；主动归档仍用 workspace.suspend/restore。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reopen: Option<bool>,

    /// 设置原 Buzz 临时频道的不活跃期限（秒）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ttl_seconds: Option<i64>,

    /// 只在准入事务内改写 Core 的 Workspace 可见性；已有成员不变，不写 SpiceDB，Relay 投影保持 private、不发送 visibility 标签。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<WorkspaceVisibility>,
}

/// Same-request writer admission for the original dispatched AE/EE and native intent, never
/// another execute. Both the binding SERVICE and independent current HUMAN credentials are
/// required.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanActionRequestNativeExecutionAdmission {
    pub action_execution_id: String,

    pub external_execution_id: String,

    pub native_intent_id: String,
}

/// Original HUMAN synchronous application read completion, authenticated by its binding
/// SERVICE. Metadata only; no body, replacement identity, native Task or ExternalExecution.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanReadReceipt {
    pub completed_at: String,

    pub content_bytes: i64,

    pub content_sha256: String,

    pub idempotency_key: String,

    pub measurements: Vec<NativeHumanReadReceiptMeasurementsItem>,

    pub native_object_ref: String,

    pub native_revision: String,

    pub operation_id: String,

    pub started_at: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanReadReceiptMeasurementsItem {
    pub meter_key: String,

    pub quantity: i64,
}

/// Read the already-registered exact native object for the verified HUMAN and action. This
/// never creates a Resource or native object.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanResourceQuery {
    pub action_key: String,

    pub action_version: i64,

    pub native_ref: String,

    pub native_type: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// Reference-only observation of the original HUMAN AE. Component terminal status comes from
/// original component-action audit after native/usage reconciliation. Native-origin platform
/// resource permission actions use their exact permission-outcome audit; that outcome does
/// not assert completion of a component's native sharing RPCs. Never infer a terminal result
/// from HTTP acceptance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanActionResult {
    /// Original admitted canonical capability metadata input; exactly one input form, never a
    /// result body or a new execution authority.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_json: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_reference: Option<ContentReference>,

    /// Original dispatched native-writer reference only. Neither existence nor RUNNING proves
    /// byte completion; no bearer is exposed by observation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_execution: Option<NativeHumanActionResultNativeExecution>,

    /// Transient same-request writer bearer for the exact original AE/EE. The native task must
    /// atomically claim the byte step before using it; never persisted or exposed to the browser.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_execution_admission: Option<NativeHumanActionResultNativeExecutionAdmission>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_type: Option<String>,

    /// First native same-request read only. Never returned by idempotency observation or retried
    /// admission; the bearer is not persisted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_admission: Option<NativeHumanActionResultReadAdmission>,

    pub submission: ActionSubmission,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub terminal_status: Option<TaskStatus>,
}

/// Original dispatched native-writer reference only. Neither existence nor RUNNING proves
/// byte completion; no bearer is exposed by observation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanActionResultNativeExecution {
    pub binding_generation: i64,

    pub external_execution_id: String,

    pub idempotency_key: String,

    pub native_intent_id: String,
}

/// Transient same-request writer bearer for the exact original AE/EE. The native task must
/// atomically claim the byte step before using it; never persisted or exposed to the browser.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanActionResultNativeExecutionAdmission {
    pub action_token: String,

    pub arguments_json: String,

    /// RFC3339 admission expiry, preserved verbatim across language bindings and validated by
    /// the native writer before every byte step.
    pub expires_at: String,
}

/// First native same-request read only. Never returned by idempotency observation or retried
/// admission; the bearer is not persisted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanActionResultReadAdmission {
    pub action_token: String,

    pub arguments_json: String,

    pub expires_at: i64,
}

/// Current already-registered native Resource selected under the original HUMAN action
/// permission. Metadata only, not an admission ticket; submission rechecks version, binding
/// and permission.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NativeHumanResourceResult {
    pub resource: NativeHumanResourceSelection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanResourceSelection {
    pub native_instance_ref: String,

    pub native_ref: String,

    pub native_scope_ref: String,

    pub native_type: String,

    pub resource_id: String,

    pub resource_version: i64,
}

/// Fresh permission check for native metadata in the authenticated binding's existing
/// tenant/workspace scope. Not an ActionExecution, permission cache, or execution ticket;
/// native Resource bodies still require their own current read permission.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NativeHumanScopeResult {
    pub scope: NativeHumanScopeSelection,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeHumanScopeSelection {
    pub binding_id: String,

    pub checked_revision: String,

    pub generation: i64,

    pub native_instance_ref: String,

    pub native_scope_ref: String,

    pub permission: NativeHumanScopeQueryPermission,

    pub tenant_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
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

/// DD-158(2)：GET /api/v1/platform/feedback 的有界回应，只对 Platform Catalog Tenant 中持有 fresh
/// Catalog manage 的会话开放；读取受审计。图片经 GET /api/v1/platform/feedback/{feedbackId}/attachment 取回。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformFeedbackPage {
    pub items: Vec<PlatformFeedbackView>,

    /// 下一页偏移，缺省即读完
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformFeedbackView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachment: Option<FeedbackAttachmentView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<FeedbackCategory>,

    pub client: FeedbackClient,

    pub created_at: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<String>,

    pub feedback_id: String,

    pub message: String,

    pub state: FeedbackState,

    pub tenant_id: String,

    pub tenant_name: String,

    pub version: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackAttachmentView {
    pub byte_size: i64,

    pub mime_type: String,

    pub sha256: String,
}

/// DD-158(2)：运营方分拣状态 NEW→TRIAGED→CLOSED；超过 180 天的 CLOSED 记录由 Core 清除。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum FeedbackState {
    #[serde(rename = "CLOSED")]
    Closed,

    #[serde(rename = "NEW")]
    New,

    #[serde(rename = "TRIAGED")]
    Triaged,
}

/// DD-158(2)：PUT /api/v1/platform/feedback/{feedbackId}。运营方按读到的 version CAS
/// 前移分拣状态（NEW→TRIAGED→CLOSED，不可回退）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlatformFeedbackTriageRequest {
    pub state: FeedbackState,

    pub version: i64,
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

    pub tools: Vec<PlatformToolView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformToolView {
    /// DD-140 (1)：平台原生工具名到动作键的封闭映射；记忆工具即其自身，project_channel_request 为
    /// workspace.create。DD-149：连接器工具为其调用策略对应的子动作键。
    pub action_key: PlatformToolViewActionKey,

    pub can_consume: bool,

    /// 仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器与冻结的工具元数据。描述是上游提供的不可信文本。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connector: Option<PlatformToolConnector>,

    pub input_schema_hash: String,

    /// PLATFORM_NATIVE
    /// 为固定原生工具名（agent.memory.entry.list、agent.memory.entry.read、project_channel_request）；USER_REGISTERED_EXTERNAL
    /// 为 <连接器标识>__<上游工具名>（DD-149(3)）。
    pub name: String,

    pub output_schema_hash: String,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_state: ResourceState,

    pub resource_version: i64,

    pub source: PlatformToolViewSource,

    pub status: PlatformToolViewStatus,
}

/// DD-140 (1)：平台原生工具名到动作键的封闭映射；记忆工具即其自身，project_channel_request 为
/// workspace.create。DD-149：连接器工具为其调用策略对应的子动作键。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PlatformToolViewActionKey {
    #[serde(rename = "agent.memory.entry.list")]
    AgentMemoryEntryList,

    #[serde(rename = "agent.memory.entry.read")]
    AgentMemoryEntryRead,

    #[serde(rename = "mcp_connection.tool.invoke")]
    McpConnectionToolInvoke,

    #[serde(rename = "mcp_connection.tool.invoke_approved")]
    McpConnectionToolInvokeApproved,

    #[serde(rename = "mcp_connection.tool.invoke_confirmed")]
    McpConnectionToolInvokeConfirmed,

    #[serde(rename = "workspace.create")]
    WorkspaceCreate,
}

/// 仅 USER_REGISTERED_EXTERNAL（DD-149）：所属连接器与冻结的工具元数据。描述是上游提供的不可信文本。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformToolConnector {
    pub call_policy: McpToolCallPolicy,

    pub connection_id: String,

    pub connection_name: String,

    pub connection_state: McpConnectionState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    pub risk: McpToolRisk,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    pub upstream_name: String,

    pub visibility: McpConnectionVisibility,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PlatformToolViewSource {
    #[serde(rename = "PLATFORM_NATIVE")]
    PlatformNative,

    #[serde(rename = "USER_REGISTERED_EXTERNAL")]
    UserRegisteredExternal,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PlatformToolViewStatus {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "PROVISIONING")]
    Provisioning,
}

/// DD-40 original Projects Added/remove preference. Native coordinate only, not membership
/// or content permission. Uses the same CollaborationUserState version CAS.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPreferenceRequest {
    pub project_address: String,

    pub selected: bool,

    pub version: i64,
}

/// DD-118: the original Buzz Desktop merge_project_pull_request through BFF. Only when the
/// person's own SERVER key is the repository coordinate owner: Core merges the review's
/// source branch into the target branch in a temporary clone, pushes as that owner (Relay
/// pre-receive policy decides), then publishes the owner-signed original kind 1631 merged
/// status through the existing publication chain. Carries the Idempotency-Key header; the
/// push is keyed by (repository, target ref, old->new) and reconciled from info/refs; 1631
/// follows DD-81.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsGitMergeRequest {
    /// Original expected source head; a moved source branch is a conflict, never a silent merge
    /// of other commits.
    pub expected_commit: String,

    /// The original 1618 review being merged.
    pub pull_request_event_id: String,

    pub repository: String,

    pub source_branch: String,

    pub target_branch: String,
}

/// DD-118: the original ProjectRepoMergeResult without its English message. statusEventId is
/// the owner-signed 1631 merged status; it is present once that publication is accepted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsGitMergeResponse {
    pub merge_commit: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_event_id: Option<String>,
}

/// DD-118: the original Buzz Desktop remote repository reads
/// (get_project_repo_snapshot/get_project_repo_file_content/get_project_repo_diff) through
/// BFF. The repository is named by its 30617 coordinate, never by a clone URL; Relay
/// authorize_git_read decides access with the person's own SERVER identity.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsGitQueryRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_branch: Option<String>,

    /// FILE_CONTENT only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,

    pub repository: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_commit: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_ref: Option<String>,

    pub view: ProjectsGitQueryRequestView,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectsGitQueryRequestView {
    Diff,

    #[serde(rename = "FILE_CONTENT")]
    FileContent,

    Snapshot,
}

/// DD-118: exactly one of snapshot/content/diff matches the requested view, in the original
/// Buzz Desktop shapes (ProjectRepoSnapshot, file preview, ProjectRepoDiff) with the
/// original 64 KiB, 2000-line and 250-file bounds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectsGitQueryResponse {
    /// FILE_CONTENT preview; null when the file is binary or over the original preview bound.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub diff: Option<ProjectRepoDiff>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub snapshot: Option<ProjectRepoSnapshot>,

    pub view: ProjectsGitQueryRequestView,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRepoDiff {
    pub additions: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_body: Option<String>,

    pub deletions: i64,

    pub files: Vec<ProjectRepoDiffFile>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectRepoDiffFile {
    pub additions: i64,

    pub deletions: i64,

    pub patch: String,

    pub path: String,

    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRepoSnapshot {
    pub commits: Vec<ProjectRepoCommit>,

    pub contributors: Vec<ProjectRepoContributor>,

    pub files: Vec<ProjectRepoFile>,

    /// Absent when the original value is null.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_commit: Option<ProjectRepoCommit>,
}

/// Absent when the original value is null.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRepoCommit {
    pub author_email: String,

    pub author_name: String,

    pub hash: String,

    pub short_hash: String,

    pub subject: String,

    pub timestamp: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRepoContributor {
    pub commit_count: i64,

    pub email: String,

    pub last_commit_at: i64,

    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRepoFile {
    pub kind: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_changed_at: Option<i64>,

    /// Absent when the original value is null.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_commit: Option<ProjectRepoCommit>,

    pub path: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub preview_content: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<i64>,
}

/// DD-118: the original Buzz Desktop
/// create_project_remote_branch/delete_project_remote_branch through BFF. The person's own
/// SERVER identity pushes to the Relay repository named by its 30617 coordinate; Relay
/// pre-receive policy decides. The request carries the Idempotency-Key header; the push is
/// keyed by (repository, ref, old->new) and reconciled from info/refs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsGitRefRequest {
    /// CREATE_BRANCH: the new branch. DELETE_BRANCH: the branch to delete.
    pub branch: String,

    /// CREATE_BRANCH: the source branch head the new branch starts at. DELETE_BRANCH: the branch
    /// head being deleted.
    pub expected_commit: String,

    pub operation: ProjectGitRefOperation,

    pub repository: String,

    /// CREATE_BRANCH only: the original source branch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_branch: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectGitRefOperation {
    #[serde(rename = "CREATE_BRANCH")]
    CreateBranch,

    #[serde(rename = "DELETE_BRANCH")]
    DeleteBranch,
}

/// DD-118: the original ProjectRepoBranchResult without its English message; the branch and
/// the commit the ref now points at (DELETE_BRANCH: the deleted head).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProjectsGitRefResponse {
    pub branch: String,

    pub commit: String,
}

/// Typed original Community announcement mutation. Actor is the authenticated SERVER or
/// CLIENT signer, never supplied by this request. Creation resolves the home Channel from an
/// admitted Workspace; metadata is transient and remains Relay-owned. DELETE selects a real
/// signed current announcement; it does not delete its channel or repositories.
/// CREATE_PULL_REQUEST publishes the original NIP-34 1618 review for a branch already on the
/// repository (DD-118); the push itself is not part of this request. APPROVE_PULL_REQUEST
/// and the request-changes / inline-line variants of CREATE_PULL_REQUEST_COMMENT publish the
/// original labeled kind-1 review comments (desktop
/// pullRequestReviews.ts::submitProjectPullRequestReview,
/// hooks.ts::createProjectPullRequestComment) against the named review head; they introduce
/// no new Nostr kind (DD-118(5)). ATTACH_REPOSITORY (original useAttachProjectRepository /
/// useAddProjectRepository) republishes the signer's current 30621 head named by
/// targetEventId with one more member `a` coordinate; every other tag and the content are
/// kept. BIND_REPOSITORY_CHANNEL (original useBindProjectRepositoryChannel) republishes the
/// signer's current 30617 head with `buzz-channel` replaced by the admitted Workspace's
/// Channel. ADD_PROJECT_CHANNEL (original useAddProjectChannel) appends that Channel as a
/// `buzz-related-channel` tag to the signer's current 30621 head; the Channel itself is
/// created by the existing workspace.create action, never by this request. None of them
/// grants Git, Channel or project authority (REQ-24, DD-80, DD-118).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectsPublishRequest {
    /// Original inline diff anchor `line`: a 1-based line on the given side of the review diff.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_line: Option<i64>,

    /// Original inline diff anchor `file` (normalizeProjectPullRequestCommentAnchor):
    /// repository-relative, no leading slash, backslash, NUL, empty, `.` or `..` segment; at
    /// most 4096 UTF-16 code units. Only on CREATE_PULL_REQUEST_COMMENT, together with
    /// anchorSide, anchorLine and commit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_path: Option<String>,

    /// Original inline diff anchor `side`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_side: Option<ProjectPullRequestCommentSide>,

    /// Original transient display label, trimmed and limited to 128 Unicode characters by the
    /// consumer. Never an identity or authorization claim.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_label: Option<String>,

    /// Other HUMAN recipient of an original issue-author/repository-owner assignment. Resolved
    /// against the admitted Tenant's existing HUMAN identity directory; never a signing
    /// identity. Self operations do not accept this field.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_pubkey: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<WebMessageAttachment>>,

    /// Original complete markdown including attachment markdown. Issues may be empty; comments
    /// must be nonempty after trim. Current Relay NIP-11 and body admission limits are enforced
    /// before signing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,

    /// Original 1618 `branch-name`: the compare branch, already present on the Relay repository.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_name: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub category: Option<ProjectIssueCategory>,

    /// CREATE_REPOSITORY only: the original optional `clone` tag of a new repository
    /// announcement (AddProjectRepositoryDialog Clone URL). Only metadata: Kailo reads
    /// repository content through the 30617 coordinate (DD-118) and never fetches this URL.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clone_url: Option<String>,

    /// Original `c`. CREATE_PULL_REQUEST: compare branch head read from the trusted repository
    /// state. APPROVE_PULL_REQUEST and CREATE_PULL_REQUEST_COMMENT with reviewDecision or an
    /// anchor: the review head the reviewer looked at; the consumer refuses with
    /// TARGET_STATE_CONFLICT unless it is still the review's current trusted head. Required by
    /// those review comments and refused on ordinary comments.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<String>>,

    /// Original 1618 `merge-base`, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merge_base: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    pub operation: ProjectPublicationOperation,

    /// Optional immutable original per-self assignment operation head. Same publication intent
    /// retains it across UNKNOWN observation; never an authorization grant.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prior_event_id: Option<String>,

    /// Original pullRequestReviews.ts lifecycle states the UI may publish (NIP-34
    /// 1630/1633/1632). Merged (1631) happens through git and is never accepted here. Only the
    /// review author or repository owner signs it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pull_request_status: Option<ProjectPullRequestLifecycleStatus>,

    /// ATTACH_REPOSITORY only: the original NIP-34 repository coordinate added as a member `a`
    /// tag. A coordinate, never a clone URL or an access grant; the repository head may not
    /// exist yet when it is the first step of the original add-repository sequence.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repository_address: Option<String>,

    /// Original hooks.ts ProjectPullRequestCommentDecision on CREATE_PULL_REQUEST_COMMENT only:
    /// adds the `changes-requested` label. Only a requested reviewer or the repository owner,
    /// never the review author, may request changes on an open or draft review; readers trust
    /// nothing else (projectPullRequests.mjs).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_decision: Option<ProjectPullRequestCommentDecision>,

    /// Original requested reviewers (p tags beside the repository owner). Never a signing
    /// identity or grant.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewers: Option<Vec<String>>,

    /// Original 1618 `target-branch`: the base branch.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_branch: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_event_id: Option<String>,

    /// Original trimmed issue subject; the consumer additionally enforces the original
    /// JavaScript 256 UTF-16 code-unit limit.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<ProjectListingVisibility>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// Original inline diff anchor `side`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectPullRequestCommentSide {
    New,

    Old,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectIssueCategory {
    #[serde(rename = "change-request")]
    ChangeRequest,

    Improvement,

    Issue,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectPublicationOperation {
    #[serde(rename = "ADD_PROJECT_CHANNEL")]
    AddProjectChannel,

    #[serde(rename = "APPROVE_PULL_REQUEST")]
    ApprovePullRequest,

    #[serde(rename = "ASSIGN_ISSUE")]
    AssignIssue,

    #[serde(rename = "ATTACH_REPOSITORY")]
    AttachRepository,

    #[serde(rename = "BIND_REPOSITORY_CHANNEL")]
    BindRepositoryChannel,

    #[serde(rename = "CREATE_ISSUE")]
    CreateIssue,

    #[serde(rename = "CREATE_ISSUE_COMMENT")]
    CreateIssueComment,

    #[serde(rename = "CREATE_PROJECT")]
    CreateProject,

    #[serde(rename = "CREATE_PULL_REQUEST")]
    CreatePullRequest,

    #[serde(rename = "CREATE_PULL_REQUEST_COMMENT")]
    CreatePullRequestComment,

    #[serde(rename = "CREATE_REPOSITORY")]
    CreateRepository,

    Delete,

    #[serde(rename = "SELF_ASSIGN_ISSUE")]
    SelfAssignIssue,

    #[serde(rename = "SELF_UNASSIGN_ISSUE")]
    SelfUnassignIssue,

    #[serde(rename = "SET_PULL_REQUEST_STATUS")]
    SetPullRequestStatus,

    #[serde(rename = "UNASSIGN_ISSUE")]
    UnassignIssue,
}

/// Original pullRequestReviews.ts lifecycle states the UI may publish (NIP-34
/// 1630/1633/1632). Merged (1631) happens through git and is never accepted here. Only the
/// review author or repository owner signs it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectPullRequestLifecycleStatus {
    Closed,

    Draft,

    Open,
}

/// Original hooks.ts ProjectPullRequestCommentDecision on CREATE_PULL_REQUEST_COMMENT only:
/// adds the `changes-requested` label. Only a requested reviewer or the repository owner,
/// never the review author, may request changes on an open or draft review; readers trust
/// nothing else (projectPullRequests.mjs).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectPullRequestCommentDecision {
    #[serde(rename = "request-changes")]
    RequestChanges,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectListingVisibility {
    Listed,

    Unlisted,
}

/// Original Buzz Community project/repository announcements, coordinate-scoped work-item
/// events and tombstones. Reads do not authorize Git transport or mutations.
/// REPOSITORY_STATES returns the original trusted 30618 repository state (signed by the
/// coordinate owner or the Relay itself) for the requested 30617 coordinates.
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
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProjectsQueryRequestView {
    Deletions,

    Projects,

    Repositories,

    #[serde(rename = "REPOSITORY_STATES")]
    RepositoryStates,

    #[serde(rename = "WORK_ITEM_ACTIVITY")]
    WorkItemActivity,

    #[serde(rename = "WORK_ITEMS")]
    WorkItems,
}

/// 03/18: only the initiating HUMAN's fresh-authorized original Session facts. No PAT,
/// launch credential, native body or replacement revision is recoverable from this reader.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionView {
    pub action_execution_id: String,

    pub admitted_mode: ProtocolSessionMode,

    pub application_binding_id: String,

    pub base_revision: String,

    pub effective_editor_origins: Vec<String>,

    pub expires_at: String,

    pub launch_locale: ProtocolSessionLocale,

    pub launch_theme: ProtocolSessionTheme,

    pub protocol_session_id: String,

    pub reference: ContentReference,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_revision: Option<String>,

    pub state: ProtocolSessionReconcileRoundState,

    pub tenant_id: String,

    pub version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ProtocolSessionReconcileRoundState {
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
    pub attachments: Option<Vec<WebMessageAttachment>>,

    pub content: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mentions: Option<Vec<String>>,

    pub operation: PulsePublishRequestOperation,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_event_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PulsePublishRequestOperation {
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

/// DD-151(2)：GET /api/v1/push/capability（仅原生端）。部署是否配置了 APNs 与 FCM 凭据；只回读配置事实，不回显任何凭据字段。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PushCapability {
    pub apns: PushAvailability,

    pub fcm: PushAvailability,
}

/// DD-151(2)：本部署是否配置了该提供方的推送凭据。NOT_CONFIGURED 时客户端保留原版“此版本不可用”。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PushAvailability {
    Configured,

    #[serde(rename = "NOT_CONFIGURED")]
    NotConfigured,
}

/// DD-151(1)：PUT /api/v1/push/registration（仅原生端）。本设备登记、更新令牌或开关通知。proof 是本设备 CLIENT 私钥签名的
/// NIP-98 事件（u 为本路径、method 为 PUT、session 为当前 PlatformSession），设备公钥即 proof 的签名者，必须是本人 ACTIVE
/// 的设备公钥。expectedVersion 为 0 表示首次登记，其余按 DD-40 version CAS。token 明文只写入本 Tenant 的
/// OpenBao，任何回应、日志与审计都不回显。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRegistrationRequest {
    /// iOS bundle id 或 Android application id；必须与部署配置的推送主题一致。
    pub app_id: String,

    pub enabled: bool,

    pub expected_version: i64,

    /// 系统通知文案的语言；通知不含正文。
    pub locale: ProtocolSessionLocale,

    pub platform: PushPlatform,

    /// NIP-98 HTTP Auth 事件（kind 27235）。
    pub proof: HashMap<String, Option<serde_json::Value>>,

    /// APNs 设备令牌（十六进制）或 FCM 注册令牌。
    pub token: String,
}

/// DD-151(1)：设备推送登记的提供方。APNS 为 iOS，FCM 为 Android。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PushPlatform {
    #[serde(rename = "APNS")]
    Apns,

    #[serde(rename = "FCM")]
    Fcm,
}

/// DD-151(1)：本设备的推送登记（GET/PUT /api/v1/push/registration）。不含令牌或其摘要。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRegistrationView {
    pub app_id: String,

    pub device_pubkey: String,

    pub enabled: bool,

    pub locale: ProtocolSessionLocale,

    pub platform: PushPlatform,

    pub state: PushRegistrationState,

    pub updated_at: String,

    pub version: i64,
}

/// DD-151(1)(5)：ACTIVE 可投递；INVALID 是提供方报告令牌失效，重新登记新令牌后恢复；REVOKED 是设备公钥或成员资格撤销、Tenant
/// 删除后的终态，令牌已删除。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum PushRegistrationState {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "INVALID")]
    Invalid,

    #[serde(rename = "REVOKED")]
    Revoked,
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

/// Original reminder create/complete/snooze/cancel. Identity comes only from the
/// authenticated host; mutations select the actual current signed 30300 head. Source
/// messages are freshly authorized and read by the host; no caller-supplied preview, author,
/// kind, ciphertext or key is trusted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderPublishRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_before: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,

    pub operation: ReminderOperation,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_event_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ReminderOperation {
    #[serde(rename = "CANCEL")]
    Cancel,

    #[serde(rename = "COMPLETE")]
    Complete,

    #[serde(rename = "CREATE")]
    Create,

    #[serde(rename = "SNOOZE")]
    Snooze,
}

/// 原 Reminder 目标引用重新读取；字段只是查找键，必须重做当前用户、channel scope 与事件签名/归属检查，不能以已解密提醒或目录缓存授予正文读取。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSourceRequest {
    pub channel_id: String,

    pub event_id: String,
}

/// Original Buzz 30300 author-only encrypted reminder, decrypted only by its own SERVER or
/// local CLIENT identity. A transient Relay read, never a Core body record. Embedded target
/// metadata is a historical preview, not current authorization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderView {
    pub content: ReminderContent,

    pub created_at: i64,

    pub event_id: String,

    pub id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub not_before: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ReminderContent {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,

    pub status: ReminderStatus,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<ReminderTarget>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStatus {
    Cancelled,

    Done,

    Pending,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderTarget {
    pub author_pubkey: String,

    pub channel_id: String,

    pub event_id: String,

    pub preview: String,
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
    /// 当前 Workspace manage 与 workspace.member.add 目录均有效且已开放，目标在该 Workspace 没有未撤销的
    /// WorkspaceMembership（不存在或 REVOKED）；省略或 false 不显示添加动作，提交仍重新准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_add_to_workspace: Option<bool>,

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

    /// RFC3339，TenantMembership 的原始创建时间，用于原版 Added 日期；不是审批通过、激活或最近重新加入时间。只向具有 Tenant manage
    /// 的查看者提供，旧服务或仅 Workspace manage 时省略，客户端不编造日期。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,

    pub display_name: String,

    /// 有效 Tenant admin 仅剩此人；该人的撤销按钮禁用，服务端最终准入仍重查
    pub last_tenant_admin: bool,

    /// DD-139：同 Tenant 头像地址 <PUBLIC_ORIGIN>/api/v1/identity/avatars/<subject>（07 §4.7.3），只对有
    /// ACTIVE 外部身份的成员给出；只是地址，不含图片或资料正文，读取仍按该路由的 Tenant 准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,

    pub principal_id: String,

    /// 同一 Tenant、同一 HUMAN Principal 当前 ACTIVE 的 Buzz 身份公钥，按公钥排序；仅向具有 Tenant manage
    /// 的查看者提供非空列表，无有效绑定、旧服务或仅 Workspace manage 时省略。缺省不提供可读取资料的身份凭据，不以当前查看者或其他 Workspace 身份替代。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pubkeys: Option<Vec<String>>,

    pub tenant_admin: bool,

    /// 没有 workspaceId 时恒为 false
    pub workspace_admin: bool,
}

/// GET /api/v1/role-workspaces 的有界回应：当前 Principal 对哪些 Workspace 持有 fresh manage
/// permission（ACTIVE、暂停中、已暂停、恢复中、删除中，以及已有协作面 binding 的 ERROR，各带当前状态），并附当前可用的 Workspace
/// 创建、暂停、恢复与删除动作提示。动作提交仍由 Core 重新准入，不等于可进入频道。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleWorkspacePage {
    /// 当前 Principal 经 fresh Tenant create 检查可见的动作 key；目录未开放或无权时省略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub create_action_key: Option<RoleWorkspacePageCreateActionKey>,

    /// 下一页的 Core 索引偏移；不暴露无权 Workspace 的 ID，缺省即读完
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub workspaces: Vec<RoleWorkspaceView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RoleWorkspacePageCreateActionKey {
    #[serde(rename = "workspace.create")]
    WorkspaceCreate,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoleWorkspaceView {
    /// DD-150：当前 Principal 经 fresh Workspace manage 检查、目录已开放、Workspace 为 ACTIVE 或 SUSPENDED
    /// 且没有未终结的生命周期动作（编辑、暂停、恢复、删除）时给出；省略即不显示删除入口，提交仍由 Core 重新准入。删除进行中的 Workspace 以 state=DELETING
    /// 出现，直到删除链全部回读确认后从本页消失
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_action_key: Option<RoleWorkspaceViewDeleteActionKey>,

    pub id: String,

    /// 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
    /// ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lifecycle_action_key: Option<WorkspaceLifecycleActionKey>,

    pub name: String,

    pub state: WorkspaceState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum RoleWorkspaceViewDeleteActionKey {
    #[serde(rename = "workspace.delete")]
    WorkspaceDelete,
}

/// 当前 Principal 经 fresh Tenant manage 检查、按该 Workspace 当前状态可发起的暂停（ACTIVE 或
/// ERROR）或恢复（SUSPENDED）动作 key；目录未开放、无权、处于收敛中或本页提示判定失败时省略
///
/// Workspace 暂停与恢复的 ActionDefinition key（.design/06 §7.3）。两者都从 Tenant scope
/// 发起。删除（DD-150）不在本枚举：它不是可逆生命周期，经 RoleWorkspaceView.deleteActionKey 单独提示。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceLifecycleActionKey {
    #[serde(rename = "workspace.restore")]
    WorkspaceRestore,

    #[serde(rename = "workspace.suspend")]
    WorkspaceSuspend,
}

/// Workspace 状态机中对外可见的状态。权威定义见 .design/03-领域模型与权限模型.md。DD-150 的 DELETED 是 Core
/// 内的墓碑，不出现在任何对外视图中（列表与提示都不返回已删除的 Workspace），因此不在本枚举。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WorkspaceState {
    #[serde(rename = "ACTIVE")]
    Active,

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

    /// 当前 Tenant 的显示名，也就是其绑定 Community 的名称（01 §2：一个 Tenant 绑定一个
    /// Community），只用于界面上认出本人所在社区，不参与任何判定；读不到时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tenant_name: Option<String>,

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

/// PUT /api/v1/user-state/sidebar-assignments 的请求体（DD-125(5)）：原
/// assignChannel/unassignChannel。channelKey 是原生 Buzz Channel ID，必须属于本人当前是成员的 Workspace
/// 或参与中的私聊；sectionId 缺省即移出分区，给出时必须是现有分区。每人至多 1000 个归属（原
/// MAX_CHANNEL_SECTION_ASSIGNMENTS）。失去资格的归属保留但不呈现。version 不符即 409。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarAssignmentRequest {
    pub channel_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub section_id: Option<String>,

    pub version: i64,
}

/// PUT /api/v1/user-state/sidebar-sections/{sectionId} 的请求体（DD-125(5)、03
/// CollaborationUserState.sidebar_sections）：新建或改名原自定义频道分区；sectionId 由客户端以 UUID 生成。name
/// 去首尾空白后非空，icon 缺省即无图标，order 是原分区顺序。每人至多 100 个分区（原 MAX_CHANNEL_SECTIONS）。version 不符即
/// 409。DELETE 同一路径以 UserStateVersion 为请求体，同时清除指向该分区的归属与该分区的排序分组。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SidebarSectionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    pub name: String,

    pub order: i64,

    pub version: i64,
}

/// PUT /api/v1/user-state/sidebar-section-order 的请求体（DD-125(5)）：原
/// reorderSections/moveSectionUp/moveSectionDown 的结果顺序。sectionIds 必须恰为当前全部分区 ID 的一个排列，Core
/// 按下标写回 order。version 不符即 409。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarSectionOrderRequest {
    pub section_ids: Vec<String>,

    pub version: i64,
}

/// PUT /api/v1/user-state/sidebar-sort 的请求体（DD-125(5)、03
/// CollaborationUserState.sidebar_sort）：原分组排序。groupKey 只接受原固定分组 starred/channels/forums/dms
/// 或 section:<现有分区 ID>；每人至多 104 个分组（原 MAX_CHANNEL_SORT_GROUPS）。version 不符即 409。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SidebarSortRequest {
    pub group_key: String,

    pub mode: SidebarSortMode,

    pub version: i64,
}

/// 原 Buzz 侧栏分组排序（channelSortPreference.ts::ChannelSortMode）：alpha 按名称，recent
/// 按最近消息（DD-125(5)）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SidebarSortMode {
    Alpha,

    Recent,
}

/// DD-135(2)(3)：一次 Skill 上传的原始字节（标准 base64，两端同一 JSON 传输）。解码后不超过 1 MiB；编码只接受 SKILL.md、tar 或
/// tar.gz，由 Core 判定。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillArtifactUploadRequest {
    pub content_base64: String,
}

/// DD-135(2)(3)：上传校验结果。accepted 时给出一次性 uploadId、规范 artifact digest 与 frontmatter
/// 元数据；否则只给逐项违规，不暂存字节。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillArtifactUploadView {
    pub accepted: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_byte_size: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub artifact_digest: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<SkillArtifactEncoding>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub skill_name: Option<String>,

    pub skill_resource_id: String,

    /// 上传字节数。缺省条件同 uploadDigest。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_byte_size: Option<i64>,

    /// 上传字节的 SHA-256。请求体超过上限、上传未被完整读取时缺省（UPLOAD_TOO_LARGE）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_digest: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub upload_id: Option<String>,

    pub violations: Vec<SkillArtifactViolation>,
}

/// DD-135(2)：上传字节的编码。规范 artifact 恒为一个 SKILL.md，与上传编码无关。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SkillArtifactEncoding {
    #[serde(rename = "SKILL_MD")]
    SkillMd,

    Tar,

    #[serde(rename = "TAR_GZIP")]
    TarGzip,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SkillArtifactViolation {
    pub code: SkillArtifactViolationCode,

    /// 违规条目在上传包内的路径（不含正文）；与整体相关的违规省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// DD-135(2)(9)：上传校验的封闭违规码；与路径一起逐项返回，不含文件正文。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SkillArtifactViolationCode {
    #[serde(rename = "ARCHIVE_INVALID")]
    ArchiveInvalid,

    #[serde(rename = "CONTROL_CHARACTER")]
    ControlCharacter,

    #[serde(rename = "DESCRIPTION_TOO_LONG")]
    DescriptionTooLong,

    #[serde(rename = "DUPLICATE_SKILL_MD")]
    DuplicateSkillMd,

    #[serde(rename = "ENTRY_LIMIT_EXCEEDED")]
    EntryLimitExceeded,

    #[serde(rename = "EXECUTABLE_ENTRY")]
    ExecutableEntry,

    #[serde(rename = "EXPANDED_TOO_LARGE")]
    ExpandedTooLarge,

    #[serde(rename = "EXTRA_ENTRY")]
    ExtraEntry,

    #[serde(rename = "INVALID_FRONTMATTER")]
    InvalidFrontmatter,

    #[serde(rename = "LINK_ENTRY")]
    LinkEntry,

    #[serde(rename = "MISSING_DESCRIPTION")]
    MissingDescription,

    #[serde(rename = "MISSING_FRONTMATTER")]
    MissingFrontmatter,

    #[serde(rename = "MISSING_SKILL_MD")]
    MissingSkillMd,

    #[serde(rename = "NAME_MISMATCH")]
    NameMismatch,

    #[serde(rename = "NOT_UTF8")]
    NotUtf8,

    #[serde(rename = "SKILL_MD_TOO_LARGE")]
    SkillMdTooLarge,

    #[serde(rename = "SPECIAL_ENTRY")]
    SpecialEntry,

    #[serde(rename = "UNSAFE_PATH")]
    UnsafePath,

    #[serde(rename = "UNSUPPORTED_ENCODING")]
    UnsupportedEncoding,

    #[serde(rename = "UNSUPPORTED_FRONTMATTER_KEY")]
    UnsupportedFrontmatterKey,

    #[serde(rename = "UPLOAD_TOO_LARGE")]
    UploadTooLarge,
}

/// 同 Tenant 且当前 discover 允许的 Skill 定义页；nextOffset 续读同一排序。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinitionPage {
    pub definitions: Vec<SkillDefinitionView>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

/// DD-135(1)(4)：Tenant 级 Skill 定义与 Resource 事实；can* 只是当前 HUMAN 的 fresh 入口提示，提交时仍重验。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillDefinitionView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_disable: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_share: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_upload: Option<bool>,

    /// 本 Tenant 成员同时持有该定义的 discoverer 与 reader（DD-131(6)）。
    pub catalog_shared: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_published_version_asset_id: Option<String>,

    pub display_name: String,

    pub owner_principal_id: String,

    pub resource_id: String,

    pub resource_version: i64,

    pub stable_slug: String,

    pub status: SkillDefinitionStatus,
}

/// DD-135(1)、03 §7：SkillDefinition 状态。DISABLED 不可逆，DELETED 是 Tenant 销毁墓碑。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum SkillDefinitionStatus {
    #[serde(rename = "ACTIVE")]
    Active,

    #[serde(rename = "DELETED")]
    Deleted,

    #[serde(rename = "DISABLED")]
    Disabled,

    #[serde(rename = "PROVISIONING")]
    Provisioning,
}

/// DD-135(4)：AgentVersion 编辑器可选的 Skill 版本目录——当前 HUMAN fresh 可 read 的 ACTIVE 定义下的 PUBLISHED
/// 版本；不授予任何 Installation permission。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillReferencePage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub versions: Vec<SkillVersionView>,
}

/// DD-135(1)(2)：不可变 SkillVersion 的元数据；正文只经内容读取端点返回。state 与 AgentVersion 共用同一生命周期枚举。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillVersionView {
    pub artifact_byte_size: i64,

    pub artifact_digest: String,

    pub artifact_format: String,

    pub asset_id: String,

    pub asset_version: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_publish: Option<bool>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub can_retire: Option<bool>,

    pub capability_requirements: Vec<String>,

    /// 是所属定义当前的发布指针。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current: Option<bool>,

    pub description: String,

    pub metadata_hash: String,

    pub ordinal: i64,

    pub owner_principal_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub short_description: Option<String>,

    pub skill_name: String,

    pub skill_resource_id: String,

    pub stable_slug: String,

    pub state: AgentVersionState,
}

/// DD-135(4)(8)：一个可读版本的规范 SKILL.md 正文；读取即对该版本的 read，返回前以 digest 重算。不进入审计或日志。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillVersionContentView {
    pub artifact_digest: String,

    pub asset_id: String,

    pub content: String,
}

/// 一个 Skill 定义的版本页（ordinal 降序）；DRAFT 只对版本 Asset read 持有者列出。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillVersionPage {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,

    pub resource_version: i64,

    pub skill_resource_id: String,

    pub versions: Vec<SkillVersionView>,
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

/// GET /api/v1/tenant-member-joins 的有界回应（DD-125(9)）。每次请求 fresh 校验 Tenant manage，否则
/// PERMISSION_DENIED；不建立 ActionExecution、不写访问审计。不带 after 时 items 为空，只给当前游标供建账；带 after
/// 时按（进入时刻，membership）升序返回其后进入 ACTIVE 的其他成员，单页有上界。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantMemberJoinPage {
    /// 不透明位置，下一次作为 after 原样回传；空串表示起点（本 Tenant 尚无记下进入时刻的成员）。客户端不得解析或构造；格式非法时服务端回 400。
    pub cursor: String,

    /// 游标之后仍有未扫描的成员事实，应立即以新 cursor 续读；为 true 时本页 items 可能为空。
    pub has_more: bool,

    pub items: Vec<TenantMemberJoinView>,
}

/// 一名在游标之后进入 ACTIVE 的同 Tenant 其他 HUMAN 成员（DD-125(9)）。只含 Principal ID、显示名与进入时刻，不含公钥、IdP
/// 身份或邀请凭据；按 HUMAN Principal 计，新设备公钥（DD-77）不产生条目。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantMemberJoinView {
    pub display_name: String,

    /// TenantMembership 最近一次转入 ACTIVE 的时刻（重新加入覆盖），RFC3339 UTC；不是邀请或创建时间。
    pub joined_at: String,

    pub principal_id: String,
}

/// DD-158(3)：GET /api/v1/tenant/profile。会话 Tenant 的显示名、图标与版本，全体 ACTIVE 成员可读；本人有 Tenant
/// manage 时给出 updateActionKey（tenant.profile.update），提交仍由 Core 重新准入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantProfileView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    pub name: String,

    /// BFF_STREAM_RETRY_MILLIS 部署事实；在线资料读取中断后再次读取前的等待。afterVersion
    /// 查询只等待有限的再准入时间，回应前重新校验本人会话与成员资格。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_after_millis: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub update_action_key: Option<String>,

    pub version: i64,
}

/// DD-123: platform quota items of the Tenant read from OpenMeter (the only authority).
/// Tenant admin and auditor only.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantQuotaPage {
    pub quotas: Vec<TenantQuotaView>,

    /// Present only when the caller may set quotas now (Tenant manage); auditors read without it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set_action_key: Option<TenantQuotaPageSetActionKey>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantQuotaView {
    pub feature: TenantQuotaFeature,

    pub hard_limit: bool,

    pub has_access: bool,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit_per_period: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub period_reset_at: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TenantQuotaPageSetActionKey {
    #[serde(rename = "tenant.quota.set")]
    TenantQuotaSet,
}

/// PUT /api/v1/user-state/threads 的请求体（DD-40、DD-125(1)、03
/// CollaborationUserState.thread_preferences）。threadKey 为 thread:<Buzz root event id>，Core
/// 以本人 SERVER 身份回读根事件并核验当前 Workspace 成员或私聊参与资格。保留原联动：followed=true 记 FOLLOWED（关注即解除静音），false
/// 记 MUTED（取消关注即静音）；每人至多 500 条，超出淘汰最早写入的关注。version 是读到的 CollaborationUserState 版本，不符即 409。不是
/// Governed Action。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPreferenceRequest {
    pub followed: bool,

    pub thread_key: String,

    pub version: i64,
}

/// GET /api/v1/usage-billing：Tenant 或其中一个 Workspace 在区间内的用量与账单视图（.design/11 §6–7、.design/14
/// §7–8），调用方须对该范围持有 audit permission，每次 fresh Check。committed usage、额度与账单直接读 OpenMeter，Core
/// 不复制或聚合成账本；投递计数只来自 Core UsageEvent outbox。缺口用确定状态表达，不显示零或已结算。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBillingView {
    pub billing_state: UsageSectionState,

    pub customer_state: UsageCustomerState,

    pub delivery: Vec<UsageDeliveryCount>,

    pub entitlements: Vec<UsageEntitlementView>,

    pub entitlement_state: UsageSectionState,

    /// RFC3339，含
    pub from: String,

    pub invoices: Vec<UsageInvoiceView>,

    pub meters: Vec<UsageMeterView>,

    pub operation_usage: Vec<OperationUsageCount>,

    pub tenant_id: String,

    /// RFC3339，不含
    pub to: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

/// 用量与账单页中额度、账单两类 Customer
/// 级事实的读取结论。AVAILABLE：原生查询成功（列表可以为空）；UNAVAILABLE：原生查询失败或结果不可查证；TENANT_SCOPE_ONLY：所选
/// Workspace 视图不展示 Customer 级事实；NOT_PROVISIONED：Tenant 没有有效 Customer 映射。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UsageSectionState {
    Available,

    #[serde(rename = "NOT_PROVISIONED")]
    NotProvisioned,

    #[serde(rename = "TENANT_SCOPE_ONLY")]
    TenantScopeOnly,

    Unavailable,
}

/// 当前 Tenant 的 OpenMeter Customer 映射（DD-38、.design/11 §3）。ACTIVE：Core binding 有效且原生 Customer
/// 读回同 Tenant 且未删除；NOT_PROVISIONED：没有 binding；REVOKED：binding 已撤销；UNAVAILABLE：原生事实不可读或与
/// binding 不一致，结果不明。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum UsageCustomerState {
    Active,

    #[serde(rename = "NOT_PROVISIONED")]
    NotProvisioned,

    Revoked,

    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageDeliveryCount {
    pub count: i64,

    pub status: UsageSettlementStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntitlementView {
    /// 仅 metered；OpenMeter 十进制原文
    #[serde(skip_serializing_if = "Option::is_none")]
    pub balance: Option<String>,

    /// 原生 entitlement 类型原文
    pub entitlement_type: String,

    pub feature_key: String,

    pub has_access: bool,

    /// 仅 metered
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overage: Option<String>,

    /// 仅 metered；当前用量周期内的原生 usage
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usage: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageInvoiceView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,

    pub id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub issued_at: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub number: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_period_from: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_period_to: Option<String>,

    /// 原生 invoice status 原文；只有原生终态才可称为已结算
    pub status: String,

    /// 原生 totals.total 十进制原文
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageMeterView {
    /// 原生 meter 的聚合方式原文
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aggregation: Option<String>,

    /// ActionDefinition 登记的平台 meter 选择键
    pub meter_key: String,

    /// 仅 COMMITTED 时给出；OpenMeter 返回的十进制原文
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quantity: Option<String>,

    pub state: MeterUsageState,
}

/// 一个已登记 meter 在所选区间内的 OpenMeter committed usage 查询结论（.design/11 §7）。COMMITTED：原生查询返回该
/// Customer 的聚合值；NO_COMMITTED_USAGE：原生查询成功且区间内没有已存储事件；WORKSPACE_DIMENSION_UNAVAILABLE：原生
/// meter 未声明 workspace_id 维度，不能按 Workspace 归因；METER_NOT_REGISTERED：动作登记的 meter 在 OpenMeter
/// 中不存在或不唯一；UNAVAILABLE：查询失败或结果不可查证。后三者都不显示数值。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MeterUsageState {
    Committed,

    #[serde(rename = "METER_NOT_REGISTERED")]
    MeterNotRegistered,

    #[serde(rename = "NO_COMMITTED_USAGE")]
    NoCommittedUsage,

    Unavailable,

    #[serde(rename = "WORKSPACE_DIMENSION_UNAVAILABLE")]
    WorkspaceDimensionUnavailable,
}

/// CollaborationUserState 写入成功后的新版本（/api/v1/user-state/* 各 PUT/DELETE 的 200 回应）。DD-125 的
/// DELETE /api/v1/user-state/sidebar-sections/{sectionId} 与 DELETE
/// /api/v1/user-state/channel-templates/{templateId} 也以它为请求体：version 是读到的版本，不符即 409。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserStateVersion {
    pub version: i64,
}

/// GET /api/v1/workspaces/{workspaceId}/canvas（DD-125(4)、V-SCN-135）：BFF 以本人身份在已准入 Workspace
/// 的 Channel 下按 #h 读取 kind 40100，只采纳作者为该 Tenant CONTROL 的最新一条并验签；其他作者的 40100 一律忽略。正文原样透传，不进
/// Core 存储。没有采纳的事件时 content、eventId、createdAt 都省略（原“No canvas set”）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebChannelCanvasView {
    /// 原 Markdown 正文；空串表示管理者已清空。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,

    /// 被采纳事件的 created_at，RFC3339。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,

    /// 被采纳的 CONTROL 40100 事件 ID。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,

    /// 固定为 workspace.canvas.set：目录已开放、Workspace ACTIVE 且本人经 fresh Workspace manage 检查时给出（≙ 原
    /// canEditNarrative）。省略即不显示编辑入口；提交仍重新准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub set_action_key: Option<String>,

    pub workspace_id: String,
}

/// Own NIP-30 set mutation. The admitted host derives the signer and community; omitted
/// imageUrl removes only the caller's entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCustomEmojiMutation {
    pub expected_pubkey: String,

    pub idempotency_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,

    pub shortcode: String,
}

/// Verified original per-author kind:30030 snapshots, not a Core-owned emoji directory.
/// Clients apply the original deterministic community union.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebCustomEmojiView {
    pub events: Vec<HashMap<String, Option<serde_json::Value>>>,

    pub media_paths: HashMap<String, String>,

    pub pubkey: String,
}

/// GET /api/v1/gifs（DD-125(5)、09 §3、V-SCN-140）：原 GIF 选择器是否出现。available 仅在本 Tenant ACTIVE
/// TenantBuzzBinding 的 NIP-11 快照与运行期文档一致且广告 buzz-gif/gif（provider klipy，原 /gifs/search 与
/// /gifs/share）、并且部署登记了至少一个 GIF 图片来源时为 true；否则按原版不出现。imageOrigins 是部署登记的 https 来源（与 Web 静态
/// CSP img-src 追加项同一份），Web 只对这些来源内联渲染无 imeta 的 GIF；KLIPY 密钥只在 Relay 部署环境。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebGifCapabilityView {
    pub available: bool,

    pub image_origins: Vec<String>,
}

/// POST /api/v1/gifs/search：BFF 以本人身份经 NIP-98 转发 Relay 原 /gifs/search（成员门与 GIF 限速由 Relay
/// 执行，超额以 LIMIT 类回应）。query 为空即原 trending，至多 200 字符；locale 为浏览器语言（1–32 字符）。原 KLIPY
/// customer_id 由 BFF 按 Tenant 与本人 Principal 派生为稳定匿名标识，Browser 不提供。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebGifSearchRequest {
    pub locale: String,

    pub query: String,
}

/// POST /api/v1/gifs/search 的回应：原 Relay 固定一页（24 项）结果，按提供方顺序。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebGifSearchView {
    pub gifs: Vec<WebGifItem>,
}

/// 原 normalizeKlipyGifs 的一项（BFF 归一化，Browser 不接收提供方原始 JSON）：original 取 md/hd/sm/xs 的首个完整
/// gif，preview 取 sm.webp/sm.gif/xs.webp/xs.gif/md.webp 或 original，poster 取首个完整 jpg。所有地址都是
/// https 且来源在部署登记的 GIF 图片来源之内，否则该项不返回。发送时原版把 url 以 ![image](url) 追加到正文，不带 imeta。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebGifItem {
    pub height: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub poster_url: Option<String>,

    pub preview_height: i64,

    pub preview_url: String,

    pub preview_width: i64,

    pub size: i64,

    pub slug: String,

    pub title: String,

    pub url: String,

    pub width: i64,
}

/// POST /api/v1/gifs/share（原选择时的分享上报，尽力而为）：BFF 以本人身份经 NIP-98 转发 Relay 原 /gifs/share，成功回
/// 204。slug 为 1–200 字符。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebGifShareRequest {
    pub slug: String,
}

/// DD-39/72/75：本人原 Relay mentions feed。Core 逐项核验当前资源准入、签名和频道线程归属；不接受身份、scope 或任意 Relay
/// filter。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebInboxQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,
}

/// POST /api/v1/workspaces/{workspaceId}/link-previews 与
/// /api/v1/conversations/{conversationId}/link-previews（DD-125(5)、09 §3、V-SCN-139）：Web 原
/// composer 的链接预览抓取由 BFF 代为执行。只接受 http/https 与默认端口；BFF 每一跳在 DNS 解析后拒绝回环、私网、链路本地、CGNAT、组播、ULA
/// 与部署登记的内部网段，只连接已校验地址，至多 3 次跳转、256 KB，不带 cookie 与凭据；按 Principal 限速，超额以 LIMIT
/// 类拒绝；预览图以本人身份上传为 Relay 媒体。审计只记主机与 URL 摘要。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebLinkPreviewRequest {
    /// 原 extractSupportedLinkPreviews 识别出的链接（http/https）。
    pub url: String,
}

/// BFF 为本人短期持有的一份链接预览快照（DD-125(5)）。字段即原 11 元素 link-preview snapshot 标签的内容（版本 1）：canonicalUrl
/// 为 https、无凭据与片段；title 不超过 300 字节、siteName 100 字节、description 1000 字节；imageUrl/faviconUrl
/// 是本人上传的 Relay 媒体地址，缺省即无图。发布请求只能以 snapshotId 引用本人未过期的快照（linkPreviewSnapshotIds），Browser
/// 不提交原始标签。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebLinkPreviewSnapshotView {
    pub canonical_url: String,

    pub description: String,

    /// 快照失效时刻，RFC3339；之后发布引用它以 TARGET_NOT_FOUND 拒绝。
    pub expires_at: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub favicon_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,

    pub site_name: String,

    pub snapshot_id: String,

    pub title: String,

    /// 请求的链接，原样回显，供 composer 与正文中的链接对应。
    pub url: String,
}

/// Typed read of authors proven by signed events in one currently admitted channel or
/// private conversation. No caller-selected pubkey or Relay filter; Core partitions Relay
/// reads by its existing page/NIP-11 limits.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebMessageAuthorQuery {
    pub event_ids: Vec<String>,
}

/// Exact event-id keyed profiles from one fresh admitted read. Every requested message must
/// be verified; a missing kind:0 is an empty profile, while missing message proof fails the
/// whole read. No profile body is persisted by Core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebMessageAuthorView {
    pub profiles: HashMap<String, WebProfileView>,
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
    /// 原 Inbox Agents：仅 Workspace 内读取本人拥有且 ACTIVE 的既有安装作者消息；Core fresh read 解析其公开签名身份，不接受任意
    /// author。不得与线程读取或其他消息类型组合。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_installation_id: Option<String>,

    /// 原 Inbox item 冷定位：仅在路径指定并 freshly admitted 的 Workspace/Conversation 内验证精确 Stream/Forum
    /// 消息及线程祖先。不能与其他 messageType、parentEventId、agentInstallationId 或分页游标组合；不是全局 event
    /// 读取或权限证明。缺省保持原窗口/线程语义。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_event_id: Option<String>,

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

/// DD-120: only snapshot events signed by the Relay itself whose single p tag is a requested
/// pubkey bound in this Tenant. A pubkey without a fact is absent, never reported offline.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebPresencePage {
    pub presences: Vec<WebPresenceView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPresenceView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<i64>,

    pub pubkey: String,

    pub status: WebPresenceStatus,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebPresenceStatus {
    Away,

    Offline,

    Online,
}

/// DD-120: presence for the requested pubkeys from the Relay-signed 20001 snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebPresenceQueryRequest {
    pub pubkeys: Vec<String>,
}

/// DD-120: the person's own presence heartbeat or manual choice. Core signs the original
/// kind 20001 with the person's SERVER key over the existing NIP-42 session connection;
/// latest wins, not stored, never reconciled by event ID. offline releases the presence
/// lease.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebPresenceUpdateRequest {
    pub status: WebPresenceStatus,
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

/// Web HUMAN 的原 Buzz 消息语义输入；身份、Channel、回复祖先与 mention 公钥均由 BFF 在原 scope 中解析，不接受 raw tags 或
/// signed event。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebPublishMessageRequest {
    /// DD-148 原 Agent 收件人栏：须为同一请求 mentionInstallationIds 的子集（否则 SCOPE_GUARD_FAILED 前的 400）；BFF
    /// 排序去重并冻结于同一发布意图（幂等重放逐项比较），对其中经准入并实际投递的 Installation 的 AGENT 公钥签原版 ["mention", <pubkey>,
    /// "agent-address"] 标签，与 p 并存，只作呈现元数据，不改变通知或 agent.invoke 准入；与
    /// editEventId、deleteEventId、sendToChannelSourceEventId 互斥，私聊目标拒绝。缺省为空。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub addressed_installation_ids: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<WebMessageAttachment>>,

    pub content: String,

    /// 删除本人原 Buzz 消息；BFF 回读当前 Channel 原事件核对本人签名身份，发原 kind 5。与
    /// editEventId、parentEventId、非空正文、附件及提及互斥；不授予 kind 9005 管理员删除权限。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delete_event_id: Option<String>,

    /// 编辑原 Buzz 消息；BFF 回读同 Channel 原事件并核对本人签名身份，发原 kind 40003。与 parentEventId 互斥，缺省保持原新消息语义。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit_event_id: Option<String>,

    /// DD-125(5) 原 composer 链接预览：本人经 BFF 抓取得到、尚未过期的快照 ID（至多 8 个，去重保序）。只用于新的 STREAM
    /// 消息（kind:9，含线程回复）：BFF 只接受本人的快照，按原 11 元素 link-preview snapshot 标签随该消息发布并把 ID
    /// 冻结在发布幂等记录；canonicalUrl 不在正文中的快照按原接收规则不签入（正文照常发布）；引用他人或已过期的快照以 TARGET_NOT_FOUND 拒绝。与
    /// suppressLinkPreviews、editEventId（原编辑不带快照）、deleteEventId、sendToChannelSourceEventId 互斥；不接受
    /// Browser 提交的原始 link-preview 标签。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_preview_snapshot_ids: Option<Vec<String>>,

    /// 用户明确选中的本 Workspace Installation；缺省为空，BFF 排序去重并冻结于原发布幂等记录。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mention_installation_ids: Option<Vec<String>>,

    /// 原 Buzz HUMAN 提及的精确公钥；缺省为空。BFF 核对当前 Tenant、消息目的地成员及 ACTIVE 身份，排序去重冻结在原发布幂等记录；不接受 Agent
    /// 公钥绕过 Installation 准入。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mention_pubkeys: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_type: Option<WebMessageType>,

    /// 原 Relay 消息引用；BFF 在当前 Channel 回读验签并解析 NIP-10 祖先。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_event_id: Option<String>,

    /// DD-125(8) 原“不邀请直接发送 / 仍然发送”：被提及但不是该 Workspace ACTIVE 成员、且本次不邀请的 HUMAN 公钥；缺省为空。只用于
    /// Workspace 的新消息（含线程回复），与 mentionPubkeys 不相交，与
    /// editEventId、deleteEventId、sendToChannelSourceEventId 互斥，私聊目标拒绝。BFF 校验每个公钥都是同 Tenant
    /// ACTIVE HUMAN Principal（TenantMembership ACTIVE）的 ACTIVE 公钥（不要求目的地成员资格，否则
    /// PERMISSION_DENIED），签原版 ["mention", <pubkey>] 引用标签，排序去重后冻结进同一发布意图（幂等重放逐项比较）；不发 p、不通知、不进入
    /// Inbox，也不授予读取或成员资格，接收方只用它解析 @名字 的显示。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_mention_pubkeys: Option<Vec<String>>,

    /// DD-125(1) 原“发送到频道”：当前 Channel 中一条线程回复的 Relay 事件 ID。BFF 回读该回复，要求作者为本人或本人是其 Installation
    /// owner，按原 getSendToChannelSemantics 只复制正文与 emoji/imeta/link-preview/mention
    /// 标签、重算提及并排除源作者，由线程根按原截断规则生成 buzz:sent-from-thread，以本人身份发一条新的顶层 kind:9，沿 DD-81 幂等与对账。与
    /// parentEventId、editEventId、deleteEventId 互斥；content 须为空且不带附件、提及或 Installation
    /// 提及——正文与标签只取自回读的源事件，不接受 Browser 提交的原始标签。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub send_to_channel_source_event_id: Option<String>,

    /// DD-125(5) 原 link-preview none：为 true 时签发唯一的 ["link-preview", "none"] 标签，接收方不显示预览。与
    /// editEventId 同用即原“对所有人移除预览”（本人消息的 40003 编辑）。省略或 false 不加该标签。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suppress_link_previews: Option<bool>,
}

/// Web HUMAN 修改已准入 Workspace 对应 Channel 的原主题（DD-119、09 §3）。BFF 以本人 SERVER 身份按 DD-81 签发严格
/// h+topic 两标签的 kind 9002，幂等键沿原发布的 Idempotency-Key 请求头；不接受 raw tags、signed event
/// 或任何管理标签。结果不明只对账不重签；已归档 Channel 不接受。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebPublishTopicRequest {
    /// 原频道主题；空字符串清空主题，不改变频道名称、描述、TTL 或成员。
    pub topic: String,
}

/// DD-39 / REQ-24：原 Buzz TopbarSearch 的语义查询。Core 以本人 SERVER 身份向原 Relay FTS 查询，只在当前已准入
/// Channel/DM 范围内读取；不接受任意 Relay filter、租户或身份。页与 frame 上界来自已核验 NIP-11 和既有 BFF 配置。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchQuery {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub authors: Option<Vec<String>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<i64>,

    pub q: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub since: Option<i64>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<i64>,
}

/// DD-120(1)：线程内输入中提示的类型化线程引用，POST /api/v1/workspaces/{workspace_id}/typing 与
/// /api/v1/conversations/{conversation_id}/typing 的可选请求体；缺省请求体即主频道输入。Core 以本人 SERVER 身份签发原版
/// kind 20002：唯一 h 标签取自已准入的 scope，按原 buildThreadReferenceTags 追加 e root/reply 标签；不接受 raw
/// tags、频道或身份。瞬时事件最新者为准，超时不报成功也不重签。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebTypingRequest {
    /// 原 typingParentEventId：线程面板的 thread head 事件 ID（64 位小写十六进制），成为 e reply 标签
    pub parent_event_id: String,

    /// 原 typingRootEventId：thread head 所在线程的根事件 ID；缺省或等于 parentEventId 时只发 e reply 标签
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_event_id: Option<String>,
}

/// DD-120: the latest verified 30315 per requested pubkey; empty content means cleared and
/// is omitted.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebUserStatusPage {
    pub statuses: Vec<WebUserStatusView>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebUserStatusView {
    pub created_at: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,

    pub event_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,

    pub pubkey: String,

    pub text: String,
}

/// DD-120: the original NIP-38 kind 30315 `d=general` statuses for the requested pubkeys.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebUserStatusQueryRequest {
    pub pubkeys: Vec<String>,
}

/// DD-120: the person's own original NIP-38 30315 (`d=general`, optional `emoji` and
/// `expiration` tags), published by Core with the SERVER key under DD-81 (Idempotency-Key
/// header). Empty text clears the status.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebUserStatusUpdateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<i64>,

    pub text: String,
}

/// POST /api/v1/workspace-activity 的回应：按请求顺序给出每个 Workspace 的原生 Channel ID 与经签名、scope
/// 与窗口边界核验的首页事件，语义与单个 GET /workspaces/{id}/messages 首页相同。任一项准入或核验失败即整次失败，不返回部分结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebWorkspaceActivityPage {
    pub items: Vec<WebWorkspaceActivity>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebWorkspaceActivity {
    pub channel_id: String,

    pub events: Vec<HashMap<String, Option<serde_json::Value>>>,

    pub workspace_id: String,
}

/// POST /api/v1/workspace-activity：一次读取调用方多个已加入 Workspace 的原版频道窗口首页（侧栏最近活动与未读、Inbox
/// 原兴趣规则的输入），对应固定 Buzz desktop/src-tauri/src/commands/channels/fetch.rs 的批量 last-message
/// 查询。每项仍单独做 HUMAN 协作准入；同一请求内 Workspace 不得重复。messageType 只接受频道窗口的 STREAM 或 FORUM_POST。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WebWorkspaceActivityQuery {
    pub items: Vec<WebWorkspaceActivityTarget>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebWorkspaceActivityTarget {
    pub message_type: WebMessageType,

    pub workspace_id: String,
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

    /// 可选的既有原生对象受控归属证据；复用同一绑定事实结构，仅供既有resource.create核验，不授予权限或创建原生对象。无登记证据时省略，不投递空数组。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bindings: Option<Vec<ApplicationProtocolPeerBindingDelivery>>,

    pub max_response_bytes: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_url: Option<String>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_credential_deliveries: Option<Vec<ApplicationModelCredentialDelivery>>,

    /// 受控原生浏览器认证信任投递；IdP只认证HUMAN，不承载实例业务许可。绑定、ACTIVE成员与SpiceDB实时检查决定权限；不由请求提供issuer/subject/key
    /// URL。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_human_identities: Option<Vec<ApplicationNativeHumanIdentity>>,

    pub native_instance_ref: String,

    pub secret_readers: Vec<ApplicationSecretReader>,

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
    pub native_credentials: Option<Vec<ApplicationPeerCredentialDelivery>>,

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
pub struct ApplicationPeerCredentialDelivery {
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
pub struct ApplicationNativeHumanIdentity {
    pub audience: String,

    pub binding_id: String,

    pub config_digest: String,

    pub generation: i64,

    pub identity_provider_id: String,

    pub jwks_file: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationSecretReader {
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
    pub secret_readers: Option<Vec<ApplicationSecretReader>>,

    pub timeout_seconds: i64,
}

/// DD-92: modelGateway within the approved binding config. Only existing route and meter
/// references; no provider configuration, credential value or native model row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationModelGatewayConfig {
    pub meter_keys: Vec<String>,

    pub route_resource_ids: Vec<String>,
}

/// DD-102 / ADR-12：能力契约固定的机器向量。每个 case 按 steps 顺序执行契约操作，参数与预期结果是实际
/// JSON，不执行文本代码。格式有效不表示组件套件通过；线协议性质、真实执行与 release 证据关联另行核验。DD-124：V2 的每个值只来自
/// LITERAL、PRECONDITION 或 CAPTURE；generatedRefs、preconditionKinds、preconditions、bindings 与
/// captures 只属于 V2，V1 仍按原规则执行。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityConformanceVectors {
    pub cases: Vec<CapabilityConformanceVectorsCasesItem>,

    pub format_version: CapabilityVectorFormat,

    /// V2 only. Contract fields whose values the implementation generates (opaque non-empty
    /// strings). nativeRevision is always implementation-generated and need not be listed. A
    /// listed position present in a step document may never be LITERAL; EXPECTED entries are the
    /// only output fields a GENERATED_REF capture of a FORWARD step may read. A step of a
    /// RECEIVER case is not sent by the production Core: its input is the admission the isolated
    /// Core produced, so a GENERATED_REF capture of that step reads an INPUT entry of its own
    /// contract key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub generated_refs: Option<Vec<CapabilityVectorGeneratedRef>>,

    /// V2 only. Closed list of native object kinds a case may declare as preconditions and the
    /// properties each must verify by a literal expectation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub precondition_kinds: Option<Vec<CapabilityVectorPreconditionKind>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityConformanceVectorsCasesItem {
    pub case_key: String,

    /// V2 only; absent means FORWARD. A RECEIVER case (DD-124(3)(4)) runs entirely in the
    /// isolated deployment; the production plan observes each of its steps only through
    /// receiver_start/receiver_observe and accepts the isolated Core's execution and operation
    /// ids, both read_receipts, native batch or execution and native terminal evidence, never
    /// business results: every step names the receiver Resource by referenceResourceKey and
    /// expects {}. Every platform Resource id of the case, typed or a
    /// resourceId/sourceResourceId/assetId member of a step document, is a PRECONDITION. A step
    /// input is the admission the isolated Core performs: it may bind the step's own
    /// ACTION_EXECUTION_ID, OPERATION_ID or GENERATED_REF captures and earlier steps' captures,
    /// which the isolated deployment supplies from its own run. The case as a whole carries the
    /// source reads; Core compares a step's input with the admission whenever its evidence has
    /// reads.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<CapabilityVectorCaseDirection>,

    /// V2 only. Native objects the isolated fixture creates through the candidate's own native
    /// entry before the run; the fixture supplies only their actual identifiers. Every
    /// registered property of the kind is declared with its literal value and verified by a
    /// later literal expectation of this case; in a RECEIVER case, whose expectations are {}, by
    /// a literal member of a later step input, which Core compares with the isolated admission.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preconditions: Option<Vec<CapabilityVectorPrecondition>>,

    pub steps: Vec<CapabilityConformanceVectorsCasesItemStepsItem>,
}

/// V2 only; absent means FORWARD. A RECEIVER case (DD-124(3)(4)) runs entirely in the
/// isolated deployment; the production plan observes each of its steps only through
/// receiver_start/receiver_observe and accepts the isolated Core's execution and operation
/// ids, both read_receipts, native batch or execution and native terminal evidence, never
/// business results: every step names the receiver Resource by referenceResourceKey and
/// expects {}. Every platform Resource id of the case, typed or a
/// resourceId/sourceResourceId/assetId member of a step document, is a PRECONDITION. A step
/// input is the admission the isolated Core performs: it may bind the step's own
/// ACTION_EXECUTION_ID, OPERATION_ID or GENERATED_REF captures and earlier steps' captures,
/// which the isolated deployment supplies from its own run. The case as a whole carries the
/// source reads; Core compares a step's input with the admission whenever its evidence has
/// reads.
///
/// DD-124(3)(4): the direction of a whole V2 case. FORWARD cases are driven by the
/// production Core probe execute. RECEIVER marks a case that depends on the service read
/// edge (an ingest consuming a source through READ_EDGE, a NATIVE_MANAGED receiver key):
/// every step of it runs in the isolated deployment of 07 §8A and the production plan only
/// observes each step through receiver_start/receiver_observe; steps are never split between
/// the directions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CapabilityVectorCaseDirection {
    #[serde(rename = "FORWARD")]
    Forward,

    #[serde(rename = "RECEIVER")]
    Receiver,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityVectorPrecondition {
    pub key: String,

    pub kind: String,

    pub properties: Vec<CapabilityVectorPreconditionProperty>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityVectorPreconditionProperty {
    pub name: String,

    pub value_json: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityConformanceVectorsCasesItemStepsItem {
    /// V2 only. Every reserved placeholder in inputJson/expectedOutputJson is declared here
    /// exactly once.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bindings: Option<Vec<CapabilityVectorBinding>>,

    /// V2 only. Values this step's SUCCEEDED observation with complete native terminal evidence
    /// provides to later steps.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captures: Option<Vec<CapabilityVectorCapture>>,

    pub contract_key: String,

    pub expected_output_json: String,

    pub input_json: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_asset_id: Option<String>,

    /// V1 only. 只引用同 case 已成功的更早 stepKey 的唯一 typed ContentReference；不得指定 JSON 路径或表达式。与固定
    /// Resource/Asset 目标一起进入规范化参数 hash。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_from_step_key: Option<String>,

    /// Literal platform Resource id of the step target. DD-124(4): a RECEIVER case never names a
    /// platform Resource by literal; it uses referenceResourceKey.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_resource_id: Option<String>,

    /// V2 only. Key of a PRECONDITION of this case whose fixture value is the step's reference
    /// Resource id; Core freezes that value into the plan step's referenceResourceId. DD-124(4):
    /// in a receiver-direction case it is the id the isolated Core's real resource.create (DD-98
    /// existing native reference) returned. Mutually exclusive with referenceResourceId,
    /// referenceAssetId and referenceFromStepKey; it counts as this step sending that
    /// precondition.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reference_resource_key: Option<String>,

    pub step_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CapabilityVectorFormat {
    V1,

    V2,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityVectorGeneratedRef {
    pub contract_key: String,

    pub pointer: String,

    pub side: CapabilityVectorSide,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CapabilityVectorPreconditionKind {
    pub description: String,

    pub kind: String,

    pub properties: Vec<String>,
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

    /// 仅隔离原生接收方套件：原 receiver ServicePrincipal 的受控 OIDC 投递，逐 binding/generation 选择；不是生产绑定注册表，不转发
    /// Worker 的平台 bearer。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_read_authorities: Option<Vec<ComponentNativeReadAuthority>>,

    /// DD-124(4)：仅隔离部署内 APPLICATION 接收方动作（省略 importConfigRef 的
    /// receiver_start/receiver_observe）。平台维护的隔离部署入口 origin，不是候选 adapter；它以隔离 HUMAN 经隔离 Core 原
    /// Action Admission 准入与派发并观察该动作。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_action_base_url: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNativeReadAuthority {
    pub binding_id: String,

    pub core_base_url: String,

    pub generation: i64,

    pub oidc_client_id: String,

    pub oidc_client_secret_file: String,

    pub oidc_token_url: String,
}

/// 隔离开发环境受控投递的协议夹具数据，不来自登记请求。Core 只采用固定协议用例并核对全部必需覆盖；没有脚本、条件、路径表达式或通过声明。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceFixture {
    pub artifact_digest: String,

    /// 接收方向步骤（V1 NATIVE_INTERNAL/NATIVE 契约步骤，V2 direction=RECEIVER case 的每个步骤）各恰一项的冻结接收方请求；Core
    /// 以计划步骤幂等键替换 idempotencyKey。DD-124(4)：NATIVE_MANAGED 键的请求携带与已代入向量输入一致的
    /// importConfigRef；APPLICATION 接收方动作省略它。请求只是隔离部署内的启动/观察引用，不含任何执行、operation 或批次标识。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receivers: Option<Vec<ComponentNativeReceiverFixture>>,

    /// DD-124(1)：V2 契约 case 声明的前置原生对象取值。只能是候选实现原生入口创建时实际返回的标识（接收方向 case 的平台 Resource 前置值为隔离 Core
    /// 经真实 resource.create 登记既有原生引用后返回的 Resource ID，DD-124(4)）；Core
    /// 在冻结计划时代入，并核对每个声明恰有一个取值。不是期望值来源。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub preconditions: Option<Vec<ComponentConformancePreconditionValue>>,

    pub steps: Vec<ComponentConformanceStep>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentNativeReceiverFixture {
    pub case_key: String,

    pub contract_key: String,

    pub request: ComponentNativeReceiverRequest,

    pub step_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformancePreconditionValue {
    /// 计划内 case 键 <categoryKey>:<contractVersion>:<caseKey>。
    pub case_key: String,

    pub key: String,

    pub value: String,
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

    /// DD-124(4)：计划含 receiver_start/receiver_observe 步骤时必填；固定隔离接收方部署的 Core 构建与来源
    /// release，随身份摘要进入原计划。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receiver_environment: Option<ComponentConformanceReceiverEnvironment>,

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

    pub operation: ComponentConformanceOperation,

    /// 业务上下文必填并与版本成对；确切 application_binding.create 的 handshake/validate_binding
    /// 管理上下文必须省略两字段，不授业务内容访问。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_exposure_policy_id: Option<String>,

    /// 业务上下文必填；结果为 NONE 的确切绑定管理上下文必须与策略 ID 一起省略。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result_exposure_policy_version: Option<i64>,

    pub step_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_id: Option<String>,

    pub target_type: String,

    pub tenant_id: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
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
    pub native_credentials: Option<Vec<ApplicationPeerCredentialDelivery>>,

    pub read_only_tools: Vec<String>,

    pub timeout_seconds: i64,
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

    /// 仅随 PUBLISH_REJECTED：Relay 以社区禁言或封禁拒绝本人内容写入时的结构化原因，供原禁言横幅倒计时（DD-125(2)、V-SCN-129）。只来自
    /// Relay 对本人这次写入的拒绝文本，不是限制列表读取；其他拒绝缺省。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub restriction: Option<PublishRestriction>,
}

/// 仅随 PUBLISH_REJECTED：Relay 以社区禁言或封禁拒绝本人内容写入时的结构化原因，供原禁言横幅倒计时（DD-125(2)、V-SCN-129）。只来自
/// Relay 对本人这次写入的拒绝文本，不是限制列表读取；其他拒绝缺省。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishRestriction {
    pub kind: PublishRestrictionKind,

    /// TIMED_OUT 的到期时刻（RFC3339，取自 Relay 拒绝文本的 unix 秒）；BANNED 或拒绝文本未给出可解析时刻时缺省
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
}

/// Relay 以社区限制拒绝本人内容写入的类别（DD-125(2)）：TIMED_OUT 对应 `restricted: you are timed out until
/// <ts>`，BANNED 对应 `blocked: you are banned from this community`。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PublishRestrictionKind {
    Banned,

    #[serde(rename = "TIMED_OUT")]
    TimedOut,
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

    pub reference: ContentReference,

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

/// 03 §7 的平台发布 Catalog 投递，不是用户 Resource 或 Agent 注册表。部署没有提供实际合同、凭据链与 runtime 对账证据时不得填 ACTIVE。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RuntimeProfileDirectory {
    pub profiles: Vec<RuntimeProfileDirectoryProfilesItem>,
}

/// Workflow 经 ProjectTaskState Activity 写回 Core 的一次状态跃迁（.design/06 §3.1）。Core 按 workflowId
/// 单调 upsert，eventId 不大于已有值的报告按幂等成功忽略。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStateReport {
    /// AgentTask 的 ProjectAgentTaskState Activity 原生执行 ID，仅由 ActivityInfo 投递。Core
    /// 校验同固定执行链的已调度载荷后生成步骤投影；旧 writer/修复报告缺省时保留原轨迹，不推测或清空。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub activity_id: Option<String>,

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
    pub approval_input: Option<ApprovalWorkflowInput>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub approval_workflow_id: Option<String>,

    /// 同不可变自动化版本的下一 Delay；Core 须读回原 execution chain 的 TimerFired 才允许后续副作用。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delay_step: Option<AgentTaskAdvanceResultDelayStep>,

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
pub struct ApprovalWorkflowInput {
    pub action_definition_version: i64,

    pub action_execution_id: String,

    pub action_key: String,

    pub affected_owner_refs: Vec<AffectedOwnerRef>,

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
    pub resume: Option<ApprovalResume>,

    pub role_requirements: Vec<ApprovalRoleRequirement>,

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
pub struct AffectedOwnerRef {
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
pub struct ApprovalResume {
    /// RFC3339，UTC
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consumed_at: Option<String>,

    /// RFC3339，UTC。进入 APPROVED 时确定，续跑不重算
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consume_deadline: Option<String>,

    pub decisions: Vec<ApprovalDecisionRecord>,

    /// 此前各 run 的 history 长度之和。投影的 event_id 按 workflow ID 单调去重，新 run 的 history
    /// 从零数起，不加上它续跑后的投影会被当成旧事件丢掉
    pub event_base: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<ReasonCode>,

    pub refusals: Vec<ApprovalRefusal>,

    pub status: ApprovalStatus,
}

/// 一位 approver 的资格已被 FreshApprovalAdmission 判定为不通过：同一 Update ID 的重发回答同一结论，不再判定（.design/06
/// §4）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRefusal {
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
#[serde(rename_all = "camelCase")]
pub struct AgentTaskAdvanceResultDelayStep {
    pub id: String,

    pub seconds: i64,

    /// 显式 Delay 步骤时限；独立原生 Timer，不替换 seconds。缺省走原 history 分支。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingAdvanceRequest {
    pub cancel_requested: bool,

    pub run_id: String,

    pub target: ApplicationBindingTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplicationBindingTarget {
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

/// decide Update 的参数。Update ID 固定为 <approval_workflow_id>:<approver_principal_id>，由 Server
/// 侧去重；approverPrincipalId 由 Core 从 PlatformSession 取得，不接受 Browser 自报。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalDecisionUpdate {
    pub approver_principal_id: String,

    pub decision: ApprovalDecision,
}

/// invalidate Update 的参数：Core 在批准后重新准入不通过时发出（.design/06 §4）。Update ID 固定为
/// <action_execution_id>:invalidate。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ApprovalInvalidateUpdate {
    pub reason: ReasonCode,
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

    pub decisions: Vec<ApprovalDecisionRecord>,

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
    pub input: AutomationScheduleTaskInput,

    pub run_id: String,

    pub workflow_id: String,
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
    pub task_input: Option<AgentTaskWorkflowInput>,
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
pub struct ComponentActionAdvanceRequest {
    pub cancel_requested: bool,

    pub run_id: String,

    pub target: ComponentActionTarget,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentActionAdvanceResult {
    pub action_execution_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
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

    pub observations: Vec<ComponentConformanceStepObservation>,

    pub operation_id: String,

    pub plan_digest: String,

    pub run_id: String,

    pub suite_digest: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentConformanceStepObservation {
    /// 成功 validate_binding 的固定字段摘要，由 Core 从真实回执按 component_conformance_wire_digests 计算；其他操作不得携带。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub binding_digest: Option<String>,

    /// DD-124：本步声明的捕获值，只由 Core 从本次实际应答的封闭槽位取得；仅随该步观察证据保存。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub captures: Option<Vec<ComponentConformanceCaptureValue>>,

    pub case_key: String,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_reference: Option<ContentReference>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_class: Option<ErrorClass>,

    pub http_status: i64,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub mcp_result_kind: Option<ComponentConformanceStepExpectedMcpResultKind>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_observation: Option<AdapterExecutionObservation>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receiver_observation: Option<ComponentNativeReceiverObservation>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_scope_observation: Option<AdapterScopeObservation>,

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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationProjectionRequest {
    pub run_id: String,

    pub target: ConversationProjectionTarget,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationProjectionTarget {
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
    pub round: Option<ProtocolSessionReconcileRound>,

    pub run_id: String,

    pub target: ProtocolSessionReconcileTarget,
}

/// Actual original Session snapshot. The Activity result freezes this query round into
/// history, not into a new authority.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolSessionReconcileRound {
    pub session_version: i64,

    pub state: ProtocolSessionReconcileRoundState,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub write_observation: Option<ProtocolWriteObservation>,
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
pub struct ProtocolSessionReconcileResult {
    pub protocol_session_id: String,

    pub round: ProtocolSessionReconcileRound,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceExportAdvanceRequest {
    pub cancel_requested: bool,

    pub run_id: String,

    pub target: ResourceExportTarget,
}

/// 06 §7.1、DD-42：源 Tenant 的 RESOURCE_EXPORT 冻结目标。只引用本 Tenant 的 ActionExecution、来源
/// Resource、准入时预写的 ExportPackage Asset 与 TransferFormat；不携带包字节或任何来源内容。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceExportTarget {
    pub action_execution_id: String,

    pub format_key: String,

    pub package_asset_id: String,

    pub source_resource_id: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceExportAdvanceResult {
    pub package_asset_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceImportAdvanceRequest {
    pub cancel_requested: bool,

    pub run_id: String,

    pub target: ResourceImportTarget,
}

/// 06 §7.1、DD-42：目标 Tenant 的 RESOURCE_IMPORT 冻结目标。只引用本 Tenant 的 ActionExecution、新建
/// Resource/Asset 与包 format/digest；不携带包字节、来源 Tenant 或来源 ID。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceImportTarget {
    pub action_execution_id: String,

    pub format_key: String,

    pub package_digest: String,

    pub resource_id: String,

    pub version_asset_id: String,

    pub workflow_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceImportAdvanceResult {
    pub resource_id: String,

    pub status: TaskStatus,

    pub waiting_reason: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceProvisionAdvanceRequest {
    pub cancel_requested: bool,

    pub run_id: String,

    pub target: ResourceProvisionTarget,
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

    pub reference: ResourceCreate,

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
