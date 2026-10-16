//! Shared git subprocess plumbing for the project commands.
//!
//! Fixed Buzz 779af8886caae1317b4de962082429867ab61503
//! desktop/src-tauri/src/commands/project_git_exec.rs (`run_git`,
//! `configure_git_auth`, `GitAuthConfig`, `clean_branch`, `clean_target_ref`).
//!
//! Runs the system `git` with an ephemeral, env-only auth configuration:
//! the identity nsec is handed to `git-credential-nostr` via environment
//! variables so nothing key-related ever touches disk or global git config.
//!
//! Kailo (DD-118): the Desktop `AppState` coupling is replaced by [`GitAuth`].
//! [`GitAuth::CredentialHelper`] is the original Desktop path.
//! [`GitAuth::Header`] never hands a private key to git: the caller pre-signs a
//! fresh NIP-98 `Authorization` value for every git invocation, injected via
//! process-level git config (`http.extraHeader`), so a token never outlives its
//! ±60 s window across invocations.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Wall-clock cap for a single git invocation. Remote operations talk to
/// relay-supplied clone URLs, so a slow or adversarial remote must not pin
/// `spawn_blocking` threads indefinitely.
const LOCAL_GIT_TIMEOUT: Duration = Duration::from_secs(60);
const REMOTE_GIT_TIMEOUT: Duration = Duration::from_secs(300);

/// Prefix of every timeout error produced by [`run_git`].
const TIMEOUT_PREFIX: &str = "git timed out after ";

fn git_subcommand<'a>(args: &'a [&str]) -> Option<&'a str> {
    let mut index = 0;
    while let Some(argument) = args.get(index).copied() {
        match argument {
            "-c" | "--config" | "-C" | "--git-dir" | "--work-tree" => index += 2,
            "--no-pager" | "--paginate" | "--end-of-options" => index += 1,
            argument
                if argument.starts_with("--config=")
                    || argument.starts_with("--git-dir=")
                    || argument.starts_with("--work-tree=") =>
            {
                index += 1;
            }
            argument if argument.starts_with('-') => index += 1,
            subcommand => return Some(subcommand),
        }
    }
    None
}

fn git_needs_credentials(args: &[&str]) -> bool {
    matches!(
        git_subcommand(args),
        Some("clone" | "fetch" | "push" | "pull" | "ls-remote" | "merge")
    )
}

/// Produces one fresh `Authorization` header value (for Buzz: `Nostr <base64
/// NIP-98 event>`) each time it is called.
pub type AuthorizationSource = Box<dyn Fn() -> Result<String, String> + Send + Sync>;

/// How a git subprocess authenticates to the Buzz git smart HTTP endpoint.
pub enum GitAuth {
    /// The original Desktop path: `git-credential-nostr` signs NIP-98 with the
    /// identity key handed over through `NOSTR_PRIVATE_KEY`. Without a helper
    /// binary, remote operations run unauthenticated (original behavior).
    CredentialHelper {
        helper: Option<PathBuf>,
        nsec: String,
    },
    /// Kailo Core (DD-118): no key reaches git. Every invocation gets a freshly
    /// signed `Authorization` header and, when the network address differs from
    /// the signed community host, a `Host` header naming that host.
    Header {
        authorization: AuthorizationSource,
        host: Option<String>,
    },
}

/// The git binary, its authentication and the bounds every invocation obeys.
pub struct GitAuthConfig {
    git_path: PathBuf,
    auth: GitAuth,
    allow_file_transport: bool,
    deadline: Option<Instant>,
}

impl GitAuthConfig {
    /// Runs `git_path` with `auth`; only http(s) transports are allowed.
    pub fn new(git_path: impl Into<PathBuf>, auth: GitAuth) -> Self {
        Self {
            git_path: git_path.into(),
            auth,
            allow_file_transport: false,
            deadline: None,
        }
    }

