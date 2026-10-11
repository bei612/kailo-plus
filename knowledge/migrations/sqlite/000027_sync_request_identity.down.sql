CREATE TEMP TABLE sync_request_rollback_guard (value INTEGER CHECK (value = 0));
INSERT INTO sync_request_rollback_guard SELECT 1 FROM sync_logs WHERE request_key IS NOT NULL LIMIT 1;
DROP TABLE sync_request_rollback_guard;
DROP INDEX idx_sync_logs_request_key;
ALTER TABLE sync_logs DROP COLUMN request_identity;
ALTER TABLE sync_logs DROP COLUMN request_key;
