//! DD-125(3) 原版 Huddle 的协议面（Buzz `779af8886caae1317b4de962082429867ab61503`）。
//!
//! 只有三类东西在这里：
//!
//! - 原版事件的固定形状：临时频道 9007 投影的标签（加 Kailo 的 `creator`，与 41010 私聊
//!   投影同形，SS-BUZ-GOVERNANCE）、父频道 48100 与临时频道 48106 的正文与标签
//!   （`desktop/src-tauri/src/events.rs::build_huddle_started/build_huddle_guidelines`、
//!   `desktop/src-tauri/src/huddle/agents.rs::voice_mode_guidelines`）；
//! - 父频道 48100–48103 的解析与签名者校验（`crates/buzz-relay/src/handlers/ingest.rs::
//!   validate_huddle_lifecycle_event`、`audio/handler.rs::emit_participant_event`）；
//! - BFF 音频桥连向 Relay `/huddle/{channel_id}/audio` 的那一段：JSON 挑战帧 → 本人
//!   SERVER 身份签 22242 → `{"type":"auth",…,"protocol_version":2}`
//!   （`audio/handler.rs::AuthMsg`、`desktop/src-tauri/src/huddle/relay_api.rs`）。
//!   之后的帧原样转发，本模块不解码、不混音。
//!
//! 授权、绑定状态与审计都不在这里（`01-工程结构与模块边界.md` §6）。

use futures_util::{SinkExt, StreamExt};
use nostr::Event;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, Message};
use uuid::Uuid;

use crate::bridge::IdentityClient;
use crate::operator::OperatorError;

pub use buzz_core::kind::{
    KIND_HUDDLE_ENDED, KIND_HUDDLE_GUIDELINES, KIND_HUDDLE_LIVENESS,
    KIND_HUDDLE_PARTICIPANT_JOINED, KIND_HUDDLE_PARTICIPANT_LEFT, KIND_HUDDLE_REACTION,
    KIND_HUDDLE_STARTED, KIND_NIP29_LEAVE_REQUEST,
};

/// 原 `start_huddle` 的临时频道 TTL：Relay 只接受 `ttl` 恰为 3600 的 48100 背书频道。
pub const HUDDLE_TTL_SECONDS: i64 = 3600;
/// 原 `relay_api.rs::MAX_HUDDLE_AGENTS`。
pub const MAX_HUDDLE_AGENTS: usize = 20;
/// 原 Desktop `huddle/wire.rs::PROTOCOL_VERSION`。房间协议版本由首个加入者固定，
/// Web 必须与原生端同为 v2，否则得到 `upgrade_required`。
pub const AUDIO_PROTOCOL_VERSION: u8 = 2;
/// 原 Relay `audio/handler.rs::MAX_AUDIO_FRAME_BYTES`：超出即被丢弃。
pub const MAX_AUDIO_FRAME_BYTES: usize = 4096;
/// v2 帧头：seq u16 + ts_48k u32 + level_dbov i8 + flags u8（大端，原 `audio/wire.rs`）。
pub const AUDIO_HEADER_BYTES: usize = 8;
/// 原 Relay 音频 WebSocket 的单消息上界（文本控制消息同样受限）。
pub const MAX_AUDIO_MESSAGE_BYTES: usize = 8192;
/// 原 `HUDDLE_LINK_CONTENT_MAX_BYTES`：生命周期正文超过它不参与链接判定。
pub const LIFECYCLE_CONTENT_MAX_BYTES: usize = 512;