    /// Kailo: bound the whole request, not only each invocation. Every later
    /// invocation is capped at the time left, and none starts after `deadline`.
    pub fn with_deadline(mut self, deadline: Instant) -> Self {
        self.deadline = Some(deadline);
        self
    }

    /// Fails with a timeout error once the request deadline has passed, so
    /// best-effort steps that swallowed a timed-out invocation cannot be
    /// returned as a complete result.
    pub(crate) fn check_deadline(&self) -> Result<(), String> {
        match self.deadline {
            Some(deadline) if Instant::now() >= deadline => Err(deadline_error()),
            _ => Ok(()),
        }
    }
}

/// Whether `error` (from any function of this crate) is a git timeout rather
/// than a git or remote failure.
pub fn is_timeout_error(error: &str) -> bool {
    error.starts_with(TIMEOUT_PREFIX)
}

fn deadline_error() -> String {
    format!("{TIMEOUT_PREFIX}the request deadline")
}

fn read_pipe_lossy(pipe: Option<impl Read>) -> String {
    let Some(mut pipe) = pipe else {
        return String::new();
    };
    let mut bytes = Vec::new();
    let _ = pipe.read_to_end(&mut bytes);
    String::from_utf8_lossy(&bytes).to_string()
}

pub(crate) fn run_git(
    args: &[&str],
    cwd: Option<&Path>,
    auth: &GitAuthConfig,
) -> Result<String, String> {
    let mut command = Command::new(&auth.git_path);
    command.args(args);
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    let needs_credentials = git_needs_credentials(args);
    let timeout = if needs_credentials {
        REMOTE_GIT_TIMEOUT
    } else {
        LOCAL_GIT_TIMEOUT
    };
    let timeout = match auth.deadline {
        Some(deadline) => {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(deadline_error());
            }
            timeout.min(remaining)
        }
        None => timeout,
    };
    configure_git_auth(&mut command, auth, needs_credentials)?;
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    configure_no_window(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to run git: {error}"))?;

    // Drain the pipes on background threads so a chatty git process can't
    // deadlock on a full pipe while we poll for exit below.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();
    let stdout_thread = std::thread::spawn(move || read_pipe_lossy(stdout_pipe));
    let stderr_thread = std::thread::spawn(move || read_pipe_lossy(stderr_pipe));

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if started.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_thread.join();
                    let _ = stderr_thread.join();
                    return Err(format!("{TIMEOUT_PREFIX}{}s", timeout.as_secs()));
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("failed to wait for git: {error}"));
            }
        }
    };

    let stdout = stdout_thread.join().unwrap_or_default();
    let stderr = stderr_thread.join().unwrap_or_default();
    if !status.success() {
        let stderr = stderr.trim().to_string();
        return Err(if stderr.is_empty() {
            format!("git exited with status {status}")
        } else {
            stderr
        });
    }
    Ok(stdout)
}

/// Fixed Buzz desktop/src-tauri/src/util.rs `configure_no_window`: keep git
/// from flashing a console window on Windows; a no-op elsewhere.
fn configure_no_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt as _;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = command;
}

