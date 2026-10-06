//! REQ-24: governed references to original Buzz private DMs, never message authority.
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::{Definition, Execution, Params, Refusal, Target},
    service_api::{unavailable, ServiceState},
    spicedb::Consistency,
};

pub(crate) const OPEN: &str = "conversation.open";
pub(crate) const KIND: &str = "CONVERSATION_PROJECTION";
// Buzz pinned protocol kind KIND_DM_OPEN, not a configurable business value.
const DM_OPEN: u16 = 41010;

/// A participant's currently admitted native DM; no Workspace is fabricated.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct ConversationScope {
    pub channel_id: String,
    pub community_host: String,
    pub binding_version: i32,
    pub tenant_binding_version: i32,
}

pub(crate) async fn admit(
    state: &BffState,
    ctx: &ExecutionContext,
    id: Uuid,
) -> Result<ConversationScope, Response> {
    admit_reconciliation(
        &state.memory_service,
        ctx.tenant_id,
        ctx.tenant_principal_id,
        id,
    )
    .await
}

/// Shared by BFF reads/writes and original message-result reconciliation.
pub(crate) async fn admit_reconciliation(
    state: &ServiceState,
    tenant: Uuid,
    principal: Uuid,
    id: Uuid,
) -> Result<ConversationScope, Response> {
    let row: Option<(Uuid,String,i32,i32)> = sqlx::query_as(
        "select c.channel_id,b.normalized_host,c.version,b.version from projection.conversation_buzz_binding c
         join projection.tenant_buzz_binding b on b.tenant_id=c.tenant_id and b.state='ACTIVE'
         join identity.tenant t on t.id=c.tenant_id and t.state='ACTIVE'
         join identity.principal p on p.id=$2 and p.tenant_id=t.id and p.kind='HUMAN' and p.status='ACTIVE'
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=t.id and tm.state='ACTIVE'
         where c.id=$3 and c.tenant_id=$1 and c.state='ACTIVE' and p.id=ANY(c.participant_principal_ids)
           and exists(select 1 from identity.buzz_identity_binding i where i.tenant_id=t.id
             and i.principal_id=p.id and i.kind='HUMAN' and i.state='ACTIVE' and i.custody='SERVER'
             and c.projected_keys @> jsonb_build_array(jsonb_build_array(p.id::text,i.pubkey)))")
        .bind(tenant).bind(principal).bind(id).fetch_optional(&state.pool).await.map_err(unavailable)?;
    let (channel, host, version, tenant_version) =
        row.ok_or_else(|| StatusCode::FORBIDDEN.into_response())?;
    fresh_discover(state, tenant, principal).await?;
    Ok(ConversationScope {
        channel_id: channel.to_string(),
        community_host: host,
        binding_version: version,
        tenant_binding_version: tenant_version,
    })
}

pub(crate) async fn fresh_discover(
    state: &ServiceState,
    tenant: Uuid,
    principal: Uuid,
) -> Result<(), Response> {
    let active:bool=sqlx::query_scalar("select exists(select 1 from identity.tenant t
        join identity.principal p on p.tenant_id=t.id and p.id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
        join identity.tenant_membership tm on tm.tenant_id=t.id and tm.tenant_principal_id=p.id and tm.state='ACTIVE'
        where t.id=$1 and t.state='ACTIVE')")
        .bind(tenant).bind(principal).fetch_one(&state.pool).await.map_err(unavailable)?;
    if !active {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    let check = state
        .governance
        .spicedb
        .check(
            "tenant",
            &tenant.to_string(),
            "discover",
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    if check.zed_token.is_empty() {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    if !check.allowed {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(())
}

#[derive(Deserialize)]
pub(crate) struct Page {
    pub cursor: Option<Uuid>,
}

#[derive(sqlx::FromRow)]
struct ConversationRow {
    id: Uuid,
    channel_id: Uuid,
    participant_principal_ids: Vec<Uuid>,
    state: String,
    version: i32,
    operation_id: Uuid,
}

#[derive(sqlx::FromRow)]
struct ProjectionRow {
    tenant_id: Uuid,
    channel_id: Uuid,
    participant_principal_ids: Vec<Uuid>,
    creator_pubkey: String,
    projection_generation: i64,
    projected_keys: Value,
    state: String,
}

pub(crate) async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(page): Query<Page>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    if let Err(e) = fresh_discover(
        &state.memory_service,
        ctx.tenant_id,
        ctx.tenant_principal_id,
    )
    .await
    {
        return e;
    }
    let rows=sqlx::query_as::<_, ConversationRow>(
        "select id,channel_id,participant_principal_ids,state,version,operation_id
         from projection.conversation_buzz_binding where tenant_id=$1 and $2=ANY(participant_principal_ids)
         and ($3::uuid is null or id>$3) order by id limit $4")
        .bind(ctx.tenant_id).bind(ctx.tenant_principal_id).bind(page.cursor)
        .bind(state.governance.cfg.role_member_page_limit).fetch_all(&state.pool).await;
    match rows {
        Ok(rows) => {
            let cursor = rows
                .last()
                .filter(|_| rows.len() as i64 == state.governance.cfg.role_member_page_limit)
                .map(|r| r.id);
            let mut result = json!({"items":rows.into_iter().map(|row|
        json!({"id":row.id,"channelId":row.channel_id,"participantPrincipalIds":row.participant_principal_ids,"state":row.state,"version":row.version,"operationId":row.operation_id})).collect::<Vec<_>>()});
            if let Some(cursor) = cursor {
                result["nextCursor"] = json!(cursor)
            }
            Json(result).into_response()
        }
        Err(e) => unavailable(e),
    }
}

/// Same-Tenant active HUMAN directory, not the cross-Tenant identity directory.
pub(crate) async fn participants(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(page): Query<Page>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    if let Err(e) = fresh_discover(
        &state.memory_service,
        ctx.tenant_id,
        ctx.tenant_principal_id,
    )
    .await
    {
        return e;
    }
    let rows:Result<Vec<(Uuid,String,Vec<String>)>,_>=sqlx::query_as(
        "select p.id,h.display_name,keys.pubkeys from identity.principal p
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
         join identity.human_identity h on h.id=tm.human_identity_id
         join lateral (select array_agg(i.pubkey order by i.pubkey) pubkeys from identity.buzz_identity_binding i
           where i.principal_id=p.id and i.tenant_id=p.tenant_id and i.kind='HUMAN' and i.state='ACTIVE'
           having count(*)>0) keys on true
         where p.tenant_id=$1 and p.kind='HUMAN' and p.status='ACTIVE' and tm.state='ACTIVE'
           and ($2::uuid is null or p.id>$2) order by p.id limit $3")
        .bind(ctx.tenant_id).bind(page.cursor).bind(state.governance.cfg.role_member_page_limit).fetch_all(&state.pool).await;
    match rows {
        Ok(rows) => {
            let cursor = rows
                .last()
                .filter(|_| rows.len() as i64 == state.governance.cfg.role_member_page_limit)
                .map(|r| r.0);
            let Ok(schema) = serde_json::from_str::<Value>(include_str!(
                "../../../../contracts/api/conversation_open_request.schema.json"
            )) else {
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            };
            let Some(max) = schema["properties"]["participantPrincipalIds"]["maxItems"].as_u64()
            else {
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            };
            let mut result = json!({"items":rows.into_iter().map(|(id,name,keys)|json!({"principalId":id,"displayName":name,"pubkeys":keys})).collect::<Vec<_>>(),"maxParticipants":max});
            if let Some(cursor) = cursor {
                result["nextCursor"] = json!(cursor)
            }
            Json(result).into_response()
        }
        Err(e) => unavailable(e),
    }
}

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

fn requested(p: &Params) -> Result<Vec<Uuid>, Refusal> {
    let value = p.conversation_open.as_ref().ok_or_else(invalid)?;
    let schema: Value = serde_json::from_str(include_str!(
        "../../../../contracts/api/conversation_open_request.schema.json"
    ))
    .map_err(|_| invalid())?;
    let validator = crate::capability_contract::schema_validator(&schema, &Default::default())?;
    if !validator.is_valid(value) {
        return Err(invalid());
    }
    let ids = value["participantPrincipalIds"]
        .as_array()
        .ok_or_else(invalid)?;
    let mut ids = ids
        .iter()
        .map(|v| {
            v.as_str()
                .and_then(|s| Uuid::parse_str(s).ok())
                .filter(|id| !id.is_nil())
                .ok_or_else(invalid)
        })
        .collect::<Result<Vec<_>, _>>()?;
    ids.sort_unstable();
    if ids.windows(2).any(|p| p[0] == p[1]) {
        return Err(invalid());
    }
    Ok(ids)
}

pub(crate) fn validate_params(p: &Params) -> Result<(), Refusal> {
    let value = p.to_json();
    if value
        .as_object()
        .is_none_or(|m| m.len() != 1 || !m.contains_key("conversationOpen"))
        || p.conversation_open
            .as_ref()
            .and_then(Value::as_object)
            .is_none_or(|m| m.len() != 1 || !m.contains_key("participantPrincipalIds"))
    {
        return Err(invalid());
    }
    requested(p).map(|_| ())
}

async fn participant_keys(
    conn: &mut PgConnection,
    tenant: Uuid,
    ids: &[Uuid],
    incoming: Option<&str>,
) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    sqlx::query_as(
        "select i.principal_id,i.pubkey from identity.buzz_identity_binding i
         join identity.principal p on p.id=i.principal_id and p.tenant_id=i.tenant_id and p.kind='HUMAN' and p.status='ACTIVE'
         join identity.tenant_membership tm on tm.tenant_principal_id=p.id and tm.tenant_id=p.tenant_id
           and (tm.state='ACTIVE' or (tm.state='PROVISIONING' and i.pubkey=$3 and i.state='RECONCILING'))
         where i.tenant_id=$1 and i.principal_id=ANY($2) and i.kind='HUMAN'
           and (i.state='ACTIVE' or (i.pubkey=$3 and i.state='RECONCILING'))
         order by i.principal_id,i.pubkey for share of p,tm,i")
        .bind(tenant).bind(ids).bind(incoming).fetch_all(conn).await
}

pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
) -> Result<Target, Refusal> {
    if def.target_type != "CONVERSATION"
        || def.workspace_rule != "TENANT_ONLY"
        || def.permission_object_type != "tenant"
        || def.permission != "discover"
        || def.execution_mode != "TEMPORAL"
        || def.workflow_kind.as_deref() != Some(KIND)
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let ids = requested(p)?;
    if !ids.contains(&initiator) {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let keys = participant_keys(conn, tenant, &ids, None).await?;
    if ids.iter().any(|id| !keys.iter().any(|(p, _)| p == id)) {
        return Err(Refusal::Precondition(ReasonCode::ScopeGuardFailed));
    }
    let existing:Option<(Uuid,i32)>=sqlx::query_as("select id,version from projection.conversation_buzz_binding where tenant_id=$1 and participant_principal_ids=$2 and state<>'DISABLED'")
        .bind(tenant).bind(&ids).fetch_optional(&mut *conn).await?;
    match existing {
        Some((id, version)) if frozen.is_none_or(|f| f == id) => Ok(Target {
            id,
            version,
            workspace_id: None,
        }),
        Some(_) => Err(conflict()),
        None => Ok(Target {
            id: frozen.unwrap_or_else(Uuid::new_v4),
            version: 0,
            workspace_id: None,
        }),
    }
}

pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    p: &Params,
) -> Result<i32, Refusal> {
    let ids = requested(p)?;
    if !ids.contains(&ae.initiator_principal_id) {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    let keys = participant_keys(tx, ae.tenant_id, &ids, None).await?;
    if ids.iter().any(|id| !keys.iter().any(|(p, _)| p == id)) {
        return Err(conflict());
    }
    if let Some(version)=sqlx::query_scalar::<_,i32>("select version from projection.conversation_buzz_binding where id=$1 and tenant_id=$2 and participant_principal_ids=$3 and state<>'DISABLED'")
        .bind(ae.target_id).bind(ae.tenant_id).bind(&ids).fetch_optional(&mut **tx).await?{return Ok(version)}
    let creator = keys
        .iter()
        .find(|(id, _)| *id == ae.initiator_principal_id)
        .ok_or_else(invalid)?
        .1
        .clone();
    sqlx::query_scalar("insert into projection.conversation_buzz_binding(id,tenant_id,channel_id,participant_principal_ids,creator_principal_id,creator_pubkey,operation_id,state)
        values($1,$2,$1,$3,$4,$5,$6,'PROVISIONING') returning version")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ids).bind(ae.initiator_principal_id).bind(creator).bind(ae.operation_id).fetch_one(&mut **tx).await.map_err(Into::into)
}

pub(crate) async fn start(
    pool: &sqlx::PgPool,
    temporal: &crate::temporal::TemporalClient,
    action: Uuid,
    tenant: Uuid,
    workflow: &str,
) -> Result<crate::membership_lifecycle::LifecycleResponse, Response> {
    let id:Option<Uuid>=sqlx::query_scalar("select target_id from admission.action_execution where id=$1 and tenant_id=$2 and action_key=$3 and gate_state='ALLOWED' and temporal_workflow_id=$4")
        .bind(action).bind(tenant).bind(OPEN).bind(workflow).fetch_optional(pool).await.map_err(unavailable)?;
    let id = id.ok_or_else(|| StatusCode::CONFLICT.into_response())?;
    let run_id=crate::component_task::start(pool,temporal,workflow,tenant,action,&crate::component_task::ComponentTaskInput{kind:KIND.into(),target:json!({"conversation":{"actionExecutionId":action,"conversationId":id,"workflowId":workflow}})}).await?;
    Ok(crate::membership_lifecycle::LifecycleResponse {
        workflow_id: workflow.into(),
        kind: KIND.into(),
        run_id,
    })
}

/// Converge the same original native DM; called by its creation workflow and the
/// existing identity/member lifecycle workflows. No background writer is added.
async fn project(state: &ServiceState, id: Uuid, incoming: Option<&str>) -> Result<(), Response> {
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let row=sqlx::query_as::<_, ProjectionRow>(
        "select tenant_id,channel_id,participant_principal_ids,creator_pubkey,projection_generation,projected_keys,state
         from projection.conversation_buzz_binding where id=$1 for update")
        .bind(id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
    let ProjectionRow {
        tenant_id: tenant,
        channel_id: channel,
        participant_principal_ids: ids,
        creator_pubkey: creator,
        projection_generation: mut generation,
        projected_keys: old_keys,
        state: binding_state,
    } = row.ok_or_else(|| StatusCode::NOT_FOUND.into_response())?;
    if binding_state == "DISABLED" {
        return Err(StatusCode::CONFLICT.into_response());
    }
    let keys = participant_keys(&mut tx, tenant, &ids, incoming)
        .await
        .map_err(unavailable)?;
    let keys_json =
        serde_json::to_value(&keys).map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    if keys_json != old_keys {
        generation = generation
            .checked_add(1)
            .ok_or_else(|| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    }
    sqlx::query("update projection.conversation_buzz_binding set projected_keys=$2,projection_generation=$3,state='RECONCILING',version=version+1,updated_at=now() where id=$1 and (projected_keys<>$2 or state<>'RECONCILING')")
        .bind(id).bind(&keys_json).bind(generation).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    let direction = if incoming.is_some() {
        crate::tenant_lifecycle::ProjectionDirection::Establish
    } else {
        crate::tenant_lifecycle::ProjectionDirection::Withdraw
    };
    let (control, _) = crate::tenant_lifecycle::control_client(state, tenant, direction).await?;
    let mut tags = vec![
        vec!["h".into(), channel.to_string()],
        vec!["generation".into(), generation.to_string()],
        vec!["creator".into(), creator],
    ];
    tags.extend(
        ids.iter()
            .map(|id| vec!["participant".into(), id.to_string()]),
    );
    tags.extend(
        keys.iter()
            .map(|(id, key)| vec!["p".into(), key.clone(), id.to_string()]),
    );
    let response = control
        .publish(&state.http, DM_OPEN, "", &tags)
        .await
        .map_err(|error| {
            tracing::warn!(%error,"DM projection result unknown");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;
    let native = response
        .get("message")
        .and_then(Value::as_str)
        .and_then(|v| v.strip_prefix("response:"))
        .and_then(|v| serde_json::from_str::<Value>(v).ok());
    if response.get("accepted").and_then(Value::as_bool) != Some(true)
        || native.as_ref().is_none_or(|v| {
            v["channel_id"] != json!(channel.to_string()) || v["generation"] != json!(generation)
        })
    {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    // A concurrent revoke wins by changing the generation. Recheck source facts
    // before exposing ACTIVE; unknown/stale projection never grants BFF access.
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let locked:Option<i64>=sqlx::query_scalar("select projection_generation from projection.conversation_buzz_binding where id=$1 for update")
        .bind(id).fetch_optional(&mut *tx).await.map_err(unavailable)?;
    let current = participant_keys(&mut tx, tenant, &ids, incoming)
        .await
        .map_err(unavailable)?;
    if locked != Some(generation) || current != keys {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    sqlx::query("update projection.conversation_buzz_binding set state='ACTIVE',version=version+1,updated_at=now() where id=$1 and projection_generation=$2")
        .bind(id).bind(generation).execute(&mut *tx).await.map_err(unavailable)?;
    tx.commit().await.map_err(unavailable)?;
    Ok(())
}

pub(crate) async fn project_for_principal(
    state: &ServiceState,
    tenant: Uuid,
    principal: Uuid,
    incoming: Option<&str>,
) -> Result<(), Response> {
    let ids:Vec<Uuid>=sqlx::query_scalar("select id from projection.conversation_buzz_binding where tenant_id=$1 and $2=ANY(participant_principal_ids) and state<>'DISABLED' order by id")
        .bind(tenant).bind(principal).fetch_all(&state.pool).await.map_err(unavailable)?;
    for id in ids {
        project(state, id, incoming).await?
    }
    Ok(())
}

pub(crate) async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<
        Json<contracts::ConversationProjectionRequest>,
        axum::extract::rejection::JsonRejection,
    >,
) -> Response {
    if let Err(e) = crate::service_api::authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let target = match serde_json::to_value(req.target) {
        Ok(v) => v,
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let Some(action) = target["actionExecutionId"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(id) = target["conversationId"]
        .as_str()
        .and_then(|s| Uuid::parse_str(s).ok())
    else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let Some(workflow) = target["workflowId"].as_str() else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let row:Result<Option<(Uuid,Uuid)>,_>=sqlx::query_as("select ae.tenant_id,ae.initiator_principal_id from admission.action_execution ae
        join projection.workflow_ref wr on wr.action_execution_id=ae.id and wr.workflow_id=ae.temporal_workflow_id and wr.kind=$4
        where ae.id=$1 and ae.target_id=$2 and ae.temporal_workflow_id=$3 and ae.action_key=$5 and ae.gate_state='ALLOWED'")
        .bind(action).bind(id).bind(workflow).bind(KIND).bind(OPEN).fetch_optional(&state.pool).await;
    let (tenant, principal) = match row {
        Ok(Some(r)) => r,
        Ok(None) => return StatusCode::FORBIDDEN.into_response(),
        Err(e) => return unavailable(e),
    };
    let observed = match state.temporal.describe(workflow).await {
        Ok(Some(o)) => o,
        _ => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    if observed.run_id != req.run_id
        || !matches!(observed.state, crate::temporal::ObservedState::Open)
    {
        return StatusCode::CONFLICT.into_response();
    }
    if let Err(e) = fresh_discover(&state, tenant, principal).await {
        return e;
    }
    match project(&state,id,None).await{
        Ok(())=>Json(json!({"conversationId":id,"status":"COMPLETED","waitingReason":"NONE"})).into_response(),
        Err(response) if response.status()==StatusCode::SERVICE_UNAVAILABLE=>Json(json!({"conversationId":id,"status":"RUNNING","waitingReason":"UNKNOWN_EXTERNAL_RESULT"})).into_response(),
        Err(response)=>response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn participants_use_contract_bounds_and_canonical_references() {
        let a = Uuid::new_v4();
        let b = Uuid::new_v4();
        let params = |ids: Value| {
            Params::from_json(&json!({"conversationOpen":{"participantPrincipalIds":ids}})).unwrap()
        };
        let mut expected = vec![a, b];
        expected.sort_unstable();
        assert_eq!(requested(&params(json!([b, a]))).unwrap(), expected);
        for ids in [
            json!([]),
            json!([a]),
            json!([a, a]),
            json!([a, Uuid::nil()]),
            json!([a, "not-a-principal"]),
        ] {
            assert!(requested(&params(ids)).is_err());
        }
        let schema: Value = serde_json::from_str(include_str!(
            "../../../../contracts/api/conversation_open_request.schema.json"
        ))
        .unwrap();
        let max = schema["properties"]["participantPrincipalIds"]["maxItems"]
            .as_u64()
            .unwrap();
        let ids = (0..=max).map(|_| Uuid::new_v4()).collect::<Vec<_>>();
        assert!(requested(&params(json!(ids))).is_err());
        let malformed = Params::from_json(
            &json!({"conversationOpen":{"participantPrincipalIds":[a,b],"workspaceId":a}}),
        )
        .unwrap();
        assert!(validate_params(&malformed).is_err());
    }
}
