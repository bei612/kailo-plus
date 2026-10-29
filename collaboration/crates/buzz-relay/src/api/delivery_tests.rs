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
async fn fixture_for(
    keys: Keys,
) -> (
    Arc<AppState>,
    sqlx::PgPool,
    CommunityId,
    String,
    Keys,
    uuid::Uuid,
) {
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
async fn stamped_status(
    pool: &sqlx::PgPool,
    community: CommunityId,
    keys: &Keys,
    created: u64,
) -> Event {
    let epoch: uuid::Uuid =
        sqlx::query_scalar("SELECT publication_epoch FROM communities WHERE id=$1")
            .bind(community.as_uuid())
            .fetch_one(pool)
            .await
            .unwrap();
    EventBuilder::new(Kind::Custom(1631), "")
        .tags([
            Tag::parse(["a", &format!("30617:{}:repo", keys.public_key())]).unwrap(),
            Tag::parse([
                buzz_core::publication::PUBLICATION_EPOCH_TAG,
                &epoch.to_string(),
            ])
            .unwrap(),
        ])
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
    let token = EventBuilder::new(Kind::Custom(27235), "")
        .tags(tags)
        .sign_with_keys(keys)
        .unwrap();
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
    let expired = stamped_status(&pool, community, &keys, Timestamp::now().as_secs() - 901).await;
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
        // Pause the original writer at its shared event fence before INSERT.
        // The new storage trigger later locks the Community epoch row, so a
        // writer already past INSERT intentionally serializes host/archive
        // changes. Holding that row while awaiting such an UPDATE would make
        // this fixture wait on itself instead of exercising final readmission.
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))")
            .bind(format!(
                "kailo:1631:{}:{}",
                community.as_uuid(),
                original.id
            ))
            .execute(&mut *writer)
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
    let original = stamped_status(&pool, community, &keys, Timestamp::now().as_secs() - 898).await;
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
    let observed: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(observed["communityId"], community.as_uuid().to_string());
    assert_eq!(observed["accepted"], false);
    let (_, _, other, other_host, _, _) = fixture_for(keys.clone()).await;
    // Both actual communities authorize this exact device and repository.
    assert_eq!(
        proof(state.clone(), &other_host, &keys, &original)
            .await
            .status(),
        StatusCode::OK
    );
    let frozen = community.as_uuid().to_string();
    let path = format!("/events?community={frozen}");
    let raw = original.as_json().into_bytes();
    let token = auth_with_tags(
        &keys,
        &host,
        &path,
        &raw,
        vec![Tag::parse(["community", &frozen]).unwrap()],
    );
    sqlx::query("UPDATE communities SET host=$2 WHERE id=$1")
        .bind(community.as_uuid())
        .bind(format!("retired-{host}"))
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE communities SET host=$2 WHERE id=$1")
        .bind(other.as_uuid())
        .bind(&host)
        .execute(&pool)
        .await
        .unwrap();
    let response = post_at(state.clone(), &host, &path, &token, raw.clone()).await;
    assert_eq!(
        response.status(),
        StatusCode::UNAUTHORIZED,
        "frozen Community must reject rebound Host before ingest"
    );
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM events WHERE id=$1 AND community_id=ANY($2)")
            .bind(original.id.as_bytes().as_slice())
            .bind(vec![community.as_uuid(), other.as_uuid()])
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        rows, 0,
        "rebound POST must not create either Community's row"
    );
    // Restore routing: the same frozen intent now reaches its original writer.
    sqlx::query("UPDATE communities SET host=$2 WHERE id=$1")
        .bind(other.as_uuid())
        .bind(&other_host)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("UPDATE communities SET host=$2 WHERE id=$1")
        .bind(community.as_uuid())
        .bind(&host)
        .execute(&pool)
        .await
        .unwrap();
    let token = auth_with_tags(
        &keys,
        &host,
        &path,
        &raw,
        vec![Tag::parse(["community", &frozen]).unwrap()],
    );
    let response = post_at(state.clone(), &host, &path, &token, raw).await;
    assert_eq!(response.status(), StatusCode::OK);
    let ack: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(ack["accepted"], true);
    assert_eq!(ack["event_id"], original.id.to_hex());
    assert_eq!(ack["community_id"], frozen);
    // Legacy unscoped publication retains its original ACK shape.
    let legacy = event(&keys, original.created_at.as_secs() + 1);
    let raw = legacy.as_json().into_bytes();
    let token = auth_at(&keys, &host, "/events", &raw);
    let response = post_at(state, &host, "/events", &token, raw).await;
    assert_eq!(response.status(), StatusCode::OK);
    let ack: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(ack["accepted"], true);
    assert!(ack.get("community_id").is_none());
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn scoped_submit_rejects_ambiguous_unsigned_or_old_server_scope() {
    let (state, pool, community, host, keys, _) = fixture().await;
    let original = event(&keys, Timestamp::now().as_secs());
    let raw = original.as_json().into_bytes();
    let id = community.as_uuid().to_string();
    let path = format!("/events?community={id}");
    let tag = Tag::parse(["community", &id]).unwrap();
    for (url, tags) in [
        (path.clone(), vec![]),
        ("/events".into(), vec![tag.clone()]),
        (path.clone(), vec![tag.clone(), tag.clone()]),
        (path.clone(), vec![Tag::parse(["community", ""]).unwrap()]),
        (path.clone(), vec![Tag::parse(["community"]).unwrap()]),
        (
            path.clone(),
            vec![Tag::parse(["community", &id, "extra"]).unwrap()],
        ),
        (
            path.clone(),
            vec![Tag::parse(["community", &uuid::Uuid::new_v4().to_string()]).unwrap()],
        ),
        (format!("{path}&community={id}"), vec![tag.clone()]),
        ("/events?community=".into(), vec![tag.clone()]),
        (
            format!("/events?community={}", id.to_uppercase()),
            vec![tag.clone()],
        ),
    ] {
        let token = auth_with_tags(&keys, &host, &url, &raw, tags);
        assert!(
            !post_at(state.clone(), &host, &url, &token, raw.clone())
                .await
                .status()
                .is_success(),
            "invalid scope {url}"
        );
    }
    let token = auth_with_tags(&keys, &host, &path, &raw, vec![tag]);
    let signed = String::from_utf8(
        STANDARD
            .decode(token.strip_prefix("Nostr ").unwrap())
            .unwrap(),
    )
    .unwrap();
    // The unchanged old verifier expects /events, and includes query in URL comparison.
    assert!(buzz_auth::verify_nip98_event(
        &signed,
        &format!("https://{host}/events"),
        "POST",
        Some(&raw)
    )
    .is_err());
    let mut tampered: serde_json::Value = serde_json::from_str(&signed).unwrap();
    tampered["tags"].as_array_mut().unwrap().last_mut().unwrap()[1] =
        serde_json::json!(uuid::Uuid::new_v4().to_string());
    let token = format!(
        "Nostr {}",
        STANDARD.encode(serde_json::to_vec(&tampered).unwrap())
    );
    assert_eq!(
        post_at(state, &host, &path, &token, raw).await.status(),
        StatusCode::UNAUTHORIZED
    );
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM events WHERE community_id=$1 AND id=$2")
            .bind(community.as_uuid())
            .bind(original.id.as_bytes().as_slice())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(rows, 0);
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn delivery_uses_existing_router_body_bound() {
    let (state, _, _, host, keys, _) = fixture().await;
    let padding = "x".repeat(17 * 1024);
    let event = EventBuilder::new(Kind::Custom(1631), "")
        .tags([
            Tag::parse(["a", &format!("30617:{}:repo", keys.public_key())]).unwrap(),
            Tag::parse(["test-padding", &padding]).unwrap(),
        ])
        .sign_with_keys(&keys)
        .unwrap();
    assert!(event.as_json().len() > 16 * 1024);
    assert_eq!(
        proof(state.clone(), &host, &keys, &event).await.status(),
        StatusCode::OK
    );
    // Existing api_router RequestBodyLimitLayer, not an invented proof-specific threshold.
    let oversized = vec![b' '; 1024 * 1024 + 1];
    assert_eq!(
        post(state, &host, "", oversized).await.status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

async fn observe_reference(
    state: Arc<AppState>,
    host: &str,
    keys: &Keys,
    community: CommunityId,
    id: nostr::EventId,
) -> Response {
    let body = serde_json::to_vec(&serde_json::json!({
        "event_id": id.to_hex(), "community_id": community.as_uuid().to_string(),
    }))
    .unwrap();
    let token = auth_at(keys, host, "/events/observation", &body);
    post_at(state, host, "/events/observation", &token, body).await
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn observation_keeps_original_message_evidence_after_message_and_deletion_are_deleted() {
    let (state, pool, community, host, keys, channel) = fixture().await;
    let message = EventBuilder::new(
        Kind::Custom(9),
        "private message must never enter observation",
    )
    .tags([Tag::parse(["h", &channel.to_string()]).unwrap()])
    .sign_with_keys(&keys)
    .unwrap();
    let raw = message.as_json().into_bytes();
    let path = format!("/events?community={}", community.as_uuid());
    let token = auth_with_tags(
        &keys,
        &host,
        &path,
        &raw,
        vec![Tag::parse(["community", &community.as_uuid().to_string()]).unwrap()],
    );
    let response = post_at(state.clone(), &host, &path, &token, raw).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "ordinary scoped message retains original ingest admission"
    );
    let ack: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(ack["accepted"], true);
    assert_eq!(ack["event_id"], message.id.to_hex());
    assert_eq!(ack["community_id"], community.as_uuid().to_string());
    let deletion = EventBuilder::new(Kind::EventDeletion, "")
        .tags([Tag::event(message.id)])
        .sign_with_keys(&keys)
        .unwrap();
    state
        .db
        .insert_event(community, &deletion, Some(channel))
        .await
        .unwrap();
    for id in [message.id, deletion.id] {
        state
            .db
            .soft_delete_event(community, id.as_bytes())
            .await
            .unwrap();
        assert!(state
            .db
            .get_event_by_id(community, id.as_bytes())
            .await
            .unwrap()
            .is_none());
    }
    let response = observe_reference(state.clone(), &host, &keys, community, message.id).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(
        body,
        serde_json::json!({
            "event_id": message.id.to_hex(), "community_id": community.as_uuid().to_string(),
            "pubkey": keys.public_key().to_hex(), "kind": 9, "channel_id": channel.to_string(),
        })
    );
    let response = observe_reference(state.clone(), &host, &keys, community, deletion.id).await;
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body["kind"], 5);
    assert_eq!(
        body.as_object().unwrap().len(),
        5,
        "no message, tags, deletion state or absence conclusion"
    );
    let missing = EventBuilder::new(Kind::Custom(9), "not submitted")
        .sign_with_keys(&keys)
        .unwrap();
    let response = observe_reference(state.clone(), &host, &keys, community, missing.id).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body, serde_json::json!({"error":"publication unavailable"}));
    sqlx::query("UPDATE events SET content='tampered' WHERE community_id=$1 AND id=$2")
        .bind(community.as_uuid())
        .bind(message.id.as_bytes().as_slice())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        observe_reference(state, &host, &keys, community, message.id)
            .await
            .status(),
        StatusCode::NOT_FOUND,
        "an asserted stored ID without the original valid signature is not positive evidence"
    );
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn observation_preserves_private_channel_membership_and_personal_publication_authorship() {
    let (state, pool, community, host, keys, channel) = fixture().await;
    sqlx::query("UPDATE channels SET visibility='private' WHERE community_id=$1 AND id=$2")
        .bind(community.as_uuid())
        .bind(channel)
        .execute(&pool)
        .await
        .unwrap();
    let message = EventBuilder::new(Kind::Custom(9), "private")
        .tags([Tag::parse(["h", &channel.to_string()]).unwrap()])
        .sign_with_keys(&keys)
        .unwrap();
    state
        .db
        .insert_event(community, &message, Some(channel))
        .await
        .unwrap();
    let control = Keys::generate();
    sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'owner')")
        .bind(community.as_uuid())
        .bind(control.public_key().to_hex())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        observe_reference(state.clone(), &host, &control, community, message.id)
            .await
            .status(),
        StatusCode::NOT_FOUND,
        "a Community owner never becomes a private conversation participant"
    );
    assert_eq!(
        observe_reference(state.clone(), &host, &keys, community, message.id)
            .await
            .status(),
        StatusCode::OK
    );
    sqlx::query(
        "DELETE FROM channel_members WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3",
    )
    .bind(community.as_uuid())
    .bind(channel)
    .bind(keys.public_key().as_bytes().as_slice())
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        observe_reference(state.clone(), &host, &keys, community, message.id)
            .await
            .status(),
        StatusCode::NOT_FOUND,
        "author identity alone does not retain a revoked channel read"
    );
    let reminder = EventBuilder::new(Kind::Custom(30300), "encrypted personal reminder")
        .tags([Tag::parse(["d", "personal"]).unwrap()])
        .sign_with_keys(&keys)
        .unwrap();
    state
        .db
        .insert_event(community, &reminder, None)
        .await
        .unwrap();
    assert_eq!(
        observe_reference(state.clone(), &host, &keys, community, reminder.id)
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        observe_reference(state.clone(), &host, &control, community, reminder.id)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let profile = EventBuilder::new(Kind::Metadata, "{}")
        .sign_with_keys(&keys)
        .unwrap();
    state
        .db
        .insert_event(community, &profile, None)
        .await
        .unwrap();
    assert_eq!(
        observe_reference(state, &host, &keys, community, profile.id)
            .await
            .status(),
        StatusCode::NOT_FOUND,
        "the new reader is bounded to existing Core publication kinds"
    );
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn observation_binds_request_body_host_community_and_original_nip98_replay() {
    let (state, pool, community, host, keys, _) = fixture().await;
    let note = EventBuilder::new(Kind::TextNote, "community note")
        .sign_with_keys(&keys)
        .unwrap();
    state.db.insert_event(community, &note, None).await.unwrap();
    let body = serde_json::to_vec(&serde_json::json!({"event_id":note.id.to_hex(),"community_id":community.as_uuid().to_string()})).unwrap();
    let token = auth_at(&keys, &host, "/events/observation", &body);
    assert_eq!(
        post_at(
            state.clone(),
            &host,
            "/events/observation",
            &token,
            body.clone()
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        post_at(
            state.clone(),
            &host,
            "/events/observation",
            &token,
            body.clone()
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED
    );
    let token = auth_at(&keys, &host, "/events/observation", b"different body");
    assert_eq!(
        post_at(
            state.clone(),
            &host,
            "/events/observation",
            &token,
            body.clone()
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED
    );
    let (_, _, other, _, _, _) = fixture().await;
    assert_eq!(
        observe_reference(state.clone(), &host, &keys, other, note.id)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let extra = serde_json::to_vec(&serde_json::json!({"event_id":note.id.to_hex(),"community_id":community.as_uuid().to_string(),"content":"forbidden"})).unwrap();
    let token = auth_at(&keys, &host, "/events/observation", &extra);
    assert_eq!(
        post_at(state.clone(), &host, "/events/observation", &token, extra)
            .await
            .status(),
        StatusCode::BAD_REQUEST
    );
    sqlx::query("UPDATE communities SET archived_at=now() WHERE id=$1")
        .bind(community.as_uuid())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        observe_reference(state, &host, &keys, community, note.id)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn observation_rechecks_durable_ban_even_when_original_membership_is_retained() {
    let (state, pool, community, host, keys, channel) = fixture().await;
    let message = EventBuilder::new(Kind::Custom(9), "evidence")
        .tags([Tag::parse(["h", &channel.to_string()]).unwrap()])
        .sign_with_keys(&keys)
        .unwrap();
    state
        .db
        .insert_event(community, &message, Some(channel))
        .await
        .unwrap();
    let note = EventBuilder::new(Kind::TextNote, "community evidence")
        .sign_with_keys(&keys)
        .unwrap();
    state.db.insert_event(community, &note, None).await.unwrap();
    for id in [message.id, note.id] {
        assert_eq!(
            observe_reference(state.clone(), &host, &keys, community, id)
                .await
                .status(),
            StatusCode::OK
        );
    }
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
    assert!(
        state
            .db
            .is_relay_member(community, &keys.public_key().to_hex())
            .await
            .unwrap(),
        "the ban must exercise retained Community membership"
    );
    assert!(
        state
            .db
            .is_member(community, channel, keys.public_key().as_bytes())
            .await
            .unwrap(),
        "the ban must exercise retained Channel membership"
    );
    for id in [message.id, note.id] {
        assert_eq!(
            observe_reference(state.clone(), &host, &keys, community, id)
                .await
                .status(),
            StatusCode::NOT_FOUND,
            "durable ban must refuse current proof even when the member cache/row still admits"
        );
    }
    buzz_db::moderation::unban_member(
        &pool,
        community,
        keys.public_key().as_bytes(),
        keys.public_key().as_bytes(),
    )
    .await
    .unwrap();
    for id in [message.id, note.id] {
        assert_eq!(
            observe_reference(state.clone(), &host, &keys, community, id)
                .await
                .status(),
            StatusCode::OK
        );
    }
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn repeated_deletion_keeps_private_writer_scope_and_historical_null_is_not_global() {
    let (state, pool, community, host, keys, channel) = fixture().await;
    sqlx::query("UPDATE channels SET visibility='private' WHERE community_id=$1 AND id=$2")
        .bind(community.as_uuid())
        .bind(channel)
        .execute(&pool)
        .await
        .unwrap();
    let original = EventBuilder::new(Kind::Custom(9), "private original")
        .tags([Tag::parse(["h", &channel.to_string()]).unwrap()])
        .sign_with_keys(&keys)
        .unwrap();
    state
        .db
        .insert_event(community, &original, Some(channel))
        .await
        .unwrap();
    state
        .db
        .soft_delete_event(community, original.id.as_bytes())
        .await
        .unwrap();
    let deletion = EventBuilder::new(Kind::EventDeletion, "")
        .tags([Tag::event(original.id)])
        .sign_with_keys(&keys)
        .unwrap();
    let body = deletion.as_json().into_bytes();
    let path = format!("/events?community={}", community.as_uuid());
    let token = auth_with_tags(
        &keys,
        &host,
        &path,
        &body,
        vec![Tag::parse(["community", &community.as_uuid().to_string()]).unwrap()],
    );
    let response = post_at(state.clone(), &host, &path, &token, body).await;
    assert_eq!(response.status(), StatusCode::OK);
    let ack: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(ack["accepted"], true);
    let stored = state
        .db
        .get_event_by_id_including_deleted(community, deletion.id.as_bytes())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stored.channel_id,
        Some(channel),
        "actual kind5 ingest must retain the already-deleted target's private channel"
    );
    assert_eq!(
        observe_reference(state.clone(), &host, &keys, community, deletion.id)
            .await
            .status(),
        StatusCode::OK
    );
    let control = Keys::generate();
    sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'owner')")
        .bind(community.as_uuid())
        .bind(control.public_key().to_hex())
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        observe_reference(state.clone(), &host, &control, community, deletion.id)
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    // Preserve an actual historical bad writer row; the observation refuses it
    // instead of silently repairing its scope using today's target lookup.
    sqlx::query("UPDATE events SET channel_id=NULL WHERE community_id=$1 AND id=$2")
        .bind(community.as_uuid())
        .bind(deletion.id.as_bytes().as_slice())
        .execute(&pool)
        .await
        .unwrap();
    for reader in [&keys, &control] {
        assert_eq!(
            observe_reference(state.clone(), &host, reader, community, deletion.id)
                .await
                .status(),
            StatusCode::NOT_FOUND,
            "historical NULL scope is not affirmative global evidence"
        );
    }
    let deletion_of_deletion = EventBuilder::new(Kind::EventDeletion, "")
        .tags([Tag::event(deletion.id)])
        .sign_with_keys(&keys)
        .unwrap();
    state
        .db
        .insert_event(community, &deletion_of_deletion, None)
        .await
        .unwrap();
    assert_eq!(
        observe_reference(state, &host, &control, community, deletion_of_deletion.id)
            .await
            .status(),
        StatusCode::NOT_FOUND,
        "a chain of NULL deletions cannot become a global evidence oracle"
    );
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn pulse_unlike_keeps_positive_evidence_after_note_and_reaction_are_deleted() {
    let (state, _, community, host, keys, _) = fixture().await;
    let note = EventBuilder::new(Kind::TextNote, "public pulse")
        .sign_with_keys(&keys)
        .unwrap();
    let reaction = EventBuilder::new(Kind::Reaction, "+")
        .tags([Tag::event(note.id), Tag::public_key(keys.public_key())])
        .sign_with_keys(&keys)
        .unwrap();
    let unlike = EventBuilder::new(Kind::EventDeletion, "")
        .tags([Tag::event(reaction.id)])
        .sign_with_keys(&keys)
        .unwrap();
    let path = format!("/events?community={}", community.as_uuid());
    for event in [&note, &reaction, &unlike] {
        let body = event.as_json().into_bytes();
        let token = auth_with_tags(
            &keys,
            &host,
            &path,
            &body,
            vec![Tag::parse(["community", &community.as_uuid().to_string()]).unwrap()],
        );
        let response = post_at(state.clone(), &host, &path, &token, body).await;
        assert_eq!(response.status(), StatusCode::OK);
        let ack: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
        assert_eq!(
            ack["accepted"], true,
            "original Pulse note/like/unlike must be accepted"
        );
    }
    for event in [&note, &reaction, &unlike] {
        state
            .db
            .soft_delete_event(community, event.id.as_bytes())
            .await
            .unwrap();
    }
    let response = observe_reference(state, &host, &keys, community, unlike.id).await;
    assert_eq!(
        response.status(),
        StatusCode::OK,
        "valid Pulse unlike cannot be lost behind the historical NULL deletion fence"
    );
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body["kind"], 5);
    assert!(body["channel_id"].is_null());
    assert_eq!(body.as_object().unwrap().len(), 5);
}

struct SettlementFixture {
    state: Arc<AppState>,
    pool: sqlx::PgPool,
    community: CommunityId,
    host: String,
    author: Keys,
    controller: Keys,
    channel: uuid::Uuid,
}

async fn settlement_fixture() -> SettlementFixture {
    let (state, pool, community, host, author, _stream_channel) = fixture().await;
    let controller = Keys::generate();
    let peer = Keys::generate().public_key();
    let mut tx = pool.begin().await.unwrap();
    sqlx::query("UPDATE relay_members SET role='member' WHERE community_id=$1 AND pubkey=$2")
        .bind(community.as_uuid())
        .bind(author.public_key().to_hex())
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'owner')")
        .bind(community.as_uuid())
        .bind(controller.public_key().to_hex())
        .execute(&mut *tx)
        .await
        .unwrap();
    sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'member')")
        .bind(community.as_uuid())
        .bind(peer.to_hex())
        .execute(&mut *tx)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let (dm, _) = state
        .db
        .open_dm(
            community,
            &[peer.as_bytes()],
            author.public_key().as_bytes(),
        )
        .await
        .unwrap();
    assert_eq!(dm.channel_type.as_str(), "dm");
    assert_eq!(dm.visibility.as_str(), "private");
    SettlementFixture {
        state,
        pool,
        community,
        host,
        author,
        controller,
        channel: dm.id,
    }
}

async fn settlement_claim(
    fixture: &SettlementFixture,
    age: u64,
) -> (Event, buzz_core::publication::PublicationClaim) {
    let policy = fixture
        .state
        .db
        .publication_policy(fixture.community)
        .await
        .unwrap();
    assert!(policy.ready);
    let now: i64 =
        sqlx::query_scalar("SELECT floor(extract(epoch from clock_timestamp()))::bigint")
            .fetch_one(&fixture.pool)
            .await
            .unwrap();
    let created_at = u64::try_from(now).unwrap() - age;
    let event = EventBuilder::new(Kind::Custom(9), "original private message")
        .tags([
            Tag::parse(["h", &fixture.channel.to_string()]).unwrap(),
            Tag::parse([buzz_core::publication::PUBLICATION_EPOCH_TAG, &policy.epoch]).unwrap(),
        ])
        .custom_created_at(Timestamp::from(created_at))
        .sign_with_keys(&fixture.author)
        .unwrap();
    let claim = buzz_core::publication::PublicationClaim {
        event_id: event.id.to_hex(),
        community_id: fixture.community.as_uuid().to_string(),
        pubkey: fixture.author.public_key().to_hex(),
        kind: 9,
        channel_id: Some(fixture.channel.to_string()),
        created_at,
        non_expiring: true,
        epoch: policy.epoch,
    };
    assert!(claim.matches_event(&event, Some(fixture.channel)));
    (event, claim)
}

fn settlement_auth(keys: &Keys, host: &str, body: &[u8], community: CommunityId) -> String {
    auth_with_tags(
        keys,
        host,
        "/events/settlement",
        body,
        vec![Tag::parse(["community", &community.as_uuid().to_string()]).unwrap()],
    )
}

async fn settlement_post(
    state: Arc<AppState>,
    host: &str,
    primary: &str,
    attestation: Option<&str>,
    body: Vec<u8>,
) -> Response {
    let mut request = Request::builder()
        .method("POST")
        .uri("/events/settlement")
        .header(header::HOST, host)
        .header(header::AUTHORIZATION, primary);
    if let Some(attestation) = attestation {
        request = request.header("x-kailo-publication-attestation", attestation);
    }
    crate::router::build_router(state)
        .oneshot(request.body(Body::from(body)).unwrap())
        .await
        .unwrap()
}

async fn settle_claim(
    fixture: &SettlementFixture,
    claim: &buzz_core::publication::PublicationClaim,
) -> Response {
    let body = serde_json::to_vec(claim).unwrap();
    let primary = settlement_auth(&fixture.author, &fixture.host, &body, fixture.community);
    let attestation = settlement_auth(&fixture.controller, &fixture.host, &body, fixture.community);
    settlement_post(
        fixture.state.clone(),
        &fixture.host,
        &primary,
        Some(&attestation),
        body,
    )
    .await
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn settlement_requires_independent_current_core_attestation_and_both_replay_gates() {
    let fixture = settlement_fixture().await;
    let (_, claim) = settlement_claim(&fixture, 961).await;
    let body = serde_json::to_vec(&claim).unwrap();
    let author = settlement_auth(&fixture.author, &fixture.host, &body, fixture.community);
    assert_eq!(
        settlement_post(
            fixture.state.clone(),
            &fixture.host,
            &author,
            None,
            body.clone()
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let administrator = Keys::generate();
    sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'admin')")
        .bind(fixture.community.as_uuid())
        .bind(administrator.public_key().to_hex())
        .execute(&fixture.pool)
        .await
        .unwrap();
    let impostor = settlement_auth(&administrator, &fixture.host, &body, fixture.community);
    assert_eq!(
        settlement_post(
            fixture.state.clone(),
            &fixture.host,
            &author,
            Some(&impostor),
            body.clone()
        )
        .await
        .status(),
        StatusCode::NOT_FOUND,
        "an arbitrary signer is not Core metadata authority"
    );
    let author = settlement_auth(&fixture.author, &fixture.host, &body, fixture.community);
    assert_eq!(
        settlement_post(
            fixture.state.clone(),
            &fixture.host,
            &author,
            Some(&author),
            body.clone()
        )
        .await
        .status(),
        StatusCode::NOT_FOUND,
        "the business author cannot attest its own timestamp"
    );
    let missing_scope = auth_at(
        &fixture.controller,
        &fixture.host,
        "/events/settlement",
        &body,
    );
    let author = settlement_auth(&fixture.author, &fixture.host, &body, fixture.community);
    assert_eq!(
        settlement_post(
            fixture.state.clone(),
            &fixture.host,
            &author,
            Some(&missing_scope),
            body.clone()
        )
        .await
        .status(),
        StatusCode::NOT_FOUND
    );
    let attestation = settlement_auth(&fixture.controller, &fixture.host, &body, fixture.community);
    let author = settlement_auth(&fixture.author, &fixture.host, &body, fixture.community);
    let response = settlement_post(
        fixture.state.clone(),
        &fixture.host,
        &author,
        Some(&attestation),
        body.clone(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let proof: buzz_core::publication::PublicationSettlement =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert!(proof.proves_absence_for(&claim));
    let fresh_author = settlement_auth(&fixture.author, &fixture.host, &body, fixture.community);
    assert_eq!(
        settlement_post(
            fixture.state.clone(),
            &fixture.host,
            &fresh_author,
            Some(&attestation),
            body.clone()
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED,
        "Core attestation has its own replay gate"
    );
    let fresh_attestation =
        settlement_auth(&fixture.controller, &fixture.host, &body, fixture.community);
    assert_eq!(
        settlement_post(
            fixture.state.clone(),
            &fixture.host,
            &author,
            Some(&fresh_attestation),
            body
        )
        .await
        .status(),
        StatusCode::UNAUTHORIZED,
        "the original author has its own replay gate"
    );
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn settlement_retains_private_soft_deleted_evidence_without_admitting_control_to_dm() {
    let fixture = settlement_fixture().await;
    let (event, claim) = settlement_claim(&fixture, 0).await;
    assert!(!fixture
        .state
        .db
        .is_member(
            fixture.community,
            fixture.channel,
            fixture.controller.public_key().as_bytes()
        )
        .await
        .unwrap());
    fixture
        .state
        .db
        .insert_event(fixture.community, &event, Some(fixture.channel))
        .await
        .unwrap();
    fixture
        .state
        .db
        .soft_delete_event(fixture.community, event.id.as_bytes())
        .await
        .unwrap();
    let response = settle_claim(&fixture, &claim).await;
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    assert!(!String::from_utf8_lossy(&bytes).contains(&event.content));
    let proof: buzz_core::publication::PublicationSettlement =
        serde_json::from_slice(&bytes).unwrap();
    assert!(proof.accepted);
    assert_eq!(proof.claim, claim);
    sqlx::query(
        "DELETE FROM channel_members WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3",
    )
    .bind(fixture.community.as_uuid())
    .bind(fixture.channel)
    .bind(fixture.author.public_key().as_bytes().as_slice())
    .execute(&fixture.pool)
    .await
    .unwrap();
    assert_eq!(
        settle_claim(&fixture, &claim).await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn settlement_refuses_old_epochs_and_does_not_advertise_missing_storage_fences() {
    let fixture = settlement_fixture().await;
    let (_, claim) = settlement_claim(&fixture, 961).await;
    let document = crate::nip11::nip11_document(&fixture.state, &fixture.host).await;
    assert_eq!(document.publication_policy.unwrap().epoch, claim.epoch);
    sqlx::query("UPDATE communities SET publication_epoch=gen_random_uuid() WHERE id=$1")
        .bind(fixture.community.as_uuid())
        .execute(&fixture.pool)
        .await
        .unwrap();
    let response = settle_claim(&fixture, &claim).await;
    assert_eq!(response.status(), StatusCode::OK);
    let proof: buzz_core::publication::PublicationSettlement =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert!(
        !proof.proves_absence_for(&claim),
        "a restored or rotated Community cannot prove an old signed epoch absent"
    );
    sqlx::query("ALTER TABLE events DISABLE TRIGGER events_publication_fence")
        .execute(&fixture.pool)
        .await
        .unwrap();
    let document = crate::nip11::nip11_document(&fixture.state, &fixture.host).await;
    let response = settle_claim(&fixture, &claim).await;
    sqlx::query("ALTER TABLE events ENABLE TRIGGER events_publication_fence")
        .execute(&fixture.pool)
        .await
        .unwrap();
    assert!(
        document.publication_policy.is_none(),
        "NIP-11 must reflect actual writer readiness"
    );
    assert_eq!(response.status(), StatusCode::OK);
    let proof: buzz_core::publication::PublicationSettlement =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert!(!proof.proves_absence_for(&claim));
}

#[tokio::test]
#[ignore = "requires isolated migrated BUZZ_TEST_DATABASE_URL and REDIS_URL"]
async fn settlement_rechecks_original_private_membership_after_waiting_for_writer() {
    let fixture = settlement_fixture().await;
    let (event, claim) = settlement_claim(&fixture, 0).await;
    let mut writer = fixture.pool.begin().await.unwrap();
    buzz_db::event::insert_event_in_transaction(
        &mut writer,
        fixture.community,
        &event,
        Some(fixture.channel),
    )
    .await
    .unwrap();
    let pid: i32 = sqlx::query_scalar("SELECT pg_backend_pid()")
        .fetch_one(&mut *writer)
        .await
        .unwrap();
    let body = serde_json::to_vec(&claim).unwrap();
    let primary = settlement_auth(&fixture.author, &fixture.host, &body, fixture.community);
    let attestor = settlement_auth(&fixture.controller, &fixture.host, &body, fixture.community);
    let state = fixture.state.clone();
    let host = fixture.host.clone();
    let request = tokio::spawn(async move {
        settlement_post(state, &host, &primary, Some(&attestor), body).await
    });
    wait_for_writer(&fixture.pool, pid, &request).await;
    sqlx::query(
        "DELETE FROM channel_members WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3",
    )
    .bind(fixture.community.as_uuid())
    .bind(fixture.channel)
    .bind(fixture.author.public_key().as_bytes().as_slice())
    .execute(&fixture.pool)
    .await
    .unwrap();
    writer.commit().await.unwrap();
    let response = tokio::time::timeout(std::time::Duration::from_secs(5), request)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        response.status(),
        StatusCode::NOT_FOUND,
        "pre-read membership cannot survive a revocation while the writer was pending"
    );
}
