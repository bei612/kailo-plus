//! DD-134(5)② 受控探测：平台管理员为交付目录中的一个 `protocolPeers` 条目经
//! Gateway 调用 `initialize` 与 `tools/list`，用于在登记 release 前选择或登记能力契约。
//!
//! 探测是只读查询，不是 Governed Action（`01` §4）：不创建 release、Tool 或
//! Resource，不改任何 Catalog 状态。它只接受交付目录（DD-94(2)(5) 的运维域事实）
//! 中的条目引用，不接受 URL，因此 Gateway 不会连接目录以外的端点。临时 route 与
//! binding 验证 route 同形：Core 专用受众的 bearer（DD-137，Gateway 校验后即移除，
//! 不到达 peer）、ExtMcp failClosed、只放行
//! `initialize`、`ping`、`notifications/initialized` 与不翻页的 `tools/list`；探测结束
//! 即删除并回读不存在。每次探测持久一行 `projection.gateway_mcp_probe`（ExtMcp
//! 以它判定请求）并写两条 `ACCESS` 审计，不保存 initialize/tools/list 正文。

use axum::{
    extract::{rejection::JsonRejection, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use serde_json::{json, Value};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState, ExecutionContext},
    governance::Refusal,
    service_api::ServiceState,
    spicedb::Consistency,
};

/// 探测 route 上请求携带的探测 ID；ExtMcp 据此只走探测判定分支。
pub(crate) const HEADER: &str = "x-platform-gateway-probe";
const ACTION_KEY: &str = "gateway.mcp.probe";
/// 探测记录的有效期在 peer 超时之上留出发布与回读 route 的余量。
const ROUTE_MARGIN_SECONDS: u64 = 60;

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn denied() -> Refusal {
    Refusal::Denied(ReasonCode::PermissionDenied)
}
fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}
fn unavailable() -> Refusal {
    Refusal::Unavailable("gateway MCP probe unavailable".into())
}

pub(crate) fn target(probe: Uuid) -> String {
    format!("gateway-probe-{probe}")
}

/// 交付目录中一条 `protocolPeers` 的传输事实（不含凭据）。
pub(crate) struct PeerDelivery {
    pub(crate) mcp_url: reqwest::Url,
    pub(crate) native_instance_ref: String,
    pub(crate) artifact_digest: String,
    pub(crate) timeout_seconds: u64,
    pub(crate) max_response_bytes: usize,
}

fn checked_url(raw: &str) -> Result<reqwest::Url, Refusal> {
    let url = reqwest::Url::parse(raw).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(invalid());
    }
    Ok(url)
}

fn peer_entry(directory: &Value, reference: &str) -> Result<PeerDelivery, Refusal> {
    let entries = directory
        .get("protocolPeers")
        .and_then(Value::as_array)
        .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    let matching: Vec<_> = entries
        .iter()
        .filter(|entry| entry["adapterServiceRef"] == reference)
        .collect();
    let [entry] = matching.as_slice() else {
        return Err(Refusal::Precondition(ReasonCode::TargetNotFound));
    };
    let text = |key: &str| {
        entry[key]
            .as_str()
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(invalid)
    };
    let timeout_seconds = entry["timeoutSeconds"]
        .as_u64()
        .filter(|value| *value > 0)
        .ok_or_else(invalid)?;
    let max_response_bytes = entry["maxResponseBytes"]
        .as_u64()
        .filter(|value| *value > 0)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(invalid)?;
    Ok(PeerDelivery {
        mcp_url: checked_url(&text("mcpUrl")?)?,
        native_instance_ref: text("nativeInstanceRef")?,
        artifact_digest: text("artifactDigest")?,
        timeout_seconds,
        max_response_bytes,
    })
}

/// 读取部署交付目录（每次读取文件，不缓存）；只解析 typed 合同能无损往返的文件。
pub(crate) fn peer_delivery(reference: &str) -> Result<PeerDelivery, Refusal> {
    let path = std::env::var("APPLICATION_ADAPTER_DIRECTORY_FILE").map_err(|_| blocked())?;
    let bytes = std::fs::read(path)
        .map_err(|_| Refusal::Unavailable("adapter directory unavailable".into()))?;
    let typed: contracts::ApplicationAdapterDirectory =
        serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let directory = serde_json::to_value(typed).map_err(|_| invalid())?;
    if serde_json::from_slice::<Value>(&bytes).map_err(|_| invalid())? != directory {
        return Err(invalid());
    }
    peer_entry(&directory, reference)
}

