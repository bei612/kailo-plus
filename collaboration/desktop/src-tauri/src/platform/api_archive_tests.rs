// Included in api::tests to exercise the original HTTP/credential consumers.
struct TestArchive {
    saved: Mutex<Option<&'static str>>,
    gate: Mutex<Option<Arc<Gate>>>,
    fail: std::sync::atomic::AtomicBool,
}

impl SessionArchive for Arc<TestArchive> {
    fn erase(&self) -> Pin<Box<dyn Future<Output = Result<(), String>> + Send + '_>> {
        Box::pin(async move {
            let gate = self.gate.lock().unwrap().take();
            if let Some(gate) = gate {
                gate.wait().await;
            }
            if self.fail.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("archive keychain unavailable".into());
            }
            *self.saved.lock().unwrap() = None;
            Ok(())
        })
    }
}

fn with_archive(session: &NativeSession) -> Arc<TestArchive> {
    let archive = Arc::new(TestArchive {
        saved: Mutex::new(Some("old identity copy")),
        gate: Mutex::new(None),
        fail: std::sync::atomic::AtomicBool::new(false),
    });
    session.set_archive(Box::new(archive.clone())).unwrap();
    archive
}

#[tokio::test]
async fn archive_erasure_precedes_remote_logout_and_never_erases_the_new_login() {
    let f = fake(true, 200, 200);
    let gate = Gate::new();
    f.lock().unwrap().logout_gate = Some(gate.clone());
    let cfg = serve(f).await;
    let session = signed_in().await;
    let archive = with_archive(&session);
    let http = reqwest::Client::new();
    let (report, ()) = tokio::join!(session.end_session(&http, &cfg, &NoWindow), async {
        gate.arrived().await;
        assert_eq!(*archive.saved.lock().unwrap(), None);
        session.adopt(replacement()).await.unwrap();
        *archive.saved.lock().unwrap() = Some("new identity copy");
        gate.release.add_permits(1);
    });
    report.unwrap();
    assert_replacement(&session);
    assert_eq!(*archive.saved.lock().unwrap(), Some("new identity copy"));
}

#[tokio::test]
async fn identity_rejection_erases_archive_but_transient_failures_do_not() {
    for (status, error, rejected) in [
        (400, "invalid_grant", true),
        (503, "invalid_grant", false),
        (429, "invalid_grant", false),
    ] {
        let f = fake(true, 200, 200);
        {
            let mut f = f.lock().unwrap();
            f.token_status = status;
            f.token_error = error;
        }
        let cfg = serve(f).await;
        let session = signed_in().await;
        let archive = with_archive(&session);
        assert_eq!(
            probe(&session, &cfg).await.unwrap_err() == NOT_SIGNED_IN,
            rejected
        );
        assert_eq!(archive.saved.lock().unwrap().is_none(), rejected);
    }
    let f = fake(true, 200, 200);
    f.lock().unwrap().reject_refreshed_access = true;
    let cfg = serve(f).await;
    let session = signed_in().await;
    let archive = with_archive(&session);
    assert_eq!(probe(&session, &cfg).await.unwrap_err(), NOT_SIGNED_IN);
    assert_eq!(*archive.saved.lock().unwrap(), None);
}

#[tokio::test]
async fn late_identity_rejection_cannot_erase_a_new_sessions_archive() {
    let f = fake(true, 200, 200);
    let gate = Gate::new();
    {
        let mut f = f.lock().unwrap();
        f.token_status = 400;
        f.token_error = "invalid_grant";
        f.token_gate = Some(gate.clone());
    }
    let cfg = serve(f).await;
    let session = signed_in().await;
    let archive = with_archive(&session);
    let (result, ()) = tokio::join!(probe(&session, &cfg), async {
        gate.arrived().await;
        session.adopt(replacement()).await.unwrap();
        *archive.saved.lock().unwrap() = Some("new identity copy");
        gate.release.add_permits(1);
    });
    assert_eq!(result.unwrap_err(), SUPERSEDED);
    assert_eq!(*archive.saved.lock().unwrap(), Some("new identity copy"));
}

#[tokio::test]
async fn archive_cleanup_blocks_new_adoption_until_the_old_sync_has_drained() {
    let session = signed_in().await;
    let archive = with_archive(&session);
    let gate = Gate::new();
    *archive.gate.lock().unwrap() = Some(gate.clone());
    let (result, ()) = tokio::join!(session.sign_out(), async {
        gate.arrived().await;
        assert!(!session.has_credentials().unwrap());
        assert!(tokio::time::timeout(
            std::time::Duration::from_millis(20),
            session.begin_sign_in()
        )
        .await
        .is_err());
        gate.release.add_permits(1);
    });
    result.unwrap();
    session.adopt(replacement()).await.unwrap();
    assert_replacement(&session);
}

#[tokio::test]
async fn failed_archive_erasure_cannot_admit_new_credentials_and_can_be_retried() {
    let session = signed_in().await;
    let archive = with_archive(&session);
    archive
        .fail
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(session.sign_out().await.is_err());
    assert!(!session.has_credentials().unwrap());
    assert!(session.adopt(replacement()).await.is_err());
    assert!(!session.has_credentials().unwrap());
    archive
        .fail
        .store(false, std::sync::atomic::Ordering::SeqCst);
    session.adopt(replacement()).await.unwrap();
    assert_replacement(&session);
    assert_eq!(*archive.saved.lock().unwrap(), None);
}
