//! 在线状态与输入中提示（DD-120(1)–(3)、SF-BUZ-51、V-SCN-100–102、V-SCN-104）。
//!
//! 20001 与 20002 是只经 WebSocket 接收、Relay 不存储的瞬时事件。Core 以本人 SERVER
//! 身份签名，经该公钥已有的 NIP-42 会话连接发出（`.design/09` 第 4 步），最新者为准：
//! 不写 DISPATCH/结果审计，也不按 event ID 对账。Relay `OK false` 是拒绝，超时是结果
//! 不明，二者都不重签——由下一次心跳或输入取代。在线心跳续一段租约，手动离线结束
//! 租约，登出与撤权立即关闭连接（`collab_bridge::stream`）。
//!
//! 在线读取只信 Relay 自身签名的快照：HTTP bridge 对 `kinds:[20001]`+authors 的查询由
//! Relay 合成、以唯一 `p` 标签指明主体（SF-BUZ-51）。缺失在线事实不报成离线。

use std::collections::{BTreeMap, BTreeSet};

use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::KIND_TYPING_INDICATOR;
use collab_bridge::kind::KIND_PRESENCE_UPDATE;
use collab_bridge::limits::RelayLimits;
use collab_bridge::operator::LimitKind;
use collab_bridge::stream::{Lease, PublishError, SessionKey};
use contracts::{
    ErrorClass, ReasonCode, WebPresencePage, WebPresenceQueryRequest, WebPresenceStatus,
    WebPresenceUpdateRequest, WebPresenceView, WebTypingRequest,
};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::web_transport::{
    actor_keys, admit_collaboration_workspace_scope, community_limits, error_body, limit_response,
    relay_error_response, window_author,
};

/// 契约 `WebPresenceQueryRequest` 与 `WebUserStatusQueryRequest` 的 `pubkeys.maxItems`。
pub(crate) const MAX_QUERY_PUBKEYS: usize = 200;

fn unavailable() -> Response {
    error_body(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorClass::Precondition,
        ReasonCode::DependencyUnavailable,
        None,
    )
}

pub(crate) fn no_store<T: serde::Serialize>(body: T) -> Response {
    (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(body),
    )
        .into_response()
}

/// 本人此刻用于 WS 发布的会话连接键、签名钥匙与运行期核对过的上界。
struct Publisher {
    key: SessionKey,
    keys: nostr::Keys,
    limits: RelayLimits,
}

/// 连接键是 (PlatformSession, Community, 本人 SERVER 公钥)：与该会话的 stream 共用
/// 同一条已认证连接，不新增连接类别（DD-120(2)）。
async fn publisher(
    state: &BffState,
    ctx: &ExecutionContext,
    host: String,
) -> Result<Publisher, Response> {
    let limits = community_limits(state, &host)
        .await
        .map_err(IntoResponse::into_response)?;
    let keys = actor_keys(state, ctx).await?;
    let key = SessionKey {
        session: ctx.session_id.to_string(),
        community_host: host,
        pubkey: keys.public_key().to_hex(),
    };
    Ok(Publisher { key, keys, limits })
}

impl Publisher {
    /// `OK true` 是 204；其余按 [`publish_error`] 回答，都不重签。
    async fn send(self, state: &BffState, event: &nostr::Event, lease: Lease) -> Response {
        let outcome = state
            .relay_sessions
            .publish(self.key, &self.keys, event, &self.limits, lease)
            .await;
        match outcome {
            Ok(()) => StatusCode::NO_CONTENT.into_response(),
            Err(error) => publish_error(&error),
        }
    }
}

/// DD-120(1)：`OK false` 是拒绝，NIP-01 机读前缀 `rate-limited:` 归 LIMIT（`apps/06` §4）；
/// 已发出而没有结论是结果不明；确定未发出的按依赖或上界分类。瞬时事件没有 DISPATCH，
/// 因此回应不带 operation id。
fn publish_error(error: &PublishError) -> Response {
    match error {
        PublishError::Rejected(message) if message.starts_with("rate-limited:") => {
            limit_response(LimitKind::RateLimited, None, None)
        }
        PublishError::Rejected(message) => {
            tracing::info!(reason = %message, "Relay 拒绝瞬时事件");
            error_body(
                StatusCode::FORBIDDEN,
                ErrorClass::Denied,
                ReasonCode::PublishRejected,
                None,
            )
        }
        PublishError::Unknown(why) => {
            tracing::warn!(reason = %why, "瞬时事件结果不明，不重签");
            error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Unknown,
                ReasonCode::PublishResultUnknown,
                None,
            )
        }
        PublishError::NotSent(error) => relay_error_response(error, None),
    }
}

