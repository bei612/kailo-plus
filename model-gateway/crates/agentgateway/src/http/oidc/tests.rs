use std::sync::Arc;
use std::time::Duration;

use ::http::{Method, Request as HttpRequest, header};
use base64::Engine as _;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use secrecy::{ExposeSecret, SecretString};
use serde::Serialize;
use serde_json::json;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::http::jwt;
use crate::proxy::ProxyError;
use crate::serdes::FileInlineOrRemote;
use crate::test_helpers;
use crate::test_helpers::proxymock::setup_proxy_test;

const TEST_PRIVATE_KEY_PEM: &str = "-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgltxBTVDLg7C6vE1T
7OtwJIZ/dpm8ygE2MBTjPCY3hgahRANCAARYzu50EeBrT0rELmTGroaGtn0zdjxL
1lOGr9fGw5wOGcXO0+Gn5F5sIxGyTM0FwnUHFNz2SoixZR5dtxhNc+Lo
-----END PRIVATE KEY-----
";
const TEST_KEY_ID: &str = "kid-1";
const TEST_ISSUER: &str = "https://issuer.example.com";
const TEST_CLIENT_ID: &str = "client-id";
const TEST_NONCE: &str = "nonce";

#[derive(Serialize)]
struct TestIdTokenClaims<'a> {
	iss: &'a str,
	aud: &'a str,
	exp: u64,
	nonce: &'a str,
	sub: &'a str,
}

fn policy_client() -> crate::proxy::httpproxy::PolicyClient {
	let proxy = setup_proxy_test("{}").expect("proxy test harness");
	crate::proxy::httpproxy::PolicyClient::new(proxy.inputs())
}

fn test_jwks() -> JwkSet {
	serde_json::from_value(json!({
		"keys": [{
			"use": "sig",
			"kty": "EC",
			"kid": TEST_KEY_ID,
			"crv": "P-256",
			"alg": "ES256",
			"x": "WM7udBHga09KxC5kxq6GhrZ9M3Y8S9ZThq_XxsOcDhk",
			"y": "xc7T4afkXmwjEbJMzQXCdQcU3PZKiLFlHl23GE1z4ug"
		}]
	}))
	.expect("jwks json")
}

fn test_jwks_inline() -> FileInlineOrRemote {
	FileInlineOrRemote::Inline(serde_json::to_string(&test_jwks()).expect("jwks"))
}

fn test_id_token_validator() -> jwt::Jwt {
	let provider = jwt::Provider::from_jwks(
		test_jwks(),
		TEST_ISSUER.to_string(),
		Some(vec![TEST_CLIENT_ID.to_string()]),
		jwt::JWTValidationOptions::default(),
	)
	.expect("validator provider");
	jwt::Jwt::from_providers(
		vec![provider],
		jwt::Mode::Strict,
		crate::http::auth::AuthorizationLocation::bearer_header(),
		false,
	)
}

fn test_redirect_uri() -> RedirectUri {
	RedirectUri::parse("https://app.example.com/oauth/callback".into()).expect("redirect uri")
}

fn test_oidc_cookie_encoder() -> crate::http::sessionpersistence::Encoder {
	crate::http::sessionpersistence::Encoder::aes(
		"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
	)
	.expect("aes encoder")
}

fn provider_endpoint(value: impl AsRef<str>) -> ProviderEndpoint {
	value.as_ref().parse().expect("provider endpoint")
}

fn test_policy() -> OidcPolicy {
	let session = SessionConfig {
		cookie_name: "agw_oidc_s_test".into(),
		transaction_cookie_prefix: "agw_oidc_t_test".into(),
		same_site: SameSiteMode::Lax,
		secure: CookieSecureMode::Never,
		ttl: Duration::from_secs(3600),
		transaction_ttl: Duration::from_secs(300),
		encoder: test_oidc_cookie_encoder(),
	};

	OidcPolicy {
		login: None,
		logout: None,
		policy_id: PolicyId::policy("policy"),
		provider: Arc::new(Provider {
			issuer: TEST_ISSUER.into(),
			authorization_endpoint: provider_endpoint("https://issuer.example.com/authorize"),
			token_endpoint: provider_endpoint("https://issuer.example.com/token"),
			id_token_validator: test_id_token_validator(),
		}),
		client: ClientConfig {
			client_id: TEST_CLIENT_ID.into(),
			client_secret: SecretString::new("client-secret".into()),
			token_endpoint_auth: TokenEndpointAuth::ClientSecretBasic,
		},
		redirect_uri: test_redirect_uri(),
		session,
		scopes: vec!["openid".into(), "profile".into()],
		ui_locales: None,
		backchannel_logout: None,
		end_session_endpoint: None,
	}
}

fn test_callback_policy(token_endpoint: ProviderEndpoint) -> OidcPolicy {
	let mut policy = test_policy();
	policy.provider = Arc::new(Provider {
		issuer: TEST_ISSUER.into(),
		authorization_endpoint: provider_endpoint("https://issuer.example.com/authorize"),
		token_endpoint,
		id_token_validator: test_id_token_validator(),
	});
	policy
}

fn encoded_transaction(
	policy: &OidcPolicy,
	transaction_id: &str,
	csrf_state: &str,
	nonce: &str,
	original_uri: &str,
	expires_at_unix: u64,
) -> String {
	policy
		.session
		.encode_transaction(&TransactionState {
			policy_id: policy.policy_id.clone(),
			transaction_id: transaction_id.into(),
			csrf_state: csrf_state.into(),
			nonce: nonce.into(),
			pkce_verifier: SecretString::new("pkce-verifier".into()),
			original_uri: original_uri.into(),
			expires_at_unix,
		})
		.expect("encode transaction")
}

fn encoded_callback_state(transaction_id: &str, csrf_state: &str) -> String {
	super::callback::CallbackTransactionState {
		transaction_id: transaction_id.into(),
		csrf_state: csrf_state.into(),
	}
	.encode()
}

fn signed_id_token(nonce: &str) -> String {
	let mut header = Header::new(Algorithm::ES256);
	header.kid = Some(TEST_KEY_ID.into());
	jsonwebtoken::encode(
		&header,
		&TestIdTokenClaims {
			iss: TEST_ISSUER,
			aud: TEST_CLIENT_ID,
			exp: now_unix() + 600,
			nonce,
			sub: "user-1",
		},
		&EncodingKey::from_ec_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).expect("encoding key"),
	)
	.expect("signed id token")
}

fn request(method: Method, uri: &str, accept: Option<&str>) -> crate::http::Request {
	let mut builder = HttpRequest::builder().method(method).uri(uri);
	if let Some(accept) = accept {
		builder = builder.header(header::ACCEPT, accept);
	}
	builder.body(crate::http::Body::empty()).expect("request")
}

fn add_cookie(req: &mut crate::http::Request, cookie: String) {
	req
		.headers_mut()
		.append(header::COOKIE, cookie.parse().expect("cookie header"));
}

fn redirect_location(response: &crate::http::Response) -> String {
	response
		.headers()
		.get(header::LOCATION)
		.expect("location header")
		.to_str()
		.expect("location utf8")
		.to_string()
}

fn query_param(url: &str, key: &str) -> String {
	url::Url::parse(url)
		.expect("absolute url")
		.query_pairs()
		.find_map(|(k, v)| (k == key).then(|| v.into_owned()))
		.expect("query param")
}

