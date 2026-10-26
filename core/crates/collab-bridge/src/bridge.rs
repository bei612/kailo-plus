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
use uuid::Uuid;

use crate::limits::ApiBudget;
use crate::operator::{LimitKind, OperatorError};
pub use buzz_core::channel::canonical_channel_name;
pub use buzz_core::kind::{
    KIND_DELETION, KIND_EVENT_REMINDER, KIND_NIP29_DELETE_EVENT, KIND_REACTION,
    KIND_STREAM_MESSAGE_DIFF, KIND_STREAM_MESSAGE_EDIT, KIND_STREAM_MESSAGE_V2,
    KIND_SYSTEM_MESSAGE, KIND_THREAD_SUMMARY, KIND_TYPING_INDICATOR, KIND_WINDOW_BOUNDS,
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
const KIND_CHANNEL_DELETE: u16 = 9008;
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
        // The persisted dispatch event ID and verified signature freeze the
        // expanded bytes. Never reload mutable source content on reconciliation.
        && valid_reaction(&event.content)
        && (emoji.contains("{{") || event.content == emoji)
        && event.tags.len() == 1
        && event
            .tags
            .iter()
            .next()
            .is_some_and(|tag| tag.as_slice() == ["e", source])
}

fn topic_matches(event: &Event, id: &str, author: &str, channel: Uuid, topic: &str) -> bool {
    event.id.to_hex() == id
        && event.pubkey.to_hex() == author
        && event.verify().is_ok()
        && buzz_core::channel::topic_change(event).is_some_and(|(actual_channel, actual_topic)| {
            // Event ID covers content as well as tags; the original template
            // itself is not the expanded value. Empty topics still clear it.
            actual_channel == channel && (topic.contains("{{") || actual_topic == topic)
        })
}

pub fn message_kind(message_type: &contracts::WebMessageType) -> u16 {
    match message_type {
        contracts::WebMessageType::Stream => buzz_core::kind::KIND_STREAM_MESSAGE as u16,
        contracts::WebMessageType::ForumPost => buzz_core::kind::KIND_FORUM_POST as u16,
        contracts::WebMessageType::ForumComment => buzz_core::kind::KIND_FORUM_COMMENT as u16,
    }
}

/// The already-admitted native channel rows. Reading these does not enable
/// Buzz's separate workflow executors or any new write kind. DD-125(3): the
/// original 48100 Huddle card is a visible, non-conversational row; its
/// lifecycle (48101-48103) is read through the verified Huddle lifecycle API.
pub const CHANNEL_TIMELINE_KINDS: [u32; 5] = [
    buzz_core::kind::KIND_STREAM_MESSAGE,
    KIND_STREAM_MESSAGE_V2,
    KIND_STREAM_MESSAGE_DIFF,
    KIND_SYSTEM_MESSAGE,
    buzz_core::kind::KIND_HUDDLE_STARTED,
];

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

