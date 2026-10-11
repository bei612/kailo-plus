DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM mcp_endpoints WHERE platform_binding_id <> '') THEN
        RAISE EXCEPTION 'cannot remove retained MCP binding ownership';
    END IF;
END $$;
DROP INDEX IF EXISTS idx_mcp_endpoints_platform_binding_id;
ALTER TABLE mcp_endpoints DROP COLUMN IF EXISTS platform_binding_id;