fn parse_set_cookie(set_cookie: &str) -> cookie::Cookie<'static> {
	cookie::Cookie::parse(set_cookie.to_string())
		.expect("set-cookie")
		.into_owned()
}

fn explicit_local_oidc_config() -> LocalOidcConfig {
	LocalOidcConfig {
		issuer: TEST_ISSUER.into(),
		discovery: None,
		authorization_endpoint: Some(provider_endpoint("https://issuer.example.com/authorize")),
		token_endpoint: Some(provider_endpoint("https://issuer.example.com/token")),
		token_endpoint_auth: None,
		jwks: Some(test_jwks_inline()),
		client_id: TEST_CLIENT_ID.into(),
		client_secret: SecretString::new("client-secret".into()),
		redirect_uri: test_redirect_uri().redirect_uri,
		scopes: vec!["profile".into(), "email".into()],
		ui_locales: None,
		backchannel_logout: None,
		login: None,
		logout: None,
	}
}

fn translated_policy_id(name: &str) -> PolicyId {
	PolicyId::policy(name)
}

async fn compile_local_policy(
	config: LocalOidcConfig,
	policy_id: PolicyId,
) -> Result<OidcPolicy, Error> {
	let resources = crate::resource_manager::ResourceFetcher::direct(crate::client::Client::new(
		&crate::client::Config {
			resolver_cfg: hickory_resolver::config::ResolverConfig::default(),
			resolver_opts: hickory_resolver::config::ResolverOpts::default(),
		},
		None,
		crate::BackendConfig::default(),
		None,
	));
	config
		.compile(&resources, policy_id, &test_oidc_cookie_encoder())
		.await
}

#[test]
fn redirect_uri_rejects_ambiguous_values() {
	for raw in [
		"https://app.example.com",
		"https://app.example.com/",
		"https://app.example.com/oauth/../callback",
		"https://app.example.com/oauth/%2fcallback",
		"https://app.example.com/oauth/callback?x=1",
	] {
		assert!(RedirectUri::parse(raw.to_string()).is_err(), "{raw}");
	}
}

#[test]
fn normalize_original_uri_preserves_only_safe_local_targets() {
	let over_limit = format!("/{}", "a".repeat(2050));
	let cases = [
		("missing path", None, "/"),
		("local path", Some("/protected?x=1"), "/protected?x=1"),
		("scheme-relative path", Some("//evil.example/path"), "/"),
		(
			"percent-decoded scheme-relative path",
			Some("/%2Fevil.example/path"),
			"/",
		),
		("over limit", Some(over_limit.as_str()), "/"),
	];

	for (name, raw, expected) in cases {
		let path_and_query =
			raw.map(|raw| http::uri::PathAndQuery::try_from(raw).expect("path and query"));
		assert_eq!(
			super::session::normalize_original_uri(path_and_query.as_ref()),
			expected,
			"{name}"
		);
	}
}

#[test]
fn explicit_provider_config_rejects_relative_endpoints_during_deserialization() {
	let err = serde_json::from_value::<LocalOidcConfig>(json!({
		"issuer": TEST_ISSUER,
		"authorizationEndpoint": "/authorize",
		"tokenEndpoint": "https://issuer.example.com/token",
		"jwks": serde_json::to_string(&test_jwks()).expect("jwks"),
		"clientId": TEST_CLIENT_ID,
		"clientSecret": "client-secret",
		"redirectURI": "http://localhost:3000/oauth/callback"
	}))
	.expect_err("relative authorization endpoint should be rejected");

	assert!(err.to_string().contains("must be an absolute http(s) URL"));
}

#[tokio::test]
async fn apply_derives_claims_from_stored_id_token() {
	let policy = test_policy();
	let id_token = signed_id_token(TEST_NONCE);
	let encoded = policy
		.session
		.encode_browser_session(&BrowserSession {
			policy_id: policy.policy_id.clone(),
			raw_id_token: SecretString::new(id_token.clone().into()),
			expires_at_unix: Some(now_unix() + 300),
		})
		.expect("encode session");
	let mut req = request(
		Method::GET,
		"https://app.example.com/protected",
		Some("text/html"),
	);
	add_cookie(
		&mut req,
		format!("{}={encoded}", policy.session.cookie_name),
	);

	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.expect("browser policy apply");
	assert!(response.direct_response.is_none());
	assert!(
		!req
			.extensions()
			.get::<super::AuthenticatedSession>()
			.unwrap()
			.can_logout
	);
	let claims = req
		.extensions()
		.get::<jwt::Claims>()
		.expect("claims extension");
	assert_eq!(claims.inner.get("sub"), Some(&json!("user-1")));
	assert_eq!(claims.jwt.expose_secret(), id_token);
}

#[tokio::test]
async fn apply_redirects_unauthenticated_requests_to_login() {
	let cases = [
		(
			"http redirect uri keeps cookie non-secure",
			"http://127.0.0.1/private",
			"text/html",
			"http://127.0.0.1/oauth/callback",
			Some("redirect_uri=http%3A%2F%2F127.0.0.1%2Foauth%2Fcallback"),
			false,
		),
		(
			"https redirect uri marks cookie secure behind plain http",
			"http://127.0.0.1/private",
			"text/html",
			"https://app.example.com/oauth/callback",
			Some("redirect_uri=https%3A%2F%2Fapp.example.com%2Foauth%2Fcallback"),
			true,
		),
		(
			"json request",
			"https://app.example.com/private",
			"application/json",
			"https://app.example.com/oauth/callback",
			None,
			true,
		),
		(
			"callback path without query",
			"https://app.example.com/oauth/callback",
			"text/html",
			"https://app.example.com/oauth/callback",
			None,
			true,
		),
	];

	for (name, request_uri, accept, redirect_uri, expected_fragment, expect_secure_cookie) in cases {
		let mut policy = test_policy();
		policy.session.secure = CookieSecureMode::Auto;
		policy.redirect_uri = RedirectUri::parse(redirect_uri.to_string()).expect("redirect uri");
		let mut req = request(Method::GET, request_uri, Some(accept));

		let response = test_helpers::test_policy(&policy, &mut req)
			.await
			.expect(name);
		let response = response.direct_response.expect("redirect response");
		assert_eq!(response.status(), ::http::StatusCode::FOUND, "{name}");

		let location = response
			.headers()
			.get(header::LOCATION)
			.expect("location header")
			.to_str()
			.expect("location utf8");
		assert!(
			location.starts_with("https://issuer.example.com/authorize?"),
			"{name}"
		);
		if let Some(expected_fragment) = expected_fragment {
			assert!(location.contains(expected_fragment), "{name}");
		}
		let cookie = response
			.headers()
			.get(header::SET_COOKIE)
			.expect("set-cookie header")
			.to_str()
			.expect("set-cookie utf8");
		assert_eq!(cookie.contains("Secure"), expect_secure_cookie, "{name}");
	}
}

