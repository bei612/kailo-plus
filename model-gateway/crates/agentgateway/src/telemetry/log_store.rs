use std::collections::BTreeMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration as StdDuration, Instant};
use std::{env, thread};

use chrono::{DateTime, Duration, Utc};
use crossbeam::channel::{Receiver, RecvTimeoutError, Sender, TryRecvError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;
use tracing::{debug, error, warn};

use crate::{apply, schema};

mod postgres;
mod sqlite;

#[cfg(test)]
#[path = "log_store_tests.rs"]
mod tests;

static REQUEST_LOG_STORE: OnceLock<RequestLogStore> = OnceLock::new();
static REQUEST_LOG_STORE_BACKLOG: AtomicUsize = AtomicUsize::new(0);

#[apply(schema!)]
#[derive(Eq, PartialEq)]
pub struct Config {
	/// Connection URL for the request log database. A postgres:// or postgresql:// URL uses Postgres; any other value is treated as a SQLite database.
	pub url: String,
	/// Maximum number of connections to open in this database's connection pool. Defaults to 5.
	/// When the request log and config stores have matching database settings, they share one pool
	/// with this limit.
	#[serde(default)]
	#[cfg_attr(feature = "schema", schemars(range(min = 1)))]
	pub max_connections: Option<u32>,
}

#[derive(Clone)]
pub struct RequestLogStore {
	tx: Sender<LogStoreMsg>,
}

impl RequestLogStore {
	pub(super) fn emit(&self, record: PendingRequestLog) {
		REQUEST_LOG_STORE_BACKLOG.fetch_add(1, Ordering::Relaxed);
		if let Err(err) = self.tx.send(LogStoreMsg::Record(record)) {
			REQUEST_LOG_STORE_BACKLOG.fetch_sub(1, Ordering::Relaxed);
			warn!(target: "request", ?err, "failed to enqueue request log database record");
		}
	}

	async fn request<T: Send + 'static>(
		&self,
		msg: impl FnOnce(QueryResponse<T>) -> LogStoreMsg,
	) -> anyhow::Result<T> {
		let (tx, rx) = oneshot::channel();
		self
			.tx
			.send(msg(tx))
			.map_err(|_| anyhow::anyhow!("request log database worker is stopped"))?;
		rx.await
			.map_err(|_| anyhow::anyhow!("request log database worker is stopped"))?
	}
}

pub async fn setup(cfg: &Config) -> anyhow::Result<RequestLogStoreGuard> {
	setup_with_pool(cfg, None).await
}

pub async fn setup_with_pool(
	cfg: &Config,
	pool: Option<crate::database::DatabasePool>,
) -> anyhow::Result<RequestLogStoreGuard> {
	let (tx, rx) = crossbeam::channel::unbounded();
	let (ready_tx, ready_rx) = oneshot::channel();
	let writer = LogStoreWorker::new(rx, cfg.clone(), pool, ready_tx)
		.worker_thread("request-log-db-writer".to_string())?;
	ready_rx
		.await
		.map_err(|_| anyhow::anyhow!("request log database worker stopped during startup"))??;
	let store = RequestLogStore { tx: tx.clone() };
	let _ = REQUEST_LOG_STORE.set(store);
	Ok(RequestLogStoreGuard {
		tx,
		writer: Some(writer),
	})
}

pub(super) fn emit(record: PendingRequestLog) {
	if let Some(store) = REQUEST_LOG_STORE.get() {
		store.emit(record);
	}
}

pub fn enabled() -> bool {
	REQUEST_LOG_STORE.get().is_some()
}

/// A provider attempt is durably identified before dispatch; a lost completion stays pending.
pub(super) async fn begin_usage(trace_id: Option<String>, started_at: DateTime<Utc>, attempt: i64) -> anyhow::Result<String> {
	let store = REQUEST_LOG_STORE.get().ok_or_else(|| anyhow::anyhow!("request log database is not configured"))?;
	let id = uuid::Uuid::now_v7().to_string();
	store.request(|tx| LogStoreMsg::BeginUsage { id: id.clone(), trace_id, started_at, attempt, tx }).await?;
	Ok(id)
}

pub async fn search(request: SearchRequest) -> anyhow::Result<SearchResponse> {
	let store = REQUEST_LOG_STORE
		.get()
		.ok_or_else(|| anyhow::anyhow!("request log database is not configured"))?;
	store
		.request(|tx| LogStoreMsg::Search { request, tx })
		.await
}