/// [`IdentityClient::ensure_huddle_channel`] 的确定结论。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HuddleProjection {
    /// 回读的 discovery 与投影意图一致
    Ready,
    /// Relay 明确不接受这条投影（原话只进日志）
    Rejected(String),
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

    /// 已过 Core 预算的 bridge 调用收到非 2xx 时的错误。挂了预算的客户端收到 Relay
    /// 自身的 `429` 时，带上该身份预算窗口推算的等待秒数（DD-156(3)），BFF 据此总给
    /// `Retry-After`；其余情况与原先一样是 `Rejected`。
    fn relay_rejected(&self, status: u16, body: String) -> OperatorError {
        match (&self.budget, status) {
            (Some(budget), 429) => OperatorError::RelayRateLimited {
                retry_after_secs: budget.retry_after_secs(&self.community_host, &self.pubkey_hex()),
                body,
            },
            _ => OperatorError::Rejected { status, body },
        }
    }

    /// Relay 按 Host 绑定 Community；不经本客户端发出的请求（git 子进程）须带同一 Host。
    pub fn community_host(&self) -> &str {
        &self.community_host
    }

    /// DD-118：Relay git smart HTTP 仓库根在网络地址上的位置，只用于建立连接；
    /// 签名与 Host 仍是 Community host（SF-BUZ-32）。
    pub fn git_remote_url(&self, repo_path: &str) -> Result<String, OperatorError> {
        Ok(self.transport.join(repo_path)?.to_string())
    }

    /// DD-118：git smart HTTP 的 NIP-98，与固定 Buzz `git-credential-nostr` 同形
    /// （`u` + `method`）。`u` 是仓库根 `http://{community host}{repo_path}`：Relay 的
    /// `git_expected_url` 取请求路径在 `/info/refs`、`/git-upload-pack` 之前的部分接在
    /// tenant host 之后比对，scheme 与 bridge 调用同一规则。每次调用都重新签名——
    /// 令牌只有 ±60s 窗口，不跨 git 调用复用；私钥不离开本进程。
    pub fn git_authorization(&self, repo_path: &str) -> Result<String, OperatorError> {
        let url = format!("http://{}{}", self.community_host, repo_path);
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("NIP-98 tag: {e}")))
        };
        self.http_auth_header(vec![tag(["u", url.as_str()])?, tag(["method", "GET"])?])
    }

    /// DD-118 读取的前置：以本人身份取一次 `info/refs`（upload-pack），授权只由 Relay
    /// 判定。只看状态码，不读 ref 广告正文；非 2xx 原样作为 `Rejected` 交给调用方。
    pub async fn git_info_refs(
        &self,
        http: &reqwest::Client,
        repo_path: &str,
    ) -> Result<(), OperatorError> {
        let path = format!("{repo_path}/info/refs?service=git-upload-pack");
        let url = self.transport.join(&path)?;
        let resp = http
            .get(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", self.git_authorization(repo_path)?)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(OperatorError::Rejected {
                status: status.as_u16(),
                body: text.chars().take(200).collect(),
            });
        }
        Ok(())
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

    /// DD-125(3)：以 Tenant CONTROL 投影 `creator` 的 Huddle 临时频道（带 `creator` 的
    /// 9007，private、stream、`ttl=3600`，SS-BUZ-GOVERNANCE）。Channel UUID 由 Core 预分配，
    /// 同一 id 重发由 Relay 判为已存在而不另建；成功判据是回读的 39000 discovery 与创建
    /// 意图一致。Relay 明确不接受（不是“已存在”）即 [`HuddleProjection::Rejected`]，传输
    /// 失败与回读不一致是结果不明，由调用方按 Channel UUID 对账。
    pub async fn ensure_huddle_channel(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
        name: &str,
        creator: &str,
    ) -> Result<HuddleProjection, OperatorError> {
        let tags = crate::huddle::huddle_channel_tags(channel_id, name, creator);
        // The HTTP bridge answers an ingest rejection with 400 (`api/bridge.rs::submit_event`);
        // 429/413 are LIMIT and were never read, so they stay retryable.
        let accepted = match self.publish(http, KIND_CHANNEL_CREATE, "", &tags).await {
            Ok(accepted) => accepted,
            Err(OperatorError::Rejected { status, body })
                if (400..500).contains(&status) && status != 429 && status != 413 =>
            {
                return Ok(HuddleProjection::Rejected(body));
            }
            Err(e) => return Err(e),
        };
        let refused = accepted.get("accepted").and_then(Value::as_bool) == Some(false);
        let message = accepted
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if refused && !message.starts_with("duplicate: channel already exists") {
            return Ok(HuddleProjection::Rejected(
                message.chars().take(200).collect(),
            ));
        }
        if !refused {
            Self::accepted_event_id(&accepted)?;
        }
        let Some(event) = self.channel_metadata(http, channel_id).await? else {
            return Err(OperatorError::NotConverged(
                "Huddle channel metadata missing".into(),
            ));
        };
        let one = |key: &str| -> Option<String> {
            let mut values = event
                .tags
                .iter()
                .filter(|t| t.as_slice().first().is_some_and(|v| v == key));
            let value = values.next()?;
            (values.next().is_none() && value.as_slice().len() == 2)
                .then(|| value.as_slice()[1].clone())
        };
        let ttl = crate::huddle::HUDDLE_TTL_SECONDS.to_string();
        let private = event
            .tags
            .iter()
            .filter(|t| t.as_slice() == ["private"])
            .count()
            == 1;
        if one("name").as_deref() != Some(buzz_core::channel::canonical_channel_name(name))
            || one("t").as_deref() != Some("stream")
            || one("ttl").as_deref() != Some(ttl.as_str())
            || !private
            || one("archived").is_some_and(|v| v != "false")
        {
            return Err(OperatorError::NotConverged(
                "Huddle channel metadata does not match the projection".into(),
            ));
        }
        Ok(HuddleProjection::Ready)
    }

    /// 原音频连接的 JSON 挑战认证：以本身份签 kind 22242，`relay` 为 Community host 上的
    /// `ws://` 地址（与 NIP-42 订阅连接同一规则，Relay 按 Host 绑定 Community），
    /// `challenge` 为 Relay 下发值（`audio/handler.rs::AuthMsg`、`buzz-auth::nip42`）。
    pub fn sign_relay_auth(&self, challenge: &str) -> Result<Event, OperatorError> {
        let relay_url =
            nostr::RelayUrl::parse(&format!("ws://{}", self.community_host)).map_err(|e| {
                OperatorError::Sign(format!("Community host 不可解析为 relay URL: {e}"))
            })?;
        EventBuilder::auth(challenge, relay_url)
            .sign_with_keys(&self.keys)
            .map_err(|e| OperatorError::Sign(format!("AUTH 签名失败: {e}")))
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
        self.sign_channel_message_references(
            channel_id,
            content,
            media_tags,
            mention_pubkeys,
            &[],
            message_type,
            ancestry,
        )
    }

    /// DD-125(8), original "Do nothing / Send anyway" for people outside the channel:
    /// each `reference_pubkeys` entry becomes one original `["mention", <pubkey>]`
    /// display reference after the notifying `p` tags. It never also appears as `p`,
    /// so it does not notify, enter an Inbox or grant anything; the governed caller
    /// has already resolved every key to an ACTIVE HUMAN of the same Tenant.
    #[allow(clippy::too_many_arguments)]
    pub fn sign_channel_message_references(
        &self,
        channel_id: &str,
        content: &str,
        media_tags: &[Vec<String>],
        mention_pubkeys: &[String],
        reference_pubkeys: &[String],
        message_type: &contracts::WebMessageType,
        ancestry: Option<(&str, &str)>,
    ) -> Result<Event, OperatorError> {
        self.sign_channel_message_addressed(
            channel_id,
            content,
            media_tags,
            mention_pubkeys,
            reference_pubkeys,
            &[],
            message_type,
            ancestry,
        )
    }

    /// DD-148, Buzz 779af8886caae1317b4de962082429867ab61503
    /// desktop/src/features/messages/lib/agentAddressMention.mjs::buildAgentAddressMentionTags:
    /// the addressed Agents that this message actually notifies are annotated with
    /// `["mention", <pubkey>, "agent-address"]` beside their `p`; display metadata only.
    #[allow(clippy::too_many_arguments)]
    pub fn sign_channel_message_addressed(
        &self,
        channel_id: &str,
        content: &str,
        media_tags: &[Vec<String>],
        mention_pubkeys: &[String],
        reference_pubkeys: &[String],
        address_pubkeys: &[String],
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
        for pubkey in reference_pubkeys {
            let key = nostr::PublicKey::from_hex(pubkey)
                .map_err(|_| OperatorError::Sign("Reference mention public key is invalid".into()))?
                .to_hex();
            if tags
                .iter()
                .any(|tag| matches!(tag.as_slice(), [name, value] if name == "p" && *value == key))
            {
                return Err(OperatorError::Sign(
                    "Reference mention also notifies the same key".into(),
                ));
            }
            tags.push(vec!["mention".to_owned(), key]);
        }
        let mut addressed = std::collections::BTreeSet::new();
        for pubkey in address_pubkeys {
            let key = nostr::PublicKey::from_hex(pubkey)
                .map_err(|_| OperatorError::Sign("Agent address public key is invalid".into()))?
                .to_hex();
            if !tags
                .iter()
                .any(|tag| matches!(tag.as_slice(), [name, value] if name == "p" && *value == key))
            {
                return Err(OperatorError::Sign(
                    "Agent address does not name a notified mention".into(),
                ));
            }
            if addressed.insert(key.clone()) {
                tags.push(vec!["mention".to_owned(), key, "agent-address".to_owned()]);
            }
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
        if ancestry.is_some() == invocation.is_some() {
            return Err(OperatorError::Sign(
                "Result source reference is invalid".into(),
            ));
        }
        self.sign_channel_result_reference_at(channel_id, content, ancestry, invocation, created_at)
    }

    /// Same kind:9/NIP-10 builder, with the existing external reference tag
    /// identifying one immutable workflow step even for equal same-second text.
    pub fn sign_workflow_step_result_at(
        &self,
        channel_id: &str,
        content: &str,
        ancestry: Option<(&str, &str)>,
        step: uuid::Uuid,
        created_at: u64,
    ) -> Result<Event, OperatorError> {
        self.sign_channel_result_reference_at(channel_id, content, ancestry, Some(step), created_at)
    }

    fn sign_channel_result_reference_at(
        &self,
        channel_id: &str,
        content: &str,
        ancestry: Option<(&str, &str)>,
        invocation: Option<uuid::Uuid>,
        created_at: u64,
    ) -> Result<Event, OperatorError> {
        let mut tags = vec![vec!["h".to_owned(), channel_id.to_owned()]];
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

    /// Original native NIP-25/NIP-09 builders. The caller has already proved
    /// target scope/ownership; custom emoji tags come from the Relay palette.
    pub fn sign_message_reaction(
        &self,
        target: &str,
        content: &str,
        remove: bool,
        emoji_tags: &[Vec<String>],
    ) -> Result<Event, OperatorError> {
        let target = nostr::EventId::from_hex(target)
            .map_err(|_| OperatorError::Sign("Reaction source is invalid".into()))?;
        let builder = if remove && content.is_empty() && emoji_tags.is_empty() {
            buzz_sdk::build_remove_reaction(target)
        } else if !remove && valid_reaction(content) {
            match emoji_tags {
                [] => buzz_sdk::build_reaction(target, content),
                [tag]
                    if tag.len() == 3
                        && tag[0] == "emoji"
                        && content == format!(":{}:", tag[1]) =>
                {
                    buzz_sdk::build_custom_emoji_reaction(target, &tag[1], &tag[2])
                }
                _ => {
                    return Err(OperatorError::Sign(
                        "Reaction emoji evidence is invalid".into(),
                    ))
                }
            }
        } else {
            return Err(OperatorError::Sign("Reaction content is invalid".into()));
        };
        builder
            .map_err(|_| OperatorError::Sign("Reaction builder refused".into()))?
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

    /// Original SDK pure-topic command, signed by the acting installation.
    pub fn sign_channel_topic_at(
        &self,
        channel: Uuid,
        topic: &str,
        created_at: u64,
    ) -> Result<Event, OperatorError> {
        buzz_sdk::build_set_topic(channel, topic)
            .map_err(|_| OperatorError::Sign("Topic builder refused".into()))?
            .custom_created_at(nostr::Timestamp::from(created_at))
            .sign_with_keys(&self.keys)
            .map_err(|_| OperatorError::Sign("Topic signing failed".into()))
    }

    /// The governed Relay stores pure topic updates in the event transaction.
    /// A later topic change does not erase this operation's positive evidence.
    pub async fn channel_topic_exists(
        &self,
        http: &reqwest::Client,
        event_id: &str,
        author: &str,
        channel: Uuid,
        topic: &str,
    ) -> Result<bool, OperatorError> {
        let page = self
            .query(http, &[serde_json::json!({"ids":[event_id]})])
            .await?;
        let events: Vec<Event> = serde_json::from_value(page)
            .map_err(|_| OperatorError::NotConverged("Topic query is invalid".into()))?;
        let [event] = events.as_slice() else {
            return Ok(false);
        };
        Ok(topic_matches(event, event_id, author, channel, topic))
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

    /// Original project builders; no arbitrary kind/tags or caller-owned key.
    pub fn sign_project(
        &self,
        request: &contracts::ProjectsPublishRequest,
        target: Option<&Event>,
        channel_id: Option<&str>,
        latest_comment: Option<&Event>,
        media_tags: &[Vec<String>],
    ) -> Result<Event, OperatorError> {
        let kind = crate::projects::publication_kind(request)?;
        let builder = if crate::projects::PULL_REQUEST_STATUS_KINDS.contains(&kind) {
            // `latest_comment` carries the review's newest trusted lifecycle
            // event here; it is ordering evidence, never a signing authority.
            if channel_id.is_some() || !media_tags.is_empty() {
                return Err(OperatorError::Sign(
                    "review status fields are not supported".into(),
                ));
            }
            crate::projects::status_publication_builder(
                request,
                target.ok_or_else(|| OperatorError::Sign("review status target missing".into()))?,
                latest_comment,
                &self.pubkey_hex(),
            )?
        } else if kind == 1618 {
            // Original publishProjectPullRequest: Community-global, no comment
            // ordering evidence and no media.
            if channel_id.is_some() || latest_comment.is_some() || !media_tags.is_empty() {
                return Err(OperatorError::Sign(
                    "review creation fields are not supported".into(),
                ));
            }
            crate::projects::pull_request_publication_builder(
                request,
                target.ok_or_else(|| OperatorError::Sign("review repository missing".into()))?,
                &self.pubkey_hex(),
                &self.community_host,
            )?
        } else if kind == 1 {
            if channel_id.is_some() {
                return Err(OperatorError::Sign(
                    "comment channel is not supported".into(),
                ));
            }
            crate::projects::comment_publication_builder(
                request,
                target.ok_or_else(|| OperatorError::Sign("comment issue missing".into()))?,
                latest_comment,
                &self.pubkey_hex(),
                media_tags,
            )?
        } else {
            if latest_comment.is_some() || !media_tags.is_empty() {
                return Err(OperatorError::Sign(
                    "comment fields on another project operation".into(),
                ));
            }
            crate::projects::publication_builder(request, target, channel_id, &self.pubkey_hex())?
        };
        builder
            .sign_with_keys(&self.keys)
            .map_err(|error| OperatorError::Sign(error.to_string()))
    }

    /// DD-118 merge: the original 1631 of `pull_request`.
    ///
    /// Signed by this identity only when it owns the review's repository.
    /// `latest` is the review's newest trusted lifecycle event (ordering
    /// evidence only).
    pub fn sign_merged_status(
        &self,
        pull_request: &Event,
        latest: Option<&Event>,
        merge_commit: &str,
    ) -> Result<Event, OperatorError> {
        let builder = crate::projects::merged_status_publication_builder(
            pull_request,
            latest,
            &self.pubkey_hex(),
            merge_commit,
        )?;
        builder
            .sign_with_keys(&self.keys)
            .map_err(|error| OperatorError::Sign(error.to_string()))
    }

    /// Buzz 779af8886caae1317b4de962082429867ab61503 reminderService and
    /// commands/identity::{nip44_encrypt_to_self,nip44_decrypt_from_self}.
    /// Only a verified 30300 event owned by this SERVER identity is decrypted.
    pub fn decrypt_reminder(&self, event: &Event) -> Result<String, OperatorError> {
        if event.kind.as_u16() != buzz_core::kind::KIND_EVENT_REMINDER as u16
            || event.pubkey != self.keys.public_key()
            || event.verify().is_err()
        {
            return Err(OperatorError::NotConverged(
                "Reminder identity is invalid".into(),
            ));
        }
        nostr::nips::nip44::decrypt(
            self.keys.secret_key(),
            &self.keys.public_key(),
            &event.content,
        )
        .map_err(|_| OperatorError::NotConverged("Reminder decryption failed".into()))
    }

    pub fn sign_reminder(
        &self,
        content: &contracts::ReminderContent,
        tags: &[Vec<String>],
        created_at: u64,
    ) -> Result<Event, OperatorError> {
        let plaintext = serde_json::to_string(content)
            .map_err(|_| OperatorError::Sign("Invalid reminder content".into()))?;
        let ciphertext = nostr::nips::nip44::encrypt(
            self.keys.secret_key(),
            &self.keys.public_key(),
            plaintext,
            nostr::nips::nip44::Version::V2,
        )
        .map_err(|_| OperatorError::Sign("Reminder encryption failed".into()))?;
        let tags = tags
            .iter()
            .map(|tag| {
                Tag::parse(tag).map_err(|_| OperatorError::Sign("Invalid reminder tag".into()))
            })
            .collect::<Result<Vec<_>, _>>()?;
        EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_EVENT_REMINDER as u16),
            ciphertext,
        )
        .tags(tags)
        .custom_created_at(nostr::Timestamp::from(created_at))
        .sign_with_keys(&self.keys)
        .map_err(|_| OperatorError::Sign("Reminder signing failed".into()))
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
        let invalid = || OperatorError::NotConverged("Event existence evidence is invalid".into());
        let requested = nostr::EventId::from_hex(event_id).map_err(|_| invalid())?;
        if requested.to_hex() != event_id {
            return Err(invalid());
        }
        let page = self
            .query(http, &[serde_json::json!({ "ids": [event_id] })])
            .await?;
        let rows = page.as_array().ok_or_else(invalid)?;
        let row = match rows.as_slice() {
            [] => return Ok(false),
            [row] => row,
            _ => return Err(invalid()),
        };
        // Check the original wire ID as well: deserialization can normalize
        // hex, but this exact-ID query cannot accept a different spelling or
        // an unverified object's asserted ID as positive delivery evidence.
        if row.get("id").and_then(Value::as_str) != Some(event_id) {
            return Err(invalid());
        }
        let event: Event = serde_json::from_value(row.clone()).map_err(|_| invalid())?;
        if event.id != requested || event.verify().is_err() {
            return Err(invalid());
        }
        Ok(true)
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
        if ancestry.is_some() == invocation.is_some() {
            return Err(OperatorError::NotConverged(
                "Result source reference is invalid".into(),
            ));
        }
        self.channel_result_reference_exists(
            http, event_id, author, channel_id, ancestry, invocation,
        )
        .await
    }

    pub async fn workflow_step_result_exists(
        &self,
        http: &reqwest::Client,
        event_id: &str,
        author: &str,
        channel_id: &str,
        ancestry: Option<(&str, &str)>,
        step: uuid::Uuid,
    ) -> Result<bool, OperatorError> {
        self.channel_result_reference_exists(
            http,
            event_id,
            author,
            channel_id,
            ancestry,
            Some(step),
        )
        .await
    }

    async fn channel_result_reference_exists(
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
        self.converge_with_role(http, scope, target_pubkey, want, None)
            .await
    }

    /// [`converge`](Self::converge) with the original NIP-29 `role` tag on the add.
    /// DD-125(3): Agents join a Huddle temp channel as `role=bot` (original
    /// `events.rs::build_add_member` for `start_huddle`/`add_agent_to_huddle`). The
    /// role is only sent on a new add; an existing member keeps its role upstream.
    pub async fn converge_with_role(
        &self,
        http: &reqwest::Client,
        scope: Scope<'_>,
        target_pubkey: &str,
        want: Presence,
        role: Option<&str>,
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
        let rejection = match self
            .send_admin_event(http, scope, &target, want, role)
            .await
        {
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
        role: Option<&str>,
    ) -> Result<(), OperatorError> {
        let tag = |k: &str, v: &str| vec![k.to_owned(), v.to_owned()];
        // 缺省不带 role 标签：上游在缺该标签时按 member 处理（Channel 面则保留既有
        // 角色）。角色语义的权威在 Core，一期不投影 admin/owner；唯一的例外是 Huddle
        // 临时频道里 Agent 的原版 `role=bot`（DD-125(3)）。
        let (kind, mut tags) = match (scope, want) {
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
        if let (Scope::Channel(_), Presence::Present, Some(role)) = (scope, want, role) {
            tags.push(tag("role", role));
        }
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

    /// 签一条删除 Channel 的 kind 9008（DD-150(2)：只含 `h`，只限 Channel owner，CONTROL 是
    /// 创建者）。只签名不发送：调用方先落 DISPATCH 审计，再经 [`IdentityClient::deliver`] 投递，
    /// 判据是回读的 kind 39000 discovery 已不存在（Relay 软删除 Channel 并清理其 discovery）。
    /// 已归档的 Channel 拒绝除解档外的变更，调用方须先解档。
    pub fn sign_channel_delete(&self, channel_id: &str) -> Result<Event, OperatorError> {
        let tags = [vec!["h".to_owned(), channel_id.to_owned()]];
        self.sign(KIND_CHANNEL_DELETE, "", &tags)
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
            return Err(self.relay_rejected(status.as_u16(), text.chars().take(200).collect()));
        }
        serde_json::from_str(&text).map_err(|e| OperatorError::Sign(e.to_string()))
    }

    /// DD-125(2)：以本身份经 NIP-98 读取一个 GET 端点（Relay `/moderation/*`）。签名的 `u`
    /// 是 Community host 上的完整路径（含查询串，Relay 逐字比对），请求发往网络地址并带
    /// 同一 Host 头；GET 没有正文，因此只签 u / method / nonce。与 POST 共用 Core 预算。
    pub async fn bridge_get(
        &self,
        http: &reqwest::Client,
        path_and_query: &str,
    ) -> Result<Value, OperatorError> {
        self.admit()?;
        let signed_url = format!("http://{}{}", self.community_host, path_and_query);
        let url = self.transport.join(path_and_query)?;
        let tag = |parts: [&str; 2]| {
            Tag::parse(parts).map_err(|e| OperatorError::Sign(format!("NIP-98 tag: {e}")))
        };
        let nonce = uuid::Uuid::new_v4().to_string();
        let header = self.http_auth_header(vec![
            tag(["u", signed_url.as_str()])?,
            tag(["method", "GET"])?,
            tag(["nonce", nonce.as_str()])?,
        ])?;
        let resp = http
            .get(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", header)
            .send()
            .await?;
        let status = resp.status();
        let text = resp.text().await?;
        if !status.is_success() {
            return Err(self.relay_rejected(status.as_u16(), text.chars().take(200).collect()));
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
        self.http_auth_header(tags)
    }

    /// 以本身份签 NIP-98（kind 27235）并编码为 `Authorization` 头的值。
    fn http_auth_header(&self, tags: Vec<Tag>) -> Result<String, OperatorError> {
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

/// DD-119 `workspace.update` 冻结的 TTL 目标：设置秒数，或清除为长期频道（原 9002 的
/// 空 `ttl` 标签）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChannelTtl {
    Seconds(i64),
    Clear,
}

/// DD-119 `workspace.update` 冻结的 Channel 元数据目标状态。省略的字段保持不变；
/// `reopen` 只单独出现（由 Core 准入保证）。可见性不在此列：它只是 Core 事实，Relay
/// 投影始终 private，这里从不产生 `visibility` 标签。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ChannelMetadataTarget {
    pub name: Option<String>,
    pub about: Option<String>,
    pub ttl: Option<ChannelTtl>,
    pub reopen: bool,
}

impl ChannelMetadataTarget {
    /// 没有任何需要经 Relay 收敛的字段（例如只改可见性）。
    pub fn is_empty(&self) -> bool {
        self.name.is_none() && self.about.is_none() && self.ttl.is_none() && !self.reopen
    }
}

/// 从原 Relay 签名的 kind 39000 读出的 Channel 元数据。Relay 对空描述省略 `about`，
/// 因此缺省读作空串；缺 `ttl` 即长期频道；缺 `archived` 即未归档。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChannelMetadataState {
    pub name: String,
    pub about: String,
    pub ttl: Option<i64>,
    pub archived: bool,
}

/// [`IdentityClient::converge_channel_metadata`] 给出的下一步。
#[derive(Debug)]
pub enum ChannelMetadataStep {
    /// 回读已等于冻结的目标状态
    Converged(ChannelMetadataState),
    /// 需要签发的 CONTROL 9002：已签名、尚未发送。调用方先落 DISPATCH 再投递
    Send(Box<Event>),
    /// 目标状态的前置条件不成立，是确定的拒绝（原因只进日志）
    Refused(&'static str),
}

/// 解析 kind 39000 discovery 的元数据。重复或形状不对的标签是损坏的证据，不能被解释
/// 成「未设置」。
pub fn channel_metadata_state(event: &Event) -> Result<ChannelMetadataState, OperatorError> {
    let malformed = || OperatorError::NotConverged("Channel metadata tag malformed".into());
    let one = |key: &str| -> Result<Option<String>, OperatorError> {
        let mut values = event
            .tags
            .iter()
            .map(Tag::as_slice)
            .filter(|t| t.first().is_some_and(|v| v == key));
        let value = values.next();
        if values.next().is_some() || value.is_some_and(|v| v.len() != 2) {
            return Err(malformed());
        }
        Ok(value.map(|v| v[1].clone()))
    };
    let name = one("name")?.ok_or_else(malformed)?;
    let about = one("about")?.unwrap_or_default();
    let ttl = match one("ttl")? {
        Some(value) => {
            let seconds = value.parse::<i64>().ok().filter(|n| *n > 0);
            Some(seconds.ok_or_else(malformed)?)
        }
        None => None,
    };
    let archived = match one("archived")?.as_deref() {
        None | Some("false") => false,
        Some("true") => true,
        Some(_) => return Err(malformed()),
    };
    Ok(ChannelMetadataState {
        name,
        about,
        ttl,
        archived,
    })
}

/// 把回读状态推向目标状态所需的 9002 标签（DD-119(3)(6)、SF-BUZ-50）。
///
/// `Ok(None)` 表示已收敛；`Ok(Some(tags))` 是只含必要字段的一条编辑（首个标签是 `h`，
/// 清除 TTL 发空 `ttl`）；`Err` 是确定的前置条件失败。从不产生 `visibility`、`topic`
/// 或 `purpose` 标签。`reopen` 要求回读 `archived=true` 且设有 TTL；`reopen_dispatched`
/// 表示本动作此前已签发过解档命令，此时回读未归档就是解档已生效，而不是前置条件不成立。
pub fn plan_channel_metadata(
    channel_id: &str,
    target: &ChannelMetadataTarget,
    observed: &ChannelMetadataState,
    reopen_dispatched: bool,
) -> Result<Option<Vec<Vec<String>>>, &'static str> {
    let tag = |k: &str, v: &str| vec![k.to_owned(), v.to_owned()];
    if target.reopen {
        return match (observed.archived, observed.ttl) {
            (true, Some(_)) => Ok(Some(vec![tag("h", channel_id), tag("archived", "false")])),
            (true, None) => Err("archived channel has no TTL"),
            (false, _) if reopen_dispatched => Ok(None),
            (false, _) => Err("channel is not archived"),
        };
    }
    let mut tags = vec![tag("h", channel_id)];
    if let Some(name) = &target.name {
        if canonical_channel_name(name) != observed.name {
            tags.push(tag("name", name));
        }
    }
    if let Some(about) = &target.about {
        if *about != observed.about {
            tags.push(tag("about", about));
        }
    }
    match target.ttl {
        Some(ChannelTtl::Seconds(seconds)) if observed.ttl != Some(seconds) => {
            tags.push(tag("ttl", &seconds.to_string()));
        }
        Some(ChannelTtl::Clear) if observed.ttl.is_some() => tags.push(tag("ttl", "")),
        _ => {}
    }
    if tags.len() == 1 {
        return Ok(None);
    }
    // 已归档的 Channel 拒绝除解档以外的 9002；按 TTL 到期归档的先以 reopen 解档
    if observed.archived {
        return Err("channel is archived");
    }
    Ok(Some(tags))
}

impl IdentityClient {
    /// 把 Channel 的名称、描述、TTL 或归档状态向冻结的目标收敛一步（DD-119，模式同
    /// [`IdentityClient::converge_channel_archived`]：先读、已是目标即不发送）。
    ///
    /// 与归档收敛不同，这里只签名不发送：每次签发都要先由 Core 落 DISPATCH 审计，再经
    /// [`IdentityClient::deliver`] 投递并记结果，之后再调用本方法回读——判据是回读的
    /// kind 39000，不是 event ID。冻结参数即目标状态，每轮重签是幂等的。调用方必须是该
    /// Tenant 的 CONTROL（Channel owner）。
    pub async fn converge_channel_metadata(
        &self,
        http: &reqwest::Client,
        channel_id: &str,
        target: &ChannelMetadataTarget,
        reopen_dispatched: bool,
    ) -> Result<ChannelMetadataStep, OperatorError> {
        let Some(event) = self.channel_metadata(http, channel_id).await? else {
            return Err(OperatorError::NotConverged(
                "Channel metadata missing".into(),
            ));
        };
        let observed = channel_metadata_state(&event)?;
        match plan_channel_metadata(channel_id, target, &observed, reopen_dispatched) {
            Ok(None) => Ok(ChannelMetadataStep::Converged(observed)),
            Ok(Some(tags)) => {
                let edit = self.sign(KIND_CHANNEL_EDIT_METADATA, "", &tags)?;
                Ok(ChannelMetadataStep::Send(Box::new(edit)))
            }
            Err(reason) => Ok(ChannelMetadataStep::Refused(reason)),
        }
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
        max_bytes: u64,
    ) -> Result<MediaDescriptor, OperatorError> {
        let check_size = |size: usize| {
            if size as u64 > max_bytes {
                Err(OperatorError::Rejected {
                    status: 413,
                    body: "media exceeds configured byte limit".into(),
                })
            } else {
                Ok(())
            }
        };
        check_size(bytes.len())?;
        // Browser file pickers may send application/octet-stream. Infer the
        // actual container just as Native does; do not trust a supplied MIME
        // to bypass image preparation. Ordinary files and videos are unchanged.
        let detected_mime = infer::get(&bytes).map(|kind| kind.mime_type());
        let image_mime = detected_mime
            .filter(|mime| mime.starts_with("image/"))
            .or_else(|| mime_type.starts_with("image/").then_some(mime_type))
            .map(str::to_owned);
        let (bytes, upload_mime) = if let Some(image_mime) = image_mime {
            let prepared_mime = image_mime.clone();
            let bytes = tokio::task::spawn_blocking(move || {
                buzz_sdk::media::sanitize_image_for_upload(bytes, &image_mime)
            })
            .await
            .map_err(|_| OperatorError::InvalidMedia("image preparation interrupted".into()))?
            .map_err(OperatorError::InvalidMedia)?;
            (bytes, prepared_mime)
        } else {
            (bytes, mime_type.to_owned())
        };
        // Re-encoding can grow the payload. The same runtime ceiling applies
        // to what is actually sent, not just the original browser bytes.
        check_size(bytes.len())?;
        let size = bytes.len() as u64;
        let sha256 = hex::encode(Sha256::digest(&bytes));
        // `x` 标签必须与 X-SHA-256 头一致：上游按头查 `x` 标签，对不上即拒。
        // 两处各算一次会在实现漂移时给出一个不区分成因的 400。
        let auth = self.blossom_auth("upload", "Upload file", Some(&sha256))?;
        let url = self.transport.join("/upload")?;
        let resp = http
            .put(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", auth)
            .header("Content-Type", &upload_mime)
            .header("X-SHA-256", &sha256)
            .body(bytes)
            .send()
            .await
            .map_err(|_| OperatorError::MediaResultUnknown("upload response unavailable".into()))?;
        let status = resp.status();
        let text = resp.text().await.map_err(|_| {
            OperatorError::MediaResultUnknown("upload response body unavailable".into())
        })?;
        if !status.is_success() {
            if !status.is_client_error() {
                return Err(OperatorError::MediaResultUnknown(format!(
                    "upload returned HTTP {} without a terminal descriptor",
                    status.as_u16()
                )));
            }
            return Err(OperatorError::Rejected {
                status: status.as_u16(),
                body: text.chars().take(200).collect(),
            });
        }
        let descriptor: MediaDescriptor = serde_json::from_str(&text).map_err(|_| {
            OperatorError::MediaResultUnknown("upload descriptor is invalid".into())
        })?;
        if descriptor.sha256 != sha256
            || descriptor.size != size
            || (upload_mime.starts_with("image/")
                && descriptor.mime_type.as_deref() != Some(upload_mime.as_str()))
        {
            return Err(OperatorError::MediaResultUnknown(
                "upload descriptor does not match transmitted media".into(),
            ));
        }
        Ok(descriptor)
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

/// DD-125(5), SF-BUZ-56(4): the original Relay GIF proxy paths (`api/gifs.rs`). They are the
/// only Relay paths the GIF methods below can reach; the rest of the Relay HTTP surface is not
/// proxied through them.
pub const GIF_SEARCH_PATH: &str = "/gifs/search";
pub const GIF_SHARE_PATH: &str = "/gifs/share";

impl IdentityClient {
    /// The original `/gifs/search` as this identity: NIP-98 over POST with the payload hash.
    /// The Relay applies its member gate and GIF search rate limit; a 429 is a LIMIT.
    pub async fn gif_search(
        &self,
        http: &reqwest::Client,
        body: &Value,
    ) -> Result<Value, OperatorError> {
        let payload = serde_json::to_vec(body).map_err(|e| OperatorError::Sign(e.to_string()))?;
        self.bridge_post(http, GIF_SEARCH_PATH, &payload).await
    }

    /// The original `/gifs/share` report as this identity. Success is `204 No Content`.
    pub async fn gif_share(
        &self,
        http: &reqwest::Client,
        body: &Value,
    ) -> Result<(), OperatorError> {
        self.admit()?;
        let payload = serde_json::to_vec(body).map_err(|e| OperatorError::Sign(e.to_string()))?;
        let signed_url = format!("http://{}{}", self.community_host, GIF_SHARE_PATH);
        let url = self.transport.join(GIF_SHARE_PATH)?;
        let header = self.nip98_header("POST", &signed_url, &payload)?;
        let resp = http
            .post(url)
            .header(reqwest::header::HOST, &self.community_host)
            .header("Authorization", header)
            .header("Content-Type", "application/json")
            .body(payload)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp
                .text()
                .await
                .unwrap_or_default()
                .chars()
                .take(200)
                .collect();
            return Err(self.relay_rejected(status.as_u16(), body));
        }
        Ok(())
    }
}

#[cfg(test)]
mod event_exists_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Exercise the actual query, including its Host and signed NIP-98 payload.
    async fn observe(event_id: &str, page: Value) -> Result<bool, OperatorError> {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let keys = Keys::generate();
        let author = keys.public_key();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            &format!("http://{}", listener.local_addr().unwrap()),
            "evidence.platform.test",
        )
        .unwrap();
        let expected = serde_json::json!([{"ids":[event_id]}]);
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut chunk = [0; 4096];
            let header_end = loop {
                let n = socket.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                received.extend_from_slice(&chunk[..n]);
                if let Some(end) = received.windows(4).position(|v| v == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let head = String::from_utf8(received[..header_end].to_vec()).unwrap();
            assert!(head.starts_with("POST /query HTTP/1.1\r\n"));
            let header = |name: &str| {
                head.lines()
                    .filter_map(|line| line.split_once(':'))
                    .find(|(key, _)| key.eq_ignore_ascii_case(name))
                    .map(|(_, value)| value.trim().to_owned())
                    .unwrap()
            };
            let length: usize = header("content-length").parse().unwrap();
            while received.len() - header_end < length {
                let n = socket.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                received.extend_from_slice(&chunk[..n]);
            }
            let body = &received[header_end..];
            assert_eq!(serde_json::from_slice::<Value>(body).unwrap(), expected);
            assert_eq!(header("host"), "evidence.platform.test");
            let authorization = header("authorization");
            let auth: Event = serde_json::from_slice(
                &base64::engine::general_purpose::STANDARD
                    .decode(authorization.strip_prefix("Nostr ").unwrap())
                    .unwrap(),
            )
            .unwrap();
            auth.verify().unwrap();
            assert_eq!(auth.pubkey, author);
            assert_eq!(auth.kind, Kind::HttpAuth);
            for (name, value) in [
                ("u", "http://evidence.platform.test/query".to_owned()),
                ("method", "POST".to_owned()),
                ("payload", hex::encode(Sha256::digest(body))),
            ] {
                assert!(auth.tags.iter().any(|tag| tag.as_slice() == [name, &value]));
            }
            let body = page.to_string();
            socket.write_all(format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len(),
            ).as_bytes()).await.unwrap();
        });
        let result = client.event_exists(&reqwest::Client::new(), event_id).await;
        task.await.unwrap();
        result
    }

    fn signed(content: &str) -> Event {
        EventBuilder::new(Kind::Custom(9), content)
            .sign_with_keys(&Keys::generate())
            .unwrap()
    }

    #[tokio::test]
    async fn event_exists_accepts_only_verified_exact_event_and_preserves_empty() {
        let event = signed("original fixture");
        let id = event.id.to_hex();
        assert!(observe(&id, serde_json::json!([event])).await.unwrap());
        assert!(!observe(&id, serde_json::json!([])).await.unwrap());
    }

    #[tokio::test]
    async fn event_exists_rejects_corrupted_signed_event() {
        let event = signed("original fixture");
        let id = event.id.to_hex();
        let original = serde_json::to_value(&event).unwrap();
        for (field, changed) in [
            ("content", serde_json::json!("corrupted fixture")),
            ("created_at", serde_json::json!(event.created_at.as_secs() + 1)),
            ("kind", serde_json::json!(1)),
            ("sig", serde_json::json!(signed("another fixture").sig.to_string())),
            ("pubkey", serde_json::json!(Keys::generate().public_key().to_hex())),
        ] {
            let mut row = original.clone();
            row[field] = changed;
            assert!(matches!(observe(&id, serde_json::json!([row])).await,
                Err(OperatorError::NotConverged(_))), "corrupt {field} must not prove delivery");
        }
    }

    #[tokio::test]
    async fn event_exists_rejects_malformed_duplicate_and_mismatched_rows() {
        let event = signed("original fixture");
        let id = event.id.to_hex();
        let mut noncanonical = serde_json::to_value(&event).unwrap();
        noncanonical["id"] = id.to_uppercase().into();
        for page in [
            Value::Null,
            serde_json::json!({"id": id}),
            serde_json::json!([{"id": id}]),
            serde_json::json!([event, event]),
            serde_json::json!([signed("unrelated fixture")]),
            serde_json::json!([noncanonical]),
        ] {
            assert!(matches!(observe(&id, page).await, Err(OperatorError::NotConverged(_))));
        }
    }
}

#[cfg(test)]
mod relay_rate_limit_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// 一个只会回 `429` 的 Relay：每个连接读完请求后回空体 429 并关闭。
    async fn limited_relay(connections: usize) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            for _ in 0..connections {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut received = Vec::new();
                let mut chunk = [0; 4096];
                let header_end = loop {
                    let n = socket.read(&mut chunk).await.unwrap();
                    assert_ne!(n, 0);
                    received.extend_from_slice(&chunk[..n]);
                    if let Some(end) = received.windows(4).position(|v| v == b"\r\n\r\n") {
                        break end + 4;
                    }
                };
                let head = String::from_utf8_lossy(&received[..header_end]).to_string();
                let length: usize = head
                    .lines()
                    .filter_map(|line| line.split_once(':'))
                    .find(|(key, _)| key.eq_ignore_ascii_case("content-length"))
                    .map(|(_, value)| value.trim().parse().unwrap())
                    .unwrap_or(0);
                while received.len() - header_end < length {
                    let n = socket.read(&mut chunk).await.unwrap();
                    assert_ne!(n, 0);
                    received.extend_from_slice(&chunk[..n]);
                }
                let response: &[u8] = b"HTTP/1.1 429 Too Many Requests\r\n\
                    content-length: 0\r\nconnection: close\r\n\r\n";
                socket.write_all(response).await.unwrap();
                socket.shutdown().await.ok();
            }
        });
        (origin, task)
    }

    fn client(origin: &str) -> IdentityClient {
        let keys = Keys::generate();
        IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            origin,
            "limits.platform.test",
        )
        .unwrap()
    }

    /// DD-156(3)：挂了 Core 预算的身份收到 Relay 自身的 429，错误带该身份预算窗口中
    /// 最早一次调用离开窗口的剩余秒数；未挂预算的客户端仍是原样的 `Rejected { 429 }`。
    #[tokio::test]
    async fn relay_429_carries_budget_window_retry_after() {
        let (origin, task) = limited_relay(2).await;
        let http = reqwest::Client::new();
        let filter = [serde_json::json!({ "kinds": [9], "limit": 1 })];

        let budget =
            Arc::new(ApiBudget::new(10, std::time::Duration::from_secs(60)).expect("预算"));
        let budgeted = client(&origin).with_budget(budget);
        let err = budgeted.query(&http, &filter).await.unwrap_err();
        assert_eq!(err.limit(), Some(LimitKind::RateLimited));
        assert!(
            matches!(
                err,
                OperatorError::RelayRateLimited { retry_after_secs, .. }
                    if (59..=60).contains(&retry_after_secs)
            ),
            "挂预算的 Relay 429 必须带预算窗口推算的等待：{err:?}"
        );
        let secs = err.retry_after_secs().unwrap_or_default();
        assert!((59..=60).contains(&secs), "{err:?}");

        let bare = client(&origin);
        let err = bare.query(&http, &filter).await.unwrap_err();
        assert!(
            matches!(err, OperatorError::Rejected { status: 429, .. }),
            "未挂预算时保持原样：{err:?}"
        );
        assert_eq!(err.limit(), Some(LimitKind::RateLimited));
        assert_eq!(err.retry_after_secs(), None);
        task.await.unwrap();
    }
}

