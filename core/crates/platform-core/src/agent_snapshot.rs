//! DD-131(2)(3)(4)(5)、SF-BUZ-60(2)：`buzz-agent-snapshot@1` 与 `buzz-team-snapshot@1`
//! 包的编码与解码。纯函数，不读库、不访问 Relay。
//!
//! 清单形状沿 Buzz `779af8886caae1317b4de962082429867ab61503`
//! `desktop/src-tauri/src/managed_agents/agent_snapshot.rs::AgentSnapshot` 与
//! `team_snapshot.rs::TeamSnapshot`：JSON 为原版 `.agent.json`/`.team.json`，PNG 把同一清单
//! base64 后放入 `buzz_agent_snapshot`/`buzz_team_snapshot` tEXt 块。Kailo 导出的包仍是原版
//! 可读的 v1 清单；原版没有的 Kailo 可移植字段（回复策略、触发默认值、记忆写模式、能力需求）
//! 放在原版解码器会忽略的 `kailo` 扩展段。
//!
//! DD-131 的映射：systemPrompt→instructions；显示名、说明、内联头像→personaIdentity；
//! parallelism 原样；空闲与单轮时限→turnLimits。respondTo allowlist/anyone、runtime/model/
//! provider、namePool、sessionPolicy、记忆与团队 instructions 丢弃并在预览中列出；不写也不读
//! 任何 owner、公钥、Relay 地址、SecretRef 或本机命令。

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Map, Value};

pub(crate) const AGENT_FORMAT: &str = "buzz-agent-snapshot";
pub(crate) const TEAM_FORMAT: &str = "buzz-team-snapshot";
/// 原版锁定卡的 NIP-44 信封（DD-131(5) 排除：解锁需要 Agent 私钥）。
const LOCKED_FORMAT: &str = "buzz-agent-snapshot-encrypted";
pub(crate) const AGENT_KEYWORD: &str = "buzz_agent_snapshot";
pub(crate) const TEAM_KEYWORD: &str = "buzz_team_snapshot";
pub(crate) const FORMAT_VERSION: u64 = 1;
/// 原版 `commands/personas/snapshot/import.rs::{MAX_SNAPSHOT_JSON_BYTES,MAX_SNAPSHOT_PNG_BYTES}`。
pub(crate) const MAX_AGENT_JSON_BYTES: usize = 5 * 1024 * 1024;
pub(crate) const MAX_AGENT_PNG_BYTES: usize = 10 * 1024 * 1024;
/// 原版 `commands/team_snapshot.rs::{MAX_TEAM_SNAPSHOT_JSON_BYTES,MAX_TEAM_SNAPSHOT_PNG_BYTES}`。
pub(crate) const MAX_TEAM_JSON_BYTES: usize = 25 * 1024 * 1024;
pub(crate) const MAX_TEAM_PNG_BYTES: usize = 50 * 1024 * 1024;
/// 原版 `agent_snapshot.rs::MAX_AVATAR_INLINE_BYTES`。
pub(crate) const MAX_AVATAR_INLINE_BYTES: usize = 2 * 1024 * 1024;
/// 原版团队目录 `managed_agents/team_catalog.rs::MAX_MEMBERS`，也是 AgentTeam 的成员上限。
pub(crate) const MAX_TEAM_MEMBERS: usize = 64;
/// 原版 `managed_agents/definition_validation.rs` 的人工复核文本上界。
const MAX_DISPLAY_NAME_CHARS: usize = 128;
const MAX_INSTRUCTIONS_BYTES: usize = 64 * 1024;
const MAX_DESCRIPTION_CHARS: usize = 280;
const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    Agent,
    Team,
}

impl Kind {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Agent => "AGENT",
            Self::Team => "TEAM",
        }
    }

    pub(crate) fn format_key(self) -> &'static str {
        match self {
            Self::Agent => AGENT_FORMAT,
            Self::Team => TEAM_FORMAT,
        }
    }

    fn keyword(self) -> &'static str {
        match self {
            Self::Agent => AGENT_KEYWORD,
            Self::Team => TEAM_KEYWORD,
        }
    }

    fn file_suffix(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Team => "team",
        }
    }

    pub(crate) fn max_bytes(self, encoding: Encoding) -> usize {
        match (self, encoding) {
            (Self::Agent, Encoding::Json) => MAX_AGENT_JSON_BYTES,
            (Self::Agent, Encoding::Png) => MAX_AGENT_PNG_BYTES,
            (Self::Team, Encoding::Json) => MAX_TEAM_JSON_BYTES,
            (Self::Team, Encoding::Png) => MAX_TEAM_PNG_BYTES,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Encoding {
    Json,
    Png,
}

impl Encoding {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::Json => "JSON",
            Self::Png => "PNG",
        }
    }

    pub(crate) fn from_wire(value: &str) -> Option<Self> {
        match value {
            "JSON" => Some(Self::Json),
            "PNG" => Some(Self::Png),
            _ => None,
        }
    }

    pub(crate) fn media_type(self) -> &'static str {
        match self {
            Self::Json => "application/json",
            Self::Png => "image/png",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Png => "png",
        }
    }
}

