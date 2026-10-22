//! DD-134(5)：MCP 服务器向导的只读部分——部署交付目录、可连接的已批准 release 与
//! binding 归属事实草稿。
//!
//! 交付目录（`APPLICATION_ADAPTER_DIRECTORY_FILE` 的 `protocolPeers`）与一致性环境
//! （`COMPONENT_CONFORMANCE_ENVIRONMENT_FILE`）是运维域事实（DD-94(2)(5)、DD-98）：
//! 这里每次读取并呈现，从不写入；URL 去掉 userinfo、query 与 fragment，凭据只列键名。
//! 契约、release 与 binding 的写入只经既有 Governed Action（`05` §2.8）。

use std::collections::HashSet;

use axum::{
    extract::State,
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use contracts::{
    GatewayMcpBindingDraft, GatewayMcpBindingDraftRequest, GatewayMcpPeerPage,
    GatewayMcpReleasePage, ReasonCode,
};
use serde_json::{json, Value};
use uuid::Uuid;

use super::access::{caller, require_platform, require_tenant, Caller};
use super::mask::sanitize_url;
use crate::bff::BffState;
use crate::governance::Refusal;

const ISOLATION_MODES: [&str; 5] = [
    "DEDICATED_INSTANCE",
    "NATIVE_TENANT",
    "NAMESPACE",
    "RESOURCE_FILTER",
    "RESOURCE_INSTANCE",
];

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

/// 读取部署交付目录；未投递或不可读时为 `None`（向导显示确定状态，不猜默认值）。
pub(crate) fn directory() -> Option<Value> {
    let path = std::env::var("APPLICATION_ADAPTER_DIRECTORY_FILE").ok()?;
    let bytes = std::fs::read(path).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value.is_object().then_some(value)
}

/// 部署一致性环境的 artifact digest（PROTOCOL_PEER 分支）。
pub(crate) fn conformance_digest() -> Option<String> {
    let path = std::env::var("COMPONENT_CONFORMANCE_ENVIRONMENT_FILE").ok()?;
    let bytes = std::fs::read(path).ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("artifactDigest")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

pub(crate) fn peers_of(directory: &Value) -> Vec<&Value> {
    directory
        .get("protocolPeers")
        .and_then(Value::as_array)
        .map(|peers| peers.iter().collect())
        .unwrap_or_default()
}

/// 一条 binding 归属事实的呈现；不合契约枚举或缺字段的条目不呈现。
pub(crate) fn binding_fact(fact: &Value, bound: &HashSet<String>) -> Option<Value> {
    let text = |key: &str| fact.get(key).and_then(Value::as_str);
    let binding = Uuid::parse_str(text("bindingId")?).ok()?;
    let tenant = Uuid::parse_str(text("tenantId")?).ok()?;
    let service = Uuid::parse_str(text("servicePrincipalId")?).ok()?;
    let isolation = text("isolationMode").filter(|mode| ISOLATION_MODES.contains(mode))?;
    let keys: Vec<&str> = fact
        .get("nativeCredentials")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|credential| credential.get("secretKey").and_then(Value::as_str))
        .collect();
    let mut view = json!({"bindingId":binding,"tenantId":tenant,"servicePrincipalId":service,
        "nativeScopeRef":text("nativeScopeRef")?,"configDigest":text("configDigest")?,
        "isolationMode":isolation,"credentialKeys":keys,"bound":bound.contains(&binding.to_string())});
    if let Some(workspace) = text("workspaceId").and_then(|w| Uuid::parse_str(w).ok()) {
        view["workspaceId"] = json!(workspace);
    }
    Some(view)
}

/// 交付目录 peer → `GatewayMcpPeerView` 形状；`tenant` 给出时只保留该 Tenant 的归属事实。
pub(crate) fn peer_view(
    peer: &Value,
    conformance: Option<&str>,
    bound: &HashSet<String>,
    tenant: Option<Uuid>,
) -> Option<Value> {
    let text = |key: &str| peer.get(key).and_then(Value::as_str);
    let digest = text("artifactDigest")?;
    let facts: Vec<Value> = peer
        .get("bindings")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|fact| {
            tenant.is_none_or(|tenant| {
                fact.get("tenantId").and_then(Value::as_str) == Some(tenant.to_string().as_str())
            })
        })
        .filter_map(|fact| binding_fact(fact, bound))
        .collect();
    Some(
        json!({"adapterServiceRef":text("adapterServiceRef")?,"mcpUrl":sanitize_url(text("mcpUrl")?),
        "nativeInstanceRef":text("nativeInstanceRef")?,"artifactDigest":digest,
        "timeoutSeconds":peer.get("timeoutSeconds").and_then(Value::as_i64)?,
        "maxResponseBytes":peer.get("maxResponseBytes").and_then(Value::as_i64)?,
        "conformanceReady":conformance == Some(digest),"bindingFacts":facts}),
    )
}

