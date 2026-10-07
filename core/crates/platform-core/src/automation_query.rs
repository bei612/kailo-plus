//! REQ-23/DD-107：Automation 管理的只读消费；不创建触发、Grant 或运行对象。
use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{FromRow, PgConnection};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::Refusal,
    spicedb::Consistency,
};

#[derive(Deserialize)]
pub struct PageQuery {
    #[serde(rename = "workspaceId")]
    workspace_id: Uuid,
    offset: Option<i64>,
}
#[derive(Deserialize)]
pub struct DetailQuery {
    #[serde(rename = "versionOffset")]
    version_offset: Option<i64>,
    #[serde(rename = "delegationOffset")]
    delegation_offset: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RunQuery {
    cursor: Option<String>,
}

// Pagination is not authority. Bind the boundary to the authenticated reader and
// exact resource scope, then repeat the same admission/read checks on every page.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RunCursor {
    tenant: Uuid,
    principal: Uuid,
    automation: Uuid,
    workspace: Uuid,
    created_at: DateTime<Utc>,
    id: Uuid,
}

impl RunCursor {
    fn decode(
        value: &str,
        tenant: Uuid,
        principal: Uuid,
        automation: Uuid,
        workspace: Uuid,
    ) -> Option<Self> {
        let cursor: Self = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(value).ok()?).ok()?;
        (cursor.tenant == tenant
            && cursor.principal == principal
            && cursor.automation == automation
            && cursor.workspace == workspace)
            .then_some(cursor)
    }

    fn encode(&self) -> Result<String, serde_json::Error> {
        serde_json::to_vec(self).map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
    }
}

#[derive(FromRow)]
struct RunRow {
    #[sqlx(flatten)]
    task: crate::governance_api::TaskRow,
    progress: Option<String>,
    usage_event_ids: Vec<Uuid>,
}

fn run_query() -> String {
    // Both existing producers freeze the Automation as the root AE target, even
    // when admission refuses before an Invocation exists. Do not join through
    // Invocation or filter a globally limited /tasks result.
    format!(
        "select task.*, tp.progress,
        array(select u.id from outbox.usage_event u
            where u.tenant_id=$1 and u.workspace_id=$5 and u.operation_id=task.operation_id
            order by u.id) usage_event_ids
        from ({} and ae.action_key='automation.run'
            and ae.parent_action_execution_id is null
            and ae.target_id=$4 and ae.workspace_id=$5
            and ($6::timestamptz is null or (ae.created_at,ae.id)<($6,$7::uuid))
            order by ae.created_at desc,ae.id desc limit $8) task
        left join projection.task_projection tp on tp.workflow_id=task.temporal_workflow_id
        order by task.created_at desc,task.id desc",
        crate::governance_api::TASK_QUERY
    )
}

fn step_approval_query() -> String {
    format!(
        "{} and ae.action_key='automation.run' and ae.approval_workflow_id is not null
        and ae.parent_action_execution_id=$4
        and exists(select 1 from admission.action_execution parent
            join catalog.agent_invocation i on i.action_execution_id=parent.id
            join catalog.automation_version v on v.asset_id=i.automation_version_asset_id
              and v.automation_resource_id=i.automation_resource_id
            where parent.id=$4 and parent.parent_action_execution_id is null
              and parent.action_key='automation.run' and parent.tenant_id=ae.tenant_id
              and parent.workspace_id=ae.workspace_id and parent.target_id=ae.target_id
              and parent.operation_id=ae.operation_id and parent.action_version=ae.action_version
              and parent.initiator_principal_id=ae.initiator_principal_id
              and parent.actor_principal_id=ae.actor_principal_id
              and i.tenant_id=ae.tenant_id and i.workspace_id=ae.workspace_id
              and i.automation_resource_id=ae.target_id
              and ae.parameters->'automationStepApproval'->>'invocationId'=i.id::text
              and ae.parameters->'automationStepApproval'->>'policyId'=v.approval_policy_id::text
              and ae.parameters->'automationStepApproval'->>'policyVersion'=v.approval_policy_version::text)
        limit 2",
        crate::governance_api::TASK_QUERY
    )
}

async fn step_approval_task(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
    freshness: i64,
    parent: Uuid,
) -> Result<Option<contracts::TaskView>, Response> {
    let mut rows: Vec<crate::governance_api::TaskRow> = sqlx::query_as(&step_approval_query())
        .bind(tenant)
        .bind(principal)
        .bind(freshness)
        .bind(parent)
        .fetch_all(conn)
        .await
        .map_err(crate::service_api::unavailable)?;
    if rows.len() > 1 {
        return Err(unavailable());
    }
    rows.pop().map(crate::governance_api::task_view).transpose()
}

#[cfg(test)]
mod run_history_tests {
    use super::*;

