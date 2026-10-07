//! BFF 侧的 per-BuzzIdentity Relay 客户端（`SS-BUZ-SERVER-CLIENT`）。
//!
//! 按 `.design/09` 第 4 步：写入与历史查询走 NIP-98 HTTP bridge，每请求一个
//! 签名、无连接状态；只有实时订阅与 WS-only kind 才需要该 pubkey 的 NIP-42
//! WebSocket 会话。本模块只承担前者。
//!
//! 上游 `HarnessRelay`/`RestClient` 是 ACP harness 内的单身份客户端，其内存
//! queue/seen/retry 不升格为业务可靠权威——重试与去重由 Core 的 outbox 承担。

use std::sync::Arc;

use base64::Engine;
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use crate::limits::ApiBudget;
use crate::operator::{LimitKind, OperatorError};
pub use buzz_core::kind::{
    KIND_DELETION, KIND_NIP29_DELETE_EVENT, KIND_REACTION, KIND_STREAM_MESSAGE_EDIT,
    KIND_THREAD_SUMMARY, KIND_WINDOW_BOUNDS,
};
pub use buzz_core::nip10::parse_thread_markers;
pub use buzz_core::relay::{
    BRIDGE_THREAD_MAX_LIMIT, BRIDGE_WINDOW_MAX_LIMIT, DEFAULT_THREAD_DEPTH_LIMIT,
};

/// Buzz 的事件 kind。取自上游 `buzz-core/src/kind.rs` 的同名常量，
/// 不是本仓库自定义的编号——改动必须回到上游确认。
const KIND_RELAY_ADMIN_ADD: u16 = 9030;
const KIND_RELAY_ADMIN_REMOVE: u16 = 9031;
const KIND_RELAY_MEMBERSHIP_LIST: u16 = 13534;
const KIND_CHANNEL_ADD_USER: u16 = 9000;
const KIND_CHANNEL_REMOVE_USER: u16 = 9001;
const KIND_CHANNEL_MEMBERS: u16 = 39002;
const KIND_CHANNEL_MESSAGE: u16 = 9;
const KIND_CHANNEL_CREATE: u16 = 9007;
const KIND_CHANNEL_EDIT_METADATA: u16 = 9002;
const KIND_CHANNEL_METADATA: u16 = 39000;

/// Contract mirrors the pinned SDK's character bound; no client-specific limit.
pub fn valid_reaction(emoji: &str) -> bool {
    let schema: Result<Value, _> = serde_json::from_str(include_str!(
        "../../../../contracts/domain/automation_step.schema.json"
    ));
    !emoji.trim().is_empty()
        && schema
            .ok()
            .and_then(|schema| schema["properties"]["emoji"]["maxLength"].as_u64())
            .is_some_and(|maximum| emoji.chars().count() as u64 <= maximum)
}

fn reaction_matches(event: &Event, id: &str, author: &str, source: &str, emoji: &str) -> bool {
    event.id.to_hex() == id
        && event.pubkey.to_hex() == author
        && u32::from(event.kind.as_u16()) == KIND_REACTION
        && event.verify().is_ok()
        && event.content == emoji
        && event.tags.len() == 1
        && event
            .tags
            .iter()
            .next()
            .is_some_and(|tag| tag.as_slice() == ["e", source])
}

pub fn message_kind(message_type: &contracts::WebMessageType) -> u16 {
    match message_type {
        contracts::WebMessageType::Stream => buzz_core::kind::KIND_STREAM_MESSAGE as u16,
        contracts::WebMessageType::ForumPost => buzz_core::kind::KIND_FORUM_POST as u16,
        contracts::WebMessageType::ForumComment => buzz_core::kind::KIND_FORUM_COMMENT as u16,
    }
}

/// roster 的两个层级。Tenant 成员投影到 relay roster，Workspace 成员投影到
/// 所属 Channel 的 roster（`DD-45`）。
#[derive(Debug, Clone, Copy)]
pub enum Scope<'a> {
    Relay,
    Channel(&'a str),
}

/// 收敛目标。`converge` 只认这两个终态，没有「尽力而为」。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Presence {
    Present,
    Absent,
}

/// roster 快照里的一行。角色原样保留，不映射成平台角色——平台角色的权威
/// 在 Core，这里只是执行投影的核对依据。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RosterEntry {
    pub pubkey: String,
    pub role: String,
}

/// 一次发送的确定结果（见 [`IdentityClient::deliver`]）。
#[derive(Debug)]
pub enum Delivery {
    Accepted,
    /// Relay 明确拒绝。原因是 Relay 的原话，只进日志不进审计与响应体
    Rejected(String),
    /// 可能已送达也可能没有
    Unknown(String),
    /// Relay 以 `LIMIT` 类原因（429 限流、413 超大）拒绝，且在读取事件之前——
    /// 确定没有落库，可按策略用同一个幂等键重发（`apps/06` §4）。
    Limited(LimitKind, String),
}

/// 已从 Core 预算中取得一次额度的证明。
///
/// 发布要在写 DISPATCH 审计**之前**取额度：取不到就既不落账也不发送。把额度证明
/// 作为 `deliver` 的参数，编译期就保证了发布不会绕过预算。
#[derive(Debug)]
pub struct Admitted(());

/// 密钥托管方。只有 `Server` 才可能由 Core 代签（`DD-75`）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Custody {
    Server,
    Client,
}

/// 一个 Principal 的 Buzz 协议身份。
pub struct IdentityClient {
    keys: Keys,
    /// Relay 的网络地址，只用于建立连接。
    transport: Url,
    /// 该 Tenant 的 Community host。它同时是 Host 头与 NIP-98 签名里的权威：
    /// Relay 按 Host 绑定 Community，并以 `{scheme}://{host}{path}` 作为签名
    /// 期望 URL；网络地址不参与签名（SF-BUZ-32）。
    community_host: String,
    /// Core 自己的 Relay 调用预算（`apps/07` §5）。BFF 构造的客户端必带；
    /// 不带时（服务面与投影面的 CONTROL 客户端）行为不变。
    budget: Option<Arc<ApiBudget>>,
}

/// 手写而不是派生：派生会把私钥打进任何 `{:?}` 的输出。
impl std::fmt::Debug for IdentityClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IdentityClient")
            .field("pubkey", &self.keys.public_key().to_hex())
            .field("transport", &self.transport.as_str())
            .field("community_host", &self.community_host)
            .finish_non_exhaustive()
    }
}

