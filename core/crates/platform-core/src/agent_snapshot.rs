//! DD-131(2)、DD-143、05 §2.12：`buzz-agent-snapshot@1` 包的 Core 解码与原版映射。
//!
//! 包是 `.agent.json` 清单本身，或在 tEXt `buzz_agent_snapshot` 中以 base64 承载同一清单的
//! `.agent.png`（SF-BUZ-60 原版 `agent_snapshot.rs`）。这里只判定格式、上限与可移植字段，
//! 不信任包内任何身份、公钥、运行时、模型、名单或记忆；这些按 DD-131(2) 丢弃并在预览中列出。

use base64::Engine as _;
use contracts::ReasonCode;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::governance::Refusal;

pub(crate) const FORMAT_KEY: &str = "buzz-agent-snapshot@1";
const FORMAT_DISCRIMINATOR: &str = "buzz-agent-snapshot";
const PNG_CHUNK_KEYWORD: &[u8] = b"buzz_agent_snapshot";
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
/// 原版上限：`.agent.json` 5 MiB、`.agent.png` 10 MiB、内联头像 2 MiB。
pub(crate) const MAX_JSON_BYTES: usize = 5 * 1024 * 1024;
pub(crate) const MAX_PNG_BYTES: usize = 10 * 1024 * 1024;
const MAX_AVATAR_INLINE_BYTES: usize = 2 * 1024 * 1024;
/// 原版 `definition_validation.rs` 的人可审阅文本上限。
const MAX_DISPLAY_NAME_CHARS: usize = 128;
const MAX_SYSTEM_PROMPT_BYTES: usize = 64 * 1024;
const MAX_DESCRIPTION_CHARS: usize = 280;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum MediaType {
    Json,
    Png,
}

impl MediaType {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Json => "application/json",
            Self::Png => "image/png",
        }
    }

    pub(crate) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "application/json" => Some(Self::Json),
            "image/png" => Some(Self::Png),
            _ => None,
        }
    }

    pub(crate) fn limit(self) -> usize {
        match self {
            Self::Json => MAX_JSON_BYTES,
            Self::Png => MAX_PNG_BYTES,
        }
    }
}

/// 映射后的可移植字段。`kailo` 是 Kailo 导出写入 `definition.kailo` 的同格式扩展，原版解码器忽略。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Snapshot {
    pub display_name: String,
    pub description: Option<String>,
    pub avatar_data_url: Option<String>,
    pub instructions: String,
    pub parallelism: Option<i64>,
    pub idle_timeout_seconds: Option<i64>,
    pub max_turn_duration_seconds: Option<i64>,
    pub source_is_builtin: bool,
    pub omitted: Vec<&'static str>,
    pub reply_policy: Option<String>,
    pub trigger_defaults: Option<Value>,
    pub memory_policy: Option<Value>,
    pub capability_requirements: Vec<String>,
}

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn too_large() -> Refusal {
    Refusal::Precondition(ReasonCode::PayloadTooLarge)
}

pub(crate) fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// 解码一个包。旧 `.persona.*`、zip、锁定卡与 v1 以外的格式一律 `INVALID_PARAMETERS`。
pub(crate) fn decode(bytes: &[u8], media: MediaType) -> Result<Snapshot, Refusal> {
    if bytes.is_empty() {
        return Err(invalid());
    }
    if bytes.len() > media.limit() {
        return Err(too_large());
    }
    let manifest = match media {
        MediaType::Json => {
            if bytes.starts_with(PNG_SIGNATURE) {
                return Err(invalid());
            }
            bytes.to_vec()
        }
        MediaType::Png => png_manifest(bytes)?,
    };
    if manifest.len() > MAX_JSON_BYTES {
        return Err(too_large());
    }
    let value: Value = serde_json::from_slice(&manifest).map_err(|_| invalid())?;
    map(&value)
}

