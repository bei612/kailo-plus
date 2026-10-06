//! Buzz Web 的 Relay 边界替换（`SS-WEB-RELAY`、`DD-39`）。
//!
//! Browser 只发类型化的语义命令，不发 raw signed event，也不发任意 Relay filter。
//! 它不接收 Relay URL、不接收 Nostr 私钥、不生成 NIP-42/NIP-98/NIP-44。
//!
//! 每次调用的顺序是固定的，且不能换：
//!
//! 1. 以网关投影的 issuer/subject 重新解析身份并取 active PlatformSession——
//!    撤权因此对下一个请求立刻生效；
//! 2. Workspace 必须 `ACTIVE`，且该 HUMAN 有 active WorkspaceMembership 或
//!    fresh workspace `manage`（`.design/03` §2 的 HUMAN scope guard）；
//! 3. 以该 HUMAN 的 `BuzzIdentityBinding` 代签发布，发布前不读任何 Browser 可控
//!    的身份字段。
//!
//! 反过来做——先签名再查 scope——就会在 Relay 上留下一条本不该存在的事件，
//! 而事件发出去就收不回来了。

use crate::audit::Evidence;
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use collab_bridge::bridge::{
    message_kind, parse_thread_markers, Custody, Delivery, IdentityClient, KIND_DELETION,
    KIND_NIP29_DELETE_EVENT, KIND_REACTION, KIND_STREAM_MESSAGE_EDIT, KIND_THREAD_SUMMARY,
    KIND_WINDOW_BOUNDS,
};
use collab_bridge::limits::RelayLimits;
use collab_bridge::operator::{LimitKind, OperatorError};
use contracts::EvidenceKind;
use contracts::{ErrorBody, ErrorClass, ReasonCode};
use secret_store::SecretRef;
use serde::Serialize;
use std::collections::HashMap;
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};

/// 消息发布的 action key。审计、对账与度量都按它找这一类动作。
pub const PUBLISH_ACTION: &str = "workspace.message.publish";
pub const CONVERSATION_PUBLISH_ACTION: &str = "conversation.message.publish";
pub const CONVERSATION_HIDE_ACTION: &str = "conversation.hide";
pub const CONVERSATION_REOPEN_ACTION: &str = "conversation.reopen";

enum Publication {
    Message(PublishRequest),
    Pulse(contracts::PulsePublishRequest),
    Hide,
    Reopen,
}

#[derive(Clone, Copy)]
enum MessageTarget {
    Workspace(Uuid),
    Conversation(Uuid),
    Pulse(Uuid),
}

impl MessageTarget {
    fn id(self) -> Uuid {
        match self {
            Self::Workspace(id) | Self::Conversation(id) | Self::Pulse(id) => id,
        }
    }

    fn workspace_id(self) -> Option<Uuid> {
        match self {
            Self::Workspace(id) => Some(id),
            Self::Conversation(_) | Self::Pulse(_) => None,
        }
    }

    fn action(self) -> &'static str {
        match self {
            Self::Workspace(_) => PUBLISH_ACTION,
            Self::Conversation(_) => CONVERSATION_PUBLISH_ACTION,
            Self::Pulse(_) => crate::pulse::PUBLISH_ACTION,
        }
    }

    fn target_type(self) -> &'static str {
        match self {
            Self::Workspace(_) => "CHANNEL",
            Self::Conversation(_) => "CONVERSATION",
            Self::Pulse(_) => "TENANT",
        }
    }

    async fn admit(
        self,
        state: &BffState,
        ctx: &ExecutionContext,
    ) -> Result<(String, String), Response> {
        match self {
            Self::Workspace(id) => {
                let scope = admit_workspace(state, ctx, id).await?;
                Ok((scope.channel_id, scope.community_host))
            }
            Self::Conversation(id) => {
                let scope = crate::conversations::admit(state, ctx, id).await?;
                Ok((scope.channel_id, scope.community_host))
            }
            Self::Pulse(id) if id == ctx.tenant_id => {
                let scope = crate::pulse::admit(state, ctx).await?;
                // Generation fence only; never written as an h tag or Workspace.
                Ok((scope.version.to_string(), scope.community_host))
            }
            Self::Pulse(_) => Err(StatusCode::FORBIDDEN.into_response()),
        }
    }
}

type PublishRequest = contracts::WebPublishMessageRequest;

trait RenderAttachment {
    fn render(&self, community_host: &str) -> Option<(String, Vec<String>)>;
}

/// The existing BFF media-origin fence applies to every attachment URL, not
/// just the original blob. Sidecar/content validation remains in Buzz Relay.
fn attachment_media_url(raw: &str, community_host: &str) -> Option<reqwest::Url> {
    let url = reqwest::Url::parse(raw).ok()?;
    let authority = match url.port() {
        Some(port) => format!("{}:{port}", url.host_str()?),
        None => url.host_str()?.to_owned(),
    };
    if authority != community_host
        || !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(url)
}

impl RenderAttachment for contracts::AttachmentElement {
    /// 按上游客户端的同一形式输出：正文追加一行 markdown，另带一条 NIP-92
    /// `imeta`。形式必须与原生端一致，否则原生端收到 Web 发的图看不见
    /// （上游 `formatImetaMediaLine`/`buildImetaTags`，`SF-BUZ-36`）。
    ///
    /// 复用固定 Buzz 的 formatImetaMediaLine/buildImetaTags 表达规则，保留
    /// 文件链接、音频、快照 PNG 与图片/视频剧透；MIME 和 filename 的权威
    /// 校验仍由 Relay 原 imeta validator/sidecar 执行，不建立另一媒体目录。
    ///
    /// URL 只核结构：必须是**本 Workspace 的 Community host** 下的
    /// `/media/<sha256>.<ext>`。不核它就等于让 BFF 替任何人签一条指向任意
    /// 地址的引用。blob 是否存在、MIME 与大小是否属实，由 Relay 按自己的
    /// sidecar 核对（`verify_imeta_blobs`），这里不再做一遍。
    fn render(&self, community_host: &str) -> Option<(String, Vec<String>)> {
        if self.size < 0 {
            return None;
        }
        if self.sha256.len() != 64 || !self.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let url = attachment_media_url(&self.url, community_host)?;
        let ext = url
            .path()
            .strip_prefix("/media/")?
            .strip_prefix(self.sha256.as_str())?
            .strip_prefix('.')?;
        let ext_ok = (1..=8).contains(&ext.len())
            && ext
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
        if !ext_ok {
            return None;
        }
        let mut tag = vec![
            "imeta".to_owned(),
            format!("url {}", self.url),
            format!("m {}", self.web_message_attachment_type),
            format!("x {}", self.sha256),
        ];
        if self.size > 0 {
            tag.push(format!("size {}", self.size));
        }
        // Original buildImetaTags fields, in the same order. A thumbnail is
        // tied to this blob; a video poster is a standalone local image.
        for (key, value) in [("dim", &self.dim), ("blurhash", &self.blurhash)] {
            if let Some(value) = value.as_deref().filter(|value| !value.is_empty()) {
                tag.push(format!("{key} {value}"));
            }
        }
        if let Some(thumb) = self.thumb.as_deref().filter(|value| !value.is_empty()) {
            let thumb_url = attachment_media_url(thumb, community_host)?;
            if thumb_url.path() != format!("/media/{}.thumb.jpg", self.sha256) {
                return None;
            }
            tag.push(format!("thumb {thumb}"));
        }
        if let Some(duration) = self.duration {
            if self.web_message_attachment_type != "video/mp4"
                || !duration.is_finite()
                || duration <= 0.0
            {
                return None;
            }
            tag.push(format!("duration {duration}"));
        }
        if let Some(image) = self.image.as_deref().filter(|value| !value.is_empty()) {
            if self.web_message_attachment_type != "video/mp4" {
                return None;
            }
            let image_url = attachment_media_url(image, community_host)?;
            let (hash, ext) = image_url.path().strip_prefix("/media/")?.split_once('.')?;
            // Buzz handlers/imeta.rs::validate_imeta_tags validates imeta posters.
            if hash.len() != 64
                || !hash.chars().all(|c| matches!(c, '0'..='9' | 'a'..='f'))
                || !matches!(ext, "jpg" | "png" | "gif" | "webp")
            {
                return None;
            }
            tag.push(format!("image {image}"));
        }
        if let Some(filename) = self.filename.as_deref().filter(|name| !name.is_empty()) {
            tag.push(format!("filename {filename}"));
        }
        // Buzz 779af8886caae1317b4de962082429867ab61503:
        // desktop/src/features/messages/lib/imetaMediaMarkdown.ts::formatImetaMediaLine.
        // Snapshots and packaged voice notes use the original file-card path.
        let filename = self.filename.as_deref().unwrap_or_default();
        let lower = filename.to_lowercase();
        let snapshot = lower.ends_with(".agent.png") || lower.ends_with(".team.png");
        let voice_note = self
            .web_message_attachment_type
            .eq_ignore_ascii_case("video/mp4")
            && lower.starts_with("voice-note-")
            && lower.ends_with(".mp4");
        let kind = if self.web_message_attachment_type.starts_with("video/") && !voice_note {
            Some("video")
        } else if self.web_message_attachment_type.starts_with("image/") && !snapshot {
            Some("image")
        } else {
            None
        };
        let line = if let Some(kind) = kind {
            let media = format!("![{kind}]({})", self.url);
            if self.spoiler == Some(true) {
                format!("\n||{media}||")
            } else {
                format!("\n{media}")
            }
        } else {
            let label = if let Some(label) = self
                .display_label
                .as_deref()
                .map(str::trim)
                .filter(|label| !label.is_empty())
            {
                label
            } else if filename.is_empty() {
                self.url.rsplit('/').next().unwrap_or_default()
            } else {
                filename
            };
            let escaped = label
                .replace('\\', "\\\\")
                .replace('[', "\\[")
                .replace(']', "\\]");
            format!("\n[{escaped}]({})", self.url)
        };
        Some((line, tag))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResponse {
    /// Relay 接受后回传的 event id。它是 operation outcome 与 audit evidence
    /// （`.design/09` 第 6 步），不是本地算出来的值。
    pub event_id: String,
    pub operation_id: Uuid,
}

#[derive(Debug, Serialize)]
pub struct QueryResponse {
    pub events: serde_json::Value,
    #[serde(rename = "nextCursor", skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<contracts::WebMessageCursor>,
}

fn mention_targets(ids: Option<&[String]>) -> Option<Vec<Uuid>> {
    let mut ids: Vec<Uuid> = ids
        .unwrap_or_default()
        .iter()
        .map(|id| Uuid::parse_str(id).ok())
        .collect::<Option<_>>()?;
    ids.sort_unstable();
    ids.dedup();
    Some(ids)
}

fn mention_intent_matches(frozen: &[Uuid], requested: &[Uuid]) -> bool {
    frozen == requested
}

fn publish_scope_matches(frozen: &[Option<Uuid>], requested: Uuid) -> bool {
    frozen == [Some(requested)]
}

/// Resolve semantic Installation references inside the already admitted Workspace.
/// Mentioning is not execution authorization: agent.invoke still performs its own
/// HUMAN ∩ AGENT ∩ Delegation, quota and capacity admission after Relay acceptance.
async fn resolve_mentions(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace: Uuid,
    ids: &[Uuid],
) -> Result<Vec<String>, Response> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "select i.resource_id,b.pubkey from catalog.agent_installation i
         join catalog.resource r on r.id=i.resource_id and r.type_key='agent.installation'
           and r.home_workspace_id=i.workspace_id and r.state='ACTIVE'
           and r.projection_action_execution_id is null
         join identity.principal a on a.id=i.agent_principal_id and a.tenant_id=r.tenant_id
           and a.kind='AGENT' and a.status='ACTIVE'
         join identity.buzz_identity_binding b on b.principal_id=a.id and b.tenant_id=r.tenant_id
           and b.kind='AGENT' and b.state='ACTIVE' and b.custody='SERVER'
         join catalog.channel_agent_binding cb on cb.installation_resource_id=i.resource_id
           and cb.workspace_id=i.workspace_id and cb.status='ACTIVE' and 'MENTION'=any(cb.triggers)
         join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
           and p.generation=i.active_projection_generation
           and p.agent_version_asset_id=i.pinned_version_asset_id and p.state='ACTIVE'
         where r.tenant_id=$1 and i.workspace_id=$2 and i.state='ACTIVE'
           and i.resource_id=any($3) order by i.resource_id",
    )
    .bind(ctx.tenant_id)
    .bind(workspace)
    .bind(ids)
    .fetch_all(&state.pool)
    .await
    .map_err(crate::service_api::unavailable)?;
    // Exact coverage, not first key wins: malformed or duplicate bindings are not
    // silently reduced to an ordinary unmentioned message.
    if rows.iter().map(|(id, _)| id).ne(ids.iter()) {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    for id in ids {
        match state
            .governance
            .spicedb
            .check(
                "resource",
                &id.to_string(),
                "read",
                &ctx.tenant_principal_id.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
        {
            Ok(check) if check.zed_token.is_empty() => {
                return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
            }
            Ok(check) if check.allowed => {}
            Ok(_) => return Err(StatusCode::FORBIDDEN.into_response()),
            Err(error) => {
                tracing::warn!(%error, "mention Installation read unavailable");
                return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
            }
        }
    }
    rows.into_iter()
        .map(|(_, key)| {
            nostr::PublicKey::from_hex(&key)
                .map(|key| key.to_hex())
                .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())
        })
        .collect()
}

/// 发一条 Workspace 消息。
pub async fn publish_message(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<PublishRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    publish_message_for(state, MessageTarget::Workspace(workspace_id), headers, body).await
}

pub async fn publish_conversation_message(
    State(state): State<BffState>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<PublishRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    publish_message_for(
        state,
        MessageTarget::Conversation(conversation_id),
        headers,
        body,
    )
    .await
}

pub(crate) async fn publish_pulse(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<contracts::PulsePublishRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(e) => return e,
    };
    publish(
        state,
        MessageTarget::Pulse(ctx.tenant_id),
        headers,
        Publication::Pulse(request),
    )
    .await
}

pub(crate) async fn upload_pulse_media(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(e) => return e,
    };
    upload_media_for(state, MessageTarget::Pulse(ctx.tenant_id), headers, body).await
}