#[tokio::test]
async fn login_uses_only_configured_locale_projection_and_keeps_return_target() {
	for (cookie, expected) in [
		(None, "zh-CN"),
		(Some("buzz-locale=en"), "en"),
		(Some("buzz-locale=zh-CN"), "zh-CN"),
		(Some("buzz-locale=fr"), "zh-CN"),
		(Some("buzz-locale=en; buzz-locale=zh-CN"), "zh-CN"),
	] {
		let mut policy = test_policy();
		policy.ui_locales = Some(OidcUiLocales {
			default: "zh-CN".into(),
			supported: vec!["zh-CN".into(), "en".into()],
			cookie: "buzz-locale".into(),
		});
		let mut req = request(
			Method::GET,
			"https://app.example.com/app/audit?workspaceId=scope",
			Some("text/html"),
		);
		req
			.headers_mut()
			.insert(header::ACCEPT_LANGUAGE, "en-US".parse().unwrap());
		if let Some(cookie) = cookie {
			req
				.headers_mut()
				.insert(header::COOKIE, cookie.parse().unwrap());
		}
		let response = callback::start_login(&policy, &req)
			.unwrap()
			.direct_response
			.unwrap();
		let url = url::Url::parse(response.headers()[header::LOCATION].to_str().unwrap()).unwrap();
		assert_eq!(
			url.origin().ascii_serialization(),
			"https://issuer.example.com"
		);
		assert_eq!(
			url
				.query_pairs()
				.filter(|(key, _)| key == "ui_locales")
				.map(|(_, value)| value.into_owned())
				.collect::<Vec<_>>(),
			[expected]
		);
		let cookie =
			cookie::Cookie::parse(response.headers()[header::SET_COOKIE].to_str().unwrap()).unwrap();
		let transaction = policy.session.decode_transaction(cookie.value()).unwrap();
		assert_eq!(transaction.original_uri, "/app/audit?workspaceId=scope");
		assert!(!transaction.csrf_state.is_empty());
	}
}

#[tokio::test]
async fn apply_returns_unauthorized_for_fetch_requests() {
	let policy = test_policy();
	let mut req = request(Method::GET, "https://app.example.com/private", None);
	req
		.headers_mut()
		.insert("sec-fetch-mode", "cors".parse().unwrap());

	let err = test_helpers::test_policy(&policy, &mut req)
		.await
		.expect_err("fetch request should not redirect")
		.downcast();
	assert!(matches!(
		&err,
		ProxyError::OidcFailure(Error::AuthenticationRequired)
	));
	assert_eq!(
		err.into_response_with_grpc(false).status(),
		::http::StatusCode::UNAUTHORIZED
	);
}

#[tokio::test]
async fn event_source_without_fetch_metadata_never_starts_login() {
	for accept in [
		"text/event-stream",
		"text/event-stream; charset=utf-8",
		"application/json, Text/Event-Stream",
	] {
		let policy = test_policy();
		let mut req = request(Method::GET, "http://app.example.com/private", None);
		req
			.headers_mut()
			.insert(header::ACCEPT, accept.parse().unwrap());
		let err = test_helpers::test_policy(&policy, &mut req)
			.await
			.expect_err("EventSource cannot complete an interactive login")
			.downcast();
		let response = err.into_response_with_grpc(false);
		assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
		assert!(!response.headers().contains_key(header::SET_COOKIE));
		assert!(!response.headers().contains_key(header::LOCATION));
	}
	let mut policy = test_policy();
	policy.login = Some(super::OidcLogin {
		path: "/auth/start".into(),
		redirect: Some("/sign-in".into()),
	});
	let mut req = request(Method::GET, "http://app.example.com/private", None);
	req
		.headers_mut()
		.insert(header::ACCEPT, "text/event-stream".parse().unwrap());
	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.unwrap()
		.direct_response
		.unwrap();
	assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
	assert!(!response.headers().contains_key(header::SET_COOKIE));
	assert_eq!(response.headers()[header::LOCATION], "/sign-in");
	// Normal navigation and an unrelated media type retain the original login flow.
	for accept in ["text/html", "text/event-streaming"] {
		let policy = test_policy();
		let mut req = request(Method::GET, "http://app.example.com/private", None);
		req
			.headers_mut()
			.insert(header::ACCEPT, accept.parse().unwrap());
		let response = test_helpers::test_policy(&policy, &mut req)
			.await
			.unwrap()
			.direct_response
			.unwrap();
		assert_eq!(response.status(), StatusCode::FOUND);
		assert!(response.headers().contains_key(header::SET_COOKIE));
	}
}

#[tokio::test]
async fn apply_bypasses_cors_preflight_requests() {
	let policy = test_policy();
	let mut req = request(Method::OPTIONS, "https://app.example.com/private", None);
	req.headers_mut().insert(
		header::ORIGIN,
		"https://frontend.example.com".parse().unwrap(),
	);
	req.headers_mut().insert(
		header::ACCESS_CONTROL_REQUEST_METHOD,
		"GET".parse().unwrap(),
	);

	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.expect("preflight should bypass oidc");

	assert!(response.direct_response.is_none());
	assert!(response.response_headers.is_none());
	assert!(req.extensions().get::<jwt::Claims>().is_none());
}

#[tokio::test]
async fn token_endpoint_auth_modes_shape_exchange_requests() {
	#[derive(Copy, Clone)]
	enum Expectation {
		AuthorizationHeader,
		FormBodyCredentials,
	}

	let cases = [
		(
			"client_secret_basic",
			TokenEndpointAuth::ClientSecretBasic,
			"client:id",
			"s e:c",
			Expectation::AuthorizationHeader,
		),
		(
			"client_secret_post",
			TokenEndpointAuth::ClientSecretPost,
			"client-id",
			"client-secret",
			Expectation::FormBodyCredentials,
		),
	];

	for (name, token_endpoint_auth, client_id, client_secret, expectation) in cases {
		let mock = MockServer::start().await;
		Mock::given(method("POST"))
			.and(path("/token"))
			.respond_with(ResponseTemplate::new(200).set_body_json(json!({
				"id_token": signed_id_token(TEST_NONCE)
			})))
			.mount(&mock)
			.await;

		let provider = Provider {
			issuer: TEST_ISSUER.into(),
			authorization_endpoint: provider_endpoint("https://issuer.example.com/authorize"),
			token_endpoint: provider_endpoint(format!("{}/token", mock.uri())),
			id_token_validator: test_id_token_validator(),
		};
		let client_config = ClientConfig {
			client_id: client_id.into(),
			client_secret: SecretString::new(client_secret.into()),
			token_endpoint_auth,
		};

		let response = provider::exchange_code(
			policy_client(),
			&provider,
			&client_config,
			"https://app.example.com/oauth/callback",
			"code",
			&SecretString::new("verifier".into()),
		)
		.await
		.expect(name);
		assert!(response.id_token.is_some(), "{name}");

		let request = &mock.received_requests().await.expect("requests")[0];
		let body = String::from_utf8(request.body.clone()).expect("utf8 body");
		match expectation {
			Expectation::AuthorizationHeader => {
				let encoded_client_id = url::form_urlencoded::Serializer::new(String::new())
					.append_pair("", client_id)
					.finish();
				let encoded_client_secret = url::form_urlencoded::Serializer::new(String::new())
					.append_pair("", client_secret)
					.finish();
				let expected_auth = format!(
					"Basic {}",
					base64::engine::general_purpose::STANDARD.encode(format!(
						"{}:{}",
						encoded_client_id.trim_start_matches('='),
						encoded_client_secret.trim_start_matches('=')
					))
				);
				assert_eq!(
					request
						.headers
						.get("authorization")
						.expect("authorization header")
						.to_str()
						.expect("authorization header value"),
					expected_auth.as_str(),
					"{name}"
				);
				assert!(!body.contains("client_id="), "{name}");
				assert!(!body.contains("client_secret="), "{name}");
			},
			Expectation::FormBodyCredentials => {
				assert!(!request.headers.contains_key("authorization"), "{name}");
				assert!(body.contains("client_id=client-id"), "{name}");
				assert!(body.contains("client_secret=client-secret"), "{name}");
			},
		}
	}
}

