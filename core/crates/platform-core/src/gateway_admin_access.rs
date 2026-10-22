//! DD-134(2)：网关管理区的范围与授权。
//!
//! 范围取会话 Tenant：Platform Catalog 会话是 `PLATFORM`，业务 Tenant 会话是
//! `TENANT`。本模块给出各分区共用的 fresh 授权判定；`GatewayAccess` 只决定入口与
//! 按钮是否呈现，每个查询仍各自重做授权，前端隐藏不构成授权。

use axum::{
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use contracts::{GatewayAccess, GatewayAdminScope, ReasonCode};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::{Actor, Refusal, Target};
use crate::spicedb::Consistency;

/// 一次请求的调用者与范围。
pub(crate) struct Caller {
    pub ctx: ExecutionContext,
    pub platform: bool,
}

impl Caller {
    pub(crate) fn actor(&self) -> Actor {
        Actor {
            tenant_id: self.ctx.tenant_id,
            principal_id: self.ctx.tenant_principal_id,
            human_identity_id: Some(self.ctx.human_identity_id),
        }
    }
}

/// 解析执行身份与范围；失败即可下发的响应。
pub(crate) async fn caller(state: &BffState, headers: &HeaderMap) -> Result<Caller, Response> {
    let ctx = resolve_execution_context(state, headers).await?;
    let platform = async {
        let mut conn = state.pool.acquire().await?;
        crate::platform_bootstrap::is_catalog_tenant(&mut conn, ctx.tenant_id).await
    }
    .await
    .map_err(|error| Refusal::from(error).respond(None))?;
    Ok(Caller { ctx, platform })
}

fn unavailable() -> Refusal {
    Refusal::Unavailable("gateway admin authorization unavailable".into())
}

/// FullyConsistent 检查；空 ZedToken 视为不可查证。
pub(crate) async fn check(
    state: &BffState,
    object_type: &str,
    object_id: Uuid,
    permission: &str,
    principal: Uuid,
) -> Result<bool, Refusal> {
    let checked = state
        .governance
        .spicedb
        .check(
            object_type,
            &object_id.to_string(),
            permission,
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| unavailable())?;
    if checked.zed_token.is_empty() {
        return Err(unavailable());
    }
    Ok(checked.allowed)
}

/// 平台范围：Catalog 会话且对 Catalog Tenant 持有 `permission`；`manage` 另要求
/// active HUMAN（与组件发行目录同一判定）。
pub(crate) async fn require_platform(
    state: &BffState,
    caller: &Caller,
    permission: &str,
) -> Result<(), Refusal> {
    if !caller.platform {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    if permission == "manage" {
        let mut conn = state.pool.acquire().await?;
        if !crate::agent_definition::active_owner(
            &mut conn,
            caller.ctx.tenant_id,
            caller.ctx.tenant_principal_id,
        )
        .await?
        {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    if !check(
        state,
        "tenant",
        caller.ctx.tenant_id,
        permission,
        caller.ctx.tenant_principal_id,
    )
    .await?
    {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

/// Tenant 范围：业务 Tenant 会话，对 Tenant（或其中所选 Workspace）持有 `permission`。
/// Workspace 必须先属于本 Tenant，跨 Tenant ID 不进入授权判定。
pub(crate) async fn require_tenant(
    state: &BffState,
    caller: &Caller,
    workspace: Option<Uuid>,
    permission: &str,
) -> Result<(), Refusal> {
    if caller.platform {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    if let Some(workspace) = workspace {
        let belongs: Option<i32> = sqlx::query_scalar(
            "select 1 from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE'",
        )
        .bind(workspace)
        .bind(caller.ctx.tenant_id)
        .fetch_optional(&state.pool)
        .await?;
        if belongs.is_none() {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
    }
    let (kind, id) = match workspace {
        Some(workspace) => ("workspace", workspace),
        None => ("tenant", caller.ctx.tenant_id),
    };
    if !check(state, kind, id, permission, caller.ctx.tenant_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    Ok(())
}

/// 统计、调用与下钻的授权：平台范围 Catalog `audit`，Tenant 范围 Tenant/Workspace `audit`。
pub(crate) async fn require_audit(
    state: &BffState,
    caller: &Caller,
    workspace: Option<Uuid>,
) -> Result<(), Refusal> {
    if caller.platform {
        if workspace.is_some() {
            return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
        }
        require_platform(state, caller, "audit").await
    } else {
        require_tenant(state, caller, workspace, "audit").await
    }
}

/// 既有动作的准入预评估（只读提示，提交时重新准入）。
pub(crate) async fn action_allowed(
    state: &BffState,
    caller: &Caller,
    action_key: &str,
    target: &Target,
) -> Result<bool, Refusal> {
    if !crate::capability_registry::action_exposed(action_key) {
        return Ok(false);
    }
    let Some(definition) = crate::governance::active_definition(&state.pool, action_key).await?
    else {
        return Ok(false);
    };
    let decision = state
        .governance
        .evaluate(caller.actor(), &definition, target)
        .await?;
    Ok(decision.allowed
        && decision
            .zed_token
            .as_deref()
            .is_some_and(|token| !token.is_empty()))
}

async fn access(state: &BffState, caller: &Caller) -> Result<GatewayAccess, Refusal> {
    let principal = caller.ctx.tenant_principal_id;
    let tenant = caller.ctx.tenant_id;
    if caller.platform {
        let audit = check(state, "tenant", tenant, "audit", principal).await?;
        let manage = match require_platform(state, caller, "manage").await {
            Ok(()) => true,
            Err(Refusal::Denied(_)) => false,
            Err(error) => return Err(error),
        };
        return Ok(GatewayAccess {
            scope: GatewayAdminScope::Platform,
            tenant_id: tenant.to_string(),
            can_read_stats: audit,
            can_read_tools: false,
            can_read_model_routes: false,
            can_create_model_route: false,
            can_read_config: audit,
            can_manage_mcp: manage,
            can_bind_mcp: false,
        });
    }
    let audit = check(state, "tenant", tenant, "audit", principal).await?;
    let discover = check(state, "tenant", tenant, "discover", principal).await?;
    let tenant_target = Target {
        id: tenant,
        version: 0,
        workspace_id: None,
    };
    let create_route = action_allowed(state, caller, "llm_route.create", &tenant_target).await?;
    let bind = action_allowed(state, caller, "application_binding.create", &tenant_target).await?;
    Ok(GatewayAccess {
        scope: GatewayAdminScope::Tenant,
        tenant_id: tenant.to_string(),
        can_read_stats: audit,
        can_read_tools: discover,
        can_read_model_routes: discover,
        can_create_model_route: create_route,
        can_read_config: false,
        can_manage_mcp: false,
        can_bind_mcp: bind,
    })
}

/// `GET /api/v1/gateway/access`
pub(crate) async fn get(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match access(&state, &caller).await {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}
