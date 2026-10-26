//! DD-158(3): the session Tenant display profile, changed only by governed version CAS.
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use base64::Engine;
use contracts::{ReasonCode, TenantProfileInput};
use serde_json::{json, Value};
use sqlx::{postgres::PgListener, PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::{
    bff::{resolve_execution_context, BffState},
    governance::{Definition, Execution, Params, Refusal, Target},
};

pub(crate) const ACTION: &str = "tenant.profile.update";
const PROFILE_CHANNEL: &str = "kailo_tenant_profile_changed";
const MAX_ICON_BYTES: usize = 96 * 1024;

/// One LISTEN connection per Core, shared by all admitted profile watches.
/// A coalesced/lagged hint triggers a fresh read; it is never a profile cache.
pub(crate) async fn spawn_updates(state: &BffState) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(&state.pool).await?;
    listener.listen(PROFILE_CHANNEL).await?;
    let pool = state.pool.clone();
    let updates = state.tenant_profile_updates.clone();
    let retry = std::time::Duration::from_millis(state.stream_retry_millis);
    tokio::spawn(async move {
        loop {
            match listener.try_recv().await {
                Ok(Some(notification)) => {
                    if let Ok(tenant) = notification.payload().parse() {
                        let _ = updates.send(tenant);
                    }
                }
                // Reconnected: a notification could have been lost. All
                // consumers reread their own admitted Tenant, never the hint.
                Ok(None) => {
                    let _ = updates.send(Uuid::nil());
                }
                Err(error) => {
                    tracing::warn!(error = %error, "Tenant profile invalidation connection unavailable");
                    tokio::time::sleep(retry).await;
                    if let Ok(mut next) = PgListener::connect_with(&pool).await {
                        if next.listen(PROFILE_CHANNEL).await.is_ok() {
                            listener = next;
                            let _ = updates.send(Uuid::nil());
                        }
                    }
                }
            }
        }
    });
    Ok(())
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProfileQuery {
    /// An existing profile version makes this a bounded, read-only watch.
    after_version: Option<i32>,
}
fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}
fn conflict() -> Refusal {
    Refusal::Conflict(ReasonCode::TargetStateConflict)
}

fn valid_icon(icon: &str) -> bool {
    if icon.len() > MAX_ICON_BYTES {
        return false;
    }
    if !icon.starts_with("data:") {
        return emojis::get(icon).is_some();
    }
    let Some((mime, encoded)) = icon
        .strip_prefix("data:")
        .and_then(|v| v.split_once(";base64,"))
    else {
        return false;
    };
    let format = match mime {
        "image/png" => image::ImageFormat::Png,
        "image/jpeg" => image::ImageFormat::Jpeg,
        "image/webp" => image::ImageFormat::WebP,
        _ => return false,
    };
    let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
        return false;
    };
    if image::guess_format(&bytes).ok() != Some(format) {
        return false;
    }
    let reader = image::ImageReader::with_format(std::io::Cursor::new(&bytes), format);
    let Ok((width, height)) = reader.into_dimensions() else {
        return false;
    };
    if width == 0 || height == 0 || width > 256 || height > 256 {
        return false;
    }
    image::load_from_memory_with_format(&bytes, format).is_ok()
}

pub(crate) fn normalize(input: &TenantProfileInput) -> Result<Value, Refusal> {
    let name = input.name.as_deref().map(str::trim);
    if name
        .is_some_and(|v| v.is_empty() || v.chars().count() > 64 || v.chars().any(char::is_control))
        || input.icon.as_deref().is_some_and(|v| !valid_icon(v))
        || (input.clear_icon == Some(true) && input.icon.is_some())
        || (name.is_none() && input.icon.is_none() && input.clear_icon != Some(true))
    {
        return Err(invalid());
    }
    let mut normalized = serde_json::Map::new();
    if let Some(name) = name {
        normalized.insert("name".into(), json!(name));
    }
    if let Some(icon) = &input.icon {
        normalized.insert("icon".into(), json!(icon));
    }
    if input.clear_icon == Some(true) {
        normalized.insert("clearIcon".into(), json!(true));
    }
    Ok(Value::Object(normalized))
}

pub(crate) fn validate_params(p: &Params) -> Result<(), Refusal> {
    let expected = Params {
        tenant_profile: p.tenant_profile.clone(),
        resource_version: p.resource_version,
        explicit_confirmation: p.explicit_confirmation,
        ..Params::default()
    };
    if *p != expected
        || p.explicit_confirmation != Some(true)
        || p.resource_version.is_none_or(|v| v <= 0)
    {
        return Err(invalid());
    }
    let input: TenantProfileInput =
        serde_json::from_value(p.tenant_profile.clone().ok_or_else(invalid)?)
            .map_err(|_| invalid())?;
    if normalize(&input)? != *p.tenant_profile.as_ref().ok_or_else(invalid)? {
        return Err(invalid());
    }
    Ok(())
}

