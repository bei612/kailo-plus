//! Governed Action 的准入、审批与派发（`.design/05` §1、`.design/03` §4 §6、
//! `.design/06` §4、DD-47、DD-48）。
//!
//! 一条用户意图在这里走完同一条链，顺序不能换：
//!
//! ```text
//! 语义命令 → ActionDefinition 确切版本 → 规范化参数 → target 与 scope 解析
//! → SpiceDB FullyConsistent Check → ActionDecision
//! → 需要审批：WAITING + ApprovalWorkflow（Temporal 是审批生命周期的唯一权威）
//! → 批准后：完整重新准入 → 通过才推进实体并 dispatch 既有生命周期 Workflow，
//!   dispatch 成功后发 consume；不通过发 invalidate
//! ```
//!
//! 本模块不改审批状态：ApprovalProjection 只由 Workflow 经 `ProjectApprovalState`
//! 写回（`apply_approval_report`），Core 对审批只有 Update 这一条输入通道。
//! ActionExecution 的门禁（`gate_state`）是 Core 自己的事实，随审批投影的终态收敛。
//!
//! 每个新状态都有终结路径与上界：EVALUATING 超过 `evaluation_timeout` 由对账作业
//! 置 EXPIRED；WAITING 以策略的 `expires_in` 为上界（Workflow 的 timer）；APPROVED
//! 以 `consume_window` 为上界；ALLOWED 而未派发由对账作业按同一 workflow ID 重新
//! 驱动，结果不明停在 UNKNOWN 直到 Temporal 给出观察（`governance_reconcile`）。

use crate::audit::Evidence;
use contracts::EvidenceKind;
use std::time::Duration;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Utc};
use contracts::{
    ActionDispatchState, ActionGateState, ActionSubmission, ApprovalControlOutcome,
    ApprovalInvalidateUpdate, ApprovalRoleRequirement, ApprovalSelector, ApprovalStateReport,
    ApprovalStatus, ApprovalWorkflowInput, ErrorBody, ErrorClass, FreshApprovalAdmissionRequest,
    FreshApprovalAdmissionResult, ReasonCode,
};
use secret_store::SecretStore;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::component_task::{self, Launch};
use crate::membership_lifecycle::{
    launch_membership, launch_scope, LifecycleRequest, ScopeLifecycleRequest, ScopeOperation,
};
use crate::membership_projection::MembershipScope;
use crate::scope_state::ScopeKind;
use crate::spicedb::{Consistency, SpiceDb};
use crate::temporal::{ObservedState, TemporalClient, TemporalError, UpdateOutcome};

#[path = "delegation.rs"]
pub(crate) mod delegation;

#[path = "agent_installation_permission.rs"]
pub(crate) mod installation_permission;

#[path = "task_control.rs"]
pub(crate) mod task_control;

/// Worker 注册的审批 Workflow 类型名，两侧逐字相同。
pub const APPROVAL_WORKFLOW_TYPE: &str = "ApprovalWorkflow";
/// 审批 workflow ID 的类型段。它不是 ComponentTaskWorkflow 的 kind，只占
/// `platform:<kind>:<tenant>:<entity>:<version>` 的第二段，使 ID 仍可机械校验。
const APPROVAL_ID_SEGMENT: &str = "APPROVAL";

pub struct GovernanceConfig {
    /// APPROVED 之后等待 consume 的上界，冻结进 Workflow input
    pub consume_window_seconds: i64,
    /// 重新准入与派发必须在 consume_deadline 之前至少留出的余量。余量不足时不
    /// 派发，交给 Workflow 的 timer 失效——宁可让批准过期，也不要派发之后
    /// consume 才被拒绝
    pub dispatch_margin_seconds: i64,
    /// 同步等待一个 Update 完成的上界；超过即结果不明
    pub update_wait: Duration,
    /// EVALUATING 与「已允许未派发」被视为停滞的年龄
    pub evaluation_timeout_seconds: i64,
    /// 投影新鲜度上界：超过它仍无 Workflow 的写回即显示 PROJECTION_DELAYED
    pub projection_freshness_seconds: i64,
    /// 任务列表与待我审批列表的单页上界
    pub page_limit: i64,
    /// Tenant 成员角色管理视图的单页上界；不与 Relay 消息页或任务页混用。
    pub role_member_page_limit: i64,
    /// 从 SpiceDB 读关系的单页条数；读取总是翻到底，它只约束单次回应的大小
    pub relationship_page: u32,
    /// 邀请的有效期，签发时冻结进 `expires_at`（DD-83）
    pub invitation_ttl_seconds: i64,
    /// 邀请链接的基址（部署的 Web origin 加路径）。凭据接在 `#` 之后：fragment 不随
    /// 请求发给任何服务端，不进网关与 BFF 的访问日志，也不进 Referer
    pub invitation_link_base: String,
    /// 兑换者首次出现时登记 ExternalIdentity 所属的部署 IdP（与部署引导同一对）
    pub human_oidc_issuer: String,
    pub human_oidc_client_id: String,
}

impl GovernanceConfig {
    pub fn from_env() -> Result<Self, String> {
        let get = |k: &str| -> Result<i64, String> {
            std::env::var(k)
                .map_err(|_| format!("缺少 {k}"))?
                .parse::<i64>()
                .ok()
                .filter(|n| *n > 0)
                .ok_or_else(|| format!("{k} 必须是正整数"))
        };
        let text = |k: &str| -> Result<String, String> {
            std::env::var(k)
                .ok()
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| format!("缺少 {k}"))
        };
        let cfg = Self {
            consume_window_seconds: get("APPROVAL_CONSUME_WINDOW_SECONDS")?,
            dispatch_margin_seconds: get("APPROVAL_DISPATCH_MARGIN_SECONDS")?,
            update_wait: Duration::from_secs(get("TEMPORAL_UPDATE_WAIT_SECONDS")? as u64),
            evaluation_timeout_seconds: get("ADMISSION_EVALUATION_TIMEOUT_SECONDS")?,
            projection_freshness_seconds: get("WORKFLOW_PROJECTION_FRESHNESS_SECONDS")?,
            page_limit: get("BFF_TASK_PAGE_LIMIT")?,
            role_member_page_limit: get("BFF_ROLE_MEMBER_PAGE_LIMIT")?,
            relationship_page: u32::try_from(get("SPICEDB_READ_PAGE_LIMIT")?)
                .map_err(|_| "SPICEDB_READ_PAGE_LIMIT 超出范围")?,
            invitation_ttl_seconds: get("TENANT_INVITATION_TTL_SECONDS")?,
            invitation_link_base: text("TENANT_INVITATION_LINK_BASE")?,
            human_oidc_issuer: text("HUMAN_OIDC_ISSUER")?,
            human_oidc_client_id: text("HUMAN_OIDC_CLIENT_ID")?,
        };
        // 链接只能指向部署的 Web：没有协议就不是可点开的链接；基址自带 fragment 会让
        // 凭据被拼进别人的 fragment 而无从读出
        let base = &cfg.invitation_link_base;
        if !(base.starts_with("https://") || base.starts_with("http://")) || base.contains('#') {
            return Err("TENANT_INVITATION_LINK_BASE 必须是不含 # 的 http(s) 地址".into());
        }
        if cfg.dispatch_margin_seconds >= cfg.consume_window_seconds {
            return Err(
                "APPROVAL_DISPATCH_MARGIN_SECONDS 必须小于 APPROVAL_CONSUME_WINDOW_SECONDS".into(),
            );
        }
        Ok(cfg)
    }
}

pub struct Governance {
    pub pool: PgPool,
    pub temporal: std::sync::Arc<TemporalClient>,
    pub spicedb: SpiceDb,
    pub secrets: std::sync::Arc<SecretStore>,
    pub audit: std::sync::Arc<secret_store::AuditObserver>,
    pub openmeter: std::sync::Arc<crate::openmeter::OpenMeter>,
    pub cfg: GovernanceConfig,
}

// ---------------------------------------------------------------------------
// 拒绝与回应
// ---------------------------------------------------------------------------

/// 一次准入的确定结论之外的结果。每个取值落在 `06` §4 的六类之一。
#[derive(Debug)]
pub enum Refusal {
    Denied(ReasonCode),
    Blocked(ReasonCode),
    Precondition(ReasonCode),
    Limit(ReasonCode),
    Conflict(ReasonCode),
    /// 依赖不可用：结果不明，不是拒绝
    Unavailable(String),
}

impl Refusal {
    pub fn class_status(&self) -> (ErrorClass, StatusCode) {
        match self {
            Refusal::Denied(_) => (ErrorClass::Denied, StatusCode::FORBIDDEN),
            Refusal::Blocked(_) => (ErrorClass::Blocked, StatusCode::FORBIDDEN),
            Refusal::Precondition(_) => {
                (ErrorClass::Precondition, StatusCode::UNPROCESSABLE_ENTITY)
            }
            Refusal::Conflict(_) => (ErrorClass::Conflict, StatusCode::CONFLICT),
            Refusal::Limit(_) => (ErrorClass::Limit, StatusCode::TOO_MANY_REQUESTS),
            Refusal::Unavailable(_) => (ErrorClass::Unknown, StatusCode::SERVICE_UNAVAILABLE),
        }
    }

    pub fn reason(&self) -> ReasonCode {
        match self {
            Refusal::Denied(r)
            | Refusal::Blocked(r)
            | Refusal::Precondition(r)
            | Refusal::Limit(r)
            | Refusal::Conflict(r) => r.clone(),
            Refusal::Unavailable(_) => ReasonCode::DependencyUnavailable,
        }
    }

    fn from_reason(reason: ReasonCode) -> Self {
        match reason {
            r @ (ReasonCode::ScopeGuardFailed
            | ReasonCode::PermissionDenied
            | ReasonCode::ApprovalDenied) => Self::Denied(r),
            r @ ReasonCode::CapabilityBlocked => Self::Blocked(r),
            r @ (ReasonCode::QuotaExhausted | ReasonCode::RateLimited) => Self::Limit(r),
            r @ ReasonCode::TargetStateConflict => Self::Conflict(r),
            r => Self::Precondition(r),
        }
    }

    pub fn respond(&self, operation_id: Option<Uuid>) -> Response {
        if let Refusal::Unavailable(e) = self {
            tracing::warn!(error = %e, "治理链依赖不可用");
        }
        let (class, status) = self.class_status();
        (
            status,
            Json(ErrorBody {
                class,
                reason: self.reason(),
                operation_id: operation_id.map(|o| o.to_string()),
            }),
        )
            .into_response()
    }
}

impl From<sqlx::Error> for Refusal {
    fn from(e: sqlx::Error) -> Self {
        Refusal::Unavailable(e.to_string())
    }
}

/// 契约枚举的线格式值。
pub fn wire<T: serde::Serialize>(v: &T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// 从线格式值读回契约枚举。库里的值与契约逐值相等由 `check.sh migrate` 保证。
pub fn parse<T: serde::de::DeserializeOwned>(s: &str) -> Option<T> {
    serde_json::from_value(Value::String(s.to_owned())).ok()
}

fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Definition {
    pub action_key: String,
    pub version: i32,
    pub component_type_key: String,
    pub target_type: String,
    pub tenant_rule: String,
    pub workspace_rule: String,
    pub permission: String,
    pub permission_object_type: String,
    pub confirmation_mode: String,
    pub approval_policy_id: Option<Uuid>,
    pub approval_policy_version: Option<i32>,
    pub workflow_kind: Option<String>,
    pub result_exposure: String,
    pub execution_mode: String,
    pub quota_policy: String,
    pub meters: Vec<String>,
    pub role_template_key: Option<String>,
    pub role_template_version: Option<i32>,
}

impl Definition {
    pub(crate) fn audit_class(&self) -> AuditClass<'_> {
        AuditClass {
            component_type_key: &self.component_type_key,
            target_type: &self.target_type,
            result_exposure: &self.result_exposure,
        }
    }
}

/// 一条 ActionExecution 的审计在 ActionExecution 行之外还需要的三项分类：组件、
/// 目标类型与结果暴露面。有 ActionDefinition 的动作取自定义；没有定义的入口
/// （部署引导、托管身份、重跑的 service 入口）由入口按它所驱动的目标声明。
#[derive(Debug, Clone, Copy)]
pub(crate) struct AuditClass<'a> {
    pub component_type_key: &'a str,
    pub target_type: &'a str,
    pub result_exposure: &'a str,
}

impl<'a> AuditClass<'a> {
    /// Core 自身目标（scope、成员、ActionExecution）的动作：结果不外露。
    pub(crate) const fn core(target_type: &'a str) -> Self {
        Self {
            component_type_key: "core",
            target_type,
            result_exposure: "NONE",
        }
    }
}

pub(crate) const DEFINITION_COLUMNS: &str =
    "action_key, version, component_type_key, target_type, tenant_rule, workspace_rule,
     permission, permission_object_type, confirmation_mode, approval_policy_id,
     approval_policy_version, workflow_kind, result_exposure, execution_mode,
     quota_policy, meters, role_template_key, role_template_version";

/// 角色动作按确切版本引用的 RoleTemplate。定义与模板任一缺失即说明目录与语义
/// 不一致，fail closed。
async fn role_template_of(
    conn: &mut sqlx::PgConnection,
    def: &Definition,
) -> Result<crate::roles::RoleTemplate, Refusal> {
    let (Some(k), Some(v)) = (&def.role_template_key, def.role_template_version) else {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    };
    Ok(crate::roles::template(conn, k, v).await?)
}

pub(crate) async fn active_definition(
    pool: &PgPool,
    key: &str,
) -> Result<Option<Definition>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {DEFINITION_COLUMNS} from catalog.action_definition
         where action_key = $1 and status = 'ACTIVE' and component_release_id is null"
    ))
    .bind(key)
    .fetch_optional(pool)
    .await
}

/// 确切版本，不看 status：已准入的动作按准入时的规则重新准入与解释，
/// 之后被 RETIRED 不改变它（.design/03 §4 的「固定快照」）。
pub(crate) async fn exact_definition(
    pool: &PgPool,
    key: &str,
    version: i32,
) -> Result<Definition, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {DEFINITION_COLUMNS} from catalog.action_definition
         where action_key = $1 and version = $2 and component_release_id is null"
    ))
    .bind(key)
    .bind(version)
    .fetch_one(pool)
    .await
}

/// Every re-admission/advance reads the actual execution's frozen implementation.
/// Legacy platform rows keep their key/version convention. An application row
/// with missing/inconsistent references cannot silently use that convention.
pub(crate) async fn exact_definition_for_execution(
    pool: &PgPool,
    ae: &Execution,
) -> Result<Definition, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {DEFINITION_COLUMNS} from catalog.action_definition d
         where d.action_key=$2 and d.version=$3 and (
           (d.component_release_id is null and exists(select 1 from admission.action_execution a
            where a.id=$1 and a.component_binding_kind is null and a.component_release_id is null
              and a.action_key=d.action_key and a.action_version=d.version
              and (a.action_definition_id is null or a.action_definition_id=d.id)))
           or exists(select 1 from admission.action_execution a
             join projection.application_runtime p on p.binding_id=a.component_binding_id
              and p.generation=a.component_projection_generation and p.component_release_id=a.component_release_id
             join catalog.application_binding b on b.id=p.binding_id and b.tenant_id=a.tenant_id
             where a.id=$1 and a.component_binding_kind='APPLICATION' and a.action_definition_id=d.id
               and d.component_release_id=a.component_release_id
               and (b.workspace_id is null or b.workspace_id=a.workspace_id)))"
    )).bind(ae.id).bind(&ae.action_key).bind(ae.action_version).fetch_one(pool).await
}

#[derive(Debug, Clone)]
pub struct Policy {
    pub id: Uuid,
    pub version: i32,
    pub role_requirements: Vec<ApprovalRoleRequirement>,
    pub owner_requirement: String,
    pub self_approval: String,
    pub expires_in_seconds: i32,
}

pub(crate) async fn exact_policy(pool: &PgPool, id: Uuid, version: i32) -> Result<Policy, Refusal> {
    let row: (Value, String, String, i32) = sqlx::query_as(
        "select role_requirements, owner_requirement, self_approval, expires_in_seconds
         from catalog.approval_policy where id = $1 and version = $2",
    )
    .bind(id)
    .bind(version)
    .fetch_one(pool)
    .await?;
    let role_requirements = serde_json::from_value(row.0).map_err(|e| {
        Refusal::Unavailable(format!("ApprovalPolicy 的 role_requirements 不合契约: {e}"))
    })?;
    Ok(Policy {
        id,
        version,
        role_requirements,
        owner_requirement: row.1,
        self_approval: row.2,
        expires_in_seconds: row.3,
    })
}

// ---------------------------------------------------------------------------
// 语义：每个已登记 action_key 的参数、target 与实体推进
// ---------------------------------------------------------------------------

/// 已实现语义的动作。目录里登记了、这里没有对应语义的 key 一律 BLOCKED——
/// 不为没有执行路径的定义放行。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Semantic {
    ConversationOpen,
    WorkspaceCreate,
    WorkspaceJoin,
    /// Workspace 暂停与恢复（`.design/06` §7.3、DD-46）：从 Tenant scope 指向
    /// Workspace，准入落定即置 SUSPENDING/RESTORING，由 WORKSPACE_LIFECYCLE 收敛。
    WorkspaceSuspend,
    WorkspaceRestore,
    /// 业务 Tenant 的暂停与恢复（DD-96）：在 Platform Catalog Tenant 中执行、指向
    /// 业务 Tenant；业务侧由它自己的 TENANT_LIFECYCLE operation 承接。
    TenantSuspend,
    TenantRestore,
    /// DD-96(4)、DD-99/100：业务 Tenant 自己的受限会话从 SUSPENDED 发起删除。
    TenantDelete,
    WorkspaceMemberAdd,
    WorkspaceMemberRevoke,
    TenantMemberRevoke,
    /// 角色的授予与撤销（DD-82）。对象类型与关系由定义引用的 RoleTemplate 决定。
    TenantRoleGrant,
    TenantRoleRevoke,
    WorkspaceRoleGrant,
    WorkspaceRoleRevoke,
    /// 邀请的签发与撤回（DD-83）：Core 内一次写入，SYNC，准入落定即完成
    TenantMemberInvite,
    TenantMemberInviteRevoke,
    /// 兑换发起的成员开通：需要 Tenant admin 确认兑换者（DD-83）
    TenantMemberAdmit,
    /// DD-84：原任务的取消请求，独立 ActionExecution；不是原任务的终态。
    TaskCancel,
    /// DD-84：原任务关闭后以新的准入、批准和 Workflow 重跑。
    TaskRerun,
    /// DD-85：旧平台 namespace 中的同一私钥归位，不更换 Buzz pubkey。
    SecretRefRehome,
    AgentDefinitionCreate,
    CapabilityContractRegister,
    CapabilityContractApprove,
    CapabilityContractDeprecate,
    ComponentReleaseRegister,
    ComponentReleaseApprove,
    ApplicationBindingCreate,
    ApplicationBindingDisable,
    LlmRouteCreate,
    AgentDefinitionUpdate,
    AgentVersionCreate,
    AgentVersionUpdate,
    AgentVersionPublish,
    AgentVersionRetire,
    AgentInstallationCreate,
    AgentInstallationUpgrade,
    AgentInstallationExecuteGrant,
    AgentInstallationExecuteRevoke,
    ResourceGrantRead,
    ResourceRevokeRead,
    AgentDelegationGrant,
    AgentDelegationRevoke,
    AutomationCreate,
    AutomationPublish,
    AutomationEnable,
    AutomationPause,
    AutomationDisable,
    AutomationDelete,
    AutomationRotateWebhookSecret,
    ResourceTransferOwner,
    ResourceCreate,
}

impl Semantic {
    pub(crate) fn from_key(k: &str) -> Option<Self> {
        Some(match k {
            "conversation.open" => Self::ConversationOpen,
            "workspace.create" => Self::WorkspaceCreate,
            "workspace.join" => Self::WorkspaceJoin,
            "workspace.suspend" => Self::WorkspaceSuspend,
            "workspace.restore" => Self::WorkspaceRestore,
            "tenant.suspend" => Self::TenantSuspend,
            "tenant.restore" => Self::TenantRestore,
            "tenant.delete" => Self::TenantDelete,
            "workspace.member.add" => Self::WorkspaceMemberAdd,
            "workspace.member.revoke" => Self::WorkspaceMemberRevoke,
            "tenant.member.revoke" => Self::TenantMemberRevoke,
            "tenant.admin.grant" => Self::TenantRoleGrant,
            "tenant.admin.revoke" => Self::TenantRoleRevoke,
            "workspace.admin.grant" => Self::WorkspaceRoleGrant,
            "workspace.admin.revoke" => Self::WorkspaceRoleRevoke,
            "tenant.member.invite" => Self::TenantMemberInvite,
            "tenant.member.invite.revoke" => Self::TenantMemberInviteRevoke,
            "tenant.member.admit" => Self::TenantMemberAdmit,
            key if key.starts_with("task.cancel.") => Self::TaskCancel,
            key if key.starts_with("task.rerun.") => Self::TaskRerun,
            "identity.secret_ref.rehome" => Self::SecretRefRehome,
            "agent.definition.create" => Self::AgentDefinitionCreate,
            "capability_contract.register" => Self::CapabilityContractRegister,
            "capability_contract.approve" => Self::CapabilityContractApprove,
            "capability_contract.deprecate" => Self::CapabilityContractDeprecate,
            "component_release.register" => Self::ComponentReleaseRegister,
            "component_release.approve" => Self::ComponentReleaseApprove,
            "application_binding.create" => Self::ApplicationBindingCreate,
            "application_binding.disable" => Self::ApplicationBindingDisable,
            "llm_route.create" => Self::LlmRouteCreate,
            "agent.definition.update" => Self::AgentDefinitionUpdate,
            "agent.version.create" => Self::AgentVersionCreate,
            "agent.version.update" => Self::AgentVersionUpdate,
            "agent.version.publish" => Self::AgentVersionPublish,
            "agent.version.retire" => Self::AgentVersionRetire,
            "agent.installation.create" => Self::AgentInstallationCreate,
            "agent.installation.upgrade" => Self::AgentInstallationUpgrade,
            "agent.installation.execute.grant" => Self::AgentInstallationExecuteGrant,
            "agent.installation.execute.revoke" => Self::AgentInstallationExecuteRevoke,
            "resource.grant_read" => Self::ResourceGrantRead,
            "resource.revoke_read" => Self::ResourceRevokeRead,
            "agent.delegation.grant" => Self::AgentDelegationGrant,
            "agent.delegation.revoke" => Self::AgentDelegationRevoke,
            "automation.create" => Self::AutomationCreate,
            "automation.publish_version" => Self::AutomationPublish,
            "automation.enable" => Self::AutomationEnable,
            "automation.pause" => Self::AutomationPause,
            "automation.disable" => Self::AutomationDisable,
            "automation.delete" => Self::AutomationDelete,
            "automation.rotate_webhook_secret" => Self::AutomationRotateWebhookSecret,
            "resource.transfer_owner" => Self::ResourceTransferOwner,
            "resource.create" => Self::ResourceCreate,
            _ => return None,
        })
    }

    /// 能否经 BFF 语义命令发起。开通只能由兑换发起（DD-83）：它的发起者是邀请人、
    /// 目标是兑换建立的 INVITED membership，由请求体直接提交就绕开了兑换这一事实。
    fn bff_submittable(self) -> bool {
        self != Self::TenantMemberAdmit
    }

    pub(crate) fn is_automation(self) -> bool {
        matches!(
            self,
            Self::AutomationCreate
                | Self::AutomationPublish
                | Self::AutomationEnable
                | Self::AutomationPause
                | Self::AutomationDisable
                | Self::AutomationRotateWebhookSecret
                | Self::AutomationDelete
        )
    }

    fn is_application_binding(self) -> bool {
        matches!(
            self,
            Self::ApplicationBindingCreate | Self::ApplicationBindingDisable
        )
    }

    fn is_installation_permission(self) -> bool {
        matches!(
            self,
            Self::AgentInstallationExecuteGrant
                | Self::AgentInstallationExecuteRevoke
                | Self::ResourceGrantRead
                | Self::ResourceRevokeRead
        )
    }

    /// 在准入落定的同一事务里完成、没有外部副作用的同步动作：门禁 ALLOWED 与
    /// 派发 DISPATCHED 同事务写入，没有「已允许未派发」的中间态
    fn completes_in_admission(self) -> bool {
        self.is_capability_contract()
            || matches!(
                self,
                Self::TenantMemberInvite
                    | Self::TenantMemberInviteRevoke
                    | Self::AgentDefinitionUpdate
                    | Self::AgentVersionUpdate
                    | Self::AgentVersionPublish
                    | Self::AgentVersionRetire
                    | Self::AgentDelegationGrant
                    | Self::AgentDelegationRevoke
                    | Self::AutomationEnable
                    | Self::AutomationPause
                    | Self::AutomationDisable
                    | Self::AutomationDelete
            )
    }

    fn is_role(self) -> bool {
        matches!(
            self,
            Self::TenantRoleGrant
                | Self::TenantRoleRevoke
                | Self::WorkspaceRoleGrant
                | Self::WorkspaceRoleRevoke
        )
    }

    fn is_grant(self) -> bool {
        matches!(self, Self::TenantRoleGrant | Self::WorkspaceRoleGrant)
    }

    /// 会改变「有效 Tenant admin」集合的动作在 Tenant 行锁下判定与写入（DD-82）。
    fn serializes_on_tenant(self) -> bool {
        matches!(
            self,
            Self::ComponentReleaseRegister | Self::ComponentReleaseApprove
        ) || self.is_application_binding()
            || self.is_role()
            || self.is_capability_contract()
            || self.is_installation_permission()
            || self.is_automation()
            || matches!(
                self,
                Self::TenantMemberRevoke
                    | Self::WorkspaceJoin
                    | Self::ConversationOpen
                    | Self::TenantDelete
                    | Self::AgentDefinitionCreate
                    | Self::LlmRouteCreate
                    | Self::AgentDefinitionUpdate
                    | Self::AgentVersionCreate
                    | Self::AgentVersionUpdate
                    | Self::AgentVersionPublish
                    | Self::AgentVersionRetire
                    | Self::AgentInstallationCreate
                    | Self::AgentInstallationUpgrade
                    | Self::AgentInstallationExecuteRevoke
                    | Self::AgentDelegationGrant
                    | Self::AgentDelegationRevoke
                    | Self::ResourceTransferOwner
                    | Self::ResourceCreate
            )
    }

    /// Workspace 生命周期的一段：它接受的起始状态、准入落定时置入的收敛中状态，
    /// 以及派发时声明给启动核心的段。建立链的 Workspace 行在准入时新建，不在此列。
    /// 暂停也接受 `ERROR`：暂停或恢复失败后的 Workspace 由再次暂停收敛
    /// （`.design/03` 状态机的 `ERROR → SUSPENDING`），恢复只从 `SUSPENDED` 起步。
    /// 业务 Tenant 生命周期的一段：可接受的起始状态、准入落定时置入的收敛中状态，
    /// 以及派发时声明给启动核心的段。
    fn tenant_segment(self) -> Option<(&'static [&'static str], &'static str, ScopeOperation)> {
        match self {
            Self::TenantSuspend => {
                Some((&["ACTIVE", "ERROR"], "SUSPENDING", ScopeOperation::Suspend))
            }
            Self::TenantRestore => Some((&["SUSPENDED"], "RESTORING", ScopeOperation::Restore)),
            _ => None,
        }
    }

    /// 由用户在目标详情上显式确认、确认位冻结在参数里的语义（`confirmation_mode=EXPLICIT`）。
    fn takes_explicit_confirmation(self) -> bool {
        self == Self::ComponentReleaseRegister
            || self.is_application_binding()
            || self.is_automation()
            || matches!(
                self,
                Self::CapabilityContractRegister | Self::CapabilityContractDeprecate
            )
            || matches!(
                self,
                Self::AgentInstallationExecuteRevoke | Self::ResourceRevokeRead
            )
            || matches!(
                self,
                Self::SecretRefRehome
                    | Self::LlmRouteCreate
                    | Self::TenantSuspend
                    | Self::TenantRestore
                    | Self::AgentVersionPublish
                    | Self::AgentVersionRetire
                    | Self::AgentInstallationCreate
                    | Self::AgentInstallationUpgrade
                    | Self::AgentDelegationGrant
                    | Self::AgentDelegationRevoke
            )
    }

    fn workspace_segment(self) -> Option<(&'static [&'static str], &'static str, ScopeOperation)> {
        match self {
            Self::WorkspaceSuspend => {
                Some((&["ACTIVE", "ERROR"], "SUSPENDING", ScopeOperation::Suspend))
            }
            Self::WorkspaceRestore => Some((&["SUSPENDED"], "RESTORING", ScopeOperation::Restore)),
            _ => None,
        }
    }

    pub(crate) fn is_capability_contract(self) -> bool {
        matches!(
            self,
            Self::CapabilityContractRegister
                | Self::CapabilityContractApprove
                | Self::CapabilityContractDeprecate
        )
    }
}

/// 规范化参数。只含引用与平台自有事实；AgentVersion requested 内容属于 Core
/// 权威，不接收上游业务正文、凭据或 host environment。
#[derive(Debug, Clone, PartialEq)]
pub struct Params {
    pub workspace_visibility: Option<contracts::WorkspaceVisibility>,
    pub workspace_channel: Option<Value>,
    pub conversation_open: Option<Value>,
    pub workspace_id: Option<Uuid>,
    /// 业务 Tenant 暂停与恢复的目标（DD-96）；其他语义一律为空
    pub tenant_id: Option<Uuid>,
    pub principal_id: Option<Uuid>,
    pub slug: Option<String>,
    pub name: Option<String>,
    pub invitation_id: Option<Uuid>,
    pub original_action_execution_id: Option<Uuid>,
    pub explicit_confirmation: Option<bool>,
    pub resource_id: Option<Uuid>,
    pub resource_version: Option<i32>,
    pub receiver_resource: Option<Value>,
    pub asset_id: Option<Uuid>,
    pub asset_version: Option<i32>,
    pub agent_version_content: Option<contracts::ContentClass>,
    pub delegation_id: Option<Uuid>,
    pub delegation_version: Option<i32>,
    pub delegation_grant: Option<contracts::DelegationGrantParameters>,
    pub automation_version_content: Option<Value>,
    pub executor_installation_resource_id: Option<Uuid>,
    pub llm_route_create: Option<Value>,
    pub capability_contract_registration: Option<Value>,
    pub capability_contract_ref: Option<Value>,
    pub component_release_registration: Option<Value>,
    pub component_release_id: Option<Uuid>,
    pub application_binding_create: Option<Value>,
    pub application_binding_id: Option<Uuid>,
    pub application_binding_version: Option<i32>,
    pub resource_create: Option<Value>,
}

impl Params {
    pub(crate) fn to_json(&self) -> Value {
        let mut m = serde_json::Map::new();
        if let Some(visibility) = &self.workspace_visibility {
            m.insert("workspaceVisibility".into(), json!(visibility));
        }
        if let Some(input) = &self.workspace_channel {
            m.insert("workspaceChannel".into(), input.clone());
        }
        if let Some(input) = &self.conversation_open {
            m.insert("conversationOpen".into(), input.clone());
        }
        if let Some(input) = &self.resource_create {
            m.insert("resourceCreate".into(), input.clone());
        }
        if let Some(input) = &self.application_binding_create {
            m.insert("applicationBindingCreate".into(), input.clone());
        }
        if let Some(id) = self.application_binding_id {
            m.insert("applicationBindingId".into(), json!(id));
        }
        if let Some(version) = self.application_binding_version {
            m.insert("applicationBindingVersion".into(), json!(version));
        }
        if let Some(id) = self.component_release_id {
            m.insert("componentReleaseId".into(), json!(id));
        }
        if let Some(registration) = &self.component_release_registration {
            m.insert("componentReleaseRegistration".into(), registration.clone());
        }
        if let Some(w) = self.workspace_id {
            m.insert("workspaceId".into(), json!(w));
        }
        if let Some(t) = self.tenant_id {
            m.insert("tenantId".into(), json!(t));
        }
        if let Some(p) = self.principal_id {
            m.insert("principalId".into(), json!(p));
        }
        if let Some(i) = self.invitation_id {
            m.insert("invitationId".into(), json!(i));
        }
        if let Some(id) = self.original_action_execution_id {
            m.insert("originalActionExecutionId".into(), json!(id));
        }
        if let Some(confirmed) = self.explicit_confirmation {
            m.insert("explicitConfirmation".into(), json!(confirmed));
        }
        if let Some(id) = self.resource_id {
            m.insert("resourceId".into(), json!(id));
        }
        if let Some(version) = self.resource_version {
            m.insert("resourceVersion".into(), json!(version));
        }
        if let Some(receiver) = &self.receiver_resource {
            m.insert("receiverResource".into(), receiver.clone());
        }
        if let Some(id) = self.asset_id {
            m.insert("assetId".into(), json!(id));
        }
        if let Some(version) = self.asset_version {
            m.insert("assetVersion".into(), json!(version));
        }
        if let Some(content) = &self.agent_version_content {
            m.insert("agentVersionContent".into(), json!(content));
        }
        if let Some(id) = self.delegation_id {
            m.insert("delegationId".into(), json!(id));
        }
        if let Some(version) = self.delegation_version {
            m.insert("delegationVersion".into(), json!(version));
        }
        if let Some(grant) = &self.delegation_grant {
            m.insert("delegationGrant".into(), json!(grant));
        }
        if let Some(content) = &self.automation_version_content {
            m.insert("automationVersionContent".into(), content.clone());
        }
        if let Some(source) = &self.llm_route_create {
            m.insert("llmRouteCreate".into(), source.clone());
        }
        if let Some(registration) = &self.capability_contract_registration {
            m.insert(
                "capabilityContractRegistration".into(),
                registration.clone(),
            );
        }
        if let Some(reference) = &self.capability_contract_ref {
            m.insert("capabilityContractRef".into(), reference.clone());
        }
        if let Some(id) = self.executor_installation_resource_id {
            m.insert("executorInstallationResourceId".into(), json!(id));
        }
        if let Some(s) = &self.slug {
            m.insert("slug".into(), json!(s));
        }
        if let Some(n) = &self.name {
            m.insert("name".into(), json!(n));
        }
        Value::Object(m)
    }

    pub(crate) fn from_json(v: &Value) -> Option<Self> {
        let uuid = |k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .and_then(|s| Uuid::parse_str(s).ok())
        };
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        Some(Self {
            workspace_visibility: v
                .get("workspaceVisibility")
                .map(|value| serde_json::from_value(value.clone()))
                .transpose()
                .ok()?,
            workspace_channel: v.get("workspaceChannel").cloned(),
            conversation_open: v.get("conversationOpen").cloned(),
            workspace_id: uuid("workspaceId"),
            tenant_id: uuid("tenantId"),
            principal_id: uuid("principalId"),
            slug: text("slug"),
            name: text("name"),
            invitation_id: uuid("invitationId"),
            original_action_execution_id: uuid("originalActionExecutionId"),
            explicit_confirmation: v.get("explicitConfirmation").and_then(Value::as_bool),
            resource_id: uuid("resourceId"),
            receiver_resource: v.get("receiverResource").cloned(),
            resource_version: v
                .get("resourceVersion")
                .and_then(Value::as_i64)
                .and_then(|n| i32::try_from(n).ok()),
            asset_id: uuid("assetId"),
            asset_version: v
                .get("assetVersion")
                .and_then(Value::as_i64)
                .and_then(|n| i32::try_from(n).ok()),
            agent_version_content: v
                .get("agentVersionContent")
                .map(|v| serde_json::from_value(v.clone()))
                .transpose()
                .ok()?,
            delegation_id: uuid("delegationId"),
            delegation_version: v
                .get("delegationVersion")
                .and_then(Value::as_i64)
                .and_then(|n| i32::try_from(n).ok()),
            delegation_grant: v
                .get("delegationGrant")
                .map(|v| serde_json::from_value(v.clone()))
                .transpose()
                .ok()?,
            automation_version_content: v.get("automationVersionContent").cloned(),
            executor_installation_resource_id: uuid("executorInstallationResourceId"),
            llm_route_create: v.get("llmRouteCreate").cloned(),
            capability_contract_registration: v.get("capabilityContractRegistration").cloned(),
            capability_contract_ref: v.get("capabilityContractRef").cloned(),
            component_release_registration: v.get("componentReleaseRegistration").cloned(),
            component_release_id: uuid("componentReleaseId"),
            application_binding_create: v.get("applicationBindingCreate").cloned(),
            resource_create: v.get("resourceCreate").cloned(),
            application_binding_id: uuid("applicationBindingId"),
            application_binding_version: v
                .get("applicationBindingVersion")
                .and_then(Value::as_i64)
                .and_then(|n| i32::try_from(n).ok()),
        })
    }
}

