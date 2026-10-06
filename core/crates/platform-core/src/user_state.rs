//! CollaborationUserState（`.design/03` §2、`DD-40`）。
//!
//! 收藏、静音、已读的唯一权威在 Core，三端共用。Web 上这是必须的——服务端不
//! 保留用户解密私钥，原来的 NIP-44 同步路走不通；原生端本地持钥、自己能解密，
//! 但仍以 Core 为准，那是三端一致与可撤权的要求。
//!
//! 写入时校验键，读取时按当前 scope 过滤 Workspace 偏好与频道/私聊已读位置。
//! 撤权不删除库中历史，也不改变状态版本；恢复成员关系后可继续使用原状态。
//! msg/thread 的可读性由 Relay 以本人 SERVER 身份查证，不借用 CONTROL 或其他 HUMAN。
//! CLIENT-only 身份缺少服务端事件查证凭据，不借用其他身份绕行。

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{
    ConversationPreferenceRequest, ReadMarkRequest, UserStateVersion, WorkspacePreferenceRequest,
};
use nostr::EventId;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState, ExecutionContext};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserStateResponse {
    pub workspace_preferences: serde_json::Value,
    pub conversation_preferences: serde_json::Value,
    pub read_contexts: serde_json::Value,
    pub version: i32,
}

#[derive(sqlx::FromRow)]
struct UserStateRow {
    workspace_preferences: serde_json::Value,
    conversation_preferences: serde_json::Value,
    read_contexts: serde_json::Value,
    version: i32,
}

