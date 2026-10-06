-- Identity belongs to the existing durable provider attempt, not a second ledger.
-- Legacy AGENT requests retain their original trace-based semantics.
ALTER TABLE usage_dispatches ADD COLUMN gateway_user TEXT;
CREATE INDEX usage_dispatches_gateway_user_idx ON usage_dispatches(gateway_user);
