//! DD-134(6)：本 Tenant 的工具列表与测试调用入口。
//!
//! 列出 `PLATFORM_NATIVE` 工具与各 binding 投影的 `APPLICATION` 工具（Tool Resource
//! `discover` 过滤），附时间窗内的调用统计（来源同统计分区：Core 工具子
//! ActionExecution）。停用只作用于所属连接（`application_binding.disable` 的准入预
//! 评估给出入口）；`PLATFORM_NATIVE` 工具随平台固定，无启停入口（DD-122）。测试调用
//! 只对契约 permission 为 `discover`、`consume` 或 `read` 的工具给出所需的动作版本、
//! 输入 schema、结果策略与可作用目标；提交时由该工具的 ActionDefinition 完整重新准入。

use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use contracts::{GatewayToolPage, ReasonCode};
use serde::Deserialize;
use serde_json::{json, Value};
use uuid::Uuid;

use super::access::{action_allowed, caller, require_tenant, require_zone, Caller};
use super::stats::{rfc3339, tool_records, window, Counters};
use crate::bff::BffState;
use crate::governance::{Refusal, Target};

const TEST_TARGET_LIMIT: usize = 20;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ToolsQuery {
    from: Option<String>,
    to: Option<String>,
    offset: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct ToolRow {
    resource_id: Uuid,
    resource_version: i32,
    name: String,
    source: String,
    resource_state: String,
    action_key: String,
    capability_contract_key: Option<String>,
    binding_id: Option<Uuid>,
    binding_version: Option<i32>,
    binding_state: Option<String>,
    binding_workspace_id: Option<Uuid>,
    component_type_key: Option<String>,
    component_release_id: Option<Uuid>,
    release_version: Option<String>,
    contract_permission: Option<String>,
    input_schema: Option<Value>,
    action_version: Option<i32>,
    policy_id: Option<Uuid>,
    policy_version: Option<i32>,
    mcp_connection_id: Option<Uuid>,
    mcp_connection_name: Option<String>,
}

const TOOL_LIST: &str = "select r.id as resource_id,r.version as resource_version,t.name,t.source,
       r.state as resource_state,t.action_key,t.capability_contract_key,t.output_schema_hash,t.input_schema_hash,
       b.id as binding_id,b.version as binding_version,b.state as binding_state,b.workspace_id as binding_workspace_id,
       b.component_type_key,b.component_release_id,release.version as release_version,
       contract.permission as contract_permission,contract.input_schema,
       policy.action_version as action_version,
       policy.id as policy_id,policy.version as policy_version,
       t.mcp_connection_id,connection.display_name as mcp_connection_name
     from catalog.resource r
     join catalog.tool_definition t on t.resource_id=r.id
     left join catalog.mcp_connection connection on connection.resource_id=t.mcp_connection_id
       and connection.tenant_id=r.tenant_id
     left join catalog.application_binding b on b.id=r.application_binding_id and b.tenant_id=r.tenant_id
     left join catalog.component_release release on release.id=b.component_release_id
     left join lateral (
       select op->>'permission' as permission,
              (select doc->'schema' from jsonb_array_elements(c.schema_documents) doc
                where doc->>'digest'=t.input_schema_hash limit 1) as input_schema
       from catalog.capability_contract c
       join lateral jsonb_array_elements(c.content->'operationContracts') op on true
       where c.status in ('ACTIVE','DEPRECATED') and op->>'contractKey'=t.capability_contract_key
         and op->>'surface'='TOOL'
       order by c.contract_version desc limit 1
     ) contract on true
     left join lateral (
       select p.id,p.version,p.action_version from catalog.result_exposure_policy p
       join catalog.action_definition d on d.action_key=p.action_key and d.version=p.action_version
         and d.component_release_id=p.component_release_id and d.status='ACTIVE'
       where p.tenant_id=r.tenant_id and p.status='ACTIVE' and p.output_schema_hash=t.output_schema_hash
         and p.application_binding_id=b.id and p.application_projection_generation=b.active_projection_generation
         and p.component_release_id=b.component_release_id and p.action_key=t.action_key
         and p.action_version=(select max(current.version) from catalog.action_definition current
           where current.component_release_id=b.component_release_id and current.action_key=t.action_key and current.status='ACTIVE')
         and b.state='ACTIVE' and release.status='APPROVED'
         and exists(select 1 from projection.application_runtime runtime where runtime.binding_id=b.id
           and runtime.generation=b.active_projection_generation and runtime.component_release_id=b.component_release_id
           and runtime.state='ACTIVE')
         and p.mode=d.result_exposure and p.redaction_policy='PLATFORM_METADATA_ONLY'
         and p.mode in ('CONSUME_ONLY','READ')
       order by p.action_version desc limit 1
     ) policy on true
     where r.tenant_id=$1 and r.type_key='tool.definition' and t.status<>'DELETED'
     order by t.source desc,t.name,r.id offset $2 limit $3";

/// 测试调用只开放读取方向的契约 permission。
pub(crate) fn testable_permission(permission: Option<&str>) -> bool {
    matches!(permission, Some("discover" | "consume" | "read"))
}

async fn test_targets(
    state: &BffState,
    caller: &Caller,
    binding: Uuid,
    permission: &str,
) -> Result<Vec<Value>, Refusal> {
    let candidates: Vec<(Uuid, i32, String, Option<Uuid>)> = sqlx::query_as(
        "select r.id,r.version,coalesce(nullif(r.native_id,''),r.id::text),r.home_workspace_id
         from catalog.resource r
         where r.tenant_id=$1 and r.application_binding_id=$2 and r.state='ACTIVE'
           and r.type_key<>'tool.definition' and r.projection_action_execution_id is null
         order by r.id limit 100",
    )
    .bind(caller.ctx.tenant_id)
    .bind(binding)
    .fetch_all(&state.pool)
    .await?;
    if candidates.is_empty() {
        return Ok(Vec::new());
    }
    let ids: Vec<String> = candidates.iter().map(|c| c.0.to_string()).collect();
    let allowed = state
        .governance
        .spicedb
        .check_bulk(
            "resource",
            &ids,
            permission,
            &caller.ctx.tenant_principal_id.to_string(),
        )
        .await
        .map_err(|_| Refusal::Unavailable("tool target authorization unavailable".into()))?;
    Ok(candidates
        .into_iter()
        .filter(|c| allowed.contains(&c.0.to_string()))
        .take(TEST_TARGET_LIMIT)
        .map(|(id, version, name, workspace)| {
            let mut target = json!({"resourceId":id,"resourceVersion":version,"displayName":name});
            if let Some(workspace) = workspace {
                target["workspaceId"] = json!(workspace);
            }
            target
        })
        .collect())
}

async fn tool_page(
    state: &BffState,
    caller: &Caller,
    query: ToolsQuery,
) -> Result<GatewayToolPage, Refusal> {
    require_zone(state, caller).await?;
    require_tenant(state, caller, None, "discover").await?;
    let offset = query.offset.unwrap_or(0);
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let window = window(query.from.as_deref(), query.to.as_deref(), Utc::now())?;
    let rows: Vec<ToolRow> = sqlx::query_as(TOOL_LIST)
        .bind(caller.ctx.tenant_id)
        .bind(offset)
        .bind(limit + 1)
        .fetch_all(&state.pool)
        .await?;
    let has_next = rows.len() as i64 > limit;
    let rows: Vec<ToolRow> = rows.into_iter().take(limit as usize).collect();
    let ids: Vec<String> = rows.iter().map(|r| r.resource_id.to_string()).collect();
    let visible = if ids.is_empty() {
        Default::default()
    } else {
        state
            .governance
            .spicedb
            .check_bulk(
                "resource",
                &ids,
                "discover",
                &caller.ctx.tenant_principal_id.to_string(),
            )
            .await
            .map_err(|_| Refusal::Unavailable("tool discovery unavailable".into()))?
    };
    // 调用统计只在持有 Tenant audit 时给出；否则计数为零但不代表没有调用——
    // 呈现层以 GatewayAccess.canReadStats 判断是否显示该列。
    let audit = super::access::check(
        state,
        "tenant",
        caller.ctx.tenant_id,
        "audit",
        caller.ctx.tenant_principal_id,
    )
    .await?;
    let mut counters: HashMap<String, Counters> = HashMap::new();
    if audit {
        let (records, _) = tool_records(&state.pool, caller.ctx.tenant_id, &window, None).await?;
        for record in &records {
            if let Some(tool) = &record.tool {
                counters.entry(tool.clone()).or_default().add(record);
            }
        }
    }
    let mut tools = Vec::new();
    for row in rows {
        if !visible.contains(&row.resource_id.to_string()) {
            continue;
        }
        let mut tool = json!({"resourceId":row.resource_id,"resourceVersion":row.resource_version,
            "name":row.name,"source":row.source,"resourceState":row.resource_state,"actionKey":row.action_key,
            "requests":0,"failed":0,"denied":0,"canDisableBinding":false,"canTestCall":false});
        if let Some(counter) = counters.get_mut(&row.resource_id.to_string()) {
            tool["requests"] = json!(counter.requests);
            tool["failed"] = json!(counter.failed);
            tool["denied"] = json!(counter.denied);
            if let (_, Some(p95)) = counter.p95() {
                tool["toolP95Ms"] = json!(p95);
            }
        }
        for (key, value) in [
            (
                "capabilityContractKey",
                row.capability_contract_key.clone().map(Value::from),
            ),
            (
                "contractPermission",
                row.contract_permission.clone().map(Value::from),
            ),
            ("applicationBindingId", row.binding_id.map(|b| json!(b))),
            // DD-149: user connector tools name their connector.
            ("mcpConnectionId", row.mcp_connection_id.map(|c| json!(c))),
            (
                "mcpConnectionName",
                row.mcp_connection_name.clone().map(Value::from),
            ),
            (
                "applicationBindingVersion",
                row.binding_version.map(Value::from),
            ),
            ("bindingState", row.binding_state.clone().map(Value::from)),
            (
                "bindingWorkspaceId",
                row.binding_workspace_id.map(|w| json!(w)),
            ),
            (
                "componentTypeKey",
                row.component_type_key.clone().map(Value::from),
            ),
            (
                "componentReleaseId",
                row.component_release_id.map(|r| json!(r)),
            ),
            (
                "releaseVersion",
                row.release_version.clone().map(Value::from),
            ),
        ] {
            if let Some(value) = value {
                tool[key] = value;
            }
        }
        if let (Some(binding), Some(version), Some(binding_state)) = (
            row.binding_id,
            row.binding_version,
            row.binding_state.as_deref(),
        ) {
            if matches!(binding_state, "PROVISIONING" | "ACTIVE" | "ERROR") {
                tool["canDisableBinding"] = json!(
                    action_allowed(
                        state,
                        caller,
                        crate::application_binding::DISABLE,
                        &Target {
                            id: binding,
                            version,
                            workspace_id: row.binding_workspace_id,
                        },
                    )
                    .await?
                );
            }
            let ready = row.source == "APPLICATION"
                && row.resource_state == "ACTIVE"
                && binding_state == "ACTIVE"
                && testable_permission(row.contract_permission.as_deref());
            if let (
                true,
                Some(action_version),
                Some(policy),
                Some(policy_version),
                Some(schema),
                Some(permission),
            ) = (
                ready,
                row.action_version,
                row.policy_id,
                row.policy_version,
                row.input_schema.as_ref(),
                row.contract_permission.as_deref(),
            ) {
                let targets = test_targets(state, caller, binding, permission).await?;
                if !targets.is_empty() {
                    tool["canTestCall"] = json!(true);
                    tool["testCall"] = json!({"actionKey":row.action_key,"actionVersion":action_version,
                        "inputSchemaJson":collab_bridge::limits::canonical_json(schema),
                        "resultExposurePolicyId":policy,"resultExposurePolicyVersion":policy_version,
                        "targets":targets});
                }
            }
        }
        tools.push(tool);
    }
    let mut value = json!({"from":rfc3339(window.from),"to":rfc3339(window.to),"tools":tools});
    if has_next {
        value["nextOffset"] = json!(offset + limit);
    }
    serde_json::from_value(value).map_err(|e| Refusal::Unavailable(format!("GatewayToolPage: {e}")))
}

/// `GET /api/v1/gateway/tools`
pub(crate) async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<ToolsQuery>,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match tool_page(&state, &caller, query).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_read_direction_contracts_are_testable() {
        for permission in ["discover", "consume", "read"] {
            assert!(testable_permission(Some(permission)));
        }
        for permission in ["update", "delete", "export", "execute", "manage"] {
            assert!(!testable_permission(Some(permission)));
        }
        assert!(!testable_permission(None));
    }
}