/// 原版文件名 `<slug>.agent.json` 等；非 ASCII 字母数字一律折成 `-`。
pub(crate) fn file_name(kind: Kind, encoding: Encoding, name: &str) -> String {
    let mut stem: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    while stem.contains("--") {
        stem = stem.replace("--", "-");
    }
    let stem = stem.trim_matches('-');
    let stem = if stem.is_empty() {
        kind.file_suffix()
    } else {
        stem
    };
    let stem: String = stem.chars().take(64).collect();
    format!("{stem}.{}.{}", kind.file_suffix(), encoding.extension())
}

/// DD-131(2)–(4) 预览中被丢弃的原版字段，取值即契约 `AgentSnapshotDiscardedField`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Discarded {
    RespondToAllowlist,
    RespondToAnyone,
    Runtime,
    Model,
    Provider,
    NamePool,
    SessionPolicy,
    Memory,
    TeamInstructions,
    AvatarReference,
    Skills,
    CapabilityRequirements,
}

impl Discarded {
    pub(crate) fn wire(self) -> &'static str {
        match self {
            Self::RespondToAllowlist => "RESPOND_TO_ALLOWLIST",
            Self::RespondToAnyone => "RESPOND_TO_ANYONE",
            Self::Runtime => "RUNTIME",
            Self::Model => "MODEL",
            Self::Provider => "PROVIDER",
            Self::NamePool => "NAME_POOL",
            Self::SessionPolicy => "SESSION_POLICY",
            Self::Memory => "MEMORY",
            Self::TeamInstructions => "TEAM_INSTRUCTIONS",
            Self::AvatarReference => "AVATAR_REFERENCE",
            Self::Skills => "SKILLS",
            Self::CapabilityRequirements => "CAPABILITY_REQUIREMENTS",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Avatar {
    pub mime: String,
    pub bytes: Vec<u8>,
}

impl Avatar {
    pub(crate) fn data_url(&self) -> String {
        format!("data:{};base64,{}", self.mime, STANDARD.encode(&self.bytes))
    }
}

/// 一个成员按 DD-131(2) 映射后的可移植内容。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Member {
    pub display_name: String,
    pub description: Option<String>,
    pub avatar: Option<Avatar>,
    pub instructions: String,
    pub parallelism: Option<i64>,
    pub idle_timeout_seconds: Option<i64>,
    pub max_turn_duration_seconds: Option<i64>,
    pub reply_policy: Option<String>,
    pub trigger_defaults: Option<Vec<String>>,
    pub core_write: Option<String>,
    pub cold_write: Option<String>,
    pub capability_requirements: Vec<String>,
    pub discarded: Vec<Discarded>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TeamMeta {
    pub name: String,
    pub description: Option<String>,
    pub discarded: Vec<Discarded>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Decoded {
    pub kind: Kind,
    pub encoding: Encoding,
    pub team: Option<TeamMeta>,
    pub members: Vec<Member>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DecodeError {
    /// 超过原版对该类包与编码的字节上界：`PAYLOAD_TOO_LARGE`
    TooLarge,
    /// 不是 v1 包、旧 `.persona.*`、zip、锁定卡或清单字段非法：`INVALID_PARAMETERS`
    Invalid,
}

/// 解码一份上传的包字节。`file_name` 只用于拒绝原版已拒绝的旧 `.persona.*` 与 zip 命名。
pub(crate) fn decode(bytes: &[u8], file_name: Option<&str>) -> Result<Decoded, DecodeError> {
    if let Some(name) = file_name.map(str::to_ascii_lowercase) {
        // 原版 `snapshot/import.rs::reject_legacy_persona_filename`；v1 没有 zip（v2 才有）。
        if name.ends_with(".persona.json")
            || name.ends_with(".persona.png")
            || name.ends_with(".zip")
        {
            return Err(DecodeError::Invalid);
        }
    }
    if bytes.is_empty() || bytes.starts_with(b"PK\x03\x04") {
        return Err(DecodeError::Invalid);
    }
    let (encoding, manifest, png_kind) = if bytes.starts_with(PNG_SIGNATURE) {
        if bytes.len() > MAX_TEAM_PNG_BYTES {
            return Err(DecodeError::TooLarge);
        }
        let (kind, text) = png_snapshot_text(bytes).ok_or(DecodeError::Invalid)?;
        let json = STANDARD
            .decode(text.trim())
            .map_err(|_| DecodeError::Invalid)?;
        (Encoding::Png, json, Some(kind))
    } else {
        if bytes.len() > MAX_TEAM_JSON_BYTES {
            return Err(DecodeError::TooLarge);
        }
        (Encoding::Json, bytes.to_vec(), None)
    };
    let value: Value = serde_json::from_slice(&manifest).map_err(|_| DecodeError::Invalid)?;
    let format = value.get("format").and_then(Value::as_str);
    let kind = match format {
        Some(AGENT_FORMAT) => Kind::Agent,
        Some(TEAM_FORMAT) => Kind::Team,
        // DD-131(5)：锁定卡需要 Agent 私钥才能解开，Kailo 不向客户端交付，整包拒绝。
        Some(LOCKED_FORMAT) => return Err(DecodeError::Invalid),
        // 旧 `{version:1,type:"team"}` 团队文件与其他 format 一律拒绝。
        _ => return Err(DecodeError::Invalid),
    };
    if png_kind.is_some_and(|k| k != kind) {
        return Err(DecodeError::Invalid);
    }
    if bytes.len() > kind.max_bytes(encoding) {
        return Err(DecodeError::TooLarge);
    }
    match kind {
        Kind::Agent => Ok(Decoded {
            kind,
            encoding,
            team: None,
            members: vec![agent_member(&value)?],
        }),
        Kind::Team => {
            if value.get("version").and_then(Value::as_u64) != Some(FORMAT_VERSION) {
                return Err(DecodeError::Invalid);
            }
            let team = value
                .get("team")
                .and_then(Value::as_object)
                .ok_or(DecodeError::Invalid)?;
            let name = text(team.get("name"))?.ok_or(DecodeError::Invalid)?;
            if name.chars().count() > 200 || !visible(&name, false) {
                return Err(DecodeError::Invalid);
            }
            let description = text(team.get("description"))?;
            if description
                .as_deref()
                .is_some_and(|d| d.chars().count() > 2000 || !visible(d, true))
            {
                return Err(DecodeError::Invalid);
            }
            let mut discarded = Vec::new();
            if text(team.get("instructions"))?.is_some() {
                discarded.push(Discarded::TeamInstructions);
            }
            let members = value
                .get("members")
                .and_then(Value::as_array)
                .ok_or(DecodeError::Invalid)?;
            if members.len() > MAX_TEAM_MEMBERS {
                return Err(DecodeError::Invalid);
            }
            // 任一成员非法即整包拒绝（DD-131(3)：任一成员失败整包不提交）。
            let members = members
                .iter()
                .map(agent_member)
                .collect::<Result<Vec<_>, _>>()?;
            Ok(Decoded {
                kind,
                encoding,
                team: Some(TeamMeta {
                    name,
                    description,
                    discarded,
                }),
                members,
            })
        }
    }
}

fn text(value: Option<&Value>) -> Result<Option<String>, DecodeError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let s = s.trim();
            Ok((!s.is_empty()).then(|| s.to_owned()))
        }
        Some(_) => Err(DecodeError::Invalid),
    }
}

fn positive(value: Option<&Value>) -> Result<Option<i64>, DecodeError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(v) => {
            let n = v.as_u64().ok_or(DecodeError::Invalid)?;
            if n == 0 {
                return Ok(None);
            }
            i64::try_from(n).map(Some).map_err(|_| DecodeError::Invalid)
        }
    }
}

