//! Core-only provider credential projection. The admin router authenticates every caller;
//! filesystem paths are derived here, never accepted from an HTTP request.

use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::PathBuf;

use axum::Json;
use axum::extract::Path;
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProjectionInput {
	// Intentionally no Debug/Serialize: the value must never enter telemetry or a read response.
	value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Projection {
	file: String,
	version: u32,
	sha256: String,
}

type Failure = (StatusCode, &'static str);

fn location(tenant: &str, route: &str, version: u32) -> Result<PathBuf, Failure> {
	let (Ok(tenant), Ok(route)) = (Uuid::parse_str(tenant), Uuid::parse_str(route)) else {
		return Err((
			StatusCode::BAD_REQUEST,
			"invalid credential projection reference",
		));
	};
	if tenant.is_nil() || route.is_nil() || version == 0 {
		return Err((
			StatusCode::BAD_REQUEST,
			"invalid credential projection reference",
		));
	}
	let root = std::env::var_os("AGENTGATEWAY_PROVIDER_SECRET_DIRECTORY")
		.map(PathBuf::from)
		.ok_or((
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection directory unavailable",
		))?;
	if !root.is_absolute() || root.parent().is_none() {
		return Err((
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection directory invalid",
		));
	}
	let canonical = fs::canonicalize(&root).map_err(|_| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection directory unavailable",
		)
	})?;
	if canonical != root || !root.is_dir() {
		return Err((
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection directory invalid",
		));
	}
	// A single immutable file per tenant / route / original OpenBao version. No path from input.
	Ok(root.join(format!("{tenant}.{route}.{version}")))
}

fn observe(path: &std::path::Path, version: u32) -> Result<Option<Projection>, Failure> {
	let mut file = match OpenOptions::new()
		.read(true)
		.custom_flags(libc::O_NOFOLLOW)
		.open(path)
	{
		Ok(file) => file,
		Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(None),
		Err(_) => {
			return Err((
				StatusCode::SERVICE_UNAVAILABLE,
				"credential projection unreadable",
			));
		},
	};
	let metadata = file.metadata().map_err(|_| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection unreadable",
		)
	})?;
	if !metadata.is_file() || metadata.permissions().mode() & 0o077 != 0 {
		return Err((
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection permissions invalid",
		));
	}
	let mut value = Vec::new();
	file.read_to_end(&mut value).map_err(|_| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection unreadable",
		)
	})?;
	if value.is_empty() {
		return Err((
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection incomplete",
		));
	}
	let sha256 = crate::crypto::digest::sha256(&value)
		.iter()
		.map(|byte| format!("{byte:02x}"))
		.collect();
	Ok(Some(Projection {
		file: path.to_string_lossy().into_owned(),
		version,
		sha256,
	}))
}

fn projection_lock(path: &std::path::Path) -> Result<fs::File, Failure> {
	let file = OpenOptions::new()
		.read(true)
		.write(true)
		.create(true)
		.truncate(false)
		.mode(0o600)
		.custom_flags(libc::O_NOFOLLOW)
		.open(path.with_extension("lock"))
		.map_err(|_| {
			(
				StatusCode::SERVICE_UNAVAILABLE,
				"credential projection lock unavailable",
			)
		})?;
	file.lock().map_err(|_| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection lock unavailable",
		)
	})?;
	Ok(file)
}

pub(crate) async fn read(
	Path((tenant, route, version)): Path<(String, String, u32)>,
) -> Result<Json<Option<Projection>>, Failure> {
	let path = location(&tenant, &route, version)?;
	observe(&path, version).map(Json)
}

pub(crate) async fn put(
	Path((tenant, route, version)): Path<(String, String, u32)>,
	Json(input): Json<ProjectionInput>,
) -> Result<Json<Projection>, Failure> {
	if input.value.is_empty() {
		return Err((StatusCode::BAD_REQUEST, "empty provider credential"));
	}
	let path = location(&tenant, &route, version)?;
	let _guard = projection_lock(&path)?;
	if path.with_extension("retired").try_exists().map_err(|_| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			"credential retirement unreadable",
		)
	})? {
		return Err((StatusCode::CONFLICT, "credential projection retired"));
	}
	let expected: String = crate::crypto::digest::sha256(input.value.as_bytes())
		.iter()
		.map(|byte| format!("{byte:02x}"))
		.collect();
	if let Some(existing) = observe(&path, version)? {
		return if existing.sha256 == expected {
			Ok(Json(existing))
		} else {
			Err((
				StatusCode::CONFLICT,
				"credential projection reference already used",
			))
		};
	}
	let mut file = OpenOptions::new()
		.write(true)
		.create_new(true)
		.mode(0o600)
		.custom_flags(libc::O_NOFOLLOW)
		.open(&path)
		.map_err(|_| {
			(
				StatusCode::SERVICE_UNAVAILABLE,
				"credential projection write indeterminate",
			)
		})?;
	file
		.write_all(input.value.as_bytes())
		.and_then(|()| file.sync_all())
		.map_err(|_| {
			(
				StatusCode::SERVICE_UNAVAILABLE,
				"credential projection write indeterminate",
			)
		})?;
	fs::File::open(path.parent().ok_or((
		StatusCode::SERVICE_UNAVAILABLE,
		"credential projection directory invalid",
	))?)
	.and_then(|directory| directory.sync_all())
	.map_err(|_| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection write indeterminate",
		)
	})?;
	let observed = observe(&path, version)?.ok_or((
		StatusCode::SERVICE_UNAVAILABLE,
		"credential projection write indeterminate",
	))?;
	if observed.sha256 != expected {
		return Err((
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection write indeterminate",
		));
	}
	Ok(Json(observed))
}

pub(crate) async fn delete(
	Path((tenant, route, version)): Path<(String, String, u32)>,
) -> Result<Json<bool>, Failure> {
	let path = location(&tenant, &route, version)?;
	let _guard = projection_lock(&path)?;
	// Keep a native retirement fence: an already-accepted late PUT cannot recreate this version.
	let fence = OpenOptions::new()
		.write(true)
		.create(true)
		.truncate(false)
		.mode(0o600)
		.custom_flags(libc::O_NOFOLLOW)
		.open(path.with_extension("retired"))
		.map_err(|_| {
			(
				StatusCode::SERVICE_UNAVAILABLE,
				"credential retirement indeterminate",
			)
		})?;
	fence.sync_all().map_err(|_| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			"credential retirement indeterminate",
		)
	})?;
	match fs::remove_file(&path) {
		Ok(()) => (),
		Err(err) if err.kind() == std::io::ErrorKind::NotFound => (),
		Err(_) => {
			return Err((
				StatusCode::SERVICE_UNAVAILABLE,
				"credential projection retirement indeterminate",
			));
		},
	}
	fs::File::open(path.parent().ok_or((
		StatusCode::SERVICE_UNAVAILABLE,
		"credential projection directory invalid",
	))?)
	.and_then(|directory| directory.sync_all())
	.map_err(|_| {
		(
			StatusCode::SERVICE_UNAVAILABLE,
			"credential projection retirement indeterminate",
		)
	})?;
	Ok(Json(observe(&path, version)?.is_none()))
}
