//! DD-149(6): OAuth 2.1 for connectors, per the MCP authorization specification.
//!
//! An attempt is started by an admitted HUMAN: Core discovers the protected resource
//! and authorization server metadata, registers a public client (or takes the
//! pre-registered one), and returns the authorization URL with PKCE S256 and the
//! resource indicator. The callback lands on Kailo's own origin; `state` is a single
//! use random value whose digest alone is stored. Tokens go to OpenBao only; the
//! callback page carries no token. Grants are connection-shared (the registrant's).

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{DateTime, Duration, Utc};
use contracts::ReasonCode;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use super::{credential, invalid, not_active, unavailable};
use crate::bff::{resolve_execution_context, BffState, ExecutionContext};
use crate::governance::Refusal;
use crate::mcp_client::Credential;
use crate::mcp_egress::EgressScope;
use crate::service_api::ServiceState;

/// Attempt lifetime (state validity) and how long a completed attempt may be used.
const ATTEMPT_TTL_SECONDS: i64 = 600;
const COMPLETED_USE_SECONDS: i64 = 1800;
/// Refresh when the access token has less than this left.
const REFRESH_MARGIN_SECONDS: i64 = 60;
const AUDIT_KEY: &str = "mcp_connection.oauth";

fn state_digest(state: &str) -> String {
    hex::encode(Sha256::digest(state.as_bytes()))
}

fn redirect_uri() -> Result<String, Refusal> {
    let origin =
        crate::component_directory::public_origin().ok_or_else(|| unavailable("PUBLIC_ORIGIN"))?;
    Ok(format!(
        "{}/api/v1/mcp-connections/oauth/callback",
        origin.trim_end_matches('/')
    ))
}

/// A completed attempt usable by create/rotate.
pub(crate) struct Attempt {
    pub(crate) id: Uuid,
    pub(crate) credential: secret_store::SecretRef,
    pub(crate) server: Value,
    pub(crate) client: Value,
}

impl Attempt {
    /// The connector's `oauth` column: metadata and client identity, no secret value.
    pub(crate) fn oauth_json(&self) -> Value {
        json!({"server":self.server,"client":self.client})
    }
}