/// 原版 `definition_validation.rs::validate_visible_text`：控制字符与不可见格式字符拒绝而
/// 不剥离；只有 instructions 允许换行与制表符，emoji 的 ZWJ 与 VS16 保留。
fn visible(value: &str, layout: bool) -> bool {
    value.chars().all(|c| {
        if layout && matches!(c, '\n' | '\t') {
            return true;
        }
        if c.is_control() {
            return false;
        }
        !matches!(c,
            '\u{00AD}' | '\u{034F}' | '\u{061C}' | '\u{115F}' | '\u{1160}' | '\u{17B4}' | '\u{17B5}'
            | '\u{180B}'..='\u{180F}' | '\u{200B}' | '\u{200C}' | '\u{200E}' | '\u{200F}'
            | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{206F}' | '\u{3164}'
            | '\u{FE00}'..='\u{FE0E}' | '\u{FEFF}' | '\u{FFA0}' | '\u{FFF0}'..='\u{FFF8}')
    })
}

fn agent_member(value: &Value) -> Result<Member, DecodeError> {
    let object = value.as_object().ok_or(DecodeError::Invalid)?;
    match object.get("format").and_then(Value::as_str) {
        Some(AGENT_FORMAT) => {}
        _ => return Err(DecodeError::Invalid),
    }
    if object.get("version").and_then(Value::as_u64) != Some(FORMAT_VERSION) {
        return Err(DecodeError::Invalid);
    }
    let definition = object
        .get("definition")
        .and_then(Value::as_object)
        .ok_or(DecodeError::Invalid)?;
    let profile = object
        .get("profile")
        .and_then(Value::as_object)
        .ok_or(DecodeError::Invalid)?;
    // 原版 validate_snapshot：definition.name 与 profile.displayName 都必填。
    text(definition.get("name"))?.ok_or(DecodeError::Invalid)?;
    let display_name = text(profile.get("displayName"))?.ok_or(DecodeError::Invalid)?;
    if display_name.chars().count() > MAX_DISPLAY_NAME_CHARS || !visible(&display_name, false) {
        return Err(DecodeError::Invalid);
    }
    // Kailo AgentVersion 要求非空 instructions（agent_version::content）。
    let instructions = text(definition.get("systemPrompt"))?.ok_or(DecodeError::Invalid)?;
    if instructions.len() > MAX_INSTRUCTIONS_BYTES || !visible(&instructions, true) {
        return Err(DecodeError::Invalid);
    }
    let description = text(profile.get("about"))?;
    if description
        .as_deref()
        .is_some_and(|d| d.chars().count() > MAX_DESCRIPTION_CHARS || !visible(d, false))
    {
        return Err(DecodeError::Invalid);
    }
    let mut discarded = Vec::new();
    match definition.get("respondTo") {
        None | Some(Value::Null) => {}
        Some(Value::String(mode)) => match mode.as_str() {
            "owner-only" => {}
            "allowlist" => discarded.push(Discarded::RespondToAllowlist),
            "anyone" => discarded.push(Discarded::RespondToAnyone),
            _ => return Err(DecodeError::Invalid),
        },
        Some(_) => return Err(DecodeError::Invalid),
    }
    if non_empty_array(definition.get("respondToAllowlist"))? {
        discarded.push(Discarded::RespondToAllowlist);
    }
    for (key, field) in [
        ("runtime", Discarded::Runtime),
        ("model", Discarded::Model),
        ("provider", Discarded::Provider),
    ] {
        if text(definition.get(key))?.is_some() {
            discarded.push(field);
        }
    }
    if non_empty_array(definition.get("namePool"))? {
        discarded.push(Discarded::NamePool);
    }
    if definition
        .get("sessionPolicy")
        .is_some_and(|v| !v.is_null())
    {
        discarded.push(Discarded::SessionPolicy);
    }
    // 原版不变式：level none 而带条目是畸形包；任何记忆都按 DD-131(4) 丢弃。
    if let Some(memory) = object.get("memory").filter(|m| !m.is_null()) {
        let memory = memory.as_object().ok_or(DecodeError::Invalid)?;
        let level = memory
            .get("level")
            .and_then(Value::as_str)
            .unwrap_or("none");
        let entries = non_empty_array(memory.get("entries"))?;
        match level {
            "none" if entries => return Err(DecodeError::Invalid),
            "none" => {}
            "core" | "everything" => discarded.push(Discarded::Memory),
            _ => return Err(DecodeError::Invalid),
        }
    }
    let avatar = match profile.get("avatarDataUrl") {
        None | Some(Value::Null) => None,
        Some(Value::String(url)) => {
            let parsed = parse_data_url(url);
            if parsed.is_none() {
                discarded.push(Discarded::AvatarReference);
            }
            parsed
        }
        Some(_) => return Err(DecodeError::Invalid),
    };
    if text(profile.get("avatarUrl"))?.is_some() {
        discarded.push(Discarded::AvatarReference);
    }
    let mut member = Member {
        display_name,
        description,
        avatar,
        instructions,
        parallelism: positive(definition.get("parallelism"))?,
        idle_timeout_seconds: positive(definition.get("idleTimeoutSeconds"))?,
        max_turn_duration_seconds: positive(definition.get("maxTurnDurationSeconds"))?,
        ..Member::default()
    };
    if let Some(extension) = object.get("kailo").filter(|v| !v.is_null()) {
        kailo_extension(extension, &mut member, &mut discarded)?;
    }
    discarded.sort();
    discarded.dedup();
    member.discarded = discarded;
    Ok(member)
}

