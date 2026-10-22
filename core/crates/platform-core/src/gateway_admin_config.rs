//! DD-134(3)⑥(4)：Gateway 实时配置（只读）与 ConfigResource 版本历史。
//!
//! 每次读取 Gateway 的 effective config 与 ConfigResource 列表，在 Core 打码后返回；
//! 管理区不提供任何写配置入口。ConfigResourceStore 只保存当前值与递增 revision
//! （SF-AGW-28），历史取 Core 写入并回读确认时保存的写入证据；当前 revision 没有
//! 证据的显示 `UNRECORDED`（外部写入或早于本证据），按 `17` §9 作为投影不一致信号，
//! 不反向导入。差异在打码后的值上按 RFC 6901 JSON 路径计算。

use std::collections::BTreeSet;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use contracts::{GatewayConfigHistory, GatewayConfigView, ReasonCode};
use serde::Deserialize;
use serde_json::{json, Value};

use super::access::{caller, require_platform, Caller};
use super::history::{evidence, evidence_for, Evidence};
use super::mask::{mask, masked_json};
use super::stats::rfc3339;
use crate::bff::BffState;
use crate::governance::Refusal;

const HISTORY_LIMIT: i64 = 200;

fn unavailable() -> Refusal {
    Refusal::Unavailable("gateway configuration unavailable".into())
}

/// RFC 6901 路径段转义。
fn escape(segment: &str) -> String {
    segment.replace('~', "~0").replace('/', "~1")
}

/// 两个（已打码）值之间的差异：对象逐键、等长数组逐项递归，其余整体比较。
pub(crate) fn diff(before: &Value, after: &Value) -> Vec<Value> {
    let mut changes = Vec::new();
    walk("", before, after, &mut changes);
    changes
}

fn canonical(value: &Value) -> String {
    collab_bridge::limits::canonical_json(value)
}

fn walk(path: &str, before: &Value, after: &Value, changes: &mut Vec<Value>) {
    match (before, after) {
        (Value::Object(a), Value::Object(b)) => {
            let keys: BTreeSet<&String> = a.keys().chain(b.keys()).collect();
            for key in keys {
                let child = format!("{path}/{}", escape(key));
                match (a.get(key), b.get(key)) {
                    (Some(x), Some(y)) => walk(&child, x, y, changes),
                    (Some(x), None) => changes
                        .push(json!({"path":child,"change":"REMOVED","beforeJson":canonical(x)})),
                    (None, Some(y)) => changes
                        .push(json!({"path":child,"change":"ADDED","afterJson":canonical(y)})),
                    (None, None) => {}
                }
            }
        }
        (Value::Array(a), Value::Array(b)) if a.len() == b.len() => {
            for (index, (x, y)) in a.iter().zip(b).enumerate() {
                walk(&format!("{path}/{index}"), x, y, changes);
            }
        }
        _ if before == after => {}
        (Value::Null, _) => {
            changes.push(json!({"path":path,"change":"ADDED","afterJson":canonical(after)}))
        }
        (_, Value::Null) => {
            changes.push(json!({"path":path,"change":"REMOVED","beforeJson":canonical(before)}))
        }
        _ => changes.push(json!({"path":path,"change":"CHANGED",
            "beforeJson":canonical(before),"afterJson":canonical(after)})),
    }
}

fn attribution(view: &mut Value, evidence: &Evidence) {
    if let (Some(ae), Some(operation)) = (evidence.action_execution_id, evidence.operation_id) {
        view["actionExecutionId"] = json!(ae);
        view["operationId"] = json!(operation);
    }
    if let Some(key) = &evidence.action_key {
        view["actionKey"] = json!(key);
    }
}

async fn config_view(state: &BffState, caller: &Caller) -> Result<GatewayConfigView, Refusal> {
    require_platform(state, caller, "audit").await?;
    let gateway = crate::model_route::Gateway::from_env().map_err(|_| unavailable())?;
    let effective = gateway.admin(&["api", "config", "effective"], None).await?;
    let listed = gateway.admin(&["api", "config", "resources"], None).await?;
    let rows = listed
        .get("resources")
        .and_then(Value::as_array)
        .ok_or_else(unavailable)?;
    let mut keys = Vec::new();
    for row in rows {
        let (Some(kind), Some(id), Some(revision)) = (
            row.get("kind").and_then(Value::as_str),
            row.get("id").and_then(Value::as_str),
            row.get("revision").and_then(Value::as_i64),
        ) else {
            return Err(unavailable());
        };
        keys.push((kind.to_owned(), id.to_owned(), revision));
    }
    let recorded = evidence_for(&state.pool, &keys).await?;
    let mut resources = Vec::new();
    for (row, (kind, id, revision)) in rows.iter().zip(&keys) {
        let mut view = json!({"kind":kind,"id":id,"revision":revision,
            "valueJson":masked_json(row.get("value").unwrap_or(&Value::Null)),
            "source":"UNRECORDED"});
        if let Some(updated) = row.get("updatedAt").and_then(Value::as_str) {
            view["updatedAt"] = json!(updated);
        }
        if let Some(evidence) = recorded
            .iter()
            .find(|e| &e.kind == kind && &e.resource_id == id && e.revision == *revision)
        {
            view["source"] = json!("CORE_RECORDED");
            attribution(&mut view, evidence);
        }
        resources.push(view);
    }
    resources.sort_by(|a, b| {
        (a["kind"].as_str(), a["id"].as_str()).cmp(&(b["kind"].as_str(), b["id"].as_str()))
    });
    let value = json!({"readAt":rfc3339(Utc::now()),"effectiveConfigJson":masked_json(&effective),
        "resources":resources});
    serde_json::from_value(value)
        .map_err(|e| Refusal::Unavailable(format!("GatewayConfigView: {e}")))
}