/// PNG 结构逐块核对（签名、长度、CRC、IHDR 在首、IEND 在尾），只读 IDAT 之前的
/// `buzz_agent_snapshot` tEXt，与原版 `png` 解码器 `read_info` 可见的文本块一致。
fn png_manifest(bytes: &[u8]) -> Result<Vec<u8>, Refusal> {
    let mut rest = bytes.strip_prefix(PNG_SIGNATURE).ok_or_else(invalid)?;
    let mut first = true;
    let mut before_image = true;
    let mut found: Option<&[u8]> = None;
    loop {
        if rest.len() < 12 {
            return Err(invalid());
        }
        let length = u32::from_be_bytes([rest[0], rest[1], rest[2], rest[3]]) as usize;
        let kind = &rest[4..8];
        if length > rest.len() - 12 {
            return Err(invalid());
        }
        let data = &rest[8..8 + length];
        let crc = u32::from_be_bytes([
            rest[8 + length],
            rest[9 + length],
            rest[10 + length],
            rest[11 + length],
        ]);
        if crc32(&rest[4..8 + length]) != crc || first != (kind == b"IHDR") {
            return Err(invalid());
        }
        first = false;
        match kind {
            b"IDAT" => before_image = false,
            b"tEXt" if before_image => {
                let split = data.iter().position(|b| *b == 0).ok_or_else(invalid)?;
                if &data[..split] == PNG_CHUNK_KEYWORD {
                    if found.is_some() {
                        return Err(invalid());
                    }
                    found = Some(&data[split + 1..]);
                }
            }
            _ => {}
        }
        rest = &rest[12 + length..];
        if kind == b"IEND" {
            if !rest.is_empty() {
                return Err(invalid());
            }
            break;
        }
    }
    let text = found.ok_or_else(invalid)?;
    // tEXt 是 Latin-1；base64 字母表是其 ASCII 子集，其余字节即非法。
    let text = std::str::from_utf8(text).map_err(|_| invalid())?;
    base64::engine::general_purpose::STANDARD
        .decode(text.trim())
        .map_err(|_| invalid())
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}

/// 原版 `validate_visible_text`：拒绝而不是剥除会让审阅者看不到的字符。
fn visible(value: &str, layout: bool) -> bool {
    value.chars().all(|c| {
        if layout && matches!(c, '\n' | '\t') {
            return true;
        }
        !c.is_control()
            && !matches!(c,
                '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{115F}' | '\u{1160}' | '\u{17B4}' | '\u{17B5}'
                | '\u{180B}'..='\u{180F}' | '\u{200B}'..='\u{200C}' | '\u{200E}'..='\u{200F}'
                | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{3164}' | '\u{FE00}'..='\u{FE0E}'
                | '\u{FEFF}' | '\u{FFA0}' | '\u{FFF0}'..='\u{FFF8}' | '\u{E0000}'..='\u{E0FFF}')
    })
}

fn optional_text<'a>(value: &'a Value, key: &str) -> Result<Option<&'a str>, Refusal> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(invalid()),
    }
}

fn optional_positive(value: &Value, key: &str) -> Result<Option<i64>, Refusal> {
    match value.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_u64()
            .filter(|n| *n > 0)
            .and_then(|n| i64::try_from(n).ok())
            .map(Some)
            .ok_or_else(invalid),
    }
}

