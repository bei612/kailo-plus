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
//!
//! # 会话复用
//!
//! `apps/02` Stage 1 要求按 `(principal, active session)` 复用 NIP-42 会话；`.design/09`
//! 要求不能靠无限增开每 Principal 连接绕过 Relay 的连接容量。Relay 侧的语义决定了
//! 复用的形状（上游 `buzz-relay/src/connection.rs`、`handlers/auth.rs`、`handlers/req.rs`）：
//!
//! - 每条连接只发一次 challenge，AUTH 成功后该连接在整个生命期内保持已认证；
//!   认证完成后再发 AUTH 只会得到 `auth-required: already authenticated`，不存在
//!   「在原连接上重新认证」。
//! - 同一连接上可以并存多个 REQ，按订阅 id 区分，上限是 NIP-11 的 `max_subscriptions`；
//!   `CLOSE` 只结束一个订阅。
//!
//! 因此这里按 (PlatformSession, Community host, pubkey) 至多保持一条已认证连接，
//! 该会话的每条流在它上面各开一个 REQ。连接只在这三者都相同时复用：会话被撤销后
//! 新会话必然另建连接并重新认证，不会继承旧会话的认证。连接断开、或 Relay 在会话
//! 中途再发 challenge（认证已失效）时，这条连接上的全部订阅以关闭原因结束；上层
//! 重建流时自然建一条新连接并重新走 NIP-42——不在旧连接上就地重认证，因为那段
//! 缺口里漏掉的事件无从得知，重建会重新取 snapshot。最后一个订阅结束时连接关闭。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use futures_util::{SinkExt, StreamExt};
use nostr::{EventBuilder, Keys, RelayUrl};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};

use crate::limits::RelayLimits;
use crate::operator::OperatorError;

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// 订阅产生的一帧。
#[derive(Debug, Clone)]
pub enum Frame {
    /// Relay 推来的一条事件
    Event(Value),
    /// 历史部分已发完，后续都是新事件（NIP-01 的 EOSE）。
    /// 它是 snapshot 与增量的分界，调用方据此决定何时认为"追平了"。
    EndOfStored,
    /// 订阅已终止。带上原因，调用方据此决定重连还是放弃——而不是看到通道
    /// 关闭就当作"没有更多事件了"。
    Closed(String),
}

/// 复用连接的键：同一个 PlatformSession、同一个 Community、同一把签名钥匙。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SessionKey {
    pub session: String,
    pub community_host: String,
    pub pubkey: String,
}

/// BFF 进程内全部已认证 Relay 连接。
pub struct RelaySessions {
    ws_url: String,
    challenge_timeout: tokio::time::Duration,
    buffer: usize,
    conns: Mutex<HashMap<SessionKey, Conn>>,
    next_id: AtomicU64,
    /// 仍在运行的连接任务数（含正在认证的）。它数的是真实连接，不是表项：
    /// 表项被覆盖或提前摘除时，底层连接可能还活着。
    live: Arc<AtomicUsize>,
}

/// 连接任务结束（无论从哪条路径）时把活动连接数减一。
struct LiveGuard(Arc<AtomicUsize>);

impl Drop for LiveGuard {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

#[derive(Clone)]
struct Conn {
    id: u64,
    cmd: mpsc::UnboundedSender<Cmd>,
}

enum Cmd {
    Subscribe {
        sub_id: String,
        req_frame: String,
        max_subscriptions: usize,
        sink: SubSink,
        ack: oneshot::Sender<Result<(), OperatorError>>,
    },
    Unsubscribe {
        sub_id: String,
    },
}

/// 连接任务一侧的订阅出口。
struct SubSink {
    tx: mpsc::Sender<Frame>,
    /// 关闭原因。先写这里再尝试送 `Closed` 帧：通道满时帧塞不进去，接收端在
    /// 通道关闭后从这里取原因——关闭原因不能因为背压而丢。
    closed: Arc<OnceLock<String>>,
}

impl SubSink {
    fn close(self, reason: &str) {
        let _ = self.closed.set(reason.to_owned());
        let _ = self.tx.try_send(Frame::Closed(reason.to_owned()));
    }

