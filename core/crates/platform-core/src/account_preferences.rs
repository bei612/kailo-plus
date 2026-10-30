//! AccountPreferences（`.design/03` §2、DD-164(7)、`07` §4.8.2）。
//!
//! 主题（含强调色与跟随系统）、语言与 DD-138 组件偏好是账号偏好：权威在 Core，
//! 每个 HumanIdentity 一份，跨 Tenant 与设备；各端本机存储只作缓存。写入取
//! PlatformSession 的 HUMAN，不建立 ActionExecution，也不审计取值——与
//! CollaborationUserState 的个人状态写入同一纪律。
//!
//! 写入按 `version` 比较并交换：三端并发改同一份偏好时，后写的不能凭空覆盖先写
//! 的；冲突回 409 与当前值，由客户端取当前值后重放它这一项改动。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{
    AccountPreferences, AccountPreferencesComponentPreference, AccountPreferencesUpdate,
    AccountPreferencesUpdateComponentPreference, ProtocolSessionLocale,
};
use serde_json::{Map, Value};
use std::collections::HashMap;
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState};

/// `07` §4.8.2 至多 16 项一个 release；账号跨多个组件，上限按 64 键。
const MAX_COMPONENT_PREFERENCES: usize = 64;

#[derive(sqlx::FromRow)]
struct Row {
    theme: Option<String>,
    accent: Option<String>,
    follow_system: Option<bool>,
    locale: Option<String>,
    component_preferences: Value,
    version: i32,
    updated_at: chrono::DateTime<chrono::Utc>,
}

/// 存储层的完整状态；`version` 0 表示还没写过（没有行）。
#[derive(Debug, Clone, Default, PartialEq)]
struct Stored {
    theme: Option<String>,
    accent: Option<String>,
    follow_system: Option<bool>,
    locale: Option<String>,
    component_preferences: Map<String, Value>,
    version: i32,
    updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

fn locale_wire(value: &str) -> Option<ProtocolSessionLocale> {
    match value {
        "zh-CN" => Some(ProtocolSessionLocale::ZhCn),
        "en" => Some(ProtocolSessionLocale::En),
        _ => None,
    }
}

fn locale_text(value: &ProtocolSessionLocale) -> &'static str {
    match value {
        ProtocolSessionLocale::ZhCn => "zh-CN",
        ProtocolSessionLocale::En => "en",
    }
}

impl Stored {
    fn from_row(row: Row) -> Option<Self> {
        let component_preferences = row.component_preferences.as_object()?.clone();
        // 库里的值必须仍满足写入路径的形状；不满足即视为损坏而不是照样下发。
        if component_preferences.len() > MAX_COMPONENT_PREFERENCES
            || component_preferences
                .iter()
                .any(|(k, v)| !valid_preference_key(k) || !valid_preference_value(v))
            || row.theme.as_deref().is_some_and(|t| !valid_theme(t))
            || row.accent.as_deref().is_some_and(|a| !valid_accent(a))
            || row
                .locale
                .as_deref()
                .is_some_and(|l| locale_wire(l).is_none())
            || row.version < 1
        {
            return None;
        }
        Some(Self {
            theme: row.theme,
            accent: row.accent,
            follow_system: row.follow_system,
            locale: row.locale,
            component_preferences,
            version: row.version,
            updated_at: Some(row.updated_at),
        })
    }

    fn view(&self) -> AccountPreferences {
        let component_preferences: HashMap<String, AccountPreferencesComponentPreference> = self
            .component_preferences
            .iter()
            .filter_map(|(k, v)| {
                let value = match v {
                    Value::Bool(b) => AccountPreferencesComponentPreference::Bool(*b),
                    Value::String(s) => AccountPreferencesComponentPreference::String(s.clone()),
                    _ => return None,
                };
                Some((k.clone(), value))
            })
            .collect();
        AccountPreferences {
            accent: self.accent.clone(),
            component_preferences,
            follow_system: self.follow_system,
            locale: self.locale.as_deref().and_then(locale_wire),
            theme: self.theme.clone(),
            updated_at: self.updated_at.map(|t| t.to_rfc3339()),
            version: i64::from(self.version),
        }
    }
}

