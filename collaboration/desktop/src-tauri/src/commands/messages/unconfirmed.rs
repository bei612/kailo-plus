//! 发出后结果不明的消息事件（REST 路径）。
//!
//! `POST /events` 超时、中途断开或 Relay 回 5xx 时，Relay 可能已经存储了事件。用户
//! 对同一内容再次发送时，原样重发那个已签名事件（同一 id）：Relay 以 `duplicate:`
//! 接受而不再存第二条（buzz-db `store/event.rs` 的 `ON CONFLICT DO NOTHING`，
//! 主键含 id；buzz-relay `handlers/ingest.rs` 的 `!was_inserted` 分支）。重新签名
//! 会得到新 id，那才会重复。
//!
//! 键含 Relay 地址与签名公钥：换社区或换身份不会取到别人的事件。记录只在确认接受
//! 时清除——结果不明之后的重发被拒，并不改变第一次是否已被存储这一未知。

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

static UNCONFIRMED: LazyLock<Mutex<HashMap<String, nostr::Event>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// A deletion can remove its original target before its ACK arrives.
pub(super) fn existing_mutation(key: &str) -> Result<Option<nostr::Event>, String> {
    Ok(UNCONFIRMED
        .lock()
        .map_err(|_| "relay publish outcome unknown")?
        .get(key)
        .cloned())
}

/// A message mutation has one outstanding intent per original target. Claim
/// before I/O; subsequent calls observe the same signed event. This shares the
/// existing native holder (not a second outbox).
pub(super) fn claim_mutation(
    key: &str,
    fresh: nostr::Event,
) -> Result<(nostr::Event, bool), String> {
    let mut map = UNCONFIRMED
        .lock()
        .map_err(|_| "relay publish outcome unknown")?;
    if let Some(event) = map.get(key) {
        if event.content != fresh.content || event.tags != fresh.tags {
            return Err("relay publish outcome unknown".into());
        }
        return Ok((event.clone(), false));
    }
    map.insert(key.to_owned(), fresh.clone());
    Ok((fresh, true))
}

/// Only a confirmed read/ACK or the first dispatch's definite rejection can
/// retire the claimed intent. A late observation never clears a newer edit.
pub(super) fn resolve_mutation(key: &str, id: nostr::EventId) -> Result<(), String> {
    let mut map = UNCONFIRMED
        .lock()
        .map_err(|_| "relay publish outcome unknown")?;
    if map.get(key).is_some_and(|event| event.id == id) {
        map.remove(key);
    }
    Ok(())
}

/// Keep the original signed profile intent in the existing native holder.
/// Unlike immutable messages, replaceable metadata is observed, never re-sent.
pub(crate) fn claim_profile(
    prefix: &str,
    payload_hash: &str,
    fresh: nostr::Event,
) -> Result<(nostr::Event, bool), String> {
    let mut map = UNCONFIRMED
        .lock()
        .map_err(|_| "relay publish outcome unknown".to_string())?;
    let key = format!("{prefix}{payload_hash}");
    if let Some((found, event)) = map.iter().find(|(key, _)| key.starts_with(prefix)) {
        if found != &key {
            return Err("profile publication intent changed; not sent".into());
        }
        return Ok((event.clone(), false));
    }
    map.insert(key, fresh.clone());
    Ok((fresh, true))
}

/// 同一 Relay、同一作者、同一 kind、正文与标签完全相同即视为同一条消息。
pub(super) fn fingerprint(relay_base: &str, event: &nostr::Event) -> String {
    serde_json::json!([
        relay_base,
        event.pubkey.to_hex(),
        event.kind.as_u16(),
        event.content,
        event.tags,
    ])
    .to_string()
}

/// 先前结果不明的同一条消息；没有就用刚签好的这一条。
pub(super) fn reuse_or(key: &str, fresh: nostr::Event) -> Result<nostr::Event, String> {
    let map = UNCONFIRMED
        .lock()
        .map_err(|_| "relay publish outcome unknown".to_string())?;
    Ok(map.get(key).cloned().unwrap_or(fresh))
}

