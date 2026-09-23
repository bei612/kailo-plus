//! per-BuzzIdentity 的实时订阅（`SS-BUZ-SERVER-CLIENT` 的 WebSocket 半边）。
//!
//! `.design/09` 第 4 步把两条路分开：写入与历史查询走无状态的 NIP-98 HTTP
//! bridge，**只有实时订阅与 WS-only kind** 才需要该 pubkey 的 NIP-42 WebSocket
//! 会话。这个模块只承担后者。
//!
//! 不用「轮询 HTTP bridge」假装实时：那是一条绕过订阅协议的影子路径，行为
//! （延迟、重复、漏事件）与真正的订阅不一样，而上层看不出区别。
//!
//! Community 的绑定同样靠 Host 头：Relay 在 WS 升级请求上按 Host 绑定 Community
//! （`SF-BUZ-32`），因此握手必须显式带上 Community host，而不是连接地址的主机名。

use futures_util::{SinkExt, StreamExt};
use nostr::{EventBuilder, Keys, RelayUrl};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

use crate::operator::OperatorError;

/// 订阅产生的一帧。
#[derive(Debug, Clone)]
pub enum Frame {
    /// Relay 推来的一条事件
    Event(Value),
    /// 历史部分已发完，后续都是新事件（NIP-01 的 EOSE）。
    /// 它是 snapshot 与增量的分界，调用方据此决定何时认为"追平了"。
    EndOfStored,
    /// 连接已终止。带上原因，调用方据此决定重连还是放弃——而不是看到通道
    /// 关闭就当作"没有更多事件了"。
    Closed(String),
}

/// 一个活动订阅。丢弃它即关闭底层连接。
pub struct Subscription {
    rx: mpsc::Receiver<Frame>,
    _task: tokio::task::JoinHandle<()>,
}

impl Subscription {
    pub async fn next(&mut self) -> Option<Frame> {
        self.rx.recv().await
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        self._task.abort();
    }
}

/// 以该身份建立 NIP-42 会话并订阅。
///
/// `ws_url` 是连接地址（`ws://host:port`），`community_host` 是参与绑定与签名的
/// Community 主机名。两者必须分开：Relay 用 Host 绑定 Community，用连接地址去
/// 绑会绑到另一个 Community（`SF-BUZ-32`）。
pub async fn subscribe(
    keys: Keys,
    ws_url: &str,
    community_host: &str,
    filters: Vec<Value>,
    buffer: usize,
) -> Result<Subscription, OperatorError> {
    // NIP-01 限制单个 REQ 的 filter 数；上游 NIP-11 声明为 10（SF-BUZ-28）。
    // 超了不是这里截断——截断会静默丢掉调用方要的一部分 scope。
    if filters.is_empty() || filters.len() > MAX_FILTERS_PER_REQ {
        return Err(OperatorError::Sign(format!(
            "单个 REQ 的 filter 数必须在 1..={MAX_FILTERS_PER_REQ}，得到 {}",
            filters.len()
        )));
    }

    let mut request = ws_url
        .into_client_request()
        .map_err(|e| OperatorError::Sign(format!("WS 请求构造失败: {e}")))?;
    request.headers_mut().insert(
        "host",
        community_host
            .parse()
            .map_err(|_| OperatorError::Sign("Community host 不是合法 header 值".into()))?,
    );

    let (mut ws, _) = tokio_tungstenite::connect_async(request)
        .await
        .map_err(|e| OperatorError::Sign(format!("WS 连接失败: {e}")))?;

    // 认证必须在订阅之前完成：Relay 对未认证连接的 REQ 会回 auth-required，
    // 而那条错误不会带上"你还没认证"以外的信息，排查时离原因很远。
    let challenge = wait_for_challenge(&mut ws).await?;
    // 签名里的 relay URL 用 Community host 构造，与 Host 头一致
    let relay_url = RelayUrl::parse(&format!("ws://{community_host}"))
        .map_err(|e| OperatorError::Sign(format!("Community host 不可解析为 relay URL: {e}")))?;
    let auth = EventBuilder::auth(challenge, relay_url)
        .sign_with_keys(&keys)
        .map_err(|e| OperatorError::Sign(format!("AUTH 签名失败: {e}")))?;
    ws.send(Message::text(serde_json::json!(["AUTH", auth]).to_string()))
        .await
        .map_err(|e| OperatorError::Sign(format!("发送 AUTH 失败: {e}")))?;

    let sub_id = uuid::Uuid::new_v4().to_string();
    let mut req = vec![Value::from("REQ"), Value::from(sub_id.clone())];
    req.extend(filters);
    ws.send(Message::text(Value::Array(req).to_string()))
        .await
        .map_err(|e| OperatorError::Sign(format!("发送 REQ 失败: {e}")))?;

    let (tx, rx) = mpsc::channel(buffer);
    let task = tokio::spawn(async move { pump(ws, sub_id, tx).await });
    Ok(Subscription { rx, _task: task })
}

