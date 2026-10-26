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
    let keys = Keys::generate();
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
    let token = EventBuilder::new(Kind::Custom(27235), "")
        .tags([
            Tag::parse(["u", &format!("https://{host}/events/delivery")]).unwrap(),
            Tag::parse(["method", "POST"]).unwrap(),
            Tag::parse(["payload", &hex::encode(Sha256::digest(body))]).unwrap(),
            Tag::parse(["nonce", &uuid::Uuid::new_v4().to_string()]).unwrap(),
        ])
        .sign_with_keys(keys)
        .unwrap();
    format!("Nostr {}", STANDARD.encode(token.as_json()))
}
async fn post(state: Arc<AppState>, host: &str, authorization: &str, body: Vec<u8>) -> Response {
    crate::router::build_router(state)
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/events/delivery")
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