pub(crate) async fn fetch_pulse_media(
    State(state): State<BffState>,
    Path(hash): Path<String>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(e) => return e,
    };
    fetch_media_for(state, MessageTarget::Pulse(ctx.tenant_id), hash, headers).await
}

async fn publish_message_for(
    state: BffState,
    target: MessageTarget,
    headers: HeaderMap,
    body: Result<Json<PublishRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    publish(state, target, headers, Publication::Message(req)).await
}

pub async fn hide_conversation(
    State(state): State<BffState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    publish(
        state,
        MessageTarget::Conversation(id),
        headers,
        Publication::Hide,
    )
    .await
}

pub async fn reopen_conversation(
    State(state): State<BffState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    publish(
        state,
        MessageTarget::Conversation(id),
        headers,
        Publication::Reopen,
    )
    .await
}

/// Original NIP-DV snapshot for the current HUMAN, not a Core hidden-state copy.
pub async fn conversation_visibility(
    State(state): State<BffState>,
    Path(id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(e) => return e,
    };
    let before = match crate::conversations::admit(&state, &ctx, id).await {
        Ok(scope) => scope,
        Err(e) => return e,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(keys) => keys,
        Err(e) => return e,
    };
    let client = match community_client(&state, &keys, &before.community_host) {
        Ok(client) => client,
        Err(e) => return e,
    };
    if let Err(e) = community_limits(&state, &before.community_host).await {
        return e.into_response();
    }
    let author: Option<String> = match sqlx::query_scalar("select relay_self_pubkey from projection.tenant_buzz_binding where tenant_id=$1 and state='ACTIVE' and version=$2")
        .bind(ctx.tenant_id).bind(before.tenant_binding_version).fetch_optional(&state.pool).await {
        Ok(Some(author)) => author,
        _ => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let Some(author) = author else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let viewer = keys.public_key().to_hex();
    let events = match client.query(&state.http, &[serde_json::json!({"kinds":[30622],"authors":[author],"#p":[viewer],"#d":[viewer],"limit":1})]).await {
        Ok(events) => events,
        Err(e) => return relay_error_response(&e, None),
    };
    let parsed: Vec<nostr::Event> = match serde_json::from_value(events.clone()) {
        Ok(events) => events,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    if parsed.len() > 1
        || parsed.iter().any(|event| {
            event.kind.as_u16() != 30622
                || event.pubkey.to_hex() != author
                || event.verify().is_err()
                || !event
                    .tags
                    .iter()
                    .any(|tag| tag.as_slice() == ["d", viewer.as_str()])
                || !event
                    .tags
                    .iter()
                    .any(|tag| tag.as_slice() == ["p", viewer.as_str()])
        })
    {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let after = match crate::conversations::admit(&state, &ctx, id).await {
        Ok(scope) => scope,
        Err(e) => return e,
    };
    let current = match actor_keys(&state, &ctx).await {
        Ok(keys) => keys,
        Err(e) => return e,
    };
    if before != after || keys.public_key() != current.public_key() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    Json(QueryResponse {
        events,
        next_cursor: None,
    })
    .into_response()
}

fn valid_message_intent(message_type: &contracts::WebMessageType, parent: Option<&str>) -> bool {
    if parent
        .is_some_and(|id| nostr::EventId::from_hex(id).map_or(true, |parsed| parsed.to_hex() != id))
    {
        return false;
    }
    match message_type {
        contracts::WebMessageType::Stream => true,
        contracts::WebMessageType::ForumPost => parent.is_none(),
        contracts::WebMessageType::ForumComment => parent.is_some(),
    }
}

// Preserve the BFF's existing typed HTTP error response at this validation boundary.
#[allow(clippy::result_large_err)]
fn channel_message_event(
    value: serde_json::Value,
    channel: &str,
) -> Result<nostr::Event, Response> {
    let event: nostr::Event =
        serde_json::from_value(value).map_err(|_| invalid_message_evidence())?;
    let channels: Vec<_> = event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .filter(|tag| tag.first().is_some_and(|key| key == "h"))
        .collect();
    let message_type = [
        contracts::WebMessageType::Stream,
        contracts::WebMessageType::ForumPost,
        contracts::WebMessageType::ForumComment,
    ]
    .into_iter()
    .find(|kind| message_kind(kind) == event.kind.as_u16());
    let ancestry = parse_thread_markers(&event.tags).resolve();
    let valid_kind_and_ancestry = message_type.as_ref().is_some_and(|kind| {
        valid_message_intent(kind, ancestry.as_ref().map(|(_, parent)| parent.as_str()))
    });
    if !valid_kind_and_ancestry
        || event.verify().is_err()
        || channels.len() != 1
        || channels[0].get(1).map(String::as_str) != Some(channel)
    {
        return Err(invalid_message_evidence());
    }
    Ok(event)
}

fn invalid_message_evidence() -> Response {
    error_body(
        StatusCode::SERVICE_UNAVAILABLE,
        ErrorClass::Precondition,
        ReasonCode::DependencyUnavailable,
        None,
    )
}

#[allow(clippy::result_large_err)]
fn message_query_cursor(
    query: &contracts::WebMessageQuery,
) -> Result<Option<contracts::WebMessageCursor>, Response> {
    match (query.before, query.before_id.as_deref()) {
        (None, None) => Ok(None),
        (Some(created_at), Some(event_id))
            if created_at >= 0
                && nostr::EventId::from_hex(event_id).is_ok_and(|id| id.to_hex() == event_id) =>
        {
            Ok(Some(contracts::WebMessageCursor {
                created_at,
                event_id: event_id.to_owned(),
            }))
        }
        _ => Err(StatusCode::BAD_REQUEST.into_response()),
    }
}

pub(crate) async fn window_author(
    state: &BffState,
    ctx: &ExecutionContext,
    host: &str,
) -> Result<(i32, String), Response> {
    let row: Option<(i32, Option<String>)> = sqlx::query_as(
        "select version, relay_self_pubkey from projection.tenant_buzz_binding
         where tenant_id=$1 and normalized_host=$2 and state='ACTIVE'",
    )
    .bind(ctx.tenant_id)
    .bind(host)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| invalid_message_evidence())?;
    match row {
        Some((version, Some(author)))
            if nostr::PublicKey::from_hex(&author).is_ok_and(|key| key.to_hex() == author) =>
        {
            Ok((version, author))
        }
        _ => Err(invalid_message_evidence()),
    }
}

fn single_event_tag<'a>(event: &'a nostr::Event, key: &str) -> Option<&'a str> {
    let mut values = event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .filter(|tag| tag.first().is_some_and(|name| name == key));
    let value = values.next()?.get(1)?.as_str();
    values.next().is_none().then_some(value)
}

#[allow(clippy::result_large_err)]
pub(crate) fn web_channel_view(
    event: &nostr::Event,
    channel: &str,
    relay_author: &str,
) -> Result<contracts::WebChannelView, Response> {
    if event.kind.as_u16() != 39000
        || event.verify().is_err()
        || event.pubkey.to_hex() != relay_author
        || single_event_tag(event, "d") != Some(channel)
    {
        return Err(invalid_message_evidence());
    }
    let one = |key: &str| -> Result<Option<&str>, Response> {
        let mut tags = event
            .tags
            .iter()
            .map(nostr::Tag::as_slice)
            .filter(|tag| tag.first().is_some_and(|name| name == key));
        let tag = tags.next();
        if tags.next().is_some() || tag.is_some_and(|tag| tag.len() != 2) {
            return Err(invalid_message_evidence());
        }
        Ok(tag.map(|tag| tag[1].as_str()))
    };
    let name = one("name")?.ok_or_else(invalid_message_evidence)?;
    let channel_type = one("t")?.ok_or_else(invalid_message_evidence)?;
    let archived = match one("archived")? {
        None | Some("false") => false,
        Some("true") => true,
        Some(_) => return Err(invalid_message_evidence()),
    };
    let mut view = serde_json::json!({"channelId":channel,"channelType":channel_type,"name":name,"archived":archived});
    if let Some(description) = one("about")? {
        view["description"] = description.into();
    }
    match (one("ttl")?, one("ttl_deadline")?) {
        (None, None) => {}
        (Some(ttl), Some(deadline)) => {
            let seconds = ttl
                .parse::<i32>()
                .ok()
                .filter(|value| *value > 0)
                .ok_or_else(invalid_message_evidence)?;
            chrono::DateTime::parse_from_rfc3339(deadline)
                .map_err(|_| invalid_message_evidence())?;
            view["ttlSeconds"] = seconds.into();
            view["ttlDeadline"] = deadline.into();
        }
        _ => return Err(invalid_message_evidence()),
    }
    serde_json::from_value(view).map_err(|_| invalid_message_evidence())
}