#[tokio::test]
async fn token_exchange_bounds_transport_failures() {
	#[derive(Copy, Clone)]
	enum FailureMode {
		Timeout,
		OversizedBody,
	}

	let cases = [
		("timeout", FailureMode::Timeout),
		("oversized body", FailureMode::OversizedBody),
	];

	for (name, failure_mode) in cases {
		let mock = MockServer::start().await;
		let response = match failure_mode {
			FailureMode::Timeout => ResponseTemplate::new(200).set_delay(Duration::from_millis(200)),
			FailureMode::OversizedBody => {
				ResponseTemplate::new(200).set_body_string("x".repeat(70 * 1024))
			},
		};
		Mock::given(method("POST"))
			.and(path("/token"))
			.respond_with(response)
			.mount(&mock)
			.await;

		let provider = Provider {
			issuer: TEST_ISSUER.into(),
			authorization_endpoint: provider_endpoint("https://issuer.example.com/authorize"),
			token_endpoint: provider_endpoint(format!("{}/token", mock.uri())),
			id_token_validator: test_id_token_validator(),
		};
		let client_config = ClientConfig {
			client_id: TEST_CLIENT_ID.into(),
			client_secret: SecretString::new("client-secret".into()),
			token_endpoint_auth: TokenEndpointAuth::ClientSecretBasic,
		};

		let err = match failure_mode {
			FailureMode::Timeout => {
				provider::exchange_code_with_timeout(
					policy_client(),
					&provider,
					&client_config,
					"https://app.example.com/oauth/callback",
					"code",
					&SecretString::new("verifier".into()),
					Duration::from_millis(50),
				)
				.await
			},
			FailureMode::OversizedBody => {
				provider::exchange_code(
					policy_client(),
					&provider,
					&client_config,
					"https://app.example.com/oauth/callback",
					"code",
					&SecretString::new("verifier".into()),
				)
				.await
			},
		}
		.expect_err(name);
		assert!(matches!(err, Error::TokenExchangeFailed(_)), "{name}");
	}
}

#[tokio::test]
async fn callback_rejects_invalid_transaction_state() {
	let cases = [
		(
			"missing transaction",
			None,
			"tx-1",
			"test-state",
			Error::MissingTransaction,
		),
		(
			"csrf mismatch",
			Some(("expected-state", TEST_NONCE, "/protected")),
			"tx-1",
			"wrong-state",
			Error::CsrfMismatch,
		),
	];

	for (name, transaction, transaction_id, callback_csrf_state, expected_error) in cases {
		let policy = test_policy();
		let callback_state = encoded_callback_state(transaction_id, callback_csrf_state);
		let uri =
			format!("https://app.example.com/oauth/callback?code=auth-code&state={callback_state}");
		let mut req = request(Method::GET, &uri, Some("text/html"));
		if let Some((cookie_csrf_state, nonce, original_uri)) = transaction {
			let encoded = encoded_transaction(
				&policy,
				transaction_id,
				cookie_csrf_state,
				nonce,
				original_uri,
				now_unix() + 300,
			);
			add_cookie(
				&mut req,
				format!(
					"{}={encoded}",
					policy.session.transaction_cookie_name(transaction_id)
				),
			);
		}

		let err = test_helpers::test_policy(&policy, &mut req)
			.await
			.expect_err(name)
			.downcast();
		match expected_error {
			Error::MissingTransaction => assert!(
				matches!(err, ProxyError::OidcFailure(Error::MissingTransaction)),
				"{name}"
			),
			Error::CsrfMismatch => assert!(
				matches!(err, ProxyError::OidcFailure(Error::CsrfMismatch)),
				"{name}"
			),
			_ => unreachable!("unexpected test error"),
		}
	}
}

#[tokio::test]
async fn callback_success_sets_session_cookie_and_clears_transaction_cookie() {
	let mock = MockServer::start().await;
	let id_token = signed_id_token(TEST_NONCE);
	Mock::given(method("POST"))
		.and(path("/token"))
		.respond_with(ResponseTemplate::new(200).set_body_json(json!({
			"id_token": id_token
		})))
		.mount(&mock)
		.await;

	let policy = test_callback_policy(provider_endpoint(format!("{}/token", mock.uri())));
	let mut policy = policy;
	policy.session.secure = CookieSecureMode::Auto;
	let transaction_id = "tx-1";
	let callback_state = encoded_callback_state(transaction_id, "test-state");
	let encoded = encoded_transaction(
		&policy,
		transaction_id,
		"test-state",
		TEST_NONCE,
		"/protected",
		now_unix() + 300,
	);
	let uri = format!("http://127.0.0.1/oauth/callback?code=auth-code&state={callback_state}");
	let mut req = request(Method::GET, &uri, Some("text/html"));
	add_cookie(
		&mut req,
		format!(
			"{}={encoded}",
			policy.session.transaction_cookie_name(transaction_id)
		),
	);

	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.expect("callback apply");
	let response = response.direct_response.expect("redirect response");
	assert_eq!(response.status(), ::http::StatusCode::FOUND);
	assert_eq!(
		response.headers().get(header::LOCATION).unwrap(),
		"/protected"
	);
	let cookies: Vec<_> = response
		.headers()
		.get_all(header::SET_COOKIE)
		.iter()
		.map(|h| h.to_str().unwrap().to_string())
		.collect();
	assert!(
		cookies
			.iter()
			.any(|cookie| cookie.starts_with(&policy.session.cookie_name))
	);
	assert!(cookies.iter().all(|cookie| cookie.contains("Secure")));
	assert!(cookies.iter().any(|cookie| {
		cookie.starts_with(&policy.session.transaction_cookie_name(transaction_id))
			&& cookie.contains("Max-Age=0")
	}));
}

