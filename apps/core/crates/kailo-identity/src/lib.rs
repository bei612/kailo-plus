//! Identity/Scope 模块（`01-工程结构与模块边界.md` §3）。
//!
//! 它只做一件事：把 AgentGateway 投影进来的已验证 issuer/subject 解析成执行身份。
//! 解析失败一律 fail closed——不回退默认 Tenant、不自动建号、不接受调用方自报的
//! 任何字段（`00-实施总纲.md` §3.4、`.design/09`）。

pub mod session;

use contracts::{ErrorClass, ReasonCode, ResolvedIdentity};
use sqlx::PgPool;

/// 身份解析失败。每一种都带 `06-工程基线规范.md` §4 的分类与稳定 reason code。
#[derive(Debug, thiserror::Error)]
pub enum IdentityError {
    #[error("缺少内网身份 header")]
    HeaderMissing,
    #[error("issuer/subject 未对应任何 ExternalIdentity")]
    Unknown,
    #[error("TenantMembership 不是 ACTIVE")]
    MembershipNotActive,
    #[error("数据库不可用")]
    Unavailable(#[from] sqlx::Error),
}

impl IdentityError {
    /// 分类决定 HTTP 语义与是否可重试；reason code 进入 audit、UI 与告警。
    pub fn class(&self) -> ErrorClass {
        match self {
            // 身份不成立是拒绝，不是前置条件不满足——修配置不会让它通过
            Self::HeaderMissing | Self::Unknown | Self::MembershipNotActive => ErrorClass::Denied,
            // 依赖不可用时结果不明，不得当成拒绝：那会把可恢复故障写成永久否决
            Self::Unavailable(_) => ErrorClass::Unknown,
        }
    }

    pub fn reason(&self) -> Option<ReasonCode> {
        match self {
            Self::HeaderMissing => Some(ReasonCode::IdentityHeaderMissing),
            Self::Unknown => Some(ReasonCode::IdentityUnknown),
            Self::MembershipNotActive => Some(ReasonCode::TenantMembershipNotActive),
            Self::Unavailable(_) => None,
        }
    }
}

/// 从已验证的 issuer/subject 解析执行身份。
///
/// 两个参数必须都来自 AgentGateway 的 header 投影。调用方不得从请求体、
/// 查询串或任何 Browser 可控位置取值——那会让网关的投影形同虚设。
pub async fn resolve(
    pool: &PgPool,
    issuer: Option<&str>,
    subject: Option<&str>,
) -> Result<ResolvedIdentity, IdentityError> {
    // 缺任一条即拒绝。CEL 求值失败时网关会删除目标 header，
    // 因此「缺失」正是 fail-closed 链路上预期的信号（SS-AGW-OIDC）。
    let (issuer, subject) = match (issuer, subject) {
        (Some(i), Some(s)) if !i.is_empty() && !s.is_empty() => (i, s),
        _ => return Err(IdentityError::HeaderMissing),
    };

    // 一次查询走完 ExternalIdentity → HumanIdentity → TenantMembership → Principal。
    // 只接受两侧都 ACTIVE 的行：停用的身份不得取得任何执行上下文。
    let row = sqlx::query!(
        r#"
        select tm.id           as tenant_membership_id,
               tm.tenant_id    as tenant_id,
               tm.tenant_principal_id as tenant_principal_id,
               hi.id           as human_identity_id,
               tm.state        as membership_state
        from identity.external_identity ei
        join identity.human_identity hi on hi.id = ei.human_identity_id
        join identity.tenant_membership tm on tm.human_identity_id = hi.id
        where ei.issuer = $1 and ei.subject = $2
          and ei.status = 'ACTIVE' and hi.status = 'ACTIVE'
        "#,
        issuer,
        subject
    )
    .fetch_optional(pool)
    .await?;

    let row = row.ok_or(IdentityError::Unknown)?;
    if row.membership_state != "ACTIVE" {
        return Err(IdentityError::MembershipNotActive);
    }

    Ok(ResolvedIdentity {
        human_identity_id: row.human_identity_id.to_string(),
        tenant_id: row.tenant_id.to_string(),
        tenant_membership_id: row.tenant_membership_id.to_string(),
        tenant_principal_id: row.tenant_principal_id.to_string(),
        current_workspace_id: None,
    })
}
