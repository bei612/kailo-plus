use super::*;
use crate::exec::{test_auth_config, GitAuth};
use std::fs;

fn auth() -> GitAuthConfig {
    test_auth_config(GitAuth::Header { authorization: Box::new(|| Ok("Nostr test".into())), host: None })
}
fn init(root: &Path, auth: &GitAuthConfig) -> (String, std::path::PathBuf) {
    let remote = root.join("remote.git");
    run_git(&["init", "--bare", "--initial-branch=main", "--", remote.to_str().unwrap()], None, auth).unwrap();
    (remote.to_str().unwrap().into(), root.join("checkout"))
}
fn commit(repo: &Path, content: &str, auth: &GitAuthConfig) {
    fs::write(repo.join("README.md"), content).unwrap();
    run_git(&["add", "README.md"], Some(repo), auth).unwrap();
    run_git(&["-c", "user.name=Buzz Test", "-c", "user.email=test@example.com", "commit", "-m", content], Some(repo), auth).unwrap();
}

#[test]
fn clone_status_push_pull_keep_original_local_workflow() {
    let auth = auth();
    let temp = tempfile::tempdir().unwrap();
    let (remote, repo) = init(temp.path(), &auth);
    assert!(clone_checkout(&repo, &remote, Some("main"), &auth).unwrap().cloned);
    assert!(!clone_checkout(&repo, &remote, Some("main"), &auth).unwrap().cloned);
    assert_eq!(fs::read_to_string(repo.join(".git/HEAD")).unwrap().trim(), "ref: refs/heads/main");
    assert!(checkout_status(&repo, &remote, Some("main"), None, &auth).unwrap().local_head.is_none());
    commit(&repo, "initial", &auth);
    assert!(checkout_status(&repo, &remote, Some("main"), None, &auth).unwrap().can_push);
    assert!(push_checkout(&repo, &remote, Some("main"), None, &auth).unwrap().pushed);
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
    assert!(snapshot.snapshot.files.iter().any(|file| file.path == "untracked.txt" && file.preview_content.as_deref() == Some("local")));
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
    for injection in ["\n[url \"https://other.invalid\"]\n insteadOf = file:\n", "\n[include]\n path = /tmp/other-config\n", "\n[remote \"origin\"]\n pushurl = https://other.invalid\n", "\n[filter \"x\"]\n process = evil\n"] {
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
    let error = clone_checkout(&repo, "https://unused.invalid/git/repo", Some("main"), &auth).err().unwrap();
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
    assert!(snapshot.snapshot.files.iter().all(|file| file.preview_content.as_deref() != Some("private")));
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
    assert_eq!(run_git(&["branch", "--show-current"], Some(&repo), &auth).unwrap().trim(), "master");
    run_git(&["branch", "-d", "main"], Some(&repo), &auth).unwrap();
    assert!(push_checkout(&repo, &remote, Some("main"), None, &auth).unwrap().pushed);
    assert_eq!(run_git(&["branch", "--show-current"], Some(&repo), &auth).unwrap().trim(), "main");
}