/// 按提交结果更新记录：接受即清除，结果不明即记下，确定被拒保持不变。
pub(super) fn settle(
    key: &str,
    event: &nostr::Event,
    outcome: &Result<(), String>,
) -> Result<(), String> {
    let mut map = UNCONFIRMED
        .lock()
        .map_err(|_| "relay publish outcome unknown".to_string())?;
    match outcome {
        Ok(()) => {
            map.remove(key);
            Ok(())
        }
        Err(error) => {
            if outcome_unknown(error) {
                map.insert(key.to_owned(), event.clone());
            }
            if map.contains_key(key) {
                // 本次拒绝或未发出不能证明第一次未存储；只有原事件的肯定 ACK
                // 才能清除未知。向实际 composer 传播同一事件的整体结果。
                Err("relay publish outcome unknown".to_string())
            } else {
                Err(error.clone())
            }
        }
    }
}

/// 提交一条刚签好的消息；同一内容上一次结果不明时改为原样重发那一条，并按结果
/// 更新记录。返回 Relay 的回应与实际提交的事件（其 `created_at` 是事件自己的）。
pub(super) async fn submit_reusing_unconfirmed(
    fresh: nostr::Event,
    state: &crate::app_state::AppState,
    relay_base: &str,
    keys: &nostr::Keys,
) -> Result<(crate::relay::SubmitEventResponse, nostr::Event), String> {
    let key = fingerprint(relay_base, &fresh);
    let event = reuse_or(&key, fresh)?;
    let submitted =
        crate::relay::submit_signed_event_at_with_keys(&event, state, relay_base, keys).await;
    settle(
        &key,
        &event,
        &submitted.as_ref().map(|_| ()).map_err(Clone::clone),
    )?;
    Ok((submitted?, event))
}