/// Core 以专用 Core MCP 受众的 service 令牌（DD-137）经 Gateway 建立 MCP 会话；
/// `header` 决定 ExtMcp 的判定分支。
pub(crate) async fn core_client(
    url: &str,
    header: (&str, String),
    seconds: u64,
    limit: usize,
) -> Result<rmcp::service::RunningService<rmcp::RoleClient, ()>, Refusal> {
    use rmcp::ServiceExt;
    let bearer = crate::oidc::TokenSource::core_mcp()
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
        header.0.parse().map_err(|_| invalid())?,
        header.1.parse().map_err(|_| invalid())?,
    );
    ().serve(rmcp::transport::StreamableHttpClientTransport::with_client(
        client, config,
    ))
    .await
    .map_err(|_| Refusal::Unavailable("MCP initialize unknown".into()))
}

/// 只由 Core 调用、ExtMcp 双相把守的临时 route 的可变部分。
pub(crate) struct TemporaryRoute<'a> {
    pub(crate) id: &'a str,
    pub(crate) path: [&'a str; 2],
    pub(crate) header: &'a str,
    pub(crate) rules: Vec<String>,
    pub(crate) methods: Value,
    pub(crate) metadata: Value,
    pub(crate) native_target: Value,
}

/// 发布临时 route 并回读确认已生效（stored 与 effective 都等于期望值）。
pub(crate) async fn publish_route(
    state: &ServiceState,
    spec: TemporaryRoute<'_>,
) -> Result<reqwest::Url, Refusal> {
    let signer = state.agent_tool_sessions.as_ref().ok_or_else(blocked)?;
    let service = state.gateway_service_auth.as_ref().ok_or_else(blocked)?;
    let mut url = signer.gateway_url().clone();
    url.path_segments_mut()
        .map_err(|_| invalid())?
        .pop_if_empty()
        .extend(spec.path);
    let route = json!({"name":spec.id,"gateways":[signer.gateway_name()],"matches":[{"path":{"exact":url.path()}}],
        "policies":{"jwtAuth":state.auth.core_mcp_authentication().map_err(|_| blocked())?,
            "mcpAuthorization":{"rules":spec.rules},
            "mcpGuardrails":{"processors":[{"kind":"remote","host":service.ext_mcp_url().as_str(),
                "policies":{"backendAuth":service.backend_auth()},"failureMode":"failClosed",
                "methods":spec.methods,"requestHeaders":{"allowed":["authorization",spec.header]},
                "metadata":core_mcp_metadata(spec.metadata)?}]}},
        "backends":[{"mcp":{"statefulMode":"stateless","prefixMode":"conditional","failureMode":"failClosed",
            "targets":[spec.native_target]}}]});
    let gateway = crate::model_route::Gateway::from_env()?;
    gateway
        .admin(
            &["api", "config", "resources", "traffic.route"],
            Some(json!({"resources":[{"value":route}]})),
        )
        .await?;
    crate::agent_tool_runtime::require_route(&gateway, spec.id, Some(&route)).await?;
    Ok(url)
}

/// 管理 route 的 ExtMcp 元数据：调用方各自的判定键，加上 Gateway 已验证的 Core 身份
/// claims（DD-137(4)）。bearer 已由 `preserveToken: false` 移除；`authorization` 仍在
/// requestHeaders 中只为让 ExtMcp 发现未剥离令牌的 route 并拒绝。
pub(crate) fn core_mcp_metadata(mut metadata: Value) -> Result<Value, Refusal> {
    let (key, expression) = crate::service_auth::CORE_MCP_METADATA;
    let object = metadata.as_object_mut().ok_or_else(invalid)?;
    if object.insert(key.into(), json!(expression)).is_some() {
        return Err(invalid());
    }
    Ok(metadata)
}

/// 删除临时 route 并回读不存在；删除已不存在的 route 也成功。
pub(crate) async fn remove_route(id: &str) -> Result<(), Refusal> {
    let gateway = crate::model_route::Gateway::from_env()?;
    gateway.delete("traffic.route", id).await?;
    crate::agent_tool_runtime::require_route(&gateway, id, None).await
}

