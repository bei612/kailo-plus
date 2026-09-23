//! Buzz Web 的 Relay 边界替换（`SS-WEB-RELAY`、`DD-39`）。
//!
//! Browser 只发类型化的语义命令，不发 raw signed event，也不发任意 Relay filter。
//! 它不接收 Relay URL、不接收 Nostr 私钥、不生成 NIP-42/NIP-98/NIP-44。
//!
//! 每次调用的顺序是固定的，且不能换：
//!
//! 1. 以网关投影的 issuer/subject 重新解析身份并取 active PlatformSession——
//!    撤权因此对下一个请求立刻生效；
//! 2. Workspace 必须 `ACTIVE`，且该 HUMAN 有 active WorkspaceMembership
//!    （`.design/03` §4 的 HUMAN scope guard）；
//! 3. 以该 HUMAN 的 `BuzzIdentityBinding` 代签发布，发布前不读任何 Browser 可控
//!    的身份字段。
//!
//! 反过来做——先签名再查 scope——就会在 Relay 上留下一条本不该存在的事件，
//! 而事件发出去就收不回来了。

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use kailo_buzz::bridge::{Custody, IdentityClient};
use kailo_secrets::SecretRef;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};

#[derive(Debug, Deserialize)]
pub struct PublishRequest {
    /// 消息正文。它是业务数据，进 Relay 不进 Core——Core 只存 scope、owner、
    /// binding、准入、投影、审计与外部引用（`.design/01`）。
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResponse {
    /// Relay 接受后回传的 event id。它是 operation outcome 与 audit evidence
    /// （`.design/09` 第 6 步），不是本地算出来的值。
    pub event_id: String,
    pub operation_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct QueryResponse {
    pub events: serde_json::Value,
}

/// 发一条 Workspace 消息。
pub async fn publish_message(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<PublishRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let scope = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match identity_client(&state, &keys, &scope) {
        Ok(c) => c,
        Err(r) => return r,
    };

    let event_id = match client
        .publish_channel_message(&state.http, &scope.channel_id, &req.content)
        .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::warn!(error = %e, "发布被 Relay 拒绝或结果不明");
            // 不区分拒绝与不明：两者对调用方的下一步都是「别当成已发出」。
            // 真要区分得先能查证该 event 是否落库，而那要 event id——恰恰是
            // 这次没拿到的东西。
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };

    // 退出门禁要求「每次消息动作可关联 actor、scope、operation、Buzz event 与
    // AuditEvent」。五者在这一条记录里齐了：actor 是 principal，scope 是
    // tenant+workspace，operation 是 operation_id，Buzz event 进 evidence。
    let operation_id = Uuid::new_v4();
    let entry = AuditEntry {
        event_key: format!("message.publish:{event_id}"),
        tenant_id: Some(ctx.tenant_id),
        workspace_id: Some(workspace_id),
        operation_id,
        event_type: "OUTCOME",
        human_identity_id: Some(ctx.human_identity_id),
        initiator_principal_id: Some(ctx.tenant_principal_id),
        actor_principal_id: Some(ctx.tenant_principal_id),
        action_key: "workspace.message.publish",
        action_version: 1,
        component_type_key: "buzz",
        target_type: Some("CHANNEL"),
        target_id: Some(workspace_id),
        // 正文不进审计。摘要也不进：它对正文可做字典攻击，而审计要的是
        // 「谁在哪里做了什么」，不是「说了什么」（`.design/03` §9）。
        parameter_hash: "NONE",
        decision: "ALLOW",
        result_code: "ACCEPTED",
        result_exposure: "NONE",
        evidence_refs: serde_json::json!([
            { "kind": "BUZZ_EVENT_ID", "value": event_id },
            { "kind": "PLATFORM_SESSION_ID", "value": ctx.session_id },
        ]),
        correlation_id: operation_id,
    };
    match state.pool.begin().await {
        Ok(mut tx) => {
            if let Err(e) = append(&mut tx, entry).await {
                tracing::warn!(error = %e, "消息审计未写入");
            } else if let Err(e) = tx.commit().await {
                tracing::warn!(error = %e, "消息审计未提交");
            }
        }
        Err(e) => tracing::warn!(error = %e, "消息审计未写入"),
    }

    (
        StatusCode::OK,
        Json(PublishResponse {
            event_id,
            operation_id,
        }),
    )
        .into_response()
}

/// 读该 Workspace 的历史消息。
///
/// filter 由 Core 构造，Browser 不提交任何 filter。`DD-39` 明写 Browser「不能
/// 提交 raw signed event 或任意 Relay filter 绕过语义命令」——放开 filter 就等于
/// 把 Relay 的查询面原样暴露给浏览器，scope 边界随之失效。
pub async fn query_messages(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let scope = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match identity_client(&state, &keys, &scope) {
        Ok(c) => c,
        Err(r) => return r,
    };

    // kind 9 是 NIP-29 的频道消息；`#h` 把结果限定在该 Workspace 的 Channel 内。
    // limit 取部署登记的上界，不接受调用方指定——NIP-11 声明的 1000 是 Relay 的
    // 上限，不是平台该放行的值（`.design/09` 第 4 步）。
    let filter = serde_json::json!({
        "kinds": [9],
        "#h": [scope.channel_id],
        "limit": state.message_page_limit,
    });
    match client.query(&state.http, &[filter]).await {
        Ok(events) => (StatusCode::OK, Json(QueryResponse { events })).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "查询历史失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// 一次 Workspace 准入通过后确定下来的事实。
pub struct WorkspaceScope {
    pub channel_id: String,
    pub community_host: String,
    /// WorkspaceMembership 的版本。它进 stream 的 generation：撤权与重新授权
    /// 都会推进版本，因此旧 generation 必然对不上，客户端拿不着一条本不该
    /// 继续的流（重新授权创建新 membership version，不复活旧投影——`.design/10` §4）。
    pub version: i32,
}

/// HUMAN 的 Workspace scope guard（`.design/03` §4）。
///
/// Stage 1 只走「有 active WorkspaceMembership」这条：另一条「fresh SpiceDB Check
/// 证明 workspace `manage`」要 Core 侧的 SpiceDB 客户端，那属于 Stage 2 的 fresh
/// Check 面。这里不写一个恒为假的分支冒充它——没实现的路径不存在，比存在但永远
/// 走不到好。
pub async fn admit_workspace(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Uuid,
) -> Result<WorkspaceScope, Response> {
    let row = sqlx::query!(
        "select b.channel_id, t.normalized_host, wm.version
         from identity.workspace w
         join identity.workspace_membership wm
           on wm.workspace_id = w.id and wm.tenant_principal_id = $2 and wm.state = 'ACTIVE'
         join projection.workspace_buzz_binding b
           on b.workspace_id = w.id and b.state = 'ACTIVE'
         join projection.tenant_buzz_binding t
           on t.tenant_id = w.tenant_id and t.state = 'ACTIVE'
         where w.id = $1 and w.tenant_id = $3 and w.state = 'ACTIVE'",
        workspace_id,
        ctx.tenant_principal_id,
        ctx.tenant_id,
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Workspace 准入查询失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;

    // 一次查询同时要求：Workspace 属于该 Tenant 且 ACTIVE、该 HUMAN 有 active
    // WorkspaceMembership、两侧 Buzz binding 都 ACTIVE。任一不成立都返回同一个
    // 拒绝——分别报错会把「这个 Workspace 存在但你没权限」和「不存在」区分开，
    // 那本身就是一条可枚举的信息。
    let row = row.ok_or_else(|| {
        tracing::warn!(
            workspace = %workspace_id,
            principal = %ctx.tenant_principal_id,
            "Workspace 准入不通过"
        );
        StatusCode::FORBIDDEN.into_response()
    })?;
    Ok(WorkspaceScope {
        channel_id: row.channel_id.to_string(),
        community_host: row.normalized_host,
        version: row.version,
    })
}

/// 以该 HUMAN 的 BuzzIdentityBinding 构造代签客户端。
///
/// `custody=CLIENT` 的身份由原生端本机持钥直连 Relay，Core 手里没有那把钥匙。
/// 走到这里说明调用方是 Web 端而该身份是原生端托管——不拿别的身份凑合，
/// 当场拒绝（`DD-75`）。
/// 取该 HUMAN 的签名密钥。
///
/// 与构造 HTTP 客户端分开：实时订阅要用同一把钥匙另建 NIP-42 WebSocket 会话
/// （`.design/09` 第 4 步），两条路共用密钥取用与托管校验，不共用连接。
pub async fn actor_keys(state: &BffState, ctx: &ExecutionContext) -> Result<nostr::Keys, Response> {
    let row = sqlx::query!(
        "select custody, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN' and state = 'ACTIVE'",
        ctx.tenant_id,
        ctx.tenant_principal_id,
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "读 HUMAN binding 失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?
    .ok_or_else(|| {
        tracing::warn!(principal = %ctx.tenant_principal_id, "没有 ACTIVE 的 HUMAN Buzz 身份");
        StatusCode::FORBIDDEN.into_response()
    })?;

    if row.custody != "SERVER" {
        tracing::warn!(
            principal = %ctx.tenant_principal_id,
            custody = %row.custody,
            "该身份由客户端托管，Web 面不能代签"
        );
        return Err(StatusCode::FORBIDDEN.into_response());
    }

    let secret = SecretRef {
        locator: row.private_key_secret_ref.unwrap_or_default(),
        version: row.private_key_secret_version.unwrap_or_default() as u32,
        audience: row.private_key_secret_audience.unwrap_or_default(),
    };
    let key = state.secrets.read(&secret, "value").await.map_err(|e| {
        tracing::warn!(error = %e, "取 HUMAN 私钥失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;

    nostr::Keys::parse(key.expose()).map_err(|_| {
        tracing::warn!(principal = %ctx.tenant_principal_id, "HUMAN 私钥不可解析");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })
}

/// 用已取到的密钥构造 HTTP bridge 客户端。
// Response 本身较大，但这条路径每请求只走一次，装箱换来的间接寻址不值当
#[allow(clippy::result_large_err)]
pub fn identity_client(
    state: &BffState,
    keys: &nostr::Keys,
    scope: &WorkspaceScope,
) -> Result<IdentityClient, Response> {
    IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        &scope.community_host,
    )
    .map_err(|e| {
        tracing::warn!(error = %e, "构造代签客户端失败");
        StatusCode::FORBIDDEN.into_response()
    })
}