#[tokio::test]
async fn concurrent_login_attempts_use_distinct_transaction_cookies() {
	let mock = MockServer::start().await;
	let policy = test_callback_policy(provider_endpoint(format!("{}/token", mock.uri())));

	let mut first_req = request(
		Method::GET,
		"https://app.example.com/protected",
		Some("text/html"),
	);
	let first_response = test_helpers::test_policy(&policy, &mut first_req)
		.await
		.expect("first login start")
		.direct_response
		.expect("first redirect");
	let first_location = redirect_location(&first_response);
	let first_state = query_param(&first_location, "state");
	let first_cookie = parse_set_cookie(
		first_response
			.headers()
			.get(header::SET_COOKIE)
			.expect("first set-cookie")
			.to_str()
			.expect("first set-cookie utf8"),
	);
	let first_transaction = policy
		.session
		.decode_transaction(first_cookie.value())
		.expect("decode first transaction");

	let mut second_req = request(
		Method::GET,
		"https://app.example.com/protected",
		Some("text/html"),
	);

	let second_response = test_helpers::test_policy(&policy, &mut second_req)
		.await
		.expect("second login start")
		.direct_response
		.expect("second redirect");
	let second_cookie = parse_set_cookie(
		second_response
			.headers()
			.get(header::SET_COOKIE)
			.expect("second set-cookie")
			.to_str()
			.expect("second set-cookie utf8"),
	);

	Mock::given(method("POST"))
		.and(path("/token"))
		.respond_with(ResponseTemplate::new(200).set_body_json(json!({
			"id_token": signed_id_token(&first_transaction.nonce)
		})))
		.mount(&mock)
		.await;

	assert_ne!(first_cookie.name(), second_cookie.name());
	assert!(
		first_cookie
			.name()
			.starts_with(&policy.session.transaction_cookie_prefix)
	);
	assert!(
		second_cookie
			.name()
			.starts_with(&policy.session.transaction_cookie_prefix)
	);

	let mut callback_req = request(
		Method::GET,
		&format!("https://app.example.com/oauth/callback?code=auth-code&state={first_state}"),
		Some("text/html"),
	);
	add_cookie(
		&mut callback_req,
		format!("{}={}", first_cookie.name(), first_cookie.value()),
	);
	add_cookie(
		&mut callback_req,
		format!("{}={}", second_cookie.name(), second_cookie.value()),
	);

	let callback_response = test_helpers::test_policy(&policy, &mut callback_req)
		.await
		.expect("first callback succeeds")
		.direct_response
		.expect("callback redirect");
	let set_cookies: Vec<_> = callback_response
		.headers()
		.get_all(header::SET_COOKIE)
		.iter()
		.map(|value| value.to_str().expect("set-cookie utf8").to_string())
		.collect();
	assert!(
		set_cookies
			.iter()
			.any(|cookie| cookie.starts_with(first_cookie.name()) && cookie.contains("Max-Age=0"))
	);
	assert!(
		!set_cookies
			.iter()
			.any(|cookie| cookie.starts_with(second_cookie.name()) && cookie.contains("Max-Age=0"))
	);
}

#[tokio::test]
async fn callback_matching_uses_path_not_redirect_host_or_port() {
	let mock = MockServer::start().await;
	let id_token = signed_id_token(TEST_NONCE);
	Mock::given(method("POST"))
		.and(path("/token"))
		.respond_with(ResponseTemplate::new(200).set_body_json(json!({
			"id_token": id_token
		})))
		.mount(&mock)
		.await;

	let policy = test_callback_policy(provider_endpoint(format!("{}/token", mock.uri())));
	let transaction_id = "tx-1";
	let callback_state = encoded_callback_state(transaction_id, "test-state");
	let encoded = encoded_transaction(
		&policy,
		transaction_id,
		"test-state",
		TEST_NONCE,
		"/protected",
		now_unix() + 300,
	);
	let uri =
		format!("https://edge.example.net:8443/oauth/callback?code=auth-code&state={callback_state}");
	let mut req = request(Method::GET, &uri, Some("text/html"));
	add_cookie(
		&mut req,
		format!(
			"{}={encoded}",
			policy.session.transaction_cookie_name(transaction_id)
		),
	);

	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.expect("callback apply");
	assert_eq!(
		response
			.direct_response
			.unwrap()
			.headers()
			.get(header::LOCATION)
			.unwrap(),
		"/protected"
	);
}

#[tokio::test]
async fn local_oidc_config_compiles_supported_provider_sources() {
	let mock = MockServer::start().await;
	Mock::given(method("GET"))
		.and(path("/.well-known/openid-configuration"))
		.respond_with(ResponseTemplate::new(200).set_body_json(json!({
			"issuer": mock.uri(),
			"authorization_endpoint": format!("{}/authorize", mock.uri()),
			"token_endpoint": format!("{}/token", mock.uri()),
			"jwks_uri": format!("{}/jwks", mock.uri()),
			"token_endpoint_auth_methods_supported": ["client_secret_post"]
		})))
		.mount(&mock)
		.await;
	Mock::given(method("GET"))
		.and(path("/jwks"))
		.respond_with(ResponseTemplate::new(200).set_body_json(test_jwks()))
		.mount(&mock)
		.await;

	let cases = [
		(
			"discovery",
			LocalOidcConfig {
				issuer: mock.uri(),
				discovery: None,
				authorization_endpoint: None,
				token_endpoint: None,
				token_endpoint_auth: None,
				jwks: None,
				client_id: TEST_CLIENT_ID.into(),
				client_secret: SecretString::new("client-secret".into()),
				redirect_uri: "http://localhost:3000/oauth/callback".into(),
				scopes: vec![],
				ui_locales: None,
				backchannel_logout: None,
				login: None,
				logout: None,
			},
			provider_endpoint(format!("{}/authorize", mock.uri())),
			provider_endpoint(format!("{}/token", mock.uri())),
			TokenEndpointAuth::ClientSecretPost,
		),
		(
			"explicit",
			explicit_local_oidc_config(),
			provider_endpoint("https://issuer.example.com/authorize"),
			provider_endpoint("https://issuer.example.com/token"),
			TokenEndpointAuth::ClientSecretBasic,
		),
		(
			"explicit post",
			LocalOidcConfig {
				token_endpoint_auth: Some(TokenEndpointAuth::ClientSecretPost),
				..explicit_local_oidc_config()
			},
			provider_endpoint("https://issuer.example.com/authorize"),
			provider_endpoint("https://issuer.example.com/token"),
			TokenEndpointAuth::ClientSecretPost,
		),
	];

	for (
		name,
		config,
		expected_authorization_endpoint,
		expected_token_endpoint,
		expected_token_endpoint_auth,
	) in cases
	{
		let policy = compile_local_policy(config, translated_policy_id(name))
			.await
			.expect(name);

		assert_eq!(
			policy.provider.authorization_endpoint, expected_authorization_endpoint,
			"{name}"
		);
		assert_eq!(
			policy.provider.token_endpoint, expected_token_endpoint,
			"{name}"
		);
		assert_eq!(
			policy.client.token_endpoint_auth, expected_token_endpoint_auth,
			"{name}"
		);
	}
}

#[tokio::test]
async fn discovery_rejects_relative_provider_endpoints() {
	let mock = MockServer::start().await;
	Mock::given(method("GET"))
		.and(path("/.well-known/openid-configuration"))
		.respond_with(ResponseTemplate::new(200).set_body_json(json!({
			"issuer": mock.uri(),
			"authorization_endpoint": "/authorize",
			"token_endpoint": format!("{}/token", mock.uri()),
			"jwks_uri": format!("{}/jwks", mock.uri()),
			"token_endpoint_auth_methods_supported": ["client_secret_post"]
		})))
		.mount(&mock)
		.await;

	let policy = LocalOidcConfig {
		issuer: mock.uri(),
		discovery: None,
		authorization_endpoint: None,
		token_endpoint: None,
		token_endpoint_auth: None,
		jwks: None,
		client_id: TEST_CLIENT_ID.into(),
		client_secret: SecretString::new("client-secret".into()),
		redirect_uri: "http://localhost:3000/oauth/callback".into(),
		scopes: vec![],
		ui_locales: None,
		backchannel_logout: None,
		login: None,
		logout: None,
	};
	let err = compile_local_policy(policy, translated_policy_id("discovery-relative-endpoints"))
		.await
		.expect_err("relative discovery endpoint should fail");

	assert!(err.to_string().contains("invalid authorization endpoint"));
}

