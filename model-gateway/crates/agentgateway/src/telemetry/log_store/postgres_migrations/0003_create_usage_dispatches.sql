-- Native request-log admission metadata, not a quota or billing ledger.
-- Written and acknowledged before each provider attempt. A missing completion remains pending.
-- IDs are the same stable IDs used by completed request_logs and usage_outbox.
CREATE TABLE IF NOT EXISTS usage_dispatches (
	id TEXT PRIMARY KEY,
	trace_id TEXT,
	started_at TIMESTAMPTZ NOT NULL,
	attempt BIGINT NOT NULL CHECK (attempt >= 0)
);
CREATE INDEX IF NOT EXISTS usage_dispatches_trace ON usage_dispatches (trace_id, id);
