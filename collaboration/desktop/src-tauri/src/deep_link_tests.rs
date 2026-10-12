use url::Url;

use super::{
    canonical_entity_deep_link, parse_channel_deep_link, parse_entity_deep_link,
    parse_message_deep_link, PendingEntityDeepLinks, PendingNavigationDeepLink,
    PendingNavigationDeepLinks, ENTITY_LINK_TABS,
};

fn entity_link_golden() -> serde_json::Value {
    serde_json::from_str(include_str!("../../../test-fixtures/entity-links.json"))
        .expect("valid entity-links golden fixture")
}

#[test]
fn demo_entity_transport_produces_the_frontend_golden_contract() {
    let golden = entity_link_golden();
    let scheme = "buzz-demo-board-1234567812345678";
    for canonical in golden["links"].as_object().unwrap().values() {
        let canonical = canonical.as_str().unwrap();
        let transport = Url::parse(&canonical.replacen("buzz:", &format!("{scheme}:"), 1)).unwrap();
        let href = canonical_entity_deep_link(&transport, scheme).unwrap();
        // This same fixture is parsed and routed by the frontend entity tests.
        assert_eq!(href, canonical);
        let queue = PendingEntityDeepLinks::default();
        let pending = queue.enqueue(href);
        assert_eq!(queue.first().unwrap().href, canonical);
        assert!(queue.acknowledge(&pending.id));
        assert!(queue.first().is_none());
        assert!(canonical_entity_deep_link(&transport, "buzz").is_none());
        assert!(
            canonical_entity_deep_link(&transport, "buzz-demo-other-8765432187654321").is_none()
        );
        assert!(canonical_entity_deep_link(&Url::parse(canonical).unwrap(), scheme).is_none());
        assert_eq!(
            canonical_entity_deep_link(&Url::parse(canonical).unwrap(), "buzz").as_deref(),
            Some(canonical)
        );
    }
    let invalid = Url::parse(&format!("{scheme}://repo?owner=bad&d=repo")).unwrap();
    assert!(canonical_entity_deep_link(&invalid, scheme).is_none());
}