/// Native channel metadata for the browser's actual admitted Channel. The
/// shared Workspace directory remains usable by CLIENT-custody native hosts.
pub async fn query_channel(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let scope = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(scope) => scope,
        Err(response) => return response,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    let client = match community_client(&state, &keys, &scope.community_host) {
        Ok(client) => client,
        Err(response) => return response,
    };
    if let Err(error) = community_limits(&state, &scope.community_host).await {
        return error.into_response();
    }
    let author = match window_author(&state, &ctx, &scope.community_host).await {
        Ok(author) => author,
        Err(response) => return response,
    };
    let event = match client
        .channel_metadata(&state.http, &scope.channel_id)
        .await
    {
        Ok(Some(event)) => event,
        Ok(None) => return invalid_message_evidence(),
        Err(error) => return relay_error_response(&error, None),
    };
    let view = match web_channel_view(&event, &scope.channel_id, &author.1) {
        Ok(view) => view,
        Err(response) => return response,
    };
    let current = match admit_workspace(&state, &ctx, workspace_id).await {
        Ok(scope) => scope,
        Err(response) => return response,
    };
    let current_keys = match actor_keys(&state, &ctx).await {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    if current.channel_id != scope.channel_id
        || current.community_host != scope.community_host
        || current.admission_epoch != scope.admission_epoch
        || current_keys.public_key() != keys.public_key()
    {
        return AdmissionFailure::BindingNotActive.into_response();
    }
    match window_author(&state, &ctx, &current.community_host).await {
        Ok(observed) if observed == author => Json(view).into_response(),
        _ => AdmissionFailure::BindingNotActive.into_response(),
    }
}

/// Validate original Relay rows and overlays without materializing another
/// timeline. Window exhaustion remains the relay-signed NIP-CW bounds event;
/// thread continuation follows the original native forward-keyset algorithm.
#[allow(clippy::too_many_arguments, clippy::result_large_err)]
pub(crate) fn verify_message_page(
    events: Vec<nostr::Event>,
    channel: &str,
    message_type: &contracts::WebMessageType,
    root: Option<&str>,
    cursor: Option<&contracts::WebMessageCursor>,
    relay_author: Option<&str>,
    cap: i64,
) -> Result<(Vec<nostr::Event>, Option<contracts::WebMessageCursor>), Response> {
    let window = root.is_none() && relay_author.is_some();
    let mut ids = std::collections::HashSet::new();
    let mut rows = Vec::new();
    let mut overlays = Vec::new();
    let mut auxiliary = Vec::new();
    for event in &events {
        let kind = u32::from(event.kind.as_u16());
        if event.verify().is_err() || !ids.insert(event.id) {
            return Err(invalid_message_evidence());
        }
        let h = single_event_tag(event, "h");
        // Native reactions and NIP-09 deletions derive their channel from the
        // target event. The target closure below still binds them to this page.
        let target_scoped_auxiliary = [KIND_DELETION, KIND_REACTION].contains(&kind)
            && !event
                .tags
                .iter()
                .any(|tag| tag.as_slice().first().is_some_and(|name| name == "h"));
        if h != Some(channel) && !target_scoped_auxiliary {
            return Err(invalid_message_evidence());
        }
        if [KIND_THREAD_SUMMARY, KIND_WINDOW_BOUNDS].contains(&kind) {
            if !window || relay_author != Some(event.pubkey.to_hex().as_str()) {
                return Err(invalid_message_evidence());
            }
            overlays.push(event);
        } else if [
            KIND_DELETION,
            KIND_REACTION,
            KIND_NIP29_DELETE_EVENT,
            KIND_STREAM_MESSAGE_EDIT,
        ]
        .contains(&kind)
        {
            if !window && root.is_none() {
                return Err(invalid_message_evidence());
            }
            auxiliary.push(event);
        } else {
            channel_message_event(serde_json::json!(event), channel)?;
            let matches = match root {
                Some(root) => {
                    [
                        contracts::WebMessageType::Stream,
                        contracts::WebMessageType::ForumComment,
                    ]
                    .iter()
                    .any(|kind| message_kind(kind) == event.kind.as_u16())
                        && parse_thread_markers(&event.tags)
                            .resolve()
                            .is_some_and(|(id, _)| id == root)
                }
                None => event.kind.as_u16() == message_kind(message_type),
            };
            let after_cursor = cursor.is_none_or(|cursor| {
                let time = event.created_at.as_secs();
                let id = event.id.to_hex();
                if root.is_some() {
                    (time, id.as_str()) > (cursor.created_at as u64, cursor.event_id.as_str())
                } else {
                    time < cursor.created_at as u64
                        || time == cursor.created_at as u64 && id > cursor.event_id
                }
            });
            if !matches || !after_cursor {
                return Err(invalid_message_evidence());
            }
            rows.push(event);
        }
    }
    if i64::try_from(rows.len()).map_or(true, |len| len > cap) {
        return Err(invalid_message_evidence());
    }
    if !rows.windows(2).all(|pair| {
        let (a, b) = (pair[0], pair[1]);
        if root.is_some() {
            (a.created_at, a.id) < (b.created_at, b.id)
        } else {
            a.created_at > b.created_at || a.created_at == b.created_at && a.id < b.id
        }
    }) {
        return Err(invalid_message_evidence());
    }

    // Only the original two-hop aux closure is admissible: row actions, then
    // deletions of those actions. A signed event for an unrelated row is not evidence.
    let mut targets: std::collections::HashSet<_> =
        rows.iter().map(|event| event.id.to_hex()).collect();
    targets.extend(root.map(str::to_owned));
    let refers_to = |event: &nostr::Event, targets: &std::collections::HashSet<String>| {
        event.tags.iter().map(nostr::Tag::as_slice).any(|tag| {
            tag.first().is_some_and(|key| key == "e")
                && tag.get(1).is_some_and(|id| targets.contains(id))
        })
    };
    let first_hop: std::collections::HashSet<_> = auxiliary
        .iter()
        .filter(|event| refers_to(event, &targets))
        .map(|event| event.id.to_hex())
        .collect();
    for event in auxiliary {
        if !(first_hop.contains(&event.id.to_hex())
            || ([KIND_DELETION, KIND_NIP29_DELETE_EVENT].contains(&u32::from(event.kind.as_u16()))
                && refers_to(event, &first_hop)))
        {
            return Err(invalid_message_evidence());
        }
    }
    let mut bounds_seen = false;
    let mut summaries = std::collections::HashSet::new();
    for overlay in overlays {
        let content: serde_json::Value =
            serde_json::from_str(&overlay.content).map_err(|_| invalid_message_evidence())?;
        if u32::from(overlay.kind.as_u16()) == KIND_WINDOW_BOUNDS {
            let suffix = cursor.map_or_else(
                || "head".to_owned(),
                |cursor| format!("{}:{}", cursor.created_at, cursor.event_id),
            );
            let expected = format!("{channel}:{suffix}");
            if bounds_seen || single_event_tag(overlay, "d") != Some(expected.as_str()) {
                return Err(invalid_message_evidence());
            }
            bounds_seen = true;
            match content.get("has_more").and_then(serde_json::Value::as_bool) {
                Some(false)
                    if content
                        .get("next_cursor")
                        .is_some_and(serde_json::Value::is_null) => {}
                Some(true) => {
                    let last = rows.last().ok_or_else(invalid_message_evidence)?;
                    let next = &content["next_cursor"];
                    if next["created_at"].as_u64() != Some(last.created_at.as_secs())
                        || next["id"].as_str() != Some(last.id.to_hex().as_str())
                    {
                        return Err(invalid_message_evidence());
                    }
                }
                _ => return Err(invalid_message_evidence()),
            }
        } else {
            let id = single_event_tag(overlay, "e").ok_or_else(invalid_message_evidence)?;
            if single_event_tag(overlay, "d") != Some(id)
                || !targets.contains(id)
                || !summaries.insert(id)
                || content["reply_count"].as_u64().is_none()
                || content["descendant_count"].as_u64().is_none()
                || !content["participants"].is_array()
            {
                return Err(invalid_message_evidence());
            }
        }
    }
    if window && !bounds_seen {
        return Err(invalid_message_evidence());
    }
    let next_cursor = if root.is_some() && rows.len() as i64 == cap {
        rows.last().map(|event| contracts::WebMessageCursor {
            created_at: event.created_at.as_secs() as i64,
            event_id: event.id.to_hex(),
        })
    } else {
        None
    };
    Ok((events, next_cursor))
}

async fn read_message_event(
    state: &BffState,
    client: &IdentityClient,
    channel: &str,
    id: &str,
) -> Result<nostr::Event, Response> {
    let response = client
        .query(
            &state.http,
            &[serde_json::json!({"ids":[id], "#h":[channel], "limit":1})],
        )
        .await
        .map_err(|error| relay_error_response(&error, None))?;
    let mut events = response
        .as_array()
        .cloned()
        .ok_or_else(invalid_message_evidence)?;
    if events.is_empty() {
        return Err(StatusCode::NOT_FOUND.into_response());
    }
    if events.len() != 1 {
        return Err(invalid_message_evidence());
    }
    let event = channel_message_event(events.remove(0), channel)?;
    if event.id.to_hex() != id {
        return Err(invalid_message_evidence());
    }
    Ok(event)
}

async fn resolve_message_parent(
    state: &BffState,
    client: &IdentityClient,
    channel: &str,
    parent_id: &str,
    message_type: &contracts::WebMessageType,
) -> Result<(String, String), Response> {
    let parent = read_message_event(state, client, channel, parent_id).await?;
    let root_id = parse_thread_markers(&parent.tags)
        .resolve()
        .map_or_else(|| parent.id.to_hex(), |(root, _)| root);
    let root = if root_id == parent_id {
        parent
    } else {
        read_message_event(state, client, channel, &root_id).await?
    };
    if parse_thread_markers(&root.tags).resolve().is_some()
        || root.kind.as_u16() == message_kind(&contracts::WebMessageType::ForumComment)
        || *message_type == contracts::WebMessageType::ForumComment
            && root.kind.as_u16() != message_kind(&contracts::WebMessageType::ForumPost)
    {
        return Err(StatusCode::BAD_REQUEST.into_response());
    }
    Ok((root_id, parent_id.to_owned()))
}

async fn publish(
    state: BffState,
    target: MessageTarget,
    headers: HeaderMap,
    publication: Publication,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let action_key = match &publication {
        Publication::Message(_) | Publication::Pulse(_) => target.action(),
        Publication::Hide => CONVERSATION_HIDE_ACTION,
        Publication::Reopen => CONVERSATION_REOPEN_ACTION,
    };
    let (message_type, parent_event_id, edit_event_id) = match &publication {
        Publication::Message(req) => (
            req.message_type
                .clone()
                .unwrap_or(contracts::WebMessageType::Stream),
            req.parent_event_id.clone(),
            req.edit_event_id.clone(),
        ),
        Publication::Pulse(req) => (
            contracts::WebMessageType::Stream,
            req.target_event_id.clone(),
            None,
        ),
        Publication::Hide | Publication::Reopen => (contracts::WebMessageType::Stream, None, None),
    };
    if edit_event_id.is_none() && !valid_message_intent(&message_type, parent_event_id.as_deref())
        || edit_event_id.as_deref().is_some_and(|id| {
            nostr::EventId::from_hex(id).map_or(true, |parsed| parsed.to_hex() != id)
                || parent_event_id.is_some()
        })
        || matches!(target, MessageTarget::Conversation(_))
            && message_type != contracts::WebMessageType::Stream
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let requested_kind = if let Publication::Pulse(req) = &publication {
        match crate::pulse::publication_kind(req) {
            Ok(kind) => i32::from(kind),
            Err(e) => return e,
        }
    } else if edit_event_id.is_some() {
        KIND_STREAM_MESSAGE_EDIT as i32
    } else {
        i32::from(message_kind(&message_type))
    };
    if let Publication::Message(request) = &publication {
        if edit_event_id.is_some()
            && request.content.trim().is_empty()
            && request.attachments.as_ref().is_none_or(Vec::is_empty)
        {
            return StatusCode::BAD_REQUEST.into_response();
        }
    }

    // 幂等键由调用方为「这一次发送意图」生成，重发时带同一个键（DD-81）。
    // 缺失即拒绝：没有它，结果不明后的重发只能再发一条。
    let Some(idempotency_key) = headers
        .get("idempotency-key")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<Uuid>().ok())
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let (channel_id, community_host) = match target.admit(&state, &ctx).await {
        Ok(s) => s,
        Err(r) => return r,
    };

    let mention_ids = match mention_targets(match &publication {
        Publication::Message(req) => req.mention_installation_ids.as_deref(),
        Publication::Hide | Publication::Reopen | Publication::Pulse(_) => None,
    }) {
        Some(ids) => ids,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };

    // 同一个键已经发过：不再发，回答那次的结论。只有确定未送达才允许重新发送。
    #[derive(sqlx::FromRow)]
    struct PreviousPublish {
        operation_id: Uuid,
        event_id: String,
        result: Option<String>,
        mention_installation_ids: Vec<Uuid>,
        target_ids: Vec<Option<Uuid>>,
        message_kind: i32,
        parent_event_id: Option<String>,
        edit_event_id: Option<String>,
    }
    let previous = match sqlx::query_as::<_, PreviousPublish>(
        r#"select a.operation_id, a.event_id, a.mention_installation_ids, a.message_kind, a.parent_event_id, a.edit_event_id,
                  array(select r.target_id from audit.audit_event r
                    where r.operation_id=a.operation_id and r.event_type='DISPATCH'
                      and r.action_key=$3 and r.target_type=$4
                      and r.workspace_id is not distinct from $5) as target_ids,
                  (select r.result_code from audit.audit_event r
                    where r.operation_id = a.operation_id
                      and r.event_type in ('OUTCOME', 'RECONCILIATION')
                    order by r.occurred_at desc limit 1) as result
           from admission.publish_attempt a
           where a.tenant_principal_id = $1 and a.idempotency_key = $2"#,
    )
    .bind(ctx.tenant_principal_id)
    .bind(idempotency_key)
    .bind(action_key)
    .bind(target.target_type())
    .bind(target.workspace_id())
    .fetch_optional(&state.pool)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(error = %e, "读取发布幂等记录失败");
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::DependencyUnavailable,
                None,
            );
        }
    };
    if let Some(p) = &previous {
        if !publish_scope_matches(&p.target_ids, target.id())
            || !mention_intent_matches(&p.mention_installation_ids, &mention_ids)
            || p.message_kind != requested_kind
            || p.parent_event_id != parent_event_id
            || p.edit_event_id != edit_event_id
        {
            return StatusCode::CONFLICT.into_response();
        }
        match p.result.as_deref() {
            Some("ACCEPTED") => {
                return (
                    StatusCode::OK,
                    Json(PublishResponse {
                        event_id: p.event_id.clone(),
                        operation_id: p.operation_id,
                    }),
                )
                    .into_response();
            }
            Some("REJECTED") => {
                return error_body(
                    StatusCode::FORBIDDEN,
                    ErrorClass::Denied,
                    ReasonCode::PublishRejected,
                    Some(p.operation_id),
                );
            }
            Some("NOT_DELIVERED") => {}
            // 还没有结论：仍是那一次的结果不明，不能再发一条
            _ => {
                return error_body(
                    StatusCode::SERVICE_UNAVAILABLE,
                    ErrorClass::Unknown,
                    ReasonCode::PublishResultUnknown,
                    Some(p.operation_id),
                );
            }
        }
    }

    // Installations belong to Workspaces. A private human conversation cannot
    // borrow their authorization or trigger an Agent from another scope.
    let mentions_result = match target {
        MessageTarget::Workspace(id) => resolve_mentions(&state, &ctx, id, &mention_ids).await,
        MessageTarget::Conversation(_) | MessageTarget::Pulse(_) if mention_ids.is_empty() => {
            Ok(Vec::new())
        }
        MessageTarget::Conversation(_) | MessageTarget::Pulse(_) => {
            Err(StatusCode::BAD_REQUEST.into_response())
        }
    };
    let mentions = match mentions_result {
        Ok(keys) => keys,
        Err(response) => return response,
    };

    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match community_client(&state, &keys, &community_host) {
        Ok(c) => c,
        Err(r) => return r,
    };

    let mut content = String::new();
    let mut media_tags = Vec::new();
    let message = match &publication {
        Publication::Message(req) => Some((&req.content, req.attachments.as_deref())),
        Publication::Pulse(req) => Some((&req.content, req.attachments.as_deref())),
        Publication::Hide | Publication::Reopen => None,
    };
    if let Some((text, attachments)) = message {
        content.push_str(text);
        for a in attachments.unwrap_or_default() {
            let Some((line, tag)) = a.render(&community_host) else {
                return StatusCode::BAD_REQUEST.into_response();
            };
            content.push_str(&line);
            media_tags.push(tag);
        }
    }

    // 大小上界在发往 Relay 之前预检（`.design/09`：单 event content 不超过 256 KiB；
    // `apps/07` §5：BFF 侧先行设界）。超限是确定的 LIMIT：不签名、不落 DISPATCH、
    // 不占 Relay 的额度。按字节计，与 Relay 的 `content.len()` 同一口径。
    if content.len() > state.message_max_content_bytes {
        tracing::info!(
            size = content.len(),
            max = state.message_max_content_bytes,
            "消息正文超过登记上界"
        );
        return error_body(
            StatusCode::PAYLOAD_TOO_LARGE,
            ErrorClass::Limit,
            ReasonCode::PayloadTooLarge,
            None,
        );
    }

    // 运行期 NIP-11 与 binding 快照一致才发：对不上说明 Relay 的上界已变而 binding
    // 未重新查证，不能沿用旧快照继续写入（`.design/09`「BFF Relay 连接模型」）
    if let Err(c) = community_limits(&state, &community_host).await {
        return c.into_response();
    }

    // The browser selects a semantic target, never its author, channel or tags.
    // Read the original signed event through the already admitted actor, then
    // let Relay recheck native edit ownership at ingestion as well.
    let edit_target = match edit_event_id.as_deref() {
        Some(id) => {
            let event = match read_message_event(&state, &client, &channel_id, id).await {
                Ok(event) => event,
                Err(response) => return response,
            };
            if event.pubkey != keys.public_key() {
                return error_body(
                    StatusCode::FORBIDDEN,
                    ErrorClass::Denied,
                    ReasonCode::PermissionDenied,
                    None,
                );
            }
            if event.kind.as_u16() != message_kind(&message_type) {
                return StatusCode::BAD_REQUEST.into_response();
            }
            Some(event)
        }
        None => None,
    };

    let pulse_tags = if let Publication::Pulse(req) = &publication {
        match crate::pulse::publication_tags(&state, &client, req, &media_tags).await {
            Ok(tags) => Some(tags),
            Err(e) => return e,
        }
    } else {
        None
    };
    let ancestry = match parent_event_id.as_deref().filter(|_| pulse_tags.is_none()) {
        Some(parent) => {
            match resolve_message_parent(&state, &client, &channel_id, parent, &message_type).await
            {
                Ok(ancestry) => Some(ancestry),
                Err(response) => return response,
            }
        }
        None => None,
    };
    // A reply lookup is external I/O. Do not sign with admission or a key
    // revoked while its parent was being read.
    let current_scope = match target.admit(&state, &ctx).await {
        Ok(scope) => scope,
        Err(response) => return response,
    };
    let current_keys = match actor_keys(&state, &ctx).await {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    if current_scope != (channel_id.clone(), community_host.clone())
        || keys.public_key() != current_keys.public_key()
    {
        return AdmissionFailure::BindingNotActive.into_response();
    }

    // 预算在落 DISPATCH 之前取：取不到就既不落账也不发送，请求不打到 Relay
    let admitted = match client.admit() {
        Ok(a) => a,
        Err(e) => return relay_error_response(&e, None),
    };

    // 先签名：event id 在签完时就确定。把它连同 actor、scope、operation 落进
    // DISPATCH 审计之后才发送——之后无论结果如何，这条消息动作都可关联
    // （Stage 1 退出门禁），结果不明时也有一个能去 Relay 查证的键（DD-81）。
    let signed = match publication {
        Publication::Message(_) if edit_target.is_some() => client.sign_message_edit(
            edit_target.as_ref().expect("edit target checked"),
            &content,
            &media_tags,
            &mentions,
        ),
        Publication::Message(_) => client.sign_channel_message_kind(
            &channel_id,
            &content,
            &media_tags,
            &mentions,
            &message_type,
            ancestry
                .as_ref()
                .map(|(root, parent)| (root.as_str(), parent.as_str())),
        ),
        Publication::Pulse(_) => client.sign(
            requested_kind as u16,
            &content,
            pulse_tags.as_deref().unwrap_or_default(),
        ),
        // Original Buzz DM commands, never caller-selected raw kinds/tags.
        Publication::Hide => client.sign(41012, "", &[vec!["h".into(), channel_id.clone()]]),
        Publication::Reopen => client.sign(41010, "", &[vec!["h".into(), channel_id.clone()]]),
    };
    let event = match signed {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(error = %e, "签名失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let event_id = event.id.to_hex();
    let operation_id = Uuid::new_v4();
    let entry = |event_type: &'static str, event_key: String, result_code: &'static str| {
        AuditEntry {
            event_key,
            tenant_id: Some(ctx.tenant_id),
            workspace_id: target.workspace_id(),
            operation_id,
            event_type,
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key,
            action_version: 1,
            component_type_key: "buzz",
            target_type: Some(target.target_type()),
            target_id: Some(target.id()),
            // 正文不进审计。摘要也不进：它对正文可做字典攻击，而审计要的是
            // 「谁在哪里做了什么」，不是「说了什么」（`.design/03` §9）。
            parameter_hash: "NONE",
            decision: "ALLOW",
            result_code,
            result_exposure: "NONE",
            evidence_refs: vec![
                Evidence::new(EvidenceKind::BuzzEventId, &event_id),
                Evidence::new(EvidenceKind::PlatformSessionId, ctx.session_id),
            ],
            correlation_id: operation_id,
        }
    };

    // 没落账就不发：一条发出去却无从关联的消息，正是「成功但不可核验」。
    // 幂等记录与 DISPATCH 同一事务：两者只能一起成立。
    enum Claim {
        Acquired,
        Pending,
        TargetMismatch,
    }
    let dispatched: Result<Claim, sqlx::Error> = async {
        let mut tx = state.pool.begin().await?;
        let claimed = match &previous {
            // 上一次确定未送达：把这个键改指向新的一次，条件是它仍指向上一次
            Some(p) => sqlx::query!(
                "update admission.publish_attempt
                 set operation_id = $3, event_id = $4, created_at = now()
                 where tenant_principal_id = $1 and idempotency_key = $2 and operation_id = $5",
                ctx.tenant_principal_id,
                idempotency_key,
                operation_id,
                event_id,
                p.operation_id,
            )
            .execute(&mut *tx)
            .await?
            .rows_affected(),
            None => sqlx::query(
                "insert into admission.publish_attempt
                     (tenant_principal_id, idempotency_key, operation_id, event_id, mention_installation_ids, message_kind, parent_event_id, edit_event_id)
                 values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict do nothing"
            )
            .bind(ctx.tenant_principal_id)
            .bind(idempotency_key)
            .bind(operation_id)
            .bind(&event_id)
            .bind(&mention_ids)
            .bind(requested_kind)
            .bind(&parent_event_id)
            .bind(&edit_event_id)
            .execute(&mut *tx)
            .await?
            .rows_affected(),
        };
        if claimed == 0 {
            // 同一个键的另一次请求抢先了：那一次在发，这一次不发
            #[derive(sqlx::FromRow)]
            struct ConcurrentPublish {
                mention_installation_ids: Vec<Uuid>,
                message_kind: i32,
                parent_event_id: Option<String>,
                edit_event_id: Option<String>,
                target_ids: Vec<Option<Uuid>>,
            }
            let frozen: ConcurrentPublish = sqlx::query_as(
                "select a.mention_installation_ids, a.message_kind, a.parent_event_id, a.edit_event_id,
                    array(select r.target_id from audit.audit_event r
                      where r.operation_id=a.operation_id and r.event_type='DISPATCH'
                        and r.action_key=$3 and r.target_type=$4
                        and r.workspace_id is not distinct from $5) as target_ids
                 from admission.publish_attempt a
                 where a.tenant_principal_id=$1 and a.idempotency_key=$2")
                .bind(ctx.tenant_principal_id).bind(idempotency_key)
                .bind(action_key).bind(target.target_type()).bind(target.workspace_id())
                .fetch_one(&mut *tx).await?;
            return Ok(if publish_scope_matches(&frozen.target_ids, target.id())
                && mention_intent_matches(&frozen.mention_installation_ids, &mention_ids)
                && frozen.message_kind == requested_kind && frozen.parent_event_id == parent_event_id
                && frozen.edit_event_id == edit_event_id
                { Claim::Pending } else { Claim::TargetMismatch });
        }
        append(
            &mut tx,
            entry(
                "DISPATCH",
                format!("message.publish:{event_id}:dispatch"),
                "DISPATCHED",
            ),
        )
        .await?;
        tx.commit().await?;
        Ok(Claim::Acquired)
    }
    .await;
    match dispatched {
        Ok(Claim::Acquired) => {}
        Ok(Claim::TargetMismatch) => return StatusCode::CONFLICT.into_response(),
        Ok(Claim::Pending) => {
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Unknown,
                ReasonCode::PublishResultUnknown,
                None,
            );
        }
        Err(e) => {
            tracing::warn!(error = %e, "发布前审计未写入，不发送");
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::DependencyUnavailable,
                None,
            );
        }
    }

    match client.deliver(&state.http, &event, admitted).await {
        Delivery::Accepted => {
            // 结果写不进去不改变「已送达」：DISPATCH 已在，兜底对账按 event id
            // 查到它后补记（publish_reconcile）
            if let Err(e) = record(
                &state,
                entry("OUTCOME", format!("message.publish:{event_id}"), "ACCEPTED"),
            )
            .await
            {
                tracing::warn!(error = %e, "发布结果审计未写入，留给对账");
            }
            (
                StatusCode::OK,
                Json(PublishResponse {
                    event_id,
                    operation_id,
                }),
            )
                .into_response()
        }
        Delivery::Rejected(why) => {
            tracing::warn!(reason = %why, "Relay 拒绝发布");
            if let Err(e) = record(
                &state,
                entry("OUTCOME", format!("message.publish:{event_id}"), "REJECTED"),
            )
            .await
            {
                tracing::warn!(error = %e, "发布结果审计未写入，留给对账");
            }
            error_body(
                StatusCode::FORBIDDEN,
                ErrorClass::Denied,
                ReasonCode::PublishRejected,
                Some(operation_id),
            )
        }
        // Relay 在读取事件之前以 429/413 拒绝：确定未落库。结果记 NOT_DELIVERED——
        // 同一个幂等键按策略重发时允许再发（上面的幂等分支），而不是记成不可重试的
        // REJECTED；回应是 LIMIT，不是 DENIED（`apps/06` §4）。
        Delivery::Limited(kind, why) => {
            tracing::warn!(reason = %why, "Relay 以上界拒绝发布");
            if let Err(e) = record(
                &state,
                entry(
                    "OUTCOME",
                    format!("message.publish:{event_id}"),
                    "NOT_DELIVERED",
                ),
            )
            .await
            {
                tracing::warn!(error = %e, "发布结果审计未写入，留给对账");
            }
            limit_response(kind, None, Some(operation_id))
        }
        // 结果不明：不写结果、不重发，交给对账（DD-81）。调用方拿到 operation
        // id，界面显示待确认而不是成功或失败（06 §4）。
        Delivery::Unknown(why) => {
            tracing::warn!(error = %why, "发布结果不明");
            error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Unknown,
                ReasonCode::PublishResultUnknown,
                Some(operation_id),
            )
        }
    }
}