impl IdentityClient {
    /// `custody` 必须是 `Server`。`Client` 托管的身份由原生端自己持钥并直连
    /// Relay，Core 手里没有那把钥匙——在这里尝试代签意味着实现走错了路径，
    /// 必须当场失败而不是用别的身份凑合（`DD-75`、`00-实施总纲.md` §3.4）。
    pub fn new(
        custody: Custody,
        secret_hex: &str,
        transport_url: &str,
        community_host: &str,
    ) -> Result<Self, OperatorError> {
        if custody != Custody::Server {
            return Err(OperatorError::CustodyNotServer);
        }
        let keys = Keys::parse(secret_hex).map_err(|_| OperatorError::InvalidKey)?;
        Ok(Self {
            keys,
            transport: Url::parse(transport_url)?,
            community_host: community_host.to_owned(),
            budget: None,
        })
    }

    /// 让这个客户端的每次 HTTP bridge 调用先经过 Core 预算。
    pub fn with_budget(mut self, budget: Arc<ApiBudget>) -> Self {
        self.budget = Some(budget);
        self
    }

    /// 取一次额度。没有挂预算时总是成功。
    pub fn admit(&self) -> Result<Admitted, OperatorError> {
        if let Some(b) = &self.budget {
            b.try_acquire(&self.community_host, &self.pubkey_hex())?;
        }
        Ok(Admitted(()))
    }

    pub fn pubkey_hex(&self) -> String {
        self.keys.public_key().to_hex()
    }

    /// 以该身份建立 id 为 `channel_id` 的 Channel（NIP-29 kind 9007 带 `h`）。
    ///
    /// 一个 Workspace 绑定一个 Channel（`DD-01`）。创建者成为该 Channel 的
    /// owner（`SF-BUZ-05`），而平台的 Community 只接受 owner 建 Channel
    /// （`DD-80`），因此调用方必须是该 Tenant 的 CONTROL 身份。
    ///
    /// id 由调用方给出，重发同一个 id 由 Relay 判为已存在而不另建（`SF-BUZ-38`
    /// 所在的 9007 校验）。于是结果不明后的重试不会造出第二个 Channel；但
    /// 「已存在」不证明是自己建的——调用方须回读自己的所属列表确认。
    /// Channel 以 private 建立：读写都只按 roster 判定（`DD-80`）。
    pub async fn ensure_channel(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
        name: &str,
        metadata: Option<&contracts::WorkspaceChannelCreate>,
    ) -> Result<(), OperatorError> {
        let tag = |k: &str, v: &str| vec![k.to_owned(), v.to_owned()];
        let mut tags = vec![
            tag("h", channel_id),
            tag("name", name),
            tag("visibility", "private"),
        ];
        if let Some(metadata) = metadata {
            let kind = serde_json::to_value(&metadata.channel_type)
                .map_err(|e| OperatorError::Sign(e.to_string()))?;
            let kind = kind.as_str().ok_or_else(|| {
                OperatorError::NotConverged("Channel type is not a string".into())
            })?;
            tags.push(tag("channel_type", kind));
            if let Some(description) = metadata.description.as_deref() {
                tags.push(tag("about", description));
            }
            if let Some(ttl) = metadata.ttl_seconds {
                // Original Buzz kind:9007 consumes `ttl`; the Relay owns
                // activity renewal and automatic archival, not Core/Temporal.
                if ttl <= 0 || ttl > i64::from(i32::MAX) {
                    return Err(OperatorError::Sign("Invalid channel TTL".into()));
                }
                tags.push(tag("ttl", &ttl.to_string()));
            }
        }
        let accepted = self.publish(http, KIND_CHANNEL_CREATE, "", &tags).await?;
        let duplicate = accepted.get("accepted").and_then(|v| v.as_bool()) == Some(false)
            && accepted
                .get("message")
                .and_then(|v| v.as_str())
                .is_some_and(|m| m.starts_with("duplicate: channel already exists"));
        if !duplicate {
            Self::accepted_event_id(&accepted)?;
        }
        // Duplicate only proves the identifier exists. Read the signed native metadata;
        // stale discovery remains retryable, never materializes a successful binding.
        let Some(event) = self.channel_metadata(http, channel_id).await? else {
            return Err(OperatorError::NotConverged(
                "Channel metadata missing".into(),
            ));
        };
        let one = |key: &str| -> Result<Option<String>, OperatorError> {
            let mut values = event
                .tags
                .iter()
                .filter(|t| t.as_slice().first().is_some_and(|v| v == key));
            let value = values.next();
            if values.next().is_some() || value.is_some_and(|v| v.as_slice().len() != 2) {
                return Err(OperatorError::NotConverged(
                    "Channel metadata tag malformed".into(),
                ));
            }
            Ok(value.map(|v| v.as_slice()[1].clone()))
        };
        let expected_kind = metadata
            .map(|m| serde_json::to_value(&m.channel_type))
            .transpose()
            .map_err(|e| OperatorError::Sign(e.to_string()))?
            .unwrap_or_else(|| Value::String("stream".into()));
        let description = metadata
            .and_then(|m| m.description.as_deref())
            .unwrap_or("");
        if one("name")?.as_deref() != Some(buzz_core::channel::canonical_channel_name(name))
            || one("t")?.as_deref() != expected_kind.as_str()
            || one("about")?.as_deref().unwrap_or("") != description
            || one("ttl")?.as_deref()
                != metadata
                    .and_then(|m| m.ttl_seconds)
                    .map(|ttl| ttl.to_string())
                    .as_deref()
            || event
                .tags
                .iter()
                .filter(|t| t.as_slice() == ["private"])
                .count()
                != 1
            || event
                .tags
                .iter()
                .any(|t| t.as_slice().first().is_some_and(|v| v == "public"))
            || one("archived")?.is_some_and(|v| v != "false")
        {
            return Err(OperatorError::NotConverged(
                "Channel metadata does not match creation intent".into(),
            ));
        }
        Ok(())
    }

    /// 以该身份发布一条频道消息，返回 Relay 接受后的 event id。
    ///
    /// event id 是 operation outcome 与 audit evidence（`.design/09` 第 6 步），
    /// 因此必须从 Relay 的响应里取，不能用本地算出的值——本地算得出不等于
    /// Relay 接受了它。
    ///
    /// `media_tags` 是 NIP-92 `imeta` 标签，每个是完整的一行（首元素为
    /// `"imeta"`）。这里不校验它们：Relay 按自己存的 sidecar 核对 hash、MIME
    /// 与大小（`verify_imeta_blobs`），那才是权威；这里再做一遍只会与之漂移。
    pub async fn publish_channel_message(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
        content: &str,
        media_tags: &[Vec<String>],
    ) -> Result<String, OperatorError> {
        let event = self.sign_channel_message(channel_id, content, media_tags)?;
        let accepted = self.send(http, &event).await?;
        Self::accepted_event_id(&accepted)
    }

