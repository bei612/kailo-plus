//! DD-131(3)、05 §2.12：`buzz-team-snapshot@1` 包的 Core 解码、原版映射与清单编码。
//!
//! 团队包是原版 `team_snapshot.rs` 的清单：团队名与说明加 `members` 数组，每个成员就是一份
//! `buzz-agent-snapshot` v1 清单（DD-131(2) 映射）。`.team.json` 是清单本身，`.team.png` 在
//! tEXt `buzz_team_snapshot` 中以 base64 承载同一清单，图像体是 1×1 占位（团队没有头像）。
//! 团队 instructions 按 DD-131(1) 不进入包也不导入；包不携带可信的 Tenant、owner 或来源 ID。

use std::collections::HashSet;

use contracts::ReasonCode;
use serde_json::{json, Value};

use crate::agent_snapshot::{self, MediaType, Snapshot};
use crate::governance::Refusal;

pub(crate) const FORMAT_KEY: &str = "buzz-team-snapshot@1";
pub(crate) const RESOURCE_TYPE: &str = "agent.team";
const FORMAT_DISCRIMINATOR: &str = "buzz-team-snapshot";
pub(crate) const PNG_KEYWORD: &str = "buzz_team_snapshot";
/// 原版上限：`.team.json` 25 MiB、`.team.png` 50 MiB。
pub(crate) const MAX_JSON_BYTES: usize = 25 * 1024 * 1024;
pub(crate) const MAX_PNG_BYTES: usize = 50 * 1024 * 1024;
/// 03 §7：团队至多 64 个成员；空团队不是可导入的包。
pub(crate) const MAX_MEMBERS: usize = crate::governance::agent_team::MAX_TEAM_MEMBERS;
const MAX_NAME_CHARS: usize = 200;
const MAX_DESCRIPTION_CHARS: usize = 2000;
/// 由显示名生成的成员 slug 基干长度上限（去重序号另计）。
const MAX_SLUG_BASE_CHARS: usize = 48;

pub(crate) fn limit(media: MediaType) -> usize {
    match media {
        MediaType::Json => MAX_JSON_BYTES,
        MediaType::Png => MAX_PNG_BYTES,
    }
}

fn invalid() -> Refusal {
    Refusal::Precondition(ReasonCode::InvalidParameters)
}

fn too_large() -> Refusal {
    Refusal::Precondition(ReasonCode::PayloadTooLarge)
}

/// 映射后的团队包。
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct TeamSnapshot {
    pub name: String,
    pub description: Option<String>,
    /// 包内带有原版团队 instructions（不导入，预览中说明）。
    pub instructions_omitted: bool,
    pub members: Vec<Snapshot>,
}

/// 解码一个团队包。v1 以外的格式、旧扁平 `.team.json`、zip 与空团队一律 `INVALID_PARAMETERS`。
pub(crate) fn decode(bytes: &[u8], media: MediaType) -> Result<TeamSnapshot, Refusal> {
    if bytes.is_empty() {
        return Err(invalid());
    }
    if bytes.len() > limit(media) {
        return Err(too_large());
    }
    let manifest = match media {
        MediaType::Json => {
            if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                return Err(invalid());
            }
            bytes.to_vec()
        }
        MediaType::Png => agent_snapshot::png_text(bytes, PNG_KEYWORD.as_bytes())?,
    };
    if manifest.len() > MAX_JSON_BYTES {
        return Err(too_large());
    }
    let value: Value = serde_json::from_slice(&manifest).map_err(|_| invalid())?;
    map(&value)
}

fn map(value: &Value) -> Result<TeamSnapshot, Refusal> {
    if value.get("format").and_then(Value::as_str) != Some(FORMAT_DISCRIMINATOR)
        || value.get("version").and_then(Value::as_u64) != Some(1)
    {
        return Err(invalid());
    }
    let team = value
        .get("team")
        .filter(|v| v.is_object())
        .ok_or_else(invalid)?;
    let name = team
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .ok_or_else(invalid)?;
    if name.is_empty()
        || name.chars().count() > MAX_NAME_CHARS
        || !agent_snapshot::visible(name, false)
    {
        return Err(invalid());
    }
    let description = match team.get("description") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.trim()).filter(|s| !s.is_empty()),
        Some(_) => return Err(invalid()),
    };
    if description.is_some_and(|d| {
        d.chars().count() > MAX_DESCRIPTION_CHARS || !agent_snapshot::visible(d, true)
    }) {
        return Err(invalid());
    }
    let instructions_omitted = match team.get("instructions") {
        None | Some(Value::Null) => false,
        Some(Value::String(s)) => !s.trim().is_empty(),
        Some(_) => return Err(invalid()),
    };
    let members = value
        .get("members")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    if members.is_empty() || members.len() > MAX_MEMBERS {
        return Err(invalid());
    }
    let members = members
        .iter()
        .map(agent_snapshot::map)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(TeamSnapshot {
        name: name.to_owned(),
        description: description.map(str::to_owned),
        instructions_omitted,
        members,
    })
}