pub async fn get(request: GetRequest) -> anyhow::Result<GetResponse> {
	let store = REQUEST_LOG_STORE
		.get()
		.ok_or_else(|| anyhow::anyhow!("request log database is not configured"))?;
	store.request(|tx| LogStoreMsg::Get { request, tx }).await
}

pub async fn analytics_summary(
	request: AnalyticsSummaryRequest,
) -> anyhow::Result<AnalyticsSummaryResponse> {
	let store = REQUEST_LOG_STORE
		.get()
		.ok_or_else(|| anyhow::anyhow!("request log database is not configured"))?;
	store
		.request(|tx| LogStoreMsg::AnalyticsSummary { request, tx })
		.await
}

pub async fn tail(request: TailRequest) -> anyhow::Result<TailResponse> {
	let store = REQUEST_LOG_STORE
		.get()
		.ok_or_else(|| anyhow::anyhow!("request log database is not configured"))?;
	store.request(|tx| LogStoreMsg::Tail { request, tx }).await
}

/// Reads the usage outbox after a cursor.
///
/// The outbox holds one entry per completed LLM request, keyed by the stable request log ID and
/// ordered by a sequence number that is assigned when the entry is durably committed. An entry is
/// only visible after its commit, and later commits always receive larger sequence numbers, so a
/// reader that resumes from the last `seq` it has processed never skips an entry. Entries are
/// never removed or rewritten; reading again from an older cursor returns the same entries.
pub async fn usage_outbox(request: UsageOutboxRequest) -> anyhow::Result<UsageOutboxResponse> {
	let store = REQUEST_LOG_STORE
		.get()
		.ok_or_else(|| anyhow::anyhow!("request log database is not configured"))?;
	store
		.request(|tx| LogStoreMsg::UsageOutbox { request, tx })
		.await
}

pub struct RequestLogStoreGuard {
	tx: Sender<LogStoreMsg>,
	writer: Option<thread::JoinHandle<()>>,
}

impl RequestLogStoreGuard {
	pub async fn shutdown_and_wait(mut self) {
		let _ = self.tx.send(LogStoreMsg::Shutdown);
		if let Some(writer) = self.writer.take() {
			match tokio::task::spawn_blocking(move || writer.join()).await {
				Ok(Ok(())) => {},
				Ok(Err(_)) => {
					warn!(target: "request", "request log database writer panicked");
				},
				Err(err) => {
					warn!(target: "request", ?err, "failed to join request log database writer");
				},
			};
		}
	}
}

impl Drop for RequestLogStoreGuard {
	fn drop(&mut self) {
		let _ = self.tx.send(LogStoreMsg::Shutdown);
	}
}

// Testing shows this to achieve a pretty good throughput for both postgres and sqlite
const DEFAULT_LOG_STORE_BATCH_SIZE: usize = 16384;
const LOG_STORE_BATCH_SIZE_ENV: &str = "REQUEST_LOG_STORE_BATCH_SIZE";
// A failed batch is kept and retried with capped exponential backoff instead of being dropped.
const LOG_STORE_RETRY_MIN: StdDuration = StdDuration::from_millis(500);
const LOG_STORE_RETRY_MAX: StdDuration = StdDuration::from_secs(30);
// Attempts made for records still pending when the writer shuts down.
const LOG_STORE_SHUTDOWN_ATTEMPTS: u32 = 5;

#[allow(clippy::large_enum_variant)] // The StoredRequestLog, which is used 99.9% of the time, is the large one
enum LogStoreMsg {
	Record(PendingRequestLog),
	BeginUsage {
		id: String,
		trace_id: Option<String>,
		started_at: DateTime<Utc>,
		attempt: i64,
		tx: QueryResponse<()>,
	},
	Search {
		request: SearchRequest,
		tx: QueryResponse<SearchResponse>,
	},
	Get {
		request: GetRequest,
		tx: QueryResponse<GetResponse>,
	},
	AnalyticsSummary {
		request: AnalyticsSummaryRequest,
		tx: QueryResponse<AnalyticsSummaryResponse>,
	},
	Tail {
		request: TailRequest,
		tx: QueryResponse<TailResponse>,
	},
	UsageOutbox {
		request: UsageOutboxRequest,
		tx: QueryResponse<UsageOutboxResponse>,
	},
	Shutdown,
}

