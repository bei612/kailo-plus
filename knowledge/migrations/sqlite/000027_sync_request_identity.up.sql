ALTER TABLE sync_logs ADD COLUMN request_key TEXT;
ALTER TABLE sync_logs ADD COLUMN request_identity TEXT
    CHECK ((request_key IS NULL) = (request_identity IS NULL));
CREATE UNIQUE INDEX idx_sync_logs_request_key ON sync_logs(request_key);