/// 提交失败时请求是否可能已到达 Relay。错误串来自本 crate 的 `relay.rs`
/// （`classify_request_error`、`relay_error_message`）与 `relay/submit.rs`。
pub(crate) fn outcome_unknown(error: &str) -> bool {
    if error == "relay publish outcome unknown" {
        return true;
    }
    if let Some(rest) = error.strip_prefix("relay unreachable:") {
        // 连接没有建立、主机解析失败：请求不可能到达 Relay
        let rest = rest.trim();
        return rest != "could not connect to relay" && rest != "relay host not found";
    }
    if let Some(rest) = error.strip_prefix("relay returned ") {
        // 只有明确的 4xx 是本次拒绝。2xx 坏正文、错配 ACK 或其他状态都不
        // 证明原事件的终态，不把协议错误归为确定未存储。
        let status = rest
            .split_whitespace()
            .next()
            .and_then(|s| s.parse::<u16>().ok());
        return !status.is_some_and(|code| (400..500).contains(&code));
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    #[test]
    fn deletion_can_be_observed_after_its_original_target_disappears() {
        let keys = Keys::generate();
        let key = format!("delete-test:{}", keys.public_key());
        let event = crate::events::build_delete_compat(
            uuid::Uuid::new_v4(),
            nostr::EventId::from_hex(
                "0000000000000000000000000000000000000000000000000000000000000000",
            )
            .unwrap(),
        )
        .unwrap()
        .sign_with_keys(&keys)
        .unwrap();
        assert!(super::existing_mutation(&key).unwrap().is_none());
        assert!(super::claim_mutation(&key, event.clone()).unwrap().1);
        assert_eq!(
            super::existing_mutation(&key).unwrap().unwrap().id,
            event.id
        );
        assert!(!super::claim_mutation(&key, event.clone()).unwrap().1);
        super::resolve_mutation(&key, event.id).unwrap();
        assert!(super::existing_mutation(&key).unwrap().is_none());
    }

    fn message(keys: &Keys, content: &str, created_at: u64) -> nostr::Event {
        EventBuilder::new(Kind::Custom(9), content)
            .tags(vec![Tag::parse(["h", "c1"]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(created_at))
            .sign_with_keys(keys)
            .unwrap()
    }

    #[test]
    fn edits_claim_one_target_intent_until_confirmed_and_reject_changed_payload() {
        let keys = Keys::generate();
        let key = format!("edit-test:{}", keys.public_key());
        let first = message(&keys, "first edit", 100);
        let (claimed, dispatch) = super::claim_mutation(&key, first.clone()).unwrap();
        assert!(dispatch);
        let (observed, dispatch) =
            super::claim_mutation(&key, message(&keys, "first edit", 101)).unwrap();
        assert!(!dispatch);
        assert_eq!(observed.id, claimed.id);
        assert_eq!(
            super::claim_mutation(&key, message(&keys, "changed", 102)).unwrap_err(),
            "relay publish outcome unknown"
        );
        super::resolve_mutation(&key, message(&keys, "unrelated", 103).id).unwrap();
        assert!(super::claim_mutation(&key, message(&keys, "changed", 104)).is_err());
        super::resolve_mutation(&key, first.id).unwrap();
        assert!(
            super::claim_mutation(&key, message(&keys, "next confirmed edit", 105))
                .unwrap()
                .1
        );
    }

    #[test]
    fn unknown_outcomes_are_remembered_and_reused_with_the_same_id() {
        let keys = Keys::generate();
        let first = message(&keys, "reuse-me", 100);
        let key = fingerprint("https://relay-a.test", &first);
        settle(
            &key,
            &first,
            &Err("relay unreachable: request timed out".into()),
        )
        .unwrap_err();

        let resend = message(&keys, "reuse-me", 200);
        assert_ne!(resend.id, first.id, "重新签名会得到新的 id");
        let chosen = reuse_or(&fingerprint("https://relay-a.test", &resend), resend).unwrap();
        assert_eq!(chosen.id, first.id, "结果不明后的重发必须是同一个事件");
        assert_eq!(chosen.sig, first.sig);
    }

    #[test]
    fn acceptance_clears_the_record_so_the_same_text_is_a_new_message() {
        let keys = Keys::generate();
        let first = message(&keys, "accepted-once", 100);
        let key = fingerprint("https://relay-a.test", &first);
        settle(&key, &first, &Err("relay returned 502 Bad Gateway".into())).unwrap_err();
        settle(&key, &first, &Ok(())).unwrap();

        let later = message(&keys, "accepted-once", 300);
        assert_eq!(reuse_or(&key, later.clone()).unwrap().id, later.id);
    }

    #[test]
    fn a_rejected_resend_keeps_the_unknown_record() {
        let keys = Keys::generate();
        let first = message(&keys, "revoked-later", 100);
        let key = fingerprint("https://relay-a.test", &first);
        settle(
            &key,
            &first,
            &Err("relay unreachable: network error".into()),
        )
        .unwrap_err();
        for error in [
            "relay returned 400 Bad Request: restricted: not a channel member",
            "relay unreachable: could not connect to relay",
            "relay rate-limited: retry in 5s",
        ] {
            assert_eq!(
                settle(&key, &first, &Err(error.into())).unwrap_err(),
                "relay publish outcome unknown",
                "本次再拒绝或未发出不能证明首次未存储",
            );
        }

        let resend = message(&keys, "revoked-later", 400);
        assert_eq!(reuse_or(&key, resend).unwrap().id, first.id);
    }

    #[test]
    fn definite_failures_are_not_remembered() {
        let keys = Keys::generate();
        for error in [
            "relay unreachable: could not connect to relay",
            "relay unreachable: relay host not found",
            "relay rejected event: restricted: not a channel member",
            "relay returned 403 Forbidden: restricted",
            "relay rate-limited: retry in 5s",
        ] {
            let event = message(&keys, error, 100);
            let key = fingerprint("https://relay-b.test", &event);
            assert_eq!(settle(&key, &event, &Err(error.into())).unwrap_err(), error);
            let other = message(&keys, error, 500);
            assert_eq!(
                reuse_or(&key, other.clone()).unwrap().id,
                other.id,
                "{error}"
            );
        }
    }

    #[test]
    fn another_relay_or_author_never_reuses_the_event() {
        let keys = Keys::generate();
        let first = message(&keys, "scoped", 100);
        settle(
            &fingerprint("https://relay-c.test", &first),
            &first,
            &Err("relay unreachable: request timed out".into()),
        )
        .unwrap_err();
        let elsewhere = message(&keys, "scoped", 200);
        let key = fingerprint("https://relay-d.test", &elsewhere);
        assert_eq!(reuse_or(&key, elsewhere.clone()).unwrap().id, elsewhere.id);

        let other_author = message(&Keys::generate(), "scoped", 200);
        let key = fingerprint("https://relay-c.test", &other_author);
        assert_eq!(
            reuse_or(&key, other_author.clone()).unwrap().id,
            other_author.id
        );
    }

    /// 走 `send_channel_message` 的实际提交函数：2xx 坏正文、错配 ACK 和随后
    /// 拒绝都不改变首次未知；肯定 ACK 前始终是原事件，确认后才签新消息。
    #[tokio::test]
    async fn the_send_command_path_resubmits_the_same_event_after_an_unknown_outcome() {
        use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
        use std::sync::Arc;

        let seen: Arc<Mutex<Vec<String>>> = Arc::default();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new()
            .route(
                "/events",
                post(
                    |State(seen): State<Arc<Mutex<Vec<String>>>>,
                     Json(event): Json<serde_json::Value>| async move {
                        let id = event["id"].as_str().unwrap_or_default().to_owned();
                        let mut seen = seen.lock().unwrap();
                        let attempt = seen.len();
                        let duplicate = seen.contains(&id);
                        seen.push(id.clone());
                        match attempt {
                            0 => return (StatusCode::OK, Json(serde_json::json!({}))),
                            1 => {
                                return (
                                    StatusCode::OK,
                                    Json(serde_json::json!({
                                        "event_id": "",
                                        "accepted": true,
                                        "message": "",
                                    })),
                                )
                            }
                            2 => {
                                return (
                                    StatusCode::OK,
                                    Json(serde_json::json!({
                                        "event_id": id,
                                        "accepted": false,
                                        "message": "restricted: not a channel member",
                                    })),
                                )
                            }
                            _ => {}
                        }
                        let message = if duplicate { "duplicate:" } else { "" };
                        (
                            StatusCode::OK,
                            Json(serde_json::json!({
                                "event_id": id,
                                "accepted": true,
                                "message": message,
                            })),
                        )
                    },
                ),
            )
            .with_state(seen.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let state = crate::app_state::build_app_state();
        let keys = Keys::generate();
        let first = super::submit_reusing_unconfirmed(
            message(&keys, "via-command", 100),
            &state,
            &base,
            &keys,
        )
        .await;
        assert_eq!(first.unwrap_err(), "relay publish outcome unknown");
        for created_at in [150, 175] {
            let outcome = super::submit_reusing_unconfirmed(
                message(&keys, "via-command", created_at),
                &state,
                &base,
                &keys,
            )
            .await;
            assert_eq!(outcome.unwrap_err(), "relay publish outcome unknown");
        }
        let (resent, event) = super::submit_reusing_unconfirmed(
            message(&keys, "via-command", 200),
            &state,
            &base,
            &keys,
        )
        .await
        .expect("重发被接受");
        assert_eq!(resent.message, "duplicate:");
        let later = super::submit_reusing_unconfirmed(
            message(&keys, "via-command", 300),
            &state,
            &base,
            &keys,
        )
        .await
        .expect("新消息被接受");

        let seen = seen.lock().unwrap().clone();
        assert!(
            seen[..4].iter().all(|id| id == &seen[0]),
            "未知、坏 ACK 与再拒绝后仍是原事件"
        );
        assert_eq!(event.id.to_hex(), seen[0]);
        assert_ne!(seen[4], seen[0], "确认接受后同样的正文是一条新消息");
        assert_eq!(later.1.id.to_hex(), seen[4]);
    }
}