#[cfg(test)]
mod media_tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn image_bytes(with_text: bool) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, 16, 16);
            encoder.set_color(png::ColorType::Grayscale);
            encoder.set_depth(png::BitDepth::One);
            if with_text {
                encoder
                    .add_text_chunk("Comment".into(), "private metadata".into())
                    .unwrap();
            }
            let mut writer = encoder.write_header().unwrap();
            if with_text {
                // PNG EXIF uses the TIFF payload without JPEG's Exif prefix.
                writer
                    .write_chunk(
                        png::chunk::eXIf,
                        b"II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x01\0\0\0\0\0\0\0",
                    )
                    .unwrap();
            }
            writer.write_image_data(&[0; 32]).unwrap();
        }
        bytes
    }

    fn client(origin: &str) -> IdentityClient {
        let keys = Keys::generate();
        IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            origin,
            "media.platform.test",
        )
        .unwrap()
    }

    /// Exercise the actual signed HTTP upload, not a substituted image helper.
    async fn receiver(
        expected: Vec<u8>,
        mime: &'static str,
        corrupt: Option<&'static str>,
        status: u16,
        location: Option<String>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut received = Vec::new();
            let mut chunk = [0; 4096];
            let header_end = loop {
                let n = socket.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                received.extend_from_slice(&chunk[..n]);
                if let Some(end) = received.windows(4).position(|v| v == b"\r\n\r\n") {
                    break end + 4;
                }
            };
            let head = String::from_utf8(received[..header_end].to_vec()).unwrap();
            assert!(head.starts_with("PUT /upload HTTP/1.1\r\n"));
            let header = |name: &str| {
                head.lines()
                    .filter_map(|line| line.split_once(':'))
                    .find(|(key, _)| key.eq_ignore_ascii_case(name))
                    .map(|(_, value)| value.trim().to_owned())
                    .unwrap()
            };
            let length: usize = header("content-length").parse().unwrap();
            while received.len() - header_end < length {
                let n = socket.read(&mut chunk).await.unwrap();
                assert_ne!(n, 0);
                received.extend_from_slice(&chunk[..n]);
            }
            assert_eq!(&received[header_end..], expected);
            let sha256 = hex::encode(Sha256::digest(&expected));
            assert_eq!(header("x-sha-256"), sha256);
            assert_eq!(header("content-type"), mime);
            assert_eq!(header("host"), "media.platform.test");
            let authorization = header("authorization");
            let event: Event = serde_json::from_slice(
                &base64::engine::general_purpose::URL_SAFE_NO_PAD
                    .decode(authorization.strip_prefix("Nostr ").unwrap())
                    .unwrap(),
            )
            .unwrap();
            event.verify().unwrap();
            assert!(event
                .tags
                .iter()
                .any(|tag| tag.as_slice() == ["x", &sha256]));
            let mut descriptor = serde_json::json!({
                "url": format!("https://media.platform.test/media/{sha256}"),
                "sha256": sha256,
                "size": expected.len(),
                "type": mime,
            });
            match corrupt {
                Some("sha256") => descriptor["sha256"] = "mismatched".into(),
                Some("size") => descriptor["size"] = (expected.len() + 1).into(),
                Some("type") => descriptor["type"] = "image/jpeg".into(),
                Some("json") => descriptor = serde_json::Value::Null,
                None => {}
                _ => unreachable!(),
            }
            let body = descriptor.to_string();
            let location = location
                .map(|url| format!("Location: {url}\r\n"))
                .unwrap_or_default();
            socket
                .write_all(
                    format!(
                        "HTTP/1.1 {status} Result\r\n{location}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        (origin, task)
    }

    #[tokio::test]
    async fn media_upload_signs_and_verifies_sanitized_bytes_not_browser_bytes() {
        let raw = image_bytes(true);
        let expected =
            buzz_sdk::media::sanitize_image_for_upload(raw.clone(), "image/png").unwrap();
        assert_ne!(raw, expected);
        assert!(!expected.windows(4).any(|chunk| chunk == b"tEXt"));
        assert!(!expected.windows(4).any(|chunk| chunk == b"eXIf"));
        let (origin, received) = receiver(expected.clone(), "image/png", None, 200, None).await;
        let descriptor = client(&origin)
            .upload_media(
                &reqwest::Client::new(),
                raw,
                "application/octet-stream",
                u64::MAX,
            )
            .await
            .unwrap();
        received.await.unwrap();
        assert_eq!(descriptor.sha256, hex::encode(Sha256::digest(&expected)));
        assert_eq!(descriptor.size, expected.len() as u64);
        assert_eq!(descriptor.mime_type.as_deref(), Some("image/png"));
    }

    #[tokio::test]
    async fn media_upload_never_accepts_unverifiable_success_receipts() {
        let raw = image_bytes(true);
        let expected =
            buzz_sdk::media::sanitize_image_for_upload(raw.clone(), "image/png").unwrap();
        for corrupt in ["sha256", "size", "type", "json"] {
            let (origin, received) =
                receiver(expected.clone(), "image/png", Some(corrupt), 200, None).await;
            let result = client(&origin)
                .upload_media(&reqwest::Client::new(), raw.clone(), "image/png", u64::MAX)
                .await;
            received.await.unwrap();
            assert!(
                matches!(result, Err(OperatorError::MediaResultUnknown(_))),
                "{corrupt}: {result:?}"
            );
        }
    }

    #[tokio::test]
    async fn media_upload_keeps_non_image_bytes_and_mime_unchanged() {
        let raw = b"ordinary attachment payload".to_vec();
        let (origin, received) =
            receiver(raw.clone(), "application/octet-stream", None, 200, None).await;
        client(&origin)
            .upload_media(
                &reqwest::Client::new(),
                raw,
                "application/octet-stream",
                u64::MAX,
            )
            .await
            .unwrap();
        received.await.unwrap();
    }

    #[tokio::test]
    async fn media_upload_only_treats_definite_client_rejections_as_rejected() {
        let raw = image_bytes(true);
        let expected =
            buzz_sdk::media::sanitize_image_for_upload(raw.clone(), "image/png").unwrap();
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        for status in [400, 403, 413, 429, 302, 500, 503] {
            let (origin, received) =
                receiver(expected.clone(), "image/png", None, status, None).await;
            let result = client(&origin)
                .upload_media(&http, raw.clone(), "image/png", u64::MAX)
                .await;
            received.await.unwrap();
            if (400..500).contains(&status) {
                assert!(
                    matches!(result, Err(OperatorError::Rejected {status: actual, ..}) if actual == status)
                );
            } else {
                assert!(
                    matches!(result, Err(OperatorError::MediaResultUnknown(_))),
                    "{status}: {result:?}"
                );
            }
        }
    }

    #[tokio::test]
    async fn media_upload_invalid_and_expanded_images_are_rejected_before_http() {
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        drop(listener);
        let client = client(&origin);
        let http = reqwest::Client::new();
        assert!(matches!(
            client
                .upload_media(&http, b"invalid image".to_vec(), "image/png", u64::MAX)
                .await,
            Err(OperatorError::InvalidMedia(_))
        ));
        let raw = image_bytes(false);
        let prepared =
            buzz_sdk::media::sanitize_image_for_upload(raw.clone(), "image/png").unwrap();
        assert!(
            prepared.len() > raw.len(),
            "fixture must exercise re-encoding growth"
        );
        let limit = raw.len() as u64;
        for max_bytes in [limit - 1, limit] {
            assert!(matches!(
                client
                    .upload_media(&http, raw.clone(), "image/png", max_bytes)
                    .await,
                Err(OperatorError::Rejected { status: 413, .. })
            ));
        }
    }

    #[tokio::test]
    async fn media_upload_redirect_never_reaches_location_or_forwards_credentials() {
        let target = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let location = format!("http://{}/redirected", target.local_addr().unwrap());
        let attempts = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = attempts.clone();
        let (stop, stopped) = tokio::sync::oneshot::channel();
        let target_task = tokio::spawn(async move {
            tokio::select! {
                accepted = target.accept() => {
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    let (mut socket, _) = accepted.unwrap();
                    socket.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await.unwrap();
                }
                _ = stopped => {}
            }
        });
        let raw = image_bytes(true);
        let expected =
            buzz_sdk::media::sanitize_image_for_upload(raw.clone(), "image/png").unwrap();
        let (origin, received) = receiver(expected, "image/png", None, 302, Some(location)).await;
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let result = client(&origin)
            .upload_media(&http, raw, "image/png", u64::MAX)
            .await;
        received.await.unwrap();
        let _ = stop.send(());
        target_task.await.unwrap();
        assert!(matches!(result, Err(OperatorError::MediaResultUnknown(_))));
        assert_eq!(attempts.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}

#[cfg(test)]
mod mention_tests {
    use super::*;

    #[test]
    fn topic_receipt_requires_exact_scope_actor_value_and_original_signature() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://unused.invalid",
            "topic.invalid",
        )
        .unwrap();
        let channel = Uuid::new_v4();
        for topic in ["Release discussion", ""] {
            let event = client.sign_channel_topic_at(channel, topic, 105).unwrap();
            let id = event.id.to_hex();
            let author = keys.public_key().to_hex();
            assert!(topic_matches(&event, &id, &author, channel, topic));
            assert!(!topic_matches(&event, &id, &author, Uuid::new_v4(), topic));
            assert!(!topic_matches(
                &event,
                &id,
                &Keys::generate().public_key().to_hex(),
                channel,
                topic
            ));
            assert!(!topic_matches(&event, &id, &author, channel, "other"));
            assert!(topic_matches(
                &event,
                &id,
                &author,
                channel,
                "{{trigger.text}}"
            ));
            assert!(!topic_matches(
                &event,
                &id,
                &author,
                Uuid::new_v4(),
                "{{trigger.text}}"
            ));
            let unrelated = client
                .sign_channel_topic_at(channel, "unrelated", 106)
                .unwrap();
            assert!(!topic_matches(
                &unrelated,
                &id,
                &author,
                channel,
                "{{trigger.text}}"
            ));
            let mut forged = event.clone();
            forged.content = "forged".into();
            assert!(!topic_matches(&forged, &id, &author, channel, topic));
            assert!(!topic_matches(
                &forged,
                &id,
                &author,
                channel,
                "{{trigger.text}}"
            ));
            // Keep the original JSON id/signature but substitute another valid
            // topic's tags; the receipt must recompute the event hash.
            let mut forged_topic = event.clone();
            forged_topic.tags = unrelated.tags.clone();
            assert!(!topic_matches(
                &forged_topic,
                &id,
                &author,
                channel,
                "{{trigger.text}}"
            ));
        }
    }

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
        let native = client
            .sign_message_reaction(&source, "👍", false, &[])
            .unwrap();
        assert!(native.verify().is_ok());
        assert_eq!(native.kind.as_u16(), 7);
        assert_eq!(native.tags.len(), 1);
        let removed = client
            .sign_message_reaction(&native.id.to_hex(), "", true, &[])
            .unwrap();
        assert!(removed.verify().is_ok());
        assert_eq!(removed.kind.as_u16(), 5);
        assert_eq!(
            removed.tags.iter().next().unwrap().as_slice(),
            &["e", &native.id.to_hex()]
        );
        let emoji = vec![
            "emoji".into(),
            "wave".into(),
            "https://media.example.test/wave.png".into(),
        ];
        let custom = client
            .sign_message_reaction(&source, ":wave:", false, std::slice::from_ref(&emoji))
            .unwrap();
        assert!(custom.verify().is_ok());
        assert_eq!(custom.tags.len(), 2);
        assert!(client
            .sign_message_reaction(&source, ":other:", false, &[emoji])
            .is_err());
        assert!(client
            .sign_message_reaction(&source, "👍", true, &[])
            .is_err());
        let event = client.sign_reaction_at(&source, "👍", 105).unwrap();
        let id = event.id.to_hex();
        let author = keys.public_key().to_hex();
        assert!(reaction_matches(&event, &id, &author, &source, "👍"));
        assert!(reaction_matches(
            &event,
            &id,
            &author,
            &source,
            "{{trigger.text}}"
        ));
        assert!(!reaction_matches(
            &event,
            &id,
            &author,
            &"b".repeat(64),
            "{{trigger.text}}"
        ));
        let unrelated = client.sign_reaction_at(&source, "👎", 106).unwrap();
        assert!(!reaction_matches(
            &unrelated,
            &id,
            &author,
            &source,
            "{{trigger.text}}"
        ));
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
        assert!(!reaction_matches(
            &forged,
            &id,
            &author,
            &source,
            "{{trigger.text}}"
        ));
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
        let root = "a".repeat(64);
        for message_type in [
            contracts::WebMessageType::Stream,
            contracts::WebMessageType::ForumPost,
            contracts::WebMessageType::ForumComment,
        ] {
            let original = client
                .sign_channel_message_kind(
                    "channel",
                    "before",
                    &[],
                    std::slice::from_ref(&old_mention),
                    &message_type,
                    (message_type == contracts::WebMessageType::ForumComment)
                        .then_some((root.as_str(), root.as_str())),
                )
                .unwrap();
            let edited = client
                .sign_message_edit(
                    &original,
                    "after",
                    &[],
                    &[old_mention.clone(), new_mention.clone()],
                )
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
                    vec!["p".into(), new_mention.clone()]
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
    fn reference_mentions_sign_display_tags_without_notifying() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.example",
            "relay.example",
        )
        .unwrap();
        let notified = Keys::generate().public_key().to_hex();
        let outside = Keys::generate().public_key().to_hex();
        let root = "a".repeat(64);
        let reply = client
            .sign_channel_message_references(
                "channel",
                "hello",
                &[],
                std::slice::from_ref(&notified),
                std::slice::from_ref(&outside),
                &contracts::WebMessageType::Stream,
                Some((&root, &root)),
            )
            .unwrap();
        reply.verify().unwrap();
        let tags: Vec<_> = reply
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert_eq!(
            tags,
            vec![
                vec!["h".to_owned(), "channel".into()],
                vec!["e".into(), root, String::new(), "reply".into()],
                vec!["p".into(), notified],
                vec!["mention".into(), outside.clone()],
            ]
        );
        assert!(!tags.iter().any(|tag| tag[0] == "p" && tag[1] == outside));
        for (mentions, references) in [
            (vec![outside.clone()], vec![outside.clone()]),
            (vec![], vec!["invalid".to_owned()]),
        ] {
            assert!(client
                .sign_channel_message_references(
                    "channel",
                    "hello",
                    &[],
                    &mentions,
                    &references,
                    &contracts::WebMessageType::Stream,
                    None,
                )
                .is_err());
        }
    }

    #[test]
    fn agent_address_annotates_only_notified_agents() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.example",
            "relay.example",
        )
        .unwrap();
        let agent = Keys::generate().public_key().to_hex();
        let other = Keys::generate().public_key().to_hex();
        let event = client
            .sign_channel_message_addressed(
                "channel",
                "hello",
                &[],
                &[agent.clone(), other.clone()],
                &[],
                &[agent.clone(), agent.clone()],
                &contracts::WebMessageType::Stream,
                None,
            )
            .unwrap();
        event.verify().unwrap();
        let tags: Vec<_> = event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect();
        assert_eq!(
            tags.iter()
                .filter(|tag| tag.len() == 3 && tag[2] == "agent-address")
                .collect::<Vec<_>>(),
            vec![&vec![
                "mention".to_owned(),
                agent.clone(),
                "agent-address".into()
            ]]
        );
        // An addressed key must also be a notified mention.
        let outside = Keys::generate().public_key().to_hex();
        assert!(client
            .sign_channel_message_addressed(
                "channel",
                "hello",
                &[],
                std::slice::from_ref(&agent),
                &[],
                std::slice::from_ref(&outside),
                &contracts::WebMessageType::Stream,
                None,
            )
            .is_err());
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

    #[test]
    fn ordered_messages_use_distinct_frozen_references_without_changing_thread_scope() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.example",
            "relay.example",
        )
        .unwrap();
        let first = uuid::Uuid::new_v4();
        let second = uuid::Uuid::new_v4();
        let root = "ab".repeat(32);
        let parent = "cd".repeat(32);
        for ancestry in [None, Some((root.as_str(), parent.as_str()))] {
            let a = client
                .sign_workflow_step_result_at("channel", "same text", ancestry, first, 17)
                .unwrap();
            let b = client
                .sign_workflow_step_result_at("channel", "same text", ancestry, second, 17)
                .unwrap();
            a.verify().unwrap();
            b.verify().unwrap();
            assert_ne!(a.id, b.id);
            assert_eq!(
                a.id,
                client
                    .sign_workflow_step_result_at("channel", "same text", ancestry, first, 17)
                    .unwrap()
                    .id
            );
            assert_eq!(a.content, "same text");
            assert_eq!(a.kind.as_u16(), KIND_CHANNEL_MESSAGE);
            assert!(a
                .tags
                .iter()
                .any(|tag| tag.as_slice() == ["r", &format!("urn:uuid:{first}")]));
            let observed = buzz_core::nip10::parse_thread_markers(&a.tags).resolve();
            assert_eq!(
                observed
                    .as_ref()
                    .map(|(root, parent)| (root.as_str(), parent.as_str())),
                ancestry
            );
        }
        assert!(client
            .sign_channel_result_at("channel", "legacy", Some((&root, &parent)), Some(first), 17)
            .is_err());
    }
}

