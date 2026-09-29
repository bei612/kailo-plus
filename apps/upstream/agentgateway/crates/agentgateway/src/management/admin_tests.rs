use std::net::SocketAddr;
use std::sync::Arc;

use http_body_util::BodyExt;
use tokio::runtime::Handle;

use super::*;

async fn spawn_admin(cfg: &str) -> (SocketAddr, agent_core::drain::DrainTrigger) {
	let config = Arc::new(crate::config::parse_config(cfg.to_string(), None).unwrap());
	let stores = crate::store::Stores::new(config.ipv6_enabled, config.threading_mode);
	let client = crate::client::Client::new(&config.dns, None, Default::default(), None);
	let resource_manager =
		crate::resource_manager::ResourceManager::new(client).expect("resource manager");
	let shutdown = signal::Shutdown::new();
	let (drain_tx, drain_rx) = agent_core::drain::new();
	let svc = Service::new(
		config,
		crate::llm::catalog::ModelCatalog::empty(),
		None,
		stores,
		resource_manager,
		shutdown.trigger(),
		drain_rx,
		Handle::current(),
		&crate::ui::EMPTY_ASSETS_DIR,
	)
	.await
	.expect("admin server should bind");
	let addr = svc.address().expect("admin server should have an address");
	svc.spawn();
	(addr, drain_tx)
}

const TEST_KID: &str = "admin-test-key";
const TEST_ISSUER: &str = "https://issuer.example.com";
const TEST_AUDIENCE: &str = "agentgateway-admin";
const TEST_CLIENT_ID: &str = "platform-core";

/// A P-256 key generated once per test run: the signing half in PKCS#8 PEM and the public half as
/// an inline JWKS for the admin configuration.
struct TestKey {
	private_pem: String,
	jwks: String,
}

fn test_key() -> &'static TestKey {
	static KEY: std::sync::OnceLock<TestKey> = std::sync::OnceLock::new();
	KEY.get_or_init(|| {
		use base64::Engine;
		use base64::engine::general_purpose::URL_SAFE_NO_PAD;
		let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256).unwrap();
		// Uncompressed SEC1 point: 0x04 || x || y.
		let point = key.public_key_raw();
		assert_eq!(point.len(), 65);
		let jwks = serde_json::json!({"keys": [{
			"use": "sig", "kty": "EC", "kid": TEST_KID, "crv": "P-256", "alg": "ES256",
			"x": URL_SAFE_NO_PAD.encode(&point[1..33]),
			"y": URL_SAFE_NO_PAD.encode(&point[33..]),
		}]});
		TestKey {
			private_pem: key.serialize_pem(),
			jwks: jwks.to_string(),
		}
	})
}

fn admin_authentication() -> String {
	format!(
		"  adminAuthentication:\n    issuer: {TEST_ISSUER}\n    audiences: [{TEST_AUDIENCE}]\n    clientId: {TEST_CLIENT_ID}\n    jwks: '{}'\n",
		test_key().jwks
	)
}

fn admin_config(extra: &str) -> String {
	format!(
		"config:\n  adminAddr: localhost:0\n{}{extra}",
		admin_authentication()
	)
}

fn now() -> u64 {
	std::time::SystemTime::now()
		.duration_since(std::time::UNIX_EPOCH)
		.unwrap()
		.as_secs()
}

fn sign(claims: serde_json::Value) -> String {
	crate::crypto::jwt::init();
	let header = jsonwebtoken::Header {
		alg: jsonwebtoken::Algorithm::ES256,
		kid: Some(TEST_KID.to_string()),
		..Default::default()
	};
	let key = jsonwebtoken::EncodingKey::from_ec_pem(test_key().private_pem.as_bytes()).unwrap();
	jsonwebtoken::encode(&header, &claims, &key).unwrap()
}

fn admin_token() -> String {
	sign(serde_json::json!({
		"iss": TEST_ISSUER,
		"aud": TEST_AUDIENCE,
		"azp": TEST_CLIENT_ID,
		"exp": now() + 300,
	}))
}

async fn admin_get(addr: SocketAddr, path: &str, token: Option<&str>) -> reqwest::StatusCode {
	let mut req = reqwest::Client::new().get(format!("http://{addr}{path}"));
	if let Some(token) = token {
		req = req.bearer_auth(token);
	}
	req.send().await.expect("request should succeed").status()
}

