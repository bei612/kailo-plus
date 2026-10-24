use super::*;
use base64::Engine as _;
use nostr::{Event, JsonUtil, Keys};

fn coordinate(d: &str) -> String {
    format!("30617:{}:{d}", "a".repeat(64))
}

#[test]
fn only_exact_relay_repository_coordinates_name_a_repository() {
    assert_eq!(
        repository_path(&coordinate("repo")).as_deref(),
        Some(format!("/git/{}/repo", "a".repeat(64)).as_str())
    );
    let owner = "a".repeat(64);
    for bad in [
        format!("30617:{}:repo", "A".repeat(64)),
        format!("30617:{}:repo", "a".repeat(63)),
        format!("30617:{owner}:"),
        format!("30617:{owner}:../x"),
        format!("30617:{owner}:a/b"),
        format!("30617:{owner}:.hidden"),
        format!("30617:{owner}:a..b"),
        format!("30617:{owner}:repo.git"),
        format!("30617:{owner}:{}", "r".repeat(65)),
        format!("30617:{owner}:re po"),
        format!("30617:{owner}:repo?x=1"),
        format!("30618:{owner}:repo"),
        "https://relay.example/git/x/repo".to_string(),
    ] {
        assert!(repository_path(&bad).is_none(), "{bad}");
    }
}

#[test]
fn webview_cannot_supply_a_clone_url_or_malformed_refs() {
    let ok = checked_read(&coordinate("repo"), Some("main".into()), None, None, None).unwrap();
    assert_eq!(ok.repo_path, format!("/git/{}/repo", "a".repeat(64)));
    assert_eq!(
        checked_read("https://evil.example/repo.git", None, None, None, None).unwrap_err(),
        REPO_INVALID_REQUEST
    );
    let long = "b".repeat(256);
    assert!(checked_read(&coordinate("repo"), Some(long.clone()), None, None, None).is_err());
    assert!(checked_read(&coordinate("repo"), None, Some(String::new()), None, None).is_err());
    assert!(checked_read(&coordinate("repo"), None, None, Some(long), None).is_err());
    assert!(checked_read(&coordinate("repo"), None, None, None, Some("abc".into())).is_err());
    assert!(checked_read(&coordinate("repo"), None, None, None, Some("A".repeat(40))).is_err());
    assert!(checked_read(&coordinate("repo"), None, None, None, Some("a".repeat(40))).is_ok());
    assert!(checked_read(&coordinate("repo"), None, None, None, Some("a".repeat(64))).is_ok());
}

#[test]
fn file_paths_follow_the_shared_validation() {
    assert!(checked_path("src/main.rs").is_ok());
    assert!(checked_path("").is_err());
    assert!(checked_path("../etc/passwd").is_err());
    assert!(checked_path(&"x".repeat(4097)).is_err());
}

#[test]
fn git_authorization_is_a_fresh_nip98_for_the_repository_root_only() {
    let keys = Keys::generate();
    let root = format!("https://relay.example/git/{}/repo", "a".repeat(64));
    let decode = |header: String| -> Event {
        let encoded = header.strip_prefix("Nostr ").expect("Nostr scheme");
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .expect("base64");
        Event::from_json(String::from_utf8(bytes).expect("utf8")).expect("event")
    };
    let first = decode(git_authorization(&keys, &root).unwrap());
    first.verify().expect("signed");
    assert_eq!(first.kind, Kind::HttpAuth);
    assert_eq!(first.pubkey, keys.public_key());
    let tag = |event: &Event, name: &str| {
        event
            .tags
            .iter()
            .find(|tag| tag.as_slice().first().map(String::as_str) == Some(name))
            .and_then(|tag| tag.as_slice().get(1).cloned())
    };
    assert_eq!(tag(&first, "u").as_deref(), Some(root.as_str()));
    assert_eq!(tag(&first, "method").as_deref(), Some("GET"));
    // No private material in the header.
    let secret = keys.secret_key().to_secret_hex();
    assert!(!first.as_json().contains(&secret));
}

#[test]
fn git_failures_reach_the_webview_only_as_stable_codes() {
    assert_eq!(git_error("git timed out after 60s"), REPO_TIMEOUT);
    assert_eq!(
        git_error("fatal: unable to access 'https://relay.example/git/x/repo/': secret"),
        REPO_FAILED
    );
}
