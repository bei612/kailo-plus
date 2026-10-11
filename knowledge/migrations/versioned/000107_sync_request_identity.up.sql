ALTER TABLE sync_logs
    ADD COLUMN request_key VARCHAR(36),
    ADD COLUMN request_identity JSONB;

CREATE UNIQUE INDEX idx_sync_logs_request_key ON sync_logs(request_key);

ALTER TABLE sync_logs ADD CONSTRAINT sync_request_identity_pair
    CHECK ((request_key IS NULL) = (request_identity IS NULL));
