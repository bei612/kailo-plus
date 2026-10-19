//! DD-125(2)：原 Buzz 社区审核在 Relay 上的线协议（SF-BUZ-52）。
//!
//! Relay 的举报、限制与审核日志表是唯一权威；这里只把 Core 已准入的意图映射为原版
//! 命令事件与原版 NIP-98 读取，不判定任何授权。9040–9044 与 9005 只由 Tenant CONTROL
//! 签名（SS-BUZ-GOVERNANCE、DD-80），1984 由成员本人签名。标签词表与
//! `buzz-relay/src/handlers/{report,moderation_commands}.rs` 逐字一致。

use nostr::Event;
use serde::Deserialize;
use serde_json::Value;

use crate::bridge::{Delivery, IdentityClient};
use crate::operator::OperatorError;

pub use buzz_core::kind::{
    KIND_MODERATION_BAN, KIND_MODERATION_RESOLVE_REPORT, KIND_MODERATION_TIMEOUT,
    KIND_MODERATION_UNBAN, KIND_MODERATION_UNTIMEOUT, KIND_NIP29_DELETE_EVENT, KIND_REPORT,
};

/// Relay 单次审核读取的行数上界（`api/bridge.rs::MODERATION_READ_LIMIT`）。
pub const READ_LIMIT: usize = 500;

/// Relay ingest 接受的事件时间漂移（`handlers/ingest.rs::MAX_TIMESTAMP_DRIFT_SECS`）。
/// 一条签名时间早于「现在减去它」的 1984 不可能再被 Relay 接受。
pub const RELAY_TIMESTAMP_DRIFT_SECS: i64 = 900;

/// 原 NIP-56 举报类型（`handlers/report.rs::REPORT_TYPES`）。
pub const REPORT_TYPES: [&str; 7] = [
    "illegal",
    "nudity",
    "malware",
    "spam",
    "impersonation",
    "profanity",
    "other",
];

const TIMEOUT_PREFIX: &str = "restricted: you are timed out until";
const BANNED_PREFIX: &str = "blocked: you are banned";

/// Relay `/moderation/reports` 的一行（`report_json`）。时间是 RFC3339 文本。
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct ReportRow {
    pub id: String,
    pub report_event_id: String,
    pub reporter_pubkey: String,
    pub target_kind: String,
    pub target: String,
    pub channel_id: Option<String>,
    pub report_type: String,
    pub note: Option<String>,
    pub status: String,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<String>,
    pub created_at: String,
}

/// Relay `/moderation/audit` 的一行（`action_json`）。私有理由不读取。
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct AuditRow {
    pub id: String,
    pub actor_pubkey: String,
    pub action: String,
    pub target_pubkey: Option<String>,
    pub target_event_id: Option<String>,
    pub channel_id: Option<String>,
    pub public_reason: Option<String>,
    pub created_at: String,
}

/// Relay `/moderation/restricted` 的一行（`ban_json`）：只列出当前有效的封禁或禁言。
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct RestrictionRow {
    pub pubkey: String,
    pub banned: bool,
    pub ban_expires_at: Option<String>,
    pub muted_until: Option<String>,
    pub updated_at: String,
}

/// Relay 以社区限制拒绝本人写入的原因（`ingest.rs` 写入闸与认证缝的原文）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Restriction {
    /// 禁言；到期 unix 秒在拒绝文本可解析时给出
    TimedOut(Option<i64>),
    Banned,
}

/// 从 Relay 的拒绝原文（可能包在 `HTTP 403 {...}` 里）识别社区限制。其他拒绝返回
/// `None`，由调用方按原路径呈现。前缀决定类别，时刻只尽力解析：解析不出也仍是禁言。
pub fn restriction_from_rejection(message: &str) -> Option<Restriction> {
    if let Some(at) = message.find(TIMEOUT_PREFIX) {
        let rest = message[at + TIMEOUT_PREFIX.len()..].trim_start();
        let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
        let until = digits.parse::<i64>().ok().filter(|secs| *secs > 0);
        return Some(Restriction::TimedOut(until));
    }
    message
        .contains(BANNED_PREFIX)
        .then_some(Restriction::Banned)
}

