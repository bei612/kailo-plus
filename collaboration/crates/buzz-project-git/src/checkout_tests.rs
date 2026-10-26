use super::*;
use crate::exec::{test_auth_config, GitAuth};
use std::fs;

fn auth() -> GitAuthConfig {
    test_auth_config(GitAuth::Header {
        authorization: Box::new(|| Ok("Nostr test".into())),
        host: None,
    })
}
fn init(root: &Path, auth: &GitAuthConfig) -> (String, std::path::PathBuf) {
    let remote = root.join("remote.git");
    run_git(
        &[
            "init",
            "--bare",
            "--initial-branch=main",
            "--",
            remote.to_str().unwrap(),
        ],
        None,
        auth,
    )
    .unwrap();
    (remote.to_str().unwrap().into(), root.join("checkout"))
}
fn commit(repo: &Path, content: &str, auth: &GitAuthConfig) {
    fs::write(repo.join("README.md"), content).unwrap();
    run_git(&["add", "README.md"], Some(repo), auth).unwrap();
    run_git(
        &[
            "-c",
            "user.name=Buzz Test",
            "-c",
            "user.email=test@example.com",
            "commit",
            "-m",
            content,
        ],
        Some(repo),
        auth,
    )
    .unwrap();
}

#[test]
fn clone_status_push_pull_keep_original_local_workflow() {
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    assert!(
        clone_checkout(&repo, &remote, Some("main"), &auth)
            .unwrap()
            .cloned
    );
    assert!(
        !clone_checkout(&repo, &remote, Some("main"), &auth)
            .unwrap()
            .cloned
    );
    assert_eq!(
        fs::read_to_string(repo.join(".git/HEAD")).unwrap().trim(),
        "ref: refs/heads/main"
    );
    assert!(checkout_status(&repo, &remote, Some("main"), None, &auth)
        .unwrap()
        .local_head
        .is_none());
    commit(&repo, "initial", &auth);
    assert!(
        checkout_status(&repo, &remote, Some("main"), None, &auth)
            .unwrap()
            .can_push
    );
    assert!(
        push_checkout(&repo, &remote, Some("main"), None, &auth)
            .unwrap()
            .pushed
    );
    let second = temp.path().join("second");
    clone_checkout(&second, &remote, Some("main"), &auth).unwrap();
    commit(&second, "next", &auth);
    push_checkout(&second, &remote, Some("main"), None, &auth).unwrap();
    let status = checkout_status(&repo, &remote, Some("main"), None, &auth).unwrap();
    assert_eq!(status.behind_count, 1);
    assert!(status.can_pull);
    assert!(!status.can_push);
    pull_checkout(&repo, &remote, Some("main"), &auth).unwrap();
    assert_eq!(fs::read_to_string(repo.join("README.md")).unwrap(), "next");
    fs::write(repo.join("untracked.txt"), "local").unwrap();
    let status = checkout_status(&repo, &remote, Some("main"), None, &auth).unwrap();
    assert!(status.has_untracked_files);
    assert!(!status.can_push);
    let snapshot = checkout_snapshot(&repo, &remote, Some("main"), None, &auth).unwrap();
    assert!(snapshot.snapshot.files.iter().any(
        |file| file.path == "untracked.txt" && file.preview_content.as_deref() == Some("local")
    ));
    let head = status.local_head.unwrap();
    let diff = checkout_diff(&repo, &remote, None, None, None, Some(head), &auth).unwrap();
    assert!(diff.files.iter().any(|file| file.path == "README.md"));
}

#[test]
fn status_fails_closed_when_remote_fetch_cannot_be_verified() {
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    clone_checkout(&repo, &remote, Some("main"), &auth).unwrap();
    commit(&repo, "initial", &auth);
    fs::remove_dir_all(&remote).unwrap();
    assert!(checkout_status(&repo, &remote, Some("main"), None, &auth).is_err());
    assert!(push_checkout(&repo, &remote, Some("main"), None, &auth).is_err());
}