/// Records waiting to be persisted.
///
/// Records leave the batch only after the database has acknowledged the commit that stores them.
/// A failed insert keeps the batch for a later attempt.
struct PendingBatch {
	records: Vec<StoredRequestLog>,
	/// Consecutive failed attempts for the current records.
	failures: u32,
	/// Earliest time for the next attempt after a failure.
	retry_at: Option<Instant>,
}

impl PendingBatch {
	fn new(capacity: usize) -> Self {
		Self {
			records: Vec::with_capacity(capacity),
			failures: 0,
			retry_at: None,
		}
	}
}

fn retry_delay(failures: u32) -> StdDuration {
	LOG_STORE_RETRY_MIN
		.saturating_mul(1u32 << failures.saturating_sub(1).min(16))
		.min(LOG_STORE_RETRY_MAX)
}

type QueryResponse<T> = oneshot::Sender<anyhow::Result<T>>;

async fn receive_log_store_message(
	receiver: &Receiver<LogStoreMsg>,
	retry_at: Option<Instant>,
) -> Result<LogStoreMsg, RecvTimeoutError> {
	// Shared database connections may be driven by this current-thread runtime. Waiting for
	// another log must not stop their I/O. The clone consumes the same queue, one wait at a time.
	let receiver = receiver.clone();
	match tokio::task::spawn_blocking(move || match retry_at {
		Some(at) => receiver.recv_deadline(at),
		None => receiver.recv().map_err(|_| RecvTimeoutError::Disconnected),
	})
	.await
	{
		Ok(received) => received,
		Err(err) => {
			warn!(target: "request", ?err, "request log database queue wait failed");
			Err(RecvTimeoutError::Disconnected)
		},
	}
}

struct LogStoreWorker {
	receiver: Receiver<LogStoreMsg>,
	cfg: Config,
	pool: Option<crate::database::DatabasePool>,
	ready_tx: Option<oneshot::Sender<anyhow::Result<()>>>,
}

impl LogStoreWorker {
	fn new(
		receiver: Receiver<LogStoreMsg>,
		cfg: Config,
		pool: Option<crate::database::DatabasePool>,
		ready_tx: oneshot::Sender<anyhow::Result<()>>,
	) -> Self {
		Self {
			receiver,
			cfg,
			pool,
			ready_tx: Some(ready_tx),
		}
	}

	fn worker_thread(self, name: String) -> anyhow::Result<thread::JoinHandle<()>> {
		thread::Builder::new()
			.name(name)
			.spawn(move || self.work())
			.map_err(Into::into)
	}

	fn work(mut self) {
		let runtime = match tokio::runtime::Builder::new_current_thread()
			.enable_all()
			.build()
		{
			Ok(runtime) => runtime,
			Err(err) => {
				warn!(target: "request", ?err, "failed to start request log database worker runtime");
				self.notify_ready(Err(anyhow::Error::new(err)));
				return;
			},
		};
		runtime.block_on(self.work_async());
		debug!(target: "request", "request log database writer stopped");
	}

	fn notify_ready(&mut self, result: anyhow::Result<()>) {
		if let Some(tx) = self.ready_tx.take() {
			let _ = tx.send(result);
		}
	}

	async fn work_async(mut self) {
		let batch_size = match log_store_batch_size() {
			Ok(batch_size) => batch_size,
			Err(err) => {
				self.notify_ready(Err(err));
				return;
			},
		};
		let backend = match Backend::connect(&self.cfg, self.pool.take()).await {
			Ok(backend) => backend,
			Err(err) => {
				self.notify_ready(Err(err));
				return;
			},
		};
		self.notify_ready(Ok(()));
		let mut batch = PendingBatch::new(batch_size);
		loop {
			// With a failed batch pending, wake up for the retry even if no new message arrives.
			let received = receive_log_store_message(&self.receiver, batch.retry_at).await;
			let mut shutdown = match received {
				Ok(msg) => process_log_store_msg(&backend, &mut batch, msg).await,
				Err(RecvTimeoutError::Timeout) => false,
				Err(RecvTimeoutError::Disconnected) => true,
			};
			while !shutdown && batch.records.len() < batch_size {
				match self.receiver.try_recv() {
					Ok(msg) => {
						if process_log_store_msg(&backend, &mut batch, msg).await {
							shutdown = true;
						}
					},
					Err(TryRecvError::Disconnected) => shutdown = true,
					Err(TryRecvError::Empty) => break,
				}
			}
			flush_log_store_batch(&backend, &mut batch).await;
			if shutdown {
				self
					.drain_available_messages(&backend, &mut batch, batch_size)
					.await;
				break;
			}
		}
	}

