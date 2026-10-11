ALTER TABLE mcp_endpoints ADD COLUMN IF NOT EXISTS platform_closed_generation BIGINT NOT NULL DEFAULT 0;
ALTER TABLE data_sources ADD COLUMN IF NOT EXISTS platform_binding_id TEXT NOT NULL DEFAULT '';
