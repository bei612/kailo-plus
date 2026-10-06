//! Native MCP arm of the original ComponentTask conformance activity. The
//! isolated delivery constrains safe probes; it never grants production access.
use super::*;
use crate::application_binding::peer as transport;
use crate::service_api::ServiceState;

fn unavailable() -> Refusal {
    Refusal::Unavailable("MCP conformance result unknown".into())
}

pub(super) fn environment(release: &Registration) -> Result<Value, Refusal> {
    let file = std::env::var("COMPONENT_CONFORMANCE_ENVIRONMENT_FILE")
        .map_err(|_| Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let bytes = std::fs::read(file).map_err(|_| unavailable())?;
    let typed: contracts::ComponentProtocolPeerEnvironment =
        serde_json::from_slice(&bytes).map_err(|_| bad())?;
    let env = serde_json::to_value(typed).map_err(|_| bad())?;
    if serde_json::from_slice::<Value>(&bytes).map_err(|_| bad())? != env
        || env["artifactDigest"] != release.adapter_digest
    {
        return Err(bad());
    }
    let url = reqwest::Url::parse(text(&env, "mcpUrl")?).map_err(|_| bad())?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || env["timeoutSeconds"].as_u64().is_none_or(|v| v == 0)
        || env["maxResponseBytes"]
            .as_u64()
            .is_none_or(|v| v == 0 || usize::try_from(v).is_err())
        || env["maxSteps"].as_u64().is_none_or(|v| v == 0)
    {
        return Err(bad());
    }
    let _: rmcp::model::InitializeResult =
        serde_json::from_str(text(&env, "initializeResultJson")?).map_err(|_| bad())?;
    let _: rmcp::model::ListToolsResult =
        serde_json::from_str(text(&env, "listResultJson")?).map_err(|_| bad())?;
    Ok(env)
}

pub(super) async fn prewrite(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    ae: &Execution,
    release: &Registration,
    contracts: &[Value],
) -> Result<i32, Refusal> {
    let env = environment(release)?;
    crate::application_binding::credentials::validate_conformance(
        ae.tenant_id,
        &release.manifest,
        &env,
    )?;
    let mut steps = Vec::new();
    for (operation, expected) in [
        ("mcp_initialize", "initializeResultJson"),
        ("mcp_list", "listResultJson"),
    ] {
        steps.push(json!({"caseKey":"native-mcp","stepKey":operation,"operation":operation,
            "idempotencyKey":Uuid::new_v5(&ae.id,operation.as_bytes()),"requestJson":"{}",
            "expectedResponseJson":env[expected],"expectedHttpStatus":0,"expectedMcpResultKind":"RESULT"}));
    }
    for contract in contracts {
        for case in contract["vectors"]["cases"].as_array().ok_or_else(bad)? {
            for step in case["steps"].as_array().ok_or_else(bad)? {
                if [
                    "referenceResourceId",
                    "referenceAssetId",
                    "referenceFromStepKey",
                ]
                .iter()
                .any(|field| step.get(field).is_some())
                {
                    return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
                }
                let key = text(step, "contractKey")?;
                let tools: Vec<_> = release.manifest["toolDefinitions"]
                    .as_array()
                    .ok_or_else(bad)?
                    .iter()
                    .filter(|tool| tool["capabilityContractKey"] == key)
                    .collect();
                let [tool] = tools.as_slice() else {
                    return Err(bad());
                };
                if !env["readOnlyTools"]
                    .as_array()
                    .ok_or_else(bad)?
                    .contains(&tool["name"])
                {
                    return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
                }
                let input: Value =
                    serde_json::from_str(text(step, "inputJson")?).map_err(|_| bad())?;
                if !input.is_object() {
                    return Err(bad());
                }
                let case_key = format!(
                    "{}:{}:{}",
                    contract["content"]["categoryKey"],
                    contract["content"]["contractVersion"],
                    text(case, "caseKey")?
                );
                let step_key = text(step, "stepKey")?;
                steps.push(json!({"caseKey":case_key,"stepKey":step_key,"operation":"mcp_call","contractKey":key,
                    "idempotencyKey":Uuid::new_v5(&ae.id,format!("{case_key}:{step_key}").as_bytes()),
                    "requestJson":collab_bridge::limits::canonical_json(&json!({"name":tool["name"],"arguments":input})),
                    "expectedResponseJson":step["expectedOutputJson"],"expectedHttpStatus":0,"expectedMcpResultKind":"RESULT"}));
            }
        }
    }
    if steps.len() as u64 > env["maxSteps"].as_u64().ok_or_else(bad)? {
        return Err(bad());
    }
    let digests: Vec<_> = contracts
        .iter()
        .map(collab_bridge::limits::canonical_digest)
        .collect();
    let mut plan = json!({"actionExecutionId":ae.id,"operationId":ae.operation_id,
        "workflowId":crate::component_task::workflow_id(KIND,ae.tenant_id,&release.id.to_string(),1),"runId":"",
        "componentReleaseId":release.id,"artifactDigest":release.adapter_digest,"contractDigests":digests,
        "suiteDigest":collab_bridge::limits::canonical_digest(&json!({"environment":env,"contracts":contracts})),
        "identityDigest":collab_bridge::limits::canonical_digest(&env),"planDigest":"",
        "connectorKind":"PROTOCOL_PEER","steps":steps});
    plan["planDigest"] = json!(collab_bridge::limits::canonical_digest(&plan));
    let typed: contracts::ComponentConformancePlan =
        serde_json::from_value(plan.clone()).map_err(|_| bad())?;
    if serde_json::to_value(typed).map_err(|_| bad())? != plan {
        return Err(bad());
    }
    let changed=sqlx::query("update admission.action_execution set component_conformance_plan=$2
        where id=$1 and component_conformance_plan is null and component_conformance_observation is null")
        .bind(ae.id).bind(plan).execute(&mut **tx).await?;
    if changed.rows_affected() != 1 {
        return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
    }
    Ok(1)
}

fn target(action: Uuid) -> String {
    format!("component-validation-{action}")
}

pub(crate) struct Probe<'a> {
    pub action: Uuid,
    pub index: usize,
    pub run: &'a str,
}

pub(crate) async fn authorize(
    state: &ServiceState,
    bearer: &str,
    probe: Probe<'_>,
    services: &[String],
    method: &str,
    params: Option<&[u8]>,
    response: bool,
) -> Result<(), Refusal> {
    let Probe { action, index, run } = probe;
    state
        .auth
        .verify_core_mcp(bearer)
        .await
        .map_err(|_| Refusal::Denied(ReasonCode::PermissionDenied))?;
    if services != [target(action)] {
        return Err(bad());
    }
    let mut tx = state.pool.begin().await?;
    let ae = crate::governance::lock_execution(&mut tx, action).await?;
    fresh_suite(state, &mut tx, &ae, run).await?;
    let plan: Value = sqlx::query_scalar(
        "select component_conformance_plan from admission.action_execution where id=$1",
    )
    .bind(action)
    .fetch_one(&mut *tx)
    .await?;
    if plan["connectorKind"] != "PROTOCOL_PEER" {
        return Err(bad());
    }
    let step = plan["steps"]
        .as_array()
        .and_then(|steps| steps.get(index))
        .ok_or_else(bad)?;
    let dispatched: bool = sqlx::query_scalar(
        "select exists(select 1 from audit.audit_event
        where event_key=$1 and operation_id=$2 and event_type='DISPATCH')",
    )
    .bind(format!("{}:mcp-probe:{index}:dispatch", ae.operation_id))
    .bind(ae.operation_id)
    .fetch_one(&mut *tx)
    .await?;
    if !dispatched {
        return Err(bad());
    }
    match method {
        "initialize" | "notifications/initialized" | "ping" => {}
        "tools/list" if step["operation"] == "mcp_list" => {}
        "tools/call" if step["operation"] == "mcp_call" => {
            if response {
                tx.commit().await?;
                return Ok(());
            }
            let request: Value =
                serde_json::from_slice(params.ok_or_else(bad)?).map_err(|_| bad())?;
            let expected: Value =
                serde_json::from_str(text(step, "requestJson")?).map_err(|_| bad())?;
            if request != expected {
                return Err(bad());
            }
        }
        _ => return Err(Refusal::Denied(ReasonCode::PermissionDenied)),
    }
    tx.commit().await?;
    Ok(())
}

