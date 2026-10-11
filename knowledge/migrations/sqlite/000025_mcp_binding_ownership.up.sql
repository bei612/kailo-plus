ALTER TABLE mcp_endpoints ADD COLUMN platform_binding_id VARCHAR(36) NOT NULL DEFAULT '';
CREATE INDEX idx_mcp_endpoints_platform_binding_id ON mcp_endpoints(platform_binding_id);