	async fn drain_available_messages(
		&self,
		backend: &Backend,
		batch: &mut PendingBatch,
		batch_size: usize,
	) {
		loop {
			match self.receiver.try_recv() {
				Ok(msg) => {
					let _ = process_log_store_msg(backend, batch, msg).await;
				},
				Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
			}
			if batch.records.len() >= batch_size {
				flush_log_store_batch(backend, batch).await;
			}
		}
		for attempt in 1..=LOG_STORE_SHUTDOWN_ATTEMPTS {
			if let Some(at) = batch.retry_at.take() {
				tokio::time::sleep_until(tokio::time::Instant::from_std(at)).await;
			}
			if flush_log_store_batch(backend, batch).await {
				return;
			}
			debug!(target: "request", attempt, "request log batch still pending at shutdown");
		}
		error!(
			target: "request",
			count = batch.records.len(),
			first_id = batch.records.first().map(|r| r.id.as_str()),
			last_id = batch.records.last().map(|r| r.id.as_str()),
			"request log records were not persisted before shutdown"
		);
	}
}

fn log_store_batch_size() -> anyhow::Result<usize> {
	let Ok(value) = env::var(LOG_STORE_BATCH_SIZE_ENV) else {
		return Ok(DEFAULT_LOG_STORE_BATCH_SIZE);
	};
	let batch_size = value.parse::<usize>().map_err(|err| {
		anyhow::anyhow!(
			"invalid env var {LOG_STORE_BATCH_SIZE_ENV}={value} ({})",
			err
		)
	})?;
	if batch_size == 0 {
		anyhow::bail!("invalid env var {LOG_STORE_BATCH_SIZE_ENV}=0 (must be greater than 0)");
	}
	Ok(batch_size)
}

async fn process_log_store_msg(
	backend: &Backend,
	batch: &mut PendingBatch,
	msg: LogStoreMsg,
) -> bool {
	match msg {
		LogStoreMsg::BeginUsage { id, trace_id, started_at, attempt, tx } => {
			let _ = tx.send(backend.begin_usage(&id, trace_id.as_deref(), started_at, attempt).await);
			false
		},
		LogStoreMsg::Record(pending) => {
			let mut record = pending.record;
			record.payload = super::log::database_llm_payload(
				pending.llm_mode,
				pending.input_messages.as_deref().map(Vec::as_slice),
				pending.llm_response.as_ref(),
			);
			record.has_payload = record.payload.is_some();
			batch.records.push(record);
			false
		},
		LogStoreMsg::Search { request, tx } => {
			flush_log_store_batch(backend, batch).await;
			let _ = tx.send(backend.search(request).await);
			false
		},
		LogStoreMsg::Get { request, tx } => {
			flush_log_store_batch(backend, batch).await;
			let _ = tx.send(backend.get(request).await);
			false
		},
		LogStoreMsg::AnalyticsSummary { request, tx } => {
			flush_log_store_batch(backend, batch).await;
			let _ = tx.send(backend.analytics_summary(request).await);
			false
		},
		LogStoreMsg::Tail { request, tx } => {
			flush_log_store_batch(backend, batch).await;
			let _ = tx.send(backend.tail(request).await);
			false
		},
		LogStoreMsg::UsageOutbox { request, tx } => {
			if !flush_log_store_batch(backend, batch).await {
				let _ = tx.send(Err(anyhow::anyhow!("request log database has unconfirmed usage")));
				return false;
			}
			let _ = tx.send(backend.usage_outbox(request).await);
			false
		},
		LogStoreMsg::Shutdown => true,
	}
}

