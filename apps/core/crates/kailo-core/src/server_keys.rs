//! Web 托管 HUMAN 身份的 key revoke 与重建（`.design/09` 的 key revoke/rotate 行、
//! `.design/06` §1 的 `BUZZ_IDENTITY_PROJECTION` 行、`DD-77`）。
//!
//! 轮换 = 先 revoke 再重建，两个 Governed Action、各一条 Workflow：
//!
//! 1. **revoke**：旧 binding `ACTIVE`/`RECONCILING` → `REVOKING`。这一句就是「停新
//!    签名」：Core signer 只取 `ACTIVE` 的 SERVER binding（`web_transport::actor_keys`），
//!    已建立的 BFF 流在再准入周期内关闭（`stream`）。随后 Workflow 把该 pubkey 移出
//!    relay 与全部 Channel roster，查证后 `REVOKED`。旧 binding 留作历史，审计据它
//!    解析已发布的 event。
//! 2. **重建**：此人没有非 `REVOKED` 的 SERVER binding 时，生成新私钥写入独立
//!    locator 的 KV 版本，建新 binding（`RECONCILING`），Workflow 投入 relay 与此人
//!    全部 ACTIVE Channel 后 `ACTIVE`——「重开」。
//!
//! 先撤后建不是偏好：每人至多一条非 `REVOKED` 的 SERVER binding（`DD-77`，库里的
//! 部分唯一索引），新旧并存在模型里不成立。两步之间此人在 Web 上不能发言，这是
//! 轮换期间唯一允许的状态变化方向——只收紧（`.design/09`「中间状态只允许收紧」）。
//!
//! 只接受 `kind=HUMAN`、`custody=SERVER`：原生设备的 CLIENT 身份由其本人经
//! `client_keys` 撤销；CONTROL 的轮换受 GAP-BUZ-01 阻断，在这里被拒绝。

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use kailo_secrets::{SecretError, SecretRef};
use nostr::Keys;
use serde::Deserialize;
use uuid::Uuid;

use crate::audit::{append, AuditEntry};
use crate::client_keys::{IdentityEnvelope, IdentityTarget, KIND};
use crate::component_task::{self, AllowedAction, ComponentTaskInput};
use crate::membership_lifecycle::LifecycleResponse;
use crate::service_api::{authorize, unavailable, ServiceState};

const REVOKE_ACTION: &str = "identity.key_revoke";
pub(crate) const PROVISION_ACTION: &str = "identity.key_provision";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RevokeRequest {
    pub pubkey: String,
    /// 已准入的 ActionExecution，target 是该 binding 的 Principal。它同时是
    /// 这次撤销的幂等键。
    pub action_execution_id: Uuid,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionRequest {
    pub principal_id: Uuid,
    pub action_execution_id: Uuid,
}

pub async fn revoke_server_key(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<RevokeRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    let binding = match sqlx::query!(
        "select tenant_id, principal_id, kind, custody, state, version
         from identity.buzz_identity_binding where pubkey = $1",
        req.pubkey
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(b)) => b,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return unavailable(e),
    };
    if binding.kind != "HUMAN" || binding.custody != "SERVER" {
        // CONTROL：GAP-BUZ-01。CLIENT：私钥不在 Core，撤销由本人经设备入口发起。
        tracing::warn!(kind = %binding.kind, custody = %binding.custody, "该身份不经此入口撤销");
        return StatusCode::CONFLICT.into_response();
    }

    if let Some(r) = resume(
        &state,
        req.action_execution_id,
        binding.tenant_id,
        binding.principal_id,
        Some(&req.pubkey),
        REVOKE_ACTION,
    )
    .await
    {
        return r;
    }
    if !matches!(binding.state.as_str(), "ACTIVE" | "RECONCILING") {
        tracing::warn!(state = %binding.state, "binding 不在可撤销的状态");
        return StatusCode::CONFLICT.into_response();
    }
    let action = match admit(
        &state,
        &req.action_execution_id,
        binding.tenant_id,
        binding.principal_id,
        REVOKE_ACTION,
    )
    .await
    {
        Ok(a) => a,
        Err(r) => return r,
    };

    let mut tx = match state.pool.begin().await {
        Ok(t) => t,
        Err(e) => return unavailable(e),
    };
    // 停签与 WorkflowRef 同事务：提交之后崩溃，同一 ActionExecution 的重试经
    // resume 找回这条 Workflow；反过来就是一把停了签、却没有人去移出 roster 的钥匙。
    let version = match sqlx::query_scalar!(
        "update identity.buzz_identity_binding set state = 'REVOKING', version = version + 1
         where pubkey = $1 and version = $2 and state in ('ACTIVE', 'RECONCILING')
         returning version",
        req.pubkey,
        binding.version
    )
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(v)) => v,
        Ok(None) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    };
    let workflow_id = component_task::workflow_id(KIND, binding.tenant_id, &req.pubkey, version);
    if let Err(e) = record(
        &mut tx,
        &workflow_id,
        binding.tenant_id,
        binding.principal_id,
        req.action_execution_id,
        &action,
        &req.pubkey,
        "REVOKING",
    )
    .await
    {
        return unavailable(e);
    }
    if let Err(e) = tx.commit().await {
        return unavailable(e);
    }
    tracing::info!(pubkey = %req.pubkey, workflow_id, "Web 托管身份已停签，开始移出 roster");
    start(
        &state,
        binding.tenant_id,
        &req.pubkey,
        version,
        req.action_execution_id,
    )
    .await
}

