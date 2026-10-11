DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM sync_logs WHERE request_key IS NOT NULL) THEN
        RAISE EXCEPTION 'cannot remove retained native sync request ownership';
    END IF;
END $$;

DROP INDEX idx_sync_logs_request_key;
ALTER TABLE sync_logs DROP CONSTRAINT sync_request_identity_pair;
ALTER TABLE sync_logs DROP COLUMN request_identity, DROP COLUMN request_key;