    /// 以该身份签一条频道消息，不发送。
    ///
    /// event id 是签名内容的摘要，签完就确定。先拿到它再发送，调用方才能在
    /// 发出之前把「要发的是哪一条」落账——结果不明时，这个 id 是唯一能去 Relay
    /// 查证的键（`DD-48` 的幂等键与查询接缝）。
    pub fn sign_channel_message(
        &self,
        channel_id: &str,
        content: &str,
        media_tags: &[Vec<String>],
    ) -> Result<Event, OperatorError> {
        self.sign_channel_message_mentions(channel_id, content, media_tags, &[])
    }

    /// Root message mentions are exact public keys resolved by the governed caller.
    /// No thread reference is fabricated for a top-level Channel message.
    pub fn sign_channel_message_mentions(
        &self,
        channel_id: &str,
        content: &str,
        media_tags: &[Vec<String>],
        mention_pubkeys: &[String],
    ) -> Result<Event, OperatorError> {
        self.sign_channel_message_kind(
            channel_id,
            content,
            media_tags,
            mention_pubkeys,
            &contracts::WebMessageType::Stream,
            None,
        )
    }

    /// The original Buzz message kinds and NIP-10 tags; ancestry is resolved
    /// by the admitted caller, never supplied as arbitrary browser tags.
    pub fn sign_channel_message_kind(
        &self,
        channel_id: &str,
        content: &str,
        media_tags: &[Vec<String>],
        mention_pubkeys: &[String],
        message_type: &contracts::WebMessageType,
        ancestry: Option<(&str, &str)>,
    ) -> Result<Event, OperatorError> {
        if matches!(message_type, contracts::WebMessageType::ForumPost) && ancestry.is_some()
            || matches!(message_type, contracts::WebMessageType::ForumComment) && ancestry.is_none()
        {
            return Err(OperatorError::Sign(
                "Message ancestry does not match its type".into(),
            ));
        }
        let mut tags = vec![vec!["h".to_owned(), channel_id.to_owned()]];
        if let Some((root, parent)) = ancestry {
            let root = nostr::EventId::from_hex(root)
                .map_err(|_| OperatorError::Sign("Invalid thread root".into()))?
                .to_hex();
            let parent = nostr::EventId::from_hex(parent)
                .map_err(|_| OperatorError::Sign("Invalid thread parent".into()))?
                .to_hex();
            if root != parent {
                tags.push(vec!["e".into(), root, String::new(), "root".into()]);
            }
            tags.push(vec!["e".into(), parent, String::new(), "reply".into()]);
        }
        tags.extend(media_tags.iter().cloned());
        for pubkey in mention_pubkeys {
            let key = nostr::PublicKey::from_hex(pubkey)
                .map_err(|_| OperatorError::Sign("Mention public key is invalid".into()))?;
            tags.push(vec!["p".to_owned(), key.to_hex()]);
        }
        self.sign(message_kind(message_type), content, &tags)
    }

    /// Buzz 779af8886caae1317b4de962082429867ab61503,
    /// desktop/src-tauri/src/events.rs::build_message_edit. The original
    /// immutable message supplies scope and target; only newly added mentions
    /// notify. Existing identity/emoji references are not erased by a client
    /// that did not replace that optional snapshot.
    pub fn sign_message_edit(
        &self,
        target: &Event,
        content: &str,
        media_tags: &[Vec<String>],
        mention_pubkeys: &[String],
    ) -> Result<Event, OperatorError> {
        if target.verify().is_err()
            || target.pubkey != self.keys.public_key()
            || !matches!(target.kind.as_u16(), 9 | 45001 | 45003)
            || content.trim().is_empty() && media_tags.is_empty()
        {
            return Err(OperatorError::Sign(
                "Invalid message edit target or content".into(),
            ));
        }
        let channels: Vec<_> = target
            .tags
            .iter()
            .map(Tag::as_slice)
            .filter(|tag| tag.first().is_some_and(|key| key == "h"))
            .collect();
        let channel = match channels.as_slice() {
            [tag] if tag.len() == 2 => &tag[1],
            _ => return Err(OperatorError::Sign("Invalid message edit scope".into())),
        };
        let mut tags = vec![
            vec!["h".into(), channel.clone()],
            vec!["e".into(), target.id.to_hex()],
        ];
        tags.extend(media_tags.iter().cloned());
        for pubkey in mention_pubkeys {
            let key = nostr::PublicKey::from_hex(pubkey)
                .map_err(|_| OperatorError::Sign("Mention public key is invalid".into()))?
                .to_hex();
            if !target.tags.iter().any(|tag| {
                tag.as_slice().first().is_some_and(|name| name == "p")
                    && tag.as_slice().get(1) == Some(&key)
            }) {
                tags.push(vec!["p".into(), key]);
            }
        }
        self.sign(KIND_STREAM_MESSAGE_EDIT as u16, content, &tags)
    }

    /// 首次发布意图的固定创建时间与 NIP-10 引用决定唯一 Reply ID。
    /// 正文只留在调用请求内，Core 持久化该 ID 后才可以发送。
    pub fn sign_channel_reply_at(
        &self,
        channel_id: &str,
        content: &str,
        ancestry: (&str, &str),
        created_at: u64,
    ) -> Result<Event, OperatorError> {
        self.sign_channel_result_at(channel_id, content, Some(ancestry), None, created_at)
    }

