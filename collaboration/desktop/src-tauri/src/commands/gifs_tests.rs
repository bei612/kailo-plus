use super::*;
use axum::{body::Bytes, http::HeaderMap, http::StatusCode, routing::get, routing::post, Router};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use nostr::JsonUtil;
use sha2::{Digest, Sha256};
use std::sync::{Arc, Mutex};

fn advertised_info() -> Value {
    serde_json::json!({
        "supported_extensions": ["nip-11", "buzz-gif"],
        "gif": { "provider": "klipy", "search": "/gifs/search", "share": "/gifs/share" },
    })
}

#[test]
fn safe_relay_path_follows_the_original_contract() {
    for path in ["/gifs/search", "/gifs/share", "/a/b-c_d"] {
        assert!(safe_relay_path(path), "{path} must be accepted");
    }
    for path in [
        "",
        "gifs/search",
        "//evil.example/gifs",
        "/gifs\\search",
        "/gifs%2fsearch",
        "/gifs/search?x=1",
        "/gifs/search#x",
        "/gifs/../admin",
        "/./gifs",
        "/gifs/..",
        "https://evil.example/gifs/search",
    ] {
        assert!(!safe_relay_path(path), "{path:?} must be rejected");
    }
}

#[test]
fn descriptor_requires_extension_provider_and_safe_paths() {
    assert_eq!(
        parse_gif_descriptor(&advertised_info()),
        Some(RelayGifDescriptor {
            search_path: "/gifs/search".to_owned(),
            share_path: "/gifs/share".to_owned(),
        })
    );

    let mut no_extension = advertised_info();
    no_extension["supported_extensions"] = serde_json::json!(["nip-11"]);
    assert_eq!(parse_gif_descriptor(&no_extension), None);

    let mut other_provider = advertised_info();
    other_provider["gif"]["provider"] = serde_json::json!("tenor");
    assert_eq!(parse_gif_descriptor(&other_provider), None);

    let mut unsafe_search = advertised_info();
    unsafe_search["gif"]["search"] = serde_json::json!("//evil.example/search");
    assert_eq!(parse_gif_descriptor(&unsafe_search), None);

    let mut missing_share = advertised_info();
    missing_share["gif"]
        .as_object_mut()
        .expect("gif object")
        .remove("share");
    assert_eq!(parse_gif_descriptor(&missing_share), None);

    let mut no_gif = advertised_info();
    no_gif.as_object_mut().expect("info object").remove("gif");
    assert_eq!(parse_gif_descriptor(&no_gif), None);

    assert_eq!(parse_gif_descriptor(&serde_json::json!([])), None);
}

#[test]
fn request_text_bounds_match_the_relay() {
    assert!(validate_text("query", "", MAX_QUERY_CHARS, true).is_ok());
    assert!(validate_text("query", &"é".repeat(200), MAX_QUERY_CHARS, true).is_ok());
    assert!(validate_text("query", &"a".repeat(201), MAX_QUERY_CHARS, true).is_err());
    assert!(validate_text("customer_id", "", MAX_CUSTOMER_ID_CHARS, false).is_err());
    assert!(validate_text("customer_id", "   ", MAX_CUSTOMER_ID_CHARS, false).is_err());
    assert!(validate_text(
        "customer_id",
        &"c".repeat(128),
        MAX_CUSTOMER_ID_CHARS,
        false
    )
    .is_ok());
    assert!(validate_text(
        "customer_id",
        &"c".repeat(129),
        MAX_CUSTOMER_ID_CHARS,
        false
    )
    .is_err());
    assert!(validate_text("locale", &"l".repeat(33), MAX_LOCALE_CHARS, false).is_err());
    assert!(validate_text("slug", "", MAX_SLUG_CHARS, false).is_err());
}

/// One recorded POST: path, `Authorization` header and exact body bytes.
type Recorded = Arc<Mutex<Vec<(String, String, Vec<u8>)>>>;

/// A loopback Relay serving `info` at `/info`, answering both GIF routes with `status`.
async fn spawn_gif_relay(info: Value, status: StatusCode) -> (String, Recorded) {
    let recorded: Recorded = Arc::default();
    let route = |path: &'static str| {
        let recorded = recorded.clone();
        post(move |headers: HeaderMap, body: Bytes| async move {
            let auth = headers
                .get("authorization")
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default()
                .to_owned();
            recorded
                .lock()
                .unwrap()
                .push((path.to_owned(), auth, body.to_vec()));
            let reply = if status == StatusCode::OK {
                serde_json::json!({ "result": true, "data": { "data": [] } })
            } else {
                serde_json::json!({ "error": "relay_membership_required" })
            };
            (status, axum::Json(reply))
        })
    };
    let router = Router::new()
        .route("/info", get(move || async move { axum::Json(info) }))
        .route("/gifs/search", route("/gifs/search"))
        .route("/gifs/share", route("/gifs/share"));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, router).await.ok();
    });
    (format!("http://{addr}"), recorded)
}

