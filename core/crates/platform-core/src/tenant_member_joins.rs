//! 新成员加入提醒的只读投影（DD-125(9)、03 §2、05 §2.11、V-SCN-166/167）。
//!
//! 来源只有 TenantMembership 转入 `ACTIVE` 时在同一 UPDATE 记下的 `activated_at`
//! （`membership_state`），按 HUMAN Principal 计；新设备公钥（DD-77）不改它，
//! Relay 的 13534/8000 不是来源。Web 与 Desktop 共用这条请求–响应路由：每次请求
//! fresh 校验 Tenant `manage`，失去即 `PERMISSION_DENIED`。它是成员事实的投影，
//! 不建立 ActionExecution，也不写访问审计（05 §2.11）。

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, SecondsFormat, Utc};
use contracts::{ReasonCode, TenantMemberJoinPage, TenantMemberJoinView};
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::bff::{resolve_execution_context, BffState};
use crate::governance::Refusal;
use crate::spicedb::Consistency;

/// 单页上界。客户端前台每 30 秒读取一次，超出部分以 `hasMore` 续读。
const PAGE_LIMIT: usize = 50;

/// 进入时刻取自转换语句执行时刻，提交顺序可能与之相反；只读取已稳定一段时间的
/// 位置，避免较早时刻的行在游标越过之后才提交而被永久跳过。
const SETTLE_SECONDS: f64 = 10.0;

#[derive(Deserialize)]
pub struct JoinQuery {
    after: Option<String>,
}

/// （进入时刻，membership）全序位置。Postgres timestamptz 精度是微秒，
/// 因此按微秒编码不丢序。
#[derive(Debug, Clone, Copy, PartialEq, Eq, sqlx::FromRow)]
struct Position {
    activated_at: DateTime<Utc>,
    membership_id: Uuid,
}

#[derive(Debug, PartialEq, Eq)]
struct InvalidCursor;

/// 不透明游标：`<微秒>~<membership id>` 的 base64url（无填充）。空串表示起点。
fn encode(position: Option<Position>) -> String {
    match position {
        Some(p) => {
            let micros = p.activated_at.timestamp_micros();
            URL_SAFE_NO_PAD.encode(format!("{micros}~{}", p.membership_id))
        }
        None => String::new(),
    }
}

/// 只接受本服务签出的规范拼写：解码后再编码必须逐字节相同，
/// 前导零、`+` 号、大写或不带连字符的 UUID 等同义写法一律拒绝。
fn decode(cursor: &str) -> Result<Option<Position>, InvalidCursor> {
    if cursor.is_empty() {
        return Ok(None);
    }
    let bytes = URL_SAFE_NO_PAD.decode(cursor).map_err(|_| InvalidCursor)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| InvalidCursor)?;
    let (micros, id) = text.split_once('~').ok_or(InvalidCursor)?;
    let micros: i64 = micros.parse().map_err(|_| InvalidCursor)?;
    let at = DateTime::from_timestamp_micros(micros);
    let position = Position {
        activated_at: at.ok_or(InvalidCursor)?,
        membership_id: Uuid::parse_str(id).map_err(|_| InvalidCursor)?,
    };
    if encode(Some(position)) != cursor {
        return Err(InvalidCursor);
    }
    Ok(Some(position))
}

#[derive(sqlx::FromRow)]
struct JoinRow {
    membership_id: Uuid,
    activated_at: DateTime<Utc>,
    principal_id: Uuid,
    display_name: String,
    /// ACTIVE HUMAN Principal 且不是请求者本人。不合格的行仍推进游标，
    /// 否则同一批行会在每次轮询里被重复扫描。
    eligible: bool,
}

impl JoinRow {
    fn position(&self) -> Position {
        Position {
            activated_at: self.activated_at,
            membership_id: self.membership_id,
        }
    }
}

fn rfc3339(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::AutoSi, true)
}