/// 主题名：1–64 个 `[a-z0-9-]`，首字符为字母或数字。主题是否存在由客户端按其
/// 主题表判断（未知主题回落默认），Core 只守形状。
pub(crate) fn valid_theme(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 64
        && (bytes[0].is_ascii_lowercase() || bytes[0].is_ascii_digit())
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

/// 强调色：`neutral`、`kailo-brand` 或 `#rrggbb`。
pub(crate) fn valid_accent(value: &str) -> bool {
    if matches!(value, "neutral" | "kailo-brand") {
        return true;
    }
    value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// `07` §4.8.2 的偏好键：以 `.` 连接的 2–4 段，每段小写字母开头、只含字母与数字，
/// 总长 ≤ 64。
pub(crate) fn valid_preference_key(key: &str) -> bool {
    if key.is_empty() || key.len() > 64 {
        return false;
    }
    let segments: Vec<&str> = key.split('.').collect();
    (2..=4).contains(&segments.len())
        && segments.iter().all(|s| {
            let mut chars = s.chars();
            chars.next().is_some_and(|c| c.is_ascii_lowercase())
                && chars.all(|c| c.is_ascii_alphanumeric())
        })
}

/// 值只是布尔或封闭选项（1–32 个 `[A-Za-z0-9._-]`），不接受自由文本或用户数据。
pub(crate) fn valid_preference_value(value: &Value) -> bool {
    match value {
        Value::Bool(_) => true,
        Value::String(s) => {
            !s.is_empty()
                && s.len() <= 32
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
        }
        _ => false,
    }
}

/// 把一次部分更新合并到当前状态。不合法即整体拒绝（返回 None），不部分采纳。
fn merge(current: &Stored, update: &AccountPreferencesUpdate) -> Option<Stored> {
    let mut next = current.clone();
    if let Some(theme) = &update.theme {
        if !valid_theme(theme) {
            return None;
        }
        next.theme = Some(theme.clone());
    }
    if let Some(accent) = &update.accent {
        if !valid_accent(accent) {
            return None;
        }
        next.accent = Some(accent.clone());
    }
    if let Some(follow) = update.follow_system {
        next.follow_system = Some(follow);
    }
    if let Some(locale) = &update.locale {
        next.locale = Some(locale_text(locale).to_owned());
    }
    if let Some(entries) = &update.component_preferences {
        for (key, value) in entries {
            if !valid_preference_key(key) {
                return None;
            }
            match value {
                None => {
                    next.component_preferences.remove(key);
                }
                Some(value) => {
                    let value = match value {
                        AccountPreferencesUpdateComponentPreference::Bool(b) => Value::Bool(*b),
                        AccountPreferencesUpdateComponentPreference::String(s) => {
                            Value::String(s.clone())
                        }
                    };
                    if !valid_preference_value(&value) {
                        return None;
                    }
                    next.component_preferences.insert(key.clone(), value);
                }
            }
        }
        if next.component_preferences.len() > MAX_COMPONENT_PREFERENCES {
            return None;
        }
    }
    Some(next)
}

/// 线上请求必须恰好是合同形状：生成类型会默默丢弃未知字段，这里以往返比较拒绝它们。
fn parse_update(raw: &Value) -> Option<AccountPreferencesUpdate> {
    let typed: AccountPreferencesUpdate = serde_json::from_value(raw.clone()).ok()?;
    // `null` 删除键在类型里是 `None`，序列化后仍为 null；顶层可选字段缺省即省略。
    let round = serde_json::to_value(&typed).ok()?;
    if round != *raw || typed.expected_version < 0 {
        return None;
    }
    Some(typed)
}

async fn load(pool: &sqlx::PgPool, human: Uuid) -> Result<Stored, Response> {
    let row: Option<Row> = sqlx::query_as(
        "select theme, accent, follow_system, locale, component_preferences, version, updated_at
         from identity.account_preferences where human_identity_id = $1",
    )
    .bind(human)
    .fetch_optional(pool)
    .await
    .map_err(|error| {
        tracing::warn!(%error, "账号偏好读取失败");
        crate::user_state::user_state_unavailable()
    })?;
    match row {
        // 没有行不是错误：还没设过任何偏好，各端用自己的默认值。读取不建行。
        None => Ok(Stored::default()),
        Some(row) => Stored::from_row(row).ok_or_else(|| {
            tracing::warn!("账号偏好不符合写入方的形状");
            crate::user_state::user_state_unavailable()
        }),
    }
}

pub async fn get(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    match load(&state.pool, ctx.human_identity_id).await {
        Ok(stored) => (
            StatusCode::OK,
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(stored.view()),
        )
            .into_response(),
        Err(r) => r,
    }
}

fn conflict(current: &Stored) -> Response {
    (
        StatusCode::CONFLICT,
        [(axum::http::header::CACHE_CONTROL, "no-store")],
        Json(current.view()),
    )
        .into_response()
}

pub async fn put(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(r) => return r,
    };
    let Ok(Json(raw)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(update) = parse_update(&raw) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let current = match load(&state.pool, ctx.human_identity_id).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    if i64::from(current.version) != update.expected_version {
        return conflict(&current);
    }
    let Some(next) = merge(&current, &update) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let preferences = Value::Object(next.component_preferences.clone());
    // 条件写入：第一次写只在仍无行时插入，之后只在版本未变时更新；零行即并发冲突。
    // updated_at 用库时钟，不取调用方的值。
    let written: Result<Option<Row>, sqlx::Error> = if current.version == 0 {
        sqlx::query_as(
            "insert into identity.account_preferences
               (human_identity_id, theme, accent, follow_system, locale, component_preferences, version)
             values ($1, $2, $3, $4, $5, $6, 1)
             on conflict (human_identity_id) do nothing
             returning theme, accent, follow_system, locale, component_preferences, version, updated_at",
        )
        .bind(ctx.human_identity_id)
        .bind(&next.theme)
        .bind(&next.accent)
        .bind(next.follow_system)
        .bind(&next.locale)
        .bind(&preferences)
        .fetch_optional(&state.pool)
        .await
    } else {
        sqlx::query_as(
            "update identity.account_preferences
             set theme = $2, accent = $3, follow_system = $4, locale = $5,
                 component_preferences = $6, version = version + 1, updated_at = now()
             where human_identity_id = $1 and version = $7
             returning theme, accent, follow_system, locale, component_preferences, version, updated_at",
        )
        .bind(ctx.human_identity_id)
        .bind(&next.theme)
        .bind(&next.accent)
        .bind(next.follow_system)
        .bind(&next.locale)
        .bind(&preferences)
        .bind(current.version)
        .fetch_optional(&state.pool)
        .await
    };
    match written {
        Ok(Some(row)) => match Stored::from_row(row) {
            Some(stored) => (
                StatusCode::OK,
                [(axum::http::header::CACHE_CONTROL, "no-store")],
                Json(stored.view()),
            )
                .into_response(),
            None => crate::user_state::user_state_unavailable(),
        },
        Ok(None) => match load(&state.pool, ctx.human_identity_id).await {
            Ok(fresh) => conflict(&fresh),
            Err(r) => r,
        },
        Err(error) => {
            tracing::warn!(%error, "账号偏好写入失败");
            crate::user_state::user_state_unavailable()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn theme_accent_and_keys_follow_the_declared_shapes() {
        for ok in ["buzz", "buzz-dark", "catppuccin-latte", "a", "1x"] {
            assert!(valid_theme(ok), "{ok}");
        }
        for bad in ["", "-x", "Buzz", "buzz_dark", "buzz dark", &"a".repeat(65)] {
            assert!(!valid_theme(bad), "{bad}");
        }
        for ok in ["neutral", "kailo-brand", "#3b82f6", "#ABCDEF"] {
            assert!(valid_accent(ok), "{ok}");
        }
        for bad in ["", "blue", "#3b82f", "#3b82f6a", "3b82f6a", "#zzzzzz"] {
            assert!(!valid_accent(bad), "{bad}");
        }
        for ok in ["documents.measurementUnit", "a.b", "a1.b2.c3.d4"] {
            assert!(valid_preference_key(ok), "{ok}");
        }
        for bad in [
            "documents",
            "a.b.c.d.e",
            "Documents.x",
            "a..b",
            "a.b-c",
            "a.1b",
            "",
        ] {
            assert!(!valid_preference_key(bad), "{bad}");
        }
        assert!(!valid_preference_key(&format!("a.{}", "b".repeat(63))));
        assert!(valid_preference_value(&json!(true)));
        assert!(valid_preference_value(&json!("cm")));
        for bad in [
            json!(""),
            json!("a b"),
            json!("x".repeat(33)),
            json!(1),
            json!(null),
            json!({}),
        ] {
            assert!(!valid_preference_value(&bad), "{bad}");
        }
    }

    #[test]
    fn partial_update_merges_and_null_removes_a_preference() {
        let mut current = Stored {
            theme: Some("buzz".into()),
            version: 3,
            ..Default::default()
        };
        current
            .component_preferences
            .insert("documents.unit".into(), json!("cm"));
        current
            .component_preferences
            .insert("answers.showSql".into(), json!(true));
        let update = parse_update(&json!({
            "expectedVersion": 3,
            "locale": "en",
            "followSystem": false,
            "componentPreferences": {"documents.unit": null, "answers.showSql": false, "documents.ruler": true}
        }))
        .unwrap();
        let next = merge(&current, &update).unwrap();
        assert_eq!(next.theme.as_deref(), Some("buzz"));
        assert_eq!(next.locale.as_deref(), Some("en"));
        assert_eq!(next.follow_system, Some(false));
        assert_eq!(
            Value::Object(next.component_preferences.clone()),
            json!({"answers.showSql": false, "documents.ruler": true})
        );
        let view = serde_json::to_value(next.view()).unwrap();
        assert_eq!(view["locale"], "en");
        assert_eq!(view["componentPreferences"]["documents.ruler"], true);
    }

    #[test]
    fn invalid_or_unknown_input_is_refused_whole() {
        for raw in [
            json!({}),
            json!({"expectedVersion": -1}),
            json!({"expectedVersion": 0, "unknown": 1}),
            json!({"expectedVersion": 0, "locale": "fr"}),
            json!({"expectedVersion": "0"}),
        ] {
            assert!(parse_update(&raw).is_none(), "{raw}");
        }
        let current = Stored::default();
        for raw in [
            json!({"expectedVersion": 0, "theme": "Bad Theme"}),
            json!({"expectedVersion": 0, "accent": "red"}),
            json!({"expectedVersion": 0, "componentPreferences": {"nodots": true}}),
            json!({"expectedVersion": 0, "componentPreferences": {"a.b": "free text"}}),
        ] {
            let update = parse_update(&raw).unwrap();
            assert!(merge(&current, &update).is_none(), "{raw}");
        }
        let many: Map<String, Value> = (0..65).map(|i| (format!("a.k{i}"), json!(true))).collect();
        let update =
            parse_update(&json!({"expectedVersion": 0, "componentPreferences": many})).unwrap();
        assert!(merge(&current, &update).is_none());
    }

    #[test]
    fn an_account_without_preferences_reads_as_version_zero() {
        let view = serde_json::to_value(Stored::default().view()).unwrap();
        assert_eq!(view, json!({"componentPreferences": {}, "version": 0}));
    }
}