fn definition(d: &Definition) -> Result<(), Refusal> {
    if d.action_key != ACTION
        || d.component_type_key != "core"
        || d.target_type != "TENANT"
        || d.tenant_rule != "SESSION_TENANT"
        || d.workspace_rule != "TENANT_ONLY"
        || d.permission != "manage"
        || d.permission_object_type != "tenant"
        || d.execution_mode != "SYNC"
        || d.confirmation_mode != "EXPLICIT"
        || d.approval_policy_id.is_some()
        || d.approval_policy_version.is_some()
        || d.workflow_kind.is_some()
        || d.quota_policy != "NONE"
        || !d.meters.is_empty()
        || d.result_exposure != "NONE"
        || d.role_template_key.is_some()
        || d.role_template_version.is_some()
    {
        return Err(Refusal::Blocked(ReasonCode::CapabilityBlocked));
    }
    Ok(())
}

pub(crate) async fn target(
    conn: &mut PgConnection,
    tenant: Uuid,
    def: &Definition,
    p: &Params,
    frozen: Option<Uuid>,
    lock: bool,
) -> Result<Target, Refusal> {
    definition(def)?;
    validate_params(p)?;
    if frozen.is_some_and(|id| id != tenant)
        || crate::platform_bootstrap::is_catalog_tenant(&mut *conn, tenant).await?
    {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let row: Option<(i32, String)> = sqlx::query_as(&format!(
        "select version,state from identity.tenant where id=$1{}",
        if lock { " for update" } else { "" }
    ))
    .bind(tenant)
    .fetch_optional(conn)
    .await?;
    match row {
        Some((version, state)) if state == "ACTIVE" && Some(version) == p.resource_version => {
            Ok(Target {
                id: tenant,
                version,
                workspace_id: None,
            })
        }
        Some(_) => Err(conflict()),
        None => Err(Refusal::Precondition(ReasonCode::TargetNotFound)),
    }
}

pub(crate) async fn prewrite(
    tx: &mut Transaction<'_, Postgres>,
    ae: &Execution,
    def: &Definition,
    p: &Params,
) -> Result<(), Refusal> {
    let target = target(tx, ae.tenant_id, def, p, Some(ae.target_id), true).await?;
    if !crate::agent_definition::active_owner(tx, ae.tenant_id, ae.initiator_principal_id).await? {
        return Err(Refusal::Denied(ReasonCode::ScopeGuardFailed));
    }
    let input = p.tenant_profile.as_ref().ok_or_else(invalid)?;
    let updated = sqlx::query("update identity.tenant set name=coalesce($3,name),icon=case when $5 then null else coalesce($4,icon) end,version=version+1 where id=$1 and version=$2 and state='ACTIVE'")
        .bind(target.id).bind(target.version).bind(input.get("name").and_then(Value::as_str))
        .bind(input.get("icon").and_then(Value::as_str)).bind(input.get("clearIcon").and_then(Value::as_bool).unwrap_or(false))
        .execute(&mut **tx).await?;
    if updated.rows_affected() != 1 {
        return Err(conflict());
    }
    // PostgreSQL emits this only after the surrounding admission/result/audit
    // transaction commits. A rollback cannot invalidate or expose a new name.
    sqlx::query("select pg_notify($1,$2)")
        .bind(PROFILE_CHANNEL)
        .bind(target.id.to_string())
        .execute(&mut **tx)
        .await?;
    Ok(())
}

pub async fn read(
    State(state): State<BffState>,
    Query(query): Query<ProfileQuery>,
    headers: HeaderMap,
) -> Response {
    if query.after_version.is_some_and(|version| version < 1) {
        return StatusCode::BAD_REQUEST.into_response();
    }
    // Subscribe before reading: an update between the snapshot and wait must
    // not be missed. A finite wait also heals a lost database notification.
    let mut updates = state.tenant_profile_updates.subscribe();
    let deadline =
        tokio::time::Instant::now() + std::time::Duration::from_secs(state.stream_readmit_seconds);
    loop {
        let view = match read_view(&state, &headers).await {
            Ok(view) => view,
            Err(response) => return response,
        };
        if query.after_version != Some(view.1) || tokio::time::Instant::now() >= deadline {
            return ([("cache-control", "no-store")], Json(view.2)).into_response();
        }
        let tenant = view.0;
        loop {
            match tokio::time::timeout_at(deadline, updates.recv()).await {
                Ok(Ok(changed)) if changed != tenant && !changed.is_nil() => continue,
                // Timeout, lag, reconnection and a matching invalidation all
                // require a fresh session/member/permission read before reply.
                _ => break,
            }
        }
    }
}

async fn read_view(state: &BffState, headers: &HeaderMap) -> Result<(Uuid, i32, Value), Response> {
    let ctx = match resolve_execution_context(state, headers).await {
        Ok(c) => c,
        Err(r) => return Err(r),
    };
    let row: Option<(String, Option<String>, i32)> = match sqlx::query_as("select t.name,t.icon,t.version from identity.tenant t where t.id=$1 and t.state='ACTIVE' and exists(select 1 from identity.principal p join identity.tenant_membership m on m.tenant_principal_id=p.id where p.id=$2 and p.tenant_id=t.id and m.tenant_id=t.id and p.kind='HUMAN' and p.status='ACTIVE' and m.state='ACTIVE')")
        .bind(ctx.tenant_id).bind(ctx.tenant_principal_id).fetch_optional(&state.pool).await {
        Ok(r) => r, Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    };
    let Some((name, icon, version)) = row else {
        return Err(StatusCode::FORBIDDEN.into_response());
    };
    let mut view =
        json!({"name":name,"version":version,"refreshAfterMillis":state.stream_retry_millis});
    if let Some(icon) = icon {
        view["icon"] = json!(icon);
    }
    let mut conn = match state.pool.acquire().await {
        Ok(c) => c,
        Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    };
    let catalog = match crate::platform_bootstrap::is_catalog_tenant(&mut conn, ctx.tenant_id).await
    {
        Ok(c) => c,
        Err(_) => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
    };
    drop(conn);
    if !catalog && crate::capability_registry::action_exposed(ACTION) {
        match state
            .governance
            .spicedb
            .check(
                "tenant",
                &ctx.tenant_id.to_string(),
                "manage",
                &ctx.tenant_principal_id.to_string(),
                crate::spicedb::Consistency::FullyConsistent,
            )
            .await
        {
            Ok(c) if !c.zed_token.is_empty() => {
                if c.allowed {
                    view["updateActionKey"] = json!(ACTION);
                }
            }
            _ => return Err(StatusCode::SERVICE_UNAVAILABLE.into_response()),
        }
    }
    Ok((ctx.tenant_id, version, view))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(value: Value) -> TenantProfileInput {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn bounded_real_images_single_emoji_and_normalized_name() {
        assert_eq!(
            normalize(&input(json!({"name":" 社区 "}))).unwrap(),
            json!({"name":"社区"})
        );
        for value in [
            json!({}),
            json!({"name":" "}),
            json!({"name":"字".repeat(65)}),
            json!({"icon":"hello"}),
            json!({"icon":"🎉🎉"}),
            json!({"icon":"🎉","clearIcon":true}),
            json!({"icon":"https://example.org/icon.png"}),
        ] {
            assert!(normalize(&input(value)).is_err());
        }
        for emoji in ["🎉", "👨‍👩‍👧‍👦", "👩🏽‍🚀", "🇨🇳"] {
            assert!(valid_icon(emoji));
        }
        for (size, expected) in [(256, true), (257, false)] {
            let mut bytes = std::io::Cursor::new(Vec::new());
            image::DynamicImage::new_rgba8(size, 1)
                .write_to(&mut bytes, image::ImageFormat::Png)
                .unwrap();
            let encoded = base64::engine::general_purpose::STANDARD.encode(bytes.into_inner());
            assert_eq!(
                valid_icon(&format!("data:image/png;base64,{encoded}")),
                expected
            );
            assert!(!valid_icon(&format!("data:image/jpeg;base64,{encoded}")));
        }
        assert!(!valid_icon("data:image/png;base64,iVBORw0KGgo="));
    }

    #[tokio::test]
    #[ignore = "requires TENANT_PROFILE_TEST_DATABASE_URL pointing at an isolated migrated database"]
    async fn actual_profile_prewrite_checks_member_policy_and_cas_without_changing_slug() {
        let pool =
            sqlx::PgPool::connect(&std::env::var("TENANT_PROFILE_TEST_DATABASE_URL").unwrap())
                .await
                .unwrap();
        let mut listener = PgListener::connect_with(&pool).await.unwrap();
        listener.listen(PROFILE_CHANNEL).await.unwrap();
        let mut tx = pool.begin().await.unwrap();
        let tenant = Uuid::new_v4();
        let principal = Uuid::new_v4();
        let human = Uuid::new_v4();
        let slug = format!("profile-{tenant}");
        sqlx::query(
            "insert into identity.tenant(id,slug,name,state) values($1,$2,'before','ACTIVE')",
        )
        .bind(tenant)
        .bind(&slug)
        .execute(&mut *tx)
        .await
        .unwrap();
        sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'profile fixture','ACTIVE')").bind(human).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')").bind(principal).bind(tenant).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$3,$4,'ACTIVE')").bind(Uuid::new_v4()).bind(tenant).bind(human).bind(principal).execute(&mut *tx).await.unwrap();
        let mut def: Definition = sqlx::query_as(&format!(
            "select {} from catalog.action_definition where action_key=$1 and version=1",
            crate::governance::DEFINITION_COLUMNS
        ))
        .bind(ACTION)
        .fetch_one(&mut *tx)
        .await
        .unwrap();
        let mut params = Params {
            tenant_profile: Some(json!({"name":"after","icon":"🎉"})),
            resource_version: Some(1),
            explicit_confirmation: Some(true),
            ..Default::default()
        };
        let ae = Execution {
            id: Uuid::new_v4(),
            operation_id: Uuid::new_v4(),
            tenant_id: tenant,
            workspace_id: None,
            action_key: ACTION.into(),
            action_version: 1,
            initiator_principal_id: principal,
            actor_principal_id: principal,
            target_id: tenant,
            parameter_hash: String::new(),
            parameters: None,
            temporal_workflow_id: None,
            cancel_first_run_id: None,
            approval_workflow_id: None,
            approval_expires_at: None,
            gate_state: "ALLOWED".into(),
            dispatch_state: "NOT_DISPATCHED".into(),
            reason_code: None,
            correlation_id: Uuid::new_v4(),
            updated_at: chrono::Utc::now(),
        };
        def.workspace_rule = "CURRENT_WORKSPACE".into();
        assert!(prewrite(&mut tx, &ae, &def, &params).await.is_err());
        def.workspace_rule = "TENANT_ONLY".into();
        assert!(
            target(&mut tx, tenant, &def, &params, Some(Uuid::new_v4()), true)
                .await
                .is_err()
        );
        prewrite(&mut tx, &ae, &def, &params).await.unwrap();
        let row: (String, Option<String>, i32, String) =
            sqlx::query_as("select name,icon,version,slug from identity.tenant where id=$1")
                .bind(tenant)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(row, ("after".into(), Some("🎉".into()), 2, slug));
        assert!(prewrite(&mut tx, &ae, &def, &params).await.is_err());
        params.resource_version = Some(2);
        params.tenant_profile = Some(json!({"clearIcon":true}));
        prewrite(&mut tx, &ae, &def, &params).await.unwrap();
        let icon: Option<String> =
            sqlx::query_scalar("select icon from identity.tenant where id=$1")
                .bind(tenant)
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert!(icon.is_none());
        tx.commit().await.unwrap();
        let notification = tokio::time::timeout(std::time::Duration::from_secs(5), listener.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(notification.payload(), tenant.to_string());
        async fn competing_write(
            pool: &sqlx::PgPool,
            ae: &Execution,
            def: &Definition,
            name: &str,
        ) -> Result<(), Refusal> {
            let mut tx = pool.begin().await?;
            let params = Params {
                tenant_profile: Some(json!({"name":name})),
                resource_version: Some(3),
                explicit_confirmation: Some(true),
                ..Default::default()
            };
            prewrite(&mut tx, ae, def, &params).await?;
            tx.commit().await?;
            Ok(())
        }
        let (first, second) = tokio::join!(
            competing_write(&pool, &ae, &def, "first"),
            competing_write(&pool, &ae, &def, "second")
        );
        match (first, second) {
            (Ok(()), Err(refused)) | (Err(refused), Ok(())) => assert!(matches!(
                refused,
                Refusal::Conflict(ReasonCode::TargetStateConflict)
            )),
            other => {
                panic!("one concurrent request must win and the other must conflict: {other:?}")
            }
        }
        let (version, name): (i32, String) =
            sqlx::query_as("select version,name from identity.tenant where id=$1")
                .bind(tenant)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(version, 4);
        assert!(matches!(name.as_str(), "first" | "second"));
        let notification = tokio::time::timeout(std::time::Duration::from_secs(5), listener.recv())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(notification.payload(), tenant.to_string());
        // A later admission/audit failure rolls the profile and its hint back
        // together. Another live client must not observe this attempted name.
        let mut rolled_back = pool.begin().await.unwrap();
        params.resource_version = Some(4);
        prewrite(&mut rolled_back, &ae, &def, &params)
            .await
            .unwrap();
        rolled_back.rollback().await.unwrap();
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), listener.recv())
                .await
                .is_err()
        );
        let actual: (i32, String) =
            sqlx::query_as("select version,name from identity.tenant where id=$1")
                .bind(tenant)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(actual, (version, name));
        let mut tx = pool.begin().await.unwrap();
        params.resource_version = Some(4);
        sqlx::query(
            "update identity.tenant_membership set state='REVOKED' where tenant_principal_id=$1",
        )
        .bind(principal)
        .execute(&mut *tx)
        .await
        .unwrap();
        assert!(prewrite(&mut tx, &ae, &def, &params).await.is_err());
        tx.rollback().await.unwrap();
    }
}
