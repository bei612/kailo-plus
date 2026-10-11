DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM mcp_endpoints WHERE platform_closed_generation <> 0) OR EXISTS (SELECT 1 FROM data_sources WHERE platform_binding_id <> '') THEN
        RAISE EXCEPTION 'cannot discard a retained native binding cutoff';
    END IF;
END $$;
ALTER TABLE mcp_endpoints DROP COLUMN IF EXISTS platform_closed_generation;
ALTER TABLE data_sources DROP COLUMN IF EXISTS platform_binding_id;
