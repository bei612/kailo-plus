-- Usage outbox: one entry per completed LLM request, readable by sequence cursor.
-- Entries are never deleted; RESTRICT keeps the referenced request log in place.
-- Writers hold an EXCLUSIVE lock on this table for the rest of their transaction before taking
-- sequence numbers, so sequence order equals commit order and a cursor reader never skips an
-- entry that commits later with a smaller number.
CREATE TABLE IF NOT EXISTS usage_outbox (
	seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	log_id TEXT NOT NULL UNIQUE REFERENCES request_logs(id) ON DELETE RESTRICT
);