pub(crate) async fn run(
    State(state): State<BffState>,
    headers: HeaderMap,
    body: Result<Json<contracts::GatewayMcpProbeRequest>, JsonRejection>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let Ok(Json(request)) = body else {
        return invalid().respond(None);
    };
    match probe(&state, &ctx, &request.adapter_service_ref).await {
        Ok(result) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(result),
        )
            .into_response(),
        Err((error, operation)) => error.respond(operation),
    }
}

/// Catalog 会话、active HUMAN 与 fresh Catalog Tenant `audit`（区级门槛）及 `manage`（DD-134(2)①）。
async fn admit(state: &BffState, ctx: &ExecutionContext) -> Result<(), Refusal> {
    if ctx.access_mode != contracts::PlatformSessionAccessMode::Full {
        return Err(denied());
    }
    let mut tx = state.pool.begin().await?;
    if !crate::platform_bootstrap::is_catalog_tenant(&mut tx, ctx.tenant_id).await?
        || !crate::agent_definition::active_owner(&mut tx, ctx.tenant_id, ctx.tenant_principal_id)
            .await?
    {
        return Err(denied());
    }
    tx.commit().await?;
    for permission in ["audit", "manage"] {
        let checked = state
            .governance
            .spicedb
            .check(
                "tenant",
                &ctx.tenant_id.to_string(),
                permission,
                &ctx.tenant_principal_id.to_string(),
                Consistency::FullyConsistent,
            )
            .await
            .map_err(|_| unavailable())?;
        if checked.zed_token.is_empty() {
            return Err(unavailable());
        }
        if !checked.allowed {
            return Err(denied());
        }
    }
    Ok(())
}

struct AccessFact<'a> {
    stage: &'a str,
    decision: &'a str,
    result: &'a str,
}

async fn access_audit(
    state: &BffState,
    ctx: &ExecutionContext,
    probe: Uuid,
    parameter_hash: &str,
    fact: AccessFact<'_>,
) -> Result<(), Refusal> {
    let mut tx = state.pool.begin().await?;
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("gateway-probe:{probe}:{}", fact.stage),
            tenant_id: Some(ctx.tenant_id),
            workspace_id: None,
            operation_id: probe,
            event_type: "ACCESS",
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: ACTION_KEY,
            action_version: 1,
            component_type_key: "core",
            target_type: None,
            target_id: None,
            parameter_hash,
            decision: fact.decision,
            result_code: fact.result,
            result_exposure: "NONE",
            evidence_refs: Vec::new(),
            correlation_id: probe,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

fn outcome_of(
    observed: &Result<(Value, Value), Refusal>,
    removed: &Result<(), Refusal>,
) -> &'static str {
    match (observed, removed) {
        (Ok(_), Ok(())) => "SUCCEEDED",
        (Err(Refusal::Unavailable(_)), _) | (_, Err(_)) => "UNKNOWN",
        (Err(_), Ok(())) => "FAILED",
    }
}