/// slug 是 Community/Channel 的稳定标识的一部分：只接受小写字母、数字与连字符，
/// 且以字母或数字开头。长度上界由库列与 Relay 决定，这里不另立一个数字。
pub(crate) fn valid_slug(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .next()
            .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        && s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

#[cfg(test)]
mod workspace_channel_tests {
    #[test]
    fn workspace_join_only_accepts_the_authenticated_self_subject() {
        let mut command: contracts::ActionCommand = serde_json::from_value(serde_json::json!({
            "actionKey": "workspace.join", "idempotencyKey": uuid::Uuid::new_v4(), "workspaceId": uuid::Uuid::new_v4(),
        })).unwrap();
        assert!(super::parse_command(super::Semantic::WorkspaceJoin, &command).is_ok());
        command.principal_id = Some(uuid::Uuid::new_v4().to_string());
        assert!(super::parse_command(super::Semantic::WorkspaceJoin, &command).is_err());
        command.principal_id = None;
        command.workspace_visibility = Some(contracts::WorkspaceVisibility::Open);
        assert!(super::parse_command(super::Semantic::WorkspaceJoin, &command).is_err());
    }

    #[test]
    fn workspace_visibility_is_frozen_and_legacy_commands_stay_unchanged() {
        let mut command: contracts::ActionCommand = serde_json::from_str(include_str!(
            "../../../../contracts/samples/workspace-channel-create.sample.json"
        ))
        .unwrap();
        let before = super::parse_command(super::Semantic::WorkspaceCreate, &command).unwrap();
        assert!(before.workspace_visibility.is_none());
        assert!(before.to_json().get("workspaceVisibility").is_none());
        command.workspace_visibility = Some(contracts::WorkspaceVisibility::Open);
        let after = super::parse_command(super::Semantic::WorkspaceCreate, &command).unwrap();
        assert_eq!(after.to_json()["workspaceVisibility"], "open");
        assert_ne!(before.to_json(), after.to_json());
        assert_eq!(super::Params::from_json(&after.to_json()).unwrap(), after);
    }
    use super::*;

    #[test]
    fn channel_metadata_stays_in_the_original_idempotent_parameters() {
        let command: contracts::ActionCommand = serde_json::from_str(include_str!(
            "../../../../contracts/samples/workspace-channel-create.sample.json"
        ))
        .unwrap();
        let parameters = parse_command(Semantic::WorkspaceCreate, &command).unwrap();
        assert_eq!(
            parameters.workspace_channel.as_ref().unwrap(),
            &json!({
                "channelType": "forum", "description": "Decisions and discussion threads", "ttlSeconds": 604800,
            })
        );
        assert_eq!(
            Params::from_json(&parameters.to_json()).unwrap(),
            parameters
        );
        assert!(parse_command(Semantic::WorkspaceRestore, &command).is_err());
        let mut other = command.clone();
        other.workspace_channel.as_mut().unwrap().description = Some("Changed intent".into());
        assert_ne!(
            parameters.to_json(),
            parse_command(Semantic::WorkspaceCreate, &other)
                .unwrap()
                .to_json()
        );
        let mut legacy = command;
        for invalid in [0, -1, i64::from(i32::MAX) + 1] {
            legacy.workspace_channel.as_mut().unwrap().ttl_seconds = Some(invalid);
            assert!(parse_command(Semantic::WorkspaceCreate, &legacy).is_err());
        }
        legacy.workspace_channel.as_mut().unwrap().ttl_seconds = None;
        assert!(parse_command(Semantic::WorkspaceCreate, &legacy).is_ok());
        legacy.workspace_channel = None;
        assert!(parse_command(Semantic::WorkspaceCreate, &legacy)
            .unwrap()
            .workspace_channel
            .is_none());
    }
}

fn parse_command(sem: Semantic, cmd: &contracts::ActionCommand) -> Result<Params, Refusal> {
    let bad = || Refusal::Precondition(ReasonCode::InvalidParameters);
    if cmd.workspace_visibility.is_some() && sem != Semantic::WorkspaceCreate {
        return Err(bad());
    }
    if cmd.workspace_channel.is_some() && sem != Semantic::WorkspaceCreate {
        return Err(bad());
    }
    if cmd
        .workspace_channel
        .as_ref()
        .and_then(|channel| channel.ttl_seconds)
        .is_some_and(|seconds| seconds <= 0 || seconds > i64::from(i32::MAX))
    {
        return Err(bad());
    }
    if !sem.takes_explicit_confirmation() && cmd.explicit_confirmation.is_some() {
        return Err(bad());
    }
    let uuid = |s: &Option<String>| -> Result<Option<Uuid>, Refusal> {
        s.as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| bad())
    };
    let p = Params {
        workspace_visibility: cmd.workspace_visibility.clone(),
        workspace_channel: cmd
            .workspace_channel
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        conversation_open: cmd
            .conversation_open
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        resource_create: cmd
            .resource_create
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        application_binding_create: cmd
            .application_binding_create
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        application_binding_id: uuid(&cmd.application_binding_id)?,
        application_binding_version: cmd
            .application_binding_version
            .map(|n| i32::try_from(n).map_err(|_| bad()))
            .transpose()?,
        component_release_id: uuid(&cmd.component_release_id)?,
        component_release_registration: cmd
            .component_release_registration
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        workspace_id: uuid(&cmd.workspace_id)?,
        tenant_id: uuid(&cmd.tenant_id)?,
        principal_id: uuid(&cmd.principal_id)?,
        slug: cmd.slug.clone(),
        name: cmd.name.as_ref().map(|n| n.trim().to_owned()),
        invitation_id: uuid(&cmd.invitation_id)?,
        original_action_execution_id: uuid(&cmd.original_action_execution_id)?,
        explicit_confirmation: cmd.explicit_confirmation,
        resource_id: uuid(&cmd.resource_id)?,
        receiver_resource: cmd
            .receiver_resource
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        resource_version: cmd
            .resource_version
            .map(|n| i32::try_from(n).map_err(|_| bad()))
            .transpose()?,
        asset_id: uuid(&cmd.asset_id)?,
        asset_version: cmd
            .asset_version
            .map(|n| i32::try_from(n).map_err(|_| bad()))
            .transpose()?,
        agent_version_content: cmd.agent_version_content.clone(),
        delegation_id: uuid(&cmd.delegation_id)?,
        delegation_version: cmd
            .delegation_version
            .map(|n| i32::try_from(n).map_err(|_| bad()))
            .transpose()?,
        delegation_grant: cmd
            .delegation_grant
            .as_ref()
            .map(|grant| {
                let value = serde_json::to_value(grant).map_err(|_| bad())?;
                let grant = serde_json::from_value(value).map_err(|_| bad())?;
                delegation::normalize(grant)
            })
            .transpose()?,
        automation_version_content: cmd
            .automation_version_content
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        executor_installation_resource_id: uuid(&cmd.executor_installation_resource_id)?,
        llm_route_create: cmd
            .llm_route_create
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        capability_contract_registration: cmd
            .capability_contract_registration
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
        capability_contract_ref: cmd
            .capability_contract_ref
            .as_ref()
            .map(serde_json::to_value)
            .transpose()
            .map_err(|_| bad())?,
    };
    if p.receiver_resource.is_some()
        && !matches!(
            sem,
            Semantic::ResourceGrantRead | Semantic::ResourceRevokeRead
        )
    {
        return Err(bad());
    }
    if sem == Semantic::ConversationOpen {
        crate::conversations::validate_params(&p)?;
        return Ok(p);
    }
    if p.conversation_open.is_some() {
        return Err(bad());
    }
    if sem == Semantic::ResourceCreate {
        crate::resource_provision::validate_params(&p)?;
        return Ok(p);
    }
    if p.resource_create.is_some() {
        return Err(bad());
    }
    if sem.is_application_binding() {
        crate::application_binding::validate_params(&p, sem == Semantic::ApplicationBindingCreate)?;
        return Ok(p);
    }
    if p.application_binding_create.is_some()
        || p.application_binding_id.is_some()
        || p.application_binding_version.is_some()
    {
        return Err(bad());
    }
    if sem == Semantic::ComponentReleaseApprove {
        crate::component_release::approval::validate_params(&p)?;
        return Ok(p);
    }
    if sem == Semantic::ComponentReleaseRegister {
        crate::component_release::validate_params(&p)?;
        return Ok(p);
    }
    if p.component_release_registration.is_some() || p.component_release_id.is_some() {
        return Err(bad());
    }
    if sem.is_capability_contract() {
        crate::capability_contract::validate_params(sem, &p)?;
        return Ok(p);
    }
    if p.capability_contract_registration.is_some() || p.capability_contract_ref.is_some() {
        return Err(bad());
    }
    if sem != Semantic::LlmRouteCreate && p.llm_route_create.is_some() {
        return Err(bad());
    }
    if sem.is_automation() {
        crate::automation::validate_management_params(sem, &p)?;
        return Ok(p);
    }
    if p.automation_version_content.is_some() || p.executor_installation_resource_id.is_some() {
        return Err(bad());
    }
    // tenantId 只属于业务 Tenant 的暂停与恢复
    if sem.tenant_segment().is_none() && sem != Semantic::TenantDelete && p.tenant_id.is_some() {
        return Err(bad());
    }
    if !matches!(
        sem,
        Semantic::AgentDefinitionUpdate
            | Semantic::ResourceTransferOwner
            | Semantic::AgentVersionCreate
            | Semantic::AgentVersionUpdate
            | Semantic::AgentVersionPublish
            | Semantic::AgentVersionRetire
            | Semantic::AgentInstallationCreate
            | Semantic::AgentInstallationUpgrade
            | Semantic::AgentInstallationExecuteGrant
            | Semantic::AgentInstallationExecuteRevoke
            | Semantic::ResourceGrantRead
            | Semantic::ResourceRevokeRead
            | Semantic::AgentDelegationGrant
            | Semantic::AgentDelegationRevoke
    ) && (p.resource_id.is_some() || p.resource_version.is_some())
    {
        return Err(bad());
    }
    if !matches!(
        sem,
        Semantic::AgentVersionCreate
            | Semantic::AgentVersionUpdate
            | Semantic::AgentVersionPublish
            | Semantic::AgentVersionRetire
            | Semantic::AgentInstallationCreate
            | Semantic::AgentInstallationUpgrade
    ) && (p.asset_id.is_some() || p.asset_version.is_some() || p.agent_version_content.is_some())
    {
        return Err(bad());
    }
    // 每个语义要求的参数集合是闭集：多出与缺少都拒绝，不按「字段为空即忽略」猜
    if !matches!(
        sem,
        Semantic::AgentDelegationGrant | Semantic::AgentDelegationRevoke
    ) && (p.delegation_id.is_some()
        || p.delegation_version.is_some()
        || p.delegation_grant.is_some())
    {
        return Err(bad());
    }
    let ok = match sem {
        Semantic::ConversationOpen => true, // validated above as a closed parameter object
        Semantic::ResourceGrantRead | Semantic::ResourceRevokeRead => {
            p.workspace_id.is_none()
                && installation_permission::valid_receiver_reference(p.receiver_resource.as_ref())
                && p.principal_id.is_some_and(|id| !id.is_nil())
                && p.slug.is_none()
                && p.name.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.resource_id.is_some_and(|id| !id.is_nil())
                && p.resource_version.is_some_and(|v| v > 0)
                && p.explicit_confirmation
                    == if sem == Semantic::ResourceRevokeRead {
                        Some(true)
                    } else {
                        None
                    }
        }
        Semantic::AgentInstallationExecuteGrant | Semantic::AgentInstallationExecuteRevoke => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.resource_id.is_some_and(|id| !id.is_nil())
                && p.resource_version.is_some_and(|v| v > 0)
                && p.explicit_confirmation
                    == if sem == Semantic::AgentInstallationExecuteRevoke {
                        Some(true)
                    } else {
                        None
                    }
        }
        Semantic::LlmRouteCreate => {
            p.tenant_id.is_none()
                && p.principal_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.resource_id.is_none()
                && p.resource_version.is_none()
                && p.asset_id.is_none()
                && p.asset_version.is_none()
                && p.agent_version_content.is_none()
                && p.llm_route_create.is_some()
                && p.explicit_confirmation == Some(true)
        }
        Semantic::AgentDelegationGrant | Semantic::AgentDelegationRevoke => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.resource_id.is_some()
                && p.resource_version.is_some_and(|v| v > 0)
                && p.delegation_id.is_some_and(|id| !id.is_nil())
                && if sem == Semantic::AgentDelegationGrant {
                    p.delegation_grant.is_some() && p.delegation_version.is_none()
                } else {
                    p.delegation_grant.is_none() && p.delegation_version.is_some_and(|v| v > 0)
                }
        }
        Semantic::AgentInstallationCreate | Semantic::AgentInstallationUpgrade => {
            p.workspace_id.is_some()
                && p.principal_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.resource_id.is_some()
                && p.resource_version.is_some_and(|v| v > 0)
                && p.asset_id.is_some()
                && p.asset_version.is_some_and(|v| v > 0)
                && p.agent_version_content.is_none()
        }
        Semantic::AgentVersionCreate
        | Semantic::AgentVersionUpdate
        | Semantic::AgentVersionPublish
        | Semantic::AgentVersionRetire => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.resource_id.is_some()
                && p.resource_version.is_some_and(|v| v > 0)
                && if sem == Semantic::AgentVersionCreate {
                    p.asset_id.is_none()
                        && p.asset_version.is_none()
                        && p.agent_version_content.is_some()
                } else {
                    p.asset_id.is_some()
                        && p.asset_version.is_some_and(|v| v > 0)
                        && (p.agent_version_content.is_some()
                            == (sem == Semantic::AgentVersionUpdate))
                }
        }
        Semantic::AgentDefinitionCreate => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.as_deref().is_some_and(valid_slug)
                && p.name.as_deref().is_some_and(|n| !n.is_empty())
        }
        Semantic::AgentDefinitionUpdate => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.as_deref().is_some_and(|n| !n.is_empty())
                && p.resource_id.is_some()
                && p.resource_version.is_some_and(|n| n > 0)
        }
        Semantic::ResourceTransferOwner => {
            p.workspace_id.is_none()
                && p.principal_id.is_some()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.resource_id.is_some()
                && p.resource_version.is_some_and(|n| n > 0)
        }
        Semantic::TenantDelete => {
            p.tenant_id.is_some()
                && p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.explicit_confirmation.is_none()
        }
        Semantic::TenantSuspend | Semantic::TenantRestore => {
            p.tenant_id.is_some()
                && p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.explicit_confirmation == Some(true)
        }
        Semantic::SecretRefRehome => {
            p.workspace_id.is_none()
                && p.principal_id.is_some()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
                && p.explicit_confirmation == Some(true)
        }
        Semantic::WorkspaceCreate => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.as_deref().is_some_and(valid_slug)
                && p.name.as_deref().is_some_and(|n| !n.is_empty())
        }
        Semantic::WorkspaceJoin => {
            p.workspace_id.is_some()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
        }
        // 暂停与恢复只指向一个 Workspace；它不是执行 Workspace（TENANT_ONLY）
        Semantic::WorkspaceSuspend | Semantic::WorkspaceRestore => {
            p.workspace_id.is_some()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
        }
        Semantic::WorkspaceMemberAdd
        | Semantic::WorkspaceMemberRevoke
        | Semantic::WorkspaceRoleGrant
        | Semantic::WorkspaceRoleRevoke => {
            p.workspace_id.is_some()
                && p.principal_id.is_some()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
        }
        Semantic::TenantMemberRevoke | Semantic::TenantRoleGrant | Semantic::TenantRoleRevoke => {
            p.workspace_id.is_none()
                && p.principal_id.is_some()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
        }
        // 被邀请人的称呼只作展示；寻址靠凭据，不靠任何身份字段（DD-83）
        Semantic::TenantMemberInvite => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.as_deref().is_some_and(|n| !n.is_empty())
        }
        Semantic::TenantMemberInviteRevoke => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_some()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
        }
        // 只由兑换在 Core 内构造（bff_submittable），这里仍按闭集核对
        Semantic::TenantMemberAdmit => {
            p.workspace_id.is_none()
                && p.principal_id.is_some()
                && p.invitation_id.is_some()
                && p.original_action_execution_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
        }
        Semantic::TaskCancel | Semantic::TaskRerun => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.original_action_execution_id.is_some()
                && p.slug.is_none()
                && p.name.is_none()
        }
        Semantic::AutomationCreate
        | Semantic::AutomationPublish
        | Semantic::AutomationEnable
        | Semantic::AutomationPause
        | Semantic::AutomationDisable
        | Semantic::AutomationRotateWebhookSecret
        | Semantic::AutomationDelete
        | Semantic::CapabilityContractRegister
        | Semantic::CapabilityContractApprove
        | Semantic::CapabilityContractDeprecate
        | Semantic::ComponentReleaseRegister
        | Semantic::ComponentReleaseApprove
        | Semantic::ApplicationBindingCreate
        | Semantic::ApplicationBindingDisable
        | Semantic::ResourceCreate => false,
    };
    if ok {
        Ok(p)
    } else {
        Err(bad())
    }
}

/// 参数摘要绑定 action、确切版本、target 与规范化参数。审批只对这一个摘要有效
/// （.design/10 §2 的五元组之一）。serde_json 的对象按键排序序列化，因此同一组
/// 参数永远得到同一个摘要。
fn parameter_hash(def: &Definition, target_id: Uuid, params: &Params) -> String {
    let canonical = json!({
        "actionKey": def.action_key,
        "actionVersion": def.version,
        "targetId": target_id,
        "params": params.to_json(),
    });
    hex::encode(Sha256::digest(canonical.to_string().as_bytes()))
}

/// 解析出的目标：它的 ID、准入时读到的版本（新建为 0），以及执行 Workspace。
#[derive(Debug, Clone, PartialEq)]
pub struct Target {
    pub id: Uuid,
    pub version: i32,
    pub workspace_id: Option<Uuid>,
}

/// Platform Catalog 会话此刻可发起的业务 Tenant 生命周期动作（只读提示，提交时
/// 重新准入）。
#[derive(Debug, Clone, Copy, Default)]
pub struct TenantLifecycleOffer {
    suspend: bool,
    restore: bool,
}

impl TenantLifecycleOffer {
    /// 暂停对 ACTIVE、以及协作面 binding 为 ACTIVE 的 ERROR（暂停或恢复失败留下的）给出；
    /// 恢复只对 SUSPENDED 给出；收敛中与建立失败没有 binding 的不给。
    pub fn for_state(
        self,
        state: &str,
        has_binding: bool,
    ) -> Option<contracts::TenantLifecycleActionKey> {
        match state {
            "ACTIVE" if self.suspend => Some(contracts::TenantLifecycleActionKey::TenantSuspend),
            "ERROR" if self.suspend && has_binding => {
                Some(contracts::TenantLifecycleActionKey::TenantSuspend)
            }
            "SUSPENDED" if self.restore => Some(contracts::TenantLifecycleActionKey::TenantRestore),
            _ => None,
        }
    }
}

/// 调用方此刻可发起的 Workspace 生命周期动作（只读提示，提交时重新准入）。
#[derive(Debug, Clone, Copy, Default)]
pub struct WorkspaceLifecycleOffer {
    suspend: bool,
    restore: bool,
}

impl WorkspaceLifecycleOffer {
    /// 暂停只对 ACTIVE 与 ERROR、恢复只对 SUSPENDED 给出，与各自准入接受的起始状态
    /// 相同；收敛中的 Workspace 不给任何动作。
    pub fn for_state(self, state: &str) -> Option<contracts::WorkspaceLifecycleActionKey> {
        match state {
            "ACTIVE" | "ERROR" if self.suspend => {
                Some(contracts::WorkspaceLifecycleActionKey::WorkspaceSuspend)
            }
            "SUSPENDED" if self.restore => {
                Some(contracts::WorkspaceLifecycleActionKey::WorkspaceRestore)
            }
            _ => None,
        }
    }
}

