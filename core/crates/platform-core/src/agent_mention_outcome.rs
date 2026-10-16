//! DD-121、V-SCN-105/106：普通 @提及与人工指派的 `agent.invoke` 准入结论对发起 HUMAN 只读可见。
//!
//! 只读本人作为 initiator 的原 ActionExecution 与其 Invocation 引用：不含消息正文、他人的执行
//! 或 Agent 内部状态，不新增 Relay 事件，不重试、不代发。尚未被扫描的提及没有执行，
//! 回应中不出现，客户端按 PENDING 呈现。

use std::collections::BTreeSet;

use axum::{
    extract::{rejection::JsonRejection, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::{
    AgentMentionOutcomePage, AgentMentionOutcomeQueryRequest, AgentMentionOutcomeState,
    AgentMentionOutcomeView, ErrorClass, ReasonCode,
};
use sqlx::FromRow;
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::{self, Refusal},
    presence::no_store,
    web_transport::{admit_collaboration_workspace_scope, error_body},
};

/// 契约 `AgentMentionOutcomeQueryRequest.eventIds.maxItems`。
const MAX_EVENT_IDS: usize = 50;

/// 已准入而尚未终结的 Invocation；UNKNOWN 由对账收敛，不当终态。
const NOT_TERMINAL: [&str; 4] = ["CREATED", "DISPATCHING", "RUNNING", "UNKNOWN"];

/// 同一源事件/Installation 可有多个执行（人工指派以不同幂等键被拒后又被提及扫描准入）：
/// 已准入者唯一（`invocation_agent_trigger`），优先取它，否则取最近一次。
/// Automation 是 `automation.run`，不在 `agent.invoke` 内。每个 `agent.invoke` 执行都有
/// 幂等键，`idempotency_key is not null` 使发起人范围命中 `action_execution_idempotency`。
const OUTCOMES: &str = "select distinct on (a.parameters->>'sourceEventId',a.target_id)
    a.parameters->>'sourceEventId' event_id,a.target_id installation_id,a.gate_state,a.reason_code,
    i.status invocation_status,i.reply_event_id
    from admission.action_execution a
    left join catalog.agent_invocation i on i.action_execution_id=a.id and i.tenant_id=a.tenant_id
      and i.workspace_id=a.workspace_id and i.installation_resource_id=a.target_id
      and i.source_event_id=a.parameters->>'sourceEventId' and i.automation_resource_id is null
    where a.tenant_id=$1 and a.initiator_principal_id=$2 and a.idempotency_key is not null
      and a.workspace_id=$3 and a.action_key='agent.invoke'
      and a.parameters->>'sourceEventId'=any($4::text[])
    order by a.parameters->>'sourceEventId',a.target_id,(a.gate_state='ALLOWED') desc,
      a.created_at desc,a.id desc";

#[derive(FromRow)]
struct OutcomeRow {
    event_id: String,
    installation_id: Uuid,
    gate_state: String,
    reason_code: Option<String>,
    invocation_status: Option<String>,
    reply_event_id: Option<String>,
}

fn invalid() -> Response {
    error_body(
        StatusCode::BAD_REQUEST,
        ErrorClass::Precondition,
        ReasonCode::InvalidParameters,
        None,
    )
}

fn is_lower_hex(byte: u8) -> bool {
    matches!(byte, b'0'..=b'9' | b'a'..=b'f')
}

/// 1..=50 个互不相同的小写 64 位十六进制 event ID。
fn valid_event_ids(ids: &[String]) -> bool {
    let unique: BTreeSet<&str> = ids.iter().map(String::as_str).collect();
    !ids.is_empty()
        && ids.len() <= MAX_EVENT_IDS
        && unique.len() == ids.len()
        && ids
            .iter()
            .all(|id| id.len() == 64 && id.bytes().all(is_lower_hex))
}

/// 门禁拒绝即 DENIED；已准入只有已完成且有回复才是 REPLIED，未终结为 RUNNING；
/// 执行失败、取消或准入结论不明（EVALUATING 依赖不可用、EXPIRED 放弃）为 FAILED。
fn outcome_state(gate: &str, status: Option<&str>, replied: bool) -> AgentMentionOutcomeState {
    match (gate, status) {
        ("DENIED", _) => AgentMentionOutcomeState::Denied,
        ("ALLOWED", Some("COMPLETED")) if replied => AgentMentionOutcomeState::Replied,
        ("ALLOWED", Some(stage)) if NOT_TERMINAL.contains(&stage) => {
            AgentMentionOutcomeState::Running
        }
        ("WAITING", _) => AgentMentionOutcomeState::Running,
        _ => AgentMentionOutcomeState::Failed,
    }
}

/// 原因码只随 DENIED/FAILED 返回（既有门禁或对账原因）；回复 ID 只随 REPLIED 返回。
fn view(row: OutcomeRow) -> AgentMentionOutcomeView {
    let state = outcome_state(
        &row.gate_state,
        row.invocation_status.as_deref(),
        row.reply_event_id.is_some(),
    );
    let refused = matches!(
        state,
        AgentMentionOutcomeState::Denied | AgentMentionOutcomeState::Failed
    );
    let reason_code = row
        .reason_code
        .as_deref()
        .filter(|_| refused)
        .and_then(governance::parse::<ReasonCode>);
    let reply_event_id = row
        .reply_event_id
        .filter(|_| state == AgentMentionOutcomeState::Replied);
    AgentMentionOutcomeView {
        event_id: row.event_id,
        installation_id: row.installation_id.to_string(),
        reason_code,
        reply_event_id,
        state,
    }
}

async fn outcomes(
    state: &BffState,
    ctx: &ExecutionContext,
    workspace: Uuid,
    event_ids: Vec<String>,
) -> Result<Vec<AgentMentionOutcomeView>, sqlx::Error> {
    let rows: Vec<OutcomeRow> = sqlx::query_as(OUTCOMES)
        .bind(ctx.tenant_id)
        .bind(ctx.tenant_principal_id)
        .bind(workspace)
        .bind(event_ids)
        .fetch_all(&state.pool)
        .await?;
    Ok(rows.into_iter().map(view).collect())
}

/// `POST /api/v1/workspaces/{workspace_id}/agent-mentions/query`（DD-121、V-SCN-105/106）。
pub(crate) async fn query(
    State(state): State<BffState>,
    Path(workspace_id): Path<Uuid>,
    headers: HeaderMap,
    body: Result<Json<AgentMentionOutcomeQueryRequest>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(v) => v,
        Err(r) => return r,
    };
    let Ok(Json(request)) = body else {
        return invalid();
    };
    if !valid_event_ids(&request.event_ids) {
        return invalid();
    }
    // 协作读：调用方须是该 Workspace 的 ACTIVE 成员，管理可见性不够。
    if let Err(failure) = admit_collaboration_workspace_scope(&state, &ctx, workspace_id).await {
        return failure.into_response();
    }
    match outcomes(&state, &ctx, workspace_id, request.event_ids).await {
        Ok(outcomes) => no_store(AgentMentionOutcomePage { outcomes }),
        Err(error) => Refusal::from(error).respond(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn outcome(
        gate: &str,
        reason: Option<&str>,
        status: Option<&str>,
        reply: Option<&str>,
    ) -> AgentMentionOutcomeView {
        view(OutcomeRow {
            event_id: "a".repeat(64),
            installation_id: Uuid::nil(),
            gate_state: gate.into(),
            reason_code: reason.map(Into::into),
            invocation_status: status.map(Into::into),
            reply_event_id: reply.map(Into::into),
        })
    }

    fn ids(count: usize) -> Vec<String> {
        (0..count).map(|n| format!("{n:064x}")).collect()
    }

    #[test]
    fn mention_outcome_request_accepts_only_bounded_unique_lowercase_event_ids() {
        let id = |c: &str| c.repeat(64);
        assert!(valid_event_ids(&[id("a")]));
        assert!(valid_event_ids(&ids(MAX_EVENT_IDS)));
        assert!(!valid_event_ids(&[]));
        assert!(!valid_event_ids(&ids(MAX_EVENT_IDS + 1)));
        assert!(!valid_event_ids(&[id("a"), id("a")]));
        assert!(!valid_event_ids(&[id("A")]));
        assert!(!valid_event_ids(&[id("g")]));
        assert!(!valid_event_ids(&["a".repeat(63)]));
        assert!(!valid_event_ids(&["a".repeat(65)]));
        assert!(!valid_event_ids(&[String::new()]));
    }

    #[test]
    fn mention_outcome_denied_keeps_existing_reason_without_reply() {
        let denied = outcome("DENIED", Some("PERMISSION_DENIED"), None, None);
        assert_eq!(denied.state, AgentMentionOutcomeState::Denied);
        assert_eq!(denied.reason_code, Some(ReasonCode::PermissionDenied));
        assert_eq!(denied.reply_event_id, None);
        assert_eq!(denied.event_id, "a".repeat(64));
        assert_eq!(denied.installation_id, Uuid::nil().to_string());
    }

    #[test]
    fn mention_outcome_running_until_terminal_reply() {
        for status in NOT_TERMINAL {
            let got = outcome("ALLOWED", None, Some(status), None);
            assert_eq!(got.state, AgentMentionOutcomeState::Running, "{status}");
            assert_eq!(got.reason_code, None);
        }
        // 回复已发布但送达待对账：仍是处理中，不提前给出回复 ID。
        let reply = "b".repeat(64);
        let pending = outcome("ALLOWED", None, Some("UNKNOWN"), Some(&reply));
        assert_eq!(pending.state, AgentMentionOutcomeState::Running);
        assert_eq!(pending.reply_event_id, None);
    }

    #[test]
    fn mention_outcome_replied_carries_reply_event() {
        let reply = "b".repeat(64);
        let replied = outcome("ALLOWED", None, Some("COMPLETED"), Some(&reply));
        assert_eq!(replied.state, AgentMentionOutcomeState::Replied);
        assert_eq!(replied.reply_event_id, Some(reply));
        assert_eq!(replied.reason_code, None);
    }

    #[test]
    fn mention_outcome_failed_for_terminal_failure_or_unknown_admission() {
        for status in [Some("FAILED"), Some("CANCELED"), Some("COMPLETED"), None] {
            let got = outcome("ALLOWED", None, status, None);
            assert_eq!(got.state, AgentMentionOutcomeState::Failed, "{status:?}");
            assert_eq!(got.reply_event_id, None);
        }
        let abandoned = outcome("EXPIRED", Some("ADMISSION_ABANDONED"), None, None);
        assert_eq!(abandoned.state, AgentMentionOutcomeState::Failed);
        assert_eq!(abandoned.reason_code, Some(ReasonCode::AdmissionAbandoned));
        let lost = outcome("EVALUATING", Some("DEPENDENCY_UNAVAILABLE"), None, None);
        assert_eq!(lost.state, AgentMentionOutcomeState::Failed);
        assert_eq!(lost.reason_code, Some(ReasonCode::DependencyUnavailable));
    }
}
