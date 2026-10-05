//! DD-107 / 06 §3.1：同 AE 的 Schedule 派发意图与原生启动后的第一次准入。
use super::*;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use contracts::AutomationScheduleAdmitRequest;

pub(crate) fn interval(spec: &Value) -> Result<(i64, i64, i64), Refusal> {
    let obj = spec.as_object().ok_or_else(invalid_management)?;
    if obj.len() != 3
        || obj.keys().any(|k| {
            !matches!(
                k.as_str(),
                "everySeconds" | "offsetSeconds" | "catchupWindowSeconds"
            )
        })
    {
        return Err(invalid_management());
    }
    let every = spec["everySeconds"]
        .as_i64()
        .ok_or_else(invalid_management)?;
    let offset = spec["offsetSeconds"]
        .as_i64()
        .ok_or_else(invalid_management)?;
    let catchup = spec["catchupWindowSeconds"]
        .as_i64()
        .ok_or_else(invalid_management)?;
    // Temporal d94e34a1… service/worker/scheduler/workflow.go:
    // defaultTweakables.MinCatchupWindow / scheduler.getCatchupWindow clamp to 10s.
    // 拒绝低于原生规范化下界的输入，不能把另一有效窗口冒称已按请求投递。
    if every <= 0 || offset < 0 || offset >= every || catchup < 10 {
        return Err(invalid_management());
    }
    Ok((every, offset, catchup))
}

#[derive(Serialize, Deserialize)]
struct Origin {
    tenant: Uuid,
    workspace: Uuid,
    resource: Uuid,
    owner: Uuid,
    human: Option<Uuid>,
    agent: Uuid,
    installation: Uuid,
    agent_version: Uuid,
    generation: i64,
    grant: Uuid,
    resource_version: i32,
    version: Uuid,
    version_number: i32,
}