fn tag(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_owned()).collect()
}

/// 原 `submitReport`：`p` 为被举报消息的签名者，举报类型随 `e` 标签第三元素。
pub fn report_tags(author: &str, event_id: &str, report_type: &str) -> Vec<Vec<String>> {
    vec![tag(&["p", author]), tag(&["e", event_id, report_type])]
}

/// 9040：`expiration` 缺省即永久封禁。
pub fn ban_tags(pubkey: &str, expiration: Option<i64>) -> Vec<Vec<String>> {
    let mut tags = vec![tag(&["p", pubkey])];
    if let Some(at) = expiration {
        tags.push(tag(&["expiration", &at.to_string()]));
    }
    tags
}

/// 9042：禁言必带 `expiration`。
pub fn timeout_tags(pubkey: &str, until: i64) -> Vec<Vec<String>> {
    vec![
        tag(&["p", pubkey]),
        tag(&["expiration", &until.to_string()]),
    ]
}

/// 9041 / 9043：只带目标公钥。
pub fn lift_tags(pubkey: &str) -> Vec<Vec<String>> {
    vec![tag(&["p", pubkey])]
}

/// 9044：每个 tag 恰好一个；只记决定、不执法。
pub fn resolve_tags(report_event_id: &str, status: &str, action: &str) -> Vec<Vec<String>> {
    vec![
        tag(&["report", report_event_id]),
        tag(&["status", status]),
        tag(&["action", action]),
    ]
}

/// 9005：所在 Channel 的 `h` 与唯一目标 `e`。
pub fn delete_tags(channel: &str, event_id: &str) -> Vec<Vec<String>> {
    vec![tag(&["h", channel]), tag(&["e", event_id])]
}

/// 十六进制事件 ID 或公钥：64 位小写。
pub fn is_hex64(value: &str) -> bool {
    let lower_hex = |c: char| c.is_ascii_digit() || ('a'..='f').contains(&c);
    value.len() == 64 && value.chars().all(lower_hex)
}

fn rows<T: serde::de::DeserializeOwned>(page: Value) -> Result<Vec<T>, OperatorError> {
    serde_json::from_value(page).map_err(|e| OperatorError::Sign(format!("审核读取回应: {e}")))
}

impl IdentityClient {
    /// `GET /moderation/reports`：按创建时间倒序，至多 [`READ_LIMIT`] 行。
    pub async fn moderation_reports(
        &self,
        http: &reqwest::Client,
        status: Option<&str>,
    ) -> Result<Vec<ReportRow>, OperatorError> {
        let path = match status {
            Some(status) => format!("/moderation/reports?status={status}"),
            None => "/moderation/reports".to_owned(),
        };
        rows(self.bridge_get(http, &path).await?)
    }

    /// `GET /moderation/audit`：审核日志，按时间倒序，至多 [`READ_LIMIT`] 行。
    pub async fn moderation_audit(
        &self,
        http: &reqwest::Client,
    ) -> Result<Vec<AuditRow>, OperatorError> {
        rows(self.bridge_get(http, "/moderation/audit").await?)
    }

    /// `GET /moderation/restricted`：当前有效的封禁与禁言。
    pub async fn moderation_restricted(
        &self,
        http: &reqwest::Client,
    ) -> Result<Vec<RestrictionRow>, OperatorError> {
        rows(self.bridge_get(http, "/moderation/restricted").await?)
    }

    /// 签一条审核命令或举报。命令从不存储，签名后立即发送（Relay 只接受 ±120 秒）。
    pub fn sign_moderation(
        &self,
        kind: u32,
        content: &str,
        tags: &[Vec<String>],
    ) -> Result<Event, OperatorError> {
        let kind = u16::try_from(kind).map_err(|_| OperatorError::Sign("kind 越界".into()))?;
        self.sign(kind, content, tags)
    }

