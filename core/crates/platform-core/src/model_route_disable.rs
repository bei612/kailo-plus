//! DD-134(7) `llm_route.disable`：route `ACTIVE → RETAINED_READ_ONLY` 并退役 Gateway 投影（`05` §2.13）。
//!
//! 准入事务内把 route 转为 `RETAINED_READ_ONLY`（`03` §3：只可 discover 元数据），
//! 此后 `ROUTE` 查询不再命中它，Installation 新回合与 binding 的
//! `PLATFORM_LLM_ROUTE` 调用由各自的 fresh 检查拒绝。派发只沿 `llm_route.create`
//! 已登记的退役路径删除该 route 的 provider/model/virtualModel 投影与凭据文件，
//! 并回读不存在；结果不明保持 ActionExecution `UNKNOWN`，重派发只对同一 route
//! 回读与幂等删除，不另建投影或换 ID。停用不可逆：恢复以新建 route 完成。

use super::*;

pub(crate) const KEY: &str = "llm_route.disable";

#[derive(FromRow)]
struct Disabling {
    version: i32,
    state: String,
    home_workspace_id: Option<Uuid>,
    owner_principal_id: Uuid,
    projection_action_execution_id: Option<Uuid>,
}

const DISABLING: &str = "select r.version,r.state,r.home_workspace_id,r.owner_principal_id,
    r.projection_action_execution_id from catalog.resource r
    join catalog.model_route m on m.resource_id=r.id
    where r.id=$1 and r.tenant_id=$2 and r.type_key='llm_route'";

fn exact_definition(def: &crate::governance::Definition) -> bool {
    def.action_key == KEY
        && def.target_type == "RESOURCE"
        && def.permission_object_type == "resource"
        && def.permission == "manage"
        && def.tenant_rule == "SESSION_TENANT"
        && def.workspace_rule == "TARGET_HOME_WORKSPACE"
        && def.execution_mode == "SYNC"
        && def.confirmation_mode == "EXPLICIT"
        && def.quota_policy == "NONE"
        && def.meters.is_empty()
        && def.workflow_kind.is_none()
        && def.approval_policy_id.is_none()
        && def.approval_policy_version.is_none()
        && def.result_exposure == "NONE"
}

fn admissible(state: &str, projecting: bool) -> bool {
    state == "ACTIVE" && !projecting
}