async fn probe(
    state: &BffState,
    ctx: &ExecutionContext,
    reference: &str,
) -> Result<Value, (Refusal, Option<Uuid>)> {
    admit(state, ctx).await.map_err(|error| (error, None))?;
    let delivery = peer_delivery(reference).map_err(|error| (error, None))?;
    let service = &state.memory_service;
    if service.agent_tool_sessions.is_none() || service.gateway_service_auth.is_none() {
        return Err((blocked(), None));
    }
    let id = Uuid::new_v4();
    let route_id = target(id);
    // 参数摘要只固定目录引用与原生运行体身份，不含凭据或正文。
    let parameter_hash = collab_bridge::limits::canonical_digest(&json!({
        "adapterServiceRef":reference,"artifactDigest":delivery.artifact_digest,
        "nativeInstanceRef":delivery.native_instance_ref,"mcpUrl":delivery.mcp_url.as_str()}));
    let window = delivery
        .timeout_seconds
        .saturating_add(ROUTE_MARGIN_SECONDS) as f64;
    let opened = async {
        let mut tx = state.pool.begin().await?;
        // 同一端点同时只有一个未结束的探测；过期未结束的记录不再放行任何请求。
        let busy: bool = sqlx::query_scalar(
            "select exists(select 1 from projection.gateway_mcp_probe
            where adapter_service_ref=$1 and completed_at is null and expires_at>now())",
        )
        .bind(reference)
        .fetch_one(&mut *tx)
        .await?;
        if busy {
            return Err(Refusal::Conflict(ReasonCode::TargetStateConflict));
        }
        sqlx::query(
            "insert into projection.gateway_mcp_probe
            (id,tenant_id,principal_id,adapter_service_ref,route_id,expires_at)
            values($1,$2,$3,$4,$5,now()+make_interval(secs=>$6))",
        )
        .bind(id)
        .bind(ctx.tenant_id)
        .bind(ctx.tenant_principal_id)
        .bind(reference)
        .bind(&route_id)
        .bind(window)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        access_audit(
            state,
            ctx,
            id,
            &parameter_hash,
            AccessFact {
                stage: "admitted",
                decision: "ALLOW",
                result: "MCP_PROBE_ADMITTED",
            },
        )
        .await
    }
    .await;
    opened.map_err(|error| (error, Some(id)))?;

    let observed = observe(service, id, &route_id, &delivery).await;
    // route 无论成败都删除；删除未回读确认即整体结果不明。
    let removed = remove_route(&route_id).await;
    let outcome = outcome_of(&observed, &removed);
    let digest = match (&observed, outcome) {
        (Ok((_, listed)), "SUCCEEDED") => Some(collab_bridge::limits::canonical_digest(listed)),
        _ => None,
    };
    let result_code = format!("MCP_PROBE_{outcome}");
    let closed = async {
        sqlx::query(
            "update projection.gateway_mcp_probe set completed_at=now(),outcome=$2,
            tool_schema_digest=$3 where id=$1 and completed_at is null",
        )
        .bind(id)
        .bind(outcome)
        .bind(&digest)
        .execute(&state.pool)
        .await?;
        access_audit(
            state,
            ctx,
            id,
            &parameter_hash,
            AccessFact {
                stage: "result",
                decision: if outcome == "SUCCEEDED" {
                    "ALLOW"
                } else {
                    "NONE"
                },
                result: &result_code,
            },
        )
        .await
    }
    .await;
    closed.map_err(|error| (error, Some(id)))?;
    removed.map_err(|error| (error, Some(id)))?;
    let (info, listed) = observed.map_err(|error| (error, Some(id)))?;
    let mut conn = state
        .pool
        .acquire()
        .await
        .map_err(|error| (error.into(), Some(id)))?;
    let mut tools = Vec::new();
    for tool in listed["tools"].as_array().into_iter().flatten() {
        tools.push(
            probed_tool(&mut conn, tool)
                .await
                .map_err(|error| (error, Some(id)))?,
        );
    }
    let mut result = json!({"probeId":id,"adapterServiceRef":reference,
        "probedAt":chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        "toolSchemaDigest":digest.unwrap_or_default(),"tools":tools});
    for (field, pointer) in [
        ("serverName", "/serverInfo/name"),
        ("serverVersion", "/serverInfo/version"),
        ("protocolVersion", "/protocolVersion"),
    ] {
        if let Some(value) = info.pointer(pointer).and_then(Value::as_str) {
            result[field] = json!(value);
        }
    }
    let typed: contracts::GatewayMcpProbeResult =
        serde_json::from_value(result).map_err(|_| (invalid(), Some(id)))?;
    serde_json::to_value(typed).map_err(|_| (invalid(), Some(id)))
}