async fn route(
    state: &ServiceState,
    ae: &Execution,
    release: &Registration,
    env: &Value,
) -> Result<reqwest::Url, Refusal> {
    let signer = state.agent_tool_sessions.as_ref().ok_or_else(bad)?;
    let service = state.gateway_service_auth.as_ref().ok_or_else(bad)?;
    let mut url = signer.gateway_url().clone();
    url.path_segments_mut()
        .map_err(|_| bad())?
        .pop_if_empty()
        .extend(["component-conformance", &ae.id.to_string()]);
    let id = target(ae.id);
    let credentials = crate::application_binding::credentials::prepare_conformance(
        state,
        ae,
        &release.manifest,
        env,
    )
    .await?;
    let mut native_target = json!({"name":id,"mcp":{"host":env["mcpUrl"]}});
    if let Some(auth) = crate::application_binding::credentials::backend_auth(&credentials)? {
        native_target["policies"] = json!({"backendAuth":auth});
    }
    let value = json!({"name":id,"gateways":[signer.gateway_name()],"matches":[{"path":{"exact":url.path()}}],
        "policies":{"jwtAuth":state.auth.core_mcp_authentication().map_err(|_|bad())?,
        "mcpGuardrails":{"processors":[{"kind":"remote","host":service.ext_mcp_url().as_str(),
            "policies":{"backendAuth":service.backend_auth()},"failureMode":"failClosed",
            "methods":{"*":"request","initialize":"full","ping":"full","tools/list":"full","tools/call":"full"},
            "requestHeaders":{"allowed":["authorization",transport::HEADER,transport::PROBE_HEADER,transport::RUN_HEADER]},
            "metadata":{"managementAction":"has(mcpGuardrails.managementAction) ? mcpGuardrails.managementAction : ''",
                "managementBearer":"has(mcpGuardrails.managementBearer) ? mcpGuardrails.managementBearer : ''",
                "probeIndex":"has(mcpGuardrails.probeIndex) ? mcpGuardrails.probeIndex : ''",
                "probeRun":"has(mcpGuardrails.probeRun) ? mcpGuardrails.probeRun : ''"}}]}},
        "backends":[{"mcp":{"statefulMode":"stateless","prefixMode":"conditional","failureMode":"failClosed",
            "targets":[native_target]}}]});
    let gateway = crate::model_route::Gateway::from_env()?;
    gateway
        .admin(
            &["api", "config", "resources", "traffic.route"],
            Some(json!({"resources":[{"value":value}]})),
        )
        .await?;
    crate::agent_tool_runtime::require_route(&gateway, &id, Some(&value)).await?;
    Ok(url)
}