#[tokio::test]
async fn local_oidc_config_rejects_invalid_configuration() {
	let cases = [
		(
			"login redirect overlaps logout",
			LocalOidcConfig {
				login: Some(super::OidcLogin {
					path: "/auth/start".into(),
					redirect: Some("/auth/end?next=home".into()),
				}),
				logout: Some(super::OidcLogout {
					path: "/auth/end".into(),
					redirect: None,
					end_session: false,
				}),
				..explicit_local_oidc_config()
			},
			"login.redirect must differ",
		),
		(
			"external login redirect",
			LocalOidcConfig {
				login: Some(super::OidcLogin {
					path: "/auth/start".into(),
					redirect: Some("//evil.example".into()),
				}),
				..explicit_local_oidc_config()
			},
			"login.redirect must be a safe local path",
		),
		(
			"overlapping endpoints",
			LocalOidcConfig {
				login: Some(super::OidcLogin {
					path: "/auth".into(),
					redirect: None,
				}),
				logout: Some(super::OidcLogout {
					path: "/auth".into(),
					redirect: None,
					end_session: false,
				}),
				..explicit_local_oidc_config()
			},
			"logout.path must be a distinct local path",
		),
		(
			"partial explicit",
			LocalOidcConfig {
				issuer: TEST_ISSUER.into(),
				discovery: None,
				authorization_endpoint: None,
				token_endpoint: Some(provider_endpoint("https://issuer.example.com/token")),
				token_endpoint_auth: None,
				jwks: Some(test_jwks_inline()),
				client_id: TEST_CLIENT_ID.into(),
				client_secret: SecretString::new("client-secret".into()),
				redirect_uri: "http://localhost:3000/oauth/callback".into(),
				scopes: vec![],
				ui_locales: None,
				backchannel_logout: None,
				login: None,
				logout: None,
			},
			"authorizationEndpoint, tokenEndpoint, and jwks must either all be set or all be omitted",
		),
		(
			"explicit with discovery override",
			LocalOidcConfig {
				discovery: Some(FileInlineOrRemote::Remote {
					url: "https://example.invalid/should-not-be-called"
						.parse()
						.expect("discovery override url"),
				}),
				..explicit_local_oidc_config()
			},
			"oidc discovery must be omitted when authorizationEndpoint, tokenEndpoint, and jwks are configured explicitly",
		),
		(
			"token endpoint auth without explicit provider",
			LocalOidcConfig {
				issuer: TEST_ISSUER.into(),
				discovery: None,
				authorization_endpoint: None,
				token_endpoint: None,
				token_endpoint_auth: Some(TokenEndpointAuth::ClientSecretPost),
				jwks: None,
				client_id: TEST_CLIENT_ID.into(),
				client_secret: SecretString::new("client-secret".into()),
				redirect_uri: "http://localhost:3000/oauth/callback".into(),
				scopes: vec![],
				ui_locales: None,
				backchannel_logout: None,
				login: None,
				logout: None,
			},
			"tokenEndpointAuth must be omitted unless authorizationEndpoint, tokenEndpoint, and jwks are configured explicitly",
		),
	];

	for (name, config, expected_error_fragment) in cases {
		let err = compile_local_policy(config, translated_policy_id(name))
			.await
			.expect_err(name);
		assert!(err.to_string().contains(expected_error_fragment), "{name}");
	}
}

#[tokio::test]
async fn browser_login_and_logout_flow() {
	let mut policy = test_policy();
	policy.login = Some(super::OidcLogin {
		path: "/auth/start".into(),
		redirect: Some("/sign-in".into()),
	});
	policy.logout = Some(super::OidcLogout {
		path: "/auth/end".into(),
		redirect: Some("/signed-out".into()),
		end_session: false,
	});
	let mut req = request(
		Method::GET,
		"https://app.example.com/ui/llm/models?tab=all",
		None,
	);
	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.unwrap()
		.direct_response
		.unwrap();
	assert_eq!(
		response.headers()[header::LOCATION],
		"/sign-in?returnTo=%2Fui%2Fllm%2Fmodels%3Ftab%3Dall"
	);
	assert!(!response.headers().contains_key(header::SET_COOKIE));

	let mut req = request(Method::GET, "https://app.example.com/api/config", None);
	req
		.headers_mut()
		.insert("sec-fetch-mode", "cors".parse().unwrap());
	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.unwrap()
		.direct_response
		.unwrap();
	assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
	assert_eq!(response.headers()[header::LOCATION], "/sign-in");

	// A login page left behind the policy starts OAuth rather than redirecting to itself.
	for path in ["/sign-in", "/sign-in?returnTo=%2Fapp"] {
		let mut req = request(Method::GET, &format!("https://app.example.com{path}"), None);
		let response = test_helpers::test_policy(&policy, &mut req)
			.await
			.unwrap()
			.direct_response
			.unwrap();
		assert!(
			response.headers()[header::LOCATION]
				.to_str()
				.unwrap()
				.starts_with("https://issuer.example.com/authorize?")
		);
	}

	for (target, expected) in [
		("%2Fui%2Fllm%2Fmodels%3Ftab%3Dall", "/ui/llm/models?tab=all"),
		("https%3A%2F%2Fevil.example", "/"),
		("%2F%2Fevil.example", "/"),
		("%2Fauth%2Fend", "/"),
	] {
		let mut req = request(
			Method::GET,
			&format!("https://app.example.com/auth/start?returnTo={target}"),
			None,
		);
		let response = test_helpers::test_policy(&policy, &mut req)
			.await
			.unwrap()
			.direct_response
			.unwrap();
		assert!(
			response.headers()[header::LOCATION]
				.to_str()
				.unwrap()
				.starts_with("https://issuer.example.com/authorize?")
		);
		let cookie = response.headers()[header::SET_COOKIE]
			.to_str()
			.unwrap()
			.split(';')
			.next()
			.unwrap();
		let (_, value) = cookie.split_once('=').unwrap();
		let transaction = policy.session.decode_transaction(value).unwrap();
		assert_eq!(transaction.original_uri, expected);
	}

	for (method, origin, expected) in [
		(
			Method::GET,
			Some("https://app.example.com"),
			StatusCode::METHOD_NOT_ALLOWED,
		),
		(Method::POST, None, StatusCode::FORBIDDEN),
		(
			Method::POST,
			Some("https://evil.example"),
			StatusCode::FORBIDDEN,
		),
		(
			Method::POST,
			Some("https://app.example.com"),
			StatusCode::SEE_OTHER,
		),
	] {
		let mut req = request(method, "https://app.example.com/auth/end", None);
		if let Some(origin) = origin {
			req
				.headers_mut()
				.insert(header::ORIGIN, origin.parse().unwrap());
		}
		let result = test_helpers::test_policy(&policy, &mut req).await;
		let response = if expected == StatusCode::SEE_OTHER {
			result.unwrap().direct_response.unwrap()
		} else {
			let error = result
				.expect_err("logout rejection must be a proxy error")
				.downcast();
			if expected == StatusCode::FORBIDDEN {
				assert!(matches!(&error, ProxyError::CsrfValidationFailed));
			} else {
				assert!(matches!(&error, ProxyError::MethodNotAllowed));
			}
			error.into_response_with_grpc(false)
		};
		assert_eq!(response.status(), expected);
		if expected == StatusCode::SEE_OTHER {
			assert_eq!(response.headers()[header::LOCATION], "/signed-out");
			let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
			assert!(cookie.starts_with(&format!("{}=;", policy.session.cookie_name)));
			assert!(cookie.contains("Max-Age=0"));
			assert!(cookie.contains("HttpOnly"));
		} else {
			assert!(!response.headers().contains_key(header::SET_COOKIE));
		}
	}
	// Logout works without a custom login flow, and its redirect has useful defaults.
	policy.logout.as_mut().unwrap().redirect = None;
	for (login_redirect, expected) in [(Some("/sign-in"), "/sign-in"), (None, "/")] {
		policy.login = login_redirect.map(|redirect| super::OidcLogin {
			path: "/auth/start".into(),
			redirect: Some(redirect.into()),
		});
		let mut req = request(Method::POST, "https://app.example.com/auth/end", None);
		req
			.headers_mut()
			.insert(header::ORIGIN, "https://app.example.com".parse().unwrap());
		let response = test_helpers::test_policy(&policy, &mut req)
			.await
			.unwrap()
			.direct_response
			.unwrap();
		assert_eq!(response.status(), StatusCode::SEE_OTHER);
		assert_eq!(response.headers()[header::LOCATION], expected);
	}
}