    /// 同一原生 kind:9 builder；Schedule 结果没有虚构 NIP-10 ancestry。
    pub fn sign_channel_result_at(
        &self,
        channel_id: &str,
        content: &str,
        ancestry: Option<(&str, &str)>,
        invocation: Option<uuid::Uuid>,
        created_at: u64,
    ) -> Result<Event, OperatorError> {
        let mut tags = vec![vec!["h".to_owned(), channel_id.to_owned()]];
        if ancestry.is_some() == invocation.is_some() {
            return Err(OperatorError::Sign(
                "Result source reference is invalid".into(),
            ));
        }
        if let Some(invocation) = invocation {
            // 原生外部 reference tag，不是 Buzz Event/Thread ID。
            tags.push(vec!["r".to_owned(), format!("urn:uuid:{invocation}")]);
        }
        if let Some(ancestry) = ancestry {
            let root = nostr::EventId::from_hex(ancestry.0)
                .map_err(|_| OperatorError::Sign("Reply root is invalid".into()))?;
            let source = nostr::EventId::from_hex(ancestry.1)
                .map_err(|_| OperatorError::Sign("Reply source is invalid".into()))?;
            tags.extend([
                vec![
                    "e".to_owned(),
                    root.to_hex(),
                    String::new(),
                    "root".to_owned(),
                ],
                vec![
                    "e".to_owned(),
                    source.to_hex(),
                    String::new(),
                    "reply".to_owned(),
                ],
            ]);
        }
        let tags = tags
            .into_iter()
            .map(Tag::parse)
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| OperatorError::Sign("Reply tags are invalid".into()))?;
        EventBuilder::new(Kind::Custom(KIND_CHANNEL_MESSAGE), content)
            .tags(tags)
            .custom_created_at(nostr::Timestamp::from(created_at))
            .sign_with_keys(&self.keys)
            .map_err(|_| OperatorError::Sign("Reply signing failed".into()))
    }

    /// Original SDK kind:7 builder. Relay derives Channel from the real e target.
    pub fn sign_reaction_at(
        &self,
        target: &str,
        emoji: &str,
        created_at: u64,
    ) -> Result<Event, OperatorError> {
        if !valid_reaction(emoji) {
            return Err(OperatorError::Sign("Reaction content is invalid".into()));
        }
        let target = nostr::EventId::from_hex(target)
            .map_err(|_| OperatorError::Sign("Reaction source is invalid".into()))?;
        buzz_sdk::build_reaction(target, emoji)
            .map_err(|_| OperatorError::Sign("Reaction builder refused".into()))?
            .custom_created_at(nostr::Timestamp::from(created_at))
            .sign_with_keys(&self.keys)
            .map_err(|_| OperatorError::Sign("Reaction signing failed".into()))
    }

    /// Positive native proof only; missing or unreadable events never prove failure.
    pub async fn reaction_exists(
        &self,
        http: &reqwest::Client,
        event_id: &str,
        author: &str,
        source: &str,
        emoji: &str,
    ) -> Result<bool, OperatorError> {
        let page = self
            .query(http, &[serde_json::json!({"ids":[event_id]})])
            .await?;
        let events: Vec<Event> = serde_json::from_value(page)
            .map_err(|_| OperatorError::NotConverged("Reaction query is invalid".into()))?;
        let [event] = events.as_slice() else {
            return Ok(false);
        };
        Ok(reaction_matches(event, event_id, author, source, emoji))
    }

    /// 以该身份签名并发布一条事件，返回 Relay 的原始回应。
    ///
    /// 回应里 `accepted` 为 false 不是传输错误——那是 Relay 的判定，由调用方
    /// 按语义解读（例如 9007 的「已存在」）。每个标签是完整的一行。
    pub async fn publish(
        &self,
        http: &reqwest::Client,
        kind: u16,
        content: &str,
        tags: &[Vec<String>],
    ) -> Result<Value, OperatorError> {
        let event = self.sign(kind, content, tags)?;
        self.send(http, &event).await
    }

    pub fn sign(
        &self,
        kind: u16,
        content: &str,
        tags: &[Vec<String>],
    ) -> Result<Event, OperatorError> {
        let tags = tags
            .iter()
            .map(|t| Tag::parse(t).map_err(|e| OperatorError::Sign(format!("tag: {e}"))))
            .collect::<Result<Vec<_>, _>>()?;
        EventBuilder::new(Kind::Custom(kind), content)
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("sign: {e}")))
    }

    async fn send(&self, http: &reqwest::Client, event: &Event) -> Result<Value, OperatorError> {
        let admitted = self.admit()?;
        self.send_admitted(http, event, admitted).await
    }

    async fn send_admitted(
        &self,
        http: &reqwest::Client,
        event: &Event,
        _admitted: Admitted,
    ) -> Result<Value, OperatorError> {
        let payload = serde_json::to_vec(event).map_err(|e| OperatorError::Sign(e.to_string()))?;
        self.bridge_post_admitted(http, "/events", &payload).await
    }

    /// 发送一条已签好的事件，并把 Relay 的回应分成三种确定的结果。
    ///
    /// 同一条事件重发是幂等的：Relay 以「duplicate」回应，说明它已经存着这条——
    /// 那是已送达，不是拒绝。Relay 的 5xx 与传输失败是结果不明：事件可能已落库
    /// 也可能没有，只能按 event id 去查（`DD-81`）。429 与 413 在 Relay 读取事件前
    /// 返回，是确定未落库的 `LIMIT`，不并入「拒绝」（那会被当成不可重试的权限类）。
    pub async fn deliver(
        &self,
        http: &reqwest::Client,
        event: &Event,
        admitted: Admitted,
    ) -> Delivery {
        match self.send_admitted(http, event, admitted).await {
            Ok(v) => {
                // 固定原生 submit_event 回应 event_id/accepted/message。HTTP 成功、
                // 另一条事件的 ack 或损坏回应都不证明本次事件已送达。
                let (Some(event_id), Some(accepted), Some(message)) = (
                    v.get("event_id").and_then(Value::as_str),
                    v.get("accepted").and_then(Value::as_bool),
                    v.get("message").and_then(Value::as_str),
                ) else {
                    return Delivery::Unknown("Relay event acknowledgement is incomplete".into());
                };
                if event_id != event.id.to_hex() {
                    return Delivery::Unknown(
                        "Relay event acknowledgement ID does not match".into(),
                    );
                }
                if accepted || message.starts_with("duplicate:") {
                    Delivery::Accepted
                } else {
                    Delivery::Rejected(message.to_owned())
                }
            }
            Err(e) if e.limit().is_some() => {
                let kind = e.limit().expect("已判定为 LIMIT");
                Delivery::Limited(kind, e.to_string())
            }
            Err(OperatorError::Rejected { status, body }) if (400..500).contains(&status) => {
                Delivery::Rejected(format!("HTTP {status} {body}"))
            }
            Err(e) => Delivery::Unknown(e.to_string()),
        }
    }

    /// 按 event id 查 Relay 是否存着这条事件。只用于结果不明后的对账。
    pub async fn event_exists(
        &self,
        http: &reqwest::Client,
        event_id: &str,
    ) -> Result<bool, OperatorError> {
        let page = self
            .query(http, &[serde_json::json!({ "ids": [event_id] })])
            .await?;
        Ok(page
            .as_array()
            .into_iter()
            .flatten()
            .any(|e| e.get("id").and_then(|v| v.as_str()) == Some(event_id)))
    }

    /// 查证已经持久化的 Reply ID，不签名、不发布，也不把消息正文交给 Core。
    /// 作者、Channel 和 NIP-10 ancestry 必须都是调用方冻结的原始引用。
    pub async fn channel_reply_exists(
        &self,
        http: &reqwest::Client,
        event_id: &str,
        author: &str,
        channel_id: &str,
        ancestry: (&str, &str),
    ) -> Result<bool, OperatorError> {
        self.channel_result_exists(http, event_id, author, channel_id, Some(ancestry), None)
            .await
    }

    pub async fn channel_result_exists(
        &self,
        http: &reqwest::Client,
        event_id: &str,
        author: &str,
        channel_id: &str,
        ancestry: Option<(&str, &str)>,
        invocation: Option<uuid::Uuid>,
    ) -> Result<bool, OperatorError> {
        let page = self
            .query(http, &[serde_json::json!({ "ids": [event_id] })])
            .await?;
        let events: Vec<Event> = serde_json::from_value(page)
            .map_err(|_| OperatorError::NotConverged("Reply 查询不是有效的原生事件数组".into()))?;
        let mut events = events.into_iter();
        let Some(event) = events.next() else {
            return Ok(false);
        };
        if events.next().is_some()
            || event.id.to_hex() != event_id
            || event.pubkey.to_hex() != author
            || event.kind.as_u16() != KIND_CHANNEL_MESSAGE
            || event.verify().is_err()
        {
            return Err(OperatorError::NotConverged(
                "Reply 的数量、ID、作者、kind 或原生签名不符合冻结引用".into(),
            ));
        }
        let mut observed_channel = None;
        for tag in event.tags.iter() {
            let parts = tag.as_slice();
            if parts.first().map(String::as_str) == Some("h") {
                if observed_channel.is_some() || parts.len() != 2 {
                    return Err(OperatorError::NotConverged(
                        "Reply 的 Channel 标签损坏或重复".into(),
                    ));
                }
                observed_channel = parts.get(1);
            }
        }
        let expected_reference = invocation.map(|id| format!("urn:uuid:{id}"));
        let references: Vec<_> = event
            .tags
            .iter()
            .filter_map(|tag| {
                let row = tag.as_slice();
                (row.first().map(String::as_str) == Some("r")).then_some(row)
            })
            .collect();
        let reference_matches = match expected_reference.as_deref() {
            Some(reference) => {
                references.len() == 1 && references[0].len() == 2 && references[0][1] == reference
            }
            None => references.is_empty(),
        };
        let observed_ancestry = buzz_core::nip10::parse_thread_markers(&event.tags).resolve();
        if observed_channel.map(String::as_str) != Some(channel_id)
            || observed_ancestry
                .as_ref()
                .map(|(root, parent)| (root.as_str(), parent.as_str()))
                != ancestry
            || !reference_matches
            || ancestry.is_some() == invocation.is_some()
            || (ancestry.is_none()
                && event
                    .tags
                    .iter()
                    .any(|tag| tag.as_slice().first().map(String::as_str) == Some("e")))
        {
            return Err(OperatorError::NotConverged(
                "Reply 不属于冻结的 Channel、root 或 source event".into(),
            ));
        }
        Ok(true)
    }

    /// 读取 roster 快照。
    ///
    /// 这是 roster 唯一的读取面：上游没有暴露直接读 `relay_members` 或
    /// `channel_members` 的 REST endpoint，只有 relay 自签的可替换快照事件。
    /// 快照由 best-effort 路径发布（发布失败只 warn），因此它可能落后于表，
    /// 这正是 `converge` 把「读到旧值」当作未收敛而非失败的原因。
    pub async fn roster(
        &self,
        http: &reqwest::Client,
        scope: Scope<'_>,
    ) -> Result<Vec<RosterEntry>, OperatorError> {
        // 快照是可替换事件，同一 scope 只有一条当前版本。
        let (filter, tag_name) = match scope {
            // NIP-43 kind 13534：标签形如 ["member", pubkey, role]
            Scope::Relay => (
                serde_json::json!({ "kinds": [KIND_RELAY_MEMBERSHIP_LIST], "limit": 1 }),
                "member",
            ),
            // NIP-29 kind 39002：标签形如 ["p", pubkey, relay_url, role]，
            // ["d", channel_uuid] 标识所属 Channel
            Scope::Channel(id) => (
                serde_json::json!({ "kinds": [KIND_CHANNEL_MEMBERS], "#d": [id], "limit": 1 }),
                "p",
            ),
        };
        let page = self.query(http, &[filter]).await?;
        Ok(Self::roster_entries(&page, tag_name))
    }

    /// 把 `target_pubkey` 在该 scope 的 roster 上收敛到 `want`。
    ///
    /// 成功判据是**再次读到的 roster**，不是 Relay 是否接受了事件
    /// （`.design/09`：只发出 admin event 而未查证不得 active）。这一点不是
    /// 谨慎而已，上游两条路径都要求它：
    ///
    /// - 移除已不在 roster 的目标会返回错误（relay 面 `member not found`、
    ///   Channel 面 `DbError::MemberNotFound`），不是幂等成功。Activity 重试
    ///   或崩溃重放都会撞上它。
    /// - 加入已在 roster 的目标是静默 no-op，且**不覆盖**既有角色。
    ///
    /// 先读一次可以在已收敛时完全不发事件；发完再读一次则让「事件被拒绝」
    /// 与「目标状态已成立」这两件事分开判断。
    pub async fn converge(
        &self,
        http: &reqwest::Client,
        scope: Scope<'_>,
        target_pubkey: &str,
        want: Presence,
    ) -> Result<(), OperatorError> {
        let target = target_pubkey.to_ascii_lowercase();
        let satisfied = |roster: &[RosterEntry]| {
            let present = roster.iter().any(|e| e.pubkey == target);
            present == (want == Presence::Present)
        };

        if satisfied(&self.roster(http, scope).await?) {
            return Ok(());
        }

        // 拒绝本身是**有歧义**的，不能直接当失败：上游对「移除一个已不在
        // roster 的成员」返回 400，而那恰恰说明目标状态已经成立，只是快照还旧。
        // 想靠错误文本区分这两种拒绝就成了对上游措辞的隐式依赖，措辞一改就
        // 静默失效。因此这里只把传输/签名失败当确定失败，拒绝一律并入未收敛，
        // 把理由带进详情供人排查，由调用方的重试上界决定何时放弃。
        let rejection = match self.send_admin_event(http, scope, &target, want).await {
            Ok(()) => None,
            Err(e @ OperatorError::Rejected { .. }) => Some(e.to_string()),
            Err(e) => return Err(e),
        };

        let after = self.roster(http, scope).await?;
        if satisfied(&after) {
            return Ok(());
        }
        Err(OperatorError::NotConverged(format!(
            "{target} 在 {scope:?} 上未达到 {want:?}，当前 roster {} 人{}",
            after.len(),
            rejection
                .map(|r| format!("；上游拒绝：{r}"))
                .unwrap_or_default()
        )))
    }

    /// 发出一条 roster 管理事件。私有：调用方只应经 `converge` 使用，
    /// 否则就会得到一个「发出去了但没查证」的结果。
    async fn send_admin_event(
        &self,
        http: &reqwest::Client,
        scope: Scope<'_>,
        target_pubkey: &str,
        want: Presence,
    ) -> Result<(), OperatorError> {
        let tag = |k: &str, v: &str| vec![k.to_owned(), v.to_owned()];
        // 不带 role 标签：上游在缺该标签时按 member 处理（Channel 面则保留既有
        // 角色）。角色语义的权威在 Core，一期不投影 admin/owner。
        let (kind, tags) = match (scope, want) {
            (Scope::Relay, Presence::Present) => {
                (KIND_RELAY_ADMIN_ADD, vec![tag("p", target_pubkey)])
            }
            (Scope::Relay, Presence::Absent) => {
                (KIND_RELAY_ADMIN_REMOVE, vec![tag("p", target_pubkey)])
            }
            (Scope::Channel(id), Presence::Present) => (
                KIND_CHANNEL_ADD_USER,
                vec![tag("h", id), tag("p", target_pubkey)],
            ),
            (Scope::Channel(id), Presence::Absent) => (
                KIND_CHANNEL_REMOVE_USER,
                vec![tag("h", id), tag("p", target_pubkey)],
            ),
        };
        // relay-admin 事件另有 ±120 秒的 created_at 窗口作为重放守卫，
        // EventBuilder 用当前时间签名；Core 与 Relay 的时钟偏移超过该窗口
        // 会让全部 roster 投影失败，属于部署前提。
        let accepted = self.publish(http, kind, "", &tags).await?;
        Self::accepted_event_id(&accepted).map(|_| ())
    }

    /// 把 Channel 的可逆停用状态收敛到 `archived`（SF-BUZ-15：kind 9002 带
    /// `["archived", "true"|"false"]`，只有 Channel owner/admin 可发，CONTROL 是创建者）。
    ///
    /// 成功判据是回读的 kind 39000 discovery，不是 Relay 是否接受：已归档的 Channel
    /// 会拒绝再次归档，而状态副作用失败时事件仍可能被接受。因此先读、已是目标状态
    /// 即不再发送；发送后以回读结果为准，读不到目标状态交给调用方按结果不明重试。
    pub async fn converge_channel_archived(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
        archived: bool,
    ) -> Result<bool, OperatorError> {
        if self.channel_archived(http, channel_id).await? == Some(archived) {
            return Ok(true);
        }
        let tag = |k: &str, v: &str| vec![k.to_owned(), v.to_owned()];
        let value = if archived { "true" } else { "false" };
        let tags = [tag("h", channel_id), tag("archived", value)];
        self.publish(http, KIND_CHANNEL_EDIT_METADATA, "", &tags)
            .await?;
        Ok(self.channel_archived(http, channel_id).await? == Some(archived))
    }

    /// 从 kind 39000 discovery 读 Channel 是否已归档。读不到该 Channel 的 discovery
    /// 时返回 `None`：不存在与未归档不是一回事。损坏或不符合请求 scope 的证据报错，
    /// 不能将它解释为未归档；上游正常的未归档 discovery 省略 `archived` 标签。
    pub async fn channel_archived(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
    ) -> Result<Option<bool>, OperatorError> {
        let Some(event) = self.channel_metadata(http, channel_id).await? else {
            return Ok(None);
        };
        let mut archived = None;
        for tag in event.tags.iter() {
            let parts = tag.as_slice();
            if parts.first().map(String::as_str) == Some("archived") {
                if archived.is_some() || parts.len() != 2 {
                    return Err(OperatorError::NotConverged(
                        "Channel discovery 的 archived 标签损坏或重复".into(),
                    ));
                }
                archived = Some(match parts[1].as_str() {
                    "true" => true,
                    "false" => false,
                    _ => {
                        return Err(OperatorError::NotConverged(
                            "Channel discovery 的 archived 状态未知".into(),
                        ))
                    }
                });
            }
        }
        Ok(Some(archived.unwrap_or(false)))
    }

    pub async fn channel_metadata(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
    ) -> Result<Option<Event>, OperatorError> {
        let filter =
            serde_json::json!({ "kinds": [KIND_CHANNEL_METADATA], "#d": [channel_id], "limit": 1 });
        let page = self.query(http, &[filter]).await?;
        let events: Vec<Event> = serde_json::from_value(page).map_err(|_| {
            OperatorError::NotConverged("Channel discovery 回应不是有效事件数组".into())
        })?;
        let mut events = events.into_iter();
        let Some(event) = events.next() else {
            return Ok(None);
        };
        if events.next().is_some()
            || event.kind.as_u16() != KIND_CHANNEL_METADATA
            || event.verify().is_err()
        {
            return Err(OperatorError::NotConverged(
                "Channel discovery 的数量、kind 或事件签名不符合查询合同".into(),
            ));
        }
        let mut observed_channel = None;
        for tag in event.tags.iter() {
            let parts = tag.as_slice();
            if let Some("d") = parts.first().map(String::as_str) {
                if observed_channel.is_some() || parts.len() != 2 {
                    return Err(OperatorError::NotConverged(
                        "Channel discovery 的 d 标签损坏或重复".into(),
                    ));
                }
                observed_channel = parts.get(1);
            }
        }
        if observed_channel.map(String::as_str) != Some(channel_id) {
            return Err(OperatorError::NotConverged(
                "Channel discovery 不属于请求的 Channel".into(),
            ));
        }
        Ok(Some(event))
    }

    /// 以该身份查询历史。filter 由调用方给出，BFF 不接受 Browser 提交的
    /// 任意 filter（`.design/09` 第 2 步）。
    pub async fn query(
        &self,
        http: &reqwest::Client,
        filters: &[Value],
    ) -> Result<Value, OperatorError> {
        let payload =
            serde_json::to_vec(filters).map_err(|e| OperatorError::Sign(e.to_string()))?;
        self.bridge_post(http, "/query", &payload).await
    }

    /// 从快照事件里取出 roster。
    ///
    /// 两种快照的标签形状不同，但角色都在最后一位：relay 面是
    /// `["member", pubkey, role]`，Channel 面是 `["p", pubkey, relay_url, role]`。
    /// 因此按标签名筛选后取首尾，而不是按固定下标读角色。
    fn roster_entries(page: &Value, tag_name: &str) -> Vec<RosterEntry> {
        let mut out = Vec::new();
        for ev in page.as_array().into_iter().flatten() {
            for tag in ev
                .get("tags")
                .and_then(|v| v.as_array())
                .into_iter()
                .flatten()
            {
                let parts: Vec<&str> = tag
                    .as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str()).collect())
                    .unwrap_or_default();
                if parts.first() != Some(&tag_name) || parts.len() < 3 {
                    continue;
                }
                out.push(RosterEntry {
                    pubkey: parts[1].to_ascii_lowercase(),
                    role: parts[parts.len() - 1].to_owned(),
                });
            }
        }
        out
    }

    /// Relay 接受事件后回传 `{"accepted":true,"event_id":"..."}`。
    /// 只认它给的 id：本地算得出不等于 Relay 接受了它。
    fn accepted_event_id(accepted: &Value) -> Result<String, OperatorError> {
        if accepted.get("accepted").and_then(|v| v.as_bool()) != Some(true) {
            return Err(OperatorError::Sign(format!("Relay 未接受: {accepted}")));
        }
        accepted
            .get("event_id")
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .ok_or_else(|| OperatorError::Sign(format!("响应缺 event_id: {accepted}")))
    }

    async fn bridge_post(
        &self,
        http: &reqwest::Client,
        path: &str,
        payload: &[u8],
    ) -> Result<Value, OperatorError> {
        // `/events`、`/query`、`/count` 在 Relay 侧共用同一份每 pubkey 额度，
        // 因此每一次都先取 Core 的额度，取不到就不发
        self.admit()?;
        self.bridge_post_admitted(http, path, payload).await
    }

    async fn bridge_post_admitted(
        &self,
        http: &reqwest::Client,
        path: &str,
        payload: &[u8],
    ) -> Result<Value, OperatorError> {
        // 签名对 Community host，请求发往 Relay 的网络地址并显式带同一 Host 头。
        // 两者必须一致：Relay 用 Host 绑定 Community，又用它构造签名期望 URL。
        let signed_url = format!("http://{}{}", self.community_host, path);
        let url = self.transport.join(path)?;
        let header = self.nip98_header("POST", &signed_url, payload)?;
        let resp = http
            .post(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", header)
            .header("Content-Type", "application/json")
            .body(payload.to_vec())
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(OperatorError::Rejected {
                status: status.as_u16(),
                body: text.chars().take(200).collect(),
            });
        }
        serde_json::from_str(&text).map_err(|e| OperatorError::Sign(e.to_string()))
    }

    /// 与 operator 面同一形状：u / method / nonce 必给，带 body 再加 payload 摘要。
    fn nip98_header(&self, method: &str, url: &str, body: &[u8]) -> Result<String, OperatorError> {
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("NIP-98 tag: {e}")))
        };
        let nonce = uuid::Uuid::new_v4().to_string();
        let payload_hash = hex::encode(Sha256::digest(body));
        let tags = vec![
            tag(["u", url])?,
            tag(["method", method])?,
            tag(["nonce", &nonce])?,
            tag(["payload", &payload_hash])?,
        ];
        let event = EventBuilder::new(Kind::HttpAuth, "")
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("NIP-98 sign: {e}")))?;
        let json = serde_json::to_string(&event)
            .map_err(|e| OperatorError::Sign(format!("NIP-98 serialize: {e}")))?;
        Ok(format!(
            "Nostr {}",
            base64::engine::general_purpose::STANDARD.encode(json)
        ))
    }
}

