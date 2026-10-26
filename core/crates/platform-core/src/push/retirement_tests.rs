//! Exercises the real Core sweep and SecretStore HTTP client with isolated PG and a
//! scripted OpenBao wire peer. This is not a real provider or deployed OpenBao claim.
use super::sweep_dependencies;
use crate::push::{config::Policy, token_intent};
use axum::{
    body::to_bytes,
    extract::{Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::any,
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Default)]
struct Peer {
    logins: BTreeSet<(String, String)>,
    destroyed: BTreeSet<String>,
    metadata_failures: BTreeMap<String, usize>,
    hidden_receipts: BTreeMap<String, usize>,
    calls: Vec<(String, String, String)>,
}
async fn openbao(State(state): State<Arc<Mutex<Peer>>>, request: Request) -> Response {
    let method = request.method().to_string();
    let path = request.uri().path().to_string();
    let ns = request
        .headers()
        .get("x-vault-namespace")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    let bytes = to_bytes(request.into_body(), 16384).await.unwrap();
    let body: Value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    let mut peer = state.lock().unwrap();
    peer.calls.push((method.clone(), path.clone(), ns.clone()));
    if path == "/v1/sys/wrapping/lookup" {
        let role = if ns == "platform" {
            "core-platform"
        } else {
            assert_eq!(ns, "tenants");
            "core-provisioner"
        };
        return Json(
            json!({"data":{"creation_path":format!("auth/approle/role/{role}/secret-id")}}),
        )
        .into_response();
    }
    if path == "/v1/sys/wrapping/unwrap" {
        return Json(json!({"data":{"secret_id":format!("fixture-{ns}")}})).into_response();
    }
    if path == "/v1/auth/approle/login" {
        let id = body["secret_id"].as_str().unwrap().to_owned();
        if !peer.logins.insert((ns.clone(), id)) {
            return StatusCode::FORBIDDEN.into_response();
        }
        return Json(json!({"auth":{"client_token":"fixture-service-token","accessor":"fixture-accessor","lease_duration":3600,"renewable":true}})).into_response();
    }
    let tenant = ns
        .strip_prefix("tenants/")
        .and_then(|s| Uuid::parse_str(s).ok());
    assert!(
        tenant.is_some(),
        "KV and child-role requests must carry the exact Tenant namespace"
    );
    if path == "/v1/auth/approle/role/core-child/role-id" {
        return Json(json!({"data":{"role_id":"fixture-child-role"}})).into_response();
    }
    if path == "/v1/auth/approle/role/core-child/secret-id" {
        return Json(json!({"data":{"secret_id":format!("fixture-child-{ns}")}})).into_response();
    }
    if let Some(id) = path.strip_prefix("/v1/kv/metadata/push-token/") {
        assert_eq!(method, "GET");
        assert!(Uuid::parse_str(id).is_ok());
        let locator = format!("{ns}/kv/push-token/{id}");
        if let Some(left) = peer.metadata_failures.get_mut(&locator) {
            if *left > 0 {
                *left -= 1;
                return StatusCode::SERVICE_UNAVAILABLE.into_response();
            }
        }
        let mut destroyed = peer.destroyed.contains(&locator);
        if destroyed {
            if let Some(left) = peer.hidden_receipts.get_mut(&locator) {
                if *left > 0 {
                    *left -= 1;
                    destroyed = false;
                }
            }
        }
        return Json(json!({"data":{"current_version":1,"versions":{"1":{"destroyed":destroyed,"deletion_time":""}}}})).into_response();
    }
    if let Some(id) = path.strip_prefix("/v1/kv/destroy/push-token/") {
        assert_eq!(method, "POST");
        assert_eq!(body, json!({"versions":[1]}));
        assert!(Uuid::parse_str(id).is_ok());
        peer.destroyed.insert(format!("{ns}/kv/push-token/{id}"));
        return StatusCode::NO_CONTENT.into_response();
    }
    panic!("unexpected OpenBao endpoint: {method} {path}");
}

