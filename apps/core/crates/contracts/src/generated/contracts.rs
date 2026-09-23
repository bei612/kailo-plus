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

/// 稳定业务 reason code，进入 audit、UI 与告警；文案可本地化，code 不变（apps/06-工程基线规范.md 第 4 节）。新增与新增 API
/// 字段同等对待，走兼容检查。本文件只含已被实现使用的 code。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ReasonCode {
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

    #[serde(rename = "IDENTITY_HEADER_MISSING")]
    IdentityHeaderMissing,

    #[serde(rename = "IDENTITY_UNKNOWN")]
    IdentityUnknown,

    #[serde(rename = "NATIVE_SURFACE_REQUIRED")]
    NativeSurfaceRequired,

    #[serde(rename = "PUBLISH_REJECTED")]
    PublishRejected,

    #[serde(rename = "PUBLISH_RESULT_UNKNOWN")]
    PublishResultUnknown,

    #[serde(rename = "SESSION_NOT_ACTIVE")]
    SessionNotActive,

    #[serde(rename = "TENANT_MEMBERSHIP_NOT_ACTIVE")]
    TenantMembershipNotActive,

    #[serde(rename = "TENANT_SELECTION_NOT_AVAILABLE")]
    TenantSelectionNotAvailable,
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
