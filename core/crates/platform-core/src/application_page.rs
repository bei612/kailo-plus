//! DD-87/94: a reference to an independent application's own page, not a proxy
//! for its body or credentials. Native sessions and internal ACLs stay there.
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use contracts::ReasonCode;
use reqwest::Url;
use serde_json::Value;
use uuid::Uuid;

use crate::{
    bff::{BffState, ExecutionContext},
    governance::Refusal,
};

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn unavailable() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}

/// An origin is an exact deployment/release fact, not a wildcard or URL prefix.
pub(crate) fn origin(value: &str) -> Result<String, Refusal> {
    if value
        .chars()
        .any(|ch| ch.is_whitespace() || ch.is_control())
    {
        return Err(invalid());
    }
    let url = Url::parse(value).map_err(|_| invalid())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none_or(|host| {
            host.chars()
                .any(|ch| !ch.is_ascii_alphanumeric() && !matches!(ch, '.' | '-' | ':' | '[' | ']'))
        })
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || url.origin().ascii_serialization() != value
    {
        return Err(invalid());
    }
    Ok(value.to_owned())
}

pub(crate) fn release_origins(frontend: &Value) -> Result<Vec<String>, Refusal> {
    let rows = frontend["nativePageOrigins"]
        .as_array()
        .ok_or_else(invalid)?;
    if rows.is_empty() {
        return Err(invalid());
    }
    let origins = rows
        .iter()
        .map(|value| origin(value.as_str().ok_or_else(invalid)?))
        .collect::<Result<Vec<_>, _>>()?;
    if origins
        .iter()
        .collect::<std::collections::BTreeSet<_>>()
        .len()
        != origins.len()
    {
        return Err(invalid());
    }
    Ok(origins)
}

/// The entry belongs to the release's binding schema. It is never supplied by
/// a launch request and must not contain URL credentials or bearer parameters.
pub(crate) fn entry(manifest: &Value, config: &Value) -> Result<Url, Refusal> {
    // A source-bound editor may also declare its independent native file UI.
    // This reads only that already-approved origin/entry; it does not launch an
    // editor, grant protocol permission or enable the blocked Desktop host.
    let frontend = &manifest["frontendDelivery"];
    if frontend["mode"] != "NATIVE_PAGE"
        && !(frontend["mode"] == "SOURCE_BOUND_PROTOCOL"
            && frontend["launchDescriptorSchemaVersion"] == "1")
    {
        return Err(unavailable());
    }
    let text = config["nativePageUrl"].as_str().ok_or_else(invalid)?;
    let url = Url::parse(text).map_err(|_| invalid())?;
    if text.trim() != text
        || text.chars().any(char::is_control)
        || !url.username().is_empty()
        || url.password().is_some()
        || !release_origins(&manifest["frontendDelivery"])?
            .contains(&url.origin().ascii_serialization())
        || url.query_pairs().any(|(key, _)| {
            matches!(
                key.to_ascii_lowercase().as_str(),
                "access_token"
                    | "refresh_token"
                    | "id_token"
                    | "token"
                    | "api_key"
                    | "apikey"
                    | "password"
                    | "secret"
                    | "authorization"
            )
        })
    {
        return Err(invalid());
    }
    Ok(url)
}

pub(crate) async fn get(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let actor = match crate::bff::resolve_execution_context(&state, &headers).await {
        Ok(actor) => actor,
        Err(error) => return error,
    };
    match descriptor(&state, &actor, id).await {
        Ok(page) => (
            [(axum::http::header::CACHE_CONTROL, "no-store")],
            Json(page),
        )
            .into_response(),
        Err(error) => error.respond(None),
    }
}