fn map(value: &Value) -> Result<Snapshot, Refusal> {
    // 锁定卡的外层信封是另一个 format 判别值，在此即被拒绝（DD-131(5)）。
    if value.get("format").and_then(Value::as_str) != Some(FORMAT_DISCRIMINATOR)
        || value.get("version").and_then(Value::as_u64) != Some(1)
    {
        return Err(invalid());
    }
    let definition = value
        .get("definition")
        .filter(|v| v.is_object())
        .ok_or_else(invalid)?;
    let profile = value
        .get("profile")
        .filter(|v| v.is_object())
        .ok_or_else(invalid)?;
    let name = optional_text(definition, "name")?.ok_or_else(invalid)?;
    let display_name = optional_text(profile, "displayName")?.ok_or_else(invalid)?;
    if name.trim().is_empty()
        || display_name.trim().is_empty()
        || display_name.chars().count() > MAX_DISPLAY_NAME_CHARS
        || !visible(display_name, false)
    {
        return Err(invalid());
    }
    let instructions = optional_text(definition, "systemPrompt")?.unwrap_or_default();
    // AgentVersion 的 instructions 必填：没有提示词的包不能成为合法 DRAFT。
    if instructions.trim().is_empty()
        || instructions.len() > MAX_SYSTEM_PROMPT_BYTES
        || !visible(instructions, true)
    {
        return Err(invalid());
    }
    let description = optional_text(profile, "about")?.filter(|s| !s.trim().is_empty());
    if description.is_some_and(|d| d.chars().count() > MAX_DESCRIPTION_CHARS || !visible(d, false))
    {
        return Err(invalid());
    }
    let mut omitted = Vec::new();
    for (key, code) in [
        ("runtime", "RUNTIME"),
        ("model", "MODEL"),
        ("provider", "PROVIDER"),
    ] {
        if optional_text(definition, key)?.is_some_and(|s| !s.trim().is_empty()) {
            omitted.push(code);
        }
    }
    let array = |key: &str| -> Result<usize, Refusal> {
        match definition.get(key) {
            None | Some(Value::Null) => Ok(0),
            Some(Value::Array(items)) if items.iter().all(Value::is_string) => Ok(items.len()),
            Some(_) => Err(invalid()),
        }
    };
    if array("namePool")? > 0 {
        omitted.push("NAME_POOL");
    }
    let respond_to = optional_text(definition, "respondTo")?;
    if array("respondToAllowlist")? > 0 || respond_to == Some("allowlist") {
        omitted.push("RESPOND_TO_ALLOWLIST");
    }
    if respond_to == Some("anyone") {
        omitted.push("RESPOND_TO_ANYONE");
    }
    match definition.get("sessionPolicy") {
        None | Some(Value::Null) => {}
        Some(Value::String(policy)) if policy == "channel" => {}
        Some(Value::String(policy)) if policy == "thread" => omitted.push("SESSION_POLICY"),
        Some(_) => return Err(invalid()),
    }
    // 原版 memory 段可为空或带明文条目；DD-131(4) 一律不带入、不回显。
    if let Some(memory) = value.get("memory").filter(|v| !v.is_null()) {
        let level = memory.get("level").and_then(Value::as_str);
        let entries = memory
            .get("entries")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        if level.is_none_or(|l| !matches!(l, "none" | "core" | "everything")) {
            return Err(invalid());
        }
        if level != Some("none") || entries > 0 {
            omitted.push("MEMORY");
        }
    }
    let avatar_data_url = match optional_text(profile, "avatarDataUrl")? {
        Some(url) => {
            let bytes = inline_image(url).ok_or_else(invalid)?;
            if bytes > MAX_AVATAR_INLINE_BYTES {
                return Err(too_large());
            }
            Some(url.to_owned())
        }
        None => None,
    };
    if avatar_data_url.is_some() || optional_text(profile, "avatarUrl")?.is_some() {
        omitted.push("AVATAR");
    }
    let kailo = definition.get("kailo").filter(|v| !v.is_null());
    let reply_policy = match kailo {
        Some(ext) => optional_text(ext, "replyPolicy")?.map(str::to_owned),
        None => None,
    };
    let trigger_defaults = kailo.and_then(|ext| ext.get("triggerDefaults")).cloned();
    let memory_policy = kailo.and_then(|ext| ext.get("memoryPolicy")).cloned();
    let capability_requirements = match kailo.and_then(|ext| ext.get("capabilityRequirements")) {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|v| v.as_str().map(str::to_owned).ok_or_else(invalid))
            .collect::<Result<_, _>>()?,
        Some(_) => return Err(invalid()),
    };
    if kailo
        .and_then(|ext| ext.get("skills"))
        .and_then(Value::as_array)
        .is_some_and(|items| !items.is_empty())
    {
        omitted.push("SKILLS");
    }
    Ok(Snapshot {
        display_name: display_name.to_owned(),
        description: description.map(str::to_owned),
        avatar_data_url,
        instructions: instructions.to_owned(),
        parallelism: optional_positive(definition, "parallelism")?,
        idle_timeout_seconds: optional_positive(definition, "idleTimeoutSeconds")?,
        max_turn_duration_seconds: optional_positive(definition, "maxTurnDurationSeconds")?,
        source_is_builtin: definition
            .get("sourceIsBuiltin")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        omitted,
        reply_policy,
        trigger_defaults,
        memory_policy,
        capability_requirements,
    })
}

/// `data:image/<png|jpeg|gif|webp>;base64,...` 的解码字节数；其他 URL 不是内联头像。
fn inline_image(url: &str) -> Option<usize> {
    let rest = url.strip_prefix("data:")?;
    let (header, data) = rest.split_once(',')?;
    let mime = header.strip_suffix(";base64")?;
    if !matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return None;
    }
    base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .ok()
        .map(|bytes| bytes.len())
}