/// Persists the pending records. Returns true once nothing is pending.
///
/// The batch is cleared only after the database acknowledged the commit. On failure the records
/// stay pending and the next attempt is scheduled with backoff. Because a commit can succeed even
/// though its acknowledgement is lost, a retry first drops the records that are already stored,
/// so every record ID is written exactly once.
async fn flush_log_store_batch(backend: &Backend, batch: &mut PendingBatch) -> bool {
	if batch.records.is_empty() {
		return true;
	}
	if batch.retry_at.is_some_and(|at| Instant::now() < at) {
		return false;
	}
	let t0 = Instant::now();
	let count = batch.records.len();
	let result = async {
		if batch.failures > 0 {
			let ids = batch
				.records
				.iter()
				.map(|r| r.id.as_str())
				.collect::<Vec<_>>();
			let stored = backend.stored_ids(&ids).await?;
			batch.records.retain(|r| !stored.contains(&r.id));
			// Release confirmed records even if inserting the remaining records fails again.
			let confirmed = count - batch.records.len();
			REQUEST_LOG_STORE_BACKLOG.fetch_sub(confirmed, Ordering::Relaxed);
		}
		backend.insert_batch(&batch.records).await
	}
	.await;
	if let Err(err) = result {
		batch.failures = batch.failures.saturating_add(1);
		let delay = retry_delay(batch.failures);
		batch.retry_at = Some(Instant::now() + delay);
		warn!(
			target: "request",
			?err,
			count = batch.records.len(),
			failures = batch.failures,
			retry_in = ?delay,
			"failed to persist request log batch; keeping it for retry"
		);
		return false;
	}
	let count = batch.records.len();
	let backlog = REQUEST_LOG_STORE_BACKLOG.fetch_sub(count, Ordering::Relaxed) - count;
	let latency = t0.elapsed();
	let throughput = count as f64 / latency.as_secs_f64();
	debug!(
		count,
		backlog,
		?latency,
		throughput,
		"flushed request log database batch"
	);
	batch.records.clear();
	batch.failures = 0;
	batch.retry_at = None;
	true
}

// Keep captured content in its original form until it reaches the database worker.
// Normalization and JSON serialization can be expensive for large prompts and completions.
pub(super) struct PendingRequestLog {
	pub record: StoredRequestLog,
	pub llm_mode: Option<crate::types::frontend::DatabaseLlmMode>,
	pub input_messages: Option<Arc<Vec<agent_llm::types::NormalizedMessage>>>,
	pub llm_response: Option<crate::cel::LLMContext>,
}

#[derive(Clone, Debug)]
pub struct StoredRequestLog {
	pub id: String,
	pub started_at: DateTime<Utc>,
	pub completed_at: DateTime<Utc>,
	pub duration_ms: i64,
	pub trace_id: Option<String>,
	pub span_id: Option<String>,
	pub http_status: Option<i64>,
	pub error: Option<String>,
	pub gen_ai_operation_name: Option<String>,
	pub gen_ai_provider_name: Option<String>,
	pub gen_ai_request_model: Option<String>,
	pub gen_ai_response_model: Option<String>,
	pub input_tokens: Option<i64>,
	pub output_tokens: Option<i64>,
	pub total_tokens: Option<i64>,
	pub cost: Option<f64>,
	pub agentgateway_user: Option<String>,
	pub agentgateway_group: Option<String>,
	pub user_agent_name: Option<String>,
	pub has_payload: bool,
	pub attributes_json: Box<str>,
	pub payload: Option<StoredRequestLogPayload>,
	/// Also enqueue this record in the usage outbox, in the same transaction that stores it.
	pub usage_outbox: bool,
}