/// Kailo SS-AGW-END-SESSION: RP-Initiated Logout on the gateway's own logout path.
#[tokio::test]
async fn logout_ends_the_provider_session_only_for_a_decodable_session() {
	let mut policy = test_policy();
	policy.logout = Some(super::OidcLogout {
		path: "/logout".into(),
		redirect: Some("/app/".into()),
		end_session: true,
	});
	policy.end_session_endpoint = Some(provider_endpoint(
		"https://issuer.example.com/protocol/openid-connect/logout",
	));
	let id_token = signed_id_token(TEST_NONCE);
	let session = policy.session.clone();
	let cookie_name = policy.session.cookie_name.clone();
	let session_cookie = |policy_id: PolicyId| {
		session
			.encode_browser_session(&BrowserSession {
				policy_id,
				raw_id_token: SecretString::new(id_token.clone().into()),
				expires_at_unix: Some(now_unix() + 300),
			})
			.expect("encode session")
	};
	let logout = |cookie: Option<String>| {
		let mut req = request(Method::POST, "https://app.example.com/logout", None);
		req
			.headers_mut()
			.insert(header::ORIGIN, "https://app.example.com".parse().unwrap());
		if let Some(cookie) = cookie {
			add_cookie(&mut req, format!("{cookie_name}={cookie}"));
		}
		req
	};

	let mut req = logout(Some(session_cookie(policy.policy_id.clone())));
	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.unwrap()
		.direct_response
		.unwrap();
	assert_eq!(response.status(), StatusCode::SEE_OTHER);
	assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
	let location = redirect_location(&response);
	assert!(location.starts_with("https://issuer.example.com/protocol/openid-connect/logout?"));
	assert_eq!(query_param(&location, "id_token_hint"), id_token);
	assert_eq!(query_param(&location, "client_id"), TEST_CLIENT_ID);
	assert_eq!(
		query_param(&location, "post_logout_redirect_uri"),
		"https://app.example.com/app/"
	);
	// Local cookies are cleared exactly as before.
	let cookie = response.headers()[header::SET_COOKIE].to_str().unwrap();
	assert!(cookie.starts_with(&format!("{}=;", policy.session.cookie_name)));
	assert!(cookie.contains("Max-Age=0"));

	// No session, a forged cookie or another policy's session keep the local destination.
	for cookie in [
		None,
		Some("forged".to_string()),
		Some(session_cookie(PolicyId::policy("other"))),
	] {
		let mut req = logout(cookie);
		let response = test_helpers::test_policy(&policy, &mut req)
			.await
			.unwrap()
			.direct_response
			.unwrap();
		assert_eq!(response.status(), StatusCode::SEE_OTHER);
		assert_eq!(redirect_location(&response), "/app/");
	}

	// The CSRF and method checks still run before anything else.
	let mut req = request(Method::POST, "https://app.example.com/logout", None);
	add_cookie(
		&mut req,
		format!(
			"{}={}",
			policy.session.cookie_name,
			session_cookie(policy.policy_id.clone())
		),
	);
	let error = test_helpers::test_policy(&policy, &mut req)
		.await
		.expect_err("cross-origin logout must be rejected")
		.downcast();
	assert!(matches!(&error, ProxyError::CsrfValidationFailed));

	// Without endSession the provider session is left alone.
	policy.end_session_endpoint = None;
	let mut req = logout(Some(session_cookie(policy.policy_id.clone())));
	let response = test_helpers::test_policy(&policy, &mut req)
		.await
		.unwrap()
		.direct_response
		.unwrap();
	assert_eq!(redirect_location(&response), "/app/");
}

#[tokio::test]
async fn end_session_requires_a_discovered_end_session_endpoint() {
	let mock = MockServer::start().await;
	Mock::given(method("GET"))
		.and(path("/.well-known/openid-configuration"))
		.respond_with(ResponseTemplate::new(200).set_body_json(json!({
			"issuer": mock.uri(),
			"authorization_endpoint": format!("{}/authorize", mock.uri()),
			"token_endpoint": format!("{}/token", mock.uri()),
			"jwks_uri": format!("{}/jwks", mock.uri()),
			"end_session_endpoint": format!("{}/logout", mock.uri())
		})))
		.mount(&mock)
		.await;
	Mock::given(method("GET"))
		.and(path("/jwks"))
		.respond_with(ResponseTemplate::new(200).set_body_json(test_jwks()))
		.mount(&mock)
		.await;
	let logout = |end_session| {
		Some(super::OidcLogout {
			path: "/logout".into(),
			redirect: Some("/app/".into()),
			end_session,
		})
	};
	let discovered = |end_session| LocalOidcConfig {
		issuer: mock.uri(),
		discovery: None,
		authorization_endpoint: None,
		token_endpoint: None,
		token_endpoint_auth: None,
		jwks: None,
		client_id: TEST_CLIENT_ID.into(),
		client_secret: SecretString::new("client-secret".into()),
		redirect_uri: "http://localhost:3000/oauth/callback".into(),
		scopes: vec![],
		ui_locales: None,
		backchannel_logout: None,
		login: None,
		logout: logout(end_session),
	};

	let policy = compile_local_policy(discovered(true), translated_policy_id("end-session"))
		.await
		.expect("discovered end session endpoint");
	assert_eq!(
		policy.end_session_endpoint,
		Some(provider_endpoint(format!("{}/logout", mock.uri())))
	);
	let policy = compile_local_policy(discovered(false), translated_policy_id("local-only"))
		.await
		.expect("local logout");
	assert!(policy.end_session_endpoint.is_none());

	let err = compile_local_policy(
		LocalOidcConfig {
			logout: logout(true),
			..explicit_local_oidc_config()
		},
		translated_policy_id("explicit"),
	)
	.await
	.expect_err("explicit provider has no end session endpoint");
	assert!(err.to_string().contains("logout.endSession requires"));
}

// Kailo DD-133(6) (`.design/07` §4.7.5): OIDC Back-Channel Logout receiver.
mod backchannel_logout {
	use super::*;

	const RECEIVER: &str = "https://app.example.com/oauth/backchannel-logout";

	fn sign(claims: serde_json::Value) -> String {
		let mut header = Header::new(Algorithm::ES256);
		header.kid = Some(TEST_KEY_ID.into());
		jsonwebtoken::encode(
			&header,
			&claims,
			&EncodingKey::from_ec_pem(TEST_PRIVATE_KEY_PEM.as_bytes()).expect("encoding key"),
		)
		.expect("signed token")
	}