pub async fn provision_server_key(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<ProvisionRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(e) = authorize(&state, &headers).await {
        return e;
    }
    let Ok(Json(req)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };

    // 重建只给仍是 ACTIVE 成员的人：离开 Tenant 的人不该重新拿到协作身份
    let tenant_id = match sqlx::query_scalar!(
        "select tenant_id from identity.tenant_membership
         where tenant_principal_id = $1 and state = 'ACTIVE'",
        req.principal_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(t)) => t,
        Ok(None) => {
            tracing::warn!(principal = %req.principal_id, "没有 ACTIVE 的 Tenant 成员关系，不重建身份");
            return StatusCode::CONFLICT.into_response();
        }
        Err(e) => return unavailable(e),
    };
    if let Some(r) = resume(
        &state,
        req.action_execution_id,
        tenant_id,
        req.principal_id,
        None,
        PROVISION_ACTION,
    )
    .await
    {
        return r;
    }
    // 仍有非 REVOKED 的 SERVER binding：旧的还没撤完，或已经重建过。先撤后建。
    match sqlx::query_scalar!(
        "select state from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state <> 'REVOKED'",
        tenant_id,
        req.principal_id
    )
    .fetch_optional(&state.pool)
    .await
    {
        Ok(None) => {}
        Ok(Some(s)) => {
            tracing::warn!(state = %s, "此人仍有非 REVOKED 的 Web 托管身份");
            return StatusCode::CONFLICT.into_response();
        }
        Err(e) => return unavailable(e),
    }
    let action = match admit(
        &state,
        &req.action_execution_id,
        tenant_id,
        req.principal_id,
        PROVISION_ACTION,
    )
    .await
    {
        Ok(a) => a,
        Err(r) => return r,
    };

    provision_admitted(
        &state,
        tenant_id,
        req.principal_id,
        req.action_execution_id,
        &action,
    )
    .await
}

