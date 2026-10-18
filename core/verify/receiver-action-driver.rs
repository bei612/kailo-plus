//! DD-124(4), 07 §8A: the isolated receiver deployment's entry for APPLICATION
//! receiver steps (a capability action that reads its source through
//! READ_EDGE, such as knowledge.ingest). Compiled only into the original Core
//! test binary; it adds no production route, admission path or result.
//!
//! The production Worker calls it at `environment.receiverActionBaseUrl` with
//! the frozen ComponentNativeReceiverRequest and Core's isolated conformance
//! token. It verifies that token against the delivered identity, submits the
//! HUMAN action through the isolated Core's own action endpoint as the signed
//! actor (the isolated Core admits, refuses and dispatches it; the receiver's
//! request_read_grant anchors on that execution) and answers only from facts
//! the isolated Core recorded: the action's terminal audit, its
//! ExternalExecution and each anchored SOURCE read observed through the
//! original observe-only branch with the receiver's SERVICE identity. Pending
//! work is answered 503 and observed again; nothing is predicted or filled in.
use super::*;
use std::{os::unix::fs::PermissionsExt, path::Path, sync::Arc, time::Duration};

type Error = Box<dyn std::error::Error + Send + Sync>;

const DENIED: &str = r#"{"class":"DENIED","reason":"PERMISSION_DENIED"}"#;

fn private_file(path: &str) -> Result<Vec<u8>, Error> {
    let path = Path::new(path);
    let metadata = std::fs::symlink_metadata(path)?;
    if !path.is_absolute()
        || path.canonicalize()? != path
        || !metadata.is_file()
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err("private canonical driver file required".into());
    }
    Ok(std::fs::read(path)?)
}

fn field<'a>(value: &'a Value, key: &str) -> Result<&'a str, Error> {
    value[key]
        .as_str()
        .filter(|s| !s.trim().is_empty() && s.trim() == *s)
        .ok_or_else(|| format!("missing or invalid driver field: {key}").into())
}

fn uuid_of(value: &Value, key: &str) -> Result<Uuid, Error> {
    let id = Uuid::parse_str(field(value, key)?)?;
    if id.is_nil() {
        return Err("nil driver identity".into());
    }
    Ok(id)
}

fn exact(value: &Value, keys: &[&str]) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == keys.len() && keys.iter().all(|key| object.contains_key(*key))
}

fn origin(value: &str) -> Result<reqwest::Url, Error> {
    let url = reqwest::Url::parse(value)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("isolated origin with path / required".into());
    }
    Ok(url)
}

/// The owner-only driver configuration delivered by receiver-run.sh.
fn prepare(mut config: Value) -> Result<Value, Error> {
    let keys = [
        "mode",
        "environmentId",
        "listen",
        "coreOrigin",
        "serviceOrigin",
        "productionCoreOrigin",
        "identityFile",
        "jwksFile",
        "receiverBindingId",
        "receiverGeneration",
        "oidcTokenUrl",
        "oidcClientId",
        "oidcClientSecretFile",
        "actors",
        "steps",
        "httpTimeoutSeconds",
        "maxBodyBytes",
    ];
    if !exact(&config, &keys) || config["mode"] != "CONFORMANCE_ONLY" {
        return Err("isolated driver boundary refused".into());
    }
    let production = origin(field(&config, "productionCoreOrigin")?)?.origin();
    for key in ["coreOrigin", "serviceOrigin"] {
        if origin(field(&config, key)?)?.origin() == production {
            return Err("dedicated isolated Core origins required".into());
        }
    }
    field(&config, "listen")?.parse::<std::net::SocketAddr>()?;
    uuid_of(&config, "environmentId")?;
    uuid_of(&config, "receiverBindingId")?;
    for key in [
        "identityFile",
        "jwksFile",
        "oidcTokenUrl",
        "oidcClientId",
        "oidcClientSecretFile",
    ] {
        field(&config, key)?;
    }
    for key in ["receiverGeneration", "httpTimeoutSeconds", "maxBodyBytes"] {
        if config[key]
            .as_u64()
            .is_none_or(|v| v == 0 || v > u32::MAX as u64)
        {
            return Err("explicit bounded driver configuration required".into());
        }
    }
    let actors = config["actors"].as_array().filter(|a| a.len() >= 2);
    for actor in actors.ok_or("permitted and denied actors required")? {
        if !exact(actor, &["principalId", "tokenFile"]) {
            return Err("actor needs exactly principalId and tokenFile".into());
        }
        uuid_of(actor, "principalId")?;
        field(actor, "tokenFile")?;
    }
    let steps = config["steps"].as_array().filter(|s| !s.is_empty());
    for step in steps.ok_or("APPLICATION receiver steps required")? {
        let keys = [
            "caseKey",
            "stepKey",
            "input",
            "resultExposurePolicyId",
            "resultExposurePolicyVersion",
        ];
        if !exact(step, &keys) || !step["input"].is_object() {
            return Err("step needs its frozen input and isolated exposure policy".into());
        }
        uuid_of(step, "resultExposurePolicyId")?;
        if step["resultExposurePolicyVersion"]
            .as_i64()
            .is_none_or(|v| v <= 0)
        {
            return Err("exposure policy version required".into());
        }
    }
    let identity: Value = serde_json::from_slice(&private_file(field(&config, "identityFile")?)?)?;
    for key in ["issuer", "audience"] {
        field(&identity, key)?;
    }
    if identity["contexts"].as_array().is_none_or(Vec::is_empty) {
        return Err("identity contexts required".into());
    }
    config["identity"] = identity;
    Ok(config)
}