/// 原 `huddle/agents.rs::voice_mode_guidelines`，逐字保留。
pub fn voice_mode_guidelines(parent_channel_id: &str) -> String {
    format!(
        "\
You are in a live voice huddle. Its attached main channel is {parent_channel_id}; that is not the live huddle channel.
The channel UUID in the current `[Context]` block is the live huddle channel. Only messages sent with `buzz messages send` to that current Context channel are spoken aloud, in the order sent; everything else you produce is silent.
When a user addresses you, your FIRST tool call must send a brief spoken reply to the current Context channel, before any file read, search, or other tool call. The usual rule against bare acknowledgments does not apply here; the pickup is the feedback that you heard them.
Then work, sending each useful sentence as its own message the moment it is ready—a few sentences per answer, not a monologue.
Speak plainly without markdown; post code or long detail to the attached main channel instead.
If you are not addressed, stay silent."
    )
}

fn tag(name: &str, value: &str) -> Vec<String> {
    vec![name.to_owned(), value.to_owned()]
}

/// CONTROL 签的临时频道投影（原 `events.rs::build_create_channel` 的 private/stream/ttl
/// 加唯一 `creator`）。Relay 据 `creator` 记 `created_by`（SS-BUZ-GOVERNANCE）。
pub fn huddle_channel_tags(channel_id: &str, name: &str, creator: &str) -> Vec<Vec<String>> {
    vec![
        tag("h", channel_id),
        tag("name", name),
        tag("visibility", "private"),
        tag("channel_type", "stream"),
        tag("ttl", &HUDDLE_TTL_SECONDS.to_string()),
        tag("creator", creator),
    ]
}

/// 原 `build_huddle_started/build_huddle_ended` 的正文。
pub fn lifecycle_content(ephemeral_channel_id: &str) -> String {
    json!({ "ephemeral_channel_id": ephemeral_channel_id }).to_string()
}

/// 父频道 48100（创建者本人签）。
pub fn started_tags(parent_channel_id: &str) -> Vec<Vec<String>> {
    vec![tag("h", parent_channel_id)]
}

/// 临时频道 48106（创建者本人签）。
pub fn guidelines_tags(ephemeral_channel_id: &str) -> Vec<Vec<String>> {
    vec![tag("h", ephemeral_channel_id)]
}

/// 本人退出临时频道（原 `events.rs::build_leave`，kind 9022 只带 `h`）。
pub fn leave_tags(ephemeral_channel_id: &str) -> Vec<Vec<String>> {
    vec![tag("h", ephemeral_channel_id)]
}

/// 一条已校验的父频道生命周期事件（契约 `HuddleLifecycleEvent`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleEvent {
    pub event_id: String,
    pub kind: u32,
    pub pubkey: String,
    pub created_at: i64,
    pub ephemeral_channel_id: Uuid,
    pub participant_pubkey: Option<String>,
    pub roster_revision: Option<i64>,
    pub admission_id: Option<String>,
    pub generation: Option<String>,
}

fn single_tag<'a>(event: &'a Event, name: &str) -> Option<&'a str> {
    let mut values = event
        .tags
        .iter()
        .map(nostr::Tag::as_slice)
        .filter(|tag| tag.first().is_some_and(|first| first == name));
    let first = values.next()?;
    if values.next().is_some() || first.len() < 2 {
        return None;
    }
    Some(first[1].as_str())
}

