use sqlx::{PgPool, SqlitePool};

use super::*;

/// Raw access to the database behind a backend, for arranging failures and counting rows.
enum TestDb {
	// The directory holds the database file; it is removed when dropped.
	Sqlite {
		pool: SqlitePool,
		_dir: tempfile::TempDir,
	},
	Postgres(PgPool),
}

impl TestDb {
	async fn exec(&self, sql: &'static str) -> Result<(), sqlx::Error> {
		match self {
			TestDb::Sqlite { pool, .. } => sqlx::query(sql).execute(pool).await.map(|_| ()),
			TestDb::Postgres(pool) => sqlx::query(sql).execute(pool).await.map(|_| ()),
		}
	}

	async fn count(&self, table: &str) -> i64 {
		let sql = sqlx::AssertSqlSafe(format!("SELECT COUNT(*) FROM {table}"));
		match self {
			TestDb::Sqlite { pool, .. } => sqlx::query_scalar(sql).fetch_one(pool).await.unwrap(),
			TestDb::Postgres(pool) => sqlx::query_scalar(sql).fetch_one(pool).await.unwrap(),
		}
	}
}

async fn sqlite_backend() -> (Backend, TestDb) {
	let dir = tempfile::tempdir().unwrap();
	let url = format!("sqlite://{}", dir.path().join("logs.db").display());
	let pool = crate::database::DatabasePool::connect(&url).await.unwrap();
	let crate::database::DatabasePool::Sqlite(sqlite) = pool.clone() else {
		unreachable!()
	};
	let cfg = Config {
		url,
		max_connections: None,
	};
	let backend = Backend::connect(&cfg, Some(pool)).await.unwrap();
	(
		backend,
		TestDb::Sqlite {
			pool: sqlite,
			_dir: dir,
		},
	)
}

/// Connects to the database named by `AGENTGATEWAY_TEST_POSTGRES_URL` and starts from an empty
/// request log schema.
async fn postgres_backend() -> (Backend, TestDb) {
	let url = env::var("AGENTGATEWAY_TEST_POSTGRES_URL")
		.expect("AGENTGATEWAY_TEST_POSTGRES_URL must name a scratch database");
	let pool = crate::database::DatabasePool::connect(&url).await.unwrap();
	let crate::database::DatabasePool::Postgres(pg) = pool.clone() else {
		panic!("AGENTGATEWAY_TEST_POSTGRES_URL is not a postgres URL")
	};
	sqlx::query(
		"DROP TABLE IF EXISTS usage_dispatches, usage_outbox, usage_outbox_unavailable, request_log_payloads, request_logs, _agentgateway_request_log_migrations",
	)
	.execute(&pg)
	.await
	.unwrap();
	let cfg = Config {
		url,
		max_connections: None,
	};
	let backend = Backend::connect(&cfg, Some(pool)).await.unwrap();
	(backend, TestDb::Postgres(pg))
}

fn record(id: &str, usage_outbox: bool) -> StoredRequestLog {
	let now = Utc::now();
	StoredRequestLog {
		id: id.to_string(),
		started_at: now,
		completed_at: now,
		duration_ms: 1,
		trace_id: Some("4bf92f3577b34da6a3ce929d0e0e4736".to_string()),
		span_id: None,
		http_status: Some(200),
		error: None,
		gen_ai_operation_name: usage_outbox.then(|| "chat".to_string()),
		gen_ai_provider_name: usage_outbox.then(|| "openai".to_string()),
		gen_ai_request_model: usage_outbox.then(|| "gpt-test".to_string()),
		gen_ai_response_model: None,
		input_tokens: usage_outbox.then_some(11),
		output_tokens: usage_outbox.then_some(7),
		total_tokens: usage_outbox.then_some(18),
		cost: None,
		agentgateway_user: Some("user-a".to_string()),
		agentgateway_group: None,
		user_agent_name: None,
		has_payload: true,
		attributes_json: r#"{"agw.ai.usage.cost.pages":2}"#.into(),
		payload: Some(StoredRequestLogPayload {
			request_prompt_json: Some(
				serde_json::json!([{"role": "user", "parts": [{"type": "text", "text": "secret prompt"}]}]),
			),
			response_completion_json: None,
		}),
		usage_outbox,
	}
}

fn pending(records: Vec<StoredRequestLog>) -> PendingBatch {
	REQUEST_LOG_STORE_BACKLOG.fetch_add(records.len(), Ordering::Relaxed);
	let mut batch = PendingBatch::new(records.len());
	batch.records = records;
	batch
}

async fn outbox_ids(backend: &Backend, after: Option<i64>) -> (Vec<(i64, String)>, i64) {
	let resp = backend
		.usage_outbox(UsageOutboxRequest { after, limit: None, trace_id: None })
		.await
		.unwrap();
	(
		resp.entries.into_iter().map(|e| (e.seq, e.id)).collect(),
		resp.next_cursor,
	)
}

