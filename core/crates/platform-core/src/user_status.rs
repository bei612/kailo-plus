//! 用户状态：原版 NIP-38 kind 30315（`d=general`，可选 `emoji`、`expiration`，内容为文本）
//! （DD-120(4)、SF-BUZ-51、V-SCN-103）。
//!
//! 30315 是存储的可替换事件，按 DD-81 以本人 SERVER 身份发布并对账：复用 kind:0 与
//! 30030 的同一发布意图、DISPATCH/OUTCOME 审计与对账循环，结果不明只对账、不另签。
//! 清除即发布空内容。正文只在 Relay，Core 只留 event ID。

use std::collections::{BTreeMap, BTreeSet};

use axum::{
    extract::{rejection::JsonRejection, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::kind::KIND_USER_STATUS;
use contracts::{
    ErrorClass, ReasonCode, WebUserStatusPage, WebUserStatusQueryRequest,
    WebUserStatusUpdateRequest, WebUserStatusView,
};
use nostr::JsonUtil;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::bff::{resolve_execution_context, BffState};
use crate::presence::{bound_pubkeys, no_store, requested_pubkeys};
use crate::web_profile;
use crate::web_transport::{actor_keys, error_body, relay_error_response};

pub(crate) const USER_STATUS_ACTION: &str = "identity.user_status.publish";

/// 原版只读写 `d=general` 这一个状态坐标。
pub(crate) const STATUS_D_TAG: &str = "general";

/// 契约 `WebUserStatusUpdateRequest` 的 `text.maxLength` 与 `emoji.maxLength`（字符数）。
const MAX_TEXT_CHARS: usize = 256;
const MAX_EMOJI_CHARS: usize = 64;

fn unavailable() -> Response {
    error_body(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorClass::Precondition,
        ReasonCode::DependencyUnavailable,
        None,
    )
}

fn own_filter(author: &str) -> Value {
    json!({"kinds":[KIND_USER_STATUS], "#d":[STATUS_D_TAG], "authors":[author], "limit":1})
}

/// 一行只有是所请求作者签名完好的 30315 `d=general` 时才是状态。
fn status_event(row: &Value, authors: &BTreeSet<String>) -> Option<nostr::Event> {
    let event: nostr::Event = serde_json::from_value(row.clone()).ok()?;
    let valid = u32::from(event.kind.as_u16()) == KIND_USER_STATUS
        && authors.contains(&event.pubkey.to_hex())
        && event.tags.identifier() == Some(STATUS_D_TAG)
        && event.verify().is_ok();
    valid.then_some(event)
}

fn tag_value(event: &nostr::Event, name: &str) -> Option<String> {
    event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .find(|tag| tag.first().is_some_and(|first| first == name))
        .and_then(|tag| tag.get(1))
        .cloned()
}

/// 原版 `parseUserStatusEvent` 与 `visibleUserStatus`：文本与表情都空即已清除，已到期
/// 即不显示；两者都不出现在结果里。到期标签不可解析时按原版视作不到期。
fn status_view(event: &nostr::Event, now: u64) -> Option<WebUserStatusView> {
    let emoji = tag_value(event, "emoji").filter(|emoji| !emoji.is_empty());
    let expires_at = tag_value(event, "expiration").and_then(|at| at.parse::<u64>().ok());
    if expires_at.is_some_and(|at| at <= now) || (event.content.is_empty() && emoji.is_none()) {
        return None;
    }
    Some(WebUserStatusView {
        pubkey: event.pubkey.to_hex(),
        text: event.content.clone(),
        emoji,
        expires_at: expires_at.and_then(|at| i64::try_from(at).ok()),
        event_id: event.id.to_hex(),
        created_at: i64::try_from(event.created_at.as_secs()).unwrap_or(i64::MAX),
    })
}

/// NIP-01 可替换事件：`created_at` 大者为新；同一秒取 event ID 小者。
fn replaces(candidate: &nostr::Event, current: &nostr::Event) -> bool {
    let at = |event: &nostr::Event| event.created_at.as_secs();
    at(candidate) > at(current)
        || (at(candidate) == at(current) && candidate.id.to_hex() < current.id.to_hex())
}

/// 每个作者取最新一条，再按呈现规则过滤。任一行不是所请求作者的完好状态即整次失败：
/// 那是 Relay 不守约，不能当作部分结果。
fn latest_statuses(
    value: &Value,
    authors: &BTreeSet<String>,
    now: u64,
) -> Result<Vec<WebUserStatusView>, ()> {
    let rows = value.as_array().ok_or(())?;
    let mut latest: BTreeMap<String, nostr::Event> = BTreeMap::new();
    for row in rows {
        let event = status_event(row, authors).ok_or(())?;
        let author = event.pubkey.to_hex();
        let newer = match latest.get(&author) {
            Some(current) => replaces(&event, current),
            None => true,
        };
        if newer {
            latest.insert(author, event);
        }
    }
    let statuses: Vec<_> = latest
        .values()
        .filter_map(|event| status_view(event, now))
        .collect();
    Ok(statuses)
}

/// `POST /api/v1/user-status/query`（V-SCN-103）。
pub(crate) async fn query(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<WebUserStatusQueryRequest>, JsonRejection>,
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
    let authors = match bound_pubkeys(&state, ctx.tenant_id, requested).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if authors.is_empty() {
        return no_store(WebUserStatusPage {
            statuses: Vec::new(),
        });
    }
    let (client, _) = match web_profile::client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let filter = json!({
        "kinds": [KIND_USER_STATUS], "#d": [STATUS_D_TAG], "authors": &authors,
        "limit": authors.len(),
    });
    let rows = match client.query(&state.relay_http, &[filter]).await {
        Ok(rows) => rows,
        Err(error) => return relay_error_response(&error, None),
    };
    match latest_statuses(&rows, &authors, nostr::Timestamp::now().as_secs()) {
        Ok(statuses) => no_store(WebUserStatusPage { statuses }),
        Err(()) => unavailable(),
    }
}

/// 原版 `publishUserStatus` 的标签顺序：`d=general`，再是可选 `emoji` 与 `expiration`。
/// 超出契约上界、到期不在未来、或只有到期而没有内容的请求无效。空文本且无表情即清除，
/// 只带 `d`。
fn status_tags(request: &WebUserStatusUpdateRequest, now: u64) -> Option<Vec<nostr::Tag>> {
    if request.text.chars().count() > MAX_TEXT_CHARS {
        return None;
    }
    let mut tags = vec![nostr::Tag::identifier(STATUS_D_TAG)];
    if let Some(emoji) = &request.emoji {
        if emoji.is_empty() || emoji.chars().count() > MAX_EMOJI_CHARS {
            return None;
        }
        tags.push(nostr::Tag::parse(["emoji", emoji.as_str()]).ok()?);
    }
    if let Some(expires_at) = request.expires_at {
        let at = u64::try_from(expires_at).ok().filter(|at| *at > now)?;
        if request.text.is_empty() && request.emoji.is_none() {
            return None;
        }
        tags.push(nostr::Tag::expiration(nostr::Timestamp::from(at)));
    }
    Some(tags)
}

/// 本人最新一条状态的 `created_at`；读回不是本人完好状态即依赖不可用。
fn prior_created_at(value: &Value, author: &BTreeSet<String>) -> Result<Option<u64>, ()> {
    let rows = value.as_array().ok_or(())?;
    if rows.len() > 1 {
        return Err(());
    }
    let Some(row) = rows.first() else {
        return Ok(None);
    };
    let event = status_event(row, author).ok_or(())?;
    Ok(Some(event.created_at.as_secs()))
}

/// `PUT /api/v1/user-status`（DD-120(4)、V-SCN-103）。幂等键是 Idempotency-Key 请求头；
/// 同一键重复提交只回答原操作的结论，结果不明只对账，不另签新事件。
pub(crate) async fn update(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<WebUserStatusUpdateRequest>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(key) = crate::projects_git_ref::idempotency_key(&headers) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let now = nostr::Timestamp::now().as_secs();
    let Some(tags) = status_tags(&request, now) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    // 冻结语义意图而不在 Core 保存状态正文：同一键改了内容不得回答第一次的成功
    let Ok(encoded) = serde_json::to_vec(&request) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let parameter_hash = format!("{:x}", Sha256::digest(encoded));
    let (client, host) = match web_profile::client(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    match web_profile::previous(&state, &ctx, key).await {
        Ok(Some(attempt)) => {
            return web_profile::own_event_response(
                &attempt,
                ctx.tenant_id,
                &parameter_hash,
                USER_STATUS_ACTION,
            )
        }
        Ok(None) => {}
        Err(r) => return r,
    }
    let author = client.pubkey_hex();
    let prior = match client.query(&state.relay_http, &[own_filter(&author)]).await {
        Ok(rows) => rows,
        Err(error) => return relay_error_response(&error, None),
    };
    let Ok(prior) = prior_created_at(&prior, &BTreeSet::from([author.clone()])) else {
        return unavailable();
    };
    // NIP-01 按 created_at 替换：同一秒保存两次不能静默保留旧状态
    let created_at = now.max(prior.map_or(0, |at| at.saturating_add(1)));
    let keys = match actor_keys(&state, &ctx).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if keys.public_key().to_hex() != author {
        return StatusCode::CONFLICT.into_response();
    }
    let kind = nostr::Kind::Custom(KIND_USER_STATUS as u16);
    let event = match nostr::EventBuilder::new(kind, request.text.as_str())
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from(created_at))
        .sign_with_keys(&keys)
    {
        Ok(v) => v,
        Err(_) => return unavailable(),
    };
    if event.as_json().len() > state.message_max_content_bytes {
        return error_body(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorClass::Limit,
            ReasonCode::PayloadTooLarge,
            None,
        );
    }
    web_profile::publish_prepared(
        &state,
        &headers,
        &ctx,
        &host,
        key,
        &parameter_hash,
        USER_STATUS_ACTION,
        event,
        own_filter(&author),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn signed(keys: &nostr::Keys, content: &str, tags: Vec<nostr::Tag>, at: u64) -> nostr::Event {
        nostr::EventBuilder::new(nostr::Kind::Custom(KIND_USER_STATUS as u16), content)
            .tags(tags)
            .custom_created_at(nostr::Timestamp::from(at))
            .sign_with_keys(keys)
            .unwrap()
    }

    fn request(
        text: &str,
        emoji: Option<&str>,
        expires_at: Option<i64>,
    ) -> WebUserStatusUpdateRequest {
        WebUserStatusUpdateRequest {
            text: text.to_owned(),
            emoji: emoji.map(str::to_owned),
            expires_at,
        }
    }

    fn shape(tags: Option<Vec<nostr::Tag>>) -> Vec<Vec<String>> {
        tags.unwrap_or_default()
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect()
    }

    #[test]
    fn status_tags_keep_the_original_shape_and_contract_bounds() {
        let full = status_tags(&request("In a meeting", Some("🌴"), Some(200)), 100);
        assert_eq!(
            shape(full),
            vec![
                vec!["d", "general"],
                vec!["emoji", "🌴"],
                vec!["expiration", "200"],
            ]
        );
        // 清除：空内容，只有 d
        let cleared = status_tags(&request("", None, None), 100);
        assert_eq!(shape(cleared), vec![vec!["d", "general"]]);
        assert!(status_tags(&request("x", None, Some(100)), 100).is_none());
        assert!(status_tags(&request("", None, Some(200)), 100).is_none());
        assert!(status_tags(&request("x", Some(""), None), 100).is_none());
        let long = "字".repeat(MAX_TEXT_CHARS);
        assert!(status_tags(&request(&long, None, None), 100).is_some());
        let longer = "字".repeat(MAX_TEXT_CHARS + 1);
        assert!(status_tags(&request(&longer, None, None), 100).is_none());
    }

    #[test]
    fn statuses_are_latest_verified_per_author_and_hide_cleared_or_expired() {
        let alice = nostr::Keys::generate();
        let bob = nostr::Keys::generate();
        let carol = nostr::Keys::generate();
        let d = || nostr::Tag::identifier(STATUS_D_TAG);
        let authors: BTreeSet<String> = [&alice, &bob, &carol]
            .iter()
            .map(|keys| keys.public_key().to_hex())
            .collect();
        let old = signed(&alice, "old", vec![d()], 10);
        let new = signed(&alice, "new", vec![d()], 11);
        let cleared = signed(&bob, "", vec![d()], 10);
        let expiry = nostr::Tag::expiration(nostr::Timestamp::from(50));
        let expired = signed(&carol, "gone", vec![d(), expiry], 10);
        let rows = json!([old, new, cleared, expired]);
        let statuses = latest_statuses(&rows, &authors, 100).unwrap();
        assert_eq!(statuses.len(), 1);
        assert_eq!(statuses[0].text, "new");
        assert_eq!(statuses[0].event_id, new.id.to_hex());
        assert_eq!(statuses[0].pubkey, alice.public_key().to_hex());

        // 签名不完好、他人、非 general 坐标或非数组：Relay 不守约，整次失败
        let mut forged = json!(new);
        forged["content"] = json!("forged");
        assert!(latest_statuses(&json!([forged]), &authors, 100).is_err());
        let stranger = signed(&nostr::Keys::generate(), "x", vec![d()], 10);
        assert!(latest_statuses(&json!([stranger]), &authors, 100).is_err());
        let other = signed(&alice, "x", vec![nostr::Tag::identifier("music")], 10);
        assert!(latest_statuses(&json!([other]), &authors, 100).is_err());
        let not_rows = json!({"events": []});
        assert!(latest_statuses(&not_rows, &authors, 100).is_err());

        // 原版：只有表情也是可见状态
        let palm = nostr::Tag::parse(["emoji", "🌴"]).unwrap();
        let emoji_only = signed(&bob, "", vec![d(), palm], 12);
        let statuses = latest_statuses(&json!([emoji_only]), &authors, 100).unwrap();
        assert_eq!(statuses[0].emoji.as_deref(), Some("🌴"));
    }

    #[test]
    fn own_prior_must_be_a_single_verified_own_status() {
        let keys = nostr::Keys::generate();
        let author = BTreeSet::from([keys.public_key().to_hex()]);
        let event = signed(&keys, "x", vec![nostr::Tag::identifier(STATUS_D_TAG)], 42);
        assert_eq!(prior_created_at(&json!([event]), &author), Ok(Some(42)));
        assert_eq!(prior_created_at(&json!([]), &author), Ok(None));
        assert!(prior_created_at(&json!([event, event]), &author).is_err());
        let foreign = signed(&nostr::Keys::generate(), "x", vec![], 42);
        assert!(prior_created_at(&json!([foreign]), &author).is_err());
    }
}