/// `GET /api/v1/platform/gateway/config`
pub(crate) async fn view(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match config_view(&state, &caller).await {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct HistoryQuery {
    kind: String,
    id: String,
}

/// 证据行（revision 升序）→ 版本视图，变化与前一条已记录 revision 比较。
pub(crate) fn revisions(rows: &[Evidence]) -> Vec<Value> {
    let mut previous = Value::Null;
    let mut out = Vec::new();
    for row in rows {
        // 证据写入时已打码；读取时再打一次，打码规则更新前保存的值也不会外泄。
        let current = if row.deleted {
            Value::Null
        } else {
            mask(&row.masked_value)
        };
        let changes = diff(&previous, &current);
        let mut view = json!({"revision":row.revision,"recordedAt":rfc3339(row.recorded_at),
            "valueJson":canonical(&current),"valueDigest":row.value_digest,
            "deleted":row.deleted,"changes":changes});
        attribution(&mut view, row);
        out.push(view);
        previous = current;
    }
    out
}

async fn history_view(
    state: &BffState,
    caller: &Caller,
    query: HistoryQuery,
) -> Result<GatewayConfigHistory, Refusal> {
    if query.kind.is_empty() || query.id.is_empty() || query.kind.len() > 64 || query.id.len() > 512
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    require_platform(state, caller, "audit").await?;
    let gateway = crate::model_route::Gateway::from_env().map_err(|_| unavailable())?;
    let current = gateway
        .resources(&query.kind)
        .await?
        .into_iter()
        .find(|row| row.get("id").and_then(Value::as_str) == Some(query.id.as_str()))
        .and_then(|row| row.get("revision").and_then(Value::as_i64));
    let rows = evidence(&state.pool, &query.kind, &query.id, HISTORY_LIMIT).await?;
    let recorded = match current {
        Some(revision) => rows.iter().any(|row| row.revision == revision),
        // 已删除：最后一条证据是 Core 写入的墓碑
        None => rows.last().is_some_and(|row| row.deleted),
    };
    let mut value = json!({"kind":query.kind,"id":query.id,
        "currentSource":if recorded {"CORE_RECORDED"} else {"UNRECORDED"},
        "revisions":revisions(&rows)});
    if let Some(revision) = current {
        value["currentRevision"] = json!(revision);
    }
    serde_json::from_value(value)
        .map_err(|e| Refusal::Unavailable(format!("GatewayConfigHistory: {e}")))
}

/// `GET /api/v1/platform/gateway/config/history?kind=&id=`
pub(crate) async fn history(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<HistoryQuery>,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match history_view(&state, &caller, query).await {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::DateTime;
    use uuid::Uuid;

    #[test]
    fn diff_reports_json_pointer_paths() {
        let before =
            json!({"name":"r","policies":{"a/b":1,"keep":true},"targets":[{"host":"x"}],"gone":1});
        let after =
            json!({"name":"r","policies":{"a/b":2,"keep":true},"targets":[{"host":"y"}],"new":[1]});
        let changes = diff(&before, &after);
        let paths: Vec<(&str, &str)> = changes
            .iter()
            .map(|c| (c["path"].as_str().unwrap(), c["change"].as_str().unwrap()))
            .collect();
        assert_eq!(
            paths,
            vec![
                ("/gone", "REMOVED"),
                ("/new", "ADDED"),
                ("/policies/a~1b", "CHANGED"),
                ("/targets/0/host", "CHANGED")
            ]
        );
        assert_eq!(changes[2]["beforeJson"], "1");
        assert_eq!(changes[2]["afterJson"], "2");
        assert!(diff(&before, &before).is_empty());
        let unequal_arrays = diff(&json!({"a":[1]}), &json!({"a":[1,2]}));
        assert_eq!(unequal_arrays[0]["path"], "/a");
        assert_eq!(unequal_arrays[0]["change"], "CHANGED");
    }

    fn evidence(revision: i64, value: Value, deleted: bool) -> Evidence {
        Evidence {
            kind: "traffic.route".into(),
            resource_id: "r".into(),
            revision,
            deleted,
            masked_value: value,
            value_digest: "0".repeat(64),
            action_execution_id: Some(Uuid::nil()),
            operation_id: Some(Uuid::nil()),
            action_key: Some("application_binding.create".into()),
            recorded_at: DateTime::parse_from_rfc3339("2026-10-21T00:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
        }
    }

    #[test]
    fn revisions_diff_against_previous_record_and_tombstones() {
        let rows = vec![
            evidence(1, json!({"name":"r","v":1}), false),
            evidence(3, json!({"name":"r","v":2}), false),
            evidence(4, Value::Null, true),
        ];
        let views = revisions(&rows);
        assert_eq!(views[0]["changes"][0]["path"], "");
        assert_eq!(views[0]["changes"][0]["change"], "ADDED");
        assert_eq!(views[1]["changes"][0]["path"], "/v");
        assert_eq!(views[2]["deleted"], true);
        assert_eq!(views[2]["changes"][0]["change"], "REMOVED");
        assert_eq!(views[1]["actionKey"], "application_binding.create");
    }
}
