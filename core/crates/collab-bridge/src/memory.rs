//! SS-BUZ-ENGRAM: CONTROL-authenticated, Installation-specific native reads.
//! Crypto, slug validation and head selection remain `buzz-core::engram`.
//! Fixed upstream: 779af8886caae1317b4de962082429867ab61503,
//! buzz/crates/buzz-core/src/engram.rs::{validate_and_decrypt,select_head};
//! buzz/crates/buzz-acp/src/relay.rs::RestClient::query_raw_all (composite cursor).

use std::collections::{HashMap, HashSet};

use buzz_core::engram::{self, Body};
use buzz_core::kind::KIND_AGENT_ENGRAM;
use nostr::{Event, Keys, PublicKey};
use serde_json::{json, Value};

use crate::{bridge::IdentityClient, limits::RelayLimits};

pub use buzz_core::engram::NIP44_PLAINTEXT_MAX;

/// Delivered limits; neither missing configuration nor an unknown Relay bound
/// is interpreted as unlimited. The body ceiling also obeys native NIP-44.
#[derive(Clone, Copy)]
pub struct ReadLimits {
    pub event_bound: usize,
    pub plaintext_bytes: usize,
    pub relay_timestamp_window_seconds: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub event_id: String,
    pub created_at: u64,
}

/// Intentionally not Debug/Serialize: decrypted context never becomes an
/// audit, history, database value or error message merely by formatting it.
pub enum CoreMemory {
    Found { head: Head, profile: String },
    Absent,
}

pub struct Snapshot {
    pub core: CoreMemory,
    pub head_ahead_of_relay: bool,
}

#[derive(Debug, Clone, Copy, thiserror::Error)]
pub enum MemoryError {
    #[error("native memory read unavailable")]
    Unavailable,
    #[error("native memory evidence invalid")]
    InvalidEvidence,
    #[error("native memory enumeration bound exceeded")]
    BoundExceeded,
}

pub struct Reader<'a> {
    client: &'a IdentityClient,
    counterparty: &'a Keys,
    agent: PublicKey,
    page_limit: usize,
    limits: ReadLimits,
}

impl<'a> Reader<'a> {
    pub fn new(
        client: &'a IdentityClient,
        counterparty: &'a Keys,
        agent_pubkey: &str,
        relay: &RelayLimits,
        limits: ReadLimits,
    ) -> Result<Self, MemoryError> {
        let agent = PublicKey::parse(agent_pubkey).map_err(|_| MemoryError::InvalidEvidence)?;
        let page_limit =
            usize::try_from(relay.max_limit).map_err(|_| MemoryError::InvalidEvidence)?;
        if client.pubkey_hex() != counterparty.public_key().to_hex()
            || agent == counterparty.public_key()
            || page_limit == 0
            || limits.event_bound == 0
            || limits.event_bound.checked_add(1).is_none()
            || limits.plaintext_bytes == 0
            || limits.plaintext_bytes > engram::NIP44_PLAINTEXT_MAX
            || limits.relay_timestamp_window_seconds == 0
        {
            return Err(MemoryError::InvalidEvidence);
        }
        Ok(Self {
            client,
            counterparty,
            agent,
            page_limit,
            limits,
        })
    }

    /// COMPLETE can only result after the composite cursor reaches the end.
    /// All candidates are authenticated/decrypted, including tombstones; a
    /// corrupt candidate cannot silently disappear and turn UNKNOWN into empty.
    pub async fn inspect(&self, http: &reqwest::Client, now: u64) -> Result<Snapshot, MemoryError> {
        let heads = self.heads(http, None).await?;
        let ahead = heads
            .values()
            .any(|(event, _)| self.head_is_ahead(event, now));
        Ok(Snapshot {
            core: self.core(heads),
            head_ahead_of_relay: ahead,
        })
    }

    /// Called once for a newly admitted Session, not to refresh a live thread.
    /// ABSENT is possible only after a successful, exhausted core-slot query.
    pub async fn read_core(
        &self,
        http: &reqwest::Client,
        now: u64,
    ) -> Result<CoreMemory, MemoryError> {
        let key = engram::conversation_key(self.counterparty.secret_key(), &self.agent);
        let slot = engram::d_tag(&key, engram::CORE_SLUG);
        let heads = self.heads(http, Some(&slot)).await?;
        // Installation readiness is not a cache of this Session's head. A
        // newer future head is unreadable, not absent or usable context.
        if heads
            .values()
            .any(|(event, _)| self.head_is_ahead(event, now))
        {
            return Err(MemoryError::InvalidEvidence);
        }
        Ok(self.core(heads))
    }