async fn bound_ids(pool: &sqlx::PgPool) -> Result<HashSet<String>, Refusal> {
    let ids: Vec<Uuid> = sqlx::query_scalar("select id from catalog.application_binding")
        .fetch_all(pool)
        .await?;
    Ok(ids.into_iter().map(|id| id.to_string()).collect())
}

async fn peer_page(state: &BffState, caller: &Caller) -> Result<GatewayMcpPeerPage, Refusal> {
    require_platform(state, caller, "manage").await?;
    let conformance = conformance_digest();
    let mut value = json!({"directoryAvailable":false,"peers":[]});
    if let Some(directory) = directory() {
        let bound = bound_ids(&state.pool).await?;
        let peers: Vec<Value> = peers_of(&directory)
            .into_iter()
            .filter_map(|peer| peer_view(peer, conformance.as_deref(), &bound, None))
            .collect();
        value = json!({"directoryAvailable":true,"peers":peers});
    }
    if let Some(digest) = conformance {
        value["conformanceArtifactDigest"] = json!(digest);
    }
    serde_json::from_value(value)
        .map_err(|e| Refusal::Unavailable(format!("GatewayMcpPeerPage: {e}")))
}

/// `GET /api/v1/platform/gateway/mcp/peers`
pub(crate) async fn peers(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match peer_page(&state, &caller).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

#[derive(sqlx::FromRow)]
struct ReleaseRow {
    id: Uuid,
    component_type_key: String,
    version: String,
    status: String,
    adapter_build_ref: String,
    manifest: Value,
    binding_config_schema: Value,
    binding_ids: Vec<Uuid>,
}

/// release manifest → `GatewayMcpReleaseView` 形状（不含交付事实）。
pub(crate) fn release_view(
    row_manifest: &Value,
    id: Uuid,
    type_key: &str,
    version: &str,
    status: &str,
    adapter_build_ref: &str,
    binding_config_schema: &Value,
) -> Value {
    let categories: Vec<Value> = row_manifest
        .get("implements")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(json!({"category":item.get("categoryKey")?.as_str()?,
                "version":item.get("contractVersion")?.as_i64()?}))
        })
        .collect();
    let tools: Vec<Value> = row_manifest
        .get("toolDefinitions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|tool| {
            Some(json!({"name":tool.get("name")?.as_str()?,"actionKey":tool.get("actionKey")?.as_str()?,
                "capabilityContractKey":tool.get("capabilityContractKey")?.as_str()?}))
        })
        .collect();
    let secrets: Vec<&str> = row_manifest
        .get("secretSchema")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|secret| secret.get("secretKey").and_then(Value::as_str))
        .collect();
    let modes: Vec<&str> = row_manifest
        .get("allowedModelCallModes")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|mode| matches!(*mode, "PLATFORM_LLM_ROUTE" | "SELF_MANAGED_MODEL" | "NONE"))
        .collect();
    json!({"componentReleaseId":id,"componentTypeKey":type_key,"version":version,"status":status,
        "adapterBuildRef":adapter_build_ref,
        "bindingConfigSchemaJson":collab_bridge::limits::canonical_json(binding_config_schema),
        "capabilityCategories":categories,"tools":tools,"secretKeys":secrets,
        "allowedModelCallModes":modes,"deliveryFacts":[],"bindingIds":[]})
}

