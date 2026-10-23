//! DD-131(2)(3)、05 §2.12：原版 `buzz-*-snapshot@1` 包的编码端（`.agent.json`/`.agent.png`、
//! `.team.*`）。清单只由调用方给出的可移植字段构成；PNG 以 tEXt 块承载 base64 清单，图像体是
//! 头像（PNG 原样注入）或 1×1 透明占位。没有图像库：非 PNG 头像不转码，只作为清单内联数据。

use base64::Engine as _;
use serde_json::{json, Value};

/// 原版：头像不超过 2 MiB 时内联为 data URL。
pub(crate) const MAX_AVATAR_INLINE_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const AGENT_PNG_KEYWORD: &str = "buzz_agent_snapshot";
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for byte in bytes {
        a = (a + u32::from(*byte)) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 12);
    out.extend_from_slice(&u32::try_from(data.len()).unwrap_or(u32::MAX).to_be_bytes());
    let mut crc_input = Vec::with_capacity(data.len() + 4);
    crc_input.extend_from_slice(kind);
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc_input);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
    out
}

/// 1×1 透明 RGBA，IDAT 是一个 zlib stored 块（原版无头像时的占位图）。
fn placeholder(text: &[u8]) -> Vec<u8> {
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&1u32.to_be_bytes());
    ihdr.extend_from_slice(&1u32.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    let raw = [0u8, 0, 0, 0, 0];
    let mut idat = vec![0x78, 0x01, 0x01];
    idat.extend_from_slice(&5u16.to_le_bytes());
    idat.extend_from_slice(&(!5u16).to_le_bytes());
    idat.extend_from_slice(&raw);
    idat.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut png = PNG_SIGNATURE.to_vec();
    png.extend(chunk(b"IHDR", &ihdr));
    png.extend(chunk(b"tEXt", text));
    png.extend(chunk(b"IDAT", &idat));
    png.extend(chunk(b"IEND", &[]));
    png
}

/// 在一张合法 PNG 的 IHDR 之后（首个 IDAT 之前）注入 tEXt：原版与导入端都只在图像数据之前读取
/// 清单块。结构不成立或已带同名块则不注入。
fn inject(png: &[u8], text: &[u8], keyword: &str) -> Option<Vec<u8>> {
    let rest = png.strip_prefix(PNG_SIGNATURE)?;
    let mut offset = 0usize;
    let mut out = PNG_SIGNATURE.to_vec();
    let mut first = true;
    while offset + 12 <= rest.len() {
        let len = usize::try_from(u32::from_be_bytes(
            rest[offset..offset + 4].try_into().ok()?,
        ))
        .ok()?;
        let end = offset.checked_add(12)?.checked_add(len)?;
        if end > rest.len() {
            return None;
        }
        let kind = &rest[offset + 4..offset + 8];
        let data = &rest[offset + 8..offset + 8 + len];
        let stored = u32::from_be_bytes(rest[end - 4..end].try_into().ok()?);
        if crc32(&rest[offset + 4..offset + 8 + len]) != stored || first != (kind == b"IHDR") {
            return None;
        }
        if kind == b"tEXt" && data.split(|b| *b == 0).next() == Some(keyword.as_bytes()) {
            return None;
        }
        out.extend_from_slice(&rest[offset..end]);
        if first {
            out.extend(chunk(b"tEXt", text));
        }
        first = false;
        offset = end;
        if kind == b"IEND" {
            return (end == rest.len()).then_some(out);
        }
    }
    None
}

/// 原版 `encode_chunk_payload_png`：清单 JSON 的 base64 放进 `keyword` 的 tEXt 块。
pub(crate) fn png_with_manifest(keyword: &str, manifest: &[u8], avatar: Option<&[u8]>) -> Vec<u8> {
    let mut text = keyword.as_bytes().to_vec();
    text.push(0);
    text.extend_from_slice(
        base64::engine::general_purpose::STANDARD
            .encode(manifest)
            .as_bytes(),
    );
    avatar
        .filter(|bytes| bytes.starts_with(PNG_SIGNATURE))
        .and_then(|bytes| inject(bytes, &text, keyword))
        .unwrap_or_else(|| placeholder(&text))
}

/// 原版按魔数识别的四种头像格式；其他字节不内联。
pub(crate) fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(PNG_SIGNATURE) {
        Some("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF8") {
        Some("image/gif")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("image/webp")
    } else {
        None
    }
}

pub(crate) fn avatar_data_url(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() || bytes.len() > MAX_AVATAR_INLINE_BYTES {
        return None;
    }
    image_mime(bytes).map(|mime| {
        format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    })
}

/// 原版文件名 `<显示名>.<kind>.<json|png>`：去掉路径与控制字符，空名退回 kind。
pub(crate) fn file_name(display: &str, kind: &str, png: bool) -> String {
    let cleaned: String = display
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .take(120)
        .collect();
    let stem = cleaned.trim().trim_matches('.');
    let stem = if stem.is_empty() { kind } else { stem };
    format!("{stem}.{kind}.{}", if png { "png" } else { "json" })
}

/// 一个 Skill 引用的可移植形：slug 与 artifact digest（DD-131(2)）。
pub(crate) struct SkillRef {
    pub slug: String,
    pub artifact_digest: String,
}