async fn descriptor(
    state: &BffState,
    actor: &ExecutionContext,
    id: Uuid,
) -> Result<contracts::ApplicationNativePage, Refusal> {
    // Read only references; no HTTP request to the page, cookie forwarding or
    // native management token ever passes through this BFF endpoint.
    let row: Option<(Option<Uuid>, i64, Value, String, Value, String)> = sqlx::query_as(
        "select b.workspace_id,b.active_projection_generation,b.normalized_config,b.config_digest,r.manifest,r.manifest_digest
         from catalog.application_binding b join catalog.component_release r on r.id=b.component_release_id
         join projection.application_runtime p on p.binding_id=b.id and p.generation=b.active_projection_generation
           and p.component_release_id=r.id and p.normalized_manifest_digest=r.manifest_digest and p.state='ACTIVE'
         join catalog.component_definition d on d.type_key=r.component_type_key and d.catalog_tenant_id=r.catalog_tenant_id
         join identity.tenant t on t.id=b.tenant_id
         where b.id=$1 and b.tenant_id=$2 and b.state='ACTIVE' and b.active_projection_generation>0
           and r.status='APPROVED' and r.approved_by_action_execution_id is not null
           and d.class='APPLICATION' and d.status='ACTIVE' and t.state='ACTIVE'")
        .bind(id).bind(actor.tenant_id).fetch_optional(&state.pool).await?;
    let (workspace, generation, config, config_digest, manifest, digest) =
        row.ok_or_else(unavailable)?;
    if let Some(workspace) = workspace {
        let admitted = crate::web_transport::workspace_admissions(state, actor, &[workspace])
            .await
            .map_err(|error| match error {
                crate::web_transport::AdmissionFailure::Denied => {
                    Refusal::Denied(ReasonCode::PermissionDenied)
                }
                crate::web_transport::AdmissionFailure::BindingNotActive => {
                    Refusal::Precondition(ReasonCode::BindingNotActive)
                }
                crate::web_transport::AdmissionFailure::Unavailable => {
                    Refusal::Unavailable("Native page scope unavailable".into())
                }
            })?;
        if !admitted.contains_key(&workspace) {
            return Err(Refusal::Denied(ReasonCode::PermissionDenied));
        }
    }
    let object = workspace.unwrap_or(actor.tenant_id).to_string();
    let checked = state
        .governance
        .spicedb
        .check(
            if workspace.is_some() {
                "workspace"
            } else {
                "tenant"
            },
            &object,
            "discover",
            &actor.tenant_principal_id.to_string(),
            crate::spicedb::Consistency::FullyConsistent,
        )
        .await
        .map_err(|_| Refusal::Unavailable("Native page discovery unavailable".into()))?;
    if !checked.allowed || checked.zed_token.is_empty() {
        return Err(Refusal::Denied(ReasonCode::PermissionDenied));
    }
    if collab_bridge::limits::canonical_digest(&manifest) != digest
        || collab_bridge::limits::canonical_digest(&config) != config_digest
    {
        return Err(unavailable());
    }
    let page = entry(&manifest, &config)?;
    let page_origin = page.origin().ascii_serialization();
    let configured = std::env::var("NATIVE_PAGE_ORIGINS").unwrap_or_default();
    let allowed = configured
        .split_whitespace()
        .map(origin)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| unavailable())?;
    let platform = std::env::var("PUBLIC_ORIGIN").map_err(|_| unavailable())?;
    if !allowed.contains(&page_origin)
        || page_origin == origin(&platform).map_err(|_| unavailable())?
    {
        return Err(unavailable());
    }
    let effective: Vec<_> = release_origins(&manifest["frontendDelivery"])?
        .into_iter()
        .filter(|candidate| allowed.contains(candidate) && candidate != &platform)
        .collect();
    let value = serde_json::json!({"bindingId":id,"projectionGeneration":generation,
        "url":page.as_str(),"origin":page_origin,"allowedOrigins":effective});
    let typed: contracts::ApplicationNativePage =
        serde_json::from_value(value.clone()).map_err(|_| unavailable())?;
    if serde_json::to_value(&typed).map_err(|_| unavailable())? != value {
        return Err(unavailable());
    }
    Ok(typed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn native_page_origin_is_exact_and_not_a_csp_fragment() {
        assert!(origin("https://service.example.test").is_ok());
        for value in [
            "https://*.example.test",
            "https://service.example.test/",
            "https://service.example.test;script-src",
            "https://service.example.test\n",
            "https://user@service.example.test",
            "https://service.example.test/path",
            "https://service.example.test:443",
            "javascript:alert(1)",
        ] {
            assert!(origin(value).is_err(), "accepted {value:?}");
        }
    }

    #[test]
    fn native_page_entry_uses_release_and_binding_not_caller_url() {
        let manifest = json!({"frontendDelivery":{"mode":"NATIVE_PAGE",
            "nativePageOrigins":["https://service.example.test"]}});
        assert!(entry(
            &manifest,
            &json!({"nativePageUrl":"https://service.example.test/admin/#/settings"})
        )
        .is_ok());
        for value in [
            "https://other.example.test/admin",
            "https://service.example.test/?access_token=value",
            "https://user:password@service.example.test/",
            "https://service.example.test/?API_KEY=value",
        ] {
            assert!(entry(&manifest, &json!({"nativePageUrl":value})).is_err());
        }
        assert!(entry(&manifest, &json!({})).is_err());
        assert!(entry(&json!({"frontendDelivery":{"mode":"NONE"}}), &json!({})).is_err());
        assert!(release_origins(&json!({"nativePageOrigins":["https://service.example.test","https://service.example.test"]})).is_err());
    }

    #[test]
    fn document_source_entry_requires_declared_native_origin_and_supported_protocol() {
        let config = json!({"nativePageUrl":"https://files.example.test/ui/"});
        let mut manifest = json!({"frontendDelivery":{"mode":"SOURCE_BOUND_PROTOCOL",
            "launchDescriptorSchemaVersion":"1","nativePageOrigins":["https://files.example.test"]}});
        assert!(entry(&manifest, &config).is_ok());
        manifest["frontendDelivery"]["launchDescriptorSchemaVersion"] = json!("unknown");
        assert!(entry(&manifest, &config).is_err());
        manifest["frontendDelivery"]["launchDescriptorSchemaVersion"] = json!("1");
        manifest["frontendDelivery"]["nativePageOrigins"] = json!([]);
        assert!(entry(&manifest, &config).is_err());
    }
}