#[derive(sqlx::FromRow)]
struct AttemptRow {
    id: Uuid,
    tenant_id: Uuid,
    /// Filtered in SQL by `status`; kept so the row mirrors the table.
    #[allow(dead_code)]
    session_id: Uuid,
    principal_id: Uuid,
    endpoint_url: String,
    transport: String,
    for_connection_id: Option<Uuid>,
    server: Value,
    client: Value,
    pkce_verifier: Option<String>,
    redirect_uri: String,
    state: String,
    credential_ref: Option<Value>,
    failure: Option<String>,
    expires_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

const ATTEMPT_SELECT: &str = "select id,tenant_id,session_id,principal_id,endpoint_url,transport,
    for_connection_id,server,client,pkce_verifier,redirect_uri,state,credential_ref,failure,expires_at,completed_at
    from admission.mcp_oauth_attempt";

/// A completed, unconsumed attempt of this HUMAN for exactly this endpoint/transport
/// (and, for a rotation, this connector).
pub(crate) async fn completed_attempt(
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
    id: Uuid,
    endpoint: &str,
    transport: &str,
    for_connection: Option<Uuid>,
) -> Result<Attempt, Refusal> {
    let row: AttemptRow = sqlx::query_as(&format!(
        "{ATTEMPT_SELECT} where id=$1 and tenant_id=$2 and principal_id=$3"
    ))
    .bind(id)
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .fetch_optional(conn)
    .await?
    .ok_or_else(invalid)?;
    let normalized = crate::mcp_egress::parse_endpoint(endpoint).map_err(|_| invalid())?;
    let fresh = row
        .completed_at
        .is_some_and(|at| at + Duration::seconds(COMPLETED_USE_SECONDS) > Utc::now());
    if row.state != "COMPLETED"
        || !fresh
        || row.endpoint_url != normalized.as_str()
        || row.transport != transport
        || row.for_connection_id != for_connection
    {
        return Err(invalid());
    }
    Ok(Attempt {
        id: row.id,
        credential: credential::reference_of(row.credential_ref.as_ref().ok_or_else(invalid)?)?,
        server: row.server,
        client: row.client,
    })
}

pub(crate) async fn consume_attempt(
    tx: &mut Transaction<'_, Postgres>,
    attempt: Uuid,
    action: Uuid,
) -> Result<(), Refusal> {
    let changed = sqlx::query(
        "update admission.mcp_oauth_attempt set state='CONSUMED',consumed_by_action_execution_id=$2
         where id=$1 and state='COMPLETED'",
    )
    .bind(attempt)
    .bind(action)
    .execute(&mut **tx)
    .await?;
    if changed.rows_affected() != 1 {
        return Err(super::conflict());
    }
    Ok(())
}

/// The bearer header of a completed attempt (used for the confirming probe).
pub(crate) async fn attempt_credential(
    state: &ServiceState,
    attempt: &Attempt,
) -> Result<Option<Credential>, Refusal> {
    let value = credential::read(
        state,
        &attempt.credential,
        Utc::now() - Duration::seconds(5),
    )
    .await?;
    credential::header_for("OAUTH", None, value.expose())
}

fn server_of(value: &Value) -> Result<crate::mcp_oauth::AuthServer, Refusal> {
    serde_json::from_value(value.clone()).map_err(|_| unavailable("authorization server"))
}

/// The stored client identity, with its secret (if any) read from OpenBao.
async fn client_of(
    state: &ServiceState,
    value: &Value,
) -> Result<crate::mcp_oauth::ClientRegistration, Refusal> {
    let client_id = value["clientId"]
        .as_str()
        .ok_or_else(|| unavailable("client"))?;
    let auth = match value["auth"].as_str() {
        Some("CLIENT_SECRET_BASIC") => crate::mcp_oauth::TokenAuth::ClientSecretBasic,
        Some("CLIENT_SECRET_POST") => crate::mcp_oauth::TokenAuth::ClientSecretPost,
        Some("NONE") => crate::mcp_oauth::TokenAuth::None,
        _ => return Err(unavailable("client auth")),
    };
    let client_secret = match value.get("secretRef").filter(|v| !v.is_null()) {
        Some(reference) => {
            let reference = credential::reference_of(reference)?;
            let secret =
                credential::read(state, &reference, Utc::now() - Duration::seconds(5)).await?;
            Some(secret.expose().to_owned())
        }
        None => None,
    };
    Ok(crate::mcp_oauth::ClientRegistration {
        client_id: client_id.to_owned(),
        client_secret,
        auth,
    })
}

fn auth_wire(auth: &crate::mcp_oauth::TokenAuth) -> &'static str {
    match auth {
        crate::mcp_oauth::TokenAuth::None => "NONE",
        crate::mcp_oauth::TokenAuth::ClientSecretBasic => "CLIENT_SECRET_BASIC",
        crate::mcp_oauth::TokenAuth::ClientSecretPost => "CLIENT_SECRET_POST",
    }
}

async fn egress(
    conn: &mut PgConnection,
    tenant: Uuid,
) -> Result<(crate::mcp_egress::PlatformEgress, Vec<String>), Refusal> {
    let platform = super::platform_egress()?;
    let policy = super::tenant_policy(conn, tenant).await?;
    Ok((platform, policy.egress_host_suffixes))
}