pub(super) async fn run_probe(
    state: &ServiceState,
    input: contracts::ComponentConformanceProbe,
) -> axum::response::Response {
    use axum::response::IntoResponse;
    let result=async {
        let input=serde_json::to_value(input).map_err(|_|bad())?;
        let action=Uuid::parse_str(text(&input["plan"],"actionExecutionId")?).map_err(|_|bad())?;
        let index=usize::try_from(input["stepIndex"].as_u64().ok_or_else(bad)?).map_err(|_|bad())?;
        if input["reconcile"]==true || input.get("contentReference").is_some() { return Err(unavailable()); }
        let mut tx=state.pool.begin().await?;
        let ae=crate::governance::lock_execution(&mut tx,action).await?;
        let run=text(&input["plan"],"runId")?;
        fresh_suite(state,&mut tx,&ae,run).await?;
        let plan:Value=sqlx::query_scalar("select component_conformance_plan from admission.action_execution
            where id=$1 and component_conformance_observation is null").bind(ae.id).fetch_one(&mut *tx).await?;
        let mut provided=input["plan"].clone();provided["runId"]=json!("");
        if provided!=plan || plan["connectorKind"]!="PROTOCOL_PEER" { return Err(bad()); }
        let step=plan["steps"].as_array().and_then(|steps|steps.get(index)).ok_or_else(bad)?;
        let params=ae.parameters.as_ref().and_then(|value|value.get("params")).and_then(Params::from_json).ok_or_else(bad)?;
        let release=registration(params.component_release_registration.as_ref().ok_or_else(bad)?)?;
        let env=environment(&release)?;
        let contracts=active_contracts(&mut tx,ae.tenant_id,&release).await?;
        if plan["identityDigest"]!=collab_bridge::limits::canonical_digest(&env)
            || plan["contractDigests"]!=json!(contracts.iter().map(collab_bridge::limits::canonical_digest).collect::<Vec<_>>()) { return Err(bad()); }
        let key=format!("{}:mcp-probe:{index}:dispatch",ae.operation_id);
        let previous:bool=sqlx::query_scalar("select exists(select 1 from audit.audit_event where event_key=$1)")
            .bind(&key).fetch_one(&mut *tx).await?;
        if previous { return Err(unavailable()); }
        let def=crate::governance::exact_definition_for_execution(&state.pool,&ae).await?;
        crate::governance::audit(&mut tx,&ae,&def,&format!("mcp-probe:{index}:dispatch"),"DISPATCH","ALLOW","DISPATCH_RESULT_UNKNOWN",None,Vec::new()).await?;
        tx.commit().await?;
        let url=route(state,&ae,&release,&env).await?;
        let seconds=env["timeoutSeconds"].as_u64().ok_or_else(bad)?;
        let limit=usize::try_from(env["maxResponseBytes"].as_u64().ok_or_else(bad)?).map_err(|_|bad())?;
        let raw=tokio::time::timeout(std::time::Duration::from_secs(seconds),async {
            let service=transport::connect(url.as_str(),ae.id,seconds,limit,&[(transport::PROBE_HEADER,index.to_string()),(transport::RUN_HEADER,run.into())]).await?;
            let value=match text(step,"operation")? {
                "mcp_initialize"=>serde_json::to_value(service.peer_info().ok_or_else(bad)?.as_ref()).map_err(|_|bad())?,
                "mcp_list"=>serde_json::to_value(service.list_tools(None).await.map_err(|_|unavailable())?).map_err(|_|bad())?,
                "mcp_call"=>{
                    let request:rmcp::model::CallToolRequestParams=serde_json::from_str(text(step,"requestJson")?).map_err(|_|bad())?;
                    serde_json::to_value(service.call_tool(request).await.map_err(|_|unavailable())?).map_err(|_|bad())?
                },_=>return Err(bad()),
            };
            let _=service.cancel().await;
            Ok::<_,Refusal>(value)
        }).await.map_err(|_|unavailable())??;
        if serde_json::to_vec(&raw).map_err(|_|bad())?.len()>limit { return Err(bad()); }
        let request:Value=serde_json::from_str(text(step,"requestJson")?).map_err(|_|bad())?;
        let expected:Value=serde_json::from_str(text(step,"expectedResponseJson")?).map_err(|_|bad())?;
        let mut observed=json!({"caseKey":step["caseKey"],"stepKey":step["stepKey"],"operation":step["operation"],
            "requestDigest":collab_bridge::limits::canonical_digest(&request),"responseDigest":collab_bridge::limits::canonical_digest(&raw),
            "httpStatus":0,"mcpResultKind":"RESULT"});
        if step["operation"]=="mcp_call" {
            let result:rmcp::model::CallToolResult=serde_json::from_value(raw.clone()).map_err(|_|bad())?;
            if transport::result_value(&result)?!=expected { return Err(bad()); }
            observed["resultDigest"]=json!(collab_bridge::limits::canonical_digest(&expected));
        } else if raw!=expected { return Err(bad()); }
        let mut tx=state.pool.begin().await?;
        fresh_suite(state,&mut tx,&ae,run).await?;
        crate::governance::audit(&mut tx,&ae,&def,&format!("mcp-probe:{index}:result"),"RESULT","ALLOW","SUCCEEDED",None,Vec::new()).await?;
        tx.commit().await?;
        let typed:contracts::ComponentConformanceStepObservation=serde_json::from_value(observed).map_err(|_|bad())?;
        Ok::<_,Refusal>(typed)
    }.await;
    match result {
        Ok(value) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            axum::Json(value),
        )
            .into_response(),
        Err(error) => error.respond(None),
    }
}