async fn release_page(state: &BffState, caller: &Caller) -> Result<GatewayMcpReleasePage, Refusal> {
    require_tenant(state, caller, None, "manage").await?;
    let tenant = caller.ctx.tenant_id;
    let rows: Vec<ReleaseRow> = sqlx::query_as(
        "select r.id,r.component_type_key,r.version,r.status,r.adapter_build_ref,r.manifest,r.binding_config_schema,
           coalesce(array(select b.id from catalog.application_binding b
             where b.component_release_id=r.id and b.tenant_id=$1 order by b.id),'{}') as binding_ids
         from catalog.component_release r
         where r.status='APPROVED' and r.manifest->>'class'='APPLICATION'
           and r.manifest->'executionConnector'->>'mode'='PROTOCOL_PEER'
         order by r.component_type_key,r.version",
    )
    .bind(tenant)
    .fetch_all(&state.pool)
    .await?;
    let directory = directory();
    let bound = bound_ids(&state.pool).await?;
    let mut releases = Vec::new();
    for row in rows {
        let mut view = release_view(
            &row.manifest,
            row.id,
            &row.component_type_key,
            &row.version,
            &row.status,
            &row.adapter_build_ref,
            &row.binding_config_schema,
        );
        view["bindingIds"] = json!(row.binding_ids);
        if let Some(peer) = directory.as_ref().and_then(|directory| {
            peers_of(directory).into_iter().find(|peer| {
                peer.get("artifactDigest").and_then(Value::as_str)
                    == Some(row.adapter_build_ref.as_str())
            })
        }) {
            if let Some(peer) = peer_view(peer, None, &bound, Some(tenant)) {
                view["adapterServiceRef"] = peer["adapterServiceRef"].clone();
                view["nativeInstanceRef"] = peer["nativeInstanceRef"].clone();
                view["deliveryFacts"] = peer["bindingFacts"].clone();
            }
        }
        releases.push(view);
    }
    serde_json::from_value(json!({"releases":releases}))
        .map_err(|e| Refusal::Unavailable(format!("GatewayMcpReleasePage: {e}")))
}

