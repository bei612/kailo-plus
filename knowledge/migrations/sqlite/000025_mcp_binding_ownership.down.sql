CREATE TEMP TABLE mcp_binding_rollback_guard (retained INTEGER NOT NULL CHECK (retained = 0));
INSERT INTO mcp_binding_rollback_guard SELECT 1 FROM mcp_endpoints WHERE platform_binding_id <> '' LIMIT 1;
DROP TABLE mcp_binding_rollback_guard;
DROP INDEX idx_mcp_endpoints_platform_binding_id;
ALTER TABLE mcp_endpoints DROP COLUMN platform_binding_id;