/// 准入只接受当前 `ACTIVE`、无在途投影、版本与请求一致的 Core 治理 route。
pub(crate) async fn target(
    conn: &mut sqlx::PgConnection,
    tenant: Uuid,
    def: &crate::governance::Definition,
    params: &crate::governance::Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<crate::governance::Target, Refusal> {
    if !exact_definition(def) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let id = params
        .resource_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let row: Disabling = sqlx::query_as(&format!(
        "{DISABLING}{}",
        if lock { " for update of r" } else { "" }
    ))
    .bind(id)
    .bind(tenant)
    .fetch_optional(&mut *conn)
    .await?
    .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if !admissible(&row.state, row.projection_action_execution_id.is_some())
        || params.resource_version != Some(row.version)
        || frozen.is_some_and(|frozen| frozen != id)
    {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(crate::governance::Target {
        id,
        version: row.version,
        workspace_id: row.home_workspace_id,
    })
}

/// `evaluate` 的 scope guard：target 未变化且 SpiceDB 投影与 Core owner 一致后，
/// 才对该 route Resource fresh Check `manage`。
pub(crate) async fn evaluate_target(
    gov: &crate::governance::Governance,
    tenant: Uuid,
    target: &crate::governance::Target,
) -> Result<bool, Refusal> {
    let mut conn = gov.pool.acquire().await?;
    let Some(row) = sqlx::query_as::<_, Disabling>(DISABLING)
        .bind(target.id)
        .bind(tenant)
        .fetch_optional(&mut *conn)
        .await?
    else {
        return Ok(false);
    };
    if !admissible(&row.state, row.projection_action_execution_id.is_some())
        || row.version != target.version
        || row.home_workspace_id != target.workspace_id
    {
        return Ok(false);
    }
    gov.spicedb
        .resource_projection_matches_in_workspace(
            &target.id.to_string(),
            &tenant.to_string(),
            &row.owner_principal_id.to_string(),
            row.home_workspace_id.map(|id| id.to_string()).as_deref(),
            gov.cfg.relationship_page,
        )
        .await
        .map_err(|_| unavailable())
}

/// 准入同事务：先 fail closed，再派发外部删除。`ROUTE` 只认 `ACTIVE`，此后新调用即被拒绝。
pub(crate) async fn prewrite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &crate::governance::Execution,
) -> Result<(), Refusal> {
    let version = ae
        .frozen_target_version()
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let changed = sqlx::query(
        "update catalog.resource set state='RETAINED_READ_ONLY',version=version+1
        where id=$1 and tenant_id=$2 and type_key='llm_route' and state='ACTIVE'
          and version=$3 and projection_action_execution_id is null
          and home_workspace_id is not distinct from $4",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .bind(version)
    .bind(ae.workspace_id)
    .execute(&mut **tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(())
}

#[derive(FromRow)]
struct Retiring {
    source_refs: Value,
    projection_hashes: Option<Value>,
    retired_absence: Option<Value>,
}

/// 只删除 `llm_route.create` 自己写入的原生投影；不是 Core 创建的原生配置不由本动作删除。
pub(crate) async fn dispatch(
    gov: &crate::governance::Governance,
    id: Uuid,
    def: &crate::governance::Definition,
) -> Result<(), Refusal> {
    if !exact_definition(def) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let mut tx = gov.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let state: Option<String> = sqlx::query_scalar(
        "select state from catalog.resource where id=$1 and tenant_id=$2 and type_key='llm_route'
        for update",
    )
    .bind(ae.target_id)
    .bind(ae.tenant_id)
    .fetch_optional(&mut *tx)
    .await?;
    if !matches!(
        state.as_deref(),
        Some("RETAINED_READ_ONLY" | "DELETING" | "DELETED")
    ) {
        // 准入事务已把 route 转出 ACTIVE；读不到即事实不一致，只记不明并交对账。
        return creation_unknown(tx, &ae, def).await;
    }
    let intent: Option<Retiring> = sqlx::query_as(
        "select source_refs,projection_hashes,retired_absence
        from catalog.model_route_projection where resource_id=$1 for update",
    )
    .bind(ae.target_id)
    .fetch_optional(&mut *tx)
    .await?;
    let Some(intent) = intent else {
        // 既有原生 route 不是 Core 写入的投影：停用只撤销平台使用，不删除其原生配置。
        crate::governance::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), Vec::new())
            .await?;
        tx.commit().await?;
        return Ok(());
    };
    let prepared = frozen_creation_input(&intent.source_refs)
        .and_then(|input| provider_version(&input))
        .and_then(|version| Ok((Gateway::from_env()?, version)));
    let (gateway, version) = match prepared {
        Ok(prepared) => prepared,
        Err(_) => return creation_unknown(tx, &ae, def).await,
    };
    let retired = crate::gateway_admin::history::scope(
        ae.id,
        ae.operation_id,
        gateway.retire_creation(
            ae.tenant_id,
            ae.target_id,
            version,
            intent.projection_hashes.as_ref(),
        ),
    )
    .await;
    let absence = match retired {
        Ok(absence) => absence,
        Err(_) => return creation_unknown(tx, &ae, def).await,
    };
    if intent.retired_absence.is_none() {
        sqlx::query(
            "update catalog.model_route_projection set retired_absence=$2
            where resource_id=$1 and retired_absence is null",
        )
        .bind(ae.target_id)
        .bind(serde_json::to_value(absence).map_err(|_| unavailable())?)
        .execute(&mut *tx)
        .await?;
    }
    crate::governance::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), Vec::new())
        .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_active_settled_route_is_admissible() {
        assert!(admissible("ACTIVE", false));
        assert!(!admissible("ACTIVE", true));
        for state in [
            "PROVISIONING",
            "UNKNOWN",
            "FAILED",
            "RETAINED_READ_ONLY",
            "DELETING",
            "DELETED",
        ] {
            assert!(!admissible(state, false), "{state}");
        }
    }
}