/// NIP-11 声明的单 REQ filter 上限（`SF-BUZ-28`）。
pub const MAX_FILTERS_PER_REQ: usize = 10;

async fn wait_for_challenge(
    ws: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Result<String, OperatorError> {
    // 有界等待：连接建立了但对端不发 challenge 时，无界等待会让调用方永远
    // 挂着而不是得到一个可处理的失败。
    let deadline = tokio::time::Instant::now() + CHALLENGE_TIMEOUT;
    loop {
        let frame = tokio::time::timeout_at(deadline, ws.next())
            .await
            .map_err(|_| OperatorError::Sign("等待 AUTH challenge 超时".into()))?;
        match frame {
            Some(Ok(Message::Text(text))) => {
                if let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(&text) {
                    if parts.first().and_then(Value::as_str) == Some("AUTH") {
                        if let Some(c) = parts.get(1).and_then(Value::as_str) {
                            return Ok(c.to_owned());
                        }
                    }
                }
                // 其余帧在认证完成前到达是正常的，丢弃即可——它们要么是
                // NOTICE，要么是还没被订阅过滤的东西。
            }
            Some(Ok(_)) => {}
            Some(Err(e)) => return Err(OperatorError::Sign(format!("WS 读取失败: {e}"))),
            None => return Err(OperatorError::Sign("连接在认证前被关闭".into())),
        }
    }
}

const CHALLENGE_TIMEOUT: tokio::time::Duration = tokio::time::Duration::from_secs(20);

/// 把 Relay 的帧转成 `Frame` 并送进通道。
///
/// 通道满时 `send` 会等待，从而对上游形成背压——而不是丢帧。丢帧会让调用方
/// 以为自己看到了完整序列，那比慢更糟。
async fn pump(
    mut ws: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    sub_id: String,
    tx: mpsc::Sender<Frame>,
) {
    let closed = |reason: String, tx: mpsc::Sender<Frame>| async move {
        let _ = tx.send(Frame::Closed(reason)).await;
    };
    while let Some(frame) = ws.next().await {
        let text = match frame {
            Ok(Message::Text(t)) => t,
            Ok(Message::Close(_)) => return closed("对端关闭".into(), tx).await,
            Ok(_) => continue,
            Err(e) => return closed(format!("WS 读取失败: {e}"), tx).await,
        };
        let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        match parts.first().and_then(Value::as_str) {
            // 只转发本订阅的事件：同一连接上可能有别的订阅
            Some("EVENT") if parts.get(1).and_then(Value::as_str) == Some(&sub_id) => {
                if let Some(ev) = parts.get(2) {
                    if tx.send(Frame::Event(ev.clone())).await.is_err() {
                        return;
                    }
                }
            }
            Some("EOSE")
                if parts.get(1).and_then(Value::as_str) == Some(&sub_id)
                    && tx.send(Frame::EndOfStored).await.is_err() =>
            {
                return
            }
            // 会话中途的 AUTH 挑战意味着这条连接的认证已失效。这里不就地
            // 重认证：重认证成功与否无法让上层知道，而订阅在此期间的缺口
            // 也无从得知。交给上层重建连接——重建会重新走 snapshot。
            Some("AUTH") => return closed("会话中途要求重新认证".into(), tx).await,
            Some("CLOSED") => {
                // NIP-01 允许 CLOSED 的 message 为空串。空原因往下传会变成一个
                // 没有 data 的 SSE 帧，而浏览器不派发这种帧——客户端就看不到关闭。
                let reason = parts
                    .get(2)
                    .and_then(Value::as_str)
                    .filter(|r| !r.is_empty())
                    .unwrap_or("订阅被关闭")
                    .to_owned();
                return closed(reason, tx).await;
            }
            _ => {}
        }
    }
    closed("连接结束".into(), tx).await;
}
