//! Platform (SS-BUZ-GOVERNANCE, DD-125(3)): the room side of governed Huddles.
//!
//! Upstream closes an audio connection only when that peer itself leaves; the
//! TTL reaper, kind:9001 and kind:9002 never touch a live room, and only the
//! last-leave path signs kind:48103 (SF-BUZ-53). In a governed community the
//! channel roster is the authorization, so:
//!
//! - an owner kind:9001 on a Huddle temp channel closes the removed key's
//!   audio connections at once ([`close_pubkey`]);
//! - any archive of a Huddle temp channel (owner `huddle.end`, TTL reap) ends
//!   the room and, because such an archive never reaches the handler's own
//!   archive-then-48103 path, the relay back-signs the 48103 its parent card is
//!   still missing ([`end_room`]).
//!
//! Both are no-ops when governance is off and for every channel that is not a
//! governed Huddle temp channel.

use buzz_core::tenant::TenantContext;
use nostr::Kind;
use tokio::sync::mpsc;
use tracing::{info, warn};
use uuid::Uuid;

use super::handler::{emit_participant_event, ParticipantLifecycle};
use super::room::PeerCtrl;
use crate::handlers::governance::{is_governed, is_huddle_projection};
use crate::state::AppState;

/// Ask one peer connection to close. The control queue is bounded; when it is
/// momentarily full the close is queued behind the pending messages instead of
/// being dropped.
fn close(ctrl_tx: &mpsc::Sender<PeerCtrl>) {
    if let Err(mpsc::error::TrySendError::Full(_)) = ctrl_tx.try_send(PeerCtrl::Close) {
        let ctrl_tx = ctrl_tx.clone();
        tokio::spawn(async move {
            let _ = ctrl_tx.send(PeerCtrl::Close).await;
        });
    }
}

/// Close every audio connection `pubkey` holds in the channel's live room.
pub fn close_pubkey(state: &AppState, tenant: &TenantContext, channel_id: Uuid, pubkey: &[u8]) {
    if !is_governed(state) {
        return;
    }
    let Some(room) = state.audio_rooms.get(tenant.community(), channel_id) else {
        return;
    };
    let target = hex::encode(pubkey);
    for peer in room.peers.iter() {
        if peer.pubkey == target {
            close(&peer.ctrl_tx);
        }
    }
}

/// The channel was just archived. When it is a governed Huddle temp channel,
/// refuse new admissions, close every connection and sign the missing 48103.
pub async fn end_room(state: &AppState, tenant: &TenantContext, channel_id: Uuid) {
    if !is_governed(state) {
        return;
    }
    let channel = match state.db.get_channel(tenant.community(), channel_id).await {
        Ok(channel) => channel,
        Err(e) => {
            warn!(channel_id = %channel_id, "huddle end: channel lookup failed: {e}");
            return;
        }
    };
    match is_huddle_projection(state, tenant, &channel).await {
        Ok(true) => {}
        Ok(false) => return,
        Err(e) => {
            warn!(channel_id = %channel_id, "huddle end: projection check failed: {e}");
            return;
        }
    }
    if let Some(room) = state.audio_rooms.get(tenant.community(), channel_id) {
        // Ended first: a peer removed after this never runs the last-leave
        // archive, and no new peer is admitted into the closing room.
        room.mark_ended();
        for peer in room.peers.iter() {
            close(&peer.ctrl_tx);
        }
        state
            .audio_rooms
            .cleanup_if_empty(tenant.community(), channel_id);
    }
    let target = match state
        .db
        .huddle_end_target(tenant.community(), channel_id, &channel.created_by)
        .await
    {
        Ok(target) => target,
        Err(e) => {
            warn!(channel_id = %channel_id, "huddle end: parent lookup failed: {e}");
            return;
        }
    };
    // Never announced: no parent card refers to it. Already ended: its creator
    // or the last leave signed the 48103 before this archive.
    let Some((parent_channel_id, false)) = target else {
        return;
    };
    let creator = hex::encode(&channel.created_by);
    let generation = state.huddle_liveness_generation.to_string();
    emit_participant_event(
        state,
        tenant,
        channel_id,
        parent_channel_id,
        ParticipantLifecycle {
            kind: Kind::Custom(48103),
            participant_pubkey: &creator,
            roster_revision: None,
            admission_id: None,
            generation: &generation,
        },
    )
    .await;
    info!(channel_id = %channel_id, "governed huddle archived — room ended");
}
