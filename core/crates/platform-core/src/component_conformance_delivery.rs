//! 一致性投递候选集合（DD-136(2)，2026-10-24 修订）：运行目录的一致性投递目录
//! （`COMPONENT_CONFORMANCE_DIR`）下每个候选是以其 artifactDigest 命名的子目录，
//! `PROTOCOL_PEER` 候选只含 `environment.json`，`REMOTE_ADAPTER` 候选另含
//! `fixture.json` 与 `identity.json`。消费方只按被登记 release 的 adapter digest
//! 选取候选，每次使用时读取；没有该候选即 `CAPABILITY_BLOCKED`，因此多个候选并存、
//! 互不替换，也不存在“当前候选”。目录以只读方式挂载，写入只经发布入口与组件部署入口。

use std::path::PathBuf;

use contracts::ReasonCode;

use crate::governance::Refusal;

pub(crate) const DIRECTORY_ENV: &str = "COMPONENT_CONFORMANCE_DIR";
pub(crate) const ENVIRONMENT: &str = "environment.json";
pub(crate) const FIXTURE: &str = "fixture.json";
pub(crate) const IDENTITY: &str = "identity.json";

fn blocked() -> Refusal {
    Refusal::Blocked(ReasonCode::CapabilityBlocked)
}

/// release 的 adapter digest 是 64 位小写十六进制；其他形状不可能有候选。
fn digest_ok(artifact: &str) -> bool {
    artifact.len() == 64
        && artifact
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

fn candidate_in(root: Option<&str>, artifact: &str) -> Result<PathBuf, Refusal> {
    let root = root
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(blocked)?;
    if !digest_ok(artifact) {
        return Err(blocked());
    }
    let root = PathBuf::from(root);
    if !root.is_absolute() {
        return Err(blocked());
    }
    let candidate = root.join(artifact);
    if !candidate.is_dir() {
        return Err(blocked());
    }
    Ok(candidate)
}

/// 该 artifact 的候选目录；未投递目录或没有该候选时为 `CAPABILITY_BLOCKED`。
pub(crate) fn candidate(artifact: &str) -> Result<PathBuf, Refusal> {
    candidate_in(std::env::var(DIRECTORY_ENV).ok().as_deref(), artifact)
}

/// 读取候选中的一份文件。候选存在而文件缺失或不可读是投递不完整，
/// 与原单文件投递一样报告不可用，不猜默认值。
pub(crate) fn read(artifact: &str, name: &str) -> Result<Vec<u8>, Refusal> {
    let path = candidate(artifact)?.join(name);
    if !path.exists() {
        return Err(blocked());
    }
    std::fs::read(path).map_err(|_| Refusal::Unavailable(format!("conformance {name} unavailable")))
}

/// 向导用：该 digest 的 `PROTOCOL_PEER` 候选是否就绪（文件存在、可解析、digest 一致）。
pub(crate) fn peer_ready(artifact: &str) -> bool {
    read(artifact, ENVIRONMENT)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .is_some_and(|value| {
            value.get("artifactDigest").and_then(|v| v.as_str()) == Some(artifact)
                && value.get("mcpUrl").is_some()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidates_are_selected_by_digest_and_coexist() {
        let root = std::env::temp_dir().join(format!("conformance-{}", uuid::Uuid::new_v4()));
        let peer = "a".repeat(64);
        let adapter = "b".repeat(64);
        for digest in [&peer, &adapter] {
            std::fs::create_dir_all(root.join(digest)).unwrap();
        }
        let text = root.to_str().unwrap();
        assert_eq!(candidate_in(Some(text), &peer).unwrap(), root.join(&peer));
        assert_eq!(
            candidate_in(Some(text), &adapter).unwrap(),
            root.join(&adapter)
        );
        // Missing candidate, missing directory delivery, malformed digest and a
        // relative root are all CAPABILITY_BLOCKED, never another candidate.
        for (root, artifact) in [
            (Some(text), "c".repeat(64)),
            (None, peer.clone()),
            (Some(""), peer.clone()),
            (Some(text), "../".to_string() + &peer),
            (Some(text), peer.to_uppercase()),
            (Some("relative"), peer.clone()),
        ] {
            assert!(matches!(
                candidate_in(root, &artifact),
                Err(Refusal::Blocked(ReasonCode::CapabilityBlocked))
            ));
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
