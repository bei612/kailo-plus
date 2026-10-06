//! The same admitted HUMAN protocol intent's one-shot native launch. Unknown
//! response never replays the original PAT producer or stores its secret.
use super::*;

pub(crate) async fn load(pool: &sqlx::PgPool, id: Uuid) -> Result<Option<Session>, Refusal> {
    Ok(sqlx::query_as("select id,action_execution_id,application_binding_id,target,admitted_mode,
        base_revision,expires_at,state,version,native_session_ref,launch_theme,launch_locale,native_write_observation
        from admission.protocol_session where id=$1")
        .bind(id).fetch_optional(pool).await?)
}

fn arguments(session: &Session, facts: &Value) -> Result<Value, Refusal> {
    Ok(
        json!({"protocolSessionId":session.id,"reference":session.target,
        "authorizationTargetNativeRef":facts["nativeTargetRef"],"admittedMode":session.admitted_mode,
        "theme":session.launch_theme,"locale":match session.launch_locale.as_str(){"EN"=>"en","ZH_CN"=>"zh-CN",_=>return Err(invalid())},
        "expiresAt":session.expires_at,"idempotencyKey":session.id}),
    )
}

/// Both issuing and validating the launch ticket use this exact original
/// Session. No callback may turn UNKNOWN into another native dispatch.
pub(crate) async fn authorize(
    state: &ServiceState,
    ae: &Execution,
    audience: &str,
    args: &Value,
) -> Result<String, Refusal> {
    if ae.gate_state != "ALLOWED" || ae.dispatch_state != "UNKNOWN" {
        return Err(denied());
    }
    let typed: contracts::AdapterProtocolSessionLaunchRequest =
        serde_json::from_value(args.clone()).map_err(|_| invalid())?;
    if serde_json::to_value(typed).map_err(|_| invalid())? != *args {
        return Err(invalid());
    }
    let session = load(&state.pool, ae.id).await?.ok_or_else(denied)?;
    let (evaluation, facts) = fresh_execution(state, ae).await?;
    if session.action_execution_id != ae.id
        || session.state != "OPENING"
        || session.native_session_ref.is_some()
        || session.expires_at <= Utc::now()
        || arguments(&session, &facts)? != *args
    {
        return Err(denied());
    }
    let expected:Option<String>=sqlx::query_scalar("select s.audience from catalog.application_binding b
        join identity.service_principal s on s.principal_id=b.service_principal_id
          and s.component_binding_kind='APPLICATION' and s.component_binding_id=b.id
        join identity.principal p on p.id=s.principal_id and p.tenant_id=b.tenant_id and p.kind='SERVICE' and p.status='ACTIVE'
        where b.id=$1 and b.tenant_id=$2 and b.state='ACTIVE'")
        .bind(session.application_binding_id).bind(ae.tenant_id).fetch_optional(&state.pool).await?;
    if expected.as_deref() != Some(audience) {
        return Err(denied());
    }
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::application_catalog::approval::lock_parent(&mut tx, ae).await?;
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(denied());
    }
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if locked.gate_state != "ALLOWED" || locked.dispatch_state != "UNKNOWN" {
        return Err(denied());
    }
    crate::application_catalog::approval::require_consumable(
        &state.governance,
        &mut tx,
        &locked,
        &def,
    )
    .await?;
    let valid: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.protocol_session
        where id=$1 and action_execution_id=$1 and state='OPENING' and expires_at>clock_timestamp()
          and native_session_ref is null)",
    )
    .bind(ae.id)
    .fetch_one(&mut *tx)
    .await?;
    if !valid {
        return Err(denied());
    }
    tx.commit().await?;
    evaluation
        .zed_token
        .filter(|v| !v.is_empty())
        .ok_or_else(unknown)
}

