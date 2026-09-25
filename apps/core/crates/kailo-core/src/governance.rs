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
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::component_task::{self, Launch};
use crate::membership_lifecycle::{
    launch_membership, launch_scope, LifecycleRequest, ScopeLifecycleRequest,
};
use crate::membership_projection::MembershipScope;
use crate::scope_state::ScopeKind;
use crate::spicedb::{Consistency, SpiceDb};
use crate::temporal::{TemporalClient, TemporalError, UpdateOutcome};

/// Worker 注册的审批 Workflow 类型名，两侧逐字相同。
pub const APPROVAL_WORKFLOW_TYPE: &str = "ApprovalWorkflow";
/// 审批 workflow ID 的类型段。它不是 ComponentTaskWorkflow 的 kind，只占
/// `kailo:<kind>:<tenant>:<entity>:<version>` 的第二段，使 ID 仍可机械校验。
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
            Refusal::Unavailable(_) => (ErrorClass::Unknown, StatusCode::SERVICE_UNAVAILABLE),
        }
    }

    pub fn reason(&self) -> ReasonCode {
        match self {
            Refusal::Denied(r)
            | Refusal::Blocked(r)
            | Refusal::Precondition(r)
            | Refusal::Conflict(r) => r.clone(),
            Refusal::Unavailable(_) => ReasonCode::DependencyUnavailable,
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
    pub workspace_rule: String,
    pub permission: String,
    pub permission_object_type: String,
    pub confirmation_mode: String,
    pub approval_policy_id: Option<Uuid>,
    pub approval_policy_version: Option<i32>,
    pub workflow_kind: Option<String>,
    pub result_exposure: String,
    pub execution_mode: String,
    pub role_template_key: Option<String>,
    pub role_template_version: Option<i32>,
}

const DEFINITION_COLUMNS: &str =
    "action_key, version, component_type_key, target_type, workspace_rule,
     permission, permission_object_type, confirmation_mode, approval_policy_id,
     approval_policy_version, workflow_kind, result_exposure, execution_mode,
     role_template_key, role_template_version";

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
         where action_key = $1 and status = 'ACTIVE'"
    ))
    .bind(key)
    .fetch_optional(pool)
    .await
}

