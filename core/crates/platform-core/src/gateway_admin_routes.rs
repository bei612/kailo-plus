//! DD-134(7)：模型路由列表与新建所需的 Gateway 原生模型来源。
//!
//! 列表展示本 Tenant 的 `llm_route` Resource（route Resource `discover` 过滤）、其
//! Gateway 投影的 provider 与模型、引用它的 Installation 与 binding 数，以及时间窗
//! 用量（Gateway request log，持有 Tenant `audit` 时给出）。新建沿既有
//! `llm_route.create`，停用沿 `llm_route.disable`（`05` §2.13）；两者只由准入预评估
//! 给出入口，提交时重新准入。

use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use chrono::Utc;
use contracts::{GatewayModelRoutePage, GatewayModelSourcePage, ReasonCode};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::access::{action_allowed, caller, check, require_tenant, require_zone, Caller};
use super::stats::{model_records, rfc3339, window, Counters, Kind};
use crate::bff::BffState;
use crate::governance::{Refusal, Target};

const CREATE: &str = "llm_route.create";
const DISABLE: &str = "llm_route.disable";

fn unavailable() -> Refusal {
    Refusal::Unavailable("gateway model configuration unavailable".into())
}

/// 与 `llm_route.create` 校验 `provider/model.sha256` 的口径一致：键有序 JSON 的 SHA-256。
pub(crate) fn source_digest(value: &Value) -> Option<String> {
    let canonical = crate::agent_version::canonical(value.clone());
    Some(hex::encode(Sha256::digest(
        serde_json::to_vec(&canonical).ok()?,
    )))
}

