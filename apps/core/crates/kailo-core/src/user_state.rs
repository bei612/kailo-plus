//! CollaborationUserState（`.design/03` §2、`DD-40`）。
//!
//! 收藏、静音、已读的唯一权威在 Core，三端共用。Web 上这是必须的——服务端不
//! 保留用户解密私钥，原来的 NIP-44 同步路走不通；原生端本地持钥、自己能解密，
//! 但仍以 Core 为准，那是三端一致与可撤权的要求。
//!
//! 键的合法性在写入时校验，不在读取时过滤：读时过滤会让库里长期存着一堆指向
//! 不可见 Workspace 的偏好，撤权之后它们仍在，只是看不见——而「看不见」和
//! 「不存在」在对账时是两件事。

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState, ExecutionContext};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserStateResponse {
    pub workspace_preferences: serde_json::Value,
    pub read_contexts: serde_json::Value,
    pub version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePreference {
    pub starred: bool,
    pub muted: bool,
    /// 读到的版本。不匹配即冲突——三端并发改同一份偏好时，后写的不能凭空
    /// 覆盖先写的（`01` §7）。
    pub version: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadMark {
    /// 只接受该 HUMAN 当前可读 Workspace 内的 Channel ID 或 `msg:<Buzz event id>`
    pub context_key: String,
    pub last_read_at: String,
    pub version: i32,
}

pub async fn get_user_state(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match sqlx::query!(
        "select workspace_preferences, read_contexts, version
         from identity.collaboration_user_state where tenant_principal_id = $1",
        ctx.tenant_principal_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        // 没有行不是错误：一个还没设过任何偏好的人，状态就是空。
        // 建空行留给第一次写入——读取不产生副作用。
        Ok(None) => (
            StatusCode::OK,
            Json(UserStateResponse {
                workspace_preferences: serde_json::json!({}),
                read_contexts: serde_json::json!({}),
                version: 0,
            }),
        )
            .into_response(),
        Ok(Some(row)) => (
            StatusCode::OK,
            Json(UserStateResponse {
                workspace_preferences: row.workspace_preferences,
                read_contexts: row.read_contexts,
                version: row.version,
            }),
        )
            .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "读用户状态失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// 设置某个 Workspace 的收藏/静音。
pub async fn put_workspace_preference(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<WorkspacePreference>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 键必须是该 HUMAN 可发现的同 Tenant Workspace。校验在写入路径上，因此
    // 撤权之后再写同一个键会被拒——而不是写进去等读取时过滤掉。
    if let Err(r) = require_visible_workspace(&state, &ctx, workspace_id).await {
        return r;
    }

    // updatedAt 由 upsert 用库时钟补上，不取调用方的值：三端时钟不一致时，
    // 用谁的都会让「最后更新」这件事变得不可比较。
    let value = serde_json::json!({
        "starred": req.starred,
        "muted": req.muted,
    });
    upsert(
        &state,
        &ctx,
        req.version,
        "workspace_preferences",
        &workspace_id.to_string(),
        value,
        Stamp::UpdatedAt,
    )
    .await
}

/// 标记某个上下文的已读位置。
pub async fn put_read_mark(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<ReadMark>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // `.design/03` §4 固定了两种取值：可读 Workspace 内的 Channel ID，
    // 或 `msg:<Buzz event id>`。其余一律拒绝——放开键空间等于给用户状态
    // 表开了一个任意写入面。
    let channel = match req.context_key.strip_prefix("msg:") {
        Some(event_id) => {
            if event_id.len() != 64 || !event_id.chars().all(|c| c.is_ascii_hexdigit()) {
                tracing::warn!(key = %req.context_key, "msg: 前缀后不是 Buzz event id");
                return StatusCode::BAD_REQUEST.into_response();
            }
            // `msg:` 形式不绑定具体 Channel：它指向一条事件，而该事件所属的
            // Channel 由 Relay 决定。可见性因此退到「该 HUMAN 至少有一个
            // active WorkspaceMembership」——更细的判定要按 event 反查 Channel，
            // 那是 stream 面闭合之后才有的能力。
            None
        }
        None => match req.context_key.parse::<Uuid>() {
            Ok(id) => Some(id),
            Err(_) => {
                tracing::warn!(key = %req.context_key, "context_key 既不是 UUID 也不是 msg: 形式");
                return StatusCode::BAD_REQUEST.into_response();
            }
        },
    };

    match channel {
        Some(channel_id) => {
            if let Err(r) = require_visible_channel(&state, &ctx, channel_id).await {
                return r;
            }
        }
        None => {
            if let Err(r) = require_any_workspace(&state, &ctx).await {
                return r;
            }
        }
    }

    // 三端读写同一个值，格式必须是一个：RFC 3339，统一存成 UTC。不校验，
    // 一端写进去的任意字符串在另一端就是解析不了的垃圾。
    let Ok(last_read_at) = chrono::DateTime::parse_from_rfc3339(&req.last_read_at) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let last_read_at = last_read_at
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true);
    upsert(
        &state,
        &ctx,
        req.version,
        "read_contexts",
        &req.context_key,
        serde_json::json!(last_read_at),
        Stamp::None,
    )
    .await
}

/// 写入时是否由库时钟补一个 `updatedAt`。
#[derive(Clone, Copy)]
enum Stamp {
    None,
    UpdatedAt,
}

/// 带乐观并发的单键写入。
///
/// `jsonb_set` 而不是整体替换：三端会并发改不同的键，整体替换会让后写的把
/// 先写的其余键一起抹掉——而版本号只能发现冲突，发现不了"丢了别的键"。
async fn upsert(
    state: &BffState,
    ctx: &ExecutionContext,
    expected_version: i32,
    column: &str,
    key: &str,
    value: serde_json::Value,
    stamp: Stamp,
) -> Response {
    // 列名来自本模块的两个调用点，不来自请求；这里只在两个字面量之间选。
    // 时间戳用库时钟：多副本 Core 的进程时钟不保证一致（与 session 同一条规则）。
    let value_sql = match stamp {
        Stamp::None => "$3::jsonb",
        Stamp::UpdatedAt => "($3::jsonb || jsonb_build_object('updatedAt', now()))",
    };
    let sql = format!(
        "insert into identity.collaboration_user_state
             (tenant_principal_id, {column}, version, updated_at)
         values ($1, jsonb_build_object($2::text, {value_sql}), 1, now())
         on conflict (tenant_principal_id) do update set
             {column} = jsonb_set(
                 identity.collaboration_user_state.{column}, array[$2::text], {value_sql}, true),
             version = identity.collaboration_user_state.version + 1,
             updated_at = now()
         where identity.collaboration_user_state.version = $4
         returning version"
    );
    match sqlx::query_scalar::<_, i32>(&sql)
        .bind(ctx.tenant_principal_id)
        .bind(key)
        .bind(&value)
        .bind(expected_version)
        .fetch_optional(&state.pool)
        .await
    {
        Ok(Some(version)) => (
            StatusCode::OK,
            Json(serde_json::json!({ "version": version })),
        )
            .into_response(),
        // 没有返回行只有一种成因：已存在的行版本与期望不符。
        Ok(None) => StatusCode::CONFLICT.into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "写用户状态失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

async fn require_visible_workspace(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Uuid,
) -> Result<(), Response> {
    let ok = sqlx::query_scalar!(
        "select 1 from identity.workspace w
         join identity.workspace_membership wm
           on wm.workspace_id = w.id and wm.tenant_principal_id = $2 and wm.state = 'ACTIVE'
         where w.id = $1 and w.tenant_id = $3 and w.state = 'ACTIVE'",
        workspace_id,
        ctx.tenant_principal_id,
        ctx.tenant_id,
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Workspace 可见性查询失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;
    ok.map(|_| ()).ok_or_else(|| {
        tracing::warn!(workspace = %workspace_id, "Workspace 对该 Principal 不可见");
        StatusCode::FORBIDDEN.into_response()
    })
}

async fn require_visible_channel(
    state: &BffState,
    ctx: &ExecutionContext,
    channel_id: Uuid,
) -> Result<(), Response> {
    let ok = sqlx::query_scalar!(
        "select 1 from projection.workspace_buzz_binding b
         join identity.workspace w on w.id = b.workspace_id
         join identity.workspace_membership wm
           on wm.workspace_id = w.id and wm.tenant_principal_id = $2 and wm.state = 'ACTIVE'
         where b.channel_id = $1 and b.state = 'ACTIVE'
           and w.tenant_id = $3 and w.state = 'ACTIVE'",
        channel_id,
        ctx.tenant_principal_id,
        ctx.tenant_id,
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Channel 可见性查询失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;
    ok.map(|_| ()).ok_or_else(|| {
        tracing::warn!(channel = %channel_id, "Channel 对该 Principal 不可见");
        StatusCode::FORBIDDEN.into_response()
    })
}

async fn require_any_workspace(state: &BffState, ctx: &ExecutionContext) -> Result<(), Response> {
    let ok = sqlx::query_scalar!(
        "select 1 from identity.workspace_membership wm
         join identity.workspace w on w.id = wm.workspace_id
         where wm.tenant_principal_id = $1 and wm.state = 'ACTIVE'
           and w.tenant_id = $2 and w.state = 'ACTIVE'
         limit 1",
        ctx.tenant_principal_id,
        ctx.tenant_id,
    )
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Workspace 成员查询失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;
    ok.map(|_| ()).ok_or_else(|| {
        tracing::warn!(principal = %ctx.tenant_principal_id, "该 Principal 没有任何可读 Workspace");
        StatusCode::FORBIDDEN.into_response()
    })
}