fn descriptor(
    value: &Value,
    session: &Session,
    manifest: &Value,
    config: &Value,
) -> Result<Value, Refusal> {
    let typed: contracts::AdapterProtocolSessionLaunchResponse =
        serde_json::from_value(value.clone()).map_err(|_| unknown())?;
    if serde_json::to_value(typed).map_err(|_| unknown())? != *value
        || value["nativeSessionRef"] != json!(session.id)
    {
        return Err(unknown());
    }
    let descriptor = &value["launchDescriptor"];
    let editor =
        crate::application_page::origin(descriptor["editorOrigin"].as_str().ok_or_else(unknown)?)?;
    let configured = editor_configuration(manifest, config)?;
    let expires = descriptor["expiresAt"]
        .as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|s| s.with_timezone(&Utc))
        .ok_or_else(unknown)?;
    let url = reqwest::Url::parse(descriptor["actionUrl"].as_str().ok_or_else(unknown)?)
        .map_err(|_| unknown())?;
    if editor != configured
        || url.origin().ascii_serialization() != editor
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.query_pairs().any(|(k, _)| {
            matches!(
                k.to_ascii_lowercase().as_str(),
                "access_token" | "token" | "refresh_token" | "password" | "secret"
            )
        })
        || expires <= Utc::now()
        || expires > session.expires_at
        || descriptor["formFields"].as_object().is_none_or(|fields| {
            fields.iter().any(|(key, value)| {
                key.is_empty()
                    || key.chars().any(char::is_control)
                    || value
                        .as_str()
                        .is_none_or(|v| v.chars().any(char::is_control))
            })
        })
    {
        return Err(unknown());
    }
    Ok(descriptor.clone())
}

pub(super) fn editor_configuration(manifest: &Value, config: &Value) -> Result<String, Refusal> {
    let deployed = std::env::var("EDITOR_ORIGINS").unwrap_or_default();
    let web = std::env::var("WEB_EDITOR_ORIGINS").unwrap_or_default();
    let platform = std::env::var("PUBLIC_ORIGIN").map_err(|_| invalid())?;
    effective_editor_configuration(manifest, config, &deployed, &web, &platform)
}

fn effective_editor_configuration(
    manifest: &Value,
    config: &Value,
    deployed: &str,
    web: &str,
    platform: &str,
) -> Result<String, Refusal> {
    let configured =
        crate::application_page::origin(config["editorOrigin"].as_str().ok_or_else(invalid)?)?;
    let origins = manifest["frontendDelivery"]["editorOrigins"]
        .as_array()
        .ok_or_else(invalid)?;
    if manifest["frontendDelivery"]["mode"] != "SOURCE_BOUND_PROTOCOL"
        || manifest["frontendDelivery"]["launchDescriptorSchemaVersion"] != "1"
        || !origins.iter().any(|v| {
            v.as_str()
                .is_some_and(|pattern| approved_origin(pattern, &configured))
        })
    {
        return Err(invalid());
    }
    let exact = |text: &str| -> Result<Vec<String>, Refusal> {
        let values = text
            .split_whitespace()
            .map(crate::application_page::origin)
            .collect::<Result<Vec<_>, _>>()?;
        if values
            .iter()
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != values.len()
        {
            return Err(invalid());
        }
        Ok(values)
    };
    let deployed = exact(deployed)?;
    let web = exact(web)?;
    let platform = crate::application_page::origin(platform)?;
    if !web.iter().all(|origin| deployed.contains(origin))
        || !deployed.contains(&configured)
        || !web.contains(&configured)
        || configured == platform
    {
        return Err(invalid());
    }
    Ok(configured)
}

// DD-95 permits a deployment domain rule in the approved release, but each
// binding and returned action still resolves to one exact non-wildcard origin.
pub(crate) fn valid_editor_pattern(pattern: &str) -> bool {
    if crate::application_page::origin(pattern).is_ok() {
        return true;
    }
    let Some((scheme, host)) = pattern.split_once("://") else {
        return false;
    };
    let Some(suffix) = host.strip_prefix("*.") else {
        return false;
    };
    !suffix.contains('*')
        && suffix.contains('.')
        && crate::application_page::origin(&format!("{scheme}://{suffix}")).is_ok()
}

fn approved_origin(pattern: &str, actual: &str) -> bool {
    if !valid_editor_pattern(pattern) {
        return false;
    }
    if pattern == actual {
        return crate::application_page::origin(pattern).is_ok();
    }
    let Some((scheme, host)) = pattern.split_once("://") else {
        return false;
    };
    let Some(suffix) = host.strip_prefix("*.") else {
        return false;
    };
    if !matches!(scheme, "http" | "https")
        || suffix.is_empty()
        || suffix.contains('*')
        || suffix.contains('/')
        || suffix.contains('@')
        || suffix.contains('?')
        || suffix.contains('#')
    {
        return false;
    }
    let Ok(base) = reqwest::Url::parse(&format!("{scheme}://{suffix}")) else {
        return false;
    };
    let Ok(url) = reqwest::Url::parse(actual) else {
        return false;
    };
    let Some(base_host) = base.host_str() else {
        return false;
    };
    url.scheme() == scheme
        && url.port_or_known_default() == base.port_or_known_default()
        && url
            .host_str()
            .is_some_and(|host| host.ends_with(&format!(".{base_host}")) && host != base_host)
        && crate::application_page::origin(actual).is_ok()
}