/// 解析并校验父频道中关于 `ephemeral_channel_id` 的一条生命周期事件：签名有效、
/// `h` 恰为该父频道、正文是原 JSON；48100 只认创建者，48101/48102 只认 Relay，48103
/// 认创建者或 Relay（`validate_huddle_lifecycle_event`、`emit_participant_event`）。
/// 其余一律丢弃，不当作证据。
pub fn lifecycle_event(
    event: &Event,
    parent_channel_id: &str,
    ephemeral_channel_id: Uuid,
    creator: &str,
    relay: Option<&str>,
) -> Option<LifecycleEvent> {
    let kind = u32::from(event.kind.as_u16());
    if !(KIND_HUDDLE_STARTED..=KIND_HUDDLE_ENDED).contains(&kind) || event.verify().is_err() {
        return None;
    }
    if single_tag(event, "h") != Some(parent_channel_id)
        || event.content.len() > LIFECYCLE_CONTENT_MAX_BYTES
    {
        return None;
    }
    let signer = event.pubkey.to_hex();
    let from_relay = relay.is_some_and(|relay| relay == signer);
    let trusted = match kind {
        KIND_HUDDLE_STARTED => signer == creator,
        KIND_HUDDLE_ENDED => signer == creator || from_relay,
        _ => from_relay,
    };
    if !trusted {
        return None;
    }
    let content: Value = serde_json::from_str(&event.content).ok()?;
    let linked = content
        .get("ephemeral_channel_id")
        .and_then(Value::as_str)
        .and_then(|id| Uuid::parse_str(id).ok());
    if linked != Some(ephemeral_channel_id) {
        return None;
    }
    let participant = single_tag(event, "p").map(str::to_owned);
    if matches!(
        kind,
        KIND_HUDDLE_PARTICIPANT_JOINED | KIND_HUDDLE_PARTICIPANT_LEFT
    ) && participant.is_none()
    {
        return None;
    }
    let text = |name: &str| content.get(name).and_then(Value::as_str).map(str::to_owned);
    Some(LifecycleEvent {
        event_id: event.id.to_hex(),
        kind,
        pubkey: signer,
        created_at: i64::try_from(event.created_at.as_secs()).ok()?,
        ephemeral_channel_id,
        participant_pubkey: participant
            .filter(|_| kind != KIND_HUDDLE_STARTED && kind != KIND_HUDDLE_ENDED),
        roster_revision: content.get("roster_revision").and_then(Value::as_i64),
        admission_id: text("admission_id"),
        generation: text("generation"),
    })
}

/// 父频道的生命周期查询（原 `relayClientSession.ts::subscribeToHuddleEvents` 的 filter）。
pub fn lifecycle_filter(parent_channel_id: &str, limit: i64) -> Value {
    json!({
        "kinds": [
            KIND_HUDDLE_STARTED,
            KIND_HUDDLE_PARTICIPANT_JOINED,
            KIND_HUDDLE_PARTICIPANT_LEFT,
            KIND_HUDDLE_ENDED,
        ],
        "#h": [parent_channel_id],
        "limit": limit,
    })
}

/// 原 `huddlePresenceRuntime.ts` 的存活查询：Relay 只为有创建者 48100 链接且房间非空的
/// 会话合成一条 48104（`req.rs::handle_huddle_liveness_req`）。
pub fn liveness_filter(parent_channel_id: &str, ephemeral_channel_id: &str) -> Value {
    json!({
        "kinds": [KIND_HUDDLE_LIVENESS],
        "#h": [parent_channel_id],
        "#d": [ephemeral_channel_id],
    })
}

/// 存活查询的结果里是否有该会话。
pub fn is_live(page: &Value, ephemeral_channel_id: &str, relay: Option<&str>) -> bool {
    let Ok(events) = serde_json::from_value::<Vec<Event>>(page.clone()) else {
        return false;
    };
    events.iter().any(|event| {
        u32::from(event.kind.as_u16()) == KIND_HUDDLE_LIVENESS
            && event.verify().is_ok()
            && relay.is_some_and(|relay| relay == event.pubkey.to_hex())
            && single_tag(event, "d") == Some(ephemeral_channel_id)
    })
}

