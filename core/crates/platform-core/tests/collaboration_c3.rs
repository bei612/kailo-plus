//! DD-125 batch C3 against the deployed BFF, Relay and Core database: the channel Canvas
//! (V-SCN-135), link-preview fetch refusals and snapshot references (V-SCN-139) and the GIF
//! option (V-SCN-140). The fixture is a real lifecycle Workspace, never seeded rows.

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
        req = req
            .header("idempotency-key", Uuid::new_v4().to_string())
            .json(&b);
    }
    let resp = req.send().await.expect("BFF call");
    let status = resp.status();
    let value = resp.json().await.unwrap_or(serde_json::Value::Null);
    (status, value)
}

fn canvas_command(key: Uuid, workspace: Uuid, content: &str) -> serde_json::Value {
    serde_json::json!({"actionKey": "workspace.canvas.set", "idempotencyKey": key,
        "workspaceId": workspace, "explicitConfirmation": true,
        "workspaceCanvas": {"content": content}})
}

#[tokio::test]
async fn dd125_canvas_link_previews_and_gif_option() {
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
    let _ = sqlx::query("delete from admission.link_preview_snapshot where tenant_id = $1")
        .bind(fx.tenant)
        .execute(&pool)
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
    let canvas_path = format!("/api/v1/workspaces/{}/canvas", fx.workspace);

    // A new Workspace has no adopted Canvas.
    let (status, view) = call(reqwest::Method::GET, canvas_path.clone(), None).await;
    assert_eq!(status, reqwest::StatusCode::OK, "canvas read: {view}");
    common::assert_contract::<contracts::WebChannelCanvasView>(&view, "GET canvas");
    assert!(view.get("content").is_none() && view.get("eventId").is_none());
    let offered = view.get("setActionKey").is_some();

    // V-SCN-135: the governed write. The hint and the admission must agree.
    let key = Uuid::new_v4();
    let command = |content: &str| canvas_command(key, fx.workspace, content);
    let body = "# Release room\n\nWelcome.";
    let actions = "/api/v1/actions".to_owned();
    let (status, submission) =
        call(reqwest::Method::POST, actions.clone(), Some(command(body))).await;
    if !offered {
        assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "{submission}");
        assert_eq!(submission["reason"], "PERMISSION_DENIED", "{submission}");
    } else {
        assert!(status.is_success(), "canvas set: {submission}");
        common::assert_contract::<contracts::ActionSubmission>(&submission, "canvas set");
        assert_eq!(submission["dispatchState"], "DISPATCHED", "{submission}");
        // The same key answers the same operation; another body is a reuse.
        let (_, replay) = call(reqwest::Method::POST, actions.clone(), Some(command(body))).await;
        assert_eq!(replay["operationId"], submission["operationId"]);
        let (status, reused) =
            call(reqwest::Method::POST, actions.clone(), Some(command("other"))).await;
        assert_eq!(status, reqwest::StatusCode::CONFLICT, "{reused}");
        let (_, view) = call(reqwest::Method::GET, canvas_path.clone(), None).await;
        assert_eq!(view["content"], body, "{view}");
        // Core keeps the digest and event ID only, never the body.
        let stored: serde_json::Value = sqlx::query_scalar(
            "select parameters from admission.action_execution where operation_id = $1::uuid",
        )
        .bind(submission["operationId"].as_str().unwrap())
        .fetch_one(pool)
        .await
        .unwrap();
        assert!(!stored.to_string().contains("Release room"));
        let event: String = sqlx::query_scalar(
            "select i.event_id from admission.workspace_canvas_intent i
             join admission.action_execution a on a.id = i.action_execution_id
             where a.operation_id = $1::uuid and i.outcome = 'VERIFIED'",
        )
        .bind(submission["operationId"].as_str().unwrap())
        .fetch_one(pool)
        .await
        .unwrap();
        assert_eq!(view["eventId"], event);
    }

    // V-SCN-139: the fetch host refuses non-https and internal addresses before connecting.
    let previews = format!("/api/v1/workspaces/{}/link-previews", fx.workspace);
    for (url, expected) in [
        ("http://example.com/", reqwest::StatusCode::UNPROCESSABLE_ENTITY),
        ("https://127.0.0.1/", reqwest::StatusCode::NOT_FOUND),
        ("https://169.254.169.254/latest/", reqwest::StatusCode::NOT_FOUND),
        ("https://[::1]/", reqwest::StatusCode::NOT_FOUND),
    ] {
        let request = serde_json::json!({ "url": url });
        let (status, refused) = call(reqwest::Method::POST, previews.clone(), Some(request)).await;
        assert_eq!(status, expected, "{url}: {refused}");
    }
    // Audit keeps the host and a URL digest, never the URL.
    let audited: Vec<String> = sqlx::query_scalar(
        "select result_code from audit.audit_event
         where tenant_id = $1 and action_key = 'workspace.link_preview.fetch'",
    )
    .bind(fx.tenant)
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(audited.iter().all(|code| code == "ADDRESS_REFUSED"), "{audited:?}");
    let leaked: bool = sqlx::query_scalar(
        "select exists(select 1 from audit.audit_event where tenant_id = $1
         and parameter_hash like '%169.254%')",
    )
    .bind(fx.tenant)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(!leaked);

    // A publication may reference only the caller's own unexpired snapshot.
    let messages = format!("/api/v1/workspaces/{}/messages", fx.workspace);
    let foreign = serde_json::json!({"content": "See https://example.com/x",
        "linkPreviewSnapshotIds": [Uuid::new_v4()]});
    let (status, refused) = call(reqwest::Method::POST, messages.clone(), Some(foreign)).await;
    assert_eq!(status, reqwest::StatusCode::NOT_FOUND, "{refused}");
    assert_eq!(refused["reason"], "TARGET_NOT_FOUND");
    let mixed = serde_json::json!({"content": "x", "suppressLinkPreviews": true,
        "linkPreviewSnapshotIds": [Uuid::new_v4()]});
    let (status, _) = call(reqwest::Method::POST, messages.clone(), Some(mixed)).await;
    assert_eq!(status, reqwest::StatusCode::BAD_REQUEST);
    let suppressed = serde_json::json!({"content": "See https://example.com/y",
        "suppressLinkPreviews": true});
    let (status, sent) = call(reqwest::Method::POST, messages, Some(suppressed)).await;
    assert_eq!(status, reqwest::StatusCode::OK, "{sent}");

    // V-SCN-140: the option is a deployment fact; without it nothing is forwarded.
    let (status, gif) = call(reqwest::Method::GET, "/api/v1/gifs".to_owned(), None).await;
    assert_eq!(status, reqwest::StatusCode::OK, "{gif}");
    common::assert_contract::<contracts::WebGifCapabilityView>(&gif, "GET gifs");
    if gif["available"] != true {
        let search = serde_json::json!({"query": "ship it", "locale": "en-US"});
        let path = "/api/v1/gifs/search".to_owned();
        let (status, refused) = call(reqwest::Method::POST, path, Some(search)).await;
        assert_eq!(status, reqwest::StatusCode::FORBIDDEN, "{refused}");
        assert_eq!(refused["reason"], "CAPABILITY_BLOCKED");
    }
}