pub(crate) async fn record(state: &BffState, entry: AuditEntry<'_>) -> Result<(), sqlx::Error> {
    let mut tx = state.pool.begin().await?;
    append(&mut tx, entry).await?;
    tx.commit().await
}

pub(crate) fn error_body(
    status: StatusCode,
    class: ErrorClass,
    reason: ReasonCode,
    operation_id: Option<Uuid>,
) -> Response {
    (
        status,
        Json(ErrorBody {
            class,
            reason,
            operation_id: operation_id.map(|o| o.to_string()),
        }),
    )
        .into_response()
}

/// `LIMIT` 类回应（`apps/06` §4）。Core 预算给出重置时刻时带 `Retry-After`。
pub(crate) fn limit_response(
    kind: LimitKind,
    retry_after: Option<u64>,
    operation_id: Option<Uuid>,
) -> Response {
    let (status, reason) = match kind {
        LimitKind::RateLimited => (StatusCode::TOO_MANY_REQUESTS, ReasonCode::RateLimited),
        LimitKind::PayloadTooLarge => (StatusCode::PAYLOAD_TOO_LARGE, ReasonCode::PayloadTooLarge),
        // 订阅容量只出现在 stream 上，那里在带内表达；HTTP 路径到这里说明
        // 上游给了一个本侧没有登记的上界，按依赖不可用处理
        LimitKind::Capacity => {
            return error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::DependencyUnavailable,
                operation_id,
            );
        }
    };
    let mut response = error_body(status, ErrorClass::Limit, reason, operation_id);
    if let Some(secs) = retry_after {
        if let Ok(v) = axum::http::HeaderValue::from_str(&secs.to_string()) {
            response
                .headers_mut()
                .insert(axum::http::header::RETRY_AFTER, v);
        }
    }
    response
}

/// 发往 Relay 的请求失败时的回应：LIMIT 类按上界分类，其余是依赖不可用。
/// 用于没有外部副作用的读取与发送前的预算检查；发布结果另有三态处理。
pub(crate) fn relay_error_response(e: &OperatorError, operation_id: Option<Uuid>) -> Response {
    match e.limit() {
        Some(kind) => limit_response(kind, e.retry_after_secs(), operation_id),
        None => error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorClass::Precondition,
            ReasonCode::DependencyUnavailable,
            operation_id,
        ),
    }
}

/// 运行期 NIP-11 核对不成立的两种情形。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RelayCheck {
    /// 读不到 binding（Core 库不可用）
    Unavailable,
    /// 运行期抓不到 NIP-11（含缓存过期后重抓失败）。DD-114(1)：只使该次请求以
    /// `BINDING_NOT_ACTIVE` fail closed，不迁移状态——传输失败不是不一致的证据
    Nip11Unavailable,
    /// 读到的文档 digest 与 ACTIVE binding 的快照不一致
    Mismatch,
}

impl RelayCheck {
    /// 流上的关闭原因（带内表达，见 `stream::closed_in_band`）
    pub fn stream_reason(self) -> &'static str {
        match self {
            RelayCheck::Unavailable | RelayCheck::Nip11Unavailable => "upstream-unavailable",
            RelayCheck::Mismatch => "binding-not-active",
        }
    }
}

impl IntoResponse for RelayCheck {
    fn into_response(self) -> Response {
        let reason = match self {
            RelayCheck::Unavailable => ReasonCode::DependencyUnavailable,
            RelayCheck::Nip11Unavailable | RelayCheck::Mismatch => ReasonCode::BindingNotActive,
        };
        error_body(
            StatusCode::SERVICE_UNAVAILABLE,
            ErrorClass::Precondition,
            reason,
            None,
        )
    }
}

/// 运行期读取该 Community 的 NIP-11，并与 ACTIVE TenantBuzzBinding 的快照比对。
///
/// `.design/03` §2：运行连接不得使用超出 ACTIVE binding 快照声明值的订阅、filter、limit
/// 或 frame 合同；`.design/09`：digest 不一致时不能沿用未验证的旧上界。于是只有读到的
/// 文档与快照逐字节同一（canonical digest 相等）时，才把它的上界交给调用方——那就是
/// 快照声明的值。读不到文档或 binding 都 fail closed，不回退到任何缺省上界。
///
/// binding 状态本身（进入 `RECONCILING`）由 Tenant 生命周期的查证负责；这里只保证
/// 对不上时不再以旧上界发出新的订阅、查询与写入。
/// Tenant-scoped collaboration (such as one's own kind:0) uses the same
/// ACTIVE binding/NIP-11 check without inventing a Workspace or Channel.
pub(crate) async fn community_limits(
    state: &BffState,
    community_host: &str,
) -> Result<RelayLimits, RelayCheck> {
    let snapshot: Option<Option<String>> = sqlx::query_scalar(
        "select nip11_snapshot_digest from projection.tenant_buzz_binding
         where normalized_host = $1 and state = 'ACTIVE'",
    )
    .bind(community_host)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "读 binding 的 NIP-11 快照失败");
        RelayCheck::Unavailable
    })?;
    let doc = state
        .relay_nip11
        .get(&state.http, community_host)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, host = %community_host, "运行期读取 NIP-11 失败");
            RelayCheck::Nip11Unavailable
        })?;
    match snapshot.flatten() {
        Some(expected) if expected == doc.digest => Ok(doc.limits.clone()),
        Some(expected) => {
            tracing::warn!(
                host = %community_host,
                expected = %expected,
                observed = %doc.digest,
                "运行期 NIP-11 与 binding 快照不一致"
            );
            Err(RelayCheck::Mismatch)
        }
        None => Err(RelayCheck::Mismatch),
    }
}

/// Read a profile only for the author proven by an admitted signed message.
pub async fn message_author_profile(
    State(state): State<BffState>,
    Path((workspace_id, event_id)): Path<(Uuid, String)>,
    headers: HeaderMap,
) -> Response {
    message_author_profile_for(
        state,
        MessageTarget::Workspace(workspace_id),
        headers,
        event_id,
    )
    .await
}