/// 确切版本，不看 status：已准入的动作按准入时的规则重新准入与解释，
/// 之后被 RETIRED 不改变它（.design/03 §4 的「固定快照」）。
async fn exact_definition(
    pool: &PgPool,
    key: &str,
    version: i32,
) -> Result<Definition, sqlx::Error> {
    sqlx::query_as(&format!(
        "select {DEFINITION_COLUMNS} from catalog.action_definition
         where action_key = $1 and version = $2"
    ))
    .bind(key)
    .bind(version)
    .fetch_one(pool)
    .await
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

async fn exact_policy(pool: &PgPool, id: Uuid, version: i32) -> Result<Policy, Refusal> {
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
    WorkspaceCreate,
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
}

impl Semantic {
    pub(crate) fn from_key(k: &str) -> Option<Self> {
        Some(match k {
            "workspace.create" => Self::WorkspaceCreate,
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
            _ => return None,
        })
    }

    /// 能否经 BFF 语义命令发起。开通只能由兑换发起（DD-83）：它的发起者是邀请人、
    /// 目标是兑换建立的 INVITED membership，由请求体直接提交就绕开了兑换这一事实。
    fn bff_submittable(self) -> bool {
        self != Self::TenantMemberAdmit
    }

    /// 在准入落定的同一事务里完成、没有外部副作用的同步动作：门禁 ALLOWED 与
    /// 派发 DISPATCHED 同事务写入，没有「已允许未派发」的中间态
    fn completes_in_admission(self) -> bool {
        matches!(
            self,
            Self::TenantMemberInvite | Self::TenantMemberInviteRevoke
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
        self.is_role() || self == Self::TenantMemberRevoke
    }
}

/// 规范化参数。只含 ID 与平台自有的名称事实，不含任何业务正文。
#[derive(Debug, Clone, PartialEq)]
pub struct Params {
    pub workspace_id: Option<Uuid>,
    pub principal_id: Option<Uuid>,
    pub slug: Option<String>,
    pub name: Option<String>,
    pub invitation_id: Option<Uuid>,
}

impl Params {
    fn to_json(&self) -> Value {
        let mut m = serde_json::Map::new();
        if let Some(w) = self.workspace_id {
            m.insert("workspaceId".into(), json!(w));
        }
        if let Some(p) = self.principal_id {
            m.insert("principalId".into(), json!(p));
        }
        if let Some(i) = self.invitation_id {
            m.insert("invitationId".into(), json!(i));
        }
        if let Some(s) = &self.slug {
            m.insert("slug".into(), json!(s));
        }
        if let Some(n) = &self.name {
            m.insert("name".into(), json!(n));
        }
        Value::Object(m)
    }

    fn from_json(v: &Value) -> Option<Self> {
        let uuid = |k: &str| {
            v.get(k)
                .and_then(Value::as_str)
                .and_then(|s| Uuid::parse_str(s).ok())
        };
        let text = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_owned);
        Some(Self {
            workspace_id: uuid("workspaceId"),
            principal_id: uuid("principalId"),
            slug: text("slug"),
            name: text("name"),
            invitation_id: uuid("invitationId"),
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

fn parse_command(sem: Semantic, cmd: &contracts::ActionCommand) -> Result<Params, Refusal> {
    let bad = || Refusal::Precondition(ReasonCode::InvalidParameters);
    let uuid = |s: &Option<String>| -> Result<Option<Uuid>, Refusal> {
        s.as_deref()
            .map(Uuid::parse_str)
            .transpose()
            .map_err(|_| bad())
    };
    let p = Params {
        workspace_id: uuid(&cmd.workspace_id)?,
        principal_id: uuid(&cmd.principal_id)?,
        slug: cmd.slug.clone(),
        name: cmd.name.as_ref().map(|n| n.trim().to_owned()),
        invitation_id: uuid(&cmd.invitation_id)?,
    };
    // 每个语义要求的参数集合是闭集：多出与缺少都拒绝，不按「字段为空即忽略」猜
    let ok = match sem {
        Semantic::WorkspaceCreate => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.slug.as_deref().is_some_and(valid_slug)
                && p.name.as_deref().is_some_and(|n| !n.is_empty())
        }
        Semantic::WorkspaceMemberAdd
        | Semantic::WorkspaceMemberRevoke
        | Semantic::WorkspaceRoleGrant
        | Semantic::WorkspaceRoleRevoke => {
            p.workspace_id.is_some()
                && p.principal_id.is_some()
                && p.invitation_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
        }
        Semantic::TenantMemberRevoke | Semantic::TenantRoleGrant | Semantic::TenantRoleRevoke => {
            p.workspace_id.is_none()
                && p.principal_id.is_some()
                && p.invitation_id.is_none()
                && p.slug.is_none()
                && p.name.is_none()
        }
        // 被邀请人的称呼只作展示；寻址靠凭据，不靠任何身份字段（DD-83）
        Semantic::TenantMemberInvite => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_none()
                && p.slug.is_none()
                && p.name.as_deref().is_some_and(|n| !n.is_empty())
        }
        Semantic::TenantMemberInviteRevoke => {
            p.workspace_id.is_none()
                && p.principal_id.is_none()
                && p.invitation_id.is_some()
                && p.slug.is_none()
                && p.name.is_none()
        }
        // 只由兑换在 Core 内构造（bff_submittable），这里仍按闭集核对
        Semantic::TenantMemberAdmit => {
            p.workspace_id.is_none()
                && p.principal_id.is_some()
                && p.invitation_id.is_some()
                && p.slug.is_none()
                && p.name.is_none()
        }
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

/// 按当前事实解析 target。`frozen` 是已准入动作冻结的 target ID：新建类动作的
/// ID 在首次准入时分配，重新准入必须解析到同一个。
#[allow(clippy::too_many_arguments)]
async fn resolve_target(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    def: &Definition,
    sem: Semantic,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    let for_update = if lock { " for update" } else { "" };
    match sem {
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
        Semantic::WorkspaceMemberAdd | Semantic::WorkspaceMemberRevoke => {
            let (ws, principal) = (p.workspace_id, p.principal_id);
            // Workspace 必须属于该 Tenant 且 ACTIVE：跨 Tenant 的 ID 与不存在是
            // 同一个回答
            let ws_ok: Option<i32> = sqlx::query_scalar(&format!(
                "select 1 from identity.workspace where id = $1 and tenant_id = $2 and state = 'ACTIVE'{for_update}"
            ))
            .bind(ws)
            .bind(tenant)
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
                Some((id, version, state)) if state == "REVOKED" => Ok(Target {
                    id,
                    version,
                    workspace_id: ws,
                }),
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

struct Evaluation {
    allowed: bool,
    scope: &'static str,
    authorization: &'static str,
    zed_token: Option<String>,
    reason: Option<ReasonCode>,
}

impl Governance {
    /// scope guard 在 permission Check 之前（DD-46/50）；两者都通过才 ALLOW。
    async fn evaluate(
        &self,
        actor: Actor,
        def: &Definition,
        target: &Target,
    ) -> Result<Evaluation, Refusal> {
        let deny = |scope: &'static str, authz: &'static str, token, reason| Evaluation {
            allowed: false,
            scope,
            authorization: authz,
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
               and t.state = 'ACTIVE' and tm.state = 'ACTIVE'",
        )
        .bind(actor.principal_id)
        .bind(actor.tenant_id)
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

        let object_id = match def.permission_object_type.as_str() {
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
            // resource/asset 目标在本切片没有语义；有定义也不放行
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
                &def.permission_object_type,
                &object_id.to_string(),
                &def.permission,
                &actor.principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;

        // Workspace scope：active WorkspaceMembership，或 fresh workspace manage
        // （.design/10 §5）。本切片的 Workspace 动作检查的正是 workspace manage，
        // 因此 Check 为真即满足；为假时还要看成员关系，二者择一不满足即 scope 拒绝。
        if def.workspace_rule == "WORKSPACE_REQUIRED" {
            let member: Option<i32> = sqlx::query_scalar(
                "select 1 from identity.workspace_membership
                 where workspace_id = $1 and tenant_principal_id = $2 and state = 'ACTIVE'",
            )
            .bind(target.workspace_id)
            .bind(actor.principal_id)
            .fetch_optional(&self.pool)
            .await?;
            let manage = def.permission == "manage"
                && def.permission_object_type == "workspace"
                && checked.allowed;
            if member.is_none() && !manage {
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
            zed_token: Some(checked.zed_token),
            reason: None,
        })
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
     temporal_workflow_id, approval_workflow_id, approval_expires_at, gate_state, dispatch_state,
     reason_code, correlation_id, updated_at";

impl Execution {
    fn params(&self) -> Option<Params> {
        self.parameters
            .as_ref()
            .and_then(|v| v.get("params"))
            .and_then(Params::from_json)
    }

    fn frozen_target_version(&self) -> Option<i32> {
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

async fn lock_execution(
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
    let ae_id = Uuid::new_v4();
    let operation_id = Uuid::new_v4();
    let hash = parameter_hash(def, target.id, params);
    let parameters = json!({ "params": params.to_json(), "targetVersion": target.version });
    sqlx::query(
        "insert into admission.action_execution
             (id, operation_id, tenant_id, workspace_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              parameters, idempotency_key, gate_state, dispatch_state, correlation_id)
         values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,'EVALUATING','NOT_DISPATCHED',$12)",
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
        json!([]),
    )
    .await?;
    Ok(ae)
}

/// 审计事实。event_key 按 operation 与阶段稳定：重试不写第二条（.design/03 §8）。
#[allow(clippy::too_many_arguments)]
async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    stage: &str,
    event_type: &str,
    decision: &str,
    result_code: &str,
    human: Option<Uuid>,
    evidence: Value,
) -> Result<(), sqlx::Error> {
    append(
        tx,
        AuditEntry {
            event_key: format!("{}:{stage}", ae.operation_id),
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
            component_type_key: &def.component_type_key,
            target_type: Some(&def.target_type),
            target_id: Some(ae.target_id),
            parameter_hash: &ae.parameter_hash,
            decision,
            result_code,
            result_exposure: &def.result_exposure,
            evidence_refs: evidence,
            correlation_id: ae.correlation_id,
        },
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn record_decision(
    tx: &mut Transaction<'_, Postgres>,
    ae: &DecisionSubject<'_>,
    phase: &str,
    scope: &str,
    authorization: &str,
    approval: &str,
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
         values ($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13,
                 'NOT_APPLICABLE',$14,'NOT_APPLICABLE','NOT_APPLICABLE','RECORDED',$15,$16)",
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
    fn subject(&self) -> DecisionSubject<'_> {
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

fn approval_workflow_id(tenant: Uuid, action_execution_id: Uuid) -> String {
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

impl Governance {
    /// BFF 语义命令的入口。成功时回 ActionSubmission；拒绝已写入 ActionExecution
    /// 与审计的，回应体带 operation ID。
    pub async fn submit(
        &self,
        actor: Actor,
        cmd: &contracts::ActionCommand,
    ) -> Result<(StatusCode, ActionSubmission), (Refusal, Option<Uuid>)> {
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
        let target = resolve_target(&mut conn, actor.tenant_id, &def, sem, &params, None, false)
            .await
            .map_err(|r| (r, None))?;
        drop(conn);

        let mut tx = self.pool.begin().await.map_err(|e| (e.into(), None))?;
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
        let def = exact_definition(&self.pool, &ae.action_key, ae.action_version)
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
                let def =
                    exact_definition(&self.pool, &existing.action_key, existing.action_version)
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
        let eval = match self.evaluate(actor, def, &target).await {
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
            return Err((
                match reason {
                    ReasonCode::ScopeGuardFailed | ReasonCode::PermissionDenied => {
                        Refusal::Denied(reason)
                    }
                    other => Refusal::Precondition(other),
                },
                op,
            ));
        }

        // 目标事实的门禁在授权之后判定：无权者先得到 PERMISSION_DENIED，而不是借
        // 这一步探出「谁是最后一位 admin」。审批前也要判定——一个注定不成立的
        // 动作不该去占用审批人。
        let gate = match self.pool.acquire().await {
            Ok(mut conn) => {
                self.target_gate(&mut conn, ae.tenant_id, def, sem, params)
                    .await
            }
            Err(e) => Err(e.into()),
        };
        match gate {
            Ok(()) => {}
            Err(r @ (Refusal::Conflict(_) | Refusal::Precondition(_) | Refusal::Denied(_))) => {
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
        // EXPLICIT 确认需要一个预览—确认两段式的入口，本切片的定义都不使用它；
        // 登记了也不能静默当成 NONE
        if def.confirmation_mode != "NONE" {
            return Err((Refusal::Blocked(ReasonCode::CapabilityBlocked), op));
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
            Err(r @ (Refusal::Conflict(_) | Refusal::Precondition(_) | Refusal::Denied(_))) => {
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
    async fn close_gate(
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
        // 会改变有效 Tenant admin 的动作先取 Tenant 行锁，其后的判定与写入都在锁内
        // （DD-82）。锁序固定为 ActionExecution → Tenant，与派发一致。
        if sem.serializes_on_tenant() && !crate::roles::lock_tenant(tx, ae.tenant_id).await? {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let target = resolve_target(
            &mut *tx,
            ae.tenant_id,
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
        self.target_gate(&mut *tx, ae.tenant_id, def, sem, params)
            .await?;
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
                eval.zed_token.as_deref(),
                None,
            )
            .await?;
            let mut evidence = zed_evidence(eval.zed_token.as_deref());
            if let (Some(arr), Some(a)) = (evidence.as_array_mut(), &ae.approval_workflow_id) {
                arr.push(json!({ "kind": "APPROVAL_WORKFLOW_ID", "value": a }));
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
                        json!([{ "kind": "TENANT_INVITATION_ID", "value": ae.target_id }]),
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
                        json!([{ "kind": "TENANT_INVITATION_ID", "value": target.id }]),
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
        let version: i32 = match sem {
            Semantic::WorkspaceCreate => {
                sqlx::query_scalar(
                    "insert into identity.workspace (id, tenant_id, slug, name, state)
                     values ($1, $2, $3, $4, 'PROVISIONING') returning version",
                )
                .bind(target.id)
                .bind(ae.tenant_id)
                .bind(&params.slug)
                .bind(&params.name)
                .fetch_one(&mut **tx)
                .await?
            }
            Semantic::WorkspaceMemberAdd if target.version == 0 => {
                sqlx::query_scalar(
                    "insert into identity.workspace_membership (id, workspace_id, tenant_principal_id, state)
                     values ($1, $2, $3, 'PROVISIONING') returning version",
                )
                .bind(target.id)
                .bind(params.workspace_id)
                .bind(params.principal_id)
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
                kailo_identity::session::revoke_for_membership(tx, target.id).await?;
                v
            }
            // 角色与邀请动作是 SYNC，已在上面返回；走到这里说明目录把它登记成了别的
            // 执行方式
            Semantic::TenantRoleGrant
            | Semantic::TenantRoleRevoke
            | Semantic::WorkspaceRoleGrant
            | Semantic::WorkspaceRoleRevoke
            | Semantic::TenantMemberInvite
            | Semantic::TenantMemberInviteRevoke => {
                return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked))
            }
        };
        let workflow_id =
            component_task::workflow_id(kind, ae.tenant_id, &target.id.to_string(), version);
        component_task::prewrite(tx, &workflow_id, kind, ae.tenant_id, ae.operation_id, ae.id)
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
            eval.zed_token.as_deref(),
            None,
        )
        .await?;
        let mut evidence = zed_evidence(eval.zed_token.as_deref());
        if let Some(arr) = evidence.as_array_mut() {
            arr.push(json!({ "kind": "TEMPORAL_WORKFLOW_ID", "value": workflow_id }));
            if let Some(a) = &ae.approval_workflow_id {
                arr.push(json!({ "kind": "APPROVAL_WORKFLOW_ID", "value": a }));
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
    /// 在准入事务里完成的同步动作的 DISPATCH 与 OUTCOME 审计：它们没有外部副作用，
    /// 「派发」就是同一事务里那次 Core 写入，两条事实与门禁一起成立。
    async fn record_local_outcome(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        ae: &Execution,
        def: &Definition,
        outcome: &str,
        evidence: Value,
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
    /// 目标在权威处的事实是否允许这次变更。角色的事实在 SpiceDB，成员的事实在
    /// Core；二者与「有效 Tenant admin 不得为空」一起在这里判定。
    ///
    /// 准入（无锁，给出早拒绝）与落定（持有 Tenant 行锁）各调一次；只有后一次的
    /// 结论与随后的写入之间没有缝。
    async fn target_gate(
        &self,
        conn: &mut sqlx::PgConnection,
        tenant: Uuid,
        def: &Definition,
        sem: Semantic,
        p: &Params,
    ) -> Result<(), Refusal> {
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
        if let Some(arr) = evidence.as_array_mut() {
            for r in &rels {
                arr.push(json!({ "kind": "SPICEDB_RELATIONSHIP", "value": format!(
                    "{}:{}#{}@principal:{}", r.object_type, r.object_id, r.relation, r.subject_principal) }));
            }
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

fn zed_evidence(token: Option<&str>) -> Value {
    match token {
        Some(t) if !t.is_empty() => json!([{ "kind": "SPICEDB_ZEDTOKEN", "value": t }]),
        _ => json!([]),
    }
}

/// 把一条 ActionExecution 写成 BFF 回应。门禁未决或已派发都是 2xx；结果不明
/// 用 202 并带 dispatchState=UNKNOWN，不说成功也不说失败。
fn submission_result(
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
        "DENIED" => Err((
            match reason() {
                r @ (ReasonCode::ScopeGuardFailed
                | ReasonCode::PermissionDenied
                | ReasonCode::ApprovalDenied) => Refusal::Denied(r),
                r @ ReasonCode::TargetStateConflict => Refusal::Conflict(r),
                r => Refusal::Precondition(r),
            },
            op,
        )),
        "ALLOWED" if ae.dispatch_state == "DISPATCHED" => Ok((StatusCode::OK, ae.submission())),
        _ => Ok((StatusCode::ACCEPTED, ae.submission())),
    }
}

// ---------------------------------------------------------------------------
// 派发
// ---------------------------------------------------------------------------

impl Governance {
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
        let def = exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
        let Some(sem) = Semantic::from_key(&def.action_key) else {
            return Ok(());
        };
        if def.execution_mode == "SYNC" {
            // 在准入事务里已完成的同步动作没有可派发的东西；走到这里只可能是角色
            return if sem.is_role() {
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
                Semantic::WorkspaceCreate => {
                    launch_scope(
                        &self.pool,
                        &self.temporal,
                        &ScopeLifecycleRequest {
                            kind: ScopeKind::Workspace,
                            id: ae.target_id,
                            action_execution_id: ae.id,
                        },
                    )
                    .await
                }
                Semantic::WorkspaceMemberAdd
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
                // 角色与邀请动作是 SYNC，在上面已分流；没有 Workflow 可启动
                Semantic::TenantRoleGrant
                | Semantic::TenantRoleRevoke
                | Semantic::WorkspaceRoleGrant
                | Semantic::WorkspaceRoleRevoke
                | Semantic::TenantMemberInvite
                | Semantic::TenantMemberInviteRevoke => Err(StatusCode::CONFLICT.into_response()),
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
        let (state, stage, result) = match outcome {
            Ok(()) => ("DISPATCHED", "dispatch", "DISPATCHED"),
            // 结果不明：只可能用同一 ID 收敛
            Err(StatusCode::SERVICE_UNAVAILABLE) => {
                ("UNKNOWN", "dispatch-unknown", "DISPATCH_RESULT_UNKNOWN")
            }
            // 确定的拒绝（被 Temporal 拒绝、实体已不在可启动状态）：本次派发中止
            Err(_) => ("ABORTED", "dispatch-aborted", "DISPATCH_ABORTED"),
        };
        let mut tx = self.pool.begin().await?;
        let updated = sqlx::query(
            "update admission.action_execution set dispatch_state = $2, updated_at = now()
             where id = $1 and gate_state = 'ALLOWED' and dispatch_state in ('NOT_DISPATCHED', 'UNKNOWN')",
        )
        .bind(ae.id)
        .bind(state)
        .execute(&mut *tx)
        .await?;
        if updated.rows_affected() > 0 {
            audit(
                &mut tx,
                &ae,
                &def,
                stage,
                "DISPATCH",
                "ALLOW",
                result,
                None,
                json!([{ "kind": "TEMPORAL_WORKFLOW_ID", "value": workflow_id }]),
            )
            .await?;
        }
        tx.commit().await?;
        if state == "DISPATCHED" && ae.approval_workflow_id.is_some() {
            self.consume(ae.id).await;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// 审批
// ---------------------------------------------------------------------------

impl Governance {
    async fn request_approval(
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
        // 冻结 Workspace；本切片的目标都没有 owner 事实。不换用更宽的角色。
        let resolvable = policy.owner_requirement == "NONE"
            && policy.role_requirements.iter().all(|r| match r.selector {
                ApprovalSelector::TenantAdmin => true,
                ApprovalSelector::WorkspaceAdmin => ae.workspace_id.is_some(),
                ApprovalSelector::ResourceApprover => false,
            });
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

        let workflow_id = approval_workflow_id(ae.tenant_id, ae.id);
        let mut tx = self.pool.begin().await.map_err(|e| (e.into(), op))?;
        let locked = lock_execution(&mut tx, ae.id)
            .await
            .map_err(|e| (e.into(), op))?;
        if locked.gate_state != "EVALUATING" {
            drop(tx);
            return submission_result(&locked);
        }
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
            eval.zed_token.as_deref(),
            Some(&ReasonCode::WaitingApproval),
        )
        .await
        .map_err(|e| (e.into(), op))?;
        let mut evidence = zed_evidence(eval.zed_token.as_deref());
        if let Some(arr) = evidence.as_array_mut() {
            arr.push(json!({ "kind": "APPROVAL_WORKFLOW_ID", "value": workflow_id }));
            arr.push(json!({ "kind": "APPROVAL_POLICY", "value": format!("{}@{}", policy.id, policy.version) }));
        }
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
    async fn approval_input(&self, ae: &Execution) -> Result<ApprovalWorkflowInput, Refusal> {
        let def = exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
        let (Some(pid), Some(pver)) = (def.approval_policy_id, def.approval_policy_version) else {
            return Err(Refusal::Unavailable("审批动作的定义缺策略".into()));
        };
        let policy = exact_policy(&self.pool, pid, pver).await?;
        let expires = ae
            .approval_expires_at
            .ok_or_else(|| Refusal::Unavailable("WAITING 缺冻结的过期时刻".into()))?;
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
            affected_owner_refs: vec![],
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
        let def = exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
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
        let eval = self.evaluate(actor, &def, &target).await?;
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
            let def = exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
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
                json!([{ "kind": "APPROVAL_WORKFLOW_ID", "value": ae.approval_workflow_id }]),
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
             where approval_workflow_id = $1 for update"
        ))
        .bind(&report.workflow_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some(ae) = ae else {
            return Ok(Applied::UnknownWorkflow);
        };
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

        let def = exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
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
                    evidence_refs: json!([
                        { "kind": "APPROVAL_WORKFLOW_ID", "value": report.workflow_id },
                        { "kind": "TEMPORAL_RUN_ID", "value": report.run_id },
                    ]),
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
            json!([
                { "kind": "APPROVAL_WORKFLOW_ID", "value": report.workflow_id },
                { "kind": "TEMPORAL_RUN_ID", "value": report.run_id },
            ]),
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
                 where id = $1 and gate_state = 'WAITING'",
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
        let def = exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
        let (Some(pid), Some(pver)) = (def.approval_policy_id, def.approval_policy_version) else {
            return Err(Refusal::Unavailable("审批动作的定义缺策略".into()));
        };
        let policy = exact_policy(&self.pool, pid, pver).await?;
        let approver = Uuid::parse_str(&req.approver_principal_id)
            .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;

        let refuse = |reason| FreshApprovalAdmissionResult {
            admitted: false,
            reason: Some(reason),
            satisfied_selectors: vec![],
        };
        // approver 必须是同 Tenant 的 active HUMAN，且 TenantMembership ACTIVE：
        // Agent、SERVICE、过期/失权 Human 的 Update 不形成决定（DD-47）
        let active: Option<i32> = sqlx::query_scalar(
            "select 1 from identity.principal p
             join identity.tenant_membership tm on tm.tenant_principal_id = p.id
             where p.id = $1 and p.tenant_id = $2 and p.kind = 'HUMAN' and p.status = 'ACTIVE'
               and tm.state = 'ACTIVE'",
        )
        .bind(approver)
        .bind(ae.tenant_id)
        .fetch_optional(&self.pool)
        .await?;
        let mut zed = None;
        let result = if active.is_none() {
            refuse(ReasonCode::ApproverNotEligible)
        } else if policy.self_approval == "DENY" && approver == ae.initiator_principal_id {
            // 职责分离：发起者不能批准也不能否决自己的请求
            refuse(ReasonCode::SelfApprovalDenied)
        } else {
            let mut satisfied = vec![];
            for r in &policy.role_requirements {
                let object = match r.selector {
                    ApprovalSelector::TenantAdmin => Some(("tenant", ae.tenant_id)),
                    ApprovalSelector::WorkspaceAdmin => ae.workspace_id.map(|w| ("workspace", w)),
                    // 目标不是 Resource：没有可 Check 的对象，fail closed
                    ApprovalSelector::ResourceApprover => None,
                };
                let Some((ty, id)) = object else { continue };
                let c = self
                    .spicedb
                    .check(
                        ty,
                        &id.to_string(),
                        "manage",
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
            if satisfied.is_empty() {
                refuse(ReasonCode::ApproverNotEligible)
            } else {
                FreshApprovalAdmissionResult {
                    admitted: true,
                    reason: None,
                    satisfied_selectors: satisfied,
                }
            }
        };

        let mut tx = self.pool.begin().await?;
        let result_code = result
            .reason
            .as_ref()
            .map(wire)
            .unwrap_or_else(|| "ADMITTED".into());
        let mut evidence = zed_evidence(zed.as_deref());
        if let Some(arr) = evidence.as_array_mut() {
            arr.push(json!({ "kind": "APPROVAL_WORKFLOW_ID", "value": req.approval_workflow_id }));
        }
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
            // 判定中途崩溃或依赖长时间不可用：意图过期，不替发起者猜结论
            ("EVALUATING", _) if stale => {
                let def = exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
                let eval = Evaluation {
                    allowed: false,
                    scope: "NOT_APPLICABLE",
                    authorization: "NOT_APPLICABLE",
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
                let def = exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
                let eval = Evaluation {
                    allowed: false,
                    scope: "NOT_APPLICABLE",
                    authorization: "NOT_APPLICABLE",
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
        Some(zed_token),
        None,
    )
    .await
}