    #[test]
    fn post_message_version_reader_preserves_both_implemented_actions() {
        for kind in ["POST_MESSAGE", "AGENT_TURN"] {
            assert!(version_action_supported(
                &json!({"kind":kind,"template":"Frozen body"})
            ));
        }
        for invalid in [
            json!({"kind":"UNKNOWN","template":"body"}),
            json!({"kind":null,"template":"body"}),
            json!({"template":"body"}),
            json!({"kind":"POST_MESSAGE"}),
            json!({"kind":"POST_MESSAGE","template":"  "}),
            json!({"kind":"POST_MESSAGE","template":"body","extra":true}),
        ] {
            assert!(!version_action_supported(&invalid));
        }
    }

    fn cursor() -> RunCursor {
        RunCursor {
            tenant: Uuid::from_u128(1),
            principal: Uuid::from_u128(2),
            automation: Uuid::from_u128(3),
            workspace: Uuid::from_u128(4),
            created_at: "2026-10-04T10:00:00Z".parse().unwrap(),
            id: Uuid::from_u128(5),
        }
    }

    #[test]
    fn cursor_roundtrip_keeps_exact_scope_and_same_timestamp_tiebreaker() {
        let c = cursor();
        let encoded = c.encode().unwrap();
        let decoded =
            RunCursor::decode(&encoded, c.tenant, c.principal, c.automation, c.workspace).unwrap();
        assert_eq!(decoded.id, c.id);
        assert_eq!(decoded.created_at, c.created_at);
        assert!(RunCursor::decode(
            &encoded,
            Uuid::nil(),
            c.principal,
            c.automation,
            c.workspace
        )
        .is_none());
        assert!(
            RunCursor::decode(&encoded, c.tenant, Uuid::nil(), c.automation, c.workspace).is_none()
        );
        assert!(
            RunCursor::decode(&encoded, c.tenant, c.principal, Uuid::nil(), c.workspace).is_none()
        );
        assert!(
            RunCursor::decode(&encoded, c.tenant, c.principal, c.automation, Uuid::nil()).is_none()
        );
    }

    #[test]
    fn invalid_or_unknown_cursor_fields_are_not_a_first_page() {
        let c = cursor();
        for encoded in [
            "".to_owned(),
            "invalid!".to_owned(),
            URL_SAFE_NO_PAD.encode(b"{}"),
        ] {
            assert!(
                RunCursor::decode(&encoded, c.tenant, c.principal, c.automation, c.workspace)
                    .is_none()
            );
        }
        let mut extra = serde_json::to_value(&c).unwrap();
        extra["owner"] = json!(c.principal);
        assert!(RunCursor::decode(
            &URL_SAFE_NO_PAD.encode(serde_json::to_vec(&extra).unwrap()),
            c.tenant,
            c.principal,
            c.automation,
            c.workspace
        )
        .is_none());
    }