#[test]
fn wrong_branch_clone_fails_without_publishing_partial_checkout() {
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    clone_checkout(&repo, &remote, Some("main"), &auth).unwrap();
    commit(&repo, "initial", &auth);
    push_checkout(&repo, &remote, Some("main"), None, &auth).unwrap();
    let missing = temp.path().join("missing");
    assert!(clone_checkout(&missing, &remote, Some("missing"), &auth).is_err());
    assert!(!missing.exists());
    assert!(clone_checkout(&missing, &remote, Some("--upload-pack=bad"), &auth).is_err());
}

#[test]
fn local_configuration_cannot_redirect_fresh_authorization() {
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    clone_checkout(&repo, &remote, Some("main"), &auth).unwrap();
    let config = repo.join(".git/config");
    let original = fs::read_to_string(&config).unwrap();
    for injection in [
        "\n[url \"https://other.invalid\"]\n insteadOf = file:\n",
        "\n[include]\n path = /tmp/other-config\n",
        "\n[remote \"origin\"]\n pushurl = https://other.invalid\n",
        "\n[filter \"x\"]\n process = evil\n",
    ] {
        fs::write(&config, format!("{original}{injection}")).unwrap();
        assert!(validate_checkout(&repo, &remote, &auth).is_err());
    }
    fs::write(&config, original).unwrap();
    validate_checkout(&repo, &remote, &auth).unwrap();
}

#[test]
fn clone_obeys_whole_request_deadline_without_publishing_checkout() {
    let auth = auth().with_deadline(std::time::Instant::now());
    let temp = tempfile::tempdir().unwrap();
    let repo = temp.path().join("checkout");
    let error = clone_checkout(
        &repo,
        "https://unused.invalid/git/repo",
        Some("main"),
        &auth,
    )
    .err()
    .unwrap();
    assert!(crate::is_timeout_error(&error));
    assert!(!repo.exists());
}

#[cfg(unix)]
#[test]
fn metadata_and_preview_symlinks_cannot_escape_checkout() {
    use std::os::unix::fs::symlink;
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    clone_checkout(&repo, &remote, Some("main"), &auth).unwrap();
    let outside = temp.path().join("outside");
    fs::write(&outside, "private").unwrap();
    symlink(&outside, repo.join("link")).unwrap();
    let snapshot = checkout_snapshot(&repo, &remote, None, None, &auth).unwrap();
    assert!(snapshot
        .snapshot
        .files
        .iter()
        .all(|file| file.preview_content.as_deref() != Some("private")));
    let config = repo.join(".git/config");
    let saved = temp.path().join("config");
    fs::rename(&config, &saved).unwrap();
    symlink(saved, config).unwrap();
    assert!(validate_checkout(&repo, &remote, &auth).is_err());
}

#[test]
fn first_push_aligns_legacy_master_without_overwriting_an_existing_branch() {
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    clone_checkout(&repo, &remote, Some("master"), &auth).unwrap();
    commit(&repo, "initial", &auth);
    run_git(&["branch", "main"], Some(&repo), &auth).unwrap();
    assert!(push_checkout(&repo, &remote, Some("main"), None, &auth).is_err());
    assert_eq!(
        run_git(&["branch", "--show-current"], Some(&repo), &auth)
            .unwrap()
            .trim(),
        "master"
    );
    run_git(&["branch", "-d", "main"], Some(&repo), &auth).unwrap();
    assert!(
        push_checkout(&repo, &remote, Some("main"), None, &auth)
            .unwrap()
            .pushed
    );
    assert_eq!(
        run_git(&["branch", "--show-current"], Some(&repo), &auth)
            .unwrap()
            .trim(),
        "main"
    );
}

fn stop_after_intent_is_durable(repo: &Path) -> GitAuthConfig {
    let intent_file = repo.join(".git/kailo-push-intent");
    test_auth_config(GitAuth::Header {
        authorization: Box::new(move || {
            if intent_file.exists() {
                Err("simulated lost session after write-ahead".into())
            } else {
                Ok("Nostr test".into())
            }
        }),
        host: None,
    })
}

