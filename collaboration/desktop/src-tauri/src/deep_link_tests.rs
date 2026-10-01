use url::Url;

use super::{
    parse_channel_deep_link, parse_message_deep_link, PendingNavigationDeepLink,
    PendingNavigationDeepLinks,
};

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