/// 原 Tenant/Workspace 生命周期 Activity 消费；不启动新的 Workflow。
/// 同一生命周期 AE 冻结 native IDs 与单次 CAS 派发，重入只 Describe。
pub(crate) async fn converge_scope_schedules(
    state: &ServiceState,
    tenant: Uuid,
    workspace: Option<Uuid>,
    version: i32,
    paused: bool,
) -> Result<bool, sqlx::Error> {
    let kind = if workspace.is_some() {
        "WORKSPACE_LIFECYCLE"
    } else {
        "TENANT_LIFECYCLE"
    };
    let target = workspace.unwrap_or(tenant);
    let workflow = crate::component_task::workflow_id(kind, tenant, &target.to_string(), version);
    let id:Option<Uuid>=sqlx::query_scalar("select ae.id from projection.workflow_ref wr
        join admission.action_execution ae on ae.id=wr.action_execution_id
        where wr.workflow_id=$1 and wr.kind=$2 and wr.tenant_id=$3
          and ae.tenant_id=wr.tenant_id and ae.operation_id=wr.operation_id and ae.target_id=$4
          and ae.gate_state='ALLOWED' and wr.projection_state in ('PENDING_START','RUNNING','UNKNOWN')")
        .bind(&workflow).bind(kind).bind(tenant).bind(target).fetch_optional(&state.pool).await?;
    // 已有无 Schedule 生命周期无需新增 native 资格；有真实对象却无原 AE 拒绝。
    let count:i64=sqlx::query_scalar("select count(*) from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
        where r.tenant_id=$1 and ($2::uuid is null or d.workspace_id=$2) and d.schedule_id is not null")
        .bind(tenant).bind(workspace).fetch_one(&state.pool).await?;
    let Some(id) = id else {
        return Ok(count == 0);
    };
    let stage = if paused { "PAUSE" } else { "RESUME" };
    loop {
        let mut tx = state.pool.begin().await?;
        let ae = governance::lock_execution(&mut tx, id).await?;
        let tenant_state: String =
            sqlx::query_scalar("select state from identity.tenant where id=$1 for update")
                .bind(tenant)
                .fetch_one(&mut *tx)
                .await?;
        let scope_valid: bool = if let Some(workspace) = workspace {
            tenant_state=="ACTIVE" && sqlx::query_scalar("select version=$2 and state=$3 from identity.workspace where id=$1 and tenant_id=$4 for update")
                .bind(workspace).bind(version).bind(if paused{"SUSPENDING"}else{"RESTORING"}).bind(tenant)
                .fetch_optional(&mut *tx).await?.unwrap_or(false)
        } else {
            sqlx::query_scalar("select version=$2 and (state=$3 or ($4 and state='RESTORING')) from identity.tenant where id=$1")
                .bind(tenant).bind(version).bind(if paused{"SUSPENDING"}else{"RESTORING"}).bind(paused)
                .fetch_one(&mut *tx).await?
        };
        if !scope_valid || ae.gate_state != "ALLOWED" {
            return Ok(false);
        }
        let existing = ae
            .parameters
            .as_ref()
            .and_then(|p| p.get("scheduleLifecycle"))
            .and_then(|p| p.get(stage));
        let mut intent = if let Some(value) = existing {
            value.clone()
        } else {
            let ids:Vec<String>=sqlx::query_scalar("select d.schedule_id from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
                join identity.workspace w on w.id=d.workspace_id and w.tenant_id=r.tenant_id
                where r.tenant_id=$1 and ($2::uuid is null or d.workspace_id=$2) and d.schedule_id is not null
                  and ($3 or (d.state='ENABLED' and r.state='ACTIVE' and (r.projection_action_execution_id is null
                    or exists(select 1 from admission.action_execution enable where enable.id=r.projection_action_execution_id
                      and enable.tenant_id=r.tenant_id and enable.target_id=r.id and enable.action_key='automation.enable'
                      and enable.gate_state='ALLOWED' and enable.parameters#>>'{scheduleIntent,id}'=d.schedule_id))
                    and (($2::uuid is null and w.state='ACTIVE') or ($2::uuid is not null and w.state='RESTORING'))))
                order by d.resource_id for update of d")
                .bind(tenant).bind(workspace).bind(paused).fetch_all(&mut *tx).await?;
            json!({"ids":ids,"started":[]})
        };
        let ids: Vec<String> = serde_json::from_value(intent["ids"].clone())
            .map_err(|_| sqlx::Error::Protocol("Schedule lifecycle references 损坏".into()))?;
        let started: Vec<String> = serde_json::from_value(intent["started"].clone())
            .map_err(|_| sqlx::Error::Protocol("Schedule lifecycle dispatch 损坏".into()))?;
        let mut next = None;
        for native_id in ids {
            let observed = state
                .temporal
                .describe_schedule(&native_id)
                .await
                .map_err(|_| sqlx::Error::Protocol("Schedule lifecycle Describe 未知".into()))?;
            if !paused {
                // An UNKNOWN enable may already have created this exact native
                // object before the scope was paused. Restore its frozen object,
                // not a new Schedule, and let the original enable AE reconcile.
                let sources:Vec<(Value,Value)>=sqlx::query_as("select enable.parameters#>'{scheduleIntent,origin}',enable.parameters#>'{scheduleIntent,spec}'
                    from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
                    join admission.action_execution enable on enable.target_id=r.id and enable.tenant_id=r.tenant_id
                    where r.tenant_id=$1 and ($2::uuid is null or d.workspace_id=$2) and d.schedule_id=$3
                      and d.state='ENABLED' and r.state='ACTIVE' and enable.action_key='automation.enable' and enable.gate_state='ALLOWED'
                      and enable.parameters#>>'{scheduleIntent,id}'=d.schedule_id
                      and enable.parameters#>>'{scheduleIntent,origin,version}'=d.pinned_version_asset_id::text
                      and (r.projection_action_execution_id is null or r.projection_action_execution_id=enable.id)
                    order by enable.id limit 2")
                    .bind(tenant).bind(workspace).bind(&native_id).fetch_all(&mut *tx).await?;
                let [(source, spec)] = sources.as_slice() else {
                    return Ok(false);
                };
                let origin: Origin = serde_json::from_value(source.clone())
                    .map_err(|_| sqlx::Error::Protocol("Schedule lifecycle origin 损坏".into()))?;
                let expected = state
                    .temporal
                    .automation_schedule(
                        &base(&origin),
                        &input(&native_id, &origin),
                        (&origin.tenant.to_string(), &origin.workspace.to_string()),
                        interval(spec).map_err(|_| {
                            sqlx::Error::Protocol("Schedule lifecycle spec 损坏".into())
                        })?,
                        false,
                    )
                    .map_err(|_| sqlx::Error::Protocol("Schedule lifecycle input 损坏".into()))?;
                if !observed.as_ref().is_some_and(|actual| {
                    actual.spec == expected.spec
                        && actual.action == expected.action
                        && actual.policies == expected.policies
                        && actual.state.as_ref().is_some_and(|s| !s.limited_actions)
                }) {
                    return Ok(false);
                }
            }
            match observed {
                None if paused => continue,
                Some(schedule) if schedule.state.as_ref().is_some_and(|s| s.paused == paused) => {
                    continue
                }
                _ if started.contains(&native_id) => return Ok(false),
                _ => {
                    next = Some(native_id);
                    break;
                }
            }
        }
        let Some(native_id) = next else {
            tx.commit().await?;
            return Ok(true);
        };
        if !paused {
            // 恢复只投入仍 ENABLED、同 native ref 的版本；不复活管理 pause/disable。
            let current:bool=sqlx::query_scalar("select exists(select 1 from catalog.automation_definition d join catalog.resource r on r.id=d.resource_id
                where r.tenant_id=$1 and ($2::uuid is null or d.workspace_id=$2) and d.schedule_id=$3
                  and d.state='ENABLED' and r.state='ACTIVE' and (r.projection_action_execution_id is null
                    or exists(select 1 from admission.action_execution enable where enable.id=r.projection_action_execution_id
                      and enable.tenant_id=r.tenant_id and enable.target_id=r.id and enable.action_key='automation.enable'
                      and enable.gate_state='ALLOWED' and enable.parameters#>>'{scheduleIntent,id}'=d.schedule_id)))")
                .bind(tenant).bind(workspace).bind(&native_id).fetch_one(&mut *tx).await?;
            if !current {
                return Ok(false);
            }
        }
        intent["started"]
            .as_array_mut()
            .ok_or_else(|| sqlx::Error::Protocol("Schedule lifecycle intent 损坏".into()))?
            .push(Value::String(native_id.clone()));
        sqlx::query("update admission.action_execution set parameters=coalesce(parameters,'{}'::jsonb)||jsonb_build_object('scheduleLifecycle',
            coalesce(parameters->'scheduleLifecycle','{}'::jsonb)||jsonb_build_object($2::text,$3::jsonb)) where id=$1")
            .bind(id).bind(stage).bind(&intent).execute(&mut *tx).await?;
        tx.commit().await?;
        // 重取相同 scope fence 跨 RPC；持久 started 在崩溃/未知时不会被清除。
        let mut guard = state.pool.begin().await?;
        let current_tenant: String =
            sqlx::query_scalar("select state from identity.tenant where id=$1 for update")
                .bind(tenant)
                .fetch_one(&mut *guard)
                .await?;
        let valid: bool = if let Some(workspace) = workspace {
            sqlx::query_scalar("select version=$2 and state=$3 from identity.workspace where id=$1 and tenant_id=$4 for update")
                .bind(workspace).bind(version).bind(if paused{"SUSPENDING"}else{"RESTORING"}).bind(tenant)
                .fetch_optional(&mut *guard).await?.unwrap_or(false)
        } else {
            sqlx::query_scalar("select version=$2 and (state=$3 or ($4 and state='RESTORING')) from identity.tenant where id=$1")
                .bind(tenant).bind(version).bind(if paused{"SUSPENDING"}else{"RESTORING"}).bind(paused).fetch_one(&mut *guard).await?
        };
        if !valid || (workspace.is_some() && current_tenant != "ACTIVE") {
            return Ok(false);
        }
        let native_operation =
            Uuid::new_v5(&ae.operation_id, format!("{stage}:{native_id}").as_bytes());
        if state
            .temporal
            .set_schedule_paused(&native_id, native_operation, paused)
            .await
            .is_err()
        {
            return Ok(false);
        }
        guard.commit().await?;
    }
}

pub(super) async fn freeze(
    tx: &mut Transaction<'_, Postgres>,
    ae: &governance::Execution,
    old: &ManagementResource,
    id: Option<&str>,
    content: Option<&Value>,
    sem: governance::Semantic,
) -> Result<(), Refusal> {
    if id.is_none() && old.schedule_id.is_none() {
        return Ok(());
    }
    let mut intent = json!({"id":id,"oldId":old.schedule_id,"action":ae.action_key,
        "started":false,"oldDeleteStarted":false});
    if sem == governance::Semantic::AutomationEnable && id.is_some() {
        let row = run(tx, old.id, None).await?;
        let origin = Origin {
            tenant: row.tenant_id,
            workspace: row.workspace_id,
            resource: row.resource_id,
            owner: row.owner_principal_id,
            human: row.human_identity_id,
            agent: row.agent_principal_id,
            installation: row.executor_installation_resource_id,
            agent_version: row.agent_version_asset_id,
            generation: row.projection_generation,
            grant: row.delegation_id,
            resource_version: row.resource_version,
            version: row.automation_version_asset_id,
            version_number: row.automation_version,
        };
        intent["origin"] = serde_json::to_value(origin).map_err(|_| invalid_management())?;
        intent["spec"] = content
            .and_then(|c| c.pointer("/trigger/schedule_spec"))
            .ok_or_else(invalid_management)?
            .clone();
    }
    sqlx::query("update admission.action_execution set parameters=parameters||jsonb_build_object('scheduleIntent',$2::jsonb) where id=$1")
        .bind(ae.id).bind(intent).execute(&mut **tx).await?;
    // 原投影 fence 同时阻止新 run 与后续管理动作覆盖 UNKNOWN 的 native 写入。
    sqlx::query("update catalog.resource set projection_action_execution_id=$2 where id=$1")
        .bind(old.id)
        .bind(ae.id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Called inside the original SYNC admission transaction, after prewrite has
/// frozen the real native Schedule intent. Local-only lifecycle changes retain
/// their synchronous outcome; native work must remain available to dispatch.
pub(crate) async fn defer_schedule_dispatch(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar(
        "update admission.action_execution
         set dispatch_state=case when parameters ? 'scheduleIntent' then 'NOT_DISPATCHED' else dispatch_state end
         where id=$1 and gate_state='ALLOWED' and dispatch_state='DISPATCHED'
           and action_key in ('automation.enable','automation.pause','automation.disable')
         returning coalesce(parameters ? 'scheduleIntent',false)",
    )
    .bind(id)
    .fetch_one(&mut **tx)
    .await
}

fn input(id: &str, origin: &Origin) -> Value {
    json!({"sourceKind":"SCHEDULE","scheduleId":id,"automationResourceId":origin.resource,
        "automationVersionAssetId":origin.version})
}
fn base(origin: &Origin) -> String {
    format!(
        "platform:automation_run:{}:{}",
        origin.tenant, origin.resource
    )
}

pub(super) async fn dispatch(
    g: &Governance,
    id: Uuid,
    def: &Definition,
    sem: governance::Semantic,
) -> Result<(), Refusal> {
    // 每个 stage 在 RPC 前落持久 flag，重入只 Describe。旧 Schedule 删除与新
    // Schedule 创建分别冻结，不因一个 RPC 的 UNKNOWN 重派另一个副作用。
    loop {
        let mut tx = g.pool.begin().await?;
        let ae = governance::lock_execution(&mut tx, id).await?;
        if ae.gate_state != "ALLOWED"
            || !matches!(ae.dispatch_state.as_str(), "NOT_DISPATCHED" | "UNKNOWN")
        {
            return Ok(());
        }
        let Some(intent) = ae.parameters.as_ref().and_then(|p| p.get("scheduleIntent")) else {
            return Ok(());
        };
        let intent = intent.clone();
        let active: bool =
            sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
                .bind(ae.tenant_id)
                .fetch_one(&mut *tx)
                .await?;
        if !active {
            return management_unknown(tx, &ae, def).await;
        }
        let row = management_resource(&mut tx, ae.tenant_id, ae.target_id, true)
            .await?
            .ok_or_else(invalid_management)?;
        if row.projection_action_execution_id != Some(ae.id)
            || Some(row.version) != ae.frozen_target_version().and_then(|v| v.checked_add(1))
        {
            return management_unknown(tx, &ae, def).await;
        }
        let old = intent["oldId"].as_str();
        let new = intent["id"].as_str();
        let enabling = sem == governance::Semantic::AutomationEnable;
        let deleting =
            sem == governance::Semantic::AutomationDisable || (enabling && new.is_none());
        let clean_old = old.is_some() && (enabling || deleting);
        let (native_id, flag, operation) = if clean_old
            && old != new
            && g.temporal
                .describe_schedule(old.unwrap_or_default())
                .await
                .map_err(|_| Refusal::Unavailable("旧 Schedule 不可核验".into()))?
                .is_some()
        {
            (old.unwrap_or_default(), "oldDeleteStarted", "DELETE")
        } else if deleting {
            (old.unwrap_or_default(), "started", "DELETE")
        } else if enabling {
            (new.ok_or_else(invalid_management)?, "started", "CREATE")
        } else {
            (old.ok_or_else(invalid_management)?, "started", "PAUSE")
        };
        let observed = g
            .temporal
            .describe_schedule(native_id)
            .await
            .map_err(|_| Refusal::Unavailable("Schedule 不可核验".into()))?;
        let desired = if operation == "CREATE" {
            let origin: Origin = serde_json::from_value(intent["origin"].clone())
                .map_err(|_| invalid_management())?;
            Some(
                g.temporal
                    .automation_schedule(
                        &base(&origin),
                        &input(native_id, &origin),
                        (&origin.tenant.to_string(), &origin.workspace.to_string()),
                        interval(&intent["spec"])?,
                        false,
                    )
                    .map_err(|_| invalid_management())?,
            )
        } else {
            None
        };
        let confirmed = match operation {
            "DELETE" => observed.is_none(),
            "PAUSE" => observed
                .as_ref()
                .and_then(|s| s.state.as_ref())
                .is_some_and(|s| s.paused),
            "CREATE" => {
                observed
                    .as_ref()
                    .zip(desired.as_ref())
                    .is_some_and(|(actual, expected)| {
                        actual.spec == expected.spec
                            && actual.action == expected.action
                            && actual.policies == expected.policies
                            && actual
                                .state
                                .as_ref()
                                .is_some_and(|s| !s.paused && !s.limited_actions)
                    })
            }
            _ => false,
        };
        if confirmed {
            if flag == "oldDeleteStarted" {
                tx.commit().await?;
                continue;
            }
            if deleting {
                sqlx::query("update catalog.automation_definition set schedule_id=null,version=version+1 where resource_id=$1")
                    .bind(row.id).execute(&mut *tx).await?;
            }
            sqlx::query("update catalog.resource set projection_action_execution_id=null where id=$1 and projection_action_execution_id=$2")
                .bind(row.id).bind(ae.id).execute(&mut *tx).await?;
            governance::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), Vec::new())
                .await?;
            tx.commit().await?;
            return Ok(());
        }
        if intent[flag].as_bool() != Some(false) {
            return management_unknown(tx, &ae, def).await;
        }
        // 删除/暂停不提升任何权限；创建仍核完整管理 owner/Installation/Grant。
        let active: bool =
            sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1")
                .bind(ae.tenant_id)
                .fetch_one(&mut *tx)
                .await?;
        if !active
            || !crate::agent_definition::active_owner(
                &mut tx,
                ae.tenant_id,
                ae.initiator_principal_id,
            )
            .await?
            || !management_projection(g, &row).await?
        {
            return management_unknown(tx, &ae, def).await;
        }
        management_authorized(g, &mut tx, &ae, def, &row).await?;
        if operation == "CREATE" {
            let p = governance::Params::from_json(
                ae.parameters.as_ref().ok_or_else(invalid_management)?,
            )
            .ok_or_else(invalid_management)?;
            management_grant(g, &mut tx, &row, &p).await?;
        }
        sqlx::query("update admission.action_execution set parameters=jsonb_set(parameters,ARRAY['scheduleIntent',$2], 'true'::jsonb),dispatch_state='UNKNOWN',updated_at=now() where id=$1")
            .bind(ae.id).bind(flag).execute(&mut *tx).await?;
        tx.commit().await?;
        // 原 Tenant fence 再获取后跨 RPC，已持久 flag 不因新的拒绝/崩溃清除。
        let mut guard = g.pool.begin().await?;
        let latest = governance::lock_execution(&mut guard, id).await?;
        let active: bool =
            sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
                .bind(ae.tenant_id)
                .fetch_one(&mut *guard)
                .await?;
        let latest_row = management_resource(&mut guard, ae.tenant_id, ae.target_id, true)
            .await?
            .ok_or_else(invalid_management)?;
        if !active
            || latest_row.projection_action_execution_id != Some(id)
            || latest_row.version != row.version
        {
            return management_unknown(guard, &latest, def).await;
        }
        management_authorized(g, &mut guard, &latest, def, &latest_row).await?;
        if operation == "CREATE" {
            let workspace:Option<Uuid>=sqlx::query_scalar("select id from identity.workspace where id=$1 and tenant_id=$2 and state='ACTIVE' for update")
                .bind(latest_row.workspace_id).bind(latest.tenant_id).fetch_optional(&mut *guard).await?;
            if workspace.is_none() {
                return management_unknown(guard, &latest, def).await;
            }
            if !crate::agent_definition::active_owner(
                &mut guard,
                latest.tenant_id,
                latest.initiator_principal_id,
            )
            .await?
                || !management_projection(g, &latest_row).await?
            {
                return management_unknown(guard, &latest, def).await;
            }
            let p = governance::Params::from_json(
                latest.parameters.as_ref().ok_or_else(invalid_management)?,
            )
            .ok_or_else(invalid_management)?;
            let version:Option<(Uuid,Uuid,Value,String)>=sqlx::query_as("select a.id,a.owner_principal_id,
                jsonb_build_object('trigger',v.trigger,'action',v.action,'approvalPolicyId',v.approval_policy_id,'resultTarget',v.result_target)
                  || case when v.approval_policy_version is null then '{}'::jsonb else jsonb_build_object('approvalPolicyVersion',v.approval_policy_version) end,v.config_hash
                from catalog.automation_version v join catalog.asset a on a.id=v.asset_id
                join catalog.automation_definition d on d.resource_id=v.automation_resource_id and d.pinned_version_asset_id=v.asset_id
                where v.asset_id=$1 and a.version=$2 and a.tenant_id=$3 and a.resource_id=$4
                  and v.state='PUBLISHED' and a.state='PUBLISHED' and a.projection_action_execution_id is null for update of a,v")
                .bind(p.asset_id).bind(p.asset_version).bind(latest.tenant_id).bind(latest_row.id)
                .fetch_optional(&mut *guard).await?;
            let (asset, owner, content, hash) = version.ok_or_else(invalid_management)?;
            if collab_bridge::limits::canonical_digest(&content) != hash
                || !crate::agent_definition::active_owner(&mut guard, latest.tenant_id, owner)
                    .await?
                || !g
                    .spicedb
                    .asset_projection_matches(
                        &asset.to_string(),
                        &latest.tenant_id.to_string(),
                        &latest_row.id.to_string(),
                        &owner.to_string(),
                        g.cfg.relationship_page,
                    )
                    .await
                    .map_err(|_| Refusal::Unavailable("Schedule Version 投影未知".into()))?
            {
                return management_unknown(guard, &latest, def).await;
            }
            management_installation(
                g,
                &mut guard,
                latest.tenant_id,
                latest_row.workspace_id,
                latest_row.executor_installation_resource_id,
                latest_row.owner_principal_id,
                &content,
            )
            .await?;
            management_grant(g, &mut guard, &latest_row, &p).await?;
        }
        let result = match operation {
            "CREATE" => {
                g.temporal
                    .create_schedule(
                        native_id,
                        ae.operation_id,
                        desired.ok_or_else(invalid_management)?,
                    )
                    .await
            }
            "PAUSE" => g.temporal.pause_schedule(native_id, ae.operation_id).await,
            _ => g.temporal.delete_schedule(native_id).await,
        };
        if result.is_err() {
            return management_unknown(guard, &latest, def).await;
        }
        guard.commit().await?;
        // ACK 只是继续 exact-ID Describe，不是终态证据。
    }
}

pub(super) async fn frozen_source(
    g: &Governance,
    tx: &mut Transaction<'_, Postgres>,
    ae: &governance::Execution,
    f: &FrozenInvocation,
) -> Result<(), Refusal> {
    let valid:bool=sqlx::query_scalar("select exists(select 1 from catalog.agent_invocation i
        where i.action_execution_id=$1 and i.source_kind='SCHEDULE' and i.schedule_id=$2 and i.scheduled_at=$3::timestamptz
        and i.source_event_id=$4 and i.root_event_id=$5)")
        .bind(ae.id).bind(ae.parameters.as_ref().and_then(|p|p.get("scheduleId")).and_then(Value::as_str))
        .bind(ae.parameters.as_ref().and_then(|p|p.get("scheduledAt")).and_then(Value::as_str))
        .bind(&f.source_event_id).bind(&f.root_event_id).fetch_one(&mut **tx).await?;
    if !valid {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let row = management_resource(tx, ae.tenant_id, ae.target_id, false)
        .await?
        .ok_or_else(invalid_management)?;
    let def = definition(g).await?;
    management_authorized(g, tx, ae, &def, &row).await
}

pub(crate) async fn admit_schedule(
    State(state): State<ServiceState>,
    headers: HeaderMap,
    body: Result<Json<AutomationScheduleAdmitRequest>, axum::extract::rejection::JsonRejection>,
) -> Response {
    if let Err(response) = crate::service_api::authorize(&state, &headers).await {
        return response;
    }
    let Ok(Json(request)) = body else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    match admit_once(&state, &request).await {
        Ok(result) => Json(result).into_response(),
        Err(Refusal::Unavailable(_)) => StatusCode::SERVICE_UNAVAILABLE.into_response(),
        Err(_) => StatusCode::CONFLICT.into_response(),
    }
}

fn task_input(id: Uuid, origin: &Origin) -> Result<AgentTaskWorkflowInput, Refusal> {
    let seconds = |key: &str| {
        std::env::var(key)
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|n| *n > 0)
            .ok_or_else(invalid_management)
    };
    let input = AgentTaskWorkflowInput {
        invocation_id: id.to_string(),
        installation_id: origin.installation.to_string(),
        agent_version_asset_id: origin.agent_version.to_string(),
        projection_generation: origin.generation,
        event_base: 0,
        cancel_pending: false,
        heartbeat_timeout_seconds: seconds("WORKER_AGENT_ACTIVITY_HEARTBEAT_TIMEOUT_SECONDS")?,
        heartbeat_interval_seconds: seconds("WORKER_AGENT_ACTIVITY_HEARTBEAT_INTERVAL_SECONDS")?,
        observation_interval_seconds: seconds(
            "WORKER_AGENT_ACTIVITY_OBSERVATION_INTERVAL_SECONDS",
        )?,
    };
    if input.heartbeat_interval_seconds >= input.heartbeat_timeout_seconds {
        return Err(invalid_management());
    }
    Ok(input)
}

async fn admit_once(
    state: &ServiceState,
    request: &AutomationScheduleAdmitRequest,
) -> Result<Value, Refusal> {
    let native = &request.input;
    let resource =
        Uuid::parse_str(&native.automation_resource_id).map_err(|_| invalid_management())?;
    let version =
        Uuid::parse_str(&native.automation_version_asset_id).map_err(|_| invalid_management())?;
    let run_id = Uuid::parse_str(&request.run_id).map_err(|_| invalid_management())?;
    let mut origins:Vec<Value>=sqlx::query_scalar("select parameters#>'{scheduleIntent,origin}'
        from admission.action_execution where action_key='automation.enable' and target_id=$1
          and parameters#>>'{scheduleIntent,id}'=$2 and gate_state='ALLOWED' and dispatch_state='DISPATCHED'
        order by id limit 2")
        .bind(resource).bind(&native.schedule_id).fetch_all(&state.pool).await?;
    if origins.len() != 1 {
        return Err(Refusal::Unavailable("Schedule管理意图缺失或不唯一".into()));
    }
    let origin: Origin =
        serde_json::from_value(origins.remove(0)).map_err(|_| invalid_management())?;
    if origin.resource != resource || origin.version != version {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let planned = state
        .temporal
        .scheduled_start(
            &native.schedule_id,
            &request.workflow_id,
            &request.run_id,
            &input(&native.schedule_id, &origin),
        )
        .await
        .map_err(|_| Refusal::Unavailable("Schedule native start 不可核验".into()))?;
    if request.workflow_id != format!("{}-{planned}", base(&origin)) {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let root = format!("schedule:{}:{planned}", native.schedule_id);
    // 跨版本/重新启用仍以同一个 Automation + native nominal time 去重。
    let key = Uuid::new_v5(&resource, planned.as_bytes());
    let existing:Option<(Uuid,String,Option<Uuid>,Option<String>)>=sqlx::query_as("select ae.id,ae.gate_state,i.id,ae.temporal_workflow_id
        from admission.action_execution ae left join catalog.agent_invocation i on i.action_execution_id=ae.id
        where ae.tenant_id=$1 and ae.initiator_principal_id=$2 and ae.idempotency_key=$3 and ae.action_key=$4")
        .bind(origin.tenant).bind(origin.owner).bind(key).bind(ACTION).fetch_optional(&state.pool).await?;
    if let Some((_, gate, id, workflow)) = existing {
        if workflow.as_deref() != Some(request.workflow_id.as_str()) {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        return match (gate.as_str(), id) {
            ("ALLOWED", Some(id)) => {
                Ok(json!({"admitted":true,"reasonCode":"NONE","taskInput":task_input(id,&origin)?}))
            }
            ("DENIED", _) => Ok(json!({"admitted":false,"reasonCode":"PERMISSION_DENIED"})),
            _ => Err(Refusal::Unavailable("Schedule准入尚未裁决".into())),
        };
    }
    let def = definition(&state.governance).await?;
    let mut tx = state.pool.begin().await?;
    let active: bool =
        sqlx::query_scalar("select state='ACTIVE' from identity.tenant where id=$1 for update")
            .bind(origin.tenant)
            .fetch_one(&mut *tx)
            .await?;
    // Tenant串行点后的重复 Activity 不创建第二次 AE/Invocation。
    let duplicate:bool=sqlx::query_scalar("select exists(select 1 from admission.action_execution where tenant_id=$1 and initiator_principal_id=$2 and idempotency_key=$3)")
        .bind(origin.tenant).bind(origin.owner).bind(key).fetch_one(&mut *tx).await?;
    if duplicate {
        return Err(Refusal::Unavailable("Schedule准入并发，沿原key查证".into()));
    }
    let params = json!({"targetVersion":origin.resource_version,"automationVersionAssetId":origin.version,
        "automationVersion":origin.version_number,"agentVersionAssetId":origin.agent_version,"projectionGeneration":origin.generation,
        "delegationId":origin.grant,"sourceKind":"SCHEDULE","scheduleId":native.schedule_id,"scheduledAt":planned,
        "sourceEventId":planned,"rootEventId":root});
    let ae = governance::open_automation_execution(
        &mut tx,
        Actor {
            tenant_id: origin.tenant,
            principal_id: origin.owner,
            human_identity_id: origin.human,
        },
        origin.agent,
        &def,
        &Target {
            id: resource,
            version: origin.resource_version,
            workspace_id: Some(origin.workspace),
        },
        params,
        key,
    )
    .await?;
    // Native已启动。即使准入DENIED也回填原Ref，Workflow自己以拒绝终结。
    sqlx::query("insert into projection.workflow_ref(workflow_id,workflow_type,workflow_version,kind,tenant_id,workspace_id,
        operation_id,action_execution_id,run_id,projection_state) values($1,$2,1,null,$3,$4,$5,$6,$7,'RUNNING')")
        .bind(&request.workflow_id).bind(crate::agent_task::WORKFLOW_TYPE).bind(origin.tenant).bind(origin.workspace)
        .bind(ae.operation_id).bind(ae.id).bind(&request.run_id).execute(&mut *tx).await?;
    sqlx::query("update admission.action_execution set temporal_workflow_id=$2 where id=$1")
        .bind(ae.id)
        .bind(&request.workflow_id)
        .execute(&mut *tx)
        .await?;
    let decision = async {
        if !active {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let row = run(&mut tx, resource, None).await?;
        let current_schedule: Option<String> = sqlx::query_scalar(
            "select schedule_id from catalog.automation_definition where resource_id=$1",
        )
        .bind(resource)
        .fetch_one(&mut *tx)
        .await?;
        if current_schedule.as_deref() != Some(native.schedule_id.as_str())
            || row.automation_version_asset_id != origin.version
            || row.owner_principal_id != origin.owner
            || row.executor_installation_resource_id != origin.installation
            || row.agent_principal_id != origin.agent
            || row.agent_version_asset_id != origin.agent_version
            || row.projection_generation != origin.generation
            || row.delegation_id != origin.grant
            || row.trigger.get("kind").and_then(Value::as_str) != Some("SCHEDULE")
            || row.result_target != "CHANNEL"
        {
            return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
        }
        let management = management_resource(&mut tx, origin.tenant, resource, false)
            .await?
            .ok_or_else(invalid_management)?;
        management_authorized(&state.governance, &mut tx, &ae, &def, &management).await?;
        fresh_executor(state, &mut tx, &row).await?;
        fresh(&state.governance, &mut tx, &row, &def, None).await
    }
    .await;
    if matches!(decision, Err(Refusal::Unavailable(_))) {
        // 无法判定不留假的DENIED，也不提交未决首Activity；原nativeWorkflow/key可重查。
        return Err(Refusal::Unavailable("Schedule fresh准入不可核验".into()));
    }
    state
        .governance
        .record_automation_decision(
            &mut tx,
            &ae,
            &def,
            "ADMISSION",
            decision.as_ref().map(Clone::clone),
        )
        .await?;
    if decision.is_err() {
        tx.commit().await?;
        return Ok(json!({"admitted":false,"reasonCode":"PERMISSION_DENIED"}));
    }
    let id = Uuid::new_v4();
    let task = task_input(id, &origin)?;
    sqlx::query("insert into admission.delegation_use(delegation_id,operation_id) values($1,$2)")
        .bind(origin.grant)
        .bind(ae.operation_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("insert into catalog.agent_session(tenant_id,workspace_id,root_event_id,installation_resource_id,agent_version_asset_id,
        projection_generation,core_memory_state,status,source_kind) values($1,$2,$3,$4,$5,$6,'UNREADABLE','PENDING','SCHEDULE')")
        .bind(origin.tenant).bind(origin.workspace).bind(&root).bind(origin.installation).bind(origin.agent_version).bind(origin.generation)
        .execute(&mut *tx).await?;
    sqlx::query("insert into catalog.agent_invocation(id,tenant_id,workspace_id,root_event_id,source_event_id,installation_resource_id,
        agent_version_asset_id,projection_generation,delegation_id,automation_resource_id,automation_version_asset_id,action_execution_id,
        workflow_id,status,source_kind,schedule_id,scheduled_at)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'CREATED','SCHEDULE',$14,$15)")
        .bind(id).bind(origin.tenant).bind(origin.workspace).bind(&root).bind(&planned).bind(origin.installation)
        .bind(origin.agent_version).bind(origin.generation).bind(origin.grant).bind(resource).bind(origin.version).bind(ae.id)
        .bind(&request.workflow_id).bind(&native.schedule_id).bind(DateTime::parse_from_rfc3339(&planned).map_err(|_|invalid_management())?.with_timezone(&Utc))
        .execute(&mut *tx).await?;
    governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Ok(()),
        vec![
            crate::audit::Evidence::new(
                contracts::EvidenceKind::TemporalWorkflowId,
                &request.workflow_id,
            ),
            crate::audit::Evidence::new(contracts::EvidenceKind::TemporalRunId, run_id),
        ],
    )
    .await?;
    tx.commit().await?;
    Ok(json!({"admitted":true,"reasonCode":"NONE","taskInput":task}))
}