struct Environment(Vec<&'static str>);
impl Drop for Environment {
    fn drop(&mut self) {
        for name in &self.0 {
            std::env::remove_var(name)
        }
    }
}
fn environment(addr: &str) -> Environment {
    // This ignored test is launched alone in a clean SDK. Never read or replace a
    // deployed credential, and remove only the fixture keys installed here.
    let vars = [
        ("OPENBAO_ADDR", addr),
        ("OPENBAO_HTTP_TIMEOUT_SECONDS", "2"),
        ("OPENBAO_ROLE_ID", "fixture-platform-role"),
        ("OPENBAO_ROLE_NAME", "core-platform"),
        ("OPENBAO_WRAPPED_SECRET_ID", "fixture-platform-wrap"),
        ("OPENBAO_TENANT_ROLE_ID", "fixture-provisioner-role"),
        ("OPENBAO_TENANT_ROLE_NAME", "core-provisioner"),
        (
            "OPENBAO_TENANT_WRAPPED_SECRET_ID",
            "fixture-provisioner-wrap",
        ),
        ("OPENBAO_TENANT_PARENT_NAMESPACE", "tenants"),
        ("OPENBAO_PLATFORM_NAMESPACE", "platform"),
        ("OPENBAO_KV_MOUNT", "kv"),
        ("OPENBAO_TENANT_CORE_ROLE_NAME", "core-child"),
        ("OPENBAO_KV_MAX_VERSIONS", "1"),
        ("OPENBAO_SECRET_ID_TTL", "60s"),
        ("OPENBAO_TOKEN_PERIOD", "3600s"),
        ("OPENBAO_TENANT_CORE_BOUND_CIDRS", "127.0.0.1/32"),
        ("OPENBAO_SERVICE_IDENTITY", "fixture-core"),
    ];
    for (key, _) in &vars {
        assert!(
            std::env::var_os(key).is_none(),
            "requires isolated SDK without OpenBao delivery"
        )
    }
    let mut guard = Environment(Vec::new());
    for (key, value) in vars {
        std::env::set_var(key, value);
        guard.0.push(key)
    }
    guard
}

async fn fixture(pool: &sqlx::PgPool, reference: &secret_store::SecretRef) -> (Uuid, String) {
    let tenant = Uuid::parse_str(reference.locator.split('/').nth(1).unwrap()).unwrap();
    let principal = Uuid::new_v4();
    let human = Uuid::new_v4();
    let device = nostr::Keys::generate().public_key().to_hex();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'retirement fixture','ACTIVE')").bind(tenant).bind(format!("retire-{tenant}")).execute(&mut *tx).await.unwrap();
    sqlx::query(
        "insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')",
    )
    .bind(principal)
    .bind(tenant)
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'retirement fixture','ACTIVE')").bind(human).execute(&mut *tx).await.unwrap();
    sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$3,$4,'ACTIVE')").bind(Uuid::new_v4()).bind(tenant).bind(human).bind(principal).execute(&mut *tx).await.unwrap();
    sqlx::query("insert into identity.buzz_identity_binding(tenant_id,principal_id,pubkey,custody,kind,state) values($1,$2,$3,'CLIENT','HUMAN','ACTIVE')").bind(tenant).bind(principal).bind(&device).execute(&mut *tx).await.unwrap();
    sqlx::query("insert into admission.push_token_intent(locator,tenant_id,audience,device_pubkey,state,lease_until) values($1,$2,$3,$4,'BOUND',now()+interval '1 hour')").bind(&reference.locator).bind(tenant).bind(&reference.audience).bind(&device).execute(&mut *tx).await.unwrap();
    sqlx::query("insert into identity.push_registration(tenant_id,tenant_principal_id,device_pubkey,platform,app_id,locale,token_digest,token_secret_locator,token_secret_version,token_secret_audience,enabled,state) values($1,$2,$3,'FCM','chat.kailo','en',repeat('a',64),$4,1,$5,true,'ACTIVE')").bind(tenant).bind(principal).bind(&device).bind(&reference.locator).bind(&reference.audience).execute(&mut *tx).await.unwrap();
    tx.commit().await.unwrap();
    (tenant, device)
}

