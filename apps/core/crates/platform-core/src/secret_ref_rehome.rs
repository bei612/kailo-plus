//! DD-85：遗留业务 Tenant 的 SERVER Buzz 私钥只迁 SecretRef，不换公钥。
//!
//! 固定 ActionExecution / WorkflowRef / INTENT 在任何 OpenBao 写入前同事务落库。
//! COPY_UNKNOWN 之后只观察确定目标；切换与旧消费者清单同事务，旧版本只有在
//! Temporal 和 Core 的终态证据齐备后才永久销毁。未知结果只留在任务工作台等待
//! 同一固定 Workflow ID 的对账，绝不回退到 platform/ 写入。

use crate::audit::Evidence;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::EvidenceKind;
use contracts::{BindingKind, LegacySecretRefBinding, LegacySecretRefPage, ReasonCode};
use nostr::Keys;
use secret_store::{SecretRef, SecretStore};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::bff::{resolve_execution_context, BffState};
use crate::component_task::{self, ComponentTaskInput};
use crate::governance::{Execution, Params, Refusal};
use crate::membership_lifecycle::LifecycleResponse;
use crate::service_api::{audit_gate, authorize, unavailable, ServiceState};
use crate::spicedb::Consistency;
use crate::temporal::{ObservedState, TemporalClient};

const KIND: &str = "SECRET_REF_REHOME";
const ACTION: &str = "identity.secret_ref.rehome";
const ACTIVE_REHOME_INITIATOR_SQL: &str =
    "select ae.initiator_principal_id from admission.action_execution ae
     join identity.principal p on p.id = ae.initiator_principal_id
     join identity.tenant_membership tm on tm.tenant_principal_id = p.id
     join identity.tenant t on t.id = ae.tenant_id
     where ae.id = $1 and ae.tenant_id = $2 and p.tenant_id = ae.tenant_id
       and p.kind = 'HUMAN' and p.status = 'ACTIVE'
       and tm.tenant_id = ae.tenant_id and tm.state = 'ACTIVE'
       and t.state = 'ACTIVE'";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListQuery {
    cursor: Option<String>,
}

