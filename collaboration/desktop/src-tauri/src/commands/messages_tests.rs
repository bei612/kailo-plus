use super::*;

#[test]
fn search_messages_limit_allows_discussion_discovery_page() {
    assert_eq!(search_messages_limit(None), 20);
    assert_eq!(search_messages_limit(Some(500)), 500);
    assert_eq!(search_messages_limit(Some(1_000)), 500);
}

#[test]
fn search_messages_filter_requests_prefix_mode_for_topbar_typeahead() {
    let filter = build_search_messages_filter("  pro  ", 12, Some("channel-1"), None, None, None);

    assert_eq!(filter["search"], serde_json::json!("pro"));
    assert_eq!(filter["search_mode"], serde_json::json!("prefix"));
    assert_eq!(filter["limit"], serde_json::json!(12));
    assert_eq!(filter["#h"], serde_json::json!(["channel-1"]));
    assert!(filter.get("authors").is_none());
    assert!(filter.get("since").is_none());
    assert!(filter.get("until").is_none());
}

#[test]
fn search_messages_filter_emits_operator_fields() {
    let authors =
        vec!["aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899".to_string()];
    let filter = build_search_messages_filter(
        "deploy",
        20,
        Some("channel-uuid"),
        Some(&authors),
        Some(1_700_000_000),
        Some(1_700_086_400),
    );

    assert_eq!(filter["search"], serde_json::json!("deploy"));
    assert_eq!(filter["#h"], serde_json::json!(["channel-uuid"]));
    assert_eq!(
        filter["authors"],
        serde_json::json!(["aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899"])
    );
    assert_eq!(filter["since"], serde_json::json!(1_700_000_000));
    assert_eq!(filter["until"], serde_json::json!(1_700_086_400));
}

#[test]
fn thread_replies_filter_carries_non_p_gated_kinds_to_clear_the_gate() {
    // The relay bridge p-gates EVERY filter before routing
    // (`p_gated_filters_authorized`): a kindless filter "could match" a
    // p-gated kind, so it demands a `#p` tag we don't send -> HTTP 403,
    // before the thread-subtree query runs. The headline Lane-1 fix
    // (`useThreadReplies` closing the descendant gap) then fails on every
    // call against a real relay. So the thread filter MUST carry `kinds`,
    // and every kind MUST be non-p-gated (else the gate still fires). The
    // Playwright mock does not model p-gating, so this unit test is the
    // only guard against the client/relay auth contract drifting.
    let filter = build_thread_replies_filter("root-hex", Some("channel-1"), 64, 200, None);

    let kinds = filter
        .get("kinds")
        .and_then(|v| v.as_array())
        .expect("thread filter must carry `kinds` so the p-gate passes");
    assert!(!kinds.is_empty(), "kinds must be non-empty");
    for kind in kinds {
        let k = kind.as_u64().expect("kind is a number") as u32;
        assert!(
            !buzz_core_pkg::kind::P_GATED_KINDS.contains(&k),
            "kind {k} is p-gated; a p-gated kind in the filter re-triggers the \
                 403 that this fix exists to prevent"
        );
    }
    assert_eq!(filter["#e"], serde_json::json!(["root-hex"]));
    assert_eq!(filter["depth_limit"], serde_json::json!(64));
    assert_eq!(filter["#h"], serde_json::json!(["channel-1"]));
    assert_eq!(filter["include_aux"], serde_json::json!(true));
}

#[test]
fn thread_replies_filter_pages_with_composite_cursor() {
    // When a cursor is supplied, both the timestamp and the event-id
    // tiebreak must be emitted (`thread_cursor` + `thread_cursor_id`), else
    // paging degrades to timestamp-only and drops same-second replies.
    let cursor = crate::models::ThreadCursor {
        created_at: 1_700_000_000,
        event_id: "abcd".to_string(),
    };
    let filter = build_thread_replies_filter("root-hex", None, 64, 200, Some(&cursor));
    assert_eq!(filter["thread_cursor"], serde_json::json!(1_700_000_000));
    assert_eq!(filter["thread_cursor_id"], serde_json::json!("abcd"));
    assert!(
        !filter.contains_key("#h"),
        "no channel_id -> no #h scope in the filter"
    );
}

#[test]
fn provided_thread_ref_validates_and_preserves_root_and_parent() {
    let root = "11".repeat(32);
    let parent = "22".repeat(32);
    let thread_ref = thread_ref::provided_thread_ref(&root, &parent)
        .expect("valid 64-hex event ids should be accepted");
    assert_eq!(thread_ref.root_event_id.to_hex(), root);
    assert_eq!(thread_ref.parent_event_id.to_hex(), parent);
    assert!(thread_ref::provided_thread_ref("not-hex", &parent).is_err());
}

/// `FeedItem.category` is a wire contract with the desktop frontend
/// (`desktop/src/shared/api/types.ts`). The frontend routes notification
/// sounds, titles, mute-bypass, and inbox labels off these exact strings, so
/// the serialized form must stay singular `mention` — not the plural section
/// name `mentions` used by `FeedSections`.
#[test]
fn feed_item_category_serializes_to_frontend_contract() {
    let value = serde_json::to_value(FeedItemCategory::Mention).expect("category should serialize");
    assert_eq!(value, serde_json::Value::String("mention".to_string()));
}

#[test]
fn feed_item_from_event_carries_singular_mention_category() {
    let pubkey = nostr::Keys::generate().public_key().to_hex();
    let event = crate::events::build_message(
        uuid::Uuid::new_v4(),
        "hey @you",
        None,
        &[pubkey.as_str()],
        &[],
        &[],
        &[],
        &[],
        None,
        &crate::relay::relay_api_base_url(),
    )
    .expect("message should build")
    .sign_with_keys(&nostr::Keys::generate())
    .expect("message should sign");

    let item = feed_item_from_event(&event, FeedItemCategory::Mention);
    let json = serde_json::to_value(&item).expect("feed item should serialize");

    assert_eq!(json["category"], "mention");
    assert_eq!(json["id"], event.id.to_hex());
}