/// Relay 接受上传后回传的媒体描述（Blossom BUD-02 的 blob descriptor）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaDescriptor {
    pub url: String,
    pub sha256: String,
    pub size: u64,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub mime_type: Option<String>,
}

impl IdentityClient {
    /// 以该身份上传一份媒体（Blossom kind 24242）。
    ///
    /// `DD-39` 把 Relay media 也划进 BFF：Browser 不持 signer，因此这份授权事件
    /// 只能由 Core 以 actor 身份签。
    pub async fn upload_media(
        &self,
        http: &reqwest::Client,
        bytes: Vec<u8>,
        mime_type: &str,
    ) -> Result<MediaDescriptor, OperatorError> {
        let sha256 = hex::encode(Sha256::digest(&bytes));
        // `x` 标签必须与 X-SHA-256 头一致：上游按头查 `x` 标签，对不上即拒。
        // 两处各算一次会在实现漂移时给出一个不区分成因的 400。
        let auth = self.blossom_auth("upload", "Upload file", Some(&sha256))?;
        let url = self.transport.join("/upload")?;
        let resp = http
            .put(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", auth)
            .header("Content-Type", mime_type)
            .header("X-SHA-256", &sha256)
            .body(bytes)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(OperatorError::Rejected {
                status: status.as_u16(),
                body: text.chars().take(200).collect(),
            });
        }
        serde_json::from_str(&text).map_err(|e| OperatorError::Sign(e.to_string()))
    }