/// ActionExecution 是治理意图；这一行把其唯一 OpenBao 目标在首次写入前落库。
/// 同一 Principal 只允许一条未结束意图，避免并发重建写出两把孤儿钥匙。
async fn prewrite_secret_intent(
    state: &ServiceState,
    tenant_id: Uuid,
    principal_id: Uuid,
    action_id: Uuid,
) -> Result<String, Response> {
    let locator = state
        .secrets
        .tenant_locator(tenant_id, &format!("buzz-human/provision/{action_id}"));
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    // 准入事实与 UNKNOWN/intent 在同一事务中核验并锁定。入口处的成员检查
    // 不是写入前的凭据：它与这里之间仍可发生撤权或 Tenant 暂停。
    let still_allowed: Option<i32> = sqlx::query_scalar(
        "select 1 from admission.action_execution ae
         join identity.principal p on p.id = ae.target_id
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         join identity.tenant t on t.id = ae.tenant_id
         join identity.principal actor on actor.id = ae.initiator_principal_id
         join identity.tenant_membership actor_tm
           on actor_tm.tenant_principal_id = actor.id
         where ae.id = $1 and ae.tenant_id = $2 and ae.target_id = $3
           and ae.action_key = $4 and ae.gate_state = 'ALLOWED'
           and (ae.dispatch_state = 'NOT_DISPATCHED'
                or (ae.dispatch_state = 'UNKNOWN' and exists (
                    select 1 from admission.server_key_provision_intent i
                    where i.action_execution_id = ae.id and i.finished_at is null)))
           and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and p.tenant_id = ae.tenant_id and tm.tenant_id = ae.tenant_id
           and tm.state = 'ACTIVE' and t.state = 'ACTIVE'
           and actor.tenant_id = ae.tenant_id and actor.status = 'ACTIVE'
           and actor_tm.tenant_id = ae.tenant_id and actor_tm.state = 'ACTIVE'
         for update of ae, p, tm, t, actor, actor_tm",
    )
    .bind(action_id)
    .bind(tenant_id)
    .bind(principal_id)
    .bind(PROVISION_ACTION)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if still_allowed.is_none() {
        return Err(StatusCode::CONFLICT.into_response());
    }
    let changed = sqlx::query(
        "update admission.action_execution as ae
         set dispatch_state = 'UNKNOWN', reason_code = 'EXTERNAL_RESULT_UNKNOWN', updated_at = now()
         where id = $1 and tenant_id = $2 and target_id = $3
           and action_key = $4 and gate_state = 'ALLOWED'
           and (dispatch_state = 'NOT_DISPATCHED'
                or (dispatch_state = 'UNKNOWN' and exists (
                    select 1 from admission.server_key_provision_intent i
                    where i.action_execution_id = ae.id
                      and i.finished_at is null)))",
    )
    .bind(action_id)
    .bind(tenant_id)
    .bind(principal_id)
    .bind(PROVISION_ACTION)
    .execute(&mut *tx)
    .await
    .map_err(unavailable)?
    .rows_affected();
    if changed != 1 {
        return Err(StatusCode::CONFLICT.into_response());
    }
    // 两条 SERVER HUMAN 创建入口共用 Principal 行锁与未完成意图唯一约束。
    // 前一意图若已把 binding 提交，后一意图不能先写第二把 OpenBao 私钥。
    let binding: Option<i32> = sqlx::query_scalar(
        "select 1 from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state <> 'REVOKED'",
    )
    .bind(tenant_id)
    .bind(principal_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if binding.is_some() {
        return Err(StatusCode::CONFLICT.into_response());
    }
    let inserted = sqlx::query(
        "insert into admission.server_key_provision_intent
             (action_execution_id, tenant_id, principal_id, target_locator)
         values ($1,$2,$3,$4)
         on conflict (action_execution_id) do nothing",
    )
    .bind(action_id)
    .bind(tenant_id)
    .bind(principal_id)
    .bind(&locator)
    .execute(&mut *tx)
    .await;
    match inserted {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return Err(StatusCode::CONFLICT.into_response());
        }
        Err(e) => return Err(unavailable(e)),
    }
    let frozen: Option<(Uuid, Uuid, String, bool)> = sqlx::query_as(
        "select tenant_id, principal_id, target_locator, finished_at is not null
         from admission.server_key_provision_intent
         where action_execution_id = $1 and source_membership_id is null",
    )
    .bind(action_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    if !matches!(frozen, Some((t, p, ref l, false)) if t == tenant_id && p == principal_id && *l == locator)
    {
        return Err(StatusCode::CONFLICT.into_response());
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(locator)
}

/// KV v2 只允许在该 ActionExecution 的独立路径上写版本 1。即使响应丢失，
/// 下一轮也先观察该路径，绝不生成第二个版本；公钥只从读回的私钥推导。
pub(crate) async fn read_or_write_provision_key(
    state: &ServiceState,
    locator: &str,
) -> Result<String, SecretError> {
    let observed = state.secrets.observed_version(locator).await?;
    if observed == 0 {
        let keys = Keys::generate();
        match state
            .secrets
            .write_once(locator, "value", &keys.secret_key().to_secret_hex())
            .await
        {
            Ok(1) => {}
            // 包括 CAS 竞争和丢失响应：只查证确定目标，不以本地 keys 推断写入结果。
            Ok(_) | Err(SecretError::WriteRejected) | Err(SecretError::Transport(_)) => {}
            Err(e) => return Err(e),
        }
    }
    let version = state.secrets.observed_version(locator).await?;
    if version != 1 {
        tracing::warn!(version, "托管身份意图的 KV 目标不在钉定版本 1");
        return Err(SecretError::Malformed);
    }
    let secret = state
        .secrets
        .read(
            &SecretRef {
                locator: locator.to_owned(),
                version,
                audience: state.secret_audience.clone(),
            },
            "value",
        )
        .await?;
    let keys = Keys::parse(secret.expose()).map_err(|_| {
        tracing::warn!("托管身份目标已写入不可解析的私钥");
        SecretError::Malformed
    })?;
    Ok(keys.public_key().to_hex())
}

async fn provision_admitted(
    state: &ServiceState,
    tenant_id: Uuid,
    principal_id: Uuid,
    action_id: Uuid,
    action: &AllowedAction,
) -> Response {
    let locator = match prewrite_secret_intent(state, tenant_id, principal_id, action_id).await {
        Ok(locator) => locator,
        Err(r) => return resume_provision_or(state, tenant_id, principal_id, action_id, r).await,
    };
    if !prewrite_admissible(state, tenant_id, principal_id, action_id, false, false).await {
        // 撤权已开始：不产生新的 OpenBao 副作用。意图保留供对账和超期告警。
        return resume_provision_or(
            state,
            tenant_id,
            principal_id,
            action_id,
            StatusCode::CONFLICT.into_response(),
        )
        .await;
    }
    let pubkey = match read_or_write_provision_key(state, &locator).await {
        Ok(pubkey) => pubkey,
        Err(e) => {
            tracing::warn!(error = %e, "托管身份目标的密钥库操作失败");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
    };
    let mut tx = match state.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => return unavailable(e),
    };
    // 外部写入之后、对外投影之前重新核对：成员已撤权或 Tenant 已暂停时，
    // 密钥只留在未完成意图供对账，不建立可签名身份。
    let still_allowed: Option<i32> = match sqlx::query_scalar(
        "select 1 from admission.action_execution ae
         join identity.principal p on p.id = ae.target_id
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         join identity.tenant t on t.id = ae.tenant_id
         join identity.principal actor on actor.id = ae.initiator_principal_id
         join identity.tenant_membership actor_tm
           on actor_tm.tenant_principal_id = actor.id
         where ae.id = $1 and ae.tenant_id = $2 and ae.target_id = $3
           and ae.action_key = $4 and ae.gate_state = 'ALLOWED'
           and ae.dispatch_state = 'UNKNOWN' and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and p.tenant_id = ae.tenant_id and tm.tenant_id = ae.tenant_id
           and tm.state = 'ACTIVE' and t.state = 'ACTIVE'
           and actor.tenant_id = ae.tenant_id and actor.status = 'ACTIVE'
           and actor_tm.tenant_id = ae.tenant_id and actor_tm.state = 'ACTIVE'
         for update of ae, p, tm, t, actor, actor_tm",
    )
    .bind(action_id)
    .bind(tenant_id)
    .bind(principal_id)
    .bind(PROVISION_ACTION)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(v) => v,
        Err(e) => return unavailable(e),
    };
    if still_allowed.is_none() {
        return StatusCode::CONFLICT.into_response();
    }
    let frozen: Option<(String, bool)> = match sqlx::query_as(
        "select target_locator, finished_at is not null
         from admission.server_key_provision_intent
         where action_execution_id = $1 and tenant_id = $2 and principal_id = $3
           and source_membership_id is null for update",
    )
    .bind(action_id)
    .bind(tenant_id)
    .bind(principal_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(v) => v,
        Err(e) => return unavailable(e),
    };
    if !matches!(frozen, Some((ref l, false)) if *l == locator) {
        drop(tx);
        return resume_provision_or(
            state,
            tenant_id,
            principal_id,
            action_id,
            StatusCode::CONFLICT.into_response(),
        )
        .await;
    }
    let existing: Option<i32> = match sqlx::query_scalar(
        "select 1 from identity.buzz_identity_binding
         where tenant_id = $1 and principal_id = $2 and kind = 'HUMAN'
           and custody = 'SERVER' and state <> 'REVOKED'",
    )
    .bind(tenant_id)
    .bind(principal_id)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(v) => v,
        Err(e) => return unavailable(e),
    };
    if existing.is_some() {
        return StatusCode::CONFLICT.into_response();
    }
    let inserted = sqlx::query(
        "insert into identity.buzz_identity_binding
             (tenant_id, principal_id, pubkey, custody, private_key_secret_ref,
              private_key_secret_version, private_key_secret_audience, kind, state)
         values ($1,$2,$3,'SERVER',$4,1,$5,'HUMAN','RECONCILING')",
    )
    .bind(tenant_id)
    .bind(principal_id)
    .bind(&pubkey)
    .bind(&locator)
    .bind(&state.secret_audience)
    .execute(&mut *tx)
    .await;
    match inserted {
        Ok(_) => {}
        Err(sqlx::Error::Database(e)) if e.is_unique_violation() => {
            return StatusCode::CONFLICT.into_response()
        }
        Err(e) => return unavailable(e),
    }
    let version = 1;
    let workflow_id = component_task::workflow_id(KIND, tenant_id, &pubkey, version);
    if let Err(e) = record(
        &mut tx,
        &workflow_id,
        tenant_id,
        principal_id,
        action_id,
        action,
        &pubkey,
        "RECONCILING",
    )
    .await
    {
        return unavailable(e);
    }
    let finished = sqlx::query(
        "update admission.server_key_provision_intent set finished_at = now()
         where action_execution_id = $1 and source_membership_id is null
           and finished_at is null",
    )
    .bind(action_id)
    .execute(&mut *tx)
    .await;
    match finished {
        Ok(result) if result.rows_affected() == 1 => {}
        Ok(_) => return StatusCode::CONFLICT.into_response(),
        Err(e) => return unavailable(e),
    }
    if let Err(e) = tx.commit().await {
        return unavailable(e);
    }
    tracing::info!(
        pubkey,
        workflow_id,
        "Web 托管身份已绑定钉定 KV 版本，开始投入 roster"
    );
    launch_provision(
        state,
        tenant_id,
        principal_id,
        &pubkey,
        version,
        action_id,
        false,
    )
    .await
}

