//! DD-24/25/45/99：Core 自有的 Agent 稳定身份，不是 Buzz Desktop 本地 Agent registry。
//! 写者只有既有 Governance；SpiceDB 投影意图仍是同一 ActionExecution。

use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState},
    governance::{Definition, Execution, Params, Refusal, Semantic},
    spicedb::Consistency,
};
use contracts::ReasonCode;

#[derive(sqlx::FromRow)]
pub(crate) struct Resource {
    pub id: Uuid,
    pub tenant_id: Uuid,
    pub owner_principal_id: Uuid,
    pub home_workspace_id: Option<Uuid>,
    pub state: String,
    pub version: i32,
    pub projection_action_execution_id: Option<Uuid>,
}

pub(crate) async fn resource(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<Resource>, sqlx::Error> {
    sqlx::query_as(&format!(
        "select r.id,r.tenant_id,r.owner_principal_id,r.home_workspace_id,r.state,r.version,r.projection_action_execution_id
         from catalog.resource r join catalog.agent_definition a on a.resource_id=r.id
         where r.id=$1 and r.tenant_id=$2{}", if lock { " for update of r" } else { "" }))
        .bind(id).bind(tenant).fetch_optional(conn).await
}

pub(crate) async fn active_owner(
    conn: &mut PgConnection,
    tenant: Uuid,
    principal: Uuid,
) -> Result<bool, sqlx::Error> {
    let row: Option<i32> = sqlx::query_scalar(
        "select 1 from identity.principal p join identity.tenant_membership tm on tm.tenant_principal_id=p.id
         where p.id=$1 and p.tenant_id=$2 and p.kind='HUMAN' and p.status='ACTIVE'
           and tm.tenant_id=$2 and tm.state='ACTIVE' for update of p,tm")
        .bind(principal).bind(tenant).fetch_optional(conn).await?;
    Ok(row.is_some())
}

pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    sem: Semantic,
    p: &Params,
) -> Result<(), Refusal> {
    match sem {
        Semantic::AgentDefinitionCreate => {
            if !active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
                return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
            }
            let type_key = def
                .action_key
                .strip_suffix(".create")
                .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
            let registered: Option<String> = sqlx::query_scalar(
                "select type_key from catalog.resource_type_definition where type_key=$1 and status='ACTIVE'
                 and capability_category is null and tenant_delete_action_key='tenant.delete'
                 and jsonb_path_exists(incremental_contracts,
                     '$[*] ? (@.role == \"NATIVE_INTERNAL\" && @.engine == \"NATIVE\")')")
                .bind(type_key).fetch_optional(&mut **tx).await?;
            let type_key = registered.ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
            sqlx::query("insert into catalog.resource
                (id,tenant_id,type_key,owner_principal_id,component_type_key,native_type,native_id,state,version,projection_action_execution_id)
                values ($1,$2,$3,$4,$5,$3,$1::text,'PROVISIONING',1,$6)")
                .bind(ae.target_id).bind(ae.tenant_id).bind(&type_key).bind(ae.initiator_principal_id)
                .bind(&def.component_type_key).bind(ae.id).execute(&mut **tx).await?;
            sqlx::query(
                "insert into catalog.agent_definition(resource_id,stable_slug,display_name,status)
                values ($1,$2,$3,'PROVISIONING')",
            )
            .bind(ae.target_id)
            .bind(&p.slug)
            .bind(&p.name)
            .execute(&mut **tx)
            .await?;
        }
        Semantic::AgentDefinitionUpdate => {
            let changed = sqlx::query(
                "update catalog.agent_definition set display_name=$2 where resource_id=$1",
            )
            .bind(ae.target_id)
            .bind(&p.name)
            .execute(&mut **tx)
            .await?;
            if changed.rows_affected() != 1 {
                return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
            }
            sqlx::query(
                "update catalog.resource set version=version+1 where id=$1 and tenant_id=$2",
            )
            .bind(ae.target_id)
            .bind(ae.tenant_id)
            .execute(&mut **tx)
            .await?;
        }
        Semantic::ResourceTransferOwner => {
            let next = p
                .principal_id
                .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
            if !active_owner(tx, ae.tenant_id, next).await? {
                return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
            }
            // 先冻结旧事实，不先宣称新 owner 已生效。pending 期间双方 owner-only 动作均拒绝。
            sqlx::query("update catalog.resource set projection_action_execution_id=$3 where id=$1 and tenant_id=$2")
                .bind(ae.target_id).bind(ae.tenant_id).bind(ae.id).execute(&mut **tx).await?;
        }
        _ => return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked)),
    }
    Ok(())
}

pub(crate) async fn projection_matches(
    gov: &crate::governance::Governance,
    id: Uuid,
    tenant: Uuid,
    owner: Uuid,
) -> Result<bool, Refusal> {
    gov.spicedb
        .resource_projection_matches(
            &id.to_string(),
            &tenant.to_string(),
            &owner.to_string(),
            gov.cfg.relationship_page,
        )
        .await
        .map_err(|e| Refusal::Unavailable(e.to_string()))
}

pub(crate) async fn dispatch(
    gov: &crate::governance::Governance,
    ae_id: Uuid,
    def: &Definition,
    sem: Semantic,
) -> Result<(), Refusal> {
    let mut tx = gov.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, ae_id).await?;
    if ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
    {
        return Ok(());
    }
    let tenant_active = sqlx::query_scalar::<_, bool>(
        "select state = 'ACTIVE' from identity.tenant where id = $1 for update",
    )
    .bind(ae.tenant_id)
    .fetch_optional(&mut *tx)
    .await?
    .unwrap_or(false);
    let p = ae
        .parameters
        .as_ref()
        .and_then(|v| v.get("params"))
        .and_then(Params::from_json)
        .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?;
    let r = resource(&mut tx, ae.tenant_id, ae.target_id, true)
        .await?
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    if r.projection_action_execution_id != Some(ae.id) {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    let owner = if sem == Semantic::ResourceTransferOwner {
        p.principal_id
            .ok_or(Refusal::Precondition(ReasonCode::InvalidParameters))?
    } else {
        r.owner_principal_id
    };
    if !tenant_active || !active_owner(&mut tx, ae.tenant_id, owner).await? {
        return abort_projection(gov, tx, &ae, def, sem, &r, owner).await;
    }
    let matched = match projection_matches(gov, r.id, r.tenant_id, owner).await {
        Ok(matched) => matched,
        Err(_) => return unknown(tx, &ae, def).await,
    };
    if !matched {
        if let Some(workflow) = &ae.approval_workflow_id {
            let fresh:Option<bool>=sqlx::query_scalar("select status='APPROVED' and consume_deadline>
                now()+make_interval(secs=>$2::bigint) from projection.approval_projection where workflow_id=$1")
                .bind(workflow).bind(gov.cfg.dispatch_margin_seconds).fetch_optional(&mut *tx).await?;
            if fresh != Some(true) {
                return abort_projection(gov, tx, &ae, def, sem, &r, owner).await;
            }
        }
        let source = active_owner(&mut tx, ae.tenant_id, ae.initiator_principal_id).await?;
        let permission = match gov
            .spicedb
            .check(
                &def.permission_object_type,
                &if sem == Semantic::AgentDefinitionCreate {
                    ae.tenant_id
                } else {
                    r.id
                }
                .to_string(),
                &def.permission,
                &ae.initiator_principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
        {
            Ok(permission) => permission,
            Err(_) => return unknown(tx, &ae, def).await,
        };
        if !source || !permission.allowed {
            return abort_projection(gov, tx, &ae, def, sem, &r, owner).await;
        }
        match gov
            .spicedb
            .replace_resource_projection(
                &r.id.to_string(),
                &r.tenant_id.to_string(),
                &r.owner_principal_id.to_string(),
                &owner.to_string(),
                None,
            )
            .await
        {
            Ok(t) if !t.is_empty() => {}
            Ok(_) => return unknown(tx, &ae, def).await,
            Err(e) => {
                tracing::warn!(action=%ae.id,error=%e,"Resource 投影回应不明，只以同一冻结意图查证");
                return unknown(tx, &ae, def).await;
            }
        }
        if !matches!(
            projection_matches(gov, r.id, r.tenant_id, owner).await,
            Ok(true)
        ) {
            return unknown(tx, &ae, def).await;
        }
    }
    // 已发生副作用的对账也留下真实原生 revision；不能因本次没有重写而空证据成功。
    let proof = match gov
        .spicedb
        .check(
            "resource",
            &r.id.to_string(),
            "read",
            &owner.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(proof) => proof,
        Err(_) => return unknown(tx, &ae, def).await,
    };
    if !proof.allowed || proof.zed_token.is_empty() {
        return unknown(tx, &ae, def).await;
    }
    let changed=sqlx::query("update catalog.resource set owner_principal_id=$3,state='ACTIVE',version=version+1,
            projection_action_execution_id=null where id=$1 and tenant_id=$2 and projection_action_execution_id=$4")
        .bind(r.id).bind(r.tenant_id).bind(owner).bind(ae.id).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    sqlx::query("update catalog.agent_definition set status='ACTIVE' where resource_id=$1")
        .bind(r.id)
        .execute(&mut *tx)
        .await?;
    let evidence = vec![crate::audit::Evidence::new(
        contracts::EvidenceKind::SpicedbZedtoken,
        proof.zed_token,
    )];
    let recorded =
        crate::governance::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), evidence)
            .await?;
    tx.commit().await?;
    if recorded.settled && ae.approval_workflow_id.is_some() {
        gov.consume(ae.id).await;
    }
    Ok(())
}

async fn unknown(
    mut tx: Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
) -> Result<(), Refusal> {
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Err(StatusCode::SERVICE_UNAVAILABLE),
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// 确定拒绝也不能把回应未知的外部写当作「从未执行」。先在原生权威恢复冻结的
/// 旧 owner（新建则删除该唯一 Resource 的投影），查证后才终结同一 AE。
async fn abort_projection(
    gov: &crate::governance::Governance,
    mut tx: Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    sem: Semantic,
    r: &Resource,
    attempted_owner: Uuid,
) -> Result<(), Refusal> {
    let token = if sem == Semantic::AgentDefinitionCreate {
        gov.spicedb.delete_resource_projection(r.id).await
    } else {
        gov.spicedb
            .replace_resource_projection(
                &r.id.to_string(),
                &r.tenant_id.to_string(),
                &attempted_owner.to_string(),
                &r.owner_principal_id.to_string(),
                None,
            )
            .await
    };
    let resolved = match token {
        Ok(token) if !token.is_empty() && sem == Semantic::AgentDefinitionCreate => Some(token),
        Ok(token) if !token.is_empty() => {
            match projection_matches(gov, r.id, r.tenant_id, r.owner_principal_id).await {
                Ok(true) => Some(token),
                _ => None,
            }
        }
        _ => None,
    };
    if let Some(token) = resolved {
        sqlx::query(
            "update catalog.resource set state=case when $3 then 'DELETED' else state end,
            projection_action_execution_id=null,version=version+1 where id=$1 and tenant_id=$2",
        )
        .bind(r.id)
        .bind(r.tenant_id)
        .bind(sem == Semantic::AgentDefinitionCreate)
        .execute(&mut *tx)
        .await?;
        if sem == Semantic::AgentDefinitionCreate {
            sqlx::query(
                "update catalog.agent_definition set status='DELETED' where resource_id=$1",
            )
            .bind(r.id)
            .execute(&mut *tx)
            .await?;
        }
        crate::governance::record_dispatch(
            &mut tx,
            ae.id,
            def.audit_class(),
            Err(StatusCode::FORBIDDEN),
            vec![crate::audit::Evidence::new(
                contracts::EvidenceKind::SpicedbZedtoken,
                token,
            )],
        )
        .await?;
        tx.commit().await?;
        if ae.approval_workflow_id.is_some() {
            gov.invalidate(ae.id).await;
        }
    } else {
        crate::governance::record_dispatch(
            &mut tx,
            ae.id,
            def.audit_class(),
            Err(StatusCode::SERVICE_UNAVAILABLE),
            Vec::new(),
        )
        .await?;
        tx.commit().await?;
    }
    Ok(())
}

pub(crate) async fn frozen_owners(
    conn: &mut PgConnection,
    tenant: Uuid,
) -> Result<serde_json::Value, Refusal> {
    let resources: Vec<(Uuid, Uuid, i32, Option<Uuid>)> = sqlx::query_as(
        "select id,owner_principal_id,version,projection_action_execution_id from catalog.resource
        where tenant_id=$1 and state<>'DELETED' order by id for update",
    )
    .bind(tenant)
    .fetch_all(&mut *conn)
    .await?;
    // 与 Version 写者保持 Resource→Asset 锁序；同 Tenant 的写者由既有 Tenant
    // 事务边界串行，冻结后不能在两类清单之间再长出一个未冻结对象。
    let assets: Vec<(Uuid, Uuid, i32, Option<Uuid>)> = sqlx::query_as(
        "select id,owner_principal_id,version,projection_action_execution_id from catalog.asset
        where tenant_id=$1 and state<>'DELETED' order by resource_id,id for update",
    )
    .bind(tenant)
    .fetch_all(conn)
    .await?;
    if resources.iter().chain(&assets).any(|r| r.3.is_some()) {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(serde_json::Value::Array(
        [("RESOURCE", resources), ("ASSET", assets)]
            .into_iter()
            .flat_map(|(kind, rows)| {
                rows.into_iter().map(move |(id, owner, version, _)| {
                    serde_json::json!({"targetType":kind,"targetId":id,
                    "targetVersion":version,"ownerPrincipalId":owner})
                })
            })
            .collect(),
    ))
}

/// 生命周期读者按真实平台类型查权威；普通Definition CRUD仍只用resource()。
async fn lifecycle_resource(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
) -> Result<Option<Resource>, sqlx::Error> {
    sqlx::query_as("select r.id,r.tenant_id,r.owner_principal_id,r.home_workspace_id,r.state,r.version,
        r.projection_action_execution_id from catalog.resource r
        join catalog.resource_type_definition kind on kind.type_key=r.type_key
        where r.tenant_id=$1 and r.id=$2 and kind.status='ACTIVE' and kind.tenant_delete_action_key='tenant.delete'
          and ((r.type_key='agent.definition' and r.home_workspace_id is null
                and exists(select 1 from catalog.agent_definition d where d.resource_id=r.id))
            or (r.type_key='agent.installation' and exists(select 1 from catalog.agent_installation i
                where i.resource_id=r.id and i.workspace_id=r.home_workspace_id))
            or (r.type_key='llm_route' and exists(select 1 from catalog.model_route m where m.resource_id=r.id))
            or (r.type_key='automation' and exists(select 1 from catalog.automation_definition d
                where d.resource_id=r.id and d.workspace_id=r.home_workspace_id))) for update of r")
        .bind(tenant).bind(id).fetch_optional(conn).await
}

#[derive(sqlx::FromRow)]
struct LifecycleAsset {
    id: Uuid,
    resource_id: Uuid,
    owner_principal_id: Uuid,
    version: i32,
    state: String,
    native_state: String,
    projection_action_execution_id: Option<Uuid>,
}

async fn lifecycle_asset(
    conn: &mut PgConnection,
    tenant: Uuid,
    id: Uuid,
    lock: bool,
) -> Result<Option<LifecycleAsset>, sqlx::Error> {
    sqlx::query_as(&format!("select a.id,a.resource_id,a.owner_principal_id,a.version,a.state,
        case when a.type_key='agent.version' then av.state else automation.state end native_state,
        a.projection_action_execution_id from catalog.asset a
        left join catalog.agent_version av on av.asset_id=a.id and av.agent_resource_id=a.resource_id
        left join catalog.automation_version automation on automation.asset_id=a.id and automation.automation_resource_id=a.resource_id
        where a.tenant_id=$1 and a.id=$2 and ((a.type_key='agent.version' and av.asset_id is not null)
          or (a.type_key='automation.version' and automation.asset_id is not null)){}",
        if lock{" for update of a"}else{""}))
        .bind(tenant).bind(id).fetch_optional(conn).await
}

/// FAILED 不是 UNKNOWN。只有同 create AE 的确定中止、两原生删除证据和
/// 当前 Resource/Asset 完整空集合一起成立，才不要求已删除的 owner relationship。
async fn failed_lifecycle_projection(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    r: &Resource,
) -> Result<bool, Refusal> {
    let asset:Option<Uuid>=sqlx::query_scalar("select a.id from catalog.resource resource
        join catalog.automation_definition d on d.resource_id=resource.id
        join admission.action_execution ae on ae.target_id=resource.id and ae.tenant_id=resource.tenant_id
        join catalog.asset a on a.id=ae.id and a.resource_id=resource.id and a.tenant_id=resource.tenant_id
        join catalog.automation_version v on v.asset_id=a.id and v.automation_resource_id=resource.id
        join audit.audit_event evidence on evidence.action_execution_id=ae.id
          and evidence.operation_id=ae.operation_id and evidence.tenant_id=ae.tenant_id
          and evidence.target_id=resource.id and evidence.action_key=ae.action_key
          and evidence.action_version=ae.action_version
        where resource.id=$1 and resource.tenant_id=$2 and resource.type_key='automation'
          and resource.state='FAILED' and resource.projection_action_execution_id is null
          and d.state='DISABLED' and d.pinned_version_asset_id is null
          and ae.action_key='automation.create' and ae.gate_state='ALLOWED' and ae.dispatch_state='ABORTED'
          and ae.initiator_principal_id=resource.owner_principal_id
          and a.owner_principal_id=resource.owner_principal_id and a.type_key='automation.version'
          and a.state='DELETED' and a.projection_action_execution_id is null and v.state='RETIRED'
          and evidence.event_type='DISPATCH' and evidence.result_code='DISPATCH_ABORTED'
          and jsonb_array_length(evidence.evidence_refs)=2
          and not exists(select 1 from jsonb_array_elements(evidence.evidence_refs) ref
              where ref->>'kind' is distinct from 'SPICEDB_ZEDTOKEN'
                or jsonb_typeof(ref->'value') is distinct from 'string'
                or length(ref->>'value')=0)
          and not exists(select 1 from catalog.asset other
              where other.resource_id=resource.id and other.state<>'DELETED')")
        .bind(r.id).bind(r.tenant_id).fetch_optional(&mut *conn).await?;
    let Some(asset) = asset else {
        return Ok(false);
    };
    for (kind, id) in [("resource", r.id), ("asset", asset)] {
        let id = id.to_string();
        let rows = gov
            .spicedb
            .read_native(
                &crate::spicedb::RelationshipFilter {
                    object_type: kind,
                    object_id: Some(&id),
                    relation: None,
                    subject_principal: None,
                },
                gov.cfg.relationship_page,
            )
            .await
            .map_err(|e| Refusal::Unavailable(e.to_string()))?;
        if !rows.is_empty() {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(crate) async fn validate_frozen_owners(
    gov: &crate::governance::Governance,
    conn: &mut PgConnection,
    tenant: Uuid,
    refs: &[contracts::AffectedOwnerRef],
) -> Result<bool, Refusal> {
    let mut seen = std::collections::HashSet::new();
    for owner in refs {
        if !matches!(owner.target_type.as_str(), "RESOURCE" | "ASSET")
            || owner.target_version <= 0
            || !seen.insert((&owner.target_type, &owner.target_id))
        {
            return Ok(false);
        }
        let id = Uuid::parse_str(&owner.target_id)
            .map_err(|_| Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        let principal = Uuid::parse_str(&owner.owner_principal_id)
            .map_err(|_| Refusal::Conflict(ReasonCode::TargetStateConflict))?;
        let r = match owner.target_type.as_str() {
            "RESOURCE" => {
                let Some(r) = lifecycle_resource(conn, tenant, id).await? else {
                    return Ok(false);
                };
                if i64::from(r.version) != owner.target_version || r.owner_principal_id != principal
                {
                    return Ok(false);
                }
                r
            }
            "ASSET" => {
                // 先定位、锁父 Resource，再锁 Asset，与发布/更新的锁序相同。
                let Some(located) = lifecycle_asset(conn, tenant, id, false).await? else {
                    return Ok(false);
                };
                let Some(parent) = lifecycle_resource(conn, tenant, located.resource_id).await?
                else {
                    return Ok(false);
                };
                let Some(v) = lifecycle_asset(conn, tenant, id, true).await? else {
                    return Ok(false);
                };
                if v.resource_id != parent.id
                    || i64::from(v.version) != owner.target_version
                    || v.owner_principal_id != principal
                    || !matches!(v.state.as_str(), "DRAFT" | "PUBLISHED" | "RETIRED")
                    || v.native_state != v.state
                    || v.projection_action_execution_id.is_some()
                    || !active_owner(conn, tenant, principal).await?
                    || !gov
                        .spicedb
                        .asset_projection_matches(
                            &v.id.to_string(),
                            &tenant.to_string(),
                            &parent.id.to_string(),
                            &v.owner_principal_id.to_string(),
                            gov.cfg.relationship_page,
                        )
                        .await
                        .map_err(|e| Refusal::Unavailable(e.to_string()))?
                {
                    return Ok(false);
                }
                parent
            }
            _ => return Ok(false),
        };
        if r.projection_action_execution_id.is_some()
            || !active_owner(conn, tenant, r.owner_principal_id).await?
        {
            return Ok(false);
        }
        let projection = match r.state.as_str() {
            "ACTIVE" => gov
                .spicedb
                .resource_projection_matches_in_workspace(
                    &r.id.to_string(),
                    &tenant.to_string(),
                    &r.owner_principal_id.to_string(),
                    r.home_workspace_id.map(|id| id.to_string()).as_deref(),
                    gov.cfg.relationship_page,
                )
                .await
                .map_err(|e| Refusal::Unavailable(e.to_string()))?,
            "FAILED" => failed_lifecycle_projection(gov, conn, &r).await?,
            _ => false,
        };
        if !projection {
            return Ok(false);
        }
    }
    Ok(true)
}

#[derive(Deserialize)]
pub struct PageQuery {
    pub offset: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct DefinitionRow {
    resource_id: Uuid,
    owner_principal_id: Uuid,
    stable_slug: String,
    display_name: String,
    status: String,
    version: i32,
    current_published_version_asset_id: Option<Uuid>,
}
impl DefinitionRow {
    fn view(self) -> contracts::AgentDefinitionView {
        contracts::AgentDefinitionView {
            resource_id: self.resource_id.to_string(),
            owner_principal_id: self.owner_principal_id.to_string(),
            stable_slug: self.stable_slug,
            display_name: self.display_name,
            status: self.status,
            resource_version: i64::from(self.version),
            current_published_version_asset_id: self
                .current_published_version_asset_id
                .map(|id| id.to_string()),
            resource_state: contracts::ResourceState::Active,
        }
    }
}

pub async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(q): Query<PageQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let offset = q.offset.unwrap_or(0);
    if offset < 0 {
        return StatusCode::BAD_REQUEST.into_response();
    }
    let limit = i64::from(state.governance.cfg.relationship_page);
    let rows: Result<Vec<DefinitionRow>, _> = sqlx::query_as(
        "select a.resource_id,r.owner_principal_id,a.stable_slug,a.display_name,a.status,r.version,
        a.current_published_version_asset_id
        from catalog.agent_definition a join catalog.resource r on r.id=a.resource_id
        where r.tenant_id=$1 and r.state='ACTIVE' and r.projection_action_execution_id is null
        order by r.id offset $2 limit $3",
    )
    .bind(ctx.tenant_id)
    .bind(offset)
    .bind(limit)
    .fetch_all(&state.pool)
    .await;
    let rows = match rows {
        Ok(r) => r,
        Err(e) => return crate::service_api::unavailable(e),
    };
    for r in &rows {
        match projection_matches(
            &state.governance,
            r.resource_id,
            ctx.tenant_id,
            r.owner_principal_id,
        )
        .await
        {
            Ok(true) => {}
            Ok(false) => {
                return Refusal::Unavailable("Resource 权限投影不一致".into()).respond(None)
            }
            Err(e) => return e.respond(None),
        }
    }
    let ids: Vec<String> = rows.iter().map(|r| r.resource_id.to_string()).collect();
    let allowed = match state
        .governance
        .spicedb
        .check_bulk(
            "resource",
            &ids,
            "discover",
            &ctx.tenant_principal_id.to_string(),
        )
        .await
    {
        Ok(a) => a,
        Err(e) => return Refusal::Unavailable(e.to_string()).respond(None),
    };
    let next =
        (rows.len() == usize::try_from(limit).unwrap_or(usize::MAX)).then_some(offset + limit);
    Json(contracts::AgentDefinitionPage {
        definitions: rows
            .into_iter()
            .filter(|r| allowed.contains(&r.resource_id.to_string()))
            .map(|r| {
                let v = r.view();
                contracts::DefinitionElement {
                    resource_id: v.resource_id,
                    owner_principal_id: v.owner_principal_id,
                    stable_slug: v.stable_slug,
                    display_name: v.display_name,
                    status: v.status,
                    resource_version: v.resource_version,
                    current_published_version_asset_id: v.current_published_version_asset_id,
                    resource_state: v.resource_state,
                }
            })
            .collect(),
        next_offset: next,
    })
    .into_response()
}

pub async fn get(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(c) => c,
        Err(e) => return e,
    };
    let row:Result<Option<DefinitionRow>,_>=sqlx::query_as("select a.resource_id,r.owner_principal_id,a.stable_slug,a.display_name,a.status,r.version,
        a.current_published_version_asset_id
        from catalog.agent_definition a join catalog.resource r on r.id=a.resource_id
        where r.id=$1 and r.tenant_id=$2 and r.state='ACTIVE' and r.projection_action_execution_id is null")
        .bind(id).bind(ctx.tenant_id).fetch_optional(&state.pool).await;
    let row = match row {
        Ok(Some(r)) => r,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(e) => return crate::service_api::unavailable(e),
    };
    match projection_matches(
        &state.governance,
        row.resource_id,
        ctx.tenant_id,
        row.owner_principal_id,
    )
    .await
    {
        Ok(true) => {}
        Ok(false) => return Refusal::Unavailable("Resource 权限投影不一致".into()).respond(None),
        Err(e) => return e.respond(None),
    }
    match state
        .governance
        .spicedb
        .check(
            "resource",
            &id.to_string(),
            "read",
            &ctx.tenant_principal_id.to_string(),
            Consistency::FullyConsistent,
        )
        .await
    {
        Ok(c) if c.allowed => Json(row.view()).into_response(),
        Ok(_) => StatusCode::FORBIDDEN.into_response(),
        Err(e) => Refusal::Unavailable(e.to_string()).respond(None),
    }
}