    /// 以该身份取回一份媒体，返回字节与 content-type。
    pub async fn fetch_media(
        &self,
        http: &reqwest::Client,
        path: &str,
    ) -> Result<(Vec<u8>, String), OperatorError> {
        // 路径由调用方给出，但必须限定在 media 命名空间内——放开它等于把
        // Relay 的整个 HTTP 面变成一个可代签的代理。
        if !path.starts_with("/media/") || path.contains("..") {
            return Err(OperatorError::Sign(format!(
                "媒体路径不在允许范围内: {path}"
            )));
        }
        let auth = self.blossom_auth("get", "Get media", None)?;
        let url = self.transport.join(path)?;
        let resp = http
            .get(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", auth)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            return Err(OperatorError::Rejected {
                status: status.as_u16(),
                body: resp
                    .text()
                    .await
                    .unwrap_or_default()
                    .chars()
                    .take(200)
                    .collect(),
            });
        }
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("application/octet-stream")
            .to_owned();
        Ok((resp.bytes().await?.to_vec(), content_type))
    }

    /// 构造 Blossom 授权头。
    ///
    /// 编码用 base64url 无填充（BUD-11 规定的形式）。上游同时接受标准 base64
    /// 以兼容 nostr-tools，但兼容分支不是我们该依赖的东西。
    fn blossom_auth(
        &self,
        action: &str,
        content: &str,
        sha256: Option<&str>,
    ) -> Result<String, OperatorError> {
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("tag: {e}")))
        };
        // 过期时间是授权的上界。给死一个短窗口而不是让调用方指定：
        // 这份授权由 Core 代签，调用方没有理由决定它能用多久。
        let expiration = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| OperatorError::Sign(e.to_string()))?
            .as_secs()
            + BLOSSOM_AUTH_TTL_SECS)
            .to_string();
        let mut tags = vec![tag(["t", action])?];
        if let Some(x) = sha256 {
            tags.push(tag(["x", x])?);
        }
        tags.push(tag(["expiration", &expiration])?);
        tags.push(tag(["server", &self.community_host])?);

        let event = EventBuilder::new(Kind::Custom(KIND_BLOSSOM_AUTH), content)
            .tags(tags)
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("Blossom 签名失败: {e}")))?;
        let json = serde_json::to_string(&event).map_err(|e| OperatorError::Sign(e.to_string()))?;
        Ok(format!(
            "Nostr {}",
            base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json)
        ))
    }
}

