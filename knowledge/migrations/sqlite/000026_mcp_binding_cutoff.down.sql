CREATE TEMP TABLE mcp_cutoff_rollback_guard (value INTEGER CHECK (value = 0));
INSERT INTO mcp_cutoff_rollback_guard SELECT 1 FROM mcp_endpoints WHERE platform_closed_generation <> 0 LIMIT 1;
INSERT INTO mcp_cutoff_rollback_guard SELECT 1 FROM data_sources WHERE platform_binding_id <> '' LIMIT 1;
DROP TABLE mcp_cutoff_rollback_guard;
ALTER TABLE mcp_endpoints DROP COLUMN platform_closed_generation;
ALTER TABLE data_sources DROP COLUMN platform_binding_id;