struct Driver {
    config: Value,
    pool: sqlx::PgPool,
    http: reqwest::Client,
}

enum Answer {
    Observation(Value),
    Refused(u16, &'static str),
    Pending,
}

impl Driver {
    fn timeout(&self) -> Duration {
        Duration::from_secs(self.config["httpTimeoutSeconds"].as_u64().unwrap())
    }

    /// Verifies the production-signed token and returns its claims together
    /// with the identity context they were signed for.
    fn verify(
        &self,
        operation: &str,
        token: &str,
        request: &Value,
    ) -> Result<(Value, Value), Error> {
        use jsonwebtoken::{Algorithm, DecodingKey, Validation};
        let identity = &self.config["identity"];
        let kid = jsonwebtoken::decode_header(token)?
            .kid
            .ok_or("conformance token key id missing")?;
        let published: jsonwebtoken::jwk::JwkSet =
            serde_json::from_slice(&std::fs::read(field(&self.config, "jwksFile")?)?)?;
        let key = DecodingKey::from_jwk(published.find(&kid).ok_or("unknown key id")?)?;
        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_issuer(&[field(identity, "issuer")?]);
        validation.set_audience(&[field(identity, "audience")?]);
        validation.leeway = 0;
        let claims = jsonwebtoken::decode::<Value>(token, &key, &validation)?.claims;
        let mut signed = claims.clone();
        for registered in ["jti", "iss", "aud", "iat", "exp"] {
            signed
                .as_object_mut()
                .ok_or("claims object required")?
                .remove(registered);
        }
        let action = uuid_of(&claims, "action_execution_id")?;
        let operation_id = uuid_of(&claims, "operation_id")?;
        for context in identity["contexts"].as_array().into_iter().flatten() {
            if context["operation"] != operation {
                continue;
            }
            let expected = crate::component_conformance_identity::contextual_claims(
                context,
                action,
                operation_id,
                operation,
                request,
            );
            if expected.is_ok_and(|expected| expected == signed) {
                return Ok((claims, context.clone()));
            }
        }
        Err("token matches no delivered identity context".into())
    }

    async fn submitted(&self, actor: Uuid, key: Uuid) -> Result<Option<Execution>, Error> {
        Ok(sqlx::query_as(&format!(
            "select {} from admission.action_execution
            where initiator_principal_id=$1 and idempotency_key=$2",
            crate::governance::EXECUTION_COLUMNS
        ))
        .bind(actor)
        .bind(key)
        .fetch_optional(&self.pool)
        .await?)
    }

