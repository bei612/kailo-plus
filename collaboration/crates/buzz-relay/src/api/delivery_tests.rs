use super::*;
use axum::{
    body::{to_bytes, Body},
    http::{header, Request},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use buzz_core::CommunityId;
use nostr::{EventBuilder, JsonUtil, Keys, Kind, Tag, Timestamp};
use sha2::{Digest, Sha256};
use tower::ServiceExt;

async fn fixture() -> (
    Arc<AppState>,
    sqlx::PgPool,
    CommunityId,
    String,
    Keys,
    uuid::Uuid,
) {
    fixture_for(Keys::generate()).await
}
async fn fixture_for(keys: Keys) -> (Arc<AppState>, sqlx::PgPool, CommunityId, String, Keys, uuid::Uuid) {
    let mut config = crate::config::Config::from_env().unwrap();
    config.database_url =
        std::env::var("BUZZ_TEST_DATABASE_URL").expect("isolated database required");
    config.redis_url = std::env::var("REDIS_URL").expect("isolated Redis required");
    config.relay_url = "wss://unused.example".into();
    config.require_relay_membership = true;
    let pool = sqlx::PgPool::connect(&config.database_url).await.unwrap();
    let db = buzz_db::Db::from_pool(pool.clone());
    db.migrate().await.unwrap();
    let redis = deadpool_redis::Config::from_url(&config.redis_url)
        .create_pool(Some(deadpool_redis::Runtime::Tokio1))
        .unwrap();
    let pubsub = Arc::new(
        buzz_pubsub::PubSubManager::new(&config.redis_url, redis.clone())
            .await
            .unwrap(),
    );
    let audit = buzz_audit::AuditService::new(pool.clone());
    let auth = buzz_auth::AuthService::new(config.auth.clone());
    let search = buzz_search::SearchService::new(pool.clone());
    let workflow = Arc::new(buzz_workflow::WorkflowEngine::new(
        db.clone(),
        buzz_workflow::WorkflowConfig::default(),
    ));
    let media = buzz_media::MediaStorage::new(&config.media).unwrap();
    let (state, _shutdown) = AppState::new(
        config,
        db,
        redis,
        audit,
        pubsub,
        auth,
        search,
        workflow,
        Keys::generate(),
        media,
    );
    let community = CommunityId::from_uuid(uuid::Uuid::new_v4());
    let host = format!("publication-{}.example", community.as_uuid());
    let channel = uuid::Uuid::new_v4();
    sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
        .bind(community.as_uuid())
        .bind(&host)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO channels(id,community_id,name,created_by) VALUES($1,$2,'publication',$3)",
    )
    .bind(channel)
    .bind(community.as_uuid())
    .bind(keys.public_key().as_bytes().as_slice())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'owner')",
    )
    .bind(community.as_uuid())
    .bind(channel)
    .bind(keys.public_key().as_bytes().as_slice())
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'owner')")
        .bind(community.as_uuid())
        .bind(keys.public_key().to_hex())
        .execute(&pool)
        .await
        .unwrap();
    let repo = EventBuilder::new(Kind::Custom(30617), "")
        .tags([
            Tag::parse(["d", "repo"]).unwrap(),
            Tag::parse(["buzz-channel", &channel.to_string()]).unwrap(),
        ])
        .sign_with_keys(&keys)
        .unwrap();
    state.db.insert_event(community, &repo, None).await.unwrap();
    (Arc::new(state), pool, community, host, keys, channel)
}
fn event(keys: &Keys, created: u64) -> Event {
    EventBuilder::new(Kind::Custom(1631), "")
        .tags([Tag::parse(["a", &format!("30617:{}:repo", keys.public_key())]).unwrap()])
        .custom_created_at(Timestamp::from(created))
        .sign_with_keys(keys)
        .unwrap()
}
fn auth(keys: &Keys, host: &str, body: &[u8]) -> String {
    auth_at(keys, host, "/events/delivery", body)
}
fn auth_at(keys: &Keys, host: &str, path: &str, body: &[u8]) -> String {
    auth_with_tags(keys, host, path, body, vec![])
}
fn auth_with_tags(keys: &Keys, host: &str, path: &str, body: &[u8], extra: Vec<Tag>) -> String {
    let mut tags = vec![
            Tag::parse(["u", &format!("https://{host}{path}")]).unwrap(),
            Tag::parse(["method", "POST"]).unwrap(),
            Tag::parse(["payload", &hex::encode(Sha256::digest(body))]).unwrap(),
            Tag::parse(["nonce", &uuid::Uuid::new_v4().to_string()]).unwrap(),
        ];
    tags.extend(extra);
    let token = EventBuilder::new(Kind::Custom(27235), "").tags(tags).sign_with_keys(keys).unwrap();
    format!("Nostr {}", STANDARD.encode(token.as_json()))
}
async fn post(state: Arc<AppState>, host: &str, authorization: &str, body: Vec<u8>) -> Response {
    post_at(state, host, "/events/delivery", authorization, body).await
}
async fn post_at(
    state: Arc<AppState>,
    host: &str,
    path: &str,
    authorization: &str,
    body: Vec<u8>,
) -> Response {
    crate::router::build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(path)
                .header(header::HOST, host)
                .header(header::AUTHORIZATION, authorization)
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap()
}
async fn proof(state: Arc<AppState>, host: &str, keys: &Keys, event: &Event) -> Response {
    let body = event.as_json().into_bytes();
    let auth = auth(keys, host, &body);
    post(state, host, &auth, body).await
}
async fn wait_for_writer(
    pool: &sqlx::PgPool,
    writer_pid: i32,
    request: &tokio::task::JoinHandle<Response>,
) {
    use std::time::Duration;
    // Observe the actual writer wait, not elapsed time: revocation must
    // happen after the first HTTP admission and before its final readmit.
    tokio::time::timeout(Duration::from_secs(5),async {
        loop {
        let blocked:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND wait_event_type='Lock')")
            .bind(writer_pid).fetch_one(pool).await.unwrap();
        if blocked {break;}
        assert!(!request.is_finished(),"proof ended before waiting for writer");
        tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }).await.expect("HTTP proof must reach the original writer lock");
}
#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn delivery_http_uses_real_nip98_replay_writer_and_live_owner_admission() {
    let (state, pool, community, host, keys, channel) = fixture().await;
    let original = event(&keys, Timestamp::now().as_secs());
    let response = proof(state.clone(), &host, &keys, &original).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(
        body,
        serde_json::json!({"eventId":original.id.to_hex(),"communityId":community.as_uuid().to_string(),"accepted":false,"settled":false})
    );
    state
        .db
        .insert_event(community, &original, None)
        .await
        .unwrap();
    state
        .db
        .soft_delete_event(community, original.id.as_bytes())
        .await
        .unwrap();
    let response = proof(state.clone(), &host, &keys, &original).await;
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body["accepted"], true);
    assert_eq!(body.as_object().unwrap().len(), 4);
    let expired = event(&keys, Timestamp::now().as_secs() - 901);
    let response = proof(state.clone(), &host, &keys, &expired).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body["accepted"], false);
    assert_eq!(body["settled"], true);
    let raw = expired.as_json().into_bytes();
    let token = auth(&keys, &host, &raw);
    assert_eq!(
        post(state.clone(), &host, &token, raw.clone())
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        post(state.clone(), &host, &token, raw.clone())
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let bad_payload = auth(&keys, &host, b"different");
    assert_eq!(
        post(state.clone(), &host, &bad_payload, raw.clone())
            .await
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let other_host = auth(&keys, "other.example", &raw);
    assert_eq!(
        post(state.clone(), &host, &other_host, raw).await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        proof(state.clone(), &host, &Keys::generate(), &original)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let mut extra = serde_json::to_value(&original).unwrap();
    extra["filter"] = serde_json::json!({});
    let body = serde_json::to_vec(&extra).unwrap();
    let token = auth(&keys, &host, &body);
    assert_eq!(
        post(state.clone(), &host, &token, body).await.status(),
        StatusCode::BAD_REQUEST
    );
    buzz_db::moderation::ban_member(
        &pool,
        community,
        keys.public_key().as_bytes(),
        keys.public_key().as_bytes(),
        None,
        None,
    )
    .await
    .unwrap();
    assert_eq!(
        proof(state.clone(), &host, &keys, &original).await.status(),
        StatusCode::NOT_FOUND
    );
    buzz_db::moderation::unban_member(
        &pool,
        community,
        keys.public_key().as_bytes(),
        keys.public_key().as_bytes(),
    )
    .await
    .unwrap();
    sqlx::query("DELETE FROM channel_members WHERE community_id=$1 AND channel_id=$2")
        .bind(community.as_uuid())
        .bind(channel)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        proof(state.clone(), &host, &keys, &original).await.status(),
        StatusCode::NOT_FOUND,
        "owner must remain a channel member"
    );
    sqlx::query("UPDATE communities SET archived_at=now() WHERE id=$1")
        .bind(community.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        proof(state, &host, &keys, &original).await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn delivery_rechecks_revocation_and_host_binding_after_waiting_for_writer() {
    use std::time::Duration;
    for drift in ["membership", "host", "archive"] {
        let (state, pool, community, host, keys, channel) = fixture().await;
        let original = event(&keys, Timestamp::now().as_secs());
        let mut writer = pool.begin().await.unwrap();
        buzz_db::event::insert_event_in_transaction(&mut writer, community, &original, None)
            .await
            .unwrap();
        let writer_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
            .fetch_one(&mut *writer)
            .await
            .unwrap();
        let request_host = host.clone();
        let request =
            tokio::spawn(async move { proof(state, &request_host, &keys, &original).await });
        wait_for_writer(&pool, writer_pid, &request).await;
        match drift {
            "membership" => {
                sqlx::query("DELETE FROM channel_members WHERE community_id=$1 AND channel_id=$2")
                    .bind(community.as_uuid())
                    .bind(channel)
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            "host" => {
                sqlx::query("UPDATE communities SET host=$2 WHERE id=$1")
                    .bind(community.as_uuid())
                    .bind(format!("retired-{host}"))
                    .execute(&pool)
                    .await
                    .unwrap();
                sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
                    .bind(uuid::Uuid::new_v4())
                    .bind(&host)
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            "archive" => {
                sqlx::query("UPDATE communities SET archived_at=now() WHERE id=$1")
                    .bind(community.as_uuid())
                    .execute(&pool)
                    .await
                    .unwrap();
            }
            _ => unreachable!(),
        }
        writer.commit().await.unwrap();
        let response = tokio::time::timeout(Duration::from_secs(5), request)
            .await
            .unwrap()
            .unwrap();
        assert!(
            !response.status().is_success(),
            "{drift} cannot become absence or delivery proof"
        );
        let body: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap())
                .unwrap_or_default();
        assert!(body.get("accepted").is_none(), "{drift}");
    }
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn original_http_ingest_cannot_commit_after_waiting_past_original_window() {
    use std::time::Duration;
    let (state, pool, community, host, keys, _) = fixture().await;
    let original = event(&keys, Timestamp::now().as_secs() - 898);
    let mut writer = pool.begin().await.unwrap();
    buzz_db::event::insert_event_in_transaction(&mut writer, community, &original, None)
        .await
        .unwrap();
    let writer_pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *writer)
        .await
        .unwrap();
    let raw = original.as_json().into_bytes();
    let token = auth_at(&keys, &host, "/events", &raw);
    let request_state = state.clone();
    let request_host = host.clone();
    let request =
        tokio::spawn(
            async move { post_at(request_state, &request_host, "/events", &token, raw).await },
        );
    wait_for_writer(&pool, writer_pid, &request).await;
    tokio::time::timeout(Duration::from_secs(6), async {
        while !buzz_core::publication::timestamp_settled(
            original.created_at.as_secs(),
            chrono::Utc::now().timestamp(),
        ) {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    writer.rollback().await.unwrap();
    let response = tokio::time::timeout(Duration::from_secs(5), request)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert!(body.to_string().contains("event timestamp too far"));
    let response = proof(state, &host, &keys, &original).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body["accepted"], false);
    assert_eq!(body["settled"], true);
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn scoped_submit_freezes_proved_community_across_host_rebinding() {
    let (state, pool, community, host, keys, _) = fixture().await;
    let original = event(&keys, Timestamp::now().as_secs());
    let response = proof(state.clone(), &host, &keys, &original).await;
    assert_eq!(response.status(), StatusCode::OK);
    let observed: serde_json::Value = serde_json::from_slice(&to_bytes(response.into_body(),4096).await.unwrap()).unwrap();
    assert_eq!(observed["communityId"], community.as_uuid().to_string());
    assert_eq!(observed["accepted"], false);
    let (_, _, other, other_host, _, _) = fixture_for(keys.clone()).await;
    // Both actual communities authorize this exact device and repository.
    assert_eq!(proof(state.clone(), &other_host, &keys, &original).await.status(), StatusCode::OK);
    let frozen = community.as_uuid().to_string();
    let path = format!("/events?community={frozen}");
    let raw = original.as_json().into_bytes();
    let token = auth_with_tags(&keys,&host,&path,&raw,vec![Tag::parse(["community",&frozen]).unwrap()]);
    sqlx::query("UPDATE communities SET host=$2 WHERE id=$1").bind(community.as_uuid()).bind(format!("retired-{host}")).execute(&pool).await.unwrap();
    sqlx::query("UPDATE communities SET host=$2 WHERE id=$1").bind(other.as_uuid()).bind(&host).execute(&pool).await.unwrap();
    let response = post_at(state.clone(), &host, &path, &token, raw.clone()).await;
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "frozen Community must reject rebound Host before ingest");
    let rows:i64=sqlx::query_scalar("SELECT count(*) FROM events WHERE id=$1 AND community_id=ANY($2)")
        .bind(original.id.as_bytes().as_slice()).bind(vec![community.as_uuid(),other.as_uuid()]).fetch_one(&pool).await.unwrap();
    assert_eq!(rows,0,"rebound POST must not create either Community's row");
    // Restore routing: the same frozen intent now reaches its original writer.
    sqlx::query("UPDATE communities SET host=$2 WHERE id=$1").bind(other.as_uuid()).bind(&other_host).execute(&pool).await.unwrap();
    sqlx::query("UPDATE communities SET host=$2 WHERE id=$1").bind(community.as_uuid()).bind(&host).execute(&pool).await.unwrap();
    let token = auth_with_tags(&keys,&host,&path,&raw,vec![Tag::parse(["community",&frozen]).unwrap()]);
    let response = post_at(state.clone(),&host,&path,&token,raw).await;
    assert_eq!(response.status(),StatusCode::OK);
    let ack:serde_json::Value=serde_json::from_slice(&to_bytes(response.into_body(),4096).await.unwrap()).unwrap();
    assert_eq!(ack["accepted"],true);
    assert_eq!(ack["event_id"],original.id.to_hex());
    assert_eq!(ack["community_id"],frozen);
    // Legacy unscoped publication retains its original ACK shape.
    let legacy=event(&keys,original.created_at.as_secs()+1);
    let raw=legacy.as_json().into_bytes();
    let token=auth_at(&keys,&host,"/events",&raw);
    let response=post_at(state,&host,"/events",&token,raw).await;
    assert_eq!(response.status(),StatusCode::OK);
    let ack:serde_json::Value=serde_json::from_slice(&to_bytes(response.into_body(),4096).await.unwrap()).unwrap();
    assert_eq!(ack["accepted"],true);
    assert!(ack.get("community_id").is_none());
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn scoped_submit_rejects_ambiguous_unsigned_or_old_server_scope() {
    let (state,pool,community,host,keys,_)=fixture().await;
    let original=event(&keys,Timestamp::now().as_secs());
    let raw=original.as_json().into_bytes();
    let id=community.as_uuid().to_string();
    let path=format!("/events?community={id}");
    let tag=Tag::parse(["community",&id]).unwrap();
    for (url,tags) in [
        (path.clone(),vec![]),
        ("/events".into(),vec![tag.clone()]),
        (path.clone(),vec![tag.clone(),tag.clone()]),
        (path.clone(),vec![Tag::parse(["community",""]).unwrap()]),
        (path.clone(),vec![Tag::parse(["community"]).unwrap()]),
        (path.clone(),vec![Tag::parse(["community",&id,"extra"]).unwrap()]),
        (path.clone(),vec![Tag::parse(["community",&uuid::Uuid::new_v4().to_string()]).unwrap()]),
        (format!("{path}&community={id}"),vec![tag.clone()]),
        ("/events?community=".into(),vec![tag.clone()]),
        (format!("/events?community={}",id.to_uppercase()),vec![tag.clone()]),
    ] {
        let token=auth_with_tags(&keys,&host,&url,&raw,tags);
        assert!(!post_at(state.clone(),&host,&url,&token,raw.clone()).await.status().is_success(),"invalid scope {url}");
    }
    let token=auth_with_tags(&keys,&host,&path,&raw,vec![tag]);
    let signed=String::from_utf8(STANDARD.decode(token.strip_prefix("Nostr ").unwrap()).unwrap()).unwrap();
    // The unchanged old verifier expects /events, and includes query in URL comparison.
    assert!(buzz_auth::verify_nip98_event(&signed,&format!("https://{host}/events"),"POST",Some(&raw)).is_err());
    let mut tampered:serde_json::Value=serde_json::from_str(&signed).unwrap();
    tampered["tags"].as_array_mut().unwrap().last_mut().unwrap()[1]=serde_json::json!(uuid::Uuid::new_v4().to_string());
    let token=format!("Nostr {}",STANDARD.encode(serde_json::to_vec(&tampered).unwrap()));
    assert_eq!(post_at(state,&host,&path,&token,raw).await.status(),StatusCode::UNAUTHORIZED);
    let rows:i64=sqlx::query_scalar("SELECT count(*) FROM events WHERE community_id=$1 AND id=$2").bind(community.as_uuid()).bind(original.id.as_bytes().as_slice()).fetch_one(&pool).await.unwrap();
    assert_eq!(rows,0);
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn delivery_uses_existing_router_body_bound() {
    let (state,_,_,host,keys,_)=fixture().await;
    let padding="x".repeat(17*1024);
    let event=EventBuilder::new(Kind::Custom(1631),"").tags([
        Tag::parse(["a",&format!("30617:{}:repo",keys.public_key())]).unwrap(),
        Tag::parse(["test-padding",&padding]).unwrap(),
    ]).sign_with_keys(&keys).unwrap();
    assert!(event.as_json().len()>16*1024);
    assert_eq!(proof(state.clone(),&host,&keys,&event).await.status(),StatusCode::OK);
    // Existing api_router RequestBodyLimitLayer, not an invented proof-specific threshold.
    let oversized=vec![b' ';1024*1024+1];
    assert_eq!(post(state,&host,"",oversized).await.status(),StatusCode::PAYLOAD_TOO_LARGE);
}