#[cfg(test)]
mod reminder_tests {
    use super::*;

    #[test]
    fn reminder_self_encryption_requires_the_original_author_kind_and_signature() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://relay.test",
            "community.test",
        )
        .unwrap();
        let content = serde_json::from_value(
            serde_json::json!({"status":"pending","note":"private original reminder"}),
        )
        .unwrap();
        let event = client
            .sign_reminder(
                &content,
                &[
                    vec!["d".into(), "owned".into()],
                    vec!["not_before".into(), "0".into()],
                ],
                17,
            )
            .unwrap();
        assert_eq!(event.kind.as_u16(), 30300);
        assert_eq!(event.created_at.as_secs(), 17);
        assert!(!event.content.contains("private original reminder"));
        assert_eq!(
            serde_json::from_str::<contracts::ReminderContent>(
                &client.decrypt_reminder(&event).unwrap()
            )
            .unwrap(),
            content
        );
        let other = Keys::generate();
        let other = IdentityClient::new(
            Custody::Server,
            &other.secret_key().to_secret_hex(),
            "http://relay.test",
            "community.test",
        )
        .unwrap();
        assert!(other.decrypt_reminder(&event).is_err());
        let mut tampered = event.clone();
        tampered.content.push('x');
        assert!(client.decrypt_reminder(&tampered).is_err());
        let mut tampered_metadata = event.clone();
        tampered_metadata.created_at = nostr::Timestamp::from(18);
        assert!(client.decrypt_reminder(&tampered_metadata).is_err());
        let wrong_kind = EventBuilder::new(Kind::TextNote, event.content)
            .sign_with_keys(&keys)
            .unwrap();
        assert!(client.decrypt_reminder(&wrong_kind).is_err());
        assert!(IdentityClient::new(
            Custody::Client,
            &keys.secret_key().to_secret_hex(),
            "http://relay.test",
            "community.test"
        )
        .is_err());
    }
}

