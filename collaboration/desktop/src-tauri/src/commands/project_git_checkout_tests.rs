use super::*;

fn coordinate(name: &str) -> String {
    format!("30617:{}:{name}", "a".repeat(64))
}

#[test]
fn checkout_partition_is_community_and_full_repository_scoped() {
    let a = partition("https://community-a.invalid", &coordinate("repo")).unwrap();
    assert_ne!(
        a,
        partition("https://community-b.invalid", &coordinate("repo")).unwrap()
    );
    assert_ne!(
        a,
        partition("https://community-a.invalid", &coordinate("other")).unwrap()
    );
    assert_ne!(
        a,
        partition(
            "https://community-a.invalid",
            &format!("30617:{}:repo", "b".repeat(64))
        )
        .unwrap()
    );
    assert!(partition("https://community-a.invalid", "../../outside").is_err());
    assert!(partition("https://community-a.invalid", &coordinate("../outside")).is_err());
}

#[test]
fn checkout_location_never_accepts_a_frontend_filesystem_path() {
    let root = tempfile::tempdir().unwrap();
    let path = checkout_path(
        root.path(),
        "https://community.invalid",
        &coordinate("repo"),
    )
    .unwrap();
    assert!(path.starts_with(root.path()));
    assert!(path.parent().unwrap().is_dir());
    assert!(!path.exists());
    assert_eq!(
        map_checkout_error(CHECKOUT_OUTCOME_UNKNOWN),
        CHECKOUT_OUTCOME_UNKNOWN
    );
    assert_eq!(
        map_checkout_error("remote included sensitive diagnostic"),
        REPO_FAILED
    );
}

#[cfg(unix)]
#[test]
fn checkout_symlink_escape_is_refused() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("project-checkouts")).unwrap();
    assert!(checkout_path(
        root.path(),
        "https://community.invalid",
        &coordinate("repo")
    )
    .is_err());
}

#[test]
fn external_terminal_never_inherits_identity_or_credentials() {
    // DD-161(3): the OS terminal opened at a checkout gets no key, token or
    // Kailo/Buzz context; ordinary shell variables survive.
    for name in [
        "BUZZ_PRIVATE_KEY",
        "BUZZ_AUTH_TAG",
        "KAILO_SESSION",
        "PLATFORM_ISSUER",
        "GITHUB_TOKEN",
        "AWS_SECRET_ACCESS_KEY",
        "some_password",
        "NOSTR_NSEC",
    ] {
        assert!(secret_bearing_env(name), "{name} must be removed");
    }
    for name in ["PATH", "HOME", "LANG", "DISPLAY", "TERM", "SHELL", "XDG_RUNTIME_DIR"] {
        assert!(!secret_bearing_env(name), "{name} must be kept");
    }
}
