//! SS-BUZ-ENGRAM: CONTROL-authenticated, Installation-specific native reads.
//! Crypto, slug validation and head selection remain `buzz-core::engram`.
//! Fixed upstream: 779af8886caae1317b4de962082429867ab61503,
//! buzz/crates/buzz-core/src/engram.rs::{validate_and_decrypt,select_head};
//! buzz/crates/buzz-acp/src/relay.rs::RestClient::query_raw_all (composite cursor).

use std::collections::HashMap;

use buzz_core::engram::{self, Body};
use buzz_core::kind::{KIND_AGENT_ENGRAM, KIND_STREAM_MESSAGE};
use nostr::{Event, Keys, PublicKey};
use serde_json::json;

use crate::{bridge::IdentityClient, limits::RelayLimits};

pub use buzz_core::engram::{validate_slug, NIP44_PLAINTEXT_MAX};

/// Delivered limits; neither missing configuration nor an unknown Relay bound
/// is interpreted as unlimited. The body ceiling also obeys native NIP-44.
#[derive(Clone, Copy)]
pub struct ReadLimits {
    pub event_bound: usize,
    pub plaintext_bytes: usize,
    pub relay_timestamp_window_seconds: u64,
}

#[cfg(test)]
mod management_evidence {
    use buzz_core::relay::{query_raw_all, QueryAllError};
    use serde_json::json;
    use std::{convert::Infallible, future::ready};

    // Implementation-after evidence of the shared production cursor. These
    // transport tuples contain no business objects, plaintext or credentials.
    #[tokio::test]
    async fn shared_cursor_probes_the_bound_and_preserves_the_composite_cursor() {
        let id = "a".repeat(64);
        let mut calls = 0;
        let events = query_raw_all(json!({"kinds":[30174]}), 1, 1, |filter| {
            calls += 1;
            assert_eq!(filter["limit"], 1);
            let page = if calls == 1 {
                json!([{"id":id,"created_at":7}])
            } else {
                assert_eq!(filter["until"], 7);
                assert_eq!(filter["before_id"], id);
                json!([])
            };
            ready(Ok::<_, Infallible>(page))
        })
        .await
        .unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(calls, 2);
    }

