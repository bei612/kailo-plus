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
/// 不选 RuntimeProfile 时的单轮时限缺省，即原版 `buzz-acp/src/config.rs`
/// `DEFAULT_IDLE_TIMEOUT_SECS` / `DEFAULT_MAX_TURN_DURATION_SECS`；发布时按所选 Profile 上限校验。
const DEFAULT_IDLE_TIMEOUT_SECONDS: i64 = 1_500;
const DEFAULT_MAX_TURN_DURATION_SECONDS: i64 = 7_200;

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
        MediaType::Png => png_text(bytes, PNG_CHUNK_KEYWORD)?,
    };
    if manifest.len() > MAX_JSON_BYTES {
        return Err(too_large());
    }
    let value: Value = serde_json::from_slice(&manifest).map_err(|_| invalid())?;
    map(&value)
}

/// PNG 结构逐块核对（签名、长度、CRC、IHDR 在首、IEND 在尾），只读 IDAT 之前名为 `keyword`
/// 的 tEXt（Agent 为 `buzz_agent_snapshot`、团队为 `buzz_team_snapshot`），与原版 `png` 解码器
/// `read_info` 可见的文本块一致。
pub(crate) fn png_text(bytes: &[u8], keyword: &[u8]) -> Result<Vec<u8>, Refusal> {
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
                if &data[..split] == keyword {
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
pub(crate) fn visible(value: &str, layout: bool) -> bool {
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

/// 一个 `buzz-agent-snapshot` v1 清单的 DD-131(2) 映射；团队快照的每个成员即此清单（DD-131(3)）。
pub(crate) fn map(value: &Value) -> Result<Snapshot, Refusal> {
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
    // DD-131(2)：没有提示词的包与原版一样可以导入，得到空指令的 DRAFT，补充后才能发布。
    if instructions.len() > MAX_SYSTEM_PROMPT_BYTES
        || (!instructions.is_empty() && !visible(instructions, true))
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
            let (_, bytes) = inline_image(url).ok_or_else(invalid)?;
            if bytes.len() > MAX_AVATAR_INLINE_BYTES {
                return Err(too_large());
            }
            Some(url.to_owned())
        }
        None => None,
    };
    // 内联头像按 (7) 附件规则导入；只引用外部地址的头像不跟随（来源 Community 的媒体不可读）。
    if avatar_data_url.is_none() && optional_text(profile, "avatarUrl")?.is_some() {
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

/// `data:image/<png|jpeg|gif|webp>;base64,...` 的 MIME 与解码字节；其他 URL 不是内联头像。
fn inline_image(url: &str) -> Option<(&str, Vec<u8>)> {
    let rest = url.strip_prefix("data:")?;
    let (header, data) = rest.split_once(',')?;
    let mime = header.strip_suffix(";base64")?;
    if !matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp"
    ) {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .ok()?;
    (!bytes.is_empty()).then_some((mime, bytes))
}

/// 包内联头像的 MIME、字节与字节 SHA-256（DD-131(2)、(7)）：上传为本 Tenant 媒体对象前与
/// Workflow 推进时各取一次，以摘要确认两次是同一份头像。
pub(crate) struct InlineAvatar {
    pub mime: String,
    pub bytes: Vec<u8>,
    pub digest: String,
}

pub(crate) fn inline_avatar(snapshot: &Snapshot) -> Option<InlineAvatar> {
    let (mime, bytes) = inline_image(snapshot.avatar_data_url.as_deref()?)?;
    Some(InlineAvatar {
        mime: mime.to_owned(),
        digest: sha256_hex(&bytes),
        bytes,
    })
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

/// DD-131(2) 原版映射到新 DRAFT 内容。导入时不强制选择运行配置（DD-26，与原版一致）：
/// 选了 Profile 时，回复策略取包的 Kailo 扩展（须在该 Profile 登记），否则取 Profile 首个线程
/// 回复策略，即原版 owner-only 默认，时限与并发按 Profile 上限收敛，能力需求只保留其合同声明的；
/// 未选 Profile 时回复策略缺省，时限取包值或原版缺省，能力需求原样保留，发布时再按所选 Profile
/// 校验。Route 缺省同理。`avatar_url` 是内联头像已存入本 Tenant 的媒体对象地址。
/// Skill 与工具不带入，由 owner 发布前按本 Tenant 目录重选。
pub(crate) fn content(
    snapshot: &Snapshot,
    profile: Option<&contracts::RuntimeProfileDirectoryProfilesItem>,
    route: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<contracts::AgentVersionContent, Refusal> {
    let mut persona = json!({"displayName": snapshot.display_name});
    if let Some(description) = &snapshot.description {
        persona["description"] = json!(description);
    }
    if let Some(url) = avatar_url {
        persona["avatarUrl"] = json!(url);
    }
    let mut value = json!({
        "personaIdentity": persona,
        "instructions": snapshot.instructions,
        "skillVersionAssetIds": [],
        "declaredToolResourceIds": [],
        "triggerDefaults": snapshot.trigger_defaults.clone().unwrap_or_else(|| json!(["MENTION"])),
        "memoryPolicy": snapshot.memory_policy.clone()
            .unwrap_or_else(|| json!({"coreWrite": "HUMAN_ONLY", "coldWrite": "DISABLED"})),
    });
    if let Some(route) = route {
        value["modelRouteResourceId"] = json!(route);
    }
    match profile {
        Some(profile) => {
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
            let clamp =
                |requested: Option<i64>, max: i64| requested.unwrap_or(max).clamp(1, max.max(1));
            let max_turn = clamp(
                snapshot.max_turn_duration_seconds,
                c.max_turn_duration_seconds,
            );
            let idle =
                clamp(snapshot.idle_timeout_seconds, c.max_idle_timeout_seconds).min(max_turn);
            let requirements: Vec<&String> = snapshot
                .capability_requirements
                .iter()
                .filter(|key| c.capability_requirements.contains(key))
                .collect();
            value["runtimeProfileKey"] = json!(profile.key);
            value["replyPolicy"] = json!(reply);
            value["capabilityRequirements"] = json!(requirements);
            value["parallelism"] = json!(snapshot
                .parallelism
                .unwrap_or(1)
                .clamp(1, c.max_parallelism.max(1)));
            value["turnLimits"] =
                json!({"idleTimeoutSeconds": idle, "maxTurnDurationSeconds": max_turn});
        }
        None => {
            let max_turn = snapshot
                .max_turn_duration_seconds
                .unwrap_or(DEFAULT_MAX_TURN_DURATION_SECONDS)
                .max(1);
            let idle = snapshot
                .idle_timeout_seconds
                .unwrap_or(DEFAULT_IDLE_TIMEOUT_SECONDS)
                .clamp(1, max_turn);
            value["capabilityRequirements"] = json!(snapshot.capability_requirements);
            value["parallelism"] = json!(snapshot.parallelism.unwrap_or(1).max(1));
            value["turnLimits"] =
                json!({"idleTimeoutSeconds": idle, "maxTurnDurationSeconds": max_turn});
        }
    }
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
        let content = content(&snapshot, Some(&profile), Some(&route), None).unwrap();
        assert_eq!(content.reply_policy.as_deref(), Some("thread"));
        assert_eq!(content.parallelism, 1);
        assert_eq!(content.turn_limits.idle_timeout_seconds, 120);
        assert_eq!(content.turn_limits.max_turn_duration_seconds, 600);
        assert!(content.skill_version_asset_ids.is_empty());
        assert!(content.persona_identity.avatar_url.is_none());
        assert!(crate::agent_version::content(&content).is_ok());
        assert!(crate::agent_version::complete(&content).is_ok());
    }

    #[test]
    fn draft_without_runtime_route_or_prompt_is_valid_but_not_publishable() {
        // DD-131(2) ruling: no forced choice at import; publish requires them.
        let mut manifest = manifest();
        manifest["definition"]
            .as_object_mut()
            .unwrap()
            .remove("systemPrompt");
        let snapshot = decode(&serde_json::to_vec(&manifest).unwrap(), MediaType::Json).unwrap();
        assert_eq!(snapshot.instructions, "");
        let draft = content(&snapshot, None, None, None).unwrap();
        assert!(draft.runtime_profile_key.is_none());
        assert!(draft.model_route_resource_id.is_none());
        assert!(draft.reply_policy.is_none());
        // Package limits survive unclamped until a Profile is chosen.
        assert_eq!(draft.parallelism, 2);
        assert_eq!(draft.turn_limits.idle_timeout_seconds, 300);
        assert_eq!(draft.turn_limits.max_turn_duration_seconds, 1200);
        let (normalized, _) = crate::agent_version::content(&draft).unwrap();
        assert!(normalized.get("runtimeProfileKey").is_none());
        assert!(normalized.get("modelRouteResourceId").is_none());
        assert!(normalized.get("replyPolicy").is_none());
        assert!(crate::agent_version::complete(&draft).is_err());
        // Even with runtime chosen, empty instructions stay unpublishable.
        let mut filled = draft.clone();
        filled.runtime_profile_key = Some("server-codex".into());
        filled.model_route_resource_id = Some(uuid::Uuid::new_v4().to_string());
        filled.reply_policy = Some("thread".into());
        assert!(crate::agent_version::complete(&filled).is_err());
        filled.instructions = "Write.".into();
        assert!(crate::agent_version::complete(&filled).is_ok());
        // Without limits in the package the original defaults apply.
        let mut bare = super::tests::manifest();
        for key in [
            "idleTimeoutSeconds",
            "maxTurnDurationSeconds",
            "parallelism",
        ] {
            bare["definition"].as_object_mut().unwrap().remove(key);
        }
        let snapshot = decode(&serde_json::to_vec(&bare).unwrap(), MediaType::Json).unwrap();
        let draft = content(&snapshot, None, None, None).unwrap();
        assert_eq!(draft.turn_limits.idle_timeout_seconds, 1_500);
        assert_eq!(draft.turn_limits.max_turn_duration_seconds, 7_200);
        assert_eq!(draft.parallelism, 1);
    }

    #[test]
    fn present_optional_fields_must_still_be_well_formed() {
        let snapshot = decode(&serde_json::to_vec(&manifest()).unwrap(), MediaType::Json).unwrap();
        let mut draft = content(&snapshot, None, None, None).unwrap();
        draft.model_route_resource_id = Some("not-a-uuid".into());
        assert!(crate::agent_version::content(&draft).is_err());
        draft.model_route_resource_id = None;
        draft.runtime_profile_key = Some("  ".into());
        assert!(crate::agent_version::content(&draft).is_err());
        draft.runtime_profile_key = None;
        draft.reply_policy = Some(String::new());
        assert!(crate::agent_version::content(&draft).is_err());
    }

    #[test]
    fn inline_avatar_is_imported_by_reference_not_omitted() {
        let png = base64::engine::general_purpose::STANDARD.encode(b"\x89PNG avatar bytes");
        let mut with_avatar = manifest();
        with_avatar["profile"]["avatarDataUrl"] = json!(format!("data:image/png;base64,{png}"));
        let snapshot = decode(&serde_json::to_vec(&with_avatar).unwrap(), MediaType::Json).unwrap();
        assert!(!snapshot.omitted.contains(&"AVATAR"));
        let avatar = inline_avatar(&snapshot).unwrap();
        assert_eq!(avatar.mime, "image/png");
        assert_eq!(avatar.bytes, b"\x89PNG avatar bytes");
        assert_eq!(avatar.digest, sha256_hex(b"\x89PNG avatar bytes"));
        let url = format!("https://buzz.example.test/media/{}.png", "a".repeat(64));
        let draft = content(&snapshot, None, None, Some(&url)).unwrap();
        assert_eq!(
            draft.persona_identity.avatar_url.as_deref(),
            Some(url.as_str())
        );
        // The version body references the object; the inline bytes never enter it.
        let (normalized, _) = crate::agent_version::content(&draft).unwrap();
        assert!(!normalized.to_string().contains("base64"));
        // An external-only avatar address cannot follow the package.
        let mut external = manifest();
        external["profile"]["avatarUrl"] = json!("https://elsewhere.test/media/x.png");
        let snapshot = decode(&serde_json::to_vec(&external).unwrap(), MediaType::Json).unwrap();
        assert!(snapshot.omitted.contains(&"AVATAR"));
        assert!(inline_avatar(&snapshot).is_none());
    }
}
