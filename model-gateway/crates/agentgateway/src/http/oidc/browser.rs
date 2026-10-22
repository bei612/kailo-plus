//! Configurable browser login and logout endpoints.
use ::http::{Method, StatusCode, Uri, header};
use secrecy::ExposeSecret;

use super::{OidcPolicy, build_redirect_response, session};
use crate::http::{PolicyResponse, Request};
use crate::proxy::ProxyError;

impl OidcPolicy {
	pub(super) fn return_target(&self, uri: &Uri) -> String {
		let target = crate::http::query_parameter(uri, "returnTo")
			.and_then(|value| value.parse::<http::uri::PathAndQuery>().ok());
		let path = target.as_ref().map_or("/", http::uri::PathAndQuery::path);
		let target = session::normalize_original_uri(target.as_ref());
		if path == self.redirect_uri.callback_path
			|| self.login.as_ref().is_some_and(|v| path == v.path)
			|| self.logout.as_ref().is_some_and(|v| path == v.path)
		{
			"/".into()
		} else {
			target
		}
	}

	pub(super) fn handle_logout(&self, req: &Request) -> Result<Option<PolicyResponse>, ProxyError> {
		if !self
			.logout
			.as_ref()
			.is_some_and(|logout| req.uri().path() == logout.path)
		{
			return Ok(None);
		}
		if req.method() != Method::POST {
			return Err(ProxyError::MethodNotAllowed);
		}
		// Require a same-origin form POST. An absent Origin is rejected too.
		if req
			.headers()
			.get(header::ORIGIN)
			.and_then(|v| v.to_str().ok())
			!= Some(self.redirect_uri.origin.as_str())
		{
			return Err(ProxyError::CsrfValidationFailed);
		}
		let mut cookies = vec![
			self
				.session
				.clear_cookie(&self.session.cookie_name, self.redirect_uri.https),
		];
		// Cancel pending login attempts as well as the current session. Each attempt
		// has its own transaction cookie under this policy's prefix; clear_cookie
		// expires one exact name, so we must enumerate them from the request.
		let prefix = format!("{}.", self.session.transaction_cookie_prefix);
		cookies.extend(
			crate::http::iter_request_cookies(req)
				.filter(|cookie| cookie.name().starts_with(&prefix))
				.map(|cookie| {
					self
						.session
						.clear_cookie(cookie.name(), self.redirect_uri.https)
				}),
		);
		let destination = self
			.logout
			.as_ref()
			.and_then(|v| v.redirect.as_deref())
			.or_else(|| self.login.as_ref().and_then(|v| v.redirect.as_deref()))
			.unwrap_or("/");
		let location = self
			.end_session_location(req, destination)
			.unwrap_or_else(|| destination.to_string());
		let mut response =
			build_redirect_response(&location, &cookies).map_err(ProxyError::OidcFailure)?;
		*response.status_mut() = StatusCode::SEE_OTHER;
		response.headers_mut().insert(
			header::CACHE_CONTROL,
			http::HeaderValue::from_static("no-store"),
		);
		Ok(Some(PolicyResponse::default().with_response(response)))
	}

	/// SS-AGW-END-SESSION (Kailo): RP-Initiated Logout. Only a session this policy can
	/// decode supplies `id_token_hint`; anything else keeps the local destination, so a
	/// forged or stale cookie never steers the redirect. The hint goes to the provider
	/// once, in the browser's top-level navigation; it is never logged or forwarded.
	fn end_session_location(&self, req: &Request, destination: &str) -> Option<String> {
		let endpoint = self.end_session_endpoint.as_ref()?;
		let cookie = crate::http::read_request_cookie(req, &self.session.cookie_name)?;
		let browser_session = self.session.decode_browser_session(&cookie).ok()?;
		if browser_session.policy_id != self.policy_id {
			return None;
		}
		Some(endpoint.with_query(&[
			(
				"id_token_hint",
				browser_session.raw_id_token.expose_secret().to_string(),
			),
			("client_id", self.client.client_id.clone()),
			(
				"post_logout_redirect_uri",
				format!("{}{destination}", self.redirect_uri.origin),
			),
		]))
	}
}
