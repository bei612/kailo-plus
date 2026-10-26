//! DD-81/160: original event time admission and the narrow merged-status receipt.
use nostr::{Event, PublicKey};
use serde::{Deserialize, Serialize};

/// Original Relay event timestamp drift limit, shared by ingest and the writer fence.
pub const MAX_TIMESTAMP_DRIFT_SECS: u64 = 900;

/// The original symmetric Relay timestamp admission, without integer wrapping.
pub fn timestamp_admitted(created_at: u64, now: i64) -> bool {
    u64::try_from(now).is_ok_and(|now| created_at.abs_diff(now) <= MAX_TIMESTAMP_DRIFT_SECS)
}

/// A past timestamp is strictly beyond the original acceptance window.
pub fn timestamp_settled(created_at: u64, now: i64) -> bool {
    u64::try_from(now).is_ok_and(|now| {
        created_at
            .checked_add(MAX_TIMESTAMP_DRIFT_SECS)
            .is_some_and(|until| now > until)
    })
}

/// Metadata-only observation of the authoritative event row, including soft deletion.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergedStatusDelivery {
    /// Exact original signed event identifier.
    pub event_id: String,
    /// Immutable Community that served the writer observation.
    pub community_id: String,
    /// The exact event is stored, including a soft-deleted row.
    pub accepted: bool,
    /// Same writer fence proved that a missing old request can no longer commit.
    pub settled: bool,
}

/// Validate the one supported signed publication and return its owner repo name.
/// No other author, content, expiration, URL or query filter is a receipt request.
pub fn merged_status_repository<'a>(
    event: &'a Event,
    caller: &PublicKey,
) -> Result<&'a str, &'static str> {
    if event.kind.as_u16() != 1631
        || event.pubkey != *caller
        || !event.content.is_empty()
        || event.verify().is_err()
    {
        return Err("invalid merged status proof");
    }
    if event
        .tags
        .iter()
        .any(|tag| tag.as_slice().first().is_some_and(|s| s == "expiration"))
    {
        return Err("expiring publication is not observable");
    }
    let mut coordinates = event
        .tags
        .iter()
        .filter(|t| t.as_slice().first().is_some_and(|s| s == "a"));
    let coordinate = coordinates
        .next()
        .ok_or("missing repository coordinate")?
        .as_slice();
    if coordinate.len() != 2 || coordinates.next().is_some() {
        return Err("ambiguous repository coordinate");
    }
    let prefix = format!("30617:{}:", caller.to_hex());
    let repo = coordinate[1]
        .strip_prefix(&prefix)
        .ok_or("publication author is not repository owner")?;
    if repo.is_empty()
        || repo.len() > 64
        || repo.starts_with('.')
        || repo.contains("..")
        || repo.ends_with(".git")
        || !repo
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'))
    {
        return Err("invalid repository coordinate");
    }
    Ok(repo)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
    #[test]
    fn original_timestamp_window_has_no_wrap_or_early_settle() {
        assert!(timestamp_admitted(1000, 100));
        assert!(timestamp_admitted(100, 1000));
        assert!(!timestamp_settled(100, 1000));
        assert!(timestamp_settled(100, 1001));
        assert!(!timestamp_admitted(100, 1001));
        assert!(!timestamp_admitted(u64::MAX, 0));
        assert!(!timestamp_settled(u64::MAX, 0));
        assert!(!timestamp_admitted(0, -1));
    }
    #[test]
    fn delivery_proof_is_only_the_callers_immutable_owner_status() {
        let owner = Keys::generate();
        let other = Keys::generate();
        let coordinate = format!("30617:{}:repo", owner.public_key());
        let build = |kind, content: &str, tags: Vec<Tag>| {
            EventBuilder::new(Kind::Custom(kind), content)
                .tags(tags)
                .custom_created_at(Timestamp::from(100))
                .sign_with_keys(&owner)
                .unwrap()
        };
        let a = Tag::parse(["a", &coordinate]).unwrap();
        let good = build(1631, "", vec![a.clone()]);
        assert_eq!(
            merged_status_repository(&good, &owner.public_key()),
            Ok("repo")
        );
        assert!(merged_status_repository(&good, &other.public_key()).is_err());
        for event in [
            build(1632, "", vec![a.clone()]),
            build(1631, "body", vec![a.clone()]),
            build(1631, "", vec![a.clone(), a.clone()]),
            build(
                1631,
                "",
                vec![a, Tag::parse(["expiration", "200"]).unwrap()],
            ),
            build(
                1631,
                "",
                vec![Tag::parse(["a", &format!("30617:{}:repo", other.public_key())]).unwrap()],
            ),
        ] {
            assert!(merged_status_repository(&event, &owner.public_key()).is_err());
        }
        let encoded = serde_json::to_value(MergedStatusDelivery {
            event_id: good.id.to_hex(),
            community_id: "scope".into(),
            accepted: true,
            settled: false,
        })
        .unwrap();
        assert_eq!(encoded.as_object().unwrap().len(), 4);
        let mut extra = encoded;
        extra["content"] = serde_json::json!("secret");
        assert!(serde_json::from_value::<MergedStatusDelivery>(extra).is_err());
    }
}