async fn usage_outbox_holds_llm_records_in_commit_order(backend: Backend, _db: TestDb) {
	let mut first = pending(vec![
		record("a", true),
		record("b", false),
		record("c", true),
	]);
	assert!(flush_log_store_batch(&backend, &mut first).await);
	assert!(first.records.is_empty());
	let mut second = pending(vec![record("d", true)]);
	assert!(flush_log_store_batch(&backend, &mut second).await);

	let (entries, cursor) = outbox_ids(&backend, None).await;
	let ids = entries
		.iter()
		.map(|(_, id)| id.as_str())
		.collect::<Vec<_>>();
	assert_eq!(ids, ["a", "c", "d"], "only LLM records enter the outbox");
	assert!(entries.windows(2).all(|w| w[0].0 < w[1].0));
	assert_eq!(cursor, entries[2].0);

	// Resuming from a cursor returns only later entries; an exhausted cursor stays put.
	let (after_c, _) = outbox_ids(&backend, Some(entries[1].0)).await;
	assert_eq!(after_c, vec![entries[2].clone()]);
	let (none, unchanged) = outbox_ids(&backend, Some(cursor)).await;
	assert!(none.is_empty());
	assert_eq!(unchanged, cursor);

	// Re-reading is stable, and prompt content is not part of the outbox.
	let resp = backend
		.usage_outbox(UsageOutboxRequest {
			after: None,
			limit: Some(1),
			trace_id: None,
		})
		.await
		.unwrap();
	assert_eq!(resp.entries.len(), 1);
	assert_eq!(resp.entries[0].id, "a");
	assert_eq!(resp.entries[0].usage.total_tokens, Some(18));
	assert_eq!(resp.entries[0].agentgateway_user.as_deref(), Some("user-a"));
	assert_eq!(resp.entries[0].attributes["agw.ai.usage.cost.pages"], 2);
	assert_eq!(resp.submitted_requests, 0);
	assert_eq!(resp.untracked_requests, 3);
	assert!(!resp.request_set_complete, "legacy completion logs do not prove a submitted request set");
	let body = serde_json::to_string(&resp).unwrap();
	assert!(!body.contains("secret prompt"), "{body}");

	// The same native backend admits before completion. A committed intent without
	// a completion survives independently and prevents an empty tail claiming zero.
	let mut admitted = record("admitted", true);
	admitted.trace_id = Some("5bf92f3577b34da6a3ce929d0e0e4736".to_string());
	backend.begin_usage(&admitted.id, admitted.trace_id.as_deref(), admitted.started_at, 0).await.unwrap();
	let request = UsageOutboxRequest { after: None, limit: None, trace_id: admitted.trace_id.clone() };
	let before = backend.usage_outbox(request.clone()).await.unwrap();
	assert!(before.entries.is_empty());
	assert_eq!((before.submitted_requests, before.pending_requests, before.untracked_requests), (1, 1, 0));
	assert!(!before.request_set_complete);
	let mut completed = pending(vec![admitted.clone()]);
	assert!(flush_log_store_batch(&backend, &mut completed).await);
	let after = backend.usage_outbox(request).await.unwrap();
	assert_eq!(after.entries.len(), 1);
	assert_eq!(after.entries[0].id, admitted.id);
	assert_eq!(after.entries[0].dispatch_attempt, Some(0));
	assert_eq!((after.submitted_requests, after.pending_requests, after.untracked_requests), (1, 0, 0));
	assert!(after.request_set_complete);
	let empty = backend.usage_outbox(UsageOutboxRequest { after: None, limit: None, trace_id: Some("6bf92f3577b34da6a3ce929d0e0e4736".to_string()) }).await.unwrap();
	assert_eq!(empty.submitted_requests, 0);
	assert!(!empty.request_set_complete);

	// A completion with another trace cannot satisfy this accepted request's receipt.
	admitted.id = "foreign-completion".to_string();
	backend.begin_usage(&admitted.id, admitted.trace_id.as_deref(), admitted.started_at, 1).await.unwrap();
	admitted.trace_id = Some("6bf92f3577b34da6a3ce929d0e0e4736".to_string());
	let mut foreign = pending(vec![admitted]);
	assert!(flush_log_store_batch(&backend, &mut foreign).await);
	let not_complete = backend.usage_outbox(UsageOutboxRequest { after: None, limit: None, trace_id: Some("5bf92f3577b34da6a3ce929d0e0e4736".to_string()) }).await.unwrap();
	assert_eq!((not_complete.submitted_requests, not_complete.pending_requests), (2, 1));
	assert!(!not_complete.request_set_complete);
	assert!(backend.usage_outbox(UsageOutboxRequest { after: None, limit: None, trace_id: Some("not-a-trace".to_string()) }).await.is_err());
}

