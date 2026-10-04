//! DD-49、03 §6、17 §8：显式 HUMAN 授权只由同一 governed Action 写入。
//! Grant 是限制，不是 permission；没有已实现的 Agent 动作时确定拒绝。

use chrono::{DateTime, Utc};
use contracts::ReasonCode;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{Definition, Execution, Governance, Params, Refusal, Semantic, Target};

#[derive(sqlx::FromRow)]
pub(crate) struct Installation {
    pub(crate) id: Uuid,
    tenant_id: Uuid,
    pub(crate) workspace_id: Uuid,
    owner_principal_id: Uuid,
    pub(crate) agent_principal_id: Uuid,
    pub(crate) version: i32,
}

#[cfg(test)]
mod cancellation_tests {
    use super::cancellation_required;
    use chrono::{TimeDelta, Utc};

    #[test]
    fn only_known_revocation_or_wall_clock_expiry_cancels() {
        let now = chrono::DateTime::<Utc>::from_timestamp(100, 0).unwrap();
        let future = now + TimeDelta::seconds(1);
        assert!(!cancellation_required("ACTIVE", future, now).unwrap());
        assert!(cancellation_required("ACTIVE", now, now).unwrap());
        assert!(cancellation_required("ACTIVE", now - TimeDelta::seconds(1), now).unwrap());
        for state in ["REVOKING", "REVOKED", "EXPIRED"] {
            assert!(cancellation_required(state, future, now).unwrap());
        }
        for state in ["", "PAUSED", "DISABLED", "FUTURE_STATE"] {
            assert!(cancellation_required(state, future, now).is_err());
        }
    }
}

pub(crate) async fn installation(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Installation>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select r.id,r.tenant_id,i.workspace_id,r.owner_principal_id,i.agent_principal_id,r.version
         from catalog.resource r join catalog.agent_installation i on i.resource_id=r.id
         join identity.workspace w on w.id=i.workspace_id and w.tenant_id=r.tenant_id
         join identity.principal p on p.id=i.agent_principal_id and p.tenant_id=r.tenant_id
         join identity.principal owner on owner.id=r.owner_principal_id and owner.tenant_id=r.tenant_id
         join identity.tenant_membership tm on tm.tenant_principal_id=owner.id and tm.tenant_id=r.tenant_id
         where r.id=$1 and r.tenant_id=$2 and r.type_key='agent.installation'
           and r.home_workspace_id=w.id and r.state='ACTIVE'
           and r.projection_action_execution_id is null and w.state='ACTIVE'
           and p.kind='AGENT' and p.status='ACTIVE'
           and owner.kind='HUMAN' and owner.status='ACTIVE' and tm.state='ACTIVE'
           and i.state='ACTIVE' and i.active_projection_generation is not null{}",
        if lock { " for update of r,i,w,p,owner,tm" } else { "" }
    ))
    .bind(id).bind(tenant).fetch_optional(conn).await
}

pub(crate) async fn projection_matches(
    g: &Governance,
    row: &Installation,
) -> Result<bool, Refusal> {
    g.spicedb
        .resource_projection_matches_in_workspace(
            &row.id.to_string(),
            &row.tenant_id.to_string(),
            &row.owner_principal_id.to_string(),
            Some(&row.workspace_id.to_string()),
            g.cfg.relationship_page,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Installation 授权投影不可核验".into()))
}

pub(super) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    _sem: Semantic,
    params: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    if def.target_type != "RESOURCE"
        || def.permission_object_type != "resource"
        || def.permission != "delegate"
        || def.tenant_rule != "SESSION_TENANT"
        || def.workspace_rule != "TARGET_HOME_WORKSPACE"
        || def.execution_mode != "SYNC"
        || !matches!(
            def.confirmation_mode.as_str(),
            "NONE" | "EXPLICIT" | "APPROVAL"
        )
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    let id = params
        .resource_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let row = installation(conn, tenant, id, lock)
        .await?
        .filter(|r| {
            Some(r.version) == params.resource_version && frozen.is_none_or(|id| id == r.id)
        })
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    Ok(Target {
        id: row.id,
        version: row.version,
        workspace_id: Some(row.workspace_id),
    })
}