/// Blossom 授权事件的 kind（BUD-01）。
const KIND_BLOSSOM_AUTH: u16 = 24242;
/// 授权有效期。短窗口：这份授权由 Core 代签，泄漏出去也只能用很短一段时间。
const BLOSSOM_AUTH_TTL_SECS: u64 = 600;

#[cfg(test)]
mod mention_tests {
    use super::*;

    #[test]
    fn reaction_receipt_requires_exact_source_emoji_author_and_signature() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://unused.invalid",
            "unused.platform.test",
        )
        .unwrap();
        let source = "a".repeat(64);
        let event = client.sign_reaction_at(&source, "👍", 105).unwrap();
        let id = event.id.to_hex();
        let author = keys.public_key().to_hex();
        assert!(reaction_matches(&event, &id, &author, &source, "👍"));
        assert!(!reaction_matches(
            &event,
            &id,
            &author,
            &"b".repeat(64),
            "👍"
        ));
        assert!(!reaction_matches(&event, &id, &author, &source, "👎"));
        assert!(!reaction_matches(
            &event,
            &id,
            &Keys::generate().public_key().to_hex(),
            &source,
            "👍"
        ));
        let mut forged = event.clone();
        forged.content = "👎".into();
        assert!(!reaction_matches(&forged, &id, &author, &source, "👎"));
    }

    #[test]
    fn edits_keep_original_scope_identity_and_notify_only_new_mentions() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.example",
            "relay.example",
        )
        .unwrap();
        let old_mention = Keys::generate().public_key().to_hex();
        let new_mention = Keys::generate().public_key().to_hex();
        let original = client
            .sign_channel_message_mentions(
                "channel",
                "before",
                &[],
                std::slice::from_ref(&old_mention),
            )
            .unwrap();
        let edited = client
            .sign_message_edit(&original, "after", &[], &[old_mention, new_mention.clone()])
            .unwrap();
        edited.verify().unwrap();
        assert_eq!(edited.kind.as_u16(), 40003);
        assert_eq!(edited.pubkey, original.pubkey);
        let tags: Vec<_> = edited
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert_eq!(
            tags,
            vec![
                vec!["h".into(), "channel".into()],
                vec!["e".into(), original.id.to_hex()],
                vec!["p".into(), new_mention]
            ]
        );
        let outsider = Keys::generate();
        let other = IdentityClient::new(
            Custody::Server,
            &outsider.secret_key().to_secret_hex(),
            "http://relay.example",
            "relay.example",
        )
        .unwrap();
        assert!(other
            .sign_message_edit(&original, "forged", &[], &[])
            .is_err());
        assert!(client.sign_message_edit(&original, "", &[], &[]).is_err());
        let unscoped = client.sign(9, "unscoped", &[]).unwrap();
        assert!(client
            .sign_message_edit(&unscoped, "changed", &[], &[])
            .is_err());
    }

    #[test]
    fn forum_signatures_keep_native_kind_and_nip10_ancestry() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.example",
            "relay.example",
        )
        .unwrap();
        let root = "a".repeat(64);
        let parent = "b".repeat(64);
        let media = vec![vec![
            "imeta".into(),
            "url https://relay.example/media/image.png".into(),
        ]];
        let mention = Keys::generate().public_key().to_hex();
        let post = client
            .sign_channel_message_kind(
                "channel",
                "post",
                &media,
                std::slice::from_ref(&mention),
                &contracts::WebMessageType::ForumPost,
                None,
            )
            .unwrap();
        post.verify().unwrap();
        assert_eq!(post.kind.as_u16(), buzz_core::kind::KIND_FORUM_POST as u16);
        assert_eq!(post.pubkey, keys.public_key());
        assert!(parse_thread_markers(&post.tags).resolve().is_none());
        let tags: Vec<_> = post
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert_eq!(
            tags,
            vec![
                vec!["h".into(), "channel".into()],
                media[0].clone(),
                vec!["p".into(), mention]
            ]
        );
        for (reply_to, expected_tags) in [(&root, 2), (&parent, 3)] {
            let reply = client
                .sign_channel_message_kind(
                    "channel",
                    "reply",
                    &[],
                    &[],
                    &contracts::WebMessageType::ForumComment,
                    Some((&root, reply_to)),
                )
                .unwrap();
            reply.verify().unwrap();
            assert_eq!(
                reply.kind.as_u16(),
                buzz_core::kind::KIND_FORUM_COMMENT as u16
            );
            assert_eq!(reply.tags.len(), expected_tags);
            assert_eq!(
                parse_thread_markers(&reply.tags).resolve(),
                Some((root.clone(), reply_to.clone()))
            );
        }
        let stream_reply = client
            .sign_channel_message_kind(
                "channel",
                "reply",
                &[],
                &[],
                &contracts::WebMessageType::Stream,
                Some((&root, &parent)),
            )
            .unwrap();
        stream_reply.verify().unwrap();
        assert_eq!(
            stream_reply.kind.as_u16(),
            buzz_core::kind::KIND_STREAM_MESSAGE as u16
        );
        assert_eq!(
            parse_thread_markers(&stream_reply.tags).resolve(),
            Some((root.clone(), parent))
        );
    }

    #[test]
    fn forum_signing_rejects_wrong_or_invalid_ancestry() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.example",
            "relay.example",
        )
        .unwrap();
        let id = "a".repeat(64);
        assert!(client
            .sign_channel_message_kind(
                "channel",
                "post",
                &[],
                &[],
                &contracts::WebMessageType::ForumPost,
                Some((&id, &id))
            )
            .is_err());
        assert!(client
            .sign_channel_message_kind(
                "channel",
                "comment",
                &[],
                &[],
                &contracts::WebMessageType::ForumComment,
                None
            )
            .is_err());
        for ancestry in [("not-an-id", id.as_str()), (id.as_str(), "not-an-id")] {
            assert!(client
                .sign_channel_message_kind(
                    "channel",
                    "comment",
                    &[],
                    &[],
                    &contracts::WebMessageType::ForumComment,
                    Some(ancestry)
                )
                .is_err());
        }
    }

    #[test]
    fn root_mention_signs_exact_p_and_keeps_media_without_thread() {
        let keys = Keys::generate();
        let agent = Keys::generate().public_key().to_hex();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.example",
            "relay.example",
        )
        .unwrap();
        let media = vec![vec![
            "imeta".into(),
            "url https://relay.example/media/image.png".into(),
        ]];
        let event = client
            .sign_channel_message_mentions("channel", "hello", &media, std::slice::from_ref(&agent))
            .unwrap();
        event.verify().unwrap();
        let tags: Vec<_> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert_eq!(event.kind, Kind::Custom(9));
        assert_eq!(event.pubkey, keys.public_key());
        assert_eq!(
            tags,
            vec![
                vec!["h".to_owned(), "channel".into()],
                media[0].clone(),
                vec!["p".into(), agent]
            ]
        );
        assert!(!tags.iter().any(|tag| tag[0] == "e"));
        let ordinary = client
            .sign_channel_message("channel", "ordinary", &[])
            .unwrap();
        assert_eq!(ordinary.tags.len(), 1);
        assert!(client
            .sign_channel_message_mentions("channel", "hello", &[], &["invalid".into()])
            .is_err());
    }
}