/// 只给 Tenant admin 有界展示可发起归位的旧 SERVER binding。返回值没有任何
/// SecretRef locator/version；提交时 Core 仍重新解析目标并 fresh Check。
pub async fn list_eligible(
    State(state): State<BffState>,
    Query(query): Query<ListQuery>,
    headers: HeaderMap,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    if query
        .cursor
        .as_deref()
        .is_some_and(|cursor| cursor.len() != 64 || !cursor.bytes().all(|b| b.is_ascii_hexdigit()))
    {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let permission = state
        .governance
        .spicedb
        .check(
            "tenant",
            &ctx.tenant_id.to_string(),
            "manage",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await;
    match permission {
        Ok(check) if check.allowed => {}
        Ok(_) => return StatusCode::FORBIDDEN.into_response(),
        Err(_) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    }
    let limit = state.governance.cfg.role_member_page_limit;
    let Some(fetch_limit) = limit.checked_add(1) else {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    };
    let mut rows: Vec<(Uuid, String, String, String)> = match sqlx::query_as(
        "select b.principal_id, b.pubkey, b.kind, b.private_key_secret_ref
         from identity.buzz_identity_binding b
         where b.tenant_id = $1 and b.custody = 'SERVER' and b.state = 'ACTIVE'
           and b.kind in ('HUMAN','CONTROL')
           and ($2::text is null or b.pubkey > $2)
           and not exists (select 1 from identity.relay_operator_identity o
                           where o.catalog_tenant_id = b.tenant_id)
           and not exists (select 1 from admission.secret_ref_rehome r
                           where r.tenant_id = b.tenant_id and r.identity_pubkey = b.pubkey
                             and r.state not in ('RETIRED','FAILED'))
         order by b.pubkey limit $3",
    )
    .bind(ctx.tenant_id)
    .bind(query.cursor.as_deref())
    .bind(fetch_limit)
    .fetch_all(&state.pool)
    .await
    {
        Ok(rows) => rows,
        Err(error) => return unavailable(error),
    };
    let more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    let next_cursor = if more {
        rows.last().map(|(_, pubkey, _, _)| pubkey.clone())
    } else {
        None
    };
    let mut bindings = Vec::new();
    for (principal_id, pubkey, kind, locator) in rows {
        if !state
            .secrets
            .is_legacy_identity_locator(ctx.tenant_id, &locator)
        {
            continue;
        }
        let kind = match kind.as_str() {
            "HUMAN" => BindingKind::Human,
            "CONTROL" => BindingKind::Control,
            _ => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
        };
        bindings.push(LegacySecretRefBinding {
            principal_id: principal_id.to_string(),
            pubkey,
            kind,
        });
    }
    (
        StatusCode::OK,
        Json(LegacySecretRefPage {
            bindings,
            next_cursor,
        }),
    )
        .into_response()
}

#[derive(Debug, sqlx::FromRow)]
struct Rehome {
    id: Uuid,
    action_execution_id: Uuid,
    workflow_id: String,
    tenant_id: Uuid,
    identity_pubkey: String,
    expected_binding_version: i32,
    old_locator: String,
    old_version: i32,
    old_audience: String,
    target_locator: String,
    new_ref_version: Option<i32>,
    old_generation_consumer_refs: Value,
    state: String,
}

const COLUMNS: &str = "id, action_execution_id, workflow_id, tenant_id, identity_pubkey,
    expected_binding_version, old_locator, old_version, old_audience, target_locator,
    new_ref_version, old_generation_consumer_refs, state";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Target {
    action_execution_id: Uuid,
    rehome_id: Uuid,
    tenant_id: Uuid,
    pubkey: String,
    expected_binding_version: i32,
}

#[derive(Serialize)]
struct Envelope {
    rehome: Target,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StepRequest {
    action_execution_id: Uuid,
    rehome_id: Uuid,
    tenant_id: Uuid,
    pubkey: String,
    expected_binding_version: i32,
    workflow_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StepResult {
    state: String,
}

/// 准入前与准入落定时均确认目标仍是同一业务 Tenant 的旧 SERVER ref。
pub async fn target_gate(
    secrets: &SecretStore,
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    params: &Params,
) -> Result<(), Refusal> {
    let principal = params
        .principal_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let row: Option<(String, String, String)> = sqlx::query_as(
        "select b.pubkey, b.private_key_secret_ref, b.state
         from identity.buzz_identity_binding b
         where b.tenant_id = $1 and b.principal_id = $2 and b.custody = 'SERVER'
           and b.kind in ('HUMAN','CONTROL') and b.state = 'ACTIVE'
           and not exists (select 1 from identity.relay_operator_identity o
                           where o.catalog_tenant_id = b.tenant_id)",
    )
    .bind(tenant)
    .bind(principal)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((pubkey, locator, _)) = row else {
        return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
    };
    if !secrets.is_legacy_identity_locator(tenant, &locator) {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let open: Option<i32> = sqlx::query_scalar(
        "select 1 from admission.secret_ref_rehome
         where tenant_id = $1 and identity_pubkey = $2
           and state not in ('RETIRED','FAILED')",
    )
    .bind(tenant)
    .bind(pubkey)
    .fetch_optional(&mut *conn)
    .await?;
    if open.is_some() {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(())
}

/// 与 WorkflowRef 预写处于同一治理事务；目标路径只由 ActionExecution ID 导出。
pub async fn prewrite(
    secrets: &SecretStore,
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    workflow_id: &str,
    expected_version: i32,
) -> Result<(), Refusal> {
    let row: Option<(String, String, i32, String, i32)> = sqlx::query_as(
        "select pubkey, private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, version
         from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and custody = 'SERVER'
           and kind in ('HUMAN','CONTROL') and state = 'ACTIVE' for update",
    )
    .bind(ae.tenant_id)
    .bind(ae.target_id)
    .fetch_optional(&mut **tx)
    .await?;
    let Some((pubkey, old_locator, old_version, old_audience, version)) = row else {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    };
    if version != expected_version
        || old_version <= 0
        || !secrets.is_legacy_identity_locator(ae.tenant_id, &old_locator)
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let target_locator =
        secrets.tenant_locator(ae.tenant_id, &format!("buzz-ref-rehome/{}", ae.id));
    sqlx::query(
        "insert into admission.secret_ref_rehome
         (id, action_execution_id, workflow_id, tenant_id, identity_pubkey,
          expected_binding_version, old_locator, old_version, old_audience,
          target_locator, old_ref_status, new_ref_status, state)
         values ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE','NONE','INTENT')",
    )
    .bind(ae.id)
    .bind(workflow_id)
    .bind(ae.tenant_id)
    .bind(pubkey)
    .bind(expected_version)
    .bind(old_locator)
    .bind(old_version)
    .bind(old_audience)
    .bind(target_locator)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// 只读取持久冻结的 input；调用方不得传 locator、secret 或版本替换值。
pub async fn start(
    pool: &PgPool,
    temporal: &TemporalClient,
    action_execution_id: Uuid,
    tenant_id: Uuid,
    workflow_id: &str,
) -> Result<LifecycleResponse, Response> {
    let row: Option<Rehome> = sqlx::query_as(&format!(
        "select {COLUMNS} from admission.secret_ref_rehome
         where action_execution_id = $1 and tenant_id = $2 and workflow_id = $3"
    ))
    .bind(action_execution_id)
    .bind(tenant_id)
    .bind(workflow_id)
    .fetch_optional(pool)
    .await
    .map_err(unavailable)?;
    let Some(r) = row else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    let input = ComponentTaskInput {
        kind: KIND.to_owned(),
        target: Envelope {
            rehome: Target {
                action_execution_id,
                rehome_id: r.id,
                tenant_id,
                pubkey: r.identity_pubkey,
                expected_binding_version: r.expected_binding_version,
            },
        },
    };
    let run_id = component_task::start(
        pool,
        temporal,
        workflow_id,
        tenant_id,
        action_execution_id,
        &input,
    )
    .await?;
    Ok(LifecycleResponse {
        workflow_id: workflow_id.to_owned(),
        kind: KIND.to_owned(),
        run_id,
    })
}

pub async fn advance(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<StepRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(response) = authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match advance_inner(&state, req).await {
        Ok(state) => (StatusCode::OK, Json(StepResult { state })).into_response(),
        Err(response) => response,
    }
}

async fn load(state: &ServiceState, req: &StepRequest) -> Result<Rehome, Response> {
    let row: Option<Rehome> = sqlx::query_as(&format!(
        "select {COLUMNS} from admission.secret_ref_rehome where id = $1"
    ))
    .bind(req.rehome_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    let Some(r) = row else {
        return Err(StatusCode::NOT_FOUND.into_response());
    };
    if r.action_execution_id != req.action_execution_id
        || r.workflow_id != req.workflow_id
        || r.tenant_id != req.tenant_id
        || r.identity_pubkey != req.pubkey
        || r.expected_binding_version != req.expected_binding_version
        || r.target_locator
            != state
                .secrets
                .tenant_locator(r.tenant_id, &format!("buzz-ref-rehome/{}", r.id))
        || !state
            .secrets
            .is_legacy_identity_locator(r.tenant_id, &r.old_locator)
        || match r.state.as_str() {
            "INTENT" | "COPY_UNKNOWN" => r.new_ref_version.is_some(),
            // 复制后被拒的 FAILED 保留已销毁的目标版本号，作为 DISCARDED 的证据。
            "FAILED" => !matches!(r.new_ref_version, None | Some(1)),
            "COPIED" | "SWITCHED" | "RETIRED" => r.new_ref_version != Some(1),
            _ => true,
        }
    {
        return Err(StatusCode::CONFLICT.into_response());
    }
    let allowed: Option<i32> = sqlx::query_scalar(
        "select 1 from admission.action_execution
         where id = $1 and tenant_id = $2 and action_key = $3
           and temporal_workflow_id = $4 and gate_state = 'ALLOWED'",
    )
    .bind(r.action_execution_id)
    .bind(r.tenant_id)
    .bind(ACTION)
    .bind(&r.workflow_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    if allowed.is_none() {
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    Ok(r)
}

async fn actor_still_authorized(state: &ServiceState, r: &Rehome) -> Result<bool, Response> {
    let principal: Option<Uuid> = sqlx::query_scalar(ACTIVE_REHOME_INITIATOR_SQL)
        .bind(r.action_execution_id)
        .bind(r.tenant_id)
        .fetch_optional(&state.pool)
        .await
        .map_err(unavailable)?;
    let Some(principal) = principal else {
        return Ok(false);
    };
    let checked = state
        .governance
        .spicedb
        .check(
            "tenant",
            &r.tenant_id.to_string(),
            "manage",
            &principal.to_string(),
            Consistency::FullyConsistent,
        )
        .await
        .map_err(|e| {
            tracing::warn!(error = %e, "归位前新鲜权限判定不可得");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;
    Ok(checked.allowed)
}

async fn advance_inner(state: &ServiceState, req: StepRequest) -> Result<String, Response> {
    let r = load(state, &req).await?;
    match r.state.as_str() {
        "INTENT" => copy_once(state, &r).await,
        "COPY_UNKNOWN" => observe_copy(state, &r).await,
        "COPIED" => cutover(state, &r).await,
        "SWITCHED" => retire(state, &r).await,
        "RETIRED" => Ok("RETIRED".into()),
        "FAILED" => Err(StatusCode::CONFLICT.into_response()),
        _ => Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    }
}

async fn copy_once(state: &ServiceState, r: &Rehome) -> Result<String, Response> {
    if !actor_still_authorized(state, r).await? {
        // 写前确定拒绝：没有任何新的 OpenBao 副作用。
        mark_failed(state, r).await?;
        return Err(StatusCode::FORBIDDEN.into_response());
    }
    let reference = SecretRef {
        locator: r.old_locator.clone(),
        version: u32::try_from(r.old_version).map_err(|_| StatusCode::CONFLICT.into_response())?,
        audience: r.old_audience.clone(),
    };
    let secret = match state.secrets.read(&reference, "value").await {
        Ok(value) => value,
        Err(secret_store::SecretError::AudienceMismatch) => {
            mark_failed(state, r).await?;
            return Err(StatusCode::CONFLICT.into_response());
        }
        Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    };
    let keys = match Keys::parse(secret.expose()) {
        Ok(keys) => keys,
        Err(_) => {
            mark_failed(state, r).await?;
            return Err(StatusCode::CONFLICT.into_response());
        }
    };
    if keys.public_key().to_hex() != r.identity_pubkey {
        mark_failed(state, r).await?;
        return Err(StatusCode::CONFLICT.into_response());
    }
    // 目标 namespace 的凭据与 metadata 读取先验可用，才冻结写意图。没有读到
    // 确定的空路径，绝不把一条尚未尝试写入的动作推进到 COPY_UNKNOWN。
    if state
        .secrets
        .observed_version(&r.target_locator)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?
        != 0
    {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }

    // 先记外部写入意图。崩在此处之后，COPY_UNKNOWN 只查目标 locator，绝不
    // 再走写路径；这宁可留下需运维介入的缺口，也不猜测一次丢失的响应。
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let updated = sqlx::query(
        "update admission.secret_ref_rehome set state = 'COPY_UNKNOWN', updated_at = now()
         where id = $1 and state = 'INTENT'",
    )
    .bind(r.id)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if updated.rows_affected() == 0 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    audit(&mut tx, r, "copy-intent", "INTENT", "COPY_UNKNOWN").await?;
    tx.commit().await.map_err(unavailable)?;

    match state
        .secrets
        .write_once(&r.target_locator, "value", secret.expose())
        .await
    {
        Ok(1) => observe_copy(state, r).await,
        // 返回值不是 1、网络失联或写拒绝，均不能假定目标可读；下一轮只查证。
        // 滞留的 COPY_UNKNOWN 由对账器按状态计数并在超期时告警。
        other => {
            tracing::warn!(rehome = %r.id, result = ?other.map_err(|e| e.to_string()),
                "归位目标写入结果不明，保持 COPY_UNKNOWN 只查证");
            Err(StatusCode::SERVICE_UNAVAILABLE.into_response())
        }
    }
}

async fn observe_copy(state: &ServiceState, r: &Rehome) -> Result<String, Response> {
    let version = state
        .secrets
        .observed_version(&r.target_locator)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    if version != 1 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    let reference = SecretRef {
        locator: r.target_locator.clone(),
        version,
        audience: r.old_audience.clone(),
    };
    crate::server_identity::read_bound_keys(&state.secrets, &reference, &r.identity_pubkey)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let updated = sqlx::query(
        "update admission.secret_ref_rehome
         set state = 'COPIED', new_ref_version = 1, new_ref_status = 'PENDING', updated_at = now()
         where id = $1 and state = 'COPY_UNKNOWN'",
    )
    .bind(r.id)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if updated.rows_affected() != 1 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    audit(&mut tx, r, "copy-verified", "RECONCILIATION", "COPIED").await?;
    tx.commit().await.map_err(unavailable)?;
    Ok("COPIED".into())
}

async fn mark_failed(state: &ServiceState, r: &Rehome) -> Result<(), Response> {
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let updated = sqlx::query(
        "update admission.secret_ref_rehome set state = 'FAILED', updated_at = now()
         where id = $1 and state = 'INTENT'",
    )
    .bind(r.id)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if updated.rows_affected() != 1 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    audit(&mut tx, r, "copy-rejected", "OUTCOME", "FAILED").await?;
    tx.commit().await.map_err(unavailable)?;
    Ok(())
}

/// 切换只修改 locator/version/audience 与 binding generation；pubkey、Relay
/// roster、历史 event 均不变。旧消费者清单与切换同事务冻结。
async fn cutover(state: &ServiceState, r: &Rehome) -> Result<String, Response> {
    if !actor_still_authorized(state, r).await? {
        return discard_copy(state, r).await;
    }
    // 偏离冻结值是单调事实（generation 只增）。先于目标查证判定：丢弃已销毁
    // 目标但未提交 FAILED 的一轮，下一轮不能卡在对已销毁版本的查证上。
    let current: Option<(String, i32, String, i32, String)> = sqlx::query_as(
        "select private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, version, state
         from identity.buzz_identity_binding where pubkey = $1 and tenant_id = $2",
    )
    .bind(&r.identity_pubkey)
    .bind(r.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    if let Some(current) = current.as_ref() {
        if !binding_matches_frozen(current, r) {
            return discard_copy(state, r).await;
        }
    }
    audit_gate(state).await?;
    observe_target_without_transition(state, r).await?;
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let locked: Option<(String, i32, String, i32, String)> = sqlx::query_as(
        "select private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, version, state
         from identity.buzz_identity_binding
         where pubkey = $1 and tenant_id = $2 for update",
    )
    .bind(&r.identity_pubkey)
    .bind(r.tenant_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    let Some(locked) = locked else {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    };
    if !binding_matches_frozen(&locked, r) {
        // binding 已偏离冻结值：这次归位不可能再切换，不重新冻结。
        tx.rollback().await.map_err(unavailable)?;
        return discard_copy(state, r).await;
    }
    let active_projection: Option<i32> = sqlx::query_scalar(
        "select 1 from projection.workflow_ref w
         join admission.action_execution ae on ae.id = w.action_execution_id
         left join projection.task_projection tp on tp.workflow_id = w.workflow_id
         where w.kind = 'BUZZ_IDENTITY_PROJECTION' and ae.tenant_id = $1
           and ae.target_id = (select target_id from admission.action_execution where id = $2)
           and (w.projection_state <> 'TERMINAL'
                or tp.status not in ('COMPLETED','FAILED','CANCELED','TERMINATED','TIMED_OUT')
                or tp.status is null) limit 1",
    )
    .bind(r.tenant_id)
    .bind(r.action_execution_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if active_projection.is_some() {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    // 旧的直接 service 启动链可留下 NOT_DISPATCHED + 已终态 WorkflowRef。
    // 这里仍保守冻结该 Action，退役时以 Temporal 关闭事实判定终态，不能让
    // dispatch_state 这一枚 Core 投递位永久卡住旧版本处置。
    let consumers: Vec<(Uuid, Option<String>)> = sqlx::query_as(
        "select ae.id, coalesce(w.workflow_id, ae.temporal_workflow_id)
         from admission.action_execution ae
         left join projection.workflow_ref w on w.action_execution_id = ae.id
         left join projection.task_projection tp on tp.workflow_id = w.workflow_id
         where ae.tenant_id = $1 and ae.id <> $2 and (
             ae.gate_state in ('EVALUATING','WAITING')
             or (ae.gate_state = 'ALLOWED' and (
                 ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN')
                 or (coalesce(w.workflow_id, ae.temporal_workflow_id) is not null and (
                     w.projection_state is distinct from 'TERMINAL'
                     or tp.status not in ('COMPLETED','FAILED','CANCELED','TERMINATED','TIMED_OUT')
                     or tp.status is null)))))",
    )
    .bind(r.tenant_id)
    .bind(r.action_execution_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(unavailable)?;
    let frozen: Vec<Value> = consumers
        .into_iter()
        .map(|(id, workflow)| json!({"actionExecutionId": id, "workflowId": workflow}))
        .collect();
    let changed = sqlx::query(
        "update identity.buzz_identity_binding
         set private_key_secret_ref = $3, private_key_secret_version = 1,
             private_key_secret_audience = $4, version = version + 1
         where pubkey = $1 and tenant_id = $2 and version = $5 and state = 'ACTIVE'",
    )
    .bind(&r.identity_pubkey)
    .bind(r.tenant_id)
    .bind(&r.target_locator)
    .bind(&r.old_audience)
    .bind(r.expected_binding_version)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if changed.rows_affected() != 1 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    let updated = sqlx::query(
        "update admission.secret_ref_rehome
         set state = 'SWITCHED', old_ref_status = 'SUPERSEDED', new_ref_status = 'ACTIVE',
             old_generation_consumer_refs = $2, cutover_at = now(), updated_at = now()
         where id = $1 and state = 'COPIED' and new_ref_version = 1",
    )
    .bind(r.id)
    .bind(json!(frozen))
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if updated.rows_affected() != 1 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    audit(&mut tx, r, "cutover", "RECONCILIATION", "SWITCHED").await?;
    tx.commit().await.map_err(unavailable)?;
    Ok("SWITCHED".into())
}

fn binding_matches_frozen(binding: &(String, i32, String, i32, String), r: &Rehome) -> bool {
    let (locator, version, audience, generation, state) = binding;
    *locator == r.old_locator
        && *version == r.old_version
        && *audience == r.old_audience
        && *generation == r.expected_binding_version
        && state == "ACTIVE"
}

/// DD-85：COPIED 之后切换被确定拒绝。目标 locator 从未被 binding 引用，销毁其
/// 版本 1 并经 metadata 查证后才终结为 FAILED；销毁不明保持 COPIED 由同一
/// Workflow 继续对账，绝不留下一份无人引用的私钥副本而宣告失败。
async fn discard_copy(state: &ServiceState, r: &Rehome) -> Result<String, Response> {
    audit_gate(state).await?;
    // 早于该策略开通的 Tenant namespace 没有目标路径的 destroy 能力；先收敛策略。
    state
        .secrets
        .ensure_tenant(r.tenant_id)
        .await
        .map_err(|e| {
            tracing::warn!(rehome = %r.id, error = %e, "归位副本的 Tenant OpenBao 策略未就绪");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;
    let referenced: bool = sqlx::query_scalar(
        "select exists (select 1 from identity.buzz_identity_binding
                        where private_key_secret_ref = $1)",
    )
    .bind(&r.target_locator)
    .fetch_one(&state.pool)
    .await
    .map_err(unavailable)?;
    if referenced {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    state
        .secrets
        .destroy_unbound_rehome_copy(r.tenant_id, r.id, &r.target_locator)
        .await
        .map_err(|e| {
            tracing::warn!(rehome = %r.id, error = %e, "归位副本销毁未得到查证");
            StatusCode::SERVICE_UNAVAILABLE.into_response()
        })?;
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let updated = sqlx::query(
        "update admission.secret_ref_rehome
         set state = 'FAILED', new_ref_status = 'DISCARDED', updated_at = now()
         where id = $1 and state = 'COPIED' and new_ref_version = 1",
    )
    .bind(r.id)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if updated.rows_affected() != 1 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    audit(&mut tx, r, "copy-discarded", "OUTCOME", "FAILED").await?;
    tx.commit().await.map_err(unavailable)?;
    Err(StatusCode::CONFLICT.into_response())
}

async fn observe_target_without_transition(
    state: &ServiceState,
    r: &Rehome,
) -> Result<(), Response> {
    if state
        .secrets
        .observed_version(&r.target_locator)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?
        != 1
    {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    let reference = SecretRef {
        locator: r.target_locator.clone(),
        version: 1,
        audience: r.old_audience.clone(),
    };
    crate::server_identity::read_bound_keys(&state.secrets, &reference, &r.identity_pubkey)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    Ok(())
}

async fn retire(state: &ServiceState, r: &Rehome) -> Result<String, Response> {
    let refs = r
        .old_generation_consumer_refs
        .as_array()
        .ok_or(StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    for item in refs {
        let id = item
            .get("actionExecutionId")
            .and_then(Value::as_str)
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or(StatusCode::SERVICE_UNAVAILABLE.into_response())?;
        let workflow = item.get("workflowId").and_then(Value::as_str);
        if !consumer_terminal(state, r.tenant_id, id, workflow).await? {
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
    }
    // 冻结清单只证明旧 generation 的已知消费者已终态；切换与退役是不同
    // 轮次，还要确认当前 binding 仍指向已查证的新 ref。现有 Core 中只有
    // cutover 改写该 locator，其他身份路径只改状态/generation，不写回旧 ref。
    let binding: Option<(String, i32, String, i32)> = sqlx::query_as(
        "select private_key_secret_ref, private_key_secret_version,
                private_key_secret_audience, version
         from identity.buzz_identity_binding
         where pubkey = $1 and tenant_id = $2",
    )
    .bind(&r.identity_pubkey)
    .bind(r.tenant_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    if !binding_is_cutover_target(binding.as_ref(), r) {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    let version = u32::try_from(r.old_version).map_err(|_| StatusCode::CONFLICT.into_response())?;
    let destroyed = state
        .secrets
        .version_destroyed(r.tenant_id, &r.old_locator, version)
        .await
        .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
    if !destroyed {
        // 切换和退役分属不同轮次：切换时的 audit 观察不能证明永久销毁时仍可审计。
        // 审计不可用则保留 SWITCHED 与旧版本，待同一 Workflow 继续对账。
        audit_gate(state).await?;
        state
            .secrets
            .destroy_legacy_identity_version(r.tenant_id, &r.old_locator, version)
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
        if !state
            .secrets
            .version_destroyed(r.tenant_id, &r.old_locator, version)
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?
        {
            return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
        }
    }
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    let updated = sqlx::query(
        "update admission.secret_ref_rehome
         set state = 'RETIRED', old_ref_status = 'REVOKED', updated_at = now()
         where id = $1 and state = 'SWITCHED'",
    )
    .bind(r.id)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?;
    if updated.rows_affected() != 1 {
        return Err(StatusCode::SERVICE_UNAVAILABLE.into_response());
    }
    audit(&mut tx, r, "retired", "OUTCOME", "RETIRED").await?;
    tx.commit().await.map_err(unavailable)?;
    Ok("RETIRED".into())
}

fn binding_is_cutover_target(binding: Option<&(String, i32, String, i32)>, r: &Rehome) -> bool {
    let Some(expected_generation) = r.expected_binding_version.checked_add(1) else {
        return false;
    };
    matches!(binding,
        Some((locator, 1, audience, generation))
            if locator == &r.target_locator
                && audience == &r.old_audience
                && *generation >= expected_generation
    )
}

async fn consumer_terminal(
    state: &ServiceState,
    tenant: Uuid,
    action: Uuid,
    frozen_workflow: Option<&str>,
) -> Result<bool, Response> {
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "select gate_state, dispatch_state, temporal_workflow_id
         from admission.action_execution where id = $1 and tenant_id = $2",
    )
    .bind(action)
    .bind(tenant)
    .fetch_optional(&state.pool)
    .await
    .map_err(unavailable)?;
    let Some((gate, dispatch, action_workflow)) = row else {
        return Ok(false);
    };
    if matches!(gate.as_str(), "EVALUATING" | "WAITING") {
        return Ok(false);
    }
    // Stage 1 的直接 service 链有 WorkflowRef，却没有回填
    // ActionExecution.temporal_workflow_id；审批动作还可有两类 WorkflowRef。
    // 退役必须查证此 Action 的全部实际 Workflow，而不是信任那一个可空投递列。
    let refs: Vec<(String, String)> = sqlx::query_as(
        "select workflow_id, projection_state from projection.workflow_ref
         where tenant_id = $1 and action_execution_id = $2",
    )
    .bind(tenant)
    .bind(action)
    .fetch_all(&state.pool)
    .await
    .map_err(unavailable)?;
    if frozen_workflow.is_some_and(|frozen| !refs.iter().any(|(id, _)| id == frozen))
        || action_workflow
            .as_deref()
            .is_some_and(|recorded| !refs.iter().any(|(id, _)| id == recorded))
    {
        return Ok(false);
    }
    for (workflow, projection) in &refs {
        if projection != "TERMINAL" {
            return Ok(false);
        }
        let observed = state
            .temporal
            .describe(workflow)
            .await
            .map_err(|_| StatusCode::SERVICE_UNAVAILABLE.into_response())?;
        if !matches!(observed.map(|o| o.state), Some(ObservedState::Closed(_))) {
            return Ok(false);
        }
    }
    if !refs.is_empty() {
        return Ok(matches!(
            gate.as_str(),
            "ALLOWED" | "DENIED" | "REVOKED" | "EXPIRED"
        ));
    }
    Ok(frozen_workflow.is_none()
        && action_workflow.is_none()
        && (matches!(gate.as_str(), "DENIED" | "REVOKED" | "EXPIRED")
            || (gate == "ALLOWED" && matches!(dispatch.as_str(), "ABORTED" | "DISPATCHED"))))
}

#[derive(sqlx::FromRow)]
struct AuditContext {
    operation_id: Uuid,
    initiator_principal_id: Uuid,
    actor_principal_id: Uuid,
    target_id: Uuid,
    parameter_hash: String,
    correlation_id: Uuid,
    action_version: i32,
    component_type_key: String,
    target_type: String,
    result_exposure: String,
}

async fn audit(
    tx: &mut Transaction<'_, Postgres>,
    r: &Rehome,
    stage: &str,
    event_type: &str,
    result: &str,
) -> Result<(), Response> {
    let a: AuditContext = sqlx::query_as(
        "select ae.operation_id, ae.initiator_principal_id, ae.actor_principal_id,
                ae.target_id, ae.parameter_hash, ae.correlation_id, ae.action_version,
                d.component_type_key, d.target_type, d.result_exposure
         from admission.action_execution ae
         join catalog.action_definition d
           on d.action_key = ae.action_key and d.version = ae.action_version
         where ae.id = $1 and ae.tenant_id = $2 and ae.action_key = $3",
    )
    .bind(r.action_execution_id)
    .bind(r.tenant_id)
    .bind(ACTION)
    .fetch_one(&mut **tx)
    .await
    .map_err(unavailable)?;
    append(
        tx,
        AuditEntry {
            event_key: format!("{}:{stage}", a.operation_id),
            tenant_id: Some(r.tenant_id),
            workspace_id: None,
            operation_id: a.operation_id,
            event_type,
            human_identity_id: None,
            initiator_principal_id: Some(a.initiator_principal_id),
            actor_principal_id: Some(a.actor_principal_id),
            action_key: ACTION,
            action_version: a.action_version,
            component_type_key: &a.component_type_key,
            target_type: Some(&a.target_type),
            target_id: Some(a.target_id),
            parameter_hash: &a.parameter_hash,
            decision: "ALLOW",
            result_code: result,
            result_exposure: &a.result_exposure,
            evidence_refs: vec![Evidence::new(EvidenceKind::SecretRefRehomeId, r.id)],
            correlation_id: a.correlation_id,
        },
    )
    .await
    .map_err(unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_version_cannot_retire_if_binding_is_not_on_cutover_target() {
        let r = Rehome {
            id: Uuid::nil(),
            action_execution_id: Uuid::nil(),
            workflow_id: String::new(),
            tenant_id: Uuid::nil(),
            identity_pubkey: String::new(),
            expected_binding_version: 7,
            old_locator: "old".into(),
            old_version: 1,
            old_audience: "buzz".into(),
            target_locator: "new".into(),
            new_ref_version: Some(1),
            old_generation_consumer_refs: json!([]),
            state: "SWITCHED".into(),
        };
        let active = ("new".into(), 1, "buzz".into(), 8);
        assert!(binding_is_cutover_target(Some(&active), &r));
        assert!(binding_is_cutover_target(
            Some(&("new".into(), 1, "buzz".into(), 9)),
            &r
        ));
        for changed in [
            ("old".into(), 1, "buzz".into(), 8),
            ("new".into(), 2, "buzz".into(), 8),
            ("new".into(), 1, "other".into(), 8),
            ("new".into(), 1, "buzz".into(), 7),
        ] {
            assert!(!binding_is_cutover_target(Some(&changed), &r));
        }
        assert!(!binding_is_cutover_target(None, &r));
    }

    #[tokio::test]
    async fn rehome_initiator_must_belong_to_action_tenant() {
        let Ok(url) = std::env::var("DATABASE_URL") else {
            return;
        };
        let pool = PgPool::connect(&url).await.expect("连接核验数据库");
        let mut tx = pool.begin().await.expect("开始隔离事务");
        let source_tenant = Uuid::new_v4();
        let other_tenant = Uuid::new_v4();
        let human = Uuid::new_v4();
        let principal = Uuid::new_v4();
        let action = Uuid::new_v4();

        for tenant in [source_tenant, other_tenant] {
            sqlx::query(
                "insert into identity.tenant (id, slug, name, state)
                 values ($1, $2, '归位授权核验', 'ACTIVE')",
            )
            .bind(tenant)
            .bind(format!("rehome-auth-{tenant}"))
            .execute(&mut *tx)
            .await
            .expect("创建事务内 Tenant");
        }
        sqlx::query("insert into identity.human_identity (id, display_name, status) values ($1, '归位授权核验', 'ACTIVE')")
            .bind(human)
            .execute(&mut *tx)
            .await
            .expect("创建事务内 HumanIdentity");
        sqlx::query("insert into identity.principal (id, tenant_id, kind, status) values ($1, $2, 'HUMAN', 'ACTIVE')")
            .bind(principal)
            .bind(source_tenant)
            .execute(&mut *tx)
            .await
            .expect("创建源 Tenant Principal");
        sqlx::query(
            "insert into identity.tenant_membership
             (id, tenant_id, human_identity_id, tenant_principal_id, state)
             values ($1, $2, $3, $4, 'ACTIVE')",
        )
        .bind(Uuid::new_v4())
        .bind(source_tenant)
        .bind(human)
        .bind(principal)
        .execute(&mut *tx)
        .await
        .expect("创建源 Tenant membership");
        sqlx::query(
            "insert into admission.action_execution
             (id, operation_id, tenant_id, action_key, action_version,
              initiator_principal_id, actor_principal_id, target_id, parameter_hash,
              gate_state, dispatch_state, correlation_id)
             values ($1, $2, $3, $4, 1, $5, $5, $5, 'scope-check',
                     'ALLOWED', 'NOT_DISPATCHED', $6)",
        )
        .bind(action)
        .bind(Uuid::new_v4())
        .bind(other_tenant)
        .bind(ACTION)
        .bind(principal)
        .bind(Uuid::new_v4())
        .execute(&mut *tx)
        .await
        .expect("创建跨 Tenant 的历史动作事实");

        let cross_tenant: Option<Uuid> = sqlx::query_scalar(ACTIVE_REHOME_INITIATOR_SQL)
            .bind(action)
            .bind(other_tenant)
            .fetch_optional(&mut *tx)
            .await
            .expect("跨 Tenant 资格查询");
        assert_eq!(cross_tenant, None, "旧 membership 不能授权另一 Tenant 动作");

        sqlx::query("update admission.action_execution set tenant_id = $2 where id = $1")
            .bind(action)
            .bind(source_tenant)
            .execute(&mut *tx)
            .await
            .expect("将动作改回同 Tenant");
        let same_tenant: Option<Uuid> = sqlx::query_scalar(ACTIVE_REHOME_INITIATOR_SQL)
            .bind(action)
            .bind(source_tenant)
            .fetch_optional(&mut *tx)
            .await
            .expect("同 Tenant 资格查询");
        assert_eq!(same_tenant, Some(principal));
        tx.rollback().await.expect("回滚事务内夹具");
    }
}