/// 导入预览（`AgentSnapshotImportPreview` 的映射字段部分）。
pub(crate) fn preview_fields(snapshot: &Snapshot) -> Value {
    let mut view = json!({
        "displayName": snapshot.display_name,
        "instructions": snapshot.instructions,
        "sourceIsBuiltIn": snapshot.source_is_builtin,
        "omitted": snapshot.omitted,
    });
    for (key, value) in [
        ("description", snapshot.description.clone().map(Value::from)),
        (
            "avatarDataUrl",
            snapshot.avatar_data_url.clone().map(Value::from),
        ),
        ("parallelism", snapshot.parallelism.map(Value::from)),
        (
            "idleTimeoutSeconds",
            snapshot.idle_timeout_seconds.map(Value::from),
        ),
        (
            "maxTurnDurationSeconds",
            snapshot.max_turn_duration_seconds.map(Value::from),
        ),
    ] {
        if let Some(value) = value {
            view[key] = value;
        }
    }
    view
}

/// DD-131(2) 原版映射到新 DRAFT 内容。运行时与路由由导入人重选（DD-26）；回复策略取包的
/// Kailo 扩展（须在所选 Profile 登记），否则取 Profile 首个线程回复策略，即原版 owner-only 默认；
/// 时限与并发按 Profile 上限收敛；Skill 与工具不带入，由 owner 发布前按本 Tenant 目录重选。
pub(crate) fn content(
    snapshot: &Snapshot,
    profile: &contracts::RuntimeProfileDirectoryProfilesItem,
    route: &str,
) -> Result<contracts::AgentVersionContent, Refusal> {
    let c = &profile.capability_contract;
    let mappings = c.reply_policy_mappings.as_deref().unwrap_or_default();
    let registered = |key: &str| {
        c.reply_policies.iter().any(|p| p == key) && mappings.iter().any(|m| m.key == key)
    };
    let reply = snapshot
        .reply_policy
        .clone()
        .filter(|key| registered(key))
        .or_else(|| {
            c.reply_policies
                .iter()
                .find(|key| {
                    mappings
                        .iter()
                        .any(|m| &m.key == *key && m.thread_replies && !m.broadcast_replies)
                })
                .cloned()
        })
        .ok_or(Refusal::Blocked(ReasonCode::CapabilityBlocked))?;
    let clamp = |requested: Option<i64>, max: i64| requested.unwrap_or(max).clamp(1, max.max(1));
    let max_turn = clamp(
        snapshot.max_turn_duration_seconds,
        c.max_turn_duration_seconds,
    );
    let idle = clamp(snapshot.idle_timeout_seconds, c.max_idle_timeout_seconds).min(max_turn);
    let mut persona = json!({"displayName": snapshot.display_name});
    if let Some(description) = &snapshot.description {
        persona["description"] = json!(description);
    }
    let requirements: Vec<&String> = snapshot
        .capability_requirements
        .iter()
        .filter(|key| c.capability_requirements.contains(key))
        .collect();
    let value = json!({
        "personaIdentity": persona,
        "instructions": snapshot.instructions,
        "runtimeProfileKey": profile.key,
        "modelRouteResourceId": route,
        "skillVersionAssetIds": [],
        "declaredToolResourceIds": [],
        "capabilityRequirements": requirements,
        "triggerDefaults": snapshot.trigger_defaults.clone().unwrap_or_else(|| json!(["MENTION"])),
        "replyPolicy": reply,
        "parallelism": snapshot.parallelism.unwrap_or(1).clamp(1, c.max_parallelism.max(1)),
        "turnLimits": {"idleTimeoutSeconds": idle, "maxTurnDurationSeconds": max_turn},
        "memoryPolicy": snapshot.memory_policy.clone()
            .unwrap_or_else(|| json!({"coreWrite": "HUMAN_ONLY", "coldWrite": "DISABLED"})),
    });
    serde_json::from_value(value).map_err(|_| invalid())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Value {
        json!({
            "format": "buzz-agent-snapshot", "version": 1,
            "definition": {"name": "Writer", "sourceIsBuiltin": false, "systemPrompt": "Write release notes.\n",
                "runtime": "codex", "model": "gpt", "provider": "openai", "parallelism": 2,
                "respondTo": "allowlist", "respondToAllowlist": ["ab".repeat(32)], "namePool": ["Ada"],
                "idleTimeoutSeconds": 300, "maxTurnDurationSeconds": 1200},
            "profile": {"displayName": "Writer", "about": "Drafts notes"},
            "memory": {"level": "core", "entries": [{"slug": "core", "body": "secret"}]}
        })
    }

    fn png(chunks: &[(&[u8], Vec<u8>)]) -> Vec<u8> {
        let mut out = PNG_SIGNATURE.to_vec();
        for (kind, data) in chunks {
            out.extend((data.len() as u32).to_be_bytes());
            let mut body = kind.to_vec();
            body.extend(data);
            out.extend(&body);
            out.extend(crc32(&body).to_be_bytes());
        }
        out
    }

    fn card(text: &[u8]) -> Vec<u8> {
        let mut chunk = PNG_CHUNK_KEYWORD.to_vec();
        chunk.push(0);
        chunk.extend(text);
        png(&[
            (b"IHDR", vec![0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]),
            (b"tEXt", chunk),
            (b"IDAT", vec![0]),
            (b"IEND", Vec::new()),
        ])
    }

    #[test]
    fn crc_matches_the_png_reference_vector() {
        assert_eq!(crc32(b"IEND"), 0xae42_6082);
    }

    #[test]
    fn json_and_png_carry_the_same_manifest_and_drop_non_portable_fields() {
        let bytes = serde_json::to_vec(&manifest()).unwrap();
        let from_json = decode(&bytes, MediaType::Json).unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let from_png = decode(&card(encoded.as_bytes()), MediaType::Png).unwrap();
        assert_eq!(from_json, from_png);
        assert_eq!(from_json.instructions, "Write release notes.\n");
        assert_eq!(from_json.description.as_deref(), Some("Drafts notes"));
        assert_eq!(
            from_json.omitted,
            vec![
                "RUNTIME",
                "MODEL",
                "PROVIDER",
                "NAME_POOL",
                "RESPOND_TO_ALLOWLIST",
                "MEMORY"
            ]
        );
        let preview = preview_fields(&from_json).to_string();
        assert!(!preview.contains("secret") && !preview.contains(&"ab".repeat(32)));
    }

    #[test]
    fn rejects_other_versions_locked_cards_zip_and_oversize() {
        let mut v2 = manifest();
        v2["version"] = json!(2);
        assert!(decode(&serde_json::to_vec(&v2).unwrap(), MediaType::Json).is_err());
        let locked = json!({"format": "buzz-agent-snapshot-locked", "version": 1});
        assert!(decode(&serde_json::to_vec(&locked).unwrap(), MediaType::Json).is_err());
        assert!(decode(b"PK\x03\x04", MediaType::Json).is_err());
        let mut hidden = manifest();
        hidden["definition"]["systemPrompt"] = json!("ok\u{202E}evil");
        assert!(decode(&serde_json::to_vec(&hidden).unwrap(), MediaType::Json).is_err());
        let big = vec![b' '; MAX_JSON_BYTES + 1];
        assert!(matches!(
            decode(&big, MediaType::Json),
            Err(Refusal::Precondition(ReasonCode::PayloadTooLarge))
        ));
        // Altered bytes fail the chunk CRC rather than yielding a partial manifest.
        let bytes = serde_json::to_vec(&manifest()).unwrap();
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let mut tampered = card(encoded.as_bytes());
        let at = tampered.len() - 20;
        tampered[at] ^= 1;
        assert!(decode(&tampered, MediaType::Png).is_err());
    }

    #[test]
    fn content_maps_to_profile_limits_and_default_reply_policy() {
        let snapshot = decode(&serde_json::to_vec(&manifest()).unwrap(), MediaType::Json).unwrap();
        let profile: contracts::RuntimeProfileDirectoryProfilesItem = serde_json::from_value(json!({
            "key": "server-codex", "kind": "SERVER_CODEX", "status": "ACTIVE", "webAvailability": "ENABLED",
            "capabilityContract": {"capabilityRequirements": [], "maxIdleTimeoutSeconds": 120,
                "maxParallelism": 1, "maxTurnDurationSeconds": 600,
                "replyPolicies": ["broadcast", "thread"],
                "replyPolicyMappings": [{"key": "broadcast", "threadReplies": false, "broadcastReplies": true},
                    {"key": "thread", "threadReplies": true, "broadcastReplies": false}]}
        }))
        .unwrap();
        let route = uuid::Uuid::new_v4().to_string();
        let content = content(&snapshot, &profile, &route).unwrap();
        assert_eq!(content.reply_policy, "thread");
        assert_eq!(content.parallelism, 1);
        assert_eq!(content.turn_limits.idle_timeout_seconds, 120);
        assert_eq!(content.turn_limits.max_turn_duration_seconds, 600);
        assert!(content.skill_version_asset_ids.is_empty());
        assert!(content.persona_identity.avatar_url.is_none());
        assert!(crate::agent_version::content(&content).is_ok());
    }
}