/// provider 值的类型键（`openAI`、`anthropic`、`custom` …）。
pub(crate) fn provider_type(provider: &Value) -> Option<String> {
    provider
        .get("provider")
        .and_then(Value::as_object)
        .and_then(|kind| kind.keys().next().cloned())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct RoutesQuery {
    from: Option<String>,
    to: Option<String>,
    offset: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct RouteRow {
    id: Uuid,
    version: i32,
    native_id: String,
    state: String,
    owner_principal_id: Uuid,
    home_workspace_id: Option<Uuid>,
    installation_count: i64,
    binding_count: i64,
}

async fn route_page(
    state: &BffState,
    caller: &Caller,
    query: RoutesQuery,
) -> Result<GatewayModelRoutePage, Refusal> {
    require_zone(state, caller).await?;
    require_tenant(state, caller, None, "discover").await?;
    let offset = query.offset.unwrap_or(0);
    let limit = i64::from(state.governance.cfg.relationship_page);
    if offset < 0 || limit <= 0 || offset.checked_add(limit).is_none() {
        return Err(Refusal::Precondition(ReasonCode::InvalidParameters));
    }
    let window = window(query.from.as_deref(), query.to.as_deref(), Utc::now())?;
    let tenant = caller.ctx.tenant_id;
    let rows: Vec<RouteRow> = sqlx::query_as(
        "select r.id,r.version,r.native_id,r.state,r.owner_principal_id,r.home_workspace_id,
           (select count(distinct b.installation_resource_id) from catalog.agent_model_binding b
              join catalog.agent_installation i on i.resource_id=b.installation_resource_id
                and i.active_projection_generation=b.projection_generation and i.state<>'DISABLED'
              where b.model_route_resource_id=r.id) as installation_count,
           (select count(*) from catalog.application_binding ab
              where ab.tenant_id=r.tenant_id and ab.state in ('PROVISIONING','ACTIVE','UPGRADING')
                and coalesce(ab.normalized_config->'modelGateway'->'routeResourceIds','[]'::jsonb) ? r.id::text
           ) as binding_count
         from catalog.resource r join catalog.model_route m on m.resource_id=r.id
         where r.tenant_id=$1 and r.type_key='llm_route'
         order by r.id offset $2 limit $3",
    )
    .bind(tenant)
    .bind(offset)
    .bind(limit + 1)
    .fetch_all(&state.pool)
    .await?;
    let has_next = rows.len() as i64 > limit;
    let rows: Vec<RouteRow> = rows.into_iter().take(limit as usize).collect();
    let ids: Vec<String> = rows.iter().map(|r| r.id.to_string()).collect();
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
            .map_err(|_| Refusal::Unavailable("route discovery unavailable".into()))?
    };
    // Gateway 投影的 provider 与模型：llm_route.create 以 route ID 为三类资源的 ID。
    let mut natives: HashMap<String, (Option<String>, Option<String>)> = HashMap::new();
    if let Ok(gateway) = crate::model_route::Gateway::from_env() {
        if let (Ok(providers), Ok(models)) = (
            gateway.resources("llm.provider").await,
            gateway.resources("llm.model").await,
        ) {
            for row in &providers {
                if let (Some(id), Some(value)) =
                    (row.get("id").and_then(Value::as_str), row.get("value"))
                {
                    natives.entry(id.to_owned()).or_default().0 = provider_type(value);
                }
            }
            for row in &models {
                if let (Some(id), Some(model)) = (
                    row.get("id").and_then(Value::as_str),
                    row.pointer("/value/params/model").and_then(Value::as_str),
                ) {
                    natives.entry(id.to_owned()).or_default().1 = Some(model.to_owned());
                }
            }
        }
    }
    let audit = check(
        state,
        "tenant",
        tenant,
        "audit",
        caller.ctx.tenant_principal_id,
    )
    .await?;
    let mut usage: HashMap<String, Counters> = HashMap::new();
    let mut usage_available = false;
    if audit {
        let (records, _, available) = model_records(state, caller, &window, None).await?;
        usage_available = available;
        for record in records.iter().filter(|r| r.kind == Kind::Model) {
            if let Some(route) = &record.route {
                usage.entry(route.clone()).or_default().add(record);
            }
        }
    }
    let mut routes = Vec::new();
    for row in rows {
        if !visible.contains(&row.id.to_string()) {
            continue;
        }
        let mut route = json!({"resourceId":row.id,"resourceVersion":row.version,"nativeId":row.native_id,
            "resourceState":row.state,"ownerPrincipalId":row.owner_principal_id,
            "installationCount":row.installation_count,"bindingCount":row.binding_count,"canDisable":false});
        if let Some(workspace) = row.home_workspace_id {
            route["homeWorkspaceId"] = json!(workspace);
        }
        if let Some((provider, model)) = natives.get(&row.native_id) {
            if let Some(provider) = provider {
                route["provider"] = json!(provider);
            }
            if let Some(model) = model {
                route["model"] = json!(model);
            }
        }
        if usage_available {
            let counter = usage.entry(row.native_id.clone()).or_default();
            route["requests"] = json!(counter.requests);
            route["failed"] = json!(counter.failed);
            route["totalTokens"] = json!(counter.total_tokens);
            if let (Some(p95), _) = counter.p95() {
                route["modelP95Ms"] = json!(p95);
            }
        }
        if row.state == "ACTIVE" {
            route["canDisable"] = json!(
                action_allowed(
                    state,
                    caller,
                    DISABLE,
                    &Target {
                        id: row.id,
                        version: row.version,
                        workspace_id: row.home_workspace_id,
                    },
                )
                .await?
            );
        }
        routes.push(route);
    }
    let can_create = action_allowed(
        state,
        caller,
        CREATE,
        &Target {
            id: tenant,
            version: 0,
            workspace_id: None,
        },
    )
    .await?;
    let mut value = json!({"from":rfc3339(window.from),"to":rfc3339(window.to),
        "canCreate":can_create,"routes":routes});
    if has_next {
        value["nextOffset"] = json!(offset + limit);
    }
    serde_json::from_value(value)
        .map_err(|e| Refusal::Unavailable(format!("GatewayModelRoutePage: {e}")))
}

/// `GET /api/v1/gateway/model-routes`
pub(crate) async fn list(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<RoutesQuery>,
) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match route_page(&state, &caller, query).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

/// 原生来源配对：model 的 `provider.reference` 指向同库的 provider。只排除 route 自身的投影
/// （ID 为 llm_route Resource 的原生 ID）；已被现存 route 引用的来源照常列出，与
/// `llm_route.create` 的准入一致——准入允许多条 route 复用同一来源（DD-134(7)）。
pub(crate) fn pair_sources(
    providers: &[Value],
    models: &[Value],
    excluded: &std::collections::HashSet<String>,
) -> Vec<Value> {
    let mut sources = Vec::new();
    for model in models {
        let (Some(model_id), Some(value), Some(revision)) = (
            model.get("id").and_then(Value::as_str),
            model.get("value"),
            model.get("revision").and_then(Value::as_i64),
        ) else {
            continue;
        };
        let Some(reference) = value.pointer("/provider/reference").and_then(Value::as_str) else {
            continue;
        };
        let Some(provider) = providers
            .iter()
            .find(|p| p.get("id").and_then(Value::as_str) == Some(reference))
        else {
            continue;
        };
        let (Some(provider_value), Some(provider_revision)) = (
            provider.get("value"),
            provider.get("revision").and_then(Value::as_i64),
        ) else {
            continue;
        };
        if excluded.contains(model_id) || excluded.contains(reference) {
            continue;
        }
        let (Some(model_sha), Some(provider_sha), Some(model_name)) = (
            source_digest(value),
            source_digest(provider_value),
            value.pointer("/params/model").and_then(Value::as_str),
        ) else {
            continue;
        };
        sources.push(json!({
            "provider":{"id":reference,"revision":provider_revision,"sha256":provider_sha},
            "model":{"id":model_id,"revision":revision,"sha256":model_sha},
            "providerType":provider_type(provider_value).unwrap_or_default(),
            "modelName":model_name,
            "credentialRequired":!crate::model_route::native_provider_without_auth(provider_value)}));
    }
    sources
}

async fn source_page(state: &BffState, caller: &Caller) -> Result<GatewayModelSourcePage, Refusal> {
    require_zone(state, caller).await?;
    require_tenant(state, caller, None, "create").await?;
    let gateway = crate::model_route::Gateway::from_env().map_err(|_| unavailable())?;
    let providers = gateway.resources("llm.provider").await?;
    let models = gateway.resources("llm.model").await?;
    // 只排除 route 投影（任何 Tenant 的 llm_route 原生 ID），不排除被现存 route 引用的来源
    let projected: Vec<String> = sqlx::query_scalar(
        "select native_id from catalog.resource where type_key='llm_route' and application_binding_id is null",
    )
    .fetch_all(&state.pool)
    .await?;
    let excluded: std::collections::HashSet<String> = projected.into_iter().collect();
    let value = json!({"sources":pair_sources(&providers, &models, &excluded)});
    serde_json::from_value(value)
        .map_err(|e| Refusal::Unavailable(format!("GatewayModelSourcePage: {e}")))
}

/// `GET /api/v1/gateway/model-sources`
pub(crate) async fn sources(State(state): State<BffState>, headers: HeaderMap) -> Response {
    let caller = match caller(&state, &headers).await {
        Ok(caller) => caller,
        Err(response) => return response,
    };
    match source_page(&state, &caller).await {
        Ok(page) => Json(page).into_response(),
        Err(error) => error.respond(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn digest_is_key_order_independent() {
        assert_eq!(
            source_digest(&json!({"b":1,"a":{"d":2,"c":3}})),
            source_digest(&json!({"a":{"c":3,"d":2},"b":1}))
        );
    }

    #[test]
    fn sources_pair_models_with_providers_and_skip_projected_ids() {
        let providers = vec![
            json!({"kind":"llm.provider","id":"vllm","revision":2,
                "value":{"name":"vllm","provider":{"custom":{"formats":["completions"]}},
                    "params":{"baseUrl":"http://vllm:8000/v1","apiKey":{"file":"/s"}}}}),
            json!({"kind":"llm.provider","id":"route-1","revision":1,"value":{"name":"route-1"}}),
        ];
        let models = vec![
            json!({"kind":"llm.model","id":"qwen","revision":3,
                "value":{"name":"qwen","provider":{"reference":"vllm"},"params":{"model":"qwen-27b"}}}),
            json!({"kind":"llm.model","id":"route-1","revision":1,
                "value":{"provider":{"reference":"route-1"},"params":{"model":"x"}}}),
            json!({"kind":"llm.model","id":"orphan","revision":1,
                "value":{"provider":{"reference":"missing"},"params":{"model":"y"}}}),
        ];
        let excluded: HashSet<String> = ["route-1".to_owned()].into_iter().collect();
        let sources = pair_sources(&providers, &models, &excluded);
        assert_eq!(sources.len(), 1);
        let source = &sources[0];
        assert_eq!(source["provider"]["id"], "vllm");
        assert_eq!(source["provider"]["revision"], 2);
        assert_eq!(source["model"]["id"], "qwen");
        assert_eq!(source["modelName"], "qwen-27b");
        assert_eq!(source["providerType"], "custom");
        assert_eq!(
            source["model"]["sha256"],
            json!(source_digest(&models[0]["value"]).unwrap())
        );
        assert_eq!(source["credentialRequired"], true);
        // 值本身不出现在响应中
        assert!(!source.to_string().contains("vllm:8000"));
    }

    /// 缺陷 4（生产验收）：来源被现存 route 引用后仍可再选，与 `llm_route.create` 的准入一致；
    /// 只有 route 自己的投影（原生 ID 等于某个 llm_route）不作为来源。
    #[test]
    fn a_source_used_by_an_existing_route_is_still_offered() {
        let providers = vec![
            json!({"kind":"llm.provider","id":"vision","revision":1,
                "value":{"name":"vision","provider":{"openAI":{}},"params":{}}}),
            json!({"kind":"llm.provider","id":"62f190fc","revision":1,"value":{"name":"62f190fc"}}),
        ];
        let models = vec![
            json!({"kind":"llm.model","id":"vision-27b","revision":1,
                "value":{"provider":{"reference":"vision"},"params":{"model":"vision-27b"}}}),
            // 已由 route 62f190fc 投影、冻结引用了 vision 来源的 route 自身投影
            json!({"kind":"llm.model","id":"62f190fc","revision":1,
                "value":{"provider":{"reference":"62f190fc"},"params":{"model":"vision-27b"}}}),
        ];
        let projected: HashSet<String> = ["62f190fc".to_owned()].into_iter().collect();
        let sources = pair_sources(&providers, &models, &projected);
        assert_eq!(sources.len(), 1);
        assert_eq!(sources[0]["provider"]["id"], "vision");
        assert_eq!(sources[0]["model"]["id"], "vision-27b");
    }
}