/// 已认证的 Relay 音频连接。
pub type AudioSocket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// 以 `client`（本人 SERVER 身份）连上 Relay 的 Huddle 音频，完成原 JSON 挑战认证。
///
/// `ws_base` 是 Relay 的 WebSocket 网络地址（`BUZZ_RELAY_WS_URL`）；Host 头与 22242 的
/// `relay` 标签都用 Community host，与 NIP-42 订阅连接同一规则（SF-BUZ-32）。认证帧发出
/// 后即返回：`joined` 与 `error` 原样交给浏览器，由原客户端逻辑处理。
pub async fn connect_audio(
    ws_base: &str,
    client: &IdentityClient,
    channel_id: Uuid,
    parent_channel_id: Uuid,
    timeout: tokio::time::Duration,
) -> Result<AudioSocket, OperatorError> {
    let url = format!(
        "{}/huddle/{channel_id}/audio",
        ws_base.trim_end_matches('/')
    );
    let mut request = url
        .into_client_request()
        .map_err(|e| OperatorError::Sign(format!("音频连接请求构造失败: {e}")))?;
    request.headers_mut().insert(
        "host",
        client
            .community_host()
            .parse()
            .map_err(|_| OperatorError::Sign("Community host 不是合法 header 值".into()))?,
    );
    let deadline = tokio::time::Instant::now() + timeout;
    let (mut ws, _) = tokio::time::timeout_at(deadline, tokio_tungstenite::connect_async(request))
        .await
        .map_err(|_| OperatorError::Sign("音频连接超时".into()))?
        .map_err(|e| OperatorError::Sign(format!("音频连接失败: {e}")))?;
    let challenge = loop {
        let frame = tokio::time::timeout_at(deadline, ws.next())
            .await
            .map_err(|_| OperatorError::Sign("等待音频认证挑战超时".into()))?;
        match frame {
            Some(Ok(Message::Text(text))) => {
                let value: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                if value.get("type").and_then(Value::as_str) == Some("challenge") {
                    if let Some(challenge) = value.get("challenge").and_then(Value::as_str) {
                        break challenge.to_owned();
                    }
                }
            }
            Some(Ok(_)) => {}
            Some(Err(e)) => return Err(OperatorError::Sign(format!("音频连接读取失败: {e}"))),
            None => return Err(OperatorError::Sign("音频连接在认证前关闭".into())),
        }
    };
    let auth = client.sign_relay_auth(&challenge)?;
    let frame = json!({
        "type": "auth",
        "event": auth,
        "parent_channel_id": parent_channel_id.to_string(),
        "protocol_version": AUDIO_PROTOCOL_VERSION,
    });
    ws.send(Message::text(frame.to_string()))
        .await
        .map_err(|e| OperatorError::Sign(format!("发送音频认证失败: {e}")))?;
    Ok(ws)
}

/// 浏览器上行的一帧是否可原样转发：v2 帧头之后至少一个字节、整帧不超过原上界。
pub fn valid_uplink_frame(frame: &[u8]) -> bool {
    frame.len() > AUDIO_HEADER_BYTES && frame.len() <= MAX_AUDIO_FRAME_BYTES
}