/// 导入预览中团队的映射字段（`AgentTeamSnapshotImportPreview` 的团队与成员部分）。
/// `avatar_urls[i]` 是第 i 个成员已暂存的头像对象地址。
pub(crate) fn preview_fields(team: &TeamSnapshot, avatar_urls: &[Option<String>]) -> Value {
    let members: Vec<Value> = team
        .members
        .iter()
        .enumerate()
        .map(|(i, m)| {
            let mut member = json!({
                "displayName": m.display_name,
                "instructions": m.instructions,
                "omitted": m.omitted,
            });
            if let Some(description) = &m.description {
                member["description"] = json!(description);
            }
            // 与单个 Agent 预览相同：只有已暂存为媒体对象的头像才同时给出包内字节供预览显示。
            if let (Some(Some(url)), Some(data_url)) = (avatar_urls.get(i), &m.avatar_data_url) {
                member["avatarUrl"] = json!(url);
                member["avatarDataUrl"] = json!(data_url);
            }
            member
        })
        .collect();
    let mut view = json!({
        "name": team.name,
        "teamInstructionsOmitted": team.instructions_omitted,
        "members": members,
    });
    if let Some(description) = &team.description {
        view["description"] = json!(description);
    }
    view
}

/// 成员 slug 基干：显示名小写化后只留 ASCII 字母数字，其余连续字符折成一个 `-`；
/// 没有可用字符时退回 `agent`。结果满足 `valid_slug`。
pub(crate) fn slug_base(display_name: &str) -> String {
    let mut slug = String::new();
    for c in display_name.chars().flat_map(char::to_lowercase) {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if slug.len() >= MAX_SLUG_BASE_CHARS {
                break;
            }
            slug.push(c);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug = slug.trim_end_matches('-');
    if slug.is_empty() {
        "agent".to_owned()
    } else {
        slug.to_owned()
    }
}

/// DD-131(3)：按成员次序为每个成员分配 slug；与本 Tenant 已有 slug 或前面成员相同时
/// 加序号 `-2`、`-3`… 去重。
pub(crate) fn assign_slugs(display_names: &[&str], taken: &HashSet<String>) -> Vec<String> {
    let mut used: HashSet<String> = HashSet::new();
    display_names
        .iter()
        .map(|name| {
            let base = slug_base(name);
            let mut candidate = base.clone();
            let mut n = 2u32;
            while taken.contains(&candidate) || used.contains(&candidate) {
                candidate = format!("{base}-{n}");
                n += 1;
            }
            used.insert(candidate.clone());
            candidate
        })
        .collect()
}

/// DD-131(3) 的 `buzz-team-snapshot@1` 清单：团队名与说明加各成员的 DD-131(2) 清单
/// （由 `snapshot_package::agent_manifest` 生成）；不含团队 instructions、owner 或任何 ID。
pub(crate) fn team_manifest(name: &str, description: Option<&str>, members: Vec<Value>) -> Value {
    let mut team = json!({"name": name});
    if let Some(description) = description.filter(|d| !d.trim().is_empty()) {
        team["description"] = json!(description);
    }
    json!({
        "format": FORMAT_DISCRIMINATOR,
        "version": 1,
        "team": team,
        "members": members,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn member(name: &str) -> Value {
        json!({"format": "buzz-agent-snapshot", "version": 1,
            "definition": {"name": name, "systemPrompt": format!("Be {name}.")},
            "profile": {"displayName": name}, "memory": {"level": "none"}})
    }

    fn team(members: Vec<Value>) -> Value {
        team_manifest("Release crew", Some("Ships notes."), members)
    }

    #[test]
    fn json_and_png_round_trip_through_the_original_layout() {
        let manifest = team(vec![member("Writer"), member("Reviewer")]);
        let bytes = serde_json::to_vec_pretty(&manifest).unwrap();
        let decoded = decode(&bytes, MediaType::Json).unwrap();
        assert_eq!(decoded.name, "Release crew");
        assert_eq!(decoded.description.as_deref(), Some("Ships notes."));
        assert!(!decoded.instructions_omitted);
        assert_eq!(
            decoded
                .members
                .iter()
                .map(|m| m.display_name.as_str())
                .collect::<Vec<_>>(),
            ["Writer", "Reviewer"]
        );
        let png = crate::snapshot_package::png_with_manifest(PNG_KEYWORD, &bytes, None);
        assert_eq!(decode(&png, MediaType::Png).unwrap(), decoded);
        // The agent keyword is not the team keyword: an agent card is not a team package.
        let agent_png = crate::snapshot_package::png_with_manifest(
            crate::snapshot_package::AGENT_PNG_KEYWORD,
            &bytes,
            None,
        );
        assert!(decode(&agent_png, MediaType::Png).is_err());
    }

    #[test]
    fn rejects_other_formats_empty_teams_and_bad_members() {
        let mut wrong = team(vec![member("Writer")]);
        wrong["format"] = json!("buzz-agent-snapshot");
        assert!(decode(&serde_json::to_vec(&wrong).unwrap(), MediaType::Json).is_err());
        let mut v2 = team(vec![member("Writer")]);
        v2["version"] = json!(2);
        assert!(decode(&serde_json::to_vec(&v2).unwrap(), MediaType::Json).is_err());
        // Old flat `.team.json` (no discriminator).
        let legacy = json!({"version": 1, "type": "team", "name": "Old", "members": []});
        assert!(decode(&serde_json::to_vec(&legacy).unwrap(), MediaType::Json).is_err());
        let empty = team(vec![]);
        assert!(decode(&serde_json::to_vec(&empty).unwrap(), MediaType::Json).is_err());
        let too_many = team((0..65).map(|i| member(&format!("A{i}"))).collect());
        assert!(decode(&serde_json::to_vec(&too_many).unwrap(), MediaType::Json).is_err());
        let mut bad_member = member("Writer");
        bad_member["profile"]["displayName"] = json!("");
        let bad = team(vec![member("Ok"), bad_member]);
        assert!(decode(&serde_json::to_vec(&bad).unwrap(), MediaType::Json).is_err());
        let mut hidden = team(vec![member("Writer")]);
        hidden["team"]["name"] = json!("Crew\u{200B}");
        assert!(decode(&serde_json::to_vec(&hidden).unwrap(), MediaType::Json).is_err());
        assert!(decode(b"PK\x03\x04", MediaType::Json).is_err());
    }

    #[test]
    fn team_instructions_are_noted_but_never_imported() {
        let mut manifest = team(vec![member("Writer")]);
        manifest["team"]["instructions"] = json!("Coordinate releases.");
        let decoded = decode(&serde_json::to_vec(&manifest).unwrap(), MediaType::Json).unwrap();
        assert!(decoded.instructions_omitted);
        let view = preview_fields(&decoded, &[]);
        assert_eq!(view["teamInstructionsOmitted"], true);
        assert!(!view.to_string().contains("Coordinate releases."));
    }

    #[test]
    fn limits_follow_the_original_team_caps() {
        assert_eq!(limit(MediaType::Json), 25 * 1024 * 1024);
        assert_eq!(limit(MediaType::Png), 50 * 1024 * 1024);
        let huge = vec![b' '; MAX_JSON_BYTES + 1];
        assert!(matches!(
            decode(&huge, MediaType::Json),
            Err(Refusal::Precondition(ReasonCode::PayloadTooLarge))
        ));
    }

    #[test]
    fn member_slugs_are_derived_and_deduplicated_within_the_tenant() {
        assert_eq!(slug_base("Release Writer!"), "release-writer");
        assert_eq!(slug_base("  --Ünïcode 2  "), "n-code-2");
        assert_eq!(slug_base("发布助手"), "agent");
        assert!(crate::governance::valid_slug(&slug_base(&"x".repeat(200))));
        let taken: HashSet<String> = ["writer".to_owned(), "writer-2".to_owned()].into();
        assert_eq!(
            assign_slugs(&["Writer", "Writer", "Reviewer", "发布"], &taken),
            ["writer-3", "writer-4", "reviewer", "agent"]
        );
        for slug in assign_slugs(&["Writer", "Writer"], &taken) {
            assert!(crate::governance::valid_slug(&slug));
        }
    }

    #[test]
    fn preview_lists_members_in_order_with_staged_avatars() {
        let avatar = "data:image/png;base64,iVBORw0KGgo=";
        let mut reviewer = member("Reviewer");
        reviewer["profile"]["avatarDataUrl"] = json!(avatar);
        let mut editor = member("Editor");
        editor["profile"]["avatarDataUrl"] = json!(avatar);
        let decoded = decode(
            &serde_json::to_vec(&team(vec![member("Writer"), reviewer, editor])).unwrap(),
            MediaType::Json,
        )
        .unwrap();
        let view = preview_fields(
            &decoded,
            &[None, Some("https://h.test/media/abc.png".to_owned()), None],
        );
        assert_eq!(view["members"][0]["displayName"], "Writer");
        assert!(view["members"][0].get("avatarUrl").is_none());
        assert!(view["members"][0].get("avatarDataUrl").is_none());
        assert_eq!(
            view["members"][1]["avatarUrl"],
            "https://h.test/media/abc.png"
        );
        // The preview shows the package's own bytes only for an avatar that was staged.
        assert_eq!(view["members"][1]["avatarDataUrl"], avatar);
        assert!(view["members"][2].get("avatarUrl").is_none());
        assert!(view["members"][2].get("avatarDataUrl").is_none());
        assert_eq!(view["description"], "Ships notes.");
    }
}