pub async fn get_user_state(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match sqlx::query_as::<_, UserStateRow>(
        "select workspace_preferences, conversation_preferences, read_contexts, version
         from identity.collaboration_user_state where tenant_principal_id = $1",
    )
    .bind(ctx.tenant_principal_id)
    .fetch_optional(&state.pool)
    .await
    {
        // 没有行不是错误：一个还没设过任何偏好的人，状态就是空。
        // 建空行留给第一次写入——读取不产生副作用。
        Ok(None) => (
            StatusCode::OK,
            Json(UserStateResponse {
                workspace_preferences: serde_json::json!({}),
                conversation_preferences: serde_json::json!({}),
                read_contexts: serde_json::json!({}),
                version: 0,
            }),
        )
            .into_response(),
        Ok(Some(row)) => {
            let (Some(preferences), Some(conversation_preferences), Some(contexts)) = (
                row.workspace_preferences.as_object(),
                row.conversation_preferences.as_object(),
                row.read_contexts.as_object(),
            ) else {
                tracing::warn!("用户状态不符合数据库的对象形状约束");
                return user_state_unavailable();
            };
            let event_ids: HashSet<EventId> = contexts
                .keys()
                .filter_map(|key| {
                    key.strip_prefix("msg:")
                        .or_else(|| key.strip_prefix("thread:"))
                })
                .filter_map(|id| EventId::from_hex(id).ok())
                .collect();
            let readable_events = match readable_event_ids(&state, &ctx, &event_ids).await {
                Ok(events) => events,
                Err(r) => return r,
            };
            let mut workspace_ids: Vec<Uuid> = preferences
                .keys()
                .filter_map(|key| key.parse().ok())
                .collect();
            let mut channel_ids: Vec<Uuid> =
                contexts.keys().filter_map(|key| key.parse().ok()).collect();
            channel_ids.extend(readable_events.values().map(|(channel, _)| *channel));
            channel_ids.sort_unstable();
            channel_ids.dedup();
            let channels: Vec<(Uuid, Uuid)> = if channel_ids.is_empty() {
                Vec::new()
            } else {
                match sqlx::query_as(
                    "select b.channel_id, w.id from projection.workspace_buzz_binding b
                     join identity.workspace w on w.id = b.workspace_id
                     where b.channel_id = any($1) and b.state = 'ACTIVE'
                       and w.tenant_id = $2 and w.state = 'ACTIVE'",
                )
                .bind(&channel_ids)
                .bind(ctx.tenant_id)
                .fetch_all(&state.pool)
                .await
                {
                    Ok(rows) => rows,
                    Err(e) => {
                        tracing::warn!(error = %e, "读用户状态的 Channel 映射失败");
                        return user_state_unavailable();
                    }
                }
            };
            // 只读过频道、未设置收藏/静音时，仍须查证该频道所属 Workspace。
            workspace_ids.extend(channels.iter().map(|(_, workspace_id)| *workspace_id));
            workspace_ids.sort_unstable();
            workspace_ids.dedup();
            let admitted = match crate::web_transport::workspace_admissions(
                &state,
                &ctx,
                &workspace_ids,
            )
            .await
            {
                Ok(admitted) => admitted,
                Err(crate::web_transport::AdmissionFailure::Unavailable) => {
                    return user_state_unavailable()
                }
                Err(e) => return e.into_response(),
            };
            let mut visible_channels: std::collections::HashSet<Uuid> = channels
                .into_iter()
                .filter(|(_, workspace_id)| {
                    admitted
                        .get(workspace_id)
                        .is_some_and(|epoch| epoch.is_member())
                })
                .map(|(channel_id, _)| channel_id)
                .collect();
            match visible_conversation_channels(&state, &ctx, &channel_ids).await {
                Ok(channels) => visible_channels.extend(channels),
                Err(response) => return response,
            }
            let mut visible_preferences = serde_json::Map::new();
            for (key, preference) in conversation_preferences {
                let Ok(id) = key.parse::<Uuid>() else {
                    return user_state_unavailable();
                };
                match crate::conversations::admit(&state, &ctx, id).await {
                    Ok(_) => {
                        visible_preferences.insert(key.clone(), preference.clone());
                    }
                    Err(response) if response.status() == StatusCode::FORBIDDEN => {}
                    Err(response) => return response,
                }
            }
            (
                StatusCode::OK,
                Json(UserStateResponse {
                    workspace_preferences: serde_json::Value::Object(
                        preferences
                            .iter()
                            .filter(|(key, _)| {
                                key.parse::<Uuid>()
                                    .is_ok_and(|id| admitted.contains_key(&id))
                            })
                            .map(|(key, value)| (key.clone(), value.clone()))
                            .collect(),
                    ),
                    conversation_preferences: serde_json::Value::Object(visible_preferences),
                    read_contexts: serde_json::Value::Object(
                        contexts
                            .iter()
                            .filter(|(key, _)| {
                                if let Ok(id) = key.parse::<Uuid>() {
                                    return visible_channels.contains(&id);
                                }
                                key.strip_prefix("msg:")
                                    .or_else(|| key.strip_prefix("thread:"))
                                    .and_then(|id| EventId::from_hex(id).ok())
                                    .and_then(|id| readable_events.get(&id))
                                    .is_some_and(|(channel, is_root)| {
                                        visible_channels.contains(channel)
                                            && (!key.starts_with("thread:") || *is_root)
                                    })
                            })
                            .map(|(key, value)| (key.clone(), value.clone()))
                            .collect(),
                    ),
                    version: row.version,
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "读用户状态失败");
            user_state_unavailable()
        }
    }
}

/// Same version/CAS as Workspace preferences; only a current participant can write.
pub async fn put_conversation_preference(
    State(state): State<BffState>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<ConversationPreferenceRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(version) = stored_version(request.version) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    if let Err(response) = crate::conversations::admit(&state, &ctx, conversation_id).await {
        return response;
    }
    upsert(
        &state,
        &ctx,
        version,
        "conversation_preferences",
        &conversation_id.to_string(),
        serde_json::json!({"starred": request.starred, "muted": request.muted}),
        Stamp::UpdatedAt,
    )
    .await
}

/// 设置某个 Workspace 的收藏/静音。
pub async fn put_workspace_preference(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<WorkspacePreferenceRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    // 读到的版本。不匹配即冲突——三端并发改同一份偏好时，后写的不能凭空
    // 覆盖先写的（`01` §7）。
    let Some(version) = stored_version(req.version) else {
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
        version,
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
    body: Result<Json<ReadMarkRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(version) = stored_version(req.version) else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 格式非法先拒绝，避免为必然不能写入的请求发起 Relay 查询。
    let Ok(last_read_at) = chrono::DateTime::parse_from_rfc3339(&req.last_read_at) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match req
        .context_key
        .strip_prefix("msg:")
        .or_else(|| req.context_key.strip_prefix("thread:"))
    {
        Some(id) => {
            let Ok(event_id) = EventId::from_hex(id) else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            let readable = match readable_event_ids(&state, &ctx, &HashSet::from([event_id])).await
            {
                Ok(events) => events,
                Err(r) => return r,
            };
            let Some((channel_id, is_root)) = readable.get(&event_id) else {
                return StatusCode::FORBIDDEN.into_response();
            };
            if req.context_key.starts_with("thread:") && !is_root {
                return StatusCode::FORBIDDEN.into_response();
            }
            // Relay 查询期间撤权后，旧可读结果不能成为这次写入的准入依据。
            if let Err(r) = require_visible_channel(&state, &ctx, *channel_id).await {
                return r;
            }
        }
        None => {
            let Ok(channel_id) = req.context_key.parse::<Uuid>() else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            if let Err(r) = require_visible_channel(&state, &ctx, channel_id).await {
                return r;
            }
        }
    }

    // 三端读写同一个值，格式必须是一个：RFC 3339，统一存成 UTC。不校验，
    // 一端写进去的任意字符串在另一端就是解析不了的垃圾。
    let last_read_at = last_read_at
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true);
    upsert(
        &state,
        &ctx,
        version,
        "read_contexts",
        &req.context_key,
        serde_json::json!(last_read_at),
        Stamp::None,
    )
    .await
}

/// 请求里的版本换成库里版本列的类型。契约的 `integer` 在 Rust 侧是 `i64`，
/// 库列是 `integer`：超出范围的值不可能是读到过的版本，按请求非法拒绝。
fn stored_version(v: i64) -> Option<i32> {
    i32::try_from(v).ok()
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
    // 列名来自本模块的已定用户状态字段，不来自请求。
    // 时间戳用库时钟：多副本 Core 的进程时钟不保证一致（与 session 同一条规则）。
    let value_sql = match stamp {
        Stamp::None => "$3::jsonb",
        Stamp::UpdatedAt => "($3::jsonb || jsonb_build_object('updatedAt', now()))",
    };
    // 无行时读取的版本是 0，只有持有该版本的第一次写入能够建行。
    // 插入与更新分别保持原子：先查存在性再写会让两个首次写入都绕过 CAS。
    let sql = if expected_version == 0 {
        format!(
            "insert into identity.collaboration_user_state
             (tenant_principal_id, {column}, version, updated_at)
         select $1, jsonb_build_object($2::text, {value_sql}), 1, now()
         where $4::integer = 0
         on conflict (tenant_principal_id) do nothing
         returning version"
        )
    } else {
        format!(
            "update identity.collaboration_user_state set
             {column} = jsonb_set(
                 identity.collaboration_user_state.{column}, array[$2::text], {value_sql}, true),
             version = identity.collaboration_user_state.version + 1,
             updated_at = now()
         where tenant_principal_id = $1 and version = $4
         returning version"
        )
    };
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
            Json(UserStateVersion {
                version: version.into(),
            }),
        )
            .into_response(),
        // 无行却提交非零版本、首次写入已被另一端完成、存量版本不符均为冲突。
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
    let admitted = crate::web_transport::workspace_admissions(state, ctx, &[workspace_id])
        .await
        .map_err(IntoResponse::into_response)?;
    if admitted.contains_key(&workspace_id) {
        return Ok(());
    }
    Err({
        tracing::warn!(workspace = %workspace_id, "Workspace 对该 Principal 不可见");
        StatusCode::FORBIDDEN.into_response()
    })
}

async fn require_visible_channel(
    state: &BffState,
    ctx: &ExecutionContext,
    channel_id: Uuid,
) -> Result<(), Response> {
    let workspace_id: Option<Uuid> = sqlx::query_scalar(
        "select w.id from projection.workspace_buzz_binding b
         join identity.workspace w on w.id = b.workspace_id
         where b.channel_id = $1 and b.state = 'ACTIVE'
           and w.tenant_id = $2 and w.state = 'ACTIVE'",
    )
    .bind(channel_id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Channel 可见性查询失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?;
    match workspace_id {
        Some(workspace_id) => {
            crate::web_transport::admit_collaboration_workspace_scope(state, ctx, workspace_id)
                .await
                .map(|_| ())
                .map_err(IntoResponse::into_response)
        }
        None => {
            let conversations = visible_conversation_channels(state, ctx, &[channel_id]).await?;
            if conversations.contains(&channel_id) {
                Ok(())
            } else {
                Err(StatusCode::FORBIDDEN.into_response())
            }
        }
    }
}

/// Read marks still use original Buzz channel IDs. Private channels use their
/// participant binding, never Workspace membership or an administrator bypass.
async fn visible_conversation_channels(
    state: &BffState,
    ctx: &ExecutionContext,
    channel_ids: &[Uuid],
) -> Result<HashSet<Uuid>, Response> {
    if channel_ids.is_empty() {
        return Ok(HashSet::new());
    }
    let rows: Vec<(Uuid, Uuid)> = sqlx::query_as(
        "select id, channel_id from projection.conversation_buzz_binding
         where tenant_id=$1 and channel_id=any($2) and state='ACTIVE'
           and $3=any(participant_principal_ids)",
    )
    .bind(ctx.tenant_id)
    .bind(channel_ids)
    .bind(ctx.tenant_principal_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|error| {
        tracing::warn!(%error, "私聊已读范围查询失败");
        user_state_unavailable()
    })?;
    let mut visible = HashSet::new();
    for (id, channel_id) in rows {
        match crate::conversations::admit(state, ctx, id).await {
            Ok(scope) if scope.channel_id == channel_id.to_string() => {
                visible.insert(channel_id);
            }
            Ok(_) => return Err(user_state_unavailable()),
            Err(response) if response.status() == StatusCode::FORBIDDEN => {}
            Err(response) => return Err(response),
        }
    }
    Ok(visible)
}

#[derive(Clone, Copy)]
enum ReadTarget {
    Workspace(Uuid),
    Conversation(Uuid),
}

enum ReadScope {
    Workspace(crate::web_transport::WorkspaceScope),
    Conversation(crate::conversations::ConversationScope),
}

impl ReadTarget {
    async fn admit(self, state: &BffState, ctx: &ExecutionContext) -> Result<ReadScope, Response> {
        match self {
            Self::Workspace(id) => {
                crate::web_transport::admit_collaboration_workspace_scope(state, ctx, id)
                    .await
                    .map(ReadScope::Workspace)
                    .map_err(IntoResponse::into_response)
            }
            Self::Conversation(id) => crate::conversations::admit(state, ctx, id)
                .await
                .map(ReadScope::Conversation),
        }
    }
}

impl ReadScope {
    fn channel_id(&self) -> &str {
        match self {
            Self::Workspace(scope) => &scope.channel_id,
            Self::Conversation(scope) => &scope.channel_id,
        }
    }

    fn community_host(&self) -> &str {
        match self {
            Self::Workspace(scope) => &scope.community_host,
            Self::Conversation(scope) => &scope.community_host,
        }
    }

    fn same_admission(&self, current: &Self) -> bool {
        match (self, current) {
            (Self::Workspace(before), Self::Workspace(after)) => {
                before.channel_id == after.channel_id
                    && before.community_host == after.community_host
                    && before.admission_epoch == after.admission_epoch
            }
            (Self::Conversation(before), Self::Conversation(after)) => before == after,
            _ => false,
        }
    }
}

/// 临时查证事件所属的可读原生 Channel（Workspace 或私聊）；正文不入 Core。
/// Relay 自己执行 author-only、result-gated 与 Channel 可读策略，本侧不重写它们。
async fn readable_event_ids(
    state: &BffState,
    ctx: &ExecutionContext,
    requested: &HashSet<EventId>,
) -> Result<HashMap<EventId, (Uuid, bool)>, Response> {
    use crate::web_transport::{self, AdmissionFailure};

    let mut readable = HashMap::new();
    if requested.is_empty() {
        return Ok(readable);
    }
    let workspace_ids: Vec<Uuid> = sqlx::query_scalar(
        "select id from identity.workspace where tenant_id = $1 and state = 'ACTIVE' order by id",
    )
    .bind(ctx.tenant_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "事件可读性候选查询失败");
        user_state_unavailable()
    })?;
    let conversation_ids: Vec<Uuid> = sqlx::query_scalar(
        "select id from projection.conversation_buzz_binding where tenant_id=$1
         and state='ACTIVE' and $2=any(participant_principal_ids) order by id",
    )
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "私聊事件可读性候选查询失败");
        user_state_unavailable()
    })?;
    let targets: Vec<_> = workspace_ids
        .into_iter()
        .map(ReadTarget::Workspace)
        .chain(conversation_ids.into_iter().map(ReadTarget::Conversation))
        .collect();
    if targets.is_empty() {
        return Ok(readable);
    }
    let keys = web_transport::actor_keys(state, ctx).await?;
    for target in targets {
        if readable.len() == requested.len() {
            break;
        }
        let scope = match target.admit(state, ctx).await {
            Ok(scope) => scope,
            Err(response) if response.status() == StatusCode::FORBIDDEN => continue,
            Err(response) => return Err(response),
        };
        let limits = web_transport::community_limits(state, scope.community_host())
            .await
            .map_err(IntoResponse::into_response)?;
        let page_size = usize::try_from(web_transport::page_limit(state, &limits))
            .ok()
            .filter(|size| *size > 0)
            .ok_or_else(user_state_unavailable)?;
        let client = web_transport::community_client(state, &keys, scope.community_host())?;
        let mut remaining: Vec<EventId> = requested
            .iter()
            .filter(|id| !readable.contains_key(*id))
            .copied()
            .collect();
        remaining.sort_unstable();
        let mut observed = HashMap::new();
        // 复用部署与 binding 的真实单页上界；不新增消息数量阈值，也不静默截断。
        for batch in remaining.chunks(page_size) {
            let ids: Vec<String> = batch.iter().map(ToString::to_string).collect();
            let limit = i64::try_from(batch.len()).map_err(|_| user_state_unavailable())?;
            let filter = serde_json::json!({
                "ids": ids,
                "#h": [scope.channel_id()],
                "limit": limit,
            });
            let result = client.query(&state.http, &[filter]).await.map_err(|e| {
                tracing::warn!(error = %e, "查证已读事件可见性失败");
                web_transport::relay_error_response(&e, None)
            })?;
            let events: Vec<nostr::Event> = serde_json::from_value(result).map_err(|e| {
                tracing::warn!(error = %e, "Relay 可见性回应不是有效事件数组");
                user_state_unavailable()
            })?;
            if events.len() > batch.len() {
                return Err(user_state_unavailable());
            }
            for event in events {
                let channel = event
                    .tags
                    .iter()
                    .map(nostr::Tag::as_slice)
                    .find(|tag| tag.first().is_some_and(|name| name == "h"))
                    .and_then(|tag| tag.get(1));
                if !batch.contains(&event.id)
                    || channel.map(String::as_str) != Some(scope.channel_id())
                    || event.verify().is_err()
                {
                    tracing::warn!("Relay 可见性回应不符合请求 scope 或验签合同");
                    return Err(user_state_unavailable());
                }
                // Buzz 的 NIP-10 resolver 只以有效的 lowercase e/reply 标记判定回复；
                // root-only 仍是顶层。复用 nostr 的 EventId/marker 解析，忽略此判定
                // 不使用的 relay/author 槽，避免它们的格式使真实回复被误判成根。
                let is_root = !event.tags.iter().any(|tag| {
                    let parts = tag.as_slice();
                    parts.len() >= 4
                        && parts[0] == "e"
                        && nostr::Tag::parse([
                            parts[0].as_str(),
                            parts[1].as_str(),
                            "",
                            parts[3].as_str(),
                        ])
                        .is_ok_and(|tag| tag.is_reply())
                });
                observed.insert(event.id, is_root);
            }
        }
        // 不沿用外部读取之前的资格或 binding；查询期间撤权时丢弃该 scope 的结果。
        let current = match target.admit(state, ctx).await {
            Ok(scope) => scope,
            Err(response) if response.status() == StatusCode::FORBIDDEN => continue,
            Err(response) => return Err(response),
        };
        let current_keys = web_transport::actor_keys(state, ctx).await?;
        if !scope.same_admission(&current) || keys.public_key() != current_keys.public_key() {
            return Err(AdmissionFailure::BindingNotActive.into_response());
        }
        let channel_id = scope
            .channel_id()
            .parse::<Uuid>()
            .map_err(|_| user_state_unavailable())?;
        readable.extend(
            observed
                .into_iter()
                .map(|(id, is_root)| (id, (channel_id, is_root))),
        );
    }
    Ok(readable)
}