    /// 送出一条已签好的审核事件；回应分类同 [`IdentityClient::deliver`]。
    pub async fn deliver_moderation(&self, http: &reqwest::Client, event: &Event) -> Delivery {
        match self.admit() {
            Ok(admitted) => self.deliver(http, event, admitted).await,
            Err(e) => match e.limit() {
                Some(kind) => Delivery::Limited(kind, e.to_string()),
                None => Delivery::Unknown(e.to_string()),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|part| (*part).to_owned()).collect()
    }

    #[test]
    fn timeout_rejection_keeps_category_even_without_a_timestamp() {
        let wrapped = r#"HTTP 403 {"error":"restricted: you are timed out until 1760000000"}"#;
        let known = Some(Restriction::TimedOut(Some(1_760_000_000)));
        assert_eq!(restriction_from_rejection(wrapped), known);
        let unparsed = "restricted: you are timed out until soon";
        let unknown = Some(Restriction::TimedOut(None));
        assert_eq!(restriction_from_rejection(unparsed), unknown);
        let banned = "blocked: you are banned from this community";
        let ban = Some(Restriction::Banned);
        assert_eq!(restriction_from_rejection(banned), ban);
        let reserved = "restricted: kind 9 is reserved to the community owner";
        assert_eq!(restriction_from_rejection(reserved), None);
        assert_eq!(restriction_from_rejection("invalid: bad"), None);
    }

    #[test]
    fn command_tags_match_the_relay_vocabulary() {
        let pk = "b".repeat(64);
        let id = "a".repeat(64);
        let report = vec![row(&["p", &pk]), row(&["e", &id, "spam"])];
        assert_eq!(report_tags(&pk, &id, "spam"), report);
        assert_eq!(ban_tags(&pk, None), vec![row(&["p", &pk])]);
        assert_eq!(ban_tags(&pk, Some(7))[1], row(&["expiration", "7"]));
        let until = row(&["expiration", "1760000000"]);
        assert_eq!(timeout_tags(&pk, 1_760_000_000)[1], until);
        assert_eq!(lift_tags(&pk), vec![row(&["p", &pk])]);
        let resolve = vec![
            row(&["report", &id]),
            row(&["status", "dismissed"]),
            row(&["action", "dismiss"]),
        ];
        assert_eq!(resolve_tags(&id, "dismissed", "dismiss"), resolve);
        let delete = vec![row(&["h", "chan"]), row(&["e", &id])];
        assert_eq!(delete_tags("chan", &id), delete);
    }

    #[test]
    fn relay_rows_parse_from_the_original_json_shape() {
        let reports: Vec<ReportRow> = rows(serde_json::json!([{
            "id": "00000000-0000-4000-8000-000000000001",
            "report_event_id": "c".repeat(64),
            "reporter_pubkey": "e".repeat(64),
            "target_kind": "event",
            "target": "a".repeat(64),
            "channel_id": "00000000-0000-4000-8000-000000000002",
            "report_type": "spam",
            "note": null,
            "status": "open",
            "resolved_by": null,
            "resolved_at": null,
            "action_id": null,
            "created_at": "2026-10-19T08:00:00.123456Z"
        }]))
        .unwrap();
        assert_eq!(reports[0].status, "open");
        assert_eq!(reports[0].note, None);
        let restricted: Vec<RestrictionRow> = rows(serde_json::json!([{
            "pubkey": "b".repeat(64),
            "banned": false,
            "ban_expires_at": null,
            "ban_reason": null,
            "muted_until": "2026-10-20T08:30:00Z",
            "mute_reason": null,
            "actor_pubkey": "9".repeat(64),
            "updated_at": "2026-10-19T08:30:00Z"
        }]))
        .unwrap();
        let muted = restricted[0].muted_until.as_deref();
        assert_eq!(muted, Some("2026-10-20T08:30:00Z"));
        assert!(is_hex64(&"a".repeat(64)));
        assert!(!is_hex64(&"A".repeat(64)));
        assert!(!is_hex64("abc"));
    }
}