/// 一页扫描结果 → 回应。`rows` 已按位置升序，且最多多取一行用于判断 `hasMore`。
fn assemble(
    mut rows: Vec<JoinRow>,
    after: Option<Position>,
) -> (Vec<TenantMemberJoinView>, String, bool) {
    let more = rows.len() > PAGE_LIMIT;
    rows.truncate(PAGE_LIMIT);
    let cursor = encode(rows.last().map(JoinRow::position).or(after));
    let items = rows
        .into_iter()
        .filter(|row| row.eligible)
        .map(|row| TenantMemberJoinView {
            principal_id: row.principal_id.to_string(),
            display_name: row.display_name,
            joined_at: rfc3339(row.activated_at),
        })
        .collect();
    (items, cursor, more)
}

pub async fn list(
    State(state): State<BffState>,
    Query(query): Query<JoinQuery>,
    headers: HeaderMap,
) -> Response {
    let mut response = joins(&state, &headers, query.after.as_deref()).await;
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        axum::http::HeaderValue::from_static("no-store"),
    );
    response
}

async fn joins(state: &BffState, headers: &HeaderMap, after: Option<&str>) -> Response {
    let ctx = match resolve_execution_context(state, headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    // 每次 fresh：admin 在待发窗口内被撤销后，下一次读取即被拒（V-SCN-167）。
    match state
        .governance
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "manage",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(check) if check.allowed => {}
        Ok(_) => return Refusal::Denied(ReasonCode::PermissionDenied).respond(None),
        Err(e) => {
            let message = format!("新成员提醒 Tenant manage 判定失败：{e}");
            return Refusal::Unavailable(message).respond(None);
        }
    }
    let Some(after) = after else {
        // 不带游标只给当前位置供建账；位置本身不含任何成员。
        let latest: Result<Option<Position>, _> = sqlx::query_as(
            "select activated_at, id as membership_id from identity.tenant_membership
             where tenant_id = $1 and state = 'ACTIVE' and activated_at is not null
               and activated_at < clock_timestamp() - make_interval(secs => $2)
             order by activated_at desc, id desc limit 1",
        )
        .bind(ctx.tenant_id)
        .bind(SETTLE_SECONDS)
        .fetch_optional(&state.pool)
        .await;
        return match latest {
            Ok(latest) => page(Vec::new(), encode(latest), false),
            Err(e) => Refusal::from(e).respond(None),
        };
    };
    let Ok(after) = decode(after) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let rows: Result<Vec<JoinRow>, _> = sqlx::query_as(
        "select tm.id as membership_id, tm.activated_at, p.id as principal_id, hi.display_name,
                (p.tenant_id = tm.tenant_id and p.kind = 'HUMAN' and p.status = 'ACTIVE'
                 and hi.status = 'ACTIVE' and p.id <> $4) as eligible
         from identity.tenant_membership tm
         join identity.principal p on p.id = tm.tenant_principal_id
         join identity.human_identity hi on hi.id = tm.human_identity_id
         where tm.tenant_id = $1 and tm.state = 'ACTIVE' and tm.activated_at is not null
           and ($2::timestamptz is null or (tm.activated_at, tm.id) > ($2::timestamptz, $3::uuid))
           and tm.activated_at < clock_timestamp() - make_interval(secs => $6)
         order by tm.activated_at, tm.id
         limit $5",
    )
    .bind(ctx.tenant_id)
    .bind(after.map(|p| p.activated_at))
    .bind(after.map(|p| p.membership_id))
    .bind(ctx.tenant_principal_id)
    .bind((PAGE_LIMIT + 1) as i64)
    .bind(SETTLE_SECONDS)
    .fetch_all(&state.pool)
    .await;
    match rows {
        Ok(rows) => {
            let (items, cursor, more) = assemble(rows, after);
            page(items, cursor, more)
        }
        Err(e) => Refusal::from(e).respond(None),
    }
}

