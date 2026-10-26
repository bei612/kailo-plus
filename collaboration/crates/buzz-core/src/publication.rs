//! DD-81/160: original event time admission and the narrow merged-status receipt.
use nostr::{Event, PublicKey};
use serde::{Deserialize, Serialize};

/// Original Relay event timestamp drift limit, shared by ingest and the writer fence.
pub const MAX_TIMESTAMP_DRIFT_SECS: u64 = 900;

/// Version of the writer-backed publication settlement protocol.
pub const PUBLICATION_POLICY_VERSION: u16 = 1;
/// Signed tag that ties a publication to the Community's current storage epoch.
pub const PUBLICATION_EPOCH_TAG: &str = "kailo:publication";

/// Storage bound for retained, non-replaceable publication kinds. This is
/// enforced by the database fence, independently of the 900-second ingest gate.
pub fn publication_max_age_seconds(kind: u16) -> Option<u64> {
    match kind {
        1631 => Some(MAX_TIMESTAMP_DRIFT_SECS),
        1 | 5 | 7 | 9 | 1618 | 1621 | 1630 | 1632 | 1633 | 9002 | 40003 | 45001 | 45003 => {
            Some(960)
        }
        _ => None,
    }
}

/// The database observation must be strictly later than the last admissible second.
pub fn publication_timestamp_settled(kind: u16, created_at: u64, now: i64) -> bool {
    publication_max_age_seconds(kind).is_some_and(|bound| {
        u64::try_from(now).is_ok_and(|now| {
            created_at.checked_add(bound).is_some_and(|until| now > until)
        })
    })
}

/// Parse the one canonical signed epoch tag. Old events may have no epoch;
/// malformed or duplicate tags never acquire proof authority.
pub fn publication_epoch(event: &Event) -> Result<Option<uuid::Uuid>, &'static str> {
    let mut tags = event.tags.iter().filter(|tag| {
        tag.as_slice().first().is_some_and(|name| name == PUBLICATION_EPOCH_TAG)
    });
    let Some(tag) = tags.next() else {
        return Ok(None);
    };
    let fields = tag.as_slice();
    if fields.len() != 2 || tags.next().is_some() {
        return Err("ambiguous publication epoch");
    }
    let epoch = uuid::Uuid::parse_str(&fields[1]).map_err(|_| "invalid publication epoch")?;
    if epoch.to_string() != fields[1] {
        return Err("noncanonical publication epoch");
    }
    Ok(Some(epoch))
}

/// Public signed-event metadata attested by the original Core producer. Neither
/// a message body nor the event signature is part of a settlement request.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PublicationClaim {
    /// Exact original signed event identifier.
    pub event_id: String,
    /// Immutable Community frozen before dispatch.
    pub community_id: String,
    /// Original event author, also the primary NIP-98 caller.
    pub pubkey: String,
    /// Original non-replaceable event kind.
    pub kind: u16,
    /// Original native Channel, absent for global publications.
    pub channel_id: Option<String>,
    /// Timestamp from the original signed event, not the audit clock.
    pub created_at: u64,
    /// True only when the signed event has no expiration tag.
    pub non_expiring: bool,
    /// Canonical epoch included in the original event signature.
    pub epoch: String,
}

impl PublicationClaim {
    /// Validate all public identifiers and the supported retention boundary.
    pub fn validate(&self) -> Result<(), &'static str> {
        let id = nostr::EventId::from_hex(&self.event_id).map_err(|_| "invalid event id")?;
        let author = PublicKey::from_hex(&self.pubkey).map_err(|_| "invalid event author")?;
        let canonical_uuid = |text: &str| {
            uuid::Uuid::parse_str(text).is_ok_and(|id| id.to_string() == text)
        };
        if id.to_hex() != self.event_id
            || author.to_hex() != self.pubkey
            || !canonical_uuid(&self.community_id)
            || !canonical_uuid(&self.epoch)
            || self.channel_id.as_deref().is_some_and(|id| !canonical_uuid(id))
            || i64::try_from(self.created_at).is_err()
            || publication_max_age_seconds(self.kind).is_none()
            || !self.non_expiring
        {
            return Err("publication metadata is not settlement eligible");
        }
        Ok(())
    }

    /// Match an including-deleted writer row to every frozen signed fact.
    pub fn matches_event(&self, event: &Event, channel: Option<uuid::Uuid>) -> bool {
        self.validate().is_ok()
            && event.verify().is_ok()
            && event.id.to_hex() == self.event_id
            && event.pubkey.to_hex() == self.pubkey
            && event.kind.as_u16() == self.kind
            && event.created_at.as_secs() == self.created_at
            && channel.map(|id| id.to_string()) == self.channel_id
            && !event.tags.iter().any(|tag| {
                tag.as_slice().first().is_some_and(|name| name == "expiration")
            })
            && publication_epoch(event).is_ok_and(|epoch| {
                epoch.is_some_and(|epoch| epoch.to_string() == self.epoch)
            })
    }
}

/// Actual database readiness advertised for one active Community.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PublicationPolicy {
    /// Closed protocol version supported by this producer and writer.
    pub version: u16,
    /// Current Community storage epoch.
    pub epoch: String,
    /// Ordinary publication storage bound; kind 1631 retains its original bound.
    pub max_age_seconds: u64,
    /// True only when all actual writer partitions enforce the fence.
    pub ready: bool,
}

/// Metadata-only writer observation behind the original event transaction lock.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct PublicationSettlement {
    /// Exact metadata supplied by the original author and Core attestor.
    pub claim: PublicationClaim,
    /// A verified matching row exists, including soft deletion.
    pub accepted: bool,
    /// The writer fence excludes every later insertion of this original event.
    pub settled: bool,
    /// Writer database clock sampled after the event lock and row observation.
    pub observed_at: i64,
}

impl PublicationSettlement {
    /// A response is never proof for a different frozen request or an early read.
    pub fn proves_absence_for(&self, claim: &PublicationClaim) -> bool {
        self.claim == *claim
            && claim.validate().is_ok()
            && !self.accepted
            && self.settled
            && publication_timestamp_settled(claim.kind, claim.created_at, self.observed_at)
    }
}

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