fn configure_git_auth(
    command: &mut Command,
    auth: &GitAuthConfig,
    needs_credentials: bool,
) -> Result<(), String> {
    command.env("GIT_TERMINAL_PROMPT", "0");
    command.env("GIT_CONFIG_NOSYSTEM", "1");
    for key in [
        "GIT_DIR",
        "GIT_WORK_TREE",
        "GIT_INDEX_FILE",
        "GIT_OBJECT_DIRECTORY",
        "GIT_ALTERNATE_OBJECT_DIRECTORIES",
        "GIT_SSH_COMMAND",
        "GIT_EXTERNAL_DIFF",
    ] {
        command.env_remove(key);
    }
    // Git for Windows maps `/dev/null` to `NUL` internally, so this value
    // disables the global config file on every platform.
    command.env("GIT_CONFIG_GLOBAL", "/dev/null");

    // Base entries: disable any inherited credential helper, and neutralize
    // repo-local hooks — every process git spawns inherits our environment
    // (including NOSTR_PRIVATE_KEY below), and a cloned repository's hooks
    // must never run with the identity key in reach.
    let mut entries: Vec<(&str, String)> = vec![
        ("credential.helper", String::new()),
        ("core.hooksPath", "/dev/null".to_string()),
        ("core.fsmonitor", "false".to_string()),
        ("protocol.allow", "never".to_string()),
        ("protocol.http.allow", "always".to_string()),
        ("protocol.https.allow", "always".to_string()),
        ("protocol.ext.allow", "never".to_string()),
        (
            "protocol.file.allow",
            if auth.allow_file_transport {
                "always"
            } else {
                "never"
            }
            .to_string(),
        ),
    ];
    match &auth.auth {
        GitAuth::CredentialHelper { helper, nsec } => {
            if needs_credentials {
                let Some(cred_helper) = helper else {
                    apply_git_config(command, &entries);
                    return Ok(());
                };
                command.env("NOSTR_PRIVATE_KEY", nsec);
                entries.push((
                    "credential.helper",
                    credential_helper_config_value(cred_helper),
                ));
                entries.push(("credential.useHttpPath", "true".to_string()));
            }
        }
        GitAuth::Header {
            authorization,
            host,
        } => {
            // Kailo: no identity key is ever in this process tree.
            command.env_remove("NOSTR_PRIVATE_KEY");
            // Every invocation, not only `needs_credentials`: a
            // `--filter=blob:none` clone lazily fetches missing blobs from its
            // promisor remote during local commands (checkout, diff, ls-tree
            // --long), and that fetch inherits this environment. Each
            // invocation signs anew, so no token is reused across invocations.
            let value = authorization()?;
            entries.push(("http.extraHeader", header_line("Authorization", &value)?));
            if let Some(host) = host {
                entries.push(("http.extraHeader", header_line("Host", host)?));
            }
        }
    }
    apply_git_config(command, &entries);
    Ok(())
}

/// One `http.extraHeader` value. A CR or LF would let a value smuggle a second
/// header, so it is refused rather than passed to git.
fn header_line(name: &str, value: &str) -> Result<String, String> {
    if value.is_empty() || value.contains(['\r', '\n']) {
        return Err(format!("invalid {name} header value"));
    }
    Ok(format!("{name}: {value}"))
}

/// Format a path for git `credential.helper`.
///
/// Git for Windows invokes helpers via MinGW bash, which treats `\` as
/// escapes. Forward slashes work on every platform git supports.
fn credential_helper_config_value(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn apply_git_config(command: &mut Command, entries: &[(&str, String)]) {
    command.env("GIT_CONFIG_COUNT", entries.len().to_string());
    for (index, (key, value)) in entries.iter().enumerate() {
        command.env(format!("GIT_CONFIG_KEY_{index}"), key);
        command.env(format!("GIT_CONFIG_VALUE_{index}"), value);
    }
}

/// Normalizes and validates a relay-supplied branch name. Strips a
/// `refs/heads/` prefix, then rejects anything outside a conservative
/// character allowlist, path traversal (`..`), leading/trailing `/`, and
/// flag-shaped values (leading `-`) so a branch can never reach git as an
/// option instead of a positional argument.
pub fn clean_branch(value: Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.trim_start_matches("refs/heads/"))
        .filter(|value| {
            !value.is_empty()
                && !value.starts_with('-')
                && !value.contains("..")
                && !value.starts_with('/')
                && !value.ends_with('/')
                && value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '_' | '.' | '-'))
        })
        .map(ToString::to_string)
}

/// Accepts only tag and pull-request (`refs/nostr/`) refs whose name passes
/// [`clean_branch`] unchanged.
pub fn clean_target_ref(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();
    for prefix in ["refs/tags/", "refs/nostr/"] {
        if let Some(name) = value.strip_prefix(prefix) {
            let clean_name = clean_branch(Some(name.to_string()))?;
            return (clean_name == name).then_some(format!("{prefix}{clean_name}"));
        }
    }
    None
}