#[tokio::test]
async fn admin_rejects_every_request_without_admin_authentication() {
	let (addr, _drain_tx) = spawn_admin("config:\n  adminAddr: localhost:0\n").await;
	for path in ["/", "/config_dump", "/memory", "/debug/pprof/heap"] {
		assert_eq!(
			admin_get(addr, path, Some(&admin_token())).await,
			reqwest::StatusCode::UNAUTHORIZED,
			"{path} must be rejected when admin authentication is not configured"
		);
	}
	let resp = reqwest::Client::new()
		.post(format!("http://{addr}/quitquitquit"))
		.bearer_auth(admin_token())
		.send()
		.await
		.unwrap();
	assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_requires_admin_client_token() {
	let (addr, _drain_tx) = spawn_admin(&admin_config("")).await;
	let exp = now() + 300;
	let claims = |f: &dyn Fn(&mut serde_json::Map<String, serde_json::Value>)| {
		let mut c = serde_json::json!({
			"iss": TEST_ISSUER, "aud": TEST_AUDIENCE, "azp": TEST_CLIENT_ID, "exp": exp,
		});
		f(c.as_object_mut().unwrap());
		sign(c)
	};
	let cases: Vec<(&str, Option<String>, reqwest::StatusCode)> = vec![
		("no token", None, reqwest::StatusCode::UNAUTHORIZED),
		(
			"not a jwt",
			Some("not-a-jwt".to_string()),
			reqwest::StatusCode::UNAUTHORIZED,
		),
		(
			"wrong issuer",
			Some(claims(&|c| {
				c.insert("iss".into(), "https://other.example.com".into());
			})),
			reqwest::StatusCode::UNAUTHORIZED,
		),
		(
			"wrong audience",
			Some(claims(&|c| {
				c.insert("aud".into(), "account".into());
			})),
			reqwest::StatusCode::UNAUTHORIZED,
		),
		(
			"no audience",
			Some(claims(&|c| {
				c.remove("aud");
			})),
			reqwest::StatusCode::UNAUTHORIZED,
		),
		(
			"expired",
			Some(claims(&|c| {
				c.insert("exp".into(), (now() - 600).into());
			})),
			reqwest::StatusCode::UNAUTHORIZED,
		),
		(
			"no expiry",
			Some(claims(&|c| {
				c.remove("exp");
			})),
			reqwest::StatusCode::UNAUTHORIZED,
		),
		(
			"other client",
			Some(claims(&|c| {
				c.insert("azp".into(), "some-other-client".into());
			})),
			reqwest::StatusCode::FORBIDDEN,
		),
		(
			"no authorized party",
			Some(claims(&|c| {
				c.remove("azp");
			})),
			reqwest::StatusCode::FORBIDDEN,
		),
		("admin client", Some(admin_token()), reqwest::StatusCode::OK),
	];
	for (name, token, want) in cases {
		assert_eq!(
			admin_get(addr, "/config_dump", token.as_deref()).await,
			want,
			"case: {name}"
		);
	}

	// Shutdown is reachable only by the admin client as well.
	let resp = reqwest::Client::new()
		.post(format!("http://{addr}/quitquitquit"))
		.send()
		.await
		.unwrap();
	assert_eq!(resp.status(), reqwest::StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn usage_outbox_requires_admin_client_and_request_log_database() {
	let (addr, _drain_tx) = spawn_admin(&admin_config("")).await;
	assert_eq!(
		admin_get(addr, "/api/usage/outbox?after=0", None).await,
		reqwest::StatusCode::UNAUTHORIZED
	);
	// Without a request log database there is no durable usage: report unavailable, never empty.
	assert_eq!(
		admin_get(addr, "/api/usage/outbox?after=0", Some(&admin_token())).await,
		reqwest::StatusCode::SERVICE_UNAVAILABLE
	);
}

#[tokio::test]
async fn admin_fails_closed_when_keys_are_unavailable() {
	let cfg = admin_config(
		r#"  tracing:
    otlpEndpoint: http://localhost:4317
    headers:
      authorization: super-secret-otlp-token
      x-custom-header: visible-value
"#,
	);
	let (addr, _drain_tx) = spawn_admin(&cfg).await;

	let resp = reqwest::Client::new()
		.get(format!("http://{addr}/config_dump"))
		.bearer_auth(admin_token())
		.send()
		.await
		.expect("request should succeed");
	assert_eq!(resp.status(), reqwest::StatusCode::OK);

	let body = resp.text().await.unwrap();
	assert!(
		!body.contains("super-secret-otlp-token"),
		"config dump must not leak authorization header value: {body}"
	);
	assert!(
		body.contains("visible-value"),
		"config dump should preserve non-sensitive header values: {body}"
	);
}

#[tokio::test]
async fn trace_sse_stream_does_not_repoll_after_eof() {
	let stream = trace_sse_stream(crate::proxy::dtrace::TraceReceiver::closed_for_test());
	let mut body = crate::http::Body::from_stream(stream);

	assert!(
		body.frame().await.is_some(),
		"ready frame should be present"
	);
	assert!(body.frame().await.is_none(), "stream should report EOF");
	assert!(body.frame().await.is_none(), "stream must remain at EOF");
}