#[cfg(test)]
mod channel_metadata_tests {
    use super::*;

    const CHANNEL: &str = "6f1c0b52-6a55-4d0e-9a53-7c3f2a4e1b01";

    fn discovery(tags: &[&[&str]]) -> Event {
        let tags = tags
            .iter()
            .map(|t| Tag::parse(t.to_vec()).unwrap())
            .collect::<Vec<_>>();
        EventBuilder::new(Kind::Custom(KIND_CHANNEL_METADATA), "")
            .tags(tags)
            .sign_with_keys(&Keys::generate())
            .unwrap()
    }

    fn state(name: &str, about: &str, ttl: Option<i64>, archived: bool) -> ChannelMetadataState {
        ChannelMetadataState {
            name: name.into(),
            about: about.into(),
            ttl,
            archived,
        }
    }

    fn row(k: &str, v: &str) -> Vec<String> {
        vec![k.to_owned(), v.to_owned()]
    }

    fn rows(event: &Event) -> Vec<Vec<String>> {
        event.tags.iter().map(|t| t.as_slice().to_vec()).collect()
    }

    #[test]
    fn discovery_state_reads_native_tags_and_rejects_ambiguous_evidence() {
        let full = discovery(&[
            &["d", CHANNEL],
            &["name", "release"],
            &["about", "Release review"],
            &["private"],
            &["t", "forum"],
            &["topic", "Train 2026.10"],
            &["archived", "true"],
            &["ttl", "604800"],
            &["ttl_deadline", "2026-10-23T00:00:00+00:00"],
        ]);
        assert_eq!(
            channel_metadata_state(&full).unwrap(),
            state("release", "Release review", Some(604800), true)
        );
        let bare = discovery(&[&["d", CHANNEL], &["name", "release"], &["t", "stream"]]);
        assert_eq!(
            channel_metadata_state(&bare).unwrap(),
            state("release", "", None, false)
        );
        for broken in [
            discovery(&[&["d", CHANNEL]]),
            discovery(&[&["d", CHANNEL], &["name", "a"], &["name", "b"]]),
            discovery(&[&["d", CHANNEL], &["name", "a"], &["ttl", "0"]]),
            discovery(&[&["d", CHANNEL], &["name", "a"], &["ttl", "soon"]]),
            discovery(&[&["d", CHANNEL], &["name", "a"], &["archived", "maybe"]]),
            discovery(&[&["d", CHANNEL], &["name", "a", "extra"]]),
        ] {
            assert!(channel_metadata_state(&broken).is_err());
        }
    }