    fn head_is_ahead(&self, event: &Event, now: u64) -> bool {
        event.created_at.as_secs() > now.saturating_add(self.limits.relay_timestamp_window_seconds)
    }

    fn core(&self, mut heads: HashMap<String, (Event, Option<String>)>) -> CoreMemory {
        let key = engram::conversation_key(self.counterparty.secret_key(), &self.agent);
        let slot = engram::d_tag(&key, engram::CORE_SLUG);
        match heads.remove(&slot) {
            Some((event, Some(profile))) => CoreMemory::Found {
                head: Head {
                    event_id: event.id.to_hex(),
                    created_at: event.created_at.as_secs(),
                },
                profile,
            },
            _ => CoreMemory::Absent,
        }
    }

    async fn heads(
        &self,
        http: &reqwest::Client,
        slot: Option<&str>,
    ) -> Result<HashMap<String, (Event, Option<String>)>, MemoryError> {
        let mut filter = json!({"kinds":[KIND_AGENT_ENGRAM],"authors":[self.agent.to_hex()],
            "#p":[self.counterparty.public_key().to_hex()]});
        if let Some(slot) = slot {
            filter["#d"] = json!([slot]);
        }
        let mut count = 0usize;
        let mut seen = HashSet::new();
        let mut cursor: Option<(u64, String)> = None;
        let mut heads: HashMap<String, (Event, Option<String>)> = HashMap::new();
        loop {
            // At exactly the bound, one additional query distinguishes an
            // exhausted listing from a truncated one; it never labels a full
            // final page COMPLETE without an actual end-of-list response.
            let requested = self.page_limit.min(self.limits.event_bound + 1 - count);
            filter["limit"] = json!(requested);
            let page = self
                .client
                .query(http, &[filter.clone()])
                .await
                .map_err(|_| MemoryError::Unavailable)?;
            let page = page.as_array().ok_or(MemoryError::InvalidEvidence)?;
            if page.len() > requested {
                return Err(MemoryError::InvalidEvidence);
            }
            let exhausted = page.len() < requested;
            for value in page {
                let event: Event = serde_json::from_value(value.clone())
                    .map_err(|_| MemoryError::InvalidEvidence)?;
                let id = event.id.to_hex();
                let timestamp = event.created_at.as_secs();
                // Native query order is created_at DESC, id ASC. Validate the
                // returned keyset as well as the cryptographic envelope, so a
                // repeating or out-of-scope page cannot supply completeness.
                if !seen.insert(id.clone())
                    || cursor.as_ref().is_some_and(|(time, prior_id)| {
                        timestamp > *time || (timestamp == *time && id <= *prior_id)
                    })
                    || event.verify().is_err()
                {
                    return Err(MemoryError::InvalidEvidence);
                }
                // Measure the complete native plaintext, including unknown
                // JSON fields: reserializing Body would discard those fields
                // and incorrectly accept an oversized decrypted envelope.
                let plaintext = nostr::nips::nip44::decrypt(
                    self.counterparty.secret_key(),
                    &self.agent,
                    &event.content,
                )
                .map_err(|_| MemoryError::InvalidEvidence)?;
                if plaintext.len() > self.limits.plaintext_bytes {
                    return Err(MemoryError::InvalidEvidence);
                }
                drop(plaintext);
                let body = engram::validate_and_decrypt(
                    &event,
                    &self.agent,
                    &self.counterparty.public_key(),
                    self.counterparty.secret_key(),
                    &self.agent,
                )
                .map_err(|_| MemoryError::InvalidEvidence)?;
                let key = engram::conversation_key(self.counterparty.secret_key(), &self.agent);
                let address = engram::d_tag(&key, body.slug());
                if slot.is_some_and(|slot| slot != address) {
                    return Err(MemoryError::InvalidEvidence);
                }
                count += 1;
                if count > self.limits.event_bound {
                    return Err(MemoryError::BoundExceeded);
                }
                let profile = match body {
                    Body::Core { profile } => Some(profile),
                    _ => None,
                };
                let replace = match heads.get(&address) {
                    Some((prior, _)) => engram::select_head([prior.clone(), event.clone()])
                        .is_some_and(|head| head.id == event.id),
                    None => true,
                };
                if replace {
                    heads.insert(address, (event, profile));
                }
                cursor = Some((timestamp, id));
            }
            if exhausted {
                return Ok(heads);
            }
            let (timestamp, id) = cursor.as_ref().ok_or(MemoryError::InvalidEvidence)?;
            filter["until"] = json!(timestamp);
            filter["before_id"] = Value::String(id.clone());
        }
    }
}
