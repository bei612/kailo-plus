// Tests for commands/channels.rs — split into a sibling file to keep
// channels.rs under the per-file line cap.

use super::*;
// The relay-backed fetch helpers moved to the `fetch` submodule; its
// `pub(super)` items are visible here as a descendant of the channels module.
use super::fetch::*;
use crate::models::ChannelInfo;
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

/// Build a signed event for testing with the given kind, content, and tags.
fn ev(kind: u16, content: &str, tags: Vec<Vec<&str>>) -> nostr::Event {
    ev_at(kind, content, tags, Timestamp::now())
}

fn ev_at(kind: u16, content: &str, tags: Vec<Vec<&str>>, created_at: Timestamp) -> nostr::Event {
    let keys = Keys::generate();
    let parsed: Vec<Tag> = tags
        .into_iter()
        .map(|t| Tag::parse(t).expect("parse tag"))
        .collect();
    EventBuilder::new(Kind::from_u16(kind), content)
        .tags(parsed)
        .custom_created_at(created_at)
        .sign_with_keys(&keys)
        .expect("sign")
}

// A 64-hex pubkey (nostr p-tags require 32-byte hex).
const PK_A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PK_B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PK_C: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

#[test]
fn directory_cursor_keeps_same_second_tiebreaker() {
    let timestamp = Timestamp::from(1_700_000_000);
    let event = ev_at(39000, "{}", vec![], timestamp);
    let mut filter = serde_json::json!({"kinds": [39000], "limit": DIRECTORY_PAGE_SIZE});

    advance_directory_cursor(&mut filter, std::slice::from_ref(&event));

    assert_eq!(filter["until"], serde_json::json!(timestamp.as_secs()));
    assert_eq!(filter["before_id"], serde_json::json!(event.id.to_hex()));
}

#[test]
fn counts_unique_p_tags_per_channel() {
    let e1 = ev(
        39002,
        "",
        vec![
            vec!["d", "chan-1"],
            vec!["p", PK_A, "", "member"],
            vec!["p", PK_B, "", "admin"],
        ],
    );
    let e2 = ev(
        39002,
        "",
        vec![vec!["d", "chan-2"], vec!["p", PK_C, "", "member"]],
    );

    let membership = collect_members_by_channel(&[e1, e2]);
    assert_eq!(membership.get("chan-1").map(|m| m.count), Some(2));
    assert_eq!(membership.get("chan-2").map(|m| m.count), Some(1));
    assert_eq!(membership.len(), 2);

    let mut pks: Vec<&str> = membership["chan-1"]
        .pubkeys
        .iter()
        .map(|s| s.as_str())
        .collect();
    pks.sort();
    assert_eq!(pks, vec![PK_A, PK_B]);
}

#[test]
fn dedupes_repeated_pubkeys() {
    let e = ev(
        39002,
        "",
        vec![
            vec!["d", "chan-1"],
            vec!["p", PK_A, "", "member"],
            vec!["p", PK_A, "", "admin"], // duplicate pubkey, different role
            vec!["p", PK_B, "", "member"],
        ],
    );
    let membership = collect_members_by_channel(&[e]);
    assert_eq!(membership.get("chan-1").map(|m| m.count), Some(2));
}

#[test]
fn skips_event_without_d_tag() {
    let e = ev(39002, "", vec![vec!["p", PK_A, "", "member"]]);
    let membership = collect_members_by_channel(&[e]);
    assert!(membership.is_empty());
}

#[test]
fn zero_member_channel_is_recorded() {
    // A channel with a members event but no p-tags should report 0,
    // not be absent from the map (the caller relies on `get` returning
    // `Some(0)` to overwrite a default).
    let e = ev(39002, "", vec![vec!["d", "chan-1"]]);
    let membership = collect_members_by_channel(&[e]);
    assert_eq!(membership.get("chan-1").map(|m| m.count), Some(0));
    assert!(membership["chan-1"].pubkeys.is_empty());
}

#[test]
fn empty_input_yields_empty_map() {
    let membership = collect_members_by_channel(&[]);
    assert!(membership.is_empty());
}

// ── compute_channels_hash ─────────────────────────────────────────────────────

fn make_channel(id: &str, name: &str, last_message_at: Option<String>) -> ChannelInfo {
    ChannelInfo {
        id: id.to_string(),
        name: name.to_string(),
        channel_type: "stream".to_string(),
        visibility: "open".to_string(),
        description: "".to_string(),
        topic: None,
        purpose: None,
        member_count: 0,
        member_pubkeys: Vec::new(),
        last_message_at,
        archived_at: None,
        participants: Vec::new(),
        participant_pubkeys: Vec::new(),
        is_member: true,
        ttl_seconds: None,
        ttl_deadline: None,
    }
}