/// 发布探测 route，经 Gateway 取得 initialize 与 tools/list。
async fn observe(
    service: &ServiceState,
    id: Uuid,
    route_id: &str,
    delivery: &PeerDelivery,
) -> Result<(Value, Value), Refusal> {
    let probe = id.to_string();
    let url = publish_route(
        service,
        TemporaryRoute {
            id: route_id,
            path: ["gateway-probe", &probe],
            header: HEADER,
            rules: vec![
                "mcp.methodName in ['initialize', 'ping', 'notifications/initialized', 'tools/list']"
                    .into(),
            ],
            methods: json!({"*":"request","initialize":"full","ping":"full","tools/list":"full"}),
            metadata: json!({"gatewayProbe":"has(mcpGuardrails.gatewayProbe) ? mcpGuardrails.gatewayProbe : ''"}),
            native_target: json!({"name":route_id,"mcp":{"host":delivery.mcp_url.as_str()}}),
        },
    )
    .await?;
    let seconds = delivery.timeout_seconds;
    let limit = delivery.max_response_bytes;
    tokio::time::timeout(std::time::Duration::from_secs(seconds), async {
        let client = core_client(url.as_str(), (HEADER, probe.clone()), seconds, limit).await?;
        let info = serde_json::to_value(client.peer_info().ok_or_else(blocked)?.as_ref())
            .map_err(|_| invalid())?;
        if info.pointer("/capabilities/tools").is_none() {
            return Err(blocked());
        }
        let listed = client
            .list_tools(None)
            .await
            .map_err(|_| Refusal::Unavailable("MCP discovery unknown".into()))?;
        if listed.next_cursor.is_some() {
            return Err(blocked());
        }
        let listed = serde_json::to_value(listed).map_err(|_| invalid())?;
        if serde_json::to_vec(&listed).map_err(|_| invalid())?.len() > limit {
            return Err(blocked());
        }
        let _ = client.cancel().await;
        Ok::<_, Refusal>((info, listed))
    })
    .await
    .map_err(|_| Refusal::Unavailable("MCP discovery unknown".into()))?
}

/// 工具元数据与 ACTIVE 契约中输入 schema 摘要一致的 TOOL 契约键（摘要口径与
/// `capability_contract` 登记、`application_binding::peer::validate_tools` 相同：
/// schema 正文的 canonical digest）。
async fn probed_tool(conn: &mut sqlx::PgConnection, tool: &Value) -> Result<Value, Refusal> {
    let name = tool["name"].as_str().ok_or_else(invalid)?;
    let input = tool.get("inputSchema").ok_or_else(invalid)?;
    let input_digest = collab_bridge::limits::canonical_digest(input);
    let matches: Vec<(String, i32, String, String)> = sqlx::query_as(
        "select c.category_key,c.contract_version,op->>'contractKey',op->>'permission'
        from catalog.capability_contract c
        join catalog.capability_category category on category.category_key=c.category_key
          and category.catalog_tenant_id=c.catalog_tenant_id and category.status='ACTIVE'
        cross join lateral jsonb_array_elements(c.content->'operationContracts') op
        where c.status='ACTIVE' and op->>'surface'='TOOL' and op->>'inputSchemaDigest'=$1
          and exists(select 1 from jsonb_array_elements(c.schema_documents) doc
            where doc->>'digest'=$1)
        order by c.category_key,c.contract_version,op->>'contractKey'",
    )
    .bind(&input_digest)
    .fetch_all(conn)
    .await?;
    let mut value = json!({"name":name,
        "inputSchemaJson":collab_bridge::limits::canonical_json(input),
        "inputSchemaDigest":input_digest,
        "matchingContracts":matches.into_iter().map(|(category, version, key, permission)| json!({
            "categoryKey":category,"contractVersion":version,"contractKey":key,"permission":permission}))
            .collect::<Vec<_>>()});
    if let Some(title) = tool["title"].as_str() {
        value["displayTitle"] = json!(title);
    }
    if let Some(description) = tool["description"].as_str() {
        value["description"] = json!(description);
    }
    if let Some(output) = tool.get("outputSchema").filter(|output| !output.is_null()) {
        value["outputSchemaJson"] = json!(collab_bridge::limits::canonical_json(output));
        value["outputSchemaDigest"] = json!(collab_bridge::limits::canonical_digest(output));
    }
    if let Some(read_only) = tool
        .pointer("/annotations/readOnlyHint")
        .and_then(Value::as_bool)
    {
        value["readOnlyHint"] = json!(read_only);
    }
    Ok(value)
}

/// ExtMcp 两相共用的探测判定：Gateway 已验证的 Core 身份（DD-137(4)）、未结束且未
/// 过期的探测记录、目标只是该探测的 route、方法只限发现类。
pub(crate) async fn authorize(
    state: &ServiceState,
    caller: &Value,
    probe: Uuid,
    services: &[String],
    method: &str,
) -> Result<(), Refusal> {
    if !discovery_method(method) {
        return Err(denied());
    }
    state
        .auth
        .verify_core_mcp_claims(caller)
        .map_err(|_| denied())?;
    let route: Option<String> = sqlx::query_scalar(
        "select route_id from projection.gateway_mcp_probe
        where id=$1 and completed_at is null and expires_at>now()",
    )
    .bind(probe)
    .fetch_optional(&state.pool)
    .await?;
    if !route_matches(route.as_deref(), probe, services) {
        return Err(denied());
    }
    Ok(())
}