pub async fn conversation_message_author_profile(
    State(state): State<BffState>,
    Path((conversation_id, event_id)): Path<(Uuid, String)>,
    headers: HeaderMap,
) -> Response {
    message_author_profile_for(
        state,
        MessageTarget::Conversation(conversation_id),
        headers,
        event_id,
    )
    .await
}

async fn message_author_profile_for(
    state: BffState,
    target: MessageTarget,
    headers: HeaderMap,
    event_id: String,
) -> Response {
    if nostr::EventId::from_hex(&event_id).is_err() {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let read_target = match target {
        MessageTarget::Workspace(id) => crate::user_state::ReadTarget::Workspace(id),
        MessageTarget::Conversation(id) => crate::user_state::ReadTarget::Conversation(id),
        MessageTarget::Pulse(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let admitted = match read_target.admit(&state, &ctx).await {
        Ok(scope) => scope,
        Err(response) => return response,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    let client = match community_client(&state, &keys, admitted.community_host()) {
        Ok(client) => client,
        Err(response) => return response,
    };
    // The original signed event proves this author belongs to this readable
    // message surface. Neither a requested pubkey nor the Pulse directory does.
    let message = match read_message_event(&state, &client, admitted.channel_id(), &event_id).await
    {
        Ok(message) => message,
        Err(response) => return response,
    };
    let author = message.pubkey.to_hex();
    let profile = match crate::web_profile::read_author(&state, &client, &author).await {
        Ok(profile) => profile,
        Err(response) => return response,
    };
    let current = match read_target.admit(&state, &ctx).await {
        Ok(scope) => scope,
        Err(response) => return response,
    };
    let current_keys = match actor_keys(&state, &ctx).await {
        Ok(keys) => keys,
        Err(response) => return response,
    };
    if !admitted.same_admission(&current) || current_keys.public_key() != keys.public_key() {
        return AdmissionFailure::BindingNotActive.into_response();
    }
    let mut view = crate::web_profile::view(author, profile.as_ref(), admitted.community_host());
    let media_prefix = match target {
        MessageTarget::Workspace(id) => format!("/api/v1/workspaces/{id}/media/"),
        MessageTarget::Conversation(id) => format!("/api/v1/conversations/{id}/media/"),
        MessageTarget::Pulse(_) => return StatusCode::BAD_REQUEST.into_response(),
    };
    for path in view.avatar_media_paths.values_mut() {
        if let Some(hash) = path.strip_prefix("/api/v1/profile/media/") {
            *path = format!("{media_prefix}{hash}");
        }
    }
    (
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(view),
    )
        .into_response()
}

/// History filters are constructed by Core, never arbitrary browser filters (DD-39).
pub async fn query_messages(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<contracts::WebMessageQuery>,
) -> Response {
    query_messages_for(
        state,
        MessageTarget::Workspace(workspace_id),
        headers,
        query,
    )
    .await
}

pub async fn query_conversation_messages(
    State(state): State<BffState>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
    Query(query): Query<contracts::WebMessageQuery>,
) -> Response {
    query_messages_for(
        state,
        MessageTarget::Conversation(conversation_id),
        headers,
        query,
    )
    .await
}

async fn query_messages_for(
    state: BffState,
    target: MessageTarget,
    headers: HeaderMap,
    query: contracts::WebMessageQuery,
) -> Response {
    let cursor = match message_query_cursor(&query) {
        Ok(cursor) => cursor,
        Err(response) => return response,
    };
    let message_type = query
        .message_type
        .unwrap_or(contracts::WebMessageType::Stream);
    if !valid_message_intent(&message_type, query.parent_event_id.as_deref())
        || matches!(target, MessageTarget::Conversation(_))
            && message_type != contracts::WebMessageType::Stream
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let (channel_id, community_host) = match target.admit(&state, &ctx).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match community_client(&state, &keys, &community_host) {
        Ok(c) => c,
        Err(r) => return r,
    };

    let limits = match community_limits(&state, &community_host).await {
        Ok(l) => l,
        Err(c) => return c.into_response(),
    };

    // Original Forum posts and NIP-10 threads use the same admitted native
    // event page; no second Forum projection or body store is created.
    let mut root_event = None;
    let mut cap = page_limit(&state, &limits);
    let mut filter = serde_json::json!({"kinds":[message_kind(&message_type)], "#h":[channel_id]});
    let author = if query.parent_event_id.is_none()
        && message_type != contracts::WebMessageType::ForumComment
    {
        let author = match window_author(&state, &ctx, &community_host).await {
            Ok(author) => author,
            Err(response) => return response,
        };
        cap = cap.min(i64::from(collab_bridge::bridge::BRIDGE_WINDOW_MAX_LIMIT));
        filter["top_level"] = true.into();
        filter["include_summaries"] = true.into();
        filter["include_aux"] = true.into();
        Some(author)
    } else {
        None
    };
    if let Some(root_id) = query.parent_event_id.as_deref() {
        let root = match read_message_event(&state, &client, &channel_id, root_id).await {
            Ok(root) => root,
            Err(response) => return response,
        };
        if parse_thread_markers(&root.tags).resolve().is_some()
            || root.kind.as_u16() == message_kind(&contracts::WebMessageType::ForumComment)
            || message_type == contracts::WebMessageType::ForumComment
                && root.kind.as_u16() != message_kind(&contracts::WebMessageType::ForumPost)
        {
            return StatusCode::BAD_REQUEST.into_response();
        }
        root_event = Some(root);
        cap = cap.min(i64::from(collab_bridge::bridge::BRIDGE_THREAD_MAX_LIMIT));
        filter["kinds"] = serde_json::json!([
            message_kind(&contracts::WebMessageType::Stream),
            message_kind(&contracts::WebMessageType::ForumComment)
        ]);
        filter["#e"] = serde_json::json!([root_id]);
        filter["depth_limit"] = collab_bridge::bridge::DEFAULT_THREAD_DEPTH_LIMIT.into();
        filter["include_aux"] = true.into();
    }
    filter["limit"] = cap.into();
    if let Some(cursor) = &cursor {
        if root_event.is_some() {
            filter["thread_cursor"] = cursor.created_at.into();
            filter["thread_cursor_id"] = cursor.event_id.clone().into();
        } else {
            filter["until"] = cursor.created_at.into();
            filter["before_id"] = cursor.event_id.clone().into();
        }
    }
    let mut filters = vec![filter];
    if let Some(root) = &root_event {
        // Native thread aux covers replies, not its separately fetched head.
        // Fetch the head's latest author-signed overlay in the same admitted
        // request so reopening a thread cannot resurrect pre-edit content.
        filters.push(serde_json::json!({
            "kinds": [KIND_STREAM_MESSAGE_EDIT], "#h": [channel_id],
            "#e": [root.id.to_hex()], "authors": [root.pubkey.to_hex()], "limit": 1,
        }));
    }
    match client.query(&state.http, &filters).await {
        Ok(events) => {
            let events = match serde_json::from_value(events) {
                Ok(events) => events,
                Err(_) => return invalid_message_evidence(),
            };
            let (mut verified, next_cursor) = match verify_message_page(
                events,
                &channel_id,
                &message_type,
                query.parent_event_id.as_deref(),
                cursor.as_ref(),
                author.as_ref().map(|(_, key)| key.as_str()),
                cap,
            ) {
                Ok(page) => page,
                Err(response) => return response,
            };
            if let Some(root) = root_event {
                verified.insert(0, root);
            }
            let current = match target.admit(&state, &ctx).await {
                Ok(scope) => scope,
                Err(response) => return response,
            };
            let current_keys = match actor_keys(&state, &ctx).await {
                Ok(keys) => keys,
                Err(response) => return response,
            };
            if current != (channel_id, community_host)
                || current_keys.public_key() != keys.public_key()
            {
                return AdmissionFailure::BindingNotActive.into_response();
            }
            if let Some(author) = author {
                match window_author(&state, &ctx, &current.1).await {
                    Ok(observed) if observed == author => {}
                    _ => return AdmissionFailure::BindingNotActive.into_response(),
                }
            }
            (
                StatusCode::OK,
                Json(QueryResponse {
                    events: serde_json::json!(verified),
                    next_cursor,
                }),
            )
                .into_response()
        }
        Err(e) => {
            tracing::warn!(error = %e, "查询历史失败");
            relay_error_response(&e, None)
        }
    }
}

/// 单页上界：部署登记值与 NIP-11 `max_limit` 的交集。
pub fn page_limit(state: &BffState, limits: &RelayLimits) -> i64 {
    state.message_page_limit.min(limits.max_limit)
}

/// 一次 Workspace 准入通过后确定下来的事实。
pub struct WorkspaceScope {
    pub channel_id: String,
    pub community_host: String,
    /// 记录目录/管理准入的真实依据；协作读写还必须确认是 Membership。
    pub admission_epoch: WorkspaceAdmissionEpoch,
}

/// scope 的准入依据及其 Core 事实版本。依据改变也使旧 stream generation 失效。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WorkspaceAdmissionEpoch {
    Membership {
        tenant_version: i32,
        workspace_version: i32,
        membership_id: Uuid,
        version: i32,
    },
    WorkspaceManage {
        tenant_version: i32,
        workspace_version: i32,
    },
    TenantManage {
        tenant_version: i32,
        workspace_version: i32,
        membership_id: Uuid,
        membership_version: i32,
    },
}

impl WorkspaceAdmissionEpoch {
    pub(crate) fn is_member(&self) -> bool {
        matches!(self, Self::Membership { .. })
    }
}

/// HUMAN 的 Workspace scope guard（`.design/03` §2、`DD-41/46`）。
///
/// 协作读写必须是实际成员；管理可见性不代表原生 Channel roster 参与资格。
pub async fn admit_workspace(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Uuid,
) -> Result<WorkspaceScope, Response> {
    admit_collaboration_workspace_scope(state, ctx, workspace_id)
        .await
        .map_err(IntoResponse::into_response)
}

pub(crate) async fn admit_collaboration_workspace_scope(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Uuid,
) -> Result<WorkspaceScope, AdmissionFailure> {
    let scope = admit_workspace_scope(state, ctx, workspace_id).await?;
    if !scope.admission_epoch.is_member() {
        return Err(AdmissionFailure::Denied);
    }
    Ok(scope)
}

/// Workspace 准入不通过的三种情形。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdmissionFailure {
    /// 身份、成员、Tenant 或 Workspace 状态不满足；与「不存在」同一个回答
    Denied,
    /// 调用方本可进入，但该 Workspace 的 Buzz binding 不是 ACTIVE（DD-114(2)：
    /// TenantBuzzBinding 因 NIP-11 漂移处于 RECONCILING 等）。这是可恢复的前置条件，
    /// 不是撤权
    BindingNotActive,
    /// Core 库或 fresh 授权依赖不可判定
    Unavailable,
}

impl IntoResponse for AdmissionFailure {
    fn into_response(self) -> Response {
        match self {
            AdmissionFailure::Denied => error_body(
                StatusCode::FORBIDDEN,
                ErrorClass::Denied,
                ReasonCode::PermissionDenied,
                None,
            ),
            AdmissionFailure::BindingNotActive => error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::BindingNotActive,
                None,
            ),
            AdmissionFailure::Unavailable => error_body(
                StatusCode::SERVICE_UNAVAILABLE,
                ErrorClass::Precondition,
                ReasonCode::DependencyUnavailable,
                None,
            ),
        }
    }
}

#[derive(sqlx::FromRow)]
struct WorkspaceAdmissionRow {
    workspace_id: Uuid,
    tenant_version: i32,
    workspace_version: i32,
    membership_id: Option<Uuid>,
    membership_state: Option<String>,
    membership_version: Option<i32>,
}

/// 列表、Relay 准入与用户状态共用的 HUMAN scope 资格（不包含 Buzz binding）。
///
/// 先限制同 Tenant、ACTIVE Workspace/身份/会话，再按治理内核已有规则判定：
/// ACTIVE Membership；从未加入者的 fresh workspace.manage；存在非 ACTIVE
/// Membership 时还需 fresh tenant.manage，不能让残留 workspace#admin 绕过撤权。
/// 批量 Check 的不完整或未知结果使整次判定失败，不返回貌似完整的部分列表。
pub(crate) async fn workspace_admissions(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_ids: &[Uuid],
) -> Result<HashMap<Uuid, WorkspaceAdmissionEpoch>, AdmissionFailure> {
    let rows: Vec<WorkspaceAdmissionRow> = sqlx::query_as(
        "select w.id as workspace_id, t.version as tenant_version,
                w.version as workspace_version,
                wm.id as membership_id, wm.state as membership_state,
                wm.version as membership_version
         from identity.workspace w
         join identity.tenant t on t.id = w.tenant_id and t.state = 'ACTIVE'
         join identity.principal p
           on p.id = $2 and p.tenant_id = t.id and p.kind = 'HUMAN' and p.status = 'ACTIVE'
         join identity.tenant_membership tm
           on tm.tenant_principal_id = p.id and tm.tenant_id = t.id and tm.state = 'ACTIVE'
         join identity.human_identity h
           on h.id = tm.human_identity_id and h.id = $5 and h.status = 'ACTIVE'
         join identity.platform_session s
           on s.id = $4 and s.tenant_membership_id = tm.id and s.human_identity_id = h.id
          and s.status = 'ACTIVE' and s.expires_at > now()
         left join identity.workspace_membership wm
           on wm.workspace_id = w.id and wm.tenant_principal_id = p.id
         where w.id = any($1) and w.tenant_id = $3 and w.state = 'ACTIVE'",
    )
    .bind(workspace_ids)
    .bind(ctx.tenant_principal_id)
    .bind(ctx.tenant_id)
    .bind(ctx.session_id)
    .bind(ctx.human_identity_id)
    .fetch_all(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Workspace scope 资格查询失败");
        AdmissionFailure::Unavailable
    })?;
    let mut admitted = HashMap::new();
    let mut management = Vec::new();
    for WorkspaceAdmissionRow {
        workspace_id,
        tenant_version,
        workspace_version,
        membership_id,
        membership_state,
        membership_version,
    } in rows
    {
        match (
            membership_id,
            membership_state.as_deref(),
            membership_version,
        ) {
            (Some(membership_id), Some("ACTIVE"), Some(version)) => {
                admitted.insert(
                    workspace_id,
                    WorkspaceAdmissionEpoch::Membership {
                        tenant_version,
                        workspace_version,
                        membership_id,
                        version,
                    },
                );
            }
            (None, None, None) => {
                management.push((workspace_id, tenant_version, workspace_version, None))
            }
            (
                Some(membership_id),
                Some("PROVISIONING" | "REVOKING" | "REVOKED" | "ERROR"),
                Some(version),
            ) => management.push((
                workspace_id,
                tenant_version,
                workspace_version,
                Some((membership_id, version)),
            )),
            _ => return Err(AdmissionFailure::Unavailable),
        }
    }
    if management.is_empty() {
        return Ok(admitted);
    }
    let ids: Vec<String> = management
        .iter()
        .map(|(id, _, _, _)| id.to_string())
        .collect();
    let actor = ctx.tenant_principal_id.to_string();
    let managed = state
        .governance
        .spicedb
        .check_bulk("workspace", &ids, "manage", &actor)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "Workspace scope fresh manage 判定失败");
            AdmissionFailure::Unavailable
        })?;
    let tenant_manage = if management
        .iter()
        .any(|(id, _, _, membership)| membership.is_some() && managed.contains(&id.to_string()))
    {
        let tenant = ctx.tenant_id.to_string();
        state
            .governance
            .spicedb
            .check_bulk("tenant", std::slice::from_ref(&tenant), "manage", &actor)
            .await
            .map_err(|e| {
                tracing::warn!(error = %e, "Workspace scope fresh tenant manage 判定失败");
                AdmissionFailure::Unavailable
            })?
            .contains(&tenant)
    } else {
        false
    };
    for (workspace_id, tenant_version, workspace_version, membership) in management {
        if !managed.contains(&workspace_id.to_string()) {
            continue;
        }
        let epoch = match membership {
            None => WorkspaceAdmissionEpoch::WorkspaceManage {
                tenant_version,
                workspace_version,
            },
            Some((membership_id, membership_version)) if tenant_manage => {
                WorkspaceAdmissionEpoch::TenantManage {
                    tenant_version,
                    workspace_version,
                    membership_id,
                    membership_version,
                }
            }
            Some(_) => continue,
        };
        admitted.insert(workspace_id, epoch);
    }
    Ok(admitted)
}

