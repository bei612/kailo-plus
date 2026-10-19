//! DD-125(3)、`09` §3：Web Huddle 的同源 BFF 音频桥（V-SCN-158/159）。
//!
//! Browser 不持签名材料、不直连 Relay（DD-39）。`GET /api/v1/huddles/{huddle_id}/audio`
//! 升级为 WebSocket 后，BFF 以本人 SERVER 身份连上 Relay 原 `/huddle/{channel}/audio`，
//! 在原 JSON 挑战帧之后签 22242（协议版本 2，与原生端同房间），此后：
//!
//! - Relay → Browser：`joined`/`left`/`roster`/`error` 文本与 `[peer_index][8 字节头][opus]`
//!   二进制原样转发；
//! - Browser → Relay：只转发带 v2 头、不超过 4096 字节的帧与原 `{"type":"leave"}`；其余
//!   文本（含伪造的 `auth`）一律丢弃。BFF 不解码、不混音、不改写帧。
//!
//! 一条桥对应一个 (PlatformSession, HuddleBuzzBinding)：同一会话对同一 Huddle 再开一条即
//! 关闭旧的。会话失效（登出、撤权）、父 scope 准入失效或绑定离开 `ACTIVE` 时，桥在
//! `BFF_STREAM_READMIT_SECONDS` 内关闭；Relay 在 CONTROL 9001 与归档时也会主动断开。
//! 它不是在线状态租约，也不新增 Relay 订阅连接类别。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use axum::body::Body;
use axum::extract::{Path, Request, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use hyper_util::rt::TokioIo;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::handshake::derive_accept_key;
use tokio_tungstenite::tungstenite::protocol::{Role, WebSocketConfig};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use uuid::Uuid;

use collab_bridge::huddle as wire;

use crate::bff::BffState;

type Key = (Uuid, Uuid);

/// (PlatformSession, Huddle) → 当前那条桥的停止信号。
fn bridges() -> &'static Mutex<HashMap<Key, Arc<Notify>>> {
    static BRIDGES: OnceLock<Mutex<HashMap<Key, Arc<Notify>>>> = OnceLock::new();
    BRIDGES.get_or_init(Default::default)
}

/// 登记新桥并停止同一 (会话, Huddle) 的旧桥。
fn register(key: Key) -> Arc<Notify> {
    let stop = Arc::new(Notify::new());
    let previous = bridges()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .insert(key, Arc::clone(&stop));
    if let Some(previous) = previous {
        previous.notify_one();
    }
    stop
}

/// 只摘除自己：被新桥替换后，旧桥退出时不能把新桥的登记删掉。
fn unregister(key: Key, stop: &Arc<Notify>) {
    let mut map = bridges()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if map
        .get(&key)
        .is_some_and(|current| Arc::ptr_eq(current, stop))
    {
        map.remove(&key);
    }
}

/// RFC 6455 升级请求，返回 `Sec-WebSocket-Accept`。
fn websocket_accept(headers: &HeaderMap) -> Option<String> {
    let has_token = |name: header::HeaderName, token: &str| {
        headers
            .get_all(name)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|value| value.split(','))
            .any(|part| part.trim().eq_ignore_ascii_case(token))
    };
    if !has_token(header::CONNECTION, "upgrade")
        || !has_token(header::UPGRADE, "websocket")
        || headers
            .get(header::SEC_WEBSOCKET_VERSION)
            .and_then(|value| value.to_str().ok())
            != Some("13")
    {
        return None;
    }
    let key = headers.get(header::SEC_WEBSOCKET_KEY)?;
    Some(derive_accept_key(key.as_bytes()))
}

/// 跨源伪造防护由网关 csrf 策略执行（DD-112）；升级是 GET，这里另以 Fetch Metadata 拒绝
/// 浏览器明示的跨站升级。没有该头的旧浏览器仍由网关会话与 csrf 策略把关。
fn cross_site(headers: &HeaderMap) -> bool {
    headers
        .get("sec-fetch-site")
        .and_then(|value| value.to_str().ok())
        .is_some_and(|site| site != "same-origin")
}