async fn prewrite_admissible(
    state: &ServiceState,
    tenant_id: Uuid,
    principal_id: Uuid,
    action_id: Uuid,
    allow_dispatched: bool,
    allow_legacy_without_intent: bool,
) -> bool {
    match sqlx::query_scalar::<_, i32>(
        "select 1 from admission.action_execution ae
         join identity.principal p on p.id = ae.target_id
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         join identity.tenant t on t.id = ae.tenant_id
         where ae.id = $1 and ae.tenant_id = $2 and ae.target_id = $3
           and ae.action_key = $4 and ae.gate_state = 'ALLOWED'
           and (ae.dispatch_state = 'UNKNOWN' or ($5 and ae.dispatch_state = 'DISPATCHED')
                or ($6 and ae.dispatch_state = 'NOT_DISPATCHED' and not exists (
                    select 1 from admission.server_key_provision_intent i
                    where i.action_execution_id = ae.id)))
           and p.kind = 'HUMAN' and p.status = 'ACTIVE'
           and p.tenant_id = ae.tenant_id and tm.tenant_id = ae.tenant_id
           and tm.state = 'ACTIVE' and t.state = 'ACTIVE'
           and exists (select 1 from identity.principal actor
                       join identity.tenant_membership actor_tm
                         on actor_tm.tenant_principal_id = actor.id
                       where actor.id = ae.initiator_principal_id
                         and actor.tenant_id = ae.tenant_id and actor.status = 'ACTIVE'
                         and actor_tm.tenant_id = ae.tenant_id and actor_tm.state = 'ACTIVE')",
    )
    .bind(action_id)
    .bind(tenant_id)
    .bind(principal_id)
    .bind(PROVISION_ACTION)
    .bind(allow_dispatched)
    .bind(allow_legacy_without_intent)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(Some(_)) => true,
        Ok(None) => false,
        Err(e) => {
            tracing::warn!(action = %action_id, error = %e, "重建前置事实不可用");
            false
        }
    }
}