    // Execute the production SELECT in an explicitly isolated, empty PostgreSQL
    // database. Minimal read-side relations exercise query semantics, not writer
    // admission or an end-to-end Automation execution.
    #[tokio::test]
    #[ignore = "requires an empty workflow_history_verify_* PostgreSQL database"]
    async fn sql_history_is_self_scoped_and_keyset_paged_before_projection() {
        let pool =
            sqlx::PgPool::connect(&std::env::var("WORKFLOW_HISTORY_TEST_DATABASE_URL").unwrap())
                .await
                .unwrap();
        let database: String = sqlx::query_scalar("select current_database()")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(database.starts_with("workflow_history_verify_"));
        let mut tx = pool.begin().await.unwrap();
        sqlx::raw_sql("create schema admission; create schema projection; create schema outbox;
            create table admission.action_execution(
                id uuid,operation_id uuid,tenant_id uuid,initiator_principal_id uuid,workspace_id uuid,
                target_id uuid,action_key text,action_version int,gate_state text,dispatch_state text,
                reason_code text,approval_workflow_id text,temporal_workflow_id text,created_at timestamptz);
            create table projection.approval_projection(workflow_id text,status text);
            create table projection.workflow_ref(workflow_id text,projection_state text,created_at timestamptz,kind text);
            create table projection.task_projection(workflow_id text,status text,waiting_reason text,observation_gap bool,progress text);
            create table outbox.usage_event(id uuid,tenant_id uuid,workspace_id uuid,operation_id uuid);")
            .execute(&mut *tx).await.unwrap();
        sqlx::raw_sql(
            "alter table admission.action_execution add column parent_action_execution_id uuid;
            alter table admission.action_execution add column actor_principal_id uuid;
            alter table admission.action_execution add column parameters jsonb;
            create schema catalog;
            create table catalog.agent_invocation(id uuid,action_execution_id uuid,tenant_id uuid,
                workspace_id uuid,automation_resource_id uuid,automation_version_asset_id uuid);
            create table catalog.automation_version(asset_id uuid,automation_resource_id uuid,
                approval_policy_id uuid,approval_policy_version int);",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        let c = cursor();
        for n in 1..=8u128 {
            sqlx::query("insert into admission.action_execution(id,operation_id,tenant_id,initiator_principal_id,
                workspace_id,target_id,action_key,action_version,gate_state,dispatch_state,reason_code,
                approval_workflow_id,temporal_workflow_id,created_at) values($1,$1,$2,$3,$4,$5,$6,1,'DENIED','NOT_DISPATCHED',
                null,null,null,$7)")
                .bind(Uuid::from_u128(n))
                .bind(if n==4 {Uuid::nil()} else {c.tenant})
                .bind(if n==5 {Uuid::nil()} else {c.principal})
                .bind(if n==6 {Uuid::nil()} else {c.workspace})
                .bind(if n==7 {Uuid::nil()} else {c.automation})
                .bind(if n==8 {"automation.enable"} else {"automation.run"})
                .bind(c.created_at).execute(&mut *tx).await.unwrap();
        }
        sqlx::query("update admission.action_execution set temporal_workflow_id='run',gate_state='ALLOWED',dispatch_state='UNKNOWN' where id=$1")
            .bind(Uuid::from_u128(3)).execute(&mut *tx).await.unwrap();
        sqlx::raw_sql("insert into projection.workflow_ref values('run','UNKNOWN',now(),null);
            insert into projection.task_projection values('run','RUNNING','BILLING_UNAVAILABLE',false,'native completed');")
            .execute(&mut *tx).await.unwrap();
        for n in 1..=3u128 {
            sqlx::query("insert into outbox.usage_event values($1,$2,$3,$4)")
                .bind(Uuid::from_u128(100 + n))
                .bind(if n == 2 { Uuid::nil() } else { c.tenant })
                .bind(if n == 3 { Uuid::nil() } else { c.workspace })
                .bind(Uuid::from_u128(3))
                .execute(&mut *tx)
                .await
                .unwrap();
        }
        let page: Vec<RunRow> = sqlx::query_as(&run_query())
            .bind(c.tenant)
            .bind(c.principal)
            .bind(60i64)
            .bind(c.automation)
            .bind(c.workspace)
            .bind(None::<DateTime<Utc>>)
            .bind(None::<Uuid>)
            .bind(2i64)
            .fetch_all(&mut *tx)
            .await
            .unwrap();
        assert_eq!(
            page.iter().map(|r| r.task.id).collect::<Vec<_>>(),
            vec![Uuid::from_u128(3), Uuid::from_u128(2)]
        );
        assert_eq!(page[0].progress.as_deref(), Some("native completed"));
        assert_eq!(page[0].usage_event_ids, vec![Uuid::from_u128(101)]);
        let last = page.last().unwrap();
        let following: Vec<RunRow> = sqlx::query_as(&run_query())
            .bind(c.tenant)
            .bind(c.principal)
            .bind(60i64)
            .bind(c.automation)
            .bind(c.workspace)
            .bind(last.task.created_at)
            .bind(last.task.id)
            .bind(2i64)
            .fetch_all(&mut *tx)
            .await
            .unwrap();
        assert_eq!(
            following.iter().map(|r| r.task.id).collect::<Vec<_>>(),
            vec![Uuid::from_u128(1)]
        );
        assert_eq!(
            crate::governance_api::task_view(page.into_iter().next().unwrap().task)
                .unwrap()
                .observation,
            Some(contracts::ReasonCode::ExternalResultUnknown)
        );
        assert!(
            crate::governance_api::task_view(following.into_iter().next().unwrap().task)
                .unwrap()
                .workflow_id
                .is_none()
        );
        let parent = Uuid::from_u128(3);
        let child = Uuid::from_u128(20);
        sqlx::query("update admission.action_execution set actor_principal_id=$1 where id=$2")
            .bind(c.principal)
            .bind(parent)
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("insert into catalog.automation_version values($1,$2,$3,1)")
            .bind(Uuid::from_u128(30))
            .bind(c.automation)
            .bind(Uuid::from_u128(31))
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("insert into catalog.agent_invocation values($1,$2,$3,$4,$5,$6)")
            .bind(Uuid::from_u128(32))
            .bind(parent)
            .bind(c.tenant)
            .bind(c.workspace)
            .bind(c.automation)
            .bind(Uuid::from_u128(30))
            .execute(&mut *tx)
            .await
            .unwrap();
        sqlx::query("insert into admission.action_execution
            select $1,operation_id,tenant_id,initiator_principal_id,workspace_id,target_id,action_key,
                action_version,'WAITING','NOT_DISPATCHED','WAITING_APPROVAL','step-approval',null,
                created_at,id,actor_principal_id,$3 from admission.action_execution where id=$2")
            .bind(child).bind(parent).bind(json!({"automationStepApproval":{
                "invocationId":Uuid::from_u128(32),"policyId":Uuid::from_u128(31),"policyVersion":1}}))
            .execute(&mut *tx).await.unwrap();
        let step = step_approval_task(&mut tx, c.tenant, c.principal, 60, parent)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(step.action_execution_id, child.to_string());
        assert_eq!(step.gate_state, contracts::ActionGateState::Waiting);
        assert_eq!(step.approval_workflow_id.as_deref(), Some("step-approval"));
        assert!(
            step_approval_task(&mut tx, c.tenant, Uuid::nil(), 60, parent)
                .await
                .unwrap()
                .is_none()
        );
        sqlx::query("update admission.action_execution set operation_id=$1 where id=$2")
            .bind(Uuid::nil())
            .bind(child)
            .execute(&mut *tx)
            .await
            .unwrap();
        assert!(
            step_approval_task(&mut tx, c.tenant, c.principal, 60, parent)
                .await
                .unwrap()
                .is_none()
        );
        sqlx::query("update admission.action_execution set operation_id=$1,dispatch_state='UNKNOWN' where id=$2")
            .bind(parent).bind(child).execute(&mut *tx).await.unwrap();
        let unknown = step_approval_task(&mut tx, c.tenant, c.principal, 60, parent)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            unknown.observation,
            Some(contracts::ReasonCode::ExternalResultUnknown)
        );
        tx.rollback().await.unwrap();
    }
}

/// Authorized Automation read + existing self-owned Task visibility, never a
/// Workspace-wide run/approval authority or an additional workflow-control path.
pub async fn runs(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<RunQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(error) => return error,
    };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let row: AutomationRow = match sqlx::query_as(&format!("{ROW} and r.id=$2"))
        .bind(ctx.tenant_id)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => return crate::service_api::unavailable(error),
    };
    if let Err(error) = scope(&state, &ctx, row.workspace_id).await {
        return error;
    }
    if let Err(error) = view(&state, &mut tx, &ctx, &row).await {
        return error;
    }
    match permission(&state, &ctx, "resource", id, "read").await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(error) => return error,
    }
    let cursor = match q.cursor {
        Some(value) => match RunCursor::decode(
            &value,
            ctx.tenant_id,
            ctx.tenant_principal_id,
            id,
            row.workspace_id,
        ) {
            Some(value) => Some(value),
            None => return StatusCode::BAD_REQUEST.into_response(),
        },
        None => None,
    };
    let limit = state.governance.cfg.page_limit;
    let Some(fetch_limit) = limit.checked_add(1).filter(|_| limit > 0) else {
        return unavailable();
    };
    let mut rows: Vec<RunRow> = match sqlx::query_as(&run_query())
        .bind(ctx.tenant_id)
        .bind(ctx.tenant_principal_id)
        .bind(state.governance.cfg.projection_freshness_seconds)
        .bind(id)
        .bind(row.workspace_id)
        .bind(cursor.as_ref().map(|c| c.created_at))
        .bind(cursor.as_ref().map(|c| c.id))
        .bind(fetch_limit)
        .fetch_all(&mut *tx)
        .await
    {
        Ok(rows) => rows,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let more = rows.len() as i64 > limit;
    if more {
        rows.pop();
    }
    let next = if more {
        let Some(last) = rows.last() else {
            return unavailable();
        };
        match (RunCursor {
            tenant: ctx.tenant_id,
            principal: ctx.tenant_principal_id,
            automation: id,
            workspace: row.workspace_id,
            created_at: last.task.created_at,
            id: last.task.id,
        })
        .encode()
        {
            Ok(cursor) => Some(cursor),
            Err(_) => return unavailable(),
        }
    } else {
        None
    };
    let mut values = Vec::with_capacity(rows.len());
    for row in rows {
        let step = match step_approval_task(
            &mut tx,
            ctx.tenant_id,
            ctx.tenant_principal_id,
            state.governance.cfg.projection_freshness_seconds,
            row.task.id,
        )
        .await
        {
            Ok(step) => step,
            Err(error) => return error,
        };
        let task = match crate::governance_api::task_view(row.task) {
            Ok(task) => task,
            Err(error) => return error,
        };
        // Omit optional fields rather than emit null; use the generated contract
        // for the same TaskView enum/freshness handling as the original Tasks UI.
        let mut value = json!({"task":task,"usageEventIds":row.usage_event_ids});
        if let Some(step) = step {
            value["stepApprovalTask"] = json!(step);
        }
        if let Some(progress) = row.progress {
            value["progress"] = json!(progress);
        }
        values.push(value);
    }
    let mut page = json!({"automationResourceId":id,"runs":values});
    if let Some(next) = next {
        page["nextCursor"] = json!(next);
    }
    match serde_json::from_value::<contracts::AutomationRunPage>(page) {
        Ok(page) => Json(page).into_response(),
        Err(_) => unavailable(),
    }
}
#[derive(FromRow)]
struct AutomationRow {
    resource_id: Uuid,
    workspace_id: Uuid,
    owner_principal_id: Uuid,
    resource_version: i32,
    resource_state: String,
    state: String,
    executor_installation_resource_id: Uuid,
    pinned_version_asset_id: Option<Uuid>,
    delegation_id: Option<Uuid>,
    pinned_version_state: Option<String>,
    pinned_asset_state: Option<String>,
    pinned_projection: Option<Uuid>,
}
const ROW:&str="select r.id resource_id,d.workspace_id,r.owner_principal_id,r.version resource_version,
    r.state resource_state,d.state,d.executor_installation_resource_id,d.pinned_version_asset_id,d.delegation_id,
    pin.state pinned_version_state,asset.state pinned_asset_state,asset.projection_action_execution_id pinned_projection
    from catalog.resource r join catalog.automation_definition d on d.resource_id=r.id
    join catalog.resource_type_definition kind on kind.type_key=r.type_key and kind.status='ACTIVE'
      and kind.tenant_delete_action_key='tenant.delete'
    join identity.workspace w on w.id=d.workspace_id and w.tenant_id=r.tenant_id and w.state='ACTIVE'
    left join catalog.automation_version pin on pin.asset_id=d.pinned_version_asset_id and pin.automation_resource_id=r.id
    left join catalog.asset asset on asset.id=pin.asset_id and asset.resource_id=r.id and asset.tenant_id=r.tenant_id
      and asset.type_key='automation.version'
    where r.tenant_id=$1 and r.type_key='automation' and r.home_workspace_id=d.workspace_id
      and r.application_binding_id is null and r.state='ACTIVE' and r.projection_action_execution_id is null";

fn unavailable() -> Response {
    StatusCode::SERVICE_UNAVAILABLE.into_response()
}
fn offset(value: Option<i64>, limit: i64) -> Option<i64> {
    let value = value.unwrap_or(0);
    if value < 0 || limit <= 0 || value.checked_add(limit).is_none() {
        None
    } else {
        Some(value)
    }
}
async fn scope(state: &BffState, ctx: &ExecutionContext, workspace: Uuid) -> Result<(), Response> {
    let admitted = crate::web_transport::workspace_admissions(state, ctx, &[workspace])
        .await
        .map_err(IntoResponse::into_response)?;
    if admitted.contains_key(&workspace) {
        Ok(())
    } else {
        Err(StatusCode::FORBIDDEN.into_response())
    }
}
async fn permission(
    state: &BffState,
    ctx: &ExecutionContext,
    kind: &str,
    id: Uuid,
    permission: &str,
) -> Result<bool, Response> {
    let checked = state
        .governance
        .spicedb
        .check(
            kind,
            &id.to_string(),
            permission,
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
    if checked.zed_token.is_empty() {
        Err(unavailable())
    } else {
        Ok(checked.allowed)
    }
}
// 只读资格不使用写侧 active_owner 的 FOR UPDATE；否则读 Resource 后等待成员锁
// 会与治理写侧的成员→Resource 锁序相反。写请求仍由原治理事务重新锁定和核验。
async fn active_owner(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "select exists(select 1 from identity.principal p
        join identity.tenant_membership tm on tm.tenant_principal_id=p.id
        where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
          and tm.tenant_id=$2 and tm.state='ACTIVE')",
    )
    .bind(principal)
    .bind(tenant)
    .fetch_one(conn)
    .await
}
async fn view(
    state: &BffState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    row: &AutomationRow,
) -> Result<contracts::AutomationView, Response> {
    if row.resource_version <= 0
        || row.pinned_version_asset_id.is_some()
            && (row.pinned_version_state.as_deref() != Some("PUBLISHED")
                || row.pinned_asset_state.as_deref() != Some("PUBLISHED")
                || row.pinned_projection.is_some())
        || (row.state == "ENABLED"
            && (row.pinned_version_asset_id.is_none() || row.delegation_id.is_none()))
    {
        return Err(unavailable());
    }
    if !active_owner(conn, ctx.tenant_id, row.owner_principal_id)
        .await
        .map_err(crate::service_api::unavailable)?
    {
        return Err(Refusal::Denied(contracts::ReasonCode::ScopeGuardFailed).respond(None));
    }
    let matched = state
        .governance
        .spicedb
        .resource_projection_matches_in_workspace(
            &row.resource_id.to_string(),
            &ctx.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            state.governance.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
    if !matched {
        return Err(unavailable());
    }
    serde_json::from_value(
        json!({"resourceId":row.resource_id,"workspaceId":row.workspace_id,
        "ownerPrincipalId":row.owner_principal_id,"resourceVersion":row.resource_version,
        "resourceState":row.resource_state,"state":row.state,
        "executorInstallationResourceId":row.executor_installation_resource_id,
        "pinnedVersionAssetId":row.pinned_version_asset_id,"delegationId":row.delegation_id}),
    )
    .map_err(|_| unavailable())
}

pub async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(error) => return error,
    };
    if let Err(error) = scope(&state, &ctx, q.workspace_id).await {
        return error;
    }
    let limit = i64::from(state.governance.cfg.relationship_page);
    let offset = match offset(q.offset, limit) {
        Some(offset) => offset,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let rows: Vec<AutomationRow> = match sqlx::query_as(&format!(
        "{ROW} and d.workspace_id=$2 and d.state<>'DELETED' order by r.id offset $3 limit $4"
    ))
    .bind(ctx.tenant_id)
    .bind(q.workspace_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&mut *tx)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut values = Vec::new();
    for row in &rows {
        let value = match view(&state, &mut tx, &ctx, row).await {
            Ok(value) => value,
            Err(error) => return error,
        };
        match permission(&state, &ctx, "resource", row.resource_id, "discover").await {
            Ok(true) => values.push(value),
            Ok(false) => {}
            Err(error) => return error,
        }
    }
    let can_create = match permission(&state, &ctx, "workspace", q.workspace_id, "create").await {
        Ok(allowed) => allowed && crate::capability_registry::action_exposed("automation.create"),
        Err(error) => return error,
    };
    let policies:Vec<(Uuid,i32)>=match sqlx::query_as("select id,version from catalog.approval_policy
        where tenant_id=$1 and action_key='automation.run' and target_type='RESOURCE' and status='ACTIVE' order by id,version")
        .bind(ctx.tenant_id).fetch_all(&mut *tx).await {
        Ok(rows)=>rows,Err(error)=>return crate::service_api::unavailable(error),
    };
    let mut available = Vec::new();
    for (id, version) in policies {
        if let Err(error) = crate::automation::step_approval::validate_policy(
            &mut tx,
            ctx.tenant_id,
            Some(id),
            Some(version),
            true,
        )
        .await
        {
            return error.respond(None);
        }
        available.push(json!({"id":id,"version":version}));
    }
    match serde_json::from_value::<contracts::AutomationPage>(
        json!({"automations":values,"canCreate":can_create,"nextOffset":next,"availableApprovalPolicies":available}),
    ) {
        Ok(value) => Json(value).into_response(),
        Err(_) => unavailable(),
    }
}

#[derive(FromRow)]
struct VersionRow {
    asset_id: Uuid,
    owner_principal_id: Uuid,
    asset_version: i32,
    asset_state: String,
    ordinal: i32,
    state: String,
    config_hash: String,
    trigger: Value,
    action: Value,
    approval_policy_id: Option<Uuid>,
    approval_policy_version: Option<i32>,
    result_target: String,
    name: Option<String>,
}
async fn versions(
    state: &BffState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    row: &AutomationRow,
    offset: i64,
    limit: i64,
) -> Result<(Vec<contracts::AutomationVersionView>, Option<i64>), Response> {
    let rows:Vec<VersionRow>=sqlx::query_as("select a.id asset_id,a.owner_principal_id,a.version asset_version,
        a.state asset_state,v.ordinal,v.state,v.config_hash,v.trigger,v.action,v.approval_policy_id,v.approval_policy_version,v.result_target,v.name
        from catalog.automation_version v join catalog.asset a on a.id=v.asset_id
        where v.automation_resource_id=$1 and a.resource_id=$1 and a.tenant_id=$2
          and a.type_key='automation.version' and a.state<>'DELETED' and a.projection_action_execution_id is null
        order by v.ordinal desc offset $3 limit $4")
        .bind(row.resource_id).bind(ctx.tenant_id).bind(offset).bind(limit).fetch_all(&mut *conn).await
        .map_err(crate::service_api::unavailable)?;
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    let mut values = Vec::new();
    let executor: Uuid = sqlx::query_scalar(
        "select i.agent_principal_id from catalog.agent_installation i
        join catalog.resource r on r.id=i.resource_id and r.tenant_id=$1 and r.home_workspace_id=$2
        where i.resource_id=$3 and i.workspace_id=$2",
    )
    .bind(ctx.tenant_id)
    .bind(row.workspace_id)
    .bind(row.executor_installation_resource_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(crate::service_api::unavailable)?;
    for version in rows {
        if !permission(state, ctx, "asset", version.asset_id, "read").await? {
            continue;
        }
        let trigger = version.trigger.as_object().ok_or_else(unavailable)?;
        if version.asset_version <= 0
            || version.ordinal <= 0
            || trigger.keys().any(|key| {
                !matches!(
                    key.as_str(),
                    "kind" | "text_prefix" | "mention_principal_id" | "schedule_spec"
                )
            })
            || !version_action_supported(&version.action)
            || trigger
                .get("text_prefix")
                .is_some_and(|value| value.as_str().is_none_or(str::is_empty))
        {
            return Err(unavailable());
        }
        match trigger.get("kind").and_then(Value::as_str) {
            Some("CHANNEL_MESSAGE")
                if !trigger.contains_key("mention_principal_id")
                    && !trigger.contains_key("schedule_spec")
                    && version.result_target == "TRIGGER_THREAD" => {}
            Some("MENTION")
                if trigger
                    .get("mention_principal_id")
                    .and_then(Value::as_str)
                    .and_then(|value| Uuid::parse_str(value).ok())
                    == Some(executor)
                    && !trigger.contains_key("schedule_spec")
                    && version.result_target == "TRIGGER_THREAD" => {}
            Some("SCHEDULE")
                if !trigger.contains_key("text_prefix")
                    && !trigger.contains_key("mention_principal_id")
                    && version.result_target == "CHANNEL" =>
            {
                crate::automation::schedule_spec(
                    trigger.get("schedule_spec").ok_or_else(unavailable)?,
                )
                .map_err(|e| e.respond(None))?;
            }
            _ => return Err(unavailable()),
        }
        crate::automation::step_approval::validate_policy(
            conn,
            ctx.tenant_id,
            version.approval_policy_id,
            version.approval_policy_version,
            false,
        )
        .await
        .map_err(|error| error.respond(None))?;
        let content = crate::automation::version_content(
            version.trigger,
            version.action,
            version.approval_policy_id,
            version.approval_policy_version,
            &version.result_target,
            version.name.as_deref(),
        );
        if version.state != version.asset_state
            || collab_bridge::limits::canonical_digest(&content) != version.config_hash
            || !active_owner(conn, ctx.tenant_id, version.owner_principal_id)
                .await
                .map_err(crate::service_api::unavailable)?
        {
            return Err(unavailable());
        }
        let matched = state
            .governance
            .spicedb
            .asset_projection_matches(
                &version.asset_id.to_string(),
                &ctx.tenant_id.to_string(),
                &row.resource_id.to_string(),
                &version.owner_principal_id.to_string(),
                state.governance.cfg.relationship_page,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
        if !matched {
            return Err(unavailable());
        }
        let mut trigger = json!({"kind":content["trigger"]["kind"]});
        if let Some(value) = content["trigger"].get("text_prefix") {
            trigger["textPrefix"] = value.clone();
        }
        if let Some(value) = content["trigger"].get("mention_principal_id") {
            trigger["mentionPrincipalId"] = value.clone();
        }
        if let Some(value) = content["trigger"].get("schedule_spec") {
            trigger["scheduleSpec"] = value.clone();
        }
        let mut exposed_content = json!({"trigger":trigger,"action":content["action"],"resultTarget":content["resultTarget"]});
        crate::automation::steps::expose(&mut exposed_content, &content["action"])
            .map_err(|error| error.respond(None))?;
        if let Some(name) = content.get("name") {
            exposed_content["name"] = name.clone();
        }
        if let (Some(id), Some(version)) =
            (version.approval_policy_id, version.approval_policy_version)
        {
            exposed_content["approvalPolicy"] = json!({"id":id,"version":version});
        }
        let value = serde_json::from_value(
            json!({"assetId":version.asset_id,"automationResourceId":row.resource_id,
            "ownerPrincipalId":version.owner_principal_id,"assetVersion":version.asset_version,
            "ordinal":version.ordinal,"state":version.state,"configHash":version.config_hash,
            "content":exposed_content}),
        )
        .map_err(|_| unavailable())?;
        values.push(value);
    }
    Ok((values, next))
}
fn version_action_supported(value: &Value) -> bool {
    crate::automation::steps::supported(value)
}

#[derive(FromRow)]
struct GrantRow {
    id: Uuid,
    version: i32,
    expires_at: DateTime<Utc>,
}
async fn delegations(
    state: &BffState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    row: &AutomationRow,
    offset: i64,
    limit: i64,
) -> Result<(Vec<contracts::AutomationDelegationView>, Option<i64>), Response> {
    let rows:Vec<GrantRow>=sqlx::query_as("select g.id,g.version,g.expires_at from admission.delegation_grant g
        join catalog.agent_installation i on i.resource_id=g.installation_resource_id and i.state='ACTIVE'
        join catalog.resource ir on ir.id=i.resource_id and ir.tenant_id=g.tenant_id
          and ir.home_workspace_id=g.workspace_id and ir.state='ACTIVE' and ir.projection_action_execution_id is null
        join identity.principal agent on agent.id=i.agent_principal_id and agent.tenant_id=g.tenant_id
          and agent.kind='AGENT' and agent.status='ACTIVE'
        where g.tenant_id=$1 and g.workspace_id=$2 and g.grantor_principal_id=$3
          and g.installation_resource_id=$4 and g.agent_principal_id=agent.id and g.state='ACTIVE'
          and g.valid_from<=clock_timestamp() and g.expires_at>clock_timestamp()
          and (g.max_uses is null or g.max_uses>(select count(*) from admission.delegation_use u where u.delegation_id=g.id))
          and exists(select 1 from admission.delegation_scope scope
            join catalog.action_definition action on action.action_key=scope.action_key and action.version=scope.action_version
              and action.status='ACTIVE' and action.action_key='automation.run'
            join catalog.result_exposure_policy exposure on exposure.id=scope.result_exposure_policy_id
              and exposure.version=scope.result_exposure_policy_version and exposure.tenant_id=g.tenant_id
              and exposure.status='ACTIVE' and exposure.mode='CONSUME_ONLY'
              and exposure.output_schema_hash=any($8) and exposure.redaction_policy='PLATFORM_METADATA_ONLY'
            where scope.delegation_id=g.id and scope.target_type='RESOURCE' and scope.target_id=$5
              and scope.create_workspace_id is null and scope.tool_resource_id is null)
        order by g.id offset $6 limit $7")
        .bind(ctx.tenant_id).bind(row.workspace_id).bind(row.owner_principal_id)
        .bind(row.executor_installation_resource_id).bind(row.resource_id).bind(offset).bind(limit)
        .bind(crate::governance::delegation::metadata_output_schema_hashes("automation.run"))
        .fetch_all(&mut *conn).await.map_err(crate::service_api::unavailable)?;
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    if !rows.is_empty() {
        let agent: Uuid = sqlx::query_scalar(
            "select agent_principal_id from catalog.agent_installation where resource_id=$1",
        )
        .bind(row.executor_installation_resource_id)
        .fetch_one(&mut *conn)
        .await
        .map_err(crate::service_api::unavailable)?;
        for subject in [row.owner_principal_id, agent] {
            let checked = state
                .governance
                .spicedb
                .check(
                    "resource",
                    &row.resource_id.to_string(),
                    "execute",
                    &subject.to_string(),
                    Consistency::FullyConsistent,
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()).respond(None))?;
            if checked.zed_token.is_empty() {
                return Err(unavailable());
            }
            if !checked.allowed {
                return Ok((Vec::new(), next));
            }
        }
    }
    let mut values = Vec::new();
    for grant in rows {
        values.push(serde_json::from_value(json!({"delegationId":grant.id,"delegationVersion":grant.version,
            "ownerPrincipalId":row.owner_principal_id,"executorInstallationResourceId":row.executor_installation_resource_id,
            "expiresAt":grant.expires_at})).map_err(|_|unavailable())?);
    }
    Ok((values, next))
}

pub async fn get(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Query(q): Query<DetailQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(error) => return error,
    };
    let limit = i64::from(state.governance.cfg.relationship_page);
    let version_offset = match offset(q.version_offset, limit) {
        Some(value) => value,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let delegation_offset = match offset(q.delegation_offset, limit) {
        Some(value) => value,
        None => return StatusCode::BAD_REQUEST.into_response(),
    };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let row: AutomationRow = match sqlx::query_as(&format!("{ROW} and r.id=$2"))
        .bind(ctx.tenant_id)
        .bind(id)
        .fetch_optional(&mut *tx)
        .await
    {
        Ok(Some(row)) => row,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(error) => return crate::service_api::unavailable(error),
    };
    if let Err(error) = scope(&state, &ctx, row.workspace_id).await {
        return error;
    }
    let automation = match view(&state, &mut tx, &ctx, &row).await {
        Ok(value) => value,
        Err(error) => return error,
    };
    match permission(&state, &ctx, "resource", row.resource_id, "read").await {
        Ok(true) => {}
        Ok(false) => return StatusCode::FORBIDDEN.into_response(),
        Err(error) => return error,
    }
    let can_manage = match permission(&state, &ctx, "resource", row.resource_id, "manage").await {
        Ok(allowed) => allowed && row.state != "DELETED",
        Err(error) => return error,
    };
    let owner_member: bool = match sqlx::query_scalar(
        "select exists(select 1 from identity.workspace_membership
        where workspace_id=$1 and tenant_principal_id=$2 and state='ACTIVE')",
    )
    .bind(row.workspace_id)
    .bind(ctx.tenant_principal_id)
    .fetch_one(&mut *tx)
    .await
    {
        Ok(member) => member,
        Err(error) => return crate::service_api::unavailable(error),
    };
    let can_run = if row.state == "ENABLED"
        && row.owner_principal_id == ctx.tenant_principal_id
        && owner_member
        && row.pinned_version_state.as_deref() == Some("PUBLISHED")
        && row.pinned_asset_state.as_deref() == Some("PUBLISHED")
        && row.pinned_projection.is_none()
        && row.delegation_id.is_some()
    {
        match crate::automation::manual::available(&state.governance).await {
            Ok(true) => {
                match permission(&state, &ctx, "resource", row.resource_id, "execute").await {
                    Ok(allowed) => allowed,
                    Err(error) => return error,
                }
            }
            Ok(false) => false,
            Err(error) => return error.respond(None),
        }
    } else {
        false
    };
    let (versions, next_version) =
        match versions(&state, &mut tx, &ctx, &row, version_offset, limit).await {
            Ok(value) => value,
            Err(error) => return error,
        };
    let (grants, next_grant) = if can_manage {
        match delegations(&state, &mut tx, &ctx, &row, delegation_offset, limit).await {
            Ok(value) => value,
            Err(error) => return error,
        }
    } else {
        (Vec::new(), None)
    };
    match serde_json::from_value::<contracts::AutomationDetailView>(json!({"automation":automation,
        "versions":versions,"delegations":grants,"canManage":can_manage,"canRun":can_run,
        "nextVersionOffset":next_version,"nextDelegationOffset":next_grant}))
    {
        Ok(value) => Json(value).into_response(),
        Err(_) => unavailable(),
    }
}