/// `GET /api/v1/huddles/{huddle_id}/audio`。
pub async fn bridge(
    State(state): State<BffState>,
    Path(huddle): Path<Uuid>,
    mut request: Request,
) -> Response {
    let headers = request.headers().clone();
    let Some(accept) = websocket_accept(&headers) else {
        return StatusCode::UPGRADE_REQUIRED.into_response();
    };
    if cross_site(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let ctx = match crate::huddle::context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let admitted = match crate::huddle::admit_audio(&state, &ctx, huddle).await {
        Ok(admitted) => admitted,
        Err(response) => return response,
    };
    // 先连上 Relay 并完成认证帧，再答 101：连不上时 Browser 得到确定的 HTTP 失败，
    // 而不是一条随即关闭的 WebSocket。
    let relay = match wire::connect_audio(
        state.relay_sessions.ws_url(),
        &admitted.client,
        admitted.channel,
        admitted.parent,
        state.relay_sessions.challenge_timeout(),
    )
    .await
    {
        Ok(relay) => relay,
        Err(e) => {
            tracing::warn!(error = %e, huddle = %huddle, "Huddle 音频桥连不上 Relay");
            return crate::web_transport::relay_error_response(&e, None);
        }
    };
    let on_upgrade = hyper::upgrade::on(&mut request);
    let key = (ctx.session_id, huddle);
    let stop = register(key);
    tokio::spawn(async move {
        let upgraded = match on_upgrade.await {
            Ok(upgraded) => upgraded,
            Err(e) => {
                tracing::info!(error = %e, huddle = %huddle, "Huddle 音频桥升级未完成");
                unregister(key, &stop);
                return;
            }
        };
        let config = WebSocketConfig {
            max_message_size: Some(wire::MAX_AUDIO_MESSAGE_BYTES),
            max_frame_size: Some(wire::MAX_AUDIO_MESSAGE_BYTES),
            ..WebSocketConfig::default()
        };
        let browser =
            WebSocketStream::from_raw_socket(TokioIo::new(upgraded), Role::Server, Some(config))
                .await;
        pump(&state, &headers, huddle, browser, relay, &stop).await;
        unregister(key, &stop);
    });
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::SWITCHING_PROTOCOLS;
    let response_headers = response.headers_mut();
    response_headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
    response_headers.insert(header::CONNECTION, HeaderValue::from_static("upgrade"));
    match HeaderValue::from_str(&accept) {
        Ok(value) => {
            response_headers.insert(header::SEC_WEBSOCKET_ACCEPT, value);
        }
        Err(_) => return StatusCode::BAD_REQUEST.into_response(),
    }
    response
}

/// 双向原样转发，直到任一端关闭、被新桥替换或重新准入失败。
async fn pump<B>(
    state: &BffState,
    headers: &HeaderMap,
    huddle: Uuid,
    browser: WebSocketStream<B>,
    relay: wire::AudioSocket,
    stop: &Notify,
) where
    B: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (mut to_browser, mut from_browser) = browser.split();
    let (mut to_relay, mut from_relay) = relay.split();
    let period = std::time::Duration::from_secs(state.stream_readmit_seconds.max(1));
    let mut readmit = tokio::time::interval_at(tokio::time::Instant::now() + period, period);
    readmit.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = stop.notified() => break,
            _ = readmit.tick() => {
                if !crate::huddle::audio_still_admitted(state, headers, huddle).await {
                    break;
                }
            }
            frame = from_browser.next() => match frame {
                Some(Ok(Message::Binary(bytes))) => {
                    if wire::valid_uplink_frame(&bytes)
                        && to_relay.send(Message::Binary(bytes)).await.is_err()
                    {
                        break;
                    }
                }
                Some(Ok(Message::Text(text))) => {
                    if wire::is_leave_message(&text) {
                        let _ = to_relay.send(Message::Text(text)).await;
                        break;
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                // Ping/Pong 由 tungstenite 自己应答
                Some(Ok(_)) => {}
            },
            frame = from_relay.next() => match frame {
                Some(Ok(message @ (Message::Binary(_) | Message::Text(_)))) => {
                    if to_browser.send(message).await.is_err() {
                        break;
                    }
                }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                Some(Ok(_)) => {}
            },
        }
    }
    let _ = to_relay.send(Message::Close(None)).await;
    let _ = to_browser.send(Message::Close(None)).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn upgrade_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::CONNECTION,
            HeaderValue::from_static("keep-alive, Upgrade"),
        );
        headers.insert(header::UPGRADE, HeaderValue::from_static("websocket"));
        headers.insert(
            header::SEC_WEBSOCKET_VERSION,
            HeaderValue::from_static("13"),
        );
        headers.insert(
            header::SEC_WEBSOCKET_KEY,
            HeaderValue::from_static("dGhlIHNhbXBsZSBub25jZQ=="),
        );
        headers
    }

    #[test]
    fn upgrade_requires_the_rfc6455_handshake() {
        // RFC 6455 §1.3 sample key and accept value.
        assert_eq!(
            websocket_accept(&upgrade_headers()).as_deref(),
            Some("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=")
        );
        let mut old = upgrade_headers();
        old.insert(header::SEC_WEBSOCKET_VERSION, HeaderValue::from_static("8"));
        assert!(websocket_accept(&old).is_none());
        let mut plain = upgrade_headers();
        plain.remove(header::UPGRADE);
        assert!(websocket_accept(&plain).is_none());
    }

    #[test]
    fn only_declared_cross_site_upgrades_are_refused() {
        let mut headers = HeaderMap::new();
        assert!(!cross_site(&headers));
        headers.insert("sec-fetch-site", HeaderValue::from_static("same-origin"));
        assert!(!cross_site(&headers));
        headers.insert("sec-fetch-site", HeaderValue::from_static("cross-site"));
        assert!(cross_site(&headers));
    }

    #[test]
    fn a_newer_bridge_replaces_the_older_one() {
        let key = (Uuid::new_v4(), Uuid::new_v4());
        let first = register(key);
        let second = register(key);
        // The replaced bridge leaving must not drop the current registration.
        unregister(key, &first);
        assert!(bridges()
            .lock()
            .unwrap()
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, &second)));
        unregister(key, &second);
        assert!(!bridges().lock().unwrap().contains_key(&key));
    }
}