    /// 送一帧。同一连接上的订阅共用一个读循环，某一条流消费慢时不能拖住同一
    /// 会话的其它流，也不能静默丢帧让它以为序列完整——所以满了就明确结束这条
    /// 订阅（客户端按关闭原因重连并重取 snapshot）。
    fn push(&self, frame: Frame) -> Result<(), &'static str> {
        match self.tx.try_send(frame) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Full(_)) => Err("slow-consumer"),
            Err(mpsc::error::TrySendError::Closed(_)) => Err("consumer-gone"),
        }
    }
}

/// 一个活动订阅。丢弃它即在共享连接上 `CLOSE` 该订阅；它是连接上最后一个
/// 订阅时连接随之关闭。
pub struct Subscription {
    rx: mpsc::Receiver<Frame>,
    closed: Arc<OnceLock<String>>,
    finished: bool,
    sub_id: String,
    cmd: mpsc::UnboundedSender<Cmd>,
}

impl Subscription {
    pub async fn next(&mut self) -> Option<Frame> {
        if self.finished {
            return None;
        }
        match self.rx.recv().await {
            Some(Frame::Closed(reason)) => {
                self.finished = true;
                Some(Frame::Closed(reason))
            }
            Some(frame) => Some(frame),
            None => {
                self.finished = true;
                let reason = self
                    .closed
                    .get()
                    .cloned()
                    .unwrap_or_else(|| "连接结束".to_owned());
                Some(Frame::Closed(reason))
            }
        }
    }
}

impl Drop for Subscription {
    fn drop(&mut self) {
        let _ = self.cmd.send(Cmd::Unsubscribe {
            sub_id: std::mem::take(&mut self.sub_id),
        });
    }
}