/// 现有治理对账器重驱动唯一持久意图；不接受请求方替换 locator/pubkey。
pub(crate) async fn reconcile_provision_intent(
    state: &ServiceState,
    action_id: Uuid,
) -> &'static str {
    let row: Option<(Uuid, Uuid, bool)> = match sqlx::query_as(
        "select tenant_id, principal_id, finished_at is not null
         from admission.server_key_provision_intent
         where action_execution_id = $1 and source_membership_id is null",
    )
    .bind(action_id)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::warn!(action = %action_id, error = %e, "读取托管身份写入意图失败");
            return "FAILED";
        }
    };
    let Some((tenant_id, principal_id, finished)) = row else {
        return "GONE";
    };
    if !prewrite_admissible(state, tenant_id, principal_id, action_id, false, false).await {
        return "PRECONDITION";
    }
    if finished {
        return match resume(
            state,
            action_id,
            tenant_id,
            principal_id,
            None,
            PROVISION_ACTION,
        )
        .await
        {
            Some(response) if response.status().is_success() => "REDRIVEN",
            _ => "PENDING",
        };
    }
    let action = match admit(state, &action_id, tenant_id, principal_id, PROVISION_ACTION).await {
        Ok(action) => action,
        Err(_) => return "PRECONDITION",
    };
    let response = provision_admitted(state, tenant_id, principal_id, action_id, &action).await;
    if response.status().is_success() {
        "REDRIVEN"
    } else {
        "PENDING"
    }
}