async fn failed_flush_keeps_records_until_persisted(backend: Backend, db: TestDb) {
	db.exec("ALTER TABLE usage_outbox RENAME TO usage_outbox_unavailable")
		.await
		.unwrap();

	let mut batch = pending(vec![record("a", true), record("b", false)]);
	assert!(!flush_log_store_batch(&backend, &mut batch).await);
	assert_eq!(batch.records.len(), 2, "a failed batch must not be dropped");
	assert_eq!(batch.failures, 1);
	assert!(batch.retry_at.is_some());
	// The request logs are rolled back with the outbox: neither exists without the other.
	assert_eq!(db.count("request_logs").await, 0);

	// Before the backoff elapses nothing is attempted and the records stay pending.
	assert!(!flush_log_store_batch(&backend, &mut batch).await);
	assert_eq!(batch.failures, 1);

	db.exec("ALTER TABLE usage_outbox_unavailable RENAME TO usage_outbox")
		.await
		.unwrap();
	batch.retry_at = Some(Instant::now());
	assert!(flush_log_store_batch(&backend, &mut batch).await);
	assert!(batch.records.is_empty());
	assert_eq!(batch.failures, 0);
	assert_eq!(db.count("request_logs").await, 2);
	let (entries, _) = outbox_ids(&backend, None).await;
	assert_eq!(entries.len(), 1);
	assert_eq!(entries[0].1, "a");
}

async fn retry_after_unacknowledged_commit_writes_each_record_once(backend: Backend, db: TestDb) {
	// The first attempt committed, but the writer saw an error (e.g. the connection dropped while
	// acknowledging the commit) and kept the records.
	backend
		.insert_batch(&[record("a", true), record("b", false)])
		.await
		.unwrap();
	let mut batch = pending(vec![
		record("a", true),
		record("b", false),
		record("c", true),
	]);
	batch.failures = 1;

	assert!(flush_log_store_batch(&backend, &mut batch).await);
	assert_eq!(db.count("request_logs").await, 3);
	let (entries, _) = outbox_ids(&backend, None).await;
	let ids = entries
		.iter()
		.map(|(_, id)| id.as_str())
		.collect::<Vec<_>>();
	assert_eq!(ids, ["a", "c"]);
}

async fn outbox_keeps_its_request_logs(backend: Backend, db: TestDb) {
	let mut batch = pending(vec![record("a", true), record("b", false)]);
	assert!(flush_log_store_batch(&backend, &mut batch).await);
	assert!(
		db.exec("DELETE FROM request_logs WHERE id = 'a'")
			.await
			.is_err(),
		"a request log referenced by the usage outbox cannot be deleted"
	);
	db.exec("DELETE FROM request_logs WHERE id = 'b'")
		.await
		.unwrap();
}

#[test]
fn retry_delay_is_capped() {
	assert_eq!(retry_delay(1), LOG_STORE_RETRY_MIN);
	assert_eq!(retry_delay(2), LOG_STORE_RETRY_MIN * 2);
	assert_eq!(retry_delay(40), LOG_STORE_RETRY_MAX);
}

macro_rules! backend_tests {
	($backend:ident, $($attr:meta),*) => {
		mod $backend {
			#[tokio::test]
			$(#[$attr])*
			async fn usage_outbox_holds_llm_records_in_commit_order() {
				let (backend, db) = super::$backend().await;
				super::usage_outbox_holds_llm_records_in_commit_order(backend, db).await;
			}

			#[tokio::test]
			$(#[$attr])*
			async fn failed_flush_keeps_records_until_persisted() {
				let (backend, db) = super::$backend().await;
				super::failed_flush_keeps_records_until_persisted(backend, db).await;
			}

			#[tokio::test]
			$(#[$attr])*
			async fn retry_after_unacknowledged_commit_writes_each_record_once() {
				let (backend, db) = super::$backend().await;
				super::retry_after_unacknowledged_commit_writes_each_record_once(backend, db).await;
			}

			#[tokio::test]
			$(#[$attr])*
			async fn outbox_keeps_its_request_logs() {
				let (backend, db) = super::$backend().await;
				super::outbox_keeps_its_request_logs(backend, db).await;
			}
		}
	};
}

backend_tests!(sqlite_backend,);
// Postgres tests share one scratch database and reset its schema; run them one at a time:
// AGENTGATEWAY_TEST_POSTGRES_URL=postgres://... cargo test log_store::tests::postgres_backend -- --ignored --test-threads=1
backend_tests!(
	postgres_backend,
	ignore = "requires AGENTGATEWAY_TEST_POSTGRES_URL"
);