#[test]
fn pending_push_survives_restart_and_head_changes_without_changing_intent() {
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    clone_checkout(&repo, &remote, Some("main"), &auth).unwrap();
    commit(&repo, "initial", &auth);
    push_checkout(&repo, &remote, Some("main"), None, &auth).unwrap();
    let old = checked_head(&repo, "HEAD", &auth).unwrap();
    commit(&repo, "frozen", &auth);
    let frozen = checked_head(&repo, "HEAD", &auth).unwrap().unwrap();
    let result = push_checkout(
        &repo,
        &remote,
        Some("main"),
        None,
        &stop_after_intent_is_durable(&repo),
    );
    assert_eq!(result.err().as_deref(), Some(CHECKOUT_OUTCOME_UNKNOWN));
    let pending = intent::read(&repo, &remote).unwrap().unwrap();
    assert_eq!(pending.old, old);
    assert_eq!(pending.new, frozen);
    let original_bytes = fs::read(repo.join(".git/kailo-push-intent")).unwrap();
    let disconnected = temp.path().join("disconnected.git");
    fs::rename(&remote, &disconnected).unwrap();
    let status = checkout_status(&repo, &remote, Some("main"), None, &auth).unwrap();
    assert_eq!(status.pending_push.unwrap().outcome, "unknown");
    assert!(!status.can_push);
    assert_eq!(
        push_checkout(&repo, &remote, Some("main"), None, &auth)
            .err()
            .as_deref(),
        Some(CHECKOUT_OUTCOME_UNKNOWN)
    );
    assert_eq!(
        fs::read(repo.join(".git/kailo-push-intent")).unwrap(),
        original_bytes
    );
    fs::rename(disconnected, &remote).unwrap();
    // A new call reconstructs everything from disk, as after process restart.
    // New local work must not silently replace the old unconfirmed operation.
    commit(&repo, "newer local work", &auth);
    let current = checked_head(&repo, "HEAD", &auth).unwrap().unwrap();
    assert_ne!(current, frozen);
    let status = checkout_status(&repo, &remote, Some("main"), None, &auth).unwrap();
    assert!(status.can_push);
    assert_eq!(status.pending_push.unwrap().new_commit, frozen);
    let result = push_checkout(&repo, &remote, Some("main"), None, &auth).unwrap();
    assert_eq!(result.commit, frozen);
    assert_eq!(
        intent::observe(&repo, &pending, &auth).unwrap().as_deref(),
        Some(frozen.as_str())
    );
    assert!(intent::read(&repo, &remote).unwrap().is_none());
    assert_eq!(
        checked_head(&repo, "HEAD", &auth).unwrap().as_deref(),
        Some(current.as_str())
    );
}

#[test]
fn pending_push_conflict_is_preserved_and_never_replaced_or_replayed() {
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    clone_checkout(&repo, &remote, Some("main"), &auth).unwrap();
    commit(&repo, "initial", &auth);
    push_checkout(&repo, &remote, Some("main"), None, &auth).unwrap();
    let other = temp.path().join("other");
    clone_checkout(&other, &remote, Some("main"), &auth).unwrap();
    commit(&repo, "frozen", &auth);
    assert_eq!(
        push_checkout(
            &repo,
            &remote,
            Some("main"),
            None,
            &stop_after_intent_is_durable(&repo)
        )
        .err()
        .as_deref(),
        Some(CHECKOUT_OUTCOME_UNKNOWN)
    );
    let bytes = fs::read(repo.join(".git/kailo-push-intent")).unwrap();
    commit(&other, "someone else", &auth);
    let other_head = push_checkout(&other, &remote, Some("main"), None, &auth)
        .unwrap()
        .commit;
    let status = checkout_status(&repo, &remote, Some("main"), None, &auth).unwrap();
    assert!(!status.can_push);
    assert!(!status.can_pull);
    assert_eq!(status.pending_push.unwrap().outcome, "conflict");
    assert_eq!(
        push_checkout(&repo, &remote, Some("main"), None, &auth)
            .err()
            .as_deref(),
        Some(CHECKOUT_CONFLICT)
    );
    assert_eq!(
        fs::read(repo.join(".git/kailo-push-intent")).unwrap(),
        bytes
    );
    let pending = intent::read(&repo, &remote).unwrap().unwrap();
    assert_eq!(
        intent::observe(&repo, &pending, &auth).unwrap().as_deref(),
        Some(other_head.as_str())
    );
    assert!(intent::persist(&repo, &pending).is_err());
    assert_eq!(
        fs::read(repo.join(".git/kailo-push-intent")).unwrap(),
        bytes
    );
}