/// 升级前已经预写 WorkflowRef 的 Action 不补造新私钥或新 intent，只按原引用
/// 查证并重驱原固定 Workflow。证据不完整时保留原派发状态，由告警暴露。
pub(crate) async fn reconcile_legacy_provision(
    state: &ServiceState,
    action_id: Uuid,
) -> &'static str {
    let row: Option<(Uuid, Uuid)> = match sqlx::query_as(
        "select ae.tenant_id, ae.target_id from admission.action_execution ae
         where ae.id = $1 and ae.action_key = $2 and ae.gate_state = 'ALLOWED'
           and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN')
           and not exists (select 1 from admission.server_key_provision_intent i
                           where i.action_execution_id = ae.id)",
    )
    .bind(action_id)
    .bind(PROVISION_ACTION)
    .fetch_optional(&state.pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            tracing::warn!(action = %action_id, error = %e, "旧版身份动作读取失败");
            return "FAILED";
        }
    };
    let Some((tenant_id, principal_id)) = row else {
        return "GONE";
    };
    match resume(
        state,
        action_id,
        tenant_id,
        principal_id,
        None,
        PROVISION_ACTION,
    )
    .await
    {
        Some(response) if response.status().is_success() => "REDRIVEN",
        Some(response) => {
            tracing::warn!(action = %action_id, status = %response.status(), "旧版固定 Workflow 恢复未收敛");
            "PENDING"
        }
        None => "MISSING_REF",
    }
}

async fn resume_provision_or(
    state: &ServiceState,
    tenant_id: Uuid,
    principal_id: Uuid,
    action_id: Uuid,
    fallback: Response,
) -> Response {
    resume(
        state,
        action_id,
        tenant_id,
        principal_id,
        None,
        PROVISION_ACTION,
    )
    .await
    .unwrap_or(fallback)
}

async fn launch_provision(
    state: &ServiceState,
    tenant_id: Uuid,
    principal_id: Uuid,
    pubkey: &str,
    version: i32,
    action_id: Uuid,
    legacy_without_intent: bool,
) -> Response {
    let response = start(state, tenant_id, pubkey, version, action_id).await;
    if response.status().is_success() {
        if let Err(r) = mark_provision_dispatched(
            state,
            tenant_id,
            principal_id,
            pubkey,
            action_id,
            legacy_without_intent,
        )
        .await
        {
            return r;
        }
    }
    response
}

async fn mark_provision_dispatched(
    state: &ServiceState,
    tenant_id: Uuid,
    principal_id: Uuid,
    pubkey: &str,
    action_id: Uuid,
    legacy_without_intent: bool,
) -> Result<(), Response> {
    let mut tx = state.pool.begin().await.map_err(unavailable)?;
    // 最终派发标记与新鲜成员/Tenant/原 binding 查证共处一把事务锁下。
    // 撤权不能穿过前置 SELECT 与状态转换之间的窗口。
    let dispatch: Option<String> = sqlx::query_scalar(
        "select ae.dispatch_state from admission.action_execution ae
         join identity.principal p on p.id = ae.target_id
         join identity.tenant_membership tm on tm.tenant_principal_id = p.id
         join identity.tenant t on t.id = ae.tenant_id
         join identity.principal actor on actor.id = ae.initiator_principal_id
         join identity.tenant_membership actor_tm
           on actor_tm.tenant_principal_id = actor.id
         join identity.buzz_identity_binding b on b.tenant_id = ae.tenant_id
           and b.principal_id = p.id and b.pubkey = $6
         where ae.id = $1 and ae.tenant_id = $2 and ae.target_id = $3
           and ae.action_key = $4 and ae.gate_state = 'ALLOWED'
           and p.kind = 'HUMAN' and p.status = 'ACTIVE' and p.tenant_id = ae.tenant_id
           and tm.tenant_id = ae.tenant_id and tm.state = 'ACTIVE'
           and t.state = 'ACTIVE'
           and actor.tenant_id = ae.tenant_id and actor.status = 'ACTIVE'
           and actor_tm.tenant_id = ae.tenant_id and actor_tm.state = 'ACTIVE'
           and b.kind = 'HUMAN' and b.custody = 'SERVER'
           and b.state in ('RECONCILING','ACTIVE')
           and (($5 and ae.dispatch_state in ('NOT_DISPATCHED','UNKNOWN','DISPATCHED')
                 and not exists (select 1 from admission.server_key_provision_intent i
                                 where i.action_execution_id = ae.id))
                or (not $5 and ae.dispatch_state in ('UNKNOWN','DISPATCHED')
                    and exists (select 1 from admission.server_key_provision_intent i
                                where i.action_execution_id = ae.id
                                  and i.finished_at is not null)))
         for update of ae,p,tm,t,actor,actor_tm,b",
    )
    .bind(action_id)
    .bind(tenant_id)
    .bind(principal_id)
    .bind(PROVISION_ACTION)
    .bind(legacy_without_intent)
    .bind(pubkey)
    .fetch_optional(&mut *tx)
    .await
    .map_err(unavailable)?;
    let Some(dispatch) = dispatch else {
        return Err(StatusCode::CONFLICT.into_response());
    };
    if dispatch != "DISPATCHED" {
        let changed = sqlx::query(
            "update admission.action_execution set dispatch_state = 'DISPATCHED',
                    reason_code = null, updated_at = now()
             where id = $1 and gate_state = 'ALLOWED' and dispatch_state = $2",
        )
        .bind(action_id)
        .bind(dispatch)
        .execute(&mut *tx)
        .await
        .map_err(unavailable)?
        .rows_affected();
        if changed != 1 {
            return Err(StatusCode::CONFLICT.into_response());
        }
    }
    tx.commit().await.map_err(unavailable)?;
    Ok(())
}