impl RelaySessions {
    /// `ws_url` 是连接地址（`ws://host:port`）；Community host 另由每次订阅给出，
    /// 两者必须分开：Relay 用 Host 绑定 Community，用连接地址去绑会绑到另一个
    /// Community（`SF-BUZ-32`）。`challenge_timeout` 是建连后等 challenge 并等到 AUTH
    /// 结论的上界；`buffer` 是每条订阅的缓冲帧数。
    pub fn new(ws_url: &str, challenge_timeout: tokio::time::Duration, buffer: usize) -> Self {
        Self {
            ws_url: ws_url.to_owned(),
            challenge_timeout,
            buffer,
            conns: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
            live: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// 当前保持的 Relay 连接数（已认证或正在认证）。
    pub fn connection_count(&self) -> usize {
        self.live.load(Ordering::Relaxed)
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<SessionKey, Conn>> {
        self.conns.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 在该会话的已认证连接上开一个订阅；没有这样的连接就建一条并完成 NIP-42。
    ///
    /// filter 数、订阅 id 长度、REQ 帧大小与每连接订阅数都按 `limits`（运行期核对过的
    /// NIP-11 上界）预检，超出返回 [`OperatorError::OverLimit`]，不发往 Relay。超了不是
    /// 截断——截断会静默丢掉调用方要的一部分 scope。
    pub async fn subscribe(
        self: &Arc<Self>,
        key: SessionKey,
        keys: &Keys,
        filters: Vec<Value>,
        limits: &RelayLimits,
    ) -> Result<Subscription, OperatorError> {
        if keys.public_key().to_hex() != key.pubkey {
            return Err(OperatorError::Sign("会话键与签名身份不一致".into()));
        }
        if filters.is_empty() || filters.len() > limits.max_filters {
            return Err(OperatorError::OverLimit(format!(
                "单个 REQ 的 filter 数必须在 1..={}，得到 {}",
                limits.max_filters,
                filters.len()
            )));
        }
        let sub_id = uuid::Uuid::new_v4().simple().to_string();
        if let Some(max) = limits.max_subid_length.filter(|max| sub_id.len() > *max) {
            return Err(OperatorError::OverLimit(format!(
                "订阅 id 长度 {} 超过 {max}",
                sub_id.len()
            )));
        }
        let mut req = vec![Value::from("REQ"), Value::from(sub_id.clone())];
        req.extend(filters);
        let req_frame = Value::Array(req).to_string();
        if req_frame.len() > limits.max_message_length {
            return Err(OperatorError::OverLimit(format!(
                "REQ 帧 {} 字节超过 {}",
                req_frame.len(),
                limits.max_message_length
            )));
        }

        let (tx, rx) = mpsc::channel(self.buffer);
        let closed = Arc::new(OnceLock::new());
        let (ack_tx, ack_rx) = oneshot::channel();
        let cmd = {
            // 查找与投递在同一把锁内：连接任务退役时也持这把锁，于是一条命令要么
            // 在它退役前进入队列（会被处理或明确失败），要么看到的已是新连接。
            let mut conns = self.lock();
            let conn = match conns.get(&key) {
                Some(c) if !c.cmd.is_closed() => c.clone(),
                _ => {
                    let c = self.spawn(key.clone(), keys.clone());
                    conns.insert(key.clone(), c.clone());
                    c
                }
            };
            conn.cmd
                .send(Cmd::Subscribe {
                    sub_id: sub_id.clone(),
                    req_frame,
                    max_subscriptions: limits.max_subscriptions,
                    sink: SubSink {
                        tx,
                        closed: Arc::clone(&closed),
                    },
                    ack: ack_tx,
                })
                .map_err(|_| OperatorError::Sign("连接已结束".into()))?;
            conn.cmd
        };
        match ack_rx.await {
            Ok(Ok(())) => Ok(Subscription {
                rx,
                closed,
                finished: false,
                sub_id,
                cmd,
            }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err(OperatorError::Sign("连接在订阅确认前结束".into())),
        }
    }

    fn spawn(self: &Arc<Self>, key: SessionKey, keys: Keys) -> Conn {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (cmd, cmd_rx) = mpsc::unbounded_channel();
        self.live.fetch_add(1, Ordering::Relaxed);
        let guard = LiveGuard(Arc::clone(&self.live));
        let hub = Arc::clone(self);
        tokio::spawn(async move {
            let _guard = guard;
            run_connection(hub, key, id, keys, cmd_rx).await;
        });
        Conn { id, cmd }
    }

    /// 从表中摘掉这条连接（仍是同一条时）。
    fn retire(&self, key: &SessionKey, id: u64) {
        let mut conns = self.lock();
        if conns.get(key).is_some_and(|c| c.id == id) {
            conns.remove(key);
        }
    }

    /// 没有订阅时退役；退役判定与投递命令同锁，命令队列非空就不退。
    fn retire_if_idle(
        &self,
        key: &SessionKey,
        id: u64,
        cmd_rx: &mpsc::UnboundedReceiver<Cmd>,
    ) -> bool {
        let mut conns = self.lock();
        if !cmd_rx.is_empty() {
            return false;
        }
        if conns.get(key).is_some_and(|c| c.id == id) {
            conns.remove(key);
        }
        true
    }
}

/// 一条共享连接的全部生命期：建连并认证，然后在同一个循环里处理订阅命令与
/// Relay 帧。
async fn run_connection(
    hub: Arc<RelaySessions>,
    key: SessionKey,
    id: u64,
    keys: Keys,
    mut cmd_rx: mpsc::UnboundedReceiver<Cmd>,
) {
    let mut ws = match connect_and_auth(
        &hub.ws_url,
        &key.community_host,
        &keys,
        hub.challenge_timeout,
    )
    .await
    {
        Ok(ws) => ws,
        Err(e) => {
            hub.retire(&key, id);
            fail_pending(&mut cmd_rx, &e.to_string());
            return;
        }
    };

    let mut subs: HashMap<String, SubSink> = HashMap::new();
    let reason: String = loop {
        tokio::select! {
            cmd = cmd_rx.recv() => {
                // 表里始终持有一个发送端，走到 None 只可能是整个 hub 已被丢弃
                let Some(cmd) = cmd else { break "连接已停用".to_owned() };
                match cmd {
                    Cmd::Subscribe { sub_id, req_frame, max_subscriptions, sink, ack } => {
                        if subs.len() >= max_subscriptions {
                            let _ = ack.send(Err(OperatorError::OverLimit(format!(
                                "该会话的连接已有 {} 个订阅，达到 Relay 声明的上界",
                                subs.len()
                            ))));
                            continue;
                        }
                        if let Err(e) = ws.send(Message::text(req_frame)).await {
                            let _ = ack.send(Err(OperatorError::Sign(format!("发送 REQ 失败: {e}"))));
                            break format!("WS 写入失败: {e}");
                        }
                        if ack.send(Ok(())).is_ok() {
                            subs.insert(sub_id, sink);
                        } else if let Err(e) = close_sub(&mut ws, &sub_id).await {
                            // 调用方已放弃（请求被取消），不会有人来关这个订阅：就地关掉
                            break e;
                        }
                    }
                    Cmd::Unsubscribe { sub_id } => {
                        if subs.remove(&sub_id).is_some() {
                            if let Err(e) = close_sub(&mut ws, &sub_id).await {
                                break e;
                            }
                        }
                    }
                }
            }
            frame = ws.next() => {
                let text = match frame {
                    Some(Ok(Message::Text(t))) => t,
                    Some(Ok(Message::Close(_))) => break "对端关闭".to_owned(),
                    Some(Ok(_)) => continue,
                    Some(Err(e)) => break format!("WS 读取失败: {e}"),
                    None => break "连接结束".to_owned(),
                };
                match route(&text, &mut subs) {
                    Routed::Nothing => {}
                    Routed::Dropped(sub_id) => {
                        if let Err(e) = close_sub(&mut ws, &sub_id).await {
                            break e;
                        }
                    }
                    // 会话中途的 AUTH 挑战意味着这条连接的认证已失效。不就地
                    // 重认证：重认证成功与否无法让上层知道，而订阅在此期间的缺口
                    // 也无从得知。结束整条连接，上层重建时新建连接、重新认证。
                    Routed::Reauth => break "会话中途要求重新认证".to_owned(),
                }
            }
        }
        if subs.is_empty() && hub.retire_if_idle(&key, id, &cmd_rx) {
            let _ = ws.close(None).await;
            return;
        }
    };

    hub.retire(&key, id);
    for (_, sink) in subs.drain() {
        sink.close(&reason);
    }
    fail_pending(&mut cmd_rx, &reason);
}

async fn close_sub(ws: &mut WsStream, sub_id: &str) -> Result<(), String> {
    ws.send(Message::text(
        serde_json::json!(["CLOSE", sub_id]).to_string(),
    ))
    .await
    .map_err(|e| format!("WS 写入失败: {e}"))
}

/// 连接结束后仍在队列里的订阅请求一律明确失败。
fn fail_pending(cmd_rx: &mut mpsc::UnboundedReceiver<Cmd>, reason: &str) {
    cmd_rx.close();
    while let Ok(cmd) = cmd_rx.try_recv() {
        if let Cmd::Subscribe { ack, .. } = cmd {
            let _ = ack.send(Err(OperatorError::Sign(format!("连接不可用: {reason}"))));
        }
    }
}

enum Routed {
    Nothing,
    /// 该订阅已从本地摘除，还要在连接上 `CLOSE`
    Dropped(String),
    Reauth,
}

/// 把一帧 Relay 消息分给对应的订阅。只转发本订阅的事件：同一连接上有别的订阅。
fn route(text: &str, subs: &mut HashMap<String, SubSink>) -> Routed {
    let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(text) else {
        return Routed::Nothing;
    };
    let sub = parts.get(1).and_then(Value::as_str);
    let frame = match parts.first().and_then(Value::as_str) {
        Some("EVENT") => match parts.get(2) {
            Some(ev) => Frame::Event(ev.clone()),
            None => return Routed::Nothing,
        },
        Some("EOSE") => Frame::EndOfStored,
        Some("AUTH") => return Routed::Reauth,
        Some("CLOSED") => {
            // Relay 已结束该订阅，不需要再 CLOSE
            if let Some(sink) = sub.and_then(|s| subs.remove(s)) {
                sink.close(&closed_reason(parts.get(2).and_then(Value::as_str)));
            }
            return Routed::Nothing;
        }
        _ => return Routed::Nothing,
    };
    let Some(sub) = sub else {
        return Routed::Nothing;
    };
    let failed = match subs.get(sub) {
        Some(sink) => sink.push(frame).err(),
        None => None,
    };
    match failed {
        None => Routed::Nothing,
        Some(reason) => {
            if let Some(sink) = subs.remove(sub) {
                sink.close(reason);
            }
            Routed::Dropped(sub.to_owned())
        }
    }
}

/// Relay 的 CLOSED 原因。
///
/// NIP-01 允许 message 为空串；空原因往下传会变成一个没有 data 的 SSE 帧，而浏览器
/// 不派发这种帧——客户端就看不到关闭。`rate-limited:` 是 NIP-01 规定的机读前缀，
/// 归一成稳定的 `rate-limited`，其余原样转发。
fn closed_reason(message: Option<&str>) -> String {
    match message.filter(|r| !r.is_empty()) {
        None => "订阅被关闭".to_owned(),
        Some(r) if r.starts_with("rate-limited:") => "rate-limited".to_owned(),
        Some(r) => r.to_owned(),
    }
}

/// 建连并完成 NIP-42：等 challenge、签 AUTH、等到 Relay 对这条 AUTH 的 `OK`。
///
/// 等到 `OK` 才算认证完成：之后这条连接会被多条流复用，认证失败必须在第一次
/// 订阅时就以可处理的失败暴露，而不是让每个 REQ 各自收到一个 `auth-required`。
async fn connect_and_auth(
    ws_url: &str,
    community_host: &str,
    keys: &Keys,
    timeout: tokio::time::Duration,
) -> Result<WsStream, OperatorError> {
    let mut request = ws_url
        .into_client_request()
        .map_err(|e| OperatorError::Sign(format!("WS 请求构造失败: {e}")))?;
    request.headers_mut().insert(
        "host",
        community_host
            .parse()
            .map_err(|_| OperatorError::Sign("Community host 不是合法 header 值".into()))?,
    );

    // 有界等待：连接建立了但对端不发 challenge 或不回 AUTH 结论时，无界等待会让
    // 调用方永远挂着而不是得到一个可处理的失败。
    let deadline = tokio::time::Instant::now() + timeout;
    let (mut ws, _) = tokio::time::timeout_at(deadline, tokio_tungstenite::connect_async(request))
        .await
        .map_err(|_| OperatorError::Sign("WS 连接超时".into()))?
        .map_err(|e| OperatorError::Sign(format!("WS 连接失败: {e}")))?;

    let challenge = loop {
        match next_array(&mut ws, deadline, "等待 AUTH challenge").await? {
            parts if parts.first().and_then(Value::as_str) == Some("AUTH") => {
                if let Some(c) = parts.get(1).and_then(Value::as_str) {
                    break c.to_owned();
                }
            }
            // 其余帧在认证完成前到达是正常的（NOTICE 等），丢弃即可
            _ => {}
        }
    };

    // 签名里的 relay URL 用 Community host 构造，与 Host 头一致
    let relay_url = RelayUrl::parse(&format!("ws://{community_host}"))
        .map_err(|e| OperatorError::Sign(format!("Community host 不可解析为 relay URL: {e}")))?;
    let auth = EventBuilder::auth(challenge, relay_url)
        .sign_with_keys(keys)
        .map_err(|e| OperatorError::Sign(format!("AUTH 签名失败: {e}")))?;
    let auth_id = auth.id.to_hex();
    ws.send(Message::text(serde_json::json!(["AUTH", auth]).to_string()))
        .await
        .map_err(|e| OperatorError::Sign(format!("发送 AUTH 失败: {e}")))?;

    loop {
        let parts = next_array(&mut ws, deadline, "等待 AUTH 结论").await?;
        if parts.first().and_then(Value::as_str) == Some("OK")
            && parts.get(1).and_then(Value::as_str) == Some(auth_id.as_str())
        {
            if parts.get(2).and_then(Value::as_bool) == Some(true) {
                return Ok(ws);
            }
            let why = parts.get(3).and_then(Value::as_str).unwrap_or_default();
            return Err(OperatorError::Sign(format!("NIP-42 认证被拒绝: {why}")));
        }
    }
}

async fn next_array(
    ws: &mut WsStream,
    deadline: tokio::time::Instant,
    what: &str,
) -> Result<Vec<Value>, OperatorError> {
    loop {
        let frame = tokio::time::timeout_at(deadline, ws.next())
            .await
            .map_err(|_| OperatorError::Sign(format!("{what}超时")))?;
        match frame {
            Some(Ok(Message::Text(text))) => {
                if let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(&text) {
                    return Ok(parts);
                }
            }
            Some(Ok(_)) => {}
            Some(Err(e)) => return Err(OperatorError::Sign(format!("WS 读取失败: {e}"))),
            None => return Err(OperatorError::Sign("连接在认证完成前被关闭".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sink(buffer: usize) -> (SubSink, mpsc::Receiver<Frame>, Arc<OnceLock<String>>) {
        let (tx, rx) = mpsc::channel(buffer);
        let closed = Arc::new(OnceLock::new());
        (
            SubSink {
                tx,
                closed: Arc::clone(&closed),
            },
            rx,
            closed,
        )
    }

    #[test]
    fn frames_go_only_to_their_subscription() {
        let mut subs = HashMap::new();
        let (a, mut ra, _) = sink(4);
        let (b, mut rb, _) = sink(4);
        subs.insert("a".to_owned(), a);
        subs.insert("b".to_owned(), b);
        assert!(matches!(
            route(r#"["EVENT","a",{"id":"1"}]"#, &mut subs),
            Routed::Nothing
        ));
        assert!(matches!(
            route(r#"["EOSE","b"]"#, &mut subs),
            Routed::Nothing
        ));
        assert!(matches!(ra.try_recv(), Ok(Frame::Event(_))));
        assert!(ra.try_recv().is_err(), "b 的 EOSE 不得送到 a");
        assert!(matches!(rb.try_recv(), Ok(Frame::EndOfStored)));
    }

    #[test]
    fn relay_rate_limit_close_is_normalized_and_only_that_sub_ends() {
        let mut subs = HashMap::new();
        let (a, mut ra, closed) = sink(4);
        let (b, _rb, _) = sink(4);
        subs.insert("a".to_owned(), a);
        subs.insert("b".to_owned(), b);
        route(
            r#"["CLOSED","a","rate-limited: quota exceeded; retry in 3s"]"#,
            &mut subs,
        );
        assert!(!subs.contains_key("a") && subs.contains_key("b"));
        assert!(matches!(ra.try_recv(), Ok(Frame::Closed(r)) if r == "rate-limited"));
        assert_eq!(closed.get().map(String::as_str), Some("rate-limited"));
    }

    #[test]
    fn a_full_subscription_is_ended_explicitly_not_silently_dropped() {
        let mut subs = HashMap::new();
        let (a, _ra, closed) = sink(1);
        subs.insert("a".to_owned(), a);
        route(r#"["EVENT","a",{"id":"1"}]"#, &mut subs);
        match route(r#"["EVENT","a",{"id":"2"}]"#, &mut subs) {
            Routed::Dropped(id) => assert_eq!(id, "a"),
            _ => panic!("满了必须结束该订阅并要求 CLOSE"),
        }
        assert!(subs.is_empty());
        assert_eq!(closed.get().map(String::as_str), Some("slow-consumer"));
    }

    #[test]
    fn mid_session_auth_ends_the_connection() {
        let mut subs = HashMap::new();
        assert!(matches!(
            route(r#"["AUTH","c"]"#, &mut subs),
            Routed::Reauth
        ));
    }
}
