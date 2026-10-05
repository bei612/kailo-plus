//! DD-12/58/94: native MCP remains native. Discovery goes through the original
//! Gateway and dual PEP, using the existing Core service identity and admitted
//! binding lifecycle. No Adapter token or synthetic native execution is sent.
use super::*;
use crate::service_api::ServiceState;
use rmcp::ServiceExt;

pub(crate) const HEADER: &str = "x-platform-binding-validation";
pub(crate) const PROBE_HEADER: &str = "x-platform-component-probe";
pub(crate) const RUN_HEADER: &str = "x-platform-component-run";

/// Standard MCP has both structured and text results. A text-only native result
/// remains a string; JSON-looking text is never guessed into an object. The
/// frozen capability output schema determines whether that value is usable.
pub(crate) fn result_value(result: &rmcp::model::CallToolResult) -> Result<Value, Refusal> {
    if result.is_error == Some(true) {
        return Err(blocked());
    }
    if let Some(value) = &result.structured_content {
        return Ok(value.clone());
    }
    let [content] = result.content.as_slice() else {
        return Err(blocked());
    };
    let text = content.as_text().ok_or_else(blocked)?;
    Ok(Value::String(text.text.clone()))
}

pub(crate) fn target(binding: Uuid, generation: i64) -> String {
    format!("application-validation-{binding}-{generation}")
}

pub(crate) async fn connect(
    url: &str,
    action: Uuid,
    seconds: u64,
    limit: usize,
    headers: &[(&str, String)],
) -> Result<rmcp::service::RunningService<rmcp::RoleClient, ()>, Refusal> {
    let bearer = crate::oidc::TokenSource::from_env()
        .map_err(|_| blocked())?
        .token()
        .await
        .map_err(|_| Refusal::Unavailable("Core MCP credential unavailable".into()))?;
    let client = mcp_http::Client::builder()
        .no_proxy()
        .redirect(mcp_http::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(seconds))
        .build()
        .map_err(|_| blocked())?;
    let mut config =
        rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig::with_uri(
            url.to_owned(),
        )
        .auth_header(bearer);
    config.allow_stateless = true;
    config.reinit_on_expired_session = false;
    config.max_sse_event_size = limit;
    config.custom_headers.insert(
        HEADER.parse().map_err(|_| invalid())?,
        action.to_string().parse().map_err(|_| invalid())?,
    );
    for (key, value) in headers {
        config.custom_headers.insert(
            key.parse().map_err(|_| invalid())?,
            value.parse().map_err(|_| invalid())?,
        );
    }
    ().serve(rmcp::transport::StreamableHttpClientTransport::with_client(
        client, config,
    ))
    .await
    .map_err(|_| Refusal::Unavailable("MCP initialize unknown".into()))
}