    #[test]
    fn edit_carries_only_changed_fields_and_never_visibility() {
        let target = ChannelMetadataTarget {
            name: Some("Release discussion".into()),
            about: Some("Release review posts and replies".into()),
            ttl: Some(ChannelTtl::Seconds(604800)),
            reopen: false,
        };
        let before = state("release", "", None, false);
        let tags = plan_channel_metadata(CHANNEL, &target, &before, false)
            .unwrap()
            .unwrap();
        assert_eq!(
            tags,
            vec![
                row("h", CHANNEL),
                row("name", "Release discussion"),
                row("about", "Release review posts and replies"),
                row("ttl", "604800"),
            ]
        );
        // 只差描述：只发 about
        let partial = state("Release discussion", "", Some(604800), false);
        assert_eq!(
            plan_channel_metadata(CHANNEL, &target, &partial, false).unwrap(),
            Some(vec![
                row("h", CHANNEL),
                row("about", "Release review posts and replies"),
            ])
        );
        // 回读一致即收敛，不再签发
        let after = state(
            "Release discussion",
            "Release review posts and replies",
            Some(604800),
            false,
        );
        assert_eq!(
            plan_channel_metadata(CHANNEL, &target, &after, false),
            Ok(None)
        );
        // Relay 存 canonical 名称：「# 名称」与回读的「名称」一致
        let hashed = ChannelMetadataTarget {
            name: Some("# Release discussion".into()),
            ..ChannelMetadataTarget::default()
        };
        assert_eq!(
            plan_channel_metadata(CHANNEL, &hashed, &after, false),
            Ok(None)
        );
    }

