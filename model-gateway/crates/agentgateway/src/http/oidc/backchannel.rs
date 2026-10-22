//! OIDC Back-Channel Logout receiver (Kailo DD-133(6), `.design/07` §4.7.5).
//!
//! The browser session of this policy is a stateless encrypted cookie that
//! carries the raw ID token. A back-channel `logout_token` from the IdP is
//! therefore recorded as a revocation of its `sid` (or, without `sid`, of its
//! `iss`+`sub` up to the token's issue time); every later request whose
//! session ID token matches is treated as having no session and goes through
//! login again. Revocations are kept for the longest possible session
//! lifetime (the session TTL), so they cannot outlive the sessions they end.
//! They are process memory: a Gateway restart forgets them, which is bounded
//! by the same TTL and by the ID token expiry checked on every request.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use ::http::{Method, StatusCode, header};
use serde_json::{Map, Value};
use tracing::{info, warn};

use super::{now_unix, OidcPolicy};
use crate::http::{Body, PolicyResponse, Request, jwt};
use crate::{apply, schema};

/// OpenID Connect Back-Channel Logout 1.0 event key.
const LOGOUT_EVENT: &str = "http://schemas.openid.net/event/backchannel-logout";
/// Largest accepted form body; a logout token is a few hundred bytes.
const MAX_BODY: usize = 16 * 1024;
/// Accepted clock skew for a token issued "in the future".
const FUTURE_SKEW_SECS: u64 = 60;
/// A logout token older than this is rejected as stale.
const MAX_TOKEN_AGE_SECS: u64 = 10 * 60;

/// Optional back-channel logout endpoint of this policy.
#[apply(schema!)]
pub struct OidcBackchannelLogout {
	/// Local path that receives the IdP's `logout_token`, for example
	/// `/oauth/backchannel-logout`. Register `<callback origin><path>` as the
	/// client's back-channel logout URL with session required. Only form POSTs
	/// carrying a valid signed `logout_token` (audience = this client) end
	/// sessions; nothing is forwarded to the backend.
	pub path: String,
}

#[derive(Debug, Default)]
struct Revocations {
	/// sid -> (revoked at, forget after)
	sids: HashMap<String, (u64, u64)>,
	/// sub -> (sessions issued at or before this time are ended, forget after)
	subs: HashMap<String, (u64, u64)>,
	/// jti -> forget after
	jtis: HashMap<String, u64>,
}