fn user_state_unavailable() -> Response {
    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(contracts::ErrorBody {
            class: contracts::ErrorClass::Precondition,
            reason: contracts::ReasonCode::DependencyUnavailable,
            operation_id: None,
        }),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_read_evidence_is_fenced_by_both_bindings() {
        let scope = crate::conversations::ConversationScope {
            channel_id: Uuid::new_v4().to_string(),
            community_host: "relay.invalid".into(),
            binding_version: 1,
            tenant_binding_version: 1,
        };
        let before = ReadScope::Conversation(scope.clone());
        assert!(before.same_admission(&ReadScope::Conversation(scope.clone())));
        let mut changed = scope.clone();
        changed.binding_version += 1;
        assert!(!before.same_admission(&ReadScope::Conversation(changed)));
        let mut changed = scope.clone();
        changed.tenant_binding_version += 1;
        assert!(!before.same_admission(&ReadScope::Conversation(changed)));
        let mut changed = scope.clone();
        changed.channel_id = Uuid::new_v4().to_string();
        assert!(!before.same_admission(&ReadScope::Conversation(changed)));
        let workspace = ReadScope::Workspace(crate::web_transport::WorkspaceScope {
            channel_id: scope.channel_id,
            community_host: scope.community_host,
            admission_epoch: crate::web_transport::WorkspaceAdmissionEpoch::WorkspaceManage {
                tenant_version: 1,
                workspace_version: 1,
            },
        });
        assert!(!before.same_admission(&workspace));
    }
}