    #[test]
    fn clearing_description_and_ttl_sends_empty_values_only_when_set() {
        let target = ChannelMetadataTarget {
            about: Some(String::new()),
            ttl: Some(ChannelTtl::Clear),
            ..ChannelMetadataTarget::default()
        };
        let set = state("release", "Old", Some(3600), false);
        assert_eq!(
            plan_channel_metadata(CHANNEL, &target, &set, false).unwrap(),
            Some(vec![row("h", CHANNEL), row("about", ""), row("ttl", "")])
        );
        let cleared = state("release", "", None, false);
        assert_eq!(
            plan_channel_metadata(CHANNEL, &target, &cleared, false),
            Ok(None)
        );
    }

    #[test]
    fn reopen_requires_ttl_archival_and_converges_on_read_back() {
        let target = ChannelMetadataTarget {
            reopen: true,
            ..ChannelMetadataTarget::default()
        };
        let reaped = state("release", "", Some(3600), true);
        assert_eq!(
            plan_channel_metadata(CHANNEL, &target, &reaped, false).unwrap(),
            Some(vec![row("h", CHANNEL), row("archived", "false")])
        );
        // 不是 TTL 到期归档（没有 TTL）：不由 workspace.update 解档
        let manual = state("release", "", None, true);
        assert!(plan_channel_metadata(CHANNEL, &target, &manual, false).is_err());
        assert!(plan_channel_metadata(CHANNEL, &target, &manual, true).is_err());
        // 从未签发且未归档：前置条件不成立；已签发后回读未归档：解档已生效
        let open = state("release", "", Some(3600), false);
        assert!(plan_channel_metadata(CHANNEL, &target, &open, false).is_err());
        assert_eq!(
            plan_channel_metadata(CHANNEL, &target, &open, true),
            Ok(None)
        );
    }