/// 同一 ActionExecution 已驱动过 Workflow：运行中以固定 ID 收敛；已终结时只
/// 返回原引用，不再向 Temporal Start 终结的 ID。`None` 表示这张准入还没用过。
async fn resume(
    state: &ServiceState,
    action: Uuid,
    tenant_id: Uuid,
    principal_id: Uuid,
    expected_pubkey: Option<&str>,
    expected_action_key: &str,
) -> Option<Response> {
    let existing = match component_task::workflow_of_action(&state.pool, action).await {
        Ok(Some(w)) => w,
        Ok(None) => return None,
        Err(e) => return Some(unavailable(e)),
    };
    let legacy_without_intent = if expected_action_key == PROVISION_ACTION {
        match sqlx::query_scalar::<_, bool>(
            "select not exists (select 1 from admission.server_key_provision_intent
                                where action_execution_id = $1)",
        )
        .bind(action)
        .fetch_one(&state.pool)
        .await
        {
            Ok(value) => value,
            Err(e) => return Some(unavailable(e)),
        }
    } else {
        false
    };
    if expected_action_key == PROVISION_ACTION
        && !prewrite_admissible(
            state,
            tenant_id,
            principal_id,
            action,
            true,
            legacy_without_intent,
        )
        .await
    {
        return Some(StatusCode::CONFLICT.into_response());
    }
    // 固定 ID 的后两段就是冻结的 pubkey 与 binding 版本
    let parts: Vec<&str> = existing.split(':').collect();
    match parts.as_slice() {
        ["kailo", k, t, pubkey, version] if *k == KIND && *t == tenant_id.to_string() => {
            if expected_pubkey.is_some_and(|expected| expected != *pubkey) {
                return Some(StatusCode::CONFLICT.into_response());
            }
            let Ok(version) = version.parse::<i32>() else {
                return Some(StatusCode::CONFLICT.into_response());
            };
            // 重发也要重新核对旧准入仍为 ALLOWED、目标 Principal 与历史 binding
            // 归属；否则借别人的同 Tenant ActionExecution 取回或推进投影。
            type ProjectionRow = (String, Option<String>, Option<i32>, Option<String>);
            let projection: Result<Option<ProjectionRow>, _> = sqlx::query_as(
                "select w.projection_state, b.private_key_secret_ref,
                        b.private_key_secret_version, b.private_key_secret_audience
                 from projection.workflow_ref w
                 join admission.action_execution ae on ae.id = w.action_execution_id
                 join identity.buzz_identity_binding b on b.pubkey = $4
                 where w.workflow_id = $1 and w.action_execution_id = $2
                   and w.tenant_id = $3 and w.workflow_type = $6 and w.kind = $7
                   and ae.tenant_id = $3 and ae.target_id = $5 and ae.gate_state = 'ALLOWED'
                   and ae.action_key = $8
                   and b.tenant_id = $3 and b.principal_id = $5
                   and b.kind = 'HUMAN' and b.custody = 'SERVER'
                   and ($8 <> $9 or (b.state in ('RECONCILING','ACTIVE')
                                      and b.version >= $10))",
            )
            .bind(&existing)
            .bind(action)
            .bind(tenant_id)
            .bind(pubkey)
            .bind(principal_id)
            .bind(component_task::WORKFLOW_TYPE)
            .bind(KIND)
            .bind(expected_action_key)
            .bind(PROVISION_ACTION)
            .bind(version)
            .fetch_optional(&state.pool)
            .await;
            match projection {
                Ok(Some((projection_state, locator, secret_version, audience))) => {
                    if expected_action_key == PROVISION_ACTION && legacy_without_intent {
                        let (Some(locator), Some(secret_version), Some(audience)) =
                            (locator, secret_version, audience)
                        else {
                            return Some(StatusCode::CONFLICT.into_response());
                        };
                        let Ok(secret_version) = u32::try_from(secret_version) else {
                            return Some(StatusCode::CONFLICT.into_response());
                        };
                        if secret_version == 0 {
                            return Some(StatusCode::CONFLICT.into_response());
                        }
                        let reference = SecretRef {
                            locator,
                            version: secret_version,
                            audience,
                        };
                        if let Err(e) = crate::server_identity::read_bound_keys(
                            &state.secrets,
                            &reference,
                            pubkey,
                        )
                        .await
                        {
                            tracing::warn!(action = %action, error = %e, "旧版托管身份原私钥不可查证");
                            return Some(StatusCode::SERVICE_UNAVAILABLE.into_response());
                        }
                    }
                    if projection_state == "TERMINAL" {
                        if expected_action_key == PROVISION_ACTION {
                            if let Err(r) = mark_provision_dispatched(
                                state,
                                tenant_id,
                                principal_id,
                                pubkey,
                                action,
                                legacy_without_intent,
                            )
                            .await
                            {
                                return Some(r);
                            }
                        }
                        Some(
                            (
                                StatusCode::OK,
                                Json(LifecycleResponse {
                                    workflow_id: existing,
                                    kind: KIND.to_owned(),
                                    run_id: None,
                                }),
                            )
                                .into_response(),
                        )
                    } else if expected_action_key == PROVISION_ACTION {
                        Some(
                            launch_provision(
                                state,
                                tenant_id,
                                principal_id,
                                pubkey,
                                version,
                                action,
                                legacy_without_intent,
                            )
                            .await,
                        )
                    } else {
                        Some(start(state, tenant_id, pubkey, version, action).await)
                    }
                }
                Ok(None) => Some(StatusCode::CONFLICT.into_response()),
                Err(e) => Some(unavailable(e)),
            }
        }
        _ => {
            tracing::warn!(action = %action, existing, "ActionExecution 已驱动另一类 Workflow");
            Some(StatusCode::CONFLICT.into_response())
        }
    }
}

