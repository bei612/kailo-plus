//! DD-49、03 §6、17 §8：显式 HUMAN 授权只由同一 governed Action 写入。
//! Grant 是限制，不是 permission；没有已实现的 Agent 动作时确定拒绝。

use chrono::{DateTime, Utc};
use contracts::ReasonCode;
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{Definition, Execution, Governance, Params, Refusal, Semantic, Target};

#[derive(sqlx::FromRow)]
pub(super) struct Installation {
    pub(super) id: Uuid,
    tenant_id: Uuid,
    pub(super) workspace_id: Uuid,
    owner_principal_id: Uuid,
    agent_principal_id: Uuid,
    pub(super) version: i32,
}

pub(super) async fn installation(
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

pub(super) async fn projection_matches(
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
            || !scopes.insert((
                scope.action_key.clone(),
                scope.action_version,
                scope.target_type.clone(),
                target,
                create,
                scope.tool_resource_id.clone(),
            ))
        {
            return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
        }
        let action:Option<(String,String,String,String,String,String)>=sqlx::query_as(
            "select target_type,permission_object_type,permission,result_exposure,obs_redaction_policy,workspace_rule
             from catalog.action_definition where action_key=$1 and version=$2 and status='ACTIVE'")
            .bind(&scope.action_key).bind(i32::try_from(scope.action_version)
                .map_err(|_|Refusal::Precondition(ReasonCode::InvalidParameters))?)
            .fetch_optional(&mut *conn).await?;
        let Some((target_type, object_type, permission, exposure, redaction, workspace_rule)) =
            action
        else {
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        };
        if !has_agent_consumer(&scope.action_key) || scope.tool_resource_id.is_some() {
            // ToolDefinition/PEP 当前没有真实生产者，不查询不存在的表或编造输出合同。
            return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
        }
        if scope.target_type != target_type
            || scope.redaction_policy != redaction
            || exposure != "NONE"
            || serde_json::to_value(&scope.result_exposure_mode).ok()
                != Some(serde_json::Value::String("CONSUME_ONLY".into()))
            || scope.output_schema_hash
                != format!(
                    "{:x}",
                    Sha256::digest(
                        include_str!("../../../../contracts/api/action_submission.schema.json")
                            .as_bytes()
                    )
                )
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
    }
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

impl Governance {
    /// 复用现有治理循环的 batch/节拍；expiry 是授权事实，不是新的工作流。
    pub(crate) async fn reconcile_delegations(&self, batch: i64) -> Result<(), Refusal> {
        let rows:Vec<(Uuid,Uuid,Uuid)>=sqlx::query_as("select id,action_execution_id,tenant_id
            from admission.delegation_grant where state='REVOKING' or (state='ACTIVE' and expires_at<=now())
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
            let state:Option<String>=sqlx::query_scalar("select state from admission.delegation_grant
                where id=$1 and (state='REVOKING' or (state='ACTIVE' and expires_at<=now())) for update skip locked")
                .bind(id).fetch_optional(&mut *tx).await?;
            let Some(state) = state else {
                tx.rollback().await?;
                continue;
            };
            let terminal = if state == "REVOKING" {
                "REVOKED"
            } else {
                "EXPIRED"
            };
            sqlx::query(
                "update admission.delegation_grant set state=$2,version=version+1 where id=$1",
            )
            .bind(id)
            .bind(terminal)
            .execute(&mut *tx)
            .await?;
            let def =
                super::exact_definition(&self.pool, &ae.action_key, ae.action_version).await?;
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
            tx.commit().await?;
        }
        Ok(())
    }
}