/// 按当前事实解析 target。`frozen` 是已准入动作冻结的 target ID：新建类动作的
/// ID 在首次准入时分配，重新准入必须解析到同一个。
#[allow(clippy::too_many_arguments)]
async fn resolve_target(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    sem: Semantic,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    let for_update = if lock { " for update" } else { "" };
    match sem {
        Semantic::ConversationOpen => {
            crate::conversations::target(conn, tenant, initiator, def, p, frozen).await
        }
        Semantic::ResourceCreate => {
            crate::resource_provision::target(conn, tenant, initiator, def, p, frozen, lock).await
        }
        Semantic::ApplicationBindingCreate | Semantic::ApplicationBindingDisable => {
            crate::application_binding::target(conn, tenant, def, p, frozen, lock).await
        }
        Semantic::ComponentReleaseRegister => {
            crate::component_release::target(conn, tenant, def, p, frozen).await
        }
        Semantic::ComponentReleaseApprove => {
            crate::component_release::approval::target(conn, tenant, def, p, frozen).await
        }
        Semantic::CapabilityContractRegister
        | Semantic::CapabilityContractApprove
        | Semantic::CapabilityContractDeprecate => {
            crate::capability_contract::target(conn, tenant, def, sem, p, frozen, lock).await
        }
        Semantic::AgentInstallationExecuteGrant
        | Semantic::AgentInstallationExecuteRevoke
        | Semantic::ResourceGrantRead
        | Semantic::ResourceRevokeRead => {
            installation_permission::target(conn, tenant, def, sem, p, frozen, lock).await
        }
        Semantic::LlmRouteCreate => {
            crate::model_route::create_target(conn, tenant, def, p, frozen, lock).await
        }
        Semantic::AutomationCreate
        | Semantic::AutomationPublish
        | Semantic::AutomationEnable
        | Semantic::AutomationPause
        | Semantic::AutomationDisable
        | Semantic::AutomationDelete
        | Semantic::AutomationRotateWebhookSecret => {
            crate::automation::management_target(conn, tenant, initiator, def, p, frozen, lock)
                .await
        }
        Semantic::AgentDelegationGrant | Semantic::AgentDelegationRevoke => {
            delegation::target(conn, tenant, def, sem, p, frozen, lock).await
        }
        Semantic::AgentInstallationCreate | Semantic::AgentInstallationUpgrade => {
            crate::agent_installation::target(conn, tenant, initiator, def, p, frozen, lock).await
        }
        Semantic::AgentVersionCreate
        | Semantic::AgentVersionUpdate
        | Semantic::AgentVersionPublish
        | Semantic::AgentVersionRetire => {
            let creating = sem == Semantic::AgentVersionCreate;
            let expected_object = if creating { "resource" } else { "asset" };
            let expected_permission = if creating {
                "create"
            } else if sem == Semantic::AgentVersionUpdate {
                "update"
            } else {
                "manage"
            };
            if def.target_type != if creating { "RESOURCE" } else { "ASSET" }
                || def.permission_object_type != expected_object
                || def.permission != expected_permission
                || def.workspace_rule != "TARGET_HOME_WORKSPACE"
                || def.tenant_rule != "SESSION_TENANT"
                || def.execution_mode != "SYNC"
                || (!creating
                    && sem == Semantic::AgentVersionPublish
                    && !matches!(
                        def.confirmation_mode.as_str(),
                        "NONE" | "EXPLICIT" | "APPROVAL"
                    ))
                || (sem == Semantic::AgentVersionRetire
                    && (def.confirmation_mode != "EXPLICIT"
                        || def.approval_policy_id.is_some()
                        || def.approval_policy_version.is_some()
                        || def.workflow_kind.is_some()
                        || def.quota_policy != "NONE"
                        || !def.meters.is_empty()
                        || def.result_exposure != "NONE"))
                || (matches!(
                    sem,
                    Semantic::AgentVersionCreate | Semantic::AgentVersionUpdate
                ) && def.confirmation_mode != "NONE")
            {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            let parent_id = p
                .resource_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            let parent = crate::agent_definition::resource(conn, tenant, parent_id, lock)
                .await?
                .filter(|r| {
                    r.state == "ACTIVE"
                        && r.projection_action_execution_id.is_none()
                        && p.resource_version == Some(r.version)
                })
                .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
            if creating {
                if frozen.is_some_and(|id| id != parent.id) {
                    return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
                }
                Ok(Target {
                    id: parent.id,
                    version: parent.version,
                    workspace_id: parent.home_workspace_id,
                })
            } else {
                let id = p
                    .asset_id
                    .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
                let v = crate::agent_version::version(conn, tenant, id, lock)
                    .await?
                    .filter(|v| {
                        v.agent_resource_id == parent.id
                            && v.state
                                == if sem == Semantic::AgentVersionRetire {
                                    "PUBLISHED"
                                } else {
                                    "DRAFT"
                                }
                            && v.asset_state == v.state
                            && v.projection_action_execution_id.is_none()
                            && p.asset_version == Some(v.version)
                            && frozen.is_none_or(|id| id == v.asset_id)
                    })
                    .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
                Ok(Target {
                    id: v.asset_id,
                    version: v.version,
                    workspace_id: parent.home_workspace_id,
                })
            }
        }
        Semantic::AgentDefinitionCreate => {
            if def.target_type != "RESOURCE"
                || def.permission_object_type != "tenant"
                || def.permission != "create"
                || def.workspace_rule != "TENANT_ONLY"
                || def.execution_mode != "SYNC"
                || def.confirmation_mode != "NONE"
            {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            let taken:Option<Uuid> = sqlx::query_scalar(
                "select a.resource_id from catalog.agent_definition a join catalog.resource r on r.id=a.resource_id
                 where r.tenant_id=$1 and a.stable_slug=$2")
                .bind(tenant).bind(&p.slug).fetch_optional(&mut *conn).await?;
            if taken.is_some() {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            if lock && !crate::agent_definition::active_owner(conn, tenant, initiator).await? {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            Ok(Target {
                id: frozen.unwrap_or_else(Uuid::new_v4),
                version: 0,
                workspace_id: None,
            })
        }
        Semantic::AgentDefinitionUpdate | Semantic::ResourceTransferOwner => {
            if def.target_type != "RESOURCE"
                || def.permission_object_type != "resource"
                || def.workspace_rule != "TARGET_HOME_WORKSPACE"
                || def.execution_mode != "SYNC"
                || (sem == Semantic::AgentDefinitionUpdate
                    && (def.permission != "update" || def.confirmation_mode != "NONE"))
                || (sem == Semantic::ResourceTransferOwner
                    && (def.permission != "transfer_owner" || def.confirmation_mode != "APPROVAL"))
            {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            let id = p
                .resource_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            let r = crate::agent_definition::resource(conn, tenant, id, lock)
                .await?
                .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
            if r.state != "ACTIVE"
                || r.projection_action_execution_id.is_some()
                || p.resource_version != Some(r.version)
                || frozen.is_some_and(|f| f != r.id)
            {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            if sem == Semantic::ResourceTransferOwner {
                let owner = p
                    .principal_id
                    .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
                if owner == r.owner_principal_id {
                    return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
                }
                if !crate::agent_definition::active_owner(conn, tenant, owner).await? {
                    return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
                }
            }
            Ok(Target {
                id: r.id,
                version: r.version,
                workspace_id: r.home_workspace_id,
            })
        }
        Semantic::SecretRefRehome => {
            let principal = p
                .principal_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            let version: Option<i32> = sqlx::query_scalar(&format!(
                "select version from identity.buzz_identity_binding
                 where tenant_id = $1 and principal_id = $2 and custody = 'SERVER'
                   and kind in ('HUMAN','CONTROL') and state = 'ACTIVE'{for_update}"
            ))
            .bind(tenant)
            .bind(principal)
            .fetch_optional(&mut *conn)
            .await?;
            match version {
                Some(version) if frozen.is_none_or(|id| id == principal) => Ok(Target {
                    id: principal,
                    version,
                    workspace_id: None,
                }),
                Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
                None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
            }
        }
        Semantic::TaskCancel | Semantic::TaskRerun => {
            let original_id = p
                .original_action_execution_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            let (original, _) =
                control_original(conn, tenant, initiator, def, sem, original_id, lock).await?;
            if frozen.is_some_and(|id| id != original.id) {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            Ok(Target {
                id: original.id,
                version: original.action_version,
                workspace_id: original.workspace_id,
            })
        }
        Semantic::TenantRoleGrant
        | Semantic::TenantRoleRevoke
        | Semantic::WorkspaceRoleGrant
        | Semantic::WorkspaceRoleRevoke => {
            let t = role_template_of(&mut *conn, def).await?;
            let in_workspace = matches!(
                sem,
                Semantic::WorkspaceRoleGrant | Semantic::WorkspaceRoleRevoke
            );
            // 定义说的对象类型与模板展开的对象类型必须一致，否则按哪一个写都是错的
            if (t.object_type == "workspace") != in_workspace {
                tracing::error!(action = %def.action_key, template = %t.role_key, "角色动作与模板的对象类型不一致");
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            let principal = p
                .principal_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            let object = if in_workspace {
                let ws_ok: Option<i32> = sqlx::query_scalar(&format!(
                    "select 1 from identity.workspace where id = $1 and tenant_id = $2 and state = 'ACTIVE'{for_update}"
                ))
                .bind(p.workspace_id)
                .bind(tenant)
                .fetch_optional(&mut *conn)
                .await?;
                if ws_ok.is_none() {
                    return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
                }
                p.workspace_id
                    .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?
            } else {
                tenant
            };
            // 授予对象必须是本 Tenant 的 active HUMAN 且 TenantMembership ACTIVE
            // （DD-82）；撤销只要求它是本 Tenant 的 HUMAN——失权者身上残留的角色
            // 也必须能被撤掉。
            let subject: Option<i32> = if sem.is_grant() {
                sqlx::query_scalar(&format!(
                    "select 1 from identity.principal p
                     join identity.tenant_membership tm on tm.tenant_principal_id = p.id
                     where p.id = $1 and p.tenant_id = $2 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
                       and tm.tenant_id = $2 and tm.state = 'ACTIVE'{for_update}"
                ))
                .bind(principal)
                .bind(tenant)
                .fetch_optional(&mut *conn)
                .await?
            } else {
                sqlx::query_scalar(
                    "select 1 from identity.principal where id = $1 and tenant_id = $2 and kind = 'HUMAN'",
                )
                .bind(principal)
                .bind(tenant)
                .fetch_optional(&mut *conn)
                .await?
            };
            if subject.is_none() {
                return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
            }
            Ok(Target {
                id: crate::roles::target_id(&t, object, principal),
                version: 0,
                workspace_id: in_workspace.then_some(object),
            })
        }
        Semantic::WorkspaceCreate => {
            let taken: Option<Uuid> = sqlx::query_scalar(&format!(
                "select id from identity.workspace where tenant_id = $1 and slug = $2{for_update}"
            ))
            .bind(tenant)
            .bind(&p.slug)
            .fetch_optional(&mut *conn)
            .await?;
            if taken.is_some() {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            Ok(Target {
                id: frozen.unwrap_or_else(Uuid::new_v4),
                version: 0,
                workspace_id: None,
            })
        }
        Semantic::TenantDelete => {
            if def.target_type != "TENANT"
                || def.tenant_rule != "SESSION_TENANT"
                || def.workspace_rule != "TENANT_ONLY"
                || def.permission_object_type != "tenant"
                || def.permission != "manage"
                || def.confirmation_mode != "APPROVAL"
                || def.execution_mode != "TEMPORAL"
                || def.workflow_kind.as_deref() != Some("TENANT_LIFECYCLE")
            {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            if p.tenant_id != Some(tenant)
                || frozen.is_some_and(|id| id != tenant)
                || crate::platform_bootstrap::is_catalog_tenant(&mut *conn, tenant).await?
            {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            let row: Option<(i32, String)> = sqlx::query_as(&format!(
                "select version, state from identity.tenant where id = $1{for_update}"
            ))
            .bind(tenant)
            .fetch_optional(&mut *conn)
            .await?;
            match row {
                Some((version, state)) if state == "SUSPENDED" => Ok(Target {
                    id: tenant,
                    version,
                    workspace_id: None,
                }),
                Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
                None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
            }
        }
        Semantic::TenantSuspend | Semantic::TenantRestore => {
            // DD-96(1)：只在 Platform Catalog Tenant 的会话中执行，Check 对象是 Catalog
            // 的 manage；目录形状与语义不一致即阻断
            if def.target_type != "TENANT"
                || def.tenant_rule != "SESSION_TENANT"
                || def.workspace_rule != "TENANT_ONLY"
                || def.permission_object_type != "tenant"
                || def.permission != "manage"
                || def.confirmation_mode != "EXPLICIT"
                || def.execution_mode != "TEMPORAL"
                || def.workflow_kind.as_deref() != Some("TENANT_LIFECYCLE")
            {
                tracing::error!(action = %def.action_key, "Tenant 生命周期动作的目录形状与语义不一致");
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            if !crate::platform_bootstrap::is_catalog_tenant(&mut *conn, tenant).await? {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            let Some((from, _, _)) = sem.tenant_segment() else {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            };
            let target = p
                .tenant_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            // 目标只能是业务 Tenant：Catalog 不暂停自己。从 ERROR 起步的暂停还要求协作面
            // binding ACTIVE——建立失败而没有 Community 的 ERROR 无可归档（与入口提示一致）
            let row: Option<(i32, String, bool)> = sqlx::query_as(&format!(
                "select t.version, t.state,
                        exists (select 1 from projection.tenant_buzz_binding b
                                where b.tenant_id = t.id and b.state = 'ACTIVE')
                 from identity.tenant t where t.id = $1 and t.id <> $2{for_update}"
            ))
            .bind(target)
            .bind(tenant)
            .fetch_optional(&mut *conn)
            .await?;
            match row {
                Some((version, state, bound))
                    if from.contains(&state.as_str())
                        && (state != "ERROR" || bound)
                        && frozen.is_none_or(|id| id == target) =>
                {
                    Ok(Target {
                        id: target,
                        version,
                        workspace_id: None,
                    })
                }
                Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
                None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
            }
        }
        Semantic::WorkspaceSuspend | Semantic::WorkspaceRestore => {
            // 从 Tenant scope 指向 Workspace（.design/03 §2）：执行 scope 没有
            // Workspace，权限对象是所属 Tenant。目录把它登记成别的形状即与语义不一致
            if def.target_type != "WORKSPACE"
                || def.workspace_rule != "TENANT_ONLY"
                || def.permission_object_type != "tenant"
                || def.execution_mode != "TEMPORAL"
                || def.workflow_kind.as_deref() != Some("WORKSPACE_LIFECYCLE")
            {
                tracing::error!(action = %def.action_key, "Workspace 生命周期动作的目录形状与语义不一致");
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            let Some((from, _, _)) = sem.workspace_segment() else {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            };
            let ws = p
                .workspace_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            // 跨 Tenant 的 ID 与不存在是同一个回答
            let row: Option<(i32, String)> = sqlx::query_as(&format!(
                "select version, state from identity.workspace
                 where id = $1 and tenant_id = $2{for_update}"
            ))
            .bind(ws)
            .bind(tenant)
            .fetch_optional(&mut *conn)
            .await?;
            match row {
                Some((version, state))
                    if from.contains(&state.as_str()) && frozen.is_none_or(|id| id == ws) =>
                {
                    Ok(Target {
                        id: ws,
                        version,
                        workspace_id: None,
                    })
                }
                Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
                None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
            }
        }
        Semantic::WorkspaceJoin
        | Semantic::WorkspaceMemberAdd
        | Semantic::WorkspaceMemberRevoke => {
            // Joining never accepts a caller-supplied subject or changes another membership.
            let (ws, principal) = (
                p.workspace_id,
                if sem == Semantic::WorkspaceJoin {
                    Some(initiator)
                } else {
                    p.principal_id
                },
            );
            // Workspace 必须属于该 Tenant 且 ACTIVE：跨 Tenant 的 ID 与不存在是
            // 同一个回答
            let ws_ok: Option<i32> = sqlx::query_scalar(&format!(
                "select 1 from identity.workspace where id = $1 and tenant_id = $2 and state = 'ACTIVE'
                   and (not $3 or visibility = 'open'){for_update}"
            ))
            .bind(ws)
            .bind(tenant)
            .bind(sem == Semantic::WorkspaceJoin)
            .fetch_optional(&mut *conn)
            .await?;
            if ws_ok.is_none() {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            let row: Option<(Uuid, i32, String)> = sqlx::query_as(&format!(
                "select id, version, state from identity.workspace_membership
                 where workspace_id = $1 and tenant_principal_id = $2{for_update}"
            ))
            .bind(ws)
            .bind(principal)
            .fetch_optional(&mut *conn)
            .await?;
            if sem == Semantic::WorkspaceMemberRevoke {
                return match row {
                    Some((id, version, state)) if matches!(state.as_str(), "ACTIVE" | "ERROR") => {
                        Ok(Target {
                            id,
                            version,
                            workspace_id: ws,
                        })
                    }
                    Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
                    None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
                };
            }
            // 加入的对象必须是本 Tenant 的 active HUMAN 成员：Workspace 成员关系
            // 不能引入 Tenant 之外的人（.design/03 §2）
            let subject_ok: Option<i32> = sqlx::query_scalar(&format!(
                "select 1 from identity.principal p
                 join identity.tenant_membership tm on tm.tenant_principal_id = p.id
                 where p.id = $1 and p.tenant_id = $2 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
                   and tm.tenant_id = $2 and tm.state = 'ACTIVE'{for_update}"
            ))
            .bind(principal)
            .bind(tenant)
            .fetch_optional(&mut *conn)
            .await?;
            if subject_ok.is_none() {
                return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
            }
            match row {
                None => Ok(Target {
                    id: frozen.unwrap_or_else(Uuid::new_v4),
                    version: 0,
                    workspace_id: ws,
                }),
                // 恢复访问建立新 membership version 并重走建立对账（DD-45）
                Some((id, version, state))
                    if state == "REVOKED" && sem != Semantic::WorkspaceJoin =>
                {
                    Ok(Target {
                        id,
                        version,
                        workspace_id: ws,
                    })
                }
                Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
            }
        }
        Semantic::TenantMemberRevoke => {
            let row: Option<(Uuid, i32, String)> = sqlx::query_as(&format!(
                "select id, version, state from identity.tenant_membership
                 where tenant_id = $1 and tenant_principal_id = $2{for_update}"
            ))
            .bind(tenant)
            .bind(p.principal_id)
            .fetch_optional(&mut *conn)
            .await?;
            match row {
                Some((id, version, state)) if matches!(state.as_str(), "ACTIVE" | "ERROR") => {
                    Ok(Target {
                        id,
                        version,
                        workspace_id: None,
                    })
                }
                Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
                None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
            }
        }
        // 新邀请的 ID 在首次准入时分配，重新判定解析到同一个
        Semantic::TenantMemberInvite => Ok(Target {
            id: frozen.unwrap_or_else(Uuid::new_v4),
            version: 0,
            workspace_id: None,
        }),
        Semantic::TenantMemberInviteRevoke => {
            let row: Option<(i32, String, bool)> = sqlx::query_as(&format!(
                "select version, state, expires_at > now() from identity.tenant_invitation
                 where id = $1 and tenant_id = $2{for_update}"
            ))
            .bind(p.invitation_id)
            .bind(tenant)
            .fetch_optional(&mut *conn)
            .await?;
            let id = p
                .invitation_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            match row {
                Some((version, state, live)) => {
                    crate::invitation::issued_or_refusal(&state, live)?;
                    Ok(Target {
                        id,
                        version,
                        workspace_id: None,
                    })
                }
                None => Err(Refusal::Precondition(ReasonCode::InvitationNotFound)),
            }
        }
        // 开通的目标是兑换建立的 INVITED membership，且它必须正是这份已兑换邀请
        // 所绑定的那一条：兑换记录就是 invitation fact（.design/09 §5）
        Semantic::TenantMemberAdmit => {
            let row: Option<(Uuid, i32, String)> = sqlx::query_as(&format!(
                "select tm.id, tm.version, tm.state from identity.tenant_membership tm
                 join identity.tenant_invitation ti on ti.tenant_membership_id = tm.id
                 where tm.tenant_id = $1 and tm.tenant_principal_id = $2
                   and ti.id = $3 and ti.tenant_id = $1 and ti.state = 'REDEEMED'{for_update}"
            ))
            .bind(tenant)
            .bind(p.principal_id)
            .bind(p.invitation_id)
            .fetch_optional(&mut *conn)
            .await?;
            match row {
                Some((id, version, state)) if state == "INVITED" => Ok(Target {
                    id,
                    version,
                    workspace_id: None,
                }),
                Some(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
                None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
            }
        }
    }
}

/// 控制定义必须精确绑定原 action/version；不能凭同 Tenant 的任意已准入动作
/// 借用取消权限。原定义的确切版本允许已退休，但控制定义须在提交时 ACTIVE。
async fn control_original(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    control: &Definition,
    sem: Semantic,
    original_id: Uuid,
    lock: bool,
) -> Result<(Execution, Definition), Refusal> {
    if control.target_type != "ACTION_EXECUTION"
        || control.execution_mode != "PROTOCOL"
        || control.workflow_kind.is_some()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let suffix = if lock { " for update" } else { "" };
    let original: Execution = sqlx::query_as(&format!(
        "select {EXECUTION_COLUMNS} from admission.action_execution
         where id = $1 and tenant_id = $2 and initiator_principal_id = $3{suffix}"
    ))
    .bind(original_id)
    .bind(tenant)
    .bind(initiator)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
    let source: Definition = sqlx::query_as(&format!(
        "select {DEFINITION_COLUMNS} from catalog.action_definition d
         where action_key = $1 and version = $2 and exists (
           select 1 from admission.action_execution a where a.id=$3
             and ((a.action_definition_id=d.id and a.component_release_id is not distinct from d.component_release_id)
               or (a.action_definition_id is null and a.component_binding_kind is null and d.component_release_id is null)))"
    ))
    .bind(&original.action_key)
    .bind(original.action_version)
    .bind(original.id)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let expected = match sem {
        Semantic::TaskCancel => cancel_key_for(&original),
        Semantic::TaskRerun => rerun_key_for(&original),
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    };
    if control.action_key != expected
        || source.execution_mode != "TEMPORAL"
        || (source.workflow_kind.is_none()
            && !(sem == Semantic::TaskCancel
                && task_control::agent_source(conn, &original, &source).await?))
        || control.tenant_rule != source.tenant_rule
        || control.workspace_rule != source.workspace_rule
        || control.permission != source.permission
        || control.permission_object_type != source.permission_object_type
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if sem == Semantic::TaskCancel {
        if control.confirmation_mode != "NONE"
            || control.approval_policy_id.is_some()
            || control.approval_policy_version.is_some()
        {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
    } else {
        if control.confirmation_mode != source.confirmation_mode {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        if source.confirmation_mode == "APPROVAL" {
            let same_policy: Option<bool> = sqlx::query_scalar(
                "select c.role_requirements = s.role_requirements
                        and c.owner_requirement = s.owner_requirement
                        and c.self_approval = s.self_approval
                        and c.expires_in_seconds = s.expires_in_seconds
                        and c.action_key = $5 and c.target_type = 'ACTION_EXECUTION'
                        and c.id <> s.id and c.status = 'ACTIVE'
                 from catalog.approval_policy c, catalog.approval_policy s
                 where c.id = $1 and c.version = $2 and s.id = $3 and s.version = $4",
            )
            .bind(control.approval_policy_id)
            .bind(control.approval_policy_version)
            .bind(source.approval_policy_id)
            .bind(source.approval_policy_version)
            .bind(&control.action_key)
            .fetch_optional(&mut *conn)
            .await?;
            if same_policy != Some(true) {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
        } else if control.approval_policy_id.is_some() || control.approval_policy_version.is_some()
        {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
    }
    Ok((original, source))
}

fn cancel_key_for(original: &Execution) -> String {
    format!(
        "task.cancel.{}.v{}",
        original.action_key, original.action_version
    )
}

fn rerun_key_for(original: &Execution) -> String {
    format!(
        "task.rerun.{}.v{}",
        original.action_key, original.action_version
    )
}

// ---------------------------------------------------------------------------
// 评估：scope guard 与 SpiceDB fresh Check
// ---------------------------------------------------------------------------

/// 发起动作的人。BFF 路径从 PlatformSession 取；重新准入从 ActionExecution 取，
/// 并重新核对他此刻仍是 active HUMAN 成员。
#[derive(Debug, Clone, Copy)]
pub struct Actor {
    pub tenant_id: Uuid,
    pub principal_id: Uuid,
    pub human_identity_id: Option<Uuid>,
}

pub(crate) struct Evaluation {
    pub(crate) allowed: bool,
    pub(crate) scope: &'static str,
    pub(crate) authorization: &'static str,
    pub(crate) quota: &'static str,
    pub(crate) zed_token: Option<String>,
    pub(crate) reason: Option<ReasonCode>,
}

impl Governance {
    /// scope guard 在 permission Check 之前（DD-46/50）；两者都通过才 ALLOW。
    pub(crate) async fn evaluate(
        &self,
        actor: Actor,
        def: &Definition,
        target: &Target,
    ) -> Result<Evaluation, Refusal> {
        let is_workspace_join = def.action_key == "workspace.join";
        let is_installation_create = matches!(
            def.action_key.as_str(),
            "agent.installation.create" | "agent.installation.upgrade"
        );
        let is_installation_permission = matches!(
            def.action_key.as_str(),
            installation_permission::GRANT
                | installation_permission::REVOKE
                | installation_permission::READ_GRANT
                | installation_permission::READ_REVOKE
        );
        let is_route_create = def.action_key == "llm_route.create";
        let is_agent_cancel = task_control::is_agent_cancel(&def.action_key);
        let declared_workspace =
            def.workspace_rule == "DECLARED_WORKSPACE" && target.workspace_id.is_some();
        let permission_object_type = if declared_workspace {
            "workspace"
        } else {
            def.permission_object_type.as_str()
        };
        let is_memory = matches!(
            def.action_key.as_str(),
            "agent.memory.core.read"
                | "agent.memory.entry.list"
                | "agent.memory.entry.read"
                | "agent.memory.core.replace"
                | "agent.memory.entry.set"
                | "agent.memory.entry.patch"
                | "agent.memory.entry.remove"
        );
        let deny = |scope: &'static str, authz: &'static str, token, reason| Evaluation {
            allowed: false,
            scope,
            authorization: authz,
            quota: "NOT_APPLICABLE",
            zed_token: token,
            reason: Some(reason),
        };
        // Tenant ACTIVE、发起者是该 Tenant 的 active HUMAN、TenantMembership ACTIVE。
        // INVITED/PROVISIONING/REVOKING/REVOKED/ERROR 都不能发起新动作（DD-45）。
        let active: Option<i32> = sqlx::query_scalar(
            "select 1 from identity.principal p
             join identity.tenant t on t.id = p.tenant_id
             join identity.tenant_membership tm on tm.tenant_principal_id = p.id
             where p.id = $1 and p.tenant_id = $2 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
               and (t.state = 'ACTIVE' or ($3 and t.state = 'SUSPENDED')
                    or ($4 and t.state = 'DELETING' and exists (
                        select 1 from admission.action_execution ae
                        where ae.id = $5 and ae.tenant_id = t.id and ae.action_key = 'tenant.delete')))
               and tm.state = 'ACTIVE'",
        )
        .bind(actor.principal_id)
        .bind(actor.tenant_id)
        .bind(def.action_key == "tenant.delete")
        .bind(def.action_key.starts_with("task.cancel.tenant.delete.v"))
        .bind(target.id)
        .fetch_optional(&self.pool)
        .await?;
        if active.is_none() {
            return Ok(deny(
                "DENY",
                "NOT_APPLICABLE",
                None,
                ReasonCode::ScopeGuardFailed,
            ));
        }

        if def.target_type == "ACTION_EXECUTION" {
            let owned: Option<i32> = sqlx::query_scalar(
                "select 1 from admission.action_execution
                 where id = $1 and tenant_id = $2 and initiator_principal_id = $3
                   and workspace_id is not distinct from $4",
            )
            .bind(target.id)
            .bind(actor.tenant_id)
            .bind(actor.principal_id)
            .bind(target.workspace_id)
            .fetch_optional(&self.pool)
            .await?;
            if owned.is_none() {
                return Ok(deny(
                    "DENY",
                    "NOT_APPLICABLE",
                    None,
                    ReasonCode::ScopeGuardFailed,
                ));
            }
        }

        // Workspace scoped 动作先要求执行 Workspace 属于该 Tenant 且 ACTIVE（DD-46、
        // `.design/03` §2）：SUSPENDING/SUSPENDED/RESTORING 期间，成员、角色与任务
        // 控制等 Workspace scope 的新动作一律在 permission Check 之前拒绝
        if def.workspace_rule == "WORKSPACE_REQUIRED"
            || is_installation_permission
            || declared_workspace
            || is_agent_cancel
            || def.action_key.starts_with("automation.")
            || matches!(
                def.action_key.as_str(),
                "agent.delegation.grant" | "agent.delegation.revoke"
            )
        {
            let ws_active: Option<i32> = sqlx::query_scalar(
                "select 1 from identity.workspace
                 where id = $1 and tenant_id = $2 and state = 'ACTIVE'",
            )
            .bind(target.workspace_id)
            .bind(actor.tenant_id)
            .fetch_optional(&self.pool)
            .await?;
            if ws_active.is_none() {
                return Ok(deny(
                    "DENY",
                    "NOT_APPLICABLE",
                    None,
                    ReasonCode::ScopeGuardFailed,
                ));
            }
        }

        let object_id = match permission_object_type {
            "tenant" => actor.tenant_id,
            "workspace" => match target.workspace_id {
                Some(w) => w,
                // 定义要求在 Workspace 上检查而执行 scope 没有 Workspace：定义与
                // 语义不一致，fail closed
                None => {
                    return Ok(deny(
                        "DENY",
                        "NOT_APPLICABLE",
                        None,
                        ReasonCode::ScopeGuardFailed,
                    ))
                }
            },
            "resource" => {
                if is_agent_cancel {
                    task_control::permission_resource(self, actor, def, target).await?
                } else if def.action_key.starts_with("automation.") {
                    let mut conn = self.pool.acquire().await?;
                    let row = crate::automation::management_resource(
                        &mut conn,
                        actor.tenant_id,
                        target.id,
                        false,
                    )
                    .await?
                    .filter(|row| {
                        row.state == "ACTIVE"
                            && row.version == target.version
                            && row.projection_action_execution_id.is_none()
                            && Some(row.workspace_id) == target.workspace_id
                    });
                    let Some(row) = row else {
                        return Ok(deny(
                            "DENY",
                            "NOT_APPLICABLE",
                            None,
                            ReasonCode::ScopeGuardFailed,
                        ));
                    };
                    if !crate::automation::management_projection(self, &row).await? {
                        return Ok(deny(
                            "DENY",
                            "NOT_APPLICABLE",
                            None,
                            ReasonCode::ScopeGuardFailed,
                        ));
                    }
                    target.id
                } else if is_installation_permission {
                    let mut conn = self.pool.acquire().await?;
                    installation_permission::evaluate_target(
                        self,
                        &mut conn,
                        actor.tenant_id,
                        target,
                        &def.action_key,
                    )
                    .await?;
                    target.id
                } else if is_memory
                    || matches!(
                        def.action_key.as_str(),
                        "agent.delegation.grant"
                            | "agent.delegation.revoke"
                            | "agent.installation.upgrade"
                    )
                {
                    let mut conn = self.pool.acquire().await?;
                    let row = delegation::installation(
                        &mut conn,
                        actor.tenant_id,
                        target.id,
                        false,
                        is_memory || def.action_key == "agent.delegation.revoke",
                    )
                    .await?
                    .filter(|row| {
                        row.version == target.version
                            && Some(row.workspace_id) == target.workspace_id
                    });
                    let Some(row) = row else {
                        return Ok(deny(
                            "DENY",
                            "NOT_APPLICABLE",
                            None,
                            ReasonCode::ScopeGuardFailed,
                        ));
                    };
                    if !delegation::projection_matches(self, &row).await? {
                        return Ok(deny(
                            "DENY",
                            "NOT_APPLICABLE",
                            None,
                            ReasonCode::ScopeGuardFailed,
                        ));
                    }
                    target.id
                } else {
                    let mut conn = self.pool.acquire().await?;
                    let row = crate::agent_definition::resource(
                        &mut conn,
                        actor.tenant_id,
                        target.id,
                        false,
                    )
                    .await?;
                    let Some(r) = row.filter(|r| {
                        r.state == "ACTIVE"
                            && r.version == target.version
                            && r.projection_action_execution_id.is_none()
                            && r.home_workspace_id == target.workspace_id
                    }) else {
                        return Ok(deny(
                            "DENY",
                            "NOT_APPLICABLE",
                            None,
                            ReasonCode::ScopeGuardFailed,
                        ));
                    };
                    if !crate::agent_definition::projection_matches(
                        self,
                        r.id,
                        r.tenant_id,
                        r.owner_principal_id,
                    )
                    .await?
                    {
                        return Ok(deny(
                            "DENY",
                            "NOT_APPLICABLE",
                            None,
                            ReasonCode::ScopeGuardFailed,
                        ));
                    }
                    target.id
                }
            }
            "asset" => {
                let mut conn = self.pool.acquire().await?;
                let v = crate::agent_version::version(&mut conn, actor.tenant_id, target.id, false)
                    .await?
                    .filter(|v| {
                        v.version == target.version
                            && v.projection_action_execution_id.is_none()
                            && matches!(v.asset_state.as_str(), "DRAFT" | "PUBLISHED" | "RETIRED")
                    });
                let Some(v) = v else {
                    return Ok(deny(
                        "DENY",
                        "NOT_APPLICABLE",
                        None,
                        ReasonCode::ScopeGuardFailed,
                    ));
                };
                let parent = crate::agent_definition::resource(
                    &mut conn,
                    actor.tenant_id,
                    v.agent_resource_id,
                    false,
                )
                .await?
                .filter(|r| {
                    r.state == "ACTIVE"
                        && r.projection_action_execution_id.is_none()
                        && r.home_workspace_id == target.workspace_id
                });
                let Some(parent) = parent else {
                    return Ok(deny(
                        "DENY",
                        "NOT_APPLICABLE",
                        None,
                        ReasonCode::ScopeGuardFailed,
                    ));
                };
                if !crate::agent_definition::projection_matches(
                    self,
                    parent.id,
                    parent.tenant_id,
                    parent.owner_principal_id,
                )
                .await?
                    || !crate::agent_version::projection_matches(self, &v).await?
                {
                    return Ok(deny(
                        "DENY",
                        "NOT_APPLICABLE",
                        None,
                        ReasonCode::ScopeGuardFailed,
                    ));
                }
                target.id
            }
            // 未登记的对象类型始终失败闭合。
            _ => {
                return Ok(deny(
                    "DENY",
                    "NOT_APPLICABLE",
                    None,
                    ReasonCode::ScopeGuardFailed,
                ))
            }
        };
        let checked = self
            .spicedb
            .check(
                permission_object_type,
                &object_id.to_string(),
                &def.permission,
                &actor.principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;

        // Workspace scope（.design/03 §2、.design/10 §5）：HUMAN 要求 active
        // WorkspaceMembership。没有 ACTIVE 成员关系时：
        // - 此人在该 Workspace 有过成员关系（PROVISIONING/REVOKING/REVOKED/ERROR）：
        //   只剩 Tenant admin 一种例外，判据是 fresh tenant manage。workspace manage
        //   也由 workspace#admin 给出，以它为据会让撤权中或撤权后的成员凭残留的
        //   Workspace admin 继续放行——REVOKING 必须立即拒绝（DD-41、V-SCN-35）。
        // - 从未加入：fresh workspace manage 为真即满足（`03` §2），即由 DD-82 授予、
        //   不要求先加入 Workspace 的 Workspace admin。
        // 本切片 Workspace 动作检查的正是 workspace manage，Check 为假时不设例外。
        if (is_workspace_join
            || is_installation_permission
            || is_agent_cancel
            || is_memory
            || is_route_create
            || is_installation_create
            || def.action_key.starts_with("automation.")
            || matches!(
                def.action_key.as_str(),
                "agent.delegation.grant" | "agent.delegation.revoke"
            ))
            && checked.zed_token.is_empty()
        {
            return Err(Refusal::Unavailable(
                "Delegation 准入缺 checked revision".into(),
            ));
        }
        if def.workspace_rule == "WORKSPACE_REQUIRED"
            || declared_workspace
            || is_agent_cancel
            || def.action_key.starts_with("automation.")
            || matches!(
                def.action_key.as_str(),
                "agent.delegation.grant" | "agent.delegation.revoke"
            )
        {
            let membership: Option<String> = sqlx::query_scalar(
                "select state from identity.workspace_membership
                 where workspace_id = $1 and tenant_principal_id = $2",
            )
            .bind(target.workspace_id)
            .bind(actor.principal_id)
            .fetch_optional(&self.pool)
            .await?;
            let mut workspace_manage = def.permission == "manage"
                && permission_object_type == "workspace"
                && checked.allowed;
            if (is_memory
                || is_agent_cancel
                || is_route_create
                || is_installation_create
                || def.action_key.starts_with("automation.")
                || matches!(
                    def.action_key.as_str(),
                    "agent.delegation.grant" | "agent.delegation.revoke"
                ))
                && membership.as_deref() != Some("ACTIVE")
            {
                let workspace = target
                    .workspace_id
                    .ok_or(Refusal::Denied(ReasonCode::ScopeGuardFailed))?;
                let management = self
                    .spicedb
                    .check(
                        "workspace",
                        &workspace.to_string(),
                        "manage",
                        &actor.principal_id.to_string(),
                        Consistency::FullyConsistent,
                    )
                    .await
                    .map_err(|_| {
                        Refusal::Unavailable("Delegation Workspace membership 不可核验".into())
                    })?;
                if management.zed_token.is_empty() {
                    return Err(Refusal::Unavailable(
                        "Delegation Workspace membership 缺 checked revision".into(),
                    ));
                }
                workspace_manage = management.allowed;
            }
            // DD-80 self-join establishes membership; it cannot require that membership
            // already exist. Its sole exception is a fresh, public, same-tenant target
            // with no previous membership. Revocations are not undone by this route.
            let public_join = if is_workspace_join && membership.is_none() {
                sqlx::query_scalar::<_, bool>(
                    "select exists(select 1 from identity.workspace where id = $1
                     and tenant_id = $2 and state = 'ACTIVE' and visibility = 'open')",
                )
                .bind(target.workspace_id)
                .bind(actor.tenant_id)
                .fetch_one(&self.pool)
                .await?
                    && def.permission == "discover"
                    && permission_object_type == "tenant"
                    && checked.allowed
            } else {
                false
            };
            let admitted = match membership.as_deref() {
                Some("ACTIVE") => true,
                None => workspace_manage || public_join,
                Some(_) if workspace_manage => {
                    let management = self
                        .spicedb
                        .check(
                            "tenant",
                            &actor.tenant_id.to_string(),
                            "manage",
                            &actor.principal_id.to_string(),
                            Consistency::FullyConsistent,
                        )
                        .await
                        .map_err(|e| Refusal::Unavailable(e.to_string()))?;
                    if (is_memory
                        || is_agent_cancel
                        || is_route_create
                        || is_installation_create
                        || def.action_key.starts_with("automation.")
                        || matches!(
                            def.action_key.as_str(),
                            "agent.delegation.grant" | "agent.delegation.revoke"
                        ))
                        && management.zed_token.is_empty()
                    {
                        return Err(Refusal::Unavailable(
                            "Delegation Tenant membership 缺 checked revision".into(),
                        ));
                    }
                    management.allowed
                }
                Some(_) => false,
            };
            if !admitted {
                return Ok(deny(
                    "DENY",
                    "NOT_APPLICABLE",
                    Some(checked.zed_token),
                    ReasonCode::ScopeGuardFailed,
                ));
            }
        }
        if !checked.allowed {
            return Ok(deny(
                "ALLOW",
                "DENY",
                Some(checked.zed_token),
                ReasonCode::PermissionDenied,
            ));
        }
        Ok(Evaluation {
            allowed: true,
            scope: "ALLOW",
            authorization: "ALLOW",
            quota: "NOT_APPLICABLE",
            zed_token: Some(checked.zed_token),
            reason: None,
        })
    }

    /// ADR-14：在确认/批准满足之后消费 native CHECK；NONE 不读商业额度。
    /// 这里只产生准入结论，不创建 reservation、usage 或商业余额副本。
    pub(crate) async fn check_quota(
        &self,
        tenant: Uuid,
        def: &Definition,
        eval: &mut Evaluation,
    ) -> Result<(), Refusal> {
        if !eval.allowed {
            return Ok(());
        }
        let reason = match def.quota_policy.as_str() {
            "NONE" if def.meters.is_empty() => return Ok(()),
            "CHECK"
                if !def.meters.is_empty() && {
                    let mut unique = std::collections::HashSet::new();
                    def.meters
                        .iter()
                        .all(|key| !key.trim().is_empty() && unique.insert(key))
                } =>
            {
                let binding: Option<(String, String, String, String, i32)> = sqlx::query_as(
                    "select namespace, customer_id, subject_key_prefix, status, version
                     from projection.openmeter_binding where tenant_id = $1",
                )
                .bind(tenant)
                .fetch_optional(&self.pool)
                .await?;
                if let Some((namespace, customer_id, prefix, status, version)) = &binding {
                    if namespace != self.openmeter.namespace()
                        || prefix != &format!("{tenant}:")
                        || status != "ACTIVE"
                        || *version <= 0
                    {
                        Some(ReasonCode::BindingNotActive)
                    } else {
                        let result = self
                            .openmeter
                            .check_quota(tenant, customer_id, &def.meters)
                            .await;
                        // native 读取期间的撤销或重新绑定不能被先前的 ACTIVE 快照放行。
                        let current: Option<(String, String, String, String, i32)> =
                            sqlx::query_as(
                                "select namespace, customer_id, subject_key_prefix, status, version
                             from projection.openmeter_binding where tenant_id = $1",
                            )
                            .bind(tenant)
                            .fetch_optional(&self.pool)
                            .await?;
                        if current != binding {
                            Some(ReasonCode::BindingNotActive)
                        } else {
                            match result {
                                Ok(true) => None,
                                Ok(false) => Some(ReasonCode::QuotaExhausted),
                                Err(
                                    crate::openmeter::Error::Denied
                                    | crate::openmeter::Error::Precondition,
                                ) => Some(ReasonCode::BindingNotActive),
                                Err(crate::openmeter::Error::Conflict) => {
                                    Some(ReasonCode::TargetStateConflict)
                                }
                                Err(crate::openmeter::Error::Limit) => {
                                    Some(ReasonCode::RateLimited)
                                }
                                Err(crate::openmeter::Error::Unknown) => {
                                    return Err(Refusal::Unavailable(
                                        "OpenMeter CHECK 的 entitlement/credit 无法查证".into(),
                                    ))
                                }
                            }
                        }
                    }
                } else {
                    Some(ReasonCode::BindingNotActive)
                }
            }
            // STRICT 没有完整 producer 闭合与上界；未知 policy 或不合 meters 也不放行。
            _ => Some(ReasonCode::CapabilityBlocked),
        };
        eval.quota = if reason.is_none() { "ALLOW" } else { "DENY" };
        if let Some(reason) = reason {
            eval.allowed = false;
            eval.reason = Some(reason);
        }
        Ok(())
    }

    /// automation.run 使用同一 native CHECK，不建立另一额度准入或余额。
    pub(crate) async fn check_automation_quota(
        &self,
        tenant: Uuid,
        def: &Definition,
    ) -> Result<(), Refusal> {
        let mut eval = Evaluation {
            allowed: true,
            scope: "ALLOW",
            authorization: "ALLOW",
            quota: "NOT_APPLICABLE",
            zed_token: None,
            reason: None,
        };
        self.check_quota(tenant, def, &mut eval).await?;
        if eval.allowed && eval.quota == "ALLOW" {
            Ok(())
        } else {
            Err(Refusal::from_reason(
                eval.reason.unwrap_or(ReasonCode::CapabilityBlocked),
            ))
        }
    }

    /// 非 HUMAN actor 的实际判定仍写既有 ActionDecision/AuditEntry；不能复用 HUMAN
    /// 路径中的 actor=initiator、Delegation NOT_APPLICABLE 默认值。
    pub(crate) async fn record_automation_decision(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        ae: &Execution,
        def: &Definition,
        phase: &str,
        result: Result<String, &Refusal>,
    ) -> Result<(), sqlx::Error> {
        let message_only: bool = sqlx::query_scalar(
            "select exists(select 1 from catalog.automation_version v
            where v.asset_id=($1::jsonb->>'automationVersionAssetId')::uuid
              and v.automation_resource_id=$2 and v.action->>'kind' IN ('POST_MESSAGE','POST_MESSAGE_STEPS','ADD_REACTION_STEPS','SET_CHANNEL_TOPIC_STEPS'))",
        )
        .bind(&ae.parameters)
        .bind(ae.target_id)
        .fetch_one(&mut **tx)
        .await?;
        let (outcome, token, reason) = match &result {
            Ok(token) => ("ALLOW", Some(token.as_str()), None),
            Err(Refusal::Unavailable(_)) => (
                "NOT_APPLICABLE",
                None,
                Some(ReasonCode::DependencyUnavailable),
            ),
            Err(error) => ("DENY", None, Some(error.reason())),
        };
        sqlx::query("insert into admission.action_decision
            (id,operation_id,action_execution_id,phase,tenant_id,workspace_id,
             authenticated_principal_id,acting_principal_id,action_key,action_version,target_id,parameter_hash,
             scope_decision,authorization_decision,delegation_decision,approval_decision,
             capacity_decision,quota_decision,audit_decision,zed_token,reason_code)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,$13,
                    'NOT_APPLICABLE',$16,$13,'RECORDED',$14,$15)")
            .bind(Uuid::new_v4()).bind(ae.operation_id).bind(ae.id).bind(phase).bind(ae.tenant_id)
            .bind(ae.workspace_id).bind(ae.initiator_principal_id).bind(ae.actor_principal_id)
            .bind(&ae.action_key).bind(ae.action_version).bind(ae.target_id).bind(&ae.parameter_hash)
            .bind(outcome).bind(token).bind(reason.as_ref().map(wire))
            .bind(if message_only { "NOT_APPLICABLE" } else { "REQUIRED" }).execute(&mut **tx).await?;
        let source = ae
            .parameters
            .as_ref()
            .filter(|p| {
                p.get("sourceKind")
                    .and_then(Value::as_str)
                    .is_none_or(|kind| kind == "BUZZ_EVENT")
            })
            .and_then(|p| p.get("sourceEventId"))
            .and_then(Value::as_str)
            .into_iter()
            .map(|id| Evidence::new(EvidenceKind::BuzzEventId, id))
            .collect();
        let abandoned = reason == Some(ReasonCode::AdmissionAbandoned);
        let stage = if abandoned {
            "automation-expired"
        } else if outcome == "NOT_APPLICABLE" {
            "automation-admission-unknown"
        } else if phase == "ADMISSION" {
            "admission"
        } else {
            "automation-recheck"
        };
        audit(
            tx,
            ae,
            def,
            stage,
            "DECISION",
            if outcome == "NOT_APPLICABLE" {
                "NONE"
            } else {
                outcome
            },
            reason.as_ref().map(wire).as_deref().unwrap_or("NONE"),
            None,
            source,
        )
        .await?;
        if phase == "ADMISSION" {
            sqlx::query("update admission.action_execution set gate_state=$2,reason_code=$3,updated_at=now()
                where id=$1 and gate_state='EVALUATING'")
                .bind(ae.id).bind(if abandoned { "EXPIRED" } else { match outcome { "ALLOW"=>"ALLOWED","DENY"=>"DENIED",_=>"EVALUATING" } })
                .bind(reason.as_ref().map(wire)).execute(&mut **tx).await?;
        }
        Ok(())
    }

    /// Workspace 创建入口的一次性可用性提示；提交时仍由 submit 重新准入。
    /// 新 Workspace 尚不存在，权限对象只能是当前 Tenant 的 create，不能以
    /// tenant manage 代替，否则只持 creator 关系的人会被错误隐藏。
    pub async fn available_workspace_create_action(
        &self,
        actor: Actor,
    ) -> Result<Option<contracts::CreateActionKey>, Refusal> {
        const KEY: &str = "workspace.create";
        if !crate::capability_registry::action_exposed(KEY) {
            return Ok(None);
        }
        let Some(def) = active_definition(&self.pool, KEY).await? else {
            return Ok(None);
        };
        if def.target_type != "WORKSPACE"
            || def.tenant_rule != "SESSION_TENANT"
            || def.workspace_rule != "TENANT_ONLY"
            || def.permission_object_type != "tenant"
            || def.permission != "create"
            || def.execution_mode != "TEMPORAL"
            || def.workflow_kind.as_deref() != Some("WORKSPACE_LIFECYCLE")
        {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        let target = Target {
            id: actor.tenant_id,
            version: 0,
            workspace_id: None,
        };
        Ok(self
            .evaluate(actor, &def, &target)
            .await?
            .allowed
            .then_some(contracts::CreateActionKey::WorkspaceCreate))
    }

    /// Workspace 暂停/恢复入口的一次性可用性提示；不是授权票据，提交时仍由
    /// submit 重新准入。两个动作都在所属 Tenant 上检查 manage（从 Tenant scope
    /// 发起，`.design/03` §2），因此每页各判定一次，再由各 Workspace 的当前状态
    /// 决定给出哪一个（`WorkspaceLifecycleOffer::for_state`）。
    pub async fn available_workspace_lifecycle_actions(
        &self,
        actor: Actor,
    ) -> Result<WorkspaceLifecycleOffer, Refusal> {
        let mut offer = WorkspaceLifecycleOffer::default();
        for sem in [Semantic::WorkspaceSuspend, Semantic::WorkspaceRestore] {
            let key = match sem {
                Semantic::WorkspaceSuspend => "workspace.suspend",
                _ => "workspace.restore",
            };
            if !crate::capability_registry::action_exposed(key) {
                continue;
            }
            let Some(def) = active_definition(&self.pool, key).await? else {
                continue;
            };
            if def.target_type != "WORKSPACE"
                || def.tenant_rule != "SESSION_TENANT"
                || def.workspace_rule != "TENANT_ONLY"
                || def.permission_object_type != "tenant"
                || def.permission != "manage"
                || def.execution_mode != "TEMPORAL"
                || def.workflow_kind.as_deref() != Some("WORKSPACE_LIFECYCLE")
            {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            let target = Target {
                id: actor.tenant_id,
                version: 0,
                workspace_id: None,
            };
            let allowed = self.evaluate(actor, &def, &target).await?.allowed;
            match sem {
                Semantic::WorkspaceSuspend => offer.suspend = allowed,
                _ => offer.restore = allowed,
            }
        }
        Ok(offer)
    }

    /// 业务 Tenant 暂停/恢复入口的一次性可用性提示（DD-96）：目录开放、定义形状与
    /// Catalog Tenant 上的 fresh `manage`。调用方须先确认会话属于 Catalog。
    pub async fn available_tenant_lifecycle_actions(
        &self,
        actor: Actor,
    ) -> Result<TenantLifecycleOffer, Refusal> {
        let mut offer = TenantLifecycleOffer::default();
        for (key, suspend) in [("tenant.suspend", true), ("tenant.restore", false)] {
            if !crate::capability_registry::action_exposed(key) {
                continue;
            }
            let Some(def) = active_definition(&self.pool, key).await? else {
                continue;
            };
            if def.target_type != "TENANT"
                || def.tenant_rule != "SESSION_TENANT"
                || def.workspace_rule != "TENANT_ONLY"
                || def.permission_object_type != "tenant"
                || def.permission != "manage"
                || def.confirmation_mode != "EXPLICIT"
                || def.execution_mode != "TEMPORAL"
                || def.workflow_kind.as_deref() != Some("TENANT_LIFECYCLE")
            {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
            }
            let target = Target {
                id: actor.tenant_id,
                version: 0,
                workspace_id: None,
            };
            let allowed = self.evaluate(actor, &def, &target).await?.allowed;
            if suspend {
                offer.suspend = allowed;
            } else {
                offer.restore = allowed;
            }
        }
        Ok(offer)
    }

    /// 任务详情的一次性可用性投影；不是授权票据。按钮仅在这里取得 active
    /// 控制定义、本人 scope、fresh Check 与 Temporal OPEN 事实时显示，提交/派发
    /// 仍重复所有检查（DD-84）。列表不为每行发起外部 Describe。
    pub async fn available_cancel_action(
        &self,
        actor: Actor,
        original_id: Uuid,
    ) -> Result<Option<String>, Refusal> {
        let Some(original) = load_execution(&self.pool, original_id).await? else {
            return Ok(None);
        };
        if original.tenant_id != actor.tenant_id
            || original.initiator_principal_id != actor.principal_id
        {
            return Ok(None);
        }
        let key = cancel_key_for(&original);
        let Some(def) = active_definition(&self.pool, &key).await? else {
            return Ok(None);
        };
        let existing: Option<i32> = sqlx::query_scalar(
            "select 1 from admission.action_execution
             where tenant_id = $1 and target_id = $2 and action_key = $3
               and gate_state in ('EVALUATING','WAITING','ALLOWED')
               and dispatch_state <> 'ABORTED' limit 1",
        )
        .bind(actor.tenant_id)
        .bind(original_id)
        .bind(&key)
        .fetch_optional(&self.pool)
        .await?;
        if existing.is_some() {
            return Ok(None);
        }
        let params = Params {
            workspace_visibility: None,
            workspace_channel: None,
            conversation_open: None,
            workspace_id: None,
            tenant_id: None,
            principal_id: None,
            slug: None,
            name: None,
            invitation_id: None,
            original_action_execution_id: Some(original_id),
            explicit_confirmation: None,
            resource_id: None,
            resource_version: None,
            receiver_resource: None,
            asset_id: None,
            asset_version: None,
            agent_version_content: None,
            delegation_id: None,
            delegation_version: None,
            delegation_grant: None,
            automation_version_content: None,
            executor_installation_resource_id: None,
            llm_route_create: None,
            capability_contract_registration: None,
            capability_contract_ref: None,
            component_release_registration: None,
            component_release_id: None,
            application_binding_create: None,
            application_binding_id: None,
            application_binding_version: None,
            resource_create: None,
        };
        let mut conn = self.pool.acquire().await?;
        let target = match resolve_target(
            &mut conn,
            actor.tenant_id,
            actor.principal_id,
            &def,
            Semantic::TaskCancel,
            &params,
            None,
            false,
        )
        .await
        {
            Ok(target) => target,
            Err(_) => return Ok(None),
        };
        drop(conn);
        if !self.evaluate(actor, &def, &target).await?.allowed {
            return Ok(None);
        }
        let mut conn = self.pool.acquire().await?;
        match self
            .cancel_target(
                &mut conn,
                actor.tenant_id,
                actor.principal_id,
                &def,
                &params,
            )
            .await
        {
            Ok(_) => Ok(Some(key)),
            Err(_) => Ok(None),
        }
    }

    /// 任务详情只在本人的原执行具有一致的 Temporal 关闭事实、终态投影、
    /// 未推进的目标版本与独立控制定义时提供重跑入口。提交及派发均重新核验。
    pub async fn available_rerun_action(
        &self,
        actor: Actor,
        original_id: Uuid,
    ) -> Result<Option<String>, Refusal> {
        let Some(original) = load_execution(&self.pool, original_id).await? else {
            return Ok(None);
        };
        if original.tenant_id != actor.tenant_id
            || original.initiator_principal_id != actor.principal_id
            || original.gate_state != "ALLOWED"
        {
            return Ok(None);
        }
        let key = rerun_key_for(&original);
        let Some(def) = active_definition(&self.pool, &key).await? else {
            return Ok(None);
        };
        let existing: Option<i32> = sqlx::query_scalar(
            "select 1 from admission.action_execution
             where tenant_id = $1 and target_id = $2 and action_key = $3
               and gate_state in ('EVALUATING','WAITING','ALLOWED')
               and dispatch_state <> 'ABORTED' limit 1",
        )
        .bind(actor.tenant_id)
        .bind(original_id)
        .bind(&key)
        .fetch_optional(&self.pool)
        .await?;
        if existing.is_some() {
            return Ok(None);
        }
        let params = Params {
            workspace_visibility: None,
            workspace_channel: None,
            conversation_open: None,
            workspace_id: None,
            tenant_id: None,
            principal_id: None,
            slug: None,
            name: None,
            invitation_id: None,
            original_action_execution_id: Some(original_id),
            explicit_confirmation: None,
            resource_id: None,
            resource_version: None,
            asset_id: None,
            receiver_resource: None,
            asset_version: None,
            agent_version_content: None,
            delegation_id: None,
            delegation_version: None,
            delegation_grant: None,
            automation_version_content: None,
            executor_installation_resource_id: None,
            llm_route_create: None,
            capability_contract_registration: None,
            capability_contract_ref: None,
            component_release_registration: None,
            component_release_id: None,
            application_binding_create: None,
            application_binding_id: None,
            application_binding_version: None,
            resource_create: None,
        };
        let mut conn = self.pool.acquire().await?;
        let target = match resolve_target(
            &mut conn,
            actor.tenant_id,
            actor.principal_id,
            &def,
            Semantic::TaskRerun,
            &params,
            None,
            false,
        )
        .await
        {
            Ok(target) => target,
            Err(_) => return Ok(None),
        };
        drop(conn);
        if !self.evaluate(actor, &def, &target).await?.allowed {
            return Ok(None);
        }
        let mut conn = self.pool.acquire().await?;
        match self
            .rerun_target(
                &mut conn,
                actor.tenant_id,
                actor.principal_id,
                &def,
                &params,
            )
            .await
        {
            Ok(_) => Ok(Some(key)),
            Err(_) => Ok(None),
        }
    }
}

// ---------------------------------------------------------------------------
// ActionExecution
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Execution {
    pub id: Uuid,
    pub operation_id: Uuid,
    pub tenant_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub action_key: String,
    pub action_version: i32,
    pub initiator_principal_id: Uuid,
    pub actor_principal_id: Uuid,
    pub target_id: Uuid,
    pub parameter_hash: String,
    pub parameters: Option<Value>,
    pub temporal_workflow_id: Option<String>,
    pub cancel_first_run_id: Option<String>,
    pub approval_workflow_id: Option<String>,
    pub approval_expires_at: Option<DateTime<Utc>>,
    pub gate_state: String,
    pub dispatch_state: String,
    pub reason_code: Option<String>,
    pub correlation_id: Uuid,
    pub updated_at: DateTime<Utc>,
}

pub const EXECUTION_COLUMNS: &str =
    "id, operation_id, tenant_id, workspace_id, action_key, action_version,
     initiator_principal_id, actor_principal_id, target_id, parameter_hash, parameters,
     temporal_workflow_id, cancel_first_run_id, approval_workflow_id, approval_expires_at, gate_state, dispatch_state,
     reason_code, correlation_id, updated_at";

impl Execution {
    fn params(&self) -> Option<Params> {
        self.parameters
            .as_ref()
            .and_then(|v| v.get("params"))
            .and_then(Params::from_json)
    }

    pub(crate) fn frozen_target_version(&self) -> Option<i32> {
        self.parameters
            .as_ref()
            .and_then(|v| v.get("targetVersion"))
            .and_then(Value::as_i64)
            .and_then(|n| i32::try_from(n).ok())
    }

    pub fn submission(&self) -> ActionSubmission {
        ActionSubmission {
            operation_id: self.operation_id.to_string(),
            action_execution_id: self.id.to_string(),
            action_key: self.action_key.clone(),
            gate_state: parse(&self.gate_state).unwrap_or(ActionGateState::Evaluating),
            dispatch_state: parse(&self.dispatch_state)
                .unwrap_or(ActionDispatchState::NotDispatched),
            reason: self.reason_code.as_deref().and_then(parse),
            approval_workflow_id: self.approval_workflow_id.clone(),
            workflow_id: self.temporal_workflow_id.clone(),
            // 凭据不从库里来：只在签发的那一次回应里由 decide 填入
            invitation: None,
            protocol_session_id: None,
            document_launch: None,
        }
    }
}

pub async fn load_execution(pool: &PgPool, id: Uuid) -> Result<Option<Execution>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {EXECUTION_COLUMNS} from admission.action_execution where id = $1"
    ))
    .bind(id)
    .fetch_optional(pool)
    .await
}

pub(crate) async fn lock_execution(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<Execution, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {EXECUTION_COLUMNS} from admission.action_execution where id = $1 for update"
    ))
    .bind(id)
    .fetch_one(&mut **tx)
    .await
}

/// 在调用方事务里打开一条 EVALUATING 的 ActionExecution，并写 INTENT 审计：意图
/// 先于判定持久化，之后任何一步崩溃，这个 operation 都有迹可查。BFF 语义命令与
/// 兑换发起的开通（DD-83）共用这一处，二者的差别只在 correlation：`None` 取本
/// operation 自己，兑换取签发邀请的那个 operation，使一条邀请的全程可按一个 ID 查出。
pub(crate) async fn open_execution(
    tx: &mut Transaction<'_, Postgres>,
    actor: Actor,
    def: &Definition,
    target: &Target,
    params: &Params,
    idempotency_key: Uuid,
    correlation_id: Option<Uuid>,
) -> Result<Execution, sqlx::Error> {
    let hash = parameter_hash(def, target.id, params);
    let parameters = json!({ "params": params.to_json(), "targetVersion": target.version });
    open_execution_values(
        tx,
        actor,
        actor.principal_id,
        def,
        target,
        parameters,
        hash,
        idempotency_key,
        correlation_id,
    )
    .await
}

/// 触发的 initiator 仍是 HUMAN owner，actor 必须在 INTENT 前就是实际 Installation Agent。
#[allow(clippy::too_many_arguments)]
pub(crate) async fn open_automation_execution(
    tx: &mut Transaction<'_, Postgres>,
    actor: Actor,
    agent: Uuid,
    def: &Definition,
    target: &Target,
    parameters: Value,
    idempotency_key: Uuid,
) -> Result<Execution, sqlx::Error> {
    let hash = collab_bridge::limits::canonical_digest(&json!({
        "actionKey":def.action_key,"actionVersion":def.version,"targetId":target.id,
        "parameters":parameters
    }));
    open_execution_values(
        tx,
        actor,
        agent,
        def,
        target,
        parameters,
        hash,
        idempotency_key,
        None,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn open_execution_values(
    tx: &mut Transaction<'_, Postgres>,
    actor: Actor,
    acting_principal: Uuid,
    def: &Definition,
    target: &Target,
    parameters: Value,
    hash: String,
    idempotency_key: Uuid,
    correlation_id: Option<Uuid>,
) -> Result<Execution, sqlx::Error> {
    open_execution_in_operation(
        tx,
        actor,
        acting_principal,
        def,
        target,
        parameters,
        hash,
        idempotency_key,
        correlation_id,
        None,
        None,
    )
    .await
}

/// DD-105: a governed Tool call is a child Action, never a second Operation.
/// Only the admitted root Invocation can supply scope/actor/correlation.
pub(crate) async fn open_memory_child(
    tx: &mut Transaction<'_, Postgres>,
    parent: &Execution,
    def: &Definition,
    target: &Target,
    parameters: Value,
    idempotency_key: Uuid,
) -> Result<Execution, Refusal> {
    let root: bool = sqlx::query_scalar(
        "select parent_action_execution_id is null
        from admission.action_execution where id=$1 for update",
    )
    .bind(parent.id)
    .fetch_one(&mut **tx)
    .await?;
    if !root
        || parent.gate_state != "ALLOWED"
        || parent.dispatch_state != "DISPATCHED"
        || !matches!(
            parent.action_key.as_str(),
            "agent.invoke" | "automation.run"
        )
        || !matches!(
            def.action_key.as_str(),
            "agent.memory.entry.list" | "agent.memory.entry.read"
        )
        || parent.workspace_id.is_none()
        || target.workspace_id != parent.workspace_id
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let hash = collab_bridge::limits::canonical_digest(&json!({"actionKey":def.action_key,
        "actionVersion":def.version,"targetId":target.id,"parameters":parameters}));
    Ok(open_execution_in_operation(
        tx,
        Actor {
            tenant_id: parent.tenant_id,
            principal_id: parent.initiator_principal_id,
            human_identity_id: None,
        },
        parent.actor_principal_id,
        def,
        target,
        parameters,
        hash,
        idempotency_key,
        Some(parent.correlation_id),
        Some((parent.id, parent.operation_id)),
        None,
    )
    .await?)
}

/// The same root factory freezes an APPLICATION protocol's exact declaration
/// on its first INSERT. It does not backfill identity after admission.
pub(crate) async fn open_protocol_execution(
    tx: &mut Transaction<'_, Postgres>,
    actor: Actor,
    application: &(Uuid, i64, crate::application_catalog::ApplicationDefinition),
    target: &Target,
    parameters: Value,
    hash: String,
    idempotency_key: Uuid,
) -> Result<Execution, sqlx::Error> {
    let (binding, generation, application) = application;
    open_execution_in_operation(
        tx,
        actor,
        actor.principal_id,
        &application.definition,
        target,
        parameters,
        hash,
        idempotency_key,
        None,
        None,
        Some((
            application.definition_id,
            *binding,
            application.component_release_id,
            *generation,
        )),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn open_execution_in_operation(
    tx: &mut Transaction<'_, Postgres>,
    actor: Actor,
    acting_principal: Uuid,
    def: &Definition,
    target: &Target,
    parameters: Value,
    hash: String,
    idempotency_key: Uuid,
    correlation_id: Option<Uuid>,
    parent: Option<(Uuid, Uuid)>,
    application: Option<(Uuid, Uuid, Uuid, i64)>,
) -> Result<Execution, sqlx::Error> {
    let ae_id = Uuid::new_v4();
    let operation_id = parent
        .map(|(_, operation)| operation)
        .unwrap_or_else(Uuid::new_v4);
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, workspace_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              parameters, idempotency_key, gate_state, dispatch_state, correlation_id,
              parent_action_execution_id,action_definition_id,component_binding_kind,
              component_binding_id,component_release_id,component_projection_generation)
         values ($1,$2,$3,$4,$5,$6,$7,$13,$8,$9,$10,$11,'EVALUATING','NOT_DISPATCHED',$12,$14,
             $15,$16,$17,$18,$19)",
    )
    .bind(ae_id)
    .bind(operation_id)
    .bind(actor.tenant_id)
    .bind(target.workspace_id)
    .bind(&def.action_key)
    .bind(def.version)
    .bind(actor.principal_id)
    .bind(target.id)
    .bind(&hash)
    .bind(&parameters)
    .bind(idempotency_key)
    .bind(correlation_id.unwrap_or(operation_id))
    .bind(acting_principal)
    .bind(parent.map(|(id, _)| id))
    .bind(application.map(|(id, _, _, _)| id))
    .bind(application.map(|_| "APPLICATION"))
    .bind(application.map(|(_, binding, _, _)| binding))
    .bind(application.map(|(_, _, release, _)| release))
    .bind(application.map(|(_, _, _, generation)| generation))
    .execute(&mut **tx)
    .await?;
    let ae = lock_execution(tx, ae_id).await?;
    audit(
        tx,
        &ae,
        def,
        "intent",
        "INTENT",
        "NONE",
        "EVALUATING",
        actor.human_identity_id,
        Vec::new(),
    )
    .await?;
    Ok(ae)
}

/// 审计事实。event_key 按 operation 与阶段稳定：重试不写第二条（.design/03 §8）。
#[allow(clippy::too_many_arguments)]
pub(crate) async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    stage: &str,
    event_type: &str,
    decision: &str,
    result_code: &str,
    human: Option<Uuid>,
    evidence: Vec<Evidence>,
) -> Result<(), sqlx::Error> {
    audit_as(
        tx,
        ae,
        def.audit_class(),
        stage,
        event_type,
        decision,
        result_code,
        human,
        evidence,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn audit_as(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    class: AuditClass<'_>,
    stage: &str,
    event_type: &str,
    decision: &str,
    result_code: &str,
    human: Option<Uuid>,
    evidence: Vec<Evidence>,
) -> Result<(), sqlx::Error> {
    let child: bool = sqlx::query_scalar(
        "select parent_action_execution_id is not null
        from admission.action_execution where id=$1",
    )
    .bind(ae.id)
    .fetch_one(&mut **tx)
    .await?;
    append(
        tx,
        AuditEntry {
            event_key: if child {
                format!("{}:child:{}:{stage}", ae.operation_id, ae.id)
            } else {
                format!("{}:{stage}", ae.operation_id)
            },
            tenant_id: Some(ae.tenant_id),
            // Workspace 与 ActionDefinition 的 WorkspaceRule 解析结果一致（.design/03 §8）
            workspace_id: ae.workspace_id,
            operation_id: ae.operation_id,
            event_type,
            human_identity_id: human,
            initiator_principal_id: Some(ae.initiator_principal_id),
            actor_principal_id: Some(ae.actor_principal_id),
            action_key: &ae.action_key,
            action_version: ae.action_version,
            component_type_key: class.component_type_key,
            target_type: Some(class.target_type),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision,
            result_code,
            result_exposure: class.result_exposure,
            evidence_refs: evidence,
            correlation_id: ae.correlation_id,
        },
    )
    .await
}

/// 一次启动（或同步写入）之后 ActionExecution 的派发结论（`.design/06` §3.1、
/// `apps/06` §4）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Dispatch {
    /// 已派发：本次启动被确认，或 WorkflowRef 已有执行证据
    Dispatched,
    /// 结果不明（启动回 503）：只能以同一 workflow ID 收敛，不得渲染为成功或失败
    Unknown,
    /// 确定的拒绝：本次派发中止
    Aborted,
}

impl Dispatch {
    /// `executed` 是持久证据：业务 WorkflowRef 已有 run ID 或已 RUNNING/TERMINAL。
    /// 它优先于本次回应——同 ID 的执行已经发生过，重试撞上的 409/503 不改变这一点。
    fn of(started: Result<(), StatusCode>, executed: bool) -> Self {
        match started {
            _ if executed => Self::Dispatched,
            Ok(()) => Self::Dispatched,
            Err(StatusCode::SERVICE_UNAVAILABLE) => Self::Unknown,
            Err(_) => Self::Aborted,
        }
    }

    /// (dispatch_state, 审计阶段, 审计 result_code, reason_code)
    fn facts(self) -> (&'static str, &'static str, &'static str, Option<ReasonCode>) {
        match self {
            Self::Dispatched => ("DISPATCHED", "dispatch", "DISPATCHED", None),
            Self::Unknown => (
                "UNKNOWN",
                "dispatch-unknown",
                "DISPATCH_RESULT_UNKNOWN",
                Some(ReasonCode::ExternalResultUnknown),
            ),
            Self::Aborted => (
                "ABORTED",
                "dispatch-aborted",
                "DISPATCH_ABORTED",
                Some(ReasonCode::TargetStateConflict),
            ),
        }
    }
}

/// [`record_dispatch`] 的结论。`settled` 为真表示本次调用推进了 dispatch_state
/// 并追加了 DISPATCH 审计；为假表示该行已不在 NOT_DISPATCHED/UNKNOWN（或不是
/// ALLOWED），什么都没写。
#[derive(Debug, Clone, Copy)]
pub(crate) struct Recorded {
    pub outcome: Dispatch,
    pub settled: bool,
}

/// 按启动结果记录派发结果：写 `dispatch_state` 并追加 DISPATCH 审计。生命周期
/// Workflow 的治理派发、部署引导、托管身份与各直接启动入口都经这里，「结果不明
/// 映射 UNKNOWN、确定冲突映射 ABORTED」只有一份实现。控制动作（取消、重跑）与
/// 同步角色动作的派发有各自的收敛规则（冻结意图、原任务的 history），不经这里。
///
/// 只推进 ALLOWED 且仍为 NOT_DISPATCHED/UNKNOWN 的行；与审计同在调用方事务里，
/// 更新与审计要么都成立要么都不成立。审计 event_key 按 operation 与阶段稳定，
/// UNKNOWN 的重试不写第二条。evidence 以该动作的 workflow ID 打头，其后是调用方的
/// 附加证据。
pub(crate) async fn record_dispatch(
    tx: &mut Transaction<'_, Postgres>,
    action_execution_id: Uuid,
    class: AuditClass<'_>,
    started: Result<(), StatusCode>,
    extra_evidence: Vec<Evidence>,
) -> Result<Recorded, sqlx::Error> {
    let row: Option<(Option<String>, bool)> = sqlx::query_as(
        "select coalesce(ae.temporal_workflow_id,
                         (select w.workflow_id from projection.workflow_ref w
                          where w.action_execution_id = ae.id and w.workflow_type = d.workflow_type
                            and w.kind is not distinct from d.workflow_kind
                            and w.tenant_id=ae.tenant_id and w.workspace_id is not distinct from ae.workspace_id
                            and w.operation_id=ae.operation_id)),
                exists (select 1 from projection.workflow_ref w
                        where w.workflow_type = d.workflow_type and w.kind is not distinct from d.workflow_kind
                          and w.action_execution_id = ae.id
                          and (ae.temporal_workflow_id is null or w.workflow_id = ae.temporal_workflow_id)
                          and w.tenant_id=ae.tenant_id and w.workspace_id is not distinct from ae.workspace_id
                          and w.operation_id=ae.operation_id
                          and (w.run_id is not null
                               or w.projection_state in ('RUNNING', 'TERMINAL')))
         from admission.action_execution ae join catalog.action_definition d
           on d.action_key=ae.action_key and d.version=ae.action_version
           and ((d.id=ae.action_definition_id and d.component_release_id is not distinct from ae.component_release_id)
                or (ae.action_definition_id is null and ae.component_binding_kind is null and d.component_release_id is null))
         where ae.id = $1 for update of ae",
    )
    .bind(action_execution_id)
    .fetch_optional(&mut **tx)
    .await?;
    let (workflow_id, executed) = row.unwrap_or((None, false));
    let outcome = Dispatch::of(started, executed);
    let (state, stage, result, reason) = outcome.facts();
    let updated: Option<Execution> = sqlx::query_as(&format!(
        "update admission.action_execution
         set dispatch_state = $2, reason_code = $3, updated_at = now()
         where id = $1 and gate_state = 'ALLOWED'
           and dispatch_state in ('NOT_DISPATCHED', 'UNKNOWN')
         returning {EXECUTION_COLUMNS}"
    ))
    .bind(action_execution_id)
    .bind(state)
    .bind(reason.as_ref().map(wire))
    .fetch_optional(&mut **tx)
    .await?;
    let Some(ae) = updated else {
        return Ok(Recorded {
            outcome,
            settled: false,
        });
    };
    let evidence = workflow_id
        .into_iter()
        .map(|w| Evidence::new(EvidenceKind::TemporalWorkflowId, w))
        .chain(extra_evidence)
        .collect();
    audit_as(
        tx, &ae, class, stage, "DISPATCH", "ALLOW", result, None, evidence,
    )
    .await?;
    Ok(Recorded {
        outcome,
        settled: true,
    })
}

/// 不经治理派发的直接启动入口（设备公钥、托管身份撤销、service API 的生命周期
/// 与重跑入口）的外壳：把本次启动的回应记为派发结果，然后原样交回回应。
///
/// 只记已进入启动的 ActionExecution——它已有归属自己的业务 WorkflowRef。没有时，
/// 回应是入口在启动之前的拒绝（未准入、目标不符、实体不在可启动状态），不是
/// 派发结果；拿一张不属于这次请求的准入来的错配请求，也就不能把它中止。
/// 记录本身失败回 503：客户端以同一 ID 重试收敛，重试会再记一次。
pub(crate) async fn record_direct_launch(
    pool: &PgPool,
    action_execution_id: Uuid,
    class: AuditClass<'_>,
    response: Response,
) -> Response {
    let status = response.status();
    let started = if status.is_success() {
        Ok(())
    } else {
        Err(status)
    };
    let recorded = async {
        if component_task::workflow_of_action(pool, action_execution_id)
            .await?
            .is_none()
        {
            return Ok(());
        }
        let mut tx = pool.begin().await?;
        record_dispatch(&mut tx, action_execution_id, class, started, Vec::new()).await?;
        tx.commit().await
    };
    match recorded.await {
        Ok(()) => response,
        Err(e) => {
            tracing::warn!(action = %action_execution_id, error = %e, "记录派发结果失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn record_decision(
    tx: &mut Transaction<'_, Postgres>,
    ae: &DecisionSubject<'_>,
    phase: &str,
    scope: &str,
    authorization: &str,
    approval: &str,
    quota: &str,
    zed_token: Option<&str>,
    reason: Option<&ReasonCode>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "insert into admission.action_decision
             (id, operation_id, action_execution_id, phase, tenant_id, workspace_id,
              authenticated_principal_id, acting_principal_id, action_key, action_version,
              target_id, parameter_hash, scope_decision, authorization_decision,
              delegation_decision, approval_decision, capacity_decision, quota_decision,
              audit_decision, zed_token, reason_code)
         values ($1,$2,$3,$4,$5,$6,$7,
                 (select actor_principal_id from admission.action_execution where id=$3),$8,$9,$10,$11,$12,$13,
                 case when (select parent_action_execution_id is not null from admission.action_execution where id=$3)
                   then 'ALLOW' else 'NOT_APPLICABLE' end,$14,'NOT_APPLICABLE',$15,'RECORDED',$16,$17)",
    )
    .bind(Uuid::new_v4())
    .bind(ae.operation_id)
    .bind(ae.action_execution_id)
    .bind(phase)
    .bind(ae.tenant_id)
    .bind(ae.workspace_id)
    .bind(ae.principal_id)
    .bind(ae.action_key)
    .bind(ae.action_version)
    .bind(ae.target_id)
    .bind(ae.parameter_hash)
    .bind(scope)
    .bind(authorization)
    .bind(approval)
    .bind(quota)
    .bind(zed_token)
    .bind(reason.map(wire))
    .execute(&mut **tx)
    .await
    .map(|_| ())
}

/// 一条 ActionDecision 记在谁名下。治理链自己的动作取自 ActionExecution；自有路径
/// 的动作（设备公钥）由其模块给出同样的字段。
pub struct DecisionSubject<'a> {
    pub action_execution_id: Uuid,
    pub operation_id: Uuid,
    pub tenant_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub principal_id: Uuid,
    pub action_key: &'a str,
    pub action_version: i32,
    pub target_id: Uuid,
    pub parameter_hash: &'a str,
}

impl Execution {
    pub(crate) fn subject(&self) -> DecisionSubject<'_> {
        DecisionSubject {
            action_execution_id: self.id,
            operation_id: self.operation_id,
            tenant_id: self.tenant_id,
            workspace_id: self.workspace_id,
            principal_id: self.initiator_principal_id,
            action_key: &self.action_key,
            action_version: self.action_version,
            target_id: self.target_id,
            parameter_hash: &self.parameter_hash,
        }
    }
}

pub(crate) fn approval_workflow_id(tenant: Uuid, action_execution_id: Uuid) -> String {
    component_task::workflow_id(
        APPROVAL_ID_SEGMENT,
        tenant,
        &action_execution_id.to_string(),
        1,
    )
}

// ---------------------------------------------------------------------------
// 提交
// ---------------------------------------------------------------------------

/// Resource/Asset owner/version 与 Buzz、OpenMeter 定位在同一准入事务完整冻结。
/// ApplicationBinding 尚无生产者，正式数组保持无适用对象。
pub(crate) async fn frozen_delete_inventory(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    version: i32,
) -> Result<Value, Refusal> {
    let binding: Option<(Uuid, String, Uuid, String, i32)> = sqlx::query_as(
        "select b.community_id,b.normalized_host,b.control_service_principal_id,i.pubkey,b.version
         from projection.tenant_buzz_binding b
         join identity.buzz_identity_binding i on i.tenant_id = b.tenant_id
           and i.principal_id = b.control_service_principal_id and i.kind = 'CONTROL'
         where b.tenant_id = $1 and b.state = 'ACTIVE' and i.state = 'ACTIVE'
           and b.require_relay_membership and not b.allow_nip_oa_auth
         for update of b,i",
    )
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((
        community_id,
        normalized_host,
        control_service_principal_id,
        control_pubkey,
        binding_version,
    )) = binding
    else {
        return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
    };
    // DD-99：新增平台存储面与同构建的销毁处理器共同进入冻结清单。
    let metering: Option<(String, String, String, String, i32)> = sqlx::query_as(
        "select namespace,customer_id,subject_key_prefix,status,version
         from projection.openmeter_binding where tenant_id = $1 for update",
    )
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?;
    let openmeter_binding = match metering {
        Some((namespace, customer_id, subject_key_prefix, status, binding_version)) => {
            if status != "ACTIVE" {
                return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
            }
            json!({"tenant_id":tenant,"namespace":namespace,"customer_id":customer_id,
                "subject_key_prefix":subject_key_prefix,"status":status,"version":binding_version})
        }
        // 没有引用不等于 native 不存在：POST 成功而本地提交未知时也没有 binding。
        // DD-38 的 Tenant Customer 映射未成立，不允许把空表当作无适用对象。
        None => return Err(Refusal::Precondition(ReasonCode::TargetStateConflict)),
    };
    let owners: Vec<contracts::AffectedOwnerRef> =
        serde_json::from_value(crate::agent_definition::frozen_owners(conn, tenant).await?)
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
    let mut resources = Vec::new();
    let mut assets = Vec::new();
    for owner in owners {
        match owner.target_type.as_str() {
            "RESOURCE" => resources.push(owner),
            "ASSET" => assets.push(owner),
            _ => return Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
        }
    }
    Ok(json!({
        "tenant_id": tenant, "tenant_version": version,
        "tenant_buzz_binding": {
            "community_id": community_id, "normalized_host": normalized_host,
            "control_service_principal_id": control_service_principal_id,
            "control_pubkey": control_pubkey, "version": binding_version
        },
        "openmeter_binding": openmeter_binding,
        "resource_owner_versions": resources, "asset_owner_versions": assets,
        "agent_inventory": crate::tenant_delete::frozen_agent_inventory(conn, tenant).await?,
        "component_binding_refs_and_versions": []
    }))
}

impl Governance {
    /// BFF 语义命令的入口。成功时回 ActionSubmission；拒绝已写入 ActionExecution
    /// 与审计的，回应体带 operation ID。
    pub async fn submit(
        &self,
        actor: Actor,
        cmd: &contracts::ActionCommand,
    ) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
        if cmd.memory_write.is_some() || cmd.protocol_session_open.is_some() {
            return Err((Refusal::Precondition(ReasonCode::InvalidParameters), None));
        }
        // Catalog 中仍 ACTIVE 的旧定义也不能绕开发布 exposure。目录缺失或为
        // none/internal 时先阻断，不解析参数、target 或幂等键。
        if !crate::capability_registry::action_exposed(&cmd.action_key) {
            return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), None));
        }
        let Ok(idempotency_key) = Uuid::parse_str(&cmd.idempotency_key) else {
            return Err((Refusal::Precondition(ReasonCode::InvalidParameters), None));
        };
        // 未登记的 action_key（包括 GAP-LCM-01 阻断的 Tenant delete）没有定义可解析：
        // 能力未开放，不是权限不足
        let def = match active_definition(&self.pool, &cmd.action_key).await {
            Ok(Some(d)) => d,
            Ok(None) => return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), None)),
            Err(e) => return Err((e.into(), None)),
        };
        let Some(sem) = Semantic::from_key(&def.action_key) else {
            tracing::error!(action = %def.action_key, "ActionDefinition 已登记但没有对应语义，按阻断处理");
            return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), None));
        };
        if !sem.bff_submittable() {
            return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), None));
        }
        let params = parse_command(sem, cmd).map_err(|r| (r, None))?;

        // 幂等：同一发起者、同一键回答原 operation
        if let Some(existing) = self
            .by_idempotency(actor, idempotency_key)
            .await
            .map_err(|e| (e.into(), None))?
        {
            return self.replay(actor, existing, &cmd.action_key, &params).await;
        }

        let mut conn = self.pool.acquire().await.map_err(|e| (e.into(), None))?;
        let target = resolve_target(
            &mut conn,
            actor.tenant_id,
            actor.principal_id,
            &def,
            sem,
            &params,
            None,
            false,
        )
        .await
        .map_err(|r| (r, None))?;
        drop(conn);

        let mut tx = self.pool.begin().await.map_err(|e| (e.into(), None))?;
        let revoked = if matches!(
            sem,
            Semantic::AgentInstallationExecuteRevoke | Semantic::ResourceRevokeRead
        ) {
            installation_permission::prepare_revoke(self, &mut tx, actor, &params, &def.action_key)
                .await
                .map_err(|e| (e, None))?
        } else {
            Vec::new()
        };
        let inserted = open_execution(
            &mut tx,
            actor,
            &def,
            &target,
            &params,
            idempotency_key,
            None,
        )
        .await;
        if let Err(sqlx::Error::Database(e)) = &inserted {
            if e.is_unique_violation() {
                drop(tx);
                // 并发的同键请求先落了库：回答它
                if e.constraint() == Some("action_execution_idempotency") {
                    if let Ok(Some(existing)) = self.by_idempotency(actor, idempotency_key).await {
                        return self.replay(actor, existing, &cmd.action_key, &params).await;
                    }
                }
                // 同一目标已有在途的准入或审批
                return Err((Refusal::Conflict(ReasonCode::TargetStateConflict), None));
            }
        }
        let ae = inserted.map_err(|e| (e.into(), None))?;
        tx.commit()
            .await
            .map_err(|e| (e.into(), Some(ae.operation_id)))?;

        for old in revoked {
            self.invalidate(old).await;
        }
        self.decide(actor, ae.id, &def, sem, &params).await
    }

    /// 由 Core 自己打开（不经 BFF 语义命令）的一条 EVALUATING ActionExecution 的
    /// 判定。发起者取自 ActionExecution，重复调用只在仍 EVALUATING 时判定一次。
    pub(crate) async fn decide_opened(
        &self,
        ae_id: Uuid,
    ) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
        let ae = load_execution(&self.pool, ae_id)
            .await
            .map_err(|e| (e.into(), None))?
            .ok_or((Refusal::Unavailable("ActionExecution 消失".into()), None))?;
        let op = Some(ae.operation_id);
        if ae.gate_state != "EVALUATING" {
            return submission_result(&ae);
        }
        let def = exact_definition_for_execution(&self.pool, &ae)
            .await
            .map_err(|e| (e.into(), op))?;
        let sem = Semantic::from_key(&def.action_key)
            .ok_or((Refusal::Blocked(ReasonCode::CapabilityBlocked), op))?;
        let params = ae.params().ok_or((
            Refusal::Unavailable("ActionExecution 缺规范化参数".into()),
            op,
        ))?;
        let actor = Actor {
            tenant_id: ae.tenant_id,
            principal_id: ae.initiator_principal_id,
            human_identity_id: None,
        };
        self.decide(actor, ae.id, &def, sem, &params).await
    }

    async fn by_idempotency(
        &self,
        actor: Actor,
        key: Uuid,
    ) -> Result<Option<Execution>, sqlx::Error> {
        sqlx::query_as(&format!(
            "select {EXECUTION_COLUMNS} from admission.action_execution
             where tenant_id = $1 and initiator_principal_id = $2 and idempotency_key = $3"
        ))
        .bind(actor.tenant_id)
        .bind(actor.principal_id)
        .bind(key)
        .fetch_optional(&self.pool)
        .await
    }

    /// 同一幂等键的重发。参数不同即拒绝；相同则回答原 operation，并把停在半路的
    /// 部分（EVALUATING、已允许未派发）以同一 ID 推进——这正是 Start 结果不明时
    /// 客户端重试走到的地方，不产生第二个 workflow ID（DD-48）。
    async fn replay(
        &self,
        actor: Actor,
        existing: Execution,
        key: &str,
        params: &Params,
    ) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
        let op = Some(existing.operation_id);
        if existing.action_key != key || existing.params().as_ref() != Some(params) {
            return Err((Refusal::Conflict(ReasonCode::IdempotencyKeyReused), op));
        }
        match (
            existing.gate_state.as_str(),
            existing.dispatch_state.as_str(),
        ) {
            ("EVALUATING", _) => {
                let def = exact_definition_for_execution(&self.pool, &existing)
                    .await
                    .map_err(|e| (e.into(), op))?;
                let sem = Semantic::from_key(&def.action_key)
                    .ok_or((Refusal::Blocked(ReasonCode::CapabilityBlocked), op))?;
                return self.decide(actor, existing.id, &def, sem, params).await;
            }
            ("ALLOWED", "NOT_DISPATCHED" | "UNKNOWN") => {
                self.dispatch(existing.id).await;
            }
            ("WAITING", _) => {
                // 审批 Start 结果不明时同样以同一 ID 补上
                self.ensure_approval_started(existing.id).await;
            }
            _ => {}
        }
        let ae = load_execution(&self.pool, existing.id)
            .await
            .map_err(|e| (e.into(), op))?
            .ok_or((Refusal::Unavailable("ActionExecution 消失".into()), op))?;
        submission_result(&ae)
    }

    /// 对一条 EVALUATING 的 ActionExecution 做判定并落定门禁。
    async fn decide(
        &self,
        actor: Actor,
        ae_id: Uuid,
        def: &Definition,
        sem: Semantic,
        params: &Params,
    ) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
        let ae = load_execution(&self.pool, ae_id)
            .await
            .map_err(|e| (e.into(), None))?
            .ok_or((Refusal::Unavailable("ActionExecution 消失".into()), None))?;
        let op = Some(ae.operation_id);
        let target = Target {
            id: ae.target_id,
            version: ae.frozen_target_version().unwrap_or(0),
            workspace_id: ae.workspace_id,
        };
        let mut eval = match self.evaluate(actor, def, &target).await {
            Ok(e) => e,
            // SpiceDB/库不可用：不判定，EVALUATING 保持（对账作业以超时收敛，或
            // 客户端以同一幂等键重试）
            Err(r) => return Err((r, op)),
        };

        if !eval.allowed {
            let reason = eval.reason.clone().unwrap_or(ReasonCode::PermissionDenied);
            self.close_gate(
                &ae,
                def,
                "ADMISSION",
                "DENIED",
                &eval,
                &reason,
                actor.human_identity_id,
            )
            .await
            .map_err(|e| (e.into(), op))?;
            return Err((Refusal::from_reason(reason), op));
        }

        // 目标事实的门禁在授权之后判定：无权者先得到 PERMISSION_DENIED，而不是借
        // 这一步探出「谁是最后一位 admin」。审批前也要判定——一个注定不成立的
        // 动作不该去占用审批人。
        let gate = match self.pool.acquire().await {
            Ok(mut conn) => {
                self.target_gate(
                    &mut conn,
                    ae.tenant_id,
                    ae.initiator_principal_id,
                    def,
                    sem,
                    params,
                )
                .await
            }
            Err(e) => Err(e.into()),
        };
        match gate {
            Ok(()) => {}
            Err(
                r @ (Refusal::Conflict(_)
                | Refusal::Precondition(_)
                | Refusal::Denied(_)
                | Refusal::Blocked(_)),
            ) => {
                self.close_gate(
                    &ae,
                    def,
                    "ADMISSION",
                    "DENIED",
                    &eval,
                    &r.reason(),
                    actor.human_identity_id,
                )
                .await
                .map_err(|e| (e.into(), op))?;
                return Err((r, op));
            }
            Err(r) => return Err((r, op)),
        }

        if def.confirmation_mode == "APPROVAL" {
            return self.request_approval(actor, &ae, def, &eval).await;
        }
        // 确认位是本次 ActionExecution 的冻结参数；未持久记录确认的动作不能
        // 仅因目录写了 EXPLICIT 就按 NONE 放行。
        if def.confirmation_mode == "EXPLICIT"
            && !(sem.takes_explicit_confirmation() && params.explicit_confirmation == Some(true))
        {
            return Err((Refusal::Precondition(ReasonCode::InvalidParameters), op));
        }
        if !matches!(def.confirmation_mode.as_str(), "NONE" | "EXPLICIT") {
            return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), op));
        }

        self.check_quota(actor.tenant_id, def, &mut eval)
            .await
            .map_err(|r| (r, op))?;
        if !eval.allowed {
            let reason = eval.reason.clone().unwrap_or(ReasonCode::CapabilityBlocked);
            self.close_gate(
                &ae,
                def,
                "ADMISSION",
                "DENIED",
                &eval,
                &reason,
                actor.human_identity_id,
            )
            .await
            .map_err(|e| (e.into(), op))?;
            return Err((Refusal::from_reason(reason), op));
        }

        let mut tx = self.pool.begin().await.map_err(|e| (e.into(), op))?;
        let ae = lock_execution(&mut tx, ae_id)
            .await
            .map_err(|e| (e.into(), op))?;
        if ae.gate_state != "EVALUATING" {
            drop(tx);
            return submission_result(&ae);
        }
        let issued = match self
            .allow_in_tx(
                &mut tx,
                &ae,
                def,
                sem,
                params,
                "ADMISSION",
                "NOT_REQUIRED",
                &eval,
                actor.human_identity_id,
            )
            .await
        {
            Ok(issued) => issued,
            Err(
                r @ (Refusal::Conflict(_)
                | Refusal::Precondition(_)
                | Refusal::Denied(_)
                | Refusal::Blocked(_)
                | Refusal::Limit(_)),
            ) => {
                drop(tx);
                // 评估与落定之间 target 事实变了：按当时事实拒绝并留痕
                self.close_gate(
                    &ae,
                    def,
                    "ADMISSION",
                    "DENIED",
                    &eval,
                    &r.reason(),
                    actor.human_identity_id,
                )
                .await
                .map_err(|e| (e.into(), op))?;
                return Err((r, op));
            }
            Err(r) => return Err((r, op)),
        };
        tx.commit().await.map_err(|e| (e.into(), op))?;
        self.dispatch(ae_id).await;
        let ae = load_execution(&self.pool, ae_id)
            .await
            .map_err(|e| (e.into(), op))?
            .ok_or((Refusal::Unavailable("ActionExecution 消失".into()), op))?;
        let (status, mut submission) = submission_result(&ae)?;
        // 明文凭据只在这里出现一次：它已随签发同事务落成摘要，之后再无来源
        submission.invitation = issued.map(|i| i.into_contract(&self.cfg.invitation_link_base));
        Ok((status, submission))
    }

    /// 把门禁从 EVALUATING/WAITING 落到一个不再推进的状态，同事务写 ActionDecision
    /// 与审计。
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn close_gate(
        &self,
        ae: &Execution,
        def: &Definition,
        phase: &str,
        gate: &str,
        eval: &Evaluation,
        reason: &ReasonCode,
        human: Option<Uuid>,
    ) -> Result<(), sqlx::Error> {
        let mut tx = self.pool.begin().await?;
        crate::application_catalog::approval::lock_parent_refs(&mut tx, ae.id).await?;
        let updated = sqlx::query(
            "update admission.action_execution
             set gate_state = $2, reason_code = $3, updated_at = now()
             where id = $1 and gate_state in ('EVALUATING', 'WAITING')",
        )
        .bind(ae.id)
        .bind(gate)
        .bind(wire(reason))
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() == 0 {
            return Ok(());
        }
        // 开通不再会派发：兑换建立的 INVITED membership 与门禁同事务终结（DD-83）
        crate::invitation::settle_refused_admission(&mut tx, ae, def, reason).await?;
        let approval = if phase == "RECHECK" {
            "SATISFIED"
        } else {
            "NOT_REQUIRED"
        };
        record_decision(
            &mut tx,
            &ae.subject(),
            phase,
            eval.scope,
            eval.authorization,
            approval,
            eval.quota,
            eval.zed_token.as_deref(),
            Some(reason),
        )
        .await?;
        audit(
            &mut tx,
            ae,
            def,
            &format!("{}:decision", phase.to_lowercase()),
            "DECISION",
            "DENY",
            &wire(reason),
            human,
            zed_evidence(eval.zed_token.as_deref()),
        )
        .await?;
        tx.commit().await
    }

    /// 允许：在同一事务里重新锁定并核对 target、推进实体、预写 WorkflowRef、
    /// 门禁置 ALLOWED、写 ActionDecision 与审计。提交之后崩溃，对账作业以预写的
    /// workflow ID 重新驱动派发。
    #[allow(clippy::too_many_arguments)]
    async fn allow_in_tx(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        ae: &Execution,
        def: &Definition,
        sem: Semantic,
        params: &Params,
        phase: &str,
        approval: &str,
        eval: &Evaluation,
        human: Option<Uuid>,
    ) -> Result<Option<crate::invitation::Issued>, Refusal> {
        // ADR-14：现有执行语义均为 NONE。CHECK 的真实副作用 producer 尚未接入，
        // 原生额度允许也不能开启缺少副作用前重新准入与 usage 闭合的派发链。
        if def.quota_policy != "NONE" || !def.meters.is_empty() {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        // 会改变有效 Tenant admin 的动作先取 Tenant 行锁，其后的判定与写入都在锁内
        // （DD-82）。锁序固定为 ActionExecution → Tenant，与派发一致。
        if sem.serializes_on_tenant() && !crate::roles::lock_tenant(tx, ae.tenant_id).await? {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let target = resolve_target(
            &mut *tx,
            ae.tenant_id,
            ae.initiator_principal_id,
            def,
            sem,
            params,
            Some(ae.target_id),
            true,
        )
        .await?;
        // 事实变化即不成立：target 换了对象或版本（.design/10 §2）
        if target.id != ae.target_id
            || Some(target.version) != ae.frozen_target_version()
            || parameter_hash(def, target.id, params) != ae.parameter_hash
        {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        if sem == Semantic::ResourceCreate
            || sem.is_application_binding()
            || sem.is_installation_permission()
            || sem.is_automation()
            || matches!(
                sem,
                Semantic::AgentDelegationGrant
                    | Semantic::AgentDelegationRevoke
                    | Semantic::LlmRouteCreate
            )
        {
            // Installation target 已锁 Workspace；已有成员行同锁覆盖 fresh check 到
            // 授予/撤销 commit。无行时 Workspace 的 FOR UPDATE 也阻止并发 FK 插入。
            let _: Option<Uuid> = sqlx::query_scalar(
                "select id from identity.workspace_membership
                where workspace_id=$1 and tenant_principal_id=$2 for update",
            )
            .bind(target.workspace_id)
            .bind(ae.initiator_principal_id)
            .fetch_optional(&mut **tx)
            .await?;
        }
        if (matches!(
            sem,
            Semantic::ComponentReleaseRegister | Semantic::ComponentReleaseApprove
        ) || sem == Semantic::ResourceCreate
            || sem == Semantic::WorkspaceJoin
            || sem.is_application_binding()
            || sem.is_installation_permission()
            || sem.is_capability_contract()
            || sem.is_automation()
            || matches!(
                sem,
                Semantic::AgentDefinitionCreate
                    | Semantic::LlmRouteCreate
                    | Semantic::AgentDefinitionUpdate
                    | Semantic::ResourceTransferOwner
                    | Semantic::AgentVersionCreate
                    | Semantic::AgentVersionUpdate
                    | Semantic::AgentVersionPublish
                    | Semantic::AgentVersionRetire
                    | Semantic::AgentInstallationCreate
                    | Semantic::AgentInstallationUpgrade
                    | Semantic::AgentDelegationGrant
                    | Semantic::AgentDelegationRevoke
            ))
            && !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id)
                .await?
        {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let locked_evaluation = if matches!(
            sem,
            Semantic::ComponentReleaseRegister | Semantic::ComponentReleaseApprove
        ) || sem == Semantic::ResourceCreate
            || sem == Semantic::WorkspaceJoin
            || sem.is_application_binding()
            || sem.is_installation_permission()
            || sem.is_capability_contract()
            || sem.is_automation()
            || matches!(
                sem,
                Semantic::TenantDelete
                    | Semantic::AgentDefinitionCreate
                    | Semantic::LlmRouteCreate
                    | Semantic::AgentDefinitionUpdate
                    | Semantic::ResourceTransferOwner
                    | Semantic::AgentVersionCreate
                    | Semantic::AgentVersionUpdate
                    | Semantic::AgentVersionPublish
                    | Semantic::AgentVersionRetire
                    | Semantic::AgentInstallationCreate
                    | Semantic::AgentInstallationUpgrade
                    | Semantic::AgentDelegationGrant
                    | Semantic::AgentDelegationRevoke
            ) {
            let fresh = self
                .evaluate(
                    Actor {
                        tenant_id: ae.tenant_id,
                        principal_id: ae.initiator_principal_id,
                        human_identity_id: human,
                    },
                    def,
                    &target,
                )
                .await?;
            if !fresh.allowed {
                return Err(Refusal::Denied(
                    fresh.reason.unwrap_or(ReasonCode::PermissionDenied),
                ));
            }
            Some(fresh)
        } else {
            None
        };
        let eval = locked_evaluation.as_ref().unwrap_or(eval);
        self.target_gate(
            &mut *tx,
            ae.tenant_id,
            ae.initiator_principal_id,
            def,
            sem,
            params,
        )
        .await?;
        if matches!(
            sem,
            Semantic::AgentInstallationExecuteGrant | Semantic::ResourceGrantRead
        ) {
            installation_permission::validate_approval_owner(self, tx, ae, false).await?;
        }
        if matches!(sem, Semantic::TaskCancel | Semantic::TaskRerun) {
            // 控制动作先独立完成准入；取消向原 Workflow 发请求，重跑仅在
            // 派发前重新核实旧终态后才原子分配新的 WorkflowRef。
            sqlx::query(
                "update admission.action_execution
                 set gate_state = 'ALLOWED', reason_code = null, updated_at = now()
                 where id = $1",
            )
            .bind(ae.id)
            .execute(&mut **tx)
            .await?;
            record_decision(
                tx,
                &ae.subject(),
                phase,
                eval.scope,
                eval.authorization,
                approval,
                eval.quota,
                eval.zed_token.as_deref(),
                None,
            )
            .await?;
            audit(
                tx,
                ae,
                def,
                &format!("{}:decision", phase.to_lowercase()),
                "DECISION",
                "ALLOW",
                "ALLOWED",
                human,
                zed_evidence(eval.zed_token.as_deref()),
            )
            .await?;
            return Ok(None);
        }
        if def.execution_mode == "SYNC" {
            // 同步动作没有 Workflow。角色：门禁置 ALLOWED 后由派发在同一把锁下写
            // SpiceDB；邀请的签发与撤回只写 Core，在这同一个事务里完成并记 DISPATCHED
            let completes = sem.completes_in_admission();
            sqlx::query(
                "update admission.action_execution
                 set gate_state = 'ALLOWED', reason_code = null, updated_at = now(),
                     dispatch_state = case when $2 then 'DISPATCHED' else dispatch_state end
                 where id = $1",
            )
            .bind(ae.id)
            .bind(completes)
            .execute(&mut **tx)
            .await?;
            record_decision(
                tx,
                &ae.subject(),
                phase,
                eval.scope,
                eval.authorization,
                approval,
                eval.quota,
                eval.zed_token.as_deref(),
                None,
            )
            .await?;
            let mut evidence = zed_evidence(eval.zed_token.as_deref());
            if let Some(a) = &ae.approval_workflow_id {
                evidence.push(Evidence::new(EvidenceKind::ApprovalWorkflowId, a));
            }
            audit(
                tx,
                ae,
                def,
                &format!("{}:decision", phase.to_lowercase()),
                "DECISION",
                "ALLOW",
                "ALLOWED",
                human,
                evidence,
            )
            .await?;
            return match sem {
                Semantic::CapabilityContractRegister
                | Semantic::CapabilityContractApprove
                | Semantic::CapabilityContractDeprecate => {
                    crate::capability_contract::prewrite(self, tx, ae, sem, params).await?;
                    self.record_local_outcome(
                        tx,
                        ae,
                        def,
                        match sem {
                            Semantic::CapabilityContractRegister => {
                                "CAPABILITY_CONTRACT_REGISTERED"
                            }
                            Semantic::CapabilityContractApprove => "CAPABILITY_CONTRACT_APPROVED",
                            _ => "CAPABILITY_CONTRACT_DEPRECATED",
                        },
                        Vec::new(),
                    )
                    .await?;
                    Ok(None)
                }
                Semantic::AgentInstallationExecuteGrant
                | Semantic::AgentInstallationExecuteRevoke
                | Semantic::ResourceGrantRead
                | Semantic::ResourceRevokeRead => {
                    installation_permission::prewrite(tx, ae).await?;
                    Ok(None)
                }
                Semantic::AutomationCreate
                | Semantic::AutomationPublish
                | Semantic::AutomationEnable
                | Semantic::AutomationPause
                | Semantic::AutomationDisable
                | Semantic::AutomationDelete
                | Semantic::AutomationRotateWebhookSecret => {
                    crate::automation::management_prewrite(self, tx, ae, def, sem, params).await?;
                    if completes && !crate::automation::defer_management_dispatch(tx, ae.id).await?
                    {
                        self.record_local_outcome(
                            tx,
                            ae,
                            def,
                            match sem {
                                Semantic::AutomationEnable => "AUTOMATION_ENABLED",
                                Semantic::AutomationPause => "AUTOMATION_PAUSED",
                                Semantic::AutomationDelete => "AUTOMATION_DELETED",
                                _ => "AUTOMATION_DISABLED",
                            },
                            Vec::new(),
                        )
                        .await?;
                    }
                    Ok(None)
                }
                Semantic::AgentDelegationGrant | Semantic::AgentDelegationRevoke => {
                    delegation::prewrite(tx, ae, sem, params).await?;
                    self.record_local_outcome(
                        tx,
                        ae,
                        def,
                        if sem == Semantic::AgentDelegationGrant {
                            "DELEGATION_GRANTED"
                        } else {
                            "DELEGATION_REVOKED"
                        },
                        Vec::new(),
                    )
                    .await?;
                    Ok(None)
                }
                Semantic::AgentVersionCreate
                | Semantic::AgentVersionUpdate
                | Semantic::AgentVersionPublish
                | Semantic::AgentVersionRetire => {
                    let evidence =
                        crate::agent_version::prewrite(self, tx, ae, sem, params).await?;
                    if completes {
                        self.record_local_outcome(
                            tx,
                            ae,
                            def,
                            if sem == Semantic::AgentVersionRetire {
                                "AGENT_VERSION_RETIRED"
                            } else if sem == Semantic::AgentVersionPublish {
                                "AGENT_VERSION_PUBLISHED"
                            } else {
                                "AGENT_VERSION_UPDATED"
                            },
                            evidence,
                        )
                        .await?;
                    }
                    Ok(None)
                }
                Semantic::AgentDefinitionCreate
                | Semantic::AgentDefinitionUpdate
                | Semantic::ResourceTransferOwner => {
                    crate::agent_definition::prewrite(tx, ae, def, sem, params).await?;
                    if completes {
                        self.record_local_outcome(
                            tx,
                            ae,
                            def,
                            "AGENT_DEFINITION_UPDATED",
                            Vec::new(),
                        )
                        .await?;
                    }
                    Ok(None)
                }
                Semantic::LlmRouteCreate => {
                    crate::model_route::create_prewrite(tx, ae, def, params).await?;
                    Ok(None)
                }
                Semantic::TenantMemberInvite => {
                    let label = params
                        .name
                        .as_deref()
                        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
                    let issued =
                        crate::invitation::issue(tx, ae, label, self.cfg.invitation_ttl_seconds)
                            .await?;
                    self.record_local_outcome(
                        tx,
                        ae,
                        def,
                        "INVITATION_ISSUED",
                        vec![Evidence::new(
                            EvidenceKind::TenantInvitationId,
                            ae.target_id,
                        )],
                    )
                    .await?;
                    Ok(Some(issued))
                }
                Semantic::TenantMemberInviteRevoke => {
                    crate::invitation::revoke(tx, target.id, target.version).await?;
                    self.record_local_outcome(
                        tx,
                        ae,
                        def,
                        "INVITATION_REVOKED",
                        vec![Evidence::new(EvidenceKind::TenantInvitationId, target.id)],
                    )
                    .await?;
                    Ok(None)
                }
                _ => Ok(None),
            };
        }
        let kind = def
            .workflow_kind
            .as_deref()
            .ok_or_else(|| Refusal::Unavailable("TEMPORAL 定义缺 workflow_kind".into()))?;
        if sem.tenant_segment().is_some() {
            return self
                .allow_tenant_lifecycle(
                    tx, ae, def, sem, &target, kind, phase, approval, eval, human,
                )
                .await;
        }
        let version: i32 = match sem {
            Semantic::ResourceCreate => crate::resource_provision::prewrite(tx,ae,params).await?,
            Semantic::TenantDelete => {
                let snapshot: Option<(Uuid, i32, serde_json::Value)> = sqlx::query_as(
                    "select id, tenant_version, frozen_inventory from admission.tenant_lifecycle_snapshot
                     where action_execution_id = $1 and tenant_id = $2 and not irreversible_dispatch_started for update",
                ).bind(ae.id).bind(ae.tenant_id).fetch_optional(&mut **tx).await?;
                let Some((snapshot_id, frozen_version, frozen_inventory)) = snapshot else {
                    return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
                };
                if frozen_version != target.version {
                    return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
                }
                // 冻结以后恢复/投影重建/CONTROL 变动使审批失效，不能换成当前绑定执行。
                let current = frozen_delete_inventory(tx, ae.tenant_id, target.version).await?;
                if current != frozen_inventory { return Err(Refusal::Conflict(ReasonCode::TargetStateConflict)); }
                let mut owners:Vec<contracts::AffectedOwnerRef>=serde_json::from_value(current["resource_owner_versions"].clone())
                    .map_err(|e|Refusal::Unavailable(e.to_string()))?;
                owners.extend(serde_json::from_value::<Vec<contracts::AffectedOwnerRef>>(current["asset_owner_versions"].clone())
                    .map_err(|e|Refusal::Unavailable(e.to_string()))?);
                if !crate::agent_definition::validate_frozen_owners(self,tx,ae.tenant_id,&owners).await? {
                    return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
                }
                let version: Option<i32> = sqlx::query_scalar(
                    "update identity.tenant set state = 'DELETING', version = version + 1
                     where id = $1 and state = 'SUSPENDED' and version = $2 returning version",
                ).bind(ae.tenant_id).bind(target.version).fetch_optional(&mut **tx).await?;
                let version = version.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
                sqlx::query("update admission.tenant_lifecycle_snapshot set state = 'DELETING' where id = $1")
                    .bind(snapshot_id).execute(&mut **tx).await?;
                version
            }
            Semantic::SecretRefRehome => 1,
            Semantic::ConversationOpen => crate::conversations::prewrite(tx, ae, params).await?,
            Semantic::ApplicationBindingCreate | Semantic::ApplicationBindingDisable => {
                crate::application_binding::prewrite(tx, ae, params).await?
            }
            Semantic::ComponentReleaseRegister => {
                crate::component_release::prewrite(tx, ae, params).await?
            }
            Semantic::ComponentReleaseApprove => {
                crate::component_release::approval::prewrite(self, tx, ae, params).await?
            }
            Semantic::AgentInstallationCreate | Semantic::AgentInstallationUpgrade => {
                crate::agent_installation::prewrite(self, tx, ae, params).await?
            }
            Semantic::WorkspaceCreate => {
                let version = sqlx::query_scalar(
                    "insert into identity.workspace (id, tenant_id, slug, name, state, visibility)
                     values ($1, $2, $3, $4, 'PROVISIONING', $5) returning version",
                )
                .bind(target.id)
                .bind(ae.tenant_id)
                .bind(&params.slug)
                .bind(&params.name)
                .bind(wire(params.workspace_visibility.as_ref().unwrap_or(&contracts::WorkspaceVisibility::Private)))
                .fetch_one(&mut **tx)
                .await?;
                // CONTROL 代签创建 Channel，不是业务创建者。创建者的成员事实与
                // Workspace 同事务落定，后续仍由同一条 Temporal 链查证投影。
                sqlx::query(
                    "insert into identity.workspace_membership
                         (id, workspace_id, tenant_principal_id, state)
                     select $1, $2, p.id, 'PROVISIONING' from identity.principal p
                     join identity.tenant_membership tm on tm.tenant_principal_id = p.id
                     where p.id = $3 and p.tenant_id = $4 and p.kind = 'HUMAN'
                       and p.status = 'ACTIVE' and tm.tenant_id = $4 and tm.state = 'ACTIVE'",
                )
                .bind(Uuid::new_v4())
                .bind(target.id)
                .bind(ae.initiator_principal_id)
                .bind(ae.tenant_id)
                .execute(&mut **tx)
                .await?;
                version
            }
            // 先关门再收敛：SUSPENDING 即使该 Workspace scope fail closed，Workflow
            // 随后才 archive Channel（.design/06 §7.3）。条件更新只在状态与版本都未
            // 变时成立，不成立即按目标事实已变拒绝
            Semantic::WorkspaceSuspend | Semantic::WorkspaceRestore => {
                let Some((from, to, _)) = sem.workspace_segment() else {
                    return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
                };
                let advanced: Option<i32> = sqlx::query_scalar(
                    "update identity.workspace set state = $3, version = version + 1
                     where id = $1 and version = $2 and state = any($4) returning version",
                )
                .bind(target.id)
                .bind(target.version)
                .bind(to)
                .bind(from)
                .fetch_optional(&mut **tx)
                .await?;
                advanced.ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?
            }
            Semantic::WorkspaceMemberAdd | Semantic::WorkspaceJoin if target.version == 0 => {
                sqlx::query_scalar(
                    "insert into identity.workspace_membership (id, workspace_id, tenant_principal_id, state)
                     values ($1, $2, $3, 'PROVISIONING') returning version",
                )
                .bind(target.id)
                .bind(params.workspace_id)
                .bind(if sem == Semantic::WorkspaceJoin { Some(ae.initiator_principal_id) } else { params.principal_id })
                .fetch_one(&mut **tx)
                .await?
            }
            Semantic::WorkspaceMemberAdd => {
                sqlx::query_scalar(
                    "update identity.workspace_membership set state = 'PROVISIONING', version = version + 1
                     where id = $1 and version = $2 and state = 'REVOKED' returning version",
                )
                .bind(target.id)
                .bind(target.version)
                .fetch_one(&mut **tx)
                .await?
            }
            Semantic::WorkspaceJoin => return Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
            Semantic::WorkspaceMemberRevoke => {
                // 先关门再收敛：REVOKING 即拒绝该 Workspace 的新动作（DD-41）
                sqlx::query_scalar(
                    "update identity.workspace_membership set state = 'REVOKING', version = version + 1
                     where id = $1 and version = $2 returning version",
                )
                .bind(target.id)
                .bind(target.version)
                .fetch_one(&mut **tx)
                .await?
            }
            // 确认通过且重新准入成立：INVITED→PROVISIONING，新 version 派发成员开通
            // （DD-83、.design/09 §4「新 Tenant member」）
            Semantic::TenantMemberAdmit => {
                sqlx::query_scalar(
                    "update identity.tenant_membership set state = 'PROVISIONING', version = version + 1
                     where id = $1 and version = $2 and state = 'INVITED' returning version",
                )
                .bind(target.id)
                .bind(target.version)
                .fetch_one(&mut **tx)
                .await?
            }
            Semantic::TenantMemberRevoke => {
                let v: i32 = sqlx::query_scalar(
                    "update identity.tenant_membership set state = 'REVOKING', version = version + 1
                     where id = $1 and version = $2 returning version",
                )
                .bind(target.id)
                .bind(target.version)
                .fetch_one(&mut **tx)
                .await?;
                // 进入 REVOKING 即撤会话，与状态变化同事务（.design/03 §2）
                identity::session::revoke_for_membership(tx, target.id).await?;
                // 此人在本 Tenant 的每个未撤 WorkspaceMembership 一并进入 REVOKING，
                // 由同一条撤权 Workflow 收敛到 REVOKED（.design/10 §5）。留着不动，
                // 按邀请恢复会沿用同一 Principal，让旧的 ACTIVE 投影随之复活。
                // 已在 REVOKING 的也推进版本：它自己的撤权 Workflow 随之以版本冲突
                // 终止，收敛只归这一条，不让两条链争同一次跃迁。
                sqlx::query(
                    "update identity.workspace_membership wm
                     set state = 'REVOKING', version = wm.version + 1
                     from identity.tenant_membership tm, identity.workspace w
                     where tm.id = $1 and w.id = wm.workspace_id and w.tenant_id = tm.tenant_id
                       and wm.tenant_principal_id = tm.tenant_principal_id
                       and wm.state in ('PROVISIONING', 'ACTIVE', 'REVOKING', 'ERROR')",
                )
                .bind(target.id)
                .execute(&mut **tx)
                .await?;
                v
            }
            // 角色与邀请动作是 SYNC，已在上面返回；走到这里说明目录把它登记成了别的
            // 执行方式
            Semantic::TenantRoleGrant
            | Semantic::TenantRoleRevoke
            | Semantic::WorkspaceRoleGrant
            | Semantic::WorkspaceRoleRevoke
            | Semantic::TenantMemberInvite
            | Semantic::TenantMemberInviteRevoke
            | Semantic::TaskCancel
            | Semantic::TaskRerun
            | Semantic::AgentDefinitionCreate
            | Semantic::CapabilityContractRegister
            | Semantic::CapabilityContractApprove
            | Semantic::CapabilityContractDeprecate
            | Semantic::LlmRouteCreate
            | Semantic::AgentDefinitionUpdate
            | Semantic::ResourceTransferOwner
            | Semantic::AgentDelegationGrant
            | Semantic::AgentDelegationRevoke
            | Semantic::AgentInstallationExecuteGrant
            | Semantic::AgentInstallationExecuteRevoke
            | Semantic::ResourceGrantRead | Semantic::ResourceRevokeRead
            | Semantic::AgentVersionCreate | Semantic::AgentVersionUpdate | Semantic::AgentVersionPublish | Semantic::AgentVersionRetire
            | Semantic::AutomationCreate | Semantic::AutomationPublish | Semantic::AutomationEnable
            | Semantic::AutomationPause | Semantic::AutomationDisable | Semantic::AutomationRotateWebhookSecret
            | Semantic::AutomationDelete
            // 业务 Tenant 生命周期在上面单独落定
            | Semantic::TenantSuspend
            | Semantic::TenantRestore => {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked))
            }
        };
        // 一条归位 ActionExecution 一条独立目标 locator；不能以 Principal 版本作
        // workflow ID，否则一次确定失败后的新治理动作会撞上旧 ID。
        let workflow_entity = if matches!(
            sem,
            Semantic::SecretRefRehome
                | Semantic::ComponentReleaseApprove
                | Semantic::ResourceCreate
        ) {
            ae.id
        } else {
            target.id
        };
        let workflow_id =
            component_task::workflow_id(kind, ae.tenant_id, &workflow_entity.to_string(), version);
        component_task::prewrite(tx, &workflow_id, kind, ae.tenant_id, ae.operation_id, ae.id)
            .await?;
        if sem == Semantic::SecretRefRehome {
            crate::secret_ref_rehome::prewrite(&self.secrets, tx, ae, &workflow_id, target.version)
                .await?;
        }
        sqlx::query(
            "update admission.action_execution
             set gate_state = 'ALLOWED', temporal_workflow_id = $2, reason_code = null, updated_at = now()
             where id = $1",
        )
        .bind(ae.id)
        .bind(&workflow_id)
        .execute(&mut **tx)
        .await?;
        record_decision(
            tx,
            &ae.subject(),
            phase,
            eval.scope,
            eval.authorization,
            approval,
            eval.quota,
            eval.zed_token.as_deref(),
            None,
        )
        .await?;
        let mut evidence = zed_evidence(eval.zed_token.as_deref());
        if sem == Semantic::TenantDelete {
            let (snapshot_id, subprocess_id): (Uuid, Uuid) = sqlx::query_as(
                "select s.id, p.id from admission.tenant_lifecycle_snapshot s
                 join admission.tenant_delete_subprocess p on p.tenant_lifecycle_snapshot_id = s.id
                 where s.action_execution_id = $1 and p.subject = 'PLATFORM_CORE'",
            )
            .bind(ae.id)
            .fetch_one(&mut **tx)
            .await?;
            evidence.push(Evidence::new(
                EvidenceKind::TenantLifecycleSnapshotId,
                snapshot_id,
            ));
            evidence.push(Evidence::new(
                EvidenceKind::TenantDeleteSubprocessId,
                subprocess_id,
            ));
        }
        {
            evidence.push(Evidence::new(EvidenceKind::TemporalWorkflowId, workflow_id));
            if let Some(a) = &ae.approval_workflow_id {
                evidence.push(Evidence::new(EvidenceKind::ApprovalWorkflowId, a));
            }
        }
        audit(
            tx,
            ae,
            def,
            &format!("{}:decision", phase.to_lowercase()),
            "DECISION",
            "ALLOW",
            "ALLOWED",
            human,
            evidence,
        )
        .await?;
        Ok(None)
    }
}

impl Governance {
    /// 业务 Tenant 暂停与恢复的准入落定（DD-96(2)(3)、`.design/03` §6 TENANT_ONLY 的
    /// 唯一例外）。
    ///
    /// 同一事务里：把**业务** Tenant 置 SUSPENDING/RESTORING 并 version+1——这是 Core
    /// 中唯一允许的跨 Tenant 写，只对这两个语义开放；为业务 Tenant 建立它自己的承接
    /// 执行（独立 operation、ALLOWED、以业务 Tenant 为 tenant）、预写它的
    /// `TENANT_LIFECYCLE` WorkflowRef 并写业务侧审计，审计以 `ACTION_EXECUTION_ID`
    /// 引用发起它的 Catalog ActionExecution；Catalog 执行只记下同一 workflow ID，两侧
    /// 不共享 operation。不在业务 Tenant 中建立任何 Catalog Principal 的 relationship。
    #[allow(clippy::too_many_arguments)]
    async fn allow_tenant_lifecycle(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        ae: &Execution,
        def: &Definition,
        sem: Semantic,
        target: &Target,
        kind: &str,
        phase: &str,
        approval: &str,
        eval: &Evaluation,
        human: Option<Uuid>,
    ) -> Result<Option<crate::invitation::Issued>, Refusal> {
        let Some((from, to, _)) = sem.tenant_segment() else {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        };
        let business = target.id;
        let version: i32 = sqlx::query_scalar::<_, i32>(
            "update identity.tenant set state = $3, version = version + 1
             where id = $1 and version = $2 and state = any($4) and id <> $5
             returning version",
        )
        .bind(business)
        .bind(target.version)
        .bind(to)
        .bind(from)
        .bind(ae.tenant_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        let workflow_id =
            component_task::workflow_id(kind, business, &business.to_string(), version);

        let lifecycle_id = Uuid::new_v4();
        let lifecycle_operation = Uuid::new_v4();
        sqlx::query(
            "insert into admission.action_execution
                 (id, operation_id, tenant_id, action_key, action_version,
                  initiator_principal_id, actor_principal_id, target_id, parameter_hash,
                  temporal_workflow_id, gate_state, dispatch_state, correlation_id)
             values ($1, $2, $3, $4, $5, $6, $7, $3, $8, $9, 'ALLOWED', 'NOT_DISPATCHED', $2)",
        )
        .bind(lifecycle_id)
        .bind(lifecycle_operation)
        .bind(business)
        .bind(&ae.action_key)
        .bind(ae.action_version)
        .bind(ae.initiator_principal_id)
        .bind(ae.actor_principal_id)
        .bind(&ae.parameter_hash)
        .bind(&workflow_id)
        .execute(&mut **tx)
        .await?;
        let lifecycle = lock_execution(tx, lifecycle_id).await?;
        component_task::prewrite(
            tx,
            &workflow_id,
            kind,
            business,
            lifecycle_operation,
            lifecycle_id,
        )
        .await?;
        audit(
            tx,
            &lifecycle,
            def,
            "lifecycle:accepted",
            "DECISION",
            "ALLOW",
            "ALLOWED",
            None,
            vec![
                Evidence::new(EvidenceKind::ActionExecutionId, ae.id),
                Evidence::new(EvidenceKind::TemporalWorkflowId, &workflow_id),
            ],
        )
        .await?;

        sqlx::query(
            "update admission.action_execution
             set gate_state = 'ALLOWED', temporal_workflow_id = $2, reason_code = null, updated_at = now()
             where id = $1",
        )
        .bind(ae.id)
        .bind(&workflow_id)
        .execute(&mut **tx)
        .await?;
        record_decision(
            tx,
            &ae.subject(),
            phase,
            eval.scope,
            eval.authorization,
            approval,
            eval.quota,
            eval.zed_token.as_deref(),
            None,
        )
        .await?;
        let mut evidence = zed_evidence(eval.zed_token.as_deref());
        evidence.push(Evidence::new(
            EvidenceKind::TemporalWorkflowId,
            &workflow_id,
        ));
        evidence.push(Evidence::new(EvidenceKind::ActionExecutionId, lifecycle_id));
        audit(
            tx,
            ae,
            def,
            &format!("{}:decision", phase.to_lowercase()),
            "DECISION",
            "ALLOW",
            "ALLOWED",
            human,
            evidence,
        )
        .await?;
        Ok(None)
    }

    /// 业务 Tenant 生命周期的派发。Catalog 执行与业务侧承接执行指向同一 workflow ID；
    /// 无论对账作业先驱动哪一条，都以 WorkflowRef 的归属（业务侧承接执行）启动，并把
    /// 两条的派发状态一起落定、两侧各写审计。确定中止时同一事务把业务 Tenant 从
    /// 收敛中状态置 ERROR：不会再有 Workflow 把它带出来。
    async fn dispatch_tenant_lifecycle(
        &self,
        ae: &Execution,
        def: &Definition,
        sem: Semantic,
    ) -> Result<(), Refusal> {
        let Some((_, converging, operation)) = sem.tenant_segment() else {
            return Ok(());
        };
        let Some(workflow_id) = ae.temporal_workflow_id.clone() else {
            return Err(Refusal::Unavailable(
                "ALLOWED 而没有预写 workflow ID".into(),
            ));
        };
        let Some((lifecycle_id, business, ref_state)) = sqlx::query_as::<_, (Uuid, Uuid, String)>(
            "select action_execution_id, tenant_id, projection_state
                 from projection.workflow_ref where workflow_id = $1",
        )
        .bind(&workflow_id)
        .fetch_optional(&self.pool)
        .await?
        else {
            return Err(Refusal::Unavailable(
                "业务 Tenant 的 WorkflowRef 缺失".into(),
            ));
        };
        let pair: Vec<Execution> = sqlx::query_as(&format!(
            "select {EXECUTION_COLUMNS} from admission.action_execution
             where temporal_workflow_id = $1 and action_key = $2 and action_version = $3
               and gate_state = 'ALLOWED'"
        ))
        .bind(&workflow_id)
        .bind(&def.action_key)
        .bind(def.version)
        .fetch_all(&self.pool)
        .await?;
        let Some(catalog_id) = pair.iter().find(|e| e.tenant_id != business).map(|e| e.id) else {
            return Err(Refusal::Unavailable(
                "缺发起它的 Catalog ActionExecution".into(),
            ));
        };
        if pair
            .iter()
            .all(|e| matches!(e.dispatch_state.as_str(), "DISPATCHED" | "ABORTED"))
        {
            return Ok(());
        }
        let outcome = if matches!(ref_state.as_str(), "RUNNING" | "TERMINAL") {
            Ok(())
        } else {
            match launch_scope(
                &self.pool,
                &self.temporal,
                &ScopeLifecycleRequest {
                    kind: ScopeKind::Tenant,
                    id: business,
                    action_execution_id: lifecycle_id,
                    operation,
                },
            )
            .await
            {
                Ok(r) if r.workflow_id == workflow_id => Ok(()),
                Ok(r) => {
                    tracing::error!(expected = %workflow_id, got = %r.workflow_id, "派发的 workflow ID 与预写的不一致");
                    Err(StatusCode::CONFLICT)
                }
                Err(resp) => Err(resp.status()),
            }
        };
        let mut tx = self.pool.begin().await?;
        let mut aborted = false;
        for e in &pair {
            let other = if e.id == lifecycle_id {
                catalog_id
            } else {
                lifecycle_id
            };
            let recorded = record_dispatch(
                &mut tx,
                e.id,
                def.audit_class(),
                outcome,
                vec![Evidence::new(EvidenceKind::ActionExecutionId, other)],
            )
            .await?;
            aborted |= recorded.settled && recorded.outcome == Dispatch::Aborted;
        }
        if aborted {
            sqlx::query(
                "update identity.tenant set state = 'ERROR', version = version + 1
                 where id = $1 and state = $2",
            )
            .bind(business)
            .bind(converging)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// 在准入事务里完成的同步动作的 DISPATCH 与 OUTCOME 审计：它们没有外部副作用，
    /// 「派发」就是同一事务里那次 Core 写入，两条事实与门禁一起成立。
    async fn record_local_outcome(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        ae: &Execution,
        def: &Definition,
        outcome: &str,
        evidence: Vec<Evidence>,
    ) -> Result<(), sqlx::Error> {
        audit(
            tx,
            ae,
            def,
            "dispatch",
            "DISPATCH",
            "ALLOW",
            "DISPATCHED",
            None,
            evidence.clone(),
        )
        .await?;
        audit(
            tx, ae, def, "outcome", "OUTCOME", "ALLOW", outcome, None, evidence,
        )
        .await
    }
}

// ---------------------------------------------------------------------------
// 角色（DD-82）：目标事实门禁与同步派发
// ---------------------------------------------------------------------------

impl Governance {
    /// 固定原 Workflow ID 与执行链首次 run ID 后才准发送取消请求。RUNNING
    /// 投影不是最终证据；还要向 Temporal Describe 观察当前 run 仍 OPEN（DD-84）。
    async fn cancel_target(
        &self,
        conn: &mut sqlx::PgConnection,
        tenant: Uuid,
        initiator: Uuid,
        def: &Definition,
        p: &Params,
    ) -> Result<(String, String, String), Refusal> {
        let original_id = p
            .original_action_execution_id
            .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
        let (original, source) = control_original(
            conn,
            tenant,
            initiator,
            def,
            Semantic::TaskCancel,
            original_id,
            false,
        )
        .await?;
        if original.action_key == "tenant.delete" {
            let reversible: bool = sqlx::query_scalar(
                "select exists (select 1 from admission.tenant_lifecycle_snapshot
                                where action_execution_id = $1 and tenant_id = $2
                                  and not irreversible_dispatch_started)",
            )
            .bind(original.id)
            .bind(tenant)
            .fetch_one(&mut *conn)
            .await?;
            if !reversible {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
        }
        let workflow_id = original
            .temporal_workflow_id
            .clone()
            .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        if original.gate_state != "ALLOWED" {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        let Some((ref_state, reference_run)) =
            task_control::cancel_projection(conn, &original, &source).await?
        else {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        };
        if ref_state != "RUNNING" {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        let observed = self
            .temporal
            .describe(&workflow_id)
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?
            .ok_or_else(|| Refusal::Unavailable("原 Workflow 的 Temporal 事实不可查".into()))?;
        if observed.run_id.is_empty() || observed.first_run_id.is_empty() {
            return Err(Refusal::Unavailable(
                "Temporal 未返回可固定的当前与首次 run ID".into(),
            ));
        }
        if !task_control::same_execution_chain(
            reference_run.as_deref(),
            &observed.run_id,
            &observed.first_run_id,
        ) {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        match observed.state {
            ObservedState::Open => Ok((workflow_id, observed.run_id, observed.first_run_id)),
            ObservedState::Closed(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
            ObservedState::Unrecognized(_) => {
                Err(Refusal::Unavailable("原 Workflow 状态未识别".into()))
            }
        }
    }

    async fn rerun_target(
        &self,
        conn: &mut sqlx::PgConnection,
        tenant: Uuid,
        initiator: Uuid,
        def: &Definition,
        p: &Params,
    ) -> Result<String, Refusal> {
        let original_id = p
            .original_action_execution_id
            .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
        let (original, source) = control_original(
            conn,
            tenant,
            initiator,
            def,
            Semantic::TaskRerun,
            original_id,
            false,
        )
        .await?;
        if original.gate_state != "ALLOWED" {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        let workflow_id = original
            .temporal_workflow_id
            .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        let kind = source
            .workflow_kind
            .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
        match crate::task_rerun::eligible(
            &self.pool,
            &self.temporal,
            &workflow_id,
            tenant,
            original_id,
            &kind,
        )
        .await
        {
            Ok(()) => Ok(workflow_id),
            Err(response) => Err(match response.status() {
                StatusCode::NOT_FOUND => Refusal::Precondition(ReasonCode::TargetNotFound),
                StatusCode::CONFLICT => Refusal::Conflict(ReasonCode::TargetStateConflict),
                StatusCode::SERVICE_UNAVAILABLE => {
                    Refusal::Unavailable("原 Workflow 的关闭事实、终态投影或目标版本不可查".into())
                }
                _ => Refusal::Blocked(ReasonCode::CapabilityBlocked),
            }),
        }
    }

    /// 目标在权威处的事实是否允许这次变更。角色的事实在 SpiceDB，成员的事实在
    /// Core；二者与「有效 Tenant admin 不得为空」一起在这里判定。
    ///
    /// 准入（无锁，给出早拒绝）与落定（持有 Tenant 行锁）各调一次；只有后一次的
    /// 结论与随后的写入之间没有缝。
    async fn target_gate(
        &self,
        conn: &mut sqlx::PgConnection,
        tenant: Uuid,
        initiator: Uuid,
        def: &Definition,
        sem: Semantic,
        p: &Params,
    ) -> Result<(), Refusal> {
        if sem.is_capability_contract() {
            crate::capability_contract::target(conn, tenant, def, sem, p, None, false).await?;
            return Ok(());
        }
        if sem.is_installation_permission() {
            return installation_permission::gate(
                self,
                conn,
                tenant,
                initiator,
                p,
                &def.action_key,
            )
            .await;
        }
        if matches!(
            sem,
            Semantic::AgentDelegationGrant | Semantic::AgentDelegationRevoke
        ) {
            return delegation::target_gate(self, conn, tenant, initiator, sem, p).await;
        }
        if sem == Semantic::TenantDelete {
            if !crate::tenant_delete::secrets_ready(&self.secrets, conn, tenant).await? {
                return Err(Refusal::Precondition(ReasonCode::TargetStateConflict));
            }
            return Ok(());
        }
        if sem == Semantic::SecretRefRehome {
            return crate::secret_ref_rehome::target_gate(&self.secrets, conn, tenant, p).await;
        }
        if sem == Semantic::TaskCancel {
            self.cancel_target(conn, tenant, initiator, def, p).await?;
            return Ok(());
        }
        if sem == Semantic::TaskRerun {
            self.rerun_target(conn, tenant, initiator, def, p).await?;
            return Ok(());
        }
        let page = self.cfg.relationship_page;
        let Some(principal) = p.principal_id else {
            return Ok(());
        };
        match sem {
            Semantic::TenantRoleGrant
            | Semantic::TenantRoleRevoke
            | Semantic::WorkspaceRoleGrant
            | Semantic::WorkspaceRoleRevoke => {
                let t = role_template_of(&mut *conn, def).await?;
                let object = p.workspace_id.unwrap_or(tenant);
                let held = crate::roles::held(&self.spicedb, &t, object, principal, page)
                    .await
                    .map_err(|e| Refusal::Unavailable(e.to_string()))?;
                if sem.is_grant() {
                    // 已持有：没有要授予的东西。不当作成功重放——那会让两次授予
                    // 在审计里看起来各自生效过
                    return if held {
                        Err(Refusal::Conflict(ReasonCode::TargetStateConflict))
                    } else {
                        Ok(())
                    };
                }
                if !held {
                    return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
                }
                if t.grants_tenant_manage() {
                    let effective = crate::roles::effective_tenant_admins(
                        &mut *conn,
                        &self.spicedb,
                        tenant,
                        page,
                    )
                    .await?;
                    if crate::roles::would_empty(&effective, principal) {
                        return Err(Refusal::Precondition(ReasonCode::LastTenantAdmin));
                    }
                }
                Ok(())
            }
            // 撤掉一个人的 TenantMembership 也撤掉他的全部角色（DD-82）
            Semantic::TenantMemberRevoke => {
                let effective =
                    crate::roles::effective_tenant_admins(&mut *conn, &self.spicedb, tenant, page)
                        .await?;
                if crate::roles::would_empty(&effective, principal) {
                    return Err(Refusal::Precondition(ReasonCode::LastTenantAdmin));
                }
                Ok(())
            }
            _ => Ok(()),
        }
    }

    /// 同步角色动作的派发：在 ActionExecution 与 Tenant 两把行锁下重新核对目标事实，
    /// 写 SpiceDB，记下结果。锁跨过这次写：「有效 admin 不得为空」的判定与写入之间
    /// 不能留缝，否则两个并发的撤销各自看到对方还在（DD-82）。
    ///
    /// 写结果不明时记 UNKNOWN，由对账作业以同一意图重发——写本身幂等。重发时
    /// 目标事实已不成立（授予对象失去成员资格、撤销会清空 admin），就不写并记
    /// ABORTED；授予的那一侧还要先确保关系不在，因为上一次不明的写可能已经生效，
    /// 而中间状态只允许收紧（`.design/09` §4）。
    async fn dispatch_role(
        &self,
        ae_id: Uuid,
        def: &Definition,
        sem: Semantic,
    ) -> Result<(), Refusal> {
        let mut tx = self.pool.begin().await?;
        let ae = lock_execution(&mut tx, ae_id).await?;
        if ae.gate_state != "ALLOWED"
            || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
        {
            return Ok(());
        }
        if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
            return Err(Refusal::Unavailable("Tenant 消失".into()));
        }
        let params = ae
            .params()
            .ok_or_else(|| Refusal::Unavailable("ActionExecution 缺规范化参数".into()))?;
        let principal = params
            .principal_id
            .ok_or_else(|| Refusal::Unavailable("角色动作缺 principal".into()))?;
        let t = role_template_of(&mut tx, def).await?;
        let object = params.workspace_id.unwrap_or(ae.tenant_id);
        let rels = t.expand(object, principal);

        // 目标事实：授予对象仍是 ACTIVE 成员（Workspace 仍 ACTIVE）；撤 Tenant admin
        // 不会清空有效 admin
        let still = match resolve_target(
            &mut tx,
            ae.tenant_id,
            ae.initiator_principal_id,
            def,
            sem,
            &params,
            Some(ae.target_id),
            true,
        )
        .await
        {
            Ok(target) if target.id == ae.target_id => Ok(()),
            Ok(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
            Err(r @ Refusal::Unavailable(_)) => return Err(r),
            Err(r) => Err(r),
        };
        let still = match still {
            Ok(()) if !sem.is_grant() && t.grants_tenant_manage() => {
                let effective = crate::roles::effective_tenant_admins(
                    &mut tx,
                    &self.spicedb,
                    ae.tenant_id,
                    self.cfg.relationship_page,
                )
                .await?;
                if crate::roles::would_empty(&effective, principal) {
                    Err(Refusal::Precondition(ReasonCode::LastTenantAdmin))
                } else {
                    Ok(())
                }
            }
            other => other,
        };

        let (state, stage, result, reason, token) = match still {
            Ok(()) => {
                let op = if sem.is_grant() {
                    crate::spicedb::Write::Touch
                } else {
                    crate::spicedb::Write::Delete
                };
                let updates: Vec<_> = rels.iter().cloned().map(|r| (op, r)).collect();
                match self.spicedb.write(&updates).await {
                    Ok(token) => ("DISPATCHED", "dispatch", "DISPATCHED", None, Some(token)),
                    Err(e) => {
                        tracing::warn!(action = %ae.id, error = %e, "角色写入结果不明");
                        (
                            "UNKNOWN",
                            "dispatch-unknown",
                            "DISPATCH_RESULT_UNKNOWN",
                            None,
                            None,
                        )
                    }
                }
            }
            Err(r) => {
                let mut token = None;
                if sem.is_grant() && ae.dispatch_state == "UNKNOWN" {
                    let updates: Vec<_> = rels
                        .iter()
                        .cloned()
                        .map(|r| (crate::spicedb::Write::Delete, r))
                        .collect();
                    // 收紧不成功就不能宣称中止：留在 UNKNOWN，下一轮再来
                    token = Some(
                        self.spicedb
                            .write(&updates)
                            .await
                            .map_err(|e| Refusal::Unavailable(e.to_string()))?,
                    );
                }
                (
                    "ABORTED",
                    "dispatch-aborted",
                    "DISPATCH_ABORTED",
                    Some(r.reason()),
                    token,
                )
            }
        };
        sqlx::query(
            "update admission.action_execution
             set dispatch_state = $2, reason_code = coalesce($3, reason_code), updated_at = now()
             where id = $1",
        )
        .bind(ae.id)
        .bind(state)
        .bind(reason.as_ref().map(wire))
        .execute(&mut *tx)
        .await?;
        let mut evidence = zed_evidence(token.as_deref());
        for r in &rels {
            evidence.push(Evidence::new(
                EvidenceKind::SpicedbRelationship,
                format!(
                    "{}:{}#{}@principal:{}",
                    r.object_type, r.object_id, r.relation, r.subject_principal
                ),
            ));
        }
        let decision = if state == "ABORTED" { "DENY" } else { "ALLOW" };
        let result = reason
            .as_ref()
            .map(wire)
            .unwrap_or_else(|| result.to_owned());
        audit(
            &mut tx,
            &ae,
            def,
            stage,
            "DISPATCH",
            decision,
            &result,
            None,
            evidence.clone(),
        )
        .await?;
        if state == "DISPATCHED" {
            audit(
                &mut tx,
                &ae,
                def,
                "outcome",
                "OUTCOME",
                "ALLOW",
                if sem.is_grant() {
                    "ROLE_GRANTED"
                } else {
                    "ROLE_REVOKED"
                },
                None,
                evidence,
            )
            .await?;
        }
        tx.commit().await?;
        match state {
            "DISPATCHED" if ae.approval_workflow_id.is_some() => self.consume(ae.id).await,
            "ABORTED" if ae.approval_workflow_id.is_some() => self.invalidate(ae.id).await,
            _ => {}
        }
        Ok(())
    }
}

fn zed_evidence(token: Option<&str>) -> Vec<Evidence> {
    match token {
        Some(t) if !t.is_empty() => vec![Evidence::new(EvidenceKind::SpicedbZedtoken, t)],
        _ => Vec::new(),
    }
}

/// 把一条 ActionExecution 写成 BFF 回应。门禁未决或已派发都是 2xx；结果不明
/// 用 202 并带 dispatchState=UNKNOWN，不说成功也不说失败。
pub(crate) fn submission_result(
    ae: &Execution,
) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
    let op = Some(ae.operation_id);
    let reason = || {
        ae.reason_code
            .as_deref()
            .and_then(parse)
            .unwrap_or(ReasonCode::PermissionDenied)
    };
    match ae.gate_state.as_str() {
        "DENIED" => Err((Refusal::from_reason(reason()), op)),
        "ALLOWED" if ae.dispatch_state == "DISPATCHED" => Ok((StatusCode::OK, ae.submission())),
        _ => Ok((StatusCode::ACCEPTED, ae.submission())),
    }
}

// ---------------------------------------------------------------------------
// 派发
// ---------------------------------------------------------------------------

enum CancelReceipt {
    RpcAccepted,
    RpcUnknown,
    History,
}

impl Governance {
    async fn dispatch_rerun(&self, ae_id: Uuid, def: &Definition) -> Result<(), Refusal> {
        let Some(initial) = load_execution(&self.pool, ae_id).await? else {
            return Ok(());
        };
        if initial.gate_state != "ALLOWED"
            || !matches!(
                initial.dispatch_state.as_str(),
                "NOT_DISPATCHED" | "UNKNOWN"
            )
        {
            return Ok(());
        }
        let actor = Actor {
            tenant_id: initial.tenant_id,
            principal_id: initial.initiator_principal_id,
            human_identity_id: None,
        };
        let target = Target {
            id: initial.target_id,
            version: initial
                .frozen_target_version()
                .ok_or_else(|| Refusal::Unavailable("重跑控制动作缺原定义版本".into()))?,
            workspace_id: initial.workspace_id,
        };
        let eval = self.evaluate(actor, def, &target).await?;
        let mut tx = self.pool.begin().await?;
        let ae = lock_execution(&mut tx, ae_id).await?;
        if ae.gate_state != "ALLOWED"
            || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
        {
            return Ok(());
        }
        let params = ae
            .params()
            .ok_or_else(|| Refusal::Unavailable("重跑控制动作缺规范化参数".into()))?;
        let checked = resolve_target(
            &mut tx,
            ae.tenant_id,
            ae.initiator_principal_id,
            def,
            Semantic::TaskRerun,
            &params,
            Some(ae.target_id),
            true,
        )
        .await;
        let mut workflow_id = None;
        let reason = if !eval.allowed {
            Some(eval.reason.clone().unwrap_or(ReasonCode::PermissionDenied))
        } else {
            match checked {
                Ok(current)
                    if current == target
                        && parameter_hash(def, current.id, &params) == ae.parameter_hash =>
                {
                    if ae.temporal_workflow_id.is_none() {
                        match self
                            .rerun_target(
                                &mut tx,
                                ae.tenant_id,
                                ae.initiator_principal_id,
                                def,
                                &params,
                            )
                            .await
                        {
                            Ok(id) => workflow_id = Some(id),
                            Err(Refusal::Unavailable(e)) => return Err(Refusal::Unavailable(e)),
                            Err(e) => return self.abort_rerun(tx, &ae, def, &eval, e).await,
                        }
                    } else {
                        let (original, _) = control_original(
                            &mut tx,
                            ae.tenant_id,
                            ae.initiator_principal_id,
                            def,
                            Semantic::TaskRerun,
                            ae.target_id,
                            false,
                        )
                        .await?;
                        workflow_id = original.temporal_workflow_id;
                    }
                    None
                }
                Ok(_) => Some(ReasonCode::TargetStateConflict),
                Err(Refusal::Unavailable(e)) => return Err(Refusal::Unavailable(e)),
                Err(e) => Some(e.reason()),
            }
        };
        if let Some(reason) = reason {
            return self
                .abort_rerun(tx, &ae, def, &eval, Refusal::Conflict(reason))
                .await;
        }
        let workflow_id = workflow_id
            .ok_or_else(|| Refusal::Unavailable("重跑控制动作缺原 Workflow ID".into()))?;
        record_decision(
            &mut tx,
            &ae.subject(),
            "RECHECK",
            eval.scope,
            eval.authorization,
            if ae.approval_workflow_id.is_some() {
                "SATISFIED"
            } else {
                "NOT_REQUIRED"
            },
            eval.quota,
            eval.zed_token.as_deref(),
            None,
        )
        .await?;
        audit(
            &mut tx,
            &ae,
            def,
            "rerun:recheck",
            "DECISION",
            "ALLOW",
            "ALLOWED",
            None,
            zed_evidence(eval.zed_token.as_deref()),
        )
        .await?;
        tx.commit().await?;

        let response = crate::task_rerun::rerun(
            &self.pool,
            &self.temporal,
            &crate::task_rerun::RerunRequest {
                workflow_id,
                action_execution_id: ae_id,
            },
            &def.action_key,
        )
        .await;
        let current = load_execution(&self.pool, ae_id)
            .await?
            .ok_or_else(|| Refusal::Unavailable("重跑控制动作在派发后丢失".into()))?;
        let accepted =
            response.status() == StatusCode::OK && current.temporal_workflow_id.is_some();
        let state = if accepted {
            "DISPATCHED"
        } else if current.temporal_workflow_id.is_some()
            || response.status() == StatusCode::SERVICE_UNAVAILABLE
        {
            "UNKNOWN"
        } else {
            "ABORTED"
        };
        let mut tx = self.pool.begin().await?;
        let ae = lock_execution(&mut tx, ae_id).await?;
        if ae.gate_state != "ALLOWED"
            || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
        {
            return Ok(());
        }
        sqlx::query(
            "update admission.action_execution
             set dispatch_state = $2, reason_code = $3, updated_at = now()
             where id = $1 and gate_state = 'ALLOWED'
               and dispatch_state in ('NOT_DISPATCHED', 'UNKNOWN')",
        )
        .bind(ae_id)
        .bind(state)
        .bind(if state == "UNKNOWN" {
            Some(wire(&ReasonCode::ExternalResultUnknown))
        } else if state == "ABORTED" {
            Some(wire(&ReasonCode::TargetStateConflict))
        } else {
            None
        })
        .execute(&mut *tx)
        .await?;
        audit(
            &mut tx,
            &ae,
            def,
            "rerun:dispatch",
            "DISPATCH",
            "ALLOW",
            match state {
                "DISPATCHED" => "DISPATCHED",
                "UNKNOWN" => "DISPATCH_RESULT_UNKNOWN",
                _ => "DISPATCH_ABORTED",
            },
            None,
            ae.temporal_workflow_id
                .iter()
                .map(|w| Evidence::new(EvidenceKind::TemporalWorkflowId, w))
                .collect(),
        )
        .await?;
        tx.commit().await?;
        if accepted && ae.approval_workflow_id.is_some() {
            self.consume(ae_id).await;
        }
        Ok(())
    }

    async fn abort_rerun(
        &self,
        mut tx: Transaction<'_, Postgres>,
        ae: &Execution,
        def: &Definition,
        eval: &Evaluation,
        refusal: Refusal,
    ) -> Result<(), Refusal> {
        let preserved = ae.temporal_workflow_id.is_some();
        let state = if preserved { "UNKNOWN" } else { "ABORTED" };
        let reason = if preserved {
            ReasonCode::ExternalResultUnknown
        } else {
            refusal.reason()
        };
        sqlx::query(
            "update admission.action_execution
             set dispatch_state = $2, reason_code = $3, updated_at = now()
             where id = $1 and gate_state = 'ALLOWED'",
        )
        .bind(ae.id)
        .bind(state)
        .bind(wire(&reason))
        .execute(&mut *tx)
        .await?;
        record_decision(
            &mut tx,
            &ae.subject(),
            "RECHECK",
            eval.scope,
            eval.authorization,
            if ae.approval_workflow_id.is_some() {
                "SATISFIED"
            } else {
                "NOT_REQUIRED"
            },
            eval.quota,
            eval.zed_token.as_deref(),
            Some(&reason),
        )
        .await?;
        audit(
            &mut tx,
            ae,
            def,
            "rerun:dispatch-aborted",
            "DISPATCH",
            "DENY",
            &wire(&reason),
            None,
            zed_evidence(eval.zed_token.as_deref()),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// DD-84 的控制动作走与普通 Action 相同的准入、决定和审计；派发前再做
    /// fresh Check 与原 Workflow 的 Temporal OPEN 观察。DISPATCHED 仅表示取消
    /// 请求被接受，不改写原 ActionExecution/WorkflowRef/TaskProjection。
    async fn dispatch_cancel(&self, ae_id: Uuid, def: &Definition) -> Result<(), Refusal> {
        let Some(initial) = load_execution(&self.pool, ae_id).await? else {
            return Ok(());
        };
        if initial.gate_state != "ALLOWED"
            || !matches!(
                initial.dispatch_state.as_str(),
                "NOT_DISPATCHED" | "UNKNOWN"
            )
        {
            return Ok(());
        }
        if let Some(first_run_id) = initial.cancel_first_run_id.as_deref() {
            let mut conn = self.pool.acquire().await?;
            let (original, _) = control_original(
                &mut conn,
                initial.tenant_id,
                initial.initiator_principal_id,
                def,
                Semantic::TaskCancel,
                initial.target_id,
                false,
            )
            .await?;
            let workflow_id = original
                .temporal_workflow_id
                .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
            drop(conn);
            match self
                .temporal
                .cancel_request_recorded(&workflow_id, first_run_id, ae_id)
                .await
            {
                Ok(true) => {
                    return self
                        .settle_cancel(
                            ae_id,
                            def,
                            first_run_id,
                            &workflow_id,
                            None,
                            CancelReceipt::History,
                        )
                        .await;
                }
                Ok(false) => {}
                Err(e) => {
                    // History 缺页或不可达不证明请求未发出；若原执行仍 OPEN，
                    // 同一控制 ID 的 RPC 仍可幂等重发，最终判定仍靠查询。
                    tracing::warn!(action = %ae_id, error = %e, "取消 history 尚不可判定");
                }
            }
        }
        let actor = Actor {
            tenant_id: initial.tenant_id,
            principal_id: initial.initiator_principal_id,
            human_identity_id: None,
        };
        let target = Target {
            id: initial.target_id,
            version: initial
                .frozen_target_version()
                .ok_or_else(|| Refusal::Unavailable("控制动作缺原定义版本".into()))?,
            workspace_id: initial.workspace_id,
        };
        let eval = self.evaluate(actor, def, &target).await?;
        let mut tx = self.pool.begin().await?;
        let ae = lock_execution(&mut tx, ae_id).await?;
        if ae.gate_state != "ALLOWED"
            || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
        {
            return Ok(());
        }
        if ae.target_id != target.id
            || ae.workspace_id != target.workspace_id
            || ae.frozen_target_version() != Some(target.version)
        {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        let params = ae
            .params()
            .ok_or_else(|| Refusal::Unavailable("控制动作缺规范化参数".into()))?;
        let mut reason = eval.reason.clone();
        let mut dispatch_target: Option<(String, String, String)> = None;
        let state = if !eval.allowed {
            if ae.cancel_first_run_id.is_some() {
                reason = Some(ReasonCode::ExternalResultUnknown);
                "UNKNOWN"
            } else {
                "ABORTED"
            }
        } else {
            let current = resolve_target(
                &mut tx,
                ae.tenant_id,
                ae.initiator_principal_id,
                def,
                Semantic::TaskCancel,
                &params,
                Some(ae.target_id),
                true,
            )
            .await;
            let checked = match current {
                Ok(current)
                    if current == target
                        && parameter_hash(def, current.id, &params) == ae.parameter_hash =>
                {
                    self.cancel_target(
                        &mut tx,
                        ae.tenant_id,
                        ae.initiator_principal_id,
                        def,
                        &params,
                    )
                    .await
                }
                Ok(_) => Err(Refusal::Conflict(ReasonCode::TargetStateConflict)),
                Err(e) => Err(e),
            };
            match checked {
                Ok((workflow_id, run_id, first_run_id)) => {
                    if let Some(frozen) = ae.cancel_first_run_id.as_deref() {
                        if frozen != first_run_id {
                            reason = Some(ReasonCode::ExternalResultUnknown);
                            "UNKNOWN"
                        } else {
                            dispatch_target = Some((workflow_id, run_id, first_run_id));
                            "UNKNOWN"
                        }
                    } else if ae.dispatch_state == "NOT_DISPATCHED" {
                        dispatch_target = Some((workflow_id, run_id, first_run_id));
                        "UNKNOWN"
                    } else {
                        reason = Some(ReasonCode::ExternalResultUnknown);
                        "UNKNOWN"
                    }
                }
                Err(Refusal::Unavailable(e)) => return Err(Refusal::Unavailable(e)),
                Err(e) if ae.dispatch_state == "UNKNOWN" => {
                    // 前一次 RPC 已有不明副作用，原任务随后关闭不证明取消请求
                    // 成功或失败。保留 UNKNOWN；绝不能伪造一个干净的 ABORTED。
                    tracing::warn!(action = %ae.id, error = ?e, "取消请求结果仍不可判定");
                    reason = Some(ReasonCode::ExternalResultUnknown);
                    "UNKNOWN"
                }
                Err(e) => {
                    reason = Some(e.reason());
                    "ABORTED"
                }
            }
        };
        if let Some((_, _, first_run_id)) = dispatch_target.as_ref() {
            if ae.cancel_first_run_id.is_none() {
                // 外部 RPC 之前提交冻结的链 ID 与 UNKNOWN 意图。进程在 RPC
                // 与响应落库之间崩溃时，对账仍能按该链和同一控制 ID 查 history。
                sqlx::query(
                    "update admission.action_execution
                     set cancel_first_run_id = $2, dispatch_state = 'UNKNOWN',
                         reason_code = $3, updated_at = now()
                     where id = $1 and gate_state = 'ALLOWED'
                       and dispatch_state = 'NOT_DISPATCHED' and cancel_first_run_id is null",
                )
                .bind(ae.id)
                .bind(first_run_id)
                .bind(wire(&ReasonCode::ExternalResultUnknown))
                .execute(&mut *tx)
                .await?;
            }
        }
        record_decision(
            &mut tx,
            &ae.subject(),
            "RECHECK",
            eval.scope,
            eval.authorization,
            "NOT_REQUIRED",
            eval.quota,
            eval.zed_token.as_deref(),
            reason.as_ref(),
        )
        .await?;
        let updated = if dispatch_target.is_some() {
            // 首次冻结已把状态写成 UNKNOWN；已有意图也不在 RPC 前再次改写。
            0
        } else {
            sqlx::query(
                "update admission.action_execution
                 set dispatch_state = $2, reason_code = $3, updated_at = now()
                 where id = $1 and gate_state = 'ALLOWED'
                   and dispatch_state in ('NOT_DISPATCHED','UNKNOWN')",
            )
            .bind(ae.id)
            .bind(state)
            .bind(reason.as_ref().map(wire))
            .execute(&mut *tx)
            .await?
            .rows_affected()
        };
        if updated > 0 || dispatch_target.is_some() {
            let mut evidence = zed_evidence(eval.zed_token.as_deref());
            evidence.push(Evidence::new(
                EvidenceKind::OriginalActionExecutionId,
                ae.target_id,
            ));
            if let Some((workflow_id, run_id, first_run_id)) = dispatch_target.as_ref() {
                evidence.push(Evidence::new(EvidenceKind::TemporalWorkflowId, workflow_id));
                evidence.push(Evidence::new(EvidenceKind::TemporalRunId, run_id));
                evidence.push(Evidence::new(
                    EvidenceKind::TemporalFirstRunId,
                    first_run_id,
                ));
            }
            let (stage, decision, result) = if dispatch_target.is_some() {
                ("cancel:intent", "ALLOW", "CANCEL_REQUEST_PENDING")
            } else {
                match state {
                    "UNKNOWN" => (
                        "cancel:dispatch-unknown",
                        "ALLOW",
                        "DISPATCH_RESULT_UNKNOWN",
                    ),
                    _ => ("cancel:dispatch-aborted", "DENY", "DISPATCH_ABORTED"),
                }
            };
            audit(
                &mut tx,
                &ae,
                def,
                stage,
                "DISPATCH",
                decision,
                reason.as_ref().map(wire).as_deref().unwrap_or(result),
                None,
                evidence,
            )
            .await?;
        }
        tx.commit().await?;
        if let Some((workflow_id, run_id, first_run_id)) = dispatch_target {
            let receipt = match self
                .temporal
                .request_cancel(&workflow_id, &first_run_id, ae_id)
                .await
            {
                Ok(()) => match self
                    .temporal
                    .cancel_request_recorded(&workflow_id, &first_run_id, ae_id)
                    .await
                {
                    Ok(true) => CancelReceipt::RpcAccepted,
                    Ok(false) => CancelReceipt::RpcUnknown,
                    Err(e) => {
                        tracing::warn!(action = %ae_id, error = %e, "取消 RPC 已返回但 history 尚不可判定");
                        CancelReceipt::RpcUnknown
                    }
                },
                Err(e) => {
                    // 冻结意图已经提交；即使这次 RPC 给出确定拒绝，也不能
                    // 排除较早一次同 ID 的请求已经生效，只能保留 UNKNOWN。
                    tracing::warn!(action = %ae_id, error = %e, "取消请求尚不可判定");
                    CancelReceipt::RpcUnknown
                }
            };
            self.settle_cancel(
                ae_id,
                def,
                &first_run_id,
                &workflow_id,
                Some(&run_id),
                receipt,
            )
            .await?;
        }
        Ok(())
    }

    async fn settle_cancel(
        &self,
        ae_id: Uuid,
        def: &Definition,
        first_run_id: &str,
        workflow_id: &str,
        observed_run_id: Option<&str>,
        receipt: CancelReceipt,
    ) -> Result<(), Refusal> {
        let mut tx = self.pool.begin().await?;
        let ae = lock_execution(&mut tx, ae_id).await?;
        if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
            return Ok(());
        }
        if ae.cancel_first_run_id.as_deref() != Some(first_run_id) {
            return Err(Refusal::Unavailable(
                "取消请求的首次 run ID 与冻结意图不一致".into(),
            ));
        }
        let accepted = !matches!(receipt, CancelReceipt::RpcUnknown);
        let state = if accepted { "DISPATCHED" } else { "UNKNOWN" };
        let reason = if accepted {
            None
        } else {
            Some(wire(&ReasonCode::ExternalResultUnknown))
        };
        sqlx::query(
            "update admission.action_execution
             set dispatch_state = $2, reason_code = $3, updated_at = now()
             where id = $1 and gate_state = 'ALLOWED' and dispatch_state = 'UNKNOWN'",
        )
        .bind(ae_id)
        .bind(state)
        .bind(&reason)
        .execute(&mut *tx)
        .await?;
        let mut evidence = zed_evidence(None);
        evidence.push(Evidence::new(
            EvidenceKind::OriginalActionExecutionId,
            ae.target_id,
        ));
        evidence.push(Evidence::new(EvidenceKind::TemporalWorkflowId, workflow_id));
        evidence.push(Evidence::new(
            EvidenceKind::TemporalFirstRunId,
            first_run_id,
        ));
        if let Some(run_id) = observed_run_id {
            evidence.push(Evidence::new(EvidenceKind::TemporalRunId, run_id));
        }
        let (stage, event_type) = match receipt {
            CancelReceipt::History => ("cancel:history-reconciled", "RECONCILIATION"),
            CancelReceipt::RpcAccepted => ("cancel:dispatch", "DISPATCH"),
            CancelReceipt::RpcUnknown => ("cancel:dispatch-unknown", "DISPATCH"),
        };
        audit(
            &mut tx,
            &ae,
            def,
            stage,
            event_type,
            "ALLOW",
            if accepted {
                "CANCEL_REQUEST_ACCEPTED"
            } else {
                "DISPATCH_RESULT_UNKNOWN"
            },
            None,
            evidence,
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// 以预写的 workflow ID 启动既有生命周期 Workflow。幂等：WorkflowRef 已在运行
    /// 或已终结即记 DISPATCHED，不再 Start；Start 结果不明记 UNKNOWN，由同一路径
    /// 以同一 ID 收敛，不换 ID（DD-48）。
    pub async fn dispatch(&self, ae_id: Uuid) {
        if let Err(e) = self.dispatch_inner(ae_id).await {
            tracing::warn!(action = %ae_id, error = ?e, "派发未完成，留给对账作业");
        }
    }

    async fn dispatch_inner(&self, ae_id: Uuid) -> Result<(), Refusal> {
        let Some(ae) = load_execution(&self.pool, ae_id).await? else {
            return Ok(());
        };
        if ae.gate_state != "ALLOWED"
            || ae.dispatch_state == "DISPATCHED"
            || ae.dispatch_state == "ABORTED"
        {
            return Ok(());
        }
        if crate::application_action::is_human(&ae) {
            return crate::application_action::start(self, &ae).await;
        }
        let def = exact_definition_for_execution(&self.pool, &ae).await?;
        let Some(sem) = Semantic::from_key(&def.action_key) else {
            return Ok(());
        };
        if sem == Semantic::TaskCancel {
            return self.dispatch_cancel(ae_id, &def).await;
        }
        if sem == Semantic::TaskRerun {
            return self.dispatch_rerun(ae_id, &def).await;
        }
        if sem.tenant_segment().is_some() {
            return self.dispatch_tenant_lifecycle(&ae, &def, sem).await;
        }
        if def.execution_mode == "SYNC" {
            // 在准入事务里已完成的同步动作没有可派发的东西；走到这里只可能是角色
            return if sem.is_capability_contract() {
                // Catalog writes and their OUTCOME commit in the admission transaction.
                // A pending legacy row has no safe external dispatch/replay path.
                Err(Refusal::Unavailable(
                    "Catalog admission outcome unavailable".into(),
                ))
            } else if sem.is_installation_permission() {
                installation_permission::dispatch(
                    self,
                    ae_id,
                    &def,
                    installation_permission::is_grant(&def.action_key),
                )
                .await
            } else if sem == Semantic::AgentVersionCreate {
                crate::agent_version::dispatch(self, ae_id, &def).await
            } else if sem == Semantic::LlmRouteCreate {
                crate::model_route::create_dispatch(self, ae_id, &def).await
            } else if sem.is_automation() {
                crate::automation::management_dispatch(self, ae_id, &def, sem).await
            } else if matches!(
                sem,
                Semantic::AgentDefinitionCreate | Semantic::ResourceTransferOwner
            ) {
                crate::agent_definition::dispatch(self, ae_id, &def, sem).await
            } else if sem.is_role() {
                self.dispatch_role(ae_id, &def, sem).await
            } else {
                Ok(())
            };
        }
        let Some(workflow_id) = ae.temporal_workflow_id.clone() else {
            return Err(Refusal::Unavailable(
                "ALLOWED 而没有预写 workflow ID".into(),
            ));
        };
        let ref_state: Option<String> = sqlx::query_scalar(
            "select projection_state from projection.workflow_ref where workflow_id = $1",
        )
        .bind(&workflow_id)
        .fetch_optional(&self.pool)
        .await?;
        let outcome = if matches!(ref_state.as_deref(), Some("RUNNING" | "TERMINAL")) {
            Ok(())
        } else {
            let started = match sem {
                Semantic::ConversationOpen => crate::conversations::start(&self.pool,&self.temporal,ae.id,ae.tenant_id,&workflow_id).await,
                Semantic::ResourceCreate => crate::resource_provision::start(&self.pool,&self.temporal,ae.id,ae.tenant_id,&workflow_id).await,
                Semantic::ApplicationBindingCreate | Semantic::ApplicationBindingDisable => {
                    crate::application_binding::start(&self.pool, &self.temporal, ae.id, ae.tenant_id, &workflow_id).await
                }
                Semantic::ComponentReleaseRegister => {
                    crate::component_release::start(&self.pool, &self.temporal, ae.id, ae.tenant_id, &workflow_id).await
                }
                Semantic::ComponentReleaseApprove => {
                    crate::component_release::approval::start(&self.pool, &self.temporal, ae.id, ae.tenant_id, &workflow_id).await
                }
                Semantic::AgentInstallationCreate | Semantic::AgentInstallationUpgrade => {
                    crate::agent_installation::start(
                        &self.pool, &self.temporal, ae.id, ae.tenant_id, &workflow_id,
                    ).await
                }
                Semantic::TenantDelete => launch_scope(
                    &self.pool, &self.temporal,
                    &ScopeLifecycleRequest { kind: ScopeKind::Tenant, id: ae.target_id,
                        action_execution_id: ae.id, operation: ScopeOperation::Delete },
                ).await,
                Semantic::WorkspaceCreate
                | Semantic::WorkspaceSuspend
                | Semantic::WorkspaceRestore => {
                    launch_scope(
                        &self.pool,
                        &self.temporal,
                        &ScopeLifecycleRequest {
                            kind: ScopeKind::Workspace,
                            id: ae.target_id,
                            action_execution_id: ae.id,
                            operation: sem
                                .workspace_segment()
                                .map_or(ScopeOperation::Provision, |(_, _, op)| op),
                        },
                    )
                    .await
                }
                Semantic::WorkspaceMemberAdd
                | Semantic::WorkspaceJoin
                | Semantic::WorkspaceMemberRevoke
                | Semantic::TenantMemberRevoke
                | Semantic::TenantMemberAdmit => {
                    launch_membership(
                        &self.pool,
                        &self.temporal,
                        &LifecycleRequest {
                            scope: if matches!(
                                sem,
                                Semantic::TenantMemberRevoke | Semantic::TenantMemberAdmit
                            ) {
                                MembershipScope::Tenant
                            } else {
                                MembershipScope::Workspace
                            },
                            membership_id: ae.target_id,
                            action_execution_id: ae.id,
                        },
                    )
                    .await
                }
                Semantic::SecretRefRehome => {
                    crate::secret_ref_rehome::start(
                        &self.pool,
                        &self.temporal,
                        ae.id,
                        ae.tenant_id,
                        &workflow_id,
                    )
                    .await
                }
                // 角色与邀请动作是 SYNC，在上面已分流；没有 Workflow 可启动
                Semantic::TenantRoleGrant
                | Semantic::TenantRoleRevoke
                | Semantic::WorkspaceRoleGrant
                | Semantic::WorkspaceRoleRevoke
                | Semantic::TenantMemberInvite
                | Semantic::TenantMemberInviteRevoke
                | Semantic::TaskCancel
                | Semantic::TaskRerun
                | Semantic::AgentDefinitionCreate
                | Semantic::CapabilityContractRegister
                | Semantic::CapabilityContractApprove
                | Semantic::CapabilityContractDeprecate
                | Semantic::LlmRouteCreate
                | Semantic::AgentDefinitionUpdate
                | Semantic::ResourceTransferOwner
                | Semantic::AgentVersionCreate | Semantic::AgentVersionUpdate | Semantic::AgentVersionPublish | Semantic::AgentVersionRetire
                | Semantic::AutomationCreate | Semantic::AutomationPublish | Semantic::AutomationEnable
                | Semantic::AutomationPause | Semantic::AutomationDisable | Semantic::AutomationRotateWebhookSecret
                | Semantic::AutomationDelete
                | Semantic::AgentDelegationGrant | Semantic::AgentDelegationRevoke
                | Semantic::AgentInstallationExecuteGrant | Semantic::AgentInstallationExecuteRevoke
                | Semantic::ResourceGrantRead | Semantic::ResourceRevokeRead
                // 业务 Tenant 生命周期由 dispatch_tenant_lifecycle 派发
                | Semantic::TenantSuspend
                | Semantic::TenantRestore => Err(StatusCode::CONFLICT.into_response()),
            };
            match started {
                Ok(r) if r.workflow_id == workflow_id => Ok(()),
                Ok(r) => {
                    // 启动核心按实体当前版本算 ID；与预写的不同说明实体在派发前又被
                    // 推进过。那条 Workflow 不属于本动作，不记成已派发
                    tracing::error!(expected = %workflow_id, got = %r.workflow_id, "派发的 workflow ID 与预写的不一致");
                    Err(StatusCode::CONFLICT)
                }
                Err(resp) => Err(resp.status()),
            }
        };
        // 结果不明只可能用同一 ID 收敛；确定的拒绝（被 Temporal 拒绝、实体已不在
        // 可启动状态）中止本次派发
        let mut tx = self.pool.begin().await?;
        let recorded =
            record_dispatch(&mut tx, ae.id, def.audit_class(), outcome, Vec::new()).await?;
        // Workspace 生命周期段不会再有 Workflow 把它带出 SUSPENDING/RESTORING：与
        // 中止同事务置 ERROR（version+1），留下确定状态，管理员可从 ERROR 重新暂停
        if recorded.settled && recorded.outcome == Dispatch::Aborted {
            if let Some((_, converging, _)) = sem.workspace_segment() {
                sqlx::query(
                    "update identity.workspace set state = 'ERROR', version = version + 1
                     where id = $1 and tenant_id = $2 and state = $3",
                )
                .bind(ae.target_id)
                .bind(ae.tenant_id)
                .bind(converging)
                .execute(&mut *tx)
                .await?;
            }
        }
        tx.commit().await?;
        if recorded.outcome == Dispatch::Dispatched && ae.approval_workflow_id.is_some() {
            self.consume(ae.id).await;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

impl Governance {
    pub(crate) async fn request_approval(
        &self,
        actor: Actor,
        ae: &Execution,
        def: &Definition,
        eval: &Evaluation,
    ) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
        let op = Some(ae.operation_id);
        let (Some(pid), Some(pver)) = (def.approval_policy_id, def.approval_policy_version) else {
            return Err((Refusal::Unavailable("APPROVAL 定义缺策略".into()), op));
        };
        let policy = exact_policy(&self.pool, pid, pver)
            .await
            .map_err(|r| (r, op))?;
        // 选择器与 owner 要求必须在本 target 上可解析，否则请求不启动（.design/03 §6、
        // .design/10 §2）：RESOURCE_APPROVER 需要 Resource 目标，WORKSPACE_ADMIN 需要
        // 冻结 Workspace；APPLICATION 读取实际 target owner。不换用更宽的角色。
        let deletion = def.action_key == "tenant.delete";
        let installation_owner = installation_permission::owner_policy(&ae.action_key, &policy);
        let application = crate::application_catalog::approval::is_application(&self.pool, ae)
            .await
            .map_err(|e| (e, op))?;
        let resolvable = if application {
            crate::application_catalog::approval::resolvable(def, &policy, ae.workspace_id)
        } else {
            (policy.owner_requirement == "NONE"
                || installation_owner
                || (deletion && policy.owner_requirement == "ALL_AFFECTED_OWNERS"))
                && policy.role_requirements.iter().all(|r| match r.selector {
                    ApprovalSelector::TenantAdmin => true,
                    ApprovalSelector::WorkspaceAdmin => ae.workspace_id.is_some(),
                    ApprovalSelector::ResourceApprover => false,
                })
        };
        if !resolvable {
            let reason = ReasonCode::ApprovalSelectorUnresolvable;
            self.close_gate(
                ae,
                def,
                "ADMISSION",
                "DENIED",
                eval,
                &reason,
                actor.human_identity_id,
            )
            .await
            .map_err(|e| (e.into(), op))?;
            return Err((Refusal::Precondition(reason), op));
        }

        let mut application_evaluation = None;
        if application {
            let mut fresh = if def.execution_mode == "PROTOCOL" {
                crate::protocol_session::fresh_for_governance(self, ae)
                    .await
                    .map(|(evaluation, _)| evaluation)
            } else {
                crate::application_tool::fresh_execution(self, ae).await
            }
            .map_err(|e| (e, op))?;
            self.check_quota(ae.tenant_id, def, &mut fresh)
                .await
                .map_err(|e| (e, op))?;
            if !fresh.allowed {
                let reason = fresh.reason.clone().unwrap_or(ReasonCode::PermissionDenied);
                self.close_gate(
                    ae,
                    def,
                    "ADMISSION",
                    "DENIED",
                    &fresh,
                    &reason,
                    actor.human_identity_id,
                )
                .await
                .map_err(|e| (e.into(), op))?;
                return Err((Refusal::Denied(reason), op));
            }
            application_evaluation = Some(fresh);
        }

        let workflow_id = approval_workflow_id(ae.tenant_id, ae.id);
        let mut tx = self.pool.begin().await.map_err(|e| (e.into(), op))?;
        if application {
            crate::application_catalog::approval::lock_parent(&mut tx, ae)
                .await
                .map_err(|e| (e, op))?;
            if !crate::roles::lock_tenant(&mut tx, ae.tenant_id)
                .await
                .map_err(|e| (e.into(), op))?
            {
                return Err((Refusal::Conflict(ReasonCode::ApprovalInvalidated), op));
            }
        }
        let locked = lock_execution(&mut tx, ae.id)
            .await
            .map_err(|e| (e.into(), op))?;
        if locked.gate_state != "EVALUATING" {
            drop(tx);
            return submission_result(&locked);
        }
        let mut deletion_refs = Vec::new();
        let mut locked_evaluation = application_evaluation;
        if application {
            crate::application_catalog::approval::freeze(self, &mut tx, &locked, def)
                .await
                .map_err(|e| (e, op))?;
        }
        if installation_owner {
            if !crate::roles::lock_tenant(&mut tx, ae.tenant_id)
                .await
                .map_err(|e| (e.into(), op))?
            {
                return Err((Refusal::Conflict(ReasonCode::TargetStateConflict), op));
            }
            let owner = installation_permission::owner_ref(self, &mut tx, ae)
                .await
                .map_err(|e| (e, op))?;
            if Some(owner.target_version) != ae.frozen_target_version().map(i64::from) {
                return Err((Refusal::Conflict(ReasonCode::TargetStateConflict), op));
            }
            let params = ae
                .params()
                .ok_or((Refusal::Precondition(ReasonCode::InvalidParameters), op))?;
            installation_permission::gate(
                self,
                &mut tx,
                ae.tenant_id,
                ae.initiator_principal_id,
                &params,
                &ae.action_key,
            )
            .await
            .map_err(|e| (e, op))?;
            sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,'{permissionApprovalOwner}',$2)
                where id=$1 and not (parameters ? 'permissionApprovalOwner')")
                .bind(ae.id).bind(serde_json::to_value(&owner).map_err(|e| (Refusal::Unavailable(e.to_string()), op))?)
                .execute(&mut *tx).await.map_err(|e| (e.into(), op))?;
            let frozen = lock_execution(&mut tx, ae.id)
                .await
                .map_err(|e| (e.into(), op))?;
            if installation_permission::frozen_owner(&frozen).map_err(|e| (e, op))? != owner {
                return Err((Refusal::Conflict(ReasonCode::TargetStateConflict), op));
            }
        }
        if deletion {
            if policy.owner_requirement != "ALL_AFFECTED_OWNERS"
                || policy.self_approval != "ALLOW"
                || policy.role_requirements.len() != 1
                || policy.role_requirements[0].selector != ApprovalSelector::TenantAdmin
                || policy.role_requirements[0].min_distinct != 1
            {
                return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), op));
            }
            let version: Option<i32> = sqlx::query_scalar(
                "select version from identity.tenant where id = $1 and state = 'SUSPENDED' for update",
            ).bind(ae.tenant_id).fetch_optional(&mut *tx).await.map_err(|e| (e.into(), op))?;
            let Some(version) = version.filter(|v| Some(*v) == ae.frozen_target_version()) else {
                return Err((Refusal::Conflict(ReasonCode::TargetStateConflict), op));
            };
            let fresh = self
                .evaluate(
                    actor,
                    def,
                    &Target {
                        id: ae.target_id,
                        version,
                        workspace_id: None,
                    },
                )
                .await
                .map_err(|e| (e, op))?;
            if !fresh.allowed {
                return Err((
                    Refusal::Denied(fresh.reason.unwrap_or(ReasonCode::PermissionDenied)),
                    op,
                ));
            }
            locked_evaluation = Some(fresh);
            let params = ae
                .params()
                .ok_or((Refusal::Precondition(ReasonCode::InvalidParameters), op))?;
            self.target_gate(
                &mut tx,
                ae.tenant_id,
                ae.initiator_principal_id,
                def,
                Semantic::TenantDelete,
                &params,
            )
            .await
            .map_err(|e| (e, op))?;
            let inventory = frozen_delete_inventory(&mut tx, ae.tenant_id, version)
                .await
                .map_err(|e| (e, op))?;
            let mut owner_refs: Vec<contracts::AffectedOwnerRef> =
                serde_json::from_value(inventory["resource_owner_versions"].clone())
                    .map_err(|e| (Refusal::Unavailable(e.to_string()), op))?;
            owner_refs.extend(
                serde_json::from_value::<Vec<contracts::AffectedOwnerRef>>(
                    inventory["asset_owner_versions"].clone(),
                )
                .map_err(|e| (Refusal::Unavailable(e.to_string()), op))?,
            );
            if !crate::agent_definition::validate_frozen_owners(
                self,
                &mut tx,
                ae.tenant_id,
                &owner_refs,
            )
            .await
            .map_err(|e| (e, op))?
            {
                return Err((Refusal::Conflict(ReasonCode::TargetStateConflict), op));
            }
            let digest = hex::encode(Sha256::digest(inventory.to_string().as_bytes()));
            let snapshot_id = Uuid::new_v4();
            let subprocess_id = Uuid::new_v4();
            sqlx::query(
                "insert into admission.tenant_lifecycle_snapshot
                 (id,tenant_id,action_execution_id,tenant_version,resource_owner_versions,asset_owner_versions,
                  component_binding_refs_and_versions,inventory_digest,frozen_inventory,state)
                 values ($1,$2,$3,$4,$7,$8,'[]',$5,$6,'SUSPENDED')",
            ).bind(snapshot_id).bind(ae.tenant_id).bind(ae.id).bind(version).bind(digest)
                .bind(&inventory).bind(&inventory["resource_owner_versions"])
                .bind(&inventory["asset_owner_versions"])
                .execute(&mut *tx).await.map_err(|e| (e.into(), op))?;
            sqlx::query(
                "insert into admission.tenant_delete_subprocess
                 (id,tenant_lifecycle_snapshot_id,tenant_id,subject,mode,state)
                 values ($1,$2,$3,'PLATFORM_CORE','PLATFORM_CORE_CHAIN','PENDING')",
            )
            .bind(subprocess_id)
            .bind(snapshot_id)
            .bind(ae.tenant_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| (e.into(), op))?;
            deletion_refs.push(Evidence::new(
                EvidenceKind::TenantLifecycleSnapshotId,
                snapshot_id,
            ));
            deletion_refs.push(Evidence::new(
                EvidenceKind::TenantDeleteSubprocessId,
                subprocess_id,
            ));
        }
        let eval = locked_evaluation.as_ref().unwrap_or(eval);
        sqlx::query(
            "update admission.action_execution
             set gate_state = 'WAITING', approval_workflow_id = $2,
                 approval_expires_at = date_trunc('second', now()) + make_interval(secs => $3::bigint),
                 reason_code = $4, updated_at = now()
             where id = $1",
        )
        .bind(ae.id)
        .bind(&workflow_id)
        .bind(i64::from(policy.expires_in_seconds))
        .bind(wire(&ReasonCode::WaitingApproval))
        .execute(&mut *tx)
        .await
        .map_err(|e| (e.into(), op))?;
        sqlx::query(
            "insert into projection.workflow_ref
                 (workflow_id, workflow_type, workflow_version, kind, tenant_id,
                  operation_id, action_execution_id, projection_state)
             values ($1, $2, 1, null, $3, $4, $5, 'PENDING_START')",
        )
        .bind(&workflow_id)
        .bind(APPROVAL_WORKFLOW_TYPE)
        .bind(ae.tenant_id)
        .bind(ae.operation_id)
        .bind(ae.id)
        .execute(&mut *tx)
        .await
        .map_err(|e| (e.into(), op))?;
        record_decision(
            &mut tx,
            &ae.subject(),
            "ADMISSION",
            eval.scope,
            eval.authorization,
            "REQUIRED",
            eval.quota,
            eval.zed_token.as_deref(),
            Some(&ReasonCode::WaitingApproval),
        )
        .await
        .map_err(|e| (e.into(), op))?;
        let mut evidence = zed_evidence(eval.zed_token.as_deref());
        evidence.extend(deletion_refs);
        evidence.push(Evidence::new(EvidenceKind::ApprovalWorkflowId, workflow_id));
        evidence.push(Evidence::versioned(
            EvidenceKind::ApprovalPolicy,
            policy.id,
            i64::from(policy.version),
        ));
        audit(
            &mut tx,
            ae,
            def,
            "admission:decision",
            "DECISION",
            "ALLOW",
            &wire(&ReasonCode::WaitingApproval),
            actor.human_identity_id,
            evidence,
        )
        .await
        .map_err(|e| (e.into(), op))?;
        tx.commit().await.map_err(|e| (e.into(), op))?;

        self.ensure_approval_started(ae.id).await;
        let ae = load_execution(&self.pool, ae.id)
            .await
            .map_err(|e| (e.into(), op))?
            .ok_or((Refusal::Unavailable("ActionExecution 消失".into()), op))?;
        submission_result(&ae)
    }

    /// 冻结的 Workflow input。按同一 ID 重新 Start 时它必须逐字相同，因此全部取自
    /// 已持久化的事实（确切版本的定义与策略、冻结的过期时刻），不取「当前」。
    pub(crate) async fn approval_input(
        &self,
        ae: &Execution,
    ) -> Result<ApprovalWorkflowInput, Refusal> {
        let def = exact_definition_for_execution(&self.pool, ae).await?;
        let policy = self.effective_approval_policy(ae, &def).await?;
        let expires = ae
            .approval_expires_at
            .ok_or_else(|| Refusal::Unavailable("WAITING 缺冻结的过期时刻".into()))?;
        let affected_owner_refs: Vec<contracts::AffectedOwnerRefElement> =
            if crate::automation::step_approval::is_child(ae) {
                crate::automation::step_approval::owners(ae)?
                    .into_iter()
                    .map(|owner| contracts::AffectedOwnerRefElement {
                        target_type: owner.target_type,
                        target_id: owner.target_id,
                        target_version: owner.target_version,
                        owner_principal_id: owner.owner_principal_id,
                    })
                    .collect()
            } else if policy.owner_requirement == "ALL_AFFECTED_OWNERS" {
                let refs: Value = sqlx::query_scalar(
                "select resource_owner_versions || asset_owner_versions from admission.tenant_lifecycle_snapshot
                where action_execution_id=$1 and tenant_id=$2",
            )
            .bind(ae.id)
            .bind(ae.tenant_id)
            .fetch_one(&self.pool)
            .await?;
                serde_json::from_value(refs).map_err(|e| Refusal::Unavailable(e.to_string()))?
            } else if installation_permission::owner_policy(&ae.action_key, &policy) {
                let owner = installation_permission::frozen_owner(ae)?;
                vec![contracts::AffectedOwnerRefElement {
                    target_type: owner.target_type,
                    target_id: owner.target_id,
                    target_version: owner.target_version,
                    owner_principal_id: owner.owner_principal_id,
                }]
            } else if crate::application_catalog::approval::is_application(&self.pool, ae).await?
                && policy.owner_requirement == "TARGET_OWNER"
            {
                let owner = crate::application_catalog::approval::frozen_owners(ae, &def)?
                    .into_iter()
                    .next()
                    .ok_or_else(|| {
                        Refusal::Unavailable("APPLICATION target owner unavailable".into())
                    })?;
                vec![contracts::AffectedOwnerRefElement {
                    target_type: owner.target_type,
                    target_id: owner.target_id,
                    target_version: owner.target_version,
                    owner_principal_id: owner.owner_principal_id,
                }]
            } else {
                Vec::new()
            };
        Ok(ApprovalWorkflowInput {
            action_execution_id: ae.id.to_string(),
            operation_id: ae.operation_id.to_string(),
            tenant_id: ae.tenant_id.to_string(),
            workspace_id: ae.workspace_id.map(|w| w.to_string()),
            action_key: ae.action_key.clone(),
            action_definition_version: i64::from(ae.action_version),
            target_type: def.target_type.clone(),
            target_id: ae.target_id.to_string(),
            parameter_hash: ae.parameter_hash.clone(),
            policy_id: policy.id.to_string(),
            policy_version: i64::from(policy.version),
            role_requirements: policy
                .role_requirements
                .iter()
                .map(|r| contracts::RoleRequirementElement {
                    selector: r.selector.clone(),
                    min_distinct: r.min_distinct,
                })
                .collect(),
            owner_requirement: parse(&policy.owner_requirement)
                .ok_or_else(|| Refusal::Unavailable("owner_requirement 不在契约内".into()))?,
            affected_owner_refs,
            self_approval: parse(&policy.self_approval)
                .ok_or_else(|| Refusal::Unavailable("self_approval 不在契约内".into()))?,
            initiator_principal_id: ae.initiator_principal_id.to_string(),
            expires_at: rfc3339(expires),
            consume_window_seconds: self.cfg.consume_window_seconds,
            // 续跑状态只由 Workflow 自己在 continue-as-new 时写入；Core 启动的永远是
            // 首个 run，按同一 ID 重新 Start 的 input 因此逐字不变
            resume: None,
        })
    }

    /// 以预写的审批 workflow ID 至多一次启动。已在运行、已终结都不再 Start。
    pub async fn ensure_approval_started(&self, ae_id: Uuid) {
        let run = async {
            let Some(ae) = load_execution(&self.pool, ae_id).await? else {
                return Ok::<(), Refusal>(());
            };
            // Step approvals are actual children of the original AgentTask.
            if crate::automation::step_approval::is_child(&ae) {
                return Ok(());
            }
            let Some(wf) = ae.approval_workflow_id.clone() else {
                return Ok(());
            };
            let state: Option<String> = sqlx::query_scalar(
                "select projection_state from projection.workflow_ref where workflow_id = $1",
            )
            .bind(&wf)
            .fetch_optional(&self.pool)
            .await?;
            if state.as_deref() != Some("PENDING_START") {
                return Ok(());
            }
            let input = self.approval_input(&ae).await?;
            component_task::start_typed(
                &self.pool,
                &self.temporal,
                Launch {
                    workflow_id: &wf,
                    workflow_type: APPROVAL_WORKFLOW_TYPE,
                    kind: None,
                    tenant_id: ae.tenant_id,
                    action_execution_id: ae.id,
                },
                &input,
            )
            .await
            .map_err(|r| Refusal::Unavailable(format!("审批 Start 未确认: HTTP {}", r.status())))?;
            Ok(())
        };
        if let Err(e) = run.await {
            tracing::warn!(action = %ae_id, error = ?e, "审批 Workflow 启动未确认，留给对账作业");
        }
    }

    /// 批准之后：完整重新准入，通过才推进实体并派发，派发成功后 consume；
    /// 不通过则门禁置 REVOKED 并发 invalidate（.design/06 §4、.design/05 §1）。
    pub async fn after_approval(&self, ae_id: Uuid) {
        if let Err(e) = self.after_approval_inner(ae_id).await {
            tracing::warn!(action = %ae_id, error = ?e, "批准后的重新准入未完成，留给对账作业");
        }
    }

    async fn after_approval_inner(&self, ae_id: Uuid) -> Result<(), Refusal> {
        let Some(ae) = load_execution(&self.pool, ae_id).await? else {
            return Ok(());
        };
        if crate::automation::step_approval::is_child(&ae) {
            return Ok(());
        }
        if ae.gate_state != "WAITING" {
            return Ok(());
        }
        let Some(wf) = ae.approval_workflow_id.clone() else {
            return Ok(());
        };
        // 只认投影里的 APPROVED，并且离 consume_deadline 至少还有余量：投影可能落后
        // 于 Workflow 的 timer，余量不足时不派发，让批准按期失效
        let row: Option<(String, Option<DateTime<Utc>>, bool)> = sqlx::query_as(
            "select status, consume_deadline,
                    consume_deadline > now() + make_interval(secs => $2::bigint)
             from projection.approval_projection where workflow_id = $1",
        )
        .bind(&wf)
        .bind(self.cfg.dispatch_margin_seconds)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some((status, _, true)) if status == "APPROVED" => {}
            Some((status, _, false)) if status == "APPROVED" => {
                tracing::warn!(workflow_id = %wf, "批准距 consume 截止不足余量，不派发");
                return Ok(());
            }
            _ => return Ok(()),
        }
        let def = exact_definition_for_execution(&self.pool, &ae).await?;
        if crate::application_catalog::approval::is_application(&self.pool, &ae).await? {
            return self.after_application_approval(&ae, &def).await;
        }
        let sem = Semantic::from_key(&def.action_key)
            .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
        let params = ae
            .params()
            .ok_or_else(|| Refusal::Unavailable("ActionExecution 缺规范化参数".into()))?;
        let actor = Actor {
            tenant_id: ae.tenant_id,
            principal_id: ae.initiator_principal_id,
            human_identity_id: None,
        };
        let target = Target {
            id: ae.target_id,
            version: ae.frozen_target_version().unwrap_or(0),
            workspace_id: ae.workspace_id,
        };
        // 完整重新准入：scope、发起者仍 active、fresh Check、target 事实未变
        let mut eval = self.evaluate(actor, &def, &target).await?;
        self.check_quota(ae.tenant_id, &def, &mut eval).await?;
        let refused = if !eval.allowed {
            Some(eval.reason.clone().unwrap_or(ReasonCode::PermissionDenied))
        } else {
            let mut tx = self.pool.begin().await?;
            let locked = lock_execution(&mut tx, ae.id).await?;
            if locked.gate_state != "WAITING" {
                return Ok(());
            }
            match self
                .allow_in_tx(
                    &mut tx,
                    &locked,
                    &def,
                    sem,
                    &params,
                    "RECHECK",
                    "SATISFIED",
                    &eval,
                    None,
                )
                .await
            {
                // 需要审批的动作都不在准入事务里签发凭据，没有要带回的东西
                Ok(_) => {
                    tx.commit().await?;
                    None
                }
                Err(Refusal::Unavailable(e)) => return Err(Refusal::Unavailable(e)),
                Err(r) => Some(r.reason()),
            }
        };
        if let Some(reason) = refused {
            self.close_gate(&ae, &def, "RECHECK", "REVOKED", &eval, &reason, None)
                .await?;
            self.invalidate(ae.id).await;
            return Ok(());
        }
        self.dispatch(ae.id).await;
        Ok(())
    }

    // Application approval never replays a Tool body. It opens the original
    // child gate; the same MCP call/hash performs fresh checks before dispatch.
    async fn after_application_approval(
        &self,
        ae: &Execution,
        def: &Definition,
    ) -> Result<(), Refusal> {
        let fresh = if def.execution_mode == "PROTOCOL" {
            crate::protocol_session::fresh_for_governance(self, ae)
                .await
                .map(|(evaluation, _)| evaluation)
        } else {
            crate::application_tool::fresh_execution(self, ae).await
        };
        let mut eval = match fresh {
            Ok(eval) => eval,
            Err(Refusal::Unavailable(error)) => return Err(Refusal::Unavailable(error)),
            Err(refusal) => Evaluation {
                allowed: false,
                scope: "DENY",
                authorization: "DENY",
                quota: "NOT_APPLICABLE",
                zed_token: None,
                reason: Some(refusal.reason()),
            },
        };
        if eval.allowed {
            self.check_quota(ae.tenant_id, def, &mut eval).await?;
        }
        let mut refusal =
            (!eval.allowed).then(|| eval.reason.clone().unwrap_or(ReasonCode::PermissionDenied));
        if eval.allowed {
            let mut tx = self.pool.begin().await?;
            crate::application_catalog::approval::lock_parent(&mut tx, ae).await?;
            if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
                return Err(Refusal::Conflict(ReasonCode::ApprovalInvalidated));
            }
            let locked = lock_execution(&mut tx, ae.id).await?;
            if locked.gate_state != "WAITING" || locked.dispatch_state != "NOT_DISPATCHED" {
                return Ok(());
            }
            match crate::application_catalog::approval::require_consumable(
                self, &mut tx, &locked, def,
            )
            .await
            {
                Ok(()) => {
                    sqlx::query("update admission.action_execution set gate_state='ALLOWED',reason_code=null,updated_at=now()
                        where id=$1 and gate_state='WAITING' and dispatch_state='NOT_DISPATCHED'")
                        .bind(ae.id).execute(&mut *tx).await?;
                    record_decision(
                        &mut tx,
                        &locked.subject(),
                        "RECHECK",
                        eval.scope,
                        eval.authorization,
                        "SATISFIED",
                        eval.quota,
                        eval.zed_token.as_deref(),
                        None,
                    )
                    .await?;
                    audit(
                        &mut tx,
                        &locked,
                        def,
                        "recheck:decision",
                        "DECISION",
                        "ALLOW",
                        "ALLOWED",
                        None,
                        zed_evidence(eval.zed_token.as_deref()),
                    )
                    .await?;
                    tx.commit().await?;
                }
                Err(Refusal::Unavailable(error)) => return Err(Refusal::Unavailable(error)),
                Err(error) => refusal = Some(error.reason()),
            }
        }
        if let Some(reason) = refusal {
            self.close_gate(ae, def, "RECHECK", "REVOKED", &eval, &reason, None)
                .await?;
            self.invalidate(ae.id).await;
        } else if crate::application_action::is_human(ae) {
            let current = load_execution(&self.pool, ae.id).await?.ok_or_else(|| {
                Refusal::Unavailable("original component action unavailable".into())
            })?;
            crate::application_action::start(self, &current).await?;
        }
        Ok(())
    }

    /// 派发成功之后一次性消费批准。Update ID 固定，重复发送拿回同一结果。
    pub async fn consume(&self, ae_id: Uuid) {
        let Ok(Some(ae)) = load_execution(&self.pool, ae_id).await else {
            return;
        };
        let Some(wf) = ae.approval_workflow_id.clone() else {
            return;
        };
        if ae.gate_state != "ALLOWED" || ae.dispatch_state != "DISPATCHED" {
            return;
        }
        match self
            .temporal
            .update(
                &wf,
                &format!("{}:consume", ae.id),
                "consume",
                None,
                self.cfg.update_wait,
            )
            .await
        {
            Ok(UpdateOutcome::Completed(v)) => {
                let status = serde_json::from_value::<ApprovalControlOutcome>(v).map(|o| o.status);
                tracing::info!(workflow_id = %wf, status = ?status, "批准已消费");
            }
            // 已派发而批准已不可消费（截止已过、被失效）：派发前的余量本应排除这种
            // 情形；出现了就是需要人看的对账缺口，留下审计而不是改写任何一方
            Ok(UpdateOutcome::Rejected { message, .. }) | Err(TemporalError::Rejected(message)) => {
                self.record_consume_gap(&ae, &message).await;
            }
            Err(e) => {
                tracing::warn!(workflow_id = %wf, error = %e, "consume 结果不明，留给对账作业")
            }
        }
    }

    async fn record_consume_gap(&self, ae: &Execution, message: &str) {
        tracing::error!(action = %ae.id, message, "动作已派发而批准拒绝 consume：对账缺口");
        let run = async {
            let def = exact_definition_for_execution(&self.pool, ae).await?;
            let mut tx = self.pool.begin().await?;
            audit(
                &mut tx,
                ae,
                &def,
                "consume-gap",
                "RECONCILIATION",
                "NONE",
                &wire(&ReasonCode::ApprovalConsumeWindowClosed),
                None,
                ae.approval_workflow_id
                    .iter()
                    .map(|w| Evidence::new(EvidenceKind::ApprovalWorkflowId, w))
                    .collect(),
            )
            .await?;
            tx.commit().await
        };
        if let Err(e) = run.await {
            tracing::warn!(error = %e, "consume 缺口审计未写入");
        }
    }

    /// 重新准入不通过时让批准失效。Update ID 固定为 `<action_execution_id>:invalidate`。
    pub async fn invalidate(&self, ae_id: Uuid) {
        let Ok(Some(ae)) = load_execution(&self.pool, ae_id).await else {
            return;
        };
        // 重新准入拒绝（REVOKED），或准入之后、派发之时目标事实不再成立（ABORTED）：
        // 两者都意味着这份批准再也不会被消费
        let Some(wf) = ae.approval_workflow_id.clone() else {
            return;
        };
        if ae.gate_state != "REVOKED" && ae.dispatch_state != "ABORTED" {
            return;
        }
        let reason = ae
            .reason_code
            .as_deref()
            .and_then(parse::<ReasonCode>)
            .unwrap_or(ReasonCode::ApprovalInvalidated);
        let arg = serde_json::to_value(ApprovalInvalidateUpdate { reason }).ok();
        match self
            .temporal
            .update(
                &wf,
                &format!("{}:invalidate", ae.id),
                "invalidate",
                arg,
                self.cfg.update_wait,
            )
            .await
        {
            Ok(UpdateOutcome::Completed(_)) => tracing::info!(workflow_id = %wf, "批准已失效"),
            // 已终结（过期、已失效）：批准已不可用，目的已达成
            Ok(UpdateOutcome::Rejected { message, .. }) | Err(TemporalError::Rejected(message)) => {
                tracing::info!(workflow_id = %wf, message, "invalidate 未被接受：批准已不在 APPROVED")
            }
            Err(e) => {
                tracing::warn!(workflow_id = %wf, error = %e, "invalidate 结果不明，留给对账作业")
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 审批决定与撤回（BFF → Temporal Update）
// ---------------------------------------------------------------------------

/// Update 的结论，映射为 BFF 回应。
pub enum UpdateResult {
    Completed(Value),
    Refused(Refusal),
}

impl Governance {
    /// 审批所在的 ActionExecution，限定在调用方 Tenant 内：别的 Tenant 的与不存在的
    /// 是同一个回答。
    pub async fn approval_execution(
        &self,
        tenant: Uuid,
        workflow_id: &str,
    ) -> Result<Option<Execution>, sqlx::Error> {
        sqlx::query_as(&format!(
            "select {EXECUTION_COLUMNS} from admission.action_execution
             where tenant_id = $1 and approval_workflow_id = $2"
        ))
        .bind(tenant)
        .bind(workflow_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// 发一个 Update 并把结论分类。Validator/handler 的拒绝带 contracts 的 reason
    /// code 作 ApplicationError type；认不出的一律按冲突处理，不当成功。
    pub async fn send_update(
        &self,
        workflow_id: &str,
        update_id: &str,
        name: &str,
        arg: Option<Value>,
    ) -> UpdateResult {
        match self
            .temporal
            .update(workflow_id, update_id, name, arg, self.cfg.update_wait)
            .await
        {
            Ok(UpdateOutcome::Completed(v)) => UpdateResult::Completed(v),
            Ok(UpdateOutcome::Rejected { reason, message }) => {
                tracing::info!(workflow_id, update_id, reason, message, "Update 被拒绝");
                UpdateResult::Refused(match parse::<ReasonCode>(&reason) {
                    Some(r @ ReasonCode::ApproverNotEligible) => Refusal::Denied(r),
                    // 审批正在 continue-as-new，或资格判定的依赖不可用：这次没有形成
                    // 决定，以同一 Update ID 重发即可——不是冲突
                    Some(ReasonCode::DependencyUnavailable) => Refusal::Unavailable(message),
                    Some(r) => Refusal::Conflict(r),
                    None => Refusal::Conflict(ReasonCode::ApprovalNotOpen),
                })
            }
            // Workflow 已终结：审批不再接受任何输入
            Err(TemporalError::Rejected(m)) => {
                tracing::info!(workflow_id, update_id, message = %m, "Update 目标已终结");
                UpdateResult::Refused(Refusal::Conflict(ReasonCode::ApprovalNotOpen))
            }
            Err(e) => {
                tracing::warn!(workflow_id, update_id, error = %e, "Update 结果不明");
                UpdateResult::Refused(Refusal::Unavailable(e.to_string()))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// ApprovalProjection 的唯一写入路径
// ---------------------------------------------------------------------------

pub enum Applied {
    /// 报告已采纳或按单调规则忽略。`approved` 是本次采纳使其进入 APPROVED、
    /// 需要调用方在请求之外触发重新准入的 ActionExecution——不在写回请求里同步做：
    /// 那会让 Worker 的投影 Activity 等着 Core 去 Update 同一个 Workflow。
    Done { approved: Option<Uuid> },
    /// 没有登记过这个审批 workflow：Core 在 Start 之前的职责，写回方不能替它建
    UnknownWorkflow,
    /// 报告不合契约（时间戳不可解析等），不重试
    Invalid,
}

impl Governance {
    /// 按 event_id 单调 upsert ApprovalProjection，同事务推进 ActionExecution 的门禁
    /// 并追加审计。APPROVED 被采纳后触发批准后的重新准入。
    pub async fn apply_approval_report(
        &self,
        report: &ApprovalStateReport,
    ) -> Result<Applied, sqlx::Error> {
        let parse_ts = |s: &str| DateTime::parse_from_rfc3339(s).map(|t| t.with_timezone(&Utc));
        let Ok(expires_at) = parse_ts(&report.expires_at) else {
            return Ok(Applied::Invalid);
        };
        let consume_deadline = match report.consume_deadline.as_deref().map(parse_ts).transpose() {
            Ok(v) => v,
            Err(_) => return Ok(Applied::Invalid),
        };
        let consumed_at = match report.consumed_at.as_deref().map(parse_ts).transpose() {
            Ok(v) => v,
            Err(_) => return Ok(Applied::Invalid),
        };
        let mut tx = self.pool.begin().await?;
        let ae: Option<Execution> = sqlx::query_as(&format!(
            "select {EXECUTION_COLUMNS} from admission.action_execution
             where approval_workflow_id = $1"
        ))
        .bind(&report.workflow_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(ae) = ae else {
            return Ok(Applied::UnknownWorkflow);
        };
        crate::application_catalog::approval::lock_parent_refs(&mut tx, ae.id).await?;
        let ae = lock_execution(&mut tx, ae.id).await?;
        let status = wire(&report.status);
        let decisions = serde_json::to_value(&report.decisions).unwrap_or_else(|_| json!([]));
        let applied: Option<i64> = sqlx::query_scalar(
            "insert into projection.approval_projection
                 (workflow_id, action_execution_id, tenant_id, run_id, last_event_id, status,
                  decisions, expires_at, consume_deadline, consumed_at, reason_code, updated_at)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
             on conflict (workflow_id) do update set
                 run_id = excluded.run_id, last_event_id = excluded.last_event_id,
                 status = excluded.status, decisions = excluded.decisions,
                 expires_at = excluded.expires_at, consume_deadline = excluded.consume_deadline,
                 consumed_at = excluded.consumed_at, reason_code = excluded.reason_code,
                 updated_at = now()
             where projection.approval_projection.last_event_id < excluded.last_event_id
             returning last_event_id",
        )
        .bind(&report.workflow_id)
        .bind(ae.id)
        .bind(ae.tenant_id)
        .bind(&report.run_id)
        .bind(report.event_id)
        .bind(&status)
        .bind(&decisions)
        .bind(expires_at)
        .bind(consume_deadline)
        .bind(consumed_at)
        .bind(report.reason.as_ref().map(wire))
        .fetch_optional(&mut *tx)
        .await?;
        if applied.is_none() {
            // 更旧或重复的报告：幂等成功
            return Ok(Applied::Done { approved: None });
        }
        // 审批被 Workflow 推进到的 run 可能是 Start 时没拿到 run ID 的那一次
        sqlx::query(
            "update projection.workflow_ref set run_id = coalesce(run_id, $2),
                 projection_state = case when projection_state = 'PENDING_START' then 'RUNNING' else projection_state end
             where workflow_id = $1",
        )
        .bind(&report.workflow_id)
        .bind(&report.run_id)
        .execute(&mut *tx)
        .await?;

        let def = exact_definition_for_execution(&self.pool, &ae).await?;
        // 每个决定一条 APPROVAL 审计；键按 workflow 与 approver 稳定
        for d in &report.decisions {
            append(
                &mut tx,
                AuditEntry {
                    event_key: format!(
                        "{}:{}:decision",
                        report.workflow_id, d.approver_principal_id
                    ),
                    tenant_id: Some(ae.tenant_id),
                    workspace_id: ae.workspace_id,
                    operation_id: ae.operation_id,
                    event_type: "APPROVAL",
                    human_identity_id: None,
                    initiator_principal_id: Some(ae.initiator_principal_id),
                    actor_principal_id: Uuid::parse_str(&d.approver_principal_id).ok(),
                    action_key: &ae.action_key,
                    action_version: ae.action_version,
                    component_type_key: &def.component_type_key,
                    target_type: Some(&def.target_type),
                    target_id: Some(ae.target_id),
                    parameter_hash: &ae.parameter_hash,
                    decision: &wire(&d.decision),
                    result_code: &wire(&d.decision),
                    result_exposure: &def.result_exposure,
                    evidence_refs: vec![
                        Evidence::new(EvidenceKind::ApprovalWorkflowId, &report.workflow_id),
                        Evidence::new(EvidenceKind::TemporalRunId, &report.run_id),
                    ],
                    correlation_id: ae.correlation_id,
                },
            )
            .await?;
        }
        audit(
            &mut tx,
            &ae,
            &def,
            &format!("approval:{status}"),
            "APPROVAL",
            "NONE",
            &status,
            None,
            vec![
                Evidence::new(EvidenceKind::ApprovalWorkflowId, &report.workflow_id),
                Evidence::new(EvidenceKind::TemporalRunId, &report.run_id),
            ],
        )
        .await?;

        // 门禁随审批终态收敛。只从 WAITING 出发：已 ALLOWED/REVOKED 的由 Core 自己
        // 的重新准入决定过了
        let gate = match report.status {
            ApprovalStatus::Denied => Some(("DENIED", ReasonCode::ApprovalDenied)),
            ApprovalStatus::Expired => Some(("EXPIRED", ReasonCode::ApprovalExpired)),
            ApprovalStatus::Cancelled => Some(("REVOKED", ReasonCode::ApprovalWithdrawn)),
            // WAITING 时就失效只可能是 consume 截止：Core 没来得及重新准入
            ApprovalStatus::Invalidated => {
                Some(("EXPIRED", ReasonCode::ApprovalConsumeWindowClosed))
            }
            _ => None,
        };
        if let Some((to, reason)) = gate {
            let closed = sqlx::query(
                "update admission.action_execution set gate_state = $2, reason_code = $3, updated_at = now()
                 where id = $1 and (gate_state = 'WAITING' or
                   (component_binding_kind='APPLICATION' and gate_state='ALLOWED' and dispatch_state='NOT_DISPATCHED'))",
            )
            .bind(ae.id)
            .bind(to)
            .bind(wire(&reason))
            .execute(&mut *tx)
            .await?;
            if closed.rows_affected() > 0 {
                crate::invitation::settle_refused_admission(&mut tx, &ae, &def, &reason).await?;
            }
        }
        tx.commit().await?;
        Ok(Applied::Done {
            approved: (report.status == ApprovalStatus::Approved && ae.gate_state == "WAITING")
                .then_some(ae.id),
        })
    }
}

// ---------------------------------------------------------------------------
// FreshApprovalAdmission：审批者资格由 Core 判定（.design/06 §4）
// ---------------------------------------------------------------------------

impl Governance {
    async fn effective_approval_policy(
        &self,
        ae: &Execution,
        def: &Definition,
    ) -> Result<Policy, Refusal> {
        if let Some(policy) = crate::automation::step_approval::child_policy(self, ae).await? {
            return Ok(policy);
        }
        let (Some(pid), Some(pver)) = (def.approval_policy_id, def.approval_policy_version) else {
            return Err(Refusal::Unavailable("审批动作的定义缺策略".into()));
        };
        exact_policy(&self.pool, pid, pver).await
    }

    pub async fn fresh_approval_admission(
        &self,
        req: &FreshApprovalAdmissionRequest,
    ) -> Result<Option<FreshApprovalAdmissionResult>, Refusal> {
        let ae: Option<Execution> = sqlx::query_as(&format!(
            "select {EXECUTION_COLUMNS} from admission.action_execution where approval_workflow_id = $1"
        ))
        .bind(&req.approval_workflow_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(ae) = ae else {
            return Ok(None);
        };
        let def = exact_definition_for_execution(&self.pool, &ae).await?;
        let policy = self.effective_approval_policy(&ae, &def).await?;
        let application =
            crate::application_catalog::approval::is_application(&self.pool, &ae).await?;
        let approver = Uuid::parse_str(&req.approver_principal_id)
            .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
        let installation_owner = installation_permission::owner_policy(&ae.action_key, &policy);
        let step_owner = crate::automation::step_approval::is_child(&ae)
            && policy.owner_requirement == "TARGET_OWNER";
        if !matches!(
            policy.owner_requirement.as_str(),
            "NONE" | "ALL_AFFECTED_OWNERS"
        ) && !installation_owner
            && !step_owner
            && !application
        {
            return Ok(Some(FreshApprovalAdmissionResult {
                admitted: false,
                reason: Some(ReasonCode::ApprovalSelectorUnresolvable),
                satisfied_selectors: Vec::new(),
            }));
        }

        let refuse = |reason| FreshApprovalAdmissionResult {
            admitted: false,
            reason: Some(reason),
            satisfied_selectors: vec![],
        };
        let mut tx = self.pool.begin().await?;
        if application {
            crate::application_catalog::approval::lock_parent(&mut tx, &ae).await?;
        }
        // approver 必须是同 Tenant 的 active HUMAN，且 TenantMembership ACTIVE：
        // 与 Resource 写者一致先锁 Tenant；SUSPENDED 的删除资格由下面的冻结检查判定。
        let _ = crate::roles::lock_tenant(&mut tx, ae.tenant_id).await?;
        // Agent、SERVICE、过期/失权 Human 的 Update 不形成决定（DD-47）
        let active: Option<i32> = sqlx::query_scalar(
            "select 1 from identity.principal p
             join identity.tenant_membership tm on tm.tenant_principal_id = p.id
             join identity.tenant t on t.id = p.tenant_id
             where p.id = $1 and p.tenant_id = $2 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
               and tm.state = 'ACTIVE' and (t.state = 'ACTIVE'
                    or ($3 and t.state = 'SUSPENDED' and exists (
                        select 1 from admission.tenant_lifecycle_snapshot s
                        where s.action_execution_id = $4 and s.tenant_version = t.version
                          and not s.irreversible_dispatch_started))) for update of p,tm",
        )
        .bind(approver)
        .bind(ae.tenant_id)
        .bind(ae.action_key == "tenant.delete")
        .bind(ae.id)
        .fetch_optional(&mut *tx)
        .await?;
        let mut zed = None;
        let result = if active.is_none() {
            refuse(ReasonCode::ApproverNotEligible)
        } else if crate::automation::step_approval::is_child(&ae)
            && !crate::automation::step_approval::parent_pending(&mut tx, ae.id).await?
        {
            refuse(ReasonCode::ApprovalInvalidated)
        } else if policy.self_approval == "DENY" && approver == ae.initiator_principal_id {
            // 职责分离：发起者不能批准也不能否决自己的请求
            refuse(ReasonCode::SelfApprovalDenied)
        } else if match ae.action_key.as_str() {
            crate::capability_contract::APPROVE => {
                !crate::capability_contract::approver_separated(&mut tx, &ae, approver).await?
            }
            crate::component_release::approval::APPROVE => {
                !crate::component_release::approval::approver_separated(&mut tx, &ae, approver)
                    .await?
            }
            _ => false,
        } {
            refuse(ReasonCode::SelfApprovalDenied)
        } else if application {
            let (result, revision) = crate::application_catalog::approval::qualify(
                self, &mut tx, &ae, &def, &policy, approver,
            )
            .await?;
            zed = revision;
            result
        } else {
            let refs: Vec<contracts::AffectedOwnerRef> =
                if crate::automation::step_approval::is_child(&ae) {
                    crate::automation::step_approval::owners(&ae)?
                } else if policy.owner_requirement == "ALL_AFFECTED_OWNERS" {
                    let refs: Value = sqlx::query_scalar(
                        "select resource_owner_versions || asset_owner_versions from admission.tenant_lifecycle_snapshot
                    where action_execution_id=$1 and tenant_id=$2",
                    )
                    .bind(ae.id)
                    .bind(ae.tenant_id)
                    .fetch_one(&mut *tx)
                    .await?;
                    serde_json::from_value(refs).map_err(|e| Refusal::Unavailable(e.to_string()))?
                } else if installation_owner {
                    vec![installation_permission::frozen_owner(&ae)?]
                } else {
                    Vec::new()
                };
            let owners_current =
                crate::agent_definition::validate_frozen_owners(self, &mut tx, ae.tenant_id, &refs)
                    .await?;
            let target_current = if crate::automation::step_approval::is_child(&ae) {
                crate::automation::step_approval::target_current(self, &mut tx, &ae).await?
            } else if installation_owner {
                match installation_permission::validate_approval_owner(self, &mut tx, &ae, false)
                    .await
                {
                    Ok(_) => true,
                    Err(Refusal::Conflict(_)) | Err(Refusal::Denied(_)) => false,
                    Err(e) => return Err(e),
                }
            } else if def.target_type == "RESOURCE" {
                match crate::agent_definition::resource(&mut tx, ae.tenant_id, ae.target_id, true)
                    .await?
                {
                    Some(r)
                        if r.state == "ACTIVE"
                            && r.projection_action_execution_id.is_none()
                            && Some(r.version) == ae.frozen_target_version() =>
                    {
                        crate::agent_definition::projection_matches(
                            self,
                            r.id,
                            r.tenant_id,
                            r.owner_principal_id,
                        )
                        .await?
                    }
                    _ => false,
                }
            } else if def.target_type == "ASSET" {
                match crate::agent_version::version(&mut tx, ae.tenant_id, ae.target_id, false)
                    .await?
                {
                    Some(v) if Some(v.version) == ae.frozen_target_version() => {
                        crate::agent_definition::validate_frozen_owners(
                            self,
                            &mut tx,
                            ae.tenant_id,
                            &[contracts::AffectedOwnerRef {
                                target_type: "ASSET".into(),
                                target_id: v.asset_id.to_string(),
                                target_version: i64::from(v.version),
                                owner_principal_id: v.owner_principal_id.to_string(),
                            }],
                        )
                        .await?
                    }
                    _ => false,
                }
            } else {
                true
            };
            let is_owner = owners_current
                && refs
                    .iter()
                    .any(|r| r.owner_principal_id == approver.to_string());
            let mut satisfied = vec![];
            for r in &policy.role_requirements {
                let object = match r.selector {
                    ApprovalSelector::TenantAdmin => Some(("tenant", ae.tenant_id)),
                    ApprovalSelector::WorkspaceAdmin => ae.workspace_id.map(|w| ("workspace", w)),
                    ApprovalSelector::ResourceApprover
                        if def.target_type == "RESOURCE" && target_current =>
                    {
                        Some(("resource", ae.target_id))
                    }
                    ApprovalSelector::ResourceApprover => None,
                };
                let Some((ty, id)) = object else { continue };
                let c = self
                    .spicedb
                    .check(
                        ty,
                        &id.to_string(),
                        if r.selector == ApprovalSelector::ResourceApprover {
                            "approve"
                        } else {
                            "manage"
                        },
                        &approver.to_string(),
                        Consistency::FullyConsistent,
                    )
                    .await
                    .map_err(|e| Refusal::Unavailable(e.to_string()))?;
                zed = Some(c.zed_token);
                if c.allowed && !satisfied.contains(&r.selector) {
                    satisfied.push(r.selector.clone());
                }
            }
            if !owners_current || !target_current || (satisfied.is_empty() && !is_owner) {
                refuse(ReasonCode::ApproverNotEligible)
            } else {
                FreshApprovalAdmissionResult {
                    admitted: true,
                    reason: None,
                    satisfied_selectors: satisfied,
                }
            }
        };

        let result_code = result
            .reason
            .as_ref()
            .map(wire)
            .unwrap_or_else(|| "ADMITTED".into());
        let mut evidence = zed_evidence(zed.as_deref());
        evidence.push(Evidence::new(
            EvidenceKind::ApprovalWorkflowId,
            &req.approval_workflow_id,
        ));
        append(
            &mut tx,
            AuditEntry {
                // 同一 approver 对同一审批只有一个 Update ID，因此只有一次资格判定
                event_key: format!("{}:{}:admission", req.approval_workflow_id, approver),
                tenant_id: Some(ae.tenant_id),
                workspace_id: ae.workspace_id,
                operation_id: ae.operation_id,
                event_type: "DECISION",
                human_identity_id: None,
                initiator_principal_id: Some(ae.initiator_principal_id),
                actor_principal_id: Some(approver),
                action_key: &ae.action_key,
                action_version: ae.action_version,
                component_type_key: &def.component_type_key,
                target_type: Some(&def.target_type),
                target_id: Some(ae.target_id),
                parameter_hash: &ae.parameter_hash,
                decision: if result.admitted { "ALLOW" } else { "DENY" },
                result_code: &result_code,
                result_exposure: &def.result_exposure,
                evidence_refs: evidence,
                correlation_id: ae.correlation_id,
            },
        )
        .await?;
        tx.commit().await?;
        Ok(Some(result))
    }
}

// ---------------------------------------------------------------------------
// 驱动：对账作业对一条非终态 ActionExecution 做它此刻该做的那一步
// ---------------------------------------------------------------------------

impl Governance {
    /// 幂等且只看持久化事实。返回这一步的名字，供度量。
    pub async fn drive(&self, ae_id: Uuid) -> Result<&'static str, Refusal> {
        let Some(ae) = load_execution(&self.pool, ae_id).await? else {
            return Ok("GONE");
        };
        let stale: bool =
            sqlx::query_scalar("select $1 < now() - make_interval(secs => $2::bigint)")
                .bind(ae.updated_at)
                .bind(self.cfg.evaluation_timeout_seconds)
                .fetch_one(&self.pool)
                .await?;
        let approval: Option<(String, String)> = match &ae.approval_workflow_id {
            Some(wf) => {
                sqlx::query_as(
                    "select w.projection_state, coalesce(p.status, '')
                 from projection.workflow_ref w
                 left join projection.approval_projection p on p.workflow_id = w.workflow_id
                 where w.workflow_id = $1",
                )
                .bind(wf)
                .fetch_optional(&self.pool)
                .await?
            }
            None => None,
        };
        let (ref_state, status) = approval
            .as_ref()
            .map(|(r, s)| (r.as_str(), s.as_str()))
            .unwrap_or(("", ""));
        match (ae.gate_state.as_str(), ae.dispatch_state.as_str()) {
            ("EVALUATING", _)
                if stale && matches!(ae.action_key.as_str(), "automation.run" | "agent.invoke") =>
            {
                let def = exact_definition_for_execution(&self.pool, &ae).await?;
                let mut tx = self.pool.begin().await?;
                let current = lock_execution(&mut tx, ae.id).await?;
                if current.gate_state == "EVALUATING" {
                    self.record_automation_decision(
                        &mut tx,
                        &current,
                        &def,
                        "ADMISSION",
                        Err(&Refusal::Precondition(ReasonCode::AdmissionAbandoned)),
                    )
                    .await?;
                }
                tx.commit().await?;
                Ok("EVALUATION_EXPIRED")
            }
            // 判定中途崩溃或依赖长时间不可用：意图过期，不替发起者猜结论
            ("EVALUATING", _) if stale => {
                let def = exact_definition_for_execution(&self.pool, &ae).await?;
                let eval = Evaluation {
                    allowed: false,
                    scope: "NOT_APPLICABLE",
                    authorization: "NOT_APPLICABLE",
                    quota: "NOT_APPLICABLE",
                    zed_token: None,
                    reason: Some(ReasonCode::AdmissionAbandoned),
                };
                self.close_gate(
                    &ae,
                    &def,
                    "ADMISSION",
                    "EXPIRED",
                    &eval,
                    &ReasonCode::AdmissionAbandoned,
                    None,
                )
                .await?;
                Ok("EVALUATION_EXPIRED")
            }
            ("WAITING", _) if status == "APPROVED" => {
                self.after_approval(ae.id).await;
                Ok("RECHECKED")
            }
            ("WAITING", _) if ref_state == "PENDING_START" && stale => {
                self.ensure_approval_started(ae.id).await;
                Ok("APPROVAL_START_REDRIVEN")
            }
            // 审批 Workflow 已终结而投影没有终态：history 里的结论没有到达 Core。
            // 批准再也不可能被消费，门禁过期；投影缺口由 workflow_reconcile 度量
            ("WAITING", _)
                if ref_state == "TERMINAL"
                    && !matches!(
                        status,
                        "DENIED" | "EXPIRED" | "CANCELLED" | "INVALIDATED" | "CONSUMED"
                    ) =>
            {
                let def = exact_definition_for_execution(&self.pool, &ae).await?;
                let eval = Evaluation {
                    allowed: false,
                    scope: "NOT_APPLICABLE",
                    authorization: "NOT_APPLICABLE",
                    quota: "NOT_APPLICABLE",
                    zed_token: None,
                    reason: Some(ReasonCode::ApprovalInvalidated),
                };
                self.close_gate(
                    &ae,
                    &def,
                    "RECHECK",
                    "EXPIRED",
                    &eval,
                    &ReasonCode::ApprovalInvalidated,
                    None,
                )
                .await?;
                Ok("APPROVAL_LOST")
            }
            ("ALLOWED", "NOT_DISPATCHED" | "UNKNOWN")
                if stale
                    && crate::application_catalog::approval::is_application(&self.pool, &ae)
                        .await? =>
            {
                // Native intent/UNKNOWN is driven only by the original Tool
                // consumer and Adapter observer, never the generic dispatcher.
                Ok("APPLICATION_CALL_PENDING")
            }
            ("ALLOWED", "NOT_DISPATCHED" | "UNKNOWN") if stale => {
                self.dispatch(ae.id).await;
                Ok("DISPATCH_REDRIVEN")
            }
            ("ALLOWED", "DISPATCHED") if status == "APPROVED" => {
                self.consume(ae.id).await;
                Ok("CONSUME_RESENT")
            }
            ("REVOKED", _) | ("ALLOWED", "ABORTED") if status == "APPROVED" => {
                self.invalidate(ae.id).await;
                Ok("INVALIDATE_RESENT")
            }
            _ => Ok("NOTHING_TO_DO"),
        }
    }
}

// ---------------------------------------------------------------------------
// 自有路径的动作：设备公钥登记与撤销（DD-79）
// ---------------------------------------------------------------------------

/// 自有路径动作通过准入后的事实：它按哪个确切版本的定义被准入、SpiceDB 给出的
/// revision。目标解析与实体推进留在其模块（持钥证明、设备上界、binding 状态机）。
pub struct OwnedAdmission {
    pub version: i32,
    pub zed_token: String,
}

impl Governance {
    /// 设备公钥这类动作的目标是调用方自己的 Principal，没有可交给 Semantic 解析的
    /// 业务对象；但它仍是用户可达的写动作，定义、scope guard 与 fresh Check 走同一条
    /// 准入（`apps/AGENTS.md` 规则 9）。未登记即 BLOCKED；拒绝时写 DECISION 审计。
    pub async fn admit_owned(
        &self,
        actor: Actor,
        action_key: &str,
        parameter_hash: &str,
    ) -> Result<OwnedAdmission, Refusal> {
        let def = active_definition(&self.pool, action_key)
            .await?
            .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
        let target = Target {
            id: actor.principal_id,
            version: 0,
            workspace_id: None,
        };
        let eval = self.evaluate(actor, &def, &target).await?;
        if eval.allowed {
            return Ok(OwnedAdmission {
                version: def.version,
                zed_token: eval.zed_token.unwrap_or_default(),
            });
        }
        let reason = eval.reason.clone().unwrap_or(ReasonCode::PermissionDenied);
        let operation_id = Uuid::new_v4();
        let mut tx = self.pool.begin().await?;
        append(
            &mut tx,
            AuditEntry {
                event_key: format!("{operation_id}:admission:decision"),
                tenant_id: Some(actor.tenant_id),
                workspace_id: None,
                operation_id,
                event_type: "DECISION",
                human_identity_id: actor.human_identity_id,
                initiator_principal_id: Some(actor.principal_id),
                actor_principal_id: Some(actor.principal_id),
                action_key: &def.action_key,
                action_version: def.version,
                component_type_key: &def.component_type_key,
                target_type: Some(&def.target_type),
                target_id: Some(actor.principal_id),
                parameter_hash,
                decision: "DENY",
                result_code: &wire(&reason),
                result_exposure: &def.result_exposure,
                evidence_refs: zed_evidence(eval.zed_token.as_deref()),
                correlation_id: operation_id,
            },
        )
        .await?;
        tx.commit().await?;
        Err(Refusal::Denied(reason))
    }
}

/// 自有路径动作的 ActionDecision，与它的 ActionExecution 同事务写入。
pub async fn record_owned_decision(
    tx: &mut Transaction<'_, Postgres>,
    subject: &DecisionSubject<'_>,
    zed_token: &str,
) -> Result<(), sqlx::Error> {
    record_decision(
        tx,
        subject,
        "ADMISSION",
        "ALLOW",
        "ALLOW",
        "NOT_REQUIRED",
        "NOT_APPLICABLE",
        Some(zed_token),
        None,
    )
    .await
}

#[cfg(test)]
mod dispatch_tests {
    use super::{Dispatch, StatusCode};

    #[test]
    fn launch_result_maps_to_dispatch_outcome() {
        assert_eq!(Dispatch::of(Ok(()), false), Dispatch::Dispatched);
        assert_eq!(
            Dispatch::of(Err(StatusCode::SERVICE_UNAVAILABLE), false),
            Dispatch::Unknown,
            "结果不明不得记成成功或失败"
        );
        assert_eq!(
            Dispatch::of(Err(StatusCode::CONFLICT), false),
            Dispatch::Aborted
        );
        // 执行证据优先：同 ID 的执行已经发生过，重试撞上的 409/503 不改变它
        for status in [StatusCode::CONFLICT, StatusCode::SERVICE_UNAVAILABLE] {
            assert_eq!(Dispatch::of(Err(status), true), Dispatch::Dispatched);
        }
    }
}