    /// The signed actor's own isolated session submits the frozen input once;
    /// a later call for the same key only observes what Core retained.
    async fn submit(&self, claims: &Value, step: &Value, key: Uuid) -> Result<u16, Error> {
        let actor = uuid_of(claims, "actor_principal_id")?;
        let session = self.config["actors"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|entry| entry["principalId"] == json!(actor))
            .ok_or("no isolated session for the signed actor")?;
        let token = String::from_utf8(private_file(field(session, "tokenFile")?)?)?;
        let token = token.trim();
        if token.is_empty() || token.chars().any(char::is_whitespace) {
            return Err("invalid delivered isolated session".into());
        }
        let target = uuid_of(claims, "target_id")?;
        let version: i32 = sqlx::query_scalar(
            "select version from catalog.resource where id=$1 and state='ACTIVE'",
        )
        .bind(target)
        .fetch_one(&self.pool)
        .await?;
        let command = json!({"actionKey":claims["action_key"],"idempotencyKey":key,
            "resourceId":target,"resourceVersion":version,"componentAction":{
                "actionVersion":claims["action_definition_version"],"inputReference":step["input"],
                "resultExposurePolicyId":step["resultExposurePolicyId"],
                "resultExposurePolicyVersion":step["resultExposurePolicyVersion"]}});
        let response = self
            .http
            .post(format!(
                "{}api/v1/actions",
                field(&self.config, "coreOrigin")?
            ))
            .bearer_auth(token)
            .json(&command)
            .send()
            .await?;
        // Neither the session nor the response body is printed or retained.
        Ok(response.status().as_u16())
    }

    async fn service_token(&self) -> Result<String, Error> {
        let file = field(&self.config, "oidcClientSecretFile")?;
        let secret = String::from_utf8(private_file(file)?)?;
        let response = self
            .http
            .post(field(&self.config, "oidcTokenUrl")?)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", field(&self.config, "oidcClientId")?),
                ("client_secret", secret.trim()),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            return Err("receiver SERVICE identity refused".into());
        }
        let body: Value = response.json().await?;
        Ok(field(&body, "access_token")?.to_owned())
    }

    /// Each SOURCE read anchored on the receiver action, as the isolated Core's
    /// observe-only branch reports it to the receiver's SERVICE identity.
    async fn reads(&self, receiver: &Execution) -> Result<Option<Vec<Value>>, Error> {
        let parameters = receiver.parameters.as_ref().ok_or("receiver parameters")?;
        let arguments = &parameters["inputArguments"];
        if parameters["toolParameterHash"]
            != json!(collab_bridge::limits::canonical_digest(arguments))
        {
            return Err("receiver arguments differ from the admitted parameter hash".into());
        }
        let executions: Vec<Execution> = sqlx::query_as(&format!(
            "select {} from admission.action_execution
            where tenant_id=$1 and parameters->>'componentActionKind'='SERVICE_READ'
              and parameters->>'receiverActionExecutionId'=$2 and parameters->'nativeBatch' is null
            order by id",
            crate::governance::EXECUTION_COLUMNS
        ))
        .bind(receiver.tenant_id)
        .bind(receiver.id.to_string())
        .fetch_all(&self.pool)
        .await?;
        if executions.is_empty() {
            return Ok(None);
        }
        let token = self.service_token().await?;
        let mut reads = Vec::new();
        for read in executions {
            let p = read.parameters.as_ref().ok_or("read parameters")?;
            let request = json!({"receiverBindingId":p["receiverBindingId"],
                "sourceResourceId":read.target_id,"actionKey":read.action_key,
                "actionVersion":read.action_version,"idempotencyKey":p["idempotencyKey"],
                "inputJson":collab_bridge::limits::canonical_json(&p["readReference"]),
                "receiverActionExecutionId":receiver.id,
                "receiverArgumentsJson":collab_bridge::limits::canonical_json(arguments)});
            let mut lookup = request.clone();
            lookup["observeActionExecutionId"] = json!(read.id);
            let response = self
                .http
                .post(format!(
                    "{}service/v1/adapter/request_read_grant",
                    field(&self.config, "serviceOrigin")?
                ))
                .bearer_auth(&token)
                .json(&lookup)
                .send()
                .await?;
            if !response.status().is_success() {
                return Ok(None);
            }
            let observed: Value = response.json().await?;
            if observed["outcome"] != "COMPLETED" {
                return Ok(None);
            }
            let mut entry = json!({"readRequest":request,"sourceResourceId":read.target_id});
            for key in [
                "actionExecutionId",
                "receiverActionExecutionId",
                "receiverGeneration",
                "operationId",
                "sourceBindingId",
                "sourceReceipt",
                "receiverReceipt",
            ] {
                let value = observed.get(key).ok_or("incomplete Core observation")?;
                entry[key] = value.clone();
            }
            reads.push(entry);
        }
        Ok(Some(reads))
    }