fn non_empty_array(value: Option<&Value>) -> Result<bool, DecodeError> {
    match value {
        None | Some(Value::Null) => Ok(false),
        Some(Value::Array(items)) => Ok(!items.is_empty()),
        Some(_) => Err(DecodeError::Invalid),
    }
}

fn kailo_extension(
    value: &Value,
    member: &mut Member,
    discarded: &mut Vec<Discarded>,
) -> Result<(), DecodeError> {
    let object = value.as_object().ok_or(DecodeError::Invalid)?;
    member.reply_policy = text(object.get("replyPolicy"))?;
    if let Some(triggers) = object.get("triggerDefaults").filter(|v| !v.is_null()) {
        let mut out = Vec::new();
        for trigger in triggers.as_array().ok_or(DecodeError::Invalid)? {
            match trigger.as_str() {
                Some(t @ ("MENTION" | "MANUAL_ASSIGNMENT")) if !out.iter().any(|o| o == t) => {
                    out.push(t.to_owned())
                }
                _ => return Err(DecodeError::Invalid),
            }
        }
        member.trigger_defaults = Some(out);
    }
    if let Some(policy) = object.get("memoryPolicy").filter(|v| !v.is_null()) {
        let policy = policy.as_object().ok_or(DecodeError::Invalid)?;
        member.core_write = match policy.get("coreWrite").and_then(Value::as_str) {
            Some(v @ ("HUMAN_ONLY" | "AGENT_WITH_APPROVAL")) => Some(v.to_owned()),
            _ => return Err(DecodeError::Invalid),
        };
        member.cold_write = match policy.get("coldWrite").and_then(Value::as_str) {
            Some(v @ ("DISABLED" | "INVOCATION_SCOPED")) => Some(v.to_owned()),
            _ => return Err(DecodeError::Invalid),
        };
    }
    if let Some(requirements) = object
        .get("capabilityRequirements")
        .filter(|v| !v.is_null())
    {
        for requirement in requirements.as_array().ok_or(DecodeError::Invalid)? {
            let key = requirement.as_str().ok_or(DecodeError::Invalid)?;
            let valid = key
                .rsplit_once('@')
                .is_some_and(|(name, version)| !name.is_empty() && !version.trim().is_empty());
            if !valid || member.capability_requirements.iter().any(|k| k == key) {
                return Err(DecodeError::Invalid);
            }
            member.capability_requirements.push(key.to_owned());
        }
    }
    // Skill 尚无本 Tenant 可引用的 producer：来源 slug 与 digest 只能丢弃并提示重选。
    if non_empty_array(object.get("skills"))? {
        discarded.push(Discarded::Skills);
    }
    Ok(())
}