/// This service-only path grants discovery, never tools/call or a user result.
pub(crate) async fn authorize(
    state: &ServiceState,
    bearer: &str,
    action: Uuid,
    services: &[String],
    method: &str,
) -> Result<(Execution, i64), Refusal> {
    if !matches!(
        method,
        "initialize" | "notifications/initialized" | "ping" | "tools/list"
    ) {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    state
        .auth
        .verify_core_mcp(bearer)
        .await
        .map_err(|_| Refusal::Denied(ReasonCode::PermissionDenied))?;
    let ae = crate::governance::load_execution(&state.pool, action)
        .await?
        .ok_or_else(conflict)?;
    let row: Option<(i64,i32)> = sqlx::query_as(
        "select p.generation,b.version from catalog.application_binding b
         join projection.application_runtime p on p.binding_id=b.id and p.action_execution_id=b.projection_action_execution_id
         join catalog.component_release r on r.id=b.component_release_id and r.status='APPROVED'
         where b.id=$1 and b.tenant_id=$2 and b.workspace_id is not distinct from $3
           and b.state='PROVISIONING' and b.projection_action_execution_id=$4 and p.state='PENDING'
           and r.manifest->'executionConnector'->>'mode'='PROTOCOL_PEER'")
        .bind(ae.target_id).bind(ae.tenant_id).bind(ae.workspace_id).bind(ae.id)
        .fetch_optional(&state.pool).await?;
    let (generation, version) = row.ok_or_else(conflict)?;
    if ae.action_key != CREATE
        || ae.gate_state != "ALLOWED"
        || !matches!(ae.dispatch_state.as_str(), "UNKNOWN" | "DISPATCHED")
        || services != [target(ae.target_id, generation)]
    {
        return Err(conflict());
    }
    let definition = crate::governance::exact_definition_for_execution(&state.pool, &ae).await?;
    let decision = state
        .governance
        .evaluate(
            crate::governance::Actor {
                tenant_id: ae.tenant_id,
                principal_id: ae.initiator_principal_id,
                human_identity_id: None,
            },
            &definition,
            &Target {
                id: ae.target_id,
                version,
                workspace_id: ae.workspace_id,
            },
        )
        .await?;
    if !decision.allowed {
        return Err(Refusal::Denied(
            decision.reason.unwrap_or(ReasonCode::PermissionDenied),
        ));
    }
    Ok((ae, generation))
}

pub(super) async fn validate(
    state: &ServiceState,
    ae: &Execution,
    binding: &Value,
    manifest: &Value,
) -> Result<Value, Refusal> {
    let delivered = native::Adapter::resolve(
        text(binding, "adapterServiceRef")?,
        text(binding, "nativeInstanceRef")?,
        manifest,
    )?;
    let matches: Vec<_> = delivered.value["bindings"]
        .as_array()
        .ok_or_else(blocked)?
        .iter()
        .filter(|value| value["bindingId"] == binding["bindingId"])
        .collect();
    let [fact] = matches.as_slice() else {
        return Err(blocked());
    };
    for field in [
        "bindingId",
        "tenantId",
        "servicePrincipalId",
        "configDigest",
        "isolationMode",
    ] {
        if fact[field] != binding[field] {
            return Err(blocked());
        }
    }
    if fact.get("workspaceId") != binding.get("workspaceId")
        || binding
            .get("nativeScopeRef")
            .is_some_and(|scope| scope != &fact["nativeScopeRef"])
        || text(fact, "nativeScopeRef").is_err()
        || binding["secretRefs"] != json!([])
        || manifest["secretSchema"] != json!([])
    {
        return Err(blocked());
    }
    let generation: i64 = sqlx::query_scalar(
        "select generation from projection.application_runtime
        where binding_id=$1 and action_execution_id=$2 and state='PENDING'",
    )
    .bind(ae.target_id)
    .bind(ae.id)
    .fetch_one(&state.pool)
    .await?;
    let url = gateway::publish_validation(state, ae, generation, &delivered).await?;
    let seconds = delivered.value["timeoutSeconds"]
        .as_u64()
        .ok_or_else(invalid)?;
    let limit = usize::try_from(
        delivered.value["maxResponseBytes"]
            .as_u64()
            .ok_or_else(invalid)?,
    )
    .map_err(|_| invalid())?;
    let observed = tokio::time::timeout(std::time::Duration::from_secs(seconds), async {
        let service = connect(url.as_str(), ae.id, seconds, limit, &[]).await?;
        let info = service.peer_info().ok_or_else(blocked)?;
        if info.capabilities.tools.is_none() {
            return Err(blocked());
        }
        let listed = service
            .list_tools(None)
            .await
            .map_err(|_| Refusal::Unavailable("MCP discovery unknown".into()))?;
        if listed.next_cursor.is_some() {
            return Err(blocked());
        }
        let bytes = serde_json::to_vec(&listed).map_err(|_| invalid())?;
        if bytes.len() > limit {
            return Err(blocked());
        }
        let _ = service.cancel().await;
        Ok(listed)
    })
    .await
    .map_err(|_| Refusal::Unavailable("MCP discovery unknown".into()))??;
    let mut conn = state.pool.acquire().await?;
    validate_tools(&mut conn, manifest, &observed).await?;
    // Deployment facts bind the existing native instance/scope; initialize/list
    // proves the exact route actually serves the approved native schemas. Neither
    // successful HTTP nor readOnlyHint independently establishes either fact.
    Ok(
        json!({"bindingId":binding["bindingId"],"tenantId":binding["tenantId"],
        "workspaceId":binding.get("workspaceId"),"nativeInstanceRef":binding["nativeInstanceRef"],
        "nativeScopeRef":fact["nativeScopeRef"],"configDigest":binding["configDigest"],
        "isolationMode":binding["isolationMode"],"artifactDigest":manifest["adapterBuildRef"],
        "secretRefDigest":collab_bridge::limits::canonical_digest(&binding["secretRefs"]),
        "protocol":"MCP","toolSchemaDigest":collab_bridge::limits::canonical_digest(&serde_json::to_value(observed).map_err(|_| invalid())?)}),
    )
}

async fn validate_tools(
    conn: &mut PgConnection,
    manifest: &Value,
    native: &rmcp::model::ListToolsResult,
) -> Result<(), Refusal> {
    let mut seen = BTreeSet::new();
    if native
        .tools
        .iter()
        .any(|tool| !seen.insert(tool.name.to_string()))
    {
        return Err(invalid());
    }
    for tool in manifest["toolDefinitions"].as_array().ok_or_else(invalid)? {
        let found = native
            .tools
            .iter()
            .find(|candidate| Some(candidate.name.as_ref()) == tool["name"].as_str())
            .ok_or_else(blocked)?;
        let documents: Vec<Value> = sqlx::query_scalar(
            "select c.schema_documents from catalog.capability_contract c
            join catalog.capability_category category on category.category_key=c.category_key
              and category.catalog_tenant_id=c.catalog_tenant_id and category.status='ACTIVE'
            where c.status='ACTIVE' and exists(select 1 from jsonb_array_elements($2::jsonb) frozen
                where frozen->>'categoryKey'=c.category_key
                  and frozen->>'contractVersion'=c.contract_version::text)
              and exists(select 1 from jsonb_array_elements(c.content->'operationContracts') op
                where op->>'contractKey'=$1)",
        )
        .bind(text(tool, "capabilityContractKey")?)
        .bind(&manifest["implements"])
        .fetch_all(&mut *conn)
        .await?;
        if documents.len() != 1 {
            return Err(blocked());
        }
        let schemas: Vec<_> = documents
            .iter()
            .flat_map(|value| value.as_array().into_iter().flatten())
            .filter(|value| value["digest"] == tool["inputSchemaHash"])
            .collect();
        if schemas.len() != 1
            || collab_bridge::limits::canonical_digest(&schemas[0]["schema"])
                != tool["inputSchemaHash"]
            || serde_json::to_value(&found.input_schema).map_err(|_| invalid())?
                != schemas[0]["schema"]
        {
            return Err(blocked());
        }
    }
    Ok(())
}

#[cfg(test)]
mod native_peer_tests {
    use super::*;

    #[test]
    fn native_result_preserves_standard_mcp_value_without_adapter_envelope() {
        let native = rmcp::model::CallToolResult::success(vec![rmcp::model::ContentBlock::text(
            "{\"rows\":[1]}",
        )]);
        assert_eq!(result_value(&native).unwrap(), json!("{\"rows\":[1]}"));
        let structured = rmcp::model::CallToolResult::structured(json!({"rows":[1]}));
        assert_eq!(result_value(&structured).unwrap(), json!({"rows":[1]}));
        assert!(result_value(&rmcp::model::CallToolResult::error(vec![
            rmcp::model::ContentBlock::text("denied")
        ]))
        .is_err());
        assert!(result_value(&rmcp::model::CallToolResult::success(vec![])).is_err());
        assert!(result_value(&rmcp::model::CallToolResult::success(vec![
            rmcp::model::ContentBlock::text("a"),
            rmcp::model::ContentBlock::text("b")
        ]))
        .is_err());
    }

    #[test]
    fn synchronous_native_result_cannot_admit_a_queryable_or_metered_job() {
        let action = json!({"executionMode":"SYNC","workflowType":"NONE","quotaPolicy":"NONE","meters":[],
            "businessObservabilityPolicy":{"terminalSource":"SYNC_RESULT","progressSource":"NONE","usageSource":"NONE","costSource":"NONE"}});
        native::Connector::ProtocolPeer
            .validate_action(&action)
            .unwrap();
        for (field, value) in [
            ("executionMode", json!("TEMPORAL")),
            ("quotaPolicy", json!("BUDGET")),
            ("meters", json!(["query.count"])),
        ] {
            let mut changed = action.clone();
            changed[field] = value;
            assert!(native::Connector::ProtocolPeer
                .validate_action(&changed)
                .is_err());
        }
        for field in [
            "terminalSource",
            "progressSource",
            "usageSource",
            "costSource",
        ] {
            let mut changed = action.clone();
            changed["businessObservabilityPolicy"][field] = json!("NATIVE_STATUS");
            assert!(native::Connector::ProtocolPeer
                .validate_action(&changed)
                .is_err());
        }
    }
}