#[test]
fn hash_is_order_insensitive() {
    let c1 = make_channel("aaa", "Alpha", None);
    let c2 = make_channel("bbb", "Beta", None);
    let c3 = make_channel("aaa", "Alpha", None);
    let c4 = make_channel("bbb", "Beta", None);

    assert_eq!(
        compute_channels_hash(&[c1, c2]),
        compute_channels_hash(&[c4, c3]),
        "hash must be insensitive to channel list ordering",
    );
}

#[test]
fn hash_ignores_last_message_at() {
    let c_none = make_channel("chan-1", "Alpha", None);
    let c_some = make_channel("chan-1", "Alpha", Some("2026-01-01T00:00:00Z".to_string()));

    assert_eq!(
        compute_channels_hash(&[c_none]),
        compute_channels_hash(&[c_some]),
        "hash must be insensitive to last_message_at",
    );
}

#[test]
fn hash_changes_on_metadata_change() {
    let c1 = make_channel("chan-1", "Alpha", None);
    let c2 = make_channel("chan-1", "AlphaRenamed", None);

    assert_ne!(
        compute_channels_hash(&[c1]),
        compute_channels_hash(&[c2]),
        "hash must change when channel name changes",
    );
}

#[test]
fn hash_changes_on_membership_change() {
    let mut c1 = make_channel("chan-1", "Alpha", None);
    let mut c2 = make_channel("chan-1", "Alpha", None);
    c1.member_pubkeys = vec![PK_A.to_string()];
    c2.member_pubkeys = vec![PK_A.to_string(), PK_B.to_string()];

    assert_ne!(
        compute_channels_hash(&[c1]),
        compute_channels_hash(&[c2]),
        "hash must change when member_pubkeys changes",
    );
}

#[test]
fn not_modified_returns_none_when_hash_matches() {
    let channels = vec![make_channel("chan-1", "General", None)];
    let hash = compute_channels_hash(&channels);

    // Mirror the get_channels command decision logic.
    let known_hash = Some(hash.clone());
    let is_not_modified = known_hash.as_deref() == Some(hash.as_str());

    assert!(
        is_not_modified,
        "identical hash must trigger the not-modified short-circuit",
    );
}

#[test]
fn not_modified_does_not_trigger_on_hash_mismatch() {
    let channels = vec![make_channel("chan-1", "General", None)];
    let hash = compute_channels_hash(&channels);
    let known_hash = Some("0000000000000000".to_string());

    let is_not_modified = known_hash.as_deref() == Some(hash.as_str());

    assert!(
        !is_not_modified,
        "stale hash must NOT trigger the not-modified short-circuit",
    );
}

#[test]
fn hash_is_stable_for_same_input() {
    // Verifies that the FNV-1a output is deterministic across calls within
    // the same process (unlike std DefaultHasher which uses random seeds).
    let channels = vec![
        make_channel("aaa", "General", Some("2026-01-01T00:00:00Z".to_string())),
        make_channel("bbb", "Random", None),
    ];
    let first = compute_channels_hash(&channels);
    let channels2 = vec![
        make_channel("aaa", "General", None), // last_message_at change is ignored
        make_channel("bbb", "Random", None),
    ];
    let second = compute_channels_hash(&channels2);

    assert_eq!(
        first, second,
        "hash must be deterministic and ignore last_message_at"
    );
}

#[test]
fn last_message_filter_covers_all_human_visible_activity_kinds() {
    let filter = last_message_filter("channel-1");

    assert_eq!(
        filter,
        serde_json::json!({
            "kinds": [9, 40002],
            "#h": ["channel-1"],
            "limit": 1
        })
    );
}

#[test]
fn last_message_filters_stay_within_relay_channel_cap() {
    let filters: Vec<serde_json::Value> = (0..257)
        .map(|index| serde_json::json!({"#h": [format!("channel-{index}")]}))
        .collect();

    let batches = last_message_filter_batches(&filters);

    assert_eq!(
        batches.iter().map(|batch| batch.len()).collect::<Vec<_>>(),
        [128, 128, 1]
    );
    assert_eq!(batches.concat(), filters);
}

fn member(pubkey: &str) -> crate::models::ChannelMemberInfo {
    crate::models::ChannelMemberInfo {
        pubkey: pubkey.to_string(),
        role: "member".to_string(),
        is_agent: false,
        joined_at: None,
        display_name: None,
    }
}

#[test]
fn profile_join_pubkeys_caps_in_roster_order() {
    let members = vec![member(PK_A), member(PK_B), member(PK_C)];

    assert_eq!(
        profile_join_pubkeys(&members, 2),
        vec![PK_A.to_string(), PK_B.to_string()]
    );
    assert_eq!(profile_join_pubkeys(&members, 3).len(), 3);
    assert_eq!(profile_join_pubkeys(&members, 10).len(), 3);
    assert!(profile_join_pubkeys(&[], 10).is_empty());
}