fn nip98_tag(header: &str, name: &str) -> Option<String> {
    let json = BASE64
        .decode(header.strip_prefix("Nostr ").expect("Nostr scheme"))
        .expect("base64 event");
    let event = nostr::Event::from_json(std::str::from_utf8(&json).unwrap()).unwrap();
    event.verify().expect("valid NIP-98 signature");
    event.tags.iter().find_map(|tag| {
        let values = tag.as_slice();
        (values.first().map(String::as_str) == Some(name)).then(|| values[1].clone())
    })
}

#[tokio::test]
async fn search_signs_the_exact_body_for_the_advertised_path() {
    let _serial = crate::relay_admission::TEST_SERIAL.lock().await;
    let (base, recorded) = spawn_gif_relay(advertised_info(), StatusCode::OK).await;
    let state = crate::app_state::build_app_state();
    let keys = Keys::generate();

    let page = search_at(&state, &base, &keys, "  cats ", "en-US", "customer-1")
        .await
        .expect("search page");

    assert_eq!(page["result"], true);
    let calls = recorded.lock().unwrap().clone();
    assert_eq!(calls.len(), 1);
    let (path, auth, body) = &calls[0];
    assert_eq!(path, "/gifs/search");
    let sent: Value = serde_json::from_slice(body).unwrap();
    assert_eq!(
        sent,
        serde_json::json!({ "customer_id": "customer-1", "locale": "en-US", "query": "cats" })
    );
    assert_eq!(
        nip98_tag(auth, "u").as_deref(),
        Some(format!("{base}/gifs/search").as_str())
    );
    assert_eq!(nip98_tag(auth, "method").as_deref(), Some("POST"));
    assert_eq!(
        nip98_tag(auth, "payload"),
        Some(hex::encode(Sha256::digest(body)))
    );
}

#[tokio::test]
async fn share_posts_slug_and_customer_id() {
    let _serial = crate::relay_admission::TEST_SERIAL.lock().await;
    let (base, recorded) = spawn_gif_relay(advertised_info(), StatusCode::OK).await;
    let state = crate::app_state::build_app_state();

    share_at(&state, &base, &Keys::generate(), "happy-cat", "customer-1")
        .await
        .expect("share report");

    let calls = recorded.lock().unwrap().clone();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, "/gifs/share");
    let sent: Value = serde_json::from_slice(&calls[0].2).unwrap();
    assert_eq!(
        sent,
        serde_json::json!({ "customer_id": "customer-1", "slug": "happy-cat" })
    );
}

#[tokio::test]
async fn membership_refusal_is_a_recognizable_code() {
    let _serial = crate::relay_admission::TEST_SERIAL.lock().await;
    let (base, _) = spawn_gif_relay(advertised_info(), StatusCode::FORBIDDEN).await;
    let state = crate::app_state::build_app_state();

    let error = search_at(&state, &base, &Keys::generate(), "", "en-US", "customer-1")
        .await
        .unwrap_err();

    assert_eq!(error, GIF_MEMBERSHIP_REQUIRED);
}

#[tokio::test]
async fn unadvertised_relay_is_never_posted_to() {
    let _serial = crate::relay_admission::TEST_SERIAL.lock().await;
    let mut info = advertised_info();
    info["supported_extensions"] = serde_json::json!([]);
    let (base, recorded) = spawn_gif_relay(info, StatusCode::OK).await;
    let state = crate::app_state::build_app_state();

    assert_eq!(fetch_gif_descriptor_at(&state, &base).await, Ok(None));
    let error = search_at(&state, &base, &Keys::generate(), "", "en-US", "customer-1")
        .await
        .unwrap_err();

    assert_eq!(error, GIF_UNAVAILABLE);
    assert!(recorded.lock().unwrap().is_empty());
}

#[tokio::test]
async fn invalid_input_is_refused_before_any_request() {
    let (base, recorded) = spawn_gif_relay(advertised_info(), StatusCode::OK).await;
    let state = crate::app_state::build_app_state();
    let keys = Keys::generate();

    assert!(search_at(&state, &base, &keys, "", "en-US", "")
        .await
        .is_err());
    assert!(share_at(&state, &base, &keys, " ", "customer-1")
        .await
        .is_err());
    assert!(recorded.lock().unwrap().is_empty());
}
