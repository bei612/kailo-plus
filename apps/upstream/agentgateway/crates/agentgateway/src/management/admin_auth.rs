//! Service authentication for the admin plane.
//!
//! The admin router serves configuration writes (`POST /api/config`, ConfigResource CRUD,
//! listener/TLS settings), process shutdown (`/quitquitquit`) and request-log reads. It is
//! authenticated as a whole: every request must carry `Authorization: Bearer <jwt>` issued to the
//! single configured caller, before any admin handler (including the merged UI router) runs.
//!
//! The token is an OAuth2 client-credentials access token of the caller's own OIDC client. It is
//! accepted only when all of the following hold:
//! - the signature verifies against the configured JWKS,
//! - `iss` equals the configured issuer,
//! - `aud` contains one of the configured audiences (at least one audience is required),
//! - `exp` is present and not expired (`nbf` is honoured when present),
//! - `azp` equals the configured `clientId` exactly.
//!
//! There is no unauthenticated mode. When `adminAuthentication` is not configured, every admin
//! request is rejected; network reachability and CORS are not treated as authentication.

use std::collections::HashSet;

use axum::extract::{Request, State};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use jsonwebtoken::jwk::JwkSet;

use crate::http::auth::AuthorizationLocation;
use crate::http::jwt::{JWTValidationOptions, Jwt, Mode, Provider};
use crate::resource_manager::{ResourceFetcher, ResourceKind, ResourceManager};
use crate::*;

/// `config.adminAuthentication` as written in the configuration file.
#[apply(schema_de!)]
pub struct RawAdminAuthentication {
	/// Expected token issuer. The JWT `iss` claim must match exactly.
	pub issuer: String,
	/// Accepted token audiences. Must be non-empty; the JWT `aud` claim must contain one of them.
	pub audiences: Vec<String>,
	/// JSON Web Key Set used to verify token signatures. Can be inline, from a file, or fetched remotely.
	pub jwks: serdes::FileInlineOrRemote,
	/// The only OAuth2 client allowed to call the admin plane. The JWT `azp` claim must match exactly.
	pub client_id: String,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminAuthentication {
	issuer: String,
	audiences: Vec<String>,
	#[serde(skip)]
	jwks: serdes::FileInlineOrRemote,
	client_id: String,
}

impl TryFrom<RawAdminAuthentication> for AdminAuthentication {
	type Error = anyhow::Error;

	fn try_from(raw: RawAdminAuthentication) -> anyhow::Result<Self> {
		// Each of these, if empty, would silently widen who is accepted: an empty audience list
		// disables audience validation, and an empty issuer or client id has nothing to match.
		if raw.issuer.is_empty() {
			anyhow::bail!("config.adminAuthentication.issuer must not be empty");
		}
		if raw.audiences.is_empty() || raw.audiences.iter().any(String::is_empty) {
			anyhow::bail!(
				"config.adminAuthentication.audiences must be a non-empty list of non-empty values"
			);
		}
		if raw.client_id.is_empty() {
			anyhow::bail!("config.adminAuthentication.clientId must not be empty");
		}
		Ok(Self {
			issuer: raw.issuer,
			audiences: raw.audiences,
			jwks: raw.jwks,
			client_id: raw.client_id,
		})
	}
}

#[derive(Debug, thiserror::Error)]
enum Rejection {
	#[error("admin authentication is not configured")]
	NotConfigured,
	#[error("missing bearer token")]
	MissingToken,
	#[error("admin authentication keys are unavailable")]
	KeysUnavailable,
	#[error("invalid token")]
	InvalidToken,
	#[error("caller is not the admin client")]
	WrongCaller,
}

impl IntoResponse for Rejection {
	fn into_response(self) -> Response {
		let status = match self {
			Rejection::KeysUnavailable => http::StatusCode::SERVICE_UNAVAILABLE,
			Rejection::WrongCaller => http::StatusCode::FORBIDDEN,
			Rejection::NotConfigured | Rejection::MissingToken | Rejection::InvalidToken => {
				http::StatusCode::UNAUTHORIZED
			},
		};
		(status, self.to_string()).into_response()
	}
}

#[derive(Clone)]
pub(super) struct AdminAuthState {
	config: Option<AdminAuthentication>,
	resources: ResourceFetcher,
}

impl AdminAuthState {
	pub(super) fn new(
		config: Option<AdminAuthentication>,
		resource_manager: ResourceManager,
	) -> Self {
		Self {
			config,
			// Reuse keys already cached for data-plane JWT policies; otherwise fetch on demand so
			// that rotated keys are seen without a restart.
			resources: ResourceFetcher::cached_or_direct(resource_manager),
		}
	}

	async fn authenticate(&self, token: Option<&str>) -> Result<(), Rejection> {
		let cfg = self.config.as_ref().ok_or(Rejection::NotConfigured)?;
		let token = token.ok_or(Rejection::MissingToken)?;
		let jwks: JwkSet = cfg
			.jwks
			.load(&self.resources, ResourceKind::Jwks)
			.await
			.map_err(|err| {
				warn!(?err, "failed to load admin authentication JWKS");
				Rejection::KeysUnavailable
			})?;
		let provider = Provider::from_jwks(
			jwks,
			cfg.issuer.clone(),
			Some(cfg.audiences.clone()),
			JWTValidationOptions {
				required_claims: HashSet::from(["exp", "iss", "aud"].map(str::to_owned)),
			},
		)
		.map_err(|err| {
			warn!(?err, "invalid admin authentication JWKS");
			Rejection::KeysUnavailable
		})?;
		let jwt = Jwt::from_providers(
			vec![provider],
			Mode::Strict,
			AuthorizationLocation::bearer_header(),
			false,
		);
		let claims = jwt.validate_claims(token).map_err(|err| {
			debug!(?err, "rejected admin request token");
			Rejection::InvalidToken
		})?;
		match claims.inner.get("azp") {
			Some(serde_json::Value::String(azp)) if *azp == cfg.client_id => Ok(()),
			_ => Err(Rejection::WrongCaller),
		}
	}
}

pub(super) async fn require_admin_client(
	State(state): State<AdminAuthState>,
	req: Request,
	next: Next,
) -> Response {
	let token = req
		.headers()
		.get(http::header::AUTHORIZATION)
		.and_then(|v| v.to_str().ok())
		.and_then(|v| v.split_once(' '))
		.filter(|(scheme, token)| scheme.eq_ignore_ascii_case("bearer") && !token.is_empty())
		.map(|(_, token)| token.to_owned());
	match state.authenticate(token.as_deref()).await {
		Ok(()) => next.run(req).await,
		Err(rejection) => {
			debug!(path = %req.uri().path(), %rejection, "rejected admin request");
			rejection.into_response()
		},
	}
}