impl Revocations {
	fn prune(&mut self, now: u64) {
		self.sids.retain(|_, (_, until)| *until > now);
		self.subs.retain(|_, (_, until)| *until > now);
		self.jtis.retain(|_, until| *until > now);
	}
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackchannelLogout {
	pub path: String,
	#[serde(skip)]
	validator: jwt::Jwt,
	#[serde(skip)]
	keep: Duration,
	#[serde(skip)]
	revocations: Arc<Mutex<Revocations>>,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Rejection {
	Invalid,
	Replayed,
}

impl BackchannelLogout {
	pub(super) fn new(path: String, validator: jwt::Jwt, keep: Duration) -> Self {
		Self {
			path,
			validator,
			keep,
			revocations: Default::default(),
		}
	}

	/// Validate a `logout_token` and record the revocation it carries.
	/// Returns the token's `sid` and `sub` for the (digested) log line.
	pub(super) fn accept(
		&self,
		token: &str,
		now: u64,
	) -> Result<(Option<String>, Option<String>), Rejection> {
		// Signature (asymmetric keys of the issuer only), `iss`, `aud` = client.
		let claims = self
			.validator
			.validate_claims(token)
			.map_err(|_| Rejection::Invalid)?
			.inner;
		let event = claims
			.get("events")
			.and_then(Value::as_object)
			.and_then(|events| events.get(LOGOUT_EVENT));
		if !matches!(event, Some(Value::Object(_))) || claims.contains_key("nonce") {
			return Err(Rejection::Invalid);
		}
		let iat = claims
			.get("iat")
			.and_then(Value::as_u64)
			.ok_or(Rejection::Invalid)?;
		if iat > now + FUTURE_SKEW_SECS || iat + MAX_TOKEN_AGE_SECS < now {
			return Err(Rejection::Invalid);
		}
		let text = |name: &str| {
			claims
				.get(name)
				.and_then(Value::as_str)
				.filter(|value| !value.is_empty())
				.map(str::to_owned)
		};
		let (sid, sub, jti) = (text("sid"), text("sub"), text("jti"));
		let jti = jti.ok_or(Rejection::Invalid)?;
		if sid.is_none() && sub.is_none() {
			return Err(Rejection::Invalid);
		}
		let until = now + self.keep.as_secs() + MAX_TOKEN_AGE_SECS + FUTURE_SKEW_SECS;
		let mut revocations = self.revocations.lock().expect("revocation lock");
		revocations.prune(now);
		if revocations.jtis.contains_key(&jti) {
			return Err(Rejection::Replayed);
		}
		revocations.jtis.insert(jti, now + MAX_TOKEN_AGE_SECS + FUTURE_SKEW_SECS);
		match (&sid, &sub) {
			(Some(sid), _) => {
				revocations.sids.insert(sid.clone(), (now, until));
			},
			(None, Some(sub)) => {
				let ended = revocations
					.subs
					.get(sub)
					.map_or(now, |(at, _)| (*at).max(now));
				revocations.subs.insert(sub.clone(), (ended, until));
			},
			(None, None) => unreachable!("checked above"),
		}
		Ok((sid, sub))
	}

	/// Whether the session whose ID token carries these claims was ended.
	pub(super) fn is_revoked(&self, claims: &Map<String, Value>) -> bool {
		let revocations = self.revocations.lock().expect("revocation lock");
		let issued = claims.get("iat").and_then(Value::as_u64).unwrap_or(0);
		if let Some(Value::String(sid)) = claims.get("sid")
			&& revocations.sids.contains_key(sid)
		{
			return true;
		}
		if let Some(Value::String(sub)) = claims.get("sub")
			&& let Some((at, _)) = revocations.subs.get(sub)
		{
			return issued <= *at;
		}
		false
	}
}

/// Short digest for logs; never the identifier or the token itself.
fn digest(value: Option<&str>) -> String {
	use base64::Engine;
	value
		.map(|value| {
			let hash = crate::crypto::digest::sha256(value.as_bytes());
			base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&hash[..6])
		})
		.unwrap_or_else(|| "-".into())
}

fn respond(status: StatusCode) -> PolicyResponse {
	let response = ::http::Response::builder()
		.status(status)
		.header(header::CACHE_CONTROL, "no-store")
		.body(Body::empty())
		.expect("static response");
	PolicyResponse::default().with_response(response)
}

impl OidcPolicy {
	/// Handle the back-channel logout path; `None` for every other request.
	pub(super) async fn handle_backchannel_logout(
		&self,
		req: &mut Request,
	) -> Option<PolicyResponse> {
		let receiver = self.backchannel_logout.as_ref()?;
		if req.uri().path() != receiver.path {
			return None;
		}
		if req.method() != Method::POST {
			return Some(respond(StatusCode::METHOD_NOT_ALLOWED));
		}
		let form = req
			.headers()
			.get(header::CONTENT_TYPE)
			.and_then(|value| value.to_str().ok())
			.and_then(|value| value.split(';').next())
			.is_some_and(|value| value.trim().eq_ignore_ascii_case("application/x-www-form-urlencoded"));
		if !form {
			return Some(respond(StatusCode::BAD_REQUEST));
		}
		let body = std::mem::take(req.body_mut());
		let Ok(bytes) = axum::body::to_bytes(body, MAX_BODY).await else {
			return Some(respond(StatusCode::BAD_REQUEST));
		};
		let mut tokens = url::form_urlencoded::parse(&bytes)
			.filter(|(key, _)| key == "logout_token")
			.map(|(_, value)| value.into_owned());
		let (Some(token), None) = (tokens.next(), tokens.next()) else {
			return Some(respond(StatusCode::BAD_REQUEST));
		};
		match receiver.accept(&token, now_unix()) {
			Ok((sid, sub)) => {
				info!(
					sid = %digest(sid.as_deref()),
					sub = %digest(sub.as_deref()),
					"oidc back-channel logout accepted"
				);
				Some(respond(StatusCode::OK))
			},
			Err(rejection) => {
				warn!(?rejection, "oidc back-channel logout rejected");
				Some(respond(StatusCode::BAD_REQUEST))
			},
		}
	}
}