/// 浏览器上行的文本只接受原 `{"type":"leave"}`；其余（含伪造的 auth）一律不转发。
pub fn is_leave_message(text: &str) -> bool {
    let Ok(Value::Object(object)) = serde_json::from_str::<Value>(text) else {
        return false;
    };
    object.len() == 1 && object.get("type").and_then(Value::as_str) == Some("leave")
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag};

    fn signed(keys: &Keys, kind: u32, content: &str, tags: Vec<Vec<&str>>) -> Event {
        let tags: Vec<Tag> = tags
            .into_iter()
            .map(|tag| Tag::parse(tag).expect("tag"))
            .collect();
        EventBuilder::new(Kind::Custom(kind as u16), content)
            .tags(tags)
            .sign_with_keys(keys)
            .expect("sign")
    }

    #[test]
    fn projection_and_announcement_keep_the_original_shapes() {
        let channel = "00000000-0000-4000-8000-000000000001";
        let creator = "a".repeat(64);
        let tags = huddle_channel_tags(channel, "release huddle", &creator);
        assert_eq!(tags[0], ["h", channel]);
        assert!(tags.contains(&vec!["visibility".to_owned(), "private".to_owned()]));
        assert!(tags.contains(&vec!["channel_type".to_owned(), "stream".to_owned()]));
        assert!(tags.contains(&vec!["ttl".to_owned(), "3600".to_owned()]));
        assert_eq!(tags.iter().filter(|t| t[0] == "creator").count(), 1);
        assert_eq!(
            lifecycle_content(channel),
            format!("{{\"ephemeral_channel_id\":\"{channel}\"}}")
        );
        assert!(voice_mode_guidelines("p").contains("attached main channel is p;"));
    }

    #[test]
    fn lifecycle_events_trust_only_the_original_signers() {
        let creator = Keys::generate();
        let relay = Keys::generate();
        let stranger = Keys::generate();
        let parent = "00000000-0000-4000-8000-0000000000aa";
        let eph = Uuid::parse_str("00000000-0000-4000-8000-0000000000bb").unwrap();
        let content = lifecycle_content(&eph.to_string());
        let creator_hex = creator.public_key().to_hex();
        let relay_hex = relay.public_key().to_hex();
        let started = signed(
            &creator,
            KIND_HUDDLE_STARTED,
            &content,
            vec![vec!["h", parent]],
        );
        let parsed = lifecycle_event(&started, parent, eph, &creator_hex, Some(&relay_hex));
        assert_eq!(parsed.map(|e| e.kind), Some(KIND_HUDDLE_STARTED));
        let forged = signed(
            &stranger,
            KIND_HUDDLE_STARTED,
            &content,
            vec![vec!["h", parent]],
        );
        assert!(lifecycle_event(&forged, parent, eph, &creator_hex, Some(&relay_hex)).is_none());
        let joined_content = json!({
            "ephemeral_channel_id": eph.to_string(),
            "roster_revision": 3,
            "admission_id": "x",
            "generation": "1",
        })
        .to_string();
        let joined = signed(
            &relay,
            KIND_HUDDLE_PARTICIPANT_JOINED,
            &joined_content,
            vec![vec!["h", parent], vec!["p", &creator_hex]],
        );
        let parsed = lifecycle_event(&joined, parent, eph, &creator_hex, Some(&relay_hex)).unwrap();
        assert_eq!(parsed.roster_revision, Some(3));
        assert_eq!(
            parsed.participant_pubkey.as_deref(),
            Some(creator_hex.as_str())
        );
        // A participant event signed by the creator is not the relay's roster fact.
        let self_joined = signed(
            &creator,
            KIND_HUDDLE_PARTICIPANT_JOINED,
            &joined_content,
            vec![vec!["h", parent], vec!["p", &creator_hex]],
        );
        assert!(
            lifecycle_event(&self_joined, parent, eph, &creator_hex, Some(&relay_hex)).is_none()
        );
        let ended = signed(&relay, KIND_HUDDLE_ENDED, &content, vec![vec!["h", parent]]);
        assert!(lifecycle_event(&ended, parent, eph, &creator_hex, Some(&relay_hex)).is_some());
        let other_parent = signed(
            &creator,
            KIND_HUDDLE_STARTED,
            &content,
            vec![vec!["h", "00000000-0000-4000-8000-0000000000cc"]],
        );
        assert!(
            lifecycle_event(&other_parent, parent, eph, &creator_hex, Some(&relay_hex)).is_none()
        );
    }

    #[test]
    fn uplink_accepts_only_v2_frames_and_leave() {
        assert!(!valid_uplink_frame(&[0; AUDIO_HEADER_BYTES]));
        assert!(valid_uplink_frame(&[0; AUDIO_HEADER_BYTES + 1]));
        assert!(!valid_uplink_frame(&vec![0; MAX_AUDIO_FRAME_BYTES + 1]));
        assert!(is_leave_message(r#"{"type":"leave"}"#));
        assert!(!is_leave_message(r#"{"type":"auth","event":{}}"#));
        assert!(!is_leave_message(r#"{"type":"leave","extra":1}"#));
        assert!(!is_leave_message("leave"));
    }
}
