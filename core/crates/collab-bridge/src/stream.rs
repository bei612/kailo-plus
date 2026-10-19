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
//!
//! # WS-only 发布与在线租约（DD-120）
//!
//! 在线状态 20001 与输入中提示 20002 是只经 WebSocket 接收的瞬时事件，由同一条
//! 已认证连接发出 `["EVENT", ev]`，并等到 Relay 对该 event ID 的 `["OK", id, ok, msg]`：
//! `OK true` 才是成功，`OK false` 是带原因的拒绝，超过时限或连接在结论前中断是结果
//! 不明。三者都不重签重发——瞬时事件由下一次心跳或输入取代。
//!
//! 一次成功的在线心跳把这条 (PlatformSession, Community, pubkey) 连接保留一段租约
//! （缺省 [`PRESENCE_LEASE`]），不新增连接类别。租约到期且没有订阅时连接关闭，Relay
//! 按原版在该公钥最后一条连接关闭时清除在线状态；手动离线在结论后立即结束租约；
//! 登出与撤权用 [`RelaySessions::release`] / [`RelaySessions::release_identity`] 立即关闭。

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use futures_util::{SinkExt, StreamExt};
use nostr::{EventBuilder, Keys, RelayUrl};
use serde_json::Value;
use tokio::sync::{mpsc, oneshot};
use tokio::time::Instant;
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

/// 在线租约的缺省时长（DD-120(2)）。与 Relay 写在线事实的 `EX 180` 相同：比它长，
/// 连接会比在线事实活得久；比它短，心跳间隙里连接被关，Relay 立即清除在线状态。
pub const PRESENCE_LEASE: tokio::time::Duration = tokio::time::Duration::from_secs(180);

/// 一次 WS 发布对在线租约的影响。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lease {
    /// 不改变租约（输入中提示）
    Unchanged,
    /// Relay `OK true` 之后把连接保留一个租约期（在线心跳）；拒绝或结果不明不续租
    Renew,
    /// 得到结论（含结果不明）后立即结束租约（手动离线）
    End,
}

/// WS 发布的失败。三者互斥；无论哪一种，调用方都不得另签新事件重发。
#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    /// Relay 以 `OK false` 拒绝，原因原样保留
    #[error("Relay 拒绝: {0}")]
    Rejected(String),
    /// 已发出，但在时限内没有得到 `OK`，或连接在结论前结束：结果不明
    #[error("结果不明: {0}")]
    Unknown(String),
    /// 确定没有发出：建连、认证或上界预检失败
    #[error("未发出: {0}")]
    NotSent(OperatorError),
}

/// BFF 进程内全部已认证 Relay 连接。
pub struct RelaySessions {
    ws_url: String,
    challenge_timeout: tokio::time::Duration,
    /// 等 Relay 回某次 WS 发布 `OK` 的上界；缺省与建连认证上界相同
    publish_timeout: tokio::time::Duration,
    /// 在线租约时长，缺省 [`PRESENCE_LEASE`]
    presence_lease: tokio::time::Duration,
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
    /// 连接任务维护：此刻是否持有未到期的在线租约
    leased: Arc<AtomicBool>,
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
    Publish {
        event_id: String,
        frame: String,
        lease: Lease,
        ack: oneshot::Sender<Result<(), PublishError>>,
    },
    /// 立即关闭连接；订阅以该原因结束
    Release(String),
}

/// 已发出、正在等 `OK` 的一次发布。
struct InFlight {
    deadline: Instant,
    lease: Lease,
    ack: oneshot::Sender<Result<(), PublishError>>,
}