/// 目录与实际 dispatch 的交集。仅03/05允许 Agent 代 HUMAN 的普通动作可进入；
/// 这些键尚无 Semantic/handler，不能把登记一行或管理动作当成可执行授权。
fn has_agent_consumer(key: &str) -> bool {
    matches!(
        key,
        "resource.create" | "resource.grant_read" | "resource.revoke_read"
    ) && Semantic::from_key(key).is_some()
}

pub(crate) fn output_schema_hash() -> String {
    format!(
        "{:x}",
        Sha256::digest(
            include_str!("../../../../contracts/api/action_submission.schema.json").as_bytes()
        )
    )
}

pub(super) fn normalize(
    mut grant: contracts::DelegationGrantParameters,
) -> Result<contracts::DelegationGrantParameters, Refusal> {
    let bad = || Refusal::Precondition(ReasonCode::InvalidParameters);
    grant.valid_from = DateTime::parse_from_rfc3339(&grant.valid_from)
        .map_err(|_| bad())?
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true);
    grant.expires_at = DateTime::parse_from_rfc3339(&grant.expires_at)
        .map_err(|_| bad())?
        .with_timezone(&Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true);
    for scope in &mut grant.scopes {
        i32::try_from(scope.action_version)
            .ok()
            .filter(|v| *v > 0)
            .ok_or_else(bad)?;
        for text in [
            &mut scope.target_id,
            &mut scope.create_workspace_id,
            &mut scope.tool_resource_id,
        ]
        .into_iter()
        .flatten()
        {
            let id = Uuid::parse_str(text).map_err(|_| bad())?;
            if id.is_nil() {
                return Err(bad());
            }
            *text = id.to_string();
        }
    }
    grant.scopes.sort_by_key(|scope| {
        (
            scope.action_key.clone(),
            scope.action_version,
            scope.target_type.clone(),
            scope.target_id.clone(),
            scope.create_workspace_id.clone(),
            scope.tool_resource_id.clone(),
            scope.output_schema_hash.clone(),
            scope.redaction_policy.clone(),
        )
    });
    Ok(grant)
}