/// At most one caller transitions ADMITTED→OPENING and is allowed to issue the
/// native POST. Later calls only return the original status; they cannot get a
/// fresh secret by replaying an UNKNOWN or already OPEN Session.
pub(crate) async fn once(state: &ServiceState, ae: &Execution) -> Result<Option<Value>, Refusal> {
    let refs = execution_refs(&state.pool, ae.id).await?;
    let session = load(&state.pool, ae.id).await?.ok_or_else(denied)?;
    if session.state != "ADMITTED" || ae.dispatch_state != "NOT_DISPATCHED" {
        return Ok(None);
    }
    let (_, facts) = fresh_execution(state, ae).await?;
    let args = arguments(&session, &facts)?;
    // Deterministic controlled-delivery failures precede the native-dispatch
    // fence. UNKNOWN means an external attempt may have happened, not that the
    // selected adapter URL or editor origin was missing before any attempt.
    let adapter = crate::application_binding::native::Adapter::resolve(
        facts["adapterServiceRef"].as_str().ok_or_else(invalid)?,
        facts["nativeInstanceRef"].as_str().ok_or_else(invalid)?,
        &facts["manifest"],
    )?;
    let config:Value=sqlx::query_scalar("select b.normalized_config from catalog.application_binding b
        where b.id=$1 and b.state='ACTIVE' and b.active_projection_generation=$2 and b.component_release_id=$3")
        .bind(session.application_binding_id).bind(refs.generation).bind(refs.release_id)
        .fetch_optional(&state.pool).await?.ok_or_else(denied)?;
    editor_configuration(&facts["manifest"], &config)?;
    let def = crate::governance::exact_definition_for_execution(&state.pool, ae).await?;
    let mut tx = state.pool.begin().await?;
    crate::application_catalog::approval::lock_parent(&mut tx, ae).await?;
    if !crate::roles::lock_tenant(&mut tx, ae.tenant_id).await? {
        return Err(denied());
    }
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if locked.gate_state != "ALLOWED" || locked.dispatch_state != "NOT_DISPATCHED" {
        return Ok(None);
    }
    crate::application_catalog::approval::require_consumable(
        &state.governance,
        &mut tx,
        &locked,
        &def,
    )
    .await?;
    let changed=sqlx::query("update admission.protocol_session set state='OPENING',version=version+1,updated_at=now()
        where id=$1 and action_execution_id=$1 and state='ADMITTED' and expires_at>clock_timestamp()")
        .bind(ae.id).execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Ok(None);
    }
    crate::governance::record_dispatch(
        &mut tx,
        ae.id,
        def.audit_class(),
        Err(axum::http::StatusCode::SERVICE_UNAVAILABLE),
        Vec::new(),
    )
    .await?;
    tx.commit().await?;
    let current = crate::governance::load_execution(&state.pool, ae.id)
        .await?
        .ok_or_else(unknown)?;
    let answer = adapter
        .call(state, &current, "execute", session.id, &args)
        .await?;
    let typed: contracts::AdapterExecutionResponse =
        serde_json::from_value(answer.clone()).map_err(|_| unknown())?;
    if serde_json::to_value(typed).map_err(|_| unknown())? != answer
        || answer.get("contentReference").is_some()
        || answer["execution"]["idempotencyKey"] != json!(session.id)
        || answer["execution"]["nativeType"] != "document.pat"
        || answer["execution"]["nativeId"] != json!(session.id)
        || answer["execution"]["nativeStatus"] != "CREATED"
        || answer["execution"]["platformStatus"] != "SUCCEEDED"
    {
        return Err(unknown());
    }
    let native: Value = serde_json::from_str(answer["resultJson"].as_str().ok_or_else(unknown)?)
        .map_err(|_| unknown())?;
    let config:Value=sqlx::query_scalar("select b.normalized_config from catalog.application_binding b
        where b.id=$1 and b.state='ACTIVE' and b.active_projection_generation=$2 and b.component_release_id=$3")
        .bind(session.application_binding_id).bind(refs.generation).bind(refs.release_id)
        .fetch_optional(&state.pool).await?.ok_or_else(denied)?;
    let launch = descriptor(&native, &session, &facts["manifest"], &config)?;
    fresh_execution(state, &current).await?;
    let mut tx = state.pool.begin().await?;
    crate::application_catalog::approval::lock_parent(&mut tx, &current).await?;
    if !crate::roles::lock_tenant(&mut tx, current.tenant_id).await? {
        return Err(denied());
    }
    let locked = crate::governance::lock_execution(&mut tx, ae.id).await?;
    if locked.gate_state != "ALLOWED" || locked.dispatch_state != "UNKNOWN" {
        return Err(denied());
    }
    let changed=sqlx::query("update admission.protocol_session set state='OPEN',native_session_ref=$2,
        version=version+1,updated_at=now() where id=$1 and state='OPENING' and expires_at>clock_timestamp()")
        .bind(session.id).bind(native["nativeSessionRef"].as_str().ok_or_else(unknown)?)
        .execute(&mut *tx).await?;
    if changed.rows_affected() != 1 {
        return Err(unknown());
    }
    crate::governance::record_dispatch(&mut tx, ae.id, def.audit_class(), Ok(()), Vec::new())
        .await?;
    tx.commit().await?;
    state.governance.consume(ae.id).await;
    // Neither the answer nor its bearer fields were stored in any table.
    // Return only to the HUMAN's original launch call after fresh re-admission.
    fresh_execution(state, &current).await?;
    let valid: bool = sqlx::query_scalar(
        "select exists(select 1 from admission.protocol_session
        where id=$1 and action_execution_id=$1 and state='OPEN' and expires_at>clock_timestamp()
          and native_session_ref=$1::text)",
    )
    .bind(ae.id)
    .fetch_one(&state.pool)
    .await?;
    if !valid {
        return Err(denied());
    }
    Ok(Some(launch))
}

#[cfg(test)]
mod editor_tests {
    use super::*;
    #[test]
    fn editor_requires_release_deployment_and_effective_web_origin_intersection() {
        let manifest = json!({"frontendDelivery":{"mode":"SOURCE_BOUND_PROTOCOL",
            "launchDescriptorSchemaVersion":"1","editorOrigins":["https://*.edit.example"]}});
        let config = json!({"editorOrigin":"https://doc.edit.example"});
        let allowed = "https://doc.edit.example";
        let platform = "https://kailo.example";
        assert_eq!(
            effective_editor_configuration(&manifest, &config, allowed, allowed, platform).unwrap(),
            allowed
        );
        for (deployed, web) in [
            ("", allowed),
            (allowed, ""),
            (allowed, "https://other.edit.example"),
            ("https://*.edit.example", allowed),
            ("https://doc.edit.example/path", allowed),
            (allowed, "https://doc.edit.example https://doc.edit.example"),
        ] {
            assert!(
                effective_editor_configuration(&manifest, &config, deployed, web, platform)
                    .is_err()
            );
        }
        assert!(
            effective_editor_configuration(&manifest, &config, allowed, allowed, allowed).is_err()
        );
        let unapproved = json!({"frontendDelivery":{"mode":"SOURCE_BOUND_PROTOCOL",
            "launchDescriptorSchemaVersion":"1","editorOrigins":["https://other.edit.example"]}});
        assert!(
            effective_editor_configuration(&unapproved, &config, allowed, allowed, platform)
                .is_err()
        );
    }
    #[test]
    fn approved_lan_http_origin_does_not_invent_a_loopback_only_policy() {
        let origin = "http://192.168.0.193:8082";
        let manifest = json!({"frontendDelivery":{"mode":"SOURCE_BOUND_PROTOCOL",
            "launchDescriptorSchemaVersion":"1","editorOrigins":[origin]}});
        assert_eq!(
            effective_editor_configuration(
                &manifest,
                &json!({"editorOrigin":origin}),
                origin,
                origin,
                "http://192.168.0.193:8080"
            )
            .unwrap(),
            origin
        );
    }
}