#[test]
fn parse_entity_deep_link_accepts_every_share_link_shape() {
    let golden = entity_link_golden();
    let owner = golden["owner"].as_str().unwrap();
    let dtag = golden["dtag"].as_str().unwrap();
    for raw in golden["links"]
        .as_object()
        .unwrap()
        .values()
        .map(|value| value.as_str().unwrap().to_owned())
        .chain(golden["tabs"].as_array().unwrap().iter().map(|tab| {
            format!(
                "buzz://repo?owner={owner}&d={dtag}&tab={}",
                tab.as_str().unwrap()
            )
        }))
    {
        assert!(
            parse_entity_deep_link(&Url::parse(&raw).unwrap()).is_some(),
            "{raw}"
        );
    }
    let commit_link = format!(
        "buzz://repo?owner={owner}&d={dtag}&tab=commits&commit={}",
        golden["eventId"].as_str().unwrap()
    );
    assert!(parse_entity_deep_link(&Url::parse(&commit_link).unwrap()).is_some());
    let expected_tabs = golden["tabs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|tab| tab.as_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(ENTITY_LINK_TABS.as_slice(), expected_tabs);
}

#[test]
fn parse_entity_deep_link_rejects_malformed_and_non_canonical_links() {
    let golden = entity_link_golden();
    let owner = golden["owner"].as_str().unwrap();
    let event_id = golden["eventId"].as_str().unwrap();
    for raw in [
        // Missing or malformed identifiers.
        format!("buzz://repo?owner={owner}"),
        "buzz://repo?owner=nope&d=buzz-world".to_owned(),
        format!("buzz://repo?owner={owner}&d=.hidden"),
        format!("buzz://repo?owner={owner}&d=has%20space"),
        format!("buzz://pr?owner={owner}&d=buzz-world"),
        format!("buzz://pr?id=short&owner={owner}&d=buzz-world"),
        // Coordinate links take no event id.
        format!("buzz://repo?id={event_id}&owner={owner}&d=buzz-world"),
        // Non-canonical: unknown param, duplicate param, path, fragment.
        format!("buzz://repo?owner={owner}&d=buzz-world&relay=wss%3A%2F%2Fx.example"),
        format!("buzz://repo?owner={owner}&owner={owner}&d=buzz-world"),
        // Unknown tab value, duplicate tab, and tab on an event link.
        format!("buzz://repo?owner={owner}&d=buzz-world&tab=overview"),
        format!("buzz://repo?owner={owner}&d=buzz-world&tab=prs&tab=prs"),
        format!("buzz://repo?owner={owner}&d=buzz-world&tab=files&commit={event_id}"),
        format!("buzz://repo?owner={owner}&d=buzz-world&tab=commits&commit=short"),
        format!("buzz://pr?id={event_id}&owner={owner}&d=buzz-world&tab=prs"),
        format!("buzz://repo/extra?owner={owner}&d=buzz-world"),
        format!("buzz://repo?owner={owner}&d=buzz-world#top"),
        // Not an entity host.
        format!("buzz://message?owner={owner}&d=buzz-world"),
    ] {
        assert!(
            parse_entity_deep_link(&Url::parse(&raw).unwrap()).is_none(),
            "{raw}"
        );
    }
}

#[test]
fn pending_entity_links_dedupe_and_clear_at_identity_change() {
    let queue = PendingEntityDeepLinks::default();
    let href = "buzz://issue?owner=aa&d=first".to_owned();
    let first = queue.enqueue(href.clone());
    assert_eq!(queue.enqueue(href), first);
    assert!(!queue.acknowledge("wrong-head"));
    assert_eq!(queue.first(), Some(first));
    queue.clear();
    assert!(queue.first().is_none());
}

fn pending_navigation(
    id: &str,
    kind: &str,
    channel_id: &str,
    message_id: Option<&str>,
    thread_root_id: Option<&str>,
) -> PendingNavigationDeepLink {
    PendingNavigationDeepLink {
        id: id.to_owned(),
        kind: kind.to_owned(),
        channel_id: channel_id.to_owned(),
        message_id: message_id.map(str::to_owned),
        thread_root_id: thread_root_id.map(str::to_owned),
    }
}

#[test]
fn pending_navigation_links_are_fifo_acknowledged_and_deduplicated() {
    let queue = PendingNavigationDeepLinks::default();
    queue.enqueue(pending_navigation(
        "first",
        "channel",
        "channel-1",
        None,
        None,
    ));
    queue.enqueue(pending_navigation(
        "duplicate",
        "channel",
        "channel-1",
        None,
        None,
    ));
    queue.enqueue(pending_navigation(
        "second",
        "message",
        "channel-1",
        Some("message-1"),
        Some("root-1"),
    ));

    assert_eq!(queue.first().unwrap().id, "first");
    assert!(!queue.acknowledge("second"));
    assert!(queue.acknowledge("first"));
    assert_eq!(queue.first().unwrap().id, "second");
    assert!(queue.acknowledge("second"));
    assert!(queue.first().is_none());
}

#[test]
fn pending_navigation_links_can_be_cleared() {
    let queue = PendingNavigationDeepLinks::default();
    queue.enqueue(pending_navigation(
        "first",
        "channel",
        "channel-1",
        None,
        None,
    ));
    queue.enqueue(pending_navigation(
        "second",
        "message",
        "channel-1",
        Some("message-1"),
        None,
    ));

    queue.clear();
    assert!(queue.first().is_none());
}

#[test]
fn pending_navigation_queue_recovers_after_mutex_poisoning() {
    let queue = std::sync::Arc::new(PendingNavigationDeepLinks::default());
    let poisoner = std::sync::Arc::clone(&queue);
    assert!(std::thread::spawn(move || {
        let _guard = poisoner.0.lock().unwrap();
        panic!("poison queue for recovery regression");
    })
    .join()
    .is_err());

    queue.enqueue(pending_navigation(
        "after-poison",
        "channel",
        "channel-1",
        None,
        None,
    ));
    assert_eq!(queue.first().unwrap().id, "after-poison");
    assert!(queue.acknowledge("after-poison"));
    assert!(queue.first().is_none());
}

#[test]
fn parse_channel_deep_link_accepts_one_path_segment() {
    let url = Url::parse("buzz://channel/580ca78b-9dae-46f3-8854-bd671853ba32").unwrap();
    let payload = parse_channel_deep_link(&url).unwrap();
    assert_eq!(payload["channelId"], "580ca78b-9dae-46f3-8854-bd671853ba32");
}

#[test]
fn parse_channel_deep_link_accepts_message_path() {
    let message_id = "8455293f0123456789abcdef0123456789abcdef0123456789abcdef01234567";
    let url = Url::parse(&format!(
        "buzz://channel/a372f080-5961-4535-b1a3-edffface377d/{message_id}"
    ))
    .unwrap();
    let payload = parse_channel_deep_link(&url).unwrap();
    assert_eq!(payload["channelId"], "a372f080-5961-4535-b1a3-edffface377d");
    assert_eq!(payload["messageId"], message_id);
}

#[test]
fn parse_channel_deep_link_accepts_v7_and_normalizes_uppercase() {
    for (raw, expected) in [
        (
            "buzz://channel/018fdb5d-3a64-7c35-b5f9-4a23e1f9d2d9",
            "018fdb5d-3a64-7c35-b5f9-4a23e1f9d2d9",
        ),
        (
            "buzz://channel/580CA78B-9DAE-46F3-8854-BD671853BA32",
            "580ca78b-9dae-46f3-8854-bd671853ba32",
        ),
    ] {
        let payload = parse_channel_deep_link(&Url::parse(raw).unwrap()).unwrap();
        assert_eq!(payload["channelId"], expected);
    }
}

#[test]
fn parse_channel_deep_link_rejects_malformed_forms() {
    for raw in [
        "buzz://channel",
        "buzz://channel/",
        "buzz://channel/one/two",
        "buzz://channel/580ca78b-9dae-46f3-8854-bd671853ba32/not-hex",
        "buzz://channel/580ca78b-9dae-46f3-8854-bd671853ba32/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "buzz://channel/580ca78b-9dae-46f3-8854-bd671853ba32/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/extra",
        "buzz://channel/580ca78b-9dae-46f3-8854-bd671853ba32/",
        "buzz://channel/one?extra=true",
        "buzz://channel/one#fragment",
        "buzz://:pass@channel/580ca78b-9dae-46f3-8854-bd671853ba32/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "buzz://channel/not-a-uuid",
        "buzz://channel/%2F",
        "buzz://channel/%00",
    ] {
        assert!(parse_channel_deep_link(&Url::parse(raw).unwrap()).is_none());
    }
}

#[test]
fn parse_message_deep_link_extracts_required_params() {
    let url = Url::parse("buzz://message?channel=abc&id=xyz").unwrap();
    let payload = parse_message_deep_link(&url).expect("required params present");
    assert_eq!(payload["channelId"], "abc");
    assert_eq!(payload["messageId"], "xyz");
    assert!(payload["threadRootId"].is_null());
}

#[test]
fn parse_message_deep_link_accepts_buzz_scheme() {
    let url = Url::parse("buzz://message?channel=abc&id=xyz").unwrap();
    let payload = parse_message_deep_link(&url).expect("required params present");
    assert_eq!(payload["channelId"], "abc");
    assert_eq!(payload["messageId"], "xyz");
}

#[test]
fn parse_message_deep_link_includes_thread_root() {
    let url = Url::parse("buzz://message?channel=abc&id=xyz&thread=root1").unwrap();
    let payload = parse_message_deep_link(&url).expect("required params present");
    assert_eq!(payload["threadRootId"], "root1");
}

#[test]
fn parse_message_deep_link_rejects_missing_id() {
    let url = Url::parse("buzz://message?channel=abc").unwrap();
    assert!(parse_message_deep_link(&url).is_none());
}

#[test]
fn parse_message_deep_link_rejects_empty_channel() {
    // Regression: `channel=&id=foo` previously produced channelId: "".
    let url = Url::parse("buzz://message?channel=&id=foo").unwrap();
    assert!(parse_message_deep_link(&url).is_none());
}

#[test]
fn parse_message_deep_link_rejects_empty_id() {
    let url = Url::parse("buzz://message?channel=abc&id=").unwrap();
    assert!(parse_message_deep_link(&url).is_none());
}

#[test]
fn parse_message_deep_link_treats_empty_thread_as_absent() {
    let url = Url::parse("buzz://message?channel=abc&id=xyz&thread=").unwrap();
    let payload = parse_message_deep_link(&url).expect("required params present");
    assert!(payload["threadRootId"].is_null());
}