fn presence_kind() -> nostr::Kind {
    nostr::Kind::Custom(KIND_PRESENCE_UPDATE as u16)
}

/// 原版 `sendPresence` 的 content：裸状态字符串。
fn status_text(status: &WebPresenceStatus) -> &'static str {
    match status {
        WebPresenceStatus::Online => "online",
        WebPresenceStatus::Away => "away",
        WebPresenceStatus::Offline => "offline",
    }
}

fn parse_status(content: &str) -> Option<WebPresenceStatus> {
    match content {
        "online" => Some(WebPresenceStatus::Online),
        "away" => Some(WebPresenceStatus::Away),
        "offline" => Some(WebPresenceStatus::Offline),
        _ => None,
    }
}

/// `PUT /api/v1/presence`：本人在线心跳或手动选择（V-SCN-100/101）。online/away 续租，
/// offline 发出后结束租约；没有订阅时连接随即关闭，Relay 按原版清除在线状态。
pub(crate) async fn update(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<WebPresenceUpdateRequest>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let host = match crate::web_profile::tenant_host(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let publisher = match publisher(&state, &ctx, host).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let lease = match request.status {
        WebPresenceStatus::Online | WebPresenceStatus::Away => Lease::Renew,
        WebPresenceStatus::Offline => Lease::End,
    };
    let event = nostr::EventBuilder::new(presence_kind(), status_text(&request.status))
        .sign_with_keys(&publisher.keys);
    match event {
        Ok(event) => publisher.send(&state, &event, lease).await,
        Err(_) => unavailable(),
    }
}

/// 契约上界内、互不相同的小写十六进制公钥；任一不符即整次请求无效。
pub(crate) fn requested_pubkeys(pubkeys: &[String]) -> Option<BTreeSet<String>> {
    let requested: BTreeSet<String> = pubkeys.iter().cloned().collect();
    let valid = !pubkeys.is_empty()
        && pubkeys.len() <= MAX_QUERY_PUBKEYS
        && requested.len() == pubkeys.len()
        && requested.iter().all(|pubkey| is_pubkey(pubkey.as_str()));
    valid.then_some(requested)
}

fn is_pubkey(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(is_lower_hex)
}

fn is_lower_hex(byte: u8) -> bool {
    matches!(byte, b'0'..=b'9' | b'a'..=b'f')
}

/// 只把本 Tenant 的 ACTIVE 绑定公钥拿去 Relay 查；其余视同没有事实，不跨 Tenant 透露。
pub(crate) async fn bound_pubkeys(
    state: &BffState,
    tenant: Uuid,
    requested: BTreeSet<String>,
) -> Result<BTreeSet<String>, Response> {
    let requested: Vec<String> = requested.into_iter().collect();
    sqlx::query_scalar::<_, String>(
        "select pubkey from identity.buzz_identity_binding
         where tenant_id = $1 and state = 'ACTIVE' and pubkey = any($2)",
    )
    .bind(tenant)
    .bind(requested)
    .fetch_all(&state.pool)
    .await
    .map(|rows| rows.into_iter().collect())
    .map_err(|error| {
        tracing::warn!(%error, "读本 Tenant 绑定公钥失败");
        unavailable()
    })
}

/// `POST /api/v1/presence/query`（DD-120(3)、V-SCN-102）。没有在线事实的公钥不出现在
/// 结果里，不画成离线。
pub(crate) async fn query(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<WebPresenceQueryRequest>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(requested) = requested_pubkeys(&request.pubkeys) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let bound = match bound_pubkeys(&state, ctx.tenant_id, requested).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if bound.is_empty() {
        return no_store(WebPresencePage {
            presences: Vec::new(),
        });
    }
    let (client, host) = match crate::web_profile::client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    // Relay 自身公钥是 binding 事实（`.design/09`「BFF Relay 连接模型」），不取自响应
    let relay = match window_author(&state, &ctx, &host).await {
        Ok((_, author)) => author,
        Err(r) => return r,
    };
    let filter = json!({"kinds": [KIND_PRESENCE_UPDATE], "authors": &bound});
    let rows = match client.query(&state.relay_http, &[filter]).await {
        Ok(rows) => rows,
        Err(error) => return relay_error_response(&error, None),
    };
    let Some(rows) = rows.as_array() else {
        return unavailable();
    };
    no_store(WebPresencePage {
        presences: presence_facts(rows, &relay, &bound),
    })
}

/// V-SCN-102：只接受 Relay 自身签名、唯一 `p` 标签为所请求且属本 Tenant 绑定公钥、
/// 内容是已知状态的快照；其余逐条丢弃，不当作在线事实。同一主体多条时取最新。
fn presence_facts(rows: &[Value], relay: &str, bound: &BTreeSet<String>) -> Vec<WebPresenceView> {
    let mut latest: BTreeMap<String, (i64, WebPresenceStatus)> = BTreeMap::new();
    for row in rows {
        let Ok(event) = serde_json::from_value::<nostr::Event>(row.clone()) else {
            continue;
        };
        if u32::from(event.kind.as_u16()) != KIND_PRESENCE_UPDATE
            || event.pubkey.to_hex() != relay
            || event.verify().is_err()
        {
            continue;
        }
        let subjects: Vec<&[String]> = event
            .tags
            .iter()
            .map(nostr::Tag::as_slice)
            .filter(|tag| tag.first().is_some_and(|name| name == "p"))
            .collect();
        let [subject] = subjects.as_slice() else {
            continue;
        };
        let Some(subject) = subject.get(1).filter(|pubkey| bound.contains(*pubkey)) else {
            continue;
        };
        let Some(status) = parse_status(&event.content) else {
            continue;
        };
        let observed = i64::try_from(event.created_at.as_secs()).unwrap_or(i64::MAX);
        if latest.get(subject).is_none_or(|(at, _)| observed > *at) {
            latest.insert(subject.clone(), (observed, status));
        }
    }
    latest
        .into_iter()
        .map(|(pubkey, (observed, status))| WebPresenceView {
            pubkey,
            status,
            observed_at: Some(observed),
        })
        .collect()
}

/// `POST /api/v1/workspaces/{workspace_id}/typing`（V-SCN-104）。
pub(crate) async fn workspace_typing(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(thread) = typing_thread(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match admit_collaboration_workspace_scope(&state, &ctx, workspace_id).await {
        Ok(scope) => {
            typing(
                &state,
                &ctx,
                scope.channel_id,
                scope.community_host,
                thread.as_ref(),
            )
            .await
        }
        Err(failure) => failure.into_response(),
    }
}

/// `POST /api/v1/conversations/{conversation_id}/typing`（V-SCN-104）。
pub(crate) async fn conversation_typing(
    State(state): State<BffState>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Some(thread) = typing_thread(&body) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match crate::conversations::admit(&state, &ctx, conversation_id).await {
        Ok(scope) => {
            typing(
                &state,
                &ctx,
                scope.channel_id,
                scope.community_host,
                thread.as_ref(),
            )
            .await
        }
        Err(response) => response,
    }
}

/// 原版 `buildThreadReferenceTags` 的线程引用：`parent` 是线程面板的 thread head，
/// `root` 只在不同于 `parent` 时出现。Agent 回合的 20002 沿用同一形状（buzz-acp
/// `build_typing_event`，DD-125(6)）。
#[derive(Debug, PartialEq)]
pub(crate) struct TypingThread {
    pub(crate) parent: String,
    pub(crate) root: Option<String>,
}

/// 请求体缺省即主频道输入（`Some(None)`）；有请求体时必须是类型化的
/// `WebTypingRequest`，事件 ID 为 64 位小写十六进制，否则整次请求无效（`None`）。
/// 只接受这两个 ID，不接受 raw tags、频道或身份（DD-39）。
fn typing_thread(body: &[u8]) -> Option<Option<TypingThread>> {
    if body.is_empty() {
        return Some(None);
    }
    let request: WebTypingRequest = serde_json::from_slice(body).ok()?;
    if !is_event_id(&request.parent_event_id) {
        return None;
    }
    let root = match request.root_event_id {
        Some(root) if !is_event_id(&root) => return None,
        Some(root) if root != request.parent_event_id => Some(root),
        _ => None,
    };
    Some(Some(TypingThread {
        parent: request.parent_event_id,
        root,
    }))
}

fn is_event_id(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(is_lower_hex)
}

/// 原版 `sendTypingIndicator` 的形状：空 content，唯一 `["h", channel]` 取自已准入的
/// scope；线程内输入按原 `buildThreadReferenceTags` 追加 `e` root/reply 标签。
async fn typing(
    state: &BffState,
    ctx: &ExecutionContext,
    channel: String,
    host: String,
    thread: Option<&TypingThread>,
) -> Response {
    let publisher = match publisher(state, ctx, host).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let event = typing_event(&publisher.keys, &channel, thread);
    match event {
        Some(event) => publisher.send(state, &event, Lease::Unchanged).await,
        None => unavailable(),
    }
}

pub(crate) fn typing_event(
    keys: &nostr::Keys,
    channel: &str,
    thread: Option<&TypingThread>,
) -> Option<nostr::Event> {
    let mut tags = vec![nostr::Tag::parse(["h", channel]).ok()?];
    if let Some(thread) = thread {
        if let Some(root) = &thread.root {
            tags.push(nostr::Tag::parse(["e", root.as_str(), "", "root"]).ok()?);
        }
        tags.push(nostr::Tag::parse(["e", thread.parent.as_str(), "", "reply"]).ok()?);
    }
    nostr::EventBuilder::new(nostr::Kind::Custom(KIND_TYPING_INDICATOR as u16), "")
        .tags(tags)
        .sign_with_keys(keys)
        .ok()
}

/// 某个范围的 roster：ACTIVE 成员的全部 ACTIVE HUMAN 公钥，含原生设备的 CLIENT 公钥
/// （同一 Human 任一公钥在线即为在线，DD-120(5)）。Agent 不在内：它仍按 Installation
/// 是否活动呈现。至多取 `cap` 行，调用方据行数判断 roster 是否超出单帧上限。
pub(crate) async fn workspace_roster(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    workspace: Uuid,
    cap: i64,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select distinct b.pubkey from identity.workspace_membership wm
         join identity.tenant_membership tm on tm.tenant_principal_id = wm.tenant_principal_id
              and tm.tenant_id = $1 and tm.state = 'ACTIVE'
         join identity.principal p on p.id = tm.tenant_principal_id and p.tenant_id = tm.tenant_id
              and p.kind = 'HUMAN' and p.status = 'ACTIVE'
         join identity.workspace w on w.id = wm.workspace_id and w.tenant_id = tm.tenant_id
         join identity.buzz_identity_binding b on b.principal_id = tm.tenant_principal_id
              and b.tenant_id = tm.tenant_id and b.kind = 'HUMAN' and b.state = 'ACTIVE'
         where wm.workspace_id = $2 and wm.state = 'ACTIVE'
         order by b.pubkey limit $3",
    )
    .bind(tenant)
    .bind(workspace)
    .bind(cap)
    .fetch_all(pool)
    .await
}

/// 私聊 roster：ACTIVE 会话全部参与者的 ACTIVE HUMAN 公钥，规则同 [`workspace_roster`]。
pub(crate) async fn conversation_roster(
    pool: &sqlx::PgPool,
    tenant: Uuid,
    conversation: Uuid,
    cap: i64,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "select distinct b.pubkey from projection.conversation_buzz_binding c
         join identity.tenant_membership tm on tm.tenant_id = c.tenant_id
              and tm.tenant_principal_id = any(c.participant_principal_ids) and tm.state = 'ACTIVE'
         join identity.principal p on p.id = tm.tenant_principal_id and p.tenant_id = tm.tenant_id
              and p.kind = 'HUMAN' and p.status = 'ACTIVE'
         join identity.buzz_identity_binding b on b.principal_id = tm.tenant_principal_id
              and b.tenant_id = tm.tenant_id and b.kind = 'HUMAN' and b.state = 'ACTIVE'
         where c.id = $2 and c.tenant_id = $1 and c.state = 'ACTIVE'
         order by b.pubkey limit $3",
    )
    .bind(tenant)
    .bind(conversation)
    .bind(cap)
    .fetch_all(pool)
    .await
}

