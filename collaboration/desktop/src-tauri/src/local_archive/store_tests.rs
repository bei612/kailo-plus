use super::*;
use nostr::{EventBuilder, Kind, Tag};

fn store() -> ArchiveStore {
    ArchiveStore::open(Connection::open_in_memory().unwrap(), Keys::generate()).unwrap()
}

fn message(author: &Keys, channel: &str, content: &str) -> Event {
    EventBuilder::new(Kind::Custom(9), content)
        .tag(Tag::parse(["h", channel]).unwrap())
        .sign_with_keys(author)
        .unwrap()
}

#[test]
fn stores_only_ciphertext_and_reopens_the_exact_event() {
    let archive = store();
    let author = Keys::generate();
    archive.subscribe("chan", &[9], 1).unwrap();
    let event = message(&author, "chan", "top secret plan");
    assert_eq!(archive.ingest("chan", &[event.clone()]).unwrap(), 1);
    let sealed: String = archive
        .conn
        .query_row("SELECT sealed FROM archived_event", [], |row| row.get(0))
        .unwrap();
    assert!(!sealed.contains("top secret"), "no plaintext at rest");
    assert_eq!(archive.read("chan", 10).unwrap(), vec![event]);
}

#[test]
fn another_identity_key_cannot_open_the_archive() {
    let conn_path = tempfile::NamedTempFile::new().unwrap();
    let author = Keys::generate();
    {
        let archive = ArchiveStore::open(Connection::open(conn_path.path()).unwrap(), Keys::generate()).unwrap();
        archive.ingest("chan", &[message(&author, "chan", "hello")]).unwrap();
    }
    let other = ArchiveStore::open(Connection::open(conn_path.path()).unwrap(), Keys::generate()).unwrap();
    assert!(other.read("chan", 10).is_err());
}

#[test]
fn large_events_round_trip_through_ordered_chunks() {
    let archive = store();
    let author = Keys::generate();
    let body = "长".repeat(50_000);
    let event = message(&author, "chan", &body);
    archive.ingest("chan", &[event.clone()]).unwrap();
    assert_eq!(archive.read("chan", 1).unwrap(), vec![event]);
}

#[test]
fn ignores_events_outside_the_channel_or_with_bad_signatures() {
    let archive = store();
    let author = Keys::generate();
    let foreign = message(&author, "other", "x");
    assert_eq!(archive.ingest("chan", &[foreign]).unwrap(), 0);
    let mut forged = serde_json::to_value(message(&author, "chan", "x")).unwrap();
    forged["content"] = serde_json::json!("tampered");
    let forged: Event = serde_json::from_value(forged).unwrap();
    assert_eq!(archive.ingest("chan", &[forged]).unwrap(), 0);
}

#[test]
fn deletions_remove_the_archived_target() {
    let archive = store();
    let author = Keys::generate();
    let target = message(&author, "chan", "oops");
    archive.ingest("chan", &[target.clone()]).unwrap();
    let deletion = EventBuilder::new(Kind::Custom(9005), "")
        .tag(Tag::parse(["h", "chan"]).unwrap())
        .tag(Tag::parse(["e", &target.id.to_hex()]).unwrap())
        .sign_with_keys(&author)
        .unwrap();
    archive.ingest("chan", &[deletion]).unwrap();
    assert!(!archive.has_event(&target.id.to_hex()).unwrap());
    // A descending history page or an interrupted retry may replay the older
    // target after the delete. It must never resurrect the local copy.
    assert_eq!(archive.ingest("chan", &[target.clone()]).unwrap(), 0);
    assert!(!archive.has_event(&target.id.to_hex()).unwrap());
}

#[test]
fn deletion_before_target_in_one_page_stays_deleted() {
    let archive = store();
    let author = Keys::generate();
    let target = message(&author, "chan", "deleted before first sync");
    let deletion = EventBuilder::new(Kind::Custom(5), "")
        .tag(Tag::parse(["h", "chan"]).unwrap())
        .tag(Tag::parse(["e", &target.id.to_hex()]).unwrap())
        .sign_with_keys(&author).unwrap();
    archive.ingest("chan", &[deletion, target.clone()]).unwrap();
    assert!(!archive.has_event(&target.id.to_hex()).unwrap());
}

#[test]
fn incomplete_history_resumes_after_reopen_without_advancing_watermark() {
    let file = tempfile::NamedTempFile::new().unwrap();
    let key = Keys::generate();
    {
        let archive = ArchiveStore::open(Connection::open(file.path()).unwrap(), key.clone()).unwrap();
        archive.subscribe("chan", &[9], 1).unwrap();
        archive.save_page("chan", 42, "event-id", 100).unwrap();
        archive.record_sync("chan", "retry", None, 2).unwrap();
    }
    let archive = ArchiveStore::open(Connection::open(file.path()).unwrap(), key).unwrap();
    assert_eq!(archive.subscription("chan").unwrap().unwrap().cursor, 0);
    assert_eq!(archive.page_cursor("chan").unwrap(), Some((42, "event-id".into(), 100)));
    archive.finish_pages("chan", 100, 3).unwrap();
    assert!(archive.page_cursor("chan").unwrap().is_none());
    assert_eq!(archive.subscription("chan").unwrap().unwrap().cursor, 100);
}

#[test]
fn excludes_observer_and_metrics_even_if_relay_returns_them() {
    let archive = store();
    let author = Keys::generate();
    for kind in [24200, 44200] {
        let event = EventBuilder::new(Kind::Custom(kind), "private observation")
            .tag(Tag::parse(["h", "chan"]).unwrap()).sign_with_keys(&author).unwrap();
        assert_eq!(archive.ingest("chan", &[event]).unwrap(), 0);
    }
}

#[test]
fn unsubscribe_purges_the_channel_and_counts_follow_rows() {
    let archive = store();
    let author = Keys::generate();
    archive.subscribe("chan", &[9, 7], 1).unwrap();
    archive.subscribe("keep", &[9], 2).unwrap();
    archive.ingest("chan", &[message(&author, "chan", "a")]).unwrap();
    archive.ingest("keep", &[message(&author, "keep", "b")]).unwrap();
    assert_eq!(archive.subscription("chan").unwrap().unwrap().event_count, 1);
    archive.unsubscribe("chan").unwrap();
    assert!(archive.subscription("chan").unwrap().is_none());
    assert!(archive.read("chan", 10).unwrap().is_empty());
    assert_eq!(archive.read("keep", 10).unwrap().len(), 1);
}

#[test]
fn rejects_kinds_outside_the_archivable_set() {
    let archive = store();
    assert!(archive.subscribe("chan", &[24200], 1).is_err());
    assert!(archive.subscribe("chan", &[], 1).is_err());
    archive.subscribe("chan", &[9, 9, 7], 1).unwrap();
    assert_eq!(archive.subscription("chan").unwrap().unwrap().kinds, vec![7, 9]);
}

#[test]
fn record_sync_keeps_the_cursor_monotonic() {
    let archive = store();
    archive.subscribe("chan", &[9], 1).unwrap();
    archive.record_sync("chan", "ok", Some(50), 10).unwrap();
    archive.record_sync("chan", "retry", Some(20), 11).unwrap();
    let sub = archive.subscription("chan").unwrap().unwrap();
    assert_eq!((sub.cursor, sub.last_result.as_str(), sub.last_sync_at), (50, "retry", Some(11)));
}