/// DD-131(2) 的 `buzz-agent-snapshot@1` 清单。来源是一个 PUBLISHED AgentVersion 的 requested
/// 内容；不读取也不写入 owner、公钥、Installation、绑定、`llm_route`、RuntimeProfile、
/// Delegation、记忆或任何 SecretRef。Kailo 行为字段放在原版忽略的 `definition.kailo` 扩展中。
pub(crate) fn agent_manifest(
    content: &Value,
    avatar_data_url: Option<&str>,
    skills: &[SkillRef],
) -> Option<Value> {
    let persona = content.get("personaIdentity")?;
    let display_name = persona
        .get("displayName")?
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())?;
    let mut definition = json!({"name": display_name, "sourceIsBuiltin": false});
    if let Some(prompt) = content
        .get("instructions")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        definition["systemPrompt"] = json!(prompt);
    }
    if let Some(n) = content
        .get("parallelism")
        .and_then(Value::as_i64)
        .filter(|n| *n > 0)
    {
        definition["parallelism"] = json!(n);
    }
    if let Some(limits) = content.get("turnLimits") {
        for (from, to) in [
            ("idleTimeoutSeconds", "idleTimeoutSeconds"),
            ("maxTurnDurationSeconds", "maxTurnDurationSeconds"),
        ] {
            if let Some(n) = limits.get(from).and_then(Value::as_i64).filter(|n| *n > 0) {
                definition[to] = json!(n);
            }
        }
    }
    let mut kailo = serde_json::Map::new();
    for key in [
        "replyPolicy",
        "triggerDefaults",
        "memoryPolicy",
        "capabilityRequirements",
    ] {
        if let Some(value) = content.get(key).filter(|v| !v.is_null()) {
            kailo.insert(key.into(), value.clone());
        }
    }
    if !skills.is_empty() {
        kailo.insert(
            "skills".into(),
            Value::Array(
                skills
                    .iter()
                    .map(|s| json!({"slug": s.slug, "artifactDigest": s.artifact_digest}))
                    .collect(),
            ),
        );
    }
    if !kailo.is_empty() {
        definition["kailo"] = Value::Object(kailo);
    }
    let mut profile = json!({"displayName": display_name});
    if let Some(about) = persona
        .get("description")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
    {
        profile["about"] = json!(about);
    }
    if let Some(url) = avatar_data_url {
        profile["avatarDataUrl"] = json!(url);
    }
    Some(json!({
        "format": "buzz-agent-snapshot",
        "version": 1,
        "definition": definition,
        "profile": profile,
        "memory": {"level": "none"},
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_snapshot::{decode, MediaType};

    fn content() -> Value {
        json!({
            "personaIdentity": {"displayName": "Release writer", "description": "Drafts notes",
                "avatarUrl": "https://community.test/media/abc.png"},
            "instructions": "Write concise release notes.",
            "runtimeProfileKey": "server-codex",
            "modelRouteResourceId": "6d7f8a1c-0f1e-4e1b-9a55-0c1f3a2b4d5e",
            "skillVersionAssetIds": [], "declaredToolResourceIds": [],
            "capabilityRequirements": ["kailo.files@1"], "triggerDefaults": ["MENTION"],
            "replyPolicy": "THREAD", "parallelism": 2,
            "turnLimits": {"idleTimeoutSeconds": 300, "maxTurnDurationSeconds": 1800},
            "memoryPolicy": {"coreWrite": "HUMAN_ONLY", "coldWrite": "DISABLED"},
        })
    }

    #[test]
    fn manifest_carries_only_portable_fields() {
        let manifest = agent_manifest(&content(), None, &[]).unwrap();
        let text = manifest.to_string();
        for forbidden in [
            "runtimeProfileKey",
            "modelRouteResourceId",
            "server-codex",
            "6d7f8a1c",
            "avatarUrl",
            "community.test",
            "owner",
            "pubkey",
        ] {
            assert!(!text.contains(forbidden), "{forbidden} leaked");
        }
        assert_eq!(manifest["memory"], json!({"level": "none"}));
        assert_eq!(manifest["definition"]["kailo"]["replyPolicy"], "THREAD");
    }

    #[test]
    fn json_and_png_packages_decode_with_the_importer() {
        let png_avatar = placeholder(b"other\0x");
        let url = avatar_data_url(&png_avatar).unwrap();
        let manifest = agent_manifest(&content(), Some(&url), &[]).unwrap();
        let json_bytes = serde_json::to_vec_pretty(&manifest).unwrap();
        let from_json = decode(&json_bytes, MediaType::Json).unwrap();
        assert_eq!(from_json.display_name, "Release writer");
        assert_eq!(from_json.parallelism, Some(2));
        for avatar in [
            None,
            Some(png_avatar.as_slice()),
            Some(b"\xff\xd8\xffjpeg".as_slice()),
        ] {
            let png = png_with_manifest(AGENT_PNG_KEYWORD, &json_bytes, avatar);
            let decoded = decode(&png, MediaType::Png).unwrap();
            assert_eq!(decoded.instructions, "Write concise release notes.");
            assert_eq!(decoded.description.as_deref(), Some("Drafts notes"));
        }
    }

    #[test]
    fn existing_snapshot_chunks_and_broken_pngs_fall_back_to_the_placeholder() {
        let first = png_with_manifest(AGENT_PNG_KEYWORD, b"{}", None);
        // Re-exporting a card never stacks a second manifest chunk.
        assert!(inject(&first, b"buzz_agent_snapshot\0e30=", AGENT_PNG_KEYWORD).is_none());
        let mut broken = first.clone();
        let last = broken.len() - 1;
        broken[last] ^= 1;
        assert!(inject(&broken, b"k\0v", "k").is_none());
        assert!(image_mime(b"<svg/>").is_none());
        assert!(avatar_data_url(&vec![0u8; MAX_AVATAR_INLINE_BYTES + 1]).is_none());
    }

    #[test]
    fn file_names_follow_the_original_suffixes() {
        assert_eq!(
            file_name("Release writer", "agent", true),
            "Release writer.agent.png"
        );
        assert_eq!(file_name("a/b:c", "agent", false), "a_b_c.agent.json");
        assert_eq!(file_name("  ..  ", "team", true), "team.team.png");
    }
}