fn discovery_method(method: &str) -> bool {
    matches!(
        method,
        "initialize" | "notifications/initialized" | "ping" | "tools/list"
    )
}

fn route_matches(stored: Option<&str>, probe: Uuid, services: &[String]) -> bool {
    let expected = target(probe);
    stored == Some(expected.as_str()) && services == [expected]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_is_discovery_only() {
        for method in [
            "initialize",
            "notifications/initialized",
            "ping",
            "tools/list",
        ] {
            assert!(discovery_method(method), "{method}");
        }
        for method in ["tools/call", "resources/read", "prompts/get", ""] {
            assert!(!discovery_method(method), "{method}");
        }
    }

    #[test]
    fn probe_route_must_be_its_own_route_only() {
        let probe = Uuid::new_v4();
        let own = target(probe);
        assert!(route_matches(Some(&own), probe, std::slice::from_ref(&own)));
        assert!(!route_matches(None, probe, std::slice::from_ref(&own)));
        assert!(!route_matches(Some(&own), probe, &[]));
        assert!(!route_matches(
            Some(&own),
            probe,
            &[own.clone(), "application-x-1".into()]
        ));
        let other = target(Uuid::new_v4());
        assert!(!route_matches(
            Some(&other),
            probe,
            std::slice::from_ref(&other)
        ));
    }

    #[test]
    fn management_metadata_carries_verified_claims_not_a_bearer() {
        let metadata =
            core_mcp_metadata(json!({"gatewayProbe":"has(mcpGuardrails.gatewayProbe) ? mcpGuardrails.gatewayProbe : ''"}))
                .unwrap();
        let (key, expression) = crate::service_auth::CORE_MCP_METADATA;
        assert_eq!(metadata[key], json!(expression));
        for value in metadata.as_object().unwrap().values() {
            let value = value.as_str().unwrap();
            assert!(
                !value.contains("authorization") && !value.contains("Bearer"),
                "{value}"
            );
        }
        assert!(core_mcp_metadata(json!({key: "forged"})).is_err());
        assert!(core_mcp_metadata(json!([])).is_err());
    }

    #[test]
    fn outcome_separates_unknown_from_refusal() {
        let ok: Result<(Value, Value), Refusal> = Ok((json!({}), json!({})));
        let refused: Result<(Value, Value), Refusal> = Err(blocked());
        let unknown: Result<(Value, Value), Refusal> = Err(unavailable());
        assert_eq!(outcome_of(&ok, &Ok(())), "SUCCEEDED");
        assert_eq!(outcome_of(&ok, &Err(unavailable())), "UNKNOWN");
        assert_eq!(outcome_of(&refused, &Ok(())), "FAILED");
        assert_eq!(outcome_of(&unknown, &Ok(())), "UNKNOWN");
    }

    #[test]
    fn directory_entry_is_exact_and_url_is_bare() {
        let directory = json!({"adapters":[],"protocolPeers":[{"adapterServiceRef":"time",
            "mcpUrl":"http://time-mcp:8080/mcp","nativeInstanceRef":"time-1","artifactDigest":"sha256:a",
            "timeoutSeconds":10,"maxResponseBytes":65536,"bindings":[]}]});
        let entry = peer_entry(&directory, "time").unwrap();
        assert_eq!(entry.mcp_url.as_str(), "http://time-mcp:8080/mcp");
        assert_eq!(entry.timeout_seconds, 10);
        assert!(peer_entry(&directory, "other").is_err());
        for url in [
            "ftp://time-mcp/mcp",
            "http://user:pw@time-mcp/mcp",
            "http://time-mcp/mcp?x=1",
            "http://time-mcp/mcp#f",
        ] {
            let mut changed = directory.clone();
            changed["protocolPeers"][0]["mcpUrl"] = json!(url);
            assert!(peer_entry(&changed, "time").is_err(), "{url}");
        }
        let mut duplicated = directory.clone();
        let copy = duplicated["protocolPeers"][0].clone();
        duplicated["protocolPeers"]
            .as_array_mut()
            .unwrap()
            .push(copy);
        assert!(peer_entry(&duplicated, "time").is_err());
    }
}