/// 撤权对在线租约的生效上界（DD-120(2)、V-SCN-101）。登出在请求路径上立即释放；成员
/// 撤销、密钥撤销与 Tenant 暂停发生在别处，而只靠租约保留的连接不再经过请求路径，
/// 所以按 stream 再准入的同一部署间隔（`BFF_STREAM_READMIT_SECONDS`）回头看。
pub(crate) fn spawn_lease_sweeper(state: BffState) {
    let every = std::time::Duration::from_secs(state.stream_readmit_seconds.max(1));
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(every);
        loop {
            tick.tick().await;
            for key in state.relay_sessions.leased() {
                match lease_holder(&state, &key).await {
                    Ok(Holder::Admitted) => {}
                    Ok(Holder::SessionGone) => state.relay_sessions.release(&key.session),
                    Ok(Holder::IdentityGone) => state.relay_sessions.release_identity(&key),
                    Err(error) => tracing::warn!(%error, "在线租约再准入查询失败"),
                }
            }
        }
    });
}

enum Holder {
    Admitted,
    SessionGone,
    IdentityGone,
}

async fn lease_holder(state: &BffState, key: &SessionKey) -> Result<Holder, sqlx::Error> {
    let Ok(session) = key.session.parse::<Uuid>() else {
        return Ok(Holder::SessionGone);
    };
    if !identity::session::is_live(&state.pool, session).await? {
        return Ok(Holder::SessionGone);
    }
    let signer: bool = sqlx::query_scalar(
        "select exists (select 1 from identity.platform_session s
           join identity.tenant_membership tm on tm.id = s.tenant_membership_id
                and tm.state = 'ACTIVE'
           join identity.buzz_identity_binding b on b.tenant_id = tm.tenant_id
                and b.principal_id = tm.tenant_principal_id and b.pubkey = $2
                and b.custody = 'SERVER' and b.kind = 'HUMAN' and b.state = 'ACTIVE'
          where s.id = $1)",
    )
    .bind(session)
    .bind(&key.pubkey)
    .fetch_one(&state.pool)
    .await?;
    if signer {
        Ok(Holder::Admitted)
    } else {
        Ok(Holder::IdentityGone)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(relay: &nostr::Keys, tags: &[&[&str]], content: &str, at: u64) -> Value {
        let tags = tags
            .iter()
            .map(|tag| nostr::Tag::parse(tag.iter().copied()).unwrap());
        let event = nostr::EventBuilder::new(presence_kind(), content)
            .tags(tags)
            .custom_created_at(nostr::Timestamp::from(at))
            .sign_with_keys(relay)
            .unwrap();
        serde_json::to_value(event).unwrap()
    }

    #[test]
    fn presence_trusts_only_relay_signed_single_subject_snapshots_of_bound_keys() {
        let relay = nostr::Keys::generate();
        let member = nostr::Keys::generate().public_key().to_hex();
        let stranger = nostr::Keys::generate().public_key().to_hex();
        let bound = BTreeSet::from([member.clone()]);
        let (m, s) = (member.as_str(), stranger.as_str());
        let relay_hex = relay.public_key().to_hex();
        let rows = vec![
            snapshot(&relay, &[&["p", m]], "online", 10),
            // 同一主体较旧的一条不覆盖较新的
            snapshot(&relay, &[&["p", m]], "away", 9),
            // 非本 Tenant 的主体、多个 p、未知内容、非 Relay 签名：一律不是在线事实
            snapshot(&relay, &[&["p", s]], "online", 11),
            snapshot(&relay, &[&["p", m], &["p", m]], "away", 12),
            snapshot(&relay, &[&["p", m]], "busy", 13),
            snapshot(&nostr::Keys::generate(), &[&["p", m]], "away", 14),
        ];
        let facts = presence_facts(&rows, &relay_hex, &bound);
        assert_eq!(
            facts,
            vec![WebPresenceView {
                pubkey: member.clone(),
                status: WebPresenceStatus::Online,
                observed_at: Some(10),
            }]
        );
        let mut forged = snapshot(&relay, &[&["p", m]], "online", 20);
        forged["content"] = json!("offline");
        assert!(presence_facts(&[forged], &relay_hex, &bound).is_empty());
    }

    #[test]
    fn query_pubkeys_follow_the_contract_bounds() {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../../contracts/api/web_presence_query_request.schema.json"
        ))
        .unwrap();
        assert_eq!(
            schema["properties"]["pubkeys"]["maxItems"].as_u64(),
            Some(MAX_QUERY_PUBKEYS as u64)
        );
        let key = |n: u8| format!("{n:064x}");
        assert!(requested_pubkeys(&[key(1), key(2)]).is_some());
        assert!(requested_pubkeys(&[]).is_none());
        assert!(requested_pubkeys(&[key(1), key(1)]).is_none());
        assert!(requested_pubkeys(&["AB".repeat(32)]).is_none());
        assert!(requested_pubkeys(&["a".repeat(63)]).is_none());
        let many: Vec<String> = (0..=MAX_QUERY_PUBKEYS)
            .map(|n| format!("{n:064x}"))
            .collect();
        assert!(requested_pubkeys(&many).is_none());
        assert!(requested_pubkeys(&many[..MAX_QUERY_PUBKEYS]).is_some());
    }

    #[test]
    fn heartbeat_and_typing_keep_the_original_event_shapes() {
        let keys = nostr::Keys::generate();
        for status in [
            WebPresenceStatus::Online,
            WebPresenceStatus::Away,
            WebPresenceStatus::Offline,
        ] {
            assert_eq!(parse_status(status_text(&status)), Some(status));
        }
        let channel = Uuid::from_u128(7).to_string();
        let typing = typing_event(&keys, &channel, None).unwrap();
        assert_eq!(u32::from(typing.kind.as_u16()), KIND_TYPING_INDICATOR);
        assert!(typing.content.is_empty());
        let tags: Vec<_> = typing.tags.iter().map(nostr::Tag::as_slice).collect();
        assert_eq!(tags, vec![vec!["h".to_owned(), channel.clone()]]);
        assert!(typing.verify().is_ok());

        // 原 buildThreadReferenceTags：root 不同于 thread head 时 root 在前，reply 在后
        let (root, head) = ("a".repeat(64), "b".repeat(64));
        let thread = TypingThread {
            parent: head.clone(),
            root: Some(root.clone()),
        };
        let typing = typing_event(&keys, &channel, Some(&thread)).unwrap();
        let tags: Vec<_> = typing.tags.iter().map(nostr::Tag::as_slice).collect();
        let tag = |values: &[&str]| values.iter().map(|v| (*v).to_owned()).collect::<Vec<_>>();
        assert_eq!(
            tags,
            vec![
                tag(&["h", channel.as_str()]),
                tag(&["e", root.as_str(), "", "root"]),
                tag(&["e", head.as_str(), "", "reply"]),
            ]
        );
        assert!(typing.verify().is_ok());
    }

    #[test]
    fn typing_body_is_absent_or_a_typed_thread_reference() {
        let (root, head) = ("a".repeat(64), "b".repeat(64));
        assert_eq!(typing_thread(b""), Some(None));
        let body = |value: Value| serde_json::to_vec(&value).unwrap();
        assert_eq!(
            typing_thread(&body(json!({"parentEventId": head, "rootEventId": root}))),
            Some(Some(TypingThread {
                parent: head.clone(),
                root: Some(root.clone()),
            }))
        );
        // root 缺省或等于 thread head：只有 reply 标签
        for request in [
            json!({"parentEventId": head}),
            json!({"parentEventId": head, "rootEventId": head}),
        ] {
            assert_eq!(
                typing_thread(&body(request)),
                Some(Some(TypingThread {
                    parent: head.clone(),
                    root: None,
                }))
            );
        }
        // 缺 thread head、非 64 位小写十六进制或不是 JSON 一律无效
        for request in [
            json!({}),
            json!({"parentEventId": "B".repeat(64)}),
            json!({"parentEventId": head, "rootEventId": "x"}),
        ] {
            assert_eq!(typing_thread(&body(request)), None);
        }
        assert_eq!(typing_thread(b"not json"), None);
        // 契约外字段（raw tags、频道）从不进入事件：标签只由准入 scope 与两个 ID 构成
        let thread = typing_thread(&body(json!({"parentEventId": head, "tags": [["p", root]]})))
            .unwrap()
            .unwrap();
        let typing = typing_event(&nostr::Keys::generate(), "channel", Some(&thread)).unwrap();
        assert_eq!(typing.tags.len(), 2);
    }
}