    #[test]
    fn edits_on_archived_channel_are_refused_unless_already_converged() {
        let target = ChannelMetadataTarget {
            name: Some("renamed".into()),
            ..ChannelMetadataTarget::default()
        };
        let archived = state("release", "", Some(60), true);
        assert!(plan_channel_metadata(CHANNEL, &target, &archived, false).is_err());
        let converged = state("renamed", "", Some(60), true);
        assert_eq!(
            plan_channel_metadata(CHANNEL, &target, &converged, false),
            Ok(None)
        );
    }

    #[test]
    fn signed_edit_is_a_control_9002_never_a_member_topic() {
        let keys = Keys::generate();
        let client = IdentityClient::new(
            Custody::Server,
            &keys.secret_key().to_secret_hex(),
            "http://unused.invalid",
            "metadata.invalid",
        )
        .unwrap();
        let target = ChannelMetadataTarget {
            name: Some("renamed".into()),
            ttl: Some(ChannelTtl::Clear),
            ..ChannelMetadataTarget::default()
        };
        let observed = state("release", "", Some(60), false);
        let tags = plan_channel_metadata(CHANNEL, &target, &observed, false)
            .unwrap()
            .unwrap();
        assert_eq!(
            tags,
            vec![row("h", CHANNEL), row("name", "renamed"), row("ttl", "")]
        );
        let edit = client.sign(KIND_CHANNEL_EDIT_METADATA, "", &tags).unwrap();
        assert_eq!(edit.kind.as_u16(), 9002);
        assert!(edit.content.is_empty());
        assert_eq!(rows(&edit), tags);
        assert!(buzz_core::channel::topic_change(&edit).is_none());
        // 成员主题是严格 h+topic 两标签的 9002，Relay 只对这一形态放行成员（DD-119(9)）
        let channel = Uuid::parse_str(CHANNEL).unwrap();
        let topic = client.sign_channel_topic_at(channel, "Train", 7).unwrap();
        assert_eq!(topic.kind.as_u16(), 9002);
        assert_eq!(rows(&topic), vec![row("h", CHANNEL), row("topic", "Train")]);
        assert_eq!(
            buzz_core::channel::topic_change(&topic),
            Some((channel, "Train"))
        );
    }
}