#[tokio::test]
#[ignore = "requires isolated PUSH_TEST_DATABASE_URL and no OpenBao deployment environment"]
async fn original_sweep_revokes_then_retires_same_token_only_after_native_receipt() {
    let pool = sqlx::PgPool::connect(&std::env::var("PUSH_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = format!("http://{}", listener.local_addr().unwrap());
    let peer = Arc::new(Mutex::new(Peer::default()));
    let app = Router::new()
        .fallback(any(openbao))
        .with_state(peer.clone());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let _env = environment(&addr);
    let store = secret_store::SecretStore::from_env().unwrap();
    store.connect().await.unwrap();
    let policy = Policy::fixture();
    // A still-authorized device must retain the exact original token binding.
    let active_ref = secret_store::SecretRef {
        locator: store.tenant_locator(Uuid::new_v4(), &format!("push-token/{}", Uuid::new_v4())),
        version: 1,
        audience: "fixture-core".into(),
    };
    let (active_tenant, _) = fixture(&pool, &active_ref).await;
    for cause in ["device", "member", "tenant"] {
        let reference = secret_store::SecretRef {
            locator: store
                .tenant_locator(Uuid::new_v4(), &format!("push-token/{}", Uuid::new_v4())),
            version: 1,
            audience: "fixture-core".into(),
        };
        let (tenant, device) = fixture(&pool, &reference).await;
        let revoke = match cause {
            "device" => {
                "update identity.buzz_identity_binding set state='REVOKED' where tenant_id=$1"
            }
            "member" => "update identity.tenant_membership set state='REVOKED' where tenant_id=$1",
            _ => "update identity.tenant set state='DELETING' where id=$1",
        };
        sqlx::query(revoke)
            .bind(tenant)
            .execute(&pool)
            .await
            .unwrap();
        if cause == "member" {
            peer.lock()
                .unwrap()
                .hidden_receipts
                .insert(reference.locator.clone(), 1);
        } else {
            peer.lock()
                .unwrap()
                .metadata_failures
                .insert(reference.locator.clone(), 1);
        }
        sweep_dependencies(&pool, &store, &policy).await.unwrap();
        let row:(String,bool,Option<String>,Option<String>,Option<i32>,Option<String>,i32)=sqlx::query_as("select state,enabled,token_digest,token_secret_locator,token_secret_version,token_secret_audience,version from identity.push_registration where tenant_id=$1 and device_pubkey=$2").bind(tenant).bind(&device).fetch_one(&pool).await.unwrap();
        assert_eq!(row, ("REVOKED".into(), false, None, None, None, None, 2));
        let state: String =
            sqlx::query_scalar("select state from admission.push_token_intent where locator=$1")
                .bind(&reference.locator)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(
            state, "RETIRING",
            "failed or unproven native receipt must remain RETIRING"
        );
        let mut tx = pool.begin().await.unwrap();
        assert!(
            !token_intent::bind(&mut tx, tenant, &device, &reference)
                .await
                .unwrap(),
            "revoked token cannot bind again"
        );
        tx.rollback().await.unwrap();
        sqlx::query("update admission.push_token_intent set next_attempt_at=now()-interval '1 second' where locator=$1").bind(&reference.locator).execute(&pool).await.unwrap();
        sweep_dependencies(&pool, &store, &policy).await.unwrap();
        let state: String =
            sqlx::query_scalar("select state from admission.push_token_intent where locator=$1")
                .bind(&reference.locator)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(state, "RETIRED");
        let receipts:i64=sqlx::query_scalar("select count(*) from audit.audit_event where tenant_id=$1 and action_key='push.registration.revoke' and event_type='REVOCATION' and result_code='PUSH_REVOKED'").bind(tenant).fetch_one(&pool).await.unwrap();
        assert_eq!(
            receipts, 1,
            "retirement retry must not duplicate registration revocation"
        );
        let retained: i32 =
            sqlx::query_scalar("select version from identity.push_registration where tenant_id=$1")
                .bind(tenant)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(retained, 2);
        let ns = format!("tenants/{tenant}");
        let token_id = reference.locator.rsplit('/').next().unwrap();
        let destroy_path = format!("/v1/kv/destroy/push-token/{token_id}");
        let peer = peer.lock().unwrap();
        assert!(peer.destroyed.contains(&reference.locator));
        assert_eq!(
            peer.calls
                .iter()
                .filter(|(method, path, scope)| method == "POST"
                    && path == &destroy_path
                    && scope == &ns)
                .count(),
            1,
            "same intent must destroy only its original version once"
        );
    }
    let kept:(String,bool,String,i32)=sqlx::query_as("select state,enabled,token_secret_locator,version from identity.push_registration where tenant_id=$1").bind(active_tenant).fetch_one(&pool).await.unwrap();
    assert_eq!(kept, ("ACTIVE".into(), true, active_ref.locator, 1));
    assert_eq!(peer.lock().unwrap().destroyed.len(), 3);
    server.abort();
}
