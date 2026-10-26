use super::super::token_intent;
use super::*;
use std::time::Duration;

struct Fixture {
    pool: PgPool,
    tenant: Uuid,
    principal: Uuid,
    device: String,
    channel: Uuid,
    policy:Policy,
}
impl Fixture {
    async fn new() -> Self {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(6)
            .connect(&std::env::var("PUSH_TEST_DATABASE_URL").unwrap())
            .await
            .unwrap();
        let tenant = Uuid::new_v4();
        let principal = Uuid::new_v4();
        let other = Uuid::new_v4();
        let human = Uuid::new_v4();
        let device = nostr::Keys::generate().public_key().to_hex();
        let channel = Uuid::new_v4();
        let mut tx = pool.begin().await.unwrap();
        sqlx::query("insert into identity.tenant(id,slug,name,state) values($1,$2,'push intent fixture','ACTIVE')").bind(tenant).bind(format!("push-{tenant}")).execute(&mut *tx).await.unwrap();
        for id in [principal, other] {
            sqlx::query("insert into identity.principal(id,tenant_id,kind,status) values($1,$2,'HUMAN','ACTIVE')").bind(id).bind(tenant).execute(&mut *tx).await.unwrap();
        }
        sqlx::query("insert into identity.human_identity(id,display_name,status) values($1,'push fixture','ACTIVE')").bind(human).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.tenant_membership(id,tenant_id,human_identity_id,tenant_principal_id,state) values($1,$2,$3,$4,'ACTIVE')").bind(Uuid::new_v4()).bind(tenant).bind(human).bind(principal).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.buzz_identity_binding(tenant_id,principal_id,pubkey,custody,kind,state) values($1,$2,$3,'CLIENT','HUMAN','ACTIVE')").bind(tenant).bind(principal).bind(&device).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into identity.push_registration(tenant_id,device_pubkey,tenant_principal_id,platform,app_id,locale,token_digest,token_secret_locator,token_secret_version,token_secret_audience,enabled,state) values($1,$2,$3,'FCM','chat.kailo','en',$4,'fixture/push',1,'fixture',true,'ACTIVE')")
   .bind(tenant).bind(&device).bind(principal).bind("1".repeat(64)).execute(&mut *tx).await.unwrap();
        sqlx::query("insert into projection.conversation_buzz_binding(id,tenant_id,channel_id,participant_principal_ids,creator_principal_id,creator_pubkey,operation_id,state) values($1,$2,$3,$4,$5,$6,$7,'ACTIVE')")
   .bind(Uuid::new_v4()).bind(tenant).bind(channel).bind(vec![principal,other]).bind(principal).bind(&device).bind(Uuid::new_v4()).execute(&mut *tx).await.unwrap();
        tx.commit().await.unwrap();
        Self {
            pool,
            tenant,
            principal,
            device,
            channel,
            policy:Policy::fixture(),
        }
    }
    async fn enqueue(&self, event: u64) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("insert into projection.push_send_intent(id,tenant_id,tenant_principal_id,device_pubkey,registration_version,platform,provider_target,event_id,channel_id,event_created_at,expires_at) values($1,$2,$3,$4,1,'FCM','FCM:fixture',$5,$6,extract(epoch from now())::bigint,now()+interval '1 hour')")
   .bind(id).bind(self.tenant).bind(self.principal).bind(&self.device).bind(format!("{event:064x}")).bind(self.channel.to_string()).execute(&self.pool).await.unwrap();
        id
    }
    async fn status(&self, id: Uuid) -> String {
        sqlx::query_scalar("select state from projection.push_send_intent where id=$1")
            .bind(id)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
    async fn expire_lease(&self, id: Uuid) {
        sqlx::query("update projection.push_send_intent set lease_until=now()-interval '1 second' where id=$1").bind(id).execute(&self.pool).await.unwrap();
    }
    async fn badge_rows(&self) -> i64 {
        sqlx::query_scalar("select count(*) from projection.push_unread where tenant_id=$1")
            .bind(self.tenant)
            .fetch_one(&self.pool)
            .await
            .unwrap()
    }
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn crashed_send_is_unknown_not_reclaimed_and_late_receipt_is_atomic() {
    let f = Fixture::new().await;
    let id = f.enqueue(1).await;
    let i = claim(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    assert!(begin_send(&f.pool, &i, "c:fixture",&f.policy).await.unwrap());
    // No transaction or connection is retained while the external request is in flight.
    sqlx::query("set statement_timeout='1s'")
        .execute(&f.pool)
        .await
        .unwrap();
    let mut probe = f.pool.begin().await.unwrap();
    sqlx::query("select version from identity.push_registration where tenant_id=$1 and device_pubkey=$2 for update nowait")
 .bind(f.tenant).bind(&f.device).execute(&mut *probe).await.unwrap();
    probe.rollback().await.unwrap();
    f.expire_lease(id).await;
    recover(&mut f.pool.acquire().await.unwrap(),&f.policy).await.unwrap();
    assert_eq!(f.status(id).await, "UNKNOWN");
    assert!(claim(&f.pool, f.tenant,&f.policy).await.unwrap().is_none());
    assert_eq!(f.badge_rows().await, 0);
    let receipt = Receipt::local(Outcome::Delivered,&f.policy);
    assert!(finish(&f.pool, &i, &receipt).await.unwrap());
    assert!(!finish(&f.pool, &i, &receipt).await.unwrap());
    assert_eq!(f.status(id).await, "ACCEPTED");
    assert_eq!(f.badge_rows().await, 1);
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn preflight_claim_is_reclaimable_but_old_lease_cannot_send() {
    let f = Fixture::new().await;
    let id = f.enqueue(2).await;
    let old = claim(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    f.expire_lease(id).await;
    recover(&mut f.pool.acquire().await.unwrap(),&f.policy).await.unwrap();
    let new = claim(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    assert_ne!(old.lease_id, new.lease_id);
    assert!(!begin_send(&f.pool, &old, "c:fixture",&f.policy).await.unwrap());
    assert!(begin_send(&f.pool, &new, "c:fixture",&f.policy).await.unwrap());
    assert!(!finish(&f.pool, &old, &Receipt::local(Outcome::Delivered,&f.policy))
        .await
        .unwrap());
    assert_eq!(f.status(id).await, "SENDING");
    assert_eq!(f.badge_rows().await, 0);
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn competing_consumers_retry_after_and_attempt_bound() {
    let mut f = Fixture::new().await;
    f.policy.max_attempts=2;
    let id = f.enqueue(3).await;
    let (a, b) = tokio::join!(claim(&f.pool, f.tenant,&f.policy), claim(&f.pool, f.tenant,&f.policy));
    let mut i = match (a.unwrap(), b.unwrap()) {
        (Some(i), None) | (None, Some(i)) => i,
        _ => panic!("one lease required"),
    };
    for attempt in 1..=f.policy.max_attempts {
        assert!(begin_send(&f.pool, &i, "c:fixture",&f.policy).await.unwrap());
        let mut receipt = Receipt::local(Outcome::Retry,&f.policy);
        receipt.retry_after = Duration::from_secs(900);
        finish(&f.pool, &i, &receipt).await.unwrap();
        let wait:f64=sqlx::query_scalar("select extract(epoch from next_attempt_at-now())::double precision from projection.push_send_intent where id=$1").bind(id).fetch_one(&f.pool).await.unwrap();
        assert!(wait > 890.0);
        assert!(claim(&f.pool, f.tenant,&f.policy).await.unwrap().is_none());
        sqlx::query("update projection.push_send_intent set next_attempt_at=now()-interval '1 second' where id=$1").bind(id).execute(&f.pool).await.unwrap();
        sqlx::query("delete from projection.push_delivery_window where tenant_id=$1")
            .bind(f.tenant)
            .execute(&f.pool)
            .await
            .unwrap();
        recover(&mut f.pool.acquire().await.unwrap(),&f.policy).await.unwrap();
        if attempt < f.policy.max_attempts {
            i = claim(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap()
        }
    }
    assert!(claim(&f.pool, f.tenant,&f.policy).await.unwrap().is_none());
    assert_eq!(f.status(id).await, "CANCELLED");
    assert_eq!(f.badge_rows().await, 0);
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn revoked_device_and_channel_prevent_send_and_rotation_fences_old_invalid() {
    let f = Fixture::new().await;
    let id = f.enqueue(4).await;
    let i = claim(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    sqlx::query(
        "update projection.conversation_buzz_binding set state='DISABLED' where channel_id=$1",
    )
    .bind(f.channel)
    .execute(&f.pool)
    .await
    .unwrap();
    assert!(!begin_send(&f.pool, &i, "c:fixture",&f.policy).await.unwrap());
    sqlx::query(
        "update projection.conversation_buzz_binding set state='ACTIVE' where channel_id=$1",
    )
    .bind(f.channel)
    .execute(&f.pool)
    .await
    .unwrap();
    sqlx::query("update identity.buzz_identity_binding set state='REVOKED' where pubkey=$1")
        .bind(&f.device)
        .execute(&f.pool)
        .await
        .unwrap();
    assert!(!begin_send(&f.pool, &i, "c:fixture",&f.policy).await.unwrap());
    sqlx::query("update identity.buzz_identity_binding set state='ACTIVE' where pubkey=$1")
        .bind(&f.device)
        .execute(&f.pool)
        .await
        .unwrap();
    assert!(begin_send(&f.pool, &i, "c:fixture",&f.policy).await.unwrap());
    sqlx::query("update identity.push_registration set version=2 where tenant_id=$1")
        .bind(f.tenant)
        .execute(&f.pool)
        .await
        .unwrap();
    finish(&f.pool, &i, &Receipt::local(Outcome::Invalid,&f.policy))
        .await
        .unwrap();
    let reg: String =
        sqlx::query_scalar("select state from identity.push_registration where tenant_id=$1")
            .bind(f.tenant)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(reg, "ACTIVE");
    assert_eq!(f.status(id).await, "REJECTED");
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn unknown_never_becomes_failed_on_expiry_and_tenant_delete_cannot_resurrect() {
    let f = Fixture::new().await;
    let id = f.enqueue(5).await;
    let i = claim(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    assert!(begin_send(&f.pool, &i, "c:fixture",&f.policy).await.unwrap());
    finish(&f.pool, &i, &Receipt::local(Outcome::Unknown,&f.policy))
        .await
        .unwrap();
    sqlx::query(
        "update projection.push_send_intent set expires_at=now()-interval '1 second' where id=$1",
    )
    .bind(id)
    .execute(&f.pool)
    .await
    .unwrap();
    recover(&mut f.pool.acquire().await.unwrap(),&f.policy).await.unwrap();
    assert_eq!(f.status(id).await, "UNKNOWN");
    assert_eq!(f.badge_rows().await, 0);
    sqlx::query("update identity.tenant set state='DELETING' where id=$1")
        .bind(f.tenant)
        .execute(&f.pool)
        .await
        .unwrap();
    // A real late success remains evidence, but cannot recreate this Tenant's badge.
    finish(&f.pool, &i, &Receipt::local(Outcome::Delivered,&f.policy))
        .await
        .unwrap();
    assert_eq!(f.status(id).await, "ACCEPTED");
    assert_eq!(f.badge_rows().await, 0);
    sqlx::query("delete from projection.push_send_intent where tenant_id=$1")
        .bind(f.tenant)
        .execute(&f.pool)
        .await
        .unwrap();
    assert!(!finish(&f.pool, &i, &Receipt::local(Outcome::Delivered,&f.policy))
        .await
        .unwrap());
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn token_ownership_survives_aborted_binding_and_expired_writer_cannot_bind() {
    let f = Fixture::new().await;
    let r = secret_store::SecretRef {
        locator: format!("fixture/push-token/{}", Uuid::new_v4()),
        version: 1,
        audience: "fixture".into(),
    };
    token_intent::prepare(&f.pool, f.tenant, &f.device, &r,&f.policy)
        .await
        .unwrap();
    let mut tx = f.pool.begin().await.unwrap();
    assert!(lock_device(&mut tx, f.tenant, f.principal, &f.device)
        .await
        .unwrap());
    assert!(token_intent::bind(&mut tx, f.tenant, &f.device, &r)
        .await
        .unwrap());
    tx.rollback().await.unwrap();
    let state: String =
        sqlx::query_scalar("select state from admission.push_token_intent where locator=$1")
            .bind(&r.locator)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(state, "PREPARING");
    sqlx::query("update admission.push_token_intent set lease_until=now()-interval '1 second' where locator=$1").bind(&r.locator).execute(&f.pool).await.unwrap();
    let reclaimed = token_intent::claim_retirement(&f.pool,&f.policy).await.unwrap();
    assert!(reclaimed
        .iter()
        .any(|(locator, _, _)| locator == &r.locator));
    // The same locator cannot be immediately reclaimed while destruction is in flight.
    assert!(!token_intent::claim_retirement(&f.pool,&f.policy)
        .await
        .unwrap()
        .iter()
        .any(|(locator, _, _)| locator == &r.locator));
    let mut tx = f.pool.begin().await.unwrap();
    assert!(!token_intent::bind(&mut tx, f.tenant, &f.device, &r)
        .await
        .unwrap());
    token_intent::retire(&mut tx, &r.locator).await.unwrap();
    tx.commit().await.unwrap();
    let mut tx = f.pool.begin().await.unwrap();
    assert!(!token_intent::bind(&mut tx, f.tenant, &f.device, &r)
        .await
        .unwrap());
    // The post-OpenBao recheck must deny revocation which happened during external I/O.
    sqlx::query("update identity.tenant_membership set state='REVOKED' where tenant_id=$1")
        .bind(f.tenant)
        .execute(&mut *tx)
        .await
        .unwrap();
    assert!(!lock_device(&mut tx, f.tenant, f.principal, &f.device)
        .await
        .unwrap());
    tx.rollback().await.unwrap();
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn accepted_receipt_and_badge_rollback_together_then_only_receipt_is_retried() {
    let f = Fixture::new().await;
    let id = f.enqueue(6).await;
    let i = claim(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    assert!(begin_send(&f.pool, &i, "c:fixture",&f.policy).await.unwrap());
    let function = format!("push_fail_{}", f.tenant.simple());
    sqlx::query(&format!("create function projection.{function}() returns trigger language plpgsql as $$ begin if NEW.tenant_id='{}'::uuid then raise exception 'fixture projection failure'; end if; return NEW; end $$",f.tenant))
 .execute(&f.pool).await.unwrap();
    sqlx::query(&format!("create trigger {function} before insert on projection.push_unread for each row execute function projection.{function}()"))
 .execute(&f.pool).await.unwrap();
    let receipt = Receipt::local(Outcome::Delivered,&f.policy);
    assert!(finish(&f.pool, &i, &receipt).await.is_err());
    assert_eq!(f.status(id).await, "SENDING");
    assert_eq!(f.badge_rows().await, 0);
    sqlx::query(&format!(
        "drop trigger {function} on projection.push_unread"
    ))
    .execute(&f.pool)
    .await
    .unwrap();
    sqlx::query(&format!("drop function projection.{function}()"))
        .execute(&f.pool)
        .await
        .unwrap();
    assert!(finish(&f.pool, &i, &receipt).await.unwrap());
    assert_eq!(f.status(id).await, "ACCEPTED");
    assert_eq!(f.badge_rows().await, 1);
    assert!(claim(&f.pool, f.tenant,&f.policy).await.unwrap().is_none());
}

#[tokio::test]
#[ignore = "requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn scanner_checkpoint_fences_expired_owner_and_replays_only_one_stable_tuple() {
    let f = Fixture::new().await;
    let (old, since, _) = claim_scan(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    assert!(claim_scan(&f.pool, f.tenant,&f.policy).await.unwrap().is_none());
    let message = MessageFacts {
        id: format!("{:064x}", 7),
        author: "a".repeat(64),
        created_at: since as u64,
        channel_id: f.channel.to_string(),
        broadcast: true,
        mentioned: BTreeSet::new(),
        parent_id: None,
        root_id: None,
    };
    let targets = [("FCM", "provider-fixture".to_string())];
    assert!(enqueue(&f.pool, f.tenant, old, &message, &targets,&f.policy)
        .await
        .unwrap());
    assert!(enqueue(&f.pool, f.tenant, old, &message, &targets,&f.policy)
        .await
        .unwrap());
    let count: i64 =
        sqlx::query_scalar("select count(*) from projection.push_send_intent where tenant_id=$1")
            .bind(f.tenant)
            .fetch_one(&f.pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
    sqlx::query("update projection.push_cursor set lease_until=now()-interval '1 second' where tenant_id=$1").bind(f.tenant).execute(&f.pool).await.unwrap();
    let (new, _, _) = claim_scan(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    assert!(!enqueue(&f.pool, f.tenant, old, &message, &targets,&f.policy)
        .await
        .unwrap());
    assert!(!checkpoint_scan(&f.pool, f.tenant, old, since + 100, &[])
        .await
        .unwrap());
    assert!(checkpoint_scan(
        &f.pool,
        f.tenant,
        new,
        since,
        std::slice::from_ref(&message.id)
    )
    .await
    .unwrap());
    let (_, new_since, seen) = claim_scan(&f.pool, f.tenant,&f.policy).await.unwrap().unwrap();
    assert_eq!(new_since, since);
    assert_eq!(seen, vec![message.id]);
}

#[tokio::test]
#[ignore="requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn channel_revoked_while_provider_inflight_cannot_restore_badge_or_query() {
 let f=Fixture::new().await;f.enqueue(101).await;
 let i=claim(&f.pool,f.tenant,&f.policy).await.unwrap().unwrap();
 assert!(begin_send(&f.pool,&i,"first",&f.policy).await.unwrap());
 finish(&f.pool,&i,&Receipt::local(Outcome::Delivered,&f.policy)).await.unwrap();
 assert_eq!(super::super::unread::events(&mut f.pool.acquire().await.unwrap(),f.tenant,f.principal).await.unwrap().len(),1);
 f.enqueue(102).await;
 let next=claim(&f.pool,f.tenant,&f.policy).await.unwrap().unwrap();
 assert!(begin_send(&f.pool,&next,"second",&f.policy).await.unwrap());
 // The channel is revoked after external dispatch and before its accepted receipt.
 sqlx::query("update projection.conversation_buzz_binding set state='DISABLED' where channel_id=$1")
   .bind(f.channel).execute(&f.pool).await.unwrap();
 assert!(finish(&f.pool,&next,&Receipt::local(Outcome::Delivered,&f.policy)).await.unwrap());
 assert_eq!(f.status(next.id).await,"ACCEPTED"); // Provider fact is preserved.
 assert_eq!(f.badge_rows().await,1); // The late result cannot add a revoked-channel row.
 assert!(super::super::unread::events(&mut f.pool.acquire().await.unwrap(),f.tenant,f.principal).await.unwrap().is_empty());
}

#[derive(Clone)]
struct RelayFixture {
    events:std::sync::Arc<Vec<serde_json::Value>>,
    calls:std::sync::Arc<std::sync::Mutex<Vec<serde_json::Value>>>,
    control:String,
    fail_page:Option<usize>,
}
async fn relay_query(
    axum::extract::State(s):axum::extract::State<RelayFixture>,
    headers:axum::http::HeaderMap,
    body:axum::body::Bytes,
)->axum::response::Response {
    use axum::response::IntoResponse;
    use base64::Engine;
    use sha2::{Digest,Sha256};
    let header=headers["authorization"].to_str().unwrap().strip_prefix("Nostr ").unwrap();
    let auth:nostr::Event=serde_json::from_slice(&base64::engine::general_purpose::STANDARD.decode(header).unwrap()).unwrap();
    auth.verify().unwrap();assert_eq!(auth.pubkey.to_hex(),s.control);
    assert_eq!(headers["host"],"push-relay.fixture");
    let tags=auth.tags.to_vec();
    let tag=|name:&str|tags.iter().find_map(|t|{let a=t.as_slice();(a.first().map(String::as_str)==Some(name)).then(||a.get(1).cloned()).flatten()});
    assert_eq!(tag("u").as_deref(),Some("http://push-relay.fixture/query"));
    assert_eq!(tag("method").as_deref(),Some("POST"));
    assert_eq!(tag("payload"),Some(hex::encode(Sha256::digest(&body))));
    let filters:serde_json::Value=serde_json::from_slice(&body).unwrap();let filter=filters[0].clone();
    let number={let mut calls=s.calls.lock().unwrap();calls.push(filter.clone());calls.len()};
    if s.fail_page==Some(number) {return axum::http::StatusCode::SERVICE_UNAVAILABLE.into_response()}
    let since=filter["since"].as_u64().unwrap();let until=filter["until"].as_u64().unwrap();
    let before=filter["before_id"].as_str();let limit=filter["limit"].as_u64().unwrap() as usize;
    // Original Relay order/extension: DESC timestamp, ASC id; same-second continuation
    // is id > before_id, not timestamp minus one.
    let events:Vec<_>=s.events.iter().filter(|event|{
        let at=event["created_at"].as_u64().unwrap();let id=event["id"].as_str().unwrap();
        at>=since && (at<until || (at==until && before.is_none_or(|prior|id>prior)))
    }).take(limit).cloned().collect();
    axum::Json(events).into_response()
}
async fn relay_fixture(channel:Uuid,at:i64,count:usize,fail_page:Option<usize>)->(collab_bridge::bridge::IdentityClient,RelayFixture,tokio::task::JoinHandle<()>) {
    let control=nostr::Keys::generate();let author=nostr::Keys::generate();
    let mut events:Vec<_>=(0..count).map(|n|{
        let event=nostr::EventBuilder::new(nostr::Kind::Custom(9),format!("body not retained {n}"))
            .tags([nostr::Tag::parse(["h",&channel.to_string()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from_secs(at as u64)).sign_with_keys(&author).unwrap();
        serde_json::to_value(event).unwrap()
    }).collect();
    events.sort_by(|a,b|a["id"].as_str().cmp(&b["id"].as_str()));
    let state=RelayFixture{events:std::sync::Arc::new(events),calls:Default::default(),control:control.public_key().to_hex(),fail_page};
    let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url=format!("http://{}",listener.local_addr().unwrap());
    let router=axum::Router::new().route("/query",axum::routing::post(relay_query)).with_state(state.clone());
    let task=tokio::spawn(async move {axum::serve(listener,router).await.unwrap()});
    let client=collab_bridge::bridge::IdentityClient::new(collab_bridge::bridge::Custody::Server,&control.secret_key().to_secret_hex(),&url,"push-relay.fixture").unwrap();
    (client,state,task)
}

#[tokio::test]
#[ignore="requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn authenticated_same_second_multi_page_scan_commits_every_event_once() {
    let f=Fixture::new().await;let (lease,since,seen)=claim_scan(&f.pool,f.tenant,&f.policy).await.unwrap().unwrap();
    let (client,relay,task)=relay_fixture(f.channel,since,1001,None).await;
    let http=reqwest::Client::builder().no_proxy().build().unwrap();
    let window=super::super::scan::Window{pool:&f.pool,tenant:f.tenant,lease,since,seen:seen.into_iter().collect(),until:since};
    window.run(&client,&http,&f.policy,500,&[("FCM","target".into())]).await.unwrap();
    let (rows,distinct):(i64,i64)=sqlx::query_as("select count(*),count(distinct event_id) from projection.push_send_intent where tenant_id=$1")
        .bind(f.tenant).fetch_one(&f.pool).await.unwrap();
    assert_eq!((rows,distinct),(1001,1001));
    {let calls=relay.calls.lock().unwrap();assert_eq!(calls.len(),3);assert_eq!(calls[1]["until"],since);assert!(calls[1]["before_id"].is_string());}
    let (next,since,seen)=claim_scan(&f.pool,f.tenant,&f.policy).await.unwrap().unwrap();assert_eq!(seen.len(),1001);
    let window=super::super::scan::Window{pool:&f.pool,tenant:f.tenant,lease:next,since,seen:seen.into_iter().collect(),until:since};
    window.run(&client,&http,&f.policy,500,&[("FCM","target".into())]).await.unwrap();
    let rows:i64=sqlx::query_scalar("select count(*) from projection.push_send_intent where tenant_id=$1").bind(f.tenant).fetch_one(&f.pool).await.unwrap();assert_eq!(rows,1001);
    task.abort();
}

#[tokio::test]
#[ignore="requires PUSH_TEST_DATABASE_URL isolated migrated database"]
async fn failed_or_over_bound_window_never_advances_or_enqueues_a_partial_page() {
    for fail_page in [Some(2),None] {
        let f=Fixture::new().await;let (lease,since,seen)=claim_scan(&f.pool,f.tenant,&f.policy).await.unwrap().unwrap();
        let (client,_,task)=relay_fixture(f.channel,since,5,fail_page).await;
        let http=reqwest::Client::builder().no_proxy().build().unwrap();
        let mut policy=f.policy.clone();policy.scan_event_bound=3;
        let window=super::super::scan::Window{pool:&f.pool,tenant:f.tenant,lease,since,seen:seen.into_iter().collect(),until:since};
        let result=window.run(&client,&http,&policy,2,&[("FCM","target".into())]).await;
        assert_eq!(result,Err(if fail_page.is_some(){"RELAY_OR_LEASE_UNAVAILABLE"}else{"SCAN_BOUND_EXCEEDED"}));
        let (at,seen):(i64,Vec<String>)=sqlx::query_as("select since,seen_ids from projection.push_cursor where tenant_id=$1").bind(f.tenant).fetch_one(&f.pool).await.unwrap();
        assert_eq!(at,since);assert!(seen.is_empty());
        let rows:i64=sqlx::query_scalar("select count(*) from projection.push_send_intent where tenant_id=$1").bind(f.tenant).fetch_one(&f.pool).await.unwrap();assert_eq!(rows,0);
        task.abort();
    }
}
