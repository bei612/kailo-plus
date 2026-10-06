//! Post-implementation RPC consumer checks; no model or live runtime is used.
use super::*;
use std::io::Write;
use tracing::instrument::WithSubscriber;

#[test]
fn native_error_categories_require_exact_code_method_and_thread() {
    let thread = Uuid::new_v4();
    let diagnostic = RpcDiagnostic::new(
        Uuid::new_v4(),
        7,
        11,
        "thread/resume",
        &json!({"threadId":thread}),
    );
    for (message, expected) in [
        (
            format!("no rollout found for thread id {thread}"),
            "THREAD_NOT_FOUND",
        ),
        (
            format!("thread {thread} is closing; retry thread/resume after the thread is closed"),
            "THREAD_CLOSING",
        ),
        (
            "Server is draining; retry after reconnecting".into(),
            "SERVER_DRAINING",
        ),
        (
            format!("no rollout found for thread id {}", Uuid::new_v4()),
            "INVALID_REQUEST",
        ),
        (
            format!("no rollout found for thread id {thread} sensitive-tail"),
            "INVALID_REQUEST",
        ),
    ] {
        assert_eq!(
            diagnostic.error_category(&json!({"code":-32600,"message":message})),
            (Some(-32600), expected)
        );
    }
    for (code, category) in [
        (-32601, "METHOD_NOT_FOUND"),
        (-32602, "INVALID_PARAMS"),
        (-32603, "INTERNAL_ERROR"),
        (-32001, "OVERLOADED"),
        (123, "UNCLASSIFIED_NATIVE_ERROR"),
    ] {
        assert_eq!(
            diagnostic.error_category(
                &json!({"code":code,"message":format!("no rollout found for thread id {thread}")})
            ),
            (Some(code), category)
        );
    }
    let other_method = RpcDiagnostic::new(
        Uuid::new_v4(),
        7,
        11,
        "thread/read",
        &json!({"threadId":thread}),
    );
    assert_eq!(
        other_method
            .error_category(
                &json!({"code":-32600,"message":format!("no rollout found for thread id {thread}")})
            )
            .1,
        "INVALID_REQUEST"
    );
    let invalid = RpcDiagnostic::new(
        Uuid::new_v4(),
        7,
        11,
        "credential-in-method",
        &json!({"threadId":"credential-in-thread"}),
    );
    assert_eq!(invalid.method, "UNRECOGNIZED_METHOD");
    assert_eq!(invalid.thread, None);
    assert_eq!(
        invalid.error_category(&json!({"code":"credential-in-code","message":"private"})),
        (None, "INVALID_ERROR_ENVELOPE")
    );
}

#[derive(Clone)]
struct Capture(Arc<std::sync::Mutex<Vec<u8>>>);

impl Write for Capture {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Capture {
    type Writer = Self;
    fn make_writer(&'a self) -> Self {
        self.clone()
    }
}

#[tokio::test]
#[ignore = "requires RUNTIME_RECOVERY_TEST_DATABASE_URL to an isolated runtime_recovery_verify_* database"]
async fn rpc_rejection_logs_only_correlated_metadata_and_remains_unknown() {
    let pool = PgPool::connect(&std::env::var("RUNTIME_RECOVERY_TEST_DATABASE_URL").unwrap())
        .await
        .unwrap();
    let database: String = sqlx::query_scalar("select current_database()")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(database.starts_with("runtime_recovery_verify_"));
    let thread = Uuid::new_v4();
    for (code, message, category) in [
        (
            json!(-32600),
            format!("no rollout found for thread id {thread}"),
            "THREAD_NOT_FOUND",
        ),
        (
            json!(-32603),
            "SECRET_NATIVE_MESSAGE".into(),
            "INTERNAL_ERROR",
        ),
        (
            json!("SECRET_INVALID_CODE"),
            "SECRET_NATIVE_MESSAGE".into(),
            "INVALID_ERROR_ENVELOPE",
        ),
    ] {
        let installation = Uuid::new_v4();
        let reply = json!({"id":1,"error":{"code":code,"message":message,"data":{"token":"SECRET_ERROR_DATA"}}});
        let script = format!("IFS= read -r request; printf '%s\\n' '{reply}'; exec sleep 30");
        let mut process =
            activity_tests::recovery_process(&pool, installation, &"a".repeat(64), &script).await;
        let captured = Capture(Arc::new(std::sync::Mutex::new(Vec::new())));
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_writer(captured.clone())
            .with_ansi(false)
            .finish();
        let result = process
            .rpc(
                "thread/resume",
                json!({"threadId":thread,"config":{"credential":"SECRET_REQUEST"}}),
                Duration::from_secs(10),
                8192,
            )
            .with_subscriber(subscriber)
            .await;
        assert!(matches!(result, Err(RuntimeError::Unknown)));
        assert_eq!(process.next_id, 1, "diagnosis must not resend the request");
        assert!(process.start_receipts.is_empty());
        let bytes = captured.0.lock().unwrap().clone();
        let text = String::from_utf8(bytes).unwrap();
        assert!(
            !text.contains("SECRET_"),
            "raw request/error values must not enter logs"
        );
        assert!(
            !text.contains("no rollout found"),
            "only fixed categories, never native text"
        );
        let events: Vec<Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(events.len(), 1);
        let fields = &events[0]["fields"];
        assert_eq!(fields["installation_id"], installation.to_string());
        assert_eq!(fields["request_id"], 1);
        assert_eq!(fields["generation"], 1);
        assert_eq!(fields["method"], "thread/resume");
        assert!(fields["thread_id"]
            .as_str()
            .unwrap()
            .contains(&thread.to_string()));
        assert_eq!(fields["rpc_phase"], "RESPONSE");
        assert_eq!(fields["rpc_category"], category);
        if let Some(code) = code.as_i64() {
            assert_eq!(fields["rpc_code"], code);
        } else {
            assert!(fields.get("rpc_code").is_none_or(Value::is_null));
        }
        process.child.kill().await.unwrap();
        drop(process);
    }
    pool.close().await;
}