    async fn answer(
        &self,
        operation: &str,
        headers: &axum::http::HeaderMap,
        body: &[u8],
    ) -> Result<Answer, Error> {
        let request: Value = serde_json::from_slice(body)?;
        let config = &self.config;
        let header = headers.get("idempotency-key").map(|v| v.as_bytes());
        if !exact(
            &request,
            &["idempotencyKey", "bindingId", "generation", "expiresAt"],
        ) || request["bindingId"] != config["receiverBindingId"]
            || request["generation"] != config["receiverGeneration"]
            || header != request["idempotencyKey"].as_str().map(str::as_bytes)
        {
            return Ok(Answer::Refused(400, r#"{"class":"PRECONDITION"}"#));
        }
        let key = uuid_of(&request, "idempotencyKey")?;
        let token = headers
            .get(axum::http::header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.strip_prefix("Bearer "));
        let verified = token.map(|token| self.verify(operation, token, &request));
        let Some(Ok((claims, context))) = verified else {
            return Ok(Answer::Refused(401, r#"{"class":"DENIED"}"#));
        };
        // A permission-denied replay repeats the same step under another actor.
        let step_key = field(&context, "stepKey")?;
        let original = step_key.strip_prefix("permission-denied:");
        let step_key = original.unwrap_or(step_key);
        let step = config["steps"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|step| step["caseKey"] == context["caseKey"] && step["stepKey"] == step_key)
            .ok_or("no APPLICATION receiver step for the signed context")?;
        let actor = uuid_of(&claims, "actor_principal_id")?;
        let receiver = match self.submitted(actor, key).await? {
            Some(receiver) => receiver,
            None => {
                let status = self.submit(&claims, step, key).await?;
                match self.submitted(actor, key).await? {
                    Some(receiver) => receiver,
                    // The isolated Core's own synchronous refusal of this actor.
                    None if status == 403 => return Ok(Answer::Refused(403, DENIED)),
                    None => return Ok(Answer::Pending),
                }
            }
        };
        if receiver.action_key != field(&claims, "action_key")?
            || json!(receiver.target_id) != claims["target_id"]
            || receiver.actor_principal_id != actor
        {
            return Err("retained action differs from the signed context".into());
        }
        if receiver.gate_state == "DENIED" {
            return Ok(Answer::Refused(403, DENIED));
        }
        let terminal: Option<(String, chrono::DateTime<chrono::Utc>)> = sqlx::query_as(
            "select result_code,occurred_at from audit.audit_event
            where event_key=$1 and operation_id=$2 and tenant_id=$3",
        )
        .bind(format!(
            "{}:component_action:terminal",
            receiver.operation_id
        ))
        .bind(receiver.operation_id)
        .bind(receiver.tenant_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((result, finished)) = terminal else {
            return Ok(Answer::Pending);
        };
        if result != "COMPLETED" {
            return Ok(Answer::Refused(409, r#"{"class":"CONFLICT"}"#));
        }
        let native: Option<(
            Option<String>,
            Option<String>,
            chrono::DateTime<chrono::Utc>,
        )> = sqlx::query_as(
            "select e.native_id,e.native_status,a.created_at
                from admission.external_execution e
                join admission.action_execution a on a.id=e.action_execution_id
                where e.action_execution_id=$1 and e.protocol_operation='execute'
                  and e.platform_status='SUCCEEDED'",
        )
        .bind(receiver.id)
        .fetch_optional(&self.pool)
        .await?;
        let Some((Some(native_id), Some(status), started)) = native else {
            return Ok(Answer::Pending);
        };
        let Some(reads) = self.reads(&receiver).await? else {
            return Ok(Answer::Pending);
        };
        Ok(Answer::Observation(
            json!({"request":request,"nativeBatchId":Uuid::parse_str(&native_id)?,
            "nativeStatus":status,"startedAt":started.to_rfc3339(),
            "finishedAt":finished.to_rfc3339(),"completed":true,"readOperations":reads}),
        ))
    }
}

async fn respond(
    driver: Arc<Driver>,
    operation: &'static str,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};
    let json = |status: u16, body: String| {
        (
            StatusCode::from_u16(status).unwrap_or(StatusCode::SERVICE_UNAVAILABLE),
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            body,
        )
            .into_response()
    };
    let limit = driver.config["maxBodyBytes"].as_u64().unwrap() as usize;
    if body.len() > limit {
        return json(413, r#"{"class":"LIMIT"}"#.into());
    }
    match tokio::time::timeout(driver.timeout(), driver.answer(operation, &headers, &body)).await {
        Ok(Ok(Answer::Observation(value))) => json(200, value.to_string()),
        Ok(Ok(Answer::Refused(status, body))) => json(status, body.into()),
        // Pending, unavailable or uncertain: the Worker observes again later.
        _ => (StatusCode::SERVICE_UNAVAILABLE, "pending").into_response(),
    }
}

/// Existing Core test-binary entry run by tools/component-release/receiver-run.sh
/// for the registration window only; stopped by the operator afterwards.
#[tokio::test]
#[ignore = "requires the isolated receiver deployment of receiver-run.sh; never a conformance PASS"]
async fn serve_isolated_receiver_actions() -> Result<(), Error> {
    use sqlx::Connection;
    let config = prepare(serde_json::from_slice(&private_file(&std::env::var(
        "APPLICATION_RECEIVER_DRIVER_FILE",
    )?)?)?)?;
    let url = std::env::var("APPLICATION_EXECUTION_TEST_DATABASE_URL")?;
    let mut conn = PgConnection::connect(&url).await?;
    let comment: Option<String> = sqlx::query_scalar(
        "select shobj_description(oid,'pg_database') from pg_database
        where datname=current_database()",
    )
    .fetch_one(&mut conn)
    .await?;
    let marker = format!(
        "KAILO_CONFORMANCE_ONLY:{}:",
        field(&config, "environmentId")?
    );
    if !comment.is_some_and(|comment| comment.starts_with(&marker)) {
        return Err("isolated database marker refused".into());
    }
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(4)
        .connect(&url)
        .await?;
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(
            config["httpTimeoutSeconds"].as_u64().unwrap(),
        ))
        .build()?;
    let listen: std::net::SocketAddr = field(&config, "listen")?.parse()?;
    let driver = Arc::new(Driver { config, pool, http });
    let mut router = axum::Router::new();
    for operation in ["receiver_start", "receiver_observe"] {
        let driver = driver.clone();
        router = router.route(
            &format!("/component-conformance/v1/{operation}"),
            axum::routing::post(move |headers, body| respond(driver, operation, headers, body)),
        );
    }
    let listener = tokio::net::TcpListener::bind(listen).await?;
    axum::serve(listener, router).await?;
    Ok(())
}

#[test]
fn driver_configuration_is_isolated_and_exact() {
    let path = std::env::temp_dir().join(format!("receiver-driver-{}.json", Uuid::new_v4()));
    let identity = json!({"issuer":"isolated","audience":"suite","contexts":[{}]});
    std::fs::write(&path, identity.to_string()).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let identity = path.canonicalize().unwrap().to_string_lossy().into_owned();
    let config = json!({"mode":"CONFORMANCE_ONLY","environmentId":Uuid::new_v4(),
        "listen":"127.0.0.1:0","coreOrigin":"http://isolated-gateway:8080/",
        "serviceOrigin":"http://isolated-core:8082/",
        "productionCoreOrigin":"http://production-core:8082/","identityFile":identity,
        "jwksFile":"/isolated/jwks.json","receiverBindingId":Uuid::new_v4(),"receiverGeneration":1,
        "oidcTokenUrl":"http://isolated-idp/token","oidcClientId":"receiver",
        "oidcClientSecretFile":"/isolated/secret","actors":[
            {"principalId":Uuid::new_v4(),"tokenFile":"/isolated/actor"},
            {"principalId":Uuid::new_v4(),"tokenFile":"/isolated/denied"}],
        "steps":[{"caseKey":"knowledge:3:knowledge_roundtrip","stepKey":"ingest","input":{},
            "resultExposurePolicyId":Uuid::new_v4(),"resultExposurePolicyVersion":1}],
        "httpTimeoutSeconds":5,"maxBodyBytes":65536});
    assert!(prepare(config.clone()).is_ok());
    let mut production = config.clone();
    production["serviceOrigin"] = config["productionCoreOrigin"].clone();
    assert!(prepare(production).is_err());
    let mut extra = config.clone();
    extra["receiverActionExecutionId"] = json!(Uuid::new_v4());
    assert!(prepare(extra).is_err());
    let mut one = config.clone();
    one["actors"] = json!([config["actors"][0]]);
    assert!(prepare(one).is_err());
    let mut unframed = config;
    unframed["steps"][0]["input"] = json!("{}");
    assert!(prepare(unframed).is_err());
    std::fs::remove_file(path).unwrap();
}