fn image_mime(bytes: &[u8]) -> Option<&'static str> {
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

/// 只接受 ≤2 MiB、MIME 与字节魔数一致的内联图片 data URL；其余按头像引用丢弃。
fn parse_data_url(url: &str) -> Option<Avatar> {
    let rest = url.strip_prefix("data:")?;
    let (header, payload) = rest.split_once(',')?;
    let mime = header.strip_suffix(";base64")?;
    if payload.len() > MAX_AVATAR_INLINE_BYTES.div_ceil(3) * 4 + 4 {
        return None;
    }
    let bytes = STANDARD.decode(payload.trim()).ok()?;
    let detected = image_mime(&bytes)?;
    (bytes.len() <= MAX_AVATAR_INLINE_BYTES && detected == mime).then(|| Avatar {
        mime: detected.to_owned(),
        bytes,
    })
}

/// 头像字节是否可内联（导出侧）：≤2 MiB 且魔数是四种图片之一。
pub(crate) fn inline_avatar(bytes: Vec<u8>) -> Option<Avatar> {
    let mime = image_mime(&bytes)?;
    (bytes.len() <= MAX_AVATAR_INLINE_BYTES).then(|| Avatar {
        mime: mime.to_owned(),
        bytes,
    })
}

// ---------------------------------------------------------------------------
// 编码
// ---------------------------------------------------------------------------

/// 一个成员的原版 v1 清单。respondTo 固定为原版默认 owner-only：使用权是 Installation 上
/// 的逐成员授权（05 §2.10），不导出名单；memory.level 固定 none（DD-131(4)）。
pub(crate) fn agent_manifest(member: &Member) -> Value {
    let mut definition = Map::new();
    definition.insert("name".into(), json!(member.display_name));
    definition.insert("systemPrompt".into(), json!(member.instructions));
    if let Some(n) = member.parallelism {
        definition.insert("parallelism".into(), json!(n));
    }
    definition.insert("respondTo".into(), json!("owner-only"));
    if let Some(n) = member.idle_timeout_seconds {
        definition.insert("idleTimeoutSeconds".into(), json!(n));
    }
    if let Some(n) = member.max_turn_duration_seconds {
        definition.insert("maxTurnDurationSeconds".into(), json!(n));
    }
    let mut profile = Map::new();
    profile.insert("displayName".into(), json!(member.display_name));
    if let Some(about) = &member.description {
        profile.insert("about".into(), json!(about));
    }
    if let Some(avatar) = &member.avatar {
        profile.insert("avatarDataUrl".into(), json!(avatar.data_url()));
    }
    let mut kailo = Map::new();
    if let Some(policy) = &member.reply_policy {
        kailo.insert("replyPolicy".into(), json!(policy));
    }
    if let Some(triggers) = &member.trigger_defaults {
        kailo.insert("triggerDefaults".into(), json!(triggers));
    }
    if let (Some(core), Some(cold)) = (&member.core_write, &member.cold_write) {
        kailo.insert(
            "memoryPolicy".into(),
            json!({"coreWrite": core, "coldWrite": cold}),
        );
    }
    if !member.capability_requirements.is_empty() {
        kailo.insert(
            "capabilityRequirements".into(),
            json!(member.capability_requirements),
        );
    }
    let mut manifest = Map::new();
    manifest.insert("format".into(), json!(AGENT_FORMAT));
    manifest.insert("version".into(), json!(FORMAT_VERSION));
    manifest.insert("definition".into(), Value::Object(definition));
    manifest.insert("profile".into(), Value::Object(profile));
    manifest.insert("memory".into(), json!({"level": "none"}));
    if !kailo.is_empty() {
        manifest.insert("kailo".into(), Value::Object(kailo));
    }
    Value::Object(manifest)
}