    #[tokio::test]
    async fn shared_cursor_rejects_duplicate_reverse_oversized_and_over_bound_pages() {
        let id = "a".repeat(64);
        let other = "b".repeat(64);
        for page in [
            json!([{"id":id,"created_at":7},{"id":id,"created_at":7}]),
            json!([{"id":id,"created_at":7},{"id":other,"created_at":8}]),
            json!([{"id":other,"created_at":7},{"id":id,"created_at":7}]),
        ] {
            let result = query_raw_all(json!({"kinds":[30174]}), 3, 3, |_| {
                ready(Ok::<_, Infallible>(page.clone()))
            })
            .await;
            assert!(matches!(result, Err(QueryAllError::InvalidPage)));
        }
        let oversized = query_raw_all(json!({"kinds":[30174]}), 1, 3, |_| {
            ready(Ok::<_, Infallible>(json!([
                {"id":id,"created_at":7},{"id":other,"created_at":6}
            ])))
        })
        .await;
        assert!(matches!(oversized, Err(QueryAllError::InvalidPage)));
        let mut calls = 0;
        let bounded = query_raw_all(json!({"kinds":[30174]}), 1, 1, |_| {
            calls += 1;
            ready(Ok::<_, Infallible>(if calls == 1 {
                json!([{"id":id,"created_at":7}])
            } else {
                json!([{"id":other,"created_at":6}])
            }))
        })
        .await;
        assert!(matches!(bounded, Err(QueryAllError::BoundExceeded)));
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Head {
    pub event_id: String,
    pub created_at: u64,
}

#[path = "memory_write.rs"]
pub mod write;

/// Intentionally not Debug/Serialize: decrypted context never becomes an
/// audit, history, database value or error message merely by formatting it.
pub enum CoreMemory {
    Found { head: Head, profile: String },
    Absent,
}

/// A best-effort native head tuple, not a Core copy of the decrypted value.
pub struct EntryHead {
    pub slug: String,
    pub head: Head,
    pub tombstone: bool,
}

/// Plaintext belongs only to the authenticated read response.
pub struct MemoryEntry {
    pub head: Head,
    pub value: Option<String>,
    pub value_hash: Option<String>,
    pub plaintext_bytes: usize,
}

/// Only the current native-read/turn call owns this plaintext. It must never
/// become a serialized workflow input, database row or diagnostic value.
pub struct SourceMessage {
    pub author: String,
    pub content: String,
}

impl IdentityClient {
    /// Read the exact persisted trigger, using Buzz's single NIP-10 parser.
    /// A new head, another channel or an unverified event cannot supply input.
    pub async fn source_message(
        &self,
        http: &reqwest::Client,
        event_id: &str,
        channel: &str,
        root: &str,
    ) -> Result<SourceMessage, MemoryError> {
        let page = self
            .query(http, &[json!({"ids":[event_id]})])
            .await
            .map_err(|_| MemoryError::Unavailable)?;
        let events: Vec<Event> =
            serde_json::from_value(page).map_err(|_| MemoryError::InvalidEvidence)?;
        let mut events = events.into_iter();
        let event = events.next().ok_or(MemoryError::Unavailable)?;
        if events.next().is_some()
            || event.id.to_hex() != event_id
            || u32::from(event.kind.as_u16()) != KIND_STREAM_MESSAGE
            || event.verify().is_err()
        {
            return Err(MemoryError::InvalidEvidence);
        }
        let mut observed_channel = None;
        for tag in event.tags.iter() {
            let parts = tag.as_slice();
            if parts.first().map(String::as_str) == Some("h") {
                if observed_channel.is_some() || parts.len() != 2 {
                    return Err(MemoryError::InvalidEvidence);
                }
                observed_channel = parts.get(1);
            }
        }
        let ancestry = buzz_core::nip10::parse_thread_markers(&event.tags).resolve();
        let belongs = if event_id == root {
            ancestry.is_none()
        } else {
            ancestry
                .as_ref()
                .is_some_and(|(observed, _)| observed == root)
        };
        if observed_channel.map(String::as_str) != Some(channel) || !belongs {
            return Err(MemoryError::InvalidEvidence);
        }
        Ok(SourceMessage {
            author: event.pubkey.to_hex(),
            content: event.content,
        })
    }
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
        let (heads, _) = self.heads(http, None).await?;
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
        let (heads, _) = self.heads(http, Some(&slot)).await?;
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

    /// Recover a Session's already frozen core reference. This is not a
    /// replaceable-event/head query: missing/deleted/corrupt is UNREADABLE,
    /// never ABSENT and never permission to substitute the current head.
    pub async fn read_core_event(
        &self,
        http: &reqwest::Client,
        event_id: &str,
        now: u64,
    ) -> Result<CoreMemory, MemoryError> {
        let page = self
            .client
            .query(http, &[json!({"ids":[event_id]})])
            .await
            .map_err(|_| MemoryError::Unavailable)?;
        let events: Vec<Event> =
            serde_json::from_value(page).map_err(|_| MemoryError::InvalidEvidence)?;
        let mut events = events.into_iter();
        let event = events.next().ok_or(MemoryError::Unavailable)?;
        if events.next().is_some()
            || event.id.to_hex() != event_id
            || self.head_is_ahead(&event, now)
        {
            return Err(MemoryError::InvalidEvidence);
        }
        let Body::Core { profile } = self.body(&event)? else {
            return Err(MemoryError::InvalidEvidence);
        };
        Ok(CoreMemory::Found {
            head: Head {
                event_id: event.id.to_hex(),
                created_at: event.created_at.as_secs(),
            },
            profile,
        })
    }

    /// Enumerate the exact pair through the exhausted composite cursor.
    /// Tombstone heads remain visible; old live values are never resurrected.
    pub async fn list_entries(
        &self,
        http: &reqwest::Client,
        now: u64,
    ) -> Result<(Vec<EntryHead>, usize), MemoryError> {
        let (heads, plaintext_bytes) = self.heads(http, None).await?;
        let mut entries = Vec::new();
        for (event, body) in heads.into_values() {
            if self.head_is_ahead(&event, now) {
                return Err(MemoryError::InvalidEvidence);
            }
            if let Body::Memory { slug, value } = body {
                entries.push(EntryHead {
                    slug,
                    head: Head {
                        event_id: event.id.to_hex(),
                        created_at: event.created_at.as_secs(),
                    },
                    tombstone: value.is_none(),
                });
            }
        }
        entries.sort_by(|a, b| a.slug.cmp(&b.slug));
        Ok((entries, plaintext_bytes))
    }

    /// Same native core-slot query; the additional scalar is the actually
    /// decrypted JSON byte count, not a reserialized profile or body copy.
    pub async fn read_core_entry(
        &self,
        http: &reqwest::Client,
        now: u64,
    ) -> Result<Option<MemoryEntry>, MemoryError> {
        let key = engram::conversation_key(self.counterparty.secret_key(), &self.agent);
        let slot = engram::d_tag(&key, engram::CORE_SLUG);
        let (mut heads, plaintext_bytes) = self.heads(http, Some(&slot)).await?;
        let Some((event, body)) = heads.remove(&slot) else {
            return Ok(None);
        };
        if self.head_is_ahead(&event, now) {
            return Err(MemoryError::InvalidEvidence);
        }
        let Body::Core { profile } = body else {
            return Err(MemoryError::InvalidEvidence);
        };
        Ok(Some(MemoryEntry {
            head: Head {
                event_id: event.id.to_hex(),
                created_at: event.created_at.as_secs(),
            },
            value_hash: Some(engram::value_hash(&profile)),
            value: Some(profile),
            plaintext_bytes,
        }))
    }

    /// Read the requested native slot only. An absent or tombstoned slot is
    /// distinct from an unreadable candidate or a bounded/incomplete query.
    pub async fn read_entry(
        &self,
        http: &reqwest::Client,
        slug: &str,
        now: u64,
    ) -> Result<Option<MemoryEntry>, MemoryError> {
        engram::validate_slug(slug).map_err(|_| MemoryError::InvalidEvidence)?;
        if slug == engram::CORE_SLUG {
            return Err(MemoryError::InvalidEvidence);
        }
        let key = engram::conversation_key(self.counterparty.secret_key(), &self.agent);
        let slot = engram::d_tag(&key, slug);
        let (mut heads, plaintext_bytes) = self.heads(http, Some(&slot)).await?;
        let Some((event, body)) = heads.remove(&slot) else {
            return Ok(None);
        };
        if self.head_is_ahead(&event, now) {
            return Err(MemoryError::InvalidEvidence);
        }
        let Body::Memory {
            slug: actual,
            value,
        } = body
        else {
            return Err(MemoryError::InvalidEvidence);
        };
        if actual != slug {
            return Err(MemoryError::InvalidEvidence);
        }
        Ok(Some(MemoryEntry {
            head: Head {
                event_id: event.id.to_hex(),
                created_at: event.created_at.as_secs(),
            },
            value_hash: value.as_deref().map(engram::value_hash),
            value,
            plaintext_bytes,
        }))
    }

    fn body(&self, event: &Event) -> Result<Body, MemoryError> {
        self.body_with_bytes(event).map(|(body, _)| body)
    }

    fn body_with_bytes(&self, event: &Event) -> Result<(Body, usize), MemoryError> {
        if event.verify().is_err() {
            return Err(MemoryError::InvalidEvidence);
        }
        let (body, plaintext_bytes) = engram::validate_and_decrypt_with_size(
            event,
            &self.agent,
            &self.counterparty.public_key(),
            self.counterparty.secret_key(),
            &self.agent,
        )
        .map_err(|_| MemoryError::InvalidEvidence)?;
        if plaintext_bytes > self.limits.plaintext_bytes {
            return Err(MemoryError::InvalidEvidence);
        }
        Ok((body, plaintext_bytes))
    }

    fn head_is_ahead(&self, event: &Event, now: u64) -> bool {
        event.created_at.as_secs() > now.saturating_add(self.limits.relay_timestamp_window_seconds)
    }

    fn core(&self, mut heads: HashMap<String, (Event, Body)>) -> CoreMemory {
        let key = engram::conversation_key(self.counterparty.secret_key(), &self.agent);
        let slot = engram::d_tag(&key, engram::CORE_SLUG);
        match heads.remove(&slot) {
            Some((event, Body::Core { profile })) => CoreMemory::Found {
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
    ) -> Result<(HashMap<String, (Event, Body)>, usize), MemoryError> {
        let mut filter = json!({"kinds":[KIND_AGENT_ENGRAM],"authors":[self.agent.to_hex()],
            "#p":[self.counterparty.public_key().to_hex()]});
        if let Some(slot) = slot {
            filter["#d"] = json!([slot]);
        }
        let events = buzz_core::relay::query_raw_all(
            filter,
            self.page_limit,
            self.limits.event_bound,
            |filter| async move { self.client.query(http, &[filter]).await },
        )
        .await
        .map_err(|error| match error {
            buzz_core::relay::QueryAllError::Query(_) => MemoryError::Unavailable,
            buzz_core::relay::QueryAllError::InvalidPage => MemoryError::InvalidEvidence,
            buzz_core::relay::QueryAllError::BoundExceeded => MemoryError::BoundExceeded,
        })?;
        let mut plaintext_bytes = 0usize;
        let mut heads: HashMap<String, (Event, Body)> = HashMap::new();
        for value in events {
            let event: Event =
                serde_json::from_value(value).map_err(|_| MemoryError::InvalidEvidence)?;
            let (body, bytes) = self.body_with_bytes(&event)?;
            plaintext_bytes = plaintext_bytes
                .checked_add(bytes)
                .ok_or(MemoryError::InvalidEvidence)?;
            let key = engram::conversation_key(self.counterparty.secret_key(), &self.agent);
            let address = engram::d_tag(&key, body.slug());
            if slot.is_some_and(|slot| slot != address) {
                return Err(MemoryError::InvalidEvidence);
            }
            let replace = match heads.get(&address) {
                Some((prior, _)) => engram::select_head([prior.clone(), event.clone()])
                    .is_some_and(|head| head.id == event.id),
                None => true,
            };
            if replace {
                heads.insert(address, (event, body));
            }
        }
        Ok((heads, plaintext_bytes))
    }
}