#[cfg(test)]
pub(crate) fn test_auth_config(auth: GitAuth) -> GitAuthConfig {
    let mut config = GitAuthConfig::new("git", auth);
    config.allow_file_transport = true;
    config
}

#[cfg(test)]
mod tests {
    use super::{
        clean_branch, clean_target_ref, configure_git_auth, credential_helper_config_value,
        git_needs_credentials, git_subcommand, is_timeout_error, run_git, test_auth_config,
        GitAuth, GitAuthConfig,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn git_config(command: &std::process::Command) -> Vec<(String, String)> {
        let env = command
            .get_envs()
            .filter_map(|(key, value)| {
                Some((key.to_str()?.to_string(), value?.to_str()?.to_string()))
            })
            .collect::<std::collections::HashMap<_, _>>();
        let count = env
            .get("GIT_CONFIG_COUNT")
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or_default();
        (0..count)
            .map(|index| {
                (
                    env[&format!("GIT_CONFIG_KEY_{index}")].clone(),
                    env[&format!("GIT_CONFIG_VALUE_{index}")].clone(),
                )
            })
            .collect()
    }

    fn entry(key: &str, value: &str) -> (String, String) {
        (key.to_string(), value.to_string())
    }

    fn has_key(config: &[(String, String)], name: &str) -> bool {
        config.iter().any(|(key, _)| key == name)
    }

    fn removed(command: &std::process::Command, name: &str) -> bool {
        command
            .get_envs()
            .any(|(key, value)| key == name && value.is_none())
    }

    fn set(command: &std::process::Command, name: &str) -> bool {
        command
            .get_envs()
            .any(|(key, value)| key == name && value.is_some())
    }

    #[test]
    fn credential_helper_config_value_uses_forward_slashes() {
        let path =
            std::path::PathBuf::from(r"C:\Users\x\AppData\Local\Buzz\git-credential-nostr.exe");
        assert_eq!(
            credential_helper_config_value(&path),
            "C:/Users/x/AppData/Local/Buzz/git-credential-nostr.exe",
        );
    }

    #[test]
    fn git_subcommand_skips_global_config_options() {
        assert_eq!(
            git_subcommand(&[
                "-c",
                "user.name=Buzz User",
                "-c",
                "user.email=user@example.com",
                "merge",
                "HEAD",
            ]),
            Some("merge")
        );
        assert_eq!(
            git_subcommand(&["--config=credential.useHttpPath=true", "fetch", "origin"]),
            Some("fetch")
        );
    }

    #[test]
    fn remote_and_promisor_operations_receive_credentials() {
        assert!(git_needs_credentials(&["fetch", "origin"]));
        assert!(git_needs_credentials(&[
            "-c",
            "user.name=Buzz User",
            "merge",
            "HEAD"
        ]));
        assert!(!git_needs_credentials(&["rev-parse", "HEAD"]));
    }

    #[test]
    fn clean_branch_accepts_plain_and_prefixed_names() {
        assert_eq!(
            clean_branch(Some("refs/heads/feature/x-1".into())),
            Some("feature/x-1".to_string())
        );
        assert_eq!(
            clean_branch(Some(" main ".into())),
            Some("main".to_string())
        );
    }

    #[test]
    fn clean_branch_rejects_flag_shaped_and_traversal_values() {
        assert_eq!(clean_branch(Some("--upload-pack=/tmp/evil".into())), None);
        assert_eq!(clean_branch(Some("-x".into())), None);
        assert_eq!(clean_branch(Some("a/../b".into())), None);
        assert_eq!(clean_branch(Some("/leading".into())), None);
        assert_eq!(clean_branch(Some("trailing/".into())), None);
        assert_eq!(clean_branch(Some("bad name".into())), None);
        assert_eq!(clean_branch(None), None);
    }

    #[test]
    fn clean_target_ref_accepts_only_tags_and_pull_request_refs() {
        assert_eq!(
            clean_target_ref(Some("refs/tags/v1.0.0".into())),
            Some("refs/tags/v1.0.0".to_string())
        );
        assert_eq!(
            clean_target_ref(Some("refs/nostr/abc123".into())),
            Some("refs/nostr/abc123".to_string())
        );
        assert_eq!(clean_target_ref(Some("refs/heads/main".into())), None);
        assert_eq!(clean_target_ref(Some("refs/tags/../main".into())), None);
    }

    #[test]
    fn header_auth_signs_every_invocation_and_never_exposes_a_key() {
        let signed = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&signed);
        let auth = test_auth_config(GitAuth::Header {
            authorization: Box::new(move || {
                let n = counter.fetch_add(1, Ordering::SeqCst);
                Ok(format!("Nostr token-{n}"))
            }),
            host: Some("community.example".to_string()),
        });
        for (n, needs_credentials) in [(0, false), (1, true)] {
            let mut command = std::process::Command::new("git");
            configure_git_auth(&mut command, &auth, needs_credentials).unwrap();
            let config = git_config(&command);
            let headers = config
                .iter()
                .filter(|(key, _)| key == "http.extraHeader")
                .map(|(_, value)| value.as_str())
                .collect::<Vec<_>>();
            let authorization = format!("Authorization: Nostr token-{n}");
            assert_eq!(headers, [authorization.as_str(), "Host: community.example"]);
            assert!(config.contains(&entry("credential.helper", "")));
            assert!(!has_key(&config, "credential.useHttpPath"));
            assert!(removed(&command, "NOSTR_PRIVATE_KEY"));
        }
        assert_eq!(signed.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn header_auth_refuses_header_smuggling_and_signing_failures() {
        let smuggled = test_auth_config(GitAuth::Header {
            authorization: Box::new(|| Ok("Nostr a\r\nX-Evil: 1".to_string())),
            host: None,
        });
        let mut command = std::process::Command::new("git");
        assert!(configure_git_auth(&mut command, &smuggled, true).is_err());
        let failing = test_auth_config(GitAuth::Header {
            authorization: Box::new(|| Err("signer unavailable".to_string())),
            host: None,
        });
        let mut command = std::process::Command::new("git");
        let error = configure_git_auth(&mut command, &failing, true).unwrap_err();
        assert_eq!(error, "signer unavailable");
    }

    #[test]
    fn credential_helper_auth_keeps_the_original_remote_only_shape() {
        let auth = test_auth_config(GitAuth::CredentialHelper {
            helper: Some(std::path::PathBuf::from("/usr/bin/git-credential-nostr")),
            nsec: "nsec-test".to_string(),
        });
        let mut local = std::process::Command::new("git");
        configure_git_auth(&mut local, &auth, false).unwrap();
        assert!(!set(&local, "NOSTR_PRIVATE_KEY"));
        let mut remote = std::process::Command::new("git");
        configure_git_auth(&mut remote, &auth, true).unwrap();
        let config = git_config(&remote);
        let helper = "/usr/bin/git-credential-nostr";
        assert!(config.contains(&entry("credential.helper", helper)));
        assert!(config.contains(&entry("credential.useHttpPath", "true")));
        assert!(!has_key(&config, "http.extraHeader"));
    }

    #[test]
    fn expired_deadline_refuses_to_start_git() {
        let signed = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&signed);
        let header = GitAuth::Header {
            authorization: Box::new(move || {
                counter.fetch_add(1, Ordering::SeqCst);
                Ok("Nostr token".to_string())
            }),
            host: None,
        };
        let auth = GitAuthConfig::new("git", header).with_deadline(std::time::Instant::now());
        let error = run_git(&["--version"], None, &auth).unwrap_err();
        assert!(is_timeout_error(&error), "{error}");
        assert!(auth.check_deadline().is_err());
        assert_eq!(signed.load(Ordering::SeqCst), 0);
    }
}