/// 团队 v1 清单：原版 `team{name,description,instructions}` 中 instructions 按 DD-131(1) 不写。
pub(crate) fn team_manifest(name: &str, description: Option<&str>, members: &[Member]) -> Value {
    let mut team = Map::new();
    team.insert("name".into(), json!(name));
    if let Some(description) = description {
        team.insert("description".into(), json!(description));
    }
    json!({
        "format": TEAM_FORMAT,
        "version": FORMAT_VERSION,
        "team": Value::Object(team),
        "members": members.iter().map(agent_manifest).collect::<Vec<_>>(),
    })
}

/// 包字节：JSON 为原版 `to_vec_pretty`；PNG 以头像（PNG 时）或 1×1 透明占位为图像体，
/// 清单 base64 放入 IHDR 之后的 tEXt 块（原版解码器只读 IDAT 之前的文本块）。
pub(crate) fn encode(
    kind: Kind,
    encoding: Encoding,
    manifest: &Value,
    body: Option<&[u8]>,
) -> Result<Vec<u8>, DecodeError> {
    let json = serde_json::to_vec_pretty(manifest).map_err(|_| DecodeError::Invalid)?;
    let bytes = match encoding {
        Encoding::Json => json,
        Encoding::Png => {
            let text = STANDARD.encode(&json);
            // 原版以头像为图像体；Kailo 只在头像本身是完整 PNG 时沿用，其余用占位图。
            let avatar = body.filter(|b| kind == Kind::Agent && png_chunks(b).is_some());
            match avatar.map(|b| inject_text_chunk(b, kind.keyword(), &text)) {
                Some(Ok(png)) => png,
                _ => inject_text_chunk(&placeholder_png(), kind.keyword(), &text)
                    .map_err(|_| DecodeError::Invalid)?,
            }
        }
    };
    if bytes.len() > kind.max_bytes(encoding) {
        return Err(DecodeError::TooLarge);
    }
    Ok(bytes)
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &byte in bytes {
        crc ^= u32::from(byte);
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

fn adler32(bytes: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for &byte in bytes {
        a = (a + u32::from(byte)) % 65_521;
        b = (b + a) % 65_521;
    }
    (b << 16) | a
}

fn chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 12);
    out.extend_from_slice(&u32::try_from(data.len()).unwrap_or(u32::MAX).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    let mut crc_input = kind.to_vec();
    crc_input.extend_from_slice(data);
    out.extend_from_slice(&crc32(&crc_input).to_be_bytes());
    out
}

/// 原版 `make_png_with_text` 的 1×1 透明 RGBA 图像体（zlib stored 块，无压缩依赖）。
fn placeholder_png() -> Vec<u8> {
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&1u32.to_be_bytes());
    ihdr.extend_from_slice(&1u32.to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    // 一行：filter 0 + RGBA 四字节。
    let raw = [0u8, 0, 0, 0, 0];
    let mut zlib = vec![0x78, 0x01, 0x01];
    zlib.extend_from_slice(&u16::try_from(raw.len()).unwrap_or(0).to_le_bytes());
    zlib.extend_from_slice(&(!u16::try_from(raw.len()).unwrap_or(0)).to_le_bytes());
    zlib.extend_from_slice(&raw);
    zlib.extend_from_slice(&adler32(&raw).to_be_bytes());
    let mut png = PNG_SIGNATURE.to_vec();
    png.extend(chunk(b"IHDR", &ihdr));
    png.extend(chunk(b"IDAT", &zlib));
    png.extend(chunk(b"IEND", &[]));
    png
}

/// PNG 的 (类型, 数据) 序列；任何长度或 CRC 不符都视为非法。
fn png_chunks(bytes: &[u8]) -> Option<Vec<([u8; 4], &[u8])>> {
    let mut rest = bytes.strip_prefix(PNG_SIGNATURE)?;
    let mut out = Vec::new();
    loop {
        if rest.len() < 12 {
            return None;
        }
        let len = usize::try_from(u32::from_be_bytes(rest[..4].try_into().ok()?)).ok()?;
        let end = len.checked_add(12)?;
        if end > rest.len() {
            return None;
        }
        let kind: [u8; 4] = rest[4..8].try_into().ok()?;
        let data = &rest[8..8 + len];
        let crc = u32::from_be_bytes(rest[8 + len..end].try_into().ok()?);
        if crc32(&rest[4..8 + len]) != crc {
            return None;
        }
        out.push((kind, data));
        rest = &rest[end..];
        if &kind == b"IEND" {
            return Some(out);
        }
    }
}

/// 第一个快照 tEXt 块（IDAT 之前）：返回包类型与 base64 正文。
fn png_snapshot_text(bytes: &[u8]) -> Option<(Kind, String)> {
    for (kind, data) in png_chunks(bytes)? {
        if &kind == b"IDAT" {
            return None;
        }
        if &kind != b"tEXt" {
            continue;
        }
        let split = data.iter().position(|b| *b == 0)?;
        let (keyword, text) = (&data[..split], &data[split + 1..]);
        let snapshot = match keyword {
            k if k == AGENT_KEYWORD.as_bytes() => Kind::Agent,
            k if k == TEAM_KEYWORD.as_bytes() => Kind::Team,
            _ => continue,
        };
        // tEXt 是 Latin-1；base64 只含 ASCII。
        let text = std::str::from_utf8(text).ok()?;
        return Some((snapshot, text.to_owned()));
    }
    None
}

/// 把快照 tEXt 块插在 IHDR 之后；源图已有的同名快照块先移除。
fn inject_text_chunk(png: &[u8], keyword: &str, text: &str) -> Result<Vec<u8>, ()> {
    let chunks = png_chunks(png).ok_or(())?;
    let (first, rest) = chunks.split_first().ok_or(())?;
    if &first.0 != b"IHDR" {
        return Err(());
    }
    let mut payload = keyword.as_bytes().to_vec();
    payload.push(0);
    payload.extend_from_slice(text.as_bytes());
    let mut out = PNG_SIGNATURE.to_vec();
    out.extend(chunk(&first.0, first.1));
    out.extend(chunk(b"tEXt", &payload));
    for (kind, data) in rest {
        let snapshot = kind == b"tEXt"
            && [AGENT_KEYWORD, TEAM_KEYWORD].iter().any(|k| {
                data.len() > k.len() && &data[..k.len()] == k.as_bytes() && data[k.len()] == 0
            });
        if !snapshot {
            out.extend(chunk(kind, data));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn original_agent() -> Value {
        // 原版 build_snapshot 的典型输出：allowlist、runtime/model 与 core 记忆。
        json!({
            "format": "buzz-agent-snapshot",
            "version": 1,
            "definition": {
                "name": "Researcher",
                "sourceIsBuiltin": false,
                "systemPrompt": "Summarize the sources.",
                "runtime": "codex",
                "model": "gpt-5",
                "provider": "openai",
                "parallelism": 2,
                "sessionPolicy": "thread",
                "respondTo": "allowlist",
                "respondToAllowlist": ["aa".repeat(32)],
                "namePool": ["Ada"],
                "idleTimeoutSeconds": 600,
                "maxTurnDurationSeconds": 1800
            },
            "profile": {"displayName": "Researcher", "about": "Reads papers"},
            "memory": {"level": "core", "entries": [{"slug": "core", "body": "secret"}]}
        })
    }

    #[test]
    fn original_agent_json_maps_portable_fields_and_lists_discards() {
        let bytes = serde_json::to_vec_pretty(&original_agent()).unwrap();
        let decoded = decode(&bytes, Some("researcher.agent.json")).unwrap();
        assert_eq!(decoded.kind, Kind::Agent);
        assert_eq!(decoded.encoding, Encoding::Json);
        let member = &decoded.members[0];
        assert_eq!(member.display_name, "Researcher");
        assert_eq!(member.instructions, "Summarize the sources.");
        assert_eq!(member.description.as_deref(), Some("Reads papers"));
        assert_eq!(member.parallelism, Some(2));
        assert_eq!(member.idle_timeout_seconds, Some(600));
        assert_eq!(member.max_turn_duration_seconds, Some(1800));
        assert_eq!(
            member.discarded,
            vec![
                Discarded::RespondToAllowlist,
                Discarded::Runtime,
                Discarded::Model,
                Discarded::Provider,
                Discarded::NamePool,
                Discarded::SessionPolicy,
                Discarded::Memory,
            ]
        );
        // 名单公钥与记忆正文不进入任何映射结果。
        let debug = format!("{member:?}");
        assert!(!debug.contains(&"aa".repeat(32)) && !debug.contains("secret"));
    }

    #[test]
    fn png_round_trip_keeps_manifest_and_same_bytes_decode_twice() {
        let member = Member {
            display_name: "Editor".into(),
            instructions: "Tighten the draft.".into(),
            reply_policy: Some("thread".into()),
            trigger_defaults: Some(vec!["MENTION".into()]),
            core_write: Some("HUMAN_ONLY".into()),
            cold_write: Some("DISABLED".into()),
            ..Member::default()
        };
        let manifest = agent_manifest(&member);
        let png = encode(Kind::Agent, Encoding::Png, &manifest, None).unwrap();
        assert!(png.starts_with(PNG_SIGNATURE));
        assert!(png_chunks(&png).is_some());
        let first = decode(&png, Some("editor.agent.png")).unwrap();
        let second = decode(&png, Some("editor.agent.png")).unwrap();
        assert_eq!(first, second);
        assert_eq!(first.encoding, Encoding::Png);
        assert_eq!(first.members[0], member);
    }

    #[test]
    fn avatar_png_is_the_image_body_and_round_trips_inline() {
        let avatar = placeholder_png();
        let member = Member {
            display_name: "A".into(),
            instructions: "x".into(),
            avatar: inline_avatar(avatar.clone()),
            ..Member::default()
        };
        let manifest = agent_manifest(&member);
        let png = encode(Kind::Agent, Encoding::Png, &manifest, Some(&avatar)).unwrap();
        let decoded = decode(&png, None).unwrap();
        assert_eq!(decoded.members[0].avatar.as_ref().unwrap().bytes, avatar);
        assert_eq!(decoded.members[0].discarded, Vec::<Discarded>::new());
    }

    #[test]
    fn export_manifest_has_no_identity_secret_or_memory_fields() {
        let member = Member {
            display_name: "A".into(),
            instructions: "x".into(),
            ..Member::default()
        };
        let text = serde_json::to_string(&agent_manifest(&member)).unwrap();
        for forbidden in [
            "respondToAllowlist",
            "pubkey",
            "ownerPrincipal",
            "secret",
            "relay",
            "runtime",
            "model",
            "entries",
            "env",
        ] {
            assert!(!text.contains(forbidden), "{forbidden} in {text}");
        }
        assert!(text.contains("\"level\":\"none\""));
    }

    #[test]
    fn limits_legacy_zip_and_locked_cards_are_rejected() {
        let mut big = original_agent();
        big["definition"]["systemPrompt"] = json!("x");
        big["profile"]["about"] = json!("y");
        let mut bytes = serde_json::to_vec(&big).unwrap();
        bytes.extend(std::iter::repeat_n(b' ', 6 * 1024 * 1024));
        assert_eq!(decode(&bytes, None), Err(DecodeError::TooLarge));
        let ok = serde_json::to_vec(&original_agent()).unwrap();
        assert_eq!(
            decode(&ok, Some("old.persona.json")),
            Err(DecodeError::Invalid)
        );
        assert_eq!(decode(b"PK\x03\x04rest", None), Err(DecodeError::Invalid));
        let locked = json!({"format": LOCKED_FORMAT, "version": 1});
        assert_eq!(
            decode(&serde_json::to_vec(&locked).unwrap(), None),
            Err(DecodeError::Invalid)
        );
        let mut v2 = original_agent();
        v2["version"] = json!(2);
        assert_eq!(
            decode(&serde_json::to_vec(&v2).unwrap(), None),
            Err(DecodeError::Invalid)
        );
        let legacy_team = json!({"version": 1, "type": "team", "name": "x"});
        assert_eq!(
            decode(&serde_json::to_vec(&legacy_team).unwrap(), None),
            Err(DecodeError::Invalid)
        );
    }

    #[test]
    fn team_rejects_whole_package_when_any_member_is_invalid() {
        let mut bad = original_agent();
        bad["profile"]["displayName"] = json!("");
        let team = json!({
            "format": TEAM_FORMAT,
            "version": 1,
            "team": {"name": "Crew", "instructions": "be nice"},
            "members": [original_agent(), original_agent(), bad],
        });
        assert_eq!(
            decode(&serde_json::to_vec(&team).unwrap(), None),
            Err(DecodeError::Invalid)
        );
        let mut good = team.clone();
        good["members"] = json!([original_agent(), original_agent()]);
        let decoded = decode(&serde_json::to_vec(&good).unwrap(), Some("crew.team.json")).unwrap();
        assert_eq!(decoded.kind, Kind::Team);
        assert_eq!(decoded.members.len(), 2);
        assert_eq!(
            decoded.team.unwrap().discarded,
            vec![Discarded::TeamInstructions]
        );
    }

    #[test]
    fn team_png_and_export_omit_team_instructions() {
        let member = Member {
            display_name: "A".into(),
            instructions: "x".into(),
            ..Member::default()
        };
        let manifest = team_manifest("Crew", Some("desc"), &[member.clone(), member]);
        assert!(!manifest.to_string().contains("instructions\":"));
        let png = encode(Kind::Team, Encoding::Png, &manifest, None).unwrap();
        let decoded = decode(&png, Some("crew.team.png")).unwrap();
        assert_eq!(decoded.kind, Kind::Team);
        assert_eq!(decoded.members.len(), 2);
        assert_eq!(decoded.team.unwrap().description.as_deref(), Some("desc"));
    }

    #[test]
    fn invisible_text_and_bad_avatars_follow_original_validation() {
        let mut v = original_agent();
        v["profile"]["displayName"] = json!("Re\u{200B}searcher");
        assert_eq!(
            decode(&serde_json::to_vec(&v).unwrap(), None),
            Err(DecodeError::Invalid)
        );
        let mut v = original_agent();
        v["profile"]["avatarDataUrl"] = json!("data:image/png;base64,bm90IGEgcG5n");
        let decoded = decode(&serde_json::to_vec(&v).unwrap(), None).unwrap();
        assert!(decoded.members[0].avatar.is_none());
        assert!(decoded.members[0]
            .discarded
            .contains(&Discarded::AvatarReference));
    }

    #[test]
    fn file_names_follow_original_suffixes() {
        assert_eq!(
            file_name(Kind::Agent, Encoding::Png, "Research Bot!"),
            "research-bot.agent.png"
        );
        assert_eq!(
            file_name(Kind::Team, Encoding::Json, "研究"),
            "team.team.json"
        );
    }
}
