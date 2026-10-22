//! DD-134(3)⑥：Gateway ConfigResource 的 Core 写入证据。
//!
//! ConfigResourceStore 只保存当前值与递增 revision（SF-AGW-28），因此版本历史由
//! Core 在每次写入并回读确认后自己保存。写入点以 [`scope`] 声明产生该写入的
//! ActionExecution 与 operation；没有声明的写入只记录值与 revision，不猜测归属。
//!
//! 证据是写入成功之后的追加记录：记录失败只告警，不让已完成的投影写入失败——
//! 缺失证据的 revision 在管理区显示为 `UNRECORDED`，与外部写入同等对待。

use std::future::Future;
use std::sync::OnceLock;

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgPool;
use uuid::Uuid;

tokio::task_local! {
    static EXECUTION: (Uuid, Uuid);
}

static POOL: OnceLock<PgPool> = OnceLock::new();

/// 进程启动时登记写入证据使用的连接池；未登记（单元测试）时不记录。
pub(crate) fn install(pool: PgPool) {
    let _ = POOL.set(pool);
}

/// 是否会记录证据：未登记连接池时写入点跳过额外的回读。
pub(crate) fn enabled() -> bool {
    POOL.get().is_some()
}

/// 在 `fut` 内发生的 Gateway ConfigResource 写入归属到该 ActionExecution 与 operation。
pub(crate) async fn scope<F: Future>(
    action_execution_id: Uuid,
    operation_id: Uuid,
    fut: F,
) -> F::Output {
    EXECUTION
        .scope((action_execution_id, operation_id), fut)
        .await
}

/// 当前任务声明的写入归属；未声明时为 `None`。
pub(crate) fn current() -> Option<(Uuid, Uuid)> {
    EXECUTION.try_with(|value| *value).ok()
}

/// 一次已回读确认的写入：`value=None` 表示删除墓碑。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Written {
    pub kind: String,
    pub id: String,
    pub revision: i64,
    pub value: Option<Value>,
}

fn digest(value: &Value) -> String {
    collab_bridge::limits::canonical_digest(value)
}

/// 在写入后的 ConfigResource 列表里找出本次写入的行：值相等，或同名，或同 keyHash。
pub(crate) fn match_written(kind: &str, written: &[Value], rows: &[Value]) -> Vec<Written> {
    let mut found = Vec::new();
    for value in written {
        let same = |row_value: &Value| {
            row_value == value
                || ["name", "keyHash"].iter().any(|field| {
                    value
                        .get(*field)
                        .and_then(Value::as_str)
                        .is_some_and(|expected| {
                            !expected.is_empty()
                                && row_value.get(*field).and_then(Value::as_str) == Some(expected)
                        })
                })
        };
        let mut matching = rows.iter().filter(|row| {
            row.get("kind").and_then(Value::as_str) == Some(kind)
                && row.get("value").is_some_and(same)
        });
        let (Some(row), None) = (matching.next(), matching.next()) else {
            continue;
        };
        let (Some(id), Some(revision)) = (
            row.get("id").and_then(Value::as_str),
            row.get("revision").and_then(Value::as_i64),
        ) else {
            continue;
        };
        found.push(Written {
            kind: kind.into(),
            id: id.into(),
            revision,
            value: row.get("value").cloned(),
        });
    }
    found
}

/// 追加写入证据（幂等：同一 kind/id/revision 只记一次）。
pub(crate) async fn record(written: Vec<Written>) {
    let Some(pool) = POOL.get() else {
        return;
    };
    let attribution = current();
    for entry in written {
        let value = entry.value.clone().unwrap_or(Value::Null);
        let result = sqlx::query(
            "insert into projection.gateway_config_revision
               (id,kind,resource_id,revision,deleted,masked_value,value_digest,action_execution_id,operation_id)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             on conflict (kind,resource_id,revision) do nothing",
        )
        .bind(Uuid::new_v4())
        .bind(&entry.kind)
        .bind(&entry.id)
        .bind(entry.revision)
        .bind(entry.value.is_none())
        .bind(crate::gateway_admin::mask::mask(&value))
        .bind(digest(&value))
        .bind(attribution.map(|(ae, _)| ae))
        .bind(attribution.map(|(_, operation)| operation))
        .execute(pool)
        .await;
        if let Err(error) = result {
            tracing::warn!(%error, kind = %entry.kind, id = %entry.id, revision = entry.revision,
                "Gateway ConfigResource 写入证据未能保存，该 revision 将显示为 UNRECORDED");
        }
    }
}