	fn logout_token(changes: serde_json::Value) -> String {
		let mut claims = json!({
			"iss": TEST_ISSUER,
			"aud": TEST_CLIENT_ID,
			"iat": now_unix(),
			"jti": uuid::Uuid::new_v4().to_string(),
			"sid": "sid-1",
			"sub": "user-1",
			"events": { "http://schemas.openid.net/event/backchannel-logout": {} },
		});
		for (key, value) in changes.as_object().expect("object") {
			if value.is_null() {
				claims.as_object_mut().unwrap().remove(key);
			} else {
				claims[key] = value.clone();
			}
		}
		sign(claims)
	}

	fn receiving_policy() -> OidcPolicy {
		let mut policy = test_policy();
		let provider = jwt::Provider::from_jwks(
			test_jwks(),
			TEST_ISSUER.to_string(),
			Some(vec![TEST_CLIENT_ID.to_string()]),
			jwt::JWTValidationOptions {
				required_claims: Default::default(),
			},
		)
		.expect("logout validator");
		policy.backchannel_logout = Some(BackchannelLogout::new(
			"/oauth/backchannel-logout".into(),
			jwt::Jwt::from_providers(
				vec![provider],
				jwt::Mode::Strict,
				crate::http::auth::AuthorizationLocation::bearer_header(),
				false,
			),
			Duration::from_secs(3600),
		));
		policy
	}

	async fn deliver(policy: &OidcPolicy, body: String, content_type: &str) -> u16 {
		let mut req = HttpRequest::builder()
			.method(Method::POST)
			.uri(RECEIVER)
			.header(header::CONTENT_TYPE, content_type)
			.body(crate::http::Body::from(body))
			.expect("request");
		let response = test_helpers::test_policy(policy, &mut req)
			.await
			.expect("policy apply")
			.direct_response
			.expect("receiver answers directly");
		assert_eq!(
			response.headers().get(header::CACHE_CONTROL).unwrap(),
			"no-store"
		);
		response.status().as_u16()
	}

	async fn form(policy: &OidcPolicy, token: String) -> u16 {
		deliver(
			policy,
			format!("logout_token={token}"),
			"application/x-www-form-urlencoded",
		)
		.await
	}

	/// Whether a browser session holding this ID token is still a session.
	async fn session_alive(policy: &OidcPolicy, sid: &str, sub: &str, iat: u64) -> bool {
		let id_token = sign(json!({
			"iss": TEST_ISSUER,
			"aud": TEST_CLIENT_ID,
			"exp": now_unix() + 600,
			"iat": iat,
			"nonce": TEST_NONCE,
			"sid": sid,
			"sub": sub,
		}));
		let encoded = policy
			.session
			.encode_browser_session(&BrowserSession {
				policy_id: policy.policy_id.clone(),
				raw_id_token: SecretString::new(id_token.into()),
				expires_at_unix: Some(now_unix() + 300),
			})
			.expect("encode session");
		let mut req = request(
			Method::GET,
			"https://app.example.com/protected",
			Some("text/html"),
		);
		add_cookie(
			&mut req,
			format!("{}={encoded}", policy.session.cookie_name),
		);
		let response = test_helpers::test_policy(policy, &mut req)
			.await
			.expect("browser policy apply");
		response.direct_response.is_none()
	}

	#[tokio::test]
	async fn a_valid_logout_token_ends_that_sid_only() {
		let policy = receiving_policy();
		let now = now_unix();
		assert!(session_alive(&policy, "sid-1", "user-1", now - 5).await);
		assert_eq!(form(&policy, logout_token(json!({}))).await, 200);
		assert!(!session_alive(&policy, "sid-1", "user-1", now - 5).await);
		assert!(session_alive(&policy, "sid-2", "user-2", now - 5).await);
	}

	#[tokio::test]
	async fn without_sid_every_earlier_session_of_the_subject_ends() {
		let policy = receiving_policy();
		let now = now_unix();
		assert_eq!(
			form(&policy, logout_token(json!({ "sid": null }))).await,
			200
		);
		assert!(!session_alive(&policy, "sid-a", "user-1", now - 30).await);
		assert!(!session_alive(&policy, "sid-b", "user-1", now).await);
		// A later login of the same person is a new session.
		assert!(session_alive(&policy, "sid-c", "user-1", now + 5).await);
		assert!(session_alive(&policy, "sid-d", "user-2", now - 30).await);
	}

	#[tokio::test]
	async fn invalid_tokens_are_rejected_and_end_nothing() {
		let policy = receiving_policy();
		let now = now_unix();
		let mut other_key = Header::new(Algorithm::HS256);
		other_key.kid = Some(TEST_KEY_ID.into());
		let symmetric = jsonwebtoken::encode(
			&other_key,
			&json!({ "iss": TEST_ISSUER, "aud": TEST_CLIENT_ID, "iat": now, "jti": "x", "sid": "sid-1",
				"events": { "http://schemas.openid.net/event/backchannel-logout": {} } }),
			&EncodingKey::from_secret(b"shared"),
		)
		.expect("hs256");
		for token in [
			symmetric,
			logout_token(json!({ "aud": "another-client" })),
			logout_token(json!({ "iss": "https://other.example.com" })),
			logout_token(json!({ "nonce": "n" })),
			logout_token(json!({ "events": null })),
			logout_token(json!({ "events": { "other": {} } })),
			logout_token(json!({ "jti": null })),
			logout_token(json!({ "sid": null, "sub": null })),
			logout_token(json!({ "iat": now - 3600 })),
			logout_token(json!({ "iat": now + 3600 })),
			"not-a-jwt".to_string(),
		] {
			assert_eq!(form(&policy, token).await, 400);
		}
		assert_eq!(
			deliver(
				&policy,
				format!("logout_token={}", logout_token(json!({}))),
				"application/json"
			)
			.await,
			400
		);
		assert_eq!(
			deliver(
				&policy,
				"other=1".into(),
				"application/x-www-form-urlencoded"
			)
			.await,
			400
		);
		assert!(session_alive(&policy, "sid-1", "user-1", now - 5).await);
	}

	#[tokio::test]
	async fn a_replayed_token_is_rejected_and_the_logout_stays_in_force() {
		let policy = receiving_policy();
		let token = logout_token(json!({}));
		assert_eq!(form(&policy, token.clone()).await, 200);
		assert_eq!(form(&policy, token).await, 400);
		assert!(!session_alive(&policy, "sid-1", "user-1", now_unix() - 5).await);
	}

	#[tokio::test]
	async fn only_form_posts_are_accepted() {
		let policy = receiving_policy();
		let mut req = request(Method::GET, RECEIVER, None);
		let response = test_helpers::test_policy(&policy, &mut req)
			.await
			.expect("policy apply")
			.direct_response
			.expect("receiver answers directly");
		assert_eq!(response.status().as_u16(), 405);
	}

	#[tokio::test]
	async fn the_receiver_path_must_be_distinct() {
		let err = compile_local_policy(
			LocalOidcConfig {
				logout: Some(OidcLogout {
					path: "/oauth/backchannel-logout".into(),
					redirect: None,
					end_session: false,
				}),
				backchannel_logout: Some(OidcBackchannelLogout {
					path: "/oauth/backchannel-logout".into(),
				}),
				..explicit_local_oidc_config()
			},
			translated_policy_id("backchannel"),
		)
		.await
		.expect_err("overlapping receiver");
		assert!(err.to_string().contains("backchannelLogout.path"));
	}
}