/// 回应经生成契约编码，不另写一份跨语言形状。
fn page(items: Vec<TenantMemberJoinView>, cursor: String, more: bool) -> Response {
    let body = json!({"items": items, "cursor": cursor, "hasMore": more});
    match serde_json::from_value::<TenantMemberJoinPage>(body) {
        Ok(page) => (StatusCode::OK, Json(page)).into_response(),
        Err(e) => {
            tracing::error!(error = %e, "新成员提醒回应不符合共享契约");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(micros: i64) -> DateTime<Utc> {
        DateTime::from_timestamp_micros(micros).unwrap()
    }

    fn row(micros: i64, eligible: bool) -> JoinRow {
        JoinRow {
            membership_id: Uuid::new_v4(),
            activated_at: at(micros),
            principal_id: Uuid::new_v4(),
            display_name: format!("member-{micros}"),
            eligible,
        }
    }

    #[test]
    fn cursor_round_trips_and_empty_is_the_origin() {
        let position = Position {
            activated_at: at(1_760_947_200_123_456),
            membership_id: Uuid::new_v4(),
        };
        let cursor = encode(Some(position));
        assert!(!cursor.is_empty());
        let url_safe = |b: u8| b.is_ascii_alphanumeric() || b == b'-' || b == b'_';
        assert!(cursor.bytes().all(url_safe));
        assert_eq!(decode(&cursor), Ok(Some(position)));
        assert_eq!(encode(None), "");
        assert_eq!(decode(""), Ok(None));
    }

    #[test]
    fn malformed_or_non_canonical_cursors_are_rejected() {
        let id = Uuid::new_v4();
        let raw = |text: String| URL_SAFE_NO_PAD.encode(text);
        for cursor in [
            "!!".to_owned(),
            "not base64 at all".to_owned(),
            raw("1760947200000000".to_owned()),
            raw(format!("abc~{id}")),
            raw("1760947200000000~not-a-uuid".to_owned()),
            raw(format!("01760947200000000~{id}")),
            raw(format!("+1760947200000000~{id}")),
            raw(format!(
                "1760947200000000~{}",
                id.to_string().to_uppercase()
            )),
            raw(format!("1760947200000000~{}", id.simple())),
            raw(format!("{}~{id}", i64::MAX)),
            format!("{}=", raw(format!("1760947200000000~{id}"))),
        ] {
            assert_eq!(decode(&cursor), Err(InvalidCursor), "{cursor}");
        }
    }

    #[test]
    fn page_is_bounded_skips_ineligible_rows_and_still_advances_the_cursor() {
        let rows: Vec<JoinRow> = (0..=PAGE_LIMIT as i64)
            .map(|i| row(1_000 + i, i % 10 != 3))
            .collect();
        let last = rows[PAGE_LIMIT - 1].position();
        let first = rows[0].principal_id.to_string();
        let (items, cursor, more) = assemble(rows, None);
        assert!(more);
        assert_eq!(decode(&cursor), Ok(Some(last)));
        // 第 3、13、23、33、43 行不合格；第 51 行只用于判断 hasMore。
        assert_eq!(items.len(), PAGE_LIMIT - 5);
        assert_eq!(items[0].principal_id, first);

        // 只有本人或非 HUMAN 行时不提醒任何人，但游标越过它们。
        let only = row(9_000, false);
        let position = only.position();
        let (items, cursor, more) = assemble(vec![only], None);
        assert!(items.is_empty() && !more);
        assert_eq!(decode(&cursor), Ok(Some(position)));
    }

    #[test]
    fn an_empty_page_keeps_the_requested_position() {
        let after = Position {
            activated_at: at(42),
            membership_id: Uuid::new_v4(),
        };
        let (items, cursor, more) = assemble(Vec::new(), Some(after));
        assert!(items.is_empty() && !more);
        assert_eq!(cursor, encode(Some(after)));
        assert_eq!(assemble(Vec::new(), None).1, "");
    }

    #[test]
    fn joined_at_is_rfc3339_utc_with_the_stored_precision() {
        let (items, _, _) = assemble(vec![row(1_760_947_200_123_456, true)], None);
        assert_eq!(items[0].joined_at, "2025-10-20T08:00:00.123456Z");
    }
}