/// 一条已保存的写入证据。
#[derive(Debug, Clone, sqlx::FromRow)]
pub(crate) struct Evidence {
    pub kind: String,
    pub resource_id: String,
    pub revision: i64,
    pub deleted: bool,
    pub masked_value: Value,
    pub value_digest: String,
    pub action_execution_id: Option<Uuid>,
    pub operation_id: Option<Uuid>,
    pub action_key: Option<String>,
    pub recorded_at: DateTime<Utc>,
}

const EVIDENCE_SELECT: &str = "select e.kind,e.resource_id,e.revision,e.deleted,e.masked_value,e.value_digest,
       e.action_execution_id,e.operation_id,a.action_key,e.recorded_at
     from projection.gateway_config_revision e
     left join admission.action_execution a on a.id=e.action_execution_id";

/// 一个 ConfigResource 的全部证据，revision 升序；上限防止异常写入量拖垮读取。
pub(crate) async fn evidence(
    pool: &PgPool,
    kind: &str,
    id: &str,
    limit: i64,
) -> Result<Vec<Evidence>, sqlx::Error> {
    let mut rows: Vec<Evidence> = sqlx::query_as(&format!(
        "{EVIDENCE_SELECT} where e.kind=$1 and e.resource_id=$2 order by e.revision desc limit $3"
    ))
    .bind(kind)
    .bind(id)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    rows.reverse();
    Ok(rows)
}

/// 指定 (kind, id, revision) 集合中有证据的行。
pub(crate) async fn evidence_for(
    pool: &PgPool,
    keys: &[(String, String, i64)],
) -> Result<Vec<Evidence>, sqlx::Error> {
    if keys.is_empty() {
        return Ok(Vec::new());
    }
    let kinds: Vec<&str> = keys.iter().map(|k| k.0.as_str()).collect();
    let ids: Vec<&str> = keys.iter().map(|k| k.1.as_str()).collect();
    let revisions: Vec<i64> = keys.iter().map(|k| k.2).collect();
    sqlx::query_as(&format!(
        "{EVIDENCE_SELECT} join unnest($1::text[],$2::text[],$3::bigint[]) as k(kind,resource_id,revision)
           on k.kind=e.kind and k.resource_id=e.resource_id and k.revision=e.revision"
    ))
    .bind(kinds)
    .bind(ids)
    .bind(revisions)
    .fetch_all(pool)
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn matches_written_rows_by_value_name_or_key_hash() {
        let rows = vec![
            json!({"kind":"traffic.route","id":"r1","revision":3,"value":{"name":"r1","x":1}}),
            json!({"kind":"traffic.route","id":"r2","revision":1,"value":{"name":"r2"}}),
            json!({"kind":"llm.apiKey","id":"k9","revision":2,
                "value":{"keyHash":"sha256:aa","metadata":{"agentgateway.dev/id":"k9"}}}),
        ];
        let found = match_written("traffic.route", &[json!({"name":"r1","x":1})], &rows);
        assert_eq!(found.len(), 1);
        assert_eq!((found[0].id.as_str(), found[0].revision), ("r1", 3));
        let keys = match_written("llm.apiKey", &[json!({"keyHash":"sha256:aa"})], &rows);
        assert_eq!(keys[0].id, "k9");
        assert!(match_written("traffic.route", &[json!({"name":"absent"})], &rows).is_empty());
    }

    #[tokio::test]
    async fn scope_attributes_only_inside_the_future() {
        let ae = Uuid::new_v4();
        let op = Uuid::new_v4();
        assert_eq!(current(), None);
        let inside = scope(ae, op, async { current() }).await;
        assert_eq!(inside, Some((ae, op)));
        assert_eq!(current(), None);
    }
}