/// Relay 的 `["OK", id, accepted, message]`。
#[derive(Debug, PartialEq, Eq)]
struct RelayOk {
    event_id: String,
    accepted: bool,
    message: String,
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
            publish_timeout: challenge_timeout,
            presence_lease: PRESENCE_LEASE,
            buffer,
            conns: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
            live: Arc::new(AtomicUsize::new(0)),
        }
    }

    /// Relay 的 WebSocket 网络地址（`BUZZ_RELAY_WS_URL`）。DD-125(3) 的 Huddle 音频桥连向
    /// 同一 Relay 的 `/huddle/{channel}/audio`，不另设地址。
    pub fn ws_url(&self) -> &str {
        &self.ws_url
    }

    /// 建连认证上界（`BFF_STREAM_AUTH_TIMEOUT_SECONDS`），音频桥的挑战认证共用它。
    pub fn challenge_timeout(&self) -> tokio::time::Duration {
        self.challenge_timeout
    }

    /// 覆盖等待 WS 发布结论的上界。
    pub fn with_publish_timeout(mut self, timeout: tokio::time::Duration) -> Self {
        self.publish_timeout = timeout;
        self
    }

    /// 覆盖在线租约时长。
    pub fn with_presence_lease(mut self, lease: tokio::time::Duration) -> Self {
        self.presence_lease = lease;
        self
    }

    /// 当前保持的 Relay 连接数（已认证或正在认证）。
    pub fn connection_count(&self) -> usize {
        self.live.load(Ordering::Relaxed)
    }

    /// 持有未到期在线租约的连接键。撤权巡检只需看它们：有订阅的连接由各自
    /// 流的周期性再准入负责。
    pub fn leased(&self) -> Vec<SessionKey> {
        self.lock()
            .iter()
            .filter(|(_, conn)| conn.leased.load(Ordering::Relaxed))
            .map(|(key, _)| key.clone())
            .collect()
    }

    /// 登出或会话失效：立即关闭该 PlatformSession 的全部连接（DD-120(2)）。在线租约
    /// 随之结束，连接上的订阅以 `session-revoked` 结束；Relay 在该公钥最后一条连接
    /// 关闭时按原版清除在线状态。
    pub fn release(&self, session: &str) {
        self.close_where(|key| key.session == session, "session-revoked");
    }

    /// 签名身份不再 ACTIVE（密钥撤销或轮换）：只关这一条连接，订阅以
    /// `identity-revoked` 结束——会话本身仍可用新身份重建流。
    pub fn release_identity(&self, key: &SessionKey) {
        self.close_where(|candidate| candidate == key, "identity-revoked");
    }

    /// 摘表与投递同锁：之后同一键上的命令只会建新连接，不会落进正在关闭的这条。
    fn close_where(&self, matches: impl Fn(&SessionKey) -> bool, reason: &str) {
        self.lock().retain(|key, conn| {
            if !matches(key) {
                return true;
            }
            let _ = conn.cmd.send(Cmd::Release(reason.to_owned()));
            false
        });
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<SessionKey, Conn>> {
        self.conns.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// 该会话已有的连接；没有（或已结束）就建一条并登记。调用方持表锁。
    fn connection(
        self: &Arc<Self>,
        conns: &mut HashMap<SessionKey, Conn>,
        key: &SessionKey,
        keys: &Keys,
    ) -> Conn {
        match conns.get(key) {
            Some(c) if !c.cmd.is_closed() => c.clone(),
            _ => {
                let c = self.spawn(key.clone(), keys.clone());
                conns.insert(key.clone(), c.clone());
                c
            }
        }
    }

    /// 在该会话的已认证连接上发一条 WS-only 事件（`.design/09` 第 4 步）并等到 Relay
    /// 对它的 `OK`；没有这样的连接就建一条并完成 NIP-42——同一 (PlatformSession,
    /// Community, pubkey) 至多一条连接，不新增连接类别（DD-120(2)）。
    ///
    /// `Ok` 只表示 Relay `OK true`。[`PublishError::Rejected`] 是 `OK false`；已发出而在
    /// 时限内没有结论是 [`PublishError::Unknown`]。调用方不得据此另签新事件重发。
    pub async fn publish(
        self: &Arc<Self>,
        key: SessionKey,
        keys: &Keys,
        event: &nostr::Event,
        limits: &RelayLimits,
        lease: Lease,
    ) -> Result<(), PublishError> {
        let signer = keys.public_key();
        if signer != event.pubkey || signer.to_hex() != key.pubkey {
            return Err(PublishError::NotSent(OperatorError::Sign(
                "会话键、签名身份与事件作者不一致".into(),
            )));
        }
        let frame = serde_json::json!(["EVENT", event]).to_string();
        if frame.len() > limits.max_message_length {
            return Err(PublishError::NotSent(OperatorError::OverLimit(format!(
                "EVENT 帧 {} 字节超过 {}",
                frame.len(),
                limits.max_message_length
            ))));
        }
        let (ack, outcome) = oneshot::channel();
        {
            let mut conns = self.lock();
            let conn = self.connection(&mut conns, &key, keys);
            conn.cmd
                .send(Cmd::Publish {
                    event_id: event.id.to_hex(),
                    frame,
                    lease,
                    ack,
                })
                .map_err(|_| PublishError::NotSent(OperatorError::Sign("连接已结束".into())))?;
        }
        // 连接任务对每条入队的发布都给出结论；走到 Err 只可能是任务异常终止，
        // 那时无从知道是否已发出
        outcome
            .await
            .unwrap_or_else(|_| Err(PublishError::Unknown("连接在给出结论前结束".into())))
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
            let conn = self.connection(&mut conns, &key, keys);
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
        let leased = Arc::new(AtomicBool::new(false));
        self.live.fetch_add(1, Ordering::Relaxed);
        let guard = LiveGuard(Arc::clone(&self.live));
        let hub = Arc::clone(self);
        let flag = Arc::clone(&leased);
        tokio::spawn(async move {
            let _guard = guard;
            run_connection(hub, key, id, keys, flag, cmd_rx).await;
        });
        Conn { id, cmd, leased }
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

/// 一条共享连接的全部生命期：建连并认证，然后在同一个循环里处理订阅与发布命令、
/// Relay 帧、发布时限与在线租约。
async fn run_connection(
    hub: Arc<RelaySessions>,
    key: SessionKey,
    id: u64,
    keys: Keys,
    leased: Arc<AtomicBool>,
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
    let mut inflight: HashMap<String, InFlight> = HashMap::new();
    let mut lease: Option<Instant> = None;
    let reason: String = loop {
        let deadline = inflight.values().map(|pending| pending.deadline).min();
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
                    Cmd::Publish { event_id, frame, lease: effect, ack } => {
                        match inflight.entry(event_id) {
                            std::collections::hash_map::Entry::Occupied(_) => {
                                // 同一事件已在等结论：不再发第二次，结论只有一个
                                let _ = ack.send(Err(PublishError::Unknown(
                                    "同一事件已在等待 Relay 结论".into(),
                                )));
                            }
                            std::collections::hash_map::Entry::Vacant(slot) => {
                                if let Err(e) = ws.send(Message::text(frame)).await {
                                    // 写入失败时无从知道对端是否已收到部分帧：结果不明
                                    let _ = ack.send(Err(PublishError::Unknown(format!(
                                        "发送 EVENT 失败: {e}"
                                    ))));
                                    break format!("WS 写入失败: {e}");
                                }
                                slot.insert(InFlight {
                                    deadline: Instant::now() + hub.publish_timeout,
                                    lease: effect,
                                    ack,
                                });
                            }
                        }
                    }
                    Cmd::Release(why) => break why,
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
                if let Some(ok) = relay_ok(&text) {
                    settle(&mut inflight, &mut lease, ok, hub.presence_lease);
                } else {
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
            _ = until(deadline) => expire(&mut inflight, &mut lease, Instant::now()),
            _ = until(lease) => lease = None,
        }
        leased.store(lease.is_some(), Ordering::Relaxed);
        if subs.is_empty()
            && inflight.is_empty()
            && lease.is_none()
            && hub.retire_if_idle(&key, id, &cmd_rx)
        {
            let _ = ws.close(None).await;
            return;
        }
    };

    leased.store(false, Ordering::Relaxed);
    hub.retire(&key, id);
    for (_, sink) in subs.drain() {
        sink.close(&reason);
    }
    for (_, pending) in inflight.drain() {
        let why = format!("连接在得到 OK 前结束: {reason}");
        let _ = pending.ack.send(Err(PublishError::Unknown(why)));
    }
    fail_pending(&mut cmd_rx, &reason);
}

/// 到点即完成；没有时刻就永不完成（`select!` 中该分支等于不存在）。
async fn until(deadline: Option<Instant>) {
    match deadline {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending::<()>().await,
    }
}

/// 解析 Relay 的 `OK` 帧。先看前缀，其余帧（含大体积 EVENT）照旧只由 `route` 解析一次。
fn relay_ok(text: &str) -> Option<RelayOk> {
    let rest = text.trim_start().strip_prefix('[')?;
    if !rest.trim_start().starts_with("\"OK\"") {
        return None;
    }
    let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(text) else {
        return None;
    };
    Some(RelayOk {
        event_id: parts.get(1)?.as_str()?.to_owned(),
        accepted: parts.get(2)?.as_bool()?,
        message: parts
            .get(3)
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_owned(),
    })
}

/// Relay 对一次发布的结论：交还调用方，并按该发布的租约意图调整租约。不认识的
/// event ID（例如已判为结果不明后才迟到的 `OK`）不改变任何状态。
fn settle(
    inflight: &mut HashMap<String, InFlight>,
    lease: &mut Option<Instant>,
    ok: RelayOk,
    presence_lease: tokio::time::Duration,
) {
    let Some(pending) = inflight.remove(&ok.event_id) else {
        return;
    };
    match pending.lease {
        Lease::Renew if ok.accepted => *lease = Some(Instant::now() + presence_lease),
        Lease::End => *lease = None,
        Lease::Renew | Lease::Unchanged => {}
    }
    let outcome = if ok.accepted {
        Ok(())
    } else {
        Err(PublishError::Rejected(ok.message))
    };
    let _ = pending.ack.send(outcome);
}

/// 超过时限仍没有 `OK` 的发布是结果不明；不续租，手动离线的租约照样结束。
fn expire(inflight: &mut HashMap<String, InFlight>, lease: &mut Option<Instant>, now: Instant) {
    let expired: Vec<String> = inflight
        .iter()
        .filter(|(_, pending)| pending.deadline <= now)
        .map(|(event_id, _)| event_id.clone())
        .collect();
    for event_id in expired {
        let Some(pending) = inflight.remove(&event_id) else {
            continue;
        };
        if pending.lease == Lease::End {
            *lease = None;
        }
        let unknown = PublishError::Unknown("等待 Relay OK 超时".into());
        let _ = pending.ack.send(Err(unknown));
    }
}

async fn close_sub(ws: &mut WsStream, sub_id: &str) -> Result<(), String> {
    ws.send(Message::text(
        serde_json::json!(["CLOSE", sub_id]).to_string(),
    ))
    .await
    .map_err(|e| format!("WS 写入失败: {e}"))
}

/// 连接结束后仍在队列里的订阅与发布请求一律明确失败。它们从未写上连接，
/// 发布因此是「未发出」而不是结果不明。
fn fail_pending(cmd_rx: &mut mpsc::UnboundedReceiver<Cmd>, reason: &str) {
    cmd_rx.close();
    while let Ok(cmd) = cmd_rx.try_recv() {
        let unavailable = OperatorError::Sign(format!("连接不可用: {reason}"));
        match cmd {
            Cmd::Subscribe { ack, .. } => {
                let _ = ack.send(Err(unavailable));
            }
            Cmd::Publish { ack, .. } => {
                let _ = ack.send(Err(PublishError::NotSent(unavailable)));
            }
            Cmd::Unsubscribe { .. } | Cmd::Release(_) => {}
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

    #[test]
    fn only_ok_frames_settle_publications() {
        assert_eq!(
            relay_ok(r#"[ "OK", "abc", false, "blocked: not a member" ]"#),
            Some(RelayOk {
                event_id: "abc".into(),
                accepted: false,
                message: "blocked: not a member".into(),
            })
        );
        assert_eq!(
            relay_ok(r#"["OK","abc",true]"#).map(|ok| ok.accepted),
            Some(true)
        );
        assert!(relay_ok(r#"["EVENT","sub",{"content":"OK"}]"#).is_none());
        assert!(relay_ok(r#"["OK","abc"]"#).is_none());
    }

    /// 测试侧 Relay 看到的事实。
    #[derive(Debug, PartialEq)]
    enum Seen {
        Event(String),
        Closed,
    }

    /// 最小 Relay：每条连接先完成 NIP-42，再按事件 content 回应 EVENT——`accept` 回
    /// `OK true`，`reject` 回 `OK false`，其余不回应。连接结束时报告 `Closed`。
    async fn fake_relay() -> (String, mpsc::UnboundedReceiver<Seen>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let address = listener.local_addr().expect("local address");
        let (seen, observed) = mpsc::unbounded_channel();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(fake_connection(stream, seen.clone()));
            }
        });
        (format!("ws://{address}"), observed)
    }

    async fn fake_connection(stream: tokio::net::TcpStream, seen: mpsc::UnboundedSender<Seen>) {
        let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else {
            return;
        };
        let _ = ws.send(Message::text(r#"["AUTH","challenge"]"#)).await;
        while let Some(Ok(message)) = ws.next().await {
            let Message::Text(text) = message else {
                continue;
            };
            let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            let event = parts.get(1).cloned().unwrap_or_default();
            let id = event["id"].as_str().unwrap_or_default().to_owned();
            let verdict = match parts.first().and_then(Value::as_str) {
                Some("AUTH") => Some((true, "")),
                Some("EVENT") => {
                    let _ = seen.send(Seen::Event(id.clone()));
                    match event["content"].as_str() {
                        Some("accept") => Some((true, "")),
                        Some("reject") => Some((false, "blocked: not a member")),
                        _ => None,
                    }
                }
                _ => None,
            };
            if let Some((accepted, message)) = verdict {
                let ok = serde_json::json!(["OK", id, accepted, message]);
                let _ = ws.send(Message::text(ok.to_string())).await;
            }
        }
        let _ = seen.send(Seen::Closed);
    }

    fn limits() -> RelayLimits {
        RelayLimits {
            max_subscriptions: 4,
            max_filters: 10,
            max_limit: 100,
            max_subid_length: None,
            max_message_length: 64 * 1024,
        }
    }

    fn presence(keys: &Keys, content: &str) -> nostr::Event {
        EventBuilder::new(nostr::Kind::Custom(20001), content)
            .sign_with_keys(keys)
            .expect("sign")
    }

    fn session(name: &str, keys: &Keys) -> SessionKey {
        SessionKey {
            session: name.to_owned(),
            community_host: "relay.test".to_owned(),
            pubkey: keys.public_key().to_hex(),
        }
    }

    fn hub(url: &str, lease: tokio::time::Duration) -> Arc<RelaySessions> {
        let sessions = RelaySessions::new(url, tokio::time::Duration::from_secs(5), 4)
            .with_publish_timeout(tokio::time::Duration::from_millis(300))
            .with_presence_lease(lease);
        Arc::new(sessions)
    }

    async fn until_connections(hub: &RelaySessions, count: usize) -> bool {
        let deadline = Instant::now() + tokio::time::Duration::from_secs(5);
        while hub.connection_count() != count {
            if Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(20)).await;
        }
        true
    }

    #[tokio::test]
    async fn accepted_heartbeat_pins_the_connection_until_the_lease_expires() {
        let (url, mut seen) = fake_relay().await;
        let hub = hub(&url, tokio::time::Duration::from_millis(800));
        let keys = Keys::generate();
        let event = presence(&keys, "accept");
        hub.publish(session("s", &keys), &keys, &event, &limits(), Lease::Renew)
            .await
            .expect("OK true is success");
        assert_eq!(seen.recv().await, Some(Seen::Event(event.id.to_hex())));
        assert_eq!(hub.leased(), vec![session("s", &keys)]);
        // 没有任何订阅，只靠租约保留连接
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;
        assert_eq!(hub.connection_count(), 1, "lease keeps the connection");
        assert!(until_connections(&hub, 0).await, "lease expiry closes it");
        assert_eq!(seen.recv().await, Some(Seen::Closed));
        assert!(hub.leased().is_empty());
    }

    #[tokio::test]
    async fn relay_rejection_is_typed_and_never_pins_the_connection() {
        let (url, _seen) = fake_relay().await;
        let hub = hub(&url, tokio::time::Duration::from_secs(60));
        let keys = Keys::generate();
        let event = presence(&keys, "reject");
        let outcome = hub
            .publish(session("s", &keys), &keys, &event, &limits(), Lease::Renew)
            .await;
        match outcome {
            Err(PublishError::Rejected(message)) => assert_eq!(message, "blocked: not a member"),
            other => panic!("OK false must be a typed rejection: {other:?}"),
        }
        assert!(until_connections(&hub, 0).await, "rejection never renews");
    }

    #[tokio::test]
    async fn missing_ok_is_unknown_not_success_and_not_unsent() {
        let (url, mut seen) = fake_relay().await;
        let hub = hub(&url, tokio::time::Duration::from_secs(60));
        let keys = Keys::generate();
        let event = presence(&keys, "silent");
        let started = Instant::now();
        let outcome = hub
            .publish(session("s", &keys), &keys, &event, &limits(), Lease::Renew)
            .await;
        assert!(
            matches!(outcome, Err(PublishError::Unknown(_))),
            "{outcome:?}"
        );
        assert!(started.elapsed() < tokio::time::Duration::from_secs(5));
        // 事件确已发出：这是结果不明，而不是未发出
        assert_eq!(seen.recv().await, Some(Seen::Event(event.id.to_hex())));
        assert!(until_connections(&hub, 0).await, "unknown never renews");
    }

    #[tokio::test]
    async fn manual_offline_ends_the_lease_and_closes_an_idle_connection() {
        let (url, _seen) = fake_relay().await;
        let hub = hub(&url, tokio::time::Duration::from_secs(60));
        let keys = Keys::generate();
        let event = presence(&keys, "accept");
        hub.publish(session("s", &keys), &keys, &event, &limits(), Lease::Renew)
            .await
            .expect("online");
        assert_eq!(hub.connection_count(), 1);
        hub.publish(session("s", &keys), &keys, &event, &limits(), Lease::End)
            .await
            .expect("offline");
        assert!(until_connections(&hub, 0).await, "offline ends the lease");
    }

    #[tokio::test]
    async fn release_closes_only_that_session_before_its_lease_expires() {
        let (url, _seen) = fake_relay().await;
        let hub = hub(&url, tokio::time::Duration::from_secs(60));
        let keys = Keys::generate();
        for name in ["gone", "kept"] {
            let event = presence(&keys, "accept");
            hub.publish(session(name, &keys), &keys, &event, &limits(), Lease::Renew)
                .await
                .expect("online");
        }
        assert_eq!(hub.connection_count(), 2);
        hub.release("gone");
        assert!(until_connections(&hub, 1).await, "logout closes at once");
        assert_eq!(hub.leased(), vec![session("kept", &keys)]);
        hub.release_identity(&session("kept", &keys));
        assert!(until_connections(&hub, 0).await, "revocation closes it");
    }

    #[tokio::test]
    async fn a_foreign_event_is_never_sent_on_the_session() {
        let hub = hub("ws://127.0.0.1:9", tokio::time::Duration::from_secs(60));
        let keys = Keys::generate();
        let event = presence(&Keys::generate(), "accept");
        let outcome = hub
            .publish(session("s", &keys), &keys, &event, &limits(), Lease::Renew)
            .await;
        assert!(
            matches!(outcome, Err(PublishError::NotSent(_))),
            "{outcome:?}"
        );
        assert_eq!(hub.connection_count(), 0);
    }
}
