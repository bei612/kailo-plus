//! DD-125 batch C4 against the deployed BFF and Core database (V-SCN-143): the Agent transcript,
//! its live stream and the Workspace running-turn read are audit-only. The fixture is a real
//! lifecycle Workspace without any Installation, never seeded rows; the positive transcript path
//! needs a real running Agent and is covered by the three-user acceptance, not faked here.

use futures_util::FutureExt;
use sqlx::PgPool;
use uuid::Uuid;

mod common;
use common::Env;

async fn get(
    http: &reqwest::Client,
    e: &Env,
    subject: &str,
    path: &str,
) -> (reqwest::StatusCode, String) {
    let resp = http
        .get(format!("{}{path}", e.bff_url))
        .header("x-platform-oidc-issuer", &e.oidc_issuer)
        .header("x-platform-oidc-subject", subject)
        .send()
        .await
        .expect("BFF call");
    let status = resp.status();
    (status, resp.text().await.unwrap_or_default())
}

#[tokio::test]
async fn dd125_transcript_and_running_turns_are_audit_only() {
    let Some(e) = common::env() else { return };
    let http = reqwest::Client::new();
    let pool = PgPool::connect(&e.database_url).await.expect("Core database");
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
    // A Workspace without Installations has no running turn to expose.
    let path = format!("/api/v1/workspaces/{}/agent-turns", fx.workspace);
    let (status, body) = get(http, e, &fx.subject, &path).await;
    assert_eq!(status, reqwest::StatusCode::OK, "agent turns: {body}");
    let page: serde_json::Value = serde_json::from_str(&body).unwrap();
    common::assert_contract::<contracts::AgentActiveTurnPage>(&page, "GET agent-turns");
    assert_eq!(page["workspaceId"], fx.workspace.to_string());
    assert_eq!(page["turns"], serde_json::json!([]));
    // An empty read is not a sensitive read: no ACCESS fact is written for it.
    let accesses: i64 = sqlx::query_scalar(
        "select count(*) from audit.audit_event where tenant_id=$1
           and action_key in ('agent.turns.read','agent.transcript.read','agent.transcript.stream')",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(accesses, 0);

    // Another Tenant's or an unknown Installation is indistinguishable from absence, and the
    // transcript, its stream and malformed queries never reach the native runtime.
    let unknown = Uuid::new_v4();
    let root = "a".repeat(64);
    let transcript = format!(
        "/api/v1/agent-installations/{unknown}/transcript?rootEventId={root}&projectionGeneration=1"
    );
    let (status, body) = get(http, e, &fx.subject, &transcript).await;
    assert_eq!(status, reqwest::StatusCode::NOT_FOUND, "{body}");
    let stream = format!("/api/v1/agent-installations/{unknown}/transcript/stream");
    let (status, body) = get(http, e, &fx.subject, &stream).await;
    assert_eq!(status, reqwest::StatusCode::NOT_FOUND, "{body}");
    let malformed = format!("/api/v1/agent-installations/{unknown}/transcript?rootEventId={root}");
    let (status, _) = get(http, e, &fx.subject, &malformed).await;
    assert!(status.is_client_error(), "{status}");
}
