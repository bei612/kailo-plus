use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

pub(crate) const MAX_REQUEST_BYTES: usize = 3 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub idempotency_key: Uuid,
    pub client: String,
    pub category: Option<String>,
    pub message: String,
    pub diagnostics: Option<String>,
    pub attachment: Option<Attachment>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    pub mime_type: String,
    pub data_base64: String,
}

// Only these five fields can be previewed and opted into; arbitrary logs are rejected.
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Diagnostics {
    app_version: String,
    platform: String,
    user_agent: String,
    language: String,
    captured_at: String,
}

pub(super) struct Input {
    pub key: Uuid,
    pub client: String,
    pub category: Option<String>,
    pub message: String,
    pub diagnostics: Option<String>,
    pub bytes: Option<Vec<u8>>,
    pub mime: Option<String>,
    pub sha256: Option<String>,
    pub parameter_hash: String,
}

pub(super) fn image_type(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

pub(super) fn validate(request: Request) -> Result<Input, ()> {
    let message = request.message.trim().to_owned();
    if !matches!(request.client.as_str(), "WEB" | "DESKTOP" | "MOBILE")
        || !matches!(request.category.as_deref(), None | Some("BUG" | "PRAISE" | "NEEDS_WORK"))
        || !(1..=4000).contains(&message.chars().count())
    {
        return Err(());
    }
    let diagnostics = request.diagnostics.map(|raw| {
        if raw.len() > 4096 { return Err(()); }
        let fields: Diagnostics = serde_json::from_str(&raw).map_err(|_| ())?;
        if fields.app_version.len() > 128 || fields.platform.len() > 128
            || fields.user_agent.len() > 2048 || fields.language.len() > 64
            || chrono::DateTime::parse_from_rfc3339(&fields.captured_at).is_err()
        { return Err(()); }
        serde_json::to_string(&fields).map_err(|_| ())
    }).transpose()?;
    let (bytes, mime, sha256) = match request.attachment {
        None => (None, None, None),
        Some(attachment) => {
            if attachment.data_base64.len() > 2_796_204 { return Err(()); }
            let bytes = base64::engine::general_purpose::STANDARD.decode(attachment.data_base64).map_err(|_| ())?;
            if bytes.is_empty() || bytes.len() > 2 * 1024 * 1024 || image_type(&bytes) != Some(attachment.mime_type.as_str()) {
                return Err(());
            }
            let digest = hex::encode(Sha256::digest(&bytes));
            (Some(bytes), Some(attachment.mime_type), Some(digest))
        }
    };
    let canonical = serde_json::json!({"client": request.client, "category": request.category,
        "message": message, "diagnostics": diagnostics, "attachmentMime": mime, "attachmentSha256": sha256});
    let parameter_hash = hex::encode(Sha256::digest(canonical.to_string().as_bytes()));
    Ok(Input { key: request.idempotency_key, client: request.client, category: request.category,
        message, diagnostics, bytes, mime, sha256, parameter_hash })
}
