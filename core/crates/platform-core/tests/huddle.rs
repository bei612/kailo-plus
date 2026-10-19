//! DD-125 batch C5 against the deployed BFF, Relay and Core database: the original Huddle
//! over HuddleBuzzBinding (V-SCN-131, V-SCN-134, V-SCN-160). The fixture is a real lifecycle
//! Workspace, never seeded rows. Audio itself is exercised by the Web/Desktop clients; this
//! test covers admission, the CONTROL temp-channel projection, the binding states and the
//! determinate voice-unavailable view.

use futures_util::FutureExt;
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::Env;

async fn bff(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> (reqwest::StatusCode, serde_json::Value) {
    let mut req = http
        .request(method, format!("{}{path}", e.bff_url))
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", subject);
    if let Some(b) = body {
        req = req.json(&b);
    }
    let resp = req.send().await.expect("BFF call");
    let status = resp.status();
    let value = resp.json().await.unwrap_or(serde_json::Value::Null);
    (status, value)
}

fn start(key: Uuid, workspace: Uuid, name: &str) -> serde_json::Value {
    serde_json::json!({"actionKey": "huddle.start", "idempotencyKey": key,
        "workspaceId": workspace,
        "huddleStart": {"parentWorkspaceId": workspace, "channelName": name}})
}

#[tokio::test]
async fn dd125_huddle_projection_binding_and_voice_view() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url)
        .await
        .expect("Core database");
    let token = common::worker_token(&http, &e).await;
    let fx = match common::provision_live_workspace(&http, &e, &pool, &token).await {
        Ok(f) => f,
        Err(msg) => panic!("live Workspace fixture failed: {msg}"),
    };
    let outcome = std::panic::AssertUnwindSafe(run(&http, &e, &pool, &fx))
        .catch_unwind()
        .await;
    common::teardown_live_workspace(&e, &pool, &fx).await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}

async fn run(http: &reqwest::Client, e: &Env, pool: &PgPool, fx: &common::LiveWorkspace) {
    let call = |method: reqwest::Method, path: String, body: Option<serde_json::Value>| async move {
        bff(http, e, &fx.subject, method, &path, body).await
    };
    let actions = "/api/v1/actions".to_owned();

    // V-SCN-160: without a deployed voice service both are determinately unavailable.
    let (status, voice) = call(reqwest::Method::GET, "/api/v1/huddles/voice".into(), None).await;
    assert_eq!(status, reqwest::StatusCode::OK, "{voice}");
    common::assert_contract::<contracts::HuddleVoiceView>(&voice, "GET voice");
    assert_eq!(voice["transcription"], "UNAVAILABLE");
    assert_eq!(voice["speech"], "UNAVAILABLE");

    let listed = format!("/api/v1/huddles?parentWorkspaceId={}", fx.workspace);
    let (status, page) = call(reqwest::Method::GET, listed.clone(), None).await;
    assert_eq!(status, reqwest::StatusCode::OK, "{page}");
    common::assert_contract::<contracts::HuddlePage>(&page, "GET huddles");
    assert!(page["items"].as_array().is_some_and(Vec::is_empty));

    // Exactly one parent; NONE confirmation means explicitConfirmation is foreign.
    let mut both = start(Uuid::new_v4(), fx.workspace, "x huddle");
    both["huddleStart"]["parentConversationId"] = serde_json::json!(Uuid::new_v4());
    let (status, refused) = call(reqwest::Method::POST, actions.clone(), Some(both)).await;
    assert_eq!(
        status,
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "{refused}"
    );
    let mut confirmed = start(Uuid::new_v4(), fx.workspace, "x huddle");
    confirmed["explicitConfirmation"] = serde_json::json!(true);
    let (status, refused) = call(reqwest::Method::POST, actions.clone(), Some(confirmed)).await;
    assert_eq!(
        status,
        reqwest::StatusCode::UNPROCESSABLE_ENTITY,
        "{refused}"
    );

    // V-SCN-131: CONTROL projects the temp channel for the caller's own SERVER key.
    let key = Uuid::new_v4();
    let (status, submission) = call(
        reqwest::Method::POST,
        actions.clone(),
        Some(start(key, fx.workspace, "release huddle")),
    )
    .await;
    assert!(status.is_success(), "huddle.start: {submission}");
    common::assert_contract::<contracts::ActionSubmission>(&submission, "huddle.start");
    let huddle = submission["huddleId"]
        .as_str()
        .expect("huddleId")
        .to_owned();
    assert_eq!(submission["dispatchState"], "DISPATCHED", "{submission}");
    let (_, replay) = call(
        reqwest::Method::POST,
        actions.clone(),
        Some(start(key, fx.workspace, "release huddle")),
    )
    .await;
    assert_eq!(replay["operationId"], submission["operationId"]);
    assert_eq!(replay["huddleId"], submission["huddleId"]);
    let (status, reused) = call(
        reqwest::Method::POST,
        actions.clone(),
        Some(start(key, fx.workspace, "other huddle")),
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::CONFLICT, "{reused}");

    let (creator, server): (String, String) = sqlx::query_as(
        "select h.creator_pubkey, b.pubkey from projection.huddle_buzz_binding h
         join identity.buzz_identity_binding b on b.principal_id = h.initiator_principal_id
          and b.kind = 'HUMAN' and b.custody = 'SERVER' and b.state = 'ACTIVE'
         where h.id = $1::uuid and h.state = 'ACTIVE'",
    )
    .bind(&huddle)
    .fetch_one(pool)
    .await
    .expect("ACTIVE binding with the caller's SERVER key as creator");
    assert_eq!(creator, server);

    let (status, view) = call(
        reqwest::Method::GET,
        format!("/api/v1/huddles/{huddle}"),
        None,
    )
    .await;
    assert_eq!(status, reqwest::StatusCode::OK, "{view}");
    common::assert_contract::<contracts::HuddleView>(&view, "GET huddle");
    assert_eq!(view["state"], "ACTIVE");
    assert_eq!(view["creatorPubkey"], creator.as_str());

    // V-SCN-134: the initiator ends it; CONTROL archives the temp channel.
    let end = serde_json::json!({"actionKey": "huddle.end", "idempotencyKey": Uuid::new_v4(),
        "workspaceId": fx.workspace, "huddleId": huddle});
    let (status, ended) = call(reqwest::Method::POST, actions.clone(), Some(end)).await;
    assert!(status.is_success(), "huddle.end: {ended}");
    assert_eq!(ended["dispatchState"], "DISPATCHED", "{ended}");
    let state: String =
        sqlx::query_scalar("select state from projection.huddle_buzz_binding where id = $1::uuid")
            .bind(&huddle)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(state, "ENDED");
    let (_, page) = call(reqwest::Method::GET, listed, None).await;
    assert!(
        page["items"].as_array().is_some_and(Vec::is_empty),
        "{page}"
    );
    // An ended Huddle is never reused.
    let again = serde_json::json!({"actionKey": "huddle.end", "idempotencyKey": Uuid::new_v4(),
        "workspaceId": fx.workspace, "huddleId": huddle});
    let (status, refused) = call(reqwest::Method::POST, actions, Some(again)).await;
    assert_eq!(status, reqwest::StatusCode::CONFLICT, "{refused}");
}