/// [`admit_workspace`] 的类型化结果：stream 的开流与再准入需要区分「撤权」与
/// 「binding 暂不可用」，前者关流不再续，后者按重连间隔续。
pub async fn admit_workspace_scope(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace_id: Uuid,
) -> Result<WorkspaceScope, AdmissionFailure> {
    let admission_epoch = workspace_admissions(state, ctx, &[workspace_id])
        .await?
        .remove(&workspace_id)
        .ok_or(AdmissionFailure::Denied)?;
    let row: Option<(Option<Uuid>, Option<String>)> = sqlx::query_as(
        "select b.channel_id, t.normalized_host
         from identity.workspace w
         join identity.tenant tenant
           on tenant.id = w.tenant_id and tenant.state = 'ACTIVE'
         left join projection.workspace_buzz_binding b
           on b.workspace_id = w.id and b.state = 'ACTIVE'
         left join projection.tenant_buzz_binding t
           on t.tenant_id = w.tenant_id and t.state = 'ACTIVE'
         where w.id = $1 and w.tenant_id = $2 and w.state = 'ACTIVE'",
    )
    .bind(workspace_id)
    .bind(ctx.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "Workspace 准入查询失败");
        AdmissionFailure::Unavailable
    })?;

    // 资格已成立才区分 binding 前置条件；无权或不同 Tenant 的调用方在上面
    // 得到同一个 403。若 Workspace 在两次查询间离开 ACTIVE，仍是拒绝而非 binding 故障。
    let Some((channel_id, community_host)) = row else {
        return Err(AdmissionFailure::Denied);
    };
    let (Some(channel_id), Some(community_host)) = (channel_id, community_host) else {
        return Err(AdmissionFailure::BindingNotActive);
    };
    Ok(WorkspaceScope {
        channel_id: channel_id.to_string(),
        community_host,
        admission_epoch,
    })
}

/// 以该 HUMAN 的 BuzzIdentityBinding 构造代签客户端。
///
/// `custody=CLIENT` 的身份由原生端本机持钥直连 Relay，Core 手里没有那把钥匙。
/// 走到这里说明调用方是 Web 端而该身份是原生端托管——不拿别的身份凑合，
/// 当场拒绝（`DD-75`）。
/// 取该 HUMAN 的签名密钥。
///
/// 与构造 HTTP 客户端分开：实时订阅要用同一把钥匙另建 NIP-42 WebSocket 会话
/// （`.design/09` 第 4 步），两条路共用密钥取用与托管校验，不共用连接。
pub async fn actor_keys(state: &BffState, ctx: &ExecutionContext) -> Result<nostr::Keys, Response> {
    server_actor_keys(
        &state.pool,
        &state.secrets,
        ctx.tenant_id,
        ctx.tenant_principal_id,
    )
    .await
}

pub(crate) async fn server_actor_keys(
    pool: &sqlx::PgPool,
    secrets: &secret_store::SecretStore,
    tenant_id: Uuid,
    principal_id: Uuid,
) -> Result<nostr::Keys, Response> {
    // 只取 Web 的那一把：一个人还可能有原生设备的 CLIENT 身份（DD-77），
    // 那些私钥不在 Core 手里，也就不在这里的候选之内。每人至多一条非 REVOKED
    // 的 SERVER binding，由库里的部分唯一索引保证。
    let row = sqlx::query!(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state = 'ACTIVE'",
        tenant_id,
        principal_id,
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| {
        tracing::warn!(error = %e, "读 HUMAN binding 失败");
        StatusCode::SERVICE_UNAVAILABLE.into_response()
    })?
    .ok_or_else(|| {
        tracing::warn!(principal = %principal_id, "没有 ACTIVE 的 Web（SERVER）Buzz 身份");
        StatusCode::FORBIDDEN.into_response()
    })?;

    let secret = SecretRef {
        locator: row.private_key_secret_ref.unwrap_or_default(),
        version: row.private_key_secret_version.unwrap_or_default() as u32,
        audience: row.private_key_secret_audience.unwrap_or_default(),
    };
    crate::server_identity::read_bound_keys(secrets, &secret, &row.pubkey)
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, principal = %principal_id, "HUMAN 私钥不匹配或不可用");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })
}

#[allow(clippy::result_large_err)]
pub(crate) fn community_client(
    state: &BffState,
    keys: &nostr::Keys,
    community_host: &str,
) -> Result<IdentityClient, Response> {
    IdentityClient::new(
        Custody::Server,
        &keys.secret_key().to_secret_hex(),
        &state.relay_transport,
        community_host,
    )
    // BFF 发出的每次 HTTP bridge 调用都先过 Core 预算（`apps/07` §5）
    .map(|c| c.with_budget(std::sync::Arc::clone(&state.relay_budget)))
    .map_err(|e| {
        tracing::warn!(error = %e, "构造代签客户端失败");
        StatusCode::FORBIDDEN.into_response()
    })
}

/// 上传一份媒体到该 Workspace 的 Relay。
///
/// `DD-39`：Relay media 也由 BFF 以 actor identity 签名读写。Browser 不持
/// signer，因此 Blossom 授权事件只能由 Core 代签。
pub async fn upload_media(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    upload_media_for(state, MessageTarget::Workspace(workspace_id), headers, body).await
}

pub async fn upload_conversation_media(
    State(state): State<BffState>,
    Path(conversation_id): Path<Uuid>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    upload_media_for(
        state,
        MessageTarget::Conversation(conversation_id),
        headers,
        body,
    )
    .await
}

async fn upload_media_for(
    state: BffState,
    target: MessageTarget,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    // 大小上界在 BFF 侧先行设定，不把压力透传给 Relay（`07` §5）。
    // 超限是确定的拒绝，映射到 LIMIT 类，而不是让上游给一个不区分成因的错误。
    if body.len() as u64 > state.media_max_bytes {
        tracing::warn!(size = body.len(), "媒体超过登记上界");
        return StatusCode::PAYLOAD_TOO_LARGE.into_response();
    }
    let mime = headers
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_owned();

    let (.., community_host) = match target.admit(&state, &ctx).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match community_client(&state, &keys, &community_host) {
        Ok(c) => c,
        Err(r) => return r,
    };

    if let Err(c) = community_limits(&state, &community_host).await {
        return c.into_response();
    }

    match client.upload_media(&state.http, body.to_vec(), &mime).await {
        Ok(descriptor) => (StatusCode::OK, Json(descriptor)).into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "媒体上传失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// 取回一份媒体。
///
/// 路径由 Core 拼成 `/media/<sha256>` 或原 `<sha256>.thumb.jpg`，不接受任意路径——放开它
/// 等于把 Relay 的整个 HTTP 面变成一个可代签的代理。
pub async fn fetch_media(
    State(state): State<BffState>,
    Path((workspace_id, sha256)): Path<(Uuid, String)>,
    headers: HeaderMap,
) -> Response {
    fetch_media_for(
        state,
        MessageTarget::Workspace(workspace_id),
        sha256,
        headers,
    )
    .await
}

pub async fn fetch_conversation_media(
    State(state): State<BffState>,
    Path((conversation_id, sha256)): Path<(Uuid, String)>,
    headers: HeaderMap,
) -> Response {
    fetch_media_for(
        state,
        MessageTarget::Conversation(conversation_id),
        sha256,
        headers,
    )
    .await
}

async fn fetch_media_for(
    state: BffState,
    target: MessageTarget,
    sha256: String,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Some(media_path) = relay_media_path(&sha256) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let (.., community_host) = match target.admit(&state, &ctx).await {
        Ok(s) => s,
        Err(r) => return r,
    };
    let keys = match actor_keys(&state, &ctx).await {
        Ok(k) => k,
        Err(r) => return r,
    };
    let client = match community_client(&state, &keys, &community_host) {
        Ok(c) => c,
        Err(r) => return r,
    };

    if let Err(c) = community_limits(&state, &community_host).await {
        return c.into_response();
    }

    match client.fetch_media(&state.http, &media_path).await {
        Ok((bytes, content_type)) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, content_type)],
            bytes,
        )
            .into_response(),
        Err(e) => {
            tracing::warn!(error = %e, "媒体取回失败");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        }
    }
}