pub(super) async fn target_gate(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    sem: Semantic,
    params: &Params,
) -> Result<(), Refusal> {
    let id = params
        .resource_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let row = installation(conn, tenant, id, false)
        .await?
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let grant_id = params
        .delegation_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    if sem == Semantic::AgentDelegationRevoke {
        let exists: bool = sqlx::query_scalar(
            "select exists(select 1 from admission.delegation_grant
            where id=$1 and tenant_id=$2 and workspace_id=$3 and installation_resource_id=$4
              and version=$5 and state in ('ACTIVE','REVOKING'))",
        )
        .bind(grant_id)
        .bind(tenant)
        .bind(row.workspace_id)
        .bind(id)
        .bind(params.delegation_version)
        .fetch_one(conn)
        .await?;
        return if exists {
            Ok(())
        } else {
            Err(Refusal::Conflict(ReasonCode::TargetStateConflict))
        };
    }
    let grant = params
        .delegation_grant
        .as_ref()
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let from = DateTime::parse_from_rfc3339(&grant.valid_from)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
        .with_timezone(&Utc);
    let until = DateTime::parse_from_rfc3339(&grant.expires_at)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
        .with_timezone(&Utc);
    let valid: bool = sqlx::query_scalar("select $1 < $2 and $2 > now()")
        .bind(from)
        .bind(until)
        .fetch_one(&mut *conn)
        .await?;
    if !valid || grant.scopes.is_empty() || grant.max_uses.is_some_and(|n| n <= 0) {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let exists: bool =
        sqlx::query_scalar("select exists(select 1 from admission.delegation_grant where id=$1)")
            .bind(grant_id)
            .fetch_one(&mut *conn)
            .await?;
    if exists {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let mut scopes = std::collections::HashSet::new();
    for scope in &grant.scopes {
        if !scopes.insert((
            scope.action_key.clone(),
            scope.action_version,
            scope.target_type.clone(),
            scope.target_id.clone(),
            scope.create_workspace_id.clone(),
            scope.tool_resource_id.clone(),
        )) {
            return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
        }
        validate_scope(g, conn, tenant, initiator, &row, scope).await?;
    }
    Ok(())
}

/// The management directory and the write admission consume this same scope
/// check. A listed target never grants permission, and a later write rechecks it.
pub(crate) async fn validate_scope(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    row: &Installation,
    scope: &contracts::ScopeElement,
) -> Result<(), Refusal> {
    let target = scope
        .target_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let create = scope
        .create_workspace_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?;
    if target.is_some() == create.is_some()
        || create.is_some_and(|w| w != row.workspace_id)
        || target.is_some_and(|id| id.is_nil())
        || scope.action_version <= 0
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    if matches!(
        scope.action_key.as_str(),
        "agent.memory.entry.list" | "agent.memory.entry.read"
    ) {
        return validate_memory_scope(g, conn, tenant, initiator, row, scope, target).await;
    }
    let action:Option<(String,String,String,String,String,String)>=sqlx::query_as(
            "select target_type,permission_object_type,permission,result_exposure,obs_redaction_policy,workspace_rule
             from catalog.action_definition where action_key=$1 and version=$2 and status='ACTIVE'")
            .bind(&scope.action_key).bind(i32::try_from(scope.action_version)
                .map_err(|_|Refusal::Precondition(ReasonCode::InvalidParameters))?)
            .fetch_optional(&mut *conn).await?;
    let Some((target_type, object_type, permission, exposure, redaction, workspace_rule)) = action
    else {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    };
    let automation = scope.action_key == "automation.run";
    let invocation = scope.action_key == crate::agent_invocation::ACTION;
    if invocation && !crate::capability_registry::action_exposed(crate::agent_invocation::ACTION) {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if (!automation && !invocation && !has_agent_consumer(&scope.action_key))
        || scope.tool_resource_id.is_some()
    {
        // ToolDefinition/PEP 当前没有真实生产者，不查询不存在的表或编造输出合同。
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    if scope.target_type != target_type
        || scope.redaction_policy != redaction
        || exposure != "NONE"
        || serde_json::to_value(&scope.result_exposure_mode).ok()
            != Some(serde_json::Value::String("CONSUME_ONLY".into()))
        || scope.output_schema_hash != output_schema_hash()
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let object = if let Some(target) = target {
        if object_type != "resource"
            || !matches!(
                workspace_rule.as_str(),
                "TARGET_HOME_WORKSPACE" | "INHERIT_PARENT"
            )
        {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        let valid:bool=sqlx::query_scalar("select exists(select 1 from catalog.resource
                where id=$1 and tenant_id=$2 and state='ACTIVE' and projection_action_execution_id is null
                  and (home_workspace_id is null or home_workspace_id=$3) and application_binding_id is null)")
                .bind(target).bind(tenant).bind(row.workspace_id).fetch_one(&mut *conn).await?;
        if !valid {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        if invocation && target != row.id {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        if automation {
            crate::automation::delegation_target(
                g,
                conn,
                tenant,
                row.workspace_id,
                row.id,
                initiator,
                (target, scope.action_version),
            )
            .await?;
        }
        target
    } else {
        if object_type != "workspace" || scope.action_key != "resource.create" {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        row.workspace_id
    };
    for (subject, check_permission) in [
        (initiator, permission.as_str()),
        (row.agent_principal_id, permission.as_str()),
        (initiator, "delegate"),
    ] {
        // workspace 的 schema 不含 delegate；创建授权来自 Installation delegate
        // 加 grantor/Agent 对指定 Workspace 的 create，不能替造 workspace relation。
        if object_type == "workspace" && check_permission == "delegate" {
            continue;
        }
        let checked = g
            .spicedb
            .check(
                &object_type,
                &object.to_string(),
                check_permission,
                &subject.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| Refusal::Unavailable("Delegation fresh permission 不可核验".into()))?;
        if checked.zed_token.is_empty() {
            return Err(Refusal::Unavailable(
                "Delegation fresh permission 缺 checked revision".into(),
            ));
        }
        if !checked.allowed {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    Ok(())
}

// 19 §5 / DD-105: only the installed Agent's own Memory, an actual immutable
// ToolBinding, and both HUMAN/AGENT fresh rights can become a Tool scope.
// Binding never grants discover/consume/read, and this path never starts approval.
async fn validate_memory_scope(
    g: &Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    initiator: Uuid,
    row: &Installation,
    scope: &contracts::ScopeElement,
    target: Option<Uuid>,
) -> Result<(), Refusal> {
    let tool = scope
        .tool_resource_id
        .as_deref()
        .and_then(|id| Uuid::parse_str(id).ok())
        .filter(|id| !id.is_nil())
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let definition = crate::agent_memory::read_definition(&g.pool, &scope.action_key).await?;
    let hashes = crate::agent_tool::schema_hashes(&scope.action_key)?;
    if target != Some(row.id)
        || scope.create_workspace_id.is_some()
        || scope.target_type != "RESOURCE"
        || scope.action_version != i64::from(definition.version)
        || scope.redaction_policy != "PLATFORM_METADATA_ONLY"
        || scope.output_schema_hash != hashes.1
        || serde_json::to_value(&scope.result_exposure_mode).ok()
            != Some(serde_json::Value::String("CONSUME_ONLY".into()))
    {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let valid: bool = sqlx::query_scalar("select exists(select 1 from catalog.tool_binding b
        join catalog.agent_installation i on i.resource_id=b.installation_resource_id
          and i.active_projection_generation=b.projection_generation and i.pinned_version_asset_id=b.agent_version_asset_id
        join catalog.agent_runtime_projection p on p.installation_resource_id=i.resource_id
          and p.generation=b.projection_generation and p.agent_version_asset_id=b.agent_version_asset_id and p.state='ACTIVE'
        join catalog.agent_version v on v.asset_id=b.agent_version_asset_id
        join catalog.tool_definition t on t.resource_id=b.tool_resource_id and t.source='PLATFORM_NATIVE'
          and t.backend_ref='CORE_STREAMABLE_MCP' and t.status='ACTIVE'
        join catalog.resource r on r.id=t.resource_id and r.tenant_id=$1 and r.state='ACTIVE'
          and r.type_key='tool.definition' and r.projection_action_execution_id is null
        where b.installation_resource_id=$2 and b.tool_resource_id=$3 and b.workspace_id=$4
          and b.status in ('NO_PERMISSION','ACTIVE') and t.action_key=$5 and t.name=$5
          and t.input_schema_hash=$6 and t.output_schema_hash=$7
          and v.content->'declaredToolResourceIds' @> jsonb_build_array(t.resource_id::text))")
        .bind(tenant).bind(row.id).bind(tool).bind(row.workspace_id).bind(&scope.action_key)
        .bind(&hashes.0).bind(&hashes.1).fetch_one(&mut *conn).await?;
    if !valid {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    for subject in [initiator, row.agent_principal_id] {
        crate::agent_tool::permission(g, tool, subject, "discover").await?;
        crate::agent_tool::permission(g, tool, subject, "consume").await?;
        crate::agent_tool::permission(g, row.id, subject, "read").await?;
    }
    crate::agent_tool::permission(g, row.id, initiator, "delegate").await?;
    Ok(())
}

pub(super) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    sem: Semantic,
    params: &Params,
) -> Result<(), Refusal> {
    let row = installation(tx, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or(Refusal::Conflict(ReasonCode::TargetStateConflict))?;
    let id = params
        .delegation_id
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    if sem == Semantic::AgentDelegationRevoke {
        let changed = sqlx::query(
            "update admission.delegation_grant set state='REVOKED',version=version+1
            where id=$1 and tenant_id=$2 and workspace_id=$3 and installation_resource_id=$4
              and version=$5 and state in ('ACTIVE','REVOKING')",
        )
        .bind(id)
        .bind(ae.tenant_id)
        .bind(row.workspace_id)
        .bind(row.id)
        .bind(params.delegation_version)
        .execute(&mut **tx)
        .await?;
        if changed.rows_affected() != 1 {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        flag_invocations(tx, ae.tenant_id, id).await?;
        return Ok(());
    }
    let grant = params
        .delegation_grant
        .as_ref()
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let from = DateTime::parse_from_rfc3339(&grant.valid_from)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
        .with_timezone(&Utc);
    let until = DateTime::parse_from_rfc3339(&grant.expires_at)
        .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))?
        .with_timezone(&Utc);
    sqlx::query(
        "insert into admission.delegation_grant
        (id,tenant_id,workspace_id,grantor_principal_id,installation_resource_id,agent_principal_id,
         valid_from,expires_at,max_uses,state,version,action_execution_id)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVE',1,$10)",
    )
    .bind(id)
    .bind(ae.tenant_id)
    .bind(row.workspace_id)
    .bind(ae.initiator_principal_id)
    .bind(row.id)
    .bind(row.agent_principal_id)
    .bind(from)
    .bind(until)
    .bind(grant.max_uses)
    .bind(ae.id)
    .execute(&mut **tx)
    .await?;
    for scope in &grant.scopes {
        let policy = Uuid::new_v4();
        let mode = serde_json::to_value(&scope.result_exposure_mode)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
        sqlx::query(
            "insert into catalog.result_exposure_policy
            (id,tenant_id,mode,output_schema_hash,redaction_policy,version,status)
            values ($1,$2,$3,$4,$5,1,'ACTIVE')",
        )
        .bind(policy)
        .bind(ae.tenant_id)
        .bind(mode)
        .bind(&scope.output_schema_hash)
        .bind(&scope.redaction_policy)
        .execute(&mut **tx)
        .await?;
        let uuid = |value: &Option<String>| -> Result<Option<Uuid>, Refusal> {
            value
                .as_deref()
                .map(Uuid::parse_str)
                .transpose()
                .map_err(|_| Refusal::Precondition(ReasonCode::InvalidParameters))
        };
        sqlx::query("insert into admission.delegation_scope
            (delegation_id,action_key,action_version,target_type,target_id,create_workspace_id,tool_resource_id,
             result_exposure_policy_id,result_exposure_policy_version)
            values ($1,$2,$3,$4,$5,$6,$7,$8,1)")
            .bind(id).bind(&scope.action_key).bind(i32::try_from(scope.action_version)
                .map_err(|_|Refusal::Precondition(ReasonCode::InvalidParameters))?).bind(&scope.target_type)
            .bind(uuid(&scope.target_id)?).bind(uuid(&scope.create_workspace_id)?).bind(uuid(&scope.tool_resource_id)?)
            .bind(policy).execute(&mut **tx).await?;
    }
    Ok(())
}

/// The same closed Grant-state rule is consumed by reconciliation and each
/// Advance. A failed/unknown read is not evidence that authorization was revoked.
pub(crate) fn cancellation_required(
    state: &str,
    expires_at: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<bool, Refusal> {
    match state {
        "ACTIVE" => Ok(expires_at <= now),
        "REVOKING" | "REVOKED" | "EXPIRED" => Ok(true),
        _ => Err(Refusal::Unavailable("Delegation 状态不可核验".into())),
    }
}

// Called under the existing Tenant fence. No business/native terminal is
// inferred here; the immutable Grant ID and scope exclude other delegations.
pub(crate) async fn flag_invocations(
    conn: &mut PgConnection,
    tenant: Uuid,
    grant: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "update catalog.agent_invocation i set cancel_pending=true,updated_at=now()
        from admission.delegation_grant g
        where g.id=$1 and g.tenant_id=$2 and i.delegation_id=g.id
          and i.tenant_id=g.tenant_id and i.workspace_id=g.workspace_id
          and i.installation_resource_id=g.installation_resource_id
          and i.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN') and not i.cancel_pending
          and (g.state in ('REVOKING','REVOKED','EXPIRED')
               or (g.state='ACTIVE' and g.expires_at<=clock_timestamp()))",
    )
    .bind(grant)
    .bind(tenant)
    .execute(conn)
    .await?;
    Ok(())
}

#[derive(sqlx::FromRow)]
struct Cancellation {
    id: Uuid,
    action_execution_id: Uuid,
    workflow_id: String,
    first_run_id: Option<String>,
    installation_resource_id: Uuid,
    projection_generation: i64,
    config_hash: Option<String>,
    runtime_thread_id: Option<String>,
    runtime_turn_id: Option<String>,
    native_status: Option<String>,
}

impl Governance {
    /// 复用现有治理循环的 batch/节拍；expiry 是授权事实，不是新的工作流。
    pub(crate) async fn reconcile_delegations(
        &self,
        runtime: Option<&crate::agent_runtime::Supervisor>,
        batch: i64,
    ) -> Result<(), Refusal> {
        let rows:Vec<(Uuid,Uuid,Uuid)>=sqlx::query_as("select g.id,g.action_execution_id,g.tenant_id
            from admission.delegation_grant g where g.state='REVOKING'
              or (g.state='ACTIVE' and g.expires_at<=clock_timestamp())
              or (g.state in ('REVOKED','EXPIRED') and exists(select 1 from catalog.agent_invocation i
                  where i.delegation_id=g.id and i.tenant_id=g.tenant_id and i.workspace_id=g.workspace_id
                    and i.installation_resource_id=g.installation_resource_id
                    and i.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN')))
            order by expires_at,id limit $1")
            .bind(batch).fetch_all(&self.pool).await?;
        for (id, execution, tenant) in rows {
            // 与管理路径相同 AE→Tenant→Grant，不能 Grant→Principal 的反向锁序。
            let mut tx = self.pool.begin().await?;
            let ae = super::lock_execution(&mut tx, execution).await?;
            let _: Uuid =
                sqlx::query_scalar("select id from identity.tenant where id=$1 for update")
                    .bind(tenant)
                    .fetch_one(&mut *tx)
                    .await?;
            let grant: Option<(String, DateTime<Utc>, DateTime<Utc>)> = sqlx::query_as(
                "select state,expires_at,clock_timestamp() from admission.delegation_grant
                where id=$1 and tenant_id=$2 for update skip locked",
            )
            .bind(id)
            .bind(tenant)
            .fetch_optional(&mut *tx)
            .await?;
            let Some((state, expires, now)) = grant else {
                tx.rollback().await?;
                continue;
            };
            if !cancellation_required(&state, expires, now)? {
                tx.rollback().await?;
                continue;
            }
            let terminal = if state == "REVOKING" {
                "REVOKED"
            } else {
                "EXPIRED"
            };
            if matches!(state.as_str(), "ACTIVE" | "REVOKING") {
                sqlx::query(
                    "update admission.delegation_grant set state=$2,version=version+1 where id=$1",
                )
                .bind(id)
                .bind(terminal)
                .execute(&mut *tx)
                .await?;
            }
            flag_invocations(&mut tx, tenant, id).await?;
            let def =
                super::exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
            if matches!(state.as_str(), "ACTIVE" | "REVOKING") {
                super::audit(
                    &mut tx,
                    &ae,
                    &def,
                    &format!("delegation:{id}:{terminal}"),
                    "OUTCOME",
                    "NONE",
                    &format!("DELEGATION_{terminal}"),
                    None,
                    Vec::new(),
                )
                .await?;
            }
            let pending: Vec<Cancellation> = sqlx::query_as("select i.id,i.action_execution_id,i.workflow_id,
                w.run_id as first_run_id,i.installation_resource_id,i.projection_generation,p.config_hash,
                s.runtime_thread_id,i.runtime_turn_id,i.native_status
                from catalog.agent_invocation i
                join admission.delegation_grant g on g.id=i.delegation_id
                join admission.action_execution a on a.id=i.action_execution_id
                  and a.tenant_id=i.tenant_id and a.workspace_id=i.workspace_id
                  and a.temporal_workflow_id=i.workflow_id and a.actor_principal_id=g.agent_principal_id
                  and a.initiator_principal_id=g.grantor_principal_id
                left join projection.workflow_ref w on w.workflow_id=i.workflow_id
                  and w.tenant_id=i.tenant_id and w.action_execution_id=a.id and w.operation_id=a.operation_id
                  and w.workflow_type=$3 and w.kind is null
                left join catalog.agent_runtime_projection p on p.installation_resource_id=i.installation_resource_id
                  and p.generation=i.projection_generation and p.agent_version_asset_id=i.agent_version_asset_id
                left join catalog.agent_session s on s.tenant_id=i.tenant_id and s.workspace_id=i.workspace_id
                  and s.root_event_id=i.root_event_id and s.installation_resource_id=i.installation_resource_id
                  and s.agent_version_asset_id=i.agent_version_asset_id and s.projection_generation=i.projection_generation
                where g.id=$1 and g.tenant_id=$2 and i.tenant_id=g.tenant_id and i.workspace_id=g.workspace_id
                  and i.installation_resource_id=g.installation_resource_id and i.cancel_pending
                  and i.status in ('CREATED','DISPATCHING','RUNNING','UNKNOWN') order by i.id")
                .bind(id).bind(tenant).bind(crate::agent_task::WORKFLOW_TYPE).fetch_all(&mut *tx).await?;
            for invocation in &pending {
                super::audit(
                    &mut tx,
                    &ae,
                    &def,
                    &format!("delegation:{id}:cancel:{}:intent", invocation.id),
                    "DISPATCH",
                    "ALLOW",
                    "DELEGATION_CANCEL_PENDING",
                    None,
                    vec![crate::audit::Evidence::new(
                        contracts::EvidenceKind::OriginalActionExecutionId,
                        invocation.action_execution_id,
                    )],
                )
                .await?;
            }
            tx.commit().await?;
            for invocation in pending {
                // Cancellation is retried only at the same control AE/execution
                // chain. Acceptance is not an Invocation or Workflow terminal.
                let native = match (&invocation.runtime_thread_id, &invocation.runtime_turn_id) {
                    (Some(thread), Some(turn))
                        if invocation.native_status.as_deref().is_none_or(|s| {
                            !matches!(s, "completed" | "failed" | "interrupted")
                        }) =>
                    {
                        match (runtime, invocation.config_hash.as_ref()) {
                            (Some(runtime), Some(hash)) => runtime
                                .interrupt(
                                    &crate::agent_runtime::RuntimeRef {
                                        installation_id: invocation.installation_resource_id,
                                        generation: invocation.projection_generation,
                                        config_hash: hash.clone(),
                                    },
                                    thread,
                                    turn,
                                )
                                .await
                                .is_ok(),
                            _ => false,
                        }
                    }
                    // No turn ID is not absence proof; Advance observes the
                    // same client ID. Known terminal turns still settle usage.
                    _ => false,
                };
                let recorded = self.cancel_delegated_workflow(&invocation, ae.id).await;
                tracing::debug!(invocation_id=%invocation.id, cancel_recorded=recorded,
                    interrupt_accepted=native, "Delegation 定向取消仍由原 Task/native/usage 对账确认终态");
                let mut tx = self.pool.begin().await?;
                let control = super::lock_execution(&mut tx, ae.id).await?;
                let mut evidence = vec![crate::audit::Evidence::new(
                    contracts::EvidenceKind::OriginalActionExecutionId,
                    invocation.action_execution_id,
                )];
                if recorded {
                    evidence.push(crate::audit::Evidence::new(
                        contracts::EvidenceKind::TemporalWorkflowId,
                        &invocation.workflow_id,
                    ));
                    if let Some(first) = &invocation.first_run_id {
                        evidence.push(crate::audit::Evidence::new(
                            contracts::EvidenceKind::TemporalFirstRunId,
                            first,
                        ));
                    }
                }
                super::audit(
                    &mut tx,
                    &control,
                    &def,
                    &format!(
                        "delegation:{id}:cancel:{}:observed:{recorded}:{native}",
                        invocation.id
                    ),
                    "RECONCILIATION",
                    "NONE",
                    if recorded {
                        "CANCEL_REQUEST_RECORDED"
                    } else {
                        "UNKNOWN_EXTERNAL_RESULT"
                    },
                    None,
                    evidence,
                )
                .await?;
                tx.commit().await?;
            }
        }
        Ok(())
    }

    async fn cancel_delegated_workflow(&self, invocation: &Cancellation, control: Uuid) -> bool {
        let Some(first) = invocation
            .first_run_id
            .as_deref()
            .filter(|run| !run.is_empty())
        else {
            return false;
        };
        let Ok(Some(observed)) = self.temporal.describe(&invocation.workflow_id).await else {
            return false;
        };
        if observed.first_run_id.is_empty()
            || (first != observed.first_run_id && first != observed.run_id)
            || !matches!(observed.state, crate::temporal::ObservedState::Open)
        {
            return false;
        }
        match self
            .temporal
            .cancel_request_recorded(&invocation.workflow_id, first, control)
            .await
        {
            Ok(true) => true,
            Ok(false) => {
                let _ = self
                    .temporal
                    .request_cancel(&invocation.workflow_id, first, control)
                    .await;
                matches!(
                    self.temporal
                        .cancel_request_recorded(&invocation.workflow_id, first, control)
                        .await,
                    Ok(true)
                )
            }
            Err(_) => false,
        }
    }
}