/// `GET /api/v1/gateway/mcp/releases`
pub(crate) async fn releases(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match release_page(&state, &caller).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

/// 交付目录 `protocolPeers[].bindings[]` 条目（`ApplicationProtocolPeerBindingDelivery`）。
pub(crate) fn draft_entry(
    binding: Uuid,
    tenant: Uuid,
    workspace: Option<Uuid>,
    service: Uuid,
    native_scope: &str,
    config_digest: &str,
    isolation: &str,
) -> Value {
    let mut entry = json!({"bindingId":binding,"tenantId":tenant,"servicePrincipalId":service,
        "nativeScopeRef":native_scope,"configDigest":config_digest,"isolationMode":isolation});
    if let Some(workspace) = workspace {
        entry["workspaceId"] = json!(workspace);
    }
    entry
}

async fn draft(
    state: &BffState,
    caller: &Caller,
    request: GatewayMcpBindingDraftRequest,
) -> Result<GatewayMcpBindingDraft, Refusal> {
    let request = serde_json::to_value(request).map_err(|_| invalid())?;
    let text = |key: &str| request.get(key).and_then(Value::as_str);
    let release = text("componentReleaseId")
        .and_then(|id| Uuid::parse_str(id).ok())
        .ok_or_else(invalid)?;
    let workspace = text("workspaceId")
        .map(|id| Uuid::parse_str(id).map_err(|_| invalid()))
        .transpose()?;
    let isolation = text("isolationMode")
        .filter(|mode| ISOLATION_MODES.contains(mode))
        .ok_or_else(invalid)?;
    let native_scope = text("nativeScopeRef")
        .filter(|scope| !scope.is_empty())
        .ok_or_else(invalid)?;
    let config: Value = serde_json::from_str(text("normalizedConfigJson").ok_or_else(invalid)?)
        .map_err(|_| invalid())?;
    if !config.is_object() {
        return Err(invalid());
    }
    require_tenant(state, caller, workspace, "manage").await?;
    let adapter_build_ref: Option<String> = sqlx::query_scalar(
        "select adapter_build_ref from catalog.component_release
         where id=$1 and status='APPROVED' and manifest->'executionConnector'->>'mode'='PROTOCOL_PEER'",
    )
    .bind(release)
    .fetch_optional(&state.pool)
    .await?;
    let adapter_build_ref =
        adapter_build_ref.ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
    // 端点必须已是交付目录中的运维域运行体（DD-94(5)）；草稿只补 binding 归属事实。
    let directory = directory().ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let adapter_service_ref = peers_of(&directory)
        .into_iter()
        .find(|peer| {
            peer.get("artifactDigest").and_then(Value::as_str) == Some(adapter_build_ref.as_str())
        })
        .and_then(|peer| peer.get("adapterServiceRef").and_then(Value::as_str))
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?
        .to_owned();
    let binding = Uuid::new_v4();
    let service = Uuid::new_v4();
    let config_digest = collab_bridge::limits::canonical_digest(&config);
    let entry = draft_entry(
        binding,
        caller.ctx.tenant_id,
        workspace,
        service,
        native_scope,
        &config_digest,
        isolation,
    );
    serde_json::from_value(json!({"bindingId":binding,"servicePrincipalId":service,
        "configDigest":config_digest,"adapterServiceRef":adapter_service_ref,
        "directoryEntryJson":collab_bridge::limits::canonical_json(&entry)}))
    .map_err(|e| Refusal::Unavailable(format!("GatewayMcpBindingDraft: {e}")))
}

/// `POST /api/v1/gateway/mcp/binding-drafts`：纯计算，不写任何状态。
pub(crate) async fn binding_draft(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<GatewayMcpBindingDraftRequest>,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match draft(&state, &caller, request).await {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directory_fixture(tenant: Uuid, other: Uuid, binding: Uuid) -> Value {
        json!({"adapters":[],"protocolPeers":[{
            "adapterServiceRef":"time-mcp","mcpUrl":"http://u:p@time-mcp:8080/mcp?debug=1",
            "nativeInstanceRef":"time-1","artifactDigest":"a".repeat(64),
            "timeoutSeconds":10,"maxResponseBytes":65536,
            "bindings":[
                {"bindingId":binding,"tenantId":tenant,"servicePrincipalId":Uuid::nil(),
                 "nativeScopeRef":"default","configDigest":"c".repeat(64),"isolationMode":"DEDICATED_INSTANCE",
                 "nativeCredentials":[{"secretKey":"token","locator":"tenants/x/kv/y","version":1,
                    "audience":"core","header":"Authorization","prefix":"Bearer "}]},
                {"bindingId":Uuid::new_v4(),"tenantId":other,"servicePrincipalId":Uuid::nil(),
                 "nativeScopeRef":"default","configDigest":"d".repeat(64),"isolationMode":"BOGUS"}]}]})
    }

    #[test]
    fn peers_hide_credentials_and_url_secrets_and_filter_tenant() {
        let tenant = Uuid::new_v4();
        let binding = Uuid::new_v4();
        let directory = directory_fixture(tenant, Uuid::new_v4(), binding);
        let bound: HashSet<String> = [binding.to_string()].into_iter().collect();
        let peer = peers_of(&directory)[0];
        let digest = "a".repeat(64);
        let all = peer_view(peer, Some(&digest), &bound, None).unwrap();
        assert_eq!(all["mcpUrl"], "http://time-mcp:8080/mcp");
        assert_eq!(all["conformanceReady"], true);
        // 非法枚举的条目不呈现
        assert_eq!(all["bindingFacts"].as_array().unwrap().len(), 1);
        let fact = &all["bindingFacts"][0];
        assert_eq!(fact["credentialKeys"], json!(["token"]));
        assert_eq!(fact["bound"], true);
        assert!(!all.to_string().contains("tenants/x/kv/y"));
        let scoped = peer_view(peer, None, &HashSet::new(), Some(Uuid::new_v4())).unwrap();
        assert!(scoped["bindingFacts"].as_array().unwrap().is_empty());
        assert_eq!(scoped["conformanceReady"], false);
    }

    #[test]
    fn release_view_reads_manifest_tools_and_categories() {
        let manifest = json!({"implements":[{"categoryKey":"clock","contractVersion":1}],
            "toolDefinitions":[{"name":"get_time","actionKey":"clock.now@v1","capabilityContractKey":"clock.now@v1"}],
            "secretSchema":[{"secretKey":"token"}],"allowedModelCallModes":["NONE"]});
        let view = release_view(
            &manifest,
            Uuid::nil(),
            "time-mcp",
            "1.0.0",
            "APPROVED",
            &"a".repeat(64),
            &json!({"type":"object"}),
        );
        assert_eq!(view["capabilityCategories"][0]["category"], "clock");
        assert_eq!(view["tools"][0]["capabilityContractKey"], "clock.now@v1");
        assert_eq!(view["secretKeys"], json!(["token"]));
        assert_eq!(view["bindingConfigSchemaJson"], r#"{"type":"object"}"#);
    }

    #[test]
    fn draft_entry_matches_directory_delivery_shape() {
        let tenant = Uuid::new_v4();
        let entry = draft_entry(
            Uuid::nil(),
            tenant,
            None,
            Uuid::nil(),
            "default",
            &"e".repeat(64),
            "DEDICATED_INSTANCE",
        );
        let typed: contracts::ApplicationProtocolPeerBindingDelivery =
            serde_json::from_value(entry.clone()).unwrap();
        assert_eq!(serde_json::to_value(typed).unwrap(), entry);
        assert!(entry.get("workspaceId").is_none());
    }
}