/// The native thumbnail is the only supported derived-media path. Keep the
/// original hash fence; a caller cannot supply an arbitrary signed Relay URL.
fn relay_media_path(media_ref: &str) -> Option<String> {
    let hash = media_ref.strip_suffix(".thumb.jpg").unwrap_or(media_ref);
    (hash.len() == 64 && hash.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| format!("/media/{media_ref}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collaboration_membership_is_not_management_visibility() {
        assert!(WorkspaceAdmissionEpoch::Membership {
            tenant_version: 1,
            workspace_version: 1,
            membership_id: Uuid::nil(),
            version: 1,
        }
        .is_member());
        assert!(!WorkspaceAdmissionEpoch::WorkspaceManage {
            tenant_version: 1,
            workspace_version: 1,
        }
        .is_member());
        assert!(!WorkspaceAdmissionEpoch::TenantManage {
            tenant_version: 1,
            workspace_version: 1,
            membership_id: Uuid::nil(),
            membership_version: 1,
        }
        .is_member());
    }

    #[test]
    fn forum_message_intents_enforce_parent_combinations_and_canonical_ids() {
        use contracts::WebMessageType::{ForumComment, ForumPost, Stream};
        let id = "a".repeat(64);
        assert!(valid_message_intent(&Stream, None));
        assert!(valid_message_intent(&Stream, Some(&id)));
        assert!(valid_message_intent(&ForumPost, None));
        assert!(!valid_message_intent(&ForumPost, Some(&id)));
        assert!(!valid_message_intent(&ForumComment, None));
        assert!(valid_message_intent(&ForumComment, Some(&id)));
        for bad in [
            String::new(),
            "a".repeat(63),
            "g".repeat(64),
            id.to_uppercase(),
        ] {
            assert!(!valid_message_intent(&Stream, Some(&bad)));
            assert!(!valid_message_intent(&ForumComment, Some(&bad)));
        }
    }

    #[test]
    fn forum_extension_keeps_old_stream_requests_and_queries_readable() {
        let request: PublishRequest =
            serde_json::from_value(serde_json::json!({"content":"old client"})).unwrap();
        assert!(request.message_type.is_none());
        assert!(request.parent_event_id.is_none());
        let message_type = request
            .message_type
            .unwrap_or(contracts::WebMessageType::Stream);
        assert!(valid_message_intent(
            &message_type,
            request.parent_event_id.as_deref()
        ));
        assert_eq!(message_kind(&message_type), 9);
        let query: contracts::WebMessageQuery =
            serde_json::from_value(serde_json::json!({})).unwrap();
        assert!(query.message_type.is_none());
        assert!(query.parent_event_id.is_none());
        assert!(query.before.is_none());
        assert!(serde_json::from_value::<PublishRequest>(
            serde_json::json!({"content":"x","messageType":"UNKNOWN"})
        )
        .is_err());
        assert!(serde_json::from_value::<contracts::WebMessageQuery>(
            serde_json::json!({"messageType":"UNKNOWN"})
        )
        .is_err());
    }

    #[test]
    fn forum_message_evidence_rejects_foreign_unsigned_tampered_and_unknown_events() {
        let keys = nostr::Keys::generate();
        let signed = |kind, tags: Vec<nostr::Tag>| {
            nostr::EventBuilder::new(nostr::Kind::Custom(kind), "body")
                .tags(tags)
                .sign_with_keys(&keys)
                .unwrap()
        };
        let channel_tag = || nostr::Tag::parse(["h", "channel"]).unwrap();
        let id = "a".repeat(64);
        for message_type in [
            contracts::WebMessageType::Stream,
            contracts::WebMessageType::ForumPost,
            contracts::WebMessageType::ForumComment,
        ] {
            let mut tags = vec![channel_tag()];
            if message_type == contracts::WebMessageType::ForumComment {
                tags.push(nostr::Tag::parse(["e", id.as_str(), "", "reply"]).unwrap());
            }
            let event = signed(message_kind(&message_type), tags);
            let value = serde_json::to_value(&event).unwrap();
            assert_eq!(
                channel_message_event(value.clone(), "channel").unwrap().id,
                event.id
            );
            assert!(channel_message_event(value.clone(), "other-channel").is_err());
            let mut unsigned = value.clone();
            unsigned.as_object_mut().unwrap().remove("sig");
            assert!(channel_message_event(unsigned, "channel").is_err());
            let mut tampered = value;
            tampered["content"] = "different body".into();
            assert!(channel_message_event(tampered, "channel").is_err());
        }
        for event in [
            signed(42, vec![channel_tag()]),
            signed(9, vec![]),
            signed(9, vec![channel_tag(), channel_tag()]),
            signed(
                message_kind(&contracts::WebMessageType::ForumComment),
                vec![channel_tag()],
            ),
            signed(
                message_kind(&contracts::WebMessageType::ForumPost),
                vec![
                    channel_tag(),
                    nostr::Tag::parse(["e", id.as_str(), "", "reply"]).unwrap(),
                ],
            ),
        ] {
            assert!(
                channel_message_event(serde_json::to_value(event).unwrap(), "channel").is_err()
            );
        }
    }

    #[test]
    fn forum_cursor_requires_the_complete_canonical_key() {
        let id = "a".repeat(64);
        for value in [
            serde_json::json!({"before":1}),
            serde_json::json!({"beforeId":id}),
            serde_json::json!({"before":-1,"beforeId":id}),
            serde_json::json!({"before":1,"beforeId":id.to_uppercase()}),
            serde_json::json!({"before":1,"beforeId":"invalid"}),
        ] {
            let query = serde_json::from_value(value).unwrap();
            assert!(message_query_cursor(&query).is_err());
        }
        let query = serde_json::from_value(serde_json::json!({"before":1,"beforeId":id})).unwrap();
        let cursor = message_query_cursor(&query).unwrap().unwrap();
        assert_eq!(cursor.created_at, 1);
        assert_eq!(cursor.event_id, id);
    }

    #[test]
    fn channel_descriptor_reads_signed_native_type_not_message_contents() {
        let keys = nostr::Keys::generate();
        let channel = Uuid::from_u128(1).to_string();
        let sign = |kind: &str, archived: Option<&str>| {
            let mut tags = vec![
                nostr::Tag::parse(["d", channel.as_str()]).unwrap(),
                nostr::Tag::parse(["name", "forum-channel"]).unwrap(),
                nostr::Tag::parse(["t", kind]).unwrap(),
            ];
            if let Some(value) = archived {
                tags.push(nostr::Tag::parse(["archived", value]).unwrap());
            }
            nostr::EventBuilder::new(nostr::Kind::Custom(39000), "")
                .tags(tags)
                .sign_with_keys(&keys)
                .unwrap()
        };
        let event = sign("forum", None);
        let view = web_channel_view(&event, &channel, &keys.public_key().to_hex()).unwrap();
        assert_eq!(view.channel_id, channel);
        assert_eq!(serde_json::to_value(view.channel_type).unwrap(), "forum");
        assert!(!view.archived);
        assert!(
            web_channel_view(
                &sign("forum", Some("true")),
                &channel,
                &keys.public_key().to_hex()
            )
            .unwrap()
            .archived
        );
        assert!(web_channel_view(
            &sign("future-type", None),
            &channel,
            &keys.public_key().to_hex()
        )
        .is_err());
        assert!(web_channel_view(
            &sign("forum", Some("unknown")),
            &channel,
            &keys.public_key().to_hex()
        )
        .is_err());
        assert!(web_channel_view(
            &event,
            &Uuid::from_u128(2).to_string(),
            &keys.public_key().to_hex()
        )
        .is_err());
        assert!(web_channel_view(
            &event,
            &channel,
            &nostr::Keys::generate().public_key().to_hex()
        )
        .is_err());
    }

    #[test]
    fn channel_descriptor_requires_signed_complete_native_ttl_metadata() {
        let keys = nostr::Keys::generate();
        let channel = Uuid::from_u128(1).to_string();
        let sign = |ttl: Option<&str>, deadline: Option<&str>, archived: bool| {
            let mut tags = vec![
                nostr::Tag::parse(["d", channel.as_str()]).unwrap(),
                nostr::Tag::parse(["name", "temporary-channel"]).unwrap(),
                nostr::Tag::parse(["t", "stream"]).unwrap(),
            ];
            for (key, value) in [("ttl", ttl), ("ttl_deadline", deadline)] {
                if let Some(value) = value {
                    tags.push(nostr::Tag::parse([key, value]).unwrap());
                }
            }
            if archived {
                tags.push(nostr::Tag::parse(["archived", "true"]).unwrap());
            }
            nostr::EventBuilder::new(nostr::Kind::Custom(39000), "")
                .tags(tags)
                .sign_with_keys(&keys)
                .unwrap()
        };
        let deadline = "2026-10-13T00:00:00Z";
        let event = sign(Some("604800"), Some(deadline), true);
        let view = web_channel_view(&event, &channel, &keys.public_key().to_hex()).unwrap();
        assert!(view.archived);
        let wire = serde_json::to_value(view).unwrap();
        assert_eq!(wire["ttlSeconds"], 604800);
        assert_eq!(wire["ttlDeadline"], deadline);
        let ongoing = web_channel_view(
            &sign(None, None, false),
            &channel,
            &keys.public_key().to_hex(),
        )
        .unwrap();
        let wire = serde_json::to_value(ongoing).unwrap();
        assert!(wire.get("ttlSeconds").is_none());
        assert!(wire.get("ttlDeadline").is_none());
        for (ttl, deadline) in [
            (Some("604800"), None),
            (None, Some(deadline)),
            (Some("0"), Some(deadline)),
            (Some("-1"), Some(deadline)),
            (Some("2147483648"), Some(deadline)),
            (Some("604800"), Some("unknown")),
        ] {
            assert!(web_channel_view(
                &sign(ttl, deadline, false),
                &channel,
                &keys.public_key().to_hex()
            )
            .is_err());
        }
        let mut forged = event;
        forged.content = "tampered".into();
        assert!(web_channel_view(&forged, &channel, &keys.public_key().to_hex()).is_err());
    }

    #[test]
    fn forum_window_requires_bound_relay_signed_bounds_and_scoped_auxiliary() {
        let author = nostr::Keys::generate();
        let relay = nostr::Keys::generate();
        let sign = |kind: u16, content: String, tags: Vec<Vec<&str>>, keys: &nostr::Keys| {
            nostr::EventBuilder::new(nostr::Kind::Custom(kind), content)
                .tags(
                    tags.into_iter()
                        .map(|parts| nostr::Tag::parse(parts).unwrap()),
                )
                .sign_with_keys(keys)
                .unwrap()
        };
        let row = sign(
            message_kind(&contracts::WebMessageType::ForumPost),
            "post".into(),
            vec![vec!["h", "channel"]],
            &author,
        );
        let row_id = row.id.to_hex();
        let bounds = |keys| {
            sign(
                KIND_WINDOW_BOUNDS as u16,
                serde_json::json!({"has_more":false,"next_cursor":null}).to_string(),
                vec![vec!["h", "channel"], vec!["d", "channel:head"]],
                keys,
            )
        };
        let check = |events| {
            verify_message_page(
                events,
                "channel",
                &contracts::WebMessageType::ForumPost,
                None,
                None,
                Some(&relay.public_key().to_hex()),
                2,
            )
        };
        assert!(check(vec![row.clone(), bounds(&relay)]).is_ok());
        assert!(check(vec![bounds(&relay)]).is_ok());
        assert!(check(vec![row.clone()]).is_err());
        assert!(check(vec![row.clone(), bounds(&author)]).is_err());
        let reaction = sign(
            KIND_REACTION as u16,
            "+".into(),
            vec![vec!["h", "channel"], vec!["e", &row_id]],
            &author,
        );
        let reaction_id = reaction.id.to_hex();
        let deletion = sign(
            KIND_DELETION as u16,
            String::new(),
            vec![vec!["e", &reaction_id]],
            &author,
        );
        assert!(check(vec![row.clone(), reaction, deletion, bounds(&relay)]).is_ok());
        let native_reaction = sign(
            KIND_REACTION as u16,
            "+".into(),
            vec![vec!["e", &row_id]],
            &author,
        );
        assert!(check(vec![row.clone(), native_reaction, bounds(&relay)]).is_ok());
        for channel_tags in [
            vec![vec!["h", "other-channel"]],
            vec![vec!["h", "channel"], vec!["h", "other-channel"]],
        ] {
            let mut tags = channel_tags;
            tags.push(vec!["e", &row_id]);
            let reaction = sign(KIND_REACTION as u16, "+".into(), tags, &author);
            assert!(check(vec![row.clone(), reaction, bounds(&relay)]).is_err());
        }
        let unrelated = "b".repeat(64);
        let unrelated_native_reaction = sign(
            KIND_REACTION as u16,
            "+".into(),
            vec![vec!["e", &unrelated]],
            &author,
        );
        assert!(check(vec![row.clone(), unrelated_native_reaction, bounds(&relay)]).is_err());
        let reaction = sign(
            KIND_REACTION as u16,
            "+".into(),
            vec![vec!["h", "channel"], vec!["e", &unrelated]],
            &author,
        );
        assert!(check(vec![row.clone(), reaction, bounds(&relay)]).is_err());
        let bad_cursor = sign(KIND_WINDOW_BOUNDS as u16,
            serde_json::json!({"has_more":true,"next_cursor":{"created_at":row.created_at.as_secs(),"id":unrelated}}).to_string(),
            vec![vec!["h","channel"],vec!["d","channel:head"]], &relay);
        assert!(check(vec![row, bad_cursor]).is_err());
    }

    #[test]
    fn forum_thread_keeps_same_second_replies_with_a_forward_cursor() {
        let keys = nostr::Keys::generate();
        let root = "a".repeat(64);
        let mut rows: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|content| {
                nostr::EventBuilder::new(
                    nostr::Kind::Custom(message_kind(&contracts::WebMessageType::ForumComment)),
                    content,
                )
                .tags([
                    nostr::Tag::parse(["h", "channel"]).unwrap(),
                    nostr::Tag::parse(["e", root.as_str(), "", "reply"]).unwrap(),
                ])
                .custom_created_at(nostr::Timestamp::from_secs(1))
                .sign_with_keys(&keys)
                .unwrap()
            })
            .collect();
        rows.sort_by_key(|event| event.id);
        let check = |events, cursor| {
            verify_message_page(
                events,
                "channel",
                &contracts::WebMessageType::ForumComment,
                Some(&root),
                cursor,
                None,
                1,
            )
        };
        let (_, cursor) = check(vec![rows[0].clone()], None).unwrap();
        let cursor = cursor.unwrap();
        assert_eq!(cursor.event_id, rows[0].id.to_hex());
        assert!(check(vec![rows[1].clone()], Some(&cursor)).is_ok());
        assert!(check(vec![rows[0].clone()], Some(&cursor)).is_err());
        assert!(check(Vec::new(), Some(&cursor)).unwrap().1.is_none());
    }

    #[test]
    fn private_messages_keep_conversation_audit_scope() {
        let id = Uuid::from_u128(1);
        let dm = MessageTarget::Conversation(id);
        let workspace = MessageTarget::Workspace(id);
        assert_eq!(dm.id(), id);
        assert_eq!(dm.workspace_id(), None);
        assert_eq!(dm.target_type(), "CONVERSATION");
        assert_eq!(dm.action(), CONVERSATION_PUBLISH_ACTION);
        assert_eq!(workspace.workspace_id(), Some(id));
        assert_eq!(workspace.target_type(), "CHANNEL");
        assert_eq!(workspace.action(), PUBLISH_ACTION);
        // Equal UUID bytes do not make the scopes or their audit actions equal.
        assert_ne!(workspace.action(), dm.action());
        assert_ne!(workspace.target_type(), dm.target_type());
    }

    #[test]
    fn pulse_uses_tenant_community_not_workspace_or_conversation() {
        let id = Uuid::from_u128(1);
        let pulse = MessageTarget::Pulse(id);
        assert_eq!(pulse.id(), id);
        assert_eq!(pulse.workspace_id(), None);
        assert_eq!(pulse.target_type(), "TENANT");
        assert_eq!(pulse.action(), crate::pulse::PUBLISH_ACTION);
        assert_ne!(pulse.action(), MessageTarget::Workspace(id).action());
        assert_ne!(pulse.action(), MessageTarget::Conversation(id).action());
    }

    #[test]
    fn mention_intent_is_a_canonical_installation_set() {
        let first = Uuid::from_u128(1);
        let second = Uuid::from_u128(2);
        assert_eq!(mention_targets(None), Some(vec![]));
        assert_eq!(mention_targets(Some(&[])), Some(vec![]));
        assert_eq!(
            mention_targets(Some(&[
                second.to_string(),
                first.to_string(),
                second.to_string()
            ])),
            Some(vec![first, second])
        );
        assert!(mention_targets(Some(&["not-an-installation".into()])).is_none());
        // Same key cannot switch targets or turn a mention into an ordinary message.
        assert_ne!(
            mention_targets(Some(&[first.to_string()])),
            mention_targets(Some(&[second.to_string()]))
        );
        assert_ne!(
            mention_targets(Some(&[first.to_string()])),
            mention_targets(None)
        );
        assert!(mention_intent_matches(&[first, second], &[first, second]));
        assert!(mention_intent_matches(&[], &[]));
        assert!(!mention_intent_matches(&[first], &[second]));
        assert!(!mention_intent_matches(&[first], &[]));
        assert!(!mention_intent_matches(&[], &[first]));
    }

    #[test]
    fn publish_replay_requires_exact_original_dispatch_workspace() {
        let original = Uuid::from_u128(1);
        let other = Uuid::from_u128(2);
        assert!(publish_scope_matches(&[Some(original)], original));
        assert!(!publish_scope_matches(&[Some(original)], other));
        assert!(!publish_scope_matches(&[], original));
        assert!(!publish_scope_matches(&[None], original));
        assert!(!publish_scope_matches(
            &[Some(original), Some(original)],
            original
        ));
        assert!(!publish_scope_matches(
            &[Some(original), Some(other)],
            original
        ));
    }

    #[test]
    fn mention_contract_preserves_attachments() {
        let hash = "a".repeat(64);
        let request: PublishRequest = serde_json::from_value(serde_json::json!({
            "content": "hello", "mentionInstallationIds": [Uuid::from_u128(1).to_string()],
            "attachments": [{"url":format!("https://relay.example/media/{hash}.png"),
                "sha256":hash,"type":"image/png","size":42}]
        }))
        .unwrap();
        assert_eq!(request.mention_installation_ids.unwrap().len(), 1);
        let mut attachment = request.attachments.unwrap().remove(0);
        let (_, tags) = attachment.render("relay.example").unwrap();
        assert_eq!(tags[0], "imeta");
        assert!(tags.contains(&"m image/png".to_owned()));
        assert!(tags.contains(&"size 42".to_owned()));
        assert!(attachment.render("other.example").is_none());
        attachment.size = -1;
        assert!(attachment.render("relay.example").is_none());
        let ordinary: PublishRequest =
            serde_json::from_value(serde_json::json!({"content":"old client"})).unwrap();
        assert!(ordinary.attachments.is_none());
        assert!(ordinary.mention_installation_ids.is_none());
    }

    async fn parts(r: Response) -> (StatusCode, Option<String>, serde_json::Value) {
        let status = r.status();
        let retry = r
            .headers()
            .get(axum::http::header::RETRY_AFTER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let body = axum::body::to_bytes(r.into_body(), usize::MAX)
            .await
            .expect("读回应体");
        (
            status,
            retry,
            serde_json::from_slice(&body).expect("错误体是 JSON"),
        )
    }

    /// `relay-server-client.md` 第 2、3 节的不符：Relay 的 429 与大小上界曾被回成
    /// DENIED 或无分类的 503。这里固定 06 §4 的映射。
    #[tokio::test]
    async fn relay_limits_map_to_limit_class() {
        let rejected = |status| OperatorError::Rejected {
            status,
            body: String::new(),
        };

        let (s, retry, b) = parts(relay_error_response(&rejected(429), None)).await;
        assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            (b["class"].as_str(), b["reason"].as_str()),
            (Some("LIMIT"), Some("RATE_LIMITED"))
        );
        assert_eq!(retry, None, "Relay 的 429 没有可机读的重置时刻，不编一个");

        let (s, retry, b) = parts(relay_error_response(
            &OperatorError::BudgetExhausted {
                retry_after_secs: 7,
            },
            None,
        ))
        .await;
        assert_eq!(s, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(b["class"], "LIMIT");
        assert_eq!(b["reason"], "RATE_LIMITED");
        assert_eq!(retry.as_deref(), Some("7"), "Core 预算的拒绝带 Retry-After");

        let (s, _, b) = parts(relay_error_response(&rejected(413), None)).await;
        assert_eq!(s, StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            (b["class"].as_str(), b["reason"].as_str()),
            (Some("LIMIT"), Some("PAYLOAD_TOO_LARGE"))
        );

        // 其余失败不是 LIMIT，也不是无分类的空 503
        for status in [403, 500, 503] {
            let (s, _, b) = parts(relay_error_response(&rejected(status), None)).await;
            assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
            assert_eq!(b["class"], "PRECONDITION", "HTTP {status}");
            assert_eq!(b["reason"], "DEPENDENCY_UNAVAILABLE", "HTTP {status}");
        }
    }

    /// DD-114(2)：binding 与依赖失败带 PRECONDITION；无权与不存在共用 DENIED 回应
    #[tokio::test]
    async fn admission_failures_are_classified() {
        let (s, _, b) = parts(AdmissionFailure::BindingNotActive.into_response()).await;
        assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(b["class"], "PRECONDITION");
        assert_eq!(b["reason"], "BINDING_NOT_ACTIVE");
        let (s, _, b) = parts(AdmissionFailure::Denied.into_response()).await;
        assert_eq!(s, StatusCode::FORBIDDEN);
        assert_eq!(b["class"], "DENIED");
        assert_eq!(b["reason"], "PERMISSION_DENIED");
        let (s, _, b) = parts(AdmissionFailure::Unavailable.into_response()).await;
        assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(b["class"], "PRECONDITION");
        assert_eq!(b["reason"], "DEPENDENCY_UNAVAILABLE");
    }

    #[tokio::test]
    async fn nip11_check_failures_are_preconditions() {
        let (s, _, b) = parts(RelayCheck::Mismatch.into_response()).await;
        assert_eq!(s, StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(b["class"], "PRECONDITION");
        assert_eq!(b["reason"], "BINDING_NOT_ACTIVE");
        let (_, _, b) = parts(RelayCheck::Unavailable.into_response()).await;
        assert_eq!(b["reason"], "DEPENDENCY_UNAVAILABLE");
        // DD-114(1)：抓不到 NIP-11 以 BINDING_NOT_ACTIVE 拒绝该次请求
        let (_, _, b) = parts(RelayCheck::Nip11Unavailable.into_response()).await;
        assert_eq!(b["reason"], "BINDING_NOT_ACTIVE");
        assert_ne!(
            RelayCheck::Mismatch.stream_reason(),
            RelayCheck::Unavailable.stream_reason()
        );
    }

    fn media_attachment(
        media_type: &str,
        extension: &str,
        filename: Option<&str>,
        spoiler: Option<bool>,
    ) -> contracts::AttachmentElement {
        let hash = "a".repeat(64);
        let mut value = serde_json::json!({
            "url": format!("https://relay.example/media/{hash}.{extension}"),
            "sha256": hash,
            "type": media_type,
            "size": 42,
        });
        if let Some(filename) = filename {
            value["filename"] = filename.into();
        }
        if let Some(spoiler) = spoiler {
            value["spoiler"] = spoiler.into();
        }
        serde_json::from_value(value).expect("generated attachment contract")
    }

    /// Fixed Buzz 779af8886caae1317b4de962082429867ab61503,
    /// desktop/src/features/messages/lib/imetaMediaMarkdown.ts::formatImetaMediaLine
    /// and ::buildImetaTags: these are file-card links, not inline image/video.
    #[test]
    fn attachment_file_cards_preserve_native_classification_and_filename() {
        for (mime, extension, filename) in [
            ("application/pdf", "pdf", "report.pdf"),
            ("audio/mpeg", "mp3", "recording.mp3"),
            ("video/mp4", "mp4", "voice-note-recording.mp4"),
            ("video/mp4", "mp4", "VOICE-NOTE-RECORDING.MP4"),
            ("image/png", "png", "helper.agent.png"),
            ("image/png", "png", "engineers.team.png"),
            ("image/png", "png", "HELPER.AGENT.PNG"),
        ] {
            let attachment = media_attachment(mime, extension, Some(filename), Some(true));
            let (body, tags) = attachment.render("relay.example").unwrap();
            assert_eq!(
                body,
                format!("\n[{filename}]({})", attachment.url),
                "{filename}"
            );
            assert_eq!(
                tags,
                vec![
                    "imeta".to_owned(),
                    format!("url {}", attachment.url),
                    format!("m {mime}"),
                    format!("x {}", attachment.sha256),
                    "size 42".to_owned(),
                    format!("filename {filename}"),
                ],
                "file metadata must retain the original filename independently of Markdown"
            );
        }
    }

    #[test]
    fn attachment_edit_preserves_native_metadata_and_independent_display_label() {
        let request: PublishRequest = serde_json::from_str(include_str!(
            "../../../../contracts/samples/web-message-edit.sample.json"
        ))
        .unwrap();
        let attachment = &request.attachments.unwrap()[0];
        let (body, tags) = attachment.render("relay.example").unwrap();
        assert_eq!(body, format!("\n[Meeting recording]({})", attachment.url));
        assert_eq!(
            tags,
            vec![
                "imeta".to_owned(),
                format!("url {}", attachment.url),
                "m video/mp4".into(),
                format!("x {}", attachment.sha256),
                "size 42".into(),
                "dim 640x480".into(),
                "blurhash LEHV6nWB2yk8pyo0adR*.7kCMdnj".into(),
                format!("thumb {}", attachment.thumb.as_ref().unwrap()),
                "duration 3.25".into(),
                format!("image {}", attachment.image.as_ref().unwrap()),
                "filename voice-note-recording.mp4".into(),
            ]
        );
        let mut labelled = attachment.clone();
        labelled.display_label = Some("  [meeting]\\notes  ".into());
        assert_eq!(
            labelled.render("relay.example").unwrap().0,
            format!("\n[\\[meeting\\]\\\\notes]({})", labelled.url)
        );
    }

    #[test]
    fn attachment_extended_urls_and_duration_keep_the_original_media_fence() {
        let mut attachment = media_attachment("video/mp4", "mp4", Some("video.mp4"), None);
        let hash = attachment.sha256.clone();
        for invalid in [
            format!("https://other.example/media/{hash}.thumb.jpg"),
            format!("https://reader@relay.example/media/{hash}.thumb.jpg"),
            format!("https://relay.example/media/{hash}.thumb.jpg?token=bad"),
            format!("https://relay.example/media/{hash}.thumb.jpg#fragment"),
            format!("https://relay.example/media/{}.thumb.jpg", "b".repeat(64)),
        ] {
            attachment.thumb = Some(invalid);
            assert!(attachment.render("relay.example").is_none());
        }
        attachment.thumb = None;
        for invalid in [
            format!("https://other.example/media/{hash}.jpg"),
            format!("https://reader:secret@relay.example/media/{hash}.jpg"),
            format!("https://relay.example/media/{hash}.jpg?token=bad"),
            format!("https://relay.example/media/{hash}.thumb.jpg"),
            format!("https://relay.example/media/{hash}.mp4"),
        ] {
            attachment.image = Some(invalid);
            assert!(attachment.render("relay.example").is_none());
        }
        attachment.image = None;
        for duration in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            attachment.duration = Some(duration);
            assert!(attachment.render("relay.example").is_none());
        }
        attachment.duration = Some(3.25);
        assert!(attachment.render("relay.example").is_some());
        attachment.web_message_attachment_type = "image/png".into();
        assert!(attachment.render("relay.example").is_none());
    }

    #[test]
    fn attachment_media_read_accepts_only_blob_or_original_thumbnail() {
        let hash = "a".repeat(64);
        assert_eq!(relay_media_path(&hash), Some(format!("/media/{hash}")));
        let thumb = format!("{hash}.thumb.jpg");
        assert_eq!(relay_media_path(&thumb), Some(format!("/media/{thumb}")));
        for invalid in [
            format!("{hash}.jpg"),
            format!("{hash}.thumb.png"),
            format!("{hash}.thumb.jpg?token=bad"),
            format!("{hash}.thumb.jpg#part"),
            format!("../{thumb}"),
            format!("{hash}/thumb.jpg"),
            format!("{}.thumb.jpg", "g".repeat(64)),
            format!("https://other.example/media/{thumb}"),
        ] {
            assert!(relay_media_path(&invalid).is_none(), "{invalid}");
        }
    }

    #[test]
    fn attachment_images_and_videos_keep_inline_spoilers() {
        for (mime, extension, filename, kind) in [
            ("image/png", "png", "photo.png", "image"),
            ("video/mp4", "mp4", "movie.mp4", "video"),
            ("video/webm", "webm", "voice-note-recording.mp4", "video"),
            ("video/mp4", "mp4", "voice-note-recording.webm", "video"),
        ] {
            for spoiler in [None, Some(false), Some(true)] {
                let attachment = media_attachment(mime, extension, Some(filename), spoiler);
                let (body, tags) = attachment.render("relay.example").unwrap();
                let media = format!("![{kind}]({})", attachment.url);
                assert_eq!(
                    body,
                    if spoiler == Some(true) {
                        format!("\n||{media}||")
                    } else {
                        format!("\n{media}")
                    },
                    "{filename} spoiler={spoiler:?}"
                );
                assert!(tags.contains(&format!("filename {filename}")));
                assert!(
                    tags.iter().all(|tag| !tag.starts_with("spoiler")),
                    "spoiler is durable Markdown, not an invented imeta field"
                );
            }
        }
    }

    #[test]
    fn attachment_file_labels_escape_markdown_without_changing_imeta() {
        let filename = r"report\[final].pdf";
        let attachment = media_attachment("application/pdf", "pdf", Some(filename), None);
        let (body, tags) = attachment.render("relay.example").unwrap();
        assert_eq!(
            body,
            format!("\n[{}]({})", r"report\\\[final\].pdf", attachment.url)
        );
        assert!(tags.contains(&format!("filename {filename}")));
    }

    #[test]
    fn attachment_urls_stay_in_the_admitted_community() {
        let mut attachment = media_attachment("application/pdf", "pdf", Some("report.pdf"), None);
        let hash = attachment.sha256.clone();
        for url in [
            format!("https://other.example/media/{hash}.pdf"),
            format!("https://reader@relay.example/media/{hash}.pdf"),
            format!("https://reader:password@relay.example/media/{hash}.pdf"),
            format!("https://relay.example/media/{hash}.pdf?download=1"),
            format!("https://relay.example/media/{hash}.pdf#download"),
            format!("https://relay.example:8443/media/{hash}.pdf"),
        ] {
            attachment.url = url;
            assert!(
                attachment.render("relay.example").is_none(),
                "must reject {}",
                attachment.url
            );
        }
        assert!(
            attachment.render("relay.example:8443").is_some(),
            "the admitted authority includes its configured port"
        );
    }

    #[test]
    fn attachment_legacy_missing_optional_fields_remains_readable() {
        let mut image = media_attachment("image/png", "png", None, None);
        assert_eq!(image.filename, None);
        assert_eq!(image.spoiler, None);
        image.size = 0;
        let (body, tags) = image.render("relay.example").unwrap();
        assert_eq!(body, format!("\n![image]({})", image.url));
        assert_eq!(
            tags.len(),
            4,
            "legacy zero size emits no size or filename imeta fields"
        );
        let file = media_attachment("application/pdf", "pdf", None, None);
        let (body, _) = file.render("relay.example").unwrap();
        assert_eq!(body, format!("\n[{}.pdf]({})", file.sha256, file.url));
    }
}