/// The access token of an OAuth connector, refreshed under the connector row lock
/// when it is about to expire (or `force` after an upstream 401). A failed refresh
/// marks the connector as needing re-authorization and refuses the call.
pub(crate) async fn fresh_credential_forced(
    state: &ServiceState,
    tenant: Uuid,
    connection: Uuid,
    force: bool,
) -> Result<Option<Credential>, Refusal> {
    let mut conn = state.pool.acquire().await?;
    let current = super::load(&mut conn, tenant, connection, false)
        .await?
        .ok_or_else(|| unavailable("connector"))?;
    let reference = current.credential()?.ok_or_else(not_active)?;
    let value = credential::read(state, &reference, Utc::now() - Duration::seconds(5)).await?;
    let tokens: crate::mcp_oauth::TokenSet =
        serde_json::from_str(value.expose()).map_err(|_| unavailable("token set"))?;
    let expiring = tokens
        .expires_at
        .is_some_and(|at| at <= Utc::now().timestamp() + REFRESH_MARGIN_SECONDS);
    if !force && !expiring {
        return credential::header_for("OAUTH", None, value.expose());
    }
    let (platform, suffixes) = egress(&mut conn, tenant).await?;
    drop(conn);
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &suffixes,
    };
    let mut tx = state.pool.begin().await?;
    let locked = super::load(&mut tx, tenant, connection, true)
        .await?
        .ok_or_else(|| unavailable("connector"))?;
    if locked.credential_ref != current.credential_ref {
        // Another call refreshed first: use its version.
        tx.commit().await?;
        let reference = locked.credential()?.ok_or_else(not_active)?;
        let value = credential::read(state, &reference, Utc::now() - Duration::seconds(5)).await?;
        return credential::header_for("OAUTH", None, value.expose());
    }
    let oauth = locked.oauth.clone().ok_or_else(not_active)?;
    let server = server_of(&oauth["server"])?;
    let client = client_of(state, &oauth["client"]).await?;
    let Some(refresh_token) = tokens.refresh_token.as_deref() else {
        drop(tx);
        mark_reauthorization(state, connection).await;
        return Err(not_active());
    };
    let refreshed = match crate::mcp_oauth::refresh(&scope, &server, &client, refresh_token).await {
        Ok(refreshed) => refreshed,
        Err(crate::mcp_oauth::OAuthError::InvalidGrant) => {
            drop(tx);
            mark_reauthorization(state, connection).await;
            return Err(not_active());
        }
        Err(_) => return Err(unavailable("token refresh")),
    };
    let text = serde_json::to_string(&refreshed).map_err(|_| unavailable("token set"))?;
    let next = credential::new_reference(state, tenant)?;
    credential::write(state, tenant, &next, &text).await?;
    sqlx::query(
        "update catalog.mcp_connection set credential_ref=$2,credential_updated_at=now(),version=version+1,updated_at=now()
         where resource_id=$1",
    )
    .bind(connection)
    .bind(credential::reference_json(&next))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    if let Err(error) = credential::retire(state, tenant, &reference, false).await {
        tracing::warn!(connector = %connection, error = ?error, "retired OAuth token version not destroyed yet");
    }
    credential::header_for("OAUTH", None, &text)
}

pub(crate) async fn fresh_credential(
    state: &ServiceState,
    tenant: Uuid,
    connection: Uuid,
) -> Result<Option<Credential>, Refusal> {
    fresh_credential_forced(state, tenant, connection, false).await
}

async fn mark_reauthorization(state: &ServiceState, connection: Uuid) {
    let result = sqlx::query(
        "insert into projection.mcp_connection_health(resource_id,health,checked_at)
         values($1,'REAUTHORIZATION_REQUIRED',now())
         on conflict(resource_id) do update set health='REAUTHORIZATION_REQUIRED',checked_at=now()",
    )
    .bind(connection)
    .execute(&state.pool)
    .await;
    if let Err(error) = result {
        tracing::warn!(connector = %connection, error = %error, "connector health not recorded");
    }
}

