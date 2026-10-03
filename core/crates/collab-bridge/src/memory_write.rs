//! SS-BUZ-ENGRAM: native AGENT signature, one delivery and native head proof.
//! The caller persists only the event ID and body digest before `deliver`.

use buzz_core::engram;
pub use buzz_core::engram::{Body, MemoryPatchError};
use nostr::{Event, Keys, PublicKey};

use crate::{
    bridge::{Delivery, IdentityClient},
    memory::{Head, MemoryError, Reader},
};

pub use buzz_core::engram::{apply_memory_patch, value_hash};

#[derive(Debug)]
pub enum WriteError {
    Native(MemoryError),
    HeadConflict,
    HeadAheadOfRelay,
}

impl From<MemoryError> for WriteError {
    fn from(error: MemoryError) -> Self {
        Self::Native(error)
    }
}

/// Transient encrypted event: no Serialize/Debug implementation and no
/// durable copy in Core. Its ID is frozen before the one native dispatch.
pub struct Prepared {
    event: Event,
    pub old_head: Option<Head>,
    pub plaintext_bytes: usize,
    pub native_address: String,
}

impl Prepared {
    pub fn event_id(&self) -> String {
        self.event.id.to_hex()
    }

    pub fn created_at(&self) -> u64 {
        self.event.created_at.as_secs()
    }

    pub async fn deliver(
        &self,
        http: &reqwest::Client,
        agent: &IdentityClient,
    ) -> Result<Delivery, MemoryError> {
        if agent.pubkey_hex() != self.event.pubkey.to_hex() {
            return Err(MemoryError::InvalidEvidence);
        }
        let admitted = agent.admit().map_err(|_| MemoryError::Unavailable)?;
        Ok(agent.deliver(http, &self.event, admitted).await)
    }
}

/// Keep the original NIP-AE serializer, timestamp function and crypto. The
/// expected head is caller evidence, never permission or an invented CAS.
pub async fn prepare(
    http: &reqwest::Client,
    reader: &Reader<'_>,
    agent: &Keys,
    counterparty: &PublicKey,
    body: Body,
    expected_head: Option<&str>,
    clock: (u64, u64),
) -> Result<Prepared, WriteError> {
    let (now, timestamp_window) = clock;
    let slug = body.slug();
    let current = if slug == engram::CORE_SLUG {
        reader.read_core_entry(http, now).await?
    } else {
        reader.read_entry(http, slug, now).await?
    };
    let old_head = current.map(|entry| entry.head);
    if old_head.as_ref().map(|head| head.event_id.as_str()) != expected_head {
        return Err(WriteError::HeadConflict);
    }
    let created_at = engram::monotonic_created_at(now, old_head.as_ref().map(|h| h.created_at));
    if old_head
        .as_ref()
        .is_some_and(|h| created_at <= h.created_at)
        || created_at
            > now
                .checked_add(timestamp_window)
                .ok_or(MemoryError::InvalidEvidence)?
    {
        return Err(WriteError::HeadAheadOfRelay);
    }
    let plaintext_bytes = body.to_json_bytes().len();
    if plaintext_bytes > engram::NIP44_PLAINTEXT_MAX {
        return Err(MemoryError::BoundExceeded.into());
    }
    let event = engram::build_event(agent, counterparty, &body, created_at)
        .map_err(|_| MemoryError::InvalidEvidence)?;
    let key = engram::conversation_key(agent.secret_key(), counterparty);
    let native_address = engram::d_tag(&key, slug);
    Ok(Prepared {
        event,
        old_head,
        plaintext_bytes,
        native_address,
    })
}

pub struct ExpectedEvent<'a> {
    pub event_id: &'a str,
    pub created_at: u64,
    pub plaintext_bytes: usize,
    pub body_digest: &'a str,
}

/// UNKNOWN reconciliation reads the frozen native ID. Missing is not proof of
/// no dispatch and does not authorize a new signature or delivery.
pub async fn observed_event(
    http: &reqwest::Client,
    counterparty_client: &IdentityClient,
    counterparty: &Keys,
    agent_hex: &str,
    expected: ExpectedEvent<'_>,
) -> Result<Option<Body>, MemoryError> {
    let response = counterparty_client
        .query(http, &[serde_json::json!({"ids":[expected.event_id]})])
        .await
        .map_err(|_| MemoryError::Unavailable)?;
    let events: Vec<Event> =
        serde_json::from_value(response).map_err(|_| MemoryError::InvalidEvidence)?;
    let mut events = events.into_iter();
    let Some(event) = events.next() else {
        return Ok(None);
    };
    if events.next().is_some()
        || event.id.to_hex() != expected.event_id
        || event.created_at.as_secs() != expected.created_at
        || event.verify().is_err()
    {
        return Err(MemoryError::InvalidEvidence);
    }
    let agent = PublicKey::from_hex(agent_hex).map_err(|_| MemoryError::InvalidEvidence)?;
    let (body, bytes) = engram::validate_and_decrypt_with_size(
        &event,
        &agent,
        &counterparty.public_key(),
        counterparty.secret_key(),
        &agent,
    )
    .map_err(|_| MemoryError::InvalidEvidence)?;
    use sha2::{Digest, Sha256};
    if bytes != expected.plaintext_bytes
        || hex::encode(Sha256::digest(body.to_json_bytes())) != expected.body_digest
    {
        return Err(MemoryError::InvalidEvidence);
    }
    Ok(Some(body))
}

/// A native opaque address is an external reference, not a Core slug/body
/// replica. Recovery shares Reader's FULL paging/signature/decryption guards.
pub async fn head_at_address(
    http: &reqwest::Client,
    reader: &Reader<'_>,
    address: &str,
    now: u64,
) -> Result<Option<Head>, MemoryError> {
    if address.len() != 64 || !address.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(MemoryError::InvalidEvidence);
    }
    let (mut heads, _) = reader.heads(http, Some(address)).await?;
    if heads.len() > 1 {
        return Err(MemoryError::InvalidEvidence);
    }
    let Some((event, _)) = heads.remove(address) else {
        return Ok(None);
    };
    if reader.head_is_ahead(&event, now) {
        return Err(MemoryError::InvalidEvidence);
    }
    Ok(Some(Head {
        event_id: event.id.to_hex(),
        created_at: event.created_at.as_secs(),
    }))
}