#[derive(Clone, Debug)]
pub struct StoredRequestLogPayload {
	pub request_prompt_json: Option<Value>,
	pub response_completion_json: Option<Value>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimeRange {
	pub from: Option<DateTime<Utc>>,
	pub to: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogFilters {
	#[serde(default)]
	pub http_status: Vec<i64>,
	#[serde(default)]
	pub provider: Vec<String>,
	#[serde(default)]
	pub request_model: Vec<String>,
	#[serde(default)]
	pub response_model: Vec<String>,
	#[serde(default)]
	pub trace_id: Option<String>,
	#[serde(default)]
	pub has_payload: Option<bool>,
	#[serde(default)]
	pub attributes: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
	#[serde(default)]
	pub limit: Option<i64>,
	#[serde(default)]
	pub cursor: Option<String>,
	#[serde(default)]
	pub time_range: Option<TimeRange>,
	#[serde(default)]
	pub filters: LogFilters,
	#[serde(default)]
	pub include_attributes: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetRequest {
	pub id: String,
	#[serde(default)]
	pub include_payload: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnalyticsSummaryRequest {
	#[serde(default)]
	pub time_range: Option<TimeRange>,
	#[serde(default)]
	pub filters: LogFilters,
	#[serde(default)]
	pub group_by: Vec<GroupBy>,
	#[serde(default)]
	pub bucket_count: Option<i64>,
	#[serde(default)]
	pub bucket_seconds: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TailRequest {
	#[serde(default)]
	pub limit: Option<i64>,
	#[serde(default)]
	pub cursor: Option<String>,
	#[serde(default)]
	pub filters: LogFilters,
	#[serde(default)]
	pub include_attributes: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupBy {
	pub field: GroupByField,
	#[serde(default)]
	pub key: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum GroupByField {
	Provider,
	RequestModel,
	ResponseModel,
	HttpStatus,
	Attributes,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UsageOutboxRequest {
	/// Return entries with a sequence number greater than this. Omit to read from the beginning.
	#[serde(default)]
	pub after: Option<i64>,
	#[serde(default)]
	pub limit: Option<i64>,
	/// Filter the entries and their durable dispatch set by the same exact trace.
	#[serde(default)]
	pub trace_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageOutboxResponse {
	pub entries: Vec<UsageOutboxEntry>,
	/// The cursor to resume from: the last returned `seq`, or the request cursor if nothing new.
	pub next_cursor: i64,
	/// Counts from the same database snapshot as the entries, not the process queue.
	pub submitted_requests: i64,
	pub pending_requests: i64,
	pub untracked_requests: i64,
	/// A nonempty trace set whose durable dispatches all have committed outbox entries.
	/// It does not certify provider quantities or OpenMeter settlement.
	pub request_set_complete: bool,
}

/// One completed LLM request as recorded at completion. Prompt and completion content is not
/// part of the outbox.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageOutboxEntry {
	pub seq: i64,
	/// The stable request log ID.
	pub id: String,
	/// The provider attempt admitted by the same durable request ID; absent for legacy logs.
	pub dispatch_attempt: Option<i64>,
	pub started_at: DateTime<Utc>,
	pub completed_at: DateTime<Utc>,
	pub trace_id: Option<String>,
	pub span_id: Option<String>,
	pub http_status: Option<i64>,
	pub error: Option<String>,
	pub gen_ai: GenAiEntry,
	pub usage: UsageEntry,
	pub cost: Option<f64>,
	pub agentgateway_user: Option<String>,
	pub agentgateway_group: Option<String>,
	pub attributes: Value,
}

impl UsageOutboxResponse {
	fn new(request: &UsageOutboxRequest, entries: Vec<UsageOutboxEntry>, counts: (i64, i64, i64)) -> Self {
		let next_cursor = entries
			.last()
			.map(|e| e.seq)
			.unwrap_or(request.after.unwrap_or(0));
		Self {
			entries,
			next_cursor,
			submitted_requests: counts.0,
			pending_requests: counts.1,
			untracked_requests: counts.2,
			request_set_complete: request.trace_id.is_some() && counts.0 > 0 && counts.1 == 0 && counts.2 == 0,
		}
	}
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
	pub logs: Vec<LogEntry>,
	pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GetResponse {
	pub log: Option<LogEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummaryResponse {
	pub time_range: TimeRange,
	pub bucket_seconds: i64,
	pub buckets: Vec<AnalyticsTimeBucket>,
	pub groups: Vec<AnalyticsGroup>,
	pub filter_options: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailResponse {
	pub logs: Vec<LogEntry>,
	pub next_cursor: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TailEvent {
	pub entry: LogEntry,
	pub cursor: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsGroup {
	pub group: BTreeMap<String, Value>,
	pub requests: i64,
	pub total_tokens: i64,
	pub cost: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsTimeBucket {
	pub start: DateTime<Utc>,
	pub group: BTreeMap<String, Value>,
	pub requests: i64,
	pub total_tokens: i64,
	pub cost: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
	pub id: String,
	pub started_at: DateTime<Utc>,
	pub completed_at: DateTime<Utc>,
	pub duration_ms: i64,
	pub trace_id: Option<String>,
	pub span_id: Option<String>,
	pub http_status: Option<i64>,
	pub error: Option<String>,
	pub prompt_preview: Option<String>,
	pub turn: TurnEntry,
	pub gen_ai: GenAiEntry,
	pub usage: UsageEntry,
	pub cost: Option<f64>,
	pub has_payload: bool,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub attributes: Option<Value>,
	#[serde(skip_serializing_if = "Option::is_none")]
	pub payload: Option<PayloadEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnEntry {
	pub input: Option<TurnKind>,
	pub output: Option<TurnKind>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TurnKind {
	User,
	Assistant,
	ToolCall,
	ToolResult,
}

fn prompt_preview(prompt: Option<&Value>) -> Option<String> {
	let messages = prompt?.as_array()?;
	messages.iter().rev().find_map(|message| {
		if message.get("role").and_then(Value::as_str) != Some("user") {
			return None;
		}
		let text = message
			.get("parts")?
			.as_array()?
			.iter()
			.filter(|part| part.get("type").and_then(Value::as_str) == Some("text"))
			.filter_map(|part| part.get("text").and_then(Value::as_str))
			.collect::<Vec<_>>()
			.join("\n");
		let text = text.trim();
		if text.is_empty() {
			None
		} else if text.chars().nth(180).is_some() {
			Some(format!("{}...", text.chars().take(177).collect::<String>()))
		} else {
			Some(text.to_string())
		}
	})
}

fn turn_kind(messages: Option<&Value>) -> Option<TurnKind> {
	// Classify the final meaningful normalized part; reasoning and system text are not turns.
	messages?.as_array()?.iter().rev().find_map(|message| {
		let role = message.get("role").and_then(Value::as_str)?;
		message
			.get("parts")?
			.as_array()?
			.iter()
			.rev()
			.find_map(|part| match part.get("type").and_then(Value::as_str)? {
				"toolCall" => Some(TurnKind::ToolCall),
				"toolResult" => Some(TurnKind::ToolResult),
				"text"
					if part
						.get("text")
						.and_then(Value::as_str)
						.is_some_and(|text| !text.trim().is_empty()) =>
				{
					match role {
						"user" => Some(TurnKind::User),
						"assistant" => Some(TurnKind::Assistant),
						_ => None,
					}
				},
				_ => None,
			})
	})
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GenAiEntry {
	pub operation_name: Option<String>,
	pub provider_name: Option<String>,
	pub request_model: Option<String>,
	pub response_model: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageEntry {
	pub input_tokens: Option<i64>,
	pub output_tokens: Option<i64>,
	pub total_tokens: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PayloadEntry {
	pub request_prompt: Option<Value>,
	pub response_completion: Option<Value>,
}

pub(crate) fn limit(limit: Option<i64>) -> i64 {
	limit.unwrap_or(100).clamp(1, 500)
}

pub(crate) fn encode_cursor(completed_at: DateTime<Utc>, id: &str) -> String {
	format!("{}|{}", completed_at.to_rfc3339(), id)
}

pub(crate) fn decode_cursor(cursor: &str) -> anyhow::Result<(DateTime<Utc>, String)> {
	let (completed_at, id) = cursor
		.split_once('|')
		.ok_or_else(|| anyhow::anyhow!("invalid cursor"))?;
	Ok((completed_at.parse::<DateTime<Utc>>()?, id.to_string()))
}

pub(crate) fn attr_value(value: &Value) -> Option<String> {
	match value {
		Value::Null => None,
		Value::Bool(value) => Some(value.to_string()),
		Value::Number(value) => Some(value.to_string()),
		Value::String(value) => Some(value.clone()),
		Value::Array(_) | Value::Object(_) => None,
	}
}

pub(crate) fn attr_filter_values(value: &Value) -> Option<Vec<String>> {
	match value {
		Value::Array(values) => values.iter().map(attr_value).collect(),
		_ => attr_value(value).map(|value| vec![value]),
	}
}

pub(crate) fn promoted_attribute_column(key: &str) -> Option<&'static str> {
	match key {
		"agentgateway.user" => Some("agentgateway_user"),
		"agentgateway.group" => Some("agentgateway_group"),
		"user_agent.name" => Some("user_agent_name"),
		_ => None,
	}
}

pub(crate) fn analytics_window(
	time_range: Option<TimeRange>,
	bucket_count: Option<i64>,
	bucket_seconds: Option<i64>,
) -> (TimeRange, DateTime<Utc>, DateTime<Utc>, i64) {
	let now = Utc::now();
	let from = time_range.as_ref().and_then(|range| range.from);
	let to = time_range
		.as_ref()
		.and_then(|range| range.to)
		.unwrap_or(now);
	let from = from.unwrap_or_else(|| to - Duration::hours(24));
	let to = if to > from {
		to
	} else {
		from + Duration::hours(24)
	};
	let span_seconds = (to - from).num_seconds().max(1);
	let bucket_seconds = bucket_seconds
		.map(|seconds| seconds.clamp(1, span_seconds))
		.unwrap_or_else(|| {
			let bucket_count = bucket_count.unwrap_or(96).clamp(1, 500);
			((span_seconds + bucket_count - 1) / bucket_count).max(1)
		});
	(
		TimeRange {
			from: Some(from),
			to: Some(to),
		},
		from,
		to,
		bucket_seconds,
	)
}

enum Backend {
	Sqlite(sqlite::SqliteLogStore),
	Postgres(postgres::PostgresLogStore),
}

impl Backend {
	async fn connect(
		cfg: &Config,
		pool: Option<crate::database::DatabasePool>,
	) -> anyhow::Result<Self> {
		let pool = match pool {
			Some(pool) => pool,
			None => {
				crate::database::DatabasePool::connect_with_max_connections(&cfg.url, cfg.max_connections)
					.await?
			},
		};
		match pool {
			crate::database::DatabasePool::Sqlite(pool) => {
				Ok(Self::Sqlite(sqlite::SqliteLogStore::from_pool(pool).await?))
			},
			crate::database::DatabasePool::Postgres(pool) => Ok(Self::Postgres(
				postgres::PostgresLogStore::from_pool(pool).await?,
			)),
		}
	}

	async fn insert_batch(&self, records: &[StoredRequestLog]) -> anyhow::Result<()> {
		match self {
			Self::Sqlite(store) => store.insert_batch(records).await,
			Self::Postgres(store) => store.insert_batch(records).await,
		}
	}

	async fn search(&self, request: SearchRequest) -> anyhow::Result<SearchResponse> {
		match self {
			Self::Sqlite(store) => store.search(request).await,
			Self::Postgres(store) => store.search(request).await,
		}
	}

	async fn get(&self, request: GetRequest) -> anyhow::Result<GetResponse> {
		match self {
			Self::Sqlite(store) => store.get(request).await,
			Self::Postgres(store) => store.get(request).await,
		}
	}

	async fn analytics_summary(
		&self,
		request: AnalyticsSummaryRequest,
	) -> anyhow::Result<AnalyticsSummaryResponse> {
		match self {
			Self::Sqlite(store) => store.analytics_summary(request).await,
			Self::Postgres(store) => store.analytics_summary(request).await,
		}
	}

	async fn stored_ids(&self, ids: &[&str]) -> anyhow::Result<std::collections::HashSet<String>> {
		match self {
			Self::Sqlite(store) => store.stored_ids(ids).await,
			Self::Postgres(store) => store.stored_ids(ids).await,
		}
	}

	async fn usage_outbox(&self, request: UsageOutboxRequest) -> anyhow::Result<UsageOutboxResponse> {
		if request.trace_id.as_deref().is_some_and(|trace| trace.len() != 32 || !trace.bytes().all(|b| b.is_ascii_hexdigit())) {
			anyhow::bail!("usage trace identity is invalid");
		}
		let (entries, counts) = match self {
			Self::Sqlite(store) => store.usage_outbox(&request).await?,
			Self::Postgres(store) => store.usage_outbox(&request).await?,
		};
		Ok(UsageOutboxResponse::new(&request, entries, counts))
	}

	async fn begin_usage(&self, id: &str, trace: Option<&str>, started_at: DateTime<Utc>, attempt: i64) -> anyhow::Result<()> {
		match self {
			Self::Sqlite(store) => store.begin_usage(id, trace, started_at, attempt).await,
			Self::Postgres(store) => store.begin_usage(id, trace, started_at, attempt).await,
		}
	}

	async fn tail(&self, request: TailRequest) -> anyhow::Result<TailResponse> {
		match self {
			Self::Sqlite(store) => store.tail(request).await,
			Self::Postgres(store) => store.tail(request).await,
		}
	}
}