async fn admit(
    state: &ServiceState,
    action: &Uuid,
    tenant_id: Uuid,
    principal_id: Uuid,
    expected_action_key: &str,
) -> Result<AllowedAction, Response> {
    match component_task::allowed_action(&state.pool, *action, tenant_id, principal_id).await {
        Ok(Some(a)) if a.action_key == expected_action_key => Ok(a),
        Ok(Some(_)) | Ok(None) => {
            tracing::warn!(action = %action, expected_action_key, "ActionExecution 不存在、动作不符、未准入或 target 不是该 Principal");
            Err(StatusCode::FORBIDDEN.into_response())
        }
        Err(e) => Err(unavailable(e)),
    }
}

/// 预写 WorkflowRef 并写决定审计，两者与调用方的状态变化同事务。
#[allow(clippy::too_many_arguments)]
async fn record(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    workflow_id: &str,
    tenant_id: Uuid,
    principal_id: Uuid,
    action_execution_id: Uuid,
    action: &AllowedAction,
    pubkey: &str,
    result_code: &str,
) -> Result<(), sqlx::Error> {
    component_task::prewrite(
        tx,
        workflow_id,
        KIND,
        tenant_id,
        action.operation_id,
        action_execution_id,
    )
    .await?;
    append(
        tx,
        AuditEntry {
            event_key: format!("{}:{pubkey}:{action_execution_id}", action.action_key),
            tenant_id: Some(tenant_id),
            workspace_id: None,
            operation_id: action.operation_id,
            event_type: "DECISION",
            human_identity_id: None,
            initiator_principal_id: Some(action.initiator_principal_id),
            actor_principal_id: Some(action.actor_principal_id),
            action_key: &action.action_key,
            action_version: action.action_version,
            component_type_key: "buzz",
            target_type: Some("PRINCIPAL"),
            target_id: Some(principal_id),
            parameter_hash: &action.parameter_hash,
            decision: "ALLOW",
            result_code,
            result_exposure: "NONE",
            evidence_refs: serde_json::json!([
                { "kind": "BUZZ_PUBKEY", "value": pubkey },
                { "kind": "TEMPORAL_WORKFLOW_ID", "value": workflow_id },
            ]),
            correlation_id: action.correlation_id,
        },
    )
    .await
}

async fn start(
    state: &ServiceState,
    tenant_id: Uuid,
    pubkey: &str,
    version: i32,
    action: Uuid,
) -> Response {
    let workflow_id = component_task::workflow_id(KIND, tenant_id, pubkey, version);
    let input = ComponentTaskInput {
        kind: KIND.to_owned(),
        target: IdentityEnvelope {
            identity: IdentityTarget {
                pubkey: pubkey.to_owned(),
                binding_version: version,
            },
        },
    };
    match component_task::start(
        &state.pool,
        &state.temporal,
        &workflow_id,
        tenant_id,
        action,
        &input,
    )
    .await
    {
        Ok(run_id) => (
            StatusCode::OK,
            Json(LifecycleResponse {
                workflow_id,
                kind: KIND.to_owned(),
                run_id,
            }),
        )
            .into_response(),
        Err(r) => r,
    }
}