async fn access_audit(
    pool: &sqlx::PgPool,
    ctx: &ExecutionContext,
    attempt: Uuid,
    stage: &str,
    result: &str,
) -> Result<(), Refusal> {
    let mut tx = pool.begin().await?;
    crate::audit::append(
        &mut tx,
        crate::audit::AuditEntry {
            event_key: format!("mcp-oauth:{attempt}:{stage}"),
            tenant_id: Some(ctx.tenant_id),
            workspace_id: None,
            operation_id: attempt,
            event_type: "ACCESS",
            human_identity_id: Some(ctx.human_identity_id),
            initiator_principal_id: Some(ctx.tenant_principal_id),
            actor_principal_id: Some(ctx.tenant_principal_id),
            action_key: AUDIT_KEY,
            action_version: 1,
            component_type_key: "core",
            target_type: None,
            target_id: None,
            parameter_hash: "",
            decision: if result == "FAILED" { "DENY" } else { "ALLOW" },
            result_code: result,
            result_exposure: "NONE",
            evidence_refs: Vec::new(),
            correlation_id: attempt,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

fn view(row: &AttemptRow, authorization_url: Option<String>) -> contracts::McpOauthAttemptView {
    let state = if row.state == "PENDING" && row.expires_at <= Utc::now() {
        "EXPIRED".to_owned()
    } else {
        row.state.clone()
    };
    contracts::McpOauthAttemptView {
        attempt_id: row.id.to_string(),
        state: crate::governance::parse(&state).unwrap_or(contracts::McpOauthAttemptState::Failed),
        authorization_url,
        expires_at: row.expires_at.to_rfc3339(),
        authorization_server: row.server["issuer"].as_str().map(str::to_owned),
        failure: row.failure.clone(),
    }
}

/// `POST /api/v1/mcp-connections/oauth/attempts`
pub(crate) async fn start(
    State(state): State<BffState>,
    headers: HeaderMap,
    Json(request): Json<contracts::McpOauthStartRequest>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    match start_attempt(&state, &ctx, request).await {
        Ok(view) => Json(view).into_response(),
        Err(error) => error.respond(None),
    }
}

async fn start_attempt(
    state: &BffState,
    ctx: &ExecutionContext,
    request: contracts::McpOauthStartRequest,
) -> Result<contracts::McpOauthAttemptView, Refusal> {
    let service = &state.memory_service;
    let url = crate::mcp_egress::parse_endpoint(&request.endpoint_url).map_err(|_| invalid())?;
    let transport_wire = super::wire(&request.transport);
    let transport = super::transport(&transport_wire).ok_or_else(invalid)?;
    let for_connection = request
        .for_connection_id
        .as_deref()
        .map(Uuid::parse_str)
        .transpose()
        .map_err(|_| invalid())?;
    let mut conn = state.pool.acquire().await?;
    match for_connection {
        Some(id) => {
            let connection = super::load(&mut conn, ctx.tenant_id, id, false)
                .await?
                .ok_or(Refusal::Precondition(ReasonCode::TargetNotFound))?;
            if connection.auth_mode != "OAUTH"
                || connection.state == "DELETED"
                || connection.endpoint_url != url.as_str()
                || connection.transport != transport_wire
            {
                return Err(invalid());
            }
            super::command::check(service, "resource", id, "manage", ctx.tenant_principal_id)
                .await?
                .ok_or_else(super::denied)?;
        }
        None => {
            let personal = super::command::may_register(
                service,
                &mut conn,
                ctx.tenant_id,
                ctx.tenant_principal_id,
                "PERSONAL",
                None,
            )
            .await?;
            let tenant = match personal {
                Some(_) => None,
                None => {
                    super::command::may_register(
                        service,
                        &mut conn,
                        ctx.tenant_id,
                        ctx.tenant_principal_id,
                        "TENANT",
                        None,
                    )
                    .await?
                }
            };
            if personal.is_none()
                && tenant.is_none()
                && !workspace_admin(service, &mut conn, ctx).await?
            {
                return Err(super::denied());
            }
        }
    }
    let (platform, suffixes) = egress(&mut conn, ctx.tenant_id).await?;
    drop(conn);
    let scope = EgressScope {
        platform: &platform,
        tenant_suffixes: &suffixes,
    };
    if !crate::mcp_egress::host_permitted(&scope, url.host_str().unwrap_or_default()) {
        return Err(super::denied());
    }
    let server = crate::mcp_oauth::discover(&scope, &url, transport, None, None)
        .await
        .map_err(|_| invalid())?;
    let redirect = redirect_uri()?;
    let client = match (
        request
            .client_id
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty()),
        request.client_secret,
    ) {
        (Some(client_id), secret) => crate::mcp_oauth::ClientRegistration {
            client_id: client_id.to_owned(),
            auth: if secret.is_some() {
                crate::mcp_oauth::TokenAuth::ClientSecretBasic
            } else {
                crate::mcp_oauth::TokenAuth::None
            },
            client_secret: secret.filter(|v| !v.is_empty()),
        },
        (None, Some(_)) => return Err(invalid()),
        (None, None) => {
            if server.registration_endpoint.is_none() {
                return Err(invalid());
            }
            crate::mcp_oauth::register(&scope, &server, &redirect, "Kailo")
                .await
                .map_err(|_| invalid())?
        }
    };
    let secret_ref = match &client.client_secret {
        Some(secret) => {
            let reference = credential::new_reference(service, ctx.tenant_id)?;
            credential::write(service, ctx.tenant_id, &reference, secret).await?;
            Some(credential::reference_json(&reference))
        }
        None => None,
    };
    let client_json =
        json!({"clientId":client.client_id,"auth":auth_wire(&client.auth),"secretRef":secret_ref});
    let server_json =
        serde_json::to_value(&server).map_err(|_| unavailable("authorization server"))?;
    // Expired attempts drop their verifier before a new one is issued.
    expire(&state.pool).await?;
    let pkce = crate::mcp_oauth::pkce();
    let state_value = crate::mcp_oauth::random_state();
    let authorization_url = crate::mcp_oauth::authorization_url(
        &server,
        &client.client_id,
        &redirect,
        &state_value,
        &pkce.challenge,
    );
    let id = Uuid::new_v4();
    let row: AttemptRow = sqlx::query_as(
        "insert into admission.mcp_oauth_attempt(id,tenant_id,session_id,principal_id,endpoint_url,transport,
         for_connection_id,server,client,state_digest,pkce_verifier,redirect_uri,state,expires_at)
         values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING',now()+make_interval(secs=>$13::bigint))
         returning id,tenant_id,session_id,principal_id,endpoint_url,transport,for_connection_id,server,client,
           pkce_verifier,redirect_uri,state,credential_ref,failure,expires_at,completed_at",
    )
    .bind(id)
    .bind(ctx.tenant_id)
    .bind(ctx.session_id)
    .bind(ctx.tenant_principal_id)
    .bind(url.as_str())
    .bind(&transport_wire)
    .bind(for_connection)
    .bind(&server_json)
    .bind(&client_json)
    .bind(state_digest(&state_value))
    .bind(&pkce.verifier)
    .bind(&redirect)
    .bind(ATTEMPT_TTL_SECONDS)
    .fetch_one(&state.pool)
    .await?;
    access_audit(&state.pool, ctx, id, "start", "PENDING").await?;
    Ok(view(&row, Some(authorization_url.to_string())))
}

async fn workspace_admin(
    state: &ServiceState,
    conn: &mut PgConnection,
    ctx: &ExecutionContext,
) -> Result<bool, Refusal> {
    let workspaces: Vec<Uuid> = sqlx::query_scalar(
        "select id from identity.workspace where tenant_id=$1 and state='ACTIVE' order by id limit 200",
    )
    .bind(ctx.tenant_id)
    .fetch_all(&mut *conn)
    .await?;
    for workspace in workspaces {
        if super::command::check(
            state,
            "workspace",
            workspace,
            "manage",
            ctx.tenant_principal_id,
        )
        .await?
        .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `GET /api/v1/mcp-connections/oauth/attempts/{id}` — only the starting session.
pub(crate) async fn status(
    State(state): State<BffState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    let row: Result<Option<AttemptRow>, sqlx::Error> = sqlx::query_as(&format!(
        "{ATTEMPT_SELECT} where id=$1 and tenant_id=$2 and principal_id=$3 and session_id=$4"
    ))
    .bind(id)
    .bind(ctx.tenant_id)
    .bind(ctx.tenant_principal_id)
    .bind(ctx.session_id)
    .fetch_optional(&state.pool)
    .await;
    match row {
        Ok(Some(row)) => Json(view(&row, None)).into_response(),
        Ok(None) => Refusal::Precondition(ReasonCode::TargetNotFound).respond(None),
        Err(error) => Refusal::from(error).respond(None),
    }
}

#[derive(serde::Deserialize)]
pub(crate) struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

fn page(status: StatusCode, ok: bool) -> Response {
    let (zh, en) = if ok {
        (
            "授权已完成，可以关闭此窗口并回到 Kailo。",
            "Authorization complete. You can close this window and return to Kailo.",
        )
    } else {
        (
            "授权未完成，请回到 Kailo 重新发起。",
            "Authorization was not completed. Return to Kailo and try again.",
        )
    };
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Kailo</title></head><body><p>{zh}</p><p>{en}</p></body></html>"
    );
    let mut response = (status, body).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static("default-src 'none'; frame-ancestors 'none'"),
    );
    response
}

/// `GET /api/v1/mcp-connections/oauth/callback` on Kailo's own origin. The resolved
/// HUMAN must be the one who started the attempt; the state is single use.
pub(crate) async fn callback(
    State(state): State<BffState>,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Response {
    let ctx = match resolve_execution_context(&state, &headers).await {
        Ok(ctx) => ctx,
        Err(response) => return response,
    };
    match finish_callback(&state, &ctx, query).await {
        Ok(()) => page(StatusCode::OK, true),
        Err(error) => {
            if let Refusal::Unavailable(detail) = &error {
                tracing::warn!(error = %detail, "connector OAuth callback unavailable");
            }
            page(error.class_status().1, false)
        }
    }
}

async fn finish_callback(
    state: &BffState,
    ctx: &ExecutionContext,
    query: CallbackQuery,
) -> Result<(), Refusal> {
    let service = &state.memory_service;
    let state_value = query
        .state
        .filter(|s| !s.is_empty() && s.len() <= 512)
        .ok_or_else(invalid)?;
    let mut tx = state.pool.begin().await?;
    let row: AttemptRow = sqlx::query_as(&format!(
        "{ATTEMPT_SELECT} where state_digest=$1 for update"
    ))
    .bind(state_digest(&state_value))
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(invalid)?;
    if row.tenant_id != ctx.tenant_id || row.principal_id != ctx.tenant_principal_id {
        return Err(super::denied());
    }
    if row.state != "PENDING" || row.expires_at <= Utc::now() {
        return Err(invalid());
    }
    let fail = |reason: &'static str| reason;
    let outcome: Result<(String, crate::mcp_oauth::TokenSet), &'static str> = async {
        if query.error.is_some() {
            return Err(fail("AUTHORIZATION_DENIED"));
        }
        let code = query
            .code
            .as_deref()
            .filter(|c| !c.is_empty() && c.len() <= 4096)
            .ok_or("INVALID_CALLBACK")?;
        let verifier = row.pkce_verifier.as_deref().ok_or("INVALID_CALLBACK")?;
        let server = server_of(&row.server).map_err(|_| "DISCOVERY")?;
        let client = client_of(service, &row.client)
            .await
            .map_err(|_| "CLIENT")?;
        let mut conn = state.pool.acquire().await.map_err(|_| "UNAVAILABLE")?;
        let (platform, suffixes) = egress(&mut conn, ctx.tenant_id)
            .await
            .map_err(|_| "EGRESS")?;
        drop(conn);
        let scope = EgressScope {
            platform: &platform,
            tenant_suffixes: &suffixes,
        };
        let tokens =
            crate::mcp_oauth::exchange(&scope, &server, &client, code, verifier, &row.redirect_uri)
                .await
                .map_err(|_| "TOKEN_EXCHANGE")?;
        let text = serde_json::to_string(&tokens).map_err(|_| "TOKEN_EXCHANGE")?;
        Ok((text, tokens))
    }
    .await;
    match outcome {
        Ok((text, _tokens)) => {
            let reference = credential::new_reference(service, ctx.tenant_id)?;
            credential::write(service, ctx.tenant_id, &reference, &text).await?;
            sqlx::query(
                "update admission.mcp_oauth_attempt set state='COMPLETED',pkce_verifier=null,credential_ref=$2,completed_at=now()
                 where id=$1 and state='PENDING'",
            )
            .bind(row.id)
            .bind(credential::reference_json(&reference))
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            access_audit(&state.pool, ctx, row.id, "callback", "COMPLETED").await?;
            Ok(())
        }
        Err(reason) => {
            sqlx::query(
                "update admission.mcp_oauth_attempt set state='FAILED',pkce_verifier=null,failure=$2 where id=$1 and state='PENDING'",
            )
            .bind(row.id)
            .bind(reason)
            .execute(&mut *tx)
            .await?;
            tx.commit().await?;
            access_audit(&state.pool, ctx, row.id, "callback", "FAILED").await?;
            Err(invalid())
        }
    }
}

/// Expired PENDING attempts drop their verifier (no code can be redeemed later).
pub(crate) async fn expire(pool: &sqlx::PgPool) -> Result<u64, sqlx::Error> {
    Ok(sqlx::query(
        "update admission.mcp_oauth_attempt set state='EXPIRED',pkce_verifier=null
         where state='PENDING' and expires_at<now()",
    )
    .execute(pool)
    .await?
    .rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_is_stored_only_as_a_digest() {
        let value = crate::mcp_oauth::random_state();
        let digest = state_digest(&value);
        assert_eq!(digest.len(), 64);
        assert!(!digest.contains(&value));
        assert_ne!(digest, state_digest(&crate::mcp_oauth::random_state()));
    }

    #[test]
    fn callback_page_carries_no_token_and_forbids_framing() {
        let response = page(StatusCode::OK, true);
        let headers = response.headers();
        assert_eq!(headers[header::CACHE_CONTROL], "no-store");
        assert_eq!(headers[header::REFERRER_POLICY], "no-referrer");
        assert!(headers[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
    }
}
